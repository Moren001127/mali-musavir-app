import { api, authorizedFetch, API_BASE } from './api';

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

export interface LucaSkill {
  id: string;
  ad: string;
  aciklama: string;
  adimSayisi: number;
  updatedAt: string;
}

/** Luca Operatörü — öğrenilen beceriler. */
export async function getLucaSkills(): Promise<LucaSkill[]> {
  const { data } = await api.get('/luca-operator/skills');
  return data;
}

/** Operatör tarayıcısı durumu + öğrenilen menü haritaları. */
export type LucaOperatorDurum = {
  tarayici: { acik: boolean; cihaz: string | null };
  haritalar: Array<{ baslik: string; basliksayisi: number }>;
  kurallar: Array<{ id: string; baslik: string; kural: string }>;
};

export async function deleteLucaRule(id: string): Promise<void> {
  await api.delete(`/luca-operator/kurallar/${id}`);
}

export async function getLucaOperatorDurum(): Promise<LucaOperatorDurum> {
  const { data } = await api.get('/luca-operator/durum');
  return data;
}

export async function deleteLucaSkill(id: string): Promise<void> {
  await api.delete(`/luca-operator/skills/${id}`);
}

/** Luca Operatörü akış olayı (SSE). */
export type LucaStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; model?: string; toolUses?: Array<{ name: string; args: any }>; durationMs?: number }
  | { type: 'error'; error: string };

/**
 * Luca Operatörü — Max + araçlı AKIŞLI sohbet (ücretsiz).
 * Cevap token token gelir; her olay onEvent ile bildirilir. Promise akış bitince çözülür.
 */
export async function lucaOperatorChatStream(
  body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; voiceMode?: boolean },
  onEvent: (e: LucaStreamEvent) => void,
): Promise<void> {
  const res = await authorizedFetch(`${API_BASE}/luca-operator/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', error: `Sunucu hatası (${res.status})` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as LucaStreamEvent);
      } catch {
        /* yoksay */
      }
    }
  }
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
