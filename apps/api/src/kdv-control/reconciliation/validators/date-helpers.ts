export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function likelyOcrYearMisread(a: Date, b: Date): boolean {
  if (a.getDate() !== b.getDate()) return false;
  if (a.getMonth() !== b.getMonth()) return false;
  const yearDiff = Math.abs(a.getFullYear() - b.getFullYear());
  return yearDiff > 0 && yearDiff <= 5;
}

export function parseTrDate(value: string): Date | null {
  const m = value.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (year < 2000 || year > 2050) return null;
    const d = new Date(`${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatTrDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}
