'use client';

import { useState, useEffect } from 'react';
import type { AgentId, OfisAgent } from '@/lib/moren-ofis';
import { Desk } from './Desk';
import type { CharacterState } from './Character';

interface ActiveAgent {
  id: AgentId;
  state: CharacterState;
}

// 7 ajan için ofis pozisyonları — izometrik düzen.
// 4 sıra × 2 kolon. DENİZ önde solda "sistem odası" gibi izole.
const POSITIONS: Record<AgentId, { row: number; col: number }> = {
  nevra: { row: 0, col: 0 },   // arkada sol — sessiz uzman çalışma
  cem: { row: 0, col: 1 },     // arkada sağ — Nevra'nın yanı (denetim)
  arda: { row: 1, col: 0 },    // orta sol — lider, müşteri görür
  volkan: { row: 1, col: 1 },  // orta sağ — bordro, telefon ulaşılır
  defne: { row: 2, col: 0 },   // resepsiyonda — müşteri ilk kim görür
  kayra: { row: 2, col: 1 },   // teknik köşe — multi-screen alanı
  deniz: { row: 3, col: 1 },   // önde sağ — yazılım uzmanı, sistem kontrol
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

  // İzometrik 4 sıra × 2 kolon grid (DENİZ row 3'te)
  // Sıra 0 (arkada) -> Sıra 3 (önde), her sıra kendi y-offset'i
  const rows = [0, 1, 2, 3];
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
        minHeight: 760,
        boxShadow: 'inset 0 0 100px rgba(0,0,0,0.6)',
      }}
    >
      {/* ARKA PLAN — pencere + duvar */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1200 760"
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

        {/* Duvar */}
        <rect x="0" y="0" width="1200" height="500" fill="url(#wall)" />
        {/* Zemin */}
        <path d="M 0 500 L 1200 500 L 1300 760 L -100 760 Z" fill="url(#floor)" />

        {/* Zemin ızgarası — perspektif */}
        {Array.from({ length: 6 }).map((_, i) => {
          const y = 510 + i * 50;
          return (
            <line
              key={i}
              x1={-50 - i * 20}
              y1={y}
              x2={1250 + i * 20}
              y2={y}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="1"
            />
          );
        })}

        {/* PENCERE — sol arkada, gece şehir */}
        <g>
          <rect x="60" y="80" width="360" height="320" fill="url(#window-night)" rx="2" />
          {/* Pencere çerçevesi */}
          <rect x="60" y="80" width="360" height="320" fill="none" stroke="#3a2820" strokeWidth="4" rx="2" />
          <line x1="240" y1="80" x2="240" y2="400" stroke="#3a2820" strokeWidth="3" />
          <line x1="60" y1="240" x2="420" y2="240" stroke="#3a2820" strokeWidth="3" />

          {/* Şehir silueti (gece, ışıklı binalar) */}
          <g transform="translate(60, 280)">
            <rect x="0" y="60" width="40" height="60" fill="#0a0a18" />
            <rect x="40" y="40" width="50" height="80" fill="#0a0a18" />
            <rect x="90" y="70" width="35" height="50" fill="#0a0a18" />
            <rect x="125" y="20" width="55" height="100" fill="#0a0a18" />
            <rect x="180" y="50" width="45" height="70" fill="#0a0a18" />
            <rect x="225" y="30" width="60" height="90" fill="#0a0a18" />
            <rect x="285" y="65" width="40" height="55" fill="#0a0a18" />
            <rect x="325" y="45" width="35" height="75" fill="#0a0a18" />
            {/* Pencere ışıkları */}
            {Array.from({ length: 60 }).map((_, i) => (
              <rect
                key={i}
                x={5 + (i * 23) % 350}
                y={30 + (i * 17) % 80}
                width="2"
                height="3"
                fill={Math.random() > 0.5 ? '#fbbf24' : '#f59e0b'}
                opacity={0.5 + Math.random() * 0.5}
              />
            ))}
          </g>

          {/* Yıldız efekti */}
          {Array.from({ length: 12 }).map((_, i) => (
            <circle
              key={i}
              cx={70 + (i * 35) % 350}
              cy={100 + (i * 11) % 130}
              r="0.6"
              fill="#ffffff"
              opacity={0.4 + Math.random() * 0.5}
            />
          ))}

          {/* Ay */}
          <circle cx="320" cy="150" r="22" fill="#f5f5dc" opacity="0.85" />
          <circle cx="316" cy="146" r="18" fill="#fafaf2" opacity="0.95" />
        </g>

        {/* TAVAN AYDINLATMASI — sıcak sarı ışık halkaları */}
        <ellipse cx="300" cy="20" rx="200" ry="40" fill="url(#light-warm)" />
        <ellipse cx="900" cy="20" rx="200" ry="40" fill="url(#light-warm)" />

        {/* KAHVE MAKİNESİ — köşede */}
        <g transform="translate(1050, 380)">
          <rect x="0" y="0" width="60" height="80" rx="3" fill="#1a1a1a" />
          <rect x="3" y="5" width="54" height="20" rx="1" fill="#2a2a2a" />
          <rect x="6" y="9" width="18" height="2" fill="#22c55e" />
          <rect x="6" y="13" width="12" height="1" fill="#3a3a3a" />
          <rect x="20" y="50" width="20" height="20" rx="2" fill="#0a0a0a" />
          <ellipse cx="30" cy="60" rx="6" ry="2" fill="#3a2410" />
          {/* Kahve çekmece */}
          <rect x="5" y="72" width="50" height="4" fill="#2a2a2a" />
        </g>

        {/* SAKSI BİTKİ — büyük, köşe */}
        <g transform="translate(40, 460)">
          <ellipse cx="30" cy="60" rx="28" ry="8" fill="rgba(0,0,0,0.4)" />
          <path d="M 8 50 Q 8 30 30 28 Q 52 30 52 50 L 50 70 Q 50 75 45 75 L 15 75 Q 10 75 10 70 Z" fill="#7c2d12" />
          {/* Yapraklar */}
          <path d="M 30 30 Q 15 10 5 -10 Q 15 5 20 25 Q 22 30 30 30" fill="#15803d" />
          <path d="M 30 30 Q 45 10 55 -10 Q 45 5 40 25 Q 38 30 30 30" fill="#16a34a" />
          <path d="M 30 30 Q 30 5 25 -20 Q 30 0 32 20 Q 32 28 30 30" fill="#22c55e" />
          <path d="M 30 28 Q 20 18 15 8 Q 22 15 27 25" fill="#16a34a" opacity="0.8" />
        </g>

        {/* MOREN LOGOSU DUVARDA — sol arka */}
        <g transform="translate(490, 130)">
          <text x="0" y="0" fontFamily="Fraunces, serif" fontSize="36" fill="#d4b876" letterSpacing="6" fontWeight="700">
            MOREN
          </text>
          <text x="0" y="22" fontFamily="Plus Jakarta Sans" fontSize="9" fill="rgba(212,184,118,0.55)" letterSpacing="4">
            MALI MÜŞAVİRLİK OFİSİ
          </text>
        </g>

        {/* Üst bar — zaman + ekibe ait info */}
        <g transform="translate(900, 50)">
          <text x="0" y="0" fontFamily="JetBrains Mono, monospace" fontSize="20" fill="rgba(250,250,249,0.55)" letterSpacing="2">
            {time}
          </text>
          <text x="0" y="20" fontFamily="Plus Jakarta Sans" fontSize="10" fill="rgba(212,184,118,0.55)" letterSpacing="3">
            6 AJAN ÇEVRİMİÇİ
          </text>
        </g>
      </svg>

      {/* MASALAR — 3D pozisyon */}
      <div className="relative pt-20 pb-12 px-8" style={{ zIndex: 2 }}>
        {rows.map((row) => (
          <div
            key={row}
            className="flex justify-center gap-16 mb-6"
            style={{
              // İzometrik perspektif — her sıra yana sol kaymış, scale küçük
              transform: `translateX(${row * 40}px) scale(${0.85 + row * 0.075})`,
              transformOrigin: 'center',
            }}
          >
            {[0, 1].map((col) => {
              const aid = agentsByPosition[`${row}-${col}`];
              if (!aid) return <div key={col} style={{ width: 220 }} />;
              const persona = agents.find((a) => a.id === aid);
              const active = activeAgents.find((a) => a.id === aid);
              const isSelected = selectedAgent === aid;
              return (
                <div key={col} className="relative" style={{ filter: isSelected ? 'brightness(1.15)' : 'none' }}>
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
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(10,6,18,0.85) 100%)',
        }}
      />
    </div>
  );
}
