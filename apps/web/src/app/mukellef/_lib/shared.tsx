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
  onaylandi: { label: 'Onaylandı', color: '#4ade80', Icon: CheckCircle2 },
  beklemede: { label: 'Beklemede', color: '#fbbf24', Icon: Clock },
  hatali: { label: 'Hatalı', color: '#f87171', Icon: AlertTriangle },
  muaf: { label: 'Muaf', color: '#94a3b8', Icon: ShieldCheck },
};

/** Sayfa başlığı — ofis paneli PageHeader ile birebir aynı kompakt dil. */
export function PageTitle({ ust, baslik }: { ust: string; baslik: string }) {
  return (
    <div
      className="mb-4 flex items-center justify-between rounded-2xl px-4 py-3"
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
    </div>
  );
}

/**
 * Zengin sayfa başlığı — ofis (müşavir) imzası: üst renk şeridi + radial parıltı +
 * degrade ikon kutusu. Mükellef portalının tüm ana sayfalarında ortak kullanılır.
 * accent ile her modüle ayrı renk verilebilir. right: sağ tarafa araç/rozet alanı.
 */
export function PortalHeader({
  ust, baslik, aciklama, icon: Icon, accent = GOLD, right,
}: {
  ust: string; baslik: string; aciklama?: string; icon: any; accent?: string; right?: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 mb-5"
      style={{
        border: '1px solid rgba(255,255,255,0.06)',
        background: `radial-gradient(120% 140% at 0% 0%, ${accent}26, transparent 46%), radial-gradient(120% 140% at 100% 0%, ${accent}1a, transparent 48%), #0f0d0b`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}77, ${accent}, ${accent}dd, ${accent})` }} />
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[26px] h-px" style={{ background: accent }} />
        <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: accent }}>{ust}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <span
            className="grid place-items-center rounded-xl flex-shrink-0"
            style={{ width: 46, height: 46, background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 8px 22px ${accent}44` }}
          >
            <Icon size={24} style={{ color: '#1a1410' }} />
          </span>
          <div className="min-w-0">
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>{baslik}</h1>
            {aciklama ? <p className="text-[13px] mt-1.5 truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>{aciklama}</p> : null}
          </div>
        </div>
        {right ? <div className="ml-auto flex items-center gap-2 flex-wrap justify-end flex-shrink-0">{right}</div> : null}
      </div>
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
