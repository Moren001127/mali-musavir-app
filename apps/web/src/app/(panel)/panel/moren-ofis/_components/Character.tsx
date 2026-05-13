'use client';

import type { AgentId } from '@/lib/moren-ofis';

export type CharacterState = 'idle' | 'thinking' | 'talking' | 'working';

// Her ajan için karakter görsel kimliği — kıyafet, saç, ton.
// Görsel "young professional" hissi: smart casual, modern, ofis takımı.
interface CharacterStyle {
  skinTone: string;
  hairColor: string;
  hairStyle: 'short-male' | 'short-female-bob' | 'ponytail' | 'beard' | 'hoodie' | 'tied-back';
  shirtColor: string;
  pantsColor: string;
  glasses: boolean;
  accessory?: 'tie' | 'scarf' | 'watch' | 'headphones';
}

const CHARACTERS: Record<AgentId, CharacterStyle> = {
  arda: {
    // Baş müşavir, 30, gözlüklü, takım elbise — lider
    skinTone: '#e8c4a0',
    hairColor: '#3a2820',
    hairStyle: 'short-male',
    shirtColor: '#1e293b', // koyu lacivert blazer
    pantsColor: '#0f172a',
    glasses: true,
    accessory: 'tie',
  },
  nevra: {
    // Vergi uzmanı, 28, kısa saç bob, profesyonel
    skinTone: '#f0d2b4',
    hairColor: '#2a1810',
    hairStyle: 'short-female-bob',
    shirtColor: '#4338ca', // mor blazer
    pantsColor: '#312e81',
    glasses: false,
    accessory: 'watch',
  },
  cem: {
    // Denetçi, 29, sakallı, yelek — analitik
    skinTone: '#d4a06a',
    hairColor: '#1f1410',
    hairStyle: 'beard',
    shirtColor: '#6b21a8', // mor (denetim rengi)
    pantsColor: '#374151',
    glasses: true,
  },
  volkan: {
    // Bordro, 26, casual, kahve fanı
    skinTone: '#e8c099',
    hairColor: '#4a3020',
    hairStyle: 'short-male',
    shirtColor: '#15803d', // yeşil casual gömlek
    pantsColor: '#1f2937',
    glasses: false,
  },
  defne: {
    // Asistan, 25, atkuyruğu, enerjik
    skinTone: '#f5d6b8',
    hairColor: '#4a2410',
    hairStyle: 'ponytail',
    shirtColor: '#db2777', // pembe bluz
    pantsColor: '#1f2937',
    glasses: false,
  },
  kayra: {
    // Operatör, 24, kapüşonlu, kulaklık
    skinTone: '#d8a479',
    hairColor: '#1a1410',
    hairStyle: 'hoodie',
    shirtColor: '#0891b2', // turkuaz hoodie
    pantsColor: '#111827',
    glasses: false,
    accessory: 'headphones',
  },
};

/**
 * İzometrik bir karakter — masada oturmuş, bilgisayar başında.
 * State'e göre küçük animasyonlar (idle nefes, working tıklama, talking konuşma).
 *
 * SVG boyut: viewBox 100x140 — masa + sandalye + karakter.
 * Renkler dış prop'lardan değil, sabit CHARACTERS map'inden.
 */
