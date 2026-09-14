'use client';
import React from 'react';
import { Loader2, Save } from 'lucide-react';

/**
 * KAYIT FORMU DİLİ v2 (2026-09-14, Muzaffer Bey: "altın serisi, tek aralıklı rakamlar, düğmeler — saçma;
 * renk uyumu ve tablo düzeni düzgün olsun") — SAKİN ve NÖTR:
 *
 * - Altın YOK (altın yalnız kart başlığındaki Kaydet'te kalır). Vurgu rengi: çelik mavi (odak, seçili parça, bölüm kaydı).
 * - FormGrup : küçük soluk büyük harf başlık + ince çizgi; bant/dolgu/sol şerit YOK.
 * - Satir    : etiket SOLDA sabit sütun (13px), alan SAĞDA; ipucu alanın altında.
 * - AlanGirdi / AlanSecim / AlanMetin : 38px, koyu zemin, ince kenar, normal yazı tipi (rakamlar da; tabular-nums).
 * - Secici   : nötr; seçili parça açık dolgu + parlak yazı. Pasif seçenek ("Yok") seçiliyken daha soluk.
 * - Anahtar  : şalter (açık = yeşil) + Açık/Kapalı.
 * - FormAltBilgi : solda kısa not, sağda düğme (nötr Güncelle; `vurgulu` = çelik mavi dolgu).
 */

// ── Renk sözlüğü ──
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.60)';
const FAINT = 'rgba(250,250,249,0.38)';
const HAIR = 'rgba(255,255,255,0.07)';
const LINE = 'rgba(255,255,255,0.10)';
const GREEN = '#5fcf8e';
const AMBER = '#f0b755';
const STEEL = '#4f86c9';
const STEEL_BR = '#74a6e6';
export const ALAN_ZEMIN = '#0f1013';
const R = 8;

// ── Alan stilleri (tek kaynak) ──
const ALAN_TEMEL =
  'w-full rounded-[8px] border border-white/[0.09] bg-[#0f1013] text-[14px] font-medium text-[#fafaf9] tabular-nums outline-none transition-colors duration-150 placeholder:text-white/28 hover:border-white/[0.18] focus:border-[#4f86c9] focus:shadow-[0_0_0_3px_rgba(79,134,201,0.18)] disabled:opacity-50';
export const GIRDI_CLS = `${ALAN_TEMEL} h-[38px] px-3.5`;
export const SECIM_CLS = `${GIRDI_CLS} cursor-pointer pr-9`;
export const METIN_CLS = `${ALAN_TEMEL} min-h-[76px] resize-y px-3.5 py-2.5 leading-[1.5]`;

export function AlanGirdi({ className = '', mono: _mono, style, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  // `mono` geriye uyumluluk için kabul edilir, uygulanmaz (rakamlar normal yazı tipinde, tabular-nums).
  return <input {...props} className={`${GIRDI_CLS} ${className}`} style={{ colorScheme: 'dark', ...(style || {}) }} />;
}

export function AlanSecim({ className = '', style, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${SECIM_CLS} appearance-none ${className}`} style={{ colorScheme: 'dark', ...(style || {}) }}>
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: MUTED }}>
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function AlanMetin({ className = '', style, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${METIN_CLS} ${className}`} style={{ colorScheme: 'dark', ...(style || {}) }} />;
}

/** Alan içinde sağa yaslı kısa ek (ör. "gün"). */
export function AlanEk({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12.5px]" style={{ color: FAINT }}>
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
  /** Başlık satırının sağına küçük bilgi (durum çipi, sayaç). */
  sag?: React.ReactNode;
  children: React.ReactNode;
  /** Satır ızgarası sütun sayısı (1 | 2 | 3). */
  sutun?: 1 | 2 | 3;
  className?: string;
}) {
  const sutunCls = sutun === 1 ? 'grid-cols-1' : sutun === 3 ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 md:grid-cols-2';
  return (
    <section className={className}>
      <header className="mb-3 flex min-h-[26px] items-center gap-3 border-b pb-2" style={{ borderColor: LINE }}>
        <span className="text-[11.5px] font-bold uppercase tracking-[0.10em]" style={{ color: 'rgba(250,250,249,0.50)' }}>{baslik}</span>
        {aciklama && <span className="hidden truncate text-[12px] sm:inline" style={{ color: FAINT }}>{aciklama}</span>}
        {sag && <span className="ml-auto flex items-center gap-2">{sag}</span>}
      </header>
      <div className={`grid gap-x-10 gap-y-3 ${sutunCls}`}>{children}</div>
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
  /** Alanın altında 12px açıklama. */
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
    <div className={`grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 ${genis ? 'md:col-span-full' : ''}`} style={{ alignItems: hizala === 'ust' ? 'start' : 'center' }}>
      <Etiket
        {...(htmlFor ? { htmlFor } : {})}
        className={`text-[13px] font-medium leading-[18px] ${hizala === 'ust' ? 'pt-2.5' : ''}`}
        style={{ color: 'rgba(250,250,249,0.74)' }}
      >
        {etiket}
        {zorunlu && <span style={{ color: AMBER }}> *</span>}
      </Etiket>
      <div className="min-w-0">
        {children}
        {ipucu && <div className="mt-1 text-[12px] leading-4" style={{ color: FAINT }}>{ipucu}</div>}
      </div>
    </div>
  );
}

