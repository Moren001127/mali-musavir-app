'use client';

import React from 'react';
import { X, Loader2 } from 'lucide-react';

/* ===== Palet — portal imzası (koyu zemin + altın aksan) ===== */
export const GOLD = '#e6c878';
export const GOLD_SOFT = '#d4b876';
export const OK = '#5ad18a';
export const KIRMIZI = '#e0697a';
export const TURUNCU = '#d9a06c';
export const MAVI = '#8cbde8';
export const MOR = '#b0a0e0';
export const TEXT = '#e7e7ea';
export const MUTED = '#71717a';
export const CARD_BG = 'rgba(255,255,255,0.018)';
export const CARD_BORDER = 'rgba(255,255,255,0.06)';
export const ROW_SEP = 'rgba(255,255,255,0.05)';

/* ===== Kutu ===== */
export function Kutu({
  baslik,
  aciklama,
  renk = GOLD,
  sag,
  children,
  className = '',
  style,
}: {
  baslik?: React.ReactNode;
  aciklama?: string;
  renk?: string;
  sag?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
        ...style,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${renk}66, transparent)` }}
      />
      {baslik && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <h3 className="text-[13px] font-semibold tracking-wide" style={{ color: TEXT }}>
              {baslik}
            </h3>
            {aciklama && (
              <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                {aciklama}
              </p>
            )}
          </div>
          {sag}
        </header>
      )}
      <div className={baslik ? 'px-5 pb-5' : 'p-5'}>{children}</div>
    </section>
  );
}

/* ===== KPI kartı ===== */
export function KPI({
  etiket,
  deger,
  altBilgi,
  renk = GOLD,
  ikon,
  vurgu,
}: {
  etiket: string;
  deger: string;
  altBilgi?: string;
  renk?: string;
  ikon?: React.ReactNode;
  vurgu?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl px-4 py-3.5"
      style={{
        background: vurgu
          ? `linear-gradient(140deg, ${renk}1f, rgba(255,255,255,0.01) 60%)`
          : CARD_BG,
        border: `1px solid ${vurgu ? `${renk}3d` : CARD_BORDER}`,
        boxShadow: '0 14px 32px rgba(0,0,0,0.20)',
      }}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.16]"
        style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }}
      />
      <div className="flex items-center gap-2">
        {ikon && <span style={{ color: renk }}>{ikon}</span>}
        <span className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
          {etiket}
        </span>
      </div>
      <div className="mt-1.5 text-[21px] font-semibold tabular-nums" style={{ color: renk }}>
        {deger}
      </div>
      {altBilgi && (
        <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
          {altBilgi}
        </div>
      )}
    </div>
  );
}

/* ===== Rozet ===== */
export function Rozet({ metin, renk = GOLD }: { metin: string; renk?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `${renk}1f`, border: `1px solid ${renk}44`, color: renk }}
    >
      {metin}
    </span>
  );
}

/* ===== Düğme ===== */
export function Dugme({
  children,
  onClick,
  tur = 'ikincil',
  renk = GOLD,
  yukleniyor,
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tur?: 'birincil' | 'ikincil' | 'sade' | 'tehlike';
  renk?: string;
  yukleniyor?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const c = tur === 'tehlike' ? KIRMIZI : renk;
  const stiller: React.CSSProperties =
    tur === 'birincil'
      ? { background: `linear-gradient(140deg, ${c}dd, ${c}99)`, color: '#0b0b0d', border: `1px solid ${c}` }
      : tur === 'sade'
        ? { background: 'transparent', color: MUTED, border: '1px solid transparent' }
        : { background: `${c}14`, color: c, border: `1px solid ${c}3d` };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || yukleniyor}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={stiller}
    >
      {yukleniyor && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ===== Form alanı ===== */
export function Alan({
  etiket,
  children,
  ipucu,
  genis,
}: {
  etiket: string;
  children: React.ReactNode;
  ipucu?: string;
  genis?: boolean;
}) {
  return (
    <label className={`block ${genis ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-[11px] font-medium" style={{ color: MUTED }}>
        {etiket}
      </span>
      {children}
      {ipucu && (
        <span className="mt-1 block text-[10px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
          {ipucu}
        </span>
      )}
    </label>
  );
}

