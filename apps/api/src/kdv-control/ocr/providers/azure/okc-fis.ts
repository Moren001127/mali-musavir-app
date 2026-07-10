/**
 * Azure OCR - OKC Fis pipeline.
 *
 * OKC (Odeme Kaydedici Cihaz) fislerinden KDV breakdown cikarir:
 *   - Once "KDV / TOPKDV" satirlarini summary olarak topla
 *   - Eger summary 2+ farkli oran iceriyorsa onu kullan
 *   - Aksi takdirde urun satirlarindaki %01/%10/%20 bruta gore turet
 *
 * Public API (Faz 2B):
 *   extractOkcFisKdv(text, deps)                      - hem summary hem item-rate breakdown
 *   extractOkcFisItemRateBreakdown(text, expectedTotal, deps) - sadece urun satirlarindan oran kirilimi
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { KdvBreakdownItem } from '../../types';

export interface OkcFisDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  normalizeAzureText: (text: string) => string;
  stripMatrahFragments: (text: string) => string;
  isMatrahOrRateLine: (value: string) => boolean;
  logger: { warn: (m: string) => void };
}

/**
 * OKC fis OCR metninden KDV tutari + breakdown cikarir.
 *
 * Akis:
 *   1) "KDV / TOPKDV" geceн her satir summary'e eklenir (matrah/oran satirlari haric)
 *   2) Ayni satirda tutar yoksa sonraki 2 satira bakar
 *   3) Sonra extractOkcFisItemRateBreakdown ile urun satirlarindan kirilim dener
 *   4) Eger item-rate >=2 oran verirse onu doner; aksi takdirde summary'yi doner
 *
 * Hicbir KDV yakalanamazsa null.
 */
