'use client';
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';

export const GOLD = '#d4b876';

export const fmtTRY = (n: number) =>
  `${(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

export const DURUM: Record<string, { label: string; color: string; Icon: any }> = {
  onaylandi: { label: 'Onaylandı', color: '#4ade80', Icon: CheckCircle2 },
  beklemede: { label: 'Beklemede', color: '#fbbf24', Icon: Clock },
  hatali: { label: 'Hatalı', color: '#f87171', Icon: AlertTriangle },
  muaf: { label: 'Muaf', color: '#94a3b8', Icon: ShieldCheck },
};

/** İmza premium başlık: radyal arka plan + üst altın renk şeridi (ofis portalı ile aynı dil). */
export function PageTitle({ ust, baslik }: { ust: string; baslik: string }) {
  return (
    <header
      className="relative overflow-hidden rounded-2xl border p-5 mb-6"
      style={{
        borderColor: 'rgba(212,184,118,0.18)',
        background:
          'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.18), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(217,160,108,0.12), transparent 45%), #0f0d0b',
        boxShadow: '0 16px 34px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #d4b876, #e0b878, #d9a06c, #b8863a)' }} />
      <p className="text-[11px] font-semibold uppercase tracking-[.18em]" style={{ color: 'rgba(212,184,118,0.85)' }}>{ust}</p>
      <h1 className="mt-1.5" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.1 }}>{baslik}</h1>
    </header>
  );
}

export function Card({ children, accent, className = '' }: { children: React.ReactNode; accent?: string; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-4 ${className}`}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.008)), #100d0a',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {accent ? <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}33)` }} /> : null}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] py-3" style={{ color: 'rgba(250,250,249,0.4)' }}>{children}</p>;
}

export function Spinner() {
  return (
    <div className="py-20 flex justify-center">
      <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
    </div>
  );
}

/** İmza premium sayaç kartı: metriğe özel renk + degrade zemin + radyal parıltı + glow'lu ikon + büyük serif rakam. */
export function OzetCard({ icon: Icon, label, value, accent = GOLD, sub }: { icon: any; label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{
        borderColor: `${accent}4d`,
        background: `linear-gradient(135deg, ${accent}24, ${accent}0a 60%), #100d0a`,
        boxShadow: `0 16px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}33)` }} />
      <div className="pointer-events-none absolute -right-7 -top-7 h-28 w-28 rounded-full" style={{ background: `radial-gradient(circle, ${accent}33, transparent 70%)` }} />
      <div className="relative flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[.14em]" style={{ color: `${accent}e0` }}>{label}</span>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, color: '#0f0d0b', boxShadow: `0 6px 16px ${accent}55` }}
        >
          <Icon size={16} />
        </span>
      </div>
      <div className="relative mt-3 leading-none tabular-nums" style={{ color: accent, fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
      {sub ? <div className="relative mt-1.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{sub}</div> : null}
    </div>
  );
}
