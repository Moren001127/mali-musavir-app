import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as sharp from 'sharp';
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
const MAX_DATE = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000); // bugün + 7 gün

function parseDate(d: string, m: string | number, y: string): string | null {
  const day = parseInt(d, 10);
  const month = typeof m === 'string' ? (TR_MONTHS[m.toLowerCase()] ?? 0) : m;
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;

  // Çapraz kontrol
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  // Gelecek tarih kontrolü
  const candidate = new Date(year, month - 1, day);
  if (candidate > MAX_DATE) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateFromText(raw: string): string | null {
  if (!raw || raw.trim().length < 5) return null;

  // ── Ön Temizlik ──────────────────────────────────────────────
  let t = raw
    // Unicode dash'ları → standart tire
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')
    // OCR yanlış okumaları
    .replace(/[|\\]/g, '-')
    .replace(/[oO](\d)/g, '0$1')          // "O2" → "02" (O harfi → 0 rakamı)
    .replace(/(\d)[,;](\d)/g, '$1.$2')    // rakam arası virgül/noktalı virgül → nokta
    .replace(/\s+/g, ' ');

  // SAAT bilgisini temizle (tarihle karışmasın): "23:08" veya "23.08"
  t = t.replace(/\b\d{2}[:.]\d{2}([:.]\d{2})?\b/g, ' ');

  // ── Separator normalizasyonu: tire → nokta (yedek kopya üret) ──
  // Hem orijinal hem de tire→nokta versiyonu denenecek
  const tDash = t.replace(/(\d)\s*-\s*(\d)/g, '$1.$2');

  const tryAll = (text: string): string | null => {
    // 1. DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY (separator: . - / ; boşluk toleranslı)
    let m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{4})/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 2. YYYY-MM-DD / YYYY.MM.DD
    m = text.match(/(\d{4})\s*[.\-]\s*(\d{2})\s*[.\-]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[3], parseInt(m[2], 10), m[1]); if (r) return r; }

    // 3. DD.MM.YY (2 haneli yıl)
    m = text.match(/(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2})(?!\d)/);
    if (m) { const r = parseDate(m[1], parseInt(m[2], 10), m[3]); if (r) return r; }

    // 4. Separator yok: DD MM YYYY (sadece boşlukla ayrılmış 3 sayı grubu)
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

  // Önce orijinal metni dene, sonra tire→nokta dönüştürülmüş versiyonu
  return tryAll(t) ?? tryAll(tDash);
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
  { zone: 'full',  preprocess: 'normalize',  psm: '11' }, // 1. Tam + normalize + PSM11
  { zone: 'full',  preprocess: 'threshold',  psm: '6'  }, // 2. Tam + threshold + PSM6
  { zone: 'top50', preprocess: 'normalize',  psm: '6'  }, // 3. Üst + normalize + PSM6
  { zone: 'top50', preprocess: 'threshold',  psm: '11' }, // 4. Üst + threshold + PSM11
  { zone: 'mid',   preprocess: 'normalize',  psm: '6'  }, // 5. Orta + normalize + PSM6
  { zone: 'bot40', preprocess: 'normalize',  psm: '6'  }, // 6. Alt + normalize + PSM6
  { zone: 'bot40', preprocess: 'threshold',  psm: '11' }, // 7. Alt + threshold + PSM11
  { zone: 'full',  preprocess: 'contrast',   psm: '3'  }, // 8. Tam + contrast + PSM3
];

/* ─── Service ───────────────────────────────────────────────── */

@Injectable()
export class FisYazdirmaService {
  private readonly logger = new Logger(FisYazdirmaService.name);

