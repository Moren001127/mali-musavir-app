import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as sharp from 'sharp';
import * as XLSX from 'xlsx';
import {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
  TableLayoutType,
  convertMillimetersToTwip,
} from 'docx';

/* ─── Tip Tanımları ─────────────────────────────────────────── */

export interface ScanDetected {
  filename: string;
  date: string; // YYYY-MM-DD
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
}

export interface ScanUnread {
  filename: string;
  thumbnail: string; // "data:image/jpeg;base64,..."
}

export interface ScanResult {
  detected: ScanDetected[];
  unread: ScanUnread[];
  total: number;
}

export interface ExcelRow {
  filename: string;
  date: string;
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
}

/* ─── Türkçe Ay Adları (OCR gürültü toleranslı) ────────────── */
const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4,
  mayis: 5, mayıs: 5, haziran: 6,
  temmuz: 7, agustos: 8, ağustos: 8,
  eylul: 9, eylül: 9, ekim: 10,
  kasim: 11, kasım: 11, aralik: 12, aralık: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* ─── Çapraz Kontrol: Geçerli tarih aralığı ────────────────── */
const MIN_YEAR = 2020;
const MAX_YEAR = 2030;
const TODAY = new Date();
const MAX_DATE = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000);

function parseDate(d: string, m: string | number, y: string): string | null {
  const day = parseInt(d, 10);
  const month = typeof m === 'string' ? (TR_MONTHS[m.toLowerCase()] ?? 0) : m;
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  const candidate = new Date(year, month - 1, day);
  if (candidate > MAX_DATE) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateFromText(raw: string): string | null {
  if (!raw || raw.trim().length < 5) return null;

  // ── Ön Temizlik ──────────────────────────────────────────────
  let t = raw
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')   // Unicode dash → standart tire
    .replace(/[|\\]/g, '-')
    .replace(/[oO](\d)/g, '0$1')                    // "O2" → "02"
    .replace(/(\d)[,;](\d)/g, '$1.$2')              // virgül/noktalı virgül → nokta
    .replace(/\s+/g, ' ');

  // ── SAAT Temizliği: SADECE : (iki nokta üst üste) ile yazılmış saatler ──
  // NOT: [.:] yerine sadece [:] — böylece "20.02" gibi tarih parçaları silinmez
  t = t.replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, ' ');

  // ── Separator normalizasyonu: tire → nokta (yedek kopya) ──
  const tDash = t.replace(/(\d)\s*-\s*(\d)/g, '$1.$2');

  const tryAll = (text: string): string | null => {
    // 1. DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
    let m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{4})/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 2. YYYY-MM-DD / YYYY.MM.DD
    m = text.match(/(\d{4})\s*[.\-]\s*(\d{2})\s*[.\-]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[3], parseInt(m[2], 10), m[1]); if (r) return r; }

    // 3. DD.MM.YY (2 haneli yıl)
    m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 4. DD MM YYYY (boşlukla ayrılmış)
    m = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(20\d{2})\b/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 5. DDMMYYYY bitişik 8 hane
    m = text.match(/\b(\d{2})(\d{2})(20\d{2})\b/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 6. DD Ocak 2025 vb.
    m = text.match(/(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
    if (m) { const r = parseDate(m[1], m[2].toLowerCase(), m[3]); if (r) return r; }

    return null;
  };

  return tryAll(t) ?? tryAll(tDash);
}

/**
 * OCR metninden ek alanları best-effort çıkar
 */
function extractFieldsFromText(text: string): Omit<ScanDetected, 'filename' | 'date'> {
  const result: Omit<ScanDetected, 'filename' | 'date'> = {};
  if (!text) return result;

  // Belge No / Fiş No
  const belgeMatch = text.match(
    /(?:fi[sş]\s*no|belge\s*no|z\s*no|seri\s*no|eku\s*no)[:\s#]*([A-Z0-9\-]{1,20})/i,
  );
  if (belgeMatch) result.belge_no = belgeMatch[1].trim();

  // Cari / Ünvan (şirket adı — Ltd, A.Ş., Tic, San içeren ilk satır)
  const cariMatch = text.match(
    /^(.{5,80}(?:ltd|a\.?\s*ş|tic\.?|san\.?|a\.?\s*s\.?|limited|petrol|oto|market|nakliyat)[^\n]*)/im,
  );
  if (cariMatch) result.cari = cariMatch[1].trim().substring(0, 80);

  // Vergi No (10-11 haneli sayı — VD veya No etiketiyle)
  const vergiMatch = text.match(
    /(?:vd|v\.d\.|vergi\s*no|vergi\s*kimlik)[:\s]*([0-9]{10,11})/i,
  ) ?? text.match(/\b([0-9]{10,11})\b/);
  if (vergiMatch) result.vergi_no = vergiMatch[1];

  // Genel Toplam / Satış Tutarı
  const toplamMatch = text.match(
    /(?:genel\s*toplam|sati[sş]\s*tutar[iı]|toplam|total)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{2,3}(?:[.,][0-9]{2})?)/i,
  );
  if (toplamMatch) result.toplam = toplamMatch[1].replace(/\./g, '').replace(',', '.').trim();

  // KDV %20 (en yaygın)
  const kdv20Match = text.match(
    /(?:topkdv|kdv\s*%?20|k\.d\.v\.?\s*%?20)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv20Match) result.kdv_20 = kdv20Match[1].replace(',', '.').trim();

  // KDV %10
  const kdv10Match = text.match(
    /kdv\s*%?10\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv10Match) result.kdv_10 = kdv10Match[1].replace(',', '.').trim();

  // KDV %1
  const kdv1Match = text.match(
    /kdv\s*%?1(?!\d)\s*[:\s*]*\*?\s*([0-9]{1,6}[.,][0-9]{1,3})/i,
  );
  if (kdv1Match) result.kdv_1 = kdv1Match[1].replace(',', '.').trim();

  return result;
}

/* ─── Görünmez Border ───────────────────────────────────────── */
const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/* ─── OCR Strateji Matrisi ──────────────────────────────────── */
type OcrStrategy = {
  zone: 'full' | 'top50' | 'mid' | 'bot40';
  preprocess: 'normalize' | 'threshold' | 'contrast';
  psm: '11' | '6' | '3';
};

const OCR_STRATEGIES: OcrStrategy[] = [
  { zone: 'full',  preprocess: 'normalize',  psm: '11' },
  { zone: 'full',  preprocess: 'threshold',  psm: '6'  },
  { zone: 'top50', preprocess: 'normalize',  psm: '6'  },
  { zone: 'top50', preprocess: 'threshold',  psm: '11' },
  { zone: 'mid',   preprocess: 'normalize',  psm: '6'  },
  { zone: 'bot40', preprocess: 'normalize',  psm: '6'  },
  { zone: 'bot40', preprocess: 'threshold',  psm: '11' },
  { zone: 'full',  preprocess: 'contrast',   psm: '3'  },
];

/* ─── Service ───────────────────────────────────────────────── */

@Injectable()
export class FisYazdirmaService {
  private readonly logger = new Logger(FisYazdirmaService.name);

  private async preprocessImage(
    buffer: Buffer,
    W: number,
    H: number,
    strategy: OcrStrategy,
  ): Promise<Buffer> {
    let top = 0;
    let height = H;
    switch (strategy.zone) {
      case 'top50': height = Math.floor(H * 0.50); break;
      case 'mid':   top = Math.floor(H * 0.20); height = Math.floor(H * 0.50); break;
      case 'bot40': top = Math.floor(H * 0.60); height = Math.floor(H * 0.40); break;
    }
    if (top + height > H) height = H - top;
    if (height < 20) height = Math.min(40, H);

    let pipeline = sharp(buffer)
      .extract({ left: 0, top, width: W, height })
      .grayscale();

    switch (strategy.preprocess) {
      case 'normalize':
        pipeline = pipeline.normalize().sharpen();
        break;
      case 'threshold':
        pipeline = pipeline.normalize().threshold(140);
        break;
      case 'contrast':
        pipeline = pipeline.linear(1.5, -40).normalize().sharpen();
        break;
    }

    return pipeline
      .resize({ width: 1200, withoutEnlargement: false })
      .png()
      .toBuffer();
  }

  private async ocrDateWithWorker(
    buffer: Buffer,
    worker: any,
  ): Promise<{ date: string | null; fullText: string }> {
    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 400;
    const H = meta.height ?? 600;

    let bestText = '';

    for (const strategy of OCR_STRATEGIES) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: strategy.psm });
        const processed = await this.preprocessImage(buffer, W, H, strategy);
        const { data } = await worker.recognize(processed);
        if (!bestText && data.text) bestText = data.text;
        const date = extractDateFromText(data.text);
        if (date) {
          this.logger.debug(`[OCR] ${strategy.zone}/${strategy.preprocess}/PSM${strategy.psm} → ${date}`);
          return { date, fullText: data.text };
        }
      } catch (e: any) {
        this.logger.debug(`[OCR] ${strategy.zone}/${strategy.preprocess} hata: ${e.message}`);
      }
    }

    return { date: null, fullText: bestText };
  }

  private async makeThumbnail(buffer: Buffer): Promise<string> {
    try {
      const thumb = await sharp(buffer)
        .resize({ width: 240, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      return `data:image/jpeg;base64,${thumb.toString('base64')}`;
    } catch {
      return '';
    }
  }

  async scanImages(files: Express.Multer.File[]): Promise<ScanResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    this.logger.log(`OCR tarama başlıyor: ${files.length} görsel`);

    const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);

    const POOL_SIZE = 3;
    const workers: any[] = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => createWorker(['tur', 'eng'])),
    );

    let workerIdx = 0;
    const limit = pLimit(POOL_SIZE);

    const results: { file: Express.Multer.File; date: string | null; fullText: string }[] = [];

    try {
      const promises = files.map((file) => {
        const wi = workerIdx++ % POOL_SIZE;
        return limit(async () => {
          const { date, fullText } = await this.ocrDateWithWorker(file.buffer, workers[wi]);
          this.logger.log(`${file.originalname}: ${date ?? 'OKUNAMADI'}`);
          return { file, date, fullText };
        });
      });

      results.push(...(await Promise.all(promises)));
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    }

    const detected: ScanDetected[] = [];
    const unread: ScanUnread[] = [];

    await Promise.all(
      results.map(async ({ file, date, fullText }) => {
        if (date) {
          const extra = extractFieldsFromText(fullText);
          detected.push({ filename: file.originalname, date, ...extra });
        } else {
          const thumbnail = await this.makeThumbnail(file.buffer);
          unread.push({ filename: file.originalname, thumbnail });
        }
      }),
    );

    detected.sort((a, b) => a.date.localeCompare(b.date));

    this.logger.log(`Tamamlandı: ${detected.length}/${files.length} okundu, ${unread.length} teyit bekliyor`);

    return { detected, unread, total: files.length };
  }

  generateExcel(rows: ExcelRow[]): Buffer {
    const sheetData = rows.map((r) => {
      let displayDate = r.date;
      if (r.date && r.date.includes('-')) {
        const [y, mo, d] = r.date.split('-');
        displayDate = `${d}.${mo}.${y}`;
      }
      return {
        'Tarih':     displayDate,
        'Fiş No':    r.belge_no ?? '',
        'Cari İsmi': r.cari ?? '',
        'Vergi No':  r.vergi_no ?? '',
        'KDV %1':    r.kdv_1 ?? '',
        'KDV %10':   r.kdv_10 ?? '',
        'KDV %20':   r.kdv_20 ?? '',
        'Toplam':    r.toplam ?? '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);

    // Sütun genişlikleri (örneğe göre)
    ws['!cols'] = [
      { wch: 14 }, // Tarih
      { wch: 10 }, // Fiş No
      { wch: 40 }, // Cari İsmi
      { wch: 16 }, // Vergi No
      { wch: 10 }, // KDV %1
      { wch: 10 }, // KDV %10
      { wch: 10 }, // KDV %20
      { wch: 18 }, // Toplam
    ];

    // Başlık satırı stili — mavi arka plan, beyaz kalın yazı
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '007BFF' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
    };

    const headerCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    headerCols.forEach((col) => {
      if (ws[`${col}1`]) {
        ws[`${col}1`].s = headerStyle;
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Excel Dokumu');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async generateWord(
    files: Express.Multer.File[],
    allDates: Record<string, string>,
  ): Promise<Buffer> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    const missing = files.filter((f) => !allDates[f.originalname]);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Şu fişler için tarih eksik: ${missing.map((f) => f.originalname).join(', ')}`,
      );
    }

    // Tarihe göre sırala (eski → yeni)
    const sorted = [...files].sort((a, b) =>
      (allDates[a.originalname] ?? '').localeCompare(allDates[b.originalname] ?? ''),
    );

    // ── Sayfa & Grid Ayarları ─────────────────────────────────
    // Letter: 21.59 × 27.94 cm, örnek docx ile birebir
    const PAGE_W_MM  = 215.9;
    const PAGE_H_MM  = 279.4;
    const MARGIN_MM  = 0; // sıfır marjin — fişler sayfaya yapışık
    const COLS       = 4; // 4 sütun × 2 satır = sayfa başına 8 fiş
    const ROWS_PER_PAGE = 2;
    const PER_PAGE   = COLS * ROWS_PER_PAGE; // 8

    const pageWTwip  = convertMillimetersToTwip(PAGE_W_MM);
    const pageHTwip  = convertMillimetersToTwip(PAGE_H_MM);
    const usableW    = convertMillimetersToTwip(PAGE_W_MM - 2 * MARGIN_MM);
    const colW       = Math.floor(usableW / COLS);

    // Görsel display genişliği: ~5.33 cm ≈ 151px @72dpi
    const DISPLAY_W_CM = 5.33;
    const DISPLAY_W    = Math.round((DISPLAY_W_CM / 2.54) * 96); // ≈ 201px

    const emptyCell = (): TableCell =>
      new TableCell({
        borders: NO_BORDER,
        width: { size: colW, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({ children: [] })],
      });

    // Tüm hücreleri oluştur
    const cells: TableCell[] = await Promise.all(
      sorted.map(async (file) => {
        const embedded = await sharp(file.buffer)
          .jpeg({ quality: 98 })
          .toBuffer();

        const meta = await sharp(embedded).metadata();
        const imgW  = meta.width ?? 800;
        const imgH  = meta.height ?? 600;
        const displayH = Math.round(imgH * (DISPLAY_W / imgW));

        const dateStr = allDates[file.originalname] ?? '';
        let displayDate = dateStr;
        if (dateStr.includes('-')) {
          const [y, mo, d] = dateStr.split('-');
          displayDate = `${d}.${mo}.${y}`;
        }

        return new TableCell({
          borders: NO_BORDER,
          width: { size: colW, type: WidthType.DXA },
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 0 },
              children: [
                new ImageRun({
                  data: embedded,
                  transformation: { width: DISPLAY_W, height: displayH },
                  type: 'jpg',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20 },
              children: [
                new TextRun({ text: displayDate, size: 22, bold: true }),
              ],
            }),
          ],
        });
      }),
    );

    // ── Sayfaları oluştur (her sayfa = PER_PAGE fiş, ayrı Section) ──
    const sections: any[] = [];
    const pageProps = {
      page: {
        size: { width: pageWTwip, height: pageHTwip },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    };

    // Sayfaları PER_PAGE'lik gruplara böl
    for (let pageStart = 0; pageStart < cells.length; pageStart += PER_PAGE) {
      const pageCells = cells.slice(pageStart, pageStart + PER_PAGE);
      // Dolgu hücresi ekle (son sayfa eksikse)
      while (pageCells.length < PER_PAGE) pageCells.push(emptyCell());

      const rows: TableRow[] = [];
      for (let r = 0; r < ROWS_PER_PAGE; r++) {
        const rowCells = pageCells.slice(r * COLS, r * COLS + COLS);
        rows.push(new TableRow({ children: rowCells }));
      }

      const table = new Table({
        layout: TableLayoutType.FIXED,
        width: { size: usableW, type: WidthType.DXA },
        rows,
        borders: {
          top:              { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom:           { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left:             { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right:            { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
      });

      sections.push({ properties: pageProps, children: [table] });
    }

    const doc = new Document({ sections });
    return Packer.toBuffer(doc);
  }
}
