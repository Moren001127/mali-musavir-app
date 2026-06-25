import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import * as JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService, OcrResult } from '../kdv-control/ocr';
import { KdvControlService } from '../kdv-control/kdv-control.service';
import { EarsivRenderService } from '../earsiv/earsiv-render.service';
import { encrypt, tryDecrypt } from '../common/crypto';
import { claudeTextViaMax, MAX_MODEL_CHEAP } from '../common/max-inference';
import { buildLucaImportExcel, buildLucaIsletmeHizliFisCsv } from './luca-excel.service';
import { VendorMemoryService } from '../vendor-memory/vendor-memory.service';
import { MihsapService } from '../mihsap/mihsap.service';
import { isletmeRef, getKayitAltList, isletmeAlisSatisTuru, isletmeIslemTuru, defaultBelgeTuruKod, isletmeGiderSinifi, isletmeAutoKayitAltKod, defaultKayitAltKod } from '@mali-musavir/shared';

// ── İşletme defteri AI sınıflandırması ──
// Faturayı okuyan max-vision AI'ına, mükellefin FAALİYETİ + faturanın İÇERİĞİYLE muhakeme ederek
// İşletme kayıt türü + alt türünü seçtirmek için prompt segmenti; ve AI'ın verdiği AD'ı koda çözen yardımcı.
function islPromptSeg(): string {
  const tx = (k: string) => isletmeRef(k).kayitTuru.map((kt: any) =>
    `  • ${kt.ad}: ${getKayitAltList(k, kt.kod).filter((a: any) => !/^99/.test(a.kod)).map((a: any) => a.ad).join(' | ') || '(alt yok)'}`,
  ).join('\n');
  return [
    'İŞLETME DEFTERİ SINIFLANDIRMASI — bu mükellef İşletme/Defter-Beyan usulü. Faturayı MÜKELLEFİN İŞİNE + içindeki mal/hizmete göre sınıfla:',
    '1) Yön: mükellef faturada SATICI mı (→ satış/gelir) yoksa ALICI mı (→ alış/gider)?',
    '2) ALIŞ ise: alınan şey mükellefin SATTIĞI/ticaretini yaptığı emtia mı → "Mal Alışı". Kendi işinde KULLANDIĞI/tükettiği gider mi → "İndirilecek Giderler (GVK Md. 40)" + en uygun alt. Uzun ömürlü makine/cihaz/taşıt/demirbaş mı → "Sabit Kıymet Alışı".',
    '   ÖRNEK: NAKLİYECİ kendi aracına yedek parça/lastik/tamir alır → "İndirilecek Giderler" + "Taşıt Bakım Onarım Giderleri" (MAL ALIŞI DEĞİL). Oto yedek parça TİCARETİ yapan satmak için aynı parçayı alır → "Mal Alışı".',
    '3) SATIŞ ise: satılan mal mı (→ "Mal Satışı") hizmet mi (→ "Hizmet Satışı") + uygun alt.',
    'GELİR türleri ve alt türleri:', tx('SATIS'),
    'GİDER türleri ve alt türleri:', tx('ALIS'),
    'JSON\'A EKLE: "isletmeKayitTuru":"<yukarıdaki TAM kayıt türü adı>","isletmeAltTuru":"<o türün listesinden TAM alt adı>","isletmeNeden":"<tek cümle gerekçe>". NET DEĞİLSEN isletmeKayitTuru="" ve isletmeAltTuru="" (ASLA UYDURMA).',
  ].filter(Boolean).join('\n');
}
function islNorm(s: any): string {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
}
function resolveIslAi(kind: string, parsed: any): any {
  const dir = String(kind || '').toUpperCase().includes('SATIS') ? 'SATIS' : 'ALIS';
  const ref = isletmeRef(dir);
  const giderTuru = String(parsed?.giderTuru || '').trim();
  const matrahKat = String(parsed?.kategori || parsed?.matrahKategori || '').trim();
  const vendor = String(parsed?.saticiAd || parsed?.vendorName || '').trim();
  const ktAd = String(parsed?.isletmeKayitTuru || '').trim();

  // 1) AI'ın verdiği kayıt türü adını koda eşle.
  let kt: any = null;
  if (ktAd) {
    const ktN = islNorm(ktAd);
    kt = ref.kayitTuru.find((x: any) => islNorm(x.ad) === ktN) || ref.kayitTuru.find((x: any) => islNorm(x.ad).includes(ktN) || ktN.includes(islNorm(x.ad)));
  }
  // 2) AI kayıt türü vermedi/eşleşmedi → GİDER tarafında içerik-bazlı deterministik sınıf (Mal/Sabit/GVK40).
  let detAlt = '';
  if (!kt && dir === 'ALIS') {
    const gs = isletmeGiderSinifi({ matrahKategori: matrahKat, giderTuru, vendorName: vendor });
    if (gs) { kt = ref.kayitTuru.find((x: any) => x.kod === gs.kayitTuruKod) || null; detAlt = gs.kayitAltKod; }
  }
  if (!kt) return undefined; // hiçbir kesin sinyal yok → Eşleşmedi

  // 3) Alt türü: AI'ın verdiğini eşle; yoksa İÇERİK-BAZLI türet (elektrik/kira/akaryakıt… ya da deterministik sınıfın alt'ı).
  const altList = getKayitAltList(dir, kt.kod);
  const altN = islNorm(parsed?.isletmeAltTuru || '');
  let alt = altN ? (altList.find((x: any) => islNorm(x.ad) === altN) || altList.find((x: any) => islNorm(x.ad).includes(altN) || altN.includes(islNorm(x.ad)))) : null;
  if (!alt) {
    const fbKod = detAlt
      || (kt.kod === '4' ? isletmeAutoKayitAltKod(dir, '4', `${giderTuru} ${vendor}`) : '')
      || defaultKayitAltKod(dir, kt.kod, kt.ad);
    if (fbKod) alt = altList.find((x: any) => x.kod === fbKod) || null;
  }
  return { kayitTuruKod: kt.kod, kayitTuruAd: kt.ad, kayitAltKod: alt?.kod || '', kayitAltAd: alt?.ad || '', autoMatched: true, neden: String(parsed?.isletmeNeden || '').slice(0, 140) };
}

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
  /** İşletme defteri (Defter-Beyan) sınıflandırması — ocrData.isletme'ye yazılır (migration yok). */
  isletme?: any;
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

type ReportBucket = {
  base: number;
  vat: number;
  total: number;
  count: number;
};

type ReportCounterparty = ReportBucket & {
  name: string;
  taxNo?: string | null;
};

type ReportCategoryKey = 'sales' | 'goods' | 'expenses' | 'unclassified';

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
  FORIBA: 'https://api.fitbulut.com/servis',
  PARASUT: 'https://api.parasut.com/v4',
  MIKRO: 'https://apidocs.mikro.com.tr',
  ELOGO: 'https://earsiv.elogo.com.tr',
  LOGO_ISBASI: 'https://api.isbasi.com',
  KOLAYSOFT: 'https://efatura.kolaysoft.com.tr',
  TURMOB_EFATURA: 'https://turmobefatura.luca.com.tr',
};

// Saglayicilara ozel kullanici yardim metinleri (UI'da entegrator eklerken gosterilir)
export const PROVIDER_AUTH_HINTS: Record<string, string> = {
  UYUMSOFT: "Uyumsoft kullanici adi ve sifresi yeterli. Servis URL otomatik dolar.",
  IZIBIZ: "Izibiz kullanici ve sifre, opsiyonel test/canli URL.",
  FORIBA: "Sovos Foriba bulut API icin kullanici ve sifre. URL Sovos tarafindan verilir.",
  PARASUT: "Parasut OAuth2: client_id (apiKey), client_secret (apiSecret), kullanici, sifre ve Firma No gerekir.",
  MIKRO: "Mikro API anahtari ile baglanir. apidestek@mikro.com.tr adresinden anahtar talep edin.",
  ELOGO: "eLogo kullanici ve sifresi. Opsiyonel olarak servis URL girilebilir.",
  LOGO_ISBASI: "Logo Isbasi API anahtari. developers.isbasi.com adresinden alin.",
  KOLAYSOFT: "Kolaysoft kullanici ve sifresi. Servis URL hesabiniza ozeldir.",
  TURMOB_EFATURA: "TÜRMOB e-Belge portalına mükellefin TCKN ve parolasıyla otomatik giriş yapılıp gelen/giden faturalar XML olarak çekilir (kod/2FA sormaz).",
  GIB_PORTAL: "GIB Portal: dogrudan API yok. Luca Local Agent veya mali muhur ile portal otomasyonu gerekir.",
};

const I2I_SOAP_PROVIDERS = new Set(['IZIBIZ', 'FORIBA']);
const GOODS_ACCOUNT_PREFIXES = ['150', '151', '152', '153', '157'];
const EXPENSE_ACCOUNT_PREFIXES = ['7'];
const SALES_ACCOUNT_PREFIXES = ['600', '601', '602'];
const REPORT_EPSILON = 0.005;

function parseDecimal(value: any, fallback = '0') {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(fallback);
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  return new Prisma.Decimal(normalized || fallback);
}

// Tarihi DAİMA UTC gece-yarısı olarak üretir → slice(0,10) her saat diliminde doğru günü
// verir (eski `new Date(value)` TR'de UTC+3 yüzünden 1 gün geri kaydırıyordu; ayrıca
// "GG.AA.YYYY"yi yanlış aya yorumluyordu). Türk biçimi GÜN önce gelir.
function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  // GG.AA.YYYY | GG-AA-YYYY | GG/AA/YYYY
  let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(Date.UTC(y, mo - 1, d));
  }
  // YYYY-MM-DD (saat olsa da yalnız gün kısmını al)
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(Date.UTC(y, mo - 1, d));
  }
  // Son çare: yerel ayrıştır, ama YEREL takvim gününü UTC gece-yarısına sabitle.
  const nd = new Date(s);
  if (Number.isNaN(nd.getTime())) return null;
  return new Date(Date.UTC(nd.getFullYear(), nd.getMonth(), nd.getDate()));
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

