'use client';

import type { DevAgent } from './team';

// Moren Ofis'in AgentStatCard'ı ile aynı estetik — sade, premium, koyu altın tonları.
// Karakter SVG'si yerine initials disc + role hattı.
export function DevAgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: DevAgent;
  selected?: boolean;
  onClick?: () => void;
}) {
  const accent = agent.accentColor;
  const bgGradient = `linear-gradient(135deg, ${accent}15, rgba(255,255,255,0.012))`;
  const border = `${accent}33`;
  const hoverBg = `${accent}10`;
  const hoverBorder = `${accent}55`;
  const initials = agent.displayName
    .replace(/[İI]/g, 'I')
    .slice(0, 2);

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
      {/* Üst hairline */}
      <span
        className="absolute top-0 left-4 right-4 h-px transition-opacity duration-300"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          opacity: selected ? 0.7 : 0.3,
        }}
      />

      {/* Üst: initials avatar + hazır rozeti */}
      <div className="flex items-center justify-between mb-3 relative">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${accent}99)`,
            border: `1px solid ${accent}66`,
            color: '#0f0d0b',
            fontFamily: 'Fraunces, serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {initials}
        </div>
        <span
          className="text-[10px] font-bold px-2 py-[3px] rounded-md flex items-center gap-1"
          style={{
            background: 'rgba(34,197,94,0.10)',
            color: '#86efac',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#22c55e' }}
          />
          HAZIR
        </span>
      </div>

      {/* İsim — büyük */}
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

      {/* Rol + tam isim */}
      <p
        className="text-[11px] uppercase font-semibold tracking-[.10em] mb-1"
        style={{ color: 'rgba(250,250,249,0.55)' }}
      >
        {agent.role.split('&')[0].split('/')[0].trim()}
      </p>
      <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
        {agent.fullName} · {agent.age} yaş
      </p>
    </div>
  );
}
