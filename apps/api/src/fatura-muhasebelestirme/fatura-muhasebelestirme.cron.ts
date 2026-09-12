import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { EFaturaSyncService } from '../efatura-adapters/efatura-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import {
  GECE_CRON_IFADESI,
  GeceKosuOzeti,
  GecePlanSatiri,
  geceCekimEnvKapaliMi,
  geceDonemleri,
  gecePlaniOlustur,
  istanbulSaati,
  istanbulTarihi,
} from './gece-cekim';

/**
 * Fatura Merkezi — gece scheduler (PLAN/16 §H: HAZIR ama VARSAYILAN KAPALI).
 *
 * IntegrationConnection.config.taxpayers[taxpayerId].talimat === true olan her sağlayıcı+mükellef
 * satırı, kendi `saat`inde (HH:MM, 00:00–06:59; yoksa 02:00) çekilir. Hem ALIS hem SATIS yönü.
 * Dönem: içinde bulunulan ay; ayın ilk 10 gününde önceki ay da taranır (geç düşen faturalar için).
 *
 * Cron: her saat başı 00:05 … 06:05 (Europe/Istanbul); her tikte yalnız saati o saate denk gelenler
 * işlenir (dakika yok sayılır). e-Beyanname runner 02:15'te çalışıyor; 02:00 varsayılanı 02:05'te
 * tetiklenir ve ondan önce biter/paralel gider — entegratör çağrıları Luca/GİB oturumu kullanmaz.
 *
 * Kapılar (hepsi geçmeli):
 *   1) NIGHTLY_EFATURA env'i off|0|false|kapali ise HİÇBİR ŞEY çekilmez (global kill-switch).
 *   2) talimat === true olmayan mükellef ASLA çekilmez (talimat 'global' anahtarında açılamaz).
 *   3) Adapter tabanlı inbox senkronu (efatura_inbox) da yalnız planlı (talimatlı) satırlar için çalışır —
 *      eskiden bağlantısı olan HER mükellef için her gece çalışıyordu; kullanıcı kararı gereği kapatıldı.
 *
 * Her satırın sonucu AuditLog(action 'GECE_CEKIM', resource 'gece-cekim') kaydına yazılır:
 *   { tarih, taxpayerId, provider, alis, satis, hata, sure } — sabah özeti (Koordinatör) buradan okur.
 */
@Injectable()
export class FaturaMuhasebelestirmeCron {
  private readonly logger = new Logger(FaturaMuhasebelestirmeCron.name);
  private running = false;
  /** Tek çağrı için üst süre sınırı — asılan bir entegratör çağrısı tüm gece akışını kilitlemesin (10 dk). */
  private static readonly OP_TIMEOUT_MS = 10 * 60 * 1000;

