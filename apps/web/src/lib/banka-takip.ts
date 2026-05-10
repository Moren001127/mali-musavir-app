import { api } from './api';

export interface BankaHesap {
  id: string;
  tenantId: string;
  taxpayerId: string;
  bankaAdi: string;
  hesapNo?: string | null;
  iban?: string | null;
  sube?: string | null;
  paraBirimi: string;
  aciklama?: string | null;
  aktif: boolean;
  sira: number;
  createdAt: string;
  updatedAt: string;
}

export interface EkstreHesap {
  bankaHesap: BankaHesap;
  ekstreGeldi: boolean;
  geldiTarihi?: string | null;
  ekstreIslendi: boolean;
  islenmeTarihi?: string | null;
  islenmeNotu?: string | null;
  notlar?: string | null;
}

export interface BankaTakipItem {
  taxpayer: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    taxNumber: string;
  };
  hesaplar: EkstreHesap[];
  genel: {
    ekstreGeldi: boolean;
    ekstreIslendi: boolean;
    islenmeNotu?: string | null;
    notlar?: string | null;
  } | null;
  ozet: {
    hesapSayisi: number;
    tumGeldi: boolean;
    tumIslendi: boolean;
    eksikGeldi: number;
    eksikIslendi: number;
  };
}

export interface BankaTakipResponse {
  donem: string;
  items: BankaTakipItem[];
}

export const bankaTakipApi = {
  list: (donem: string) =>
    api.get<BankaTakipResponse>('/banka-takip/list', { params: { donem } }).then((r) => r.data),
  hesaplar: (taxpayerId?: string) =>
    api.get<BankaHesap[]>('/banka-takip/hesaplar', { params: { taxpayerId } }).then((r) => r.data),
  createHesap: (body: {
    taxpayerId: string;
    bankaAdi: string;
    hesapNo?: string;
    iban?: string;
    sube?: string;
    paraBirimi?: string;
    aciklama?: string;
    sira?: number;
  }) => api.post<BankaHesap>('/banka-takip/hesaplar', body).then((r) => r.data),
  updateHesap: (
    id: string,
    body: Partial<{
      bankaAdi: string;
      hesapNo: string | null;
      iban: string | null;
      sube: string | null;
      paraBirimi: string;
      aciklama: string | null;
      aktif: boolean;
      sira: number;
    }>,
  ) => api.put<BankaHesap>(`/banka-takip/hesaplar/${id}`, body).then((r) => r.data),
  deleteHesap: (id: string) =>
    api.delete(`/banka-takip/hesaplar/${id}`).then((r) => r.data),
  upsertEkstre: (body: {
    taxpayerId: string;
    bankaHesapId?: string | null;
    donem: string;
    ekstreGeldi?: boolean;
    ekstreIslendi?: boolean;
    islenmeNotu?: string;
    notlar?: string;
  }) => api.post('/banka-takip/ekstre', body).then((r) => r.data),
  createEksikEkstreTasks: (donem: string, taxpayerIds?: string[]) =>
    api.post('/banka-takip/eksik-ekstre-gorevleri', { donem, taxpayerIds }).then((r) => r.data),
};
