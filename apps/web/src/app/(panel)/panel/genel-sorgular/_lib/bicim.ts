/**
 * Genel Sorgulamalar — biçimlendiriciler (tarih, tutar, dönem, süre). Saf; ekran bileşeni yok.
 */

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "1.234,56" (₺ işareti sütun başlığında) */
export function tutar(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "22.09.2026 03:12" */
export function tarihSaat(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "22.09.2026" — ISO gün ("2026-09-22") ya da tam damga */
export function tarihKisa(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "2026-07" → "Temmuz 2026"; boş → "—" */
export function donemEtiketi(donem?: string | null): string {
  if (!donem) return '—';
  const m = /^(\d{4})-(\d{2})$/.exec(donem);
  if (!m) return donem;
  const ay = Number(m[2]);
  return ay >= 1 && ay <= 12 ? `${AYLAR[ay - 1]} ${m[1]}` : donem;
}

/** yıl + ay → "Temmuz 2026" */
export function yilAyEtiketi(yil: number, ay: number): string {
  if (!yil || !ay || ay < 1 || ay > 12) return '—';
  return `${AYLAR[ay - 1]} ${yil}`;
}

/** Bu ay → "YYYY-MM" */
export function buAy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** İki damga arası süre: "12 sn" · "1 dk 05 sn" · "1 sa 12 dk" */
export function sure(baslangic?: string | null, bitis?: string | null | number): string {
  if (!baslangic) return '—';
  const b = new Date(baslangic).getTime();
  const e = typeof bitis === 'number' ? bitis : bitis ? new Date(bitis).getTime() : NaN;
  if (!Number.isFinite(b) || !Number.isFinite(e) || e < b) return '—';
  const sn = Math.round((e - b) / 1000);
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk ${String(sn % 60).padStart(2, '0')} sn`;
  const sa = Math.floor(dk / 60);
  return `${sa} sa ${String(dk % 60).padStart(2, '0')} dk`;
}

/** Türkçe küçük harf (arama için). */
export function kucult(s: string): string {
  return (s || '').toLocaleLowerCase('tr-TR');
}

/** Sayı → "12" (binlik ayraçlı) */
export function adet(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '0' : n.toLocaleString('tr-TR');
}
