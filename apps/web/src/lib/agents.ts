import { api } from './api';

export interface AgentEvent {
  id: string;
  agent: string;
  action?: string | null;
  status: string;
  message?: string | null;
  mukellef?: string | null;
  firma?: string | null;
  fisNo?: string | null;
  tutar?: string | null;
  hesapKodu?: string | null;
  kdv?: string | null;
  meta?: any;
  ts: string;
}

export interface AgentStatus {
  id: string;
  agent: string;
  running: boolean;
  hedefAy?: string | null;
  lastPing: string;
  meta?: any;
}

export interface AgentRule {
  id: string;
  mukellef: string;
  faaliyet?: string | null;
  defterTuru?: string | null;
  profile: any;
  updatedAt: string;
}

export interface AgentCommand {
  id: string;
  agent: string;
  action: string;
  payload: any;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  result?: any;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AgentDefinition {
  id: string;
  title: string;
  mode: 'background' | 'supervised' | 'approval_first' | 'service' | 'report';
  queue: string;
  stage: 'active' | 'alias_ready' | 'planned' | 'service' | 'report_only';
  modules: string[];
  actions?: string[];
  lucaJobTips?: string[];
  legacyRunner?: 'mihsap' | 'luca' | 'hgs';
  description: string;
}

const COMMAND_RUNTIME_AGENT: Record<string, 'mihsap' | 'luca'> = {
  mihsap: 'mihsap',
  'mihsap-supervised-agent': 'mihsap',
  'mihsap-fatura-isleme-agent': 'mihsap',
};

export function runtimeAgentForCommand(agent: string) {
  return COMMAND_RUNTIME_AGENT[agent];
}

export const agentsApi = {
  listEvents: (params?: { agent?: string; mukellef?: string; status?: string; limit?: number }) =>
    api.get<AgentEvent[]>('/agent/events', { params }).then((r) => r.data),
  stats: () => api.get('/agent/stats').then((r) => r.data),
  aiUsageStats: () => api.get('/agent/ai/usage-stats').then((r) => r.data),
  aiCreditTopup: (body: { amountUsd: number; note?: string }) =>
    api.post('/agent/ai/credit-topup', body).then((r) => r.data),
  aiCreditTopups: () => api.get('/agent/ai/credit-topups').then((r) => r.data),
  status: () => api.get<AgentStatus[]>('/agent/status').then((r) => r.data),
  registry: () => api.get<AgentDefinition[]>('/agent/registry').then((r) => r.data),
  rules: () => api.get<AgentRule[]>('/agent/rules').then((r) => r.data),
  getRule: (mukellef: string) =>
    api.get<AgentRule>(`/agent/rules/${encodeURIComponent(mukellef)}`).then((r) => r.data),
  upsertRule: (mukellef: string, body: { faaliyet?: string; defterTuru?: string; profile: any }) =>
    api
      .put<AgentRule>(`/agent/rules/${encodeURIComponent(mukellef)}`, body)
      .then((r) => r.data),
  deleteRule: (mukellef: string) =>
    api.delete(`/agent/rules/${encodeURIComponent(mukellef)}`).then((r) => r.data),

  // Komutlar
  // v1.36.61: Otomatik olarak current PC'nin deviceId'sini payload.targetDeviceId'ye ekler.
  // Böylece komut hangi tarayıcıdan gönderildiyse o PC'deki agent alır.
  // Eğer extension yüklü değilse (deviceId yoksa) targetDeviceId boş kalır → eski davranış (any agent).
  createCommand: async (body: { agent: string; action: string; payload: any }) => {
    const bridge =
      typeof window !== 'undefined' ? (window as any).__morenAutoAgent : null;
    const runtimeAgent = runtimeAgentForCommand(body.agent);
    if (bridge?.openAgent && runtimeAgent) {
      try {
        await bridge.openAgent(runtimeAgent);
      } catch {
        // Extension yoksa veya tarayici izin vermezse komut yine kuyruga yazilir.
      }
    }
    const deviceId =
      typeof window !== 'undefined' && (window as any).__morenAutoAgent?.deviceId;
    const enrichedPayload =
      deviceId && body.payload && typeof body.payload === 'object'
        ? { ...body.payload, targetDeviceId: deviceId }
        : body.payload;
    return api
      .post<AgentCommand>('/agent/commands', { ...body, payload: enrichedPayload })
      .then((r) => r.data);
  },
  listCommands: (params?: { agent?: string; status?: string; limit?: number }) =>
    api.get<AgentCommand[]>('/agent/commands', { params }).then((r) => r.data),
  cancelCommand: (id: string) =>
    api.post<AgentCommand>('/agent/commands/' + id + '/cancel').then((r) => r.data),

  // MIHSAP entegrasyonu
  mihsapSession: () => api.get('/agent/mihsap/session').then((r) => r.data),
  mihsapFetch: (body: {
    mukellefId: string;
    mukellefMihsapId: string;
    donem: string;
    faturaTuru?: 'ALIS' | 'SATIS';
    forceRefresh?: boolean;
  }) => api.post('/agent/mihsap/fetch', body).then((r) => r.data),
  mihsapInvoices: (params?: {
    mukellefId?: string;
    donem?: string;
    faturaTuru?: string;
    limit?: number;
  }) => api.get('/agent/mihsap/invoices', { params }).then((r) => r.data),
  mihsapDownloadUrl: (id: string) =>
    api.get(`/agent/mihsap/invoices/${id}/download`).then((r) => r.data),
  mihsapJobs: (limit?: number) =>
    api.get('/agent/mihsap/jobs', { params: { limit } }).then((r) => r.data),
};

// Ajanlar sabit listesi (local script eşlemesi)
export const AGENTS = [
  { id: 'luca',     ad: 'Luca E-Arşiv İndirici',       desc: "Luca'dan inen ZIP'leri Drive'a taşır, açar, XML'leri siler",                     aktif: true  },
  { id: 'mihsap',   ad: 'Mihsap Fatura İşleyici',       desc: 'Mihsap\'ta mükellef x ay için faturaları otomatik onaylar / atlar',             aktif: true  },
  { id: 'tebligat', ad: 'Tebligat Özet Ajanı',          desc: "Hattat'tan günlük tebligat/rapor özeti çıkarır",                                 aktif: false },
  { id: 'kdv',      ad: 'KDV Beyanname Ön-Hazırlık',    desc: 'Ay sonu KDV1/KDV2 taslaklarını hazırlar',                                        aktif: false },
  { id: 'edefter',  ad: 'E-Defter Kontrol',             desc: 'E-Defter berat durumlarını günlük kontrol eder',                                 aktif: false },
  { id: 'sgk',      ad: 'SGK Bildirge Takip',           desc: 'İşe giriş/çıkış ve MUHSGK durumlarını takip eder',                               aktif: false },
  { id: 'gecici',   ad: 'Geçici Vergi Hazırlama',       desc: 'Çeyreklik geçici vergi beyannamelerini hazırlar',                                aktif: false },
  { id: 'alacak',   ad: 'Cari Alacak Raporlayıcı',      desc: 'Haftalık vadeli alacak raporu ve yaşlandırma',                                   aktif: false },
] as const;
