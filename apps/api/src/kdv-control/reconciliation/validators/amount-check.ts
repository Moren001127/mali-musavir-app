export function parseMoneyLike(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAmountTr(value: number): string {
  return value.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseTrUsAmount(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/[^\d.,\-]/g, '').trim();
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot === -1 && lastComma === -1) {
    return parseFloat(s);
  }
  const sepIdx = Math.max(lastDot, lastComma);
  const afterSep = s.length - sepIdx - 1;
  if (afterSep === 1 || afterSep === 2) {
    const intPart = s.slice(0, sepIdx).replace(/[.,]/g, '');
    const fracPart = s.slice(sepIdx + 1);
    const num = parseFloat(`${intPart}.${fracPart}`);
    return Number.isFinite(num) ? num : NaN;
  }
  return parseFloat(s.replace(/[.,]/g, ''));
}
