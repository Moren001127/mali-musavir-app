import { Injectable, Logger } from '@nestjs/common';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  kdvTutari: string | null;
  totalTutari: string | null;
  /** Genel güven skoru (geriye dönük uyumluluk) */
  confidence: number;
  /** Alan-bazlı güven skorları (0–1). Null ise alan bulunamadı. */
  fieldConfidence: {
    belgeNo: number | null;
    date: number | null;
    kdvTutari: number | null;
  };
  engine: string;
}

/** Alan-bazlı güven eşiği; altındaki alanlar kullanıcı teyidine gider */
export const FIELD_CONFIDENCE_THRESHOLD = 0.7;

/** Log için confidence'ı kısa yazı — %84 veya "—" */
const fmtConf = (v: number | null | undefined): string =>
  typeof v === 'number' ? `%${Math.round(v * 100)}` : '—';

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
   * Fatura/fiş görselinden yapısal veri çıkarır.
   *
   * Öncelik sırası:
   *   1. Claude Haiku 4.5 Vision — LLM tabanlı, en yüksek doğruluk
   *   2. Azure Vision Read API + regex — fallback
   *   3. Dosya adından belgeNo — son çare
   *
   * PRENSİP: Hiçbir dış sistemden (Mihsap, Luca vs.) gelen ham veriye
   * güvenmeyiz. Doğrulama daima GÖRÜNTÜNÜN KENDİSİNDEN yapılır.
   */
  async extractFromImage(imageBuffer: Buffer, originalName?: string): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);
    const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
    this.logger.log(
      `OCR başladı: ${originalName || '—'} · ${imageBuffer.byteLength}B · Claude:${hasClaudeKey ? '✓' : '✗'} Azure:${this.azureClient ? '✓' : '✗'}`,
    );

    // 1. Tercih: Claude Haiku 4.5 Vision (eğer API key varsa)
    if (hasClaudeKey) {
      try {
        const claudeResult = await this.runClaudeVisionOcr(imageBuffer);
        if (claudeResult.belgeNo || claudeResult.date || claudeResult.kdvTutari) {
          return claudeResult;
        }
        this.logger.warn(
          `Claude boş döndü: ${originalName || '—'} · raw:${claudeResult.rawText?.slice(0, 120)}`,
        );
        // Claude boş döndü → Azure fallback
      } catch (e: any) {
        this.logger.warn(`Claude Vision hatası (${originalName || '—'}): ${e?.message}`);
      }
    }

    // 2. Fallback: Azure Vision Read API
    if (this.azureClient) {
      try {
        return await this.runAzureOcr(imageBuffer, belgeNoFromFilename);
      } catch (e) {
        this.logger.error('Azure Vision hatası:', e?.message);
      }
    }

    // 3. Son çare: dosya adından belgeNo
    return {
      rawText: '',
      belgeNo: belgeNoFromFilename,
      date: null,
      kdvTutari: null,
      totalTutari: null,
      confidence: belgeNoFromFilename ? 0.3 : 0,
      fieldConfidence: {
        belgeNo: belgeNoFromFilename ? 0.3 : null,
        date: null,
        kdvTutari: null,
      },
      engine: 'filename-only',
    };
  }

  // === CLAUDE HAIKU 4.5 VISION OCR ===
  /**
   * Claude Haiku 4.5'i vision mode'da çağırır; Türk fatura/fiş görselinden
   * tarih, belge no, KDV tutarı ve toplam tutarı yapısal JSON olarak alır.
   * Regex'e oranla çok daha doğru çalışır (özellikle KDV tutarı için).
   */
  private async runClaudeVisionOcr(buffer: Buffer): Promise<OcrResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const MODEL = 'claude-haiku-4-5-20251001';

    // Büyük görselleri 2000px'e küçült (Claude limit + hız)
    let b64: string;
    try {
      const sharp = (await import('sharp')).default;
      const resized = await sharp(buffer)
        .rotate() // EXIF
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      b64 = resized.toString('base64');
    } catch {
      // sharp yoksa ham buffer'ı kullan
      b64 = buffer.toString('base64');
    }

    const systemPrompt =
      'Sen Türk fatura ve fişlerinden yapısal veri çıkaran bir OCR uzmanısın. ' +
      'Görseli dikkatle incele ve şu alanları JSON olarak döndür: ' +
      '{"tarih":"YYYY-MM-DD" veya null, "belgeNo":"...", "kdvTutari":"123,45", "toplam":"345,67", "satici":"...", "kdvOrani": 20, ' +
      '"confidence":{"tarih":0.95,"belgeNo":0.88,"kdvTutari":0.72}}. ' +
      'Tarih: fatura tarihi / belge tarihi / fiş tarihi. Net okunamıyorsa null. ' +
      'Belge no: fatura numarası, fiş numarası, seri-sıra no kombinasyonu. ' +
      'KDV tutarı: "KDV", "K.D.V.", "Hesaplanan KDV", "KDV Tutarı" satırındaki TUTAR. Birden fazla KDV oranı varsa TOPLAM KDV tutarı. ' +
      'Toplam: genel toplam / ödenecek tutar / fatura toplamı. ' +
      'Tutarları Türk formatında ver: "1.234,56" → "1234,56" (noktasız, virgüllü). ' +
      'ZORUNLU: confidence objesinde her alan için 0.0–1.0 arası gerçekçi güven skoru ver. ' +
      'Netlik kriterleri: 0.95+ = karakterler tam net, tek bir yorum var; 0.80–0.94 = okunaklı ama küçük belirsizlik; ' +
      '0.60–0.79 = okunabiliyor ama şüphe var (bulanık, kısmen kapalı, el yazısı); ' +
      '<0.60 = tahmine dayalı; alan yoksa veya hiç okunmuyorsa 0. ' +
      'KDV tutarı için: birden fazla kalem topladıysan ve hepsi netse yüksek; bir kalem bile şüpheliyse düşür. ' +
      'Sadece geçerli JSON dön, açıklama yok.';

    const userText =
      'Bu fatura/fişin tarih, belge no, KDV tutarı, toplam ve satıcı bilgilerini JSON olarak çıkar. ' +
      'Her alan için gerçekçi confidence skoru ver — okunamayan/şüpheli alanlara düşük skor. ' +
      'KDV tutarı KRİTİK — birden fazla kalem varsa hepsini topla. ' +
      'Örnek: görselde "KDV %20: 456,00" yazıyorsa "kdvTutari":"456,00", net okunuyorsa confidence 0.95.';

    const startMs = Date.now();
    // 429 retry — Anthropic rate limit'e takıldığımızda exponential backoff ile tekrar dene.
    // retry-after header'ı varsa ona saygı göster; yoksa 15s, 30s, 60s bekle.
    const MAX_RETRIES = 4;
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (res.status !== 429 && res.status !== 529) break;
      if (attempt === MAX_RETRIES) break;
      const retryAfter = Number(res.headers.get('retry-after')) || [15, 30, 60, 120][attempt] || 30;
      this.logger.warn(
        `Claude rate-limit (${res.status}), ${retryAfter}s bekleniyor… (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
    }

    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new Error(`Claude API ${res?.status}: ${body.slice(0, 120)}`);
    }

    const payload: any = await res.json();
    const textBlock = payload?.content?.find((c: any) => c?.type === 'text');
    const raw = textBlock?.text?.trim() || '';

    // JSON block'unu çıkar (Claude bazen markdown içine sararken)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn(`Claude beklenen JSON döndürmedi: ${raw.slice(0, 100)}`);
      return {
        rawText: raw.slice(0, 2000),
        belgeNo: null,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: 0,
        fieldConfidence: { belgeNo: null, date: null, kdvTutari: null },
        engine: 'claude-haiku-4-5',
      };
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      /* JSON parse başarısız — boş dön */
    }

    // Tarihi TR formatına çevir: YYYY-MM-DD → DD.MM.YYYY
    const date = this.formatIsoToTr(parsed.tarih) ?? null;

    const belgeNo = parsed.belgeNo ? String(parsed.belgeNo).toUpperCase().trim() : null;
    const kdvTutari = parsed.kdvTutari ? String(parsed.kdvTutari).replace(/\s/g, '') : null;
    const toplam = parsed.toplam ? String(parsed.toplam).replace(/\s/g, '') : null;

    // Claude'un verdiği alan-bazlı confidence'ı parse et
    const cf = parsed.confidence || {};
    const fieldConfidence = {
      belgeNo: belgeNo ? this.clampConfidence(cf.belgeNo) : null,
      date: date ? this.clampConfidence(cf.tarih) : null,
      kdvTutari: kdvTutari ? this.clampConfidence(cf.kdvTutari) : null,
    };

    // Genel confidence: alan-bazlı ortalama (bulunan alanların), yoksa klasik hesap
    const fieldScores = [fieldConfidence.belgeNo, fieldConfidence.date, fieldConfidence.kdvTutari]
      .filter((v): v is number => typeof v === 'number');
    const foundFields = fieldScores.length;
    const confidence = foundFields > 0
      ? fieldScores.reduce((a, b) => a + b, 0) / foundFields
      : 0;

    this.logger.log(
      `Claude OCR ✓ Alan:${foundFields}/3 · Conf:%${Math.round(confidence * 100)} ` +
        `(belgeNo:${fmtConf(fieldConfidence.belgeNo)} · tarih:${fmtConf(fieldConfidence.date)} · kdv:${fmtConf(fieldConfidence.kdvTutari)}) ` +
        `${Date.now() - startMs}ms`,
    );

    return {
      rawText: JSON.stringify(parsed).slice(0, 2000),
      belgeNo,
      date,
      kdvTutari,
      totalTutari: toplam,
      confidence,
      fieldConfidence,
      engine: 'claude-haiku-4-5',
    };
  }

  /** Claude'dan gelen confidence değerini 0–1 aralığına sıkıştır (geçersizse 0.5) */
  private clampConfidence(v: any): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return 0.5; // Claude vermemişse nötr baseline
    if (n < 0) return 0;
    if (n > 1) return n > 1 && n <= 100 ? n / 100 : 1; // bazen yüzde verirse düzelt
    return n;
  }

  /** "2026-03-08" → "08.03.2026" */
  private formatIsoToTr(iso?: string | null): string | null {
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  /**
   * Geriye dönük uyumluluk — hiçbir alan okunmadıysa "low" kabul edilir.
   * Bu fonksiyon sadece "hiç okuyamadık" durumunu yakalar.
   * Review gerekip gerekmediği için `needsReview` kullan.
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date) return false;
    return true;
  }

  /**
   * Kullanıcı teyidi gerekip gerekmediğini belirler:
   *  - Hiç alan okunmadıysa  → true (LOW_CONFIDENCE)
   *  - Herhangi bir alan FIELD_CONFIDENCE_THRESHOLD altındaysa → true (NEEDS_REVIEW)
   *  - Aksi halde → false (SUCCESS)
   */
  needsReview(result: OcrResult): { needs: boolean; reason: 'none' | 'empty' | 'low_field' } {
    if (this.isLowConfidence(result)) return { needs: true, reason: 'empty' };
    const { belgeNo, date, kdvTutari } = result.fieldConfidence;
    const scores = [belgeNo, date, kdvTutari].filter((v): v is number => typeof v === 'number');
    if (scores.some((s) => s < FIELD_CONFIDENCE_THRESHOLD)) {
      return { needs: true, reason: 'low_field' };
    }
    return { needs: false, reason: 'none' };
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

    // Azure baseline: regex eşleşmeleri için orta güven (0.6)
    // Filename fallback belgeNo için daha düşük (0.4)
    const azureBaseline = 0.6;
    const fieldConfidence = {
      belgeNo: belgeNo ? (belgeNoFromFilename && belgeNo === belgeNoFromFilename ? 0.4 : azureBaseline) : null,
      date: date ? azureBaseline : null,
      kdvTutari: kdv ? azureBaseline : null,
    };

    return {
      rawText: fullText.slice(0, 3000),
      belgeNo,
      date,
      kdvTutari: kdv,
      totalTutari: toplam,
      confidence,
      fieldConfidence,
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
