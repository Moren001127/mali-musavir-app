'use client';

import type { AgentId } from '@/lib/moren-ofis';
import type { CharacterState } from './Character';
import { Character } from './Character';

// Her ajanın masasında farklı eşyalar — kişiliğini yansıtır.
const DESK_PROPS: Record<AgentId, {
  monitorBg: string;
  hasSecondMonitor?: boolean;
  papers?: 'stack' | 'few' | 'none';
  hasBook?: boolean;
  hasCoffee?: boolean;
  hasPlant?: boolean;
  hasPhone?: boolean;
  hasPostits?: boolean;
}> = {
  arda: { monitorBg: '#1e293b', papers: 'stack', hasPhone: true, hasCoffee: true },
  nevra: { monitorBg: '#0c0a18', hasSecondMonitor: true, hasBook: true, papers: 'few' },
  cem: { monitorBg: '#1a0f1f', papers: 'stack', hasBook: true, hasCoffee: true },
  volkan: { monitorBg: '#0a1f10', papers: 'few', hasCoffee: true, hasPlant: true },
  defne: { monitorBg: '#1f0a14', hasPhone: true, hasPostits: true, hasPlant: true },
  kayra: { monitorBg: '#001a1f', hasSecondMonitor: true, hasCoffee: true },
};

export function Desk({
  agentId,
  state,
  active,
  onClick,
  label,
}: {
  agentId: AgentId;
  state: CharacterState;
  active: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const props = DESK_PROPS[agentId];

  return (
    <div
      onClick={onClick}
      className="relative inline-block cursor-pointer transition-transform hover:scale-105"
      style={{ transformOrigin: 'center bottom' }}
    >
      {/* Glow effect when active */}
      {active && (
        <div
          className="absolute inset-0 -m-4 rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(212,184,118,0.18) 0%, transparent 70%)`,
            filter: 'blur(20px)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      )}

      <svg viewBox="0 0 220 180" width="220" height="180" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`desk-${agentId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a3a2a" />
            <stop offset="100%" stopColor="#2a1f15" />
          </linearGradient>
          <linearGradient id={`monitor-${agentId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={active ? '#3a8a8a' : props.monitorBg} />
            <stop offset="100%" stopColor={props.monitorBg} />
          </linearGradient>
        </defs>

        {/* ZEMİN GÖLGESİ */}
        <ellipse cx="110" cy="172" rx="80" ry="8" fill="rgba(0,0,0,0.45)" />

        {/* MASA — izometrik (üst yüzey + ön + yan) */}
        {/* Masa üst yüzey */}
        <path
          d="M 30 120 L 110 100 L 190 120 L 110 140 Z"
          fill={`url(#desk-${agentId})`}
          stroke="#1a120c"
          strokeWidth="0.5"
        />
        {/* Masa ön kenar */}
        <path
          d="M 30 120 L 110 140 L 110 160 L 30 140 Z"
          fill="#1f1610"
        />
        {/* Masa sağ kenar */}
        <path
          d="M 110 140 L 190 120 L 190 140 L 110 160 Z"
          fill="#2a1f15"
        />

        {/* MASA AYAKLARI */}
        <rect x="40" y="150" width="3" height="22" fill="#1a120c" />
        <rect x="175" y="135" width="3" height="22" fill="#1a120c" />
        <rect x="105" y="158" width="3" height="14" fill="#1a120c" />

        {/* MONİTÖR — masada arkada */}
        <g>
          {/* Stand */}
          <rect x="92" y="100" width="4" height="8" fill="#1a1a1a" />
          <ellipse cx="94" cy="108" rx="8" ry="2" fill="#1a1a1a" />
          {/* Ekran */}
          <rect x="74" y="68" width="52" height="32" rx="1.5" fill="#0a0a0a" />
          <rect x="76" y="70" width="48" height="28" rx="1" fill={`url(#monitor-${agentId})`} />
          {/* Ekran içeriği — fake UI */}
          {active && (
            <g opacity="0.75">
              <rect x="78" y="72" width="12" height="2" fill="rgba(212,184,118,0.9)" />
              <rect x="78" y="76" width="38" height="1" fill="rgba(212,184,118,0.4)" />
              <rect x="78" y="79" width="32" height="1" fill="rgba(212,184,118,0.4)" />
              <rect x="78" y="82" width="40" height="1" fill="rgba(212,184,118,0.4)" />
              <rect x="78" y="88" width="20" height="6" fill="rgba(34,197,94,0.6)" />
            </g>
          )}
        </g>

        {/* İKİNCİ MONİTÖR (NEVRA + KAYRA) */}
        {props.hasSecondMonitor && (
          <g>
            <rect x="132" y="74" width="40" height="26" rx="1" fill="#0a0a0a" />
            <rect x="134" y="76" width="36" height="22" rx="0.5" fill={`url(#monitor-${agentId})`} opacity="0.85" />
            <rect x="148" y="100" width="2" height="6" fill="#1a1a1a" />
          </g>
        )}

        {/* KLAVYE + FARE */}
        <rect x="84" y="118" width="40" height="6" rx="1" fill="#1a1a1a" />
        <rect x="86" y="120" width="36" height="2" rx="0.5" fill="#2a2a2a" />
        <ellipse cx="132" cy="122" rx="4" ry="3" fill="#1a1a1a" />

        {/* PAPERS */}
        {props.papers === 'stack' && (
          <g>
            <rect x="45" y="116" width="20" height="3" fill="#e8e8e0" />
            <rect x="44" y="119" width="22" height="2" fill="#d0d0c8" />
            <rect x="46" y="121" width="18" height="2" fill="#e8e8e0" />
            {/* Bir yaprak yana taşmış */}
            <rect x="42" y="114" width="14" height="10" rx="0.5" fill="#fafaf2" transform="rotate(-8 49 119)" />
          </g>
        )}
        {props.papers === 'few' && (
          <rect x="50" y="118" width="18" height="2" fill="#e8e8e0" />
        )}

        {/* KİTAP (Nevra/Cem) */}
        {props.hasBook && (
          <g>
            <rect x="140" y="110" width="14" height="3" fill="#7c2d12" />
            <rect x="140" y="113" width="14" height="6" fill="#9a3412" />
            <line x1="140" y1="116" x2="154" y2="116" stroke="#7c2d12" strokeWidth="0.5" />
          </g>
        )}

        {/* KAHVE */}
        {props.hasCoffee && (
          <g>
            <ellipse cx="160" cy="118" rx="4" ry="2" fill="#1a1a1a" />
            <path d="M 156 118 L 156 124 Q 156 126 158 126 L 162 126 Q 164 126 164 124 L 164 118 Z" fill="#fafaf2" />
            <path d="M 164 120 Q 167 120 167 122 Q 167 124 164 124" fill="none" stroke="#fafaf2" strokeWidth="0.8" />
            <ellipse cx="160" cy="121" rx="3" ry="0.8" fill="#3a2410" />
            {/* Buhar */}
            <path d="M 158 117 Q 158 114 159 113 Q 158 111 159 110" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" fill="none" />
            <path d="M 161 117 Q 161 114 162 113" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" fill="none" />
          </g>
        )}

        {/* TELEFON */}
        {props.hasPhone && (
          <g>
            <rect x="60" y="118" width="8" height="14" rx="1" fill="#1a1a1a" />
            <rect x="61" y="119" width="6" height="11" rx="0.5" fill={active ? '#06b6d4' : '#2a2a2a'} />
          </g>
        )}

        {/* POST-IT'LER (Defne) */}
        {props.hasPostits && (
          <g>
            <rect x="44" y="62" width="8" height="8" fill="#fef08a" transform="rotate(-4 48 66)" />
            <rect x="50" y="65" width="8" height="8" fill="#fbcfe8" transform="rotate(3 54 69)" />
            <rect x="48" y="73" width="8" height="8" fill="#bef264" transform="rotate(-6 52 77)" />
          </g>
        )}

        {/* BİTKİ */}
        {props.hasPlant && (
          <g>
            <ellipse cx="172" cy="116" rx="4" ry="2.5" fill="#5b3a1a" />
            <path d="M 172 116 L 168 108 L 170 110 L 170 102 L 172 106 L 172 100 L 174 106 L 174 102 L 176 110 L 178 108 Z" fill="#15803d" />
            <path d="M 172 108 L 169 102 L 175 102 Z" fill="#22c55e" opacity="0.7" />
          </g>
        )}

        {/* KARAKTER — masanın arkasında, yarısı görünür */}
        <g transform="translate(56, -10)">
          <Character agentId={agentId} state={state} size={100} />
        </g>
      </svg>

      {/* Ajan etiketi — masanın altında */}
      {label && (
        <div
          className="text-center -mt-2 px-2 py-1 rounded text-[10px] font-bold tracking-wider"
          style={{
            background: active ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
            color: active ? '#d4b876' : 'rgba(250,250,249,0.7)',
            border: `1px solid ${active ? 'rgba(212,184,118,0.5)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