  /**
   * Bölge + strateji kombinasyonuna göre ön işleme yapar → PNG Buffer (1200px)
   */
  private async preprocessImage(
    buffer: Buffer,
    W: number,
    H: number,
    strategy: OcrStrategy,
  ): Promise<Buffer> {
    // Bölge hesapla
    let top = 0;
    let height = H;
    switch (strategy.zone) {
      case 'top50': height = Math.floor(H * 0.50); break;
      case 'mid':   top = Math.floor(H * 0.20); height = Math.floor(H * 0.50); break;
      case 'bot40': top = Math.floor(H * 0.60); height = Math.floor(H * 0.40); break;
      // 'full': tüm görsel
    }
    // Sınır güvenliği
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

  /**
   * Tek görseli worker pool ile OCR'lar — 8 strateji, ilk geçerli tarihte durur.
   */
  private async ocrDateWithWorker(buffer: Buffer, worker: any): Promise<string | null> {
    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 400;
    const H = meta.height ?? 600;

    for (const strategy of OCR_STRATEGIES) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: strategy.psm });
        const processed = await this.preprocessImage(buffer, W, H, strategy);
        const { data } = await worker.recognize(processed);
        const date = extractDateFromText(data.text);
        if (date) {
          this.logger.debug(`Strateji ${strategy.zone}/${strategy.preprocess}/PSM${strategy.psm} → ${date}`);
          return date;
        }
      } catch (e: any) {
        this.logger.debug(`Strateji ${strategy.zone}/${strategy.preprocess} hata: ${e.message}`);
      }
    }

    return null;
  }

  /**
   * Thumbnail üret (teyit ekranı için): 240px, JPEG 75
   */
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

  /**
   * Görselleri OCR ile tarar — Worker Pool (3 worker, pLimit 3)
   */
  async scanImages(files: Express.Multer.File[]): Promise<ScanResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    this.logger.log(`OCR tarama başlıyor: ${files.length} görsel, 3 worker, 8 strateji`);

    const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);

    const POOL_SIZE = 3;
    const workers: any[] = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => createWorker(['tur', 'eng'])),
    );

    let workerIdx = 0;
    const limit = pLimit(POOL_SIZE);

    const results: { file: Express.Multer.File; date: string | null }[] = [];

    try {
      const promises = files.map((file) => {
        const wi = workerIdx++ % POOL_SIZE;
        return limit(async () => {
          const date = await this.ocrDateWithWorker(file.buffer, workers[wi]);
          this.logger.log(`${file.originalname}: ${date ?? 'OKUNAMADI'}`);
          return { file, date };
        });
      });

      results.push(...(await Promise.all(promises)));
    } finally {
      await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    }

    const detected: ScanDetected[] = [];
    const unread: ScanUnread[] = [];

    await Promise.all(
      results.map(async ({ file, date }) => {
        if (date) {
          detected.push({ filename: file.originalname, date });
        } else {
          const thumbnail = await this.makeThumbnail(file.buffer);
          unread.push({ filename: file.originalname, thumbnail });
        }
      }),
    );

    detected.sort((a, b) => a.date.localeCompare(b.date));

    this.logger.log(
      `Tarama tamamlandı: ${detected.length}/${files.length} okundu, ${unread.length} teyit bekliyor`,
    );

    return { detected, unread, total: files.length };
  }

  /**
   * Teyit edilmiş tarihlerle Word belgesi oluştur — A4'te 3 sütun grid
   * Görsel: max 800px embed (yüksek kalite), display: 173px (baskı kalitesinde)
   */
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

    const COLS = 3;

    // A4: kullanılabilir genişlik
    const pageW  = convertMillimetersToTwip(210);
    const marginLR = convertMillimetersToTwip(10);
    const usableW  = pageW - 2 * marginLR;
    const colW     = Math.floor(usableW / COLS);

    // Display boyutu (Word'de görünen px — yüksek çözünürlü embed, küçük display)
    const DISPLAY_W = 173; // px @ Word 72dpi ≈ 61mm → tam sütun genişliği

    const emptyCell = () =>
      new TableCell({
        borders: NO_BORDER,
        width: { size: colW, type: WidthType.DXA },
        children: [new Paragraph({ children: [] })],
      });

    // Her fiş için hücre oluştur
    const cells: TableCell[] = await Promise.all(
      sorted.map(async (file) => {
        // Maksimum kalite embed: orijinal çözünürlük korunur, JPEG %98
        const embedded = await sharp(file.buffer)
          .jpeg({ quality: 98 })
          .toBuffer();

        const meta = await sharp(embedded).metadata();
        const imgW = meta.width ?? 800;
        const imgH = meta.height ?? 600;

        // Display boyutu: 173px genişlik, orantılı yükseklik
        const displayW = DISPLAY_W;
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
          verticalAlign: VerticalAlign.TOP,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 30 },
              children: [
                new ImageRun({
                  data: embedded,
                  transformation: { width: displayW, height: displayH },
                  type: 'jpg',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 60 },
              children: [
                new TextRun({ text: displayDate, size: 16, bold: true }),
              ],
            }),
          ],
        });
      }),
    );

    // 3'lü gruplara böl
    const rows: TableRow[] = [];
    for (let i = 0; i < cells.length; i += COLS) {
      const rowCells = cells.slice(i, i + COLS);
      while (rowCells.length < COLS) rowCells.push(emptyCell());
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

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width:  convertMillimetersToTwip(210),
                height: convertMillimetersToTwip(297),
              },
              margin: {
                top:    convertMillimetersToTwip(10),
                right:  convertMillimetersToTwip(10),
                bottom: convertMillimetersToTwip(10),
                left:   convertMillimetersToTwip(10),
              },
            },
          },
          children: [table],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }
}
