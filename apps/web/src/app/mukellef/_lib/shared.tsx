'use client';
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck, Eye } from 'lucide-react';
import { taxpayerApi } from '@/lib/taxpayer-api';

export const GOLD = '#d4b876';

/** Belgeyi presigned inline URL alıp yeni sekmede açar. tur: beyanname|evrak|tebligat|sgk|fatura */
export async function openBelge(tur: string, id: string, kind?: string) {
  try {
    const { data } = await taxpayerApi.get(`/portal/belge/${tur}/${id}/view`, { params: kind ? { kind } : undefined });
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    else alert('Belge bulunamadı.');
  } catch {
    alert('Belge açılamadı. Daha sonra tekrar deneyin.');
  }
}

/** Küçük "göz" görüntüleme butonu. */
export function GozBtn({ onClick, title = 'Görüntüle' }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
      style={{ border: '1px solid rgba(212,184,118,0.28)', color: GOLD, background: 'rgba(212,184,118,0.08)' }}
    >
      <Eye size={15} />
    </button>
  );
}

export const fmtTRY = (n: number) =>
  `${(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

export const DURUM: Record<string, { label: string; color: string; Icon: any }> = {
  verildi: { label: 'Verildi', color: '#4ade80', Icon: CheckCircle2 },
  onaylandi: { label: 'Onaylandı', color: '#4ade80', Icon: CheckCircle2 },
  beklemede: { label: 'Beklemede', color: '#fbbf24', Icon: Clock },
  hatali: { label: 'Hatalı', color: '#f87171', Icon: AlertTriangle },
  muaf: { label: 'Muaf', color: '#94a3b8', Icon: ShieldCheck },
};

/** Sayfa başlığı — ofis paneli PageHeader ile birebir aynı kompakt dil. right: sağ aksiyon (ör. dönem seçici). */
export function PageTitle({ ust, baslik, right }: { ust: string; baslik: string; right?: React.ReactNode }) {
  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.055), rgba(8,18,18,0.70))',
        border: '1px solid rgba(212,184,118,0.12)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.14)',
      }}
    >
      <div>
        {ust ? <p className="text-[10.5px] font-semibold uppercase tracking-[.16em] mb-0.5" style={{ color: 'rgba(212,184,118,0.8)' }}>{ust}</p> : null}
        <h1 className="page-title">{baslik}</h1>
      </div>
      {right ? <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{right}</div> : null}
    </div>
  );
}

/**
 * İnce sayaç şeridi — ofis faturalar dilindeki tek-satır birleşik sayaç kutusu.
 * items: { label, value, sub?, icon, accent? }
 */
export function StatStrip({ items }: { items: { label: string; value: string; sub?: string; icon: any; accent?: string }[] }) {
  return (
    <div className="flex items-stretch flex-wrap rounded-[14px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {items.map(({ label, value, sub, icon: Icon, accent = GOLD }, idx) => (
        <div
          key={label}
          className="flex-1 min-w-[150px] flex items-center gap-2.5 px-4 py-3"
          style={idx > 0 ? { borderLeft: '1px solid rgba(255,255,255,0.04)' } : undefined}
        >
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: `${accent}14`, border: `1px solid ${accent}2e`, color: accent }}>
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-[.1em] truncate" style={{ color: 'rgba(250,250,249,0.35)' }}>{label}</p>
            <p className="leading-tight tabular-nums truncate" style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: '#fafaf9' }}>
              {value}
              {sub ? <span className="ml-1.5 text-[11px] font-medium" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</span> : null}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Düz kart — ofis paneli .card dili (degrade/glow yok). */
export function Card({ children, accent, className = '', pad = true }: { children: React.ReactNode; accent?: string; className?: string; pad?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${pad ? 'p-5' : ''} ${className}`}
      style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
    >
      {accent ? <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent, opacity: 0.5 }} /> : null}
      {children}
    </div>
  );
}

/** Durum/etiket pill rozeti — ofis .badge dili. */
export function Badge({ color, children, icon: Icon }: { color: string; children: React.ReactNode; icon?: any }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap" style={{ background: `${color}1a`, color }}>
      {Icon ? <Icon size={12} /> : null}{children}
    </span>
  );
}

/** Tablo başlık hücresi — ofis tablo dili (10px uppercase, harf aralığı). */
export function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th className={`px-4 py-2.5 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}>{children}</th>;
}
export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="text-[10px] font-semibold uppercase" style={{ background: 'rgba(255,255,255,0.015)', color: 'rgba(250,250,249,0.4)', letterSpacing: '0.12em' }}>
        {children}
      </tr>
    </thead>
  );
}

/** Düz liste bölümü — ofis (müşavir) liste dili: hafif kart, üstte başlık+alt yazı, sonra tablo. */
export function Section({ baslik, aciklama, children }: { baslik: string; aciklama?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <h2 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h2>
        {aciklama ? <p className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>{aciklama}</p> : null}
      </div>
      {children}
    </section>
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

/** Düz sayaç kartı — ofis .stat-card dili: nötr büyük rakam + ince ikon çipi (degrade/glow yok). */
export function OzetCard({ icon: Icon, label, value, accent = GOLD, sub, valueColor }: { icon: any; label: string; value: string; accent?: string; sub?: string; valueColor?: string }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium uppercase tracking-[.05em]" style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{ background: `${accent}14`, border: `1px solid ${accent}2e`, color: accent }}>
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-3 leading-none tabular-nums" style={{ color: valueColor || '#fafaf9', fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em' }}>{value}</div>
      {sub ? <div className="mt-1.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</div> : null}
    </div>
  );
}
