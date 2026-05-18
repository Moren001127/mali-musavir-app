/**
 * Azure OCR - Tevkifatli Fatura pipeline.
 *
 * Tevkifatli faturalardan KDV uc-luyu cikarir:
 *   - tamKdv   : "Hesaplanan KDV" (tam tutar)
 *   - tevkifat : alici stopaji
 *   - netKdv   : tamKdv - tevkifat (Luca defteri kebir alanindaki deger)
 *
 * Public API (Faz 2B):
 *   parseTevkifatRate(text, foldFn)        - "(50/100)" / "(%50)" tevkifat oranini doner
 *   extractTevkifatliFatura(text, deps)    - tam pipeline
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir. `parseTevkifatRate`
 * hem modul ici (extractTevkifatliFatura'dan) hem disardan (inferTevkifatFromAzureAmounts
 * vb.) cagirilabilir.
 */

type FoldFn = (s: string) => string;

export interface TevkifatliFaturaDeps {
  parseAmount: (s: string) => number;
  foldTurkishAscii: FoldFn;
  stripMatrahFragments: (text: string) => string;
  inferTevkifatFromAzureAmounts: (
    text: string,
    tamKdv: number,
  ) => { tamKdv: number; tevkifat: number; netKdv: number } | null;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Tevkifat oranini metinden cikarir.
 * Destekli formatlar:
 *   "(5/10)" -> 50      [(numerator/denominator) * 100]
 *   "(%50)"  -> 50      [direct percent]
 *   "(50)"   -> 50      [implicit percent]
 *
 * Sadece "TEVKIFAT" veya "KDV TEVK..." labelinin 80 char yakininda arar.
 * Gecersizse 0 doner.
 */
export function parseTevkifatRate(text: string, foldFn: FoldFn): number {
  if (!text) return 0;
  const folded = foldFn(text);
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

/**
 * Tevkifatli fatura OCR metninden tamKdv + tevkifat + netKdv cikarir.
 *
 * Akis:
 *   1) "HESAPLANAN KDV(%X) TUTAR" label'ini bul (TEVKIFAT varsa tevkifat, yoksa tamKdv)
 *   2) "ODENECEK KDV" doğrudan net'i verir (Luca ile eslesen)
 *   3) Alternatif tam KDV: "Tevkifata Tabi Islem Uzerinden Hes. KDV ..."
 *   4) tevkifat=0 ve tamKdv>0 ise inferTevkifatFromAzureAmounts callback'i ile cikar
 *   5) Alternatif tevkifat formatlari: "KDV Tevkifati (%50) = 665,00 TL"
 *   6) Mantik kontrol: tamKdv >= tevkifat olmali, ikisi de >0 olmali
 *
 * Tevkifat bulunamazsa veya geçersiz ise null.
 */
export function extractTevkifatliFatura(
  text: string,
  deps: TevkifatliFaturaDeps,
): { tamKdv: number; tevkifat: number; netKdv: number } | null {
  const { parseAmount, foldTurkishAscii, stripMatrahFragments, inferTevkifatFromAzureAmounts, logger } = deps;

  if (!text) return null;
  const normalized = foldTurkishAscii(text);
  // SATIR-BAGIMSIZ pattern match — Azure bazen tum faturayi tek satirda
  // veriyor (PDF render farki). Whitespace'i tek bosluga indirip pattern'i
  // dogrudan etiket+tutar sirasinda arariz.
  const flat = normalized.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  const folded = flat
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/İ/g, 'I')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');

  let tamKdv = 0;
  let tevkifat = 0;
  let odenecekKdv = 0;

  // Turk tutar formati: "1.330,00" / "665,00" / "28.400,00" / "1.234,56"
  const amountPattern = '[-−]?\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{1,2}|\\d+,\\d{1,2}|\\d{1,3}(?:\\.\\d{3})+(?!\\d))';

  // ─── 1) "HESAPLANAN KDV(%X) TUTAR" — TAM KDV ya da TEVKİFAT
  //   Tek regex iki durumu ayirir: "TEVKIFAT" kelimesi varsa tevkifat,
  //   yoksa tam KDV.
  // ───
  const labelRegex = new RegExp(
    'HESAPLANAN\\s+KDV(\\s+TEVK[^\\s(]*)?\\s*\\(\\s*[%/]?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
    'gi',
  );
  const amountAfterLabelRe = new RegExp(amountPattern, 'i');
  let m: RegExpExecArray | null;
  while ((m = labelRegex.exec(flat)) !== null) {
    const isTevkifat = /TEVK/i.test(m[0]);
    const lookahead = stripMatrahFragments(
      flat.slice(labelRegex.lastIndex, labelRegex.lastIndex + 120),
    );
    const tutarMatch = lookahead.match(amountAfterLabelRe);
    if (!tutarMatch) continue;
    const tutar = Math.abs(parseAmount(tutarMatch[1]));
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
    const window = stripMatrahFragments(source.slice(start, start + maxGap + 120));
    const re = new RegExp(`[^0-9]{0,${maxGap}}` + amountPattern, 'i');
    const found = window.match(re);
    if (!found) return 0;
    const value = Math.abs(parseAmount(found[1]));
    return value > 0 && value < 100_000_000 ? value : 0;
  };

  // "Odenecek KDV" net KDV'dir (Luca ile eslesen).
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

  // ─── 2) Alternatif tam KDV gosterimi (sadece tamKdv bulunmadiysa) ───
  if (tamKdv === 0) {
    const altRe = new RegExp(
      'TEVK[İI]FATA\\s+TAB[İI][^\\d]{0,80}ÜZER[İI]NDEN[^\\d]{0,40}KDV[^\\d]{0,20}' +
        amountPattern,
      'i',
    );
    const am = flat.match(altRe);
    if (am) {
      const v = parseAmount(am[1]);
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
    const oran = parseTevkifatRate(folded, foldTurkishAscii) || parseTevkifatRate(flat, foldTurkishAscii);
    if (oran > 0 && oran <= 100) {
      void oran;
      logger.log(
        `Tevkifat extract: tevkifat tutarı belgede açık okunamadı; oranla hesaplama yapılmadı (tamKdv=${tamKdv}, oran=%${oran})`,
      );
    }
  }

  if (tevkifat <= 0 && tamKdv > 0) {
    const inferred = inferTevkifatFromAzureAmounts(text, tamKdv);
    if (inferred) return inferred;
  }

  // ─── 3) Alternatif tevkifat gosterimi ───
  if (tevkifat === 0) {
    const altTevkifatPatterns = [
      new RegExp(
        'KDV\\s+TEVK[^\\s(]*\\s*\\(\\s*[%/]?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)\\s*[-=:\\s]*' + amountPattern,
        'i',
      ),
      new RegExp('TEVK[İI]FAT\\s+TUTAR[İI]?\\s*[-−=:\\s]*' + amountPattern, 'i'),
    ];
    for (const re of altTevkifatPatterns) {
      const am = flat.match(re);
      if (am) {
        const v = Math.abs(parseAmount(am[1]));
        if (v > tevkifat) tevkifat = v;
      }
    }
  }

  // Tevkifat yoksa tevkifatli degildir — null don
  if (tevkifat <= 0) {
    if (/TEVK[İI]FAT/i.test(flat)) {
      logger.warn(
        `Tevkifat extract: TEVKIFAT kelimesi var ama tutar bulunamadı. Flat metin (ilk 500 char): "${flat.slice(0, 500)}"`,
      );
    }
    return null;
  }

  // Tam KDV bulunamadiysa tevkifat oranindan geri hesapla
  if (tamKdv === 0) {
    const oran = parseTevkifatRate(flat, foldTurkishAscii) || parseTevkifatRate(folded, foldTurkishAscii);
    if (oran > 0 && oran <= 100) {
      void oran;
      logger.log(
        `Tevkifat extract: tamKdv belgede açık okunamadı; tevkifat oranından geri hesaplama yapılmadı (tevkifat=${tevkifat}, oran=%${oran})`,
      );
    }
  }

  if (tamKdv <= 0 || tamKdv < tevkifat || Math.abs(tamKdv - tevkifat) <= 0.05) {
    logger.warn(
      `Tevkifat extract: tamKdv=${tamKdv} tevkifat=${tevkifat} — mantıksız, null döndürüyorum. Flat (ilk 400 char): "${flat.slice(0, 400)}"`,
    );
    return null;
  }

  const netKdv = odenecekKdv > 0 ? odenecekKdv : Math.max(0, tamKdv - tevkifat);
  logger.log(
    `Tevkifat extract OK: tamKdv=${tamKdv} tevkifat=${tevkifat} netKdv=${netKdv}`,
  );
  return { tamKdv, tevkifat, netKdv };
}
