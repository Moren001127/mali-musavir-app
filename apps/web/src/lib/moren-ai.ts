import { api } from './api';

export interface ConversationSummary {
  id: string;
  title: string;
  taxpayerId: string | null;
  updatedAt: string;
  createdAt: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: any;
  toolResults?: any;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  createdAt: string;
}

export interface ChatResponse {
  conversationId: string;
  assistantMessage: string;
  toolUses: Array<{ name: string; input: any; result: any }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    durationMs: number;
    model: string;
  };
}

export async function listConversations(limit = 30): Promise<ConversationSummary[]> {
  const { data } = await api.get('/moren-ai/conversations', { params: { limit } });
  return data;
}

export async function getConversation(id: string) {
  const { data } = await api.get(`/moren-ai/conversations/${id}`);
  return data as (ConversationSummary & { messages: Message[] });
}

export async function deleteConversation(id: string) {
  await api.delete(`/moren-ai/conversations/${id}`);
}

export async function renameConversation(id: string, title: string) {
  await api.patch(`/moren-ai/conversations/${id}`, { title });
}

export async function chat(body: {
  conversationId?: string;
  message: string;
  taxpayerId?: string;
  currentPath?: string;
  voiceMode?: boolean;
  model?: string;
}): Promise<ChatResponse> {
  const { data } = await api.post('/moren-ai/chat', body);
  return data;
}

export async function getOfficeBrain(period?: string) {
  const { data } = await api.get('/moren-ai/office-brain', { params: { period } });
  return data;
}

export async function searchMemories(params?: { query?: string; taxpayerId?: string; scope?: string; limit?: number }) {
  const { data } = await api.get('/moren-ai/memories', { params });
  return data;
}

export async function saveMemory(body: {
  title: string;
  content: string;
  taxpayerId?: string;
  scope?: string;
  importance?: number;
  tags?: string[];
}) {
  const { data } = await api.post('/moren-ai/memories', body);
  return data;
}

export async function previewAgentCommand(body: { agent: string; action: string; payload: any }) {
  const { data } = await api.post('/moren-ai/agent-command/preview', body);
  return data;
}

export async function confirmAgentCommand(body: { agent: string; action: string; payload: any; confirmationText: string }) {
  const { data } = await api.post('/moren-ai/agent-command/confirm', body);
  return data;
}

export async function transcribe(audioBlob: Blob, mimetype: string): Promise<{ text: string; durationMs: number }> {
  const fd = new FormData();
  fd.append('audio', audioBlob, 'voice.' + (mimetype.includes('webm') ? 'webm' : 'mp3'));
  fd.append('language', 'tr');
  const { data } = await api.post('/moren-ai/voice/transcribe', fd);
  return data;
}

/** Metni mp3 olarak çevirip Blob döner (browser'da audio.play()) */
export async function synthesize(text: string, voice = 'nova', instructions?: string): Promise<Blob> {
  const { data } = await api.post('/moren-ai/voice/speak', { text, voice, instructions }, {
    responseType: 'blob',
  });
  return data;
}

export async function getRealtimeVoiceToken(): Promise<any> {
  const { data } = await api.get('/moren-ai/voice/realtime-token');
  return data;
}

export async function realtimePortalQuery(body: {
  conversationId?: string;
  taxpayerId?: string;
  question: string;
  currentPath?: string;
}): Promise<ChatResponse> {
  const { data } = await api.post('/moren-ai/voice/realtime-portal-query', body);
  return data;
}

export async function logRealtimeVoiceUsage(body: {
  conversationId?: string;
  taxpayerId?: string;
  model?: string;
  responseId?: string;
  usage: any;
  durationMs?: number;
}): Promise<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}> {
  const { data } = await api.post('/moren-ai/voice/realtime-usage', body);
  return data;
}
