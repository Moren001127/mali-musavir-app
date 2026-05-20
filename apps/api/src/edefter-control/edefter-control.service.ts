import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LucaService } from '../luca/luca.service';
import {
  EDefterFisListesiParserService,
  ParsedEDefterFisLine,
} from './edefter-fis-listesi-parser.service';

export type EDefterDonemTipi =
  | 'AYLIK'
  | 'GECICI_Q1'
  | 'GECICI_Q2'
  | 'GECICI_Q3'
  | 'GECICI_Q4'
  | 'YILLIK';

type FindingDraft = {
  severity: 'INFO' | 'WARN' | 'ERROR';
  category: string;
  message: string;
  voucherKey?: string | null;
  rowIndex?: number | null;
  hesapKodu?: string | null;
  detail?: Record<string, unknown>;
};

@Injectable()
export class EDefterControlService {
  private readonly logger = new Logger(EDefterControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly luca: LucaService,
    private readonly parser: EDefterFisListesiParserService,
  ) {}

  async listSessions(tenantId: string, taxpayerId?: string) {
    const sessions = await (this.prisma as any).eDefterControlSession.findMany({
      where: { tenantId, ...(taxpayerId ? { taxpayerId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { lines: true, findings: true } },
      },
      take: 80,
    });

    const taxpayerIds = [...new Set(sessions.map((s: any) => s.taxpayerId).filter(Boolean))];
    const taxpayers = taxpayerIds.length
      ? await (this.prisma as any).taxpayer.findMany({
          where: { id: { in: taxpayerIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
        })
      : [];
    const taxpayerMap = new Map(taxpayers.map((t: any) => [t.id, t]));
    return sessions.map((s: any) => ({ ...s, taxpayer: taxpayerMap.get(s.taxpayerId) || null }));
  }

  async getSession(id: string, tenantId: string) {
    const session = await (this.prisma as any).eDefterControlSession.findFirst({
      where: { id, tenantId },
      include: {
        lines: { orderBy: { rowIndex: 'asc' }, take: 1000 },
        findings: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!session) throw new NotFoundException('e-Defter kontrol oturumu bulunamadi');

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: session.taxpayerId, tenantId },
      select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
    });
    return { ...session, taxpayer: taxpayer || null };
  }

  async createFetchJob(params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    donemTipi?: EDefterDonemTipi;
    targetDeviceId?: string;
    createdBy?: string;
  }) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: params.mukellefId, tenantId: params.tenantId },
      select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const requestedDeviceId = params.targetDeviceId?.trim() || undefined;
    const targetDeviceId =
      requestedDeviceId && !/^DEV-/i.test(requestedDeviceId) ? requestedDeviceId : undefined;

    const job = await this.luca.createFetchJob({
      tenantId: params.tenantId,
      sessionId: undefined as any,
      mukellefId: params.mukellefId,
      donem: params.donem,
      donemTipi: params.donemTipi,
      tip: 'EDEFTER_FIS_LISTESI',
      createdBy: params.createdBy,
      targetDeviceId,
      preferredAgent: 'local-node',
      mukellefAdi:
        taxpayer.companyName ||
        [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') ||
        taxpayer.taxNumber ||
        '',
    });

    await this.luca
      .appendJobLog(job.id, 'e-Defter on kontrol icin Detay Fis Listesi cekimi siraya alindi')
      .catch(() => undefined);
    return job;
  }