/** Alan + sağında ikinci alan (telefon | ad gibi). */
export function AlanCifti({ children, oran = '1fr 0.9fr' }: { children: React.ReactNode; oran?: string }) {
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
    <label className={`flex min-h-[38px] items-center gap-2.5 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <Salter checked={checked} disabled={disabled} />
      <span className="text-[13.5px] font-medium" style={{ color: checked ? GREEN : MUTED }}>{checked ? acikYazi : kapaliYazi}</span>
      {aciklama && <span className="text-[12px]" style={{ color: FAINT }}>· {aciklama}</span>}
    </label>
  );
}

/** Salt görsel şalter (38×22). */
export function Salter({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150"
      style={{ background: checked ? GREEN : 'rgba(255,255,255,0.16)', opacity: disabled ? 0.4 : 1, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)' }}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full transition-[left] duration-150"
        style={{ left: checked ? 18 : 2, background: '#fafaf9', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
      />
    </span>
  );
}

// ── Bölümlü seçici (nötr, satır içi) ──
export function Secici({
  value,
  options,
  onChange,
  boy = 'orta',
}: {
  value: string;
  /** `pasif`: seçiliyken açık dolgu yerine soluk görünür (ör. "Yok"). */
  options: { value: string; label: string; pasif?: boolean }[];
  onChange: (v: string) => void;
  boy?: 'orta' | 'kucuk';
}) {
  const h = boy === 'kucuk' ? 'h-[30px]' : 'h-[38px]';
  const px = boy === 'kucuk' ? 'px-3' : 'px-4';
  const fs = boy === 'kucuk' ? 'text-[12.5px]' : 'text-[13.5px]';
  return (
    <div className={`inline-flex ${h} max-w-full overflow-x-auto p-[3px] [scrollbar-width:none]`} style={{ border: `1px solid ${LINE}`, background: ALAN_ZEMIN, borderRadius: R }}>
      {options.map((o) => {
        const on = value === o.value;
        const seciliStil = o.pasif
          ? { background: 'rgba(255,255,255,0.06)', color: MUTED, fontWeight: 600 }
          : { background: 'rgba(255,255,255,0.14)', color: TEXT, fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' };
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-[6px] ${px} ${fs} transition-colors duration-150 hover:text-white`}
            style={on ? seciliStil : { color: MUTED, background: 'transparent', fontWeight: 500 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Durum çipi ──
export function DurumCipi({ ton, children }: { ton: 'yesil' | 'amber' | 'mavi' | 'notr'; children: React.ReactNode }) {
  const st =
    ton === 'yesil'
      ? { background: 'rgba(95,207,142,0.10)', border: '1px solid rgba(95,207,142,0.30)', color: GREEN }
      : ton === 'amber'
        ? { background: 'rgba(240,183,85,0.10)', border: '1px solid rgba(240,183,85,0.30)', color: AMBER }
        : ton === 'mavi'
          ? { background: 'rgba(79,134,201,0.12)', border: '1px solid rgba(79,134,201,0.32)', color: STEEL_BR }
          : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`, color: MUTED };
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-medium" style={st}>
      {children}
    </span>
  );
}

/** Küçük durum noktası + yazı (tablo hücreleri için). */
export function DurumNoktasi({ acik, acikYazi = 'Takipte', kapaliYazi = 'Takip dışı' }: { acik: boolean; acikYazi?: string; kapaliYazi?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium" style={{ color: acik ? GREEN : FAINT }}>
      <span className="h-2 w-2 rounded-full" style={{ background: acik ? GREEN : 'rgba(255,255,255,0.18)' }} />
      {acik ? acikYazi : kapaliYazi}
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
  /** Çelik mavi dolgulu düğme (bölümün kendi ayrı kaydı varsa). */
  vurgulu?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: HAIR }}>
      <span className="text-[12px]" style={{ color: FAINT }}>
        {not ?? 'Bu bölümdeki değişiklikler üstteki Kaydet ile de kaydedilir.'}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex h-[38px] items-center gap-2 px-4 text-[13.5px] font-semibold transition hover:brightness-110 disabled:opacity-50"
        style={
          vurgulu
            ? { background: STEEL, color: '#fff', borderRadius: R, boxShadow: '0 4px 14px rgba(79,134,201,0.25)' }
            : { background: 'rgba(255,255,255,0.05)', border: `1px solid ${LINE}`, color: TEXT, borderRadius: R }
        }
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {dugmeYazi ?? (hasRecord ? 'Güncelle' : 'Kaydet')}
      </button>
    </div>
  );
}

// ── Tablo (form içi gerçek tablo; yatay ince çizgiler, dikey çizgi yok) ──
export const TABLO_BASLIK: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.10em',
  textTransform: 'uppercase',
  color: 'rgba(250,250,249,0.50)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderBottom: `1px solid ${LINE}`,
  background: 'rgba(255,255,255,0.025)',
};
export const TABLO_HUCRE: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
  fontSize: 13.5,
  borderBottom: `1px solid ${HAIR}`,
};
export const TABLO_GRUP: React.CSSProperties = {
  padding: '7px 12px',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.10em',
  textTransform: 'uppercase',
  color: 'rgba(250,250,249,0.50)',
  background: 'rgba(255,255,255,0.03)',
  borderTop: `1px solid ${LINE}`,
  borderBottom: `1px solid ${HAIR}`,
};
export const TABLO_SARMAL: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: R, overflow: 'hidden', background: 'rgba(0,0,0,0.14)' };
