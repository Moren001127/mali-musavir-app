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

        {/* PENCERE — back wall'ın sol yarısı, geniş panoramik */}
        <g>
          <rect x="40" y="60" width="500" height="380" fill="url(#window-night)" rx="3" />
          {/* Pencere çerçevesi — modern alüminyum */}
          <rect x="40" y="60" width="500" height="380" fill="none" stroke="#2a1f15" strokeWidth="6" rx="3" />
          {/* Dikey çıtalar — 3'lü grid */}
          <line x1="206" y1="60" x2="206" y2="440" stroke="#2a1f15" strokeWidth="3" />
          <line x1="373" y1="60" x2="373" y2="440" stroke="#2a1f15" strokeWidth="3" />
          {/* Yatay çıta — orta */}
          <line x1="40" y1="250" x2="540" y2="250" stroke="#2a1f15" strokeWidth="3" />

          {/* Ay — sağ üst köşede */}
          <circle cx="450" cy="140" r="24" fill="#f5f5dc" opacity="0.92" />
          <circle cx="446" cy="135" r="20" fill="#fafaf2" opacity="0.98" />
          <circle cx="453" cy="132" r="3" fill="rgba(0,0,0,0.08)" />
          <circle cx="438" cy="148" r="2" fill="rgba(0,0,0,0.06)" />

          {/* Yıldızlar — pencerenin üst yarısında dağınık */}
          {Array.from({ length: 18 }).map((_, i) => (
            <circle
              key={i}
              cx={60 + (i * 29) % 470}
              cy={75 + (i * 13) % 160}
              r={i % 3 === 0 ? '1.2' : '0.7'}
              fill="#ffffff"
              opacity={0.35 + (i * 0.05) % 0.6}
            />
          ))}

          {/* Şehir silueti — pencerenin alt yarısında */}
          <g transform="translate(40, 320)">
            <rect x="0" y="55" width="38" height="85" fill="#0a0a18" />
            <rect x="38" y="35" width="48" height="105" fill="#08081a" />
            <rect x="86" y="65" width="33" height="75" fill="#0a0a18" />
            <rect x="119" y="20" width="52" height="120" fill="#08081a" />
            <rect x="171" y="45" width="42" height="95" fill="#0a0a18" />
            <rect x="213" y="30" width="58" height="110" fill="#08081a" />
            <rect x="271" y="60" width="38" height="80" fill="#0a0a18" />
            <rect x="309" y="40" width="34" height="100" fill="#08081a" />
            <rect x="343" y="55" width="44" height="85" fill="#0a0a18" />
            <rect x="387" y="25" width="50" height="115" fill="#08081a" />
            <rect x="437" y="50" width="36" height="90" fill="#0a0a18" />
            <rect x="473" y="35" width="27" height="105" fill="#08081a" />
            {/* Pencere ışıkları — binalarda */}
            {Array.from({ length: 80 }).map((_, i) => (
              <rect
                key={i}
                x={3 + (i * 19) % 495}
                y={32 + (i * 11) % 100}
                width="2"
                height="3"
                fill={i % 3 === 0 ? '#fbbf24' : i % 3 === 1 ? '#f59e0b' : '#fcd34d'}
                opacity={0.5 + (i * 0.07) % 0.5}
              />
            ))}
          </g>
        </g>

        {/* DUVAR DEKORASYONU — sağ tarafta dijital tablo / sertifika çerçeveleri */}
        <g transform="translate(620, 100)">
          {/* Çerçeveli mali müşavirlik diploması */}
          <rect x="0" y="0" width="120" height="90" fill="#2a1f15" stroke="#3a2820" strokeWidth="3" />
          <rect x="6" y="6" width="108" height="78" fill="#1a1218" />
          <rect x="14" y="14" width="92" height="3" fill="#d4b876" opacity="0.7" />
          <rect x="20" y="24" width="80" height="2" fill="rgba(212,184,118,0.4)" />
          <rect x="20" y="29" width="68" height="2" fill="rgba(212,184,118,0.3)" />
          <rect x="35" y="50" width="50" height="20" fill="rgba(212,184,118,0.08)" />
          <text x="60" y="64" fontFamily="Fraunces, serif" fontSize="9" textAnchor="middle" fill="#d4b876" letterSpacing="2" fontWeight="700">SMMM</text>

          {/* Saat — çerçevesizin yanında */}
          <circle cx="180" cy="45" r="32" fill="#1a1218" stroke="#3a2820" strokeWidth="3" />
          <circle cx="180" cy="45" r="2" fill="#d4b876" />
          <line x1="180" y1="45" x2="180" y2="25" stroke="#d4b876" strokeWidth="2" strokeLinecap="round" />
          <line x1="180" y1="45" x2="195" y2="50" stroke="rgba(212,184,118,0.8)" strokeWidth="1.5" strokeLinecap="round" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
            <circle
              key={i}
              cx={180 + Math.cos((i * Math.PI) / 6 - Math.PI / 2) * 26}
              cy={45 + Math.sin((i * Math.PI) / 6 - Math.PI / 2) * 26}
              r="1"
              fill="rgba(212,184,118,0.6)"
            />
          ))}

          {/* Türkiye haritası silueti */}
          <g transform="translate(240, 10)" opacity="0.5">
            <path
              d="M 0 30 Q 5 20 15 22 Q 25 18 38 22 Q 50 19 62 22 Q 75 25 88 25 Q 100 28 110 32 Q 105 40 100 42 Q 90 45 80 43 Q 70 48 60 45 Q 50 50 40 47 Q 28 50 18 45 Q 8 42 0 38 Z"
              fill="#d4b876"
              opacity="0.4"
            />
          </g>
        </g>

        {/* TAVAN AYDINLATMASI — sıcak sarı ışık halkaları */}
        <ellipse cx="300" cy="0" rx="240" ry="50" fill="url(#light-warm)" />
        <ellipse cx="900" cy="0" rx="240" ry="50" fill="url(#light-warm)" />

        {/* KAHVE MAKİNESİ — sağ köşede zeminde */}
        <g transform="translate(1080, 380)">
          <rect x="0" y="0" width="60" height="80" rx="3" fill="#1a1a1a" />
          <rect x="3" y="5" width="54" height="20" rx="1" fill="#2a2a2a" />
          <rect x="6" y="9" width="18" height="2" fill="#22c55e" />
          <rect x="6" y="13" width="12" height="1" fill="#3a3a3a" />
          <rect x="20" y="50" width="20" height="20" rx="2" fill="#0a0a0a" />
          <ellipse cx="30" cy="60" rx="6" ry="2" fill="#3a2410" />
          <rect x="5" y="72" width="50" height="4" fill="#2a2a2a" />
        </g>

        {/* SAKSI BİTKİ — sol ön köşe */}
        <g transform="translate(20, 440)">
          <ellipse cx="35" cy="60" rx="32" ry="9" fill="rgba(0,0,0,0.45)" />
          <path d="M 10 50 Q 10 30 35 28 Q 60 30 60 50 L 58 72 Q 58 78 52 78 L 18 78 Q 12 78 12 72 Z" fill="#7c2d12" />
          <path d="M 35 30 Q 18 8 6 -12 Q 18 4 22 26 Q 24 30 35 30" fill="#15803d" />
          <path d="M 35 30 Q 52 8 64 -12 Q 52 4 48 26 Q 46 30 35 30" fill="#16a34a" />
          <path d="M 35 30 Q 35 4 30 -22 Q 35 -2 37 22 Q 37 28 35 30" fill="#22c55e" />
          <path d="M 35 28 Q 24 16 19 6 Q 25 14 31 24" fill="#16a34a" opacity="0.85" />
        </g>

        {/* Üst bar — saat + ekip durumu (sağ üstte, karakterlerden uzakta) */}
        <g transform="translate(1020, 50)">
          <text x="0" y="0" fontFamily="JetBrains Mono, monospace" fontSize="22" fill="rgba(250,250,249,0.65)" letterSpacing="3" textAnchor="end">
            {time}
          </text>
          <text x="0" y="22" fontFamily="Plus Jakarta Sans" fontSize="10" fill="rgba(212,184,118,0.65)" letterSpacing="3" textAnchor="end">
            7 AJAN ÇEVRİMİÇİ
          </text>
        </g>
      </svg>

      {/* MASALAR — 3 sıra × 3 kolon grid, izometrik */}
      <div className="relative pt-32 pb-20 px-12" style={{ zIndex: 2 }}>
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
