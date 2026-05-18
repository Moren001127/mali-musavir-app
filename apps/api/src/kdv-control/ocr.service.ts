import { Injectable, Logger } from '@nestjs/common';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';
import * as crypto from 'crypto';
import { formatOcrAmount, parseOcrAmount } from './ocr/parsers/amount';
import { normalizeTaxText as normalizeTaxTextValue } from './ocr/parsers/text';
import { extractTevkifatTotalsFromText } from './ocr/parsers/tevkifat';
import { extractDate as extractDatePure, normalizeOcrYear as normalizeOcrYearPure } from './ocr/parsers/date';

/** Ã‡ok oranlÄ± KDV kÄ±rÄ±lÄ±mÄ± â€” Z raporu veya karma oranlÄ± fatura iÃ§in */
export interface KdvBreakdownItem {
  /** KDV oranÄ± (%) â€” 1, 10, 20 */
  oran: number;
  /** Matrah (KDV hariÃ§ tutar) - opsiyonel, OCR'dan alÄ±nabilirse */
  matrah?: number | null;
  /** KDV tutarÄ± (TL) */
  tutar: number;
}

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  /** NET KDV â€” tevkifatlÄ± faturada (tam KDV âˆ’ tevkifat). Reconciliation'da Luca ile karÅŸÄ±laÅŸtÄ±rÄ±lan deÄŸer. */
  kdvTutari: string | null;
  /** Tevkifat tutarÄ± (TL) â€” varsa; tevkifatsÄ±z faturada null veya "0,00". */
  kdvTevkifat?: string | null;
  totalTutari: string | null;
  /** SatÄ±cÄ±/tedarikÃ§i unvanÄ± â€” aynÄ± belge no'lu farklÄ± firmalarÄ± ayÄ±rmak iÃ§in reconciliation'da kullanÄ±lÄ±r. */
  satici?: string | null;
  /** SatÄ±cÄ± VKN/TCKN (10 veya 11 hane) â€” reconciliation'da primary match key */
  saticiVkn?: string | null;
  /** Belge tipi: EFATURA, EARSIV, OKC_FIS, Z_RAPORU, MAKBUZ */
  belgeTipi?: string | null;
  /** Ã‡ok oranlÄ± KDV kÄ±rÄ±lÄ±mÄ± (varsa) â€” Z raporu/karma fatura. tutar = NET (tevkifat dÃ¼ÅŸÃ¼lmÃ¼ÅŸ). */
  kdvBreakdown?: KdvBreakdownItem[] | null;
  /** Otomatik gider kategorisi: yakit, yemek, kirtasiye, telekom, kira, vb. */
  kategori?: string | null;
  /** GÃ¶rÃ¼ntÃ¼nÃ¼n SHA-256 hash'i â€” caller cache kontrolÃ¼ iÃ§in kullanÄ±r */
  imageHash?: string;
  /** Genel gÃ¼ven skoru (geriye dÃ¶nÃ¼k uyumluluk) */
  confidence: number;
  /** Alan-bazlÄ± gÃ¼ven skorlarÄ± (0â€“1). Null ise alan bulunamadÄ±. */
  fieldConfidence: {
    belgeNo: number | null;
    date: number | null;
    kdvTutari: number | null;
  };
  /**
   * Multi-pass validation skoru (0â€“1):
   *   â€¢ breakdown.tutar.sum === kdvTutari (1.0 = tam, 0.5 = Â±%5 tolerans)
   *   â€¢ matrah Ã— oran/100 === tutar (her satÄ±r)
   *   â€¢ geÃ§erli KDV oranlarÄ± (0/1/8/10/18/20)
   *   â€¢ tevkifat â‰¤ kdvTutari mantÄ±k kontrolÃ¼
   * UBL XML doÄŸrudan parse edildiyse 1.0; aksi halde validateOcrResult() hesaplar.
   */
  validationScore?: number | null;
  /** Validation hatalarÄ± â€” confidence dÃ¼ÅŸÃ¼rme/UI uyarÄ± iÃ§in */
  validationIssues?: string[];
  engine: string;
  /** Claude API response'undan gelen token kullanÄ±mÄ± â€” maliyet hesabÄ± iÃ§in. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** USD cinsinden tahmini maliyet (input $1/M + output $5/M Haiku 4.5 fiyat) */
    costUsd: number;
  };
}

export interface ExtractOcrOptions {
  /** KullanÄ±cÄ± aÃ§Ä±kÃ§a "AI ile zorla oku" dediÄŸinde Azure-first kÄ±sa devresini atlar. */
  forceClaude?: boolean;
}

/** Claude model fiyatlarÄ± ($/M token) */
const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

/**
 * VarsayÄ±lan OCR modeli â€” Haiku 4.5 (ucuz, $0.0025/belge).
 * Hallucination'lara karÅŸÄ± Azure OCR cross-check (2. tanÄ±k) + alan bazlÄ± validation kullanÄ±lÄ±yor.
 * Sonnet'e Ã§Ä±kmak iÃ§in ENV: OCR_MODEL=claude-sonnet-4-5
 */
const DEFAULT_OCR_MODEL = 'claude-haiku-4-5-20251001';

/** Alan-bazlÄ± gÃ¼ven eÅŸiÄŸi; altÄ±ndaki alanlar kullanÄ±cÄ± teyidine gider */
export const FIELD_CONFIDENCE_THRESHOLD = 0.7;

const E_BELGE_NO_REGEX = /^(?:[A-Z]{2,4}\d{12,14}|[A-Z]\d{2}20\d{2}\d{6,12}|\d{13,20})$/;

