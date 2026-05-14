'use client';

import { useState, useEffect } from 'react';
import type { AgentId, OfisAgent } from '@/lib/moren-ofis';
import { Desk } from './Desk';
import type { CharacterState } from './Character';

interface ActiveAgent {
  id: AgentId;
  state: CharacterState;
}

// 7 ajan — izometrik 3 sıra × 3 sütun grid (bazı slotlar boş, sahne dengesi için).
// Pencere/dekorasyon sol kolon, DENİZ ayrı "sistem odası" gibi sağda izole.
const POSITIONS: Record<AgentId, { row: number; col: number }> = {
  // Arka sıra — uzmanlar (uzaktan çalışan)
  nevra: { row: 0, col: 0 },   // arkada sol — vergi uzmanı
  cem: { row: 0, col: 2 },     // arkada sağ — denetçi
  // Orta sıra — operasyon merkezi
  arda: { row: 1, col: 1 },    // ortada — lider (merkez)
  volkan: { row: 1, col: 2 },  // orta sağ — bordro
  // Ön sıra — müşteri yüzü + teknik
  defne: { row: 2, col: 0 },   // önde sol — asistan (resepsiyon)
  kayra: { row: 2, col: 1 },   // önde orta — operatör
  deniz: { row: 2, col: 2 },   // önde sağ — yazılım uzmanı
};

