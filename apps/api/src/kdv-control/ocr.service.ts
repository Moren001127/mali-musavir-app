import { Injectable, Logger } from '@nestjs/common';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { canSpendOnApiGlobal } from '../common/ai-usage-logger';
import {
  extractDate as extractDatePure,
  normalizeOcrYear as normalizeOcrYearPure,
} from './ocr/parsers/date';
import { extractBelgeNo as extractBelgeNoPure } from './ocr/parsers/belge-no';
import {
  extractSaticiVkn as extractSaticiVknPure,
  extractSaticiUnvan as extractSaticiUnvanPure,
} from './ocr/parsers/vendor';
import {
  isLikelyStandaloneTaxRate as isLikelyStandaloneTaxRatePure,
  isMatrahOrRateLine as isMatrahOrRateLinePure,
  isKdvTableHeaderLine as isKdvTableHeaderLinePure,
  isForbiddenKdvAmountLine as isForbiddenKdvAmountLinePure,
  isLikelyKdvAmountColumnHeader as isLikelyKdvAmountColumnHeaderPure,
} from './ocr/parsers/text-classifiers';
import {
  decodeXmlText as decodeXmlTextPure,
  getXmlTagValue as getXmlTagValuePure,
  getXmlBlocks as getXmlBlocksPure,
  stripXmlBlocks as stripXmlBlocksPure,
  parseXmlAmount as parseXmlAmountPure,
} from './ocr/parsers/xml-helpers';
import { parseUblXml as parseUblXmlPure } from './ocr/providers/ubl';
import { runClaudeVisionOcr as runClaudeVisionOcrPure } from './ocr/providers/claude';
import { crossCheckWithAzure as crossCheckWithAzurePure } from './ocr/validation/cross-check';
import {
  postProcessOcrResult as postProcessOcrResultPure,
  validateOcrResult as validateOcrResultPure,
} from './ocr/validation/post-process';
import {
  extractOkcFisKdv as extractOkcFisKdvPure,
  extractOkcFisItemRateBreakdown as extractOkcFisItemRateBreakdownPure,
} from './ocr/providers/azure/okc-fis';
import {
  parseTevkifatRate as parseTevkifatRatePure,
  extractTevkifatliFatura as extractTevkifatliFaturaPure,
} from './ocr/providers/azure/tevkifatli-fatura';
import {
  extractMultiRateKdv as extractMultiRateKdvPure,
  extractKdvFromInvoiceTotals as extractKdvFromInvoiceTotalsPure,
} from './ocr/providers/azure/kdv-breakdown';
import {
  extractMultiRateKdvFromItemRows as extractMultiRateKdvFromItemRowsPure,
  extractHesMatrahKdvTable as extractHesMatrahKdvTablePure,
} from './ocr/providers/azure/kdv-item-rows';
import { extractZRaporuKdv as extractZRaporuKdvPure } from './ocr/providers/azure/z-raporu';
import {
  normalizeAzureText as normalizeAzureTextPure,
  stripMatrahFragments as stripMatrahFragmentsPure,
  foldTurkishAscii as foldTurkishAsciiPure,
  detectBelgeTipi as detectBelgeTipiPure,
  extractMoneyAmounts as extractMoneyAmountsPure,
  inferTevkifatFromAzureAmounts as inferTevkifatFromAzureAmountsPure,
} from './ocr/providers/azure/helpers';
import {
  extractKdvOnlyFromTelekom as extractKdvOnlyFromTelekomPure,
  extractElectricityKdv as extractElectricityKdvPure,
} from './ocr/providers/azure/sectoral';

/** Çok oranlı KDV kırılımı — Z raporu veya karma oranlı fatura için */
export interface KdvBreakdownItem {
  /** KDV oranı (%) — 1, 10, 20 */
  oran: number;
  /** Matrah (KDV hariç tutar) - opsiyonel, OCR'dan alınabilirse */
  matrah?: number | null;
  /** KDV tutarı (TL) */
  tutar: number;
}

export interface OcrResult {
  rawText: string;
  belgeNo: string | null;
  date: string | null;
  /** NET KDV — tevkifatlı faturada (tam KDV − tevkifat). Reconciliation'da Luca ile karşılaştırılan değer. */
  kdvTutari: string | null;
  /** Tevkifat tutarı (TL) — varsa; tevkifatsız faturada null veya "0,00". */
  kdvTevkifat?: string | null;
  totalTutari: string | null;
  /** Satıcı/tedarikçi unvanı — aynı belge no'lu farklı firmaları ayırmak için reconciliation'da kullanılır. */
  satici?: string | null;
  /** Satıcı VKN/TCKN (10 veya 11 hane) — reconciliation'da primary match key */
  saticiVkn?: string | null;
  /** Belge tipi: EFATURA, EARSIV, OKC_FIS, Z_RAPORU, MAKBUZ */
  belgeTipi?: string | null;
  /** Çok oranlı KDV kırılımı (varsa) — Z raporu/karma fatura. tutar = NET (tevkifat düşülmüş). */
  kdvBreakdown?: KdvBreakdownItem[] | null;
  /** Otomatik gider kategorisi: yakit, yemek, kirtasiye, telekom, kira, vb. */
  kategori?: string | null;
  /** Görüntünün SHA-256 hash'i — caller cache kontrolü için kullanır */
  imageHash?: string;
  /** Genel güven skoru (geriye dönük uyumluluk) */
  confidence: number;
  /** Alan-bazlı güven skorları (0–1). Null ise alan bulunamadı. */
  fieldConfidence: {
    belgeNo: number | null;
    date: number | null;
    kdvTutari: number | null;
  };
  /**
   * Multi-pass validation skoru (0–1):
   *   • breakdown.tutar.sum === kdvTutari (1.0 = tam, 0.5 = ±%5 tolerans)
   *   • matrah × oran/100 === tutar (her satır)
   *   • geçerli KDV oranları (0/1/8/10/18/20)
   *   • tevkifat ≤ kdvTutari mantık kontrolü
   * UBL XML doğrudan parse edildiyse 1.0; aksi halde validateOcrResult() hesaplar.
   */
  validationScore?: number | null;
  /** Validation hataları — confidence düşürme/UI uyarı için */
  validationIssues?: string[];
  engine: string;
  /** Claude API response'undan gelen token kullanımı — maliyet hesabı için. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** USD cinsinden tahmini maliyet (input $1/M + output $5/M Haiku 4.5 fiyat) */
    costUsd: number;
  };
}

export interface ExtractOcrOptions {
  /** Kullanıcı açıkça "AI ile zorla oku" dediğinde Azure-first kısa devresini atlar. */
  forceClaude?: boolean;
}

/** Claude model fiyatları ($/M token) */
const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

/**
 * Varsayılan OCR modeli — Haiku 4.5 (ucuz, $0.0025/belge).
 * Hallucination'lara karşı Azure OCR cross-check (2. tanık) + alan bazlı validation kullanılıyor.
 * Sonnet'e çıkmak için ENV: OCR_MODEL=claude-sonnet-4-5
 */
const DEFAULT_OCR_MODEL = 'claude-haiku-4-5-20251001';