export function extractOkcFisKdv(
  text: string,
  deps: OkcFisDeps,
): { kdvTutari: string | null; breakdown: KdvBreakdownItem[] } | null {
  const { parseAmount, formatAmount, normalizeAzureText, stripMatrahFragments, isMatrahOrRateLine } = deps;

  if (!text) return null;
  const lines = normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const breakdown: KdvBreakdownItem[] = [];
  // Dört format: "TOPKDV", "KDV TUTARI/TOPLAM", "KDV" tek başına satır, "PKDV" (Azure OCR "TOPKDV" hatası)
  // "TOPKDV" OCR varyantlarına toleranslı: ilk harf T↔1↔I↔7, D↔O↔0, V↔U↔Y
  // (gerçek örnekler: "TOPKOV" D→O, "1OPKDV" T→1). "TOPLAM" eşleşmez (K yok).
  // Son kalip: "KDV %20" ile baslayan TEK ORANLI KDV satiri. Bazi yazarkasalar
  // (ör. FATIH HOME, OTO ILKER) toplam KDV'yi "KDV %ORAN" biciminde yaziyor
  // (TOPKDV / KDV TUTARI yok); tutar AYNI satirda ("KDV %20 *1.276,50") VEYA
  // ALT satirda ("KDV %20\n*1.276,50") olabilir — alttakini asagidaki 4-satir
  // lookahead yakalar. Satir BASINDA "KDV" + sadece bosluk + "%NN" sarti var:
  // urun satiri "YEDEK PARCA %20 ..." KDV ile baslamaz, "KDV ORANI %20" ise araya
  // "ORANI" girdigi icin eslesmez (yanlis pozitif yok).
  const kdvLineRe = /\b[T1I7][O0]\s*P\s*K\s*[D0O]\s*[VUY]\b|\bK\.?\s*D\.?\s*V\.?\s*(?:TUTARI|TOPLAM)\b|^K\.?\s*D\.?\s*V\.?$|\bPK[D0O][VUY]\b|^K\.?\s*D\.?\s*V\.?\s*[%/]\s*\d{1,2}\b/i;
  // "TOPKDV" (açık genel toplam KDV) tespiti — varsa yetkili toplamdır.
  const topKdvRe = /\b[T1I7][O0]\s*P\s*K\s*[D0O]\s*[VUY]\b|\bPK[D0O][VUY]\b/i;
  let topKdvAmount = 0;
  const summaryLookaheadLabelRe = /^(?:TOPLAM|GENEL\s*TOPLAM|KDV\s*ORANI|KDV\s*DAHIL\s*TUTAR|KDV\s*DAH[Iİ]L\s*TUTAR)$/i;
  const summaryHardStopRe = /NAK[Iİ]T|KRED[Iİ]|KART|PARA\s*[UÜ]ST[UÜ]|KAS[Iİ]YER|M[UÜ][SŞ]TER[Iİ]/i;
  // Yalın "KDV" satırı (sadece "KDV"); çoğu zaman "KDV Oranı | KDV Dahil Tutar | KDV"
  // kırılım tablosunun sütun başlığıdır — grand-total değil.
  const bareKdvRe = /^K\.?\s*D\.?\s*V\.?$/i;
  // Sadece oran taşıyan satır (%10, %01, /20, 20% …). Yalın "KDV" başlığından sonra
  // böyle bir satır gelirse bu bir KDV-kırılım tablosudur, "KDV: tutar" çifti değil.
  const rateOnlyRe = /^\s*(?:[%/]\s*0?\d{1,2}|0?\d{1,2}\s*[%/])\s*$/;
  const otherTaxRe = /ÖZEL\s*İLETİŞİM|ÖİV|OIV|TELSİZ|TELSIZ|ÖTV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|ÇEVRE|STOPAJ/i;
  // OCR sometimes inserts spaces inside amounts: "* 1. 000, 00".
  // Keep the capture broad enough for that form, then let parseAmount remove spaces.
  const amountRe = /([+-])?\s*[\*₺¥]?\s*([+-])?\s*(\d{1,3}(?:\s*[.,]\s*\d{3})*\s*[.,]\s*\d{2}|\d+\s*[.,]\s*\d{2})\s*(?:TL|TRY|₺)?/g;

  const parseLastAmount = (raw: string): number => {
    const clean = stripMatrahFragments(raw);
    const values = [...clean.matchAll(amountRe)]
      .map((m) => {
        const sign = m[1] === '-' || m[2] === '-' ? -1 : 1;
        return sign * parseAmount(m[3]);
      })
      .filter((value) => Math.abs(value) > 0 && Math.abs(value) < 100_000_000);
    return values.length > 0 ? values[values.length - 1] : 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!kdvLineRe.test(line)) continue;
    if (otherTaxRe.test(line) || isMatrahOrRateLine(line)) continue;
    const rateMatch = line.match(/(?:K\.?\s*D\.?\s*V\.?\s*)?[%/]\s*(\d{1,2})(?:[.,]\d+)?/i);
    const oran = rateMatch ? Number(rateMatch[1]) : null;
    const isBareKdv = bareKdvRe.test(line);
    let tutar = parseLastAmount(line);
    if (tutar <= 0) {
      for (let j = 1; j <= 4 && i + j < lines.length; j++) {
        const next = lines[i + j];
        // Yalın "KDV" başlığı + hemen ardından oran satırı = kırılım tablosu başlığı.
        // Tutar (brüt/KDV-dahil) çekme; yoksa %10'un brütünü (ör. 70,00) KDV sanırız.
        if (isBareKdv && rateOnlyRe.test(next)) break;
        tutar = parseLastAmount(next);
        if (tutar > 0) break;
        if (summaryLookaheadLabelRe.test(next)) continue;
        if (otherTaxRe.test(next) || summaryHardStopRe.test(next)) break;
      }
    }
    if (tutar > 0) {
      breakdown.push({
        oran: oran && [1, 10, 20].includes(oran) ? oran : 0,
        tutar,
        matrah: null,
      });
      // "TOPKDV" AÇIK GENEL TOPLAM KDV'dir — varsa yetkili. Bazı fişlerde (ör. HAKMAR
      // çok-oranlı) hem "TOPKDV *23,89" hem ayrı "KDV TUTARI" sütun başlığı + oran-bazlı
      // tutarlar bulunur; hepsi toplanınca KDV şişiyordu (23,89 + 6,48 = 30,37). TOPKDV
      // bulunduğunda toplam = TOPKDV (diğer KDV-satırı captures eklenmez).
      if (topKdvRe.test(line)) topKdvAmount = Math.max(topKdvAmount, tutar);
    }
  }

  const summarySum = topKdvAmount > 0 ? topKdvAmount : breakdown.reduce((total, item) => total + item.tutar, 0);
  const itemRateBreakdown = extractOkcFisItemRateBreakdown(text, summarySum, deps);
  if (itemRateBreakdown.length >= 1) {
    const itemSum = itemRateBreakdown.reduce((total, item) => total + item.tutar, 0);
    const tolerance = Math.max(0.08, summarySum * 0.03);
    const summaryMatchesItem = summarySum > 0 && Math.abs(itemSum - summarySum) <= tolerance;
    return {
      kdvTutari: formatAmount(summaryMatchesItem ? summarySum : itemSum),
      breakdown: itemRateBreakdown,
    };
  }

  if (breakdown.length === 0) return null;
  // TOPKDV yetkiliyse breakdown'u tek genel-toplam satırına indir (stray "KDV TUTARI"
  // başlık captures'ı toplama girmesin). Aksi halde mevcut breakdown korunur.
  return {
    kdvTutari: formatAmount(summarySum),
    breakdown: topKdvAmount > 0 ? [{ oran: 0, tutar: topKdvAmount, matrah: null }] : breakdown,
  };
}

