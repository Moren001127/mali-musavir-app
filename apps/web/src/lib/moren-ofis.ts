import { api } from './api';

export type AgentId = 'arda' | 'nevra' | 'cem' | 'volkan' | 'defne' | 'kayra' | 'deniz';

export interface OfisProposal {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: 'bug' | 'perf' | 'feature' | 'maintenance' | 'info';
  status: 'open' | 'in_progress' | 'done' | 'dismissed' | 'info';
  createdAt: string;
}

export interface OfisAgent {
  id: AgentId;
  displayName: string;
  fullName: string;
  age: number;
  role: string;
  expertise: string[];
  accentColor: string;
  model: string;
  personality: string;
}

export interface OfisToolCall {
  tool: string;
  input: any;
  ok: boolean;
  durationMs: number;
}

export type MizanGelirWorkflowPhase =
  | 'queued'
  | 'running'
  | 'waiting_mizan'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_clarification';

export interface MizanGelirWorkflowEvent {
  kind: 'mizan_gelir_workflow';
  phase: MizanGelirWorkflowPhase;
  jobId?: string;
  status?: string;
  taxpayerId?: string;
  taxpayerName?: string;
  donem?: string;
  donemTipi?: string;
  mizanId?: string;
  gelirTablosuId?: string;
  error?: string;
  logs?: string[];
  summary?: {
    netSatislar: number;
    brutSatisKari: number;
    faaliyetKari: number;
    donemNetKari: number;
  };
}

export type KdvControlWorkflowPhase =
  | 'queued'
  | 'running'
  | 'waiting_luca'
  | 'waiting_ocr'
  | 'completed'
  | 'failed'
  | 'needs_clarification';

export interface KdvControlWorkflowEvent {
  kind: 'kdv_control_workflow';
  phase: KdvControlWorkflowPhase;
  workflowId: string;
  taxpayerId?: string;
  taxpayerName?: string;
  period?: string;
  periodLabel?: string;
  types: string[];
  sessions: Array<{
    type: string;
    typeLabel: string;
    sessionId?: string;
    jobId?: string;
    jobStatus?: string;
    records: number;
    invoices: number;
    results: number;
    pendingOcr: number;
    matched: number;
    partialMatch: number;
    unmatched: number;
    needsReview: number;
    needsOcrConfirm: number;
    error?: string;
  }>;
  summary?: {
    totalRecords: number;
    totalInvoices: number;
    matched: number;
    partialMatch: number;
    unmatched: number;
    needsReview: number;
    needsOcrConfirm: number;
  };
  error?: string;
  logs?: string[];
}

export type OfisWorkflowEvent = MizanGelirWorkflowEvent | KdvControlWorkflowEvent;

export interface OfisMessage {
  agent: AgentId | 'user' | 'system';
  content: string;
  ts: string;
  durationMs?: number;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  toolCalls?: OfisToolCall[];
  workflow?: OfisWorkflowEvent;
}

export interface OfisChatResponse {
  conversationId: string;
  messages: OfisMessage[];
  active: AgentId[];
  totalCostUsd: number;
}

export interface MizanGelirWorkflowStatusResponse {
  workflow: OfisWorkflowEvent;
  job: any;
  messages: OfisMessage[];
}

export interface OfisConversationSummary {
  id: string;
  title: string;
  lastActivityAt: string;
  messageCount: number;
}

export interface AiCostSummary {
  total: number;
  today: number;
  week: number;
  month: number;
  msgCount: number;
  totalConv: number;
  byAgent: { agent: string; cost: number }[];
}