export function Office({
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
      const now = new Date();
      setTime(now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    };
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  // İzometrik 3 sıra × 3 kolon grid (boş slotlar sahne dengesi için)
  const rows = [0, 1, 2];
  const cols = [0, 1, 2];
  const agentsByPosition: Record<string, AgentId> = {};
  for (const a of agents) {
    const pos = POSITIONS[a.id];
    if (pos) agentsByPosition[`${pos.row}-${pos.col}`] = a.id;
  }

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #0a0612 0%, #1a0e1f 40%, #221220 100%)',
        height: 'min(760px, calc(100vh - 176px))',
        minHeight: 520,
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.55)',
      }}
    >
      {/* ARKA PLAN — pencere + duvar (üst 1/3'te yoğunlaştı, karakterlerin üstünde kalır) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1200 640"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1224" />
            <stop offset="100%" stopColor="#221520" />
          </linearGradient>
          <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f1418" />
            <stop offset="100%" stopColor="#150d10" />
          </linearGradient>
          <linearGradient id="window-night" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0820" />
            <stop offset="50%" stopColor="#1a1430" />
            <stop offset="100%" stopColor="#0a0820" />
          </linearGradient>
          <radialGradient id="light-warm" cx="50%" cy="0%" r="50%">
            <stop offset="0%" stopColor="rgba(212,184,118,0.20)" />
            <stop offset="100%" stopColor="rgba(212,184,118,0)" />
          </radialGradient>
        </defs>

        {/* Duvar — üst 1/3 (y 0-200) */}
        <rect x="0" y="0" width="1200" height="200" fill="url(#wall)" />
        {/* Zemin */}
        <path d="M 0 200 L 1200 200 L 1300 640 L -100 640 Z" fill="url(#floor)" />
        <line x1="0" y1="200" x2="1200" y2="200" stroke="#3a2820" strokeWidth="2" />

        {/* Zemin ızgarası — perspektif */}
        {Array.from({ length: 6 }).map((_, i) => {
          const y = 220 + i * 60;
          return (
            <line
              key={i}
              x1={-50 - i * 20}
              y1={y}
              x2={1250 + i * 20}
              y2={y}
              stroke="rgba(255,255,255,0.025)"
              strokeWidth="1"
            />
          );
        })}

        {/* PENCERE — kompakt, sol üst */}
        <g>
          <rect x="50" y="30" width="200" height="140" fill="url(#window-night)" rx="3" />
          <rect x="50" y="30" width="200" height="140" fill="none" stroke="#2a1f15" strokeWidth="4" rx="3" />
          <line x1="150" y1="30" x2="150" y2="170" stroke="#2a1f15" strokeWidth="2" />
          <line x1="50" y1="100" x2="250" y2="100" stroke="#2a1f15" strokeWidth="2" />

          {/* Ay */}
          <circle cx="210" cy="65" r="13" fill="#f5f5dc" opacity="0.92" />
          <circle cx="208" cy="62" r="11" fill="#fafaf2" opacity="0.98" />

          {/* Yıldızlar */}
          {Array.from({ length: 8 }).map((_, i) => (
            <circle key={i} cx={65 + (i * 21) % 175} cy={40 + (i * 9) % 50} r={i % 3 === 0 ? '0.8' : '0.5'} fill="#ffffff" opacity={0.4 + (i * 0.05) % 0.5} />
          ))}

          {/* Şehir silueti */}
          <g transform="translate(50, 115)">
            <rect x="0" y="25" width="18" height="35" fill="#0a0a18" />
            <rect x="18" y="15" width="22" height="45" fill="#08081a" />
            <rect x="40" y="28" width="16" height="32" fill="#0a0a18" />
            <rect x="56" y="8" width="24" height="52" fill="#08081a" />
            <rect x="80" y="20" width="20" height="40" fill="#0a0a18" />
            <rect x="100" y="12" width="26" height="48" fill="#08081a" />
            <rect x="126" y="25" width="18" height="35" fill="#0a0a18" />
            <rect x="144" y="15" width="18" height="45" fill="#08081a" />
            <rect x="162" y="22" width="22" height="38" fill="#0a0a18" />
            <rect x="184" y="10" width="16" height="50" fill="#08081a" />
            {Array.from({ length: 30 }).map((_, i) => (
              <rect key={i} x={2 + (i * 13) % 195} y={14 + (i * 5) % 42} width="1.2" height="1.5" fill={i % 2 === 0 ? '#fbbf24' : '#fcd34d'} opacity={0.5 + (i * 0.07) % 0.5} />
            ))}
          </g>
        </g>

        {/* MOREN LOGO — merkez üst */}
        <g transform="translate(380, 35)">
          <rect x="0" y="0" width="280" height="110" fill="rgba(212,184,118,0.03)" stroke="rgba(212,184,118,0.15)" strokeWidth="1" rx="3" />
          <text x="140" y="48" fontFamily="Fraunces, serif" fontSize="36" fill="#d4b876" letterSpacing="6" fontWeight="700" textAnchor="middle">
            MOREN
          </text>
          <text x="140" y="68" fontFamily="Plus Jakarta Sans" fontSize="9" fill="rgba(212,184,118,0.5)" letterSpacing="5" textAnchor="middle">
            MALI MÜŞAVİRLİK
          </text>
          <line x1="50" y1="82" x2="230" y2="82" stroke="rgba(212,184,118,0.25)" strokeWidth="1" />
          <text x="140" y="98" fontFamily="Plus Jakarta Sans" fontSize="8" fill="rgba(212,184,118,0.35)" letterSpacing="3" textAnchor="middle">
            EST. 2026 · OFİS
          </text>
        </g>

        {/* SMMM Diploma — sağ üst */}
        <g transform="translate(770, 45)">
          <rect x="0" y="0" width="95" height="80" fill="#2a1f15" stroke="#3a2820" strokeWidth="2" rx="2" />
          <rect x="5" y="5" width="85" height="70" fill="#1a1218" />
          <rect x="12" y="12" width="71" height="2" fill="#d4b876" opacity="0.7" />
          <rect x="18" y="20" width="60" height="1" fill="rgba(212,184,118,0.4)" />
          <rect x="18" y="24" width="50" height="1" fill="rgba(212,184,118,0.3)" />
          <rect x="25" y="42" width="45" height="22" fill="rgba(212,184,118,0.08)" />
          <text x="47" y="56" fontFamily="Fraunces, serif" fontSize="10" textAnchor="middle" fill="#d4b876" letterSpacing="2" fontWeight="700">SMMM</text>
        </g>

        {/* Saat — sağ üst */}
        <g transform="translate(900, 55)">
          <circle cx="30" cy="30" r="28" fill="#1a1218" stroke="#3a2820" strokeWidth="2.5" />
          <circle cx="30" cy="30" r="1.5" fill="#d4b876" />
          <line x1="30" y1="30" x2="30" y2="14" stroke="#d4b876" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="30" y1="30" x2="42" y2="34" stroke="rgba(212,184,118,0.8)" strokeWidth="1.3" strokeLinecap="round" />
          {[0, 3, 6, 9].map((i) => (
            <circle key={i} cx={30 + Math.cos((i * Math.PI) / 6 - Math.PI / 2) * 22} cy={30 + Math.sin((i * Math.PI) / 6 - Math.PI / 2) * 22} r="1.2" fill="rgba(212,184,118,0.7)" />
          ))}
        </g>

        {/* Tavan aydınlatması */}
        <ellipse cx="300" cy="0" rx="200" ry="40" fill="url(#light-warm)" />
        <ellipse cx="900" cy="0" rx="200" ry="40" fill="url(#light-warm)" />

        {/* Kahve makinesi — sağ alt köşe */}
        <g transform="translate(1100, 480)">
          <rect x="0" y="0" width="48" height="65" rx="2" fill="#1a1a1a" />
          <rect x="3" y="4" width="42" height="15" rx="1" fill="#2a2a2a" />
          <rect x="5" y="7" width="14" height="2" fill="#22c55e" />
          <rect x="15" y="38" width="18" height="18" rx="2" fill="#0a0a0a" />
          <ellipse cx="24" cy="48" rx="5" ry="1.5" fill="#3a2410" />
        </g>

        {/* Saksı bitki — sol alt */}
        <g transform="translate(15, 510)">
          <ellipse cx="28" cy="50" rx="26" ry="7" fill="rgba(0,0,0,0.45)" />
          <path d="M 8 42 Q 8 25 28 23 Q 48 25 48 42 L 46 60 Q 46 65 41 65 L 15 65 Q 10 65 10 60 Z" fill="#7c2d12" />
          <path d="M 28 25 Q 13 5 4 -12 Q 14 2 18 22 Q 20 25 28 25" fill="#15803d" />
          <path d="M 28 25 Q 43 5 52 -12 Q 42 2 38 22 Q 36 25 28 25" fill="#16a34a" />
          <path d="M 28 25 Q 28 0 23 -20 Q 28 -3 30 18 Q 30 23 28 25" fill="#22c55e" />
        </g>

        {/* Saat + ekip durumu — sağ üst */}
        <g transform="translate(1170, 25)">
          <text x="0" y="0" fontFamily="JetBrains Mono, monospace" fontSize="18" fill="rgba(250,250,249,0.7)" letterSpacing="2" textAnchor="end">
            {time}
          </text>
          <text x="0" y="18" fontFamily="Plus Jakarta Sans" fontSize="8" fill="rgba(212,184,118,0.65)" letterSpacing="3" textAnchor="end">
            7 AJAN ONLİNE
          </text>
        </g>
      </svg>

      {/* MASALAR — 3 sıra × 3 kolon grid, daha sıkı düzen
          Duvar 0-200, zemin 200-640. Grid pt-24 sahneyi tek ekrana yaklaştırır. */}
      <div className="relative pt-24 pb-5 px-6" style={{ zIndex: 2 }}>
        {rows.map((row) => (
          <div
            key={row}
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 0,
              height: 132,
              // İzometrik perspektif — arka sıra küçük, ön sıra büyük
              transform: `scale(${0.55 + row * 0.05})`,
              transformOrigin: 'center top',
            }}
          >
            {cols.map((col) => {
              const aid = agentsByPosition[`${row}-${col}`];
              if (!aid) return <div key={col} />;
              const persona = agents.find((a) => a.id === aid);
              const active = activeAgents.find((a) => a.id === aid);
              const isSelected = selectedAgent === aid;
              return (
                <div
                  key={col}
                  className="relative flex justify-center"
                  style={{ filter: isSelected ? 'brightness(1.15)' : 'none' }}
                >
                  <Desk
                    agentId={aid}
                    state={active?.state || 'idle'}
                    active={!!active}
                    onClick={() => onAgentClick?.(aid)}
                    label={persona ? `${persona.displayName} · ${persona.role.split(' & ')[0]}` : aid.toUpperCase()}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Sahne overlay — alt karartma */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(10,6,18,0.85) 100%)',
        }}
      />
    </div>
  );
}
