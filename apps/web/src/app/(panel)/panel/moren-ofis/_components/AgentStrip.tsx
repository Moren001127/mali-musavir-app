'use client';

import { useState, useEffect } from 'react';
import { Character, type CharacterState } from './Character';
import type { OfisAgent, AgentId } from '@/lib/moren-ofis';

interface ActiveAgent {
  id: AgentId;
  state: CharacterState;
}

/**
 * Üst şerit — 7 ajan kompakt halde, baş + isim + durum noktası.
 * WhatsApp/Slack grup chat header benzeri.
 * Aktif olan ajan'ın yüzü daha büyük + parıltı + isim altında "konuşuyor..." yazısı.
 */
export function AgentStrip({
  agents,
  activeAgents,
  onAgentClick,
  selectedAgent,
}: {
  agents: OfisAgent[];
  activeAgents: ActiveAgent[];
  onAgentClick?: (id: AgentId) => void;
  selectedAgent?: AgentId | null;
}) {
  const [time, setTime] = useState<string>('');
  useEffect(() => {
    const update = () => {
      setTime(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    };
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3 overflow-x-auto"
      style={{
        background: 'linear-gradient(135deg, rgba(15,11,21,0.95) 0%, rgba(26,14,31,0.95) 100%)',
        border: '1px solid rgba(212,184,118,0.15)',
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Sol — Moren logo + saat */}
      <div className="flex-shrink-0 flex flex-col gap-0.5 pr-3 border-r" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="text-base font-bold tracking-widest" style={{ color: '#d4b876', fontFamily: 'Fraunces, serif' }}>
          MOREN
        </div>
        <div className="text-[9px] tracking-[0.18em] font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {time} · 7 ONLINE
        </div>
      </div>

      {/* 7 ajan baş + isim */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {agents.map((a) => {
          const active = activeAgents.find((x) => x.id === a.id);
          const isActive = !!active;
          const isSelected = selectedAgent === a.id;
          return (
            <button
              key={a.id}
              onClick={() => onAgentClick?.(a.id)}
              className="flex flex-col items-center gap-1 px-2 py-1 rounded-lg transition-all flex-shrink-0"
              style={{
                background: isSelected
                  ? `${a.accentColor}22`
                  : isActive
                  ? `${a.accentColor}10`
                  : 'transparent',
                border: `1px solid ${isSelected ? a.accentColor : isActive ? `${a.accentColor}40` : 'transparent'}`,
              }}
            >
              {/* Karakter yüzü — sadece kafa, kompakt */}
              <div className="relative" style={{ width: 56, height: 56 }}>
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    background: isActive ? `radial-gradient(circle, ${a.accentColor}22 0%, transparent 70%)` : 'transparent',
                    borderRadius: '50%',
                  }}
                >
                  <div style={{ transform: 'scale(0.85) translateY(8px)' }}>
                    <Character
                      agentId={a.id}
                      state={active?.state || 'idle'}
                      size={50}
                    />
                  </div>
                </div>
                {/* Durum noktası */}
                <div
                  className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                  style={{
                    background: isActive ? a.accentColor : '#22c55e',
                    borderColor: '#0a0612',
                    animation: isActive ? 'pulse 1.5s infinite' : 'none',
                  }}
                />
              </div>
              <div className="text-[10px] font-bold leading-tight" style={{ color: isActive ? a.accentColor : 'rgba(250,250,249,0.7)' }}>
                {a.displayName}
              </div>
              <div className="text-[9px] leading-tight" style={{ color: isActive ? a.accentColor : 'rgba(250,250,249,0.35)' }}>
                {isActive
                  ? active?.state === 'talking'
                    ? '💬 konuşuyor'
                    : active?.state === 'thinking'
                    ? '💭 düşünüyor'
                    : active?.state === 'working'
                    ? '⚙️ çalışıyor'
                    : '○ hazır'
                  : a.role.split(' ')[0].slice(0, 10)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
