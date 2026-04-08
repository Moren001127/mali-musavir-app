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
  PageBreak,
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

/* ─── Yardımcı: Türkçe ay adları ───────────────────────────── */
const TR_MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6,
  temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12,
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

function extractDateFromText(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');

  // DD.MM.YYYY  DD/MM/YYYY  DD-MM-YYYY
  let m = t.match(/\b(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})\b/);
  if (m) return parseDate(m[1], parseInt(m[2], 10), m[3]);

  // YYYY-MM-DD
  m = t.match(/\b(\d{4})[.\-](\d{2})[.\-](\d{2})\b/);
  if (m) return parseDate(m[3], parseInt(m[2], 10), m[1]);

  // DD.MM.YY
  m = t.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2})\b/);
  if (m) return parseDate(m[1], parseInt(m[2], 10), m[3]);

  // DD Ocak 2025 / 5 MART 2024
  m = t.match(/\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (m) return parseDate(m[1], m[2], m[3]);

  return null;
}

/* ─── Service ───────────────────────────────────────────────── */

@Injectable()
export class FisYazdirmaService {
  private readonly logger = new Logger(FisYazdirmaService.name);

  /**
   * Görseli OCR ile tarar, tarih varsa döndürür.
   * Sharp ile üst %40 kırpma + gri tonu + normalize → Tesseract
   */
  private async ocrDate(buffer: Buffer): Promise<string | null> {
    let worker: any = null;
    try {
      // Ön işlem: üst %40 kırp, gri tonu, normalize, 600px
      const meta = await sharp(buffer).metadata();
      const cropH = Math.max(80, Math.floor((meta.height ?? 300) * 0.45));
      const processed = await sharp(buffer)
        .extract({ left: 0, top: 0, width: meta.width!, height: cropH })
        .grayscale()
        .normalize()
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();

      worker = await createWorker(['tur', 'eng']);
      const { data } = await worker.recognize(processed);
      const date = extractDateFromText(data.text);
      return date;
    } catch (e: any) {
      this.logger.warn(`OCR hatası: ${e.message}`);
      return null;
    } finally {
      if (worker) await worker.terminate().catch(() => {});
    }
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
   * Görselleri OCR ile tarar — /scan endpoint'i için
   */
  async scanImages(files: Express.Multer.File[]): Promise<ScanResult> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    this.logger.log(`OCR tarama başlıyor: ${files.length} görsel, paralel x4`);

    // p-limit: ESM paket, dynamic import ile kullan
    const { default: pLimit } = await (Function('return import("p-limit")')() as Promise<{ default: any }>);
    const limit = pLimit(4);

    const results: { file: Express.Multer.File; date: string | null }[] = await Promise.all(
      files.map((file) =>
        limit(async () => {
          const date = await this.ocrDate(file.buffer);
          this.logger.log(`${file.originalname}: ${date ?? 'tarih bulunamadı'}`);
          return { file, date };
        }),
      ),
    );

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

    // Tespit edilenleri tarihe göre sırala
    detected.sort((a, b) => a.date.localeCompare(b.date));

    this.logger.log(`Tarama tamamlandı: ${detected.length} tarih okundu, ${unread.length} teyit bekliyor`);
    return { detected, unread, total: files.length };
  }

  /**
   * Teyit edilmiş tarihlerle Word belgesi oluştur — /process endpoint'i için
   */
  async generateWord(
    files: Express.Multer.File[],
    allDates: Record<string, string>, // filename → YYYY-MM-DD
  ): Promise<Buffer> {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }

    // Tarihi olmayan var mı?
    const missing = files.filter((f) => !allDates[f.originalname]);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Şu fişler için tarih eksik: ${missing.map((f) => f.originalname).join(', ')}`,
      );
    }

    // Tarihe göre sırala
    const sorted = [...files].sort((a, b) => {
      const da = allDates[a.originalname] ?? '';
      const db = allDates[b.originalname] ?? '';
      return da.localeCompare(db);
    });

    // Word oluştur
    const children: Paragraph[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const file = sorted[i];
      const dateStr = allDates[file.originalname];

      // Görseli A4'e uygun boyuta getir
      const resized = await sharp(file.buffer)
        .resize({ width: 520, height: 680, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();

      const meta = await sharp(resized).metadata();
      const w = meta.width ?? 400;
      const h = meta.height ?? 300;

      // Görsel paragrafı
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: resized,
              transformation: { width: w, height: h },
              type: 'jpg',
            }),
          ],
        }),
      );

      // Tarih etiketi
      const [y, mo, d] = dateStr.split('-');
      const displayDate = `${d}.${mo}.${y}`;

      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: displayDate, size: 22, bold: true })],
          spacing: { after: 160 },
        }),
      );

      // Sayfa sonu (son fiş hariç)
      if (i < sorted.length - 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });
    return Packer.toBuffer(doc);
  }
}
