/**
 * v1.38 — Luca "Fiş Aktarım Şablonu" Excel üreteci.
 *
 * Luca'nin Toplu Fis Aktarim ekrani şu 14 sütunlu Excel'i kabul eder
 * (örnek dosya: fis_aktarim_sablon.xlsx):
 *
 *   Fiş No | Fiş Tarihi | Fiş Açıklama | Hesap Kodu | Evrak No |
 *   Evrak Tarihi | Detay Açıklama | Borç | Alacak | Miktar |
 *   Belge Türü | Para Birimi | Kur | Döviz Tutar
 *
 * Bu üreteç, bir INVOICE_POST batch job'unun payload'undaki invoice listesini
 * tek bir yevmiye fişine (Fiş No=001, aynı Fiş Tarihi/Açıklama) düşürür.
 * Her invoice'in line'lari ayri ayri Excel satiri olur.
 *
 * Kullanım:
 *   const buffer = await buildLucaImportExcel(jobPayload);
 *   // agent endpoint'inden buffer'i indirir, Luca'ya yukler.
 */

import * as ExcelJS from 'exceljs';
import * as iconv from 'iconv-lite';
import { normalizeDocumentType, isletmeRef, getKayitAltList } from '@mali-musavir/shared';

export interface InvoiceLine {
  group?: string | null;
  accountCode?: string | null;
  description?: string | null;
  rate?: string | null;
  debit?: string | null;
  credit?: string | null;
  orderNo?: number | null;
}

export interface InvoicePayload {
  documentId: string;
  documentType?: string | null;
  invoiceKind?: string | null;
  belgeNo?: string | null;
  seriNo?: string | null;
  faturaTarihi?: string | null;
  sellerVkn?: string | null;
  buyerVkn?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  totalAmount?: string | null;
  currency?: string | null;
  /** Belge kuru (invoiceAccountingDocument.exchangeRate) — döviz faturasında Kur/Döviz Tutar kolonları için. */
  exchangeRate?: string | number | null;
  lines: InvoiceLine[];
  /** İşletme defteri (Defter-Beyan) sınıflandırması — ocrData.isletme'den gelir. */
  isletme?: {
    belgeTuruKod?: string; belgeTuruAd?: string;
    alisSatisKod?: string; alisSatisAd?: string;
    islemTuruKod?: string; islemTuruAd?: string;
    kayitTuruKod?: string; kayitTuruAd?: string;
    kayitAltKod?: string; kayitAltAd?: string;
    kdvOranKod?: string; plakaNo?: string; kayitTarihi?: string;
    matrah?: number; kdvTutar?: number; krediliTutar?: number; donem?: boolean;
    hesapKodu?: string; tevkifatOrani?: string; tevkifatTutar?: number; tevkifatKodu?: string; stopajOrani?: string; stopajTutar?: number; stopajKod?: string;
    /** KDV matrahına dahil olmayan bedel (ÖİV/telsiz/damga …) — Luca 28. sütun; belge okumasından (diger_vergi satırları). */
    digerVergi?: number;
    satirlar?: Array<{ kayitTuruAd?: string; kayitAltAd?: string; kdvOranKod?: string; matrah?: number; kdvTutar?: number; krediliTutar?: number; donem?: boolean; hesapKodu?: string; tevkifatOrani?: string; stopajOrani?: string; stopajTutar?: number }>;
  } | null;
}

export interface BatchPayload {
  mode: 'BATCH_EXCEL';
  taxpayerId: string;
  period: string; // "YYYY-MM"
  totalCount: number;
  invoices: InvoicePayload[];
  /** Kullanici fis no atamak isterse — yoksa 1 default */
  fisNo?: string;
  /** Fis tarihi — yoksa donemin son gunu */
  fisTarihi?: string;
  /** Fis acikalama — yoksa otomatik */
  fisAciklama?: string;
  /** v2.3: Mukellef defter turu — ISLETME ise CSV (Hizli Fis Aktarim) uretilir. */
  defterTuru?: string;
  /** v2.3: ALIS | SATIS — dosya yon etiketi. */
  direction?: string;
  /** v2.3: 'BATCH_EXCEL' (bilanco, xlsx) | 'ISLETME_CSV' (isletme, cp1254 csv). */
  format?: string;
}

const HEADERS = [
  'Fiş No',
  'Fiş Tarihi',
  'Fiş Açıklama',
  'Hesap Kodu',
  'Evrak No',
  'Evrak Tarihi',
  'Detay Açıklama',
  'Borç',
  'Alacak',
  'Miktar',
  'Belge Türü',
  'Para Birimi',
  'Kur',
  'Döviz Tutar',
];

