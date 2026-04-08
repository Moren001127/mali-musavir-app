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
   */
  async extractFromImage(imageBuffer: Buffer): Promise<OcrResult> {
    try {
      const result = await Tesseract.recognize(imageBuffer, 'tur+eng', {
        logger: () => {}, // log sustur
      });

      const rawText = result.data.text;
      const confidence = (result.data.confidence ?? 0) / 100;

      return {
        rawText,
        belgeNo: this.extractBelgeNo(rawText),
        date: this.extractDate(rawText),
        kdvTutari: this.extractKdv(rawText),
        confidence,
      };
    } catch (err) {
      this.logger.error('OCR hatası:', err);
      return { rawText: '', belgeNo: null, date: null, kdvTutari: null, confidence: 0 };
    }
  }

  /**
   * Belge/Fiş/Fatura numarasını tespit eder.
   * Farklı format kalıplarına karşı regex yazar.
   */
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      /(?:fatura|fiş|belge|seri|no|num)[:\s#.]*([A-Z0-9\-]{4,20})/i,
      /(?:invoice|receipt)\s*(?:no|#)[:\s]*([A-Z0-9\-]{4,20})/i,
      /\b([A-Z]{1,4}\d{6,12})\b/,       // Ör: FTR000012345
      /\b(\d{10,16})\b/,                  // Uzun sayısal no
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) return m[1].trim();
    }
    return null;
  }

  /**
   * Tarih tespiti — DD.MM.YYYY, DD/MM/YYYY formatları
   */
  private extractDate(text: string): string | null {
    const patterns = [
      /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,
    ];

    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        const m = matches[0];
        // Geçerli tarih kontrolü
        const d = parseInt(m[1]);
        const mo = parseInt(m[2]);
        const y = parseInt(m[3]);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2099) {
          return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
        }
      }
    }
    return null;
  }

  /**
   * KDV tutarını tespit eder.
   * "KDV: 1.234,56" / "Toplam KDV 1234.56" gibi formatları tanır.
   */
  private extractKdv(text: string): string | null {
    const patterns = [
      /kdv\s*[:=]?\s*([\d.,]+)/i,
      /k\.d\.v\s*[:=]?\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]?\s*([\d.,]+)/i,
      /tax\s*amount\s*[:=]?\s*([\d.,]+)/i,
      // Z raporu için
      /kdv\s+tutarı?\s*[:=]?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) return m[1].trim();
    }
    return null;
  }

  /**
   * KDV güven eşiğini kontrol eder.
   * 0.65 altı = LOW_CONFIDENCE (kullanıcı onayı gerekli)
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.confidence < 0.65) return true;
    // Önemli alanlar eksikse de düşük güven
    const missingCritical = !result.kdvTutari || !result.date;
    return missingCritical;
  }
}