/** Alan-bazlı güven eşiği; altındaki alanlar kullanıcı teyidine gider */
export const FIELD_CONFIDENCE_THRESHOLD = 0.7;

const E_BELGE_NO_REGEX = /^(?:[A-Z]{2,4}\d{12,14}|[A-Z]\d{2}20\d{2}\d{6,12}|\d{13,20})$/;

/** Log için confidence'ı kısa yazı — %84 veya "—" */
const fmtConf = (v: number | null | undefined): string =>
  typeof v === 'number' ? `%${Math.round(v * 100)}` : '—';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private azureClient: ComputerVisionClient | null = null;

  constructor(private readonly prisma: PrismaService) {
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
  /** Görüntü buffer'ından SHA-256 hash hesapla — cache anahtarı olarak kullanılır */
  computeImageHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async extractFromImage(
    imageBuffer: Buffer,
    originalName?: string,
    options: ExtractOcrOptions = {},
  ): Promise<OcrResult> {
    const belgeNoFromFilename = this.extractBelgeNoFromFilename(originalName);
    const hasClaudeKey = process.env.MOREN_AI_ALLOW_ANTHROPIC_API === '1' && !!process.env.ANTHROPIC_API_KEY;
    const forceClaude = options.forceClaude === true;
    const allowAutoClaude =
      process.env.KDV_OCR_AUTO_CLAUDE === 'true' ||
      process.env.OCR_AUTO_CLAUDE === 'true';
    const imageHash = this.computeImageHash(imageBuffer);
    this.logger.log(
      `OCR başladı: ${originalName || '—'} · ${imageBuffer.byteLength}B · hash=${imageHash.slice(0, 8)}... · Claude:${hasClaudeKey ? '✓' : '✗'} Azure:${this.azureClient ? '✓' : '✗'} forceClaude:${options.forceClaude ? '✓' : '✗'}`,
    );

    // ═══════════════════════════════════════════════════════
    // 0. XML DOĞRUDAN PARSE — UBL e-Fatura/e-Arşiv
    // ═══════════════════════════════════════════════════════
    // İçerik gerçekten XML mi? (binary image değil)
    // Head 512 byte tek başına güvenli değil — bazı Mihsap XML'leri BOM, HTML
    // wrapper veya whitespace ile başlıyor olabilir. Bu nedenle ilk 4 KB'ye
    // kadar UBL marker aranır. Ayrıca uzantı .xml ise content ASCII-düzeyinde
    // (binary/image değil) olduğu sürece XML'e zorlarız.
    const head4k = imageBuffer.slice(0, Math.min(4096, imageBuffer.byteLength)).toString('utf8');
    // HTML kontrolü ÖNCE yapılmalı: e-Arşiv HTML dosyaları içinde UBL XML etiketleri
    // (<ArchiveInvoice>, <Invoice> vb.) bulunabilir. isHtml guard olmadan bu dosyalar
    // XML parser'a düşer, XML parse başarısız olur → %0 confidence döner.
    const head512Lower = imageBuffer.slice(0, 512).toString('utf8').trimStart().toLowerCase();
    // isImageMagic ÖNCE hesaplanmalı — JPEG/PNG uzantısı .html bile olsa image OCR'a gitmeli
    const isImageMagic =
      imageBuffer.length > 4 && (
        (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) || // PNG
        (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) || // JPEG
        (imageBuffer[0] === 0x25 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x44) || // PDF
        (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49) || // GIF
        (imageBuffer[0] === 0x49 && imageBuffer[1] === 0x49) || // TIFF
        (imageBuffer[0] === 0x42 && imageBuffer[1] === 0x4d)    // BMP
      );
    const isHtml =
      !isImageMagic && (
        /\.html?$/i.test(originalName || '') ||
        head512Lower.startsWith('<!doctype html') ||
        head512Lower.startsWith('<html') ||
        /<html[\s>]/i.test(head4k)
      );

    const hasUblMarker =
      /<\?xml/i.test(head4k) ||
      /<Invoice[\s>]/i.test(head4k) ||
      /<ArchiveInvoice[\s>]/i.test(head4k) ||
      /<cbc:ID>/i.test(head4k) ||
      /<cac:TaxTotal>/i.test(head4k) ||
      /<cac:LegalMonetaryTotal>/i.test(head4k) ||
      /UBL-TR|UBL\s*Invoice/i.test(head4k);
    // Uzantı xml ise ve içerik gerçekten XML-benzeri ASCII ise (image magic bytes yok) XML kabul et
    const filenameIsXml = /\.xml$/i.test(originalName || '');
    // HTML dosyaları XML parser'a DÜŞMESİN (isHtml guard)
    const isXml = !isHtml && (hasUblMarker || (filenameIsXml && !isImageMagic));
    this.logger.log(`Dosya tipi: ${originalName || '—'} · isHtml=${isHtml} isXml=${isXml} hasUblMarker=${hasUblMarker}`);

    if (isXml) {
      try {
        const xmlResult = this.parseUblXml(imageBuffer.toString('utf8'));
        if (xmlResult && (xmlResult.belgeNo || xmlResult.date || xmlResult.kdvTutari)) {
          // Dosya adıyla belge no'yu reconcile et — filename override güvence
          if (belgeNoFromFilename && xmlResult.belgeNo !== belgeNoFromFilename) {
            const fnClean = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const xmlClean = (xmlResult.belgeNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (fnClean !== xmlClean && fnClean.length >= xmlClean.length) {
              this.logger.warn(
                `XML belge no filename'den farklı, filename kullanılıyor: xml=${xmlClean} filename=${fnClean}`,
              );
              xmlResult.belgeNo = belgeNoFromFilename;
            }
          }
          this.logger.log(
            `XML parse başarılı: ${originalName} · belgeNo=${xmlResult.belgeNo} date=${xmlResult.date} kdv=${xmlResult.kdvTutari} breakdown=${xmlResult.kdvBreakdown?.length || 0}`,
          );
          // BUG FIX (WASH faturasi): XML path da postProcess pipeline'ina sokulmali.
          // Salt-rate guard ve KDV/Toplam oran kontrolu XML icin de aktif olmali —
          // yoksa "20" gibi yanlis okumalar yakalanmiyor.
          this.postProcessOcrResult(xmlResult, belgeNoFromFilename, originalName);
          return xmlResult;
        }
        // XML parse boş döndü → manuel review için filename only dön (image OCR XML'de işe yaramaz)
        this.logger.warn(
          `XML parse başarısız (${originalName}): belge no/date/kdv bulunamadı, filename-only döndürülüyor`,
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
        this.logger.warn(`XML parse hatası (${originalName}): ${e?.message}`);
        // Parse exception → filename only
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
    // .xml uzantılı ama içerik binary (gerçekte image) → image OCR'a düş

    // ═══════════════════════════════════════════════════════
    // 0b. HTML E-ARŞİV — HTML dosyaları Azure OCR'a verilmez; text ayıklanır.
    //     (isHtml yukarıda hesaplandı — XML guard için önce tanımlanması gerekiyordu)
    // ═══════════════════════════════════════════════════════
    if (isHtml) {
      const htmlText = imageBuffer.toString('utf8');
      // HTML etiketlerini sil; birden fazla boşluk/satır sıkıştır
      const plainText = htmlText
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        // Blok-seviye etiketler → satır sonu; yoksa tüm metin tek satır olur,
        // tarih parser'ı "FATURA TARİHİ" (+100) ve "SON ÖDEME" (-120) aynı
        // satırda görüp net skoru 40 < 50 yapar → null döner.
        .replace(/<\/?(tr|td|th|div|p|br|li|dt|dd|section|article|h[1-6])\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
        .replace(/\x00/g, '') // PostgreSQL UTF8: NULL byte kabul etmez
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      this.logger.log(`HTML e-arşiv text ayıklama: ${originalName} · ${plainText.length} char`);
      // Text'ten alan çıkar (Azure runner'ın text parser'ları gibi)
      const date = this.extractPreferredInvoiceDate(plainText) ?? this.extractDate(plainText);
      const bodyBelgeNo = this.extractBelgeNo(plainText);
      const belgeNo = belgeNoFromFilename ?? bodyBelgeNo;
      const kdvTotal = this.extractKdvTotal(plainText);
      const invoiceTotalsKdv = kdvTotal ? null : this.extractKdvFromInvoiceTotalsAzure(plainText);
      const kdv = kdvTotal ?? (invoiceTotalsKdv ? this.formatAmount(invoiceTotalsKdv.kdv) : null);
      // HTML e-arşiv: satıcı üst satırda olmayabilir (abone bilgisi önce gelir → stop erken tetiklenir).
      // Fallback: tam metinde A.Ş./Anonim/Ltd. içeren satırı ara.
      let satici = this.extractSaticiFromAzure(plainText);
      if (!satici) {
        for (const ln of plainText.split('\n')) {
          const t = ln.trim();
          if (t.length < 8 || t.length > 250) continue;
          const folded = this.foldTurkishAscii(t);
          if (
            /\b(?:ANONIM|ANONIM SIRKETI?|LIMITED|LTD|STI|TELEKOMUNIKASYON|ELEKTRIK|DOGALGAZ)\b/.test(folded) &&
            !/\b(?:SAYIN|ALICI|MUSTERI|VKN|TCKN|FATURA NO|BELGE NO)\b/.test(folded)
          ) {
            satici = t.slice(0, 200);
            break;
          }
        }
      }
      const saticiVkn = this.extractSaticiVknFromAzure(plainText);
      const foundFields = [belgeNo, date, kdv].filter(Boolean).length;
      const confidence = belgeNoFromFilename ? 0.3 + (foundFields / 3) * 0.7 : foundFields / 3;
      const htmlResult: OcrResult = {
        rawText: plainText.slice(0, 3000),
        belgeNo,
        date,
        kdvTutari: kdv,
        kdvTevkifat: null,
        totalTutari: null,
        satici,
        saticiVkn,
        belgeTipi: 'EARSIV',
        confidence,
        fieldConfidence: {
          belgeNo: belgeNo ? (belgeNoFromFilename && belgeNo === belgeNoFromFilename ? 0.95 : 0.72) : null,
          date: date ? 0.72 : null,
          kdvTutari: kdv ? 0.72 : null,
        },
        engine: 'html-text',
      };
      this.postProcessOcrResult(htmlResult, belgeNoFromFilename, originalName);
      this.logger.log(`HTML OCR: ${originalName} · belgeNo=${belgeNo} date=${date} kdv=${kdv} conf=%${Math.round(confidence * 100)}`);
      return htmlResult;
    }

    // ═══════════════════════════════════════════════════════
    // 1. AZURE-FIRST OCR — ucuz ham OCR + deterministik parser'lar.
    //    Claude sadece Azure sonucu eksik/çelişkili/düşük güvenliyse devreye girer.
    // ═══════════════════════════════════════════════════════
    let azureRawText = '';

    if (this.azureClient && !forceClaude) {
      try {
        const azureResult = await this.runAzureOcr(imageBuffer, belgeNoFromFilename, originalName);
        azureRawText = azureResult.rawText || '';
        const review = this.needsReview(azureResult);
        if (!review.needs) {
          this.logger.log(
            `Azure-first başarılı: ${originalName || '—'} · belgeNo=${azureResult.belgeNo || '—'} date=${azureResult.date || '—'} kdv=${azureResult.kdvTutari || '—'} validation=%${Math.round((azureResult.validationScore ?? 0) * 100)}`,
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
            `Azure-first teyit gerektiriyor ve Claude yok: ${originalName || '—'} · reason=${review.reason}`,
          );
          return azureResult;
        }
        this.logger.warn(
          `Azure-first Claude eskalasyon: ${originalName || '—'} · reason=${review.reason} · belgeNo=${fmtConf(azureResult.fieldConfidence.belgeNo)} date=${fmtConf(azureResult.fieldConfidence.date)} kdv=${fmtConf(azureResult.fieldConfidence.kdvTutari)}`,
        );
      } catch (e: any) {
        this.logger.warn(`Azure-first hatası (${originalName || '—'}): ${e?.message}`);
      }
    }

    if (!forceClaude && !allowAutoClaude) {
      this.logger.warn(
        `Otomatik Claude kapali; Azure sonucu yoksa/eksikse Claude'a gidilmeyecek: ${originalName || '-'}`,
      );
    }

    // AYLIK ÜCRETLİ API TAVANI — tavan dolduysa Claude vision atla; Azure/dosya-adı fallback'i devreye girer.
    const ocrBudgetOk = hasClaudeKey && (forceClaude || allowAutoClaude)
      ? await canSpendOnApiGlobal(this.prisma, 'kdv-ocr')
      : true;
    if (!ocrBudgetOk) {
      this.logger.warn(`AI maliyet tavani doldu — Claude vision atlandi: ${originalName || '—'}`);
    }

    if (hasClaudeKey && ocrBudgetOk && (forceClaude || allowAutoClaude)) {
      try {
        const claudeResult = await this.runClaudeVisionOcr(imageBuffer);
        if (!azureRawText && this.azureClient) {
          azureRawText = await this.getAzureRawText(imageBuffer).catch((e) => {
            this.logger.warn(`Azure cross-check hatası: ${e?.message}`);
            return '';
          });
        }

        if (claudeResult.belgeNo || claudeResult.date || claudeResult.kdvTutari) {
          // ═══ POST-PROCESS DOĞRULAMA (kurala dayalı) ═══
          this.postProcessOcrResult(claudeResult, belgeNoFromFilename, originalName);

          // ═══ AZURE CROSS-CHECK (ikinci tanık) ═══
          if (azureRawText) {
            this.crossCheckWithAzure(claudeResult, azureRawText, originalName, belgeNoFromFilename);
            // Cross-check sonrası rawText'i Azure metniyle zenginleştir
            // (debug + ileride extractDateFromText fallback için)
            claudeResult.rawText = `[CLAUDE] ${claudeResult.rawText}\n[AZURE]\n${azureRawText.slice(0, 2000)}`;
          }

          // ═══ MULTI-PASS VALIDATION (matematik + mantık) ═══
          // breakdown.tutar.sum === kdvTutari? matrah×oran === tutar?
          // Geçerli oran (0/1/8/10/18/20)? Tevkifat ≤ KDV? gibi kontroller.
          // Doğrulama başarısızsa confidence düşürülür → NEEDS_REVIEW gider.
          this.validateOcrResult(claudeResult, originalName);

          claudeResult.engine = `${claudeResult.engine || DEFAULT_OCR_MODEL} (claude-escalation)`;
          return claudeResult;
        }
        this.logger.warn(
          `Claude boş döndü: ${originalName || '—'} · raw:${claudeResult.rawText?.slice(0, 120)}`,
        );
        // Claude boş döndü → Azure fallback (yapısal extraction)
      } catch (e: any) {
        this.logger.warn(`Claude Vision hatası (${originalName || '—'}): ${e?.message}`);
      }
    }

    // 2. Fallback: Azure Vision Read API yapısal extraction
    if (this.azureClient) {
      try {
        return await this.runAzureOcr(imageBuffer, belgeNoFromFilename, originalName);
      } catch (e: any) {
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

  // === CLAUDE VISION OCR (Sonnet 4.5 default, Haiku 4.5 fallback via ENV) ===
  /**
   * Claude Vision'ı çağırır; Türk fatura/fiş görselinden
   * tarih, belge no, KDV tutarı ve toplam tutarı yapısal JSON olarak alır.
   * Default Sonnet 4.5 (Haiku halüsinasyon yapıyordu, kullanıcı düzeltmek zorunda kalıyordu).
   * Haiku'ya dönmek için ENV: OCR_MODEL=claude-haiku-4-5-20251001
   */
  /** @deprecated Faz 4 — saf provider'a delege. */
  private async runClaudeVisionOcr(buffer: Buffer): Promise<OcrResult> {
    return runClaudeVisionOcrPure(buffer, DEFAULT_OCR_MODEL, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      formatIsoToTr: (iso) => this.formatIsoToTr(iso),
      clampConfidence: (v) => this.clampConfidence(v),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  /** Claude'dan gelen confidence değerini 0–1 aralığına sıkıştır (geçersizse 0.5) */
  private clampConfidence(v: any): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return 0.5; // Claude vermemişse nötr baseline
    if (n < 0) return 0;
    if (n > 1) return n > 1 && n <= 100 ? n / 100 : 1; // bazen yüzde verirse düzelt
    return n;
  }

  /**
   * Claude'un döndürdüğü tarihi "DD.MM.YYYY" Türk formatına normalize eder.
   * Kabul edilen girdi formatları:
   *   - "2026-03-08"  (ISO, prompt'ta istenen)
   *   - "08.03.2026" / "08-03-2026" / "08/03/2026" (TR, kullanıcı hatası)
   *   - "08 03 2026" (boşluklu OCR)
   * Ay/gün ambiguous ise (ikisi de 1-12) ISO sırasını koru.
   */
  private formatIsoToTr(iso?: string | null): string | null {
    if (!iso || typeof iso !== 'string') return null;
    const s = iso.trim();

    // 1) ISO — YYYY-MM-DD (canonical)
    const iso1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso1) {
      const yy = iso1[1], mo = iso1[2].padStart(2, '0'), dd = iso1[3].padStart(2, '0');
      if (+mo >= 1 && +mo <= 12 && +dd >= 1 && +dd <= 31) return `${dd}.${mo}.${yy}`;
    }

    // 2) TR — DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY / DD MM YYYY
    const tr = s.match(/^(\d{1,2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{2}|\d{4})$/);
    if (tr) {
      let dd = +tr[1], mo = +tr[2];
      const yy = this.normalizeOcrYear(tr[3]);
      // Türk belgeleri DAİMA DD-MM-YYYY. Sadece gün > 12 olduğunda swap mantıklı.
      if (dd < 1 || mo < 1 || yy == null) return null;
      if (mo > 12 && dd <= 12) {
        // Claude yanlışlıkla US formatı döndü, swap
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
   * "08.03.2026" Türk formatındaki metni rawText'ten yakalar — Claude tarih döndürmediğinde
   * fallback olarak kullanılır. En erken (en üstte) bulunan makul tarihi döner.
   */
  private extractDateFromText(text: string): string | null {
    if (!text) return null;
    // Öncelik: DD-MM-YYYY, DD.MM.YYYY, DD/MM/YYYY
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
   *
   * v1.36.73: VALIDATION-AWARE EŞİK
   *   Eğer validationScore >= 0.99 (matematik tamamen tutarlı: KDV=matrah×oran,
   *   breakdown.tutar.sum = kdvTutari, vb.) → eşik 0.7'den 0.5'e düşer.
   *   Sebep: math zaten doğru ise, Claude'un alan-bazlı utangaçlığı yapay
   *   "needs review" yaratıyor (Z RAPORU/ÖKC FIŞI'nde tarih confidence sık
   *   düşer çünkü iki haneli yıl "01/04/26" Claude'a belirsiz geliyor).
   *   v1.36.73: Z_RAPORU + OKC_FIS için ek gevşetme (yapısal belge):
   *     Validation %95+ ve breakdown sum = kdvTutari ise eşik 0.4.
   */
  needsReview(result: OcrResult): { needs: boolean; reason: 'none' | 'empty' | 'low_field' } {
    if (this.isLowConfidence(result)) return { needs: true, reason: 'empty' };

    // Belge no + tarih okunsa bile KDV boşsa "başarılı" sayma.
    // Özellikle görsel/XML uzantılı e-faturalarda oran okunup tutar boş kalabiliyor;
    // kullanıcı teyidine düşmeli ki placeholder değer rapora taşınmasın.
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

    // Validation-aware eşik
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
   * Azure Vision Read API ile görüntüden ham metin çıkarır.
   * Hem fallback OCR hem de Claude cross-check için kullanılır.
   * Çok ucuz (~$0.001/belge, ilk 5K/ay bedava).
   */
  private async getAzureRawText(buffer: Buffer): Promise<string> {
    if (!this.azureClient) throw new Error('Azure client yok');

    const result = await this.azureClient.readInStream(buffer);
    const operationId = result.operationLocation?.split('/').pop();
    if (!operationId) throw new Error('Azure operation ID alınamadı');

    // Polling
    let readResult = await this.azureClient.getReadResult(operationId);
    let attempts = 0;
    while (readResult.status !== 'succeeded' && readResult.status !== 'failed' && attempts < 30) {
      await new Promise((r) => setTimeout(r, 500));
      readResult = await this.azureClient.getReadResult(operationId);
      attempts++;
    }
    if (readResult.status !== 'succeeded') {
      throw new Error('Azure OCR başarısız: ' + readResult.status);
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

    // Alanları çıkar
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
      const filenameIsShortOkcNo = !!belgeNoFromFilename && /^\d{1,6}$/.test(belgeNoFromFilename);
      const trustFilename =
        !!belgeNoFromFilename &&
        (!filenameIsShortOkcNo || belgeTipi === 'OKC_FIS' || belgeTipi === 'MAKBUZ' || !bodyBelgeNo);
      belgeNo = trustFilename ? belgeNoFromFilename : (bodyBelgeNo ?? belgeNoFromFilename);
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

    // Azure baseline: regex eşleşmeleri için orta güven (0.6)
    // Filename fallback belgeNo için daha düşük (0.4)
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

  // === YARDIMCI FONKSİYONLAR ===
  private extractBelgeNoFromFilename(filename?: string): string | null {
    if (!filename) return null;
    const base = filename.replace(/\.[^/.]+$/, '').trim();
    if (E_BELGE_NO_REGEX.test(base.toUpperCase())) return base.toUpperCase();
    if (/^[A-Z0-9]{3}\d{4}\d{6,12}$/i.test(base)) return base.toUpperCase();
    if (/^[A-Z0-9\-_]{8,30}$/i.test(base)) return base.toUpperCase();
    if (/^\d{1,6}$/.test(base) && !/^(?:20)?\d{2}[01]\d[0-3]\d$/.test(base)) return base;
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

  /** @deprecated Faz 1 — saf fonksiyona delege ediyor. Yeni kod `extractDatePure` kullansın. */
  private extractDate(text: string): string | null {
    return extractDatePure(text);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege ediyor. Yeni kod `extractBelgeNoPure` kullansin. */
  private extractBelgeNo(text: string): string | null {
    return extractBelgeNoPure(text, this.foldTurkishAscii(text));
  }

  private extractKdvTotal(text: string): string | null {
    const cleanText = this.stripMatrahFragments(text);

    // Hesaplanan KDV (çoklu oran) — "GERCEK/TEVKIFAT/NET/BRUT" ara kelimeleri de destekle.
    // BUG FIX (v1.37.76): "Hesaplanan KDV GERÇEK (%20.0) 824,00" satırında eski regex
    // parantezi atlayıp "20.0" değerini KDV tutarı olarak okuyordu. İki katman koruma:
    //   (a) Ara kelime kabul edilir (?:\s+\S+)? — "GERÇEK" gibi
    //   (b) amount kendisi salt rakam (0/1/8/10/18/20) ise her zaman skip — rate echo
    // "Hesaplanan İade KDV" / "Hesaplanan Gerçek KDV" gibi araya bir kelime girebiliyor — [^\s]+\s+ ile yakala
    const hesaplananMatches = [...cleanText.matchAll(/hesaplanan\s*(?:[^\s]+\s+)?kdv(?:\s+\S+)?\s*(?:\(\s*%?\s*(\d{1,2})(?:[,.]\d{1,2})?\s*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (hesaplananMatches.length > 0) {
      const total = hesaplananMatches.reduce((sum, m) => {
        const rate = m[1] ? Number(m[1]) : null;
        const amount = this.parseAmount(m[2]);
        // Eski guard: rate parantezde + amount = rate → skip
        if (rate != null && this.isLikelyStandaloneTaxRate(m[2]) && Math.abs(amount - rate) < 0.01) {
          return sum;
        }
        // YENI guard: amount salt rakam (0/1/8/10/18/20) ise rate echo — gerçek
        // KDV asla salt rakam olamaz, her zaman ondalıklı tutar.
        if (this.isLikelyStandaloneTaxRate(m[2])) {
          return sum;
        }
        return sum + amount;
      }, 0);
      if (total > 0) return this.formatAmount(total);
    }

    // KDV tutarı
    const kdvMatches = [...cleanText.matchAll(/k\.?d\.?v\.?\s*(?:tutarı?)?\s*[:=]\s*([\d.,]+)/gi)];
    if (kdvMatches.length > 0) {
      const values = kdvMatches.map(m => this.parseAmount(m[1])).filter(v => v > 0);
      if (values.length > 0) return this.formatAmount(Math.max(...values));
    }

    // Toplam KDV
    const toplamKdv = cleanText.match(/toplam\s+k\.?d\.?v\.?\s*[:\s]+([\d.,]+)/i);
    if (toplamKdv?.[1]) return toplamKdv[1].replace(/\s/g, '');

    // Operatör faturası (Türk Telekom vb.) — "KDV %18 (matrah): 46,77" veya "KDV %18 46,77"
    // Birden fazla oran satırı varsa topla.
    const operatorKdvMatches = [...cleanText.matchAll(/\bk\.?d\.?v\.?\s*%\s*\d{1,2}(?:[,.]\d{1,2})?\s*(?:\([^)]*\))?\s*[:\s]+([\d.,]+)/gi)];
    if (operatorKdvMatches.length > 0) {
      const total = operatorKdvMatches.reduce((sum, m) => {
        const v = this.parseAmount(m[1]);
        return this.isLikelyStandaloneTaxRate(m[1]) ? sum : sum + v;
      }, 0);
      if (total > 0) return this.formatAmount(total);
    }

    return null;
  }

  /** @deprecated Faz 1 — saf fonksiyona delege ediyor. Yeni kod `normalizeOcrYearPure` kullansın. */
  private normalizeOcrYear(raw: string): number | null {
    return normalizeOcrYearPure(raw);
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractOkcFisKdvFromAzure(text: string): {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
  } | null {
    return extractOkcFisKdvPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isMatrahOrRateLine: (v) => this.isMatrahOrRateLine(v),
      logger: { warn: (m) => this.logger.warn(m) },
    });
  }

  /**
   * OKC fislerde bazen sadece TOPKDV toplam yazilir; oran bazli KDV ise urun
   * satirlarindaki %01/%10/%20 brut tutarlardan turetilmelidir.
   */
  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractOkcFisItemRateBreakdownFromAzure(
    text: string,
    expectedTotal?: number | null,
  ): KdvBreakdownItem[] {
    return extractOkcFisItemRateBreakdownPure(text, expectedTotal ?? null, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isMatrahOrRateLine: (v) => this.isMatrahOrRateLine(v),
      logger: { warn: (m) => this.logger.warn(m) },
    });
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
   * Z RAPORU özel parser — Azure ham metninden TOPKDV / TOPKDV %X satırlarını çıkarır.
   * Çıktı: { kdvTutari, breakdown }
   *
   * KRİTİK: "KUM TOPKDV" / "KUM TOPLAM" satırları KÜMÜLATİF — ASLA ALMA.
   * Sadece o anki Z raporu için "TOPKDV" / "TOPKDV %X" satırlarını al.
   */
  /**
   * E-Fatura/E-Arşiv için çok oranlı KDV breakdown'u Azure metninden çıkar.
   * Standart Türk fatura formatı: "Hesaplanan KDV (%20)  116,00 TL"
   * Claude breakdown'u boş dönerse veya eksik dönerse bu fonksiyon devreye girer.
   *
   * ÖRNEK Azure metin parçası:
   *   "Hesaplanan KDV (% 20,00 )   1.006,00 TL"
   *   "Hesaplanan KDV (% 10,00 )      15,00 TL"
   * → [{oran:20, tutar:1006, matrah:null}, {oran:10, tutar:15, matrah:null}]
   *
   * KDV DIŞI vergi satırları (ÖİV, Telsiz, ÖTV, BSMV, KKDF) atlanır.
   */
  /**
   * Telekom faturasından SADECE "Katma Değer Vergisi" satırının tutarını çıkar.
   * ÖİV ve Telsiz Kullanım tutarları atlanır.
   *
   * Azure metni tipik formatta:
   *   "Katma Değer Vergisi     %20   (Matrah: 1.260,01 TRY)    252,00"
   *   "Özel İletişim Vergisi   %10   (Matrah: 1.260,01 TRY)    126,00"
   * Veya label ve amount ayrı satırlarda:
   *   "Katma Değer Vergisi"
   *   "%20"
   *   "(Matrah: 1.260,01 TRY)"
   *   "252,00"
   */
  /**
   * Azure OCR text'ini normalize et:
   *   - NBSP (U+00A0) → normal boşluk (regex \s'in yakalamadığı ara form)
   *   - Full-width "％" → ASCII "%"
   *   - Türkçe locale uppercase: "İ" (U+0130) / "ı" (U+0131) doğru case-fold
   *     olmuyor. `/i` flag'li regex'ler "Özel İletişim" yazılı satırı
   *     yakalayamıyor çünkü `i → İ` (büyük I noktalı) case-folding JS
   *     standard regex'inde beklenen davranışı vermiyor.
   *     toLocaleUpperCase('tr-TR') deterministik olarak ÖZEL → ÖZEL,
   *     iletişim → İLETİŞİM yapar. Tüm tax-label regex'leri UPPERCASE
   *     pattern'lı yazıldığı için bu normalize şart.
   *     (Sayılar/virgül/noktaya dokunmaz — parse sonucu aynı kalır.)
   */
  /** @deprecated Faz 2 — saf provider'a delege. */
  private normalizeAzureText(text: string): string {
    return normalizeAzureTextPure(text);
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private stripMatrahFragments(text: string): string {
    return stripMatrahFragmentsPure(text);
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private foldTurkishAscii(text: string): string {
    return foldTurkishAsciiPure(text);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private isLikelyStandaloneTaxRate(value: string): boolean {
    return isLikelyStandaloneTaxRatePure(value, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private isMatrahOrRateLine(value: string): boolean {
    return isMatrahOrRateLinePure(value, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private isKdvTableHeaderLine(value: string): boolean {
    return isKdvTableHeaderLinePure(value, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private isForbiddenKdvAmountLine(value: string): boolean {
    return isForbiddenKdvAmountLinePure(value, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private isLikelyKdvAmountColumnHeader(lines: string[], index: number): boolean {
    return isLikelyKdvAmountColumnHeaderPure(lines, index, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private detectBelgeTipiFromAzure(text: string, originalName?: string): string | null {
    return detectBelgeTipiPure(text, originalName);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege ediyor. Yeni kod `extractSaticiVknPure` kullansin. */
  private extractSaticiVknFromAzure(text: string): string | null {
    return extractSaticiVknPure(text, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 1 — saf fonksiyona delege ediyor. Yeni kod `extractSaticiUnvanPure` kullansin. */
  private extractSaticiFromAzure(text: string): string | null {
    return extractSaticiUnvanPure(text, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private parseTevkifatRate(text: string): number {
    return parseTevkifatRatePure(text, (s) => this.foldTurkishAscii(s));
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractMoneyAmountsFromText(text: string): number[] {
    return extractMoneyAmountsPure(text, (s) => this.parseAmount(s));
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private inferTevkifatFromAzureAmounts(text: string, tamKdv: number): {
    tamKdv: number;
    tevkifat: number;
    netKdv: number;
  } | null {
    return inferTevkifatFromAzureAmountsPure(text, tamKdv, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      parseTevkifatRate: (t) => this.parseTevkifatRate(t),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  /**
   * Tevkifatlı faturalardan TAM KDV ve TEVKİFAT tutarlarını Azure metninden
   * doğrudan yakalar. Claude bazen "Mal Hizmet Toplam" değerini "KDV dahil
   * toplam" sanıp /11 hesabı yapıyor (13.300 → 1209,09 gibi). Halbuki faturada
   * "Hesaplanan KDV(%X)" satırının yanında doğru tutar açık yazıyor.
   *
   * Aranan pattern'ler (Türk e-Fatura/e-Arşiv tevkifat formatı):
   *   "Hesaplanan KDV(%10)        1.330,00"
   *   "Hesaplanan KDV Tevkifat(%50) 665,00"
   *   "Tevkifata Tabi İşlem Üzerinden Hes. KDV  3.350,00"
   *
   * Geri dönen değer:
   *   { tamKdv, tevkifat, netKdv } veya null (pattern bulunamazsa)
   */
  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractTevkifatliFaturaFromAzure(text: string): {
    tamKdv: number;
    tevkifat: number;
    netKdv: number;
  } | null {
    return extractTevkifatliFaturaPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      inferTevkifatFromAzureAmounts: (t, k) => this.inferTevkifatFromAzureAmounts(t, k),
      logger: {
        log: (msg) => this.logger.log(msg),
        warn: (msg) => this.logger.warn(msg),
      },
    });
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractKdvOnlyFromTelekomAzure(text: string): number | null {
    return extractKdvOnlyFromTelekomPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isMatrahOrRateLine: (v) => this.isMatrahOrRateLine(v),
      isLikelyStandaloneTaxRate: (v) => this.isLikelyStandaloneTaxRate(v),
    });
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractElectricityKdvFromAzure(text: string): number | null {
    return extractElectricityKdvPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
    });
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractKdvFromInvoiceTotalsAzure(text: string): { kdv: number; matrah: null; oran: number | null } | null {
    return extractKdvFromInvoiceTotalsPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isMatrahOrRateLine: (v) => this.isMatrahOrRateLine(v),
      isForbiddenKdvAmountLine: (v) => this.isForbiddenKdvAmountLine(v),
      isLikelyKdvAmountColumnHeader: (ls, i) => this.isLikelyKdvAmountColumnHeader(ls, i),
      isLikelyStandaloneTaxRate: (v) => this.isLikelyStandaloneTaxRate(v),
      extractElectricityKdvFromAzure: (t) => this.extractElectricityKdvFromAzure(t),
    });
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractMultiRateKdvFromAzure(text: string): KdvBreakdownItem[] {
    return extractMultiRateKdvPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isMatrahOrRateLine: (v) => this.isMatrahOrRateLine(v),
      isForbiddenKdvAmountLine: (v) => this.isForbiddenKdvAmountLine(v),
      isLikelyKdvAmountColumnHeader: (ls, i) => this.isLikelyKdvAmountColumnHeader(ls, i),
      isLikelyStandaloneTaxRate: (v) => this.isLikelyStandaloneTaxRate(v),
      extractElectricityKdvFromAzure: (t) => this.extractElectricityKdvFromAzure(t),
    });
  }

  /**
   * Tablo satırı tabanlı çok oranlı KDV yakalama — FALLBACK.
   *
   * Şirin Reklam (ESR...895) gibi faturalarda "Hesaplanan KDV (%N)" özet
   * satırı Azure tarafından parçalanabiliyor ve extractMultiRateKdvFromAzure
   * boş dönebiliyor. Ama tablo satırlarında "% 20,00" ile "1.006,00 TL" YAN
   * YANA. Bu fonksiyon tablo satırlarını yakalar, oran başına tutarları toplar.
   *
   * Örnek (Şirin Reklam):
   *   "1 REKS39 LEDBOX 2 Adet 75,0000 TL ... % 10,00 15,00 TL ... 150,00 TL"
   *   "2 REK1008 MESH VINIL 1 Adet 5.030,0000 TL ... % 20,00 1.006,00 TL ... 5.030,00 TL"
   *   → [%20: 1006, %10: 15]
   *
   * Güvenlik kısıtları:
   *   - "Özel İletişim Vergisi (10%)" gibi ÖİV satırları dışarıda
   *   - "İsk %" / "İskonto %" / "iskonto oranı" gibi indirim sütunları dışarıda
   *   - Oran × amount eşleşmesi için her ikisi de aynı satırda olmalı
   *   - Bulunan tutar absurd büyük (10M+) veya negatif ise atla
   */
  /** @deprecated Faz 4 — saf provider'a delege. */
  private extractMultiRateKdvFromItemRows(text: string): KdvBreakdownItem[] {
    return extractMultiRateKdvFromItemRowsPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      stripMatrahFragments: (t) => this.stripMatrahFragments(t),
      isForbiddenKdvAmountLine: (v) => this.isForbiddenKdvAmountLine(v),
      isLikelyKdvAmountColumnHeader: (ls, i) => this.isLikelyKdvAmountColumnHeader(ls, i),
    });
  }

  /**
   * "Hes. Matrah / KDV(%N)" tablo formatı için özel ve sağlam parser.
   * Bu format e-Arşiv fatura altında standart olarak görünür:
   *
   *                       Matrah        Kdv
   *   Hes. Matrah / KDV(%1)    771,70 TL    7,72 TL
   *   Hes. Matrah / KDV(%8)    0,00 TL      0,00 TL
   *   Hes. Matrah / KDV(%20)   71,58 TL     14,32 TL
   *   Hes. Matrah / KDV Toplam 843,28 TL    22,04 TL
   *
   * Azure parse'inde tablo hücreleri farklı dizilebilir (sırayla matrah'lar,
   * sonra KDV'ler bir blokta gelir, ya da yan yana). Bu method her iki düzeni
   * de yakalamaya çalışır:
   *
   *   1. "Hes. Matrah / KDV Toplam" satırını bul → SON amount = TOPLAM KDV
   *      (en güvenli authoritative değer)
   *   2. Per oran "Hes. Matrah / KDV(%N)" satırları için breakdown çıkar
   *
   * Sonuç dönerse otomatik authoritative kabul edilir, diğer extractor'ları
   * override eder.
   */
  /** @deprecated Faz 4 — saf provider'a delege. */
  private extractHesMatrahKdvTable(text: string): {
    totalKdv: number | null;
    breakdown: KdvBreakdownItem[];
  } {
    return extractHesMatrahKdvTablePure(text, {
      parseAmount: (s) => this.parseAmount(s),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
    });
  }

  /** @deprecated Faz 2 — saf provider'a delege. */
  private extractZRaporuKdvFromAzure(text: string): {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
    matrahByOran: Record<number, number>;
  } {
    return extractZRaporuKdvPure(text, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
    });
  }

  /**
   * Claude'un verdiği değeri Azure'un ham metninde ara — TANIK DOĞRULAMA.
   * Amaç: Claude halüsinasyon yaparsa (286,36'yı 631,43 gibi) Azure "bunu görmedim" der.
   * Tutar için ±1 kuruş tolerans; belge no için case-insensitive; tarih için format-insensitive.
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
      // Belge no'da noktalama/boşluk tolere et
      const normalizedValue = v.replace(/[^A-Z0-9]/g, '');
      const normalizedText = text.replace(/[^A-Z0-9]/g, '');
      if (normalizedValue.length === 0) return false;

      // Kısa belge no'lar (1-3 hane fiş no, Z no): etiket bazlı arama lazım,
      // çünkü "20" gibi kısa sayı metinde başka yerlerde tesadüfen geçebilir.
      // "FIŞ NO 20", "Z NO 20", "BELGE NO 20" gibi etikete eşlik etsin.
      if (normalizedValue.length <= 3) {
        const labelPatterns = [
          new RegExp(`F[İI]Ş\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`Z\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`BELGE\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`MAKBUZ\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`SER[İI]\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
          new RegExp(`F[İI]S\\s*N[O0]\\s*[:.\\s]*${normalizedValue}\\b`, 'i'),
        ];
        return labelPatterns.some((p) => p.test(text));
      }

      // 4+ karakter belge no: doğrudan substring match
      return normalizedText.includes(normalizedValue);
    }

    if (field === 'date') {
      // "08.03.2026" → 08, 03, 2026 parçalarını ayrı ayrı yakala
      const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) return false;
      const [, dd, mo, yy] = m;
      // Azure metninde DD<sep>MM<sep>YYYY biçiminde ara — separator esnek.
      // Gerçek örnekler: "18.03.2026", "18-03-2026", "18/03/2026", "18 03 2026",
      // "18- 03- 2026" (tire+boşluk), "18. 03. 2026", "18 . 03 . 2026".
      // Separator olarak 0-3 karakter (boşluk/nokta/tire/slash kombinasyonu) kabul.
      const sep = `[\\s.\\-\\/]{0,3}`;
      const dateRegex = new RegExp(`\\b${dd}${sep}${mo}${sep}${yy}\\b`);
      if (dateRegex.test(text)) return true;
      const yyShort = yy.slice(-2);
      const shortDateRegex = new RegExp(`\\b${dd}${sep}${mo}${sep}${yyShort}\\b`);
      if (shortDateRegex.test(text)) return true;
      // Fallback: tarihin canonical formunu (ddmmyyyy) tüm non-digit temizlendikten
      // sonra Azure text'inde ara — separator ne olursa olsun yakalar
      const canonical = `${dd}${mo}${yy}`;
      const canonicalShort = `${dd}${mo}${yyShort}`;
      const normalizedText = text.replace(/[^0-9]/g, '');
      return normalizedText.includes(canonical) || normalizedText.includes(canonicalShort);
    }

    if (field === 'amount') {
      // "286,36" → rakamları yakala, ±1 kuruş tolerans
      const num = this.parseAmount(v);
      if (num <= 0) return false;
      // Azure'da bulunan tüm sayıları tara, en yakınını bul
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
   * Claude sonucunu Azure'un ham metnine karşı çapraz doğrular.
   * Bulunamayan alanların confidence'ını sıfırlar → kullanıcı teyidine gider.
   * Bulunan alanların confidence'ını %95'e boost eder.
   */
  /** @deprecated Faz 4 — saf validation modulüne delege. */
  private crossCheckWithAzure(
    result: OcrResult,
    azureText: string,
    originalName?: string,
    belgeNoFromFilename?: string | null,
  ): void {
    crossCheckWithAzurePure(result, azureText, originalName, belgeNoFromFilename, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      foldTurkishAscii: (s) => this.foldTurkishAscii(s),
      normalizeAzureText: (t) => this.normalizeAzureText(t),
      eBelgeNoDistance: (a, b) => this.eBelgeNoDistance(a, b),
      extractZRaporuKdvFromAzure: (t) => this.extractZRaporuKdvFromAzure(t),
      extractOkcFisKdvFromAzure: (t) => this.extractOkcFisKdvFromAzure(t),
      extractTevkifatliFaturaFromAzure: (t) => this.extractTevkifatliFaturaFromAzure(t),
      extractKdvOnlyFromTelekomAzure: (t) => this.extractKdvOnlyFromTelekomAzure(t),
      extractKdvFromInvoiceTotalsAzure: (t) => this.extractKdvFromInvoiceTotalsAzure(t),
      extractMultiRateKdvFromAzure: (t) => this.extractMultiRateKdvFromAzure(t),
      extractMultiRateKdvFromItemRows: (t) => this.extractMultiRateKdvFromItemRows(t),
      extractHesMatrahKdvTable: (t) => this.extractHesMatrahKdvTable(t),
      isFieldInAzureText: (v, f, t) => this.isFieldInAzureText(v, f, t),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  private parseAmount(str: string): number {
    const c = String(str)
      .replace(/\s/g, '')
      .replace(/(?:TL|TRY|₺)/gi, '')
      .replace(/[\*¥]/g, '')
      .replace(/[^\d,.\-]/g, '');
    if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(c))
      return parseFloat(c.replace(/\./g, '').replace(',', '.'));
    return parseFloat(c.replace(',', '.')) || 0;
  }

  private formatAmount(n: number): string {
    return n.toFixed(2).replace('.', ',');
  }

  private normalizeTaxText(value: string | null | undefined): string {
    return String(value ?? '')
      .replace(/\u0130/g, 'I')
      .replace(/\u0131/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private decodeXmlText(value: string): string {
    return decodeXmlTextPure(value);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private getXmlTagValue(xml: string, tag: string): string | null {
    return getXmlTagValuePure(xml, tag);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private getXmlBlocks(xml: string, tag: string): string[] {
    return getXmlBlocksPure(xml, tag);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private stripXmlBlocks(xml: string, tag: string): string {
    return stripXmlBlocksPure(xml, tag);
  }

  /** @deprecated Faz 1 — saf fonksiyona delege. */
  private parseXmlAmount(xml: string, tag: string): number {
    return parseXmlAmountPure(xml, tag, (s) => this.parseAmount(s));
  }

  /**
   * OCR sonucunu kapsamlı doğrular + mümkünse düzeltir. Çağıran taraf
   * (Claude Vision OCR) parse sonrası bu method'u çağırır.
   *
   * Yaptıkları:
   *  1. Belge no: yasak değerleri temizle (TR1.2, UUID, vb.), filename override
   *  2. Belge no: uzunluk/pattern kontrolü, tipine göre uyum doğrulama
   *  3. Tarih: ay/gün geçerli mi, yıl makul mu
   *  4. KDV: breakdown toplamı = kdvTutari mi (tolerans ±1 kuruş)
   *  5. KDV: matrah × oran / 100 ≈ tutar mi (çapraz doğrulama)
   *  6. Numerik alanlar normalize (₺, TL, boşluk temizle)
   */
  /** @deprecated Faz 4 — saf validation modülüne delege. */
  private postProcessOcrResult(
    result: OcrResult,
    belgeNoFromFilename: string | null,
    originalName?: string,
  ): void {
    postProcessOcrResultPure(result, belgeNoFromFilename, originalName, {
      parseAmount: (s) => this.parseAmount(s),
      formatIsoToTr: (iso) => this.formatIsoToTr(iso),
      eBelgeNoDistance: (a, b) => this.eBelgeNoDistance(a, b),
      extractDateFromText: (t) => this.extractDateFromText(t),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  /**
   * Multi-pass validation — OCR sonucunun matematiksel ve mantıksal tutarlılığını
   * kontrol eder. Hatalar `validationIssues`'a yazılır, `validationScore` 0-1
   * arasında hesaplanır ve gerektiğinde `fieldConfidence.kdvTutari` düşürülür
   * (NEEDS_REVIEW akışına gitmesi için).
   *
   * Yapılan kontroller:
   *   1. breakdown.tutar.sum === kdvTutari (±%2 tolerans, kuruş yuvarlamasına izin)
   *   2. her breakdown satırı: matrah × oran/100 ≈ tutar (±%2 tolerans)
   *   3. geçerli KDV oranları: 0, 1, 10, 20
   *   4. tevkifat ≤ tam KDV (tevkifat > KDV mantıksız)
   *   5. KDV > 0 ama oran 0 → uyarı
   *
   * UBL XML parse'lı sonuçlar için validationScore daha önce 1.0 olarak set
   * edilmiş; bu fonksiyon sadece Claude/Azure çıktılarını doğrular.
   */
  /** @deprecated Faz 4 — saf validation modülüne delege. */
  private validateOcrResult(result: OcrResult, originalName?: string): void {
    validateOcrResultPure(result, originalName, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  /**
   * UBL (Universal Business Language) formatındaki Türk e-Fatura/e-Arşiv XML'ini
   * regex ile parse eder. fast-xml-parser yerine regex çünkü:
   *   - UBL alanları sabit yapıdadır (standart)
   *   - Dependency eklemeye gerek yok
   *   - %100 doğruluk (Claude gibi yanlış okumaz)
   *
   * Çıkardığı alanlar:
   *   - Invoice ID (belge no) — <cbc:ID> (root level, CustomizationID'den sonra)
   *   - IssueDate (tarih)
   *   - TaxTotal/TaxAmount (toplam KDV)
   *   - TaxSubtotal breakdown (her oran için ayrı KDV)
   *   - PayableAmount (ödenecek toplam)
   */
  /** @deprecated Faz 2 — saf provider'a delege. Yeni kod `parseUblXmlPure` kullansin. */
  private parseUblXml(xml: string): OcrResult | null {
    return parseUblXmlPure(xml, {
      parseAmount: (s) => this.parseAmount(s),
      formatAmount: (n) => this.formatAmount(n),
      normalizeTaxText: (v) => this.normalizeTaxText(v),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
      },
    });
  }

  /**
   * Levenshtein edit distance — iki string arasındaki en az
   * ekleme/silme/değiştirme sayısı. OCR hatası toleransı için kullanılır.
   * ESR2026000001162 ↔ ESR20260000011162 → 1 (fazladan "1")
   * ESR2026000001204 ↔ ESR20260000001204 → 1 (fazladan "0")
   */
  private editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private eBelgeNoDistance(a: string, b: string): number {
    const normalizeConfusions = (s: string) =>
      s
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .replace(/5/g, 'S')
        .replace(/0/g, 'O')
        .replace(/1/g, 'I');
    const direct = this.editDistance(a, b);
    const confused = this.editDistance(normalizeConfusions(a), normalizeConfusions(b));
    return Math.min(direct, confused);
  }
}
