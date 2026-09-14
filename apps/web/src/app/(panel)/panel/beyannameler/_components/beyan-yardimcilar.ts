// Beyanname İndirme sayfasının saf yardımcıları (biçimleme, tür/mahiyet çıkarımı, iletişim bilgisi).
// page.tsx içinden buraya taşındı ki satır / onay kutusu parçaları da kullanabilsin. Davranış aynı.
import { BeyanKaydi, BeyanTipi, BEYAN_TIPI_LABEL } from '@/lib/beyan-kayitlari';
import type { PortalJob } from '@/lib/portal-automation';

export type FilterKey = 'all' | BeyanTipi;
export type BeyanDocKind = 'beyanname' | 'tahakkuk';

export const FILTER_KEYS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'KDV1', label: 'KDV1' },
  { key: 'KDV2', label: 'KDV2' },
  { key: 'MUHSGK', label: 'MUHSGK' },
  { key: 'DAMGA', label: 'Damga' },
  { key: 'POSET', label: 'Poşet' },
  { key: 'KURUMLAR', label: 'Kurumlar' },
  { key: 'GELIR', label: 'Gelir' },
  { key: 'GGECICI', label: 'Gelir Geçici' },
  { key: 'KGECICI', label: 'Kurum Geçici' },
  { key: 'EDEFTER', label: 'E-Defter' },
];

