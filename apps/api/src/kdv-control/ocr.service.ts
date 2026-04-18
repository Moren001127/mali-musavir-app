import { Injectable, Logger } from '@nestjs/common';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';

/** Çok oranlı KDV kırılımı — Z raporu veya karma oranlı fatura için */
export interface KdvBreakdownItem {
  /** KDV oranı (%) — 1, 8, 10, 18, 20 gibi */
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
  kdvTutari: string | null;
  totalTutari: string | null;
  /** Belge tipi: EFATURA, EARSIV, OKC_FIS, Z_RAPORU, MAKBUZ */
  belgeTipi?: string | null;
  /** Çok oranlı KDV kırılımı (varsa) — Z raporu/karma fatura */
  kdvBreakdown?: KdvBreakdownItem[] | null;
  /** Genel güven skoru (geriye dönük uyumluluk) */
  confidence: number;
  /** Alan-bazlı güven skorları (0–1). Null ise alan bulunamadı. */
  fieldConfidence: {
    belgeNo: number | null;
    date: number | null;
    kdvTutari: number | null;
  };
  engine: string;
  /** Claude API response'undan gelen token kullanımı — maliyet hesabı için. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /** USD cinsinden tahmini maliyet (input $1/M + output $5/M Haiku 4.5 fiyat) */
    costUsd: number;
  };
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
 * Hallucination'lara karşı Azure OCR cross-check (2. tanık) + matematiksel validation kullanılıyor.
 * Sonnet'e çıkmak için ENV: OCR_MODEL=claude-sonnet-4-5
 */
