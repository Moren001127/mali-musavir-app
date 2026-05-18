export function normalizeBelgeNo(value: string): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function stripLeadingZeros(value: string): string {
  if (!value) return '';
  if (/^\d+$/.test(value)) return value.replace(/^0+/, '') || '0';
  return value;
}

export function eInvoiceComparableKey(normalizedBelgeNo: string): string {
  const m = normalizedBelgeNo.match(/^([A-Z]{2,4})(20\d{2})(\d{6,14})$/)
    ?? normalizedBelgeNo.match(/^([A-Z]\d{2})(20\d{2})(\d{6,14})$/);
  if (!m) return normalizedBelgeNo;
  return `${m[1]}${m[2]}${m[3].replace(/^0+/, '') || '0'}`;
}

export function sameBelgeNo(a: string, b: string): boolean {
  const normA = normalizeBelgeNo(a);
  const normB = normalizeBelgeNo(b);
  if (!normA || !normB) return false;
  return (
    normA === normB ||
    stripLeadingZeros(normA) === stripLeadingZeros(normB) ||
    eInvoiceComparableKey(normA) === eInvoiceComparableKey(normB)
  );
}

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const dist = levenshtein(longer, shorter);
  return (longer.length - dist) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
