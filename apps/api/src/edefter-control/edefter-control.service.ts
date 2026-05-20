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

type VoucherMeta = {
  key: string;
  rows: ParsedEDefterFisLine[];
  first: ParsedEDefterFisLine;
  date: Date | null;
  description: string;
  isVatAccrual: boolean;
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
        lines: { orderBy: { rowIndex: 'asc' }, take: 20000 },
        findings: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!session) throw new NotFoundException('e-Defter kontrol oturumu bulunamadi');

    const [taxpayer, companionMizan] = await Promise.all([
      (this.prisma as any).taxpayer.findFirst({
        where: { id: session.taxpayerId, tenantId },
        select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
      }),
      this.findCompanionMizan(tenantId, session.taxpayerId, session.donem, session.donemTipi),
    ]);
    return { ...session, taxpayer: taxpayer || null, companionMizan };
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

    const detailJob = await this.luca.createFetchJob({
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
      .appendJobLog(detailJob.id, 'e-Defter on kontrol icin Detay Fis Listesi cekimi siraya alindi')
      .catch(() => undefined);

    const mizanJob = await this.luca.createFetchJob({
      tenantId: params.tenantId,
      sessionId: undefined as any,
      mukellefId: params.mukellefId,
      donem: params.donem,
      donemTipi: params.donemTipi,
      tip: 'MIZAN',
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
      .appendJobLog(mizanJob.id, 'e-Defter on kontrol icin eslik eden Mizan cekimi siraya alindi')
      .catch(() => undefined);

    return { detailJob, mizanJob };
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

  async findCompanionMizan(
    tenantId: string,
    taxpayerId: string,
    donem: string,
    donemTipi?: string | null,
  ) {
    const mizan = await (this.prisma as any).mizan.findFirst({
      where: {
        tenantId,
        taxpayerId,
        donem,
        ...(donemTipi ? { donemTipi } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { hesaplar: true, anomaliler: true } },
        anomaliler: true,
      },
    });
    if (!mizan) return null;

    const severityRank: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2 };
    const anomaliler = [...(mizan.anomaliler || [])]
      .sort((a: any, b: any) => {
        const severityDiff = (severityRank[a.seviye] ?? 9) - (severityRank[b.seviye] ?? 9);
        if (severityDiff !== 0) return severityDiff;
        return String(a.hesapKodu || '').localeCompare(String(b.hesapKodu || ''), 'tr');
      })
      .slice(0, 80);

    return {
      id: mizan.id,
      status: mizan.status,
      donem: mizan.donem,
      donemTipi: mizan.donemTipi,
      createdAt: mizan.createdAt,
      updatedAt: mizan.updatedAt,
      hesapCount: mizan._count?.hesaplar || 0,
      anomalyCount: mizan._count?.anomaliler || 0,
      anomaliler,
    };
  }

  private analyze(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byVoucher = new Map<string, ParsedEDefterFisLine[]>();

    for (const row of rows) {
      if (!byVoucher.has(row.voucherKey)) byVoucher.set(row.voucherKey, []);
      byVoucher.get(row.voucherKey)!.push(row);
    }

    const voucherMeta = new Map<string, VoucherMeta>();
    for (const [voucherKey, group] of byVoucher.entries()) {
      voucherMeta.set(voucherKey, this.buildVoucherMeta(voucherKey, group));
    }
    for (const row of rows) {
      const meta = voucherMeta.get(row.voucherKey);
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
      if (/^191/.test(row.hesapKodu || '') && row.alacak > row.borc && !meta?.isVatAccrual) {
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
      if (/^391/.test(row.hesapKodu || '') && row.borc > row.alacak && !meta?.isVatAccrual) {
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
      const meta = voucherMeta.get(voucherKey)!;
      const hasReliableVoucherKey = Boolean(first.fisNo || first.yevmiyeNo);
      if (hasReliableVoucherKey && group.length >= 2 && fark > 0.01) {
        findings.push({
          severity: 'ERROR',
          category: 'FIS_DENGESIZ',
          message: `Fis ${this.voucherLabel(first)} dengede degil. Borc ${this.fmt(borc)}, alacak ${this.fmt(alacak)}, fark ${this.fmt(fark)}.`,
          voucherKey,
          rowIndex: first.rowIndex,
          detail: { borc, alacak, fark, satirSayisi: group.length },
        });
      }
      findings.push(...this.analyzeVoucherRisks(meta));
    }

    findings.push(...this.analyzeMonthlyVat(rows, range, voucherMeta));
    findings.push(...this.analyzeDuplicateDocuments(rows, voucherMeta));
    findings.push(...this.analyzeParentAccountUsage(rows));
    findings.push(...this.analyzeDailyCash(rows));
    findings.push(...this.analyzeCostReflectionPeriod(rows));
    findings.push(...this.analyzePeriodAccountingRisks(rows, range, voucherMeta));

    return findings.slice(0, 10000);
  }

  private buildVoucherMeta(key: string, rows: ParsedEDefterFisLine[]): VoucherMeta {
    const first = rows[0];
    const date = rows.find((r) => r.fisTarihi)?.fisTarihi || null;
    const description = rows
      .map((r) => [r.fisTipi, r.belgeTuru, r.aciklama, r.hesapAdi].filter(Boolean).join(' '))
      .join(' ')
      .toLocaleLowerCase('tr-TR');
    return {
      key,
      rows,
      first,
      date,
      description,
      isVatAccrual: this.isVatAccrualVoucher(rows, description),
    };
  }

  private isVatAccrualVoucher(rows: ParsedEDefterFisLine[], description: string) {
    const desc = this.normalizeLoose(description);
    const has191Credit = rows.some((r) => /^191/.test(r.hesapKodu || '') && r.alacak > r.borc);
    const has391Debit = rows.some((r) => /^391/.test(r.hesapKodu || '') && r.borc > r.alacak);
    const hasSettlementAccount = rows.some((r) => /^(190|360)/.test(r.hesapKodu || ''));
    const hasAccrualText = /kdv|tahakkuk|mahsup|beyanname|devreden|odenecek/.test(desc);
    return has191Credit && has391Debit && (hasSettlementAccount || hasAccrualText);
  }

  private analyzeVoucherRisks(meta: VoucherMeta): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const rows = meta.rows;
    const first = meta.first;
    const hasFinancialAccount = rows.some((r) => /^(102|103|108)/.test(r.hesapKodu || ''));
    const cashRows = rows.filter((r) => /^100/.test(r.hesapKodu || '') && this.amountOf(r) >= 30000);
    if (cashRows.length && !hasFinancialAccount) {
      const amount = Math.max(...cashRows.map((r) => this.amountOf(r)));
      findings.push({
        severity: 'WARN',
        category: 'KASA_30000_TEVSIK_RISKI',
        message: `Fis ${this.voucherLabel(first)} icinde 100 Kasa ile ${this.fmt(amount)} TL hareket var. 30.000 TL uzeri tahsilat/odeme banka veya finans kurumu uzerinden tevsik edilmeli.`,
        voucherKey: meta.key,
        rowIndex: cashRows[0].rowIndex,
        hesapKodu: cashRows[0].hesapKodu,
        detail: { amount, limit: 30000 },
      });
    }

    if (rows.some((r) => /^100/.test(r.hesapKodu || '')) && rows.some((r) => /^(131|331)/.test(r.hesapKodu || ''))) {
      findings.push({
        severity: 'WARN',
        category: 'ORTAK_CARI_KASA_KULLANIMI',
        message: `Fis ${this.voucherLabel(first)} kasa ile ortak cari hesabini birlikte calistiriyor; ortak cari kasa gibi kullanilmis olabilir.`,
        voucherKey: meta.key,
        rowIndex: first.rowIndex,
        detail: { accounts: rows.map((r) => r.hesapKodu).filter(Boolean) },
      });
    }

    if (rows.some((r) => /^(159|259|340|349)/.test(r.hesapKodu || '')) && rows.some((r) => /^(100|131|331)/.test(r.hesapKodu || ''))) {
      findings.push({
        severity: 'WARN',
        category: 'AVANS_KASA_ORTAK_CARI_KAPAMA',
        message: `Fis ${this.voucherLabel(first)} avans hesabini kasa veya ortak cari ile kapatiyor; belge ve odeme sekli kontrol edilmeli.`,
        voucherKey: meta.key,
        rowIndex: first.rowIndex,
      });
    }

    const isClosingLike = this.isClosingLikeVoucher(meta);
    const isReflectionVoucher = this.isCostReflectionVoucher(meta);
    for (const row of rows) {
      if (/^60[0-2]/.test(row.hesapKodu || '') && row.borc > row.alacak && !isClosingLike) {
        findings.push({
          severity: 'WARN',
          category: 'GELIR_HESABI_BORC_CALISMA',
          message: `Satir ${row.rowIndex}: ${row.hesapKodu} gelir hesabi borc calismis; iade/duzeltme veya kapanis kaydi olup olmadigi kontrol edilmeli.`,
          voucherKey: meta.key,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { borc: row.borc, alacak: row.alacak },
        });
      }
      if (
        /^7/.test(row.hesapKodu || '') &&
        row.alacak > row.borc &&
        !isClosingLike &&
        !this.isCostReflectionAccount(row.hesapKodu) &&
        !isReflectionVoucher
      ) {
        findings.push({
          severity: 'WARN',
          category: 'GIDER_HESABI_ALACAK_CALISMA',
          message: `Satir ${row.rowIndex}: ${row.hesapKodu} gider/maliyet hesabi alacak calismis; iade/duzeltme veya yansitma kaydi kontrol edilmeli.`,
          voucherKey: meta.key,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
          detail: { borc: row.borc, alacak: row.alacak },
        });
      }
    }

    return findings;
  }

  private analyzeVoucherDocumentStructure(meta: VoucherMeta, hasBelgeTuruData: boolean): FindingDraft[] {
    if (meta.isVatAccrual || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta) || this.isPayrollVoucher(meta)) {
      return [];
    }
    const docRows = meta.rows.filter((r) => this.requiresDocumentFields(r, meta));
    if (!docRows.length) return [];

    const findings: FindingDraft[] = [];
    const first = docRows[0];
    const documentNos = [...new Set(docRows.map((r) => this.normalizeDocumentNo(r.evrakNo)).filter(Boolean))];
    if (documentNos.length > 1) {
      findings.push({
        severity: 'WARN',
        category: 'TEK_FISTE_BIRDEN_COK_BELGE',
        message: `Fis ${this.voucherLabel(meta.first)} icinde ${documentNos.length} farkli belge no var; e-defterde her belge ayri kayit olmalidir.`,
        voucherKey: meta.key,
        rowIndex: first.rowIndex,
        detail: { documentNos: documentNos.slice(0, 8) },
      });
    }

    const nonEmptyFieldRows = docRows.filter((r) => r.evrakNo || r.evrakTarihi || r.belgeTuru || r.vknTckn);
    const fieldSignatures = new Set(
      nonEmptyFieldRows.map((r) => [
        this.normalizeLoose(r.belgeTuru),
        this.normalizeDocumentNo(r.evrakNo) || '',
        r.evrakTarihi ? r.evrakTarihi.toISOString().slice(0, 10) : '',
        this.normalizeLoose(r.vknTckn),
      ].join('|')),
    );
    if (fieldSignatures.size > 1 && documentNos.length > 1) {
      findings.push({
        severity: 'WARN',
        category: 'AYNI_FISTE_BELGE_ALANLARI_FARKLI',
        message: `Fis ${this.voucherLabel(meta.first)} icinde belge turu/no/tarih/VKN alanlari farkli satirlar var; Luca e-defter aktariminda belge bolunmeli.`,
        voucherKey: meta.key,
        rowIndex: first.rowIndex,
        detail: { signatureCount: fieldSignatures.size },
      });
    }

    const hasSettlementAccount = meta.rows.some((r) => /^(100|101|102|103|108|120|320|329|331|336)/.test(r.hesapKodu || ''));
    const hasInvoiceTaxOrBase = meta.rows.some((r) => /^(191|391|600|601|602|150|153|159)/.test(r.hesapKodu || ''));
    if (hasInvoiceTaxOrBase && !hasSettlementAccount) {
      findings.push({
        severity: 'WARN',
        category: 'FATURA_KARSILIK_HESAP_EKSIK',
        message: `Fis ${this.voucherLabel(meta.first)} fatura/KDV kaydina benziyor ancak cari, kasa veya banka karsilik hesabi gorunmuyor.`,
        voucherKey: meta.key,
        rowIndex: first.rowIndex,
      });
    }

    if (hasBelgeTuruData) {
      const otherDocType = docRows.find((r) => /diger|other|other document/i.test(this.normalizeLoose(r.belgeTuru)));
      if (otherDocType && !this.hasMeaningfulDescription(otherDocType)) {
        findings.push({
          severity: 'WARN',
          category: 'BELGE_TURU_DIGER_ACIKLAMA_EKSIK',
          message: `Fis ${this.voucherLabel(meta.first)} belge turu "Diger" gibi gorunuyor; e-defter belge aciklamasi net degil.`,
          voucherKey: meta.key,
          rowIndex: otherDocType.rowIndex,
          hesapKodu: otherDocType.hesapKodu,
        });
      }
    }

    return findings;
  }

  private analyzeVoucherVatRisks(meta: VoucherMeta): FindingDraft[] {
    if (meta.isVatAccrual || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta)) return [];
    const findings: FindingDraft[] = [];
    const desc = this.normalizeLoose(meta.description);
    const hasExceptionText = /tevkifat|istisna|iade|kur fark|kurfark|otv|oiv|ozel iletisim|istisnai/.test(desc);
    const hasMixedRateText = this.detectVatRates(meta).length > 1;

    const purchaseVat = this.netRows(meta.rows, /^191/, 'borc');
    if (purchaseVat > 1) {
      const purchaseBase = this.purchaseBase(meta.rows);
      if (purchaseBase <= 1) {
        findings.push({
          severity: 'WARN',
          category: 'KDV_MATRAH_KARSILIK_YOK',
          message: `Fis ${this.voucherLabel(meta.first)} 191 KDV iceriyor ancak uygun matrah/gider/stok hesabi gorunmuyor.`,
          voucherKey: meta.key,
          rowIndex: meta.first.rowIndex,
          detail: { kdv: purchaseVat, matrah: purchaseBase },
        });
      } else {
        const rate = (purchaseVat / purchaseBase) * 100;
        if (!hasExceptionText && !hasMixedRateText && !this.isKnownVatRate(rate)) {
          findings.push({
            severity: 'WARN',
            category: 'KDV_ORANI_OLAGAN_DISI',
            message: `Fis ${this.voucherLabel(meta.first)} 191 KDV orani yaklasik %${this.fmtRate(rate)}; matrah/KDV ayrimi kontrol edilmeli.`,
            voucherKey: meta.key,
            rowIndex: meta.first.rowIndex,
            detail: { kdv: purchaseVat, matrah: purchaseBase, oran: rate },
          });
        }
      }
    }

    const salesVat = this.netRows(meta.rows, /^391/, 'alacak');
    if (salesVat > 1) {
      const salesBase = this.salesBase(meta.rows);
      if (salesBase <= 1) {
        findings.push({
          severity: 'WARN',
          category: 'KDV_MATRAH_KARSILIK_YOK',
          message: `Fis ${this.voucherLabel(meta.first)} 391 KDV iceriyor ancak uygun gelir/matrah hesabi gorunmuyor.`,
          voucherKey: meta.key,
          rowIndex: meta.first.rowIndex,
          detail: { kdv: salesVat, matrah: salesBase },
        });
      } else {
        const rate = (salesVat / salesBase) * 100;
        if (!hasExceptionText && !hasMixedRateText && !this.isKnownVatRate(rate)) {
          findings.push({
            severity: 'WARN',
            category: 'KDV_ORANI_OLAGAN_DISI',
            message: `Fis ${this.voucherLabel(meta.first)} 391 KDV orani yaklasik %${this.fmtRate(rate)}; matrah/KDV ayrimi kontrol edilmeli.`,
            voucherKey: meta.key,
            rowIndex: meta.first.rowIndex,
            detail: { kdv: salesVat, matrah: salesBase, oran: rate },
          });
        }
      }
    }

    return findings;
  }

  private analyzeMonthlyVat(
    rows: ParsedEDefterFisLine[],
    range: { start: Date; end: Date } | null,
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    if (!range) return [];
    const findings: FindingDraft[] = [];
    const months = this.monthKeysInRange(range.start, range.end);

    for (const monthKey of months) {
      const monthRows = rows.filter((r) => r.fisTarihi && this.monthKey(r.fisTarihi) === monthKey);
      const vatRows = monthRows.filter((r) => /^(191|391)/.test(r.hesapKodu || ''));
      if (!vatRows.length) continue;

      const monthMetas = [...new Map(monthRows.map((r) => [r.voucherKey, voucherMeta.get(r.voucherKey)])).values()]
        .filter(Boolean) as VoucherMeta[];
      const accruals = monthMetas.filter((m) => m.isVatAccrual);
      const label = this.describeMonth(monthKey);
      if (!accruals.length) {
        const first = vatRows[0];
        findings.push({
          severity: 'ERROR',
          category: 'KDV_TAHAKKUK_EKSIK',
          message: `${label} icin 191/391 hareketi var ancak KDV tahakkuk/mahsup fisi bulunamadi.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
        });
        continue;
      }

      if (accruals.length > 1) {
        findings.push({
          severity: 'WARN',
          category: 'KDV_TAHAKKUK_MUKERRER',
          message: `${label} icin ${accruals.length} adet KDV tahakkuk/mahsup fisi bulundu; mukerrerlik kontrol edilmeli.`,
          voucherKey: accruals[0].key,
          rowIndex: accruals[0].first.rowIndex,
          detail: { count: accruals.length },
        });
      }

      for (const accrual of accruals) {
        if (accrual.date && !this.sameDateUTC(accrual.date, this.endOfMonthUTC(accrual.date))) {
          findings.push({
            severity: 'WARN',
            category: 'KDV_TAHAKKUK_AY_SONU_DEGIL',
            message: `${label} KDV tahakkuk fisi ayin son gununde degil (${this.fmtDate(accrual.date)}).`,
            voucherKey: accrual.key,
            rowIndex: accrual.first.rowIndex,
          });
        }
      }

      const normalVatRows = vatRows.filter((r) => !voucherMeta.get(r.voucherKey)?.isVatAccrual);
      const accrualRows = monthRows.filter((r) => voucherMeta.get(r.voucherKey)?.isVatAccrual);
      const indirilecek = this.sumRows(normalVatRows, /^191/, 'borc') - this.sumRows(normalVatRows, /^191/, 'alacak');
      const hesaplanan = this.sumRows(normalVatRows, /^391/, 'alacak') - this.sumRows(normalVatRows, /^391/, 'borc');
      const tahakkuk191 = this.sumRows(accrualRows, /^191/, 'alacak') - this.sumRows(accrualRows, /^191/, 'borc');
      const tahakkuk391 = this.sumRows(accrualRows, /^391/, 'borc') - this.sumRows(accrualRows, /^391/, 'alacak');

      if (indirilecek > 1 && Math.abs(indirilecek - tahakkuk191) > 1) {
        findings.push({
          severity: 'WARN',
          category: 'KDV_TAHAKKUK_191_TUTAR_UYUMSUZ',
          message: `${label} 191 toplamı ${this.fmt(indirilecek)} TL, tahakkukta 191 alacak ${this.fmt(tahakkuk191)} TL gorunuyor.`,
          voucherKey: accruals[0].key,
          rowIndex: accruals[0].first.rowIndex,
          detail: { indirilecek, tahakkuk191 },
        });
      }
      if (hesaplanan > 1 && Math.abs(hesaplanan - tahakkuk391) > 1) {
        findings.push({
          severity: 'WARN',
          category: 'KDV_TAHAKKUK_391_TUTAR_UYUMSUZ',
          message: `${label} 391 toplamı ${this.fmt(hesaplanan)} TL, tahakkukta 391 borc ${this.fmt(tahakkuk391)} TL gorunuyor.`,
          voucherKey: accruals[0].key,
          rowIndex: accruals[0].first.rowIndex,
          detail: { hesaplanan, tahakkuk391 },
        });
      }

      const odenecek = hesaplanan - indirilecek;
      if (odenecek > 1) {
        const account360 = this.sumRows(accrualRows, /^360/, 'alacak') - this.sumRows(accrualRows, /^360/, 'borc');
        if (Math.abs(odenecek - account360) > 1) {
          findings.push({
            severity: 'WARN',
            category: 'KDV_ODENECEK_360_UYUMSUZ',
            message: `${label} odenecek KDV ${this.fmt(odenecek)} TL hesaplandi; tahakkukta 360 alacak ${this.fmt(account360)} TL.`,
            voucherKey: accruals[0].key,
            rowIndex: accruals[0].first.rowIndex,
            detail: { odenecek, account360 },
          });
        }
      } else if (odenecek < -1) {
        const devreden = Math.abs(odenecek);
        const account190 = this.sumRows(accrualRows, /^190/, 'borc') - this.sumRows(accrualRows, /^190/, 'alacak');
        if (Math.abs(devreden - account190) > 1) {
          findings.push({
            severity: 'WARN',
            category: 'KDV_DEVREDEN_190_UYUMSUZ',
            message: `${label} devreden KDV ${this.fmt(devreden)} TL hesaplandi; tahakkukta 190 borc ${this.fmt(account190)} TL.`,
            voucherKey: accruals[0].key,
            rowIndex: accruals[0].first.rowIndex,
            detail: { devreden, account190 },
          });
        }
      }
    }
    return findings;
  }

  private isClosingLikeVoucher(meta: VoucherMeta) {
    const desc = this.normalizeLoose(meta.description);
    return /kapanis|yansitma|devir|virman|mahsup|aktarma|duzeltme/.test(desc);
  }

  private isCostReflectionVoucher(meta: VoucherMeta) {
    const hasReflectionAccount = meta.rows.some((r) => this.isCostReflectionAccount(r.hesapKodu));
    const hasCostSource = meta.rows.some((r) => /^(710|720|730|740|750|760|770)/.test(r.hesapKodu || ''));
    const hasCostTarget = meta.rows.some((r) => /^(151|152|620|621|622|623|631|632)/.test(r.hesapKodu || ''));
    return hasReflectionAccount || (hasCostSource && hasCostTarget && this.isClosingLikeVoucher(meta));
  }

  private isCostReflectionAccount(code?: string | null) {
    return /^(711|721|731|741|751|761|771)/.test(code || '');
  }

  private isPayrollVoucher(meta: VoucherMeta) {
    const desc = this.normalizeLoose(meta.description);
    return /ucret|maas|personel|bordro|sgk|ssk|muhtasar/i.test(desc) ||
      meta.rows.some((r) => /^(335|360|361|369)/.test(r.hesapKodu || ''));
  }

  private requiresDocumentFields(row: ParsedEDefterFisLine, meta?: VoucherMeta | null) {
    if (!row.hesapKodu) return false;
    if (meta && (meta.isVatAccrual || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta) || this.isPayrollVoucher(meta))) {
      return false;
    }

    const code = row.hesapKodu || '';
    if (/^(120|320|150|153|159|191|391|600|601|602)/.test(code)) return true;
    if (/^(720|730|740|750|760|770|780)/.test(code)) {
      const text = this.rowText(row);
      if (/yansitma|mahsup|tahakkuk|bordro|ucret|maas|sgk|ssk|amortisman|reeskont/.test(text)) {
        return false;
      }
      return this.amountOf(row) > 0;
    }
    return false;
  }

  private isValidAccountCode(code?: string | null) {
    return /^\d{3}(?:[.\-][\p{L}\p{N}]+)*$/u.test(String(code || '').trim());
  }

  private isParentAccountRisk(row: ParsedEDefterFisLine) {
    const code = String(row.hesapKodu || '').trim();
    if (!/^\d{3}$/.test(code)) return false;
    if (!/^(100|101|102|108|120|121|126|127|131|150|153|159|191|320|329|331|335|360|361|391|600|601|602|710|720|730|740|750|760|770|780)/.test(code)) {
      return false;
    }
    return this.amountOf(row) > 0;
  }

  private isSuspiciousDocumentNo(value?: string | null) {
    const raw = String(value || '').trim();
    const normalized = this.normalizeDocumentNo(raw);
    if (!normalized) return true;
    if (/^(0+|yok|bos|boş|belgesiz|muhtelif|nakit|mahsup|virman)$/i.test(raw)) return true;
    return normalized.length < 5;
  }

  private documentYear(value?: string | null) {
    const text = String(value || '').toUpperCase().replace(/\s+/g, '');
    const match = text.match(/(?:^|[A-Z])((?:19|20)\d{2})(?=\d{4,})/);
    return match ? Number(match[1]) : null;
  }

  private isValidTaxIdentity(value?: string | null) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) return this.isValidVkn(digits);
    if (digits.length === 11) return this.isValidTckn(digits);
    return false;
  }

  private isValidTckn(value: string) {
    if (!/^[1-9]\d{10}$/.test(value)) return false;
    const d = value.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    const tenth = ((odd * 7) - even) % 10;
    const eleventh = d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10;
    return d[9] === tenth && d[10] === eleventh;
  }

  private isValidVkn(value: string) {
    if (!/^\d{10}$/.test(value)) return false;
    const digits = value.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      const tmp = (digits[i] + 9 - i) % 10;
      const calc = tmp === 9 ? tmp : (tmp * (2 ** (9 - i))) % 9;
      sum += calc;
    }
    const check = (10 - (sum % 10)) % 10;
    return check === digits[9];
  }

  private normalizeLoose(value?: string | null) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ı]/g, 'i')
      .replace(/[ğ]/g, 'g')
      .replace(/[ş]/g, 's')
      .replace(/[ö]/g, 'o')
      .replace(/[ü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private rowText(row: ParsedEDefterFisLine) {
    return this.normalizeLoose([row.hesapKodu, row.hesapAdi, row.aciklama, row.fisTipi, row.belgeTuru].filter(Boolean).join(' '));
  }

  private hasMeaningfulDescription(row: ParsedEDefterFisLine) {
    const desc = this.normalizeLoose(row.aciklama);
    if (desc.length < 8) return false;
    return !/^(diger|other|muhtelif|mahsup|virman|belge|fatura)$/.test(desc);
  }

  private analyzeDuplicateDocuments(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const byDoc = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      const no = this.normalizeDocumentNo(row.evrakNo);
      if (!no) continue;
      if (!this.requiresDocumentFields(row, voucherMeta.get(row.voucherKey))) continue;
      if (!byDoc.has(no)) byDoc.set(no, []);
      byDoc.get(no)!.push(row);
    }
    const findings: FindingDraft[] = [];
    for (const [documentNo, documentRows] of byDoc.entries()) {
      const voucherKeys = [...new Set(documentRows.map((r) => r.voucherKey))];
      if (voucherKeys.length <= 1) continue;
      const first = documentRows[0];
      findings.push({
        severity: 'WARN',
        category: 'MUKERRER_EVRAK_NO',
        message: `${documentNo} belge/evrak no ${voucherKeys.length} farkli fis icinde gorunuyor; mukerrer kayit kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        detail: { documentNo, voucherCount: voucherKeys.length },
      });
    }
    return findings;
  }

  private analyzeDocumentDates(
    rows: ParsedEDefterFisLine[],
    range: { start: Date; end: Date } | null,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    for (const row of rows) {
      if (!row.evrakTarihi) continue;
      if (row.fisTarihi && row.evrakTarihi > row.fisTarihi) {
        findings.push({
          severity: 'WARN',
          category: 'BELGE_TARIHI_FIS_TARIHINDEN_SONRA',
          message: `Satir ${row.rowIndex}: belge tarihi (${this.fmtDate(row.evrakTarihi)}) fis tarihinden (${this.fmtDate(row.fisTarihi)}) sonra.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      }
      if (range && (row.evrakTarihi < range.start || row.evrakTarihi > range.end)) {
        findings.push({
          severity: 'WARN',
          category: 'BELGE_TARIHI_DONEM_DISI',
          message: `Satir ${row.rowIndex}: belge tarihi secilen donem disinda (${this.fmtDate(row.evrakTarihi)}).`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      }
    }
    return findings;
  }

  private analyzeLedgerNumbering(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byNumber = new Map<number, ParsedEDefterFisLine[]>();
    const invalid = rows.filter((r) => r.yevmiyeNo && this.parseSequenceNo(r.yevmiyeNo) == null);

    for (const row of invalid.slice(0, 5)) {
      findings.push({
        severity: 'INFO',
        category: 'YEVMIYE_NO_FORMAT_SUPHELI',
        message: `Satir ${row.rowIndex}: yevmiye no sayisal okunamadi (${row.yevmiyeNo}).`,
        voucherKey: row.voucherKey,
        rowIndex: row.rowIndex,
        hesapKodu: row.hesapKodu,
      });
    }

    for (const row of rows) {
      const no = this.parseSequenceNo(row.yevmiyeNo);
      if (no == null) continue;
      if (!byNumber.has(no)) byNumber.set(no, []);
      byNumber.get(no)!.push(row);
    }
    if (!byNumber.size) return findings;

    const sorted = [...byNumber.keys()].sort((a, b) => a - b);
    for (const no of sorted) {
      const numberRows = byNumber.get(no)!;
      const voucherKeys = [...new Set(numberRows.map((r) => r.voucherKey))];
      const dates = [...new Set(numberRows.map((r) => r.fisTarihi?.toISOString().slice(0, 10)).filter(Boolean))];
      if (voucherKeys.length > 1 && dates.length > 1) {
        const first = numberRows[0];
        findings.push({
          severity: 'ERROR',
          category: 'YEVMIYE_NO_MUKERRER',
          message: `Yevmiye no ${no} birden fazla tarih/fis grubunda gorunuyor; numara mukerrerligi kontrol edilmeli.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
          detail: { yevmiyeNo: no, dates, voucherCount: voucherKeys.length },
        });
      }
    }

    let gapCount = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr - prev <= 1) continue;
      gapCount += 1;
      if (gapCount > 10) break;
      const first = byNumber.get(curr)![0];
      findings.push({
        severity: 'WARN',
        category: 'YEVMIYE_NO_ATLAMA',
        message: `Yevmiye no sirasi ${prev} ile ${curr} arasinda atlama gosteriyor; eksik/iptal fis kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        detail: { onceki: prev, sonraki: curr },
      });
    }

    let lastDate: Date | null = null;
    let lastNo: number | null = null;
    for (const no of sorted) {
      const date = byNumber.get(no)!.find((r) => r.fisTarihi)?.fisTarihi || null;
      if (date && lastDate && date < lastDate) {
        const first = byNumber.get(no)![0];
        findings.push({
          severity: 'WARN',
          category: 'YEVMIYE_TARIH_SIRASI',
          message: `Yevmiye no ${no} tarihi, onceki yevmiye no ${lastNo} tarihinden once gorunuyor; tarih/numara sirasi kontrol edilmeli.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
          detail: { yevmiyeNo: no, oncekiYevmiyeNo: lastNo },
        });
        break;
      }
      if (date) {
        lastDate = date;
        lastNo = no;
      }
    }

    return findings;
  }

  private analyzeParentAccountUsage(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const byCode = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      if (!this.isParentAccountRisk(row)) continue;
      const code = row.hesapKodu!;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(row);
    }

    const findings: FindingDraft[] = [];
    for (const [code, codeRows] of [...byCode.entries()].slice(0, 25)) {
      const first = codeRows[0];
      findings.push({
        severity: 'INFO',
        category: 'ANA_HESAPTA_KAYIT',
        message: `${code} ana hesabina ${codeRows.length} satir kayit yapilmis; muavin/alt hesap acilmasi gerekip gerekmedigi kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: code,
        detail: { count: codeRows.length },
      });
    }
    return findings;
  }

  private analyzeDailyCash(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const byDay = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      if (!row.fisTarihi || !/^100/.test(row.hesapKodu || '')) continue;
      const key = row.fisTarihi.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(row);
    }
    const findings: FindingDraft[] = [];
    for (const [day, cashRows] of byDay.entries()) {
      const total = cashRows.reduce((sum, r) => sum + this.amountOf(r), 0);
      if (total <= 30000) continue;
      const first = cashRows[0];
      findings.push({
        severity: 'WARN',
        category: 'KASA_GUNLUK_30000_TEVSIK_RISKI',
        message: `${this.fmtDate(new Date(`${day}T00:00:00.000Z`))} tarihinde 100 Kasa hareket toplamı ${this.fmt(total)} TL. 30.000 TL tevsik siniri icin detay kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: first.hesapKodu,
        detail: { day, total, limit: 30000 },
      });
    }
    return findings;
  }

  private analyzeCostReflectionPeriod(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const reflectionPairs = [
      ['710', '711'],
      ['720', '721'],
      ['730', '731'],
      ['740', '741'],
      ['750', '751'],
      ['760', '761'],
      ['770', '771'],
    ] as const;

    for (const [source, reflection] of reflectionPairs) {
      const sourceDebit = rows
        .filter((r) => new RegExp(`^${source}`).test(r.hesapKodu || ''))
        .reduce((sum, r) => sum + Math.max(0, Number(r.borc || 0) - Number(r.alacak || 0)), 0);
      if (sourceDebit <= 1) continue;
      const reflectionCredit = rows
        .filter((r) => new RegExp(`^${reflection}`).test(r.hesapKodu || ''))
        .reduce((sum, r) => sum + Math.max(0, Number(r.alacak || 0) - Number(r.borc || 0)), 0);
      if (reflectionCredit <= 1) {
        const first = rows.find((r) => new RegExp(`^${source}`).test(r.hesapKodu || ''))!;
        findings.push({
          severity: 'INFO',
          category: 'MALIYET_YANSITMA_EKSIK_KONTROL',
          message: `${source} hesap hareketi ${this.fmt(sourceDebit)} TL; ${reflection} yansitma hesabi gorunmuyor. Donem sonu yansitma kaydi kontrol edilmeli.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
          hesapKodu: first.hesapKodu,
          detail: { source, reflection, sourceDebit, reflectionCredit },
        });
      }
    }

    return findings;
  }

  private analyzePeriodAccountingRisks(
    rows: ParsedEDefterFisLine[],
    range: { start: Date; end: Date } | null,
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const first = rows[0];
    if (!first) return findings;

    const hasFixedAssetMovement = rows.some((r) => /^(25[2-9]|260|264)/.test(r.hesapKodu || ''));
    const hasDepreciation = rows.some((r) => /^(257|268|730|740|760|770)/.test(r.hesapKodu || '') && /amortisman/i.test(`${r.hesapAdi || ''} ${r.aciklama || ''}`));
    if (hasFixedAssetMovement && !hasDepreciation) {
      findings.push({
        severity: 'INFO',
        category: 'AMORTISMAN_KAYDI_KONTROL',
        message: 'Donem icinde sabit kiymet hesabi hareketi var; amortisman kaydinin yapilip yapilmadigi kontrol edilmeli.',
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
      });
    }

    const hasReceivableRediscount = rows.some((r) => /^(122|222|647)/.test(r.hesapKodu || '') || /alacak sened.*reeskont/i.test(`${r.hesapAdi || ''} ${r.aciklama || ''}`));
    const hasPayableRediscount = rows.some((r) => /^(322|422|657)/.test(r.hesapKodu || '') || /borc sened.*reeskont|borç sened.*reeskont/i.test(`${r.hesapAdi || ''} ${r.aciklama || ''}`));
    if (hasReceivableRediscount && !hasPayableRediscount) {
      findings.push({
        severity: 'INFO',
        category: 'REESKONT_SIMETRI_KONTROL',
        message: 'Alacak senedi reeskontuna benzer kayit var; borc senetleri reeskontu gerekip gerekmedigi kontrol edilmeli.',
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
      });
    }

    for (const meta of voucherMeta.values()) {
      const rowsInVoucher = meta.rows;
      const desc = this.normalizeLoose(meta.description);
      const cariRows = rowsInVoucher.filter((r) => /^(120|320)/.test(r.hesapKodu || '') && this.amountOf(r) >= 30000);
      if (cariRows.length) {
        const hasCashOrBank = rowsInVoucher.some((r) => /^(100|102|103|108)/.test(r.hesapKodu || ''));
        const hasInvoiceLikeAccount = rowsInVoucher.some((r) => /^(191|391|600|601|602|7)/.test(r.hesapKodu || ''));
        if (!hasCashOrBank && !hasInvoiceLikeAccount) {
          findings.push({
            severity: 'WARN',
            category: 'CARI_KAPAMA_KARSILIK_KONTROL',
            message: `Fis ${this.voucherLabel(meta.first)} 120/320 cari hesabi ${this.fmt(this.amountOf(cariRows[0]))} TL uzeri calistiriyor; banka/kasa veya fatura karsiligi gorunmuyor.`,
            voucherKey: meta.key,
            rowIndex: cariRows[0].rowIndex,
            hesapKodu: cariRows[0].hesapKodu,
          });
        }
      }

      if (range && meta.date && /acilis|acilis fisi|acilis kaydi/.test(desc) && !this.sameDateUTC(meta.date, range.start)) {
        findings.push({
          severity: 'WARN',
          category: 'ACILIS_FISI_TARIH_KONTROL',
          message: `Fis ${this.voucherLabel(meta.first)} acilis kaydina benziyor; tarih ${this.fmtDate(meta.date)}, donem baslangici ${this.fmtDate(range.start)}.`,
          voucherKey: meta.key,
          rowIndex: meta.first.rowIndex,
        });
      }

      if (range && meta.date && /kapanis|donem sonu/.test(desc) && !this.sameDateUTC(meta.date, range.end)) {
        findings.push({
          severity: 'INFO',
          category: 'KAPANIS_FISI_TARIH_KONTROL',
          message: `Fis ${this.voucherLabel(meta.first)} kapanis/donem sonu kaydina benziyor; tarih ${this.fmtDate(meta.date)}, donem bitisi ${this.fmtDate(range.end)}.`,
          voucherKey: meta.key,
          rowIndex: meta.first.rowIndex,
        });
      }

      const periodizationRow = rowsInVoucher.find((r) =>
        /^(720|730|740|750|760|770|780|689)/.test(r.hesapKodu || '') &&
        /sigorta|kasko|kira|abonelik|lisans|bakim|pesin|yillik|gelecek ay|gelecek donem/.test(this.rowText(r)),
      );
      if (periodizationRow && !rowsInVoucher.some((r) => /^(180|280|380|480)/.test(r.hesapKodu || ''))) {
        findings.push({
          severity: 'INFO',
          category: 'DONEMSELLIK_GIDER_KONTROL',
          message: `Fis ${this.voucherLabel(meta.first)} pesin/gelecek donem gideri sinyali veriyor; 180/280 veya 380/480 donemsellik hesabi kontrol edilmeli.`,
          voucherKey: meta.key,
          rowIndex: periodizationRow.rowIndex,
          hesapKodu: periodizationRow.hesapKodu,
        });
      }

      if (this.isPayrollVoucher(meta)) {
        const hasNetWage = rowsInVoucher.some((r) => /^335/.test(r.hesapKodu || ''));
        const hasTaxOrSgk = rowsInVoucher.some((r) => /^(360|361)/.test(r.hesapKodu || ''));
        if (!hasNetWage || !hasTaxOrSgk) {
          findings.push({
            severity: 'INFO',
            category: 'BORDRO_TAHAKKUK_HESAP_KONTROL',
            message: `Fis ${this.voucherLabel(meta.first)} bordro/personel kaydina benziyor; 335 net ucret ve 360/361 vergi-SGK hesaplari birlikte kontrol edilmeli.`,
            voucherKey: meta.key,
            rowIndex: meta.first.rowIndex,
            detail: { hasNetWage, hasTaxOrSgk },
          });
        }
      }
    }

    if (range) {
      for (const monthKey of this.monthKeysInRange(range.start, range.end)) {
        const monthRows = rows.filter((r) => r.fisTarihi && this.monthKey(r.fisTarihi) === monthKey);
        const payrollSignal = monthRows.some((r) => /ucret|maas|personel|sgk/i.test(this.rowText(r)));
        if (!payrollSignal) continue;
        const hasPayrollAccrual = monthRows.some((r) => /^(335|360|361|369)/.test(r.hesapKodu || ''));
        if (!hasPayrollAccrual) {
          findings.push({
            severity: 'INFO',
            category: 'UCRET_SGK_TAHAKKUK_KONTROL',
            message: `${this.describeMonth(monthKey)} icinde ucret/personel/SGK sinyali var; 335/360/361 tahakkuk hesaplari gorunmuyor.`,
            voucherKey: monthRows[0].voucherKey,
            rowIndex: monthRows[0].rowIndex,
          });
        }
      }
    }

    return findings;
  }

  private normalizeDocumentNo(value?: string | null) {
    const text = String(value || '').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
    if (!text) return null;
    if (/^\d+$/.test(text) && text.length < 6) return null;
    if (text.length < 5) return null;
    return text;
  }

  private sumRows(rows: ParsedEDefterFisLine[], accountPattern: RegExp, side: 'borc' | 'alacak') {
    return rows
      .filter((r) => accountPattern.test(r.hesapKodu || ''))
      .reduce((sum, r) => sum + Number(r[side] || 0), 0);
  }

  private netRows(rows: ParsedEDefterFisLine[], accountPattern: RegExp, naturalSide: 'borc' | 'alacak') {
    return rows
      .filter((r) => accountPattern.test(r.hesapKodu || ''))
      .reduce((sum, r) => {
        const borc = Number(r.borc || 0);
        const alacak = Number(r.alacak || 0);
        return sum + (naturalSide === 'borc' ? borc - alacak : alacak - borc);
      }, 0);
  }

  private purchaseBase(rows: ParsedEDefterFisLine[]) {
    return rows
      .filter((r) => /^(150|151|152|153|157|159|180|250|251|252|253|254|255|258|260|264|280|720|730|740|750|760|770|780|689|659)/.test(r.hesapKodu || ''))
      .filter((r) => !this.isCostReflectionAccount(r.hesapKodu))
      .reduce((sum, r) => sum + Math.max(0, Number(r.borc || 0) - Number(r.alacak || 0)), 0);
  }

  private salesBase(rows: ParsedEDefterFisLine[]) {
    return rows
      .filter((r) => /^(600|601|602|649|679)/.test(r.hesapKodu || ''))
      .reduce((sum, r) => sum + Math.max(0, Number(r.alacak || 0) - Number(r.borc || 0)), 0);
  }

  private detectVatRates(meta: VoucherMeta) {
    const text = meta.description;
    const rates = new Set<number>();
    for (const match of text.matchAll(/%?\s*(1|8|10|18|20)(?:[,\.]0+)?\s*(?:kdv|oran|%)/gi)) {
      rates.add(Number(match[1]));
    }
    return [...rates];
  }

  private isKnownVatRate(rate: number) {
    return [1, 8, 10, 18, 20].some((known) => Math.abs(rate - known) <= 0.6);
  }

  private fmtRate(value: number) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  private parseSequenceNo(value?: string | null) {
    const text = String(value || '').trim();
    if (!text) return null;
    const normalized = text.replace(/[^\d]/g, '');
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  private amountOf(row: ParsedEDefterFisLine) {
    return Math.max(Number(row.borc || 0), Number(row.alacak || 0));
  }

  private monthKeysInRange(start: Date, end: Date) {
    const keys: string[] = [];
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    const endKey = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`;
    while (true) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      keys.push(key);
      if (key === endKey) break;
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return keys;
  }

  private monthKey(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private describeMonth(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: 'long',
    });
  }

  private endOfMonthUTC(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  }

  private sameDateUTC(a: Date, b: Date) {
    return a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate();
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