  /** Bir promise'i üst süre ile sar; sürede bitmezse reddet (sonsuz askıyı önler, süreyi kısaltmaz). */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`zaman aşımı (${label}, ${Math.round(ms / 60000)} dk)`)),
        ms,
      );
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: FaturaMuhasebelestirmeService,
    private readonly eFaturaSyncService: EFaturaSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(GECE_CRON_IFADESI, { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    if (geceCekimEnvKapaliMi()) {
      this.logger.log('Gece e-Fatura çekimi env ile KAPALI (NIGHTLY_EFATURA) — hiçbir şey çekilmedi.');
      return;
    }
    if (this.running) {
      this.logger.warn('Önceki gece akışı hâlâ çalışıyor, bu tik atlanıyor.');
      return;
    }
    this.running = true;
    try {
      await this.runNightly(new Date());
    } catch (err: any) {
      this.logger.error(`Gece akışı hata: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }

  /** Test/elle tetik için: verilen anın Istanbul saatine denk gelen talimatlı satırları işler. */
  async runNightly(now: Date = new Date()) {
    // Dönem + gün Istanbul takvimine göre (sunucu UTC: 00:05 İstanbul = önceki gün 21:05 UTC);
    //   ayın ilk 10 günü geç düşen ay sonu faturaları için önceki dönem de taranır.
    const donemler = geceDonemleri(now);
    const saat = istanbulSaati(now);

    const tenants = await (this.prisma as any).tenant.findMany({
      select: { id: true },
    });

    for (const tenant of tenants) {
      const plan = await this.planForTenant(tenant.id, saat);
      if (plan.length === 0) {
        this.logger.log(`[Tenant ${tenant.id}] gece akışı (saat ${String(saat).padStart(2, '0')}): bu saate talimatlı mükellef yok`);
        continue;
      }

      // Adapter tabanlı inbox sync (efatura_inbox) — YALNIZ planlı (talimatlı + saati uyan) satırlar için.
      let syncFailed = 0;
      const only = plan.map((p) => ({ taxpayerId: p.taxpayerId, provider: p.provider }));
      try {
        await this.withTimeout(
          this.eFaturaSyncService.syncAll(tenant.id, { direction: 'IN', only }),
          FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
          `sync IN ${tenant.id}`,
        );
        await this.withTimeout(
          this.eFaturaSyncService.syncAll(tenant.id, { direction: 'OUT', only }),
          FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
          `sync OUT ${tenant.id}`,
        );
      } catch (err: any) {
        syncFailed = 1;
        this.logger.error(`[Tenant ${tenant.id}] EFatura adapter sync hata: ${err?.message}`);
      }

      const sonuc = await this.runForTenant(tenant.id, donemler, plan);
      if (sonuc.failed + syncFailed > 0) {
        await this.notifyFailures(tenant.id, donemler, { ...sonuc, syncFailed });
      }
    }
  }

  /** Tenant'ın aktif bağlantılarından bu saate düşen talimatlı satırlar. */
  private async planForTenant(tenantId: string, saat: number): Promise<GecePlanSatiri[]> {
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: { tenantId, isActive: true },
      select: { provider: true, config: true, isActive: true },
    });
    return gecePlaniOlustur(connections, saat);
  }

  /** Gece koşusunda başarısızlık varsa tek toplu portal bildirimi (yalnız özet sayılar). */
  private async notifyFailures(
    tenantId: string,
    donemler: string[],
    sonuc: { alisOk: number; satisOk: number; failed: number; syncFailed: number },
  ) {
    const parcalar: string[] = [];
    if (sonuc.failed > 0) parcalar.push(`${sonuc.failed} kaynak başarısız`);
    if (sonuc.syncFailed > 0) parcalar.push('inbox senkronu başarısız');

    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    await this.notifications.createForTenant({
      tenantId,
      type: NOTIFICATION_TYPES.SYSTEM,
      title: `Gece fatura çekimi: ${parcalar.join(', ')}`,
      body: `Dönem ${donemler.join(', ')} — başarılı: alış ${sonuc.alisOk}, satış ${sonuc.satisOk}; başarısız: ${sonuc.failed + sonuc.syncFailed}.`,
      metadata: {
        alisOk: sonuc.alisOk,
        satisOk: sonuc.satisOk,
        failed: sonuc.failed,
        syncFailed: sonuc.syncFailed,
        donemler,
        link: '/panel/faturalar',
      },
      dedupeKey: `fatura-gece-fail:${tenantId}:${todayKey}`,
      dedupeWindowMin: 60 * 20,
    }).catch((e) => {
      this.logger.warn(`Gece fatura bildirim hatası: ${(e as Error).message}`);
    });
  }

  /** Gece sonucu kaydı — AuditLog GECE_CEKIM (sabah özeti + FE geçmişi buradan okur). */
  private async kaydetGeceKosusu(tenantId: string, ozet: GeceKosuOzeti) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          tenantId,
          userId: null,
          action: 'GECE_CEKIM',
          resource: 'gece-cekim',
          resourceId: `${ozet.provider}:${ozet.taxpayerId}`,
          newData: ozet,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[Tenant ${tenantId}] GECE_CEKIM kaydı yazılamadı: ${e?.message || e}`);
    }
  }

  private async runForTenant(
    tenantId: string,
    donemler: string[],
    plan: GecePlanSatiri[],
  ): Promise<{ alisOk: number; satisOk: number; failed: number }> {
    if (plan.length === 0) return { alisOk: 0, satisOk: 0, failed: 0 };

    this.logger.log(`[Tenant ${tenantId}] gece akışı: ${plan.length} talimat işleniyor (dönem ${donemler.join(', ')})`);

    const tarih = istanbulTarihi(new Date()).ymd;

    // Mükellef başına paralelliği sınırla — Uyumsoft/Izibiz API'larını boğmamak için
    // sıralı işle, her biri ortalama 5-30sn sürer
    let alisOk = 0;
    let satisOk = 0;
    let failed = 0;
    for (const item of plan) {
      const basladi = Date.now();
      const ozet: GeceKosuOzeti = { tarih, taxpayerId: item.taxpayerId, provider: item.provider, alis: 0, satis: 0, hata: 0, sure: 0 };
      for (const donem of donemler) {
        for (const direction of ['ALIS', 'SATIS'] as const) {
          try {
            // Tek entegratör çağrısı asılırsa timeout ile kesilir; catch bloğu bunu 'failed' sayıp
            // döngüye devam eder — gece akışı bir mükellefte sonsuza kilitlenmesin.
            const r: any = await this.withTimeout(
              this.service.fetchConfiguredIntegrations(
                tenantId,
                {
                  taxpayerId: item.taxpayerId,
                  providers: [item.provider],
                  direction,
                  donem,
                  limit: 500,
                },
                'scheduler',
              ),
              FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
              `${item.provider}/${item.taxpayerId}/${direction}/${donem}`,
            );
            const gelen = Number(r?.created) || 0;
            if (direction === 'ALIS') { alisOk++; ozet.alis += gelen; }
            else { satisOk++; ozet.satis += gelen; }
            ozet.hata += Number(r?.failed) || 0;
          } catch (err: any) {
            failed++;
            ozet.hata++;
            this.logger.warn(
              `[Tenant ${tenantId}] ${item.provider}/${item.taxpayerId}/${direction}/${donem} hata: ${err?.message || err}`,
            );
          }
        }
      }
      ozet.sure = Math.round((Date.now() - basladi) / 1000);
      await this.kaydetGeceKosusu(tenantId, ozet);
    }

    this.logger.log(
      `[Tenant ${tenantId}] gece akışı bitti: alış=${alisOk}, satış=${satisOk}, hata=${failed}`,
    );
    return { alisOk, satisOk, failed };
  }
}
