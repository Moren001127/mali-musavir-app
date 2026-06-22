import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { calculateBeyannameDeadline } from './beyanname-deadline.util';

/**
 * Beyanname son tarih hatirlatma cron'u — TAX_DEADLINE bildirimi.
 *
 * Her sabah 06:30 Europe/Istanbul calisir.
 * Her tenant icin onceki donemin (gecen ay) 'beklemede' BeyanDurumu kayitlarini tarar.
 * Beyan tipinin standart son tarihine kalan gun <= 7 ise tenant'a bildirim atar.
 * Dedupe ile ayni gun ayni beyanname icin tekrar etmez.
 *
 * Son tarih kurallari kabaca (TC standart):
 *   - KDV1, KDV2, KDV4, KDV9015     -> Bir sonraki ayin 28'i
 *   - MUHSGK, MUHSGK2               -> Bir sonraki ayin 26'si
 *   - DAMGA                         -> Bir sonraki ayin 25'i
 *   - POSET                         -> 3 ayligi takip eden ayin 24'u (kabaca 24)
 *   - BILDIRGE                      -> Bir sonraki ayin 23'u
 *   - EDEFTER                       -> 3 ay sonrasinin son gunu (default 30)
 *   - GGECICI, KGECICI              -> Donem sonu ayinin 17'si
 *   - KURUMLAR                      -> 30 Nisan
 *   - GELIR                         -> 31 Mart
 *
 * Bu cron'u kapatmak icin BEYAN_DEADLINE_CRON_ENABLED=false env'i ile dur.
 */
@Injectable()
export class BeyannameDeadlineCron {
  private readonly logger = new Logger(BeyannameDeadlineCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 30 6 * * *', { timeZone: 'Europe/Istanbul' })
  async run() {
    if (!this.isEnabled()) {
      this.logger.log('[BeyannameDeadlineCron] env ile kapali, atlandi');
      return;
    }
    this.logger.log('[BeyannameDeadlineCron] Tarama basliyor');
    try {
      const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true, name: true } });
      const today = this.todayIstanbul();
      const previousDonem = this.previousMonth(today);

      let totalNotified = 0;
      for (const tenant of tenants) {
        try {
          const sent = await this.runForTenant(tenant.id, previousDonem, today);
          totalNotified += sent;
        } catch (err: any) {
          this.logger.warn(`[BeyannameDeadlineCron] tenant=${tenant.id} hata: ${err?.message || err}`);
        }
      }
      this.logger.log(`[BeyannameDeadlineCron] Tamam: ${totalNotified} bildirim`);
    } catch (err: any) {
      this.logger.error(`[BeyannameDeadlineCron] Genel hata: ${err?.message || err}`);
    }
  }

  private async runForTenant(tenantId: string, donem: string, today: Date): Promise<number> {
    // donem (gecen ay) icin 'beklemede' kayitlari cek
    const records = await (this.prisma as any).beyanDurumu.findMany({
      where: {
        tenantId,
        donem,
        durum: 'beklemede',
      },
      include: {
        taxpayer: { select: { companyName: true, firstName: true, lastName: true } },
      },
    });
    if (!records.length) return 0;

    // BEYAN TİPİNE GÖRE GRUPLA → mükellef başına AYRI bildirim YERİNE tek ÖZET bildirim.
    // (Eskiden her mükellefe ayrı bildirim üretiyordu; owner-notifier aynı-tip bildirimleri
    //  10 sn debounce ettiği için 22 deadline'dan sadece 1'i gidiyordu = "sadece Sabri Yaşın".)
    const grup = new Map<string, { deadline: Date; daysRemaining: number; names: string[] }>();
    for (const rec of records) {
      const deadline = calculateBeyannameDeadline(rec.beyanTipi, rec.donem);
      if (!deadline) continue;
      const daysRemaining = Math.ceil((deadline.getTime() - today.getTime()) / (24 * 3600 * 1000));
      if (daysRemaining < 0 || daysRemaining > 7) continue;
      const mukellefName = rec.taxpayer?.companyName ||
        [rec.taxpayer?.firstName, rec.taxpayer?.lastName].filter(Boolean).join(' ') ||
        'Mükellef';
      const g = grup.get(rec.beyanTipi) || { deadline, daysRemaining, names: [] };
      g.names.push(mukellefName);
      // En yakın (en küçük gün) deadline'ı tut
      if (daysRemaining < g.daysRemaining) { g.daysRemaining = daysRemaining; g.deadline = deadline; }
      grup.set(rec.beyanTipi, g);
    }

    let notified = 0;
    for (const [beyanTipi, g] of grup) {
      const urgency = g.daysRemaining <= 1 ? '🚨 ACİL' : g.daysRemaining <= 3 ? '⚠️' : '⏰';
      const isimler = g.names.slice(0, 40).join(', ') + (g.names.length > 40 ? ` … (+${g.names.length - 40})` : '');
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.TAX_DEADLINE,
        title: `${urgency} ${beyanTipi} son ${g.daysRemaining} gün — ${g.names.length} mükellef`,
        body: `${donem} dönemi ${beyanTipi} son verme tarihi ${this.formatTr(g.deadline)}. Henüz onaylanmamış (${g.names.length}): ${isimler}`,
        metadata: {
          beyanTipi,
          donem,
          mukellefSayisi: g.names.length,
          deadline: g.deadline.toISOString(),
          daysRemaining: g.daysRemaining,
          link: `/panel/beyannameler?donem=${encodeURIComponent(donem)}`,
        },
        dedupeKey: `tax-deadline:${beyanTipi}:${donem}:${this.todayKey(today)}`,
        dedupeWindowMin: 60 * 20,
      }).catch((e) => {
        this.logger.warn(`TAX_DEADLINE notif failed: ${(e as Error).message}`);
      });
      notified++;
    }
    return notified;
  }

  private isEnabled(): boolean {
    const raw = process.env.BEYAN_DEADLINE_CRON_ENABLED;
    if (raw == null) return true;
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(raw).trim().toLowerCase());
  }

  private todayIstanbul(): Date {
    // Su anki yerel Istanbul tarihinin baslangici (00:00)
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const key = fmt.format(new Date());
    return new Date(`${key}T00:00:00+03:00`);
  }

  private todayKey(today: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(today);
  }

  private previousMonth(today: Date): string {
    const d = new Date(today);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private formatTr(d: Date): string {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(d);
  }
}
