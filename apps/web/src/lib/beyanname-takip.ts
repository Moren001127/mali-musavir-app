import { api } from './api';

export type Period = 'AYLIK' | 'UCAYLIK' | null;
export type BeyanTipi =
  | 'KURUMLAR' | 'GELIR' | 'KDV1' | 'KDV2'
  | 'DAMGA' | 'MUHSGK' | 'POSET' | 'BILDIRGE' | 'EDEFTER';

export type BeyanDurum = 'beklemede' | 'onaylandi' | 'hatali' | 'muaf';

export const BEYAN_ETIKETLER: Record<BeyanTipi, string> = {
  KURUMLAR: 'Kurumlar',
  GELIR:    'Gelir',
  KDV1:     'KDV1',
  KDV2:     'KDV2',
  DAMGA:    'Damga',
  MUHSGK:   'MUHSGK',
  POSET:    'Poşet',
  BILDIRGE: 'Bildirge',
  EDEFTER:  'E-Defter',
};

export interface TaxpayerBeyanConfig {
  incomeTaxType: 'KURUMLAR' | 'GELIR' | 'BASIT_USUL' | null;
  kdv1Period: Period;
  kdv2Enabled: boolean;
  muhtasarPeriod: Period;
  damgaEnabled: boolean;
  posetEnabled: boolean;
  sgkBildirgeEnabled: boolean;
  eDefterPeriod: Period;
  notes: string | null;
}

export interface ConfigRow {
  taxpayerId: string;
  ad: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  config: TaxpayerBeyanConfig;
}

export interface OzetRow {
  beyanTipi: BeyanTipi;
  toplam: number;
  onaylanan: number;
  bekleyen: number;
  hatali: number;
  muaf: number;
  kalan: number;
  yuzde: number;
}

export interface OzetResponse {
  donem: string;
  rows: OzetRow[];
}

export interface DetayRow {
  taxpayerId: string;
  ad: string;
  beyanlar: Array<{
    beyanTipi: BeyanTipi;
    durum: BeyanDurum;
    tahakkukTutari: number | null;
    onayTarihi: string | null;
  }>;
}

export const beyannameTakipApi = {
  listConfigs: () =>
    api.get<ConfigRow[]>('/beyanname-takip/configs').then((r) => r.data),

  upsertConfig: (taxpayerId: string, cfg: Partial<TaxpayerBeyanConfig>) =>
    api.put<TaxpayerBeyanConfig>(`/beyanname-takip/configs/${taxpayerId}`, cfg).then((r) => r.data),

  listOzet: (donem: string) =>
    api.get<OzetResponse>('/beyanname-takip/ozet', { params: { donem } }).then((r) => r.data),

  listDetay: (donem: string) =>
    api.get<DetayRow[]>('/beyanname-takip/detay', { params: { donem } }).then((r) => r.data),

  upsertDurum: (
    taxpayerId: string,
    beyanTipi: BeyanTipi,
    donem: string,
    data: { durum?: BeyanDurum; tahakkukTutari?: number | null; notlar?: string | null },
  ) =>
    api
      .put(`/beyanname-takip/durum/${taxpayerId}/${beyanTipi}/${donem}`, data)
      .then((r) => r.data),
};
