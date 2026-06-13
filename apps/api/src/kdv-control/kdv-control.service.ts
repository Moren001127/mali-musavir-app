import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ExcelParserService } from './excel-parser.service';
import { OcrService } from './ocr';
import { ReconciliationEngine } from './reconciliation';
import { isAggregateLucaRecord } from './luca-row-filter';
import { compareKdvExportRows } from './export/export-row-order';
import { replaceSessionLucaRecordsInDb } from './session/session-record-replacement';
import { LucaService } from '../luca/luca.service';
import { LucaAutoScraperService } from '../luca/luca-auto-scraper.service';
import { AgentEventsService } from '../agent-events/agent-events.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { Optional } from '@nestjs/common';
import { computeCostUsd, logAiUsage } from '../common/ai-usage-logger';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

type ContentAuditRisk = 'UYGUN' | 'KONTROL_ET' | 'RISKLI' | 'ISLENMEMELI';

type ContentAuditDecision = {
  risk: ContentAuditRisk;
  summary: string;
  suggestion: string;
  findings: Array<{ title: string; detail: string; severity?: ContentAuditRisk }>;
  confidence: number;
  model: string;
  costUsd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

type ContentAuditQueueContext = {
  sessionId: string;
  period?: string | null;
  type?: string | null;
  taxpayerId?: string | null;
  mukellef?: string | null;
};

const NACE_ACIKLAMA: Record<string, string> = {
  '0111': 'Tahıl, baklagil, yağlı tohum yetiştiriciliği',
  '0141': 'Süt sığırcılığı',
  '0150': 'Karma tarım',
  '1011': 'Et ve et ürünleri işleme',
  '1071': 'Ekmek, pasta, taze hamur işleri üretimi',
  '1085': 'Hazır yemek üretimi',
  '2219': 'Kauçuk ürünleri imalatı',
  '2222': 'Plastik ambalaj malzemeleri imalatı',
  '2229': 'Plastik ürünler imalatı',
  '2562': 'Genel amaçlı makine imalatı',
  '3317': 'Ulaşım araçları tamiri',
  '4110': 'Bina geliştirme projeleri',
  '4120': 'Konut ve konut dışı bina inşaatı',
  '4211': 'Yol ve otoyol inşaatı',
  '4399': 'Diğer özel inşaat faaliyetleri',
  '4510': 'Motorlu kara taşıtları ticareti',
  '4511': 'Yeni otomobil ve hafif motorlu araç ticareti',
  '4519': 'Diğer motorlu kara taşıtları ticareti',
  '4520': 'Motorlu kara taşıtlarının bakımı ve onarımı',
  '4530': 'Motorlu kara taşıtları parça ve aksesuar ticareti',
  '4540': 'Motosiklet ticareti, bakım ve onarımı',
  '4611': 'Tarımsal ürün aracısı ve acentesi',
  '4621': 'Tahıl, baklagil toptancılığı',
  '4631': 'Meyve ve sebze toptancılığı',
  '4639': 'Diğer gıda toptancılığı',
  '4641': 'Tekstil toptancılığı',
  '4651': 'Bilgisayar ve çevre birimi toptancılığı',
  '4661': 'Tarımsal makine ve ekipman toptancılığı',
  '4669': 'Diğer makine ve ekipman toptancılığı',
  '4671': 'Akaryakıt ve ürünleri toptancılığı',
  '4673': 'Kereste ve yapı malzemeleri toptancılığı',
  '4674': 'Hırdavat, tesisat, ısıtma ekipmanı toptancılığı',
  '4677': 'Hurda ve atık toptancılığı',
  '4711': 'Gıda ağırlıklı perakende satış mağazaları',
  '4719': 'Büyük mağazalar ve hipermarketler',
  '4722': 'Et ve et ürünleri perakende',
  '4730': 'Akaryakıt perakende',
  '4741': 'Bilgisayar ve çevre birimi perakende',
  '4751': 'Tekstil perakende',
  '4761': 'Kitap perakende',
  '4771': 'Giyim perakende',
  '4775': 'Kozmetik, kişisel bakım perakende',
  '4776': 'Çiçek, bitki perakende',
  '4789': 'Pazar tezgahları perakende',
  '4791': 'Posta/internet yoluyla perakende',
  '4799': 'Mağaza dışı diğer perakende',
  '4910': 'Demiryolu ile yolcu taşımacılığı',
  '4920': 'Demiryolu ile yük taşımacılığı',
  '4941': 'Karayolu ile yük taşımacılığı',
  '4942': 'Taşıma nakliye yardımcı hizmetleri',
  '5010': 'Deniz yolu ile yolcu taşımacılığı',
  '5210': 'Depolama ve ambarlama',
  '5221': 'Karayolu taşımacılığı yardımcı hizmetleri',
  '5510': 'Oteller ve konaklama tesisleri',
  '5520': 'Tatil köyleri ve çadır alanları',
  '5610': 'Restoran ve gezici yemek hizmetleri',
  '5621': 'Toplu yemek hizmetleri',
  '5630': 'İçecek hizmetleri (kafe, bar)',
  '5811': 'Kitap yayıncılığı',
  '5820': 'Yazılım yayıncılığı',
  '6110': 'Kablolu telekomunikasyon',
  '6120': 'Kablosuz telekomunikasyon',
  '6201': 'Bilgisayar programlama',
  '6202': 'Bilgisayar danışmanlık hizmetleri',
  '6209': 'Diğer bilgi teknolojisi hizmetleri',
  '6311': 'Veri işleme ve barındırma hizmetleri',
  '6419': 'Diğer para aracılığı (bankacılık) faaliyetleri',
  '6491': 'Finansal kiralama',
  '6499': 'Diğer finansal hizmet faaliyetleri',
  '6512': 'Hayat dışı sigorta',
  '6820': 'Kendi mülkünün kiralanması ve işletilmesi',
  '6831': 'Gayrimenkul acenteleri',
  '6910': 'Hukuk hizmetleri',
  '6920': 'Muhasebe ve denetim hizmetleri',
  '7010': 'İşletme merkezi yönetim faaliyetleri',
  '7021': 'Halkla ilişkiler ve iletişim',
  '7022': 'Yönetim danışmanlığı',
  '7112': 'Mühendislik hizmetleri',
  '7120': 'Teknik test ve analiz',
  '7311': 'Reklam ajansları',
  '7410': 'Özelleşmiş tasarım faaliyetleri',
  '7460': 'Güvenlik ve soruşturma hizmetleri',
  '7490': 'Diğer mesleki, bilimsel ve teknik hizmetler',
  '7711': 'Otomobil ve hafif motorlu araç kiralama',
  '7712': 'Kamyon ve diğer ağır araç kiralama',
  '7810': 'İstihdam aracılık faaliyetleri',
  '7820': 'Geçici istihdam hizmetleri',
  '8010': 'Özel güvenlik hizmetleri',
  '8110': 'Bina ve çevre düzenleme hizmetleri',
  '8130': 'Peyzaj hizmetleri',
  '8211': 'Ofis yönetim hizmetleri',
  '8219': 'Fotokopi, belge hazırlama hizmetleri',
  '8560': 'Özel eğitim faaliyetleri',
  '8621': 'Genel pratisyen tıbbi hizmetleri',
  '8690': 'Diğer sağlık hizmetleri',
  '9311': 'Spor tesisleri işletimi',
  '9312': 'Spor kulüpleri faaliyetleri',
  '9601': 'Çamaşır ve kuru temizleme hizmetleri',
  '9602': 'Kuaförlük ve güzellik salonları',
  '9609': 'Diğer kişisel hizmet faaliyetleri',
};

const OCR_KATEGORI_ETIKET: Record<string, string> = {
  YEDEK_PARCA: 'Yedek Parça',
  AKARYAKIT: 'Akaryakıt',
  GIDA: 'Gıda/Market',
  YEMEK: 'Yemek/Restoran',
  KIRTASIYE: 'Kırtasiye/Ofis Malzemesi',
  ELEKTRONIK: 'Elektronik/Teknoloji',
  TEKSTIL: 'Tekstil/Giyim',
  HIZMET: 'Genel Hizmet',
  INSAAT: 'İnşaat Malzemesi',
  TEMIZLIK: 'Temizlik/Hijyen',
  SEYAHAT: 'Seyahat/Ulaşım',
  KONAKLAMA: 'Otel/Konaklama',
  SAGLIK: 'Sağlık/Eczane',
  REKLAM: 'Reklam/Tanıtım',
  MUHASEBE: 'Muhasebe/Danışmanlık',
  KARGO: 'Kargo/Nakliye',
  TELEFON: 'Telefon/İletişim',
  INTERNET: 'İnternet/Yazılım',
  ELEKTRIK: 'Elektrik/Su/Doğalgaz',
  KIRA: 'Kira',
  SIGORTA: 'Sigorta',
  BANKA: 'Banka/Finans Hizmeti',
  CEZA: 'Ceza/Gecikme Zammı',
  ALKOL_TUTUN: 'Alkol/Tütün',
  DIGER: 'Diğer',
};

@Injectable()
export class KdvControlService {
  private readonly logger = new Logger(KdvControlService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private excelParser: ExcelParserService,
    private ocrService: OcrService,
    private reconciliation: ReconciliationEngine,
    @Inject(forwardRef(() => LucaService))
    private luca: LucaService,
    @Inject(forwardRef(() => LucaAutoScraperService))
    private lucaAutoScraper: LucaAutoScraperService,
    private agentEvents: AgentEventsService,
    private notifications: NotificationsService,
    @Optional() private readonly automationEventBus?: AutomationEventBus,
  ) {}

  /**
   * KDV işlemleri gösterge panelindeki "Canlı Sistem Akışı"na düşsün diye
   * her önemli aşamada AgentEvent oluşturur. Hata patlatmaz — log'a yazıp geçer.
   */
  private async pushFeedEvent(
    tenantId: string,
    args: {
      action: string;
      status: 'basarili' | 'hata' | 'bilgi' | 'atlandi';
      message: string;
      mukellef?: string;
      meta?: any;
    },
  ): Promise<void> {
    try {
      await this.agentEvents.createEvent(tenantId, {
        agent: 'kdv-kontrol',
        action: args.action,
        status: args.status,
        message: args.message,
        mukellef: args.mukellef,
        meta: args.meta,
      });
    } catch (err) {
      this.logger.warn(`Agent event push failed: ${(err as Error).message}`);
    }
  }

  private readonly VALID_TYPES = ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'] as const;
  private readonly ISLETME_TYPES = ['ISLETME_GELIR', 'ISLETME_GIDER'];

  private isLockedSession(session: { status?: string | null }): boolean {
    return session.status === 'COMPLETED';
  }

  private assertSessionUnlocked(session: { status?: string | null }) {
    if (this.isLockedSession(session)) {
      throw new BadRequestException('Bu KDV kontrolü kilitli. Müdahale etmek için önce kilidi açın.');
    }
  }

  private isKdvMatchedStatus(status?: string | null): boolean {
    return status === 'MATCHED' || status === 'CONFIRMED';
  }

  private zeroKurusTolerance(value: number): number {
    return Math.abs(Number(value.toFixed(2))) <= 0.01 ? 0 : value;
  }

  private parseKdvAmount(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value).trim();
    const hasDot = text.includes('.');
    const hasComma = text.includes(',');
    let cleaned: string;
    if (hasDot && hasComma) {
      cleaned = text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
    } else if (hasComma) {
      cleaned = text.replace(',', '.');
    } else if (hasDot) {
      const parts = text.split('.');
      const last = parts[parts.length - 1] || '';
      const looksLikeThousands =
        parts.length > 1 &&
        last.length === 3 &&
        parts.every((part, idx) => idx === 0 ? /^\d{1,3}$/.test(part) : /^\d{3}$/.test(part));
      cleaned = looksLikeThousands ? text.replace(/\./g, '') : text;
    } else {
      cleaned = text;
    }
    const parsed = parseFloat(cleaned.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private inferKdvRecordRate(record: any): number | null {
    if (!record) return null;
    const raw = record.rawData || {};
    const source = [
      record.karsiTaraf,
      record.aciklama,
      raw['HESAP ADI'],
      raw.hesapAdi,
      raw.accountName,
      raw['AÇIKLAMA'],
    ].filter(Boolean).join(' ');
    const match = source.match(/%\s*(\d{1,2}(?:[,.]\d{1,2})?)/);
    if (match) {
      const parsed = this.parseKdvAmount(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (record.kdvOrani != null) {
      const explicit = Number(record.kdvOrani);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
    }
    return null;
  }

  private getExportFaturaKdvValue(
    result: any,
    allResults: any[],
    sessionType?: string | null,
    forDetailRow = false,
  ): number {
    if (!result?.image || !result.imageId) return 0;
    const ocrTotal = this.parseKdvAmount(result.image.confirmedKdvTutari || result.image.ocrKdvTutari);
    if (ocrTotal <= 0) return 0;
    const luca = result.kdvRecord?.kdvTutari ? Number(result.kdvRecord.kdvTutari) : 0;
    const fanOutCount = allResults.filter((x: any) => x.imageId === result.imageId && x.kdvRecordId).length;
    if (forDetailRow && fanOutCount > 1 && this.isKdvMatchedStatus(result.status)) {
      return Number.isFinite(luca) ? luca : 0;
    }
    if (luca <= 0) return ocrTotal;

    const rawBreakdown = result.image.confirmedKdvBreakdown ?? result.image.ocrKdvBreakdown;
    const recordRate = this.inferKdvRecordRate(result.kdvRecord);
    if (Array.isArray(rawBreakdown) && recordRate != null && Number.isFinite(recordRate)) {
      const rateMatch = rawBreakdown.find((item: any) => {
        const itemRate = Number(item?.oran);
        return Number.isFinite(itemRate) && Math.abs(itemRate - recordRate) < 0.5;
      });
      const componentKdv = rateMatch ? this.parseKdvAmount(rateMatch.tutar) : 0;
      if (componentKdv > 0 && Math.abs(componentKdv - luca) / (luca || 1) < 0.01) {
        return componentKdv;
      }
    }

    const isSatis = sessionType === 'KDV_391' || sessionType === 'ISLETME_GELIR';
    const reasonText = Array.isArray(result.mismatchReasons) ? result.mismatchReasons.join(' ') : '';
    if (!isSatis && /Alış tevkifat bileşen eşleşmesi|Alis tevkifat bilesen/i.test(reasonText)) {
      return luca;
    }

    const tevkifat = this.parseKdvAmount(result.image.confirmedKdvTevkifat || result.image.ocrKdvTevkifat);
    const candidates = [
      ocrTotal,
      ...(isSatis && tevkifat > 0 && ocrTotal > tevkifat ? [ocrTotal - tevkifat] : []),
    ].filter((n) => Number.isFinite(n) && n > 0);

    const best = candidates.sort((a, b) => Math.abs(a - luca) - Math.abs(b - luca))[0] ?? ocrTotal;
    const bestDiff = Math.abs(best - luca) / (luca || 1);
    if (bestDiff < 0.01) return best;
    return forDetailRow && this.isKdvMatchedStatus(result.status) ? luca : ocrTotal;
  }

  private getExportFarkValue(result: any, allResults: any[], sessionType?: string | null): number {
    const lucaKdv = result?.kdvRecord?.kdvTutari ? Number(result.kdvRecord.kdvTutari) : null;
    if (lucaKdv == null || !Number.isFinite(lucaKdv)) return 0;
    const faturaKdv = this.getExportFaturaKdvValue(result, allResults, sessionType, true);
    if (faturaKdv <= 0) return 0;
    return this.zeroKurusTolerance(Number((lucaKdv - faturaKdv).toFixed(2)));
  }

  private buildMatchSummary(results: Array<{ status: string; kdvRecord?: any | null; image?: any | null; imageId?: string | null; kdvRecordId?: string | null; mismatchReasons?: string[] }>, sessionType?: string | null) {
    const visibleResults = results.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));
    const statusMap: Record<string, number> = {};
    visibleResults.forEach((r) => (statusMap[r.status] = (statusMap[r.status] ?? 0) + 1));
    const isReviewStatus = (status: string) => status === 'PARTIAL_MATCH' || status === 'NEEDS_REVIEW';
    const isRejectedStatus = (status: string) => status === 'REJECTED' || status === 'MISMATCH';
    const isAmountMismatch = (r: (typeof visibleResults)[number]) =>
      this.isKdvMatchedStatus(r.status) && Math.abs(this.getExportFarkValue(r, visibleResults, sessionType)) > 0.01;
    const partialMatch = statusMap['PARTIAL_MATCH'] ?? 0;
    const needsReview = statusMap['NEEDS_REVIEW'] ?? 0;
    const unmatched = statusMap['UNMATCHED'] ?? 0;
    const rejected = statusMap['REJECTED'] ?? 0;
    const mismatch = statusMap['MISMATCH'] ?? 0;
    const matchedAmountMismatch = visibleResults.filter(isAmountMismatch).length;
    const matchedRaw = (statusMap['MATCHED'] ?? 0) + (statusMap['CONFIRMED'] ?? 0);
    const lucaOnlyMissing = visibleResults.filter((r) => r.status === 'UNMATCHED' && !!r.kdvRecordId && !r.imageId).length;
    const imageOnlyMissing = visibleResults.filter((r) => r.status === 'UNMATCHED' && !!r.imageId && !r.kdvRecordId).length;
    const otherUnmatched = Math.max(0, unmatched - lucaOnlyMissing - imageOnlyMissing);
    const effectiveMatchedRows = visibleResults.filter((r) => this.isKdvMatchedStatus(r.status) && !isAmountMismatch(r));
    const reviewRows = visibleResults.filter((r) => isReviewStatus(r.status) || isAmountMismatch(r));
    const rejectedRows = visibleResults.filter((r) => isRejectedStatus(r.status));
    const uniqueImages = (rows: typeof visibleResults) => {
      const ids = new Set<string>();
      rows.forEach((r) => {
        if (r.imageId) ids.add(r.imageId);
      });
      return ids.size;
    };
    return {
      matched: Math.max(0, matchedRaw - matchedAmountMismatch),
      partialMatch,
      needsReview,
      amountMismatch: matchedAmountMismatch,
      reviewTotal: partialMatch + needsReview + matchedAmountMismatch,
      unmatched,
      lucaOnlyMissing,
      imageOnlyMissing,
      otherUnmatched,
      rejected,
      mismatch,
      issueTotal: partialMatch + needsReview + matchedAmountMismatch + unmatched + rejected + mismatch,
      totalResults: visibleResults.length,
      balance: {
        luca: {
          matched: effectiveMatchedRows.filter((r) => !!r.kdvRecordId).length,
          review: reviewRows.filter((r) => !!r.kdvRecordId).length,
          missingInvoice: lucaOnlyMissing,
          rejected: rejectedRows.filter((r) => !!r.kdvRecordId).length,
        },
        image: {
          matched: uniqueImages(effectiveMatchedRows),
          review: uniqueImages(reviewRows),
          missingLuca: imageOnlyMissing,
          rejected: uniqueImages(rejectedRows),
        },
      },
    };
  }

  /** KDV type → Excel başlığı için okunur isim */
  private kdvTypeLabel(type?: string | null): string {
    switch (type) {
      case 'KDV_191':       return 'Bilanço — Alış (İndirilecek KDV 191)';
      case 'KDV_391':       return 'Bilanço — Satış (Hesaplanan KDV 391)';
      case 'ISLETME_GELIR': return 'İşletme Defteri — Satış / Gelir';
      case 'ISLETME_GIDER': return 'İşletme Defteri — Alış / Gider';
      default:              return type || '—';
    }
  }

  /** Oturum listesi — her session için OCR maliyeti toplamı dahil */
  async findSessions(tenantId: string) {
    const sessions = await this.prisma.kdvControlSession.findMany({
      where: { tenantId },
      include: {
        _count: { select: { kdvRecords: true, images: true, results: true } },
        taxpayer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            taxNumber: true,
            defterTuru: true,
            mihsapDefterTuru: true,
            naceKodu: true,
            notes: true,
          },
        },
        images: {
          // ReceiptImage modelinde createdAt yok, uploadedAt var (schema.prisma:705)
          select: { uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (sessions.length === 0) return [];

    // OCR maliyetlerini session bazında topla; tekrar OCR/seri tarama aynı oturuma eklenir.
    const sessionKeys = sessions.map((s) => `session:${s.id}`);

    const costRows = await (this.prisma as any).aiUsageLog.findMany({
      where: {
        tenantId,
        source: 'kdv-ocr',
        sebep: { in: sessionKeys.length > 0 ? sessionKeys : ['__none__'] },
      },
      select: { sebep: true, costUsd: true },
    });
    const costBySession = new Map<string, number>();
    for (const row of costRows) {
      if (!row.sebep) continue;
      costBySession.set(row.sebep, (costBySession.get(row.sebep) || 0) + Number(row.costUsd || 0));
    }

    const resultRows = await this.prisma.reconciliationResult.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      include: { kdvRecord: true, image: true },
    });
    const resultsBySession = new Map<string, typeof resultRows>();
    for (const row of resultRows) {
      if (!resultsBySession.has(row.sessionId)) resultsBySession.set(row.sessionId, [] as any);
      resultsBySession.get(row.sessionId)!.push(row);
    }

    return sessions.map((s) => {
      const maliyetUsd = costBySession.get(`session:${s.id}`) || 0;
      const matchSummary = this.buildMatchSummary(resultsBySession.get(s.id) ?? [], s.type);

      return {
        ...s,
        maliyetUsd,
        isLocked: this.isLockedSession(s),
        matchSummary,
      };
    });
  }

  /** Oturum detayı */
  async findSession(id: string, tenantId: string) {
    const session = await this.prisma.kdvControlSession.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { kdvRecords: true, images: true } },
        taxpayer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            taxNumber: true,
            defterTuru: true,
            mihsapDefterTuru: true,
            naceKodu: true,
            notes: true,
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Oturum bulunamadı');
    return session;
  }

  /** Oturum sil */
  async deleteSession(id: string, tenantId: string) {
    const session = await this.findSession(id, tenantId);
    this.assertSessionUnlocked(session);
    
    // İlişkili kayıtları sil (cascade delete yerine manuel)
    await this.prisma.reconciliationResult.deleteMany({ where: { sessionId: id } });
    await this.prisma.kdvRecord.deleteMany({ where: { sessionId: id } });
    await this.prisma.receiptImage.deleteMany({ where: { sessionId: id } });
    await this.prisma.kdvControlSession.delete({ where: { id } });
    
    return { deleted: true };
  }

  /**
   * Mükellef + dönem + tip kombinasyonu için var olan seansı bul;
   * yoksa yenisini oluştur. Ana akışta kullanılır (Mihsap deseni gibi
   * tek ekrandan iş yaparken).
   */
  async findOrCreateSession(
    tenantId: string,
    userId: string,
    dto: {
      type: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      periodLabel: string;
      taxpayerId?: string;
      notes?: string;
    },
  ) {
    if (!this.VALID_TYPES.includes(dto.type as any)) {
      throw new BadRequestException(`Geçersiz kontrol türü: ${dto.type}`);
    }
    const existing = await this.prisma.kdvControlSession.findFirst({
      where: {
        tenantId,
        type: dto.type as any,
        periodLabel: dto.periodLabel,
        taxpayerId: dto.taxpayerId || null,
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
        _count: { select: { kdvRecords: true, images: true, results: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { session: existing, created: false };
    const created = await this.createSession(tenantId, userId, dto);
    return { session: created, created: true };
  }

  /** Yeni oturum oluştur */
  async createSession(
    tenantId: string,
    userId: string,
    dto: {
      type: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      periodLabel: string;
      taxpayerId?: string;
      notes?: string;
    },
  ) {
    if (!this.VALID_TYPES.includes(dto.type as any)) {
      throw new BadRequestException(`Geçersiz kontrol türü: ${dto.type}`);
    }

    // taxpayerId varsa tenant'a ait olduğunu doğrula
    if (dto.taxpayerId) {
      const taxpayer = await this.prisma.taxpayer.findFirst({
        where: { id: dto.taxpayerId, tenantId },
      });
      if (!taxpayer) throw new BadRequestException('Mükellef bulunamadı veya yetkisiz erişim');
    }

    const created = await this.prisma.kdvControlSession.create({
      data: {
        tenantId,
        type: dto.type as any,
        periodLabel: dto.periodLabel,
        taxpayerId: dto.taxpayerId || null,
        notes: dto.notes,
        createdBy: userId,
      },
      include: {
        taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
      },
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na düşer
    await this.pushFeedEvent(tenantId, {
      action: 'session-create',
      status: 'bilgi',
      message: `KDV kontrol oturumu açıldı — ${dto.periodLabel} · ${this.kdvTypeLabel(dto.type)}`,
      mukellef: this.formatMukellefAdi(created),
      meta: { sessionId: created.id, period: dto.periodLabel, type: dto.type },
    });

    return created;
  }

  /**
   * Excel'i preview eder — sütun başlıkları + örnek satırlar döner.
   * Kullanıcı mapping modalında hangi sütun hangi alan olduğunu seçecek.
   */
  async previewExcel(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
  ): Promise<{
    sheetName: string;
    sheetNames: string[];
    columns: string[];
    rowCount: number;
    sampleRows: Record<string, any>[];
    suggestedMapping: { tarihCol?: string; belgeNoCol?: string; kdvCol?: string };
  }> {
    await this.findSession(sessionId, tenantId);
    buffer = this.excelParser.normalizeLucaExcelBuffer(buffer, 'KDV column preview');
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException('Excel dosyası okunamadı — boş veya bozuk');
    }
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      defval: null,
    });
    if (rows.length === 0) {
      throw new BadRequestException('Excel\'de veri satırı yok');
    }
    // Sütun başlıklarını ilk satırdan al + normalize et
    const firstRow = rows[0];
    const columns = Object.keys(firstRow).map((k) =>
      k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    // Türkçe karakterleri normalize et — "İ" / "ı" / "Ş" / "ğ" vs. toLowerCase()
    // combining karakterler üretiyor, direkt string karşılaştırması başarısız oluyor.
    const normalizeTr = (s: string) =>
      s
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase()
        .trim();

    // Keyword tabanlı otomatik önermesi
    const normalizedCols = columns.map(normalizeTr);
    const findBy = (patterns: string[]): string | undefined => {
      const normPatterns = patterns.map(normalizeTr);
      // Önce tam eşleşme
      for (const p of normPatterns) {
        const idx = normalizedCols.findIndex((c) => c === p);
        if (idx >= 0) return columns[idx];
      }
      // Sonra içerir
      for (const p of normPatterns) {
        const idx = normalizedCols.findIndex((c) => c.includes(p));
        if (idx >= 0) return columns[idx];
      }
      return undefined;
    };
    const suggestedMapping = {
      tarihCol: findBy(['evrak tarihi', 'belge tarihi', 'fiş tarihi', 'tarih']),
      belgeNoCol: findBy(['evrak no', 'belge no', 'fatura no', 'fiş no', 'belge numarası', 'evrak']),
      kdvCol: findBy(['kdv tutarı', 'hesaplanan kdv', 'indirilecek kdv', 'kdv', 'borç', 'alacak']),
    };
    // İlk 10 satırı örnek olarak döndür
    const sampleRows = rows.slice(0, 10).map((row) => {
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const ck = k.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        clean[ck] = v;
      }
      return clean;
    });
    return {
      sheetName,
      sheetNames: workbook.SheetNames,
      columns,
      rowCount: rows.length,
      sampleRows,
      suggestedMapping,
    };
  }

  /**
   * Kullanıcının belirttiği sütun mapping'i ile Excel import eder.
   * tarihCol / belgeNoCol / kdvCol — her birisi Excel'deki sütun başlığı adı.
   */
  async importExcelWithMapping(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
    mapping: {
      tarihCol: string;
      belgeNoCol: string;
      kdvCol: string;
      sheetName?: string;
    },
  ): Promise<{ imported: number; skipped: number }> {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    buffer = this.excelParser.normalizeLucaExcelBuffer(buffer, 'KDV mapping import');
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = mapping.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new BadRequestException(`Sheet bulunamadı: ${sheetName}`);
    }

    // Sütun başlıklarını normalize edip orijinal key'le eşle.
    // Türkçe karakterleri de ASCII'ye indirgeyerek karşılaştır — aksi halde
    // "İ" / "ı" / "Ş" vs toLowerCase'de combining karakter üretip eşleşmiyor.
    const normalize = (s: string) =>
      s
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase();

    const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });
    const hasAny = (row: any[], patterns: string[]) => {
      const cells = row.map((v) => normalize(String(v ?? '')));
      return patterns.some((p) => cells.some((c) => {
        const wanted = normalize(p);
        if (!c || !wanted) return false;
        return c === wanted || c.includes(wanted) || wanted.includes(c);
      }));
    };
    const isBilancoKdv = session.type === 'KDV_191' || session.type === 'KDV_391';
    const excelStartIdx = isBilancoKdv ? 2 : 0; // Bilanço KDV listesinde ilk 2 Excel satırı okunmaz.
    let headerIdx = matrix.findIndex((row, idx) =>
      idx >= excelStartIdx &&
      hasAny(row, ['tarih', 'tar']) &&
      hasAny(row, ['evrak', 'belge', 'fis', 'fiş', 'madde']) &&
      hasAny(row, ['borc', 'borç', 'alacak', 'kdv']),
    );

    if (headerIdx < 0) {
      headerIdx = matrix.findIndex((row, idx) =>
        idx >= excelStartIdx &&
        hasAny(row, ['tarih', 'tar']) &&
        hasAny(row, ['bor', 'alacak', 'kdv']),
      );
    }

    let rawRows: any[];
    if (headerIdx >= 0) {
      const headers = (matrix[headerIdx] || []).map((v, idx) => {
        const text = String(v ?? '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        return text || `COL_${idx + 1}`;
      });
      rawRows = matrix.slice(headerIdx + 1)
        .map((row) => {
          const out: Record<string, any> = {};
          headers.forEach((h, idx) => { out[h] = row?.[idx] ?? null; });
          return out;
        })
        .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''));
      this.logger.log(`KDV mapping import: header satiri ${headerIdx + 1}, kolonlar=${headers.slice(0, 12).join(' | ')}`);
    } else {
      rawRows = XLSX.utils.sheet_to_json(sheet, {
        raw: false,
        defval: null,
        range: excelStartIdx,
      });
      this.logger.warn(`KDV mapping import: header satiri bulunamadi, varsayilan sheet_to_json kullanildi. Ilk kolonlar=${Object.keys(rawRows[0] || {}).slice(0, 12).join(' | ')}`);
    }

    const targetAliases = (target: string): string[] => {
      const t = normalize(target);
      if (t.includes('tarih')) return [target, 'evrak tarihi', 'belge tarihi', 'fis tarihi', 'fiş tarihi', 'tarih'];
      if (t.includes('evrak') || t.includes('belge')) return [target, 'evrak no', 'belge no', 'fis no', 'fiş no', 'fatura no', 'madde no'];
      if (t.includes('alacak')) return [target, 'alacak', 'alacak tutari', 'alacak tutarı'];
      if (t.includes('borc') || t.includes('borç')) return [target, 'borc', 'borç', 'borc tutari', 'borç tutarı'];
      return [target];
    };

    const findKeyInRow = (row: Record<string, any>, target: string): string | null => {
      const keys = Object.keys(row);
      const aliases = targetAliases(target).map(normalize);
      const wantsDate = aliases.some((a) => a.includes('tarih'));
      const wantsBelgeNo = aliases.some((a) => a.includes('evrak') || a.includes('belge') || a.includes('fis'));
      const wantsBorc = aliases.some((a) => a.includes('borc'));
      const wantsAlacak = aliases.some((a) => a.includes('alacak'));
      for (const wanted of aliases) {
        for (const k of keys) {
          if (normalize(k) === wanted) return k;
        }
      }
      for (const wanted of aliases) {
        for (const k of keys) {
          const nk = normalize(k);
          if (nk.includes(wanted) || wanted.includes(nk)) return k;
        }
      }
      for (const k of keys) {
        const nk = normalize(k);
        if (wantsDate && nk.includes('tar')) return k;
        if (wantsBelgeNo && (nk.includes('evrak') || nk.includes('belge') || nk.includes('fis') || nk.includes('madde'))) return k;
        if (wantsBorc && nk.includes('bor')) return k;
        if (wantsAlacak && nk.includes('alacak')) return k;
      }
      return null;
    };
    const effectiveKdvCol =
      session.type === 'KDV_191' ? 'BORÇ' :
      session.type === 'KDV_391' ? 'ALACAK' :
      mapping.kdvCol;
    if (isBilancoKdv) {
      this.logger.log(
        `KDV mapping import: ${session.type} icin ilk 2 veri satiri atlanacak, KDV kolonu="${effectiveKdvCol}"`,
      );
    }

    // Mevcut kayıtları temizle
    const parsed: Array<{
      rowIndex: number;
      belgeNo: string | null;
      belgeDate: Date | null;
      kdvTutari: number;
      kdvOrani: number | null;
      karsiTaraf: string | null;
      hesapKodu: string | null;
      rawData: any;
    }> = [];
    let skipped = 0;

    // AÇIKLAMA / HESAP ADI / KARŞI FİRMA sütununu otomatik tespit et.
    // Kullanıcı mapping'de sadece 3 sütun seçer; açıklama opsiyoneldir.
    const normalizeForFind = (s: string) =>
      s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .toLowerCase();
    const aciklamaKeywords = ['aciklama', 'açıklama', 'hesap adi', 'hesap adı', 'karsi taraf', 'karşı taraf', 'cari adi', 'cari adı', 'firma', 'musteri', 'müşteri'];
    const hesapKoduKeywords = ['hesap kodu'];
    const firstRowKeys = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
    const findAutoCol = (keywords: string[]): string | null => {
      const norms = keywords.map(normalizeForFind);
      for (const k of firstRowKeys) {
        const n = normalizeForFind(k);
        if (norms.some((kw) => n === kw || n.includes(kw))) return k;
      }
      return null;
    };
    const normalizeColumnLabel = (value: string) =>
      String(value ?? '')
        .replace(/\uFFFD/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0130/g, 'I').replace(/\u0131/g, 'i')
        .replace(/\u011E/g, 'G').replace(/\u011F/g, 'g')
        .replace(/\u015E/g, 'S').replace(/\u015F/g, 's')
        .replace(/\u00C7/g, 'C').replace(/\u00E7/g, 'c')
        .replace(/\u00D6/g, 'O').replace(/\u00F6/g, 'o')
        .replace(/\u00DC/g, 'U').replace(/\u00FC/g, 'u')
        .replace(/Ä°/g, 'I').replace(/Ä±/g, 'i')
        .replace(/Ä/g, 'G').replace(/ÄŸ/g, 'g')
        .replace(/Å/g, 'S').replace(/ÅŸ/g, 's')
        .replace(/Ã‡/g, 'C').replace(/Ã§/g, 'c')
        .replace(/Ã–/g, 'O').replace(/Ã¶/g, 'o')
        .replace(/Ãœ/g, 'U').replace(/Ã¼/g, 'u')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    const aciklamaExactCol = firstRowKeys.find((k) => {
      const n = normalizeColumnLabel(k);
      return n === 'ACIKLAMA' || n === 'AIKLAMA' || n.includes('ACIKLAMA');
    }) || null;
    const aciklamaCol = aciklamaExactCol || findAutoCol(aciklamaKeywords);
    const hesapAdiCol = findAutoCol(['hesap adi', 'hesap adÄ±', 'hesap ad']);
    const hesapKoduCol = findAutoCol(hesapKoduKeywords);
    if (aciklamaCol) {
      this.logger.log(`Luca import: AÇIKLAMA sütunu otomatik tespit: "${aciklamaCol}"`);
    }

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const tarihKey = findKeyInRow(row, mapping.tarihCol);
      const belgeKey = findKeyInRow(row, mapping.belgeNoCol);
      const kdvKey = findKeyInRow(row, effectiveKdvCol);

      const rawKdv = kdvKey ? row[kdvKey] : null;
      const kdvTutari = this.excelParser.toDecimal(rawKdv);
      if (kdvTutari === null || kdvTutari === 0) {
        skipped++;
        continue;
      }

      // Opsiyonel alanlar
      const aciklamaRaw = aciklamaCol && row[aciklamaCol] ? String(row[aciklamaCol]).trim() : null;
      const hesapAdiRaw = hesapAdiCol && row[hesapAdiCol] ? String(row[hesapAdiCol]).trim() : null;
      const hesapKoduRaw = hesapKoduCol && row[hesapKoduCol] ? String(row[hesapKoduCol]).trim() : null;
      const kdvOrani =
        this.excelParser.extractKdvOraniFromText(`${hesapAdiRaw ?? ''} ${aciklamaRaw ?? ''}`) ??
        (hesapKoduRaw ? this.excelParser.extractKdvOraniFromHesapKodu(hesapKoduRaw) : null);
      const rawBelgeNo = belgeKey ? row[belgeKey] : null;
      const rowTextForBelgeNo = Object.values(row)
        .map((v) => String(v ?? ''))
        .join(' ');
      const belgeNo = this.excelParser.extractBelgeNoFromDescription(aciklamaRaw)
        || this.excelParser.extractBelgeNoFromDescription(rowTextForBelgeNo)
        || (rawBelgeNo ? String(rawBelgeNo).trim() : null);

      const rawDate = tarihKey ? row[tarihKey] : null;
      const belgeDate = this.excelParser.parseDate(rawDate, this.kdvDateParseOptions(session.periodLabel));

      const rowText = Object.values(row)
        .map((v) => String(v ?? ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .toLocaleUpperCase('tr-TR')
        .trim();
      const isLucaSummaryRow =
        /NAKL[İI]\s*YEK[ÜU]N|NAKLI\s*YEKUN|^TOPLAM[:\s]| TOPLAM[:\s]|GENEL\s+TOPLAM/.test(rowText) ||
        (!belgeDate && (!belgeNo || !/[A-Z0-9]{4,}/i.test(belgeNo)));
      if (isLucaSummaryRow) {
        skipped++;
        continue;
      }

      parsed.push({
        rowIndex: i + 2, // +2: header + 1-based
        belgeNo,
        belgeDate,
        kdvTutari,
        kdvOrani,
        karsiTaraf: aciklamaRaw,
        hesapKodu: hesapKoduRaw,
        rawData: row,
      });
    }

    if (parsed.length === 0) {
      if (isBilancoKdv && headerIdx < 0) {
        await this.replaceSessionLucaRecords(sessionId, []);
        await this.prisma.kdvControlSession.update({
          where: { id: sessionId },
          data: { status: 'PROCESSING' },
        });
        await this.pushFeedEvent(tenantId, {
          action: 'luca-import',
          status: 'bilgi',
          message: `Luca Excel yÃ¼klendi â€” geÃ§erli ${this.kdvTypeLabel(session.type)} satÄ±rÄ± bulunamadÄ±`,
          mukellef: this.formatMukellefAdi(session),
          meta: { sessionId, imported: 0, skipped, emptyLucaReport: true },
        });
        return { imported: 0, skipped };
      }
      const debugKeys = Object.keys(rawRows[0] || {}).slice(0, 16).join(' | ') || '(kolon yok)';
      const debugRows = rawRows.slice(0, 4).map((row) =>
        Object.entries(row)
          .slice(0, 8)
          .map(([k, v]) => `${String(k).slice(0, 18)}=${String(v ?? '').slice(0, 24)}`)
          .join(', '),
      ).join(' || ');
      throw new BadRequestException(
        `Seçilen sütunlardan hiç geçerli KDV satırı okunamadı. Kolonlar: ${debugKeys}. İlk satırlar: ${debugRows || '(yok)'}`,
      );
    }

    await this.replaceSessionLucaRecords(
      sessionId,
      parsed.map((r) => ({
        sessionId,
        rowIndex: r.rowIndex,
        belgeNo: r.belgeNo,
        belgeDate: r.belgeDate,
        karsiTaraf: r.karsiTaraf,
        kdvMatrahi: null,
        kdvTutari: r.kdvTutari,
        kdvOrani: r.kdvOrani,
        aciklama: r.hesapKodu,
        rawData: r.rawData,
      })),
    );

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na düşer
    await this.pushFeedEvent(tenantId, {
      action: 'luca-import',
      status: 'basarili',
      message: `Luca Excel yüklendi — ${parsed.length} satır${skipped > 0 ? ` (${skipped} atlandı)` : ''}`,
      mukellef: this.formatMukellefAdi(session),
      meta: { sessionId, imported: parsed.length, skipped },
    });

    return { imported: parsed.length, skipped };
  }

  /**
   * Excel dosyasını yükle ve parse et.
   * Multipart/form-data yerine buffer + meta alır.
   */
  async uploadExcel(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
  ) {
    const existingSession = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(existingSession);

    // Mevcut kayıtları temizle
    // Session type'a göre doğru parser'ı seç
    const session = await this.prisma.kdvControlSession.findUnique({ where: { id: sessionId } });
    let rows = this.ISLETME_TYPES.includes(session!.type)
      ? this.excelParser.parseIsletmeExcel(buffer, session!.type as 'ISLETME_GELIR' | 'ISLETME_GIDER')
      : this.excelParser.parseKdvExcel(
          buffer,
          session!.type === 'KDV_191' ? '191' : '391',
          this.kdvDateParseOptions(session!.periodLabel),
        );

    // ── İŞLETME: dönem (ay) tarih filtresi ──
    // Luca formunda tarih kutusu tutmadığı için Excel tüm dönemi getirebiliyor.
    // session.periodLabel "2026/03" → 2026-03-01..2026-03-31 aralığı.
    if (this.ISLETME_TYPES.includes(session!.type) && session!.periodLabel) {
      const dash = this.toDashDonem(session!.periodLabel); // "2026-03"
      const m = dash.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        const year = +m[1];
        const month = +m[2]; // 1-12
        const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const end = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // ay sonu
        const before = rows.length;
        const monthFiltered = rows.filter((r) => {
          if (!r.belgeDate) return false;
          const t = r.belgeDate.getTime();
          return t >= start.getTime() && t <= end.getTime();
        });

        // Ay bazında 0 satır çıkarsa YIL bazında dene (tüm yılı al, kullanıcı manuel filtreler)
        if (monthFiltered.length === 0 && before > 0) {
          const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
          const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
          const yearFiltered = rows.filter((r) => {
            if (!r.belgeDate) return false;
            const t = r.belgeDate.getTime();
            return t >= yearStart.getTime() && t <= yearEnd.getTime();
          });
          if (yearFiltered.length > 0) {
            this.logger.warn(
              `İşletme dönem filtresi (${dash}): ay bazında 0 satır → YIL bazında genişletildi (${year}): ${before} → ${yearFiltered.length}`,
            );
            rows = yearFiltered;
          } else {
            // Yıl bazında da 0 → tüm satırları geçir, kullanıcı manuel kontrol etsin
            this.logger.warn(
              `İşletme dönem filtresi: yıl bazında bile 0 satır, FİLTRE KAPATILDI (${before} satır geçirildi)`,
            );
          }
        } else {
          rows = monthFiltered;
          this.logger.log(
            `İşletme dönem filtresi (${dash}): ${before} → ${rows.length} satır (dönem dışı ${before - rows.length} elendi)`,
          );
        }
      }
    }

    if (rows.length === 0) {
      // İŞLETME tiplerinde 0 satır = "o dönemde işlem yok" demek olabilir, hata fırlatma
      if (this.ISLETME_TYPES.includes(session!.type)) {
        await this.replaceSessionLucaRecords(sessionId, []);
        this.logger.warn(
          `İşletme ${session!.type} 0 satır — session boş bırakılıyor (dönem ${session!.periodLabel}). ` +
            `Sebepleri: (1) o dönemde işlem yok, (2) Excel'de yanlış bölüm, (3) tarih dışı.`,
        );
        // Session'ı PROCESSING durumda bırakacak — Mihsap eşleştirme aşamasına geçilebilsin
        await this.prisma.kdvControlSession.update({
          where: { id: sessionId },
          data: { status: 'PROCESSING' },
        });
        return { parsed: 0 };
      }
      throw new BadRequestException(
        'Excel dosyasında KDV satırı bulunamadı. Sütun isimlerini kontrol edin.',
      );
    }

    try {
      await this.replaceSessionLucaRecords(
        sessionId,
        rows.map((r) => ({
          sessionId,
          rowIndex:   r.rowIndex,
          belgeNo:    r.belgeNo,
          belgeDate:  r.belgeDate,
          karsiTaraf: r.karsiTaraf,
          kdvMatrahi: r.kdvMatrahi,
          kdvTutari:  r.kdvTutari,
          kdvOrani:   r.kdvOrani,
          aciklama:   r.aciklama,
          rawData:    r.rawData,
        })),
      );
    } catch (err: any) {
      this.logger.error(
        `createMany hatası: ${err?.message} | İlk satır: ${JSON.stringify(rows[0]?.rawData ?? {})}`,
      );
      throw new InternalServerErrorException(
        'Kayıt oluşturma hatası: ' + (err?.message ?? 'Bilinmeyen hata'),
      );
    }

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { parsed: rows.length };
  }

  /** KDV kayıtları listesi */
  private async replaceSessionLucaRecords(sessionId: string, rows: any[]) {
    await replaceSessionLucaRecordsInDb(this.prisma, sessionId, rows);
  }

  async getKdvRecords(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    const records = await this.prisma.kdvRecord.findMany({
      where: { sessionId },
      include: { results: true },
      orderBy: { rowIndex: 'asc' },
    });
    // Backward-compat: UI "result" tekil bekliyordu, results[0] map et
    return records
      .filter((r) => !isAggregateLucaRecord(r))
      .map((r) => ({
        ...r,
        result: r.results[0] ?? null,
      }));
  }

  /**
   * Görsel yükleme — presigned URL al
   */
  async initiateImageUpload(
    sessionId: string,
    tenantId: string,
    dto: { originalName: string; mimeType: string },
  ) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    const ext = dto.originalName.split('.').pop() || 'jpg';
    const s3Key = `kdv-control/${tenantId}/${sessionId}/${randomUUID()}.${ext}`;

    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    // StorageService'in S3 client'ını kullan
    const uploadUrl = await (this.storage as any).getPresignedUploadUrl(
      tenantId,
      sessionId,
      dto.originalName,
      dto.mimeType,
    );

    return { ...uploadUrl, s3Key: uploadUrl.s3Key };
  }

  /**
   * Doğrudan buffer yükleme (presigned URL gerektirmez).
   * Controller'daki multipart upload endpoint'i bunu kullanır.
   */
  async uploadImageBuffer(
    sessionId: string,
    tenantId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    const ext = originalName.split('.').pop() || 'jpg';
    const s3Key = `kdv-control/${tenantId}/${sessionId}/${randomUUID()}.${ext}`;

    // S3 yüklemesini dene — hata olsa bile DB kaydı ve OCR devam eder
    try {
      await this.storage.putBuffer(s3Key, buffer, mimeType, {
        'original-name': encodeURIComponent(originalName),
        'session-id': sessionId,
      });
    } catch (storageErr) {
      this.logger.warn(`S3 yükleme başarısız (OCR devam ediyor): ${storageErr?.message}`);
    }

    const image = await this.prisma.receiptImage.create({
      data: {
        sessionId,
        s3Key,
        originalName,
        mimeType,
        sizeBytes: buffer.length,
        ocrStatus: 'PENDING',
      },
    });

    // OCR'u bellekteki buffer'dan çalıştır — dosya adını da geçir (belgeNo çıkarımı için)
    this.runOcrForBuffer(image.id, buffer, originalName).catch((e) =>
      this.logger.error(`OCR arka plan hatası [${image.id}]: ${e?.message}`),
    );
    return image;
  }

  /**
   * Görsel onaylama — S3'e yüklendikten sonra DB'ye kaydet + OCR başlat
   */
  async confirmImageUpload(
    sessionId: string,
    tenantId: string,
    dto: { s3Key: string; originalName: string; mimeType: string },
  ) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    const meta = await this.storage.getObjectMeta(dto.s3Key);
    if (!meta) throw new BadRequestException('Görsel S3\'e henüz yüklenmemiş');

    const image = await this.prisma.receiptImage.create({
      data: {
        sessionId,
        s3Key: dto.s3Key,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: meta.sizeBytes,
        ocrStatus: 'PENDING',
      },
    });

    // OCR'yi asenkron başlat (fire & forget)
    this.runOcrForImage(image.id, dto.s3Key).catch(() => {});

    return image;
  }

  /**
   * OCR maliyetini ai_usage_logs'a yaz — Tüm Ajanlar sayacına düşsün.
   * Image'in session'ı üzerinden tenantId + mukellef bilgisini çeker.
   */
  private async logOcrUsage(imageId: string, ocrResult: any, durationMs?: number) {
    try {
      const img = await this.prisma.receiptImage.findUnique({
        where: { id: imageId },
        select: {
          sessionId: true,
          session: {
            select: {
              tenantId: true,
              taxpayerId: true,
              taxpayer: {
                select: { firstName: true, lastName: true, companyName: true },
              },
            },
          },
        },
      });
      if (!img?.session?.tenantId) return;
      const tp = img.session.taxpayer;
      const mukellef = tp
        ? tp.companyName ||
          [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() ||
          null
        : null;

      await logAiUsage(this.prisma, {
        tenantId: img.session.tenantId,
        source: 'kdv-ocr',
        model: ocrResult.engine || 'claude-haiku-4-5-20251001',
        taxpayerId: img.session.taxpayerId || null,
        mukellef,
        belgeNo: ocrResult.belgeNo || null,
        karar: ocrResult.belgeNo && ocrResult.kdvTutari ? 'ok' : 'emin_degil',
        sebep: `session:${img.sessionId}`,
        durationMs,
        cacheHit: /\bcache\b/i.test(ocrResult.engine || ''),
        usage: {
          input_tokens: ocrResult.usage?.inputTokens || 0,
          output_tokens: ocrResult.usage?.outputTokens || 0,
          cache_read_input_tokens: ocrResult.usage?.cacheReadTokens || 0,
          cache_creation_input_tokens: ocrResult.usage?.cacheCreationTokens || 0,
        },
      });
    } catch {
      // log hatası ana akışı bozmasın
    }
  }

  private async saveOcrResult(imageId: string, ocrResult: any, imageHash?: string) {
    const review = this.ocrService.needsReview(ocrResult);
    const status = review.needs
      ? review.reason === 'empty'
        ? 'LOW_CONFIDENCE'
        : 'NEEDS_REVIEW'
      : 'SUCCESS';

    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: status,
        ocrBelgeNo: ocrResult.belgeNo,
        ocrDate: ocrResult.date,
        ocrKdvTutari: ocrResult.kdvTutari,
        ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
        ocrSatici: ocrResult.satici ?? null,
        ocrSaticiVkn: ocrResult.saticiVkn ?? null,
        ocrRawText: ocrResult.rawText?.substring(0, 2000),
        ocrConfidence: ocrResult.confidence,
        ocrBelgeNoConfidence: ocrResult.fieldConfidence?.belgeNo ?? null,
        ocrDateConfidence: ocrResult.fieldConfidence?.date ?? null,
        ocrKdvConfidence: ocrResult.fieldConfidence?.kdvTutari ?? null,
        ocrEngine: ocrResult.engine,
        ocrBelgeTipi: ocrResult.belgeTipi ?? null,
        ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
        ocrValidationScore: ocrResult.validationScore ?? null,
        ocrKategori: ocrResult.kategori ?? null,
        ...(imageHash ? { imageHash } : {}),
      },
    });

    return status;
  }

  private async tryApplyHashCache(imageId: string, imageHash: string, durationMs?: number) {
    const current = await this.prisma.receiptImage.findUnique({
      where: { id: imageId },
      select: {
        sessionId: true,
        originalName: true,
        session: {
          select: {
            tenantId: true,
            taxpayerId: true,
            taxpayer: { select: { firstName: true, lastName: true, companyName: true } },
          },
        },
      },
    });
    const tenantId = current?.session?.tenantId;
    if (!tenantId) return false;

    const cached = await this.prisma.receiptImage.findFirst({
      where: {
        imageHash,
        id: { not: imageId },
        session: { tenantId },
        ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] as any },
        OR: [
          { ocrBelgeNo: { not: null } },
          { ocrDate: { not: null } },
          { ocrKdvTutari: { not: null } },
        ],
      },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!cached) return false;

    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: cached.ocrStatus,
        ocrBelgeNo: cached.ocrBelgeNo,
        ocrDate: cached.ocrDate,
        ocrKdvTutari: cached.ocrKdvTutari,
        ocrKdvTevkifat: cached.ocrKdvTevkifat,
        ocrSatici: cached.ocrSatici,
        ocrSaticiVkn: cached.ocrSaticiVkn,
        ocrRawText: cached.ocrRawText,
        ocrConfidence: cached.ocrConfidence,
        ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
        ocrDateConfidence: cached.ocrDateConfidence,
        ocrKdvConfidence: cached.ocrKdvConfidence,
        ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
        ocrBelgeTipi: cached.ocrBelgeTipi,
        ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
        ocrValidationScore: cached.ocrValidationScore,
        ocrKategori: cached.ocrKategori,
        imageHash,
      } as any,
    });

    const tp = current.session?.taxpayer;
    const mukellef = tp
      ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
      : null;
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'kdv-ocr',
      model: cached.ocrEngine || 'cache',
      taxpayerId: current.session?.taxpayerId || null,
      mukellef,
      belgeNo: cached.ocrBelgeNo || null,
      karar: 'cache_hit',
      sebep: `session:${current.sessionId || ''}`,
      durationMs,
      cacheHit: true,
      usage: { input_tokens: 0, output_tokens: 0 },
    }).catch(() => {});
    this.logger.log(`OCR hash cache HIT: ${current.originalName || imageId} · sağlayıcı çağrısı atlandı`);
    return true;
  }

  /** OCR işlemi — buffer doğrudan (S3'e gerek yok) */
  private async runOcrForBuffer(imageId: string, buffer: Buffer, originalName?: string) {
    const t0 = Date.now();
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      const imageHash = this.ocrService.computeImageHash(buffer);
      if (await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;

      const ocrResult = await this.ocrService.extractFromImage(buffer, originalName);
      await this.saveOcrResult(imageId, ocrResult, imageHash);

      // AI maliyet log'u — Tüm Ajanlar sayacına düşsün
      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);
    } catch (err) {
      this.logger.error(`runOcrForBuffer [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** OCR işlemi — S3'ten indirerek (presigned upload sonrası kullanılır) */
  private async runOcrForImage(imageId: string, s3Key: string, opts: { forceClaude?: boolean; forceFresh?: boolean } = {}) {
    const t0 = Date.now();
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      // Original name'i DB'den çek ki filename fallback çalışsın
      const imgRec = await this.prisma.receiptImage.findUnique({
        where: { id: imageId },
        select: {
          originalName: true,
          sessionId: true,
          session: {
            select: {
              tenantId: true,
              taxpayerId: true,
              taxpayer: { select: { firstName: true, lastName: true, companyName: true } },
            },
          },
        },
      });

      // S3'ten görseli indir
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = (this.storage as any).s3;
      const bucket = this.storage.getBucket();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as any) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      // Hash cache: manuel/S3 yüklenen aynı görsel daha önce işlendiyse
      // OCR sağlayıcısına tekrar gitme. Mihsap dışı upload'larda asıl maliyet düşüren
      // katman burasıdır.
      const imageHash = this.ocrService.computeImageHash(buffer);
      if (!opts.forceFresh && !opts.forceClaude && await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;
      const cached = opts.forceFresh || opts.forceClaude ? null : await this.prisma.receiptImage.findFirst({
        where: {
          imageHash,
          id: { not: imageId },
          session: { tenantId: imgRec?.session?.tenantId },
          ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] as any },
          OR: [
            { ocrBelgeNo: { not: null } },
            { ocrDate: { not: null } },
            { ocrKdvTutari: { not: null } },
          ],
        },
        orderBy: { uploadedAt: 'desc' },
      });

      if (cached) {
        await this.prisma.receiptImage.update({
          where: { id: imageId },
          data: {
            ocrStatus: cached.ocrStatus,
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrSaticiVkn: cached.ocrSaticiVkn,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash,
          } as any,
        });

        const tp = imgRec?.session?.taxpayer;
        const mukellef = tp
          ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
          : null;
        try {
          await logAiUsage(this.prisma, {
            tenantId: imgRec?.session?.tenantId || 'unknown',
            source: 'kdv-ocr',
            model: cached.ocrEngine || 'cache',
            taxpayerId: imgRec?.session?.taxpayerId || null,
            mukellef,
            belgeNo: cached.ocrBelgeNo || null,
            karar: 'cache_hit',
            sebep: `session:${imgRec?.sessionId || ''}`,
            durationMs: Date.now() - t0,
            cacheHit: true,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        } catch {}
        this.logger.log(`OCR hash cache HIT: ${imgRec?.originalName || imageId} · sağlayıcı çağrısı atlandı`);
        return;
      }

      const ocrResult = await this.ocrService.extractFromImage(buffer, imgRec?.originalName, {
        forceClaude: opts.forceClaude === true,
      });
      const review = this.ocrService.needsReview(ocrResult);
      const status = review.needs
        ? review.reason === 'empty'
          ? 'LOW_CONFIDENCE'
          : 'NEEDS_REVIEW'
        : 'SUCCESS';

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: status,
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
          ocrSatici: ocrResult.satici ?? null,
          ocrSaticiVkn: ocrResult.saticiVkn ?? null,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
          ocrBelgeTipi: ocrResult.belgeTipi ?? null,
          ocrKdvBreakdown: (ocrResult.kdvBreakdown as any) ?? null,
          ocrValidationScore: ocrResult.validationScore ?? null,
          ocrKategori: ocrResult.kategori ?? null,
          imageHash,
        },
      });

      // AI maliyet log'u — Tüm Ajanlar sayacına düşsün
      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);
    } catch {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /** Görseller listesi */
  async getImages(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    const images = await this.prisma.receiptImage.findMany({
      where: { sessionId },
      include: { results: true },
      orderBy: { uploadedAt: 'asc' },
    });
    // Backward-compat: UI "result" tekil bekliyordu, results[0] map et
    return images.map((i) => ({
      ...i,
      result: i.results[0] ?? null,
    }));
  }

  /** Görsel indirme URL'i
   *  — `mihsap://<invoiceId>` deseninde s3Key ise, Faturalar sayfasındaki
   *  "Aç" butonunun kullandığı Mihsap CDN link'i döndürülür (auth'suz açılır).
   *  — Değilse klasik S3 presigned URL.
   */
  async getImageDownloadUrl(imageId: string, tenantId: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      include: { session: true },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    this.assertSessionUnlocked(image.session);

    // Mihsap kaynaklı görsel → CDN link
    if (image.s3Key?.startsWith('mihsap://')) {
      const invoiceId = image.s3Key.slice('mihsap://'.length);
      const inv = await (this.prisma as any).mihsapInvoice.findUnique({
        where: { id: invoiceId },
      });
      if (!inv || inv.tenantId !== tenantId) {
        throw new NotFoundException('Mihsap faturası bulunamadı');
      }
      if (!inv.mihsapFileLink) {
        throw new BadRequestException('Mihsap CDN link boş — fatura henüz çekilmemiş');
      }
      return { url: inv.mihsapFileLink as string };
    }

    const url = await this.storage.getPresignedDownloadUrl(
      image.s3Key,
      image.originalName,
    );
    return { url };
  }

  /** Kullanıcı OCR değerlerini düzeltir / teyit eder */
  async confirmImageOcr(
    imageId: string,
    tenantId: string,
    dto: {
      belgeNo?: string;
      date?: string;
      kdvTutari?: string;
      kdvTevkifat?: string | null;
      kdvBreakdown?: Array<{ oran: number; tutar: number; matrah?: number | null }> | null;
    },
  ) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      include: { session: true },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    this.assertSessionUnlocked(image.session);

    // KDV breakdown verilmişse kaydet; verilmezse OCR'dakini koru (override yok)
    const breakdownToSave =
      dto.kdvBreakdown !== undefined
        ? ((dto.kdvBreakdown as any) ?? null)
        : undefined;

    return this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        confirmedBelgeNo: dto.belgeNo ?? image.ocrBelgeNo,
        confirmedDate: dto.date ?? image.ocrDate,
        confirmedKdvTutari: dto.kdvTutari ?? image.ocrKdvTutari,
        // Tevkifat: dto'da yoksa OCR'dakini koru, "" geldiyse temizle
        confirmedKdvTevkifat:
          dto.kdvTevkifat !== undefined
            ? dto.kdvTevkifat || null
            : image.ocrKdvTevkifat,
        ...(breakdownToSave !== undefined ? { confirmedKdvBreakdown: breakdownToSave } : {}),
        isManuallyConfirmed: true,
        ocrStatus: 'SUCCESS',
      },
    });
  }

  /**
   * Tek bir fatura görselinin OCR'ını sıfırlayıp yeniden çalıştırır.
   * Frontend'deki "her fatura satırının yanında ⟳ OCR Yap" butonu için.
   *
   * Cache atlanır (force-fresh) — kullanıcı bu butona zaten "yeniden oku"
   * niyetiyle basıyor, eski sonucu kopyalamak işe yaramaz. Manuel teyit
   * (isManuallyConfirmed) sıfırlanır ki yeni OCR sonucu yazılabilsin.
   */
  async startContentAuditForSession(
    sessionId: string,
    tenantId: string,
    userId?: string,
    opts: { force?: boolean } = {},
  ) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);

    const images = await this.prisma.receiptImage.findMany({
      where: {
        sessionId,
        ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW', 'LOW_CONFIDENCE'] as any },
      },
      select: { id: true, contentAuditStatus: true },
      orderBy: { uploadedAt: 'asc' },
    });
    const queue = images.filter((img: any) => opts.force || img.contentAuditStatus !== 'DONE');

    if (queue.length === 0) {
      return {
        queued: 0,
        total: images.length,
        skipped: images.length,
        message: images.length === 0
          ? 'İçerik denetimi için önce OCR okuması tamamlanmalı'
          : 'İçerik denetimi yapılacak yeni belge yok',
      };
    }

    const ids = queue.map((img) => img.id);
    await this.prisma.receiptImage.updateMany({
      where: { sessionId, id: { in: ids } },
      data: {
        contentAuditStatus: 'PROCESSING',
        contentAuditRisk: null,
        contentAuditSummary: null,
        contentAuditSuggestion: null,
        contentAuditFindings: null,
        contentAuditConfidence: null,
        contentAuditModel: null,
        contentAuditCostUsd: null,
      } as any,
    });

    const mukellef = this.formatMukellefAdi(session);
    await this.pushFeedEvent(tenantId, {
      action: 'kdv-content-audit',
      status: 'bilgi',
      message: `${queue.length} fatura için içerik denetimi başlatıldı`,
      mukellef,
      meta: { sessionId, period: session.periodLabel, type: session.type, queued: queue.length },
    });

    void this.processContentAuditQueue(ids, tenantId, userId, {
      sessionId,
      period: session.periodLabel,
      type: session.type,
      taxpayerId: session.taxpayerId,
      mukellef,
    });

    return {
      queued: queue.length,
      total: images.length,
      skipped: images.length - queue.length,
      message: 'İçerik denetimi arka planda başladı',
    };
  }

  async auditImageContent(
    imageId: string,
    tenantId: string,
    userId?: string,
    opts: { force?: boolean } = {},
  ) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      include: { session: true },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    this.assertSessionUnlocked(image.session);

    if (!opts.force && (image as any).contentAuditStatus === 'DONE') {
      return {
        done: true,
        imageId,
        risk: (image as any).contentAuditRisk,
        summary: (image as any).contentAuditSummary,
        skipped: true,
      };
    }

    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: { contentAuditStatus: 'PROCESSING' } as any,
    });
    const updated = await this.runContentAuditForImage(imageId, tenantId, userId);
    return {
      done: true,
      imageId,
      risk: (updated as any)?.contentAuditRisk,
      summary: (updated as any)?.contentAuditSummary,
      skipped: false,
    };
  }

  private async processContentAuditQueue(
    imageIds: string[],
    tenantId: string,
    userId?: string,
    context?: ContentAuditQueueContext,
  ) {
    const concurrency = Math.max(1, Math.min(4, Number(process.env.KDV_CONTENT_AUDIT_CONCURRENCY) || 2));
    const queue = [...imageIds];
    let done = 0;
    let risky = 0;
    const alertRows: Array<{
      imageId: string;
      originalName?: string | null;
      risk: ContentAuditRisk;
      summary?: string | null;
    }> = [];

    const worker = async () => {
      while (queue.length > 0) {
        const imageId = queue.shift();
        if (!imageId) return;
        const updated = await this.runContentAuditForImage(imageId, tenantId, userId).catch((err) => {
          this.logger.error(`KDV content audit failed [${imageId}]: ${err?.message || err}`);
          return null;
        });
        done++;
        const risk = (updated as any)?.contentAuditRisk;
        if (risk === 'RISKLI' || risk === 'ISLENMEMELI') {
          risky++;
          alertRows.push({
            imageId,
            originalName: (updated as any)?.originalName,
            risk,
            summary: (updated as any)?.contentAuditSummary,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, imageIds.length) }, worker));

    if (alertRows.length > 0) {
      const notAllowedCount = alertRows.filter((row) => row.risk === 'ISLENMEMELI').length;
      const riskyCount = alertRows.length - notAllowedCount;
      const sample = alertRows.slice(0, 3)
        .map((row) => `${row.originalName || row.imageId}: ${String(row.summary || '').slice(0, 140)}`)
        .join('\n');
      const summaryParts = [
        `${context?.mukellef || 'Seçili mükellef'} için ${done} belge denetlendi.`,
        `${alertRows.length} belgede net risk uyarısı var.`,
        notAllowedCount > 0 ? `${notAllowedCount} işlenmemeli` : null,
        riskyCount > 0 ? `${riskyCount} riskli` : null,
      ].filter(Boolean);

      await this.pushMorenAiAlert(tenantId, {
        title: 'MOREN AI uyarısı: Belge içerik denetimi',
        body: `${summaryParts.join(' ')}${sample ? `\n${sample}` : ''}`,
        severity: notAllowedCount > 0 ? 'critical' : 'warning',
        module: 'kdv-control',
        metadata: {
          source: 'kdv-content-audit',
          sessionId: context?.sessionId,
          taxpayerId: context?.taxpayerId,
          period: context?.period,
          type: context?.type,
          totalAudited: done,
          riskyCount,
          notAllowedCount,
          findingsCount: alertRows.length,
          sample: alertRows.slice(0, 5),
          userId,
        },
      });
    }
    this.logger.log(`KDV içerik denetimi tamamlandı: ${done}/${imageIds.length} belge, riskli=${risky}`);
  }

  private async runContentAuditForImage(imageId: string, tenantId: string, userId?: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      include: {
        session: {
          include: {
            taxpayer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                companyName: true,
                taxNumber: true,
                defterTuru: true,
                mihsapDefterTuru: true,
                naceKodu: true,
                notes: true,
              },
            },
          },
        },
      },
    });
    if (!image) return null;

    const startedAt = Date.now();
    try {
      const decision = await this.buildContentAuditDecision(image as any, image.session as any, tenantId);
      const updated = await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          contentAuditStatus: 'DONE',
          contentAuditRisk: decision.risk,
          contentAuditSummary: decision.summary.slice(0, 1000),
          contentAuditSuggestion: decision.suggestion.slice(0, 1000),
          contentAuditFindings: decision.findings as any,
          contentAuditConfidence: Math.max(0, Math.min(1, decision.confidence || 0)),
          contentAuditModel: decision.model,
          contentAuditCostUsd: decision.costUsd ?? 0,
          contentAuditCheckedAt: new Date(),
        } as any,
      });

      if (decision.usage) {
        const tp = image.session.taxpayer;
        const mukellef = this.formatMukellefAdi(image.session);
        await logAiUsage(this.prisma, {
          tenantId,
          source: 'kdv-content-audit',
          model: decision.model,
          taxpayerId: image.session.taxpayerId || tp?.id || null,
          mukellef,
          belgeNo: (image as any).confirmedBelgeNo || image.ocrBelgeNo || null,
          karar: decision.risk,
          sebep: `session:${image.sessionId}`,
          durationMs: Date.now() - startedAt,
          usage: decision.usage,
        });
      }

      return updated;
    } catch (err: any) {
      return this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          contentAuditStatus: 'FAILED',
          contentAuditRisk: 'KONTROL_ET',
          contentAuditSummary: 'İçerik denetimi tamamlanamadı',
          contentAuditSuggestion: String(err?.message || 'Tekrar deneyin').slice(0, 500),
          contentAuditFindings: [{ title: 'Sistem hatası', detail: String(err?.message || err).slice(0, 500), severity: 'KONTROL_ET' }] as any,
          contentAuditConfidence: 0,
          contentAuditModel: 'failed',
          contentAuditCostUsd: 0,
          contentAuditCheckedAt: new Date(),
        } as any,
      });
    }
  }

  private async buildContentAuditDecision(image: any, session: any, tenantId: string): Promise<ContentAuditDecision> {
    const fallback = await this.buildRuleBasedContentAudit(image, session, tenantId);
    // AI içerik denetimi SADECE Gemini (ucuz) üzerinden — ücretli Anthropic API kullanılmaz.
    const geminiKey = process.env.GEMINI_API_KEY;
    const disabled = String(process.env.KDV_CONTENT_AUDIT_AI_DISABLED || '').toLowerCase() === 'true';
    if (!geminiKey || disabled) {
      const moderatedFallback = this.moderateContentAuditDecision(fallback, image, session);
      return { ...fallback, ...moderatedFallback };
    }

    const model = process.env.KDV_CONTENT_AUDIT_MODEL || process.env.MIHSAP_GEMINI_MODEL || 'gemini-2.5-flash-lite';
    try {
      const prompt = await this.buildContentAuditPrompt(image, session, tenantId);
      const timeoutMs = Math.max(3000, Math.min(45000, Number(process.env.KDV_CONTENT_AUDIT_TIMEOUT_MS) || 15000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const system =
        'Türk muhasebe KDV belge içerik uygunluğu için karar destek asistanısın. Nihai hukuki/mali karar vermezsin; gri alanları KONTROL_ET seviyesinde tutar, riskleri kısa, denetlenebilir ve JSON formatında yazarsın.';
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0,
              maxOutputTokens: 700,
            },
          }),
        },
      ).finally(() => clearTimeout(timer));

      if (!res.ok) {
        throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
      }
      const payload: any = await res.json();
      const raw = String(
        payload?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '',
      ).trim();
      const parsed = this.parseContentAuditJson(raw);
      const moderated = this.moderateContentAuditDecision(parsed, image, session);
      const usage = {
        input_tokens: Number(payload?.usageMetadata?.promptTokenCount || 0),
        output_tokens: Number(payload?.usageMetadata?.candidatesTokenCount || 0),
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      };
      const costUsd = computeCostUsd(model, {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens,
      });
      return {
        risk: moderated.risk,
        summary: moderated.summary,
        suggestion: moderated.suggestion,
        findings: moderated.findings,
        confidence: moderated.confidence,
        model,
        costUsd,
        usage,
      };
    } catch (err: any) {
      const moderatedFallback = this.moderateContentAuditDecision(fallback, image, session);
      const providerMessage = err?.name === 'AbortError'
        ? 'Gemini zaman asimina ugradi'
        : String(err?.message || err);
      const fallbackSummary = moderatedFallback.risk === 'UYGUN'
        ? 'Kural tabanli on denetimde belirgin icerik riski bulunmadi.'
        : moderatedFallback.summary;
      const fallbackSuggestion = moderatedFallback.risk === 'UYGUN'
        ? 'AI servisi kullanilamadigi icin sonuc kural tabanlidir; olagan disi belgeleri manuel gozden gecirin.'
        : moderatedFallback.suggestion;
      return {
        ...fallback,
        ...moderatedFallback,
        summary: fallbackSummary,
        suggestion: fallbackSuggestion,
        model: 'rule-fallback',
        confidence: Math.min(moderatedFallback.confidence, 0.55),
        findings: [
          {
            title: 'AI servis uyarısı',
            detail: `Kural tabanli on denetim kullanildi: ${providerMessage.slice(0, 180)}`,
            severity: 'KONTROL_ET' as ContentAuditRisk,
          },
          ...moderatedFallback.findings,
        ].slice(0, 6),
      };
    }
  }

  private moderateContentAuditDecision(
    decision: Omit<ContentAuditDecision, 'model' | 'costUsd' | 'usage'>,
    image: any,
    session: any,
  ): Omit<ContentAuditDecision, 'model' | 'costUsd' | 'usage'> {
    const cleanFindings = (decision.findings || []).filter(
      (finding) => !this.isContentAuditKdvArithmeticNoise(`${finding?.title || ''} ${finding?.detail || ''}`),
    );
    const defaultSummary: Record<ContentAuditRisk, string> = {
      UYGUN: 'Belge faaliyete uygun görünüyor.',
      KONTROL_ET: 'Belge için muhasebeci kontrolü önerilir.',
      RISKLI: 'Belge faaliyet uygunluğu açısından dikkat istiyor.',
      ISLENMEMELI: 'Belge için açık uygunsuzluk sinyali var.',
    };
    const defaultSuggestion: Record<ContentAuditRisk, string> = {
      UYGUN: 'Normal kayıt; belge dayanağını dosyada saklayın.',
      KONTROL_ET: 'Faaliyet bağlantısını ve belge dayanağını kontrol edin.',
      RISKLI: 'KDV indirimi öncesi belge içeriğini ve faaliyet bağlantısını teyit edin.',
      ISLENMEMELI: 'KDV indirimine almadan önce kanunen kabul edilmeyen gider/özel harcama değerlendirmesi yapın.',
    };
    const cleanSummary = this.stripContentAuditKdvArithmeticNoise(decision.summary)
      || defaultSummary[decision.risk];
    const cleanSuggestion = this.stripContentAuditKdvArithmeticNoise(decision.suggestion)
      || defaultSuggestion[decision.risk];
    const baseDecision = {
      ...decision,
      summary: cleanSummary,
      suggestion: cleanSuggestion,
      findings: cleanFindings.length > 0
        ? cleanFindings
        : [{ title: 'İçerik yorumu', detail: cleanSummary, severity: decision.risk }],
    };

    const sourceText = [
      image.ocrRawText,
      image.ocrKategori,
      image.ocrBelgeTipi,
      image.ocrSatici,
      image.originalName,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    const aiText = [
      baseDecision.summary,
      baseDecision.suggestion,
      JSON.stringify(baseDecision.findings || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    const text = `${sourceText} ${aiText}`.trim();

    const taxpayerText = [
      session?.taxpayer?.companyName,
      session?.taxpayer?.notes,
      session?.taxpayer?.naceKodu,
      session?.taxpayer?.defterTuru,
      session?.taxpayer?.mihsapDefterTuru,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');

    const hardBlockSignal =
      /trafik cezas[ıi]|ceza|gecikme zamm[ıi]|usuls[üu]zl[üu]k|kkeg|alkol|sigara|t[üu]t[üu]n|tekel/.test(sourceText);
    const commonBusinessGreyArea =
      /yemek|restoran|lokanta|cafe|kafe|kahve|ikram|catering|market|g[ıi]da|b[öo]rek|k[üu]nefe|baklava|temizlik|deterjan|sarf|akaryak[ıi]t|yak[ıi]t|benzin|motorin|otel|konaklama|seyahat|kargo|telefon|internet|elektrik|su|k[ıi]rtasiye|ofis|yedek par[çc]a|aksesuar|oto cam|cam malzemesi|bak[ıi]m|onar[ıi]m|lastik|ak[üu]|balata|filtre|motor ya[ğg][ıi]/.test(text);
    const fuelSignal = /akaryak[ıi]t|yak[ıi]t|motorin|benzin|otogaz|shell/.test(text);
    const vehicleEvidence =
      /plaka|utts|ta[şs][ıi]t tan[ıi]ma|shell card|kurumsal ödeme kart[ıi]|[0-9]{2}\s*[a-zçğıöşü]{1,3}\s*[0-9]{2,4}/i.test(text);
    const transportActivity =
      /servis|ta[şs][ıi]mac[ıi]l[ıi]k|turizm|nakliye|lojistik|taksi|rent a car|ara[çc] kiralama/.test(`${text} ${taxpayerText}`);
    const ordinaryOverheadSignal =
      /t[üu]rk telekom|ttnet|turkcell|vodafone|superonline|telefon|mobil hizmet|gsm|internet|fiber|dsl|sabit hat|ileti[şs]im|elektrik|su fatur|do[ğg]algaz|kira|muhasebe|noter|yaz[ıi]l[ıi]m|k[ıi]rtasiye|ofis|kargo/.test(text);
    const mealExpenseSignal =
      /yemek|restoran|lokanta|cafe|kafe|kahve|ikram|catering|personel yeme[ğg]i|market|g[ıi]da|b[öo]rek|k[üu]nefe|baklava/.test(text);
    const vehicleMaintenanceSignal =
      /yedek par[çc]a|aksesuar|oto cam|cam malzemesi|bak[ıi]m|onar[ıi]m|lastik|ak[üu]|balata|filtre|motor ya[ğg][ıi]|ara[çc] servis|oto servis/.test(text);
    const personalUseSignal =
      /bireysel|ki[şs]isel|[öo]zel kullan[ıi]m|konut|ev interneti|ev telefonu|aile|hediye|l[üu]ks|oyun|e[ğg]lence/.test(sourceText);
    const ordinaryBusinessExpenseSignal =
      ordinaryOverheadSignal ||
      mealExpenseSignal ||
      commonBusinessGreyArea ||
      (vehicleMaintenanceSignal && (transportActivity || vehicleEvidence || /oto|ara[çc]|servis|ta[şs][ıi]ma/.test(taxpayerText)));
    const profileIsThin = taxpayerText.trim().length < 18;
    const lowConfidence = Number(baseDecision.confidence || 0) < 0.82;

    // SATIŞ oturumunda gider-odaklı override'ları atla — ALIS mantığı SATIS'a uygulanmaz
    const isSatisSession = ['KDV_391', 'ISLETME_GELIR'].includes(String(session?.type || '').toUpperCase());
    if (isSatisSession) {
      // KONTROL_ET → UYGUN: AI bazen faaliyetle uyumlu satışları yanlış bayraklar.
      // Mükellef faaliyet profili belgedeki satışla örtüşüyorsa güvenli kabul et.
      if (baseDecision.risk === 'KONTROL_ET' && !hardBlockSignal) {
        // Nakliye/lojistik mükellef → nakliye/taşıma/liman satışı = olağan
        const transportTaxpayer = /nakliye|lojistik|ta[şs][ıi]mac[ıi]l[ıi]k|kargo|turizm|liman|sefer/.test(taxpayerText);
        const transportSale = /nakliye|ta[şs][ıi]ma|kargo|liman|hizmet bedel|navlun|sefer|nakliye bedel/.test(text);
        if (transportTaxpayer && transportSale) {
          return {
            ...baseDecision,
            risk: 'UYGUN' as ContentAuditRisk,
            summary: 'Nakliye/lojistik faaliyetiyle uyumlu olağan satış belgesidir.',
            suggestion: 'Normal satış kaydı; belge dayanağını dosyada saklayın.',
          };
        }
        // Genel faaliyet-içerik uyumu: taxpayerText'teki anlamlı kelimeler belgede geçiyorsa
        const profileKeywords = (taxpayerText.match(/[a-zçğıöşüa-z]{5,}/g) || []);
        const faaliyetMatch = profileKeywords.length > 0 && profileKeywords.some(kw => text.includes(kw));
        if (faaliyetMatch) {
          return {
            ...baseDecision,
            risk: 'UYGUN' as ContentAuditRisk,
            summary: 'Satış belgesi mükellefin faaliyet alanıyla uyumlu görünüyor.',
            suggestion: 'Normal satış kaydı; belge dayanağını dosyada saklayın.',
          };
        }
      }
      return baseDecision;
    }

    if (
      baseDecision.risk === 'KONTROL_ET' &&
      !hardBlockSignal &&
      fuelSignal &&
      vehicleEvidence &&
      transportActivity
    ) {
      return {
        risk: 'UYGUN',
        summary: 'Akaryakıt belgesi servis/taşıt faaliyetiyle uyumlu görünüyor.',
        suggestion: 'Normal kayıt; plaka, UTTS veya kurumsal kart bilgisini belge dayanağında saklayın.',
        findings: [
          {
            title: 'Faaliyet bağlantısı güçlü',
            detail: 'Belgede akaryakıt, taşıt/plaka veya kurumsal kart sinyali ve taşıma faaliyeti birlikte görünüyor.',
            severity: 'UYGUN' as ContentAuditRisk,
          },
          ...baseDecision.findings.filter((finding) => finding.severity === 'UYGUN'),
        ].slice(0, 6),
        confidence: Math.max(Number(baseDecision.confidence || 0), 0.78),
      };
    }

    if (
      baseDecision.risk === 'KONTROL_ET' &&
      !hardBlockSignal &&
      ordinaryOverheadSignal &&
      !personalUseSignal
    ) {
      return {
        risk: 'UYGUN',
        summary: 'Belge olağan işletme haberleşme/ofis gideri niteliğinde görünüyor.',
        suggestion: 'Normal kayıt; fatura işletme adına/işletme kullanımına aitse belge dayanağını dosyada saklayın.',
        findings: [
          {
            title: 'Olağan işletme gideri',
            detail: 'Telefon, internet, ofis veya benzeri genel işletme giderleri açık kişisel kullanım sinyali yoksa ayrıca faaliyet dışı sayılmadı.',
            severity: 'UYGUN' as ContentAuditRisk,
          },
          ...baseDecision.findings.filter((finding) => finding.severity === 'UYGUN'),
        ].slice(0, 6),
        confidence: Math.max(Number(baseDecision.confidence || 0), 0.78),
      };
    }

    if (
      (baseDecision.risk === 'KONTROL_ET' || baseDecision.risk === 'RISKLI') &&
      !hardBlockSignal &&
      !personalUseSignal &&
      ordinaryBusinessExpenseSignal
    ) {
      return {
        risk: 'UYGUN',
        summary: 'Belge olağan işletme gideri niteliğinde görünüyor.',
        suggestion: 'Normal kayıt; işletme bağlantısı için belge dayanağını dosyada saklayın.',
        findings: [
          {
            title: 'Olağan gider',
            detail: 'Yemek, bakım, yedek parça, sarf, ofis veya benzeri olağan işletme giderlerinde açık kişisel kullanım sinyali yoksa otomatik kontrol uyarısı üretilmedi.',
            severity: 'UYGUN' as ContentAuditRisk,
          },
          ...baseDecision.findings.filter((finding) => finding.severity === 'UYGUN'),
        ].slice(0, 6),
        confidence: Math.max(Number(baseDecision.confidence || 0), 0.76),
      };
    }

    // Mükellef profili çok ince (sistemde tanımlı bilgi yok) VE AI güveni düşükse → KONTROL_ET
    if (profileIsThin && baseDecision.risk === 'UYGUN' && lowConfidence) {
      return {
        risk: 'KONTROL_ET',
        summary: 'Mükellef profili sistemde yetersiz; güven skoru düşük belge manuel kontrol edilmeli.',
        suggestion: 'Faaliyet/sektör kaydı tanımlı olmayan mükellef için belge işletme bağlantısı muhasebeci tarafından teyit edilmeli.',
        findings: [
          {
            title: 'Profil yetersiz',
            detail: 'Mükellef faaliyet bilgisi sistemde tanımlı değil; AI güven skoru da düşük. Belge işletmeyle ilgili mi gözden geçirin.',
            severity: 'KONTROL_ET' as ContentAuditRisk,
          },
          ...baseDecision.findings,
        ].slice(0, 6),
        confidence: Math.min(Number(baseDecision.confidence || 0), 0.65),
      };
    }

    if (baseDecision.risk !== 'RISKLI' && baseDecision.risk !== 'ISLENMEMELI') return baseDecision;

    const shouldDowngrade =
      !hardBlockSignal &&
      (baseDecision.risk === 'ISLENMEMELI' || commonBusinessGreyArea || lowConfidence || profileIsThin);

    if (!shouldDowngrade) return baseDecision;

    const findings = (baseDecision.findings || []).map((finding) => ({
      ...finding,
      severity: finding.severity === 'RISKLI' || finding.severity === 'ISLENMEMELI'
        ? 'KONTROL_ET' as ContentAuditRisk
        : finding.severity,
    }));

    return {
      risk: 'KONTROL_ET',
      summary: 'Belge otomatik olarak net uygunsuz sayılmadı; faaliyet bağlantısı için muhasebeci kontrolü önerilir.',
      suggestion: 'Belgeyi reddetmeden önce açıklama, faaliyet bağlantısı ve gider dayanağını kontrol edin.',
      findings: [
        {
          title: 'Seviye düşürüldü',
          detail: 'AI yorumu gri alanda kaldığı için riskli yerine kontrol et seviyesinde tutuldu.',
          severity: 'KONTROL_ET' as ContentAuditRisk,
        },
        ...findings,
      ].slice(0, 8),
      confidence: Math.min(Number(baseDecision.confidence || 0), 0.74),
    };
  }

  private isContentAuditKdvArithmeticNoise(value: any) {
    const text = String(value || '').toLocaleLowerCase('tr-TR');
    return /kdv.{0,80}(oran|hesap|matrah|beklen|br[üu]t|net|%|×|fark)|oran fark|%16[,.]67|%20[,.]17|700[,.]20|841[,.]75/.test(text);
  }

  private stripContentAuditKdvArithmeticNoise(value: any) {
    const text = String(value || '').trim();
    if (!this.isContentAuditKdvArithmeticNoise(text)) return text;
    return text
      .split(/(?:[.;]\s+|\n+)/)
      .map((part) => part.trim())
      .filter((part) => part && !this.isContentAuditKdvArithmeticNoise(part))
      .join('; ')
      .trim();
  }

  private async buildContentAuditPrompt(image: any, session: any, tenantId: string) {
    const profile = await this.findTaxpayerContentProfile(session, tenantId);
    const taxpayer = session.taxpayer || {};

    const naceKodu: string | null = taxpayer.naceKodu || null;
    const naceAciklama: string | null = naceKodu ? (NACE_ACIKLAMA[naceKodu] || null) : null;
    // Faaliyet: önce agentRule profili, yoksa NACE açıklamasından türet
    const profilFaaliyet: string | null = profile?.faaliyet || naceAciklama || null;

    const kategoriEtiketi: string | null = image.ocrKategori
      ? (OCR_KATEGORI_ETIKET[image.ocrKategori] || image.ocrKategori)
      : null;

    const text = [
      image.ocrRawText,
      kategoriEtiketi ? `Kategori: ${kategoriEtiketi}` : '',
      image.ocrBelgeTipi ? `Belge tipi: ${image.ocrBelgeTipi}` : '',
    ].filter(Boolean).join('\n').slice(0, 3500);

    // Bu mükellef için bilinen satıcı→kategori eşleşmeleri (VendorMemory)
    let bilinenSaticilar: Array<{ vkn: string; unvan: string | null; kategori: string; onay: number }> = [];
    try {
      const taxpayerId = session?.taxpayer?.id;
      if (taxpayerId) {
        const vmRows = await (this.prisma as any).vendorMemoryDecision.findMany({
          where: { taxpayerId, kararTipi: 'isletme', onayAdedi: { gt: 0 } },
          include: { vendorMemory: { select: { firmaKimlikNo: true, firmaUnvan: true } } },
          orderBy: { onayAdedi: 'desc' },
          take: 10,
        });
        bilinenSaticilar = vmRows.map((d: any) => ({
          vkn: d.vendorMemory?.firmaKimlikNo,
          unvan: d.vendorMemory?.firmaUnvan || null,
          kategori: d.kategori + (d.altKategori ? `/${d.altKategori}` : ''),
          onay: d.onayAdedi,
        }));
      }
    } catch { /* ignore */ }

    const payload = {
      mukellef: {
        ad: this.formatMukellefAdi(session) || null,
        defterTuru: taxpayer.defterTuru || taxpayer.mihsapDefterTuru || null,
        naceKodu,
        naceAciklama,
        profilFaaliyet,
        profilDefterTuru: profile?.defterTuru || null,
        profil: profile?.profile || null,
        bilinenSaticilar: bilinenSaticilar.length > 0 ? bilinenSaticilar : null,
      },
      kontrol: { tip: session.type, donem: session.periodLabel },
      belge: {
        dosyaAdi: image.originalName,
        belgeNo: image.confirmedBelgeNo || image.ocrBelgeNo || null,
        tarih: image.confirmedDate || image.ocrDate || null,
        kdvTutari: image.confirmedKdvTutari || image.ocrKdvTutari || null,
        kdvTevkifat: image.confirmedKdvTevkifat || image.ocrKdvTevkifat || null,
        satici: image.ocrSatici || null,
        saticiVkn: image.ocrSaticiVkn || null,
        kategori: kategoriEtiketi,
        belgeTipi: image.ocrBelgeTipi || null,
        metin: text || null,
      },
    };

    // SATIŞ (hesaplanan KDV / işletme geliri) belgeleri mükellefin KENDİ gelir
    // belgesidir (Z raporu, satış faturası) — GİDER değil. Gider-doğrulama mantığı
    // (harcama/işletme gideri/kişisel kullanım) bunlara UYGULANMAZ; ayrı çerçeve kullanılır.
    const isSatis = ['KDV_391', 'ISLETME_GELIR'].includes(String(session?.type || '').toUpperCase());
    if (isSatis) {
      return `Aşağıdaki belge MÜKELLEFİN KENDİ SATIŞ/GELİR belgesidir (ör. Z raporu, satış faturası, satış e-belgesi). Bir GİDER/harcama DEĞİLDİR. Mükellefin SATIŞ/GELİR kaydı açısından içerik riski var mı değerlendir.

Kurallar:
- Bu bir SATIŞ belgesidir; mükellef burada SATICI/geliri elde eden taraftır. "İşletme gideri olarak kaydedilmeli mi", "harcama", "alış", "alım", "kişisel kullanım/şahsi tüketim" gibi GİDER mantığını ASLA uygulama.
- Değerlendirme ekseni: satışın mükellefin faaliyetiyle (satıcı olarak) tutarlılığı ve belgenin bu mükellefe/döneme ait olağan bir satış olup olmadığı.
- Mükellefin faaliyet alanına uygun ürün/hizmet satışında UYGUN seç (örn. giyim mağazasının giyim satışı = olağan satış, UYGUN).
- KONTROL_ET yalnızca: satış mükellefin faaliyetiyle açıkça bağdaşmıyorsa, ya da iptal/dönem-dışı/şüpheli (olası sahte-naylon) satış sinyali varsa.
- RISKLI/ISLENMEMELI yalnızca çok net sahtelik/usulsüzlük sinyalinde.
- KDV oran/tutar matematiği yapma (ayrı KDV kontrol modülünde denetlenir). Z raporu seri/sıra ve numara atlama takibi de AYRI yapılır; onu burada tekrar etme.
- "Kaydedilmemeli" gibi kesin talimat verme; gri alanda muhasebeci kontrolü öner.
- Cevap sadece JSON olsun.

JSON şeması:
{
  "risk": "UYGUN | KONTROL_ET | RISKLI | ISLENMEMELI",
  "summary": "tek cümle kısa yorum (satış belgesi dilinde)",
  "suggestion": "muhasebecinin yapacağı işlem önerisi",
  "confidence": 0.0,
  "findings": [
    { "title": "kısa bulgu", "detail": "neden", "severity": "UYGUN | KONTROL_ET | RISKLI | ISLENMEMELI" }
  ]
}

Veri:
${JSON.stringify(payload, null, 2)}`;
    }

    return `Aşağıdaki belge mükellefin faaliyetine göre KDV kayıtlarına konu edilebilir mi, risk var mı değerlendir.

Kurallar:
- Varsayılan seviye olağan işletme giderlerinde UYGUN olsun; KONTROL_ET yalnızca gerçekten anlamlı eksik kanıt veya kişisel kullanım şüphesi varsa seç.
- Sadece faaliyet farklı görünüyor diye yemek, market, temizlik, deterjan, yedek parça, aksesuar, bakım/onarım, akaryakıt, kargo, telefon, internet, ofis veya seyahat kalemlerini reddetme ya da KONTROL_ET yapma; açık özel/kişisel/lüks/konut sinyali yoksa normal işletme gideri kabul et.
- RISKLI için belge metninde açık özel/kişisel/lüks tüketim sinyali ve faaliyete bağlanamama birlikte bulunmalı.
- ISLENMEMELI sadece ceza, gecikme zammı, KKEG, alkol/tütün veya kanunen açık indirim yasağı gibi çok net durumda kullanılmalı.
- "Belge muhasebeleştirilmemeli" gibi kesin talimat verme; muhasebeciye kontrol adımı öner.
- KDV tutarı ve oranı zaten ayrı KDV kontrol modülünde denetleniyor; içerik denetiminde brüt tutardan KDV oranı hesaplama, "%18 beklenir" gibi matematik yorumu yapma.
- Akaryakıt belgesinde servis/taşımacılık/turizm faaliyetiyle birlikte plaka, UTTS, taşıt tanıma veya kurumsal yakıt kartı görülüyorsa normalde UYGUN seç; aynı taşıt bağlantısını her belgede tekrar KONTROL_ET yapma.
- Telefon, internet, mobil hat, elektrik, su, kira, muhasebe, noter, yazılım, kırtasiye, ofis ve kargo gibi olağan işletme giderlerini sadece kullanım amacı metinde tek tek yazmıyor diye KONTROL_ET yapma; bireysel/konut/kişisel kullanım sinyali varsa KONTROL_ET seç.
- Yemek/restoran/ikram ve araç bakım/yedek parça/aksesuar belgelerini işletmeler için olağan gider say; belge metninde şahsi tüketim, alkol, lüks eğlence veya konut/aile kullanımı yoksa UYGUN seç.
- Sadece verilen veriye dayan; olağan giderlerde emin değilsen UYGUN kal, ancak açık kişisel kullanım/konut/lüks/ceza/alkol veya gerçekten kritik eksik kanıt varsa KONTROL_ET seç.
- Faaliyetle açıkça ilgisiz özel harcama, ceza, alkol/tütün, hediye/lüks tüketim gibi kalemleri yükselt.
- Yemek, otel, akaryakıt, seyahat gibi kalemlerde mükellef faaliyetini ve belge açıklamasını birlikte düşün.
- Cevap sadece JSON olsun.

JSON şeması:
{
  "risk": "UYGUN | KONTROL_ET | RISKLI | ISLENMEMELI",
  "summary": "tek cümle kısa yorum",
  "suggestion": "muhasebecinin yapacağı işlem önerisi",
  "confidence": 0.0,
  "findings": [
    { "title": "kısa bulgu", "detail": "neden", "severity": "UYGUN | KONTROL_ET | RISKLI | ISLENMEMELI" }
  ]
}

Veri:
${JSON.stringify(payload, null, 2)}`;
  }

  private parseContentAuditJson(raw: string): Omit<ContentAuditDecision, 'model' | 'costUsd' | 'usage'> {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('İçerik denetimi JSON dönmedi');
    const parsed = JSON.parse(jsonMatch[0]);
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.slice(0, 8).map((f: any) => ({
          title: String(f?.title || 'Bulgu').slice(0, 120),
          detail: String(f?.detail || '').slice(0, 500),
          severity: this.normalizeContentAuditRisk(f?.severity || parsed.risk),
        }))
      : [];
    return {
      risk: this.normalizeContentAuditRisk(parsed.risk),
      summary: String(parsed.summary || 'İçerik denetimi yorum üretti').slice(0, 1000),
      suggestion: String(parsed.suggestion || 'Muhasebeci kontrolü önerilir').slice(0, 1000),
      findings,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
    };
  }

  private async findTaxpayerContentProfile(session: any, tenantId: string) {
    const mukellef = this.formatMukellefAdi(session);
    if (!mukellef) return null;
    try {
      return await (this.prisma as any).agentRule.findFirst({
        where: { tenantId, mukellef },
        select: { faaliyet: true, defterTuru: true, profile: true },
      });
    } catch {
      return null;
    }
  }

  private async buildRuleBasedContentAudit(image: any, session: any, tenantId: string): Promise<ContentAuditDecision> {
    const profile = await this.findTaxpayerContentProfile(session, tenantId);
    const taxpayer = session.taxpayer || {};
    const readableText = [
      image.ocrRawText,
      image.ocrKategori,
      image.ocrBelgeTipi,
      image.ocrSatici,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    const text = [
      readableText,
      image.originalName,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    const nace = String(taxpayer.naceKodu || '').trim();
    const activityText = [
      taxpayer.companyName,
      taxpayer.notes,
      taxpayer.defterTuru,
      taxpayer.mihsapDefterTuru,
      taxpayer.naceKodu,
      profile?.faaliyet,
      JSON.stringify(profile?.profile || {}),
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    const findings: ContentAuditDecision['findings'] = [];

    const hasActivity = (codes: string[], pattern: RegExp) =>
      codes.some((code) => nace.startsWith(code)) || pattern.test(activityText);
    const add = (risk: ContentAuditRisk, title: string, detail: string) => {
      findings.push({ title, detail, severity: risk });
    };

    if (!readableText.trim()) {
      add('KONTROL_ET', 'OCR metni yetersiz', 'Belge içeriği okunamadığı için yalnızca belge no/tarih/KDV kontrolü güvenilir.');
    }

    const foodSector = hasActivity(['56', '10', '47.11'], /restoran|lokanta|gıda|gida|market|cafe|kafe|yemek|catering/);
    const travelSector = hasActivity(['49', '50', '51', '52', '55', '79'], /turizm|otel|konaklama|seyahat|taşıma|tasima|nakliye|lojistik|servis|taksi/);
    const fuelSector = hasActivity(['49', '52', '45', '46.71', '47.30'], /nakliye|lojistik|taşıma|tasima|servis|taksi|oto|araç|arac|akaryakıt|akaryakit/);
    const retailSector = hasActivity(['47', '46'], /perakende|toptan|mağaza|magaza|market|giyim|kozmetik|aksesuar/);

    if (/ceza|trafik cezası|trafik cezasi|gecikme zammı|gecikme zammi|usulsüzlük|usulsuzluk/.test(text)) {
      add('ISLENMEMELI', 'Ceza/kanunen kabul edilmeyen gider sinyali', 'Belgede ceza veya gecikme benzeri ifade var; KDV indirimi açısından işlenmemeli olabilir.');
    }
    if (/alkol|sigara|tütün|tutun|tekel/.test(text)) {
      add('ISLENMEMELI', 'Alkol/tütün sinyali', 'Belge içeriği KDV indirimine konu edilmeyecek özel tüketim kalemi olabilir.');
    }
    if (/otel|konaklama|hotel|tatil|uçak|ucak|bilet|seyahat/.test(text) && !travelSector) {
      add('RISKLI', 'Faaliyet dışı seyahat/konaklama', 'Mükellef profilinde seyahat, taşıma veya konaklama faaliyeti belirgin değil.');
    }
    if (/akaryakıt|akaryakit|yakıt|yakit|benzin|motorin|otogaz/.test(text) && !fuelSector) {
      add('KONTROL_ET', 'Akaryakıt uygunluğu', 'Araç/taşıma faaliyeti veya işletme aracı bağlantısı ayrıca kontrol edilmeli.');
    }
    if (/restoran|lokanta|yemek|cafe|kafe|kahve|market|gıda|gida/.test(text) && !foodSector && !retailSector) {
      add('KONTROL_ET', 'Yemek/market uygunluğu', 'Belgenin personel, temsil ağırlama veya faaliyet bağlantısı netleştirilmeli.');
    }
    if (/giyim|kozmetik|hediye|aksesuar|kuyum|takı|taki|oyuncak/.test(text) && !retailSector) {
      add('RISKLI', 'Özel tüketim riski', 'Belge içeriği mükellefin faaliyetinden bağımsız kişisel harcama gibi duruyor.');
    }

    if (findings.length === 0 && /telefon|internet|elektrik|su|doğalgaz|dogalgaz|kira|muhasebe|noter|yazılım|yazilim|kırtasiye|kirtasiye|ofis|kargo/.test(text)) {
      add('UYGUN', 'Genel işletme gideri sinyali', 'Belge içeriği yaygın işletme giderleriyle uyumlu görünüyor.');
    }

    const riskRank: Record<ContentAuditRisk, number> = { UYGUN: 0, KONTROL_ET: 1, RISKLI: 2, ISLENMEMELI: 3 };
    const risk = findings.reduce<ContentAuditRisk>(
      (max, f) => riskRank[(f.severity || 'KONTROL_ET') as ContentAuditRisk] > riskRank[max]
        ? (f.severity as ContentAuditRisk)
        : max,
      findings.length > 0 ? (findings[0].severity || 'KONTROL_ET') as ContentAuditRisk : 'UYGUN',
    );
    const summary = risk === 'UYGUN'
      ? 'Belge içeriği mükellef faaliyetiyle belirgin şekilde çelişmiyor.'
      : risk === 'KONTROL_ET'
        ? 'Belge içeriği için muhasebeci yorumu veya ek dayanak gerekiyor.'
        : risk === 'RISKLI'
          ? 'Belge içeriği faaliyet uygunluğu açısından riskli görünüyor.'
          : 'Belge içeriği KDV indirimi açısından işlenmemeli olabilir.';
    const suggestion = risk === 'UYGUN'
      ? 'Normal KDV kontrolüyle birlikte işlenebilir; nihai karar kullanıcıdadır.'
      : risk === 'KONTROL_ET'
        ? 'Belgenin faaliyetle bağlantısını ve gider dayanağını kontrol edin.'
        : risk === 'RISKLI'
          ? 'KDV indirimi öncesi belge içeriğini, faaliyet kodunu ve açıklamayı teyit edin.'
          : 'KDV indirimine almadan önce kanunen kabul edilmeyen gider/özel harcama değerlendirmesi yapın.';

    return {
      risk,
      summary,
      suggestion,
      findings: findings.length > 0 ? findings.slice(0, 6) : [{ title: 'Belirgin risk yok', detail: 'Kural tabanlı ön kontrolde açık risk sinyali bulunmadı.', severity: 'UYGUN' }],
      confidence: readableText.trim() ? 0.62 : 0.35,
      model: 'rule-based',
      costUsd: 0,
    };
  }

  private normalizeContentAuditRisk(value: any): ContentAuditRisk {
    const s = String(value || '').toLocaleUpperCase('tr-TR');
    if (/ISLEN|İŞLEN|ISLEME|İŞLEME|KKEG/.test(s)) return 'ISLENMEMELI';
    if (/RISK|RİSK|RED|UYGUNSUZ/.test(s)) return 'RISKLI';
    if (/KONTROL|İNCELE|INCELE|EMIN|EMİN|BELIRSIZ|BELİRSİZ/.test(s)) return 'KONTROL_ET';
    if (/UYGUN|OK|NORMAL/.test(s)) return 'UYGUN';
    return 'KONTROL_ET';
  }

  /**
   * DRY-RUN OCR denetimi — DB'ye hiçbir şey yazmaz.
   * Sistemdeki TÜM görselleri (SUCCESS dahil) tekrar OCR'dan geçirir,
   * mevcut kayıtla karşılaştırır, hata pattern'lerini raporlar.
   * Parser regresyonlarını tespit etmek için kullanılır.
   */
  async dryRunOcrAudit(tenantId?: string, limit = 200): Promise<{
    total: number;
    scanned: number;
    regressions: number;
    errorPatterns: Record<string, number>;
    samples: Array<{ imageId: string; belgeTipi: string; field: string; stored: string; fresh: string }>;
    diag: { nullKey: number; nullInv: number; nullLink: number; cdnFail: number; ocrFail: number; firstCdnStatus?: number };
  }> {
    const images = await this.prisma.receiptImage.findMany({
      where: {
        ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW', 'FAILED', 'LOW_CONFIDENCE'] },
        ...(tenantId ? { session: { tenantId } } : {}),
      },
      select: {
        id: true, s3Key: true, originalName: true,
        ocrStatus: true, ocrBelgeNo: true, ocrDate: true, ocrKdvTutari: true,
        ocrBelgeTipi: true,
        session: { select: { tenantId: true } },
      },
      orderBy: { uploadedAt: 'desc' },
      take: limit,
    });

    const errorPatterns: Record<string, number> = {};
    const samples: Array<{ imageId: string; belgeTipi: string; field: string; stored: string; fresh: string }> = [];
    let scanned = 0;
    let regressions = 0;
    const diag = { nullKey: 0, nullInv: 0, nullLink: 0, cdnFail: 0, ocrFail: 0, firstCdnStatus: undefined as number | undefined };

    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = (this.storage as any).s3;
    const bucket = this.storage.getBucket();

    for (const img of images) {
      try {
        let buffer: Buffer;
        const s3Key = img.s3Key;
        if (!s3Key) { diag.nullKey++; continue; }

        if (s3Key.startsWith('mihsap://')) {
          // Mihsap CDN'den indir
          const invoiceId = s3Key.slice('mihsap://'.length);
          const inv = await (this.prisma as any).mihsapInvoice.findUnique({
            where: { id: invoiceId },
            select: { mihsapFileLink: true, tenantId: true },
          });
          if (!inv) { diag.nullInv++; continue; }
          if (!inv.mihsapFileLink) { diag.nullLink++; continue; }
          const cdnRes = await fetch(inv.mihsapFileLink, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0',
              Accept: 'image/*,application/pdf,application/xml,*/*',
              Referer: 'https://app.mihsap.com/',
            },
            redirect: 'follow',
          });
          if (!cdnRes.ok) {
            diag.cdnFail++;
            if (diag.firstCdnStatus === undefined) diag.firstCdnStatus = cdnRes.status;
            continue;
          }
          buffer = Buffer.from(await cdnRes.arrayBuffer());
        } else {
          // S3'ten indir
          const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
          const chunks: Buffer[] = [];
          for await (const chunk of res.Body as any) chunks.push(chunk);
          buffer = Buffer.concat(chunks);
        }

        let fresh: Awaited<ReturnType<typeof this.ocrService.extractFromImage>>;
        try {
          fresh = await this.ocrService.extractFromImage(buffer, img.originalName || undefined);
        } catch (ocrErr: any) {
          diag.ocrFail++;
          this.logger.warn(`dryRunOcrAudit OCR hata [${img.id}]: ${ocrErr?.message}`);
          continue;
        }
        scanned++;

        const freshStatus = this.ocrService.needsReview(fresh).needs ? 'NEEDS_REVIEW' : 'SUCCESS';
        const wasSuccess = img.ocrStatus === 'SUCCESS';
        const nowFails = freshStatus === 'NEEDS_REVIEW';

        if (wasSuccess && nowFails) {
          regressions++;
          const pat = `REGRESYON:${fresh.belgeTipi || 'UNKNOWN'}`;
          errorPatterns[pat] = (errorPatterns[pat] || 0) + 1;
        }

        // belgeNo farkı
        if (img.ocrBelgeNo && fresh.belgeNo && img.ocrBelgeNo !== fresh.belgeNo) {
          const pat = `BELGE_NO_FARKI:${fresh.belgeTipi || 'UNKNOWN'}`;
          errorPatterns[pat] = (errorPatterns[pat] || 0) + 1;
          if (samples.length < 20) samples.push({ imageId: img.id, belgeTipi: fresh.belgeTipi || '?', field: 'belgeNo', stored: img.ocrBelgeNo, fresh: fresh.belgeNo });
        }

        // KDV tutarı farkı
        const storedKdv = img.ocrKdvTutari ? parseFloat(String(img.ocrKdvTutari).replace(',', '.')) : null;
        const freshKdv = fresh.kdvTutari ? parseFloat(String(fresh.kdvTutari).replace(',', '.')) : null;
        if (storedKdv !== null && freshKdv !== null && Math.abs(storedKdv - freshKdv) > 0.05) {
          const pat = `KDV_FARKI:${fresh.belgeTipi || 'UNKNOWN'}`;
          errorPatterns[pat] = (errorPatterns[pat] || 0) + 1;
          if (samples.length < 20) samples.push({ imageId: img.id, belgeTipi: fresh.belgeTipi || '?', field: 'kdvTutari', stored: String(img.ocrKdvTutari), fresh: String(fresh.kdvTutari) });
        }

        // Tarih farkı
        if (img.ocrDate && fresh.date && img.ocrDate !== fresh.date) {
          const pat = `TARIH_FARKI:${fresh.belgeTipi || 'UNKNOWN'}`;
          errorPatterns[pat] = (errorPatterns[pat] || 0) + 1;
        }

        await new Promise((r) => setTimeout(r, 300)); // rate limit
      } catch (err: any) {
        this.logger.warn(`dryRunOcrAudit [${img.id}]: ${err?.message}`);
      }
    }

    return { total: images.length, scanned, regressions, errorPatterns, samples, diag };
  }

  async reocrSingleImage(imageId: string, tenantId: string, opts: { forceClaude?: boolean } = {}) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      include: { session: true },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');
    this.assertSessionUnlocked(image.session);
    if (!image.s3Key) {
      throw new BadRequestException('Görselin kaynağı (s3Key) yok — OCR yapılamaz');
    }

    // OCR sonuçlarını sıfırla — yeni sonuç temiz yazılsın.
    // confirmedKdvBreakdown (Json?) Prisma'da plain null kabul etmiyor;
    // isManuallyConfirmed=false olduğu için zaten okunmayacak — bu yüzden
    // dokunmuyoruz, sadece flag'i sıfırlıyoruz. Yeni OCR ocrKdvBreakdown'a yazar.
    await this.prisma.receiptImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: 'PROCESSING',
        isManuallyConfirmed: false,
        confirmedBelgeNo: null,
        confirmedDate: null,
        confirmedKdvTutari: null,
        confirmedKdvTevkifat: null,
      },
    });

    // Arkaplanda çalıştır — HTTP isteğini bloke etmiyoruz, frontend polling'le takip eder.
    (async () => {
      try {
        if (image.s3Key.startsWith('mihsap://')) {
          const invoiceId = image.s3Key.slice('mihsap://'.length);
          await this.runOcrForMihsapInvoice(image.id, invoiceId, tenantId, { ...opts, forceFresh: true });
        } else {
          await this.runOcrForImage(image.id, image.s3Key, { ...opts, forceFresh: true });
        }
      } catch (err: any) {
        this.logger.error(`reocrSingleImage [${imageId}]: ${err?.message}`);
      }
    })();

    return {
      queued: true,
      imageId,
      message: 'OCR yeniden başlatıldı — birkaç saniye içinde sonuç gelir',
    };
  }

  /** Görseli sil (DB) — S3'ten silme şimdilik atlanıyor */
  async deleteImage(imageId: string, tenantId: string) {
    const image = await this.prisma.receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
    });
    if (!image) throw new NotFoundException('Görsel bulunamadı');

    // DB'den sil (S3'ten silme şimdilik devre dışı — storage.delete metodu yok)
    await this.prisma.receiptImage.delete({ where: { id: imageId } });
    return { deleted: true };
  }

  /** Eşleştirme motorunu çalıştır */
  async runReconciliation(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    const mukellefAdi = this.formatMukellefAdi(session);
    try {
      // ÖNCE: Bozuk OCR belge no'larını dosya adından düzelt (UBL versiyon string'leri gibi)
      // Bu eskiden yüklenen XML'lerde Claude'un yanlış aldığı "TR1.2" gibi değerleri
      // dosya adındaki gerçek belge no ile değiştirir. Yeni reconciliation doğru eşleştirir.
      await this.fixBrokenOcrBelgeNo(sessionId);

      const result = await this.reconciliation.runReconciliation(sessionId);
      await this.pushFeedEvent(tenantId, {
        action: 'reconcile',
        status: 'basarili',
        message: `KDV eşleştirme tamam — ${result.matched} tam · ${result.partial + result.needsReview} incele · ${result.unmatched} hatalı`,
        mukellef: mukellefAdi,
        meta: {
          sessionId,
          period: session.periodLabel,
          type: session.type,
          ...result,
        },
      });
      const reviewCount = Number(result.partial || 0) + Number(result.needsReview || 0);
      const unmatchedCount = Number(result.unmatched || 0);
      const issueCount = reviewCount + unmatchedCount;
      if (issueCount === 0 && Number(result.matched || 0) > 0) {
        await this.prisma.kdvControlSession.update({
          where: { id: sessionId },
          data: { status: 'COMPLETED' },
        });
        await this.pushFeedEvent(tenantId, {
          action: 'session-lock',
          status: 'basarili',
          message: 'KDV kontrolü sorunsuz tamamlandı ve kilitlendi',
          mukellef: mukellefAdi,
          meta: { sessionId, period: session.periodLabel, type: session.type },
        });
        // Auto-lock: lockSession() ile aynı şekilde kdvKontrolEdildi + otomasyon eventi
        if (session.taxpayerId && session.periodLabel) {
          const [yearStr, monthStr] = session.periodLabel.split('/');
          const autoYear = parseInt(yearStr);
          const autoMonth = parseInt(monthStr);
          if (autoYear && autoMonth) {
            await this.prisma.taxpayerMonthlyStatus.upsert({
              where: { taxpayerId_year_month: { taxpayerId: session.taxpayerId, year: autoYear, month: autoMonth } },
              create: { taxpayerId: session.taxpayerId, tenantId, year: autoYear, month: autoMonth, kdvKontrolEdildi: true },
              update: { kdvKontrolEdildi: true },
            });
            if (this.automationEventBus) {
              try {
                const taxpayer = await this.prisma.taxpayer.findUnique({
                  where: { id: session.taxpayerId },
                  select: { id: true, type: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
                });
                const t = taxpayer as any;
                const unvan = t?.type === 'TUZEL_KISI'
                  ? t.companyName || ''
                  : `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim();
                const islemYear = autoMonth === 12 ? autoYear + 1 : autoYear;
                const islemMonth = autoMonth === 12 ? 1 : autoMonth + 1;
                this.automationEventBus.emit('Taxpayer.KdvKontrolKilitlendi', {
                  tenantId,
                  taxpayerId: session.taxpayerId,
                  taxpayerUnvan: unvan || '(isim yok)',
                  taxpayerVkn: t?.taxNumber ?? '',
                  year: autoYear,
                  month: autoMonth,
                  beyannamePeriodLabel: `${autoYear}-${String(autoMonth).padStart(2, '0')}`,
                  islemYear,
                  islemMonth,
                  islemPeriodLabel: `${islemYear}-${String(islemMonth).padStart(2, '0')}`,
                  sessionId: session.id,
                  periodLabel: session.periodLabel,
                });
              } catch (err: any) {
                this.logger.warn(`KDV auto-kilitleme event yayını başarısız: ${err.message}`);
              }
            }
          }
        }
      } else {
        await this.prisma.kdvControlSession.update({
          where: { id: sessionId },
          data: { status: 'REVIEWING' },
        });
      }
      // === IN-APP BILDIRIM: KDV_RESULT ===
      try {
        const matchedCount = Number(result.matched || 0);
        const summary = issueCount === 0
          ? `Tum ${matchedCount} kayit sorunsuz eslesti.`
          : `${matchedCount} tam - ${reviewCount} inceleme - ${unmatchedCount} hatali.`;
        await this.notifications.createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.KDV_RESULT,
          title: `KDV kontrol: ${mukellefAdi || 'mukellef'} (${session.periodLabel})`,
          body: summary,
          metadata: {
            sessionId,
            taxpayerId: session.taxpayerId,
            taxpayerName: mukellefAdi,
            period: session.periodLabel,
            type: session.type,
            matched: matchedCount,
            partial: result.partial,
            needsReview: result.needsReview,
            unmatched: result.unmatched,
            link: `/panel/kdv-kontrol/${sessionId}`,
          },
          dedupeKey: `kdv-result:${sessionId}`,
          dedupeWindowMin: 30,
        });
      } catch (e) {
        this.logger.warn(`KDV_RESULT notif failed: ${(e as Error).message}`);
      }

      // === IN-APP BILDIRIM: KDV_RESULT ===
      try {
        const matchedCount = Number(result.matched || 0);
        const summary = issueCount === 0
          ? `Tum ${matchedCount} kayit sorunsuz eslesti.`
          : `${matchedCount} tam - ${reviewCount} inceleme - ${unmatchedCount} hatali.`;
        await this.notifications.createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.KDV_RESULT,
          title: `KDV kontrol: ${mukellefAdi || 'mukellef'} (${session.periodLabel})`,
          body: summary,
          metadata: {
            sessionId,
            taxpayerId: session.taxpayerId,
            taxpayerName: mukellefAdi,
            period: session.periodLabel,
            type: session.type,
            matched: matchedCount,
            partial: result.partial,
            needsReview: result.needsReview,
            unmatched: result.unmatched,
            link: `/panel/kdv-kontrol/${sessionId}`,
          },
          dedupeKey: `kdv-result:${sessionId}`,
          dedupeWindowMin: 30,
        });
      } catch (e) {
        this.logger.warn(`KDV_RESULT notif failed: ${(e as Error).message}`);
      }

      // === IN-APP BILDIRIM: KDV_RESULT ===
      try {
        const matchedCount = Number(result.matched || 0);
        const summary = issueCount === 0
          ? `Tum ${matchedCount} kayit sorunsuz eslesti.`
          : `${matchedCount} tam - ${reviewCount} inceleme - ${unmatchedCount} hatali.`;
        await this.notifications.createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.KDV_RESULT,
          title: `KDV kontrol: ${mukellefAdi || 'mukellef'} (${session.periodLabel})`,
          body: summary,
          metadata: {
            sessionId,
            taxpayerId: session.taxpayerId,
            taxpayerName: mukellefAdi,
            period: session.periodLabel,
            type: session.type,
            matched: matchedCount,
            partial: result.partial,
            needsReview: result.needsReview,
            unmatched: result.unmatched,
            link: `/panel/kdv-kontrol/${sessionId}`,
          },
          dedupeKey: `kdv-result:${sessionId}`,
          dedupeWindowMin: 30,
        });
      } catch (e) {
        this.logger.warn(`KDV_RESULT notif failed: ${(e as Error).message}`);
      }

      if (issueCount > 0) {
        await this.pushMorenAiAlert(tenantId, {
          title: 'MOREN AI uyarısı: KDV kontrol',
          body: `${mukellefAdi || 'Seçili mükellef'} için ${session.periodLabel} KDV kontrolünde ${issueCount} kayıt dikkat istiyor: ${reviewCount} incele, ${unmatchedCount} hatalı.`,
          severity: unmatchedCount > 0 ? 'critical' : 'warning',
          module: 'kdv-control',
          metadata: {
            sessionId,
            taxpayerId: session.taxpayerId,
            taxpayerName: mukellefAdi,
            period: session.periodLabel,
            type: session.type,
            matched: result.matched,
            partial: result.partial,
            needsReview: result.needsReview,
            unmatched: result.unmatched,
          },
        });
      }

      // === KDV_RESULT: Reconciliation sonucunu bildir ===
      // Issue varsa veya yoksa her durumda kullaniciya "sonuc hazir" bildirimi
      const matchedCount = Number(result.matched || 0);
      const emoji = issueCount === 0 ? '✅' : (unmatchedCount > 0 ? '❌' : '⚠️');
      const summary = issueCount === 0
        ? `Tüm ${matchedCount} kayıt sorunsuz eşleşti.`
        : `${matchedCount} tam · ${reviewCount} inceleme · ${unmatchedCount} hatalı.`;
      await this.notifications.createForTenant({
        tenantId,
        type: NOTIFICATION_TYPES.KDV_RESULT,
        title: `${emoji} KDV kontrol: ${mukellefAdi || 'mükellef'} (${session.periodLabel})`,
        body: summary,
        metadata: {
          sessionId,
          taxpayerId: session.taxpayerId,
          taxpayerName: mukellefAdi,
          period: session.periodLabel,
          type: session.type,
          matched: matchedCount,
          partial: result.partial,
          needsReview: result.needsReview,
          unmatched: result.unmatched,
          link: `/panel/kdv-kontrol/${sessionId}`,
        },
        dedupeKey: `kdv-result:${sessionId}`,
        dedupeWindowMin: 30,
      }).catch((e) => {
        this.logger.warn(`KDV_RESULT notif failed: ${(e as Error).message}`);
      });

      return result;
    } catch (err) {
      await this.pushFeedEvent(tenantId, {
        action: 'reconcile',
        status: 'hata',
        message: `KDV eşleştirme hatası: ${(err as Error).message}`,
        mukellef: mukellefAdi,
      });
      throw err;
    }
  }

  /** Mükellef adını feed event için formatla (şirket / ad+soyad / VKN sırası) */
  private formatMukellefAdi(session: any): string | undefined {
    const t = session?.taxpayer;
    if (!t) return undefined;
    if (t.companyName) return t.companyName;
    const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ');
    if (fullName) return fullName;
    return t.taxNumber || undefined;
  }

  private async pushMorenAiAlert(
    tenantId: string,
    args: {
      title: string;
      body: string;
      severity: 'warning' | 'critical';
      module: string;
      metadata?: any;
    },
  ): Promise<void> {
    try {
      await (this.prisma as any).notification.create({
        data: {
          tenantId,
          userId: null,
          title: args.title,
          body: args.body,
          type: 'MOREN_AI_ALERT',
          metadata: {
            source: 'moren-ai',
            module: args.module,
            severity: args.severity,
            ...(args.metadata || {}),
          },
        },
      });
    } catch (err) {
      this.logger.warn(`MOREN AI alert push failed: ${(err as Error).message}`);
    }
  }

  /**
   * ReceiptImage kayıtlarındaki bozuk belge no'ları tespit edip dosya adından düzeltir.
   * Bozuk = UBL versiyon string'leri (TR1.2, TR1.0, UBL-2.1, TICARIFATURA gibi).
   * Eski Claude OCR bunları belge no olarak kaydetmişti; dosya adından gerçek belge no'yu al.
   * Idempotent — her reconcile çağrısında çalışabilir, zaten düzgün olan kayıtlara dokunmaz.
   */
  private async fixBrokenOcrBelgeNo(sessionId: string): Promise<number> {
    const images = await this.prisma.receiptImage.findMany({
      where: { sessionId },
      select: {
        id: true,
        originalName: true,
        ocrBelgeNo: true,
        confirmedBelgeNo: true,
        isManuallyConfirmed: true,
      },
    });

    // Belge no bozuk sayılan pattern'ler
    const isBrokenBelgeNo = (bn: string | null | undefined): boolean => {
      if (!bn) return false;
      const s = bn.toUpperCase().trim();
      // UBL versiyon: TR1.2, TR1.0, UBL-2.1
      if (/^(TR|UBL)[\d.\-_]+$/.test(s)) return true;
      // Senaryo/profile id'leri
      if (['TICARIFATURA', 'TEMELFATURA', 'TICARI', 'EARSIVFATURA'].includes(s)) return true;
      // 1-2 karakterlik saçma değerler
      if (s.length <= 2) return true;
      return false;
    };

    const extractFromFilename = (fn: string | null | undefined): string | null => {
      if (!fn) return null;
      const base = fn.replace(/\.[^/.]+$/, '').trim();
      // 3 harf + 4 rakam (yıl) + 6-12 rakam (sıra) — e-fatura pattern
      if (/^[A-Z]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
      // Harfli-rakamlı orta uzunluk
      if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
      // Sadece rakam (ÖKC fiş, Z raporu)
      if (/^\d{3,8}$/.test(base)) return base;
      return null;
    };

    let fixedCount = 0;
    for (const img of images) {
      // Manuel teyit edilmişse dokunma
      if (img.isManuallyConfirmed && img.confirmedBelgeNo) continue;
      if (!isBrokenBelgeNo(img.ocrBelgeNo)) continue;

      const candidateFromFilename = extractFromFilename(img.originalName);
      if (!candidateFromFilename) continue;

      await this.prisma.receiptImage.update({
        where: { id: img.id },
        data: {
          ocrBelgeNo: candidateFromFilename,
          ocrEngine: 'filename-corrected',
          // Confidence'ı orta-yüksek yap, filename trustable
          ocrBelgeNoConfidence: 0.85,
        },
      });
      fixedCount++;
    }

    if (fixedCount > 0) {
      this.logger.log(`fixBrokenOcrBelgeNo: ${fixedCount} görselin belge no'su dosya adından düzeltildi`);
    }
    return fixedCount;
  }

  /** Eşleştirme sonuçları */
  async getResults(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    const results = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: {
        kdvRecord: true,
        image: true,
      },
      orderBy: [{ status: 'asc' }, { matchScore: 'desc' }],
    });
    return results.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));
  }

  /**
   * Eşleştirme sonuçlarını Excel olarak dışa aktar — SONUÇ formatı.
   * `autoArchive=true` (default) ise indirilen dosya otomatik olarak
   * `kdvControlOutput` tablosuna arşivlenir.
   */
  async exportResultsToExcel(
    sessionId: string,
    tenantId: string,
    opts: { autoArchive?: boolean; createdBy?: string } = {},
  ): Promise<Buffer> {
    const session = await this.findSession(sessionId, tenantId);
    
    const rawResults = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: { kdvRecord: true, image: true },
      orderBy: [
        { status: 'asc' },
        // Aynı status içinde Luca tarihine göre sırala — muhasebeci aynı sırayı her açışta görsün
        { kdvRecord: { belgeDate: 'asc' } },
        { matchScore: 'desc' },
      ],
    });
    const results = rawResults.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));

    // ExcelJS + path + fs üstte static import ediliyor — webpack bundling
    // sorunlarını önlemek için dynamic import yerine static kullan.

    // Mükellef + dönem bilgileri
    const mukellefName = session.taxpayer
      ? session.taxpayer.companyName ||
        `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()
      : 'Mükellef yok';
    const taxNo = session.taxpayer?.taxNumber || '—';
    const typeLabel = this.kdvTypeLabel(session.type);
    const periodLabel = session.periodLabel || '—';
    const now = new Date();
    const tarihStr = now.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
    const seriUyarilari = await this.checkBelgeSeriContinuity(session, sessionId, tenantId);

    // ─── Sayaç semantiği ─────────────────────────────────
    // MATCHED       → otomatik tam eşleşme
    // CONFIRMED     → kullanıcı "İncele"den onayladı (tam eşleşme grubunda say)
    // PARTIAL_MATCH → kısmi eşleşme (incele)
    // NEEDS_REVIEW  → düşük güvenli eşleşme (incele)
    // UNMATCHED     → hiç eşleşme yok (orphan, hatalı)
    // REJECTED      → kullanıcı reddetti (hatalı)
    const isMatchedStatus = (s: string) => s === 'MATCHED' || s === 'CONFIRMED';
    const isReviewStatus = (s: string) => s === 'PARTIAL_MATCH' || s === 'NEEDS_REVIEW';
    const isErrorStatus = (s: string) => s === 'UNMATCHED' || s === 'REJECTED';
    const matchedCount = results.filter((r) => isMatchedStatus(r.status)).length;
    const partialCount = results.filter((r) => isReviewStatus(r.status)).length;
    const unmatchedCount = results.filter((r) => isErrorStatus(r.status)).length;

    const parseKdv = (v: any): number => {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const s = String(v).trim();
      const hasDot = s.includes('.');
      const hasComma = s.includes(',');
      let cleaned: string;
      if (hasDot && hasComma) {
        cleaned = s.lastIndexOf(',') > s.lastIndexOf('.')
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
      } else if (hasComma) {
        cleaned = s.replace(',', '.');
      } else if (hasDot) {
        const parts = s.split('.');
        const last = parts[parts.length - 1] || '';
        const looksLikeThousands =
          parts.length > 1 &&
          last.length === 3 &&
          parts.every((part, idx) => idx === 0 ? /^\d{1,3}$/.test(part) : /^\d{3}$/.test(part));
        cleaned = looksLikeThousands ? s.replace(/\./g, '') : s;
      } else {
        cleaned = s;
      }
      const n = parseFloat(cleaned.replace(/[^\d.\-]/g, ''));
      // Math.abs KALDIRILDI — iptal/iade faturaları negatif olabilir, işaret korunsun
      return Number.isFinite(n) ? n : 0;
    };
    const inferRecordRate = (record: any): number | null => {
      if (!record) return null;
      if (record.kdvOrani != null) {
        const explicit = Number(record.kdvOrani);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
      }
      const raw = record.rawData || {};
      const source = [
        record.karsiTaraf,
        record.aciklama,
        raw['HESAP ADI'],
        raw.hesapAdi,
        raw.accountName,
        raw['AÇIKLAMA'],
      ].filter(Boolean).join(' ');
      const match = source.match(/%\s*(\d{1,2}(?:[,.]\d{1,2})?)/);
      if (!match) return null;
      const parsed = parseKdv(match[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    results.sort(compareKdvExportRows(results, inferRecordRate));

    // Özet toplamlar aynı imageId'yi tek kez sayarak çift sayımı önler.
    // Detay satırında fan-out varsa her Luca satırının karşısında kendi payı gösterilir.
    /** Bir result satırında kullanıcıya gösterilecek fatura KDV'si */
    const getFaturaKdvValue = (r: any, forDetailRow = false): number => {
      if (!r.image || !r.imageId) return 0;
      const ocrTotal = parseKdv(r.image.confirmedKdvTutari || r.image.ocrKdvTutari);
      if (ocrTotal <= 0) return 0;
      const luca = r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0;
      const fanOutCount = results.filter((x: any) => x.imageId === r.imageId && x.kdvRecordId).length;
      if (forDetailRow && fanOutCount > 1 && isMatchedStatus(r.status)) {
        return Number.isFinite(luca) ? luca : 0;
      }
      if (luca <= 0) return ocrTotal;
      if (forDetailRow && isMatchedStatus(r.status)) {
        return luca;
      }

      const isSatis = session.type === 'KDV_391' || session.type === 'ISLETME_GELIR';
      if (forDetailRow && fanOutCount > 1) {
        const rawBreakdown = r.image.confirmedKdvBreakdown ?? r.image.ocrKdvBreakdown;
        const recordRate = inferRecordRate(r.kdvRecord);
        if (Array.isArray(rawBreakdown) && recordRate != null && Number.isFinite(recordRate)) {
          const rateMatch = rawBreakdown.find((item: any) => {
            const itemRate = Number(item?.oran);
            return Number.isFinite(itemRate) && Math.abs(itemRate - recordRate) < 0.5;
          });
          const componentKdv = rateMatch ? parseKdv(rateMatch.tutar) : 0;
          if (componentKdv > 0 && Math.abs(componentKdv - luca) / (luca || 1) < 0.01) {
            return componentKdv;
          }
        }

        if (isMatchedStatus(r.status)) {
          return luca;
        }
      }
      const reasonText = Array.isArray(r.mismatchReasons) ? r.mismatchReasons.join(' ') : '';
      if (!isSatis && /Alış tevkifat bileşen eşleşmesi|Alis tevkifat bilesen/i.test(reasonText)) {
        return luca;
      }
      const tevkifat = parseKdv(r.image.confirmedKdvTevkifat || r.image.ocrKdvTevkifat);
      const candidates = [
        ocrTotal,
        ...(isSatis && tevkifat > 0 && ocrTotal > tevkifat ? [ocrTotal - tevkifat] : []),
      ].filter((n) => Number.isFinite(n) && n > 0);

      const best = candidates.sort((a, b) => Math.abs(a - luca) - Math.abs(b - luca))[0] ?? ocrTotal;
      const bestDiff = Math.abs(best - luca) / (luca || 1);
      return bestDiff < 0.01 ? best : ocrTotal;
    };
    /** Özetlerde aynı imageId birden fazla Luca satırına fan-out olduysa tek say. */
    const sumUniqueImageKdv = (rows: any[]): number => {
      const byImage = new Map<string, any[]>();
      for (const r of rows) {
        if (!r.image || !r.imageId) continue;
        byImage.set(r.imageId, [...(byImage.get(r.imageId) || []), r]);
      }
      let total = 0;
      for (const group of byImage.values()) {
        const detailSum = group
          .filter((r: any) => r.kdvRecord && isMatchedStatus(r.status))
          .reduce((s, r: any) => s + getFaturaKdvValue(r, true), 0);
        total += detailSum > 0 ? detailSum : getFaturaKdvValue(group[0]);
      }
      return total;
    };

    // Özet için 3 ayrı grup — kullanıcının "fark" kafa karışıklığını çözer
    const sumLucaAll = results.reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    // sumOcrAll: orijinal OCR toplamı (her image bir kez sayılır — fan-out çift saymaz)
    const sumOcrAll = sumUniqueImageKdv(results as any[]);
    // Sadece eşleşen tutarlar: MATCHED + CONFIRMED (kullanıcının onayladıkları)
    const sumLucaMatched = results
      .filter((r: any) => isMatchedStatus(r.status))
      .reduce((s, r: any) => s + (r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : 0), 0);
    // sumOcrMatched: orijinal OCR toplamı üzerinden — fan-out çift saymaz
    const matchedRows = results.filter((r: any) => isMatchedStatus(r.status)) as any[];
    const sumOcrMatched = sumUniqueImageKdv(matchedRows);
    const fmtTl = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    const zeroKurusTolerance = (n: number) => Math.abs(Number(n.toFixed(2))) <= 0.01 ? 0 : n;

    // ═══════════════ ExcelJS ile oluştur ═══════════════
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Müşavirlik';
    wb.created = now;
    const ws = wb.addWorksheet('KDV Kontrol', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Moren altın marka rengi
    const GOLD = 'FFB8A06F';
    const DARK = 'FF1A1916';
    const GREEN_BG = 'FFDFF5E3';
    const GREEN_TEXT = 'FF15803D';
    const YELLOW_BG = 'FFFEF3C7';
    const YELLOW_TEXT = 'FFB45309';
    const RED_BG = 'FFFEE2E2';
    const RED_TEXT = 'FFB91C1C';
    const HEADER_BG = 'FF2E2B26';
    const ALT_BG = 'FFF9FAFB';
    const TABLE_BORDER = 'FF6B7280';
    const TABLE_BORDER_LIGHT = 'FFB8C0CA';

    // Sütun tanımı (genişlikler + number formatları veri satırları için)
    // 10 sütun: # · Luca Tarihi · Luca Evrak · Luca KDV · Fatura Tarihi · Fatura Belge · Fatura KDV · Fark · Durum · Açıklama
    ws.columns = [
      { width: 6 },
      { width: 16 },
      { width: 26 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 16 },
      { width: 26 },
      { width: 16, style: { numFmt: '#,##0.00 "₺"' } },
      { width: 14, style: { numFmt: '#,##0.00;[Red]-#,##0.00;0.00' } },
      { width: 16 },
      { width: 72 },
      { width: 14 },
      { width: 30 },
      { width: 42 },
    ];

    // ─── MOREN LOGOLU BAŞLIK ─────────────────────────────
    try {
      const logoPath = path.join(__dirname, '..', 'assets', 'moren-logo.png');
      if (fs.existsSync(logoPath)) {
        const logoId = wb.addImage({
          filename: logoPath,
          extension: 'png',
        });
        // Sol üste yerleştir (A1–B3 bölgesi, ~180×80 px)
        ws.addImage(logoId, {
          tl: { col: 0.15, row: 0.15 },
          ext: { width: 140, height: 80 },
        });
      }
    } catch (e: any) {
      this.logger.warn(`Moren logo Excel'e eklenemedi: ${e?.message}`);
    }

    ws.mergeCells('A1:M1');
    const r1 = ws.getCell('A1');
    r1.value = 'MOREN MALİ MÜŞAVİRLİK';
    r1.font = { name: 'Calibri', size: 22, bold: true, color: { argb: GOLD } };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.getRow(1).height = 50;

    ws.mergeCells('A2:M2');
    const r2 = ws.getCell('A2');
    r2.value = 'KDV Kontrol Raporu';
    r2.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    r2.alignment = { horizontal: 'center' };
    r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    ws.getRow(2).height = 22;

    // Boş satır
    ws.getRow(3).height = 8;

    // Bilgi bloğu (2 kolonlu) — Label A+B merge (dar A sığmıyor), Value C+D merge
    const infoLabelStyle = { font: { bold: true, color: { argb: 'FF666666' }, size: 10 } };
    const infoValueStyle = { font: { color: { argb: 'FF1A1916' }, size: 11 } };
    const setInfo = (r: number, label1: string, val1: string, label2?: string, val2?: string) => {
      ws.mergeCells(`A${r}:B${r}`);
      const c1 = ws.getCell(`A${r}`);
      c1.value = label1; c1.font = infoLabelStyle.font;
      c1.alignment = { horizontal: 'left', vertical: 'middle' };
      ws.mergeCells(`C${r}:D${r}`);
      const c2 = ws.getCell(`C${r}`);
      c2.value = val1; c2.font = infoValueStyle.font;
      c2.alignment = { horizontal: 'left', vertical: 'middle' };
      if (label2) {
        const c3 = ws.getCell(`E${r}`);
        c3.value = label2; c3.font = infoLabelStyle.font;
        c3.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.mergeCells(`F${r}:M${r}`);
        const c4 = ws.getCell(`F${r}`);
        c4.value = val2; c4.font = infoValueStyle.font;
        c4.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    };
    setInfo(4, 'Mükellef',     mukellefName,  'Dönem',        periodLabel);
    setInfo(5, 'Vergi No',     taxNo,         'Kontrol Türü', typeLabel);
    setInfo(6, 'Rapor Tarihi', tarihStr);

    ws.getRow(7).height = 8;

    // ÖZET başlığı
    ws.mergeCells('A8:M8');
    const rOz = ws.getCell('A8');
    rOz.value = 'ÖZET';
    rOz.font = { bold: true, size: 12, color: { argb: GOLD } };
    rOz.alignment = { horizontal: 'center' };
    rOz.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F0E8' } };
    ws.getRow(8).height = 20;

    const setSummary = (r: number, l1: string, v1: any, l2?: string, v2?: any) => {
      ws.mergeCells(`A${r}:C${r}`);
      const c1 = ws.getCell(`A${r}`);
      c1.value = l1; c1.font = { bold: true, color: { argb: 'FF444444' }, size: 10 };
      c1.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      const c2 = ws.getCell(`D${r}`);
      c2.value = v1; c2.font = { size: 11 };
      c2.alignment = { horizontal: 'right', vertical: 'middle' };
      if (l2) {
        ws.mergeCells(`E${r}:G${r}`);
        const c3 = ws.getCell(`E${r}`);
        c3.value = l2; c3.font = { bold: true, color: { argb: 'FF444444' }, size: 10 };
        c3.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        ws.mergeCells(`H${r}:I${r}`);
        const c4 = ws.getCell(`H${r}`);
        c4.value = v2; c4.font = { size: 11 };
        c4.alignment = { horizontal: 'right', vertical: 'middle' };
      }
      ws.getRow(r).height = 22;
      for (let col = 1; col <= 13; col++) {
        const cell = ws.getCell(r, col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      }
    };
    setSummary(9,  'Toplam Satır',                       results.length,                                                      'Luca (tüm satırlar)',         fmtTl(sumLucaAll));
    setSummary(10, '✓ Eşleşen (otomatik + onaylanan)',   matchedCount,                                                         'Fatura OCR (satır payı)',     fmtTl(sumOcrAll));
    setSummary(11, '⚠ Kısmi / İnceleme',                 partialCount,                                                         'Luca (sadece eşleşen)',       fmtTl(sumLucaMatched));
    setSummary(12, '✗ Hatalı (orphan + reddedilen)',     unmatchedCount,                                                       'Fatura (eşleşen satır payı)', fmtTl(sumOcrMatched));
    setSummary(13, 'Eşleşme Oranı',                      `%${Math.round((matchedCount / Math.max(results.length, 1)) * 100)}`, 'Eşleşenler farkı',            fmtTl(zeroKurusTolerance(sumLucaMatched - sumOcrMatched)));

    ws.getRow(14).height = 8;

    // Tablo başlığı (15. satır)
    const headerRow = ws.getRow(15);
    headerRow.values = [
      '#', 'LUCA TARİHİ', 'LUCA EVRAK NO', 'LUCA KDV (₺)',
      'FATURA TARİHİ', 'FATURA BELGE NO', 'FATURA KDV PAYI (₺)', 'FARK', 'DURUM', 'AÇIKLAMA / UYUMSUZLUK',
    ];
    headerRow.getCell(11).value = 'İÇERİK RİSKİ';
    headerRow.getCell(12).value = 'ÖNERİLEN İŞLEM';
    headerRow.getCell(13).value = 'İÇERİK YORUMU';
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // Veri satırları (16+)
    results.forEach((r: any, idx) => {
      const rowNum = 16 + idx;
      const row = ws.getRow(rowNum);

      const lucaTarih = r.kdvRecord?.belgeDate
        ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR')
        : '—';
      const lucaEvrak = r.kdvRecord?.belgeNo || '—';
      const lucaKdv = r.kdvRecord?.kdvTutari ? Number(r.kdvRecord.kdvTutari) : null;

      const faturaTarih = r.image?.confirmedDate || r.image?.ocrDate || '—';
      const faturaBelgeNo = r.image?.confirmedBelgeNo || r.image?.ocrBelgeNo || '—';
      // Fan-out detayında aynı görsel toplamını her satıra yazma; satır payını göster.
      const faturaKdvNum = getFaturaKdvValue(r, true);
      const zeroShareMatched =
        faturaKdvNum === 0 &&
        lucaKdv === 0 &&
        !!r.image &&
        !!r.kdvRecord &&
        isMatchedStatus(r.status);
      const faturaKdv = faturaKdvNum !== 0 ? faturaKdvNum : zeroShareMatched ? 0 : null;
      const hasCodexDiff = lucaKdv != null && faturaKdv != null;
      const rawCodexDiff = hasCodexDiff ? Number((lucaKdv - faturaKdvNum).toFixed(2)) : 0;
      const codexDiff = zeroKurusTolerance(rawCodexDiff);
      const codexValue = hasCodexDiff
        ? { formula: `IF(OR(D${rowNum}="",G${rowNum}=""),"",IF(ABS(D${rowNum}-G${rowNum})<=0.011,0,D${rowNum}-G${rowNum}))`, result: codexDiff }
        : null;

      let durum = '';
      if (r.status === 'MATCHED') durum = '✓ EŞLEŞTİ';
      else if (r.status === 'CONFIRMED') durum = '✓ ONAYLANDI';
      else if (r.status === 'PARTIAL_MATCH') durum = '⚠ KISMİ';
      else if (r.status === 'NEEDS_REVIEW') durum = '⚠ İNCELE';
      else if (r.status === 'UNMATCHED') durum = '✗ EŞLEŞMEDİ';
      else if (r.status === 'REJECTED') durum = '✗ REDDEDİLDİ';
      else durum = r.status;

      // Açıklama: orphan durumda referans no ekle ki muhasebeci hangi tarafı
      // arayacağını bilsin. ONAYLANDI durumda notes da raporda görünsün.
      const noteSuffix = r.notes ? ` · Not: ${r.notes}` : '';
      const formattedReasons = this.formatKdvExportReasons(r.mismatchReasons || []);
      const aciklama = !r.image && r.kdvRecord
        ? (lucaEvrak === '—'
            ? `Luca satırında belge no/tarih yok; görselle eşleşemedi (${fmtTl(Number(r.kdvRecord.kdvTutari || 0))})`
            : `Fatura görseli yok: ${lucaEvrak} (${fmtTl(Number(r.kdvRecord.kdvTutari || 0))})`)
        : !r.kdvRecord && r.image
          ? `Luca kaydı yok: ${faturaBelgeNo}`
          : (formattedReasons || (isMatchedStatus(r.status) ? 'Tam eşleşme' : 'İncele')) + noteSuffix;

      const contentAudit = this.formatContentAuditForExport(r.image);

      row.values = [
        idx + 1, lucaTarih, lucaEvrak, lucaKdv,
        faturaTarih, faturaBelgeNo, faturaKdv, codexValue, durum, aciklama,
        contentAudit.risk, contentAudit.suggestion, contentAudit.summary,
      ];
      if (contentAudit.comment) {
        (ws.getCell(rowNum, 13) as any).note = contentAudit.comment;
      }

      // Duruma göre renk
      let rowBg = idx % 2 === 0 ? 'FFFFFFFF' : ALT_BG;
      let statusText = 'FF1A1916';
      let statusBold = false;
      if (r.status === 'MATCHED' || r.status === 'CONFIRMED') {
        rowBg = GREEN_BG; statusText = GREEN_TEXT; statusBold = true;
      } else if (r.status === 'PARTIAL_MATCH' || r.status === 'NEEDS_REVIEW') {
        rowBg = YELLOW_BG; statusText = YELLOW_TEXT; statusBold = true;
      } else if (r.status === 'UNMATCHED' || r.status === 'REJECTED') {
        rowBg = RED_BG; statusText = RED_TEXT; statusBold = true;
      }

      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const isStatus = colNum === 9;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.font = {
          size: 10,
          color: { argb: isStatus ? statusText : 'FF1A1916' },
          bold: isStatus && statusBold,
        };
        const rightAlign = colNum === 4 || colNum === 7 || colNum === 8;
        const centerAlign = colNum === 1 || colNum === 9;
        cell.alignment = {
          horizontal: rightAlign ? 'right' : centerAlign ? 'center' : 'left',
          vertical: 'middle',
          wrapText: colNum === 10 || colNum === 12 || colNum === 13,
        };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
    });

    if (seriUyarilari.length > 0) {
      const startRow = 17 + results.length;
      ws.mergeCells(`A${startRow}:M${startRow}`);
      const title = ws.getCell(`A${startRow}`);
      title.value = 'SATIŞ FATURA SERİ KONTROLÜ';
      title.font = { bold: true, size: 12, color: { argb: YELLOW_TEXT } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_BG } };
      title.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };

      seriUyarilari.forEach((u, idx) => {
        const rowNum = startRow + idx + 1;
        ws.mergeCells(`A${rowNum}:B${rowNum}`);
        ws.mergeCells(`C${rowNum}:M${rowNum}`);
        const tip = ws.getCell(`A${rowNum}`);
        const mesaj = ws.getCell(`C${rowNum}`);
        tip.value = u.tip === 'cross_break' ? 'Önceki dönem kopukluğu' : 'Oturum içi eksik seri';
        mesaj.value = u.mesaj;
        ws.getRow(rowNum).height = 30;
        [tip, mesaj].forEach((cell, cellIdx) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFF8E1' : 'FFFFFBEB' } };
          cell.font = { size: 10, color: { argb: cellIdx === 0 ? YELLOW_TEXT : 'FF1A1916' }, bold: cellIdx === 0 };
          cell.alignment = { horizontal: cellIdx === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
        });
      });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    // Arşive kaydet (fiş yazdırmadaki gibi — geriye dönük erişim)
    if (opts.autoArchive !== false) {
      try {
        const session = await this.prisma.kdvControlSession.findUnique({
          where: { id: sessionId },
          include: { taxpayer: true },
        });
        // Excel özet ile aynı kategori mantığı kullan — istatistikler tutarlı olsun
        const matchedCount = results.filter((r) => r.status === 'MATCHED' || r.status === 'CONFIRMED').length;
        const partialCount = results.filter((r) => r.status === 'PARTIAL_MATCH' || r.status === 'NEEDS_REVIEW').length;
        const unmatchedCount = results.filter((r) => r.status === 'UNMATCHED' || r.status === 'REJECTED').length;
        const mukellefName = session?.taxpayer
          ? session.taxpayer.companyName ||
            `${session.taxpayer.firstName ?? ''} ${session.taxpayer.lastName ?? ''}`.trim()
          : null;

        const filename = `kdv-kontrol-${session?.periodLabel?.replace('/', '-') || sessionId}-${new Date().toISOString().slice(0, 10)}.xlsx`;

        await (this.prisma as any).kdvControlOutput.create({
          data: {
            tenantId,
            sessionId,
            taxpayerId: session?.taxpayerId || null,
            mukellefName,
            donem: session?.periodLabel || null,
            tip: session?.type || null,
            matchedCount,
            partialCount,
            unmatchedCount,
            totalRecords: results.filter((r: any) => r.kdvRecord && !isAggregateLucaRecord(r.kdvRecord)).length,
            totalImages: await this.prisma.receiptImage.count({ where: { sessionId } }),
            filename,
            fileBytes: buffer,
            fileSize: buffer.length,
            createdBy: opts.createdBy || null,
          },
        });
      } catch (e: any) {
        this.logger.warn(`KDV çıktı arşive yazılamadı: ${e?.message}`);
      }
    }

    return buffer;
  }

  private formatContentAuditForExport(image: any): { risk: string; suggestion: string; summary: string; comment: string } {
    if (!image) return { risk: '—', suggestion: '—', summary: '—', comment: '' };
    const status = image.contentAuditStatus;
    const riskMap: Record<string, string> = {
      UYGUN: 'Uygun',
      KONTROL_ET: 'Kontrol et',
      RISKLI: 'Riskli',
      ISLENMEMELI: 'İşlenmemeli',
    };
    const risk = status === 'PROCESSING'
      ? 'İşleniyor'
      : status === 'FAILED'
        ? 'Hata'
        : riskMap[image.contentAuditRisk] || (status ? 'Kontrol et' : 'Denetlenmedi');
    const rawSuggestion = image.contentAuditSuggestion || (status ? 'Muhasebeci kontrolü önerilir' : 'İçerik denetimi yapılmadı');
    const rawSummary = image.contentAuditSummary || (status ? 'Yorum yok' : 'İçerik denetimi yapılmadı');
    const suggestion = this.stripContentAuditKdvArithmeticNoise(rawSuggestion) || 'Muhasebeci kontrolü önerilir';
    const summary = this.stripContentAuditKdvArithmeticNoise(rawSummary) || 'Yorum yok';
    const findings = (Array.isArray(image.contentAuditFindings) ? image.contentAuditFindings : [])
      .filter((f: any) => !this.isContentAuditKdvArithmeticNoise(`${f?.title || ''} ${f?.detail || ''}`));
    const model = String(image.contentAuditModel || '');
    const isProviderFallback = /^rule-fallback/i.test(model);

    const visibleSuggestion =
      isProviderFallback ? 'AI yok; kural denetimi'
      : risk === 'Uygun' ? 'Normal kayıt'
      : risk === 'Kontrol et' ? 'Kontrol et; ayrıntı notta'
      : risk === 'Riskli' ? 'Detaylı incele; ayrıntı notta'
      : risk === 'İşlenmemeli' ? 'İşleme alma; ayrıntı notta'
      : this.compactContentAuditText(suggestion, 70);
    const visibleSummary =
      isProviderFallback ? 'Kural tabanlı ön denetim'
      : risk === 'Uygun' ? 'Faaliyetle uyumlu görünüyor'
      : risk === 'Kontrol et' ? 'Ayrıntı hücre notunda'
      : this.compactContentAuditText(summary, 90);
    const comment = [
      isProviderFallback ? 'Not: AI servisi kullanılamadığı için içerik denetimi kural tabanlı fallback ile yapılmıştır.' : '',
      summary && summary !== visibleSummary ? `Özet: ${summary}` : '',
      suggestion && suggestion !== visibleSuggestion ? `Öneri: ${suggestion}` : '',
      ...findings.map((f: any, idx: number) => `${idx + 1}. ${f?.title || 'Bulgu'}: ${f?.detail || ''}`),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
    return { risk, suggestion: visibleSuggestion, summary: visibleSummary, comment };
  }

  private compactContentAuditText(value: any, max = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }

  private formatKdvExportReasons(reasons: string[]): string {
    const cleaned = (reasons || [])
      .filter(Boolean)
      .filter((r) => !/^VKN\/TCKN tam eşleşti/i.test(r))
      .filter((r) => !/^Satıcı uyumsuz/i.test(r))
      .map((r) => {
        if (/KDV tutar uyumsuz/i.test(r)) return r.replace(/^KDV tutar uyumsuz:\s*/i, 'KDV farklı: ');
        if (/Görselden KDV tutarı okunamadı/i.test(r)) return 'Faturadan KDV okunamadı';
        if (/Belge no/i.test(r) && /uyumsuz/i.test(r)) return 'Belge no farklı';
        if (/Tarih/i.test(r) && /uyumsuz/i.test(r)) return 'Tarih farklı';
        if (/Alış tevkifat (eşleşmesi|bileşen eşleşmesi)/i.test(r)) return 'Tevkifatlı alış eşleşti';
        return r;
      });

    return Array.from(new Set(cleaned)).slice(0, 2).join(' · ');
  }

  // ============================================================
  // ÇIKTI ARŞİVİ (fiş yazdırmadaki gibi)
  // ============================================================

  /** Tenant'a ait tüm KDV kontrol çıktılarını listeler (bayt içeriği hariç). */
  async listOutputs(tenantId: string, limit = 100) {
    return (this.prisma as any).kdvControlOutput.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        taxpayerId: true,
        mukellefName: true,
        donem: true,
        tip: true,
        matchedCount: true,
        partialCount: true,
        unmatchedCount: true,
        totalRecords: true,
        totalImages: true,
        filename: true,
        fileSize: true,
        createdAt: true,
      },
    });
  }

  /** Bir çıktıyı (içeriğiyle birlikte) getirir. */
  async getOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).kdvControlOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return null;
    return rec;
  }

  /** Bir çıktıyı siler. */
  async deleteOutput(tenantId: string, outputId: string) {
    const rec = await (this.prisma as any).kdvControlOutput.findUnique({
      where: { id: outputId },
    });
    if (!rec || rec.tenantId !== tenantId) return { deleted: 0 };
    await (this.prisma as any).kdvControlOutput.delete({ where: { id: outputId } });
    return { deleted: 1 };
  }

  /** Oturum özet istatistikleri (sayaç) */
  async getSessionStats(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);

    const [records, totalImages, results, images] = await Promise.all([
      this.prisma.kdvRecord.findMany({ where: { sessionId } }),
      this.prisma.receiptImage.count({ where: { sessionId } }),
      this.prisma.reconciliationResult.findMany({
        where: { sessionId },
        include: { kdvRecord: true, image: true },
      }),
      this.prisma.receiptImage.findMany({
        where: { sessionId },
        select: {
          ocrEngine: true,
          ocrStatus: true,
          imageHash: true,
          originalName: true,
          contentAuditStatus: true,
          contentAuditRisk: true,
          contentAuditModel: true,
          contentAuditCostUsd: true,
        },
      }),
    ]);
    const totalRecords = records.filter((r) => !isAggregateLucaRecord(r)).length;
    const visibleResults = results.filter((r) => !r.kdvRecord || !isAggregateLucaRecord(r.kdvRecord));
    const matchSummary = this.buildMatchSummary(visibleResults, session.type);

    const needsConfirm = await this.prisma.receiptImage.count({
      where: {
        sessionId,
        ocrStatus: { in: ['LOW_CONFIDENCE', 'NEEDS_REVIEW', 'FAILED'] },
        isManuallyConfirmed: false,
      },
    });

    // v1.36.67: SERİ TAKİBİ — sadece SATIŞ tipi (KDV_391, ISLETME_GELIR) için
    // Aynı oturumdaki belge no'larını numerik sırala, eksik aralık tespit et
    // + bir önceki dönemin son belge no'su ile cross-month süreklilik kontrolü
    const seriUyarilari = await this.checkBelgeSeriContinuity(session, sessionId, tenantId);

    const usageRows = await (this.prisma as any).aiUsageLog.findMany({
      where: {
        tenantId,
        source: 'kdv-ocr',
        sebep: `session:${sessionId}`,
      },
      select: {
        costUsd: true,
        cacheHit: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        model: true,
      },
    });
    const actualCostUsd = usageRows.reduce((s: number, r: any) => s + Number(r.costUsd || 0), 0);
    const actualCacheHits = usageRows.filter((r: any) => r.cacheHit).length;
    const actualPaidCalls = usageRows.filter((r: any) => !r.cacheHit && Number(r.costUsd || 0) > 0).length;
    const actualInputTokens = usageRows.reduce((s: number, r: any) => s + Number(r.inputTokens || 0), 0);
    const actualOutputTokens = usageRows.reduce((s: number, r: any) => s + Number(r.outputTokens || 0), 0);
    const actualCacheReadTokens = usageRows.reduce((s: number, r: any) => s + Number(r.cacheReadTokens || 0), 0);
    const actualCacheWriteTokens = usageRows.reduce((s: number, r: any) => s + Number(r.cacheWriteTokens || 0), 0);

    const engineStats = images.reduce(
      (acc, img) => {
        const engine = img.ocrEngine || '';
        if (/cache/i.test(engine)) acc.cacheHits++;
        else if (/ubl-xml|xml-direct/i.test(engine) || /\.xml$/i.test(img.originalName || '')) acc.xmlParsed++;
        else if (/claude/i.test(engine)) {
          acc.claudeReads++;
          if (/escalation/i.test(engine)) acc.claudeEscalations++;
        }
        else if (/azure/i.test(engine)) acc.azureReads++;
        else if (img.ocrStatus === 'SUCCESS' || img.ocrStatus === 'NEEDS_REVIEW') acc.otherReads++;
        return acc;
      },
      { claudeReads: 0, claudeEscalations: 0, azureReads: 0, cacheHits: 0, xmlParsed: 0, otherReads: 0 },
    );
    const estimatedCostUsd = engineStats.claudeReads * 0.0025;
    const estimatedSavedUsd = (engineStats.cacheHits + engineStats.xmlParsed) * 0.0025;
    const contentAuditStats = images.reduce(
      (acc: any, img: any) => {
        const status = img.contentAuditStatus || 'PENDING';
        const risk = img.contentAuditRisk || '';
        const model = String(img.contentAuditModel || '');
        if (status === 'DONE') {
          acc.done++;
          if (/^rule-fallback/i.test(model)) {
            acc.fallback++;
            acc.providerIssue++;
          } else if (/^rule-based/i.test(model)) {
            acc.ruleBased++;
          } else if (model) {
            acc.ai++;
          }
        }
        else if (status === 'PROCESSING') acc.processing++;
        else if (status === 'FAILED') {
          acc.failed++;
          acc.providerIssue++;
        }
        else if (status === 'SKIPPED') acc.skipped++;
        else acc.pending++;
        if (risk === 'UYGUN') acc.suitable++;
        if (risk === 'KONTROL_ET') acc.review++;
        if (risk === 'RISKLI') acc.risky++;
        if (risk === 'ISLENMEMELI') acc.notAllowed++;
        acc.actualCostUsd += Number(img.contentAuditCostUsd || 0);
        return acc;
      },
      {
        done: 0,
        processing: 0,
        pending: 0,
        failed: 0,
        skipped: 0,
        suitable: 0,
        review: 0,
        risky: 0,
        notAllowed: 0,
        ai: 0,
        ruleBased: 0,
        fallback: 0,
        providerIssue: 0,
        actualCostUsd: 0,
      },
    );

    return {
      totalRecords,
      totalImages,
      matched: matchSummary.matched,
      partialMatch: matchSummary.partialMatch,
      unmatched: matchSummary.unmatched,
      needsReview: matchSummary.needsReview,
      confirmed: visibleResults.filter((r) => r.status === 'CONFIRMED').length,
      rejected: matchSummary.rejected,
      mismatch: matchSummary.mismatch,
      amountMismatch: matchSummary.amountMismatch,
      reviewTotal: matchSummary.reviewTotal,
      issueTotal: matchSummary.issueTotal,
      lucaOnlyMissing: matchSummary.lucaOnlyMissing,
      imageOnlyMissing: matchSummary.imageOnlyMissing,
      otherUnmatched: matchSummary.otherUnmatched,
      balance: matchSummary.balance,
      matchSummary,
      needsOcrConfirm: needsConfirm,
      seriUyarilari, // ← yeni alan: array of {tip: 'eksik'|'cross_break', mesaj: string}
      contentAudit: {
        ...contentAuditStats,
        total: totalImages,
        riskyTotal: contentAuditStats.risky + contentAuditStats.notAllowed,
      },
      ocrCost: {
        actualCostUsd,
        estimatedCostUsd,
        estimatedSavedUsd,
        paidCalls: actualPaidCalls || engineStats.claudeReads,
        cacheHits: Math.max(actualCacheHits, engineStats.cacheHits),
        xmlParsed: engineStats.xmlParsed,
        azureReads: engineStats.azureReads,
        claudeEscalations: engineStats.claudeEscalations,
        freeSkips: Math.max(actualCacheHits, engineStats.cacheHits) + engineStats.xmlParsed,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        cacheReadTokens: actualCacheReadTokens,
        cacheWriteTokens: actualCacheWriteTokens,
        logCount: usageRows.length,
      },
    };
  }

  /**
   * v1.36.67: Belge seri takibi.
   * - Sadece SATIŞ oturumlarında çalışır (KDV_391 / ISLETME_GELIR)
   * - Belge no'larını prefix + numerik kısma ayırır
   * - Bu oturum içi gap'leri tespit eder
   * - Bir önceki dönemin son belge no'su ile cross-month süreklilik kontrolü
   * Sonuç: array of warning messages — kullanıcıya gösterilecek.
   */
  private async checkBelgeSeriContinuity(
    session: any,
    sessionId: string,
    tenantId: string,
  ): Promise<Array<{ tip: string; mesaj: string }>> {
    const isSatis = session.type === 'KDV_391' || session.type === 'ISLETME_GELIR';
    if (!isSatis) return [];
    const records = await this.prisma.kdvRecord.findMany({
      where: { sessionId, belgeNo: { not: null } },
      select: { belgeNo: true, belgeDate: true },
    });
    if (records.length === 0) return [];

    // Belge no'yu e-belge seri + yil + numeric kısma ayır.
    // Sayısal Z raporu/ÖKC fiş numaraları satış faturası seri takibi değildir;
    // onları bu kontrolden bilinçli olarak dışarıda bırakıyoruz.
    const parse = (no: string): { prefix: string; num: number; padLen: number } | null => {
      const cleaned = no.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const m =
        cleaned.match(/^([A-Z]{2,4})(20\d{2})(\d{6,14})$/) ??
        cleaned.match(/^([A-Z]\d{2})(20\d{2})(\d{6,14})$/);
      if (!m) return null;
      return {
        prefix: `${m[1]}${m[2]}`,
        num: parseInt(m[3], 10),
        padLen: m[3].length,
      };
    };

    const grouped: Record<string, Array<{ num: number; padLen: number }>> = {};
    for (const r of records) {
      if (!r.belgeNo) continue;
      const p = parse(String(r.belgeNo));
      if (!p) continue;
      if (!grouped[p.prefix]) grouped[p.prefix] = [];
      grouped[p.prefix].push({ num: p.num, padLen: p.padLen });
    }

    const uyarilar: Array<{ tip: string; mesaj: string }> = [];
    const parseZNo = (no: string | null | undefined): number | null => {
      const raw = String(no || '').trim().toUpperCase();
      if (!raw || /[A-Z]/.test(raw)) return null;
      const digits = raw.replace(/\D/g, '');
      if (!digits || digits.length > 8) return null;
      const num = parseInt(digits, 10);
      return Number.isFinite(num) && num > 0 ? num : null;
    };

    const collectZNumbers = async (targetSessionId: string): Promise<number[]> => {
      const zImages = await this.prisma.receiptImage.findMany({
        where: {
          sessionId: targetSessionId,
          ocrBelgeTipi: 'Z_RAPORU',
          OR: [
            { confirmedBelgeNo: { not: null } },
            { ocrBelgeNo: { not: null } },
          ],
        },
        select: { confirmedBelgeNo: true, ocrBelgeNo: true },
      });
      return zImages
        .map((img) => parseZNo(img.confirmedBelgeNo || img.ocrBelgeNo))
        .filter((num): num is number => num !== null);
    };

    // Bu oturum içi gap kontrolü
    for (const [prefix, entries] of Object.entries(grouped)) {
      const nums = entries.map((e) => e.num);
      const sorted = [...new Set(nums)].sort((a, b) => a - b);
      if (sorted.length < 2) continue;
      const padLen = Math.max(...entries.map((e) => e.padLen));
      const eksikler: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) {
          eksikler.push(n);
        }
      }
      if (eksikler.length > 0) {
        const eksikStr = eksikler.slice(0, 10).map((n) => prefix + String(n).padStart(padLen, '0')).join(', ');
        const fazla = eksikler.length > 10 ? ` (+${eksikler.length - 10} tane daha)` : '';
        uyarilar.push({
          tip: 'gap',
          mesaj: `${eksikler.length} numaralı fatura seri takibi kontrolünde eksik tespit edildi: ${eksikStr}${fazla}`,
        });
      }
    }

    // Z raporu sıra takibi: sadece OCR'ın Z_RAPORU diye etiketlediği satış belgeleri.
    const zNumbers = await collectZNumbers(sessionId);
    if (zNumbers.length > 0) {
      const duplicateMap = zNumbers.reduce((acc, num) => {
        acc[num] = (acc[num] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      const duplicateNos = Object.entries(duplicateMap)
        .filter(([, count]) => count > 1)
        .map(([num]) => Number(num))
        .sort((a, b) => a - b);
      if (duplicateNos.length > 0) {
        const duplicateStr = duplicateNos.slice(0, 10).map((n) => `Z No ${n}`).join(', ');
        const fazla = duplicateNos.length > 10 ? ` (+${duplicateNos.length - 10} tane daha)` : '';
        uyarilar.push({
          tip: 'z_duplicate',
          mesaj: `Z raporu sıra takibinde aynı Z No birden fazla kez göründü: ${duplicateStr}${fazla}`,
        });
      }

      const sortedZ = [...new Set(zNumbers)].sort((a, b) => a - b);
      if (sortedZ.length >= 2) {
        const eksikler: number[] = [];
        for (let i = 1; i < sortedZ.length; i++) {
          for (let n = sortedZ[i - 1] + 1; n < sortedZ[i]; n++) {
            eksikler.push(n);
          }
        }
        if (eksikler.length > 0) {
          const eksikStr = eksikler.slice(0, 20).map((n) => `Z No ${n}`).join(', ');
          const fazla = eksikler.length > 20 ? ` (+${eksikler.length - 20} tane daha)` : '';
          uyarilar.push({
            tip: 'z_gap',
            mesaj: `Z raporu sıra takibinde ${eksikler.length} eksik numara tespit edildi: ${eksikStr}${fazla}`,
          });
        }
      }
    }

    // Cross-month: önceki dönem son belge no / Z no
    if (session.taxpayerId && session.periodLabel) {
      const [yilStr, ayStr] = session.periodLabel.split(/[/-]/);
      const yil = parseInt(yilStr, 10);
      const ay = parseInt(ayStr, 10);
      if (Number.isFinite(yil) && Number.isFinite(ay)) {
        // Önceki ayı hesapla
        let oncekiAy = ay - 1;
        let oncekiYil = yil;
        if (oncekiAy < 1) { oncekiAy = 12; oncekiYil = yil - 1; }
        const oncekiPeriod1 = `${oncekiYil}/${String(oncekiAy).padStart(2, '0')}`;
        const oncekiPeriod2 = `${oncekiYil}-${String(oncekiAy).padStart(2, '0')}`;

        const oncekiSession = await this.prisma.kdvControlSession.findFirst({
          where: {
            tenantId,
            taxpayerId: session.taxpayerId,
            type: session.type,
            periodLabel: { in: [oncekiPeriod1, oncekiPeriod2] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (oncekiSession) {
          const oncekiRecords = await this.prisma.kdvRecord.findMany({
            where: { sessionId: oncekiSession.id, belgeNo: { not: null } },
            select: { belgeNo: true },
          });
          // Önceki ayın son belge no'su (her prefix için)
          const oncekiByPrefix: Record<string, { num: number; padLen: number }> = {};
          for (const r of oncekiRecords) {
            if (!r.belgeNo) continue;
            const p = parse(String(r.belgeNo));
            if (!p) continue;
            const prev = oncekiByPrefix[p.prefix];
            if (!prev || p.num > prev.num) {
              oncekiByPrefix[p.prefix] = { num: p.num, padLen: p.padLen };
            }
          }

          // Bu ayın ilk belge no'su her prefix için
          for (const [prefix, entries] of Object.entries(grouped)) {
            const nums = entries.map((e) => e.num);
            const sorted = [...new Set(nums)].sort((a, b) => a - b);
            const buAyIlk = sorted[0];
            const onceki = oncekiByPrefix[prefix];
            if (onceki && buAyIlk > onceki.num + 1) {
              const padLen = Math.max(onceki.padLen, ...entries.map((e) => e.padLen));
              const eksikSayi = buAyIlk - onceki.num - 1;
              uyarilar.push({
                tip: 'cross_break',
                mesaj: `Önceki dönem (${oncekiSession.periodLabel}) son belge ${prefix}${String(onceki.num).padStart(padLen, '0')} → bu dönem ilk belge ${prefix}${String(buAyIlk).padStart(padLen, '0')}. Aralarda ${eksikSayi} belge no atlanmış.`,
              });
            }
          }

          const oncekiZNumbers = await collectZNumbers(oncekiSession.id);
          if (oncekiZNumbers.length > 0 && zNumbers.length > 0) {
            const oncekiSonZ = Math.max(...oncekiZNumbers);
            const buDonemIlkZ = Math.min(...zNumbers);
            if (buDonemIlkZ > oncekiSonZ + 1) {
              uyarilar.push({
                tip: 'z_cross_break',
                mesaj: `Önceki dönem (${oncekiSession.periodLabel}) son Z No ${oncekiSonZ} → bu dönem ilk Z No ${buDonemIlkZ}. Aralarda ${buDonemIlkZ - oncekiSonZ - 1} Z raporu atlanmış.`,
              });
            }
          }
        }
      }
    }

    return uyarilar;
  }

  /** Eşleşmeyi kullanıcı teyit eder */
  async resolveResult(
    resultId: string,
    tenantId: string,
    userId: string,
    action: 'CONFIRMED' | 'REJECTED',
    notes?: string,
  ) {
    const result = await this.prisma.reconciliationResult.findFirst({
      where: { id: resultId, session: { tenantId } },
      include: { session: true },
    });
    if (!result) throw new NotFoundException('Sonuç bulunamadı');
    this.assertSessionUnlocked(result.session);

    return this.prisma.reconciliationResult.update({
      where: { id: resultId },
      data: { status: action, resolvedBy: userId, resolvedAt: new Date(), notes },
    });
  }

  // ============================================================
  // OTOMATİK ÇEKİM AKIŞI (Luca + Mihsap)
  // ============================================================

  /**
   * Luca'dan Defteri Kebir / işletme defteri verisini otomatik çekmek için
   * bir Luca fetch job oluşturur. Runner (moren-agent.js) bu job'u
   * Luca sayfasında çalıştırır — Excel indirip buraya yollar.
   *
   * Döndürülen `jobId` ile frontend durumu polll edebilir.
   */
  /**
   * Luca fetch job durumu sorgu — frontend polling için.
   * Mizan'daki getJob ile aynı, sadece tenant'a filtrelenmiş.
   */
  async getLucaJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException('Luca job bulunamadı');
    }
    return job;
  }

  async queueLucaImport(sessionId: string, tenantId: string, userId: string, targetDeviceId?: string) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    if (!session.taxpayerId) {
      throw new BadRequestException(
        'Bu oturuma Luca\'dan otomatik çekim için önce mükellef atanmalı',
      );
    }

    // Mükellef bilgisini çek (Luca'da arama için)
    const taxpayer = await this.prisma.taxpayer.findUnique({
      where: { id: session.taxpayerId },
    });
    const mukellefAdi =
      taxpayer?.companyName ||
      [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') ||
      taxpayer?.taxNumber ||
      '';

    const donem = this.toDashDonem(session.periodLabel);

    // Luca Moren Agent akışı — güvenlik kodu gerektiğinde portal içindeki
    // Luca Oturum Yöneticisi gösterir; kullanıcı ayrı Luca ekranına yönlendirilmez.
    const job = await this.luca.createFetchJob({
      tenantId,
      sessionId,
      mukellefId: session.taxpayerId,
      donem,
      tip: session.type,
      createdBy: userId,
      targetDeviceId,
    });
    await this.luca
      .appendJobLog(
        job.id,
        targetDeviceId
          ? 'KDV kontrol Luca cekimi siraya alindi; secili ajan bekleniyor'
          : 'KDV kontrol Luca cekimi siraya alindi; Luca ajani bekleniyor',
      )
      .catch(() => undefined);

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return {
      jobId: job.id,
      status: 'queued',
      method: 'portal-session-manager',
      message: 'Luca job kuyruğa alındı; güvenlik kodu gerekirse portal içindeki Luca Oturum Yöneticisi gösterecek',
    };
  }

  /**
   * DEPRECATED: Arka planda Playwright ile Luca'ya login olup Excel'i indirir.
   * Railway IP'leri Luca tarafından bloklandığı için artık kullanılmıyor.
   */
  private async runAutoScrapeBackground(
    sessionId: string,
    tenantId: string,
    params: { tip: string; donem: string; mukellefAdi: string; createdBy?: string },
  ): Promise<void> {
    const job = await this.luca.createFetchJob({
      tenantId,
      sessionId,
      mukellefId: '',
      donem: params.donem,
      tip: params.tip,
      createdBy: params.createdBy,
    });
    await this.luca.markJobRunning(job.id);

    try {
      const buffer = await this.lucaAutoScraper.fetchMuavinExcel({
        tenantId,
        tip: params.tip,
        donem: params.donem,
        mukellefAdi: params.mukellefAdi,
      });
      const result = await this.uploadExcel(sessionId, tenantId, buffer);
      await this.luca.markJobDone(job.id, result.parsed);
      this.logger.log(`Luca auto-scrape tamamlandı: ${result.parsed} satır`);
    } catch (e: any) {
      const msg = e?.message || 'bilinmeyen hata';
      this.logger.error(`Luca auto-scrape hata: ${msg}`);
      await this.luca.markJobFailed(job.id, msg);
    }
  }

  /**
   * Runner Luca'dan Excel'i indirdikten sonra bu endpoint ile yükler.
   * `uploadExcel` ile aynı ama ayrı bir `jobId` ile job durumunu
   * "done" olarak işaretler.
   */
  private periodLabelCandidatesFromRunner(donem?: string | null): string[] {
    const raw = String(donem || '').trim();
    if (!raw) return [];
    const m = raw.match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (!m) return [raw];
    const month = m[2].padStart(2, '0');
    return Array.from(new Set([
      `${m[1]}-${month}`,
      `${m[1]}/${month}`,
      `${m[1]}/${Number(month)}`,
    ]));
  }

  private async resolveRunnerKdvSession(
    sessionId: string,
    tenantId: string,
    jobId: string,
  ) {
    const direct = sessionId
      ? await this.prisma.kdvControlSession.findFirst({
          where: { id: sessionId, tenantId },
          include: { taxpayer: true },
        })
      : null;
    if (direct) return direct;

    const job = jobId
      ? await (this.prisma as any).lucaFetchJob.findFirst({
          where: { id: jobId, tenantId },
        })
      : null;
    if (!job || !this.VALID_TYPES.includes(job.tip as any)) {
      throw new NotFoundException('Oturum bulunamadı');
    }

    const periodLabels = this.periodLabelCandidatesFromRunner(job.donem);
    const periodWhere = periodLabels.length > 0
      ? { periodLabel: { in: periodLabels } }
      : {};

    let session = await this.prisma.kdvControlSession.findFirst({
      where: {
        tenantId,
        type: job.tip as any,
        taxpayerId: job.mukellefId || null,
        ...periodWhere,
      },
      include: { taxpayer: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      session = await this.prisma.kdvControlSession.create({
        data: {
          tenantId,
          type: job.tip as any,
          periodLabel: periodLabels[0] || String(job.donem || ''),
          taxpayerId: job.mukellefId || null,
          createdBy: job.createdBy || tenantId,
          status: 'PROCESSING',
          notes: sessionId
            ? `Runner upload icin eksik oturum yeniden olusturuldu. Eski sessionId=${sessionId}`
            : 'Runner upload icin oturum otomatik olusturuldu.',
        },
        include: { taxpayer: true },
      });
      await this.pushFeedEvent(tenantId, {
        action: 'session-recover',
        status: 'bilgi',
        message: `KDV kontrol oturumu runner upload sirasinda yeniden olusturuldu - ${session.periodLabel} · ${this.kdvTypeLabel(session.type)}`,
        mukellef: this.formatMukellefAdi(session),
        meta: { sessionId: session.id, oldSessionId: sessionId || null, jobId },
      });
    }

    if (session.id !== sessionId) {
      await (this.prisma as any).lucaFetchJob.updateMany({
        where: { id: jobId, tenantId },
        data: { sessionId: session.id },
      });
    }

    return session;
  }

  async uploadExcelFromRunner(
    sessionId: string,
    tenantId: string,
    jobId: string,
    buffer: Buffer,
  ) {
    try {
      // Session type'a göre — KDV_191/391 için MAPPING'li parse et (manuel ile aynı)
      // Çünkü auto-detect parser bazı Excel'lerde fail ediyor.
      const session = await this.resolveRunnerKdvSession(sessionId, tenantId, jobId);
      sessionId = session.id;
      const isKdv = session?.type === 'KDV_191' || session?.type === 'KDV_391';
      let result: { parsed?: number; imported?: number };
      if (isKdv) {
        // Luca Defteri Kebir Excel default sütun isimleri
        const mapping = {
          tarihCol: 'EVRAK TARİHİ',
          belgeNoCol: 'EVRAK NO',
          kdvCol: session?.type === 'KDV_191' ? 'BORÇ' : 'ALACAK',
        };
        const mapResult = await this.importExcelWithMapping(sessionId, tenantId, buffer, mapping);
        result = { parsed: mapResult.imported };
      } else {
        result = await this.uploadExcel(sessionId, tenantId, buffer);
      }
      await this.luca.markJobDone(jobId, result.parsed || 0);
      return result;
    } catch (e: any) {
      await this.luca.markJobFailed(jobId, e?.message || 'Excel parse hatası');
      throw e;
    }
  }

  /**
   * Mevcut Mihsap fatura kayıtlarını bu KDV Kontrol oturumuna
   * görsel (`receiptImage`) olarak bağlar. Hiçbir dosya yüklenmez —
   * zaten Mihsap CDN'de duran görseller `mihsapFileLink` üstünden
   * OCR'a verilir.
   *
   * `session.taxpayerId` + `session.periodLabel` ile `mihsapInvoice`
   * tablosu filtrelenir. `KDV_191 / ISLETME_GIDER` → ALIS faturaları,
   * `KDV_391 / ISLETME_GELIR` → SATIS faturaları.
   */
  async linkMihsapInvoices(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    if (!session.taxpayerId) {
      throw new BadRequestException(
        'Fatura bağlama için önce mükellef atanmalı',
      );
    }

    const donem = this.toDashDonem(session.periodLabel); // YYYY-MM
    const faturaTuru =
      session.type === 'KDV_391' || session.type === 'ISLETME_GELIR'
        ? 'SATIS'
        : 'ALIS';

    const invoices = await (this.prisma as any).mihsapInvoice.findMany({
      where: {
        tenantId,
        mukellefId: session.taxpayerId,
        donem,
        // Faturalar sayfası .includes() ile filtreliyor çünkü MIHSAP bazı kayıtları
        // "SATIS_FATURA" / "ALIS_EARSIV" gibi bileşik değerle döndürüyor.
        // Tam eşleşme ("SATIS") bu kayıtları kaçırıyordu — substring match yapıyoruz.
        faturaTuru: { contains: faturaTuru },
      },
      orderBy: { faturaTarihi: 'asc' },
    });

    if (invoices.length === 0) {
      throw new BadRequestException(
        `Bu mükellefin ${donem} döneminde (${faturaTuru}) Mihsap'tan çekilmiş faturası yok. Önce Mihsap'tan faturaları çekin.`,
      );
    }

    // Daha önce bu oturuma aynı fatura bağlanmışsa atla (mihsap s3Key bazlı)
    const existingKeys = new Set(
      (
        await this.prisma.receiptImage.findMany({
          where: { sessionId },
          select: { s3Key: true },
        })
      ).map((r) => r.s3Key),
    );

    let linked = 0;
    for (const inv of invoices) {
      const s3Key = `mihsap://${inv.id}`; // sanal key — storage'a fiziksel yüklemiyoruz
      if (existingKeys.has(s3Key)) continue;

      await this.prisma.receiptImage.create({
        data: {
          sessionId,
          s3Key,
          originalName: `${inv.faturaNo || inv.id}.${(inv.orjDosyaTuru || 'jpg').toLowerCase()}`,
          mimeType:
            inv.orjDosyaTuru?.toLowerCase().includes('pdf')
              ? 'application/pdf'
              : 'image/jpeg',
          sizeBytes: 0,
          ocrStatus: 'PENDING',
        },
      });
      linked++;
    }

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'PROCESSING' },
    });

    return { linked, total: invoices.length, alreadyLinked: invoices.length - linked };
  }

  /**
   * Session'a bağlanmış (genelde Mihsap kaynaklı) PENDING durumdaki tüm
   * görsellerin OCR'ını toplu başlatır. Tek tek asenkron tetiklenir;
   * çağıran beklemez. Frontend polling ile durumu izler.
   *
   * @param opts.forceFresh Frontend'deki "Yenile" butonundan gelen istekler için
   *   true geçilir. Bu durumda:
   *   - NEEDS_REVIEW (teyit bekler) durumundaki fatura görselleri de yeniden
   *     kuyruğa alınır (normal çağrıda bunlara dokunulmaz çünkü değerler zaten
   *     doldurulmuştur — ama kullanıcı kodda/promptta düzeltme yaptıysa eski
   *     sonuçları silip yeniden OCR etmek ister).
   *   - OCR cache (aynı s3Key için önceki başarılı sonucu kopyalama) devre dışı.
   *     Aksi halde "Yenile" aynı buggy sonucu geri yapıştırır, yeni düzeltmeler
   *     hiçbir zaman uygulanmaz.
   */
  async startOcrForSession(
    sessionId: string,
    tenantId: string,
    opts: { forceFresh?: boolean; forceClaude?: boolean } = {},
  ) {
    const session = await this.findSession(sessionId, tenantId);
    this.assertSessionUnlocked(session);
    const forceFresh = opts.forceFresh === true;
    const forceClaude = opts.forceClaude === true;

    if (forceFresh) {
      await (this.prisma as any).aiUsageLog.deleteMany({
        where: {
          tenantId,
          source: 'kdv-ocr',
          sebep: `session:${sessionId}`,
        },
      }).catch(() => {});
    }

    // PENDING + önceki denemelerde başarısız olanlar (LOW_CONFIDENCE, FAILED).
    // Normal akışta NEEDS_REVIEW'a dokunmayız — kullanıcı teyit sırasında;
    // değerler zaten doldurulmuş durumda. Ama "Yenile" (forceFresh) butonu
    // NEEDS_REVIEW'ı da kapsar çünkü kullanıcı OCR kodunu/promptunu
    // düzelttiğinde bu kartı kullanarak eski sonuçları silip yeniden OCR'lamak
    // ister.
    const targetStatuses = forceFresh
      ? ['PENDING', 'SUCCESS', 'LOW_CONFIDENCE', 'FAILED', 'NEEDS_REVIEW']
      : ['PENDING', 'LOW_CONFIDENCE', 'FAILED'];
    const pending = await this.prisma.receiptImage.findMany({
      where: {
        sessionId,
        ocrStatus: { in: targetStatuses as any },
        isManuallyConfirmed: false,
      },
    });

    if (pending.length === 0) {
      return { queued: 0, message: 'Bekleyen görsel yok' };
    }

    // Failed/LOW_CONFIDENCE olanları PENDING'e çek (tekrar denenecek)
    const toReset = pending
      .filter((p) => p.ocrStatus !== 'PENDING')
      .map((p) => p.id);
    if (toReset.length > 0) {
      await this.prisma.receiptImage.updateMany({
        where: { id: { in: toReset } },
        data: { ocrStatus: 'PENDING' },
      });
    }

    // ═══════════════ OCR CACHE (mükerrer OCR'ı önler) ═══════════════
    // Maliyet optimizasyonu: aynı Mihsap faturası daha önce başka bir
    // session'da başarıyla OCR edilmişse, yeni OCR çağrısı YAPMA — önceki
    // sonucu kopyala. Faturalar modülündeki "aynı belgeleri tekrar çekme"
    // mantığının OCR versiyonu. Claude token'ı boşa harcanmaz.
    //
    // forceFresh (Yenile butonu) modunda bu cache TAMAMEN atlanır. Aksi halde
    // kullanıcı "Yenile"ye bastığında eski (buggy) OCR sonucu geri kopyalanır,
    // yeni deploy ettiği düzeltmeler hiçbir zaman uygulanmaz.
    let cacheHits = 0;
    const toQueue: typeof pending = [];
    for (const img of pending) {
      if (forceFresh || !img.s3Key?.startsWith('mihsap://')) {
        toQueue.push(img);
        continue;
      }

      // Aynı Mihsap invoice daha önce OCR edildi mi? (aynı tenant, farklı image kaydı)
      const cached = await this.prisma.receiptImage.findFirst({
        where: {
          s3Key: img.s3Key,
          id: { not: img.id },
          session: { tenantId },
          ocrStatus: { in: ['SUCCESS', 'NEEDS_REVIEW'] },
          OR: [
            { ocrBelgeNo: { not: null } },
            { ocrDate: { not: null } },
            { ocrKdvTutari: { not: null } },
          ],
        },
        orderBy: { uploadedAt: 'desc' }, // en yeni OCR
      });

      if (cached) {
        // Önceki OCR sonucunu direkt kopyala — yeni Claude çağrısı yok
        await this.prisma.receiptImage.update({
          where: { id: img.id },
          data: {
            ocrStatus: cached.ocrStatus,
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrSaticiVkn: cached.ocrSaticiVkn,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: (cached.ocrEngine || 'claude-haiku-4-5') + ' (cached)',
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown as any,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash: cached.imageHash,
          },
        });
        const session = await this.findSession(sessionId, tenantId);
        const tp = session.taxpayer;
        const mukellef = tp
          ? tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim() || null
          : null;
        await logAiUsage(this.prisma, {
          tenantId,
          source: 'kdv-ocr',
          model: cached.ocrEngine || 'cache',
          taxpayerId: session.taxpayerId || null,
          mukellef,
          belgeNo: cached.ocrBelgeNo || null,
          karar: 'cache_hit',
          sebep: `session:${sessionId}`,
          cacheHit: true,
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        cacheHits++;
        this.logger.log(`OCR cache HIT: ${img.originalName} ← önceki başarılı OCR kopyalandı`);
      } else {
        toQueue.push(img);
      }
    }

    if (cacheHits > 0) {
      this.logger.log(`OCR cache: ${cacheHits} fatura için Claude çağrısı atlandı (mükerrer OCR önlendi)`);
    }

    if (toQueue.length === 0) {
      return {
        queued: 0,
        cacheHits,
        estimatedSavedUsd: cacheHits * 0.0025,
        message: 'Tüm faturalar önceden OCR edilmişti',
      };
    }

    // Concurrency limit — Claude rate limit'ine takılmamak için aynı anda
    // max CLAUDE_OCR_CONCURRENCY işlem (default 2). Önceden 3'tü ama Anthropic
    // organization rate limit'e takılıyordu. 2 + her request arası 800ms throttle ile
    // 60 req/dakika seviyesinde kalıyoruz (Anthropic Tier 1 = 50 RPM, Tier 2 = 1000 RPM).
    const CONCURRENCY = Math.max(1, Number(process.env.CLAUDE_OCR_CONCURRENCY) || 2);
    const REQUEST_THROTTLE_MS = Math.max(0, Number(process.env.OCR_REQUEST_THROTTLE_MS) || 800);
    this.logger.log(
      `OCR kuyruğu başlatılıyor: ${toQueue.length} fatura (${cacheHits} önceden cached) · concurrency=${CONCURRENCY} · throttle=${REQUEST_THROTTLE_MS}ms`,
    );

    const queue = [...toQueue];
    let queued = 0;
    const workers = Array.from({ length: CONCURRENCY }, async (_, workerIdx) => {
      // Worker'ları stagger et — hepsi aynı anda başlamasın (rate limit jitter)
      if (workerIdx > 0) {
        await new Promise((r) => setTimeout(r, workerIdx * 400));
      }
      while (queue.length > 0) {
        const img = queue.shift();
        if (!img) break;
        const startMs = Date.now();
        try {
          if (img.s3Key?.startsWith('mihsap://')) {
            const invoiceId = img.s3Key.slice('mihsap://'.length);
            await this.runOcrForMihsapInvoice(img.id, invoiceId, tenantId, { forceClaude, forceFresh });
          } else {
            await this.runOcrForImage(img.id, img.s3Key, { forceClaude, forceFresh });
          }
        } catch (e: any) {
          this.logger.error(`OCR worker ${workerIdx} hata [${img.id}]: ${e?.message}`);
        }
        queued++;
        // İşlem hızlı bittiyse minimum throttle uygula (rate limit nezaket)
        const elapsed = Date.now() - startMs;
        if (elapsed < REQUEST_THROTTLE_MS && queue.length > 0) {
          await new Promise((r) => setTimeout(r, REQUEST_THROTTLE_MS - elapsed));
        }
      }
    });

    // Gösterge panelindeki "Canlı Sistem Akışı"na başlangıç eventi
    const mukellefAdi = this.formatMukellefAdi(session);
    await this.pushFeedEvent(tenantId, {
      action: 'ocr-start',
      status: 'bilgi',
      message: `Fatura OCR başladı — ${toQueue.length} yeni${cacheHits > 0 ? ` · ${cacheHits} cache'den` : ''}`,
      mukellef: mukellefAdi,
      meta: { sessionId, queued: toQueue.length, cacheHits },
    });

    // Workers'ları arkaplanda çalıştır, HTTP yanıtını hemen döndür
    Promise.all(workers).then(async () => {
      this.logger.log(`OCR kuyruğu bitti: ${queued} fatura işlendi · ${cacheHits} cached`);
      // OCR tamamlandığında da feed'e yaz
      await this.pushFeedEvent(tenantId, {
        action: 'ocr-complete',
        status: 'basarili',
        message: `Fatura OCR tamamlandı — ${queued} işlendi${cacheHits > 0 ? ` · ${cacheHits} cache'den` : ''}`,
        mukellef: mukellefAdi,
        meta: { sessionId, processed: queued, cacheHits },
      });
      // OCR (KDV kontrol okuması) bitince içerik denetimini otomatik başlat.
      // KDV_CONTENT_AUDIT_AUTO=0/false ile kapatılabilir.
      const autoAudit = String(process.env.KDV_CONTENT_AUDIT_AUTO ?? '1').trim().toLowerCase();
      if (autoAudit !== '0' && autoAudit !== 'false') {
        try {
          await this.startContentAuditForSession(sessionId, tenantId, undefined, { force: false });
        } catch (e: any) {
          this.logger.warn(`Otomatik içerik denetimi başlatılamadı: ${e?.message || e}`);
        }
      }
    });

    return {
      queued: toQueue.length,
      total: pending.length,
      cacheHits,
      estimatedSavedUsd: cacheHits * 0.0025,
      message: cacheHits > 0
        ? `${toQueue.length} yeni OCR · ${cacheHits} fatura önceden OCR edilmişti, atlandı`
        : undefined,
    };
  }

  /**
   * Mihsap kaynaklı fatura için OCR çalıştır:
   * 1) Mihsap CDN'den görseli indir
   * 2) OcrService'e ver
   * 3) receiptImage kaydını güncelle
   */
  private async runOcrForMihsapInvoice(
    imageId: string,
    mihsapInvoiceId: string,
    tenantId: string,
    opts: { forceClaude?: boolean; forceFresh?: boolean } = {},
  ) {
    const t0 = Date.now();
    try {
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'PROCESSING' },
      });

      const inv = await (this.prisma as any).mihsapInvoice.findUnique({
        where: { id: mihsapInvoiceId },
      });
      if (!inv || inv.tenantId !== tenantId) {
        throw new Error('Mihsap invoice kaydı bulunamadı');
      }

      const url = inv.mihsapFileLink;
      if (!url) throw new Error('mihsapFileLink boş — görsel çekilmemiş');

      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0',
          Accept: 'image/*,application/pdf,application/xml,*/*',
          Referer: 'https://app.mihsap.com/',
        },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Mihsap CDN ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const buffer = Buffer.from(await res.arrayBuffer());
      this.logger.log(
        `Mihsap OCR [${imageId}] CDN: ${res.status} · ${contentType} · ${buffer.byteLength}B · ${inv.faturaNo || inv.id}`,
      );

      // PRENSİP: Mihsap'ın ham verisine (faturaNo, faturaTarihi vb.) güvenme.
      // Tek doğru kaynak FATURA GÖRÜNTÜSÜ. Tüm alanlar görselden OCR ile okunur.
      const filenameHint = `${inv.faturaNo || inv.id}.${(inv.orjDosyaTuru || 'jpg').toLowerCase()}`;

      // ─── HASH CACHE KONTROLÜ ───
      // Aynı görüntü daha önce başarılı işlendiyse OCR sağlayıcısına hiç gitme — DB'den dön.
      const imageHash = this.ocrService.computeImageHash(buffer);
      if (!opts.forceFresh && !opts.forceClaude && await this.tryApplyHashCache(imageId, imageHash, Date.now() - t0)) return;
      const cached = opts.forceFresh || opts.forceClaude ? null : await (this.prisma as any).receiptImage.findFirst({
        where: { imageHash, ocrStatus: 'SUCCESS' },
        orderBy: { uploadedAt: 'desc' },
        select: {
          ocrBelgeNo: true, ocrDate: true, ocrKdvTutari: true, ocrKdvTevkifat: true,
          ocrSatici: true, ocrSaticiVkn: true, ocrRawText: true, ocrConfidence: true,
          ocrBelgeNoConfidence: true, ocrDateConfidence: true, ocrKdvConfidence: true,
          ocrEngine: true, ocrBelgeTipi: true, ocrKdvBreakdown: true,
          ocrValidationScore: true, ocrKategori: true,
        },
      });

      if (cached) {
        this.logger.log(`Hash cache HIT [${imageId}]: ${imageHash.slice(0, 8)}... · sağlayıcıya gidilmedi`);
        await this.prisma.receiptImage.update({
          where: { id: imageId },
          data: {
            ocrStatus: 'SUCCESS',
            ocrBelgeNo: cached.ocrBelgeNo,
            ocrDate: cached.ocrDate,
            ocrKdvTutari: cached.ocrKdvTutari,
            ocrKdvTevkifat: cached.ocrKdvTevkifat,
            ocrSatici: cached.ocrSatici,
            ocrSaticiVkn: cached.ocrSaticiVkn,
            ocrRawText: cached.ocrRawText,
            ocrConfidence: cached.ocrConfidence,
            ocrBelgeNoConfidence: cached.ocrBelgeNoConfidence,
            ocrDateConfidence: cached.ocrDateConfidence,
            ocrKdvConfidence: cached.ocrKdvConfidence,
            ocrEngine: `${cached.ocrEngine || 'unknown'} (cache)`,
            ocrBelgeTipi: cached.ocrBelgeTipi,
            ocrKdvBreakdown: cached.ocrKdvBreakdown,
            ocrValidationScore: cached.ocrValidationScore,
            ocrKategori: cached.ocrKategori,
            imageHash,
          } as any,
        });
        // Cache hit istatistiği için AiUsageLog'a 0-cost kayıt
        try {
          await (this.prisma as any).aiUsageLog.create({
            data: {
              tenantId,
              taxpayerId: inv.mukellefId || null,
              source: 'mihsap-fatura-cache',
              mukellef: inv.firmaUnvan || null,
              model: cached.ocrEngine || 'cache',
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              karar: 'cache_hit',
              belgeNo: cached.ocrBelgeNo,
              cacheHit: true,
            },
          });
        } catch {}
        return;
      }

      // ─── CACHE MISS → Azure-first OCR (forceClaude varsa Claude) ───
      const ocrResult = await this.ocrService.extractFromImage(buffer, filenameHint, {
        forceClaude: opts.forceClaude === true,
      });
      const review = this.ocrService.needsReview(ocrResult);
      const status = review.needs
        ? review.reason === 'empty'
          ? 'LOW_CONFIDENCE'
          : 'NEEDS_REVIEW'
        : 'SUCCESS';

      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: {
          ocrStatus: status,
          ocrBelgeNo: ocrResult.belgeNo,
          ocrDate: ocrResult.date,
          ocrKdvTutari: ocrResult.kdvTutari,
          ocrKdvTevkifat: ocrResult.kdvTevkifat ?? null,
          ocrSatici: (ocrResult as any).satici || null,
          ocrSaticiVkn: (ocrResult as any).saticiVkn || null,
          ocrRawText: ocrResult.rawText?.substring(0, 2000),
          ocrConfidence: ocrResult.confidence,
          ocrBelgeNoConfidence: ocrResult.fieldConfidence.belgeNo,
          ocrDateConfidence: ocrResult.fieldConfidence.date,
          ocrKdvConfidence: ocrResult.fieldConfidence.kdvTutari,
          ocrEngine: ocrResult.engine,
          ocrBelgeTipi: (ocrResult as any).belgeTipi || null,
          ocrKdvBreakdown: (ocrResult as any).kdvBreakdown || null,
          ocrValidationScore: (ocrResult as any).validationScore ?? null,
          ocrKategori: (ocrResult as any).kategori || null,
          imageHash,
          // forceFresh → içerik denetimi eski DONE sonucuyla kalmasın, yeniden çalışsın
          ...(opts.forceFresh ? { contentAuditStatus: 'PENDING' } : {}),
          // confirmed* alanlarını DOLDURMUYORUZ — Mihsap verisine güvenilmez.
        } as any,
      });

      await this.logOcrUsage(imageId, ocrResult, Date.now() - t0);

      // ─── VENDOR MEMORY UPSERT ───
      // OCR'dan VKN okuduysak VendorMemory'de "bu firmayı gördük" kaydı tut.
      // Sonraki KDV mutabakatlarında bu firma için öğrenilen kategori auto-suggest edilebilir.
      const vkn = (ocrResult as any).saticiVkn;
      const satici = (ocrResult as any).satici;
      if (vkn && (vkn.length === 10 || vkn.length === 11)) {
        try {
          await (this.prisma as any).vendorMemory.upsert({
            where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
            create: {
              tenantId,
              firmaKimlikNo: vkn,
              firmaUnvan: satici || null,
              sonKullanim: new Date(),
            },
            update: {
              // Yeni unvan görüldüyse güncelle (son gördüğümüz isim)
              firmaUnvan: satici || undefined,
              sonKullanim: new Date(),
            },
          });
        } catch (e: any) {
          this.logger.warn(`VendorMemory upsert hatası (${vkn}): ${e?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`runOcrForMihsapInvoice [${imageId}]: ${err?.message}`);
      await this.prisma.receiptImage.update({
        where: { id: imageId },
        data: { ocrStatus: 'FAILED' },
      });
    }
  }

  /**
   * Manuel Review Queue — tüm tenant'taki düşük güvenli OCR sonuçları.
   * NEEDS_REVIEW + LOW_CONFIDENCE statüsündeki ReceiptImage'ları döner,
   * kullanıcının teyit etmesi için.
   */
  async getReviewQueue(
    tenantId: string,
    opts: { taxpayerId?: string; donem?: string; limit?: number; offset?: number } = {},
  ) {
    const { taxpayerId, donem, limit = 100, offset = 0 } = opts;

    // Önce ilgili sessionları bul (tenant + opsiyonel taxpayer/donem)
    const sessionWhere: any = { tenantId };
    if (taxpayerId) sessionWhere.taxpayerId = taxpayerId;
    if (donem) sessionWhere.periodLabel = { in: [donem, donem.replace('-', '/')] };

    const sessions = await (this.prisma as any).kdvControlSession.findMany({
      where: sessionWhere,
      select: {
        id: true,
        taxpayerId: true,
        periodLabel: true,
        kayitTuru: true,
        taxpayer: {
          select: { firstName: true, lastName: true, companyName: true, taxNumber: true },
        },
      },
    });
    const sessionIds = sessions.map((s: any) => s.id);
    if (sessionIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }
    const sessionMap = new Map(sessions.map((s: any) => [s.id, s]));

    // ReviewQueue kriterleri: NEEDS_REVIEW veya LOW_CONFIDENCE; manuel teyit edilmemiş
    const where: any = {
      sessionId: { in: sessionIds },
      ocrStatus: { in: ['NEEDS_REVIEW', 'LOW_CONFIDENCE'] },
      isManuallyConfirmed: false,
    };

    const [items, total] = await Promise.all([
      (this.prisma as any).receiptImage.findMany({
        where,
        orderBy: [{ ocrConfidence: 'asc' }, { uploadedAt: 'desc' }], // en düşük confidence önce
        skip: offset,
        take: limit,
        select: {
          id: true,
          sessionId: true,
          originalName: true,
          ocrStatus: true,
          ocrBelgeNo: true,
          ocrDate: true,
          ocrKdvTutari: true,
          ocrKdvTevkifat: true,
          ocrSatici: true,
          ocrSaticiVkn: true,
          ocrBelgeTipi: true,
          ocrKategori: true,
          ocrConfidence: true,
          ocrBelgeNoConfidence: true,
          ocrDateConfidence: true,
          ocrKdvConfidence: true,
          ocrEngine: true,
          ocrValidationScore: true,
          uploadedAt: true,
        },
      }),
      (this.prisma as any).receiptImage.count({ where }),
    ]);

    // Her image'a session info ekle
    const enriched = items.map((img: any) => {
      const sess: any = sessionMap.get(img.sessionId);
      const tp = sess?.taxpayer;
      const mukellefAdi = tp?.companyName || [tp?.firstName, tp?.lastName].filter(Boolean).join(' ') || '—';
      return {
        ...img,
        session: sess
          ? {
              id: sess.id,
              taxpayerId: sess.taxpayerId,
              donem: sess.periodLabel,
              kayitTuru: sess.kayitTuru,
            }
          : null,
        mukellefAdi,
        mukellefVkn: tp?.taxNumber || null,
      };
    });

    return { items: enriched, total, limit, offset };
  }

  /** "2026/03" → "2026-03" */
  private toDashDonem(periodLabel: string): string {
    if (/^\d{4}-\d{2}$/.test(periodLabel)) return periodLabel;
    const m = periodLabel.match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    return periodLabel;
  }

  private kdvDateParseOptions(periodLabel?: string | null): { expectedYear?: number; expectedMonth?: number } {
    const dash = periodLabel ? this.toDashDonem(periodLabel) : '';
    const m = dash.match(/^(\d{4})-(\d{2})$/);
    if (!m) return {};
    return {
      expectedYear: Number(m[1]),
      expectedMonth: Number(m[2]),
    };
  }

  private normalizeRawColumnName(value: string): string {
    return String(value ?? '')
      .replace(/\uFFFD/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0130/g, 'I').replace(/\u0131/g, 'i')
      .replace(/\u011E/g, 'G').replace(/\u011F/g, 'g')
      .replace(/\u015E/g, 'S').replace(/\u015F/g, 's')
      .replace(/\u00C7/g, 'C').replace(/\u00E7/g, 'c')
      .replace(/\u00D6/g, 'O').replace(/\u00F6/g, 'o')
      .replace(/\u00DC/g, 'U').replace(/\u00FC/g, 'u')
      .replace(/Ä°/g, 'I').replace(/Ä±/g, 'i')
      .replace(/Ä/g, 'G').replace(/ÄŸ/g, 'g')
      .replace(/Å/g, 'S').replace(/ÅŸ/g, 's')
      .replace(/Ã‡/g, 'C').replace(/Ã§/g, 'c')
      .replace(/Ã–/g, 'O').replace(/Ã¶/g, 'o')
      .replace(/Ãœ/g, 'U').replace(/Ã¼/g, 'u')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private findRawDataValue(rawData: any, wantedColumns: string[]): string | null {
    if (!rawData || typeof rawData !== 'object') return null;
    const wanted = wantedColumns.map((v) => this.normalizeRawColumnName(v));
    for (const [key, value] of Object.entries(rawData)) {
      const normalized = this.normalizeRawColumnName(key);
      if (wanted.some((w) => normalized === w || normalized.includes(w))) {
        const text = String(value ?? '').trim();
        if (text) return text;
      }
    }
    return null;
  }

  private periodVariants(periodLabel?: string | null): string[] {
    const raw = String(periodLabel || '').trim();
    if (!raw) return [];
    const normalized = this.toDashDonem(raw);
    const slash = normalized.replace('-', '/');
    return Array.from(new Set([raw, normalized, slash]));
  }

  /**
   * Luca KDV importunda eski/bozuk satirlarda belgeNo kisa fis no olarak kaldiysa
   * raw ACIKLAMA kolonundan gercek e-fatura/e-arsiv noyu yeniden turetir.
   * Agent endpoint'i bunu canli oturumu yerinde onarmak icin kullanir.
   */
  async repairLucaRecordBelgeNosForAgent(
    tenantId: string,
    opts: {
      sessionId?: string;
      taxpayerName?: string;
      periodLabel?: string;
      type?: 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';
      dryRun?: boolean;
      reconcile?: boolean;
    },
  ) {
    let session: any;
    if (opts.sessionId) {
      session = await this.findSession(opts.sessionId, tenantId);
    } else {
      const candidates = await this.prisma.kdvControlSession.findMany({
        where: {
          tenantId,
          type: opts.type || 'KDV_391',
          ...(opts.periodLabel ? { periodLabel: { in: this.periodVariants(opts.periodLabel) } } : {}),
        },
        include: {
          taxpayer: { select: { id: true, firstName: true, lastName: true, companyName: true, taxNumber: true } },
          _count: { select: { kdvRecords: true, images: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      const needle = this.normalizeRawColumnName(opts.taxpayerName || '');
      session = needle
        ? candidates.find((s) => this.normalizeRawColumnName(this.formatMukellefAdi(s) || '').includes(needle))
        : candidates[0];
      if (!session) throw new NotFoundException('Onarilacak KDV kontrol oturumu bulunamadi');
    }

    this.assertSessionUnlocked(session);

    const records = await this.prisma.kdvRecord.findMany({
      where: { sessionId: session.id },
      orderBy: { rowIndex: 'asc' },
    });

    const fixes: Array<{
      id: string;
      rowIndex: number;
      before: string | null;
      after: string;
      aciklama: string | null;
    }> = [];

    for (const record of records) {
      const rawData = record.rawData as any;
      const rawAciklama = this.findRawDataValue(rawData, ['ACIKLAMA', 'AIKLAMA']);
      const rowText = rawData && typeof rawData === 'object'
        ? Object.values(rawData).map((v) => String(v ?? '')).join(' ')
        : '';
      const extracted = this.excelParser.extractBelgeNoFromDescription(rawAciklama)
        || this.excelParser.extractBelgeNoFromDescription(rowText);
      if (!extracted) continue;
      if (String(record.belgeNo || '').trim().toUpperCase() === extracted.toUpperCase()) continue;
      fixes.push({
        id: record.id,
        rowIndex: record.rowIndex,
        before: record.belgeNo,
        after: extracted,
        aciklama: rawAciklama,
      });
    }

    if (!opts.dryRun && fixes.length > 0) {
      await this.prisma.$transaction(
        fixes.map((fix) => this.prisma.kdvRecord.update({
          where: { id: fix.id },
          data: {
            belgeNo: fix.after,
            ...(fix.aciklama ? { karsiTaraf: fix.aciklama } : {}),
          },
        })),
      );
    }

    const resultCountsBefore = await this.prisma.reconciliationResult.groupBy({
      by: ['status'],
      where: { sessionId: session.id },
      _count: true,
    });
    let reconciliation: any = null;
    if (!opts.dryRun && opts.reconcile !== false) {
      reconciliation = await this.runReconciliation(session.id, tenantId);
    }

    return {
      ok: true,
      session: {
        id: session.id,
        taxpayer: this.formatMukellefAdi(session) || null,
        periodLabel: session.periodLabel,
        type: session.type,
        recordCount: records.length,
      },
      fixes: fixes.length,
      sampleFixes: fixes.slice(0, 20).map((fix) => ({
        rowIndex: fix.rowIndex,
        before: fix.before,
        after: fix.after,
      })),
      resultCountsBefore,
      reconciliation,
      dryRun: opts.dryRun === true,
    };
  }

  /** Oturumu tamamlandı olarak işaretle */
  async completeSession(sessionId: string, tenantId: string) {
    const session = await this.findSession(sessionId, tenantId);
    const results = await this.prisma.reconciliationResult.findMany({
      where: { sessionId },
      include: { kdvRecord: true, image: true },
    });
    const summary = this.buildMatchSummary(results, session.type);
    if (summary.totalResults === 0) {
      throw new BadRequestException('Eşleştirme sonucu oluşmadan KDV kontrolü kilitlenemez.');
    }
    const updated = await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    });

    // Mükellef seçilmişse aylık KDV kontrol durumunu güncelle
    if (session.taxpayerId && session.periodLabel) {
      const [yearStr, monthStr] = session.periodLabel.split('/');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      if (year && month) {
        await this.prisma.taxpayerMonthlyStatus.upsert({
          where: { taxpayerId_year_month: { taxpayerId: session.taxpayerId, year, month } },
          create: { taxpayerId: session.taxpayerId, tenantId, year, month, kdvKontrolEdildi: true },
          update: { kdvKontrolEdildi: true },
        });

        // Otomasyon event'i: KDV kontrolü kilitlendi
        if (this.automationEventBus) {
          try {
            const taxpayer = await this.prisma.taxpayer.findUnique({
              where: { id: session.taxpayerId },
              select: { id: true, type: true, firstName: true, lastName: true, companyName: true, taxNumber: true },
            });
            const t = taxpayer as any;
            const unvan = t?.type === 'TUZEL_KISI'
              ? t.companyName || ''
              : `${t?.firstName ?? ''} ${t?.lastName ?? ''}`.trim();
            // KDV kontrol oturumu BEYANNAME dönemine aittir (year/month). Aylık takip
            // listesi ise İŞLEM AYINA göre anahtarlanır = beyanname dönemi + 1 ay.
            // Kutuları (ind/hes/e-arşiv) işaretleyen otomasyon bu işlem ayını kullanmalı,
            // yoksa kullanıcının çalıştığı (işlem ayı) satırında görünmez.
            const islemYear = month === 12 ? year + 1 : year;
            const islemMonth = month === 12 ? 1 : month + 1;
            this.automationEventBus.emit('Taxpayer.KdvKontrolKilitlendi', {
              tenantId,
              taxpayerId: session.taxpayerId,
              taxpayerUnvan: unvan || '(isim yok)',
              taxpayerVkn: t?.taxNumber ?? '',
              year,            // beyanname dönemi yılı
              month,           // beyanname dönemi ayı
              beyannamePeriodLabel: `${year}-${String(month).padStart(2, '0')}`,
              islemYear,       // işlem ayı yılı (aylık takip satırı = beyanname + 1)
              islemMonth,      // işlem ayı ayı
              islemPeriodLabel: `${islemYear}-${String(islemMonth).padStart(2, '0')}`,
              sessionId: session.id,
              periodLabel: session.periodLabel,
            });
          } catch (err: any) {
            this.logger.warn(`KDV kilitleme event yayını başarısız: ${err.message}`);
          }
        }
      }
    }

    return updated;
  }

  /** Kilitli oturumu tekrar müdahaleye aç */
  async unlockSession(sessionId: string, tenantId: string) {
    await this.findSession(sessionId, tenantId);
    return this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'REVIEWING' },
    });
  }
}
