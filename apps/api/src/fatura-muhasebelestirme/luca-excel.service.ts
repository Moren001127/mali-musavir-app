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
  // Luca belge türü kodlama tahmin (gerçek kodlar müşteri Luca versiyonuna göre değişebilir)
  const t = String(invoice.documentType || '').toUpperCase();
  if (t === 'E_FATURA') return 'E-FATURA';
  if (t === 'E_ARSIV') return 'E-ARŞİV';
  if (t === 'OKC_FIS') return 'ÖKC FİŞİ';
  return 'FATURA';
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
// İşletme Defteri (VUK 194 — 2. Sınıf Tüccarlar) Excel Formatı
// Luca'nın "Gelir/Gider Defteri Girişi" modülü için
// ─────────────────────────────────────────────────────────────────────

const ISLETME_HEADERS = [
  'Tarih',
  'Belge No',
  'Açıklama',
  'Gider/Gelir Türü',
  'Yön',         // GİDER | GELİR
  'Matrah',      // Bilgi — deftere yazılmaz (demirbaş/taşıt için sadece KDV deftere girer)
  'KDV Oranı',
  'KDV Tutarı',  // Gerçek deftere giren tutar (demirbaş/taşıt için YALNIZ bu)
  'Toplam',
  'Para Birimi',
  'Not',
];

export interface IsletmeInvoicePayload {
  documentId: string;
  belgeNo?: string | null;
  faturaTarihi?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  isletmeYon: 'GIDER' | 'GELIR';
  isletmeGiderTuru: string;
  matrah?: string | number | null;     // bilgi — deftere yazılmaz eğer amortismana tabi
  kdvOrani?: string | number | null;
  kdvTutari?: string | number | null;
  isAmortismanaTabiTur?: boolean;      // true ise matrah deftere yazılmaz, yalnız KDV
  aciklama?: string | null;
  currency?: string | null;
}

export interface IsletmeBatchPayload {
  mode: 'ISLETME_EXCEL';
  taxpayerId: string;
  period: string;
  totalCount: number;
  invoices: IsletmeInvoicePayload[];
  fisAciklama?: string;
}

/**
 * İşletme hesabı esası için Luca Gelir/Gider Defteri Excel'i üretir.
 *
 * VUK 313/315 kuralı: Demirbaş ve taşıt bedeli gider DEĞİL.
 * isAmortismanaTabiTur=true ise Matrah sütununa "(bilgi)" notu düşülür,
 * KDV Tutarı deftere giren gerçek tutar olur.
 */
export async function buildLucaIsletmeExcel(payload: IsletmeBatchPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Gelir-Gider Defteri');

  ws.addRow(ISLETME_HEADERS);
  ws.getRow(1).font = { bold: true };

  const [py, pm] = String(payload.period || '').split('-').map((n) => parseInt(n, 10));
  const fisAciklama = payload.fisAciklama
    || `${payload.period} dönemi işletme defteri (${payload.totalCount} belge)`;

  for (const inv of payload.invoices) {
    const tarih = parseDate(inv.faturaTarihi);
    const tarihStr = tarih ? fmtTr(tarih) : (
      Number.isFinite(py) && Number.isFinite(pm)
        ? fmtTr(new Date(Date.UTC(py, pm, 0)))
        : fmtTr(new Date())
    );
    const matrah = parseAmount(inv.matrah as string | null | undefined);
    const kdv = parseAmount(inv.kdvTutari as string | null | undefined);
    const toplam = matrah + kdv;
    const aciklama = inv.vendorName || inv.customerName || fisAciklama;

    // Amortismana tabi ise matrah deftere yazılmaz — nota düşülür
    const matrahGoster = inv.isAmortismanaTabiTur
      ? `(${matrah.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} — deftere yazılmaz)`
      : matrah;

    ws.addRow([
      tarihStr,
      inv.belgeNo || '-',
      inv.aciklama || aciklama,
      inv.isletmeGiderTuru,
      inv.isletmeYon,
      matrahGoster,
      inv.kdvOrani != null ? `%${inv.kdvOrani}` : '',
      kdv > 0 ? kdv : '',
      inv.isAmortismanaTabiTur ? kdv : toplam,  // amortismana tabi = yalnız KDV
      inv.currency || 'TL',
      inv.isAmortismanaTabiTur ? 'VUK 313/315: bedel deftere yazılmadı' : '',
    ]);
  }

  ws.getColumn(6).numFmt = '#,##0.00';
  ws.getColumn(8).numFmt = '#,##0.00';
  ws.getColumn(9).numFmt = '#,##0.00';

  const widths = [12, 22, 48, 28, 10, 18, 10, 16, 16, 12, 44];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

