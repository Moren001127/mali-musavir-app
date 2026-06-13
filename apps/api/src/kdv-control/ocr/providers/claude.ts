/**
 * Claude Vision OCR Provider.
 *
 * Turk muhasebe belgelerini (e-Fatura, e-Arsiv, OKC fis, Z raporu, makbuz, dekont)
 * Claude Haiku 4.5 Vision API ile analiz eder, yapilandirilmis OcrResult doner.
 *
 * Public API (Faz 4):
 *   runClaudeVisionOcr(buffer, deps) - PDF veya gorsel buffer alir, OcrResult doner
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 *   - parseAmount, formatAmount: Turkce para formati helpers
 *   - formatIsoToTr: YYYY-MM-DD → DD.MM.YYYY format cevirici
 *   - clampConfidence: 0-1 araliginda nullsafe normalize
 *   - logger: Nest Logger (log + warn)
 *
 * Network: fetch('https://api.anthropic.com/v1/messages'), ANTHROPIC_API_KEY,
 * OCR_MODEL env. Dinamik `sharp` import (image resize).
 */

import type { KdvBreakdownItem, OcrResult } from '../types';

/** Claude model fiyatlari ($/M token) */
const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

/** Confidence kisa format: 0.84 → "%84", null → "—" */
const fmtConf = (v: number | null | undefined): string =>
  typeof v === 'number' ? `%${Math.round(v * 100)}` : '—';

export interface ClaudeProviderDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  formatIsoToTr: (iso?: string | null) => string | null;
  clampConfidence: (v: any) => number;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Claude Vision OCR ana entry point.
 *
 * @param buffer       PDF veya image binary
 * @param defaultModel OCR_MODEL env yoksa kullanilacak default (genellikle claude-haiku-4-5-20251001)
 * @param deps         Pure helpers + logger
 *
 * Akis:
 *   1. PDF magic bytes tespit (%PDF) → document content type
 *   2. Image ise sharp ile 2000px'e resize, jpeg quality 90
 *   3. System prompt + user text + base64 content ile Claude API'ye POST
 *   4. 429/529 rate limit icin 6 retry, exponential backoff (10s → 360s)
 *   5. Prompt caching: system prompt 5dk cache (anthropic-beta header)
 *   6. JSON parse + alan extraction (belgeNo, tarih, KDV, breakdown, tevkifat, vendor, kategori)
 *   7. Tevkifat var ise NET KDV hesabi (tam - tevkifat), kdvTevkifat ayri alanda saklanir
 *   8. Token kullanimi + maliyet (cache_creation 1.25x, cache_read 0.1x)
 */
