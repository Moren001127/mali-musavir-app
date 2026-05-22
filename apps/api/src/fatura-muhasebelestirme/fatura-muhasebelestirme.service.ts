import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService, OcrResult } from '../kdv-control/ocr';
import { EarsivRenderService } from '../earsiv/earsiv-render.service';
import { encrypt, tryDecrypt } from '../common/crypto';

type AccountingLineInput = {
  id?: string;
  group?: string;
  accountCode?: string | null;
  description?: string | null;
  rate?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
};

type UpdateDocumentInput = {
  taxpayerId?: string | null;
  documentType?: string;
  invoiceKind?: string;
  status?: string;
  currency?: string;
  exchangeRate?: string | number;
  belgeNo?: string | null;
  seriNo?: string | null;
  faturaTarihi?: string | null;
  sellerVkn?: string | null;
  buyerVkn?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  totalAmount?: string | number | null;
  lines?: AccountingLineInput[];
};

type AccountPlanQuery = {
  taxpayerId: string;
  q?: string;
  prefixes?: string[];
  limit?: number;
};

type PeriodQuery = {
  period?: string;
};

type DuplicateSignal = {
  duplicateOfId: string;
  duplicateReason: string;
  duplicateSeverity: 'WARNING' | 'BLOCKING';
} | null;

type IntegrationSaveInput = {
  provider?: string;
  taxpayerId?: string | null;
  label?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  username?: string | null;
  password?: string | null;
  senderVkn?: string | null;
  accountId?: string | null;
  note?: string | null;
  isActive?: boolean;
};

type IntegrationFetchInput = {
  taxpayerId?: string;
  donem?: string;
  direction?: 'ALIS' | 'SATIS';
  providers?: string[];
  limit?: number;
};

type RuntimeIntegrationConfig = {
  provider: string;
  label: string;
  baseUrl: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
  senderVkn: string;
  accountId: string;
  note: string;
};

type ProviderInvoicePayload = {
  xml: string;
  externalId?: string | null;
  originalName?: string | null;
  pdfBuffer?: Buffer | null;
  htmlContent?: string | null;
};

type ParsedProviderInvoice = {
  faturaNo: string;
  faturaTarihi: Date | null;
  ettn?: string | null;
  satici?: string | null;
  saticiVergiNo?: string | null;
  alici?: string | null;
  aliciVergiNo?: string | null;
  matrah?: number | null;
  kdvTutari?: number | null;
  kdvOrani?: number | null;
  toplamTutar?: number | null;
  paraBirimi?: string | null;
};

const INTEGRATOR_CATALOG = [
  { provider: 'LUCA', label: 'Luca', kind: 'luca', tone: 'green' },
  { provider: 'GIB_PORTAL', label: 'GIB Portal', kind: 'portal', tone: 'amber' },
  { provider: 'ELOGO', label: 'e-Logo', kind: 'efatura', tone: 'blue' },
  { provider: 'UYUMSOFT', label: 'Uyumsoft', kind: 'efatura', tone: 'blue' },
  { provider: 'MIKRO', label: 'Mikro', kind: 'efatura', tone: 'purple' },
  { provider: 'IZIBIZ', label: 'Izibiz', kind: 'efatura', tone: 'blue' },
  { provider: 'KOLAYSOFT', label: 'Kolaysoft', kind: 'efatura', tone: 'green' },
  { provider: 'FORIBA', label: 'Foriba', kind: 'efatura', tone: 'amber' },
  { provider: 'PARASUT', label: 'Parasut', kind: 'efatura', tone: 'purple' },
  { provider: 'LOGO_ISBASI', label: 'Logo Isbasi', kind: 'efatura', tone: 'gold' },
  { provider: 'TURMOB_EFATURA', label: 'TURMOB e-Fatura', kind: 'efatura', tone: 'red' },
] as const;

const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  UYUMSOFT: 'http://efatura.uyumsoft.com.tr/Services/BasicIntegration',
  IZIBIZ: 'https://efaturaws.izibiz.com.tr/EInvoiceWS',
};

const I2I_SOAP_PROVIDERS = new Set(['IZIBIZ', 'FORIBA']);

function parseDecimal(value: any, fallback = '0') {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(fallback);
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  return new Prisma.Decimal(normalized || fallback);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Prisma.Decimal(value.toFixed(2));
  }
  const raw = String(value).trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n.toFixed(2));
}

