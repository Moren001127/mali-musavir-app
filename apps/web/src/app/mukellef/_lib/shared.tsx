'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck, Eye, X, ExternalLink, Loader2 } from 'lucide-react';
import { taxpayerApi } from '@/lib/taxpayer-api';

export const GOLD = '#d4b876';

const BELGE_EVENT = 'moren:belge-onizle';
type BelgeEvt = { loading?: boolean; url?: string; title?: string; error?: string; ozet?: string };

/** Belgeyi AI'ya özetletir; sonucu önizleme modalında metin olarak gösterir. */
export async function ozetBelge(tur: string, id: string, kind?: string, title?: string) {
  const fire = (d: BelgeEvt) => window.dispatchEvent(new CustomEvent(BELGE_EVENT, { detail: d }));
  const baslik = `${title || 'Belge'} — MOREN AI özeti`;
  fire({ loading: true, title: baslik });
  try {
    const { data } = await taxpayerApi.post(`/portal/belge/${tur}/${id}/ozet`, null, { params: kind ? { kind } : undefined });
    fire({ ozet: data?.ozet || 'Özet çıkarılamadı.', title: baslik });
  } catch {
    fire({ error: 'Özet çıkarılamadı. Daha sonra tekrar deneyin.', title: baslik });
  }
}

/**
 * Belgeyi presigned inline URL alıp SAYFA İÇİ önizleme modalında açar
 * (yeni sekme yerine — ofis paneliyle aynı deneyim). Çağrı yerleri değişmez;
 * layout'taki <BelgePreviewHost/> olayı dinler. tur: beyanname|evrak|tebligat|sgk|fatura
 */
export async function openBelge(tur: string, id: string, kind?: string, title?: string) {
  const fire = (d: BelgeEvt) => window.dispatchEvent(new CustomEvent(BELGE_EVENT, { detail: d }));
  const baslik = title || ({ beyanname: 'Beyanname', evrak: 'Evrak', tebligat: 'e-Tebligat', sgk: 'SGK Belgesi', fatura: 'Fatura' } as any)[tur] || 'Belge';
  fire({ loading: true, title: baslik });
  try {
    const { data } = await taxpayerApi.get(`/portal/belge/${tur}/${id}/view`, { params: kind ? { kind } : undefined });
    if (data?.url) fire({ url: data.url, title: baslik });
    else fire({ error: 'Belge bulunamadı.', title: baslik });
  } catch {
    fire({ error: 'Belge açılamadı. Daha sonra tekrar deneyin.', title: baslik });
  }
}

/** Sayfa içi belge önizleme modalı — layout'ta bir kez mount edilir. */
export function BelgePreviewHost() {
  const [st, setSt] = useState<BelgeEvt | null>(null);
  useEffect(() => {
    const handler = (e: Event) => setSt((e as CustomEvent).detail as BelgeEvt);
    window.addEventListener(BELGE_EVENT, handler);
    return () => window.removeEventListener(BELGE_EVENT, handler);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSt(null); };
    if (st) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st]);
  if (!st || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={() => setSt(null)}>
      <div className="flex h-[min(92vh,920px)] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl" style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.1)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <Eye size={15} style={{ color: GOLD }} />
            <span className="text-[14px] font-semibold truncate" style={{ color: '#fafaf9' }}>{st.title || 'Belge'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {st.url && (
              <a href={st.url} target="_blank" rel="noopener noreferrer" title="Yeni sekmede aç" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}><ExternalLink size={15} /></a>
            )}
            <button type="button" onClick={() => setSt(null)} title="Kapat" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.7)' }}><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: st.ozet ? '#0f0d0b' : '#1a1a1a' }}>
          {st.loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 size={26} className="animate-spin" style={{ color: GOLD }} />
              {st.title?.includes('özet') ? <span className="text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Belge okunuyor, özet hazırlanıyor…</span> : null}
            </div>
          ) : st.error ? (
            <div className="h-full flex items-center justify-center text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{st.error}</div>
          ) : st.ozet ? (
            <div className="px-5 py-4 text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: '#fafaf9' }}>{st.ozet}</div>
          ) : st.url ? (
            <iframe src={st.url} title={st.title || 'Belge'} className="w-full h-full" style={{ border: 0, background: '#fff' }} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
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
/**
 * Zengin sayfa başlığı — ofis "Aylık Takip Listesi" başlığıyla BİREBİR:
 * üst altın şerit + radial parıltı + altın ikon dairesi + Fraunces başlık + rozet/aksiyon.
 * icon: sol daire ikonu · aciklama: başlık altı rozet(ler) (string→nötr pill) · right: sağ aksiyon.
 */
export function PageTitle({ ust, baslik, icon: Icon, aciklama, right }: { ust: string; baslik: string; icon?: any; aciklama?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header
      className="relative overflow-hidden rounded-2xl border p-5 mb-4"
      style={{
        background: 'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
        borderColor: 'rgba(255,255,255,0.06)',
        boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }} />
      {ust ? (
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: '#b8a06f' }}>{ust}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {Icon ? (
            <span className="grid shrink-0 place-items-center rounded-xl" style={{ width: 46, height: 46, background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, boxShadow: '0 8px 22px rgba(212,184,118,0.30)' }}>
              <Icon size={24} style={{ color: '#1a1410' }} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.08 }}>{baslik}</h1>
            {aciklama ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {typeof aciklama === 'string'
                  ? <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' }}>{aciklama}</span>
                  : aciklama}
              </div>
            ) : null}
          </div>
        </div>
        {right ? <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{right}</div> : null}
      </div>
    </header>
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

/** Düz kart — ofis (müşavir) paneli .card dili: açık zemin, degrade/glow yok. */
export function Card({ children, accent, className = '', pad = true }: { children: React.ReactNode; accent?: string; className?: string; pad?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${pad ? 'p-5' : ''} ${className}`}
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
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
  return <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}>{children}</th>;
}
export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead style={{ background: 'rgba(255,255,255,0.025)' }}>
      <tr className="text-[10.5px] font-semibold uppercase" style={{ color: 'rgba(250,250,249,0.45)', letterSpacing: '0.12em' }}>
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
    <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
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
