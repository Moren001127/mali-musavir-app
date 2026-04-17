'use client';
import { LucideIcon, Sparkles, Clock } from 'lucide-react';

const GOLD = '#d4b876';

interface Props {
  title: string;
  desc: string;
  icon: LucideIcon;
  gradient: string;
  features: string[];
}

export function ComingSoon({ title, desc, icon: Icon, gradient, features }: Props) {
  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ajan</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            {title}
          </h1>
          <p className="text-[13px] mt-1.5 max-w-2xl" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {desc}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-[10px]" style={{ background: 'rgba(184,160,111,0.1)', border: '1px solid rgba(184,160,111,0.3)' }}>
          <Clock size={13} style={{ color: GOLD }} />
          <span className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: GOLD }}>Yakında</span>
        </div>
      </div>

      {/* HERO KART */}
      <div
        className="relative rounded-2xl overflow-hidden p-8"
        style={{
          background: gradient,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div
          className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.4), transparent 70%)' }}
        />
        <div
          className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.3), transparent 70%)' }}
        />
        <div className="relative flex items-start gap-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,.15)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,.25)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            <Icon size={30} style={{ color: '#fff' }} strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={13} style={{ color: 'rgba(255,255,255,.9)' }} />
              <span className="text-[10px] font-bold tracking-[.18em] uppercase" style={{ color: 'rgba(255,255,255,.85)' }}>
                Yakında · Claude Haiku 4.5
              </span>
            </div>
            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>
              {title}
            </h2>
            <p className="text-[14px] mt-2 max-w-2xl leading-relaxed" style={{ color: 'rgba(255,255,255,.9)' }}>
              {desc}
            </p>
          </div>
        </div>
      </div>

      {/* ÖZELLİKLER */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2.5">
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Planlanmış Özellikler</h3>
          </div>
          <span className="text-[11px] font-medium" style={{ color: 'rgba(250,250,249,0.4)' }}>{features.length} özellik</span>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3.5 rounded-xl transition-all"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.05)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.18)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(184,160,111,0.12)', border: '1px solid rgba(184,160,111,0.2)', color: GOLD }}
              >
                <Sparkles size={13} />
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.85)' }}>
                {f}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
