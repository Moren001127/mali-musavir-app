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

function parseDate(d: string, m: string | number, y: string): string | null {
  const day = parseInt(d, 10);
  const month = typeof m === 'string' ? (TR_MONTHS[m.toLowerCase()] ?? 0) : m;
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2099) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateFromText(raw: string): string | null {
  // OCR gürültüsünü temizle: rakamlar arasındaki virgül/iki nokta → nokta
  let t = raw
    .replace(/(\d)[,:](\d)/g, '$1.$2')
    .replace(/\s+/g, ' ');

  // DD.MM.YYYY  DD/MM/YYYY  DD-MM-YYYY  (boşluklu varyant dahil)
  let m = t.match(/\b(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{4})\b/);
  if (m) return parseDate(m[1], parseInt(m[2], 10), m[3]);

  // YYYY-MM-DD
  m = t.match(/\b(\d{4})[.\-](\d{2})[.\-](\d{2})\b/);
  if (m) return parseDate(m[3], parseInt(m[2], 10), m[1]);

  // DD.MM.YY (boşluklu dahil)
  m = t.match(/\b(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{2})\b/);
  if (m) return parseDate(m[1], parseInt(m[2], 10), m[3]);

  // 8 haneli birleşik DDMMYYYY
  m = t.match(/\b(\d{2})(\d{2})(\d{4})\b/);
  if (m) {
    const r = parseDate(m[1], parseInt(m[2], 10), m[3]);
    if (r) return r;
  }

  // DD Ocak 2025 / 5 MART 2024
  m = t.match(/\b(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (m) return parseDate(m[1], m[2].toLowerCase(), m[3]);

  return null;
}

/* ─── Görünmez Border Tanımı ────────────────────────────────── */
const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/* ─── Service ───────────────────────────────────────────────── */

@Injectable()
export class FisYazdirmaService {
  private readonly logger = new Logger(FisYazdirmaService.name);

  /**
   * Tek bölge + tek strateji için ön işleme uygular → PNG Buffer
   */
  private async preprocessZone(
    buffer: Buffer,
    zone: { top: number; height: number; width: number },
    strategy: 'normalize' | 'threshold',
  ): Promise<Buffer> {
    let pipeline = sharp(buffer)
      .extract({ left: 0, top: zone.top, width: zone.width, height: zone.height })
      .grayscale()
      .normalize();

    if (strategy === 'threshold') {
      pipeline = pipeline.threshold(128);
    } else {
      pipeline = pipeline.sharpen();
    }

    return pipeline.resize({ width: 800, withoutEnlargement: false }).png().toBuffer();
  }

  /**
   * Tek görseli worker ile OCR'lar; 4 bölge × 2 strateji = 8 deneme, ilk tarihte durur.
   */
  private async ocrDateWithWorker(buffer: Buffer, worker: any): Promise<string | null> {
    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 400;
    const H = meta.height ?? 600;

    // PSM 6: tek blok metin — ÖKC fişleri için ideal
    await worker.setParameters({ tessedit_pageseg_mode: '6' });

    const zones = [
      { top: 0,                            height: Math.floor(H * 0.40), width: W }, // Üst %40
      { top: Math.floor(H * 0.65),         height: Math.floor(H * 0.35), width: W }, // Alt %35
      { top: Math.floor(H * 0.25),         height: Math.floor(H * 0.40), width: W }, // Orta %25-65
      { top: 0,                            height: H,                    width: W }, // Tam görsel
    ];

    for (const zone of zones) {
      // Güvenli yükseklik kontrolü
      if (zone.top + zone.height > H) {
        zone.height = H - zone.top;
      }
      if (zone.height < 20) continue;

      for (const strategy of ['normalize', 'threshold'] as const) {
        try {
          const processed = await this.preprocessZone(buffer, zone, strategy);
          const { data } = await worker.recognize(processed);
          const date = extractDateFromText(data.text);
          if (date) return date;
        } catch {
          // Bu strateji başarısız, devam et
        }
      }
    }

    return null;
  }

  /**
   * Thumbnail üret: 220px genişlik, JPEG, base64
   */
  private async makeThumbnail(buffer: Buffer): Promise<string> {
    try {
      const thumb = await sharp(buffer)
        .resize({ width: 220, withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
      return `data:image/jpeg;base64,${thumb.toString('base64')}`;
    } catch {
      return '';
    }
  }

  /**
   * Görselleri OCR ile tarar — Worker Pool yaklaşımı (3 worker, pLimit(3))
   */
  async scanImages(files: Express.Multer.File[]): Promise<ScanResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    this.logger.log(`OCR tarama başlıyor: ${files.length} görsel, worker pool x3`);

    // p-limit ESM
    const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);

    // 3 Tesseract worker oluştur
    const POOL_SIZE = 3;
    const workers: any[] = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => createWorker(['tur', 'eng'])),
    );

    // Round-robin pool: her görev bir worker index alır
    let workerIndex = 0;
    const limit = pLimit(POOL_SIZE);

    const results: { file: Express.Multer.File; date: string | null }[] = [];

    try {
      const promises = files.map((file) => {
        const wi = workerIndex++ % POOL_SIZE;
        return limit(async () => {
          const date = await this.ocrDateWithWorker(file.buffer, workers[wi]);
          this.logger.log(`${file.originalname}: ${date ?? 'tarih bulunamadı'}`);
          return { file, date };
        });
      });

      results.push(...(await Promise.all(promises)));
    } finally {
      // Worker pool'u kapat
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
      `Tarama tamamlandı: ${detected.length}/${files.length} tarih okundu, ${unread.length} teyit bekliyor`,
    );

    return { detected, unread, total: files.length };
  }

  /**
   * Teyit edilmiş tarihlerle Word belgesi oluştur — A4'te 3 sütun grid
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

    // A4: kullanılabilir genişlik (twip) = 210mm - 2×12.7mm margin ≈ 184.6mm
    const pageW = convertMillimetersToTwip(210);
    const marginLR = convertMillimetersToTwip(12.7);
    const usableW = pageW - 2 * marginLR;
    const colW = Math.floor(usableW / COLS); // twip cinsinden hücre genişliği

    // Fiş boyutu: maksimum genişlik px (A4 sütun ~61mm ≈ 230px @96dpi)
    const FIS_MAX_W = 190;
    const FIS_MAX_H = 260;

    // Hücre için görünmez border helper
    const emptyCell = () =>
      new TableCell({
        borders: NO_BORDER,
        width: { size: colW, type: WidthType.DXA },
        children: [new Paragraph({ children: [] })],
      });

    // Her fiş için hücre oluştur
    const cells: TableCell[] = await Promise.all(
      sorted.map(async (file) => {
        const resized = await sharp(file.buffer)
          .resize({ width: FIS_MAX_W, height: FIS_MAX_H, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const meta = await sharp(resized).metadata();
        const imgW = meta.width ?? FIS_MAX_W;
        const imgH = meta.height ?? FIS_MAX_H;

        const dateStr = allDates[file.originalname] ?? '';
        let displayDate = dateStr;
        if (dateStr && dateStr.includes('-')) {
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
              spacing: { before: 40, after: 40 },
              children: [
                new ImageRun({
                  data: resized,
                  transformation: { width: imgW, height: imgH },
                  type: 'jpg',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 80 },
              children: [
                new TextRun({ text: displayDate, size: 18, bold: true }),
              ],
            }),
          ],
        });
      }),
    );

    // Hücreleri satırlara böl (3'lü gruplar)
    const rows: TableRow[] = [];
    for (let i = 0; i < cells.length; i += COLS) {
      const rowCells = cells.slice(i, i + COLS);
      // Son satırda eksik hücre varsa boş ekle
      while (rowCells.length < COLS) {
        rowCells.push(emptyCell());
      }
      rows.push(new TableRow({ children: rowCells }));
    }

    const table = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: usableW, type: WidthType.DXA },
      rows,
      borders: {
        top:            { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom:         { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:           { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right:          { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideH:        { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideV:        { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
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
                top:    convertMillimetersToTwip(12.7),
                right:  convertMillimetersToTwip(12.7),
                bottom: convertMillimetersToTwip(12.7),
                left:   convertMillimetersToTwip(12.7),
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
