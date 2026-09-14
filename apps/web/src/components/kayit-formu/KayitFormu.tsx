'use client';
import React from 'react';
import { Loader2, Save } from 'lucide-react';

// Renk sözlüğü — mükellef kartı temasıyla (mukellefler/[id]/_lib/tema.ts) aynı değerler.
const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const ALTIN_SOLUK = 'rgba(212,184,118,0.85)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const FAINT = 'rgba(250,250,249,0.36)';
const HAIR = 'rgba(255,255,255,0.06)';
const LINE = 'rgba(255,255,255,0.10)';
const GREEN = '#5fcf8e';
const AMBER = '#f0b755';
const R_ALAN = 8;
const GRUP_ZEMIN = 'rgba(212,184,118,0.12)';
const GRUP_CIZGI = '1px solid rgba(212,184,118,0.40)';
const NOTR_DUGME = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, color: MUTED, borderRadius: R_ALAN } as const;

/**
 * KAYIT FORMU DİLİ (2026-09-14) — mükellef kartındaki tüm pencereler ve paylaşılan kartlar bu parçalarla kurulur.
 *
 * - FormGrup : altın büyük harf bant başlık (tablolardaki grup bandıyla aynı dil) + satır ızgarası
 * - Satir    : etiket SOLDA sabit sütun (12.5px), alan SAĞDA; ipucu alanın altında
 * - AlanGirdi / AlanSecim / AlanMetin : 36px, hafif açık zemin, ince kenar, altın odak
 * - Anahtar  : satır içi şalter + "Açık/Kapalı" yazısı + açıklama
 * - FormAltBilgi : sağda nötr Güncelle, solda kısa not
 */

// ── Alan stilleri (tek kaynak) ──
const ALAN_TEMEL =
  'w-full rounded-[6px] border border-white/[0.10] bg-white/[0.045] text-[13.5px] font-medium text-[#fafaf9] outline-none transition-colors duration-150 placeholder:text-white/30 hover:border-white/[0.20] hover:bg-white/[0.06] focus:border-[#d4b876]/70 focus:bg-white/[0.06] focus:shadow-[0_0_0_2px_rgba(212,184,118,0.16)] disabled:opacity-50';
export const GIRDI_CLS = `${ALAN_TEMEL} h-9 px-3`;
export const SECIM_CLS = `${GIRDI_CLS} cursor-pointer pr-8`;
export const METIN_CLS = `${ALAN_TEMEL} min-h-[72px] resize-y px-3 py-2 leading-[1.45]`;

export function AlanGirdi({ className = '', mono, style, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...props}
      className={`${GIRDI_CLS} ${mono ? 'font-mono tracking-[0.04em]' : ''} ${className}`}
      style={{ colorScheme: 'dark', ...(style || {}) }}
    />
  );
}

export function AlanSecim({ className = '', style, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${SECIM_CLS} appearance-none ${className}`} style={{ colorScheme: 'dark', ...(style || {}) }}>
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: MUTED }}>
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function AlanMetin({ className = '', style, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${METIN_CLS} ${className}`} style={{ colorScheme: 'dark', ...(style || {}) }} />;
}

/** Alan içinde sağa yaslı kısa ek (ör. "gün", "₺"). */
export function AlanEk({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: FAINT }}>
      {children}
    </span>
  );
}

// ── Grup ──
export function FormGrup({
  baslik,
  aciklama,
  sag,
  children,
  sutun = 2,
  className = '',
}: {
  baslik: string;
  aciklama?: string;
  /** Bant sağına küçük bilgi (ör. sayaç, durum çipi). */
  sag?: React.ReactNode;
  children: React.ReactNode;
  /** Satır ızgarası sütun sayısı (1 | 2 | 3). */
  sutun?: 1 | 2 | 3;
  className?: string;
}) {
  const sutunCls = sutun === 1 ? 'grid-cols-1' : sutun === 3 ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 md:grid-cols-2';
  return (
    <section className={`overflow-hidden ${className}`} style={{ border: `1px solid ${LINE}`, borderRadius: R_ALAN }}>
      <header
        className="flex min-h-[32px] items-center gap-3 px-3.5"
        style={{ background: GRUP_ZEMIN, borderBottom: GRUP_CIZGI, boxShadow: `inset 3px 0 0 ${GOLD}` }}
      >
        <span className="text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: ALTIN_SOLUK }}>{baslik}</span>
        {aciklama && <span className="hidden truncate text-[11.5px] sm:inline" style={{ color: FAINT }}>{aciklama}</span>}
        {sag && <span className="ml-auto flex items-center gap-2">{sag}</span>}
      </header>
      <div className={`grid gap-x-8 gap-y-2.5 px-3.5 py-3.5 ${sutunCls}`} style={{ background: 'rgba(0,0,0,0.16)' }}>
        {children}
      </div>
    </section>
  );
}