export function Character({
  agentId,
  state = 'idle',
  size = 140,
}: {
  agentId: AgentId;
  state?: CharacterState;
  size?: number;
}) {
  const c = CHARACTERS[agentId];

  return (
    <svg
      viewBox="0 0 100 140"
      width={size}
      height={size * 1.4}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`shadow-${agentId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,0,0,0.3)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>

      {/* Yer gölgesi */}
      <ellipse cx="50" cy="135" rx="28" ry="4" fill="rgba(0,0,0,0.35)" />

      {/* SANDALYE — izometrik ofis sandalyesi */}
      <g className="chair">
        {/* Sandalye ayağı (5 kollu yıldız) */}
        <path d="M 35 130 L 50 125 L 65 130 L 65 132 L 50 127 L 35 132 Z" fill="#1a1a1a" />
        <rect x="48" y="115" width="4" height="13" fill="#2a2a2a" />
        {/* Oturma + sırt */}
        <rect x="32" y="90" width="36" height="8" rx="2" fill="#1f2937" />
        <rect x="34" y="60" width="32" height="32" rx="4" fill="#1f2937" />
        <rect x="34" y="60" width="32" height="32" rx="4" fill="rgba(255,255,255,0.05)" />
      </g>

      {/* KARAKTER — masada oturuyor pozu */}
      <g className={`character character-${state}`} style={{ transformOrigin: '50px 70px' }}>
        {/* Pantolon (sandalyede) */}
        <rect x="38" y="85" width="24" height="14" rx="3" fill={c.pantsColor} />

        {/* Gövde + kollar — blazer/gömlek */}
        <path
          d={`M 36 60 Q 36 56 40 56 L 60 56 Q 64 56 64 60 L 66 88 Q 66 92 62 92 L 38 92 Q 34 92 34 88 Z`}
          fill={c.shirtColor}
        />
        {/* Gömlek altı detay (yaka) */}
        <path d="M 46 56 L 50 62 L 54 56 L 52 66 L 48 66 Z" fill="rgba(255,255,255,0.85)" />
        {/* Kravat (varsa) */}
        {c.accessory === 'tie' && (
          <path d="M 49 62 L 51 62 L 52 78 L 50 80 L 48 78 Z" fill="#b91c1c" />
        )}
        {/* Kollar — masada (typing pozu) */}
        <ellipse cx="34" cy="84" rx="5" ry="9" fill={c.shirtColor} />
        <ellipse cx="66" cy="84" rx="5" ry="9" fill={c.shirtColor} />
        {/* Eller */}
        <circle cx="34" cy="92" r="3" fill={c.skinTone} />
        <circle cx="66" cy="92" r="3" fill={c.skinTone} />

        {/* BOYUN */}
        <rect x="46" y="48" width="8" height="8" fill={c.skinTone} />

        {/* KAFA */}
        <ellipse cx="50" cy="40" rx="11" ry="12" fill={c.skinTone} />

        {/* SAÇ — hairStyle'a göre */}
        {c.hairStyle === 'short-male' && (
          <path
            d="M 39 38 Q 39 28 50 27 Q 61 28 61 38 Q 61 33 50 32 Q 39 33 39 38 Z"
            fill={c.hairColor}
          />
        )}
        {c.hairStyle === 'short-female-bob' && (
          <path
            d="M 38 36 Q 38 27 50 26 Q 62 27 62 36 L 62 45 Q 62 40 58 40 L 42 40 Q 38 40 38 45 Z"
            fill={c.hairColor}
          />
        )}
        {c.hairStyle === 'ponytail' && (
          <>
            <path
              d="M 39 38 Q 39 27 50 26 Q 61 27 61 38 Q 61 33 50 32 Q 39 33 39 38 Z"
              fill={c.hairColor}
            />
            <ellipse cx="62" cy="42" rx="3" ry="6" fill={c.hairColor} />
          </>
        )}
        {c.hairStyle === 'beard' && (
          <>
            <path
              d="M 39 38 Q 39 28 50 27 Q 61 28 61 38 Q 61 34 50 33 Q 39 34 39 38 Z"
              fill={c.hairColor}
            />
            {/* Sakal */}
            <path
              d="M 42 44 Q 42 50 50 51 Q 58 50 58 44 Q 58 47 50 47 Q 42 47 42 44 Z"
              fill={c.hairColor}
              opacity="0.9"
            />
          </>
        )}
        {c.hairStyle === 'hoodie' && (
          <>
            <path
              d="M 36 38 Q 36 25 50 24 Q 64 25 64 38 L 64 50 Q 64 44 50 44 Q 36 44 36 50 Z"
              fill={c.shirtColor}
            />
            <path
              d="M 41 36 Q 41 31 50 30 Q 59 31 59 36 Q 59 34 50 33 Q 41 34 41 36 Z"
              fill={c.hairColor}
            />
          </>
        )}
        {c.hairStyle === 'tied-back' && (
          <path
            d="M 39 38 Q 39 27 50 26 Q 61 27 61 38 Q 61 33 50 32 Q 39 33 39 38 Z"
            fill={c.hairColor}
          />
        )}

        {/* YÜZ — gözler */}
        <ellipse cx="46" cy="40" rx="1" ry="1.5" fill="#1a1a1a" />
        <ellipse cx="54" cy="40" rx="1" ry="1.5" fill="#1a1a1a" />

        {/* GÖZLÜK */}
        {c.glasses && (
          <g>
            <rect x="43" y="38" width="6" height="4" rx="1.5" fill="none" stroke="#1a1a1a" strokeWidth="0.6" />
            <rect x="51" y="38" width="6" height="4" rx="1.5" fill="none" stroke="#1a1a1a" strokeWidth="0.6" />
            <line x1="49" y1="40" x2="51" y2="40" stroke="#1a1a1a" strokeWidth="0.5" />
          </g>
        )}

        {/* AĞIZ — state'e göre */}
        {state === 'talking' ? (
          <ellipse cx="50" cy="46" rx="2" ry="1.5" fill="#5e2020" className="talking-mouth" />
        ) : state === 'thinking' ? (
          <line x1="48" y1="46" x2="52" y2="46" stroke="#5e2020" strokeWidth="0.8" strokeLinecap="round" />
        ) : (
          <path d="M 47 46 Q 50 47.5 53 46" stroke="#5e2020" strokeWidth="0.7" fill="none" strokeLinecap="round" />
        )}

        {/* Kulaklık (Kayra için) */}
        {c.accessory === 'headphones' && (
          <g>
            <path d="M 39 36 Q 39 30 50 30 Q 61 30 61 36" stroke="#06b6d4" strokeWidth="1.5" fill="none" />
            <ellipse cx="38" cy="40" rx="2.5" ry="3" fill="#06b6d4" />
            <ellipse cx="62" cy="40" rx="2.5" ry="3" fill="#06b6d4" />
          </g>
        )}

        {/* Düşünme balonu */}
        {state === 'thinking' && (
          <g className="thought-bubble" style={{ animation: 'pulse 1.5s infinite' }}>
            <circle cx="68" cy="20" r="3" fill="rgba(212,184,118,0.85)" />
            <circle cx="63" cy="26" r="1.5" fill="rgba(212,184,118,0.6)" />
            <circle cx="60" cy="30" r="0.8" fill="rgba(212,184,118,0.4)" />
          </g>
        )}
      </g>

      <style jsx>{`
        @keyframes char-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.5px); }
        }
        @keyframes char-talking {
          0%, 100% { transform: translateY(0); }
          25% { transform: translateY(-1px); }
          75% { transform: translateY(0.5px); }
        }
        @keyframes char-working {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-0.3px); }
        }
        .character-idle { animation: char-idle 3s ease-in-out infinite; }
        .character-talking { animation: char-talking 0.4s ease-in-out infinite; }
        .character-working { animation: char-working 0.2s ease-in-out infinite; }
      `}</style>
    </svg>
  );
}
