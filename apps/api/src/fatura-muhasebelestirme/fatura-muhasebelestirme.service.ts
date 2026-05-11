import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService, OcrResult } from '../kdv-control/ocr.service';

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

type DuplicateSignal = {
  duplicateOfId: string;
  duplicateReason: string;
  duplicateSeverity: 'WARNING' | 'BLOCKING';
} | null;

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
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(n.toFixed(2));
}

@Injectable()
export class FaturaMuhasebelestirmeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}

  async list(tenantId: string, opts: { status?: string; limit?: number; taxpayerId?: string }) {
    return (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.limit || 100, 1), 500),
    });
  }

  async dashboard(tenantId: string) {
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
        where: { tenantId, taxpayerId: { not: null } },
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
        ledgerType: tp.mihsapDefterTuru || tp.defterTuru || '-',
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
      },
    });
    return {
      source: latest,
      accounts: rows.map((r: any) => ({
        id: r.id,
        code: r.accountCode,
        name: r.accountName,
        level: r.level,
        debitBalance: Number(r.debitBalance || 0),
        creditBalance: Number(r.creditBalance || 0),
      })),
    };
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

    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, source: 'earsiv', sourceRefId: f.id },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    if (existing) return { created: false, duplicate: true, document: existing };

    const documentType = f.belgeKaynak === 'EFATURA' ? 'E_FATURA' : 'E_ARSIV';
    const invoiceKind = f.tip === 'SATIS' ? 'SATIS' : 'ALIS';
    const originalName = `${f.faturaNo || f.id}.${f.pdfStorageKey ? 'pdf' : f.htmlStorageKey ? 'html' : 'xml'}`;
    const s3Key =
      f.pdfStorageKey ||
      f.htmlStorageKey ||
      `earsiv-inline://${f.id}`;
    const sizeBytes = f.pdfStorageKey || f.htmlStorageKey ? 1 : Buffer.byteLength(f.xmlContent || '', 'utf8');
    const lines = this.linesFromAmounts({
      invoiceKind,
      matrah: f.matrah,
      kdvTutari: f.kdvTutari,
      kdvOrani: f.kdvOrani,
      total: f.toplamTutar,
      vendorName: invoiceKind === 'ALIS' ? f.satici : f.alici,
    });
    const duplicate = await this.findDuplicate(tenantId, {
      taxpayerId: f.taxpayerId,
      belgeNo: f.faturaNo,
      sellerVkn: f.saticiVergiNo,
      buyerVkn: f.aliciVergiNo,
      totalAmount: f.toplamTutar,
    });

    const doc = await (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId: f.taxpayerId,
        source: 'earsiv',
        sourceRefId: f.id,
        documentType,
        invoiceKind,
        status: duplicate ? 'NEEDS_REVIEW' : 'READY',
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
        },
        lines: { create: lines },
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });

    return { created: true, document: doc };
  }

  async backfillFromExistingEarsiv(
    tenantId: string,
    opts: { taxpayerId?: string; donem?: string; tip?: string; belgeKaynak?: string; limit?: number } = {},
  ) {
    const where: any = { tenantId };
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
    if (String(doc.s3Key || '').startsWith('earsiv-inline://')) {
      return { url: '' };
    }
    const url = await this.storage.getPresignedDownloadUrl(doc.s3Key, doc.originalName);
    return { url };
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

    return this.get(tenantId, id);
  }

  async approve(tenantId: string, id: string, userId?: string) {
    await this.get(tenantId, id);
    return (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: userId || null,
        approvedAt: new Date(),
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const doc = await this.get(tenantId, id);
    await (this.prisma as any).invoiceAccountingDocument.delete({ where: { id } });
    if (!String(doc.s3Key || '').startsWith('earsiv-inline://')) {
      this.storage.deleteObject(doc.s3Key).catch(() => {});
    }
    return { deleted: true };
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
  }) {
    const isSale = opts.invoiceKind === 'SATIS';
    const matrah = money(opts.matrah) || new Prisma.Decimal(0);
    const kdv = money(opts.kdvTutari) || new Prisma.Decimal(0);
    const total = money(opts.total) || matrah.plus(kdv);
    const kdvCode = isSale ? '391.01.020' : '191.01.020';
    const cariCode = isSale ? '120.01.001' : '320.01.001';
    const matrahCode = isSale ? '600.01.001' : '770.01.010';
    const rate = opts.kdvOrani ? `%${Number(opts.kdvOrani).toLocaleString('tr-TR')}` : undefined;

    return [
      {
        group: 'matrah',
        accountCode: matrahCode,
        description: isSale ? 'Satış matrahı' : 'Gider / matrah',
        debit: isSale ? new Prisma.Decimal(0) : matrah,
        credit: isSale ? matrah : new Prisma.Decimal(0),
        orderNo: 0,
      },
      {
        group: 'vergi',
        accountCode: kdvCode,
        description: isSale ? 'Hesaplanan KDV' : 'Indirilecek KDV',
        rate,
        debit: isSale ? new Prisma.Decimal(0) : kdv,
        credit: isSale ? kdv : new Prisma.Decimal(0),
        orderNo: 1,
      },
      {
        group: 'cari',
        accountCode: cariCode,
        description: opts.vendorName || 'Cari hesap',
        debit: isSale ? total : new Prisma.Decimal(0),
        credit: isSale ? new Prisma.Decimal(0) : total,
        orderNo: 2,
      },
    ];
  }
}
