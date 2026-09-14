/**
 * Genel Sorgulamalar — ortak renkler, tür tanımları ve biçimlendiriciler.
 * Tasarım dili: Görevler modülüyle aynı sakin palet (koyu zemin + altın vurgu, nötr griler).
 */
import type { CSSProperties } from 'react';
import { GOLD, IKINCIL, METIN, SONUK, donemEtiketi as gorevDonemEtiketi } from '../../gorevler/_components/ortak';
import { ALTIN_SOLUK, KENAR_NOTR } from '../../gorevler/_components/Rozetler';
import type { SorguTuru } from '@/lib/genel-sorgular';

export { GOLD, IKINCIL, METIN, SONUK, ALTIN_SOLUK, KENAR_NOTR };

/** Tür renkleri — grup şeridi ve özet kartında; satır içinde renk dolgusu yok. */
export const TUR_RENK: Record<SorguTuru, string> = {
  VERGI_BORCU: '#e0868f', // yumuşak kırmızı (borç)
  E_HACIZ: '#f59e0b',
  YOKLAMA_DENETIM: '#a78bfa',
  POS: '#7dd3fc',
  GELEN_EARSIV: '#8fd7bd',
};

/** Tablo hücresi / başlık hücresi — GorevTablosu ile aynı. */
export const HUCRE: CSSProperties = { border: `1px solid ${KENAR_NOTR}`, padding: '8px 10px', verticalAlign: 'middle' };
export const HUCRE_BASLIK: CSSProperties = {
  ...HUCRE,
  padding: '7px 10px',
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: ALTIN_SOLUK,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
export const GRUP_ZEMIN = 'rgba(212,184,118,0.13)';
export const GRUP_CIZGI = '1px solid rgba(212,184,118,0.45)';

/** Kart zemini — koyu gradyan + sol-üst hafif radial parıltı (düz gri kutu YOK). */
export function kartZemini(renk: string = GOLD): CSSProperties {
  return {
    background: `radial-gradient(120% 100% at 0% 0%, ${renk}14, transparent 50%), linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), linear-gradient(160deg, rgba(20,18,16,0.96), rgba(9,8,7,0.96))`,
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)',
  };
}

export const donemEtiketi = gorevDonemEtiketi;

/** "14.09.2026 10:32" */
export function tarihSaat(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "14.09.2026" */
export function tarihKisa(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "1.234,56 ₺" */
export function para(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}

/** Bu ay → "YYYY-MM" */
export function buAy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** camelCase / snake_case anahtarı okunur Türkçe başlığa yaklaştırır (bilinenler sözlükten). */
const ANAHTAR_ADI: Record<string, string> = {
  toplamBorc: 'Toplam borç',
  toplamTutar: 'Toplam tutar',
  toplam: 'Toplam',
  tutar: 'Tutar',
  tarih: 'Tarih',
  durum: 'Durum',
  aciklama: 'Açıklama',
  faturalar: 'Faturalar',
  faturaNo: 'Fatura no',
  faturaTarihi: 'Fatura tarihi',
  vergiTuru: 'Vergi türü',
  vergiDairesi: 'Vergi dairesi',
  donem: 'Dönem',
  vadeTarihi: 'Vade tarihi',
  banka: 'Banka',
  hesap: 'Hesap',
  tutanakNo: 'Tutanak no',
  tutanakTarihi: 'Tutanak tarihi',
  gonderen: 'Gönderen',
  satici: 'Satıcı',
  saticiVkn: 'Satıcı VKN',
  ettn: 'ETTN',
  matrah: 'Matrah',
  kdv: 'KDV',
  kdvTutari: 'KDV tutarı',
};
export function anahtarAdi(k: string): string {
  if (ANAHTAR_ADI[k]) return ANAHTAR_ADI[k];
  const ayrik = k.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return ayrik.charAt(0).toLocaleUpperCase('tr-TR') + ayrik.slice(1);
}

/** Basit değer → metin (sayı tr-TR, boolean Evet/Hayır, ISO tarih kısaltılır). */
export function degerMetni(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (typeof v === 'number') return v.toLocaleString('tr-TR');
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return tarihSaat(v);
    return v;
  }
  return JSON.stringify(v);
}

/** Nötr çip (gri ince kenar). */
export const CIP_NOTR: CSSProperties = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.7)' };
