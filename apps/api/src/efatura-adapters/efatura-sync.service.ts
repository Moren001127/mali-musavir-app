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
      const match = String(opts.period).match(/^(\d{4})-(\d{2})$/);
      const year = match ? Number(match[1]) : Number.NaN;
      const month = match ? Number(match[2]) : Number.NaN;
      const start = Number.isFinite(year) && Number.isFinite(month)
        ? new Date(Date.UTC(year, month - 1, 1))
        : new Date(`${opts.period}-01T00:00:00.000Z`);
      const end = Number.isFinite(year) && Number.isFinite(month)
        ? new Date(Date.UTC(year, month, 1))
        : new Date(start);
      if (!Number.isFinite(year) || !Number.isFinite(month)) end.setUTCMonth(end.getUTCMonth() + 1);
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
        ublXmlRaw: true, rawJson: true, markedAt: true, processedAt: true, syncedAt: true,
      },
    });
    const isSyntheticTurmobInboxXml = (xml: any) => {
      const text = String(xml || '').trim();
      if (!text) return false;
      return /<cbc:Note>\s*TURMOB_SUMMARY_ONLY\s*<\/cbc:Note>/i.test(text)
        || /<cbc:Name>\s*TURMOB_LISTE_OZETI\s*<\/cbc:Name>/i.test(text)
        || /<cbc:ID>\s*TURMOB-SUMMARY/i.test(text)
        || /<Item>\s*<Name>Fatura satiri<\/Name>\s*<\/Item>/i.test(text)
        || (/<Invoice>\s*<ProfileID>/i.test(text) && !/\sxmlns[:=]/i.test(text));
    };
    const missingOriginalDocument = (row: any) => {
      if (String(row?.entegrator || '').toUpperCase() !== 'TURMOB_EFATURA') return false;
      const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
      const downloadStatus = String(raw?.documentDownloadStatus || '').toUpperCase();
      const visual = raw?.originalVisual && typeof raw.originalVisual === 'object' ? raw.originalVisual : null;
      const visualHtml = String(visual?.html || '');
      const fakeTurmobVisual = /TURMOB liste verisiyle|Orijinal belge goruntusu indirilemedi|Fatura satiri/i.test(visualHtml);
      const hasOriginalVisual = !!visual && (
        (/pdf/i.test(String(visual.mimeType || '')) && Boolean(visual.base64)) ||
        (/html/i.test(String(visual.mimeType || '')) && Boolean(visual.html) && !fakeTurmobVisual)
      );
      return downloadStatus === 'MISSING'
        || downloadStatus === 'SUMMARY_ONLY'
        || fakeTurmobVisual
        || isSyntheticTurmobInboxXml(row?.ublXmlRaw)
        || (!!row?.ublXmlRaw && !hasOriginalVisual);
    };
    const docIds = [...new Set(rows.map((row: any) => String(row.documentId || '').trim()).filter(Boolean))];
    let existingDocIds = new Set<string>();
    if (docIds.length) {
      const docWhere: any = { tenantId, id: { in: docIds } };
      if (opts.taxpayerId) docWhere.taxpayerId = opts.taxpayerId;
      const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: docWhere,
        select: { id: true, source: true, sourceRefId: true },
      });
      existingDocIds = new Set(docs.map((doc: any) => String(doc.id)));
    }

    const staleRows = rows.filter((row: any) => (
      (row.documentId && !existingDocIds.has(String(row.documentId))) ||
      (!row.documentId && (row.isTransferred || row.processedAt)) ||
      (missingOriginalDocument(row) && (row.documentId || row.isTransferred || row.processedAt))
    ));
    if (staleRows.length) {
      await (this.prisma as any).eFaturaInbox.updateMany({
        where: { tenantId, id: { in: staleRows.map((row: any) => row.id) } },
        data: { documentId: null, isTransferred: false, processedAt: null },
      });
    }
    const staleIds = new Set(staleRows.map((row: any) => row.id));

    const channel = String(opts.channel || '').toUpperCase();
    return rows
      .filter((row: any) => {
        const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        if (channel && String(raw?.channel || '').toUpperCase() !== channel) return false;
        if (periodStart && periodEnd) {
          const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
          const validRowDate = rowDate && !Number.isNaN(rowDate.getTime());
          const dateMatches = validRowDate && rowDate >= periodStart && rowDate < periodEnd;
          const rawPeriodMatches = String(raw?.period || '') === opts.period;
          if (validRowDate ? !dateMatches : !rawPeriodMatches) return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((row: any) => {
        const linkedDocId = row.documentId && existingDocIds.has(String(row.documentId)) ? String(row.documentId) : null;
        const hasAccountingDocument = !!linkedDocId;
        if (staleIds.has(row.id) || missingOriginalDocument(row)) {
          return { ...row, documentId: null, isTransferred: false, processedAt: null, hasAccountingDocument: false };
        }
        return { ...row, documentId: linkedDocId || null, isTransferred: hasAccountingDocument, hasAccountingDocument };
      });
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
