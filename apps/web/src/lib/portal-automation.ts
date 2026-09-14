import { api } from './api';

export type PortalProvider = 'GIB_EBEYANNAME' | 'GIB_IVD' | 'SGK_EBILDIRGE';

export type PortalJobType =
  | 'EBEYANNAME_DAILY_DOWNLOAD'
  | 'EBEYAN_NEW_DOWNLOAD'
  | 'E_TEBLIGAT_CHECK'
  | 'EARSIV_PORTAL_FETCH'
  | 'SGK_HIZMET_LISTESI'
  | 'SGK_TAHAKKUK'
  | 'SGK_ISE_GIRIS_CIKIS'
  | 'SGK_ISGOREMEZLIK';

export interface PortalCredentialPublic {
  id: string;
  provider: PortalProvider;
  ownerType: 'TENANT' | 'TAXPAYER';
  ownerId: string;
  taxpayerId: string | null;
  taxpayer?: {
    id: string;
    name?: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    taxNumber?: string | null;
  } | null;
  username: string | null;
  userCode: string | null;
  officeCode: string | null;
  workplaceCode: string | null;
  password?: string | null;
  secondaryPassword?: string | null;
  hasPassword: boolean;
  hasSecondaryPassword: boolean;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
  notes: string | null;
  validation?: {
    checked: boolean;
    ok: boolean;
    checkedAt?: string;
    error?: string;
  };
}

export interface PortalCredentialInsightItem {
  id: string;
  name: string;
  taxNumber: string | null;
  taxOffice: string | null;
  reason: string | null;
}

export interface PortalCredentialInsightCard {
  key: 'sgk_same' | 'gib_same' | 'gib_wrong' | 'sgk_wrong' | 'workplace_iz' | string;
  label: string;
  tone: 'blue' | 'amber' | string;
  count: number;
  taxpayers: PortalCredentialInsightItem[];
}

export interface PortalJob {
  id: string;
  tenantId: string;
  taxpayerId: string | null;
  jobType: PortalJobType;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  source: 'manual' | 'nightly' | 'agent';
  periodStart: string | null;
  periodEnd: string | null;
  donem: string | null;
  payload: any;
  result: any;
  errorMessage: string | null;
  recordCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  taxpayer?: {
    id: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    taxNumber?: string | null;
  } | null;
}

export interface PortalDocument {
  id: string;
  taxpayerId: string | null;
  belgeTuru: string;
  sourceProvider: PortalProvider;
  title: string;
  referenceNo: string | null;
  period: string | null;
  issuedAt: string | null;
  receivedAt: string | null;
  storageKey: string | null;
  documentId: string | null;
  viewedAt: string | null;
  createdAt: string;
  taxpayer?: {
    id: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    taxNumber?: string | null;
  } | null;
}

// ── Sayfalı belge listesi sözleşmesi (docs/sayfalama-sozlesme-2026-09-14.md §1-§3) ──
// Akıllı Bildirim gönderim bilgisi (bu belgeyi içeren gönderimler; en yeni önce).
export type IletimBilgisi = {
  channel: 'WHATSAPP' | 'EMAIL';
  status: 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED';
  sentAt: string | null;
  error: string | null;
  testMode: boolean;
};

// Gece sorgu hatasının sade hâli: tür + okunur metin + ham hata.
export type HataBilgisi = {
  tur: 'sifre' | 'guvenlik_kodu' | 'baglanti' | 'diger';
  metin: string;
  ham: string;
};

export type BelgeSatiriMukellef = {
  id: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  taxNumber: string | null;
};

