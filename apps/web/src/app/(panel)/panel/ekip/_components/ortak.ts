/** Moren Ekip — ortak renkler ve yardımcılar. Modül kimliği: gök mavisi; altın YALNIZ koordinatörde. */
import type { CSSProperties } from 'react';

export const EKIP_ACCENT = '#7dd3fc';

/** Her ajanın kendi rengi (kart şeridi, ikon, rozet). */
export const AJAN_RENK: Record<string, string> = {
  koordinator: '#d4b876',
  evrak: '#60a5fa',
  fatura: '#34d399',
  'banka-kasa': '#22d3ee',
  beyanname: '#fbbf24',
  'bordro-sgk': '#a78bfa',
  edefter: '#818cf8',
  'luca-operator': '#e879f9',
  denetci: '#f87171',
  analist: '#2dd4bf',
  mevzuat: '#fb923c',
  risk: '#fb7185',
  musteri: '#4ade80',
};

export function ajanRengi(id: string): string {
  return AJAN_RENK[id] || EKIP_ACCENT;
}

/** Kısa ad — id'den baş harf/kısaltma (ikon yerine). */
export function ajanKisaltma(id: string, ad?: string): string {
  const map: Record<string, string> = {
    koordinator: 'KO',
    evrak: 'EV',
    fatura: 'FA',
    'banka-kasa': 'BK',
    beyanname: 'BY',
    'bordro-sgk': 'SG',
    edefter: 'ED',
    'luca-operator': 'LU',
    denetci: 'DN',
    analist: 'AN',
    mevzuat: 'MV',
    risk: 'RS',
    musteri: 'MÜ',
  };
  if (map[id]) return map[id];
  return (ad || id).slice(0, 2).toLocaleUpperCase('tr-TR');
}

/** Gradyan + radial parıltı kart arka planı (düz gri kutu YOK). */
export function kartArkaPlan(renk: string, secili = false): CSSProperties {
  return {
    background: `radial-gradient(120% 120% at 0% 0%, ${renk}${secili ? '2e' : '1c'}, transparent 48%), radial-gradient(100% 100% at 100% 100%, ${renk}0f, transparent 44%), linear-gradient(160deg, rgba(22,20,17,0.94), rgba(10,9,7,0.94))`,
    border: `1px solid ${renk}${secili ? '66' : '2a'}`,
    boxShadow: secili
      ? `0 0 0 1px ${renk}33, 0 18px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)`
      : 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)',
  };
}

/** Model rozeti rengi. */
export function modelRengi(model: string): string {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return '#e879f9';
  if (m.includes('sonnet')) return '#7dd3fc';
  if (m.includes('haiku')) return '#4ade80';
  return '#a3a3a3';
}

export const ASAMALAR: Array<{ key: 'evrak' | 'isleme' | 'kontrol' | 'beyanname' | 'gonderim' | 'tahakkukIletildi'; ad: string }> = [
  { key: 'evrak', ad: 'Evrak' },
  { key: 'isleme', ad: 'İşleme' },
  { key: 'kontrol', ad: 'Kontrol' },
  { key: 'beyanname', ad: 'Beyanname' },
  { key: 'gonderim', ad: 'Gönderim' },
  { key: 'tahakkukIletildi', ad: 'Tahakkuk iletildi' },
];

export function asamaRengi(d?: string): string {
  if (d === 'tamam') return '#4ade80';
  if (d === 'eksik') return '#fb923c';
  return 'rgba(255,255,255,0.18)';
}

export function donemEtiketi(donem: string): string {
  const [y, m] = donem.split('-');
  const aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const ay = aylar[Number(m) - 1];
  return ay ? `${ay} ${y}` : donem;
}

export function tarihKisa(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function sureKisa(ms?: number): string {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}
