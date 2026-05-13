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
        minHeight: 920,
        boxShadow: 'inset 0 0 100px rgba(0,0,0,0.6)',
      }}
    >
      {/* ARKA PLAN — pencere + duvar (üst 1/3'te yoğunlaştı, karakterlerin üstünde kalır) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1200 920"
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

        {/* Duvar — sadece üst 1/3 (y 0-300) */}
        <rect x="0" y="0" width="1200" height="300" fill="url(#wall)" />
        {/* Zemin başlar y=300'den, viewBox sonuna kadar */}
        <path d="M 0 300 L 1200 300 L 1300 920 L -100 920 Z" fill="url(#floor)" />

        {/* Duvar-zemin geçişi süpürgelik */}
        <line x1="0" y1="300" x2="1200" y2="300" stroke="#3a2820" strokeWidth="2" />

        {/* Zemin ızgarası — perspektif */}
        {Array.from({ length: 8 }).map((_, i) => {
          const y = 320 + i * 70;
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

        {/* PENCERE — sol üst, küçük ve net (sadece üst 1/3 wall area'da) */}
        <g>
          <rect x="60" y="40" width="280" height="210" fill="url(#window-night)" rx="3" />
          <rect x="60" y="40" width="280" height="210" fill="none" stroke="#2a1f15" strokeWidth="5" rx="3" />
          {/* Pencere çıtaları */}
          <line x1="200" y1="40" x2="200" y2="250" stroke="#2a1f15" strokeWidth="2.5" />
          <line x1="60" y1="145" x2="340" y2="145" stroke="#2a1f15" strokeWidth="2.5" />

          {/* Ay — sağ üst */}
          <circle cx="290" cy="90" r="18" fill="#f5f5dc" opacity="0.92" />
          <circle cx="287" cy="86" r="15" fill="#fafaf2" opacity="0.98" />
          <circle cx="293" cy="83" r="2" fill="rgba(0,0,0,0.08)" />

          {/* Yıldızlar */}
          {Array.from({ length: 12 }).map((_, i) => (
            <circle
              key={i}
              cx={75 + (i * 23) % 250}
              cy={55 + (i * 11) % 80}
              r={i % 3 === 0 ? '1' : '0.6'}
              fill="#ffffff"
              opacity={0.4 + (i * 0.05) % 0.5}
            />
          ))}

          {/* Şehir silueti — pencerenin alt yarısında */}
          <g transform="translate(60, 165)">
            <rect x="0" y="35" width="22" height="55" fill="#0a0a18" />
            <rect x="22" y="22" width="28" height="68" fill="#08081a" />
            <rect x="50" y="40" width="19" height="50" fill="#0a0a18" />
            <rect x="69" y="12" width="30" height="78" fill="#08081a" />
            <rect x="99" y="28" width="24" height="62" fill="#0a0a18" />
            <rect x="123" y="18" width="34" height="72" fill="#08081a" />
            <rect x="157" y="38" width="22" height="52" fill="#0a0a18" />
            <rect x="179" y="22" width="20" height="68" fill="#08081a" />
            <rect x="199" y="32" width="26" height="58" fill="#0a0a18" />
            <rect x="225" y="15" width="29" height="75" fill="#08081a" />
            <rect x="254" y="30" width="21" height="60" fill="#0a0a18" />
            {/* Pencere ışıkları */}
            {Array.from({ length: 50 }).map((_, i) => (
              <rect
                key={i}
                x={2 + (i * 17) % 273}
                y={18 + (i * 7) % 65}
                width="1.5"
                height="2"
                fill={i % 2 === 0 ? '#fbbf24' : '#fcd34d'}
                opacity={0.5 + (i * 0.07) % 0.5}
              />
            ))}
          </g>
        </g>

        {/* MOREN LOGO — duvarda, ortada, üstte (karakterler önünde değil) */}
        <g transform="translate(420, 60)">
          <rect x="0" y="0" width="360" height="160" fill="rgba(212,184,118,0.03)" stroke="rgba(212,184,118,0.15)" strokeWidth="1" rx="4" />
          <text x="180" y="65" fontFamily="Fraunces, serif" fontSize="48" fill="#d4b876" letterSpacing="8" fontWeight="700" textAnchor="middle">
            MOREN
          </text>
          <text x="180" y="95" fontFamily="Plus Jakarta Sans" fontSize="12" fill="rgba(212,184,118,0.5)" letterSpacing="6" textAnchor="middle">
            MALI MÜŞAVİRLİK
          </text>
          <line x1="60" y1="115" x2="300" y2="115" stroke="rgba(212,184,118,0.25)" strokeWidth="1" />
          <text x="180" y="138" fontFamily="Plus Jakarta Sans" fontSize="9" fill="rgba(212,184,118,0.35)" letterSpacing="4" textAnchor="middle">
            EST. 2026 · OFİS
          </text>
        </g>

        {/* SMMM Diploma — sağ üst köşede */}
        <g transform="translate(840, 60)">
          <rect x="0" y="0" width="130" height="100" fill="#2a1f15" stroke="#3a2820" strokeWidth="3" rx="2" />
          <rect x="7" y="7" width="116" height="86" fill="#1a1218" />
          <rect x="16" y="14" width="98" height="3" fill="#d4b876" opacity="0.7" />
          <rect x="22" y="24" width="86" height="1.5" fill="rgba(212,184,118,0.4)" />
          <rect x="22" y="29" width="72" height="1.5" fill="rgba(212,184,118,0.3)" />
          <rect x="22" y="34" width="80" height="1.5" fill="rgba(212,184,118,0.3)" />
          <rect x="35" y="56" width="60" height="24" fill="rgba(212,184,118,0.08)" />
          <text x="65" y="72" fontFamily="Fraunces, serif" fontSize="11" textAnchor="middle" fill="#d4b876" letterSpacing="3" fontWeight="700">SMMM</text>
        </g>

        {/* Saat — sağ üst */}
        <g transform="translate(1010, 80)">
          <circle cx="35" cy="35" r="32" fill="#1a1218" stroke="#3a2820" strokeWidth="3" />
          <circle cx="35" cy="35" r="2" fill="#d4b876" />
          <line x1="35" y1="35" x2="35" y2="15" stroke="#d4b876" strokeWidth="2" strokeLinecap="round" />
          <line x1="35" y1="35" x2="50" y2="40" stroke="rgba(212,184,118,0.8)" strokeWidth="1.5" strokeLinecap="round" />
          {[0, 3, 6, 9].map((i) => (
            <circle
              key={i}
              cx={35 + Math.cos((i * Math.PI) / 6 - Math.PI / 2) * 26}
              cy={35 + Math.sin((i * Math.PI) / 6 - Math.PI / 2) * 26}
              r="1.5"
              fill="rgba(212,184,118,0.7)"
            />
          ))}
        </g>

        {/* TAVAN AYDINLATMASI — sıcak sarı ışık halkaları */}
        <ellipse cx="300" cy="0" rx="240" ry="50" fill="url(#light-warm)" />
        <ellipse cx="900" cy="0" rx="240" ry="50" fill="url(#light-warm)" />

        {/* KAHVE MAKİNESİ — sağ alt köşede zeminde */}
        <g transform="translate(1080, 540)">
          <rect x="0" y="0" width="60" height="80" rx="3" fill="#1a1a1a" />
          <rect x="3" y="5" width="54" height="20" rx="1" fill="#2a2a2a" />
          <rect x="6" y="9" width="18" height="2" fill="#22c55e" />
          <rect x="20" y="50" width="20" height="20" rx="2" fill="#0a0a0a" />
          <ellipse cx="30" cy="60" rx="6" ry="2" fill="#3a2410" />
          <rect x="5" y="72" width="50" height="4" fill="#2a2a2a" />
        </g>

        {/* SAKSI BİTKİ — sol alt köşe */}
        <g transform="translate(20, 700)">
          <ellipse cx="35" cy="60" rx="32" ry="9" fill="rgba(0,0,0,0.45)" />
          <path d="M 10 50 Q 10 30 35 28 Q 60 30 60 50 L 58 72 Q 58 78 52 78 L 18 78 Q 12 78 12 72 Z" fill="#7c2d12" />
          <path d="M 35 30 Q 18 8 6 -12 Q 18 4 22 26 Q 24 30 35 30" fill="#15803d" />
          <path d="M 35 30 Q 52 8 64 -12 Q 52 4 48 26 Q 46 30 35 30" fill="#16a34a" />
          <path d="M 35 30 Q 35 4 30 -22 Q 35 -2 37 22 Q 37 28 35 30" fill="#22c55e" />
        </g>

        {/* Üst bar — saat + ekip durumu */}
        <g transform="translate(1140, 40)">
          <text x="0" y="0" fontFamily="JetBrains Mono, monospace" fontSize="20" fill="rgba(250,250,249,0.65)" letterSpacing="3" textAnchor="end">
            {time}
          </text>
          <text x="0" y="22" fontFamily="Plus Jakarta Sans" fontSize="9" fill="rgba(212,184,118,0.65)" letterSpacing="3" textAnchor="end">
            7 AJAN ÇEVRİMİÇİ
          </text>
        </g>
      </svg>

      {/* MASALAR — 3 sıra × 3 kolon grid, izometrik
          Duvar dekorasyonları viewBox y=0-300'de yoğunlaştı.
          minHeight 920px, viewBox 0-920. Yani ~33% wall, ~67% floor.
          Grid pt-72 ile karakterlerin başları wall'a girmiyor. */}
      <div className="relative pt-72 pb-12 px-12" style={{ zIndex: 2 }}>
        {rows.map((row) => (
          <div
            key={row}
            className="grid mb-8"
            style={{
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 24,
              // İzometrik perspektif — arka sıra küçük, ön sıra büyük
              transform: `scale(${0.75 + row * 0.08})`,
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
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(10,6,18,0.85) 100%)',
        }}
      />
    </div>
  );
}
