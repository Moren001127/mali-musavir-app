'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { OfisAgent, OfisMessage, AgentId } from '@/lib/moren-ofis';

export function ChatPanel({
  agents,
  messages,
  sending,
  onSend,
}: {
  agents: OfisAgent[];
  messages: OfisMessage[];
  sending: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const submit = () => {
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{
        background: 'rgba(15,11,21,0.85)',
        border: '1px solid rgba(212,184,118,0.18)',
        backdropFilter: 'blur(10px)',
        height: 580,
      }}
    >
      {/* Başlık */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] uppercase tracking-[.16em] font-bold" style={{ color: '#d4b876' }}>
          Ekip Konuşması
        </div>
        <div className="text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {messages.length === 0 ? 'Ekibe bir şey sor — ARDA size yönlendirir' : `${messages.length} mesaj`}
        </div>
      </div>

      {/* Mesajlar */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <div className="text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz konuşma yok
            </div>
            <div className="text-xs" style={{ color: 'rgba(250,250,249,0.35)' }}>
              Örnek: "Petravet için Mayıs KDV durumu?"<br />
              "Asgari ücretliye AGİ ne kadar?"<br />
              "Mizan'da olağandışı bir şey var mı?"
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.agent === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className="px-3 py-2 rounded-lg max-w-[80%] text-sm"
                    style={{
                      background: 'rgba(212,184,118,0.12)',
                      border: '1px solid rgba(212,184,118,0.25)',
                      color: '#fafaf9',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }
            const persona = agentMap[m.agent as AgentId];
            return (
              <div key={i} className="flex flex-col gap-1 animate-fade-in-up" style={{
                animation: 'fade-in-up 0.4s ease-out',
              }}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: persona?.accentColor || '#888' }}
                  />
                  <span className="text-[11px] font-bold tracking-wider" style={{ color: persona?.accentColor || '#888' }}>
                    {persona?.displayName || m.agent.toUpperCase()}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {persona?.role}
                  </span>
                  {m.durationMs && (
                    <span className="text-[9px] ml-auto" style={{ color: 'rgba(250,250,249,0.3)' }}>
                      {(m.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div
                  className="px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${persona?.accentColor ? `${persona.accentColor}33` : 'rgba(255,255,255,0.06)'}`,
                    color: 'rgba(250,250,249,0.92)',
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        {sending && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ color: '#d4b876' }}>
            <Loader2 size={12} className="animate-spin" />
            Ekip çalışıyor...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ekibe talimat ver..."
            disabled={sending}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(212,184,118,0.25)',
              color: '#fafaf9',
            }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending}
            className="px-3 rounded-lg disabled:opacity-50"
            style={{
              background: '#d4b876',
              color: '#15110b',
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