  async importFromExcel(params: {
    tenantId: string;
    taxpayerId: string;
    donem: string;
    donemTipi?: EDefterDonemTipi;
    buffer: Buffer;
    createdBy?: string;
  }) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: params.taxpayerId, tenantId: params.tenantId },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const donemTipi = this.normalizeDonemTipi(params.donem, params.donemTipi);
    const range = this.donemToRange(params.donem, donemTipi);
    let rows: ParsedEDefterFisLine[];
    try {
      rows = this.parser.parse(params.buffer, { defaultYear: range?.start.getUTCFullYear() });
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Detay Fis Listesi Excel parse edilemedi');
    }

    const old = await (this.prisma as any).eDefterControlSession.findMany({
      where: {
        tenantId: params.tenantId,
        taxpayerId: params.taxpayerId,
        donem: params.donem,
        donemTipi,
      },
      select: { id: true },
    });
    if (old.length) {
      await (this.prisma as any).eDefterControlSession.deleteMany({
        where: { id: { in: old.map((s: any) => s.id) } },
      });
    }

    const voucherCount = new Set(rows.map((r) => r.voucherKey)).size;
    const session = await (this.prisma as any).eDefterControlSession.create({
      data: {
        tenantId: params.tenantId,
        taxpayerId: params.taxpayerId,
        donem: params.donem,
        donemTipi,
        donemBaslangic: range?.start || null,
        donemBitis: range?.end || null,
        kaynak: 'LUCA',
        status: 'READY',
        totalLines: rows.length,
        totalVouchers: voucherCount,
        rawExcelBytes: params.buffer,
        rawExcelSize: params.buffer.byteLength,
        createdBy: params.createdBy || null,
      },
    });

    const lineRows = rows.map((r) => ({
      sessionId: session.id,
      rowIndex: r.rowIndex,
      voucherKey: r.voucherKey,
      fisNo: this.slice(r.fisNo, 80),
      yevmiyeNo: this.slice(r.yevmiyeNo, 80),
      fisTarihi: r.fisTarihi || null,
      fisTipi: this.slice(r.fisTipi, 80),
      evrakNo: this.slice(r.evrakNo, 120),
      evrakTarihi: r.evrakTarihi || null,
      belgeTuru: this.slice(r.belgeTuru, 80),
      hesapKodu: this.slice(r.hesapKodu, 80),
      hesapAdi: this.slice(r.hesapAdi, 240),
      aciklama: this.slice(r.aciklama, 600),
      karsiHesap: this.slice(r.karsiHesap, 120),
      vknTckn: this.slice(r.vknTckn, 20),
      borc: r.borc || 0,
      alacak: r.alacak || 0,
      rawData: r.rawData || null,
    }));
    for (const chunk of this.chunks(lineRows, 700)) {
      await (this.prisma as any).eDefterVoucherLine.createMany({ data: chunk });
    }

    const findings = this.analyze(rows, range);
    if (findings.length) {
      for (const chunk of this.chunks(findings, 700)) {
        await (this.prisma as any).eDefterFinding.createMany({
          data: chunk.map((f) => ({
            sessionId: session.id,
            severity: f.severity,
            category: f.category,
            message: f.message,
            voucherKey: f.voucherKey || null,
            rowIndex: f.rowIndex || null,
            hesapKodu: f.hesapKodu || null,
            detail: f.detail || null,
          })),
        });
      }
    }

    await (this.prisma as any).eDefterControlSession.update({
      where: { id: session.id },
      data: {
        findingCount: findings.length,
        status: findings.some((f) => f.severity === 'ERROR') || findings.length ? 'REVIEWING' : 'READY',
      },
    });

    this.logger.log(
      `e-Defter Detay Fis import: session=${session.id}, satir=${rows.length}, fis=${voucherCount}, bulgu=${findings.length}`,
    );
    return { sessionId: session.id, rows: rows.length, vouchers: voucherCount, findings: findings.length };
  }

  private analyze(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byVoucher = new Map<string, ParsedEDefterFisLine[]>();

    for (const row of rows) {
      if (!byVoucher.has(row.voucherKey)) byVoucher.set(row.voucherKey, []);
      byVoucher.get(row.voucherKey)!.push(row);

      if (!row.hesapKodu) {
        findings.push({
          severity: 'ERROR',
          category: 'HESAP_KODU_EKSIK',
          message: `Satir ${row.rowIndex}: hesap kodu bos.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
        });
      }
      if (!row.fisTarihi) {
        findings.push({
          severity: 'ERROR',
          category: 'FIS_TARIHI_EKSIK',
          message: `Satir ${row.rowIndex}: fis tarihi okunamadi.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      } else if (range && (row.fisTarihi < range.start || row.fisTarihi > range.end)) {
        findings.push({
          severity: 'ERROR',
          category: 'DONEM_DISI_TARIH',
          message: `Satir ${row.rowIndex}: fis tarihi secilen donem disinda (${this.fmtDate(row.fisTarihi)}).`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { expectedStart: range.start.toISOString(), expectedEnd: range.end.toISOString() },
        });
      }
      if (Math.abs((row.borc || 0) - (row.alacak || 0)) > 0.004 && row.borc > 0 && row.alacak > 0) {
        findings.push({
          severity: 'WARN',
          category: 'SATIRDA_BORC_ALACAK_BIRLIKTE',
          message: `Satir ${row.rowIndex}: ayni satirda hem borc hem alacak var.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { borc: row.borc, alacak: row.alacak },
        });
      }
      if ((row.borc || 0) === 0 && (row.alacak || 0) === 0 && row.hesapKodu) {
        findings.push({
          severity: 'INFO',
          category: 'SIFIR_TUTARLI_SATIR',
          message: `Satir ${row.rowIndex}: hesap kodu var ama borc/alacak tutari sifir.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      }
      if (/^191/.test(row.hesapKodu || '') && row.alacak > row.borc) {
        findings.push({
          severity: 'WARN',
          category: '191_TERS_CALISMA',
          message: `Satir ${row.rowIndex}: 191 indirilecek KDV alacak calismis, belge kontrol edilmeli.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { borc: row.borc, alacak: row.alacak },
        });
      }
      if (/^391/.test(row.hesapKodu || '') && row.borc > row.alacak) {
        findings.push({
          severity: 'WARN',
          category: '391_TERS_CALISMA',
          message: `Satir ${row.rowIndex}: 391 hesaplanan KDV borc calismis, belge kontrol edilmeli.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { borc: row.borc, alacak: row.alacak },
        });
      }
    }

    for (const [voucherKey, group] of byVoucher.entries()) {
      const borc = group.reduce((sum, r) => sum + (r.borc || 0), 0);
      const alacak = group.reduce((sum, r) => sum + (r.alacak || 0), 0);
      const fark = Math.abs(borc - alacak);
      const first = group[0];
      if (fark > 0.01) {
        findings.push({
          severity: 'ERROR',
          category: 'FIS_DENGESIZ',
          message: `Fis ${this.voucherLabel(first)} dengede degil. Borc ${this.fmt(borc)}, alacak ${this.fmt(alacak)}, fark ${this.fmt(fark)}.`,
          voucherKey,
          rowIndex: first.rowIndex,
          detail: { borc, alacak, fark, satirSayisi: group.length },
        });
      }
      const hasDocumentAccount = group.some((r) => /^(191|391|120|320|600|601|602|740|760|770)/.test(r.hesapKodu || ''));
      const hasDocumentNo = group.some((r) => !!r.evrakNo);
      if (hasDocumentAccount && !hasDocumentNo) {
        findings.push({
          severity: 'WARN',
          category: 'EVRAK_NO_EKSIK',
          message: `Fis ${this.voucherLabel(first)} belge/evrak no olmadan kaydedilmis gorunuyor.`,
          voucherKey,
          rowIndex: first.rowIndex,
          detail: { satirSayisi: group.length },
        });
      }
    }

    return findings.slice(0, 5000);
  }

  private normalizeDonemTipi(donem: string, donemTipi?: string | null): EDefterDonemTipi {
    const explicit = String(donemTipi || '').trim().toUpperCase();
    if (/^GECICI_Q[1-4]$/.test(explicit)) return explicit as EDefterDonemTipi;
    if (explicit === 'AY' || explicit === 'AYLIK' || explicit === 'MONTH') return 'AYLIK';
    if (explicit === 'YILLIK' || explicit === 'YEAR' || explicit === 'ANNUAL') return 'YILLIK';
    const q = String(donem || '').toUpperCase().match(/Q([1-4])$/);
    if (q) return `GECICI_Q${q[1]}` as EDefterDonemTipi;
    if (/^\d{4}$/.test(String(donem || ''))) return 'YILLIK';
    return 'AYLIK';
  }

  private donemToRange(donem: string, donemTipi: EDefterDonemTipi): { start: Date; end: Date } | null {
    const q = String(donem || '').match(/^(\d{4})[-_/]?Q([1-4])$/i);
    if (q) return this.quarterRange(+q[1], +q[2]);
    const m = String(donem || '').match(/^(\d{4})[-_/](\d{1,2})$/);
    if (m) {
      const year = +m[1];
      const month = +m[2];
      if (/^GECICI_Q[1-4]$/.test(donemTipi)) {
        return this.quarterRange(year, +donemTipi.slice(-1));
      }
      return {
        start: new Date(Date.UTC(year, month - 1, 1)),
        end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
      };
    }
    const y = String(donem || '').match(/^(\d{4})$/);
    if (y) {
      const year = +y[1];
      return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      };
    }
    return null;
  }

  private quarterRange(year: number, quarter: number) {
    const startMonth = (quarter - 1) * 3;
    const endMonth = quarter * 3;
    return {
      start: new Date(Date.UTC(year, startMonth, 1)),
      end: new Date(Date.UTC(year, endMonth, 0, 23, 59, 59, 999)),
    };
  }

  private chunks<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  private slice(value: string | null | undefined, max: number): string | null {
    const text = String(value || '').trim();
    return text ? text.slice(0, max) : null;
  }

  private voucherLabel(row: ParsedEDefterFisLine) {
    return row.yevmiyeNo || row.fisNo || `satir ${row.rowIndex}`;
  }

  private fmt(value: number) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private fmtDate(value: Date) {
    return value.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  }
}