export const ofisApi = {
  team: () => api.get<OfisAgent[]>('/moren-ofis/team').then((r) => r.data),
  conversations: () => api.get<OfisConversationSummary[]>('/moren-ofis/conversations').then((r) => r.data),
  costSummary: () => api.get<AiCostSummary>('/moren-ofis/cost-summary').then((r) => r.data),
  toolAudit: (filters?: { tool?: string; from?: string; to?: string; onlyFailures?: boolean }) =>
    api.get<ToolAuditData>('/moren-ofis/tool-audit', { params: filters }).then((r) => r.data),
  getConversation: (id: string) =>
    api.get(`/moren-ofis/conversations/${id}`).then((r) => r.data as { messages: OfisMessage[] }),
  deleteConversation: (id: string) =>
    api.delete(`/moren-ofis/conversations/${id}`).then((r) => r.data),
  mizanGelirWorkflowStatus: (jobId: string, conversationId?: string) =>
    api
      .get<MizanGelirWorkflowStatusResponse>(`/moren-ofis/workflows/mizan-gelir/${jobId}`, {
        params: conversationId ? { conversationId } : undefined,
      })
      .then((r) => r.data),
  kdvControlWorkflowStatus: (workflowId: string, conversationId?: string) =>
    api
      .get<MizanGelirWorkflowStatusResponse>(`/moren-ofis/workflows/kdv-control/${workflowId}`, {
        params: conversationId ? { conversationId } : undefined,
      })
      .then((r) => r.data),
  chat: (text: string, conversationId?: string) =>
    api.post<OfisChatResponse>('/moren-ofis/chat', { text, conversationId }).then((r) => r.data),

  // Çoklu evrak — max 5 dosya, dosya başı 10MB
  chatWithFile: (files: File[], text: string, conversationId?: string) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (text) fd.append('text', text);
    if (conversationId) fd.append('conversationId', conversationId);
    return api.post<OfisChatResponse>('/moren-ofis/chat-with-file', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180_000, // çoklu OCR uzun sürebilir
    }).then((r) => r.data);
  },

  // FAZ 3 — Ajan mesajını hatırlatma önerisi olarak onay kuyruğuna düşür
  proposeReminder: (body: { agent: string; title: string; content: string; dueDate?: string; taxpayerHint?: string }) =>
    api.post('/moren-ofis/propose-reminder', body).then((r) => r.data),

  // DENİZ — proposals & patrol
  proposals: (status?: string) =>
    api.get<OfisProposal[]>('/moren-ofis/proposals', { params: status ? { status } : {} }).then((r) => r.data),
  updateProposalStatus: (id: string, status: string) =>
    api.patch(`/moren-ofis/proposals/${id}/status`, { status }).then((r) => r.data),
  runPatrol: () => api.post('/moren-ofis/patrol/run').then((r) => r.data),
  weeklyReport: () => api.get<WeeklyReport>('/moren-ofis/patrol/weekly-report').then((r) => r.data),

  // Hafıza
  facts: (subject?: string) =>
    api.get<MorenFact[]>('/moren-ofis/memory/facts', { params: subject ? { subject } : {} }).then((r) => r.data),
  upsertFact: (body: { subject: string; predicate: string; object: string; importance?: number }) =>
    api.post<MorenFact>('/moren-ofis/memory/facts', body).then((r) => r.data),
  deleteFact: (id: string) => api.delete(`/moren-ofis/memory/facts/${id}`).then((r) => r.data),
};

export interface ToolCallRecord {
  id: string;
  tenantId: string;
  caller: string;
  callerRef: string | null;
  agent: string | null;
  tool: string;
  input: any;
  ok: boolean;
  durationMs: number;
  resultSize: number | null;
  errorMsg: string | null;
  ts: string;
}

export interface ToolAuditData {
  recent: ToolCallRecord[];
  stats: { tool: string; count: number; avgMs: number; totalBytes: number }[];
  total: number;
  failures: number;
  failureRate: number;
  allTools: string[];
}

export interface WeeklyReport {
  periodFrom: string;
  periodTo: string;
  tenantName: string | null;
  interventions: any[];
  totalInterventions: number;
  proposals: { id: string; title: string; description: string; priority: string; category: string; status: string; createdAt: string }[];
  proposalsByStatus: Record<string, number>;
  aiCost: { total: number; week: number; msgCount: number };
  toolStats: { tool: string; count: number; failureRate: number }[];
  totalToolCalls: number;
  toolFailures: number;
  pendingActions: { total: number; approved: number; rejected: number; applied: number };
}

export interface MorenFact {
  id: string;
  tenantId: string;
  subject: string;
  predicate: string;
  object: string;
  importance: number;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
}
