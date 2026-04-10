import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  totalTutari: string | null;
  confidence: number;
  engine: string;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private tesseractAvailable = false;
  private tesseractChecked = false;

  constructor() {
    // Tesseract'ı constructor'da değil, ilk kullanımda kontrol et
    this.tesseractAvailable = true; // Varsayım: çalışıyor
  }

  private async ensureTesseract(): Promise<boolean> {
    if (this.tesseractChecked) return this.tesseractAvailable;
    
    this.tesseractChecked = true;
    try {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},
        errorHandler: () => {},
      });
      await worker.terminate();
      this.tesseractAvailable = true;
      this.logger.log('✅ Tesseract.js WASM hazır');
    } catch (e) {
      this.logger.error('❌ Tesseract.js WASM başlatılamadı:', e?.message);
      this.tesseractAvailable = false;
    }
    return this.tesseractAvailable;
  }

  /**
   * ÇOKLU OCR MOTORU
   * 1. Tesseract.js (tur+eng)
   * 2. Görsel ön işleme (kontrast, keskinlik)
   * 3. Çapraz doğrulama
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);
    
    // Tesseract'ın çalıştığından emin ol
    const tesseractReady = await this.ensureTesseract();
    
    if (!tesseractReady) {
      this.logger.warn('Tesseract kullanılamıyor - dosya adından belgeNo dönülüyor');
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: belgeNoFromFilename ? 0.3 : 0,
        engine: 'filename-only',
      };
    }

    try {
      // === GEÇİŞ 1: Orijinal görsel ===
      const result1 = await this.runTesseract(imageBuffer, 'tur+eng');
      const extract1 = this.extractAllFields(result1.text);
      
      // === GEÇİŞ 2: Kontrast artırılmış görsel ===
      let result2: { text: string; confidence: number } = { text: '', confidence: 0 };
      let extract2 = { belgeNo: null as string | null, date: null as string | null, kdv: null as string | null, toplam: null as string | null };
      
      // Eğer ilk geçişte KDV bulunamadıysa, görseli işleyip tekrar dene
      if (!extract1.kdv) {
        try {
          const processedBuffer = await this.preprocessImage(imageBuffer);
          result2 = await this.runTesseract(processedBuffer, 'tur+eng');
          extract2 = this.extractAllFields(result2.text);
        } catch (e) {
          this.logger.debug('Görsel işleme başarısız:', e?.message);
        }
      }

      // === GEÇİŞ 3: Sadece Türkçe ===
      let result3: { text: string; confidence: number } = { text: '', confidence: 0 };
      let extract3 = { belgeNo: null as string | null, date: null as string | null, kdv: null as string | null, toplam: null as string | null };
      
      if (!extract1.kdv && !extract2.kdv) {
        try {
          result3 = await this.runTesseract(imageBuffer, 'tur');
          extract3 = this.extractAllFields(result3.text);
        } catch (e) {
          this.logger.debug('Türkçe geçiş başarısız:', e?.message);
        }
      }

      // === ÇAPRAZ DOĞRULAMA ===
      // En iyi sonuçları birleştir
      const bestResult = this.mergeResults([extract1, extract2, extract3]);
      
      // Dosya adından belgeNo varsa, OCR sonucunu ezme
      if (belgeNoFromFilename) {
        bestResult.belgeNo = belgeNoFromFilename;
      }

      // Ham metin birleştir
      const combinedText = [result1.text, result2.text, result3.text]
        .filter(t => t.length > 0)
        .join('\n\n--- Farklı Geçiş ---\n');

      // Güven skoru hesapla
      const foundFields = [
        bestResult.belgeNo,
        bestResult.date,
        bestResult.kdv
      ].filter(Boolean).length;
      
      const confidence = belgeNoFromFilename 
        ? 0.3 + (foundFields / 3) * 0.7
        : foundFields / 3;

      this.logger.log(
        `OCR [${originalName}] Motor:Tesseract Geçiş:3 Alan:${foundFields}/3 Conf:%${Math.round(confidence * 100)}`
      );

      return {
        rawText: combinedText.slice(0, 3000),
        belgeNo: bestResult.belgeNo,
        date: bestResult.date,
        kdvTutari: bestResult.kdv,
        totalTutari: bestResult.toplam,
        confidence,
        engine: 'tesseract-multi',
      };

    } catch (err) {
      this.logger.error(`OCR hatası [${originalName}]:`, err?.message);
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: belgeNoFromFilename ? 0.3 : 0,
        engine: 'error-fallback',
      };
    }
  }

  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date) return false;
    return true;
  }

  // === TESSERACT ÇALIŞTIRMA ===
  private async runTesseract(buffer: Buffer, lang: string): Promise<{ text: string; confidence: number }> {
    const worker = await Tesseract.createWorker(lang);
    try {
      const { data } = await worker.recognize(buffer);
      return {
        text: data.text || '',
        confidence: (data.confidence || 0) / 100,
      };
    } finally {
      await worker.terminate();
    }
  }

  // === GÖRSEL ÖN İŞLEME (Sharp ile) ===
  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      const sharpModule = await import('sharp');
      const sharp = sharpModule.default || sharpModule;
      return await sharp(buffer)
        .greyscale() // Siyah-beyaz
        .normalize() // Kontrast normalize
        .sharpen(1.5, 1, 2) // Keskinlik (sigma, flat, jagged)
        .threshold(128) // Eşikleme
        .toBuffer();
    } catch {
      // Sharp yoksa orijinali döndür
      return buffer;
    }
  }

  // === SONUÇLARI BİRLEŞTİR ===
  private mergeResults(results: Array<{ belgeNo: any; date: any; kdv: any; toplam: any }>) {
    // Her alan için en iyi sonucu seç
    const best = {
      belgeNo: null as string | null,
      date: null as string | null,
      kdv: null as string | null,
      toplam: null as string | null,
    };

    for (const r of results) {
      if (r.belgeNo && !best.belgeNo) best.belgeNo = r.belgeNo;
      if (r.date && !best.date) best.date = r.date;
      if (r.kdv && !best.kdv) best.kdv = r.kdv;
      if (r.toplam && !best.toplam) best.toplam = r.toplam;
    }

    return best;
  }

  // === TÜM ALANLARI ÇIKAR ===
  private extractAllFields(text: string) {
    return {
      belgeNo: this.extractBelgeNo(text),
      date: this.extractDate(text),
      kdv: this.extractKdvTotal(text),
      toplam: this.extractToplam(text),
    };
  }

  // === DOSYA ADINDAN BELGENO ===
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    return null;
  }

  // === TARİH ÇIKARMA ===
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

  // === BELGENO ÇIKARMA ===
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
      /(?:fiş|belge|evrak)\s*(?:no|numarası)?[:\s#.]*([A-Z0-9]{8,20})/i,
      /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim().toUpperCase();
    }
    return null;
  }

  // === KDV TUTARI ÇIKARMA (Geliştirilmiş) ===
  private extractKdvTotal(text: string): string | null {
    // 1. "Hesaplanan KDV" satırları (çoklu oran desteği)
    const hesaplananKdvMatches = [...text.matchAll(/hesaplanan\s*kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (hesaplananKdvMatches.length > 0) {
      const total = hesaplananKdvMatches.reduce((sum, m) => sum + this.parseAmount(m[1]), 0);
      if (total > 0) return this.formatAmount(total);
    }

    // 2. "KDV" etiketli değerler
    const kdvMatches = [...text.matchAll(/k\.?d\.?v\.?\s*(?:tutarı?)?\s*[:=]\s*([\d.,]+)/gi)];
    if (kdvMatches.length > 0) {
      // En büyük KDV değerini al (genellikle toplam KDV'dir)
      const values = kdvMatches.map(m => this.parseAmount(m[1])).filter(v => v > 0);
      if (values.length > 0) return this.formatAmount(Math.max(...values));
    }

    // 3. "Toplam KDV"
    const toplamKdv = text.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplamKdv?.[1]) return toplamKdv[1].replace(/\s/g, '');

    // 4. % işareti olan KDV değerleri
    const percentKdv = text.match(/%\s*\d+\s+([\d.,]+)/);
    if (percentKdv?.[1]) return percentKdv[1].replace(/\s/g, '');

    // 5. Genel "vergi" veya "tax" araması
    const vergi = text.match(/(?:vergi|tax)\s*(?:tutarı?)?\s*[:=]\s*([\d.,]+)/i);
    if (vergi?.[1]) return vergi[1].replace(/\s/g, '');

    return null;
  }

  // === TOPLAM TUTAR ÇIKARMA ===
  private extractToplam(text: string): string | null {
    const patterns = [
      /genel\s+toplam\s*[:=]\s*([\d.,]+)/i,
      /(?:^|\n)\s*toplam\s*[:=]?\s*([\d.,]+)/im,
      /nakit\s+(?:toplam\s+)?([\d.,]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g, '');
    }
    return null;
  }

  // === YARDIMCI FONKSİYONLAR ===
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