/**
 * OKC fisinden KDV-DAHIL genel toplami cikarir.
 *
 * Yazarkasa fislerinde tutar cogunlukla "*" onekiyle basilir ve "TOPLAM"
 * etiketi ile tutar AYNI satirda VEYA bir ALT satirda olabilir:
 *   "TOPLAM *6.922,80"        → ayni satir
 *   "TOPLAM" + "\n*6.922,80"  → alt satir (Azure Read sutunlari ayirir)
 * Generic extractToplam deseni "*" onekini yakalayamadigi icin OKC fislerinde
 * toplam BOS kaliyordu; matrah da (toplam − KDV) turetildiginden bos kaliyordu
 * (gercek vaka: ARS OTOMOBIL 2026-05, YORGUN NAKLIYAT).
 *
 * Guvenlik: "ARA TOPLAM" / "KUM TOPLAM" (kumulatif) / KDV gecen satirlar
 * alinmaz; alt-satir aramasi NAKIT/KREDI gibi odeme satirina carpinca durur.
 * "GENEL TOPLAM" varsa yetkilidir; yoksa SON "TOPLAM" satiri kullanilir.
 * `kdvNum` verilirse toplam <= KDV olan yakalama reddedilir (yanlis okuma).
 */
export function extractOkcFisToplam(
  text: string,
  deps: OkcFisDeps,
  kdvNum?: number | null,
): string | null {
  const { parseAmount, formatAmount, normalizeAzureText } = deps;
  if (!text) return null;
  const lines = normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const toplamLabelRe = /^(?:GENEL\s*)?T[O0]PLAM\b/i;
  const badLabelRe = /ARA\s*T[O0]PLAM|\bKUM\b|K\.?\s*D\.?\s*V|T[O0]PKDV|MATRAH/i;
  const hardStopRe = /NAK[Iİ]T|KRED[Iİ]|KART|PARA\s*[UÜ]ST[UÜ]|KAS[Iİ]YER|M[UÜ][SŞ]TER[Iİ]|EK[UÜ]\s*NO|Z\s*NO|F[Iİ][SŞ]\s*NO/i;
  const amountRe = /[\*₺¥]?\s*(\d{1,3}(?:\s*[.,]\s*\d{3})*\s*[.,]\s*\d{2}|\d+\s*[.,]\s*\d{2})\s*(?:TL|TRY|₺)?/g;
  const lastAmount = (raw: string): number => {
    const values = [...raw.matchAll(amountRe)]
      .map((m) => parseAmount(m[1]))
      .filter((v) => v > 0 && v < 100_000_000);
    return values.length ? values[values.length - 1] : 0;
  };
  let found = 0;
  let foundGenel = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!toplamLabelRe.test(line) || badLabelRe.test(line)) continue;
    const isGenel = /GENEL/i.test(line);
    // KDV verildiyse gecerli toplam KDV'nin en az ~5 katidir: en yuksek oran %20'de
    // bile toplam = matrah + KDV = KDV*6 (dusuk oranlarda daha da buyuk). KDV'ye yakin
    // "TOPLAM" degerleri POS ara-slibi / kalem satiri / sutun-kaymasidir → ele.
    // (KOÇYİĞİTER 9417: gercek TOPLAM 8.450,77 ama POS slibinde sahte "TOPLAM 1.604,95";
    //  eskiden "son TOPLAM kazanir" ile yanlisi aliniyordu → matrah 196,49 saçmaligi.)
    const acceptable = (v: number) =>
      v > 0 && (!kdvNum || kdvNum <= 0 ? true : v >= kdvNum * 5);
    let tutar = lastAmount(line);
    if (!acceptable(tutar)) {
      tutar = 0;
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const next = lines[i + j];
        if (hardStopRe.test(next) || badLabelRe.test(next)) break;
        const candidate = lastAmount(next);
        if (acceptable(candidate)) { tutar = candidate; break; }
      }
    }
    if (tutar <= 0) continue;
    if (isGenel) { found = tutar; foundGenel = true; }
    else if (!foundGenel) { found = tutar; }
  }
  return found > 0 ? formatAmount(found) : null;
}

