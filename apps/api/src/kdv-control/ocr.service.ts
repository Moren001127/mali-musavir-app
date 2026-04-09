import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { existsSync } from 'fs';
import { join } from 'path';

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  totalTutari: string | null;
  confidence: number;
}

const TESSDATA_PATH = '/app/tessdata';

@Injectable()
export class OcrService implements OnModuleInit {
  private readonly logger = new Logger(OcrService.name);
  private turAvailable = false;
  private engAvailable = false;

  onModuleInit() {
    this.turAvailable = existsSync(join(TESSDATA_PATH, 'tur.traineddata'));
    this.engAvailable = existsSync(join(TESSDATA_PATH, 'eng.traineddata'));
    this.logger.log(
      `Tessdata → tur: ${this.turAvailable ? '✅' : '❌'}  eng: ${this.engAvailable ? '✅' : '❌'}  (${TESSDATA_PATH})`,
    );
  }

  /**
   * tesseract.js WASM ile OCR — dil dosyaları Docker imajına gömülü.
   * Geçiş 1: tur+eng  |  Geçiş 2 (eksik alan varsa): eng
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);

    try {
      // ── Geçiş 1 ──────────────────────────────────────────────────────────
      const lang1 = this.turAvailable ? 'tur+eng' : 'eng';
      const text1 = await this.runOcr(imageBuffer, lang1);
      this.logger.debug(`OCR Geçiş-1 (${lang1}): ${text1.slice(0, 120).replace(/\n/g, ' ')}`);

      let date    = this.extractDate(text1);
      let belgeNo = belgeNoFromFilename ?? this.extractBelgeNo(text1);
      let kdv     = this.extractKdvTotal(text1);
      let toplam  = this.extractToplam(text1);
      let rawText = text1;

      // ── Geçiş 2: tarih veya KDV hâlâ eksikse ────────────────────────────
      if (!date || !kdv) {
        try {
          const text2 = await this.runOcr(imageBuffer, 'eng');
          rawText  = text1 + '\n\n--- Geçiş 2 ---\n' + text2;
          date    = date    ?? this.extractDate(text2);
          belgeNo = belgeNo ?? this.extractBelgeNo(text2);
          kdv     = kdv     ?? this.extractKdvTotal(text2);
          toplam  = toplam  ?? this.extractToplam(text2);
        } catch { /* geçiş 2 başarısız olsa da devam */ }
      }

      // ── OCR bozukluk düzeltme ─────────────────────────────────────────────
      if (!date || !kdv) {
        const fixed = this.fixOcrNoise(rawText);
        date    = date    ?? this.extractDate(fixed);
        belgeNo = belgeNo ?? this.extractBelgeNo(fixed);
        kdv     = kdv     ?? this.extractKdvTotal(fixed);
        toplam  = toplam  ?? this.extractToplam(fixed);
      }

      // ── Z-raporu: toplam → KDV ────────────────────────────────────────────
      if (!kdv && toplam) kdv = this.inferKdvFromTotal(rawText, toplam);

      // Dosya adından belgeNo her zaman önceliklidir
      if (belgeNoFromFilename) belgeNo = belgeNoFromFilename;

      const foundFields = [date, kdv].filter(Boolean).length;
      const confidence  = belgeNoFromFilename
        ? 0.33 + foundFields * 0.33
        : foundFields / 3;

      this.logger.log(
        `OCR [${originalName}] belgeNo:${belgeNo ?? '-'} tarih:${date ?? '-'} kdv:${kdv ?? '-'} conf:%${Math.round(confidence * 100)}`,
      );

      return { rawText: rawText.slice(0, 3000), belgeNo, date, kdvTutari: kdv, totalTutari: toplam, confidence };
    } catch (err: any) {
      this.logger.error(`OCR hatası [${originalName}]: ${err?.message}`);
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null, kdvTutari: null, totalTutari: null,
        confidence: belgeNoFromFilename ? 0.35 : 0,
      };
    }
  }

  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date)    return false;
    return true;
  }

  // ─── tesseract.js WASM çağrısı ───────────────────────────────────────────────
  private async runOcr(buffer: Buffer, lang: string): Promise<string> {
    const worker = await createWorker(lang, 1, {
      cachePath: TESSDATA_PATH,
      logger: () => {},
    } as any);
    try {
      const { data } = await worker.recognize(buffer);
      return data.text || '';
    } finally {
      await worker.terminate();
    }
  }

  // ─── Dosya adından belgeNo ───────────────────────────────────────────────────
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base))         return base.toUpperCase();
    return null;
  }

  // ─── Tarih çıkarma ───────────────────────────────────────────────────────────
  private extractDate(text: string): string | null {
    // DD - MM - YYYY (boşluklu tire)
    for (const m of text.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d <= 31 && +mo <= 12 && +y >= 2000 && +y <= 2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    // DD.MM.YYYY / DD/MM/YYYY
    for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d <= 31 && +mo <= 12 && +y >= 2000 && +y <= 2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    // YYYY-MM-DD
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
      const [, y, mo, d] = m;
      if (+d <= 31 && +mo <= 12)
        return `${d}.${mo}.${y}`;
    }
    return null;
  }

  // ─── Belge No (OCR fallback) ─────────────────────────────────────────────────
  private extractBelgeNo(text: string): string | null {
    for (const p of [
      /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
      /(?:fiş|belge|evrak)\s*(?:no|numarası)?[:\s#.]*([A-Z0-9]{8,20})/i,
      /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
    ]) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim().toUpperCase();
    }
    return null;
  }

  // ─── KDV tutarı çıkarma ──────────────────────────────────────────────────────
  private extractKdvTotal(text: string): string | null {
    // "Hesaplanan KDV (%20) : 6.000,00" veya "Hesaplanan KDV : 70,00" (parantez opsiyonel)
    const multi = [...text.matchAll(/hesaplanan\s*kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (multi.length > 0) {
      const total = multi.reduce((s, m) => s + this.parseAmount(m[1]), 0);
      if (total > 0) return this.formatAmount(total);
    }

    // Toplam KDV
    const tk = text.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (tk?.[1]) return tk[1].replace(/\s/g, '');

    // Genel etiketler
    for (const p of [
      /k\.?d\.?v\.?\s*(?:tutarı?|miktarı?)?\s*[:=]\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]\s*([\d.,]+)/i,
      /k\.?d\.?v\.?\s+%?\s*\d+\s+([\d.,]+)/i,
      /%\s*\d+\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
      /kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/i,
    ]) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g, '');
    }
    return null;
  }

  // ─── Toplam tutar ────────────────────────────────────────────────────────────
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

  // ─── Z-raporu KDV hesaplama ──────────────────────────────────────────────────
  private inferKdvFromTotal(text: string, toplamStr: string): string | null {
    const om = text.match(/%\s*(20|10|8|1)\b/);
    if (!om) return null;
    const toplam = this.parseAmount(toplamStr);
    if (!toplam) return null;
    return this.formatAmount(toplam * +om[1] / (100 + +om[1]));
  }

  // ─── OCR bozukluk düzeltme ───────────────────────────────────────────────────
  private fixOcrNoise(text: string): string {
    return text
      .replace(/(?<=[^A-Za-z])O(?=\d)/g, '0')
      .replace(/(?<=\d)O(?=[^A-Za-z])/g, '0')
      .replace(/(?<=[^A-Za-z])l(?=\d)/g, '1')
      .replace(/(?<=\d)l(?=[^A-Za-z])/g, '1');
  }

  // ─── Yardımcılar ─────────────────────────────────────────────────────────────
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