// GET /portal-automation/documents/sayfa satırı (raw alanı YOK; gereken özet ozet.* içinde).
export type BelgeSatiri = {
  id: string;                       // birleşikte tahakkuk id'si (yoksa hizmet id'si)
  taxpayerId: string | null;
  taxpayer: BelgeSatiriMukellef | null;
  belgeTuru: string;
  title: string;
  referenceNo: string | null;
  period: string | null;
  issuedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  pdfVar: boolean;                  // storageKey dolu mu
  viewedAt: string | null;
  ozet: {
    kurumAciklama?: string | null;
    altKurum?: string | null;
    gonderimZamani?: string | null;   // ham metin (dd/MM/yyyy HH:mm:ss)
    tebligZamani?: string | null;
    okumaZamani?: string | null;
    tebligTarihi?: string | null;     // ISO
    tebligDurumu?: 'bekliyor' | 'yaklasiyor' | 'edildi' | null;
    kanunNo?: string | null;
    calisan?: number | null;
    tutar?: number | null;
    mahiyet?: string | null;
  };
  iletim: IletimBilgisi[];
  // yalnız birlesik=1 (SGK):
  hizmet?: { id: string; pdfVar: boolean; viewedAt: string | null } | null;
  tahakkuk?: { id: string; pdfVar: boolean; viewedAt: string | null; tutar: number | null } | null;
};

export type BelgeSayfaYaniti = {
  rows: BelgeSatiri[];
  total: number;
  page: number;
  pageSize: number;
};

// GET /portal-automation/documents/mukellefler satırı (belgesi olanlar ∪ ilgili şifresi olanlar).
export type BelgeMukellefi = {
  id: string;
  ad: string;
  taxNumber: string | null;
  belgeSayisi: number;
  sifreVar: boolean;
  sifreHatasi: string | null;
};

export type BelgeSayfaParametreleri = {
  belgeTuru: string;                // virgülle çoklu: 'E_TEBLIGAT' | 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI'
  taxpayerId?: string;
  search?: string;
  period?: string;                  // SGK 'YYYY/MM', tebligat 'YYYY-MM'
  durum?: string;                   // tebligat: teblig_yaklasan|teblig_edildi|goruntulenmemis ; SGK: tahakkuk|hizmet
  birlesik?: '1';
  page?: number;
  pageSize?: number;                // 25|50|100
  sirala?: 'yeni' | 'eski' | 'mukellef';
};

// Gece sorgusunda hata alan mükellef (summary.stats.tebligatErrors / sgkErrors).
export type PortalGeceHatasi = {
  taxpayerId: string;
  name: string;
  taxNumber: string | null;
  reason: string | null;
  hata?: HataBilgisi;
};

// 3 gece üst üste şifre hatası → gece sorgusundan düşen şifreler (summary.credentialsBlocked).
export type PortalSifreBekleyen = {
  provider: string;
  taxpayerId: string | null;
  ad: string;
  taxNumber: string | null;
  since: string | null;
  hata: HataBilgisi;
  geceSayisi: number;
};

export interface PortalSummary {
  nightly: {
    active: boolean;
    time: string;
    timezone: string;
    declarationRange: { start: string; end: string };
  };
  runner?: {
    enabled: boolean;
    includeNightly: boolean;
    deviceId: string;
    jobTypes: PortalJobType[];
  };
  stats: {
    activeJobs: number;
    failed24h: number;
    done24h: number;
    docs7d: number;
    tebligat7d: number;
    tebligatTotal?: number;
    tebligatErrorCount?: number;
    tebligatErrors?: PortalGeceHatasi[];
    tebligatBuHaftaTeblig?: number;   // receivedAt ∈ (şimdi, şimdi+7g]
    sgkTotal?: number;
    sgkErrorCount?: number;
    sgkErrors?: PortalGeceHatasi[];
  };
  credentials: {
    eBeyannameReady: boolean;
    eTebligatTaxpayerCount: number;
    sgkTaxpayerCount: number;
    byProvider: Record<PortalProvider, { total: number; active: number }>;
  };
  latestJobs: PortalJob[];
  latestDocuments: PortalDocument[];
  credentialsBlocked?: PortalSifreBekleyen[];
}

export const PORTAL_JOB_LABEL: Record<PortalJobType, string> = {
  EBEYANNAME_DAILY_DOWNLOAD: 'e-Beyanname indir',
  EBEYAN_NEW_DOWNLOAD: 'Yeni e-Beyan indir',
  E_TEBLIGAT_CHECK: 'e-Tebligat kontrol',
  EARSIV_PORTAL_FETCH: 'GIB e-Arsiv fatura cekimi',
  SGK_HIZMET_LISTESI: 'SGK hizmet listesi',
  SGK_TAHAKKUK: 'SGK tahakkuk',
  SGK_ISE_GIRIS_CIKIS: 'Ise giris/cikis',
  SGK_ISGOREMEZLIK: 'Isgoremezlik raporu',
};

