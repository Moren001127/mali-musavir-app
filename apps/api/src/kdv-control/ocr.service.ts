import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  totalTutari: string | null;
  confidence: number;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * Sistem Tesseract ile OCR (dil dosyaları Docker imajına gömülü):
   * 1. Geçiş: tur+eng dili
   * 2. Geçiş (tarih veya KDV eksikse): sadece tur
   * 3. OCR bozukluk düzeltme
   * 4. Z-raporu toplam → KDV hesaplama
   *
   * NOT: belgeNo dosya adından alınır (en güvenilir kaynak),
   *      tarih ve KDV mutlaka OCR ile belgeden okunur.
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    // belgeNo: dosya adından al (en güvenilir kaynak — dosya adı = belge numarası)
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);

    const tmpFile = join(tmpdir(), `ocr-${randomUUID()}.jpg`);
    try {
      await writeFile(tmpFile, imageBuffer);

      // --- Geçiş 1: tur+eng ---
      const text1 = await this.runTesseract(tmpFile, 'tur+eng');
      let date    = this.extractDate(text1);
      let belgeNo = belgeNoFromFilename ?? this.extractBelgeNo(text1);
      let kdv     = this.extractKdvTotal(text1);
      let toplam  = this.extractToplam(text1);
      let rawText = text1;

      // --- Geçiş 2: tarih veya KDV hâlâ eksikse tur diliyle tekrar ---
      if (!date || !kdv) {
        try {
          const text2 = await this.runTesseract(tmpFile, 'tur');
          rawText  = text1 + '\n\n--- Geçiş 2 ---\n' + text2;
          date    = date    ?? this.extractDate(text2);
          belgeNo = belgeNo ?? this.extractBelgeNo(text2);
          kdv     = kdv     ?? this.extractKdvTotal(text2);
          toplam  = toplam  ?? this.extractToplam(text2);
        } catch { /* devam */ }
      }

      // --- OCR bozukluk düzeltme: O→0, l→1, B→8, S→5 ---
      if (!date || !kdv) {
        const fixed = this.fixOcrNoise(rawText);
        date    = date    ?? this.extractDate(fixed);
        belgeNo = belgeNo ?? this.extractBelgeNo(fixed);
        kdv     = kdv     ?? this.extractKdvTotal(fixed);
        toplam  = toplam  ?? this.extractToplam(fixed);
      }

      // --- Z-raporu: toplam → KDV hesapla ---
      if (!kdv && toplam) {
        kdv = this.inferKdvFromTotal(rawText, toplam);
      }

      // dosya adından gelen belgeNo OCR sonucunu ezmez (zaten daha güvenilir)
      if (belgeNoFromFilename) belgeNo = belgeNoFromFilename;

      // Güven skoru: alan sayısına göre hesapla
      const foundFields = [belgeNo, date, kdv].filter(Boolean).length;
      const confidence = belgeNoFromFilename
        ? Math.max(0.6, foundFields / 3)   // dosya adı varsa min %60
        : foundFields / 3;

      return {
        rawText: rawText.slice(0, 3000),
        belgeNo,
        date,
        kdvTutari: kdv,
        totalTutari: toplam,
        confidence,
      };
    } catch (err) {
      this.logger.error('OCR sistem hatası:', err?.message);
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: belgeNoFromFilename ? 0.5 : 0,
      };
    } finally {
      unlink(tmpFile).catch(() => {});
    }
  }

  /**
   * Güven değerlendirmesi:
   * - BelgeNo (dosya adından) + tarih varsa → SUCCESS
   * - BelgeNo veya tarih yalnız başına varsa → SUCCESS (KDV Excel'den tamamlanır)
   * - Hiçbir alan yoksa → LOW_CONFIDENCE
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date)    return false;
    return true;
  }

  // ─── Sistem Tesseract çağrısı ────────────────────────────────────────────────
  private async runTesseract(imagePath: string, lang: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'tesseract',
        [imagePath, 'stdout', '-l', lang, '--psm', '3', '--oem', '1'],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout || '';
    } catch (err: any) {
      // tesseract stderr'e bazı uyarı mesajları yazar ama stdout çıktısı olabilir
      if (err.stdout) return err.stdout;
      throw err;
    }
  }

  // ─── Dosya adından belgeNo ───────────────────────────────────────────────────
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    // e-Fatura formatı: [A-Z0-9]{3}[YYYY][6-12 rakam sıra]
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    // Genel alfanumerik belge no (min 8 karakter)
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    return null;
  }

  // ─── Tarih çıkarma (belgeden OCR ile) ───────────────────────────────────────
  private extractDate(text: string): string | null {
    // DD - MM - YYYY (boşluklu tire — bazı e-Faturalarda: "04 - 02 - 2026")
    for (const m of text.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 && +y >= 2000 && +y <= 2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    // DD.MM.YYYY / DD/MM/YYYY
    for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 && +y >= 2000 && +y <= 2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    // YYYY-MM-DD
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
      const [, y, mo, d] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12)
        return `${d}.${mo}.${y}`;
    }
    return null;
  }

  // ─── Belge No çıkarma (OCR metninden — fallback) ─────────────────────────────
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
      /(?:fiş|belge|seri|evrak|makbuz)\s*(?:no|numarası)?[:\s#.]*([A-Z0-9]{8,20})/i,
      // e-Fatura: rakam veya harf ile başlayan 3 char + yıl + sıra
      /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim().toUpperCase();
    }
    return null;
  }

  // ─── KDV tutarı çıkarma (e-Fatura + genel) ──────────────────────────────────
  private extractKdvTotal(text: string): string | null {
    // e-Fatura çoklu oran: "Hesaplanan KDV(%X): VALUE" VEYA "Hesaplanan KDV : VALUE" (parantez opsiyonel)
    const multi = [...text.matchAll(/hesaplanan\s*kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (multi.length > 0) {
      const total = multi.reduce((s, m) => s + this.parseAmount(m[1]), 0);
      if (total > 0) return this.formatAmount(total);
    }

    // Tek satır fallback (parantez opsiyonel): "KDV(%20): 6.000,00" veya "KDV : 70,00"
    const single = text.match(/kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/i);
    if (single?.[1]) return single[1].replace(/\s/g, '');

    // Toplam KDV
    const toplam = text.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplam?.[1]) return toplam[1].replace(/\s/g, '');

    // Genel etiketler
    for (const p of [
      /k\.?d\.?v\.?\s*(?:tutarı?|miktarı?)?\s*[:=]\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]\s*([\d.,]+)/i,
      /k\.?d\.?v\.?\s+%?\s*\d+\s+([\d.,]+)/i,
      /%\s*\d+\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
    ]) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g, '');
    }
    return null;
  }

  // ─── Toplam tutarı (Z-raporu için) ──────────────────────────────────────────
  private extractToplam(text: string): string | null {
    for (const p of [
      /genel\s+toplam\s*[:=]\s*([\d.,]+)/i,
      /(?:^|\n)\s*toplam\s*[:=]?\s*([\d.,]+)/im,
      /nakit\s+(?:toplam\s+)?([\d.,]+)/i,
    ]) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g, '');
    }
    return null;
  }

  // ─── Z-raporu toplam → KDV ───────────────────────────────────────────────────
  private inferKdvFromTotal(text: string, toplamStr: string): string | null {
    const oranMatch = text.match(/%\s*(20|10|8|1)\b/);
    if (!oranMatch) return null;
    const oran   = parseInt(oranMatch[1]);
    const toplam = this.parseAmount(toplamStr);
    if (!toplam) return null;
    return this.formatAmount(toplam * oran / (100 + oran));
  }

  // ─── OCR bozukluk düzeltme ───────────────────────────────────────────────────
  private fixOcrNoise(text: string): string {
    return text
      .replace(/(?<=[^A-Za-z])O(?=\d)/g, '0')
      .replace(/(?<=\d)O(?=[^A-Za-z])/g, '0')
      .replace(/(?<=[^A-Za-z])l(?=\d)/g, '1')
      .replace(/(?<=\d)l(?=[^A-Za-z])/g, '1')
      .replace(/(?<=\d)B(?=[^A-Za-z])/g, '8')
      .replace(/(?<=\d)S(?=[^A-Za-z])/g, '5');
  }

  // ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────────
  private parseAmount(str: string): number {
    const c = str.replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(c))
      return parseFloat(c.replace(/\./g, '').replace(',', '.'));
    return parseFloat(c.replace(',', '.')) || 0;
  }

  private formatAmount(n: number): string {
    return n.toFixed(2).replace('.', ',');
  }
}