export function fmtDonem(d: string): string {
  // "2026-03" → "Mart 2026"; "2025-YIL" → "2025 Yıllık"
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${aylar[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (/^\d{4}-YIL$/.test(d)) return d.replace('-YIL', ' Yıllık');
  return d;
}

export function fmtCurrency(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' TL';
}

/** Tabloda kısa dönem: aylık "2023/11", çeyrek "2026/1–3", yıllık "2025" (Hattat biçimi dosya adı/başlıkta kalır). */
export function fmtDonemKisa(donem: string): string {
  const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) { const start = (Number(quarter[2]) - 1) * 3 + 1; return `${quarter[1]}/${start}–${start + 2}`; }
  const monthly = donem.match(/^(\d{4})-(\d{2})$/);
  if (monthly) return `${monthly[1]}/${monthly[2]}`;
  const yearly = donem.match(/^(\d{4})-YIL$/);
  if (yearly) return yearly[1];
  return donem;
}

export function fmtDonemHattat(donem: string): string {
  const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) {
    const start = (Number(quarter[2]) - 1) * 3 + 1;
    return `${quarter[1]}/${start} - ${quarter[1]}/${start + 2}`;
  }
  const monthly = donem.match(/^(\d{4})-(\d{2})$/);
  if (monthly) {
    const month = Number(monthly[2]);
    return `${monthly[1]}/${month} - ${monthly[1]}/${month}`;
  }
  const yearly = donem.match(/^(\d{4})-YIL$/);
  if (yearly) return yearly[1];
  return donem;
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

/** "12 Eyl" — iletim rozeti için kısa tarih. */
export function fmtKisaTarih(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function textKey(value?: string | null): string {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function beyanMahiyeti(row: BeyanKaydi): 'ASIL' | 'DUZELTME' {
  const raw = (() => {
    if (!row.notlar) return '';
    try {
      return JSON.stringify(JSON.parse(row.notlar));
    } catch {
      return row.notlar;
    }
  })();
  return /\bDUZELTME\b/.test(textKey(raw)) ? 'DUZELTME' : 'ASIL';
}

export function portalJobProgress(job: PortalJob) {
  const progress = job.payload?.progress && typeof job.payload.progress === 'object' ? job.payload.progress : {};
  const current = Number(progress.current);
  const total = Number(progress.total);
  const records = Number(progress.records);
  const pct = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
    : null;
  return {
    message: typeof progress.message === 'string' ? progress.message : '',
    detail: typeof progress.detail === 'string' ? progress.detail : '',
    current: Number.isFinite(current) ? current : null,
    total: Number.isFinite(total) ? total : null,
    records: Number.isFinite(records) ? records : null,
    pct,
  };
}

export function portalJobStatus(status: PortalJob['status']) {
  switch (status) {
    case 'done': return { label: 'Tamam', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.22)' };
    case 'running': return { label: 'Çalışıyor', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.22)' };
    case 'failed': return { label: 'Hata', color: '#fb7185', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.24)' };
    case 'cancelled': return { label: 'İptal', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.22)' };
    default: return { label: 'Kuyrukta', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)' };
  }
}

export function dateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function lastThreeDaysRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 3);
  return { from: dateInputValue(from), to: dateInputValue(today) };
}

function firstContact(values?: Array<string | null | undefined>): string {
  return (values || []).map((v) => String(v || '').trim()).find(Boolean) || '';
}

export function taxpayerEmail(k: BeyanKaydi): string {
  return firstContact([k.taxpayer?.email, ...(k.taxpayer?.emails || [])]);
}

export function taxpayerPhone(k: BeyanKaydi): string {
  return firstContact([k.taxpayer?.phone, ...(k.taxpayer?.phones || [])]);
}

function taxpayerLooksCorporate(k: BeyanKaydi): boolean {
  const taxNumber = String(k.taxpayer?.taxNumber || '').replace(/\D/g, '');
  const nameKey = textKey([
    k.taxpayer?.companyName,
    k.taxpayer?.firstName,
    k.taxpayer?.lastName,
  ].filter(Boolean).join(' '));
  if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
  return taxNumber.length === 10;
}

function taxpayerLooksPersonal(k: BeyanKaydi): boolean {
  const taxNumber = String(k.taxpayer?.taxNumber || '').replace(/\D/g, '');
  return taxNumber.length === 11 && !taxpayerLooksCorporate(k);
}

function declarationRawText(k: BeyanKaydi): string {
  try {
    const parsed = JSON.parse(k.notlar || '{}');
    const raw = parsed?.raw || parsed;
    return [
      raw?.beyanTipiRaw,
      raw?.mahiyet,
      raw?.rowText,
      Array.isArray(raw?.cells) ? raw.cells.join(' ') : '',
    ].filter(Boolean).join(' ');
  } catch {
    return k.notlar || '';
  }
}

export function declarationTypeCode(k: BeyanKaydi): string {
  if (['GECICI_VERGI', 'GGECICI', 'KGECICI'].includes(k.beyanTipi)) {
    if (taxpayerLooksCorporate(k)) return 'KGECICI';
    if (taxpayerLooksPersonal(k)) return 'GGECICI';
  }
  if (k.beyanTipi === 'GGECICI' || k.beyanTipi === 'KGECICI') return k.beyanTipi;
  if (k.beyanTipi !== 'GECICI_VERGI') return k.beyanTipi;
  const key = declarationRawText(k)
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
  if (/GGECICI|GELIRGECICI|GELIRVERGISIGECICI/.test(key)) return 'GGECICI';
  if (/KGECICI|KURUMGECICI|KURUMLARGECICI|KURUMLARVERGISIGECICI/.test(key)) return 'KGECICI';
  return 'GECICI_VERGI';
}

export function declarationTypeLabel(k: BeyanKaydi): string {
  const code = declarationTypeCode(k) as BeyanTipi;
  return BEYAN_TIPI_LABEL[code] || BEYAN_TIPI_LABEL[k.beyanTipi] || code;
}

/** Tür süzgeci → sunucu `beyanTipi` parametresi (virgülle çoklu). Geçici vergide ayrımı
 *  yapılamamış `GECICI_VERGI` kayıtları eski ekrandaki gibi her iki geçici süzgecinde de görünsün. */
export function beyanTipiParam(filter: FilterKey): string | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'GGECICI' || filter === 'KGECICI') return `${filter},GECICI_VERGI`;
  return filter;
}

/** Kayıt gönderilebilir mi (PDF + iletişim bilgisi); değilse neden. */
export function gonderimEngeli(k: BeyanKaydi, channel: 'WHATSAPP' | 'EMAIL'): string | null {
  if (!k.beyannameUrl && !k.pdfUrl) return 'PDF yok';
  if (channel === 'WHATSAPP' && !taxpayerPhone(k)) return 'Mükellef kartında telefon yok';
  if (channel === 'EMAIL' && !taxpayerEmail(k)) return 'Mükellef kartında e-posta yok';
  return null;
}

/** Windows/Mac dosya adında yasak karakterleri temizler. */
export function dosyaAdiTemizle(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

/** Bir diziyi n'lik parçalara böler (toplu gönderimde 50 id sınırı). */
export function parcala<T>(dizi: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < dizi.length; i += n) out.push(dizi.slice(i, i + n));
  return out;
}
