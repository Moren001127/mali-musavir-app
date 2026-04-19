import { api } from './api';

export interface VendorDecision {
  id: string;
  kararTipi: 'fatura' | 'isletme';
  kategori: string;
  altKategori: string | null;
  onayAdedi: number;
  sonKullanim: string;
  createdAt: string;
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
}

export const vendorMemoryApi = {
  list: (params?: { search?: string; limit?: number }) =>
    api.get<VendorMemoryRow[]>('/vendor-memory', { params }).then((r) => r.data),
  detail: (firmaKimlikNo: string) =>
    api.get<VendorMemoryRow>(`/vendor-memory/${encodeURIComponent(firmaKimlikNo)}`).then((r) => r.data),
  remove: (firmaKimlikNo: string) =>
    api.delete(`/vendor-memory/${encodeURIComponent(firmaKimlikNo)}`).then((r) => r.data),
};
