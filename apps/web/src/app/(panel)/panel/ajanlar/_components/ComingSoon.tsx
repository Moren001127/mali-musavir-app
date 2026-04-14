'use client';
import { LucideIcon, Sparkles } from 'lucide-react';

interface Props {
  title: string;
  desc: string;
  icon: LucideIcon;
  gradient: string;
  features: string[];
}

export function ComingSoon({ title, desc, icon: Icon, gradient, features }: Props) {
  return (
    <div className="space-y-5">
      <div
        className="relative rounded-2xl overflow-hidden p-8 border"
        style={{
          background: gradient,
          borderColor: 'var(--border)',
        }}
      >
        <div
          className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.3), transparent 70%)' }}
        />
        <div className="relative flex items-start gap-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,.15)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,.2)',
            }}
          >
            <Icon size={30} style={{ color: '#fff' }} strokeWidth={1.5} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={13} style={{ color: 'rgba(255,255,255,.8)' }} />
              <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,.7)' }}>
                Yakında · Claude Haiku 4.5
              </span>
            </div>
            <h1 className="text-3xl font-bold" style={{ color: '#fff' }}>
              {title}
            </h1>
            <p className="text-sm mt-2 max-w-2xl" style={{ color: 'rgba(255,255,255,.85)' }}>
              {desc}
            </p>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
          Planlanmış Özellikler
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ background: 'var(--bg)' }}
            >
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(184,160,111,.15)', color: '#b8a06f' }}
              >
                <Sparkles size={12} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text)' }}>
                {f}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
