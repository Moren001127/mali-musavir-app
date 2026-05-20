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
      findings.push(...this.analyzeVoucherRisks(meta));
    }

    findings.push(...this.analyzeMonthlyVat(rows, range, voucherMeta));
    findings.push(...this.analyzeDuplicateDocuments(rows));
    findings.push(...this.analyzeDailyCash(rows));

    return findings.slice(0, 5000);
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
    const has191Credit = rows.some((r) => /^191/.test(r.hesapKodu || '') && r.alacak > r.borc);
    const has391Debit = rows.some((r) => /^391/.test(r.hesapKodu || '') && r.borc > r.alacak);
    const hasSettlementAccount = rows.some((r) => /^(190|360)/.test(r.hesapKodu || ''));
    const hasAccrualText = /kdv|tahakkuk|mahsup|beyanname|devreden|odenecek|ödenecek/.test(description);
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

    const isClosingLike = /kapanis|kapanış|yansitma|yansıtma|devir|virman|mahsup/.test(meta.description);
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
      if (/^7/.test(row.hesapKodu || '') && row.alacak > row.borc && !isClosingLike) {
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

  private analyzeDuplicateDocuments(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const byDoc = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      const no = this.normalizeDocumentNo(row.evrakNo);
      if (!no) continue;
      if (!/^(191|391|120|320|600|601|602|740|760|770)/.test(row.hesapKodu || '')) continue;
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
