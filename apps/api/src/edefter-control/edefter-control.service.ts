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

const DEFAULT_DISABLED_CATEGORIES = new Set([
  'SIFIR_TUTARLI_SATIR',
  'SATIRDA_BORC_ALACAK_BIRLIKTE',
  '191_TERS_CALISMA',
  '391_TERS_CALISMA',
  'KDV_ODENECEK_360_UYUMSUZ',
  'KDV_DEVREDEN_190_UYUMSUZ',
  'KDV_TAHAKKUK_MUKERRER',
  'KDV_TAHAKKUK_AY_SONU_DEGIL',
  'KDV_TAHAKKUK_191_TUTAR_UYUMSUZ',
  'KDV_TAHAKKUK_391_TUTAR_UYUMSUZ',
  'KDV_ORANI_OLAGAN_DISI',
  'KDV_MATRAH_KARSILIK_YOK',
  'MUKERRER_EVRAK_NO',
  'FATURA_KARSILIK_HESAP_EKSIK',
  'BELGE_TURU_DIGER_ACIKLAMA_EKSIK',
  'ANA_HESAPTA_KAYIT',
  'YEVMIYE_NO_FORMAT_SUPHELI',
  'TEK_FISTE_BIRDEN_COK_BELGE',
  'AYNI_FISTE_BELGE_ALANLARI_FARKLI',
  'GELIR_HESABI_BORC_CALISMA',
  'GIDER_HESABI_ALACAK_CALISMA',
  'ORTAK_CARI_KASA_KULLANIMI',
  'AVANS_KASA_ORTAK_CARI_KAPAMA',
  'CARI_KAPAMA_KARSILIK_KONTROL',
  'BORDRO_TAHAKKUK_HESAP_KONTROL',
  'UCRET_SGK_TAHAKKUK_KONTROL',
  'AMORTISMAN_KAYDI_KONTROL',
  'REESKONT_SIMETRI_KONTROL',
  'DONEMSELLIK_GIDER_KONTROL',
  'MALIYET_YANSITMA_EKSIK_KONTROL',
  'ACILIS_FISI_TARIH_KONTROL',
  'KAPANIS_FISI_TARIH_KONTROL',
  'KASA_30000_TEVSIK_RISKI',
]);

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
      this.findCompanionMizan(
        tenantId,
        session.taxpayerId,
        session.donem,
        session.donemTipi,
        session.createdBy,
      ),
    ]);
    return { ...session, taxpayer: taxpayer || null, companionMizan };
  }

  async getRuleSettings(tenantId: string) {
    const rows = await (this.prisma as any).eDefterControlRuleSetting.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
    return {
      settings: rows.map((r: any) => ({
        code: r.code,
        active: Boolean(r.active),
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy || null,
      })),
      defaultDisabledCodes: [...DEFAULT_DISABLED_CATEGORIES].sort(),
    };
  }

  async setRuleSetting(params: {
    tenantId: string;
    code: string;
    active: boolean;
    userId?: string | null;
  }) {
    const code = String(params.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(code)) throw new BadRequestException('Kural kodu gecersiz');
    return (this.prisma as any).eDefterControlRuleSetting.upsert({
      where: { tenantId_code: { tenantId: params.tenantId, code } },
      create: {
        tenantId: params.tenantId,
        code,
        active: params.active,
        updatedBy: params.userId || null,
      },
      update: {
        active: params.active,
        updatedBy: params.userId || null,
      },
    });
  }

  private async getRuleSettingMap(tenantId: string): Promise<Map<string, boolean>> {
    const rows = await (this.prisma as any).eDefterControlRuleSetting.findMany({
      where: { tenantId },
      select: { code: true, active: true },
    });
    return new Map(rows.map((r: any) => [String(r.code || '').toUpperCase(), Boolean(r.active)]));
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
      createdBy: params.createdBy || undefined,
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

    return { detailJob, mizanJob: null };
  }

  async createCompanionMizanJob(params: {
    tenantId: string;
    detailJobId: string;
    mukellefId: string;
    donem: string;
    donemTipi?: EDefterDonemTipi;
    targetDeviceId?: string | null;
    createdBy?: string | null;
  }) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: params.mukellefId, tenantId: params.tenantId },
      select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const requestedDeviceId = params.targetDeviceId?.trim() || undefined;
    const targetDeviceId =
      requestedDeviceId && !/^DEV-/i.test(requestedDeviceId) ? requestedDeviceId : undefined;

    const mizanJob = await this.luca.createFetchJob({
      tenantId: params.tenantId,
      sessionId: params.detailJobId,
      mukellefId: params.mukellefId,
      donem: params.donem,
      donemTipi: params.donemTipi,
      tip: 'MIZAN',
      createdBy: params.createdBy || undefined,
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

    return mizanJob;
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
    this.correctTahakkukDates(rows);

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

    const ruleSettings = await this.getRuleSettingMap(params.tenantId);
    const findings = this.analyze(rows, range, donemTipi, ruleSettings);
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

  async updateFindingStatus(params: {
    tenantId: string;
    sessionId: string;
    findingId: string;
    status: 'OPEN' | 'RESOLVED' | 'IGNORED';
    note?: string | null;
    userId?: string | null;
  }) {
    const session = await (this.prisma as any).eDefterControlSession.findFirst({
      where: { id: params.sessionId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('e-Defter oturumu bulunamadi');

    const finding = await (this.prisma as any).eDefterFinding.findFirst({
      where: { id: params.findingId, sessionId: params.sessionId },
    });
    if (!finding) throw new NotFoundException('Bulgu bulunamadi');

    const existingDetail =
      finding.detail && typeof finding.detail === 'object' && !Array.isArray(finding.detail)
        ? (finding.detail as Record<string, unknown>)
        : {};
    const newDetail: Record<string, unknown> = { ...existingDetail };

    if (params.status === 'OPEN') {
      delete newDetail.resolvedAt;
      delete newDetail.resolvedBy;
      delete newDetail.note;
    } else {
      newDetail.resolvedAt = new Date().toISOString();
      if (params.userId) newDetail.resolvedBy = params.userId;
      if (params.note != null) newDetail.note = String(params.note).slice(0, 1000);
    }

    return (this.prisma as any).eDefterFinding.update({
      where: { id: params.findingId },
      data: { status: params.status, detail: newDetail },
    });
  }

  async reanalyzeSession(sessionId: string, tenantId: string) {
    const session = await (this.prisma as any).eDefterControlSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('e-Defter oturumu bulunamadi');
    if (!session.rawExcelBytes) {
      throw new BadRequestException('Bu oturumda yeniden analiz icin Excel snapshot bulunamadi');
    }

    const donemTipi = this.normalizeDonemTipi(session.donem, session.donemTipi);
    const range = this.donemToRange(session.donem, donemTipi);
    const rawExcelBytes = Buffer.from(session.rawExcelBytes);
    const rows = this.parser.parse(rawExcelBytes, { defaultYear: range?.start.getUTCFullYear() });
    this.correctTahakkukDates(rows);
    const voucherCount = new Set(rows.map((r) => r.voucherKey)).size;
    const ruleSettings = await this.getRuleSettingMap(tenantId);
    const findings = this.analyze(rows, range, donemTipi, ruleSettings);
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

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.eDefterFinding.deleteMany({ where: { sessionId: session.id } });
      await tx.eDefterVoucherLine.deleteMany({ where: { sessionId: session.id } });
      for (const chunk of this.chunks(lineRows, 700)) {
        await tx.eDefterVoucherLine.createMany({ data: chunk });
      }
      for (const chunk of this.chunks(findings, 700)) {
        await tx.eDefterFinding.createMany({
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
      await tx.eDefterControlSession.update({
        where: { id: session.id },
        data: {
          donemTipi,
          donemBaslangic: range?.start || null,
          donemBitis: range?.end || null,
          totalLines: rows.length,
          totalVouchers: voucherCount,
          findingCount: findings.length,
          status: findings.some((f) => f.severity === 'ERROR') || findings.length ? 'REVIEWING' : 'READY',
        },
      });
    });

    return this.getSession(session.id, tenantId);
  }

  async exportFindingsAsExcel(sessionId: string, tenantId: string): Promise<Buffer> {
    const session = await (this.prisma as any).eDefterControlSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        findings: { orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!session) throw new NotFoundException('e-Defter oturumu bulunamadi');

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: session.taxpayerId, tenantId },
      select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
    });
    const taxpayerName =
      taxpayer?.companyName ||
      [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') ||
      taxpayer?.taxNumber ||
      'Mukellef';

    const XLSX = await import('xlsx');
    const rows = session.findings.map((f: any, idx: number) => {
      const detail = (f.detail && typeof f.detail === 'object' && !Array.isArray(f.detail)
        ? f.detail
        : {}) as Record<string, unknown>;
      return {
        Sira: idx + 1,
        Seviye: f.severity,
        Kategori: f.category,
        Aciklama: f.message,
        FisYevmiyeNo: f.voucherKey || '',
        Satir: f.rowIndex || '',
        HesapKodu: f.hesapKodu || '',
        Durum: f.status || 'OPEN',
        Not: (detail.note as string) || '',
        DetayJson: f.detail ? JSON.stringify(f.detail) : '',
        OlusmaTarihi: f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 19) : '',
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 }, { wch: 8 }, { wch: 30 }, { wch: 60 }, { wch: 18 },
      { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 40 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Bulgular');

    const summary = [
      ['Mukellef', taxpayerName],
      ['Donem', session.donem || ''],
      ['Donem Tipi', session.donemTipi || ''],
      ['Toplam Fis', session.totalVouchers || 0],
      ['Toplam Satir', session.totalLines || 0],
      ['Toplam Bulgu', session.findingCount || 0],
      ['Olusma Tarihi', session.createdAt ? new Date(session.createdAt).toISOString().slice(0, 19) : ''],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet([['Alan', 'Deger'], ...summary]);
    wsSum['!cols'] = [{ wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsSum, 'Ozet');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  async findCompanionMizan(
    tenantId: string,
    taxpayerId: string,
    donem: string,
    donemTipi?: string | null,
    companionMarker?: string | null,
  ) {
    const marker = String(companionMarker || '').trim();
    if (!/^edefter-control:/.test(marker)) return null;

    const mizan = await (this.prisma as any).mizan.findFirst({
      where: {
        tenantId,
        taxpayerId,
        donem,
        ...(donemTipi ? { donemTipi } : {}),
        createdBy: marker,
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

  private analyze(
    rows: ParsedEDefterFisLine[],
    range: { start: Date; end: Date } | null,
    donemTipi?: EDefterDonemTipi,
    ruleSettings: Map<string, boolean> = new Map(),
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    // Yil-sonu / acilis / donem-sonu kurallari yalnizca YILLIK defterde anlamlidir.
    // Ceyrek (gecici vergi) ve aylik defterlerde bu kurallar yanlis alarm uretir.
    const isYillik = String(donemTipi || '').toUpperCase() === 'YILLIK';
    const byVoucher = new Map<string, ParsedEDefterFisLine[]>();

    for (const row of rows) {
      if (!byVoucher.has(row.voucherKey)) byVoucher.set(row.voucherKey, []);
      byVoucher.get(row.voucherKey)!.push(row);
    }

    const voucherMeta = new Map<string, VoucherMeta>();
    for (const [voucherKey, group] of byVoucher.entries()) {
      voucherMeta.set(voucherKey, this.buildVoucherMeta(voucherKey, group));
    }
    const hasBelgeTuruData = rows.some((r) => Boolean(r.belgeTuru));
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
        // Tarih eksik satirlari agregate ediyoruz; asagidaki ozet finding yeterli.
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
      findings.push(...this.analyzeVoucherDocumentStructure(meta, hasBelgeTuruData));
      findings.push(...this.analyzeVoucherVatRisks(meta));
    }

    findings.push(...this.analyzeMonthlyVat(rows, range, voucherMeta));
    findings.push(...this.analyzeDuplicateDocuments(rows, voucherMeta));
    findings.push(...this.analyzeParentAccountUsage(rows));
    findings.push(...this.analyzeCashTevsik(rows, voucherMeta));
    findings.push(...this.analyzeCostReflectionPeriod(rows));
    findings.push(...this.analyzePeriodAccountingRisks(rows, range, voucherMeta));
    findings.push(...this.analyzeDocumentDates(rows, range));
    findings.push(...this.analyzeLedgerNumbering(rows));
    findings.push(...this.analyzeTevsikParcalama(rows, voucherMeta));
    findings.push(...this.analyzeTevsikBolunmusIslem(rows, voucherMeta));
    findings.push(...this.analyzeEmptyOrSingleLineVouchers(byVoucher));
    findings.push(...this.analyzeVknValidity(rows));
    findings.push(...this.analyzeRealDuplicateInvoices(rows, voucherMeta));
    findings.push(...this.analyzeSameDaySameAmountSameParty(rows));
    findings.push(...this.analyzeLedgerTotalBalance(rows));
    findings.push(...this.analyzeCariReverseBalance(rows));
    findings.push(...this.analyzeHavadaKdv(rows, voucherMeta));
    findings.push(...this.analyzeMissingDescriptionHighValue(rows));
    findings.push(...this.analyzeOrtakAlacakFaiz(rows));
    findings.push(...this.analyzeDonemSonu191391Bakiye(rows, isYillik));
    findings.push(...this.analyzeBordroTahakkukAylik(rows, range));
    findings.push(...this.analyzeStopajKontrolleri(rows, range));
    findings.push(...this.analyzeAcilisFisiKontrol(rows, range, isYillik));
    findings.push(...this.analyzeYillikKapanisKontrol(rows, range, voucherMeta, isYillik));
    findings.push(...this.analyzeAvansKapanmamis(rows));
    findings.push(...this.analyzeVadesiGecmisCekSenet(rows, range));
    findings.push(...this.analyzeBankaEksiBakiye(rows));
    findings.push(...this.analyzePOSValor108(rows));
    findings.push(...this.analyzeKKEG689(rows));
    findings.push(...this.analyzeAmortismanYilSonu(rows, range, isYillik));
    findings.push(...this.analyzeVergiKarsiligi370(rows, range, isYillik));
    // Forensic / anomali katmani (istatistiksel; ozet bulgu uretir)
    findings.push(...this.analyzeBenford(rows));
    findings.push(...this.analyzeRoundNumbers(rows));
    findings.push(...this.analyzeWeekendEntries(rows));
    findings.push(...this.analyzeSuspiciousDescriptions(rows));

    // FIS_TARIHI_EKSIK ozeti: tek bilgi olarak topla
    const tarihEksik = rows.filter((r) => {
      if (r.fisTarihi || voucherMeta.get(r.voucherKey)?.date) return false;
      return this.isDateRequiredVoucherRow(r);
    });
    if (tarihEksik.length > 0) {
      findings.push({
        severity: tarihEksik.length > rows.length * 0.5 ? 'ERROR' : 'WARN',
        category: 'FIS_TARIHI_PARSE_HATASI',
        message: `Excel dosyasinda ${tarihEksik.length} fis satirinin bagli oldugu fiste tarih okunamadi (toplam ${rows.length} satir). Luca rapor formati veya Tarih sutunu kontrol edilmeli.`,
        voucherKey: tarihEksik[0].voucherKey,
        rowIndex: tarihEksik[0].rowIndex,
        detail: { eksikSatir: tarihEksik.length, toplamSatir: rows.length },
      });
    }

    const filtered = findings.filter((f) => {
      const explicit = ruleSettings.get(f.category);
      if (explicit === false) return false;
      if (explicit === true) return true;
      return !DEFAULT_DISABLED_CATEGORIES.has(f.category);
    });

    return filtered.slice(0, 10000);
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
    // Fis tipi sutunu metne dahil EDILMEZ: Luca'da cogu fisin tipi "Mahsup" oldugundan
    // fis tipindeki "mahsup" her fisi tahakkuk metnine uydurur (orn. iade fisi tahakkuk sanilir).
    const hasAccrualText = /kdv|tahakkuk|mahsup|beyanname|devreden|odenecek/.test(this.voucherTextWithoutFisTipi(rows));
    // Gevsetildi: 191 alacak VEYA 391 borc + (190/360 hesabi VEYA tahakkuk metni) yeterli.
    // Boylece sadece-devreden ve tevkifatli tahakkuk fisleri de "tahakkuk" sayilir,
    // KDV_TAHAKKUK_EKSIK yanlis alarmi azalir. (Normal alis 191 borc / satis 391 alacak calistigi icin tetiklenmez.)
    return (has191Credit || has391Debit) && (hasSettlementAccount || hasAccrualText);
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
    if (meta.isVatAccrual || this.isOpeningLikeVoucher(meta) || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta) || this.isPayrollVoucher(meta)) {
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
    if (meta.isVatAccrual || this.isOpeningLikeVoucher(meta) || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta)) return [];
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
        // Bazi ofisler tahakkuk fisini beyanname gununde (takip eden ayin ~26'si) keser.
        // Takip eden ayda ay-sonu tarihli OLMAYAN bir tahakkuk fisi varsa buyuk ihtimalle
        // bu ayin tahakkukudur: WARN yerine INFO ver ve o fise capala.
        const nextKey = this.addMonthKey(monthKey, 1);
        const nextAccrual = [...new Map(
          rows
            .filter((r) => r.fisTarihi && this.monthKey(r.fisTarihi) === nextKey)
            .map((r) => [r.voucherKey, voucherMeta.get(r.voucherKey)]),
        ).values()]
          .filter((m): m is VoucherMeta => Boolean(m))
          .find((m) => m.isVatAccrual && m.date && !this.sameDateUTC(m.date, this.endOfMonthUTC(m.date)));
        // 2026-06-11: Tahakkuk fisi AY-SONU tarihine (or. 31.03) kesilmis olabilir;
        // ustteki filtre (ay-sonu OLMAYAN) onu kacirir. Ama tahakkuk fisinin
        // aciklamasinda ay yazili olur ("Subat Ayi KDV Tahakkuk"). Luca Detay Fis
        // Listesi'nde fis bazen FIS TARIHI (28.02) yerine EVRAK TARIHI (31.03) ile
        // gelir -> sistem Mart'a atar. Range icinde aciklamasinda BU ayi gecen bir
        // tahakkuk fisi varsa tahakkuk MEVCUT say; yanlis "bulunamadi" uyarisini onle.
        const ayAdi = this.ayAdiFromMonthKey(monthKey);
        const namedAccrual = ayAdi
          ? ([...voucherMeta.values()].find(
              (m) =>
                m.isVatAccrual &&
                this.normalizeLoose(this.voucherTextWithoutFisTipi(m.rows)).includes(ayAdi),
            ) || null)
          : null;
        const tahakkuk = nextAccrual || namedAccrual;
        if (tahakkuk) {
          const tarihNotu = tahakkuk.date ? `${this.fmtDate(tahakkuk.date)} tarihli ` : '';
          findings.push({
            severity: 'INFO',
            category: 'KDV_TAHAKKUK_EKSIK',
            message: `${label} KDV tahakkuk/mahsup fisi ${tarihNotu}olarak MEVCUT; tahakkuk evrak/beyanname tarihine (or. ay sonu) kesilmis gorunuyor, fis tarihi ay icinde olabilir. Isaretli satir bu tahakkuk fisidir.`,
            voucherKey: tahakkuk.key,
            rowIndex: tahakkuk.first.rowIndex,
            detail: { ay: monthKey, tahakkukTarihi: tahakkuk.date ? tahakkuk.date.toISOString().slice(0, 10) : null },
          });
        } else {
          findings.push({
            severity: 'WARN',
            category: 'KDV_TAHAKKUK_EKSIK',
            message: `${label} icin 191/391 hareketi var ancak KDV tahakkuk/mahsup fisi bulunamadi. (Son ayin tahakkuku bir sonraki doneme kaymis olabilir; kontrol edin.) Isaretli satir ayin ilk KDV satiridir; sorunlu kayit degildir.`,
            voucherKey: first.voucherKey,
            rowIndex: first.rowIndex,
            detail: { ay: monthKey, isaretNotu: 'ayin ilk 191/391 satiri' },
          });
        }
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
            severity: 'INFO',
            category: 'KDV_ODENECEK_360_UYUMSUZ',
            message: `${label} odenecek KDV ${this.fmt(odenecek)} TL hesaplandi; tahakkukta 360 alacak ${this.fmt(account360)} TL. (Onceki donem devreden/tevkifat haric tutuldu; beyanla teyit edin.)`,
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
            severity: 'INFO',
            category: 'KDV_DEVREDEN_190_UYUMSUZ',
            message: `${label} devreden KDV ${this.fmt(devreden)} TL hesaplandi; tahakkukta 190 borc ${this.fmt(account190)} TL. (Onceki donem devreden haric; beyanla teyit edin.)`,
            voucherKey: accruals[0].key,
            rowIndex: accruals[0].first.rowIndex,
            detail: { devreden, account190 },
          });
        }
      }
    }
    return findings;
  }

  private isOpeningLikeText(value?: string | null) {
    const text = this.normalizeLoose(value);
    return /(?:^|\s)a?cilis(?:\s+fisi|\s+kaydi)?(?:\s|$)/.test(text);
  }

  private isOpeningLikeVoucher(meta: VoucherMeta) {
    return this.isOpeningLikeText(meta.description) || meta.rows.some((r) => this.isOpeningLikeText(this.rowText(r)));
  }

  private isClosingLikeVoucher(meta: VoucherMeta) {
    const desc = this.normalizeLoose(meta.description);
    if (/kapanis|yansitma|devir|virman|aktarma|duzeltme/.test(desc)) return true;
    // "mahsup" yalnizca belge turu/aciklama/hesap adinda geciyorsa kapanis sinyalidir.
    // Fis tipi sutunundaki genel "Mahsup" degeri sayilmaz; yoksa Luca'da neredeyse tum
    // fisler kapanis-benzeri sayilir ve belge/mukerrer kontrolleri tamamen devre disi kalir.
    return /mahsup/.test(this.voucherTextWithoutFisTipi(meta.rows));
  }

  private voucherTextWithoutFisTipi(rows: ParsedEDefterFisLine[]) {
    return this.normalizeLoose(
      rows.map((r) => [r.belgeTuru, r.aciklama, r.hesapAdi].filter(Boolean).join(' ')).join(' '),
    );
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

  private isTevsikCashCandidate(row: ParsedEDefterFisLine, meta?: VoucherMeta | null) {
    if (!row.fisTarihi || !/^100/.test(row.hesapKodu || '')) return false;
    if (this.amountOf(row) <= 0) return false;
    if (!meta) return true;
    if (meta.rows.some((r) => /^(102|103|108)/.test(r.hesapKodu || ''))) return false;
    if (meta.isVatAccrual || this.isOpeningLikeVoucher(meta) || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta)) {
      return false;
    }
    return true;
  }

  private isDateRequiredVoucherRow(row: ParsedEDefterFisLine) {
    if (row.fisNo || row.yevmiyeNo) return true;
    return this.isValidAccountCode(row.hesapKodu) && this.amountOf(row) > 0;
  }

  private requiresDocumentFields(row: ParsedEDefterFisLine, meta?: VoucherMeta | null) {
    if (!row.hesapKodu) return false;
    if (meta && (meta.isVatAccrual || this.isOpeningLikeVoucher(meta) || this.isClosingLikeVoucher(meta) || this.isCostReflectionVoucher(meta) || this.isPayrollVoucher(meta))) {
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

  private isMinimumWagePayrollExemptionLikely(voucherRows: ParsedEDefterFisLine[]) {
    const voucherText = this.normalizeLoose(voucherRows.map((r) => this.rowText(r)).join(' '));
    if (!/ucret|maas|personel|bordro/.test(voucherText)) return false;

    const grossWage = voucherRows
      .filter((r) => /^(720|730|740|750|760|770|772)/.test(r.hesapKodu || '') && Number(r.borc || 0) > 0)
      .filter((r) => {
        const text = this.rowText(r);
        if (/isveren|sgk|ssk|issizlik|prim|damga|gelir vergisi|stopaj/.test(text)) return false;
        return /brut|ucret|maas|personel|bordro/.test(text);
      })
      .reduce((sum, r) => sum + Number(r.borc || 0), 0);

    const netWage = voucherRows
      .filter((r) => /^335/.test(r.hesapKodu || '') && Number(r.alacak || 0) > 0)
      .reduce((sum, r) => sum + Number(r.alacak || 0), 0);

    const hasSgkLiability = voucherRows.some((r) => /^361/.test(r.hesapKodu || '') && Number(r.alacak || 0) > 0);
    const hasPayrollTax = voucherRows.some((r) => /^360/.test(r.hesapKodu || '') && /(gelir|damga|ucret|maas|personel)/.test(this.rowText(r)));
    if (grossWage <= 0 || netWage <= 0 || !hasSgkLiability || hasPayrollTax) return false;

    const employeeDeductionRatio = (grossWage - netWage) / grossWage;
    return employeeDeductionRatio >= 0.12 && employeeDeductionRatio <= 0.18;
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
      if (range && row.evrakTarihi > range.end) {
        // Gelecek tarihli belge: gercek uyari.
        findings.push({
          severity: 'WARN',
          category: 'BELGE_TARIHI_DONEM_DISI',
          message: `Satir ${row.rowIndex}: belge tarihi (${this.fmtDate(row.evrakTarihi)}) donem bitisinden sonra; ileri tarihli belge kontrol edilmeli.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      } else if (range && row.evrakTarihi < range.start) {
        // Onceki donem belgesinin cari donemde kaydi (gec gelen fatura) yasaldir; sadece bilgi.
        findings.push({
          severity: 'INFO',
          category: 'BELGE_TARIHI_DONEM_DISI',
          message: `Satir ${row.rowIndex}: belge tarihi (${this.fmtDate(row.evrakTarihi)}) onceki doneme ait (gec gelen fatura olabilir).`,
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

    const gaps: { onceki: number; sonraki: number }[] = [];
    let firstGapRow: ParsedEDefterFisLine | null = null;
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr - prev <= 1) continue;
      gaps.push({ onceki: prev, sonraki: curr });
      if (!firstGapRow) firstGapRow = byNumber.get(curr)![0];
    }
    if (gaps.length) {
      // Iptal edilen fisler mesru yevmiye no atlamasi yaratir; 10 ayri uyari yerine tek ozet + bilgi.
      const ornek = gaps.slice(0, 5).map((g) => `${g.onceki}->${g.sonraki}`).join(', ');
      findings.push({
        severity: 'INFO',
        category: 'YEVMIYE_NO_ATLAMA',
        message: `Yevmiye no sirasinda ${gaps.length} atlama var (ornek: ${ornek}${gaps.length > 5 ? ' ...' : ''}). Iptal edilen fislerden olabilir; kontrol edilmeli.`,
        voucherKey: firstGapRow?.voucherKey,
        rowIndex: firstGapRow?.rowIndex,
        detail: { gapCount: gaps.length, gaps: gaps.slice(0, 20) },
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

  private analyzeCashTevsik(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const limit = 30000;
    for (const row of rows) {
      const meta = voucherMeta.get(row.voucherKey);
      if (!this.isTevsikCashCandidate(row, meta)) continue;
      const amount = this.amountOf(row);
      if (amount <= limit) continue;
      const side = Number(row.borc || 0) >= Number(row.alacak || 0) ? 'borc' : 'alacak';
      findings.push({
        severity: 'WARN',
        category: 'KASA_HAREKET_30000_TEVSIK_RISKI',
        message: `Satir ${row.rowIndex}: 100 Kasa ${side} hareketi ${this.fmt(amount)} TL. Tahsilat/odeme mahiyetindeyse VUK 459 tevsik siniri asiliyor; banka, PTT veya araci finansal kurum belgesiyle kontrol edilmeli.`,
        voucherKey: row.voucherKey,
        rowIndex: row.rowIndex,
        hesapKodu: row.hesapKodu,
        detail: { amount, limit, side, voucher: this.voucherLabel(row) },
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

  private analyzeTevsikParcalama(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byPartyDay = new Map<string, ParsedEDefterFisLine[]>();
    const limit = 30000;
    for (const row of rows) {
      const meta = voucherMeta.get(row.voucherKey);
      if (!this.isTevsikCashCandidate(row, meta)) continue;
      const vkn = String(row.vknTckn || '').replace(/\D/g, '');
      if (!vkn || (vkn.length !== 10 && vkn.length !== 11)) continue;
      const day = row.fisTarihi!.toISOString().slice(0, 10);
      const key = `${vkn}|${day}`;
      if (!byPartyDay.has(key)) byPartyDay.set(key, []);
      byPartyDay.get(key)!.push(row);
    }
    for (const [key, partyRows] of byPartyDay.entries()) {
      if (partyRows.length < 2) continue;
      const total = partyRows.reduce((sum, r) => sum + this.amountOf(r), 0);
      if (total <= limit) continue;
      if (partyRows.some((r) => this.amountOf(r) > limit)) continue;
      const [vkn, day] = key.split('|');
      const first = partyRows[0];
      findings.push({
        severity: 'WARN',
        category: 'KASA_TEVSIK_PARCALAMA',
        message: `${this.fmtDate(new Date(`${day}T00:00:00.000Z`))} tarihinde ${vkn} VKN/TCKN ile ${partyRows.length} ayri 100 Kasa hareketi toplam ${this.fmt(total)} TL. Ayni gun ayni taraf islemleri tevsik sinirinda birlikte degerlendirilir; parcalama riski kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: first.hesapKodu,
        detail: { vknTckn: vkn, day, parcaSayisi: partyRows.length, toplam: total, limit },
      });
    }
    return findings;
  }

  private analyzeTevsikBolunmusIslem(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byPartyDocument = new Map<string, ParsedEDefterFisLine[]>();
    const limit = 30000;
    for (const row of rows) {
      const meta = voucherMeta.get(row.voucherKey);
      if (!this.isTevsikCashCandidate(row, meta)) continue;
      const vkn = String(row.vknTckn || '').replace(/\D/g, '');
      if (!vkn || (vkn.length !== 10 && vkn.length !== 11)) continue;
      const documentNo = this.normalizeDocumentNo(row.evrakNo);
      if (!documentNo || /^(MUHTELIF|NAKIT|BELGESIZ|YOK|DIGER|OTHER)$/.test(documentNo)) continue;
      const key = `${vkn}|${documentNo}`;
      if (!byPartyDocument.has(key)) byPartyDocument.set(key, []);
      byPartyDocument.get(key)!.push(row);
    }

    for (const [key, documentRows] of byPartyDocument.entries()) {
      const voucherKeys = [...new Set(documentRows.map((r) => r.voucherKey))];
      const days = [...new Set(documentRows.map((r) => r.fisTarihi!.toISOString().slice(0, 10)))].sort();
      if (voucherKeys.length < 2 || days.length < 2) continue;
      const total = documentRows.reduce((sum, r) => sum + this.amountOf(r), 0);
      if (total <= limit) continue;
      if (documentRows.some((r) => this.amountOf(r) > limit)) continue;
      const [vkn, documentNo] = key.split('|');
      const first = documentRows[0];
      findings.push({
        severity: 'WARN',
        category: 'KASA_TEVSIK_BOLUNMUS_ISLEM',
        message: `${documentNo} belge no / ${vkn} VKN-TCKN icin ${days.length} farkli gunde ${voucherKeys.length} kasa kaydi toplam ${this.fmt(total)} TL. Ayni isleme ait kismi tahsilat/odemeler de tevsik kapsaminda birlikte kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: first.hesapKodu,
        detail: { vknTckn: vkn, documentNo, days, voucherCount: voucherKeys.length, toplam: total, limit },
      });
    }
    return findings;
  }

  private analyzeEmptyOrSingleLineVouchers(byVoucher: Map<string, ParsedEDefterFisLine[]>): FindingDraft[] {
    const findings: FindingDraft[] = [];
    for (const [voucherKey, group] of byVoucher.entries()) {
      const first = group[0];
      const hasReliableVoucherKey = Boolean(first.fisNo || first.yevmiyeNo);
      if (!hasReliableVoucherKey) continue;
      const nonZero = group.filter((r) => (r.borc || 0) !== 0 || (r.alacak || 0) !== 0);
      if (nonZero.length === 0) {
        findings.push({
          severity: 'WARN',
          category: 'BOS_FIS',
          message: `Fis ${this.voucherLabel(first)} icinde hicbir hareket satiri yok; bos fis kontrol edilmeli.`,
          voucherKey,
          rowIndex: first.rowIndex,
        });
        continue;
      }
      if (nonZero.length === 1) {
        findings.push({
          severity: 'WARN',
          category: 'TEK_SATIRLI_FIS',
          message: `Fis ${this.voucherLabel(first)} sadece 1 hareket satirina sahip; cift tarafli kayit prensibi ihlali olabilir.`,
          voucherKey,
          rowIndex: first.rowIndex,
        });
      }
    }
    return findings;
  }

  private analyzeVknValidity(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const seenInvalid = new Set<string>();
    for (const row of rows) {
      if (!row.vknTckn) continue;
      const digits = String(row.vknTckn).replace(/\D/g, '');
      if (!digits || (digits.length !== 10 && digits.length !== 11)) {
        const key = `${row.voucherKey}|${digits}`;
        if (seenInvalid.has(key)) continue;
        seenInvalid.add(key);
        findings.push({
          severity: 'ERROR',
          category: 'VKN_FORMAT_HATALI',
          message: `Satir ${row.rowIndex}: VKN/TCKN format hatali (${row.vknTckn}); 10 veya 11 haneli olmali.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
        continue;
      }
      const isValid = digits.length === 10 ? this.isValidVkn(digits) : this.isValidTckn(digits);
      if (!isValid) {
        const key = `${row.voucherKey}|${digits}`;
        if (seenInvalid.has(key)) continue;
        seenInvalid.add(key);
        findings.push({
          severity: 'ERROR',
          category: 'VKN_ALGORITMA_HATALI',
          message: `Satir ${row.rowIndex}: ${digits.length === 10 ? 'VKN' : 'TCKN'} kontrol algoritmasi tutmuyor (${digits}); BA/BS uyumsuzlugu yaratir.`,
          voucherKey: row.voucherKey,
          rowIndex: row.rowIndex,
          hesapKodu: row.hesapKodu,
        });
      }
    }
    return findings;
  }

  private analyzeRealDuplicateInvoices(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byKey = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      const meta = voucherMeta.get(row.voucherKey);
      if (!this.requiresDocumentFields(row, meta)) continue;
      const docNo = this.normalizeDocumentNo(row.evrakNo);
      if (!docNo) continue;
      const vkn = String(row.vknTckn || '').replace(/\D/g, '');
      if (!vkn || (vkn.length !== 10 && vkn.length !== 11)) continue;
      const amount = Math.round(this.amountOf(row) * 100);
      if (amount < 100) continue;
      const key = `${docNo}|${vkn}|${amount}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
    for (const [key, dupRows] of byKey.entries()) {
      const voucherKeys = [...new Set(dupRows.map((r) => r.voucherKey))];
      if (voucherKeys.length <= 1) continue;
      const [docNo, vkn, amountCents] = key.split('|');
      const first = dupRows[0];
      findings.push({
        severity: 'ERROR',
        category: 'GERCEK_MUKERRER_FATURA',
        message: `${docNo} belge no + ${vkn} VKN + ${this.fmt(Number(amountCents) / 100)} TL kombinasyonu ${voucherKeys.length} farkli fiste mukerrer; KDV indirimi mukerrer inmis olabilir.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: first.hesapKodu,
        detail: { docNo, vkn, amount: Number(amountCents) / 100, voucherCount: voucherKeys.length },
      });
    }
    return findings;
  }

  private analyzeSameDaySameAmountSameParty(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byKey = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of rows) {
      if (!row.fisTarihi) continue;
      if (!/^(120|320|600|601|602|150|153|191|391)/.test(row.hesapKodu || '')) continue;
      const vkn = String(row.vknTckn || '').replace(/\D/g, '');
      if (!vkn || (vkn.length !== 10 && vkn.length !== 11)) continue;
      const amount = Math.round(this.amountOf(row) * 100);
      if (amount < 5000000) continue;
      const day = row.fisTarihi.toISOString().slice(0, 10);
      const key = `${day}|${vkn}|${amount}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
    for (const [key, grpRows] of byKey.entries()) {
      const voucherKeys = [...new Set(grpRows.map((r) => r.voucherKey))];
      if (voucherKeys.length <= 1) continue;
      const [day, vkn, amountCents] = key.split('|');
      const first = grpRows[0];
      findings.push({
        severity: 'WARN',
        category: 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF',
        message: `${this.fmtDate(new Date(`${day}T00:00:00.000Z`))} tarihinde ${vkn} VKN icin ayni tutarli (${this.fmt(Number(amountCents) / 100)} TL) ${voucherKeys.length} kayit; mukerrerlik kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        detail: { day, vkn, voucherCount: voucherKeys.length },
      });
    }
    return findings;
  }

  private analyzeLedgerTotalBalance(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const totalBorc = rows.reduce((s, r) => s + Number(r.borc || 0), 0);
    const totalAlacak = rows.reduce((s, r) => s + Number(r.alacak || 0), 0);
    const fark = Math.abs(totalBorc - totalAlacak);
    if (fark <= 0.05) return [];
    // Ozet bulgu: tek bir satira capalanmaz (defter genelini ilgilendirir).
    return [{
      severity: 'ERROR',
      category: 'DEFTER_GENELI_DENGESIZ',
      message: `Defter geneli denge bozuk. Toplam borc ${this.fmt(totalBorc)} TL, toplam alacak ${this.fmt(totalAlacak)} TL, fark ${this.fmt(fark)} TL. Berat olusturmadan duzeltilmeli.`,
      detail: { totalBorc, totalAlacak, fark },
    }];
  }

  private analyzeCariReverseBalance(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byCode = new Map<string, { borc: number; alacak: number; first: ParsedEDefterFisLine }>();
    for (const row of rows) {
      const code = String(row.hesapKodu || '');
      if (!/^(120|320)/.test(code)) continue;
      if (!byCode.has(code)) byCode.set(code, { borc: 0, alacak: 0, first: row });
      const agg = byCode.get(code)!;
      agg.borc += Number(row.borc || 0);
      agg.alacak += Number(row.alacak || 0);
    }
    for (const [code, agg] of byCode.entries()) {
      const net = agg.borc - agg.alacak;
      // Detay Fis Listesi yalnizca donem hareketini tasir (acilis/devir bakiyesi yok).
      // Bu yuzden esik yuksek tutuldu; dusuk esik normal musterileri ters bakiye sanar.
      if (Math.abs(net) < 5000) continue;
      if (/^120/.test(code) && net < -5000) {
        findings.push({
          severity: 'WARN',
          category: 'CARI_TERS_BAKIYE_120',
          message: `${code} Alicilar hesabi donem hareketinde ters (alacak) bakiye veriyor (${this.fmt(Math.abs(net))} TL; acilis bakiyesi haric). Musteri avansi/fazla odeme olabilir; ya da bu cariden yapilan bir alis/gider satici hesabi (320) yerine bu alici hesabina islenmis olabilir.`,
          voucherKey: agg.first.voucherKey,
          rowIndex: agg.first.rowIndex,
          hesapKodu: code,
        });
      }
      if (/^320/.test(code) && net > 5000) {
        findings.push({
          severity: 'WARN',
          category: 'CARI_TERS_BAKIYE_320',
          message: `${code} Saticilar hesabi donem hareketinde ters (borc) bakiye veriyor (${this.fmt(net)} TL; acilis bakiyesi haric). Saticiya verilen avans olabilir; ya da bu cariye yapilan bir satis musteri hesabi (120) yerine bu satici hesabina islenmis olabilir.`,
          voucherKey: agg.first.voucherKey,
          rowIndex: agg.first.rowIndex,
          hesapKodu: code,
        });
      }
    }
    return findings;
  }

  private analyzeHavadaKdv(
    rows: ParsedEDefterFisLine[],
    voucherMeta: Map<string, VoucherMeta>,
  ): FindingDraft[] {
    const findings: FindingDraft[] = [];
    for (const meta of voucherMeta.values()) {
      if (meta.isVatAccrual) continue;
      const hasKdv = meta.rows.some((r) => /^(191|391)/.test(r.hesapKodu || '') && this.amountOf(r) > 1);
      if (!hasKdv) continue;
      const hasMatrah = meta.rows.some((r) => /^(150|151|152|153|157|159|600|601|602|710|720|730|740|750|760|770|780)/.test(r.hesapKodu || ''));
      const hasCariOrCash = meta.rows.some((r) => /^(100|101|102|103|108|120|190|320|321|329|331|335|336|360)/.test(r.hesapKodu || ''));
      if (!hasMatrah && !hasCariOrCash) {
        findings.push({
          severity: 'ERROR',
          category: 'HAVADA_KDV_KAYDI',
          message: `Fis ${this.voucherLabel(meta.first)} 191/391 KDV iceriyor ancak matrah veya cari/kasa karsilik hesabi yok; havada kalan KDV kaydi.`,
          voucherKey: meta.key,
          rowIndex: meta.first.rowIndex,
        });
      }
    }
    return findings;
  }

  private analyzeMissingDescriptionHighValue(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const seenVouchers = new Set<string>();
    for (const row of rows) {
      if (seenVouchers.has(row.voucherKey)) continue;
      const amount = this.amountOf(row);
      if (amount < 50000) continue;
      const desc = String(row.aciklama || '').trim();
      if (desc.length >= 5) continue;
      seenVouchers.add(row.voucherKey);
      findings.push({
        severity: 'INFO',
        category: 'YUKSEK_TUTAR_ACIKLAMA_EKSIK',
        message: `Fis ${this.voucherLabel(row)} (${this.fmt(amount)} TL) aciklamasi cok kisa veya bos; denetimde aciklamasiz buyuk fis riskli.`,
        voucherKey: row.voucherKey,
        rowIndex: row.rowIndex,
        hesapKodu: row.hesapKodu,
      });
    }
    return findings;
  }

  // Donem sonu 191 ve 391 hesap bakiye kontrolu.
  // KDV tahakkuk yapilmissa bu hesaplar donem sonunda sifirlanmis olmali.
  private analyzeDonemSonu191391Bakiye(rows: ParsedEDefterFisLine[], isYillik: boolean): FindingDraft[] {
    // Yalnizca YILLIK defterde anlamli: aylik/ceyrek defterde devreden KDV nedeniyle
    // 191/391 bakiyesi kalmasi normaldir, bu kural orada yanlis alarm uretir.
    if (!isYillik) return [];
    const findings: FindingDraft[] = [];
    const calc = (prefix: RegExp) => {
      let borc = 0, alacak = 0;
      let first: ParsedEDefterFisLine | null = null;
      for (const r of rows) {
        if (!prefix.test(r.hesapKodu || '')) continue;
        borc += Number(r.borc || 0);
        alacak += Number(r.alacak || 0);
        if (!first) first = r;
      }
      return { borc, alacak, fark: borc - alacak, first };
    };

    const k191 = calc(/^191/);
    if (k191.first && Math.abs(k191.fark) > 1) {
      findings.push({
        severity: 'WARN',
        category: 'DONEM_SONU_191_BAKIYE',
        message: `Donem sonu 191 Indirilecek KDV bakiyesi sifirlanmamis (borc ${this.fmt(k191.borc)} - alacak ${this.fmt(k191.alacak)} = ${this.fmt(k191.fark)} TL). Tahakkuk fisi kontrol edilmeli.`,
        voucherKey: k191.first.voucherKey,
        rowIndex: k191.first.rowIndex,
        hesapKodu: '191',
        detail: { borc: k191.borc, alacak: k191.alacak, fark: k191.fark },
      });
    }

    const k391 = calc(/^391/);
    if (k391.first && Math.abs(k391.fark) > 1) {
      findings.push({
        severity: 'WARN',
        category: 'DONEM_SONU_391_BAKIYE',
        message: `Donem sonu 391 Hesaplanan KDV bakiyesi sifirlanmamis (alacak ${this.fmt(k391.alacak)} - borc ${this.fmt(k391.borc)} = ${this.fmt(-k391.fark)} TL). Tahakkuk fisi kontrol edilmeli.`,
        voucherKey: k391.first.voucherKey,
        rowIndex: k391.first.rowIndex,
        hesapKodu: '391',
        detail: { borc: k391.borc, alacak: k391.alacak, fark: k391.fark },
      });
    }

    return findings;
  }

  private analyzeOrtakAlacakFaiz(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    let borc = 0, alacak = 0;
    let first: ParsedEDefterFisLine | null = null;
    for (const row of rows) {
      if (!/^131/.test(row.hesapKodu || '')) continue;
      borc += Number(row.borc || 0);
      alacak += Number(row.alacak || 0);
      if (!first) first = row;
    }
    const net = borc - alacak;
    if (!first || net < 100000) return [];
    return [{
      severity: 'INFO',
      category: 'ORTAK_ALACAK_FAIZ_RISKI',
      message: `131 Ortaklardan Alacaklar net bakiyesi ${this.fmt(net)} TL; KKEG kapsaminda ortak cari faiz hesaplamasi (KVK transfer fiyatlandirma) gerekli olabilir.`,
      voucherKey: first.voucherKey,
      rowIndex: first.rowIndex,
      hesapKodu: first.hesapKodu,
    }];
  }

  // Aylik bordro tahakkuku: her ay 770 veya 772 personel gider hesabi olmali
  private analyzeBordroTahakkukAylik(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null): FindingDraft[] {
    if (!range) return [];
    const findings: FindingDraft[] = [];
    const months = this.monthKeysInRange(range.start, range.end);
    for (const mk of months) {
      const monthRows = rows
        .filter((r) => r.fisTarihi && this.monthKey(r.fisTarihi) === mk)
        .filter((r) => {
          const text = this.rowText(r);
          return !this.isOpeningLikeText(text) && !/kapanis|donem sonu/.test(text);
        });
      if (!monthRows.length) continue;
      // Bordro fisi = icinde 335/361 hesabi veya net ucret/sgk/bordro/maas metni gecen fis.
      // Boylece alakasiz fisler (orn. 740 arac yakit) bordro kontrolune girmez.
      const byVoucher = new Map<string, ParsedEDefterFisLine[]>();
      for (const r of monthRows) {
        if (!byVoucher.has(r.voucherKey)) byVoucher.set(r.voucherKey, []);
        byVoucher.get(r.voucherKey)!.push(r);
      }
      const payrollRows: ParsedEDefterFisLine[] = [];
      for (const vrows of byVoucher.values()) {
        const isPayroll = vrows.some((r) => /^(335|361)/.test(r.hesapKodu || '') || /ucret|maas|bordro|sgk|ssk/.test(this.rowText(r)));
        if (isPayroll) payrollRows.push(...vrows);
      }
      if (!payrollRows.length) continue;
      const hasNet = payrollRows.some((r) => /^335/.test(r.hesapKodu || ''));
      const hasSgk = payrollRows.some((r) => /^361/.test(r.hesapKodu || ''));
      // Brut ucret gideri 7/A (720-760) ya da 7/B (770/772) olabilir; ikisini de say.
      const hasWageExpense = payrollRows.some((r) => /^(720|730|740|750|760|770|772)/.test(r.hesapKodu || ''));
      // 335 net ucret + 361 SGK birlikte varsa tahakkuk yapilmistir; gider hesabi siniflandirma detayidir.
      if (hasNet && hasSgk) continue;
      const missing: string[] = [];
      if (!hasNet) missing.push('335 net ucret');
      if (!hasSgk) missing.push('361 SGK primi');
      if (!hasWageExpense) missing.push('ucret gideri (720-772)');
      if (!missing.length) continue;
      // Bulguyu gercek bir bordro satirina capala (alakasiz ilk aya degil).
      const anchor = payrollRows.find((r) => /^(335|361|770|772|720|730|740|750|760)/.test(r.hesapKodu || '')) || payrollRows[0];
      findings.push({
        severity: 'WARN',
        category: 'BORDRO_TAHAKKUK_EKSIK',
        message: `${this.describeMonth(mk)} bordro tahakkukunda eksik bacak var: ${missing.join(', ')} bulunamadi (net ucret: ${hasNet}, SGK: ${hasSgk}, ucret gideri: ${hasWageExpense}).`,
        voucherKey: anchor.voucherKey,
        rowIndex: anchor.rowIndex,
        hesapKodu: anchor.hesapKodu,
        detail: { ay: mk, hasNet, hasSgk, hasWageExpense },
      });
    }
    return findings;
  }

  // Stopaj kontrolleri: kira, SMM, damga ve gelir vergisi hesaplari.
  private analyzeStopajKontrolleri(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const operationalRows = rows.filter((r) => {
      const text = this.rowText(r);
      return !this.isOpeningLikeText(text) && !/kapanis|donem sonu/.test(text);
    });
    const byVoucher = new Map<string, ParsedEDefterFisLine[]>();
    for (const row of operationalRows) {
      if (!byVoucher.has(row.voucherKey)) byVoucher.set(row.voucherKey, []);
      byVoucher.get(row.voucherKey)!.push(row);
    }
    // Kira odemesi varsa stopaj kontrolu
    const kiraRows = operationalRows.filter((r) => /^(770|760|730)/.test(r.hesapKodu || '') && /kira|isyeri/i.test(`${r.aciklama || ''} ${r.hesapAdi || ''}`));
    if (kiraRows.length) {
      // Stopaj her ofiste 360.01.006 olmayabilir; 360 altinda kira/stopaj metni de kabul.
      const stopajRows = operationalRows.filter((r) => {
        if (!/^360/.test(r.hesapKodu || '')) return false;
        return /^360\.01\.006/.test(r.hesapKodu || '') || /kira|stopaj/.test(this.rowText(r));
      });
      const kiraTotal = kiraRows.reduce((s, r) => s + Number(r.borc || 0), 0);
      const stopajTotal = stopajRows.reduce((s, r) => s + Number(r.alacak || 0), 0);
      if (kiraTotal > 1 && stopajTotal < 1) {
        findings.push({
          severity: 'WARN',
          category: 'KIRA_STOPAJI_EKSIK',
          message: `Donemde kira gideri ${this.fmt(kiraTotal)} TL gorunuyor ancak 360 altinda kira stopaji kaydi bulunamadi. %20 stopaj (GVK 94) ayri fiste/donemde olabilir; kontrol edilmeli.`,
          voucherKey: kiraRows[0].voucherKey,
          rowIndex: kiraRows[0].rowIndex,
          hesapKodu: kiraRows[0].hesapKodu,
          detail: { kiraTotal, stopajTotal },
        });
      } else if (kiraTotal > 1 && stopajTotal > 1) {
        const oran = (stopajTotal / kiraTotal) * 100;
        if (oran < 15 || oran > 25) {
          findings.push({
            severity: 'WARN',
            category: 'KIRA_STOPAJI_ORAN',
            message: `Kira gideri ${this.fmt(kiraTotal)} TL, stopaj ${this.fmt(stopajTotal)} TL (oran %${oran.toFixed(1)}). Beklenen %20 (GVK 94). Brut/net hesaplama kontrol edilmeli.`,
            voucherKey: kiraRows[0].voucherKey,
            rowIndex: kiraRows[0].rowIndex,
            hesapKodu: kiraRows[0].hesapKodu,
            detail: { kiraTotal, stopajTotal, oran },
          });
        }
      }
    }

    // Serbest meslek odemesi varsa stopaj kontrolu. Hesap kodu ofis planinda 360.01.005/007 gibi degisebilir.
    const smmRows = operationalRows.filter((r) => /^(740|770)/.test(r.hesapKodu || '') && /smm|musavir|müşavir|avukat|noter|serbest meslek|muhasebe|tercume|tercüme/i.test(`${r.aciklama || ''} ${r.hesapAdi || ''}`));
    if (smmRows.length) {
      const stopajRows = operationalRows.filter((r) => {
        if (!/^360/.test(r.hesapKodu || '')) return false;
        const text = this.rowText(r);
        return /^360\.01\.(005|007)/.test(r.hesapKodu || '') || /serbest meslek|smm/.test(text);
      });
      if (stopajRows.length === 0) {
        findings.push({
          severity: 'WARN',
          category: 'SMM_STOPAJI_KONTROL',
          message: `Donemde serbest meslek odemesi gorunuyor ancak 360 altinda serbest meslek stopaji hesabi bulunamadi. %20 tevkifat zorunlu (GVK 94).`,
          voucherKey: smmRows[0].voucherKey,
          rowIndex: smmRows[0].rowIndex,
          hesapKodu: smmRows[0].hesapKodu,
        });
      }
    }

    // Personel ucreti varsa damga vergisi kontrolu. Acilis bakiyesindeki 335 personel odemesi sayilmaz.
    const personelOdeme = operationalRows.filter((r) => {
      if (!/^335/.test(r.hesapKodu || '') || Number(r.alacak || 0) <= 0) return false;
      const voucherRows = byVoucher.get(r.voucherKey) || [];
      const voucherText = this.normalizeLoose(voucherRows.map((x) => this.rowText(x)).join(' '));
      return /ucret|maas|personel|bordro/.test(voucherText) ||
        voucherRows.some((x) => /^(770|772|361)/.test(x.hesapKodu || ''));
    });
    for (const personelRow of personelOdeme) {
      const voucherRows = byVoucher.get(personelRow.voucherKey) || [];
      const minimumWageExemptionLikely = this.isMinimumWagePayrollExemptionLikely(voucherRows);
      const hasDamga = voucherRows.some((r) => /^360\.01\.002/.test(r.hesapKodu || '') || (/^360/.test(r.hesapKodu || '') && /damga/.test(this.rowText(r))));
      if (!hasDamga) {
        findings.push({
          severity: 'INFO',
          category: 'DAMGA_VERGISI_KONTROL',
          message: minimumWageExemptionLikely
            ? `Personel ucret/bordro kaydi var; 360.01.002 damga vergisi hesabi gorunmuyor. Asgari ucret istisnasi nedeniyle damga vergisi dogmayabilir; bordroda istisna uygulanip uygulanmadigi veya damga kaydinin ayri fiste olup olmadigi kontrol edilmeli.`
            : `Personel ucret/bordro kaydi var; 360.01.002 damga vergisi hesabi gorunmuyor. Ucret damga vergisi istisna/asgari ucret durumu ve varsa ayri fisteki 360 damga kaydi kontrol edilmeli.`,
          voucherKey: personelRow.voucherKey,
          rowIndex: personelRow.rowIndex,
          hesapKodu: personelRow.hesapKodu,
          detail: { minimumWageExemptionLikely },
        });
        break;
      }
    }

    return findings;
  }

  // Acilis fisi kontrolu: 1 Ocak'ta veya donem basinda olmali, sadece bilanco (1-5) hesaplari olmali
  private analyzeAcilisFisiKontrol(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null, isYillik: boolean): FindingDraft[] {
    if (!range) return [];
    const findings: FindingDraft[] = [];
    const startMonth = range.start.getUTCMonth();
    // Sadece Ocak'ta baslayan donemlerde kontrol et
    if (startMonth !== 0) return findings;
    const acilisRows = rows.filter((r) => this.isOpeningLikeText(this.rowText(r)));
    if (acilisRows.length === 0) {
      // Acilis fisi YOK uyarisini yalnizca YILLIK defterde ver; ceyrek (gecici vergi)
      // defterde acilis fisi beklemek tartismalidir, yanlis alarm olur.
      if (isYillik) {
        findings.push({
          severity: 'WARN',
          category: 'ACILIS_FISI_YOK',
          message: `Donem basinda acilis fisi bulunamadi. Yil basi (1 Ocak) acilis kaydi gecen yilin kapanis mizaniyla bire bir tutmali.`,
        });
      }
    } else {
      // Acilis fisinde gelir/gider/maliyet hesabi (6/7) olmamali; 5xx ozkaynak acilis icin normaldir.
      const yanlisHesap = acilisRows.filter((r) => /^[67]/.test(r.hesapKodu || ''));
      if (yanlisHesap.length) {
        findings.push({
          severity: 'ERROR',
          category: 'ACILIS_FISINDE_GELIR_GIDER',
          message: `Acilis fisinde ${yanlisHesap.length} adet gelir/gider/maliyet (6xx/7xx) hesap kaydi var. Acilis sadece bilanco (1xx-5xx aktif/pasif) hesaplarini icermeli.`,
          voucherKey: yanlisHesap[0].voucherKey,
          rowIndex: yanlisHesap[0].rowIndex,
          hesapKodu: yanlisHesap[0].hesapKodu,
        });
      }
    }
    return findings;
  }

  // Yillik kapanis kontrolu: 690 donem kari/zarari hesabi kullanilmis mi (sadece yil sonunda)
  private analyzeYillikKapanisKontrol(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null, voucherMeta: Map<string, VoucherMeta>, isYillik: boolean): FindingDraft[] {
    if (!range) return [];
    // Yalnizca YILLIK defterde: GECICI_Q4 (Ekim-Aralik) ve tek-ay-Aralik defterlerinde
    // 690 kapanis fisi atilmaz, bu kural orada yanlis alarm uretirdi.
    if (!isYillik) return [];
    const findings: FindingDraft[] = [];
    const has690 = rows.some((r) => /^690/.test(r.hesapKodu || ''));
    if (!has690) {
      const has6xxOr7xx = rows.some((r) => /^[67]/.test(r.hesapKodu || ''));
      if (has6xxOr7xx) {
        findings.push({
          severity: 'WARN',
          category: 'YILLIK_KAPANIS_690_EKSIK',
          message: `Yil sonu donemde 6xx/7xx gelir-gider hesaplari var ama 690 Donem Kari/Zarari hesabi kullanilmamis. Kapanis fisi atilmis mi kontrol edilmeli.`,
        });
      }
    }
    return findings;
  }

  // Avans kontrolu: 159 verilen siparis avansi uzun suredir kapatilmamis
  private analyzeAvansKapanmamis(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const calc = (prefix: RegExp, code: string, ad: string) => {
      let borc = 0, alacak = 0;
      let first: ParsedEDefterFisLine | null = null;
      for (const r of rows) {
        if (!prefix.test(r.hesapKodu || '')) continue;
        borc += Number(r.borc || 0);
        alacak += Number(r.alacak || 0);
        if (!first) first = r;
      }
      // 159 aktif (borc bakiye acik avans), 340 pasif (alacak bakiye acik avans).
      const net = code.startsWith('15') ? borc - alacak : alacak - borc;
      if (first && net > 10000) {
        findings.push({
          severity: 'INFO',
          category: `AVANS_KAPANMAMIS_${code}`,
          message: `${code} ${ad} hesabinda ${this.fmt(net)} TL acik bakiye. Mal/hizmet teslim alindiysa kapatma kaydi yapilmali.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
          hesapKodu: code,
          detail: { borc, alacak, net },
        });
      }
    };
    calc(/^159/, '159', 'Verilen Siparis Avanslari');
    calc(/^340/, '340', 'Alinan Siparis Avanslari');
    return findings;
  }

  // Vadesi gecmis cek-senet
  private analyzeVadesiGecmisCekSenet(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null): FindingDraft[] {
    if (!range) return [];
    const findings: FindingDraft[] = [];
    const calc = (prefix: RegExp, code: string, ad: string) => {
      let borc = 0, alacak = 0;
      let first: ParsedEDefterFisLine | null = null;
      for (const r of rows) {
        if (!prefix.test(r.hesapKodu || '')) continue;
        borc += Number(r.borc || 0);
        alacak += Number(r.alacak || 0);
        if (!first) first = r;
      }
      const net = code.startsWith('12') ? borc - alacak : alacak - borc;
      if (first && net > 1000) {
        findings.push({
          severity: 'INFO',
          category: `CEK_SENET_BAKIYE_${code}`,
          message: `${code} ${ad} hesabi donem sonu bakiyesi ${this.fmt(net)} TL. Vadesi gecmis cek/senet var mi kontrol edilmeli.`,
          voucherKey: first.voucherKey,
          rowIndex: first.rowIndex,
          hesapKodu: code,
        });
      }
    };
    calc(/^121/, '121', 'Alinan Cekler');
    calc(/^122/, '122', 'Alinan Senetler');
    calc(/^322/, '322', 'Verilen Cekler');
    calc(/^323/, '323', 'Verilen Senetler');
    return findings;
  }

  // Banka eksi bakiye = kredi mi, dogru hesapta mi (102 negatif olamaz, 300 olmali)
  private analyzeBankaEksiBakiye(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const byCode = new Map<string, { borc: number; alacak: number; first: ParsedEDefterFisLine }>();
    for (const row of rows) {
      const code = String(row.hesapKodu || '');
      if (!/^102/.test(code)) continue;
      if (!byCode.has(code)) byCode.set(code, { borc: 0, alacak: 0, first: row });
      const agg = byCode.get(code)!;
      agg.borc += Number(row.borc || 0);
      agg.alacak += Number(row.alacak || 0);
    }
    for (const [code, agg] of byCode.entries()) {
      const net = agg.borc - agg.alacak;
      if (net < -1000) {
        findings.push({
          severity: 'WARN',
          category: 'BANKA_EKSI_BAKIYE_102',
          message: `${code} hesabi donem hareketinde alacak bakiye veriyor (${this.fmt(Math.abs(net))} TL; acilis/devir bakiyesi haric). Gercekten eksi bakiye ise 300 Kisa Vadeli Banka Kredileri hesabinda izlenmeli.`,
          voucherKey: agg.first.voucherKey,
          rowIndex: agg.first.rowIndex,
          hesapKodu: code,
          detail: { borc: agg.borc, alacak: agg.alacak, net },
        });
      }
    }
    return findings;
  }

  // 108 Kredi Kartlari (POS) - valor tarihi gecmis ama kapanmamis
  private analyzePOSValor108(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    let borc = 0, alacak = 0;
    let first: ParsedEDefterFisLine | null = null;
    for (const r of rows) {
      if (!/^108/.test(r.hesapKodu || '')) continue;
      borc += Number(r.borc || 0);
      alacak += Number(r.alacak || 0);
      if (!first) first = r;
    }
    const net = borc - alacak;
    if (first && net > 5000) {
      return [{
        severity: 'INFO',
        category: 'POS_VALOR_108_BAKIYE',
        message: `108 POS Kredi Kartlari hesabi bakiyesi ${this.fmt(net)} TL. Valor tarihi gecip 102'ye gecmesi gereken kayitlar var mi kontrol edilmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: '108',
      }];
    }
    return [];
  }

  // 689 KKEG hesabi - kullanilan tutar Kurumlar Vergisi beyannamesinde matraha eklenmeli
  private analyzeKKEG689(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    let net = 0;
    let first: ParsedEDefterFisLine | null = null;
    for (const r of rows) {
      if (!/^689/.test(r.hesapKodu || '')) continue;
      net += Number(r.borc || 0) - Number(r.alacak || 0);
      if (!first) first = r;
    }
    if (first && net > 1000) {
      return [{
        severity: 'INFO',
        category: 'KKEG_689_KONTROL',
        message: `689 Diger Olaganustu Gider hesabinda ${this.fmt(net)} TL hareket var. KKEG (kanunen kabul edilmeyen gider) ise Kurumlar Vergisi beyannamesinde matraha eklenmeli.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: '689',
      }];
    }
    return [];
  }

  // Yil sonu amortisman kontrolu (257/268)
  private analyzeAmortismanYilSonu(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null, isYillik: boolean): FindingDraft[] {
    // Amortisman yil sonu islemidir; yalnizca YILLIK defterde kontrol et (Q4/aylik degil).
    if (!isYillik || !range || range.end.getUTCMonth() !== 11) return [];
    const findings: FindingDraft[] = [];
    const hasFixedAsset = rows.some((r) => /^25[2-9]|^260|^264/.test(r.hesapKodu || ''));
    if (!hasFixedAsset) return [];
    const hasAmortisman = rows.some((r) => /^(257|268)/.test(r.hesapKodu || ''));
    const hasGiderAmortisman = rows.some((r) => /^(770|760|730)/.test(r.hesapKodu || '') && /amortisman/i.test(`${r.aciklama || ''} ${r.hesapAdi || ''}`));
    if (!hasAmortisman || !hasGiderAmortisman) {
      const first = rows.find((r) => /^25[2-9]|^260|^264/.test(r.hesapKodu || ''))!;
      findings.push({
        severity: 'WARN',
        category: 'YILSONU_AMORTISMAN_EKSIK',
        message: `Yil sonu donemde sabit kiymet var ama amortisman kaydi (257/268 birikmis veya 770/760/730 gider) eksik gorunuyor. VUK 333 ile amortisman ayrilmali.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: first.hesapKodu,
      });
    }
    return findings;
  }

  // 370 / 371 Donem Kari Vergi Karsiligi - yil sonu hesaplanmis mi
  private analyzeVergiKarsiligi370(rows: ParsedEDefterFisLine[], range: { start: Date; end: Date } | null, isYillik: boolean): FindingDraft[] {
    if (!isYillik || !range || range.end.getUTCMonth() !== 11) return [];
    const findings: FindingDraft[] = [];
    const k690 = rows.filter((r) => /^690/.test(r.hesapKodu || ''));
    if (!k690.length) return [];
    // Yalnizca DONEM KARI varsa (690 alacak > borc) vergi karsiligi beklenir; zararda 370 olmaz.
    const kar690 = k690.reduce((s, r) => s + Number(r.alacak || 0) - Number(r.borc || 0), 0);
    if (kar690 <= 0) return [];
    const has370 = rows.some((r) => /^370/.test(r.hesapKodu || ''));
    const has371 = rows.some((r) => /^371/.test(r.hesapKodu || ''));
    if (!has370 && !has371) {
      const first = rows.find((r) => /^690/.test(r.hesapKodu || ''))!;
      findings.push({
        severity: 'WARN',
        category: 'VERGI_KARSILIGI_370_YOK',
        message: `Yil sonu 690 Donem Kari kullanilmis ancak 370/371 Donem Kari Vergi Karsiligi hesabi kullanilmamis. Kurumlar Vergisi tahakkuku eksik.`,
        voucherKey: first.voucherKey,
        rowIndex: first.rowIndex,
        hesapKodu: '690',
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

  // ════════ FORENSIC / ANOMALI KATMANI ════════
  // Tumu istatistikseldir; tek tek degil ozet bulgu uretir (gurultuyu dusuk tutmak icin).

  private analyzeBenford(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const digits = new Array(10).fill(0);
    let n = 0;
    for (const r of rows) {
      const amt = Math.max(Math.abs(r.borc || 0), Math.abs(r.alacak || 0));
      if (amt < 1) continue;
      const d = Number(Math.floor(amt).toString()[0]);
      if (d >= 1 && d <= 9) { digits[d] += 1; n += 1; }
    }
    if (n < 800) return []; // kucuk/orta defterde Benford kararsizdir; yeterli ornek yok
    let mad = 0;
    const worst = { d: 1, diff: 0, obs: 0, exp: 0 };
    for (let d = 1; d <= 9; d++) {
      const obs = digits[d] / n;
      const exp = Math.log10(1 + 1 / d);
      const diff = Math.abs(obs - exp);
      mad += diff;
      if (diff > worst.diff) { worst.d = d; worst.diff = diff; worst.obs = obs; worst.exp = exp; }
    }
    mad = mad / 9;
    if (mad <= 0.015) return []; // Nigrini: kabul edilebilir/marjinal uyum -> alarm yok
    const severity: FindingDraft['severity'] = mad > 0.02 ? 'WARN' : 'INFO';
    return [{
      severity,
      category: 'BENFORD_SAPMA',
      message: `Benford yasasi 1. basamak sapmasi yuksek (MAD ${mad.toFixed(4)}). En sapan rakam ${worst.d}: beklenen %${(worst.exp * 100).toFixed(1)}, gercek %${(worst.obs * 100).toFixed(1)}. ${n} tutar incelendi - dogal olmayan tutar dagilimi (uydurma/yuvarlanmis kayit) isareti olabilir.`,
      detail: { mad, n, worstDigit: worst.d, observed: worst.obs, expected: worst.exp },
    }];
  }

  private analyzeRoundNumbers(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    let pool = 0;
    let round = 0;
    let big = 0;
    for (const r of rows) {
      // Maas/vergi/SGK (335/360/361) dogal olarak yuvarlaktir; havuzdan cikar.
      if (/^(335|360|361)/.test(r.hesapKodu || '')) continue;
      const amt = Math.max(Math.abs(r.borc || 0), Math.abs(r.alacak || 0));
      if (amt < 1000) continue;
      pool += 1;
      if (Math.abs(amt - Math.round(amt / 1000) * 1000) < 0.005) round += 1;
      if (amt >= 10000 && Math.abs(amt - Math.round(amt / 10000) * 10000) < 0.005) big += 1;
    }
    if (pool < 80) return [];
    const ratio = round / pool;
    if (ratio < 0.40) return [];
    const severity: FindingDraft['severity'] = ratio > 0.55 ? 'WARN' : 'INFO';
    return [{
      severity,
      category: 'YUVARLAK_TUTAR_YIGILMASI',
      message: `1.000 TL ve uzeri ${pool} tutarin %${(ratio * 100).toFixed(0)} kadari (${round} adet) tam yuvarlak (1.000 kati), ${big} adedi 10.000 kati. Yuksek yuvarlak tutar orani tahmini/uydurma kayit gostergesi olabilir; belgeyle teyit edilmeli.`,
      detail: { pool, round, big, ratio },
    }];
  }

  private analyzeWeekendEntries(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const seenAll = new Set<string>();
    const seenWeekend = new Set<string>();
    const weekend: { voucherKey: string; rowIndex: number; date: Date }[] = [];
    for (const r of rows) {
      if (!r.fisTarihi) continue;
      seenAll.add(r.voucherKey);
      const day = r.fisTarihi.getUTCDay(); // 0 Pazar, 6 Cumartesi
      if (day !== 0 && day !== 6) continue;
      if (seenWeekend.has(r.voucherKey)) continue;
      seenWeekend.add(r.voucherKey);
      weekend.push({ voucherKey: r.voucherKey, rowIndex: r.rowIndex, date: r.fisTarihi });
    }
    const toplam = seenAll.size;
    const oran = toplam > 0 ? weekend.length / toplam : 0;
    // Hafta sonu kaydi perakende/lokanta icin normaldir; yalnizca sayisi anlamli (>=5)
    // ve orani yuksekse (>%10) bilgi ver.
    if (weekend.length < 5 || oran < 0.10) return [];
    const ornek = weekend.slice(0, 5).map((w) => this.fmtDate(w.date)).join(', ');
    return [{
      severity: 'INFO',
      category: 'HAFTA_SONU_KAYDI',
      message: `${weekend.length} fis (fislerin %${(oran * 100).toFixed(0)} kadari) hafta sonu (Cumartesi/Pazar) tarihli. Ornek: ${ornek}${weekend.length > 5 ? ' ...' : ''}. Mesai disi kayitlar denetimde gozden gecirilir (BDS 240).`,
      voucherKey: weekend[0].voucherKey,
      rowIndex: weekend[0].rowIndex,
      detail: { count: weekend.length, toplam, oran },
    }];
  }

  private analyzeSuspiciousDescriptions(rows: ParsedEDefterFisLine[]): FindingDraft[] {
    const findings: FindingDraft[] = [];
    const pattern = /(duzelt|iptal|hatal|yanlis|geri al|ters kayit|mahsup hatasi|fazladan|eksik kayit|tekrar kayit|sehven)/;
    const cap = 100;
    let total = 0;
    for (const r of rows) {
      const desc = this.normalizeLoose(r.aciklama);
      if (!desc || !pattern.test(desc)) continue;
      total += 1;
      if (findings.length < cap) {
        findings.push({
          severity: 'INFO',
          category: 'SUPHELI_ACIKLAMA',
          message: `Satir ${r.rowIndex}: aciklamada riskli ifade ("${String(r.aciklama || '').slice(0, 60)}") - duzeltme/iptal kayitlari denetimde onceliklidir.`,
          voucherKey: r.voucherKey,
          rowIndex: r.rowIndex,
          hesapKodu: r.hesapKodu,
        });
      }
    }
    if (total > cap) {
      findings.push({
        severity: 'INFO',
        category: 'SUPHELI_ACIKLAMA',
        message: `Toplam ${total} satirda riskli aciklama bulundu (ilk ${cap} tanesi listelendi).`,
        detail: { total },
      });
    }
    return findings;
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

  private addMonthKey(monthKey: string, count: number) {
    const [year, month] = monthKey.split('-').map(Number);
    return this.monthKey(new Date(Date.UTC(year, month - 1 + count, 1)));
  }

  private describeMonth(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: 'long',
    });
  }

  // monthKey "2026-02" -> normalize edilmis Turkce ay adi "subat" (tahakkuk fisi
  // aciklamasinda ay-bazli eslesme icin). normalizeLoose ile ayni katlama.
  private ayAdiFromMonthKey(monthKey: string): string | null {
    const m = Number(String(monthKey).slice(5, 7));
    const adlar = ['', 'ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
    const ad = adlar[m];
    return ad ? this.normalizeLoose(ad) : null;
  }

  // normalize edilmis metinde Turkce ay adi ara -> 1-12 (yoksa null).
  private ayNoFromText(normalizedText: string): number | null {
    const adlar = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
    for (let i = 0; i < 12; i++) {
      if (normalizedText.includes(adlar[i])) return i + 1;
    }
    return null;
  }

  // TAHAKKUK TARIH DUZELTMESI (2026-06-11): Luca Detay Fis Listesi, KDV tahakkuk
  // fisinde FIS TARIHI (or. 28.02) yerine EVRAK TARIHI (or. 31.03) veriyor -> tarih
  // akisi bozuk gorunuyor (31.03, Subat ile Mart arasinda) + ay yanlis atanir
  // ("Subat tahakkuk bulunamadi" yanlis uyarisi). Aciklamada ay yazili olur
  // ("Subat Ayi KDV Tahakkuk"). Bu fislerde fisTarihi'ni aciklamadaki ayin SON
  // gunune (KDV tahakkukunun gercek fis tarihi = ay sonu) ceker; evrak tarihini korur.
  // Sadece aciklamasinda "kdv" + "tahakkuk" + ay adi gecen, tarihi farkli aydaki fisler.
  private correctTahakkukDates(rows: ParsedEDefterFisLine[]): void {
    const byVoucher = new Map<string, ParsedEDefterFisLine[]>();
    for (const r of rows) {
      const list = byVoucher.get(r.voucherKey);
      if (list) list.push(r);
      else byVoucher.set(r.voucherKey, [r]);
    }
    for (const vrows of byVoucher.values()) {
      const text = this.normalizeLoose(vrows.map((r) => r.aciklama || '').join(' '));
      if (!text.includes('kdv') || !text.includes('tahakkuk')) continue;
      const ay = this.ayNoFromText(text);
      if (!ay) continue;
      const mevcut = vrows.find((r) => r.fisTarihi)?.fisTarihi;
      if (!mevcut) continue;
      const yil = mevcut.getUTCFullYear();
      if (mevcut.getUTCMonth() === ay - 1) continue; // zaten dogru aydaysa dokunma
      const sonGun = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
      const dogruTarih = new Date(Date.UTC(yil, ay - 1, sonGun));
      for (const r of vrows) {
        // Hem fis HEM evrak tarihini gercek fis tarihine (ay sonu = 28.02) hizala.
        // Aksi halde fis=28.02 + evrak=31.03 -> "belge tarihi fis tarihinden sonra"
        // (VUK 219) yanlis uyarisi cikar. Tahakkuk fisinde beyanname evraki dogal
        // olarak takip eden ayda kesilir; bu fislerde evrak/fis ayrimi denetim
        // acisindan anlamli degil -> ikisini de ayin son gunune cekiyoruz.
        r.fisTarihi = new Date(dogruTarih.getTime());
        r.evrakTarihi = new Date(dogruTarih.getTime());
      }
    }
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
