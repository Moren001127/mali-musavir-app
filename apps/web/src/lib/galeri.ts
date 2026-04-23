import { api } from './api';

export interface Arac {
  id: string;
  plaka: string;
  plakaGorunum?: string; // "34 ABC 123"
  marka: string | null;
  model: string | null;
  sahipAd: string | null;
  taxpayerId: string | null;
  aktif: boolean;
  notlar: string | null;
  createdAt: string;
  updatedAt: string;
  sonSorgu?: HgsSorguSonucu | null;
}

export interface HgsSorguSonucu {
  id: string;
  aracId: string;
  sorguTarihi: string;
  durum: 'beklemede' | 'basarili' | 'hatali';
  ihlalSayisi: number;
  toplamTutar: number | null;
  detaylar: any;
  hataMesaji: string | null;
  kaynak: 'manuel' | 'cron_pazartesi' | 'tek_sefer';
}

export interface GaleriOzet {
  toplamArac: number;
  ihlalliArac: number;
  toplamIhlal: number;
  toplamTutar: number;
}

export const galeriApi = {
  listAraclar: (params?: { search?: string; aktif?: boolean }) =>
    api.get<Arac[]>('/galeri/araclar', { params }).then((r) => r.data),

  createArac: (data: { plaka: string; marka?: string; model?: string; sahipAd?: string; taxpayerId?: string | null; notlar?: string }) =>
    api.post<Arac>('/galeri/araclar', data).then((r) => r.data),

  updateArac: (id: string, data: Partial<Arac>) =>
    api.put<Arac>(`/galeri/araclar/${id}`, data).then((r) => r.data),

  deleteArac: (id: string) =>
    api.delete(`/galeri/araclar/${id}`).then((r) => r.data),

  sorguGecmisi: (aracId: string) =>
    api.get<HgsSorguSonucu[]>(`/galeri/araclar/${aracId}/hgs-sorgu-gecmisi`).then((r) => r.data),

  kaydetSorgu: (aracId: string, data: Partial<HgsSorguSonucu>) =>
    api.post<HgsSorguSonucu>(`/galeri/araclar/${aracId}/hgs-sorgu-sonuc`, data).then((r) => r.data),

  ozet: () =>
    api.get<GaleriOzet>('/galeri/ozet').then((r) => r.data),

  // ── Toplu otomatik sorgu (agent komutları) ──
  baslatTopluSorgu: (body: { aracIds?: string[]; sadeceAktif?: boolean } = {}) =>
    api.post<{
      ok: boolean;
      sebep?: string;
      komutId?: string;
      aracSayisi?: number;
      mesaj?: string;
      durum?: string;
    }>('/galeri/toplu-sorgu-baslat', body).then((r) => r.data),

  agentDurumu: () =>
    api.get<{
      status: { running: boolean; lastPing: string; meta: any } | null;
      canli: boolean;
      pingYasiSaniye: number | null;
      aktifKomut: any | null;
      sonKomut: any | null;
    }>('/galeri/agent-durumu').then((r) => r.data),

  komutKuyrugu: () =>
    api.get<any[]>('/galeri/komut-kuyrugu').then((r) => r.data),

  // ── PDF Rapor (Selim Motors logolu) ──
  pdfRaporUrl: (): string => {
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    return `${base}/galeri/pdf-rapor`;
  },

  pdfRaporAracUrl: (aracId: string, sorguId?: string): string => {
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    const q = sorguId ? `?sorguId=${encodeURIComponent(sorguId)}` : '';
    return `${base}/galeri/araclar/${aracId}/pdf-rapor${q}`;
  },
};
