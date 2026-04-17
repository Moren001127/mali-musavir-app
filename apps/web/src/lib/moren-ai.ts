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
  voiceMode?: boolean;
  model?: string;
}): Promise<ChatResponse> {
  const { data } = await api.post('/moren-ai/chat', body);
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
export async function synthesize(text: string, voice = 'nova'): Promise<Blob> {
  const { data } = await api.post('/moren-ai/voice/speak', { text, voice }, {
    responseType: 'blob',
  });
  return data;
}