export const girdiStil: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.03)',
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 13,
  color: TEXT,
  outline: 'none',
};

export function Girdi(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...girdiStil, ...(props.style || {}) }} />;
}

export function Secim(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{ ...girdiStil, ...(props.style || {}) }}
      className={`[&>option]:bg-[#0c0c0e] ${props.className || ''}`}
    />
  );
}

/* ===== Modal ===== */
export function Modal({
  baslik,
  aciklama,
  kapat,
  children,
  genislik = 560,
}: {
  baslik: string;
  aciklama?: string;
  kapat: () => void;
  children: React.ReactNode;
  genislik?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
      onClick={kapat}
    >
      <div
        className="relative w-full rounded-2xl"
        style={{
          maxWidth: genislik,
          background: 'linear-gradient(160deg, #0f0f12, #0a0a0c)',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${GOLD}55, transparent)` }}
        />
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: TEXT }}>
              {baslik}
            </h3>
            {aciklama && (
              <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                {aciklama}
              </p>
            )}
          </div>
          <button
            onClick={kapat}
            className="rounded-lg p-1 transition hover:bg-white/[0.06]"
            style={{ color: MUTED }}
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

/* ===== Boş durum ===== */
export function Bos({ metin, ikon }: { metin: string; ikon?: React.ReactNode }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl py-10 text-center"
      style={{ border: `1px dashed ${CARD_BORDER}`, color: MUTED }}
    >
      {ikon}
      <span className="text-[12px]">{metin}</span>
    </div>
  );
}

/* ===== Yükleniyor ===== */
export function Yukleniyor({ metin = 'Yükleniyor…' }: { metin?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12px]" style={{ color: MUTED }}>
      <Loader2 size={15} className="animate-spin" />
      {metin}
    </div>
  );
}

/* ===== Basit çubuk grafik (gelir/gider trendi) ===== */
export function TrendGrafik({
  veri,
  yukseklik = 132,
}: {
  veri: Array<{ donem: string; gelir: number; gider: number }>;
  yukseklik?: number;
}) {
  const max = Math.max(1, ...veri.flatMap((v) => [v.gelir, v.gider]));
  const genislikBirim = 100 / Math.max(veri.length, 1);
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${yukseklik}`} preserveAspectRatio="none" style={{ width: '100%', height: yukseklik }}>
        {[0.25, 0.5, 0.75].map((o) => (
          <line
            key={o}
            x1="0"
            x2="100"
            y1={yukseklik * o}
            y2={yukseklik * o}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        ))}
        {veri.map((v, i) => {
          const x = i * genislikBirim;
          const bar = genislikBirim * 0.3;
          const gy = (v.gelir / max) * (yukseklik - 18);
          const gdy = (v.gider / max) * (yukseklik - 18);
          return (
            <g key={v.donem}>
              <rect
                x={x + genislikBirim * 0.14}
                y={yukseklik - 14 - gy}
                width={bar}
                height={Math.max(gy, 0.6)}
                rx="1"
                fill={OK}
                opacity="0.85"
              />
              <rect
                x={x + genislikBirim * 0.5}
                y={yukseklik - 14 - gdy}
                width={bar}
                height={Math.max(gdy, 0.6)}
                rx="1"
                fill={KIRMIZI}
                opacity="0.85"
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: MUTED }}>
        {veri.map((v) => (
          <span key={v.donem} className="flex-1 text-center">
            {v.donem.slice(5)}.{v.donem.slice(2, 4)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-[10px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: OK }} /> Gelir
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: KIRMIZI }} /> Gider
        </span>
      </div>
    </div>
  );
}

/* ===== Yatay oran çubuğu (kategori kırılımı) ===== */
export function OranCubugu({
  kalemler,
}: {
  kalemler: Array<{ ad: string; tutar: number; renk: string }>;
}) {
  const toplam = kalemler.reduce((t, k) => t + k.tutar, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {kalemler.map((k) => (
          <div key={k.ad} style={{ width: `${(k.tutar / toplam) * 100}%`, background: k.renk }} title={k.ad} />
        ))}
      </div>
    </div>
  );
}
