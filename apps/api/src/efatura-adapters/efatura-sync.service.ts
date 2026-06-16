import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getEFaturaAdapter, SUPPORTED_PROVIDERS } from './efatura-adapter.factory';
import { EFaturaCredentials } from './efatura-adapter.interface';

@Injectable()
export class EFaturaSyncService {
  private readonly logger = new Logger(EFaturaSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir mükellef + entegratör için delta sync çalıştır.
   * Yeni faturalar efatura_inbox tablosuna yazılır, mevcut olanlar atlanır.
   * Döner: kaç fatura yeni eklendi
   */
  async syncTaxpayer(
    tenantId: string,
    taxpayerId: string,
    provider: string,
    credentials: EFaturaCredentials,
    opts: { direction?: 'IN' | 'OUT'; limit?: number } = {},
  ): Promise<{ added: number; skipped: number; errors: string[] }> {
    const adapter = getEFaturaAdapter(provider);
    if (!adapter) {
      return { added: 0, skipped: 0, errors: [`Adapter bulunamadi: ${provider}`] };
    }

    const providerUpper = provider.toUpperCase();
    const direction = opts.direction || 'IN';
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // son 30 gün

      const { invoices } = await adapter.fetchInvoices(credentials, {
        direction,
        startDate,
        limit: opts.limit || 100,
      });

      const markedUuids: string[] = [];

      for (const inv of invoices) {
        if (!inv.uuid) continue;
        try {
          await (this.prisma as any).eFaturaInbox.upsert({
            where: { entegrator_uuid: { entegrator: providerUpper, uuid: inv.uuid } },
            create: {
              tenantId,
              taxpayerId,
              entegrator: providerUpper,
              uuid: inv.uuid,
              ettn: inv.ettn,
              senderVkn: inv.senderVkn,
              senderTitle: inv.senderTitle,
              receiverVkn: inv.receiverVkn,
              faturaNo: inv.faturaNo,
              faturaDate: inv.faturaDate,
              matrah: inv.matrah != null ? String(inv.matrah) : null,
              kdv: inv.kdv != null ? String(inv.kdv) : null,
              toplam: inv.toplam != null ? String(inv.toplam) : null,
              paraBirimi: inv.paraBirimi || 'TRY',
              direction,
              invoiceProfile: inv.invoiceProfile,
              ublXmlRaw: inv.ublXmlRaw,
              rawJson: inv.rawJson || {},
            },
            update: {}, // zaten varsa hiçbir şeyi değiştirme
          });
          added++;
          markedUuids.push(inv.uuid);
        } catch (err: any) {
          if (err?.code === 'P2002') {
            skipped++; // unique constraint — zaten var
          } else {
            errors.push(`${inv.uuid}: ${err?.message}`);
          }
        }
      }

      // Entegratöre "aktarıldı" bayrağı at — Delta sync için kritik
      if (markedUuids.length > 0) {
        try {
          await adapter.markAsTransferred(credentials, markedUuids);
          await (this.prisma as any).eFaturaInbox.updateMany({
            where: { entegrator: providerUpper, uuid: { in: markedUuids } },
            data: { markedAt: new Date() },
          });
        } catch (markErr: any) {
          this.logger.warn(`${provider} mark hatasi: ${markErr?.message}`);
        }
      }

      this.logger.log(
        `[${provider}/${taxpayerId}] sync: ${added} yeni, ${skipped} mevcut, ${errors.length} hata`,
      );
    } catch (err: any) {
      errors.push(err?.message || String(err));
      this.logger.error(`[${provider}/${taxpayerId}] sync genel hata: ${err?.message}`);
    }

    return { added, skipped, errors };
  }

  /**
   * efatura_inbox listesi — mükellef/dönem bazlı filtre destekli
   */
  async listInbox(
    tenantId: string,
    opts: { taxpayerId?: string; direction?: string; period?: string; limit?: string } = {},
  ) {
    const where: Record<string, any> = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.direction) where.direction = opts.direction.toUpperCase();
    if (opts.period) {
      const start = new Date(`${opts.period}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.faturaDate = { gte: start, lt: end };
    }
    const limit = Math.min(parseInt(opts.limit || '200', 10) || 200, 1000);
    return (this.prisma as any).eFaturaInbox.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, entegrator: true, uuid: true, faturaNo: true, faturaDate: true,
        senderVkn: true, senderTitle: true, receiverVkn: true,
        matrah: true, kdv: true, toplam: true, paraBirimi: true,
        direction: true, invoiceProfile: true, markedAt: true, createdAt: true,
      },
    });
  }

  /**
   * Bir tenant altındaki tüm entegratör bağlantılarını sync et.
   */
  async syncAll(tenantId: string, opts: { direction?: 'IN' | 'OUT' } = {}): Promise<void> {
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        isActive: true,
        provider: { in: SUPPORTED_PROVIDERS },
      },
    });

    for (const conn of connections) {
      const cfg: any = conn.config || {};
      const credentials: EFaturaCredentials = {
        username: cfg.username || cfg.user,
        password: cfg.password || cfg.pass,
        apiKey: cfg.apiKey,
        apiSecret: cfg.apiSecret,
        baseUrl: cfg.baseUrl,
        firmaNo: cfg.firmaNo,
      };

      // Mükellef bazlı kimlik bilgileri varsa onları kullan
      const taxpayers: Record<string, any> = cfg.taxpayers || {};
      const hasTaxpayerCreds =
        Object.keys(taxpayers).filter((k) => k !== 'global').length > 0;

      if (hasTaxpayerCreds) {
        for (const [taxpayerId, tpCfg] of Object.entries(taxpayers)) {
          if (!tpCfg || taxpayerId === 'global') continue;
          const tpCredentials: EFaturaCredentials = {
            ...credentials,
            ...(typeof tpCfg === 'object' ? (tpCfg as Record<string, any>) : {}),
          };
          await this.syncTaxpayer(tenantId, taxpayerId, conn.provider, tpCredentials, opts);
        }
      } else {
        // Tek kimlik bilgisi, tüm mükellefler için
        await this.syncTaxpayer(tenantId, 'global', conn.provider, credentials, opts);
      }
    }
  }
}
