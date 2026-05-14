const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export function normalizeDonemTipi(donem?: string | null, donemTipi?: string | null): string {
  const given = String(donemTipi || '').trim().toUpperCase();
  if (/^GECICI_Q[1-4]$/.test(given)) return given;
  if (given === 'AY' || given === 'AYLIK' || given === 'MONTH') return 'AYLIK';
  if (given === 'YILLIK' || given === 'YEAR' || given === 'ANNUAL') return 'YILLIK';

  const s = String(donem || '').trim().toUpperCase();
  const q = s.match(/(?:^|[-_/])Q([1-4])$/);
  if (q) return `GECICI_Q${q[1]}`;
  if (/-YILLIK$/.test(s) || /^\d{4}$/.test(s)) return 'YILLIK';
  if (/^\d{4}[-_/]\d{1,2}$/.test(s)) return 'AYLIK';
  return given || 'AYLIK';
}

export function formatDonemTipiLabel(donemTipi?: string | null, donem?: string | null): string {
  const normalized = normalizeDonemTipi(donem, donemTipi);
  const q = normalized.match(/^GECICI_Q([1-4])$/);
  if (q) {
    const ranges: Record<string, string> = {
      '1': 'Ocak - Mart',
      '2': 'Nisan - Haziran',
      '3': 'Temmuz - Eylül',
      '4': 'Ekim - Aralık',
    };
    return `${q[1]}. Dönem (${ranges[q[1]]})`;
  }
  if (normalized === 'YILLIK') return 'Yıllık';
  if (normalized === 'AYLIK') return 'Aylık';
  return normalized || 'Dönem';
}

export function getDonemDateRange(
  donem?: string | null,
  donemTipi?: string | null,
): { baslangic: string; bitis: string } {
  const s = String(donem || '').trim();
  const normalized = normalizeDonemTipi(s, donemTipi);
  const m = s.match(/^(\d{4})-(.+)$/);
  const year = m ? Number(m[1]) : Number(s.slice(0, 4));
  const part = m ? m[2] : '';
  if (!Number.isFinite(year)) return { baslangic: '', bitis: '' };

  const qMatch = part.match(/^Q([1-4])$/i) || normalized.match(/^GECICI_Q([1-4])$/);
  if (qMatch) {
    const q = Number(qMatch[1]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const endDay = new Date(year, endMonth, 0).getDate();
    return {
      baslangic: `01/${String(startMonth).padStart(2, '0')}/${year}`,
      bitis: `${String(endDay).padStart(2, '0')}/${String(endMonth).padStart(2, '0')}/${year}`,
    };
  }

  if (normalized === 'YILLIK' || part === 'YILLIK') {
    return { baslangic: `01/01/${year}`, bitis: `31/12/${year}` };
  }

  const month = Number(part);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    const last = new Date(year, month, 0).getDate();
    return {
      baslangic: `01/${String(month).padStart(2, '0')}/${year}`,
      bitis: `${String(last).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    };
  }

  return { baslangic: '', bitis: '' };
}

export function formatDonemLabel(donem?: string | null, donemTipi?: string | null): string {
  const s = String(donem || '').trim();
  const normalized = normalizeDonemTipi(s, donemTipi);
  const year = s.match(/^(\d{4})/)?.[1] || '';
  const q = s.match(/(?:^|[-_/])Q([1-4])$/i)?.[1] || normalized.match(/^GECICI_Q([1-4])$/)?.[1];
  if (q && year) return `${year} ${q}. Dönem`;
  if (normalized === 'YILLIK' && year) return `${year} Yıllık`;
  const monthly = s.match(/^(\d{4})[-_/](\d{1,2})$/);
  if (monthly) {
    const monthIndex = Number(monthly[2]) - 1;
    return `${MONTHS_TR[monthIndex] || monthly[2]} ${monthly[1]}`;
  }
  return s || 'Dönem';
}

export function formatDonemRangeLabel(donem?: string | null, donemTipi?: string | null): string {
  const range = getDonemDateRange(donem, donemTipi);
  const label = formatDonemLabel(donem, donemTipi);
  if (!range.baslangic || !range.bitis) return label;
  return `${label} (${range.baslangic} - ${range.bitis})`;
}