function periodRange(period?: string | null) {
  const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

function periodWhere(period?: string | null) {
  const range = periodRange(period);
  if (!range) return {};
  return {
    OR: [
      { faturaTarihi: { gte: range.start, lt: range.end } },
      { faturaTarihi: null, createdAt: { gte: range.start, lt: range.end } },
    ],
  };
}

@Injectable()
export class FaturaMuhasebelestirmeService {
  private readonly logger = new Logger(FaturaMuhasebelestirmeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly earsivRender: EarsivRenderService,
  ) {}

  async list(tenantId: string, opts: { status?: string; limit?: number; taxpayerId?: string; period?: string }) {
    // status='PENDING' frontend konvansiyonu = onaylanmamış belgeler (READY + NEEDS_REVIEW).
    // Schema status enum: NEEDS_REVIEW | READY | APPROVED | REJECTED
    const statusFilter = (() => {
      const s = String(opts.status || '').toUpperCase();
      if (!s) return {};
      if (s === 'PENDING' || s === 'PROCESSING') {
        return { status: { in: ['READY', 'NEEDS_REVIEW'] } };
      }
      return { status: s };
    })();

    return (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId,
        ...statusFilter,
        ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
        ...periodWhere(opts.period),
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.limit || 100, 1), 500),
    });
  }

  async dashboard(tenantId: string, opts: PeriodQuery = {}) {
    const [taxpayers, grouped] = await Promise.all([
      (this.prisma as any).taxpayer.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          companyName: true,
          firstName: true,
          lastName: true,
          defterTuru: true,
          mihsapDefterTuru: true,
        },
      }),
      (this.prisma as any).invoiceAccountingDocument.groupBy({
        by: ['taxpayerId', 'invoiceKind', 'status'],
        where: { tenantId, taxpayerId: { not: null }, ...periodWhere(opts.period) },
        _count: { _all: true },
      }),
    ]);

    const counters = new Map<string, any>();
    for (const row of grouped) {
      const taxpayerId = row.taxpayerId || 'general';
      const current = counters.get(taxpayerId) || {
        pendingPurchase: 0,
        pendingSale: 0,
        pendingBank: 0,
        approvedInvoice: 0,
        approvedBank: 0,
      };
      const count = row._count?._all || 0;
      if (row.status === 'APPROVED') current.approvedInvoice += count;
      else if (row.invoiceKind === 'SATIS') current.pendingSale += count;
      else current.pendingPurchase += count;
      counters.set(taxpayerId, current);
    }

    const rows = taxpayers.map((tp: any) => {
      const counts = counters.get(tp.id) || {
        pendingPurchase: 0,
        pendingSale: 0,
        pendingBank: 0,
        approvedInvoice: 0,
        approvedBank: 0,
      };
      return {
        taxpayerId: tp.id,
        name: tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || 'Adsız mükellef',
        ledgerType: tp.defterTuru || tp.mihsapDefterTuru || '-',
        ...counts,
        totalPending: counts.pendingPurchase + counts.pendingSale + counts.pendingBank,
      };
    });

    return {
      rows,
      totals: rows.reduce(
        (acc: any, row: any) => ({
          pendingPurchase: acc.pendingPurchase + row.pendingPurchase,
          pendingSale: acc.pendingSale + row.pendingSale,
          pendingBank: acc.pendingBank + row.pendingBank,
          approvedInvoice: acc.approvedInvoice + row.approvedInvoice,
          approvedBank: acc.approvedBank + row.approvedBank,
        }),
        { pendingPurchase: 0, pendingSale: 0, pendingBank: 0, approvedInvoice: 0, approvedBank: 0 },
      ),
    };
  }

  async listIntegrations(tenantId: string, opts: { taxpayerId?: string | null } = {}) {
    const rows = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        provider: { in: INTEGRATOR_CATALOG.map((item) => item.provider) as any },
      },
      select: {
        id: true,
        provider: true,
        config: true,
        isActive: true,
        lastSyncAt: true,
        updatedAt: true,
      },
    });
    const byProvider = new Map<string, any>(rows.map((row: any) => [String(row.provider), row]));
    const taxpayerKey = opts.taxpayerId || 'global';

    return INTEGRATOR_CATALOG.map((item) => {
      const row = byProvider.get(item.provider);
      const config = (row?.config || {}) as any;
      const taxpayerConfig = config.taxpayers?.[taxpayerKey] || config.taxpayers?.global || null;
      const configured = Boolean(
        taxpayerConfig?.hasApiKey ||
          taxpayerConfig?.hasApiSecret ||
          taxpayerConfig?.hasPassword ||
          taxpayerConfig?.username ||
          taxpayerConfig?.baseUrl ||
          taxpayerConfig?.senderVkn,
      );
      return {
        provider: item.provider,
        label: config.label || item.label,
        kind: item.kind,
        tone: item.tone,
        isActive: row?.isActive !== false && taxpayerConfig?.isActive !== false,
        configured,
        taxpayerScoped: Boolean(config.taxpayers?.[taxpayerKey]),
        baseUrl: taxpayerConfig?.baseUrl || '',
        username: taxpayerConfig?.username || '',
        senderVkn: taxpayerConfig?.senderVkn || '',
        accountId: taxpayerConfig?.accountId || '',
        note: taxpayerConfig?.note || '',
        hasApiKey: Boolean(taxpayerConfig?.hasApiKey),
        hasApiSecret: Boolean(taxpayerConfig?.hasApiSecret),
        hasPassword: Boolean(taxpayerConfig?.hasPassword),
        // v2: Talimat — otomatik gece çekim aktif mi?
        talimat: Boolean(taxpayerConfig?.talimat),
        talimatUpdatedAt: taxpayerConfig?.talimatUpdatedAt || null,
        lastSyncAt: row?.lastSyncAt || null,
        updatedAt: taxpayerConfig?.updatedAt || row?.updatedAt || null,
      };
    });
  }

  /**
   * Talimat ver/kaldır — config.taxpayers[key].talimat alanını günceller.
   * Aktif olduğunda scheduler her gece son 9 günün faturalarını çeker.
   */
  async setIntegrationTalimat(
    tenantId: string,
    input: { taxpayerId?: string | null; provider?: string; active?: boolean },
  ) {
    const provider = String(input.provider || '').trim().toUpperCase();
    if (!provider) throw new BadRequestException('Sağlayıcı belirtilmedi');
    const taxpayerKey = input.taxpayerId || 'global';
    const active = input.active === undefined ? true : Boolean(input.active);

    const existing = await (this.prisma as any).integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!existing) throw new BadRequestException('Entegratör tanımlı değil. Önce kaydet.');

    const config = (existing.config || {}) as any;
    config.taxpayers = config.taxpayers || {};
    config.taxpayers[taxpayerKey] = {
      ...(config.taxpayers[taxpayerKey] || {}),
      talimat: active,
      talimatUpdatedAt: new Date().toISOString(),
    };

    await (this.prisma as any).integrationConnection.update({
      where: { tenantId_provider: { tenantId, provider } },
      data: { config },
    });
    return { ok: true, provider, taxpayerId: input.taxpayerId || null, talimat: active };
  }

  /**
   * Bir mukellef için bir entegratör kaydını siler.
   * Tüm mukellef kayıtları silinmişse satırı tamamen kaldır.
   */
  async deleteIntegration(
    tenantId: string,
    input: { taxpayerId?: string | null; provider?: string },
  ) {
    const provider = String(input.provider || '').trim().toUpperCase();
    if (!provider) throw new BadRequestException('Sağlayıcı belirtilmedi');
    const taxpayerKey = input.taxpayerId || 'global';

    const existing = await (this.prisma as any).integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!existing) return { ok: true, deleted: false };

    const config = (existing.config || {}) as any;
    if (config.taxpayers && config.taxpayers[taxpayerKey]) {
      delete config.taxpayers[taxpayerKey];
    }

    const remaining = Object.keys(config.taxpayers || {});
    if (remaining.length === 0) {
      await (this.prisma as any).integrationConnection.delete({
        where: { tenantId_provider: { tenantId, provider } },
      });
    } else {
      await (this.prisma as any).integrationConnection.update({
        where: { tenantId_provider: { tenantId, provider } },
        data: { config },
      });
    }
    return { ok: true, deleted: true };
  }

  /**
   * Fatura Merkezi v2'nin Genel Bakış kartlarında kullanılan kısa özet.
   * Dashboard'dan daha hafif — tek scan, agresif filter.
   */
  async summary(
    tenantId: string,
    opts: { period?: string; taxpayerId?: string } = {},
  ) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    // InvoiceAccountingDocument'ta `period` kolonu yok — faturaTarihi(YYYY-MM) üzerinden.
    if (opts.period && /^\d{4}-\d{2}$/.test(opts.period)) {
      const [y, m] = opts.period.split('-').map((n) => parseInt(n, 10));
      const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      where.OR = [
        { faturaTarihi: { gte: start, lt: end } },
        { AND: [{ faturaTarihi: null }, { createdAt: { gte: start, lt: end } }] },
      ];
    }

    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where,
      // v2.2: validationStatus select'i raw query ile yaparız, Prisma client tanımıyor olabilir
      select: { status: true, lucaStatus: true, ocrStatus: true, taxpayerId: true, ocrData: true },
    });

    // v2.2: Mukellef bağlantısı + validation durumu ayrı sayılır
    let pending = 0, approved = 0, errors = 0, posted = 0, ocrInProgress = 0;
    let pendingWithTaxpayer = 0;  // perTaxpayerSummary'de gözükenler
    let orphanCount = 0;          // taxpayerId null/empty
    let invalidCount = 0;         // validation INVALID/INCOMPLETE
    for (const d of docs) {
      const status = String(d.status || '').toUpperCase();
      const isPending = status === 'READY' || status === 'NEEDS_REVIEW' || status === 'PENDING' || status === 'PROCESSING';
      const hasTaxpayer = !!d.taxpayerId;

      if (isPending) {
        pending++;
        if (hasTaxpayer) pendingWithTaxpayer++;
      }
      if (status === 'APPROVED') approved++;
      if (status === 'REJECTED' || status === 'ERROR') errors++;
      if (d.lucaStatus === 'POSTED') posted++;
      if (d.ocrStatus === 'IN_PROGRESS' || d.ocrStatus === 'PENDING') ocrInProgress++;

      if (!hasTaxpayer) orphanCount++;
      // ocrData içindeki validationStatus'a düş — ana kolon henüz yok olabilir
      const vStatus = (d as any).ocrData?.validationStatus;
      if (vStatus === 'INVALID' || vStatus === 'INCOMPLETE') invalidCount++;
    }

    return {
      total: docs.length,
      pending,
      // Sidebar'da gösterilen: gerçekten mukellefe bağlı bekleyenler
      pendingWithTaxpayer,
      // Mukellef seçilmediği için tabloda görünmeyen belgeler
      orphanCount,
      // Validation hatası olan belgeler
      invalidCount,
      approved,
      errors,
      posted,
      ocrInProgress,
      processedRate: docs.length ? Math.round((approved / docs.length) * 100) : 0,
      approvalRate: docs.length ? Math.round((approved / Math.max(1, approved + pending)) * 100) : 0,
      postedRate: approved ? Math.round((posted / approved) * 100) : 0,
      openPeriods: 0,
    };
  }

  /**
   * Her mukellef için bekleyen/onaylanan/banka sayılarını tek scan'de döner.
   * Mihsap'ın "Gelen Belgeler" tablosunda gösterdiği verinin karşılığı.
   */
  async perTaxpayerSummary(
    tenantId: string,
    opts: { period?: string } = {},
  ) {
    const where: any = { tenantId };
    // InvoiceAccountingDocument'ta `period` kolonu yok — faturaTarihi'nin YYYY-MM
    // dilimi üzerinden filtrele. Tarih yoksa createdAt'i fallback olarak değerlendir.
    if (opts.period && /^\d{4}-\d{2}$/.test(opts.period)) {
      const [y, m] = opts.period.split('-').map((n) => parseInt(n, 10));
      const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      where.OR = [
        { faturaTarihi: { gte: start, lt: end } },
        { AND: [{ faturaTarihi: null }, { createdAt: { gte: start, lt: end } }] },
      ];
    }

    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where,
      // v2.2: validationStatus yerine ocrData içinden okuyoruz — Prisma client tanımıyor olabilir
      select: {
        taxpayerId: true,
        status: true,
        invoiceKind: true,
        documentType: true,
        lucaStatus: true,
        ocrData: true,
      },
    });

    const byTaxpayer = new Map<string, any>();
    for (const d of docs) {
      if (!d.taxpayerId) continue;
      const entry = byTaxpayer.get(d.taxpayerId) || {
        taxpayerId: d.taxpayerId,
        pendingAlis: 0,
        pendingSatis: 0,
        pendingBanka: 0,
        approvedAlis: 0,
        approvedSatis: 0,
        approvedBanka: 0,
        postedToLuca: 0,
        hasIssue: 0,            // v2.1: validation hatası olan belge sayısı
      };
      const isBank = (d.documentType || '').toUpperCase().includes('BANKA');
      const isAlis = String(d.invoiceKind || '').toUpperCase().startsWith('ALI');
      // Schema status: NEEDS_REVIEW | READY | APPROVED | REJECTED
      // "Bekleyen" = henüz onaylanmamış / yevmiyeye atılmamış (READY + NEEDS_REVIEW)
      const status = String(d.status || '').toUpperCase();
      const pending = status === 'READY' || status === 'NEEDS_REVIEW' || status === 'PENDING' || status === 'PROCESSING';
      const approved = status === 'APPROVED';

      if (pending) {
        if (isBank) entry.pendingBanka++;
        else if (isAlis) entry.pendingAlis++;
        else entry.pendingSatis++;
      } else if (approved) {
        if (isBank) entry.approvedBanka++;
        else if (isAlis) entry.approvedAlis++;
        else entry.approvedSatis++;
      }

      if (d.lucaStatus === 'POSTED') entry.postedToLuca++;
      const vStatus = (d as any).ocrData?.validationStatus;
      if (vStatus === 'INVALID' || vStatus === 'INCOMPLETE') entry.hasIssue++;
      byTaxpayer.set(d.taxpayerId, entry);
    }

    return Array.from(byTaxpayer.values());
  }

  async saveIntegration(tenantId: string, input: IntegrationSaveInput, updatedBy?: string) {
    const provider = String(input.provider || '').trim().toUpperCase();
    const catalog = INTEGRATOR_CATALOG.find((item) => item.provider === provider);
    if (!catalog) throw new BadRequestException('Desteklenmeyen entegrator');

    const taxpayerKey = input.taxpayerId || 'global';
    const existing = await (this.prisma as any).integrationConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
      select: { config: true },
    });
    const currentConfig = ((existing?.config || {}) as any) || {};
    const currentTaxpayer = currentConfig.taxpayers?.[taxpayerKey] || {};

    const apiKey = String(input.apiKey || '').trim();
    const apiSecret = String(input.apiSecret || '').trim();
    const password = String(input.password || '');
    const nextTaxpayer: any = {
      ...currentTaxpayer,
      taxpayerId: input.taxpayerId || null,
      label: String(input.label || catalog.label).trim(),
      baseUrl: String(input.baseUrl || currentTaxpayer.baseUrl || '').trim(),
      username: String(input.username || currentTaxpayer.username || '').trim(),
      senderVkn: String(input.senderVkn || currentTaxpayer.senderVkn || '').trim(),
      accountId: String(input.accountId || currentTaxpayer.accountId || '').trim(),
      note: String(input.note || currentTaxpayer.note || '').trim(),
      isActive: input.isActive !== false,
      hasApiKey: apiKey ? true : Boolean(currentTaxpayer.hasApiKey),
      hasApiSecret: apiSecret ? true : Boolean(currentTaxpayer.hasApiSecret),
      hasPassword: password ? true : Boolean(currentTaxpayer.hasPassword),
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    };
    if (apiKey) nextTaxpayer.encryptedApiKey = encrypt(apiKey);
    if (apiSecret) nextTaxpayer.encryptedApiSecret = encrypt(apiSecret);
    if (password) nextTaxpayer.encryptedPassword = encrypt(password);

    const config = {
      version: 1,
      provider,
      label: String(input.label || currentConfig.label || catalog.label).trim(),
      kind: catalog.kind,
      taxpayers: {
        ...(currentConfig.taxpayers || {}),
        [taxpayerKey]: nextTaxpayer,
      },
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    };

    await (this.prisma as any).integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      update: { config, isActive: input.isActive !== false },
      create: { tenantId, provider, config, isActive: input.isActive !== false },
    });

    const [saved] = await this.listIntegrations(tenantId, { taxpayerId: input.taxpayerId || null });
    const all = await this.listIntegrations(tenantId, { taxpayerId: input.taxpayerId || null });
    return all.find((item) => item.provider === provider) || saved;
  }

  async fetchConfiguredIntegrations(
    tenantId: string,
    input: IntegrationFetchInput,
    userId?: string,
  ) {
    const taxpayerId = String(input.taxpayerId || '').trim();
    if (!taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const direction = input.direction === 'SATIS' ? 'SATIS' : 'ALIS';
    const period = this.monthRange(input.donem);
    const limit = Math.min(Math.max(Number(input.limit || 500), 1), 1000);
    const requestedProviders = new Set(
      (input.providers || [])
        .map((p) => String(p || '').trim().toUpperCase())
        .filter(Boolean),
    );

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
        identityNumber: true,
      },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const rows = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        provider: {
          in: INTEGRATOR_CATALOG.filter((item) => item.provider !== 'LUCA').map((item) => item.provider) as any,
        },
      },
      select: { id: true, provider: true, config: true, isActive: true },
    });
    const byProvider = new Map<string, any>(rows.map((row: any) => [String(row.provider), row]));
    const providers = INTEGRATOR_CATALOG.filter((item) => {
      if (item.provider === 'LUCA') return false;
      if (requestedProviders.size && !requestedProviders.has(item.provider)) return false;
      return true;
    });

    const statuses: any[] = [];
    const totals = { created: 0, alreadyQueued: 0, failed: 0, skipped: 0, fetched: 0 };

    for (const item of providers) {
      const row = byProvider.get(item.provider);
      const cfg = this.resolveRuntimeConfig(row, item, taxpayerId);
      if (!row || !cfg) {
        totals.skipped++;
        statuses.push({ provider: item.provider, label: item.label, status: 'SKIPPED', reason: 'API kaydi yok' });
        continue;
      }
      if (row.isActive === false || cfg.note === '__inactive__') {
        totals.skipped++;
        statuses.push({ provider: item.provider, label: cfg.label, status: 'SKIPPED', reason: 'Pasif' });
        continue;
      }
      if (cfg.provider === 'GIB_PORTAL' && !cfg.baseUrl) {
        totals.skipped++;
        statuses.push({
          provider: item.provider,
          label: cfg.label,
          status: 'SKIPPED',
          reason: 'GIB Portal icin resmi API yok; API adresi veya portal ajani gerekir',
        });
        continue;
      }
      const credentialCheck = this.providerCredentialProblem(cfg);
      if (credentialCheck) {
        totals.skipped++;
        statuses.push({ provider: item.provider, label: cfg.label, status: 'SKIPPED', reason: credentialCheck });
        continue;
      }

      const job = await (this.prisma as any).integrationJob.create({
        data: {
          connectionId: row.id,
          jobType: 'INVOICE_FETCH',
          status: 'RUNNING',
          attempts: 1,
          startedAt: new Date(),
          payload: {
            taxpayerId,
            direction,
            donem: period.donem,
            startDate: period.startDate,
            endDate: period.endDate,
            limit,
          },
        },
        select: { id: true },
      });

      try {
        const payloads = await this.fetchProviderInvoices(cfg, {
          taxpayer,
          direction,
          period,
          limit,
        });
        let created = 0;
        let alreadyQueued = 0;
        let failed = 0;
        const errors: Array<{ ref: string; message: string }> = [];
        for (const payload of payloads) {
          try {
            const result = await this.createDocumentFromProviderXml(
              tenantId,
              userId,
              taxpayer,
              cfg,
              direction,
              payload,
            );
            if (result.created) created++;
            else alreadyQueued++;
          } catch (e: any) {
            failed++;
            if (errors.length < 10) {
              errors.push({ ref: payload.externalId || payload.originalName || '-', message: e?.message || 'parse hatasi' });
            }
          }
        }
        totals.created += created;
        totals.alreadyQueued += alreadyQueued;
        totals.failed += failed;
        totals.fetched += payloads.length;
        await (this.prisma as any).integrationConnection.update({
          where: { id: row.id },
          data: { lastSyncAt: new Date() },
        });
        await (this.prisma as any).integrationJob.update({
          where: { id: job.id },
          data: {
            status: failed && !created && !alreadyQueued ? 'FAILED' : 'SUCCESS',
            completedAt: new Date(),
            result: { fetched: payloads.length, created, alreadyQueued, failed, errors },
            errorMessage: failed && errors.length ? errors[0].message : null,
          },
        });
        statuses.push({
          provider: item.provider,
          label: cfg.label,
          status: failed && !created && !alreadyQueued ? 'FAILED' : 'SUCCESS',
          fetched: payloads.length,
          created,
          alreadyQueued,
          failed,
          errors,
        });
      } catch (e: any) {
        totals.failed++;
        const message = e?.message || 'entegrator cekme hatasi';
        await (this.prisma as any).integrationJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', completedAt: new Date(), errorMessage: message },
        });
        statuses.push({ provider: item.provider, label: cfg.label, status: 'FAILED', reason: message });
      }
    }

    if (totals.created > 0) {
      const latest = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
        where: { tenantId, taxpayerId, status: 'READY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (latest?.id) {
        await this.rematchPendingDocumentsWithAccountPlan(tenantId, taxpayerId, latest.id);
      }
    }

    return {
      ok: true,
      taxpayerId,
      direction,
      donem: period.donem,
      ...totals,
      providers: statuses,
    };
  }

  async accountPlan(tenantId: string, opts: AccountPlanQuery) {
    if (!opts.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const latest = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: {
        tenantId,
        taxpayerId: opts.taxpayerId,
        status: 'READY',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sourceJobId: true, accountCount: true, createdAt: true },
    });
    if (!latest) return { source: null, accounts: [] };

    const where: any = { snapshotId: latest.id };
    const filters: any[] = [];
    const q = opts.q?.trim();
    if (q) {
      filters.push(
        { accountCode: { contains: q, mode: 'insensitive' } },
        { accountName: { contains: q, mode: 'insensitive' } },
      );
    }
    if (opts.prefixes?.length) {
      filters.push(...opts.prefixes.map((p) => ({ accountCode: { startsWith: p } })));
    }
    if (filters.length) where.OR = filters;

    const rows = await (this.prisma as any).lucaAccountPlanLine.findMany({
      where,
      orderBy: [{ accountCode: 'asc' }],
      take: Math.min(Math.max(opts.limit || 250, 1), 1000),
      select: {
        id: true,
        accountCode: true,
        accountName: true,
        level: true,
        debitBalance: true,
        creditBalance: true,
        source: true,
        syncedToLuca: true,
      },
    });
    const accounts = rows.map((r: any) => ({
      id: r.id,
      code: r.accountCode,
      name: r.accountName,
      level: r.level,
      debitBalance: Number(r.debitBalance || 0),
      creditBalance: Number(r.creditBalance || 0),
      // v2: Fatura Merkezi senkron rozeti
      local: r.source === 'LOCAL',
      syncedToLuca: r.syncedToLuca !== false,
    }));
    // Frontend bazı yerlerde sadece array bekliyor — geriye dönük uyumluluk için flat dön
    return Array.isArray(accounts) ? accounts : accounts;
  }

  /**
   * Yerelde yeni hesap aç. Mevcut snapshot'a ek satır olarak yazılır;
   * `accountCode`'lar arasına "LOCAL" prefix'i ile eklenir, böylece UI'da
   * "lokal, Luca'ya gönderilmemiş" olarak ayırt edilebilir.
   *
   * NOT: Tam Luca senkron bir sonraki sürümde tamamlanacak — şimdilik
   * yerel kayıt yapılır, push-to-luca placeholder olarak kuyruğa atar.
   */
  async createAccount(
    tenantId: string,
    input: { taxpayerId: string; code: string; name: string },
  ) {
    if (!input.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    if (!input.code?.trim()) throw new BadRequestException('Hesap kodu gerekli');
    if (!input.name?.trim()) throw new BadRequestException('Hesap adı gerekli');

    const latest = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId: input.taxpayerId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!latest) {
      throw new BadRequestException(
        'Önce Luca\'dan hesap planı çekilmeli (Hesap Planı dialog → Luca\'dan Çek).',
      );
    }

    // Lokal hesap olarak işaretle (Luca'ya henüz gönderilmedi)
    const created = await (this.prisma as any).lucaAccountPlanLine.create({
      data: {
        snapshotId: latest.id,
        accountCode: input.code.trim(),
        accountName: input.name.trim(),
        level: input.code.trim().split('.').length,
        debitBalance: 0,
        creditBalance: 0,
        source: 'LOCAL',
        syncedToLuca: false,
      },
    });

    return { ok: true, id: created.id, code: created.accountCode, name: created.accountName, local: true, syncedToLuca: false };
  }

  /**
   * Yerelde açılmış hesapları Luca'ya gönderir.
   * Şimdilik LucaFetchJob (tip=ACCOUNT_PLAN_PUSH) oluşturur; agent v2.2'de
   * bu job'u alıp Luca arayüzünden yeni hesap açacak.
   */
  async pushAccountPlanToLuca(
    tenantId: string,
    opts: { taxpayerId: string; createdBy?: string },
  ) {
    if (!opts.taxpayerId) throw new BadRequestException('taxpayerId gerekli');

    const latest = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId: opts.taxpayerId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latest) throw new BadRequestException('Hesap planı snapshot bulunamadı.');

    // Henüz Luca'ya senkron edilmemiş hesaplar
    const localItems = await (this.prisma as any).lucaAccountPlanLine.findMany({
      where: { snapshotId: latest.id, syncedToLuca: false },
      select: { id: true, accountCode: true, accountName: true },
    });

    if (localItems.length === 0) {
      return { ok: true, pushed: 0, message: 'Gönderilecek yeni hesap yok.' };
    }

    const job = await (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId,
        sessionId: null,
        mukellefId: opts.taxpayerId,
        donem: new Date().toISOString().slice(0, 7),
        tip: 'ACCOUNT_PLAN_PUSH',
        status: 'pending',
        createdBy: opts.createdBy || null,
        payload: { accounts: localItems } as any,
      },
    });

    return { ok: true, pushed: localItems.length, jobId: job.id };
  }

  async refreshAccountPlan(tenantId: string, opts: { taxpayerId: string; createdBy?: string; targetDeviceId?: string }) {
    if (!opts.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: opts.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');
    const mukellefAdi =
      taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') || taxpayer.id;
    const job = await (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId,
        sessionId: null,
        mukellefId: opts.taxpayerId,
        donem: new Date().toISOString().slice(0, 7),
        tip: 'ACCOUNT_PLAN',
        status: 'pending',
        createdBy: opts.createdBy || null,
        targetDeviceId: opts.targetDeviceId || null,
        errorMsg: `[META] mukellefAdi=${mukellefAdi}`,
      },
    });
    return { ok: true, job };
  }

  async importAccountPlanSnapshot(params: {
    tenantId: string;
    taxpayerId: string;
    jobId?: string;
    rows: Array<{
      hesapKodu: string;
      hesapAdi: string;
      seviye?: number;
      borcBakiye?: number;
      alacakBakiye?: number;
    }>;
    createdBy?: string;
  }) {
    if (!params.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const rows = (params.rows || [])
      .filter((r) => r.hesapKodu && /^\d/.test(String(r.hesapKodu)))
      .map((r) => ({
        accountCode: String(r.hesapKodu).trim(),
        accountName: String(r.hesapAdi || '').trim(),
        level: r.seviye || 0,
        debitBalance: new Prisma.Decimal(Number(r.borcBakiye || 0).toFixed(2)),
        creditBalance: new Prisma.Decimal(Number(r.alacakBakiye || 0).toFixed(2)),
      }));

    const snapshot = await (this.prisma as any).lucaAccountPlanSnapshot.create({
      data: {
        tenantId: params.tenantId,
        taxpayerId: params.taxpayerId,
        sourceJobId: params.jobId || null,
        status: 'READY',
        accountCount: rows.length,
        createdBy: params.createdBy || null,
      },
      select: { id: true },
    });
    if (rows.length) {
      await (this.prisma as any).lucaAccountPlanLine.createMany({
        data: rows.map((r) => ({ ...r, snapshotId: snapshot.id })),
      });
      await this.rematchPendingDocumentsWithAccountPlan(params.tenantId, params.taxpayerId, snapshot.id);
    }
    return { snapshotId: snapshot.id, accountCount: rows.length };
  }

  async duplicateCheck(tenantId: string, body: {
    taxpayerId?: string | null;
    belgeNo?: string | null;
    sellerVkn?: string | null;
    buyerVkn?: string | null;
    totalAmount?: string | number | null;
    imageHash?: string | null;
    excludeId?: string | null;
  }) {
    const match = await this.findDuplicate(tenantId, body, body.excludeId || undefined);
    return { duplicate: !!match, match };
  }

  async get(tenantId: string, id: string) {
    const doc = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    return doc;
  }

  async uploadAndOcr(
    tenantId: string,
    userId: string | undefined,
    files: Express.Multer.File[],
    opts: {
      taxpayerId?: string;
      source?: string;
      documentType?: string;
      invoiceKind?: string;
      forceClaude?: boolean;
    },
  ) {
    if (!files?.length) throw new BadRequestException('En az bir belge gerekli');
    const created: any[] = [];

    for (const file of files) {
      const ext = (file.originalname.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
      const s3Key = `invoice-accounting/${tenantId}/${opts.taxpayerId || 'general'}/${randomUUID()}.${ext}`;
      await this.storage.putBuffer(s3Key, file.buffer, file.mimetype, {
        'original-name': encodeURIComponent(file.originalname),
        'tenant-id': tenantId,
        source: opts.source || 'manual-web',
      });

      const isOcrSupported =
        file.mimetype.startsWith('image/') ||
        file.mimetype === 'application/pdf' ||
        file.mimetype.includes('xml') ||
        /\.xml$/i.test(file.originalname);
      let ocrResult: OcrResult | null = null;
      let ocrStatus = 'PENDING';
      if (isOcrSupported) {
        try {
          ocrResult = await this.ocr.extractFromImage(file.buffer, file.originalname, {
            forceClaude: opts.forceClaude,
          });
          ocrStatus = ocrResult.confidence >= 0.7 ? 'SUCCESS' : 'NEEDS_REVIEW';
        } catch (e: any) {
          ocrStatus = 'FAILED';
          ocrResult = {
            rawText: e?.message || 'OCR failed',
            belgeNo: null,
            date: null,
            kdvTutari: null,
            totalTutari: null,
            confidence: 0,
            fieldConfidence: { belgeNo: null, date: null, kdvTutari: null },
            engine: 'failed',
          };
        }
      }

      const lines = this.linesFromOcr(ocrResult);
      const imageHash = ocrResult?.imageHash || this.ocr.computeImageHash(file.buffer);
      const duplicate = await this.findDuplicate(tenantId, {
        taxpayerId: opts.taxpayerId || null,
        belgeNo: ocrResult?.belgeNo || null,
        sellerVkn: ocrResult?.saticiVkn || null,
        totalAmount: ocrResult?.totalTutari || null,
        imageHash,
      });
      const doc = await (this.prisma as any).invoiceAccountingDocument.create({
        data: {
          tenantId,
          taxpayerId: opts.taxpayerId || null,
          source: opts.source || 'manual-web',
          sourceRefId: null,
          documentType: opts.documentType || ocrResult?.belgeTipi || 'OKC_FIS',
          invoiceKind: opts.invoiceKind || 'ALIS',
          status: duplicate ? 'NEEDS_REVIEW' : ocrStatus === 'SUCCESS' ? 'READY' : 'NEEDS_REVIEW',
          duplicateOfId: duplicate?.duplicateOfId || null,
          duplicateReason: duplicate?.duplicateReason || null,
          duplicateSeverity: duplicate?.duplicateSeverity || null,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          s3Key,
          imageHash,
          belgeNo: ocrResult?.belgeNo || null,
          faturaTarihi: parseDate(ocrResult?.date || null),
          sellerVkn: ocrResult?.saticiVkn || null,
          vendorName: ocrResult?.satici || null,
          totalAmount: money(ocrResult?.totalTutari),
          ocrStatus,
          ocrEngine: ocrResult?.engine || null,
          ocrRawText: ocrResult?.rawText || null,
          ocrConfidence: ocrResult?.confidence ?? null,
          ocrData: ocrResult ? (ocrResult as any) : undefined,
          createdBy: userId || null,
          lines: { create: lines },
        },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
      });
      created.push(doc);
    }

    return { uploaded: created.length, documents: created };
  }

  async ensureFromEarsivFatura(tenantId: string, faturaId: string) {
    // v2.2: select'ten kdvBreakdown'u çıkar — yeni kolon DB'de henüz olmayabilir,
    // Prisma "Unknown field" hatası vermesin. Ayrıca raw SQL ile sonradan çekeriz.
    const f = await (this.prisma as any).earsivFatura.findFirst({
      where: { id: faturaId, tenantId },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        tip: true,
        belgeKaynak: true,
        faturaNo: true,
        faturaTarihi: true,
        satici: true,
        saticiVergiNo: true,
        alici: true,
        aliciVergiNo: true,
        matrah: true,
        kdvTutari: true,
        kdvOrani: true,
        toplamTutar: true,
        paraBirimi: true,
        pdfStorageKey: true,
        htmlStorageKey: true,
        xmlContent: true,
      },
    });
    if (!f) throw new NotFoundException('E-fatura/e-arşiv kaydı bulunamadı');

    // kdvBreakdown'u raw SQL ile çek — kolon yoksa silently null döner
    let kdvBreakdownRaw: any = null;
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "kdvBreakdown" FROM "earsiv_faturalar" WHERE "id" = $1 LIMIT 1`,
        faturaId,
      );
      kdvBreakdownRaw = rows?.[0]?.kdvBreakdown ?? null;
    } catch {
      // kolon yok → null kalır
    }
    (f as any).kdvBreakdown = kdvBreakdownRaw;

    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, source: 'earsiv', sourceRefId: f.id },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    if (existing) return { created: false, duplicate: true, document: existing };

    const documentType = f.belgeKaynak === 'EFATURA' ? 'E_FATURA' : 'E_ARSIV';
    const invoiceKind = f.tip === 'SATIS' ? 'SATIS' : 'ALIS';
    const originalName = `${f.faturaNo || f.id}.${f.pdfStorageKey ? 'pdf' : f.htmlStorageKey ? 'html' : 'xml'}`;
    const s3Key = `earsiv-inline://${f.id}`;
    const sizeBytes = f.pdfStorageKey || f.htmlStorageKey ? 1 : Buffer.byteLength(f.xmlContent || '', 'utf8');
    const breakdownArr = Array.isArray((f as any).kdvBreakdown)
      ? (f as any).kdvBreakdown as Array<{ rate: number; base: number; amount: number }>
      : null;
    const lines = this.linesFromAmounts({
      invoiceKind,
      matrah: f.matrah,
      kdvTutari: f.kdvTutari,
      kdvOrani: f.kdvOrani,
      total: f.toplamTutar,
      vendorName: invoiceKind === 'ALIS' ? f.satici : f.alici,
      kdvBreakdown: breakdownArr,
    });
    const duplicate = await this.findDuplicate(tenantId, {
      taxpayerId: f.taxpayerId,
      belgeNo: f.faturaNo,
      sellerVkn: f.saticiVergiNo,
      buyerVkn: f.aliciVergiNo,
      totalAmount: f.toplamTutar,
    });

    // v2.1: Sahiplik + denge kontrolü
    const validation = await this.runValidation({
      tenantId,
      taxpayerId: f.taxpayerId,
      invoiceKind,
      lines,
      totalAmount: f.toplamTutar,
      sellerVkn: f.saticiVergiNo,
      buyerVkn: f.aliciVergiNo,
      matrah: f.matrah,
      kdvTutari: f.kdvTutari,
      kdvBreakdown: breakdownArr,
    });

    const doc = await (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId: f.taxpayerId,
        source: 'earsiv',
        sourceRefId: f.id,
        documentType,
        invoiceKind,
        // Validation hatası varsa NEEDS_REVIEW — kullanıcı kontrol etmeli
        status: (duplicate || validation.status !== 'OK') ? 'NEEDS_REVIEW' : 'READY',
        duplicateOfId: duplicate?.duplicateOfId || null,
        duplicateReason: duplicate?.duplicateReason || null,
        duplicateSeverity: duplicate?.duplicateSeverity || null,
        originalName,
        mimeType: f.pdfStorageKey ? 'application/pdf' : f.htmlStorageKey ? 'text/html' : 'application/xml',
        sizeBytes,
        s3Key,
        currency: f.paraBirimi || 'TL',
        belgeNo: f.faturaNo || null,
        faturaTarihi: f.faturaTarihi || null,
        sellerVkn: f.saticiVergiNo || null,
        buyerVkn: f.aliciVergiNo || null,
        vendorName: f.satici || null,
        customerName: f.alici || null,
        totalAmount: money(f.toplamTutar),
        ocrStatus: 'SUCCESS',
        ocrEngine: 'ubl-direct',
        ocrData: {
          source: 'earsivFatura',
          belgeKaynak: f.belgeKaynak,
          tip: f.tip,
          matrah: f.matrah,
          kdvTutari: f.kdvTutari,
          kdvOrani: f.kdvOrani,
          kdvBreakdown: breakdownArr,
          // Validation sonucunu ocrData içine de yaz — ana kolonlar olmasa bile UI okuyabilir
          validationStatus: validation.status,
          validationIssues: validation.issues,
          validationCheckedAt: new Date().toISOString(),
        },
        lines: { create: lines },
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });

    // v2.2: validation kolonlarını raw SQL ile yaz — Prisma client tanımıyor olabilir
    try {
      await (this.prisma as any).$executeRawUnsafe(
        `UPDATE "invoice_accounting_documents"
         SET "validationStatus" = $1, "validationIssues" = $2::jsonb, "validationCheckedAt" = NOW()
         WHERE "id" = $3`,
        validation.status,
        JSON.stringify(validation.issues),
        doc.id,
      );
    } catch {
      // kolonlar yoksa atla — ocrData içinde zaten saklı
    }

    return { created: true, document: doc };
  }

  async backfillFromExistingEarsiv(
    tenantId: string,
    opts: { taxpayerId?: string; donem?: string; tip?: string; belgeKaynak?: string; limit?: number; ids?: string[] } = {},
  ) {
    const ids = Array.isArray(opts.ids)
      ? [...new Set(opts.ids.map((id) => String(id || '').trim()).filter(Boolean))]
      : [];
    if (ids.length > 500) throw new BadRequestException('Tek seferde en fazla 500 fatura aktarılabilir');
    if (!opts.taxpayerId && ids.length === 0) {
      throw new BadRequestException('Fatura Merkezi aktarımı için mükellef veya seçili fatura listesi gerekli');
    }

    const where: any = { tenantId };
    if (ids.length) where.id = { in: ids };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.donem) where.donem = opts.donem;
    if (opts.tip) where.tip = opts.tip;
    if (opts.belgeKaynak) where.belgeKaynak = opts.belgeKaynak;

    const rows = await (this.prisma as any).earsivFatura.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.limit || 5000, 1), 20000),
      select: { id: true },
    });

    let created = 0;
    let alreadyQueued = 0;
    let failed = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const row of rows) {
      try {
        const result = await this.ensureFromEarsivFatura(tenantId, row.id);
        if (result.created) created++;
        else alreadyQueued++;
      } catch (e: any) {
        failed++;
        if (errors.length < 10) errors.push({ id: row.id, message: e?.message || 'aktarim hatasi' });
      }
    }

    return {
      scanned: rows.length,
      created,
      alreadyQueued,
      failed,
      errors,
    };
  }

  async fileUrl(tenantId: string, id: string) {
    const doc = await this.get(tenantId, id);
    const mimeType = String(doc.mimeType || '');
    const inlineRefId = String(doc.s3Key || '').startsWith('earsiv-inline://')
      ? String(doc.s3Key || '').slice('earsiv-inline://'.length)
      : '';
    const earsivRefId = String((doc as any).source || '') === 'earsiv'
      ? String((doc as any).sourceRefId || inlineRefId || '').trim()
      : inlineRefId;

    if (earsivRefId) {
      const refId = earsivRefId;
      const fatura = refId
        ? await (this.prisma as any).earsivFatura.findFirst({
            where: { tenantId, id: refId },
            select: {
              id: true,
              faturaNo: true,
              faturaTarihi: true,
              ettn: true,
              satici: true,
              saticiVergiNo: true,
              alici: true,
              aliciVergiNo: true,
              matrah: true,
              kdvTutari: true,
              kdvOrani: true,
              toplamTutar: true,
              paraBirimi: true,
              xmlContent: true,
              pdfStorageKey: true,
              htmlStorageKey: true,
            },
          })
        : null;
      if (fatura?.pdfStorageKey) {
        return {
          url: await this.storage.getPresignedInlineUrl(fatura.pdfStorageKey, `${fatura.faturaNo || 'fatura'}.pdf`, 'application/pdf'),
          mimeType: 'application/pdf',
          source: 'original-pdf' as const,
        };
      }
      if (fatura?.htmlStorageKey) {
        const buffer = await this.storage.getBuffer(fatura.htmlStorageKey);
        const html = this.earsivRender.renderOriginalHtml(buffer.toString('utf8'), { autoPrint: false });
        return { url: '', inlineHtml: html, mimeType: 'text/html', source: 'original-html' as const };
      }
      const html = fatura
        ? this.earsivRender.renderHtml(fatura, { autoPrint: false })
        : this.inlinePreviewHtml('Bu belge icin orijinal dosya bulunamadi.');
      return {
        url: '',
        inlineHtml: html,
        mimeType: 'text/html',
        // v2.2: Luca'dan PDF/HTML inmemiş, biz XML'den render ettik — kullanıcı bilsin
        source: fatura?.xmlContent && this.earsivRender.hasEmbeddedXslt(fatura.xmlContent)
          ? ('original-xslt' as const)
          : fatura ? ('rendered-from-xml' as const) : ('placeholder' as const),
      };
    }
    if (/text\/html|xml/i.test(mimeType)) {
      const buffer = await this.storage.getBuffer(doc.s3Key);
      const raw = buffer.toString('utf8');
      const html = mimeType.includes('html') ? raw : this.inlinePreviewHtml(raw);
      return { url: '', inlineHtml: html, mimeType: 'text/html', source: 'stored-html' as const };
    }
    const url = await this.storage.getPresignedDownloadUrl(doc.s3Key, doc.originalName);
    return { url, source: 'stored-file' as const };
  }

  private inlinePreviewHtml(raw: string) {
    const source = String(raw || '');
    if (/<html[\s>]/i.test(source)) return source;

    const text = (tag: string) => {
      const m = source.match(new RegExp(`<[^:>]*(?::)?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*(?::)?${tag}>`, 'i'));
      return (m?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    };
    const esc = (v: string) => String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const items = [...source.matchAll(/<[^:>]*(?::)?InvoiceLine\b[\s\S]*?<\/[^:>]*(?::)?InvoiceLine>/gi)]
      .slice(0, 20)
      .map((m) => {
        const block = m[0];
        const pick = (tag: string) => {
          const mm = block.match(new RegExp(`<[^:>]*(?::)?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*(?::)?${tag}>`, 'i'));
          return (mm?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        };
        return {
          name: pick('Name') || pick('Description') || '-',
          qty: pick('InvoicedQuantity') || '-',
          amount: pick('LineExtensionAmount') || '-',
        };
      });
    const rows = items.length
      ? items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)}</td><td class="num">${esc(i.amount)}</td></tr>`).join('')
      : '<tr><td colspan="3">Kalem bilgisi XML icinden okunamadi.</td></tr>';

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#f8fafc;color:#111827;font:14px/1.45 Arial,sans-serif;padding:24px}
      .sheet{max-width:940px;margin:auto;background:white;border:1px solid #e5e7eb;padding:28px;box-shadow:0 8px 28px rgba(15,23,42,.08)}
      h1{margin:0 0 16px;font-size:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}
      .box{border:1px solid #e5e7eb;padding:12px}.muted{color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:700}
      table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}th{background:#f3f4f6}.num{text-align:right}
      .totals{margin-left:auto;margin-top:18px;width:320px}.totals div{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:7px 0}.big{font-size:20px;font-weight:700}
    </style></head><body><div class="sheet">
      <h1>e-Fatura / e-Arsiv Onizleme</h1>
      <div class="grid">
        <div class="box"><div class="muted">Satici</div><b>${esc(text('RegistrationName') || text('Name'))}</b><br>${esc(text('CompanyID'))}</div>
        <div class="box"><div class="muted">Belge</div><b>${esc(text('ID'))}</b><br>${esc(text('IssueDate'))}</div>
      </div>
      <table><thead><tr><th>Mal/Hizmet</th><th>Miktar</th><th>Tutar</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="totals">
        <div><span>Mal Hizmet Toplam</span><b>${esc(text('LineExtensionAmount'))}</b></div>
        <div><span>KDV</span><b>${esc(text('TaxAmount'))}</b></div>
        <div class="big"><span>Genel Toplam</span><b>${esc(text('PayableAmount'))}</b></div>
      </div>
    </div></body></html>`;
  }

  async update(tenantId: string, id: string, body: UpdateDocumentInput) {
    await this.get(tenantId, id);
    const data: any = {};
    for (const key of [
      'taxpayerId',
      'documentType',
      'invoiceKind',
      'status',
      'currency',
      'belgeNo',
      'seriNo',
      'sellerVkn',
      'buyerVkn',
      'vendorName',
      'customerName',
    ] as const) {
      if (key in body) data[key] = (body as any)[key] || null;
    }
    if ('exchangeRate' in body) data.exchangeRate = parseDecimal(body.exchangeRate, '1');
    if ('faturaTarihi' in body) data.faturaTarihi = parseDate(body.faturaTarihi);
    if ('totalAmount' in body) data.totalAmount = money(body.totalAmount);
    const duplicate = await this.findDuplicate(tenantId, {
      taxpayerId: body.taxpayerId,
      belgeNo: body.belgeNo,
      sellerVkn: body.sellerVkn,
      buyerVkn: body.buyerVkn,
      totalAmount: body.totalAmount,
    }, id);
    data.duplicateOfId = duplicate?.duplicateOfId || null;
    data.duplicateReason = duplicate?.duplicateReason || null;
    data.duplicateSeverity = duplicate?.duplicateSeverity || null;
    if (duplicate && data.status === 'READY') data.status = 'NEEDS_REVIEW';

    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data,
    });

    if (Array.isArray(body.lines)) {
      await (this.prisma as any).invoiceAccountingLine.deleteMany({ where: { documentId: id } });
      if (body.lines.length) {
        await (this.prisma as any).invoiceAccountingLine.createMany({
          data: body.lines.map((line, index) => ({
            documentId: id,
            group: line.group || 'matrah',
            accountCode: line.accountCode || null,
            description: line.description || null,
            rate: line.rate || null,
            debit: parseDecimal(line.debit),
            credit: parseDecimal(line.credit),
            orderNo: index,
          })),
        });
      }
    }

    // v2.1: Manuel değişiklik sonrası validation'ı tekrar çalıştır
    await this.revalidateDocument(tenantId, id);

    return this.get(tenantId, id);
  }

  /**
   * v2.1 — Belgeyi tekrar oku, validation pipeline'ını çalıştır ve sonucu yaz.
   * update / manuel edit / line düzenleme sonrasında çağrılır.
   */
  async revalidateDocument(tenantId: string, id: string): Promise<{ status: string; issues: any[] }> {
    const doc = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!doc) return { status: 'OK', issues: [] };

    // ocrData içinden breakdown'ı oku (varsa)
    const ocrData: any = doc.ocrData || {};
    const breakdown = Array.isArray(ocrData?.kdvBreakdown) ? ocrData.kdvBreakdown : null;

    const validation = await this.runValidation({
      tenantId,
      taxpayerId: doc.taxpayerId,
      invoiceKind: doc.invoiceKind,
      lines: doc.lines || [],
      totalAmount: doc.totalAmount,
      sellerVkn: doc.sellerVkn,
      buyerVkn: doc.buyerVkn,
      matrah: ocrData?.matrah,
      kdvTutari: ocrData?.kdvTutari,
      kdvBreakdown: breakdown,
    });

    // v2.2: validation kolonlarını raw SQL ile yaz — Prisma client tanımıyor olabilir
    try {
      await (this.prisma as any).$executeRawUnsafe(
        `UPDATE "invoice_accounting_documents"
         SET "validationStatus" = $1, "validationIssues" = $2::jsonb, "validationCheckedAt" = NOW()
         WHERE "id" = $3`,
        validation.status,
        validation.issues.length ? JSON.stringify(validation.issues) : null,
        id,
      );
    } catch {
      // kolonlar yoksa atla
    }
    return validation;
  }

  async approve(tenantId: string, id: string, userId?: string) {
    const doc = await this.get(tenantId, id);

    // v2.1: Approve öncesi mutlaka revalidate çalıştır — sonucu OK değilse reddet.
    // Validation şu durumlarda hata atar:
    //   - Yevmiye dengesiz (Borç ≠ Alacak)
    //   - Yevmiye toplamı belge tutarına eşit değil
    //   - Matrah/KDV eksik (INCOMPLETE)
    //   - VKN/TC mükellefe ait değil
    const validation = await this.revalidateDocument(tenantId, id);
    if (validation.status !== 'OK') {
      const messages = validation.issues.map((i: any) => i.message).join(' · ');
      throw new BadRequestException(
        `Bu belge onaylanamaz — veri kontrolü başarısız: ${messages}. Önce hatayı düzelt.`,
      );
    }

    // v1.38: Tek belge onayi — sadece belgeyi APPROVED + lucaStatus=QUEUED yap.
    // Luca'ya GERCEK aktarim per-invoice job ile DEGIL, kullanici Sahne 5'te
    // "Luca'ya Aktar" tiklayinca toplu Excel olarak yapilir (batchPostToLuca).
    // Bu sayede 50 onay = 50 ayri yevmiye fisi degil, 1 toplu fis olur.
    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: userId || null,
        approvedAt: new Date(),
        lucaStatus: doc.taxpayerId ? 'QUEUED' : 'NOT_STARTED',
        lucaErrorMessage: doc.taxpayerId ? null : 'Mukellef secilmedigi icin Luca\'ya aktarilamaz',
      },
    });

    return this.get(tenantId, id);
  }

  // v1.38: Bir mukellef+donem icin TUM QUEUED belgeleri tek INVOICE_POST job
  // halinde Luca'ya yollar — agent Excel hazirlayip Luca'nin "Toplu Aktarim"
  // ekranina yukler, tek yevmiye fisi olusur. Kullanici sonra Luca'da boler.
  async batchPostToLuca(
    tenantId: string,
    body: { taxpayerId: string; period?: string; documentIds?: string[] },
    userId?: string,
  ) {
    if (!body?.taxpayerId) {
      throw new Error('taxpayerId zorunlu');
    }

    // Hangi belgeler bu batch'e dahil — ya verilen ID listesi ya QUEUED filtresi
    // v2.2: validation kolonları olmayabilir — filtreleme application-side (validation OK olmayanları sonradan ele)
    const where: any = {
      tenantId,
      taxpayerId: body.taxpayerId,
      status: 'APPROVED',
      lucaStatus: { in: ['QUEUED', 'FAILED', 'NOT_STARTED'] },
    };
    if (Array.isArray(body.documentIds) && body.documentIds.length > 0) {
      where.id = { in: body.documentIds };
    } else if (body.period) {
      // YYYY-MM formatinda gelen donem → faturaTarihi araligi
      const [y, m] = String(body.period).split('-').map((n) => parseInt(n, 10));
      if (Number.isFinite(y) && Number.isFinite(m)) {
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));
        where.faturaTarihi = { gte: start, lt: end };
      }
    }

    const allDocs: any[] = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where,
      include: { lines: { orderBy: { orderNo: 'asc' } } },
      orderBy: { faturaTarihi: 'asc' },
    });

    // v2.2: validationStatus ocrData içinde — application-side filter
    let skippedCount = 0;
    const docs = allDocs.filter((d: any) => {
      const v = d.ocrData?.validationStatus;
      if (v === 'INVALID' || v === 'INCOMPLETE') { skippedCount++; return false; }
      return true;
    });

    if (!docs.length) {
      const extra = skippedCount > 0
        ? ` (${skippedCount} belge veri kontrolü hatası nedeniyle hariç tutuldu — Gelen Belgeler'de düzelt)`
        : '';
      throw new Error(`Bu mukellef icin Luca'ya aktarilabilir belge bulunamadi${extra}`);
    }

    // Tek job icin period etiketi: en cok rastlanan ay
    const periodCounts: Record<string, number> = {};
    for (const d of docs) {
      const dt = d.faturaTarihi ? new Date(d.faturaTarihi) : new Date();
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      periodCounts[key] = (periodCounts[key] || 0) + 1;
    }
    const dominantPeriod = Object.entries(periodCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Tek INVOICE_POST job — payload.invoices butun listesi
    const job = await (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId,
        mukellefId: body.taxpayerId,
        donem: dominantPeriod,
        tip: 'INVOICE_POST',
        status: 'pending',
        priority: 5,
        createdBy: userId || null,
        invoiceDocumentId: null, // batch — tek belgeye bagli degil
        payload: {
          mode: 'BATCH_EXCEL',
          taxpayerId: body.taxpayerId,
          period: dominantPeriod,
          totalCount: docs.length,
          invoices: docs.map((d: any) => ({
            documentId: d.id,
            documentType: d.documentType,
            invoiceKind: d.invoiceKind,
            belgeNo: d.belgeNo,
            seriNo: d.seriNo,
            faturaTarihi: d.faturaTarihi ? d.faturaTarihi.toISOString() : null,
            sellerVkn: d.sellerVkn,
            buyerVkn: d.buyerVkn,
            vendorName: d.vendorName,
            customerName: d.customerName,
            totalAmount: d.totalAmount ? String(d.totalAmount) : null,
            currency: d.currency || 'TL',
            lines: (d.lines || []).map((line: any) => ({
              group: line.group,
              accountCode: line.accountCode,
              description: line.description,
              rate: line.rate,
              debit: line.debit ? String(line.debit) : '0',
              credit: line.credit ? String(line.credit) : '0',
              orderNo: line.orderNo,
            })),
          })),
        },
      },
    });

    // Tum belgeleri POSTING durumuna al + job id'yi yaz
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: { in: docs.map((d: any) => d.id) } },
      data: {
        lucaStatus: 'POSTING',
        lucaJobId: job.id,
        lucaErrorMessage: null,
        lucaAttemptCount: { increment: 1 },
      },
    });

    return {
      jobId: job.id,
      taxpayerId: body.taxpayerId,
      period: dominantPeriod,
      documentCount: docs.length,
      skippedInvalid: skippedCount, // v2.1: validation hatası olan + bu yüzden Luca'ya gitmeyen belgeler
    };
  }

  // v1.38: Belirli bir belge icin Luca aktarimini tekrar dene
  // — yine batchPostToLuca cagrir, sadece o belgeyle.
  async retryLucaPost(tenantId: string, id: string, userId?: string) {
    const doc = await this.get(tenantId, id);
    if (doc.status !== 'APPROVED') {
      throw new Error('Sadece APPROVED durumundaki belgeler Luca\'ya aktarilabilir');
    }
    if (!doc.taxpayerId) {
      throw new Error('Belgede mukellef secilmemis, Luca\'ya aktarilamaz');
    }

    // Eski aktif job'u iptal et (varsa)
    if (doc.lucaJobId) {
      await (this.prisma as any).lucaFetchJob.updateMany({
        where: { id: doc.lucaJobId, status: { in: ['pending', 'running'] } },
        data: { status: 'failed', errorMsg: 'Tekrar deneme icin iptal edildi', finishedAt: new Date() },
      });
    }

    return this.batchPostToLuca(
      tenantId,
      { taxpayerId: doc.taxpayerId, documentIds: [id] },
      userId,
    );
  }

  async remove(tenantId: string, id: string) {
    const doc = await this.get(tenantId, id);
    await (this.prisma as any).invoiceAccountingDocument.delete({ where: { id } });
    if (String((doc as any).source || '') !== 'earsiv' && !String(doc.s3Key || '').startsWith('earsiv-inline://')) {
      this.storage.deleteObject(doc.s3Key).catch(() => {});
    }
    return { deleted: true };
  }

  private resolveRuntimeConfig(
    row: any,
    catalog: (typeof INTEGRATOR_CATALOG)[number],
    taxpayerId: string,
  ): RuntimeIntegrationConfig | null {
    if (!row) return null;
    const config = ((row.config || {}) as any) || {};
    const scoped = config.taxpayers?.[taxpayerId] || config.taxpayers?.global || null;
    if (!scoped) return null;
    const password = tryDecrypt(scoped.encryptedPassword) || '';
    const apiKey = tryDecrypt(scoped.encryptedApiKey) || '';
    const apiSecret = tryDecrypt(scoped.encryptedApiSecret) || '';
    return {
      provider: catalog.provider,
      label: scoped.label || config.label || catalog.label,
      baseUrl: String(scoped.baseUrl || PROVIDER_DEFAULT_BASE_URL[catalog.provider] || '').trim(),
      username: String(scoped.username || '').trim(),
      password,
      apiKey,
      apiSecret,
      senderVkn: String(scoped.senderVkn || '').trim(),
      accountId: String(scoped.accountId || '').trim(),
      note: scoped.isActive === false ? '__inactive__' : String(scoped.note || '').trim(),
    };
  }

  private providerCredentialProblem(cfg: RuntimeIntegrationConfig): string | null {
    if (cfg.provider === 'UYUMSOFT' && (!cfg.username || !cfg.password)) return 'Uyumsoft kullanici/sifre eksik';
    if (I2I_SOAP_PROVIDERS.has(cfg.provider) && (!cfg.username || !cfg.password)) return 'Izibiz/i2i kullanici/sifre eksik';
    if (cfg.provider !== 'UYUMSOFT' && !I2I_SOAP_PROVIDERS.has(cfg.provider) && !cfg.baseUrl) return 'API adresi eksik';
    if (!cfg.username && !cfg.password && !cfg.apiKey && !cfg.apiSecret && !cfg.baseUrl) return 'Kimlik bilgisi eksik';
    return null;
  }

  private monthRange(value?: string) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const year = match ? Number(match[1]) : now.getFullYear();
    const month = match ? Number(match[2]) : now.getMonth() + 1;
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const mm = String(month).padStart(2, '0');
    return {
      donem: `${year}-${mm}`,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  private async fetchProviderInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
    },
  ): Promise<ProviderInvoicePayload[]> {
    if (cfg.provider === 'UYUMSOFT') return this.fetchUyumsoftInvoices(cfg, opts);
    if (I2I_SOAP_PROVIDERS.has(cfg.provider) || /EInvoiceWS/i.test(cfg.baseUrl)) {
      return this.fetchI2iInvoices(cfg, opts);
    }
    return this.fetchGenericRestInvoices(cfg, opts);
  }

  private async fetchUyumsoftInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { startDate: string; endDate: string };
      limit: number;
    },
  ) {
    const method = opts.direction === 'SATIS' ? 'GetOutboxInvoicesData' : 'GetInboxInvoicesData';
    const action = `http://tempuri.org/IBasicIntegration/${method}`;
    const queryAttrs =
      opts.direction === 'SATIS'
        ? `PageIndex="0" PageSize="${opts.limit}"`
        : `PageIndex="0" PageSize="${opts.limit}" SetTaken="false" OnlyNewestInvoices="false"`;
    const body = `
      <${method} xmlns="http://tempuri.org/">
        <userInfo Username="${this.xmlEscape(cfg.username)}" Password="${this.xmlEscape(cfg.password)}" />
        <query ${queryAttrs}>
          <ExecutionStartDate>${opts.period.startDate}T00:00:00</ExecutionStartDate>
          <ExecutionEndDate>${opts.period.endDate}T23:59:59</ExecutionEndDate>
        </query>
      </${method}>`;
    const text = await this.soapPost(cfg.baseUrl || PROVIDER_DEFAULT_BASE_URL.UYUMSOFT, action, body);
    return this.extractPayloadsFromProviderResponse(text, ['Data']);
  }

  private async fetchI2iInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { startDate: string; endDate: string };
      limit: number;
    },
  ) {
    const baseUrl = cfg.baseUrl || PROVIDER_DEFAULT_BASE_URL.IZIBIZ;
    const loginBody = `
      <LoginRequest xmlns="http://schemas.i2i.com/ei/wsdl">
        <USER_NAME>${this.xmlEscape(cfg.username)}</USER_NAME>
        <PASSWORD>${this.xmlEscape(cfg.password)}</PASSWORD>
      </LoginRequest>`;
    const loginText = await this.soapPost(baseUrl, '', loginBody);
    const sessionId = this.tagText(loginText, 'SESSION_ID');
    if (!sessionId) throw new Error('Izibiz/i2i oturum alinamadi');
    const direction = opts.direction === 'SATIS' ? 'OUT' : 'IN';
    const fetchBody = `
      <GetInvoiceRequest xmlns="http://schemas.i2i.com/ei/wsdl">
        <REQUEST_HEADER>
          <SESSION_ID>${this.xmlEscape(sessionId)}</SESSION_ID>
          <APPLICATION_NAME>MOREN_PORTAL</APPLICATION_NAME>
        </REQUEST_HEADER>
        <INVOICE_SEARCH_KEY>
          <LIMIT>${opts.limit}</LIMIT>
          <DATE_TYPE>ISSUE</DATE_TYPE>
          <START_DATE>${opts.period.startDate}</START_DATE>
          <END_DATE>${opts.period.endDate}</END_DATE>
          <READ_INCLUDED>true</READ_INCLUDED>
          <DIRECTION>${direction}</DIRECTION>
        </INVOICE_SEARCH_KEY>
        <HEADER_ONLY>N</HEADER_ONLY>
        <INVOICE_CONTENT_TYPE>XML</INVOICE_CONTENT_TYPE>
      </GetInvoiceRequest>`;
    const text = await this.soapPost(baseUrl, '', fetchBody);
    return this.extractPayloadsFromProviderResponse(text, ['CONTENT', 'XML_CONTENT', 'DATA']);
  }

  private async fetchGenericRestInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
    },
  ) {
    if (!cfg.baseUrl) throw new Error('API adresi eksik');
    const taxNo = opts.taxpayer.taxNumber || opts.taxpayer.identityNumber || cfg.senderVkn || '';
    const url = new URL(cfg.baseUrl);
    const addParam = (key: string, value: string | number) => {
      if (!url.searchParams.has(key) && value !== '') url.searchParams.set(key, String(value));
    };
    addParam('taxpayerId', opts.taxpayer.id);
    addParam('vkn', taxNo);
    addParam('donem', opts.period.donem);
    addParam('direction', opts.direction);
    addParam('startDate', opts.period.startDate);
    addParam('endDate', opts.period.endDate);
    addParam('limit', opts.limit);

    const headers = this.providerHeaders(cfg);
    let res = await fetch(url.toString(), { method: 'GET', headers });
    if (res.status === 405 || res.status === 404) {
      res = await fetch(cfg.baseUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxpayerId: opts.taxpayer.id,
          vkn: taxNo,
          donem: opts.period.donem,
          direction: opts.direction,
          startDate: opts.period.startDate,
          endDate: opts.period.endDate,
          limit: opts.limit,
        }),
      });
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${cfg.provider} API ${res.status}: ${text.slice(0, 300)}`);
    return this.extractPayloadsFromProviderResponse(text, ['xml', 'ubl', 'content', 'data', 'base64']);
  }

  private providerHeaders(cfg: RuntimeIntegrationConfig): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/xml, text/xml, application/json, */*',
      'User-Agent': 'MorenPortal/1.0',
    };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
      headers['X-API-Key'] = cfg.apiKey;
    }
    if (cfg.apiSecret) headers['X-API-Secret'] = cfg.apiSecret;
    if (cfg.username && cfg.password && !headers.Authorization) {
      headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
    }
    if (cfg.accountId) headers['X-Account-Id'] = cfg.accountId;
    return headers;
  }

  private async soapPost(url: string, soapAction: string, body: string) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>${body}</soapenv:Body>
      </soapenv:Envelope>`;
    const headers: Record<string, string> = {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml, application/xml',
      'User-Agent': 'MorenPortal/1.0',
    };
    if (soapAction) headers.SOAPAction = `"${soapAction}"`;
    const res = await fetch(url, { method: 'POST', headers, body: envelope });
    const text = await res.text();
    if (!res.ok) throw new Error(`SOAP ${res.status}: ${text.slice(0, 400)}`);
    if (/<(?:[^:>]+:)?Fault\b/i.test(text)) throw new Error(this.tagText(text, 'faultstring') || 'SOAP Fault');
    return text;
  }

  private async extractPayloadsFromProviderResponse(text: string, contentTags: string[]) {
    const payloads: ProviderInvoicePayload[] = [];
    const collected: string[] = [];
    const pushString = (value: string) => {
      const trimmed = String(value || '').trim();
      if (trimmed.length > 20) collected.push(trimmed);
    };

    try {
      const json = JSON.parse(text);
      const visit = (node: any, key = '') => {
        if (node == null) return;
        if (typeof node === 'string') {
          if (/xml|ubl|content|data|base64|document|invoice/i.test(key) || this.looksLikeXmlOrBase64(node)) pushString(node);
          return;
        }
        if (Array.isArray(node)) {
          node.forEach((item) => visit(item, key));
          return;
        }
        if (typeof node === 'object') {
          for (const [childKey, childValue] of Object.entries(node)) visit(childValue, childKey);
        }
      };
      visit(json);
    } catch {
      // Not JSON; continue with XML/text extraction.
    }

    const decoded = this.decodeXmlEntities(text);
    this.extractXmlDocuments(decoded).forEach(pushString);
    const tagGroup = contentTags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    if (tagGroup) {
      const re = new RegExp(`<[^:>]*(?::)?(?:${tagGroup})\\b[^>]*>([\\s\\S]*?)<\\/[^:>]*(?::)?(?:${tagGroup})>`, 'gi');
      for (const match of decoded.matchAll(re)) {
        pushString(match[1].replace(/<[^>]+>/g, '').trim());
      }
    }

    for (const value of collected) {
      await this.addPayloadString(payloads, value);
    }
    const unique = new Map<string, ProviderInvoicePayload>();
    for (const payload of payloads) {
      const key = payload.externalId || createHash('sha1').update(payload.xml).digest('hex');
      if (!unique.has(key)) unique.set(key, payload);
    }
    return [...unique.values()];
  }

  private async addPayloadString(payloads: ProviderInvoicePayload[], value: string) {
    const raw = this.decodeXmlEntities(value).trim();
    const xmlDocs = this.extractXmlDocuments(raw);
    if (xmlDocs.length) {
      xmlDocs.forEach((xml) => payloads.push({
        xml,
        externalId: this.tagText(xml, 'UUID') || this.tagText(xml, 'ID') || null,
        originalName: `${this.tagText(xml, 'ID') || this.tagText(xml, 'UUID') || randomUUID()}.xml`,
      }));
      return;
    }
    const compact = raw.replace(/\s+/g, '');
    if (!this.looksLikeBase64(compact)) return;
    await this.addPayloadBuffer(payloads, Buffer.from(compact, 'base64'));
  }

  private async addPayloadBuffer(payloads: ProviderInvoicePayload[], buffer: Buffer) {
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.values(zip.files).filter((file) => !file.dir);
      for (const file of files) {
        const name = file.name || '';
        if (!/\.(xml|ubl)$/i.test(name)) continue;
        const xml = await file.async('string');
        const xmlDocs = this.extractXmlDocuments(this.decodeXmlEntities(xml));
        for (const doc of xmlDocs.length ? xmlDocs : [xml]) {
          payloads.push({
            xml: doc,
            externalId: this.tagText(doc, 'UUID') || this.tagText(doc, 'ID') || null,
            originalName: name.split('/').pop() || `${randomUUID()}.xml`,
          });
        }
      }
      return;
    }
    const text = buffer.toString('utf8');
    const xmlDocs = this.extractXmlDocuments(this.decodeXmlEntities(text));
    for (const xml of xmlDocs) {
      payloads.push({
        xml,
        externalId: this.tagText(xml, 'UUID') || this.tagText(xml, 'ID') || null,
        originalName: `${this.tagText(xml, 'ID') || this.tagText(xml, 'UUID') || randomUUID()}.xml`,
      });
    }
  }

  private extractXmlDocuments(text: string) {
    const source = String(text || '').trim();
    const docs: string[] = [];
    const patterns = [
      /<\?xml[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)>/gi,
      /<(?:[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)>/gi,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const xml = match[0].trim();
        if (!docs.some((item) => item === xml)) docs.push(xml);
      }
    }
    return docs;
  }

  private looksLikeXmlOrBase64(value: string) {
    const raw = String(value || '').trim();
    return /<(?:\?xml|[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)\b/i.test(raw) || this.looksLikeBase64(raw.replace(/\s+/g, ''));
  }

  private looksLikeBase64(value: string) {
    const raw = String(value || '').trim();
    return raw.length > 80 && raw.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
  }

  private decodeXmlEntities(value: string) {
    return String(value || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)));
  }

  private tagText(xml: string, tag: string) {
    const re = new RegExp(`<[^:>]*(?::)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^:>]*(?::)?${tag}>`, 'i');
    return (String(xml || '').match(re)?.[1] || '').replace(/<[^>]+>/g, '').trim();
  }

  private xmlEscape(value: string) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async createDocumentFromProviderXml(
    tenantId: string,
    userId: string | undefined,
    taxpayer: any,
    cfg: RuntimeIntegrationConfig,
    direction: 'ALIS' | 'SATIS',
    payload: ProviderInvoicePayload,
  ) {
    const parsed = this.parseProviderUblInvoice(payload.xml) || this.regexProviderInvoiceFallback(payload.xml);
    if (!parsed) throw new Error('UBL/XML fatura okunamadi');
    const source = cfg.provider === 'GIB_PORTAL' ? 'gib-portal-api' : `integration-${cfg.provider.toLowerCase()}`;
    const sourceRefId = payload.externalId || parsed.ettn || parsed.faturaNo || createHash('sha1').update(payload.xml).digest('hex');
    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, taxpayerId: taxpayer.id, source, sourceRefId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    if (existing) return { created: false, document: existing };

    const xmlBuffer = Buffer.from(payload.xml, 'utf8');
    const s3Key = `invoice-accounting/${tenantId}/${taxpayer.id}/${cfg.provider.toLowerCase()}-${randomUUID()}.xml`;
    await this.storage.putBuffer(s3Key, xmlBuffer, 'application/xml', {
      'tenant-id': tenantId,
      'taxpayer-id': taxpayer.id,
      provider: cfg.provider,
      source,
    });

    const total = parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0));
    const duplicate = await this.findDuplicate(tenantId, {
      taxpayerId: taxpayer.id,
      belgeNo: parsed.faturaNo,
      sellerVkn: parsed.saticiVergiNo || null,
      buyerVkn: parsed.aliciVergiNo || null,
      totalAmount: total,
    });
    const lines = this.linesFromAmounts({
      invoiceKind: direction,
      matrah: parsed.matrah,
      kdvTutari: parsed.kdvTutari,
      kdvOrani: parsed.kdvOrani,
      total,
      vendorName: direction === 'SATIS' ? parsed.alici : parsed.satici,
    });

    const doc = await (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId: taxpayer.id,
        source,
        sourceRefId,
        documentType: this.documentTypeFromProviderXml(payload.xml),
        invoiceKind: direction,
        status: duplicate ? 'NEEDS_REVIEW' : 'READY',
        duplicateOfId: duplicate?.duplicateOfId || null,
        duplicateReason: duplicate?.duplicateReason || null,
        duplicateSeverity: duplicate?.duplicateSeverity || null,
        originalName: payload.originalName || `${parsed.faturaNo || sourceRefId}.xml`,
        mimeType: 'application/xml',
        sizeBytes: xmlBuffer.length,
        s3Key,
        currency: parsed.paraBirimi || 'TL',
        belgeNo: parsed.faturaNo || null,
        faturaTarihi: parsed.faturaTarihi || null,
        sellerVkn: parsed.saticiVergiNo || null,
        buyerVkn: parsed.aliciVergiNo || null,
        vendorName: parsed.satici || null,
        customerName: parsed.alici || null,
        totalAmount: money(total),
        ocrStatus: 'SUCCESS',
        ocrEngine: `${cfg.provider.toLowerCase()}-api`,
        ocrConfidence: 1,
        ocrData: {
          provider: cfg.provider,
          source: 'provider-api',
          direction,
          matrah: parsed.matrah,
          kdvTutari: parsed.kdvTutari,
          kdvOrani: parsed.kdvOrani,
          ettn: parsed.ettn,
        },
        createdBy: userId || null,
        lines: { create: lines },
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    return { created: true, document: doc };
  }

  private documentTypeFromProviderXml(xml: string) {
    return /EARSIV|E-ARSIV|EARCHIVE|E-ARCHIVE/i.test(xml) ? 'E_ARSIV' : 'E_FATURA';
  }

  private parseProviderUblInvoice(xml: string): ParsedProviderInvoice | null {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@',
        removeNSPrefix: true,
      });
      const parsed = parser.parse(xml);
      const findRoot = (obj: any): any => {
        if (!obj || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
          if (/^(Invoice|CreditNote)$/i.test(key)) return obj[key];
        }
        for (const key of Object.keys(obj)) {
          const inner = findRoot(obj[key]);
          if (inner) return inner;
        }
        return null;
      };
      const root = findRoot(parsed);
      if (!root) return null;
      const get = (path: string[]) => {
        let cur = root;
        for (const part of path) {
          if (!cur) return undefined;
          cur = cur[part];
        }
        return cur;
      };
      const txt = (value: any): string | undefined => {
        if (value == null) return undefined;
        if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
        if (Array.isArray(value)) return txt(value[0]);
        if (typeof value === 'object') return txt(value['#text'] ?? value._);
        return undefined;
      };
      const asArray = (value: any): any[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
      const digits = (value: any): string | undefined => {
        const cleaned = String(value || '').replace(/\D/g, '');
        return cleaned.length === 10 || cleaned.length === 11 ? cleaned : undefined;
      };
      const idText = (node: any): string | undefined => txt(node?.ID) || txt(node?.CompanyID) || txt(node);
      const idScheme = (node: any): string =>
        String(node?.ID?.['@schemeID'] || node?.CompanyID?.['@schemeID'] || node?.['@schemeID'] || '').toUpperCase();
      const taxNoFromParty = (party: any): string | undefined => {
        const nodes = [
          ...asArray(party?.PartyTaxScheme),
          ...asArray(party?.PartyIdentification),
          ...asArray(party?.PartyLegalEntity),
        ];
        for (const node of nodes) {
          const no = digits(idText(node));
          const scheme = idScheme(node);
          if (no && (scheme === 'VKN' || scheme === 'TCKN')) return no;
        }
        for (const node of nodes) {
          const no = digits(idText(node));
          if (no) return no;
        }
        return undefined;
      };
      const taxNoFromXmlBlock = (tag: string): string | undefined => {
        const block = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, 'i'))?.[1] || '';
        return (
          block.match(/<[^>]*(?:ID|CompanyID)[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>\s*(\d{10,11})\s*<\//i)?.[1] ||
          block.match(/<[^>]*CompanyID[^>]*>\s*(\d{10,11})\s*<\//i)?.[1]
        );
      };
      const num = (value: any): number | undefined => {
        const raw = txt(value);
        if (!raw) return undefined;
        const normalized = raw.includes(',')
          ? raw.replace(/\./g, '').replace(',', '.')
          : raw.replace(/[^\d.-]/g, '');
        const n = Number(normalized);
        return Number.isFinite(n) ? n : undefined;
      };
      const faturaNo = txt(get(['ID'])) || '';
      const ettn = txt(get(['UUID']));
      const issueDateRaw = txt(get(['IssueDate']));
      const issueDate = issueDateRaw ? new Date(issueDateRaw) : null;
      const supplier = get(['AccountingSupplierParty', 'Party']);
      const customer = get(['AccountingCustomerParty', 'Party']);
      const monetaryTotal = get(['LegalMonetaryTotal']) || get(['RequestedMonetaryTotal']);
      const taxTotalRaw = get(['TaxTotal']);
      const taxTotal = Array.isArray(taxTotalRaw) ? taxTotalRaw[0] : taxTotalRaw;
      const matrah = num(monetaryTotal?.TaxExclusiveAmount) ?? num(monetaryTotal?.LineExtensionAmount);
      const kdvTutari = num(taxTotal?.TaxAmount);
      const toplamTutar = num(monetaryTotal?.TaxInclusiveAmount) ?? num(monetaryTotal?.PayableAmount);
      return {
        faturaNo: faturaNo || ettn || 'BILINMIYOR',
        faturaTarihi: issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate : null,
        ettn,
        satici: txt(supplier?.PartyName?.Name) || txt(supplier?.PartyLegalEntity?.RegistrationName) || null,
        saticiVergiNo: taxNoFromParty(supplier) || taxNoFromXmlBlock('AccountingSupplierParty') || null,
        alici: txt(customer?.PartyName?.Name) || txt(customer?.PartyLegalEntity?.RegistrationName) || null,
        aliciVergiNo: taxNoFromParty(customer) || taxNoFromXmlBlock('AccountingCustomerParty') || null,
        matrah,
        kdvTutari,
        kdvOrani: matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : null,
        toplamTutar,
        paraBirimi: (txt(get(['DocumentCurrencyCode'])) || 'TRY') === 'TRY' ? 'TL' : txt(get(['DocumentCurrencyCode'])) || 'TL',
      };
    } catch (e: any) {
      this.logger.warn(`Provider XML parse hata: ${e?.message || e}`);
      return null;
    }
  }

  private regexProviderInvoiceFallback(xml: string): ParsedProviderInvoice | null {
    const id = this.tagText(xml, 'ID');
    const uuid = this.tagText(xml, 'UUID');
    if (!id && !uuid) return null;
    const dateRaw = this.tagText(xml, 'IssueDate');
    const issueDate = dateRaw ? new Date(dateRaw) : null;
    const amount = (tag: string) => {
      const raw = this.tagText(xml, tag);
      if (!raw) return undefined;
      const normalized = raw.includes(',')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/[^\d.-]/g, '');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : undefined;
    };
    const matrah = amount('TaxExclusiveAmount') ?? amount('LineExtensionAmount');
    const kdvTutari = amount('TaxAmount');
    const toplamTutar = amount('TaxInclusiveAmount') ?? amount('PayableAmount');
    return {
      faturaNo: id || uuid || 'BILINMIYOR',
      faturaTarihi: issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate : null,
      ettn: uuid || null,
      matrah,
      kdvTutari,
      kdvOrani: matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : null,
      toplamTutar,
      paraBirimi: 'TL',
    };
  }

  private async findDuplicate(
    tenantId: string,
    input: {
      taxpayerId?: string | null;
      belgeNo?: string | null;
      sellerVkn?: string | null;
      buyerVkn?: string | null;
      totalAmount?: string | number | null;
      imageHash?: string | null;
    },
    excludeId?: string,
  ): Promise<DuplicateSignal> {
    const notSelf = excludeId ? { id: { not: excludeId } } : {};
    if (input.imageHash) {
      const byHash = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { tenantId, imageHash: input.imageHash, ...notSelf },
        select: { id: true, belgeNo: true, originalName: true },
      });
      if (byHash) {
        return {
          duplicateOfId: byHash.id,
          duplicateReason: `Aynı belge görseli daha önce işlendi (${byHash.belgeNo || byHash.originalName})`,
          duplicateSeverity: 'BLOCKING',
        };
      }
    }

    const belgeNo = input.belgeNo?.trim();
    const total = money(input.totalAmount);
    const vkns = [input.sellerVkn, input.buyerVkn].map((v) => v?.trim()).filter(Boolean);
    if (belgeNo && total && vkns.length) {
      const byFields = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: {
          tenantId,
          belgeNo,
          ...(input.taxpayerId ? { taxpayerId: input.taxpayerId } : {}),
          totalAmount: total,
          OR: [
            { sellerVkn: { in: vkns } },
            { buyerVkn: { in: vkns } },
          ],
          ...notSelf,
        },
        select: { id: true, belgeNo: true, vendorName: true, customerName: true },
      });
      if (byFields) {
        return {
          duplicateOfId: byFields.id,
          duplicateReason: `Belge no/VKN/tutar daha önce eşleşti (${byFields.belgeNo || byFields.vendorName || byFields.customerName})`,
          duplicateSeverity: 'BLOCKING',
        };
      }
    }
    return null;
  }

  private linesFromOcr(ocrResult: OcrResult | null) {
    const breakdown = ocrResult?.kdvBreakdown || [];
    const total = money(ocrResult?.totalTutari) || new Prisma.Decimal(0);
    const kdvTotal = breakdown.length
      ? breakdown.reduce((sum, item) => sum.plus(item.tutar || 0), new Prisma.Decimal(0))
      : money(ocrResult?.kdvTutari) || new Prisma.Decimal(0);
    const matrah = Prisma.Decimal.max(total.minus(kdvTotal), new Prisma.Decimal(0));
    const lines: any[] = [
      {
        group: 'matrah',
        accountCode: '770.01.010',
        description: ocrResult?.kategori ? `Gider / ${ocrResult.kategori}` : 'Gider / matrah',
        debit: matrah,
        credit: new Prisma.Decimal(0),
        orderNo: 0,
      },
    ];

    if (breakdown.length) {
      breakdown.forEach((item, idx) => {
        lines.push({
          group: 'vergi',
          accountCode: `191.01.${String(item.oran).padStart(3, '0')}`,
          description: 'Indirilecek KDV',
          rate: `%${item.oran}`,
          debit: new Prisma.Decimal(item.tutar || 0),
          credit: new Prisma.Decimal(0),
          orderNo: idx + 1,
        });
      });
    } else if (kdvTotal.gt(0)) {
      lines.push({
        group: 'vergi',
        accountCode: '191.01.020',
        description: 'Indirilecek KDV',
        rate: '%20',
        debit: kdvTotal,
        credit: new Prisma.Decimal(0),
        orderNo: 1,
      });
    }

    lines.push({
      group: 'cari',
      accountCode: '320.01.001',
      description: ocrResult?.satici || 'Cari hesap',
      debit: new Prisma.Decimal(0),
      credit: total,
      orderNo: lines.length,
    });
    return lines;
  }

  private linesFromAmounts(opts: {
    invoiceKind: string;
    matrah: any;
    kdvTutari: any;
    kdvOrani: any;
    total: any;
    vendorName?: string | null;
    // v2.1: çoklu KDV oranı detayı varsa her oran için ayrı yevmiye satırı üret
    kdvBreakdown?: Array<{ rate: number; base: number; amount: number }> | null;
  }) {
    const isSale = opts.invoiceKind === 'SATIS';
    const kdvCode = isSale ? '391.01.020' : '191.01.020';
    const cariCode = isSale ? '120.01.001' : '320.01.001';
    const matrahCode = isSale ? '600.01.001' : '770.01.010';
    const zero = () => new Prisma.Decimal(0);

    // Breakdown geçerli mi? — En az bir satırda base veya amount > 0 olmalı
    const breakdown = Array.isArray(opts.kdvBreakdown) ? opts.kdvBreakdown : [];
    const hasBreakdown = breakdown.some((b) => Number(b.base || 0) > 0 || Number(b.amount || 0) > 0);

    const lines: any[] = [];
    let orderNo = 0;

    if (hasBreakdown) {
      // Her KDV oranı için ayrı matrah + KDV satırı; en sonda tek cari satırı.
      // Toplam = sum(base) + sum(amount)
      let totalBase = new Prisma.Decimal(0);
      let totalKdv = new Prisma.Decimal(0);
      for (const item of breakdown) {
        const base = money(item.base) || zero();
        const amount = money(item.amount) || zero();
        totalBase = totalBase.plus(base);
        totalKdv = totalKdv.plus(amount);
        const rateLabel = item.rate ? `%${Number(item.rate).toLocaleString('tr-TR')}` : undefined;

        // Matrah satırı (alış için Borç, satış için Alacak)
        lines.push({
          group: 'matrah',
          accountCode: matrahCode,
          description: isSale ? `Satış matrahı (KDV ${rateLabel || ''})`.trim() : `Gider / matrah (KDV ${rateLabel || ''})`.trim(),
          rate: rateLabel,
          debit: isSale ? zero() : base,
          credit: isSale ? base : zero(),
          orderNo: orderNo++,
        });
        // KDV satırı (sadece tutar > 0 ise yaz)
        if (Number(item.amount || 0) > 0) {
          lines.push({
            group: 'vergi',
            accountCode: kdvCode,
            description: isSale ? `Hesaplanan KDV ${rateLabel || ''}`.trim() : `İndirilecek KDV ${rateLabel || ''}`.trim(),
            rate: rateLabel,
            debit: isSale ? zero() : amount,
            credit: isSale ? amount : zero(),
            orderNo: orderNo++,
          });
        }
      }
      const total = totalBase.plus(totalKdv);
      lines.push({
        group: 'cari',
        accountCode: cariCode,
        description: opts.vendorName || 'Cari hesap',
        debit: isSale ? total : zero(),
        credit: isSale ? zero() : total,
        orderNo: orderNo++,
      });
      return lines;
    }

    // Tek-oran fallback (eski davranış)
    const matrah = money(opts.matrah) || zero();
    const kdv = money(opts.kdvTutari) || zero();
    const total = money(opts.total) || matrah.plus(kdv);
    const rate = opts.kdvOrani ? `%${Number(opts.kdvOrani).toLocaleString('tr-TR')}` : undefined;

    return [
      {
        group: 'matrah',
        accountCode: matrahCode,
        description: isSale ? 'Satış matrahı' : 'Gider / matrah',
        debit: isSale ? zero() : matrah,
        credit: isSale ? matrah : zero(),
        orderNo: 0,
      },
      {
        group: 'vergi',
        accountCode: kdvCode,
        description: isSale ? 'Hesaplanan KDV' : 'İndirilecek KDV',
        rate,
        debit: isSale ? zero() : kdv,
        credit: isSale ? kdv : zero(),
        orderNo: 1,
      },
      {
        group: 'cari',
        accountCode: cariCode,
        description: opts.vendorName || 'Cari hesap',
        debit: isSale ? total : zero(),
        credit: isSale ? zero() : total,
        orderNo: 2,
      },
    ];
  }

  /**
   * v2.2 — taxpayerId boş olan belgeleri, sellerVkn/buyerVkn üzerinden mevcut mukelleflere bağla.
   * Taxpayer.taxNumber şifreli tutulabildiği için tüm aktif mukelleflerin
   * decrypt'lenmiş VKN/TC'lerini bir map'e alıp belgelerin sellerVkn/buyerVkn
   * alanlarıyla karşılaştırırız.
   * Alış belgesi → aliciVergiNo/buyerVkn = mukellef VKN'si
   * Satış belgesi → saticiVergiNo/sellerVkn = mukellef VKN'si
   */
  async matchOrphansToTaxpayers(
    tenantId: string,
    opts: { period?: string } = {},
  ): Promise<{ matched: number; stillOrphan: number; notFoundExamples: string[] }> {
    // 1) Tenant mukellef VKN/TC'lerini topla (decrypt edilmiş)
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, taxNumber: true },
    });
    const byVkn = new Map<string, string>();
    for (const t of taxpayers) {
      if (!t.taxNumber) continue;
      const decoded = String(tryDecrypt(t.taxNumber) || t.taxNumber).replace(/\D/g, '');
      if (decoded) byVkn.set(decoded, t.id);
    }
    if (byVkn.size === 0) return { matched: 0, stillOrphan: 0, notFoundExamples: [] };

    // 2) Orphan belgeleri çek (period filtresi opsiyonel)
    const where: any = { tenantId, taxpayerId: null };
    Object.assign(where, periodWhere(opts.period));
    const orphans = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where,
      select: { id: true, invoiceKind: true, sellerVkn: true, buyerVkn: true },
      take: 5000,
    });

    let matched = 0;
    let stillOrphan = 0;
    const notFoundVkns = new Set<string>();
    for (const d of orphans) {
      const isSale = String(d.invoiceKind || '').toUpperCase() === 'SATIS';
      const expectedVkn = String(isSale ? d.sellerVkn : d.buyerVkn || '').replace(/\D/g, '');
      const taxpayerId = expectedVkn ? byVkn.get(expectedVkn) : undefined;
      if (taxpayerId) {
        await (this.prisma as any).invoiceAccountingDocument.update({
          where: { id: d.id },
          data: { taxpayerId },
        });
        matched++;
        // Tekrar validation çalıştır (taxpayer eşleşti → OWNERSHIP_MISMATCH kalktı)
        await this.revalidateDocument(tenantId, d.id).catch(() => null);
      } else {
        stillOrphan++;
        if (expectedVkn) notFoundVkns.add(expectedVkn);
      }
    }

    return {
      matched,
      stillOrphan,
      notFoundExamples: Array.from(notFoundVkns).slice(0, 10),
    };
  }

  /**
   * v2.1 — Belge validation pipeline.
   * 3 tip kontrol yapar:
   *   1) INCOMPLETE_AMOUNTS: matrah/KDV eksik veya 0 ama belge toplamı > 0
   *   2) BALANCE_MISMATCH: yevmiye satırlarında debit toplam ≠ credit toplam
   *   3) TOTAL_MISMATCH: yevmiye toplamı belge üzerindeki toplam tutardan farklı
   *   4) OWNERSHIP_MISMATCH: alış faturasında aliciVergiNo, satışta saticiVergiNo
   *      mükellefin VKN/TC'siyle eşleşmiyor
   *
   * status: OK | INCOMPLETE | INVALID
   *   - OK = tüm kontroller geçti
   *   - INCOMPLETE = veri eksik (kullanıcı doldurmalı)
   *   - INVALID = veri var ama hatalı (denge bozuk veya sahip yanlış)
   */
  async runValidation(opts: {
    tenantId: string;
    taxpayerId?: string | null;
    invoiceKind: string;
    lines: Array<{ debit: any; credit: any; group?: string }>;
    totalAmount?: any;
    sellerVkn?: string | null;
    buyerVkn?: string | null;
    matrah?: any;
    kdvTutari?: any;
    kdvBreakdown?: Array<{ rate: number; base: number; amount: number }> | null;
  }): Promise<{
    status: 'OK' | 'INCOMPLETE' | 'INVALID';
    issues: Array<{ code: string; severity: 'WARNING' | 'ERROR'; message: string; expected?: any; actual?: any }>;
  }> {
    const issues: Array<{ code: string; severity: 'WARNING' | 'ERROR'; message: string; expected?: any; actual?: any }> = [];

    const totalAmount = Number(opts.totalAmount || 0);
    const sumDebit = opts.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumCredit = opts.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    const TOL = 0.02; // 2 kuruş tolerans (decimal yuvarlamalar için)

    // ── 1) INCOMPLETE_AMOUNTS — toplam var ama matrah/KDV eksik
    const matrahN = Number(opts.matrah || 0);
    const kdvN = Number(opts.kdvTutari || 0);
    const breakdownSumBase = Array.isArray(opts.kdvBreakdown)
      ? opts.kdvBreakdown.reduce((s, b) => s + Number(b.base || 0), 0)
      : 0;
    const breakdownSumKdv = Array.isArray(opts.kdvBreakdown)
      ? opts.kdvBreakdown.reduce((s, b) => s + Number(b.amount || 0), 0)
      : 0;
    const hasAnyMatrah = matrahN > 0 || breakdownSumBase > 0;
    if (totalAmount > 0 && !hasAnyMatrah) {
      issues.push({
        code: 'INCOMPLETE_AMOUNTS',
        severity: 'ERROR',
        message: `Belge toplamı ${totalAmount.toLocaleString('tr-TR')} ₺ ama matrah/KDV ayrıştırılamadı. Manuel girilmesi gerek.`,
        expected: 'matrah > 0',
        actual: 0,
      });
    }

    // ── 2) BALANCE_MISMATCH — borç ≠ alacak
    if (Math.abs(sumDebit - sumCredit) > TOL) {
      issues.push({
        code: 'BALANCE_MISMATCH',
        severity: 'ERROR',
        message: `Yevmiye dengesiz: Borç ${sumDebit.toLocaleString('tr-TR')} ₺ ≠ Alacak ${sumCredit.toLocaleString('tr-TR')} ₺`,
        expected: sumCredit,
        actual: sumDebit,
      });
    }

    // ── 3) TOTAL_MISMATCH — yevmiye toplamı ≠ belge toplamı
    if (totalAmount > 0) {
      const yevmiyeToplam = Math.max(sumDebit, sumCredit);
      if (Math.abs(yevmiyeToplam - totalAmount) > TOL) {
        issues.push({
          code: 'TOTAL_MISMATCH',
          severity: 'ERROR',
          message: `Belge tutarı ${totalAmount.toLocaleString('tr-TR')} ₺ ama yevmiye toplamı ${yevmiyeToplam.toLocaleString('tr-TR')} ₺ — uyumsuz.`,
          expected: totalAmount,
          actual: yevmiyeToplam,
        });
      }
    }

    // ── 4) OWNERSHIP_MISMATCH — VKN/TC sahiplik kontrolü
    if (opts.taxpayerId) {
      const taxpayer = await (this.prisma as any).taxpayer.findFirst({
        where: { id: opts.taxpayerId, tenantId: opts.tenantId },
        select: { taxNumber: true, companyName: true, firstName: true, lastName: true },
      });
      if (taxpayer?.taxNumber) {
        // taxNumber şifreli olabilir
        const ownVkn = String(tryDecrypt(taxpayer.taxNumber) || taxpayer.taxNumber).replace(/\D/g, '');
        const isSale = String(opts.invoiceKind || '').toUpperCase() === 'SATIS';
        const expectedVkn = isSale
          ? String(opts.sellerVkn || '').replace(/\D/g, '')
          : String(opts.buyerVkn || '').replace(/\D/g, '');
        if (ownVkn && expectedVkn && ownVkn !== expectedVkn) {
          const ownerName = taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim();
          issues.push({
            code: 'OWNERSHIP_MISMATCH',
            severity: 'ERROR',
            message: `Bu belge ${ownerName || 'mükellefin'} VKN/TC'sine ait değil. ${isSale ? 'Satıcı' : 'Alıcı'} VKN ${expectedVkn} → beklenen ${ownVkn}.`,
            expected: ownVkn,
            actual: expectedVkn,
          });
        }
      }
    }

    // Sonuç durumu
    const hasIncomplete = issues.some((i) => i.code === 'INCOMPLETE_AMOUNTS');
    const hasInvalid = issues.some((i) => i.code !== 'INCOMPLETE_AMOUNTS' && i.severity === 'ERROR');
    const status = hasInvalid ? 'INVALID' : hasIncomplete ? 'INCOMPLETE' : 'OK';
    return { status, issues };
  }

  private async rematchPendingDocumentsWithAccountPlan(tenantId: string, taxpayerId: string, snapshotId: string) {
    const [accounts, docs] = await Promise.all([
      (this.prisma as any).lucaAccountPlanLine.findMany({
        where: { snapshotId },
        orderBy: [{ accountCode: 'asc' }],
        select: { accountCode: true, accountName: true },
      }),
      (this.prisma as any).invoiceAccountingDocument.findMany({
        where: {
          tenantId,
          taxpayerId,
          status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] },
        },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
        take: 500,
      }),
    ]);
    if (!accounts.length || !docs.length) return;

    for (const doc of docs) {
      const isSale = doc.invoiceKind === 'SATIS';
      const vendorName = isSale ? doc.customerName : doc.vendorName;
      const replacements = {
        matrah: this.pickAccount(accounts, isSale ? ['600'] : ['770', '760', '740', '730', ' gider '], vendorName),
        vergi: this.pickAccount(accounts, isSale ? ['391'] : ['191'], null),
        cari: this.pickAccount(accounts, isSale ? ['120'] : ['320', '329', '331'], vendorName),
      };

      for (const line of doc.lines || []) {
        const group = String(line.group || '') as 'matrah' | 'vergi' | 'cari';
        const match = replacements[group];
        if (!match) continue;
        const current = String(line.accountCode || '');
        const isPlaceholder =
          !current ||
          ['770.01.010', '760.01.001', '740.01.001', '600.01.001', '191.01.020', '391.01.020', '320.01.001', '120.01.001'].includes(current);
        if (!isPlaceholder) continue;
        await (this.prisma as any).invoiceAccountingLine.update({
          where: { id: line.id },
          data: {
            accountCode: match.accountCode,
            description: group === 'cari' ? match.accountName : line.description,
          },
        });
      }
    }
  }

  private pickAccount(
    accounts: Array<{ accountCode: string; accountName: string }>,
    prefixesOrNeedles: string[],
    nameHint?: string | null,
  ) {
    const hint = this.norm(nameHint || '');
    const candidates = accounts.filter((a) => {
      const code = String(a.accountCode || '');
      const name = ` ${this.norm(a.accountName || '')} `;
      return prefixesOrNeedles.some((p) => {
        const key = p.trim();
        if (/^\d/.test(key)) return code.startsWith(key);
        return name.includes(this.norm(key));
      });
    });
    if (!candidates.length) return null;
    if (hint) {
      const hinted = candidates.find((a) => this.norm(a.accountName || '').includes(hint.slice(0, 18)));
      if (hinted) return hinted;
    }
    return candidates[candidates.length - 1];
  }

  private norm(value: string) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
