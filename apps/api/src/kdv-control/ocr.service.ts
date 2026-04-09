import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  confidence: number; // 0-1
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * JPEG/PNG görselinden OCR ile belge bilgilerini çıkarır.
   * Türkçe + İngilizce dil desteği.
   * İki geçişli doğrulama: düşük güven alanları çapraz kontrol edilir.
   */
  async extractFromImage(imageBuffer: Buffer): Promise<OcrResult> {
    try {
      const result = await Tesseract.recognize(imageBuffer, 'tur+eng', {
        logger: () => {},
      });

      const rawText = result.data.text;
      const confidence = (result.data.confidence ?? 0) / 100;

      const belgeNo = this.extractBelgeNo(rawText);
      const date    = this.extractDate(rawText);
      const kdv     = this.extractKdv(rawText);

      // Güven eşiği altında ve kritik alan eksikse ikinci geçiş
      if (confidence < 0.70 && (!date || !kdv)) {
        const result2 = await Tesseract.recognize(imageBuffer, 'tur+eng', {
          logger: () => {},
        });
        const text2   = result2.data.text;
        const conf2   = (result2.data.confidence ?? 0) / 100;
        const bestConf = Math.max(confidence, conf2);

        return {
          rawText: rawText + '\n---\n' + text2,
          belgeNo: belgeNo ?? this.extractBelgeNo(text2),
          date:    date    ?? this.extractDate(text2),
          kdvTutari: kdv  ?? this.extractKdv(text2),
          confidence: bestConf,
        };
      }

      return { rawText, belgeNo, date, kdvTutari: kdv, confidence };
    } catch (err) {
      this.logger.error('OCR hatası:', err);
      return { rawText: '', belgeNo: null, date: null, kdvTutari: null, confidence: 0 };
    }
  }

  /**
   * Belge/Fiş/Fatura numarasını tespit eder.
   */
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      // Açık etiketler
      /(?:fatura|fiş|belge|seri|seri[- ]?no|evrak|makbuz)\s*(?:no|numarası|numarasi|#|:)?\s*[:\s#.]*([A-Z0-9\-]{3,20})/i,
      /(?:invoice|receipt)\s*(?:no|#)[:\s]*([A-Z0-9\-]{3,20})/i,
      // Luca / standart format: AAA2026000000008
      /\b([A-Z]{1,4}20\d{2}\d{6,10})\b/,
      // Sadece sayısal: 8-16 hane
      /\b(\d{8,16})\b/,
      // 4+ karakter alfanümerik
      /\b([A-Z]{2,4}\d{4,})\b/,
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  /**
   * Tarih tespiti — tüm yaygın Türkçe formatları destekler.
   * DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD
   */
  private extractDate(text: string): string | null {
    // DD separator MM separator YYYY
    const pattern1 = /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})\b/g;
    // YYYY-MM-DD (ISO)
    const pattern2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

    // DD.MM.YYYY veya DD-MM-YYYY veya DD/MM/YYYY
    const matches1 = [...text.matchAll(pattern1)];
    for (const m of matches1) {
      const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) {
        return `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
      }
    }

    // YYYY-MM-DD
    const matches2 = [...text.matchAll(pattern2)];
    for (const m of matches2) {
      const y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) {
        return `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
      }
    }

    // OCR bozukluğu toleransı: "O" → "0", "l"→"1" dönüşümü sonrası tekrar dene
    const fixed = text
      .replace(/O(\d)/g, '0$1').replace(/(\d)O/g, '$10')
      .replace(/l(\d)/g, '1$1').replace(/(\d)l/g, '$11');
    if (fixed !== text) return this.extractDate(fixed);

    return null;
  }

  /**
   * KDV tutarını tespit eder.
   * Z-raporu, e-Fatura, fiş gibi farklı formatlara uyumlu.
   */
  private extractKdv(text: string): string | null {
    const patterns = [
      // Açık KDV etiketi
      /k\.?d\.?v\.?\s*(?:tutarı?|miktarı?)?\s*[:=]?\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]?\s*([\d.,]+)/i,
      /(?:vergi|tax)\s*(?:tutarı?|amount)?\s*[:=]?\s*([\d.,]+)/i,
      // Oran öneki: %20 KDV 100,00
      /%\s*\d+\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
      // Z-raporu satır: "KDV %10 123,45"
      /kdv\s+%?\s*\d+\s+([\d.,]+)/i,
      // "TOPLAM KDV" satırı
      /toplam\s+(?:kdv|k\.d\.v)\s*[:=]?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const cleaned = m[1].replace(/\s/g, '');
        // En az 1 rakam içermeli
        if (/\d/.test(cleaned)) return cleaned;
      }
    }
    return null;
  }

  /**
   * Güven eşiğini kontrol eder.
   * 0.55 altı = LOW_CONFIDENCE (kullanıcı onayı gerekli)
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.confidence < 0.55) return true;
    // Tarih ve KDV her ikisi de eksikse düşük güven
    const missingBoth = !result.date && !result.kdvTutari;
    return missingBoth;
  }
}