export async function runClaudeVisionOcr(
  buffer: Buffer,
  defaultModel: string,
  deps: ClaudeProviderDeps,
): Promise<OcrResult> {
  const { parseAmount, formatAmount, formatIsoToTr, clampConfidence, logger } = deps;
  if (process.env.MOREN_AI_ALLOW_ANTHROPIC_API !== '1') {
    throw new Error('Claude Vision API kapalı: MOREN_AI_ALLOW_ANTHROPIC_API=1 verilmeden API çağrısı yapılmaz.');
  }
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const MODEL = process.env.OCR_MODEL || defaultModel;

  // ─── DOSYA TIPI TESPIT (magic bytes) ───
  const isPdf =
    buffer.length >= 4 &&
    buffer[0] === 0x25 && buffer[1] === 0x50 &&
    buffer[2] === 0x44 && buffer[3] === 0x46;

  let b64: string;
  let mediaType = 'image/jpeg';
  let contentType: 'image' | 'document' = 'image';

  if (isPdf) {
    b64 = buffer.toString('base64');
    mediaType = 'application/pdf';
    contentType = 'document';
    logger.log(`Claude OCR: PDF input (${buffer.length} byte) → document type`);
  } else {
    try {
      const sharp = (await import('sharp')).default;
      const resized = await sharp(buffer)
        .rotate()
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      b64 = resized.toString('base64');
    } catch {
      b64 = buffer.toString('base64');
    }
  }

  const systemPrompt = SYSTEM_PROMPT;
  const userText = USER_TEXT;

  const startMs = Date.now();
  const MAX_RETRIES = 6;
  const BACKOFF_SECONDS = [10, 25, 60, 120, 240, 360];
  let res: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const contentBlock = contentType === 'document'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: mediaType, data: b64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: b64 } };

    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: isPdf ? 800 : 400,
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
    logger.warn(
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

  // Token + maliyet
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

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn(`Claude beklenen JSON döndürmedi: ${raw.slice(0, 100)}`);
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
    } as any;
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    /* parse failure → empty */
  }

  const date = formatIsoToTr(parsed.tarih) ?? null;
  const belgeNo = parsed.belgeNo ? String(parsed.belgeNo).toUpperCase().trim() : null;
  let kdvTutari = parsed.kdvTutari ? String(parsed.kdvTutari).replace(/\s/g, '') : null;
  const toplam = parsed.toplam ? String(parsed.toplam).replace(/\s/g, '') : null;

  // KDV TEVKIFATI — deterministik net hesap
  const kdvTevkifatRaw = parsed.kdvTevkifat ? String(parsed.kdvTevkifat).replace(/\s/g, '') : null;
  const kdvTevkifatNum = kdvTevkifatRaw ? parseAmount(kdvTevkifatRaw) : 0;
  let kdvTevkifatOut: string | null = null;
  if (kdvTutari && kdvTevkifatNum > 0) {
    const tamKdv = parseAmount(kdvTutari);
    const netKdv = Math.max(0, tamKdv - kdvTevkifatNum);
    logger.log(
      `Claude OCR: tevkifat düşüldü — tam=${tamKdv}, tevkifat=${kdvTevkifatNum}, net=${netKdv}`,
    );
    kdvTutari = formatAmount(netKdv);
    kdvTevkifatOut = formatAmount(kdvTevkifatNum);
  }

  const cf = parsed.confidence || {};
  const fieldConfidence = {
    belgeNo: belgeNo ? clampConfidence(cf.belgeNo) : null,
    date: date ? clampConfidence(cf.tarih) : null,
    kdvTutari: kdvTutari ? clampConfidence(cf.kdvTutari) : null,
  };

  const fieldScores = [fieldConfidence.belgeNo, fieldConfidence.date, fieldConfidence.kdvTutari]
    .filter((v): v is number => typeof v === 'number');
  const foundFields = fieldScores.length;
  const confidence = foundFields > 0
    ? fieldScores.reduce((a, b) => a + b, 0) / foundFields
    : 0;

  logger.log(
    `Claude OCR ✓ Alan:${foundFields}/3 · Conf:%${Math.round(confidence * 100)} ` +
      `(belgeNo:${fmtConf(fieldConfidence.belgeNo)} · tarih:${fmtConf(fieldConfidence.date)} · kdv:${fmtConf(fieldConfidence.kdvTutari)}) ` +
      `${Date.now() - startMs}ms`,
  );

  // KDV BREAKDOWN
  let kdvBreakdown: KdvBreakdownItem[] | null = null;
  if (Array.isArray(parsed.kdvBreakdown) && parsed.kdvBreakdown.length > 0) {
    const mappedBreakdown: KdvBreakdownItem[] = parsed.kdvBreakdown
      .map((item: any): KdvBreakdownItem => {
        const oran = typeof item?.oran === 'number' ? item.oran : parseFloat(String(item?.oran || 0));
        const tutar = parseAmount(String(item?.tutar ?? '0'));
        const matrahRaw = item?.matrah;
        const matrah = matrahRaw != null ? parseAmount(String(matrahRaw)) : null;
        return { oran: Number.isFinite(oran) ? oran : 0, tutar, matrah };
      })
      .filter((b: KdvBreakdownItem) => b.tutar > 0 || (b.oran === 0 && !!b.matrah));
    kdvBreakdown = mappedBreakdown.length > 0 ? mappedBreakdown : null;
  }

  if (kdvBreakdown && kdvBreakdown.length === 1 && kdvTevkifatNum > 0 && kdvTutari) {
    kdvBreakdown[0].tutar = parseAmount(kdvTutari);
  }

  // kdvBreakdown boş ama Claude kdvOrani + kdvTutari döndürdüyse → tek elemanlı breakdown üret.
  // Matrah belgede yazıyorsa kullan, yoksa KDV / oran'dan hesapla.
  if (!kdvBreakdown && parsed.kdvOrani && kdvTutari) {
    const oran = Number(parsed.kdvOrani);
    const kdvNum = parseAmount(kdvTutari);
    if (oran > 0 && kdvNum > 0) {
      const matrahRaw = parsed.matrah ? parseAmount(String(parsed.matrah)) : null;
      const matrah = matrahRaw && matrahRaw > 0
        ? matrahRaw
        : Math.round((kdvNum / (oran / 100)) * 100) / 100;
      kdvBreakdown = [{ oran, tutar: kdvNum, matrah }];
    }
  }

  const belgeTipi = parsed.belgeTipi
    ? String(parsed.belgeTipi).toUpperCase().trim()
    : null;
  const satici = parsed.satici
    ? String(parsed.satici).trim().slice(0, 200)
    : null;
  const saticiVknRaw = parsed.saticiVkn ? String(parsed.saticiVkn).replace(/\D/g, '') : null;
  const saticiVkn = saticiVknRaw && (saticiVknRaw.length === 10 || saticiVknRaw.length === 11)
    ? saticiVknRaw
    : null;

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

