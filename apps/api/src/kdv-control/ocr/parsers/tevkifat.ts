import { parseOcrAmount } from './amount';

export type TevkifatTotals = {
  tamKdv: number;
  tevkifat: number;
  netKdv: number;
};

const AMOUNT_PATTERN =
  '[-−]?\\s*(\\d{1,3}(?:\\.\\d{3})*[,.]\\d{1,2}|\\d{4,}[,.]\\d{1,2}|\\d+[,.]\\d{1,2}|\\d{1,3}(?:\\.\\d{3})+(?!\\d))';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function foldTurkishAscii(value: string): string {
  return String(value || '')
    .replace(/\u00A0|\u2007|\u202F/g, ' ')
    .replace(/\uFF05/g, '%')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Ä]/g, 'G')
    .replace(/[Ãœ]/g, 'U')
    .replace(/[Å]/g, 'S')
    .replace(/[Ä°I]/g, 'I')
    .replace(/[Ã–]/g, 'O')
    .replace(/[Ã‡]/g, 'C');
}

function collectAmountsAfter(source: string, labelPattern: string, maxGap = 120): number[] {
  const labelRe = new RegExp(labelPattern, 'gi');
  const amountRe = new RegExp(`[^0-9-âˆ’]{0,${maxGap}}${AMOUNT_PATTERN}`, 'i');
  const values: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = labelRe.exec(source)) !== null) {
    const window = source.slice(labelRe.lastIndex, labelRe.lastIndex + maxGap + 80);
    const amount = window.match(amountRe);
    if (!amount) continue;
    const parsed = Math.abs(parseOcrAmount(amount[1]));
    if (parsed > 0 && parsed < 100_000_000) values.push(round2(parsed));
  }

  return values;
}

function collectTevkifatLineAmounts(source: string, options: { totalsOnly?: boolean } = {}): number[] {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const amountAfterRateRe = new RegExp(
    `\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)?\\s*[-=:\\s]*${AMOUNT_PATTERN}`,
    'i',
  );
  const values: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTevkifatLine = /K\.?\s*D\.?\s*V\.?\s+TEVK|TEVKIFAT\s+TUTAR/.test(line);
    const isTotalLine = /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?.*TEVK|TEVKIFAT\s+TUTAR/.test(line);
    if (!isTevkifatLine && !isTotalLine) continue;
    if (options.totalsOnly && !isTotalLine) continue;
    if (!options.totalsOnly && isTotalLine) continue;

    const window = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
    const amount = window.match(amountAfterRateRe);
    if (!amount) continue;
    const parsed = Math.abs(parseOcrAmount(amount[1]));
    if (parsed > 0 && parsed < 100_000_000) values.push(round2(parsed));
  }

  return values;
}

function sum(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}

function max(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

export function extractTevkifatTotalsFromText(text: string): TevkifatTotals | null {
  if (!text) return null;
  const foldedText = foldTurkishAscii(text);
  const flat = foldedText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  if (!/TEVK/.test(flat)) return null;

  const tamKdvCandidates = [
    ...collectAmountsAfter(
      flat,
      'HESAPLANAN\\s+K\\.?\\s*D\\.?\\s*V\\.?(?!\\s+TEVK)\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)',
      80,
    ),
    ...collectAmountsAfter(
      flat,
      'TEVKIFATA\\s+TABI\\s+ISLEM\\s+UZERINDEN\\s+HES\\.?\\s*K\\.?\\s*D\\.?\\s*V\\.?',
      120,
    ),
  ];
  const tamKdv = round2(max(tamKdvCandidates));
  if (!(tamKdv > 0)) return null;

  const explicitTevkifatTotals = [
    ...collectAmountsAfter(
      flat,
      'HESAPLANAN\\s+K\\.?\\s*D\\.?\\s*V\\.?\\s+TEVK[^\\s(]*\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)?',
      80,
    ),
    ...collectAmountsAfter(flat, 'TEVKIFAT\\s+TUTAR[II]?', 80),
    ...collectTevkifatLineAmounts(foldedText, { totalsOnly: true }),
  ];

  let lineTevkifatAmounts = collectAmountsAfter(
    flat,
    'K\\.?\\s*D\\.?\\s*V\\.?\\s+TEVK[^\\s(]*\\s*\\(\\s*%?\\s*\\d{1,2}(?:[.,]\\d+)?\\s*\\)?',
    80,
  );
  const interleavedLineAmounts = collectTevkifatLineAmounts(foldedText);
  if (interleavedLineAmounts.length > lineTevkifatAmounts.length) {
    lineTevkifatAmounts = interleavedLineAmounts;
  }

  const explicitTotal = max(explicitTevkifatTotals);
  const filteredLineAmounts = lineTevkifatAmounts.filter((value) => value < tamKdv - 0.05);
  const lineSum = sum(filteredLineAmounts);
  // Aynı tevkifat tutarı belgenin iki bölümünde (KDV kırılım tablosu + özet) tekrar
  // edebilir; bunlar AYNI tevkifattır, ayrı oran değil. Farklı değerler = gerçek
  // çok-satırlı tevkifat (ör. Zeyrek 158+251,20).
  const distinctLineAmounts = [...new Set(filteredLineAmounts.map((value) => value.toFixed(2)))];
  let tevkifatRaw: number;
  if (explicitTotal > 0) {
    // ÖZET "Hesaplanan KDV Tevkifat(%X)" satırı = KESİN toplam tevkifat → onu kullan, kalem
    //   "KDV TEVKİFAT(%X)=Y" satırlarını TOPLAMA. Kalem satırları + özet aynı "KDV TEVK" desenine
    //   uyup lineTevkifatAmounts'a birlikte giriyor; çok-kalemli faturada lineSum çift sayıyordu
    //   (ZEF124: kalem+özet = 904 YANLIŞ → doğru 576; ZEF129 1.151,20 → doğru 763,20).
    tevkifatRaw = explicitTotal;
  } else if (filteredLineAmounts.length > 1 && lineSum > 0) {
    if (distinctLineAmounts.length === 1) {
      // Tüm satırlar aynı tutar → eko (tekrar). Toplama bug'ı: 1.064 + 1.064 = 2.128.
      tevkifatRaw = Number(distinctLineAmounts[0]);
    } else {
      // Gerçek çok-satırlı tevkifat (ör. Zeyrek 158+251,20) — ÖZET satırı yok, kalemleri topla.
      tevkifatRaw = lineSum;
    }
  } else {
    tevkifatRaw = lineSum;
  }
  const tevkifat = round2(tevkifatRaw);
  if (!(tevkifat > 0) || tevkifat >= tamKdv - 0.05) return null;

  return {
    tamKdv,
    tevkifat,
    netKdv: round2(tamKdv - tevkifat),
  };
}
