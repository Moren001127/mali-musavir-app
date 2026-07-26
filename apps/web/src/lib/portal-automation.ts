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
    tebligatErrors?: Array<{ taxpayerId: string; name: string; taxNumber: string | null; reason: string | null }>;
    sgkTotal?: number;
    sgkErrorCount?: number;
    sgkErrors?: Array<{ taxpayerId: string; name: string; taxNumber: string | null; reason: string | null }>;
  };
  credentials: {
    eBeyannameReady: boolean;
    eTebligatTaxpayerCount: number;
    sgkTaxpayerCount: number;
    byProvider: Record<PortalProvider, { total: number; active: number }>;
  };
  latestJobs: PortalJob[];
  latestDocuments: PortalDocument[];
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
