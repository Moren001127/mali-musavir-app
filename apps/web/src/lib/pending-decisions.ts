import { api } from './api';

export interface PendingDecisionRow {
  id: string;
  mukellef: string | null;
  firmaKimlikNo: string | null;
  firmaUnvan: string | null;
  belgeNo: string | null;
  belgeTuru: string | null;
  faturaTarihi: string | null;
  tutar: string | null;
  kararTipi: 'fatura' | 'isletme';
  aiKarari: any;
  gecmisBeklenen: any;
  sapmaSebep: string;
  durum: 'bekliyor' | 'onaylandi' | 'reddedildi';
  sonucKarari: any | null;
  onayAlan: string | null;
  onayTarihi: string | null;
  notlar: string | null;
  createdAt: string;
  imageBase64?: string | null; // sadece detay cagrisinda doner
}

export const pendingDecisionsApi = {
  list: (params?: { durum?: string; limit?: number }) =>
    api.get<PendingDecisionRow[]>('/onay-kuyrugu', { params }).then((r) => r.data),
  count: () =>
    api.get<{ bekleyen: number }>('/onay-kuyrugu/count').then((r) => r.data),
  detail: (id: string) =>
    api.get<PendingDecisionRow>(`/onay-kuyrugu/${encodeURIComponent(id)}`).then((r) => r.data),
  onayla: (id: string, body?: { override?: { kategori: string; altKategori?: string }; notlar?: string }) =>
    api.post(`/onay-kuyrugu/${encodeURIComponent(id)}/onayla`, body || {}).then((r) => r.data),
  reddet: (id: string, body?: { notlar?: string }) =>
    api.post(`/onay-kuyrugu/${encodeURIComponent(id)}/reddet`, body || {}).then((r) => r.data),
};