export const PORTAL_PROVIDER_LABEL: Record<PortalProvider, string> = {
  GIB_EBEYANNAME: 'Mali musavir e-Beyanname',
  GIB_IVD: 'Mukellef Vergi Dairesi',
  SGK_EBILDIRGE: 'Mukellef SGK e-Bildirge',
};

export const portalAutomationApi = {
  summary: () => api.get<PortalSummary>('/portal-automation/summary').then((r) => r.data),
  credentials: () =>
    api.get<{ summary: PortalSummary['credentials']; rows: PortalCredentialPublic[] }>('/portal-automation/credentials')
      .then((r) => r.data),
  credentialInsights: () =>
    api.get<{ cards: PortalCredentialInsightCard[] }>('/portal-automation/credential-insights')
      .then((r) => r.data),
  saveCredential: (data: {
    provider: PortalProvider;
    taxpayerId?: string;
    username?: string;
    userCode?: string;
    officeCode?: string;
    workplaceCode?: string;
    password?: string;
    secondaryPassword?: string;
    notes?: string;
    isActive?: boolean;
    validate?: boolean;
  }) => api.post<PortalCredentialPublic>('/portal-automation/credentials', data).then((r) => r.data),
  jobs: (params?: { limit?: number; status?: string; jobType?: string }) =>
    api.get<PortalJob[]>('/portal-automation/jobs', { params }).then((r) => r.data),
  cancelJob: (id: string, reason?: string) =>
    api.post<PortalJob>(`/portal-automation/jobs/${id}/cancel`, { reason }).then((r) => r.data),
  documents: (params?: { limit?: number; taxpayerId?: string; belgeTuru?: string }) =>
    api.get<PortalDocument[]>('/portal-automation/documents', { params }).then((r) => r.data),
  // Sayfalı belge listesi (e-Tebligat / SGK). Eski `documents` mobil/masaüstü için aynen kalır.
  documentsSayfa: (params: BelgeSayfaParametreleri) =>
    api.get<BelgeSayfaYaniti>('/portal-automation/documents/sayfa', { params }).then((r) => r.data),
  // Süzgeç için mükellef listesi (belgesi olanlar ∪ ilgili şifresi olanlar), ada göre Türkçe sıralı.
  documentsMukellefler: (params: { belgeTuru: string }) =>
    api.get<{ rows: BelgeMukellefi[] }>('/portal-automation/documents/mukellefler', { params }).then((r) => r.data),
  documentViewUrl: (id: string) =>
    api.get<{ url: string; viewedAt?: string | null }>(`/portal-automation/documents/${id}/view`).then((r) => r.data),
  markDocumentsViewed: (data: { ids?: string[]; belgeTuru?: string; taxpayerId?: string }) =>
    api.post<{ updated: number; viewedAt: string }>('/portal-automation/documents/mark-viewed', data).then((r) => r.data),
  manualRun: (data: {
    scope?: 'all' | 'beyanname' | 'tebligat' | 'sgk';
    jobTypes?: PortalJobType[];
    taxpayerIds?: string[];
    dateFrom?: string;
    dateTo?: string;
    donem?: string;
    targetPeriod?: string;
    force?: boolean;
    validationOnly?: boolean;
  }) => api.post<{ created: PortalJob[]; skipped: Array<{ jobType: string; taxpayerId?: string; reason: string }>; message: string; runnerWake?: boolean }>(
    '/portal-automation/manual-run',
    data,
  ).then((r) => r.data),
  nightlyRunNow: () =>
    api.post<{ created: PortalJob[]; skipped: Array<{ jobType: string; taxpayerId?: string; reason: string }>; runnerWake?: boolean }>(
      '/portal-automation/nightly-run',
    ).then((r) => r.data),
};
