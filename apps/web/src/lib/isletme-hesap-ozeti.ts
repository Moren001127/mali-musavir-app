import { api } from './api';

export type IsletmeHesapOzeti = {
  id: string;
  tenantId: string;
  taxpayerId: string;
  yil: number;
  donem: number; // 1-4

  satisHasilati: number | string;
  digerGelir: number | string;
  malAlisi: number | string;

  donemBasiStok: number | string;
  kalanStok: number | string;
  toplamStok: number | string;
  satilanMalMaliyeti: number | string;
  netSatislar: number | string;

  donemIciGiderler: number | string;
  donemKari: number | string;

  gecmisYilZarari: number | string;
  gecVergiMatrahi: number | string;
  hesaplananGecVergi: number | string;
  oncekiOdenenGecVergi: number | string;
  odenecekGecVergi: number | string;

  not?: string | null;

  locked: boolean;
  lockedAt?: string | null;
  lockedBy?: string | null;
  lockNote?: string | null;

  createdAt: string;
  updatedAt: string;
  taxpayer?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    taxNumber?: string | null;
  } | null;
};

export type IhoYil = {
  yil: number;
  taxpayer: IsletmeHesapOzeti['taxpayer'];
  ceyrekler: (IsletmeHesapOzeti | null)[]; // [Q1, Q2, Q3, Q4]
};

export type IhoManuelPayload = {
  satisHasilati?: number;
  digerGelir?: number;
  malAlisi?: number;
  donemBasiStok?: number;
  kalanStok?: number;
  satilanMalMaliyeti?: number; // doğrudan girilebilir
  donemIciGiderler?: number;
  gecmisYilZarari?: number;
  oncekiOdenenGecVergi?: number;
  not?: string;
};

export const isletmeHesapOzetiApi = {
  list: (taxpayerId?: string, yil?: number) =>
    api
      .get('/isletme-hesap-ozeti', {
        params: { ...(taxpayerId ? { taxpayerId } : {}), ...(yil ? { yil } : {}) },
      })
      .then((r) => r.data as IsletmeHesapOzeti[]),

  getYil: (taxpayerId: string, yil: number) =>
    api.get(`/isletme-hesap-ozeti/yil/${taxpayerId}/${yil}`).then((r) => r.data as IhoYil),

  getOne: (taxpayerId: string, yil: number, donem: number) =>
    api
      .get(`/isletme-hesap-ozeti/${taxpayerId}/${yil}/${donem}`)
      .then((r) => r.data as IsletmeHesapOzeti),

  olustur: (data: { taxpayerId: string; yil: number; donem: number }) =>
    api.post('/isletme-hesap-ozeti/olustur', data).then((r) => r.data as IsletmeHesapOzeti),

  olusturYil: (data: { taxpayerId: string; yil: number }) =>
    api
      .post('/isletme-hesap-ozeti/olustur-yil', data)
      .then((r) => r.data as IsletmeHesapOzeti[]),

  updateManuel: (id: string, data: IhoManuelPayload) =>
    api
      .patch(`/isletme-hesap-ozeti/${id}/manuel`, data)
      .then((r) => r.data as IsletmeHesapOzeti),

  lock: (id: string, note?: string) =>
    api.patch(`/isletme-hesap-ozeti/${id}/lock`, { note }).then((r) => r.data),

  unlock: (id: string, reason: string) =>
    api.patch(`/isletme-hesap-ozeti/${id}/unlock`, { reason }).then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/isletme-hesap-ozeti/${id}`).then((r) => r.data),

  exportYil: (taxpayerId: string, yil: number) =>
    api
      .get(`/isletme-hesap-ozeti/export/${taxpayerId}/${yil}`, { responseType: 'arraybuffer' })
      .then((r) => r.data as ArrayBuffer),
};

export function fmtTRY(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
