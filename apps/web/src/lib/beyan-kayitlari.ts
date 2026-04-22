import { api } from './api';

export type BeyanTipi =
  | 'KDV1' | 'KDV2' | 'MUHSGK' | 'DAMGA' | 'POSET'
  | 'KURUMLAR' | 'GELIR' | 'BILDIRGE' | 'EDEFTER'
  | 'GECICI_VERGI' | 'DIGER';

export const BEYAN_TIPI_LABEL: Record<BeyanTipi, string> = {
  KDV1: 'KDV (1 No\'lu)',
  KDV2: 'KDV Tevkifat (2)',
  MUHSGK: 'MUHSGK',
  DAMGA: 'Damga Vergisi',
  POSET: 'Poşet Beyan.',
  KURUMLAR: 'Kurumlar V.',
  GELIR: 'Gelir V.',
  BILDIRGE: 'SGK Bildirge',
  EDEFTER: 'E-Defter',
  GECICI_VERGI: 'Geçici Vergi',
  DIGER: 'Diğer',
};

export interface BeyanKaydi {
  id: string;
  taxpayerId: string;
  beyanTipi: BeyanTipi;
  donem: string;
  beyanTarihi: string | null;
  tahakkukTutari: number | null;
  odemeTutari: number | null;
  onayNo: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  kaynak: string;
  importBatchId: string | null;
  notlar: string | null;
  createdAt: string;
  updatedAt: string;
  taxpayer?: {
    id: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
    taxNumber: string;
  };
}

export interface ImportResult {
  dosyaAdi: string;
  durum: 'ok' | 'mukellef_yok' | 'parse_hatasi' | 'mevcut' | 'hata';
  beyanKaydiId?: string;
  sebep?: string;
  parsed?: {
    vkn: string | null;
    mukellefAdi: string | null;
    beyanTipi: string | null;
    donem: string | null;
    tahakkukTutari: number | null;
  };
}

export interface ImportResponse {
  batchId: string;
  results: ImportResult[];
}

export interface BeyanOzet {
  toplam: number;
  byTip: Record<string, number>;
  toplamTahakkuk: number;
}

export const beyanKayitlariApi = {
  list: (params?: { taxpayerId?: string; beyanTipi?: string; donem?: string; search?: string; limit?: number }) =>
    api.get<BeyanKaydi[]>('/beyan-kayitlari', { params }).then((r) => r.data),

  ozet: () =>
    api.get<BeyanOzet>('/beyan-kayitlari/ozet').then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/beyan-kayitlari/${id}`).then((r) => r.data),

  pdfUrl: (id: string): string => {
    // API_URL + JWT ile direkt indirme URL'i (redirect yapıyor)
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    return `${base}/beyan-kayitlari/${id}/pdf`;
  },

  // Toplu PDF yükleme — FormData ile
  importPdfs: async (files: File[], onProgress?: (p: number) => void): Promise<ImportResponse> => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const { data } = await api.post<ImportResponse>('/beyan-kayitlari/import-pdf', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (ev) => {
        if (onProgress && ev.total) onProgress(Math.round((ev.loaded / ev.total) * 100));
      },
      timeout: 10 * 60 * 1000, // 10 dakika — çok PDF varsa AI parse süresi uzun olabilir
    });
    return data;
  },

  // Hattat ZIP yükleme — tek dosya, server-side klasör parse
  importZip: async (
    file: File,
    onProgress?: (p: number) => void,
  ): Promise<{
    batchId: string;
    ozet: { mukellefBulundu: number; mukellefYok: number; kayitEklendi: number; mevcut: number; parseHatasi: number };
    eslesmeyenler: Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }>;
    sonuclar: ImportResult[];
  }> => {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await api.post('/beyan-kayitlari/import-zip', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (ev) => {
        if (onProgress && ev.total) onProgress(Math.round((ev.loaded / ev.total) * 100));
      },
      timeout: 15 * 60 * 1000, // 15 dakika — büyük ZIP'ler için
    });
    return data;
  },
};

export function beyanKaydiMukellefAdi(k: BeyanKaydi): string {
  const t = k.taxpayer;
  if (!t) return '—';
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber || '—';
}
