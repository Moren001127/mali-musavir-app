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
      const doc = await (this.prisma as any).invoiceAccountingDocument.create({
        data: {
          tenantId,
          taxpayerId: opts.taxpayerId || null,
          source: opts.source || 'manual-web',
          documentType: opts.documentType || ocrResult?.belgeTipi || 'OKC_FIS',
          invoiceKind: opts.invoiceKind || 'ALIS',
          status: ocrStatus === 'SUCCESS' ? 'READY' : 'NEEDS_REVIEW',
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          s3Key,
          imageHash: ocrResult?.imageHash || this.ocr.computeImageHash(file.buffer),
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

  async fileUrl(tenantId: string, id: string) {
    const doc = await this.get(tenantId, id);
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
    this.storage.deleteObject(doc.s3Key).catch(() => {});
    return { deleted: true };
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
}
