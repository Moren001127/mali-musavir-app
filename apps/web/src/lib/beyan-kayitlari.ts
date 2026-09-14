import { api } from './api';

export type BeyanTipi =
  | 'KDV1' | 'KDV2' | 'MUHSGK' | 'DAMGA' | 'POSET'
  | 'KURUMLAR' | 'GELIR' | 'BILDIRGE' | 'EDEFTER'
  | 'GGECICI' | 'KGECICI' | 'GECICI_VERGI' | 'DIGER';

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
  GGECICI: 'Gelir Geçici',
  KGECICI: 'Kurum Geçici',
  GECICI_VERGI: 'Geçici Vergi',
  DIGER: 'Diğer',
};

// ---- Sayfalı liste / iletim (sözleşme: docs/sayfalama-sozlesme-2026-09-14.md §4-§6) ----
export type IletimKanal = 'WHATSAPP' | 'EMAIL';
export type IletimDurumu = 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED';

/** Bir kaydı içeren gönderim (Akıllı Bildirim DocumentDispatch) — en yeni önce gelir. */
export interface IletimBilgisi {
  channel: IletimKanal;
  status: IletimDurumu;
  sentAt: string | null;
  error: string | null;
  testMode: boolean;
}

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
  beyannameUrl: string | null;
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
    email?: string | null;
    emails?: string[];
    phone?: string | null;
    phones?: string[];
  };
  /** Sayfalı modda gelir: bu kaydı içeren VERGI gönderimleri (kanal başına en yenisi). */
  iletim?: IletimBilgisi[];
}

export type BeyanBelgeSuzgec = 'all' | 'beyanname' | 'tahakkuk';
export type BeyanIletimSuzgec = 'all' | 'iletildi' | 'iletilmedi' | 'hata';
export type BeyanSiralama = 'yeni' | 'donem' | 'mukellef' | 'tutar';

/** `GET /beyan-kayitlari?page=…` sorgu parametreleri (adlar sözleşmeyle birebir). */
export interface BeyanSayfaParams {
  page: number;
  /** 25 | 50 | 100 — dışa aktarım için en çok 1000. */
  pageSize: number;
  taxpayerId?: string;
  /** Virgülle çoklu: `KDV1,KDV2`. */
  beyanTipi?: string;
  /** `YYYY-MM` */
  donemBas?: string;
  /** `YYYY-MM` */
  donemBit?: string;
  belge?: BeyanBelgeSuzgec;
  iletim?: BeyanIletimSuzgec;
  search?: string;
  sirala?: BeyanSiralama;
}

export interface BeyanSayfaYaniti {
  rows: BeyanKaydi[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BeyanGonderSonucu {
  taxpayerId: string;
  unvan: string;
  channel: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  kayitSayisi: number;
}

export interface BeyanGonderYaniti {
  ok: true;
  testMode: boolean;
  results: BeyanGonderSonucu[];
}

/** `POST /beyan-kayitlari/gonder` tek istekte en çok bu kadar id alır. */
export const BEYAN_GONDER_MAX_ID = 50;

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

  /** Sayfalı liste — `page` verildiği için sunucu `{ rows, total, page, pageSize }` döner. */
  listSayfa: (params: BeyanSayfaParams) =>
    api.get<BeyanSayfaYaniti>('/beyan-kayitlari', { params }).then((r) => r.data),

  /** Seçili kayıtları mükellefe WhatsApp / e-posta ile gönderir (PDF'ler tek dosyada, kısa link). */
  gonder: (body: { ids: string[]; channel: IletimKanal }) =>
    api.post<BeyanGonderYaniti>('/beyan-kayitlari/gonder', body).then((r) => r.data),

  ozet: () =>
    api.get<BeyanOzet>('/beyan-kayitlari/ozet').then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/beyan-kayitlari/${id}`).then((r) => r.data),

  bulkDelete: (params?: { taxpayerId?: string; beyanTipi?: string; donem?: string; search?: string }) =>
    api.delete<{ deleted: number; statusDeleted: number }>('/beyan-kayitlari/bulk', { params }).then((r) => r.data),

  bulkDeleteIds: (ids: string[]) =>
    api.post<{ deleted: number; statusDeleted: number }>('/beyan-kayitlari/bulk-delete', { ids }).then((r) => r.data),

  pdfUrl: (id: string): string => {
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    return `${base}/beyan-kayitlari/${id}/pdf`;
  },

  beyannameUrl: (id: string): string => {
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    return `${base}/beyan-kayitlari/${id}/beyanname`;
  },

  // Toplu PDF yükleme — FormData ile
  importPdfs: async (files: File[], onProgress?: (p: number) => void): Promise<ImportResponse> => {
    const fd = new FormData();
    for (const f of files) {
      const relativeName = ((f as any).webkitRelativePath || f.name) as string;
      fd.append('files', f, relativeName);
    }
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

// ---- Akıllı Bildirim ayarı (yalnız okuma; gönderim onay kutusunda TEST MODU uyarısı için) ----
export interface AkilliBildirimAyar {
  kategori: 'VERGI' | 'SGK' | 'ETEBLIGAT' | string;
  enabled: boolean;
  testMode: boolean;
  testPhone?: string | null;
  testEmail?: string | null;
  whatsapp: boolean;
  email: boolean;
}

export const akilliBildirimApi = {
  settings: () =>
    api.get<AkilliBildirimAyar[]>('/akilli-bildirim/settings').then((r) => r.data),
};
