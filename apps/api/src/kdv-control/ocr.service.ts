import { Injectable, Logger } from '@nestjs/common';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';

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
  private azureClient: ComputerVisionClient | null = null;

  constructor() {
    this.initAzureVision();
  }

  private initAzureVision() {
    const key = process.env.AZURE_VISION_KEY;
    const endpoint = process.env.AZURE_VISION_ENDPOINT;
    
    if (key && endpoint) {
      this.azureClient = new ComputerVisionClient(
        new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } }),
        endpoint
      );
      this.logger.log('✅ Azure Vision API hazır');
    } else {
      this.logger.warn('⚠️ Azure Vision API key/endpoint tanımlı değil');
    }
  }

  /**
   * Azure Vision API ile OCR
   * Tesseract yerine bulut tabanlı OCR
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);

    // Azure Vision varsa kullan
    if (this.azureClient) {
      try {
        return await this.runAzureOcr(imageBuffer, belgeNoFromFilename);
      } catch (e) {
        this.logger.error('Azure Vision hatası:', e?.message);
        // Azure başarısız olursa fallback
      }
    }

    // Fallback: Dosya adından belgeNo
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

  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date) return false;
    return true;
  }

  // === AZURE VISION OCR ===
  private async runAzureOcr(
    buffer: Buffer, 
    belgeNoFromFilename: string | null
  ): Promise<OcrResult> {
    if (!this.azureClient) throw new Error('Azure client yok');

    // Azure Read API - en iyi sonuçlar için
    const result = await this.azureClient.readInStream(buffer);
    const operationId = result.operationLocation?.split('/').pop();
    
    if (!operationId) throw new Error('Azure operation ID alınamadı');

    // Sonucu bekle (polling)
    let readResult = await this.azureClient.getReadResult(operationId);
    let attempts = 0;
    
    while (readResult.status !== 'succeeded' && readResult.status !== 'failed' && attempts < 30) {
      await new Promise(r => setTimeout(r, 500));
      readResult = await this.azureClient.getReadResult(operationId);
      attempts++;
    }

    if (readResult.status !== 'succeeded') {
      throw new Error('Azure OCR başarısız: ' + readResult.status);
    }

    // Tüm metni birleştir
    const lines: string[] = [];
    readResult.analyzeResult?.readResults?.forEach((page: any) => {
      page.lines?.forEach((line: any) => {
        lines.push(line.text);
      });
    });

    const fullText = lines.join('\n');
    
    // Alanları çıkar
    const date = this.extractDate(fullText);
    const belgeNo = belgeNoFromFilename ?? this.extractBelgeNo(fullText);
    const kdv = this.extractKdvTotal(fullText);
    const toplam = this.extractToplam(fullText);

    const foundFields = [belgeNo, date, kdv].filter(Boolean).length;
    const confidence = belgeNoFromFilename 
      ? 0.3 + (foundFields / 3) * 0.7
      : foundFields / 3;

    this.logger.log(
      `Azure OCR [${belgeNoFromFilename || 'unknown'}] Alan:${foundFields}/3 Conf:%${Math.round(confidence * 100)}`
    );

    return {
      rawText: fullText.slice(0, 3000),
      belgeNo,
      date,
      kdvTutari: kdv,
      totalTutari: toplam,
      confidence,
      engine: 'azure-vision',
    };
  }

  // === YARDIMCI FONKSİYONLAR ===
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    return null;
  }

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

  private extractKdvTotal(text: string): string | null {
    // Hesaplanan KDV (çoklu oran)
    const hesaplananMatches = [...text.matchAll(/hesaplanan\s*kdv\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (hesaplananMatches.length > 0) {
      const total = hesaplananMatches.reduce((sum, m) => sum + this.parseAmount(m[1]), 0);
      if (total > 0) return this.formatAmount(total);
    }

    // KDV tutarı
    const kdvMatches = [...text.matchAll(/k\.?d\.?v\.?\s*(?:tutarı?)?\s*[:=]\s*([\d.,]+)/gi)];
    if (kdvMatches.length > 0) {
      const values = kdvMatches.map(m => this.parseAmount(m[1])).filter(v => v > 0);
      if (values.length > 0) return this.formatAmount(Math.max(...values));
    }

    // Toplam KDV
    const toplamKdv = text.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplamKdv?.[1]) return toplamKdv[1].replace(/\s/g, '');

    return null;
  }

  private extractToplam(text: string): string | null {
    const patterns = [
      /genel\s+toplam\s*[:=]\s*([\d.,]+)/i,
      /(?:^|\n)\s*toplam\s*[:=]?\s*([\d.,]+)/im,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1] && /\d/.test(m[1])) return m[1].replace(/\s/g, '');
    }
    return null;
  }

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
