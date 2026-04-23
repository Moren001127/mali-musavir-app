import { api } from './api';

export interface VendorDecision {
  id: string;
  taxpayerId: string | null;  // YENİ: mükellef-bazlı karar
  kararTipi: 'fatura' | 'isletme';
  kategori: string;
  altKategori: string | null;
  onayAdedi: number;
  sonKullanim: string;
  createdAt: string;
  taxpayer?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    type: string;
  } | null;
}

/** Her firma satırında mükellef özeti (list endpoint) */
export interface VendorMukellefOzet {
  taxpayerId: string | null;
  ad: string;
  onayAdedi: number;
}

/** Detay modalında tek mükellef için kategori dağılımı */
export interface VendorMukellefDetay {
  taxpayerId: string | null;
  ad: string;
  toplamOnay: number;
  kategoriler: Array<{
    kategori: string;
    altKategori: string | null;
    kararTipi: string;
    onayAdedi: number;
    sonKullanim: string;
  }>;
}

export interface VendorMemoryRow {
  id: string;
  tenantId: string;
  firmaKimlikNo: string;
  firmaUnvan: string | null;
  toplamOnay: number;
  sonKullanim: string;
  createdAt: string;
  updatedAt: string;
  decisions: VendorDecision[];
  mukellefler?: VendorMukellefOzet[];         // list endpoint
  // detail endpoint'te decisions yerine bunu kullan:
}

export interface VendorMemoryDetail extends Omit<VendorMemoryRow, 'mukellefler'> {
  mukellefler: VendorMukellefDetay[];
}

export const vendorMemoryApi = {
  list: (params?: { search?: string; limit?: number }) =>
    api.get<VendorMemoryRow[]>('/vendor-memory', { params }).then((r) => r.data),
  detail: (firmaKimlikNo: string) =>
    api.get<VendorMemoryDetail>(`/vendor-memory/${encodeURIComponent(firmaKimlikNo)}`).then((r) => r.data),
  remove: (firmaKimlikNo: string) =>
    api.delete(`/vendor-memory/${encodeURIComponent(firmaKimlikNo)}`).then((r) => r.data),

  /** Backfill: tüm "(ortak)" kayıtları geçmiş AgentEvent'lerden mükelleflere bağla */
  backfillMukellef: () =>
    api.post<{
      ok: boolean;
      mesaj: string;
      taranan: number;
      eslesti: number;
      eslesmeyenFirmalar: number;
      mukellefBulunamayan: number;
    }>('/vendor-memory/backfill-mukellef').then((r) => r.data),
};
