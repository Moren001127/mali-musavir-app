import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  totalTutari: string | null;   // Z-raporu toplam (inferance için)
  confidence: number;           // 0-1
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * Çok aşamalı OCR:
   * 1. Geçiş: tur+eng
   * 2. Geçiş (sadece kritik alan eksikse): tur tek dil
   * 3. OCR bozukluk düzeltme: O→0, l→1, B→8, S→5
   * 4. Z-raporu toplam → KDV hesaplama
   */
  async extractFromImage(imageBuffer: Buffer): Promise<OcrResult> {
    try {
      // --- Geçiş 1: tur+eng ---
      const r1 = await Tesseract.recognize(imageBuffer, 'tur+eng', { logger: () => {} });
      const text1 = r1.data.text;
      const conf1 = (r1.data.confidence ?? 0) / 100;

      let date     = this.extractDate(text1);
      let belgeNo  = this.extractBelgeNo(text1);
      let kdv      = this.extractKdv(text1);
      let toplam   = this.extractToplam(text1);
      let rawText  = text1;
      let bestConf = conf1;

      // --- Geçiş 2: sadece tarih VEYA belgeNo eksikse tur tek dil dene ---
      if (!date || !belgeNo) {
        try {
          const r2 = await Tesseract.recognize(imageBuffer, 'tur', { logger: () => {} });
          const text2 = r2.data.text;
          const conf2 = (r2.data.confidence ?? 0) / 100;
          bestConf = Math.max(conf1, conf2);
          rawText  = text1 + '\n\n--- Geçiş 2 ---\n' + text2;

          date    = date    ?? this.extractDate(text2);
          belgeNo = belgeNo ?? this.extractBelgeNo(text2);
          kdv     = kdv     ?? this.extractKdv(text2);
          toplam  = toplam  ?? this.extractToplam(text2);
        } catch { /* ikinci geçiş başarısız olsa bile devam */ }
      }

      // --- OCR bozukluk toleransı: O→0, l→1, B→8, S→5 ---
      if (!date || !belgeNo || !kdv) {
        const fixed = this.fixOcrNoise(rawText);
        date    = date    ?? this.extractDate(fixed);
        belgeNo = belgeNo ?? this.extractBelgeNo(fixed);
        kdv     = kdv     ?? this.extractKdv(fixed);
        toplam  = toplam  ?? this.extractToplam(fixed);
      }

      // --- Z-raporu toplam → KDV hesaplama ---
      if (!kdv && toplam) {
        kdv = this.inferKdvFromTotal(rawText, toplam);
      }

      return { rawText: rawText.slice(0, 3000), belgeNo, date, kdvTutari: kdv, totalTutari: toplam, confidence: bestConf };
    } catch (err) {
      this.logger.error('OCR hatası:', err);
      return { rawText: '', belgeNo: null, date: null, kdvTutari: null, totalTutari: null, confidence: 0 };
    }
  }

  /**
   * Akıllı güven değerlendirmesi:
   * - Tarih bulundu + (belgeNo VEYA KDV bulundu) → SUCCESS
   * - Tarih bulundu ama başka hiçbir şey yok → LOW_CONFIDENCE
   * - Hiçbir alan yok → LOW_CONFIDENCE
   * - KDV bulunamayan Z-raporu → SUCCESS (çapraz eşleştirme Excel'i kullanır)
   */
  isLowConfidence(result: OcrResult): boolean {
    const hasDate   = !!result.date;
    const hasKdv    = !!result.kdvTutari;
    const hasNo     = !!result.belgeNo;
    const hasAny    = hasDate || hasKdv || hasNo;

    if (!hasAny) return true;           // Hiçbir şey okunamadı
    if (!hasDate && !hasNo) return true; // Sadece KDV var ama tarih/no yok → güvensiz
    return false;                        // Tarih veya belge no varsa SUCCESS
  }

  // ─── Tarih çıkarma ───────────────────────────────────────────────────────────
  private extractDate(text: string): string | null {
    // DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
    for (const m of text.matchAll(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 && +y >= 2000 && +y <= 2100) {
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
      }
    }
    // YYYY-MM-DD
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
      const [, y, mo, d] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12) {
        return `${d}.${mo}.${y}`;
      }
    }
    return null;
  }

  // ─── Belge No çıkarma ────────────────────────────────────────────────────────
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      /(?:fatura|fiş|belge|seri|evrak|makbuz)\s*(?:no|numarası|#)?[:\s#.]*([A-Z0-9\-]{3,20})/i,
      /(?:invoice|receipt)\s*(?:no|#)[:\s]*([A-Z0-9\-]{3,20})/i,
      /\b([A-Z]{1,4}20\d{2}\d{6,10})\b/,
      /\b([A-Z]{2,4}\d{4,})\b/,
      /\b(\d{8,16})\b/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  // ─── KDV tutarı çıkarma ──────────────────────────────────────────────────────
  private extractKdv(text: string): string | null {
    const patterns = [
      /k\.?d\.?v\.?\s*(?:tutarı?|miktarı?)?\s*[:=]\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]\s*([\d.,]+)/i,
      /(?:vergi|tax)\s*(?:tutarı?|amount)?\s*[:=]\s*([\d.,]+)/i,
      /toplam\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
      /k\.?d\.?v\.?\s+%?\s*\d+\s+([\d.,]+)/i,
      /%\s*\d+\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
      /kdv\s+(?:dahil\s+)?(?:toplam\s+)?(?:tutar\s+)?([\d.,]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g,'');
    }
    return null;
  }

  // ─── Toplam tutarı çıkarma (Z-raporu için) ───────────────────────────────────
  private extractToplam(text: string): string | null {
    const patterns = [
      /genel\s+toplam\s*[:=]\s*([\d.,]+)/i,
      /(?:^|\n)\s*toplam\s*[:=]?\s*([\d.,]+)/im,
      /nakit\s+(?:toplam\s+)?([\d.,]+)/i,
      /(?:net|brut)\s+tutar\s*[:=]\s*([\d.,]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g,'');
    }
    return null;
  }

  // ─── Z-raporu toplam → KDV hesaplama ────────────────────────────────────────
  private inferKdvFromTotal(text: string, toplamStr: string): string | null {
    const oranMatch = text.match(/%\s*(20|10|8|1)\b/);
    if (!oranMatch) return null;
    const oran   = parseInt(oranMatch[1]);
    const toplam = parseFloat(toplamStr.replace(/\./g,'').replace(',','.'));
    if (!toplam || !oran) return null;
    const kdv = toplam * oran / (100 + oran);
    return kdv.toFixed(2).replace('.',',');
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
}
