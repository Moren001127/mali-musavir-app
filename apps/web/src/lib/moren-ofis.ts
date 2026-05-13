import { api } from './api';

export type AgentId = 'arda' | 'nevra' | 'cem' | 'volkan' | 'defne' | 'kayra';

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

export interface OfisMessage {
  agent: AgentId | 'user';
  content: string;
  ts: string;
  durationMs?: number;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
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
};
