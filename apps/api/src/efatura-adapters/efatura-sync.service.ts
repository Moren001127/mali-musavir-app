import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getEFaturaAdapter, SUPPORTED_PROVIDERS } from './efatura-adapter.factory';
import { EFaturaCredentials } from './efatura-adapter.interface';
import { tryDecrypt } from '../common/crypto';

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
            where: { tenantId_taxpayerId_entegrator_uuid: { tenantId, taxpayerId, entegrator: providerUpper, uuid: inv.uuid } },
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
            // tenant+taxpayer scope: aynı UUID başka mükellefte de olabilir,
            // yalnız bu mükellefin satırları işaretlensin.
            where: { tenantId, taxpayerId, entegrator: providerUpper, uuid: { in: markedUuids } },
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
    opts: { taxpayerId?: string; direction?: string; period?: string; channel?: string; limit?: string } = {},
  ) {
    const where: Record<string, any> = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.direction) where.direction = opts.direction.toUpperCase();
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (opts.period) {
      const start = new Date(`${opts.period}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      periodStart = start;
      periodEnd = end;
      if (!opts.channel) where.faturaDate = { gte: start, lt: end };
    }
    const limit = Math.min(parseInt(opts.limit || '200', 10) || 200, 1000);
    const take = opts.channel ? Math.min(limit * 3, 3000) : limit;
    const rows = await (this.prisma as any).eFaturaInbox.findMany({
      where,
      orderBy: { syncedAt: 'desc' },
      take,
      select: {
        id: true, entegrator: true, uuid: true, faturaNo: true, faturaDate: true,
        senderVkn: true, senderTitle: true, receiverVkn: true,
        matrah: true, kdv: true, toplam: true, paraBirimi: true,
        direction: true, invoiceProfile: true, isTransferred: true, documentId: true,
        rawJson: true, markedAt: true, processedAt: true, syncedAt: true,
      },
    });
    const channel = String(opts.channel || '').toUpperCase();
    return rows
      .filter((row: any) => {
        const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        if (channel && String(raw?.channel || '').toUpperCase() !== channel) return false;
        if (periodStart && periodEnd) {
          const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
          const dateMatches = rowDate && rowDate >= periodStart && rowDate < periodEnd;
          const rawPeriodMatches = String(raw?.period || '') === opts.period;
          if (!dateMatches && !rawPeriodMatches) return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  /**
   * Bir tenant altındaki tüm entegratör bağlantılarını sync et.
   * Kimlik bilgileri config.taxpayers[key] içinde şifreli saklanır —
   * tryDecrypt ile açılarak adapter'a iletilir.
   */
  async syncAll(
    tenantId: string,
    opts: { direction?: 'IN' | 'OUT' } = {},
  ): Promise<{ added: number; skipped: number; errors: string[]; connections: number }> {
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        isActive: true,
        provider: { in: SUPPORTED_PROVIDERS },
      },
    });

    let totalAdded = 0;
    let totalSkipped = 0;
    const totalErrors: string[] = [];

    for (const conn of connections) {
      const cfg: any = conn.config || {};
      const taxpayers: Record<string, any> = cfg.taxpayers || {};

      const entries = Object.entries(taxpayers).filter(([k, v]) => v && k !== 'global');

      if (entries.length > 0) {
        for (const [taxpayerId, tpCfg] of entries) {
          const tp: any = tpCfg || {};
          const credentials: EFaturaCredentials = {
            username: tp.username || '',
            password: tryDecrypt(tp.encryptedPassword) || '',
            apiKey: tryDecrypt(tp.encryptedApiKey) || '',
            apiSecret: tryDecrypt(tp.encryptedApiSecret) || '',
            baseUrl: tp.baseUrl || cfg.baseUrl || '',
            firmaNo: tp.firmaNo || cfg.firmaNo || '',
          };
          const r = await this.syncTaxpayer(tenantId, taxpayerId, conn.provider, credentials, opts);
          totalAdded += r.added;
          totalSkipped += r.skipped;
          totalErrors.push(...r.errors);
        }
      } else {
        const global: any = taxpayers.global || {};
        const credentials: EFaturaCredentials = {
          username: global.username || '',
          password: tryDecrypt(global.encryptedPassword) || '',
          apiKey: tryDecrypt(global.encryptedApiKey) || '',
          apiSecret: tryDecrypt(global.encryptedApiSecret) || '',
          baseUrl: global.baseUrl || cfg.baseUrl || '',
          firmaNo: global.firmaNo || cfg.firmaNo || '',
        };
        const r = await this.syncTaxpayer(tenantId, 'global', conn.provider, credentials, opts);
        totalAdded += r.added;
        totalSkipped += r.skipped;
        totalErrors.push(...r.errors);
      }
    }

    return { added: totalAdded, skipped: totalSkipped, errors: totalErrors, connections: connections.length };
  }
}