/**
 * OKC fislerde bazen sadece TOPKDV toplam yazilir; oran bazli KDV ise urun
 * satirlarindaki %01/%10/%20 brut tutarlardan turetilmelidir.
 *
 * Her urun satirindaki son tutari "brut" kabul eder, oran ile KDV'yi
 * tutar = gross * oran / (100 + oran) formulu ile hesaplar.
 *
 * En az 2 farkli oran yakalanmadiysa veya beklenen toplamla uyumsuzsa
 * (tolerans: max(0.08, expectedTotal * 0.03)) bos array doner.
 */
export function extractOkcFisItemRateBreakdown(
  text: string,
  expectedTotal: number | null | undefined,
  deps: OkcFisDeps,
): KdvBreakdownItem[] {
  const { parseAmount, formatAmount, normalizeAzureText, logger } = deps;

  if (!text) return [];
  const lines = normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const grossByRate = new Map<number, number>();
  let pendingRate: number | null = null;
  let afterToplam = false; // TOPLAM görüldükten sonra KDV özet tablosu gelir — ürün satırı sayma
  const rateRe = /(?:%|\/)\s*0?(1|8|10|18|20)(?:[,.]00)?\b/i;
  // OCR sometimes inserts spaces inside amounts: "* 1. 000, 00".
  // Keep the capture broad enough for that form, then let parseAmount remove spaces.
  const amountRe = /([+-])?\s*[*]?\s*([+-])?\s*(\d{1,3}(?:\s*[.,]\s*\d{3})*\s*[.,]\s*\d{2}|\d+\s*[.,]\s*\d{2})\s*(?:TL|TRY)?/g;
  const skipRe = /TOPKDV|TOPLAM|KDV\s*TUTARI|KDV\s*TOPLAM|KDV\s*ORAN|KDV\s*DAH[Iİ]L|KDV\s*DAHIL|^KDV$|^K\s*D\s*V\s*[%/]\s*\d|NAK[Iİ]T|KRED[Iİ]|KART|PARA\s*[UÜ]ST[UÜ]|KAS[Iİ]YER|MERS[Iİ]S|EKU|Z\s*NO|F[Iİ][SŞ]\s*NO|TAR[Iİ]H|SAAT|VERG[Iİ]|V\.?D\.?|T\.?C\.?|TE[SŞ]EKK[UÜ]R|M[UÜ][SŞ]TER[Iİ]/i;
  const quantityUnitLineRe = /\b\d+(?:[.,]\d+)?\s*(?:KG|GR|AD|ADET|LT|L)?\s*[x×]\s*\d+(?:[.,]\d+)?/i;

  const parseLastAmount = (raw: string): number => {
    const values = [...raw.matchAll(amountRe)]
      .map((m) => {
        const sign = m[1] === '-' || m[2] === '-' ? -1 : 1;
        return sign * parseAmount(m[3]);
      })
      .filter((value) => Math.abs(value) > 0 && Math.abs(value) < 100_000_000);
    return values.length > 0 ? values[values.length - 1] : 0;
  };

  const fold = (value: string) =>
    value
      .toLocaleUpperCase('tr-TR')
      .replace(/Ş/g, 'S').replace(/İ/g, 'I')
      .replace(/Ğ/g, 'G').replace(/Ç/g, 'C')
      .replace(/Ü/g, 'U').replace(/Ö/g, 'O');

  const detectRate = (line: string): { oran: number; index: number; length: number } | null => {
    const direct = line.match(rateRe);
    if (direct && direct.index != null) {
      return { oran: Number(direct[1]), index: direct.index, length: direct[0].length };
    }

    const compact = fold(line).replace(/[^A-Z0-9/$%]/g, '');
    if (/^(?:401|4O1|40I)$/.test(compact)) return { oran: 1, index: 0, length: line.length };
    if (/^(?:710|7IO|7I0)$/.test(compact)) return { oran: 10, index: 0, length: line.length };
    const loose = compact.match(/^[/$S%]0?(1|8|10|18|20)$/);
    if (loose) return { oran: Number(loose[1]), index: 0, length: line.length };

    return null;
  };

  for (const line of lines) {
    if (skipRe.test(line)) {
      if (/^TOPLAM$/i.test(line.trim())) afterToplam = true;
      pendingRate = null;
      continue;
    }
    if (afterToplam) continue;
    const detectedRate = detectRate(line);
    if (detectedRate) {
      const oran = detectedRate.oran;
      const afterRate = line.slice(detectedRate.index + detectedRate.length);
      const gross = quantityUnitLineRe.test(afterRate)
        ? 0
        : (parseLastAmount(afterRate) || (afterRate.trim() ? parseLastAmount(line) : 0));
      if (gross) {
        grossByRate.set(oran, (grossByRate.get(oran) || 0) + gross);
        pendingRate = null;
      } else {
        pendingRate = oran;
      }
      continue;
    }

    if (pendingRate) {
      if (quantityUnitLineRe.test(line)) {
        continue;
      }
      const gross = parseLastAmount(line);
      if (gross) {
        grossByRate.set(pendingRate, (grossByRate.get(pendingRate) || 0) + gross);
        pendingRate = null;
      }
    }
  }

  if (grossByRate.size < 1) return [];
  const breakdown = Array.from(grossByRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([oran, gross]) => ({
      oran,
      tutar: Math.round((gross * oran / (100 + oran)) * 100) / 100,
      matrah: null as number | null,
    }))
    .filter((item) => item.tutar > 0);

  if (breakdown.length < 1) return [];
  const sum = breakdown.reduce((total, item) => total + item.tutar, 0);
  const grossTotal = Array.from(grossByRate.values()).reduce((total, gross) => total + Math.max(gross, 0), 0);
  if (expectedTotal && expectedTotal > 0) {
    const tolerance = Math.max(0.08, expectedTotal * 0.03);
    const summarySuspicious =
      grossTotal > 0 &&
      expectedTotal / grossTotal > 0.35 &&
      sum / grossTotal > 0.005 &&
      sum / grossTotal < 0.30;
    if (Math.abs(sum - expectedTotal) > tolerance && !summarySuspicious) {
      logger.warn(
        `OKC item-rate breakdown toplamla uyumsuz: item=${formatAmount(sum)} topkdv=${formatAmount(expectedTotal)} - breakdown kullanilmadi`,
      );
      return [];
    }
    if (summarySuspicious && Math.abs(sum - expectedTotal) > tolerance) {
      logger.warn(
        `OKC TOPKDV supheli: topkdv=${formatAmount(expectedTotal)} gross=${formatAmount(grossTotal)} item=${formatAmount(sum)} - item breakdown kullanildi`,
      );
    }
  }
  return expectedTotal && expectedTotal > 0 ? breakdown : (breakdown.length >= 2 ? breakdown : []);
}
