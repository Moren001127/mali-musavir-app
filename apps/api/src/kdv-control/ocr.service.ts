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

/** Claude Haiku 4.5 fiyat ($/M token) */
const CLAUDE_HAIKU_PRICE = { input: 1, output: 5 };

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
    // Uzantı .xml veya içerik <?xml ile başlıyorsa Claude'a gitmeden
    // UBL alanlarını doğrudan regex'le çıkar. %100 doğruluk, 0 maliyet.
    const isXml =
      /\.xml$/i.test(originalName || '') ||
      imageBuffer.slice(0, 64).toString('utf8').trimStart().startsWith('<?xml') ||
      imageBuffer.slice(0, 512).toString('utf8').includes('<Invoice') ||
      imageBuffer.slice(0, 512).toString('utf8').includes('<ArchiveInvoice');

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
      } catch (e: any) {
        this.logger.warn(`XML parse hatası (${originalName}): ${e?.message}`);
      }
    }

    // 1. Tercih: Claude Haiku 4.5 Vision (eğer API key varsa)
    if (hasClaudeKey) {
      try {
        const claudeResult = await this.runClaudeVisionOcr(imageBuffer);
        if (claudeResult.belgeNo || claudeResult.date || claudeResult.kdvTutari) {
          // ═══ KAPSAMLI POST-PROCESS DOĞRULAMA ═══
          this.postProcessOcrResult(claudeResult, belgeNoFromFilename, originalName);
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
      '  • Z_RAPORU → "Z NO" etiketindeki değer. FIŞ NO / EKÜ NO / AT NO DEĞİL!',
      '    Örn. "Z NO: 666" → belgeNo = "666".',
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
      'Türkiye\'de tarih DAİMA "GÜN-AY-YIL" sırasıdır. İLK kısım GÜN, ORTA kısım AY, SON 4 hane YIL.',
      '  • "11-03-2026" = "11.03.2026" = "11/03/2026" = 11 Mart 2026 → output "2026-03-11"',
      '  • "31.12.2025" → 31 Aralık 2025 → output "2025-12-31"',
      'KURAL: Eğer ilk hane 13-31 arasındaysa o KESİNLİKLE gün. Ay 1-12 arası olur.',
      'SAKIN ABD formatı (MM-DD-YYYY) düşünme — Türk belgeleri ASLA öyle yazmaz.',
      'Etiketler: "Fatura Tarihi", "Belge Tarihi", "Düzenleme Tarihi", "Fiş Tarihi", "Tanzim Tarihi" — hepsi aynı tarih.',
      'Yıl 2020-2050 dışındaysa muhtemelen OCR hatası, confidence düşür.',
      '',
      '╔══ 5) KDV — ÇOK ORANLI / BREAKDOWN ══╗',
      'Türk belgelerinde KDV oranları: %0, %1, %8, %10, %18, %20 (güncel). Eski: %18.',
      'Görselde BİRDEN FAZLA KDV oranı varsa (Z raporu, karma fatura):',
      '  → HER ORAN İÇİN AYRI "kdvBreakdown" öğesi dön.',
      '  → kdvTutari = breakdown\'daki TÜM tutarların TOPLAMI.',
      'Örnek Z raporu: "TOPKDV %20: 47,50 / TOPKDV %10: 243,19"',
      '  → kdvBreakdown=[{"oran":20,"tutar":"47,50","matrah":"285,00"},{"oran":10,"tutar":"243,19","matrah":"2675,00"}]',
      '  → kdvTutari="290,69" (47,50 + 243,19)',
      'Tek oran olsa bile breakdown tek eleman olarak doldurabilirsin (tavsiye).',
      '',
      '╔══ 6) TUTAR FORMATI ══╗',
      'Türkiye: nokta binlik ayraç, virgül ondalık. "1.234,56" → output "1234,56" (noktasız, virgüllü).',
      '"KDV" etiketi: "KDV", "K.D.V.", "Hesaplanan KDV", "KDV Tutarı", "TOPKDV", "KUM TOPKDV".',
      '"Toplam" etiketi: "Genel Toplam", "Ödenecek", "Fatura Toplamı", "Vergiler Dahil Toplam".',
      'Eğer tutar "₺" ya da "TL" içeriyorsa o işareti KALDIR, sadece sayı kal.',
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
      'ADIM 3: Tarihi DD-MM-YYYY Türk formatından "YYYY-MM-DD"\'ye çevir (ASLA ay-gün yerini değiştirme).',
      'ADIM 4: KDV oranlarını tara — birden fazla varsa breakdown dizisini doldur, kdvTutari = toplam.',
      'ADIM 5: Her alan için gerçekçi confidence skoru ver.',
      '',
      'YASAK: TR1.2, TEMELFATURA, TICARIFATURA, UUID, ETTN, VKN, TCKN asla belge no DEĞİL.',
      'Sadece JSON dön.',
    ].join('\n');

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

    // Token kullanımı + maliyet (Haiku 4.5)
    const inputTokens = Number(payload?.usage?.input_tokens || 0);
    const outputTokens = Number(payload?.usage?.output_tokens || 0);
    const costUsd =
      (inputTokens / 1_000_000) * CLAUDE_HAIKU_PRICE.input +
      (outputTokens / 1_000_000) * CLAUDE_HAIKU_PRICE.output;
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
        engine: 'claude-haiku-4-5',
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
      //   d) OCR belge no ile filename tamamen farklıysa → dokunma (kullanıcı düzeltsin)
      const shouldOverride =
        !ocrClean ||
        (ocrClean.length < 10 && fnClean.length >= 10) ||
        (fnClean.length > ocrClean.length && fnClean.startsWith(ocrClean.slice(0, 3)));

      if (shouldOverride && fnClean !== ocrClean) {
        this.logger.warn(
          `Belge no filename override: "${ocrClean}" → "${fnClean}" (${originalName})`,
        );
        result.belgeNo = belgeNoFromFilename;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.9;
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

    // ─── 4. TARİH — Ay/gün/yıl geçerlilik ───
    if (result.date) {
      const m = result.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) {
        // YYYY-MM-DD değil → null
        this.logger.warn(`Tarih format bozuk: "${result.date}" (${originalName})`);
        result.date = null;
        if (result.fieldConfidence) result.fieldConfidence.date = 0;
      } else {
        const yy = +m[1], mo = +m[2], dd = +m[3];
        if (mo < 1 || mo > 12 || dd < 1 || dd > 31) {
          this.logger.warn(`Tarih geçersiz: ${result.date}`);
          result.date = null;
          if (result.fieldConfidence) result.fieldConfidence.date = 0;
        } else if (dd <= 12 && mo <= 12 && dd !== mo) {
          // Ay/gün ambiguous — confidence düşür, kullanıcı teyidine bırak
          if (result.fieldConfidence && (result.fieldConfidence.date ?? 0) > 0.7) {
            result.fieldConfidence.date = 0.7;
          }
        }
        // Yıl 2000-2050 makul, dışındakilerin confidence'ı düşür
        if (yy < 2000 || yy > 2050) {
          this.logger.warn(`Yıl makul dışı: ${yy}`);
          if (result.fieldConfidence) {
            result.fieldConfidence.date = Math.min(result.fieldConfidence.date ?? 1, 0.3);
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
      }

      // 7. Matrah × oran / 100 ≈ tutar çapraz doğrulama
      for (const b of result.kdvBreakdown) {
        if (b.matrah && b.oran > 0) {
          const expected = (Number(b.matrah) * b.oran) / 100;
          const actual = Number(b.tutar);
          const diffPct = Math.abs(expected - actual) / (expected || 1);
          if (diffPct > 0.02) {
            // %2'den fazla sapma → OCR hatası olabilir
            this.logger.warn(
              `KDV %${b.oran}: matrah×oran=${expected.toFixed(2)} ≠ tutar=${actual.toFixed(2)} (%${Math.round(diffPct * 100)} sapma)`,
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
    const kdvBreakdown: KdvBreakdownItem[] = [];
    // Her <cac:TaxSubtotal>'u sırayla tara
    const subtotalRegex = /<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/gi;
    let m: RegExpExecArray | null;
    while ((m = subtotalRegex.exec(xml)) !== null) {
      const block = m[1];
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

    // Toplam KDV: breakdown toplamı veya root TaxTotal/TaxAmount
    let kdvToplam = kdvBreakdown.reduce((s, b) => s + (b.tutar || 0), 0);
    if (kdvToplam === 0) {
      // Fallback: ilk <cac:TaxTotal>/<cbc:TaxAmount>
      const rootTax = xml.match(/<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount[^>]*>([^<]+)<\/cbc:TaxAmount>/i);
      if (rootTax) kdvToplam = parseFloat(rootTax[1]) || 0;
    }
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
}
