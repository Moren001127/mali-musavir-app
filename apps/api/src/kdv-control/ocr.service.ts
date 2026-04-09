import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

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
   * Çok aşamalı OCR + dosya adından belgeNo çıkarımı:
   * 1. Dosya adından belgeNo al (en güvenilir kaynak)
   * 2. Geçiş 1: Tesseract tur+eng
   * 3. Geçiş 2 (eksik alan varsa): tur tek dil
   * 4. OCR bozukluk düzeltme
   * 5. Z-raporu toplam → KDV hesaplama
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    // 1. Dosya adından belgeNo çıkar — en güvenilir yöntem
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);

    try {
      // --- Geçiş 1: tur+eng ---
      const r1 = await Tesseract.recognize(imageBuffer, 'tur+eng', { logger: () => {} });
      const text1 = r1.data.text;
      const conf1 = (r1.data.confidence ?? 0) / 100;

      let date    = this.extractDate(text1);
      let belgeNo = belgeNoFromFilename ?? this.extractBelgeNo(text1);
      let kdv     = this.extractKdvTotal(text1);
      let toplam  = this.extractToplam(text1);
      let rawText = text1;
      let bestConf = conf1;

      // --- Geçiş 2: tarih veya KDV eksikse tur tek dil dene ---
      if (!date || !kdv) {
        try {
          const r2 = await Tesseract.recognize(imageBuffer, 'tur', { logger: () => {} });
          const text2 = r2.data.text;
          const conf2 = (r2.data.confidence ?? 0) / 100;
          bestConf = Math.max(conf1, conf2);
          rawText  = text1 + '\n\n--- Geçiş 2 ---\n' + text2;
          date    = date    ?? this.extractDate(text2);
          belgeNo = belgeNo ?? this.extractBelgeNo(text2);
          kdv     = kdv     ?? this.extractKdvTotal(text2);
          toplam  = toplam  ?? this.extractToplam(text2);
        } catch { /* ikinci geçiş başarısız olsa bile devam */ }
      }

      // --- OCR bozukluk toleransı ---
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

      // Dosya adından belgeNo varsa OCR sonucunu ezmez
      if (belgeNoFromFilename) belgeNo = belgeNoFromFilename;

      // Dosya adından belgeNo varsa minimum güven %60 say (tesseract başarısız bile olsa)
      if (belgeNoFromFilename && bestConf < 0.3) bestConf = 0.6;

      return {
        rawText: rawText.slice(0, 3000),
        belgeNo,
        date,
        kdvTutari: kdv,
        totalTutari: toplam,
        confidence: bestConf,
      };
    } catch (err) {
      this.logger.error('OCR Tesseract hatası:', err?.message);
      // Tesseract tamamen çökse bile dosya adından belgeNo dön
      return {
        rawText: '',
        belgeNo: belgeNoFromFilename,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: belgeNoFromFilename ? 0.5 : 0,
      };
    }
  }

  /**
   * Akıllı güven değerlendirmesi:
   * - BelgeNo + tarih varsa → SUCCESS
   * - BelgeNo varsa (dosya adından) → SUCCESS (KDV Excel'den tamamlanır)
   * - Sadece tarih varsa → SUCCESS (KDV Excel'den tamamlanır)
   * - Hiçbir şey yoksa → LOW_CONFIDENCE
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;  // Dosya adından geldi → güvenilir
    if (result.date)    return false;  // Tarih bulundu → SUCCESS
    return true;                        // Hiçbir alan yok
  }

  // ─── Dosya adından belgeNo çıkarma ──────────────────────────────────────────
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    // Uzantıyı kaldır
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    // e-Fatura formatı: [A-Z0-9]{3}[0-9]{4}[0-9]{6,12}
    // Örn: HEF2026000000269, AF02026000918027, 1E32026000000852
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) {
      return base.toUpperCase();
    }
    // Genel alfanumerik belge no (en az 8 karakter)
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) {
      return base.toUpperCase();
    }
    return null;
  }

  // ─── Tarih çıkarma ───────────────────────────────────────────────────────────
  private extractDate(text: string): string | null {
    // DD - MM - YYYY (boşluklu tire — bazı e-Faturalarda kullanılıyor)
    for (const m of text.matchAll(/\b(\d{1,2})\s*[-]\s*(\d{1,2})\s*[-]\s*(\d{4})\b/g)) {
      const [, d, mo, y] = m;
      if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 && +y >= 2000 && +y <= 2100) {
        return `${d.padStart(2,'0')}.${mo.padStart(2,'0')}.${y}`;
      }
    }
    // DD.MM.YYYY / DD/MM/YYYY
    for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g)) {
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

  // ─── Belge No çıkarma (OCR metninden) ───────────────────────────────────────
  private extractBelgeNo(text: string): string | null {
    const patterns = [
      // e-Fatura: "Fatura No: HEF2026000000269" veya "FATURA NO : HEF2026000000269"
      /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
      // Genel etiket
      /(?:fiş|belge|seri|evrak|makbuz|fatura|invoice)\s*(?:no|numarası|#)?[:\s#.]*([A-Z0-9]{8,20})/i,
      // e-Fatura formatı: 3 harf/rakam + 4 rakam yıl + 6-12 rakam sıra (rakamla da başlayabilir)
      /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
      // Genel alfanumerik (fallback)
      /\b([A-Z]{2,4}\d{8,14})\b/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim().toUpperCase();
    }
    return null;
  }

  // ─── KDV tutarı çıkarma — e-Fatura dahil tüm formatlar ─────────────────────
  private extractKdvTotal(text: string): string | null {
    // Çoklu oran için tüm "Hesaplanan KDV(%X): VALUE" satırlarını topla
    const eFaturaMulti = [...text.matchAll(/hesaplanan\s*kdv\s*\(\s*%?\s*\d+(?:[.,]\d+)?\s*\)\s*[:\s]+([\d.,]+)/gi)];
    if (eFaturaMulti.length > 0) {
      const total = eFaturaMulti.reduce((sum, m) => {
        return sum + this.parseAmount(m[1]);
      }, 0);
      if (total > 0) return this.formatAmount(total);
    }

    // e-Fatura tek satır: "Hesaplanan KDV: VALUE" veya "KDV(%20): VALUE"
    const eFaturaSingle = text.match(/(?:hesaplanan\s*)?kdv\s*\(\s*%?\s*\d+(?:[.,]\d+)?\s*\)\s*[:\s]+([\d.,]+)/i);
    if (eFaturaSingle?.[1]) return eFaturaSingle[1].replace(/\s/g,'');

    // Toplam KDV
    const toplamKdv = text.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplamKdv?.[1]) return toplamKdv[1].replace(/\s/g,'');

    // Genel KDV etiketleri
    const patterns = [
      /k\.?d\.?v\.?\s*(?:tutarı?|miktarı?)?\s*[:=]\s*([\d.,]+)/i,
      /katma\s+de[gğ]er\s+vergisi\s*[:=]\s*([\d.,]+)/i,
      /(?:vergi|tax)\s*(?:tutarı?|amount)?\s*[:=]\s*([\d.,]+)/i,
      /k\.?d\.?v\.?\s+%?\s*\d+\s+([\d.,]+)/i,
      /%\s*\d+\s+k\.?d\.?v\.?\s*[:=]?\s*([\d.,]+)/i,
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
    const toplam = this.parseAmount(toplamStr);
    if (!toplam || !oran) return null;
    const kdv = toplam * oran / (100 + oran);
    return this.formatAmount(kdv);
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

  // ─── Yardımcı: Türkçe para formatı parse ────────────────────────────────────
  private parseAmount(str: string): number {
    // "6.000,00" → 6000.00  |  "6,000.00" → 6000.00
    const cleaned = str.replace(/\s/g, '');
    // Türkçe format: nokta = binler ayracı, virgül = ondalık
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    // İngilizce format veya sade sayı
    return parseFloat(cleaned.replace(',', '.'));
  }

  private formatAmount(n: number): string {
    return n.toFixed(2).replace('.', ',');
  }
}
