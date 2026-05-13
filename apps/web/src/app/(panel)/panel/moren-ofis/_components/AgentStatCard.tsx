'use client';

import type { OfisAgent, AgentId } from '@/lib/moren-ofis';
import type { CharacterState } from './Character';
import { Character } from './Character';

// Dashboard'daki StatCard ile aynı estetik — sade, premium, koyu altın tonları.
// Her ajan kendi accent renginde ama formatı tutarlı.
export function AgentStatCard({
  agent,
  state,
  isActive,
  onClick,
  selected,
}: {
  agent: OfisAgent;
  state: CharacterState;
  isActive: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  const accent = agent.accentColor;
  const bgGradient = `linear-gradient(135deg, ${accent}15, rgba(255,255,255,0.012))`;
  const border = `${accent}33`;
  const hoverBg = `${accent}10`;
  const hoverBorder = `${accent}55`;

  return (
    <div
      onClick={onClick}
      className="group rounded-2xl p-4 transition-all duration-300 relative overflow-hidden cursor-pointer"
      style={{
        background: selected ? hoverBg : bgGradient,
        border: `1px solid ${selected ? hoverBorder : border}`,
        transform: selected ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: selected ? '0 10px 30px rgba(0,0,0,0.3)' : 'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = hoverBg;
        el.style.borderColor = hoverBorder;
        el.style.transform = 'translateY(-3px)';
        el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
      }}
      onMouseLeave={(e) => {
        if (selected) return;
        const el = e.currentTarget as HTMLElement;
        el.style.background = bgGradient;
        el.style.borderColor = border;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'none';
      }}
    >
      {/* Üstten ince hairline */}
      <span
        className="absolute top-0 left-4 right-4 h-px transition-opacity duration-300"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          opacity: isActive || selected ? 0.7 : 0.3,
        }}
      />

      {/* Aktivite glow — aktifken */}
      {isActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle at top right, ${accent}15 0%, transparent 60%)`,
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      )}

      {/* Üst: avatar + durum */}
      <div className="flex items-center justify-between mb-3 relative">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden"
          style={{
            background: 'rgba(15,13,11,0.4)',
            border: `1px solid ${border}`,
          }}
        >
          <div style={{ transform: 'scale(0.7) translateY(8px)' }}>
            <Character agentId={agent.id} state={state} size={50} />
          </div>
        </div>
        {/* Durum rozeti */}
        <span
          className="text-[10px] font-bold px-2 py-[3px] rounded-md flex items-center gap-1"
          style={{
            background: isActive ? `${accent}20` : 'rgba(34,197,94,0.10)',
            color: isActive ? accent : '#86efac',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: isActive ? accent : '#22c55e',
              animation: isActive ? 'pulse 1.5s infinite' : 'none',
            }}
          />
          {isActive
            ? state === 'talking'
              ? 'KONUŞUYOR'
              : state === 'thinking'
              ? 'DÜŞÜNÜYOR'
              : state === 'working'
              ? 'ÇALIŞIYOR'
              : 'AKTİF'
            : 'ONLINE'}
        </span>
      </div>

      {/* Orta: isim büyük */}
      <p
        className="leading-none tabular-nums mb-2"
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: accent,
        }}
      >
        {agent.displayName}
      </p>

      {/* Alt: rol + yaş */}
      <p
        className="text-[11px] uppercase font-semibold tracking-[.10em] mb-1"
        style={{ color: 'rgba(250,250,249,0.55)' }}
      >
        {agent.role.split(' & ')[0].split('/')[0].trim()}
      </p>
      <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
        {agent.fullName} · {agent.age} yaş
      </p>
    </div>
  );
}
