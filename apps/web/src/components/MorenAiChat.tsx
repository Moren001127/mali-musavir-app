'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Send, Mic, Paperclip } from 'lucide-react';

const GOLD = '#d4b876';

type Message = { role: 'ai' | 'user'; text: string; attachment?: string };

const SAMPLE_MESSAGES: Message[] = [
  { role: 'ai', text: 'Merhaba Muzaffer, nasıl yardımcı olabilirim?' },
  { role: 'user', text: "YORGUN NAKLİYAT'ın Mart KDV'si ne kadar çıkar" },
  { role: 'ai', text: 'YORGUN NAKLİYAT - Mart 2026:\n• İndirilecek KDV (191): **12.450 TL**\n• Hesaplanan KDV (391): **8.320 TL**\n• Devreden KDV: **4.130 TL**\n\nÖnceki aya göre %12 artış var. Yakıt alımı arttığı için normal.' },
  { role: 'user', text: 'Bu fatura hangi koda yazılır', attachment: 'foto_fatura.jpg' },
  { role: 'ai', text: "Görüntüye baktım. Bu ETİLER GIDA faturası (yemek), **770.01.030 - Mutfak ve Yemekhane Giderleri'ne** yazılmalı. KDV %10." },
];

function renderText(text: string) {
  // **bold** desteği
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
  const [messages, setMessages] = useState<Message[]>(SAMPLE_MESSAGES);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const content = (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-end" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        className="w-full max-w-[440px] h-full flex flex-col shadow-2xl animate-[slideIn_0.3s_cubic-bezier(0.4,0,0.2,1)]"
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
                Çevrimiçi · Claude Sonnet
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

        {/* BETA BANNER */}
        <div className="px-5 py-2.5 text-[11px] flex items-center gap-2" style={{ background: 'rgba(184,160,111,0.06)', borderBottom: '1px solid rgba(184,160,111,0.12)', color: GOLD }}>
          <Sparkles size={12} />
          <span className="font-medium">Önizleme — ilerleyen sürümde tam etkileşimli olacak</span>
        </div>

        {/* MESSAGES */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] px-4 py-3 rounded-2xl"
                style={{
                  background: m.role === 'user' ? `linear-gradient(135deg, ${GOLD}, #b8a06f)` : 'rgba(255,255,255,0.04)',
                  color: m.role === 'user' ? '#0f0d0b' : 'rgba(250,250,249,0.9)',
                  border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.06)',
                  borderBottomRightRadius: m.role === 'user' ? 4 : undefined,
                  borderBottomLeftRadius: m.role === 'ai' ? 4 : undefined,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.attachment && (
                  <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 text-[11.5px] font-semibold" style={{ borderBottom: `1px solid ${m.role === 'user' ? 'rgba(15,13,11,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
                    <Paperclip size={12} /> {m.attachment}
                  </div>
                )}
                {renderText(m.text)}
              </div>
            </div>
          ))}
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
                if (e.key === 'Enter' && input.trim()) {
                  setMessages((prev) => [
                    ...prev,
                    { role: 'user', text: input.trim() },
                    { role: 'ai', text: 'Şu anda önizleme modundayım — gerçek yanıtlar için AI entegrasyonu ileride aktifleşecek. Şimdilik örnek sorular deneyebilirsiniz.' },
                  ]);
                  setInput('');
                }
              }}
              placeholder="Sorunu yaz..."
              className="flex-1 bg-transparent outline-none text-[13.5px]"
              style={{ color: '#fafaf9' }}
            />
            <button type="button" className="w-7 h-7 rounded-full flex items-center justify-center transition-all" style={{ color: 'rgba(250,250,249,0.5)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = GOLD; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(250,250,249,0.5)'; }}
              title="Dosya ekle (yakında)">
              <Paperclip size={15} />
            </button>
            {input.trim() ? (
              <button
                type="button"
                onClick={() => {
                  if (!input.trim()) return;
                  setMessages((prev) => [
                    ...prev,
                    { role: 'user', text: input.trim() },
                    { role: 'ai', text: 'Şu anda önizleme modundayım — gerçek yanıtlar için AI entegrasyonu ileride aktifleşecek. Şimdilik örnek sorular deneyebilirsiniz.' },
                  ]);
                  setInput('');
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                title="Gönder"
              >
                <Send size={14} />
              </button>
            ) : (
              <button type="button" className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: 'rgba(250,250,249,0.5)' }} title="Sesli soru (yakında)">
                <Mic size={15} />
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
