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

export interface OfisMessage {
  agent: AgentId | 'user';
  content: string;
  ts: string;
  durationMs?: number;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  toolCalls?: OfisToolCall[];
}

export interface OfisChatResponse {
  conversationId: string;
  messages: OfisMessage[];
  active: AgentId[];
  totalCostUsd: number;
}

export interface OfisConversationSummary {
  id: string;
  title: string;
  lastActivityAt: string;
  messageCount: number;
}

export const ofisApi = {
  team: () => api.get<OfisAgent[]>('/moren-ofis/team').then((r) => r.data),
  conversations: () => api.get<OfisConversationSummary[]>('/moren-ofis/conversations').then((r) => r.data),
  getConversation: (id: string) =>
    api.get(`/moren-ofis/conversations/${id}`).then((r) => r.data as { messages: OfisMessage[] }),
  chat: (text: string, conversationId?: string) =>
    api.post<OfisChatResponse>('/moren-ofis/chat', { text, conversationId }).then((r) => r.data),

  // DENİZ — proposals & patrol
  proposals: (status?: string) =>
    api.get<OfisProposal[]>('/moren-ofis/proposals', { params: status ? { status } : {} }).then((r) => r.data),
  updateProposalStatus: (id: string, status: string) =>
    api.patch(`/moren-ofis/proposals/${id}/status`, { status }).then((r) => r.data),
  runPatrol: () => api.post('/moren-ofis/patrol/run').then((r) => r.data),

  // Hafıza
  facts: (subject?: string) =>
    api.get('/moren-ofis/memory/facts', { params: subject ? { subject } : {} }).then((r) => r.data),
  upsertFact: (body: { subject: string; predicate: string; object: string; importance?: number }) =>
    api.post('/moren-ofis/memory/facts', body).then((r) => r.data),
  deleteFact: (id: string) => api.delete(`/moren-ofis/memory/facts/${id}`).then((r) => r.data),
};
