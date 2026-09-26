// SGK e-Rapor (vizite) + hastane iş kazası bildirimi — web istemcisi (2026-09-26).
// Sözleşme: packages/shared/src/constants/sgk-vizite.ts (uçların listesi dosya başında).
// Aynı http yardımcısı (api: taban adres + JWT + 401'de yenileme) portal-automation.ts ile ortak.
import type {
  SgkIsKazasiSatiri,
  SgkRaporSatiri,
  SgkViziteIslemSonucu,
  SgkViziteMukellefDurumu,
  SgkViziteOzet,
  SgkViziteSorguBaslat,
} from '@mali-musavir/shared';
import { api } from './api';

/** bekleyen = BEKLIYOR + PARCALI · onaylanan = ONAYLANDI */
export type SgkRaporListesi = 'bekleyen' | 'onaylanan';

/** React Query anahtarları (SGK Otomasyonu › Rapor · İş Kazası · Giriş-Çıkış bölümü). */
export const SGK_VIZITE_ANAHTAR = 'sgk-vizite';
export const sgkViziteAnahtar = {
  hepsi: [SGK_VIZITE_ANAHTAR] as const,
  ozetKok: [SGK_VIZITE_ANAHTAR, 'ozet'] as const,
  ozet: (taxpayerId: string) => [SGK_VIZITE_ANAHTAR, 'ozet', taxpayerId] as const,
  raporlar: (durum: SgkRaporListesi, taxpayerId: string) => [SGK_VIZITE_ANAHTAR, 'raporlar', durum, taxpayerId] as const,
  isKazalari: (taxpayerId: string) => [SGK_VIZITE_ANAHTAR, 'is-kazalari', taxpayerId] as const,
  durumlar: [SGK_VIZITE_ANAHTAR, 'durumlar'] as const,
};

// Boş mükellef = tümü (parametre hiç gönderilmez).
const mukellef = (taxpayerId?: string) => (taxpayerId ? { taxpayerId } : {});

export const sgkViziteApi = {
  ozet: (taxpayerId?: string) =>
    api.get<SgkViziteOzet>('/sgk-vizite/ozet', { params: mukellef(taxpayerId) }).then((r) => r.data),
  raporlar: (durum: SgkRaporListesi, taxpayerId?: string) =>
    api.get<{ satirlar: SgkRaporSatiri[] }>('/sgk-vizite/raporlar', { params: { durum, ...mukellef(taxpayerId) } }).then((r) => r.data),
  isKazalari: (taxpayerId?: string) =>
    api.get<{ satirlar: SgkIsKazasiSatiri[] }>('/sgk-vizite/is-kazalari', { params: mukellef(taxpayerId) }).then((r) => r.data),
  durumlar: () =>
    api.get<{ satirlar: SgkViziteMukellefDurumu[] }>('/sgk-vizite/durumlar').then((r) => r.data),
  /** taxpayerIds boşsa SGK şifresi olan tüm mükellefler sorgulanır. */
  sorgula: (taxpayerIds?: string[]) =>
    api.post<SgkViziteSorguBaslat>('/sgk-vizite/sorgula', taxpayerIds && taxpayerIds.length ? { taxpayerIds } : {}).then((r) => r.data),
  /** bitisTarihi 'YYYY-AA-GG'; calisti=false → "çalışmamıştır". */
  onayla: (id: string, govde: { bitisTarihi: string; calisti: boolean }) =>
    api.post<SgkViziteIslemSonucu>(`/sgk-vizite/raporlar/${encodeURIComponent(id)}/onay`, govde).then((r) => r.data),
  personelimDegil: (id: string) =>
    api.post<SgkViziteIslemSonucu>(`/sgk-vizite/raporlar/${encodeURIComponent(id)}/personelim-degil`).then((r) => r.data),
};
