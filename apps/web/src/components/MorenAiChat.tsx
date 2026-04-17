'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Send, Mic, Paperclip, Loader2, MicOff } from 'lucide-react';
import { chat, transcribe, type Message as ApiMessage } from '@/lib/moren-ai';

const GOLD = '#d4b876';

type UiMessage = {
  role: 'ai' | 'user';
  text: string;
  attachment?: string;
  toolUses?: Array<{ name: string }>;
};

function renderText(text: string) {
  // **bold** desteği + satır atlama
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} style={{ color: '#fafaf9', fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

export function MorenAiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-[10px] transition-all relative overflow-hidden group"
      style={{
        background: 'linear-gradient(135deg, rgba(184,160,111,0.15), rgba(184,160,111,0.05))',
        border: '1px solid rgba(184,160,111,0.35)',
        color: GOLD,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(184,160,111,0.25), rgba(184,160,111,0.1))'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.55)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(184,160,111,0.15), rgba(184,160,111,0.05))'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.35)'; }}
      title="Moren AI ile sohbet"
    >
      <Sparkles size={15} className="group-hover:rotate-12 transition-transform" />
      Moren AI
      <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase px-1.5 py-[1px] rounded ml-0.5" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', letterSpacing: '0.08em' }}>
        <span className="w-1 h-1 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.8)' }} />
        Beta
      </span>
    </button>
  );
}

export function MorenAiFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-[80] w-14 h-14 rounded-full flex items-center justify-center transition-all group"
      style={{
        background: `linear-gradient(135deg, ${GOLD}, #8b7649)`,
        boxShadow: '0 10px 30px rgba(212,184,118,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)'; e.currentTarget.style.boxShadow = '0 14px 40px rgba(212,184,118,0.5), inset 0 1px 0 rgba(255,255,255,0.3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(212,184,118,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'; }}
      title="Moren AI ile sohbet"
      aria-label="Moren AI ile sohbet aç"
    >
      <Sparkles size={22} style={{ color: '#0f0d0b' }} className="group-hover:rotate-12 transition-transform" />
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full" style={{ background: '#22c55e', border: '2px solid #0a0906', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} />
    </button>
  );
}

export default function MorenAiChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([
    { role: 'ai', text: 'Merhaba 👋 Ben Moren AI. Mükellef verilerinden (mizan, bilanço, gelir tablosu, KDV, SGK, fatura) soru sorabilirsin. "Ali Tekstil\'in Q1 durumu nasıl?" gibi sorulara tool\'larla gerçek veriyle cevap veririm.' },
  ]);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Yeni mesaj geldikçe aşağı kaydır
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  if (!mounted || !open) return null;

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: UiMessage = { role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await chat({
        conversationId: conversationId || undefined,
        message: text,
      });
      if (!conversationId) setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: res.assistantMessage,
          toolUses: res.toolUses.map((t) => ({ name: t.name })),
        },
      ]);
    } catch (e: any) {
      const errMsg = e?.response?.data?.message || e?.message || 'Beklenmeyen hata';
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: `⚠️ Hata: ${errMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleMic = async () => {
    if (recording) {
      // Durdur
      const rec = mediaRecorderRef.current;
      if (!rec) return;
      rec.onstop = async () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        rec.stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        setRecording(false);
        try {
          setLoading(true);
          const { text } = await transcribe(blob, type);
          if (text) {
            await sendMessage(text);
          } else {
            setMessages((prev) => [...prev, { role: 'ai', text: '⚠️ Ses anlaşılmadı, tekrar deneyin.' }]);
          }
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: 'ai', text: `⚠️ Sesli giriş hatası: ${e?.response?.data?.message || e?.message}` }]);
        } finally {
          setLoading(false);
        }
      };
      rec.stop();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => chunksRef.current.push(e.data);
        rec.start();
        mediaRecorderRef.current = rec;
        setRecording(true);
      } catch {
        setMessages((prev) => [...prev, { role: 'ai', text: '⚠️ Mikrofona erişim reddedildi.' }]);
      }
    }
  };

  const content = (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        className="w-full max-w-[480px] h-full flex flex-col shadow-2xl animate-[slideIn_0.3s_cubic-bezier(0.4,0,0.2,1)]"
        style={{ background: '#0a0906', borderLeft: '1px solid rgba(184,160,111,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

        {/* HEADER */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(184,160,111,0.12)' }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, boxShadow: '0 4px 14px rgba(212,184,118,0.3)' }}>
              <Sparkles size={20} style={{ color: '#0f0d0b' }} />
            </div>
            <div>
              <p className="text-[15px] font-bold" style={{ color: '#fafaf9' }}>Moren AI</p>
              <p className="text-[11px] flex items-center gap-1.5" style={{ color: '#22c55e' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.8)' }} />
                {loading ? 'Düşünüyor...' : 'Çevrimiçi · Claude Sonnet'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center transition-all" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.6)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(250,250,249,0.6)'; }}
            aria-label="Kapat">
            <X size={18} />
          </button>
        </div>

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[88%] px-4 py-3 rounded-2xl"
                style={{
                  background: m.role === 'user' ? `linear-gradient(135deg, ${GOLD}, #b8a06f)` : 'rgba(255,255,255,0.04)',
                  color: m.role === 'user' ? '#0f0d0b' : 'rgba(250,250,249,0.9)',
                  border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.06)',
                  borderBottomRightRadius: m.role === 'user' ? 4 : undefined,
                  borderBottomLeftRadius: m.role === 'ai' ? 4 : undefined,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.toolUses && m.toolUses.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {m.toolUses.map((t, j) => (
                      <span
                        key={j}
                        className="text-[9.5px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 font-mono"
                        style={{ background: `${GOLD}22`, color: GOLD, border: `1px solid ${GOLD}44` }}
                      >
                        🔧 {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {m.attachment && (
                  <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 text-[11.5px] font-semibold" style={{ borderBottom: `1px solid ${m.role === 'user' ? 'rgba(15,13,11,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
                    <Paperclip size={12} /> {m.attachment}
                  </div>
                )}
                {renderText(m.text)}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="px-4 py-3 rounded-2xl flex items-center gap-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: GOLD, fontSize: 12.5 }}
              >
                <Loader2 size={13} className="animate-spin" />
                Veriler çekiliyor, yanıt hazırlanıyor...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* INPUT */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(184,160,111,0.12)' }}>
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-[24px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                  e.preventDefault();
                  sendMessage(input.trim());
                }
              }}
              placeholder={recording ? 'Dinleniyor...' : 'Sorunu yaz... (Enter: gönder)'}
              disabled={loading || recording}
              className="flex-1 bg-transparent outline-none text-[13.5px] disabled:opacity-60"
              style={{ color: '#fafaf9' }}
            />
            {input.trim() && !recording ? (
              <button
                type="button"
                onClick={() => sendMessage(input.trim())}
                disabled={loading}
                className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                title="Gönder"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleMic}
                disabled={loading && !recording}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-50"
                style={{
                  background: recording ? '#ef4444' : 'transparent',
                  color: recording ? '#fff' : 'rgba(250,250,249,0.6)',
                }}
                title={recording ? 'Durdur ve gönder' : 'Sesli soru'}
              >
                {recording ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            )}
          </div>
          <p className="text-[10.5px] mt-2 text-center" style={{ color: 'rgba(250,250,249,0.35)' }}>
            Moren AI beta sürümündedir. Mali işlemlerinizde profesyonel kontrolü atlamayın.
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