// ═══════════════════════════════════════════════════════════
// PROMPT TEMPLATES (uzun, modul sonunda)
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = [
  'Sen Türk muhasebe dokümanları (e-Fatura, e-Arşiv, ÖKC fişi, Z raporu, makbuz, dekont) için uzmanlaşmış bir OCR sistemisin.',
  'Görseli karakter karakter incele ve SADECE geçerli JSON dön — açıklama/prolog YOK.',
  '',
  '╔══ JSON ŞEMA ══╗',
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
  '  • Z_RAPORU → SADECE "Z NO" / "Z SAYAÇ" etiketindeki değer. FIŞ NO / EKÜ NO / AT NO / SAAT / TARİH ASLA DEĞİL!',
  '    ► KRİTİK: "FIŞ NO. 45" görsen bile o "FIŞ NO" — Z_RAPORU\'nda belge no DEĞİL.',
  '    ► Z raporunda doğru alan: "Z NO: 670" / "Z NO 670" / "Z SAYAÇ 896" / "Z SAYAÇ: 896" / "Z SAYACI 896" şeklinde geçer.',
  '    ► v1.36.72: BAZI ÖKC MODELLERİ "Z NO" YERİNE "Z SAYAÇ" KULLANIR (aynı anlam, aynı numara).',
  '    ► Örnek: "FIŞ NO. 45 ... TOPLAM ... Z SAYAÇ 896" → belgeNo = "896" (45 DEĞİL).',
  '    ► Bazen "Z NO" / "Z SAYAÇ" en altta tek başına yazar — orayı bul.',
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
  '  ✗ "Stopaj" / "Gelir Vergisi Kesintisi" — ayrı vergi',
  '    (KDV Tevkifatı farklıdır — bölüm 5c\'ye bak, NET KDV hesapla)',
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
  'ÖRNEK — Z raporu (YAZAR KASA FİŞİ) — BU PATTERN ZORUNLU:',
  '  Z raporunda KDV oranları ŞU FORMATTA görünür (sıra önemli, her biri AYRI satır):',
  '    TOPLAM %20    *285,00    ← matrah (%20 oranlı satışların toplamı)',
  '    TOPKDV %20     *47,50    ← KDV (%20 oran için)',
  '    TOPLAM %10   *2.675,00   ← matrah (%10 oranlı satışların toplamı)',
  '    TOPKDV %10    *243,19    ← KDV (%10 oran için)',
  '    TOPLAM       *2.960,00   ← genel matrah (tüm oranlar)',
  '    TOPKDV         *290,69   ← GENEL KDV TOPLAMI (breakdown toplamına eşit olmalı)',
  '  ➜ kdvBreakdown=[{"oran":20,"tutar":"47,50","matrah":"285,00"},{"oran":10,"tutar":"243,19","matrah":"2675,00"}]',
  '  ➜ kdvTutari="290,69"',
  '  ⚠ Z raporunda "TOPKDV %NN" her satırı AYRI bir breakdown elemanıdır.',
  '  ⚠ "KUM TOPKDV" / "KUM TOPLAM" kümülatif — asla alma, sadece "TOPKDV" satırlarını al.',
  '  ⚠ Yazıcı baskısı silik olabilir — "*" ile ayrılmış sayı daima sağdaki değerdir.',
  '',
  'ÖRNEK — TÜRK TELEKOM / TURKCELL / VODAFONE faturası — DİKKAT:',
  '  Telekom faturalarında "KDV" ile "ÖİV" yan yana görünür ve KARIŞTIRILMASI KOLAY:',
  '    Matrah          304,18    ← BU MATRAH (KDV DEĞİL)',
  '    KDV (%20)        60,84    ← BU KDV (%20 oranlı)',
  '    ÖİV (%10)        30,42    ← BU ÖİV, KDV DEĞİL',
  '    Genel Toplam    395,44',
  '  ➜ kdvTutari="60,84"  (SADECE "KDV (%NN)" etiketli satır)',
  '  ➜ kdvBreakdown=[{"oran":20,"tutar":"60,84","matrah":"304,18"}]',
  '  ⚠ "304,18" MATRAH\'tır (KDV\'nin hesaplandığı tutar), KDV DEĞİL.',
  '  ⚠ Matrah genelde KDV\'den 5x daha büyüktür (20% oranında). Büyük sayıya "KDV" deme.',
  '  ⚠ KDV satırı her zaman "KDV" veya "Katma Değer" etiketi taşır — etiket yoksa KDV değildir.',
  '',
  'TEK ORAN ÖZEL KURALI — "kalem satırlarındaki KDV" alt toplam sayılmaz:',
  '  Normal e-Fatura/e-Arşiv tablosunda her kalem için ayrı KDV sütunu görünür (ör. 250,20 + 400,00).',
  '  Bu kalem satırlarındaki KDV\'ler AYRI breakdown DEĞİL — hepsi aynı oran (%20) için toplamdır.',
  '  Fatura altındaki "Hesaplanan KDV (%20): 650,20" satırını tek kaynak olarak al.',
  '  ➜ kdvTutari="650,20"',
  '  ➜ kdvBreakdown=[{"oran":20,"tutar":"650,20","matrah":"3251,00"}]',
  '  ⚠ SAKIN kalem satırlarını ayrı oran olarak sayma — hepsi %20 ise TEK BREAKDOWN elemanı.',
  '',
  'Matrah belirgin değilse null bırak. KDV tutarını ASLA matrah/toplam farkı veya oran hesabıyla üretme; sadece belgede yazan KDV satırını oku.',
  '',
  '╔══ 5c) KDV TEVKİFATLI FATURA — İKİ SAYIYI AYRI OKU ══╗',
  'TEVKİFATLI faturalarda SAKIN matematik yapma — görseldeki iki sayıyı AYRI AYRI kopyala:',
  '  1. kdvTutari = faturada yazan "Hesaplanan KDV" / "KDV Tutarı" / "KDV(%N)" TAM TUTARI',
  '  2. kdvTevkifat = faturada yazan "Hesaplanan KDV Tevkifat(%XX)" / "KDV Tevkifatı" TUTARI',
  'Kodun kendisi net KDV = tam − tevkifat hesaplayacak. Sen sadece iki rakamı OKU.',
  '',
  'TEVKİFAT TESPİTİ — şu markerlar varsa fatura tevkifatlıdır:',
  '  • "Fatura Tipi: TEVKİFAT" / "Senaryo: TEVKİFAT" / "TEVKİFATLI" etiketi',
  '  • "Hesaplanan KDV Tevkifat(%XX)" / "KDV Tevkifatı" satırı + tutar',
  '  • "Tevkifata Tabi İşlem Tutarı" satırı',
  '  • "Tevkifat Sebebi" / "Tevkifat Oranı" alanı',
  '',
  'ÖRNEK 1 — Tevkifatlı fatura (tek oran):',
  '  Hesaplanan KDV(%20)           3.788,00   ← kdvTutari için bu',
  '  Hesaplanan KDV Tevkifat(%50)  1.894,00   ← kdvTevkifat için bu',
  '  Vergiler Dahil Toplam          22.728,00',
  '  Ödenecek Tutar                 20.834,00',
  '  → kdvTutari = "3788,00"     (görselde yazan tam KDV)',
  '  → kdvTevkifat = "1894,00"   (görselde yazan tevkifat tutarı)',
  '  → toplam = "22728,00"        (Vergiler Dahil Toplam)',
  '  → kdvBreakdown = [{"oran":20,"tutar":"3788,00","matrah":"18940,00"}]  (tam, net DEĞİL)',
  '',
  'ÖRNEK 2 — Tevkifatlı fatura (farklı tutarlar):',
  '  Hesaplanan KDV(%20)           10.560,00',
  '  Hesaplanan KDV Tevkifat(%50)   5.280,00',
  '  → kdvTutari = "10560,00"',
  '  → kdvTevkifat = "5280,00"',
  '',
  'TEVKİFATSIZ FATURA:',
  '  → kdvTevkifat = "0,00" (veya null)',
  '  → kdvTutari = olağan tam KDV',
  '',
  '⚠ KRİTİK: Tevkifatlı faturada kdvTevkifat alanını BOŞ BIRAKMA. Tutarı oku.',
  '⚠ KRİTİK: kdvTutari = TAM KDV (kendin çıkarma işlemi yapma, kod halleder).',
  '⚠ "Tevkifat" kelimesi faturada GEÇİYORSA ve tutar varsa: kdvTevkifat\'ı MUTLAKA doldur.',
  '',
  '⛔ ÇOK ÖNEMLİ — MAL HİZMET TOPLAM ≠ VERGİLER DAHİL TOPLAM:',
  'Tevkifatlı faturada şu alanları KESİNLİKLE KARIŞTIRMA:',
  '  • "Mal Hizmet Toplam Tutarı" = MATRAH (KDV hariç). Bunu /11 ile bölme!',
  '  • "Vergiler Dahil Toplam Tutar" = MATRAH + KDV (KDV dahil). Bu da kdvTutari değil.',
  '  • "Ödenecek Tutar" = MATRAH + (KDV − Tevkifat). Bu da kdvTutari değil.',
  '',
  'KDV TUTARI sadece şu satırlardan biridir:',
  '  ✓ "Hesaplanan KDV(%X)" satırının yanındaki tutar — TAM KDV',
  '  ✓ Tevkifat bölümünde "Hesaplanan KDV Tevkifat(%XX)" — TEVKİFAT',
  '  ✗ "Mal Hizmet Toplam" — bu MATRAH, KDV DEĞİL',
  '  ✗ "Vergiler Dahil Toplam" — bu MATRAH+KDV, KDV DEĞİL',
  '  ✗ "Ödenecek KDV" — bu NET KDV (kod hesaplayacak), KDV ALANI DEĞİL',
  '',
  'YAPILACAK MATEMATİK YOK — faturadaki YAZILI sayıları KOPYALA. SAKIN /11 veya /1.20 işlemi yapma.',
  '',
  'ÖRNEK — TEVKİFATLI ALIŞ FATURASI (HİZMET):',
  '  Mal Hizmet Toplam Tutarı            13.300,00 TL  ← MATRAH (KDV DEĞİL!)',
  '  Hesaplanan KDV(%10)                  1.330,00 TL  ← TAM KDV (kdvTutari için bu)',
  '  Hesaplanan KDV Tevkifat(%50)           665,00 TL  ← TEVKİFAT (kdvTevkifat için bu)',
  '  Tevkifata Tabi İşlem Üzerinden Hes.   1.330,00 TL  ← Aynı KDV (alternatif gösterim)',
  '  Ödenecek KDV                           665,00 TL  ← NET (kod hesaplar)',
  '  Vergiler Dahil Toplam               14.630,00 TL',
  '  Ödenecek Tutar                      13.965,00 TL',
  '  → kdvTutari = "1330,00"          (TAM KDV — Hesaplanan KDV satırı)',
  '  → kdvTevkifat = "665,00"          (Tevkifat tutarı)',
  '  → kdvBreakdown = [{"oran":10,"tutar":"1330,00","matrah":"13300,00"}]',
  '  ⚠ 13.300 / 11 = 1.209 SAKIN BUNU YAZMA — bu yanlış matematik! Faturadaki "1.330,00" sayısını OKU.',
  '',
  'ALGILAMA: Tevkifatlı fatura = "Hesaplanan KDV Tevkifat" satırı VAR demektir.',
  'Bu satırı görür görmez:',
  '  1. ÜSTTEKİ "Hesaplanan KDV(%X)" satırının tutarını → kdvTutari (TAM)',
  '  2. ALTTAKİ "Hesaplanan KDV Tevkifat(%XX)" satırının tutarını → kdvTevkifat',
  '  3. Hiç hesap yapma. İki sayıyı oku, kod halleder.',
  '',
  '╔══ 6) TUTAR FORMATI ══╗',
  'Türkiye: nokta binlik ayraç, virgül ondalık. "1.234,56" → output "1234,56" (noktasız, virgüllü).',
  '"KDV" etiketi (kabul): "KDV", "K.D.V.", "Katma Değer Vergisi", "Hesaplanan KDV", "KDV Tutarı", "TOPKDV", "KUM TOPKDV".',
  '"KDV" DEĞİL (reddet): "Özel İletişim Vergisi", "ÖİV", "Telsiz Kullanım", "ÖTV", "Damga", "BSMV", "KKDF", "Konaklama Vergisi", "Çevre Vergisi", "Stopaj".',
  'KDV Tevkifatı özeldir — bölüm 5c\'ye göre NET KDV döndür.',
  '"Toplam" etiketi: "Genel Toplam", "Ödenecek", "Fatura Toplamı", "Vergiler Dahil Toplam".',
  'Eğer tutar "₺" ya da "TL" / "TRY" içeriyorsa o işareti KALDIR, sadece sayı kal.',
  '',
  '╔══ 6b) KATEGORİ — GİDER SINIFLANDIRMASI ══╗',
  'Satıcı unvanı + ürün/hizmet açıklamasından gider kategorisi belirle:',
  '  • "yakit"        → akaryakıt, benzin, motorin, LPG, OPET, Shell, BP, Petrol Ofisi, TP, KadooilGaz',
  '  • "yemek"        → restoran, lokanta, kafe, market gıda, yemek kartı, Sodexo, Multinet, Setcard',
  '  • "kirtasiye"    → ofis malzemesi, kalem, defter, toner, kağıt, Office Depot',
  '  • "telekom"      → Turkcell, Vodafone, Türk Telekom, internet, GSM, telefon',
  '  • "kira"         → işyeri kirası, depo kirası (genelde stopaj 360 hesabı içerir)',
  '  • "elektrik"     → CK Enerji, Aydem, Boğaziçi Elektrik, ENERJİSA, Trakya Elektrik',
  '  • "su"           → İSKİ, ASKİ, BUSKİ, ESKİ — su faturası',
  '  • "dogalgaz"     → İGDAŞ, BAŞKENTGAZ, AGDAŞ, doğalgaz',
  '  • "tamir"        → bakım, onarım, tamirhane, oto servis, otomobil bakımı',
  '  • "sigorta"      → kasko, trafik sigortası, dask, hayat sigortası, Allianz, Anadolu Sigorta',
  '  • "danismanlik"  → SMMM, avukat, mali müşavir, mühendislik, danışmanlık (genelde tevkifatlı)',
  '  • "nakliye"      → kargo, taşımacılık, ARAS, MNG, Yurtiçi, Sürat, UPS, fedex',
  '  • "reklam"       → Google Ads, Facebook, ilan, reklam, dijital pazarlama',
  '  • "temizlik"     → temizlik malzemesi, temizlik hizmeti (tevkifatlı olabilir)',
  '  • "saglik"       → eczane, hastane, doktor, ilaç, tıbbi malzeme',
  '  • "diger"        → yukarıdakilerin hiçbirine girmiyor',
  'Tek kategori ver. Şüphelide "diger" tercih et — yanlış sınıflandırma yapma.',
  '',
  '╔══ 6c) SATICI VKN ══╗',
  'Eğer satıcının VKN/TCKN\'si belgede görünüyorsa "saticiVkn" alanına yaz.',
  'VKN: 10 hane, TCKN: 11 hane. Sadece rakam, başında 0 olabilir. Görünmüyorsa null.',
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

const USER_TEXT = [
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
