import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { EFaturaSyncService } from '../efatura-adapters/efatura-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

/**
 * Fatura Merkezi — gece scheduler.
 *
 * IntegrationConnection.config.taxpayers[taxpayerKey].talimat === true olan
 * her sağlayıcı+mükellef kombinasyonu için her gece otomatik fatura çekimini
 * tetikler. Hem ALIS hem SATIS yönü çekilir. Donem: içinde bulunulan ay;
 * ayın ilk 10 gününde önceki ay da taranır (geç düşen faturalar için).
 *
 * Cron: her gece 03:15 (Europe/Istanbul). e-Beyanname runner 02:15'te
 * çalışıyor; entegratör fetch'i ondan sonra rahatça yer bulsun diye 03:15.
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

  @Cron('0 15 3 * * *', { timeZone: 'Europe/Istanbul' })
  async nightlyTick() {
    if (this.running) {
      this.logger.warn('Önceki gece akışı hâlâ çalışıyor, atlanıyor.');
      return;
    }
    this.running = true;
    try {
      await this.runNightly();
    } catch (err: any) {
      this.logger.error(`Gece akışı hata: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }

  private async runNightly() {
    const now = new Date();
    const donemler = [
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    ];
    // Ayın ilk 10 günü: geç düşen ay sonu faturaları için önceki dönem de taranır
    if (now.getDate() <= 10) {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      donemler.unshift(
        `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`,
      );
    }

    const tenants = await (this.prisma as any).tenant.findMany({
      select: { id: true },
    });

    for (const tenant of tenants) {
      // Yeni adapter tabanlı inbox sync (efatura_inbox tablosuna yazar)
      let syncFailed = 0;
      try {
        await this.withTimeout(
          this.eFaturaSyncService.syncAll(tenant.id, { direction: 'IN' }),
          FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
          `sync IN ${tenant.id}`,
        );
        await this.withTimeout(
          this.eFaturaSyncService.syncAll(tenant.id, { direction: 'OUT' }),
          FaturaMuhasebelestirmeCron.OP_TIMEOUT_MS,
          `sync OUT ${tenant.id}`,
        );
      } catch (err: any) {
        syncFailed = 1;
        this.logger.error(`[Tenant ${tenant.id}] EFatura adapter sync hata: ${err?.message}`);
      }

      const sonuc = await this.runForTenant(tenant.id, donemler);
      if (sonuc.failed + syncFailed > 0) {
        await this.notifyFailures(tenant.id, donemler, { ...sonuc, syncFailed });
      }
    }
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

  private async runForTenant(
    tenantId: string,
    donemler: string[],
  ): Promise<{ alisOk: number; satisOk: number; failed: number }> {
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: { tenantId, isActive: true },
      select: { provider: true, config: true },
    });

    type Plan = { taxpayerId: string; provider: string };
    const plan: Plan[] = [];

    for (const conn of connections) {
      const cfg: any = conn.config || {};
      const taxpayers: Record<string, any> = cfg.taxpayers || {};
      for (const [taxpayerKey, taxpayerCfg] of Object.entries(taxpayers)) {
        if (!taxpayerCfg || taxpayerKey === 'global') continue;
        if ((taxpayerCfg as any).talimat !== true) continue;
        plan.push({ taxpayerId: taxpayerKey, provider: conn.provider });
      }
    }

    if (plan.length === 0) {
      this.logger.log(`[Tenant ${tenantId}] gece akışı: talimatlı entegratör yok`);
      return { alisOk: 0, satisOk: 0, failed: 0 };
    }

    this.logger.log(`[Tenant ${tenantId}] gece akışı: ${plan.length} talimat işleniyor (dönem ${donemler.join(', ')})`);

    // Mükellef başına paralelliği sınırla — Uyumsoft/Izibiz API'larını boğmamak için
    // sıralı işle, her biri ortalama 5-30sn sürer
    let alisOk = 0;
    let satisOk = 0;
    let failed = 0;
    for (const donem of donemler) {
      for (const item of plan) {
        for (const direction of ['ALIS', 'SATIS'] as const) {
          try {
            // Tek entegratör çağrısı asılırsa timeout ile kesilir; catch bloğu bunu 'failed' sayıp
            // döngüye devam eder — gece akışı bir mükellefte sonsuza kilitlenmesin.
            await this.withTimeout(
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
            if (direction === 'ALIS') alisOk++;
            else satisOk++;
          } catch (err: any) {
            failed++;
            this.logger.warn(
              `[Tenant ${tenantId}] ${item.provider}/${item.taxpayerId}/${direction}/${donem} hata: ${err?.message || err}`,
            );
          }
        }
      }
    }

    this.logger.log(
      `[Tenant ${tenantId}] gece akışı bitti: alış=${alisOk}, satış=${satisOk}, hata=${failed}`,
    );
    return { alisOk, satisOk, failed };
  }
}