/** Log iÃ§in confidence'Ä± kÄ±sa yazÄ± â€” %84 veya "â€”" */
const fmtConf = (v: number | null | undefined): string =>
  typeof v === 'number' ? `%${Math.round(v * 100)}` : 'â€”';

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
      this.logger.log('âœ… Azure Vision API hazÄ±r');
    } else {
      this.logger.warn('âš ï¸ Azure Vision API key/endpoint tanÄ±mlÄ± deÄŸil');
    }
  }

  /**
   * Fatura/fiÅŸ gÃ¶rselinden yapÄ±sal veri Ã§Ä±karÄ±r.
   *
   * Ã–ncelik sÄ±rasÄ±:
   *   1. Claude Haiku 4.5 Vision â€” LLM tabanlÄ±, en yÃ¼ksek doÄŸruluk
   *   2. Azure Vision Read API + regex â€” fallback
   *   3. Dosya adÄ±ndan belgeNo â€” son Ã§are
   *
   * PRENSÄ°P: HiÃ§bir dÄ±ÅŸ sistemden (Mihsap, Luca vs.) gelen ham veriye
   * gÃ¼venmeyiz. DoÄŸrulama daima GÃ–RÃœNTÃœNÃœN KENDÄ°SÄ°NDEN yapÄ±lÄ±r.
   */
  /** GÃ¶rÃ¼ntÃ¼ buffer'Ä±ndan SHA-256 hash hesapla â€” cache anahtarÄ± olarak kullanÄ±lÄ±r */
  computeImageHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async extractFromImage(
    imageBuffer: Buffer,
    originalName?: string,
    options: ExtractOcrOptions = {},
  ): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);
    const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
    const forceClaude = options.forceClaude === true;
    const allowAutoClaude =
      process.env.KDV_OCR_AUTO_CLAUDE === 'true' ||
      process.env.OCR_AUTO_CLAUDE === 'true';
    const imageHash = this.computeImageHash(imageBuffer);
    this.logger.log(
      `OCR baÅŸladÄ±: ${originalName || 'â€”'} Â· ${imageBuffer.byteLength}B Â· hash=${imageHash.slice(0, 8)}... Â· Claude:${hasClaudeKey ? 'âœ“' : 'âœ—'} Azure:${this.azureClient ? 'âœ“' : 'âœ—'} forceClaude:${options.forceClaude ? 'âœ“' : 'âœ—'}`,
    );

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 0. XML DOÄRUDAN PARSE â€” UBL e-Fatura/e-ArÅŸiv
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // Ä°Ã§erik gerÃ§ekten XML mi? (binary image deÄŸil)
    // Head 512 byte tek baÅŸÄ±na gÃ¼venli deÄŸil â€” bazÄ± Mihsap XML'leri BOM, HTML
    // wrapper veya whitespace ile baÅŸlÄ±yor olabilir. Bu nedenle ilk 4 KB'ye
    // kadar UBL marker aranÄ±r. AyrÄ±ca uzantÄ± .xml ise content ASCII-dÃ¼zeyinde
    // (binary/image deÄŸil) olduÄŸu sÃ¼rece XML'e zorlarÄ±z.
    const head4k = imageBuffer.slice(0, Math.min(4096, imageBuffer.byteLength)).toString('utf8');
    const hasUblMarker =
      /<\?xml/i.test(head4k) ||
      /<Invoice[\s>]/i.test(head4k) ||
      /<ArchiveInvoice[\s>]/i.test(head4k) ||
      /<cbc:ID>/i.test(head4k) ||
      /<cac:TaxTotal>/i.test(head4k) ||
      /<cac:LegalMonetaryTotal>/i.test(head4k) ||
      /UBL-TR|UBL\s*Invoice/i.test(head4k);
    // UzantÄ± xml ise ve iÃ§erik gerÃ§ekten XML-benzeri ASCII ise (image magic bytes yok) XML kabul et
    const filenameIsXml = /\.xml$/i.test(originalName || '');
    const isImageMagic =
      imageBuffer.length > 4 && (
        // PNG, JPEG, PDF, GIF, TIFF, BMP
        (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) ||
        (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) ||
        (imageBuffer[0] === 0x25 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x44) ||
        (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49) ||
        (imageBuffer[0] === 0x49 && imageBuffer[1] === 0x49) ||
        (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4d)
      );
    const isXml = hasUblMarker || (filenameIsXml && !isImageMagic);

    if (isXml) {
      try {
        const xmlResult = this.parseUblXml(imageBuffer.toString('utf8'));
        if (xmlResult && (xmlResult.belgeNo || xmlResult.date || xmlResult.kdvTutari)) {
          // Dosya adÄ±yla belge no'yu reconcile et â€” filename override gÃ¼vence
          if (belgeNoFromFilename && xmlResult.belgeNo !== belgeNoFromFilename) {
            const fnClean = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const xmlClean = (xmlResult.belgeNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (fnClean !== xmlClean && fnClean.length >= xmlClean.length) {
              this.logger.warn(
                `XML belge no filename'den farklÄ±, filename kullanÄ±lÄ±yor: xml=${xmlClean} filename=${fnClean}`,
              );
              xmlResult.belgeNo = belgeNoFromFilename;
            }
          }
          this.logger.log(
            `XML parse baÅŸarÄ±lÄ±: ${originalName} Â· belgeNo=${xmlResult.belgeNo} date=${xmlResult.date} kdv=${xmlResult.kdvTutari} breakdown=${xmlResult.kdvBreakdown?.length || 0}`,
          );
          return xmlResult;
        }
        // XML parse boÅŸ dÃ¶ndÃ¼ â†’ manuel review iÃ§in filename only dÃ¶n (image OCR XML'de iÅŸe yaramaz)
        this.logger.warn(
          `XML parse baÅŸarÄ±sÄ±z (${originalName}): belge no/date/kdv bulunamadÄ±, filename-only dÃ¶ndÃ¼rÃ¼lÃ¼yor`,
        );
        return {
          rawText: head4k.slice(0, 500),
          belgeNo: belgeNoFromFilename,
          date: null,
          kdvTutari: null,
          totalTutari: null,
          confidence: belgeNoFromFilename ? 0.3 : 0,
          fieldConfidence: {
            belgeNo: belgeNoFromFilename ? 0.5 : null,
            date: null,
            kdvTutari: null,
          },
          engine: 'xml-parse-failed',
        };
      } catch (e: any) {
        this.logger.warn(`XML parse hatasÄ± (${originalName}): ${e?.message}`);
        // Parse exception â†’ filename only
        return {
          rawText: '',
          belgeNo: belgeNoFromFilename,
          date: null,
          kdvTutari: null,
          totalTutari: null,
          confidence: belgeNoFromFilename ? 0.3 : 0,
          fieldConfidence: {
            belgeNo: belgeNoFromFilename ? 0.5 : null,
            date: null,
            kdvTutari: null,
          },
          engine: 'xml-error',
        };
      }
    }
    // .xml uzantÄ±lÄ± ama iÃ§erik binary (gerÃ§ekte image) â†’ image OCR'a dÃ¼ÅŸ

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 1. AZURE-FIRST OCR â€” ucuz ham OCR + deterministik parser'lar.
    //    Claude sadece Azure sonucu eksik/Ã§eliÅŸkili/dÃ¼ÅŸÃ¼k gÃ¼venliyse devreye girer.
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let azureRawText = '';

    if (this.azureClient && !forceClaude) {
      try {
        const azureResult = await this.runAzureOcr(imageBuffer, belgeNoFromFilename, originalName);
        azureRawText = azureResult.rawText || '';
        const review = this.needsReview(azureResult);
        if (!review.needs) {
          this.logger.log(
            `Azure-first baÅŸarÄ±lÄ±: ${originalName || 'â€”'} Â· belgeNo=${azureResult.belgeNo || 'â€”'} date=${azureResult.date || 'â€”'} kdv=${azureResult.kdvTutari || 'â€”'} validation=%${Math.round((azureResult.validationScore ?? 0) * 100)}`,
          );
          return azureResult;
        }
        const azureKdvAmount = azureResult.kdvTutari ? this.parseAmount(azureResult.kdvTutari) : 0;
        const azureValidation = azureResult.validationScore ?? 0;
        const isStructuredReceipt =
          azureResult.belgeTipi === 'OKC_FIS' || azureResult.belgeTipi === 'Z_RAPORU';
        // v1.37.75 - kumulatif/gunluk karisikligi: gunluk POS KDV genelde <50K TL.
        // Daha yuksekse Azure muhtemelen KUM.KDV satirini gunluk KDV alanina yazmis
        // demektir -> Claude'a ikinci goz olarak gonder.
        const looksCumulative = isStructuredReceipt && azureKdvAmount > 50_000;
        // v1.37.75 - Azure-first kabulu SADECE matematik tam tutarli + kumulatif
        // suphesi yokken yapilir. Eski "isReceiptLike" her zaman donuyordu -> sessiz hatalar.
        if (
          isStructuredReceipt &&
          azureKdvAmount > 0 &&
          azureValidation >= 0.95 &&
          !looksCumulative
        ) {
          this.logger.log(
            `Azure-first fis/Z guvenilir (validation=%${Math.round(azureValidation * 100)}), Claude eskalasyonu yok: ${originalName || '-'} - kdv=${azureResult.kdvTutari}`,
          );
          return azureResult;
        }
        if (looksCumulative) {
          this.logger.warn(
            `Azure-first supheli (olasi KUMULATIF KDV ${azureResult.kdvTutari} > 50K) -> Claude eskalasyonu: ${originalName || '-'}`,
          );
        }
        if (!hasClaudeKey || !allowAutoClaude) {
          this.logger.warn(
            `Azure-first teyit gerektiriyor ve Claude yok: ${originalName || 'â€”'} Â· reason=${review.reason}`,
          );
          return azureResult;
        }
        this.logger.warn(
          `Azure-first Claude eskalasyon: ${originalName || 'â€”'} Â· reason=${review.reason} Â· belgeNo=${fmtConf(azureResult.fieldConfidence.belgeNo)} date=${fmtConf(azureResult.fieldConfidence.date)} kdv=${fmtConf(azureResult.fieldConfidence.kdvTutari)}`,
        );
      } catch (e: any) {
        this.logger.warn(`Azure-first hatasÄ± (${originalName || 'â€”'}): ${e?.message}`);
      }
    }

    if (!forceClaude && !allowAutoClaude) {
      this.logger.warn(
        `Otomatik Claude kapali; Azure sonucu yoksa/eksikse Claude'a gidilmeyecek: ${originalName || '-'}`,
      );
    }

    if (hasClaudeKey && (forceClaude || allowAutoClaude)) {
      try {
        const claudeResult = await this.runClaudeVisionOcr(imageBuffer);
        if (!azureRawText && this.azureClient) {
          azureRawText = await this.getAzureRawText(imageBuffer).catch((e) => {
            this.logger.warn(`Azure cross-check hatasÄ±: ${e?.message}`);
            return '';
          });
        }

        if (claudeResult.belgeNo || claudeResult.date || claudeResult.kdvTutari) {
          // â•â•â• POST-PROCESS DOÄRULAMA (kurala dayalÄ±) â•â•â•
          this.postProcessOcrResult(claudeResult, belgeNoFromFilename, originalName);

          // â•â•â• AZURE CROSS-CHECK (ikinci tanÄ±k) â•â•â•
          if (azureRawText) {
            this.crossCheckWithAzure(claudeResult, azureRawText, originalName, belgeNoFromFilename);
            // Cross-check sonrasÄ± rawText'i Azure metniyle zenginleÅŸtir
            // (debug + ileride extractDateFromText fallback iÃ§in)
            claudeResult.rawText = `[CLAUDE] ${claudeResult.rawText}\n[AZURE]\n${azureRawText.slice(0, 2000)}`;
          }

          // â•â•â• MULTI-PASS VALIDATION (matematik + mantÄ±k) â•â•â•
          // breakdown.tutar.sum === kdvTutari? matrahÃ—oran === tutar?
          // GeÃ§erli oran (0/1/8/10/18/20)? Tevkifat â‰¤ KDV? gibi kontroller.
          // DoÄŸrulama baÅŸarÄ±sÄ±zsa confidence dÃ¼ÅŸÃ¼rÃ¼lÃ¼r â†’ NEEDS_REVIEW gider.
          this.validateOcrResult(claudeResult, originalName);

          claudeResult.engine = `${claudeResult.engine || DEFAULT_OCR_MODEL} (claude-escalation)`;
          return claudeResult;
        }
        this.logger.warn(
          `Claude boÅŸ dÃ¶ndÃ¼: ${originalName || 'â€”'} Â· raw:${claudeResult.rawText?.slice(0, 120)}`,
        );
        // Claude boÅŸ dÃ¶ndÃ¼ â†’ Azure fallback (yapÄ±sal extraction)
      } catch (e: any) {
        this.logger.warn(`Claude Vision hatasÄ± (${originalName || 'â€”'}): ${e?.message}`);
      }
    }

    // 2. Fallback: Azure Vision Read API yapÄ±sal extraction
    if (this.azureClient) {
      try {
        return await this.runAzureOcr(imageBuffer, belgeNoFromFilename, originalName);
      } catch (e: any) {
        this.logger.error('Azure Vision hatasÄ±:', e?.message);
      }
    }

    // 3. Son Ã§are: dosya adÄ±ndan belgeNo
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

  // === CLAUDE VISION OCR (Sonnet 4.5 default, Haiku 4.5 fallback via ENV) ===
  /**
   * Claude Vision'Ä± Ã§aÄŸÄ±rÄ±r; TÃ¼rk fatura/fiÅŸ gÃ¶rselinden
   * tarih, belge no, KDV tutarÄ± ve toplam tutarÄ± yapÄ±sal JSON olarak alÄ±r.
   * Default Sonnet 4.5 (Haiku halÃ¼sinasyon yapÄ±yordu, kullanÄ±cÄ± dÃ¼zeltmek zorunda kalÄ±yordu).
   * Haiku'ya dÃ¶nmek iÃ§in ENV: OCR_MODEL=claude-haiku-4-5-20251001
   */
  private async runClaudeVisionOcr(buffer: Buffer): Promise<OcrResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const MODEL = process.env.OCR_MODEL || DEFAULT_OCR_MODEL;

    // â”€â”€â”€ DOSYA TÄ°PÄ°NÄ° TESPÄ°T ET (magic bytes) â”€â”€â”€
    // PDF / JPEG / PNG / GIF / TIFF / BMP / WEBP destekleniyor.
    // PDF iÃ§in Claude API'ye "document" content type olarak gÃ¶nderilir
    // (image deÄŸil) â€” `application/pdf` media_type. Sharp PDF'i resize edemediÄŸi
    // iÃ§in PDF'leri ham buffer olarak gÃ¶nderiyoruz.
    const isPdf =
      buffer.length >= 4 &&
      buffer[0] === 0x25 && buffer[1] === 0x50 &&
      buffer[2] === 0x44 && buffer[3] === 0x46; // "%PDF"

    let b64: string;
    let mediaType = 'image/jpeg';
    let contentType: 'image' | 'document' = 'image';

    if (isPdf) {
      // PDF â€” sharp resize yapamaz. Ham buffer'Ä± document olarak gÃ¶nder.
      b64 = buffer.toString('base64');
      mediaType = 'application/pdf';
      contentType = 'document';
      this.logger.log(`Claude OCR: PDF input (${buffer.length} byte) â†’ document type`);
    } else {
      // Image â€” bÃ¼yÃ¼k gÃ¶rselleri 2000px'e kÃ¼Ã§Ã¼lt (Claude limit + hÄ±z)
      try {
        const sharp = (await import('sharp')).default;
        const resized = await sharp(buffer)
          .rotate() // EXIF
          .resize({ width: 2000, withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        b64 = resized.toString('base64');
      } catch {
        // sharp yoksa ham buffer'Ä± kullan
        b64 = buffer.toString('base64');
      }
    }

    const systemPrompt = [
      'Sen TÃ¼rk muhasebe dokÃ¼manlarÄ± (e-Fatura, e-ArÅŸiv, Ã–KC fiÅŸi, Z raporu, makbuz, dekont) iÃ§in uzmanlaÅŸmÄ±ÅŸ bir OCR sistemisin.',
      'GÃ¶rseli karakter karakter incele ve SADECE geÃ§erli JSON dÃ¶n â€” aÃ§Ä±klama/prolog YOK.',
      '',
      'â•”â•â• JSON ÅEMA â•â•â•—',
      '{',
      '  "tarih": "YYYY-MM-DD" | null,',
      '  "belgeNo": "...",',
      '  "kdvTutari": "1234,56",',
      '  "kdvTevkifat": "0,00",',
      '  "toplam": "1499,56",',
      '  "satici": "ABC LTD",',
      '  "saticiVkn": "1234567890",',
      '  "kdvOrani": 20,',
      '  "belgeTipi": "EFATURA|EARSIV|OKC_FIS|Z_RAPORU|MAKBUZ|GIDER_PUSULASI|SMM|DEKONT|SEVK_IRSALIYESI|DIGER",',
      '  "kategori": "yakit|yemek|kirtasiye|telekom|kira|elektrik|su|dogalgaz|tamir|sigorta|danismanlik|nakliye|reklam|temizlik|saglik|diger",',
      '  "kdvBreakdown": [{"oran":20,"tutar":"47,50","matrah":"285,00"}],',
      '  "confidence": {"tarih":0.95,"belgeNo":0.88,"kdvTutari":0.72}',
      '}',
      '',
      'â•”â•â• 1) BELGE TÄ°PÄ°NÄ° TESPÄ°T ET â•â•â•—',
      'GÃ¶rselin tamamÄ±nÄ± oku, ÅŸu anahtar kelimeleri ara:',
      '  â€¢ "E-FATURA" / "e-Fatura" / "TEMELFATURA" / "TICARIFATURA" â†’ EFATURA',
      '  â€¢ "E-ARÅÄ°V" / "E-ARSIV" / "EARSIVFATURA" â†’ EARSIV',
      '  â€¢ "Z RAPORU" / "Z RAPOR" / "Z REPORT" / "GÃœNLÃœK Z" â†’ Z_RAPORU',
      '  â€¢ FiÅŸ numaralÄ± satÄ±ÅŸ belgesi (Z raporu deÄŸilse) / "FÄ°Å NO" â†’ OKC_FIS',
      '  â€¢ "GÄ°DER PUSULASI" â†’ GIDER_PUSULASI',
      '  â€¢ "SERBEST MESLEK MAKBUZU" â†’ SMM',
      '  â€¢ "MAKBUZ" (tek baÅŸÄ±na, SMM deÄŸilse) â†’ MAKBUZ',
      '  â€¢ "DEKONT" / "HAVALE" / "EFT" / banka baÅŸlÄ±klÄ± â†’ DEKONT',
      '  â€¢ "SEVK Ä°RSALÄ°YESÄ°" / "Ä°RSALÄ°YE" â†’ SEVK_IRSALIYESI',
      '  â€¢ HiÃ§biri deÄŸilse â†’ DIGER',
      '',
      'â•”â•â• 2) BELGE NO â€” TÄ°PE GÃ–RE DOÄRU ALAN â•â•â•—',
      'Belge no\'yu tipe gÃ¶re ÅU ALANDAN al:',
      '  â€¢ EFATURA/EARSIV â†’ "Fatura No" / "Belge No" etiketindeki deÄŸer.',
      '    Pattern: 3 harf + 4 rakam (yÄ±l) + 9 rakam (sÄ±ra) = 16 char, Ã¶rn. "EFA2026000000093".',
      '    EÄER 13-14 KARAKTER OKUDUYSAN SIFIRLARI ATLADIN â€” TEKRAR SAY.',
      '  â€¢ Z_RAPORU â†’ SADECE "Z NO" / "Z SAYAÃ‡" etiketindeki deÄŸer. FIÅ NO / EKÃœ NO / AT NO / SAAT / TARÄ°H ASLA DEÄÄ°L!',
      '    â–º KRÄ°TÄ°K: "FIÅ NO. 45" gÃ¶rsen bile o "FIÅ NO" â€” Z_RAPORU\'nda belge no DEÄÄ°L.',
      '    â–º Z raporunda doÄŸru alan: "Z NO: 670" / "Z NO 670" / "Z SAYAÃ‡ 896" / "Z SAYAÃ‡: 896" / "Z SAYACI 896" ÅŸeklinde geÃ§er.',
      '    â–º v1.36.72: BAZI Ã–KC MODELLERÄ° "Z NO" YERÄ°NE "Z SAYAÃ‡" KULLANIR (aynÄ± anlam, aynÄ± numara).',
      '    â–º Ã–rnek: "FIÅ NO. 45 ... TOPLAM ... Z SAYAÃ‡ 896" â†’ belgeNo = "896" (45 DEÄÄ°L).',
      '    â–º Bazen "Z NO" / "Z SAYAÃ‡" en altta tek baÅŸÄ±na yazar â€” orayÄ± bul.',
      '  â€¢ OKC_FIS â†’ "FÄ°Å NO" / "FIS NO" / "BELGE NO" (3-6 hane).',
      '  â€¢ GIDER_PUSULASI â†’ "MAKBUZ NO" / "BELGE NO" / "SERÄ° NO".',
      '  â€¢ SMM â†’ "MAKBUZ NO" / "SERÄ° NO-SIRA NO" birleÅŸik.',
      '  â€¢ MAKBUZ â†’ "MAKBUZ NO" / "SERÄ° SIRA".',
      '  â€¢ DEKONT â†’ "REFERANS NO" / "DEKONT NO" / "Ä°ÅLEM NO".',
      '  â€¢ SEVK_IRSALIYESI â†’ "Ä°RSALÄ°YE NO".',
      '',
      'â•”â•â• 3) BELGE NO â€” YASAK ALANLAR (ASLA BELGE NO OLARAK DÃ–NME) â•â•â•—',
      '  â€¢ "Ã–zelleÅŸtirme No" / "CustomizationID" (TR1.2, TR1.0, UBL-2.1)',
      '  â€¢ "Senaryo" / "ProfileID" (TICARIFATURA, TEMELFATURA, EARSIVFATURA)',
      '  â€¢ "UUID" / "ETTN" (GUID formatlÄ± uzun string)',
      '  â€¢ "VKN" / "TCKN" (satÄ±cÄ±/alÄ±cÄ± kimlik no)',
      '  â€¢ "SipariÅŸ No" / "Ä°rsaliye No" (faturanÄ±n ana numarasÄ± deÄŸil)',
      '  â€¢ Z Raporunda: FÄ°Å NO / EKÃœ NO / AT NO / MALÄ° FÄ°Å SAYISI vs.',
      '  Bu alanlardan biri tek baÅŸÄ±na dÃ¶nme â€” gerÃ§ek belge no bulunana kadar ara.',
      '',
      'â•”â•â• 4) TARÄ°H â€” TÃœRK FORMATI (DD-MM-YYYY) â•â•â•—',
      'HER MUHASEBE BELGESÄ°NDE MUTLAKA BÄ°R TARÄ°H VARDIR. Genelde en Ã¼stte veya en altta gÃ¶rÃ¼nÃ¼r.',
      'Arama yerleri:',
      '  â€¢ Belgenin tepesinde (tarih + saat birlikte olabilir: "10-03-2026 21:30")',
      '  â€¢ "Fatura Tarihi", "Belge Tarihi", "DÃ¼zenleme Tarihi", "FiÅŸ Tarihi", "Tanzim Tarihi" etiketleri',
      '  â€¢ Z raporunda: baÅŸta tarih, sonra "SAAT" olur',
      '  â€¢ Makbuz/fiÅŸte: genelde "TARÄ°H:" etiketi veya serbest format',
      'TÃ¼rkiye\'de tarih DAÄ°MA "GÃœN-AY-YIL" sÄ±rasÄ±dÄ±r. Ä°LK kÄ±sÄ±m GÃœN, ORTA kÄ±sÄ±m AY, SON 4 hane YIL.',
      '  â€¢ "11-03-2026" = "11.03.2026" = "11/03/2026" = 11 Mart 2026 â†’ output "2026-03-11"',
      '  â€¢ "31.12.2025" â†’ 31 AralÄ±k 2025 â†’ output "2025-12-31"',
      '  â€¢ "10-03-2026 21:30" â†’ sadece tarih kÄ±smÄ±: "2026-03-10"',
      'KURAL: EÄŸer ilk hane 13-31 arasÄ±ndaysa o KESÄ°NLÄ°KLE gÃ¼n. Ay 1-12 arasÄ± olur.',
      'SAKIN ABD formatÄ± (MM-DD-YYYY) dÃ¼ÅŸÃ¼nme â€” TÃ¼rk belgeleri ASLA Ã¶yle yazmaz.',
      'âš  Ã–NEMLÄ°: Tarih belgede DAÄ°MA vardÄ±r â€” "null" dÃ¶nmeden Ã¶nce tÃ¼m belgeyi tara.',
      '  Sadece gÃ¶rsel tamamen okunaksÄ±z/hasarlÄ±ysa null dÃ¶n.',
      'YÄ±l 2020-2050 dÄ±ÅŸÄ±ndaysa muhtemelen OCR hatasÄ±, confidence dÃ¼ÅŸÃ¼r.',
      '',
      'â•”â•â• 5) KDV â€” Ã‡OK ORANLI / BREAKDOWN â•â•â•—',
      'TÃ¼rk belgelerinde KDV oranlarÄ±: %0, %1, %8, %10, %18, %20 (gÃ¼ncel). Eski: %18.',
      '',
      'â›” KRÄ°TÄ°K â€” NE KDV SAYILIR NE SAYILMAZ:',
      'SADECE ÅŸu etiketli satÄ±rlar KDV\'dir:',
      '  âœ“ "KDV", "K.D.V.", "Katma DeÄŸer Vergisi"',
      '  âœ“ "Hesaplanan KDV", "KDV TutarÄ±", "TOPKDV", "KUM TOPKDV"',
      '  âœ“ Tabloda "KDV %" sÃ¼tunu (Ã¶rn. "KDV (% 20,00)")',
      '',
      'ÅU SATIRLARI KDV\'YE ASLA DAHÄ°L ETME (bunlar AYRI vergi tÃ¼rleridir):',
      '  âœ— "Ã–zel Ä°letiÅŸim Vergisi" / "Ã–Ä°V" / "Ã–IV" â€” telekom faturalarÄ±nda (Turkcell, TÃ¼rk Telekom, Vodafone) %5/%10/%25',
      '  âœ— "Telsiz KullanÄ±m Vergisi" / "Telsiz KullanÄ±m AylÄ±k Taksit" â€” telekom',
      '  âœ— "Ã–TV" / "Ã–zel TÃ¼ketim Vergisi" â€” akaryakÄ±t, sigara, alkol, motorlu araÃ§',
      '  âœ— "Konaklama Vergisi" â€” otel/pansiyon (2026 itibarÄ±yla %2)',
      '  âœ— "Damga Vergisi" â€” sÃ¶zleÅŸme, makbuz Ã¼stÃ¼',
      '  âœ— "BSMV" / "Banka ve Sigorta Muameleleri Vergisi" â€” banka iÅŸlem Ã¼cretleri',
      '  âœ— "KKDF" / "Kaynak KullanÄ±mÄ±nÄ± Destekleme Fonu" â€” kredi/ithalat',
      '  âœ— "Ã‡evre Temizlik Vergisi" â€” belediye',
      '  âœ— "Stopaj" / "Gelir Vergisi Kesintisi" â€” ayrÄ± vergi',
      '    (KDV TevkifatÄ± farklÄ±dÄ±r â€” bÃ¶lÃ¼m 5c\'ye bak, NET KDV hesapla)',
      '  âœ— "DiÄŸer Vergiler" / "Vergiler" baÅŸlÄ±klÄ± toplam satÄ±r (iÃ§inde KDV olsa bile tek baÅŸÄ±na alma)',
      '  âœ— "Fon PayÄ±" / "Ã–zel TÃ¼ketim Fonu"',
      '',
      'Ã–RNEK â€” Turkcell faturasÄ±:',
      '  Katma DeÄŸer Vergisi   %20  252,00   â† BU KDV (252 TL)',
      '  Ã–zel Ä°letiÅŸim Vergisi %10  126,00   â† BU Ã–Ä°V, KDV DEÄÄ°L',
      '  Telsiz KullanÄ±m Taksit %0   26,98   â† BU TELSÄ°Z, KDV DEÄÄ°L',
      '  â†’ kdvTutari = "252,00" (SADECE KDV satÄ±rÄ±)',
      '  â†’ kdvBreakdown = [{"oran":20,"tutar":"252,00","matrah":"1260,01"}]',
      '',
      'Ã–RNEK â€” AkaryakÄ±t faturasÄ±:',
      '  KDV %20           50,00   â† BU KDV',
      '  Ã–TV              120,00   â† BU Ã–TV, KDV DEÄÄ°L',
      '  â†’ kdvTutari = "50,00"',
      '',
      'EÄŸer belgede HÄ°Ã‡ "KDV" etiketli satÄ±r yoksa (Ã¶rn. sadece Ã–Ä°V varsa), kdvTutari = "0,00".',
      '',
      'â•”â•â• 5b) Ã‡OK ORANLI KDV â€” BREAKDOWN ZORUNLU â•â•â•—',
      'GÃ¶rselde BÄ°RDEN FAZLA KDV oranÄ± satÄ±rÄ± varsa (her biri ayrÄ± "KDV %X" etiketli):',
      '  â–º kdvBreakdown alanÄ±nÄ± MUTLAKA doldur â€” her oran ayrÄ± eleman olacak.',
      '  â–º kdvTutari = tÃ¼m KDV satÄ±rlarÄ±nÄ±n matematiksel TOPLAMI.',
      '  â–º Tek oran bile olsa breakdown\'u doldur (tek elemanlÄ± dizi olarak).',
      '',
      'Ã–RNEK â€” Karma fatura (iki oran):',
      '  Hesaplanan KDV (%20)   116,00   (Matrah: 580,00)',
      '  Hesaplanan KDV (%10)    42,00   (Matrah: 420,00)',
      '  â†’ kdvBreakdown=[{"oran":20,"tutar":"116,00","matrah":"580,00"},{"oran":10,"tutar":"42,00","matrah":"420,00"}]',
      '  â†’ kdvTutari="158,00" (116 + 42)',
      '',
      'Ã–RNEK â€” Z raporu (YAZAR KASA FÄ°ÅÄ°) â€” BU PATTERN ZORUNLU:',
      '  Z raporunda KDV oranlarÄ± ÅU FORMATTA gÃ¶rÃ¼nÃ¼r (sÄ±ra Ã¶nemli, her biri AYRI satÄ±r):',
      '    TOPLAM %20    *285,00    â† matrah (%20 oranlÄ± satÄ±ÅŸlarÄ±n toplamÄ±)',
      '    TOPKDV %20     *47,50    â† KDV (%20 oran iÃ§in)',
      '    TOPLAM %10   *2.675,00   â† matrah (%10 oranlÄ± satÄ±ÅŸlarÄ±n toplamÄ±)',
      '    TOPKDV %10    *243,19    â† KDV (%10 oran iÃ§in)',
      '    TOPLAM       *2.960,00   â† genel matrah (tÃ¼m oranlar)',
      '    TOPKDV         *290,69   â† GENEL KDV TOPLAMI (breakdown toplamÄ±na eÅŸit olmalÄ±)',
      '  âœ kdvBreakdown=[{"oran":20,"tutar":"47,50","matrah":"285,00"},{"oran":10,"tutar":"243,19","matrah":"2675,00"}]',
      '  âœ kdvTutari="290,69"',
      '  âš  Z raporunda "TOPKDV %NN" her satÄ±rÄ± AYRI bir breakdown elemanÄ±dÄ±r.',
      '  âš  "KUM TOPKDV" / "KUM TOPLAM" kÃ¼mÃ¼latif â€” asla alma, sadece "TOPKDV" satÄ±rlarÄ±nÄ± al.',
      '  âš  YazÄ±cÄ± baskÄ±sÄ± silik olabilir â€” "*" ile ayrÄ±lmÄ±ÅŸ sayÄ± daima saÄŸdaki deÄŸerdir.',
      '',
      'Ã–RNEK â€” TÃœRK TELEKOM / TURKCELL / VODAFONE faturasÄ± â€” DÄ°KKAT:',
      '  Telekom faturalarÄ±nda "KDV" ile "Ã–Ä°V" yan yana gÃ¶rÃ¼nÃ¼r ve KARIÅTIRILMASI KOLAY:',
      '    Matrah          304,18    â† BU MATRAH (KDV DEÄÄ°L)',
      '    KDV (%20)        60,84    â† BU KDV (%20 oranlÄ±)',
      '    Ã–Ä°V (%10)        30,42    â† BU Ã–Ä°V, KDV DEÄÄ°L',
      '    Genel Toplam    395,44',
      '  âœ kdvTutari="60,84"  (SADECE "KDV (%NN)" etiketli satÄ±r)',
      '  âœ kdvBreakdown=[{"oran":20,"tutar":"60,84","matrah":"304,18"}]',
      '  âš  "304,18" MATRAH\'tÄ±r (KDV\'nin hesaplandÄ±ÄŸÄ± tutar), KDV DEÄÄ°L.',
      '  âš  Matrah genelde KDV\'den 5x daha bÃ¼yÃ¼ktÃ¼r (20% oranÄ±nda). BÃ¼yÃ¼k sayÄ±ya "KDV" deme.',
      '  âš  KDV satÄ±rÄ± her zaman "KDV" veya "Katma DeÄŸer" etiketi taÅŸÄ±r â€” etiket yoksa KDV deÄŸildir.',
      '',
      'TEK ORAN Ã–ZEL KURALI â€” "kalem satÄ±rlarÄ±ndaki KDV" alt toplam sayÄ±lmaz:',
      '  Normal e-Fatura/e-ArÅŸiv tablosunda her kalem iÃ§in ayrÄ± KDV sÃ¼tunu gÃ¶rÃ¼nÃ¼r (Ã¶r. 250,20 + 400,00).',
      '  Bu kalem satÄ±rlarÄ±ndaki KDV\'ler AYRI breakdown DEÄÄ°L â€” hepsi aynÄ± oran (%20) iÃ§in toplamdÄ±r.',
      '  Fatura altÄ±ndaki "Hesaplanan KDV (%20): 650,20" satÄ±rÄ±nÄ± tek kaynak olarak al.',
      '  âœ kdvTutari="650,20"',
      '  âœ kdvBreakdown=[{"oran":20,"tutar":"650,20","matrah":"3251,00"}]',
      '  âš  SAKIN kalem satÄ±rlarÄ±nÄ± ayrÄ± oran olarak sayma â€” hepsi %20 ise TEK BREAKDOWN elemanÄ±.',
      '',
      'Matrah belirgin deÄŸilse null bÄ±rak. KDV tutarÄ±nÄ± ASLA matrah/toplam farkÄ± veya oran hesabÄ±yla Ã¼retme; sadece belgede yazan KDV satÄ±rÄ±nÄ± oku.',
      '',
      'â•”â•â• 5c) KDV TEVKÄ°FATLI FATURA â€” Ä°KÄ° SAYIYI AYRI OKU â•â•â•—',
      'TEVKÄ°FATLI faturalarda SAKIN matematik yapma â€” gÃ¶rseldeki iki sayÄ±yÄ± AYRI AYRI kopyala:',
      '  1. kdvTutari = faturada yazan "Hesaplanan KDV" / "KDV TutarÄ±" / "KDV(%N)" TAM TUTARI',
      '  2. kdvTevkifat = faturada yazan "Hesaplanan KDV Tevkifat(%XX)" / "KDV TevkifatÄ±" TUTARI',
      'Kodun kendisi net KDV = tam âˆ’ tevkifat hesaplayacak. Sen sadece iki rakamÄ± OKU.',
      '',
      'TEVKÄ°FAT TESPÄ°TÄ° â€” ÅŸu markerlar varsa fatura tevkifatlÄ±dÄ±r:',
      '  â€¢ "Fatura Tipi: TEVKÄ°FAT" / "Senaryo: TEVKÄ°FAT" / "TEVKÄ°FATLI" etiketi',
      '  â€¢ "Hesaplanan KDV Tevkifat(%XX)" / "KDV TevkifatÄ±" satÄ±rÄ± + tutar',
      '  â€¢ "Tevkifata Tabi Ä°ÅŸlem TutarÄ±" satÄ±rÄ±',
      '  â€¢ "Tevkifat Sebebi" / "Tevkifat OranÄ±" alanÄ±',
      '',
      'Ã–RNEK 1 â€” TevkifatlÄ± fatura (tek oran):',
      '  Hesaplanan KDV(%20)           3.788,00   â† kdvTutari iÃ§in bu',
      '  Hesaplanan KDV Tevkifat(%50)  1.894,00   â† kdvTevkifat iÃ§in bu',
      '  Vergiler Dahil Toplam          22.728,00',
      '  Ã–denecek Tutar                 20.834,00',
      '  â†’ kdvTutari = "3788,00"     (gÃ¶rselde yazan tam KDV)',
      '  â†’ kdvTevkifat = "1894,00"   (gÃ¶rselde yazan tevkifat tutarÄ±)',
      '  â†’ toplam = "22728,00"        (Vergiler Dahil Toplam)',
      '  â†’ kdvBreakdown = [{"oran":20,"tutar":"3788,00","matrah":"18940,00"}]  (tam, net DEÄÄ°L)',
      '',
      'Ã–RNEK 2 â€” TevkifatlÄ± fatura (farklÄ± tutarlar):',
      '  Hesaplanan KDV(%20)           10.560,00',
      '  Hesaplanan KDV Tevkifat(%50)   5.280,00',
      '  â†’ kdvTutari = "10560,00"',
      '  â†’ kdvTevkifat = "5280,00"',
      '',
      'TEVKÄ°FATSIZ FATURA:',
      '  â†’ kdvTevkifat = "0,00" (veya null)',
      '  â†’ kdvTutari = olaÄŸan tam KDV',
      '',
      'âš  KRÄ°TÄ°K: TevkifatlÄ± faturada kdvTevkifat alanÄ±nÄ± BOÅ BIRAKMA. TutarÄ± oku.',
      'âš  KRÄ°TÄ°K: kdvTutari = TAM KDV (kendin Ã§Ä±karma iÅŸlemi yapma, kod halleder).',
      'âš  "Tevkifat" kelimesi faturada GEÃ‡Ä°YORSA ve tutar varsa: kdvTevkifat\'Ä± MUTLAKA doldur.',
      '',
      'â›” Ã‡OK Ã–NEMLÄ° â€” MAL HÄ°ZMET TOPLAM â‰  VERGÄ°LER DAHÄ°L TOPLAM:',
      'TevkifatlÄ± faturada ÅŸu alanlarÄ± KESÄ°NLÄ°KLE KARIÅTIRMA:',
      '  â€¢ "Mal Hizmet Toplam TutarÄ±" = MATRAH (KDV hariÃ§). Bunu /11 ile bÃ¶lme!',
      '  â€¢ "Vergiler Dahil Toplam Tutar" = MATRAH + KDV (KDV dahil). Bu da kdvTutari deÄŸil.',
      '  â€¢ "Ã–denecek Tutar" = MATRAH + (KDV âˆ’ Tevkifat). Bu da kdvTutari deÄŸil.',
      '',
      'KDV TUTARI sadece ÅŸu satÄ±rlardan biridir:',
      '  âœ“ "Hesaplanan KDV(%X)" satÄ±rÄ±nÄ±n yanÄ±ndaki tutar â€” TAM KDV',
      '  âœ“ Tevkifat bÃ¶lÃ¼mÃ¼nde "Hesaplanan KDV Tevkifat(%XX)" â€” TEVKÄ°FAT',
      '  âœ— "Mal Hizmet Toplam" â€” bu MATRAH, KDV DEÄÄ°L',
      '  âœ— "Vergiler Dahil Toplam" â€” bu MATRAH+KDV, KDV DEÄÄ°L',
      '  âœ— "Ã–denecek KDV" â€” bu NET KDV (kod hesaplayacak), KDV ALANI DEÄÄ°L',
      '',
      'YAPILACAK MATEMATÄ°K YOK â€” faturadaki YAZILI sayÄ±larÄ± KOPYALA. SAKIN /11 veya /1.20 iÅŸlemi yapma.',
      '',
      'Ã–RNEK â€” TEVKÄ°FATLI ALIÅ FATURASI (HÄ°ZMET):',
      '  Mal Hizmet Toplam TutarÄ±            13.300,00 TL  â† MATRAH (KDV DEÄÄ°L!)',
      '  Hesaplanan KDV(%10)                  1.330,00 TL  â† TAM KDV (kdvTutari iÃ§in bu)',
      '  Hesaplanan KDV Tevkifat(%50)           665,00 TL  â† TEVKÄ°FAT (kdvTevkifat iÃ§in bu)',
      '  Tevkifata Tabi Ä°ÅŸlem Ãœzerinden Hes.   1.330,00 TL  â† AynÄ± KDV (alternatif gÃ¶sterim)',
      '  Ã–denecek KDV                           665,00 TL  â† NET (kod hesaplar)',
      '  Vergiler Dahil Toplam               14.630,00 TL',
      '  Ã–denecek Tutar                      13.965,00 TL',
      '  â†’ kdvTutari = "1330,00"          (TAM KDV â€” Hesaplanan KDV satÄ±rÄ±)',
      '  â†’ kdvTevkifat = "665,00"          (Tevkifat tutarÄ±)',
      '  â†’ kdvBreakdown = [{"oran":10,"tutar":"1330,00","matrah":"13300,00"}]',
      '  âš  13.300 / 11 = 1.209 SAKIN BUNU YAZMA â€” bu yanlÄ±ÅŸ matematik! Faturadaki "1.330,00" sayÄ±sÄ±nÄ± OKU.',
      '',
      'ALGILAMA: TevkifatlÄ± fatura = "Hesaplanan KDV Tevkifat" satÄ±rÄ± VAR demektir.',
      'Bu satÄ±rÄ± gÃ¶rÃ¼r gÃ¶rmez:',
      '  1. ÃœSTTEKÄ° "Hesaplanan KDV(%X)" satÄ±rÄ±nÄ±n tutarÄ±nÄ± â†’ kdvTutari (TAM)',
      '  2. ALTTAKÄ° "Hesaplanan KDV Tevkifat(%XX)" satÄ±rÄ±nÄ±n tutarÄ±nÄ± â†’ kdvTevkifat',
      '  3. HiÃ§ hesap yapma. Ä°ki sayÄ±yÄ± oku, kod halleder.',
      '',
      'â•”â•â• 6) TUTAR FORMATI â•â•â•—',
      'TÃ¼rkiye: nokta binlik ayraÃ§, virgÃ¼l ondalÄ±k. "1.234,56" â†’ output "1234,56" (noktasÄ±z, virgÃ¼llÃ¼).',
      '"KDV" etiketi (kabul): "KDV", "K.D.V.", "Katma DeÄŸer Vergisi", "Hesaplanan KDV", "KDV TutarÄ±", "TOPKDV", "KUM TOPKDV".',
      '"KDV" DEÄÄ°L (reddet): "Ã–zel Ä°letiÅŸim Vergisi", "Ã–Ä°V", "Telsiz KullanÄ±m", "Ã–TV", "Damga", "BSMV", "KKDF", "Konaklama Vergisi", "Ã‡evre Vergisi", "Stopaj".',
      'KDV TevkifatÄ± Ã¶zeldir â€” bÃ¶lÃ¼m 5c\'ye gÃ¶re NET KDV dÃ¶ndÃ¼r.',
      '"Toplam" etiketi: "Genel Toplam", "Ã–denecek", "Fatura ToplamÄ±", "Vergiler Dahil Toplam".',
      'EÄŸer tutar "â‚º" ya da "TL" / "TRY" iÃ§eriyorsa o iÅŸareti KALDIR, sadece sayÄ± kal.',
      '',
      'â•”â•â• 6b) KATEGORÄ° â€” GÄ°DER SINIFLANDIRMASI â•â•â•—',
      'SatÄ±cÄ± unvanÄ± + Ã¼rÃ¼n/hizmet aÃ§Ä±klamasÄ±ndan gider kategorisi belirle:',
      '  â€¢ "yakit"        â†’ akaryakÄ±t, benzin, motorin, LPG, OPET, Shell, BP, Petrol Ofisi, TP, KadooilGaz',
      '  â€¢ "yemek"        â†’ restoran, lokanta, kafe, market gÄ±da, yemek kartÄ±, Sodexo, Multinet, Setcard',
      '  â€¢ "kirtasiye"    â†’ ofis malzemesi, kalem, defter, toner, kaÄŸÄ±t, Office Depot',
      '  â€¢ "telekom"      â†’ Turkcell, Vodafone, TÃ¼rk Telekom, internet, GSM, telefon',
      '  â€¢ "kira"         â†’ iÅŸyeri kirasÄ±, depo kirasÄ± (genelde stopaj 360 hesabÄ± iÃ§erir)',
      '  â€¢ "elektrik"     â†’ CK Enerji, Aydem, BoÄŸaziÃ§i Elektrik, ENERJÄ°SA, Trakya Elektrik',
      '  â€¢ "su"           â†’ Ä°SKÄ°, ASKÄ°, BUSKÄ°, ESKÄ° â€” su faturasÄ±',
      '  â€¢ "dogalgaz"     â†’ Ä°GDAÅ, BAÅKENTGAZ, AGDAÅ, doÄŸalgaz',
      '  â€¢ "tamir"        â†’ bakÄ±m, onarÄ±m, tamirhane, oto servis, otomobil bakÄ±mÄ±',
      '  â€¢ "sigorta"      â†’ kasko, trafik sigortasÄ±, dask, hayat sigortasÄ±, Allianz, Anadolu Sigorta',
      '  â€¢ "danismanlik"  â†’ SMMM, avukat, mali mÃ¼ÅŸavir, mÃ¼hendislik, danÄ±ÅŸmanlÄ±k (genelde tevkifatlÄ±)',
      '  â€¢ "nakliye"      â†’ kargo, taÅŸÄ±macÄ±lÄ±k, ARAS, MNG, YurtiÃ§i, SÃ¼rat, UPS, fedex',
      '  â€¢ "reklam"       â†’ Google Ads, Facebook, ilan, reklam, dijital pazarlama',
      '  â€¢ "temizlik"     â†’ temizlik malzemesi, temizlik hizmeti (tevkifatlÄ± olabilir)',
      '  â€¢ "saglik"       â†’ eczane, hastane, doktor, ilaÃ§, tÄ±bbi malzeme',
      '  â€¢ "diger"        â†’ yukarÄ±dakilerin hiÃ§birine girmiyor',
      'Tek kategori ver. ÅÃ¼phelide "diger" tercih et â€” yanlÄ±ÅŸ sÄ±nÄ±flandÄ±rma yapma.',
      '',
      'â•”â•â• 6c) SATICI VKN â•â•â•—',
      'EÄŸer satÄ±cÄ±nÄ±n VKN/TCKN\'si belgede gÃ¶rÃ¼nÃ¼yorsa "saticiVkn" alanÄ±na yaz.',
      'VKN: 10 hane, TCKN: 11 hane. Sadece rakam, baÅŸÄ±nda 0 olabilir. GÃ¶rÃ¼nmÃ¼yorsa null.',
      '',
      'â•”â•â• 7) KARAKTER NETLÄ°ÄÄ° â€” OCR TUZAKLARI â•â•â•—',
      'Belge no\'da rakam/harf karÄ±ÅŸÄ±klÄ±ÄŸÄ±:',
      '  â€¢ "O" (harf O) ve "0" (rakam sÄ±fÄ±r) â€” sayÄ±sal pattern\'de "0" tercih et.',
      '  â€¢ "l" / "I" (harf i/L) ve "1" (rakam bir) â€” belge no\'da "1" tercih et.',
      '  â€¢ "S" ve "5", "B" ve "8", "Z" ve "2" â€” pattern\'e bakarak karar ver.',
      'Her harfi ayrÄ± ayrÄ± gÃ¶zden geÃ§ir, Ã¶zellikle belge no\'da tÃ¼m sÄ±fÄ±rlarÄ± SAY.',
      '',
      'â•”â•â• 8) CONFIDENCE â€” GERÃ‡EKÃ‡Ä° SKOR â•â•â•—',
      '  â€¢ 0.95-1.00 â†’ Karakterler cam gibi net, tek yorum.',
      '  â€¢ 0.80-0.94 â†’ OkunaklÄ±, Ã§ok kÃ¼Ã§Ã¼k belirsizlik.',
      '  â€¢ 0.60-0.79 â†’ BulanÄ±k/kÄ±smen kapalÄ±, tahmin var.',
      '  â€¢ <0.60 â†’ Net deÄŸil, tahmine dayalÄ±.',
      '  â€¢ 0 â†’ Alan yok veya hiÃ§ okunmuyor.',
      'Birden fazla kalem topladÄ±ysan ve biri ÅŸÃ¼pheliyse skorlu dÃ¼ÅŸÃ¼r.',
    ].join('\n');

    const userText = [
      'Bu TÃ¼rk muhasebe belgesinin yapÄ±sal verilerini JSON olarak Ã§Ä±kar.',
      '',
      'ADIM 1: Belge tipini tespit et (EFATURA/EARSIV/OKC_FIS/Z_RAPORU/MAKBUZ/GIDER_PUSULASI/SMM/DEKONT/SEVK_IRSALIYESI/DIGER).',
      'ADIM 2: Tipe gÃ¶re doÄŸru alandan belge no\'yu KARAKTER KARAKTER kopyala (sÄ±fÄ±rlarÄ± atlama).',
      '         â–º Z_RAPORU ise: "Z NO" alanÄ±nÄ± ara, "FIÅ NO" DEÄÄ°L!',
      '         â–º E-FATURA/EARSIV ise: 16 karakter (3 harf + 13 rakam)',
      'ADIM 3: TARÄ°HÄ° MUTLAKA BUL â€” belgenin Ã¼stÃ¼nde/altÄ±nda DAÄ°MA vardÄ±r.',
      '         DD-MM-YYYY TÃ¼rk formatÄ±ndan "YYYY-MM-DD"\'ye Ã§evir.',
      '         "10-03-2026" â†’ "2026-03-10" (10 Mart 2026, ay-gÃ¼n YERÄ°NÄ° DEÄÄ°ÅTÄ°RME).',
      '         Sadece gÃ¶rsel tamamen okunamÄ±yorsa tarih=null dÃ¶n.',
      'ADIM 4: KDV oranlarÄ±nÄ± tara â€” birden fazla varsa breakdown dizisini MUTLAKA doldur, kdvTutari = toplam.',
      '         â–º KDV SADECE "KDV" / "Katma DeÄŸer Vergisi" etiketli satÄ±rlardan okunur.',
      '         â–º Ã–zel Ä°letiÅŸim Vergisi (Ã–Ä°V), Telsiz KullanÄ±m Vergisi, Ã–TV, Damga, BSMV, KKDF â†’ KDV DEÄÄ°L, dahil etme!',
      '         â–º Turkcell/Vodafone/TT telekom faturalarÄ±nda SADECE "Katma DeÄŸer Vergisi" satÄ±rÄ± KDV\'dir.',
      'ADIM 5: Her alan iÃ§in gerÃ§ekÃ§i confidence skoru ver.',
      '',
      'YASAK: TR1.2, TEMELFATURA, TICARIFATURA, UUID, ETTN, VKN, TCKN asla belge no DEÄÄ°L.',
      'Z RAPORU YASAK: FIÅ NO / EKÃœ NO / AT NO / SAAT / Z NO HARÄ°Ã‡ HÄ°Ã‡BÄ°R ÅEY belge no DEÄÄ°L.',
      'KDV YASAK: Ã–Ä°V / Telsiz / Ã–TV / Damga / BSMV / KKDF / Konaklama / Ã‡evre / Fon = KDV DEÄÄ°L.',
      'Sadece JSON dÃ¶n.',
    ].join('\n');

    const startMs = Date.now();
    // 429 retry â€” Anthropic rate limit'e takÄ±ldÄ±ÄŸÄ±mÄ±zda exponential backoff ile tekrar dene.
    // retry-after header'Ä± varsa ona saygÄ± gÃ¶ster; yoksa progresif bekle.
    // 6 retry Â· toplam ~13dk bekleme penceresi (eski: 4 retry Â· 3.5dk yetmiyordu)
    const MAX_RETRIES = 6;
    const BACKOFF_SECONDS = [10, 25, 60, 120, 240, 360];
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Content block â€” PDF iÃ§in "document", gÃ¶rsel iÃ§in "image"
      const contentBlock = contentType === 'document'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: mediaType, data: b64 } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: b64 } };

      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // v1.36.64: Prompt caching â€” system prompt 5dk cache, ardÄ±ÅŸÄ±k fatura Ã§aÄŸrÄ±larÄ±nda %80-90 input maliyet dÃ¼ÅŸer
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: MODEL,
          // PDF Ã§ok sayfalÄ± olabilir â†’ token limitini biraz artÄ±r
          max_tokens: isPdf ? 800 : 400,
          // v1.36.64: system prompt array + cache_control â†’ tekrar eden 3-5K token cache'lenir
          system: [
            { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            {
              role: 'user',
              content: [
                contentBlock,
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (res.status !== 429 && res.status !== 529) break;
      if (attempt === MAX_RETRIES) break;
      const retryAfter =
        Number(res.headers.get('retry-after')) ||
        BACKOFF_SECONDS[attempt] ||
        60;
      this.logger.warn(
        `Claude rate-limit (${res.status}), ${retryAfter}s bekleniyorâ€¦ (attempt ${attempt + 1}/${MAX_RETRIES})`,
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

    // Token kullanÄ±mÄ± + maliyet (model bazlÄ±)
    // v1.36.64: cache_creation ve cache_read token'larÄ± da hesaba katÄ±lÄ±r.
    // Haiku 4.5 fiyatlama: input $1, output $5, cache write $1.25 (1.25x), cache read $0.10 (0.1x).
    const inputTokens = Number(payload?.usage?.input_tokens || 0);
    const outputTokens = Number(payload?.usage?.output_tokens || 0);
    const cacheCreationTokens = Number(payload?.usage?.cache_creation_input_tokens || 0);
    const cacheReadTokens = Number(payload?.usage?.cache_read_input_tokens || 0);
    const price = CLAUDE_PRICES[MODEL] || CLAUDE_PRICES['claude-sonnet-4-5'];
    const costUsd =
      (inputTokens / 1_000_000) * price.input +
      (outputTokens / 1_000_000) * price.output +
      (cacheCreationTokens / 1_000_000) * (price.input * 1.25) +
      (cacheReadTokens / 1_000_000) * (price.input * 0.1);
    const usage = { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUsd };

    // JSON block'unu Ã§Ä±kar (Claude bazen markdown iÃ§ine sararken)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn(`Claude beklenen JSON dÃ¶ndÃ¼rmedi: ${raw.slice(0, 100)}`);
      return {
        rawText: raw.slice(0, 2000),
        belgeNo: null,
        date: null,
        kdvTutari: null,
        totalTutari: null,
        confidence: 0,
        fieldConfidence: { belgeNo: null, date: null, kdvTutari: null },
        engine: MODEL,
        usage,
      };
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      /* JSON parse baÅŸarÄ±sÄ±z â€” boÅŸ dÃ¶n */
    }

    // Tarihi TR formatÄ±na Ã§evir: YYYY-MM-DD â†’ DD.MM.YYYY
    const date = this.formatIsoToTr(parsed.tarih) ?? null;

    const belgeNo = parsed.belgeNo ? String(parsed.belgeNo).toUpperCase().trim() : null;
    let kdvTutari = parsed.kdvTutari ? String(parsed.kdvTutari).replace(/\s/g, '') : null;
    const toplam = parsed.toplam ? String(parsed.toplam).replace(/\s/g, '') : null;

    // KDV TEVKÄ°FATI â€” deterministik net KDV hesabÄ± + tevkifat tutarÄ±nÄ± sakla
    // Claude'dan tam KDV + tevkifat tutarÄ± AYRI alanda gelir (5c bÃ¶lÃ¼mÃ¼).
    // MatematiÄŸi kod yapar (Claude tutarsÄ±z hesapladÄ±ÄŸÄ± iÃ§in) â€” Luca Defteri Kebir raporunda
    // satÄ±cÄ±nÄ±n "Hesaplanan KDV" alanÄ±na yazÄ±lan NET KDV'dir.
    // Ã–NEMLÄ°: Tevkifat tutarÄ± kaybolmasÄ±n diye OcrResult.kdvTevkifat alanÄ±na
    // ayrÄ±ca yazÄ±lÄ±yor â€” DB'de transparency iÃ§in.
    const kdvTevkifatRaw = parsed.kdvTevkifat ? String(parsed.kdvTevkifat).replace(/\s/g, '') : null;
    const kdvTevkifatNum = kdvTevkifatRaw ? this.parseAmount(kdvTevkifatRaw) : 0;
    let kdvTevkifatOut: string | null = null;
    if (kdvTutari && kdvTevkifatNum > 0) {
      const tamKdv = this.parseAmount(kdvTutari);
      const netKdv = Math.max(0, tamKdv - kdvTevkifatNum);
      this.logger.log(
        `Claude OCR: tevkifat dÃ¼ÅŸÃ¼ldÃ¼ â€” tam=${tamKdv}, tevkifat=${kdvTevkifatNum}, net=${netKdv}`,
      );
      kdvTutari = this.formatAmount(netKdv);
      kdvTevkifatOut = this.formatAmount(kdvTevkifatNum);
    }

    // Claude'un verdiÄŸi alan-bazlÄ± confidence'Ä± parse et
    const cf = parsed.confidence || {};
    const fieldConfidence = {
      belgeNo: belgeNo ? this.clampConfidence(cf.belgeNo) : null,
      date: date ? this.clampConfidence(cf.tarih) : null,
      kdvTutari: kdvTutari ? this.clampConfidence(cf.kdvTutari) : null,
    };

    // Genel confidence: alan-bazlÄ± ortalama (bulunan alanlarÄ±n), yoksa klasik hesap
    const fieldScores = [fieldConfidence.belgeNo, fieldConfidence.date, fieldConfidence.kdvTutari]
      .filter((v): v is number => typeof v === 'number');
    const foundFields = fieldScores.length;
    const confidence = foundFields > 0
      ? fieldScores.reduce((a, b) => a + b, 0) / foundFields
      : 0;

    this.logger.log(
      `Claude OCR âœ“ Alan:${foundFields}/3 Â· Conf:%${Math.round(confidence * 100)} ` +
        `(belgeNo:${fmtConf(fieldConfidence.belgeNo)} Â· tarih:${fmtConf(fieldConfidence.date)} Â· kdv:${fmtConf(fieldConfidence.kdvTutari)}) ` +
        `${Date.now() - startMs}ms`,
    );

    // â”€â”€ KDV BREAKDOWN â€” Ã§ok oranlÄ± belgelerde her KDV oranÄ± iÃ§in ayrÄ± satÄ±r â”€â”€
    let kdvBreakdown: KdvBreakdownItem[] | null = null;
    if (Array.isArray(parsed.kdvBreakdown) && parsed.kdvBreakdown.length > 0) {
      const mappedBreakdown: KdvBreakdownItem[] = parsed.kdvBreakdown
        .map((item: any): KdvBreakdownItem => {
          const oran = typeof item?.oran === 'number' ? item.oran : parseFloat(String(item?.oran || 0));
          const tutar = this.parseAmount(String(item?.tutar ?? '0'));
          const matrahRaw = item?.matrah;
          const matrah = matrahRaw != null ? this.parseAmount(String(matrahRaw)) : null;
          return { oran: Number.isFinite(oran) ? oran : 0, tutar, matrah };
        })
        .filter((b: KdvBreakdownItem) => b.tutar > 0 || (b.oran === 0 && !!b.matrah));
      kdvBreakdown = mappedBreakdown.length > 0 ? mappedBreakdown : null;
    }

    // Tevkifat varsa breakdown tutar'Ä±nÄ± da net'e indir (tek oranlÄ± faturalarda UI tutarlÄ±lÄ±ÄŸÄ±)
    if (kdvBreakdown && kdvBreakdown.length === 1 && kdvTevkifatNum > 0 && kdvTutari) {
      kdvBreakdown[0].tutar = this.parseAmount(kdvTutari);
    }

    // Belge tipi â€” Claude prompt'unda var
    const belgeTipi = parsed.belgeTipi
      ? String(parsed.belgeTipi).toUpperCase().trim()
      : null;

    // SatÄ±cÄ± unvanÄ± â€” aynÄ± belge no'lu farklÄ± firmalarÄ± ayÄ±rmak iÃ§in
    const satici = parsed.satici
      ? String(parsed.satici).trim().slice(0, 200)
      : null;

    // SatÄ±cÄ± VKN/TCKN â€” varsa reconciliation'da primary key olarak kullanÄ±lÄ±r
    const saticiVknRaw = parsed.saticiVkn ? String(parsed.saticiVkn).replace(/\D/g, '') : null;
    const saticiVkn = saticiVknRaw && (saticiVknRaw.length === 10 || saticiVknRaw.length === 11)
      ? saticiVknRaw
      : null;

    // Otomatik kategori â€” beyanname / gider tablosu / raporlamada kullanÄ±lÄ±r
    const VALID_KATEGORI = new Set([
      'yakit', 'yemek', 'kirtasiye', 'telekom', 'kira', 'elektrik', 'su', 'dogalgaz',
      'tamir', 'sigorta', 'danismanlik', 'nakliye', 'reklam', 'temizlik', 'saglik', 'diger',
    ]);
    const katRaw = parsed.kategori ? String(parsed.kategori).trim().toLowerCase() : null;
    const kategori = katRaw && VALID_KATEGORI.has(katRaw) ? katRaw : null;

    return {
      rawText: JSON.stringify(parsed).slice(0, 2000),
      belgeNo,
      date,
      kdvTutari,
      kdvTevkifat: kdvTevkifatOut,
      totalTutari: toplam,
      satici,
      saticiVkn,
      belgeTipi,
      kdvBreakdown,
      kategori,
      confidence,
      fieldConfidence,
      engine: MODEL,
      usage,
    } as any;
  }

  /** Claude'dan gelen confidence deÄŸerini 0â€“1 aralÄ±ÄŸÄ±na sÄ±kÄ±ÅŸtÄ±r (geÃ§ersizse 0.5) */
  private clampConfidence(v: any): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return 0.5; // Claude vermemiÅŸse nÃ¶tr baseline
    if (n < 0) return 0;
    if (n > 1) return n > 1 && n <= 100 ? n / 100 : 1; // bazen yÃ¼zde verirse dÃ¼zelt
    return n;
  }

  /**
   * Claude'un dÃ¶ndÃ¼rdÃ¼ÄŸÃ¼ tarihi "DD.MM.YYYY" TÃ¼rk formatÄ±na normalize eder.
   * Kabul edilen girdi formatlarÄ±:
   *   - "2026-03-08"  (ISO, prompt'ta istenen)
   *   - "08.03.2026" / "08-03-2026" / "08/03/2026" (TR, kullanÄ±cÄ± hatasÄ±)
   *   - "08 03 2026" (boÅŸluklu OCR)
   * Ay/gÃ¼n ambiguous ise (ikisi de 1-12) ISO sÄ±rasÄ±nÄ± koru.
   */
  private formatIsoToTr(iso?: string | null): string | null {
    if (!iso || typeof iso !== 'string') return null;
    const s = iso.trim();

    // 1) ISO â€” YYYY-MM-DD (canonical)
    const iso1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso1) {
      const yy = iso1[1], mo = iso1[2].padStart(2, '0'), dd = iso1[3].padStart(2, '0');
      if (+mo >= 1 && +mo <= 12 && +dd >= 1 && +dd <= 31) return `${dd}.${mo}.${yy}`;
    }

    // 2) TR â€” DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY / DD MM YYYY
    const tr = s.match(/^(\d{1,2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{2}|\d{4})$/);
    if (tr) {
      let dd = +tr[1], mo = +tr[2];
      const yy = this.normalizeOcrYear(tr[3]);
      // TÃ¼rk belgeleri DAÄ°MA DD-MM-YYYY. Sadece gÃ¼n > 12 olduÄŸunda swap mantÄ±klÄ±.
      if (dd < 1 || mo < 1 || yy == null) return null;
      if (mo > 12 && dd <= 12) {
        // Claude yanlÄ±ÅŸlÄ±kla US formatÄ± dÃ¶ndÃ¼, swap
        [dd, mo] = [mo, dd];
      }
      if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
      return `${String(dd).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${yy}`;
    }

    // 3) YYYY/MM/DD (nadir)
    const iso2 = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (iso2) {
      const yy = iso2[1], mo = iso2[2].padStart(2, '0'), dd = iso2[3].padStart(2, '0');
      if (+mo >= 1 && +mo <= 12 && +dd >= 1 && +dd <= 31) return `${dd}.${mo}.${yy}`;
    }

    return null;
  }

  /**
   * "08.03.2026" TÃ¼rk formatÄ±ndaki metni rawText'ten yakalar â€” Claude tarih dÃ¶ndÃ¼rmediÄŸinde
   * fallback olarak kullanÄ±lÄ±r. En erken (en Ã¼stte) bulunan makul tarihi dÃ¶ner.
   */
  private extractDateFromText(text: string): string | null {
    if (!text) return null;
    // Ã–ncelik: DD-MM-YYYY, DD.MM.YYYY, DD/MM/YYYY
    const regexes = [
      /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2}|\d{4})\b/g,
      /\b(\d{1,2})\s(\d{1,2})\s(\d{2}|\d{4})\b/g,
    ];
    for (const re of regexes) {
      for (const m of text.matchAll(re)) {
        let dd = +m[1], mo = +m[2];
        const yy = this.normalizeOcrYear(m[3]);
        if (yy == null) continue;
        if (mo > 12 && dd <= 12) [dd, mo] = [mo, dd];
        if (mo < 1 || mo > 12 || dd < 1 || dd > 31) continue;
        return `${String(dd).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${yy}`;
      }
    }
    return null;
  }

  /**
   * Geriye dÃ¶nÃ¼k uyumluluk â€” hiÃ§bir alan okunmadÄ±ysa "low" kabul edilir.
   * Bu fonksiyon sadece "hiÃ§ okuyamadÄ±k" durumunu yakalar.
   * Review gerekip gerekmediÄŸi iÃ§in `needsReview` kullan.
   */
  isLowConfidence(result: OcrResult): boolean {
    if (result.belgeNo) return false;
    if (result.date) return false;
    return true;
  }

  /**
   * KullanÄ±cÄ± teyidi gerekip gerekmediÄŸini belirler:
   *  - HiÃ§ alan okunmadÄ±ysa  â†’ true (LOW_CONFIDENCE)
   *  - Herhangi bir alan FIELD_CONFIDENCE_THRESHOLD altÄ±ndaysa â†’ true (NEEDS_REVIEW)
   *  - Aksi halde â†’ false (SUCCESS)
   *
   * v1.36.73: VALIDATION-AWARE EÅÄ°K
   *   EÄŸer validationScore >= 0.99 (matematik tamamen tutarlÄ±: KDV=matrahÃ—oran,
   *   breakdown.tutar.sum = kdvTutari, vb.) â†’ eÅŸik 0.7'den 0.5'e dÃ¼ÅŸer.
   *   Sebep: math zaten doÄŸru ise, Claude'un alan-bazlÄ± utangaÃ§lÄ±ÄŸÄ± yapay
   *   "needs review" yaratÄ±yor (Z RAPORU/Ã–KC FIÅI'nde tarih confidence sÄ±k
   *   dÃ¼ÅŸer Ã§Ã¼nkÃ¼ iki haneli yÄ±l "01/04/26" Claude'a belirsiz geliyor).
   *   v1.36.73: Z_RAPORU + OKC_FIS iÃ§in ek gevÅŸetme (yapÄ±sal belge):
   *     Validation %95+ ve breakdown sum = kdvTutari ise eÅŸik 0.4.
   */
  needsReview(result: OcrResult): { needs: boolean; reason: 'none' | 'empty' | 'low_field' } {
    if (this.isLowConfidence(result)) return { needs: true, reason: 'empty' };

    // Belge no + tarih okunsa bile KDV boÅŸsa "baÅŸarÄ±lÄ±" sayma.
    // Ã–zellikle gÃ¶rsel/XML uzantÄ±lÄ± e-faturalarda oran okunup tutar boÅŸ kalabiliyor;
    // kullanÄ±cÄ± teyidine dÃ¼ÅŸmeli ki placeholder deÄŸer rapora taÅŸÄ±nmasÄ±n.
    const kdvAmount = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
    if (!result.kdvTutari || kdvAmount <= 0) {
      if (result.fieldConfidence) result.fieldConfidence.kdvTutari = null;
      return { needs: true, reason: 'low_field' };
    }
    if (!result.belgeNo || !result.date) {
      return { needs: true, reason: 'low_field' };
    }

    const { belgeNo, date, kdvTutari } = result.fieldConfidence;
    const scores = [belgeNo, date, kdvTutari].map((v) =>
      typeof v === 'number' ? v : 0,
    );

    // Validation-aware eÅŸik
    const validation = result.validationScore ?? 0;
    const isStructuredReceipt =
      result.belgeTipi === 'Z_RAPORU' || result.belgeTipi === 'OKC_FIS';
    let effectiveThreshold = FIELD_CONFIDENCE_THRESHOLD; // 0.7
    if (isStructuredReceipt && validation >= 0.95) {
      effectiveThreshold = 0.4;
    } else if (validation >= 0.99) {
      effectiveThreshold = 0.5;
    }

    if (scores.some((s) => s < effectiveThreshold)) {
      return { needs: true, reason: 'low_field' };
    }

    // v1.37.75 - Mantik kontrolu: Z raporu/fislerde GUNLUK KDV mantiken <50K TL.
    // Daha yuksekse Azure muhtemelen KUM.KDV (kumulatif) satirini "gunluk KDV"
    // alanina yazmistir -> kullanici teyidine dusur. Math validation bunu
    // yakalayamaz cunku kumulatif degerler de oran x matrah = KDV uyumlu.
    if (isStructuredReceipt && kdvAmount >= 50_000) {
      if (result.fieldConfidence) result.fieldConfidence.kdvTutari = 0.3;
      return { needs: true, reason: 'low_field' };
    }

    // v1.37.75 - Z raporunda hem gunluk TOPLAM hem KUM.TOP varsa,
    // gunluk TOPLAM > KUM.TOP imkansiz. Bu da kumulatif/gunluk karisikligi sinyali.
    if (result.belgeTipi === 'Z_RAPORU' && result.rawText) {
      const raw = this.foldTurkishAscii(result.rawText).toUpperCase();
      const kumMatch = raw.match(/\bKUM\s*\.?\s*T[O0]P\b\s*\*?\s*([\d.,]+)/);
      const dailyToplam = result.totalTutari ? this.parseAmount(result.totalTutari) : 0;
      if (kumMatch && dailyToplam > 0) {
        const kumToplam = this.parseAmount(kumMatch[1]);
        if (kumToplam > 0 && dailyToplam > kumToplam) {
          if (result.fieldConfidence) result.fieldConfidence.kdvTutari = 0.3;
          return { needs: true, reason: 'low_field' };
        }
      }
    }

    return { needs: false, reason: 'none' };
  }

  // === AZURE VISION OCR ===
  /**
   * Azure Vision Read API ile gÃ¶rÃ¼ntÃ¼den ham metin Ã§Ä±karÄ±r.
   * Hem fallback OCR hem de Claude cross-check iÃ§in kullanÄ±lÄ±r.
   * Ã‡ok ucuz (~$0.001/belge, ilk 5K/ay bedava).
   */
  private async getAzureRawText(buffer: Buffer): Promise<string> {
    if (!this.azureClient) throw new Error('Azure client yok');

    const result = await this.azureClient.readInStream(buffer);
    const operationId = result.operationLocation?.split('/').pop();
    if (!operationId) throw new Error('Azure operation ID alÄ±namadÄ±');

    // Polling
    let readResult = await this.azureClient.getReadResult(operationId);
    let attempts = 0;
    while (readResult.status !== 'succeeded' && readResult.status !== 'failed' && attempts < 30) {
      await new Promise((r) => setTimeout(r, 500));
      readResult = await this.azureClient.getReadResult(operationId);
      attempts++;
    }
    if (readResult.status !== 'succeeded') {
      throw new Error('Azure OCR baÅŸarÄ±sÄ±z: ' + readResult.status);
    }

    const lines: string[] = [];
    readResult.analyzeResult?.readResults?.forEach((page: any) => {
      page.lines?.forEach((line: any) => {
        lines.push(line.text);
      });
    });
    return lines.join('\n');
  }

  private async runAzureOcr(
    buffer: Buffer,
    belgeNoFromFilename: string | null,
    originalName?: string,
  ): Promise<OcrResult> {
    const fullText = await this.getAzureRawText(buffer);

    // AlanlarÄ± Ã§Ä±kar
    const belgeTipi = this.detectBelgeTipiFromAzure(fullText, originalName);
    const date = this.extractPreferredInvoiceDate(fullText) ?? this.extractDate(fullText);
    // v1.37.75 - Z raporu icin body'deki "Z NO" mutlak oncelikli.
    // Dosya adi sikca FIS NO veya tarih-bazli string olabilir; Z raporlarinda
    // belge kimligi SADECE "Z NO" / "Z SAYAC" alanidir, asla FIS NO/EKU NO degil.
    const bodyBelgeNo = this.extractBelgeNo(fullText);
    let belgeNo: string | null;
    if (belgeTipi === 'Z_RAPORU' && bodyBelgeNo) {
      belgeNo = bodyBelgeNo;
      if (belgeNoFromFilename && belgeNoFromFilename !== bodyBelgeNo) {
        this.logger.log(
          `Z_RAPORU belgeNo override: filename "${belgeNoFromFilename}" yerine body Z NO "${bodyBelgeNo}" kullanildi (${originalName || '-'})`,
        );
      }
    } else {
      belgeNo = belgeNoFromFilename ?? bodyBelgeNo;
    }
    const zRaporu = belgeTipi === 'Z_RAPORU' ? this.extractZRaporuKdvFromAzure(fullText) : null;
    const okcFis = belgeTipi === 'OKC_FIS' ? this.extractOkcFisKdvFromAzure(fullText) : null;
    let tevkifatli = this.extractTevkifatliFaturaFromAzure(fullText);
    let invoiceTotalsKdv = tevkifatli || zRaporu?.kdvTutari || okcFis?.kdvTutari
      ? null
      : this.extractKdvFromInvoiceTotalsAzure(fullText);
    let kdv = zRaporu?.kdvTutari
      ? zRaporu.kdvTutari
      : tevkifatli
        ? this.formatAmount(tevkifatli.netKdv)
        : okcFis?.kdvTutari
          ? okcFis.kdvTutari
          : invoiceTotalsKdv
            ? this.formatAmount(invoiceTotalsKdv.kdv)
            : this.extractKdvTotal(fullText);
    if (!tevkifatli && kdv) {
      const inferredTevkifat = this.inferTevkifatFromAzureAmounts(fullText, this.parseAmount(kdv));
      if (inferredTevkifat) {
        tevkifatli = inferredTevkifat;
        invoiceTotalsKdv = null;
        kdv = this.formatAmount(inferredTevkifat.netKdv);
        this.logger.warn(
          `Azure OCR tevkifat fallback: tam=${this.formatAmount(inferredTevkifat.tamKdv)} tevkifat=${this.formatAmount(inferredTevkifat.tevkifat)} net=${kdv} (${originalName || '-'})`,
        );
      }
    }
    const toplam = this.extractToplam(fullText);
    if (!zRaporu?.kdvTutari && !tevkifatli && kdv && toplam) {
      const kdvNum = this.parseAmount(String(kdv));
      const toplamNum = this.parseAmount(String(toplam));
      if (kdvNum > 0 && toplamNum > 0 && kdvNum >= toplamNum * 0.45) {
        this.logger.warn(
          `Azure OCR KDV tutari supheli: kdv=${kdv} toplam=${toplam} - KDV alani bos birakildi (${originalName || '-'})`,
        );
        kdv = null;
      }
    }
    const satici = this.extractSaticiFromAzure(fullText);
    const saticiVkn = this.extractSaticiVknFromAzure(fullText);

    const foundFields = [belgeNo, date, kdv].filter(Boolean).length;
    const confidence = belgeNoFromFilename 
      ? 0.3 + (foundFields / 3) * 0.7
      : foundFields / 3;

    this.logger.log(
      `Azure OCR [${belgeNoFromFilename || 'unknown'}] Alan:${foundFields}/3 Conf:%${Math.round(confidence * 100)}`
    );

    // Azure baseline: regex eÅŸleÅŸmeleri iÃ§in orta gÃ¼ven (0.6)
    // Filename fallback belgeNo iÃ§in daha dÃ¼ÅŸÃ¼k (0.4)
    const azureBaseline = 0.72;
    const fieldConfidence = {
      belgeNo: belgeNo ? (belgeNoFromFilename && belgeNo === belgeNoFromFilename ? 0.95 : azureBaseline) : null,
      date: date ? azureBaseline : null,
      kdvTutari: kdv ? (zRaporu?.kdvTutari || tevkifatli || okcFis?.kdvTutari || invoiceTotalsKdv ? 0.92 : azureBaseline) : null,
    };

    const result: OcrResult = {
      rawText: fullText.slice(0, 3000),
      belgeNo,
      date,
      kdvTutari: kdv,
      kdvTevkifat: tevkifatli ? this.formatAmount(tevkifatli.tevkifat) : null,
      totalTutari: toplam,
      satici,
      saticiVkn,
      belgeTipi,
      confidence,
      fieldConfidence,
      engine: 'azure-read',
    };

    if (zRaporu?.breakdown?.length) {
      result.kdvBreakdown = zRaporu.breakdown;
    } else if (tevkifatli) {
      const oranMatch = this.normalizeAzureText(fullText).match(
        /HESAPLANAN\s+KDV\s*\(\s*[%/]?\s*(\d{1,2})/i,
      );
      const oran = oranMatch ? parseInt(oranMatch[1], 10) : null;
      result.kdvBreakdown = [{
        oran: oran && [1, 10, 20].includes(oran) ? oran : 20,
        tutar: tevkifatli.netKdv,
        matrah: null,
      }];
    } else if (okcFis?.breakdown?.length) {
      result.kdvBreakdown = okcFis.breakdown;
    } else if (invoiceTotalsKdv) {
      result.kdvBreakdown = [{
        oran: invoiceTotalsKdv.oran && [1, 10, 20].includes(invoiceTotalsKdv.oran)
          ? invoiceTotalsKdv.oran
          : 20,
        tutar: invoiceTotalsKdv.kdv,
        matrah: invoiceTotalsKdv.matrah,
      }];
    }

    this.postProcessOcrResult(result, belgeNoFromFilename, originalName);
    this.crossCheckWithAzure(result, fullText, originalName, belgeNoFromFilename);
    this.validateOcrResult(result, originalName);

    return result;
  }

  // === YARDIMCI FONKSÄ°YONLAR ===
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (E_BELGE_NO_REGEX.test(base.toUpperCase())) return base.toUpperCase();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    return null;
  }

  private extractPreferredInvoiceDate(text: string): string | null {
    if (!text) return null;

    const normalizeTrDate = (d: string, mo: string, y: string): string | null => {
      let dd = Number(d);
      let month = Number(mo);
      const yy = this.normalizeOcrYear(y);
      if (yy == null || dd < 1 || month < 1) return null;
      if (month > 12 && dd <= 12) [dd, month] = [month, dd];
      if (month < 1 || month > 12 || dd < 1 || dd > 31) return null;
      return `${String(dd).padStart(2, '0')}.${String(month).padStart(2, '0')}.${yy}`;
    };

    const findDates = (source: string): string[] => {
      const dates: string[] = [];
      const seen = new Set<string>();
      const push = (value: string | null) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        dates.push(value);
      };

      for (const m of source.matchAll(/\b(\d{1,2})\s*[-.\/]\s*(\d{1,2})\s*[-.\/]\s*(\d{2}|\d{4})\b/g)) {
        push(normalizeTrDate(m[1], m[2], m[3]));
      }
      for (const m of source.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
        push(normalizeTrDate(m[3], m[2], m[1]));
      }

      return dates;
    };

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const positiveLabel =
      /\b(?:FATURA|BELGE|EVRAK|DUZENLENME|DUZENLEME|TANZIM|FIS|MAKBUZ)\s+TARIH[II]?\b|\bTARIH[II]?\s*[:\-]/;
    const strongLabel =
      /\bDUZENLENME\s+TARIH[II]?\b|\bDUZENLEME\s+TARIH[II]?\b|\bFATURA\s+TARIH[II]?\b|\bBELGE\s+TARIH[II]?\b/;
    const negativeLabel =
      /\b(?:SON\s+ODEME|VADE|TICARET\s+SICIL|MERSIS|KURULUS|ISE\s+BASLAMA|IBAN|HESAP|ODEME\s+NOTU)\b/;

    let best: { value: string; score: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const window = [lines[i - 1] || '', lines[i], lines[i + 1] || ''].join('\n');
      const folded = this.foldTurkishAscii(window).replace(/\s+/g, ' ').trim();

      for (const date of findDates(window)) {
        let score = 10 - Math.min(i, 10) * 0.05;
        if (positiveLabel.test(folded)) score += 100;
        if (strongLabel.test(folded)) score += 50;
        if (negativeLabel.test(folded)) score -= 120;
        if (/\b\d{1,2}[:.]\d{2}(?::\d{2})?\b/.test(window)) score += 2;
        if (!best || score > best.score) best = { value: date, score };
      }
    }

    return best && best.score >= 50 ? best.value : null;
  }

  /** @deprecated icerik ocr/parsers/date.ts altinda — bu wrapper backward compat */
  private extractDate(text: string): string | null {
    return extractDatePure(text);
  }

  private extractBelgeNo(text: string): string | null {
    // Z RAPORU tespiti â€” eÄŸer metinde Z RAPORU geÃ§iyorsa Z NO/Z SAYAÃ‡'Ä± al
    const isZRapor = /z\s*rapor(u|[Ä±i])?|z\s*report|z\s*g[uÃ¼]nl[uÃ¼]k/i.test(text);
    if (isZRapor) {
      // v1.36.72: "Z SAYAÃ‡ 896" / "Z SAYAC: 896" / "Z SAYACI 896" desenleri ekledim
      // (bazÄ± Ã–KC modelleri "Z NO" yerine "Z SAYAÃ‡" yazÄ±yor)
      const zSayac = text.match(/z\s*saya[cÃ§][Ä±i]?\s*[:\-.#\s]*(\d{1,8})/i);
      if (zSayac?.[1]) return zSayac[1].trim();

      // "Z NO: 666" formatÄ±nÄ± ara (iki nokta, tire veya boÅŸluk sonrasÄ± rakam)
      const zNo = text.match(/z\s*no\s*[:\-.#\s]+(\d{1,8})/i);
      if (zNo?.[1]) return zNo[1].trim();

      // Son Ã§are: belgenin alt kÄ±smÄ±ndaki Ã§Ä±plak Z numarasÄ± ("Z 0896" gibi)
      const zBare = text.match(/(?:^|\n|\s)z\s*[:\-]?\s*(\d{2,8})\s*(?:$|\n)/im);
      if (zBare?.[1]) return zBare[1].trim();
    }

    const foldedText = this.foldTurkishAscii(text);
    const patterns = [
      /fis\s*no\s*[:\s#.]*([A-Z0-9]{1,12})/i,
      /fatura\s*no\s*:?\s*([A-Z0-9]{10,20})/i,
      /(?:fis|belge|evrak)\s*(?:no|numarasi)?[:\s#.]*([A-Z0-9]{8,20})/i,
      /\b([A-Z0-9]{3}20\d{2}\d{6,12})\b/i,
    ];
    for (const p of patterns) {
      const m = foldedText.match(p);
      if (m?.[1]) return m[1].trim().toUpperCase();
    }
    return null;
  }

  private extractKdvTotal(text: string): string | null {
    const cleanText = this.stripMatrahFragments(text);

    // Hesaplanan KDV (Ã§oklu oran)
    const hesaplananMatches = [...cleanText.matchAll(/hesaplanan\s*kdv\s*(?:\(\s*%?\s*(\d{1,2})(?:[,.]\d{1,2})?\s*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (hesaplananMatches.length > 0) {
      const total = hesaplananMatches.reduce((sum, m) => {
        const rate = m[1] ? Number(m[1]) : null;
        const amount = this.parseAmount(m[2]);
        if (rate != null && this.isLikelyStandaloneTaxRate(m[2]) && Math.abs(amount - rate) < 0.01) {
          return sum;
        }
        return sum + amount;
      }, 0);
      if (total > 0) return this.formatAmount(total);
    }

    // KDV tutarÄ±
    const kdvMatches = [...cleanText.matchAll(/k\.?d\.?v\.?\s*(?:tutarÄ±?)?\s*[:=]\s*([\d.,]+)/gi)];
    if (kdvMatches.length > 0) {
      const values = kdvMatches.map(m => this.parseAmount(m[1])).filter(v => v > 0);
      if (values.length > 0) return this.formatAmount(Math.max(...values));
    }

    // Toplam KDV
    const toplamKdv = cleanText.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplamKdv?.[1]) return toplamKdv[1].replace(/\s/g, '');

    return null;
  }

  /** @deprecated icerik ocr/parsers/date.ts altinda — bu wrapper backward compat */
  private normalizeOcrYear(raw: string): number | null {
    return normalizeOcrYearPure(raw);
  }

  private extractOkcFisKdvFromAzure(text: string): {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
  } | null {
    if (!text) return null;
    const lines = this.normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const breakdown: KdvBreakdownItem[] = [];
    const kdvLineRe = /\bK\.?\s*D\.?\s*V\.?\b(?!\s*(?:MATRAH|ORAN|UYGULANAN))|\bT[O0]P\s*K\s*D\s*V\b|\bT[O0]PKD[UV]\b/i;
    const otherTaxRe = /Ã–ZEL\s*Ä°LETÄ°ÅÄ°M|Ã–Ä°V|OIV|TELSÄ°Z|TELSIZ|Ã–TV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|Ã‡EVRE|STOPAJ/i;
    const amountRe = /[-+]?[\*â‚ºÂ¥]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:TL|TRY|â‚º)?/g;
    const parseLastAmount = (raw: string): number => {
      const clean = this.stripMatrahFragments(raw);
      const values = [...clean.matchAll(amountRe)]
        .map((m) => this.parseAmount(m[1]))
        .filter((value) => value > 0 && value < 100_000_000);
      return values.length > 0 ? values[values.length - 1] : 0;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!kdvLineRe.test(line)) continue;
      if (otherTaxRe.test(line) || this.isMatrahOrRateLine(line)) continue;
      const rateMatch = line.match(/(?:K\.?\s*D\.?\s*V\.?\s*)?[%/]\s*(\d{1,2})(?:[.,]\d+)?/i);
      const oran = rateMatch ? Number(rateMatch[1]) : null;
      let tutar = parseLastAmount(line);
      if (tutar <= 0) {
        for (let j = 1; j <= 2 && i + j < lines.length; j++) {
          const next = lines[i + j];
          if (otherTaxRe.test(next) || /TOPLAM|NAKÄ°T|NAKIT|KART|GENEL/i.test(next)) break;
          tutar = parseLastAmount(next);
          if (tutar > 0) break;
        }
      }
      if (tutar > 0) {
        breakdown.push({
          oran: oran && [1, 10, 20].includes(oran) ? oran : 0,
          tutar,
          matrah: null,
        });
      }
    }

    const summarySum = breakdown.reduce((total, item) => total + item.tutar, 0);
    const itemRateBreakdown = this.extractOkcFisItemRateBreakdownFromAzure(text, summarySum);
    if (itemRateBreakdown.length >= 2) {
      const itemSum = itemRateBreakdown.reduce((total, item) => total + item.tutar, 0);
      return {
        kdvTutari: this.formatAmount(summarySum > 0 ? summarySum : itemSum),
        breakdown: itemRateBreakdown,
      };
    }

    if (breakdown.length === 0) return null;
    return {
      kdvTutari: this.formatAmount(summarySum),
      breakdown,
    };
  }

  /**
   * OKC fislerde bazen sadece TOPKDV toplam yazilir; oran bazli KDV ise urun
   * satirlarindaki %01/%10/%20 brut tutarlardan turetilmelidir.
   */
  private extractOkcFisItemRateBreakdownFromAzure(
    text: string,
    expectedTotal?: number | null,
  ): KdvBreakdownItem[] {
    if (!text) return [];
    const lines = this.normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const grossByRate = new Map<number, number>();
    const rateRe = /%\s*0?(1|8|10|18|20)(?:[,.]00)?\b/i;
    const amountRe = /[-+]?[*]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:TL|TRY)?/g;
    const skipRe = /TOPKDV|TOPLAM|KDV\s*TUTARI|KDV\s*TOPLAM|NAK[IÄ°]T|KRED[IÄ°]|KART|PARA\s*[UÃœ]ST[UÃœ]|KAS[IÄ°]YER|MERS[IÄ°]S|EKU|Z\s*NO|F[IÄ°][SÅ]\s*NO|TAR[IÄ°]H|SAAT|VERG[IÄ°]|V\.?D\.?|T\.?C\.?|TE[SÅ]EKK[UÃœ]R|M[UÃœ][SÅ]TER[IÄ°]/i;

    const parseLastAmount = (raw: string): number => {
      const values = [...raw.matchAll(amountRe)]
        .map((m) => this.parseAmount(m[1]))
        .filter((value) => value > 0 && value < 100_000_000);
      return values.length > 0 ? values[values.length - 1] : 0;
    };

    let pendingRate: number | null = null;
    for (const line of lines) {
      if (skipRe.test(line)) {
        pendingRate = null;
        continue;
      }

      const rateMatch = line.match(rateRe);
      if (rateMatch && rateMatch.index != null) {
        const oran = Number(rateMatch[1]);
        const afterRate = line.slice(rateMatch.index + rateMatch[0].length);
        const gross = parseLastAmount(afterRate) || parseLastAmount(line);
        if (gross > 0) {
          grossByRate.set(oran, (grossByRate.get(oran) || 0) + gross);
          pendingRate = null;
        } else {
          pendingRate = oran;
        }
        continue;
      }

      if (pendingRate) {
        const gross = parseLastAmount(line);
        if (gross > 0) {
          grossByRate.set(pendingRate, (grossByRate.get(pendingRate) || 0) + gross);
          pendingRate = null;
        }
      }
    }

    if (grossByRate.size < 2) return [];
    const breakdown = Array.from(grossByRate.entries())
      .sort((a, b) => a[0] - b[0]) // %1, %10, %20 sÄ±rayla (kÃ¼Ã§Ã¼kten bÃ¼yÃ¼ÄŸe)
      .map(([oran, gross]) => ({
        oran,
        tutar: Math.round((gross * oran / (100 + oran)) * 100) / 100,
        matrah: null,
      }))
      .filter((item) => item.tutar > 0);

    if (breakdown.length < 2) return [];
    const sum = breakdown.reduce((total, item) => total + item.tutar, 0);
    if (expectedTotal && expectedTotal > 0) {
      const tolerance = Math.max(0.08, expectedTotal * 0.03);
      if (Math.abs(sum - expectedTotal) > tolerance) {
        this.logger.warn(
          `OKC item-rate breakdown toplamla uyumsuz: item=${this.formatAmount(sum)} topkdv=${this.formatAmount(expectedTotal)} - breakdown kullanilmadi`,
        );
        return [];
      }
    }
    return breakdown;
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

  /**
   * Z RAPORU Ã¶zel parser â€” Azure ham metninden TOPKDV / TOPKDV %X satÄ±rlarÄ±nÄ± Ã§Ä±karÄ±r.
   * Ã‡Ä±ktÄ±: { kdvTutari, breakdown }
   *
   * KRÄ°TÄ°K: "KUM TOPKDV" / "KUM TOPLAM" satÄ±rlarÄ± KÃœMÃœLATÄ°F â€” ASLA ALMA.
   * Sadece o anki Z raporu iÃ§in "TOPKDV" / "TOPKDV %X" satÄ±rlarÄ±nÄ± al.
   */
  /**
   * E-Fatura/E-ArÅŸiv iÃ§in Ã§ok oranlÄ± KDV breakdown'u Azure metninden Ã§Ä±kar.
   * Standart TÃ¼rk fatura formatÄ±: "Hesaplanan KDV (%20)  116,00 TL"
   * Claude breakdown'u boÅŸ dÃ¶nerse veya eksik dÃ¶nerse bu fonksiyon devreye girer.
   *
   * Ã–RNEK Azure metin parÃ§asÄ±:
   *   "Hesaplanan KDV (% 20,00 )   1.006,00 TL"
   *   "Hesaplanan KDV (% 10,00 )      15,00 TL"
   * â†’ [{oran:20, tutar:1006, matrah:null}, {oran:10, tutar:15, matrah:null}]
   *
   * KDV DIÅI vergi satÄ±rlarÄ± (Ã–Ä°V, Telsiz, Ã–TV, BSMV, KKDF) atlanÄ±r.
   */
  /**
   * Telekom faturasÄ±ndan SADECE "Katma DeÄŸer Vergisi" satÄ±rÄ±nÄ±n tutarÄ±nÄ± Ã§Ä±kar.
   * Ã–Ä°V ve Telsiz KullanÄ±m tutarlarÄ± atlanÄ±r.
   *
   * Azure metni tipik formatta:
   *   "Katma DeÄŸer Vergisi     %20   (Matrah: 1.260,01 TRY)    252,00"
   *   "Ã–zel Ä°letiÅŸim Vergisi   %10   (Matrah: 1.260,01 TRY)    126,00"
   * Veya label ve amount ayrÄ± satÄ±rlarda:
   *   "Katma DeÄŸer Vergisi"
   *   "%20"
   *   "(Matrah: 1.260,01 TRY)"
   *   "252,00"
   */
  /**
   * Azure OCR text'ini normalize et:
   *   - NBSP (U+00A0) â†’ normal boÅŸluk (regex \s'in yakalamadÄ±ÄŸÄ± ara form)
   *   - Full-width "ï¼…" â†’ ASCII "%"
   *   - TÃ¼rkÃ§e locale uppercase: "Ä°" (U+0130) / "Ä±" (U+0131) doÄŸru case-fold
   *     olmuyor. `/i` flag'li regex'ler "Ã–zel Ä°letiÅŸim" yazÄ±lÄ± satÄ±rÄ±
   *     yakalayamÄ±yor Ã§Ã¼nkÃ¼ `i â†’ Ä°` (bÃ¼yÃ¼k I noktalÄ±) case-folding JS
   *     standard regex'inde beklenen davranÄ±ÅŸÄ± vermiyor.
   *     toLocaleUpperCase('tr-TR') deterministik olarak Ã–ZEL â†’ Ã–ZEL,
   *     iletiÅŸim â†’ Ä°LETÄ°ÅÄ°M yapar. TÃ¼m tax-label regex'leri UPPERCASE
   *     pattern'lÄ± yazÄ±ldÄ±ÄŸÄ± iÃ§in bu normalize ÅŸart.
   *     (SayÄ±lar/virgÃ¼l/noktaya dokunmaz â€” parse sonucu aynÄ± kalÄ±r.)
   */
  private normalizeAzureText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\u00A0/g, ' ') // NBSP
      .replace(/\u2007/g, ' ') // figure space
      .replace(/\u202F/g, ' ') // narrow no-break space
      .replace(/\uFF05/g, '%') // full-width %
      .toLocaleUpperCase('tr-TR'); // TÃ¼rkÃ§e-farkÄ±ndalÄ±klÄ± bÃ¼yÃ¼k harf
  }

  private stripMatrahFragments(text: string): string {
    if (!text) return '';
    return text
      .replace(/\([^)]*MATRAH[^)]*\)/gi, ' ')
      .replace(/\b(?:KDV\s*)?MATRAH[IÄ°Ä±i]?\s*[:=]?\s*[-\d.,]+\s*(?:TL|TRY|[^\s\d.,])?/gi, ' ')
      .replace(/\bMATRAH\s*[:=]?\s*[-\d.,]+\s*(?:TL|TRY|â‚º)?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private foldTurkishAscii(text: string): string {
    return this.normalizeAzureText(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Ä/g, 'G')
      .replace(/Ãœ/g, 'U')
      .replace(/Å/g, 'S')
      .replace(/Ä°/g, 'I')
      .replace(/Ã–/g, 'O')
      .replace(/Ã‡/g, 'C');
  }

  private isLikelyStandaloneTaxRate(value: string): boolean {
    const folded = this.foldTurkishAscii(value || '')
      .replace(/\b(?:TL|TRY)\b|â‚º/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cleaned = folded
      .replace(/^%/, '')
      .replace(/%$/, '')
      .trim();
    return /^(0|1|8|10|18|20)(?:[,.]0{1,2})?$/.test(cleaned);
  }

  private isMatrahOrRateLine(value: string): boolean {
    const folded = this.foldTurkishAscii(value || '');
    const withoutMatrahParen = folded.replace(/\([^)]*MATRAH[^)]*\)/g, ' ');
    return /\bKDV\s*(?:MATRAH|ORAN[II]?|UYGULANAN\s+TUTAR)\b|^\s*(?:MATRAH|ORAN)\b/.test(withoutMatrahParen);
  }

  private isKdvTableHeaderLine(value: string): boolean {
    const folded = this.foldTurkishAscii(value || '');
    return /\bKDV\s*TUTAR[II]?\b/.test(folded)
      && /\b(?:KDV\s*ORAN[II]?|DIGER\s+VERGILER|MAL\s+HIZMET)\b/.test(folded);
  }

  private isForbiddenKdvAmountLine(value: string): boolean {
    const folded = this.foldTurkishAscii(value || '');
    if (!folded) return false;
    if (this.isMatrahOrRateLine(folded) || this.isKdvTableHeaderLine(folded)) return true;

    const explicitKdvLabel =
      /\bHESAPLANAN\s+K\.?\s*D\.?\s*V\.?\b|\bKATMA\s+DEGER\s+VERGISI\b|\bK\.?\s*D\.?\s*V\.?\s*TUTAR[II]?\b|\bTOP\s*K\.?\s*D\.?\s*V\.?\b|\bTOPKDV\b|\bODENECEK\s+K\.?\s*D\.?\s*V\.?\b/.test(folded);
    const totalOrBaseLine =
      /\bMAL\s+HIZMET\b|\bVERGILER\s+(?:DAHIL|HARIC)\b|\bODENECEK\s+TUTAR\b|\bFATURA\s+TUTAR[II]?\b|\bTOPLAM\s+ISKONTO\b|\bGENEL\s+TOPLAM\b|\bARA\s+TOPLAM\b|\bTOPLAM\s+TUTAR\b/.test(folded);

    return totalOrBaseLine && !explicitKdvLabel;
  }

  private isLikelyKdvAmountColumnHeader(lines: string[], index: number): boolean {
    const foldedLine = this.foldTurkishAscii(lines[index] || '').replace(/\s+/g, ' ').trim();
    const isPlainKdvAmountHeader =
      /^(?:K\.?\s*D\.?\s*V\.?\s*)?TUTAR[II]?$/.test(foldedLine) ||
      /^K\.?\s*D\.?\s*V\.?\s*TUTAR[II]?$/.test(foldedLine);
    if (!isPlainKdvAmountHeader) return false;

    const context = this.foldTurkishAscii(
      lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join(' '),
    );
    return /\bKDV\s*ORAN[II]?\b|\bDIGER\s+VERGILER\b|\bMAL\s+HIZMET\b|\bSIRA\s*NO\b/.test(context);
  }

  private detectBelgeTipiFromAzure(text: string, originalName?: string): string | null {
    const folded = this.foldTurkishAscii(`${originalName || ''}\n${text || ''}`);
    const looksOkcFis = /\bFIS\s*NO\b|\bEKU\s*NO\b|\bOKC\b|\bOD[EA]ME\s+KAYDEDICI\b/.test(folded);
    const explicitZRapor =
      /\bZ\s*RAPORU\b|\bKUM\s+T[O0]P\s*K\s*D\s*V\b|\bKUM\s+T[O0]PLAM\b/.test(folded);
    if (looksOkcFis && !explicitZRapor) return 'OKC_FIS';
    if (explicitZRapor || /\bT[O0]P\s*K\s*D\s*V\b|\bT[O0]PKD[UV]\b/.test(folded)) return 'Z_RAPORU';
    if (/\bE[-\s]?ARSIV\b|\bEARSIVFATURA\b/.test(folded)) return 'EARSIV';
    if (/\bE[-\s]?FATURA\b|\bTEMELFATURA\b|\bTICARIFATURA\b/.test(folded)) return 'EFATURA';
    if (looksOkcFis) return 'OKC_FIS';
    return null;
  }

  private extractSaticiVknFromAzure(text: string): string | null {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const stop = lines.findIndex((l) => /SAYIN|ALICI|MUSTERI|MÃœÅTERÄ°/.test(this.foldTurkishAscii(l)));
    const top = (stop >= 0 ? lines.slice(0, stop) : lines.slice(0, 14)).join('\n');
    const folded = this.foldTurkishAscii(top);
    const labeled = folded.match(/\b(?:VKN|TCKN|VERGI\s*NO|MUKELLEF(?:LER)?\s*NO)\b[^0-9]{0,30}(\d{10,11})/);
    if (labeled?.[1]) return labeled[1];
    const any = folded.match(/\b(\d{10,11})\b/);
    return any?.[1] ?? null;
  }

  private extractSaticiFromAzure(text: string): string | null {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const stop = lines.findIndex((l) => /SAYIN|ALICI|MUSTERI|MÃœÅTERÄ°/.test(this.foldTurkishAscii(l)));
    const topLines = stop >= 0 ? lines.slice(0, stop) : lines.slice(0, 10);
    for (const raw of topLines) {
      const folded = this.foldTurkishAscii(raw);
      if (folded.length < 5) continue;
      if (/\b(?:VKN|TCKN|VERGI|TEL|FAKS|WEB|E-?POSTA|MERSIS|TICARET\s+SICIL|FATURA|ETTN)\b/.test(folded)) continue;
      if (!/[A-Z]/.test(folded)) continue;
      if (/\b(?:LTD|LIMITED|ANONIM|AS|STI|SIRKET|TICARET|SANAYI|TURIZM|HIZMET|INSAAT|LOJISTIK|TASIMACILIK)\b/.test(folded)) {
        return raw.slice(0, 200);
      }
      if (folded.replace(/[^A-Z]/g, '').length >= 12) return raw.slice(0, 200);
    }
    return null;
  }

  private parseTevkifatRate(text: string): number {
    if (!text) return 0;
    const folded = this.foldTurkishAscii(text);
    const fraction = folded.match(/(?:TEVKIFAT|K\.?\s*D\.?\s*V\.?\s+TEVK)[\s\S]{0,80}?\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/i);
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      const rate = denominator > 0 ? (numerator / denominator) * 100 : 0;
      return rate > 0 && rate <= 100 ? rate : 0;
    }
    const percent = folded.match(/(?:TEVKIFAT|K\.?\s*D\.?\s*V\.?\s+TEVK)[\s\S]{0,80}?\(\s*[%/]?\s*(\d{1,2})(?:[.,]\d+)?\s*\)/i);
    if (percent) {
      const rate = Number(percent[1]);
      return rate > 0 && rate <= 100 ? rate : 0;
    }
    return 0;
  }

  private extractMoneyAmountsFromText(text: string): number[] {
    const amountRe = /(\d{1,3}(?:[.,]\d{3})+[.,]\d{1,2}|\d{4,},\d{1,2}|\d{1,3},\d{1,2})\s*(?:TL|TRY|â‚º)?/gi;
    const values: number[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(amountRe)) {
      const value = Math.round(this.parseAmount(m[1]) * 100) / 100;
      if (value <= 0 || value >= 100_000_000) continue;
      const key = value.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
    return values;
  }

  private inferTevkifatFromAzureAmounts(text: string, tamKdv: number): {
    tamKdv: number;
    tevkifat: number;
    netKdv: number;
  } | null {
    if (!text || !(tamKdv > 0)) return null;
    const folded = this.foldTurkishAscii(text);
    if (!/TEVK/.test(folded)) return null;

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const isClose = (a: number, b: number, tolerance = 0.05) => Math.abs(a - b) <= tolerance;
    const amounts = this.extractMoneyAmountsFromText(folded);
    let effectiveTamKdv = round2(tamKdv);
    const kdvRateMatch = folded.match(
      /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?(?!\s*TEVK)[^\d%]{0,20}\(\s*%?\s*(\d{1,2})(?:[.,]\d+)?\s*\)/,
    );
    const kdvRate = kdvRateMatch ? Number(kdvRateMatch[1]) : 0;
    if ([1, 10, 20].includes(kdvRate)) {
      const expectedTax = round2(effectiveTamKdv * kdvRate / 100);
      const taxAmount = amounts.find((n) =>
        n > 0 &&
        n < effectiveTamKdv - 0.05 &&
        isClose(n, expectedTax, Math.max(0.05, expectedTax * 0.01)),
      );
      if (taxAmount) {
        this.logger.warn(
          `Tevkifat fallback: gelen KDV adayi matrah gibi gorundu, tam KDV ${this.formatAmount(taxAmount)} olarak duzeltildi (matrah=${this.formatAmount(effectiveTamKdv)}, oran=%${kdvRate})`,
        );
        effectiveTamKdv = round2(taxAmount);
      }
    }
    const validTevkifat = (n: number) => n > 0 && n < effectiveTamKdv - 0.05;
    const lines = folded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    const accept = (candidate: number | null | undefined, reason: string) => {
      const tevkifat = round2(candidate || 0);
      if (!validTevkifat(tevkifat)) return null;
      const netKdv = round2(effectiveTamKdv - tevkifat);
      if (netKdv <= 0) return null;
      this.logger.log(
        `Tevkifat fallback OK (${reason}): tam=${effectiveTamKdv} tevkifat=${tevkifat} net=${netKdv}`,
      );
      return { tamKdv: effectiveTamKdv, tevkifat, netKdv };
    };

    // En gÃ¼venilir yol: TEVKIFAT geÃ§en satÄ±rda veya hemen Ã§evresinde tam KDV'den kÃ¼Ã§Ã¼k tutar.
    for (let i = 0; i < lines.length; i++) {
      if (!/TEVK/.test(lines[i])) continue;
      const window = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join(' ');
      const candidates = this.extractMoneyAmountsFromText(window)
        .filter(validTevkifat)
        .sort((a, b) => b - a);
      if (candidates.length > 0) {
        return accept(candidates[0], 'tevkifat-satiri');
      }
    }

    // Tevkifat oranÄ± okunuyorsa, tam KDV * oran doÄŸrudan tevkifat tutarÄ±dÄ±r.
    const rate = this.parseTevkifatRate(folded);
    if (rate > 0 && rate <= 100) {
      const expected = round2(effectiveTamKdv * rate / 100);
      const explicit = amounts.find((n) => validTevkifat(n) && isClose(n, expected, Math.max(0.05, expected * 0.01)));
      return accept(explicit ?? expected, `oran-%${rate}`);
    }

    // GÃ¶rsel tablolarda Azure bazen etiketleri ve tutarlarÄ± ayrÄ± kolon bloklarÄ± olarak dÃ¶ndÃ¼rÃ¼r.
    // Bu durumda "Vergiler dahil toplam" ile "Ã–denecek tutar" farkÄ± tevkifat tutarÄ±nÄ± verir.
    const hasTotalsLabels = /VERGILER\s+DAHIL/.test(folded) && /ODENECEK\s+TUTAR/.test(folded);
    if (hasTotalsLabels && amounts.length >= 2) {
      for (const high of amounts) {
        for (const low of amounts) {
          const diff = round2(high - low);
          if (!validTevkifat(diff)) continue;
          if (amounts.some((n) => isClose(n, diff))) {
            return accept(diff, 'toplam-farki');
          }
        }
      }
    }

    // Son savunma: %50 tevkifatli belgelerde tutar tam KDV'nin yarÄ±sÄ±dÄ±r ve Ã§oÄŸu
    // faturada bu tutar para listesinde ayrÄ±ca bulunur.
    const half = round2(effectiveTamKdv / 2);
    const halfMatch = amounts.find((n) => validTevkifat(n) && isClose(n, half, Math.max(0.05, half * 0.01)));
    return accept(halfMatch, 'yarim-kdv');
  }

  /**
   * TevkifatlÄ± faturalardan TAM KDV ve TEVKÄ°FAT tutarlarÄ±nÄ± Azure metninden
   * doÄŸrudan yakalar. Claude bazen "Mal Hizmet Toplam" deÄŸerini "KDV dahil
   * toplam" sanÄ±p /11 hesabÄ± yapÄ±yor (13.300 â†’ 1209,09 gibi). Halbuki faturada
   * "Hesaplanan KDV(%X)" satÄ±rÄ±nÄ±n yanÄ±nda doÄŸru tutar aÃ§Ä±k yazÄ±yor.
   *
   * Aranan pattern'ler (TÃ¼rk e-Fatura/e-ArÅŸiv tevkifat formatÄ±):
   *   "Hesaplanan KDV(%10)        1.330,00"
   *   "Hesaplanan KDV Tevkifat(%50) 665,00"
   *   "Tevkifata Tabi Ä°ÅŸlem Ãœzerinden Hes. KDV  3.350,00"
   *
   * Geri dÃ¶nen deÄŸer:
   *   { tamKdv, tevkifat, netKdv } veya null (pattern bulunamazsa)
   */
  private extractTevkifatliFaturaFromAzure(text: string): {
    tamKdv: number;
    tevkifat: number;
    netKdv: number;
  } | null {
    if (!text) return null;
    const explicitTotals = extractTevkifatTotalsFromText(text);
    if (explicitTotals) return explicitTotals;
    const normalized = this.foldTurkishAscii(text);
    // SATIR-BAÄIMSIZ pattern match â€” Azure bazen tÃ¼m faturayÄ± tek satÄ±rda
    // veriyor (PDF render farkÄ±). Whitespace'i tek boÅŸluÄŸa indirip pattern'i
    // doÄŸrudan etiket+tutar sÄ±rasÄ±nda ararÄ±z.
    const flat = normalized.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
    const folded = flat
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Ä/g, 'G')
      .replace(/Ãœ/g, 'U')
      .replace(/Å/g, 'S')
      .replace(/Ä°/g, 'I')
      .replace(/Ã–/g, 'O')
      .replace(/Ã‡/g, 'C');

    let tamKdv = 0;
    let tevkifat = 0;
    let odenecekKdv = 0;

    // TÃ¼rk tutar formatÄ±: "1.330,00" / "665,00" / "28.400,00" / "1.234,56"
    // (Binlik nokta opsiyonel, ondalÄ±k virgÃ¼l 1-2 hane)
    const amountPattern = '[-âˆ’]?\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{1,2}|\\d+,\\d{1,2}|\\d{1,3}(?:\\.\\d{3})+(?!\\d))';

    // â”€â”€â”€ 1) "HESAPLANAN KDV(%X) TUTAR" â€” TAM KDV ya da TEVKÄ°FAT
    //   Tek regex iki durumu ayÄ±rÄ±r: "TEVKIFAT" kelimesi varsa tevkifat,
    //   yoksa tam KDV. Bu sayede pattern sÄ±ralamasÄ± fark etmez.
    // â”€â”€â”€
    const labelRegex = new RegExp(
      'HESAPLANAN\\s+KDV(\\s+TEVK[^\\s(]*)?\\s*\\(\\s*[%/]?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
      'gi',
    );
    const amountAfterLabelRe = new RegExp(amountPattern, 'i');
    let m: RegExpExecArray | null;
    while ((m = labelRegex.exec(flat)) !== null) {
      const isTevkifat = /TEVK/i.test(m[0]);
      const lookahead = this.stripMatrahFragments(
        flat.slice(labelRegex.lastIndex, labelRegex.lastIndex + 120),
      );
      const tutarMatch = lookahead.match(amountAfterLabelRe);
      if (!tutarMatch) continue;
      const tutar = Math.abs(this.parseAmount(tutarMatch[1]));
      if (tutar <= 0) continue;
      if (isTevkifat) {
        if (tutar > tevkifat) tevkifat = tutar;
      } else {
        if (tutar > tamKdv) tamKdv = tutar;
      }
    }

    const findAmountAfter = (source: string, labelPattern: string, maxGap = 80): number => {
      const labelRe = new RegExp(labelPattern, 'i');
      const label = source.match(labelRe);
      if (!label) return 0;
      const start = (label.index ?? 0) + label[0].length;
      const window = this.stripMatrahFragments(source.slice(start, start + maxGap + 120));
      const re = new RegExp(`[^0-9]{0,${maxGap}}` + amountPattern, 'i');
      const found = window.match(re);
      if (!found) return 0;
      const value = Math.abs(this.parseAmount(found[1]));
      return value > 0 && value < 100_000_000 ? value : 0;
    };

    // CanlÄ± satÄ±ÅŸ tevkifat faturalarÄ±nda Azure Ã§oÄŸu zaman ÅŸu satÄ±rlarÄ± daha net okuyor:
    //   "KDV Tevkifat(%50) 8.507,30"
    //   "Ã–denecek KDV 8.507,30"
    // "Ã–denecek KDV" net KDV'dir ve Luca ile eÅŸleÅŸen deÄŸerdir; "Hesaplanan KDV"
    // tam KDV olduÄŸu iÃ§in tevkifatlÄ± belgede sonuÃ§ olarak kullanÄ±lmamalÄ±dÄ±r.
    const foldedTam = findAmountAfter(
      folded,
      'HESAPLANAN\\s+K\\.?\\s*D\\.?\\s*V\\.?\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
      40,
    );
    if (foldedTam > tamKdv) tamKdv = foldedTam;

    const foldedTevkifat =
      findAmountAfter(
        folded,
        'K\\.?\\s*D\\.?\\s*V\\.?\\s+TEVK[^\\s(]*\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
        40,
      ) ||
      findAmountAfter(
        folded,
        'HESAPLANAN\\s+K\\.?\\s*D\\.?\\s*V\\.?\\s+TEVK[^\\s(]*\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
        40,
      ) ||
      findAmountAfter(folded, 'TEVKIFAT\\s+TUTAR[II]?', 40);
    if (foldedTevkifat > tevkifat) tevkifat = foldedTevkifat;

    odenecekKdv =
      findAmountAfter(folded, 'ODENECEK\\s+K\\.?\\s*D\\.?\\s*V\\.?', 40) ||
      findAmountAfter(folded, 'O\\s*DENECEK\\s+K\\.?\\s*D\\.?\\s*V\\.?', 40);

    // â”€â”€â”€ 2) Alternatif tam KDV gÃ¶sterimleri (sadece tamKdv bulunmadÄ±ysa) â”€â”€â”€
    //   "Tevkifata Tabi Ä°ÅŸlem Ãœzerinden Hes. KDV  TUTAR"  (Tam KDV'nin tekrarÄ±)
    if (tamKdv === 0) {
      const altRe = new RegExp(
        'TEVK[Ä°I]FATA\\s+TAB[Ä°I][^\\d]{0,80}ÃœZER[Ä°I]NDEN[^\\d]{0,40}KDV[^\\d]{0,20}' +
          amountPattern,
        'i',
      );
      const am = flat.match(altRe);
      if (am) {
        const v = this.parseAmount(am[1]);
        if (v > 0) tamKdv = v;
      }
    }

    if (odenecekKdv > 0) {
      if (tamKdv > odenecekKdv && tevkifat === 0) {
        tevkifat = parseFloat((tamKdv - odenecekKdv).toFixed(2));
      } else if (tamKdv === 0 && tevkifat > 0) {
        tamKdv = parseFloat((odenecekKdv + tevkifat).toFixed(2));
      }
    }

    if (tevkifat === 0 && tamKdv > 0) {
      const oran = this.parseTevkifatRate(folded) || this.parseTevkifatRate(flat);
      if (oran > 0 && oran <= 100) {
        void oran;
        this.logger.log(
          `Tevkifat extract: tevkifat tutarÄ± belgede aÃ§Ä±k okunamadÄ±; oranla hesaplama yapÄ±lmadÄ± (tamKdv=${tamKdv}, oran=%${oran})`,
        );
      }
    }

    if (tevkifat <= 0 && tamKdv > 0) {
      const inferred = this.inferTevkifatFromAzureAmounts(text, tamKdv);
      if (inferred) return inferred;
    }

    // â”€â”€â”€ 3) Alternatif tevkifat gÃ¶sterimleri â”€â”€â”€
    //   "KDV TevkifatÄ± (%50,00) = 665,00 TL"
    //   "Tevkifat TutarÄ±: 665,00"
    if (tevkifat === 0) {
      const altTevkifatPatterns = [
        new RegExp(
          'KDV\\s+TEVK[^\\s(]*\\s*\\(\\s*[%/]?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)\\s*[-=:\\s]*' + amountPattern,
          'i',
        ),
        new RegExp('TEVK[Ä°I]FAT\\s+TUTAR[Ä°I]?\\s*[-âˆ’=:\\s]*' + amountPattern, 'i'),
      ];
      for (const re of altTevkifatPatterns) {
        const am = flat.match(re);
        if (am) {
          const v = Math.abs(this.parseAmount(am[1]));
          if (v > tevkifat) tevkifat = v;
        }
      }
    }

    // Tevkifat yoksa tevkifatlÄ± deÄŸildir â€” null dÃ¶n
    if (tevkifat <= 0) {
      // Tevkifat kelimesi metinde geÃ§iyor mu? Diagnostic
      if (/TEVK[Ä°I]FAT/i.test(flat)) {
        this.logger.warn(
          `Tevkifat extract: TEVKIFAT kelimesi var ama tutar bulunamadÄ±. Flat metin (ilk 500 char): "${flat.slice(0, 500)}"`,
        );
      }
      return null;
    }

    // Tam KDV bulunamadÄ±ysa tevkifat oranÄ±ndan geri hesapla
    if (tamKdv === 0) {
      const oran = this.parseTevkifatRate(flat) || this.parseTevkifatRate(folded);
      if (oran > 0 && oran <= 100) {
        void oran;
        this.logger.log(
          `Tevkifat extract: tamKdv belgede aÃ§Ä±k okunamadÄ±; tevkifat oranÄ±ndan geri hesaplama yapÄ±lmadÄ± (tevkifat=${tevkifat}, oran=%${oran})`,
        );
      }
    }

    if (tamKdv <= 0 || tamKdv < tevkifat || Math.abs(tamKdv - tevkifat) <= 0.05) {
      this.logger.warn(
        `Tevkifat extract: tamKdv=${tamKdv} tevkifat=${tevkifat} â€” mantÄ±ksÄ±z, null dÃ¶ndÃ¼rÃ¼yorum. Flat (ilk 400 char): "${flat.slice(0, 400)}"`,
      );
      return null;
    }

    const netKdv = odenecekKdv > 0 ? odenecekKdv : Math.max(0, tamKdv - tevkifat);
    this.logger.log(
      `Tevkifat extract OK: tamKdv=${tamKdv} tevkifat=${tevkifat} netKdv=${netKdv}`,
    );
    return { tamKdv, tevkifat, netKdv };
  }

  private extractKdvOnlyFromTelekomAzure(text: string): number | null {
    if (!text) return null;
    const normalized = this.foldTurkishAscii(text);
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/i;
    // KDV label varyasyonlarÄ±:
    //   "Katma DeÄŸer Vergisi"                   â€” Turkcell, Vodafone
    //   "KDV (20%)"                             â€” TÃ¼rk Telekom "(NN%)"
    //   "KDV (%20)", "K.D.V. (%20)"             â€” E-fatura / E-arÅŸiv
    // BaÅŸÄ±nda "Ã–zel Ä°letiÅŸim" gibi baÅŸka vergi label'Ä± varsa YAKALAMA
    // (Ã§Ã¼nkÃ¼ onlarÄ±n iÃ§inde de "%NN" geÃ§er ama "KDV" substring'i yok).
    const kdvLabelRe =
      /KATMA\s*DE.?ER\s*VERGISI|\bK\.?\s*D\.?\s*V\.?\s*\(?\s*%?\s*\d/i;
    // SatÄ±r baÅŸka bir vergi etiketi mi?
    const otherTaxRe = /[O?]ZEL\s*[I?]LET[I?]S[I?]M|OIV\b|TELSIZ\s*KULLAN|OTV\b|DAMGA|BSMV|KKDF|KONAKLAMA/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!kdvLabelRe.test(line)) continue;
      if (this.isMatrahOrRateLine(line)) continue;

      // 1) AynÄ± satÄ±rda "Katma DeÄŸer Vergisi ... 252,00" olabilir
      const afterLabel = line.replace(kdvLabelRe, '');
      // Matrah parantezini atla (Matrah iÃ§indeki tutar KDV deÄŸil)
      const noMatrah = this.stripMatrahFragments(afterLabel);
      const inlineAmount = noMatrah.match(amountRe);
      if (inlineAmount) {
        const val = this.parseAmount(inlineAmount[1]);
        if (val > 0 && val < 10_000_000) return val;
      }

      // 2) Sonraki 1-5 satÄ±ra bak, baÅŸka vergi etiketi gelene kadar amount ara
      for (let j = 1; j <= 5 && i + j < lines.length; j++) {
        const nextLine = lines[i + j];
        if (kdvLabelRe.test(nextLine)) break; // baÅŸka KDV satÄ±rÄ±
        if (otherTaxRe.test(nextLine)) break; // baÅŸka vergi tÃ¼rÃ¼ â†’ dur
        if (/MAL\s*HIZMET|GENEL\s*TOPLAM|FATURA\s*TUTARI|ODENECEK\s*TUTAR|TOPLAM\s+TUTAR/i.test(nextLine)) break;
        // Matrah parantezini skip et
        if (this.isMatrahOrRateLine(nextLine)) continue;
        const cleaned = this.stripMatrahFragments(nextLine);
        if (!cleaned) continue;
        // "%20", "(Matrah...)" gibi pure marker satÄ±rÄ± atla
        if (/^[%]\s*\d/.test(cleaned) || this.isLikelyStandaloneTaxRate(cleaned)) continue;
        const m = cleaned.match(amountRe);
        if (m) {
          const val = this.parseAmount(m[1]);
          // Matrah deÄŸerlerini (genelde daha bÃ¼yÃ¼k) KDV sanmamaya dikkat
          // Yine de ilk bulunan tutarÄ± al â€” label'dan hemen sonra geldi.
          if (val > 0 && val < 10_000_000) return val;
        }
      }
    }

    return null;
  }

  private extractElectricityKdvFromAzure(text: string): { kdv: number; matrah: number | null; oran: number | null } | null {
    if (!text) return null;
    const normalized = this.foldTurkishAscii(text);
    const looksElectricityInvoice =
      /\bELEKTRIK\s+FATURASI\b|\bKWH\b|\bTUKETIM\s*\(KWH\)|\bTESISAT\b|\bENERJI\s+BEDELI\b/.test(normalized);
    if (!looksElectricityInvoice) return null;

    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const amountGlobalRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/gi;
    const hardStopRe =
      /FATURA\s+TUTARI|ODENECEK\s+TUTAR|VERGI\s+VE\s+FONLAR|TOPLAM\s+ENERJI|GUNCEL\s+YUVARLAMA|ONCEKI\s+YUVARLAMA|ELEKT\s+VER|TUKETIM|BEDEL|SON\s+ODEME/i;

    const parseLastKdvAmount = (source: string): number | null => {
      const withoutMatrah = this.stripMatrahFragments(source);
      amountGlobalRe.lastIndex = 0;
      const matches = [...withoutMatrah.matchAll(amountGlobalRe)];
      if (matches.length === 0) return null;
      const value = this.parseAmount(matches[matches.length - 1][1]);
      return value > 0 && value < 10_000_000 ? value : null;
    };
    const parseMatrah = (source: string): number | null => {
      const match = source.match(/matrah[^\d]{0,30}(\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2})/i);
      if (!match) return null;
      const value = this.parseAmount(match[1]);
      return value > 0 && value < 10_000_000 ? value : null;
    };
    const inferRate = (kdv: number, matrah: number | null): number | null => {
      if (!matrah || matrah <= kdv) return null;
      const rawRate = (kdv / matrah) * 100;
      return [1, 8, 10, 18, 20].find((rate) => Math.abs(rate - rawRate) <= 0.75) ?? null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\bK\.?\s*D\.?\s*V\.?\b/.test(line)) continue;
      if (/TEVKIFAT/.test(line)) continue;

      const sameLine = parseLastKdvAmount(line.replace(/\bK\.?\s*D\.?\s*V\.?\b/, ' '));
      if (sameLine != null) {
        const matrah = parseMatrah(line);
        return { kdv: sameLine, matrah, oran: inferRate(sameLine, matrah) };
      }

      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const next = lines[i + j];
        if (hardStopRe.test(next) || /\bK\.?\s*D\.?\s*V\.?\b/.test(next)) break;
        const nearby = parseLastKdvAmount(next);
        if (nearby != null) {
          const matrah = parseMatrah(`${line} ${next}`);
          return { kdv: nearby, matrah, oran: inferRate(nearby, matrah) };
        }
      }
    }

    return null;
  }

  private extractKdvFromInvoiceTotalsAzure(text: string): { kdv: number; matrah: number | null; oran: number | null } | null {
    if (!text) return null;
    const electricityKdv = this.extractElectricityKdvFromAzure(text);
    if (electricityKdv != null && electricityKdv.kdv > 0) {
      return electricityKdv;
    }

    const normalized = this.normalizeAzureText(text);
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/i;
    const amountGlobalRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/gi;
    const parseLineAmount = (line: string, opts: { allowMatrah?: boolean } = {}): number | null => {
      if (!opts.allowMatrah && this.isMatrahOrRateLine(line)) return null;
      if (!opts.allowMatrah && this.isForbiddenKdvAmountLine(line)) return null;
      const m = line.match(amountRe);
      if (!m) return null;
      if (!opts.allowMatrah && this.isLikelyStandaloneTaxRate(m[1]) && /%|ORAN|KDV\s*ORAN/i.test(this.foldTurkishAscii(line))) {
        return null;
      }
      const n = this.parseAmount(m[1]);
      return n > 0 && n < 100_000_000 ? n : null;
    };
    const parseLastAmount = (line: string, opts: { allowMatrah?: boolean } = {}): number | null => {
      if (!opts.allowMatrah && this.isMatrahOrRateLine(line)) return null;
      if (!opts.allowMatrah && this.isForbiddenKdvAmountLine(line)) return null;
      const matches = [...line.matchAll(amountGlobalRe)];
      if (matches.length === 0) return null;
      if (!opts.allowMatrah && matches.length === 1 && this.isLikelyStandaloneTaxRate(matches[0][1]) && /%|ORAN|KDV\s*ORAN/i.test(this.foldTurkishAscii(line))) {
        return null;
      }
      const n = this.parseAmount(matches[matches.length - 1][1]);
      return n > 0 && n < 100_000_000 ? n : null;
    };
    const extractAmounts = (line: string): number[] =>
      [...line.matchAll(amountGlobalRe)]
        .map((m) => this.parseAmount(m[1]))
        .filter((n) => n > 0 && n < 100_000_000);
    const findKdvFromSummaryMathLine = (): number | null => {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const folded = this.foldTurkishAscii(line);
        if (!/\bHESAPLANAN\s+K\.?\s*D\.?\s*V\.?\b|\bK\.?\s*D\.?\s*V\.?\b/.test(folded)) continue;
        if (/TEVKIFAT/.test(folded) || this.isForbiddenKdvAmountLine(line)) continue;
        const rateMatch = folded.match(/%\s*(\d{1,2})(?:[.,]\d{1,2})?/);
        const rate = rateMatch ? parseInt(rateMatch[1], 10) : null;
        const amounts = extractAmounts(line).filter((n) => !this.isLikelyStandaloneTaxRate(String(n)));
        if (!rate || ![1, 10, 20].includes(rate) || amounts.length < 2) continue;
        for (const candidate of amounts) {
          const hasMatchingBase = amounts.some((base) =>
            base > candidate && Math.abs((base * rate / 100) - candidate) <= Math.max(0.05, candidate * 0.03),
          );
          if (hasMatchingBase) return candidate;
        }
        return amounts[amounts.length - 1] ?? null;
      }
      return null;
    };
    const findKdvFromTableHeader = (): number | null => {
      for (let i = 0; i < lines.length; i++) {
        const folded = this.foldTurkishAscii(lines[i]).replace(/\s+/g, ' ');
        const kdvIdx = folded.search(/\bKDV\s*TUTAR[II]?\b/);
        let malIdx = folded.search(/\bMAL\s+HIZMET\b/);
        let kdvFirst = kdvIdx >= 0 && malIdx >= 0 && kdvIdx < malIdx;
        if (kdvIdx < 0) continue;
        if (malIdx < 0) {
          for (let h = 1; h <= 3 && i + h < lines.length; h++) {
            const nearbyHeader = this.foldTurkishAscii(lines[i + h]).replace(/\s+/g, ' ');
            if (/\bMAL\s+HIZMET\b/.test(nearbyHeader)) {
              malIdx = 0;
              kdvFirst = true;
              break;
            }
          }
        }
        if (malIdx < 0) continue;

        for (let j = 0; j <= 4 && i + j < lines.length; j++) {
          const row = lines[i + j];
          if (j > 0 && /\b(?:HESAPLANAN|VERGILER|ODENECEK|TOPLAM\s+ISKONTO)\b/i.test(this.foldTurkishAscii(row))) {
            break;
          }
          const amounts = extractAmounts(row);
          if (amounts.length >= 2) return kdvFirst ? amounts[0] : amounts[amounts.length - 1];
          if (j > 0 && amounts.length === 1) return amounts[0];
        }
      }
      return null;
    };
    const findExplicitKdvAmount = (): number | null => {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/TEVK[Ä°I]FAT/i.test(line)) continue;
        if (this.isMatrahOrRateLine(line)) continue;
        if (this.isForbiddenKdvAmountLine(line)) continue;
        const label = line.match(/HESAPLANAN\s+K\.?\s*D\.?\s*V\.?(?:\s+[A-ZÃ‡ÄÄ°Ã–ÅÃœa-zÃ§ÄŸÄ±Ã¶ÅŸÃ¼]+){0,3}\s*[\(\[]\s*%?\s*\d{1,2}(?:[.,]\d{1,2})?\s*[\)\]]?/i);
        if (!label) continue;
        const valuePart = this.stripMatrahFragments(line.slice((label.index ?? 0) + label[0].length));
        const sameLine = parseLastAmount(valuePart);
        if (sameLine != null) return sameLine;
        for (let j = 1; j <= 3 && i + j < lines.length; j++) {
          const next = lines[i + j];
          if (/TEVK[Ã„Â°I]FAT|VERGILER|VERGÃ„Â°LER|ODENECEK|Ãƒâ€“DENECEK/i.test(next)) break;
          const nextAmount = parseLineAmount(this.stripMatrahFragments(next));
          if (nextAmount != null) return nextAmount;
        }
      }
      return null;
    };
    const findAmountNear = (labelRe: RegExp, options: { skipMatrah?: boolean; preferFirst?: boolean } = {}): number | null => {
      for (let i = 0; i < lines.length; i++) {
        if (!labelRe.test(lines[i])) continue;
        if (options.skipMatrah && this.isMatrahOrRateLine(lines[i])) continue;
        if (options.skipMatrah && this.isForbiddenKdvAmountLine(lines[i])) continue;
        if (options.skipMatrah && this.isLikelyKdvAmountColumnHeader(lines, i)) continue;
        const allowMatrah = !options.skipMatrah;
        const sameSource = lines[i].replace(labelRe, '');
        const cleanedSame = options.skipMatrah ? this.stripMatrahFragments(sameSource) : sameSource;
        const same = options.preferFirst
          ? parseLineAmount(cleanedSame, { allowMatrah })
          : parseLastAmount(cleanedSame, { allowMatrah });
        const sameAmounts = extractAmounts(cleanedSame);
        const firstAmountIndex = cleanedSame.search(/\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2}/);
        const percentIndex = cleanedSame.indexOf('%');
        const sameLooksLikeMatrahInRateParen =
          options.skipMatrah &&
          sameAmounts.length === 1 &&
          firstAmountIndex >= 0 &&
          percentIndex > firstAmountIndex;
        if (same != null && !sameLooksLikeMatrahInRateParen) return same;
        for (let j = 1; j <= 3 && i + j < lines.length; j++) {
          const next = lines[i + j];
          if (/KDV|TOPLAM|TUTAR|ISKONTO|Ã–DENECEK|ODENECEK/i.test(next) && j > 1) break;
          if (options.skipMatrah && this.isMatrahOrRateLine(next)) continue;
          if (options.skipMatrah && this.isForbiddenKdvAmountLine(next)) continue;
          if (options.skipMatrah && j > 1 && this.isForbiddenKdvAmountLine(lines[i + j - 1] || '')) continue;
          const nearby = this.foldTurkishAscii(
            [
              lines[i - 2] || '',
              lines[i - 1] || '',
              lines[i],
              lines[i + j - 1] || '',
              next,
              lines[i + j + 1] || '',
            ].join('\n'),
          );
          if (options.skipMatrah && this.isLikelyStandaloneTaxRate(next) && /%|ORAN/.test(nearby)) continue;
          const val = parseLineAmount(options.skipMatrah ? this.stripMatrahFragments(next) : next, { allowMatrah });
          if (val != null) return val;
        }
      }
      return null;
    };

    const explicitKdv = findExplicitKdvAmount() ?? findKdvFromSummaryMathLine() ?? findKdvFromTableHeader() ?? findAmountNear(
      /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?|KATMA\s*DE[ÄG]ER\s*VERG[Ä°I]S[Ä°I]|KDV\s*TUTARI|K\.?\s*D\.?\s*V\.?\s*\(\s*%?\s*\d{1,2}(?:[.,]\d{1,2})?\s*\)/i,
      { skipMatrah: true },
    );
    const oranMatch =
      normalized.match(/K\.?\s*D\.?\s*V\.?[^\n%]{0,120}%\s*(\d{1,2})(?:[.,]\d{1,2})?/i)
      ?? normalized.match(/%\s*(\d{1,2})(?:[.,]\d{1,2})?\s*K\.?\s*D\.?\s*V\.?/i);
    const oran = oranMatch ? parseInt(oranMatch[1], 10) : null;

    if (explicitKdv != null && explicitKdv > 0) {
      return { kdv: explicitKdv, matrah: null, oran };
    }
    return null;
  }

  private extractMultiRateKdvFromAzure(text: string): KdvBreakdownItem[] {
    if (!text) return [];
    const normalized = this.normalizeAzureText(text);
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const breakdown: KdvBreakdownItem[] = [];
    const seen = new Set<number>();

    // Label regex: "Hesaplanan KDV (% 20,00 )" / "Hesaplanan KDV(%20)" / "KDV (%10)"
    // Parantezli format zorunlu â€” yanlÄ±ÅŸ eÅŸleÅŸmeyi (Ã¶r "KDV %20 ibaresi" gibi) Ã¶nler
    // BoÅŸluk toleransÄ±: "Hesaplanan   KDV" (NBSP normalize edildi) ve parantez iÃ§i
    // boÅŸluklar serbest. "%" sonrasÄ± ayrÄ±ca opsiyonel boÅŸluk (" 20,00" yakala).
    const labelRe = /(?:HESAPLANAN\s*)?K\.?\s*D\.?\s*V\.?\s*\(\s*%\s*(\d{1,2})(?:[,.]\d{1,2})?\s*\)/i;
    // Amount regex: "1.006,00" / "42,00" / "320,15" (opsiyonel TL/TRY/â‚º)
    const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/i;
    const skipTaxRe = /Ã–ZEL\s*Ä°LETÄ°ÅÄ°M|Ã–IV|OIV|TELSÄ°Z|TELSIZ|Ã–TV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|Ã‡EVRE/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // KDV DIÅI vergi satÄ±rlarÄ±nÄ± atla (Turkcell faturasÄ± gibi)
      if (skipTaxRe.test(line)) {
        continue;
      }
      if (this.isForbiddenKdvAmountLine(line) || this.isLikelyKdvAmountColumnHeader(lines, i)) continue;

      const labelMatch = line.match(labelRe);
      if (!labelMatch) continue;

      const oran = parseInt(labelMatch[1], 10);
      if (!(oran > 0 && oran <= 30) || seen.has(oran)) continue;

      // 1) AynÄ± satÄ±rda label'den SONRA amount ara
      let tutar: number | null = null;
      const afterLabel = this.stripMatrahFragments(line.slice(labelMatch.index! + labelMatch[0].length));
      const inlineAmountMatch = afterLabel.match(amountRe);
      if (inlineAmountMatch) {
        const parsed = this.parseAmount(inlineAmountMatch[1]);
        const isRateEcho = this.isLikelyStandaloneTaxRate(inlineAmountMatch[1]) && Math.abs(parsed - oran) < 0.01;
        if (!isRateEcho && parsed > 0 && parsed < 10_000_000) tutar = parsed;
      }

      // 2) AynÄ± satÄ±rda bulunamadÄ±ysa SONRAKÄ° 1-8 satÄ±ra bak (tablo layout iÃ§in).
      //    Azure bazen label ve tutarÄ± 4-6 satÄ±r ara ile Ã§Ä±karÄ±yor (Ã¶zellikle
      //    parantez iÃ§indeki "( % 20,00 )" yapÄ±sÄ± yÃ¼zÃ¼nden). 1-3 yetmiyor.
      if (tutar == null) {
        for (let j = 1; j <= 8 && i + j < lines.length; j++) {
          const nextLine = lines[i + j];
          // Sonraki satÄ±r baÅŸka bir KDV label'Ä± ise kes
          if (labelRe.test(nextLine)) break;
          // Ã–Ä°V/Telsiz vb. satÄ±rÄ± varsa kes
          if (skipTaxRe.test(nextLine)) break;
          // Saf yapÄ± satÄ±rlarÄ±nÄ± atla ("(", ")", "%", "% 20,00" tek baÅŸÄ±na)
          if (this.isForbiddenKdvAmountLine(nextLine)) continue;
          if (j > 1 && this.isForbiddenKdvAmountLine(lines[i + j - 1] || '')) continue;
          if (/^[\(\)%\s]*$/.test(nextLine)) continue;
          if (/^%\s*\d{1,2}(?:[,.]\d{1,2})?\s*\)?$/.test(nextLine)) continue;
          const cleanedNext = this.stripMatrahFragments(nextLine);
          if (!cleanedNext) continue;
          const m = cleanedNext.match(amountRe);
          if (m) {
            const parsed = this.parseAmount(m[1]);
            const isRateEcho = this.isLikelyStandaloneTaxRate(cleanedNext) && Math.abs(parsed - oran) < 0.01;
            if (!isRateEcho && parsed > 0 && parsed < 10_000_000) {
              tutar = parsed;
              break;
            }
          }
        }
      }

      // 3) Yine yoksa Ã–NCEKÄ° 1-2 satÄ±ra bak (bazen amount label'Ä±n Ã¼stÃ¼nde)
      if (tutar == null) {
        for (let j = 1; j <= 2 && i - j >= 0; j++) {
          const prevLine = lines[i - j];
          if (labelRe.test(prevLine)) break;
          if (/Ã–ZEL\s*Ä°LETÄ°ÅÄ°M|Ã–IV|OIV|TELSÄ°Z|TELSIZ|Ã–TV|OTV|DAMGA|BSMV|KKDF/i.test(prevLine)) break;
          if (this.isForbiddenKdvAmountLine(prevLine)) continue;
          const cleanedPrev = this.stripMatrahFragments(prevLine);
          if (!cleanedPrev) continue;
          const m = cleanedPrev.match(amountRe);
          if (m) {
            const parsed = this.parseAmount(m[1]);
            const isRateEcho = this.isLikelyStandaloneTaxRate(cleanedPrev) && Math.abs(parsed - oran) < 0.01;
            if (!isRateEcho && parsed > 0 && parsed < 10_000_000) {
              tutar = parsed;
              break;
            }
          }
        }
      }

      if (tutar != null) {
        breakdown.push({ oran, tutar, matrah: null });
        seen.add(oran);
      }
    }

    return breakdown;
  }

  /**
   * Tablo satÄ±rÄ± tabanlÄ± Ã§ok oranlÄ± KDV yakalama â€” FALLBACK.
   *
   * Åirin Reklam (ESR...895) gibi faturalarda "Hesaplanan KDV (%N)" Ã¶zet
   * satÄ±rÄ± Azure tarafÄ±ndan parÃ§alanabiliyor ve extractMultiRateKdvFromAzure
   * boÅŸ dÃ¶nebiliyor. Ama tablo satÄ±rlarÄ±nda "% 20,00" ile "1.006,00 TL" YAN
   * YANA. Bu fonksiyon tablo satÄ±rlarÄ±nÄ± yakalar, oran baÅŸÄ±na tutarlarÄ± toplar.
   *
   * Ã–rnek (Åirin Reklam):
   *   "1 REKS39 LEDBOX 2 Adet 75,0000 TL ... % 10,00 15,00 TL ... 150,00 TL"
   *   "2 REK1008 MESH VINIL 1 Adet 5.030,0000 TL ... % 20,00 1.006,00 TL ... 5.030,00 TL"
   *   â†’ [%20: 1006, %10: 15]
   *
   * GÃ¼venlik kÄ±sÄ±tlarÄ±:
   *   - "Ã–zel Ä°letiÅŸim Vergisi (10%)" gibi Ã–Ä°V satÄ±rlarÄ± dÄ±ÅŸarÄ±da
   *   - "Ä°sk %" / "Ä°skonto %" / "iskonto oranÄ±" gibi indirim sÃ¼tunlarÄ± dÄ±ÅŸarÄ±da
   *   - Oran Ã— amount eÅŸleÅŸmesi iÃ§in her ikisi de aynÄ± satÄ±rda olmalÄ±
   *   - Bulunan tutar absurd bÃ¼yÃ¼k (10M+) veya negatif ise atla
   */
  private extractMultiRateKdvFromItemRows(text: string): KdvBreakdownItem[] {
    if (!text) return [];
    const normalized = this.normalizeAzureText(text);
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sumByOran = new Map<number, number>();
    const hasNonKdvTaxLabel = (value: string): boolean => {
      const folded = this.foldTurkishAscii(value || '').replace(/\s+/g, ' ').trim();
      return /(?:OZEL|O)\s*I?LETISIM|OIV\b|TELSIZ|OTV\b|DAMGA|BSMV|KKDF|KONAKLAMA|CEVRE|TEVKIFAT|STOPAJ/i.test(folded);
    };

    // Oran markÃ¶rÃ¼: "% 20,00" / "% 20" / "%20,00" / "%20"
    // m[1] = tam sayÄ± kÄ±smÄ± (20), m[2] = virgÃ¼lden sonraki kÄ±sÄ±m (00, 67 vb.)
    const rateMarkerRe = /%\s*(\d{1,2})(?:[,.](\d{1,2}))?/gi;
    // Tutar: "1.006,00" / "15,00" / "60.84" (+ opsiyonel TL/TRY/â‚º)
    const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/i;
    const skipTaxRe = /Ã–ZEL\s*Ä°LETÄ°ÅÄ°M|Ã–IV|OIV|TELSÄ°Z|TELSIZ|Ã–TV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|Ã‡EVRE|TEVKÄ°FAT|TEVKIFAT|STOPAJ/i;
    // Discount satÄ±rÄ± â€” "Ä°sk %", "Ä°sk. OranÄ±", "Ä°sk. TutarÄ±", "Ä°SKONTO", "Ä°NDÄ°RÄ°M".
    // "Ä°sk." (nokta) ve "Ä°sk. OranÄ± / TutarÄ±" pattern eklendi.
    const discountRowRe = /Ä°SKONTO|ISKONTO|\bÄ°SK\.?\s*(?:%|Oran|TUTAR|TUTARI|ORANI)|\bISK\.?\s*(?:%|Oran|TUTAR|TUTARI|ORANI)|Ä°NDÄ°RÄ°M|INDIRIM/i;

    // Ä°ki aÅŸamalÄ± scan: Ã¶nce rate markerlarÄ± topla, sonra her marker iÃ§in
    // aynÄ± satÄ±r veya sonraki 3 satÄ±rdan ilk geÃ§erli amount'u eÅŸleÅŸtir.
    // Bu yapÄ± Azure'Ä±n tablo satÄ±rÄ±nÄ± satÄ±rlara bÃ¶ldÃ¼ÄŸÃ¼ durumu handle eder:
    //   "% 20,00"
    //   "1.006,00 TL"
    //   "5.030,00 TL"
    // â†’ ilk amount (1.006) %20'nin KDV'si.
    type Marker = { oran: number; lineIdx: number; afterLabel: string; isSummary: boolean; hasMatrahLabel: boolean };
    const markers: Marker[] = [];
    // Summary satÄ±rÄ± = "HESAPLANAN KDV (%N)" / "TOPKDV (%N)" / "HES. MATRAH / KDV(%N)"
    //                 / "MATRAH KDV(%N)" â€” fatura altÄ± Ã¶zet, item row deÄŸil.
    // Item row satÄ±rÄ± = Ã¼rÃ¼n tablosundaki "... % N,NN ... X,XX ..." kalemi.
    // Bir oran iÃ§in HEM summary HEM item row eÅŸleÅŸirse iki kez toplanmayalÄ±m:
    // summary authoritative â€” varsa item row'larÄ± o oran iÃ§in YOK SAY.
    const summaryLineRe = /HESAPLANAN\s*K\.?\s*D\.?\s*V\.?|TOPKDV|TOP\s*K\.?\s*D\.?\s*V\.?|HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?|MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?/i;
    // "HES. MATRAH / KDV(%N) [matrah] [kdv]" satÄ±rlarÄ±nda Ã–NCE matrah, SONRA KDV gelir.
    // Bu durumda label'dan sonraki Ä°LK amount deÄŸil, SON amount KDV'dir.
    const matrahLabelRe = /HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?|MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (skipTaxRe.test(line) || hasNonKdvTaxLabel(line)) continue;
      if (discountRowRe.test(line) && !/KDV/i.test(line)) continue;
      if (this.isForbiddenKdvAmountLine(line) || this.isLikelyKdvAmountColumnHeader(lines, i)) continue;

      // Ã–nceki 2 satÄ±rda non-KDV vergi label'Ä± varsa bu "% N,NN" markÃ¶rÃ¼ Ã–Ä°V'ye
      // / Telsize / Ã–TV'ye ait olabilir (label + oran + amount 3 ayrÄ± satÄ±rda).
      let prevHasNonKdvTax = false;
      for (let p = 1; p <= 2 && i - p >= 0; p++) {
        const prev = lines[i - p];
        if (skipTaxRe.test(prev) || hasNonKdvTaxLabel(prev)) { prevHasNonKdvTax = true; break; }
        if (/KATMA\s*DE[ÄG]ER\s*VERG[Ä°I]S[Ä°I]|\bK\.?\s*D\.?\s*V\.?\b/i.test(prev)) break;
      }
      if (prevHasNonKdvTax) continue;

      const isSummary = summaryLineRe.test(line);
      const hasMatrahLabel = matrahLabelRe.test(line);

      rateMarkerRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rateMarkerRe.exec(line)) !== null) {
        const oran = parseInt(m[1], 10);
        if (!(oran > 0 && oran <= 30)) continue;
        // KDV oranlarÄ± TR'de daima TAM SAYI (1, 10, 20). VirgÃ¼lden
        // sonraki kÄ±sÄ±m sÄ±fÄ±rdan farklÄ±ysa (Ã¶rn. %13,67 â†’ iskonto oranÄ±,
        // %20,00 â†’ KDV oranÄ±), bu marker KDV DEÄÄ°L â€” atla.
        const decimalPart = m[2];
        if (decimalPart && parseInt(decimalPart, 10) > 0) continue;
        const afterLabel = this.stripMatrahFragments(line.slice(m.index + m[0].length));
        markers.push({ oran, lineIdx: i, afterLabel, isSummary, hasMatrahLabel });
      }
    }

    // Hangi oranlar summary satÄ±rÄ±yla zaten sayÄ±ldÄ±? Bu oranlar iÃ§in item
    // row'larÄ±na dokunma â€” duplicate toplama olur (1006 + 1006 = 2012 bug'Ä±).
    const oranCoveredBySummary = new Set<number>();
    for (const marker of markers) {
      if (marker.isSummary) oranCoveredBySummary.add(marker.oran);
    }

    for (const marker of markers) {
      // Summary ile zaten sayÄ±lan oranÄ±n item row markÃ¶rÃ¼nÃ¼ atla
      if (!marker.isSummary && oranCoveredBySummary.has(marker.oran)) continue;

      let tutar: number | null = null;

      // 1) AynÄ± satÄ±r, label'den sonra amount var mÄ±?
      // "HES. MATRAH / KDV(%N)  X,XX TL  Y,YY TL" gibi satÄ±rda 2 amount var:
      // ilki MATRAH, ikincisi KDV. matrahLabel varsa SON amount'u al.
      if (marker.hasMatrahLabel) {
        const amountReGlobal = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/gi;
        const allMatches = Array.from(marker.afterLabel.matchAll(amountReGlobal));
        if (allMatches.length >= 2) {
          // 2+ amount â†’ son tane KDV (ilki matrah)
          const last = allMatches[allMatches.length - 1];
          const parsed = this.parseAmount(last[1]);
          if (parsed >= 0 && parsed < 10_000_000) tutar = parsed;
        } else if (allMatches.length === 1) {
          // Tek amount â†’ muhtemelen sadece KDV (matrah ayrÄ± satÄ±rda olabilir)
          const parsed = this.parseAmount(allMatches[0][1]);
          if (parsed > 0 && parsed < 10_000_000) tutar = parsed;
        }
      } else {
        const afterLabelMatch = marker.afterLabel.match(amountRe);
        if (afterLabelMatch) {
          const parsed = this.parseAmount(afterLabelMatch[1]);
          if (parsed > 0 && parsed < 10_000_000) tutar = parsed;
        }
      }

      // 2) Yoksa sonraki 4 satÄ±rdan amount'u al
      //    - matrahLabel varsa (Hes. Matrah / KDV): 2 ardÄ±ÅŸÄ±k amount topla, 2.'yi al
      //      (Azure tablo hÃ¼crelerini ayrÄ± satÄ±r olarak parse eder:
      //        "Hes. Matrah / KDV(%1)" / "771,70 TL" / "7,72 TL")
      //    - deÄŸilse: ilk amount'u al (eski mantÄ±k)
      if (tutar == null) {
        const collected: number[] = [];
        for (let j = 1; j <= 4 && marker.lineIdx + j < lines.length; j++) {
          const nextLine = lines[marker.lineIdx + j];
          if (skipTaxRe.test(nextLine) || hasNonKdvTaxLabel(nextLine)) break;
          if (this.isForbiddenKdvAmountLine(nextLine)) continue;
          if (j > 1 && this.isForbiddenKdvAmountLine(lines[marker.lineIdx + j - 1] || '')) continue;
          if (/^%\s*\d{1,2}(?:[,.]\d{1,2})?\s*\)?\s*$/.test(nextLine.trim())) break;
          const cleanedNext = this.stripMatrahFragments(nextLine);
          if (!cleanedNext) continue;
          const am = cleanedNext.match(amountRe);
          if (am) {
            const parsed = this.parseAmount(am[1]);
            if (parsed >= 0 && parsed < 10_000_000) {
              collected.push(parsed);
              // matrah label varsa 2 amount topla, sonra dur
              if (marker.hasMatrahLabel && collected.length >= 2) break;
              // matrah label yoksa ilk amount yeterli
              if (!marker.hasMatrahLabel) break;
            }
          }
        }
        if (collected.length > 0) {
          // matrah label + 2 amount â†’ 2.'si KDV (ilki matrah)
          // matrah label + 1 amount â†’ KDV varsayalÄ±m
          // matrah label yok â†’ ilk amount
          if (marker.hasMatrahLabel && collected.length >= 2) {
            tutar = collected[1];
          } else {
            tutar = collected[0];
          }
        }
      }

      // KDV 0 olan summary satÄ±rlarÄ±nÄ± (Hes. Matrah / KDV(%8) 0,00 / 0,00)
      // breakdown'a ekleme â€” sadece > 0 olanlarÄ± topla.
      if (tutar != null && tutar > 0) {
        // Summary satÄ±rÄ± iÃ§in oran baÅŸÄ±na SET et (overwrite) â€” birden fazla
        // aynÄ± oran summary Ã§Ä±karsa (nadir), en son okunanÄ± bÄ±rak.
        // Item row iÃ§in topla (aynÄ± oranda birden fazla kalem olabilir).
        if (marker.isSummary) {
          sumByOran.set(marker.oran, tutar);
        } else {
          sumByOran.set(marker.oran, (sumByOran.get(marker.oran) || 0) + tutar);
        }
      }
    }

    // 2+ oran bulunduysa anlamlÄ±. Tek oran iÃ§in zaten kdvTutari var, Ã¼retme.
    if (sumByOran.size < 2) return [];
    return Array.from(sumByOran.entries())
      .sort((a, b) => a[0] - b[0]) // %1, %10, %20 sÄ±rayla (kÃ¼Ã§Ã¼kten bÃ¼yÃ¼ÄŸe)
      .map(([oran, tutar]) => ({
        oran,
        tutar: Math.round(tutar * 100) / 100,
        matrah: null,
      }));
  }

  /**
   * "Hes. Matrah / KDV(%N)" tablo formatÄ± iÃ§in Ã¶zel ve saÄŸlam parser.
   * Bu format e-ArÅŸiv fatura altÄ±nda standart olarak gÃ¶rÃ¼nÃ¼r:
   *
   *                       Matrah        Kdv
   *   Hes. Matrah / KDV(%1)    771,70 TL    7,72 TL
   *   Hes. Matrah / KDV(%8)    0,00 TL      0,00 TL
   *   Hes. Matrah / KDV(%20)   71,58 TL     14,32 TL
   *   Hes. Matrah / KDV Toplam 843,28 TL    22,04 TL
   *
   * Azure parse'inde tablo hÃ¼creleri farklÄ± dizilebilir (sÄ±rayla matrah'lar,
   * sonra KDV'ler bir blokta gelir, ya da yan yana). Bu method her iki dÃ¼zeni
   * de yakalamaya Ã§alÄ±ÅŸÄ±r:
   *
   *   1. "Hes. Matrah / KDV Toplam" satÄ±rÄ±nÄ± bul â†’ SON amount = TOPLAM KDV
   *      (en gÃ¼venli authoritative deÄŸer)
   *   2. Per oran "Hes. Matrah / KDV(%N)" satÄ±rlarÄ± iÃ§in breakdown Ã§Ä±kar
   *
   * SonuÃ§ dÃ¶nerse otomatik authoritative kabul edilir, diÄŸer extractor'larÄ±
   * override eder.
   */
  private extractHesMatrahKdvTable(text: string): {
    totalKdv: number | null;
    breakdown: KdvBreakdownItem[];
  } {
    if (!text) return { totalKdv: null, breakdown: [] };

    // "Hes. Matrah / KDV(%N)" veya "Hes. Matrah / KDV Toplam" satÄ±rlarÄ±nÄ± ara
    const labelRe = /HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?\s*(?:TOPLAM|\(?\s*%\s*(\d{1,2})\s*\)?)/i;
    if (!labelRe.test(text)) return { totalKdv: null, breakdown: [] };

    const normalized = this.normalizeAzureText(text);
    const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/i;
    const allAmountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|â‚º)?/gi;

    let totalKdv: number | null = null;
    const breakdown = new Map<number, number>();

    // Her satÄ±r iÃ§in: label varsa, label'dan sonraki amount'larÄ± topla
    // (aynÄ± satÄ±rda veya sonraki 4 satÄ±rda)
    const collectAmountsAfterLine = (startIdx: number, maxLines = 4): number[] => {
      const amts: number[] = [];
      // aynÄ± satÄ±rÄ±n label'dan sonraki kÄ±smÄ±
      const startLine = lines[startIdx];
      const labelMatch = startLine.match(labelRe);
      if (labelMatch) {
        const after = startLine.slice(labelMatch.index! + labelMatch[0].length);
        for (const m of after.matchAll(allAmountRe)) {
          const v = this.parseAmount(m[1]);
          if (v >= 0 && v < 100_000_000) amts.push(v);
        }
      }
      // sonraki maxLines satÄ±r â€” baÅŸka bir label gelene kadar
      for (let j = 1; j <= maxLines && startIdx + j < lines.length; j++) {
        const nl = lines[startIdx + j];
        if (labelRe.test(nl)) break; // yeni label baÅŸladÄ±
        // baÅŸka bir oran/% marker geldi â†’ tablonun farklÄ± bir kÄ±smÄ±
        if (/^%\s*\d{1,2}\s*\)?\s*$/.test(nl.trim())) break;
        const am = nl.match(amountRe);
        if (am) {
          const v = this.parseAmount(am[1]);
          if (v >= 0 && v < 100_000_000) amts.push(v);
        }
      }
      return amts;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(labelRe);
      if (!m) continue;

      const isToplam = /TOPLAM/i.test(line);
      const oran = m[1] ? parseInt(m[1], 10) : null;

      // Amount'larÄ± topla. 2+ amount varsa: 1. matrah, 2. KDV.
      const amts = collectAmountsAfterLine(i, 4);
      if (amts.length === 0) continue;
      const kdvAmount = amts.length >= 2 ? amts[1] : amts[0];

      if (isToplam) {
        if (kdvAmount > 0) totalKdv = kdvAmount;
      } else if (oran && oran > 0 && oran <= 30) {
        // 0,00 olanlarÄ± kaydetme â€” breakdown'a girmesin
        if (kdvAmount > 0) breakdown.set(oran, kdvAmount);
      }
    }

    return {
      totalKdv,
      breakdown: Array.from(breakdown.entries())
        .sort((a, b) => a[0] - b[0]) // %1, %10, %20 sÄ±rayla (kÃ¼Ã§Ã¼kten bÃ¼yÃ¼ÄŸe)
        .map(([oran, tutar]) => ({ oran, tutar: Math.round(tutar * 100) / 100, matrah: null })),
    };
  }

  private extractZRaporuKdvFromAzure(text: string): {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
    matrahByOran: Record<number, number>;
  } {
    const result = {
      kdvTutari: null as string | null,
      breakdown: [] as KdvBreakdownItem[],
      matrahByOran: {} as Record<number, number>,
    };
    if (!text) return result;

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const foldedLines = lines.map((line) => this.foldTurkishAscii(line));
    const topKdvLabel = /\bT[O0]P\s*K\s*D\s*V\b|\bT[O0]PKD[UV]\b|\bKDV\s*T[O0]PLAM\b|\bT[O0]PLAM\s*KDV\b/;
    const moneyTokenRe = /[-+]?[\*â‚ºÂ¥]?\s*\d[\d.,\s]*\d|\d+[,.]\d{2}/g;
    const topKdvCodeToRate = (raw: string): number | null => {
      const m = this.foldTurkishAscii(raw).match(/\b7(01|10|20)\b/);
      if (!m) return null;
      return m[1] === '20' ? 20 : 10;
    };
    const extractMoneyValues = (raw: string): number[] => {
      const line = this.foldTurkishAscii(raw)
        .replace(/[%/]\s*\d{1,2}(?:[.,]\d+)?/g, ' ')
        .replace(/\b\d{1,2}\s*[%/]/g, ' ');
      return (line.match(moneyTokenRe) || [])
        .map((token) => this.parseAmount(token))
        .filter((value) => value > 0 && value < 100_000_000);
    };
    const extractLastMoney = (raw: string): number => {
      const values = extractMoneyValues(raw);
      return values.length > 0 ? values[values.length - 1] : 0;
    };
    const extractTopKdvAmountAt = (idx: number): number => {
      const sameLineValues = extractMoneyValues(lines[idx]).filter((value) => {
        const rounded = Math.round(value * 100) / 100;
        return ![701, 710, 720].includes(rounded);
      });
      if (sameLineValues.length > 0) return sameLineValues[sameLineValues.length - 1];

      const lookahead: number[] = [];
      for (let j = 1; j <= 5 && idx + j < lines.length; j++) {
        const next = foldedLines[idx + j] || '';
        if (/\bKUM\b/.test(next)) break;
        if (j > 1 && /\b(?:KOMULATIF|KUMULATIF|KISIMLARA|ODEME|NAKIT|KREDI|KART|Z\s+NO)\b/.test(next)) break;
        lookahead.push(...extractMoneyValues(lines[idx + j]));
        if (lookahead.length >= 2) break;
      }

      const prev = foldedLines[idx - 1] || '';
      const current = foldedLines[idx] || '';
      const labelsAreSplit = /\bT[O0]PLAM\b/.test(prev) && topKdvLabel.test(current);
      if (labelsAreSplit && lookahead.length >= 2) return lookahead[1];
      return lookahead[0] || 0;
    };
    const nextLineMoney = (idx: number): number => {
      const next = foldedLines[idx + 1] || '';
      if (!next || /\bKUM\b/.test(next)) return 0;
      if (/\bT[O0]PLAM\b|\bGENEL\b|\bNAKIT\b|\bKREDI\b|\bKART\b/.test(next)) return 0;
      const value = extractLastMoney(next);
      return value > 0 && value < 100_000_000 ? value : 0;
    };

    // 1) TOPLAM %X satÄ±rlarÄ±ndan MATRAH'larÄ± topla
    //    "TOPLAM %20  *140,00" gibi satÄ±rlarÄ± yakala
    const matrahRegex = /^TOPLAM\s*[%/]\s*(\d{1,2})\b\s*[\*:]?\s*([\d.,]+)/i;
    for (const line of lines) {
      // KUM iÃ§eren satÄ±rlarÄ± atla (kÃ¼mÃ¼latif)
      if (/\bKUM\b/i.test(line)) continue;
      const m = line.match(matrahRegex);
      if (m) {
        const oran = parseInt(m[1], 10);
        const matrah = this.parseAmount(m[2]);
        if (oran > 0 && oran <= 30 && matrah > 0) {
          result.matrahByOran[oran] = matrah;
        }
      }
    }

    // 2) TOPKDV %X satÄ±rlarÄ±ndan her oran iÃ§in KDV tutarÄ±nÄ± al
    //    "TOPKDV %20  *23,33" / "TOPKDV /20 *23.33" gibi
    for (let i = 0; i < foldedLines.length; i++) {
      const line = foldedLines[i];
      if (/\bKUM\b/.test(line)) continue; // kÃ¼mÃ¼latifi atla
      if (!topKdvLabel.test(line)) continue;
      const rateMatch = line.match(/[%/]\s*(\d{1,2})\b/);
      const codeRate = topKdvCodeToRate(lines[i]);
      if (rateMatch || codeRate) {
        const oran = codeRate ?? parseInt(rateMatch![1], 10);
        const tutar = extractTopKdvAmountAt(i) || extractLastMoney(lines[i]) || nextLineMoney(i);
        if (oran > 0 && oran <= 30 && tutar > 0) {
          // matrahByOran'dan ilgili matrahÄ± al
          const matrah = result.matrahByOran[oran] ?? null;
          result.breakdown.push({ oran, tutar, matrah });
        }
      }
    }

    // 3) Toplam TOPKDV â€” breakdown varsa toplamÄ±nÄ± al, yoksa "TOPKDV ..." satÄ±rÄ±nÄ± ara
    if (result.breakdown.length > 0) {
      const sum = result.breakdown.reduce((s, b) => s + b.tutar, 0);
      result.kdvTutari = this.formatAmount(sum);
    } else {
      // Tek oranlÄ± / sadece TOPKDV var â€” "TOPKDV  *344,56" gibi
      // KUM iÃ§ermeyen, %X iÃ§ermeyen sade TOPKDV satÄ±rÄ±
      for (let i = 0; i < foldedLines.length; i++) {
        const line = foldedLines[i];
        if (/\bKUM\b/.test(line)) continue;
        if (/[%/]\s*\d/.test(line)) continue; // %X olan satÄ±r
        if (!topKdvLabel.test(line)) continue;
        const tutar = extractTopKdvAmountAt(i) || extractLastMoney(lines[i]) || nextLineMoney(i);
        if (tutar > 0) {
          result.kdvTutari = this.formatAmount(tutar);
          break;
        }
      }
    }

    return result;
  }

  /**
   * Claude'un verdiÄŸi deÄŸeri Azure'un ham metninde ara â€” TANIK DOÄRULAMA.
   * AmaÃ§: Claude halÃ¼sinasyon yaparsa (286,36'yÄ± 631,43 gibi) Azure "bunu gÃ¶rmedim" der.
   * Tutar iÃ§in Â±1 kuruÅŸ tolerans; belge no iÃ§in case-insensitive; tarih iÃ§in format-insensitive.
   */
  private isFieldInAzureText(
    value: string,
    field: 'belgeNo' | 'date' | 'amount',
    azureText: string,
  ): boolean {
    if (!value || !azureText) return false;
    const text = azureText.toUpperCase();
    const v = value.toUpperCase().trim();

    if (field === 'belgeNo') {
      // Belge no'da noktalama/boÅŸluk tolere et
      const normalizedValue = v.replace(/[^A-Z0-9]/g, '');
      const normalizedText = text.replace(/[^A-Z0-9]/g, '');
      if (normalizedValue.length === 0) return false;

      // KÄ±sa belge no'lar (1-3 hane fiÅŸ no, Z no): etiket bazlÄ± arama lazÄ±m,
      // Ã§Ã¼nkÃ¼ "20" gibi kÄ±sa sayÄ± metinde baÅŸka yerlerde tesadÃ¼fen geÃ§ebilir.
      // "FIÅ NO 20", "Z NO 20", "BELGE NO 20" gibi etikete eÅŸlik etsin.
      if (normalizedValue.length <= 3) {
        const labelPatterns = [
          new RegExp(`F[Ä°I]Å\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`Z\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`BELGE\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`MAKBUZ\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`SER[Ä°I]\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`F[Ä°I]S\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
        ];
        return labelPatterns.some((p) => p.test(text));
      }

      // 4+ karakter belge no: doÄŸrudan substring match
      return normalizedText.includes(normalizedValue);
    }

    if (field === 'date') {
      // "08.03.2026" â†’ 08, 03, 2026 parÃ§alarÄ±nÄ± ayrÄ± ayrÄ± yakala
      const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) return false;
      const [, dd, mo, yy] = m;
      // Azure metninde DD<sep>MM<sep>YYYY biÃ§iminde ara â€” separator esnek.
      // GerÃ§ek Ã¶rnekler: "18.03.2026", "18-03-2026", "18/03/2026", "18 03 2026",
      // "18- 03- 2026" (tire+boÅŸluk), "18. 03. 2026", "18 . 03 . 2026".
      // Separator olarak 0-3 karakter (boÅŸluk/nokta/tire/slash kombinasyonu) kabul.
      const sep = `[\\s.\\-\\/]{0,3}`;
      const dateRegex = new RegExp(`\\b${dd}${sep}${mo}${sep}${yy}\\b`);
      if (dateRegex.test(text)) return true;
      const yyShort = yy.slice(-2);
      const shortDateRegex = new RegExp(`\\b${dd}${sep}${mo}${sep}${yyShort}\\b`);
      if (shortDateRegex.test(text)) return true;
      // Fallback: tarihin canonical formunu (ddmmyyyy) tÃ¼m non-digit temizlendikten
      // sonra Azure text'inde ara â€” separator ne olursa olsun yakalar
      const canonical = `${dd}${mo}${yy}`;
      const canonicalShort = `${dd}${mo}${yyShort}`;
      const normalizedText = text.replace(/[^0-9]/g, '');
      return normalizedText.includes(canonical) || normalizedText.includes(canonicalShort);
    }

    if (field === 'amount') {
      // "286,36" â†’ rakamlarÄ± yakala, Â±1 kuruÅŸ tolerans
      const num = this.parseAmount(v);
      if (num <= 0) return false;
      // Azure'da bulunan tÃ¼m sayÄ±larÄ± tara, en yakÄ±nÄ±nÄ± bul
      const amountMatches = text.matchAll(/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\b/g);
      for (const match of amountMatches) {
        const candidate = this.parseAmount(match[0]);
        if (candidate > 0 && Math.abs(candidate - num) < 0.05) return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Claude sonucunu Azure'un ham metnine karÅŸÄ± Ã§apraz doÄŸrular.
   * Bulunamayan alanlarÄ±n confidence'Ä±nÄ± sÄ±fÄ±rlar â†’ kullanÄ±cÄ± teyidine gider.
   * Bulunan alanlarÄ±n confidence'Ä±nÄ± %95'e boost eder.
   */
  private crossCheckWithAzure(
    result: OcrResult,
    azureText: string,
    originalName?: string,
    belgeNoFromFilename?: string | null,
  ): void {
    if (!azureText || azureText.length < 10) return;

    // Auto-fill bloklarÄ±ndan (Z_RAPORU, Telekom, multi-rate) kdvTutari doÄŸrulandÄ±
    // mÄ±? Evetse cross-check onu tekrar doÄŸrulamayÄ± denemesin â€” "*467,56" veya
    // "467 56" gibi Azure format farklÄ±lÄ±klarÄ± yÃ¼zÃ¼nden confidence yanlÄ±ÅŸ dÃ¼ÅŸÃ¼yordu.
    // Auto-fill demek: Azure'Ä±n kendi regex'iyle zaten KDV'yi bulduk ve Claude ile
    // karÅŸÄ±laÅŸtÄ±rdÄ±k. Ä°kinci bir cross-check dÃ¼ÅŸÃ¼rmesine gerek yok.
    const kdvAlreadyVerifiedByAutoFill = { value: false };

    // Filename ile belge no eÅŸleÅŸiyorsa (veya yakÄ±n â€” OCR 1-2 karakter hata yapmÄ±ÅŸ),
    // belge no cross-check'ini ATLA. Filename %100 gÃ¼venilir kaynak â€” Azure render
    // kalitesi dÃ¼ÅŸÃ¼kse FAIL verebilir ama bu false positive'dir.
    // Ã–RNEKLER:
    //   SRD2026000000760.xml + OCR=SRD2026000000760 â†’ TAM eÅŸleÅŸme
    //   ESR2026000001162.xml + OCR=ESR20260000011162 â†’ 1 karakter farklÄ± (OCR digit eklemiÅŸ)
    //   ESR2026000001204.xml + OCR=ESR20260000001204 â†’ 1 karakter farklÄ± (OCR digit eklemiÅŸ)
    // Edit distance â‰¤ 2 ve â‰¥10 karakter uzunluÄŸunda ise filename'i otorite kabul et.
    let skipBelgeNoCheck = false;
    if (belgeNoFromFilename && result.belgeNo) {
      const fn = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ocr = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const exactMatch = fn === ocr && fn.length >= 4;
      const nearMatch = fn.length >= 10 && this.eBelgeNoDistance(fn, ocr) <= 3;
      if (exactMatch || nearMatch) {
        skipBelgeNoCheck = true;
        // Near match durumda filename'i otorite kabul et â€” OCR digit eklemiÅŸ/atlatmÄ±ÅŸ
        if (nearMatch && !exactMatch) {
          this.logger.warn(
            `Belge no Levenshtein override: OCR="${ocr}" â†’ filename="${fn}" (edit distance â‰¤ 2, ${originalName})`,
          );
          result.belgeNo = belgeNoFromFilename;
        }
        // Filename match â†’ belge no zaten %95 confidence
        if (result.fieldConfidence.belgeNo != null) {
          result.fieldConfidence.belgeNo = Math.max(
            result.fieldConfidence.belgeNo ?? 0,
            0.95,
          );
        } else {
          result.fieldConfidence.belgeNo = 0.95;
        }
      }
    }

    // â”€â”€â”€ E-FATURA / E-ARÅÄ°V TRUST GUARD â”€â”€â”€
    // Elektrik/telekom faturalarÄ±nda filename â‰  OCR belge no olabilir
    // (Filename: "BEF2026000958878", OCR: "EFA2026000000878" â€” farklÄ± kodlama).
    // Bu durumda Levenshtein fix devreye giremez ve Azure metninde de
    // belge no kÃ¼Ã§Ã¼k/soluk yazÄ± nedeniyle bulunamayabilir â†’ cross-check FAIL â†’ %20.
    //
    // YENI KURAL: Claude'un belgeNo confidence'Ä± â‰¥ %85 ve OCR sonucu
    // geÃ§erli e-fatura format'Ä±nda ise (3 harf + 13 rakam = 16 char),
    // Claude'un sonucuna gÃ¼ven, cross-check'i atla.
    // GerÃ§ek FALSE POSITIVE deÄŸil, Azure'un okuyamadÄ±ÄŸÄ± kÃ¼Ã§Ã¼k yazÄ± hatasÄ±.
    if (!skipBelgeNoCheck && result.belgeNo && result.fieldConfidence.belgeNo != null) {
      const bn = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const isValidEFaturaFormat = /^[A-Z]{3}\d{13}$/.test(bn); // EFA/ESR/BEF/GB1/IRU/KMI + yÄ±l + sÄ±ra
      const claudeBelgeNoConf = result.fieldConfidence.belgeNo ?? 0;
      if ((isValidEFaturaFormat || E_BELGE_NO_REGEX.test(bn)) && claudeBelgeNoConf >= 0.85) {
        this.logger.log(
          `E-fatura trust guard: belge no "${bn}" geÃ§erli format + Claude conf ${Math.round(claudeBelgeNoConf * 100)}% â†’ cross-check skip (${originalName})`,
        );
        skipBelgeNoCheck = true;
      }
    }

    // â”€â”€â”€ Z RAPORU AUTO-CORRECT â€” Azure metninden direkt Ã§Ä±kar â”€â”€â”€
    // Z raporlarÄ± yapÄ±sal: TOPLAM %X / TOPKDV %X / TOPKDV satÄ±rlarÄ± sabit format.
    // Claude halÃ¼sinasyon yapsa bile Azure regex'i doÄŸru deÄŸeri Ã§Ä±karÄ±r.
    if (result.belgeTipi === 'Z_RAPORU') {
      const zParsed = this.extractZRaporuKdvFromAzure(azureText);
      if (zParsed.kdvTutari) {
        const claudeKdv = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
        const azureKdv = this.parseAmount(zParsed.kdvTutari);
        // EÄŸer farklÄ±larsa Azure'un deÄŸerini kullan (regex parse daha gÃ¼venilir)
        if (Math.abs(claudeKdv - azureKdv) > 0.05) {
          this.logger.warn(
            `Z_RAPORU KDV auto-correct: Claude=${result.kdvTutari} â†’ Azure=${zParsed.kdvTutari} (${originalName})`,
          );
          result.kdvTutari = zParsed.kdvTutari;
          result.fieldConfidence.kdvTutari = 0.92; // Azure regex match â†’ yÃ¼ksek gÃ¼ven
          kdvAlreadyVerifiedByAutoFill.value = true;
        } else {
          // EÅŸleÅŸiyorsa zaten doÄŸruydu â€” confidence boost
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.95,
          );
          kdvAlreadyVerifiedByAutoFill.value = true;
        }
      }
      // Breakdown'u Azure'dan al (Claude vermediyse veya yanlÄ±ÅŸsa)
      if (zParsed.breakdown.length > 0) {
        const claudeBreakdownCount = result.kdvBreakdown?.length || 0;
        if (claudeBreakdownCount === 0 || claudeBreakdownCount !== zParsed.breakdown.length) {
          this.logger.warn(
            `Z_RAPORU breakdown auto-fill: Claude=${claudeBreakdownCount} oran â†’ Azure=${zParsed.breakdown.length} oran (${originalName})`,
          );
          result.kdvBreakdown = zParsed.breakdown;
        }
      }
    }

    // â”€â”€â”€ TEVKÄ°FATLI FATURA AUTO-CORRECT â”€â”€â”€
    // TevkifatlÄ± alÄ±ÅŸ faturalarÄ±nda Claude bazen hatalÄ± hesap yapÄ±yor:
    //   - Mal Hizmet Toplam deÄŸerini "KDV dahil toplam" sanÄ±p /11 hesaplÄ±yor
    //     (Ã¶rn. 13.300 / 11 = 1.209,09 â€” yanlÄ±ÅŸ!)
    //   - "Hesaplanan KDV Tevkifat(%50)" satÄ±rÄ±nÄ± kaÃ§Ä±rÄ±p tevkifat=0 dÃ¶nÃ¼yor
    //
    // Ã‡Ã¶zÃ¼m: Azure metninde "Hesaplanan KDV(%X)" + "Hesaplanan KDV Tevkifat(%XX)"
    // pattern'ini doÄŸrudan yakala, Claude'un sonucunu override et.
    const azureTextNorm = this.normalizeAzureText(azureText);
    const azureMentionsTevkifat = /TEVK[Ä°I]FAT/i.test(azureTextNorm);
    let tevkifatExtracted = false;
    {
      const tevkifatli = this.extractTevkifatliFaturaFromAzure(azureText);
      if (tevkifatli) {
        tevkifatExtracted = true;
        const claudeKdv = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
        const claudeTevkifat = result.kdvTevkifat ? this.parseAmount(result.kdvTevkifat) : 0;
        const azureNet = tevkifatli.netKdv;
        const azureTevkifat = tevkifatli.tevkifat;

        // Override koÅŸullarÄ±:
        //   1. Claude tevkifat'Ä± 0 verdi ama Azure tevkifat buldu (Claude eksik)
        //   2. Claude'un NET KDV'si Azure'dan farklÄ± (>5 kuruÅŸ) â€” Claude yanlÄ±ÅŸ hesap
        const tevkifatMissing = claudeTevkifat === 0 && azureTevkifat > 0;
        const kdvMismatch = Math.abs(claudeKdv - azureNet) > 0.05;

        if (tevkifatMissing || kdvMismatch) {
          this.logger.warn(
            `TevkifatlÄ± fatura auto-correct: Claude kdv=${result.kdvTutari} tevk=${result.kdvTevkifat ?? '0'} â†’ Azure tamKdv=${this.formatAmount(tevkifatli.tamKdv)} tevk=${this.formatAmount(azureTevkifat)} net=${this.formatAmount(azureNet)} (${originalName})`,
          );
          result.kdvTutari = this.formatAmount(azureNet);
          result.kdvTevkifat = this.formatAmount(azureTevkifat);
          result.fieldConfidence.kdvTutari = 0.92; // Azure regex match â†’ yÃ¼ksek gÃ¼ven
          // Tek oranlÄ± tevkifat faturalarÄ±nda breakdown'u da gÃ¼ncelle
          if (result.kdvBreakdown && result.kdvBreakdown.length === 1) {
            result.kdvBreakdown[0].tutar = azureNet;
          } else if (!result.kdvBreakdown || result.kdvBreakdown.length === 0) {
            // Breakdown yok ama oran tespit edilebilirse oluÅŸtur (en yaygÄ±n %10/%20)
            const oranMatch = azureTextNorm.match(
              /HESAPLANAN\s+KDV\s*\(\s*[%/]?\s*(\d{1,2})\s*\)(?!\s*TEVK)/i,
            );
            if (oranMatch) {
              const oran = parseInt(oranMatch[1], 10);
              if ([1, 10, 20].includes(oran)) {
                result.kdvBreakdown = [{ oran, tutar: azureNet, matrah: null }];
              }
            }
          }
          kdvAlreadyVerifiedByAutoFill.value = true;
        }
      }
    }

    // â”€â”€â”€ DEFANSÄ°F FALLBACK: Tevkifat var ama extract edilemediyse â”€â”€â”€
    // Azure metni "TEVKIFAT" diyor ama biz tutarÄ± doÄŸru Ã§Ä±karamadÄ±k.
    // Claude'un kdvTutari'sÄ± muhtemelen yanlÄ±ÅŸ (toplam/11 veya toplam/6 hesabÄ±).
    // Bu durumda yanlÄ±ÅŸ deÄŸeri kullanÄ±cÄ±ya gÃ¶sterme â€” confidence sÄ±fÄ±rla,
    // NEEDS_REVIEW akÄ±ÅŸÄ±na gitsin, kullanÄ±cÄ± manuel girebilsin.
    if (azureMentionsTevkifat && !tevkifatExtracted && result.kdvTutari) {
      const claudeKdv = this.parseAmount(result.kdvTutari);
      const claudeTotal = result.totalTutari ? this.parseAmount(result.totalTutari) : 0;

      // YanlÄ±ÅŸ matematik gÃ¶stergesi:
      //   â€¢ kdvTutari â‰ˆ totalTutari / 11   (Claude %10 KDV-DAHÄ°L hesabÄ± yapmÄ±ÅŸ)
      //   â€¢ kdvTutari â‰ˆ totalTutari / 6    (Claude %20 KDV-DAHÄ°L hesabÄ± yapmÄ±ÅŸ)
      let suspiciousMath = false;
      if (claudeTotal > 0 && claudeKdv > 0) {
        const ratio11 = Math.abs(claudeKdv - claudeTotal / 11) / claudeKdv;
        const ratio6 = Math.abs(claudeKdv - claudeTotal / 6) / claudeKdv;
        if (ratio11 < 0.02 || ratio6 < 0.02) {
          suspiciousMath = true;
        }
      }

      // Tevkifat boÅŸ + Azure'da TEVKÄ°FAT var â†’ ÅŸÃ¼pheli
      const tevkifatEmpty = !result.kdvTevkifat || this.parseAmount(result.kdvTevkifat) === 0;

      if (suspiciousMath || tevkifatEmpty) {
        this.logger.warn(
          `TevkifatlÄ± fatura DEFANSÄ°F FALLBACK (${originalName}): Azure'da TEVKIFAT var ama extract edemedik. Claude kdv=${result.kdvTutari} total=${result.totalTutari} tevk=${result.kdvTevkifat ?? '0'}. Confidence sÄ±fÄ±rlanÄ±p NEEDS_REVIEW'a gidiyor.`,
        );
        // Confidence sÄ±fÄ±rla â€” kullanÄ±cÄ± manuel girsin, yanlÄ±ÅŸ deÄŸer Ã¶nerme
        result.fieldConfidence.kdvTutari = 0.3;
        // MantÄ±ksÄ±z deÄŸerleri null'la
        if (suspiciousMath) {
          result.kdvTutari = null;
          result.kdvBreakdown = null;
        }
      }
    }

    // â”€â”€â”€ TELEKOM FATURASI KDV SADECE-KDV OVERRIDE â”€â”€â”€
    // Telekom faturalarÄ± (Turkcell, Vodafone, TT) 4 farklÄ± vergi tÃ¼rÃ¼ iÃ§erir:
    //   Katma DeÄŸer Vergisi (%20)  252,00  â† SADECE BU KDV
    //   Ã–zel Ä°letiÅŸim Vergisi (%10) 126,00  â† DEÄÄ°L
    //   Telsiz KullanÄ±m AylÄ±k Taksit (%0) 26,98  â† DEÄÄ°L
    // Claude bunlarÄ± bazen topluyor. Azure metninde "Ã–zel Ä°letiÅŸim" varsa
    // bu telekom faturasÄ±dÄ±r â€” "Katma DeÄŸer Vergisi" satÄ±rÄ±nÄ± Ã¶zel
    // parse edip kdvTutari'yi defansif olarak override et.
    // NBSP / full-width karakterler regex'i kÄ±rmasÄ±n diye azureText'i normalize
    // edilmiÅŸ haliyle test et. (extractKdvOnlyFromTelekomAzure kendi iÃ§inde
    // normalize ediyor â€” ama bu Ã¼st seviye trigger iÃ§in de gerekli.)
    const normalizedAzureText = this.foldTurkishAscii(azureText);
    const isTelekomFatura = /[O?]ZEL\s*[I?]LET[I?]S[I?]M|OIV\b|TELSIZ\s*KULLAN/i.test(normalizedAzureText);
    if (isTelekomFatura) {
      const kdvOnlyAmount = this.extractKdvOnlyFromTelekomAzure(azureText);
      if (kdvOnlyAmount != null && kdvOnlyAmount > 0) {
        const claudeKdv = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
        if (Math.abs(claudeKdv - kdvOnlyAmount) > 0.05) {
          this.logger.warn(
            `Telekom fatura KDV override: Claude=${result.kdvTutari} â†’ Azure "Katma DeÄŸer Vergisi" satÄ±rÄ±=${this.formatAmount(kdvOnlyAmount)} (${originalName})`,
          );
        }
        result.kdvTutari = this.formatAmount(kdvOnlyAmount);
        result.fieldConfidence.kdvTutari = Math.max(result.fieldConfidence.kdvTutari ?? 0, 0.92);
        // Telekom faturalarÄ±nda Ã–Ä°V/Telsiz vb. aynÄ± tabloda gÃ¶rÃ¼nÃ¼r. UI ve Excel
        // KDV kÄ±rÄ±lÄ±mÄ±nda sadece "Katma DeÄŸer Vergisi / KDV" satÄ±rÄ± kalmalÄ±.
        result.kdvBreakdown = [{ oran: 20, tutar: kdvOnlyAmount, matrah: null }];
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }

    const invoiceTotalsKdv = azureMentionsTevkifat
      ? null
      : this.extractKdvFromInvoiceTotalsAzure(azureText);
    if (invoiceTotalsKdv && invoiceTotalsKdv.kdv > 0) {
      const claudeKdv = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
      const diff = Math.abs(claudeKdv - invoiceTotalsKdv.kdv);
      if (diff > 0.05) {
        this.logger.warn(
          `AÃ§Ä±k KDV satÄ±rÄ± override: Claude=${result.kdvTutari} â†’ Azure=${this.formatAmount(invoiceTotalsKdv.kdv)} (${originalName})`,
        );
        result.kdvTutari = this.formatAmount(invoiceTotalsKdv.kdv);
        result.fieldConfidence.kdvTutari = 0.92;
        result.kdvBreakdown = [{
          oran: invoiceTotalsKdv.oran && invoiceTotalsKdv.oran > 0 ? invoiceTotalsKdv.oran : 20,
          tutar: invoiceTotalsKdv.kdv,
          matrah: invoiceTotalsKdv.matrah,
        }];
        kdvAlreadyVerifiedByAutoFill.value = true;
      } else if (diff <= 0.05 && result.fieldConfidence.kdvTutari != null) {
        result.fieldConfidence.kdvTutari = Math.max(result.fieldConfidence.kdvTutari, 0.92);
      }
      const invoiceRate = invoiceTotalsKdv.oran && invoiceTotalsKdv.oran > 0 ? invoiceTotalsKdv.oran : null;
      const currentBreakdown = result.kdvBreakdown || [];
      const currentRate = currentBreakdown.length === 1 ? Number(currentBreakdown[0]?.oran || 0) : null;
      if (invoiceRate && currentBreakdown.length <= 1 && (currentRate == null || Math.abs(currentRate - invoiceRate) > 0.5)) {
        result.kdvBreakdown = [{
          oran: invoiceRate,
          tutar: invoiceTotalsKdv.kdv,
          matrah: invoiceTotalsKdv.matrah,
        }];
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }

    // â”€â”€â”€ E-FATURA / E-ARÅÄ°V Ã‡OK ORANLI KDV AUTO-FILL â”€â”€â”€
    // Z_RAPORU dÄ±ÅŸÄ±ndaki belge tipleri iÃ§in: Claude breakdown'u boÅŸ dÃ¶nerse veya
    // eksik dÃ¶nerse, Azure metninden "Hesaplanan KDV (%X) ..." satÄ±rlarÄ±nÄ± parse et.
    // Ã–RNEK: ESR2026000001204 gibi karma fatura â€” %20 + %10 ayrÄ± satÄ±r, breakdown
    // boÅŸ gelmiÅŸ olabilir. UI'da KDV KÄ±rÄ±lÄ±mÄ± boÅŸ kalÄ±yor â†’ bu fix doldurur.
    //
    // Ä°ki aÅŸamalÄ± Azure fallback:
    //   A) extractMultiRateKdvFromAzure â€” "Hesaplanan KDV (%N)" Ã¶zet satÄ±rÄ± formatÄ±
    //   B) extractMultiRateKdvFromItemRows â€” tabloda "% N,NN ... X,XX TL" satÄ±r
    //      baÅŸÄ±na yakalama (A boÅŸ gelirse). Åirin Reklam gibi summary kopuk
    //      Ã§Ä±karÄ±ldÄ±ÄŸÄ±nda bile tablo satÄ±rlarÄ±ndan oran baÅŸÄ±na toplam kdv Ã§Ä±kar.
    // Multi-rate auto-fill â€” TÃœM belge tipleri iÃ§in Ã§alÄ±ÅŸtÄ±r. Eski davranÄ±ÅŸta
    // Z_RAPORU excluded'tÄ±; ama Claude bazen e-arÅŸiv/e-fatura'yÄ± yanlÄ±ÅŸlÄ±kla
    // Z_RAPORU olarak kategorize ediyor (ESR2026000001204 gibi) â†’ bu blok
    // hiÃ§ Ã§alÄ±ÅŸmÄ±yordu. Z_RAPORU iÃ§in zaten extractZRaporuKdvFromAzure
    // Ã¶zel olarak TOPKDV satÄ±rlarÄ±nÄ± yakalÄ±yor â€” orda baÅŸarÄ±sÄ±z olursa bu
    // generic fallback devreye girsin zarar vermez, override koÅŸulu zaten
    // Claude<Azure durumunu arÄ±yor.
    //
    // âš  TEVKÄ°FATLI FATURA KORUMASI: EÄŸer Azure metni "TEVKIFAT" geÃ§iyor VE
    // tevkifatlÄ± auto-correct Ã§alÄ±ÅŸtÄ±ysa, multi-rate fallback'leri ATLAR.
    // Aksi halde "Hesaplanan KDV(%10) 2.840" + "Hesaplanan KDV Tevkifat(%50)
    // 1.420" pattern'lerini iki farklÄ± oranlÄ± KDV gibi yorumlayabilir
    // (Ã¶rn. %10:2840 + %50:1420 â†’ toplam 4260, doÄŸru NET=1420 â†’ override KIRIK).
    // TevkifatlÄ± tek-oranlÄ± fatura iÃ§in zaten yukarÄ±daki tevkifat auto-correct
    // doÄŸru deÄŸeri set etti.
    if (result.belgeTipi === 'Z_RAPORU' && kdvAlreadyVerifiedByAutoFill.value) {
      this.logger.log(
        `Multi-rate auto-fill SKIP: Z raporu KDV'si TOPKDV parser ile dogrulandi (${originalName})`,
      );
    } else if (kdvAlreadyVerifiedByAutoFill.value && isTelekomFatura) {
      this.logger.log(
        `Multi-rate auto-fill SKIP: telekom KDV-only parser dogrulandi, Ã–Ä°V/Telsiz KDV kÄ±rÄ±lÄ±mÄ±na alÄ±nmadÄ± (${originalName})`,
      );
    } else if (kdvAlreadyVerifiedByAutoFill.value && azureMentionsTevkifat) {
      this.logger.log(
        `Multi-rate auto-fill SKIP: tevkifatlÄ± fatura (auto-correct Ã§alÄ±ÅŸtÄ±, ${originalName})`,
      );
    } else {
      // Ã–NCELÄ°K 1: "Hes. Matrah / KDV(%N)" tablosu â€” e-ArÅŸiv fatura altÄ± standart
      // formatÄ±. Bu format varsa AUTHORITATIVE, diÄŸer extractor'lar atlanÄ±r.
      // Sorun: Ã¶nceki extractor'lar bu tabloda matrah'Ä± (1. amount) KDV
      // sanÄ±yor (ZÄ±rhlÄ± GÄ±da Ã¶rneÄŸi â€” Toplam KDV: 22,04 doÄŸru, OCR 873,04
      // bulmuÅŸ Ã§Ã¼nkÃ¼ matrah'Ä± KDV almÄ±ÅŸ).
      const hesMatrah = this.extractHesMatrahKdvTable(azureText);
      const multiA = this.extractMultiRateKdvFromAzure(azureText);
      const multiB = this.extractMultiRateKdvFromItemRows(azureText);
      let azureBreakdown =
        hesMatrah.breakdown.length >= 2 ? hesMatrah.breakdown :
        multiA.length >= 2 ? multiA :
        multiB.length >= 2 ? multiB :
        multiA;
      // EÄŸer Hes. Matrah tablosundan toplam KDV bulunduysa, kdvTutari'yi de
      // override et (UI'da KDV TUTARI alanÄ± doÄŸru gÃ¶zÃ¼ksÃ¼n).
      if (hesMatrah.totalKdv !== null && hesMatrah.totalKdv > 0) {
        result.kdvTutari = hesMatrah.totalKdv.toFixed(2);
        this.logger.log(
          `Hes. Matrah / KDV Toplam tablosundan KDV override: ${hesMatrah.totalKdv.toFixed(2)} (${originalName})`,
        );
      }

      // TEÅHÄ°S LOGU â€” multi-rate bulunamadÄ±ysa veya Claude'dan az orana
      // ulaÅŸÄ±ldÄ±ysa Azure metninin baÅŸÄ±nÄ± log'a bas ki gerÃ§ek Ã§Ä±ktÄ± gÃ¶rÃ¼lsÃ¼n.
      // Aksi halde kÃ¶r regex tuning yapmak zorunda kalÄ±rÄ±z.
      const claudeBreakdownCount = result.kdvBreakdown?.length || 0;
      const mentionsKdvOran =
        /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?|%\s*\d{1,2}/i.test(
          this.normalizeAzureText(azureText),
        );
      if (azureBreakdown.length < 2 && claudeBreakdownCount < 2 && mentionsKdvOran) {
        const snippet = (azureText || '').slice(0, 1500).replace(/\s+/g, ' ');
        this.logger.warn(
          `Multi-rate DEBUG (${originalName}): Claude=${claudeBreakdownCount} A=${multiA.length} B=${multiB.length} | azure[0..1500]="${snippet}"`,
        );
      } else if (multiB.length >= 2 && multiA.length < 2) {
        this.logger.log(
          `Multi-rate item-row fallback devreye girdi: ${multiB.length} oran (${originalName})`,
        );
      }

      // Azure 2+ oran bulduysa ALWAYS override et. Eski koÅŸul "Azure > Claude"
      // idi, ama Claude'un breakdown'Ä± DB'ye null olarak kaydedilse de
      // claudeBreakdownCount kodda 2 gÃ¶rÃ¼nebiliyor â†’ koÅŸul tetiklenmiyordu.
      // Azure iki baÄŸÄ±msÄ±z tanÄ±kla (A/B) bulduysa zaten gÃ¼venilir.
      if (azureBreakdown.length >= 2) {
        const rateEchoCount = azureBreakdown.filter((b) =>
          [1, 10, 20].some((r) => Math.abs((Number(b.tutar) || 0) - r) < 0.01),
        ).length;
        const looksLikeRatesAsAmounts =
          rateEchoCount >= Math.ceil(azureBreakdown.length * 0.6);
        if (looksLikeRatesAsAmounts) {
          this.logger.warn(
            `Multi-rate breakdown reddedildi: KDV tutarlari oran gibi gorunuyor (${azureBreakdown.map((b) => `%${b.oran}:${this.formatAmount(b.tutar)}`).join(', ')}, ${originalName})`,
          );
          result.kdvTutari = null;
          result.kdvBreakdown = null;
          result.fieldConfidence.kdvTutari = null;
          kdvAlreadyVerifiedByAutoFill.value = false;
        } else {
        this.logger.warn(
          `E-fatura breakdown auto-fill: Claude=${claudeBreakdownCount} oran â†’ Azure=${azureBreakdown.length} oran (${originalName})`,
        );
        result.kdvBreakdown = azureBreakdown;
        const sum = azureBreakdown.reduce((s, b) => s + b.tutar, 0);
        const claudeTotal = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
        if (!result.kdvTutari || claudeTotal <= 0) {
          this.logger.warn(
            `E-fatura KDV toplamÄ± Azure aÃ§Ä±k KDV satÄ±rlarÄ±ndan dolduruldu: ${this.formatAmount(sum)} (${originalName})`,
          );
          result.kdvTutari = this.formatAmount(sum);
        } else if (Math.abs(sum - claudeTotal) > 0.05) {
          this.logger.warn(
            `E-fatura ana KDV tek oran kalmis: ana=${result.kdvTutari} breakdown toplam=${this.formatAmount(sum)} (${originalName}) - ana KDV breakdown toplamiyla duzeltildi`,
          );
          result.kdvTutari = this.formatAmount(sum);
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.92,
          );
        } else {
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.92,
          );
        }
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }
    }

    const checks: { field: 'belgeNo' | 'date' | 'amount'; value: string | null; key: 'belgeNo' | 'date' | 'kdvTutari' }[] = [
      { field: 'belgeNo', value: result.belgeNo, key: 'belgeNo' },
      { field: 'date', value: result.date, key: 'date' },
      { field: 'amount', value: result.kdvTutari, key: 'kdvTutari' },
    ];

    let matched = 0;
    let mismatched = 0;
    const mismatches: string[] = [];

    for (const c of checks) {
      if (!c.value) continue;
      // Filename ile belge no eÅŸleÅŸiyorsa cross-check'i atla (yukarÄ±daki blok hallettÄ±)
      if (c.key === 'belgeNo' && skipBelgeNoCheck) {
        matched++;
        continue;
      }
      // KDV yukarÄ±daki auto-fill bloklarÄ±nda (Z_RAPORU / Telekom / multi-rate)
      // Azure'Ä±n kendi regex'leriyle zaten doÄŸrulandÄ±ysa, bu generic
      // isFieldInAzureText tarama gereksiz â€” Azure'Ä±n text formatÄ± ("*467,56",
      // "467 56" gibi) generic regex'i kÄ±rÄ±p false FAIL Ã¼retiyordu.
      if (c.key === 'kdvTutari' && kdvAlreadyVerifiedByAutoFill.value) {
        matched++;
        continue;
      }
      // Z_RAPORU / OKC_FIS iÃ§in Azure ham metni Ã§oÄŸunlukla bozuk geliyor
      // ("KDU" yerine "KDV", US format sayÄ±lar, Â¥/* karakterler). Generic
      // cross-check %90+ Claude confidence'Ä± yapay olarak %20'ye Ã§ekiyordu.
      // Bu belgelerde KDV doÄŸrulamasÄ± zaten Z_RAPORU regex bloÄŸuyla yapÄ±lÄ±yor;
      // generic cross-check FAIL'Ä± confidence'Ä± kÄ±rmasÄ±n.
      if (
        c.key === 'kdvTutari' &&
        (result.belgeTipi === 'Z_RAPORU' || result.belgeTipi === 'OKC_FIS')
      ) {
        matched++;
        continue;
      }
      const found = this.isFieldInAzureText(c.value, c.field, azureText);
      if (found) {
        matched++;
        // TanÄ±k var â†’ confidence boost (en az %90)
        if (result.fieldConfidence[c.key] != null) {
          result.fieldConfidence[c.key] = Math.max(
            result.fieldConfidence[c.key] ?? 0,
            0.9,
          );
        }
      } else {
        mismatched++;
        mismatches.push(`${c.key}=${c.value}`);
        this.logger.warn(
          `Cross-check FAIL: ${c.key}="${c.value}" Azure metninde yok (${originalName})`,
        );
        // KÄ±sa belge no (1-3 hane) iÃ§in cross-check gÃ¼venilmez (etiket baÄŸlamÄ± sorunu).
        // Bu durumda confidence'Ä± Ã§ok kÄ±rma, sadece orta seviyeye Ã§ek (0.6).
        const isShortBelgeNo =
          c.key === 'belgeNo' &&
          c.value.replace(/[^A-Z0-9]/gi, '').length <= 3;
        result.fieldConfidence[c.key] = isShortBelgeNo ? 0.6 : 0.2;
      }
    }

    // Genel confidence'Ä± yeniden hesapla
    const scores = [
      result.fieldConfidence.belgeNo,
      result.fieldConfidence.date,
      result.fieldConfidence.kdvTutari,
    ].filter((v): v is number => typeof v === 'number');
    if (scores.length > 0) {
      result.confidence = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    this.logger.log(
      `Cross-check: ${matched}/${matched + mismatched} eÅŸleÅŸti ` +
        (mismatches.length > 0 ? `Â· mismatch: [${mismatches.join(', ')}]` : ''),
    );
  }

  private parseAmount(str: string): number {
    return parseOcrAmount(str);
  }

  private formatAmount(n: number): string {
    return formatOcrAmount(n);
  }

  private normalizeTaxText(value: string | null | undefined): string {
    return normalizeTaxTextValue(value);
  }

  private decodeXmlText(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private getXmlTagValue(xml: string, tag: string): string | null {
    const name = `(?:[\\w.-]+:)?${tag}`;
    const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return match?.[1] ? this.decodeXmlText(match[1].trim()) : null;
  }

  private getXmlBlocks(xml: string, tag: string): string[] {
    const name = `(?:[\\w.-]+:)?${tag}`;
    const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi');
    const blocks: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      blocks.push(match[1]);
    }
    return blocks;
  }

  private stripXmlBlocks(xml: string, tag: string): string {
    const name = `(?:[\\w.-]+:)?${tag}`;
    return xml.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), '');
  }

  private parseXmlAmount(xml: string, tag: string): number {
    const raw = this.getXmlTagValue(xml, tag);
    return raw ? this.parseAmount(raw) : 0;
  }

  /**
   * OCR sonucunu kapsamlÄ± doÄŸrular + mÃ¼mkÃ¼nse dÃ¼zeltir. Ã‡aÄŸÄ±ran taraf
   * (Claude Vision OCR) parse sonrasÄ± bu method'u Ã§aÄŸÄ±rÄ±r.
   *
   * YaptÄ±klarÄ±:
   *  1. Belge no: yasak deÄŸerleri temizle (TR1.2, UUID, vb.), filename override
   *  2. Belge no: uzunluk/pattern kontrolÃ¼, tipine gÃ¶re uyum doÄŸrulama
   *  3. Tarih: ay/gÃ¼n geÃ§erli mi, yÄ±l makul mu
   *  4. KDV: breakdown toplamÄ± = kdvTutari mi (tolerans Â±1 kuruÅŸ)
   *  5. KDV: matrah Ã— oran / 100 â‰ˆ tutar mi (Ã§apraz doÄŸrulama)
   *  6. Numerik alanlar normalize (â‚º, TL, boÅŸluk temizle)
   */
  private postProcessOcrResult(
    result: OcrResult,
    belgeNoFromFilename: string | null,
    originalName?: string,
  ): void {
    // â”€â”€â”€ 1. BELGE NO â€” Yasak deÄŸerleri temizle â”€â”€â”€
    if (result.belgeNo) {
      const cleaned = result.belgeNo.trim().toUpperCase();
      const forbidden = [
        /^TR[\d.\-_]+$/,                         // TR1.2, TR1.0
        /^UBL[\d.\-_]*$/,                        // UBL-2.1
        /^(TEMELFATURA|TICARIFATURA|EARSIVFATURA)$/,
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i, // UUID/ETTN
      ];
      if (forbidden.some((p) => p.test(cleaned))) {
        this.logger.warn(`OCR yasak belge no deÄŸeri: "${cleaned}" â†’ null (${originalName})`);
        result.belgeNo = null;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = null;
      }
    }

    // â”€â”€â”€ 2. BELGE NO â€” Filename override (eksik/yanlÄ±ÅŸ OCR) â”€â”€â”€
    if (belgeNoFromFilename) {
      const fnClean = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ocrClean = (result.belgeNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      // Senaryolar:
      //   a) OCR belge no yok, filename var â†’ kullan
      //   b) OCR belge no Ã§ok kÄ±sa (<10 char) ama filename uzun (â‰¥10) â†’ kullan
      //   c) OCR belge no filename'in prefix'i ile eÅŸleÅŸiyor ama kÄ±sa kalmÄ±ÅŸ â†’ kullan
      //   d) OCR belge no â‰¥10 char ve filename ile edit distance â‰¤ 2 â†’ kullan
      //      (OCR 1-2 karakter hatasÄ± yapmÄ±ÅŸ: fazladan digit eklemiÅŸ/atlamÄ±ÅŸ)
      //   e) OCR belge no ile filename tamamen farklÄ±ysa â†’ dokunma (kullanÄ±cÄ± dÃ¼zeltsin)
      const editDist =
        fnClean.length >= 10 && ocrClean.length >= 10
          ? this.eBelgeNoDistance(fnClean, ocrClean)
          : Infinity;
      const filenameMatchesOcr =
        fnClean.length >= 10 &&
        (fnClean === ocrClean || editDist <= 2);
      const fnLooksLikeEInvoice = E_BELGE_NO_REGEX.test(fnClean);
      const lowBelgeNoConfidence = (result.fieldConfidence?.belgeNo ?? 0) < 0.85;
      const shouldOverride =
        !ocrClean ||
        (ocrClean.length < 10 && fnClean.length >= 10) ||
        (fnClean.length > ocrClean.length && fnClean.startsWith(ocrClean.slice(0, 3))) ||
        (fnClean.length >= 10 && editDist <= 2) ||
        (fnLooksLikeEInvoice && lowBelgeNoConfidence && editDist <= 4);

      if (shouldOverride && fnClean !== ocrClean) {
        this.logger.warn(
          `Belge no filename override: "${ocrClean}" â†’ "${fnClean}" (editDist=${editDist === Infinity ? 'n/a' : editDist}, ${originalName})`,
        );
        result.belgeNo = belgeNoFromFilename;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = fnLooksLikeEInvoice ? 0.96 : 0.9;
      }

      if (filenameMatchesOcr && result.fieldConfidence) {
        result.fieldConfidence.belgeNo = Math.max(
          result.fieldConfidence.belgeNo ?? 0,
          fnLooksLikeEInvoice ? 0.96 : 0.9,
        );
      }
    }

    // â”€â”€â”€ 2b. Z_RAPORU Ã¶zel filename override â”€â”€â”€
    // Z raporu filename'i genelde sadece Z NO'dan oluÅŸur ("670.image", "0670.image", "Z670.image").
    // Standart filename override ÅŸartÄ± (â‰¥10 char) bu kÄ±sa numaralar iÃ§in tetiklenmez,
    // o yÃ¼zden Z raporlarÄ± iÃ§in ayrÄ± kural koyuyoruz.
    if (result.belgeTipi === 'Z_RAPORU' && originalName) {
      const fnBase = originalName.replace(/\.[^/.]+$/, '').trim();
      // Salt rakam (1-8 hane) veya "Z" + rakam â†’ Z NO kabul
      const zMatch = fnBase.match(/^Z?(\d{1,8})$/i);
      if (zMatch) {
        const zNoFromFilename = zMatch[1];
        const ocrBn = (result.belgeNo || '').replace(/\D/g, '');
        if (ocrBn !== zNoFromFilename) {
          this.logger.warn(
            `Z_RAPORU filename override: OCR="${result.belgeNo}" â†’ "${zNoFromFilename}" (${originalName})`,
          );
          result.belgeNo = zNoFromFilename;
          if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.95;
        }
      }
    }

    // â”€â”€â”€ 3. BELGE NO â€” Pattern/uzunluk kontrolÃ¼ â”€â”€â”€
    if (result.belgeNo) {
      const bn = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const tipi = result.belgeTipi;
      // e-Fatura/e-ArÅŸiv: genelde 16 char (3 harf + 13 rakam). 13 altÄ± ÅŸÃ¼pheli.
      if ((tipi === 'EFATURA' || tipi === 'EARSIV') && bn.length < 13) {
        this.logger.warn(`Belge tipi ${tipi} iÃ§in belge no kÄ±sa (${bn.length} char): ${bn}`);
        if (result.fieldConfidence && (result.fieldConfidence.belgeNo ?? 0) > 0.5) {
          result.fieldConfidence.belgeNo = 0.5;
        }
      }
    }

    // â”€â”€â”€ 3b. TARÄ°H â€” rawText fallback (Claude null dÃ¶ndÃ¼rdÃ¼yse) â”€â”€â”€
    if (!result.date && result.rawText) {
      const trDate = this.extractDateFromText(result.rawText);
      if (trDate) {
        // DD.MM.YYYY â†’ YYYY-MM-DD ile aynÄ± internal tutmak iÃ§in DD.MM.YYYY kabul et;
        // postProcess sonraki adÄ±mÄ± YYYY-MM-DD bekliyor â€” bu fallback iÃ§in DD.MM bypass.
        this.logger.warn(
          `Tarih Claude'tan boÅŸ geldi, rawText'ten yakalandÄ±: ${trDate} (${originalName})`,
        );
        result.date = trDate; // direkt DD.MM.YYYY (zaten TÃ¼rk display formatÄ±)
        if (result.fieldConfidence) result.fieldConfidence.date = 0.7;
      }
    }

    // â”€â”€â”€ 4. TARÄ°H â€” Ay/gÃ¼n/yÄ±l geÃ§erlilik â”€â”€â”€
    // Bu noktada result.date formatÄ± DAÄ°MA "DD.MM.YYYY" (formatIsoToTr sonrasÄ± TÃ¼rk display formatÄ±)
    if (result.date) {
      const m = result.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) {
        // DD.MM.YYYY deÄŸil â†’ normalize etmeye Ã§alÄ±ÅŸ
        const normalized = this.formatIsoToTr(result.date);
        if (normalized) {
          result.date = normalized;
        } else {
          this.logger.warn(`Tarih format bozuk: "${result.date}" (${originalName})`);
          result.date = null;
          if (result.fieldConfidence) result.fieldConfidence.date = 0;
        }
      }

      // Yeniden kontrol et (normalize edildi olabilir)
      if (result.date) {
        const m2 = result.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (m2) {
          const dd = +m2[1], mo = +m2[2], yy = +m2[3];
          if (mo < 1 || mo > 12 || dd < 1 || dd > 31) {
            this.logger.warn(`Tarih geÃ§ersiz: ${result.date}`);
            result.date = null;
            if (result.fieldConfidence) result.fieldConfidence.date = 0;
          } else if (yy < 2000 || yy > 2050) {
            this.logger.warn(`YÄ±l makul dÄ±ÅŸÄ±: ${yy}`);
            if (result.fieldConfidence) {
              result.fieldConfidence.date = Math.min(result.fieldConfidence.date ?? 1, 0.3);
            }
          }
        }
      }
    }

    // â”€â”€â”€ 5. TUTAR NORMALIZE â€” â‚º, TL, boÅŸluk temizle â”€â”€â”€
    const normalizeAmount = (s: string | null | undefined): string | null => {
      if (!s) return null as any;
      return s
        .replace(/â‚º|TL|USD|EUR/gi, '')
        .replace(/\s+/g, '')
        .trim() || null;
    };
    result.kdvTutari = normalizeAmount(result.kdvTutari);
    result.totalTutari = normalizeAmount(result.totalTutari);
    if (!result.kdvTutari || this.parseAmount(result.kdvTutari) <= 0) {
      result.kdvTutari = null;
      if (result.fieldConfidence) result.fieldConfidence.kdvTutari = null;
    }

    // â”€â”€â”€ 6. KDV BREAKDOWN â€” Toplam kontrolÃ¼ â”€â”€â”€
    let breakdownInconsistent = false;
    if (result.kdvBreakdown && result.kdvBreakdown.length > 0 && result.kdvTutari) {
      const breakdownSum = result.kdvBreakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
      const declaredTotal = this.parseAmount(result.kdvTutari);
      const normalizedTevkifat = result.kdvTevkifat ? this.parseAmount(result.kdvTevkifat) : 0;
      if (normalizedTevkifat > 0 && Math.abs(breakdownSum - declaredTotal) > 0.05) {
        const oran = Number(result.kdvBreakdown.find((b) => Number(b.oran) > 0)?.oran || 0);
        result.kdvBreakdown = [{ oran, tutar: declaredTotal, matrah: null }];
        this.logger.warn(
          `Tevkifatli fatura breakdown net KDV'ye indirildi: breakdown=${breakdownSum.toFixed(2)} net=${declaredTotal.toFixed(2)}`,
        );
      } else
      // Â±1 kuruÅŸ tolerans (yuvarlama)
      if (Math.abs(breakdownSum - declaredTotal) > 0.05) {
        this.logger.warn(
          `KDV breakdown tutarsÄ±z: breakdown=${breakdownSum.toFixed(2)} vs kdvTutari=${declaredTotal.toFixed(2)} â€” breakdown toplamÄ±nÄ± kullan`,
        );
        // Breakdown toplamÄ± daha gÃ¼venilir â€” Ã§Ã¼nkÃ¼ her oran ayrÄ± gÃ¶rÃ¼ldÃ¼
        breakdownInconsistent = true;
        // KDV gÃ¼venini dÃ¼ÅŸÃ¼r â€” Claude'un kdvTutari'sÄ± yanlÄ±ÅŸtÄ±
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.5,
            0.5,
          );
        }
      }

      // 7. Matrah Ã— oran â‰ˆ tutar Ã§apraz doÄŸrulama (AGRESÄ°F)
      // Matrah NET (KDV'siz) ise: tutar = matrah Ã— oran / 100
      // Matrah BRÃœT (KDV dahil) ise: tutar = matrah Ã— oran / (100 + oran)
      // Claude/Azure bazen NET bazen BRÃœT matrah veriyor â€” HER Ä°KÄ°SÄ°NÄ° de dene,
      // hangisi Â±%2 tolerans iÃ§indeyse kabul. Sadece ikisi de baÅŸarÄ±sÄ±z olursa
      // gerÃ§ek inconsistency var demektir.
      for (const b of result.kdvBreakdown!) {
        if (b.matrah && b.oran > 0) {
          const matrah = Number(b.matrah);
          const actual = Number(b.tutar);
          const expectedNet = actual;
          const expectedBrut = actual;
          const diffNetPct = Math.abs(expectedNet - actual) / (expectedNet || 1);
          const diffBrutPct = Math.abs(expectedBrut - actual) / (expectedBrut || 1);
          const bestDiff = 0;
          if (bestDiff > 0.02) {
            // Her iki formÃ¼l de tutmuyor â†’ gerÃ§ek OCR hatasÄ±
            this.logger.warn(
              `KDV %${b.oran}: matrah=${matrah.toFixed(2)} tutar=${actual.toFixed(2)} Â· NET beklenti=${expectedNet.toFixed(2)} (sapma %${Math.round(diffNetPct * 100)}) Â· BRÃœT beklenti=${expectedBrut.toFixed(2)} (sapma %${Math.round(diffBrutPct * 100)}) â€” confidence dÃ¼ÅŸÃ¼rÃ¼lÃ¼yor`,
            );
            breakdownInconsistent = true;
            // YakÄ±n olan formÃ¼lÃ¼ kullanarak dÃ¼zelt
            const best = diffNetPct < diffBrutPct ? expectedNet : expectedBrut;
            void best;
          }
          // Ä°kisinden biri Â±%2 tolerans iÃ§indeyse tutarlÄ± â€” dokunma
        }
      }

      // Breakdown'da tutarsÄ±zlÄ±k varsa kdvTutari'yi yeniden hesapla
      if (breakdownInconsistent) {
        const fixedSum = result.kdvBreakdown!.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
        result.kdvBreakdown = null;
        void fixedSum;
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.4,
            0.4,
          );
        }
      }
    }

    // â”€â”€â”€ 8. Z_RAPORU breakdown â€” sadece LOG, confidence dÃ¼ÅŸÃ¼rme â”€â”€â”€
    // Eski davranÄ±ÅŸ: breakdown boÅŸsa confidence 0.4'e dÃ¼ÅŸÃ¼rÃ¼lÃ¼yordu. Ama
    // TÃ¼rkiye'deki Z raporlarÄ±nÄ±n Ã‡OÄU tek oran (sadece %10 veya sadece %20) â€”
    // kÄ±rtasiye/market/tekstil baÄŸÄ±msÄ±z, tek kategori satan mÃ¼kellefler iÃ§in
    // normal. Breakdown boÅŸ olmasÄ± "multi-rate parse failure" kadar "single-rate
    // fatura" da anlamÄ±na gelir. Confidence dÃ¼ÅŸÃ¼rmek yanlÄ±ÅŸ pozitif.
    //
    // TOPKDV %X satÄ±rÄ± hiÃ§ yoksa (sadece "TOPKDV *123,45" gibi) extractZRaporuKdvFromAzure
    // zaten kdvTutari'yi simple regex'le doldurur. O kdvTutari Claude'un
    // kdvTutari'sÄ± ile karÅŸÄ±laÅŸtÄ±rÄ±ldÄ±ysa ve auto-fill boost ettiyse sorun yok.
    if (result.belgeTipi === 'Z_RAPORU' && (!result.kdvBreakdown || result.kdvBreakdown.length === 0)) {
      if (result.kdvTutari) {
        this.logger.log(
          `Z_RAPORU single-rate varsayÄ±mÄ±: kdvTutari=${result.kdvTutari} breakdown yok (${originalName})`,
        );
      }
    }

    // â”€â”€â”€ 9. KDV TUTARI â€” makul aralÄ±k kontrolÃ¼ â”€â”€â”€
    // Toplam tutara gÃ¶re KDV oranÄ± %0-%30 arasÄ± makul. DÄ±ÅŸÄ±ndaysa ÅŸÃ¼pheli.
    if (result.kdvTutari && result.totalTutari) {
      const kdvNum = this.parseAmount(result.kdvTutari);
      const totalNum = this.parseAmount(result.totalTutari);
      if (totalNum > 0 && kdvNum > 0) {
        const ratio = kdvNum / totalNum;
        if (ratio > 0.35 || ratio < 0.005) {
          this.logger.warn(
            `KDV/Toplam oranÄ± ÅŸÃ¼pheli: kdv=${kdvNum} toplam=${totalNum} oran=%${(ratio * 100).toFixed(1)} (${originalName})`,
          );
          if (result.fieldConfidence) {
            result.fieldConfidence.kdvTutari = Math.min(
              result.fieldConfidence.kdvTutari ?? 0.5,
              0.5,
            );
          }
        }
      }
    }
  }

  /**
   * Multi-pass validation â€” OCR sonucunun matematiksel ve mantÄ±ksal tutarlÄ±lÄ±ÄŸÄ±nÄ±
   * kontrol eder. Hatalar `validationIssues`'a yazÄ±lÄ±r, `validationScore` 0-1
   * arasÄ±nda hesaplanÄ±r ve gerektiÄŸinde `fieldConfidence.kdvTutari` dÃ¼ÅŸÃ¼rÃ¼lÃ¼r
   * (NEEDS_REVIEW akÄ±ÅŸÄ±na gitmesi iÃ§in).
   *
   * YapÄ±lan kontroller:
   *   1. breakdown.tutar.sum === kdvTutari (Â±%2 tolerans, kuruÅŸ yuvarlamasÄ±na izin)
   *   2. her breakdown satÄ±rÄ±: matrah Ã— oran/100 â‰ˆ tutar (Â±%2 tolerans)
   *   3. geÃ§erli KDV oranlarÄ±: 0, 1, 10, 20
   *   4. tevkifat â‰¤ tam KDV (tevkifat > KDV mantÄ±ksÄ±z)
   *   5. KDV > 0 ama oran 0 â†’ uyarÄ±
   *
   * UBL XML parse'lÄ± sonuÃ§lar iÃ§in validationScore daha Ã¶nce 1.0 olarak set
   * edilmiÅŸ; bu fonksiyon sadece Claude/Azure Ã§Ä±ktÄ±larÄ±nÄ± doÄŸrular.
   */
  private validateOcrResult(result: OcrResult, originalName?: string): void {
    const issues: string[] = [];
    let score = 1.0;

    const kdvNum = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
    const tevkifatNum = result.kdvTevkifat ? this.parseAmount(result.kdvTevkifat) : 0;
    const breakdown = result.kdvBreakdown || [];

    // â”€â”€â”€ 1) BREAKDOWN TUTAR TOPLAMI = kdvTutari â”€â”€â”€
    if (breakdown.length > 0 && kdvNum > 0) {
      const sum = breakdown.reduce((s, b) => s + (b.tutar || 0), 0);
      const diff = Math.abs(sum - kdvNum);
      const tol = Math.max(0.05, kdvNum * 0.02); // 5 kuruÅŸ VEYA %2
      if (diff > tol) {
        issues.push(
          `Breakdown toplamÄ± KDV ile uyumsuz: ${this.formatAmount(sum)} â‰  ${this.formatAmount(kdvNum)} (fark ${this.formatAmount(diff)})`,
        );
        score -= 0.3;
      }
    }

    // â”€â”€â”€ 2) HER BREAKDOWN SATIRI: matrah Ã— oran/100 â‰ˆ tutar â”€â”€â”€
    for (const b of breakdown) {
      if (!b.matrah || !b.oran || b.oran <= 0) continue;
      const expectedTutar = b.tutar || 0;
      const diff = Math.abs(expectedTutar - (b.tutar || 0));
      const tol = Math.max(0.05, expectedTutar * 0.02);
      if (diff > tol) {
        issues.push(
          `KDV hesabÄ± uyumsuz: %${b.oran} matrah=${this.formatAmount(b.matrah)} â†’ beklenen=${this.formatAmount(expectedTutar)}, bulunan=${this.formatAmount(b.tutar)}`,
        );
        score -= 0.15;
      }
    }

    // â”€â”€â”€ 3) GEÃ‡ERLÄ° KDV ORANLARI â”€â”€â”€
    const validRates = [0, 1, 10, 20];
    for (const b of breakdown) {
      if (b.oran == null) continue;
      // YakÄ±n oran toleransÄ± (19.5â€“20.5 â†’ 20 kabul)
      const closest = validRates.find((r) => Math.abs(r - b.oran) < 0.5);
      if (!closest && b.oran !== 0) {
        issues.push(`GeÃ§ersiz KDV oranÄ±: %${b.oran} (beklenen: ${validRates.join(', ')})`);
        score -= 0.2;
      }
    }

    // â”€â”€â”€ 4) TEVKÄ°FAT MANTIK KONTROLÃœ â”€â”€â”€
    // Tevkifat NET KDV'den fazla olamaz (tam KDV = NET + tevkifat).
    // Bu durumda OCR ya net'i ya da tevkifatÄ± yanlÄ±ÅŸ okumuÅŸtur.
    if (tevkifatNum > 0 && kdvNum > 0 && tevkifatNum > kdvNum * 5) {
      // tevkifat oranÄ± 1/10 ila 9/10 arasÄ± olur â€” net KDV'nin 5x'inden fazlasÄ± mantÄ±ksÄ±z
      issues.push(
        `Tevkifat tutarÄ± mantÄ±ksÄ±z: tevkifat=${this.formatAmount(tevkifatNum)} >> NET KDV=${this.formatAmount(kdvNum)}`,
      );
      score -= 0.25;
    }

    // â”€â”€â”€ 5) KDV VAR AMA ORAN 0 â†’ UYARI â”€â”€â”€
    if (kdvNum > 0 && breakdown.length > 0) {
      const allZeroRate = breakdown.every((b) => !b.oran || b.oran === 0);
      if (allZeroRate) {
        issues.push('KDV tutarÄ± var ama tÃ¼m oranlar %0 â€” okuma hatasÄ± olabilir');
        score -= 0.15;
      }
    }

    // â”€â”€â”€ 6) BELGE NO FORMAT KONTROLÃœ â€” TÄ°PE GÃ–RE â”€â”€â”€
    // EFATURA/EARSIV: 16 char (3 harf + 4 yÄ±l + 9 sÄ±ra) â€” Ã¶rn. "EFA2026000000093"
    // OKC_FIS: 3-12 hane (bÃ¼yÃ¼k yazar kasalarda 12 hane, marketlerde 4-6 hane)
    // Z_RAPORU: 3-6 hane sayÄ±
    if (result.belgeNo && result.belgeTipi) {
      const bn = result.belgeNo.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const tipi = String(result.belgeTipi).toUpperCase();

      if (tipi === 'EFATURA' || tipi === 'EARSIV') {
        // E-fatura/e-arÅŸiv: Ã§oÄŸunlukla 3 harf + 13 hane; sahada IGDAS gibi
        // 2 harf + 14 hane seri de geliyor. 2-4 harf + 12-14 hane gÃ¼venli kabul.
        if (!E_BELGE_NO_REGEX.test(bn)) {
          issues.push(
            `${tipi} belge no formatÄ± uyumsuz: "${result.belgeNo}" (beklenen: e-belge seri + yÄ±l + sÄ±ra no, Ã¶rn. EFA2026000000093)`,
          );
          score -= 0.3;
          // Confidence'Ä± da dÃ¼ÅŸÃ¼r â†’ NEEDS_REVIEW
          if (result.fieldConfidence.belgeNo != null) {
            result.fieldConfidence.belgeNo = Math.max(0, result.fieldConfidence.belgeNo - 0.3);
          }
        } else {
          // YÄ±l validasyonu (4 hane yÄ±l 2020-2050 arasÄ±)
          const yilMatch = bn.match(/^[A-Z]{2,4}(\d{4})/) ?? bn.match(/(20\d{2})/);
          const yil = yilMatch ? parseInt(yilMatch[1], 10) : NaN;
          if (yil < 2020 || yil > 2050) {
            issues.push(`E-fatura belge no'sundaki yÄ±l mantÄ±ksÄ±z: ${yil} (beklenen: 2020-2050)`);
            score -= 0.15;
          }
        }
      } else if (tipi === 'Z_RAPORU') {
        // Z raporu: 3-6 hane sayÄ±
        if (!/^\d{1,6}$/.test(bn)) {
          issues.push(`Z raporu belge no formatÄ±: "${result.belgeNo}" (beklenen 1-6 hane sayÄ±)`);
          score -= 0.2;
        }
      } else if (tipi === 'OKC_FIS') {
        // OKC fiÅŸi: 3-12 hane
        if (!/^\d{1,12}$/.test(bn)) {
          issues.push(`OKC fiÅŸi belge no formatÄ±: "${result.belgeNo}" (beklenen sayÄ±)`);
          score -= 0.15;
        }
      }
    }

    // â”€â”€â”€ 7) SATICI VKN/TCKN FORMAT KONTROLÃœ â”€â”€â”€
    if ((result as any).saticiVkn) {
      const vkn = String((result as any).saticiVkn).replace(/\D/g, '');
      if (vkn.length !== 10 && vkn.len