const DEFAULT_OCR_MODEL = 'claude-haiku-4-5-20251001';

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

    // ═══════════════════════════════════════════════════════
    // 0. XML DOĞRUDAN PARSE — UBL e-Fatura/e-Arşiv
    // ═══════════════════════════════════════════════════════
    // İçerik gerçekten XML mi? (binary image değil) — EXTENSION TEK BAŞINA GÜVENLİ DEĞİL
    const head512 = imageBuffer.slice(0, 512).toString('utf8');
    const looksLikeXmlContent =
      head512.trimStart().startsWith('<?xml') ||
      head512.includes('<Invoice') ||
      head512.includes('<ArchiveInvoice') ||
      head512.includes('<cbc:') ||
      head512.includes('<cac:');
    const isXml = looksLikeXmlContent;

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
          return xmlResult;
        }
        // XML parse boş döndü → manuel review için filename only dön (image OCR XML'de işe yaramaz)
        this.logger.warn(
          `XML parse başarısız (${originalName}): belge no/date/kdv bulunamadı, filename-only döndürülüyor`,
        );
        return {
          rawText: head512.slice(0, 500),
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
    // 1. ÇİFT KAYNAK OCR — Claude + Azure paralel
    //    Claude: yapısal JSON (LLM)
    //    Azure:  ham metin (Read API) — Claude'un çapraz tanığı
    //    Eğer her iki kaynak da varsa: Claude'un değerleri Azure metninde
    //    bulunmuyorsa → confidence sıfırla, kullanıcı teyidine git.
    // ═══════════════════════════════════════════════════════
    const useAzureCheck = !!this.azureClient && hasClaudeKey;

    if (hasClaudeKey) {
      try {
        // Claude + Azure'u eş zamanlı çağır (Azure çok ucuz, ilk 5K/ay bedava)
        const [claudeResult, azureRawText] = await Promise.all([
          this.runClaudeVisionOcr(imageBuffer),
          useAzureCheck
            ? this.getAzureRawText(imageBuffer).catch((e) => {
                this.logger.warn(`Azure cross-check hatası: ${e?.message}`);
                return '';
              })
            : Promise.resolve(''),
        ]);

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
        return await this.runAzureOcr(imageBuffer, belgeNoFromFilename);
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
  private async runClaudeVisionOcr(buffer: Buffer): Promise<OcrResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const MODEL = process.env.OCR_MODEL || DEFAULT_OCR_MODEL;

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

    const systemPrompt = [
      'Sen Türk muhasebe dokümanları (e-Fatura, e-Arşiv, ÖKC fişi, Z raporu, makbuz, dekont) için uzmanlaşmış bir OCR sistemisin.',
      'Görseli karakter karakter incele ve SADECE geçerli JSON dön — açıklama/prolog YOK.',
      '',
      '╔══ JSON ŞEMA ══╗',
      '{',
      '  "tarih": "YYYY-MM-DD" | null,',
      '  "belgeNo": "...",',
      '  "kdvTutari": "1234,56",',
      '  "toplam": "1499,56",',
      '  "satici": "ABC LTD",',
      '  "kdvOrani": 20,',
      '  "belgeTipi": "EFATURA|EARSIV|OKC_FIS|Z_RAPORU|MAKBUZ|GIDER_PUSULASI|SMM|DEKONT|SEVK_IRSALIYESI|DIGER",',
      '  "kdvBreakdown": [{"oran":20,"tutar":"47,50","matrah":"285,00"}],',
      '  "confidence": {"tarih":0.95,"belgeNo":0.88,"kdvTutari":0.72}',
      '}',
      '',
      '╔══ 1) BELGE TİPİNİ TESPİT ET ══╗',
      'Görselin tamamını oku, şu anahtar kelimeleri ara:',
      '  • "E-FATURA" / "e-Fatura" / "TEMELFATURA" / "TICARIFATURA" → EFATURA',
      '  • "E-ARŞİV" / "E-ARSIV" / "EARSIVFATURA" → EARSIV',
      '  • "Z RAPORU" / "Z RAPOR" / "Z REPORT" / "GÜNLÜK Z" → Z_RAPORU',
      '  • Fiş numaralı satış belgesi (Z raporu değilse) / "FİŞ NO" → OKC_FIS',
      '  • "GİDER PUSULASI" → GIDER_PUSULASI',
      '  • "SERBEST MESLEK MAKBUZU" → SMM',
      '  • "MAKBUZ" (tek başına, SMM değilse) → MAKBUZ',
      '  • "DEKONT" / "HAVALE" / "EFT" / banka başlıklı → DEKONT',
      '  • "SEVK İRSALİYESİ" / "İRSALİYE" → SEVK_IRSALIYESI',
      '  • Hiçbiri değilse → DIGER',
      '',
      '╔══ 2) BELGE NO — TİPE GÖRE DOĞRU ALAN ══╗',
      'Belge no\'yu tipe göre ŞU ALANDAN al:',
      '  • EFATURA/EARSIV → "Fatura No" / "Belge No" etiketindeki değer.',
      '    Pattern: 3 harf + 4 rakam (yıl) + 9 rakam (sıra) = 16 char, örn. "EFA2026000000093".',
      '    EĞER 13-14 KARAKTER OKUDUYSAN SIFIRLARI ATLADIN — TEKRAR SAY.',
      '  • Z_RAPORU → SADECE "Z NO" etiketindeki değer. FIŞ NO / EKÜ NO / AT NO / SAAT / TARİH ASLA DEĞİL!',
      '    ► KRİTİK: "FIŞ NO. 45" görsen bile o "FIŞ NO" — Z_RAPORU\'nda belge no DEĞİL.',
      '    ► Z raporunda doğru alan: belgenin alt kısmında "Z NO: 670" / "Z NO 670" şeklinde geçer.',
      '    ► Örnek: "FIŞ NO. 45 ... TOPLAM ... Z NO: 670" → belgeNo = "670" (45 DEĞİL).',
      '    ► Bazen "Z NO" en altta tek başına yazar (örn. "Z NO 670") — orayı bul.',
      '  • OKC_FIS → "FİŞ NO" / "FIS NO" / "BELGE NO" (3-6 hane).',
      '  • GIDER_PUSULASI → "MAKBUZ NO" / "BELGE NO" / "SERİ NO".',
      '  • SMM → "MAKBUZ NO" / "SERİ NO-SIRA NO" birleşik.',
      '  • MAKBUZ → "MAKBUZ NO" / "SERİ SIRA".',
      '  • DEKONT → "REFERANS NO" / "DEKONT NO" / "İŞLEM NO".',
      '  • SEVK_IRSALIYESI → "İRSALİYE NO".',
      '',
      '╔══ 3) BELGE NO — YASAK ALANLAR (ASLA BELGE NO OLARAK DÖNME) ══╗',
      '  • "Özelleştirme No" / "CustomizationID" (TR1.2, TR1.0, UBL-2.1)',
      '  • "Senaryo" / "ProfileID" (TICARIFATURA, TEMELFATURA, EARSIVFATURA)',
      '  • "UUID" / "ETTN" (GUID formatlı uzun string)',
      '  • "VKN" / "TCKN" (satıcı/alıcı kimlik no)',
      '  • "Sipariş No" / "İrsaliye No" (faturanın ana numarası değil)',
      '  • Z Raporunda: FİŞ NO / EKÜ NO / AT NO / MALİ FİŞ SAYISI vs.',
      '  Bu alanlardan biri tek başına dönme — gerçek belge no bulunana kadar ara.',
      '',
      '╔══ 4) TARİH — TÜRK FORMATI (DD-MM-YYYY) ══╗',
      'HER MUHASEBE BELGESİNDE MUTLAKA BİR TARİH VARDIR. Genelde en üstte veya en altta görünür.',
      'Arama yerleri:',
      '  • Belgenin tepesinde (tarih + saat birlikte olabilir: "10-03-2026 21:30")',
      '  • "Fatura Tarihi", "Belge Tarihi", "Düzenleme Tarihi", "Fiş Tarihi", "Tanzim Tarihi" etiketleri',
      '  • Z raporunda: başta tarih, sonra "SAAT" olur',
      '  • Makbuz/fişte: genelde "TARİH:" etiketi veya serbest format',
      'Türkiye\'de tarih DAİMA "GÜN-AY-YIL" sırasıdır. İLK kısım GÜN, ORTA kısım AY, SON 4 hane YIL.',
      '  • "11-03-2026" = "11.03.2026" = "11/03/2026" = 11 Mart 2026 → output "2026-03-11"',
      '  • "31.12.2025" → 31 Aralık 2025 → output "2025-12-31"',
      '  • "10-03-2026 21:30" → sadece tarih kısmı: "2026-03-10"',
      'KURAL: Eğer ilk hane 13-31 arasındaysa o KESİNLİKLE gün. Ay 1-12 arası olur.',
      'SAKIN ABD formatı (MM-DD-YYYY) düşünme — Türk belgeleri ASLA öyle yazmaz.',
      '⚠ ÖNEMLİ: Tarih belgede DAİMA vardır — "null" dönmeden önce tüm belgeyi tara.',
      '  Sadece görsel tamamen okunaksız/hasarlıysa null dön.',
      'Yıl 2020-2050 dışındaysa muhtemelen OCR hatası, confidence düşür.',
      '',
      '╔══ 5) KDV — ÇOK ORANLI / BREAKDOWN ══╗',
      'Türk belgelerinde KDV oranları: %0, %1, %8, %10, %18, %20 (güncel). Eski: %18.',
      '',
      '⛔ KRİTİK — NE KDV SAYILIR NE SAYILMAZ:',
      'SADECE şu etiketli satırlar KDV\'dir:',
      '  ✓ "KDV", "K.D.V.", "Katma Değer Vergisi"',
      '  ✓ "Hesaplanan KDV", "KDV Tutarı", "TOPKDV", "KUM TOPKDV"',
      '  ✓ Tabloda "KDV %" sütunu (örn. "KDV (% 20,00)")',
      '',
      'ŞU SATIRLARI KDV\'YE ASLA DAHİL ETME (bunlar AYRI vergi türleridir):',
      '  ✗ "Özel İletişim Vergisi" / "ÖİV" / "ÖIV" — telekom faturalarında (Turkcell, Türk Telekom, Vodafone) %5/%10/%25',
      '  ✗ "Telsiz Kullanım Vergisi" / "Telsiz Kullanım Aylık Taksit" — telekom',
      '  ✗ "ÖTV" / "Özel Tüketim Vergisi" — akaryakıt, sigara, alkol, motorlu araç',
      '  ✗ "Konaklama Vergisi" — otel/pansiyon (2026 itibarıyla %2)',
      '  ✗ "Damga Vergisi" — sözleşme, makbuz üstü',
      '  ✗ "BSMV" / "Banka ve Sigorta Muameleleri Vergisi" — banka işlem ücretleri',
      '  ✗ "KKDF" / "Kaynak Kullanımını Destekleme Fonu" — kredi/ithalat',
      '  ✗ "Çevre Temizlik Vergisi" — belediye',
      '  ✗ "Stopaj" / "Tevkifat" / "Gelir Vergisi Kesintisi" — ayrı vergi',
      '  ✗ "Diğer Vergiler" / "Vergiler" başlıklı toplam satır (içinde KDV olsa bile tek başına alma)',
      '  ✗ "Fon Payı" / "Özel Tüketim Fonu"',
      '',
      'ÖRNEK — Turkcell faturası:',
      '  Katma Değer Vergisi   %20  252,00   ← BU KDV (252 TL)',
      '  Özel İletişim Vergisi %10  126,00   ← BU ÖİV, KDV DEĞİL',
      '  Telsiz Kullanım Taksit %0   26,98   ← BU TELSİZ, KDV DEĞİL',
      '  → kdvTutari = "252,00" (SADECE KDV satırı)',
      '  → kdvBreakdown = [{"oran":20,"tutar":"252,00","matrah":"1260,01"}]',
      '',
      'ÖRNEK — Akaryakıt faturası:',
      '  KDV %20           50,00   ← BU KDV',
      '  ÖTV              120,00   ← BU ÖTV, KDV DEĞİL',
      '  → kdvTutari = "50,00"',
      '',
      'Eğer belgede HİÇ "KDV" etiketli satır yoksa (örn. sadece ÖİV varsa), kdvTutari = "0,00".',
      '',
      '╔══ 5b) ÇOK ORANLI KDV — BREAKDOWN ZORUNLU ══╗',
      'Görselde BİRDEN FAZLA KDV oranı satırı varsa (her biri ayrı "KDV %X" etiketli):',
      '  ► kdvBreakdown alanını MUTLAKA doldur — her oran ayrı eleman olacak.',
      '  ► kdvTutari = tüm KDV satırlarının matematiksel TOPLAMI.',
      '  ► Tek oran bile olsa breakdown\'u doldur (tek elemanlı dizi olarak).',
      '',
      'ÖRNEK — Karma fatura (iki oran):',
      '  Hesaplanan KDV (%20)   116,00   (Matrah: 580,00)',
      '  Hesaplanan KDV (%10)    42,00   (Matrah: 420,00)',
      '  → kdvBreakdown=[{"oran":20,"tutar":"116,00","matrah":"580,00"},{"oran":10,"tutar":"42,00","matrah":"420,00"}]',
      '  → kdvTutari="158,00" (116 + 42)',
      '',
      'ÖRNEK — Z raporu:',
      '  "TOPKDV %20: 47,50 / TOPKDV %10: 243,19"',
      '  → kdvBreakdown=[{"oran":20,"tutar":"47,50","matrah":"285,00"},{"oran":10,"tutar":"243,19","matrah":"2675,00"}]',
      '  → kdvTutari="290,69"',
      '',
      'Matrah belirgin değilse matrah hesapla: matrah = tutar * 100 / oran (örn. %20, 116 TL → matrah 580).',
      '',
      '╔══ 6) TUTAR FORMATI ══╗',
      'Türkiye: nokta binlik ayraç, virgül ondalık. "1.234,56" → output "1234,56" (noktasız, virgüllü).',
      '"KDV" etiketi (kabul): "KDV", "K.D.V.", "Katma Değer Vergisi", "Hesaplanan KDV", "KDV Tutarı", "TOPKDV", "KUM TOPKDV".',
      '"KDV" DEĞİL (reddet): "Özel İletişim Vergisi", "ÖİV", "Telsiz Kullanım", "ÖTV", "Damga", "BSMV", "KKDF", "Konaklama Vergisi", "Çevre Vergisi", "Stopaj", "Tevkifat".',
      '"Toplam" etiketi: "Genel Toplam", "Ödenecek", "Fatura Toplamı", "Vergiler Dahil Toplam".',
      'Eğer tutar "₺" ya da "TL" / "TRY" içeriyorsa o işareti KALDIR, sadece sayı kal.',
      '',
      '╔══ 7) KARAKTER NETLİĞİ — OCR TUZAKLARI ══╗',
      'Belge no\'da rakam/harf karışıklığı:',
      '  • "O" (harf O) ve "0" (rakam sıfır) — sayısal pattern\'de "0" tercih et.',
      '  • "l" / "I" (harf i/L) ve "1" (rakam bir) — belge no\'da "1" tercih et.',
      '  • "S" ve "5", "B" ve "8", "Z" ve "2" — pattern\'e bakarak karar ver.',
      'Her harfi ayrı ayrı gözden geçir, özellikle belge no\'da tüm sıfırları SAY.',
      '',
      '╔══ 8) CONFIDENCE — GERÇEKÇİ SKOR ══╗',
      '  • 0.95-1.00 → Karakterler cam gibi net, tek yorum.',
      '  • 0.80-0.94 → Okunaklı, çok küçük belirsizlik.',
      '  • 0.60-0.79 → Bulanık/kısmen kapalı, tahmin var.',
      '  • <0.60 → Net değil, tahmine dayalı.',
      '  • 0 → Alan yok veya hiç okunmuyor.',
      'Birden fazla kalem topladıysan ve biri şüpheliyse skorlu düşür.',
    ].join('\n');

    const userText = [
      'Bu Türk muhasebe belgesinin yapısal verilerini JSON olarak çıkar.',
      '',
      'ADIM 1: Belge tipini tespit et (EFATURA/EARSIV/OKC_FIS/Z_RAPORU/MAKBUZ/GIDER_PUSULASI/SMM/DEKONT/SEVK_IRSALIYESI/DIGER).',
      'ADIM 2: Tipe göre doğru alandan belge no\'yu KARAKTER KARAKTER kopyala (sıfırları atlama).',
      '         ► Z_RAPORU ise: "Z NO" alanını ara, "FIŞ NO" DEĞİL!',
      '         ► E-FATURA/EARSIV ise: 16 karakter (3 harf + 13 rakam)',
      'ADIM 3: TARİHİ MUTLAKA BUL — belgenin üstünde/altında DAİMA vardır.',
      '         DD-MM-YYYY Türk formatından "YYYY-MM-DD"\'ye çevir.',
      '         "10-03-2026" → "2026-03-10" (10 Mart 2026, ay-gün YERİNİ DEĞİŞTİRME).',
      '         Sadece görsel tamamen okunamıyorsa tarih=null dön.',
      'ADIM 4: KDV oranlarını tara — birden fazla varsa breakdown dizisini MUTLAKA doldur, kdvTutari = toplam.',
      '         ► KDV SADECE "KDV" / "Katma Değer Vergisi" etiketli satırlardan okunur.',
      '         ► Özel İletişim Vergisi (ÖİV), Telsiz Kullanım Vergisi, ÖTV, Damga, BSMV, KKDF → KDV DEĞİL, dahil etme!',
      '         ► Turkcell/Vodafone/TT telekom faturalarında SADECE "Katma Değer Vergisi" satırı KDV\'dir.',
      'ADIM 5: Her alan için gerçekçi confidence skoru ver.',
      '',
      'YASAK: TR1.2, TEMELFATURA, TICARIFATURA, UUID, ETTN, VKN, TCKN asla belge no DEĞİL.',
      'Z RAPORU YASAK: FIŞ NO / EKÜ NO / AT NO / SAAT / Z NO HARİÇ HİÇBİR ŞEY belge no DEĞİL.',
      'KDV YASAK: ÖİV / Telsiz / ÖTV / Damga / BSMV / KKDF / Konaklama / Çevre / Fon = KDV DEĞİL.',
      'Sadece JSON dön.',
    ].join('\n');

    const startMs = Date.now();
    // 429 retry — Anthropic rate limit'e takıldığımızda exponential backoff ile tekrar dene.
    // retry-after header'ı varsa ona saygı göster; yoksa progresif bekle.
    // 6 retry · toplam ~13dk bekleme penceresi (eski: 4 retry · 3.5dk yetmiyordu)
    const MAX_RETRIES = 6;
    const BACKOFF_SECONDS = [10, 25, 60, 120, 240, 360];
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
      const retryAfter =
        Number(res.headers.get('retry-after')) ||
        BACKOFF_SECONDS[attempt] ||
        60;
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

    // Token kullanımı + maliyet (model bazlı)
    const inputTokens = Number(payload?.usage?.input_tokens || 0);
    const outputTokens = Number(payload?.usage?.output_tokens || 0);
    const price = CLAUDE_PRICES[MODEL] || CLAUDE_PRICES['claude-sonnet-4-5'];
    const costUsd =
      (inputTokens / 1_000_000) * price.input +
      (outputTokens / 1_000_000) * price.output;
    const usage = { inputTokens, outputTokens, costUsd };

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
        engine: MODEL,
        usage,
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

    // ── KDV BREAKDOWN — çok oranlı belgelerde her KDV oranı için ayrı satır ──
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

    // Belge tipi — Claude prompt'unda var
    const belgeTipi = parsed.belgeTipi
      ? String(parsed.belgeTipi).toUpperCase().trim()
      : null;

    return {
      rawText: JSON.stringify(parsed).slice(0, 2000),
      belgeNo,
      date,
      kdvTutari,
      totalTutari: toplam,
      belgeTipi,
      kdvBreakdown,
      confidence,
      fieldConfidence,
      engine: MODEL,
      usage,
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
    const tr = s.match(/^(\d{1,2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{4})$/);
    if (tr) {
      let dd = +tr[1], mo = +tr[2], yy = +tr[3];
      // Türk belgeleri DAİMA DD-MM-YYYY. Sadece gün > 12 olduğunda swap mantıklı.
      if (dd < 1 || mo < 1) return null;
      if (mo > 12 && dd <= 12) {
        // Claude yanlışlıkla US formatı döndü, swap
        [dd, mo] = [mo, dd];
      }
      if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
      if (yy < 2000 || yy > 2050) return null;
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
      /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})\b/g,
      /\b(\d{1,2})\s(\d{1,2})\s(\d{4})\b/g,
    ];
    for (const re of regexes) {
      for (const m of text.matchAll(re)) {
        let dd = +m[1], mo = +m[2];
        const yy = +m[3];
        if (yy < 2000 || yy > 2050) continue;
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
    belgeNoFromFilename: string | null
  ): Promise<OcrResult> {
    const fullText = await this.getAzureRawText(buffer);

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
    // Z RAPORU tespiti — eğer metinde Z RAPORU geçiyorsa Z NO'yu al
    const isZRapor = /z\s*rapor(u|[ıi])?|z\s*report/i.test(text);
    if (isZRapor) {
      // "Z NO: 666" formatını ara (iki nokta, tire veya boşluk sonrası rakam)
      const zNo = text.match(/z\s*no\s*[:\-.#\s]+(\d{1,8})/i);
      if (zNo?.[1]) return zNo[1].trim();
    }

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

  /**
   * Z RAPORU özel parser — Azure ham metninden TOPKDV / TOPKDV %X satırlarını çıkarır.
   * Çıktı: { kdvTutari, breakdown }
   *
   * KRİTİK: "KUM TOPKDV" / "KUM TOPLAM" satırları KÜMÜLATİF — ASLA ALMA.
   * Sadece o anki Z raporu için "TOPKDV" / "TOPKDV %X" satırlarını al.
   */
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

    // 1) TOPLAM %X satırlarından MATRAH'ları topla
    //    "TOPLAM %20  *140,00" gibi satırları yakala
    const matrahRegex = /^TOPLAM\s*[%/]\s*(\d{1,2})\b\s*[\*:]?\s*([\d.,]+)/i;
    for (const line of lines) {
      // KUM içeren satırları atla (kümülatif)
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

    // 2) TOPKDV %X satırlarından her oran için KDV tutarını al
    //    "TOPKDV %20  *23,33" / "TOPKDV /20 *23.33" gibi
    const breakdownRegex = /^TOPKDV\s*[%/]\s*(\d{1,2})\b\s*[\*:]?\s*([\d.,]+)/i;
    for (const line of lines) {
      if (/\bKUM\b/i.test(line)) continue; // kümülatifi atla
      const m = line.match(breakdownRegex);
      if (m) {
        const oran = parseInt(m[1], 10);
        const tutar = this.parseAmount(m[2]);
        if (oran > 0 && oran <= 30 && tutar > 0) {
          // matrahByOran'dan ilgili matrahı al
          const matrah = result.matrahByOran[oran] ?? null;
          result.breakdown.push({ oran, tutar, matrah });
        }
      }
    }

    // 3) Toplam TOPKDV — breakdown varsa toplamını al, yoksa "TOPKDV ..." satırını ara
    if (result.breakdown.length > 0) {
      const sum = result.breakdown.reduce((s, b) => s + b.tutar, 0);
      result.kdvTutari = this.formatAmount(sum);
    } else {
      // Tek oranlı / sadece TOPKDV var — "TOPKDV  *344,56" gibi
      // KUM içermeyen, %X içermeyen sade TOPKDV satırı
      const simpleTopkdvRegex = /^TOPKDV\s*[\*:]?\s*([\d.,]+)\s*$/i;
      for (const line of lines) {
        if (/\bKUM\b/i.test(line)) continue;
        if (/[%/]\s*\d/.test(line)) continue; // %X olan satır
        const m = line.match(simpleTopkdvRegex);
        if (m) {
          const tutar = this.parseAmount(m[1]);
          if (tutar > 0) {
            result.kdvTutari = this.formatAmount(tutar);
            break;
          }
        }
      }
    }

    return result;
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
      // Fallback: tarihin canonical formunu (ddmmyyyy) tüm non-digit temizlendikten
      // sonra Azure text'inde ara — separator ne olursa olsun yakalar
      const canonical = `${dd}${mo}${yy}`;
      const normalizedText = text.replace(/[^0-9]/g, '');
      return normalizedText.includes(canonical);
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
  private crossCheckWithAzure(
    result: OcrResult,
    azureText: string,
    originalName?: string,
    belgeNoFromFilename?: string | null,
  ): void {
    if (!azureText || azureText.length < 10) return;

    // Filename ile belge no eşleşiyorsa (veya yakın — OCR 1-2 karakter hata yapmış),
    // belge no cross-check'ini ATLA. Filename %100 güvenilir kaynak — Azure render
    // kalitesi düşükse FAIL verebilir ama bu false positive'dir.
    // ÖRNEKLER:
    //   SRD2026000000760.xml + OCR=SRD2026000000760 → TAM eşleşme
    //   ESR2026000001162.xml + OCR=ESR20260000011162 → 1 karakter farklı (OCR digit eklemiş)
    //   ESR2026000001204.xml + OCR=ESR20260000001204 → 1 karakter farklı (OCR digit eklemiş)
    // Edit distance ≤ 2 ve ≥10 karakter uzunluğunda ise filename'i otorite kabul et.
    let skipBelgeNoCheck = false;
    if (belgeNoFromFilename && result.belgeNo) {
      const fn = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ocr = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const exactMatch = fn === ocr && fn.length >= 4;
      const nearMatch = fn.length >= 10 && this.editDistance(fn, ocr) <= 2;
      if (exactMatch || nearMatch) {
        skipBelgeNoCheck = true;
        // Near match durumda filename'i otorite kabul et — OCR digit eklemiş/atlatmış
        if (nearMatch && !exactMatch) {
          this.logger.warn(
            `Belge no Levenshtein override: OCR="${ocr}" → filename="${fn}" (edit distance ≤ 2, ${originalName})`,
          );
          result.belgeNo = belgeNoFromFilename;
        }
        // Filename match → belge no zaten %95 confidence
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

    // ─── Z RAPORU AUTO-CORRECT — Azure metninden direkt çıkar ───
    // Z raporları yapısal: TOPLAM %X / TOPKDV %X / TOPKDV satırları sabit format.
    // Claude halüsinasyon yapsa bile Azure regex'i doğru değeri çıkarır.
    if (result.belgeTipi === 'Z_RAPORU') {
      const zParsed = this.extractZRaporuKdvFromAzure(azureText);
      if (zParsed.kdvTutari) {
        const claudeKdv = result.kdvTutari ? this.parseAmount(result.kdvTutari) : 0;
        const azureKdv = this.parseAmount(zParsed.kdvTutari);
        // Eğer farklılarsa Azure'un değerini kullan (regex parse daha güvenilir)
        if (Math.abs(claudeKdv - azureKdv) > 0.05) {
          this.logger.warn(
            `Z_RAPORU KDV auto-correct: Claude=${result.kdvTutari} → Azure=${zParsed.kdvTutari} (${originalName})`,
          );
          result.kdvTutari = zParsed.kdvTutari;
          result.fieldConfidence.kdvTutari = 0.92; // Azure regex match → yüksek güven
        } else {
          // Eşleşiyorsa zaten doğruydu — confidence boost
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.95,
          );
        }
      }
      // Breakdown'u Azure'dan al (Claude vermediyse veya yanlışsa)
      if (zParsed.breakdown.length > 0) {
        const claudeBreakdownCount = result.kdvBreakdown?.length || 0;
        if (claudeBreakdownCount === 0 || claudeBreakdownCount !== zParsed.breakdown.length) {
          this.logger.warn(
            `Z_RAPORU breakdown auto-fill: Claude=${claudeBreakdownCount} oran → Azure=${zParsed.breakdown.length} oran (${originalName})`,
          );
          result.kdvBreakdown = zParsed.breakdown;
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
      // Filename ile belge no eşleşiyorsa cross-check'i atla (yukarıdaki blok hallettı)
      if (c.key === 'belgeNo' && skipBelgeNoCheck) {
        matched++;
        continue;
      }
      const found = this.isFieldInAzureText(c.value, c.field, azureText);
      if (found) {
        matched++;
        // Tanık var → confidence boost (en az %90)
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
        // Kısa belge no (1-3 hane) için cross-check güvenilmez (etiket bağlamı sorunu).
        // Bu durumda confidence'ı çok kırma, sadece orta seviyeye çek (0.6).
        const isShortBelgeNo =
          c.key === 'belgeNo' &&
          c.value.replace(/[^A-Z0-9]/gi, '').length <= 3;
        result.fieldConfidence[c.key] = isShortBelgeNo ? 0.6 : 0.2;
      }
    }

    // Genel confidence'ı yeniden hesapla
    const scores = [
      result.fieldConfidence.belgeNo,
      result.fieldConfidence.date,
      result.fieldConfidence.kdvTutari,
    ].filter((v): v is number => typeof v === 'number');
    if (scores.length > 0) {
      result.confidence = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    this.logger.log(
      `Cross-check: ${matched}/${matched + mismatched} eşleşti ` +
        (mismatches.length > 0 ? `· mismatch: [${mismatches.join(', ')}]` : ''),
    );
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
  private postProcessOcrResult(
    result: OcrResult,
    belgeNoFromFilename: string | null,
    originalName?: string,
  ): void {
    // ─── 1. BELGE NO — Yasak değerleri temizle ───
    if (result.belgeNo) {
      const cleaned = result.belgeNo.trim().toUpperCase();
      const forbidden = [
        /^TR[\d.\-_]+$/,                         // TR1.2, TR1.0
        /^UBL[\d.\-_]*$/,                        // UBL-2.1
        /^(TEMELFATURA|TICARIFATURA|EARSIVFATURA)$/,
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i, // UUID/ETTN
      ];
      if (forbidden.some((p) => p.test(cleaned))) {
        this.logger.warn(`OCR yasak belge no değeri: "${cleaned}" → null (${originalName})`);
        result.belgeNo = null;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = null;
      }
    }

    // ─── 2. BELGE NO — Filename override (eksik/yanlış OCR) ───
    if (belgeNoFromFilename) {
      const fnClean = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ocrClean = (result.belgeNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

      // Senaryolar:
      //   a) OCR belge no yok, filename var → kullan
      //   b) OCR belge no çok kısa (<10 char) ama filename uzun (≥10) → kullan
      //   c) OCR belge no filename'in prefix'i ile eşleşiyor ama kısa kalmış → kullan
      //   d) OCR belge no ≥10 char ve filename ile edit distance ≤ 2 → kullan
      //      (OCR 1-2 karakter hatası yapmış: fazladan digit eklemiş/atlamış)
      //   e) OCR belge no ile filename tamamen farklıysa → dokunma (kullanıcı düzeltsin)
      const editDist =
        fnClean.length >= 10 && ocrClean.length >= 10
          ? this.editDistance(fnClean, ocrClean)
          : Infinity;
      const shouldOverride =
        !ocrClean ||
        (ocrClean.length < 10 && fnClean.length >= 10) ||
        (fnClean.length > ocrClean.length && fnClean.startsWith(ocrClean.slice(0, 3))) ||
        (fnClean.length >= 10 && editDist <= 2);

      if (shouldOverride && fnClean !== ocrClean) {
        this.logger.warn(
          `Belge no filename override: "${ocrClean}" → "${fnClean}" (editDist=${editDist === Infinity ? 'n/a' : editDist}, ${originalName})`,
        );
        result.belgeNo = belgeNoFromFilename;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.9;
      }
    }

    // ─── 2b. Z_RAPORU özel filename override ───
    // Z raporu filename'i genelde sadece Z NO'dan oluşur ("670.image", "0670.image", "Z670.image").
    // Standart filename override şartı (≥10 char) bu kısa numaralar için tetiklenmez,
    // o yüzden Z raporları için ayrı kural koyuyoruz.
    if (result.belgeTipi === 'Z_RAPORU' && originalName) {
      const fnBase = originalName.replace(/\.[^/.]+$/, '').trim();
      // Salt rakam (1-8 hane) veya "Z" + rakam → Z NO kabul
      const zMatch = fnBase.match(/^Z?(\d{1,8})$/i);
      if (zMatch) {
        const zNoFromFilename = zMatch[1];
        const ocrBn = (result.belgeNo || '').replace(/\D/g, '');
        if (ocrBn !== zNoFromFilename) {
          this.logger.warn(
            `Z_RAPORU filename override: OCR="${result.belgeNo}" → "${zNoFromFilename}" (${originalName})`,
          );
          result.belgeNo = zNoFromFilename;
          if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.95;
        }
      }
    }

    // ─── 3. BELGE NO — Pattern/uzunluk kontrolü ───
    if (result.belgeNo) {
      const bn = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const tipi = result.belgeTipi;
      // e-Fatura/e-Arşiv: genelde 16 char (3 harf + 13 rakam). 13 altı şüpheli.
      if ((tipi === 'EFATURA' || tipi === 'EARSIV') && bn.length < 13) {
        this.logger.warn(`Belge tipi ${tipi} için belge no kısa (${bn.length} char): ${bn}`);
        if (result.fieldConfidence && (result.fieldConfidence.belgeNo ?? 0) > 0.5) {
          result.fieldConfidence.belgeNo = 0.5;
        }
      }
    }

    // ─── 3b. TARİH — rawText fallback (Claude null döndürdüyse) ───
    if (!result.date && result.rawText) {
      const trDate = this.extractDateFromText(result.rawText);
      if (trDate) {
        // DD.MM.YYYY → YYYY-MM-DD ile aynı internal tutmak için DD.MM.YYYY kabul et;
        // postProcess sonraki adımı YYYY-MM-DD bekliyor — bu fallback için DD.MM bypass.
        this.logger.warn(
          `Tarih Claude'tan boş geldi, rawText'ten yakalandı: ${trDate} (${originalName})`,
        );
        result.date = trDate; // direkt DD.MM.YYYY (zaten Türk display formatı)
        if (result.fieldConfidence) result.fieldConfidence.date = 0.7;
      }
    }

    // ─── 4. TARİH — Ay/gün/yıl geçerlilik ───
    // Bu noktada result.date formatı DAİMA "DD.MM.YYYY" (formatIsoToTr sonrası Türk display formatı)
    if (result.date) {
      const m = result.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) {
        // DD.MM.YYYY değil → normalize etmeye çalış
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
            this.logger.warn(`Tarih geçersiz: ${result.date}`);
            result.date = null;
            if (result.fieldConfidence) result.fieldConfidence.date = 0;
          } else if (yy < 2000 || yy > 2050) {
            this.logger.warn(`Yıl makul dışı: ${yy}`);
            if (result.fieldConfidence) {
              result.fieldConfidence.date = Math.min(result.fieldConfidence.date ?? 1, 0.3);
            }
          }
        }
      }
    }

    // ─── 5. TUTAR NORMALIZE — ₺, TL, boşluk temizle ───
    const normalizeAmount = (s: string | null | undefined): string | null => {
      if (!s) return null as any;
      return s
        .replace(/₺|TL|USD|EUR/gi, '')
        .replace(/\s+/g, '')
        .trim() || null;
    };
    result.kdvTutari = normalizeAmount(result.kdvTutari);
    result.totalTutari = normalizeAmount(result.totalTutari);

    // ─── 6. KDV BREAKDOWN — Toplam kontrolü ───
    let breakdownInconsistent = false;
    if (result.kdvBreakdown && result.kdvBreakdown.length > 0 && result.kdvTutari) {
      const breakdownSum = result.kdvBreakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
      const declaredTotal = this.parseAmount(result.kdvTutari);
      // ±1 kuruş tolerans (yuvarlama)
      if (Math.abs(breakdownSum - declaredTotal) > 0.05) {
        this.logger.warn(
          `KDV breakdown tutarsız: breakdown=${breakdownSum.toFixed(2)} vs kdvTutari=${declaredTotal.toFixed(2)} — breakdown toplamını kullan`,
        );
        // Breakdown toplamı daha güvenilir — çünkü her oran ayrı görüldü
        result.kdvTutari = this.formatAmount(breakdownSum);
        // KDV güvenini düşür — Claude'un kdvTutari'sı yanlıştı
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.5,
            0.5,
          );
        }
      }

      // 7. Matrah × oran / 100 ≈ tutar çapraz doğrulama (AGRESİF)
      for (const b of result.kdvBreakdown) {
        if (b.matrah && b.oran > 0) {
          const expected = (Number(b.matrah) * b.oran) / 100;
          const actual = Number(b.tutar);
          const diffPct = Math.abs(expected - actual) / (expected || 1);
          if (diffPct > 0.02) {
            // %2'den fazla sapma → OCR hatası, item'ı işaretle
            this.logger.warn(
              `KDV %${b.oran}: matrah×oran=${expected.toFixed(2)} ≠ tutar=${actual.toFixed(2)} (%${Math.round(diffPct * 100)} sapma) — confidence düşürülüyor`,
            );
            breakdownInconsistent = true;
            // Doğru değer matrah×oran/100 olmalı — düzelt
            b.tutar = parseFloat(expected.toFixed(2));
          }
        }
      }

      // Breakdown'da tutarsızlık varsa kdvTutari'yi yeniden hesapla
      if (breakdownInconsistent) {
        const fixedSum = result.kdvBreakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
        result.kdvTutari = this.formatAmount(fixedSum);
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.4,
            0.4,
          );
        }
      }
    }

    // ─── 8. Z_RAPORU breakdown ZORUNLU — boşsa kullanıcıya yolla ───
    // Çoğu Z raporu çok oranlı (KIRTASIYE %20 + GIDA %10 vs.) — breakdown olmadan güvenilemez
    if (result.belgeTipi === 'Z_RAPORU' && (!result.kdvBreakdown || result.kdvBreakdown.length === 0)) {
      // Z raporunda KDV varsa ama breakdown yoksa → şüpheli, kullanıcı teyidine
      if (result.kdvTutari) {
        this.logger.warn(
          `Z_RAPORU breakdown EKSİK: kdvTutari=${result.kdvTutari} ama oran kırılımı yok (${originalName}) — confidence düşürülüyor`,
        );
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.4,
            0.4,
          );
        }
      }
    }

    // ─── 9. KDV TUTARI — makul aralık kontrolü ───
    // Toplam tutara göre KDV oranı %0-%30 arası makul. Dışındaysa şüpheli.
    if (result.kdvTutari && result.totalTutari) {
      const kdvNum = this.parseAmount(result.kdvTutari);
      const totalNum = this.parseAmount(result.totalTutari);
      if (totalNum > 0 && kdvNum > 0) {
        const ratio = kdvNum / totalNum;
        if (ratio > 0.35 || ratio < 0.005) {
          this.logger.warn(
            `KDV/Toplam oranı şüpheli: kdv=${kdvNum} toplam=${totalNum} oran=%${(ratio * 100).toFixed(1)} (${originalName})`,
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
  private parseUblXml(xml: string): OcrResult | null {
    if (!xml || xml.length < 50) return null;

    // ─── BELGE NO ─────────────────────────────────────
    // UBL'de top-level ID: CustomizationID + ProfileID sonrasında gelir.
    // Regex ile ProfileID sonrası ilk <cbc:ID> alınır (CustomizationID=TR1.2 değil).
    let belgeNo: string | null = null;
    const afterProfile = xml.match(/<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>([^<]+)<\/cbc:ID>/i);
    if (afterProfile) belgeNo = afterProfile[1].trim();
    // Fallback: Invoice/ArchiveInvoice root altında ilk <cbc:ID>
    if (!belgeNo) {
      const rootId = xml.match(/<(?:Invoice|ArchiveInvoice)[^>]*>[\s\S]*?<cbc:ID>([^<]+)<\/cbc:ID>/i);
      if (rootId) {
        const candidate = rootId[1].trim();
        // TR1.2, UBL-2.1 gibi versiyon stringlerini reddet
        if (!/^(TR|UBL)[\d.\-]+$/i.test(candidate) && candidate.length >= 5) {
          belgeNo = candidate;
        }
      }
    }

    // ─── TARİH ─────────────────────────────────────────
    let date: string | null = null;
    const issueDate = xml.match(/<cbc:IssueDate>([^<]+)<\/cbc:IssueDate>/i);
    if (issueDate) {
      const d = issueDate[1].trim();
      // UBL standardı zaten YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d;
    }

    // ─── KDV TUTARI + BREAKDOWN ────────────────────────
    // Turkish UBL e-Fatura'da bir TaxSubtotal bloğunda KDV dışında vergi türleri
    // de olabilir (ÖİV, Telsiz Kullanım, ÖTV, Damga, BSMV, KKDF, Konaklama vb.).
    // TaxCategory > TaxScheme > Name/TaxTypeCode alanına bakarak SADECE KDV'yi al.
    // KDV için standart kodlar: "KDV" (Name) veya "0015" (TaxTypeCode).
    const kdvBreakdown: KdvBreakdownItem[] = [];
    const subtotalRegex = /<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/gi;
    let m: RegExpExecArray | null;
    while ((m = subtotalRegex.exec(xml)) !== null) {
      const block = m[1];
      // Tax türü belirleme — KDV dışındaki vergileri atla
      const taxSchemeName = block.match(/<cbc:Name>([^<]+)<\/cbc:Name>/i)?.[1]?.trim().toUpperCase() || '';
      const taxSchemeId =
        block.match(/<cbc:TaxTypeCode>([^<]+)<\/cbc:TaxTypeCode>/i)?.[1]?.trim() ||
        block.match(/<cac:TaxScheme>[\s\S]*?<cbc:ID>([^<]+)<\/cbc:ID>/i)?.[1]?.trim() ||
        '';
      // KDV dışı vergi türlerini ele (ÖİV, Telsiz, ÖTV, Damga, vb.)
      const isNotKdv =
        /ÖZEL\s*İLETİŞİM|OZEL\s*ILETISIM|ÖİV|OIV/i.test(taxSchemeName) ||
        /TELSİZ|TELSIZ/i.test(taxSchemeName) ||
        /ÖTV|OTV|ÖZEL\s*TÜKETİM/i.test(taxSchemeName) ||
        /DAMGA/i.test(taxSchemeName) ||
        /BSMV/i.test(taxSchemeName) ||
        /KKDF/i.test(taxSchemeName) ||
        /KONAKLAMA/i.test(taxSchemeName) ||
        /STOPAJ|TEVKIFAT|TEVKİFAT/i.test(taxSchemeName) ||
        // TaxTypeCode: 0003=Damga, 0059=ÖİV, 0071=ÖTV, 4080=Konaklama (GİB kod listesi)
        ['0003', '0059', '0061', '0071', '0072', '0073', '0074', '0075', '0076', '0077', '4080', '9040', '9077'].includes(taxSchemeId);
      const isKdv =
        /^KDV$|KATMA\s*DEĞER|KATMA\s*DEGER/i.test(taxSchemeName) ||
        taxSchemeId === '0015';
      // Eğer kesinlikle KDV değilse atla
      if (isNotKdv) {
        this.logger.log(
          `XML parser: KDV dışı vergi atlandı — Name="${taxSchemeName}" Code="${taxSchemeId}"`,
        );
        continue;
      }
      // Ne KDV ne de açıkça KDV dışı — TaxScheme yoksa (eski fatura formatı) varsayım KDV
      // Ama hem Name hem Code boşsa ve breakdown çoktan başka KDV satırları aldıysa
      // güvenlik için atla.
      if (!isKdv && (taxSchemeName || taxSchemeId)) {
        // Etiket var ama KDV değil — atla
        this.logger.warn(
          `XML parser: bilinmeyen vergi türü atlandı — Name="${taxSchemeName}" Code="${taxSchemeId}"`,
        );
        continue;
      }

      const taxableMatch = block.match(/<cbc:TaxableAmount[^>]*>([^<]+)<\/cbc:TaxableAmount>/i);
      const taxAmountMatch = block.match(/<cbc:TaxAmount[^>]*>([^<]+)<\/cbc:TaxAmount>/i);
      const percentMatch = block.match(/<cbc:Percent>([^<]+)<\/cbc:Percent>/i);
      if (taxAmountMatch) {
        const tutar = parseFloat(taxAmountMatch[1]) || 0;
        const matrah = taxableMatch ? parseFloat(taxableMatch[1]) : null;
        const oran = percentMatch ? parseFloat(percentMatch[1]) : 0;
        if (tutar > 0 || (oran === 0 && matrah && matrah > 0)) {
          kdvBreakdown.push({ oran, tutar, matrah });
        }
      }
    }

    // Toplam KDV: breakdown toplamı. Fallback kaldırıldı — eski "ilk TaxAmount'u al"
    // kuralı telekom faturalarında ÖİV/Telsiz'i de toplayıp yanlış KDV üretiyordu.
    const kdvToplam = kdvBreakdown.reduce((s, b) => s + (b.tutar || 0), 0);
    const kdvTutari = kdvToplam > 0 ? this.formatAmount(kdvToplam) : null;

    // ─── TOPLAM ÖDENECEK ─────────────────────────────
    let totalTutari: string | null = null;
    const payable = xml.match(/<cbc:PayableAmount[^>]*>([^<]+)<\/cbc:PayableAmount>/i);
    if (payable) {
      const t = parseFloat(payable[1]) || 0;
      if (t > 0) totalTutari = this.formatAmount(t);
    }

    // ─── SATICI / BELGE TİPİ ─────────────────────────
    const isArchive = /<ArchiveInvoice|InvoiceTypeCode[^>]*>EARSIV/i.test(xml);
    const belgeTipi = isArchive ? 'EARSIV' : 'EFATURA';

    // Hiç veri yoksa null dön
    if (!belgeNo && !date && !kdvTutari) return null;

    return {
      rawText: '', // XML içeriğini log'a taşımıyoruz — büyük olabilir
      belgeNo,
      date,
      kdvTutari,
      totalTutari,
      belgeTipi,
      kdvBreakdown: kdvBreakdown.length > 0 ? kdvBreakdown : null,
      confidence: belgeNo && date && kdvTutari ? 0.99 : 0.85,
      fieldConfidence: {
        belgeNo: belgeNo ? 0.99 : null,
        date: date ? 0.99 : null,
        kdvTutari: kdvTutari ? 0.99 : null,
      },
      engine: 'ubl-xml-direct',
    };
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
}