function fmtTr(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(s: string | null | undefined): number {
  if (s == null) return 0;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function inferBelgeTuru(invoice: InvoicePayload): string {
  // Luca'nın GEÇERLİ belge türü KISA KODLARI (kullanıcı Luca'dan verdi). belgeTurKontrol() bu kodları
  // belgeTurList'te arıyor; "E-ARŞİV/E-FATURA" gibi serbest metinler listede OLMADIĞI için reddedilip
  // fisKes() "if(hataliBelgeTuru>0) return" ile SESSİZCE çıkıyor, fiş kesilmiyordu (kök neden).
  // Kodlar: EA=e-Arşiv, EF=e-Fatura, FT=Fatura, PS=Perakende Satış Fişi (ÖKC/yazarkasa), İF=İrsaliyeli
  // Fatura, SM=Serbest Meslek Makbuzu, MK=Makbuz, ÇK=Çek, SN=Senet...
  const t = String(invoice.documentType || '').toUpperCase();
  if (t === 'E_ARSIV') return 'EA';
  if (t === 'E_FATURA') return 'EF';
  if (t === 'OKC_FIS') return 'PS';
  if (t === 'E_SMM') return 'SM';
  return 'FT';
}

/**
 * Bir batch payload'undan Luca Fiş Aktarım Excel'i üretir.
 * Tum invoice'lar tek bir yevmiye fisinde toplanir (kullanici Luca'da boler).
 */
export async function buildLucaImportExcel(payload: BatchPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fiş Aktarım Şablon');

  // Header
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };

  // Fis-level alanlar
  const fisNo = payload.fisNo || '1';
  const [py, pm] = String(payload.period || '').split('-').map((n) => parseInt(n, 10));
  const fisTarihi = payload.fisTarihi
    || (Number.isFinite(py) && Number.isFinite(pm)
        ? fmtTr(new Date(Date.UTC(py, pm, 0))) // ay sonu
        : fmtTr(new Date()));
  const fisAciklama = payload.fisAciklama
    || `${payload.period} dönemi toplu fatura aktarımı (${payload.totalCount} belge)`;

  // Tum invoice'lari Tek fişin satirlari olarak yaz
  for (const inv of payload.invoices) {
    const evrakNo = inv.belgeNo || '-';
    const fatTarihi = parseDate(inv.faturaTarihi);
    const evrakTarihi = fatTarihi ? fmtTr(fatTarihi) : fisTarihi;
    const belgeTuru = inferBelgeTuru(inv);
    const paraBirimi = inv.currency || 'TL';
    // DÖVİZLİ FATURA: belge tutarları BELGE PARA BİRİMİNDE tutulur (UBL LegalMonetaryTotal —
    //   DocumentCurrencyCode; TL'ye çevrilmez). Kur, belgeye kullanıcı/DB'den gelen exchangeRate'tir.
    //   Kur GEÇERLİYSE (>0 ve DB varsayılanı 1 DEĞİL): Kur kolonu = kur, Döviz Tutar = satırın
    //   döviz cinsinden tutarı (Borç/Alacak zaten döviz cinsindedir). Kur yoksa/varsayılansa
    //   MEVCUT davranış korunur (Kur='1', Döviz Tutar boş).
    const isTlPara = paraBirimi === 'TL' || String(paraBirimi).toUpperCase() === 'TRY';
    const kurNum = Number(String(inv.exchangeRate ?? '').replace(',', '.'));
    const kurGecerli = !isTlPara && Number.isFinite(kurNum) && kurNum > 0 && kurNum !== 1;
    // KARŞI TARAF (2026-09-15, NMS LOJİSTİK Ağustos satışları): satış faturasında satıcı = mükellefin kendisi → fiş açıklamasına
    //   hep "NMS LOJİSTİK" yazılıyordu. Satışta MÜŞTERİ, alışta SATICI adı yazılır.
    const invIsSale = String(inv.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
    const detayBase = (invIsSale ? (inv.customerName || inv.vendorName) : (inv.vendorName || inv.customerName)) || '-';

    for (const line of (inv.lines || [])) {
      const debit = parseAmount(line.debit);
      const credit = parseAmount(line.credit);
      // Bos satirlari atla (debit ve credit ikisi de 0 ise)
      if (debit === 0 && credit === 0) continue;
      // Kullanıcı talebi: fiş açıklamasında SADECE firma adı görünsün (matrah/oran/satır açıklaması
      //   YAZMASIN). Luca fiş açıklamasını detay açıklamasından türetiyor → detay = sadece firma adı.
      const detayAciklama = detayBase;

      ws.addRow([
        fisNo,
        fisTarihi,
        fisAciklama,
        line.accountCode || '',
        evrakNo,
        evrakTarihi,
        detayAciklama,
        debit > 0 ? debit : '',
        credit > 0 ? credit : '',
        '', // Miktar — fatura satırlarında genelde boş
        belgeTuru,
        paraBirimi,
        isTlPara ? '' : (kurGecerli ? kurNum : '1'), // Kur (TL ise boş; döviz + geçerli kur varsa kur)
        kurGecerli ? (debit > 0 ? debit : credit) : '', // Döviz Tutar (satırın döviz cinsinden tutarı)
      ]);
    }
  }

  // Numeric kolonlar icin format
  ws.getColumn(8).numFmt = '#,##0.00'; // Borç
  ws.getColumn(9).numFmt = '#,##0.00'; // Alacak

  // Sutun genislikleri
  const widths = [8, 12, 40, 16, 18, 12, 50, 14, 14, 10, 12, 10, 8, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─────────────────────────────────────────────────────────────────────
// İşletme / Serbest Meslek Defteri — Luca "Hızlı Fiş Aktarım" CSV Formatı
// Yol: İşletme Defteri → Gelir Gider İşlemleri → Gelir Gider Girişi →
//      "Excel Aktarım" → indirilen şablon.
// Şablon: 36 sütun, NOKTALI VİRGÜL (;) ayraçlı, cp1254 (Windows-Türkçe) kodlu CSV.
// Başlık satırı, Luca'nın indirdiği gerçek dosyadan BYTE-BYTE alınmıştır
// (örn. "BELGE TURU", "FAALIYET KODU" yazımları Luca'nınkiyle birebir aynı).
// ─────────────────────────────────────────────────────────────────────

// Luca "Hızlı Fiş" Excel Aktarım şablonu — 37 sütun (kullanıcı şablonu doğrulandı). cp1254 yazılır.
// ÖNEMLİ: "PLAKA NO" (19. sütun) önceki sürümde EKSİKTİ → sonraki tüm sütunlar 1 kayıyordu (veri yanlış
//   alana düşüyordu, İşletme yüklemesini bozuyordu). Şablona birebir uyduruldu.
// LUCA RESMİ ŞABLONU — 36 SÜTUN (2026-09-15, Luca HIZLI FİŞ › Excel Aktarım › "Excel Şablonu indir":
//   hizliFisCsvSablonIndirAction.do; ajan v1.47.45 canlıdan çekti). Eski 37 sütunlu başlıkta PLAKA NO vardı;
//   Luca yüklemeyi "2. SATIRDA HATA ALINDI … Sütun sayısı 36'dan fazladır" diye SESSİZCE reddediyordu
//   (Kadir Ceylan Korkmaz 29 Z raporu, Ayşegül Arslan 8 fatura). Şablonda PLAKA NO sütunu YOK; başlık metni birebir.
const ISLETME_HEADER =
  'İŞLEM;KATEGORİ;BELGE TURU;EVRAK TARİHİ;KAYIT TARİHİ;SERİ NO;EVRAK NO;TCKN/VKN;VERGİ DAİRESİ;SOYADI ÜNVAN;ADI DEVAMI;ADRES;CARİ HESAP;KDV İSTİSNASI;KOD;BELGE TÜRÜ(DB);ALIŞ/SATIŞ TÜRÜ;KAYIT ALT TÜRÜ;MAL VE HİZMET KODU;AÇIKLAMA;MİKTAR;B.FİYAT;TUTAR;TEVKİFAT;KDV ORANI;ÖZEL MATRAH İŞLEM BEDELİ;MATRAHTAN DÜŞÜLECEK TUTAR;MATRAHA DAHİL OLMAYAN BEDEL;KDV TUTARI;TOPLAM TUTAR;KREDİLİ TUTAR;STOPAJ KODU;STOPAJ TUTARI;DÖNEMSELLİK İLKESİ;FAALIYET KODU;ÖDEME TÜRÜ';
export const ISLETME_CSV_SUTUN_SAYISI = 36;

/** cp1254 CSV hucresi — ; veya tirnak/yeni satir varsa tirnakla. GUVENLIK: =,+,-,@ ile baslayan
 *  metin (cari/firma adi fatura icerigi) Excel/LibreOffice'te FORMUL calisir → basina apostrof koy. */
function csvCell(v: any): string {
  let s = v == null ? '' : String(v);
  // Formul enjeksiyonu: SADECE sayisal OLMAYAN hucrelerde (isim/aciklama) basina apostrof — negatif
  //   tutar (-100,50) gibi sayisal alanlar BOZULMAZ (Luca ice aktarimi guvende). Gercek isim =,+,@ ile baslamaz.
  const isNumeric = /^[-+]?[\d.,]+$/.test(s);
  if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Tutari Turkce ondalik (virgul) ile, binlik ayraci olmadan yazar. */
function trAmount(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2).replace('.', ',');
}

/**
 * İşletme/serbest meslek mukellefi icin Luca "Hızlı Fiş Aktarım" CSV'si uretir.
 * İşletme defteri TEK TARAFLI (gelir/gider) oldugundan her fatura = bir satir.
 * Tutarlar fis satirlarindan (group: matrah/vergi) turetilir.
 *
 * DİKKAT: Şablonda Luca'nin ornek satiri YOKTU. Asagidaki enum-degerli alanlar
 * (İŞLEM, BELGE TURU, ALIŞ/SATIŞ TÜRÜ, ÖDEME TÜRÜ) Luca'nin bekledigi kesin
 * etiketlerle CANLI denemede dogrulanmalidir — bu yuzden tek noktada toplandi.
 */
/**
 * Luca "Hesap Planı Aktar" (Muhasebe → Hesap Planı İşlemleri) için toplu hesap CSV'si.
 * Şablon (cp1254, ; ayraç): Hesap Kodu*;Hesap Adı*;Vergi No;Vergi Dairesi;T.C. Kimlik No;Adres;Döviz;E-Posta;Kdv Oran;Kdv Hesap Kodu
 * Cari hesapta VKN 10 hane → "Vergi No"; 11 hane → "T.C. Kimlik No". Diğer alanlar boş.
 */
export function buildAccountPlanCsv(
  accounts: Array<{ accountCode: string; accountName: string; isCari?: boolean; vkn?: string | null }>,
): Buffer {
  const HEADER = 'Hesap Kodu*;Hesap Adı*;Vergi No;Vergi Dairesi;T.C. Kimlik No;Adres;Döviz;E-Posta;Kdv Oran;Kdv Hesap Kodu';
  const esc = (v: any) => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();
  const lines: Buffer[] = [iconv.encode(HEADER + '\r\n', 'win1254')];
  for (const a of accounts) {
    const vkn = String(a.vkn || '').replace(/\D/g, '');
    const isTckn = vkn.length === 11;
    const vergiNo = a.isCari && vkn && !isTckn ? vkn : ''; // 10 haneli VKN
    const tckn = a.isCari && isTckn ? vkn : '';            // 11 haneli TCKN
    const cols = [esc(a.accountCode), esc(a.accountName), vergiNo, '', tckn, '', '', '', '', ''];
    lines.push(iconv.encode(cols.join(';') + '\r\n', 'win1254'));
  }
  return Buffer.concat(lines);
}

/** İşletme HIZLI FİŞ CSV kodlaması (2026-09-15, AYTEKİN ÖZDEMİR bulgusu): Luca yükleme okuyucusu cp1254 okur (UTF-8 gönderince
 *  KATEGORİ "Defter Fişleri" eşleşmedi) ama "Soyadı Ünvan" denetimi Türkçe harfli adı ("GÜNYER OTOMOTİV…", "İHSAN KUNUR")
 *  "özel karakter bulunduramaz" diye reddediyor; yalnız ASCII adlar (Z RAPORU) geçiyordu. Varsayılan cp1254 + ünvanda
 *  Türkçe harf katlama. LUCA_ISLETME_CSV_KODLAMA = win1254 (varsayılan) | utf8 | utf8bom.
 *  LUCA_ISLETME_UNVAN_ASCII: 'I' = yalnız İ→I (Luca'nın beyaz listesinde büyük İ eksik olabilir), '1' (varsayılan) = tüm
 *  Türkçe harfler ASCII, '2' = harfler + noktalama boşluğa, '0' = kapalı. */
function isletmeCsvKodlama(): 'utf8' | 'utf8bom' | 'win1254' {
  const v = String(process.env.LUCA_ISLETME_CSV_KODLAMA || 'win1254').trim().toLowerCase();
  return v === 'utf8' ? 'utf8' : v === 'utf8bom' ? 'utf8bom' : 'win1254';
}
function isletmeCsvKodla(metin: string): Buffer {
  return isletmeCsvKodlama() === 'win1254' ? iconv.encode(metin, 'win1254') : Buffer.from(metin, 'utf8');
}
export function isletmeUnvanDuzelt(ad: string): string {
  let s = String(ad || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const kip = String(process.env.LUCA_ISLETME_UNVAN_ASCII ?? '1').trim();
  if (kip === '0') return s;
  if (kip.toUpperCase() === 'I') return s.replace(/İ/g, 'I');
  const tablo: Record<string, string> = { 'İ': 'I', 'ı': 'i', 'Ş': 'S', 'ş': 's', 'Ğ': 'G', 'ğ': 'g', 'Ü': 'U', 'ü': 'u', 'Ö': 'O', 'ö': 'o', 'Ç': 'C', 'ç': 'c' };
  s = s.replace(/[İıŞşĞğÜüÖöÇç]/g, (c) => tablo[c] || c);
  if (kip === '2') s = s.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function buildLucaIsletmeHizliFisCsv(payload: BatchPayload): Buffer {
  const isSaleKind = (k?: string | null) => String(k || 'ALIS').toUpperCase() === 'SATIS';
  const kodlama = isletmeCsvKodlama();
  const lines: Buffer[] = [isletmeCsvKodla((kodlama === 'utf8bom' ? '\ufeff' : '') + ISLETME_HEADER)];

  for (const inv of payload.invoices) {
    const isSale = isSaleKind(inv.invoiceKind);
    // Fiş satırlarından toplam (geriye uyum / kdvBreakdown yoksa)
    let lineMatrah = 0, lineKdv = 0, lineDiger = 0, rate = '';
    for (const l of inv.lines || []) {
      // IADE belgede yon cevrilmis (satista matrah BORC) → dolu olan tarafi al; normal belgede eskisi gibi.
      const amt = Number(isSale ? l.credit : l.debit) || Number(isSale ? l.debit : l.credit) || 0;
      // KDV DIŞI VERGİ (ÖİV/telsiz/damga) — 2026-09-15: eskiden TUTAR'a (KDV matrahı) katılıyordu → Luca'nın KDV'si
      //   (TUTAR × oran) belgedekiyle tutmuyordu. Artık 28 "MATRAHA DAHİL OLMAYAN BEDEL" (DBS alanı; toplam yine kapsar).
      if (l.group === 'matrah') lineMatrah += amt;
      else if (l.group === 'diger_vergi') lineDiger += amt;
      else if (l.group === 'vergi' || l.group === 'vergi-sorumlu') { lineKdv += amt; if (!rate && l.rate) rate = String(l.rate).replace(/[%\s]/g, ''); }
    }
    lineDiger = Math.round(lineDiger * 100) / 100;
    const fatTarihi = parseDate(inv.faturaTarihi);
    const tarihStr = fatTarihi ? fmtTr(fatTarihi) : '';
    const counterpartyVkn = isSale ? (inv.buyerVkn || '') : (inv.sellerVkn || '');
    const counterpartyName = isletmeUnvanDuzelt(isSale ? (inv.customerName || '') : (inv.vendorName || ''));
    const isl: any = inv.isletme || {};
    const islKayitTarih = (() => { const kd = isl.kayitTarihi ? parseDate(isl.kayitTarihi) : null; return kd ? fmtTr(kd) : tarihStr; })();

    // ÇOKLU SATIR: her İşletme satırı (farklı KDV oranı / gider türü) AYRI CSV satırı.
    const satirlar: any[] = Array.isArray(isl.satirlar) && isl.satirlar.length
      ? isl.satirlar
      : [{ kayitTuruAd: isl.kayitTuruAd, kayitAltAd: isl.kayitAltAd, kdvOranKod: isl.kdvOranKod, matrah: isl.matrah ?? lineMatrah, kdvTutar: isl.kdvTutar ?? lineKdv, krediliTutar: isl.krediliTutar, donem: isl.donem, hesapKodu: isl.hesapKodu, tevkifatOrani: isl.tevkifatOrani, stopajOrani: isl.stopajOrani, stopajTutar: isl.stopajTutar, digerVergi: isl.digerVergi ?? lineDiger }];

    // KOD→AD ÇÖZÜMÜ: belge Muhasebeleştir formunda AÇILMADAN otomatik sınıflanıp onaylandıysa
    //   ...Ad alanları BOŞ olur; eskiden CSV bunları sabit "Normal Alım/Satış" ya da boş yazıyordu
    //   (doğru KOD üretilse bile Luca'ya YANLIŞ etiket gidiyordu). Artık koddan ad çözülür.
    const ref = isletmeRef(inv.invoiceKind);
    const adOf = (list: any[], kod: any) => (list || []).find((x: any) => String(x.kod) === String(kod || ''))?.ad || '';
    const alisSatisAdResolved = isl.alisSatisAd || adOf(ref.alisSatisTuru, isl.alisSatisKod) || (isSale ? 'Normal Satış' : 'Normal Alım');
    const belgeTuruAdResolved = isl.belgeTuruAd || adOf(ref.belgeTuru, isl.belgeTuruKod) || inferIsletmeBelgeTuru(inv);

    // LUCA HIZLI FİŞ SÜTUN ANLAMLARI (2026-09-15, Luca'nın CSV doğrulama mesajları + hizliFisPopup.js sözlükleri):
    //   2 KATEGORİ  = fiş kategorisi: "Defter Fişleri" | "Personel Fişleri" | "Serbest Meslek Fişleri" | "Sabit Kıymet Fişleri"
    //                 (eskiden DBS kayıt türü adı "Mal Satışı" yazılıyordu → "KATEGORI sütunu … değerlerinden biri olabilir" reddi)
    //   3 BELGE TURU = Luca fiş türü: Gelir → Satış | Diğer Satışlar | Alıştan İade | Diğer Alıştan İade | Z Raporu | Envanter;
    //                 Gider → Alış | Diğer Alışlar | Satıştan İade | Diğer Satıştan İadeler | Devir (eskiden DBS belge adı yazılıyordu)
    //   15 KOD      = 14 KDV İSTİSNASI tablosunun KOD'u. Normal satışta 1100 (Yurtiçi Teslim ve Hizmetler),
    //                 kısmi tevkifatta tevkifat kodu (6xx). 2026-09-23'e kadar boş bırakılıyordu — yanlıştı.
    //   16 BELGE TÜRÜ(DB) = Defter-Beyan belge türü ADI (Z Raporu, e-Arşiv, e-Fatura, Fatura, ÖKC Fişi …)
    //   24 TEVKİFAT = Luca sözlüğü: 2/10, 3/10, 4/10, 5/10, 7/10, 9/10, Tam (10/10 → Tam)
    const isZ = normalizeDocumentType(inv.documentType) === 'Z_RAPORU';
    const iadeMi = /iade/i.test(String(alisSatisAdResolved || ''));
    // 3 BELGE TURU (2026-09-15, Muzaffer Bey): giderde "Alış" YALNIZ mal alışıdır (kayıt türü "Mal Alışı"); masraf
    //   (İndirilecek Giderler, KKEG, bordro, sabit kıymet…) "Diğer Alışlar" — aksi halde Luca giderleri mal alışı sayıyordu.
    //   Satışta "Satış" olduğu gibi (Muzaffer Bey satış kaydında bu alanı sorun etmedi).
    const lucaFisTuruFor = (kayitTuruAd: string, kayitTuruKod: string) => {
      if (isSale) return isZ ? 'Z Raporu' : (iadeMi ? 'Alıştan İade' : 'Satış');
      if (iadeMi) return 'Satıştan İade';
      const malAlisi = String(kayitTuruKod || '') === '1' || /^mal\s+al/i.test(String(kayitTuruAd || '').trim());
      return malAlisi ? 'Alış' : 'Diğer Alışlar';
    };
    const lucaTevkifat = (v: any) => { const t = String(v || '').trim(); return t === '10/10' ? 'Tam' : t; };
    // TEVKİFATLI SATIŞ (2026-09-15, NÜLÜFER BEYHAN): Luca'da Satış Türü "Kısmi Tevkifat Uygulanan İşlemler" (10/10 → "İsteğe
    //   Bağlı Tam Tevkifat Uygulanan İşlemler"), KDV Tablo Türü "Tablo 2(KISMİ TEVKİFAT UYGULANAN İŞLEMLER)", Kodu 614 (servis
    //   taşımacılığı) ve tevkifat oranı — eskiden hepsi boş/Tablo 1 gidiyor, elle düzeltiliyordu.
    const tevkPayOf = (v: any) => { const m = String(v || '').trim().match(/^(\d{1,2})\s*\/\s*10$/); return m ? Number(m[1]) : 0; };
    // 32 STOPAJ KODU — Luca stopaj_oranlari listesinin ETİKETİ (kod değil, oran değil; 2026-09-15 canlı liste):
    //   022 SMM (%20) → "Diğer Serbest Meslek Kazancı Ödemeleri (GVK Md. 94/2-b)"; 041 işyeri kirası (%20) → "70'nci Maddede …
    //   (GVK Md. 94/5)". Eskiden st.stopajOrani ("20") yazılıyordu → Luca "STOPAJ KODU sütunu …" reddi (tüm parti düşer).
    const STOPAJ_ETIKET: Record<string, string> = {
      '022': 'Diğer Serbest Meslek Kazancı Ödemeleri (GVK Md. 94/2-b)',
      '021': "18'nci Madde Kapsamına Giren Ödemeler (GVK Md. 94/2-a)",
      '041': "70'nci Maddede Yazılı Mal ve Hakların Kiralanması Karşılığı Yapılan Ödemeler (GVK Md. 94/5)",
    };
    const stopajEtiketi = (st: any): string => {
      if (isSale) return '';
      const kod = String(st.stopajKod || isl.stopajKod || '').replace(/\D/g, '').padStart(3, '0');
      if (STOPAJ_ETIKET[kod]) return STOPAJ_ETIKET[kod];
      // Kod yok ama kullanıcı oran girmiş: SMM belgesinde 022 kabul edilir; başka bağlamda uydurulmaz.
      const oran = Number(String(st.stopajOrani || '').replace(',', '.')) || 0;
      if (oran > 0 && /SMM|SERBEST\s*MESLEK/i.test(`${belgeTuruAdResolved} ${normalizeDocumentType(inv.documentType) || ''}`)) return STOPAJ_ETIKET['022'];
      return '';
    };
    // 17 ALIŞ/SATIŞ TÜRÜ — Luca'nın satış türü adları (CSV doğrulama mesajı 2026-09-15): "Normal Satışlar", "Kısmi İstisna
    //   Kapsamına Giren İşlemler", "Tam İstisna Kapsamına Giren İşlemler", "Özel Matraha Tabi İşlemler", "Diğer" (Mihsap adları
    //   "Normal Satış" / "Özel Matrah" reddediliyordu).
    const lucaAlisSatisTuru = (ad: string) => {
      const t = String(ad || '').trim();
      if (isSale) {
        if (/^normal\s+sat/i.test(t)) return 'Normal Satışlar';
        if (/^özel\s+matrah/i.test(t)) return 'Özel Matraha Tabi İşlemler';
        if (/^diğer\s+işlemler/i.test(t)) return 'Diğer';
      }
      return t;
    };

    for (const st of satirlar) {
      const kdvOranNum = ({ KDV20: '20', KDV10: '10', KDV1: '1', KDV0: '0' } as Record<string, string>)[String(st.kdvOranKod || '')] || rate || '';
      const tevkOranTxt = String(st.tevkifatOrani || isl.tevkifatOrani || '').trim();
      const tevkPay = tevkPayOf(tevkOranTxt);
      const satisTevkifatli = isSale && tevkPay > 0;
      const tamTevkifat = tevkPay >= 10;
      // KDV İSTİSNASI + KOD (2026-09-23, Muzaffer Bey'in HIZLI FİŞ ekranı):
      //   Bu iki alan NORMAL satışta da DOLU olmalı. Eskiden yalnız tevkifatlıda dolduruluyordu;
      //   boş kalınca Luca ekranda "KDV İstisnası" ve "Kod" kutularını boş bırakıyor.
      //   · Normal satış  → Tablo 1(TEVKİFAT UYGULANMAYAN İŞLEMLER) + kod 1100 (Yurtiçi Teslim ve Hizmetler)
      //   · Kısmi tevkifat → Tablo 2(KISMİ TEVKİFAT UYGULANAN İŞLEMLER) + tevkifat kodu (6xx)
      //   · Tam tevkifat   → Tablo (İSTEĞE BAĞLI TAM TEVKİFAT UYGULANAN İŞLEMLER)
      //   ALIŞ satırlarında bu alanlar kullanılmaz → boş.
      const kdvIstisnasi = isSale
        ? (satisTevkifatli
            ? (tamTevkifat ? 'Tablo (İSTEĞE BAĞLI TAM TEVKİFAT UYGULANAN İŞLEMLER)' : 'Tablo 2(KISMİ TEVKİFAT UYGULANAN İŞLEMLER)')
            : 'Tablo 1(TEVKİFAT UYGULANMAYAN İŞLEMLER)')
        : '';
      const tevkifatKod = satisTevkifatli
        ? String(isl.tevkifatKodu || '').replace(/\D/g, '')
        : (isSale ? '1100' : '');
      const alisSatisTuruCsv = satisTevkifatli
        ? (tamTevkifat ? 'İsteğe Bağlı Tam Tevkifat Uygulanan İşlemler' : 'Kısmi Tevkifat Uygulanan İşlemler')
        : lucaAlisSatisTuru(alisSatisAdResolved);
      // Satır KATEGORİ/ALT ad'ı da koddan çözülür (auto-sınıfta boş kalmasın).
      const kayitTuruAdResolved = st.kayitTuruAd || adOf(ref.kayitTuru, st.kayitTuruKod);
      const kayitAltList = getKayitAltList(inv.invoiceKind, String(st.kayitTuruKod || '')) as any[];
      const kayitAltItem = (kayitAltList || []).find((x: any) => String(x.kod) === String(st.kayitAltKod || ''));
      const kayitAltAdResolved = st.kayitAltAd || kayitAltItem?.ad || '';
      // DÖNEMSELLİK: üretim yolları st.donem'i hiç doldurmuyordu → kolon 35 hep boştu.
      //   Referans listesindeki alt-tür kaydının donem bayrağından türet (elle set edilen değer önde).
      const donemFlag = st.donem != null ? !!st.donem : !!kayitAltItem?.donem;
      const stMatrah = Number(st.matrah) || 0;
      const stKdv = Number(st.kdvTutar) || 0;
      // KDV dışı vergi: çok satırlı belgede yalnız İLK satıra yazılır (belge başına tek tutar; iki kez sayılmasın).
      const stDiger = satirlar.indexOf(st) === 0 ? (Number(st.digerVergi ?? isl.digerVergi ?? lineDiger) || 0) : 0;
      const stStopajEtiket = stopajEtiketi(st);
      const stStopajTutar = Number(st.stopajTutar) || (stStopajEtiket ? Number(isl.stopajTutar) || 0 : 0);
      // 36 sutun — Luca şablonu sırasıyla. Üst bilgi (isl) tüm satırlarda aynı; satıra özgü alanlar (st).
      //   PLAKA NO şablonda yok (ekranda var, CSV'de yok) — isl.plakaNo CSV'ye yazılamaz.
      const rowCells: string[] = [
        isSale ? 'Gelir' : 'Gider',                  // 1 İŞLEM
        'Defter Fişleri',                             // 2 KATEGORİ (fiş kategorisi; FM demirbaş/bordro/SMM fişi üretmez)
        lucaFisTuruFor(kayitTuruAdResolved, String(st.kayitTuruKod || '')), // 3 BELGE TURU (Satış | Z Raporu | Alış (mal) | Diğer Alışlar (masraf) | iade)
        tarihStr,                                     // 4 EVRAK TARİHİ
        islKayitTarih,                                // 5 KAYIT TARİHİ
        inv.seriNo || '',                             // 6 SERİ NO
        inv.belgeNo || '',                            // 7 EVRAK NO
        counterpartyVkn,                              // 8 TCKN/VKN
        '',                                           // 9 VERGİ DAİRESİ
        counterpartyName,                             // 10 SOYADI ÜNVAN
        '',                                           // 11 ADI DEVAMI
        '',                                           // 12 ADRES
        st.hesapKodu || '',                           // 13 CARİ HESAP
        kdvIstisnasi,                                 // 14 KDV İSTİSNASI (KDV tablo türü: tevkifatlı satışta Tablo 2 / isteğe bağlı tam)
        tevkifatKod,                                  // 15 KOD (normal satış 1100 · kısmi tevkifat 6xx)
        belgeTuruAdResolved,                          // 16 BELGE TÜRÜ(DB) — Defter-Beyan belge türü ADI
        alisSatisTuruCsv,                             // 17 ALIŞ/SATIŞ TÜRÜ (Luca adları; tevkifatlı satışta Kısmi Tevkifat …)
        kayitAltAdResolved,                           // 18 KAYIT ALT TÜRÜ
        '',                                           // 19 MAL VE HİZMET KODU
        counterpartyName || '',                       // 20 AÇIKLAMA
        '',                                           // 21 MİKTAR
        '',                                           // 22 B.FİYAT
        trAmount(stMatrah),                           // 23 TUTAR
        lucaTevkifat(tevkOranTxt),                    // 24 TEVKİFAT (2/10 … 9/10, Tam) — satır yoksa belge okuması (isletme.tevkifatOrani)
        kdvOranNum,                                   // 25 KDV ORANI
        '',                                           // 26 ÖZEL MATRAH İŞLEM BEDELİ
        '',                                           // 27 MATRAHTAN DÜŞÜLECEK TUTAR
        stDiger > 0 ? trAmount(stDiger) : '',         // 28 MATRAHA DAHİL OLMAYAN BEDEL (ÖİV/telsiz/damga — KDV matrahı dışı)
        trAmount(stKdv),                              // 29 KDV TUTARI
        trAmount(stMatrah + stKdv + stDiger),         // 30 TOPLAM TUTAR (satır; KDV dışı vergi dahil)
        st.krediliTutar ? trAmount(Number(st.krediliTutar)) : '', // 31 KREDİLİ TUTAR
        stStopajEtiket,                               // 32 STOPAJ KODU (Luca etiketi; 022 SMM / 041 kira)
        stStopajEtiket && stStopajTutar > 0 ? trAmount(stStopajTutar) : '', // 33 STOPAJ TUTARI
        donemFlag ? 'Evet' : '',                      // 34 DÖNEMSELLİK İLKESİ
        '',                                           // 35 FAALIYET KODU
        '',                                           // 36 ÖDEME TÜRÜ
      ];
      // SONDA (yalnız teşhis, 2026-09-15): LUCA_ISLETME_CSV_SONDA=kayitAlt → 18. sütun bilerek geçersiz → Luca satırı yazmaz,
      //   hata mesajı hangi sütunda durduğunu söyler (önceki sütunların — KDV İSTİSNASI/KOD/ALIŞ-SATIŞ TÜRÜ — kabul edildiği anlaşılır).
      if (process.env.LUCA_ISLETME_CSV_SONDA === 'kayitAlt') rowCells[17] = 'XXPROBE-SONDA';
      const row = rowCells.map(csvCell).join(';');
      if (row.split(';').length !== ISLETME_CSV_SUTUN_SAYISI && !/"/.test(row)) throw new Error(`İşletme CSV satırı ${row.split(';').length} sütun — Luca şablonu ${ISLETME_CSV_SUTUN_SAYISI} ister`);
      lines.push(isletmeCsvKodla(row));
    }
  }

  const sep = Buffer.from('\r\n', 'ascii');
  const out: Buffer[] = [];
  lines.forEach((b, i) => { if (i > 0) out.push(sep); out.push(b); });
  return Buffer.concat(out);
}

function inferIsletmeBelgeTuru(inv: InvoicePayload): string {
  const t = normalizeDocumentType(inv.documentType);
  if (t === 'E_FATURA') return 'E-Fatura';
  if (t === 'E_ARSIV') return 'E-Arşiv Fatura';
  if (t === 'OKC_FIS') return 'Fiş';
  if (t === 'E_SMM') return 'Serbest Meslek Makbuzu';
  if (t === 'Z_RAPORU') return 'Z Raporu';
  return 'Fatura';
}
