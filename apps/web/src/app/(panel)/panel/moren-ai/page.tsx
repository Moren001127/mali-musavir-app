'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Mic, MicOff, Volume2, VolumeX, Plus, Trash2,
  Loader2, Sparkles, MessageSquare, Wrench, DollarSign, Clock, Edit3,
} from 'lucide-react';
import {
  listConversations, getConversation, chat, deleteConversation, renameConversation,
  transcribe, synthesize,
  type ConversationSummary, type Message,
} from '@/lib/moren-ai';
import { api } from '@/lib/api';

const GOLD = '#d4b876';

type Taxpayer = {
  id: string; companyName?: string | null; firstName?: string | null; lastName?: string | null;
};
function taxpayerName(t: Taxpayer) {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isimsiz)';
}

// --------------------------------------------
// Mikrofon Kayıt Hook (MediaRecorder)
// --------------------------------------------
function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  async function start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.start();
      setMediaRecorder(rec);
      setRecording(true);
    } catch (e: any) {
      toast.error('Mikrofon izni reddedildi veya kullanılamıyor');
    }
  }

  async function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!mediaRecorder) return resolve(null);
      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        // Stream'ı kapat
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        setMediaRecorder(null);
        setRecording(false);
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  return { recording, start, stop };
}

// --------------------------------------------
// Ana Sayfa
// --------------------------------------------
export default function MorenAIPage() {
  const qc = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [selectedTaxpayerId, setSelectedTaxpayerId] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorder = useRecorder();

  // Mükellef listesi (opsiyonel kontekst)
  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-mini'],
    queryFn: async () => {
      const { data } = await api.get('/taxpayers', { params: { search: '' } });
      return Array.isArray(data) ? data : (data?.taxpayers || data?.data || []);
    },
  });

  // Konuşma listesi
  const { data: conversations = [], refetch: refetchConvs } = useQuery<ConversationSummary[]>({
    queryKey: ['ai-conversations'],
    queryFn: () => listConversations(30),
  });

  // Aktif konuşma detayı
  const { data: activeConv } = useQuery({
    queryKey: ['ai-conversation', activeConversationId],
    queryFn: () => activeConversationId ? getConversation(activeConversationId) : Promise.resolve(null),
    enabled: !!activeConversationId,
    refetchOnWindowFocus: false,
  });

  const messages: Message[] = activeConv?.messages || [];

  // Yeni mesaj gönder
  const sendMutation = useMutation({
    mutationFn: async ({ message, voiceMode: vm }: { message: string; voiceMode?: boolean }) => {
      return chat({
        conversationId: activeConversationId || undefined,
        message,
        taxpayerId: selectedTaxpayerId || undefined,
        voiceMode: vm,
      });
    },
    onSuccess: async (res) => {
      if (!activeConversationId) {
        setActiveConversationId(res.conversationId);
      }
      // Aktif konuşmayı yeniden çek
      await qc.invalidateQueries({ queryKey: ['ai-conversation', res.conversationId] });
      await qc.invalidateQueries({ queryKey: ['ai-conversations'] });

      // TTS açıksa sesi çal
      if (ttsEnabled && res.assistantMessage) {
        try {
          const blob = await synthesize(res.assistantMessage);
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.play().catch(() => {});
          }
        } catch (e: any) {
          toast.error('Sesli okuma başarısız: ' + (e?.response?.data?.message || e?.message));
        }
      }
    },
    onError: (e: any) => {
      toast.error('Mesaj gönderilemedi: ' + (e?.response?.data?.message || e?.message));
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      setActiveConversationId(null);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-conversations'] }),
  });

  // Scroll to bottom on new message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sendMutation.isPending]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendMutation.mutate({ message: text });
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setInput('');
  };

  const handleMic = async () => {
    if (recorder.recording) {
      const blob = await recorder.stop();
      if (!blob) return;
      try {
        toast.loading('Ses metne çevriliyor...', { id: 'stt' });
        const mimetype = blob.type || 'audio/webm';
        const { text } = await transcribe(blob, mimetype);
        toast.dismiss('stt');
        if (!text) {
          toast.error('Ses anlaşılmadı, tekrar deneyin.');
          return;
        }
        setInput(text);
        // Otomatik gönder + voice mode
        setTimeout(() => {
          sendMutation.mutate({ message: text, voiceMode: true });
          setInput('');
        }, 50);
      } catch (e: any) {
        toast.dismiss('stt');
        toast.error('STT hatası: ' + (e?.response?.data?.message || e?.message));
      }
    } else {
      recorder.start();
    }
  };

  const handleSelectConv = (id: string) => {
    setActiveConversationId(id);
    setInput('');
  };

  const handleRename = (conv: ConversationSummary) => {
    const newTitle = prompt('Yeni başlık:', conv.title);
    if (newTitle && newTitle.trim() && newTitle !== conv.title) {
      renameMut.mutate({ id: conv.id, title: newTitle.trim() });
    }
  };

  const totalCost = useMemo(() =>
    messages.reduce((s, m) => s + (m.costUsd || 0), 0),
    [messages],
  );

  return (
    <div className="flex h-full gap-4" style={{ height: 'calc(100vh - 120px)' }}>
      {/* === SOL: Konuşma Listesi === */}
      <aside
        className="w-72 flex flex-col rounded-xl overflow-hidden"
        style={{
          background: 'rgba(15,13,11,0.7)',
          border: '1px solid rgba(184,160,111,0.15)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="p-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(184,160,111,0.15)' }}>
          <Sparkles size={16} style={{ color: GOLD }} />
          <span className="flex-1 text-sm font-semibold" style={{ color: GOLD }}>Moren AI</span>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-lg hover:bg-white/5 transition"
            title="Yeni Konuşma"
          >
            <Plus size={16} style={{ color: GOLD }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-center py-8 opacity-50" style={{ color: '#fafaf9' }}>
              Henüz konuşma yok.<br />Bir soru sor, konuşma başlasın.
            </p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => handleSelectConv(c.id)}
              className="group relative px-3 py-2 rounded-lg cursor-pointer transition-all"
              style={{
                background: activeConversationId === c.id
                  ? `linear-gradient(90deg, ${GOLD}22, ${GOLD}08)`
                  : 'transparent',
                border: activeConversationId === c.id ? `1px solid ${GOLD}44` : '1px solid transparent',
              }}
            >
              <div className="flex items-start gap-2">
                <MessageSquare size={12} style={{ color: GOLD, opacity: 0.7, marginTop: 3 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: '#fafaf9' }}>
                    {c.title}
                  </p>
                  <p className="text-[10px] mt-0.5 opacity-50" style={{ color: '#fafaf9' }}>
                    {new Date(c.updatedAt).toLocaleDateString('tr-TR')} · ${c.totalCostUsd.toFixed(3)}
                  </p>
                </div>
              </div>
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={(e) => { e.stopPropagation(); handleRename(c); }}
                  className="p-1 rounded hover:bg-white/10"
                  title="Yeniden adlandır"
                >
                  <Edit3 size={10} style={{ color: '#fafaf9' }} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm('Silinsin mi?')) deleteMut.mutate(c.id); }}
                  className="p-1 rounded hover:bg-red-500/20"
                  title="Sil"
                >
                  <Trash2 size={10} style={{ color: '#ef4444' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* === SAĞ: Chat === */}
      <div
        className="flex-1 flex flex-col rounded-xl overflow-hidden"
        style={{
          background: 'rgba(15,13,11,0.7)',
          border: '1px solid rgba(184,160,111,0.15)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Üst Bar */}
        <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(184,160,111,0.15)' }}>
          <div className="flex-1">
            <h1 className="text-sm font-semibold" style={{ color: GOLD }}>
              {activeConv?.title || 'Yeni Konuşma'}
            </h1>
            {messages.length > 0 && (
              <p className="text-[10px] opacity-50 mt-0.5" style={{ color: '#fafaf9' }}>
                {messages.length} mesaj · Toplam maliyet: ${totalCost.toFixed(4)}
              </p>
            )}
          </div>

          {/* Mükellef Kontekst */}
          <select
            value={selectedTaxpayerId}
            onChange={(e) => setSelectedTaxpayerId(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg max-w-[200px]"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(184,160,111,0.2)',
              color: '#fafaf9',
            }}
          >
            <option value="">— Genel soru —</option>
            {taxpayers.map((t) => (
              <option key={t.id} value={t.id}>{taxpayerName(t)}</option>
            ))}
          </select>

          {/* TTS Toggle */}
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className="p-2 rounded-lg transition"
            style={{
              background: ttsEnabled ? `${GOLD}22` : 'transparent',
              border: `1px solid ${ttsEnabled ? GOLD : 'rgba(255,255,255,0.1)'}`,
            }}
            title={ttsEnabled ? 'Sesli okuma açık' : 'Sesli okuma kapalı'}
          >
            {ttsEnabled ? <Volume2 size={14} style={{ color: GOLD }} /> : <VolumeX size={14} style={{ color: '#fafaf9', opacity: 0.5 }} />}
          </button>
        </div>

        {/* Mesajlar */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !sendMutation.isPending && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ background: `linear-gradient(135deg, ${GOLD}44, ${GOLD}11)`, border: `1px solid ${GOLD}44` }}
              >
                <Sparkles size={24} style={{ color: GOLD }} />
              </div>
              <h2 className="text-lg font-semibold mb-2" style={{ color: '#fafaf9' }}>
                Merhaba, ben Moren AI 👋
              </h2>
              <p className="text-sm opacity-60 max-w-md mb-6" style={{ color: '#fafaf9' }}>
                Mükellef verilerinizi analiz eden, mali tabloları yorumlayan, vergi ve SGK mevzuatına hâkim mali müşavir asistanınızım.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl w-full">
                {[
                  'Ali Tekstil\'in Q1 gelir tablosunu yorumla',
                  'Bu ay hangi beyannameler verilecek?',
                  'X mükellefinin cari oranı sağlıklı mı?',
                  'Geçen yılla kıyasla satışlar ne kadar büyüdü?',
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(q); }}
                    className="text-left text-xs px-3 py-2.5 rounded-lg transition"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(184,160,111,0.15)',
                      color: '#fafaf9',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${GOLD}11`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {sendMutation.isPending && (
            <div className="flex items-center gap-2 text-xs" style={{ color: GOLD }}>
              <Loader2 size={14} className="animate-spin" />
              <span>Moren AI düşünüyor ve verileri çekiyor...</span>
            </div>
          )}
        </div>

        {/* Girdi */}
        <div className="p-3" style={{ borderTop: '1px solid rgba(184,160,111,0.15)' }}>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={recorder.recording ? 'Dinleniyor...' : 'Soru sor... (Enter ile gönder)'}
              disabled={sendMutation.isPending || recorder.recording}
              rows={1}
              className="flex-1 px-3 py-2 rounded-lg text-sm resize-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(184,160,111,0.2)',
                color: '#fafaf9',
                minHeight: 40,
                maxHeight: 160,
              }}
            />

            {/* Mikrofon */}
            <button
              onClick={handleMic}
              disabled={sendMutation.isPending}
              className="p-2.5 rounded-lg transition"
              style={{
                background: recorder.recording ? '#ef4444' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${recorder.recording ? '#ef4444' : 'rgba(184,160,111,0.2)'}`,
                color: recorder.recording ? '#fff' : GOLD,
              }}
              title={recorder.recording ? 'Durdur ve gönder' : 'Mikrofon'}
            >
              {recorder.recording ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            {/* Gönder */}
            <button
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              className="p-2.5 rounded-lg transition disabled:opacity-40"
              style={{
                background: `linear-gradient(135deg, ${GOLD}, #8b7649)`,
                color: '#0f0d0b',
              }}
            >
              {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="text-[9.5px] opacity-40 mt-2" style={{ color: '#fafaf9' }}>
            Enter: Gönder · Shift+Enter: Satır atla · Mikrofon: konuşarak sor (Türkçe)
          </p>
        </div>
      </div>

      {/* Gizli audio — TTS playback */}
      <audio ref={audioRef} />
    </div>
  );
}

// --------------------------------------------
// Mesaj Baloncuğu
// --------------------------------------------
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const toolCalls = (message.toolCalls as any[]) || [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${isUser ? '' : 'space-y-2'}`}
        style={{
          background: isUser
            ? `linear-gradient(135deg, ${GOLD}33, ${GOLD}11)`
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? `${GOLD}44` : 'rgba(184,160,111,0.15)'}`,
          color: '#fafaf9',
        }}
      >
        {/* Tool çağrı özeti */}
        {toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {toolCalls.map((t: any, i: number) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: `${GOLD}22`, color: GOLD, border: `1px solid ${GOLD}44` }}
                title={JSON.stringify(t.input, null, 2)}
              >
                <Wrench size={8} />
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* İçerik — Markdown render */}
        <div className="moren-md text-[13px] leading-[1.55]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>

        {/* Alt meta */}
        {!isUser && (message.inputTokens || message.outputTokens) ? (
          <div className="flex gap-3 text-[9px] opacity-40 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="flex items-center gap-1"><DollarSign size={9} />${message.costUsd?.toFixed(4) || '0.0000'}</span>
            <span>{message.inputTokens}+{message.outputTokens} token</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
