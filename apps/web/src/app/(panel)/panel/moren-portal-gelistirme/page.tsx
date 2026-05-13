'use client';

import { useState } from 'react';
import { Code2, Sparkles, GitBranch, Github, Loader2 } from 'lucide-react';
import { DEV_TEAM, type DevAgentId } from './_components/team';
import { DevAgentCard } from './_components/DevAgentCard';

const GOLD = '#d4b876';

export default function MorenPortalGelistirmePage() {
  const [selected, setSelected] = useState<DevAgentId | null>(null);

  return (
    <div className="space-y-4">
      {/* Üst başlık */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Code2 size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1
            className="mt-1"
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#fafaf9',
            }}
          >
            Moren Portal Geliştirme
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            5 kişilik yazılım ekibi · Portalın geleceğini şekillendirir · EREN · MELİS · SEDA · OKAN · BERK
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <span
            className="px-3 py-2 rounded-md text-[11px] font-semibold flex items-center gap-1.5"
            style={{
              background: 'rgba(212,184,118,0.10)',
              color: GOLD,
              border: '1px solid rgba(212,184,118,0.25)',
            }}
          >
            <Sparkles size={11} /> v1 hazırlık aşaması
          </span>
        </div>
      </div>

      {/* Ekip — gösterge panelindeki StatCard tarzında grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {DEV_TEAM.map((agent) => (
          <DevAgentCard
            key={agent.id}
            agent={agent}
            selected={selected === agent.id}
            onClick={() => setSelected(agent.id === selected ? null : agent.id)}
          />
        ))}
      </div>

      {/* Seçili ajan detayı */}
      {selected && (() => {
        const a = DEV_TEAM.find((x) => x.id === selected);
        if (!a) return null;
        return (
          <div
            className="rounded-xl p-4"
            style={{
              background: `linear-gradient(90deg, ${a.accentColor}15 0%, transparent 100%)`,
              border: `1px solid ${a.accentColor}30`,
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs uppercase tracking-wider font-bold"
                    style={{ color: a.accentColor }}
                  >
                    {a.displayName}
                  </span>
                  <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    {a.fullName} · {a.age} · {a.role}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'rgba(250,250,249,0.75)' }}>
                  {a.personality}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)' }}
              >
                Kapat
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <p
                  className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5"
                  style={{ color: a.accentColor }}
                >
                  Uzmanlık
                </p>
                <div className="flex flex-wrap gap-1">
                  {a.expertise.map((e) => (
                    <span
                      key={e}
                      className="px-2 py-1 rounded text-[10px] font-medium"
                      style={{ background: `${a.accentColor}22`, color: a.accentColor }}
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p
                  className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5"
                  style={{ color: a.accentColor }}
                >
                  Sorumluluk Alanı
                </p>
                <ul className="space-y-1">
                  {a.responsibilities.map((r) => (
                    <li
                      key={r}
                      className="text-[11.5px] flex items-start gap-1.5"
                      style={{ color: 'rgba(250,250,249,0.78)' }}
                    >
                      <span style={{ color: a.accentColor, marginTop: 1 }}>•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Brifing tarzı placeholder — backend hazır olunca chat girecek */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.85) 100%)',
          border: '1px solid rgba(212,184,118,0.22)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          minHeight: 320,
        }}
      >
        <span
          className="block h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            opacity: 0.45,
          }}
        />
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={13} style={{ color: GOLD }} />
            <span
              className="text-[10.5px] uppercase font-bold tracking-[.18em]"
              style={{ color: GOLD }}
            >
              Geliştirme Brifingi
            </span>
            <span
              className="text-[10px] font-bold px-2 py-[2px] rounded flex items-center gap-1"
              style={{ background: 'rgba(217,119,6,0.15)', color: '#f59e0b' }}
            >
              <Loader2 size={9} className="animate-spin" /> Hazırlanıyor
            </span>
          </div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#fafaf9',
              lineHeight: 1.2,
            }}
          >
            Ekip kuruluyor, görev kuyruğu yakında
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            EREN backlog&apos;u açar, MELİS tasarımı çizer, SEDA kodlar, OKAN gözden geçirir, BERK deploy eder
          </p>
        </div>

        <div className="px-5 py-5 space-y-2.5">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(250,250,249,0.7)',
            }}>
            <GitBranch size={12} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="font-semibold" style={{ color: '#fafaf9' }}>GitHub PAT entegrasyonu</p>
              <p className="mt-0.5">Ekip GitHub üzerinden issue açıp PR önerebilecek — token henüz tanımlı değil.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(250,250,249,0.7)',
            }}>
            <Github size={12} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="font-semibold" style={{ color: '#fafaf9' }}>Kanban — yapılacaklar tahtası</p>
              <p className="mt-0.5">Backlog · Sprint · İncelemede · Bitti sütunları — ekip kartları taşıyacak.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[12px]"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(250,250,249,0.7)',
            }}>
            <Sparkles size={12} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="font-semibold" style={{ color: '#fafaf9' }}>Ekip sohbeti</p>
              <p className="mt-0.5">"Yeni özellik şudur" dediğinde EREN kapsam keser, MELİS taslak atar, SEDA tahmin verir.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
