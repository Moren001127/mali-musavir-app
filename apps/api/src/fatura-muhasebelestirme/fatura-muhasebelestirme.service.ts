import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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
import { PortalAutomationService } from '../portal-automation/portal-automation.service';
import { BeyanKayitlariService } from '../beyan-kayitlari/beyan-kayitlari.service';
import { ModuleRef } from '@nestjs/core';
import { isletmeRef, getKayitAltList, isletmeAlisSatisTuru, isletmeIslemTuru, defaultBelgeTuruKod, normalizeDocumentType, isletmeGiderSinifi, isletmeAutoKayitAltKod, isletmeAutoKayitTuru, defaultKayitAltKod, denetimUyariOlustur, giderIcerikSinifla } from '@mali-musavir/shared';

// ── İşletme defteri AI sınıflandırması ──
// Faturayı okuyan max-vision AI'ına, mükellefin FAALİYETİ + faturanın İÇERİĞİYLE muhakeme ederek
// İşletme kayıt türü + alt türünü seçtirmek için prompt segmenti; ve AI'ın verdiği AD'ı koda çözen yardımcı.
function islPromptSeg(kind?: 'ALIS' | 'SATIS'): string {
  const tx = (k: string) => isletmeRef(k).kayitTuru.map((kt: any) =>
    `  • ${kt.ad}: ${getKayitAltList(k, kt.kod).filter((a: any) => !/^99/.test(a.kod)).map((a: any) => a.ad).join(' | ') || '(alt yok)'}`,
  ).join('\n');
  const yon = kind === 'SATIS'
    ? '⚡ YÖN KESİN SATIŞ: Mükellef bu belgede SATICI. Hasılat/gelir türü seç — GİDER türü YAZMA.'
    : '⚡ YÖN KESİN ALIŞ: Mükellef bu belgede ALICI (mal/hizmet SATIN ALIYOR). Gider/maliyet türü seç — "faaliyet geliri", "hizmet sunumu", "geliridir" ifadesi isletmeNeden\'e YAZMA.';
  return [
    'İŞLETME DEFTERİ SINIFLANDIRMASI — bu mükellef İşletme/Defter-Beyan usulü.',
    yon,
    kind === 'ALIS'
      ? 'ALIŞ kuralı: alınan şey mükellefin SATTIĞI/ticaretini yaptığı emtia mı → "Mal Alışı". Kendi işinde KULLANDIĞI gider mi → "İndirilecek Giderler (GVK Md. 40)" + alt. Uzun ömürlü makine/cihaz/taşıt/demirbaş → "Sabit Kıymet Alışı".'
      : 'SATIŞ kuralı: satılan mal mı → "Mal Satışı", hizmet mi → "Hizmet Satışı" + uygun alt.',
    kind === 'ALIS' ? ('GİDER türleri ve alt türleri:\n' + tx('ALIS'))
      : kind === 'SATIS' ? ('GELİR türleri ve alt türleri:\n' + tx('SATIS'))
      : ('GELİR türleri ve alt türleri:\n' + tx('SATIS') + '\nGİDER türleri ve alt türleri:\n' + tx('ALIS')),
    'JSON\'A EKLE: "isletmeKayitTuru":"<yukarıdaki TAM kayıt türü adı>","isletmeAltTuru":"<o türün listesinden TAM alt adı>","isletmeNeden":"<tek cümle gerekçe>". Her zaman EN UYGUN alt türü seç — ASLA boş bırakma.',
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

function isIsletmeLedger(defterTuru?: any, mihsapDefterTuru?: any): boolean {
  const s = `${defterTuru || ''} ${mihsapDefterTuru || ''}`
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
  return /isletme|defter.?beyan|basit/.test(s);
}

function isletmeKind(doc: any): 'ALIS' | 'SATIS' {
  return String(doc?.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
}

function isletmeAmountReady(doc: any): boolean {
  const ocr: any = doc?.ocrData || {};
  const isl: any = ocr?.isletme || {};
  const rows = Array.isArray(isl.satirlar) ? isl.satirlar : [];
  const rowTotal = rows.reduce((s: number, r: any) => s + Number(r?.matrah || 0) + Number(r?.kdvTutar || 0) + Number(r?.krediliTutar || 0), 0);
  const lineTotal = (doc?.lines || []).reduce((s: number, l: any) => s + Number(l?.debit || 0) + Number(l?.credit || 0), 0);
  return rowTotal > 0 || Number(isl.matrah || 0) > 0 || Number(isl.kdvTutar || 0) > 0 || Number(ocr.matrah || 0) > 0 || Number(ocr.kdvTutari || 0) > 0 || Number(doc?.totalAmount || 0) > 0 || lineTotal > 0;
}

function isletmeWithBelgeDefaults(doc: any): any {
  const kind = isletmeKind(doc);
  const ocr: any = doc?.ocrData || {};
  const isl: any = ocr?.isletme || {};
  const normalized = normalizeDocumentType(doc?.documentType || ocr?.belgeTuru || ocr?.documentType);
  const belgeTuruKod = String(isl.belgeTuruKod || (normalized ? defaultBelgeTuruKod(normalized, kind) : '')).trim();
  if (!belgeTuruKod) return isl;
  const ref = isletmeRef(kind);
  const belgeTuruAd = isl.belgeTuruAd || ref.belgeTuru.find((x: any) => x.kod === belgeTuruKod)?.ad || '';
  return { ...isl, belgeTuruKod, belgeTuruAd };
}

function isletmeDocumentReady(doc: any): { ok: boolean; reason: string } {
  if (!isletmeAmountReady(doc)) return { ok: false, reason: 'tutar okunamamis' };
  const kind = isletmeKind(doc);
  const isl = isletmeWithBelgeDefaults(doc);
  if (!String(isl?.belgeTuruKod || '').trim()) return { ok: false, reason: 'belge turu secilmemis' };
  const rawRows = Array.isArray(isl?.satirlar) && isl.satirlar.length ? isl.satirlar : [isl];
  const rows = rawRows.filter((r: any) =>
    !Array.isArray(isl?.satirlar) ||
    Number(r?.matrah || 0) > 0 ||
    Number(r?.kdvTutar || 0) > 0 ||
    Number(r?.krediliTutar || 0) > 0,
  );
  if (!rows.length) return { ok: false, reason: 'kayit satiri yok' };
  for (const row of rows) {
    const kt = String(row?.kayitTuruKod || '').trim();
    if (!kt) return { ok: false, reason: 'kayit turu secilmemis' };
    const altList = getKayitAltList(kind, kt);
    if (altList.length && !String(row?.kayitAltKod || '').trim()) {
      return { ok: false, reason: 'kayit alt turu secilmemis' };
    }
  }
  return { ok: true, reason: '' };
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
  /** Tevkifat işlem türü (Mihsap tarzı editör) — ocrData.tevkifat'a yazılır: { kod: '203', oran: '5/10' }. */
  tevkifat?: { kod?: string; oran?: string } | null;
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
  dateFrom?: string;
  dateTo?: string;
  direction?: 'ALIS' | 'SATIS';
  providers?: string[];
  limit?: number;
  mode?: 'query' | 'download';
  selectedRefs?: string[];
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

type ProviderPayloadLookup = {
  cfg: RuntimeIntegrationConfig;
  payloads: ProviderInvoicePayload[];
  byKey: Map<string, ProviderInvoicePayload>;
  error?: string | null;
};

type ProviderStoredVisual = {
  mimeType?: string | null;
  originalName?: string | null;
  base64?: string | null;
  html?: string | null;
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
  /** Çok-oranlı KDV kırılımı (her oran ayrı): %10 ve %20 gibi karma faturada şart. */
  kdvBreakdown?: Array<{ rate: number; base: number; amount: number }>;
  /** Tevkif edilen (alıkonan) KDV tutarı — UBL WithholdingTaxTotal. Satışta 391'e NET KDV gider. */
  tevkifatKdv?: number;
  toplamTutar?: number | null;
  paraBirimi?: string | null;
  kalemler?: Array<{ ad: string; tutar: number; oran: number }>;
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
  { provider: 'TURKCELL', label: 'Turkcell e-Şirket', kind: 'efatura', tone: 'gold' },
] as const;

const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  UYUMSOFT: 'http://efatura.uyumsoft.com.tr/Services/BasicIntegration',
  IZIBIZ: 'https://efaturaws.izibiz.com.tr/EInvoiceWS',
  FORIBA: 'https://api.fitbulut.com/servis',
  PARASUT: 'https://api.parasut.com/v4',
  MIKRO: 'https://apidocs.mikro.com.tr',
  ELOGO: 'https://pb.elogo.com.tr/postboxservice.svc',
  LOGO_ISBASI: 'https://api.isbasi.com',
  KOLAYSOFT: 'https://efatura.kolaysoft.com.tr',
  TURMOB_EFATURA: 'https://turmobefatura.luca.com.tr',
  TURKCELL: 'https://efaturaservice.turkcellesirket.com',
};

// Saglayicilara ozel kullanici yardim metinleri (UI'da entegrator eklerken gosterilir)
export const PROVIDER_AUTH_HINTS: Record<string, string> = {
  UYUMSOFT: "Uyumsoft kullanici adi ve sifresi yeterli. Servis URL otomatik dolar.",
  IZIBIZ: "Izibiz kullanici ve sifre, opsiyonel test/canli URL.",
  FORIBA: "Sovos Foriba bulut API icin kullanici ve sifre. URL Sovos tarafindan verilir.",
  PARASUT: "Parasut OAuth2: client_id (apiKey), client_secret (apiSecret), kullanici, sifre ve Firma No gerekir.",
  MIKRO: "Mikro API anahtari ile baglanir. apidestek@mikro.com.tr adresinden anahtar talep edin.",
  ELOGO: "eLogo web servis: Kullanıcı adı = eLogo panelindeki WEB SERVİS KULLANICI KODU (örn 3961368714), Şifre = web servis şifresi. Servis adresi otomatik (pb.elogo.com.tr). SMS gitmez.",
  LOGO_ISBASI: "Logo Isbasi API anahtari. developers.isbasi.com adresinden alin.",
  KOLAYSOFT: "Kolaysoft kullanici ve sifresi. Servis URL hesabiniza ozeldir.",
  TURMOB_EFATURA: "TÜRMOB e-Belge portalına mükellefin TCKN ve parolasıyla otomatik giriş yapılıp gelen/giden faturalar XML olarak çekilir (kod/2FA sormaz).",
  TURKCELL: "Turkcell e-Şirket (isim360): mükellefin panelinden (API Yönetimi > Yeni API Anahtarı) oluşturulan API anahtarını girin — ya da e-Şirket kullanıcı adı+şifresini yazın. Fatura çekerken SMS gitmez.",
  GIB_PORTAL: "GIB Portal: dogrudan API yok. Luca Local Agent veya mali muhur ile portal otomasyonu gerekir.",
};

const I2I_SOAP_PROVIDERS = new Set(['IZIBIZ', 'FORIBA']);
const GOODS_ACCOUNT_PREFIXES = ['150', '151', '152', '153', '157'];
const EXPENSE_ACCOUNT_PREFIXES = ['7'];
const SALES_ACCOUNT_PREFIXES = ['600', '601', '602'];
const REPORT_EPSILON = 0.005;
// VUK haddi (yeniden değerlemeyle YILLIK değişir; 2026 = 12.000 TL). Aynı had iki kuralda kullanılır:
//   (1) Demirbaş doğrudan-gider sınırı (VUK 313): bir iktisadi kıymetin KDV HARİÇ bedeli bu haddin
//       ALTINDAysa demirbaş (255) değil DOĞRUDAN GİDER (770) yazılabilir. Üstündeyse demirbaş.
//   (2) Tevkifat alt sınırı: kısmi tevkifata tabi içerikli işlemin KDV DAHİL bedeli bu haddi aşıyorsa
//       tevkifatlı düzenlenmelidir. Yeni yıl haddi değişince burayı GÜNCELLE.
const VUK_HAD_TL = 12_000;

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

/** aiClassifyAccounting / Multi çıktısı (tek belge sınıflandırması). */
type ClassifyResult = {
  giderTuru: string;
  kategori: string;
  isletmeKayitTuru: string;
  isletmeAltTuru: string;
  isletmeNeden: string;
  muhasebeNeden: string;
  kalemler?: Array<{ ad: string; tutar: number; oran: number }>;
  matrahHesapKodu?: string;
};

@Injectable()
export class FaturaMuhasebelestirmeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaturaMuhasebelestirmeService.name);
  // Eş zamanlı okuma: her Max-vision bir Claude Code alt-süreci açıyor; fırtına riskine karşı
  // sınıflandırma Max çağrısı ayrı, düşük bir kapıdan geçiyor (aşağıda classifyConcurrency).
  // Varsayılan 6 (HTML-hızlı/Azure-öncelik yolu Max'i çoğu belgede atladığı için yükseltildi).
  // INVOICE_OCR_CONCURRENCY ile ayarlanır.
  private readonly uploadOcrConcurrency = Math.max(1, Number(process.env.INVOICE_OCR_CONCURRENCY || 6));
  private uploadOcrActive = 0;
  // SINIFLANDIRMA MAX KAPISI: HTML-hızlı okuma Max'i ATLIYOR ama sınıflandırma (aiClassifyAccounting)
  //   yine Max alt-süreci doğuruyor. 6 belge aynı anda okununca 6 eşzamanlı Max alt-süreci →
  //   kısıtlı konteynerde 32s'de bitemeyip HEPSİ timeout (sonuc=NULL, kategori/hesap kodu BOŞ).
  //   Çözüm: sınıflandırma Max çağrısını okuma eşzamanlılığından BAĞIMSIZ, düşük bir kapıdan geçir
  //   (KDV Kontrol içerik denetimi de KDV_CONTENT_AUDIT_CONCURRENCY=2 ile sınırlı — aynı kanıt).
  //   1→3 (kullanıcı: "AI ile oku çok yavaş"): e-Fatura/e-Arşiv okuması UBL/HTML parse + Azure ile
  //   Max'i zaten atladığından okuma tarafı yükü düşük → sınıflandırmaya 3 slot açmak güvenli ve
  //   belirgin hızlanma sağlar. Konteyner zorlanır/timeout görülürse MAX_CLASSIFY_CONCURRENCY=1 yap.
  private readonly classifyConcurrency = Math.max(1, Number(process.env.MAX_CLASSIFY_CONCURRENCY || 3));
  // 90s: Max alt-süreci bu konteynerde ağır (~50-60s/çağrı, fırtına/yük altında daha da); 60s'de
  //   yavaş-ama-tamamlanan çağrılar timeout'a düşüp NULL veriyordu. 90s tavan margin sağlar (env ile ayarlanır).
  private readonly classifyTimeoutMs = Math.max(8000, Number(process.env.MAX_CLASSIFY_TIMEOUT_MS || 90000));
  private classifyActive = 0;
  private readonly classifyWaiters: Array<() => void> = [];
  private async acquireClassifySlot(): Promise<() => void> {
    if (this.classifyActive < this.classifyConcurrency) {
      this.classifyActive++;
    } else {
      await new Promise<void>((resolve) => this.classifyWaiters.push(resolve));
      // slot bekleyene DEVREDİLDİ — sayaç release tarafından korunuyor, burada artırılmaz.
    }
    return () => {
      const next = this.classifyWaiters.shift();
      if (next) next();              // slotu sıradakine devret (active sabit)
      else this.classifyActive--;    // bekleyen yok → slotu serbest bırak
    };
  }
  // TOPLU SINIFLANDIRMA: her belge için ayrı ~40-50s'lik Max alt-süreci tabandı (ilk belge bile 43s).
  //   Aynı mükellef+plan+yön grubundaki bekleyen istekleri kısa pencerede (debounce ya da batch dolunca)
  //   TEK Max çağrısında topla → alt-süreç sayısı ~N× azalır, en büyük hızlanma. Toplu çağrı başarısız/
  //   uyumsuz dönerse tek-tek (gate'li) fallback → kategori asla bozulmaz.
  // Parti 3: 6 belgelik tek prompt bu yavaş konteynerde 126s'de bitemeyip timeout'a düşüyordu (gözlemlendi);
  //   3 belge küçük prompt → tek Max çağrısı timeout'a sığar, yine alt-süreç sayısını ~3× azaltır. (env ayarlı)
  // HIZ: tek Max çağrısı ~50-60s (alt-süreç + kısıtlı konteyner). Belge başına AYRI çağrı yerine TOPLU
  //   (aiClassifyAccountingMulti) → daha az çağrı = belirgin hız. Batch eşzamanlılıkla dolduğundan
  //   (uploadOcrConcurrency) ikisi birlikte yükseltildi. Uyumsuz/timeout'ta tek-tek fallback güvenli.
  private readonly classifyBatchSize = Math.max(1, Number(process.env.MAX_CLASSIFY_BATCH || 6));
  private readonly classifyBatchDebounceMs = Math.max(0, Number(process.env.MAX_CLASSIFY_BATCH_MS || 1500));
  private readonly classifyBatchBuffers = new Map<string, {
    items: Array<{ contentText: string; resolve: (v: ClassifyResult | null) => void }>;
    timer: NodeJS.Timeout | null;
    shared: { mukellefBilgi: string; isIsletme: boolean; invoiceKind?: 'ALIS' | 'SATIS'; planAdaylar?: string };
  }>();
  private readonly uploadOcrActiveIds = new Set<string>(); // işlenmekte olan belge id'leri (resume çift-işlemesin)
  private ocrResumeTimer: NodeJS.Timeout | null = null;
  private ocrResuming = false;
  private readonly uploadOcrQueue: Array<{
    tenantId: string;
    documentId: string;
    buffer?: Buffer;
    // Bellek tavanı aşıldığında buffer kuyrukta tutulmaz; iş sırasında bu s3Key'den (depodan) okunur.
    s3Key?: string;
    // Bu işin bellekte tuttuğu buffer boyutu (varsa) — iş bitince bütçeden düşülür.
    bufferBytes?: number;
    originalName?: string;
    forceClaude?: boolean;
    // Mihsap'tan çekilen belgeler: buffer CDN'den lazy indirilir (210 buffer'i
    // bellekte tutmamak icin), yon-duyarli yevmiye uretilir.
    kind?: 'upload' | 'mihsap' | 'ai-read' | 'classify';
    mihsapInvoiceId?: string;
    invoiceKind?: 'ALIS' | 'SATIS';
  }> = [];
  // OCR kuyruğunda BELLEKTE tutulan toplam buffer boyutu + tavanı. Tavan aşılınca yeni buffer'lar
  //   bellekte tutulmaz, iş sırasında depodan (s3Key) okunur → 200×25MB gibi yüklerde OOM olmaz.
  private uploadOcrBufferedBytes = 0;
  private readonly uploadOcrBufferBudget = 512 * 1024 * 1024; // 512 MB

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly kdvControl: KdvControlService,
    private readonly earsivRender: EarsivRenderService,
    private readonly vendorMemory: VendorMemoryService,
    private readonly mihsapService: MihsapService,
    private readonly portalAutomation: PortalAutomationService,
    // KDV Raporu: devreden KDV önceki dönem BEYANNAMESİNDEN okunur.
    private readonly beyanKayitlari: BeyanKayitlariService,
    // WhatsApp servisi ÇAĞRI ANINDA çözülür (modül-düzeyi import DÖNGÜ yaratıp açılışı çökertiyordu).
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    // Sunucu restart'ı in-memory OCR kuyruğunu siler → "AI ile oku"ya basılmış ama henüz
    // okunmamış belgeler PENDING'de öksüz kalıyor (kullanıcı "okunamadı" görüyor). Başlangıçta
    // (kısa gecikme sonra, app tam ayağa kalksın) + periyodik olarak öksüzleri kurtar.
    setTimeout(() => { this.resumeStuckOcr().catch(() => {}); }, 35000);
    this.ocrResumeTimer = setInterval(() => { this.resumeStuckOcr().catch(() => {}); }, 300000);
    if (this.ocrResumeTimer.unref) this.ocrResumeTimer.unref();
    // YORUM/DENETÇİ SÜPÜRMESİ RESTART'TA DEVAM ETSİN: deploy her restartta çalışan süpürmeyi
    //   öldürüyordu ve yeni tetik (okuma bitişi / Kodları düzelt) gelene dek üretim DURUYORDU
    //   (kullanıcı: "hâlâ denetçi yorumunu göremiyorum"). Açılıştan 90sn sonra + her 10dk'da
    //   eksik kalanlar kaldığı yerden taranır (busy-kilidi ve okuma-kuyruğuna-yol-verme sweep'te).
    setTimeout(() => { void this.sweepRichYorumAllTenants().catch(() => {}); }, 90000);
    const sweepTimer = setInterval(() => { void this.sweepRichYorumAllTenants().catch(() => {}); }, 600000);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  /** Eksik zengin-yorum/denetçisi olan belgeleri barındıran TÜM tenant'lar için süpürmeyi tetikler. */
  private async sweepRichYorumAllTenants() {
    const grup: any[] = await (this.prisma as any).invoiceAccountingDocument.groupBy({
      by: ['tenantId'],
      where: { status: { in: ['READY', 'NEEDS_REVIEW'] } },
    }).catch(() => []);
    for (const g of grup) {
      await this.sweepRichYorum(String(g.tenantId)).catch(() => {});
    }
  }

  onModuleDestroy() {
    if (this.ocrResumeTimer) { clearInterval(this.ocrResumeTimer); this.ocrResumeTimer = null; }
  }

  /** Restart sonrası öksüz kalan PENDING/IN_PROGRESS belgeleri yeniden kuyruğa alır. Kuyrukta
   *  ya da işlenmekte olanları atlar (çift-işleme yok). FAILED (gerçek hata) belgelere dokunmaz →
   *  sonsuz döngü olmaz. Eş zamanlılık sınırı doğal throttle eder. */
  /** CLASSIFY kurtarmasında süreç başına belge başı tek deneme (boş dönen belge döngüye girmesin). */
  private clsRescued = new Set<string>();
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
      // CLASSIFY KURTARMA: restart bellek-içi kuyruğu silince XML-okuma sonrası 'classify' işleri
      //   (arka plan sınıflandırma) KAYBOLUYORDU — belge "okundu" ama kategori/giderTuru boş kalıp
      //   hesap eşleşmiyordu (Gökhan Akgöz: 3 okuma turu da deploy restart'ına denk geldi, 26 belge
      //   kategorisiz kaldı). Okunmuş ama SINIFLANMAMIŞ ALIŞ belgeleri yeniden classify kuyruğuna
      //   alınır. Süreç başına belge başı 1 deneme (clsRescued) — boş dönen belge döngüye girmesin.
      let c = 0;
      if (this.uploadOcrQueue.length < this.uploadOcrConcurrency) {
        const adaylar = await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: { status: { in: ['READY', 'NEEDS_REVIEW'] }, invoiceKind: 'ALIS' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, tenantId: true, ocrData: true },
          take: 200,
        }).catch(() => []);
        for (const d of adaylar as any[]) {
          const o: any = d.ocrData || {};
          // Sınıflanacak içerik: icerikMetni YA DA kalem adları (entegratör-XML'de icerikMetni yok).
          if (!String(o.icerikMetni || '').trim() && !(Array.isArray(o.kalemler) && o.kalemler.length)) continue;
          if (String(o.matrahKategori || o.kategori || '').trim() || String(o.giderTuru || '').trim()) continue; // zaten sınıflı
          if (this.clsRescued.has(d.id) || queued.has(d.id) || this.uploadOcrActiveIds.has(d.id)) continue;
          // Sınırsız büyümesin (uzun süren süreçte bellek sızıntısı) — tavana ulaşınca sıfırla; en
          //   kötü ihtimalle birkaç belge tekrar denenir (zararsız, boş dönenler yine elenecek).
          if (this.clsRescued.size >= 5000) this.clsRescued.clear();
          this.clsRescued.add(d.id);
          this.uploadOcrQueue.push({ tenantId: d.tenantId, documentId: d.id, kind: 'classify' });
          c++;
          if (c >= 30) break;
        }
        if (c) {
          this.logger.log(`CLASSIFY resume: ${c} okunmus-ama-siniflanmamis belge yeniden siniflandirma kuyruguna alindi`);
          this.drainUploadedOcrQueue();
        }
      }
      return n + c;
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
    '191.02.001', // Sorumlu Sıfatıyla İndirilecek KDV (tevkifatlı ALIŞ — ikinci 191 satırı)
  ];
  private async gateExistingDocsIfNoPlan(tenantId: string, taxpayerId?: string) {
    if (!taxpayerId) return;
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, taxpayerId, status: { not: 'APPROVED' } },
      select: { id: true },
    }).catch(() => []);
    if (!docs.length) return;
    const docIds = docs.map((d: any) => d.id);
    // Plan YOK → HİÇBİR kod geçerli olamaz (olmayan hesaba fiş kesilmez) → belgelerin TÜM kodlarını
    //   boşalt. Bu, yalnız sabit placeholder listesini değil, AI'ın plan-yokken ürettiği SAHTE/BİRLEŞMİŞ
    //   kodları da (ör. "153.01.001-TİCARİ MAL %20" — kod+ad yapışmış) temizler. Frontend "Hesap planı
    //   aktarılmamış" banner'ı sebebi açıklar; plan çekilip "Kodları düzelt" denince gerçek kodlar gelir.
    if (!planCodes) {
      await (this.prisma as any).invoiceAccountingLine.updateMany({
        where: { documentId: { in: docIds }, NOT: { accountCode: null } },
        data: { accountCode: null },
      }).catch(() => {});
      return;
    }
    // Plan VAR → yalnız planda OLMAYAN placeholder'ları boşalt (191.01.020 mükellefte yoksa temizle;
    //   gerçekten planda olan 320.01.001 vb. KORUNUR).
    const toClear = this.PLACEHOLDER_CODES.filter((c) => !planCodes.has(c));
    if (!toClear.length) return;
    await (this.prisma as any).invoiceAccountingLine.updateMany({
      where: { documentId: { in: docIds }, accountCode: { in: toClear } },
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
        // documentType da grupla → BANKA belgeleri alış/satış sayımından ayrılıp banka rozetlerine gider
        //   (eskiden invoiceKind SATIS olmadığı için hepsi pendingPurchase'a düşüyordu).
        by: ['taxpayerId', 'invoiceKind', 'status', 'documentType'],
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
      const isBank = String(row.documentType || '').toUpperCase().includes('BANKA');
      if (row.status === 'APPROVED') {
        if (isBank) current.approvedBank += count;
        else current.approvedInvoice += count;
      } else if (isBank) {
        current.pendingBank += count;
      } else if (row.invoiceKind === 'SATIS') {
        current.pendingSale += count;
      } else {
        current.pendingPurchase += count;
      }
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
      const isActive = row?.isActive !== false && taxpayerConfig?.isActive !== false;
      return {
        provider: item.provider,
        label: config.label || item.label,
        kind: item.kind,
        tone: item.tone,
        isActive,
        configured,
        connected: Boolean(configured && isActive),
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

    // config.taxpayers oku-değiştir-yaz: farklı mükelleflerin eşzamanlı düzenlemesinde kayıp güncelleme
    //   olmaması için transaction içinde config'i TAZE oku, yalnız bu mükellefin alanını birleştir, yaz.
    await (this.prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.integrationConnection.findUnique({
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
      await tx.integrationConnection.update({
        where: { tenantId_provider: { tenantId, provider } },
        data: { config },
      });
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

    // Eşzamanlı başka mükellef düzenlemesini ezmemek için transaction içinde TAZE oku → sil → yaz.
    return await (this.prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider } },
      });
      if (!existing) return { ok: true, deleted: false };

      const config = (existing.config || {}) as any;
      if (config.taxpayers && config.taxpayers[taxpayerKey]) {
        delete config.taxpayers[taxpayerKey];
      }

      const remaining = Object.keys(config.taxpayers || {});
      if (remaining.length === 0) {
        // FK: IntegrationJob.connection -> IntegrationConnection (onDelete: Cascade YOK).
        // Bağlantıya ait iş kaydı varsa satırı hard-delete etmek FK ihlali verir ("Kaldırılamadı").
        // İş varsa satırı silme; config'i boşalt + pasifle. İş yoksa güvenle sil.
        const jobCount = await tx.integrationJob.count({ where: { connectionId: existing.id } });
        if (jobCount === 0) {
          await tx.integrationConnection.delete({
            where: { tenantId_provider: { tenantId, provider } },
          });
        } else {
          await tx.integrationConnection.update({
            where: { tenantId_provider: { tenantId, provider } },
            data: { config, isActive: false },
          });
        }
      } else {
        await tx.integrationConnection.update({
          where: { tenantId_provider: { tenantId, provider } },
          data: { config },
        });
      }
      return { ok: true, deleted: true };
    });
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

    // HESAP PLANI DURUMU: bilanço mükellefinde hesap planı AKTARILMAMIŞSA eşleştirilecek hesap yoktur →
    //   her şey "eksik" görünür ama SEBEBİ belirsiz kalır. Kullanıcıya NET söyleyelim (banner). İşletme
    //   defterinde hesap planı OLMAZ (tek düzen muhasebe değil) → uyarı gösterme.
    let accountPlanMissing = false;
    if (opts.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: opts.taxpayerId, tenantId }, select: { defterTuru: true, mihsapDefterTuru: true } }).catch(() => null);
      if (!isIsletmeLedger(tp?.defterTuru, tp?.mihsapDefterTuru)) {
        accountPlanMissing = !(await this.hasAccountPlan(tenantId, opts.taxpayerId));
      }
    }

    return {
      total: docs.length,
      pending,
      alisPending,
      satisPending,
      // Bilanço mükellefinde hesap planı yok → eşleştirme yapılamaz (frontend uyarı banner'ı gösterir).
      accountPlanMissing,
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
   * İSABET PANOSU — dokunmasız işleme oranı. Dönem (faturaTarihi, YYYY-MM) bazlı:
   *   dokunmasiz          = hiçbir satırında kaynak='KULLANICI' olmayan ONAYLI belge (sistem tek başına bitirdi)
   *   kullaniciDuzeltmeli = en az bir KULLANICI satırlı onaylı belge (elle düzeltildi)
   *   boslukVar           = bekleyen (READY/NEEDS_REVIEW) belgelerden en az bir hesap kodu BOŞ satırı olan
   * Tek sorgu (belge + satır select), bellek içi sayım; take 5000 emniyet tavanı.
   */
  async isabetOzeti(
    tenantId: string,
    opts: { period?: string; taxpayerId?: string } = {},
  ) {
    const where: any = { tenantId, status: { in: ['APPROVED', 'READY', 'NEEDS_REVIEW'] } };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
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
      select: { status: true, lines: { select: { accountCode: true, kaynak: true } } },
      take: 5000,
    });
    // Tavan dolduysa sonuç SESSİZCE eksik olur → en azından uyar (belge sayısı 5000'i aşan dönem/mükellef).
    if (docs.length >= 5000) {
      this.logger.warn(`isabetOzeti: 5000 belge tavanına ulaşıldı (tenant=${tenantId}${opts.taxpayerId ? ' tp=' + opts.taxpayerId : ''}${opts.period ? ' donem=' + opts.period : ''}) — oran eksik hesaplanmış olabilir.`);
    }
    let dokunmasiz = 0, kullaniciDuzeltmeli = 0, boslukVar = 0;
    for (const d of docs) {
      const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
      if (String(d.status) === 'APPROVED') {
        if (lines.some((l) => String(l.kaynak || '') === 'KULLANICI')) kullaniciDuzeltmeli++;
        else dokunmasiz++;
      } else if (lines.some((l) => !String(l.accountCode || '').trim())) {
        boslukVar++;
      }
    }
    const toplam = dokunmasiz + kullaniciDuzeltmeli;
    return {
      toplam,
      dokunmasiz,
      kullaniciDuzeltmeli,
      boslukVar,
      dokunmasizOran: toplam ? Math.round((dokunmasiz / toplam) * 100) : 0,
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

    // ── BELGE-TABLOSU BİRLEŞTİRME: rapor eskiden YALNIZ e-Arşiv sorgu tablosundan (earsiv_faturalar)
    //    besleniyordu — entegratör (TÜRMOB/Uyumsoft) kaynaklı mükelleflerde tablo boş kalıp rapor
    //    "0 belge" gösteriyordu (Gökhan Akgöz vakası). Sorgu tablosunda OLMAYAN muhasebe belgeleri
    //    de aynı toplamlara katılır (fatura-no/kaynak eşleşenler ÇİFT sayılmaz). ──
    let mergedDocCount = 0;
    {
      const earsivIdSet = new Set(invoices.map((i: any) => String(i.id)));
      const earsivNoSet = new Set(invoices.map((i: any) => `${String(i.tip || '').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS'}|${String(i.faturaNo || '').trim().toUpperCase()}`));
      for (const doc of accountingDocs) {
        const kind = String(doc.invoiceKind || '').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
        const belgeNo = String(doc.belgeNo || '').trim().toUpperCase();
        const sourceRefId = String(doc.sourceRefId || '').trim();
        const inlineRefId = String(doc.s3Key || '').startsWith('earsiv-inline://') ? String(doc.s3Key || '').slice('earsiv-inline://'.length) : '';
        if ((sourceRefId && earsivIdSet.has(sourceRefId)) || (inlineRefId && earsivIdSet.has(inlineRefId))) continue;
        if (belgeNo && earsivNoSet.has(`${kind}|${belgeNo}`)) continue;
        const od: any = doc.ocrData || {};
        const vergiSum = (doc.lines || []).filter((l: any) => ['vergi', 'vergi-sorumlu'].includes(String(l.group || '').toLowerCase()))
          .reduce((s: number, l: any) => s + this.reportNumber(l.debit) + this.reportNumber(l.credit), 0);
        const matrahSum = (doc.lines || []).filter((l: any) => String(l.group || '').toLowerCase() === 'matrah')
          .reduce((s: number, l: any) => s + this.reportNumber(l.debit) + this.reportNumber(l.credit), 0);
        const base = this.reportNumber(od.matrah) || matrahSum;
        const vat = this.reportNumber(od.kdvTutari) || vergiSum;
        const total = this.reportNumber(doc.totalAmount) || base + vat;
        if (!(base > 0 || vat > 0 || total > 0)) continue;
        mergedDocCount += 1;
        const breakdown = this.normalizeReportBreakdown(od.kdvBreakdown, od.kdvOrani, base, vat);
        this.addReportVatBreakdown(vatByRate, kind, breakdown, base, vat);
        if (kind === 'SATIS') {
          sourceCounts.sales += 1;
          salesBase += base; salesVat += vat; salesTotal += total;
          this.addReportBucket(categories.sales, base, vat, total);
          this.addReportCounterparty(topCustomers, { name: doc.customerName || 'Bilinmeyen alıcı', taxNo: doc.buyerVkn, base, vat, total });
        } else {
          sourceCounts.purchase += 1;
          purchaseBase += base; purchaseVat += vat; purchaseTotal += total;
          this.addReportCounterparty(topSuppliers, { name: doc.vendorName || 'Bilinmeyen satıcı', taxNo: doc.sellerVkn, base, vat, total });
          const classified = this.classifyPurchaseInvoiceForReport(doc, { base, vat, total });
          for (const row of classified) this.addReportBucket(categories[row.key], row.base, row.vat, row.total, row.count);
          if (classified.some((row) => row.key === 'unclassified' && Math.abs(row.base) > REPORT_EPSILON)) unclassifiedPurchaseInvoiceCount += 1;
        }
      }
    }

    // ── ÖNCEKİ DÖNEMDEN DEVREDEN KDV — kaynak: önceki dönemin GERÇEK KDV1 BEYANNAMESİ
    //    ("Sonraki Döneme Devreden KDV" satırı, Beyannameler modülü PDF'inden). Bulunamazsa null
    //    (uydurulmaz); değerlendirme notu düşülür. ──
    const oncekiDonem = (() => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    let devredenOnceki: { tutar: number; donem: string; kaynak: string } | null = null;
    try {
      const dv = await this.beyanKayitlari.getSonrakiDonemeDevreden(tenantId, taxpayerId, oncekiDonem);
      if (dv) devredenOnceki = { tutar: this.roundReportMoney(dv.tutar), donem: oncekiDonem, kaynak: 'beyanname' };
    } catch (e: any) {
      this.logger.warn(`KDV raporu devreden okunamadı (tp=${taxpayerId} donem=${oncekiDonem}): ${e?.message || e}`);
    }

    const missingAccountCodeCount = accountingDocs.filter((doc: any) => {
      const lines = Array.isArray(doc.lines) ? doc.lines : [];
      const relevant = lines.filter((line: any) => ['matrah', 'vergi', 'vergi-sorumlu'].includes(String(line.group || '').toLowerCase()));
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
      // Önceki dönem beyannamesindeki devreden bulunduysa TAHMİNİ sonuç hesaplanır
      // (fark − devreden): pozitif = ödenecek yönü, negatif = sonraki döneme devreden.
      prevCarryForwardVat: devredenOnceki ? devredenOnceki.tutar : null,
      payableVat: devredenOnceki ? this.roundReportMoney(Math.max(0, salesVat - purchaseVat - devredenOnceki.tutar)) : null,
      carryForwardVat: devredenOnceki ? this.roundReportMoney(Math.max(0, -(salesVat - purchaseVat - devredenOnceki.tutar))) : null,
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
      // invoiceCount = sorgu tablosu satırları + oradan gelmeyen (entegratör) muhasebe belgeleri.
      invoiceCount: invoices.length + mergedDocCount,
      mergedDocCount,
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
      // Önceki dönem KDV1 beyannamesinden okunan devreden (kaynak: beyanname PDF'i).
      devreden: devredenOnceki,
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
      // NOT: Ba/Bs taslağı KALDIRILDI — Ba/Bs bildirimi artık verilmiyor (kullanıcı, 2026-07-19).
      quality,
      controls,
      warnings: controls.warnings,
      assessment: [] as string[],
    };

    report.assessment = this.buildKdvClientAssessment(report);
    return report;
  }

  /** KDV Raporu → mükellefe WHATSAPP bilgilendirme. dryRun=true: göndermez, mesaj+telefon önizlemesi
   *  döner (kullanıcı modalda görüp ONAYLAR — onaysız mükellefe mesaj gitmez). Telefon: mükellef
   *  kartındaki phone/phones; yoksa 400. */
  async kdvRaporuWhatsapp(tenantId: string, opts: { taxpayerId?: string; period?: string; dryRun?: boolean; telefon?: string }) {
    const report: any = await this.kdvClientReport(tenantId, { taxpayerId: opts.taxpayerId, period: opts.period });
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: String(opts.taxpayerId || ''), tenantId },
      select: { phone: true, phones: true },
    });
    const telefon = String(opts.telefon || tp?.phone || (Array.isArray(tp?.phones) ? tp.phones[0] : '') || '').trim();
    if (!telefon) throw new BadRequestException('Mükellef kartında telefon numarası yok — önce mükellef kartına telefon ekleyin.');

    const t = report.totals || {};
    const para = (n: any) => this.formatReportMoney(this.reportNumber(n));
    const satirlar: string[] = [
      '*MOREN MALİ MÜŞAVİRLİK*',
      `📊 *KDV Bilgilendirme — ${report.periodLabel}*`,
      '',
      `Sayın *${report.taxpayer?.name || 'Mükellefimiz'}*,`,
      `${report.periodLabel} dönemi fatura kayıtlarınıza göre ön KDV durumunuz:`,
      '',
      `🧾 Satış: *${report.quality?.sourceCounts?.sales ?? 0} fatura* · Matrah ${para(t.salesBase)} ₺ · KDV ${para(t.salesVat)} ₺`,
      `📥 Alış/Gider: *${report.quality?.sourceCounts?.purchase ?? 0} fatura* · Matrah ${para(t.purchaseBase)} ₺ · KDV ${para(t.purchaseVat)} ₺`,
    ];
    if (report.devreden) {
      satirlar.push(`↪️ Önceki dönemden devreden KDV (beyanname): ${para(report.devreden.tutar)} ₺`);
      const pay = this.reportNumber(t.payableVat);
      satirlar.push('', pay > 0
        ? `💰 *Ödenecek KDV (tahmini): ~${para(pay)} ₺*`
        : `↪️ *Sonraki döneme devreden KDV (tahmini): ~${para(t.carryForwardVat)} ₺* (ödeme çıkmıyor)`);
    } else {
      satirlar.push('', `📌 Dönem KDV farkı: ${para(t.periodVatDifference)} ₺ (devreden KDV beyanname kaydı olmadığından hesaba katılmadı)`);
    }
    satirlar.push('', 'ℹ️ Bu bilgilendirme beyan öncesi *taslaktır*; kesin tutarlar beyanname ile netleşir.', 'Sorularınız için bize yazabilirsiniz. 🙏');
    const mesaj = satirlar.join('\n');

    if (opts.dryRun) return { ok: true, dryRun: true, telefon, mesaj };
    // WhatsApp servisi ÇAĞRI ANINDA çözülür — statik import Fatura→WhatsApp→Calisan→Luca→Fatura
    //   dosya döngüsü yaratıp açılışı çökertiyordu (2026-07-19 Railway kesintisi).
    const { WhatsAppService } = await import('../whatsapp/whatsapp.service');
    const whatsapp = this.moduleRef.get(WhatsAppService, { strict: false });
    const sonuc = await whatsapp.sendMessageDetailed(telefon, mesaj, tenantId);
    this.logger.log(`[KDV-RAPOR-WA] tp=${opts.taxpayerId} donem=${report.period} tel=${telefon.slice(0, 4)}*** ok=${sonuc.ok}${sonuc.ok ? '' : ' hata=' + (sonuc.error || sonuc.errorCode || '?')}`);
    if (!sonuc.ok) throw new BadRequestException(`WhatsApp gönderilemedi: ${sonuc.error || sonuc.errorCode || 'bilinmeyen hata'}`);
    // Sohbet geçmişine GİDEN mesaj olarak kaydet → portal "WhatsApp Mesajlar" ekranında görünsün.
    //   Ekran communicationLog (channel=WHATSAPP) okur; subject "gelen" İÇERMEZ (giden), content
    //   başına [[wa_phone:...]] (telefon eşleşmesi). Kayıt hatası gönderimi bozmasın.
    let waPhone = String(telefon).replace(/\D/g, '');
    if (waPhone.startsWith('0')) waPhone = '90' + waPhone.slice(1);
    else if (waPhone && !waPhone.startsWith('90')) waPhone = '90' + waPhone;
    await (this.prisma as any).communicationLog
      .create({
        data: {
          taxpayerId: String(opts.taxpayerId || ''),
          channel: 'WHATSAPP',
          subject: 'WhatsApp KDV bilgilendirmesi',
          content: `[[wa_phone:${waPhone}]]${mesaj}`,
          occurredAt: new Date(),
        },
      })
      .catch(() => undefined);
    return { ok: true, telefon };
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

    lines.push(`Genel tablo: Bu dönem ${quality.invoiceCount} fatura işlendi — ${this.formatReportMoney(sales)} TL satış, ${this.formatReportMoney(purchase)} TL alış ve gider faturası görünmektedir.`);
    if (diff > REPORT_EPSILON) {
      lines.push(`KDV yönü: Fatura kayıtlarına göre hesaplanan KDV, indirilecek KDV'den ${this.formatReportMoney(diff)} TL fazla; dönem içi ödeme yönü oluşmaktadır.`);
    } else if (diff < -REPORT_EPSILON) {
      lines.push(`KDV yönü: Fatura kayıtlarına göre indirilecek KDV, hesaplanan KDV'den ${this.formatReportMoney(Math.abs(diff))} TL fazla; dönem içi devreden yönü oluşmaktadır.`);
    } else {
      lines.push('KDV yönü: Fatura kayıtlarına göre hesaplanan ve indirilecek KDV birbirine çok yakın görünmektedir.');
    }

    // Devreden KDV — önceki dönem BEYANNAMESİNDEN okunur; bulunduysa tahmini sonuç cümlesi kurulur.
    if (report.devreden) {
      const pay = this.reportNumber(totals.payableVat);
      const carry = this.reportNumber(totals.carryForwardVat);
      const sonucCumle = pay > REPORT_EPSILON
        ? `bu dönem için TAHMİNİ ödenecek KDV ${this.formatReportMoney(pay)} TL yönündedir`
        : `devreden KDV büyüyerek TAHMİNİ ${this.formatReportMoney(carry)} TL olarak sonraki döneme taşınmaktadır`;
      lines.push(`Devreden KDV: Önceki dönem (${this.reportPeriodLabel(report.devreden.donem)}) beyannamesinden devreden ${this.formatReportMoney(report.devreden.tutar)} TL dikkate alındığında ${sonucCumle}.`);
    } else {
      lines.push('Devreden KDV: Önceki dönem KDV beyannamesi sistemde bulunamadığından devreden tutar hesaba katılamadı; kesin sonuç için beyanname kaydı gereklidir.');
    }

    // KDV oran kırılımı — satış tarafının orana dağılımı tek cümlede.
    const satisOranlar = (report.vatByRate || []).filter((r: any) => r.side === 'SATIS' && this.reportNumber(r.vat) > REPORT_EPSILON);
    if (satisOranlar.length > 1) {
      const parcalar = satisOranlar.map((r: any) => `%${r.rate}: ${this.formatReportMoney(this.reportNumber(r.vat))} TL`).join(', ');
      lines.push(`Oran kırılımı: Hesaplanan KDV oranlara göre ${parcalar} şeklinde dağılmaktadır.`);
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
    // İş kalitesi — bekleyen onay + eksik kod + sınıflandırma tek cümlede (varsa).
    if (quality.pendingReviewCount > 0 || quality.missingAccountCodeCount > 0 || unclassified > REPORT_EPSILON) {
      const parcalar: string[] = [];
      if (quality.pendingReviewCount > 0) parcalar.push(`${quality.pendingReviewCount} belge onay bekliyor`);
      if (quality.missingAccountCodeCount > 0) parcalar.push(`${quality.missingAccountCodeCount} belgede hesap kodu eksik`);
      if (quality.unclassifiedCount > 0) parcalar.push(`${quality.unclassifiedCount} alış faturası sınıflandırma bekliyor`);
      lines.push(`İş kalitesi: ${parcalar.join(', ')} — rakamlar bu belgeler tamamlandığında değişebilir.`);
    }
    if ((controls.warnings || []).length > 0) {
      lines.push(`KDV kontrol notu: ${controls.warnings[0]} Bu uyarılar netleşmeden rapor nihai beyan sonucu gibi değerlendirilmemelidir.`);
    } else {
      lines.push('Not: Bu rapor fatura kayıtlarına göre hazırlanan BEYAN ÖNCESİ taslaktır; tevkifat, istisna ve beyanname düzeltmeleri kesin beyanla netleşir.');
    }
    return lines.slice(0, 9);
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

    // Eşzamanlı iki mükellef kaydı config.taxpayers'ı oku-değiştir-yaz yaparken birbirini eziyordu.
    //   Transaction içinde config'i TAZE oku, DİĞER mükelleflerin taxpayers girdilerini koruyarak
    //   yalnız bu mükellefin (ve gerekiyorsa global) girdisini birleştir, sonra yaz.
    await (this.prisma as any).$transaction(async (tx: any) => {
      const fresh = await tx.integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider } },
        select: { config: true },
      });
      const freshConfig = ((fresh?.config || {}) as any) || {};
      const config = {
        version: 1,
        provider,
        label: String(input.label || freshConfig.label || currentConfig.label || catalog.label).trim(),
        kind: catalog.kind,
        taxpayers: {
          ...(freshConfig.taxpayers || {}),
          ...(provider === 'PARASUT' && (apiKey || apiSecret) ? { global: nextGlobal } : {}),
          [taxpayerKey]: nextTaxpayer,
        },
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || null,
      };
      await tx.integrationConnection.upsert({
        where: { tenantId_provider: { tenantId, provider } },
        update: { config, isActive: input.isActive !== false },
        create: { tenantId, provider, config, isActive: input.isActive !== false },
      });
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
    const mode = input.mode === 'query' ? 'query' : 'download';
    // SERBEST TARİH ARALIĞI (Mihsap örneği — kullanıcı talebi): dateFrom/dateTo verildiyse AY bazlı
    //   monthRange'i (1 ayla sınırlı) bypass et — sorgu gerçek başlangıç/bitiş gününe göre çalışır.
    //   period.donem yalnız ETİKETLEME amaçlı (job payload/log mesajı); aralık startDate/endDate'ten gelir.
    const ymdOk = (s: any) => {
      const v = String(s || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const dd = new Date(`${v}T00:00:00.000Z`); // gerçek takvim kontrolü (2026-13-45 elensin)
      return !Number.isNaN(dd.getTime()) && dd.toISOString().slice(0, 10) === v;
    };
    const dateFromOk = ymdOk(input.dateFrom);
    const dateToOk = ymdOk(input.dateTo);
    // Aralık VERİLDİYSE ama geçersizse (tek alan / bozuk biçim / ters aralık) SESSİZCE aya düşme —
    //   kullanıcı 15-20 Mayıs istemişken habersizce içinde bulunulan ay sorgulanıyordu.
    if ((String(input.dateFrom || '').trim() || String(input.dateTo || '').trim())
      && !(dateFromOk && dateToOk && String(input.dateFrom) <= String(input.dateTo))) {
      throw new BadRequestException('Tarih aralığı geçersiz: başlangıç ve bitiş YYYY-AA-GG biçiminde olmalı ve başlangıç bitişten büyük olamaz.');
    }
    const period = (dateFromOk && dateToOk && String(input.dateFrom) <= String(input.dateTo))
      ? { donem: `${input.dateFrom}_${input.dateTo}`, startDate: String(input.dateFrom), endDate: String(input.dateTo) }
      : this.monthRange(input.donem);
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

    const totals = { created: 0, alreadyQueued: 0, failed: 0, skipped: 0, fetched: 0 };
    const shouldTryGibPortal = !requestedProviders.size || requestedProviders.has('GIB_PORTAL');
    const gibPortalStatus: any[] = [];
    if (shouldTryGibPortal) {
      if (direction !== 'SATIS') {
        gibPortalStatus.push({
          provider: 'GIB_PORTAL',
          label: 'GIB Portal',
          status: 'SKIPPED',
          reason: 'GIB e-Arsiv portal cekimi simdilik firmalarin kestigi satis faturalarini indirir',
        });
        totals.skipped++;
      } else {
        const gibCred = await (this.prisma as any).portalCredential.findFirst({
          where: {
            tenantId,
            provider: 'GIB_IVD',
            ownerType: 'TAXPAYER',
            ownerId: taxpayerId,
            isActive: true,
          },
          select: { id: true, userCode: true, encryptedPassword: true, encryptedSecondaryPassword: true },
        });
        if (!gibCred || !gibCred.userCode || !(gibCred.encryptedSecondaryPassword || gibCred.encryptedPassword)) {
          gibPortalStatus.push({
            provider: 'GIB_PORTAL',
            label: 'GIB Portal',
            status: 'SKIPPED',
            reason: 'Mukellef kartinda GIB vergi dairesi kullanici kodu/sifresi yok',
          });
          totals.skipped++;
        } else {
          const portalRun = await this.portalAutomation.manualRun(tenantId, userId || null, {
            jobTypes: ['EARSIV_PORTAL_FETCH'],
            taxpayerIds: [taxpayerId],
            dateFrom: period.startDate,
            dateTo: period.endDate,
            donem: period.donem,
            force: true,
            earsivMode: mode,
            selectedRefs: Array.isArray(input.selectedRefs) ? input.selectedRefs : undefined,
          });
          const createdCount = Array.isArray((portalRun as any).created) ? (portalRun as any).created.length : 0;
          const skippedCount = Array.isArray((portalRun as any).skipped) ? (portalRun as any).skipped.length : 0;
          gibPortalStatus.push({
            provider: 'GIB_PORTAL',
            label: 'GIB Portal',
            status: createdCount > 0 ? 'QUEUED_GIB_PORTAL' : 'SKIPPED',
            queued: createdCount,
            skipped: skippedCount,
            reason: createdCount > 0
              ? (mode === 'query'
                ? `GIB e-Arsiv satis sorgusu kuyruğa alindi (${period.donem}); liste satirlari ekranda gorunecek`
                : `GIB e-Arsiv satis aktarimi kuyruğa alindi (${period.donem}); secili/uygun faturalar indirilecek`)
              : ((portalRun as any).skipped?.[0]?.reason || 'GIB portal isi olusturulamadi'),
            jobs: (portalRun as any).created || [],
          });
          if (createdCount > 0) totals.fetched += createdCount;
          else totals.skipped++;
        }
      }
    }

    const rows = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        provider: {
          in: INTEGRATOR_CATALOG.filter((item) => item.provider !== 'LUCA' && item.provider !== 'GIB_PORTAL').map((item) => item.provider) as any,
        },
      },
      select: { id: true, provider: true, config: true, isActive: true },
    });
    const byProvider = new Map<string, any>(rows.map((row: any) => [String(row.provider), row]));
    const providers = INTEGRATOR_CATALOG.filter((item: any) => {
      if (item.provider === 'LUCA') return false;
      if (item.provider === 'GIB_PORTAL') return false;
      if (requestedProviders.size && !requestedProviders.has(item.provider)) return false;
      return true;
    });

    const statuses: any[] = [...gibPortalStatus];

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

    // Boş plan → READY YAZMA. Aksi halde "hazır ama 0 satır" snapshot getPlanCodeSet'te seçilip
    //   bir daha çekilmez; kodlar hiç eşleşmez. status='EMPTY' (READY dışı) → sorgular seçmez.
    if (!rows.length) {
      const empty = await (this.prisma as any).lucaAccountPlanSnapshot.create({
        data: {
          tenantId: params.tenantId,
          taxpayerId: params.taxpayerId,
          sourceJobId: params.jobId || null,
          status: 'EMPTY',
          accountCount: 0,
          createdBy: params.createdBy || null,
        },
        select: { id: true },
      });
      return { snapshotId: empty.id, accountCount: 0 };
    }
    // Satırları snapshot ile TEK transaction'da yaz: createMany patlarsa snapshot da geri alınır →
    //   yarım/0-satırlı READY plan kalmaz (eskiden READY snapshot önce, satırlar sonra yazılıyordu).
    const snapshot = await (this.prisma as any).$transaction(async (tx: any) => {
      const snap = await tx.lucaAccountPlanSnapshot.create({
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
      await tx.lucaAccountPlanLine.createMany({
        data: rows.map((r) => ({ ...r, snapshotId: snap.id })),
      });
      return snap;
    });
    // AI-EŞLEŞTİRME ARKA PLANDA (kullanıcı bulgusu — "hesap planı çekildiği halde iş bitmiyor"):
    //   rematch, bekleyen fatura başına Max çağrısı yapıyor (50'ye kadar × ~saniyeler) → eskiden
    //   upload isteğini await ile DAKİKALARCA blokluyordu; upload dönmeyince job 'done' işaretlenmiyor,
    //   Luca ajanı panelinde iş "çalışıyor" kalıyordu (hatta 10dk upload timeout'una düşebiliyordu).
    //   Snapshot zaten READY yazıldı → HEMEN dön (job biter), eşleştirme arka planda sürsün.
    void this.rematchPendingDocumentsWithAccountPlan(params.tenantId, params.taxpayerId, snapshot.id).catch(() => undefined);
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
        this.enqueueUploadedDocumentOcr(tenantId, doc.id, file.buffer, file.originalname, opts.forceClaude, s3Key);
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
    s3Key?: string,
  ) {
    const size = buffer?.length || 0;
    // Buffer zaten depoya (s3Key) yazıldı. Bellek bütçesi varsa hızlı yol (buffer'ı kuyrukta tut);
    //   tavan aşılırsa buffer'ı TUTMA → iş sırasında depodan lazy oku (OOM koruması).
    if (s3Key && this.uploadOcrBufferedBytes + size > this.uploadOcrBufferBudget) {
      this.logger.warn(`OCR kuyruğu bellek tavanı (${Math.round(this.uploadOcrBufferBudget / 1e6)}MB) aşıldı → ${documentId} buffer'ı bellekte tutulmuyor, depodan okunacak`);
      this.uploadOcrQueue.push({ tenantId, documentId, originalName, forceClaude, s3Key });
    } else {
      this.uploadOcrBufferedBytes += size;
      this.uploadOcrQueue.push({ tenantId, documentId, buffer, bufferBytes: size, originalName, forceClaude, s3Key });
    }
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
            job.buffer,
            String(job.originalName || ''),
            job.forceClaude,
            job.s3Key,
          );
      void work
        .catch((e: any) => {
          this.logger.error(`Belge OCR arka plan islemi basarisiz (${job.documentId}): ${e?.message || e}`);
        })
        .finally(() => {
          // Bu işin bellekte tuttuğu buffer bütçesini serbest bırak.
          if (job.bufferBytes) this.uploadOcrBufferedBytes = Math.max(0, this.uploadOcrBufferedBytes - job.bufferBytes);
          this.uploadOcrActive = Math.max(0, this.uploadOcrActive - 1);
          if (job.documentId) this.uploadOcrActiveIds.delete(job.documentId);
          this.drainUploadedOcrQueue();
          // OKUMA KUYRUĞU BOŞALINCA yorum+denetçi ÖN-ÜRETİMİ: kullanıcı belgeyi açmadan hazır olsun
          //   (kullanıcı: "detaya tıklayınca değerlendirmeyi/denetçiyi hemen göremiyorum").
          if (this.uploadOcrActive === 0 && this.uploadOcrQueue.length === 0) {
            void this.sweepRichYorum(job.tenantId).catch(() => {});
          }
        });
    }
  }

  /** YORUM + DENETÇİ ÖN-ÜRETİMİ (arka plan): zengin AI değerlendirmesi ve Katman-2 denetçi kararı
   *  eskiden yalnız belge AÇILINCA (lazy) üretiliyordu → toplu okuma sonrası her belgede ~15sn
   *  bekleme. Artık okuma kuyruğu boşalınca ve "Kodları düzelt" sonrası eksik olanlar arka planda
   *  SIRAYLA üretilir (Max yükü için eşzamanlılık 1; okuma kuyruğuna yeni iş gelirse süpürme durur,
   *  okuma biter bitmez kaldığı yerden tetiklenir). */
  private richSweepBusy = new Set<string>();
  private async sweepRichYorum(tenantId: string) {
    if (this.richSweepBusy.has(tenantId)) return;
    this.richSweepBusy.add(tenantId);
    try {
      const docs: any[] = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: { tenantId, status: { in: ['READY', 'NEEDS_REVIEW'] } },
        select: { id: true, ocrData: true, lines: { select: { group: true, accountCode: true } } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 300,
      }).catch(() => []);
      const bekleyen = docs.filter((d) => {
        const ocr: any = d.ocrData || {};
        const zenginVar = !!String(ocr.muhasebeNedenZengin || '').trim();
        const matrahVar = (d.lines || []).some((l: any) => String(l.group || '') === 'matrah' && String(l.accountCode || '').trim());
        return matrahVar && !zenginVar; // (AI denetçi kaldırıldı — yalnız zengin yorum eksikse üret.)
      });
      if (!bekleyen.length) return;
      this.logger.log(`[YORUM-SWEEP] ${bekleyen.length} belge için zengin yorum arka planda üretiliyor (tenant=${tenantId})`);
      // 4 PARALEL üretim (kullanıcı: "o kadar bekleyemem") — içerik-denetimi deneyimi: kısa tek-belge
      //   Max çağrılarında CONCURRENCY=4 güvenli; batch'leme ters tepmişti, o yüzden çağrılar tekil kalır.
      const ESZAMANLI = 4;
      let idx = 0;
      let uretilen = 0;
      let durdu = false;
      const isci = async () => {
        while (!durdu) {
          // Okuma kuyruğuna yeni iş geldiyse ona yol ver — süpürme sonraki tetikte devam eder.
          if (this.uploadOcrQueue.length || this.uploadOcrActive) { durdu = true; break; }
          const i = idx++;
          if (i >= bekleyen.length) break;
          await this.generateRichMuhasebeNeden(tenantId, bekleyen[i].id, true).catch(() => {});
          uretilen++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(ESZAMANLI, bekleyen.length) }, () => isci()));
      this.logger.log(`[YORUM-SWEEP] ${uretilen}/${bekleyen.length} belge tamamlandı (tenant=${tenantId})`);
    } finally {
      this.richSweepBusy.delete(tenantId);
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
      select: { id: true, taxpayerId: true, invoiceKind: true, documentType: true, vendorName: true, customerName: true, ocrData: true },
    }).catch(() => null);
    if (!doc) return;
    const od: any = doc.ocrData || {};
    let content = String(od.icerikMetni || '');
    if (!content || content.length < 20) {
      // İÇERİK YEDEĞİ: entegratör-XML belgelerinde icerikMetni yazılmıyor (okuma Max'i atlıyor) —
      //   sınıflandırma hiç çalışmadan çıkıyordu (Gökhan Akgöz: kategori/giderTuru kalıcı boş).
      //   Kalem adları + satıcı ünvanından içerik kurulur; sınıflandırma bunlarla çalışır.
      const kalemAd = (Array.isArray(od.kalemler) ? od.kalemler : [])
        .map((k: any) => String(k?.ad || '').trim()).filter(Boolean).slice(0, 30).join('; ');
      const taraf = String(doc.vendorName || doc.customerName || '').trim();
      content = [taraf ? `Satıcı: ${taraf}` : '', kalemAd ? `Fatura kalemleri: ${kalemAd}` : ''].filter(Boolean).join('\n');
    }
    if (!content || content.length < 20) return;
    let mukellefBilgi = '';
    let isIsletme = false;
    let qcNace = '';
    let qcFaaliyet = '';
    if (doc.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: doc.taxpayerId, tenantId },
        select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true, defterTuru: true, mihsapDefterTuru: true },
      }).catch(() => null);
      if (tp) {
        isIsletme = isIsletmeLedger(tp.defterTuru, tp.mihsapDefterTuru);
        qcNace = String(tp.naceKodu || '').trim();
        qcFaaliyet = String(tp.faaliyetAciklama || '').trim();
        const ad = String(tp.companyName || (String(tp.firstName || '') + ' ' + String(tp.lastName || ''))).trim();
        mukellefBilgi = [ad && ('ünvanı "' + ad + '"'), qcFaaliyet ? ('faaliyeti: ' + qcFaaliyet) : (qcNace ? ('NACE ' + qcNace) : ''), isIsletme ? 'İşletme defteri' : 'Bilanço usulü'].filter(Boolean).join(', ');
      }
    }
    const kind = doc.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS';
    // ⚡ DETERMİNİSTİK ATLAMA (bkz. aiReadDocument): kalemlerin HEPSİ tanınan gider ise ~100s Max'i atla.
    let detC: any = null;
    {
      const detAdlar = (Array.isArray(od.kalemler) ? od.kalemler : []).map((k: any) => String(k?.ad || '').trim()).filter(Boolean);
      if (!isIsletme && kind !== 'SATIS' && detAdlar.length) {
        let cat = ''; let ok = true;
        for (const ad of detAdlar) { const r = giderIcerikSinifla(ad); if (!r) { ok = false; break; } if (!cat) cat = r.kategori; else if (cat !== r.kategori) { ok = false; break; } }
        if (ok) { const whole = giderIcerikSinifla(detAdlar.join(' ')); if (whole) detC = { giderTuru: whole.hint, kategori: whole.kategori }; }
      }
    }
    const c = detC || await this.aiClassifyAccounting(content, mukellefBilgi, isIsletme, kind).catch(() => null);
    if (detC) this.logger.log(`[CLS-SKIP] det icerik=${detC.kategori} → Max ATLANDI doc=${documentId}`);
    const patch: any = { ...od };
    delete patch.icerikMetni; delete patch.needsClassify; // snippet'i temizle (DB bloat olmasın)
    if (c) {
      if (c.giderTuru) patch.giderTuru = String(c.giderTuru).slice(0, 40);
      if (c.kategori) patch.matrahKategori = c.kategori;
      // userEdited korunur: kullanıcı işletme sınıfını elle düzelttiyse sınıflandırma yeniden EZMEZ
      //   (backfill'deki korumanın buradaki simetriği — eksikti, elle düzeltme kaybolabiliyordu).
      if (isIsletme && od?.isletme?.userEdited !== true) {
        let isl = (c.isletmeKayitTuru || c.giderTuru || c.kategori)
          ? resolveIslAi(kind, { isletmeKayitTuru: c.isletmeKayitTuru, isletmeAltTuru: c.isletmeAltTuru, isletmeNeden: c.isletmeNeden, giderTuru: c.giderTuru, kategori: c.kategori })
          : null;
        // ÖĞRENİLMİŞ İŞLETME SINIFI (kullanıcı-teyitli, eşikli) — AI/kural tahminini ezer.
        {
          const islVkn = String((kind === 'ALIS' ? (doc as any).sellerVkn : (doc as any).buyerVkn) || '').replace(/\D/g, '');
          const islMemImza = VendorMemoryService.buildIcerikImza(Array.isArray(od?.kalemler) ? od.kalemler.map((k: any) => k?.ad) : []);
          const islMem = (islVkn && (doc as any).taxpayerId)
            ? await this.pickIsletmeMemory(tenantId, (doc as any).taxpayerId, islVkn, islMemImza).catch(() => null)
            : null;
          if (islMem) {
            const memRef = isletmeRef(kind);
            const memKt = memRef.kayitTuru.find((x: any) => x.kod === islMem.kayitTuruKod);
            if (memKt) {
              const memAltList = getKayitAltList(kind, islMem.kayitTuruKod);
              const memAlt = islMem.kayitAltKod ? memAltList.find((x: any) => x.kod === islMem.kayitAltKod) : null;
              isl = {
                kayitTuruKod: memKt.kod, kayitTuruAd: memKt.ad,
                kayitAltKod: memAlt?.kod || '', kayitAltAd: memAlt?.ad || '',
                autoMatched: true, neden: 'Bu satıcı için öğrenilmiş sınıf (müşavir onaylı)',
              };
            }
          }
        }
        // Son care fallback: alista yalniz icerik sinyaliyle; satista faaliyet+NACE ile.
        if (!isl) {
          const firma = kind === 'ALIS' ? String((doc as any).vendorName || '') : String((doc as any).customerName || '');
          const gs = kind === 'ALIS'
            ? isletmeGiderSinifi({ matrahKategori: c.kategori, giderTuru: c.giderTuru, vendorName: firma, documentType: normalizeDocumentType((doc as any).documentType || od?.belgeTuru || od?.documentType) || (doc as any).documentType })
            : null;
          const fbKtKod = kind === 'ALIS' ? (gs?.kayitTuruKod || '') : isletmeAutoKayitTuru(kind, qcNace || null, qcFaaliyet || null);
          if (fbKtKod) {
            const ref = isletmeRef(kind);
            const fbKt = ref.kayitTuru.find((x: any) => x.kod === fbKtKod);
            if (fbKt) {
              const islText2 = [c.giderTuru, firma].filter(Boolean).join(' ');
              const fbAltKod = gs?.kayitAltKod || (fbKtKod === '4' ? isletmeAutoKayitAltKod(kind, '4', islText2) : (defaultKayitAltKod(kind, fbKtKod, fbKt.ad) || ''));
              const altList = getKayitAltList(kind, fbKtKod);
              const fbAlt = fbAltKod ? altList.find((x: any) => x.kod === fbAltKod) : null;
              isl = { kayitTuruKod: fbKtKod, kayitTuruAd: fbKt.ad, kayitAltKod: fbAlt?.kod || '', kayitAltAd: fbAlt?.ad || '', autoMatched: true, neden: 'Faaliyet/içerik tabanlı ön seçim' };
            }
          }
        }
        if (isl) {
          // GİB Defter-Beyan: Alış/Satış + İşlem + Belge Türü'nü belgenin sinyallerinden türet (XML yolu).
          const islText = [c.giderTuru, isl.kayitAltAd, c.isletmeNeden].filter(Boolean).join(' ');
          const islKdvVar = typeof od?.kdvTutari === 'number' ? od.kdvTutari > 0 : undefined;
          isl = {
            ...isl,
            alisSatisKod: isletmeAlisSatisTuru(kind, { isReturn: od?.isReturn === true, tevkifat: od?.tevkifatHint === true || Number(od?.tevkifatOrani) > 0, kdvVar: islKdvVar, text: islText }),
            islemTuruKod: isletmeIslemTuru(kind, islText),
            belgeTuruKod: (() => { const dt = normalizeDocumentType((doc as any).documentType || od?.belgeTuru || od?.documentType); return dt ? defaultBelgeTuruKod(dt, kind) : ''; })(),
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
            true, // Max-vision az önce denendi ve başarısız → tekrar deneme, Azure'a in
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
    // OKUMANIN PARÇASI olarak zengin AI değerlendirmesi + Katman-2 denetçi HEMEN üretilir —
    //   kullanıcı: "AI ile oku dediğimde anlık yorumunu da yapsın".
    //   ⚠️ YALNIZ kuyruk boşken (tek/az belge): TOPLU okumada her belgeye inline yorum eklemek
    //   Max şeridini doyurup SINIFLANDIRMA çağrılarını zaman aşımına düşürüyordu → kategori/gider
    //   türü BOŞ dönüyordu (Gökhan Akgöz 42-belge vakası: yeniden okumada tüm kategoriler boşaldı).
    //   Toplu okumada yorum, kuyruk boşalınca tetiklenen 4-paralel sweep'e kalır (dakikalar içinde dolar).
    if (r?.ok && this.uploadOcrQueue.length === 0) {
      await this.generateRichMuhasebeNeden(tenantId, documentId, true).catch(() => {});
    }
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
    const docIds = docs.map((d: any) => d.id);
    if (docIds.length) {
      // Döngü içi tek-tek updateMany yerine TEK toplu updateMany (N tur DB gidiş-gelişi → 1).
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: { in: docIds }, tenantId }, data: { ocrStatus: 'PENDING' },
      }).catch(() => {});
    }
    for (const d of docs) {
      this.uploadOcrQueue.unshift({ tenantId, documentId: d.id, kind: 'ai-read' });
    }
    this.drainUploadedOcrQueue();
    return { queued: docs.length, skipped: ids.length - docs.length };
  }

  /** Okumayı DURDUR: bekleyen (PENDING/IN_PROGRESS, onaysız) belgeleri kuyruktan çıkar ve CANCELLED yap →
   *  resume tekrar almaz, tarama şeridi durur. ŞU AN okunmakta olan belge (uploadOcrActiveIds) bitince
   *  kendi sonucunu yazar (yarıda bırakılmaz). taxpayerId verilirse yalnız o mükellefin belgeleri. */
  async cancelOcr(tenantId: string, taxpayerId?: string) {
    const where: any = { tenantId, ocrStatus: { in: ['PENDING', 'IN_PROGRESS'] }, status: { not: 'APPROVED' } };
    if (taxpayerId) where.taxpayerId = taxpayerId;
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({ where, select: { id: true } }).catch(() => []);
    const ids = new Set<string>(docs.map((d: any) => d.id));
    // Kuyruktan henüz başlamamışları çıkar.
    for (let i = this.uploadOcrQueue.length - 1; i >= 0; i--) {
      if (ids.has(this.uploadOcrQueue[i].documentId)) this.uploadOcrQueue.splice(i, 1);
    }
    // Aktif okunmakta olanlara DOKUNMA (bitince kendi sonucunu yazsın); gerisini CANCELLED yap.
    const cancelIds = [...ids].filter((id) => !this.uploadOcrActiveIds.has(id));
    if (cancelIds.length) {
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { tenantId, id: { in: cancelIds } }, data: { ocrStatus: 'CANCELLED' },
      }).catch(() => {});
    }
    this.logger.log(`OCR cancel: ${cancelIds.length} belge durduruldu (CANCELLED), kuyruk temizlendi (tenant=${tenantId}${taxpayerId ? ' taxpayer=' + taxpayerId : ''})`);
    return { cancelled: cancelIds.length, active: ids.size - cancelIds.length };
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

  /** EKSİK BELGE AVCISI (Faz4): mükellefin SATIŞ faturalarında belge-no ardışıklık boşlukları.
   *  Kaynak: earsiv_faturalar (GİB/entegratörden çekilen liste, tip=SATIS, donem=YYYY-MM) +
   *  invoice_accounting_documents (işlenen satışlar, faturaTarihi dönem içi). Belge no deseni
   *  kdv-control/belge-no-check ile aynı: SERİ(2-4 harf) + YIL(20xx) + SIRA(6-14 hane).
   *  Seri+yıl grubunda sıralı numaralar arasındaki boşluklar raporlanır — boşluk "kesilmemiş,
   *  iptal edilmiş ya da sisteme gelmemiş fatura olabilir" sinyalidir, kesin hüküm değil.
   *  Dönem sınırındaki boşluk (önceki ayın son numarası ile bu ayın ilki arası) bilerek kapsam dışı. */
  async eksikBelgeler(tenantId: string, opts: { taxpayerId?: string; period?: string }) {
    const taxpayerId = String(opts.taxpayerId || '').trim();
    const period = String(opts.period || '').trim();
    if (!taxpayerId || !/^\d{4}-\d{2}$/.test(period)) return { seriler: [], toplamEksik: 0, period };
    const [y, m] = period.split('-').map((n) => parseInt(n, 10));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const nolar = new Set<string>();
    const earsiv = await (this.prisma as any).earsivFatura.findMany({
      where: { tenantId, taxpayerId, tip: 'SATIS', donem: period },
      select: { faturaNo: true },
      take: 20000,
    }).catch(() => []);
    for (const r of earsiv as any[]) { const n = String(r.faturaNo || '').trim().toUpperCase(); if (n) nolar.add(n); }
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId, taxpayerId, invoiceKind: 'SATIS', belgeNo: { not: null },
        // faturaTarihi henüz okunmamış belge dönem dışı kalıp SAHTE boşluk üretmesin → createdAt yedeği
        //   (isabetOzeti ile aynı desen).
        OR: [
          { faturaTarihi: { gte: start, lt: end } },
          { AND: [{ faturaTarihi: null }, { createdAt: { gte: start, lt: end } }] },
        ],
      },
      select: { belgeNo: true },
      take: 20000,
    }).catch(() => []);
    for (const r of docs as any[]) { const n = String(r.belgeNo || '').trim().toUpperCase(); if (n) nolar.add(n); }
    // Seri+yıl bazında sıra numaralarını topla.
    const gruplar = new Map<string, { pad: number; siralar: Set<number> }>();
    for (const no of nolar) {
      const m2 = no.match(/^([A-Z]{2,4})(20\d{2})(\d{6,14})$/);
      if (!m2) continue;
      const key = `${m2[1]}${m2[2]}`;
      const sira = parseInt(m2[3], 10);
      if (!Number.isFinite(sira)) continue;
      const g = gruplar.get(key) || { pad: m2[3].length, siralar: new Set<number>() };
      g.pad = Math.max(g.pad, m2[3].length);
      g.siralar.add(sira);
      gruplar.set(key, g);
    }
    const seriler: Array<{ seri: string; adet: number; ilk: string; son: string; eksikToplam: number; bosluklar: Array<{ baslangic: string; bitis: string; adet: number }> }> = [];
    let toplamEksik = 0;
    for (const [key, g] of gruplar) {
      if (g.siralar.size < 2) continue;
      const sirali = [...g.siralar].sort((a, b) => a - b);
      const fmt = (n: number) => `${key}${String(n).padStart(g.pad, '0')}`;
      const bosluklar: Array<{ baslangic: string; bitis: string; adet: number }> = [];
      let eksikToplam = 0;
      for (let i = 1; i < sirali.length; i++) {
        const adet = sirali[i] - sirali[i - 1] - 1;
        if (adet <= 0) continue;
        // 1000+ numaralık sıçrama gerçek eksik fatura değil, numaralandırma/seri değişikliğidir —
        //   yanlış alarmla listeyi boğmasın diye kapsam dışı.
        if (adet > 1000) continue;
        eksikToplam += adet;
        if (bosluklar.length < 60) bosluklar.push({ baslangic: fmt(sirali[i - 1] + 1), bitis: fmt(sirali[i] - 1), adet });
      }
      // Boşluğu olmayan seri de listelenir (eksikToplam=0) — kullanıcı hangi serilerin tarandığını
      //   ve tam aralığı görsün ("serileri tam göster" talebi); şerit yalnız toplamEksik>0 iken çıkar.
      toplamEksik += eksikToplam;
      seriler.push({ seri: key, adet: g.siralar.size, ilk: fmt(sirali[0]), son: fmt(sirali[sirali.length - 1]), eksikToplam, bosluklar });
    }
    seriler.sort((a, b) => b.eksikToplam - a.eksikToplam);
    return { seriler, toplamEksik, period };
  }

  private async processUploadedDocumentOcr(
    tenantId: string,
    documentId: string,
    buffer: Buffer | undefined,
    originalName: string,
    forceClaude?: boolean,
    s3Key?: string,
  ) {
    // Bellek tavanı aşıldığında buffer kuyrukta tutulmadı → depodan (s3Key ya da belge kaydı) oku.
    let buf: Buffer | undefined = buffer;
    if (!buf?.length) {
      const key = s3Key
        || (await (this.prisma as any).invoiceAccountingDocument.findFirst({ where: { id: documentId, tenantId }, select: { s3Key: true } }).catch(() => null))?.s3Key;
      if (key) buf = await this.storage.getBuffer(key).catch(() => undefined as any);
    }
    if (!buf?.length) {
      await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: documentId, tenantId },
        data: { ocrStatus: 'FAILED', ocrRawText: 'Belge içeriği okunamadı (buffer/depo boş)' },
      }).catch(() => {});
      return;
    }
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id: documentId, tenantId },
      data: { ocrStatus: 'IN_PROGRESS' },
    });

    try {
      const ocrResult = await this.ocr.extractFromImage(buf, originalName, { forceClaude });
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
      const requestedKind: 'ALIS' | 'SATIS' = String(existing.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
      const ocrDocumentType = this.mapOcrBelgeTipi(ocrResult.belgeTipi) || this.docTypeFromText(ocrResult.rawText || '') || null;
      const currentDocumentType = String(existing.documentType || '').toUpperCase();
      const genericUploadType = !currentDocumentType || ['ALIS_FATURA', 'SATIS_FATURA', 'FATURA', 'OKC_FIS', 'DIGER'].includes(currentDocumentType);
      const documentType = genericUploadType && ocrDocumentType ? ocrDocumentType : (existing.documentType || ocrDocumentType || 'OKC_FIS');
      // Z RAPORU daima mükellefin günlük SATIŞ özetidir → yanlışlıkla "Gider" seçilse bile yönü Satış'a çevir
      //   (güvenlik ağı; kullanıcının Gelir/Gider seçimi diğer belgelerde geçerli kalır).
      const invoiceKind: 'ALIS' | 'SATIS' = documentType === 'Z_RAPORU' ? 'SATIS' : requestedKind;
      const isSale = invoiceKind === 'SATIS';

      const imageHash = ocrResult.imageHash || existing.imageHash || this.ocr.computeImageHash(buf);
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
            documentType,
            invoiceKind,
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
    const normalized = normalizeDocumentType(t);
    if (normalized && normalized !== 'DIGER') return normalized;
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

  /**
   * e-Arşiv HTML'inin İÇİNE GÖMÜLÜ yapısal tutar verisinden (render JSON'u) matrah/KDV/toplam çıkarır.
   * Format örn: {'malHizmetKDV(1)':1030.59,'malHizmetKDV(10)':67.27,'hesaplananKDV(1)':10.31,
   *   'hesaplananKDV(10)':6.73,'malHizmet':1114.90,'vergidahil':'1114.90','odenecek':'1114.90'}
   * Sayı biçimi NOKTA ondalık (1030.59). HIZ: bu sayede 75KB HTML'i Max'e okutmaya gerek kalmaz
   *   (60sn → ~anında). GÜVENLİK: yalnız matrah+KDV ≈ toplam DENGESİ tutarsa kullanılır; tutmazsa
   *   null döner → çağıran Max'e düşer (eski davranış korunur, hiçbir şey bozulmaz).
   */
  private parseEarsivHtmlTotals(html: string): { breakdown: Array<{ oran: number; matrah: number; kdv: number }>; toplam: number; kalemler?: Array<{ ad: string; tutar: number; oran: number }> } | null {
    if (!html || !/malHizmetKDV\(|hesaplananKDV\(/.test(html)) return null;
    // TEVKİFATLI faturada bu hızlı-yol KDV'yi TAM (tevkifat-öncesi) okur — "vergidahil/odenecek" alanı
    //   genelde Vergiler Dahil TOPLAM tutardır, tevkifatı YANSITMAZ; matrah+TAM-KDV=toplam dengesi
    //   YANLIŞLIKLA tutar ve TAM KDV ile devam edilir (kullanıcı bulgusu: tevkifatlı SATIŞ'ta KDV
    //   tutarı NET değil TAM görünüyordu). Tevkifat varsa Max-vision'a düş — orada "tevkifatKdv" AI
    //   tarafından belgeden okunur, NET KDV/tevkifat oranı doğru hesaplanır.
    // NOT: /i bayrağı Türkçe 'İ'yi (U+0130) I/i'ye katlamaz — "TEVKİFAT" yazan HTML yakalanmıyordu.
    if (/TEVK[İIiı]FAT|WithholdingTax/i.test(html)) return null;
    const matrah: Record<string, number> = {};
    const kdv: Record<string, number> = {};
    for (const m of html.matchAll(/malHizmetKDV\((\d+)\)['"]?\s*:\s*['"]?([\d.]+)/g)) matrah[m[1]] = parseFloat(m[2]);
    for (const m of html.matchAll(/hesaplananKDV\((\d+)\)['"]?\s*:\s*['"]?([\d.]+)/g)) kdv[m[1]] = parseFloat(m[2]);
    const oranlar = Array.from(new Set([...Object.keys(matrah), ...Object.keys(kdv)]));
    const breakdown = oranlar
      .map((o) => ({ oran: Number(o), matrah: Math.round((matrah[o] || 0) * 100) / 100, kdv: Math.round((kdv[o] || 0) * 100) / 100 }))
      .filter((x) => x.matrah > 0 || x.kdv > 0);
    if (!breakdown.length) return null;
    const totM = html.match(/vergidahil['"]?\s*:\s*['"]?([\d.]+)/) || html.match(/odenecek['"]?\s*:\s*['"]?([\d.]+)/);
    const toplam = totM ? parseFloat(totM[1]) : Math.round(breakdown.reduce((s, b) => s + b.matrah + b.kdv, 0) * 100) / 100;
    // DENGE: matrah + KDV ≈ toplam (1 TL tolerans). Tutmazsa güvenilmez → null (Max'e düş).
    const mTop = breakdown.reduce((s, b) => s + b.matrah, 0);
    const kTop = breakdown.reduce((s, b) => s + b.kdv, 0);
    if (Math.abs(mTop + kTop - toplam) > 1) return null;
    return { breakdown, toplam };
  }

  private async processMihsapDocumentOcr(
    tenantId: string,
    documentId: string,
    mihsapInvoiceId: string,
    invoiceKind: 'ALIS' | 'SATIS',
    // runQueuedAiRead fallback'i için: Max-vision ZATEN denendi ve çöktü → burada bir daha
    // deneme, doğrudan Azure yedeğine in (aynı belgeye iki pahalı Max denemesi olmasın).
    skipAiRead = false,
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
      // skipAiRead=true iken (fallback çağrısı) Max zaten denendi → doğrudan Azure.
      const aiOk = skipAiRead
        ? false
        : await this.aiReadDocument(tenantId, documentId).then((r: any) => !!r?.ok).catch(() => false);
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
    // Virgül yoksa TÜRK BİNLİK deseni kontrol edilir: "1.234" / "12.345.678" (nokta + tam 3 hane
    //   grupları) OCR metninde binlik ayraçtır (1.234 TL ≠ 1,234 TL) — nokta ondalık sanılıp
    //   1000 kat küçük okunuyordu. "1234.56" (2 hane ondalık) etkilenmez.
    const digitsOnly = raw.replace(/[^\d.]/g, '');
    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : (/^[1-9]\d{0,2}(\.\d{3})+$/.test(digitsOnly)
        ? raw.replace(/[^\d-]/g, '')
        : raw.replace(/[^\d.-]/g, ''));
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
    const toNumber = (value: any): number | null => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'object' && typeof value.toNumber === 'function') {
        const n = value.toNumber();
        return Number.isFinite(n) ? n : null;
      }
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const text = String(value).replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
      const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    };
    const amountChanged = (current: any, next: any): boolean => {
      const nextNumber = toNumber(next);
      if (nextNumber === null) return false;
      const currentNumber = toNumber(current);
      return currentNumber === null || Math.abs(currentNumber - nextNumber) > 0.005;
    };
    const needsAmountRefresh =
      amountChanged(existing.totalAmount, f.toplamTutar) ||
      amountChanged(currentOcrData.matrah, f.matrah) ||
      amountChanged(currentOcrData.kdvTutari, f.kdvTutari) ||
      amountChanged(currentOcrData.kdvOrani, f.kdvOrani);

    if (!needsLineRefresh && !needsBreakdownRefresh && !needsPreviewRefresh && !needsAmountRefresh) return null;

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

  async syncEfaturaInboxFromIntegrations(
    tenantId: string,
    userId: string | undefined,
    opts: { taxpayerId: string; period?: string; dateFrom?: string; dateTo?: string; direction?: 'IN' | 'OUT'; channel?: string; limit?: number; providers?: string[] } = {} as any,
  ) {
    if (!opts.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: opts.taxpayerId, tenantId },
      select: { id: true, companyName: true, taxNumber: true },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const channel = String(opts.channel || (opts.direction === 'OUT' ? 'OUT_EFATURA' : 'IN_EFATURA')).toUpperCase();
    const direction: 'ALIS' | 'SATIS' = channel === 'IN_EFATURA' ? 'ALIS' : 'SATIS';
    const inboxDirection: 'IN' | 'OUT' = direction === 'ALIS' ? 'IN' : 'OUT';
    // SERBEST TARİH ARALIĞI (Mihsap örneği — kullanıcı talebi): bkz. fetchConfiguredIntegrations'taki aynı mantık.
    const ymdOk2 = (s: any) => {
      const v = String(s || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const dd = new Date(`${v}T00:00:00.000Z`);
      return !Number.isNaN(dd.getTime()) && dd.toISOString().slice(0, 10) === v;
    };
    const dateFromOk = ymdOk2(opts.dateFrom);
    const dateToOk = ymdOk2(opts.dateTo);
    if ((String(opts.dateFrom || '').trim() || String(opts.dateTo || '').trim())
      && !(dateFromOk && dateToOk && String(opts.dateFrom) <= String(opts.dateTo))) {
      throw new BadRequestException('Tarih aralığı geçersiz: başlangıç ve bitiş YYYY-AA-GG biçiminde olmalı ve başlangıç bitişten büyük olamaz.');
    }
    const period = (dateFromOk && dateToOk && String(opts.dateFrom) <= String(opts.dateTo))
      ? { donem: `${opts.dateFrom}_${opts.dateTo}`, startDate: String(opts.dateFrom), endDate: String(opts.dateTo) }
      : this.monthRange(opts.period);
    const limit = Math.min(Math.max(Number(opts.limit || 500), 1), 1000);
    const requested = new Set((Array.isArray(opts.providers) ? opts.providers : []).map((p) => String(p).toUpperCase()));

    const rows = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        isActive: true,
        provider: {
          in: INTEGRATOR_CATALOG
            .filter((item: any) => item.kind === 'efatura' || /EFATURA|ELOGO|UYUMSOFT|MIKRO|IZIBIZ|KOLAYSOFT|FORIBA|PARASUT|NILVERA/i.test(item.provider))
            .map((item: any) => item.provider) as any,
        },
      },
      select: { id: true, provider: true, config: true, isActive: true },
    });
    const byProvider = new Map<string, any>(rows.map((row: any) => [String(row.provider), row]));
    const providers = INTEGRATOR_CATALOG.filter((item: any) => {
      if (item.provider === 'LUCA' || item.provider === 'GIB_PORTAL') return false;
      if (!(item.kind === 'efatura' || /EFATURA|ELOGO|UYUMSOFT|MIKRO|IZIBIZ|KOLAYSOFT|FORIBA|PARASUT|NILVERA/i.test(item.provider))) return false;
      if (requested.size && !requested.has(item.provider)) return false;
      return true;
    });

    const statuses: any[] = [];
    let fetched = 0, added = 0, updated = 0, skipped = 0, failed = 0;
    let turmobNeedsPrefetch = false;
    for (const item of providers) {
      const row = byProvider.get(item.provider);
      const cfg = this.resolveRuntimeConfig(row, item, opts.taxpayerId);
      if (!row || !cfg) {
        statuses.push({ provider: item.provider, label: item.label, status: 'SKIPPED', reason: 'Entegrator kimligi yok' });
        skipped++;
        continue;
      }
      const credentialCheck = this.providerCredentialProblem(cfg);
      if (credentialCheck) {
        statuses.push({ provider: item.provider, label: cfg.label, status: 'SKIPPED', reason: credentialCheck });
        skipped++;
        continue;
      }

      try {
        if (cfg.provider === 'TURMOB_EFATURA') {
          const listed = await this.withTurmobAccess(cfg.username, () => this.fetchTurmobPortalRows(cfg, { direction, period, limit, channel }));
          const turmobLookup: ProviderPayloadLookup = { cfg, payloads: [], byKey: new Map(), error: null };
          let providerFetched = 0, providerAdded = 0, providerUpdated = 0, providerSkipped = 0, providerFailed = 0;
          let providerDownloaded = 0, providerMissingDocument = 0;
          for (const sourceRow of listed.liveRows.slice(0, limit)) {
            try {
              const summary = this.turmobSummaryFromRow(sourceRow, { channel, taxpayer, direction });
              if (!summary.uuid) {
                providerSkipped++;
                continue;
              }
              if (channel === 'OUT_EARSIV' && summary.documentType !== 'E_ARSIV') {
                providerSkipped++;
                continue;
              }
              if ((channel === 'OUT_EFATURA' || channel === 'IN_EFATURA') && summary.documentType === 'E_ARSIV') {
                providerSkipped++;
                continue;
              }
              providerFetched++;
              const payload = this.providerPayloadForInboxRow(
                {
                  uuid: summary.uuid,
                  ettn: summary.ettn,
                  faturaNo: summary.faturaNo,
                  toplam: summary.toplam,
                  rawJson: { turmobRowId: summary.rowId, turmobSummaryRaw: summary.raw },
                },
                turmobLookup,
              );
              let existing = await (this.prisma as any).eFaturaInbox.findUnique({
                where: { tenantId_taxpayerId_entegrator_uuid: { tenantId, taxpayerId: opts.taxpayerId, entegrator: cfg.provider, uuid: summary.uuid } },
                select: { id: true, rawJson: true, documentId: true, isTransferred: true, processedAt: true, ublXmlRaw: true },
              });
              // MÜKERRER KORUMASI: uuid türetimi (ettn||rowId||faturaNo) zaman içinde değişebiliyor
              //   (IdArsiv tanınınca rowId dolmaya başladı → aynı fatura yeni uuid'le İKİNCİ satır
              //   oldu, kullanıcı 18→36 gördü). uuid tutmazsa FATURA NO ile de mevcut satır aranır.
              if (!existing && String(summary.faturaNo || '').trim()) {
                existing = await (this.prisma as any).eFaturaInbox.findFirst({
                  where: { tenantId, taxpayerId: opts.taxpayerId, entegrator: cfg.provider, faturaNo: String(summary.faturaNo).trim() },
                  select: { id: true, rawJson: true, documentId: true, isTransferred: true, processedAt: true, ublXmlRaw: true },
                });
              }
              const currentRaw = existing?.rawJson && typeof existing.rawJson === 'object' ? existing.rawJson : {};
              const existingXml = String(existing?.ublXmlRaw || '').trim();
              const existingXmlReady = !!existingXml && !this.isSyntheticTurmobInboxXml(existingXml);
              const effectivePayload = payload || (existingXmlReady
                ? this.providerPayloadFromStoredVisual(
                    existingXml,
                    summary.uuid || summary.ettn || summary.faturaNo || null,
                    summary.faturaNo || summary.uuid || null,
                    (currentRaw as any)?.originalVisual || null,
                  )
                : null);
              const effectiveParsed = effectivePayload
                ? (this.parseProviderUblInvoice(effectivePayload.xml) || this.regexProviderInvoiceFallback(effectivePayload.xml))
                : null;
              const effectiveStoredVisual = payload ? this.providerStoredVisual(payload) : ((currentRaw as any)?.originalVisual || null);
              const safeOriginalVisual = effectiveStoredVisual ?? null;
              const hasEffectiveOriginalVisual = this.hasOriginalProviderVisual(effectiveStoredVisual, cfg.provider);
              const documentReady = !!effectivePayload && hasEffectiveOriginalVisual;
              const data: any = {
                paraBirimi: effectiveParsed?.paraBirimi || summary.paraBirimi || 'TRY',
                direction: inboxDirection,
                invoiceProfile: effectivePayload ? this.documentTypeFromProviderXml(effectivePayload.xml) === 'E_ARSIV' ? 'e-Arsiv' : 'e-Fatura' : summary.invoiceProfile,
                syncedAt: new Date(),
                rawJson: {
                  ...currentRaw,
                  channel,
                  documentType: effectivePayload ? this.documentTypeFromProviderXml(effectivePayload.xml) : summary.documentType,
                  source: 'integrator-query',
                  provider: cfg.provider,
                  turmobRowId: summary.rowId || null,
                  turmobSummaryRaw: summary.raw,
                  // Belge indirme icin IdFatura'yi ACIKCA sakla (canli listeden) → arka plan indirme
                  //   listeyi tekrar cekmeden DOGRUDAN indirir (GetInvoiceXml/Detail).
                  turmobIdFatura: String(this.turmobField(summary.raw, ['IdFatura', 'idFatura', 'IdFaturaEk', 'IdArsiv', 'idArsiv', 'IdArsivEk']) || '').replace(/\D/g, '') || null,
                  period: period.donem,
                  queryPeriodStart: period.startDate,
                  queryPeriodEnd: period.endDate,
                  approvalStatus: summary.approval || 'Onaylandi',
                  iptalItiraz: summary.iptal || 'Yok',
                  senderTitle: summary.senderTitle || null,
                  receiverTitle: summary.receiverTitle || null,
                  senderVkn: summary.senderVkn || null,
                  receiverVkn: summary.receiverVkn || null,
                  queriedBy: userId || null,
                  needsDocumentDownload: !documentReady,
                  documentDownloadStatus: documentReady ? 'READY' : 'PENDING_DOWNLOAD',
                  documentDownloadError: documentReady
                    ? null
                    : 'Orijinal belge aktarim sirasinda indirilecek.',
                  originalVisual: safeOriginalVisual,
                },
              };
              if (payload) data.ublXmlRaw = payload.xml;
              else if (this.isSyntheticTurmobInboxXml(existing?.ublXmlRaw)) data.ublXmlRaw = null;
              if (effectiveParsed?.ettn || summary.ettn) data.ettn = effectiveParsed?.ettn || summary.ettn;
              if (effectiveParsed?.saticiVergiNo || summary.senderVkn) data.senderVkn = effectiveParsed?.saticiVergiNo || summary.senderVkn;
              if (effectiveParsed?.satici || summary.senderTitle) data.senderTitle = effectiveParsed?.satici || summary.senderTitle;
              if (effectiveParsed?.aliciVergiNo || summary.receiverVkn) data.receiverVkn = effectiveParsed?.aliciVergiNo || summary.receiverVkn;
              // NOT: receiverTitle Prisma alanı EFaturaInbox şemasında YOK → yazınca "Unknown argument
              //   receiverTitle" ile TÜM liste satırı yazımı patlıyordu (TÜRMOB tamamen kırıktı). Alıcı
              //   ünvanı zaten rawJson.receiverTitle'da saklanıyor (yukarıda) → veri kaybı yok.
              if (effectiveParsed?.faturaNo || summary.faturaNo) data.faturaNo = effectiveParsed?.faturaNo || summary.faturaNo;
              if (effectiveParsed?.faturaTarihi || summary.faturaDate) data.faturaDate = effectiveParsed?.faturaTarihi || summary.faturaDate;
              if (effectiveParsed?.matrah != null || summary.matrah != null) data.matrah = String(effectiveParsed?.matrah ?? summary.matrah);
              if (effectiveParsed?.kdvTutari != null || summary.kdv != null) data.kdv = String(effectiveParsed?.kdvTutari ?? summary.kdv);
              const parsedTotal = effectiveParsed ? (effectiveParsed.toplamTutar ?? ((effectiveParsed.matrah || 0) + (effectiveParsed.kdvTutari || 0))) : null;
              if (parsedTotal != null || summary.toplam != null) data.toplam = String(parsedTotal ?? summary.toplam);
              if (existing) {
                await (this.prisma as any).eFaturaInbox.update({ where: { id: existing.id }, data });
                if (payload && existing.documentId) {
                  await this.createDocumentFromProviderXml(
                    tenantId,
                    userId,
                    taxpayer,
                    cfg,
                    direction,
                    { ...payload, externalId: summary.uuid || payload.externalId || effectiveParsed?.ettn || effectiveParsed?.faturaNo || null },
                    { existingDocumentId: existing.documentId },
                  ).catch((e: any) => this.logger.warn(`TURMOB aktarilmis belge yenilenemedi: ${e?.message || e}`));
                }
                providerUpdated++;
              } else {
                await (this.prisma as any).eFaturaInbox.create({
                  data: {
                    tenantId,
                    taxpayerId: opts.taxpayerId,
                    entegrator: cfg.provider,
                    uuid: summary.uuid,
                    ...data,
                  },
                });
                providerAdded++;
              }
              if (documentReady) providerDownloaded++;
              else providerMissingDocument++;
            } catch (e: any) {
              providerFailed++;
              failed++;
              this.logger.warn(`TURMOB e-Fatura liste satiri yazilamadi: ${e?.message || e}`);
            }
          }
          // MÜKERRER SÜPÜRME: geçmişte uuid türetimi değiştiği için aynı faturanın birden çok inbox
          //   satırı oluşmuş olabilir (18→36 vakası). Aynı kanal+faturaNo grubunda EN İYİ satır tutulur
          //   (belgeye bağlı > gerçek XML'li > en yeni), kalanlar silinir.
          try {
            const tumu = await (this.prisma as any).eFaturaInbox.findMany({
              where: { tenantId, taxpayerId: opts.taxpayerId, entegrator: cfg.provider, direction: inboxDirection },
              select: { id: true, faturaNo: true, senderVkn: true, documentId: true, ublXmlRaw: true, syncedAt: true, rawJson: true },
            });
            const noGrup = new Map<string, any[]>();
            for (const satir of tumu) {
              const sraw = satir.rawJson && typeof satir.rawJson === 'object' ? satir.rawJson : {};
              if (String((sraw as any).channel || '').toUpperCase() !== channel) continue;
              const no = String(satir.faturaNo || '').trim();
              if (!no) continue;
              // GRUP ANAHTARI = faturaNo + satıcı VKN. Yalnız faturaNo ile anahtarlanınca FARKLI
              //   satıcıların aynı fatura numarasına sahip belgeleri tek grup sanılıp biri siliniyordu.
              const svkn = String(satir.senderVkn || (sraw as any).senderVkn || '').replace(/\D/g, '');
              const key = `${no}|${svkn}`;
              const liste = noGrup.get(key) || [];
              liste.push(satir);
              noGrup.set(key, liste);
            }
            let silinen = 0;
            for (const [, grup] of noGrup) {
              if (grup.length < 2) continue;
              const skor = (s: any) => (s.documentId ? 4 : 0)
                + ((String(s.ublXmlRaw || '').trim() && !this.isSyntheticTurmobInboxXml(s.ublXmlRaw)) ? 2 : 0)
                + (s.syncedAt ? new Date(s.syncedAt).getTime() / 1e15 : 0);
              grup.sort((a: any, b: any) => skor(b) - skor(a));
              for (const fazla of grup.slice(1)) {
                await (this.prisma as any).eFaturaInbox.delete({ where: { id: fazla.id } }).then(() => { silinen++; }).catch(() => {});
              }
            }
            if (silinen) this.logger.warn(`TURMOB ${channel}: ${silinen} mukerrer inbox satiri temizlendi (uuid turetim degisimi)`);
          } catch (e: any) {
            this.logger.warn(`TURMOB ${channel}: mukerrer supurme hatasi: ${e?.message || e}`);
          }
          fetched += providerFetched;
          added += providerAdded;
          updated += providerUpdated;
          skipped += providerSkipped + Math.max(0, listed.liveRows.length - providerFetched);
          statuses.push({
            provider: item.provider,
            label: cfg.label,
            status: 'SUCCESS',
            fetched: providerFetched,
            downloaded: providerDownloaded,
            added: providerAdded,
            updated: providerUpdated,
            skipped: providerSkipped + Math.max(0, listed.liveRows.length - providerFetched),
            pendingDocument: providerMissingDocument,
            missingDocument: 0,
            failed: providerFailed,
            // TEŞHİS (0-sonuç vakaları için): liste kaç satır döndürdü, süzgeç sonrası kaç kaldı,
            //   hangi uç kullanıldı — kullanıcı/destek Railway loguna bakmadan ekranda görsün.
            listRows: listed.rows.length,
            liveRows: listed.liveRows.length,
            listUrl: listed.usedListUrl,
            ...(listed.liveRows.length === 0 ? {
              warning: listed.rows.length > 0
                ? `TÜRMOB listesi ${listed.rows.length} satır döndürdü ama dönem/iptal süzgeci sonrası 0 kaldı (uç: ${listed.usedListUrl}) — tarih aralığını kontrol edin.`
                : `TÜRMOB listesi BOŞ döndü (uç: ${listed.usedListUrl}, yöntem: ${listed.usedMethod}) — bu kanalın liste ucu değişmiş olabilir; portalda fatura göründüğü halde boşsa desteğe bu mesajı iletin.`,
            } : {}),
          });
          if (providerMissingDocument > 0) turmobNeedsPrefetch = true;
          continue;
        }

        const payloads = await this.fetchProviderInvoices(cfg, { taxpayer, direction, period, limit, channel });
        let providerAdded = 0, providerUpdated = 0, providerSkipped = 0;
        for (const payload of payloads) {
          try {
            const parsed = this.parseProviderUblInvoice(payload.xml) || this.regexProviderInvoiceFallback(payload.xml);
            if (!parsed) { providerSkipped++; continue; }
            const docType = this.documentTypeFromProviderXml(payload.xml);
            if (channel === 'OUT_EARSIV' && docType !== 'E_ARSIV') { providerSkipped++; continue; }
            if (channel === 'OUT_EFATURA' && docType === 'E_ARSIV') { providerSkipped++; continue; }
            if (channel === 'IN_EFATURA' && docType === 'E_ARSIV') { providerSkipped++; continue; }
            const uuid = String(payload.externalId || parsed.ettn || parsed.faturaNo || createHash('sha1').update(payload.xml).digest('hex'));
            const total = parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0));
            const existing = await (this.prisma as any).eFaturaInbox.findUnique({
              where: { tenantId_taxpayerId_entegrator_uuid: { tenantId, taxpayerId: opts.taxpayerId, entegrator: cfg.provider, uuid } },
              select: { id: true, isTransferred: true, documentId: true },
            });
            const storedVisual = this.providerStoredVisual(payload);
            const data = {
              ettn: parsed.ettn || null,
              senderVkn: parsed.saticiVergiNo || null,
              senderTitle: parsed.satici || null,
              receiverVkn: parsed.aliciVergiNo || null,
              faturaNo: parsed.faturaNo || null,
              faturaDate: parsed.faturaTarihi || null,
              matrah: parsed.matrah != null ? String(parsed.matrah) : null,
              kdv: parsed.kdvTutari != null ? String(parsed.kdvTutari) : null,
              toplam: total != null ? String(total) : null,
              paraBirimi: parsed.paraBirimi || 'TRY',
              direction: inboxDirection,
              invoiceProfile: docType === 'E_ARSIV' ? 'e-Arsiv' : ((parsed as any).profileId || 'e-Fatura'),
              ublXmlRaw: payload.xml,
              syncedAt: new Date(),
              rawJson: {
                channel,
                documentType: docType,
                source: 'integrator-query',
                provider: cfg.provider,
                originalName: payload.originalName || null,
                originalVisual: storedVisual,
                period: period.donem,
                queryPeriodStart: period.startDate,
                queryPeriodEnd: period.endDate,
                approvalStatus: 'Onaylandi',
                iptalItiraz: 'Yok',
                queriedBy: userId || null,
              },
            };
            if (existing) {
              await (this.prisma as any).eFaturaInbox.update({ where: { id: existing.id }, data });
              if (existing.documentId && storedVisual) {
                await this.refreshProviderDocumentVisual(
                  tenantId,
                  existing.documentId,
                  taxpayer,
                  cfg,
                  payload,
                ).catch((e: any) => this.logger.warn(`Aktarilmis e-fatura gorseli yenilenemedi: ${e?.message || e}`));
              }
              providerUpdated++;
            } else {
              await (this.prisma as any).eFaturaInbox.create({
                data: {
                  tenantId,
                  taxpayerId: opts.taxpayerId,
                  entegrator: cfg.provider,
                  uuid,
                  ...data,
                },
              });
              providerAdded++;
            }
          } catch (e: any) {
            failed++;
            this.logger.warn(`e-Fatura inbox yazilamadi (${item.provider}): ${e?.message || e}`);
          }
        }
        fetched += payloads.length;
        added += providerAdded;
        updated += providerUpdated;
        skipped += providerSkipped;
        statuses.push({
          provider: item.provider, label: cfg.label, status: 'SUCCESS', fetched: payloads.length, added: providerAdded, updated: providerUpdated, skipped: providerSkipped,
          // Sayfalama yok: dönen adet limite ULAŞTIYSA dönemde daha fazla fatura olabilir — sessiz
          //   kırpma yerine görünür uyarı (kullanıcı limiti artırır ya da aralığı böler).
          ...(payloads.length >= limit ? { truncated: true, warning: `Sağlayıcı ${limit} kayıt sınırına ulaştı — dönemde daha fazla fatura olabilir; tarih aralığını bölerek tekrar sorgulayın.` } : {}),
        });
      } catch (e: any) {
        failed++;
        statuses.push({ provider: item.provider, label: cfg.label, status: 'FAILED', reason: e?.message || 'sorgu hatasi' });
      }
    }

    // TÜRMOB: liste yazıldı, ANINDA dön. Eksik belgeleri (PENDING_DOWNLOAD) ARKA PLANDA
    //   indir (tek-oturum kilidiyle). UI satırların documentDownloadStatus'undan sayaç gösterir;
    //   indirme bitince Aktar pasiflikten çıkar ve hazır görseli tekrar indirmeden aktarır.
    if (turmobNeedsPrefetch) {
      // periodLabel: satırlar rawJson.period'a SORGUNUN etiketini yazar (ay "2026-05" YA DA serbest
      //   aralık "2026-05-15_2026-05-20"). Prefetch filtresi ay etiketiyle karşılaştırınca aralıklı
      //   sorgunun satırları hedefe girmiyor, PENDING_DOWNLOAD'da takılıyordu → gerçek etiketi geçir.
      void this.prefetchTurmobInboxDocuments(tenantId, opts.taxpayerId, { direction: inboxDirection, channel, period: opts.period, periodLabel: period.donem })
        .catch((e: any) => this.logger.warn(`TURMOB arka plan indirme tetiklenemedi: ${e?.message || e}`));
    }
    return { source: 'efatura-inbox', channel, direction: inboxDirection, fetched, added, updated, skipped, failed, providers: statuses };
  }

  async importEfaturaInboxToAccounting(
    tenantId: string,
    userId: string | undefined,
    opts: { taxpayerId: string; period?: string; direction?: 'IN' | 'OUT'; channel?: string; ids?: string[]; limit?: number } = {} as any,
  ) {
    if (!opts.taxpayerId) throw new BadRequestException('taxpayerId gerekli');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: opts.taxpayerId, tenantId },
      select: { id: true, companyName: true, taxNumber: true },
    });
    if (!taxpayer) throw new NotFoundException('Mukellef bulunamadi');

    const channel = String(opts.channel || (opts.direction === 'OUT' ? 'OUT_EFATURA' : 'IN_EFATURA')).toUpperCase();
    const direction: 'IN' | 'OUT' = channel === 'IN_EFATURA' ? 'IN' : 'OUT';
    const ids = Array.isArray(opts.ids) ? [...new Set(opts.ids.map((id) => String(id || '').trim()).filter(Boolean))] : [];
    const where: any = { tenantId, taxpayerId: opts.taxpayerId, direction };
    if (ids.length) where.id = { in: ids };
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
    const rows = await (this.prisma as any).eFaturaInbox.findMany({
      where,
      orderBy: { faturaDate: 'desc' },
      take: Math.min(Math.max(Number(opts.limit || 500), 1), 1000),
    });
    const referencedDocIds = [...new Set(rows.map((row: any) => String(row.documentId || '').trim()).filter(Boolean))];
    let existingDocIds = new Set<string>();
    const providerSource = (row: any) => {
      const provider = String(row?.entegrator || 'TURMOB_EFATURA').trim().toLowerCase();
      return provider ? `integration-${provider}` : '';
    };
    const rowSourceRef = (row: any) => String(row?.uuid || row?.ettn || row?.faturaNo || '').trim();
    const existingDocsBySourceRef = new Map<string, any>();
    if (referencedDocIds.length) {
      const existingDocs = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: { tenantId, taxpayerId: opts.taxpayerId, id: { in: referencedDocIds } },
        select: { id: true, source: true, sourceRefId: true },
      });
      existingDocIds = new Set(existingDocs.map((doc: any) => String(doc.id)));
      for (const doc of existingDocs) {
        const key = `${String(doc.source || '').toLowerCase()}::${String(doc.sourceRefId || '').trim()}`;
        if (doc.sourceRefId) existingDocsBySourceRef.set(key, doc);
      }
    }
    const sourceRefs = [...new Set(rows.map(rowSourceRef).filter(Boolean))];
    const sources = [...new Set(rows.map(providerSource).filter(Boolean))];
    if (sourceRefs.length && sources.length) {
      const existingDocs = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: {
          tenantId,
          taxpayerId: opts.taxpayerId,
          source: { in: sources },
          sourceRefId: { in: sourceRefs },
        },
        select: { id: true, source: true, sourceRefId: true },
      });
      for (const doc of existingDocs) {
        existingDocIds.add(String(doc.id));
        const key = `${String(doc.source || '').toLowerCase()}::${String(doc.sourceRefId || '').trim()}`;
        if (doc.sourceRefId) existingDocsBySourceRef.set(key, doc);
      }
    }

    const runtimeConfigCache = new Map<string, RuntimeIntegrationConfig | null>();
    const runtimeConfigFor = async (provider: string) => {
      const key = String(provider || '').toUpperCase();
      if (!runtimeConfigCache.has(key)) {
        runtimeConfigCache.set(key, await this.resolveRuntimeConfigForProvider(tenantId, opts.taxpayerId, key));
      }
      return runtimeConfigCache.get(key) || null;
    };
    const rowInCurrentImportPeriod = (row: any) => {
      if (!periodStart || !periodEnd) return true;
      const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
      const validRowDate = rowDate && !Number.isNaN(rowDate.getTime());
      const raw = row.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
      const dateMatches = validRowDate && rowDate >= periodStart && rowDate < periodEnd;
      // Serbest tarih aralığıyla sorgulanan satırlarda raw.period "from_to" biçimindedir — ay etiketiyle
      //   birebir eşleşmez; queryPeriodStart/End ay ile KESİŞİYORSA satır bu dönemin importuna girer
      //   (eskiden faturaDate'siz satır sessizce dışlanıyordu).
      const startYmd = periodStart.toISOString().slice(0, 10);
      const endYmd = periodEnd.toISOString().slice(0, 10);
      const rawPeriodMatches = String(raw.period || '') === opts.period
        || (!!raw.queryPeriodStart && !!raw.queryPeriodEnd
          && String(raw.queryPeriodStart) < endYmd && String(raw.queryPeriodEnd) >= startYmd);
      return validRowDate ? Boolean(dateMatches) : rawPeriodMatches;
    };
    const turmobBatchLookupCache = new Map<string, Promise<ProviderPayloadLookup | null>>();
    const turmobBatchLookupFor = (provider: string, cfg: RuntimeIntegrationConfig) => {
      const key = `${String(provider || '').toUpperCase()}::${channel}::${opts.period || ''}`;
      if (!turmobBatchLookupCache.has(key)) {
        turmobBatchLookupCache.set(key, (async () => {
          const targets = rows.filter((candidate: any) => {
            const raw = candidate.rawJson && typeof candidate.rawJson === 'object' ? candidate.rawJson : {};
            if (String(candidate.entegrator || 'TURMOB_EFATURA').toUpperCase() !== String(provider || '').toUpperCase()) return false;
            if (String(raw.channel || '').toUpperCase() !== channel) return false;
            if (!rowInCurrentImportPeriod(candidate)) return false;
            const xml = String(candidate.ublXmlRaw || '').trim();
            const status = String(raw.documentDownloadStatus || '').toUpperCase();
            return !xml
              || this.isSyntheticTurmobInboxXml(xml)
              || !this.hasOriginalProviderVisual(raw.originalVisual, provider)
              || status === 'MISSING'
              || status === 'SUMMARY_ONLY';
          });
          if (!targets.length) return { cfg, payloads: [], byKey: new Map(), error: null };
          try {
            const sampleDate = targets.find((candidate: any) => candidate.faturaDate)?.faturaDate;
            const samplePeriod = opts.period || (sampleDate ? new Date(sampleDate).toISOString().slice(0, 7) : undefined);
            const payloads = await this.withTurmobAccess(cfg.username, () => this.fetchTurmobPortalInvoices(cfg, {
              taxpayer,
              direction: direction === 'OUT' ? 'SATIS' : 'ALIS',
              period: this.monthRange(samplePeriod),
              limit: Math.min(Math.max(targets.length, 1), 1000),
              channel,
              targetRows: targets,
            }));
            return { cfg, payloads, byKey: this.buildProviderPayloadLookup(payloads), error: null };
          } catch (e: any) {
            const message = e?.message || String(e);
            this.logger.warn(`TURMOB toplu belge indirme basarisiz: ${channel} ${message}`);
            return { cfg, payloads: [], byKey: new Map(), error: message };
          }
        })());
      }
      return turmobBatchLookupCache.get(key)!;
    };

    let processed = 0, imported = 0, alreadyQueued = 0, skipped = 0, failed = 0, staleReset = 0;
    const errors: any[] = [];
    for (const row of rows) {
      let raw = row.rawJson || {};
      if (String(raw.channel || '').toUpperCase() !== channel) continue;
      if (periodStart && periodEnd) {
        const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
        const validRowDate = rowDate && !Number.isNaN(rowDate.getTime());
        const dateMatches = validRowDate && rowDate >= periodStart && rowDate < periodEnd;
        const rawPeriodMatches = String(raw.period || '') === opts.period;
        if (validRowDate ? !dateMatches : !rawPeriodMatches) continue;
      }
      processed++;
      const provider = String(row.entegrator || 'TURMOB_EFATURA');
      const runtimeCfg = (await runtimeConfigFor(provider)) || this.providerStubConfig(provider);
      const sourceRef = rowSourceRef(row);
      const existingBySourceRef = existingDocsBySourceRef.get(`${providerSource(row)}::${sourceRef}`);
      const savedXml = String(row.ublXmlRaw || '').trim();
      const savedXmlLooksSynthetic = provider === 'TURMOB_EFATURA' && this.isSyntheticTurmobInboxXml(savedXml);
      // ORİJİNAL EKSİK = yalnız sağlam UBL XML YOKSA (sentetik/liste-özeti dahil). Görsel/stale
      //   "MISSING" durumu sağlam XML'i geçersiz kılmaz (görsel opsiyonel; belge XML'den oluşur) —
      //   aksi halde XML'i olan TORA PETROL aktarılınca bir sonraki sync onu geri MISSING'e atıyordu.
      const turmobOriginalMissing = provider === 'TURMOB_EFATURA'
        && (!savedXml || savedXmlLooksSynthetic);
      if (!turmobOriginalMissing && !row.documentId && existingBySourceRef?.id) {
        await (this.prisma as any).eFaturaInbox.update({
          where: { id: row.id },
          data: {
            documentId: existingBySourceRef.id,
            isTransferred: true,
            processedAt: row.processedAt || new Date(),
          },
        });
        row.documentId = existingBySourceRef.id;
        row.isTransferred = true;
        row.processedAt = row.processedAt || new Date();
      }
      const transferredWithoutDocument = !row.documentId && (row.processedAt || row.isTransferred) && !existingBySourceRef?.id;
      const missingLinkedDocument = row.documentId && !existingDocIds.has(String(row.documentId)) && !existingBySourceRef?.id;
      if (transferredWithoutDocument || missingLinkedDocument || (turmobOriginalMissing && (row.documentId || row.isTransferred || row.processedAt))) {
        await (this.prisma as any).eFaturaInbox.update({
          where: { id: row.id },
          data: { documentId: null, isTransferred: false, processedAt: null },
        });
        row.documentId = null;
        row.isTransferred = false;
        row.processedAt = null;
        staleReset++;
      }
      if (row.documentId || row.processedAt || row.isTransferred) {
        if (row.documentId) {
          const visualPayload = this.providerPayloadFromStoredVisual(String(row.ublXmlRaw || ''), row.uuid, row.faturaNo, raw?.originalVisual);
          if (visualPayload.pdfBuffer || visualPayload.htmlContent) {
            await this.createDocumentFromProviderXml(
              tenantId,
              userId,
              taxpayer,
              runtimeCfg,
              direction === 'OUT' ? 'SATIS' : 'ALIS',
              { ...visualPayload, externalId: row.uuid || visualPayload.externalId || row.ettn || row.faturaNo || null },
              { existingDocumentId: row.documentId },
            ).catch((e: any) => this.logger.warn(`Aktarilmis e-fatura belgesi yenilenemedi: ${e?.message || e}`));
          }
        }
        alreadyQueued++;
        continue;
      }
      if (/iptal|itiraz|red|cancel/i.test(`${raw.approvalStatus || ''} ${raw.iptalItiraz || ''}`)) { skipped++; continue; }
      let storedVisual = raw?.originalVisual;
      let hasOriginalVisual = this.hasOriginalProviderVisual(storedVisual, provider);
      let xml = String((savedXmlLooksSynthetic ? '' : savedXml) || '').trim();
      let downloadError: string | null = null;
      if (provider === 'TURMOB_EFATURA' && (!xml || !hasOriginalVisual)) {
        const cfgForDownload = await runtimeConfigFor(provider);
        if (cfgForDownload) {
          try {
            const batchLookup = await turmobBatchLookupFor(provider, cfgForDownload);
            let downloaded = batchLookup ? this.providerPayloadForInboxRow(row, batchLookup) : null;
            if (!downloaded && ids.length === 1 && rows.length === 1) {
              const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
              const rowPeriod = opts.period || (rowDate && !Number.isNaN(rowDate.getTime()) ? rowDate.toISOString().slice(0, 7) : undefined);
              const downloadPeriod = this.monthRange(rowPeriod);
              const payloads = await this.withTurmobAccess(cfgForDownload.username, () => this.fetchTurmobPortalInvoices(cfgForDownload, {
                taxpayer,
                direction: direction === 'OUT' ? 'SATIS' : 'ALIS',
                period: downloadPeriod,
                limit: 1,
                channel,
                targetRows: [row],
              }));
              const lookup = { cfg: cfgForDownload, payloads, byKey: this.buildProviderPayloadLookup(payloads), error: null };
              downloaded = this.providerPayloadForInboxRow(row, lookup) || payloads[0] || null;
            }
            if (!downloaded && batchLookup?.error) downloadError = batchLookup.error;
            if (downloaded) {
              xml = String(downloaded.xml || '').trim();
              storedVisual = this.providerStoredVisual(downloaded);
              hasOriginalVisual = this.hasOriginalProviderVisual(storedVisual, provider);
              raw = {
                ...raw,
                needsDocumentDownload: !hasOriginalVisual,
                documentDownloadStatus: hasOriginalVisual ? 'READY' : 'MISSING',
                documentDownloadError: hasOriginalVisual ? null : 'TURMOB orijinal fatura goruntusu indirilemedi.',
                originalVisual: storedVisual || raw?.originalVisual || null,
              };
            }
          } catch (e: any) {
            downloadError = e?.message || 'TURMOB belge indirilemedi';
            this.logger.warn(`TURMOB hedefli belge indirilemedi: ${row.faturaNo || row.uuid || row.id} ${downloadError}`);
          }
        } else {
          downloadError = 'TURMOB kimlik bilgisi bulunamadi';
        }
      }
      // SADECE XML YOKSA atla. GÖRSEL eksik olsa da SAĞLAM UBL XML varsa belge XML'den oluşturulur
      //   (kullanıcı: "bunlar zaten XML, görsele gerek yok"). TORA PETROL gibi çok-kalemli (372KB)
      //   faturalarda XML iniyordu ama Detay görseli inmiyordu → görsel-zorunlu kapısı belgeyi
      //   MISSING'e düşürüyordu. Görsel artık opsiyonel; veri/okuma XML'den (loadProviderUblXml).
      if (provider === 'TURMOB_EFATURA' && !xml) {
        await (this.prisma as any).eFaturaInbox.update({
          where: { id: row.id },
          data: {
            isTransferred: false,
            processedAt: null,
            documentId: null,
            rawJson: {
              ...raw,
              needsDocumentDownload: true,
              documentDownloadStatus: 'MISSING',
              documentDownloadError: downloadError || 'TURMOB orijinal XML/UBL/PDF indirilemedi; sentetik belge olusturulmadan atlandi.',
            },
          },
        });
        row.documentId = null;
        row.isTransferred = false;
        row.processedAt = null;
        failed++;
        if (errors.length < 10) errors.push({ id: row.id, faturaNo: row.faturaNo, message: 'TURMOB orijinal XML indirilemedi' });
        continue;
      }
      const usedSummaryOnly = false;
      if (!xml) { failed++; errors.push({ id: row.id, message: 'XML bulunamadi' }); continue; }
      try {
        const result = await this.createDocumentFromProviderXml(
          tenantId,
          userId,
          taxpayer,
          runtimeCfg,
          direction === 'OUT' ? 'SATIS' : 'ALIS',
          this.providerPayloadFromStoredVisual(xml, row.uuid, row.faturaNo, storedVisual),
        );
        const parsed = this.parseProviderUblInvoice(xml) || this.regexProviderInvoiceFallback(xml);
        const updateRaw = {
          ...raw,
          needsDocumentDownload: usedSummaryOnly ? true : false,
          documentDownloadStatus: usedSummaryOnly ? 'SUMMARY_ONLY' : 'READY',
          documentDownloadError: usedSummaryOnly
            ? 'TURMOB orijinal XML indirilemedi; liste ozetiyle muhasebe kaydi olusturuldu.'
            : null,
          originalVisual: storedVisual || raw?.originalVisual || null,
        };
        const total = parsed ? (parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0))) : null;
        await (this.prisma as any).eFaturaInbox.update({
          where: { id: row.id },
          data: {
            ublXmlRaw: xml,
            ...(parsed?.ettn ? { ettn: parsed.ettn } : {}),
            ...(parsed?.faturaNo ? { faturaNo: parsed.faturaNo } : {}),
            ...(parsed?.faturaTarihi ? { faturaDate: parsed.faturaTarihi } : {}),
            ...(parsed?.saticiVergiNo ? { senderVkn: parsed.saticiVergiNo } : {}),
            ...(parsed?.satici ? { senderTitle: parsed.satici } : {}),
            ...(parsed?.aliciVergiNo ? { receiverVkn: parsed.aliciVergiNo } : {}),
            // receiverTitle alanı şemada YOK (yukarıdaki nottaki gibi) → aktarımda da yazılmaz; rawJson'da var.
            ...(parsed?.matrah != null ? { matrah: String(parsed.matrah) } : {}),
            ...(parsed?.kdvTutari != null ? { kdv: String(parsed.kdvTutari) } : {}),
            ...(total != null ? { toplam: String(total) } : {}),
            rawJson: updateRaw,
            isTransferred: true,
            documentId: result.document?.id || null,
            processedAt: new Date(),
          },
        });
        if (result.created) imported++;
        else alreadyQueued++;
      } catch (e: any) {
        failed++;
        if (errors.length < 10) errors.push({ id: row.id, faturaNo: row.faturaNo, message: e?.message || 'aktarim hatasi' });
      }
    }
    // OTOMATİK EŞLEŞTİRME: aktarılan e-faturalara hesap kodlarını ("Kodları düzelt" ile AYNI:
    //   cari VKN→320, KDV 191/391, plan/öğrenilmiş gider) kendiliğinden ata → kullanıcı elle basmasın.
    //   Fire-and-forget (HTTP yanıtını bekletmez); frontend poll ile kodlar dolar.
    if (imported > 0) {
      void this.reapplyAccountCodes(tenantId, opts.taxpayerId)
        .catch((e: any) => this.logger.warn(`Aktar sonrasi otomatik eslestirme hatasi: ${e?.message || e}`));
    }
    return { processed, imported, alreadyQueued, skipped, failed, staleReset, errors };
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
    // ENTEGRATÖR / UBL belge → ORİJİNAL fatura GÖRÜNTÜSÜNÜ UBL XML'in GÖMÜLÜ XSLT'sinden (resmi e-Fatura
    //   tasarımı; SATICI logosu/başlığı DAHİL) üret. TÜRMOB'un yazdırma görünümü satıcı başlığını render
    //   ETMİYORDU → mükellefe "boş satıcılı / yarım" bozuk fatura görünüyordu. XML'de gömülü XSLT varsa
    //   resmi görünüm çıkar; XSLT tarayıcıda apply edilir, başarısızsa parse'tan dolu özet fallback gösterilir.
    try {
      const provXml = await this.loadProviderUblXml(tenantId, doc);
      if (provXml && this.earsivRender.hasEmbeddedXslt(provXml)) {
        const p: any = this.parseProviderUblInvoice(provXml) || {};
        const fatura: any = {
          id,
          xmlContent: provXml,
          faturaNo: p.faturaNo || (doc as any).belgeNo || '',
          faturaTarihi: p.faturaTarihi || (doc as any).faturaTarihi || new Date(),
          ettn: p.ettn || null,
          satici: p.satici || (doc as any).vendorName || null,
          saticiVergiNo: p.saticiVergiNo || (doc as any).sellerVkn || null,
          alici: p.alici || (doc as any).customerName || null,
          aliciVergiNo: p.aliciVergiNo || (doc as any).buyerVkn || null,
          matrah: p.matrah, kdvTutari: p.kdvTutari, kdvOrani: p.kdvOrani, toplamTutar: p.toplamTutar,
          paraBirimi: p.paraBirimi || (doc as any).currency || 'TL',
        };
        return { url: '', inlineHtml: this.earsivRender.renderHtml(fatura, { autoPrint: false }), mimeType: 'text/html', source: 'original-xslt' as const };
      }
    } catch { /* XML yok / render hatası → aşağıdaki mevcut akış */ }
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
          const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
          if (isZip) {
            const payload = await this.extractStoredInvoiceViewPayload(buf, 'application/zip');
            const rendered = this.renderStoredInvoiceViewPayload(payload, doc);
            if (rendered) return { ...rendered, source: 'mihsap' as const };
          }
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
    let renderedStoredInvoice: any = null;
    try {
      renderedStoredInvoice = await this.renderStoredInvoiceFile(doc, mimeType);
    } catch (e: any) {
      this.logger.warn(`Belge onizleme dosyasi okunamadi (${id}): ${e?.message || e}`);
      if (this.isProviderStoredInvoice(doc)) {
        return {
          url: '',
          inlineHtml: this.inlinePreviewHtml('Bu belge icin orijinal dosya okunamadi. Uydurma belge goruntusu gosterilmiyor. Belgeyi entegratorden yeniden sorgulayip indirin.'),
          mimeType: 'text/html',
          source: 'placeholder' as const,
        };
      }
    }
    if (renderedStoredInvoice) return renderedStoredInvoice;

    if (!doc.s3Key) {
      return {
        url: '',
        inlineHtml: this.inlinePreviewHtml('Bu belge icin orijinal dosya kaydi bulunamadi. Uydurma belge goruntusu gosterilmiyor.'),
        mimeType: 'text/html',
        source: 'placeholder' as const,
      };
    }
    const url = await this.storage.getPresignedInlineUrl(doc.s3Key, doc.originalName, mimeType || undefined);
    return { url, mimeType, source: 'stored-file' as const };
  }

  private isProviderStoredInvoice(doc: any) {
    const source = String(doc?.source || '').toLowerCase();
    const name = String(doc?.originalName || '').toLowerCase();
    return source === 'gib-earsiv-api'
      || source === 'gib-portal-api'
      || source.includes('efatura')
      || source.includes('earsiv')
      || /\.(zip|xml|ubl|html?|json)$/i.test(name);
  }

  private async renderStoredInvoiceFile(doc: any, mimeType: string) {
    const s3Key = String(doc?.s3Key || '');
    if (!s3Key) return null;

    const source = String(doc?.source || '').toLowerCase();
    const originalName = String(doc?.originalName || '').toLowerCase();
    const shouldInspect =
      /text\/html|xml|zip|json|octet-stream/i.test(mimeType)
      || /\.(zip|xml|ubl|html?|json)$/i.test(originalName)
      || this.isProviderStoredInvoice(doc);
    if (!shouldInspect) return null;

    const buffer = await this.storage.getBuffer(s3Key);
    const payload = await this.extractStoredInvoiceViewPayload(buffer, mimeType);
    if (!payload) return null;

    return this.renderStoredInvoiceViewPayload(payload, doc);
  }

  private renderStoredInvoiceViewPayload(payload: any, doc: any) {
    if (!payload) return null;
    if (payload.kind === 'pdf') {
      return {
        url: `data:application/pdf;base64,${payload.buffer.toString('base64')}`,
        mimeType: 'application/pdf',
        source: 'stored-file' as const,
      };
    }
    if (payload.kind === 'image') {
      return {
        url: `data:${payload.mimeType};base64,${payload.buffer.toString('base64')}`,
        mimeType: payload.mimeType,
        source: 'stored-file' as const,
      };
    }

    const raw = payload.content;
    const rawHead = raw.slice(0, 1000);
    const rawIsHtml = payload.kind === 'html' || /<html[\s>]/i.test(rawHead);
    const rawIsInvoiceXml = /<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(raw);
    if (rawIsHtml && !rawIsInvoiceXml) {
      // TÜRMOB görseli /Invoice/Detail?IsPrint=True YAZDIRMA görünümü → önizleme açılınca otomatik
      //   yazdırmaya çalışıyordu. renderOriginalHtml autoPrint:false KENDİ print eklemiyor ama girdideki
      //   MEVCUT window.print()'i temizlemiyor → burada (gösterimde) temizle: mevcut görsellerde de düzelir.
      const noPrintRaw = String(raw)
        .replace(/<script[^>]*>[\s\S]*?(?:window\.)?print\s*\([\s\S]*?<\/script>/gi, '')
        .replace(/(?:window\.)?print\s*\(\s*\)/gi, 'void 0')
        .replace(/\bonload\s*=\s*(["'])[^"']*?print[^"']*?\1/gi, '');
      return {
        url: '',
        inlineHtml: this.earsivRender.renderOriginalHtml(noPrintRaw, { autoPrint: false }),
        mimeType: 'text/html',
        source: 'stored-html' as const,
      };
    }
    if (rawIsInvoiceXml && (this.isSyntheticTurmobInboxXml(raw) || !this.earsivRender.hasEmbeddedXslt(raw))) {
      return {
        url: '',
        inlineHtml: this.inlinePreviewHtml('Bu kayitta orijinal fatura goruntusu yok. Sadece entegrator liste verisiyle muhasebe kaydi olusturulmus; uydurma belge goruntusu gosterilmiyor.'),
        mimeType: 'text/html',
        source: 'placeholder' as const,
      };
    }

    const html = rawIsInvoiceXml
      ? this.earsivRender.renderHtml({
          id: doc.id,
          faturaNo: doc.belgeNo || '',
          faturaTarihi: doc.faturaTarihi || doc.createdAt || new Date(),
          ettn: doc?.ocrData?.ettn || null,
          satici: doc.vendorName || null,
          saticiVergiNo: doc.sellerVkn || null,
          alici: doc.customerName || null,
          aliciVergiNo: doc.buyerVkn || null,
          matrah: doc?.ocrData?.matrah,
          kdvTutari: doc?.ocrData?.kdvTutari,
          kdvOrani: doc?.ocrData?.kdvOrani,
          toplamTutar: doc.totalAmount,
          paraBirimi: doc.currency,
          xmlContent: raw,
        }, { autoPrint: false })
      : this.inlinePreviewHtml(raw, doc);

    return {
      url: '',
      inlineHtml: html,
      mimeType: 'text/html',
      source: rawIsInvoiceXml ? ('provider-xml' as const) : ('stored-html' as const),
    };
  }

  private async extractStoredInvoiceViewPayload(buffer: Buffer, mimeType: string): Promise<
    | { kind: 'html' | 'xml' | 'text'; content: string }
    | { kind: 'pdf'; buffer: Buffer }
    | { kind: 'image'; buffer: Buffer; mimeType: string }
    | null
  > {
    const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    const isPdf = buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    const isJpeg = buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer.length > 7 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    if (isPdf || /pdf/i.test(mimeType)) return { kind: 'pdf', buffer };
    if (isJpeg || /^image\/jpe?g/i.test(mimeType)) return { kind: 'image', buffer, mimeType: 'image/jpeg' };
    if (isPng || /^image\/png/i.test(mimeType)) return { kind: 'image', buffer, mimeType: 'image/png' };

    if (isZip) {
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.values(zip.files).filter((file) => !file.dir);
      const ordered = files.sort((a, b) => {
        const rank = (name: string) =>
          /\.pdf$/i.test(name) ? 0
            : /\.(html?|xhtml)$/i.test(name) ? 1
              : /\.(jpe?g|png|webp)$/i.test(name) ? 2
                : /\.(xml|ubl)$/i.test(name) ? 3
                  : 4;
        return rank(a.name || '') - rank(b.name || '');
      });
      for (const file of ordered) {
        const name = file.name || '';
        if (!/\.(pdf|html?|xhtml|jpe?g|png|webp|xml|ubl)$/i.test(name)) continue;
        const nested = Buffer.from(await file.async('uint8array'));
        if (nested.length >= 4 && nested[0] === 0x50 && nested[1] === 0x4b) {
          const nestedPayload = await this.extractStoredInvoiceViewPayload(nested, '');
          if (nestedPayload) return nestedPayload;
          continue;
        }
        if (/\.pdf$/i.test(name)) return { kind: 'pdf', buffer: nested };
        if (/\.(jpe?g)$/i.test(name)) return { kind: 'image', buffer: nested, mimeType: 'image/jpeg' };
        if (/\.png$/i.test(name)) return { kind: 'image', buffer: nested, mimeType: 'image/png' };
        const content = this.decodeXmlEntities(nested.toString('utf8')).trim();
        if (!content) continue;
        return {
          kind: /\.(html?|xhtml)$/i.test(name) ? 'html' : 'xml',
          content,
        };
      }
      for (const file of ordered) {
        const nested = Buffer.from(await file.async('uint8array'));
        if (nested.length >= 4 && nested[0] === 0x50 && nested[1] === 0x4b) {
          const nestedPayload = await this.extractStoredInvoiceViewPayload(nested, '');
          if (nestedPayload) return nestedPayload;
          continue;
        }
        const content = this.decodeXmlEntities(nested.toString('utf8')).trim();
        if (!content) continue;
        const jsonPayload = await this.extractInvoicePayloadFromJsonText(content);
        if (jsonPayload) return jsonPayload;
        if (/<html[\s>]/i.test(content.slice(0, 1000))) return { kind: 'html', content };
        if (/<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(content)) return { kind: 'xml', content };
      }

      const payloads: ProviderInvoicePayload[] = [];
      await this.addPayloadBuffer(payloads, buffer);
      if (payloads[0]?.htmlContent) return { kind: 'html', content: payloads[0].htmlContent };
      if (payloads[0]?.xml) return { kind: 'xml', content: payloads[0].xml };
      return null;
    }

    const content = this.decodeXmlEntities(buffer.toString('utf8')).trim();
    if (!content) return null;
    const jsonPayload = await this.extractInvoicePayloadFromJsonText(content);
    if (jsonPayload) return jsonPayload;
    if (/<html[\s>]/i.test(content.slice(0, 1000))) return { kind: 'html', content };
    if (/<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(content)) return { kind: 'xml', content };
    if (/text\/html/i.test(mimeType)) return { kind: 'html', content };
    if (/xml/i.test(mimeType)) return { kind: 'xml', content };
    return { kind: 'text', content };
  }

  private async extractInvoicePayloadFromJsonText(text: string): Promise<
    | { kind: 'html' | 'xml' | 'text'; content: string }
    | { kind: 'pdf'; buffer: Buffer }
    | { kind: 'image'; buffer: Buffer; mimeType: string }
    | null
  > {
    const source = String(text || '').trim();
    if (!/^[\[{]/.test(source)) return null;
    let json: any;
    try {
      json = JSON.parse(source);
    } catch {
      return null;
    }

    const candidates: string[] = [];
    const visit = (node: any, key = '', depth = 0) => {
      if (node == null || depth > 8) return;
      if (typeof node === 'string') {
        const value = node.trim();
        if (value.length > 20 && (/xml|ubl|html|content|data|base64|pdf|document|invoice|fatura/i.test(key) || this.looksLikeXmlOrBase64(value) || /<html[\s>]|<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(value))) {
          candidates.push(value);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, key, depth + 1));
        return;
      }
      if (typeof node === 'object') {
        for (const [childKey, childValue] of Object.entries(node)) visit(childValue, childKey, depth + 1);
      }
    };
    visit(json);

    for (const candidate of candidates) {
      const decoded = this.decodeXmlEntities(candidate).trim();
      if (/<html[\s>]/i.test(decoded.slice(0, 1000))) return { kind: 'html', content: decoded };
      if (/<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(decoded)) return { kind: 'xml', content: decoded };
      const compact = decoded.replace(/\s+/g, '');
      if (!this.looksLikeBase64(compact)) continue;
      const payload = await this.extractStoredInvoiceViewPayload(Buffer.from(compact, 'base64'), '');
      if (payload) return payload;
    }
    return null;
  }

  // Entegratörden gelen HTML önizlemeye girmeden önce AKTİF içeriği söker (derinlemesine savunma —
  //   iframe frontend'de sandbox'lı olsa da backend de temizler). Görsel/stil (style, img data:) korunur.
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
      else if (l.group === 'vergi' || l.group === 'vergi-sorumlu') { dKdv += amt; hasLine = true; }
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
            kb.map((b: any) => `<tr><td>%${esc(String(b.oran ?? b.rate ?? 0))}</td><td class="num">${esc(fmtTL(b.matrah ?? b.base))}</td><td class="num">${esc(fmtTL(b.tutar ?? b.amount))}</td></tr>`).join('')
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
      // userEdited=true: kullanıcı elle düzeltti → rematch/Yeniden Analiz bu belgenin işletme
      //   sınıfını ARTIK EZMESİN (auto-sınıf tazelenir, elle-düzeltme korunur).
      data.ocrData = { ...curOcr, isletme: { ...body.isletme, userEdited: true } };
    }
    // Tevkifat işlem türü (Mihsap tarzı editör): kullanıcının seçtiği resmi kod + oran kalıcılaşır.
    if ('tevkifat' in body && body.tevkifat && typeof body.tevkifat === 'object') {
      const curOcr2: any = data.ocrData || (before as any)?.ocrData || {};
      data.ocrData = {
        ...curOcr2,
        tevkifat: {
          kod: String((body.tevkifat as any).kod || '').trim(),
          oran: String((body.tevkifat as any).oran || '').trim(),
        },
      };
    }
    // MÜKERRER İŞARETİNİ YALNIZ mükerrer-alanları gelince yeniden hesapla. Kullanıcı sadece satırları
    //   (lines) düzenlediğinde belgeNo/VKN body'de gelmez → eskiden duplicate null dönüp mükerrer işareti
    //   SESSİZCE siliniyordu. Bu alanlar body'de yoksa mevcut işareti KORU (data'ya hiç yazma).
    const dedupFieldsPresent = ['belgeNo', 'sellerVkn', 'buyerVkn', 'totalAmount', 'taxpayerId']
      .some((k) => k in body);
    if (dedupFieldsPresent) {
      const duplicate = await this.findDuplicate(tenantId, {
        taxpayerId: 'taxpayerId' in body ? body.taxpayerId : (before as any).taxpayerId,
        belgeNo: 'belgeNo' in body ? body.belgeNo : (before as any).belgeNo,
        sellerVkn: 'sellerVkn' in body ? body.sellerVkn : (before as any).sellerVkn,
        buyerVkn: 'buyerVkn' in body ? body.buyerVkn : (before as any).buyerVkn,
        totalAmount: 'totalAmount' in body ? body.totalAmount : (before as any).totalAmount,
      }, id);
      data.duplicateOfId = duplicate?.duplicateOfId || null;
      data.duplicateReason = duplicate?.duplicateReason || null;
      data.duplicateSeverity = duplicate?.duplicateSeverity || null;
      if (duplicate && data.status === 'READY') data.status = 'NEEDS_REVIEW';
    }

    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id },
      data,
    });

    if (Array.isArray(body.lines)) {
      // KAYNAK DAMGASI (öğrenme kapısı için): kullanıcı editörde kodu DEĞİŞTİRDİYSE → KULLANICI
      //   (en güvenilir kaynak; öğrenme yalnız bundan + hafızadan yapılır). Kod aynı kaldıysa eski
      //   satırın kaynağı taşınır (otomatik atanmış kod, salt kaydetmekle "kullanıcı seçimi" OLMAZ —
      //   toplu-onay zehirlenmesinin editör versiyonunu önler).
      const oldLines: any[] = Array.isArray((before as any)?.lines) ? (before as any).lines : [];
      await (this.prisma as any).invoiceAccountingLine.deleteMany({ where: { documentId: id } });
      if (body.lines.length) {
        await (this.prisma as any).invoiceAccountingLine.createMany({
          data: body.lines.map((line, index) => {
            const grp = line.group || 'matrah';
            const old = oldLines.find((o: any) => String(o.group || '') === String(grp) && Number(o.orderNo) === index) || oldLines[index] || null;
            const oldCode = String(old?.accountCode || '').trim();
            const newCode = String(line.accountCode || '').trim();
            const kaynak = !newCode ? null : (oldCode === newCode ? (old?.kaynak ?? null) : 'KULLANICI');
            return {
              documentId: id,
              group: grp,
              accountCode: line.accountCode || null,
              description: line.description || null,
              rate: line.rate || null,
              kaynak,
              debit: parseDecimal(line.debit),
              credit: parseDecimal(line.credit),
              orderNo: index,
            };
          }),
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
    // numFromOcr: upload-OCR yolunda kdvTevkifat TR-biçimli STRING gelir ("1.894,00") — Number() NaN
    //   verip tevkifatlı belgeyi kontrolden kaçırıyordu.
    const tevkifatli = this.numFromOcr(ocrData?.kdvTevkifat) > 0 || Number(ocrData?.tevkifatOrani || 0) > 0 || ocrData?.tevkifatHint === true;
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
    let fixedAsset = this.detectFixedAsset(ocrData, tpForAsset);
    // DEMİRBAŞ HADDİ: bedel KDV hariç haddin altındaysa demirbaş uyarısı (FIXED_ASSET_MANUAL) verme —
    //   doğrudan gider yazılır (matcher de 770'e yönlendirir; ikisi tutarlı).
    if (fixedAsset.is && this.demirbasHaddiAltinda(ocrData, fixedAsset.reason)) fixedAsset = { is: false, reason: '' };

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
      kalemler: Array.isArray(ocrData?.kalemler) ? ocrData.kalemler : null,  // denetim: çok-oranlı çökme
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

  async approve(tenantId: string, id: string, userId?: string, force?: boolean) {
    const doc = await this.get(tenantId, id);

    // (AI denetçi kapısı kaldırıldı — kullanıcı talebi 2026-07-27.)

    // İşletme defteri mi? (tek-taraflı — hesap planı/kodu YOK, denge aranmaz)
    const tp: any = (doc as any).taxpayerId
      ? await (this.prisma as any).taxpayer.findFirst({ where: { id: (doc as any).taxpayerId, tenantId }, select: { defterTuru: true, mihsapDefterTuru: true, naceKodu: true, faaliyetAciklama: true } })
      : null;
    const isIsletme = isIsletmeLedger(tp?.defterTuru, tp?.mihsapDefterTuru);

    if (isIsletme) {
      const ready = isletmeDocumentReady(doc);
      if (!isletmeAmountReady(doc)) throw new BadRequestException('Bu belge onaylanamaz — tutar okunamamış. Önce "AI ile oku" ile tutarları çıkar.');
      if (!ready.ok) throw new BadRequestException(`Bu belge onaylanamaz — İşletme defteri için ${ready.reason}. Muhasebeleştir ekranında belge/kayıt türünü seç.`);
      const data: any = {
        status: 'APPROVED', approvedBy: userId || null, approvedAt: new Date(),
        lucaStatus: (doc as any).taxpayerId ? 'QUEUED' : 'NOT_STARTED',
        lucaErrorMessage: (doc as any).taxpayerId ? null : 'Mukellef secilmedigi icin Luca\'ya aktarilamaz',
        ocrData: { ...((doc as any).ocrData || {}), isletme: isletmeWithBelgeDefaults(doc) },
      };
      await (this.prisma as any).invoiceAccountingDocument.update({ where: { id }, data });
      await this.logAudit(tenantId, userId, 'APPROVE', id, { status: doc.status }, { status: 'APPROVED', isletme: true });
      return this.get(tenantId, id);
    }

    // Boş hesap kodu (ör. cari) ile onaylama YASAK — Luca'ya eksik fiş gitmesin.
    const blankLine = (doc.lines || []).find((l: any) => !String(l.accountCode || '').trim());
    if (blankLine) {
      const grpAd = String(blankLine.group) === 'cari' ? 'Cari hesap' : String(blankLine.group) === 'vergi' ? 'KDV hesabı' : String(blankLine.group) === 'vergi-sorumlu' ? 'Sorumlu sıfatıyla KDV hesabı' : 'Gelir/gider hesabı';
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

  /** TOPLU ONAY (tek HTTP çağrısı) — frontend'in belge-başına 50 ayrı istek atmasının yerini alır.
   *  Her belge sırayla mevcut approve'dan geçer (tüm kontroller aynen). Denetimi HİÇ olmayan belge
   *  onaylanmadan atlanır (sebep 'denetim-bekleniyor') ve denetim üretimi ARKA PLANDA tetiklenir;
   *  denetçi "yanlis" dediyse atlanır (sebep 'denetim-yanlis'); öğrenilmiş hafızayla çelişen belge
  *  atlanır (sebep 'hafiza-celiski'). force=true hepsini geçer. */
  async approveBatch(tenantId: string, ids: string[], userId?: string, force?: boolean) {
    const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map((v: any) => String(v || '').trim()).filter(Boolean)));
    if (!list.length) throw new BadRequestException('Onaylanacak belge listesi boş.');
    if (list.length > 200) throw new BadRequestException('Tek seferde en fazla 200 belge onaylanabilir.');
    let approved = 0;
    const skipped: Array<{ id: string; belgeNo?: string; reason: string }> = [];
    for (const id of list) {
      let belgeNo: string | undefined;
      try {
        const doc: any = await this.get(tenantId, id);
        belgeNo = String(doc.belgeNo || '').trim() || undefined;
        if (String(doc.status) === 'APPROVED') {
          skipped.push({ id, belgeNo, reason: 'zaten onaylı' });
          continue;
        }
        const ocr: any = doc.ocrData || {};
        // (AI denetçi kaldırıldı — 'denetim-bekleniyor' ve 'denetim-yanlis' kapıları çıkarıldı, 2026-07-27.)
        // SAPMA KUYRUĞU: rematch'in yazdığı HAFIZA_CELISKI uyarılı belge toplu onayda atlanır —
        //   öğrenilmiş güçlü hafızayla çelişen eşleştirme sessizce Luca'ya gitmesin. Tekil onay
        //   (kullanıcı belgeyi açıp bakarak) engellenmez; force=true toplu geçişi de açar.
        const uyList: any[] = Array.isArray(ocr.uyarilar) ? ocr.uyarilar : [];
        const celiski = uyList.find((u: any) => String(u?.kod || '') === 'HAFIZA_CELISKI');
        if (celiski && force !== true) {
          skipped.push({ id, belgeNo, reason: 'hafiza-celiski' });
          continue;
        }
        await this.approve(tenantId, id, userId, force);
        approved++;
      } catch (e: any) {
        skipped.push({ id, belgeNo, reason: String(e?.message || e || 'onay hatası') });
      }
    }
    return { approved, skipped };
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
    // İÇERİK İMZASI: bu faturanın kalem içeriğinden türet (VendorMemoryService.buildIcerikImza — okuma
    //   tarafıyla AYNI fonksiyon). Böylece "bu satıcıdan + bu içerikten → bu hesap" öğrenilir; aynı
    //   satıcının farklı içerikli faturası ayrı kayda düşer (kullanıcı talebi: içeriğe göre hafıza).
    const kalemAdlari = Array.isArray((doc.ocrData as any)?.kalemler) ? (doc.ocrData as any).kalemler.map((k: any) => k?.ad) : [];
    const icerikImza = VendorMemoryService.buildIcerikImza(kalemAdlari);
    const seen = new Set<string>();
    for (const l of matrahLines) {
      const code = String(l.accountCode || '').trim();
      if (!code || blocked(code)) continue;
      // ÖĞRENME KAPISI (R4 — zehirli hafızanın ana musluğu): kodun KAYNAĞINA bakılır. Yalnız
      //   KULLANICI (editörde elle seçilen/değiştirilen) ve HAFIZA (zaten öğrenilmiş kararın
      //   pekişmesi) öğrenilir. AI/KURAL/VARSAYILAN atamaları toplu onayda fark edilmeden geçerse
      //   hafızaya YAZILMAZ — sistemin kendi tahminini kendine "öğrenilmiş" diye geri beslemesi biter.
      //   (kaynak=null eski satırlar da öğrenilmez; kullanıcı editörden ya da Kurallar'dan öğretir.)
      const src = String((l as any).kaynak || '').toUpperCase();
      if (src !== 'KULLANICI' && src !== 'HAFIZA') continue;
      const rate = String(l.rate || '').replace(/[^0-9]/g, '') || null;
      const key = `${code}|${rate || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Hem içerik-imzalı (spesifik) HEM satıcı-geneli (imzasız) kayıt yaz → geriye-uyum + içerik-öğrenme.
      await this.vendorMemory.recordDecision({
        tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'fatura',
        kategori: code, altKategori: rate, icerikImza, taxpayerId: doc.taxpayerId,
      });
      if (icerikImza) {
        await this.vendorMemory.recordDecision({
          tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'fatura',
          kategori: code, altKategori: rate, icerikImza: null, taxpayerId: doc.taxpayerId,
        }).catch(() => {});
      }
    }

    // CARI ÖĞRENME: müşavirin seçtiği cari hesabı (120/320/329/331) VKN'ye bağla.
    // altKategori='CARI' işareti matrah kararlarından ayırır. Sonraki faturalarda
    // pickCariMemoryAccount bu kodu otomatik getirir → isim tahmini gerekmez.
    const cariLine = (doc.lines || []).find((l: any) => String(l.group || '').toLowerCase() === 'cari');
    const cariCode = String(cariLine?.accountCode || '').trim();
    // Cari öğrenme kapısı: KULLANICI/HAFIZA + VKN (plandaki VKN birebir eşleşmesi kesin bilgidir).
    //   İSİM tahmini ve kural atamaları öğrenilmez — poisoned cari vakalarının (MERT REKLAM) girişi buydu.
    const cariSrc = String((cariLine as any)?.kaynak || '').toUpperCase();
    if (cariCode && /^(120|320|329|331)/.test(cariCode) && ['KULLANICI', 'HAFIZA', 'VKN'].includes(cariSrc)) {
      await this.vendorMemory.recordDecision({
        tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'fatura',
        kategori: cariCode, altKategori: 'CARI', taxpayerId: doc.taxpayerId,
      }).catch(() => {});
    }

    // İŞLETME DEFTERİ ÖĞRENME: kullanıcı işletme sınıfını (Kayıt Türü/Alt Türü) ELLE düzelttiyse
    //   (userEdited işareti editörden gelir) satıcıya öğret — sonraki faturalarda pickIsletmeMemory
    //   AI/kural tahmininden ÖNCE bunu uygular. Elle düzeltme açık irade → boost ile eşik anında geçer.
    const islObj: any = (doc.ocrData as any)?.isletme;
    if (islObj && islObj.userEdited === true && String(islObj.kayitTuruKod || '').trim()) {
      await this.vendorMemory.recordDecision({
        tenantId, firmaKimlikNo, firmaUnvan, kararTipi: 'isletme',
        kategori: String(islObj.kayitTuruKod).trim(),
        altKategori: String(islObj.kayitAltKod || '').trim() || null,
        icerikImza, taxpayerId: doc.taxpayerId,
        onayBoost: 2,
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
    const isIsletme = isIsletmeLedger(tp?.defterTuru, tp?.mihsapDefterTuru);
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
        return isletmeDocumentReady(d).ok;
      }
      const sd = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const sc = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      const blankCode = lines.some((l: any) => (Number(l.debit || 0) + Number(l.credit || 0)) > 0 && !String(l.accountCode || '').trim());
      return lines.length && Math.abs(sd - sc) <= 0.02 && !blankCode;
    });
    if (!docs.length) throw new BadRequestException(isIsletme ? 'Aktarılacak (belge/kayıt türü tamam) İşletme belgesi yok' : 'İndirilecek (dengeli, kodlu) belge yok');
    const kind: 'ALIS' | 'SATIS' = q.direction === 'SATIS' || (!q.direction && String(docs[0].invoiceKind).toUpperCase() === 'SATIS') ? 'SATIS' : 'ALIS';
    const toInvoicePayload = (d: any) => ({
      documentId: d.id, documentType: d.documentType, invoiceKind: d.invoiceKind, belgeNo: d.belgeNo,
      seriNo: d.seriNo, faturaTarihi: d.faturaTarihi ? d.faturaTarihi.toISOString() : null,
      sellerVkn: d.sellerVkn, buyerVkn: d.buyerVkn, vendorName: d.vendorName, customerName: d.customerName,
      totalAmount: d.totalAmount ? String(d.totalAmount) : null, currency: d.currency || 'TL',
      exchangeRate: d.exchangeRate != null ? String(d.exchangeRate) : null,
      isletme: isIsletme ? isletmeWithBelgeDefaults(d) : (d.ocrData?.isletme || null),
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
    const isIsletme = isIsletmeLedger(taxpayerRecord?.defterTuru, taxpayerRecord?.mihsapDefterTuru);

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
        if (isletmeDocumentReady(d).ok) return true;
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
      exchangeRate: d.exchangeRate != null ? String(d.exchangeRate) : null,
      isletme: isIsletme ? isletmeWithBelgeDefaults(d) : (d.ocrData?.isletme || null),
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
            format: isIsletme ? 'ISLETME_CSV' : 'BATCH_EXCEL',
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

      // ÇİFT-TIK KİLİDİ: Belgeleri ancak HÂLÂ aktarıma uygunsalar (QUEUED/FAILED/NOT_STARTED) atomik
      //   olarak bu job'a bağla. Eşzamanlı ikinci tık aynı belgeleri POSTING'de bulur → count 0 döner,
      //   o job boşa üretilmiştir (silinir). Böylece aynı fatura için iki job üretilmez.
      const claim = await (this.prisma as any).invoiceAccountingDocument.updateMany({
        where: { id: { in: g.docs.map((d: any) => d.id) }, lucaStatus: { in: ['QUEUED', 'FAILED', 'NOT_STARTED'] } },
        data: {
          lucaStatus: 'POSTING',
          lucaJobId: job.id,
          lucaErrorMessage: null,
          lucaAttemptCount: { increment: 1 },
        },
      });
      if (!claim || claim.count === 0) {
        // Bu grubun tüm belgeleri başka bir eşzamanlı aktarımca kapılmış → boş job'u geri al.
        await (this.prisma as any).lucaFetchJob.delete({ where: { id: job.id } }).catch(() => {});
        continue;
      }

      jobs.push({ jobId: job.id, kind: g.kind, period: dominantPeriod, documentCount: claim.count });
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

    // Belgenin lucaStatus'unu FAILED'a çek + eski job bağını kopar. POSTING'de takılı kalmış belge
    //   batchPostToLuca filtresine (QUEUED/FAILED/NOT_STARTED) girmezdi → "aktarılabilir belge yok"
    //   hatası veriyordu. Sıfırlayınca tekrar aktarıma girer.
    await (this.prisma as any).invoiceAccountingDocument.updateMany({
      where: { id, tenantId },
      data: { lucaStatus: 'FAILED', lucaJobId: null, lucaErrorMessage: null },
    }).catch(() => {});

    return this.batchPostToLuca(
      tenantId,
      { taxpayerId: doc.taxpayerId, documentIds: [id] },
      userId,
    );
  }

  async remove(tenantId: string, id: string, userId?: string) {
    const doc = await this.get(tenantId, id);
    // Luca'ya aktarılmış/aktarılıyor belge silinemez (reopen ile aynı koruma) — aksi halde Luca'da
    //   fiş kalır, portalda kayıt gider → mutabakat bozulur. Önce geri al, sonra sil.
    if (['POSTED', 'POSTING'].includes(String((doc as any).lucaStatus || ''))) {
      throw new BadRequestException('Luca\'ya aktarılmış belge silinemez, önce geri alın');
    }
    // Faz C: denetim izi — silinen belgenin künyesini sakla (kim/ne sildi).
    await this.logAudit(tenantId, userId, 'DELETE', id,
      { belgeNo: doc.belgeNo, invoiceKind: doc.invoiceKind, totalAmount: String(doc.totalAmount ?? ''), status: doc.status }, null);
    await (this.prisma as any).invoiceAccountingDocument.delete({ where: { id } });
    await (this.prisma as any).eFaturaInbox.updateMany({
      where: { tenantId, documentId: id },
      data: { documentId: null, isTransferred: false, processedAt: null },
    }).catch(() => {});
    const sourceRef = String((doc as any).sourceRefId || '').trim();
    if (sourceRef) {
      await (this.prisma as any).eFaturaInbox.updateMany({
        where: {
          tenantId,
          taxpayerId: (doc as any).taxpayerId,
          OR: [
            { uuid: sourceRef },
            { ettn: sourceRef },
            { faturaNo: sourceRef },
          ],
        },
        data: { documentId: null, isTransferred: false, processedAt: null },
      }).catch(() => {});
    }
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
    // Mükellef-özel isActive:false → resolveRuntimeConfig note'u '__inactive__' yapar. Bunu PASİF say
    //   (kimlik bilgisi tam olsa bile çekim yapılmasın) — eskiden yalnız not yazılıyor, kimse bakmıyordu.
    if (cfg.note === '__inactive__') return 'Bu mükellef için entegratör pasif (kapatılmış)';
    if (cfg.provider === 'PARASUT') {
      // client_id/client_secret ofis geneli TEK uygulama anahtarı → env'den (PARASUT_CLIENT_ID/SECRET)
      // fallback ile gelebilir; mükellef başına sadece kullanıcı+şifre+Firma No gerekir.
      const clientId = process.env.PARASUT_CLIENT_ID || cfg.apiKey;
      const clientSecret = process.env.PARASUT_CLIENT_SECRET || cfg.apiSecret;
      const missing: string[] = [];
      if (!clientId) missing.push('client_id');
      if (!clientSecret) missing.push('client_secret');
      if (!cfg.username) missing.push('kullanici');
      if (!cfg.password) missing.push('sifre');
      // Firma No ARTIK ZORUNLU DEĞİL — girilmezse /me ile otomatik bulunur (Mihsap gibi).
      return missing.length ? `Parasut bilgileri eksik: ${missing.join(', ')}` : null;
    }
    if (cfg.provider === 'UYUMSOFT' && (!cfg.username || !cfg.password)) return 'Uyumsoft kullanici/sifre eksik';
    if (cfg.provider === 'TURMOB_EFATURA' && (!cfg.username || !cfg.password)) return 'TÜRMOB TCKN ve parola gerekli';
    if (I2I_SOAP_PROVIDERS.has(cfg.provider) && (!cfg.username || !cfg.password)) return 'Izibiz/i2i kullanici/sifre eksik';
    // Turkcell e-Şirket (isim360): API anahtarı (apiKey) VEYA kullanıcı+şifre yeter; servis adresi varsayılandan gelir.
    if (cfg.provider === 'TURKCELL') {
      if (!cfg.apiKey && !(cfg.username && cfg.password)) return 'Turkcell API anahtarı veya kullanıcı+şifre gerekli';
      return null;
    }
    // eLogo posta kutusu web servisi: web servis kullanıcı kodu + şifresi yeter; servis adresi varsayılandan.
    if (cfg.provider === 'ELOGO') {
      if (!cfg.username || !cfg.password) return 'eLogo web servis kullanıcı adı (kod) ve şifresi gerekli';
      return null;
    }
    if (cfg.provider !== 'UYUMSOFT' && cfg.provider !== 'TURMOB_EFATURA' && !I2I_SOAP_PROVIDERS.has(cfg.provider) && !cfg.baseUrl) return 'API adresi eksik';
    if (!cfg.username && !cfg.password && !cfg.apiKey && !cfg.apiSecret && !cfg.baseUrl) return 'Kimlik bilgisi eksik';
    return null;
  }

  private providerStubConfig(provider: string): RuntimeIntegrationConfig {
    return {
      provider,
      label: provider,
      baseUrl: PROVIDER_DEFAULT_BASE_URL[provider] || '',
      username: '',
      password: '',
      apiKey: '',
      apiSecret: '',
      senderVkn: '',
      accountId: '',
      note: '',
    };
  }

  private async resolveRuntimeConfigForProvider(
    tenantId: string,
    taxpayerId: string,
    provider: string,
  ): Promise<RuntimeIntegrationConfig | null> {
    const catalog = INTEGRATOR_CATALOG.find((item) => item.provider === provider)
      || INTEGRATOR_CATALOG.find((item) => item.provider === 'TURMOB_EFATURA');
    if (!catalog) return null;
    const row = await (this.prisma as any).integrationConnection.findFirst({
      where: { tenantId, provider, isActive: true },
      select: { id: true, provider: true, config: true, isActive: true },
    });
    const cfg = this.resolveRuntimeConfig(row, catalog as any, taxpayerId);
    return cfg && !this.providerCredentialProblem(cfg) ? cfg : null;
  }

  private cleanProviderText(value: any): string | null {
    const text = String(value ?? '').trim();
    if (!text || /^(nan|null|undefined|-)$/i.test(text)) return null;
    return text;
  }

  private numericProviderAmount(value: any): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
      const n = value.toNumber();
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
    if (!text) return null;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  private providerKey(value: any): string | null {
    const text = this.cleanProviderText(value);
    if (!text) return null;
    const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized || null;
  }

  private providerAmountKey(value: any): string | null {
    const n = this.numericProviderAmount(value);
    return n == null ? null : n.toFixed(2);
  }

  private addProviderLookupKey(map: Map<string, ProviderInvoicePayload>, key: any, payload: ProviderInvoicePayload) {
    const normalized = this.providerKey(key);
    if (normalized && !map.has(normalized)) map.set(normalized, payload);
  }

  private buildProviderPayloadLookup(payloads: ProviderInvoicePayload[]): Map<string, ProviderInvoicePayload> {
    const byKey = new Map<string, ProviderInvoicePayload>();
    for (const payload of payloads) {
      const parsed = this.parseProviderUblInvoice(payload.xml) || this.regexProviderInvoiceFallback(payload.xml);
      this.addProviderLookupKey(byKey, payload.externalId, payload);
      this.addProviderLookupKey(byKey, parsed?.ettn, payload);
      this.addProviderLookupKey(byKey, parsed?.faturaNo, payload);
      const totalKey = this.providerAmountKey(parsed?.toplamTutar ?? ((parsed?.matrah || 0) + (parsed?.kdvTutari || 0)));
      const faturaKey = this.providerKey(parsed?.faturaNo);
      if (faturaKey && totalKey) this.addProviderLookupKey(byKey, `${faturaKey}:${totalKey}`, payload);
    }
    return byKey;
  }

  private providerPayloadForInboxRow(row: any, lookup: ProviderPayloadLookup | null | undefined): ProviderInvoicePayload | null {
    if (!lookup?.byKey?.size) return null;
    const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
    const rawSummary = raw?.turmobSummaryRaw && typeof raw.turmobSummaryRaw === 'object' ? raw.turmobSummaryRaw : {};
    const totalKey = this.providerAmountKey(row?.toplam ?? rawSummary?.OdenecekTutar ?? rawSummary?.OdenecekTutarFormatted);
    const candidates = [
      row?.ettn,
      row?.uuid,
      row?.faturaNo,
      raw?.turmobRowId,
      rawSummary?.Ettn,
      rawSummary?.FaturaNo,
      rawSummary?.IadeFaturaNo,
      rawSummary?.IdFaturaGelen,
      rawSummary?.IdFaturaGiden,
      rawSummary?.IdFaturaArsiv,
    ];
    for (const candidate of candidates) {
      const key = this.providerKey(candidate);
      if (key && lookup.byKey.has(key)) return lookup.byKey.get(key)!;
      const keyWithAmount = key && totalKey ? this.providerKey(`${key}:${totalKey}`) : null;
      if (keyWithAmount && lookup.byKey.has(keyWithAmount)) return lookup.byKey.get(keyWithAmount)!;
    }
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
      channel?: string;
      targetRows?: any[];
    },
  ): Promise<ProviderInvoicePayload[]> {
    if (cfg.provider === 'UYUMSOFT') return this.fetchUyumsoftInvoices(cfg, opts);
    if (I2I_SOAP_PROVIDERS.has(cfg.provider) || /EInvoiceWS/i.test(cfg.baseUrl)) {
      return this.fetchI2iInvoices(cfg, opts);
    }
    if (cfg.provider === 'TURMOB_EFATURA') return this.fetchTurmobPortalInvoices(cfg, opts);
    if (cfg.provider === 'PARASUT') return this.fetchParasutInvoices(cfg, opts);
    if (cfg.provider === 'TURKCELL') return this.fetchTurkcellInvoices(cfg, opts);
    if (cfg.provider === 'ELOGO') return this.fetchElogoInvoices(cfg, opts);
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

  // TÜRMOB portalı (turmobefatura.luca.com.tr) yurtdışı IP'yi (Railway) ENGELLİYOR → CONNECT_TIMEOUT.
  //   Bu yüzden TÜRMOB istekleri Türkiye'deki çıkış proxy'sinden (TURMOB_PROXY_URL) geçirilir; istek
  //   Türkiye IP'den çıkar, cevap Railway'e döner. Proxy yoksa (env boş) doğrudan gider (yerelde çalışır).
  private _turmobDispatcher: any;
  private turmobFetch(url: string, init: any = {}): Promise<Response> {
    if (this._turmobDispatcher === undefined) {
      const purl = String(process.env.TURMOB_PROXY_URL || '').trim();
      if (purl) {
        try {
          this._turmobDispatcher = new (require('undici').ProxyAgent)(purl);
          this.logger.log('TÜRMOB proxy aktif (Türkiye çıkış)');
        } catch (e: any) {
          this.logger.warn(`TÜRMOB proxy kurulamadı: ${e?.message}`);
          this._turmobDispatcher = null;
        }
      } else {
        this._turmobDispatcher = null;
      }
    }
    return fetch(url, this._turmobDispatcher ? { ...init, dispatcher: this._turmobDispatcher } : init) as any;
  }
  // TÜRMOB TEK-OTURUM: portal aynı TCKN ile ikinci kez login olunca öncekini düşürür.
  //   Bu kilit, aynı TCKN'ye ait tüm TÜRMOB işlemlerini (liste sorgu, arka plan indirme,
  //   Aktar indirmesi) SIRAYLA çalıştırır → eşzamanlı login = oturum çakışması olmaz.
  //   Farklı TCKN'ler birbirini bloklamaz (anahtar = TCKN).
  private turmobAccessLocks = new Map<string, Promise<void>>();
  private async withTurmobAccess<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = String(key || 'turmob-global');
    const prev = this.turmobAccessLocks.get(k) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.turmobAccessLocks.set(k, prev.then(() => gate));
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * TÜRMOB sorgusundan SONRA çalışan ARKA PLAN indirme: PENDING_DOWNLOAD durumundaki
   * satırların XML+görselini TEK login ile toplu indirir, satırları READY/MISSING yapar.
   * "Aktar" bu satırları hazır bulur → tekrar indirmez (iki kere iş yok). withTurmobAccess
   * ile serileştirilir → Aktar/sorgu ile eşzamanlı login olmaz (tek-oturum çakışması yok).
   * İlerleme ayrı tabloda tutulmaz; satırların documentDownloadStatus'undan türetilir
   * (frontend sayacı bunu okur). Hata = sessiz (satır MISSING kalır, Aktar tekrar dener).
   */
  async prefetchTurmobInboxDocuments(
    tenantId: string,
    taxpayerId: string,
    opts: { direction: 'IN' | 'OUT'; channel: string; period?: string; periodLabel?: string },
  ): Promise<void> {
    try {
      const channel = String(opts.channel || '').toUpperCase();
      const direction: 'ALIS' | 'SATIS' = opts.direction === 'IN' ? 'ALIS' : 'SATIS';
      const cfg = await this.resolveRuntimeConfigForProvider(tenantId, taxpayerId, 'TURMOB_EFATURA');
      if (!cfg || !cfg.username || !cfg.password) return;
      const taxpayer = await (this.prisma as any).taxpayer.findFirst({
        where: { id: taxpayerId, tenantId },
        select: { id: true, companyName: true, taxNumber: true },
      });
      if (!taxpayer) return;
      const period = this.monthRange(opts.period);
      const candidates = await (this.prisma as any).eFaturaInbox.findMany({
        where: { tenantId, taxpayerId, entegrator: 'TURMOB_EFATURA', direction: opts.direction },
        select: { id: true, uuid: true, ettn: true, faturaNo: true, faturaDate: true, ublXmlRaw: true, rawJson: true },
      });
      const targets = candidates.filter((row: any) => {
        const raw = row.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        if (String(raw.channel || '').toUpperCase() !== channel) return false;
        // periodLabel (varsa) gerçek sorgu etiketi — serbest tarih aralığında "from_to" biçimindedir.
        const wantLabel = String(opts.periodLabel || opts.period || '');
        if (wantLabel && String(raw.period || '') !== wantLabel) return false;
        const xml = String(row.ublXmlRaw || '').trim();
        const status = String(raw.documentDownloadStatus || '').toUpperCase();
        return !xml
          || this.isSyntheticTurmobInboxXml(xml)
          || !this.hasOriginalProviderVisual(raw.originalVisual, 'TURMOB_EFATURA')
          || status === 'PENDING_DOWNLOAD'
          || status === 'MISSING'
          || status === 'SUMMARY_ONLY';
      });
      if (!targets.length) return;
      this.logger.log(`TURMOB arka plan indirme basladi: ${channel} ${period.donem} · ${targets.length} belge`);
      // HIBRIT INDIRME:
      //  1) TEK login ile DOGRUDAN indir — belge kimligi = turmobRowId (= IdFaturaGelen/Giden/Arsiv, liste
      //     satirinda ZATEN SAKLI; InvoiceId olarak kullanilir). Liste TEKRAR CEKILMEZ → HIZLI.
      //  2) Dogrudan inemeyen satirlar (kimliksiz/oturum/gecersiz) icin proven fetchTurmobPortalInvoices
      //     (kendi zengin cekisi + fallback) ikinci tur → GARANTI iner.
      //  Boylece: kimlik varsa hizli, yoksa proven. Hata=satir MISSING (takilmaz). Sayac kademeli dolar.
      const BASE = this.TURMOB_BASE;
      const directInOrOut = opts.direction === 'IN' ? 'True' : 'False';
      const refererPath = channel === 'IN_EFATURA' ? '/Inbox'
        : channel === 'OUT_EARSIV' ? '/OutgoingInvoice/OutgoingArchiveList' // GERÇEK e-Arşiv sayfası (ağ izleme)
        : '/OutgoingInvoice/OutgoingInvoiceList';
      // e-ARŞİV indirme param adı FARKLI: ?ArchiveId=<IdArsiv> (e-Fatura ?InvoiceId=<IdFatura>).
      //   TÜRMOB'da fetch ile doğrulandı: GetInvoiceXml?InOrOut=False&ArchiveId=<IdArsiv> → 200 UBL.
      const idParam = channel === 'OUT_EARSIV' ? 'ArchiveId' : 'InvoiceId';
      const idOf = (row: any): string => {
        const raw = row.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        let id = String(raw.turmobRowId || raw.turmobIdFatura || '').replace(/\D/g, '');
        if (!id) id = String(this.turmobField(raw.turmobSummaryRaw || {}, ['IdFaturaGelen', 'IdFaturaGiden', 'IdFaturaArsiv', 'IdArsiv', 'IdArsivEk', 'InvoiceId', 'IdFatura', 'Id']) || '').replace(/\D/g, '');
        return id;
      };
      const applyDownloaded = async (row: any, downloaded: any) => {
        const raw = row.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        const parsed = this.parseProviderUblInvoice(downloaded.xml) || this.regexProviderInvoiceFallback(downloaded.xml);
        const storedVisual = this.providerStoredVisual(downloaded);
        const hasVisual = this.hasOriginalProviderVisual(storedVisual, 'TURMOB_EFATURA');
        // SAĞLAM UBL XML = belge HAZIR (görsel opsiyonel). Görsel inmese de XML'den belge oluşur,
        //   okuma/yön/satıcı XML'den gelir → "inemedi" değil "hazır". (TORA PETROL: 372KB XML iniyor,
        //   Detay görseli inmiyordu → eskiden MISSING; artık READY.) Sentetik liste-özeti XML hariç.
        const hasXml = !!String(downloaded.xml || '').trim() && !this.isSyntheticTurmobInboxXml(downloaded.xml);
        const ready = hasVisual || hasXml;
        const data: any = {
          ublXmlRaw: downloaded.xml,
          rawJson: {
            ...raw,
            needsDocumentDownload: !ready,
            documentDownloadStatus: ready ? 'READY' : 'MISSING',
            documentDownloadError: ready ? null : 'TURMOB orijinal XML/goruntu indirilemedi.',
            originalVisual: storedVisual || raw.originalVisual || null,
          },
        };
        if (parsed?.ettn) data.ettn = parsed.ettn;
        if (parsed?.saticiVergiNo) data.senderVkn = parsed.saticiVergiNo;
        if (parsed?.satici) data.senderTitle = parsed.satici;
        if (parsed?.aliciVergiNo) data.receiverVkn = parsed.aliciVergiNo;
        // Bozuk (NaN/bos) parse degeri MEVCUT dogru belge no'yu EZMESIN; mevcut da "NaN" ise (eski bozuk
        //   indirme) TEMIZLE → "—" goster ("NaN" yerine). (MENGERLER gibi belge no'su olmayan e-arsiv.)
        if (parsed?.faturaNo && !/^nan$/i.test(String(parsed.faturaNo).trim())) data.faturaNo = parsed.faturaNo;
        else if (/^nan$/i.test(String(row.faturaNo || '').trim())) data.faturaNo = null;
        if (parsed?.faturaTarihi) data.faturaDate = parsed.faturaTarihi;
        if (parsed?.matrah != null && Number.isFinite(Number(parsed.matrah))) data.matrah = String(parsed.matrah);
        if (parsed?.kdvTutari != null && Number.isFinite(Number(parsed.kdvTutari))) data.kdv = String(parsed.kdvTutari);
        const total = parsed ? (parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0))) : null;
        if (total != null && Number.isFinite(Number(total))) data.toplam = String(total);
        await (this.prisma as any).eFaturaInbox.update({ where: { id: row.id }, data });
        return ready;
      };
      const markMissing = (row: any, msg: string) => {
        const raw = row.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
        return (this.prisma as any).eFaturaInbox.update({ where: { id: row.id }, data: { rawJson: { ...raw, needsDocumentDownload: true, documentDownloadStatus: 'MISSING', documentDownloadError: msg } } });
      };
      let ok = 0, miss = 0;
      const handled = new Set<string>();
      const fallback: any[] = [];
      // ── 1. TUR: DOGRUDAN (turmobRowId ile, liste cekme yok) ──
      try {
        await this.withTurmobAccess(cfg.username, async () => {
          const cookie = await this.turmobLogin(cfg.username, cfg.password, cfg.senderVkn || undefined);
          const headers = { Cookie: cookie, 'User-Agent': 'MorenPortal/1.0', Accept: 'application/xml,text/xml,text/html,*/*', Origin: BASE, Referer: BASE + refererPath };
          const CONC = 6;
          for (let i = 0; i < targets.length; i += CONC) {
            await Promise.all(targets.slice(i, i + CONC).map(async (row: any) => {
              const id = idOf(row);
              if (!id) { fallback.push(row); return; }
              // XML (veri) — ayri timeout.
              let xml = '';
              const xctl = new AbortController();
              const xtm = setTimeout(() => { try { xctl.abort(); } catch { /* */ } }, 15000);
              try { xml = await (await this.turmobFetch(`${BASE}/Invoice/GetInvoiceXml?InOrOut=${directInOrOut}&${idParam}=${id}`, { headers, signal: xctl.signal })).text(); }
              catch { /* xml inmedi */ }
              finally { clearTimeout(xtm); }
              if (!/^\s*<\?xml|<[\w:]*Invoice\b/i.test(xml.slice(0, 400))) { fallback.push(row); return; }
              const payload: any = { xml };
              // GORSEL (orijinal fatura) — AYRI timeout + 2 DENEME (throttle'da gorsel agir, kolay duser →
              //   "veri var gorsel yok" (sari satir) azalsin). Inmezse satir fallback'e gider.
              for (let a = 0; a < 2 && !payload.htmlContent; a++) {
                const vctl = new AbortController();
                const vtm = setTimeout(() => { try { vctl.abort(); } catch { /* */ } }, 15000);
                try {
                  const vr = await this.turmobFetch(`${BASE}/Invoice/Detail?InOrOut=${directInOrOut}&${idParam}=${id}&IsPrint=True`, { headers, signal: vctl.signal });
                  if (vr.ok) {
                    const vis = await vr.text();
                    if (vis && /<(?:!doctype\s+html|html|body)\b/i.test(vis.slice(0, 3000)) && !/account\/login|name=["']password["']/i.test(vis) && /(Invoice|Fatura)/i.test(vis.slice(0, 30000))) {
                      payload.htmlContent = vis
                        .replace(/<script[^>]*>[\s\S]*?(?:window\.)?print\s*\([\s\S]*?<\/script>/gi, '')
                        .replace(/(?:window\.)?print\s*\(\s*\)/gi, 'void 0')
                        .replace(/\bonload\s*=\s*(["'])[^"']*?print[^"']*?\1/gi, '');
                    }
                  }
                } catch { /* tekrar dene */ }
                finally { clearTimeout(vtm); }
              }
              try {
                if (await applyDownloaded(row, payload)) { ok++; handled.add(row.id); }
                else { fallback.push(row); }
              } catch { fallback.push(row); }
            }));
            this.logger.log(`TURMOB dogrudan indirme ilerleme: ${ok}/${targets.length} indirildi · fallback ${fallback.length} · ${channel} ${period.donem}`);
          }
        });
      } catch (e: any) {
        this.logger.warn(`TURMOB dogrudan indirme oturum hatasi: ${e?.message || e}`);
        for (const row of targets) if (!handled.has(row.id) && !fallback.includes(row)) fallback.push(row);
      }
      // ── 2. TUR: FALLBACK (proven fetchTurmobPortalInvoices, dogrudan inemeyenler) ──
      const fallbackRows = fallback.filter((row) => !handled.has(row.id));
      if (fallbackRows.length) {
        this.logger.log(`TURMOB fallback (proven) basladi: ${fallbackRows.length} belge · ${channel} ${period.donem}`);
        const CHUNK = 20;
        for (let i = 0; i < fallbackRows.length; i += CHUNK) {
          const group = fallbackRows.slice(i, i + CHUNK);
          let payloads: ProviderInvoicePayload[] = [];
          let fetchError: string | null = null;
          try {
            payloads = await this.withTurmobAccess(cfg.username, () =>
              this.fetchTurmobPortalInvoices(cfg, { taxpayer, direction, period, limit: Math.min(Math.max(group.length, 1), 1000), channel, targetRows: group }),
            );
          } catch (e: any) {
            fetchError = e?.message || 'TURMOB belge indirilemedi';
            this.logger.warn(`TURMOB fallback grup hatasi: ${fetchError}`);
          }
          const lookup: any = { cfg, payloads, byKey: this.buildProviderPayloadLookup(payloads), error: fetchError };
          for (const row of group) {
            try {
              const downloaded = this.providerPayloadForInboxRow(row, lookup);
              if (downloaded) { if (await applyDownloaded(row, downloaded)) ok++; else miss++; }
              else { miss++; await markMissing(row, fetchError || 'TURMOB belge indirilemedi.'); }
            } catch (e: any) {
              miss++;
              this.logger.warn(`TURMOB fallback satir yazilamadi: ${row.faturaNo || row.uuid || row.id} ${e?.message || e}`);
            }
          }
          this.logger.log(`TURMOB fallback ilerleme: ${ok}/${targets.length} indirildi (eksik ${miss}) · ${channel} ${period.donem}`);
        }
      }
      this.logger.log(`TURMOB arka plan indirme bitti: ${channel} ${period.donem} · ${ok} indirildi · ${miss} eksik`);
    } catch (e: any) {
      this.logger.warn(`TURMOB arka plan indirme genel hata: ${e?.message || e}`);
    }
  }

  private async turmobLogin(vknTckn: string, password: string, matchVkn?: string): Promise<string> {
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
    //    Native fetch bağlantı kuramazsa "fetch failed" (TypeError) fırlatır — ekranda tek başına
    //    anlamsız. Gerçek nedeni (ETIMEDOUT/ECONNREFUSED/ENOTFOUND/TLS) ve hedef adresi göster ki
    //    "sunucudan Luca'ya çıkış engelli mi" ayırt edilebilsin (kök teşhis).
    let page: Response;
    try {
      page = await this.turmobFetch(BASE +'/account/login', { headers: { 'User-Agent': 'MorenPortal/1.0' } });
    } catch (e: any) {
      const host = BASE.replace(/^https?:\/\//, '');
      const code = String(e?.cause?.code || e?.code || '').trim();
      throw new Error(`TÜRMOB sunucusuna ulaşılamadı (${host})${code ? ` — ${code}` : ' — bağlantı kurulamadı'}. Sunucunun bu adrese ağ erişimi engellenmiş olabilir.`);
    }
    addCookies(pick(page));
    const html = await page.text();
    const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1]
      || html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/)?.[1];
    if (!token) throw new Error('TÜRMOB giriş sayfası okunamadı (antiforgery token yok)');
    // 2) POST login — CompanyId opsiyonel (çok-firmalı TCKN için).
    const postLogin = (companyId?: string) => {
      const fields: Record<string, string> = { VknTckn: String(vknTckn).trim(), Password: password, __RequestVerificationToken: token, RememberMe: 'true' };
      if (companyId) fields.CompanyId = companyId;
      return this.turmobFetch(BASE +'/Account/Login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(), 'User-Agent': 'MorenPortal/1.0' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
      });
    };
    let loginRes = await postLogin();
    addCookies(pick(loginRes));
    // ÇOK-FİRMA (İLGİ OTO / ÖZ ELA): tek TCKN altında birden çok firma varsa TÜRMOB, CompanyId olmadan
    //   girişi kabul etmez (redirect yerine 200 login sayfası döner). İlk giriş 302 DEĞİLSE, mükellefin
    //   ADIna göre firma listesinden IdFirma'yı bul → CompanyId ile TEKRAR gir. Firma listesi (GetCompanyList)
    //   VKN döndürmediği için eşleştirme ADla yapılır (matchVkn'den mükellef adını DB'den buluruz). Tek-firmalı
    //   hesaplar ilk POST'ta 302 alıp buraya HİÇ girmez (sıfır regresyon). Belirsizse mevcut hata akışına düşer.
    if (loginRes.status !== 302 && loginRes.status !== 301) {
      let matchName = '';
      const vkn = String(matchVkn || '').replace(/\D/g, '');
      if (vkn) {
        try {
          const tp = await (this.prisma as any).taxpayer.findFirst({ where: { taxNumber: vkn }, select: { companyName: true } });
          matchName = String(tp?.companyName || '').trim();
        } catch (e: any) { this.logger.warn(`[TURMOB-COMPANY] mükellef adı bulunamadı: ${e?.message || e}`); }
      }
      this.logger.log(`[TURMOB-COMPANY] ilk giriş ${loginRes.status} (çok-firma olabilir); matchVkn=${vkn || 'YOK'} ad="${matchName}"`);
      if (matchName) {
        const companyId = await this.turmobResolveCompanyId(BASE, cookieHeader(), token, matchName).catch((e) => { this.logger.warn(`[TURMOB-COMPANY] resolve hata: ${e?.message || e}`); return null; });
        this.logger.log(`[TURMOB-COMPANY] resolve sonucu CompanyId=${companyId ?? 'YOK'}`);
        if (companyId) {
          const retry = await postLogin(companyId);
          addCookies(pick(retry));
          this.logger.log(`[TURMOB-COMPANY] CompanyId=${companyId} ile 2. giriş status=${retry.status}`);
          if (retry.status === 302 || retry.status === 301) {
            this.logger.log(`TÜRMOB çok-firma girişi: CompanyId=${companyId} ile giriş başarılı`);
            loginRes = retry;
          }
        }
      }
    }
    // Başarılı giriş = redirect (302/301). Redirect DIŞI (çoğunlukla 200) dönerse eskiden körlemesine
    //   "TCKN/parola hatalı" deniyordu — bu güven kırıyordu ve GERÇEK nedeni (kontör bitti / hesap
    //   kilitli / captcha / parola değişti) gizliyordu. Ayrıca bazı hesaplarda giriş 302 yerine 200
    //   render dönebiliyor; o mükellefler boş yere reddediliyordu. Artık GÖVDE analiz edilir.
    if (loginRes.status !== 302 && loginRes.status !== 301) {
      const body = await loginRes.text().catch(() => '');
      // İki alan (VknTckn + Password) birlikte varsa login sayfası TEKRAR gelmiş = giriş reddedildi.
      const loginFormuVar = /name="?password"?/i.test(body) && /name="?vkntckn"?/i.test(body);
      const authCerezVar = [...cookieMap.keys()].some((k) => /auth|session|aspnet|aspxauth|luca/i.test(k));
      // TÜRMOB'un ekranda gösterdiği GERÇEK uyarı metni (validation-summary / hata kutusu). Kontör/kilit/
      //   captcha teşhisi YALNIZ bu metinden yapılır — TÜRMOB login sayfasının GENEL içeriğinde "kontör"
      //   kelimesi zaten 3 kez geçiyor (menü/tanıtım). Sayfa geneline bakmak YANLIŞ-POZİTİF verir: canlı
      //   kanıt — İLGİ OTO kimlik hatasında sayfadaki 'kontör' yüzünden yanlışlıkla "kontör yetersiz"
      //   deniyordu. Artık sadece TÜRMOB'un kendi uyarı cümlesine bakılır.
      const uyari = (
        body.match(/validation-summary[^>]*>[\s\S]*?<li[^>]*>\s*([^<]{3,220})/i)?.[1]
        || body.match(/class="[^"]*(?:field-validation-error|text-danger|alert-danger|error-message)[^"]*"[^>]*>\s*([^<]{3,220})/i)?.[1]
        || ''
      ).replace(/\s+/g, ' ').trim();
      const uyariLow = uyari.toLowerCase();
      if (/kont[oö]r/.test(uyariLow) && /yeters|bitti|kalmad|yükle|satın|tükendi/.test(uyariLow)) {
        throw new Error(`TÜRMOB: ${uyari} — kontör yükleyip tekrar deneyin.`);
      }
      if (/captcha|güvenlik kodu|robot|resimdeki/.test(uyariLow)) {
        throw new Error(`TÜRMOB girişte güvenlik kodu (captcha) istiyor — ${uyari}`);
      }
      if (/kilit|bloke|çok fazla|too many|engellendi|donduruldu/.test(uyariLow)) {
        throw new Error(`TÜRMOB hesabı geçici kilitli/engelli olabilir — ${uyari}`);
      }
      // Giriş formu YOK + oturum çerezi VAR → giriş aslında olmuş (redirect yerine 200 render). Devam et.
      if (!loginFormuVar && authCerezVar && cookieMap.size) {
        this.logger.log('TÜRMOB giriş 200 döndü ama oturum çerezi alındı — başarılı sayılıyor');
        return cookieHeader();
      }
      // Kimlik reddi. TÜRMOB hatalı-giriş nedenini SUNUCU yanıtında yazmıyor (JS ile gösteriyor;
      //   canlı kanıt: yanlış kimlikle POST → 200, gövdede hata metni YOK, sadece login sayfası).
      //   O yüzden 200/redirect-dışı = TÜRMOB kullanıcı adı/parolayı KABUL ETMEDİ demektir. Eyleme
      //   dönük mesaj ver: parola çoğu kez TÜRMOB'da değişmiştir, Entegratörler'den güncellenmeli.
      if (uyari) throw new Error(`TÜRMOB girişi başarısız — ${uyari} (HTTP ${loginRes.status})`);
      throw new Error(`TÜRMOB kullanıcı adı/parolası kabul edilmedi (HTTP ${loginRes.status}). Bu mükellefin TÜRMOB parolası büyük olasılıkla değişmiş — Entegratörler ekranından TÜRMOB parolasını güncelleyip tekrar deneyin.`);
    }
    // 3) Redirect hedefini İZLE — ASP.NET'te auth/session çerezi çoğu zaman bu adımda tamamlanır.
    //    (redirect izlenmezse liste isteği login'e geri atılıp 0 kayıt döner.)
    const loc = loginRes.headers.get('location') || '/';
    try {
      const home = await this.turmobFetch(loc.startsWith('http') ? loc : BASE + loc, { headers: { Cookie: cookieHeader(), 'User-Agent': 'MorenPortal/1.0' }, redirect: 'manual' });
      addCookies(pick(home));
    } catch { /* redirect izlenemese de eldeki çerezle devam */ }
    if (!cookieMap.size) throw new Error('TÜRMOB oturum çerezi alınamadı');
    return cookieHeader();
  }

  // TÜRMOB firma adını karşılaştırma anahtarına çevirir (Türkçe asciiFold + şirket-eki temizliği).
  private turmobNameTokens(s: string): string[] {
    const fold = (x: string) => x
      .replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
      .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ç/g, 'c').replace(/Ç/g, 'c')
      .replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ü/g, 'u').replace(/Ü/g, 'u');
    const STOP = new Set(['LTD', 'STI', 'LIMITED', 'SIRKETI', 'SIRKET', 'TICARET', 'SANAYI', 'SAN', 'TIC', 'VE', 'AS', 'ANONIM', 'LTDSTI', 'DIS', 'INSAAT']);
    return fold(String(s || '')).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter((t) => t.length >= 2 && !STOP.has(t));
  }

  // TÜRMOB çok-firma: mükellef ADIna (FirmaAdi) göre firmanın IdFirma'sını (CompanyId) döndürür.
  //   CANLI KANIT (2026-07-28): login sayfasının #Companylist typeahead'i POST /Account/GetCompanyList
  //   ile arar; parametre q=FirmaAdi (VKN DEĞİL!), yanıt {IdFirma, FirmaAdi} — VKN alanı YOK. q=''
  //   oturumdaki TÜM firmaları döndürür. Seçince #CompanyId=item.IdFirma. Bu yüzden isim örtüşmesiyle
  //   eşleştiriyoruz; belirsizse (skor beraberliği) null → yanlış firmaya girmeyi önler.
  private async turmobResolveCompanyId(BASE: string, cookie: string, token: string, matchName: string): Promise<string | null> {
    const target = this.turmobNameTokens(matchName);
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookie,
      'User-Agent': 'MorenPortal/1.0',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    };
    const readId = (o: any) => String(o?.IdFirma ?? o?.idFirma ?? o?.Id ?? o?.id ?? o?.CompanyId ?? o?.companyId ?? '').trim();
    const readName = (o: any) => String(o?.FirmaAdi ?? o?.firmaAdi ?? o?.text ?? o?.Text ?? o?.label ?? o?.Name ?? o?.ad ?? '').trim();
    // Önce q='' (hepsi); sonra ismin ilk anlamlı kelimesiyle daralt (yedek).
    const queries = Array.from(new Set(['', ...(target[0] ? [target[0]] : [])]));
    for (const q of queries) {
      try {
        const res = await this.turmobFetch(BASE + '/Account/GetCompanyList', {
          method: 'POST', headers,
          body: new URLSearchParams({ q, __RequestVerificationToken: token }).toString(),
        });
        const text = await res.text();
        if (!res.ok) { this.logger.log(`[TURMOB-COMPANY] GetCompanyList q="${q}" HTTP${res.status}`); continue; }
        let data: any = null;
        try { data = JSON.parse(text); } catch { continue; }
        const list: any[] = Array.isArray(data) ? data
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.Data) ? data.Data
          : Array.isArray(data?.options) ? data.options
          : [];
        this.logger.log(`[TURMOB-COMPANY] GetCompanyList q="${q}" -> ${list.length} firma; hedef=[${target.join(',')}]`);
        if (!list.length) continue;
        // İsim örtüşme puanı (ortak anlamlı kelime sayısı). En yüksek + tekil ise seç.
        let best: { id: string; score: number; name: string } | null = null;
        let tie = false;
        for (const o of list) {
          const id = readId(o); if (!id) continue;
          const name = readName(o);
          const score = target.length ? this.turmobNameTokens(name).filter((t) => target.includes(t)).length : 0;
          if (!best || score > best.score) { best = { id, score, name }; tie = false; }
          else if (score === best.score) tie = true;
        }
        if (best) this.logger.log(`[TURMOB-COMPANY] en iyi aday IdFirma=${best.id} "${best.name.slice(0, 45)}" skor=${best.score} beraberlik=${tie}`);
        if (best && best.score >= 1 && !tie) return best.id;
        if (list.length === 1) { const id = readId(list[0]); if (id) return id; }
      } catch (e: any) { this.logger.warn(`[TURMOB-COMPANY] GetCompanyList q="${q}" hata: ${e?.message || e}`); }
    }
    return null;
  }

  private turmobDateProfiles(period: { startDate: string; endDate: string }, channel?: string) {
    const parts = (value: string) => {
      const [year, month, day] = String(value || '').slice(0, 10).split('-');
      return { year, month, day };
    };
    const start = parts(period.startDate);
    const end = parts(period.endDate);
    // SATIŞ (OUT) TUZAĞI (canlı kanıt, Gökhan SEL faturası): Giden fatura sayfasında IlkTarih/SonTarih
    //   FATURA tarihine göre DEĞİL, GÖNDERİLME tarihine göre filtreliyor. Gönderilme tarihi boş olan
    //   fatura (AKG2026000000189, 01.07) bu filtreyle sessizce eleniyordu (26 yerine 25 satır). Giden
    //   fatura tarihi filtresinin GERÇEK alanı FaturaIlkTarihi/FaturaSonTarihi. Bu yüzden OUT kanalında
    //   IlkTarih/SonTarih (gönderilme) çiftini GÖNDERME → tüm fatura-tarihi satırları gelir. ALIŞ (IN)
    //   sayfası bu çifti farklı kullandığı ve mevcut halde doğru çalıştığı için IN'de dokunulmuyor.
    const isOut = String(channel || '').toUpperCase().startsWith('OUT');
    const dateKeys = ([
      ['startDate', 'endDate'],
      ['StartDate', 'EndDate'],
      ['baslangicTarihi', 'bitisTarihi'],
      ['BaslangicTarihi', 'BitisTarihi'],
      ['ilkTarih', 'sonTarih'],
      ['IlkTarih', 'SonTarih'],
      ['tarih1', 'tarih2'],
      ['TarihBaslangic', 'TarihBitis'],
      ['FaturaBaslangicTarihi', 'FaturaBitisTarihi'],
      ['FaturaTarihiBaslangic', 'FaturaTarihiBitis'],
      ['FaturaIlkTarihi', 'FaturaSonTarihi'], // Giden e-Arşiv sayfasının GERÇEK alan adları (ağ izleme)
      ['FaturaTarihBaslangic', 'FaturaTarihBitis'],
      ['BaslangicTarih', 'BitisTarih'],
      ['IlkFaturaTarihi', 'SonFaturaTarihi'],
      ['firstDate', 'lastDate'],
      ['InvoiceDateStart', 'InvoiceDateEnd'],
      ['IssueDateStart', 'IssueDateEnd'],
      ['InvoiceStartDate', 'InvoiceEndDate'],
      ['IssueStartDate', 'IssueEndDate'],
      ['ExecutionStartDate', 'ExecutionEndDate'],
      ['Baslangic', 'Bitis'],
      ['Start', 'End'],
      ['fromDate', 'toDate'],
      ['dateFrom', 'dateTo'],
      ['minDate', 'maxDate'],
    ] as string[][]).filter(([fromKey]) => !(isOut && /^ilktarih$/i.test(String(fromKey))));
    // TÜRMOB Giden e-Arşiv sayfası tarihleri TR uzun biçimde yollar ("Nisan 1, 2026" / "Temmuz 4, 2026 23:59:59").
    const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const trText = (p: { year: string; month: string; day: string }) => `${AY[Math.max(0, Math.min(11, Number(p.month) - 1))]} ${Number(p.day)}, ${p.year}`;
    const values = [
      { name: 'tr-text', start: trText(start), end: `${trText(end)} 23:59:59` },
      { name: 'iso', start: period.startDate, end: period.endDate },
      { name: 'dot', start: `${start.day}.${start.month}.${start.year}`, end: `${end.day}.${end.month}.${end.year}` },
      { name: 'slash', start: `${start.day}/${start.month}/${start.year}`, end: `${end.day}/${end.month}/${end.year}` },
      { name: 'compact', start: `${start.year}${start.month}${start.day}`, end: `${end.year}${end.month}${end.day}` },
      { name: 'iso-datetime', start: `${period.startDate}T00:00:00`, end: `${period.endDate}T23:59:59` },
    ];
    return values.map((variant) => {
      const params: Record<string, string> = {};
      for (const [fromKey, toKey] of dateKeys) {
        params[fromKey] = variant.start;
        params[toKey] = variant.end;
      }
      return { name: variant.name, params };
    });
  }

  private turmobRowsFromListResponse(data: any): any[] {
    const directCandidates = [
      data,
      data?.data,
      data?.Data,
      data?.aaData,
      data?.AAData,
      data?.rows,
      data?.Rows,
      data?.items,
      data?.Items,
      data?.list,
      data?.List,
      data?.result,
      data?.Result,
      data?.result?.data,
      data?.Result?.Data,
      data?.data?.data,
      data?.Data?.Data,
    ].filter(Array.isArray);
    const arrays: any[][] = [];
    const seen = new WeakSet<object>();
    const rememberArray = (arr: any[]) => {
      if (!arrays.includes(arr)) arrays.push(arr);
    };
    for (const candidate of directCandidates) rememberArray(candidate);
    const visit = (value: any, depth = 0) => {
      if (value == null || depth > 8 || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        rememberArray(value);
        for (const item of value.slice(0, 100)) visit(item, depth + 1);
        return;
      }
      for (const nested of Object.values(value)) visit(nested, depth + 1);
    };
    visit(data);
    if (!arrays.length) return [];

    const rowSignal = (row: any) => {
      if (row == null) return 0;
      let text = '';
      let keys = '';
      try {
        text = JSON.stringify(row).slice(0, 12000);
        keys = Array.isArray(row) ? '' : Object.keys(row || {}).join(' ');
      } catch {
        text = String(row).slice(0, 12000);
      }
      const haystack = `${keys} ${text}`;
      let score = 0;
      if (/(FaturaNo|BelgeNo|InvoiceNo|InvoiceNumber|IadeFaturaNo|Ettn|ETTN|UUID|Guid)/i.test(haystack)) score += 8;
      if (/(IdFaturaGelen|IdFaturaGiden|IdFaturaArsiv|InvoiceId|FaturaId|ActionButtons|FilePath)/i.test(haystack)) score += 6;
      if (/(FaturaTarihi|GelirTarihi|GelisTarihi|InvoiceDate|IssueDate|Tarih)/i.test(haystack)) score += 4;
      if (/(OdenecekTutar|Toplam|Kdv|KDV|Tutar|Net|Matrah)/i.test(haystack)) score += 3;
      if (/[A-Z]{2,6}\d{8,24}/.test(haystack)) score += 4;
      if (/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/.test(haystack) || /\b\d{4}-\d{2}-\d{2}\b/.test(haystack)) score += 2;
      return score;
    };
    const scored = arrays
      .filter((arr) => arr.length > 0)
      .map((arr) => {
        const sample = arr.slice(0, 80);
        const signals = sample.map(rowSignal);
        const rowLike = signals.filter((score) => score >= 6).length;
        const totalSignal = signals.reduce((sum, score) => sum + score, 0);
        return {
          arr,
          rowLike,
          totalSignal,
          score: rowLike * 10000 + Math.min(arr.length, 3000) * 8 + totalSignal,
        };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0]?.arr || directCandidates[0] || [];
  }

  private turmobField(row: any, keys: string[]): string | null {
    const wanted = new Set(keys.map((key) => key.toLowerCase()));
    let found: string | null = null;
    const visit = (value: any) => {
      if (found || value == null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const nested of value) visit(nested);
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        if (wanted.has(key.toLowerCase()) && (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean')) {
          const text = String(nested).trim();
          if (text && text !== 'NaN' && text !== 'null' && text !== 'undefined') {
            found = text;
            return;
          }
        }
        visit(nested);
        if (found) return;
      }
    };
    visit(row);
    return found;
  }

  private turmobAmount(row: any, keys: string[]): number | null {
    const raw = this.turmobField(row, keys);
    if (!raw) return null;
    const text = String(raw).replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
    if (!text) return null;
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  private turmobDateValue(value: any): Date | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const msDate = raw.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//i);
    if (msDate) {
      const d = new Date(Number(msDate[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const dot = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (dot) {
      const d = new Date(Date.UTC(Number(dot[3]), Number(dot[2]) - 1, Number(dot[1])));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private turmobInvoiceDateFromRow(row: any): Date | null {
    return this.turmobDateValue(this.turmobField(row, [
      'FaturaTarihiFormatted',
      'FaturaTarihi',
      'GelirTarihiFormatted',
      'GelirTarihi',
      'GelisTarihiFormatted',
      'GelisTarihi',
      'IssueDate',
      'InvoiceDate',
      'Tarih',
      'Date',
    ]));
  }

  private turmobRowInPeriod(row: any, period: { startDate: string; endDate: string }): boolean {
    const rowDate = this.turmobInvoiceDateFromRow(row);
    if (!rowDate) return true;
    // Fatura tarihi TÜRKİYE tarihidir (TÜRMOB TR saatiyle üretir). Mutlak an'ı UTC dönem
    //   sınırıyla karşılaştırmak, AYIN 1'inde kesilen faturayı bir önceki aya kaydırıp
    //   DÖNEM DIŞI eliyordu: 01.07 00:00 TR = 30.06 21:00 UTC < dönem başı 01.07 00:00 UTC.
    //   (Canlı kanıt: YORGUN NAKLİYAT Temmuz'da 01.07 tarihli AYSAN faturası inmedi; rows=28
    //   live=27.) Türkiye sabit UTC+3 → rowDate'i +3 saat kaydırıp TAKVİM GÜNÜNE indirgeyip
    //   gün-bazlı (saat/timezone'suz) karşılaştırıyoruz. Her iki tarih formatı da (/Date(ms)/
    //   ve gg.aa.yyyy) bu shift'le doğru güne oturur; hiçbir fatura yanlışlıkla dışlanmaz.
    const trGun = new Date(rowDate.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startGun = String(period.startDate || '').slice(0, 10);
    const endGun = String(period.endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startGun) || !/^\d{4}-\d{2}-\d{2}$/.test(endGun)) return true;
    return trGun >= startGun && trGun <= endGun;
  }

  private turmobIsCancelled(row: any): boolean {
    const statusKeys = [
      'Durum',
      'durum',
      'Status',
      'status',
      'DurumAdi',
      'DurumAd',
      'DurumAciklama',
      'IptalItirazDurumu',
      'IptalDurumu',
      'ItirazDurumu',
      'RedDurumu',
      'OnayDurumu',
      'OnayJobDurumu',
      'Sonuc',
      'Cevap',
    ];
    // ALAN-BAZLI kontrol: eskiden tüm durum alanları BİRLEŞTİRİLİP tek metinde bakılıyordu —
    //   "OnayDurumu=Onaylandı" + "IptalItirazDurumu=İptal Edildi" (önce onaylanıp SONRA iptal edilen
    //   e-Arşiv) birleşik metinde 'onaylandı' kelimesiyle erken çıkıp İPTALİ KAÇIRIYORDU. Artık her
    //   alan kendi içinde değerlendirilir: "Yok/Hayır" yazan alan temiz sayılır, iptal/itiraz/red
    //   yazan HERHANGİ bir alan satırı iptal işaretler. (Aktarımdaki 2. emniyet — rawJson
    //   approvalStatus/iptalItiraz süzgeci — aynen durur.)
    for (const key of statusKeys) {
      const v = String(this.turmobField(row, [key]) || '').toLowerCase();
      if (!v) continue;
      if (/\byok\b|false|hayir|hayır/.test(v)) continue; // "İptal İtiraz Durumu: Yok" → temiz
      if (/iptal talebi redded|itiraz redded/.test(v)) continue; // iptal/itiraz TALEBİ reddedilmiş = fatura geçerli
      if (/iptal|itiraz|reddedil|red edildi|cancel/.test(v)) return true;
    }
    // BOOLEAN bayraklar (Giden e-Arşiv satırında canlı görüldü: IptalEdildi/ItirazEdildi=true/false) —
    //   anahtar adı iptali söylüyor, değer yalnız true/false; üstteki kelime-bazlı kontrol yakalayamaz.
    for (const key of ['IptalEdildi', 'ItirazEdildi', 'IsCancelled', 'Cancelled']) {
      if (String(this.turmobField(row, [key]) ?? '').toLowerCase() === 'true') return true;
    }
    return false;
  }

  private turmobListPaths(channel: string) {
    // Referer = anti-forgery TOKEN'ın okunduğu sayfa. Token YOKSA OUT POST 822-hata döner → 0 satır
    //   (satışlar "görünmüyor"du). TÜRMOB'da test edildi: '/OutgoingInvoice' ve '/ArchiveInvoice' 302
    //   redirect (token YOK); '.../OutgoingInvoiceList' ve '.../ArchiveInvoiceList' 200 + token VAR.
    //   Alış '/Inbox' zaten token veriyor (o yüzden Alış çalışıyordu).
    // OUT_EARSIV GERÇEK YOL (2026-07-04, TÜRMOB portalında AĞ İZLEMEYLE doğrulandı — Gökhan Akgöz
    //   canlı oturumu): "Gönderilen E-Arşiv Faturaları" sayfası /OutgoingInvoice/OutgoingArchiveList,
    //   veri ucu e-Fatura ile AYNI (/OutgoingInvoice/AllOutgoingInvoiceByFilter) ama gövdede
    //   IsArchive=true + IsArchiveInvoice=true ayırt ediyor (bkz. turmobEarsivParams). Eski
    //   /ArchiveInvoice/* uçları "Arşivlenmiş Faturalar" (BAŞKA modül) — hep boş dönüyordu (0/18 vakası).
    const refererPath = channel === 'OUT_EARSIV'
      ? '/OutgoingInvoice/OutgoingArchiveList'
      : channel === 'OUT_EFATURA'
        ? '/OutgoingInvoice/OutgoingInvoiceList'
        : '/Inbox';
    const listUrls = channel === 'OUT_EARSIV'
      ? [
          '/OutgoingInvoice/AllOutgoingInvoiceByFilter',
          '/ArchiveInvoice/ArchiveInvoiceList',
          '/ArchiveInvoice/GetArchiveInvoiceList',
          '/OutgoingArchiveInvoice/AllOutgoingArchiveInvoiceByFilter',
          '/OutgoingArchiveInvoice/OutgoingArchiveInvoiceList',
          '/OutgoingArchiveInvoice/GetOutgoingArchiveInvoiceList',
          '/ArchiveInvoice/AllArchiveInvoiceByFilter',
          '/ArchiveInvoice/AllOutgoingArchiveInvoiceByFilter',
          '/EArchiveInvoice/AllEArchiveInvoiceByFilter',
          '/EArchiveInvoice/ArchiveInvoiceList',
          '/EArchiveInvoice/GetArchiveInvoiceList',
          '/EArchive/AllOutgoingArchiveInvoiceByFilter',
          '/EArchive/ArchiveInvoiceList',
          '/OutgoingInvoice/AllOutgoingArchiveInvoiceByFilter',
        ]
      : channel === 'OUT_EFATURA'
        ? [
            '/Outbox/OutboxList',
            '/Outbox/GetOutboxList',
            '/Outbox/AllOutboxByFilter',
            '/Outbox/AllOutgoingInvoiceByFilter',
            '/SentInvoice/SentInvoiceList',
            '/SentInvoice/GetSentInvoiceList',
            '/SentInvoice/AllSentInvoiceByFilter',
            '/OutgoingInvoice/OutgoingInvoiceList',
            '/OutgoingInvoice/AllOutgoingInvoiceByFilter',
            '/OutgoingInvoice/AllOutGoingInvoiceByFilter',
            '/OutgoingInvoice/AllOutgoingInvoice',
            '/OutgoingInvoice/GetOutgoingInvoiceList',
            '/OutgoingInvoice/GetInvoicesByFilter',
            '/GidenFatura/GidenFaturaList',
            '/GidenFatura/GetGidenFaturaList',
            '/GidenFatura/AllGidenFaturaByFilter',
            '/Invoice/AllOutgoingInvoiceByFilter',
            '/Invoice/OutgoingInvoiceList',
            '/Invoice/GetOutgoingInvoiceList',
            '/Invoice/AllOutboxInvoiceByFilter',
            '/Invoice/OutboxInvoiceList',
            '/Invoice/GetOutboxInvoiceList',
          ]
        : [
            '/Inbox/InboxList',
            '/Inbox/GetInboxList',
            '/Inbox/AllInboxByFilter',
            '/Inbox/AllIncomingInvoiceByFilter',
            '/IncomingInvoice/IncomingInvoiceList',
            '/IncomingInvoice/AllIncomingInvoiceByFilter',
            '/IncomingInvoice/AllInComingInvoiceByFilter',
            '/IncomingInvoice/AllIncomingInvoice',
            '/IncomingInvoice/GetIncomingInvoiceList',
            '/IncomingInvoice/GetInvoicesByFilter',
            '/GelenFatura/GelenFaturaList',
            '/GelenFatura/GetGelenFaturaList',
            '/GelenFatura/AllGelenFaturaByFilter',
            '/Invoice/AllIncomingInvoiceByFilter',
            '/Invoice/IncomingInvoiceList',
            '/Invoice/GetIncomingInvoiceList',
            '/Invoice/AllInboxInvoiceByFilter',
            '/Invoice/InboxInvoiceList',
            '/Invoice/GetInboxInvoiceList',
          ];
    return { refererPath, listUrls };
  }

  /** TÜRMOB liste sorgusu KEŞİF HAFIZASI: kanal → en son çalışan uç+profil+yöntem.
   *  Sonraki sorgular 168-264'lük deneme matrisini atlayıp bu kombinasyonla başlar. */
  private static turmobComboCache = new Map<string, { listUrl: string; profileName: string; method: 'POST' | 'GET' }>();
  // BİLİNEN çalışan kombinasyonlar (canlı log ile doğrulandı 2026-07-28). Cache boşken (deploy/restart
  //   sonrası ilk çekim) bunlar ÖNCE denenir → deneme-yanılma matrisi atlanır, sorgu ~2.5dk yerine
  //   ~10-15sn. Tutmazsa (portal değişirse) tam matris fallback devreye girer + yeni kombinasyon cache'lenir.
  private static readonly TURMOB_DEFAULT_COMBO: Record<string, { listUrl: string; profileName: string; method: 'POST' | 'GET' }> = {
    IN_EFATURA: { listUrl: '/IncomingInvoice/AllIncomingInvoiceByFilter', profileName: 'tr-text', method: 'POST' },
    IN_EARSIV: { listUrl: '/IncomingInvoice/AllIncomingInvoiceByFilter', profileName: 'tr-text', method: 'POST' },
    OUT_EFATURA: { listUrl: '/OutgoingInvoice/AllOutgoingInvoiceByFilter', profileName: 'tr-text', method: 'POST' },
    OUT_EARSIV: { listUrl: '/OutgoingInvoice/AllOutgoingInvoiceByFilter', profileName: 'tr-text', method: 'POST' },
  };

  private async fetchTurmobPortalRows(
    cfg: RuntimeIntegrationConfig,
    opts: {
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
      channel?: string;
    },
    attempt = 0,
  ): Promise<any> {
    if (!cfg.username || !cfg.password) throw new Error('TURMOB icin TCKN (kullanici adi) ve parola gerekli');
    const cookie = await this.turmobLogin(cfg.username, cfg.password, cfg.senderVkn || undefined);
    const BASE = this.TURMOB_BASE;
    const channel = String(opts.channel || (opts.direction === 'SATIS' ? 'OUT_EFATURA' : 'IN_EFATURA')).toUpperCase();
    const { refererPath, listUrls } = this.turmobListPaths(channel);
    const baseListParams = {
      draw: '1',
      start: '0',
      length: String(Math.min(Math.max(Number(opts.limit) || 500, 1), 1000)),
      'search[value]': '',
      'search[regex]': 'false',
      'order[0][column]': '0',
      'order[0][dir]': 'desc',
      // e-ARŞİV AYIRICI (ağ izlemeyle doğrulandı): AllOutgoingInvoiceByFilter bu iki bayrakla
      //   e-Arşiv satırlarını döndürür; bayraksız aynı uç yalnız e-Fatura verir (0/18'in kökü).
      ...(channel === 'OUT_EARSIV' ? { IsArchive: 'true', IsArchiveInvoice: 'true', EArsivDurumu: '-1', EArsivRaporGonderimDurumu: '-1', AliciId: '0' } : {}),
    };
    let listPageToken = '';
    let listPageHtml = '';
    try {
      const listPage = await this.turmobFetch(BASE +refererPath, {
        headers: { Cookie: cookie, 'User-Agent': 'MorenPortal/1.0', Accept: 'text/html,application/xhtml+xml,*/*' },
        redirect: 'manual',
      });
      listPageHtml = await listPage.text();
      listPageToken = listPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1]
        || listPageHtml.match(/__RequestVerificationToken[^>]*value="([^"]+)"/)?.[1]
        || '';

    } catch {
      // Optional warm-up.
    }

    // LİSTE UCU KEŞFİ: sayfanın HTML'inde DataTables/ajax veri ucu YAZILIDIR — uç adı TÜRMOB
    //   sürümüyle değişebildiği için sabit tahmin listesi boş dönebiliyor (Satış e-Arşiv 0/18 vakası).
    //   Sayfadan çıkarılan uçlar İLK aday olarak denenir; bulunamazsa mevcut tahmin listesi aynen çalışır.
    const discoveredUrls: string[] = [];
    if (listPageHtml) {
      for (const m of listPageHtml.matchAll(/(?:ajax|url|href|action)\s*[:=]\s*["']((?:https?:\/\/[^"']+)?\/[A-Za-z0-9/_.-]*(?:Invoice|Arsiv|Archive|Fatura)[A-Za-z0-9/_.-]*)["']/gi)) {
        let u = String(m[1] || '');
        if (/\.(js|css|png|jpg|svg|ico)(\?|$)/i.test(u)) continue;
        // YAN ETKİ KORUMASI: Create/Delete/Send gibi eylem uçlarına liste POST'u atma (CreateQuick vakası);
        //   yalnız liste/filtre görünümlü uçlar denenir.
        if (/create|delete|update|edit|cancel|send|iptal|sil|olustur|kaydet|upload/i.test(u)) continue;
        if (!/list|filter|byfilter|ara|search/i.test(u)) continue;
        u = u.replace(/^https?:\/\/[^/]+/i, '');
        if (!u.startsWith('/') || u.length > 120) continue;
        if (!discoveredUrls.includes(u)) discoveredUrls.push(u);
      }
    }
    // Bilinen (doğrulanmış) uçlar ÖNCE; sayfadan keşfedilenler yedek olarak SONRA denenir.
    const allListUrls = [...listUrls, ...discoveredUrls.filter((u) => !listUrls.includes(u))];
    if (discoveredUrls.length) this.logger.log(`TURMOB list ${channel}: sayfadan kesfedilen uclar: ${discoveredUrls.slice(0, 6).join(' , ')}`);

    const profiles = this.turmobDateProfiles(opts.period, channel);
    let ct = '';
    let raw = '';
    let data: any = null;
    let rows: any[] = [];
    let liveRows: any[] = [];
    let selectedCt = '';
    let selectedRaw = '';
    let selectedData: any = null;
    let usedListUrl = allListUrls[0];
    let usedProfile = 'none';
    let usedMethod = 'POST';

    // ERKEN ÇIKIŞ: satırlar bulunup sunucunun bildirdiği toplam sayıya ULAŞILDIYSA kalan
    //   uç×profil×yöntem kombinasyonlarını deneme — eskiden ilk kombinasyonda 18/18 satır gelse bile
    //   ~150+ istek daha atılıyordu (kullanıcı: "sorgu neden bu kadar uzun sürüyor").
    let tamamlandi = false;
    // KEŞİF HAFIZASI (kanal başına): en son ÇALIŞAN uç+profil+yöntem ÖNCE denenir → tipik sorgu
    //   1-2 istekte biter (kullanıcı: "sorgu hızlı olsun, boşuna beklemesin"). Tutmazsa tam matris
    //   taranır ve yeni çalışan kombinasyon hafızaya yazılır. Süreç içi hafıza; restart'ta sıfırlanır.
    const hatirlanan = FaturaMuhasebelestirmeService.turmobComboCache.get(channel)
      || FaturaMuhasebelestirmeService.TURMOB_DEFAULT_COMBO[channel];
    const kombinasyonlar: Array<{ listUrl: string; profile: any; method: 'POST' | 'GET' }> = [];
    if (hatirlanan) {
      const p = profiles.find((x) => x.name === hatirlanan.profileName);
      // Bilinen/hatırlanan kombinasyon ÖNCE (allListUrls kontrolü YOK — seed listUrl kesin doğru;
      //   portal değişmişse tutmaz, aşağıdaki tam matris fallback devreye girer). Tipik sorgu 1 istekte biter.
      if (p) kombinasyonlar.push({ listUrl: hatirlanan.listUrl, profile: p, method: hatirlanan.method });
    }
    for (const listUrl of allListUrls) {
      for (const profile of profiles) {
        for (const method of ['POST', 'GET'] as const) kombinasyonlar.push({ listUrl, profile, method });
      }
    }
    for (const kombo of kombinasyonlar) {
      if (tamamlandi) break;
      const { listUrl, profile, method } = kombo;
      const listBody = new URLSearchParams(
        listPageToken
          ? { ...baseListParams, ...profile.params, __RequestVerificationToken: listPageToken }
          : { ...baseListParams, ...profile.params },
      ).toString();
      const requestUrl = method === 'GET' ? `${BASE}${listUrl}?${listBody}` : BASE + listUrl;
      let res: any;
      try {
        res = await this.turmobFetch(requestUrl, {
          method,
          headers: {
            ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Origin: BASE,
            Referer: BASE + refererPath,
            'X-Requested-With': 'XMLHttpRequest',
            ...(listPageToken ? { RequestVerificationToken: listPageToken, __RequestVerificationToken: listPageToken } : {}),
            Cookie: cookie,
            'User-Agent': 'MorenPortal/1.0',
          },
          body: method === 'POST' ? listBody : undefined,
          // TEK İSTEK TAVANI (8sn): eskiden timeout YOKTU — portal yavaşladığında matris sınırsız
          //   bekliyordu. Takılan kombinasyon atlanır, sıradaki denenir.
          signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(8000) : undefined,
        });
      } catch { continue; }
      ct = res.headers.get('content-type') || '';
      raw = await res.text().catch(() => '');
      data = null;
      try { data = JSON.parse(raw); } catch { /* HTML = probably login redirect */ }
      const candidateRows = this.turmobRowsFromListResponse(data);
      const candidateLiveRows = candidateRows.filter((row) => !this.turmobIsCancelled(row) && this.turmobRowInPeriod(row, opts.period));
      if (
        candidateLiveRows.length > liveRows.length
        || (!liveRows.length && candidateRows.length > rows.length)
      ) {
        rows = candidateRows;
        liveRows = candidateLiveRows;
        selectedCt = ct;
        selectedRaw = raw;
        selectedData = data;
        usedListUrl = listUrl;
        usedProfile = profile.name;
        usedMethod = method;
      }
      // Satır geldi ve sunucunun bildirdiği toplam kadar → yeter, kalan kombinasyonları deneme.
      if (candidateLiveRows.length > 0) {
        const bildirilen = Number(data?.recordsFiltered ?? data?.RecordsFiltered ?? data?.recordsTotal ?? data?.RecordsTotal ?? NaN);
        if (!Number.isFinite(bildirilen) || candidateRows.length >= bildirilen) {
          tamamlandi = true;
          FaturaMuhasebelestirmeService.turmobComboCache.set(channel, { listUrl, profileName: profile.name, method });
        }
      }
    }
    this.logger.log(`TURMOB list ${channel}: url=${usedListUrl} method=${usedMethod} profile=${usedProfile} ct=${selectedCt.slice(0, 40)} len=${selectedRaw.length} rows=${rows.length} live=${liveRows.length}`);

    // SAYFALAMA: TÜRMOB tek sayfada en çok `length` (≤1000) satır döndürür. Toplam bundan büyükse
    //   (1000+ faturalı mükellef) ÜST faturalar sessizce inmiyordu. Kazanan kombinasyonla start'ı artırıp
    //   sonraki sayfaları çek ve birleştir. Üst sınır 20 sayfa (güvenlik). Yalnız combo başarılı + sunucu
    //   daha fazla toplam bildiriyorsa çalışır (küçük mükellefte hiç tetiklenmez).
    const bildirilenToplam = Number(
      selectedData?.recordsFiltered ?? selectedData?.recordsTotal
      ?? selectedData?.RecordsFiltered ?? selectedData?.RecordsTotal
      ?? selectedData?.iTotalDisplayRecords ?? selectedData?.iTotalRecords ?? NaN,
    );
    // TÜRMOB gönderdiğimiz `length`(=500) parametresini YOK SAYIP sabit 25'lik sayfa döndürebiliyor
    //   (canlı kanıt: Gökhan Akgöz satış "36 kayıttan 1-25" → yalnız 25 indi, 26-36 kayboldu). Eski
    //   koşul `rows.length >= pageLen(500)` bu durumda ASLA doğru olmuyordu → sayfalama hiç tetiklenmez,
    //   üst sayfalar sessizce inmezdi (25+ faturalı TÜM mükellefleri etkiler). Ölçüt artık SADECE:
    //   sunucu daha fazla TOPLAM (recordsFiltered) bildiriyor ama biz daha az aldıysak sayfala.
    //   start, gerçek gelen satır sayısı kadar artar (döngü içinde), 25'lik de olsa tüm sayfalar toplanır.
    // NOT: TÜRMOB toplam-kayıt (recordsFiltered) sayısını her uçta VERMİYOR (canlı: Gökhan satış
    //   ekranda "36 kayıt" yazıyor ama JSON'da tanınan toplam alanı yok → bildirilenToplam=NaN).
    //   Bu yüzden toplam BİLİNMESE DE sonraki sayfayı yokluyoruz: dedup + boş-sayfa + eklenen=0
    //   korumaları sonsuz döngüyü engeller (yeni satır gelmeyince durur). Toplam biliniyorsa ona
    //   kadar gider (erken dur, gereksiz istek yok).
    // TÜRMOB recordsFiltered'ı GERÇEK toplam yerine SAYFADAKİ sayıyı (25) döndürebiliyor (canlı: Gökhan
    //   satış ekranda "36 kayıt" ama recordsFiltered=25 → toplam-tabanlı durdurma yanıltıcı). Bu yüzden
    //   toplam sayıya HİÇ bakmadan, satır varsa sonraki sayfaları KOŞULSUZ yokluyoruz; dedup + boş-sayfa +
    //   eklenen=0 + MAX_SAYFA korumaları durmayı garanti eder (küçük mükellefte 1 ekstra boş istek → ucuz).
    if (rows.length > 0) {
      const rowKey = (r: any): string => this.providerKey(
        this.turmobField(r, ['Ettn', 'ETTN', 'Uuid', 'UUID', 'Guid', 'GUID'])
        || this.turmobField(r, ['IdFaturaGelen', 'IdFaturaGiden', 'IdFaturaArsiv', 'IdArsiv', 'InvoiceId', 'Id'])
        || this.turmobField(r, ['FaturaNo', 'BelgeNo', 'InvoiceNo', 'InvoiceNumber']),
      ) || JSON.stringify(r).slice(0, 200);
      const seen = new Set(rows.map(rowKey));
      const winProfile = profiles.find((p) => p.name === usedProfile) || profiles[0];
      let start = rows.length;
      // TÜRMOB satış ucu (OutgoingInvoice) length=500'ü YOK SAYIP sabit 25 döndürüyor VE start'ı
      //   düzgün işlemiyordu (canlı debug: start=25 → yine ilk 25). Sayfa boyutunu TÜRMOB'un GERÇEKTEN
      //   döndürdüğü ilk-sayfa boyutuna (ör. 25) sabitleyip start'ı ona göre kaydırınca uç düzgün
      //   sayfalıyor. (Alış ucu 500'ü kabul edip tek sayfada verdiği için orada zaten tek istek.)
      const pageSize = Math.max(1, rows.length);
      let sayfa = 1;
      const MAX_SAYFA = 40;
      while (sayfa < MAX_SAYFA) {
        const pageParams: any = { ...baseListParams, ...(winProfile?.params || {}), start: String(start), length: String(pageSize) };
        if (listPageToken) pageParams.__RequestVerificationToken = listPageToken;
        const pageBody = new URLSearchParams(pageParams).toString();
        const pageUrl = usedMethod === 'GET' ? `${BASE}${usedListUrl}?${pageBody}` : BASE + usedListUrl;
        let pres: any;
        try {
          pres = await this.turmobFetch(pageUrl, {
            method: usedMethod,
            headers: {
              ...(usedMethod === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
              Accept: 'application/json, text/javascript, */*; q=0.01',
              Origin: BASE,
              Referer: BASE + refererPath,
              'X-Requested-With': 'XMLHttpRequest',
              ...(listPageToken ? { RequestVerificationToken: listPageToken, __RequestVerificationToken: listPageToken } : {}),
              Cookie: cookie,
              'User-Agent': 'MorenPortal/1.0',
            },
            body: usedMethod === 'POST' ? pageBody : undefined,
            signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(8000) : undefined,
          });
        } catch { break; }
        const praw = await pres.text().catch(() => '');
        let pdata: any = null;
        try { pdata = JSON.parse(praw); } catch { break; }
        const prows = this.turmobRowsFromListResponse(pdata);
        if (!prows.length) break;
        let eklenen = 0;
        for (const pr of prows) {
          const k = rowKey(pr);
          if (seen.has(k)) continue;
          seen.add(k);
          rows.push(pr);
          eklenen++;
        }
        start += prows.length;
        sayfa++;
        if (eklenen === 0) break; // yeni satır gelmedi → dur (sonsuz döngü koruması)
      }
      liveRows = rows.filter((r) => !this.turmobIsCancelled(r) && this.turmobRowInPeriod(r, opts.period));
      if (sayfa >= MAX_SAYFA) this.logger.warn(`TURMOB ${channel}: sayfalama ${MAX_SAYFA} sayfa sınırına ulaştı (${rows.length}/${bildirilenToplam}) — bazı üst faturalar hâlâ inmemiş olabilir.`);
      this.logger.log(`TURMOB ${channel}: sayfalama ${rows.length}/${bildirilenToplam} (${sayfa} sayfa)`);
    }
    // EKSIK YANIT (throttle): TURMOB toplam-kayit > aldigimiz satir → yanit kesik gelmis. Kisa bekleyip
    //   BIR KEZ daha dene (yeni login + sorgu); daha fazla satir gelirse onu dondur. Boylece tek sorgu da
    //   portaldaki tam sayiyi (orn 43) getirir, "39 geldi" eksikligi giderilir. (en fazla 2 ek deneme)
    const reportedTotal = Number(
      selectedData?.recordsFiltered ?? selectedData?.recordsTotal
      ?? selectedData?.RecordsFiltered ?? selectedData?.RecordsTotal
      ?? selectedData?.iTotalDisplayRecords ?? selectedData?.iTotalRecords ?? 0,
    );
    if (attempt < 2 && Number.isFinite(reportedTotal) && reportedTotal > rows.length && reportedTotal < 5000) {
      this.logger.warn(`TURMOB liste EKSIK geldi (${rows.length}/${reportedTotal}) → tekrar deneniyor (#${attempt + 1}): ${channel}`);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const retry = await this.fetchTurmobPortalRows(cfg, opts, attempt + 1);
        if ((retry?.liveRows?.length || 0) > liveRows.length) return retry;
      } catch (e: any) {
        this.logger.warn(`TURMOB liste retry hatasi: ${e?.message || e}`);
      }
    }
    // TARİH-BÖLME (satış ucu tek-sayfa limiti): TÜRMOB satış ucu (OutgoingInvoice) length=500'ü YOK
    //   SAYIP tek sorguda MAX 25 döndürüyor VE start-paging'i reddediyor (canlı kanıt: Gökhan Akgöz
    //   26 satıştan 25 geldi, en eski SEL ULUSLARARASI 01.07 = 26. sıra eksik; start=25 → TÜRMOB 0/tekrar).
    //   Çözüm: tam-limit (25) geldiyse dönemi İKİYE böl, iki yarı-tarih aralığını AYRI sorgula, birleştir.
    //   TÜRMOB'un tarih filtresi çalıştığı için her yarı sınırın altında kalır → tüm faturalar toplanır.
    //   Birleşik daha fazla getirmezse (alış gibi zaten tam gelen uçlarda) ilk sonuç korunur.
    const splitDepth = Number((opts as any).__splitDepth || 0);
    const splitStartMs = new Date(`${opts.period.startDate}T00:00:00.000Z`).getTime();
    const splitEndMs = new Date(`${opts.period.endDate}T00:00:00.000Z`).getTime();
    const splitGunFarki = Number.isFinite(splitStartMs) && Number.isFinite(splitEndMs)
      ? Math.round((splitEndMs - splitStartMs) / 86400000) : 0;
    if (rows.length >= 25 && channel.startsWith('OUT') && splitGunFarki >= 1 && splitDepth < 5) {
      try {
        const midMs = splitStartMs + Math.floor(splitGunFarki / 2) * 86400000;
        const midYmd = new Date(midMs).toISOString().slice(0, 10);
        const nextYmd = new Date(midMs + 86400000).toISOString().slice(0, 10);
        const p1 = { ...opts.period, endDate: midYmd };
        const p2 = { ...opts.period, startDate: nextYmd };
        const r1 = await this.fetchTurmobPortalRows(cfg, { ...opts, period: p1, __splitDepth: splitDepth + 1 } as any).catch(() => null);
        const r2 = await this.fetchTurmobPortalRows(cfg, { ...opts, period: p2, __splitDepth: splitDepth + 1 } as any).catch(() => null);
        const keyOf = (r: any) => this.providerKey(
          this.turmobField(r, ['Ettn', 'ETTN', 'Uuid', 'UUID', 'Guid', 'GUID'])
          || this.turmobField(r, ['IdFaturaGelen', 'IdFaturaGiden', 'IdFaturaArsiv', 'IdArsiv', 'InvoiceId', 'Id'])
          || this.turmobField(r, ['FaturaNo', 'BelgeNo', 'InvoiceNo', 'InvoiceNumber']),
        ) || JSON.stringify(r).slice(0, 200);
        const seenSplit = new Set<string>();
        const birlesikRows: any[] = [];
        for (const r of [...(r1?.rows || []), ...(r2?.rows || []), ...rows]) {
          const k = keyOf(r);
          if (seenSplit.has(k)) continue;
          seenSplit.add(k);
          birlesikRows.push(r);
        }
        const birlesikLive = birlesikRows.filter((r) => !this.turmobIsCancelled(r) && this.turmobRowInPeriod(r, opts.period));
        if (birlesikLive.length > liveRows.length) {
          this.logger.log(`TURMOB ${channel}: tarih-bolme ${liveRows.length} → ${birlesikLive.length} (donem ${opts.period.startDate}..${opts.period.endDate})`);
          rows = birlesikRows;
          liveRows = birlesikLive;
        }
      } catch (e: any) {
        this.logger.warn(`TURMOB ${channel} tarih-bolme hatasi: ${e?.message || e}`);
      }
    }
    return {
      cookie,
      channel,
      listPageHtml,
      rows,
      liveRows,
      usedListUrl,
      usedMethod,
      usedProfile,
      raw: selectedRaw,
      data: selectedData,
      ct: selectedCt,
    };
  }

  private turmobSummaryFromRow(row: any, opts: { channel: string; taxpayer: any; direction: 'ALIS' | 'SATIS' }) {
    const channel = String(opts.channel || '').toUpperCase();
    const ownName = this.reportTaxpayerName(opts.taxpayer);
    const ownTaxNo = this.reportTaxNumber(opts.taxpayer);
    const faturaNo = this.turmobField(row, ['FaturaNo', 'BelgeNo', 'InvoiceNo', 'InvoiceNumber', 'IadeFaturaNo']);
    const ettn = this.turmobField(row, ['Ettn', 'ETTN', 'Uuid', 'UUID', 'Guid', 'GUID']);
    const rowId = this.turmobField(row, [
      'IdFaturaGelen',
      'IdFaturaGiden',
      'IdFaturaArsiv',
      'IdArsiv',       // Giden e-Arşiv satırının GERÇEK kimlik alanı (canlı satırda doğrulandı: IdArsiv=25463188)
      'IdArsivEk',
      'FaturaGelenId',
      'FaturaGidenId',
      'ArchiveInvoiceId',
      'InvoiceId',
      'Id',
    ]);
    const date = this.turmobDateValue(this.turmobField(row, [
      'FaturaTarihiFormatted',
      'FaturaTarihi',
      'GelirTarihiFormatted',
      'GelirTarihi',
      'GelisTarihiFormatted',
      'GelisTarihi',
      'IssueDate',
      'InvoiceDate',
      'Tarih',
    ]));
    const total = this.turmobAmount(row, [
      'OdenecekTutar',
      'OdenecekTutarFormatted',
      'OdemeSonucFormatted',
      'NetteCap',
      'ToplamTutar',
      'VergilerDahilToplamTutar',
      'TaxInclusiveAmount',
      'PayableAmount',
    ]);
    const kdv = this.turmobAmount(row, ['KdvTutari', 'KdvTutar', 'HesaplananKdv', 'HesaplananKDV', 'TaxAmount']);
    const matrah = this.turmobAmount(row, ['Matrah', 'MalHizmetToplamTutar', 'MalHizmetTutari', 'TaxExclusiveAmount', 'LineExtensionAmount']);
    const currency = this.turmobField(row, ['DovizKodu', 'DovizKoduDesc', 'ParaBirimi', 'Currency', 'DocumentCurrencyCode']) || 'TRY';
    const approval = this.turmobField(row, ['DurumAdi', 'OnayDurumu', 'OnayJobDurumu', 'Status', 'Durum']) || 'Onaylandi';
    const iptal = this.turmobField(row, ['IptalItirazDurumu', 'IptalDurumu', 'ItirazDurumu', 'RedDurumu']) || 'Yok';
    const counterName = this.turmobField(row, [
      channel === 'IN_EFATURA' ? 'FirmaAdi' : 'AliciAdi',
      channel === 'IN_EFATURA' ? 'SaticiAdi' : 'MusteriAdi',
      channel === 'IN_EFATURA' ? 'GondericiAdi' : 'AliciUnvan',
      channel === 'IN_EFATURA' ? 'GonderenAdi' : 'MusteriUnvan',
      'SaticiUnvan',
      'GondericiUnvan',
      'FirmaUnvan',
      'AliciAdi',
      'MusteriAdi',
      'Unvan',
      'CariUnvan',
      'PartyName',
    ]);
    const counterVkn = this.turmobField(row, [
      channel === 'IN_EFATURA' ? 'GondericiVkn' : 'AliciVkn',
      channel === 'IN_EFATURA' ? 'SaticiVkn' : 'MusteriVkn',
      channel === 'IN_EFATURA' ? 'FirmaVkn' : 'AliciVknTckn',
      channel === 'IN_EFATURA' ? 'FirmaVknTckn' : 'MusteriVknTckn',
      'GondericiVknTckn',
      'SaticiVknTckn',
      'AliciVkn',
      'AliciVknTckn',
      'MusteriVkn',
      'MusteriVknTckn',
      'VknTckn',
      'VknTCKN',
      'VergiKimlikNo',
      'VergiNo',
      'VKN',
      'TCKN',
      'KimlikNo',
    ]);
    const senderTitle = channel === 'IN_EFATURA' ? counterName : ownName;
    const senderVkn = channel === 'IN_EFATURA' ? counterVkn : ownTaxNo;
    const receiverTitle = channel === 'IN_EFATURA' ? ownName : counterName;
    const receiverVkn = channel === 'IN_EFATURA' ? ownTaxNo : counterVkn;
    const uuid = String(ettn || rowId || faturaNo || createHash('sha1').update(JSON.stringify(row || {})).digest('hex')).trim();
    return {
      uuid,
      ettn,
      rowId,
      faturaNo,
      faturaDate: date,
      senderTitle,
      senderVkn,
      receiverTitle,
      receiverVkn,
      matrah,
      kdv,
      toplam: total,
      paraBirimi: currency === 'TRL' ? 'TRY' : currency,
      invoiceProfile: channel === 'OUT_EARSIV' ? 'e-Arsiv' : 'e-Fatura',
      documentType: channel === 'OUT_EARSIV' ? 'E_ARSIV' : 'E_FATURA',
      approval,
      iptal,
      raw: row,
    };
  }

  private syntheticTurmobInboxXml(row: any, taxpayer: any, channel: string): string {
    const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
    const moneyNumber = (value: any): number => {
      if (value == null || value === '') return 0;
      if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
      const text = String(value).replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
      const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : 0;
    };
    const total = moneyNumber(row?.toplam);
    const kdv = moneyNumber(row?.kdv);
    const matrah = moneyNumber(row?.matrah) || Math.max(0, total - kdv);
    const currency = String(row?.paraBirimi || 'TRY').toUpperCase() === 'TL' ? 'TRY' : String(row?.paraBirimi || 'TRY').toUpperCase();
    const issueDate = row?.faturaDate ? new Date(row.faturaDate) : null;
    const issueDateText = issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const faturaNo = String(row?.faturaNo || raw?.turmobRowId || row?.uuid || 'BILINMIYOR');
    const uuid = String(row?.ettn || row?.uuid || faturaNo);
    const incoming = String(channel || raw?.channel || '').toUpperCase() === 'IN_EFATURA';
    const ownName = this.reportTaxpayerName(taxpayer);
    const ownTaxNo = this.reportTaxNumber(taxpayer);
    const supplier = incoming
      ? { name: row?.senderTitle || raw?.senderTitle || 'BILINMIYOR', taxNo: row?.senderVkn || raw?.senderVkn || '' }
      : { name: ownName, taxNo: ownTaxNo };
    const customer = incoming
      ? { name: ownName, taxNo: ownTaxNo }
      : { name: row?.receiverTitle || raw?.receiverTitle || 'BILINMIYOR', taxNo: row?.receiverVkn || raw?.receiverVkn || '' };
    const docType = String(raw?.documentType || '').toUpperCase() === 'E_ARSIV' ? 'EARSIVFATURA' : 'TEMELFATURA';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ProfileID>${this.xmlEscape(docType)}</ProfileID>
  <ID>${this.xmlEscape(faturaNo)}</ID>
  <UUID>${this.xmlEscape(uuid)}</UUID>
  <IssueDate>${this.xmlEscape(issueDateText)}</IssueDate>
  <InvoiceTypeCode>SATIS</InvoiceTypeCode>
  <DocumentCurrencyCode>${this.xmlEscape(currency)}</DocumentCurrencyCode>
  ${this.syntheticParasutPartyXml('AccountingSupplierParty', String(supplier.name || 'BILINMIYOR'), String(supplier.taxNo || ''))}
  ${this.syntheticParasutPartyXml('AccountingCustomerParty', String(customer.name || 'BILINMIYOR'), String(customer.taxNo || ''))}
  <TaxTotal><TaxAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(kdv)}</TaxAmount></TaxTotal>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(matrah)}</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(matrah)}</TaxExclusiveAmount>
    <TaxInclusiveAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(total || matrah + kdv)}</TaxInclusiveAmount>
    <PayableAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(total || matrah + kdv)}</PayableAmount>
  </LegalMonetaryTotal>
  <InvoiceLine>
    <ID>1</ID>
    <InvoicedQuantity unitCode="NIU">1</InvoicedQuantity>
    <LineExtensionAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(matrah)}</LineExtensionAmount>
    <Item><Name>Fatura satiri</Name></Item>
    <Price><PriceAmount currencyID="${this.xmlEscape(currency)}">${this.parasutMoney(matrah)}</PriceAmount></Price>
  </InvoiceLine>
</Invoice>`;
  }

  private isSyntheticTurmobInboxXml(xml: any): boolean {
    const text = String(xml || '');
    if (!text.trim()) return false;
    return /<Item>\s*<Name>Fatura satiri<\/Name>\s*<\/Item>/i.test(text)
      || (/<Invoice>\s*<ProfileID>/i.test(text) && !/\sxmlns[:=]/i.test(text));
  }

  /**
   * TÜRMOB e-Belge portalından fatura çek — OTOMATİK login (TCKN=cfg.username, parola=cfg.password),
   * sonra gelen/giden liste (DataTables AJAX). Asistan PDF veriyordu; biz portal XML'ini alıyoruz (OCR yok).
   * NOT(ilk-test): liste response satır şeması + İPTAL durum alanı + XML indirme uç URL'i, ilk gerçek
   * çekimde response'tan netleşecek (loglanır); şimdilik login+liste kanıtı + iskelet. İptal olan satırlar
   * createDocumentFromProviderXml'e GÖNDERİLMEZ.
   */
  private async fetchTurmobPortalInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
      channel?: string;
      targetRows?: any[];
    },
  ): Promise<ProviderInvoicePayload[]> {
    if (!cfg.username || !cfg.password) throw new Error('TÜRMOB için TCKN (kullanıcı adı) ve parola gerekli');
    const cookie = await this.turmobLogin(cfg.username, cfg.password, cfg.senderVkn || undefined);
    const BASE = this.TURMOB_BASE;
    // Gelen=alış (/IncomingInvoice), Giden=satış (/OutgoingInvoice). e-Arşiv ucu ilk testte eklenecek.
    const channel = String(opts.channel || (opts.direction === 'SATIS' ? 'OUT_EFATURA' : 'IN_EFATURA')).toUpperCase();
    const { refererPath, listUrls } = this.turmobListPaths(channel);
    // Liste çekme boyutu: hedef satır aramasında küçük limit gelirse (ör. 8 PENDING), TÜRMOB yalnızca
    //   ilk N satırı döndürür ve hedefler bulunamaz. Her zaman en az 500 satır iste; gerçek dönüş
    //   limiti (opts.limit) aşağıda slice() ile uygulanır.
    const listFetchLimit = String(Math.min(Math.max(Number(opts.limit) || 500, 500), 1000));
    const baseListParams = {
      draw: '1',
      start: '0',
      length: listFetchLimit,
      'search[value]': '',
      'search[regex]': 'false',
      'order[0][column]': '0',
      'order[0][dir]': 'desc',
    };
    let listPageToken = '';
    let listPageHtml = '';
    try {
      const listPage = await this.turmobFetch(BASE +refererPath, {
        headers: { Cookie: cookie, 'User-Agent': 'MorenPortal/1.0', Accept: 'text/html,application/xhtml+xml,*/*' },
        redirect: 'manual',
      });
      listPageHtml = await listPage.text();
      listPageToken = listPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1]
        || listPageHtml.match(/__RequestVerificationToken[^>]*value="([^"]+)"/)?.[1]
        || '';
    } catch {
      // Liste ekrani isinma istegi opsiyonel; AJAX denemeleri devam eder.
    }
    let ct = '';
    let raw = '';
    let data: any = null;
    let rows: any[] = [];
    let selectedLiveRows: any[] = [];
    let usedListUrl = listUrls[0];
    let usedProfile = 'none';
    let usedMethod = 'POST';
    let directPayloads: ProviderInvoicePayload[] = [];
    const profiles = this.turmobDateProfiles(opts.period, channel);
    let done = false; // erken çıkış: canlı satırlar sunucunun bildirdiği toplama ulaşınca kalan kombinasyonları deneme
    for (const listUrl of listUrls) {
      if (done) break;
      for (const profile of profiles) {
        if (done) break;
        const listBody = new URLSearchParams(
          listPageToken
            ? { ...baseListParams, ...profile.params, __RequestVerificationToken: listPageToken }
            : { ...baseListParams, ...profile.params },
        ).toString();
        for (const method of ['POST', 'GET'] as const) {
          const requestUrl = method === 'GET' ? `${BASE}${listUrl}?${listBody}` : BASE + listUrl;
          let res: any;
          try {
            res = await this.turmobFetch(requestUrl, {
              method,
              headers: {
                ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
                Accept: 'application/json, text/javascript, */*; q=0.01',
                Origin: BASE,
                Referer: BASE + refererPath,
                'X-Requested-With': 'XMLHttpRequest',
                ...(listPageToken ? { RequestVerificationToken: listPageToken, __RequestVerificationToken: listPageToken } : {}),
                Cookie: cookie,
                'User-Agent': 'MorenPortal/1.0',
              },
              body: method === 'POST' ? listBody : undefined,
              // TEK İSTEK TAVANI (8sn): portal yavaşladığında kombinasyon matrisi sınırsız beklemesin
              //   (fetchTurmobPortalRows'daki ile aynı korumanın ikiz döngüye taşınması).
              signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(8000) : undefined,
            });
          } catch { continue; }
          const candidateCt = res.headers.get('content-type') || '';
          const candidateRaw = await res.text().catch(() => '');
          let candidateData: any = null;
          try { candidateData = JSON.parse(candidateRaw); } catch { /* HTML = muhtemelen login redirect */ }
          const candidateRows = this.turmobRowsFromListResponse(candidateData);
          const candidateLiveRows = candidateRows.filter((row) => !this.turmobIsCancelled(row) && this.turmobRowInPeriod(row, opts.period));
          const candidateDirectPayloads = await this.extractPayloadsFromProviderResponse(candidateRaw, ['xml', 'ubl', 'content', 'data', 'base64', 'DocumentXml', 'InvoiceXml']);
          if (
            candidateDirectPayloads.length > directPayloads.length
            || candidateLiveRows.length > selectedLiveRows.length
            || (!selectedLiveRows.length && candidateRows.length > rows.length)
          ) {
            raw = candidateRaw;
            data = candidateData;
            ct = candidateCt;
            rows = candidateRows;
            selectedLiveRows = candidateLiveRows;
            usedListUrl = listUrl;
            usedProfile = profile.name;
            usedMethod = method;
            directPayloads = candidateDirectPayloads;
          }
          // Satır geldi ve sunucunun bildirdiği toplam kadar → yeter, kalan kombinasyonları deneme.
          if (candidateLiveRows.length > 0) {
            const bildirilen = Number(candidateData?.recordsFiltered ?? candidateData?.RecordsFiltered ?? candidateData?.recordsTotal ?? candidateData?.RecordsTotal ?? NaN);
            if (!Number.isFinite(bildirilen) || candidateRows.length >= bildirilen) { done = true; break; }
          }
        }
      }
    }
    const first = raw.trimStart().slice(0, 1); // '<' = HTML/login redirect (cookie yetersiz), '{'/'[' = JSON (parametre/dönem)
    // TEŞHİS: first='<' → oturum liste için yetersiz; '{' ama rows=0 → parametre/dönem filtresi gerekli.
    this.logger.log(`TURMOB portal ${channel}: url=${usedListUrl} method=${usedMethod} profile=${usedProfile} ct=${ct.slice(0, 40)} len=${raw.length} first=${first} rows=${rows.length} topKeys=${JSON.stringify(Object.keys(data || {})).slice(0, 150)} rowKeys=${JSON.stringify(Object.keys(rows[0] || {})).slice(0, 250)}`);
    // İptal filtresi ALAN-BAZLI olmalı (sınıftaki turmobIsCancelled). Eskiden yerel isCancelled tüm
    //   durum alanlarını tek metne birleştirip bakıyordu → "önce onaylandı SONRA iptal edilen" fatura
    //   'onaylandı' kelimesiyle temiz sanılıyordu. turmobIsCancelled her alanı kendi içinde değerlendirir.
    const liveAll = rows.filter((r) => !this.turmobIsCancelled(r) && this.turmobRowInPeriod(r, opts.period));
    const targetRows = Array.isArray(opts.targetRows) ? opts.targetRows : [];
    const targetKeys = new Set<string>();
    const addTargetKey = (value: any) => {
      const key = this.providerKey(value);
      if (key) targetKeys.add(key);
    };
    for (const target of targetRows) {
      const raw = target?.rawJson && typeof target.rawJson === 'object' ? target.rawJson : {};
      const summaryRaw = raw?.turmobSummaryRaw && typeof raw.turmobSummaryRaw === 'object' ? raw.turmobSummaryRaw : {};
      addTargetKey(target?.uuid);
      addTargetKey(target?.ettn);
      addTargetKey(target?.faturaNo);
      addTargetKey(raw?.turmobRowId);
      addTargetKey(summaryRaw?.Ettn);
      addTargetKey(summaryRaw?.FaturaNo);
      addTargetKey(summaryRaw?.IadeFaturaNo);
      addTargetKey(summaryRaw?.IdFaturaGelen);
      addTargetKey(summaryRaw?.IdFaturaGiden);
      addTargetKey(summaryRaw?.IdFaturaArsiv);
      const amountKey = this.providerAmountKey(target?.toplam ?? summaryRaw?.OdenecekTutar ?? summaryRaw?.OdenecekTutarFormatted);
      const faturaKey = this.providerKey(target?.faturaNo || summaryRaw?.FaturaNo || summaryRaw?.IadeFaturaNo);
      if (faturaKey && amountKey) addTargetKey(`${faturaKey}:${amountKey}`);
    }
    const rowMatchesTarget = (row: any) => {
      if (!targetKeys.size) return true;
      const summary = this.turmobSummaryFromRow(row, { channel, taxpayer: opts.taxpayer, direction: opts.direction });
      const candidates = [
        summary.uuid,
        summary.ettn,
        summary.faturaNo,
        summary.rowId,
        summary.raw?.Ettn,
        summary.raw?.FaturaNo,
        summary.raw?.IadeFaturaNo,
        summary.raw?.IdFaturaGelen,
        summary.raw?.IdFaturaGiden,
        summary.raw?.IdFaturaArsiv,
      ];
      for (const candidate of candidates) {
        const key = this.providerKey(candidate);
        if (key && targetKeys.has(key)) return true;
        const amountKey = this.providerAmountKey(summary.toplam);
        const keyWithAmount = key && amountKey ? this.providerKey(`${key}:${amountKey}`) : null;
        if (keyWithAmount && targetKeys.has(keyWithAmount)) return true;
      }
      // SON ÇARE substring eşleşmesi YALNIZ benzersiz kimliklerle (fatura no=16, ETTN=32 karakter).
      //   Eski eşik (>=6) tutar(6)/tarih(8)/VKN(10) gibi KISA parçaların başka satırın JSON'unda rastgele
      //   geçmesiyle YANLIŞ faturaya bağlanmaya yol açıyordu (yanlış belge indirme). 16 = tam fatura no boyu.
      const rowTextKey = this.providerKey(JSON.stringify(row || {}));
      if (rowTextKey) {
        for (const targetKey of targetKeys) {
          if (targetKey.length >= 16 && rowTextKey.includes(targetKey)) return true;
        }
      }
      return false;
    };
    const live = targetKeys.size ? liveAll.filter(rowMatchesTarget) : liveAll;
    if (targetKeys.size && !live.length && liveAll.length) {
      this.logger.warn(`TURMOB hedef satir listede bulunamadi: channel=${channel} targets=${targetKeys.size} rows=${liveAll.length}`);
    }
    const payloads = [...directPayloads];
    // ════ HIZLI YOL — TÜRMOB doğrudan uçlar (brute-force YOK; Mihsap gibi hızlı) ════
    //   Her satır için XML(veri)+görsel DİREKT + EŞZAMANLI iner; eşleştirme satır-bazlı (off-by-one yok).
    //   GetInvoiceXml → UBL XML · Detail&IsPrint → orijinal görsel HTML (TÜRMOB portalında doğrulandı 2026-06-29).
    //   IdFatura olan tüm satırlar bu yoldan iner → 520-URL brute-force çoğu zaman HİÇ çalışmaz.
    const directInOrOut = channel === 'IN_EFATURA' ? 'True' : 'False';
    const directHeaders = { Cookie: cookie, 'User-Agent': 'MorenPortal/1.0', Accept: 'application/xml,text/xml,text/html,*/*', Origin: BASE, Referer: BASE + refererPath };
    const directRows = live
      .map((row) => ({ row, id: String(this.turmobField(row, ['IdFatura', 'idFatura', 'IdFaturaEk']) || '').replace(/\D/g, '') }))
      .filter((x) => x.id);
    let directOk = 0;
    if (directRows.length) {
      const CONC = 6;
      for (let i = 0; i < directRows.length; i += CONC) {
        await Promise.all(directRows.slice(i, i + CONC).map(async ({ row, id }) => {
          const ctl = new AbortController();
          const tm = setTimeout(() => { try { ctl.abort(); } catch { /* */ } }, 9000);
          try {
            const [xmlRes, visRes] = await Promise.all([
              fetch(`${BASE}/Invoice/GetInvoiceXml?InOrOut=${directInOrOut}&InvoiceId=${id}`, { headers: directHeaders, signal: ctl.signal }),
              fetch(`${BASE}/Invoice/Detail?InOrOut=${directInOrOut}&InvoiceId=${id}&IsPrint=True`, { headers: directHeaders, signal: ctl.signal }).catch(() => null),
            ]);
            const xml = await xmlRes.text();
            if (!/^\s*<\?xml|<[\w:]*Invoice\b/i.test(xml.slice(0, 400))) return; // geçerli UBL değil → atla
            const summary = this.turmobSummaryFromRow(row, { channel, taxpayer: opts.taxpayer, direction: opts.direction });
            const payload: ProviderInvoicePayload = { xml, externalId: summary.ettn || summary.faturaNo || summary.uuid || id, originalName: `${this.safeInvoiceFileStem(summary.faturaNo || id)}.xml` };
            if (visRes && visRes.ok) {
              const vis = await visRes.text();
              if (vis && /<(?:!doctype\s+html|html|body)\b/i.test(vis.slice(0, 3000)) && !/account\/login|name=["']password["']/i.test(vis) && /(Invoice|Fatura)/i.test(vis.slice(0, 30000))) {
                // /Invoice/Detail?IsPrint=True YAZDIRMA görünümüdür → önizlemede AÇILINCA otomatik yazdırmaya
                //   çalışıyordu. Yazdırma tetikleyicilerini temizle (içerik/görsel aynen kalır, sadece oto-print gider).
                payload.htmlContent = vis
                  .replace(/<script[^>]*>[\s\S]*?(?:window\.)?print\s*\([\s\S]*?<\/script>/gi, '')
                  .replace(/(?:window\.)?print\s*\(\s*\)/gi, 'void 0')
                  .replace(/\bonload\s*=\s*(["'])[^"']*?print[^"']*?\1/gi, '');
              }
            }
            payloads.push(payload);
            directOk++;
          } catch { /* bu fatura direkt inemedi → brute-force fallback dener */ } finally { clearTimeout(tm); }
        }));
      }

    }
    const priorityUrls = new Set<string>();
    const seenUrls = new Set<string>();
    type TurmobDownloadRequest = { url: string; method: 'GET' | 'POST'; body?: string };
    const postRequests: TurmobDownloadRequest[] = [];
    const postKeys = new Set<string>();
    const addCandidateUrl = (candidate: string, trustedPath = false) => {
      const clean = this.decodeXmlEntities(String(candidate || '').replace(/\\\//g, '/')).trim();
      const hasDocumentKeyword = /(xml|ubl|indir|download|invoice|fatura|belge|goruntule|görüntüle)/i.test(clean);
      const looksLikePath = /^(https?:\/\/|\/)/i.test(clean)
        || /[\\/]/.test(clean)
        || /\.[a-z0-9]{2,5}(?:$|[?#])/i.test(clean)
        || /[?&][A-Za-z0-9_%-]+=/.test(clean);
      if (!clean || (!hasDocumentKeyword && !(trustedPath && looksLikePath))) return;
      const absolute = clean.startsWith('http') ? clean : BASE + (clean.startsWith('/') ? clean : `/${clean}`);
      if (trustedPath) priorityUrls.add(absolute);
      else seenUrls.add(absolute);
    };
    const addCandidatePost = (candidate: string, params: Record<string, string | null | undefined>) => {
      const clean = this.decodeXmlEntities(String(candidate || '').replace(/\\\//g, '/')).trim();
      if (!clean) return;
      const absolute = clean.startsWith('http') ? clean : BASE + (clean.startsWith('/') ? clean : `/${clean}`);
      if (!/turmobefatura\.luca\.com\.tr\/(?:IncomingInvoice|OutgoingInvoice|ArchiveInvoice|OutgoingArchiveInvoice|EArchiveInvoice|Invoice)\//i.test(absolute)) return;
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        const text = String(value || '').trim();
        if (text) body.set(key, text);
      }
      const serialized = body.toString();
      if (!serialized) return;
      const requestKey = `${absolute}::${serialized}`;
      if (postKeys.has(requestKey)) return;
      postKeys.add(requestKey);
      postRequests.push({ url: absolute, method: 'POST', body: serialized });
    };
    const rowValues = (row: any, keys: string[]) => {
      const wanted = new Set(keys.map((key) => key.toLowerCase()));
      const values = new Set<string>();
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        for (const [key, nested] of Object.entries(value)) {
          if (wanted.has(key.toLowerCase()) && (typeof nested === 'string' || typeof nested === 'number')) {
            const text = String(nested).trim();
            if (/^[A-Za-z0-9_-]{1,80}$/.test(text)) values.add(text);
          }
          visit(nested);
        }
      };
      visit(row);
      return [...values];
    };
    const rowTextValues = (row: any, keys: string[]) => {
      const wanted = new Set(keys.map((key) => key.toLowerCase()));
      const values = new Set<string>();
      const visit = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        for (const [key, nested] of Object.entries(value)) {
          if (wanted.has(key.toLowerCase()) && (typeof nested === 'string' || typeof nested === 'number')) {
            const text = String(nested).trim();
            if (text && text.length <= 500) values.add(text);
          }
          visit(nested);
        }
      };
      visit(row);
      return [...values];
    };
    const turmobCandidateIds = (row: any) => {
      const values = new Set<string>();
      const add = (value: any, keyHint = '') => {
        const text = String(value ?? '').trim();
        if (!text || text.length > 120) return;
        const key = keyHint.toLowerCase();
        const looksUsefulKey = /id|uuid|ettn|guid|oid|pk|xml|belge|fatura|invoice|arsiv|archive/.test(key);
        const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
        const looksHex32 = /^[0-9a-f]{32}$/i.test(text);
        const looksOpaqueId = looksUsefulKey && /^[A-Za-z0-9_-]{4,100}$/.test(text);
        const looksArrayNumericId = !looksUsefulKey && /^\d{6,12}$/.test(text) && text.length !== 10 && text.length !== 11;
        const looksInvoiceNumber = !looksUsefulKey && /^[A-Z]{2,6}\d{8,24}$/i.test(text);
        if (looksUuid || looksHex32 || looksOpaqueId || looksArrayNumericId || looksInvoiceNumber) values.add(text);
      };
      const visit = (value: any, keyHint = '') => {
        if (value == null) return;
        if (typeof value === 'string' || typeof value === 'number') {
          add(value, keyHint);
          const text = String(value);
          for (const m of text.matchAll(/(?:data-)?(?:invoice|fatura|belge|archive|arsiv)?(?:id|uuid|ettn|guid|oid)\s*=\s*["']?([A-Za-z0-9_-]{4,100})/gi)) add(m[1], 'id');
          for (const m of text.matchAll(/(?:InvoiceId|InvoiceID|FaturaId|BelgeId|ArchiveId|ArsivId|ETTN|UUID|Guid|GUID)["'\s:=]+([A-Za-z0-9_-]{4,100})/g)) add(m[1], 'id');
          for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*(?:Invoice|Fatura|Belge|Detail|Hint|Xml|XML|Download|Print)[A-Za-z0-9_]*)\s*\(([^)]{1,500})\)/g)) {
            for (const arg of m[2].matchAll(/["']?([A-Za-z0-9_-]{4,120})["']?/g)) add(arg[1], 'id');
          }
          if (/action|button|html|hint|link/i.test(keyHint)) {
            for (const m of text.matchAll(/["']([A-Za-z0-9_-]{4,120})["']/g)) add(m[1], 'id');
            for (const m of text.matchAll(/\b([A-Z]{2,6}\d{8,24})\b/g)) add(m[1], 'invoice');
            for (const m of text.matchAll(/\b(\d{6,9}|\d{12,16})\b/g)) add(m[1], 'id');
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((nested, index) => visit(nested, `${keyHint}.${index}`));
          return;
        }
        if (typeof value === 'object') {
          for (const [key, nested] of Object.entries(value)) visit(nested, key);
        }
      };
      visit(row);
      return [...values];
    };
    const addTurmobDocumentUrls = (row: any) => {
      const inOrOut = channel === 'IN_EFATURA' ? 'True' : 'False';
      // KESİN UÇLAR — TÜRMOB portalında ağ izlenerek doğrulandı (2026-06-29): sayısal IdFatura ile
      //   XML (veri) ve görsel (HTML) DİREKT iniyor. Brute-force bunları 520 aday arasında geç deneyip
      //   attempt-cap'e takılıyordu (payload=0 → "indirme linki çözümlenemedi"). Öncelikli (trusted) ekle.
      //   GetInvoiceXml → 325KB UBL XML; Detail&IsPrint → 42KB orijinal fatura HTML'i.
      const idFaturaDirect = String(this.turmobField(row, ['IdFatura', 'idFatura', 'IdFaturaEk', 'IdArsiv', 'idArsiv', 'IdArsivEk']) || '').replace(/\D/g, '');
      if (idFaturaDirect) {
        if (channel === 'OUT_EARSIV') {
          // KESİN e-ARŞİV UÇLARI — TÜRMOB portalında ağ izlenip fetch ile DOĞRULANDI (2026-07-04):
          //   satır menüsü xmlArchive(IdArsiv) → GET /Invoice/GetInvoiceXml?InOrOut=false&ArchiveId=<IdArsiv>
          //   (200, 280KB gerçek UBL). Param adı InvoiceId DEĞİL **ArchiveId**; bu yüzden e-Arşiv indirmesi
          //   hiç çözülemiyordu ("belge inmedi"). PDF=GetInvoicePdf, görsel=Detail (hepsi ArchiveId).
          addCandidateUrl(`/Invoice/GetInvoiceXml?InOrOut=${inOrOut}&ArchiveId=${idFaturaDirect}`, true);
          addCandidateUrl(`/Invoice/GetInvoicePdf?InOrOut=${inOrOut}&ArchiveId=${idFaturaDirect}`, true);
          addCandidateUrl(`/Invoice/Detail?InOrOut=${inOrOut}&ArchiveId=${idFaturaDirect}&IsPrint=True`, true);
          // Geriye-uyum: InvoiceId varyantları da bırak (başka sürüm/kanal).
          addCandidateUrl(`/Invoice/GetInvoiceXml?InOrOut=${inOrOut}&InvoiceId=${idFaturaDirect}`, true);
        } else {
          addCandidateUrl(`/Invoice/GetInvoiceXml?InOrOut=${inOrOut}&InvoiceId=${idFaturaDirect}`, true);
          addCandidateUrl(`/Invoice/Detail?InOrOut=${inOrOut}&InvoiceId=${idFaturaDirect}&IsPrint=True`, true);
        }
      }
      const pathPrefixes = channel === 'IN_EFATURA'
        ? ['/IncomingInvoice', '/Invoice']
        : channel === 'OUT_EARSIV'
          // e-Arşiv modülü GERÇEKTE /OutgoingInvoice altında (OutgoingArchiveList) → o prefix ÖNCE.
          ? ['/OutgoingInvoice', '/ArchiveInvoice', '/OutgoingArchiveInvoice', '/EArchiveInvoice', '/Invoice']
          : ['/OutgoingInvoice', '/Invoice'];
      const pathActions = [
        'DownloadFile',
        'Download',
        'DownloadDocument',
        'DownloadInvoice',
        'DownloadXml',
        'DownloadXML',
        'GetFile',
        'GetDocument',
        'GetInvoiceFile',
        'GetInvoiceDocument',
        'GetInvoiceXml',
        'GetInvoiceXML',
        'Print',
        'Detail',
      ];
      const pathParams = ['filePath', 'FilePath', 'path', 'Path', 'fileName', 'FileName', 'documentPath', 'DocumentPath'];
      for (const path of rowTextValues(row, ['FilePath', 'XmlPath', 'XMLPath', 'XmlFilePath', 'PdfFilePath', 'HtmlFilePath', 'PdfPath', 'PDFPath', 'DownloadPath', 'Url', 'URL'])) {
        addCandidateUrl(path, true);
        const encoded = encodeURIComponent(path);
        for (const prefix of pathPrefixes) {
          for (const action of pathActions) {
            for (const param of pathParams) {
              addCandidateUrl(`${prefix}/${action}?${param}=${encoded}`, true);
              addCandidateUrl(`${prefix}/${action}?${param}=${encoded}&InOrOut=${inOrOut}`, true);
            }
          }
        }
      }
      // 'IdFatura' = TÜRMOB liste satırındaki SAYISAL fatura kimliği (her kanalda var; kanal-özel
      //   IdFaturaGelen/Giden bu sürümde YOK). Görsel ucu bunu ister: /Invoice/Detail?InvoiceId=<IdFatura>&IsPrint
      //   → 42KB fatura HTML'i (TÜRMOB portalında doğrulandı). Eskiden IdFatura çıkarılmadığından görsel hep MISSING'di.
      const channelIdKeys = channel === 'IN_EFATURA'
        ? ['IdFatura', 'idFatura', 'IdFaturaGelen', 'idFaturaGelen', 'FaturaGelenId', 'IncomingInvoiceId', 'InvoiceId', 'Id']
        : channel === 'OUT_EARSIV'
          ? ['IdArsiv', 'idArsiv', 'IdArsivEk', 'IdFatura', 'idFatura', 'IdFaturaArsiv', 'idFaturaArsiv', 'IdFaturaGidenArsiv', 'ArchiveInvoiceId', 'IdFaturaGiden', 'InvoiceId', 'Id']
          : ['IdFatura', 'idFatura', 'IdFaturaGiden', 'idFaturaGiden', 'FaturaGidenId', 'OutgoingInvoiceId', 'InvoiceId', 'Id'];
      const invoiceIds = [...new Set([
        ...rowValues(row, channelIdKeys),
        ...rowValues(row, ['InvoiceId', 'InvoiceID', 'invoiceId', 'FaturaId', 'faturaId', 'BelgeId', 'belgeId', 'Id', 'ID', 'id', 'Uuid', 'UUID', 'uuid', 'Ettn', 'ETTN', 'ettn', 'Guid', 'GUID', 'guid']),
        ...turmobCandidateIds(row),
      ])].slice(0, 5);
      // IdArsiv = e-Arşiv satırının GERÇEK arşiv kimliği (GetInvoiceXml?ArchiveId=<IdArsiv>). Alan adı
      //   'ArchiveId' değil 'IdArsiv' olduğundan bu yedek blok hiç tetiklenmiyordu → eklendi.
      const archiveIds = [...new Set(rowValues(row, ['IdArsiv', 'idArsiv', 'IdArsivEk', 'ArchiveId', 'ArchiveID', 'archiveId', 'ArsivId', 'arsivId']))].slice(0, 4);
      const addInvoiceUrlSet = (id: string, keyName: 'InvoiceId' | 'id' | 'uuid' | 'ettn') => {
        const q = `${keyName}=${encodeURIComponent(id)}`;
        const io = `InOrOut=${inOrOut}`;
        const prefixes = channel === 'IN_EFATURA'
          ? ['/IncomingInvoice', '/Invoice']
          : channel === 'OUT_EARSIV'
            ? ['/OutgoingInvoice', '/ArchiveInvoice', '/OutgoingArchiveInvoice', '/Invoice']
            : ['/OutgoingInvoice', '/Invoice'];
        for (const prefix of prefixes) {
          addCandidateUrl(`${prefix}/GetInvoiceXml?${io}&${q}`);
          addCandidateUrl(`${prefix}/GetInvoiceXML?${io}&${q}`);
          addCandidateUrl(`${prefix}/DownloadXml?${io}&${q}`);
          addCandidateUrl(`${prefix}/Detail?${io}&${q}&IsPrint=True`);
          addCandidateUrl(`${prefix}/Print?${io}&${q}`);
          addCandidatePost(`${prefix}/GetInvoiceXml`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/GetInvoiceXML`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/DownloadXml`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/DownloadXML`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/InvoiceDetailHint`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/GetInvoiceDetail`, { [keyName]: id, InOrOut: inOrOut });
          addCandidatePost(`${prefix}/Detail`, { [keyName]: id, InOrOut: inOrOut, IsPrint: 'True' });
        }
      };
      const addTurmobIdUrlSet = (id: string) => {
        const idText = encodeURIComponent(id);
        const prefixes = channel === 'IN_EFATURA'
          ? ['/IncomingInvoice']
          : channel === 'OUT_EARSIV'
            ? ['/OutgoingInvoice', '/ArchiveInvoice', '/OutgoingArchiveInvoice', '/EArchiveInvoice']
            : ['/OutgoingInvoice'];
        const paramNames = channel === 'IN_EFATURA'
          ? ['IdFaturaGelen', 'idFaturaGelen', 'FaturaGelenId', 'InvoiceId', 'id']
          : channel === 'OUT_EARSIV'
            ? ['IdArsiv', 'idArsiv', 'ArsivId', 'IdFaturaArsiv', 'idFaturaArsiv', 'ArchiveInvoiceId', 'IdFaturaGiden', 'InvoiceId', 'id']
            : ['IdFaturaGiden', 'idFaturaGiden', 'FaturaGidenId', 'InvoiceId', 'id'];
        const actions = [
          'GetInvoiceXml',
          'GetInvoiceXML',
          'DownloadXml',
          'DownloadXML',
          'DownloadInvoice',
          'InvoiceDetail',
          'GetInvoiceDetail',
          'InvoiceDetailHint',
          'Print',
          'Detail',
        ];
        for (const prefix of prefixes) {
          for (const action of actions) {
            for (const param of paramNames) {
              addCandidateUrl(`${prefix}/${action}?${param}=${idText}`);
              addCandidateUrl(`${prefix}/${action}?${param}=${idText}&InOrOut=${inOrOut}`);
              addCandidatePost(`${prefix}/${action}`, { [param]: id, InOrOut: inOrOut });
            }
          }
        }
      };
      for (const id of rowValues(row, channelIdKeys).slice(0, 3)) addTurmobIdUrlSet(id);
      for (const id of invoiceIds) {
        const idText = String(id);
        const keys: Array<'InvoiceId' | 'id' | 'uuid' | 'ettn'> = /^[0-9a-f-]{32,36}$/i.test(idText)
          ? ['uuid', 'ettn', 'InvoiceId']
          : /^\d+$/.test(idText)
            ? ['InvoiceId', 'id']
            : ['InvoiceId', 'id', 'uuid'];
        for (const key of keys) addInvoiceUrlSet(id, key);
      }
      for (const id of archiveIds) {
        addCandidateUrl(`/Invoice/GetInvoiceXml?InOrOut=${inOrOut}&ArchiveId=${encodeURIComponent(id)}`, true);
        addCandidateUrl(`/Invoice/GetInvoicePdf?InOrOut=${inOrOut}&ArchiveId=${encodeURIComponent(id)}`, true);
        addCandidateUrl(`/Invoice/GetInvoiceXml?InOrOut=False&ArchiveId=${encodeURIComponent(id)}`);
        addCandidateUrl(`/Invoice/GetInvoiceXML?InOrOut=False&ArchiveId=${encodeURIComponent(id)}`);
        addCandidateUrl(`/Invoice/Detail?InOrOut=False&ArchiveId=${encodeURIComponent(id)}&IsPrint=True`);
        addCandidateUrl(`/Invoice/PrintAllInvoice?InOrOut=False&ArchiveId=${encodeURIComponent(id)}&IsPrint=True`);
        addCandidatePost('/Invoice/GetInvoiceXml', { ArchiveId: id, InOrOut: 'False' });
        addCandidatePost('/Invoice/GetInvoiceXML', { ArchiveId: id, InOrOut: 'False' });
        addCandidatePost('/Invoice/Detail', { ArchiveId: id, InOrOut: 'False', IsPrint: 'True' });
        for (const prefix of ['/ArchiveInvoice', '/OutgoingArchiveInvoice', '/EArchiveInvoice', '/Invoice']) {
          addCandidateUrl(`${prefix}/GetInvoiceXml?ArchiveId=${encodeURIComponent(id)}`);
          addCandidateUrl(`${prefix}/GetInvoiceXML?ArchiveId=${encodeURIComponent(id)}`);
          addCandidateUrl(`${prefix}/DownloadXml?ArchiveId=${encodeURIComponent(id)}`);
          addCandidateUrl(`${prefix}/DownloadXML?ArchiveId=${encodeURIComponent(id)}`);
          addCandidateUrl(`${prefix}/Detail?ArchiveId=${encodeURIComponent(id)}&IsPrint=True`);
          addCandidatePost(`${prefix}/GetInvoiceXml`, { ArchiveId: id });
          addCandidatePost(`${prefix}/GetInvoiceXML`, { ArchiveId: id });
          addCandidatePost(`${prefix}/DownloadXml`, { ArchiveId: id });
          addCandidatePost(`${prefix}/Detail`, { ArchiveId: id, IsPrint: 'True' });
        }
      }
    };
    for (const m of listPageHtml.matchAll(/["'](\/(?:IncomingInvoice|OutgoingInvoice|ArchiveInvoice|OutgoingArchiveInvoice|EArchiveInvoice|Invoice)\/[^"']*(?:Xml|XML|Download|Invoice|Detail|Print|Ubl|UBL)[^"']*)["']/gi)) {
      addCandidateUrl(m[1]);
    }
    // Brute-force SADECE hızlı yol bazı faturaları indiremediyse (fallback). Hepsi indiyse hiç çalışmaz → HIZLI.
    if (payloads.length < Math.max(live.length, 1)) for (const row of live) {
      const asText = JSON.stringify(row || {});
      for (const m of asText.matchAll(/https?:\/\/[^"'\\\s<>]+|\/[^"'\\\s<>]*(?:xml|ubl|indir|download|invoice|fatura|belge|goruntule|görüntüle)[^"'\\\s<>]*/gi)) {
        addCandidateUrl(m[0]);
      }
      addTurmobDocumentUrls(row);
    }
    let downloadAttempts = 0;
    const targetRowCount = targetRows.length || live.length;
    const maxDownloadAttempts = targetKeys.size
      ? (targetRowCount > 1
          ? Math.min(520, Math.max(80, targetRowCount * 16))
          : Math.min(60, Math.max(20, live.length * 18)))
      : Math.min(2600, Math.max(260, live.length * 36));
    const targetPayloadCount = Math.min(opts.limit, Math.max(live.length, payloads.length || 1));
    const requestQueue: TurmobDownloadRequest[] = [];
    const queuedRequests = new Set<string>();
    const enqueueRequest = (request: TurmobDownloadRequest) => {
      const key = `${request.method}:${request.url}:${request.body || ''}`;
      if (queuedRequests.has(key)) return;
      queuedRequests.add(key);
      requestQueue.push(request);
    };
    const drainCandidateRequests = () => {
      for (const url of priorityUrls) enqueueRequest({ url, method: 'GET' });
      for (const request of postRequests) enqueueRequest(request);
      for (const url of seenUrls) enqueueRequest({ url, method: 'GET' });
    };
    const canReuseStandaloneVisual = targetKeys.size === 1 || live.length <= 1;
    let standalonePdf: Buffer | null = null;
    let standaloneHtml: string | null = null;
    const attachStandaloneVisual = (fromIndex: number, localPdf?: Buffer | null, localHtml?: string | null) => {
      const pdf = localPdf || (canReuseStandaloneVisual ? standalonePdf : null);
      const html = localHtml || (canReuseStandaloneVisual ? standaloneHtml : null);
      for (let i = fromIndex; i < payloads.length; i++) {
        if (pdf && !payloads[i].pdfBuffer) payloads[i].pdfBuffer = pdf;
        if (html && !payloads[i].htmlContent) payloads[i].htmlContent = html;
      }
    };
    const rememberStandaloneVisual = (buf: Buffer, text: string, contentType: string) => {
      let localPdf: Buffer | null = null;
      let localHtml: string | null = null;
      if (!standalonePdf && (/pdf/i.test(contentType) || (buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46))) {
        localPdf = buf;
        if (canReuseStandaloneVisual) standalonePdf = buf;
      }
      const head = text.slice(0, 3000);
      if (!standaloneHtml
        && /(?:html|xhtml)/i.test(contentType + head)
        && /<(?:!doctype\s+html|html|body)\b/i.test(head)
        && !/account\/login|name=["']password["']/i.test(text)
        && /(Invoice|Fatura|e-Fatura|e-Arsiv|e-Arşiv)/i.test(text.slice(0, 30000))) {
        localHtml = text.trim();
        if (canReuseStandaloneVisual) standaloneHtml = localHtml;
      }
      return { pdf: localPdf, html: localHtml };
    };
    const collectCandidateUrls = (text: string) => {
      for (const m of text.matchAll(/https?:\/\/[^"'\\\s<>]+|\/(?:IncomingInvoice|OutgoingInvoice|ArchiveInvoice|OutgoingArchiveInvoice|EArchiveInvoice|Invoice)\/[^"'\\\s<>]+/gi)) {
        addCandidateUrl(m[0], /(?:Xml|XML|Ubl|UBL|Download|Print|Detail)/.test(m[0]));
      }
      for (const m of text.matchAll(/(?:href|src|data-url|data-href|url)\s*=\s*["']([^"']+)["']/gi)) {
        addCandidateUrl(m[1], /(?:Xml|XML|Ubl|UBL|Download|Print|Detail)/.test(m[1]));
      }
    };
    drainCandidateRequests();
    while (requestQueue.length && downloadAttempts < maxDownloadAttempts) {
      const request = requestQueue.shift()!;
      downloadAttempts++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), targetKeys.size ? 1200 : 2500);
      try {
        const docRes = await this.turmobFetch(request.url, {
          method: request.method,
          signal: controller.signal,
          headers: {
            ...(request.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } : {}),
            Cookie: cookie,
            'User-Agent': 'MorenPortal/1.0',
            Accept: 'application/xml,text/xml,application/zip,application/pdf,text/html,application/json,*/*',
            Origin: BASE,
            Referer: BASE + refererPath,
          },
          body: request.method === 'POST' ? request.body : undefined,
        });
        const buf = Buffer.from(await docRes.arrayBuffer());
        if (!docRes.ok || !buf.length) continue;
        const contentType = String(docRes.headers.get('content-type') || '');
        const text = buf.toString('utf8');
        const localVisual = rememberStandaloneVisual(buf, text, contentType);

        collectCandidateUrls(text);
        drainCandidateRequests();
        const before = payloads.length;
        const nestedPayloads = await this.extractPayloadsFromProviderResponse(text, ['xml', 'ubl', 'content', 'data', 'base64', 'DocumentXml', 'InvoiceXml']);
        payloads.push(...nestedPayloads);
        if (payloads.length === before) {
          await this.addPayloadBuffer(payloads, buf);
        }
        if (payloads.length === before) {
          await this.addPayloadString(payloads, text);
        }
        attachStandaloneVisual(before, localVisual.pdf, localVisual.html);
      } catch (e: any) {
        const message = e?.name === 'AbortError' ? 'timeout' : (e?.message || e);
        this.logger.warn(`TURMOB dokuman indirilemedi: ${request.method} ${request.url} ${message}`);
      } finally {
        clearTimeout(timer);
      }
      const uniqueCount = new Set(payloads.map((payload) => payload.externalId || createHash('sha1').update(payload.xml).digest('hex'))).size;
      if (uniqueCount >= targetPayloadCount) break;
    }

    if (!payloads.length && first === '<') {
      throw new Error('TURMOB oturumu liste ekranina gecemedi; portal login sayfasina geri dondu');
    }
    if (!payloads.length && rows.length === 0) {
      const topKeys = JSON.stringify(Object.keys(data || {})).slice(0, 150);
      const shape = first === '{' || first === '[' ? 'JSON bos liste' : first === '<' ? 'HTML/login' : 'bos/okunamayan cevap';
      throw new Error(`TURMOB ${channel} fatura satiri dondurmedi (${shape}; url=${usedListUrl}; method=${usedMethod}; profil=${usedProfile}; ct=${ct.slice(0, 40) || '-'}; len=${raw.length}; keys=${topKeys || '-'})`);
    }
    if (!payloads.length && rows.length > 0) {
      const sample = rows[0];
      const rowKeys = Array.isArray(sample)
        ? sample.map((value: any, index: number) => `${index}:${typeof value}`).slice(0, 40).join(',')
        : Object.keys(sample || {}).slice(0, 80).join(',');
      const scalars = turmobCandidateIds(sample).slice(0, 20).join(',');
      this.logger.warn(`TURMOB indirme linki cozumlenemedi: channel=${channel} rows=${rows.length} attempts=${downloadAttempts} rowKeys=${rowKeys || '-'} ids=${scalars || '-'}`);
      throw new Error(`TURMOB liste ${rows.length} satir dondurdu ama belge indirme baglantisi cozumlenemedi`);
    }
    const uniquePayloads = new Map<string, ProviderInvoicePayload>();
    for (const payload of payloads) {
      const key = payload.externalId || createHash('sha1').update(payload.xml).digest('hex');
      if (!uniquePayloads.has(key)) uniquePayloads.set(key, payload);
    }
    return [...uniquePayloads.values()].slice(0, opts.limit);
  }

  /**
   * Parasut OAuth2 + REST adapter. Erisim icin client_id + client_secret + user/pass gerek.
   * Token al -> /v4/{firmaNo}/purchase_bills (ALIS) veya sales_invoices (SATIS) cek.
   */
  /**
   * Turkcell e-Şirket = isim360 REST API. Gelen (ALIS) e-Fatura'yı inboxinvoice,
   * giden (SATIS) e-Fatura'yı outboxinvoice servisinden çeker.
   *
   * Kimlik (iki yol — SMS GÖNDERMEZ; SMS yalnız panele elle girişte gider):
   *   1) apiKey  → 'X-Api-Key' header. Mükellef panelinden (API Yönetimi > Yeni API
   *      Anahtarı) BİR KEZ oluşturulur, sonra çekimde tekrar giriş/SMS gerekmez.
   *   2) kullanıcı+şifre → core token endpoint (client_id sabit 'serviceApi') → Bearer.
   *
   * Endpoint'ler resmi dökümandan (developer.turkcellesirket.com):
   *   GET {base}/v1/{inbox|outbox}invoice/list?startDate=&endDate=   → JSON liste
   *   GET {base}/v1/{inbox|outbox}invoice/getUBL?id=                 → UBL XML
   * NOT: Canlı bir mükellef hesabıyla ilk çekimde alan adları (getUBL id parametresi,
   *      liste JSON alanları) teyit edilip gerekiyorsa buradan ayarlanacak.
   */
  private async fetchTurkcellInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
    },
  ): Promise<ProviderInvoicePayload[]> {
    const baseUrl = (cfg.baseUrl || PROVIDER_DEFAULT_BASE_URL.TURKCELL).replace(/\/+$/, '');
    const isTest = /isim360\.com/i.test(baseUrl) && /test/i.test(baseUrl);

    // --- Kimlik başlığı ---
    const authHeaders: Record<string, string> = {};
    if (cfg.apiKey) {
      authHeaders['X-Api-Key'] = cfg.apiKey;
    } else if (cfg.username && cfg.password) {
      const tokenUrl = isTest
        ? 'https://coretest.isim360.com/v1/token'
        : 'https://core.turkcellesirket.com/v1/token';
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: cfg.username,
          password: cfg.password,
          client_id: 'serviceApi',
        }).toString(),
      });
      if (!tokenRes.ok) {
        throw new Error(`Turkcell token alınamadı: ${tokenRes.status} ${(await tokenRes.text()).slice(0, 200)}`);
      }
      const tokenData: any = await tokenRes.json().catch(() => ({}));
      const accessToken = tokenData?.access_token || tokenData?.accessToken;
      if (!accessToken) throw new Error('Turkcell access_token dönmedi (kullanıcı/şifre hatalı olabilir)');
      authHeaders['Authorization'] = `Bearer ${accessToken}`;
    } else {
      throw new Error('Turkcell için API anahtarı (apiKey) veya kullanıcı+şifre gerekli');
    }

    const box = opts.direction === 'ALIS' ? 'inboxinvoice' : 'outboxinvoice';

    // --- Fatura listesi ---
    const listUrl = new URL(`${baseUrl}/v1/${box}/list`);
    listUrl.searchParams.set('startDate', opts.period.startDate);
    listUrl.searchParams.set('endDate', opts.period.endDate);
    const listRes = await fetch(listUrl.toString(), {
      method: 'GET',
      headers: { ...authHeaders, Accept: 'application/json' },
    });
    const listText = await listRes.text();
    if (!listRes.ok) throw new Error(`Turkcell ${box} liste hatası: ${listRes.status} ${listText.slice(0, 250)}`);
    let listJson: any;
    try {
      listJson = JSON.parse(listText);
    } catch {
      throw new Error(`Turkcell liste yanıtı JSON değil: ${listText.slice(0, 200)}`);
    }
    const items: any[] =
      (Array.isArray(listJson) && listJson) ||
      (Array.isArray(listJson?.data) && listJson.data) ||
      (Array.isArray(listJson?.invoices) && listJson.invoices) ||
      (Array.isArray(listJson?.result) && listJson.result) ||
      (Array.isArray(listJson?.items) && listJson.items) ||
      (Array.isArray(listJson?.content) && listJson.content) ||
      [];

    const payloads: ProviderInvoicePayload[] = [];
    for (const item of items) {
      if (payloads.length >= opts.limit) break;
      const id = item?.id ?? item?.uuid ?? item?.invoiceId ?? item?.ettn ?? item?.documentId ?? item?.ettnId;
      if (!id) continue;
      const invoiceNo = String(item?.invoiceNumber || item?.invoiceNo || item?.number || item?.documentNo || id).trim();

      // UBL indir
      const ublUrl = new URL(`${baseUrl}/v1/${box}/getUBL`);
      ublUrl.searchParams.set('id', String(id));
      const ublRes = await fetch(ublUrl.toString(), {
        method: 'GET',
        headers: { ...authHeaders, Accept: 'application/xml, text/xml, application/json, */*' },
      });
      const ublText = await ublRes.text();
      if (!ublRes.ok) {
        this.logger.warn(`Turkcell getUBL ${id} hata ${ublRes.status}: ${ublText.slice(0, 150)}`);
        continue;
      }
      // Yanıt düz UBL XML olabilir ya da {content/ubl/base64} sarmalı gelebilir
      let xml = ublText;
      const trimmed = ublText.trim();
      if (!trimmed.startsWith('<')) {
        try {
          const wrap = JSON.parse(trimmed);
          const inner = wrap?.content ?? wrap?.ubl ?? wrap?.xml ?? wrap?.data ?? wrap?.base64;
          if (inner) {
            const s = String(inner);
            xml = !s.includes('<') && /^[A-Za-z0-9+/=\s]+$/.test(s)
              ? Buffer.from(s, 'base64').toString('utf8')
              : s;
          }
        } catch {
          /* düz metin bırak */
        }
      }
      if (!xml.includes('<')) continue;
      payloads.push({
        externalId: `turkcell:${box}:${id}`,
        originalName: `${invoiceNo || id}.xml`,
        xml,
      });
    }
    return payloads;
  }

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
    // Ofiste TEK Paraşüt uygulaması var → client_id/secret ofis geneli env (PARASUT_CLIENT_ID/SECRET)
    // ÖNCELİKLİ; mükellefe özel eski/yanlış değerler kalmışsa onları GEÇ. Mükellef başına sadece
    // kullanıcı+şifre+Firma No anlamlı.
    const clientId = process.env.PARASUT_CLIENT_ID || (cfg as any).apiKey;
    const clientSecret = process.env.PARASUT_CLIENT_SECRET || (cfg as any).apiSecret;
    if (!cfg.username || !cfg.password || !clientId || !clientSecret) {
      throw new Error('Parasut OAuth2 icin client_id (apiKey) + client_secret (apiSecret) + kullanici + sifre gerekli');
    }
    // Firma No: kullanıcı girdiyse onu kullan; girmediyse token alındıktan sonra /me ile otomatik bulunur.
    let firmaNo = String((cfg as any).accountId || (cfg as any).senderVkn || '').trim();

    const tokenBody = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
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

    // Firma No verilmediyse hesaptan OTOMATİK bul (Mihsap gibi — her mükellefte elle yazmaya gerek yok).
    if (!firmaNo) firmaNo = await this.parasutFirmaNo(baseUrl, accessToken);
    if (!firmaNo) throw new Error('Parasut Firma No otomatik bulunamadı — hesaba bağlı firma yok gibi. Formdan Firma No girin.');

    const path = opts.direction === 'ALIS' ? 'purchase_bills' : 'sales_invoices';
    const include = opts.direction === 'ALIS'
      ? 'spender,pay_to,details,details.product,active_e_document'
      : 'contact,details,details.product,active_e_document';
    const pageSize = 25; // Parasut sayfa üst sınırı
    const scanCap = 60;  // istemci-tarafı süzmede geriye tarama üst sınırı (60×25 = 1500 fatura)
    const start = String(opts.period.startDate || '').slice(0, 10);
    const end = String(opts.period.endDate || '').slice(0, 10);
    const payloads: ProviderInvoicePayload[] = [];
    // Bazı Parasut sürümleri issue_date ARALIK (..) filtresini reddediyor ("'issue_date' is not a date").
    // Önce sunucu-tarafı aralık filtresini dene; reddedilirse filtreyi bırak, sort=-issue_date ile
    // (yeni→eski) çekip İSTEMCİ tarafında [start,end] aralığına göre süz, aralığın gerisine düşünce dur.
    let useDateFilter = true;
    let stop = false;
    for (let page = 1; page <= scanCap && payloads.length < opts.limit && !stop; page++) {
      const params = new URLSearchParams({
        'page[number]': String(page),
        'page[size]': String(pageSize),
        include,
        sort: '-issue_date',
      });
      if (useDateFilter && start && end) params.set('filter[issue_date]', `${start}..${end}`);
      const url = `${baseUrl.replace(/\/+$/, '')}/${firmaNo}/${path}?${params.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        const errTxt = await res.text();
        if (useDateFilter && /issue_date|not a date|invalid|Bad Request/i.test(errTxt)) {
          useDateFilter = false; page--; continue; // aralık filtresiz, istemci-tarafı süzmeye geç
        }
        throw new Error(`Parasut fatura listesi alinamadi: ${res.status} ${errTxt.slice(0, 300)}`);
      }
      const data: any = await res.json();
      const items = Array.isArray(data?.data) ? data.data : [];
      const included = Array.isArray(data?.included) ? data.included : [];
      for (const item of items) {
        if (payloads.length >= opts.limit) break;
        if (!useDateFilter) {
          const d = String(item?.attributes?.issue_date || '').slice(0, 10);
          if (d && start && d < start) { stop = true; break; } // sıralı yeni→eski: aralığın gerisine düştük
          if (d && end && d > end) continue;                    // aralıktan yeni: atla
        }
        payloads.push(this.parasutInvoicePayload(item, included, opts.direction, opts.taxpayer, path));
      }
      if (items.length < pageSize) break;
    }
    return payloads;
  }

  /** Paraşüt hesabındaki firma (company) id'sini /me üzerinden otomatik bulur. */
  private async parasutFirmaNo(baseUrl: string, accessToken: string): Promise<string> {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/me`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      if (!res.ok) return '';
      const j: any = await res.json().catch(() => ({}));
      const rel = j?.data?.relationships || {};
      const cand =
        rel?.company?.data?.id ??
        rel?.companies?.data?.[0]?.id ??
        (Array.isArray(j?.included) ? j.included.find((x: any) => /compan/i.test(String(x?.type)))?.id : undefined) ??
        j?.data?.attributes?.company_id;
      return cand ? String(cand) : '';
    } catch {
      return '';
    }
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

  /**
   * eLogo özel entegratör "posta kutusu" web servisi (postboxservice.svc — WCF SOAP, ns http://tempuri.org/).
   * Gelen (ALIS) faturalar: Login → GetDocumentList (OPTYPE=2, tarih aralığı) → her UUID için
   * GetDocumentData (ZIP içinde UBL) → Logout. EINVOICE aralığı 30 günü aşamaz → ≤30 günlük parçalara böl.
   * Kimlik: web servis kullanıcı KODU (userName, örn 3961368714) + web servis şifresi (passWord). SMS gitmez.
   * Endpoint: canlı pb.elogo.com.tr, test pb-demo.elogo.com.tr (cfg.baseUrl 'demo/test' içeriyorsa test).
   * Şema WSDL'den birebir: LoginType ns=http://schemas.datacontract.org/2004/07/eFaturaWebService,
   *   paramList ns=http://schemas.microsoft.com/2003/10/Serialization/Arrays, OPTYPE 2=Gelen 1=Giden.
   * NOT: İlk gerçek çekimde GetDocumentData binaryData'nın zip/ham olduğu canlı doğrulanacak.
   */
  private async fetchElogoInvoices(
    cfg: RuntimeIntegrationConfig,
    opts: {
      taxpayer: any;
      direction: 'ALIS' | 'SATIS';
      period: { donem: string; startDate: string; endDate: string };
      limit: number;
      channel?: string;
    },
  ): Promise<ProviderInvoicePayload[]> {
    if (!cfg.username || !cfg.password) throw new Error('eLogo web servis kullanıcı adı (kod) ve şifresi gerekli');
    let endpoint = String(cfg.baseUrl || '').trim();
    if (!/postboxservice\.svc/i.test(endpoint)) {
      endpoint = /demo|test/i.test(endpoint)
        ? 'https://pb-demo.elogo.com.tr/postboxservice.svc'
        : 'https://pb.elogo.com.tr/postboxservice.svc';
    }
    const ACT = 'http://tempuri.org/IPostBoxService/';

    // 1) Login → sessionID
    const loginBody =
      `<Login xmlns="http://tempuri.org/">` +
      `<login xmlns:a="http://schemas.datacontract.org/2004/07/eFaturaWebService">` +
      `<a:appStr>MOREN</a:appStr>` +
      `<a:passWord>${this.xmlEscape(cfg.password)}</a:passWord>` +
      `<a:userName>${this.xmlEscape(cfg.username)}</a:userName>` +
      `<a:version>1.0</a:version>` +
      `</login></Login>`;
    const loginResp = await this.soapPost(endpoint, ACT + 'Login', loginBody);
    const sessionID = this.tagText(loginResp, 'sessionID');
    if (!sessionID || !/<(?:\w+:)?LoginResult>\s*true/i.test(loginResp)) {
      throw new Error('eLogo giriş başarısız (kullanıcı adı/şifre): ' + (this.tagText(loginResp, 'faultstring') || 'sessionID alınamadı'));
    }

    try {
      // Kanal: Alış e-Fatura (IN_EFATURA), Satış e-Fatura (OUT_EFATURA), Satış e-Arşiv (OUT_EARSIV).
      const channel = String(opts.channel || (opts.direction === 'SATIS' ? 'OUT_EFATURA' : 'IN_EFATURA')).toUpperCase();
      const isEarsiv = channel === 'OUT_EARSIV';
      const docType = isEarsiv ? 'EARCHIVE' : 'EINVOICE';
      const optype = channel === 'IN_EFATURA' ? '2' : '1'; // 2=Gelen(alış), 1=Giden(satış/e-arşiv)
      // eLogo e-Arşiv sorgusunda BEGINDATE=ENDDATE aynı gün olmalı → gün-gün; e-Fatura ≤30 günlük parçalar.
      const chunks = this.splitDateChunks(opts.period.startDate, opts.period.endDate, isEarsiv ? 1 : 30);
      const payloads: ProviderInvoicePayload[] = [];
      const seen = new Set<string>();
      for (const ch of chunks) {
        if (payloads.length >= opts.limit) break;
        const listParams = [`DOCUMENTTYPE=${docType}`, `OPTYPE=${optype}`, `BEGINDATE=${ch.start}`, `ENDDATE=${ch.end}`, 'DATEBY=1'];
        const listBody =
          `<GetDocumentList xmlns="http://tempuri.org/">` +
          `<sessionID>${this.xmlEscape(sessionID)}</sessionID>` +
          this.elogoParamList(listParams) +
          `</GetDocumentList>`;
        const listResp = await this.soapPost(endpoint, ACT + 'GetDocumentList', listBody);
        const uuids = (listResp.match(/<(?:\w+:)?documentUuid>([^<]+)<\/(?:\w+:)?documentUuid>/gi) || [])
          .map((m) => m.replace(/<[^>]+>/g, '').trim())
          .filter(Boolean);
        // GEÇİCİ TEŞHİS (limit===777): 0 uuid dönerse ham yanıtı hataya koy → gerçek tag/yapı görülür.
        if (uuids.length === 0 && opts.limit === 777) {
          throw new Error(`ELOGO_DBG ${channel} ${docType} OPT=${optype} ${ch.start}..${ch.end} len=${listResp.length} :: ${listResp.replace(/\s+/g, ' ').slice(0, 900)}`);
        }
        for (const uuid of uuids) {
          if (payloads.length >= opts.limit) break;
          if (seen.has(uuid)) continue;
          seen.add(uuid);
          let xml: string | null = null;
          try {
            const dataBody =
              `<GetDocumentData xmlns="http://tempuri.org/">` +
              `<sessionID>${this.xmlEscape(sessionID)}</sessionID>` +
              `<uuid>${this.xmlEscape(uuid)}</uuid>` +
              this.elogoParamList([`DOCUMENTTYPE=${docType}`]) +
              `</GetDocumentData>`;
            const dataResp = await this.soapPost(endpoint, ACT + 'GetDocumentData', dataBody);
            const b64 = this.tagText(dataResp, 'binaryData');
            if (b64) xml = await this.elogoUnzipXml(Buffer.from(b64, 'base64'));
          } catch (e: any) {
            this.logger.warn(`eLogo GetDocumentData ${uuid} hata: ${e?.message}`);
          }
          if (!xml || !xml.includes('<')) continue;
          payloads.push({ externalId: `elogo:${uuid}`, originalName: `${uuid}.xml`, xml });
        }
      }
      return payloads;
    } finally {
      try {
        await this.soapPost(endpoint, ACT + 'Logout', `<Logout xmlns="http://tempuri.org/"><sessionID>${this.xmlEscape(sessionID)}</sessionID></Logout>`);
      } catch { /* logout best-effort */ }
    }
  }

  private elogoParamList(params: string[]): string {
    const items = params.map((p) => `<b:string>${this.xmlEscape(p)}</b:string>`).join('');
    return `<paramList xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${items}</paramList>`;
  }

  /** base64 çözülmüş buffer'ı zip ise açıp ilk XML'i, değilse ham metni döndürür. */
  private async elogoUnzipXml(buf: Buffer): Promise<string | null> {
    try {
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      const xmlName = names.find((n) => /\.xml$/i.test(n)) || names[0];
      if (xmlName) {
        const txt = await zip.files[xmlName].async('string');
        if (txt && txt.includes('<')) return txt;
      }
    } catch { /* zip değil → ham metin dene */ }
    const asText = buf.toString('utf8');
    return asText.includes('<') ? asText : null;
  }

  /** Tarih aralığını ≤maxDays günlük parçalara böler (eLogo EINVOICE 30 gün sınırı). */
  private splitDateChunks(startDate: string, endDate: string, maxDays: number): Array<{ start: string; end: string }> {
    const s = String(startDate || '').slice(0, 10);
    const e = String(endDate || '').slice(0, 10);
    const start = new Date(`${s}T00:00:00.000Z`);
    const end = new Date(`${e}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return [{ start: s || e, end: e || s }];
    }
    const out: Array<{ start: string; end: string }> = [];
    let cur = new Date(start.getTime());
    while (cur <= end) {
      const chunkEnd = new Date(cur.getTime());
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + (maxDays - 1));
      const realEnd = chunkEnd > end ? end : chunkEnd;
      out.push({ start: cur.toISOString().slice(0, 10), end: realEnd.toISOString().slice(0, 10) });
      cur = new Date(realEnd.getTime());
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
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
    // Timeout: sağlayıcı bağlantıyı açık tutup yanıt vermezse istek süresiz asılı kalıyordu.
    const res = await fetch(url, { method: 'POST', headers, body: envelope, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`SOAP ${res.status}: ${text.slice(0, 400)}`);
    if (/<(?:[^:>]+:)?Fault\b/i.test(text)) throw new Error(this.tagText(text, 'faultstring') || 'SOAP Fault');
    // GÖVDE-İÇİ hata: Uyumsoft HTTP 200 dönüp IsSucceded="false" yazabiliyor — eskiden bu sessizce
    //   "SUCCESS, 0 fatura" oluyordu (bayat oturum / yanlış şifre "bu ay fatura yok" gibi görünüyordu).
    const suc = text.match(/IsSucceded\s*=\s*["'](true|false)["']/i);
    if (suc && suc[1].toLowerCase() === 'false') {
      const msg = text.match(/Message\s*=\s*["']([^"']{1,300})["']/i)?.[1] || this.tagText(text, 'Message') || 'saglayici islemi basarisiz (IsSucceded=false)';
      throw new Error(`Saglayici hatasi: ${msg}`);
    }
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
    const htmlContent = /<(?:!doctype\s+html|html|body)\b/i.test(raw.slice(0, 2000)) ? raw : null;
    const xmlDocs = this.extractXmlDocuments(raw);
    if (xmlDocs.length) {
      xmlDocs.forEach((xml) => payloads.push({
        xml,
        externalId: this.tagText(xml, 'UUID') || this.tagText(xml, 'ID') || null,
        originalName: `${this.tagText(xml, 'ID') || this.tagText(xml, 'UUID') || randomUUID()}.xml`,
        htmlContent,
      }));
      return;
    }
    for (const match of raw.matchAll(/[A-Za-z0-9+/]{240,}={0,2}/g)) {
      const compactCandidate = match[0].replace(/\s+/g, '');
      if (!this.looksLikeBase64(compactCandidate)) continue;
      await this.addPayloadBuffer(payloads, Buffer.from(compactCandidate, 'base64'));
      if (payloads.length) return;
    }
    const compact = raw.replace(/\s+/g, '');
    if (!this.looksLikeBase64(compact)) return;
    await this.addPayloadBuffer(payloads, Buffer.from(compact, 'base64'));
  }

  private async addPayloadBuffer(payloads: ProviderInvoicePayload[], buffer: Buffer) {
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.values(zip.files).filter((file) => !file.dir);
      let visualPdf: Buffer | null = null;
      let visualHtml: string | null = null;
      const attachVisual = (fromIndex: number) => {
        for (const payload of payloads.slice(fromIndex)) {
          if (!payload.pdfBuffer && visualPdf) payload.pdfBuffer = visualPdf;
          if (!payload.htmlContent && visualHtml) payload.htmlContent = visualHtml;
        }
      };
      for (const file of files) {
        const name = file.name || '';
        const nested = Buffer.from(await file.async('uint8array'));
        if (!visualPdf && (/\.pdf$/i.test(name) || (nested.length >= 4 && nested[0] === 0x25 && nested[1] === 0x50 && nested[2] === 0x44 && nested[3] === 0x46))) {
          visualPdf = nested;
        }
        if (!visualHtml && /\.(html?|xhtml)$/i.test(name)) {
          const html = nested.toString('utf8').trim();
          if (/<(?:!doctype\s+html|html|body)\b/i.test(html.slice(0, 2000))) visualHtml = html;
        }
        if (nested.length >= 4 && nested[0] === 0x50 && nested[1] === 0x4b) {
          const before = payloads.length;
          await this.addPayloadBuffer(payloads, nested);
          attachVisual(before);
          continue;
        }
        const content = this.decodeXmlEntities(nested.toString('utf8'));
        if (!visualHtml && /<(?:!doctype\s+html|html|body)\b/i.test(content.slice(0, 2000))) {
          visualHtml = content.trim();
        }
        const xmlDocs = this.extractXmlDocuments(content);
        if (!xmlDocs.length) {
          const before = payloads.length;
          await this.addPayloadString(payloads, content);
          attachVisual(before);
          continue;
        }
        for (const doc of xmlDocs) {
          payloads.push({
            xml: doc,
            externalId: this.tagText(doc, 'UUID') || this.tagText(doc, 'ID') || null,
            originalName: name.split('/').pop() || `${randomUUID()}.xml`,
            pdfBuffer: visualPdf,
            htmlContent: visualHtml,
          });
        }
      }
      attachVisual(0);
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
    // Etiket adı '<' ya da namespace ön-ekinden (':') HEMEN sonra gelmeli. Eski [^:>]* deseni araya harf
    //   girmesine izin verdiği için 'ID' araması UBLVersionID/CustomizationID/ProfileID ile eşleşip belge
    //   no'yu yanlış okuyordu. Artık yalnız <ID> veya <ns:ID> eşleşir.
    const re = new RegExp(`<(?:[a-zA-Z][\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z][\\w.-]*:)?${tag}>`, 'i');
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

  private safeInvoiceFileStem(value: any) {
    const stem = String(value || randomUUID()).trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return stem || randomUUID();
  }

  private providerStoredVisual(payload: ProviderInvoicePayload): ProviderStoredVisual | null {
    const pdf = payload.pdfBuffer && Buffer.isBuffer(payload.pdfBuffer) ? payload.pdfBuffer : null;
    if (pdf?.length && pdf.length <= 6_000_000) {
      return {
        mimeType: 'application/pdf',
        originalName: payload.originalName || null,
        base64: pdf.toString('base64'),
      };
    }
    const html = String(payload.htmlContent || '').trim();
    if (html && /<(?:!doctype\s+html|html|body)\b/i.test(html.slice(0, 2000)) && Buffer.byteLength(html, 'utf8') <= 2_500_000) {
      return {
        mimeType: 'text/html',
        originalName: payload.originalName || null,
        html,
      };
    }
    return null;
  }

  private isFakeTurmobVisualHtml(html: any): boolean {
    return /TURMOB liste verisiyle|Orijinal belge goruntusu indirilemedi|Fatura satiri/i.test(String(html || ''));
  }

  private hasOriginalProviderVisual(visual: any, provider?: string): boolean {
    if (!visual || typeof visual !== 'object') return false;
    const mimeType = String(visual.mimeType || '');
    if (/pdf/i.test(mimeType) && Boolean(visual.base64)) return true;
    const html = String(visual.html || '');
    if (/html/i.test(mimeType) && html) {
      return String(provider || '').toUpperCase() !== 'TURMOB_EFATURA' || !this.isFakeTurmobVisualHtml(html);
    }
    return false;
  }

  private providerPayloadFromStoredVisual(
    xml: string,
    externalId?: string | null,
    faturaNo?: string | null,
    visual?: ProviderStoredVisual | null,
  ): ProviderInvoicePayload {
    const payload: ProviderInvoicePayload = {
      xml,
      externalId: externalId || null,
      originalName: `${faturaNo || externalId || randomUUID()}.xml`,
    };
    if (!visual || typeof visual !== 'object') return payload;
    if (/pdf/i.test(String(visual.mimeType || '')) && visual.base64) {
      try {
        const pdfBuffer = Buffer.from(String(visual.base64), 'base64');
        if (pdfBuffer.length) {
          payload.pdfBuffer = pdfBuffer;
          payload.originalName = visual.originalName || `${faturaNo || externalId || randomUUID()}.pdf`;
        }
      } catch {
        // Invalid stored visual; keep XML fallback.
      }
    } else if (/html/i.test(String(visual.mimeType || '')) && visual.html) {
      payload.htmlContent = String(visual.html);
      payload.originalName = visual.originalName || `${faturaNo || externalId || randomUUID()}.html`;
    }
    return payload;
  }

  private async buildProviderDocumentStorage(
    tenantId: string,
    taxpayerId: string,
    cfg: RuntimeIntegrationConfig,
    xml: string,
    payload: ProviderInvoicePayload,
    parsed: ParsedProviderInvoice,
    source: string,
    sourceRefId: string,
  ) {
    const xmlBuffer = Buffer.from(xml, 'utf8');
    const stem = this.safeInvoiceFileStem(parsed.faturaNo || sourceRefId);
    const html = String(payload.htmlContent || '').trim();
    const pdf = payload.pdfBuffer && Buffer.isBuffer(payload.pdfBuffer) && payload.pdfBuffer.length
      ? payload.pdfBuffer
      : null;
    const hasHtml = html && /<(?:!doctype\s+html|html|body)\b/i.test(html.slice(0, 2000));
    const hasOriginalHtml = !!hasHtml && !(cfg.provider === 'TURMOB_EFATURA' && this.isFakeTurmobVisualHtml(html));

    // GÖRSEL ZORUNLU DEĞİL: TÜRMOB e-Fatura'da görsel inmese de SAĞLAM UBL XML varsa belge XML'den
    //   saklanır (aşağıdaki XML-only yolu). Veri+okuma+yön XML'den gelir; önizleme XML'den render edilir.
    //   (Eskiden görsel yoksa fırlatıyordu → çok-kalemli faturalar — TORA PETROL 372KB — MISSING kalıyordu.)
    //   Sentetik XML zaten üst akışta (savedXmlLooksSynthetic) elendiği için burada xml gerçektir.
    if (pdf || hasOriginalHtml) {
      const zip = new JSZip();
      zip.file('invoice.xml', xmlBuffer);
      if (pdf) zip.file('original.pdf', pdf);
      if (hasOriginalHtml) zip.file('original.html', html);
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const s3Key = `invoice-accounting/${tenantId}/${taxpayerId}/${cfg.provider.toLowerCase()}-${randomUUID()}.zip`;
      await this.storage.putBuffer(s3Key, buffer, 'application/zip', {
        'tenant-id': tenantId,
        'taxpayer-id': taxpayerId,
        provider: cfg.provider,
        source,
      });
      return {
        buffer,
        s3Key,
        mimeType: 'application/zip',
        originalName: `${stem}.zip`,
      };
    }

    const s3Key = `invoice-accounting/${tenantId}/${taxpayerId}/${cfg.provider.toLowerCase()}-${randomUUID()}.xml`;
    await this.storage.putBuffer(s3Key, xmlBuffer, 'application/xml', {
      'tenant-id': tenantId,
      'taxpayer-id': taxpayerId,
      provider: cfg.provider,
      source,
    });
    return {
      buffer: xmlBuffer,
      s3Key,
      mimeType: 'application/xml',
      originalName: payload.originalName || `${stem}.xml`,
    };
  }

  private missingOriginalInvoiceHtml(parsed: ParsedProviderInvoice): string {
    const invoiceNo = this.xmlEscape(parsed.faturaNo || 'Belge');
    const date = parsed.faturaTarihi && !Number.isNaN(parsed.faturaTarihi.getTime())
      ? parsed.faturaTarihi.toISOString().slice(0, 10)
      : '';
    const total = parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0));
    const totalText = Number(total || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <style>
    body{margin:0;background:#fff;color:#172033;font-family:Arial,sans-serif}
    .wrap{max-width:760px;margin:72px auto;padding:32px;border:1px solid #d9e2ec;border-radius:14px}
    h1{font-size:22px;margin:0 0 12px}
    p{font-size:15px;line-height:1.55;color:#536174;margin:0 0 18px}
    dl{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin:0;font-size:14px}
    dt{color:#7a8798}dd{margin:0;font-weight:700}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Orijinal belge goruntusu indirilemedi</h1>
    <p>TURMOB liste verisiyle muhasebe bilgileri olusturuldu; ancak orijinal PDF/HTML/XML goruntusu entegratorden indirilemedi. Bu ekranda uydurma fatura goruntusu gosterilmez.</p>
    <dl>
      <dt>Belge no</dt><dd>${invoiceNo}</dd>
      <dt>Tarih</dt><dd>${this.xmlEscape(date || '-')}</dd>
      <dt>Toplam</dt><dd>${this.xmlEscape(totalText)} TL</dd>
    </dl>
  </div>
</body>
</html>`;
  }

  private async refreshProviderDocumentVisual(
    tenantId: string,
    documentId: string,
    taxpayer: any,
    cfg: RuntimeIntegrationConfig,
    payload: ProviderInvoicePayload,
  ) {
    if (!payload.pdfBuffer && !payload.htmlContent) return;
    let xml = String(payload.xml || '').trim();
    const docs = this.extractXmlDocuments(this.decodeXmlEntities(xml));
    if (docs.length) xml = docs[0];
    if (!xml) return;
    const parsed = this.parseProviderUblInvoice(xml) || this.regexProviderInvoiceFallback(xml);
    if (!parsed) return;
    const source = cfg.provider === 'GIB_PORTAL' ? 'gib-portal-api' : `integration-${cfg.provider.toLowerCase()}`;
    const sourceRefId = payload.externalId || parsed.ettn || parsed.faturaNo || createHash('sha1').update(xml).digest('hex');
    const stored = await this.buildProviderDocumentStorage(tenantId, taxpayer.id, cfg, xml, payload, parsed, source, sourceRefId);
    const current = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { id: documentId, tenantId, taxpayerId: taxpayer.id },
      select: { s3Key: true, source: true },
    });
    if (!current) return;
    await (this.prisma as any).invoiceAccountingDocument.update({
      where: { id: documentId },
      data: {
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.buffer.length,
        s3Key: stored.s3Key,
      },
    });
    if (current.s3Key && current.s3Key !== stored.s3Key && !String(current.s3Key).startsWith('earsiv-inline://')) {
      this.storage.deleteObject(current.s3Key).catch(() => {});
    }
  }

  private async createDocumentFromProviderXml(
    tenantId: string,
    userId: string | undefined,
    taxpayer: any,
    cfg: RuntimeIntegrationConfig,
    direction: 'ALIS' | 'SATIS',
    payload: ProviderInvoicePayload,
    opts: { existingDocumentId?: string } = {},
  ) {
    let xml = String(payload.xml || '').trim();
    const unpacked: ProviderInvoicePayload[] = [];
    const rawBuffer = Buffer.from(xml, 'utf8');
    if (rawBuffer.length >= 4 && rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b) {
      await this.addPayloadBuffer(unpacked, rawBuffer);
    } else {
      const docs = this.extractXmlDocuments(this.decodeXmlEntities(xml));
      if (docs.length) xml = docs[0];
    }
    if (!this.extractXmlDocuments(this.decodeXmlEntities(xml)).length && unpacked[0]?.xml) {
      xml = unpacked[0].xml;
    }
    if (!/<(?:\?xml|[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)\b/i.test(xml)) {
      throw new Error('UBL/XML fatura bulunamadi');
    }
    const parsed = this.parseProviderUblInvoice(xml) || this.regexProviderInvoiceFallback(xml);
    if (!parsed) throw new Error('UBL/XML fatura okunamadi');
    // CARİ YÖN DÜZELTME: ALIŞ faturasında SATICI (cari) MÜKELLEF OLAMAZ. Bazı XML'lerde satıcı/alıcı
    //   tarafları ters geliyor → parse mükellefi satıcı sanıp cari=mükellef yapıyor ("Yorgun Nakliyat"
    //   cari, hesap boş). Mükellef satıcı tarafına düşmüşse GERÇEK satıcı = alıcı tarafındaki firmadır →
    //   çevir. SATIŞ'ta satıcı=mükellef DOĞRU olduğu için yalnız ALIŞ'ta uygulanır. Satıcısı zaten
    //   mükellef olmayan (TÜVTÜRK/Çetaş gibi) doğru faturalar ETKİLENMEZ.
    {
      const ownVkn = String((taxpayer as any)?.taxNumber || '').replace(/\D/g, '');
      if (ownVkn && direction === 'ALIS') {
        const sVkn = String(parsed.saticiVergiNo || '').replace(/\D/g, '');
        const aVkn = String(parsed.aliciVergiNo || '').replace(/\D/g, '');
        if (sVkn && sVkn === ownVkn && (aVkn ? aVkn !== ownVkn : !!parsed.alici)) {
          const ts = parsed.satici, tsv = parsed.saticiVergiNo;
          parsed.satici = parsed.alici; parsed.saticiVergiNo = parsed.aliciVergiNo;
          parsed.alici = ts; parsed.aliciVergiNo = tsv;
          this.logger.warn(`[CARI-DUZELT] ALIS'ta satici=mukellef idi, ters cevrildi → cari=${parsed.satici} (${parsed.saticiVergiNo}) belge=${parsed.faturaNo}`);
        }
      }
    }
    const source = cfg.provider === 'GIB_PORTAL' ? 'gib-portal-api' : `integration-${cfg.provider.toLowerCase()}`;
    const sourceRefId = payload.externalId || parsed.ettn || parsed.faturaNo || createHash('sha1').update(xml).digest('hex');
    const existing = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: opts.existingDocumentId
        ? { id: opts.existingDocumentId, tenantId, taxpayerId: taxpayer.id }
        : { tenantId, taxpayerId: taxpayer.id, source, sourceRefId },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    if (existing) {
      const stored = await this.buildProviderDocumentStorage(tenantId, taxpayer.id, cfg, xml, {
        ...payload,
        xml,
        externalId: sourceRefId,
      }, parsed, source, sourceRefId);
      const total = parsed.toplamTutar ?? ((parsed.matrah || 0) + (parsed.kdvTutari || 0));
      const shouldRewriteAccounting = String(existing.status || '').toUpperCase() !== 'APPROVED';
      const lines = shouldRewriteAccounting
        ? await this.gateCodesByPlan(tenantId, taxpayer.id, this.linesFromAmounts({
          invoiceKind: direction,
          matrah: parsed.matrah,
          kdvTutari: parsed.kdvTutari,
          kdvOrani: parsed.kdvOrani,
          // ÇOK-ORANLI KIRILIM: parser %20+%10 ayrı çıkarıyor; geçirilmezse tek harmanlanmış "%18"
          //   sahte satırına çöküyordu (MHD MÜHENDİSLİK vakası). Her oran AYRI matrah+KDV satırı olur.
          kdvBreakdown: Array.isArray(parsed.kdvBreakdown) ? parsed.kdvBreakdown : undefined,
          total,
          vendorName: direction === 'SATIS' ? parsed.alici : parsed.satici,
        }))
        : [];

      const updated = await (this.prisma as any).$transaction(async (tx: any) => {
        if (shouldRewriteAccounting) {
          await tx.invoiceAccountingLine.deleteMany({ where: { documentId: existing.id } });
          if (lines.length) {
            await tx.invoiceAccountingLine.createMany({
              data: lines.map((line: any, index: number) => ({
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
        return tx.invoiceAccountingDocument.update({
          where: { id: existing.id },
          data: {
            source,
            sourceRefId,
            documentType: this.documentTypeFromProviderXml(xml),
            invoiceKind: direction,
            originalName: stored.originalName,
            mimeType: stored.mimeType,
            sizeBytes: stored.buffer.length,
            s3Key: stored.s3Key,
            ...(shouldRewriteAccounting ? {
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
                // Çok-oranlı kırılım ocrData'ya da yazılır (ekran + doğrulama + "Kodları düzelt" bunu okur).
                kdvBreakdown: Array.isArray(parsed.kdvBreakdown) ? parsed.kdvBreakdown.map((b: any) => ({ oran: b.rate, matrah: b.base, tutar: b.amount })) : undefined,
                ettn: parsed.ettn,
                // Kalemler → DEMİRBAŞ tespiti (detectFixedAsset) içeriği görsün; demirbaş alış/satışı
                //   FIXED_ASSET_MANUAL ile INVALID → Luca'ya aktarılmaz, "manuel işle" uyarısı kalır.
                kalemler: Array.isArray(parsed.kalemler) ? parsed.kalemler.slice(0, 30).map((k: any) => ({ ad: String(k?.ad || '').slice(0, 80), tutar: Number(k?.tutar) || 0, oran: Number(k?.oran) || 0 })).filter((k: any) => k.ad) : undefined,
              },
            } : {}),
          },
          include: { lines: { orderBy: { orderNo: 'asc' } } },
        });
      });
      if (existing.s3Key && existing.s3Key !== stored.s3Key && !String(existing.s3Key).startsWith('earsiv-inline://')) {
        this.storage.deleteObject(existing.s3Key).catch(() => {});
      }
      if (shouldRewriteAccounting) {
        // Oto-eşleştirme (KDV/cari/gider) + doğrulama — aktarılmış belge yenilenince de kodlansın.
        await this.rematchDocumentsWithLatestAccountPlan(tenantId, taxpayer.id, [updated.id]).catch(() => null);
        await this.revalidateDocument(tenantId, updated.id).catch(() => null);
      }
      return { created: false, document: updated, refreshed: true };
    }

    const stored = await this.buildProviderDocumentStorage(tenantId, taxpayer.id, cfg, xml, payload, parsed, source, sourceRefId);

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
      // ÇOK-ORANLI KIRILIM (bkz. yukarıdaki mevcut-belge dalı): tek sahte "%18"e çökmesin.
      kdvBreakdown: Array.isArray(parsed.kdvBreakdown) ? parsed.kdvBreakdown : undefined,
      total,
      vendorName: direction === 'SATIS' ? parsed.alici : parsed.satici,
    }));

    const doc = await (this.prisma as any).invoiceAccountingDocument.create({
      data: {
        tenantId,
        taxpayerId: taxpayer.id,
        source,
        sourceRefId,
        documentType: this.documentTypeFromProviderXml(xml),
        invoiceKind: direction,
        status: duplicate ? 'NEEDS_REVIEW' : 'READY',
        duplicateOfId: duplicate?.duplicateOfId || null,
        duplicateReason: duplicate?.duplicateReason || null,
        duplicateSeverity: duplicate?.duplicateSeverity || null,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.buffer.length,
        s3Key: stored.s3Key,
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
          kdvBreakdown: Array.isArray(parsed.kdvBreakdown) ? parsed.kdvBreakdown.map((b: any) => ({ oran: b.rate, matrah: b.base, tutar: b.amount })) : undefined,
          ettn: parsed.ettn,
          // Kalemler → DEMİRBAŞ tespiti (detectFixedAsset) için; demirbaş alış/satışı FIXED_ASSET_MANUAL
          //   ile INVALID olur → Luca'ya aktarılmaz, "Luca sabit kıymet modülünden işle" uyarısı kalır.
          kalemler: Array.isArray(parsed.kalemler) ? parsed.kalemler.slice(0, 30).map((k: any) => ({ ad: String(k?.ad || '').slice(0, 80), tutar: Number(k?.tutar) || 0, oran: Number(k?.oran) || 0 })).filter((k: any) => k.ad) : undefined,
        },
        createdBy: userId || null,
        lines: { create: lines },
      },
      include: { lines: { orderBy: { orderNo: 'asc' } } },
    });
    // OTOMATİK EŞLEŞTİRME: entegratör belgesi oluşur oluşmaz hesap kodlarını ATA — KDV 191/391
    //   (orana göre, deterministik), cari (VKN→320 öğrenilmiş/plan), gider (plan/kural). Kullanıcı:
    //   "XML fatura eşleştirmeyi otomatik çalıştırmadı". Önce kodla, SONRA doğrula (demirbaş/denge).
    if (taxpayer?.id) await this.rematchDocumentsWithLatestAccountPlan(tenantId, taxpayer.id, [doc.id]).catch(() => {});
    // DEMİRBAŞ + sahiplik/denge doğrulaması: demirbaş alış/satışı INVALID → otomatik aktarım engellenir,
    //   "Luca sabit kıymet modülünden işle" uyarısı kalır. (Provider-XML belgede de validation çalışsın.)
    await this.revalidateDocument(tenantId, doc.id).catch(() => {});
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
      // Belge no = HAM XML'deki ILK <cbc:ID> (fatura no; ProfileID/party-ID degil). Parser sayisal/uzun
      //   ID'yi number'a cevirip "NaN"/bilimsel-gosterime bozabiliyor (ANPA/MENGERLER "NaN" idi) → regex
      //   ile aynen string al; parser sonucu yedek. "NaN"/bos asla yazilmaz.
      const faturaNoRegex = xml.match(/<(?:cbc:)?ID>\s*([^<]+?)\s*<\/(?:cbc:)?ID>/i)?.[1];
      const faturaNoRaw = (faturaNoRegex || txt(get(['ID'])) || '').trim();
      const faturaNo = /^nan$/i.test(faturaNoRaw) ? '' : faturaNoRaw;
      const ettn = txt(get(['UUID']));
      const issueDateRaw = txt(get(['IssueDate']));
      const issueDate = issueDateRaw ? new Date(issueDateRaw) : null;
      const supplier = get(['AccountingSupplierParty', 'Party']);
      const customer = get(['AccountingCustomerParty', 'Party']);
      const monetaryTotal = get(['LegalMonetaryTotal']) || get(['RequestedMonetaryTotal']) || {};
      const taxTotalRaw = get(['TaxTotal']);
      const taxTotals = asArray(taxTotalRaw);
      // TEVKİFAT: belge düzeyi cac:WithholdingTaxTotal/TaxAmount = tevkif edilen (alıkonan) KDV. Satışta
      //   391'e NET KDV (hesaplanan − tevkifat) gider; bu tutar çıkarılmazsa tevkifatlı fatura "tevkifat
      //   tutarı okunamadı, KDV TAM görünüyor" çelişkisi veriyordu (TEVKIFAT_NET_NEEDED). Birden çok varsa toplanır.
      const tevkifatKdvUbl = asArray(get(['WithholdingTaxTotal']))
        .map((w: any) => num(w?.TaxAmount))
        .filter((x: any): x is number => x != null && x > 0)
        .reduce((s: number, x: number) => s + x, 0);
      const taxAmounts = taxTotals
        .map((taxTotal) => num(taxTotal?.TaxAmount))
        .filter((amount): amount is number => amount != null);
      const lineNodes = [...asArray(get(['InvoiceLine'])), ...asArray(get(['CreditNoteLine']))];
      const lineMatrah = lineNodes
        .map((line) => num(line?.LineExtensionAmount))
        .filter((amount): amount is number => amount != null)
        .reduce((sum, amount) => sum + amount, 0);
      const lineTax = lineNodes
        .flatMap((line) => asArray(line?.TaxTotal))
        .map((taxTotal) => num(taxTotal?.TaxAmount))
        .filter((amount): amount is number => amount != null)
        .reduce((sum, amount) => sum + amount, 0);
      let matrah = num(monetaryTotal?.TaxExclusiveAmount)
        ?? num(monetaryTotal?.LineExtensionAmount)
        ?? (lineMatrah || undefined);
      let kdvTutari = (taxAmounts.length ? taxAmounts.reduce((sum, amount) => sum + amount, 0) : undefined)
        ?? (lineTax || undefined);
      const toplamTutar = num(monetaryTotal?.PayableAmount)
        ?? num(monetaryTotal?.TaxInclusiveAmount)
        ?? ((matrah != null || kdvTutari != null) ? (matrah || 0) + (kdvTutari || 0) : undefined);
      // UBL satır kalemleri: ad (Item/Name veya Description) + tutar + KDV oranı.
      // preParsed.kalemler olarak aktarılır → sınıflandırma AI'ı tekrar çıkarmak zorunda kalmaz.
      const rawKalemler = lineNodes
        .map((line) => {
          const ad = String(txt(line?.Item?.Name) || txt(line?.Item?.Description) || '').trim();
          const tutar = num(line?.LineExtensionAmount);
          const lineSubs = asArray(asArray(line?.TaxTotal)[0]?.TaxSubtotal || line?.TaxTotal);
          const oran = num(lineSubs[0]?.TaxCategory?.Percent) ?? num(lineSubs[0]?.Percent);
          return ad && tutar != null ? { ad, tutar, oran: oran ?? 0 } : null;
        })
        .filter((k): k is { ad: string; tutar: number; oran: number } => k !== null);
      // ÇOK-ORANLI KDV KIRILIMI: belge TaxTotal/TaxSubtotal'larını orana göre topla (UBL standardı:
      //   her TaxSubtotal = bir oran; TaxableAmount=matrah, TaxAmount=KDV, Percent=oran). Karma %10/%20
      //   faturada bu olmazsa tek harmanlanmış orana (5245/29825≈%18 SAHTE) düşüyordu.
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const taxSubs = taxTotals.flatMap((tt) => asArray(tt?.TaxSubtotal));
      // VERGİ TÜRÜ SÜZGECİ: TaxSubtotal ÖİV (4080) / ÖTV (0071/9077) da içerebilir — tür bakılmadan
      //   hepsi KDV sanılınca matrah ÇİFT sayılıyor, ÖİV/ÖTV 191'e (İndirilecek KDV) karışıyordu
      //   (telekom: KDV %20 + ÖİV %10, aynı matrah iki oranda). Tür bilgisi varsa yalnız 0015/KDV
      //   kırılıma girer; KDV-dışı vergiler aşağıda GİDERE (en büyük matrah kırılımına) eklenir
      //   (indirilemeyen vergi maliyet/gider unsurudur) → toplam ve cari doğru kalır.
      const isKdvSub = (sub: any): boolean => {
        const scheme: any = sub?.TaxCategory?.TaxScheme || sub?.TaxScheme || null;
        // ⚠️ XMLParser sayısal metni Number'a çevirir: "0015" → 15. Kod başındaki sıfırlar atılarak
        //   karşılaştırılır — `code === '0015'` şartı bu yüzden TÜM KDV'leri vergi-dışı sayıp KDV=0
        //   okutmuştu (Gökhan Akgöz satışları). Mantık tersine kuruldu: yalnız POZİTİF tanınan
        //   KDV-DIŞI vergiler (ÖİV/ÖTV/damga/konaklama/BSMV) hariç tutulur, gerisi KDV sayılır.
        const codeNorm = String(txt(scheme?.TaxTypeCode) ?? '').trim().replace(/^0+/, '');
        const nameFold = String(txt(scheme?.Name) || '').toLowerCase()
          .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
        if (codeNorm === '15') return true; // 0015 = Gerçek usulde KDV
        if (/kdv|katma\s*deger/.test(nameFold)) return true;
        const NON_KDV_CODES = new Set(['4080', '4081', '71', '73', '74', '75', '76', '77', '9077', '59']);
        if (codeNorm && NON_KDV_CODES.has(codeNorm)) return false;
        if (/ozel iletisim|ozel tuketim|damga verg|konaklama verg|banka ve sigorta|\bbsmv\b/.test(nameFold)) return false;
        return true; // tanınmayan/eksik tür → KDV say (güvenli varsayılan)
      };
      let otherTaxTotal = 0;
      const subMap = new Map<number, { base: number; amount: number }>();
      for (const sub of taxSubs) {
        if (!isKdvSub(sub)) { otherTaxTotal += num(sub?.TaxAmount) || 0; continue; }
        const r = num(sub?.TaxCategory?.Percent) ?? num(sub?.Percent);
        if (r == null) continue;
        const key = Math.round(r);
        const cur = subMap.get(key) || { base: 0, amount: 0 };
        const b = num(sub?.TaxableAmount); const a = num(sub?.TaxAmount);
        if (b != null) cur.base += b;
        if (a != null) cur.amount += a;
        subMap.set(key, cur);
      }
      let kdvBreakdown = [...subMap.entries()]
        .filter(([, v]) => v.base > 0 || v.amount > 0)
        .map(([rate, v]) => ({ rate, base: round2(v.base), amount: round2(v.amount) }));
      // Belge TaxSubtotal tek-oran döndü ama KALEMLERDE birden çok oran var → kalemleri oran-bazlı topla
      //   (çok-oranlı faturanın tek harmanlanmış orana düşmesini kesin engeller). amount = base×oran/100.
      const kalemRates = new Set(rawKalemler.map((k) => Math.round(Number(k.oran) || 0)).filter((r) => r > 0));
      if (kdvBreakdown.length < 2 && kalemRates.size >= 2) {
        const km = new Map<number, number>();
        for (const k of rawKalemler) { const r = Math.round(Number(k.oran) || 0); if (r <= 0) continue; km.set(r, (km.get(r) || 0) + (Number(k.tutar) || 0)); }
        kdvBreakdown = [...km.entries()].map(([rate, base]) => ({ rate, base: round2(base), amount: round2(base * rate / 100) }));
      }
      // KDV-dışı vergi (ÖİV/ÖTV) varsa: KDV tutarı yalnız KDV kırılımından; ÖİV/ÖTV gidere eklenir
      //   (en büyük matrah kırılımına, kırılım yoksa matraha) → toplam (matrah'+KDV) belge toplamıyla tutar.
      if (otherTaxTotal > 0) {
        const kdvOnly = [...subMap.values()].reduce((s, v) => s + v.amount, 0);
        kdvTutari = kdvOnly > 0 ? round2(kdvOnly) : undefined;
        if (kdvBreakdown.length) {
          const mx = kdvBreakdown.reduce((a, b) => (b.base > a.base ? b : a));
          mx.base = round2(mx.base + otherTaxTotal);
        } else if (matrah != null) {
          matrah = round2(matrah + otherTaxTotal);
        }
      }
      // ŞAHIS taraf: ünvan PartyName/PartyLegalEntity'de değil <cac:Person> (Ad+Soyad) altında —
      //   TCKN'li müşterilerde alıcı adı boş kalıp listede "—" görünüyordu (Yorgun Nakliyat 10 satış;
      //   earsiv-zip-parser'daki personAdi yedeğinin buradaki karşılığı).
      const kisiAdi = (party: any): string | null => {
        const p = party?.Person;
        if (!p) return null;
        const parcalar = [txt(p.Title), txt(p.FirstName), txt(p.MiddleName), txt(p.FamilyName)].filter((x: any) => x && String(x).trim());
        return parcalar.length ? parcalar.join(' ').replace(/\s+/g, ' ').trim() : null;
      };
      return {
        faturaNo: faturaNo || ettn || 'BILINMIYOR',
        faturaTarihi: issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate : null,
        ettn,
        satici: txt(supplier?.PartyName?.Name) || txt(supplier?.PartyLegalEntity?.RegistrationName) || kisiAdi(supplier) || null,
        saticiVergiNo: taxNoFromParty(supplier) || taxNoFromXmlBlock('AccountingSupplierParty') || null,
        alici: txt(customer?.PartyName?.Name) || txt(customer?.PartyLegalEntity?.RegistrationName) || kisiAdi(customer) || null,
        aliciVergiNo: taxNoFromParty(customer) || taxNoFromXmlBlock('AccountingCustomerParty') || null,
        matrah,
        kdvTutari,
        kdvOrani: matrah && kdvTutari ? Math.round((kdvTutari / matrah) * 100) : null,
        kdvBreakdown: kdvBreakdown.length ? kdvBreakdown : undefined,
        tevkifatKdv: tevkifatKdvUbl > 0 ? Math.round(tevkifatKdvUbl * 100) / 100 : undefined,
        toplamTutar,
        paraBirimi: (txt(get(['DocumentCurrencyCode'])) || 'TRY') === 'TRY' ? 'TL' : txt(get(['DocumentCurrencyCode'])) || 'TL',
        kalemler: rawKalemler.length ? rawKalemler : undefined,
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
      faturaNo: (id && !/^nan$/i.test(String(id).trim()) ? id : (uuid || 'BILINMIYOR')),
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
    // e-Fatura/e-Arşiv belge no'su BENZERSİZDİR (10+ rakam). Aynı satıcı (VKN) + aynı uzun belge no =
    //   KESİN aynı fatura → TUTAR şartı arama (iki okuma 0,31 TL fark verebiliyor, mükerrer kaçıyordu).
    //   Kısa fiş no'su (ÖKC "0049" gibi) gün/satıcı bazında tekrar edebilir → onda tutar şartı KORUNUR.
    const belgeNoUzun = !!belgeNo && belgeNo.replace(/\D/g, '').length >= 10;
    if (belgeNo && vkns.length && (belgeNoUzun || total)) {
      const byFields = await (this.prisma as any).invoiceAccountingDocument.findFirst({
        where: {
          tenantId,
          belgeNo,
          ...(input.taxpayerId ? { taxpayerId: input.taxpayerId } : {}),
          ...(belgeNoUzun ? {} : { totalAmount: total }),
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
          duplicateReason: `Aynı belge no/satıcı daha önce yüklendi (${byFields.belgeNo || byFields.vendorName || byFields.customerName})`,
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

    // Z RAPORU (yazarkasa günlük satış özeti): karşı taraf MÜŞTERİ (120) DEĞİL — nakit/kart tahsilatıdır.
    //   rawText'ten NAKİT + KREDİ KARTI tutarını ayıkla → 100 Kasa + 108 POS ayrımı (linesFromAmounts).
    const isZ = /Z[\s_]?RAPOR/i.test(String(ocrResult?.belgeTipi || '')) || /Z[\s_]?RAPOR/i.test(String(ocrResult?.rawText || '').slice(0, 400));
    const zPay = isZ ? this.parseZPayments(ocrResult?.rawText || '', totalNum) : { nakit: 0, kart: 0 };
    return this.linesFromAmounts({
      invoiceKind,
      matrah,
      kdvTutari: kdvTotal,
      kdvOrani: breakdown[0]?.rate,
      total: totalNum,
      vendorName: ocrResult?.satici || null,
      kdvBreakdown: breakdown.length ? breakdown : null,
      zRaporu: isZ,
      nakit: zPay.nakit,
      kart: zPay.kart,
    });
  }

  /** Z raporu rawText'inden NAKİT ve KREDİ KARTI tahsilat tutarlarını ayıkla (TL formatı "1.234,56").
   *  Okunamaz / toplamla tutmazsa {0,0} döner → çağıran tümünü 100 Kasa'ya yazar (güvenli; Z raporu
   *  asla müşteri 120 carisine yazılmaz, "Eksik cari" oluşmaz). */
  private parseZPayments(rawText: string, totalKdvDahil: number): { nakit: number; kart: number } {
    const t = String(rawText || '');
    const amt = (re: RegExp): number => {
      const m = t.match(re);
      if (!m) return 0;
      const n = Number(String(m[1]).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const nakit = amt(/NAK[İI]T[^0-9-]{0,24}([0-9][0-9.]*,[0-9]{2})/i);
    const kart = amt(/(?:KRED[İI]\s*KART|BANKA\s*KART|KART(?:\s*[İI]LE)?|\bPOS\b)[^0-9-]{0,24}([0-9][0-9.]*,[0-9]{2})/i);
    // Tutarlılık: nakit+kart toplam ile uyuşmuyorsa (okuma şüpheli) → {0,0} (100 Kasa fallback).
    if (nakit + kart > 0 && totalKdvDahil > 0) {
      const diff = Math.abs((nakit + kart) - totalKdvDahil);
      if (diff > Math.max(0.5, totalKdvDahil * 0.02)) return { nakit: 0, kart: 0 };
    }
    return { nakit, kart };
  }

  /** Mükellefin Luca hesap planı (READY snapshot, en az 1 kod) çekilmiş mi? */
  private async hasAccountPlan(tenantId: string, taxpayerId?: string | null): Promise<boolean> {
    if (!taxpayerId) return false;
    // ÖNEMLİ: snapshot'ın accountCount METADATA'sına DEĞİL, GERÇEK satırlara bak (getPlanCodeSet).
    //   Snapshot var ama lucaAccountPlanLine satırları yoksa (bozuk/yarım çekim) accountCount>0 olabilir;
    //   o zaman hasAccountPlan=true (banner GİZLİ) ama getPlanCodeSet=null (gate TÜM kodları siler) →
    //   kullanıcı hem kodsuz hem uyarısız kalır. İkisi AYNI kaynaktan beslenmeli (eşleşilebilir kod var mı?).
    const codes = await this.getPlanCodeSet(tenantId, taxpayerId);
    return !!(codes && codes.size > 0);
  }

  /** En son READY hesap planı snapshot'ındaki TÜM hesap kodlarını Set olarak döndürür;
   *  plan yoksa (ya da boşsa) null. Placeholder / planda-olmayan kod süzmede kullanılır —
   *  KULLANICI KURALI: "yalnız Luca'dan çekilen gerçek hesap planındaki kodlar; olmayan
   *  hesabı var gibi yazmak yok." */
  private planCodeCache = new Map<string, { at: number; codes: Set<string> | null; groups: Set<string> | null; names: Map<string, string> | null }>();
  /** Plandaki GRUP (ara) kodları: başka bir kodun ATASIolan (ör "120.01" altında "120.01.001" varsa
   *  "120.01" gruptur → fiş kesilemez). Denetim katmanı (crossCheck) bunu kullanır. */
  private async getPlanGroupSet(tenantId: string, taxpayerId?: string | null): Promise<Set<string> | null> {
    await this.getPlanCodeSet(tenantId, taxpayerId); // cache'i doldurur (groups da hesaplanır)
    const hit = this.planCodeCache.get(`${tenantId}:${taxpayerId}`);
    return hit?.groups ?? null;
  }
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
    let groups: Set<string> | null = null;
    let names: Map<string, string> | null = null;
    if (snap) {
      const lines = await (this.prisma as any).lucaAccountPlanLine.findMany({
        where: { snapshotId: snap.id },
        select: { accountCode: true, accountName: true },
      }).catch(() => []);
      if (lines.length) {
        codes = new Set(lines.map((l: any) => String(l.accountCode || '').trim()).filter(Boolean));
        // Kod → hesap ADI haritası: fiş satırı AÇIKLAMASI, sabit metin ("Satış matrahı") yerine
        //   plandaki GERÇEK hesap adını göstersin (kullanıcı talebi). gateCodesByPlan bunu kullanır.
        names = new Map<string, string>();
        for (const l of lines) {
          const c = String(l.accountCode || '').trim();
          const n = String(l.accountName || '').trim();
          if (c && n) names.set(c, n);
        }
        // GRUP tespiti: bir kod, başka bir kodun ATASIysa (o kod + '.' ile başlayan başka kod varsa)
        //   gruptur. codes sıralanıp komşu karşılaştırmayla O(n log n).
        groups = new Set<string>();
        const arr = [...codes].sort();
        for (let i = 0; i < arr.length; i++) {
          const pref = arr[i] + '.';
          for (let j = i + 1; j < arr.length && arr[j].startsWith(arr[i]); j++) {
            if (arr[j].startsWith(pref)) { groups.add(arr[i]); break; }
          }
        }
      }
    }
    this.planCodeCache.set(key, { at: Date.now(), codes, groups, names });
    return codes;
  }

  /** Satır hesap kodlarını mükellefin GERÇEK Luca planına göre süzer.
   *  Plan YOK → tüm kodları boşalt (önce hesap planı çekilsin).
   *  Plan VAR → planda OLMAYAN kodu (191.01.020 gibi placeholder/uydurma) boşalt; gerçek
   *  plan kodu kalır. Okuma + rematch sonradan doğru kodu yazar. */
  private async gateCodesByPlan(tenantId: string, taxpayerId: string | null | undefined, lines: any[]): Promise<any[]> {
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
    const names = this.planCodeCache.get(`${tenantId}:${taxpayerId}`)?.names ?? null;
    // AÇIKLAMA = HESAP ADI: matrah/vergi/vergi-sorumlu/tevkifat satırının açıklaması, sabit metin
    //   ("Satış matrahı (KDV %20)") DEĞİL, GÜNCEL hesap kodunun plandaki ADI olsun (kullanıcı talebi).
    //   Cari/kasa/pos satırı karşı taraf adını yazar; onlara dokunma. rematch:12418-12423 ile aynı kural,
    //   fark: burada ÜRETİM anında (her create yolunda) çalışır → plan çekiliyse hemen doğru görünür.
    const DESC_GROUPS = new Set(['matrah', 'vergi', 'vergi-sorumlu', 'tevkifat']);
    const applyName = (l: any): any => {
      if (!names) return l;
      if (!DESC_GROUPS.has(String(l.group || ''))) return l;
      const c = String(l.accountCode || '').trim();
      if (!c) return String(l.description || '') ? { ...l, description: '' } : l; // kod boş → açıklama boş
      const nm = names.get(c);
      return nm && nm !== String(l.description || '') ? { ...l, description: nm } : l;
    };
    const normalized = (lines || []).map((l) => ({ ...l, accountCode: this.accountCodeOnly(l.accountCode) || null }));
    if (!planCodes) return normalized.map((l) => ({ ...l, accountCode: null }));
    return normalized.map((l) => {
      const c = String(l.accountCode || '').trim();
      const gated = c && !planCodes.has(c) ? { ...l, accountCode: null } : l;
      return applyName(gated);
    });
  }

  private accountCodeOnly(value: any): string {
    const raw = String(value || '').trim();
    if (!raw || /^[-—–\s]*(yok|eksik)?[-—–\s]*$/i.test(raw)) return '';
    // \p{L}\p{N} (Unicode): cari alt hesapları TÜRKÇE harf içerir (120.01.İ027 / 120.01.Ç005). Eski
    //   [A-Za-z0-9] deseni "İ"yi tanımayıp kodu "120.01"de KESİYORDU → cari GRUP koduna çöküyor,
    //   "AI ile oku" sonrası bayat/yanlış kalıyordu (kullanıcı bulgusu; "Kodları düzelt" başka yoldan düzeltiyordu).
    const match = raw.match(/^([0-9]{1,3}(?:[.\-][\p{L}\p{N}]+)*)/u);
    if (match?.[1]) return match[1].trim();
    return raw.split(/\s+[—–-]\s+|=/)[0].trim();
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
    // Z RAPORU satışı: karşı taraf müşteri (120) değil nakit/kart tahsilatıdır → 100 Kasa + 108 POS.
    zRaporu?: boolean;
    nakit?: number;
    kart?: number;
    // SMM (E_SMM ALIŞ): okunan gelir vergisi stopajı tutarı (TL). >0 ise cari (320) NET yazılır
    //   (brüt+KDV − stopaj) ve ayrı 'kesinti' grubunda 360 satırı üretilir. 0/yok → mevcut davranış.
    smmStopaj?: number | null;
  }) {
    const isSale = opts.invoiceKind === 'SATIS';
    const cariCode = isSale ? '120.01.001' : '320.01.001';
    const matrahCode = isSale ? '600.01.001' : '770.01.010';
    const zero = () => new Prisma.Decimal(0);
    // Karşı taraf (cari) satır(lar)ı üreticisi. NORMAL: tek cari (satış 120 borç / alış 320 alacak).
    //   Z RAPORU satışı: müşteri carisi YOK → 100 Kasa (nakit) + 108 POS (kart); ayrım okunamadıysa
    //   tümü 100 Kasa (asla 120 → "Eksik cari" oluşmaz). Plandaki gerçek 100/108'e rematch bağlar.
    const cariLinesFor = (totalAmt: any, startOrder: number): any[] => {
      const t = money(totalAmt) || zero();
      if (isSale && opts.zRaporu) {
        const nakit = money(opts.nakit) || zero();
        const kart = money(opts.kart) || zero();
        if (nakit.gt(0) && kart.gt(0)) {
          return [
            { group: 'cari', accountCode: '100.01.001', description: 'Kasa (nakit tahsilat)', debit: nakit, credit: zero(), orderNo: startOrder },
            { group: 'cari', accountCode: '108.01.001', description: 'POS / kredi kartı tahsilat', debit: kart, credit: zero(), orderNo: startOrder + 1 },
          ];
        }
        return [{ group: 'cari', accountCode: '100.01.001', description: 'Kasa (günlük tahsilat)', debit: t, credit: zero(), orderNo: startOrder }];
      }
      return [{ group: 'cari', accountCode: cariCode, description: opts.vendorName || 'Cari hesap', debit: isSale ? t : zero(), credit: isSale ? zero() : t, orderNo: startOrder }];
    };

    // SMM STOPAJI (E_SMM ALIŞ — GVK 94 %20): stopaj OKUNDUYSA fiş otomatik kurulur: cari (320)
    //   NET (brüt+KDV − stopaj) alacak + ayrı 'kesinti' grubunda 360 alacak (placeholder 360.01.001;
    //   gateCodesByPlan planda yoksa boşaltır, kullanıcı gerçek stopaj-360'ını seçer). DENGE korunur:
    //   borç (matrah+KDV) = alacak (net cari + stopaj). 'kesinti' rematch'in tevkifat-360 (KDV2)
    //   bağlamasına BİLEREK dahil edilmez — o kol adında "kdv/sorumlu/tevkifat" geçen 360'ı seçer,
    //   stopaj 360'ı o değildir. Stopaj okunamadıysa (0) hiçbir şey değişmez (SMM_STOPAJ_NEEDED kalır).
    const applySmmStopaj = (rows: any[]): any[] => {
      const st = money(opts.smmStopaj) || zero();
      if (isSale || !st.gt(0)) return rows;
      const cari = rows.find((l: any) => l.group === 'cari' && l.credit && l.credit.gt && l.credit.gt(0));
      if (!cari) return rows;
      const net = cari.credit.minus(st);
      if (!net.gt(0)) return rows; // stopaj ≥ cari toplamı → okuma şüpheli, dokunma (mevcut davranış)
      cari.credit = net;
      const nextOrder = rows.reduce((m: number, l: any) => Math.max(m, Number(l.orderNo) || 0), -1) + 1;
      rows.push({ group: 'kesinti', accountCode: '360.01.001', description: 'Gelir vergisi stopajı (SMM)', debit: zero(), credit: st, orderNo: nextOrder, kaynak: 'KURAL' });
      return rows;
    };

    // Breakdown geçerli mi? — En az bir satırda base veya amount > 0 olmalı
    const breakdown = this.normalizeKdvBreakdown(opts.kdvBreakdown);
    const hasBreakdown = breakdown.some((b) => Number(b.base || 0) > 0 || Number(b.amount || 0) > 0);

    // v2.4: TEVKİFATLI fatura — alışta 2×191 (normal + sorumlu sıf.) + net cari + 360;
    // satışta hesaplanan KDV yalnız tevkifat-dışı kısımdır (kalanı alıcı sorumlu sıf. beyan eder).
    const tk = Number(opts.tevkifatOrani) || 0;
    if (tk > 0 && tk <= 1) { // tk=1 (10/10 TAM tevkifat) dahil — normal KDV satırı 0 olur, aşağıda elenir
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
        // ALIŞ tevkifat (KDV2 — kullanıcı kuralı, Mihsap birebir): 191 İKİ AYRI satıra bölünür:
        //   (a) NORMAL İndirilecek KDV = tevkifat-dışı kısım (k − tevk) — satıcıya fiilen ödenen KDV.
        //   (b) Sorumlu Sıfatıyla İndirilecek KDV = tevkifat tutarı (tevk) — alıcı bu kısmı KDV2 ile
        //       sorumlu sıfatıyla beyan/ödedikten SONRA aynı tutarı indirim hakkı olarak GERİ ALIR,
        //       o yüzden AYRI bir 191 alt-hesabına (adında "sorumlu" geçen) borç yazılır. Toplam 191
        //       borcu yine k'dir (normalK + tevk = k) — denge/toplam DEĞİŞMEZ, yalnız iki hesaba bölünür.
        //   770 matrah (B) · 191 normal KDV (B) · 191 sorumlu sıf. KDV (B) · 320 net cari (A) · 360 tevkifat (A)
        // 191-sorumlu ve 360 AYRI gruplarda → cari/oran eşleştirme onları EZMESİN; plandaki gerçek
        // hesaplara (adında "sorumlu"/"kdv"/"tevkifat" geçen) bağlanır (bkz. rematch 'vergi-sorumlu'/'tevkifat' kolu).
        const alisRows = [
          { group: 'matrah', accountCode: matrahCode, description: 'Gider / matrah', debit: m, credit: zero(), orderNo: 0 },
          { group: 'vergi', accountCode: this.kdvAccountCode(false, primaryRate), description: `İndirilecek KDV ${rl || ''}`.trim(), rate: rl, debit: normalK, credit: zero(), orderNo: 1 },
          { group: 'vergi-sorumlu', accountCode: '191.02.001', description: `Sorumlu Sıfatıyla İndirilecek KDV ${rl || ''}`.trim(), rate: rl, debit: tevk, credit: zero(), orderNo: 2 },
          { group: 'cari', accountCode: cariCode, description: opts.vendorName || 'Cari hesap', debit: zero(), credit: net, orderNo: 3 },
          { group: 'tevkifat', accountCode: '360.01.001', description: 'Ödenecek KDV (sorumlu sıf. — KDV2 ile beyan)', rate: rl, debit: zero(), credit: tevk, orderNo: 4 },
        ];
        // TAM tevkifatta (tk=1) normal KDV 0 → boş satır bırakma.
        return applySmmStopaj(normalK.gt(0) ? alisRows : alisRows.filter((l) => l.group !== 'vergi'));
      }
      const satisRows = [
        { group: 'cari', accountCode: cariCode, description: opts.vendorName || 'Cari hesap', debit: net, credit: zero(), orderNo: 0 },
        { group: 'matrah', accountCode: matrahCode, description: 'Satış matrahı', debit: zero(), credit: m, orderNo: 1 },
        { group: 'vergi', accountCode: this.kdvAccountCode(true, primaryRate), description: `Hesaplanan KDV (tevkifat sonrası) ${rl || ''}`.trim(), rate: rl, debit: zero(), credit: normalK, orderNo: 2 },
      ];
      return normalK.gt(0) ? satisRows : satisRows.filter((l) => l.group !== 'vergi');
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
      for (const cl of cariLinesFor(total, orderNo)) lines.push({ ...cl, orderNo: orderNo++ });
      // İlk kurulum satırları yer-tutucudur → kaynak VARSAYILAN (öğrenme bu satırlardan yapılmaz).
      // (SMM stopajı 'kesinti' satırı applySmmStopaj'da kaynak='KURAL' ile eklenir — map'ten SONRA.)
      return applySmmStopaj(lines.map((l: any) => ({ ...l, kaynak: 'VARSAYILAN' })));
    }

    // Tek-oran fallback (eski davranış)
    const matrah = money(opts.matrah) || zero();
    const kdv = money(opts.kdvTutari) || zero();
    const total = money(opts.total) || matrah.plus(kdv);
    const rateNumber = opts.kdvOrani ? Number(opts.kdvOrani) : undefined;
    const rate = rateNumber ? `%${rateNumber.toLocaleString('tr-TR')}` : undefined;

    const singleRateLines: any[] = [{
      group: 'matrah',
      accountCode: matrahCode,
      description: isSale ? 'Satış matrahı' : 'Gider / matrah',
      debit: isSale ? zero() : matrah,
      credit: isSale ? matrah : zero(),
      orderNo: 0,
    }];
    if (kdv.gt(0)) {
      singleRateLines.push({
        group: 'vergi',
        accountCode: this.kdvAccountCode(isSale, rateNumber),
        description: isSale ? 'Hesaplanan KDV' : 'İndirilecek KDV',
        rate,
        debit: isSale ? zero() : kdv,
        credit: isSale ? kdv : zero(),
        orderNo: singleRateLines.length,
      });
    }
    for (const cl of cariLinesFor(total, singleRateLines.length)) singleRateLines.push({ ...cl, orderNo: singleRateLines.length });
    // İlk kurulum satırları yer-tutucudur → kaynak VARSAYILAN (öğrenme bu satırlardan yapılmaz).
    return applySmmStopaj(singleRateLines.map((l: any) => ({ ...l, kaynak: 'VARSAYILAN' })));
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
    // blob YALNIZ kalem + giderTuru (fatura İÇERİĞİ). muhasebeNeden ÇIKARILDI: o AI yorumu; "…demirbaş
    //   niteliğindedir" gibi bir cümle blob'a girince engellemek istediğimiz "AI kelimesine kapılma"
    //   davranışı geri sızıyordu (beyaz eşya tamircisinin onarım geliri yanlış demirbaş oluyordu).
    const blob = fold(`${kalemAd} ${ocr.giderTuru || ''}`);
    // Güçlü sabit-kıymet anahtarları (asciiFold, kök biçim). YALNIZ SOMUT cihaz/makine adları — soyut
    //   'demirbas'/'sabit kiymet' KELİMELERİ ÇIKARILDI (bunlar AI çıktısı olabilir, içerik kanıtı değil).
    const ASSET = [
      'klima', 'iklimlendirme', 'kombi', 'kazan dair', 'buzdolab', 'dondurucu', 'sogutucu', 'sogutma dolab',
      'davlumbaz', 'set ustu ocak', 'bulasik makin', 'camasir makin', 'kurutma makin', 'kahve makin', 'hamur makin',
      'makine', 'makina', 'jenerator', 'kompresor', 'forklift', 'transpalet', 'celik tezgah', 'vitrin',
      'bilgisayar', 'laptop', 'dizustu', 'monitor', 'yazici cihaz', 'fotokopi makin', 'tarayici cihaz', 'projeksiyon',
      'televizyon', 'mobilya', 'asansor', 'kamera sistem', 'guvenlik kamera',
      // Taşıt/araç SATIN ALIMI/SATIŞI (sabit kıymet) — yarı römork/treyler/dorse gibi. Servis/bakım/
      //   nakliye-hizmet faturaları yukarıda giderIcerikSinifla ile ELENDİĞİ için bunlar yalnız GERÇEK
      //   alım/satımda kalır. MOTORLU TAŞITLAR eklendi (kullanıcı 2026-07-18: "demirbaş alış/satışını
      //   ayırt edip uyarsın, Luca'dan ayrıca işleniyor") — nakliyecinin kamyon/otomobil satışı kaçmasın.
      //   'cekici' TEK BAŞINA bilerek YOK (oto kurtarma "çekici ücreti" hizmetiyle karışır).
      'romork', 'treyler', 'dorse', 'cekici dorse',
      'kamyon', 'kamyonet', 'otomobil', 'binek arac', 'minibus', 'otobus',
      'traktor', 'ekskavator', 'yukleyici kepce', 'is makine',
    ];
    // İÇERİK sinyali ŞART: faturada gerçek cihaz/makine/sabit-kıymet adı geçmeli. AI'ın salt "demirbas"
    //   KATEGORİSİ TEK BAŞINA güvenilmez — AI, mükellefin faaliyet açıklamasındaki cihaz isimlerine
    //   kapılıp HİZMET/onarım gelirini bile "demirbas" diyebiliyordu (beyaz eşya TAMİRCİSİNİN onarım
    //   SATIŞLARI yanlışlıkla demirbaş işaretleniyordu — gerçek prod verisinde 23 belge). Bu yüzden
    //   yalnız fatura İÇERİĞİNDEKİ (kalem/giderTuru) gerçek mala bakılır.
    // ⚠️ ÖNCE: içerik bir GİDER/HİZMET kuralına uyuyorsa (yedek parça, bakım, onarım, diagnostik,
    //   akaryakıt, nakliye, müşavirlik, lastik…) bu SABİT KIYMET DEĞİLDİR → demirbaş YANLIŞ-POZİTİFİNİ
    //   engelle. (Çetaş "diagnostik/elektrik", MENGERLER "yedek parça filtre", TORA akaryakıt servis/sarf
    //   faturaları demirbaş işaretleniyordu.) Ham içerik (kalem + giderTuru); bozuk muhasebeNeden'e bakma.
    if (giderIcerikSinifla(`${kalemAd} ${ocr.giderTuru || ''}`)) return { is: false, reason: '' };
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

  /** Faturanın KDV HARİÇ matrah toplamı (TL). Demirbaş haddi (VUK 313) karşılaştırması için.
   *  Sıra: kdvBreakdown matrahları → ocr.matrah → (toplam − KDV). Bilinmiyorsa 0. */
  private matrahHaricTL(ocr: any): number {
    const o = ocr || {};
    const bd = Array.isArray(o.kdvBreakdown) ? o.kdvBreakdown : [];
    let base = 0;
    for (const b of bd) {
      const m = Number(b?.matrah ?? b?.base) || 0;
      if (m > 0) { base += m; continue; }
      const t = Number(b?.tutar ?? b?.amount) || 0;
      const r = Number(b?.oran ?? b?.rate) || 0;
      if (t > 0 && r > 0) base += t / (r / 100);
    }
    if (base > 0) return Math.round(base * 100) / 100;
    const m = Number(o.matrah) || 0;
    if (m > 0) return m;
    const total = Number(o.totalTutari ?? o.total) || 0;
    const kdv = Number(o.kdvTutari) || 0;
    return total > 0 ? Math.max(total - kdv, 0) : 0;
  }

  /** Demirbaş içeriği var AMA KDV hariç bedel VUK haddinin ALTINDA → doğrudan gider (770), demirbaş(255)
   *  DEĞİL ("770'te gider yazılan demirbaş"). Tutar bilinmiyorsa (0) false döner → demirbaş kalır (güvenli).
   *  VUK 313 haddi İKTİSADİ KIYMET BAŞINAdır: karışık faturada (demirbaş + sarf aynı belgede) fatura
   *  TOPLAMI değil, demirbaş KALEMİNİN tutarı esas alınır — hitWord (detectFixedAsset.reason) verilir
   *  ve kalem eşleşirse o kalemlerin toplamı kullanılır; eşleşmezse eski toplam-matrah davranışı. */
  private demirbasHaddiAltinda(ocr: any, hitWord?: string): boolean {
    const o = ocr || {};
    if (hitWord) {
      const fold = (s: string) => this.norm(s).replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
      let sum = 0;
      for (const k of (Array.isArray(o.kalemler) ? o.kalemler : [])) {
        if (fold(String(k?.ad || '')).includes(hitWord)) sum += Number(k?.tutar) || 0;
      }
      if (sum > 0) return sum < VUK_HAD_TL;
    }
    const m = this.matrahHaricTL(o);
    return m > 0 && m < VUK_HAD_TL;
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
    lines: Array<{ debit: any; credit: any; group?: string; accountCode?: string | null; rate?: string | null }>;
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
    kalemler?: Array<{ ad?: string; tutar?: number; oran?: number }> | null;  // denetim: çok-oranlı çökme tespiti
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
    // ŞEMA NORMALİZASYONU: kdvBreakdown iki biçimde geliyor — {rate,base,amount} (entegratör/ensure)
    //   ve {oran,matrah,tutar} (aiReadDocument ocrData'sı). Yalnız İngilizce anahtar okununca
    //   ana (AI-okuma) yoldaki belgelerde toplamlar 0 kalıyor → KDV_MATH hiç ateşlenmiyordu.
    const kdvBreakdownNorm = Array.isArray(opts.kdvBreakdown)
      ? (opts.kdvBreakdown as any[]).map((b: any) => ({
          rate: Number(b?.rate ?? b?.oran ?? 0),
          base: Number(b?.base ?? b?.matrah ?? 0),
          amount: Number(b?.amount ?? b?.tutar ?? 0),
        }))
      : null;
    const breakdownSumBase = kdvBreakdownNorm ? kdvBreakdownNorm.reduce((s, b) => s + (b.base || 0), 0) : 0;
    const breakdownSumKdv = kdvBreakdownNorm ? kdvBreakdownNorm.reduce((s, b) => s + (b.amount || 0), 0) : 0;
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
      const rateLineCount = opts.lines.filter((l) => ['matrah', 'vergi', 'vergi-sorumlu'].includes(String((l as any).group || ''))).length;
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
    for (const b of (kdvBreakdownNorm || [])) {
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
    //     Satır ARTIK OTOMATİK üretilebiliyor (linesFromAmounts 'kesinti' grubu): 360'lı satır YA DA
    //     'kesinti' grubu satırı varsa (plan-gate kodu boşaltmış olsa bile stopaj fişte ayrılmış) uyarı verme.
    if (String(opts.documentType || '').toUpperCase() === 'E_SMM'
      && String(opts.invoiceKind || '').toUpperCase() !== 'SATIS'
      && !(opts.lines || []).some((l: any) => String((l as any).accountCode || '').startsWith('360')
        || String((l as any).group || '') === 'kesinti')) {
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

    // ── ÇAPRAZ DENETİM KATMANI (Katman 1 — kural bazlı "ikinci göz", AI'sız/anlık; kullanıcı talebi
    //    "eşleştirmeleri benim gibi kontrol edecek yapı"). "Eşleşti ✓" yalanını keser: matematik tutsa
    //    da MANTIKSAL hatayı yakalar. Gösterilen gerçek 3 vakayı hedefler:
    //    A) grup/geçersiz hesap kodu (İSTANBUL KİLİT 120.01), B) çok-oranlı fatura tek orana çökme (MHD %18),
    //    C) cari 2-seviyeli grup şüphesi (bayat planda A kaçarsa yedek). ]
    try {
      const postLines = (opts.lines || []).filter((l: any) => String(l.accountCode || '').trim());
      // A) GRUP / GEÇERSİZ HESAP KODU — plandaki grup (çocuğu olan) koda fiş kesilemez.
      if (opts.taxpayerId && postLines.length) {
        const groups = await this.getPlanGroupSet(opts.tenantId, opts.taxpayerId);
        if (groups && groups.size) {
          const grpHit = [...new Set(postLines.map((l: any) => String(l.accountCode).trim()))].filter((c) => groups.has(c));
          if (grpHit.length) {
            issues.push({
              code: 'ACCOUNT_IS_GROUP',
              severity: 'ERROR',
              message: `Grup (ara) hesabına fiş kesilemez: ${grpHit.join(', ')}. Alt (en derin) hesabı seçin.`,
            });
          }
        }
      }
      // B) ÇOK-ORANLI FATURA TEK ORANA ÇÖKMÜŞ — kalemlerde ≥2 farklı KDV oranı var ama yevmiyede
      //    daha az oran işlenmiş (MHD: %20+%10 → tek "%18" harmanı). Sahte harman oran = beyan hatası.
      const kalemOranlar = new Set((opts.kalemler || []).map((k: any) => Math.round(Number(k?.oran) || 0)).filter((r: number) => r > 0));
      const fisOranlar = new Set(
        (opts.lines || []).filter((l: any) => ['matrah', 'vergi'].includes(String(l.group || '')))
          .map((l: any) => Math.round(Number(String(l.rate || '').replace(/[^0-9]/g, '')) || 0)).filter((r: number) => r > 0),
      );
      if (kalemOranlar.size >= 2 && fisOranlar.size < kalemOranlar.size) {
        issues.push({
          code: 'MULTI_RATE_COLLAPSED',
          severity: 'ERROR',
          message: `Fatura ${kalemOranlar.size} farklı KDV oranı içeriyor (${[...kalemOranlar].sort((a, b) => a - b).map((r) => '%' + r).join(', ')}) ama fiş ${fisOranlar.size || 1} orana çökmüş. "AI ile oku" ile yeniden okuyun — her oran ayrı satır olmalı.`,
        });
      }
      // C) CARİ 2-SEVİYELİ (GRUP ŞÜPHESİ) — cari kodu tek noktalı (120.01 gibi). Plandan grup tespiti
      //    bayat/eksik plan yüzünden kaçarsa (İTO/ARNAVUTKÖY: farklı müşteriler AYNI 120.01'e düşmüş)
      //    YAKALA. Planın CARİ normu 3-seviyeliyse (120.xx.xxx var) 2-seviyeli cari KESİN yanlış → ERROR
      //    ("Eşleşti" yalanını keser, onayı bloklar). Plan 2-seviyeli cari kullanıyorsa (firma konvansiyonu)
      //    yalnız yumuşak WARNING.
      const cariLine = (opts.lines || []).find((l: any) => String(l.group || '') === 'cari' && String(l.accountCode || '').trim());
      const cariCode = String(cariLine?.accountCode || '').trim();
      if (cariCode && /^(120|320|329|331)\.\d+$/.test(cariCode)) {
        const planCodes = opts.taxpayerId ? await this.getPlanCodeSet(opts.tenantId, opts.taxpayerId) : null;
        // 3. parça HARF ya da rakamla başlayabilir (120.01.A001 / 120.01.İ027) → \d değil ".+" ile ara.
        const hasThreeLevelCari = !!planCodes && [...planCodes].some((c) => /^(120|320|329|331)\.\d+\..+/.test(c));
        issues.push({
          code: 'CARI_SHALLOW_CODE',
          severity: hasThreeLevelCari ? 'ERROR' : 'WARNING',
          message: `Cari hesap kodu ${cariCode} 2 seviyeli — grup (ara) hesabına fiş kesilmiş olabilir. Bu müşteri/satıcı için doğru alt hesabı (ör. ${cariCode}.001) seçin.`,
        });
      }
    } catch (e: any) {
      this.logger.warn(`crossCheck denetim hatasi: ${e?.message || e}`);
    }

    // Sonuç durumu
    const hasIncomplete = issues.some((i) => i.code === 'INCOMPLETE_AMOUNTS');
    const hasInvalid = issues.some((i) => i.code !== 'INCOMPLETE_AMOUNTS' && i.severity === 'ERROR');
    const status = hasInvalid ? 'INVALID' : hasIncomplete ? 'INCOMPLETE' : 'OK';
    return { status, issues };
  }

  /** HIZLI düzeltme: belgeleri TEKRAR OKUMADAN (Max-vision yok) hesap kodlarını plana göre
   *  yeniden eşleştirir — yanlış carileri (KAYIKÇI→AYDE) temizler/doğrular. Saniyeler sürer. */
  /**
   * OKC fis backfill — deploy oncesi eski parser'la okunmus fislerde TOPLAM tutar,
   * matrah, satici VKN ve belge no bos kalmis olabilir. Kayitli HAM METINDEN
   * (ocrData.rawText) yeniden turetir; Azure'a GITMEZ (maliyet yok).
   * SADECE BOS alanlari doldurur (mevcut degerleri ezmez). dryRun=true → yazmaz,
   * ne degisecegini ornekleriyle doner.
   */
  async reparseOkcFisFields(
    tenantId: string,
    opts: { taxpayerId?: string; period?: string; dryRun?: boolean; documentIds?: string[] },
  ) {
    const where: any = { tenantId, documentType: 'OKC_FIS' };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.documentIds?.length) where.id = { in: opts.documentIds };
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
      select: { id: true, belgeNo: true, sellerVkn: true, totalAmount: true, ocrData: true },
      take: 5000,
    });

    let scanned = 0;
    let changed = 0;
    const samples: any[] = [];
    for (const d of docs) {
      const raw = (d.ocrData && typeof d.ocrData === 'object') ? String(d.ocrData.rawText || '') : '';
      if (!raw) continue;
      scanned++;
      const r = this.ocr.reparseOkcFieldsFromRawText(raw);

      const data: any = {};
      const ocr: any = { ...(d.ocrData || {}) };
      let ocrTouched = false;
      const before: any = {};
      const after: any = {};

      // TOPLAM tutar (totalAmount kolonu + ocrData.totalTutari) — sadece bos ise
      if ((d.totalAmount == null) && r.totalTutari && this.numFromOcr(r.totalTutari) > 0) {
        data.totalAmount = this.numFromOcr(r.totalTutari);
        ocr.totalTutari = r.totalTutari; ocrTouched = true;
        before.total = null; after.total = r.totalTutari;
      }
      // matrah — kdvBreakdown[0].matrah bos ise
      if (r.matrah != null && Array.isArray(ocr.kdvBreakdown) && ocr.kdvBreakdown.length === 1
          && ocr.kdvBreakdown[0] && ocr.kdvBreakdown[0].matrah == null) {
        ocr.kdvBreakdown = [{ ...ocr.kdvBreakdown[0], matrah: r.matrah }];
        ocrTouched = true;
        before.matrah = null; after.matrah = r.matrah;
      }
      // satici VKN — bos ise
      if (!String(d.sellerVkn || '').trim() && r.saticiVkn) {
        data.sellerVkn = r.saticiVkn;
        ocr.saticiVkn = r.saticiVkn; ocrTouched = true;
        before.vkn = null; after.vkn = r.saticiVkn;
      }
      // belge no — bos ise
      if (!String(d.belgeNo || '').trim() && r.belgeNo) {
        data.belgeNo = r.belgeNo;
        before.belgeNo = null; after.belgeNo = r.belgeNo;
      }

      if (ocrTouched) data.ocrData = ocr;
      if (Object.keys(data).length === 0) continue;
      changed++;
      if (samples.length < 12) samples.push({ id: d.id, before, after });
      if (!opts.dryRun) {
        await (this.prisma as any).invoiceAccountingDocument.update({
          where: { id: d.id },
          data,
        }).catch((e: any) => this.logger.warn(`reparse-okc update basarisiz (${d.id}): ${e?.message || e}`));
      }
    }

    return { ok: true, dryRun: !!opts.dryRun, scanned, changed, samples };
  }

  async reapplyAccountCodes(tenantId: string, taxpayerId: string, documentIds?: string[]) {
    if (!taxpayerId) throw new BadRequestException('Mükellef seçilmeli');
    // documentIds verilirse SADECE o belgeleri yeniden eşle (tek/az belge → hızlı, HTTP timeout yok).
    //   Boşsa tüm mükellef (eski davranış). Retro-cari + gate tüm mükellefte kalır (ucuz), rematch filtreli.
    if (documentIds && documentIds.length) {
      await this.rematchDocumentsWithLatestAccountPlan(tenantId, taxpayerId, documentIds).catch(() => {});
      return { ok: true, scope: 'documents', count: documentIds.length };
    }
    // RETROAKTİF CARİ DÜZELTME: ALIŞ'ta satıcı (sellerVkn/vendorName) = MÜKELLEF olan belgeler hatalı
    //   (cari=mükellef, "Yorgun Nakliyat" cari + hesap boş). Taraflar ters okunmuş → satıcı↔alıcı çevir
    //   ki cari gerçek karşı taraf olsun; sonraki rematch cariyi doğru hesaba bağlar. APPROVED'a dokunma.
    try {
      const tpv = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { taxNumber: true } });
      // taxNumber ŞİFRELİ tutulabilir → komşu metodlarla birebir aynı desen: önce tryDecrypt.
      //   Şifreli VKN'yi ham okuyunca eşleşme olmuyor, retro-cari düzeltmesi çalışmıyordu.
      const ownVkn = String(tryDecrypt(tpv?.taxNumber) || tpv?.taxNumber || '').replace(/\D/g, '');
      if (ownVkn) {
        const bad = await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: { tenantId, taxpayerId, invoiceKind: 'ALIS', sellerVkn: ownVkn, status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] } },
          select: { id: true, belgeNo: true, sellerVkn: true, buyerVkn: true, vendorName: true, customerName: true },
          take: 2000,
        }).catch(() => []);
        let fixed = 0;
        for (const d of bad) {
          const bV = String(d.buyerVkn || '').replace(/\D/g, '');
          // 1) XML'de gecerli alici tarafi varsa onu satici yap (taraflar ters).
          let newVkn: string | null = (bV && bV !== ownVkn) ? d.buyerVkn : null;
          let newName: string | null = newVkn ? (d.customerName || null) : null;
          // 2) XML'de karsi taraf yok/mukellef → INBOX satirindan gercek satici (liste senderVkn/senderTitle).
          if (!newVkn && d.belgeNo) {
            const inbox = await (this.prisma as any).eFaturaInbox.findFirst({
              where: { tenantId, taxpayerId, faturaNo: d.belgeNo },
              select: { senderVkn: true, senderTitle: true, rawJson: true },
            }).catch(() => null);
            const raw = inbox?.rawJson && typeof inbox.rawJson === 'object' ? inbox.rawJson : {};
            const sv = String(inbox?.senderVkn || raw?.senderVkn || '').trim();
            const st = String(inbox?.senderTitle || raw?.senderTitle || '').trim();
            if (sv && sv.replace(/\D/g, '') !== ownVkn) { newVkn = sv; newName = st || null; }
          }
          if (newVkn) {
            await (this.prisma as any).invoiceAccountingDocument.update({
              where: { id: d.id },
              data: { sellerVkn: newVkn, vendorName: newName, buyerVkn: d.sellerVkn || ownVkn, customerName: d.vendorName || null },
            }).then(() => { fixed++; }).catch(() => {});
          }
        }
        if (fixed) this.logger.warn(`[CARI-DUZELT] ${fixed} ALIS belgesinde satici=mukellef idi, gercek satici (XML alici / inbox sender) ile duzeltildi: tp=${taxpayerId}`);
      }
    } catch (e: any) { this.logger.warn(`[CARI-DUZELT] retro hata: ${e?.message || e}`); }
    await this.gateExistingDocsIfNoPlan(tenantId, taxpayerId);
    await this.rematchDocumentsWithLatestAccountPlan(tenantId, taxpayerId);
    // ÇELİŞKİ TAZELE: rematch satır/kodları güncelledi → ESKİ validation kayıtlarını (artık
    //   geçersiz "çelişki" mesajları, ör. eski yevmiye toplamı) GÜNCEL satırlarla yeniden hesapla.
    //   Denge tutan eski TOTAL_MISMATCH/BALANCE temizlenir; gerçek sorun (denge/sahiplik) kalır +
    //   nedeni güncel. Böylece "Kodları düzelt" çelişki kayıtlarını da tazeler (yeniden okuma şart değil).
    const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: { tenantId, taxpayerId, status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] } },
      select: { id: true, totalAmount: true, lines: { select: { debit: true, credit: true, group: true } } }, take: 1000,
    }).catch(() => []);
    for (const d of docs) {
      // Yevmiye DENGELİYSE belge toplamını YEVMİYEDEN (matrah+kdv) düzelt — eski parsed.toplam KDV
      //   HARİÇ olabilir (858 vs 858,50) → TOTAL_MISMATCH. Denge bozuksa dokunma (gerçek sorun, kalsın).
      //   SINIR: eskiden fark ne olursa olsun ezerdi → OCR'ın YANLIŞ okuduğu tutar da "düzeltilip"
      //   gerçek TOTAL_MISMATCH kalıcı maskeleniyordu. Artık yalnız AÇIKLANABİLİR farklar ezilir:
      //   (a) kuruş/yuvarlama, (b) toplam=matrah okunmuş (KDV hariç), (c) tevkifatlı net yazılmış.
      const sumD = (d.lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const sumC = (d.lines || []).reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      if (Math.abs(sumD - sumC) <= 0.02) {
        const yev = Math.round(Math.max(sumD, sumC) * 100) / 100;
        const cur = Number(d.totalAmount || 0);
        const matrahSum = (d.lines || []).filter((l: any) => String(l.group || '') === 'matrah')
          .reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
        const tevkSum = (d.lines || []).filter((l: any) => String(l.group || '') === 'tevkifat')
          .reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
        const smallTol = Math.max(1, cur * 0.005);
        const aciklanabilir = cur <= 0
          || Math.abs(yev - cur) <= smallTol
          || Math.abs(cur - matrahSum) <= smallTol
          || (tevkSum > 0 && Math.abs(cur - (yev - tevkSum)) <= 1);
        if (yev > 0 && Math.abs(yev - cur) > 0.02 && aciklanabilir) {
          await (this.prisma as any).invoiceAccountingDocument.update({ where: { id: d.id }, data: { totalAmount: yev } }).catch(() => {});
        }
      }
      await this.revalidateDocument(tenantId, d.id).catch(() => {});
    }
    // RETROAKTİF ALICI ADI (SATIŞ): listede firma "—" görünen belgeler — alıcı ünvanı okunamadı ama
    //   GİB e-Arşiv/e-Fatura listesinde (earsiv_faturalar.alici) mevcut. Boş olanlar oradan doldurulur.
    try {
      const adsiz = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: { tenantId, taxpayerId, invoiceKind: 'SATIS', belgeNo: { not: null }, OR: [{ customerName: null }, { customerName: '' }] },
        select: { id: true, belgeNo: true },
        take: 1000,
      }).catch(() => []);
      let adDoldu = 0;
      for (const d of adsiz as any[]) {
        const ef = await (this.prisma as any).earsivFatura.findFirst({
          where: { tenantId, taxpayerId, tip: 'SATIS', faturaNo: String(d.belgeNo) },
          select: { alici: true },
        }).catch(() => null);
        const ad = String(ef?.alici || '').trim();
        if (ad) {
          await (this.prisma as any).invoiceAccountingDocument.update({ where: { id: d.id }, data: { customerName: ad } }).catch(() => {});
          adDoldu++;
        }
      }
      if (adDoldu) this.logger.log(`[ALICI-AD] ${adDoldu} satış belgesine alıcı ünvanı GİB listesinden dolduruldu: tp=${taxpayerId}`);
    } catch { /* isim doldurma opsiyonel — akışı bozma */ }
    // Kodlar tazelendi → eksik zengin yorum + denetçiyi arka planda hazırla (belge açılmadan görünsün).
    void this.sweepRichYorum(tenantId).catch(() => {});
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
    // İşletme: amounts var ama ocrData.isletme boş (eski okuma / defterTuru geç set) → fallback uygula.
    await this.applyIsletmeFallbackClassification(tenantId, taxpayerId, documentIds).catch(() => {});
  }

  /** İşletme mükellefleri için kayıt türü boş belgelerden ocrData.isletme'yi retroaktif doldurur. */
  private async applyIsletmeFallbackClassification(tenantId: string, taxpayerId: string, documentIds?: string[]) {
    const tp = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { defterTuru: true, mihsapDefterTuru: true, naceKodu: true, faaliyetAciklama: true },
    }).catch(() => null);
    if (!isIsletmeLedger(tp?.defterTuru, tp?.mihsapDefterTuru)) return;
    const nace = String(tp?.naceKodu || '').trim();
    const faaliyet = String(tp?.faaliyetAciklama || '').trim();
    const docs: any[] = await (this.prisma as any).invoiceAccountingDocument.findMany({
      where: {
        tenantId, taxpayerId,
        status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] },
        ...(documentIds?.length ? { id: { in: documentIds } } : {}),
      },
      select: { id: true, invoiceKind: true, documentType: true, totalAmount: true, vendorName: true, customerName: true, ocrData: true },
      take: 500,
    });
    for (const doc of docs) {
      const ocr = (doc.ocrData as any) || {};
      // KULLANICI ELLE dokunduysa (userEdited) DOKUNMA. OTOMATİK sınıflıysa (autoMatched) TAZELE —
      //   eskiden "kayitTuruKod varsa continue" ile auto-sınıf da atlanıyordu → okuma/faaliyet/iade
      //   düzeltmeleri işletme alanlarına GERİ-YAYILMIYORDU (kullanıcı güvensizliğinin kökü).
      if (ocr?.isletme?.kayitTuruKod && ocr?.isletme?.userEdited === true) continue;
      const hasAmt = Number(ocr?.matrah || 0) > 0 || Number(ocr?.kdvTutari || 0) > 0 || Number(doc.totalAmount || 0) > 0;
      if (!hasAmt) continue; // okunamadı, atla
      const kind: 'ALIS' | 'SATIS' = String(doc.invoiceKind || 'ALIS') === 'SATIS' ? 'SATIS' : 'ALIS';
      const giderTuru = String(ocr?.giderTuru || '').trim();
      const vendorName = kind === 'ALIS' ? String(doc.vendorName || '') : String(doc.customerName || '');
      const belgeTuru = normalizeDocumentType(doc.documentType || ocr?.belgeTuru || ocr?.documentType);
      const giderSinifi = kind === 'ALIS'
        ? isletmeGiderSinifi({ matrahKategori: ocr?.matrahKategori || ocr?.kategori, giderTuru, vendorName, documentType: belgeTuru || doc.documentType || ocr?.belgeTuru })
        : null;
      const fbKtKod = kind === 'ALIS'
        ? (giderSinifi?.kayitTuruKod || '')
        : isletmeAutoKayitTuru(kind, nace || null, faaliyet || null);
      if (!fbKtKod) continue;
      const ref = isletmeRef(kind);
      const fbKt = ref.kayitTuru.find((x: any) => x.kod === fbKtKod);
      if (!fbKt) continue;
      const kalemler = Array.isArray(ocr?.kalemler) ? ocr.kalemler.map((k: any) => String(k?.ad || '')).join(' ') : '';
      const islText = `${giderTuru} ${vendorName} ${kalemler}`.trim();
      const fbAltKod = giderSinifi?.kayitAltKod || (fbKtKod === '4' ? isletmeAutoKayitAltKod(kind, '4', islText) : (defaultKayitAltKod(kind, fbKtKod, fbKt.ad) || ''));
      const altList = getKayitAltList(kind, fbKtKod);
      const fbAlt = fbAltKod ? altList.find((x: any) => x.kod === fbAltKod) : null;
      const islIade = ocr?.isReturn === true;
      const islTevk = ocr?.tevkifatHint === true || Number(ocr?.tevkifatOrani || 0) > 0;
      const islKdvVar = Number(ocr?.kdvTutari || 0) > 0;
      const isletme = {
        kayitTuruKod: fbKtKod, kayitTuruAd: fbKt.ad,
        kayitAltKod: fbAlt?.kod || '', kayitAltAd: fbAlt?.ad || '',
        autoMatched: true, neden: 'Faaliyet/içerik tabanlı retroaktif seçim',
        alisSatisKod: isletmeAlisSatisTuru(kind, { isReturn: islIade, tevkifat: islTevk, kdvVar: islKdvVar, text: islText }),
        islemTuruKod: isletmeIslemTuru(kind, islText),
        belgeTuruKod: belgeTuru ? defaultBelgeTuruKod(belgeTuru, kind) : '',
      };
      await (this.prisma as any).invoiceAccountingDocument.update({
        where: { id: doc.id },
        data: { ocrData: { ...ocr, isletme } },
      });
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
      .filter((d: any) => String(d.altKategori || '').trim().toUpperCase() !== 'CARI')
      // ÖĞRENME EŞİĞİ (R2) — pickVendorMemoryAccount ile aynı: tek onaylı karar otomatik uygulanmaz.
      .filter((d: any) => (d.onayAdedi || 0) >= 2);
    const r = String(rate || '').replace(/[^0-9]/g, '');
    // Öncelik: 1) bu KDV oranına özel kural, 2) orana bağsız (genel) kural. "En çok onaylanan"
    //   son çaresi (R5) KALDIRILDI — başka oran için öğrenilmiş kod sessizce uygulanıyordu.
    const byRate = r ? decisions.find((d: any) => String(d.altKategori || '').replace(/[^0-9]/g, '') === r) : null;
    const general = decisions.find((d: any) => !String(d.altKategori || '').trim());
    const pick = byRate || general;
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
      select: { id: true, sellerVkn: true, ocrData: true, lines: { where: { group: 'matrah' }, select: { id: true, accountCode: true, rate: true } } },
      take: 1000,
    });
    if (!docs.length) return 0;
    // Öğrenilen kod, plan varsa plana karşı doğrulanır (plansız mükellefte serbest — sıfır risk).
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
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
        if (learned && !this.learnedMatrahCompatibleWithContent(learned, String((doc.ocrData as any)?.matrahKategori || ''), String((doc.ocrData as any)?.giderTuru || ''), String((doc.ocrData as any)?.matrahKategori || '').toLowerCase().trim() === 'demirbas')) continue;
        if (!learned || String(l.accountCode || '').trim() === learned) continue;
        if (planCodes && !planCodes.has(learned)) continue; // öğrenilen kod planda yok → uygulama (plan varsa doğrula)
        await (this.prisma as any).invoiceAccountingLine.update({
          where: { id: l.id },
          data: { accountCode: learned, kaynak: 'HAFIZA' },
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
    // Hesap kodu mükellefin hesap planına karşı DOĞRULANIR — plan varsa ve kod planda yoksa öğretme
    //   reddedilir (yalnız "rakamla başlıyor" yeterli değil; olmayan koda cari sabitlenmesin).
    const planCodes = await this.getPlanCodeSet(tenantId, taxpayerId);
    if (planCodes && !planCodes.has(accountCode)) {
      throw new BadRequestException(`Hesap kodu (${accountCode}) mükellefin hesap planında yok — önce Luca'dan güncel planı çekin ya da plandaki geçerli bir kodu girin.`);
    }
    await this.vendorMemory.recordDecision({
      tenantId,
      firmaKimlikNo: vendorVkn,
      firmaUnvan: input.vendorName || null,
      kararTipi: 'fatura',
      kategori: accountCode,
      altKategori: rate,
      taxpayerId,
      // Elle öğretilen kural = açık kullanıcı iradesi → öğrenme eşiğini (≥2) beklemeden uygulanır.
      onayBoost: 3,
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
   * Entegratör (TÜRMOB/e-Fatura/e-Arşiv) belgesinin ORİJİNAL UBL XML'ini getirir — ZIP içindeki
   * invoice.xml, düz .xml, eFaturaInbox.ublXmlRaw ya da earsivFatura.xmlContent. Sentetik/liste-özeti
   * XML ve UBL olmayan içerik ELENİR (null döner). Bu belgeler "AI ile oku" yerine doğrudan XML'den
   * okunur (görsel özel XSLT'de satıcı render olmuyor + "Fatura Tipi: SATIS" yazıyor → yön ters dönüyordu).
   */
  private async loadProviderUblXml(tenantId: string, doc: any): Promise<string | null> {
    const valid = (xml: string | null | undefined): string | null => {
      const s = String(xml || '').trim();
      if (!s) return null;
      if (this.isSyntheticTurmobInboxXml(s)) return null;
      if (!/<(?:\?xml|[A-Za-z0-9_.-]+:)?(?:Invoice|CreditNote)\b/i.test(s)) return null;
      return s;
    };
    // 1) s3Key — ZIP içinde invoice.xml (öncelik) ya da düz .xml
    const s3Key = String(doc?.s3Key || '');
    if (s3Key && !s3Key.startsWith('earsiv-inline://')) {
      try {
        const buffer = await this.storage.getBuffer(s3Key);
        if (buffer?.length) {
          const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
          if (isZip) {
            const zip = await JSZip.loadAsync(buffer);
            const files = Object.values(zip.files).filter((f: any) => !f.dir && /\.(xml|ubl)$/i.test(f.name || ''));
            files.sort((a: any, b: any) => (/(invoice|ubl)\.xml$/i.test(a.name) ? 0 : 1) - (/(invoice|ubl)\.xml$/i.test(b.name) ? 0 : 1));
            for (const f of files) {
              const v = valid(this.decodeXmlEntities(Buffer.from(await f.async('uint8array')).toString('utf8')));
              if (v) return v;
            }
          } else {
            const v = valid(this.decodeXmlEntities(buffer.toString('utf8')));
            if (v) return v;
          }
        }
      } catch { /* aşağıdaki yedeklere düş */ }
    }
    // 2) eFaturaInbox.ublXmlRaw (documentId bağıyla)
    try {
      const inbox = await (this.prisma as any).eFaturaInbox.findFirst({ where: { tenantId, documentId: doc.id }, select: { ublXmlRaw: true } });
      const v = valid(inbox?.ublXmlRaw);
      if (v) return v;
    } catch { /* */ }
    // 3) earsivFatura.xmlContent (earsiv kaynaklı belgede sourceRefId bağıyla)
    if (String(doc?.source || '') === 'earsiv' && doc?.sourceRefId) {
      try {
        const f = await (this.prisma as any).earsivFatura.findFirst({ where: { tenantId, id: doc.sourceRefId }, select: { xmlContent: true } });
        const v = valid(f?.xmlContent);
        if (v) return v;
      } catch { /* */ }
    }
    return null;
  }

  /**
   * Bir belgeyi Max-vision (claudeTextViaMax görsel) ile OKUR — Azure/ücretli API GEREKMEZ,
   * Max aboneliğinden çalışır (Max-only kuralına uygun). KDV kırılımını çıkarıp fiş satırlarını üretir.
   * Kilitli KDV/OCR modülüne DOKUNMAZ. Tek belge (frontend sırayla çağırır → HTTP timeout yok).
   * ENTEGRATÖR (UBL XML) belge → görsel OKUNMAZ, içerik+yön+satıcı XML'den; yön ters dönmez.
   */
  async aiReadDocument(tenantId: string, documentId: string) {
    const d = await (this.prisma as any).invoiceAccountingDocument.findFirst({
      where: { tenantId, id: documentId },
      select: { id: true, status: true, taxpayerId: true, invoiceKind: true, documentType: true, totalAmount: true, vendorName: true, customerName: true, belgeNo: true, source: true, sourceRefId: true, mimeType: true, s3Key: true, ocrData: true },
    });
    if (!d) throw new NotFoundException('Belge bulunamadı');
    if (d.status === 'APPROVED') return { ok: false, reason: 'onaylı' };

    // Belge içeriğini fileUrl mantığıyla getir — Mihsap CDN indirme + XML→HTML render
    // ORADA çalışıyor (belge görüntüsü açılıyor). Eski özel indirme yolu "dosya yok"
    // dönüyordu; artık aynı kaynağı kullanıyoruz.
    let html = '';
    let imgBuf: Buffer | null = null;
    let imgMedia = '';
    // ENTEGRATÖR / UBL XML BELGE → içerik+yön+satıcı XML'den gelir; GÖRSEL OKUNMAZ. TÜRMOB/e-Fatura
    //   özel XSLT görselinde satıcı başlığı render OLMUYOR + "Fatura Tipi: SATIS" yazıyor → Max görseli
    //   okuyunca mükellefi satıcı sanıp YÖNÜ TERS çeviriyordu (alış→satış, cari boş). Kullanıcı yönergesi:
    //   "aktarılan faturalar zaten XML; AI ile oku YOK — sadece elle yüklenen JPEG/PDF OCR ile okunur."
    const provXml = await this.loadProviderUblXml(tenantId, d).catch(() => null);
    if (provXml) {
      imgBuf = Buffer.from(provXml, 'utf8');
      imgMedia = 'application/xml';
    } else {
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
          // İADE faturası: UBL kök öğesi CreditNote ya da InvoiceTypeCode=IADE/IPTAL (deterministik).
          //   NOT: eski /\bİADE\b/ deseni JS'te HİÇ eşleşmiyordu ('İ' \w değil → \b Türkçe harfte
          //   çalışmaz); serbest metin "iade" araması da nottaki "iade edilemez" gibi ifadelerde
          //   yanlış-pozitif veriyordu → tip koduna bağlandı.
          iade: /<\w*:?CreditNote[\s>]/i.test(xml) || /<[^>]*InvoiceTypeCode[^>]*>\s*[İI](ADE|PTAL)/i.test(xml),
          // TEVKİFAT: belgede tevkifat/WithholdingTax geçiyorsa (e-Arşiv "Fatura Tipi: TEVKIFAT").
          tevkifat: /TEVK[İIiı]FAT|WithholdingTax/i.test(xml),
          // TEVKİFAT TUTARI (UBL WithholdingTaxTotal): satışta 391'e NET KDV (hesaplanan − tevkifat) gider;
          //   tevkifatOrani buradan çıkar → "tevkifat tutarı okunamadı" çelişkisi (TEVKIFAT_NET_NEEDED) biter.
          tevkifatKdv: ubl.tevkifatKdv,
          // ÇOK-ORANLI: kırılım varsa her oranı AYRI ver (karma %10/%20 faturada şart). Yoksa tek satır.
          kdv: (Array.isArray(ubl.kdvBreakdown) && ubl.kdvBreakdown.length)
            ? ubl.kdvBreakdown.map((b) => ({ oran: b.rate, matrah: b.base, kdv: b.amount }))
            : [{ oran: ubl.kdvOrani || 0, matrah: ubl.matrah || 0, kdv: ubl.kdvTutari || 0 }],
          kalemler: ubl.kalemler,
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
    // e-ARŞİV HTML GÖMÜLÜ TUTAR → preParsed (Max ATLA). 75KB HTML'i Max'e okutmak 30-66sn sürüyordu;
    //   e-Arşiv HTML'inin içindeki render JSON'unda matrah/KDV/toplam HAZIR. Denge tutarsa onu kullan
    //   → okuma ~anında. Tutmazsa (parse null) AŞAĞIDA Max-vision'a düşer (eski davranış, bozulmaz).
    //   Sınıflandırma (giderTuru/kategori/İşletme) preParsed yolunda aiClassifyAccounting ile yapılır.
    if (!preParsed && html && html.length > 80) {
      const t = this.parseEarsivHtmlTotals(html);
      if (t) {
        const td: any = d.faturaTarihi;
        const dt = td instanceof Date && !Number.isNaN(td.getTime())
          ? `${String(td.getUTCDate()).padStart(2, '0')}.${String(td.getUTCMonth() + 1).padStart(2, '0')}.${td.getUTCFullYear()}`
          : null;
        preParsed = {
          belgeNo: d.belgeNo || null, tarih: dt,
          belgeTuru: 'e-arsiv',
          saticiAd: d.vendorName || null, saticiVkn: null,
          aliciAd: d.customerName || null, aliciVkn: null,
          toplam: t.toplam,
          // İADE: "Fatura Tipi: İADE" gibi BAĞLAMLI desen aranır (Türkçe İ→I katlanarak; eski \bİADE\b
          //   hiç eşleşmiyordu, bağlamsız "iade" ise "iade edilemez" notlarında yanlış-pozitifti).
          iade: (() => {
            const t = html.slice(0, 8000).replace(/İ/g, 'I').toUpperCase();
            return /(FATURA\s*T[IU]P[IU]?|SENARYO)\s*:?[\s\S]{0,80}?\b(IADE|IPTAL)\b/.test(t) || /\bIADE\s+FATURAS?I?\b/.test(t);
          })(),
          tevkifat: /TEVK[İIiı]FAT/i.test(html),
          kdv: t.breakdown.map((b) => ({ oran: b.oran, matrah: b.matrah, kdv: b.kdv })),
          _htmlText: html.replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000),
        };
        this.logger.log(`[HTML-HIZLI] belge=${d.belgeNo || documentId} HTML gömülü tutardan okundu (Max ATLANDI) · oran=${t.breakdown.length} toplam=${t.toplam}`);
      }
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
    let ownAd = '';  // mükellefin kendi ünvanı → "satıcı/alıcı adı mükellefin kendisi mi" güvenlik ağı için
    let tpNace = '';      // isletmeAutoKayitTuru için
    let tpFaaliyet = '';  // isletmeAutoKayitTuru için
    let tpForAsset: any = null; // detectFixedAsset için (demirbaş↔tevkifat çelişkisini önlemek üzere aşağıda kullanılır)
    if (d.taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({
        where: { id: d.taxpayerId, tenantId },
        select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true, defterTuru: true, mihsapDefterTuru: true, taxNumber: true, identityNumber: true },
      }).catch(() => null);
      if (tp) {
        tpForAsset = tp;
        ownVkn = String(tryDecrypt(tp.taxNumber) || tp.taxNumber || tryDecrypt(tp.identityNumber) || tp.identityNumber || '').replace(/\D/g, '');
        const ad = String(tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`).trim();
        ownAd = ad;
        isIsletmeMukellef = isIsletmeLedger(tp.defterTuru, tp.mihsapDefterTuru);
        const defter = isIsletmeMukellef ? 'İşletme defteri' : 'Bilanço usulü';
        tpNace = String(tp.naceKodu || '').trim();
        tpFaaliyet = String(tp.faaliyetAciklama || '').trim();
        // Öncelik: serbest faaliyet açıklaması (en güvenilir) > NACE kodu > ünvan.
        mukellefBilgi = [
          ad && `ünvanı "${ad}"`,
          tpFaaliyet ? `faaliyeti: ${tpFaaliyet}` : (tpNace && `NACE faaliyet kodu ${tpNace}`),
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
        // HIZ: aday listesi kısa tutulur (220→100) + ad 40 karaktere kırpılır → Max prompt'u küçülür,
        //   okuma hızlanır. En olası kodlar zaten ilk sıralarda (leaf filtresi sonrası), doğruluk düşmez.
        if (cand.length) planAdaylar = cand.slice(0, 100).map((a) => `${a.accountCode} = ${String(a.accountName || '').slice(0, 40)}`).join('\n');
      }
    }
    const islSeg = isIsletmeMukellef ? islPromptSeg(d.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS') : '';
    const yonBilgi = d.invoiceKind === 'SATIS'
      ? 'SATIŞ — mükellef bu faturada SATICI konumundadır'
      : 'ALIŞ — mükellef bu faturada ALICI konumundadır';
    const prompt = [
      islSeg,
      isImage
        ? 'Aşağıdaki görüntü bir Türk faturası veya yazarkasa fişidir. İçindeki bilgileri oku.'
        : 'Aşağıda bir Türk e-Fatura/e-Arşiv belgesinin HTML/metin içeriği var. İçindeki bilgileri oku.',
      `⚡⚡ KRİTİK YÖN — BU FATURA MÜKELLEF AÇISINDAN: ${yonBilgi}. Tüm yorumu, kategoriyi ve sınıflandırmayı MÜKELLEFİN BU YÖNÜNE göre yap. ⛔ Belgenin üstünde "Fatura Tipi: SATIŞ", "Senaryo: ... SATIŞ" gibi ibareler görebilirsin — bu NORMALDİR ve SATICININ bakışıdır (her satıcı kendi açısından "satış" faturası keser). Bu ibare mükellefin yönünü ASLA değiştirmez. ${yonBilgi.startsWith('ALIŞ') ? 'Mükellef burada ALICIDIR — mal/hizmeti SATIN ALIYOR, ÖDÜYOR; yorumu "almış/gideridir/stoğuna girmiştir" diliyle yaz, ASLA "sattı/geliri/hasılatı" deme.' : 'Mükellef burada SATICIDIR — gelir/hasılat söz konusudur.'}`,
      'YALNIZCA şu JSON\'u döndür — kod bloğu, açıklama, başka metin YOK:',
      `{"belgeNo":"<fatura/fiş no ya da null>","tarih":"<GG.AA.YYYY ya da null>","belgeTuru":"<e-arsiv|e-fatura|fis|diger>","saticiAd":"<satıcı ünvanı ya da null>","saticiVkn":"<satıcının VKN/TCKN ya da null>","aliciAd":"<alıcı ünvanı ya da null>","aliciVkn":"<alıcının VKN/TCKN ya da null>","toplam":<genel toplam KDV dahil sayı ya da null>,"kategori":"<asagidaki tek deger>","giderTuru":"<ALIŞ ise faturadaki ana mal/hizmetin kısa adı — aşağıdaki giderTuru kuralına göre; SATIŞ ya da net değilse boş>"${isIsletmeMukellef ? ',"isletmeKayitTuru":"<aşağıdaki İŞLETME listesinden TAM kayıt türü adı; net değilse boş>","isletmeAltTuru":"<o türün listesinden TAM alt adı; net değilse boş>","isletmeNeden":"<tek cümle gerekçe>"' : ''},"muhasebeNeden":"<1 cümle Türkçe muhasebe gerekçesi — aşağıdaki kurala göre>"${planAdaylar ? ',"matrahHesapKodu":"<aşağıdaki HESAP PLANI listesinden matrah/gider için EN UYGUN TAM kod; emin değilsen boş>"' : ''},"kalemler":[{"ad":"<mal/hizmet kalem adı>","tutar":<o kalemin KDV hariç tutarı sayı>,"oran":<o kalemin KDV oranı sayı>}],"kdv":[{"oran":<KDV yüzdesi sayı>,"matrah":<KDV hariç tutar sayı>,"kdv":<KDV tutarı sayı>}]}`,
      'kalemler: faturadaki mal/hizmet satırlarını listele (kalem adı + KDV hariç tutarı + KDV oranı). ⚠️ ÇOK KALEMLİYSE (>15 satır) MUTLAKA KDV oranına ve benzer ürün grubuna göre BİRLEŞTİR — en fazla 15 nesne döndür (ör. "%1 gıda ürünleri", "%20 temizlik/sarf"). Az kalemliyse her satır ayrı. Bu döküm BİLGİ amaçlıdır (muhasebe satırlarını değiştirmez). Okunamazsa boş dizi [].',
      'belgeTuru: belgenin üstündeki ibareye göre → "e-arsiv" (e-Arşiv Fatura), "e-fatura" (e-Fatura), "e-smm" (Serbest Meslek Makbuzu / SMM), "fis" (yazarkasa/ÖKC fişi), yoksa "diger".',
      'JSON\'a "iade": true/false ekle — belge bir İADE FATURASI / İPTAL / CreditNote ise true (üstte "İADE", "İADE FATURASI" yazar ya da senaryo İADE/IPTAL\'dir), normal satış/alış faturasıysa false.',
      'JSON\'a "tevkifat": true/false ekle — belgede KDV TEVKİFATI varsa true (Fatura Tipi: TEVKIFAT, ya da "KDV TEVKİFAT (%..)=... TL" satırı/Diğer Vergiler\'de tevkifat), yoksa false.',
      'JSON\'a "tevkifatKdv": <tevkifata düşen KDV tutarı (TL) sayı, yoksa 0> ekle — belgede "Hesaplanan KDV Tevkifat", "KDV TEVKİFAT(%..)=... TL" ya da "Tevkifata Tabi İşlem Üzerinden Hes. KDV"den ALIKONAN/tevkif edilen KDV kısmı. Örn "KDV TEVKİFAT(%20,00)=520,00 TL" → 520. ⚠️ Belgede bu kalıp YOKSA ama "Hesaplanan KDV" (TAM) ile "Ödenecek KDV" (ya da "Ödenecek Tutar"daki net KDV) AYRI AYRI yazıyorsa, tevkifatKdv = Hesaplanan KDV − Ödenecek KDV (her iki tutarı da belgede GERÇEKTEN gördüysen; tahmin etme). Tevkifat yoksa 0.',
      'JSON\'a "stopajTutari": <sayı, yoksa 0> ekle — belge bir SERBEST MESLEK MAKBUZU (SMM) ise üzerindeki "Gelir Vergisi Stopajı" / "GV Stopajı" / "Stopaj (%20)" KESİNTİ tutarı (TL). Belgede bu tutarı GERÇEKTEN görmediysen ya da belge SMM değilse 0 — tahmin etme, brütten hesaplama.',
      'saticiAd/aliciAd: SATICI (faturayı kesen) ve ALICI (SAYIN/müşteri) ünvanları. saticiVkn/aliciVkn: bu tarafların VKN (10 hane) ya da TC (11 hane) — SADECE rakam. Yazarkasa fişinde satıcı = mağaza. toplam: genel/ödenecek toplam (KDV dahil). Bulamazsan null, UYDURMA.',
      'KURALLAR: Türk sayı biçimi "1.234,56" = 1234.56 (tümünü ondalıklı sayıya çevir). Birden çok KDV oranı varsa her oran ayrı nesne. matrah=KDV hariç tutar, kdv=o orana ait KDV. ÖTV/ÖİV/tevkifat varsa matrahı şişirme — gerçek mal/hizmet matrahını ver. Okunamayan alanı null bırak, UYDURMA.',
      'kategori: mükellefin İŞİNE + fatura içeriğine göre TEK kelime seç → "ticari_mal" (SADECE mükellefin alıp AYNEN SATARAK ticaretini yaptığı emtia/stok), "hammadde" (üretimde kullanılan ilk madde/malzeme), "demirbas" (makine/cihaz/ekipman/mobilya/bilgisayar gibi sabit kıymet alımı), "pazarlama" (reklam/ilan/kargo-nakliye/pazarlama), "genel_gider" (kira/elektrik/su/doğalgaz/telefon/internet/akaryakıt/danışmanlık/kırtasiye/yemek/abonelik VE mükellefin satmadığı tüketim/SARF malzemesi: ambalaj, tek-kullanımlık, temizlik, servis malzemesi). EMİN DEĞİLSEN "genel_gider". ⚠️ Mükellef MAL TİCARETİ yapmıyorsa (hizmet/eğitim/lokanta/ofis) aldığı malzeme "ticari_mal" DEĞİLDİR — bunları satmıyor, kendi işinde tüketiyor → "genel_gider" (üretim girdisiyse "hammadde").',
      'giderTuru: ALIŞ ise faturadaki ANA mal/hizmetin kısa adı — hesap planındaki gider hesabı adıyla eşleşecek tek-iki kelime: ör. yakıt/motorin/benzin → "akaryakıt"; ayrıca "kira", "elektrik", "su", "doğalgaz", "telefon", "internet", "kırtasiye", "danışmanlık", "nakliye", "yemek", "temizlik", "bakım onarım", "sigorta", "reklam" vb. Yazarkasa fişinde de ürüne bak (benzinlik → akaryakıt). ⚠️ ARAÇ/TAŞIT KİRALAMA bedeli → giderTuru "araç kiralama" yaz (SADECE "kira" YAZMA — "kira" yalnız işyeri/gayrimenkul kirasıdır, araç kirası ayrıdır). Net değilse "" (boş). SATIŞ ise "".',
      `muhasebeNeden: Bir mali müşavirin ağzından, MÜKELLEFİN BAKIŞ AÇISINDAN AKICI ve DOĞAL Türkçe 1-2 cümlelik değerlendirme (kalıp/şablon DEĞİL — gerçekten yorumla). YÖN KESİN: ${yonBilgi}. ALIŞ ise: mükellefin ALDIĞI mal/hizmetin işi için ne ifade ettiğini yaz (gider mi? stok/ticari_mal mı? hammadde mi? demirbaş mı?) — SATICI'NIN bakışıyla YAZMA. ⛔ ALIŞ faturasında şu ifadeler KESİNLİKLE YASAK (bunlar satıcıya ait, mükellef bunları ALIYOR/ÖDÜYOR): "satış geliri", "faaliyet geliri", "gelirine giren", "geliridir", "hasılat", "stok olarak satılmış", "hizmeti verilmiş/sunulmuş". Bunun yerine "...almış/tedarik etmiş", "...gideridir", "...stoğuna girmiştir", "...hammaddesidir" gibi ALICI dili kullan. SATIŞ ise: mükellefin sattığı içeriği ve gelir niteliğini yaz. ⚠️ Hesap NUMARASINI (153.01.001 gibi) YAZMA — onu sistem ekler. ⛔ MÜKELLEFİN İŞİNİ/SEKTÖRÜNÜ "BU FATURAYI ALAN MÜKELLEFİN İŞİ" satırında AÇIKÇA VERİLMEDİYSE TAHMİN ETME — "lokanta", "market", "restoran", "kafe" gibi sektör/işletme türü UYDURMA; sadece alınan mal/hizmeti ve gider niteliğini yaz (ör. "işletmenin gıda ve temizlik gideridir"). Örnek (ALIŞ, sektör bilinmiyorsa): "Firma gıda ve temizlik malzemeleri almış; işletme gideri niteliğindedir." Örnek (SATIŞ): "Müşteriye nakliye hizmeti verilmiş; firmanın ana faaliyet gelirine giren işlemdir." Belge neyse onu açıkla, UYDURMA. ⛔ İçeriğin "OKUNAMADIĞINI", "şifreli/anlaşılmaz formatta" olduğunu ya da "niteliğin belirlenemediğini" ASLA YAZMA — kalem adı neyse ona göre yorumla; gerçekten bilgi yoksa muhasebeNeden'i BOŞ ("") bırak (mazeret cümlesi kurma).`,
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
      if (az && /azure/i.test(String(az.engine || '')) && (Number(az.confidence) || 0) >= 0.3 && azHasAmt) {
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
          ? { prompt: callPrompt, images: [{ base64: imgBuf!.toString('base64'), mediaType: imgMedia }], timeoutMs: 75000, model }
          : { prompt: callPrompt, timeoutMs: 85000, model },
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
    // ENTEGRATÖR XML'de GÖRÜNTÜ okunmaz (yukarıda XML'den geldi), AMA İÇERİK SINIFLANDIRMASI ÇALIŞIR:
    //   AI, faturanın XML KALEMLERİNE (metin) bakıp giderTuru/kategori/hesabı seçer → eşleştirme içeriğe
    //   göre yapılır. Bu bir METİN çağrısıdır (görüntü-vision DEĞİL) → hızlı. (Kullanıcı: "OCR yapma ama
    //   AI çalışsın, eşleştirmeyi içeriğe göre yapsın.") 632/IPHONE/demirbaş yanlışları ayrı korumalarda.
    if (parsed === preParsed && d.taxpayerId) {
      // TEMİZ içerik: HTML-HIZLI yolunda _htmlText zaten script/style atılmış + 8000 char (sınıflandırma
      //   AI'ı 23KB ham HTML gürültüsünde boğuluyordu → NULL/boş kategori). Önce onu kullan; yoksa eski yol.
      const contentText = (parsed._htmlText || parsed._azureText || (imgBuf ? imgBuf.toString('utf8') : (html || ''))).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 9000);
      // ⚡ HIZ — DETERMİNİSTİK ATLAMA: e-Fatura/e-Arşiv'de kalemler AI'sız (XML/HTML) okunuyor. İÇERİK
      //   net bir gider türüne (nakliye/akaryakıt/elektrik/kira/kargo/müşavirlik…) uyuyorsa, ~100s'lik
      //   Max sınıflandırma çağrısını YAPMA — hesabı içerikten zaten biliyoruz (matcher'ın kullandığı
      //   giderIcerikSinifla ile aynı kural). GÜVENLİK (kullanıcı kuralı: içeriğe bakmadan atlama yok):
      //   yalnız HER kalem tanınan bir gider ise (HOMOJEN) atlanır → tek belirsiz/ticari-mal/demirbaş
      //   kalem varsa AI çalışır. İşletme defteri (kayıt türü gerekir) ve SATIŞ bu hızlı-yoldan HARİÇ.
      const detAdlar = (Array.isArray(parsed.kalemler) ? parsed.kalemler : []).map((k: any) => String(k?.ad || '').trim()).filter(Boolean);
      let detHit: { giderTuru: string; kategori: string } | null = null;
      if (!isIsletmeMukellef && d.invoiceKind !== 'SATIS' && detAdlar.length) {
        // HER kalem tanınmalı VE hepsi AYNI hint'i vermeli (yalnız kategori-eşitliği YETMEZ — İDEAL PASAJ:
        //   "komisyon" + "telefon" ikisi de genel_gider ama farklı hint; birleşince ilk-eşleşen kurala
        //   düşüp 10.833TL telefon "komisyon gideri" oluyordu). Farklı hint → detHit YOK → AI/kullanıcı.
        const hintler = new Set<string>();
        let ok = true;
        for (const ad of detAdlar) {
          const r = giderIcerikSinifla(ad);
          if (!r) { ok = false; break; }
          hintler.add(r.hint);
          if (hintler.size > 1) { ok = false; break; }
        }
        if (ok && hintler.size === 1) {
          const only = giderIcerikSinifla(detAdlar[0]);
          if (only) detHit = { giderTuru: only.hint, kategori: only.kategori };
        }
      }
      // TOPLU: aynı mükellef+plan+yön grubundaki belgeler tek Max çağrısında sınıflanır (alt-süreç N× azalır).
      const c: any = detHit
        ? {
            giderTuru: detHit.giderTuru,
            kategori: detHit.kategori,
            // Hızlı-yol (Max atlanır) muhasebeNeden'siz kalıyordu → kullanıcıya yorum boş görünüyordu;
            //   deterministik kısa gerekçe yaz (zengin yorum istenirse lazy generateRichMuhasebeNeden var).
            muhasebeNeden: `Fatura kalemleri "${detHit.giderTuru}" niteliğinde — içerik kuralıyla otomatik sınıflandırıldı.`,
          }
        : await this.aiClassifyAccountingCoalesced(contentText, mukellefBilgi, isIsletmeMukellef, d.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS', planAdaylar).catch(() => null);
      if (detHit) this.logger.log(`[CLS-SKIP] det icerik=${detHit.kategori} (${detAdlar.length} kalem) → Max ATLANDI belge=${d.belgeNo || d.id}`);
      if (c) {
        if (!parsed.giderTuru && c.giderTuru) parsed.giderTuru = c.giderTuru;
        if (!parsed.kategori && c.kategori) parsed.kategori = c.kategori;
        if (!parsed.muhasebeNeden && (c as any).muhasebeNeden) parsed.muhasebeNeden = (c as any).muhasebeNeden;
        if (c.isletmeKayitTuru) { parsed.isletmeKayitTuru = c.isletmeKayitTuru; parsed.isletmeAltTuru = c.isletmeAltTuru; parsed.isletmeNeden = c.isletmeNeden; }
        // HTML/UBL yolunda kalemler okuma adımında YOK → sınıflandırma AI'ından al (kalem dökümü +
        //   kalem-bazlı alt tür için). Zaten kalem varsa dokunma.
        if ((!Array.isArray(parsed.kalemler) || !parsed.kalemler.length) && Array.isArray((c as any).kalemler) && (c as any).kalemler.length) parsed.kalemler = (c as any).kalemler;
        // HESAP KODU REGRESYONU FIX: Max okuma atlandığında matrahHesapKodu da gelmiyordu → "gider kodu
        //   boş". Sınıflandırma AI'ı hesap planından kod seçer; mevcut akış (aiMatrahKodu) onu plana göre doğrular.
        if (!parsed.matrahHesapKodu && (c as any).matrahHesapKodu) parsed.matrahHesapKodu = (c as any).matrahHesapKodu;
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
    // let: aşağıdaki taraf-tutarlılık (ters-UBL / kendi-kendine-fatura) swap'larından SONRA yeniden
    //   senkronize edilir — DB'ye STALE (swap-öncesi) VKN yazılmasın diye (bkz. swap bloklarının sonu).
    let aiSaticiVkn = String(parsed.saticiVkn || '').replace(/\D/g, '');
    let aiAliciVkn = String(parsed.aliciVkn || '').replace(/\D/g, '');
    const vknOk = (v: string) => v.length === 10 || v.length === 11;
    // YÖN GÖRÜNTÜDEN: mükellef VKN'si satıcıyla eşleşirse SATIŞ, alıcıyla eşleşirse ALIŞ.
    // Mihsap'ın sekme/etiket bilgisine güvenmeyiz — fatura kimin adına kesilmiş, ona bakarız.
    // ENTEGRATÖR XML'inde yön zaten kanaldan KESİN (d.invoiceKind) — görüntü/VKN tahmini ile EZME
    //   (özel XSLT görselinde mükellef satıcı gibi görünüp yönü ters çeviriyordu).
    let kind: 'ALIS' | 'SATIS' = (String(d.invoiceKind || 'ALIS') === 'SATIS' ? 'SATIS' : 'ALIS');
    if (!provXml) {
      if (ownVkn && vknOk(aiSaticiVkn) && ownVkn === aiSaticiVkn) kind = 'SATIS';
      else if (ownVkn && vknOk(aiAliciVkn) && ownVkn === aiAliciVkn) kind = 'ALIS';
    } else if (kind === 'ALIS' && ownVkn) {
      // Ters UBL koruması: ALIŞ'ta satıcı=mükellef geldiyse gerçek cari = alıcı tarafıdır → çevir.
      const sV = String(parsed.saticiVkn || '').replace(/\D/g, '');
      const aV = String(parsed.aliciVkn || '').replace(/\D/g, '');
      if (sV && sV === ownVkn && (aV ? aV !== ownVkn : !!parsed.aliciAd)) {
        const ts = parsed.saticiAd, tsv = parsed.saticiVkn;
        parsed.saticiAd = parsed.aliciAd; parsed.saticiVkn = parsed.aliciVkn;
        parsed.aliciAd = ts; parsed.aliciVkn = tsv;
      }
    }
    const isSale = kind === 'SATIS';
    // AD-BAZLI GÜVENLİK AĞI (kullanıcı bulgusu — "Yorgun Nakliyat" ALIŞ faturasında cari sütununda
    //   kendi ünvanı görünüyordu): VKN doğru okunup yön (kind) doğru çıksa bile, AI/OCR satıcı↔alıcı
    //   AD bloklarını (VKN'den BAĞIMSIZ bir alan olduğu için) birbirine karıştırabiliyor — yöne göre
    //   "biz" olması gereken taraf (ALIŞ→satıcı, SATIŞ→alıcı) mükellefin KENDİ adıyla eşleşiyorsa bu
    //   mantıksal-imkansız (mükellef kendi kendine fatura kesemez) → AD'ları (VKN'lerle TUTARLI kalsın
    //   diye birlikte) swap et. kind/yöne DOKUNMA, sadece TARAF bilgisi düzelir.
    if (ownAd) {
      const expectOwnSide = isSale ? parsed.aliciAd : parsed.saticiAd;
      if (expectOwnSide && this.nameMatchScore(ownAd, String(expectOwnSide)) > 0) {
        const ts = parsed.saticiAd, tsv = parsed.saticiVkn;
        parsed.saticiAd = parsed.aliciAd; parsed.saticiVkn = parsed.aliciVkn;
        parsed.aliciAd = ts; parsed.aliciVkn = tsv;
      }
    }
    // VKN RESENKRONİZASYONU: yukarıdaki swap'lardan SONRA aiSaticiVkn/aiAliciVkn'i parsed'ten yeniden
    //   oku — aksi halde DB'ye (sellerVkn/buyerVkn, aşağıda) swap-ÖNCESİ STALE VKN yazılırdı (AD doğru
    //   ama VKN yanlış kalan bir tutarsızlık; mevcut koddaki gizli bir bug'dı, burada da düzeltildi).
    aiSaticiVkn = String(parsed.saticiVkn || '').replace(/\D/g, '');
    aiAliciVkn = String(parsed.aliciVkn || '').replace(/\D/g, '');
    // TEVKİFAT: okunan tevkifat KDV tutarından oran çıkar (520/2600=0.2). linesFromAmounts'un
    // tevkifat yolu NET KDV + ÖDENECEK cariyi doğru üretir (tam KDV/tam toplam değil).
    const tevkKdv = Number(parsed.tevkifatKdv) || 0;
    // NOT: tevkKdv === kdv (10/10 TAM tevkifat) de geçerli → <= (eskiden < ile tam tevkifat 0 sayılıp
    //   belge düz KDV'li gibi işleniyordu: 360/191-sorumlu satırı hiç kurulmuyordu).
    const tevkifatOrani = (tevkKdv > 0 && kdv > 0 && tevkKdv <= kdv) ? Math.round((tevkKdv / kdv) * 1000) / 1000 : 0;
    // Toplam = matrah + KDV (yevmiye DENGESİ: cari satırı = matrah + kdv toplamı). AI'nın okuduğu
    //   parsed.toplam KDV HARİÇ tutarı verebiliyordu → cari/totalAmount yanlış → BALANCE_MISMATCH /
    //   TOTAL_MISMATCH (EDELER'de 31 belge "çelişki"; örn total=matrah=641.82 ama gerçek 648.33).
    //   ARTIK satırlardan türetilir → yevmiye her zaman dengeli. Matrah/KDV okuma hatasını
    //   (kdv > matrah×oran) zaten KDV_MATH doğrulaması yakalar → sessiz yanlış kalmaz.
    //   Tevkifatlı SATIŞTA ödenecek = matrah + NET KDV (tevkifat sorumlu sıfatıyla beyan, cariye girmez).
    //   Tevkifatlı ALIŞTA yevmiye TAM KDV ile kurulur (191 normal+sorumlu borç, 320 net + 360 tevkifat
    //   alacak → toplam = matrah + TAM KDV); total net yazılırsa TOTAL_MISMATCH sahte çelişkisi doğar.
    const total = (tevkifatOrani > 0 && isSale)
      ? Math.round((matrah + kdv * (1 - tevkifatOrani)) * 100) / 100
      : Math.round((matrah + kdv) * 100) / 100;
    // Karşı taraf (cari) adı: satışta ALICI, alışta SATICI (yukarıdaki AD-bazlı güvenlik ağı taraf
    //   bilgisini zaten tutarlı hale getirdi — parsed.saticiAd/aliciAd artık mükellefle çakışmaz).
    const counterName = String((isSale ? parsed.aliciAd : parsed.saticiAd) || '').trim();
    // Belge türü: önce GERÇEK METİNDEN (e-Arşiv/e-Fatura ibaresi). HTML yoksa (resim/JPG fatura)
    //   Azure'un OKUDUĞU ham metinden ("e-Arşiv Fatura", "Senaryo: EARSIVFATURA" yazısı), son çare AI.
    const mappedType = this.docTypeFromText(html || azureText || parsed._azureText || '') || this.mapOcrBelgeTipi(parsed.belgeTuru) || normalizeDocumentType((d as any).documentType);
    // SMM STOPAJI (E_SMM ALIŞ): AI'nın okuduğu (ya da önceki okumada ocrData'ya yazılmış) gelir
    //   vergisi stopajı → linesFromAmounts cari'yi NET yazar + 'kesinti' 360 satırı üretir.
    //   Okunamadıysa 0 → satır üretilmez, SMM_STOPAJ_NEEDED engeli mevcut davranışıyla kalır.
    const smmStopaj = (!isSale && String(mappedType || '').toUpperCase() === 'E_SMM')
      ? (Number(parsed.stopajTutari) || Number((d.ocrData as any)?.stopajTutari) || 0)
      : 0;

    // SATICI-EMSAL TUTARLILIĞI (kullanıcı kuralı: "aynı satıcı hep aynı sonuç"): aynı mükellef + aynı
    //   satıcı VKN'nin KALEM-ÖRTÜŞEN önceki belgesindeki kategoriyi yeni okumaya uygula. AMA GÜVENLİ:
    //   (1) yalnız ONAYLI emsale güven (kullanıcı düzeltip onayladıysa = gerçek); onaysız emsal AI'ın
    //       kendi salınımı olabilir, ona kilitlenmek "yanlışı sabitler" → onaysız-yoksa DOKUNMA.
    //   (2) örtüşme ≥2 AYIRT EDİCİ ortak token (jenerik/STOP kelimeler elenir) — tek "kutu/adet/2024"
    //       ortaklığı emsal saymaz. (3) onaylılar arasında kategori ÇOĞUNLUK; çoğunluk yoksa dokunma.
    //   (4) tie-break deterministik (id) → aynı belge iki okumada aynı sonuç.
    if (kind === 'ALIS' && d.taxpayerId && vknOk(aiSaticiVkn) && Array.isArray(parsed.kalemler) && parsed.kalemler.length) {
      try {
        const EMSAL_STOP = new Set(['adet', 'kutu', 'paket', 'urun', 'urunler', 'mamul', 'fiyat', 'tutar', 'birim', 'siyah', 'beyaz', 'renk', 'model', 'seti', 'takim', 'parca', 'kalem', 'malzeme', 'hizmet', 'genel', 'toplam', 'iskonto']);
        const foldTok = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
        const tokSet = (ks: any[]) => new Set(
          (ks || []).flatMap((k: any) => foldTok(String(k?.ad || '')).split(/[^a-z0-9]+/))
            .filter((t: string) => t.length >= 4 && !/^\d+$/.test(t) && !EMSAL_STOP.has(t)),
        );
        const curToks = tokSet(parsed.kalemler);
        if (curToks.size) {
          const emsaller = await (this.prisma as any).invoiceAccountingDocument.findMany({
            where: { tenantId, taxpayerId: d.taxpayerId, invoiceKind: 'ALIS', sellerVkn: aiSaticiVkn, id: { not: d.id }, status: 'APPROVED' },
            orderBy: { id: 'asc' }, // deterministik (updatedAt değil → aynı belge hep aynı emsal kümesi)
            select: { id: true, ocrData: true },
            take: 40,
          }).catch(() => []);
          const adaylar = (emsaller || []).map((e: any) => {
            const eo = (e.ocrData as any) || {};
            const kat = String(eo.matrahKategori || eo.kategori || '').trim();
            if (!kat) return null;
            const et = tokSet(eo.kalemler || []);
            const ortak = [...et].filter((tk) => curToks.has(tk as string)).length;
            return ortak >= 2 ? { kat, giderTuru: String(eo.giderTuru || '').trim() } : null;
          }).filter(Boolean) as Array<{ kat: string; giderTuru: string }>;
          // Onaylı emsaller arasında kategori ÇOĞUNLUĞU (tek net kazanan yoksa dokunma).
          const say = new Map<string, { n: number; giderTuru: string }>();
          for (const a of adaylar) { const p = say.get(a.kat) || { n: 0, giderTuru: a.giderTuru }; p.n++; if (!p.giderTuru && a.giderTuru) p.giderTuru = a.giderTuru; say.set(a.kat, p); }
          const sirali = [...say.entries()].sort((x, y) => y[1].n - x[1].n || (x[0] < y[0] ? -1 : 1));
          const kazanan = sirali[0];
          const netKazanan = kazanan && (sirali.length === 1 || kazanan[1].n > sirali[1][1].n);
          if (netKazanan && kazanan[0] && String(parsed.kategori || '') !== kazanan[0]) {
            this.logger.log(`[EMSAL] belge=${d.belgeNo || d.id} satici=${aiSaticiVkn} kategori '${parsed.kategori || 'boş'}' → '${kazanan[0]}' (${kazanan[1].n} onaylı emsal)`);
            parsed.kategori = kazanan[0];
            if (!parsed.giderTuru && kazanan[1].giderTuru) parsed.giderTuru = kazanan[1].giderTuru;
          }
        }
      } catch { /* emsal bakılamadıysa mevcut karar kalır */ }
    }
    // Z RAPORU: karşı taraf müşteri (120) DEĞİL, 100 Kasa (+108 POS) — bayrak geçilmeyince "AI ile
    //   oku" yeniden okumada nakit/kart ayrımı kaybolup normal cari satırı kuruluyordu.
    const zRep = kind === 'SATIS' && String(mappedType || d.documentType || '').toUpperCase() === 'Z_RAPORU';
    const zPay = zRep ? this.parseZPayments(String(azureText || (parsed as any)._azureText || (parsed as any)._htmlText || html || ''), total) : null;
    const lines = await this.gateCodesByPlan(tenantId, d.taxpayerId, this.linesFromAmounts({
      invoiceKind: kind,
      matrah, kdvTutari: kdv, kdvOrani: breakdown[0].rate, total,
      vendorName: counterName || (isSale ? d.customerName : d.vendorName),
      kdvBreakdown: breakdown,
      tevkifatOrani: tevkifatOrani || null,
      smmStopaj: smmStopaj > 0 ? smmStopaj : null,
      ...(zRep ? { zRaporu: true, nakit: zPay?.nakit || 0, kart: zPay?.kart || 0 } : {}),
    }));
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.invoiceAccountingLine.deleteMany({ where: { documentId: d.id } });
      if (lines.length) await tx.invoiceAccountingLine.createMany({ data: lines.map((l: any) => ({ ...l, documentId: d.id })) });
      // İŞLETME: AI'ın faaliyet+içerik muhakemesiyle verdiği kayıt türü + alt türü.
      // resolveIslAi → undefined ise faaliyet+içerik tabanlı ön seçim (son çare).
      let islSinifAi = isIsletmeMukellef ? resolveIslAi(kind, parsed) : undefined;
      // ÖĞRENİLMİŞ İŞLETME SINIFI (kullanıcı-teyitli, eşikli) AI tahmininden ÖNCE gelir:
      //   müşavir bu satıcının kayıt türünü bir kez düzelttiyse sonraki faturalar hafızadan sınıflanır.
      if (isIsletmeMukellef && d.taxpayerId) {
        const islVkn = String((kind === 'ALIS' ? d.sellerVkn : d.buyerVkn) || '').replace(/\D/g, '');
        const islMemImza = VendorMemoryService.buildIcerikImza(Array.isArray(parsed.kalemler) ? parsed.kalemler.map((k: any) => k?.ad) : []);
        const islMem = islVkn ? await this.pickIsletmeMemory(tenantId, d.taxpayerId, islVkn, islMemImza).catch(() => null) : null;
        if (islMem) {
          const memRef = isletmeRef(kind);
          const memKt = memRef.kayitTuru.find((x: any) => x.kod === islMem.kayitTuruKod);
          if (memKt) {
            const memAltList = getKayitAltList(kind, islMem.kayitTuruKod);
            const memAlt = islMem.kayitAltKod ? memAltList.find((x: any) => x.kod === islMem.kayitAltKod) : null;
            islSinifAi = {
              kayitTuruKod: memKt.kod, kayitTuruAd: memKt.ad,
              kayitAltKod: memAlt?.kod || '', kayitAltAd: memAlt?.ad || '',
              autoMatched: true, neden: 'Bu satıcı için öğrenilmiş sınıf (müşavir onaylı)',
            };
          }
        }
      }
      if (!islSinifAi && isIsletmeMukellef) {
        const gs = kind === 'ALIS'
          ? isletmeGiderSinifi({ matrahKategori: parsed.kategori, giderTuru: parsed.giderTuru, vendorName: counterName, documentType: mappedType || parsed.belgeTuru })
          : null;
        const fbKtKod = kind === 'ALIS' ? (gs?.kayitTuruKod || '') : isletmeAutoKayitTuru(kind, tpNace || null, tpFaaliyet || null);
        if (fbKtKod) {
          const ref = isletmeRef(kind);
          const fbKt = ref.kayitTuru.find((x: any) => x.kod === fbKtKod);
          if (fbKt) {
            const islText2 = [parsed.giderTuru, counterName, ...(Array.isArray(parsed.kalemler) ? parsed.kalemler.map((k: any) => k?.ad) : [])].filter(Boolean).join(' ');
            const fbAltKod = gs?.kayitAltKod || (fbKtKod === '4' ? isletmeAutoKayitAltKod(kind, '4', islText2) : (defaultKayitAltKod(kind, fbKtKod, fbKt.ad) || ''));
            const altList = getKayitAltList(kind, fbKtKod);
            const fbAlt = fbAltKod ? altList.find((x: any) => x.kod === fbAltKod) : null;
            islSinifAi = { kayitTuruKod: fbKtKod, kayitTuruAd: fbKt.ad, kayitAltKod: fbAlt?.kod || '', kayitAltAd: fbAlt?.ad || '', autoMatched: true, neden: 'Faaliyet/içerik tabanlı ön seçim' };
          }
        }
      }
      if (islSinifAi) {
        const islIade = parsed.iade === true || /iade|iptal/i.test(String(parsed.belgeTuru || ''));
        const islTevk = parsed.tevkifat === true || tevkifatOrani > 0 || /TEVK[İIiı]FAT/i.test(String(html || ''));
        const islText = [parsed.giderTuru, islSinifAi.kayitAltAd, parsed.muhasebeNeden, ...(Array.isArray(parsed.kalemler) ? parsed.kalemler.map((k: any) => k?.ad) : [])].filter(Boolean).join(' ');
        islSinifAi = {
          ...islSinifAi,
          alisSatisKod: isletmeAlisSatisTuru(kind, { isReturn: islIade, tevkifat: islTevk, kdvVar: kdv > 0, text: islText }),
          islemTuruKod: isletmeIslemTuru(kind, islText),
          belgeTuruKod: defaultBelgeTuruKod(mappedType || parsed.belgeTuru, kind),
        };
      }
      // DEMİRBAŞ↔TEVKİFAT ÇELİŞKİSİ (kullanıcı bulgusu): okuma anında demirbaş tespiti SATIŞ HARİÇ
      //   yapılır (detectFixedAsset rematch'teki kullanımıyla aynı kural) — demirbaşsa tevkifat
      //   kontrolü denetimUyariOlustur içinde atlanır (bkz. isFixedAsset).
      const faDetForUyari = (kind !== 'SATIS')
        ? this.detectFixedAsset({ kalemler: parsed.kalemler, giderTuru: parsed.giderTuru, muhasebeNeden: parsed.muhasebeNeden }, tpForAsset)
        : { is: false, reason: '' };
      // İADE GÜVENLİK AĞI (kullanıcı bulgusu — UBL "Fatura Tipi: IADE" yazan bir belge normal ALIŞ gibi
      //   işlenmişti): görüntü/PDF yolunda iade tespiti SADECE AI'nin "iade" JSON alanına dayanıyordu
      //   (XML/HTML yollarındaki gibi deterministik regex YOKTU). Azure'un OKUDUĞU HAM METİN (azureText/
      //   parsed._azureText) — vision-modelin "önemli" sandığı kısma odaklanma sorunu olmayan, OCR ile
      //   çıkarılmış TÜM metin — üzerinde de "İADE/IPTAL" arandığında bu tür kaçırmaları yakalar.
      const azNormForIade = String(azureText || (parsed as any)._azureText || '').replace(/İ/g, 'I').toUpperCase();
      const isReturnDet = parsed.iade === true
        || /iade|iptal/i.test(String(parsed.belgeTuru || ''))
        // BAĞLAMLI iade deseni: eski \bİADE\b JS'te hiç eşleşmiyordu ('İ' \w değil); bağlamsız "iade"
        //   ise "iade edilemez / iade ve değişim şartları" notlarında yanlış-pozitif veriyordu.
        || /(FATURA\s*T[IU]P[IU]?|SENARYO)\s*:?\s*\b(IADE|IPTAL)\b/.test(azNormForIade)
        || /\bIADE\s+FATURAS?I?\b/.test(azNormForIade);
      const _uyarilar = denetimUyariOlustur({
        invoiceKind: kind,
        matrah,
        kdvTutari: kdv,
        giderTuru: typeof parsed.giderTuru === 'string' ? parsed.giderTuru : '',
        kalemAciklamalari: Array.isArray(parsed.kalemler) ? parsed.kalemler.map((k: any) => String(k?.ad || '')) : [],
        muhasebeNeden: typeof parsed.muhasebeNeden === 'string' ? parsed.muhasebeNeden : '',
        kdvOrani: breakdown[0]?.rate ?? 0,
        tevkifatVar: parsed.tevkifat === true || tevkifatOrani > 0 || /tevkifat/i.test(String(html || '')),
        isFixedAsset: faDetForUyari.is,
      });
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
          ocrData: { ...((d.ocrData as any) || {}), matrah, kdvTutari: kdv, kdvOrani: breakdown[0].rate, kdvBreakdown: breakdown.map((b: any) => ({ oran: b.rate, matrah: b.base, tutar: b.amount })), matrahKategori: typeof parsed.kategori === 'string' ? parsed.kategori : undefined, giderTuru: typeof parsed.giderTuru === 'string' ? parsed.giderTuru.slice(0, 40) : undefined, muhasebeNeden: this.cleanBaseNeden(parsed.muhasebeNeden).slice(0, 300) || undefined, aiYorum: this.cleanBaseNeden(parsed.muhasebeNeden).slice(0, 400) || undefined, aiMatrahKodu: (() => {
                const aiKod = typeof parsed.matrahHesapKodu === 'string' ? String(parsed.matrahHesapKodu).trim() : '';
                return (aiKod && planLeafSet.has(aiKod)) ? aiKod : undefined;
              })(), kalemler: Array.isArray(parsed.kalemler) ? parsed.kalemler.slice(0, 30).map((k: any) => ({ ad: String(k?.ad || '').slice(0, 80), tutar: Number(k?.tutar) || 0, oran: Number(k?.oran) || 0 })).filter((k: any) => k.ad) : undefined, ...(islSinifAi ? { isletme: islSinifAi } : {}), isReturn: isReturnDet, tevkifatHint: parsed.tevkifat === true || tevkifatOrani > 0 || /tevkifat/i.test(String(html || '')), tevkifatOrani: tevkifatOrani || 0, tevkifatKdv: tevkKdv || 0, ...(smmStopaj > 0 ? { stopajTutari: smmStopaj } : {}), engine: parsed._azure ? 'azure-read' : (parsed === preParsed ? 'ubl-xml' : 'max-vision'),
            readMode: parsed === preParsed ? 'ubl-xml' : (isImage ? 'image' : /pdf/i.test(imgMedia) ? 'pdf-text' : /xml/i.test(imgMedia) ? 'xml-text' : 'html'),
            ...(!preParsed && imgBuf && /xml/i.test(imgMedia) ? { xmlHead: imgBuf.toString('utf8').slice(0, 220).replace(/\s+/g, ' ') } : {}),
            // uyarilar KOŞULSUZ yazılır: yeni okuma uyarı üretmediyse ESKİ okumanın bayat uyarısı
            //   (ör. yanlış TEV_NAKL) spread'ten sağ çıkıp silinemez hale geliyordu (İDEAL PASAJ vakası).
            uyarilar: _uyarilar.length ? _uyarilar : undefined },
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
  // PAYLAŞILAN SINIFLANDIRMA KURALLARI — tekil (aiClassifyAccounting) ve toplu (aiClassifyAccountingMulti)
  //   AYNI kuralları kullansın diye TEK kaynak (drift olmasın; kullanıcı bu kuralları sık ayarlıyor).
  private classifyHeadSegments(mukellefBilgi: string, invoiceKind?: 'ALIS' | 'SATIS'): string[] {
    const yon = invoiceKind === 'SATIS'
      ? 'YÖN KESİN SATIŞ: Mükellef bu faturada SATICI konumundadır. Hasılat/gelir söz konusu.'
      : 'YÖN KESİN ALIŞ: Mükellef bu faturada ALICI konumundadır — karşı taraftan aldığı hizmet/mal için gider ödüyor. muhasebeNeden\'de "satış geliri", "hizmet sunulması", "faaliyet geliri", "geliridir" ifadeleri YASAK; gider/maliyet bakışıyla yaz.';
    // MALİ MÜŞAVİR MUHAKEMESİ — ezbere/yüzeysel kelime eşleştirmesi DEĞİL, adım adım düşün:
    const muhakeme = 'Sen DENEYİMLİ bir MALİ MÜŞAVİRSİN. SIRAYLA muhakeme et: '
      + '(1) Mükellefin FAALİYETİ ne (ne iş yapıyor)? '
      + '(2) Faturada NE alınmış/satılmış — kalemlerin GERÇEK içeriği ne? '
      + '(3) Bu işlemin MUHASEBE NİTELİĞİ ne: mükellefin satıp ticaretini yaptığı emtia mı (ticari mal), üretim girdisi mi (hammadde), uzun ömürlü sabit kıymet mi (demirbaş), yoksa hangi GİDER türü mü (nakliye/akaryakıt/araç bakım/kira/elektrik/müşavirlik/sigorta/komisyon/genel yönetim…) / SATIŞ ise hangi GELİR türü mü? '
      + '(4) Bu niteliğe KARŞILIK GELEN hesabı, mükellefin GERÇEK hesap planından seç. Seçtiğin hesabın ALT hesapları varsa İÇERİK + KDV oranına göre EN UYGUN alt hesabı seç (yüzeysel isim benzerliği YETMEZ; nitelik uymalı). '
      + 'Niteliğe gerçekten uyan hesap planda YOKSA BOŞ bırak — uydurma, zorlama, yanlış hesaba YAZMA.';
    return [muhakeme, yon, mukellefBilgi ? `Faturanın tarafı olan mükellef: ${mukellefBilgi}.` : ''].filter(Boolean);
  }
  private classifyBodySegments(isIsletme: boolean, invoiceKind?: 'ALIS' | 'SATIS', planAdaylar?: string): string[] {
    return [
      'giderTuru: ALIŞ ise faturadaki ANA mal/hizmetin kısa adı (yakıt/motorin→"akaryakıt"; ayrıca "elektrik","su","doğalgaz","telefon","internet","kira","kırtasiye","danışmanlık","nakliye","yedek parça","bakım onarım","yemek","temizlik","sigorta","reklam" vb). Net değilse "". SATIŞ ise "".',
      'kategori: mükellefin ANA FAALİYETİNE göre → "ticari_mal" (SADECE mükellefin SATARAK ticaretini yaptığı emtia), "hammadde" (üretim girdisi), "demirbas" (makine/cihaz/sabit kıymet), "pazarlama" (reklam/kargo/nakliye), "genel_gider" (kira/elektrik/sarf/abonelik + satılmayan tüketim/sarf malzemesi). Emin değilsen "genel_gider". ⚠️ KRİTİK — LOKANTA/RESTORAN/KAFE/PASTANE/YEMEK ÜRETİM/CATERING işletmesinin aldığı GIDA / MUTFAK MALZEMESİ (et, tavuk, sebze, meyve, süt, peynir, yumurta, un, yağ, baharat, içecek, ekmek, bakliyat) = "hammadde" (üründe kullanılan girdi); ASLA "genel_gider" DEĞİL. ⚠️ Mükellefin SATMADIĞI cihaz/klima/makine/ekipman/mobilya/bilgisayar = "demirbas", ASLA "ticari_mal" değil (lokanta klima alırsa demirbas). ⚠️ "demirbas" YALNIZ uzun ömürlü bir sabit kıymetin KOMPLE SATIN ALIMIDIR (makine/araç/römork/cihaz/mobilya). YEDEK PARÇA, BAKIM, ONARIM, SERVİS, DİAGNOSTİK, LASTİK, AKARYAKIT, İŞÇİLİK = GİDER (genel_gider; araçla ilgiliyse "araç bakım"), demirbaş DEĞİLDİR. ⚠️ Mükellef MAL TİCARETİ/ÜRETİMİ yapmıyorsa (saf hizmet/eğitim/ofis) aldığı tüketim/sarf malzemesi (ambalaj, tek-kullanımlık, temizlik, kırtasiye, servis) = "genel_gider", ASLA "ticari_mal" değil. Araç/taşıt kiralama = "genel_gider" ama giderTuru "araç kiralama" (kira değil). ⚠️ LOKANTA örneği GENELLENİR — HER ÜRETİM/İMALAT işletmesinde (tabela/reklam imalatı, matbaa, mobilya, tekstil, metal işleme…) ürüne GİREN malzeme (pleksi, dekota, folyo, LED modül, alüminyum levha/profil, boya, kumaş, ahşap, sac…) = "hammadde"; reklam İMALATÇISININ aldığı pleksi/LED reklam GİDERİ ("pazarlama") DEĞİLDİR. ⚠️ Kategoriyi KALEM İÇERİĞİNDEN türet — SATICININ ünvanı/sektörü tek başına belirleyici DEĞİL (hırdavatçıdan alınan "şarjlı alet seti" alet/ekipmandır, "danışmanlık" olamaz; ünvanda "hizmet/danışmanlık" geçmesi kalemi hizmet yapmaz).',
      'kalemler: faturadaki mal/hizmet satırlarını listele (ad + KDV hariç tutar + KDV oranı sayı). ÇOK KALEMLİYSE (>15) KDV oranına ve benzer ürün grubuna göre BİRLEŞTİR — en fazla 15 nesne (ör. "%1 gıda ürünleri", "%20 temizlik"). Okunamazsa [].',
      'muhasebeNeden: Bir mali müşavir ağzından AKICI, DOĞAL Türkçe 1-2 cümlelik değerlendirme (kalıp DEĞİL — gerçekten yorumla). Faturada özetle NE alınmış/satılmış ve mükellefin faaliyetine göre bu NİYE o nitelikte (ticari mal / hammadde / demirbaş / gider). İçerik faaliyetle uyumsuzsa nedenini söyle. ⚠️ "alış"/"satış" kelimesini ve hesap NUMARASINI YAZMA — yönü ve kesin hesabı sistem ekler; sen YALNIZ içeriği ve niteliği yorumla. ⛔ İçeriğin "OKUNAMADIĞINI", "şifreli/anlaşılmaz formatta" olduğunu ya da "niteliğin belirlenemediğini" ASLA YAZMA — kalem adı neyse (ör. "plaka", "danışmanlık") ona göre yorumla; gerçekten hiçbir bilgi yoksa muhasebeNeden\'i BOŞ ("") bırak (mazeret cümlesi kurma). ⚠️ KİŞİSEL/KKEG: içerik mükellefin FAALİYETİYLE ALAKASIZ kişisel/şahsi tüketimse (ör. NAKLİYECİNİN aldığı kozmetik/makyaj/saç-cilt bakım/parfüm/şampuan, şahsi giyim, kişisel gıda) bunu "kişisel harcama; kanunen gider yazılamaz (KKEG), müşavir manuel değerlendirmeli" diye açıkça belirt ve matrahHesapKodu\'nu BOŞ bırak (uygun gider hesabı yoktur — plandan hesap SEÇME). Örnek: "Faturada ofis için yazıcı ve toner alınmış; işte kullanılan sabit kıymet/demirbaş niteliğindedir."',
      isIsletme ? islPromptSeg(invoiceKind) : 'isletmeKayitTuru ve isletmeAltTuru = "" bırak (mükellef İşletme defteri değil).',
      planAdaylar ? `\nMÜKELLEFİN HESAP PLANI — matrah/gider için aday hesaplar (matrahHesapKodu'nu SADECE bu listeden seç):\n${planAdaylar}\n→ matrahHesapKodu seçimi İKİ ADIM: (A) yukarıda belirlediğin NİTELİĞE göre DOĞRU ANA grubu bul — mükellefin SATARAK ticaret yaptığı emtia → stok (15x); ÜRETİMDE kullandığı girdi (LOKANTA gıda/mutfak malzemesi) → ilk madde/üretim maliyeti (15x/74x); kendi işinde tükettiği gider → ilgili GİDER (7xx/6xx); uzun ömürlü makine/cihaz/demirbaş → sabit kıymet (25x); SATIŞ ise gelir (60x). (B) O grubun ALT HESAPLARINDAN, faturanın İÇERİĞİNE (ne alınmış) + KDV ORANINA göre EN UYGUN TAM kodu seç — ör. "araç bakım" niteliği için adında "araç/taşıt bakım" geçen alt hesabı; çok-oranlıysa o orana ait alt hesabı. ⚠️ Yüzeysel kelime benzerliği (kira≈kiralama, "genel"≈"genel yönetim 632") YETMEZ — NİTELİK uymalı; 6xx GELİR-TABLOSU/YANSITMA hesaplarına (630/631/632) ALIŞ gideri YAZMA, gider 7xx maliyet hesabına gider. ⚠️ İÇERİĞE GERÇEKTEN uyan hesap planda YOKSA BOŞ bırak — listede OLMAYAN kodu ASLA yazma. ⚠️ TUTARLI OL: aynı tür içerik (ör. nakliye) HER faturada aynı hesaba gitsin, zıplama.` : '',
    ].filter(Boolean);
  }
  private classifyJsonShape(planAdaylar?: string): string {
    return `{"giderTuru":"","kategori":"","isletmeKayitTuru":"","isletmeAltTuru":"","isletmeNeden":"","muhasebeNeden":"","kalemler":[{"ad":"","tutar":0,"oran":0}]${planAdaylar ? ',"matrahHesapKodu":""' : ''}}`;
  }
  private parseClassifyObject(j: any): ClassifyResult | null {
    if (!j || typeof j !== 'object') return null;
    return {
      giderTuru: String(j.giderTuru || '').slice(0, 40),
      kategori: String(j.kategori || ''),
      isletmeKayitTuru: String(j.isletmeKayitTuru || ''),
      isletmeAltTuru: String(j.isletmeAltTuru || ''),
      isletmeNeden: String(j.isletmeNeden || ''),
      muhasebeNeden: this.cleanBaseNeden(j.muhasebeNeden).slice(0, 300),
      kalemler: Array.isArray(j.kalemler)
        ? j.kalemler.slice(0, 15).map((k: any) => ({ ad: String(k?.ad || '').slice(0, 80), tutar: Number(k?.tutar) || 0, oran: Number(k?.oran) || 0 })).filter((k: any) => k.ad)
        : undefined,
      matrahHesapKodu: typeof j.matrahHesapKodu === 'string' ? String(j.matrahHesapKodu).trim() : undefined,
    };
  }

  /** TOPLU sınıflandırma: aynı mükellef+plan+yön grubundaki N belgeyi TEK Max çağrısında değerlendir.
   *  Dönen dizi N nesne değilse [] döner → çağıran tek-tek fallback'e geçer (kategori asla bozulmaz). */
  private async aiClassifyAccountingMulti(
    contents: string[],
    mukellefBilgi: string,
    isIsletme: boolean,
    invoiceKind?: 'ALIS' | 'SATIS',
    planAdaylar?: string,
  ): Promise<Array<ClassifyResult | null>> {
    const n = contents.length;
    if (!n) return [];
    const docBlocks = contents
      .map((c, i) => `=== BELGE ${i + 1} ===\n${String(c || '').replace(/\s+/g, ' ').trim().slice(0, 6000)}`)
      .join('\n\n');
    const prompt = [
      `Aşağıda ${n} adet Türk e-Fatura/e-Arşiv belgesinin metin içeriği var (1..${n} numaralı). HER BİRİNİ ayrı ayrı, bir MALİ MÜŞAVİR gibi değerlendir. Tüm kurallar HER belge için ayrı geçerlidir.`,
      ...this.classifyHeadSegments(mukellefBilgi, invoiceKind),
      `YALNIZCA tam ${n} nesnelik bir JSON DİZİSİ döndür, başka metin YOK. ⚠️ HER nesneye "no" alanı EKLE = o nesnenin değerlendirdiği BELGE NUMARASI (1..${n}) — "=== BELGE X ===" başlığındaki X. Böylece hangi sonucun hangi belgeye ait olduğu KESİN belli olur; sırayı karıştırma riski için "no" MUTLAKA doğru. Nesne biçimi: {"no":<belge numarası>, ...şu alanlar: ${this.classifyJsonShape(planAdaylar)}}`,
      ...this.classifyBodySegments(isIsletme, invoiceKind, planAdaylar),
      '\nBELGELER:\n' + docBlocks,
    ].filter(Boolean).join('\n');
    const releaseSlot = await this.acquireClassifySlot();
    let res: any = null;
    try {
      // N belgelik yanıt tek belgeden uzun → timeout'u belge sayısına göre büyüt (tavan 140s).
      // TEK DENEME: toplu çağrı timeout'a düşerse 2. deneme de düşer (aynı büyük prompt) → çift israf
      //   (6 belge × 126s × 2 = 256s gözlemlendi). Başarısızsa hemen tek-tek fallback'e geç (o zaten retry).
      const tmo = Math.min(this.classifyTimeoutMs + n * 10000, 140000);
      res = await claudeTextViaMax({ prompt, timeoutMs: tmo, model: MAX_MODEL_CHEAP }).catch(() => null);
    } finally {
      releaseSlot();
    }
    if (!res || !res.ok || !res.text) return [];
    try {
      const m = res.text.match(/\[[\s\S]*\]/);
      const arr = m ? JSON.parse(m[0]) : null;
      if (!Array.isArray(arr)) return [];
      // ⚠️ BELGE-SONUÇ KARIŞMASINI ÖNLE: sonucu DİZİ SIRASINA göre DEĞİL, AI'ın döndürdüğü "no" alanına
      //   göre belgeye hizala. AI N belgeyi farklı sırada döndürünce bir belgenin sonucu başkasına yapışıp
      //   yanlış hesap/yorum üretiyordu (nakliye bedeli → "yazılım lisans" + MALİ MÜŞAVİRLİK 770.01.008).
      const nos = arr.map((j: any) => Number(j?.no));
      const allValidUnique = arr.length === n
        && nos.every((x) => Number.isInteger(x) && x >= 1 && x <= n)
        && new Set(nos).size === arr.length;
      if (allValidUnique) {
        const aligned: Array<ClassifyResult | null> = new Array(n).fill(null);
        for (const j of arr) aligned[Number(j.no) - 1] = this.parseClassifyObject(j);
        return aligned;
      }
      // "no" eksik/çakışık/aralık-dışı → SIRALI eşleme GÜVENSİZ (karışma riski). Boş dön → çağıran
      //   HER belgeyi tek-tek sınıflandırır (karışma imkânsız). Doğruluk > hız.
      this.logger.warn(`[CLS-BATCH] no-alani guvenilmez (n=${n}, donen=${arr.length}) → tek-tek fallback`);
      return [];
    } catch { return []; }
  }

  /** Sınıflandırmayı toplu yola sok: aynı grup anahtarındaki istekleri kısa pencerede birleştir. */
  private aiClassifyAccountingCoalesced(
    contentText: string,
    mukellefBilgi: string,
    isIsletme: boolean,
    invoiceKind?: 'ALIS' | 'SATIS',
    planAdaylar?: string,
  ): Promise<ClassifyResult | null> {
    if (!contentText || contentText.length < 20) return Promise.resolve(null);
    if (this.classifyBatchSize <= 1) {
      return this.aiClassifyAccounting(contentText, mukellefBilgi, isIsletme, invoiceKind, planAdaylar).catch(() => null);
    }
    const key = `${isIsletme ? '1' : '0'}|${invoiceKind || 'ALIS'}|${planAdaylar || ''}|${mukellefBilgi}`;
    return new Promise<ClassifyResult | null>((resolve) => {
      let buf = this.classifyBatchBuffers.get(key);
      if (!buf) {
        buf = { items: [], timer: null, shared: { mukellefBilgi, isIsletme, invoiceKind, planAdaylar } };
        this.classifyBatchBuffers.set(key, buf);
      }
      buf.items.push({ contentText, resolve });
      if (buf.items.length >= this.classifyBatchSize) {
        if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
        void this.flushClassifyBatch(key).catch(() => {});
      } else if (!buf.timer) {
        buf.timer = setTimeout(() => { void this.flushClassifyBatch(key).catch(() => {}); }, this.classifyBatchDebounceMs);
      }
    });
  }

  /** Bir grup partisini boşalt: tek Max çağrısı; uyumsuz/başarısızsa tek-tek fallback. HER istek MUTLAKA çözülür. */
  private async flushClassifyBatch(key: string): Promise<void> {
    const buf = this.classifyBatchBuffers.get(key);
    if (!buf || !buf.items.length) return;
    this.classifyBatchBuffers.delete(key); // bu partiyi sahiplen (yeni gelenler ayrı partiye)
    if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
    const items = buf.items;
    const resolved = new Set<number>();
    const resolveAt = (i: number, v: ClassifyResult | null) => { if (!resolved.has(i)) { resolved.add(i); items[i].resolve(v); } };
    try {
      const t0 = Date.now();
      let results: Array<ClassifyResult | null> = [];
      try {
        results = await this.aiClassifyAccountingMulti(
          items.map((i) => i.contentText), buf.shared.mukellefBilgi, buf.shared.isIsletme, buf.shared.invoiceKind, buf.shared.planAdaylar,
        );
      } catch { results = []; }
      if (Array.isArray(results) && results.length === items.length) {
        this.logger.log(`[CLS-BATCH] grup=${items.length} sonuc=OK sure=${Date.now() - t0}ms (tek Max cagrisi)`);
        items.forEach((_, i) => resolveAt(i, results[i] || null));
        return;
      }
      this.logger.warn(`[CLS-BATCH] uyumsuz (istenen=${items.length} donen=${Array.isArray(results) ? results.length : 0}) → tek-tek fallback`);
      await Promise.all(items.map(async (it, i) => {
        const r = await this.aiClassifyAccounting(it.contentText, buf.shared.mukellefBilgi, buf.shared.isIsletme, buf.shared.invoiceKind, buf.shared.planAdaylar).catch(() => null);
        resolveAt(i, r);
      }));
    } catch {
      items.forEach((_, i) => resolveAt(i, null)); // beklenmeyen — bekleyenleri ASLA askıda bırakma
    }
  }

  private async aiClassifyAccounting(
    contentText: string,
    mukellefBilgi: string,
    isIsletme: boolean,
    invoiceKind?: 'ALIS' | 'SATIS',
    planAdaylar?: string,
  ): Promise<ClassifyResult | null> {
    if (!contentText || contentText.length < 20) return null;
    const prompt = [
      'Aşağıda bir Türk e-Fatura/e-Arşiv belgesinin metin içeriği var. İçindeki MAL/HİZMET kalemlerini bir MALİ MÜŞAVİR gibi değerlendir.',
      ...this.classifyHeadSegments(mukellefBilgi, invoiceKind),
      `YALNIZCA şu JSON: ${this.classifyJsonShape(planAdaylar)}`,
      ...this.classifyBodySegments(isIsletme, invoiceKind, planAdaylar),
      '\nİÇERİK:\n' + contentText.slice(0, 12000),
    ].filter(Boolean).join('\n');
    // 429/hız-limitinde sınıflandırma sessizce düşmesin (matrah buna bağlı) → 1 kez GERİ-ÇEKİLMELİ tekrar dene.
    // EŞZAMANLILIK KAPISI: 6 belge aynı anda buraya gelip 6 Max alt-süreci doğurunca hepsi timeout'a
    //   düşüyordu → düşük kapıdan (classifyConcurrency) geçir, her çağrıya yeterli süre (classifyTimeoutMs).
    const releaseSlot = await this.acquireClassifySlot();
    let res: any = null;
    try {
      for (let att = 1; att <= 2 && (!res || !res.ok || !res.text); att++) {
        res = await claudeTextViaMax({ prompt, timeoutMs: this.classifyTimeoutMs, model: MAX_MODEL_CHEAP }).catch(() => null);
        if ((!res || !res.ok || !res.text) && att < 2) await new Promise((r) => setTimeout(r, /rate|429|limit|overload|too many/i.test(String(res?.error || '')) ? 3500 : 600));
      }
    } finally {
      releaseSlot();
    }
    if (!res || !res.ok || !res.text) return null;
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : null;
      return this.parseClassifyObject(j);
    } catch { return null; }
  }

  // AI ile GİDER hesabı seçimi (kural/ad eşleşmesi bulamadığında ESKALASYON). Mükellefin FAALİYETİ +
  // faturanın İÇERİĞİ (giderTuru) ile, mükellefin GERÇEK hesap planından en uygun gider/stok/sabit hesabı
  // seçtirir. Dönen kod planda GERÇEKTEN yoksa null (uydurma kod kabul edilmez). Max aboneliği (token API yok).
  // AI GEREKÇE (deterministik): "sistem bu hesabı NEYE GÖRE seçti" — mükellef faaliyeti + YÖN +
  //   içerik/kategori + SEÇİLEN hesap. Okuma-anı AI yorumu yanlış olabiliyordu (alışa "satış" diyor,
  //   firma faaliyetini kopyalıyordu); bu deterministik üretim yön-KESİN + hesap-KESİN, rematch'te yazılır.
  /** AI'ın "içerik okunamadı / şifreli / nitelik belirlenemedi" gibi BAHANE yorumlarını ele.
   *  Bunlar kullanıcıya YANILTICI görünüyor: kalem zaten okunmuş, belge eşleşmiş olsa bile model
   *  "fatura detayları şifreli formatta, açıklanamadı" gibi sahte bir mazeret yazabiliyor. Böyle bir
   *  yorumu BOŞ'a çeviririz → deterministik özet (buildMuhasebeNeden) ya da zengin yorum
   *  (generateRichMuhasebeNeden) içeriğe + seçilen hesaba göre düzgün cümleyi zaten dolduruyor. */
  private cleanBaseNeden(s: any): string {
    const t = String(s || '').trim();
    if (!t) return '';
    const norm = t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
    // şifreli / encrypted / okunama(dı) / açıklanama(dı) / belirlenem(edi) / tespit edilem / anlaşılam / çözülem / deşifre / decode
    if (/(sifre|desifre|encrypt|decode|okunama|aciklanama|belirlenem|tespit edilem|anlasilam|cozulem|incelene?med)/.test(norm)) return '';
    return t;
  }

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

  private cleanRichMuhasebeNeden(text: string, hesapStr: string, isSale: boolean, isReturn: boolean): string {
    let out = String(text || '')
      .replace(/```[a-z]*/gi, '')
      .replace(/```/g, '')
      .replace(/^\s*[-*•]\s*/gm, '')
      .trim();
    if (!out) return '';
    const fa = out.match(/Faaliyet\s*:?[ \t]*(.+?)(?:\n+|$)/i);
    const yo = out.match(/Yorum\s*:?[ \t]*([\s\S]+)$/i);
    if (!fa || !yo) return '';
    const faaliyet = fa[1].replace(/\s+/g, ' ').trim();
    const yorum = yo[1].replace(/\s+/g, ' ').trim();
    out = `Faaliyet: ${faaliyet}\nYorum: ${yorum}`.slice(0, 900).trim();

    // Yön kesin bilgidir. AI metni alışa gelir/hasılat, satışa gider dili kurarsa kullanıcıya gösterme.
    const hay = out.toLocaleLowerCase('tr-TR');
    if (!isReturn && !isSale && /(satış geliri|hasılat|gelirine gir|olağan satış|satmıştır|satılmıştır)/i.test(hay)) return '';
    if (!isReturn && isSale && /(gideridir|almış|satın almış|stoğuna girmiş|maliyete alınmış)/i.test(hay)) return '';
    const firstCode = String(hesapStr || '').match(/\b\d{3}(?:\.[A-Z0-9ÖİÜÇĞŞ]+)+\b/i)?.[0] || '';
    if (firstCode && !out.includes(firstCode)) return '';
    return out;
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
  ): Promise<{ ok: boolean; neden: string; zengin: boolean; denetim?: any }> {
    const doc: any = await (this.prisma as any).invoiceAccountingDocument
      .findFirst({ where: { id: docId, tenantId }, include: { lines: { orderBy: { orderNo: 'asc' } } } })
      .catch(() => null);
    if (!doc) return { ok: false, neden: '', zengin: false };
    const ocr = (doc.ocrData as any) || {};
    // Katman 2 — AI Denetçi kararı (varsa cache'ten). Yanıtta hep döndürülür (frontend rozeti buradan).
    const cachedDenetim = ocr.denetim && typeof ocr.denetim === 'object' ? ocr.denetim : null;
    // Cache: zaten üretilmiş zengin yorum varsa (ve zorlanmadıysa) onu döndür — AI çağrısı yok.
    const cached = String(ocr.muhasebeNedenZengin || '').trim();
    if (!force && cached) return { ok: true, neden: cached, zengin: true, denetim: cachedDenetim };

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

    // Deterministik özet — HER ZAMAN anında hazır (kullanıcı tıkladığı an bunu görür).
    const matrahAccForNeden = matrahLines.length ? { accountCode: String(matrahLines[0].accountCode).trim(), accountName: String(matrahLines[0].description || '').trim() } : null;
    const det = this.buildMuhasebeNeden(tpFaaliyet, isSale, kat, giderTuru, matrahAccForNeden, isReturn);
    // Hesap atanmamışsa zengin yorum anlamsız → deterministik özet (AI çağırma).
    if (!hesapStr || !matrahAccForNeden) {
      return { ok: true, neden: det, zengin: false, denetim: cachedDenetim };
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

    // AI DENETÇİ KALDIRILDI (kullanıcı talebi 2026-07-27): yalnız "AI değerlendirmesi" (zengin yorum)
    //   üretilir; denetim kararı artık üretilmez (denetim = null). Onay kapıları da bu null'a göre pasif.
    // Zengin AI yorumunu üret + cache'le (ortak iç fonksiyon).
    const uretVeCachele = async (): Promise<{ text: string; denetim: any }> => {
      const yRes = await claudeTextViaMax({ prompt, timeoutMs: 30000, model: MAX_MODEL_CHEAP }).catch(() => null);
      const text = this.cleanRichMuhasebeNeden(yRes && yRes.ok && yRes.text ? String(yRes.text) : '', hesapStr, isSale, isReturn);
      const denetim = null;
      const patch: any = {};
      if (text) patch.muhasebeNedenZengin = text; // Deterministik muhasebeNeden'e DOKUNMA (anlık fallback).
      if (Object.keys(patch).length) {
        await (this.prisma as any).invoiceAccountingDocument
          .update({ where: { id: doc.id }, data: { ocrData: { ...ocr, ...patch } } })
          .catch(() => {});
      }
      return { text, denetim };
    };

    // "AI ile yeniden yorumla" (force) → senkron üret, zengini + denetimi döndür.
    if (force) {
      const { text, denetim } = await uretVeCachele();
      return { ok: true, neden: text || det, zengin: !!text, denetim: denetim || cachedDenetim };
    }

    // Normal açılış → kullanıcı ANINDA deterministik yorumu görsün; zengin yorum + denetim ARKA PLANDA
    //   üret + cache'le (sonraki açılışta / kısa gecikmeli yeniden istekte gelir). Max BEKLETMEZ.
    void uretVeCachele().catch(() => {});
    return { ok: true, neden: det, zengin: false, denetim: cachedDenetim };
  }

  private async aiPickGiderAccount(
    accounts: Array<{ accountCode: string; accountName: string }>,
    faaliyet: string,
    giderTuru: string,
    vendorName: string,
  ): Promise<{ accountCode: string; accountName: string } | null> {
    // Aday hesaplar: stok (15x), sabit kıymet (25x), MALİYET gideri (7xx) leaf'leri.
    //   6xx HARİÇ: 60x gelir, 62x maliyet ÖZETİ, 63x faaliyet gideri GELİR TABLOSU/YANSITMA hesabı —
    //   fatura DOĞRUDAN buraya işlenmez (gider 770'e gider, dönem sonu 771 ile 632'ye yansıtılır).
    //   Ad benzerliği "632 GENEL YÖNETİM GİDERLERİ"yi seçtiriyordu → yalnız 7xx maliyet hesabı aday.
    const cand = accounts.filter((a) => /^(15\d|25\d|7\d\d)/.test(String(a.accountCode || '')));
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
      'İŞİN GİRDİSİ KURALI (önemli — boş bırakmadan önce düşün): Fatura, mükellefin ÜRETTİĞİ/SATTIĞI işin HAM ya da YARI malzemesi/girdisi ise BOŞ bırakma → hizmet/üretim maliyeti (740 HİZMET ÜRETİM MALİYETİ) veya ilk madde (150) veya ticari mal (153) hesabına yaz. ÖRNEK: reklamcı/tabelacı reklam malzemesi-baskı-folyo-levha alır → 740 HİZMET ÜRETİM MALİYETİ (ya da 153 hazır satıyorsa); matbaa kağıt/mürekkep alır → 150/153; terzi kumaş alır → 150/153; inşaatçı demir/çimento → 150/153. Bu bir "genel işletme gideri" (elektrik/telefon/kira) DEĞİL, işin doğrudan girdisidir.',
      'AMA genel işletme gideri (elektrik/su/telefon/kira/kırtasiye/temizlik) → 770; bunları 740/150/153 SANMA.',
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
        select: { accountCode: true, accountName: true, vkn: true },
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
    // Sessiz tavan uyarısı: 500'den fazla bekleyen belge varsa kalanı bu turda eşleştirilmez.
    if (docs.length === 500 && !documentIds?.length) this.logger.warn(`[REMATCH] tavan: tp=${taxpayerId} bekleyen belge >= 500 — kalanlar bu turda eşleştirilmedi (tekrar 'Kodları düzelt' gerekir)`);

    // Mükellefin faaliyeti — AI gider-hesabı eşleştirmesinde "ne iş yapıyor" bağlamı.
    const tpRow: any = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { companyName: true, firstName: true, lastName: true, naceKodu: true, faaliyetAciklama: true } }).catch(() => null);
    const tpFaaliyet = tpRow ? [String(tpRow.companyName || (String(tpRow.firstName || '') + ' ' + String(tpRow.lastName || ''))).trim(), String(tpRow.faaliyetAciklama || '').trim() || (tpRow.naceKodu ? ('NACE ' + tpRow.naceKodu) : '')].filter(Boolean).join(' — ') : '';
    let aiAccCalls = 0; // batch'te AI eskalasyonunu sınırla
    const AI_GIDER_LIMIT = 50; // "Kodları düzelt" batch'inde AI semantik eşleştirme tavanı (Max yükü). Cache aynı içeriği 1 kez sorar → 50 benzersiz gider çoğu mükellefe yeter.
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
    // KATMAN-1 ANOMALİ emsal önbelleği (satıcı VKN → bu mükellefteki son ONAYLI alış tutarları):
    //   aynı satıcının birden çok bekleyen belgesi varsa DB'ye 1 kez gidilir (belge başına ≤1 hafif sorgu).
    const emsalTutarCache = new Map<string, number[]>();
    // SAPMA KUYRUĞU: satıcı başına öğrenilmiş matrah kararları (CARI hariç) 1 kez çekilir.
    const sapmaMemCache = new Map<string, any[]>();

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
      // İÇERİK İMZASI (içerik-bazlı hafıza okuması): belgenin kalemlerinden — approve'daki yazma ile
      //   AYNI fonksiyon → aynı fatura aynı imza. "Bu satıcı + bu içerik → bu hesap" öğrenilmişse çeker.
      const docIcerikImza = VendorMemoryService.buildIcerikImza(Array.isArray((doc.ocrData as any)?.kalemler) ? (doc.ocrData as any).kalemler.map((k: any) => k?.ad) : []);
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
      const faContent = !isSale ? this.detectFixedAsset(doc.ocrData, tpRow) : { is: false, reason: '' };
      // DEMİRBAŞ HADDİ (VUK 313, KDV hariç matrah): içerik demirbaş olsa da bedel haddin ALTINDAysa
      //   doğrudan GİDER (770) yazılır, demirbaş (255) DEĞİL — kullanıcı "770'te gider yazılan demirbaş"
      //   diye açıyor. Eşik üstü → demirbaş (manuel/amortisman). Bedel bilinmiyorsa demirbaş kalır (güvenli).
      const faAltinda = faContent.is && this.demirbasHaddiAltinda(doc.ocrData, faContent.reason);
      const faDet = faAltinda ? { is: false, reason: '' } : faContent;
      if (faDet.is && kat !== 'demirbas') kat = 'demirbas';
      // Eşik-altı demirbaş içeriği: AI 'demirbas' kategorisi vermiş olsa bile gidere çevir (255 değil 770).
      if (faAltinda && kat === 'demirbas') kat = 'genel_gider';
      // DETERMİNİSTİK İÇERİK SINIFLANDIRMA (evrensel kural, AI'sız): kalem+giderTuru'ndan gider kategorisi
      //   + plan-adı ipucu. AI'ın TUTARSIZ/SAÇMA kategorisini EZER → aynı içerik HER ZAMAN aynı hesaba
      //   (nakliye→nakliye, akaryakıt→akaryakıt, yedek-parça/bakım→araç bakım). Demirbaş ise dokunma (faDet);
      //   iade ise alış-kategorisi (153/770) kuralları zaten geçerli. Hint, pickAccount'ta plan-adıyla eşleşir.
      const _kalemAd = Array.isArray((doc.ocrData as any)?.kalemler) ? (doc.ocrData as any).kalemler.map((k: any) => String(k?.ad || '')).join(' ') : '';
      const _giderTuruRaw = String((doc.ocrData as any)?.giderTuru || '').trim();
      // K3 (içerik-faaliyet tutarlılığı): AI 'ticari_mal' (mükellefin SATTIĞI emtia) ya da 'hammadde'
      //   (üretim girdisi) dediyse → deterministik gider sınıflandırması bunu EZMESİN. giderIcerikSinifla
      //   FAALİYET-KÖRÜDÜR: yalnız "içerik bir gidere benziyor mu"ya bakar; mükellefin o malı satıp
      //   satmadığını bilmez. Toptancının deterjan/temizlik ALIŞINI "temizlik gideri"ne çevirip stok (153)
      //   yerine gidere (770) atıyordu. Deterministik katman yalnız GİDER-nitelikli/boş kategoriyi
      //   netleştirsin (nakliye→nakliye, akaryakıt→akaryakıt); AI'ın stok/hammadde kararına dokunmasın.
      const aiStokKat = kat === 'ticari_mal' || kat === 'hammadde';
      let detIcerik = (!isSale && kat !== 'demirbas' && !aiStokKat) ? giderIcerikSinifla(`${_kalemAd} ${_giderTuruRaw}`) : null;
      // ── FAALİYET-ÇELİŞKİ DENETİMİ (2026-07-05, kullanıcı: "mantıksız eşleştirme") ──
      //   "araç/taşıt/yakıt/otoyol" gider ipucu FAALİYET-KÖRÜ üretiliyordu: giderIcerikSinifla
      //   "yedek parça" gibi belirsiz terimleri araç bakıma bağlıyor + AI giderTuru'yu "araç
      //   bakım" halüsine edebiliyor. Reklamcının "YEDEK PARÇA LAZER TÜPÜ" (yazıcı toneri) → 740
      //   Araç Bakım'a düşüyordu. Kural: araç-ailesi ipucu SADECE mükellef araç-yoğun iş yapıyorsa
      //   (nakliye/lojistik/oto/petrol…) VEYA faturada somut araç sinyali (oto/lastik/motorin/
      //   servis satıcısı) varsa geçerli. Aksi halde araç ipucunu DÜŞÜR → genel gider + AI semantik
      //   doğru hesabı seçer. Nakliyeciyi (araç-yoğun faaliyet) ETKİLEMEZ.
      let _giderTuruEfektif = _giderTuruRaw;
      // araç bağlamı yok → araç ipucu VE araç-adlı AI/öğrenilmiş hesap kodu reddedilir (aşağıda kullanılır).
      let _aracBaglamYok = false;
      // KRİTİK: this.norm() Türkçe karakteri KORUR ("araç"→"araç"); regex'ler ASCII ("arac"). Bu yüzden
      //   ASCII-fold (_af) ŞART — yoksa araç denetimi hiç eşleşmez (ilk fix'lerin SERİOFİS'te çalışmama nedeni).
      const _af = (s: string) => this.norm(s).replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u');
      const _aracHesapAdRe = /\b(arac|tasit|yakit|akaryak|otoyol|otopark|kasko|motorlu tas|nakliy|tasima|lastik|balata|motor yag)\b/;
      // MADENİ/MOTOR YAĞI özel çelişki: araç-yoğun mükellefte (nakliyeci) araç bağlamı MEŞRUdur
      //   (_aracBaglamYok=false → araç-çelişki reddi çalışmaz), AMA "motor yağı" YAKIT değil BAKIM'dır.
      //   OCR bazı fişlerde giderTuru="akaryakıt" etiketleyip AI-kod/öğrenilmiş-kod'u 740 ARAÇ YAKIT'a
      //   bağlıyor; deterministik gider-icerik düzeltmesi bu ÜST yollara ulaşmıyor. Kural: içerik madeni/
      //   motor yağı ise ve seçilen hesap "ARAÇ YAKIT/AKARYAKIT" ise REDDET → giderIcerikSinifla'nın
      //   "araç bakım onarım" hint'i doğru hesabı (740 BAKIM ONARIM) bulur. (Kullanıcı: ELİT PETROLCÜLÜK
      //   "MOTOR YAĞI" → 740.01.001 YAKIT'a gidiyordu; doğrusu 740.01.002 ARAÇ BAKIM ONARIM.)
      const _yagIcerik = /\b(motor yag|madeni yag|sanziman yag|vites yag|hidrolik yag|dislibox yag)\b|\bgres\b/.test(_af(_kalemAd))
        && !/\b(motorin|benzin|mazot|dizel|akaryakit yakit|yakit gideri)\b/.test(_af(_kalemAd));
      const _isYakitHesapAd = (ad: string) => /\b(yakit|akaryak)\b/.test(_af(ad)) && !/\b(bakim|onarim|servis|tamir)\b/.test(_af(ad));
      {
        const aracHintRe = /\b(arac|tasit|yakit|akaryak|otoyol|otopark|kasko|motorlu tas|mtv|bakim onarim)\b/;
        const detAracHint = detIcerik ? aracHintRe.test(_af(detIcerik.hint || '')) : false;
        const aiAracHint = aracHintRe.test(_af(_giderTuruRaw));
        if (!isSale && (detAracHint || aiAracHint)) {
          const faalN = _af(tpFaaliyet);
          const aracYogunFaal = /(nakliy|tasima|tasimacilik|lojistik|kargo|kurye|petrol|akaryak|filo|otomotiv|oto tamir|oto servis|arac kirala|servis istasyon|kamyon|\btir\b|dorse|treyler)/.test(faalN);
          const faturaAracSinyal = /(\boto\b|otomotiv|\bpetrol\b|akaryak|\blastik\b|motorlu tas|tuvturk|arac muayene|tasit muayene|motorin|\bbenzin\b|\bbalata\b|\bopet\b|\bshell\b|aytemiz|mengerler|oto yedek|arac yedek)/.test(_af(`${_kalemAd} ${vendorName || ''}`));
          if (!aracYogunFaal && !faturaAracSinyal) {
            _aracBaglamYok = true;
            if (detAracHint) { detIcerik = null; kat = 'genel_gider'; }
            if (aiAracHint) _giderTuruEfektif = '';
          }
        }
      }
      if (detIcerik) kat = detIcerik.kategori;
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
      // DETERMİNİSTİK hint VARSA onu kullan (plan-adıyla eşleşir, tutarlı); yoksa AI'ın giderTuru'su.
      const giderTuru = detIcerik?.hint || _giderTuruEfektif;
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
              } else if (/^15/.test(key)) {
                // HOMOJEN stok grubu (153 TİCARİ MALLAR): tüm leaf'ler aynı semantik, yalnız KDV oranı
                //   farkı → içerik-uyuşması kategoriyle zaten sağlandı. En genel leaf güvenli; matrahForRate
                //   çok-oranlı faturada satırın oranına göre düzeltir.
                // ⚠️ 25x (DEMİRBAŞ) BURAYA GİRMEZ: sabit kıymet alt-hesapları HETEROJEN — her biri AYRI
                //   varlık ("IPHONE TELEFON", "TAŞIT", "MOBİLYA"…). leaves[0] atamak YARI RÖMORK'u
                //   "IPHONE TELEFON" hesabına yazıyordu. Ad eşleşmesi yoksa BOŞ kalır → müşavir o sabit
                //   kıymete özel alt-hesabı açar/seçer (her demirbaş kendi hesabına kaydedilir).
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
      // 6xx REDDİ (2026-07-05): alış faturası DOĞRUDAN 6xx'e yazılmaz — 60x gelir, 62x satılan-maliyeti,
      //   63x (630/631/632) dönem-sonu yansıtma hesaplarıdır. Gider faturası 7xx'e (7/A) gider; dönem sonu
      //   771 ile 632'ye yansıtılır. AI "GENEL YÖNETİM GİDERLERİ" ad-benzerliğiyle 632'yi seçiyordu
      //   (İstanbul Gaz/Turkcell → 632 saçmalığı). Alışta yalnız 15x/25x/7xx kabul.
      const _aiCand = (!isSale && aiKod && !/^6/.test(aiKod) && isPostableLeaf(aiKod)
        && !(faDet.is && !/^25/.test(aiKod)))
        ? accounts.find((a: any) => String(a.accountCode || '') === aiKod) : null;
      // ARAÇ-ÇELİŞKİ: AI okuma anında araç-adlı hesap (740 ARAÇ BAKIM) seçmiş olsa da, mükellef+fatura
      //   araç-dışıysa (_aracBaglamYok) bu kodu REDDET → AI semantik/boş doğru hesabı bulur. (SERİOFİS toneri.)
      const aiMatrahAcc = (_aiCand && (
          (_aracBaglamYok && _aracHesapAdRe.test(_af(String((_aiCand as any).accountName || ''))))
          || (_yagIcerik && _isYakitHesapAd(String((_aiCand as any).accountName || '')))
        ))
        ? null : _aiCand;
      const aiGroupLeaves = aiMatrahAcc
        ? accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(aiKod.split('.').slice(0, 2).join('.') + '.') && isPostableLeaf(c); })
        : [];
      // İÇERİK-HESAP SEMANTİK EŞLEŞTİRME (kullanıcı kuralı): heterojen gider havuzunda (7xx/6xx) ad
      //   eşleşmeyince hesabı RASTGELE atama — AI, fatura içeriğini (giderTuru) mükellefin işine +
      //   plandaki gider hesaplarına SEMANTİK eşler; uygun hesap yoksa null = BOŞ. Aynı giderTuru bir
      //   kez sorulur (aiGiderCache) + batch limiti → "Kodları düzelt"te Max fırtınası olmaz, hız korunur.
      const kalemContext = Array.isArray((doc.ocrData as any)?.kalemler)
        ? (doc.ocrData as any).kalemler.map((k: any) => String(k?.ad || '')).filter(Boolean).slice(0, 8).join(', ')
        : '';
      const giderIcerik = giderTuru || [this.kategoriAciklama(kat), vendorName, kalemContext].filter(Boolean).join(' | ');
      // DEMİRBAŞ'ta AI gider tahmini YANLIŞ: mevcut sabit-kıymet hesaplarından (IPHONE/araç/mobilya)
      //   birini seçmeye zorlar; oysa her demirbaş kendi hesabına gider → BOŞ kalsın (müşavir açar).
      //   Demirbaş HARİCİNDE AI içerik-bazlı gider seçer (entegratör XML dahil — kalemlere bakar).
      if (!isSale && !categoryMatrah && giderIcerik && kat !== 'demirbas') {
        const ck = this.norm(giderIcerik).slice(0, 180);
        if (aiGiderCache.has(ck)) {
          categoryMatrah = aiGiderCache.get(ck);
        } else if (aiAccCalls < AI_GIDER_LIMIT) {
          aiAccCalls++;
          const aiPick = leafOnly(await this.aiPickGiderAccount(accounts, tpFaaliyet, giderIcerik, vendorName));
          aiGiderCache.set(ck, aiPick);
          categoryMatrah = aiPick;
        }
      }
      // İÇERİK↔HESAP ADI SEMANTİK UYUŞMASI ZORUNLU (kullanıcı kuralı): heterojen gider havuzunda
      //   (770/760/740/730) AI ve ad eşleşmesi BULUNAMADIYSA hesabı RASTGELE atama YANLIŞ — eski kör
      //   "categoryGroupLeaves[0]" fallback'i, "kargo/posta" faturasını grubun ilk leaf'i olan
      //   "770.01.001 ELEKTRİK GİDERLERİ"ne yazıyordu (kullanıcı: "ne alaka"). Artık SADECE içerik-adı
      //   GERÇEKTEN eşleşen leaf atanır (ör. gıda/yemek içeriği → adında gıda/yemek geçen hesap); eşleşme
      //   yoksa BOŞ kalır → kullanıcı 1 kez doğru hesabı seçer, satıcı+oran için öğrenilir. KÖR FALLBACK KALDIRILDI.
      if (!isSale && !categoryMatrah && categoryGroupLeaves.length && kat && kat !== 'demirbas') {
        const text = this.norm([giderTuru, kalemContext, vendorName].filter(Boolean).join(' '));
        const foodMatch = categoryGroupLeaves.find((a: any) => {
          const n = this.norm(String(a.accountName || ''));
          return (text.includes('yemek') || text.includes('gida') || text.includes('ekmek') || text.includes('mutfak'))
            && (n.includes('yemek') || n.includes('gida') || n.includes('mutfak'));
        }) || null;
        categoryMatrah = leafOnly(foodMatch); // eşleşme yoksa null = BOŞ (artık leaves[0]'a düşmez)
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
        const grp = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith(vergiPrefix) && !c.startsWith('79') && isPostableLeaf(c); });
        let result: any = null;
        if (!grp.length) {
          result = this.pickAccount(accounts, [vergiPrefix], null);
        } else {
          // Tevkifatlı SATIŞ (391, tek satır = net tevkifat-sonrası KDV): adında oran ("2/10") ya da
          //   "tevkifat" geçen hesabı tercih et. ALIŞ'ta (191) BU BLOK ÇALIŞMAZ — artık normal-191 ve
          //   sorumlu-191 AYRI satırlar (bkz. sorumluKdvMatch); normal-191 araması "2/10"/"tevkifat"
          //   İÇEREN hesabı SEÇMEMELİ (kullanıcı bulgusu: normal KDV satırı yanlışlıkla "SORUMLU
          //   SIF.İND.KDV. 2/10" hesabına atanmıştı — aşağıdaki normals filtresi zaten bu hesapları
          //   eler, ALIŞ'ta direkt oraya düşmeli).
          if (vergiPrefix === '391' && tevkPay >= 1 && tevkPay <= 9) {
            result = grp.find((a: any) => { const n = String(a.accountName || ''); return n.includes(`${tevkPay}/10`) || /tevk[iıİ]fat/i.test(n); }) || null;
          }
          if (!result) {
            // tevkifat/iade/ihrac/istisna/SORUMLU GEÇMEYEN düz hesaplar (matrahla simetrik).
            //   "sorumlu" da elenir: adında tevkifat/"2-10" geçmeyen "191.02.001 SORUMLU SIFATIYLA
            //   İND.KDV" hesabı normals'a sızıp normal KDV satırına atanıyordu (sorumluKdvMatch simetriği).
            const normals = grp.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/([iİ]ade|[iİ]hrac|[iİ]stisna|sorumlu)/i.test(String(a.accountName || '')));
            // ALIŞ'ta (191) normals BOŞSA (planda yalnız "sorumlu/tevkifat" adlı 191 hesabı varsa, normal
            //   İndirilecek KDV hesabı YOKSA) grp'ye (sorumlu dahil) DÜŞME — normal-191 satırı SORUMLU
            //   hesaba ASLA zorla atanmasın (kullanıcı bulgusu: planda sadece "191.02.001 SORUMLU
            //   SIF.İND.KDV" varken normal+sorumlu satırların İKİSİ DE oraya gitmişti). BOŞ kalsın
            //   ("Eksik hesap kodu" görünür, kullanıcı 1 kez seçer/Luca'da açar → öğrenilir). SATIŞ'ta
            //   (391, tek-satır tevkifat-sonrası net) eski davranış (grp'ye düş) KORUNUR.
            const pool = normals.length ? normals : (vergiPrefix === '391' ? grp : []);
            // ORANA göre: adındaki ORAN-token'ları (≤2 hane; "2024"/kod parçası oran sanılmaz — R7)
            // arasında satırın KDV oranı geçen hesabı seç (%20→"20").
            if (rateDigits) {
              result = pool.find((a: any) => this.rateTokenInName(String(a.accountName || ''), rateDigits)) || null;
            }
            // Oran eşleşmedi: TEK aday varsa (planın tek KDV hesabı) onu kullan; ya da adında HİÇ
            // oran-sayısı olmayan TEK genel "İNDİRİLECEK/HESAPLANAN KDV" hesabı varsa onu. Aksi
            // halde (birden çok oranlı hesap var ama bu oran yok) → null = BOŞ (kural: rastgele
            // orana düşürme; kullanıcı doğru oranı ekler/seçer).
            if (!result) {
              if (pool.length === 1) result = pool[0];
              else {
                const noRate = pool.filter((a: any) => this.rateTokensOf(String(a.accountName || '')).length === 0);
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
      // SORUMLU SIFATIYLA İNDİRİLECEK KDV (191 — kullanıcı kuralı, Mihsap birebir): ALIŞ tevkifatta
      //   normal İndirilecek KDV'den AYRI bir 191 alt-hesabına (adında "sorumlu" geçen) tevkifat
      //   tutarı borç yazılır. Plan'da böyle bir alt-hesap YOKSA uydurma — boş bırak ("Eksik hesap
      //   kodu" görünür; müşavir 1 kez ekler/seçer, sahte kod asla yazılmaz).
      const sorumluKdvMatch = (() => {
        const g191 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('191') && !c.startsWith('79') && isPostableLeaf(c); });
        if (!g191.length) return null;
        return g191.find((a: any) => this.norm(String(a.accountName || '')).includes('sorumlu')) || null;
      })();
      // SATIŞ matrahı TEVKİFAT-FARKINDA (KDV hesabıyla simetrik): tevkifatlı satış → adında
      // "tevkifat" geçen 600; NORMAL satış → "tevkifat/iade/ihrac/istisna" GEÇMEYEN normal 600.
      // Eskiden isim eşleşmesi olmayınca EN DÜŞÜK 600 leaf seçiliyordu → planın ilk hesabı
      // "600.01.003 TEVKİFATLI GELİRLER" ise NORMAL satışlar da oraya düşüyordu (kullanıcı bildirdi).
      const saleMatrahDefault = (() => {
        if (!isSale || isReturn) return categoryMatrah; // alıştan iade: 600 değil, orijinal stok/gider
        const g600 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('600') && !c.startsWith('79') && isPostableLeaf(c); });
        if (!g600.length) return categoryMatrah;
        if (tevkPay >= 1) {
          // önce TAM oran ("2/10"), sonra "tevkifat" kelimesi ya da herhangi "X/10" deseni.
          const exact = g600.find((a: any) => String(a.accountName || '').includes(`${tevkPay}/10`));
          const hit = exact || g600.find((a: any) => this.isTevkifatAccountName(a.accountName || ''));
          if (hit) return hit;
          // Planda tevkifat-adlı 600 YOKSA gelir yine 600'e işlenir (tevkifat KDV/cari tarafında
          //   ele alınır) → aşağıdaki NORMAL-600 seçimine düş. Eskiden categoryMatrah'a düşüyordu;
          //   satışta kategori 600 üretmediğinden matrah BOŞ kalıyordu (Yorgun Nakliyat: okuma
          //   tevkifatı doğru yakalayınca 72 satış "Gelir kodu boş" kaldı).
        }
        // NORMAL satış → tevkifat (KELİME ya da "X/10" ORAN) / iade / ihrac / istisna GEÇMEYEN 600.
        const normals = g600.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/([iİ]ade|[iİ]hrac|[iİ]stisna)/i.test(String(a.accountName || '')));
        const pool = normals.length ? normals : g600;
        const depth = (c: string) => (String(c || '').match(/\./g) || []).length;
        const mx = pool.reduce((m: number, a: any) => Math.max(m, depth(String(a.accountCode || ''))), 0);
        return pool.filter((a: any) => depth(String(a.accountCode || '')) === mx)[0] || pool[0];
      })();
      // SATIŞ oran-bazlı pool: 600 grubu (tevkifat-farkında) leaf'leri — matrahForRate satırın oranına
      //   göre seçer (600.01.001 %1 / .002 %10 / .003 %20). saleMatrahDefault tek-değer fallback'tir.
      const saleGroupLeaves: any[] = (isSale && !isReturn) ? (() => {
        const g600 = accounts.filter((a: any) => { const c = String(a.accountCode || ''); return c.startsWith('600') && !c.startsWith('79') && isPostableLeaf(c); });
        if (!g600.length) return [];
        if (tevkPay >= 1) {
          const tevk = g600.filter((a: any) => this.isTevkifatAccountName(a.accountName || '') || String(a.accountName || '').includes(`${tevkPay}/10`));
          // Tevkifat-adlı 600 yoksa normal-600 havuzuna düş (saleMatrahDefault ile simetrik).
          if (tevk.length) return tevk;
        }
        const normals = g600.filter((a: any) => !this.isTevkifatAccountName(a.accountName || '') && !/([iİ]ade|[iİ]hrac|[iİ]stisna)/i.test(String(a.accountName || '')));
        return normals.length ? normals : g600;
      })() : [];
      // ÖKC/yazarkasa fişi NAKİT işlemdir → karşı taraf cari değil, 100 KASA.
      const okcFis = String(doc.documentType || '').toUpperCase() === 'OKC_FIS';
      // Z RAPORU satışı: karşı taraf müşteri (120) DEĞİL → nakit 100 Kasa + kart 108 POS.
      const zRaporu = String(doc.documentType || '').toUpperCase() === 'Z_RAPORU';
      const zKasaAcc = (okcFis || zRaporu) ? leafOnly(this.pickAccount(accounts, ['100'], null)) : null;
      const zPosAcc = zRaporu ? (leafOnly(this.pickAccount(accounts, ['108'], null)) || zKasaAcc) : null;
      // İADE carisi YÖN-belirsiz: satıştan iade → MÜŞTERİ (120), alıştan iade → SATICI (320). İade
      //   ALIŞ görünüp cari 120'de olunca 320'de aranıp bulunamıyordu (kullanıcı: "carisi Luca'da
      //   var ama eşleştirmedi"). İade'de her iki grubu + her iki tarafın adını dene.
      const cariPrefixes = isReturn ? ['120', '320', '329', '331'] : (isSale ? ['120'] : ['320', '329', '331']);
      const cariNames = isReturn ? [doc.customerName, doc.vendorName].filter(Boolean) : [vendorName];
      // CARI seçim ÖNCELİĞİ (kullanıcı bulgusu: MERT REKLAM faturası → yanlış "AKILLI KARTUŞ" cari):
      //   1) Plandaki cari hesaplar arasında VKN'si satıcının VKN'siyle BİREBİR tutan (yön öneki uygun)
      //      → EN GÜVENİLİR, hafızayı da ezer. 2) VKN bazlı öğrenilmiş hafıza. 3) KATI isim eşleşmesi.
      //   Seçilen carinin plandaki VKN'si satıcıyla ÇELİŞİYORSA (poisoned hafıza / isim çakışması)
      //   REDDEDİLİR → null ("Eksik cari"; müşavir 1 kez seçer → VKN bazında doğru öğrenilir).
      const normVkn = (v: any) => String(v || '').replace(/\D/g, '');
      const svkn = normVkn(vendorVkn);
      const cariByVkn = (!okcFis && svkn)
        ? (accounts.find((a: any) => {
            const c = String(a.accountCode || '');
            return cariPrefixes.some((p) => c.startsWith(p)) && isPostableLeaf(c) && normVkn((a as any).vkn) === svkn;
          }) || null)
        : null;
      const cariMemory = (!cariByVkn && !okcFis && vendorVkn)
        ? await this.pickCariMemoryAccount(tenantId, taxpayerId, vendorVkn, accounts)
        : null;
      let cariIsim: any = null;
      if (!okcFis && !cariByVkn && !cariMemory) { for (const nm of cariNames) { cariIsim = this.pickAccount(accounts, cariPrefixes, nm, { requireHint: true }); if (cariIsim) break; } }
      let cariPick: any = cariByVkn || cariMemory || cariIsim;
      // DOĞRULANAMAYAN HAFIZA CARİSİ reddi (canlı test bulgusu 2026-07-04): plan hesaplarında VKN
      //   kayıtlı olmayabiliyor → poisoned hafıza (VKN→yanlış cari) VKN ile elenemiyordu. Hafızadan
      //   gelen cari NE VKN'yle NE de satıcı adıyla doğrulanamıyorsa GÜVENME → boş bırak ("Eksik cari").
      //   (MERT REKLAM faturası → hafızadan "AKILLI KARTUŞ ERCAN EREOL"; ikisinde de ortak yok.)
      if (cariPick && cariPick === cariMemory) {
        const pv = normVkn((cariPick as any).vkn);
        const vknOk = !!pv && !!svkn && pv === svkn;
        const nameOk = cariNames.some((nm: any) => nm && this.nameMatchScore(String(nm), String((cariPick as any).accountName || '')) > 0);
        if (!vknOk && !nameOk) cariPick = null;
      }
      // VKN-ÇELİŞKİ reddi: seçilen carinin plandaki VKN'si VARSA ve satıcı VKN'siyle farklıysa → yanlış.
      if (cariPick && svkn) { const pv = normVkn((cariPick as any).vkn); if (pv && pv !== svkn) cariPick = null; }
      const cariMatch = leafOnly(okcFis
        ? this.pickAccount(accounts, ['100'], null)
        : cariPick);
      // Cari kodunun kaynağı (satır kaynak alanına yazılır; öğrenme kapısı VKN/HAFIZA/KULLANICI kabul eder).
      const cariKaynak: string | null = okcFis
        ? 'KURAL'
        : cariPick && cariPick === cariByVkn ? 'VKN'
        : cariPick && cariPick === cariMemory ? 'HAFIZA'
        : cariPick ? 'ISIM'
        : null;
      // ORAN-BAZLI matrah: her matrah satırı KENDİ KDV oranına göre öğrenilmiş kodu alır;
      // yoksa kategori/varsayılan. Öğrenilmiş kod (satıcı+oran) her zaman önceliklidir.
      const matrahCache = new Map<string, any>();
      const matrahForRate = async (rate: string) => {
        if (matrahCache.has(rate)) return matrahCache.get(rate);
        const learned = vendorVkn ? await this.pickVendorMemoryAccount(tenantId, taxpayerId, vendorVkn, accounts, rate, docIcerikImza) : null;
        let m = leafOnly(learned);
        // KAYNAK İZİ: satıra yazılan kodun nereden geldiği (HAFIZA/AI/KURAL/VARSAYILAN) satırın
        //   kaynak alanına işlenir — öğrenme kapısı ve arayüz rozeti bunu kullanır.
        let mKaynak: string | null = m ? 'HAFIZA' : null;
        if (m && !this.learnedMatrahCompatibleWithContent(String((m as any).accountCode || ''), kat, giderTuru, faDet.is)) {
          m = null;
        }
        // ARAÇ-ÇELİŞKİ (2026-07-05): ÖĞRENİLMİŞ kod bile araç-adlı hesap (740 ARAÇ BAKIM) ise ve mükellef+
        //   fatura araç-dışıysa (_aracBaglamYok) REDDET. Öğrenilmiş kod aiMatrahAcc'tan ÖNCE geliyordu →
        //   aiMatrahAcc reddini by-pass ediyordu (SERİOFİS toneri, VKN'ye 740 öğrenilmiş kalmıştı).
        if (m && _aracBaglamYok && _aracHesapAdRe.test(_af(String((m as any).accountName || '')))) {
          m = null;
        }
        // MADENİ/MOTOR YAĞI çelişkisi: öğrenilmiş kod ARAÇ YAKIT hesabına bağlıysa (poisoned) reddet.
        if (m && _yagIcerik && _isYakitHesapAd(String((m as any).accountName || ''))) {
          m = null;
        }
        // 6xx REDDİ öğrenilmiş kod için de: alışta doğrudan 632/62x/60x'e yazma (dönem-sonu/gelir hesabı).
        if (m && !isSale && /^6/.test(String((m as any).accountCode || ''))) {
          m = null;
        }
        // ③ AI doğrudan seçim (öğrenilmiş kod YOKSA): AI'ın okuma anında plandan seçtiği matrah
        //   hesabı. Çok-oranlı faturada AI grubunun bu orana ait varyantı (153.01.001 %1 / .003 %20)
        //   varsa onu, yoksa AI'ın seçtiği kodu. Mekanik kategori/varsayılandan ÖNCE gelir.
        if (!m && aiMatrahAcc) {
          if (rate) { const v = aiGroupLeaves.find((a: any) => this.rateTokenInName(String(a.accountName || ''), rate)); m = leafOnly(v) || leafOnly(aiMatrahAcc); }
          else m = leafOnly(aiMatrahAcc);
          if (m) mKaynak = 'AI';
        }
        // ORAN-bazlı matrah (KDV gibi orana DUYARLI): kategori/600 grubunda adında satırın oranı geçen
        //   leaf'i seç (153.01.001 "%1" / .002 "%10" / .003 "%20"; satışta 600 aynı). Eskiden hep en
        //   genel leaf (153.01.001=%1) atanıyordu → çok-oranlı faturada %10 matrahı da %1 hesabına
        //   gidiyordu (kullanıcı: "aynı faturada birden fazla oran var, niye orana dikkat etmiyor").
        if (!m && rate) {
          // ALIŞTAN iade (isSale && isReturn): oran-eşleşmesi 600'e (ciro) SIZMASIN — matrah orijinal
          //   stok/gider grubunda (categoryGroupLeaves) aranır (saleMatrahDefault zaten öyle döner).
          const pool = (isSale && !isReturn) ? saleGroupLeaves : categoryGroupLeaves;
          const hit = (pool || []).find((a: any) => this.rateTokenInName(String(a.accountName || ''), rate));
          if (hit) { m = leafOnly(hit); if (m) mKaynak = 'KURAL'; }
          // SATIŞ + oran BELLİ + plandaki 600 leaf'leri ORAN ETİKETLİ ama bu oran YOK → yanlış-oranlı
          //   varsayılana (%10 satış → "TİCARİ MAL %20") DÜŞME, BOŞ bırak (kullanıcı doğru oran
          //   hesabını ekler/seçer; vergiForRate'in "rastgele orana düşürme" kuralıyla simetrik).
          else if (isSale && !isReturn
            && (pool || []).some((a: any) => this.rateTokensOf(String(a.accountName || '')).length > 0)) {
            matrahCache.set(rate, null);
            return null;
          }
        }
        if (!m) { m = leafOnly(saleMatrahDefault); if (m) mKaynak = 'VARSAYILAN'; }
        // SON GÜVENLİK (yağ ≠ yakıt): hangi yoldan gelirse gelsin (AI-kod / öğrenilmiş /
        //   içerik-sınıf / varsayılan), içerik madeni/motor yağı iken seçilen hesap ARAÇ YAKIT/
        //   AKARYAKIT ise plandaki ARAÇ BAKIM ONARIM'a çevir; bakım hesabı yoksa BOŞ bırak (yakıta
        //   ASLA yazma). Deterministik gider-icerik düzeltmesi canlıya yansımasa bile bu api-içi
        //   koruma motor yağını yakıt hesabından uzak tutar. (ELİT PETROLCÜLÜK "MOTOR YAĞI" vakası.)
        if (m && _yagIcerik && _isYakitHesapAd(String((m as any).accountName || ''))) {
          const bakim = accounts.find((a: any) => {
            const ad = _af(String(a.accountName || ''));
            return /\b(bakim|onarim)\b/.test(ad) && /\b(arac|tasit|motor)\b/.test(ad) && isPostableLeaf(String(a.accountCode || ''));
          });
          m = bakim ? leafOnly(bakim) : null;
          if (m) mKaynak = 'KURAL';
        }
        const mOut = m ? { ...(m as any), _kaynak: mKaynak || 'KURAL' } : null;
        matrahCache.set(rate, mOut);
        return mOut;
      };

      for (const line of doc.lines || []) {
        const group = String(line.group || '') as 'matrah' | 'vergi' | 'vergi-sorumlu' | 'cari' | 'tevkifat';
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
                data: want ? { accountCode: want, description: (ret as any).accountName, kaynak: 'KURAL' } : { accountCode: '', description: '', kaynak: null },
              });
            }
            continue;
          }
          // (alıştan iade matrahı → aşağıdaki normal categoryMatrah akışına düşer)
        }
        const match = group === 'matrah'
          ? await matrahForRate(lineRate)
          : group === 'vergi' ? vergiForRate(lineRate)
          : group === 'vergi-sorumlu' ? sorumluKdvMatch
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
                data: { accountCode: (tevkMatch as any).accountCode, kaynak: 'KURAL' },
              });
            }
          } else if (current) {
            await (this.prisma as any).invoiceAccountingLine.update({ where: { id: line.id }, data: { accountCode: '', description: '', kaynak: null } });
          }
          continue;
        }
        // SORUMLU SIFATIYLA İNDİRİLECEK KDV özel (191): satıcı carisine/orana EZME. Plandaki "sorumlu"
        // adlı 191 alt-hesabına bağlanır; yoksa boşalt (sahte placeholder asla canlı kalmaz).
        if (group === 'vergi-sorumlu') {
          if (sorumluKdvMatch) {
            if (current !== String((sorumluKdvMatch as any).accountCode)) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (sorumluKdvMatch as any).accountCode, description: (sorumluKdvMatch as any).accountName, kaynak: 'KURAL' },
              });
            }
          } else if (current) {
            await (this.prisma as any).invoiceAccountingLine.update({ where: { id: line.id }, data: { accountCode: '', description: '', kaynak: null } });
          }
          continue;
        }
        // CARI özel: cari HER ZAMAN karşı tarafa eşleşmeli. Mevcut kod (placeholder olmasa
        // bile) karşı tarafı içermiyorsa ve VKN-hafızasından gelmiyorsa → YANLIŞ otomatik
        // eşleşme (ör. KAYIKÇI faturasına AYDE cari); doğrusuyla değiştir ya da BOŞALT.
        if (group === 'cari') {
          // Z RAPORU satışı → nakit satırı 100 Kasa, kart satırı 108 POS. Satır hedefi: mevcut kod öneki
          //   (100/108) ya da açıklama işareti (POS/kart). Cari açıklaması rematch'te ezilmez → kararlı.
          if (zRaporu) {
            const wantPos = current.startsWith('108') || /pos|kart|kredi/i.test(String(line.description || ''));
            const want = wantPos ? zPosAcc : zKasaAcc;
            if (want && current !== String((want as any).accountCode)) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (want as any).accountCode, description: (want as any).accountName, kaynak: 'KURAL' },
              });
            }
            continue;
          }
          // ÖKC/yazarkasa fişi → HER ZAMAN 100 Kasa (nakit). İsim/VKN eşleşmesi aranmaz.
          if (okcFis) {
            if (cariMatch && !current.startsWith('100')) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (cariMatch as any).accountCode, description: (cariMatch as any).accountName, kaynak: 'KURAL' },
              });
            }
            continue;
          }
          const curAcc = current ? accounts.find((a: any) => String(a.accountCode || '') === current) : null;
          // Mevcut cariyi KORU sadece DOĞRULANMIŞSA: VKN birebir tutuyor VEYA satıcı adıyla eşleşiyor
          //   VEYA bu rematch'in (doğrulanmış) seçtiği cariyle aynı. "Sadece hafızadan geldi" YETMEZ —
          //   poisoned hafıza (VKN→yanlış cari) böyle korunup kalıyordu (canlı bulgu 2026-07-04:
          //   MERT REKLAM faturası → AKILLI KARTUŞ; ne VKN ne isim tutuyordu ama fromMemory koruyordu).
          const curVknOk = !!curAcc && !!svkn && normVkn((curAcc as any).vkn) === svkn;
          const curNameOk = !!curAcc && cariNames.some((nm: any) => nm && this.nameMatchScore(String(nm), String((curAcc as any).accountName || '')) > 0);
          const curIsPick = !!curAcc && !!cariMatch && String((curAcc as any).accountCode) === String((cariMatch as any).accountCode);
          if (current && (curVknOk || curNameOk || curIsPick)) continue; // doğrulanmış cari — dokunma
          await (this.prisma as any).invoiceAccountingLine.update({
            where: { id: line.id },
            data: cariMatch
              ? { accountCode: (cariMatch as any).accountCode, description: (cariMatch as any).accountName, kaynak: cariKaynak || 'KURAL' }
              : { accountCode: '', description: '', kaynak: null },
          });
          continue;
        }
        // MATRAH özel (SATIŞ tevkifat-lik): mevcut 600 hesabının tevkifat-liği belgeyle çelişiyorsa
        // (normal satış ama tevkifatlı-600, ya da tevkifatlı satış ama normal-600) → doğru tevkifat-
        // likteki 600'e çek. Doğru tevkifat-likteki BAŞKA bir 600'e (kullanıcı seçimi) dokunmaz.
        if (group === 'matrah' && isSale && saleMatrahDefault) {
          const curAcc = current ? accounts.find((a: any) => String(a.accountCode || '') === current) : null;
          const curIsTevk = !!curAcc && this.isTevkifatAccountName(String(curAcc.accountName || ''));
          // Planda tevkifat-adlı 600 yoksa (saleMatrahDefault tevkifatlı belgede bile normal-600 döner)
          //   tevkifatlı satışın normal-600'ü ÇELİŞKİ DEĞİLDİR — zorla değiştirme.
          const tevkCelieskisiVar = tevkPay >= 1
            ? this.isTevkifatAccountName(String((saleMatrahDefault as any).accountName || '')) && !curIsTevk
            : curIsTevk;
          if (curAcc && tevkCelieskisiVar && current !== String((saleMatrahDefault as any).accountCode)) {
            await (this.prisma as any).invoiceAccountingLine.update({
              where: { id: line.id },
              data: { accountCode: (saleMatrahDefault as any).accountCode, kaynak: 'VARSAYILAN' },
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
                data: matchCode ? { accountCode: matchCode, kaynak: (match as any)?._kaynak || 'KURAL' } : { accountCode: '', description: '', kaynak: null },
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
            const curRates = this.rateTokensOf(String(curAcc.accountName || ''));
            const rateOk = !lineRate || curRates.length === 0 || curRates.includes(lineRate);
            const tevkOk = curIsTevk === (tevkPay >= 1);
            if ((!rateOk || !tevkOk) && current !== String((want as any).accountCode)) {
              await (this.prisma as any).invoiceAccountingLine.update({
                where: { id: line.id },
                data: { accountCode: (want as any).accountCode, kaynak: 'KURAL' },
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
            data: { accountCode: match.accountCode, kaynak: (match as any)?._kaynak || 'KURAL', ...((match as any).accountName ? { description: String((match as any).accountName) } : {}) },
          });
        } else if (current) {
          // Planda uygun kod YOK → var olmayan placeholder'ı (ör. 770.01.010) BOŞALT.
          // "Eksik hesap kodu" görünür; kullanıcı 1 kez seçer → satıcı için öğrenilir.
          await (this.prisma as any).invoiceAccountingLine.update({
            where: { id: line.id },
            data: { accountCode: '', description: '', kaynak: null },
          });
        }
      }
      // AÇIKLAMA = HESAP ADI senkronu (TÜM accountCode değişikliklerinden SONRA): matrah/vergi
      //   satırının açıklaması GÜNCEL hesap kodunun plandaki ADI olmalı ("Gider / matrah" /
      //   "Satış matrahı" gibi standart metin DEĞİL — kullanıcı defalarca istedi; dolu/doğru
      //   hesapta da geçerli). Hesap kodu boşsa açıklama da boş. Cari satırı zaten karşı taraf adını yazar.
      //   vergi-sorumlu + tevkifat DA dahil: kullanıcı bulgusu — bu iki satırın açıklaması rematch'te
      //   GÜNCELLENMİYORDU, linesFromAmounts'taki SABİT metin (gerçek plan adı değil) kalıcı kalıyordu.
      {
        const freshLines = await (this.prisma as any).invoiceAccountingLine.findMany({ where: { documentId: doc.id } });
        for (const ln of freshLines) {
          const g = String(ln.group || '');
          if (g !== 'matrah' && g !== 'vergi' && g !== 'vergi-sorumlu' && g !== 'tevkifat') continue;
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
        // ZENGİN AI YORUMU + DENETÇİ (Katman 2): eskiden HER reapply'da KOŞULSUZ siliniyordu → hesap kodu
        //   DEĞİŞMESE bile yorum uçuyor, belge açılınca 14sn yeniden üretiliyordu (kullanıcı: "AI değerlendirmesi/
        //   denetçi hemen düşmüyor"). ARTIK yalnız MATRAH HESABI GERÇEKTEN DEĞİŞTİYSE bayat sayılıp silinir;
        //   kod aynıysa yorum+denetçi KORUNUR → tekrar açılışta ANINDA görünür, gereksiz Max çağrısı da olmaz.
        const eskiMatrahKod = String((doc.lines || []).find((l: any) => String(l.group || '') === 'matrah' && String(l.accountCode || '').trim())?.accountCode || '').trim();
        const yeniMatrahKod = String((matrahAccForNeden as any)?.accountCode || '').trim();
        const kodDegisti = eskiMatrahKod !== yeniMatrahKod;
        const hadZengin = !!String(prevOcr.muhasebeNedenZengin || '');
        const nedenChanged = neden && String(prevOcr.muhasebeNeden || '') !== neden;
        // MEVZUAT DENETİMİ (Katman 1) HER EŞLEŞTİRMEDE TAZELE (2026-07-05, kullanıcı: "sadece eşleştirme
        //   yapmasın, tevkifat gibi konuları da kontrol etsin"). Eskiden denetimUyariOlustur YALNIZ okuma
        //   anında çalışıyordu → "Kodları düzelt" sonrası tevkifat/KDV uyarıları güncellenmiyordu. Girdiler
        //   ocrData'dan (matrah/kdv/gider/kalem/tevkifat) — okuma tekrarı GEREKMEZ, kural anlık koşar.
        const _uy = denetimUyariOlustur({
          invoiceKind: isSale ? 'SATIS' : 'ALIS',
          matrah: Number(prevOcr.matrah || 0),
          kdvTutari: Number(prevOcr.kdvTutari || 0),
          giderTuru: String(prevOcr.giderTuru || giderTuru || ''),
          kalemAciklamalari: Array.isArray(prevOcr.kalemler) ? prevOcr.kalemler.map((k: any) => String(k?.ad || '')) : [],
          muhasebeNeden: neden || String(prevOcr.muhasebeNeden || ''),
          kdvOrani: Number(prevOcr.kdvOrani || (Array.isArray(prevOcr.kdvBreakdown) && prevOcr.kdvBreakdown[0]?.oran) || 0),
          tevkifatVar: prevOcr.tevkifatHint === true || Number(prevOcr.tevkifatOrani || 0) > 0,
          isFixedAsset: !!faDet.is,
        });
        // ── KATMAN-1 ANOMALİ (DB-tabanlı, Xero "Bill Protection" benzeri) — yalnız ALIŞ + VKN'li ──
        //   1) ANORMAL_TUTAR: satıcının bu mükellefteki son 12 ONAYLI/Luca'ya gitmiş faturasının
        //      ORTANCASINA göre bu belge 5 kat fazla / 1/5'ten azsa uyarı (en az 4 emsal şart).
        //   2) ILK_KEZ_SATICI: bu satıcıdan daha önce HİÇ onaylı belge yoksa bilgi notu.
        //   Sorgu satıcı başına 1 kez (emsalTutarCache) + yalnız totalAmount select (hafif).
        if (!isSale && vendorVkn) {
          let emsal = emsalTutarCache.get(vendorVkn);
          if (!emsal) {
            const emsalRows = await (this.prisma as any).invoiceAccountingDocument.findMany({
              where: {
                tenantId,
                taxpayerId,
                sellerVkn: vendorVkn,
                invoiceKind: 'ALIS',
                totalAmount: { not: null },
                OR: [{ status: 'APPROVED' }, { lucaStatus: 'POSTED' }],
              },
              orderBy: [{ faturaTarihi: 'desc' }],
              select: { totalAmount: true },
              take: 12,
            }).catch(() => []);
            emsal = (emsalRows as any[]).map((r: any) => Number(r.totalAmount)).filter((n: number) => Number.isFinite(n) && n > 0);
            emsalTutarCache.set(vendorVkn, emsal);
          }
          const belgeTutar = Number(doc.totalAmount || 0);
          if (emsal.length === 0) {
            _uy.push({ kod: 'ILK_KEZ_SATICI', baslik: 'Bu satıcıdan ilk fatura', mesaj: 'Bu satıcıdan daha önce onaylanmış belge yok — cari ve hesap eşleştirmesini bir kez gözden geçir.', siddet: 'bilgi' });
          } else if (emsal.length >= 4 && belgeTutar > 0) {
            const sirali = [...emsal].sort((a, b) => a - b);
            const ortanca = sirali.length % 2 ? sirali[(sirali.length - 1) / 2] : (sirali[sirali.length / 2 - 1] + sirali[sirali.length / 2]) / 2;
            if (ortanca > 0 && (belgeTutar > ortanca * 5 || belgeTutar < ortanca / 5)) {
              const tl = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              _uy.push({ kod: 'ANORMAL_TUTAR', baslik: 'Olağan dışı tutar', mesaj: `Bu satıcının olağan tutarından çok farklı (ortanca ₺${tl(ortanca)}, bu belge ₺${tl(belgeTutar)}) — tutarı ve belgeyi kontrol et.`, siddet: 'uyari' });
            }
          }
        }
        // ── SAPMA KUYRUĞU (portal yolu, Faz4): bu satıcı için GÜÇLÜ öğrenilmiş hafıza varken
        //    eşleştirme FARKLI bir matrah kodu seçtiyse belge sessiz geçmesin. Mihsap yolundaki
        //    detectDeviation/PendingDecision'ın portal karşılığı: uyarı yazılır; approveBatch bu
        //    belgeyi 'hafiza-celiski' sebebiyle atlar (tekil onay engellenmez — kullanıcı belgeyi
        //    açıp bakarak onaylar; onay hafızayı besler, rakip-düşürme yanlış öğrenmeyi söndürür).
        //    Hafıza ZATEN uygulandıysa (kaynak=HAFIZA) ya da kullanıcı elle seçtiyse çelişki yok.
        if (!isSale && !isReturn && vendorVkn) {
          const uygulanan = [...matrahCache.values()].filter(Boolean) as any[];
          const hafizadan = uygulanan.some((m: any) => String(m._kaynak || '') === 'HAFIZA');
          const elleSecili = (doc.lines || []).some((l: any) => String(l.group || '') === 'matrah' && String(l.kaynak || '') === 'KULLANICI');
          if (uygulanan.length && !hafizadan && !elleSecili) {
            let kararlar = sapmaMemCache.get(vendorVkn);
            if (!kararlar) {
              const mem = await (this.prisma as any).vendorMemory.findUnique({
                where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vendorVkn } },
                include: { decisions: { where: { taxpayerId, kararTipi: 'fatura' }, orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }], take: 40 } },
              }).catch(() => null);
              kararlar = ((mem?.decisions || []) as any[]).filter((d: any) => String(d.altKategori || '').trim().toUpperCase() !== 'CARI');
              sapmaMemCache.set(vendorVkn, kararlar);
            }
            // İçerik-imzalı kararlar yalnız BU belgenin imzasına uyuyorsa sayılır (farklı içerik için
            //   öğrenilmiş kod çelişki DEĞİLDİR); imzasız (satıcı-geneli) kararlar her belgeye bakar.
            const imza = String(docIcerikImza || '').trim();
            const ilgili = kararlar.filter((d: any) => {
              const dImza = String(d.icerikImza || '').trim();
              return dImza ? (!!imza && dImza === imza) : true;
            });
            const kodlar = new Set(uygulanan.map((m: any) => String(m.accountCode || '').trim()).filter(Boolean));
            // Hafıza uygulanan kodlardan birini ≥2 onayla ZATEN destekliyorsa çelişki yok.
            const hafizaDestekliyor = ilgili.some((d: any) => (d.onayAdedi || 0) >= 2 && kodlar.has(String(d.kategori || '').trim()));
            // Güçlü karar eşiği = 3 (getHintForVendor MIN_ONAY_FOR_HINT ile aynı).
            const guclu = ilgili.find((d: any) => (d.onayAdedi || 0) >= 3);
            if (kodlar.size && guclu && !hafizaDestekliyor && !kodlar.has(String(guclu.kategori || '').trim())) {
              _uy.push({
                kod: 'HAFIZA_CELISKI',
                baslik: 'Öğrenilmiş hesapla çelişki',
                mesaj: `Bu satıcı için geçmişte ${guclu.onayAdedi} kez "${String(guclu.kategori).trim()}" onaylanmış; bu belgede "${[...kodlar].join(', ')}" seçildi. Toplu onayda atlanır — belgeyi açıp doğru hesabı bilerek onayla.`,
                siddet: 'uyari',
              });
            }
          }
        }
        const prevUy = Array.isArray(prevOcr.uyarilar) ? prevOcr.uyarilar : [];
        const uyChanged = JSON.stringify(_uy) !== JSON.stringify(prevUy);
        // Kod değiştiyse zengin yorum + denetçiyi sil (bayat); değişmediyse ELLEME (koru).
        const zenginDenetimPatch = kodDegisti ? { muhasebeNedenZengin: '', denetim: null } : {};
        if (nedenChanged || (hadZengin && kodDegisti) || uyChanged) {
          await (this.prisma as any).invoiceAccountingDocument.update({
            where: { id: doc.id },
            data: { ocrData: { ...prevOcr, ...(neden ? { muhasebeNeden: neden } : {}), ...zenginDenetimPatch, uyarilar: _uy.length ? _uy : undefined } },
          });
        }
      }
    }
  }

  /** İŞLETME DEFTERİ hafızası: satıcı VKN + mükellef için öğrenilmiş Kayıt Türü / Alt Türü.
   *  kararTipi='isletme', kategori=kayitTuruKod, altKategori=kayitAltKod; içerik-imza öncelikli.
   *  Matrah hafızasıyla aynı eşik (>=2; elle düzeltme onayBoost ile anında geçer). */
  private async pickIsletmeMemory(
    tenantId: string,
    taxpayerId: string,
    vendorVkn: string,
    icerikImza?: string | null,
  ): Promise<{ kayitTuruKod: string; kayitAltKod: string } | null> {
    const vkn = String(vendorVkn || '').replace(/\D/g, '');
    if (!vkn || !taxpayerId) return null;
    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo: vkn } },
      include: {
        decisions: {
          where: { taxpayerId, kararTipi: 'isletme' },
          orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }],
          take: 16,
        },
      },
    });
    const decisions = (memory?.decisions || [])
      .filter((d: any) => /^\d+$/.test(String(d.kategori || '').trim()))
      .filter((d: any) => (d.onayAdedi || 0) >= 2);
    const imza = String(icerikImza || '').trim();
    const byImza = imza ? decisions.find((d: any) => String(d.icerikImza || '').trim() === imza) : null;
    const general = decisions.find((d: any) => !String(d.icerikImza || '').trim());
    const pick = byImza || general;
    if (!pick) return null;
    return { kayitTuruKod: String(pick.kategori).trim(), kayitAltKod: String(pick.altKategori || '').trim() };
  }

  /** Hesap adındaki ORAN-token'ları: yalnız 1-2 haneli sayılar (KDV oranları 1..20). "2024" gibi
   *  yıllar ve "770"/"010" gibi kod parçaları oran SANILMAZ (R7 — kırılgan "adındaki herhangi bir
   *  sayı = oran" varsayımının sertleştirilmesi). */
  private rateTokensOf(accountName: string): string[] {
    return (this.norm(String(accountName || '')).match(/\d+/g) || []).filter((t) => t.length <= 2);
  }

  /** Hesap adında verilen KDV oranı token'ı geçiyor mu (≤2 haneli birebir eşleşme)? */
  private rateTokenInName(accountName: string, rateDigits: string): boolean {
    const r = String(rateDigits || '').replace(/[^0-9]/g, '');
    if (!r) return false;
    return this.rateTokensOf(accountName).includes(r);
  }

  private async pickVendorMemoryAccount(
    tenantId: string,
    taxpayerId: string,
    firmaKimlikNo: string,
    accounts: Array<{ accountCode: string; accountName: string }>,
    rate?: string | null,
    icerikImza?: string | null,   // YENİ: belgenin kalem-içerik imzası (içerik-bazlı öğrenme okuması)
  ) {
    if (!firmaKimlikNo || !taxpayerId || !accounts.length) return null;
    const accountByCode = new Map(accounts.map((account) => [String(account.accountCode || '').trim(), account]));
    const memory = await (this.prisma as any).vendorMemory.findUnique({
      where: { tenantId_firmaKimlikNo: { tenantId, firmaKimlikNo } },
      include: {
        decisions: {
          where: { taxpayerId, kararTipi: 'fatura' },
          orderBy: [{ onayAdedi: 'desc' }, { sonKullanim: 'desc' }],
          take: 40,
        },
      },
    });
    const decisions = (memory?.decisions || [])
      .filter((d: any) => accountByCode.has(String(d.kategori || '').trim()))
      // Cari (altKategori='CARI') kararları matrah/gider kodu DEĞİLDİR — dışla.
      .filter((d: any) => String(d.altKategori || '').trim().toUpperCase() !== 'CARI')
      // ÖĞRENME EŞİĞİ (R2): tek onaylık karar OTOMATİK uygulanmaz — tek yanlış onay satıcının
      //   tüm gelecek faturalarını çekiyordu. En az 2 onay (elle öğretilen kural onayBoost=3 ile
      //   eşiği anında geçer). Tek onaylı karar "aday" olarak durur, ikinci onayla devreye girer.
      .filter((d: any) => (d.onayAdedi || 0) >= 2);
    const r = String(rate || '').replace(/[^0-9]/g, '');
    const imza = String(icerikImza || '').trim();
    // ÖNCELİK: (1) BU içerik+oran → (2) BU içerik → (3) orana özel (içerik-genel) → (4) tamamen genel.
    //   İçerik-imza eşleşmesi orandan ÖNCE gelir: "bu satıcıdan bu içerik hep şu hesap" kullanıcının
    //   düzelttiği kararı en sadık yansıtır.
    //   NOT (R5): eski "|| decisions[0]" son çaresi KALDIRILDI — ne imzası ne oranı tutan, bambaşka
    //   içerik için öğrenilmiş kod sessizce uygulanıyordu (çapraz bulaşma). Kriter tutmuyorsa null →
    //   sonraki katmanlar (AI/kural) devreye girer.
    const imzaEsit = (d: any) => imza && String(d.icerikImza || '').trim() === imza;
    const byImzaRate = imza && r ? decisions.find((d: any) => imzaEsit(d) && String(d.altKategori || '').replace(/[^0-9]/g, '') === r) : null;
    const byImza = imza ? decisions.find((d: any) => imzaEsit(d)) : null;
    const byRate = r ? decisions.find((d: any) => !String(d.icerikImza || '').trim() && String(d.altKategori || '').replace(/[^0-9]/g, '') === r) : null;
    const general = decisions.find((d: any) => !String(d.icerikImza || '').trim() && !String(d.altKategori || '').trim());
    const pick = byImzaRate || byImza || byRate || general;
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
    // TEK-TOKEN kuralı sıkılaştırıldı: hint tek ayırt edici kelimeye İNDİYSE (UNOX), karşı taraf da
    //   AYNI tek kelimeye inmeli (UNOX GIDA SAN. → {unox} ✓). Aksi halde "ANADOLU LOJİSTİK" ({anadolu})
    //   plandaki HERHANGİ "ANADOLU …" carisiyle (ANADOLU SİGORTA, ANADOLU EFES) eşleşiyordu —
    //   yanlış cariden İYİDİR boş kalması (kullanıcı seçer → VKN hafızasına öğrenilir).
    if (h.length === 1 && nameSet.size > 1) return 0;
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

  private learnedMatrahCompatibleWithContent(code: string, kat: string, giderTuru: string, fixedAsset: boolean): boolean {
    const c = String(code || '').trim();
    const k = String(kat || '').toLowerCase().trim();
    if (!c) return false;
    if (fixedAsset || k === 'demirbas') return /^25/.test(c);
    if (k === 'ticari_mal') return /^(15[03]|153)/.test(c);
    if (k === 'hammadde') return /^(15|73|74)/.test(c);
    if (k === 'pazarlama') return /^(760|770|740|730)/.test(c);
    if (k === 'genel_gider') return !/^(15|25|60)/.test(c);
    if (giderTuru && /^(15|25|60)/.test(c)) return false;
    return true;
  }

  /** Hesap ADI tevkifatı işaret ediyor mu? — KDV hesabı gibi 600/391/191 tevkifat hesapları
   *  ya "TEVKİFAT" kelimesiyle ya da "2/10" tarzı ORAN deseniyle adlandırılır (KDV oranı %20
   *  ile karışmaz: payda /10'dur). İkisini de tanırız ki tevkifat hesabı kaçmasın / normal
   *  satış yanlışlıkla tevkifat hesabına düşmesin. */
  private isTevkifatAccountName(name: string): boolean {
    const n = String(name || '');
    // Türkçe-İ ölüsü: JS'te /i bayrağı 'İ' (U+0130) harfini 'i' ile EŞLEMEZ — "TEVKİFATLI NAKLİYE
    //   GELİRLERİ" adlı plan hesabı tanınmıyordu (Yorgun Nakliyat: matrah 600.01.002 yerine
    //   600.01.001'e düştü). Sınıfa 'İ' açıkça eklendi.
    if (/tevk[iıİ]fat/i.test(n)) return true;
    if (/\b(?:10|[1-9])\s*\/\s*10\b/.test(n)) return true; // 2/10, 5/10, 9/10, 10/10 …
    return false;
  }
}
