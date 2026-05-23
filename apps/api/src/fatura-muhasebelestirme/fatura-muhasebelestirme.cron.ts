import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

/**
 * Fatura Merkezi — gece scheduler.
 *
 * IntegrationConnection.config.taxpayers[taxpayerKey].talimat === true olan
 * her sağlayıcı+mükellef kombinasyonu için her gece otomatik fatura çekimini
 * tetikler. Hem ALIS hem SATIS yönü çekilir. Donem: içinde bulunulan ay.
 *
 * Cron: her gece 03:15 (Europe/Istanbul). e-Beyanname runner 02:15'te
 * çalışıyor; entegratör fetch'i ondan sonra rahatça yer bulsun diye 03:15.
 */
@Injectable()
export class FaturaMuhasebelestirmeCron {
  private readonly logger = new Logger(FaturaMuhasebelestirmeCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: FaturaMuhasebelestirmeService,
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
    const donem = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Tüm tenant'ları tara — multi-tenant olsa da tek ofis için tek tenant
    const tenants = await (this.prisma as any).tenant.findMany({
      select: { id: true },
    });

    for (const tenant of tenants) {
      await this.runForTenant(tenant.id, donem);
    }
  }

  private async runForTenant(tenantId: string, donem: string) {
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
      return;
    }

    this.logger.log(`[Tenant ${tenantId}] gece akışı: ${plan.length} talimat işleniyor (dönem ${donem})`);

    // Mükellef başına paralelliği sınırla — Uyumsoft/Izibiz API'larını boğmamak için
    // sıralı işle, her biri ortalama 5-30sn sürer
    let alisOk = 0;
    let satisOk = 0;
    let failed = 0;
    for (const item of plan) {
      for (const direction of ['ALIS', 'SATIS'] as const) {
        try {
          await this.service.fetchConfiguredIntegrations(
            tenantId,
            {
              taxpayerId: item.taxpayerId,
              providers: [item.provider],
              direction,
              donem,
              limit: 500,
            },
            'scheduler',
          );
          if (direction === 'ALIS') alisOk++;
          else satisOk++;
        } catch (err: any) {
          failed++;
          this.logger.warn(
            `[Tenant ${tenantId}] ${item.provider}/${item.taxpayerId}/${direction} hata: ${err?.message || err}`,
          );
        }
      }
    }

    this.logger.log(
      `[Tenant ${tenantId}] gece akışı bitti: alış=${alisOk}, satış=${satisOk}, hata=${failed}`,
    );
  }
}
