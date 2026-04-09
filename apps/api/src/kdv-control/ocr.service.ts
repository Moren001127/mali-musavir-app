import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync  = promisify(exec);
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
export class OcrService implements OnModuleInit {
  private readonly logger = new Logger(OcrService.name);
  private tesseractPath = 'tesseract';
  private tesseractAvailable = false;

  /** Servis başlarken tesseract durumunu logla */
  async onModuleInit() {
    try {
      const { stdout } = await execAsync('which tesseract || where tesseract 2>/dev/null');
      this.tesseractPath = stdout.trim().split('\n')[0];
      const { stdout: ver } = await execAsync('tesseract --version 2>&1 | head -1');
      this.tesseractAvailable = true;
      this.logger.log(`✅ Tesseract bulundu: ${this.tesseractPath} | ${ver.trim()}`);
    } catch (e) {
      this.tesseractAvailable = false;
      this.logger.error(`❌ Tesseract BULUNAMADI: ${e?.message}`);
    }
  }

  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);

    if (!this.tesseractAvailable) {
      this.logger.warn('Tesseract mevcut değil — yalnızca dosya adından belgeNo alınıyor');
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null, kdvTutari: null, totalTutari: null,
        confidence: belgeNoFromFilename ? 0.35 : 0,
      };
    }

    try {
      // Stdin pipe ile çalıştır (temp dosya yazma sorunu yok)
      const text1 = await this.runTesseractFromBuffer(imageBuffer, 'tur+eng');
      this.logger.debug(`OCR Geçiş-1 ham metin (ilk 200 karakter): ${text1.slice(0, 200)}`);

      let date    = this.extractDate(text1);
      let belgeNo = belgeNoFromFilename ?? this.extractBelgeNo(text1);
      let kdv     = this.extractKdvTotal(text1);
      let toplam  = this.extractToplam(text1);
      let rawText = text1;

      if (!date || !kdv) {
        try {
          const text2 = await this.runTesseractFromBuffer(imageBuffer, 'tur');
          rawText  = text1 + '\n\n--- Geçiş 2 ---\n' + text2;
          date    = date    ?? this.extractDate(text2);
          belgeNo = belgeNo ?? this.extractBelgeNo(text2);
          kdv     = kdv     ?? this.extractKdvTotal(text2);
          toplam  = toplam  ?? this.extractToplam(text2);
        } catch (e2) {
          this.logger.warn(`OCR Geçiş-2 hatası: ${e2?.message}`);
        }
      }

      if (!date || !kdv) {
        const fixed = this.fixOcrNoise(rawText);
        date    = date    ?? this.extractDate(fixed);
        belgeNo = belgeNo ?? this.extractBelgeNo(fixed);
        kdv     = kdv     ?? this.extractKdvTotal(fixed);
        toplam  = toplam  ?? this.extractToplam(fixed);
      }

      if (!kdv && toplam) kdv = this.inferKdvFromTotal(rawText, toplam);
      if (belgeNoFromFilename) belgeNo = belgeNoFromFilename;

      const foundFields = [date, kdv].filter(Boolean).length;
      const confidence  = belgeNoFromFilename
        ? 0.33 + (foundFields * 0.33)
        : foundFields / 3;

      this.logger.log(
        `OCR [${originalName}] → belgeNo:${belgeNo} tarih:${date} kdv:${kdv} conf:${(confidence*100).toFixed(0)}%`
      );

      return {
        rawText: rawText.slice(0, 3000),
        belgeNo, date, kdvTutari: kdv, totalTutari: toplam, confidence,
      };
    } catch (err) {
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

  // ─── Tesseract — stdin pipe ──────────────────────────────────────────────────
  private runTesseractFromBuffer(buffer: Buffer, lang: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // tesseract stdin stdout -l tur+eng --psm 3 --oem 1
      const proc = require('child_process').spawn(
        'tesseract',
        ['stdin', 'stdout', '-l', lang, '--psm', '3', '--oem', '1'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`tesseract exit ${code}: ${stderr.slice(0, 200)}`));
        } else {
          resolve(stdout);
        }
      });
      proc.on('error', (e: Error) => reject(e));

      // Buffer'ı stdin'e yaz ve kapat
      proc.stdin.write(buffer);
      proc.stdin.end();
    });
  }

  // ─── Dosya adından belgeNo ───────────────────────────────────────────────────
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    return null;
  }

  // ─── Tarih çıkarma ───────────────────────────────────────────────────────────
  private extractDate(text: string): string | null {
    for (const m of text.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d<=31 && +mo<=12 && +y>=2000 && +y<=2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d<=31 && +mo<=12 && +y>=2000 && +y<=2100)
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
    }
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
      const [, y, mo, d] = m;
      if (+d<=31 && +mo<=12)
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
    // Hesaplanan KDV (parantez opsiyonel): "Hesaplanan KDV (%20) : 6.000,00" veya "Hesaplanan KDV : 70,00"
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
    const oran   = parseInt(om[1]);
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