// ── Satır ──
export function Satir({
  etiket,
  zorunlu,
  ipucu,
  genis,
  hizala = 'orta',
  children,
  htmlFor,
}: {
  etiket: React.ReactNode;
  zorunlu?: boolean;
  /** Alanın altında 11px açıklama. */
  ipucu?: React.ReactNode;
  /** Izgarada tüm sütunları kaplar. */
  genis?: boolean;
  /** Çok satırlı alanlarda etiketi üste hizala. */
  hizala?: 'orta' | 'ust';
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const Etiket = htmlFor ? 'label' : 'div';
  return (
    <div className={`grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 ${genis ? 'md:col-span-full' : ''}`} style={{ alignItems: hizala === 'ust' ? 'start' : 'center' }}>
      <Etiket
        {...(htmlFor ? { htmlFor } : {})}
        className={`text-[12.5px] font-medium leading-4 ${hizala === 'ust' ? 'pt-2.5' : ''}`}
        style={{ color: 'rgba(250,250,249,0.72)' }}
      >
        {etiket}
        {zorunlu && <span style={{ color: AMBER }}> *</span>}
      </Etiket>
      <div className="min-w-0">
        {children}
        {ipucu && <div className="mt-1 text-[11px] leading-4" style={{ color: FAINT }}>{ipucu}</div>}
      </div>
    </div>
  );
}

/** Alan + sağında ikinci alan (telefon | ad gibi) — oranlar `oran` ile. */
export function AlanCifti({ children, oran = '1fr 0.8fr' }: { children: React.ReactNode; oran?: string }) {
  return <div className="grid gap-2" style={{ gridTemplateColumns: oran }}>{children}</div>;
}

// ── Şalter satırı ──
export function Anahtar({
  checked,
  onChange,
  aciklama,
  acikYazi = 'Açık',
  kapaliYazi = 'Kapalı',
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  aciklama?: React.ReactNode;
  acikYazi?: string;
  kapaliYazi?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-9 items-center gap-2.5 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <Salter checked={checked} disabled={disabled} />
      <span className="text-[13px] font-medium" style={{ color: checked ? GREEN : MUTED }}>{checked ? acikYazi : kapaliYazi}</span>
      {aciklama && <span className="text-[11.5px]" style={{ color: FAINT }}>· {aciklama}</span>}
    </label>
  );
}

/** Salt görsel şalter (36×20). */
export function Salter({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-150"
      style={{ background: checked ? GREEN : 'rgba(255,255,255,0.14)', opacity: disabled ? 0.4 : 1, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)' }}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-full transition-[left] duration-150"
        style={{ left: checked ? 18 : 2, background: checked ? '#0f0d0b' : '#fafaf9', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
      />
    </span>
  );
}

// ── Bölümlü seçici (kompakt, satır içi) ──
export function Secici({
  value,
  options,
  onChange,
  vurgu = 'altin',
}: {
  value: string;
  /** `pasif`: seçiliyken vurgu yerine nötr görünür (ör. "Yok"). */
  options: { value: string; label: string; pasif?: boolean }[];
  onChange: (v: string) => void;
  vurgu?: 'altin' | 'yesil';
}) {
  return (
    <div className="inline-flex h-9 max-w-full overflow-x-auto p-[3px] [scrollbar-width:none]" style={{ border: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.30)', borderRadius: 6 }}>
      {options.map((o) => {
        const on = value === o.value;
        const dolu = o.pasif
          ? { background: 'rgba(255,255,255,0.10)', color: TEXT, fontWeight: 700 }
          : vurgu === 'yesil'
            ? { background: 'rgba(95,207,142,0.18)', color: '#9ae6b8', fontWeight: 700 }
            : { background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', fontWeight: 700 };
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="whitespace-nowrap rounded-[4px] px-4 text-[12.5px] transition-colors duration-150"
            style={on ? dolu : { color: MUTED, background: 'transparent', fontWeight: 500 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Durum çipi (Kayıtlı / Kayıt yok / Doğrulandı) ──
export function DurumCipi({ ton, children }: { ton: 'yesil' | 'amber' | 'notr'; children: React.ReactNode }) {
  const st =
    ton === 'yesil'
      ? { background: 'rgba(95,207,142,0.10)', border: '1px solid rgba(95,207,142,0.30)', color: GREEN }
      : ton === 'amber'
        ? { background: 'rgba(240,183,85,0.10)', border: '1px solid rgba(240,183,85,0.30)', color: AMBER }
        : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`, color: MUTED };
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium" style={st}>
      {children}
    </span>
  );
}

// ── Alt bilgi / kaydet ──
export function FormAltBilgi({
  onSave,
  saving,
  hasRecord,
  not,
  dugmeYazi,
  vurgulu,
}: {
  onSave: () => void;
  saving: boolean;
  hasRecord?: boolean;
  not?: React.ReactNode;
  dugmeYazi?: string;
  /** Altın dolgulu düğme (bölümün kendi ayrı kaydı varsa). */
  vurgulu?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: HAIR }}>
      <span className="text-[11.5px]" style={{ color: FAINT }}>
        {not ?? 'Bu bölümdeki değişiklikler üstteki Kaydet ile de kaydedilir.'}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex h-9 items-center gap-2 px-4 text-[13px] font-medium transition hover:brightness-110 disabled:opacity-50"
        style={vurgulu ? { background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', borderRadius: R_ALAN, fontWeight: 700 } : { ...NOTR_DUGME, color: TEXT }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {dugmeYazi ?? (hasRecord ? 'Güncelle' : 'Kaydet')}
      </button>
    </div>
  );
}
