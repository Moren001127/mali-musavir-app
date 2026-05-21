/* Mukellef veri normalizasyonu — backend modeli (Prisma) → UI alanları */

export type Taxpayer = {
  id: string;
  type?: 'GERCEK_KISI' | 'TUZEL_KISI' | string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  defterTuru?: 'BILANCO' | 'ISLETME' | string | null;
  isEFaturaMukellefi?: boolean;
  // Pasif uyumluluk için bazı eski/alternatif alanlar
  name?: string;
  identityNumber?: string;
  bookType?: string;
  [key: string]: any;
};

export function taxpayerName(t: Taxpayer | null | undefined): string {
  if (!t) return '-';
  if (t.companyName && t.companyName.trim()) return t.companyName;
  const full = `${t.firstName || ''} ${t.lastName || ''}`.trim();
  if (full) return full;
  if (t.name) return t.name; // eski uyumluluk
  return '(isimsiz)';
}

export function taxpayerShortName(t: Taxpayer | null | undefined, max = 28): string {
  const n = taxpayerName(t);
  if (n.length <= max) return n;
  return n.slice(0, max - 1) + '…';
}

export function taxpayerType(t: Taxpayer | null | undefined): 'Bireysel' | 'Kurumsal' {
  if (!t) return 'Kurumsal';
  if (t.type === 'GERCEK_KISI') return 'Bireysel';
  if (t.type === 'TUZEL_KISI') return 'Kurumsal';
  // type yoksa: kimlik no 11 hane = bireysel, 10 hane = kurumsal
  const v = String(t.taxNumber || '').replace(/\D/g, '');
  if (v.length === 11) return 'Bireysel';
  return 'Kurumsal';
}

export function taxpayerBookType(t: Taxpayer | null | undefined): string {
  if (!t) return '-';
  const v = (t.defterTuru || t.bookType || '').toUpperCase();
  if (v === 'BILANCO') return 'Bilanço';
  if (v === 'ISLETME') return 'İşletme';
  // bilinmiyorsa tip + bilanço varsayımı yapma — daha temiz: boş bırak
  return '-';
}

export function taxpayerTaxNumber(t: Taxpayer | null | undefined): string {
  if (!t) return '-';
  return String(t.taxNumber || t.identityNumber || '-');
}

export function taxpayerSearchMatch(t: Taxpayer, q: string): boolean {
  if (!q) return true;
  const Q = q.toLowerCase();
  return (
    taxpayerName(t).toLowerCase().includes(Q) ||
    String(t.taxNumber || '').includes(q) ||
    String(t.identityNumber || '').includes(q)
  );
}
