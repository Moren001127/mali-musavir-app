import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LucaService } from './luca.service';
// cron-parser pnpm store'da mevcut (cron@4.x deps üzerinden) ama dolaylı.
// Direct import için doğrudan require ile yükle — eğer yoksa fallback'e geç.
let parseExpression: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cronParser = require('cron-parser');
  parseExpression = cronParser.parseExpression || cronParser.default?.parseExpression;
} catch {
  parseExpression = null;
}

/**
 * Boyut D — Zamanlanmış Luca işleri için scheduler tick.
 * Her dakikada bir aktif ScheduledLucaJob'ları kontrol eder:
 *  - nextRunAt <= now → bağlı tüm mükellefler için LucaFetchJob yarat
 *  - lastRunAt = now, nextRunAt = cron + now'a göre hesapla
 *
 * cron-parser bulunamazsa: schedule pasif, hata log'lar.
 */
@Injectable()
export class LucaScheduleService {
  private readonly logger = new Logger(LucaScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly luca: LucaService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'Europe/Istanbul' })
  async tick() {
    if (!parseExpression) {
      // İlk tick'te uyar, sonraki tick'lerde sessizce geç
      if (!(this as any).__parserWarned) {
        this.logger.warn('cron-parser yüklenemedi, scheduled Luca jobs pasif. `pnpm add cron-parser` ile düzelt.');
        (this as any).__parserWarned = true;
      }
      return;
    }
    const now = new Date();
    const due = await (this.prisma as any).scheduledLucaJob.findMany({
      where: {
        active: true,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      take: 50,
    });
    if (!due.length) return;

    for (const sched of due) {
      try {
        await this.runScheduled(sched);
      } catch (err: any) {
        this.logger.error(`Scheduled job ${sched.id} hata: ${err?.message || err}`);
        // Hatada dahi nextRunAt'i ilerlet ki sonsuza takılmasın
        await this.advanceNextRunAt(sched, now);
      }
    }
  }

  /**
   * Bağımsız temizleyici (reaper) — dakikada bir. Yeni iş yaratılmasa bile:
   *  - iş-tipi penceresini aşan takılı running'leri kapatır,
   *  - 30+ dk hiç alınmamış pending iş için tek görünür uyarı bildirir.
   * Böylece "boşta takılan iş sonsuza kadar bekler" + "canlı uzun iş öldürülür"
   * sorunları tek merkezden çözülür.
   */
  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'Europe/Istanbul' })
  async reapTick() {
    try {
      await this.luca.reapStaleJobs();
    } catch (err: any) {
      this.logger.warn(`Reaper hata: ${err?.message || err}`);
    }
  }

  /**
   * GECE OTOMATİK "Gelen E-Arşiv" (EARSIV_ALIS) sorgulama — kullanıcı isteği 2026-08-06.
   * Her gece 02:00 (Istanbul): her tenant için aktif + kapanmamış TÜM mükellefe
   * ÖNCEKİ AY dönemiyle EARSIV_ALIS job'u açar. Ajanın kendi 2-sorgu mantığı bunu
   * "önceki ay tamamı (Sorgu 1) + içinde bulunulan ay başı → bugün (Sorgu 2)" olarak
   * çeker; VPS Luca agent gece boyu sırayla indirir.
   *   - "Gelen E-Arşiv"de tüm mükellefler uygun (frontend: GELEN_EARSIV → herkes).
   *   - Kapanan firma o dönemde aktif değilse elenir (endDate < önceki-ay-başı).
   *   - Tekrar-koruma createFetchJob'da: aynı mükellef+dönem+tip pending/running varsa
   *     yeni kopya açılmaz → önceki gecenin işi bitmediyse üst üste binmez.
   *   - Otomatik Fatura Merkezi aktarımı YOK (kullanıcı: sadece indir; #3 ile tutarlı).
   *   - Kapatmak için env: NIGHTLY_EARSIV=off
   */
  @Cron('0 2 * * *', { timeZone: 'Europe/Istanbul' })
  async nightlyEarsivAlis() {
    if (String(process.env.NIGHTLY_EARSIV || '').trim().toLowerCase() === 'off') {
      this.logger.log('Gece e-Arşiv sorgusu KAPALI (NIGHTLY_EARSIV=off)');
      return;
    }
    const now = new Date();
    // donem = ÖNCEKİ AY → ajan Sorgu1 = önceki ay tamamı, Sorgu2 = bu ay başı → bugün.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const donem = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const firstDay = prev; // kapanan-firma filtresi: önceki ay başında aktif olanlar

    // Tüm tenant'lar (aktif mükellefi olanlar)
    const tenantRows: Array<{ tenantId: string }> = await (this.prisma as any).taxpayer
      .findMany({ where: { isActive: true }, distinct: ['tenantId'], select: { tenantId: true } })
      .catch(() => []);

    let totalCreated = 0;
    let totalTaxpayers = 0;
    for (const { tenantId } of tenantRows) {
      const taxpayers = await (this.prisma as any).taxpayer.findMany({
        where: {
          tenantId,
          isActive: true,
          taxNumber: { not: { startsWith: 'WHATSAPP-' } },
          OR: [{ endDate: null }, { endDate: { gte: firstDay } }],
        },
        select: { id: true, companyName: true, firstName: true, lastName: true },
        take: 3000,
      });
      totalTaxpayers += taxpayers.length;
      for (const mk of taxpayers) {
        const mukellefAdi =
          mk.companyName || [mk.firstName, mk.lastName].filter(Boolean).join(' ') || '';
        try {
          await this.luca.createFetchJob({
            tenantId,
            sessionId: undefined as any,
            mukellefId: mk.id,
            donem,
            tip: 'EARSIV_ALIS',
            createdBy: 'nightly-earsiv',
            mukellefAdi,
          });
          totalCreated++;
        } catch {
          // mükellef-bazlı hatayı yut, diğerlerini dene
        }
      }
    }
    this.logger.log(
      `Gece e-Arşiv (EARSIV_ALIS, dönem ${donem}): ${totalTaxpayers} mükelleften ${totalCreated} yeni job kuyruğa alındı`,
    );
  }

  private async runScheduled(sched: any) {
    const now = new Date();
    // Mükellef listesi
    let mukellefIds: string[] = Array.isArray(sched.mukellefIds) ? sched.mukellefIds : [];
    if (mukellefIds.length === 0) {
      // Tüm aktif mükellefler
      const taxpayers = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId: sched.tenantId, /* aktif filter buraya */ },
        select: { id: true, companyName: true, firstName: true, lastName: true },
        take: 1000,
      });
      mukellefIds = taxpayers.map((t: any) => t.id);
    }
    const opts = (sched.options as any) || {};
    // Dönem: opts.donem belirtildiyse onu kullan, yoksa içinde bulunulan ay
    const donem = opts.donem || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let created = 0;
    for (const mukellefId of mukellefIds) {
      try {
        await this.luca.createFetchJob({
          tenantId: sched.tenantId,
          sessionId: undefined as any,
          mukellefId,
          donem,
          tip: sched.jobTip,
          createdBy: sched.createdBy || 'scheduler',
          preferredAgent: sched.preferredAgent || undefined,
          priority: sched.priority || 0,
        });
        created++;
      } catch (e) {
        // Mükellef-bazlı hatayı yut, diğerlerini dene
      }
    }
    this.logger.log(`Scheduled ${sched.name}: ${created} job yaratıldı`);

    await this.advanceNextRunAt(sched, now);
  }

  private async advanceNextRunAt(sched: any, now: Date) {
    let nextRunAt: Date | null = null;
    try {
      if (parseExpression && sched.cron) {
        const it = parseExpression(sched.cron, { currentDate: now, tz: 'Europe/Istanbul' });
        nextRunAt = it.next().toDate();
      }
    } catch (e: any) {
      this.logger.warn(`Cron parse hatası (${sched.cron}): ${e?.message}`);
    }
    await (this.prisma as any).scheduledLucaJob.update({
      where: { id: sched.id },
      data: {
        lastRunAt: now,
        nextRunAt,
      },
    });
  }
}
