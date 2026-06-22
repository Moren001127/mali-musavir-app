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
  lines: InvoiceLine[];
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

function inferBelgeTuru(_invoice: InvoicePayload): string {
  // KÖK NEDEN (agent log kanıtı): Luca'nın Fiş Kes doğrulaması belgeTurKontrol() yalnız KENDİ
  // belgeTurList'indeki değerleri kabul ediyor. "E-ARŞİV/E-FATURA" gibi serbest metinler listede
  // OLMADIĞI için belgeTurKontrol false döner → fisKes() "if(hataliBelgeTuru>0) return" ile SESSİZCE
  // çıkar, AJAX (fis_kes.jq) hiç çağrılmaz, fiş kesilmez. belgeTurKontrol BOŞ değeri ise GEÇER
  // (if(val && ...) → val boşsa atlar). Geçerli kod listesi Luca versiyonuna göre değiştiğinden ve
  // yanlış kod yine reddedileceğinden belge türünü BOŞ bırakıyoruz → fiş kesilir. Doğru kodlar
  // (belgeTurList) netleşince buraya eşleştirme eklenir.
  void _invoice;
  return '';
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
    const detayBase = inv.vendorName || inv.customerName || '-';

    for (const line of (inv.lines || [])) {
      const debit = parseAmount(line.debit);
      const credit = parseAmount(line.credit);
      // Bos satirlari atla (debit ve credit ikisi de 0 ise)
      if (debit === 0 && credit === 0) continue;
      const detayAciklama = [
        detayBase,
        line.description ? `· ${line.description}` : '',
        line.rate ? `(${line.rate})` : '',
      ].filter(Boolean).join(' ').trim();

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
        paraBirimi === 'TL' ? '' : '1', // Kur (TL ise boş)
        '', // Döviz Tutar
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

// hizli_fis_aktarim şablonunun gerçek cp1254 başlık baytları (base64).
const ISLETME_HEADER_B64 =
  '3d5MRU07S0FURUdPUt07QkVMR0UgVFVSVTtFVlJBSyBUQVLdSN07S0FZSVQgVEFS3UjdO1NFUt0gTk87RVZSQUsgTk87VENLTi9WS047VkVSR90gREHdUkVT3TtTT1lBREkg3E5WQU47QURJIERFVkFNSTtBRFJFUztDQVLdIEhFU0FQO0tEViDdU1TdU05BU0k7S09EO0JFTEdFIFTcUtwoREIpO0FMSd4vU0FUSd4gVNxS3DtLQVlJVCBBTFQgVNxS3DtNQUwgVkUgSN1aTUVUIEtPRFU7QcdJS0xBTUE7Td1LVEFSO0IuRt1ZQVQ7VFVUQVI7VEVWS91GQVQ7S0RWIE9SQU5JO9ZaRUwgTUFUUkFIIN3eTEVNIEJFREVM3TtNQVRSQUhUQU4gRNze3ExFQ0VLIFRVVEFSO01BVFJBSEEgREFI3UwgT0xNQVlBTiBCRURFTDtLRFYgVFVUQVJJO1RPUExBTSBUVVRBUjtLUkVE3UzdIFRVVEFSO1NUT1BBSiBLT0RVO1NUT1BBSiBUVVRBUkk7RNZORU1TRUxM3Usg3UxLRVPdO0ZBQUxJWUVUIEtPRFU71kRFTUUgVNxS';

/** cp1254 CSV hucresi — ; veya tirnak/yeni satir varsa tirnakla. */
function csvCell(v: any): string {
  const s = v == null ? '' : String(v);
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
export function buildLucaIsletmeHizliFisCsv(payload: BatchPayload): Buffer {
  const isSaleKind = (k?: string | null) => String(k || 'ALIS').toUpperCase() === 'SATIS';
  const lines: Buffer[] = [Buffer.from(ISLETME_HEADER_B64, 'base64')];

  for (const inv of payload.invoices) {
    const isSale = isSaleKind(inv.invoiceKind);
    // Tutarlari fis satirlarindan turet
    let matrah = 0, kdv = 0, rate = '';
    for (const l of inv.lines || []) {
      const amt = Number(isSale ? l.credit : l.debit) || 0;
      if (l.group === 'matrah') matrah += amt;
      else if (l.group === 'vergi') { kdv += amt; if (!rate && l.rate) rate = String(l.rate).replace(/[%\s]/g, ''); }
    }
    const total = parseAmount(inv.totalAmount) || (matrah + kdv);
    const fatTarihi = parseDate(inv.faturaTarihi);
    const tarihStr = fatTarihi ? fmtTr(fatTarihi) : '';
    const counterpartyVkn = isSale ? (inv.buyerVkn || '') : (inv.sellerVkn || '');
    const counterpartyName = isSale ? (inv.customerName || '') : (inv.vendorName || '');

    // 36 sutun — sirayla. Bilinmeyen/opsiyonel alanlar bos birakildi.
    const row = [
      isSale ? 'Gelir' : 'Gider',        // 1 İŞLEM            [DOGRULANACAK]
      '',                                 // 2 KATEGORİ
      inferIsletmeBelgeTuru(inv),         // 3 BELGE TURU       [DOGRULANACAK]
      tarihStr,                           // 4 EVRAK TARİHİ
      tarihStr,                           // 5 KAYIT TARİHİ
      inv.seriNo || '',                   // 6 SERİ NO
      inv.belgeNo || '',                  // 7 EVRAK NO
      counterpartyVkn,                    // 8 TCKN/VKN
      '',                                 // 9 VERGİ DAİRESİ
      counterpartyName,                   // 10 SOYADI ÜNVAN
      '',                                 // 11 ADI DEVAMI
      '',                                 // 12 ADRES
      '',                                 // 13 CARİ HESAP
      '',                                 // 14 KDV İSTİSNASI
      '',                                 // 15 KOD
      '',                                 // 16 BELGE TÜRÜ(DB)
      isSale ? 'Satış' : 'Alış',          // 17 ALIŞ/SATIŞ TÜRÜ  [DOGRULANACAK]
      '',                                 // 18 KAYIT ALT TÜR
      '',                                 // 19 MAL VE HİZMET KODU
      inv.vendorName || inv.customerName || '', // 20 AÇIKLAMA
      '',                                 // 21 MİKTAR
      '',                                 // 22 B.FİYAT
      trAmount(matrah),                   // 23 TUTAR (matrah/KDV haric)
      '',                                 // 24 TEVKİFAT
      rate || '',                         // 25 KDV ORANI
      '',                                 // 26 ÖZEL MATRAH İŞLEM BEDELİ
      '',                                 // 27 MATRAHTAN DÜŞÜLECEK TUTAR
      '',                                 // 28 MATRAHA DAHİL OLMAYAN BEDEL
      trAmount(kdv),                      // 29 KDV TUTARI
      trAmount(total),                    // 30 TOPLAM TUTAR
      '',                                 // 31 KREDİLİ TUTAR
      '',                                 // 32 STOPAJ KODU
      '',                                 // 33 STOPAJ TUTARI
      '',                                 // 34 DÖNEMSELLİK İLKESİ
      '',                                 // 35 FAALIYET KODU
      '',                                 // 36 ÖDEME TÜRÜ      [DOGRULANACAK]
    ].map(csvCell).join(';');

    lines.push(iconv.encode(row, 'win1254'));
  }

  const sep = Buffer.from('\r\n', 'ascii');
  const out: Buffer[] = [];
  lines.forEach((b, i) => { if (i > 0) out.push(sep); out.push(b); });
  return Buffer.concat(out);
}

function inferIsletmeBelgeTuru(inv: InvoicePayload): string {
  const t = String(inv.documentType || '').toUpperCase();
  if (t === 'E_FATURA') return 'E-Fatura';
  if (t === 'E_ARSIV') return 'E-Arşiv Fatura';
  if (t === 'OKC_FIS') return 'Fiş';
  return 'Fatura';
}

