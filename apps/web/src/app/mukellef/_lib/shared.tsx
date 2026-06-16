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

export function PageTitle({ ust, baslik }: { ust: string; baslik: string }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-[.18em]" style={{ color: '#b8a06f' }}>{ust}</p>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>{baslik}</h1>
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
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

export function OzetCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: string }) {
  return (
    <Card>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl mb-3" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}>
        <Icon size={16} />
      </div>
      <p className="text-[11px] uppercase tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.4)' }}>{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: accent || GOLD, fontFamily: 'Fraunces, serif' }}>{value}</p>
    </Card>
  );
}
