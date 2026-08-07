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
    hesapKodu?: string; tevkifatOrani?: string; tevkifatTutar?: number; stopajOrani?: string; stopajTutar?: number;
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
    const detayBase = inv.vendorName || inv.customerName || '-';

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
const ISLETME_HEADER =
  'İŞLEM;KATEGORİ;BELGE TÜRÜ;EVRAK TARİHİ;KAYIT TARİHİ;SERİ NO;EVRAK NO;TCKN/VKN;VERGİ DAİRESİ;SOYADI ÜNVAN;ADI DEVAMI;ADRES;CARİ HESAP;KDV İSTİSNASI;KOD;BELGE TÜRÜ(DB);ALIŞ/SATIŞ TÜRÜ;KAYIT ALT TÜRÜ;PLAKA NO;MAL VE HİZMET KODU;AÇIKLAMA;MİKTAR;B.FİYAT;TUTAR;TEVKİFAT;KDV ORANI;İŞLEM BEDELİ;MATRAHTAN DÜŞÜLECEK TUTAR;ÖZEL MATRAH ŞEKLİNE DAHİL OLMAYAN BEDEL;KDV TUTARI;TOPLAM TUTAR;KREDİLİ TUTAR;STOPAJ KODU;STOPAJ TUTARI;DÖNEMSELLIK İLKESİ;FAALIYET KODU;ÖDEME TÜRÜ';

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

export function buildLucaIsletmeHizliFisCsv(payload: BatchPayload): Buffer {
  const isSaleKind = (k?: string | null) => String(k || 'ALIS').toUpperCase() === 'SATIS';
  const lines: Buffer[] = [iconv.encode(ISLETME_HEADER, 'win1254')];

  for (const inv of payload.invoices) {
    const isSale = isSaleKind(inv.invoiceKind);
    // Fiş satırlarından toplam (geriye uyum / kdvBreakdown yoksa)
    let lineMatrah = 0, lineKdv = 0, rate = '';
    for (const l of inv.lines || []) {
      const amt = Number(isSale ? l.credit : l.debit) || 0;
      if (l.group === 'matrah') lineMatrah += amt;
      else if (l.group === 'vergi' || l.group === 'vergi-sorumlu') { lineKdv += amt; if (!rate && l.rate) rate = String(l.rate).replace(/[%\s]/g, ''); }
    }
    const fatTarihi = parseDate(inv.faturaTarihi);
    const tarihStr = fatTarihi ? fmtTr(fatTarihi) : '';
    const counterpartyVkn = isSale ? (inv.buyerVkn || '') : (inv.sellerVkn || '');
    const counterpartyName = isSale ? (inv.customerName || '') : (inv.vendorName || '');
    const isl: any = inv.isletme || {};
    const islKayitTarih = (() => { const kd = isl.kayitTarihi ? parseDate(isl.kayitTarihi) : null; return kd ? fmtTr(kd) : tarihStr; })();

    // ÇOKLU SATIR: her İşletme satırı (farklı KDV oranı / gider türü) AYRI CSV satırı.
    const satirlar: any[] = Array.isArray(isl.satirlar) && isl.satirlar.length
      ? isl.satirlar
      : [{ kayitTuruAd: isl.kayitTuruAd, kayitAltAd: isl.kayitAltAd, kdvOranKod: isl.kdvOranKod, matrah: isl.matrah ?? lineMatrah, kdvTutar: isl.kdvTutar ?? lineKdv, krediliTutar: isl.krediliTutar, donem: isl.donem, hesapKodu: isl.hesapKodu, tevkifatOrani: isl.tevkifatOrani, stopajOrani: isl.stopajOrani, stopajTutar: isl.stopajTutar }];

    // KOD→AD ÇÖZÜMÜ: belge Muhasebeleştir formunda AÇILMADAN otomatik sınıflanıp onaylandıysa
    //   ...Ad alanları BOŞ olur; eskiden CSV bunları sabit "Normal Alım/Satış" ya da boş yazıyordu
    //   (doğru KOD üretilse bile Luca'ya YANLIŞ etiket gidiyordu). Artık koddan ad çözülür.
    const ref = isletmeRef(inv.invoiceKind);
    const adOf = (list: any[], kod: any) => (list || []).find((x: any) => String(x.kod) === String(kod || ''))?.ad || '';
    const alisSatisAdResolved = isl.alisSatisAd || adOf(ref.alisSatisTuru, isl.alisSatisKod) || (isSale ? 'Normal Satış' : 'Normal Alım');
    const belgeTuruAdResolved = isl.belgeTuruAd || adOf(ref.belgeTuru, isl.belgeTuruKod) || inferIsletmeBelgeTuru(inv);

    for (const st of satirlar) {
      const kdvOranNum = ({ KDV20: '20', KDV10: '10', KDV1: '1', KDV0: '0' } as Record<string, string>)[String(st.kdvOranKod || '')] || rate || '';
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
      // 37 sutun — sirayla. Üst bilgi (isl) tüm satırlarda aynı; satıra özgü alanlar (st).
      const row = [
        isSale ? 'Gelir' : 'Gider',                  // 1 İŞLEM
        kayitTuruAdResolved,                          // 2 KATEGORİ
        belgeTuruAdResolved,                          // 3 BELGE TÜRÜ
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
        '',                                           // 14 KDV İSTİSNASI
        isl.islemTuruKod || '',                       // 15 KOD (İşlem Türü)
        isl.belgeTuruKod || '',                       // 16 BELGE TÜRÜ(DB)
        alisSatisAdResolved,                          // 17 ALIŞ/SATIŞ TÜRÜ
        kayitAltAdResolved,                           // 18 KAYIT ALT TÜRÜ
        isl.plakaNo || '',                            // 19 PLAKA NO
        '',                                           // 20 MAL VE HİZMET KODU
        counterpartyName || '',                       // 21 AÇIKLAMA
        '',                                           // 22 MİKTAR
        '',                                           // 23 B.FİYAT
        trAmount(stMatrah),                           // 24 TUTAR
        st.tevkifatOrani || '',                       // 25 TEVKİFAT
        kdvOranNum,                                   // 26 KDV ORANI
        '',                                           // 27 İŞLEM BEDELİ
        '',                                           // 28 MATRAHTAN DÜŞÜLECEK TUTAR
        '',                                           // 29 ÖZEL MATRAH ŞEKLİNE DAHİL OLMAYAN BEDEL
        trAmount(stKdv),                              // 30 KDV TUTARI
        trAmount(stMatrah + stKdv),                   // 31 TOPLAM TUTAR (satır)
        st.krediliTutar ? trAmount(Number(st.krediliTutar)) : '', // 32 KREDİLİ TUTAR
        st.stopajOrani || '',                         // 33 STOPAJ KODU
        st.stopajTutar ? trAmount(Number(st.stopajTutar)) : '',   // 34 STOPAJ TUTARI
        donemFlag ? 'Evet' : '',                      // 35 DÖNEMSELLİK İLKESİ
        '',                                           // 36 FAALIYET KODU
        '',                                           // 37 ÖDEME TÜRÜ
      ].map(csvCell).join(';');
      lines.push(iconv.encode(row, 'win1254'));
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