function periodAnchorDate(period?: string | null) {
  return periodRange(period)?.start || null;
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
export class FaturaMuhasebelestirmeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaturaMuhasebelestirmeService.name);
  // Eş zamanlı okuma: storm'un asıl sebebi AGRESİF global resume'du (naziklendi). 2 güvenliydi,
  // 3'e çıkarıyoruz (1.5 kat). Her Max-vision bir Claude Code alt-süreci → çok süreç OOM/rate-limit
  // ("exited code 1") riski; KDV Kontrol de süreç açar. 3 temkinli üst sınır. Re-storm olursa düşür.
  // INVOICE_OCR_CONCURRENCY ile ayarlanır. (Daha büyük hız için hızlı-OCR/Azure-öncelik yolu var.)
  private readonly uploadOcrConcurrency = Math.max(1, Number(process.env.INVOICE_OCR_CONCURRENCY || 3));
  private uploadOcrActive = 0;
  private readonly uploadOcrActiveIds = new Set<string>(); // işlenmekte olan belge id'leri (resume çift-işlemesin)
  private ocrResumeTimer: NodeJS.Timeout | null = null;
  private ocrResuming = false;
  private readonly uploadOcrQueue: Array<{
    tenantId: string;
    documentId: string;
    buffer?: Buffer;
    originalName?: string;
    forceClaude?: boolean;
    // Mihsap'tan çekilen belgeler: buffer CDN'den lazy indirilir (210 buffer'i
    // bellekte tutmamak icin), yon-duyarli yevmiye uretilir.
    kind?: 'upload' | 'mihsap' | 'ai-read' | 'classify';
    mihsapInvoiceId?: string;
    invoiceKind?: 'ALIS' | 'SATIS';
  }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly kdvControl: KdvControlService,
    private readonly earsivRender: EarsivRenderService,
    private readonly vendorMemory: VendorMemoryService,
    private readonly mihsapService: MihsapService,
  ) {}

  onModuleInit() {
    // Sunucu restart'ı in-memory OCR kuyruğunu siler → "AI ile oku"ya basılmış ama henüz
    // okunmamış belgeler PENDING'de öksüz kalıyor (kullanıcı "okunamadı" görüyor). Başlangıçta
    // (kısa gecikme sonra, app tam ayağa kalksın) + periyodik olarak öksüzleri kurtar.
    setTimeout(() => { this.resumeStuckOcr().catch(() => {}); }, 35000);
    this.ocrResumeTimer = setInterval(() => { this.resumeStuckOcr().catch(() => {}); }, 300000);
    if (this.ocrResumeTimer.unref) this.ocrResumeTimer.unref();
  }

  onModuleDestroy() {
    if (this.ocrResumeTimer) { clearInterval(this.ocrResumeTimer); this.ocrResumeTimer = null; }
  }

  /** Restart sonrası öksüz kalan PENDING/IN_PROGRESS belgeleri yeniden kuyruğa alır. Kuyrukta
   *  ya da işlenmekte olanları atlar (çift-işleme yok). FAILED (gerçek hata) belgelere dokunmaz →
   *  sonsuz döngü olmaz. Eş zamanlılık sınırı doğal throttle eder. */
  async resumeStuckOcr(): Promise<number> {
    if (this.ocrResuming) return 0;
    this.ocrResuming = true;
    try {
      // NAZİK: kuyruk doluyken EKLEME — global yığın oluşturup Max'i bunaltma (storm → "exited
      // code 1"). Sadece kuyruk boşalınca (idle) KÜÇÜK parti ekle → kullanıcının "AI ile oku"
      // isteği öncelikli kalsın, arka plan onu ezmesin.
      if (this.uploadOcrQueue.length >= this.uploadOcrConcurrency) return 0;
      const stuck = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: { ocrStatus: { in: ['PENDING', 'IN_PROGRESS'] }, status: { not: 'APPROVED' } },
        select: { id: true, tenantId: true },
        orderBy: { createdAt: 'asc' },
        take: 60,
      }).catch(() => []);
      const queued = new Set(this.uploadOcrQueue.map((j) => j.documentId));
      let n = 0;
      for (const d of stuck) {
        if (queued.has(d.id) || this.uploadOcrActiveIds.has(d.id)) continue;
        this.uploadOcrQueue.push({ tenantId: d.tenantId, documentId: d.id, kind: 'ai-read' });
        n++;
      }
      if (n) {
        this.logger.log(`OCR resume: ${n} oksuz PENDING belge yeniden kuyruga alindi (restart kurtarma)`);
        this.drainUploadedOcrQueue();
      }
      return n;
    } finally {
      this.ocrResuming = false;
    }
  }

  // Plan YOK → kod ASLA görünmesin (kullanıcı talebi). Mükellefin hesap planı çekilmemişse
  // belgelerindeki SABİT placeholder kodlarını (600.01.001 vb.) boşalt — okuma başarısız olsa
  // ya da belge eski (gate öncesi) import edilmiş olsa bile "Eksik hesap kodu" görünür.
  private readonly PLACEHOLDER_CODES = [
    '770.01.010', '760.01.001', '740.01.001', '600.01.001',
    '191.01.001', '191.01.010', '191.01.020',
    '391.01.001', '391.01.010', '391.01.020',
    '320.01.001', '120.01.001', '360.01.001',
  ];
  private async gateExistingDocsIfNoPlan(tenantId: string, taxpayerId?: string) {
    if (!taxpayerId) return;
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, taxpayerId, status: { not: 'APPROVED' } },
      select: { id: true },
    }).catch(() => []);
    if (!docs.length) return;
    // Plan YOK → tüm placeholder kodları boşalt. Plan VAR → yalnız planda OLMAYAN placeholder'ları
    //   boşalt (191.01.020 mükellefte yoksa temizle; gerçekten planda olan 320.01.001 vb. KORUNUR).
    const toClear = planCodes
      ? this.PLACEHOLDER_CODES.filter((c) => !planCodes.has(c))
      : this.PLACEHOLDER_CODES;
    if (!toClear.length) return;
    await (this.prisma as any).invoiceAccountingLine.updateMany({
      where: { documentId: { in: docs.map((d: any) => d.id) }, accountCode: { in: toClear } },
      data: { accountCode: null },
    }).catch(() => {});
  }

  async list(tenantId: string, opts: { status?: string; limit?: number; taxpayerId?: string; period?: string }) {
    // status='PENDING' frontend konvansiyonu = onaylanmamış belgeler (READY + NEEDS_REVIEW).
    // Schema status enum: NEEDS_REVIEW | READY | APPROVED | REJECTED
    // Plan yoksa sahte kodları temizle (tek mükellef listesinde).
    await this.gateExistingDocsIfNoPlan(tenantId, opts.taxpayerId);
    const statusFilter = (() => {
      const s = String(opts.status || '').toUpperCase();
      if (!s) return {};
      if (s === 'PENDING' || s === 'PROCESSING') {
        return { status: { in: ['READY', 'NEEDS_REVIEW', 'PENDING', 'PROCESSING'] } };
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
      const globalConfig = config.taxpayers?.global || null;
      const scopedConfig = config.taxpayers?.[taxpayerKey] || null;
      const taxpayerConfig = scopedConfig
        ? { ...(globalConfig || {}), ...scopedConfig }
        : (taxpayerKey === 'global' ? globalConfig : null);
      const hasProviderEnvApiKey = item.provider === 'PARASUT' && Boolean(process.env.PARASUT_CLIENT_ID);
      const hasProviderEnvApiSecret = item.provider === 'PARASUT' && Boolean(process.env.PARASUT_CLIENT_SECRET);
      const configured = Boolean(
        scopedConfig?.hasApiKey ||
          scopedConfig?.hasApiSecret ||
          scopedConfig?.hasPassword ||
          scopedConfig?.username ||
          scopedConfig?.baseUrl ||
          scopedConfig?.senderVkn ||
          scopedConfig?.accountId ||
          (taxpayerKey === 'global' && (
            globalConfig?.hasApiKey ||
            globalConfig?.hasApiSecret ||
            globalConfig?.hasPassword ||
            globalConfig?.username ||
            globalConfig?.baseUrl ||
            globalConfig?.senderVkn ||
            globalConfig?.accountId ||
            hasProviderEnvApiKey ||
            hasProviderEnvApiSecret
          ))
      );
      const hasApiKey = Boolean(
        scopedConfig?.hasApiKey ||
          globalConfig?.hasApiKey ||
          hasProviderEnvApiKey
      );
      const hasApiSecret = Boolean(
        scopedConfig?.hasApiSecret ||
          globalConfig?.hasApiSecret ||
          hasProviderEnvApiSecret
      );
      const hasPassword = Boolean(
        scopedConfig?.hasPassword ||
          (taxpayerKey === 'global' && globalConfig?.hasPassword)
      );
      return {
        provider: item.provider,
        label: config.label || item.label,
        kind: item.kind,
        tone: item.tone,
        isActive: row?.isActive !== false && taxpayerConfig?.isActive !== false,
        configured,
        taxpayerScoped: Boolean(scopedConfig),
        baseUrl: taxpayerConfig?.baseUrl || '',
        username: taxpayerConfig?.username || '',
        senderVkn: taxpayerConfig?.senderVkn || '',
        accountId: taxpayerConfig?.accountId || '',
        note: taxpayerConfig?.note || '',
        hasApiKey,
        hasApiSecret,
        hasPassword,
        globalApiConfigured: Boolean(globalConfig?.hasApiKey || globalConfig?.hasApiSecret || hasProviderEnvApiKey || hasProviderEnvApiSecret),
        // v2: Talimat - otomatik gece cekim aktif mi?
        talimat: Boolean(taxpayerConfig?.talimat),
        talimatUpdatedAt: taxpayerConfig?.talimatUpdatedAt || null,
        lastSyncAt: row?.lastSyncAt || null,
        updatedAt: taxpayerConfig?.updatedAt || row?.updatedAt || null,
      };
    });
  }

  private normalizeKdvBreakdown(items?: Array<{ rate: number; base: number; amount: number }> | null) {
    const grouped = new Map<string, { rate: number; base: number; amount: number }>();
    for (const item of Array.isArray(items) ? items : []) {
      const rawRate = Number(item?.rate ?? 0);
      const rate = Number.isFinite(rawRate) ? rawRate : 0;
      const key = rate.toFixed(2);
      const current = grouped.get(key) || { rate, base: 0, amount: 0 };
      current.base += Number(item?.base || 0);
      current.amount += Number(item?.amount || 0);
      grouped.set(key, current);
    }
    return Array.from(grouped.values())
      .filter((item) => Math.abs(item.base) > 0.0001 || Math.abs(item.amount) > 0.0001)
      .sort((a, b) => a.rate - b.rate)
      .map((item) => ({
        rate: Math.round(item.rate * 100) / 100,
        base: Math.round(item.base * 100) / 100,
        amount: Math.round(item.amount * 100) / 100,
      }));
  }

  private kdvAccountCode(isSale: boolean, rate?: number) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) return isSale ? '391.01.020' : '191.01.020';
    const suffix = String(Math.round(n)).padStart(3, '0');
    return `${isSale ? '391' : '191'}.01.${suffix}`;
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
      select: { status: true, lucaStatus: true, ocrStatus: true, taxpayerId: true, ocrData: true, invoiceKind: true },
    });

    // v2.2: Mukellef bağlantısı + validation durumu ayrı sayılır
    let pending = 0, approved = 0, errors = 0, posted = 0, ocrInProgress = 0;
    let alisPending = 0, satisPending = 0; // sol menü "Bekleyen Alış/Satış Faturaları" rozetleri
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
        if (String(d.invoiceKind || '').toUpperCase().includes('SATIS')) satisPending++; else alisPending++;
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
      alisPending,
      satisPending,
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
  async kdvClientReport(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string } = {},
  ) {
    const taxpayerId = String(opts.taxpayerId || '').trim();
    if (!taxpayerId) throw new BadRequestException('Mükellef seçimi gerekli');
    const period = this.normalizeReportPeriod(opts.period);

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
        defterTuru: true,
        mihsapDefterTuru: true,
      },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');

    const [invoices, accountingDocs, breakdownByInvoiceId, controls] = await Promise.all([
      (this.prisma as any).earsivFatura.findMany({
        where: {
          tenantId,
          taxpayerId,
          donem: period,
          OR: [{ durum: null }, { durum: { notIn: ['IPTAL', 'RED'] } }],
        },
        select: {
          id: true,
          tip: true,
          belgeKaynak: true,
          donem: true,
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
          durum: true,
        },
        orderBy: [{ faturaTarihi: 'asc' }, { faturaNo: 'asc' }],
      }),
      (this.prisma as any).invoiceAccountingDocument.findMany({
        where: {
          tenantId,
          taxpayerId,
          invoiceKind: { in: ['ALIS', 'SATIS'] },
          ...periodWhere(period),
        },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.loadEarsivKdvBreakdowns(tenantId, taxpayerId, period),
      this.buildKdvControlReport(tenantId, taxpayerId, period),
    ]);

    const docBySourceRef = new Map<string, any>();
    const docByInvoiceNo = new Map<string, any>();
    for (const doc of accountingDocs) {
      const sourceRefId = String(doc.sourceRefId || '').trim();
      const inlineRefId = String(doc.s3Key || '').startsWith('earsiv-inline://')
        ? String(doc.s3Key || '').slice('earsiv-inline://'.length)
        : '';
      const ref = sourceRefId || inlineRefId;
      if (ref && !docBySourceRef.has(ref)) docBySourceRef.set(ref, doc);
      const invoiceKind = String(doc.invoiceKind || '').toUpperCase();
      const belgeNo = String(doc.belgeNo || '').trim().toUpperCase();
      if (invoiceKind && belgeNo && !docByInvoiceNo.has(`${invoiceKind}|${belgeNo}`)) {
        docByInvoiceNo.set(`${invoiceKind}|${belgeNo}`, doc);
      }
    }

    const categories: Record<ReportCategoryKey, ReportBucket> = {
      sales: this.emptyReportBucket(),
      goods: this.emptyReportBucket(),
      expenses: this.emptyReportBucket(),
      unclassified: this.emptyReportBucket(),
    };
    const vatByRate = new Map<string, any>();
    const topSuppliers = new Map<string, ReportCounterparty>();
    const topCustomers = new Map<string, ReportCounterparty>();
    const sourceCounts = { efatura: 0, earsiv: 0, purchase: 0, sales: 0 };

    let salesBase = 0;
    let salesVat = 0;
    let salesTotal = 0;
    let purchaseBase = 0;
    let purchaseVat = 0;
    let purchaseTotal = 0;
    let unclassifiedPurchaseInvoiceCount = 0;

    for (const invoice of invoices) {
      const side = String(invoice.tip || '').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
      const base = this.reportNumber(invoice.matrah);
      const vat = this.reportNumber(invoice.kdvTutari);
      const total = this.reportNumber(invoice.toplamTutar) || base + vat;
      const breakdown = this.normalizeReportBreakdown(breakdownByInvoiceId.get(invoice.id), invoice.kdvOrani, base, vat);

      if (invoice.belgeKaynak === 'EFATURA') sourceCounts.efatura += 1;
      else sourceCounts.earsiv += 1;

      this.addReportVatBreakdown(vatByRate, side, breakdown, base, vat);

      if (side === 'SATIS') {
        sourceCounts.sales += 1;
        salesBase += base;
        salesVat += vat;
        salesTotal += total;
        this.addReportBucket(categories.sales, base, vat, total);
        this.addReportCounterparty(topCustomers, {
          name: invoice.alici || 'Bilinmeyen alıcı',
          taxNo: invoice.aliciVergiNo,
          base,
          vat,
          total,
        });
      } else {
        sourceCounts.purchase += 1;
        purchaseBase += base;
        purchaseVat += vat;
        purchaseTotal += total;
        this.addReportCounterparty(topSuppliers, {
          name: invoice.satici || 'Bilinmeyen satıcı',
          taxNo: invoice.saticiVergiNo,
          base,
          vat,
          total,
        });

        const invoiceNoKey = `ALIS|${String(invoice.faturaNo || '').trim().toUpperCase()}`;
        const doc = docBySourceRef.get(invoice.id) || docByInvoiceNo.get(invoiceNoKey);
        const classified = this.classifyPurchaseInvoiceForReport(doc, { base, vat, total });
        for (const row of classified) {
          this.addReportBucket(categories[row.key], row.base, row.vat, row.total, row.count);
        }
        if (classified.some((row) => row.key === 'unclassified' && Math.abs(row.base) > REPORT_EPSILON)) {
          unclassifiedPurchaseInvoiceCount += 1;
        }
      }
    }

    const missingAccountCodeCount = accountingDocs.filter((doc: any) => {
      const lines = Array.isArray(doc.lines) ? doc.lines : [];
      const relevant = lines.filter((line: any) => ['matrah', 'vergi'].includes(String(line.group || '').toLowerCase()));
      return relevant.length === 0 || relevant.some((line: any) => !String(line.accountCode || '').trim());
    }).length;
    const validationIssueCount = accountingDocs.filter((doc: any) => {
      const status = String((doc as any).validationStatus || doc.ocrData?.validationStatus || '').toUpperCase();
      const issues = (doc as any).validationIssues || doc.ocrData?.validationIssues;
      return ['INVALID', 'INCOMPLETE'].includes(status) || (Array.isArray(issues) && issues.length > 0);
    }).length;
    const statusCounts = accountingDocs.reduce((acc: Record<string, number>, doc: any) => {
      const key = String(doc.status || 'UNKNOWN').toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const pendingReviewCount = accountingDocs.filter((doc: any) =>
      ['NEEDS_REVIEW', 'PENDING', 'PROCESSING', 'READY'].includes(String(doc.status || '').toUpperCase()),
    ).length;

    const totals = {
      salesBase: this.roundReportMoney(salesBase),
      salesVat: this.roundReportMoney(salesVat),
      salesTotal: this.roundReportMoney(salesTotal),
      purchaseBase: this.roundReportMoney(purchaseBase),
      purchaseVat: this.roundReportMoney(purchaseVat),
      purchaseTotal: this.roundReportMoney(purchaseTotal),
      purchaseGoodsBase: this.roundReportMoney(categories.goods.base),
      purchaseGoodsVat: this.roundReportMoney(categories.goods.vat),
      purchaseGoodsTotal: this.roundReportMoney(categories.goods.total),
      expensesBase: this.roundReportMoney(categories.expenses.base),
      expensesVat: this.roundReportMoney(categories.expenses.vat),
      expensesTotal: this.roundReportMoney(categories.expenses.total),
      unclassifiedPurchaseBase: this.roundReportMoney(categories.unclassified.base),
      unclassifiedPurchaseVat: this.roundReportMoney(categories.unclassified.vat),
      unclassifiedPurchaseTotal: this.roundReportMoney(categories.unclassified.total),
      deductibleVat: this.roundReportMoney(purchaseVat),
      calculatedVat: this.roundReportMoney(salesVat),
      periodVatDifference: this.roundReportMoney(salesVat - purchaseVat),
      payableVat: null,
      carryForwardVat: null,
    };

    const categoryRows = [
      {
        key: 'sales',
        label: 'Satışlar',
        side: 'SATIS',
        accountPrefixes: SALES_ACCOUNT_PREFIXES,
        ...this.roundReportBucket(categories.sales),
      },
      {
        key: 'goods',
        label: 'Mal / stok alışları',
        side: 'ALIS',
        accountPrefixes: GOODS_ACCOUNT_PREFIXES,
        ...this.roundReportBucket(categories.goods),
      },
      {
        key: 'expenses',
        label: 'Masraf / giderler',
        side: 'ALIS',
        accountPrefixes: EXPENSE_ACCOUNT_PREFIXES,
        ...this.roundReportBucket(categories.expenses),
      },
      {
        key: 'unclassified',
        label: 'Sınıflandırılamayan alışlar',
        side: 'ALIS',
        accountPrefixes: [],
        ...this.roundReportBucket(categories.unclassified),
      },
    ];

    const quality = {
      invoiceCount: invoices.length,
      accountingDocCount: accountingDocs.length,
      missingAccountCodeCount,
      unclassifiedCount: unclassifiedPurchaseInvoiceCount,
      pendingReviewCount,
      validationIssueCount,
      sourceCounts,
      statusCounts,
    };

    const report = {
      taxpayer: {
        id: taxpayer.id,
        name: this.reportTaxpayerName(taxpayer),
        taxNumber: this.reportTaxNumber(taxpayer),
        ledgerType: taxpayer.defterTuru || taxpayer.mihsapDefterTuru || null,
      },
      period,
      periodLabel: this.reportPeriodLabel(period),
      generatedAt: new Date().toISOString(),
      totals,
      categoryRows,
      vatByRate: Array.from(vatByRate.values())
        .map((row: any) => ({ ...row, ...this.roundReportBucket(row) }))
        .sort((a: any, b: any) => {
          const sideOrder = a.side === b.side ? 0 : a.side === 'SATIS' ? -1 : 1;
          if (sideOrder) return sideOrder;
          return Number(a.rate ?? 999) - Number(b.rate ?? 999);
        }),
      topSuppliers: this.topReportCounterparties(topSuppliers),
      topCustomers: this.topReportCounterparties(topCustomers),
      // Ba/Bs TASLAĞI: cari (VKN) bazında dönem KDV-hariç toplamı eşik (5.000 ₺) üstü olanlar.
      // Form Ba = alışlar, Form Bs = satışlar. Müşavir kontrol eder; resmi beyan değildir.
      formBaBsThreshold: 5000,
      formBa: this.formBaBsList(topSuppliers, 5000),
      formBs: this.formBaBsList(topCustomers, 5000),
      quality,
      controls,
      warnings: controls.warnings,
      assessment: [] as string[],
    };

    report.assessment = this.buildKdvClientAssessment(report);
    return report;
  }

  private normalizeReportPeriod(period?: string | null) {
    const value = String(period || '').trim();
    if (!/^\d{4}-\d{2}$/.test(value)) {
      throw new BadRequestException('Dönem YYYY-MM formatında olmalı');
    }
    const month = Number(value.slice(5, 7));
    if (month < 1 || month > 12) throw new BadRequestException('Geçersiz dönem');
    return value;
  }

  private reportPeriodLabel(period: string) {
    const monthNames = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ];
    const [year, month] = period.split('-');
    return `${monthNames[Number(month) - 1] || month} ${year}`;
  }

  private reportTaxpayerName(taxpayer: any) {
    return taxpayer?.companyName || [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') || 'Mükellef';
  }

  private reportTaxNumber(taxpayer: any) {
    const raw = taxpayer?.taxNumber || taxpayer?.identityNumber || '';
    return String(tryDecrypt(raw) || raw || '').replace(/[^\d]/g, '');
  }

  private reportNumber(value: any) {
    if (value === null || value === undefined || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private roundReportMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private emptyReportBucket(): ReportBucket {
    return { base: 0, vat: 0, total: 0, count: 0 };
  }

  private addReportBucket(bucket: ReportBucket, base: number, vat: number, total?: number, count = 1) {
    bucket.base += Number.isFinite(base) ? base : 0;
    bucket.vat += Number.isFinite(vat) ? vat : 0;
    bucket.total += Number.isFinite(total) ? total || 0 : base + vat;
    bucket.count += count;
  }

  private roundReportBucket<T extends ReportBucket>(bucket: T) {
    return {
      base: this.roundReportMoney(bucket.base),
      vat: this.roundReportMoney(bucket.vat),
      total: this.roundReportMoney(bucket.total),
      count: bucket.count,
    };
  }

  private classifyPurchaseInvoiceForReport(
    doc: any | null | undefined,
    invoice: { base: number; vat: number; total: number },
  ): Array<{ key: ReportCategoryKey; base: number; vat: number; total: number; count: number }> {
    const lines = Array.isArray(doc?.lines) ? doc.lines : [];
    const matrahLines = lines.filter((line: any) => String(line.group || '').toLowerCase() === 'matrah');
    const rawByCategory: Record<ReportCategoryKey, number> = {
      sales: 0,
      goods: 0,
      expenses: 0,
      unclassified: 0,
    };

    for (const line of matrahLines) {
      const amount = this.reportLineAmount(line, 'debit');
      if (amount <= REPORT_EPSILON) continue;
      const key = this.classifyPurchaseAccountCode(line.accountCode);
      rawByCategory[key] += amount;
    }

    const rawBase = rawByCategory.goods + rawByCategory.expenses + rawByCategory.unclassified;
    if (rawBase <= REPORT_EPSILON) {
      return [{
        key: 'unclassified',
        base: invoice.base,
        vat: invoice.vat,
        total: invoice.total || invoice.base + invoice.vat,
        count: 1,
      }];
    }

    const effectiveBase = invoice.base > REPORT_EPSILON ? invoice.base : rawBase;
    const scale = effectiveBase > REPORT_EPSILON ? effectiveBase / rawBase : 1;
    return (['goods', 'expenses', 'unclassified'] as ReportCategoryKey[])
      .filter((key) => rawByCategory[key] > REPORT_EPSILON)
      .map((key) => {
        const base = rawByCategory[key] * scale;
        const share = effectiveBase > REPORT_EPSILON ? base / effectiveBase : 0;
        const vat = invoice.vat * share;
        return {
          key,
          base,
          vat,
          total: base + vat,
          count: 1,
        };
      });
  }

  private classifyPurchaseAccountCode(accountCode?: string | null): ReportCategoryKey {
    if (!String(accountCode || '').trim()) return 'unclassified';
    if (this.accountCodeStartsWith(accountCode, GOODS_ACCOUNT_PREFIXES)) return 'goods';
    if (this.accountCodeStartsWith(accountCode, EXPENSE_ACCOUNT_PREFIXES)) return 'expenses';
    return 'unclassified';
  }

  private accountCodeStartsWith(accountCode: any, prefixes: string[]) {
    const raw = String(accountCode || '').trim();
    const compact = raw.replace(/[^\d]/g, '');
    return prefixes.some((prefix) => raw.startsWith(prefix) || compact.startsWith(prefix));
  }

  private reportLineAmount(line: any, preferredSide: 'debit' | 'credit') {
    const debit = this.reportNumber(line?.debit);
    const credit = this.reportNumber(line?.credit);
    const signed = preferredSide === 'credit' ? credit - debit : debit - credit;
    if (Math.abs(signed) > REPORT_EPSILON) return Math.abs(signed);
    return Math.max(Math.abs(debit), Math.abs(credit));
  }

  private async loadEarsivKdvBreakdowns(tenantId: string, taxpayerId: string, period: string) {
    const byId = new Map<string, any>();
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "id", "kdvBreakdown" FROM "earsiv_faturalar" WHERE "tenantId" = $1 AND "taxpayerId" = $2 AND "donem" = $3`,
        tenantId,
        taxpayerId,
        period,
      );
      for (const row of rows || []) byId.set(String(row.id), row.kdvBreakdown);
    } catch {
      // Eski ortamlarda kdvBreakdown kolonu olmayabilir; oran alanına fallback yapılır.
    }
    return byId;
  }

  /**
   * KDV raporunda gösterilebilir GEÇERLİ oran. Karışık oranlı faturada tek orana
   * indirgenen değer (KDV÷matrah) %17 gibi VAR OLMAYAN oranlar üretiyordu. Standart
   * orana (0/1/8/10/18/20) yakınsa ona snap'le; değilse null → "Diğer" kovasına düşsün.
   * Matrah/KDV değerleri korunur (toplam doğru kalır), yalnız oran etiketi düzelir.
   */
  private validReportRate(rate: any): number | null {
    const r = this.reportNumber(rate);
    if (!Number.isFinite(r)) return null;
    if (Math.abs(r) <= 0.5) return 0;
    for (const s of [1, 8, 10, 18, 20]) if (Math.abs(r - s) <= 0.5) return s;
    return null;
  }

  private normalizeReportBreakdown(raw: any, fallbackRate: any, fallbackBase: number, fallbackVat: number) {
    const parsed = typeof raw === 'string'
      ? (() => {
          try { return JSON.parse(raw); } catch { return null; }
        })()
      : raw;
    const rows = Array.isArray(parsed) ? parsed : [];
    const normalized = rows
      .map((item: any) => {
        const rate = this.reportNumber(item?.rate ?? item?.oran);
        const base = this.reportNumber(item?.base ?? item?.matrah);
        const vat = this.reportNumber(item?.amount ?? item?.tutar);
        return { rate: Number.isFinite(rate) ? rate : null, base, vat };
      })
      .filter((item) => Math.abs(item.base) > REPORT_EPSILON || Math.abs(item.vat) > REPORT_EPSILON);
    if (normalized.length > 0) return normalized;
    return [{
      // Tek-oran fallback'i: KDV÷matrah ile türetilen oran %17 gibi sahte olabilir →
      // geçerli değilse null ("Diğer"). Matrah/KDV aynen korunur.
      rate: this.validReportRate(fallbackRate),
      base: fallbackBase,
      vat: fallbackVat,
    }];
  }

  private addReportVatBreakdown(
    target: Map<string, ReportBucket & { side: string; rate: number | null; label: string }>,
    side: 'ALIS' | 'SATIS',
    breakdown: Array<{ rate: number | null; base: number; vat: number }>,
    fallbackBase: number,
    fallbackVat: number,
  ) {
    const rows = breakdown.length ? breakdown : [{ rate: null, base: fallbackBase, vat: fallbackVat }];
    for (const row of rows) {
      const rate = Number.isFinite(Number(row.rate)) ? Number(row.rate) : null;
      const label = rate === null ? 'Diğer' : `%${rate.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
      const key = `${side}|${label}`;
      const current = target.get(key) || { side, rate, label, ...this.emptyReportBucket() };
      this.addReportBucket(current, row.base, row.vat, row.base + row.vat, 1);
      target.set(key, current);
    }
  }

  private addReportCounterparty(
    target: Map<string, ReportCounterparty>,
    input: { name: string; taxNo?: string | null; base: number; vat: number; total: number },
  ) {
    const cleanTaxNo = String(input.taxNo || '').replace(/[^\d]/g, '');
    const name = String(input.name || 'Bilinmeyen firma').trim() || 'Bilinmeyen firma';
    const key = cleanTaxNo || name.toLocaleUpperCase('tr-TR');
    const current = target.get(key) || { name, taxNo: cleanTaxNo || null, ...this.emptyReportBucket() };
    this.addReportBucket(current, input.base, input.vat, input.total, 1);
    target.set(key, current);
  }

  private topReportCounterparties(target: Map<string, ReportCounterparty>) {
    return Array.from(target.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((row) => ({ name: row.name, taxNo: row.taxNo || null, ...this.roundReportBucket(row) }));
  }

  /**
   * Ba/Bs taslağı: cari (VKN) bazında dönem KDV-HARİÇ (matrah) toplamı eşik üstü olan
   * tüm karşı tarafları döner (top-5 değil, tam liste). Müşavir kontrol için; resmi değildir.
   */
  private formBaBsList(target: Map<string, ReportCounterparty>, threshold: number) {
    return Array.from(target.values())
      .map((row) => ({ name: row.name, taxNo: row.taxNo || null, ...this.roundReportBucket(row) }))
      .filter((r) => Math.abs(Number(r.base) || 0) >= threshold)
      .sort((a, b) => (Number(b.base) || 0) - (Number(a.base) || 0));
  }

  private reportPeriodVariants(period: string) {
    const [year, month] = period.split('-');
    const looseMonth = String(Number(month));
    return Array.from(new Set([period, `${year}/${month}`, `${year}/${looseMonth}`, `${year}-${looseMonth}`]));
  }

  private async buildKdvControlReport(tenantId: string, taxpayerId: string, period: string) {
    const sessions = await (this.prisma as any).kdvControlSession.findMany({
      where: {
        tenantId,
        taxpayerId,
        periodLabel: { in: this.reportPeriodVariants(period) },
        type: { in: ['KDV_191', 'ISLETME_GIDER', 'KDV_391', 'ISLETME_GELIR'] },
      },
      select: {
        id: true,
        type: true,
        periodLabel: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const purchaseSession = sessions.find((s: any) => ['KDV_191', 'ISLETME_GIDER'].includes(String(s.type)));
    const salesSession = sessions.find((s: any) => ['KDV_391', 'ISLETME_GELIR'].includes(String(s.type)));
    const [purchase, sales] = await Promise.all([
      this.summarizeKdvControlSession(tenantId, purchaseSession),
      this.summarizeKdvControlSession(tenantId, salesSession),
    ]);

    const warnings: string[] = [];
    if (!purchase) warnings.push('Alış/indirilecek KDV için kontrol oturumu bulunamadı.');
    if (!sales) warnings.push('Satış/hesaplanan KDV için kontrol oturumu bulunamadı.');
    for (const item of [purchase, sales].filter(Boolean) as any[]) {
      if ((item.issueTotal || 0) > 0) {
        warnings.push(`${item.label} kontrolünde ${item.issueTotal} kayıt dikkat istiyor.`);
      }
      for (const warning of item.serialWarnings || []) warnings.push(warning.message || warning.mesaj || String(warning));
    }

    return { purchase, sales, warnings };
  }

  private async summarizeKdvControlSession(tenantId: string, session: any | null | undefined) {
    if (!session) return null;
    let stats: any = null;
    try {
      stats = await this.kdvControl.getSessionStats(session.id, tenantId);
    } catch (e: any) {
      this.logger.warn(`KDV kontrol istatistikleri okunamadi (${session.id}): ${e?.message || e}`);
    }
    const issueTotal =
      this.reportNumber(stats?.partialMatch) +
      this.reportNumber(stats?.unmatched) +
      this.reportNumber(stats?.needsReview) +
      this.reportNumber(stats?.rejected);
    return {
      id: session.id,
      type: session.type,
      label: ['KDV_191', 'ISLETME_GIDER'].includes(String(session.type))
        ? 'Alış KDV'
        : 'Satış KDV',
      periodLabel: session.periodLabel,
      status: session.status,
      matched: this.reportNumber(stats?.matched),
      partialMatch: this.reportNumber(stats?.partialMatch),
      unmatched: this.reportNumber(stats?.unmatched),
      needsReview: this.reportNumber(stats?.needsReview),
      rejected: this.reportNumber(stats?.rejected),
      totalRecords: this.reportNumber(stats?.totalRecords),
      totalImages: this.reportNumber(stats?.totalImages),
      issueTotal,
      serialWarnings: Array.isArray(stats?.seriUyarilari) ? stats.seriUyarilari : [],
      updatedAt: session.updatedAt,
    };
  }

  private buildKdvClientAssessment(report: any) {
    const totals = report.totals || {};
    const quality = report.quality || {};
    const controls = report.controls || {};
    const diff = this.reportNumber(totals.periodVatDifference);
    const sales = this.reportNumber(totals.salesTotal);
    const purchase = this.reportNumber(totals.purchaseTotal);
    const lines: string[] = [];

    if (!quality.invoiceCount) {
      return [
        'Genel tablo: Bu dönem için fatura kaydı bulunamadı.',
        'Kontrol notu: Raporu mükellefe göndermeden önce dönem ve mükellef seçiminin doğru olduğundan emin olunmalıdır.',
      ];
    }

    lines.push(`Genel tablo: Bu dönem ${this.formatReportMoney(sales)} TL satış, ${this.formatReportMoney(purchase)} TL alış ve gider faturası görünmektedir.`);
    if (diff > REPORT_EPSILON) {
      lines.push(`KDV yönü: Fatura kayıtlarına göre hesaplanan KDV, indirilecek KDV'den ${this.formatReportMoney(diff)} TL fazla; dönem içi ödeme yönü oluşmaktadır.`);
    } else if (diff < -REPORT_EPSILON) {
      lines.push(`KDV yönü: Fatura kayıtlarına göre indirilecek KDV, hesaplanan KDV'den ${this.formatReportMoney(Math.abs(diff))} TL fazla; dönem içi devreden yönü oluşmaktadır.`);
    } else {
      lines.push('KDV yönü: Fatura kayıtlarına göre hesaplanan ve indirilecek KDV birbirine çok yakın görünmektedir.');
    }

    const goods = this.reportNumber(totals.purchaseGoodsTotal);
    const expenses = this.reportNumber(totals.expensesTotal);
    const unclassified = this.reportNumber(totals.unclassifiedPurchaseTotal);
    lines.push(`Alış yapısı: Mal/stok alışları ${this.formatReportMoney(goods)} TL, masraf/giderler ${this.formatReportMoney(expenses)} TL seviyesindedir.`);
    if (report.topSuppliers?.[0] || report.topCustomers?.[0]) {
      const supplier = report.topSuppliers?.[0]?.name;
      const customer = report.topCustomers?.[0]?.name;
      lines.push(`Cari yoğunluk: En yüksek alış ${supplier || 'belirlenemeyen firma'}, en yüksek satış ${customer || 'belirlenemeyen müşteri'} tarafında yoğunlaşmaktadır.`);
    }
    if (unclassified > REPORT_EPSILON || quality.missingAccountCodeCount > 0) {
      lines.push(`Hesap kodu kontrolü: ${quality.missingAccountCodeCount || 0} belgede hesap kodu eksikliği, ${quality.unclassifiedCount || 0} alış faturasında sınıflandırma ihtiyacı vardır.`);
    }
    if ((controls.warnings || []).length > 0) {
      lines.push(`KDV kontrol notu: ${controls.warnings[0]} Bu uyarılar netleşmeden rapor nihai beyan sonucu gibi değerlendirilmemelidir.`);
    } else {
      lines.push('KDV kontrol notu: Bu rapor fatura kayıtlarına göre hazırlanmıştır; devreden KDV, tevkifat, istisna ve beyanname düzeltmeleri ayrıca kontrol edilmelidir.');
    }
    return lines.slice(0, 6);
  }

  private formatReportMoney(value: number) {
    return this.roundReportMoney(value).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

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

    const currentGlobal = currentConfig.taxpayers?.global || {};
    const nextGlobal = provider === 'PARASUT' && (apiKey || apiSecret)
      ? {
          ...currentGlobal,
          taxpayerId: null,
          label: String(currentGlobal.label || catalog.label).trim(),
          isActive: currentGlobal.isActive !== false,
          hasApiKey: apiKey ? true : Boolean(currentGlobal.hasApiKey),
          hasApiSecret: apiSecret ? true : Boolean(currentGlobal.hasApiSecret),
          updatedAt: new Date().toISOString(),
          updatedBy: updatedBy || null,
          ...(apiKey ? { encryptedApiKey: encrypt(apiKey) } : {}),
          ...(apiSecret ? { encryptedApiSecret: encrypt(apiSecret) } : {}),
        }
      : currentGlobal;

    const config = {
      version: 1,
      provider,
      label: String(input.label || currentConfig.label || catalog.label).trim(),
      kind: catalog.kind,
      taxpayers: {
        ...(currentConfig.taxpayers || {}),
        ...(provider === 'PARASUT' && (apiKey || apiSecret) ? { global: nextGlobal } : {}),
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
    try {
      return await this._fetchConfiguredIntegrationsImpl(tenantId, input, userId);
    } catch (err: any) {
      this.logger.error(
        `fetchConfiguredIntegrations hata (tenant=${tenantId}, tx=${input?.taxpayerId}): ${err?.message || err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Sorgu basarisiz: ${err?.message || 'bilinmeyen hata'}. Detaylar sunucu loglarinda.`,
      );
    }
  }

  private async _fetchConfiguredIntegrationsImpl(
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
        tenantId: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
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
      // Hesap planı tam görünsün — bazı mükelleflerde 800+ kod var (eski 1000 tavanı
      // büyük planları kesip "eksik" gösteriyordu); 5000'e çıkarıldı.
      take: Math.min(Math.max(opts.limit || 250, 1), 5000),
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
    input: { taxpayerId: string; code: string; name: string; isCari?: boolean; vkn?: string },
  ) {
    if (!input.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    if (!input.code?.trim()) throw new BadRequestException('Hesap kodu gerekli');
    if (!input.name?.trim()) throw new BadRequestException('Hesap adı gerekli');

    const code = input.code.trim();
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

    // Hesap Planı Kontrol: aynı kod planda (Luca'dan ya da yerel) zaten varsa tekrar açma.
    const dup = await (this.prisma as any).lucaAccountPlanLine.findFirst({
      where: { snapshotId: latest.id, accountCode: code },
      select: { id: true, syncedToLuca: true },
    });
    if (dup) {
      throw new BadRequestException(`"${code}" hesabı planda zaten var.`);
    }

    // Cari işareti verilmemişse koddan türet (120/320/32x/331 = cari). VKN'yi sadeleştir.
    const isCari = input.isCari != null ? !!input.isCari : /^(120|320|329|331)/.test(code);
    const vkn = (input.vkn || '').replace(/\D/g, '').trim() || null;

    // Lokal hesap olarak işaretle (Luca'ya henüz gönderilmedi → push-to-luca ile açılacak)
    const created = await (this.prisma as any).lucaAccountPlanLine.create({
      data: {
        snapshotId: latest.id,
        accountCode: code,
        accountName: input.name.trim(),
        level: code.split('.').length,
        debitBalance: 0,
        creditBalance: 0,
        source: 'LOCAL',
        syncedToLuca: false,
        isCari,
        vkn,
      },
    });

    return { ok: true, id: created.id, code: created.accountCode, name: created.accountName, isCari, vkn, local: true, syncedToLuca: false };
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
      select: { id: true, accountCode: true, accountName: true, isCari: true, vkn: true },
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

  /**
   * ④ OTOMATİK PLAN TAZELEME: BİLANÇO mükellefinde, hesap planı yoksa ya da eskiyse (>3 gün) ve
   * son 1 saatte tetiklenmemişse Luca'dan plan çekmeyi başlatır. Plan gelince importAccountPlanSnapshot
   * zaten otomatik yeniden eşleştirir. İŞLETME defterinde tek düzen hesap planı YOK → atlanır.
   * Fire-and-forget: hata okuma/aktarımı engellemez.
   */
  private async maybeRefreshAccountPlan(tenantId: string, taxpayerId?: string | null): Promise<void> {
    if (!taxpayerId) return;
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { defterTuru: true },
    }).catch(() => null);
    // SADECE bilanço — işletme defterinde tek düzen hesap planı yok (kullanıcı kuralı).
    if (!tp || String(tp.defterTuru || '').toUpperCase() !== 'BILANCO') return;
    // Son 1 saatte plan-çekme işi tetiklendiyse tekrar etme (Luca'ya mükerrer iş yağdırma).
    const recent = await (this.prisma as any).lucaFetchJob.findFirst({
      where: { tenantId, mukellefId: taxpayerId, tip: 'ACCOUNT_PLAN', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      select: { id: true },
    }).catch(() => null);
    if (recent) return;
    // SADECE planı HİÇ OLMAYAN mükellefte çek (kullanıcı kararı). Planı varsa DOKUNMA — Luca yerel
    //   makinede, gece/kapalıyken çalışmaz; eski-plan tazeleme ayrı planlanacak. Bu yüzden "eskiyse çek"
    //   mantığı kaldırıldı; sadece ilk kurulum (plan yok) tetikler.
    const snap = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId, status: 'READY' },
      select: { id: true },
    }).catch(() => null);
    if (snap) return; // plan zaten var → tetikleme
    await this.refreshAccountPlan(tenantId, { taxpayerId, createdBy: 'oto-plan-ilk-kurulum' }).catch(() => {});
  }

  /**
   * Toplu hesap plani yenileme. Verilen mukellef id listesi (yoksa tum aktif mukellefler)
   * icin sirayla refreshAccountPlan'i cagirir. Her biri icin Luca Local Agent'a job yaratir.
   */
  async refreshAccountPlanBulk(
    tenantId: string,
    opts: { taxpayerIds?: string[]; createdBy?: string; targetDeviceId?: string },
  ) {
    let ids: string[] = Array.isArray(opts.taxpayerIds) ? opts.taxpayerIds.filter(Boolean) : [];
    if (ids.length === 0) {
      // Sadece aktif + Bilanço esasi defter tutan + isi birakmamis mukellefler
      // Isletme defteri mukelleflerinde hesap plani yok (tek duzen muhasebe degil)
      const all = await (this.prisma as any).taxpayer.findMany({
        where: {
          tenantId,
          isActive: true,
          defterTuru: 'BILANCO',
          OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
        },
        select: { id: true },
        take: 2000,
      });
      ids = all.map((t: any) => t.id);
    }
    const results: { taxpayerId: string; ok: boolean; jobId?: string; error?: string }[] = [];
    for (const taxpayerId of ids) {
      try {
        const result = await this.refreshAccountPlan(tenantId, {
          taxpayerId,
          createdBy: opts.createdBy,
          targetDeviceId: opts.targetDeviceId,
        });
        results.push({ taxpayerId, ok: true, jobId: result?.job?.id });
      } catch (err: any) {
        results.push({ taxpayerId, ok: false, error: err?.message || String(err) });
      }
    }
    const success = results.filter((r) => r.ok).length;
    return { ok: true, total: results.length, success, failed: results.length - success, results };
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

  private inferUploadMimeType(originalName: string, buffer?: Buffer, fallbackMimeType?: string) {
    if (buffer?.length) {
      if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
      if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
      if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
      if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
      if (buffer.length >= 4 && ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4d && buffer[1] === 0x4d))) return 'image/tiff';
      if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
      if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
      if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
        if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc') || brand.startsWith('heif')) return 'image/heic';
        if (brand.startsWith('avif')) return 'image/avif';
      }
      const head = buffer.slice(0, Math.min(buffer.length, 512)).toString('utf8').trimStart();
      if (/^<\?xml|^<Invoice[\s>]|^<ArchiveInvoice[\s>]/i.test(head)) return 'application/xml';
    }

    const ext = (originalName.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'xml' || ext === 'ubl') return 'application/xml';
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'jpe' || ext === 'jfif') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'heic' || ext === 'heif') return 'image/heic';
    if (ext === 'avif') return 'image/avif';
    return fallbackMimeType || 'application/octet-stream';
  }

  private isZipUpload(file: Express.Multer.File) {
    const mime = String(file.mimetype || '').toLowerCase();
    return (
      mime.includes('zip') ||
      /\.zip$/i.test(file.originalname || '') ||
      (file.buffer?.length >= 2 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b)
    );
  }

  private isOcrSupportedUpload(originalName: string, mimeType: string) {
    const mime = String(mimeType || '').toLowerCase();
    return (
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime.includes('xml') ||
      /\.(pdf|jpe?g|jpe|jfif|png|webp|gif|tiff?|bmp|heic|heif|avif|xml|ubl)$/i.test(originalName || '')
    );
  }

  private async expandUploadedFiles(files: Express.Multer.File[]) {
    const expanded: Express.Multer.File[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const maxExpandedFiles = 200;
    const maxExpandedFileSize = 25 * 1024 * 1024;

    for (const file of files) {
      if (!this.isZipUpload(file)) {
        const mimeType = this.inferUploadMimeType(file.originalname, file.buffer, file.mimetype);
        if (!this.isOcrSupportedUpload(file.originalname, mimeType)) {
          skipped.push({ name: file.originalname || 'isimsiz-dosya', reason: 'Desteklenmeyen dosya tipi' });
          continue;
        }
        expanded.push({ ...file, mimetype: mimeType } as Express.Multer.File);
        continue;
      }

      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(file.buffer);
      } catch {
        throw new BadRequestException(`ZIP arsivi okunamadi: ${file.originalname}`);
      }

      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      for (const entry of entries) {
        if (expanded.length >= maxExpandedFiles) {
          throw new BadRequestException(`Tek yuklemede en fazla ${maxExpandedFiles} belge islenebilir`);
        }
        const entryName = String(entry.name || '').split('/').filter(Boolean).join('/');
        if (!entryName) continue;

        const buffer = await entry.async('nodebuffer');
        if (buffer.length > maxExpandedFileSize) {
          throw new BadRequestException(`ZIP icindeki dosya 25 MB ustunde: ${entryName}`);
        }
        const visibleName = entryName.split('/').pop() || entryName;
        if (/^(?:__MACOSX|\.DS_Store|Thumbs\.db)$/i.test(visibleName)) continue;
        const mimeType = this.inferUploadMimeType(entryName, buffer);
        if (!this.isOcrSupportedUpload(entryName, mimeType)) {
          skipped.push({ name: entryName, reason: 'Desteklenmeyen dosya tipi' });
          continue;
        }

        expanded.push({
          ...file,
          originalname: visibleName,
          mimetype: mimeType,
          size: buffer.length,
          buffer,
        } as Express.Multer.File);
      }
    }

    return { files: expanded, skipped };
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
      period?: string;
    },
  ) {
    if (!files?.length) throw new BadRequestException('En az bir belge gerekli');
    const expandedUpload = await this.expandUploadedFiles(files);
    const uploadFiles = expandedUpload.files;
    if (!uploadFiles.length) {
      throw new BadRequestException({
        message: 'Yuklenen arsivde islenebilir belge bulunamadi',
        skipped: expandedUpload.skipped,
      });
    }
    const created: any[] = [];
    const uploadPeriodDate = periodAnchorDate(opts.period);

    for (const file of uploadFiles) {
      const ext = (file.originalname.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
      const s3Key = `invoice-accounting/${tenantId}/${opts.taxpayerId || 'general'}/${randomUUID()}.${ext}`;
      await this.storage.putBuffer(s3Key, file.buffer, file.mimetype, {
        'original-name': encodeURIComponent(file.originalname),
        'tenant-id': tenantId,
        source: opts.source || 'manual-web',
      });

      const isOcrSupported = this.isOcrSupportedUpload(file.originalname, file.mimetype);
      const imageHash = this.ocr.computeImageHash(file.buffer);
      const duplicate = await this.findDuplicate(tenantId, {
        taxpayerId: opts.taxpayerId || null,
        imageHash,
      });
      const doc = await (this.prisma as any).invoiceAccountingDocument.create({
        data: {
          tenantId,
          taxpayerId: opts.taxpayerId || null,
          source: opts.source || 'manual-web',
          sourceRefId: null,
          documentType: opts.documentType || 'OKC_FIS',
          invoiceKind: opts.invoiceKind || 'ALIS',
          status: duplicate ? 'NEEDS_REVIEW' : isOcrSupported ? 'PROCESSING' : 'NEEDS_REVIEW',
          faturaTarihi: uploadPeriodDate,
          duplicateOfId: duplicate?.duplicateOfId || null,
          duplicateReason: duplicate?.duplicateReason || null,
          duplicateSeverity: duplicate?.duplicateSeverity || null,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          s3Key,
          imageHash,
          ocrStatus: isOcrSupported ? 'PENDING' : 'FAILED',
          ocrEngine: isOcrSupported ? null : 'unsupported',
          ocrRawText: isOcrSupported ? null : 'OCR desteklenmeyen dosya tipi',
          ocrConfidence: isOcrSupported ? null : 0,
          createdBy: userId || null,
        },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
      });
      created.push(doc);

      if (isOcrSupported) {
        this.enqueueUploadedDocumentOcr(tenantId, doc.id, file.buffer, file.originalname, opts.forceClaude);
      }
    }

    this.logger.log(
      `Belge yukleme tamamlandi: tenant=${tenantId} input=${files.length} expanded=${uploadFiles.length} skipped=${expandedUpload.skipped.length} created=${created.length}`,
    );

    return { uploaded: created.length, documents: created, skipped: expandedUpload.skipped };
  }

  private enqueueUploadedDocumentOcr(
    tenantId: string,
    documentId: string,
    buffer: Buffer,
    originalName: string,
    forceClaude?: boolean,
  ) {
    this.uploadOcrQueue.push({ tenantId, documentId, buffer, originalName, forceClaude });
    this.drainUploadedOcrQueue();
  }

  private drainUploadedOcrQueue() {
    while (this.uploadOcrActive < this.uploadOcrConcurrency && this.uploadOcrQueue.length) {
      const job = this.uploadOcrQueue.shift();
      if (!job) return;
      this.uploadOcrActive++;
      if (job.documentId) this.uploadOcrActiveIds.add(job.documentId);
      const work = job.kind === 'mihsap'
        ? this.processMihsapDocumentOcr(
            job.tenantId,
            job.documentId,
            String(job.mihsapInvoiceId || ''),
            (job.invoiceKind || 'ALIS') as 'ALIS' | 'SATIS',
          )
        : job.kind === 'classify'
        ? this.runQueuedClassify(job.tenantId, job.documentId)
        : job.kind === 'ai-read'
        ? this.runQueuedAiRead(job.tenantId, job.documentId)
        : this.processUploadedDocumentOcr(
            job.tenantId,
            job.documentId,
            job.buffer as Buffer,
            String(job.originalName || ''),
            job.forceClaude,
          );
      void work
        .catch((e: any) => {
          this.logger.error(`Belge OCR arka plan islemi basarisiz (${job.documentId}): ${e?.message || e}`);
        })
        .finally(() => {
          this.uploadOcrActive = Math.max(0, this.uploadOcrActive - 1);
          if (job.documentId) this.uploadOcrActiveIds.delete(job.documentId);
          this.drainUploadedOcrQueue();
        });
    }
  }

  // Kuyruktan okuma (sunucu tarafı) — sayfa değişse de DURMAZ. ocrStatus'u yönetir
  // ki ilerleme şeridi doğru göstersin. aiReadDocument fileUrl ile Mihsap/e-Arşiv/yüklenen
  // belgeyi DOĞRU getirir (mihsapId→kayıt çözümü orada) + XML(UBL)/PDF(metin)/görüntü(Max-vision)
  // hepsini okur. NOT: eskiden Mihsap'ı processMihsapDocumentOcr'a yönlendiriyordum ama oraya
  // mihsapId'yi DB-id sanıp geçiriyordum → "Fatura kaydı bulunamadı" hatası. Düzeltildi.
  // ARKA PLAN SINIFLANDIRMA: okuma anında saklanan içerik snippet'iyle (ocrData.icerikMetni) faaliyet+içerik
  // muhakemesi yapıp kayıt türü/giderTuru'yu doldurur + hesap eşleştirmesini yeniler. Okuma şeridini bekletmez
  // (e-Fatura/e-Arşiv anında okunur; kayıt türü/hesap arkadan dolar). Max aboneliği.
  private async runQueuedClassify(tenantId: string, documentId: string) {
    const doc = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, taxpayerId: true, invoiceKind: true, ocrData: true },
    }).catch(() => null);
    if (!doc) return;
    const od: any = doc.ocrData || {};
    const content = String(od.icerikMetni || '');
    if (!content || content.length < 20) return;
    let mukellefBilgi = '';
    let isIsletme = false;
    if (doc.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: doc.taxpayerId, tenantId },
        select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true, defterTuru: true },
      }).catch(() => null);
      if (tp) {
        isIsletme = String(tp.defterTuru || '').toUpperCase() === 'ISLETME';
        const ad = String(tp.companyName || (String(tp.firstName || '') + ' ' + String(tp.lastName || ''))).trim();
        const faaliyet = String(tp.faaliyetAciklama || '').trim();
        mukellefBilgi = [ad && ('ünvanı "' + ad + '"'), faaliyet ? ('faaliyeti: ' + faaliyet) : (tp.naceKodu ? ('NACE ' + tp.naceKodu) : ''), isIsletme ? 'İşletme defteri' : 'Bilanço usulü'].filter(Boolean).join(', ');
      }
    }
    const c = await this.aiClassifyAccounting(content, mukellefBilgi, isIsletme).catch(() => null);
    const kind = doc.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS';
    const patch: any = { ...od };
    delete patch.icerikMetni; delete patch.needsClassify; // snippet'i temizle (DB bloat olmasın)
    if (c) {
      if (c.giderTuru) patch.giderTuru = String(c.giderTuru).slice(0, 40);
      if (c.kategori) patch.matrahKategori = c.kategori;
      if (isIsletme && (c.isletmeKayitTuru || c.giderTuru || c.kategori)) {
        let isl = resolveIslAi(kind, { isletmeKayitTuru: c.isletmeKayitTuru, isletmeAltTuru: c.isletmeAltTuru, isletmeNeden: c.isletmeNeden, giderTuru: c.giderTuru, kategori: c.kategori, saticiAd: doc.vendorName });
        if (isl) {
          // GİB Defter-Beyan: Alış/Satış + İşlem + Belge Türü'nü belgenin sinyallerinden türet (XML yolu).
          const islText = [c.giderTuru, isl.kayitAltAd, c.isletmeNeden].filter(Boolean).join(' ');
          const islKdvVar = typeof od?.kdvTutari === 'number' ? od.kdvTutari > 0 : undefined;
          isl = {
            ...isl,
            alisSatisKod: isletmeAlisSatisTuru(kind, { isReturn: od?.isReturn === true, tevkifat: od?.tevkifatHint === true || Number(od?.tevkifatOrani) > 0, kdvVar: islKdvVar, text: islText }),
            islemTuruKod: isletmeIslemTuru(kind, islText),
            belgeTuruKod: defaultBelgeTuruKod(doc.documentType, kind),
          };
          patch.isletme = isl;
        }
      }
    }
    await (this.prisma as any).invoiceAccountingDocument.update({ where: { id: doc.id }, data: { ocrData: patch } }).catch(() => {});
    // giderTuru artık dolu → hesap eşleştirmesini yenile (kural + AI eskalasyon arkada çalışır).
    if (doc.taxpayerId) await this.rematchDocumentsWithLatestAccountPlan(tenantId, doc.taxpayerId, [doc.id]).catch(() => {});
  }

  private async runQueuedAiRead(tenantId: string, documentId: string) {
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: documentId, tenantId }, data: { ocrStatus: 'IN_PROGRESS' },
    }).catch(() => {});
    let r: any = await this.aiReadDocument(tenantId, documentId).catch((e: any) => ({ ok: false, reason: e?.message || 'okuma hatası' }));
    // GÜVENLİK AĞI: Max-vision çökerse (ör. "exited with code 1") Mihsap belgesini DOĞRU
    // mihsapInvoice DB id'siyle processMihsapDocumentOcr'a düşür → Azure yedeği okur.
    if (!r?.ok) {
      const doc = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { id: documentId, tenantId }, select: { source: true, sourceRefId: true, invoiceKind: true },
      }).catch(() => null);
      if (doc?.source === 'mihsap' && doc?.sourceRefId) {
        const inv = await (this.prisma as any).mihsapInvoice.findFirst({
          where: { tenantId, mihsapId: String(doc.sourceRefId) }, select: { id: true },
        }).catch(() => null);
        if (inv?.id) {
          await this.processMihsapDocumentOcr(
            tenantId, documentId, String(inv.id),
            (doc.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS') as 'ALIS' | 'SATIS',
          ).catch(() => {});
          // processMihsapDocumentOcr ocrStatus'u kendi içinde yazar (SUCCESS/NEEDS_REVIEW/FAILED).
          const after = await (this.prisma as any).invoiceAccountingDocument.findFirst({
            where: { id: documentId, tenantId }, select: { ocrStatus: true },
          }).catch(() => null);
          if (after && after.ocrStatus !== 'FAILED') return; // Azure okudu
        }
      }
    }
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: documentId, tenantId },
      data: r?.ok
        ? { ocrStatus: 'SUCCESS' }
        : { ocrStatus: 'FAILED', lucaErrorMessage: String(r?.reason || 'okunamadı').slice(0, 300) },
    }).catch(() => {});
  }

  /** Seçili belgeleri SUNUCU kuyruğunda AI ile oku (frontend döngüsü değil → sayfa
   *  değişince durmaz). Hemen döner; ilerleme ocrProgress ile izlenir. */
  async aiReadBatch(tenantId: string, documentIds: string[]) {
    const ids = [...new Set((documentIds || []).map((s) => String(s || '').trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Belge seçilmedi');
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, id: { in: ids }, status: { not: 'APPROVED' } },
      select: { id: true, taxpayerId: true },
    });
    // ÖNCELİK: kullanıcının elle "AI ile oku" isteği kuyruğun ÖNÜNE (unshift) → arka plan
    // kurtarma (push, arkada) onu bekletmesin; seçtiğin mükellefin belgeleri hemen sıraya geçer.
    for (const d of docs) {
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: d.id, tenantId }, data: { ocrStatus: 'PENDING' },
      }).catch(() => {});
      this.uploadOcrQueue.unshift({ tenantId, documentId: d.id, kind: 'ai-read' });
    }
    this.drainUploadedOcrQueue();
    return { queued: docs.length, skipped: ids.length - docs.length };
  }

  /** OCR/okuma ilerlemesi — tarama şeridi için. ocrStatus'a göre sayar. */
  async ocrProgress(tenantId: string, opts: { taxpayerId?: string; period?: string }) {
    const where: any = {
      tenantId,
      ...(opts.taxpayerId ? { taxpayerId: opts.taxpayerId } : {}),
      ...periodWhere(opts.period),
    };
    const grouped = await (this.prisma as any).invoiceAccountingDocument.groupBy({
      by: ['ocrStatus'], where, _count: { _all: true },
    }).catch(() => []);
    let pending = 0, inProgress = 0, failed = 0, done = 0, total = 0;
    for (const g of grouped) {
      const c = g._count?._all || 0;
      total += c;
      const s = String(g.ocrStatus || '').toUpperCase();
      if (s === 'PENDING') pending += c;
      else if (s === 'IN_PROGRESS') inProgress += c;
      else if (s === 'FAILED') failed += c;
      else done += c;
    }
    return { total, pending, inProgress, failed, done, reading: pending + inProgress, active: pending + inProgress > 0, queued: this.uploadOcrQueue.length };
  }

  /**
   * Faz F/6: EKSİK BELGE TAKİBİ — bir satıcı son 3 ayın en az 2'sinde alış faturası
   * gönderdiyse ama bu dönem GÖNDERMEMİŞSE uyarır ("bu satıcıdan her ay gelir, bu ay yok").
   * Mevcut belgelerden hesaplanır (migration yok). Rakiplerde var, TR'de yok.
   */
  async missingSuppliers(tenantId: string, opts: { taxpayerId?: string; period?: string }) {
    const taxpayerId = String(opts.taxpayerId || '').trim();
    const period = String(opts.period || '').trim();
    const mm = period.match(/^(\d{4})-(\d{1,2})$/);
    if (!taxpayerId || !mm) return { missing: [], period };
    const y = Number(mm[1]); const m = Number(mm[2]);
    const start = new Date(Date.UTC(y, m - 4, 1)); // bu ay + 3 önceki ay
    const end = new Date(Date.UTC(y, m, 1));
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, taxpayerId, invoiceKind: 'ALIS', faturaTarihi: { gte: start, lt: end }, sellerVkn: { not: null } },
      select: { sellerVkn: true, vendorName: true, faturaTarihi: true },
    }).catch(() => []);
    const curKey = `${y}-${String(m).padStart(2, '0')}`;
    const priorMonths = [1, 2, 3].map((i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; });
    const byVkn = new Map<string, { name: string; periods: Set<string>; lastSeen: string }>();
    for (const d of docs) {
      const vkn = String(d.sellerVkn || '').replace(/\D/g, '');
      if (vkn.length !== 10 && vkn.length !== 11) continue;
      const dt = d.faturaTarihi ? new Date(d.faturaTarihi) : null;
      if (!dt || Number.isNaN(dt.getTime())) continue;
      const pk = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      const e = byVkn.get(vkn) || { name: d.vendorName || vkn, periods: new Set<string>(), lastSeen: pk };
      e.periods.add(pk);
      if (pk > e.lastSeen) e.lastSeen = pk;
      if (d.vendorName) e.name = d.vendorName;
      byVkn.set(vkn, e);
    }
    const missing: Array<{ vkn: string; name: string; lastSeen: string; gecmisAy: number }> = [];
    for (const [vkn, e] of byVkn) {
      const priorCount = priorMonths.filter((pm) => e.periods.has(pm)).length;
      if (priorCount >= 2 && !e.periods.has(curKey)) {
        missing.push({ vkn, name: e.name, lastSeen: e.lastSeen, gecmisAy: priorCount });
      }
    }
    missing.sort((a, b) => b.gecmisAy - a.gecmisAy);
    return { missing, period: curKey };
  }

  private async processUploadedDocumentOcr(
    tenantId: string,
    documentId: string,
    buffer: Buffer,
    originalName: string,
    forceClaude?: boolean,
  ) {
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: documentId, tenantId },
      data: { ocrStatus: 'IN_PROGRESS' },
    });

    try {
      const ocrResult = await this.ocr.extractFromImage(buffer, originalName, { forceClaude });
      const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { id: documentId, tenantId },
        select: {
          id: true,
          taxpayerId: true,
          documentType: true,
          invoiceKind: true,
          duplicateOfId: true,
          duplicateReason: true,
          duplicateSeverity: true,
          imageHash: true,
          faturaTarihi: true,
        },
      });
      if (!existing) return;
      const invoiceKind = String(existing.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
      const isSale = invoiceKind === 'SATIS';

      const imageHash = ocrResult.imageHash || existing.imageHash || this.ocr.computeImageHash(buffer);
      const duplicate = await this.findDuplicate(tenantId, {
        taxpayerId: existing.taxpayerId || null,
        belgeNo: ocrResult.belgeNo || null,
        sellerVkn: ocrResult.saticiVkn || null,
        totalAmount: ocrResult.totalTutari || null,
        imageHash,
      }, documentId);

      const duplicateOfId = duplicate?.duplicateOfId || existing.duplicateOfId || null;
      // K2: güven skoru "doluluk" ölçüyor — yüksek olsa bile İÇERİK şüpheliyse (validationScore
      // düşük ya da OCR sorun bildirdiyse) SUCCESS sayma, insan kontrolüne (NEEDS_REVIEW) düşür.
      const contentOk = (ocrResult.validationScore == null || ocrResult.validationScore >= 0.7) && !(ocrResult.validationIssues?.length);
      const ocrStatus = ocrResult.confidence >= 0.7 && contentOk ? 'SUCCESS' : 'NEEDS_REVIEW';
      const status = duplicateOfId ? 'NEEDS_REVIEW' : ocrStatus === 'SUCCESS' ? 'READY' : 'NEEDS_REVIEW';
      // Plan yoksa kod atanmasın (diğer yollarla tutarlı) — placeholder 770/600 sızmasın.
      const lines = await this.gateCodesByPlan(tenantId, existing.taxpayerId, this.linesFromOcr(ocrResult, invoiceKind));

      await (this.prisma as any).$transaction(async (tx: any) => {
        await tx.invoiceAccountingLine.deleteMany({ where: { documentId } });
        if (lines.length) {
          await tx.invoiceAccountingLine.createMany({
            data: lines.map((line) => ({
              ...line,
              documentId,
            })),
          });
        }
        await tx.invoiceAccountingDocument.update({
          where: { id: documentId },
          data: {
            documentType: existing.documentType || ocrResult.belgeTipi || 'OKC_FIS',
            status,
            duplicateOfId,
            duplicateReason: duplicate?.duplicateReason || existing.duplicateReason || null,
            duplicateSeverity: duplicate?.duplicateSeverity || existing.duplicateSeverity || null,
            imageHash,
            belgeNo: ocrResult.belgeNo || null,
            faturaTarihi: parseDate(ocrResult.date || null) || existing.faturaTarihi || null,
            // v2.3: SATIS belgesinde OCR'in okudugu taraf bizim mukellef olur —
            // satici alanlarina yazip mukellefi "satici" gibi gostermeyelim.
            sellerVkn: isSale ? null : (ocrResult.saticiVkn || null),
            vendorName: isSale ? null : (ocrResult.satici || null),
            totalAmount: money(ocrResult.totalTutari),
            ocrStatus,
            ocrEngine: ocrResult.engine || null,
            ocrRawText: ocrResult.rawText || null,
            ocrConfidence: ocrResult.confidence ?? null,
            ocrData: ocrResult as any,
          },
        });
      });

      const validation = await this.revalidateDocument(tenantId, documentId).catch((e: any) => {
        this.logger.warn(`Yuklenen belge validation basarisiz (${documentId}): ${e?.message || e}`);
        return null;
      });
      if (validation && validation.status !== 'OK' && status === 'READY') {
        await (this.prisma as any).invoiceAccountingDocument.updateMany({
          where: { id: documentId, tenantId, status: 'READY' },
          data: { status: 'NEEDS_REVIEW' },
        });
      }
    } catch (e: any) {
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: documentId, tenantId },
        data: {
          status: 'NEEDS_REVIEW',
          ocrStatus: 'FAILED',
          ocrEngine: 'failed',
          ocrRawText: e?.message || 'OCR failed',
          ocrConfidence: 0,
        },
      });
      throw e;
    }
  }

  private enqueueMihsapDocumentOcr(
    tenantId: string,
    documentId: string,
    mihsapInvoiceId: string,
    invoiceKind: 'ALIS' | 'SATIS',
  ) {
    this.uploadOcrQueue.push({ tenantId, documentId, kind: 'mihsap', mihsapInvoiceId, invoiceKind });
    this.drainUploadedOcrQueue();
  }

  /**
   * Mihsap'tan cekilen bir belgenin dosyasini CDN'den indirir, GORUNTUDEN okur,
   * yon-duyarli yevmiye satirlarini uretir ve hesap planiyla otomatik eslestirir.
   * KURAL: Mihsap'tan SADECE GORUNTU alinir; belge turu/taraf/VKN/tutar hep
   * bizim okumamizdan (OCR belgeTipi/saticiVkn + bos kalirsa Max-vision AI) gelir.
   */
  // OCR'in okudugu belge tipini (EARSIV/EFATURA/FIS/Z_RAPORU) UI documentType'ina cevir.
  private mapOcrBelgeTipi(t?: string | null): string | null {
    const s = String(t || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!s) return null;
    if (s.includes('ZRAPOR')) return 'Z_RAPORU';
    if (s.includes('SMM') || s.includes('SERBESTMESLEK')) return 'E_SMM';
    if (s.includes('EARSIV') || s.includes('ARSIV')) return 'E_ARSIV';
    if (s.includes('EFATURA') || s.includes('FATURA')) return 'E_FATURA';
    if (s.includes('OKC') || s.includes('FIS') || s.includes('MAKBUZ')) return 'OKC_FIS';
    return null;
  }

  // Belge türünü doğrudan FATURA METNİNDEN tespit et (OCR motorunun belgeTipi alanından
  // daha güvenilir — e-Arşiv faturada "Senaryo: EARSIVFATURA" yazar). "Diğer" hatasını önler.
  private docTypeFromText(text?: string | null): string | null {
    const s = String(text || '').toUpperCase();
    if (!s) return null;
    if (/EARSIVFATURA|E[\s-]?AR[SŞ]IV/.test(s)) return 'E_ARSIV';
    if (/SERBEST\s*MESLEK\s*MAKBUZ|\bE[\s-]?SMM\b/.test(s)) return 'E_SMM';
    if (/Z\s*RAPOR/.test(s)) return 'Z_RAPORU';
    if (/TEMELFATURA|TICARIFATURA|E[\s-]?FATURA/.test(s)) return 'E_FATURA';
    if (/YAZAR\s*KASA|\bÖKC\b|\bOKC\b/.test(s)) return 'OKC_FIS';
    return null;
  }

  private async processMihsapDocumentOcr(
    tenantId: string,
    documentId: string,
    mihsapInvoiceId: string,
    invoiceKind: 'ALIS' | 'SATIS',
  ) {
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: documentId, tenantId },
      data: { ocrStatus: 'IN_PROGRESS' },
    });

    try {
      const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { id: documentId, tenantId },
        select: {
          id: true, taxpayerId: true, totalAmount: true,
          vendorName: true, customerName: true,
          belgeNo: true, faturaTarihi: true,
        },
      });
      if (!existing) return;

      // KURAL (kullanıcı): Mihsap'tan yalnız GÖRÜNTÜ alınır; BİLGİYİ biz okuruz.
      // BİRİNCİL okuyucu = Max-vision (tam okur: belge türü + iki taraf ad/VKN + tutar
      // + yönü mükellef VKN'sinden türetir). Başarılıysa bitti; değilse aşağıda Azure'a düşer.
      const aiOk = await this.aiReadDocument(tenantId, documentId).then((r: any) => !!r?.ok).catch(() => false);
      if (aiOk) {
        await (this.prisma as any).invoiceAccountingDocument.updateMany({
          where: { id: documentId, tenantId },
          data: { ocrStatus: 'SUCCESS' },
        });
        return;
      }

      const file = await this.mihsapService.getInvoiceFile(tenantId, mihsapInvoiceId);
      const ocr = await this.ocr.extractFromImage(file.buffer, file.filename, {});

      // Toplam: Mihsap basligi guvenilir, yoksa OCR'dan
      // (Prisma.Decimal -> Number dogrudan NaN verebilir; string uzerinden cevir)
      const totalNum = existing.totalAmount != null
        ? this.numFromOcr(String(existing.totalAmount))
        : this.numFromOcr(ocr.totalTutari);

      // KDV kirilimi: OCR {oran,matrah?,tutar} -> linesFromAmounts {rate,base,amount}
      const rawBreakdown = Array.isArray(ocr.kdvBreakdown) ? ocr.kdvBreakdown : [];
      const breakdown = rawBreakdown
        .map((b: any) => {
          const rate = Number(b.oran) || 0;
          const amount = Number(b.tutar) || 0;
          const base = (b.matrah != null && Number(b.matrah) > 0)
            ? Number(b.matrah)
            : (rate > 0 ? Number((amount / (rate / 100)).toFixed(2)) : 0);
          return { rate, base, amount };
        })
        .filter((b: { base: number; amount: number }) => b.amount > 0 || b.base > 0);

      const kdvTotal = breakdown.length
        ? breakdown.reduce((s, b) => s + b.amount, 0)
        : this.numFromOcr(ocr.kdvTutari);
      const matrah = Math.max(totalNum - kdvTotal, 0);
      const vendorOrCustomer = invoiceKind === 'SATIS' ? existing.customerName : existing.vendorName;

      const lines = await this.gateCodesByPlan(tenantId, existing.taxpayerId, this.linesFromAmounts({
        invoiceKind,
        matrah,
        kdvTutari: kdvTotal,
        kdvOrani: breakdown[0]?.rate,
        total: totalNum,
        vendorName: vendorOrCustomer,
        kdvBreakdown: breakdown.length ? breakdown : null,
      }));

      // K2: güven (doluluk) yüksek olsa bile içerik şüpheliyse insan kontrolüne düşür.
      const contentOk = (ocr.validationScore == null || ocr.validationScore >= 0.7) && !(ocr.validationIssues?.length);
      const ocrStatus = (ocr.confidence ?? 0) >= 0.7 && contentOk ? 'SUCCESS' : 'NEEDS_REVIEW';

      await (this.prisma as any).$transaction(async (tx: any) => {
        await tx.invoiceAccountingLine.deleteMany({ where: { documentId } });
        if (lines.length) {
          await tx.invoiceAccountingLine.createMany({
            data: lines.map((line) => ({ ...line, documentId })),
          });
        }
        await tx.invoiceAccountingDocument.update({
          where: { id: documentId },
          data: {
            // Mihsap basligini koru; sadece eksikse OCR ile doldur
            belgeNo: existing.belgeNo || ocr.belgeNo || null,
            faturaTarihi: existing.faturaTarihi || parseDate(ocr.date || null) || null,
            totalAmount: money(totalNum),
            // BELGE TURU GORUNTUDEN: OCR belgeTipi (EARSIV/EFATURA/FIS) → Mihsap'in guvenilmez
            // belgeTuru alanina degil, OKUDUGUMUZ tipe gore. Okunamazsa mevcut kalir.
            ...((() => { const t = this.docTypeFromText(ocr.rawText) || this.mapOcrBelgeTipi(ocr.belgeTipi); return t ? { documentType: t } : {}; })()),
            // OCR satici VKN'sini (gercek) yaz → sahiplik/yon kontrolu ve satici-bazli
            // ogrenme dogru VKN'ye dayansin. Azure yalniz saticiyi verir; alici AI-oku'da gelir.
            ...((() => { const sv = String(ocr.saticiVkn || '').replace(/\D/g, ''); return sv.length === 10 || sv.length === 11 ? { sellerVkn: sv } : {}; })()),
            status: 'NEEDS_REVIEW',
            ocrStatus,
            ocrEngine: ocr.engine || null,
            ocrRawText: ocr.rawText || null,
            ocrConfidence: ocr.confidence ?? null,
            ocrData: ocr as any,
          },
        });
      });

      await this.revalidateDocument(tenantId, documentId).catch((e: any) => {
        this.logger.warn(`Mihsap belge validation basarisiz (${documentId}): ${e?.message || e}`);
      });
      await this.rematchDocumentsWithLatestAccountPlan(tenantId, existing.taxpayerId, [documentId]).catch(() => null);
    } catch (e: any) {
      // OCR/indirme basarisiz: belge yine de listede kalsin (NEEDS_REVIEW),
      // kullanici tutari elle girip onaylayabilsin.
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: documentId, tenantId },
        data: {
          status: 'NEEDS_REVIEW',
          ocrStatus: 'FAILED',
          ocrEngine: 'failed',
          ocrRawText: (e?.message || 'Mihsap belge OCR hatasi').slice(0, 500),
          ocrConfidence: 0,
        },
      });
      this.logger.warn(`Mihsap belge OCR hatasi (${documentId}): ${e?.message || e}`);
    }
  }

  private numFromOcr(value: any): number {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/[^\d.-]/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
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
    const documentType = f.belgeKaynak === 'EFATURA' ? 'E_FATURA' : 'E_ARSIV';
    const invoiceKind = f.tip === 'SATIS' ? 'SATIS' : 'ALIS';
    const originalName = `${f.faturaNo || f.id}.${f.pdfStorageKey ? 'pdf' : f.htmlStorageKey ? 'html' : 'xml'}`;
    const s3Key = `earsiv-inline://${f.id}`;
    const sizeBytes = f.pdfStorageKey || f.htmlStorageKey ? 1 : Buffer.byteLength(f.xmlContent || '', 'utf8');
    const breakdownArr = Array.isArray((f as any).kdvBreakdown)
      ? (f as any).kdvBreakdown as Array<{ rate: number; base: number; amount: number }>
      : null;
    const lines = await this.gateCodesByPlan(tenantId, f.taxpayerId, this.linesFromAmounts({
      invoiceKind,
      matrah: f.matrah,
      kdvTutari: f.kdvTutari,
      kdvOrani: f.kdvOrani,
      total: f.toplamTutar,
      vendorName: invoiceKind === 'ALIS' ? f.satici : f.alici,
      kdvBreakdown: breakdownArr,
    }));

    if (existing) {
      const refreshed = await this.refreshExistingEarsivDocumentIfNeeded({
        tenantId,
        existing,
        f,
        documentType,
        invoiceKind,
        originalName,
        sizeBytes,
        lines,
        kdvBreakdown: breakdownArr,
      });
      await this.rematchDocumentsWithLatestAccountPlan(tenantId, f.taxpayerId, [existing.id]).catch((e: any) => {
        this.logger.warn(`Hesap plani mevcut belgeye uygulanamadi (${existing.id}): ${e?.message || e}`);
      });
      const current = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: { id: existing.id, tenantId },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
      });
      return { created: false, duplicate: true, refreshed: !!refreshed, document: current || refreshed || existing };
    }

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

    await this.rematchDocumentsWithLatestAccountPlan(tenantId, f.taxpayerId, [doc.id]).catch((e: any) => {
      this.logger.warn(`Hesap plani yeni belgeye uygulanamadi (${doc.id}): ${e?.message || e}`);
    });
    const current = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id: doc.id, tenantId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    return { created: true, document: current || doc };
  }

  private async refreshExistingEarsivDocumentIfNeeded(opts: {
    tenantId: string;
    existing: any;
    f: any;
    documentType: string;
    invoiceKind: string;
    originalName: string;
    sizeBytes: number;
    lines: any[];
    kdvBreakdown: Array<{ rate: number; base: number; amount: number }> | null;
  }) {
    const { tenantId, existing, f, documentType, invoiceKind, originalName, sizeBytes, lines, kdvBreakdown } = opts;
    if (existing.status === 'APPROVED') return null;

    const needsLineRefresh = this.lineSignature(existing.lines || []) !== this.lineSignature(lines);
    const currentOcrData: any = existing.ocrData || {};
    const currentBreakdown = Array.isArray(currentOcrData.kdvBreakdown) ? currentOcrData.kdvBreakdown : null;
    const needsBreakdownRefresh = JSON.stringify(currentBreakdown || null) !== JSON.stringify(kdvBreakdown || null);
    const needsPreviewRefresh =
      existing.mimeType !== (f.pdfStorageKey ? 'application/pdf' : f.htmlStorageKey ? 'text/html' : 'application/xml') ||
      existing.originalName !== originalName ||
      Number(existing.sizeBytes || 0) !== Number(sizeBytes || 0);

    if (!needsLineRefresh && !needsBreakdownRefresh && !needsPreviewRefresh) return null;

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
      kdvBreakdown,
    });

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (needsLineRefresh) {
        await tx.invoiceAccountingLine.deleteMany({ where: { documentId: existing.id } });
        if (lines.length) {
          await tx.invoiceAccountingLine.createMany({
            data: lines.map((line, index) => ({
              documentId: existing.id,
              group: line.group || 'matrah',
              accountCode: line.accountCode || null,
              description: line.description || null,
              rate: line.rate || null,
              debit: line.debit || new Prisma.Decimal(0),
              credit: line.credit || new Prisma.Decimal(0),
              orderNo: index,
            })),
          });
        }
      }

      await tx.invoiceAccountingDocument.update({
        where: { id: existing.id },
        data: {
          taxpayerId: f.taxpayerId,
          documentType,
          invoiceKind,
          status: validation.status !== 'OK' ? 'NEEDS_REVIEW' : 'READY',
          originalName,
          mimeType: f.pdfStorageKey ? 'application/pdf' : f.htmlStorageKey ? 'text/html' : 'application/xml',
          sizeBytes,
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
            ...currentOcrData,
            source: 'earsivFatura',
            belgeKaynak: f.belgeKaynak,
            tip: f.tip,
            matrah: f.matrah,
            kdvTutari: f.kdvTutari,
            kdvOrani: f.kdvOrani,
            kdvBreakdown,
            validationStatus: validation.status,
            validationIssues: validation.issues,
            validationCheckedAt: new Date().toISOString(),
          },
        },
      });
    });

    try {
      await (this.prisma as any).$executeRawUnsafe(
        `UPDATE "invoice_accounting_documents"
         SET "validationStatus" = $1, "validationIssues" = $2::jsonb, "validationCheckedAt" = NOW()
         WHERE "id" = $3`,
        validation.status,
        validation.issues.length ? JSON.stringify(validation.issues) : null,
        existing.id,
      );
    } catch {
      // kolonlar yoksa atla — ocrData içinde zaten saklı
    }

    return (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id: existing.id, tenantId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
  }

  private lineSignature(lines: any[]) {
    return (lines || [])
      .map((line) => [
        String(line.group || ''),
        String(line.accountCode || ''),
        String(line.rate || ''),
        Number(line.debit || 0).toFixed(2),
        Number(line.credit || 0).toFixed(2),
      ].join('|'))
      .join('~');
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

  async importFromMihsap(
    tenantId: string,
    opts: {
      taxpayerId: string;
      donem: string;
      faturaTuru?: 'ALIS' | 'SATIS';
      createdBy?: string;
    },
  ) {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: opts.taxpayerId, tenantId },
      select: { id: true, mihsapId: true },
    });
    if (!taxpayer?.mihsapId) {
      throw new BadRequestException('Bu mükellef için Mihsap ID tanımlı değil (mükellef kartında "Mihsap ID" alanını doldurun)');
    }

    // ④ Plan tazeleme: bilanço mükellefinde plan yoksa/eskiyse Luca'dan çekmeyi başlat (arka plan;
    //   plan gelince belgeler otomatik yeniden eşleşir). Fire-and-forget — aktarımı bekletmez.
    this.maybeRefreshAccountPlan(tenantId, opts.taxpayerId).catch(() => {});

    // 1. Mihsap'tan çek → mihsap_invoices tablosuna yaz
    try {
      await this.mihsapService.fetchAndStoreInvoices({
        tenantId,
        mukellefId: opts.taxpayerId,
        mukellefMihsapId: String(taxpayer.mihsapId),
        donem: opts.donem,
        faturaTuru: opts.faturaTuru,
        kaynak: 'bekleyen',
        createdBy: opts.createdBy || undefined,
      });
    } catch (fetchErr: any) {
      this.logger.warn(`Mihsap fetch hatasi (devam ediyoruz): ${fetchErr?.message}`);
    }

    // 2. mihsap_invoices → invoiceAccountingDocument bridge
    // ÖNEMLİ: faturaTuru DB'de "SATIS" yaninda "TEVKIFATLI_SATIS" (ya da farkli case)
    // olabiliyor. Tam esitlikle sorgularsak tevkifatli olanlar köprüye girmez ve
    // belge dusmez (8 cekilir, 4 gorunur). Yon bazli (includes) filtre uyguluyoruz.
    const where: any = { tenantId, mukellefId: opts.taxpayerId, donem: opts.donem };
    const allRows = await (this.prisma as any).mihsapInvoice.findMany({
      where,
      take: 3000,
      orderBy: { faturaTarihi: 'desc' },
    });
    const rows = opts.faturaTuru
      ? allRows.filter((r: any) =>
          String(r.faturaTuru || '').toUpperCase().includes(opts.faturaTuru!.toUpperCase()),
        )
      : allRows;

    let created = 0;
    let reprocessed = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const inv of rows) {
      try {
        const rawTur = String(inv.faturaTuru || 'ALIS').toUpperCase();
        const invoiceKind: 'ALIS' | 'SATIS' = rawTur.includes('SATIS') ? 'SATIS' : 'ALIS';

        const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
          where: { tenantId, source: 'mihsap', sourceRefId: String(inv.mihsapId) },
          select: { id: true, _count: { select: { lines: true } } },
        });
        if (existing) {
          // Daha once cekilmis ama yevmiyesi yoksa (eski hatali import) yeniden OCR'la
          if ((existing._count?.lines || 0) === 0) {
            this.enqueueMihsapDocumentOcr(tenantId, existing.id, inv.id, invoiceKind);
            reprocessed++;
          } else {
            skipped++;
          }
          continue;
        }

        const rawBelge = String(inv.belgeTuru || '').toUpperCase();
        const documentType =
          rawBelge.includes('E_FATURA') || rawBelge === 'EFATURA' ? 'E_FATURA'
          : rawBelge.includes('E_ARSIV') || rawBelge === 'EARSIV'  ? 'E_ARSIV'
          : rawBelge.includes('FIS')                               ? 'OKC_FIS'
          : 'DIGER';

        const ext = String(inv.orjDosyaTuru || '').toUpperCase();
        const mimeType = ext === 'JPEG' || ext === 'JPG' ? 'image/jpeg'
          : ext === 'XML' ? 'application/xml'
          : 'application/pdf';

        const doc = await (this.prisma as any).invoiceAccountingDocument.create({
          data: {
            tenantId,
            taxpayerId: opts.taxpayerId,
            source: 'mihsap',
            sourceRefId: String(inv.mihsapId),
            documentType,
            invoiceKind,
            // OCR arka planda yevmiye uretene kadar PROCESSING; bitince NEEDS_REVIEW
            status: 'PROCESSING',
            originalName: `${inv.faturaNo || inv.mihsapId}.${ext.toLowerCase() || 'pdf'}`,
            mimeType,
            sizeBytes: 1,
            s3Key: inv.storageKey || inv.storageUrl || `mihsap:${inv.mihsapId}`,
            belgeNo: inv.faturaNo || null,
            faturaTarihi: inv.faturaTarihi || null,
            // Mihsap'tan VKN ALMA: firmaKimlikNo = HESAP SAHİBİNİN numarası (karşı taraf değil)
            // — tüm satırlarda aynı çıkıyordu. Gerçek satıcı/alıcı VKN'si GÖRÜNTÜDEN (OCR/AI) gelir.
            sellerVkn: null,
            buyerVkn: null,
            // İsim provizyonel (firmaUnvan = karşı taraf adı); OCR/AI okuması netleştirir.
            vendorName: invoiceKind === 'ALIS' ? (inv.firmaUnvan || null) : null,
            customerName: invoiceKind === 'SATIS' ? (inv.firmaUnvan || null) : null,
            totalAmount: inv.toplamTutar != null ? inv.toplamTutar : null,
            ocrStatus: 'PENDING',
            createdBy: opts.createdBy || null,
          },
          select: { id: true },
        });
        this.enqueueMihsapDocumentOcr(tenantId, doc.id, inv.id, invoiceKind);
        created++;
      } catch (e: any) {
        failed++;
        if (errors.length < 5) errors.push(`${inv.faturaNo || inv.mihsapId}: ${e?.message}`);
      }
    }

    this.logger.log(`importFromMihsap [${opts.taxpayerId}/${opts.donem}]: scan=${rows.length} created=${created} reprocessed=${reprocessed} skipped=${skipped} failed=${failed}`);
    return { scanned: rows.length, created, reprocessed, skipped, failed, errors };
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
    // Mihsap kaynakli belge: dosya S3'te degil, Mihsap CDN'inde. Backend proxy
    // ile indirip data-URI (resim/PDF) veya render edilmis HTML (XML) doneriz.
    if (String((doc as any).source || '') === 'mihsap') {
      const refId = String((doc as any).sourceRefId || '').trim();
      const inv = refId
        ? await (this.prisma as any).mihsapInvoice.findFirst({
            where: { tenantId, mihsapId: refId },
            select: { id: true },
          })
        : null;
      if (inv?.id) {
        try {
          const file = await this.mihsapService.getInvoiceFile(tenantId, inv.id);
          const ct = String(file.contentType || '').toLowerCase();
          const buf = file.buffer;
          // ÖNEMLİ: Mihsap CDN content-type başlığı çoğu zaman gelmiyor ve orjDosyaTuru
          // yanlış "XML" olabiliyor (oysa dosya JPEG). O yüzden gerçek tipi içeriğin
          // MAGIC-BYTE'ından tespit ediyoruz; yanlış content-type'a güvenmiyoruz.
          const isJpeg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
          const isPng = buf.length > 7 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
          const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
          if (isJpeg || /^image\/jpe?g/.test(ct)) {
            return { url: `data:image/jpeg;base64,${buf.toString('base64')}`, mimeType: 'image/jpeg', source: 'mihsap' as const };
          }
          if (isPng || /^image\/png/.test(ct)) {
            return { url: `data:image/png;base64,${buf.toString('base64')}`, mimeType: 'image/png', source: 'mihsap' as const };
          }
          if (/^image\//.test(ct)) {
            return { url: `data:${file.contentType};base64,${buf.toString('base64')}`, mimeType: file.contentType, source: 'mihsap' as const };
          }
          if (isPdf || /pdf/.test(ct)) {
            return { url: `data:application/pdf;base64,${buf.toString('base64')}`, mimeType: 'application/pdf', source: 'mihsap' as const };
          }
          const raw = buf.toString('utf8');
          // Gerçek HTML → olduğu gibi (iframe srcDoc render eder)
          if (/html/.test(ct) || /<html[\s>]/i.test(raw.slice(0, 500))) {
            return { url: '', inlineHtml: raw, mimeType: 'text/html', source: 'mihsap' as const };
          }
          // e-Arşiv XML (gömülü XSLT) → data-URL; DocModal iframe src ile tam faturayı render eder
          if (/<\?xml/i.test(raw.slice(0, 200)) || /xml/.test(ct)) {
            return { url: `data:application/xml;base64,${buf.toString('base64')}`, mimeType: 'application/xml', source: 'mihsap' as const };
          }
          // Hiçbiri değilse son çare: kayıttaki özet
          return { url: '', inlineHtml: this.inlinePreviewHtml(raw, doc), mimeType: 'text/html', source: 'mihsap' as const };
        } catch (e: any) {
          return {
            url: '',
            inlineHtml: this.inlinePreviewHtml(`Mihsap belgesi getirilemedi: ${e?.message || ''}`),
            mimeType: 'text/html',
            source: 'placeholder' as const,
          };
        }
      }
    }
    if (/text\/html|xml/i.test(mimeType)) {
      const buffer = await this.storage.getBuffer(doc.s3Key);
      const raw = buffer.toString('utf8');
      const html = mimeType.includes('html') ? raw : this.inlinePreviewHtml(raw, doc);
      return { url: '', inlineHtml: html, mimeType: 'text/html', source: 'stored-html' as const };
    }
    const url = await this.storage.getPresignedInlineUrl(doc.s3Key, doc.originalName, mimeType || undefined);
    return { url, mimeType, source: 'stored-file' as const };
  }

  private inlinePreviewHtml(raw: string, doc?: any) {
    const source = String(raw || '');
    if (/<html[\s>]/i.test(source)) return source;

    const escEarly = (v: string) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // XML/UBL degilse (or. hata mesaji): duz mesaj goster, bos sablon degil
    if (!/</.test(source)) {
      return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px/1.5 Arial,sans-serif;color:#374151;padding:32px;background:#f8fafc}.m{max-width:680px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px}</style></head><body><div class="m">${escEarly(source) || 'Belge önizlemesi yok.'}</div></body></html>`;
    }

    const text = (tag: string) => {
      const m = source.match(new RegExp(`<[^:>]*(?::)?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*(?::)?${tag}>`, 'i'));
      return (m?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    };
    const esc = (v: string) => String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const items = [...source.matchAll(/<[^:>]*(?::)?InvoiceLine\b[\s\S]*?<\/[^:>]*(?::)?InvoiceLine>/gi)]
      .slice(0, 30)
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

    // XML'den okunamayan alanlar için belge kaydına (doc) düş
    const fmtTL = (v: any) => {
      const n = Number(typeof v === 'object' && v != null ? String(v) : v);
      return Number.isFinite(n) && n !== 0 ? n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    };
    const isSale = String(doc?.invoiceKind || 'ALIS') === 'SATIS';
    const docFirma = (isSale ? doc?.customerName : doc?.vendorName) || '';
    const docVkn = (isSale ? doc?.buyerVkn : doc?.sellerVkn) || '';
    let dMatrah = 0, dKdv = 0, hasLine = false;
    for (const l of (Array.isArray(doc?.lines) ? doc.lines : [])) {
      const amt = Number(isSale ? l.credit : l.debit) || 0;
      if (l.group === 'matrah') { dMatrah += amt; hasLine = true; }
      else if (l.group === 'vergi') { dKdv += amt; hasLine = true; }
    }
    if (!hasLine) { dMatrah = Number(doc?.ocrData?.matrah) || 0; dKdv = Number(doc?.ocrData?.kdvTutari) || 0; }
    const kb = Array.isArray(doc?.ocrData?.kdvBreakdown) ? doc.ocrData.kdvBreakdown : [];

    const satici = text('RegistrationName') || text('Name') || docFirma || '—';
    const saticiId = text('CompanyID') || docVkn || '';
    const belge = text('ID') || doc?.belgeNo || '—';
    const tarih = text('IssueDate') || (doc?.faturaTarihi ? new Date(doc.faturaTarihi).toLocaleDateString('tr-TR') : '');
    const malTop = text('LineExtensionAmount') || fmtTL(dMatrah);
    const kdvTop = text('TaxAmount') || fmtTL(dKdv);
    const genelTop = text('PayableAmount') || fmtTL(doc?.totalAmount);

    // Gövde tablosu: 1) gerçek kalem dökümü, 2) yoksa KDV oran kırılımı, 3) o da yoksa not.
    const bodyTable = items.length
      ? `<table><thead><tr><th>Mal/Hizmet</th><th>Miktar</th><th class="num">Tutar</th></tr></thead><tbody>${
          items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)}</td><td class="num">${esc(i.amount)}</td></tr>`).join('')
        }</tbody></table>`
      : kb.length
        ? `<table><thead><tr><th>KDV Oranı</th><th class="num">Matrah</th><th class="num">KDV</th></tr></thead><tbody>${
            kb.map((b: any) => `<tr><td>%${esc(String(b.oran ?? 0))}</td><td class="num">${esc(fmtTL(b.matrah))}</td><td class="num">${esc(fmtTL(b.tutar))}</td></tr>`).join('')
          }</tbody></table>`
        : `<div class="note">Belgenin orijinal görüntüsü entegratörden gelmedi. Aşağıda kayıttaki özet bilgiler var; tutarları "AI ile oku" ile doğrulayabilirsin.</div>`;

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#f8fafc;color:#111827;font:14px/1.45 Arial,sans-serif;padding:24px}
      .sheet{max-width:940px;margin:auto;background:white;border:1px solid #e5e7eb;border-radius:10px;padding:28px;box-shadow:0 8px 28px rgba(15,23,42,.08)}
      h1{margin:0;font-size:22px}.cap{color:#6b7280;font-size:12px;margin:4px 0 16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
      .box{border:1px solid #e5e7eb;border-radius:8px;padding:12px}.muted{color:#6b7280;font-size:11px;text-transform:uppercase;font-weight:700;letter-spacing:.4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}th{background:#f3f4f6;font-size:12px}.num{text-align:right}
      .note{margin-top:14px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:13px}
      .totals{margin-left:auto;margin-top:16px;width:320px}.totals div{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:7px 0}.big{font-size:19px;font-weight:800}
    </style></head><body><div class="sheet">
      <h1>${isSale ? 'Satış' : 'Alış'} Faturası — Özet</h1>
      <div class="cap">${isSale ? 'Müşteri' : 'Tedarikçi'} ve toplam bilgileri belgeden alınmıştır.</div>
      <div class="grid">
        <div class="box"><div class="muted">${isSale ? 'Alıcı (müşteri)' : 'Satıcı (tedarikçi)'}</div><b>${esc(satici)}</b><br>${esc(saticiId ? 'VKN/TCKN ' + saticiId : '')}</div>
        <div class="box"><div class="muted">Belge No · Tarih</div><b>${esc(belge)}</b><br>${esc(tarih)}</div>
      </div>
      ${bodyTable}
      <div class="totals">
        <div><span>Matrah (KDV hariç)</span><b>${esc(malTop)} ₺</b></div>
        <div><span>KDV</span><b>${esc(kdvTop)} ₺</b></div>
        <div class="big"><span>Genel Toplam</span><b>${esc(genelTop)} ₺</b></div>
      </div>
    </div></body></html>`;
  }

  async update(tenantId: string, id: string, body: UpdateDocumentInput, userId?: string) {
    const before = await this.get(tenantId, id);
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
    // K4: VKN'leri NORMALİZE et (sadece rakam). Eskiden ham "123 456..." yazılınca
    // öğrenme/okuma normalize VKN beklediği için öğrenilen kod SESSİZCE uygulanmıyordu.
    if ('sellerVkn' in data && data.sellerVkn) data.sellerVkn = String(data.sellerVkn).replace(/\D/g, '') || null;
    if ('buyerVkn' in data && data.buyerVkn) data.buyerVkn = String(data.buyerVkn).replace(/\D/g, '') || null;
    if ('exchangeRate' in body) data.exchangeRate = parseDecimal(body.exchangeRate, '1');
    if ('faturaTarihi' in body) data.faturaTarihi = parseDate(body.faturaTarihi);
    if ('totalAmount' in body) data.totalAmount = money(body.totalAmount);
    // İşletme defteri sınıflandırması — yerleşik desen: ekstra veriyi ocrData JSON'a yaz (migration yok).
    if ('isletme' in body && body.isletme && typeof body.isletme === 'object') {
      const curOcr: any = (before as any)?.ocrData || {};
      data.ocrData = { ...curOcr, isletme: body.isletme };
    }
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

    // Faz C: denetim izi — belge bilgileri/satırları elle değiştirilince kaydet.
    await this.logAudit(tenantId, userId, 'UPDATE', id,
      { belgeNo: before.belgeNo, totalAmount: String(before.totalAmount ?? ''), invoiceKind: before.invoiceKind, lineCount: (before.lines || []).length },
      { changedFields: Object.keys(data), lineCount: Array.isArray(body.lines) ? body.lines.length : (before.lines || []).length });

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
    // K7: tevkifat tespiti — fatura tevkifatlı (OCR'da tevkifat tutarı/oranı) ama tevkifat
    // fişi (360/KDV2 sorumlu sıfatı) kurulmamışsa onayda blokla (düz KDV ile gitmesin).
    const tevkifatli = Number(ocrData?.kdvTevkifat || 0) > 0 || Number(ocrData?.tevkifatOrani || 0) > 0 || ocrData?.tevkifatHint === true;
    const tevkifatOrani = Number(ocrData?.tevkifatOrani || 0);
    const hasTevkifatLine = (doc.lines || []).some((l: any) => String(l.accountCode || '').startsWith('360'));
    // Faz D/1: iade/iptal — normal kayıt yapılmasın (ters kayıt/610 gerekli). 610 satırı
    // varsa müşavir düzeltmiş demektir → engelleme.
    const isReturn = ocrData?.isReturn === true;
    // İADE-UYGUN satır var mı? SATIŞTAN iade → 610/611 (matrah ters kayıt). ALIŞTAN iade → matrah
    //   orijinal stok/gider'e (610 DEĞİL) ALACAK yazılır ama KDV "İADE" adlı 391'e işlenir → o satır
    //   kaydın iade olduğunu gösterir; RETURN_NEEDS_REVERSAL yanlış alarm vermesin.
    const hasReturnLine = (doc.lines || []).some((l: any) => {
      const c = String(l.accountCode || '');
      return /^61[01]/.test(c) || (/^(191|391)/.test(c) && /İADE|IADE/i.test(String(l.description || '')));
    });

    // DEMİRBAŞ (sabit kıymet): faaliyet bağlamı için mükellefi çek → demirbaş alış/satışı uyarısı (manuel/Luca).
    const tpForAsset = doc.taxpayerId
      ? await (this.prisma as any).taxpayer.findFirst({ where: { id: doc.taxpayerId, tenantId }, select: { faaliyetAciklama: true, naceKodu: true, companyName: true } }).catch(() => null)
      : null;
    const fixedAsset = this.detectFixedAsset(ocrData, tpForAsset);

    const validation = await this.runValidation({
      tenantId,
      fixedAsset,
      taxpayerId: doc.taxpayerId,
      invoiceKind: doc.invoiceKind,
      tevkifatli,
      hasTevkifatLine,
      tevkifatOrani,
      isReturn,
      hasReturnLine,
      documentType: doc.documentType,
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

    // İşletme defteri mi? (tek-taraflı — hesap planı/kodu YOK, denge aranmaz)
    const tp: any = (doc as any).taxpayerId
      ? await (this.prisma as any).taxpayer.findFirst({ where: { id: (doc as any).taxpayerId, tenantId }, select: { defterTuru: true, mihsapDefterTuru: true, naceKodu: true, faaliyetAciklama: true } })
      : null;
    const isIsletme = /i[şs]letme|defter.?beyan|basit/i.test(`${tp?.defterTuru || ''} ${tp?.mihsapDefterTuru || ''}`);

    if (isIsletme) {
      // İşletme: kod/denge kontrolü YOK — tutarın okunmuş olması yeterli.
      const isl: any = (doc as any).ocrData?.isletme || {};
      const lineTot = (doc.lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
      const hasAmt = (Number(isl.matrah) || 0) > 0 || (Number(isl.kdvTutar) || 0) > 0 || Number((doc as any).totalAmount) > 0 || lineTot > 0;
      if (!hasAmt) throw new BadRequestException('Bu belge onaylanamaz — tutar okunamamış. Önce "AI ile oku" ile tutarları çıkar.');
      const data: any = {
        status: 'APPROVED', approvedBy: userId || null, approvedAt: new Date(),
        lucaStatus: (doc as any).taxpayerId ? 'QUEUED' : 'NOT_STARTED',
        lucaErrorMessage: (doc as any).taxpayerId ? null : 'Mukellef secilmedigi icin Luca\'ya aktarilamaz',
      };
      // Sınıflandırma (Kayıt Türü + alt türü) faturayı okurken AI tarafından yapılır (ocrData.isletme).
      //   Onayda ZORLAMA YOK — AI sınıf vermediyse belge "Eşleşmedi" kalır, kullanıcı Muhasebeleştir'de seçer.
      await (this.prisma as any).invoiceAccountingDocument.update({ where: { id }, data });
      await this.logAudit(tenantId, userId, 'APPROVE', id, { status: doc.status }, { status: 'APPROVED', isletme: true });
      return this.get(tenantId, id);
    }

    // Boş hesap kodu (ör. cari) ile onaylama YASAK — Luca'ya eksik fiş gitmesin.
    const blankLine = (doc.lines || []).find((l: any) => !String(l.accountCode || '').trim());
    if (blankLine) {
      const grpAd = String(blankLine.group) === 'cari' ? 'Cari hesap' : String(blankLine.group) === 'vergi' ? 'KDV hesabı' : 'Gelir/gider hesabı';
      throw new BadRequestException(`Bu belge onaylanamaz — ${grpAd} boş. Önce hesap kodunu seç.`);
    }

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

    await this.recordInvoiceAccountingMemory(tenantId, doc).catch((e: any) => {
      this.logger.warn(`Fatura hafizasi kaydedilemedi (${id}): ${e?.message || e}`);
    });
    // Faz C: denetim izi — kim ne zaman onayladı.
    await this.logAudit(tenantId, userId, 'APPROVE', id, { status: doc.status }, { status: 'APPROVED' });

    return this.get(tenantId, id);
  }

  /** Faz C: denetim izi — değişiklikleri AuditLog'a yaz (kim/ne zaman/eski→yeni). */
  private async logAudit(tenantId: string, userId: string | null | undefined, action: string, resourceId: string, oldData?: any, newData?: any) {
    try {
      await (this.prisma as any).auditLog.create({
        data: {
          tenantId, userId: userId || null,
          action, resource: 'fatura-belge', resourceId,
          oldData: oldData ?? undefined, newData: newData ?? undefined,
        },
      });
    } catch { /* audit opsiyonel — akışı bozma */ }
  }

  /** Faz C: geri-alma — onaylı belgeyi tekrar düzenlenebilir yap (Luca'ya GİTMEMİŞSE). */
  async reopen(tenantId: string, id: string, userId?: string) {
    const doc = await this.get(tenantId, id);
    if (doc.status !== 'APPROVED') throw new BadRequestException('Yalnız onaylı belge geri alınabilir.');
    if (['POSTED', 'POSTING'].includes(String(doc.lucaStatus || ''))) {
      throw new BadRequestException('Belge Luca\'ya aktarıldı/aktarılıyor — geri alınamaz (Luca\'da ters fiş gerekir).');
    }
    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data: { status: 'NEEDS_REVIEW', approvedBy: null, approvedAt: null, lucaStatus: 'NOT_STARTED', lucaErrorMessage: null },
    });
    await this.logAudit(tenantId, userId, 'REOPEN', id, { status: 'APPROVED' }, { status: 'NEEDS_REVIEW' });
    return this.get(tenantId, id);
  }

  private async recordInvoiceAccountingMemory(tenantId: string, doc: any) {
    if (!doc?.taxpayerId) return;
    const isSale = String(doc.invoiceKind || '').toUpperCase() === 'SATIS';
    const firmaKimlikNo = String((isSale ? doc.buyerVkn : doc.sellerVkn) || '').replace(/\D/g, '');
    if (!firmaKimlikNo) return;
    const firmaUnvan = String((isSale ? doc.customerName : doc.vendorName) || '').trim() || null;
    // ORAN-BAZLI ÖĞRENME: her matrah satırının kodunu KENDİ KDV oranıyla (altKategori) öğren —
    // aynı satıcının %1/%10/%20 alımları farklı koda gidebilsin (ör. A101 market). Oran yoksa
    // altKategori=null (genel kural).
    const blocked = (code: string) => ['191', '391', '120', '320', '321', '322', '329', '331'].some((p) => code.startsWith(p));
    const matrahLines = (doc.lines || []).filter((l: any) => String(l.group || '').toLowerCase() === 'matrah');
    const seen = new Set<string>();
    for (const l of matrahLines) {
      const code = String(l.accountCode || '').trim();
      if (!code || blocked(code)) continue;
      const rate = String(l.rate || '').replace(/[^0-9]/g, '') || null;
      const key = `${code}|${rate || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.vendorMemory.recordDecision({
        tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'fatura',
        kategori: code, altKategori: rate, taxpayerId: doc.taxpayerId,
      });
    }

    // CARI ÖĞRENME: müşavirin seçtiği cari hesabı (120/320/329/331) VKN'ye bağla.
    // altKategori='CARI' işareti matrah kararlarından ayırır. Sonraki faturalarda
    // pickCariMemoryAccount bu kodu otomatik getirir → isim tahmini gerekmez.
    const cariLine = (doc.lines || []).find((l: any) => String(l.group || '').toLowerCase() === 'cari');
    const cariCode = String(cariLine?.accountCode || '').trim();
    if (cariCode && /^(120|320|329|331)/.test(cariCode)) {
      await this.vendorMemory.recordDecision({
        tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'fatura',
        kategori: cariCode, altKategori: 'CARI', taxpayerId: doc.taxpayerId,
      }).catch(() => {});
    }
  }

  private memoryAccountCodesFromLines(lines: any[]) {
    const blockedPrefixes = ['191', '391', '120', '320', '321', '322', '329', '331'];
    const isBlocked = (code: string) => blockedPrefixes.some((prefix) => code.startsWith(prefix));
    const candidates = (lines || [])
      .filter((line: any) => String(line.group || '').toLowerCase() === 'matrah')
      .map((line: any) => String(line.accountCode || '').trim())
      .filter((code: string) => code && !isBlocked(code));
    const fallback = (lines || [])
      .map((line: any) => String(line.accountCode || '').trim())
      .filter((code: string) => code && !isBlocked(code));
    return [...new Set(candidates.length ? candidates : fallback)].slice(0, 5);
  }

  // v1.38: Bir mukellef+donem icin TUM QUEUED belgeleri tek INVOICE_POST job
  // halinde Luca'ya yollar — agent Excel hazirlayip Luca'nin "Toplu Aktarim"
  // ekranina yukler, tek yevmiye fisi olusur. Kullanici sonra Luca'da boler.
  /** İNDİRME: Aktarım'daki belgeleri (yön/dönem) Luca'ya GİTMEDEN tek toplu fiş Excel/CSV olarak
   *  üretir — kullanıcı indirip Luca'ya elle yükleyebilir ya da arşivler. batchPostToLuca ile aynı
   *  birleştirme + format (Bilanço: 14 sütun xlsx "Excel Veri Aktarımı"; İşletme: Hızlı Fiş CSV). */
  async buildBatchExcel(
    tenantId: string,
    q: { taxpayerId: string; period?: string; direction?: 'ALIS' | 'SATIS' },
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    if (!q?.taxpayerId) throw new BadRequestException('Mükellef seçilmeli');
    const tp: any = await (this.prisma as any).taxpayer.findFirst({
      where: { id: q.taxpayerId, tenantId }, select: { defterTuru: true, mihsapDefterTuru: true },
    });
    const isIsletme = /i[şs]letme|defter.?beyan|basit/i.test(`${tp?.defterTuru || ''} ${tp?.mihsapDefterTuru || ''}`);
    const where: any = { tenantId, taxpayerId: q.taxpayerId, status: 'APPROVED' };
    if (q.direction === 'ALIS' || q.direction === 'SATIS') where.invoiceKind = q.direction;
    if (q.period) {
      const [y, m] = String(q.period).split('-').map((n) => parseInt(n, 10));
      if (Number.isFinite(y) && Number.isFinite(m)) {
        where.faturaTarihi = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
      }
    }
    const allDocs: any[] = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where, include: { lines: { orderBy: { orderNo: 'asc' } } }, orderBy: { faturaTarihi: 'asc' },
    });
    const docs = allDocs.filter((d: any) => {
      const v = String((d as any).validationStatus || d.ocrData?.validationStatus || '').toUpperCase();
      if (v === 'INVALID' || v === 'INCOMPLETE') return false;
      const lines = d.lines || [];
      if (isIsletme) {
        // İşletme defteri TEK TARAFLI: borç=alacak dengesi / hesap kodu aranmaz; tutarın olması yeterli.
        const isl: any = d.ocrData?.isletme || {};
        const lineTot = lines.reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
        return (Number(isl.matrah) || 0) > 0 || (Number(isl.kdvTutar) || 0) > 0 || lineTot > 0 || Number(d.totalAmount) > 0;
      }
      const sd = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const sc = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      const blankCode = lines.some((l: any) => (Number(l.debit || 0) + Number(l.credit || 0)) > 0 && !String(l.accountCode || '').trim());
      return lines.length && Math.abs(sd - sc) <= 0.02 && !blankCode;
    });
    if (!docs.length) throw new BadRequestException(isIsletme ? 'Aktarılacak (tutarı olan) İşletme belgesi yok' : 'İndirilecek (dengeli, kodlu) belge yok');
    const kind: 'ALIS' | 'SATIS' = q.direction === 'SATIS' || (!q.direction && String(docs[0].invoiceKind).toUpperCase() === 'SATIS') ? 'SATIS' : 'ALIS';
    const toInvoicePayload = (d: any) => ({
      documentId: d.id, documentType: d.documentType, invoiceKind: d.invoiceKind, belgeNo: d.belgeNo,
      seriNo: d.seriNo, faturaTarihi: d.faturaTarihi ? d.faturaTarihi.toISOString() : null,
      sellerVkn: d.sellerVkn, buyerVkn: d.buyerVkn, vendorName: d.vendorName, customerName: d.customerName,
      totalAmount: d.totalAmount ? String(d.totalAmount) : null, currency: d.currency || 'TL',
      isletme: d.ocrData?.isletme || null,
      lines: (d.lines || []).map((line: any) => ({
        group: line.group, accountCode: line.accountCode, description: line.description, rate: line.rate,
        debit: line.debit ? String(line.debit) : '0', credit: line.credit ? String(line.credit) : '0', orderNo: line.orderNo,
      })),
    });
    const payload: any = {
      mode: 'BATCH_EXCEL', format: isIsletme ? 'ISLETME_CSV' : 'BATCH_EXCEL', direction: kind,
      period: q.period || '', totalCount: docs.length,
      fisAciklama: `${kind === 'SATIS' ? 'SATIŞ' : 'ALIŞ'} faturaları — ${q.period || ''} (${docs.length} belge)`,
      invoices: docs.map(toInvoicePayload),
    };
    const yon = kind === 'SATIS' ? 'satis' : 'alis';
    if (isIsletme) {
      const csv = buildLucaIsletmeHizliFisCsv(payload);
      return { buffer: Buffer.isBuffer(csv) ? csv : Buffer.from(String(csv), 'binary'), filename: `luca-isletme-${yon}-${q.period || 'donem'}.csv`, contentType: 'text/csv; charset=windows-1254' };
    }
    const buf = await buildLucaImportExcel(payload);
    return { buffer: buf, filename: `luca-fis-${yon}-${q.period || 'donem'}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  async batchPostToLuca(
    tenantId: string,
    body: { taxpayerId: string; period?: string; documentIds?: string[]; direction?: 'ALIS' | 'SATIS' },
    userId?: string,
  ) {
    if (!body?.taxpayerId) {
      throw new Error('taxpayerId zorunlu');
    }

    const taxpayerRecord: any = await (this.prisma as any).taxpayer.findFirst({
      where: { id: body.taxpayerId, tenantId },
      select: { id: true, defterTuru: true, mihsapDefterTuru: true },
    });
    const defterTuru: string = taxpayerRecord?.defterTuru || taxpayerRecord?.mihsapDefterTuru || 'BILANCO';
    const isIsletme = /i[şs]letme|defter.?beyan|basit/i.test(String(defterTuru));

    // Hangi belgeler bu batch'e dahil — ya verilen ID listesi ya QUEUED filtresi
    // v2.2: validation kolonları olmayabilir — filtreleme application-side (validation OK olmayanları sonradan ele)
    const where: any = {
      tenantId,
      taxpayerId: body.taxpayerId,
      status: 'APPROVED',
      lucaStatus: { in: ['QUEUED', 'FAILED', 'NOT_STARTED'] },
    };
    // YÖN filtresi: Aktarım ekranında "Alış'ı aktar" / "Satış'ı aktar" ayrı butonlar → yalnız o
    // yöndeki belgeleri tek fişe çevir (zaten yön×dönem gruplanıyor; burası kullanıcı seçimini kısıtlar).
    if (body.direction === 'ALIS' || body.direction === 'SATIS') {
      where.invoiceKind = body.direction;
    }
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

    // K9: validationStatus DB KOLONUNDAN oku (ocrData'da değil — Mihsap belgelerinde
    // ocrData.validationStatus hiç set edilmiyor, eski filtre ölüydü). Ayrıca belge başına
    // GERÇEK denge + boş-kod kontrolü → dengesiz/eksik-kodlu fiş Luca'ya GİTMESİN (sessiz değil).
    let skippedCount = 0;
    let skippedBalance = 0;
    const docs = allDocs.filter((d: any) => {
      const v = String((d as any).validationStatus || d.ocrData?.validationStatus || '').toUpperCase();
      if (v === 'INVALID' || v === 'INCOMPLETE') { skippedCount++; return false; }
      const lines = d.lines || [];
      if (isIsletme) {
        // İşletme defteri TEK TARAFLI: borç=alacak / hesap kodu aranmaz; tutarın olması yeterli.
        const isl: any = d.ocrData?.isletme || {};
        const lineTot = lines.reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
        if ((Number(isl.matrah) || 0) > 0 || (Number(isl.kdvTutar) || 0) > 0 || lineTot > 0 || Number(d.totalAmount) > 0) return true;
        skippedBalance++; return false;
      }
      const sd = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const sc = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      const blankCode = lines.some((l: any) => (Number(l.debit || 0) + Number(l.credit || 0)) > 0 && !String(l.accountCode || '').trim());
      if (!lines.length || Math.abs(sd - sc) > 0.02 || blankCode) { skippedBalance++; return false; }
      return true;
    });

    if (!docs.length) {
      const parts = [
        skippedCount > 0 ? `${skippedCount} belge veri kontrolü hatası` : '',
        skippedBalance > 0 ? `${skippedBalance} belge dengesiz/eksik kod` : '',
      ].filter(Boolean).join(', ');
      const extra = parts ? ` (${parts} nedeniyle hariç tutuldu — Gelen Belgeler'de düzelt)` : '';
      throw new Error(`Bu mukellef icin Luca'ya aktarilabilir belge bulunamadi${extra}`);
    }

    // v2.3: Kullanici talebi — ALIS ve SATIS faturalari AYRI dosya/fis olarak
    // aktarilir (her biri tek fis; kullanici Luca'da "fis bol" yapar).
    // Bu yuzden belgeleri yone gore gruplayip her grup icin ayri INVOICE_POST job uretiyoruz.
    const toInvoicePayload = (d: any) => ({
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
      isletme: d.ocrData?.isletme || null,
      lines: (d.lines || []).map((line: any) => ({
        group: line.group,
        accountCode: line.accountCode,
        description: line.description,
        rate: line.rate,
        debit: line.debit ? String(line.debit) : '0',
        credit: line.credit ? String(line.credit) : '0',
        orderNo: line.orderNo,
      })),
    });

    // K8: yön (ALIŞ/SATIŞ) × AY ayrı fiş. Eskiden tüm aylar tek fişe yığılıp "dominant ay"
    // tarihiyle birleşiyordu → Nisan faturası Mart fişine girip DÖNEM KAYIYORDU. Artık her
    // (yön+ay) kendi fişine, kendi tarihiyle gider.
    const groupMap = new Map<string, { kind: 'ALIS' | 'SATIS'; period: string; docs: any[] }>();
    for (const d of docs) {
      const kind: 'ALIS' | 'SATIS' = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
      const dt = d.faturaTarihi ? new Date(d.faturaTarihi) : null;
      const period = dt && !Number.isNaN(dt.getTime())
        ? `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
        : (body.period || 'bilinmiyor');
      const key = `${kind}|${period}`;
      if (!groupMap.has(key)) groupMap.set(key, { kind, period, docs: [] });
      groupMap.get(key)!.docs.push(d);
    }
    const groups = [...groupMap.values()];

    // AUTO-ENTEGRASYON (kullanıcı: önce hesap, sonra fiş): mükellefin Luca'ya GÖNDERİLMEMİŞ yerel
    //   hesabı varsa, fiş işinden ÖNCE bir ACCOUNT_PLAN_PUSH işi yarat. Ajan bunu INVOICE_POST'tan
    //   önce işler (job sort) → fiş kesilirken o cari/hesap Luca'da hazır olur. Yeni hesap yoksa no-op.
    try {
      await this.pushAccountPlanToLuca(tenantId, { taxpayerId: body.taxpayerId, createdBy: userId });
    } catch (e: any) {
      this.logger.warn(`Auto hesap-açma atlandı: ${e?.message || e}`);
    }

    const jobs: Array<{ jobId: string; kind: string; period: string; documentCount: number }> = [];
    for (const g of groups) {
      const dominantPeriod = g.period;
      const kindLabel = g.kind === 'SATIS' ? 'SATIŞ' : 'ALIŞ';

      const job = await (this.prisma as any).lucaFetchJob.create({
        data: {
          tenantId,
          mukellefId: body.taxpayerId,
          donem: dominantPeriod,
          tip: 'INVOICE_POST',
          status: 'pending',
          priority: 5,
          createdBy: userId || null,
          invoiceDocumentId: null, // batch — tek belgeye bagli degil (belgeler lucaJobId ile bagli)
          payload: {
            mode: 'BATCH_EXCEL',
            // v2.3: ISLETME → Hızlı Fiş Aktarım CSV (cp1254), BILANCO → 14 sütun fiş xlsx
            format: /i[şs]letme|defter.?beyan|basit/i.test(String(defterTuru)) ? 'ISLETME_CSV' : 'BATCH_EXCEL',
            taxpayerId: body.taxpayerId,
            defterTuru,
            direction: g.kind,
            period: dominantPeriod,
            totalCount: g.docs.length,
            fisAciklama: `${kindLabel} faturaları — ${dominantPeriod} (${g.docs.length} belge)`,
            invoices: g.docs.map(toInvoicePayload),
          },
        },
      });

      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: { in: g.docs.map((d: any) => d.id) } },
        data: {
          lucaStatus: 'POSTING',
          lucaJobId: job.id,
          lucaErrorMessage: null,
          lucaAttemptCount: { increment: 1 },
        },
      });

      jobs.push({ jobId: job.id, kind: g.kind, period: dominantPeriod, documentCount: g.docs.length });
    }

    return {
      jobs,
      // Geriye donuk uyum: tek-job bekleyen eski cagiranlar icin ilk job alanlari
      jobId: jobs[0]?.jobId,
      taxpayerId: body.taxpayerId,
      period: jobs[0]?.period,
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

  async remove(tenantId: string, id: string, userId?: string) {
    const doc = await this.get(tenantId, id);
    // Faz C: denetim izi — silinen belgenin künyesini sakla (kim/ne sildi).
    await this.logAudit(tenantId, userId, 'DELETE', id,
      { belgeNo: doc.belgeNo, invoiceKind: doc.invoiceKind, totalAmount: String(doc.totalAmount ?? ''), status: doc.status }, null);
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
    const globalScoped = config.taxpayers?.global || null;
    const taxpayerScoped = config.taxpayers?.[taxpayerId] || null;
    const scoped = taxpayerScoped || globalScoped || null;
    if (!scoped) return null;
    const password = tryDecrypt(scoped.encryptedPassword) || '';
    const apiKey =
      tryDecrypt(scoped.encryptedApiKey) ||
      tryDecrypt(globalScoped?.encryptedApiKey) ||
      (catalog.provider === 'PARASUT' ? String(process.env.PARASUT_CLIENT_ID || '').trim() : '');
    const apiSecret =
      tryDecrypt(scoped.encryptedApiSecret) ||
      tryDecrypt(globalScoped?.encryptedApiSecret) ||
      (catalog.provider === 'PARASUT' ? String(process.env.PARASUT_CLIENT_SECRET || '').trim() : '');
    return {
      provider: catalog.provider,
      label: scoped.label || config.label || catalog.label,
      baseUrl: String(scoped.baseUrl || globalScoped?.baseUrl || PROVIDER_DEFAULT_BASE_URL[catalog.provider] || '').trim(),
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
    if (cfg.provider === 'PARASUT') {
      const missing: string[] = [];
      if (!cfg.apiKey) missing.push('client_id');
      if (!cfg.apiSecret) missing.push('client_secret');
      if (!cfg.username) missing.push('kullanici');
      if (!cfg.password) missing.push('sifre');
      if (!cfg.accountId && !cfg.senderVkn) missing.push('Firma No');
      return missing.length ? `Parasut bilgileri eksik: ${missing.join(', ')}` : null;
    }
    if (cfg.provider === 'UYUMSOFT' && (!cfg.username || !cfg.password)) return 'Uyumsoft kullanici/sifre eksik';
    if (cfg.provider === 'TURMOB_EFATURA' && (!cfg.username || !cfg.password)) return 'TÜRMOB TCKN ve parola gerekli';
    if (I2I_SOAP_PROVIDERS.has(cfg.provider) && (!cfg.username || !cfg.password)) return 'Izibiz/i2i kullanici/sifre eksik';
    if (cfg.provider !== 'UYUMSOFT' && cfg.provider !== 'TURMOB_EFATURA' && !I2I_SOAP_PROVIDERS.has(cfg.provider) && !cfg.baseUrl) return 'API adresi eksik';
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
    if (cfg.provider === 'TURMOB_EFATURA') return this.fetchTurmobViaLuca(cfg, opts);
    if (cfg.provider === 'PARASUT') return this.fetchParasutInvoices(cfg, opts);
    return this.fetchGenericRestInvoices(cfg, opts);
  }

  /**
   * TÜRMOB e-Belge portalına (turmobefatura.luca.com.tr) TCKN/parola ile OTOMATİK giriş → session cookie.
   * Portal girişi 2FA/kod SORMUYOR (kullanıcı teyit etti; Asistan da TCKN+parola ile giriyor) → backend
   * otomatik login takılmaz. Login formu (gerçek): POST /Account/Login, alanlar VknTckn + Password +
   * __RequestVerificationToken (antiforgery) + RememberMe. Akış: GET login (token+antiforgery cookie) →
   * POST login → başarı 302 redirect + auth cookie. Hatalı kimlik 200 (login sayfası tekrar).
   */
  private readonly TURMOB_BASE = 'https://turmobefatura.luca.com.tr';
  private async turmobLogin(vknTckn: string, password: string): Promise<string> {
    const BASE = this.TURMOB_BASE;
    const pick = (res: Response): string[] => {
      const anyH = res.headers as any;
      if (typeof anyH.getSetCookie === 'function') return anyH.getSetCookie();
      const sc = res.headers.get('set-cookie');
      return sc ? [sc] : [];
    };
    const cookieMap = new Map<string, string>();
    const addCookies = (arr: string[]) => { for (const c of arr) { const kv = c.split(';')[0]; const k = kv.split('=')[0]; if (k) cookieMap.set(k, kv); } };
    const cookieHeader = () => [...cookieMap.values()].join('; ');
    // 1) GET login → antiforgery token + cookie
    const page = await fetch(BASE + '/account/login', { headers: { 'User-Agent': 'MorenPortal/1.0' } });
    addCookies(pick(page));
    const html = await page.text();
    const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1]
      || html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/)?.[1];
    if (!token) throw new Error('TÜRMOB giriş sayfası okunamadı (antiforgery token yok)');
    // 2) POST login
    const body = new URLSearchParams({ VknTckn: String(vknTckn).trim(), Password: password, __RequestVerificationToken: token, RememberMe: 'true' }).toString();
    const loginRes = await fetch(BASE + '/Account/Login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(), 'User-Agent': 'MorenPortal/1.0' },
      body,
      redirect: 'manual',
    });
    addCookies(pick(loginRes));
    // Başarılı giriş = redirect (302/301). 200 dönerse kimlik hatalı (login sayfası tekrar geldi).
    if (loginRes.status !== 302 && loginRes.status !== 301) {
      throw new Error(`TÜRMOB girişi başarısız — TCKN/parola hatalı olabilir (HTTP ${loginRes.status})`);
    }
    // 3) Redirect hedefini İZLE — ASP.NET'te auth/session çerezi çoğu zaman bu adımda tamamlanır.
    //    (redirect izlenmezse liste isteği login'e geri atılıp 0 kayıt döner.)
    const loc = loginRes.headers.get('location') || '/';
    try {
      const home = await fetch(loc.startsWith('http') ? loc : BASE + loc, { headers: { Cookie: cookieHeader(), 'User-Agent': 'MorenPortal/1.0' }, redirect: 'manual' });
      addCookies(pick(home));
    } catch { /* redirect izlenemese de eldeki çerezle devam */ }
    if (!cookieMap.size) throw new Error('TÜRMOB oturum çerezi alınamadı');
    return cookieHeader();
  }

  /**
   * TÜRMOB e-Belge portalından fatura çek — OTOMATİK login (TCKN=cfg.username, parola=cfg.password),
   * sonra gelen/giden liste (DataTables AJAX). Asistan PDF veriyordu; biz portal XML'ini alıyoruz (OCR yok).
   * NOT(ilk-test): liste response satır şeması + İPTAL durum alanı + XML indirme uç URL'i, ilk gerçek
   * çekimde response'tan netleşecek (loglanır); şimdilik login+liste kanıtı + iskelet. İptal olan satırlar
   * createDocumentFromProviderXml'e GÖNDERİLMEZ.
   */
  private async fetchTurmobViaLuca(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
    },
  ): Promise<ProviderInvoicePayload[]> {
    if (!cfg.username || !cfg.password) throw new Error('TÜRMOB için TCKN (kullanıcı adı) ve parola gerekli');
    const cookie = await this.turmobLogin(cfg.username, cfg.password);
    const BASE = this.TURMOB_BASE;
    // Gelen=alış (/IncomingInvoice), Giden=satış (/OutgoingInvoice). e-Arşiv ucu ilk testte eklenecek.
    const listUrl = opts.direction === 'SATIS'
      ? '/OutgoingInvoice/AllOutgoingInvoiceByFilter'
      : '/IncomingInvoice/AllIncomingInvoiceByFilter';
    const listBody = `draw=1&start=0&length=${Math.min(Math.max(Number(opts.limit) || 500, 1), 1000)}`;
    const res = await fetch(BASE + listUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookie,
        'User-Agent': 'MorenPortal/1.0',
      },
      body: listBody,
    });
    const ct = res.headers.get('content-type') || '';
    const raw = await res.text();
    let data: any = null; try { data = JSON.parse(raw); } catch { /* HTML = muhtemelen login redirect */ }
    const rows: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.Data) ? data.Data : Array.isArray(data) ? data : [];
    const first = raw.trimStart().slice(0, 1); // '<' = HTML/login redirect (cookie yetersiz), '{'/'[' = JSON (parametre/dönem)
    // TEŞHİS: first='<' → oturum liste için yetersiz; '{' ama rows=0 → parametre/dönem filtresi gerekli.
    this.logger.log(`TÜRMOB portal ${opts.direction}: status=${res.status} ct=${ct.slice(0, 40)} len=${raw.length} first=${first} rows=${rows.length} topKeys=${JSON.stringify(Object.keys(data || {})).slice(0, 150)} rowKeys=${JSON.stringify(Object.keys(rows[0] || {})).slice(0, 250)}`);
    // İPTAL filtresi (durum alanı adı ilk testte netleşecek — "İptal/Iptal/Reddedildi/Cancel" geçeni atla):
    const isCancelled = (r: any) => /iptal|reddedil|cancel/i.test(JSON.stringify(r?.Durum ?? r?.durum ?? r?.Status ?? r?.status ?? ''));
    const live = rows.filter((r) => !isCancelled(r));
    // TODO(ilk-test): live satırlardan ETTN/ID al → XML indir ucu (İndir(Xml) butonunun URL'i) → payload.xml.
    // Şimdilik login+liste doğrulandı; XML indirme uç URL'i gerçek response/test ile eklenecek.
    void live;
    return [];
  }

  /**
   * Parasut OAuth2 + REST adapter. Erisim icin client_id + client_secret + user/pass gerek.
   * Token al -> /v4/{firmaNo}/purchase_bills (ALIS) veya sales_invoices (SATIS) cek.
   */
  private async fetchParasutInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
    },
  ): Promise<ProviderInvoicePayload[]> {
    const baseUrl = cfg.baseUrl || PROVIDER_DEFAULT_BASE_URL.PARASUT;
    if (!cfg.username || !cfg.password || !(cfg as any).apiKey || !(cfg as any).apiSecret) {
      throw new Error('Parasut OAuth2 icin client_id (apiKey) + client_secret (apiSecret) + kullanici + sifre gerekli');
    }
    const firmaNo = (cfg as any).accountId || (cfg as any).senderVkn;
    if (!firmaNo) throw new Error('Parasut Firma No gerekli');

    const tokenBody = new URLSearchParams({
      grant_type: 'password',
      client_id: (cfg as any).apiKey,
      client_secret: (cfg as any).apiSecret,
      username: cfg.username,
      password: cfg.password,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
    const tokenRes = await fetch('https://api.parasut.com/oauth/token', {
      method: 'POST',
      body: tokenBody,
    });
    if (!tokenRes.ok) throw new Error(`Parasut token alinamadi: ${tokenRes.status} ${await tokenRes.text()}`);
    const tokenData: any = await tokenRes.json();
    const accessToken = tokenData?.access_token;
    if (!accessToken) throw new Error('Parasut access_token donmedi');

    const path = opts.direction === 'ALIS' ? 'purchase_bills' : 'sales_invoices';
    const include = opts.direction === 'ALIS'
      ? 'spender,pay_to,details,details.product,active_e_document'
      : 'contact,details,details.product,active_e_document';
    const pageSize = Math.min(Math.max(Number(opts.limit || 25), 1), 25);
    const maxPages = Math.max(1, Math.ceil(opts.limit / pageSize));
    const payloads: ProviderInvoicePayload[] = [];

    for (let page = 1; page <= maxPages && payloads.length < opts.limit; page++) {
      const params = new URLSearchParams({
        'filter[issue_date]': `${opts.period.startDate}..${opts.period.endDate}`,
        'page[number]': String(page),
        'page[size]': String(pageSize),
        include,
      });
      const url = `${baseUrl.replace(/\/+$/, '')}/${firmaNo}/${path}?${params.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Parasut fatura listesi alinamadi: ${res.status} ${await res.text()}`);
      const data: any = await res.json();
      const items = Array.isArray(data?.data) ? data.data : [];
      const included = Array.isArray(data?.included) ? data.included : [];
      for (const item of items) {
        if (payloads.length >= opts.limit) break;
        payloads.push(this.parasutInvoicePayload(item, included, opts.direction, opts.taxpayer, path));
      }
      if (items.length < pageSize) break;
    }
    return payloads;
  }

  private parasutInvoicePayload(
    item: any,
    included: any[],
    direction: 'ALIS' | 'SATIS',
    taxpayer: any,
    path: string,
  ): ProviderInvoicePayload {
    const attrs = item?.attributes || {};
    const invoiceNo = String(attrs.invoice_no || attrs.invoice_id || item?.id || '').trim();
    return {
      externalId: `${path}:${item?.id || invoiceNo}`,
      originalName: invoiceNo ? `${invoiceNo}.xml` : `parasut-${path}-${item?.id || randomUUID()}.xml`,
      xml: this.syntheticParasutXml(item, included, direction, taxpayer),
    };
  }

  private syntheticParasutXml(item: any, included: any[], direction: 'ALIS' | 'SATIS', taxpayer: any) {
    const attrs = item?.attributes || {};
    const counterparty = this.parasutCounterparty(item, included);
    const counterAttrs = counterparty?.attributes || {};
    const ownName = this.reportTaxpayerName(taxpayer);
    const ownTaxNo = this.reportTaxNumber(taxpayer);
    const counterName = String(counterAttrs.name || attrs.description || 'BILINMIYOR').trim();
    const counterTaxNo = String(counterAttrs.tax_number || '').replace(/\D/g, '');
    const invoiceNo = String(attrs.invoice_no || attrs.invoice_id || item?.id || '').trim() || 'BILINMIYOR';
    const issueDate = String(attrs.issue_date || attrs.created_at || '').slice(0, 10);
    const currency = String(attrs.currency || 'TRL').toUpperCase() === 'TRL' ? 'TRY' : String(attrs.currency || 'TRY').toUpperCase();
    const totalVat = this.parasutNumber(attrs.total_vat);
    const total = this.parasutNumber(attrs.net_total ?? attrs.gross_total);
    const taxExclusive = this.parasutNumber(
      attrs.before_taxes_total ?? attrs.gross_total ?? (Number.isFinite(total) && Number.isFinite(totalVat) ? total - totalVat : undefined),
    );
    const supplier = direction === 'SATIS'
      ? { name: ownName, taxNo: ownTaxNo }
      : { name: counterName, taxNo: counterTaxNo };
    const customer = direction === 'SATIS'
      ? { name: counterName, taxNo: counterTaxNo }
      : { name: ownName, taxNo: ownTaxNo };
    const uuid = String(attrs.uuid || attrs.external_id || item?.id || '').trim();

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>${this.xmlEscape(invoiceNo)}</ID>
  ${uuid ? `<UUID>${this.xmlEscape(uuid)}</UUID>` : ''}
  ${issueDate ? `<IssueDate>${this.xmlEscape(issueDate)}</IssueDate>` : ''}
  <DocumentCurrencyCode>${this.xmlEscape(currency)}</DocumentCurrencyCode>
  ${this.syntheticParasutPartyXml('AccountingSupplierParty', supplier.name, supplier.taxNo)}
  ${this.syntheticParasutPartyXml('AccountingCustomerParty', customer.name, customer.taxNo)}
  <TaxTotal><TaxAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(totalVat)}</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(taxExclusive)}</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(total)}</TaxInclusiveAmount>
    <PayableAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(total)}</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`;
  }

  private syntheticParasutPartyXml(tag: string, name: string, taxNo: string) {
    const scheme = taxNo.length === 11 ? 'TCKN' : 'VKN';
    const taxXml = taxNo.length === 10 || taxNo.length === 11
      ? `<PartyIdentification><ID schemeID="${scheme}">${this.xmlEscape(taxNo)}</ID></PartyIdentification>`
      : '';
    return `<${tag}><Party><PartyName><Name>${this.xmlEscape(name || 'BILINMIYOR')}</Name></PartyName>${taxXml}</Party></${tag}>`;
  }

  private parasutCounterparty(item: any, included: any[]) {
    const rels = item?.relationships || {};
    const keys = ['contact', 'supplier', 'spender', 'pay_to', 'customer'];
    for (const key of keys) {
      const data = rels?.[key]?.data;
      const ref = Array.isArray(data) ? data[0] : data;
      if (!ref?.id) continue;
      const found = included.find((inc) => String(inc?.type) === String(ref.type || 'contacts') && String(inc?.id) === String(ref.id));
      if (found) return found;
    }
    return included.find((inc) => String(inc?.type) === 'contacts') || null;
  }

  private parasutNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  private parasutMoney(value: any) {
    return this.parasutNumber(value).toFixed(2);
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
    const lines = await this.gateCodesByPlan(tenantId, taxpayer.id, this.linesFromAmounts({
      invoiceKind: direction,
      matrah: parsed.matrah,
      kdvTutari: parsed.kdvTutari,
      kdvOrani: parsed.kdvOrani,
      total,
      vendorName: direction === 'SATIS' ? parsed.alici : parsed.satici,
    }));

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

  // v2.3: Upload-OCR yolu da satis/alis yon-duyarli olsun (eskiden hep ALIS
  // varsayip 770/320 yaziyordu; yuklenen satis faturasi yanlis fislenirdi).
  // Yon bilgisini alip ortak, test edilmis linesFromAmounts'a delege ediyoruz.
  private linesFromOcr(ocrResult: OcrResult | null, invoiceKind: string = 'ALIS') {
    const rawBreakdown = Array.isArray(ocrResult?.kdvBreakdown) ? (ocrResult as any).kdvBreakdown : [];
    const breakdown = rawBreakdown
      .map((b: any) => {
        const rate = Number(b.oran) || 0;
        const amount = Number(b.tutar) || 0;
        const base = (b.matrah != null && Number(b.matrah) > 0)
          ? Number(b.matrah)
          : (rate > 0 ? Number((amount / (rate / 100)).toFixed(2)) : 0);
        return { rate, base, amount };
      })
      .filter((b: { base: number; amount: number }) => b.amount > 0 || b.base > 0);

    const totalNum = this.numFromOcr(ocrResult?.totalTutari);
    const kdvTotal = breakdown.length
      ? breakdown.reduce((s: number, b: { amount: number }) => s + b.amount, 0)
      : this.numFromOcr(ocrResult?.kdvTutari);
    const matrah = Math.max(totalNum - kdvTotal, 0);

    return this.linesFromAmounts({
      invoiceKind,
      matrah,
      kdvTutari: kdvTotal,
      kdvOrani: breakdown[0]?.rate,
      total: totalNum,
      vendorName: ocrResult?.satici || null,
      kdvBreakdown: breakdown.length ? breakdown : null,
    });
  }

  /** Mükellefin Luca hesap planı (READY snapshot, en az 1 kod) çekilmiş mi? */
  private async hasAccountPlan(tenantId: string, taxpayerId?: string | null): Promise<boolean> {
    if (!taxpayerId) return false;
    const snap = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { accountCount: true },
    }).catch(() => null);
    return !!(snap && Number(snap.accountCount) > 0);
  }

  /** En son READY hesap planı snapshot'ındaki TÜM hesap kodlarını Set olarak döndürür;
   *  plan yoksa (ya da boşsa) null. Placeholder / planda-olmayan kod süzmede kullanılır —
   *  KULLANICI KURALI: "yalnız Luca'dan çekilen gerçek hesap planındaki kodlar; olmayan
   *  hesabı var gibi yazmak yok." */
  private planCodeCache = new Map<string, { at: number; codes: Set<string> | null }>();
  private async getPlanCodeSet(tenantId: string, taxpayerId?: string | null): Promise<Set<string> | null> {
    if (!taxpayerId) return null;
    const key = `${tenantId}:${taxpayerId}`;
    const hit = this.planCodeCache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.codes; // 30sn cache (liste/rematch sık çağırır)
    const snap = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }).catch(() => null);
    let codes: Set<string> | null = null;
    if (snap) {
      const lines = await (this.prisma as any).lucaAccountPlanLine.findMany({
        where: { snapshotId: snap.id },
        select: { accountCode: true },
      }).catch(() => []);
      if (lines.length) codes = new Set(lines.map((l: any) => String(l.accountCode || '').trim()).filter(Boolean));
    }
    this.planCodeCache.set(key, { at: Date.now(), codes });
    return codes;
  }

  /** Satır hesap kodlarını mükellefin GERÇEK Luca planına göre süzer.
   *  Plan YOK → tüm kodları boşalt (önce hesap planı çekilsin).
   *  Plan VAR → planda OLMAYAN kodu (191.01.020 gibi placeholder/uydurma) boşalt; gerçek
   *  plan kodu kalır. Okuma + rematch sonradan doğru kodu yazar. */
  private async gateCodesByPlan(tenantId: string, taxpayerId: string | null | undefined, lines: any[]): Promise<any[]> {
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
    if (!planCodes) return (lines || []).map((l) => ({ ...l, accountCode: null }));
    return (lines || []).map((l) => {
      const c = String(l.accountCode || '').trim();
      return c && !planCodes.has(c) ? { ...l, accountCode: null } : l;
    });
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
    // v2.4: KDV tevkifat oranı (KDV'nin sorumlu sıfatıyla beyan edilen kesri, 0..1; örn 5/10=0.5)
    tevkifatOrani?: number | null;
  }) {
    const isSale = opts.invoiceKind === 'SATIS';
    const cariCode = isSale ? '120.01.001' : '320.01.001';
    const matrahCode = isSale ? '600.01.001' : '770.01.010';
    const zero = () => new Prisma.Decimal(0);

    // Breakdown geçerli mi? — En az bir satırda base veya amount > 0 olmalı
    const breakdown = this.normalizeKdvBreakdown(opts.kdvBreakdown);
    const hasBreakdown = breakdown.some((b) => Number(b.base || 0) > 0 || Number(b.amount || 0) > 0);

    // v2.4: TEVKİFATLI fatura — alışta 2×191 (normal + sorumlu sıf.) + net cari + 360;
    // satışta hesaplanan KDV yalnız tevkifat-dışı kısımdır (kalanı alıcı sorumlu sıf. beyan eder).
    const tk = Number(opts.tevkifatOrani) || 0;
    if (tk > 0 && tk < 1) {
      const m = hasBreakdown
        ? breakdown.reduce((s, b) => s.plus(money(b.base) || zero()), zero())
        : (money(opts.matrah) || zero());
      const k = hasBreakdown
        ? breakdown.reduce((s, b) => s.plus(money(b.amount) || zero()), zero())
        : (money(opts.kdvTutari) || zero());
      const tevk = k.mul(tk);
      const normalK = k.minus(tevk);
      const primaryRate = hasBreakdown ? breakdown[0]?.rate : (opts.kdvOrani ? Number(opts.kdvOrani) : undefined);
      const rl = primaryRate ? `%${primaryRate}` : undefined;
      const net = m.plus(normalK);
      if (!isSale) {
        // ALIŞ tevkifat (KDV2): alıcı TAM KDV'yi indirir (191), satıcıya NET öder (320),
        // tevkifat kısmını sorumlu sıfatıyla 360'a yazıp KDV2 beyannamesiyle bildirir.
        //   770 matrah (Borç) · 191 TAM KDV (Borç) · 320 net cari (Alacak) · 360 tevkifat (Alacak)
        // 360 ayrı 'tevkifat' grubunda → cari eşleştirme onu satıcı carisine EZMESİN; plandaki
        // gerçek 360 hesabına bağlanır (bkz. rematch 'tevkifat' kolu).
        return [
          { group: 'matrah', accountCode: matrahCode, description: 'Gider / matrah', debit: m, credit: zero(), orderNo: 0 },
          { group: 'vergi', accountCode: this.kdvAccountCode(false, primaryRate), description: `İndirilecek KDV ${rl || ''}`.trim(), rate: rl, debit: k, credit: zero(), orderNo: 1 },
          { group: 'cari', accountCode: cariCode, description: opts.vendorName || 'Cari hesap', debit: zero(), credit: net, orderNo: 2 },
          { group: 'tevkifat', accountCode: '360.01.001', description: 'Ödenecek KDV (sorumlu sıf. — KDV2 ile beyan)', rate: rl, debit: zero(), credit: tevk, orderNo: 3 },
        ];
      }
      return [
        { group: 'cari', accountCode: cariCode, description: opts.vendorName || 'Cari hesap', debit: net, credit: zero(), orderNo: 0 },
        { group: 'matrah', accountCode: matrahCode, description: 'Satış matrahı', debit: zero(), credit: m, orderNo: 1 },
        { group: 'vergi', accountCode: this.kdvAccountCode(true, primaryRate), description: `Hesaplanan KDV (tevkifat sonrası) ${rl || ''}`.trim(), rate: rl, debit: zero(), credit: normalK, orderNo: 2 },
      ];
    }

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
            accountCode: this.kdvAccountCode(isSale, item.rate),
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
    const rateNumber = opts.kdvOrani ? Number(opts.kdvOrani) : undefined;
    const rate = rateNumber ? `%${rateNumber.toLocaleString('tr-TR')}` : undefined;

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
        accountCode: this.kdvAccountCode(isSale, rateNumber),
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

  /** DEMİRBAŞ (sabit kıymet) tespiti — fatura İÇERİĞİ + mükellefin FAALİYETİ ile birlikte değerlendirir.
   *  Demirbaş alış/satışı amortisman + özel kayıt (255/257/268; satışta 255 çıkış + 679/689 kâr/zarar)
   *  gerektirir → Fatura Merkezi OTOMATİK işlemez; uyarı verip MANUEL (Luca) bırakır. Hem alış hem satış.
   *  "Nokta-yama" DEĞİL: bir cihaz/makine adı TEK BAŞINA yetmez — mükellef o ürünü TİCARETEN satıyorsa
   *  (faaliyet/ünvan/NACE'de geçiyorsa) o ürün TİCARİ MAL'dır (klima ticareti yapanın kliması = ticari mal),
   *  satmıyorsa (lokantanın kliması) = DEMİRBAŞ. AI'ın "demirbas" kategorisi de birincil sinyaldir. */
  private detectFixedAsset(ocrData: any, taxpayer: any): { is: boolean; reason: string } {
    const ocr = ocrData || {};
    const fold = (s: string) => this.norm(s).replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
    const kalemAd = Array.isArray(ocr.kalemler) ? ocr.kalemler.map((k: any) => String(k?.ad || '')).join(' ') : '';
    const blob = fold(`${kalemAd} ${ocr.giderTuru || ''} ${ocr.muhasebeNeden || ''}`);
    // Güçlü sabit-kıymet anahtarları (asciiFold edilmiş, kök biçimde). Sarf/gıda/hizmet bunlara girmez.
    const ASSET = [
      'klima', 'iklimlendirme', 'kombi', 'kazan dair', 'buzdolab', 'dondurucu', 'sogutucu', 'sogutma dolab',
      'davlumbaz', 'set ustu ocak', 'bulasik makin', 'camasir makin', 'kurutma makin', 'kahve makin', 'hamur makin',
      'makine', 'makina', 'jenerator', 'kompresor', 'forklift', 'transpalet', 'celik tezgah', 'vitrin',
      'bilgisayar', 'laptop', 'dizustu', 'monitor', 'yazici', 'fotokopi', 'tarayici', 'projeksiyon',
      'televizyon', 'mobilya', 'demirbas', 'sabit kiymet', 'asansor', 'kamera sistem', 'guvenlik kamera',
    ];
    // İÇERİK sinyali ŞART: faturada gerçek cihaz/makine/sabit-kıymet adı geçmeli. AI'ın salt "demirbas"
    //   KATEGORİSİ TEK BAŞINA güvenilmez — AI, mükellefin faaliyet açıklamasındaki cihaz isimlerine
    //   kapılıp HİZMET/onarım gelirini bile "demirbas" diyebiliyordu (beyaz eşya TAMİRCİSİNİN onarım
    //   SATIŞLARI yanlışlıkla demirbaş işaretleniyordu — gerçek prod verisinde 23 belge). Bu yüzden
    //   yalnız fatura İÇERİĞİNDEKİ (kalem/giderTuru) gerçek mala bakılır.
    const hitWord = ASSET.find((w) => blob.includes(w)) || '';
    if (!hitWord) return { is: false, reason: '' };
    // Mükellef bu ürünü TİCARETEN satıyor / üretiyor / ONARIYORSA (faaliyet/ünvan/NACE'de ürün KÖKÜ
    //   geçiyorsa) → o ürün ticari mal / hizmet konusudur, DEMİRBAŞ DEĞİL (klima ticareti/onarımı yapanın
    //   kliması demirbaş değildir; lokantanın kliması demirbaştır).
    const faal = fold(`${taxpayer?.faaliyetAciklama || ''} ${taxpayer?.companyName || ''} ${taxpayer?.naceKodu || ''}`);
    const kok = hitWord.split(' ')[0].slice(0, 6); // "klima"→klima, "bilgisayar"→bilgis, "buzdolab"→buzdol
    if (kok.length >= 4 && faal.includes(kok)) return { is: false, reason: '' };
    return { is: true, reason: hitWord };
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
    tevkifatli?: boolean;
    hasTevkifatLine?: boolean;
    tevkifatOrani?: number;
    isReturn?: boolean;
    hasReturnLine?: boolean;
    documentType?: string | null;
    fixedAsset?: { is: boolean; reason: string };
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
    // Yevmiye satirlarindan matrah: "matrah" grubundaki satirlarin tutari (OCR matrah'i
    // bos olsa da satirlar dolu olabilir — Azure rawText verir ama matrah'i yapilandirmaz).
    const linesMatrah = opts.lines
      .filter((l) => String((l as any).group || '').toLowerCase() === 'matrah')
      .reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
    // Satirlar belge toplamini zaten karsiliyorsa (dengeli + tutara esit) matrah/KDV
    // ayristirilmis demektir; INCOMPLETE damgasi yanlis olur.
    const journalTop = Math.max(sumDebit, sumCredit);
    const linesCoverTotal =
      opts.lines.length > 0 && journalTop > 0 && totalAmount > 0 &&
      Math.abs(journalTop - totalAmount) <= Math.max(TOL, totalAmount * 0.001);
    const hasAnyMatrah = matrahN > 0 || breakdownSumBase > 0 || linesMatrah > 0 || linesCoverTotal;
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

    // ── 3) TOTAL_MISMATCH — yevmiye toplamı ≠ belge toplamı. ÇOK-ORANLI faturada her oran satırı
    //   AYRI yuvarlanır (kuruş) → toplam birkaç kuruş sapabilir; tolerans satır sayısına göre esnetilir
    //   (yoksa A101 gibi çok-oranlı belgeler kuruş farkıyla boş yere "çelişki"ye düşüyordu).
    if (totalAmount > 0) {
      const yevmiyeToplam = Math.max(sumDebit, sumCredit);
      const rateLineCount = opts.lines.filter((l) => ['matrah', 'vergi'].includes(String((l as any).group || ''))).length;
      // KURUŞ yuvarlama toleransı: Türk e-faturasında her kalemin KDV'si AYRI yuvarlanıp toplanır →
      //   kalem toplamı, faturanın "genel toplam" satırından birkaç kuruş sapabilir (okuma hatası DEĞİL,
      //   muhasebe yuvarlaması). 50 kuruşa kadar tolere; gerçek hata (TL-seviyesi fark) + KDV-matematik
      //   bozukluğu (KDV_MATH) + denge bozukluğu (BALANCE) yine yakalanır.
      const totalTol = Math.max(0.5, rateLineCount * 0.05);
      if (Math.abs(yevmiyeToplam - totalAmount) > totalTol) {
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

    // ── 5) KDV_MATH_MISMATCH — KDV tutarı matrah×oran'dan FAZLA olamaz (okuma hatası).
    //     Tevkifat KDV'yi AZALTIR (artırmaz); "fazla" yönü kesin hatadır → tevkifatlı
    //     faturada yanlış alarm vermez. Bu, "yanlış ama dengeli" sessiz KDV hatasını yakalar
    //     (ör. matrah 900 %20 iken KDV 280 okunmuşsa: beklenen 180, fazla → hata).
    const stdRates = new Set([1, 8, 10, 18, 20]);
    for (const b of (opts.kdvBreakdown || [])) {
      const rate = Number(b?.rate || 0);
      const base = Number(b?.base || 0);
      const amount = Number(b?.amount || 0);
      if (base <= 0 || amount <= 0 || !stdRates.has(Math.round(rate))) continue;
      const expectedFull = base * rate / 100;
      if (amount > expectedFull * 1.02 + 0.5) {
        issues.push({
          code: 'KDV_MATH_MISMATCH',
          severity: 'ERROR',
          message: `%${rate} satırda KDV ${amount.toLocaleString('tr-TR')} ₺, matrahtan (${base.toLocaleString('tr-TR')} ₺) beklenen ${expectedFull.toLocaleString('tr-TR')} ₺'den FAZLA — okuma hatası, kontrol et.`,
          expected: Math.round(expectedFull * 100) / 100,
          actual: amount,
        });
      }
    }

    // ── 7) RETURN_NEEDS_REVERSAL — iade/iptal faturası normal kayıtla onaylanamaz.
    //     Satıştan iade 610'a (ters kayıt) gider; düz 600/770 ciroyu/KDV'yi ŞİŞİRİR.
    if (opts.isReturn && !opts.hasReturnLine) {
      issues.push({
        code: 'RETURN_NEEDS_REVERSAL',
        severity: 'ERROR',
        message: 'İade/iptal faturası — normal kayıt yapılamaz. Satıştan iadede 610 (ters kayıt) kullan; borç/alacak yönünü çevir. Satırları elle düzelt, sonra onayla.',
      });
    }

    // ── 8) SMM_STOPAJ_NEEDED — alınan Serbest Meslek Makbuzu'nda gelir vergisi stopajı
    //     (%20 → 360 sorumlu) yoksa onaylanamaz. İşletme/bilanço fark etmez, alışta stopaj şart.
    if (String(opts.documentType || '').toUpperCase() === 'E_SMM'
      && String(opts.invoiceKind || '').toUpperCase() !== 'SATIS'
      && !(opts.lines || []).some((l: any) => String((l as any).accountCode || '').startsWith('360'))) {
      issues.push({
        code: 'SMM_STOPAJ_NEEDED',
        severity: 'ERROR',
        message: 'Serbest Meslek Makbuzu — gelir vergisi stopajı (%20 / 360 sorumlu sıfatı) eklenmeden onaylanamaz. Stopaj satırını ekle.',
      });
    }

    // ── 6) TEVKIFAT — yöne göre:
    //   • ALIŞ tevkifat: alıcı KDV2 sorumlu sıfatıyla beyan eder → 360 satırı ŞART; yoksa blokla.
    //   • SATIŞ tevkifat: satıcı yalnız NET KDV'yi tahsil/beyan eder (360 GEREKMEZ). Ama tevkifat
    //     tutarı OKUNMADIYSA (tevkifatOrani=0) yevmiye TAM KDV ile çıkar → yanlış; kontrol et.
    if (opts.tevkifatli) {
      const sale = String(opts.invoiceKind || '').toUpperCase() === 'SATIS';
      if (!sale && !opts.hasTevkifatLine) {
        issues.push({
          code: 'TEVKIFAT_NEEDED',
          severity: 'ERROR',
          message: 'Tevkifatlı ALIŞ — sorumlu sıfatıyla KDV2 (360) satırı eksik. Tevkifat oranı okunmadıysa "Tevkifat fişini kur" ile seç; hesap planında 360 (Ödenecek KDV) hesabı yoksa önce onu ekle.',
        });
      } else if (sale && !(Number(opts.tevkifatOrani || 0) > 0)) {
        issues.push({
          code: 'TEVKIFAT_NET_NEEDED',
          severity: 'ERROR',
          message: 'Tevkifatlı SATIŞ — tevkifat tutarı okunamadı, KDV TAM görünüyor. Tevkifat oranını gir (KDV net hesaplanmalı: tahsil edilen = KDV − tevkifat).',
        });
      }
    }

    // ── 9) FIXED_ASSET_MANUAL — DEMİRBAŞ (sabit kıymet) alış/satışı OTOMATİK işlenmez. Amortisman +
    //     özel kayıt (alışta 255/257/268; satışta 255 çıkış + 679/689 kâr-zarar) gerektirir → kullanıcı
    //     Luca'dan MANUEL işler. ERROR → status INVALID → otomatik onay/aktarım engellenir (uyarı kalır).
    if (opts.fixedAsset?.is) {
      const sale = String(opts.invoiceKind || '').toUpperCase() === 'SATIS';
      const r = String(opts.fixedAsset.reason || '').trim();
      issues.push({
        code: 'FIXED_ASSET_MANUAL',
        severity: 'ERROR',
        message: `Demirbaş / sabit kıymet ${sale ? 'satışı' : 'alışı'}${r && r !== 'demirbaş' ? ` (${r})` : ''} — otomatik muhasebeleştirilmez. Amortisman ve özel kayıt gerektirir; Luca'dan manuel işleyin.`,
      });
    }

    // Sonuç durumu
    const hasIncomplete = issues.some((i) => i.code === 'INCOMPLETE_AMOUNTS');
    const hasInvalid = issues.some((i) => i.code !== 'INCOMPLETE_AMOUNTS' && i.severity === 'ERROR');
    const status = hasInvalid ? 'INVALID' : hasIncomplete ? 'INCOMPLETE' : 'OK';
    return { status, issues };
  }

  /** HIZLI düzeltme: belgeleri TEKRAR OKUMADAN (Max-vision yok) hesap kodlarını plana göre
   *  yeniden eşleştirir — yanlış carileri (KAYIKÇI→AYDE) temizler/doğrular. Saniyeler sürer. */
  async reapplyAccountCodes(tenantId: string, taxpayerId: string) {
    if (!taxpayerId) throw new BadRequestException('Mükellef seçilmeli');
    await this.gateExistingDocsIfNoPlan(tenantId, taxpayerId);
    await this.rematchDocumentsWithLatestAccountPlan(tenantId, taxpayerId);
    // ÇELİŞKİ TAZELE: rematch satır/kodları güncelledi → ESKİ validation kayıtlarını (artık
    //   geçersiz "çelişki" mesajları, ör. eski yevmiye toplamı) GÜNCEL satırlarla yeniden hesapla.
    //   Denge tutan eski TOTAL_MISMATCH/BALANCE temizlenir; gerçek sorun (denge/sahiplik) kalır +
    //   nedeni güncel. Böylece "Kodları düzelt" çelişki kayıtlarını da tazeler (yeniden okuma şart değil).
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, taxpayerId, status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] } },
      select: { id: true, totalAmount: true, lines: { select: { debit: true, credit: true } } }, take: 1000,
    }).catch(() => []);
    for (const d of docs) {
      // Yevmiye DENGELİYSE belge toplamını YEVMİYEDEN (matrah+kdv) düzelt — eski parsed.toplam KDV
      //   HARİÇ olabilir (858 vs 858,50) → TOTAL_MISMATCH. Denge bozuksa dokunma (gerçek sorun, kalsın).
      const sumD = (d.lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const sumC = (d.lines || []).reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      if (Math.abs(sumD - sumC) <= 0.02) {
        const yev = Math.round(Math.max(sumD, sumC) * 100) / 100;
        if (yev > 0 && Math.abs(yev - Number(d.totalAmount || 0)) > 0.02) {
          await (this.prisma as any).invoiceAccountingDocument.update({ where: { id: d.id }, data: { totalAmount: yev } }).catch(() => {});
        }
      }
      await this.revalidateDocument(tenantId, d.id).catch(() => {});
    }
    return { ok: true };
  }

  private async rematchDocumentsWithLatestAccountPlan(tenantId: string, taxpayerId?: string | null, documentIds?: string[]) {
    if (!taxpayerId) return;
    const latest = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
      where: { tenantId, taxpayerId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latest?.id) {
      await this.rematchPendingDocumentsWithAccountPlan(tenantId, taxpayerId, latest.id, documentIds);
    } else {
      // Hesap planı çekilmemiş mükellefte bile öğrenilmiş satıcı kodlarını uygula.
      await this.applyLearnedVendorCodes(tenantId, taxpayerId, documentIds).catch(() => {});
    }
  }

  /**
   * Bir satıcı için öğrenilmiş (müşavirin onayladığı) hesap kodunu döndürür — hesap planı GEREKTİRMEZ.
   * kararTipi='fatura' kararlarında `kategori` = hesap kodudur. Yalnız rakamla başlayan gerçek kod döner.
   */
  private async pickLearnedAccountCode(tenantId: string, taxpayerId: string, firmaKimlikNo: string, rate?: string | null): Promise<string | null> {
    const vkn = String(firmaKimlikNo || '').trim();
    if (!vkn || !taxpayerId) return null;
    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
      include: {
        decisions: {
          where: { taxpayerId, kararTipi: 'fatura' },
          orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }],
          take: 16,
        },
      },
    });
    const decisions = (memory?.decisions || [])
      .filter((d: any) => /^\d/.test(String(d.kategori || '').trim()))
      // Cari (altKategori='CARI') kararları matrah/gider kodu DEĞİLDİR — dışla.
      .filter((d: any) => String(d.altKategori || '').trim().toUpperCase() !== 'CARI');
    const r = String(rate || '').replace(/[^0-9]/g, '');
    // Öncelik: 1) bu KDV oranına özel kural, 2) orana bağsız (genel) kural, 3) en çok onaylanan.
    const byRate = r ? decisions.find((d: any) => String(d.altKategori || '').replace(/[^0-9]/g, '') === r) : null;
    const general = decisions.find((d: any) => !String(d.altKategori || '').trim());
    const pick = byRate || general || decisions[0];
    const code = String(pick?.kategori || '').trim();
    return code && /^\d/.test(code) ? code : null;
  }

  /**
   * Öğrenilmiş satıcı kodlarını bekleyen ALIŞ belgelerinin matrah satırlarına uygular.
   * Yalnız müşavirin onayladığı kodları kullanır — tahmin/sınıflandırma YAPMAZ, sıfır risk.
   * Hesap planı çekilmemiş mükelleflerde de çalışır.
   */
  private async applyLearnedVendorCodes(tenantId: string, taxpayerId: string, documentIds?: string[]): Promise<number> {
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId,
        taxpayerId,
        invoiceKind: 'ALIS',
        status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] },
        ...(documentIds?.length ? { id: { in: documentIds } } : {}),
      },
      select: { id: true, sellerVkn: true, lines: { where: { group: 'matrah' }, select: { id: true, accountCode: true, rate: true } } },
      take: 1000,
    });
    if (!docs.length) return 0;
    // (vkn|rate) → öğrenilmiş kod önbelleği. Her matrah satırı KENDİ oranına göre kodlanır.
    const cache = new Map<string, string | null>();
    let applied = 0;
    for (const doc of docs) {
      const vkn = String(doc.sellerVkn || '').replace(/\D/g, '');
      if (!vkn) continue;
      for (const l of (doc.lines || [])) {
        const rate = String(l.rate || '').replace(/[^0-9]/g, '');
        const key = `${vkn}|${rate}`;
        let learned = cache.get(key);
        if (learned === undefined) {
          learned = await this.pickLearnedAccountCode(tenantId, taxpayerId, vkn, rate);
          cache.set(key, learned);
        }
        if (!learned || String(l.accountCode || '').trim() === learned) continue;
        await (this.prisma as any).invoiceAccountingLine.update({
          where: { id: l.id },
          data: { accountCode: learned },
        });
        applied++;
      }
    }
    return applied;
  }

  /**
   * Elle eşleştirme kuralı: satıcı VKN → hesap kodu. recordDecision ile öğrenilir
   * ve hemen o satıcının bekleyen belgelerine uygulanır (hesap planı gerekmez).
   */
  async setVendorRule(
    tenantId: string,
    input: { taxpayerId?: string; vendorVkn?: string; vendorName?: string; accountCode?: string; kdvOrani?: number | string | null },
  ) {
    const taxpayerId = String(input.taxpayerId || '').trim();
    const vendorVkn = String(input.vendorVkn || '').replace(/\D/g, '');
    const accountCode = String(input.accountCode || '').trim();
    // kdvOrani verilirse kural O ORANA ÖZEL olur (altKategori); verilmezse tüm oranlar (genel).
    const rate = String(input.kdvOrani ?? '').replace(/[^0-9]/g, '') || null;
    if (!taxpayerId) throw new BadRequestException('Mükellef seçilmeli');
    if (!vendorVkn) throw new BadRequestException('Satıcı VKN/TCKN gerekli');
    if (!/^\d/.test(accountCode)) throw new BadRequestException('Geçerli bir hesap kodu girin (rakamla başlamalı)');
    await this.vendorMemory.recordDecision({
      tenantId,
      firmaKimlikNo: vendorVkn,
      firmaUnvan: input.vendorName || null,
      kararTipi: 'fatura',
      kategori: accountCode,
      altKategori: rate,
      taxpayerId,
    });
    const applied = await this.applyLearnedVendorCodes(tenantId, taxpayerId);
    return { ok: true, vendorVkn, accountCode, rate, applied };
  }

  // Öğrenilmiş bir kuralı (vendor decision) sil.
  async deleteVendorRule(tenantId: string, decisionId: string) {
    const id = String(decisionId || '').trim();
    if (!id) throw new BadRequestException('Kural id gerekli');
    const dec = await (this.prisma as any).vendorMemoryDecision.findUnique({
      where: { id },
      include: { vendorMemory: { select: { tenantId: true } } },
    });
    if (!dec || dec.vendorMemory?.tenantId !== tenantId) throw new NotFoundException('Kural bulunamadı');
    await (this.prisma as any).vendorMemoryDecision.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Matrah/KDV kırılımı çıkmamış belgeler (ör. Mihsap'tan yalnız toplamı gelen satış faturaları)
   * için: verilen KDV oranına göre toplamı matrah+KDV'ye böler ve fiş satırlarını yeniden üretir.
   * Oranı MÜŞAVİR verir — tahmin yok. Satışta kod 600, alışta 770 default; sonra öğrenilen kod uygulanır.
   */
  async setDocumentsKdvRate(tenantId: string, input: { documentIds?: string[]; kdvOrani?: number; accountCode?: string; tevkifatOrani?: number }) {
    const rate = Number(input.kdvOrani);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new BadRequestException('Geçerli KDV oranı girin (0–100)');
    const tevkifatOrani = Number(input.tevkifatOrani) > 0 && Number(input.tevkifatOrani) < 1 ? Number(input.tevkifatOrani) : 0;
    const ids = (input.documentIds || []).filter(Boolean);
    if (!ids.length) throw new BadRequestException('Belge seçilmedi');
    const manualCode = String(input.accountCode || '').trim();
    const hasManualCode = /^\d/.test(manualCode);
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, id: { in: ids }, status: { not: 'APPROVED' } },
      select: { id: true, taxpayerId: true, invoiceKind: true, totalAmount: true, vendorName: true, customerName: true, sellerVkn: true, ocrData: true },
    });
    let ok = 0, skipped = 0;
    const taxpayerIds = new Set<string>();
    for (const d of docs) {
      const total = Number(typeof d.totalAmount === 'object' && d.totalAmount != null ? String(d.totalAmount) : d.totalAmount);
      if (!Number.isFinite(total) || total <= 0) { skipped++; continue; }
      const matrah = rate > 0 ? Math.round((total / (1 + rate / 100)) * 100) / 100 : total;
      const kdv = Math.round((total - matrah) * 100) / 100;
      const isSale = String(d.invoiceKind || 'ALIS') === 'SATIS';
      // Plan yoksa kod atanmasın (tutarlılık). Elle kod verildiyse aşağıda matrah'a yine yazılır.
      const lines = await this.gateCodesByPlan(tenantId, d.taxpayerId, this.linesFromAmounts({
        invoiceKind: d.invoiceKind || 'ALIS',
        matrah, kdvTutari: kdv, kdvOrani: rate, total,
        vendorName: isSale ? d.customerName : d.vendorName,
        kdvBreakdown: (kdv > 0 || matrah > 0) ? [{ rate, base: matrah, amount: kdv }] : null,
        tevkifatOrani: tevkifatOrani || null,
      }));
      await (this.prisma as any).$transaction(async (tx: any) => {
        await tx.invoiceAccountingLine.deleteMany({ where: { documentId: d.id } });
        if (lines.length) await tx.invoiceAccountingLine.createMany({ data: lines.map((l: any) => ({ ...l, documentId: d.id })) });
        if (hasManualCode) {
          await tx.invoiceAccountingLine.updateMany({ where: { documentId: d.id, group: 'matrah' }, data: { accountCode: manualCode } });
        }
        await tx.invoiceAccountingDocument.update({
          where: { id: d.id },
          data: {
            status: 'NEEDS_REVIEW',
            // K9: hardcoded 'OK' KALDIRILDI — gerçek doğrulama aşağıda revalidateDocument
            // ile hesaplanır (dengesiz/yanlış KDV sessizce 'OK' damgalanmasın).
            ocrData: { ...((d.ocrData as any) || {}), matrah, kdvTutari: kdv, kdvOrani: rate, kdvBreakdown: [{ oran: rate, matrah, tutar: kdv }], tevkifatOrani: tevkifatOrani || 0 },
          },
        });
      });
      await this.revalidateDocument(tenantId, d.id).catch(() => {});
      // Elle verilen hesap kodunu öğren — bu satıcının sonraki faturaları otomatik alsın
      if (hasManualCode && !isSale && d.sellerVkn) {
        await this.vendorMemory.recordDecision({
          tenantId, firmaKimlikNo: String(d.sellerVkn).replace(/\D/g, ''), firmaUnvan: d.vendorName,
          kararTipi: 'fatura', kategori: manualCode, taxpayerId: d.taxpayerId,
        }).catch(() => {});
      }
      if (d.taxpayerId) taxpayerIds.add(d.taxpayerId);
      ok++;
    }
    // Elle kod verilmediyse, alış belgelerinde öğrenilmiş satıcı kodlarını uygula (770 yerine 153 vb.)
    if (!hasManualCode) {
      for (const tid of taxpayerIds) {
        await this.applyLearnedVendorCodes(tenantId, tid).catch(() => {});
      }
    }
    // Placeholder kodları (cari 320/120, KDV 191/391, TEVKİFAT 360) mükellefin planındaki
    // gerçek hesaplara eşle — "Tevkifat fişini kur"da 360 sahte placeholder'da kalmasın.
    for (const tid of taxpayerIds) {
      await this.rematchDocumentsWithLatestAccountPlan(tenantId, tid, ids).catch(() => {});
    }
    return { ok, skipped, kdvOrani: rate, accountCode: hasManualCode ? manualCode : null };
  }

  /**
   * Bir belgeyi Max-vision (claudeTextViaMax görsel) ile OKUR — Azure/ücretli API GEREKMEZ,
   * Max aboneliğinden çalışır (Max-only kuralına uygun). KDV kırılımını çıkarıp fiş satırlarını üretir.
   * Kilitli KDV/OCR modülüne DOKUNMAZ. Tek belge (frontend sırayla çağırır → HTTP timeout yok).
   */
  async aiReadDocument(tenantId: string, documentId: string) {
    const d = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, id: documentId },
      select: { id: true, status: true, taxpayerId: true, invoiceKind: true, totalAmount: true, vendorName: true, customerName: true, belgeNo: true, source: true, sourceRefId: true, mimeType: true, s3Key: true, ocrData: true },
    });
    if (!d) throw new NotFoundException('Belge bulunamadı');
    if (d.status === 'APPROVED') return { ok: false, reason: 'onaylı' };

    // Belge içeriğini fileUrl mantığıyla getir — Mihsap CDN indirme + XML→HTML render
    // ORADA çalışıyor (belge görüntüsü açılıyor). Eski özel indirme yolu "dosya yok"
    // dönüyordu; artık aynı kaynağı kullanıyoruz.
    let html = '';
    let imgBuf: Buffer | null = null;
    let imgMedia = '';
    try {
      const fu: any = await this.fileUrl(tenantId, documentId);
      if (fu?.inlineHtml) {
        html = String(fu.inlineHtml);
      } else if (typeof fu?.url === 'string' && fu.url) {
        const dm = fu.url.match(/^data:([^;]+);base64,(.+)$/);
        if (dm) { imgMedia = dm[1]; imgBuf = Buffer.from(dm[2], 'base64'); }
        else if (/^https?:/i.test(fu.url)) { const r = await fetch(fu.url); imgBuf = Buffer.from(await r.arrayBuffer()); imgMedia = String(fu.mimeType || r.headers.get('content-type') || ''); }
      }
    } catch (e: any) {
      return { ok: false, reason: 'belge getirilemedi: ' + (e?.message || '') };
    }
    const isImage = !!imgBuf && imgBuf.length > 200 && /^image\//i.test(imgMedia);
    // XML e-Arşiv/e-Fatura → UBL PARSE (AI'siz, BİREBİR; okuma asla başarısız olmaz).
    let preParsed: any = null;
    if (!isImage && !(html && html.length > 80) && imgBuf && /xml/i.test(imgMedia)) {
      const xml = imgBuf.toString('utf8');
      const ubl = this.parseProviderUblInvoice(xml) || this.regexProviderInvoiceFallback(xml);
      if (ubl && ((Number(ubl.matrah) || 0) > 0 || (Number(ubl.kdvTutari) || 0) > 0 || (Number(ubl.toplamTutar) || 0) > 0)) {
        const td: any = ubl.faturaTarihi;
        const dt = td instanceof Date && !Number.isNaN(td.getTime())
          ? `${String(td.getUTCDate()).padStart(2, '0')}.${String(td.getUTCMonth() + 1).padStart(2, '0')}.${td.getUTCFullYear()}`
          : null;
        preParsed = {
          belgeNo: ubl.faturaNo, tarih: dt,
          belgeTuru: this.documentTypeFromProviderXml(xml) === 'E_ARSIV' ? 'e-arsiv' : 'e-fatura',
          saticiAd: ubl.satici, saticiVkn: ubl.saticiVergiNo,
          aliciAd: ubl.alici, aliciVkn: ubl.aliciVergiNo,
          toplam: ubl.toplamTutar,
          // İADE faturası: UBL kök öğesi CreditNote ise ya da belgede İADE/İPTAL geçiyorsa.
          iade: /<\w*:?CreditNote[\s>]/i.test(xml) || /\b(İADE|IADE|İPTAL|IPTAL)\b/i.test(xml.slice(0, 4000)),
          // TEVKİFAT: belgede tevkifat/WithholdingTax geçiyorsa (e-Arşiv "Fatura Tipi: TEVKIFAT").
          tevkifat: /TEVKIFAT|WithholdingTax/i.test(xml),
          kdv: [{ oran: ubl.kdvOrani || 0, matrah: ubl.matrah || 0, kdv: ubl.kdvTutari || 0 }],
        };
      }
    }
    // PDF → metne çevir (pdf-parse); metni Max-vision text yoluna ver (vision PDF okuyamaz).
    if (!preParsed && !isImage && !(html && html.length > 80) && imgBuf && /pdf/i.test(imgMedia)) {
      try {
        const pdfParse = require('pdf-parse');
        const r = await pdfParse(imgBuf, { max: 4 });
        if (r?.text && String(r.text).trim().length > 80) html = String(r.text);
      } catch { /* taranmış/şifreli PDF — aşağıda elenir */ }
    }
    // XML ama UBL PARSE BAŞARISIZ → XML'i düz METNE çevirip Max-vision'a ver (yine de okunsun).
    // Bu, "XML yapısı farklı → UBL null → okunamadı" deterministik hatasını kurtarır.
    if (!preParsed && !isImage && !(html && html.length > 80) && imgBuf && /xml/i.test(imgMedia)) {
      const xmlText = imgBuf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (xmlText.length > 80) html = xmlText;
    }
    // UBL parse / HTML metni / görsel — üçü de yoksa okunamaz.
    if (!preParsed && !(html && html.length > 80) && !isImage) {
      return { ok: false, reason: imgBuf ? `belge biçimi okunamadı (${imgMedia || 'bilinmeyen'}, ${imgBuf.length}b)` : 'belge dosyası boş/gelmedi' };
    }

    // GÖRÜNTÜ YENİDEN-KODLAMA: bazı fatura JPEG'leri (CMYK renk uzayı / progressive / bozuk
    // EXIF / şeffaflık) Max-vision CLI'ı çökertiyordu ("Claude Code process exited with code 1").
    // HER görüntüyü sharp ile temiz baseline RGB JPEG'e çevir + küçült → bu çökmeyi giderir,
    // hızlandırır; metin yine okunur. (sharp zaten bağımlı.)
    if (isImage && imgBuf) {
      try {
        const sharp = require('sharp');
        imgBuf = await sharp(imgBuf)
          .rotate()
          .flatten({ background: '#ffffff' })
          .resize({ width: 1500, withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer();
        imgMedia = 'image/jpeg';
      } catch { /* sharp başarısızsa orijinali gönder */ }
    }

    // Mükellefin İŞİNİ/SEKTÖRÜNÜ eşleştirmeye kat → kategori firmanın faaliyetine göre
    // seçilsin (ör. yemek üreticisinde un=hammadde, tüccarda satılan ürün=ticari_mal).
    let mukellefBilgi = '';
    let isIsletmeMukellef = false;
    let ownVkn = ''; // mükellefin kendi VKN/TCKN'si → faturanın YÖNÜNÜ (alış/satış) türetmek için
    if (d.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: d.taxpayerId, tenantId },
        select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true, defterTuru: true, taxNumber: true, identityNumber: true },
      }).catch(() => null);
      if (tp) {
        ownVkn = String(tryDecrypt(tp.taxNumber) || tp.taxNumber || tryDecrypt(tp.identityNumber) || tp.identityNumber || '').replace(/\D/g, '');
        const ad = String(tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`).trim();
        isIsletmeMukellef = String(tp.defterTuru || '').toUpperCase() === 'ISLETME';
        const defter = isIsletmeMukellef ? 'İşletme defteri' : 'Bilanço usulü';
        const faaliyet = String(tp.faaliyetAciklama || '').trim();
        // Öncelik: serbest faaliyet açıklaması (en güvenilir) > NACE kodu > ünvan.
        mukellefBilgi = [
          ad && `ünvanı "${ad}"`,
          faaliyet ? `faaliyeti: ${faaliyet}` : (tp.naceKodu && `NACE faaliyet kodu ${tp.naceKodu}`),
          defter,
        ].filter(Boolean).join(', ');
      }
    }
    // ③ KARAR VERİCİ: BİLANÇO mükellefinde AI'a hesap planından MATRAH-aday hesapları ver →
    //   AI doğru hesabı içerik+faaliyetle DOĞRUDAN seçsin (mekanik kategori→kod eşlemesi yerine;
    //   "çatal-kaşık→mutfak gideri", "lokanta klima→demirbaş" kategori kutusuyla değil, planı görüp).
    //   İŞLETME defterinde hesap planı YOK → atla. Plan yoksa boş → mekanik kategori yedeği devreye girer.
    let planAdaylar = '';
    const planLeafSet = new Set<string>();
    if (d.taxpayerId && !isIsletmeMukellef) {
      const snap = await (this.prisma as any).lucaAccountPlanSnapshot.findFirst({
        where: { tenantId, taxpayerId: d.taxpayerId, status: 'READY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }).catch(() => null);
      if (snap?.id) {
        const allLines: any[] = await (this.prisma as any).lucaAccountPlanLine.findMany({
          where: { snapshotId: snap.id },
          select: { accountCode: true, accountName: true },
        }).catch(() => []);
        // Leaf = noktalı + alt-hesabı OLMAYAN kod (grup/ana hesaba fiş kesilmez).
        const grpCodes = new Set<string>();
        for (const a of allLines) { const c = String(a.accountCode || ''); let ix = c.indexOf('.'); while (ix !== -1) { grpCodes.add(c.slice(0, ix)); ix = c.indexOf('.', ix + 1); } }
        const isLeaf = (c: string) => c.includes('.') && !grpCodes.has(c);
        // MATRAH adayları: stok 15x, sabit kıymet 25x, gider 6xx/7xx, gelir 600 leaf'leri (79x hariç).
        const cand = allLines.filter((a) => { const c = String(a.accountCode || ''); return /^(15\d|25\d|6\d\d|7\d\d)/.test(c) && !c.startsWith('79') && isLeaf(c); });
        for (const a of cand) planLeafSet.add(String(a.accountCode));
        if (cand.length) planAdaylar = cand.slice(0, 220).map((a) => `${a.accountCode} = ${a.accountName}`).join('\n');
      }
    }
    const islSeg = isIsletmeMukellef ? islPromptSeg() : '';
    const prompt = [
      islSeg,
      isImage
        ? 'Aşağıdaki görüntü bir Türk faturası veya yazarkasa fişidir. İçindeki bilgileri oku.'
        : 'Aşağıda bir Türk e-Fatura/e-Arşiv belgesinin HTML/metin içeriği var. İçindeki bilgileri oku.',
      'YALNIZCA şu JSON\'u döndür — kod bloğu, açıklama, başka metin YOK:',
      `{"belgeNo":"<fatura/fiş no ya da null>","tarih":"<GG.AA.YYYY ya da null>","belgeTuru":"<e-arsiv|e-fatura|fis|diger>","saticiAd":"<satıcı ünvanı ya da null>","saticiVkn":"<satıcının VKN/TCKN ya da null>","aliciAd":"<alıcı ünvanı ya da null>","aliciVkn":"<alıcının VKN/TCKN ya da null>","toplam":<genel toplam KDV dahil sayı ya da null>,"kategori":"<asagidaki tek deger>","giderTuru":"<ALIŞ ise faturadaki ana mal/hizmetin kısa adı — aşağıdaki giderTuru kuralına göre; SATIŞ ya da net değilse boş>"${isIsletmeMukellef ? ',"isletmeKayitTuru":"<aşağıdaki İŞLETME listesinden TAM kayıt türü adı; net değilse boş>","isletmeAltTuru":"<o türün listesinden TAM alt adı; net değilse boş>","isletmeNeden":"<tek cümle gerekçe>"' : ''},"muhasebeNeden":"<1 cümle Türkçe muhasebe gerekçesi — aşağıdaki kurala göre>"${planAdaylar ? ',"matrahHesapKodu":"<aşağıdaki HESAP PLANI listesinden matrah/gider için EN UYGUN TAM kod; emin değilsen boş>"' : ''},"kalemler":[{"ad":"<mal/hizmet kalem adı>","tutar":<o kalemin KDV hariç tutarı sayı>,"oran":<o kalemin KDV oranı sayı>}],"kdv":[{"oran":<KDV yüzdesi sayı>,"matrah":<KDV hariç tutar sayı>,"kdv":<KDV tutarı sayı>}]}`,
      'kalemler: faturadaki HER mal/hizmet satırını AYRI listele (kalem adı + KDV hariç tutarı + KDV oranı). Çok kalemliyse (>30) ana/benzer kalemleri grupla; tek kalemse tek nesne. Bu döküm BİLGİ amaçlıdır (muhasebe satırlarını değiştirmez). Okunamazsa boş dizi [].',
      'belgeTuru: belgenin üstündeki ibareye göre → "e-arsiv" (e-Arşiv Fatura), "e-fatura" (e-Fatura), "e-smm" (Serbest Meslek Makbuzu / SMM), "fis" (yazarkasa/ÖKC fişi), yoksa "diger".',
      'JSON\'a "iade": true/false ekle — belge bir İADE FATURASI / İPTAL / CreditNote ise true (üstte "İADE", "İADE FATURASI" yazar ya da senaryo İADE/IPTAL\'dir), normal satış/alış faturasıysa false.',
      'JSON\'a "tevkifat": true/false ekle — belgede KDV TEVKİFATI varsa true (Fatura Tipi: TEVKIFAT, ya da "KDV TEVKİFAT (%..)=... TL" satırı/Diğer Vergiler\'de tevkifat), yoksa false.',
      'JSON\'a "tevkifatKdv": <tevkifata düşen KDV tutarı (TL) sayı, yoksa 0> ekle — belgede "Hesaplanan KDV Tevkifat", "KDV TEVKİFAT(%..)=... TL" ya da "Tevkifata Tabi İşlem Üzerinden Hes. KDV"den ALIKONAN/tevkif edilen KDV kısmı. Örn "KDV TEVKİFAT(%20,00)=520,00 TL" → 520. Tevkifat yoksa 0.',
      'saticiAd/aliciAd: SATICI (faturayı kesen) ve ALICI (SAYIN/müşteri) ünvanları. saticiVkn/aliciVkn: bu tarafların VKN (10 hane) ya da TC (11 hane) — SADECE rakam. Yazarkasa fişinde satıcı = mağaza. toplam: genel/ödenecek toplam (KDV dahil). Bulamazsan null, UYDURMA.',
      'KURALLAR: Türk sayı biçimi "1.234,56" = 1234.56 (tümünü ondalıklı sayıya çevir). Birden çok KDV oranı varsa her oran ayrı nesne. matrah=KDV hariç tutar, kdv=o orana ait KDV. ÖTV/ÖİV/tevkifat varsa matrahı şişirme — gerçek mal/hizmet matrahını ver. Okunamayan alanı null bırak, UYDURMA.',
      'kategori: mükellefin İŞİNE + fatura içeriğine göre TEK kelime seç → "ticari_mal" (SADECE mükellefin alıp AYNEN SATARAK ticaretini yaptığı emtia/stok), "hammadde" (üretimde kullanılan ilk madde/malzeme), "demirbas" (makine/cihaz/ekipman/mobilya/bilgisayar gibi sabit kıymet alımı), "pazarlama" (reklam/ilan/kargo-nakliye/pazarlama), "genel_gider" (kira/elektrik/su/doğalgaz/telefon/internet/akaryakıt/danışmanlık/kırtasiye/yemek/abonelik VE mükellefin satmadığı tüketim/SARF malzemesi: ambalaj, tek-kullanımlık, temizlik, servis malzemesi). EMİN DEĞİLSEN "genel_gider". ⚠️ Mükellef MAL TİCARETİ yapmıyorsa (hizmet/eğitim/lokanta/ofis) aldığı malzeme "ticari_mal" DEĞİLDİR — bunları satmıyor, kendi işinde tüketiyor → "genel_gider" (üretim girdisiyse "hammadde").',
      'giderTuru: ALIŞ ise faturadaki ANA mal/hizmetin kısa adı — hesap planındaki gider hesabı adıyla eşleşecek tek-iki kelime: ör. yakıt/motorin/benzin → "akaryakıt"; ayrıca "kira", "elektrik", "su", "doğalgaz", "telefon", "internet", "kırtasiye", "danışmanlık", "nakliye", "yemek", "temizlik", "bakım onarım", "sigorta", "reklam" vb. Yazarkasa fişinde de ürüne bak (benzinlik → akaryakıt). ⚠️ ARAÇ/TAŞIT KİRALAMA bedeli → giderTuru "araç kiralama" yaz (SADECE "kira" YAZMA — "kira" yalnız işyeri/gayrimenkul kirasıdır, araç kirası ayrıdır). Net değilse "" (boş). SATIŞ ise "".',
      'muhasebeNeden: Bir mali müşavirin ağzından, AKICI ve DOĞAL Türkçe ile yazılmış 1-2 cümlelik DEĞERLENDİRME (kalıp/şablon DEĞİL — gerçekten yorumla). Faturada özetle NE alınmış/satılmış (içeriği özetle) ve mükellefin faaliyetine göre bu NİYE o nitelikte (ticari mal / hammadde-üretim girdisi / demirbaş-sabit kıymet / gider). İçerik faaliyetle uyumsuzsa nedenini söyle (ör. yemek üreticisinin aldığı klima → işte kullanılan sabit kıymet/demirbaş; araç kiralama → işyeri kirası değil). ⚠️ "alış"/"satış" kelimesini ve hesap NUMARASINI (153.01.001 gibi) YAZMA — yönü ve kesin hesabı SİSTEM ekleyecek; sen YALNIZ içeriği ve niteliği yorumla. Örnek: "Faturada ayçiçek yağı ve un alınmış; lokanta işletmesinin mutfağında kullandığı gıda malzemeleri olduğundan üretim girdisi (hammadde) niteliğindedir." Belge neyse onu açıkla, uydurma.',
      mukellefBilgi
        ? `BU FATURAYI ALAN MÜKELLEFİN İŞİ: ${mukellefBilgi}. kategoriyi mükellefin ANA FAALİYETİNE göre seç: üretim/imalat/LOKANTA/RESTORAN/KAFE/PASTANE/YEMEK işletmesi ana işinde KULLANDIĞI/işlediği/pişirdiği malı (gıda, yağ, un, et, sebze, süt, baharat, içecek, ambalaj…) alırsa "hammadde"; alım-satım (toptan/perakende/market) firması SATACAĞI ürünü alırsa "ticari_mal"; uzun ömürlü makine/cihaz/mobilya/bilgisayar/taşıt = "demirbas"; reklam/ilan/kargo/nakliye = "pazarlama"; SADECE işletmeyi yürüten sarf (kira, elektrik, su, doğalgaz, telefon, internet, akaryakıt, kırtasiye, temizlik, danışmanlık) = "genel_gider". ⚠️ KRİTİK-1: LOKANTA/RESTORAN/YEMEK üreticisinin aldığı GIDA / MUTFAK MALZEMESİ (yağ, un, et, sebze…) ASLA "genel_gider" ya da "demirbas" DEĞİLDİR — "hammadde"dir. ⚠️ KRİTİK-2: Mükellefin ANA FAALİYETİNDE SATMADIĞI bir CİHAZ/MAKİNE/EKİPMAN/MOBİLYA/KLİMA/BEYAZ EŞYA/BİLGİSAYAR/TELEVİZYON alımı = "demirbas" (sabit kıymet); ASLA "ticari_mal" DEĞİLDİR. "ticari_mal" YALNIZCA mükellefin o ürünü SATARAK ticaret yaptığı durumdur — ör. LOKANTA/YEMEK üreticisi KLİMA alırsa "demirbas"; klima TİCARETİ yapan firma klima alırsa "ticari_mal". ⚠️ KRİTİK-3: Mükellefin SATMADIĞI TÜKETİM/SARF malzemesi (ambalaj, poşet, streç, tek-kullanımlık bardak/tabak/çatal/kaşık, eldiven, temizlik, kırtasiye, servis malzemesi) hizmet/eğitim/ofis/lokanta gibi MAL TİCARETİ YAPMAYAN işletmede "genel_gider"dir (sarf malzeme); ASLA "ticari_mal" DEĞİLDİR (mükellef bunları satmıyor, kendi işinde tüketiyor). Bunları SATARAK ticaret yapan ambalaj/kırtasiye toptancısı alırsa "ticari_mal".`
        : '',
      planAdaylar ? `\nMÜKELLEFİN HESAP PLANI — matrah/gider için aday hesaplar (matrahHesapKodu'nu SADECE bu listeden seç):\n${planAdaylar}\n→ matrahHesapKodu: bu faturanın matrahını (mal/hizmet/gider tutarını) mükellefin İŞİNE ve fatura İÇERİĞİNE göre yukarıdaki listeden EN UYGUN TAM koda ata. Mükellefin SATARAK ticaret yaptığı emtia → stok (15x); kendi işinde KULLANDIĞI/tükettiği şey → ilgili gider (7xx/6xx; ör. mutfak malzemesi/çatal-kaşık→mutfak gideri, yakıt→akaryakıt gideri); uzun ömürlü makine/cihaz/mobilya/demirbaş → sabit kıymet (25x); SATIŞ faturasıysa gelir (600). ⚠️ İçeriğe gerçekten uyan hesap yoksa BOŞ bırak — listede OLMAYAN kodu ASLA yazma, uydurma.` : '',
      isImage ? '' : ('\nİÇERİK:\n' + html.replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 16000)),
    ].filter(Boolean).join('\n');

    // Süre: Max CLI ilk çağrıda soğuk başlar + uzun HTML metni yavaş işlenir; 22sn YETMİYORDU
    // (toplu okumada belgelerin ~yarısı "22000ms içinde yanıt vermedi"ye düşüyordu). Frontend
    // axios timeout'u yok (sınırsız bekler), Railway uzun isteği kesmez → bolca süre veriyoruz.
    // XML'den UBL parse edildiyse AI çağrısı YOK (birebir veri). Aksi halde Max-vision.
    // HIZ (kullanıcı tercihi): 1-2. deneme HIZLI model (Haiku) — ~2 kat hız, daha ucuz, rate-limit
    // riski az. Haiku okuyamazsa (boş/çözülemez) 3. deneme SONNET'e yükselt → zor belge doğru okunsun.
    // (Yanlış-okuma'yı sonra denge + KDV-matematik doğrulaması yakalar.)
    // AZURE-ÖNCELİKLİ OKUMA (kullanıcı tercihi): resim/JPG faturayı ÖNCE Azure okur — hız limiti YOK,
    //   güvenilir → "429 okunamadı" biter. SADECE gerçek Azure motoru ('azure-read') + yeterli güven kabul edilir;
    //   Azure yoksa/düşük güvende aşağıda KENDİ max-vision'ımıza (Max aboneliği) ZARİF düşer. Sınıflandırma yine Max'te (rawText'le).
    let azureText = ''; // Azure'un okuduğu HAM METİN (preParsed olmasa/güven düşük olsa bile) — Max'e
    //   GÖRÜNTÜ yerine METİN verip vision'ı atlamak için (HIZ: text okuma ~3x hızlı + alt-süreç hafif).
    if (!preParsed && isImage && imgBuf) {
      const az: any = await this.ocr.extractFromImage(imgBuf, String(d.belgeNo || 'fatura'), {}).catch(() => null);
      if (az && String(az.rawText || '').replace(/\s+/g, ' ').trim().length > 80) azureText = String(az.rawText);
      const azTotal = az ? this.numFromOcr(az.totalTutari) : 0;
      const azBd = az && Array.isArray(az.kdvBreakdown) ? az.kdvBreakdown : [];
      const azHasAmt = azTotal > 0 || azBd.some((b: any) => Number(b.tutar) > 0 || Number(b.matrah) > 0);
      // EŞİK — YALNIZ FATURA MERKEZİ'nin Azure-sonucu KABUL eşiği. Azure tutar+KDV'yi okuduysa
      //   (azHasAmt) güven 0.4'e kadar kabul edilir → daha çok belge hızlı Azure'da kalır, azı
      //   yavaş Max-vision'a eskale olur (okuma hızlanır). Yanlış okumayı sonraki denge/KDV-matematik
      //   doğrulaması yakalar. ⚠️ KULLANICI TALİMATI: ocr.service.extractFromImage / KDV Kontrol gibi
      //   DİĞER OCR yerlerindeki eşiklere DOKUNULMADI (extractFromImage'a eşik parametresi geçilmiyor).
      if (az && /azure/i.test(String(az.engine || '')) && (Number(az.confidence) || 0) >= 0.4 && azHasAmt) {
        preParsed = {
          belgeNo: az.belgeNo || null,
          tarih: az.date || null,
          saticiAd: az.satici || null,
          saticiVkn: az.saticiVkn || null,
          aliciAd: null,
          aliciVkn: null,
          toplam: azTotal || null,
          kategori: az.kategori || undefined,
          kdv: azBd.map((b: any) => {
            const rate = Number(b.oran) || 0;
            const amount = Number(b.tutar) || 0;
            const base = (b.matrah != null && Number(b.matrah) > 0) ? Number(b.matrah) : (rate > 0 ? Number((amount / (rate / 100)).toFixed(2)) : 0);
            return { oran: rate, matrah: base, kdv: amount };
          }),
          _azureText: String(az.rawText || ''),
          _azure: true,
        };
      }
    }
    let parsed: any = preParsed;
    let reason = 'okunamadı';
    // AZURE-TEXT HIZLANDIRMA: Azure görüntüyü zaten OKUDUYSA (azureText), Max'e GÖRÜNTÜ yerine METNİ ver
    //   → text okuma vision'dan çok HIZLI + alt-süreç hafif (OOM riski az). Görüntü-vision yalnız Azure
    //   metni yoksa. Yanlış okumayı denge/KDV-matematik doğrulaması yakalar. (Kullanıcı: "okuma yavaş".)
    const useAzureText = azureText.length > 80;
    const callPrompt = useAzureText ? (prompt + '\n\nBELGE METNİ (OCR ile okundu):\n' + azureText.slice(0, 20000)) : prompt;
    for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
      const model = attempt >= 3 ? undefined : MAX_MODEL_CHEAP; // 3. deneme: Sonnet (varsayılan)
      const res = await claudeTextViaMax(
        (isImage && !useAzureText)
          ? { prompt: callPrompt, images: [{ base64: imgBuf!.toString('base64'), mediaType: imgMedia }], timeoutMs: 90000, model }
          : { prompt: callPrompt, timeoutMs: 150000, model }, // büyük/çok-kalemli belge 60sn'de bitmiyordu → "Okunamadı". Kuyruk arka planda, uzun süre sorun değil.
      );
      if (!res.ok || !res.text) {
        reason = res.error || 'okunamadı';
        // 429/hız-limiti/aşırı-yük: tekrar denemeden önce GERİ ÇEKİL (rapid-retry 429'u kötüleştirmesin).
        if (attempt < 3) await new Promise((r) => setTimeout(r, /rate|429|limit|overload|too many|aşır/i.test(reason) ? 4000 : 700));
        continue;
      }
      try {
        const m = res.text.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
        if (!parsed) reason = 'AI yanıtı çözülemedi';
      } catch { parsed = null; reason = 'AI yanıtı çözülemedi'; }
    }
    if (!parsed) return { ok: false, reason };

    // UBL/XML yolu max-vision AI'ı ATLAR → sınıflandırma (giderTuru/kategori/İşletme kayıt türü) BURADA
    //   ayrı çalışır; e-Fatura/e-Arşiv de "mali müşavir gibi" içerik+faaliyetle sınıflansın.
    // UBL/XML yolu max-vision AI'ı ATLAR → sınıflandırma (giderTuru/kategori/İşletme kayıt türü) BURADA
    //   SENKRON çalışır: okuma = tam işlenmiş belge (yarım kalan yok, aynı satıcı hep aynı sonuç).
    if (parsed === preParsed && d.taxpayerId) {
      const contentText = (parsed._azureText || (imgBuf ? imgBuf.toString('utf8') : (html || ''))).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const c = await this.aiClassifyAccounting(contentText, mukellefBilgi, isIsletmeMukellef).catch(() => null);
      if (c) {
        if (!parsed.giderTuru && c.giderTuru) parsed.giderTuru = c.giderTuru;
        if (!parsed.kategori && c.kategori) parsed.kategori = c.kategori;
        if (!parsed.muhasebeNeden && (c as any).muhasebeNeden) parsed.muhasebeNeden = (c as any).muhasebeNeden;
        if (c.isletmeKayitTuru) { parsed.isletmeKayitTuru = c.isletmeKayitTuru; parsed.isletmeAltTuru = c.isletmeAltTuru; parsed.isletmeNeden = c.isletmeNeden; }
      }
    }

    let breakdown = (Array.isArray(parsed.kdv) ? parsed.kdv : [])
      .map((x: any) => ({ rate: Number(x?.oran) || 0, base: Number(x?.matrah) || 0, amount: Number(x?.kdv) || 0 }))
      .filter((x: any) => x.base > 0 || x.amount > 0);
    // KURTARMA: kırılım boş ama TOPLAM + tek ORAN okunduysa → toplam'dan matrah/KDV ayır.
    if (!breakdown.length) {
      const toplam = Number(parsed.toplam) || 0;
      const oran = Number((Array.isArray(parsed.kdv) ? parsed.kdv : []).find((x: any) => Number(x?.oran) > 0)?.oran) || 0;
      if (toplam > 0 && oran > 0) {
        const base = Math.round((toplam / (1 + oran / 100)) * 100) / 100;
        breakdown = [{ rate: oran, base, amount: Math.round((toplam - base) * 100) / 100 }];
      }
    }
    if (!breakdown.length) return { ok: false, reason: 'KDV kırılımı okunamadı' };

    const matrah = Math.round(breakdown.reduce((s: number, b: any) => s + b.base, 0) * 100) / 100;
    const kdv = Math.round(breakdown.reduce((s: number, b: any) => s + b.amount, 0) * 100) / 100;
    const aiSaticiVkn = String(parsed.saticiVkn || '').replace(/\D/g, '');
    const aiAliciVkn = String(parsed.aliciVkn || '').replace(/\D/g, '');
    const vknOk = (v: string) => v.length === 10 || v.length === 11;
    // YÖN GÖRÜNTÜDEN: mükellef VKN'si satıcıyla eşleşirse SATIŞ, alıcıyla eşleşirse ALIŞ.
    // Mihsap'ın sekme/etiket bilgisine güvenmeyiz — fatura kimin adına kesilmiş, ona bakarız.
    let kind: 'ALIS' | 'SATIS' = (String(d.invoiceKind || 'ALIS') === 'SATIS' ? 'SATIS' : 'ALIS');
    if (ownVkn && vknOk(aiSaticiVkn) && ownVkn === aiSaticiVkn) kind = 'SATIS';
    else if (ownVkn && vknOk(aiAliciVkn) && ownVkn === aiAliciVkn) kind = 'ALIS';
    const isSale = kind === 'SATIS';
    // TEVKİFAT: okunan tevkifat KDV tutarından oran çıkar (520/2600=0.2). linesFromAmounts'un
    // tevkifat yolu NET KDV + ÖDENECEK cariyi doğru üretir (tam KDV/tam toplam değil).
    const tevkKdv = Number(parsed.tevkifatKdv) || 0;
    const tevkifatOrani = (tevkKdv > 0 && kdv > 0 && tevkKdv < kdv) ? Math.round((tevkKdv / kdv) * 1000) / 1000 : 0;
    // Toplam = matrah + KDV (yevmiye DENGESİ: cari satırı = matrah + kdv toplamı). AI'nın okuduğu
    //   parsed.toplam KDV HARİÇ tutarı verebiliyordu → cari/totalAmount yanlış → BALANCE_MISMATCH /
    //   TOTAL_MISMATCH (EDELER'de 31 belge "çelişki"; örn total=matrah=641.82 ama gerçek 648.33).
    //   ARTIK satırlardan türetilir → yevmiye her zaman dengeli. Matrah/KDV okuma hatasını
    //   (kdv > matrah×oran) zaten KDV_MATH doğrulaması yakalar → sessiz yanlış kalmaz.
    //   Tevkifatlıda ödenecek = matrah + NET KDV (tevkifat sorumlu sıfatıyla beyan, cariye girmez).
    const total = tevkifatOrani > 0
      ? Math.round((matrah + kdv * (1 - tevkifatOrani)) * 100) / 100
      : Math.round((matrah + kdv) * 100) / 100;
    // Karşı taraf (cari) adı: satışta ALICI, alışta SATICI.
    const counterName = String((isSale ? parsed.aliciAd : parsed.saticiAd) || '').trim();
    // Belge türü: önce GERÇEK METİNDEN (e-Arşiv/e-Fatura ibaresi), yoksa AI'nın dediği.
    const mappedType = this.docTypeFromText(html) || this.mapOcrBelgeTipi(parsed.belgeTuru);

    const lines = await this.gateCodesByPlan(tenantId, d.taxpayerId, this.linesFromAmounts({
      invoiceKind: kind,
      matrah, kdvTutari: kdv, kdvOrani: breakdown[0].rate, total,
      vendorName: counterName || (isSale ? d.customerName : d.vendorName),
      kdvBreakdown: breakdown,
      tevkifatOrani: tevkifatOrani || null,
    }));
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.invoiceAccountingLine.deleteMany({ where: { documentId: d.id } });
      if (lines.length) await tx.invoiceAccountingLine.createMany({ data: lines.map((l: any) => ({ ...l, documentId: d.id })) });
      // İŞLETME: AI'ın faaliyet+içerik muhakemesiyle verdiği kayıt türü + alt türü. Net değilse undefined → Eşleşmedi.
      // Kayıt türü netse, GİB Defter-Beyan kurallarına göre Alış/Satış Türü + İşlem Türü + Belge Türü'nü de
      // belgenin sinyallerinden (iade/tevkifat/KDV/ikinci-el/belge tipi) TÜRET. (Araştırma: [[project-isletme-dbs-arastirma]])
      let islSinifAi = isIsletmeMukellef ? resolveIslAi(kind, parsed) : undefined;
      if (islSinifAi) {
        const islIade = parsed.iade === true || /iade|iptal/i.test(String(parsed.belgeTuru || ''));
        const islTevk = parsed.tevkifat === true || tevkifatOrani > 0 || /tevkifat/i.test(String(html || ''));
        const islText = [parsed.giderTuru, islSinifAi.kayitAltAd, parsed.muhasebeNeden, ...(Array.isArray(parsed.kalemler) ? parsed.kalemler.map((k: any) => k?.ad) : [])].filter(Boolean).join(' ');
        islSinifAi = {
          ...islSinifAi,
          alisSatisKod: isletmeAlisSatisTuru(kind, { isReturn: islIade, tevkifat: islTevk, kdvVar: kdv > 0, text: islText }),
          islemTuruKod: isletmeIslemTuru(kind, islText),
          belgeTuruKod: defaultBelgeTuruKod(mappedType || parsed.belgeTuru, kind),
        };
      }
      await tx.invoiceAccountingDocument.update({
        where: { id: d.id },
        data: {
          invoiceKind: kind,
          totalAmount: money(total),
          ...(mappedType ? { documentType: mappedType } : {}),
          belgeNo: (parsed.belgeNo ? String(parsed.belgeNo) : null) || d.belgeNo || null,
          ...(parseDate(parsed.tarih) ? { faturaTarihi: parseDate(parsed.tarih) } : {}),
          // GERÇEK iki tarafın VKN'si → sahiplik/yön kontrolü çalışır.
          ...(vknOk(aiSaticiVkn) ? { sellerVkn: aiSaticiVkn } : {}),
          ...(vknOk(aiAliciVkn) ? { buyerVkn: aiAliciVkn } : {}),
          // Karşı taraf adını DOĞRU tarafa yaz (cari eşleştirmesi buna dayanır).
          ...(counterName ? (isSale ? { customerName: counterName } : { vendorName: counterName }) : {}),
          status: 'NEEDS_REVIEW',
          ocrEngine: 'max-vision',
          ocrData: { ...((d.ocrData as any) || {}), matrah, kdvTutari: kdv, kdvOrani: breakdown[0].rate, kdvBreakdown: breakdown.map((b: any) => ({ oran: b.rate, matrah: b.base, tutar: b.amount })), matrahKategori: typeof parsed.kategori === 'string' ? parsed.kategori : undefined, giderTuru: typeof parsed.giderTuru === 'string' ? parsed.giderTuru.slice(0, 40) : undefined, muhasebeNeden: typeof parsed.muhasebeNeden === 'string' ? parsed.muhasebeNeden.slice(0, 300) : undefined, aiYorum: typeof parsed.muhasebeNeden === 'string' ? parsed.muhasebeNeden.slice(0, 400) : undefined, aiMatrahKodu: (typeof parsed.matrahHesapKodu === 'string' && planLeafSet.has(String(parsed.matrahHesapKodu).trim())) ? String(parsed.matrahHesapKodu).trim() : undefined, kalemler: Array.isArray(parsed.kalemler) ? parsed.kalemler.slice(0, 30).map((k: any) => ({ ad: String(k?.ad || '').slice(0, 80), tutar: Number(k?.tutar) || 0, oran: Number(k?.oran) || 0 })).filter((k: any) => k.ad) : undefined, ...(islSinifAi ? { isletme: islSinifAi } : {}), isReturn: parsed.iade === true || /iade|iptal/i.test(String(parsed.belgeTuru || '')), tevkifatHint: parsed.tevkifat === true || tevkifatOrani > 0 || /tevkifat/i.test(String(html || '')), tevkifatOrani: tevkifatOrani || 0, tevkifatKdv: tevkKdv || 0, engine: parsed._azure ? 'azure-read' : (parsed === preParsed ? 'ubl-xml' : 'max-vision'),
            readMode: parsed === preParsed ? 'ubl-xml' : (isImage ? 'image' : /pdf/i.test(imgMedia) ? 'pdf-text' : /xml/i.test(imgMedia) ? 'xml-text' : 'html'),
            ...(!preParsed && imgBuf && /xml/i.test(imgMedia) ? { xmlHead: imgBuf.toString('utf8').slice(0, 220).replace(/\s+/g, ' ') } : {}) },
        },
      });
    });
    // Yeni yazılan satıcı/alıcı VKN'leriyle sahiplik/yön kontrolünü yeniden hesapla —
    // yanlış yönlü/mükellefe ait olmayan belge "İçerik çelişkisi" olarak işaretlenir.
    await this.revalidateDocument(tenantId, d.id).catch(() => {});
    // Placeholder kodları (770.01.010 vb. — mükellefin planında olmayabilir) mükellefin
    // GERÇEK hesap planındaki kodla değiştir; öğrenilmiş satıcı kodu varsa onu uygula.
    // (Sadece applyLearnedVendorCodes yetmiyordu → öğrenilmemiş satıcıda placeholder kalıyordu.)
    if (d.taxpayerId) await this.rematchDocumentsWithLatestAccountPlan(tenantId, d.taxpayerId, [d.id]).catch(() => {});
    return { ok: true, matrah, kdv, oranSayisi: breakdown.length };
  }

  // UBL/XML (max-vision AI'ı ATLAYAN) belgeler için MUHASEBE SINIFLANDIRMASI — bir mali müşavir gibi
  // içeriğe + mükellefin faaliyetine bakıp giderTuru/kategori (+ İşletme ise kayıt türü/alt türü) belirler.
  // e-Fatura/e-Arşiv XML'leri AI okumadan geçtiği için sınıf BURADA ayrı çağrıyla üretilir. Max aboneliği.
  private async aiClassifyAccounting(
    contentText: string,
    mukellefBilgi: string,
    isIsletme: boolean,
  ): Promise<{ giderTuru: string; kategori: string; isletmeKayitTuru: string; isletmeAltTuru: string; isletmeNeden: string; muhasebeNeden: string } | null> {
    if (!contentText || contentText.length < 20) return null;
    const prompt = [
      'Aşağıda bir Türk e-Fatura/e-Arşiv belgesinin metin içeriği var. İçindeki MAL/HİZMET kalemlerini bir MALİ MÜŞAVİR gibi değerlendir.',
      mukellefBilgi ? `Faturanın tarafı olan mükellef: ${mukellefBilgi}.` : '',
      'YALNIZCA şu JSON: {"giderTuru":"","kategori":"","isletmeKayitTuru":"","isletmeAltTuru":"","isletmeNeden":"","muhasebeNeden":""}',
      'giderTuru: ALIŞ ise faturadaki ANA mal/hizmetin kısa adı (yakıt/motorin→"akaryakıt"; ayrıca "elektrik","su","doğalgaz","telefon","internet","kira","kırtasiye","danışmanlık","nakliye","yedek parça","bakım onarım","yemek","temizlik","sigorta","reklam" vb). Net değilse "". SATIŞ ise "".',
      'kategori: mükellefin ANA FAALİYETİNE göre → "ticari_mal" (SADECE mükellefin SATARAK ticaretini yaptığı emtia), "hammadde" (üretim girdisi), "demirbas" (makine/cihaz/sabit kıymet), "pazarlama" (reklam/kargo/nakliye), "genel_gider" (kira/elektrik/sarf/abonelik + satılmayan tüketim/sarf malzemesi). Emin değilsen "genel_gider". ⚠️ Mükellefin SATMADIĞI cihaz/klima/makine/ekipman/mobilya/bilgisayar = "demirbas", ASLA "ticari_mal" değil (lokanta klima alırsa demirbas). ⚠️ Mükellef MAL TİCARETİ yapmıyorsa (hizmet/eğitim/lokanta/ofis) aldığı tüketim/sarf malzemesi (ambalaj, tek-kullanımlık, temizlik, kırtasiye, servis) = "genel_gider", ASLA "ticari_mal" değil. Araç/taşıt kiralama = "genel_gider" ama giderTuru "araç kiralama" (kira değil).',
      'muhasebeNeden: Bir mali müşavir ağzından AKICI, DOĞAL Türkçe 1-2 cümlelik değerlendirme (kalıp DEĞİL — gerçekten yorumla). Faturada özetle NE alınmış/satılmış ve mükellefin faaliyetine göre bu NİYE o nitelikte (ticari mal / hammadde / demirbaş / gider). İçerik faaliyetle uyumsuzsa nedenini söyle. ⚠️ "alış"/"satış" kelimesini ve hesap NUMARASINI YAZMA — yönü ve kesin hesabı sistem ekler; sen YALNIZ içeriği ve niteliği yorumla. Örnek: "Faturada ofis için yazıcı ve toner alınmış; işte kullanılan sabit kıymet/demirbaş niteliğindedir."',
      isIsletme ? islPromptSeg() : 'isletmeKayitTuru ve isletmeAltTuru = "" bırak (mükellef İşletme defteri değil).',
      '\nİÇERİK:\n' + contentText.slice(0, 12000),
    ].filter(Boolean).join('\n');
    // 429/hız-limitinde sınıflandırma sessizce düşmesin (matrah buna bağlı) → 1 kez GERİ-ÇEKİLMELİ tekrar dene.
    let res: any = null;
    for (let att = 1; att <= 2 && (!res || !res.ok || !res.text); att++) {
      res = await claudeTextViaMax({ prompt, timeoutMs: 32000, model: MAX_MODEL_CHEAP }).catch(() => null);
      if ((!res || !res.ok || !res.text) && att < 2) await new Promise((r) => setTimeout(r, /rate|429|limit|overload|too many/i.test(String(res?.error || '')) ? 3500 : 600));
    }
    if (!res || !res.ok || !res.text) return null;
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : null;
      if (!j) return null;
      return {
        giderTuru: String(j.giderTuru || '').slice(0, 40),
        kategori: String(j.kategori || ''),
        isletmeKayitTuru: String(j.isletmeKayitTuru || ''),
        isletmeAltTuru: String(j.isletmeAltTuru || ''),
        isletmeNeden: String(j.isletmeNeden || ''),
        muhasebeNeden: String(j.muhasebeNeden || '').slice(0, 300),
      };
    } catch { return null; }
  }

  // AI ile GİDER hesabı seçimi (kural/ad eşleşmesi bulamadığında ESKALASYON). Mükellefin FAALİYETİ +
  // faturanın İÇERİĞİ (giderTuru) ile, mükellefin GERÇEK hesap planından en uygun gider/stok/sabit hesabı
  // seçtirir. Dönen kod planda GERÇEKTEN yoksa null (uydurma kod kabul edilmez). Max aboneliği (token API yok).
  // AI GEREKÇE (deterministik): "sistem bu hesabı NEYE GÖRE seçti" — mükellef faaliyeti + YÖN +
  //   içerik/kategori + SEÇİLEN hesap. Okuma-anı AI yorumu yanlış olabiliyordu (alışa "satış" diyor,
  //   firma faaliyetini kopyalıyordu); bu deterministik üretim yön-KESİN + hesap-KESİN, rematch'te yazılır.
  private buildMuhasebeNeden(faaliyet: string, isSale: boolean, kat: string, giderTuru: string, matrahAcc: any, isReturn: boolean): string {
    const parts = String(faaliyet || '').split('—');
    let faal = (parts.length > 1 ? parts[1] : parts[0]).replace(/\s+/g, ' ').trim();
    // Kelime ORTASINDAN kesme ("...FAALİYETL") yerine: 60'ı aşıyorsa son boşluğa kadar al (tam kelime).
    if (faal.length > 60) { const cut = faal.slice(0, 60); const sp = cut.lastIndexOf(' '); faal = (sp > 0 ? cut.slice(0, sp) : cut).trim(); }
    const fpre = faal ? `${faal} faaliyeti. ` : '';
    // Niteliği KATEGORİDEN ("hammadde") türetmek seçilen HESAPLA çelişiyordu: "üretim girdisi (hammadde)
    //   niteliğinde olduğundan 153 TİCARİ MALLAR'a işlenir" = mantıksız. Niteliği cümleden çıkardık;
    //   seçilen hesabın ADI (kodAd → "TİCARİ MALLAR") zaten niteliği gösterir.
    void kat;
    const kod = matrahAcc ? String(matrahAcc.accountCode || '').trim() : '';
    const ad = matrahAcc ? String(matrahAcc.accountName || '').trim() : '';
    const kodAd = kod ? `${kod}${ad ? ' ' + ad : ''}` : '';
    const ic = giderTuru || 'mal/malzeme';
    // ⚠️ YÖN MÜKELLEF GÖZÜNDEN: ALIŞ'ta "MÜKELLEF ... ALDI" (satıcının ne SATTIĞI değil). AI okuma-anı
    //   yorumu satıcı gözünden "satış" diyordu (lokananın havuç ALIŞINA "havuç satışı"; marketten alışa
    //   "perakende satılmış") — burada yön rematch'te KESİN, mükellefin faaliyetine bağlanır.
    if (isReturn) return `${fpre}${isSale ? 'Alıştan' : 'Satıştan'} iade (ters kayıt); yön ve tutarlar kontrol edilmeli${kodAd ? ` → ${kodAd}` : ''}.`;
    if (isSale) return `${fpre}Mükellefin sattığı ${ic}; olağan satış geliri${kodAd ? ` → ${kodAd}` : ' (600 hesabı)'}.`;
    if (!kodAd) return `${fpre}Mükellef ${ic} almış; faaliyetine uygun hesap bulunamadı, manuel seçim gerekir.`;
    return `${fpre}Mükellef ${ic} almış; ${kodAd} hesabına işlenir.`;
  }

  // YAPAY ZEKA YORUMU + SİSTEM ÇERÇEVESİ: yapay zeka faturayı OKURKEN içeriği/niteliği DOĞAL dille
  //   yorumlar (aiYorum). Burada o yorumun BAŞINA yön (alış/satış — sistemde kesin), SONUNA seçilen
  //   GERÇEK hesap kodu+adı (mükellefin planından) eklenir → "yapay zeka neye göre karar verdiyse onu
  //   yazsın" + "kesin numarayı sistem koysun". Yapay zeka karar DEĞİŞTİRMEZ. aiYorum yoksa (eski belge
  //   ya da okunamayan) deterministik buildMuhasebeNeden'e düşülür (güvenlik ağı, ekstra AI çağrısı YOK).
  private composeMuhasebeNeden(faaliyet: string, isSale: boolean, isReturn: boolean, aiYorum: string, matrahAcc: any, kat: string, giderTuru: string): string {
    // AI okuma-anı yorumu (aiYorum) GÜVENİLMEZ çıktı: YÖN'ü ve mükellef-faaliyetini karıştırıyordu —
    //   satıcı/market gözünden "satış" diyordu (lokananın havuç ALIŞINA "havuç satışı, yurt içi satış";
    //   marketten alışa "perakende satılmış, satış geliri"). Okuma anında yön henüz kesin değil. Yorum
    //   artık DETERMINISTIK: yön (rematch'te KESİN, MÜKELLEF gözünden) + faaliyet + içerik + seçilen hesap.
    void aiYorum; // okuma-anı yorumu bilerek kullanılmıyor (yanlış yön/satıcı-bakışı kaynağıydı)
    return this.buildMuhasebeNeden(faaliyet, isSale, kat, giderTuru, matrahAcc, isReturn);
  }

  // ZENGİN AI MUHASEBE YORUMU (eşleştirme SONRASI, tek belge, lazy/on-demand). Deterministik
  //   buildMuhasebeNeden kullanıcıya "yavan" geliyordu; istenen = mali müşavir ağzından 2 bölümlü
  //   GERÇEK değerlendirme (Faaliyet + Yorum). Okuma-anı AI yorumu YÖN'ü karıştırıyordu ("alışa satış");
  //   burada yön (invoiceKind) + seçilen GERÇEK hesap KESİN belli → AI'a VERİLİR, AI yalnız İÇERİĞİ
  //   yapılandırılmış cümleyle açıklar (karar/yön DEĞİŞTİREMEZ). Sonuç ocrData.muhasebeNedenZengin'e
  //   cache'lenir (tekrar açılışta AI çağrısı YOK); "Kodları düzelt"/rematch hesabı değiştirirse cache
  //   temizlenir → bir sonraki açılışta tazelenir. Max yolu (MAX_MODEL_CHEAP), token-başı API yok.
  async generateRichMuhasebeNeden(
    tenantId: string,
    docId: string,
    force = false,
  ): Promise<{ ok: boolean; neden: string; zengin: boolean }> {
    const doc: any = await (this.prisma as any).invoiceAccountingDocument
      .findFirst({ where: { id: docId, tenantId }, include: { lines: { orderBy: { orderNo: 'asc' } } } })
      .catch(() => null);
    if (!doc) return { ok: false, neden: '', zengin: false };
    const ocr = (doc.ocrData as any) || {};
    // Cache: zaten üretilmiş zengin yorum varsa (ve zorlanmadıysa) onu döndür — AI çağrısı yok.
    const cached = String(ocr.muhasebeNedenZengin || '').trim();
    if (!force && cached) return { ok: true, neden: cached, zengin: true };

    // KESİN yön (rematch ile aynı türetim) + iade.
    const isSale = String(doc.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
    const isReturn = ocr.isReturn === true;
    // Seçilen GERÇEK matrah/gider hesabı (kullanıcının/eşleştirmenin koyduğu) — yoksa zengin yorumun
    //   "şu hesaba işlendi" kısmı kurulamaz → deterministik özete düş (AI çağrısı boşa gitmesin).
    const matrahLines = (doc.lines || []).filter(
      (l: any) => String(l.group || '') === 'matrah' && String(l.accountCode || '').trim(),
    );
    const hesapStr = matrahLines
      .map((l: any) => `${String(l.accountCode).trim()}${l.description ? ' ' + String(l.description).trim() : ''}`)
      .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
      .join(', ');

    // Mükellef faaliyeti (rematch'teki ile aynı kaynak).
    const tpRow: any = await (this.prisma as any).taxpayer
      .findFirst({ where: { id: doc.taxpayerId, tenantId }, select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true } })
      .catch(() => null);
    const tpFaaliyet = tpRow
      ? [String(tpRow.companyName || (String(tpRow.firstName || '') + ' ' + String(tpRow.lastName || ''))).trim(), String(tpRow.faaliyetAciklama || '').trim() || (tpRow.naceKodu ? 'NACE ' + tpRow.naceKodu : '')].filter(Boolean).join(' — ')
      : '';

    // Fatura kalemleri (#20 Faz A — ocrData.kalemler). Eski belgelerde yoksa giderTuru/kategori ile yorumlanır.
    const kalemler: any[] = Array.isArray(ocr.kalemler) ? ocr.kalemler : [];
    const kalemStr = kalemler
      .slice(0, 30)
      .map((k: any) => {
        const ad = String(k.ad || '').trim();
        if (!ad) return '';
        const t = Number(k.tutar) || 0;
        const o = k.oran != null && k.oran !== '' ? `%${k.oran}` : '';
        const ek = t ? ` (${t.toLocaleString('tr-TR')} TL${o ? ', ' + o : ''})` : o ? ` (${o})` : '';
        return ad + ek;
      })
      .filter(Boolean)
      .join('; ');
    const giderTuru = String(ocr.giderTuru || '').trim();
    const kat = String(ocr.matrahKategori || ocr.kategori || '').trim();

    // Hesap atanmamışsa zengin yorum anlamsız → deterministik özet (AI çağırma).
    const matrahAccForNeden = matrahLines.length ? { accountCode: String(matrahLines[0].accountCode).trim(), accountName: String(matrahLines[0].description || '').trim() } : null;
    if (!hesapStr || !matrahAccForNeden) {
      const det = this.buildMuhasebeNeden(tpFaaliyet, isSale, kat, giderTuru, matrahAccForNeden, isReturn);
      return { ok: true, neden: det, zengin: false };
    }

    const yonText = isReturn
      ? isSale
        ? 'mükellefin DÜZENLEDİĞİ bir ALIŞTAN İADE (ters kayıt) faturasıdır — daha önce alınan mal geri verilmiştir'
        : 'mükellefe DÜZENLENEN bir SATIŞTAN İADE faturasıdır — daha önce satılan mal geri gelmiştir'
      : isSale
        ? 'mükellef için bir SATIŞ (gelir) faturasıdır — bu mal/hizmeti mükellef SATMIŞTIR'
        : 'mükellef için bir ALIŞ (gider/gelen) faturasıdır — bu mal/hizmeti mükellef ALMIŞTIR';

    const prompt = [
      'Sen deneyimli bir Türk mali müşavirisin. Aşağıdaki fatura için KISA, AKICI ve DOĞAL Türkçe ile bir muhasebe değerlendirmesi yaz.',
      '⚠️ YÖN ve HESAP KESİN olarak verildi — bunları SORGULAMA, DEĞİŞTİRME, yönü TERS çevirme. Sen YALNIZ faturanın İÇERİĞİNİ yorumla; kararı sistem verdi.',
      `Mükellefin işi: ${tpFaaliyet || 'belirtilmemiş'}.`,
      `Bu fatura ${yonText}.`,
      kalemStr ? `Faturadaki kalemler: ${kalemStr}.` : `Faturanın içeriği: ${giderTuru || kat || 'belirsiz'}.`,
      `Sistemin işlediği muhasebe hesabı: ${hesapStr}.`,
      '',
      'ÇIKTI — TAM OLARAK aşağıdaki iki satır; başka HİÇBİR şey yazma (kod bloğu, yıldız, madde işareti, ek başlık YOK):',
      'Faaliyet: <mükellefin ne iş yaptığını tek cümleyle açıkla>',
      'Yorum: <Faturada özetle nelerin alındığını/satıldığını içerikten özetle; mükellefin faaliyetine göre bunların NİYE ticari mal / üretim girdisi(hammadde) / demirbaş / gider niteliğinde olduğunu açıkla; içerik faaliyetle uyumsuzsa (ör. lokantanın aldığı klima → demirbaş) nedenini belirt; cümleyi "... bu nedenle ' + hesapStr + ' hesabına işlenmiştir." ile bitir>',
      '',
      'KURALLAR: Yönü MÜKELLEF gözünden anlat (ALIŞ ise "mükellef almış"; satıcının ne sattığı önemli değil). Hesap kodunu (' + hesapStr + ') Yorum cümlesinde AYNEN kullan. Faturada olmayan şey UYDURMA. Toplam ~60 kelimeyi geçme.',
    ].join('\n');

    const res = await claudeTextViaMax({ prompt, timeoutMs: 30000, model: MAX_MODEL_CHEAP }).catch(() => null);
    let text = res && res.ok && res.text ? String(res.text) : '';
    // Temizle: kod bloğu çitleri, baştaki etiket/numara süprüntüsü; "Faaliyet:"/"Yorum:" satırlarını koru.
    text = text.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
    if (text) {
      const fa = text.match(/Faaliyet\s*:?[ \t]*(.+?)(?:\n+|$)/i);
      const yo = text.match(/Yorum\s*:?[ \t]*([\s\S]+)$/i);
      if (fa && yo) {
        text = `Faaliyet: ${fa[1].trim()}\nYorum: ${yo[1].replace(/\s+/g, ' ').trim()}`;
      }
      text = text.slice(0, 900).trim();
    }
    if (!text) {
      // AI boş/başarısız → deterministik özet (cache'leme, sonra tekrar denenebilsin).
      const det = this.buildMuhasebeNeden(tpFaaliyet, isSale, kat, giderTuru, matrahAccForNeden, isReturn);
      return { ok: true, neden: det, zengin: false };
    }
    // Cache (üstüne yaz). Deterministik muhasebeNeden'e DOKUNMA (anlık fallback olarak kalsın).
    await (this.prisma as any).invoiceAccountingDocument
      .update({ where: { id: doc.id }, data: { ocrData: { ...ocr, muhasebeNedenZengin: text } } })
      .catch(() => {});
    return { ok: true, neden: text, zengin: true };
  }

  private async aiPickGiderAccount(
    accounts: Array<{ accountCode: string; accountName: string }>,
    faaliyet: string,
    giderTuru: string,
    vendorName: string,
  ): Promise<{ accountCode: string; accountName: string } | null> {
    // Aday hesaplar: stok (15x), sabit kıymet (25x), gider (6xx/7xx) leaf'leri.
    const cand = accounts.filter((a) => /^(15\d|25\d|6\d\d|7\d\d)/.test(String(a.accountCode || '')));
    if (!cand.length) return null;
    const codes = cand.map((a) => String(a.accountCode));
    const leaves = cand.filter((a) => { const c = String(a.accountCode); return !codes.some((o) => o !== c && o.startsWith(c + '.')); });
    const pool = (leaves.length ? leaves : cand).slice(0, 250);
    const liste = pool.map((a) => `${a.accountCode} = ${a.accountName}`).join('\n');
    const prompt = [
      `Mükellefin işi: ${faaliyet || 'bilinmiyor'}.`,
      `Bu bir ALIŞ (gider) faturası. İçindeki ana mal/hizmet: "${giderTuru}"${vendorName ? `, satıcı: "${vendorName}"` : ''}.`,
      'Aşağıdaki mükellefin GERÇEK hesap planından, bu gideri MÜKELLEFİN İŞİNE göre yazacağın EN UYGUN TEK hesabı seç.',
      'KURAL: Alınan şey mükellefin SATTIĞI emtia ise stok (15x). Kendi işinde KULLANDIĞI gider ise ilgili gider hesabı (7xx/6xx). Uzun ömürlü makine/cihaz/taşıt/demirbaş ise sabit kıymet (25x).',
      'ÖRNEK: NAKLİYECİ kendi aracına yedek parça/lastik/tamir alır → taşıt giderleri / bakım-onarım gider hesabı (STOK DEĞİL). Oto yedek parça TİCARETİ yapan satmak için alır → ticari mal stok (153).',
      'ÖRNEK 2: ARAÇ/TAŞIT KİRALAMA bedeli → "KİRA GİDERİ" (işyeri/gayrimenkul kirası) hesabına ASLA yazma — araç kirası işyeri kirası DEĞİLDİR. Plandaki uygun bir araç/taşıt kira hesabı yoksa kod null.',
      'GENEL KURAL: seçtiğin hesabın ADI faturanın İÇERİĞİYLE SEMANTİK uyuşmalı. Yüzeysel kelime benzerliği (kiralama≈kira) ya da "planda tek/uygun-gibi hesap kalmış" YETMEZ. İçeriğe gerçekten uyan hesap yoksa kod null = BOŞ (kullanıcı 1 kez seçer, öğrenilir).',
      'YALNIZCA şu JSON: {"kod":"<plandaki TAM hesap kodu, emin değilsen null>","neden":"<kısa>"}. Listede OLMAYAN kodu ASLA yazma.',
      'HESAP PLANI:',
      liste,
    ].join('\n');
    const res = await claudeTextViaMax({ prompt, timeoutMs: 30000, model: MAX_MODEL_CHEAP }).catch(() => null);
    if (!res || !res.ok || !res.text) return null;
    let kod = '';
    try { const m = res.text.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : null; kod = String(j?.kod || '').trim(); } catch { return null; }
    if (!kod || /^null$/i.test(kod)) return null;
    const hit = accounts.find((a) => String(a.accountCode) === kod); // hallüsinasyon koruması: plan'da var mı?
    return hit ? { accountCode: hit.accountCode, accountName: hit.accountName } : null;
  }

  private async rematchPendingDocumentsWithAccountPlan(
    tenantId: string,
    taxpayerId: string,
    snapshotId: string,
    documentIds?: string[],
  ) {
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
          ...(documentIds?.length ? { id: { in: documentIds } } : {}),
          status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] },
        },
        include: { lines: { orderBy: { orderNo: 'asc' } } },
        take: 500,
      }),
    ]);
    if (!accounts.length || !docs.length) return;

    // Mükellefin faaliyeti — AI gider-hesabı eşleştirmesinde "ne iş yapıyor" bağlamı.
    const tpRow: any = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true } }).catch(() => null);
    const tpFaaliyet = tpRow ? [String(tpRow.companyName || (String(tpRow.firstName || '') + ' ' + String(tpRow.lastName || ''))).trim(), String(tpRow.faaliyetAciklama || '').trim() || (tpRow.naceKodu ? ('NACE ' + tpRow.naceKodu) : '')].filter(Boolean).join(' — ') : '';
    let aiAccCalls = 0; // batch'te AI eskalasyonunu sınırla
    const AI_GIDER_LIMIT = 40; // "Kodları düzelt" batch'inde AI semantik eşleştirme tavanı (Max yükü)
    const aiGiderCache = new Map<string, any>(); // norm(giderTuru) → hesap|null; aynı gider 1 kez sorulur
    // SADECE GERÇEK ALT HESAP: bir kod ATANABİLİR ancak plan'da varsa + 1-2 haneli sınıf/grup DEĞİLSE
    //   (ana segmenti >=3 hane) + noktalı alt-hesabı YOKSA. "1 DÖNEN VARLIKLAR"/"320" gibi gruplar ASLA atanmaz.
    const _codeSet = new Set(accounts.map((a: any) => String(a.accountCode || '')));
    const _groupCodes = new Set<string>();
    for (const a of accounts) { const c = String(a.accountCode || ''); let ix = c.indexOf('.'); while (ix !== -1) { _groupCodes.add(c.slice(0, ix)); ix = c.indexOf('.', ix + 1); } }
    const isPostableLeaf = (code: string) => {
      const c = String(code || '');
      if (!c || !_codeSet.has(c) || _groupCodes.has(c)) return false;
      // NOKTASIZ ana hesap (ör "150 İLK MADDE VE MALZEME", "320 SATICILAR") fiş hesabı DEĞİL —
      //   yevmiye satırı her zaman noktalı ALT-hesaba kesilir. Aksi halde ticari_mal→"150" (alt-hesabı
      //   olmayan ana hesap) atanıyordu (kullanıcı: "ana hesaba eşleme saçma, alt hesapta yok").
      //   Bu, kategori prefix'inde noktalı alt-hesabı olan grubu (153.01.001) bulana kadar ilerletir.
      if (!c.includes('.')) return false;
      return (c.split('.')[0].replace(/\D/g, '').length >= 3);
    };
    const leafOnly = (acc: any) => (acc && isPostableLeaf(String(acc.accountCode || '')) ? acc : null);

    for (const doc of docs) {
      const isSale = doc.invoiceKind === 'SATIS';
      // İADE/İPTAL faturası (CreditNote / "İADE"): normal 600/770/191'e ATANMAZ (ciro/KDV şişer).
      //   Bunun yerine planında VARSA iade-özel hesaplara eşle — satıştan iade matrahı 610 (SATIŞTAN
      //   İADELER), KDV adında "İADE" geçen 191/391 ("SATIŞTAN İADE İNDİRİLECEK KDV"). Kullanıcı:
      //   "610 var, 191 satıştan iade ind. KDV var, niye seçmiyor". İade hesabı yoksa boş (kullanıcı ekler).
      const isReturn = (doc.ocrData as any)?.isReturn === true;
      const _hasIade = (n: any) => { const u = String(n || '').toLocaleUpperCase('tr-TR'); return u.includes('İADE') || u.includes('IADE'); };
      // YÖNE GÖRE İADE: (a) SATIŞTAN iade (alış görünümlü, !isSale) → matrah 610 (SATIŞTAN İADELER),
      //   KDV 191 "satıştan iade indirilecek KDV". (b) ALIŞTAN iade (satış görünümlü, isSale, mükellef
      //   KESTİ) → matrah 610 DEĞİL, orijinal stok/gider (153/770) ALACAK; KDV 391 "alıştan iade
      //   hesaplanan KDV". returnMatrah yalnız SATIŞTAN iade'de dolu; alıştan iade matrahı aşağıda
      //   normal categoryMatrah/saleMatrahDefault akışına bırakılır.
      const returnMatrah = (isReturn && !isSale) ? leafOnly(
        accounts.find((a: any) => { const c = String(a.accountCode || ''); return /^61[01]/.test(c) && _hasIade(a.accountName) && isPostableLeaf(c); })
        || accounts.find((a: any) => { const c = String(a.accountCode || ''); return /^610/.test(c) && isPostableLeaf(c); }),
      ) : null;
      const returnVergi = isReturn ? leafOnly(
        accounts.find((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(isSale ? '391' : '191') && _hasIade(a.accountName) && isPostableLeaf(c); }),
      ) : null;
      const vendorName = isSale ? doc.customerName : doc.vendorName;
      const vendorVkn = String((isSale ? doc.buyerVkn : doc.sellerVkn) || '').replace(/\D/g, '');
      // Kalem-bazlı kategori (AI ile oku'dan): stok/masraf/demirbaş ayrımını plana eşle.
      let kat = String((doc.ocrData as any)?.matrahKategori || '').toLowerCase().trim();
      // İÇERİK-FAALİYET TUTARLILIK DENETİMİ (kullanıcı kuralı: prompt yetmiyor, KOD da garanti etmeli):
      //   AI kategoriyi "ticari_mal/hammadde/genel_gider" dese de, fatura İÇERİĞİ kesin bir sabit-kıymet
      //   (cihaz/makine/mobilya/klima…) + mükellef o ürünü ANA FAALİYETİNDE SATMIYORSA → bu bir DEMİRBAŞ'tır
      //   (lokantanın aldığı klima ticari mal değildir). detectFixedAsset = içerik(kalem/giderTuru/yorum) +
      //   faaliyet semantiği — "nokta-yama DEĞİL"; klima TİCARETİ yapanın kliması ticari mal kalır (faaliyetinde
      //   geçer → is=false). Bu içerik-sinyali AI kategorisini EZER → klima 153 TİCARİ MAL yerine 255 DEMİRBAŞ'a
      //   (yoksa BOŞ; KAT_PREFIX[demirbas]=255/253/254, gider prefix'i YOK) gider. Belge zaten FIXED_ASSET_MANUAL
      //   ile bloklu (manuel Luca) — kategori/hesap da artık tutarlı görünür. Yalnız ALIŞ (satış demirbaş ayrı).
      const faDet = !isSale ? this.detectFixedAsset(doc.ocrData, tpRow) : { is: false, reason: '' };
      if (faDet.is && kat !== 'demirbas') kat = 'demirbas';
      const KAT_PREFIX: Record<string, string[]> = {
        ticari_mal: ['153', '150', '770'],       // stok yoksa gidere düş
        hammadde: ['153', '730', '740', '770'],   // 150 KULLANILMAZ → 153 (kullanıcı: "150 kullanma 153 olacak")
        demirbas: ['255', '253', '254'],          // sabit kıymet yoksa BOŞ bırak (gidere yazma yanlış olur)
        pazarlama: ['760', '770'],
        genel_gider: ['770', '760', '740', '730'],
      };
      const alisMatrahPrefixes = KAT_PREFIX[kat] || ['770', '760', '740', '730', ' gider '];
      // GİDER hesabı: faturanın İÇERİĞİNE göre. Eskiden satıcı adıyla eşleşmeyince en DÜŞÜK 770
      // (= planın ilk hesabı, ör. "MUTFAK VE YEMEKHANE") seçiliyordu → yakıt fişi mutfağa gidiyordu.
      const giderTuru = String((doc.ocrData as any)?.giderTuru || '').trim();
      // GİDER/STOK hesabı içerikten seçilir. Öncelik (her biri EMİN olunca atar, değilse boş):
      //   1) giderTuru ADIYLA birebir eşleşen hesap (en spesifik).
      //   2) matrahKategori → plandaki o grupta TEK leaf varsa KESİN ata (ticari_mal→153,
      //      demirbaş→255). Tek hedef = belirsizlik yok; "rastgele atama" DEĞİLDİR.
      //   3) Grup çok-leaf'li (ör. 770'in 3 alt hesabı) ya da giderTuru eşleşmediyse → AI
      //      faaliyet+kategori+satıcıyla plandan SEMANTİK seçer; AI de bulamazsa null = BOŞ.
      // NOT: matrahKategori AI okumada DOLU gelir ama giderTuru çoğu zaman boş kalıyordu; eşleştirmeyi
      //   yalnız giderTuru'na bağlamak belgelerin çoğunu (51/63) boş bırakıyordu. Kategori kaldıracı bunu çözer.
      let categoryMatrah: any = null;
      let categoryGroupLeaves: any[] = []; // matrahKategori grubunun leaf'leri → ORAN-bazlı seçimde (153.01.001 %1 / .002 %10 / .003 %20)
      if (!isSale || isReturn) { // ALIŞTAN iade (isReturn && isSale) de alış-kategorisini (153/770) kullanır
        if (giderTuru) categoryMatrah = this.pickAccount(accounts, alisMatrahPrefixes, giderTuru, { requireHint: true });
        // matrahKategori belli → DOĞRUDAN o GRUBA ata (kategori = AI'ın içerik kararı, "rastgele" DEĞİL).
        //   Tek leaf → kesin. Çok leaf → önce giderTuru adıyla daralt; olmazsa o grubun EN GENEL
        //   (ilk/en düşük kodlu) alt-hesabına ata — BOŞ BIRAKMA. Kullanıcı yanlış alt-hesabı 1 kez
        //   düzeltir → satıcı+oran için öğrenilir. Grubun TÜM leaf'leri categoryGroupLeaves'e saklanır:
        //   çok-oranlı faturada her satır KENDİ oranına (matrahForRate) göre doğru alt-hesaba gider.
        if (kat) {
          for (const p of alisMatrahPrefixes) {
            const key = String(p || '').trim();
            if (!/^\d/.test(key)) continue; // yalnız kod öneki (isim-needle'ı atla)
            const leaves = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(key) && !c.startsWith('79') && isPostableLeaf(c); });
            if (!leaves.length) continue;
            categoryGroupLeaves = leaves; // ORAN-bazlı seçim için sakla (giderTuru eşleşse de)
            if (!categoryMatrah) {
              const byName = giderTuru ? leaves.find((a: any) => this.nameMatchScore(giderTuru, String(a.accountName || '')) > 0) : null;
              if (byName) {
                categoryMatrah = byName; // içerik ↔ hesap adı birebir → kesin ata
              } else if (/^(15|25)/.test(key)) {
                // HOMOJEN stok/sabit-kıymet grubu (153 TİCARİ MALLAR / 255 DEMİRBAŞLAR): tüm leaf'ler
                //   aynı semantik, yalnız KDV oranı farkı → içerik-uyuşması kategoriyle zaten sağlandı.
                //   En genel leaf güvenli; matrahForRate çok-oranlı faturada satırın oranına göre düzeltir.
                categoryMatrah = leaves[0];
              }
              // HETEROJEN gider havuzu (770/760/730/740): leaf'ler FARKLI amaçlı (mutfak/demirbaş/kira).
              //   İçerik↔ad uyuşmazsa leaves[0] = RASTGELE = YANLIŞ (araç kiralama→"DEMİRBAŞ"). Boş bırak;
              //   aşağıda AI semantik eşleştirir, o da uygun hesap bulamazsa boş kalır (kullanıcı 1 kez seçer).
            }
            break; // ilk dolu grup belirleyici
          }
        }
      }
      categoryMatrah = leafOnly(categoryMatrah); // grup/plan-dışı kodu reddet
      // ③ AI DOĞRUDAN SEÇİM (alış matrahı): okuma anında AI, mükellefin GERÇEK planından matrah
      //   hesabını seçtiyse (aiMatrahKodu, plan'da doğrulanmış leaf) → mekanik kategori yerine ONU
      //   kullan (öğrenilmiş koddan SONRA, mekanik kategoriden ÖNCE — matrahForRate'te uygulanır).
      //   Yalnız ALIŞ: satış 600 mantığı (tevkifat-farkında) zaten doğru. Gelir (60x) kodu alışta reddedilir.
      const aiKod = String((doc.ocrData as any)?.aiMatrahKodu || '').trim();
      // Sabit-kıymet tespit edildiyse (faDet.is) AI'ın okuma anında seçtiği 153/770 gibi stok/gider kodu
      //   GEÇERSİZ — yalnız 25x (demirbaş) kabul; aksi halde AI seçimi düşer, kategori-düzeltmesi (255/BOŞ) geçerli.
      const aiMatrahAcc = (!isSale && aiKod && !aiKod.startsWith('60') && isPostableLeaf(aiKod)
        && !(faDet.is && !/^25/.test(aiKod)))
        ? accounts.find((a: any) => String(a.accountCode || '') === aiKod) : null;
      const aiGroupLeaves = aiMatrahAcc
        ? accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(aiKod.split('.').slice(0, 2).join('.') + '.') && isPostableLeaf(c); })
        : [];
      // İÇERİK-HESAP SEMANTİK EŞLEŞTİRME (kullanıcı kuralı): heterojen gider havuzunda (7xx/6xx) ad
      //   eşleşmeyince hesabı RASTGELE atama — AI, fatura içeriğini (giderTuru) mükellefin işine +
      //   plandaki gider hesaplarına SEMANTİK eşler; uygun hesap yoksa null = BOŞ. Aynı giderTuru bir
      //   kez sorulur (aiGiderCache) + batch limiti → "Kodları düzelt"te Max fırtınası olmaz, hız korunur.
      if (!isSale && !categoryMatrah && giderTuru) {
        const ck = this.norm(giderTuru);
        if (aiGiderCache.has(ck)) {
          categoryMatrah = aiGiderCache.get(ck);
        } else if (aiAccCalls < AI_GIDER_LIMIT) {
          aiAccCalls++;
          const aiPick = leafOnly(await this.aiPickGiderAccount(accounts, tpFaaliyet, giderTuru, vendorName));
          aiGiderCache.set(ck, aiPick);
          categoryMatrah = aiPick;
        }
      }
      // KDV hesabı: tevkifatlıda planında ADINDA oranı (ör "2/10") ya da "tevkifat" geçen
      // hesabı tercih et (391.01.004 "HESAPLANAN KDV %20 2/10"), düz 391.01.003 değil.
      const vergiPrefix = isSale ? '391' : '191';
      const tevkPay = Math.round(Number((doc.ocrData as any)?.tevkifatOrani || 0) * 10); // 0.2→2 (2/10)
      // KDV hesabı ORANA göre seçilir: %20 satır → adında "20" geçen 191/391 ("İNDİRİLECEK KDV %20").
      // Eskiden orana bakmadan en düşük 191 (= "%1" hesabı) seçiliyordu → %20 KDV "%1" hesabına
      // gidiyordu (kullanıcı bildirdi). Tevkifatlıda oran/"tevkifat" hesabı önceliklidir.
      const vergiCache = new Map<string, any>();
      const vergiForRate = (rateDigits: string) => {
        const key = rateDigits || '';
        if (vergiCache.has(key)) return vergiCache.get(key);
        const grp = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(vergiPrefix) && !c.startsWith('79'); });
        let result: any = null;
        if (!grp.length) {
          result = this.pickAccount(accounts, [vergiPrefix], null);
        } else {
          // Tevkifatlı: adında oran ("2/10") ya da "tevkifat" geçen hesabı tercih et.
          if (tevkPay >= 1 && tevkPay <= 9) {
            result = grp.find((a: any) => { const n = String(a.accountName || ''); return n.includes(`${tevkPay}/10`) || /tevk[iı]fat/i.test(n); }) || null;
          }
          if (!result) {
            // tevkifat/iade/ihrac/istisna GEÇMEYEN düz hesaplar (matrahla simetrik).
            const normals = grp.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/(iade|ihrac|istisna)/i.test(String(a.accountName || '')));
            const pool = normals.length ? normals : grp;
            // ORANA göre: adındaki sayılar arasında satırın KDV oranı geçen hesabı seç (%20→"20").
            if (rateDigits) {
              result = pool.find((a: any) => (this.norm(String(a.accountName || '')).match(/\d+/g) || ([] as string[])).includes(rateDigits)) || null;
            }
            // Oran eşleşmedi: TEK aday varsa (planın tek KDV hesabı) onu kullan; ya da adında HİÇ
            // oran-sayısı olmayan TEK genel "İNDİRİLECEK/HESAPLANAN KDV" hesabı varsa onu. Aksi
            // halde (birden çok oranlı hesap var ama bu oran yok) → null = BOŞ (kural: rastgele
            // orana düşürme; kullanıcı doğru oranı ekler/seçer).
            if (!result) {
              if (pool.length === 1) result = pool[0];
              else {
                const noRate = pool.filter((a: any) => (this.norm(String(a.accountName || '')).match(/\d+/g) || []).length === 0);
                result = noRate.length === 1 ? noRate[0] : null;
              }
            }
          }
        }
        vergiCache.set(key, result);
        return result;
      };
      // TEVKİFAT (KDV2 — sorumlu sıfatı): ALIŞ tevkifatta 360 satırı plandaki GERÇEK 360
      // hesabına bağlanır. Adında "KDV / sorumlu / tevkifat / beyan" geçen 360 alt-hesabını
      // tercih et (gelir-vergisi-stopajı 360'ını DEĞİL); yoksa en genel 360 leaf'i. 360 hiç
      // yoksa null → satır boşalır, K7 "360 hesabı ekle" uyarısı verir (sahte kod yazılmaz).
      const tevkMatch = (() => {
        const g360 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('360') && !c.startsWith('79'); });
        if (!g360.length) return null;
        const pref = g360.find((a: any) => { const n = this.norm(String(a.accountName || '')); return n.includes('kdv') || n.includes('sorumlu') || n.includes('tevkifat') || n.includes('beyan'); });
        if (pref) return pref;
        const depth = (c: string) => (String(c || '').match(/\./g) || []).length;
        const mx = g360.reduce((mxv: number, a: any) => Math.max(mxv, depth(String(a.accountCode || ''))), 0);
        return g360.filter((a: any) => depth(String(a.accountCode || '')) === mx)[0] || g360[0];
      })();
      // SATIŞ matrahı TEVKİFAT-FARKINDA (KDV hesabıyla simetrik): tevkifatlı satış → adında
      // "tevkifat" geçen 600; NORMAL satış → "tevkifat/iade/ihrac/istisna" GEÇMEYEN normal 600.
      // Eskiden isim eşleşmesi olmayınca EN DÜŞÜK 600 leaf seçiliyordu → planın ilk hesabı
      // "600.01.003 TEVKİFATLI GELİRLER" ise NORMAL satışlar da oraya düşüyordu (kullanıcı bildirdi).
      const saleMatrahDefault = (() => {
        if (!isSale || isReturn) return categoryMatrah; // alıştan iade: 600 değil, orijinal stok/gider
        const g600 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('600') && !c.startsWith('79'); });
        if (!g600.length) return categoryMatrah;
        if (tevkPay >= 1) {
          // önce TAM oran ("2/10"), sonra "tevkifat" kelimesi ya da herhangi "X/10" deseni.
          const exact = g600.find((a: any) => String(a.accountName || '').includes(`${tevkPay}/10`));
          const hit = exact || g600.find((a: any) => this.isTevkifatAccountName(a.accountName || ''));
          return hit || categoryMatrah;
        }
        // NORMAL satış → tevkifat (KELİME ya da "X/10" ORAN) / iade / ihrac / istisna GEÇMEYEN 600.
        const normals = g600.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/(iade|ihrac|istisna)/i.test(String(a.accountName || '')));
        const pool = normals.length ? normals : g600;
        const depth = (c: string) => (String(c || '').match(/\./g) || []).length;
        const mx = pool.reduce((m: number, a: any) => Math.max(m, depth(String(a.accountCode || ''))), 0);
        return pool.filter((a: any) => depth(String(a.accountCode || '')) === mx)[0] || pool[0];
      })();
      // SATIŞ oran-bazlı pool: 600 grubu (tevkifat-farkında) leaf'leri — matrahForRate satırın oranına
      //   göre seçer (600.01.001 %1 / .002 %10 / .003 %20). saleMatrahDefault tek-değer fallback'tir.
      const saleGroupLeaves: any[] = isSale ? (() => {
        const g600 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('600') && !c.startsWith('79') && isPostableLeaf(c); });
        if (!g600.length) return [];
        if (tevkPay >= 1) return g600.filter((a: any) => this.isTevkifatAccountName(a.accountName || '') || String(a.accountName || '').includes(`${tevkPay}/10`));
        const normals = g600.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/(iade|ihrac|istisna)/i.test(String(a.accountName || '')));
        return normals.length ? normals : g600;
      })() : [];
      // CARI: önce VKN bazlı öğrenilmiş cari (kesin), yoksa KATI isim eşleşmesi. İsim de
      // tutmazsa null → placeholder boşaltılır ("Eksik cari"). Eskiden plandaki İLK cari
      // (ör. ALTEKS) sessizce seçiliyordu — yanlış eşleştirmenin ana kaynağıydı.
      const cariMemory = vendorVkn
        ? await this.pickCariMemoryAccount(tenantId, taxpayerId, vendorVkn, accounts)
        : null;
      // ÖKC/yazarkasa fişi NAKİT işlemdir → karşı taraf cari değil, 100 KASA.
      const okcFis = String(doc.documentType || '').toUpperCase() === 'OKC_FIS';
      // İADE carisi YÖN-belirsiz: satıştan iade → MÜŞTERİ (120), alıştan iade → SATICI (320). İade
      //   ALIŞ görünüp cari 120'de olunca 320'de aranıp bulunamıyordu (kullanıcı: "carisi Luca'da
      //   var ama eşleştirmedi"). İade'de her iki grubu + her iki tarafın adını dene.
      const cariPrefixes = isReturn ? ['120', '320', '329', '331'] : (isSale ? ['120'] : ['320', '329', '331']);
      const cariNames = isReturn ? [doc.customerName, doc.vendorName].filter(Boolean) : [vendorName];
      let cariIsim: any = null;
      if (!okcFis) { for (const nm of cariNames) { cariIsim = this.pickAccount(accounts, cariPrefixes, nm, { requireHint: true }); if (cariIsim) break; } }
      const cariMatch = leafOnly(okcFis
        ? this.pickAccount(accounts, ['100'], null)
        : (cariMemory || cariIsim));
      // ORAN-BAZLI matrah: her matrah satırı KENDİ KDV oranına göre öğrenilmiş kodu alır;
      // yoksa kategori/varsayılan. Öğrenilmiş kod (satıcı+oran) her zaman önceliklidir.
      const matrahCache = new Map<string, any>();
      const matrahForRate = async (rate: string) => {
        if (matrahCache.has(rate)) return matrahCache.get(rate);
        const learned = vendorVkn ? await this.pickVendorMemoryAccount(tenantId, taxpayerId, vendorVkn, accounts, rate) : null;
        let m = leafOnly(learned);
        // ③ AI doğrudan seçim (öğrenilmiş kod YOKSA): AI'ın okuma anında plandan seçtiği matrah
        //   hesabı. Çok-oranlı faturada AI grubunun bu orana ait varyantı (153.01.001 %1 / .003 %20)
        //   varsa onu, yoksa AI'ın seçtiği kodu. Mekanik kategori/varsayılandan ÖNCE gelir.
        if (!m && aiMatrahAcc) {
          if (rate) { const v = aiGroupLeaves.find((a: any) => (this.norm(String(a.accountName || '')).match(/\d+/g) || ([] as string[])).includes(rate)); m = leafOnly(v) || leafOnly(aiMatrahAcc); }
          else m = leafOnly(aiMatrahAcc);
        }
        // ORAN-bazlı matrah (KDV gibi orana DUYARLI): kategori/600 grubunda adında satırın oranı geçen
        //   leaf'i seç (153.01.001 "%1" / .002 "%10" / .003 "%20"; satışta 600 aynı). Eskiden hep en
        //   genel leaf (153.01.001=%1) atanıyordu → çok-oranlı faturada %10 matrahı da %1 hesabına
        //   gidiyordu (kullanıcı: "aynı faturada birden fazla oran var, niye orana dikkat etmiyor").
        if (!m && rate) {
          const pool = isSale ? saleGroupLeaves : categoryGroupLeaves;
          const hit = (pool || []).find((a: any) => (this.norm(String(a.accountName || '')).match(/\d+/g) || ([] as string[])).includes(rate));
          if (hit) m = leafOnly(hit);
        }
        if (!m) m = leafOnly(saleMatrahDefault);
        matrahCache.set(rate, m);
        return m;
      };

      for (const line of doc.lines || []) {
        const group = String(line.group || '') as 'matrah' | 'vergi' | 'cari' | 'tevkifat';
        const lineRate = String(line.rate || '').replace(/[^0-9]/g, '');
        // İADE/İPTAL: matrah → 610 (satıştan iade), vergi → iade-KDV (191/391 "İADE"). Plandaki gerçek
        //   iade hesabı varsa ata (RETURN_NEEDS_REVERSAL uyarısı da kalkar), yoksa boş bırak (kullanıcı
        //   ekler). Tevkifat iade'de boşalır. Cari (karşı taraf) normal akışta kalır — iade aynı cariye işlenir.
        if (isReturn && (group === 'matrah' || group === 'vergi' || group === 'tevkifat')) {
          const ret = group === 'matrah' ? returnMatrah : group === 'vergi' ? returnVergi : null;
          // ALIŞTAN İADE matrahı (returnMatrah null, satış görünümlü): 610 DEĞİL — orijinal stok/gider
          //   (153/770). Bu satırı normal matrah akışına BIRAK (continue etme); matrahForRate
          //   saleMatrahDefault=categoryMatrah'ı atar. returnMatrah yalnız SATIŞTAN iade'de dolu (610).
          if (!(group === 'matrah' && !returnMatrah)) {
            const want = ret ? String((ret as any).accountCode) : '';
            if (String(line.accountCode || '') !== want) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: want ? { accountCode: want, description: (ret as any).accountName } : { accountCode: '', description: '' },
              });
            }
            continue;
          }
          // (alıştan iade matrahı → aşağıdaki normal categoryMatrah akışına düşer)
        }
        const match = group === 'matrah'
          ? await matrahForRate(lineRate)
          : group === 'vergi' ? vergiForRate(lineRate)
          : group === 'cari' ? cariMatch
          : null;
        const current = String(line.accountCode || '');
        // TEVKİFAT özel (KDV2 360): satıcı carisine EZME. Plandaki gerçek 360'a bağla; 360 yoksa
        // boşalt (K7 "360 ekle" uyarır). Sahte 360.01.001 placeholder'ı asla canlı kalmasın.
        if (group === 'tevkifat') {
          if (tevkMatch) {
            if (current !== String((tevkMatch as any).accountCode)) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (tevkMatch as any).accountCode },
              });
            }
          } else if (current) {
            await (this.prisma as any).invoiceAccountingLine.update({ where: { id: line.id }, data: { accountCode: '', description: '' } });
          }
          continue;
        }
        // CARI özel: cari HER ZAMAN karşı tarafa eşleşmeli. Mevcut kod (placeholder olmasa
        // bile) karşı tarafı içermiyorsa ve VKN-hafızasından gelmiyorsa → YANLIŞ otomatik
        // eşleşme (ör. KAYIKÇI faturasına AYDE cari); doğrusuyla değiştir ya da BOŞALT.
        if (group === 'cari') {
          // ÖKC/yazarkasa fişi → HER ZAMAN 100 Kasa (nakit). İsim/VKN eşleşmesi aranmaz.
          if (okcFis) {
            if (cariMatch && !current.startsWith('100')) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (cariMatch as any).accountCode, description: (cariMatch as any).accountName },
              });
            }
            continue;
          }
          const curAcc = current ? accounts.find((a: any) => String(a.accountCode || '') === current) : null;
          const fromMemory = !!cariMemory && !!curAcc && String(curAcc.accountCode) === String((cariMemory as any).accountCode);
          const nameOk = !!curAcc && this.nameMatchScore(vendorName || '', String(curAcc.accountName || '')) > 0;
          if (current && (fromMemory || nameOk)) continue; // doğru cari — dokunma
          await (this.prisma as any).invoiceAccountingLine.update({
            where: { id: line.id },
            data: cariMatch
              ? { accountCode: (cariMatch as any).accountCode, description: (cariMatch as any).accountName }
              : { accountCode: '', description: '' },
          });
          continue;
        }
        // MATRAH özel (SATIŞ tevkifat-lik): mevcut 600 hesabının tevkifat-liği belgeyle çelişiyorsa
        // (normal satış ama tevkifatlı-600, ya da tevkifatlı satış ama normal-600) → doğru tevkifat-
        // likteki 600'e çek. Doğru tevkifat-likteki BAŞKA bir 600'e (kullanıcı seçimi) dokunmaz.
        if (group === 'matrah' && isSale && saleMatrahDefault) {
          const curAcc = current ? accounts.find((a: any) => String(a.accountCode || '') === current) : null;
          const curIsTevk = !!curAcc && this.isTevkifatAccountName(String(curAcc.accountName || ''));
          if (curAcc && curIsTevk !== (tevkPay >= 1) && current !== String((saleMatrahDefault as any).accountCode)) {
            await (this.prisma as any).invoiceAccountingLine.update({
              where: { id: line.id },
              data: { accountCode: (saleMatrahDefault as any).accountCode },
            });
            continue;
          }
        }
        // MATRAH özel (ALIŞ gider — KULLANICI KURALI: emin değilse BOŞ): mevcut gider hesabı
        // GÜVENİLİR değilse (öğrenilmiş/gider-türü 'match' ile aynı DEĞİL ve gider türü adıyla
        // eşleşmiyor) → 'match' (gider türü/öğrenilmiş) varsa onunla değiştir, YOKSA BOŞALT.
        // Eskiden otomatik gelen rastgele "MUTFAK" gibi kodlar "Kodları düzelt"te temizlenir.
        if (group === 'matrah' && !isSale && current) {
          const curAcc = accounts.find((a: any) => String(a.accountCode || '') === current);
          if (curAcc) {
            const matchCode = match ? String((match as any).accountCode) : '';
            const typeOk = !!giderTuru && this.nameMatchScore(giderTuru, String(curAcc.accountName || '')) > 0;
            if (current !== matchCode && !typeOk) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: matchCode ? { accountCode: matchCode } : { accountCode: '', description: '' },
              });
            }
            continue;
          }
        }
        // VERGİ özel (ORAN + TEVKİFAT-lik): mevcut KDV hesabının ADINDAKİ oranı satır oranıyla
        // çelişiyorsa (ör. %20 satır ama "İNDİRİLECEK KDV %1" hesabı) ya da tevkifat-liği
        // çelişiyorsa → orana/tevkifata uygun hesaba çek. Doğru hesaba (kullanıcı) dokunmaz.
        if (group === 'vergi') {
          const want = vergiForRate(lineRate);
          const curAcc = current ? accounts.find((a: any) => String(a.accountCode || '') === current) : null;
          if (want && curAcc) {
            const curIsTevk = this.isTevkifatAccountName(String(curAcc.accountName || ''));
            const curRates = this.norm(String(curAcc.accountName || '')).match(/\d+/g) || ([] as string[]);
            const rateOk = !lineRate || curRates.length === 0 || curRates.includes(lineRate);
            const tevkOk = curIsTevk === (tevkPay >= 1);
            if ((!rateOk || !tevkOk) && current !== String((want as any).accountCode)) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (want as any).accountCode },
              });
              continue;
            }
          }
        }
        const isPlaceholder =
          !current ||
          [
            '770.01.010',
            '760.01.001',
            '740.01.001',
            '600.01.001',
            '191.01.001',
            '191.01.010',
            '191.01.020',
            '391.01.001',
            '391.01.010',
            '391.01.020',
            '320.01.001',
            '120.01.001',
          ].includes(current);
        if (!isPlaceholder) continue; // kullanıcının seçtiği kod — dokunma
        if (match) {
          // (cari yukarıda ele alındı) — matrah/vergi/tevkifat: AÇIKLAMA = HESAP ADI. Kullanıcı
          //   "153'ün o hesabın açıklamasını yazmıyor" dedi → yevmiyede "Gider / matrah" yerine
          //   "TİCARİ MALLAR %20" görünür. match accounts'tan gelir (accountName dolu).
          await (this.prisma as any).invoiceAccountingLine.update({
            where: { id: line.id },
            data: { accountCode: match.accountCode, ...((match as any).accountName ? { description: String((match as any).accountName) } : {}) },
          });
        } else if (current) {
          // Planda uygun kod YOK → var olmayan placeholder'ı (ör. 770.01.010) BOŞALT.
          // "Eksik hesap kodu" görünür; kullanıcı 1 kez seçer → satıcı için öğrenilir.
          await (this.prisma as any).invoiceAccountingLine.update({
            where: { id: line.id },
            data: { accountCode: '', description: '' },
          });
        }
      }
      // AÇIKLAMA = HESAP ADI senkronu (TÜM accountCode değişikliklerinden SONRA): matrah/vergi
      //   satırının açıklaması GÜNCEL hesap kodunun plandaki ADI olmalı ("Gider / matrah" /
      //   "Satış matrahı" gibi standart metin DEĞİL — kullanıcı defalarca istedi; dolu/doğru
      //   hesapta da geçerli). Hesap kodu boşsa açıklama da boş. Cari satırı zaten karşı taraf adını yazar.
      {
        const freshLines = await (this.prisma as any).invoiceAccountingLine.findMany({ where: { documentId: doc.id } });
        for (const ln of freshLines) {
          const g = String(ln.group || '');
          if (g !== 'matrah' && g !== 'vergi') continue;
          const code = String(ln.accountCode || '');
          const acc = code ? accounts.find((a: any) => String(a.accountCode || '') === code) : null;
          const wantDesc = acc ? String(acc.accountName || '') : '';
          if (String(ln.description || '') !== wantDesc) {
            await (this.prisma as any).invoiceAccountingLine.update({ where: { id: ln.id }, data: { description: wantDesc } });
          }
        }
      }
      // AI GEREKÇE (deterministik, yön-KESİN): okuma-anı AI yorumu yanlış olabiliyordu (alışa "satış"
      //   diyor, firma faaliyetini kopyalıyordu). Burada faaliyet + GERÇEK yön + içerik + SEÇİLEN
      //   hesapla net kurulur → "neye göre işlendi". ocrData.muhasebeNeden'e yazılır (üstüne yazar).
      {
        const matrahAccForNeden = isSale ? saleMatrahDefault : categoryMatrah;
        const prevOcr = (doc.ocrData as any) || {};
        // Yapay zekanın OKUMA ANINDA ürettiği gerçek içerik/nitelik yorumu (aiYorum) KORUNUR;
        //   yön (sistemde KESİN) + seçilen GERÇEK hesap kodu (mükellefin planından) onun etrafına
        //   eklenir. Yapay zeka karar değiştirmez, sistem yalnız kesin bilgiyle çerçeveler.
        //   aiYorum yoksa (eski/okunamayan belge) eski deterministik cümleye düşülür (fallback).
        const aiYorum = String(prevOcr.aiYorum || '').trim();
        const neden = this.composeMuhasebeNeden(tpFaaliyet, isSale, isReturn, aiYorum, matrahAccForNeden, kat, giderTuru);
        // ZENGİN AI YORUMU (ocrData.muhasebeNedenZengin) bayatlamasın: rematch kodları/yönü yeniden
        //   eşledi → daha önce üretilmiş zengin yorum eski hesap/içeriğe ait olabilir. KOŞULSUZ temizle;
        //   kullanıcı belgeyi tekrar açınca lazy yeniden üretilir (tek belge = tek Max çağrısı, ucuz).
        //   Deterministik muhasebeNeden anlık fallback olarak güncel kalır.
        const hadZengin = !!String(prevOcr.muhasebeNedenZengin || '');
        const nedenChanged = neden && String(prevOcr.muhasebeNeden || '') !== neden;
        if (nedenChanged || hadZengin) {
          await (this.prisma as any).invoiceAccountingDocument.update({
            where: { id: doc.id },
            data: { ocrData: { ...prevOcr, ...(neden ? { muhasebeNeden: neden } : {}), muhasebeNedenZengin: '' } },
          });
        }
      }
    }
  }

  private async pickVendorMemoryAccount(
    tenantId: string,
    taxpayerId: string,
    firmaKimlikNo: string,
    accounts: Array<{ accountCode: string; accountName: string }>,
    rate?: string | null,
  ) {
    if (!firmaKimlikNo || !taxpayerId || !accounts.length) return null;
    const accountByCode = new Map(accounts.map((account) => [String(account.accountCode || '').trim(), account]));
    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      include: {
        decisions: {
          where: { taxpayerId, kararTipi: 'fatura' },
          orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }],
          take: 16,
        },
      },
    });
    const decisions = (memory?.decisions || [])
      .filter((d: any) => accountByCode.has(String(d.kategori || '').trim()))
      // Cari (altKategori='CARI') kararları matrah/gider kodu DEĞİLDİR — dışla.
      .filter((d: any) => String(d.altKategori || '').trim().toUpperCase() !== 'CARI');
    const r = String(rate || '').replace(/[^0-9]/g, '');
    // Öncelik: bu orana özel kural → orana bağsız (genel) → en çok onaylanan (plana uyan).
    const byRate = r ? decisions.find((d: any) => String(d.altKategori || '').replace(/[^0-9]/g, '') === r) : null;
    const general = decisions.find((d: any) => !String(d.altKategori || '').trim());
    const pick = byRate || general || decisions[0];
    return pick ? accountByCode.get(String(pick.kategori).trim()) : null;
  }

  /**
   * VKN bazlı CARI hesap öğrenmesi: müşavir bir kez karşı taraf için cari hesabı seçip
   * onaylayınca (altKategori='CARI' işaretiyle) öğrenilir; aynı VKN'nin sonraki faturalarında
   * cari otomatik gelir. İsim benzerliğine güvenmez — VKN kesin anahtardır.
   */
  private async pickCariMemoryAccount(
    tenantId: string,
    taxpayerId: string,
    firmaKimlikNo: string,
    accounts: Array<{ accountCode: string; accountName: string }>,
  ) {
    const vkn = String(firmaKimlikNo || '').replace(/\D/g, '');
    if (!vkn || !taxpayerId || !accounts.length) return null;
    const accountByCode = new Map(accounts.map((a) => [String(a.accountCode || '').trim(), a]));
    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
      include: {
        decisions: {
          where: { taxpayerId, kararTipi: 'fatura' },
          orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }],
          take: 16,
        },
      },
    });
    const cari = (memory?.decisions || []).find(
      (d: any) =>
        String(d.altKategori || '').trim().toUpperCase() === 'CARI' &&
        accountByCode.has(String(d.kategori || '').trim()),
    );
    return cari ? accountByCode.get(String(cari.kategori).trim()) : null;
  }

  private pickAccount(
    accounts: Array<{ accountCode: string; accountName: string }>,
    prefixesOrNeedles: string[],
    nameHint?: string | null,
    opts?: { requireHint?: boolean },
  ) {
    const hint = String(nameHint || '').trim();
    // Önekleri ÖNCELİK SIRASIYLA dene; ilk dolu grubu kullan. Karışık havuzdan EN YÜKSEK
    // kodu seçmek 798 (olağandışı gider) gibi yanlış seçimlere yol açıyordu. Artık: en
    // düşük (en genel) leaf'i al, 79x'i (olağandışı/yıl-sonu) asla otomatik seçme.
    for (const p of prefixesOrNeedles) {
      const key = p.trim();
      const isPrefix = /^\d/.test(key);
      const needle = this.norm(key);
      const group = accounts.filter((a) => {
        const code = String(a.accountCode || '');
        if (code.startsWith('79')) return false;
        if (isPrefix) return code.startsWith(key);
        return ` ${this.norm(a.accountName || '')} `.includes(needle);
      });
      if (!group.length) continue;
      if (hint) {
        // İsim benzerliği: "ilk 18 karakter içeriyor mu" yerine AYIRT EDİCİ kelime
        // örtüşmesine göre skorla. Eşik altı eşleşmeleri kabul etme (yanlış cari önler).
        const scored = group
          .map((a) => ({ a, s: this.nameMatchScore(hint, a.accountName || '') }))
          .filter((x) => x.s > 0)
          .sort((x, y) => y.s - x.s);
        if (scored.length) return scored[0].a;
        // KATI mod (cari): isim eşleşmesi YOKSA rastgele ilk hesabı seçme → null dön.
        // Böylece "Eksik cari" görünür; müşavir 1 kez seçer → VKN bazında öğrenilir.
        if (opts?.requireHint) return null;
      }
      // Fiş LEAF (detay) hesaba kesilir → grup başlığı ("770") yerine en derin seviyeyi
      // seç, o seviyede en düşük (en genel) kodu al (ör. 770.01.001). accounts kod artan sıralı.
      const depth = (c: string) => (String(c || '').match(/\./g) || []).length;
      const maxDepth = group.reduce((mx: number, a: any) => Math.max(mx, depth(a.accountCode)), 0);
      const leaves = group.filter((a: any) => depth(a.accountCode) === maxDepth);
      return leaves[0] || group[0];
    }
    return null;
  }

  // İki firma/cari ünvanı arasında AYIRT EDİCİ kelime örtüşme skoru. Jenerik hukuk/adres
  // kelimeleri (san, tic, ltd, şti, mah...) elenir; kalan kelimelerden en az 2 ortak veya
  // ipucu kelimelerinin yarısı ortaksa eşleşme sayılır. Skor yoksa 0 → eşleşme yok.
  private nameMatchScore(hint: string, name: string): number {
    const STOP = new Set([
      // hukuk/biçim
      'san', 'tic', 'sti', 'ltd', 'as', 've', 'anonim', 'limited', 'sirket', 'sirketi',
      'sanayi', 'ticaret', 'ithalat', 'ihracat', 'imalat', 'kollektif', 'komandit', 'kom',
      'holding', 'grup', 'grubu', 'mah', 'cad', 'sok', 'apt', 'no', 'vd', 'vergi', 'dairesi', 'turkiye',
      // JENERİK SEKTÖR/ORTAK kelimeler — bunlar firma ADI değildir, ortak çıkıp YANLIŞ eşleşme üretir
      'turizm', 'insaat', 'yatirim', 'gida', 'nakliyat', 'nakliye', 'lojistik', 'enerji', 'otomotiv',
      'tekstil', 'konfeksiyon', 'plastik', 'kimya', 'elektrik', 'elektronik', 'muhendislik',
      'danismanlik', 'hizmetleri', 'hizmet', 'urunleri', 'urun', 'market', 'magaza', 'dis', 'yapi',
      'emlak', 'gayrimenkul', 'saglik', 'egitim', 'teknoloji', 'bilisim', 'medya', 'reklam',
      'organizasyon', 'profesyonel', 'mutfak', 'ekipmanlari', 'ekipman', 'endustri', 'endustriyel',
      'fen', 'lisesi', 'okul', 'aile', 'birligi', 'kiz', 'erkek', 'ana', 'anaokulu', 'sitesi',
      'yonetimi', 'teknik', 'servis', 'sistemleri', 'sistem', 'makina', 'makine',
    ]);
    // Türkçe→ASCII katla (ş→s ğ→g ı→i ç→c ö→o ü→u): STOP listesi ASCII yazılı; "ŞİRKETİ/SANAYİ/
    //   TİCARET/MAĞAZA" gibi Türkçe-karakterli kelimeler aksi halde STOP'tan GEÇMEYİP ortak çıkıyor →
    //   YANLIŞ CARİ (FILE MARKET MAĞAZACILIK → YENİ MAĞAZACILIK: "şirketi"+"mağazacılık" 2 ortak
    //   sanılıp eşleşiyordu; ASCII katlamayla "şirketi"→"sirketi" STOP'a düşer, yalnız "magazacilik"
    //   ortak kalır=1<2 → eşleşme reddedilir; gerçek hesabı 320.01.F001 doğru seçilir).
    const asciiFold = (s: string) => s.replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
    const toks = (s: string) => asciiFold(this.norm(s)).split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
    const h = toks(hint);
    const nameSet = new Set(toks(name));
    if (!h.length || !nameSet.size) return 0;
    let shared = 0;
    for (const t of h) if (nameSet.has(t)) shared++;
    if (shared === 0) return 0;
    // EŞLEŞME KURALI: tek ayırt edici kelime (UNOX → "UNOX GIDA") yeter; birden çok kelimede EN AZ
    // 2 ortak iste. Bu, MARKA-ÖNEKİ farkını TOLERE eder: belge "A101 YENİ MAĞAZACILIK", Luca cari
    // "YENİ MAĞAZACILIK ANONİM ŞİRKETİ" → "yeni"+"magazacilik" 2 ortak → eşleşir. Ama tek jenerik
    // ortağı (yalnız "yeni" / sektör kelimesi) reddeder (MURAT YILMAZ ≠ MURAT DEMİR). Sektör/biçim
    // kelimeleri (turizm/insaat/market/magaza…) zaten STOP listesinde elenir → yanlış cari önlenir.
    // (Eski "İLK kelime ZORUNLU" kuralı A101 gibi marka-önekli carileri kaçırıyordu — kullanıcı
    //  "kabak gibi planında var ama eşleştirmiyor" dedi; VKN plan'da boş → isim tek dayanak.)
    if (h.length >= 2 && shared < 2) return 0;
    return shared * 100;
  }

  private norm(value: string) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** matrahKategori kodunu, giderTuru boş geldiğinde AI eskalasyonuna verilecek
   *  insan-okur gider açıklamasına çevirir (bağlam). */
  private kategoriAciklama(kat: string): string {
    const m: Record<string, string> = {
      ticari_mal: 'ticari mal / satılan emtia (stok)',
      hammadde: 'hammadde / üretim girdisi',
      demirbas: 'demirbaş / sabit kıymet',
      pazarlama: 'pazarlama, satış ve dağıtım gideri',
      genel_gider: 'genel yönetim gideri',
    };
    return m[String(kat || '').toLowerCase().trim()] || (kat || 'genel gider');
  }

  /** Hesap ADI tevkifatı işaret ediyor mu? — KDV hesabı gibi 600/391/191 tevkifat hesapları
   *  ya "TEVKİFAT" kelimesiyle ya da "2/10" tarzı ORAN deseniyle adlandırılır (KDV oranı %20
   *  ile karışmaz: payda /10'dur). İkisini de tanırız ki tevkifat hesabı kaçmasın / normal
   *  satış yanlışlıkla tevkifat hesabına düşmesin. */
  private isTevkifatAccountName(name: string): boolean {
    const n = String(name || '');
    if (/tevk[iı]fat/i.test(n)) return true;
    if (/\b(?:10|[1-9])\s*\/\s*10\b/.test(n)) return true; // 2/10, 5/10, 9/10, 10/10 …
    return false;
  }
}
