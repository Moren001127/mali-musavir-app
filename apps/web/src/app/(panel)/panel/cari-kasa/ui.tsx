'use client';

/**
 * CARİ KASA — ORTAK TASARIM DİLİ.
 *
 * Modül portalın geri kalanından kopuktu: düz gri kutular, renk şeridi yok,
 * derinlik yok. Kişisel Bütçe modülünde kullanılan ve beğenilen dil buraya
 * taşındı — tek kaynak olsun diye oradan yeniden dışa aktarılıyor, kopyalanmıyor.
 *
 * Dilin üç işareti:
 *   1. Kartın üstünde ince renk şeridi
 *   2. Köşede radial parıltı
 *   3. Vurgulu kartta gradyan zemin
 */

export {
  Kutu,
  KPI,
  Rozet,
  Dugme,
  Alan,
  Girdi,
  Secim,
  Bos,
  Yukleniyor,
  Modal,
  Anahtar,
  ParaGirdi,
  paraCoz,
  paraGiris,
  RenkSecici,
  PALET,
  GOLD,
  OK,
  KIRMIZI,
  TURUNCU,
  MAVI,
  MOR,
  MUTED,
  TEXT,
  ROW_SEP,
  CARD_BORDER,
  CARD_BG,
} from '../butce/ui';

import React from 'react';
import { CARD_BG, CARD_BORDER, MUTED, TEXT } from '../butce/ui';

/**
 * Sayfa üstü bölüm başlığı — her görünümün tepesinde aynı biçimde durur.
 * Solda renkli ikon kutusu, ortada başlık + açıklama, sağda eylemler.
 */
export function BolumBasligi({
  ikon,
  baslik,
  aciklama,
  renk,
  sag,
}: {
  ikon: React.ReactNode;
  baslik: string;
  aciklama?: string;
  renk: string;
  sag?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{
            background: `linear-gradient(140deg, ${renk}26, rgba(255,255,255,0.01) 65%)`,
            border: `1px solid ${renk}33`,
            color: renk,
          }}
        >
          {ikon}
        </span>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: TEXT }}>
            {baslik}
          </div>
          {aciklama && (
            <div className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
              {aciklama}
            </div>
          )}
        </div>
      </div>
      {sag && <div className="flex flex-wrap items-center gap-2">{sag}</div>}
    </div>
  );
}

/**
 * Tıklanabilir sayaç kutusu — "bugün ne yapmalıyım" kuyrukları için.
 * Seçiliyken gradyan zemine ve renkli kenara geçer.
 */
export function SayacKutusu({
  etiket,
  aciklama,
  sayi,
  tutar,
  renk,
  ikon,
  aktif,
  onClick,
}: {
  etiket: string;
  aciklama?: string;
  sayi: number | string;
  tutar?: string;
  renk: string;
  ikon?: React.ReactNode;
  aktif?: boolean;
  onClick?: () => void;
}) {
  const tiklanabilir = Boolean(onClick);
  return (
    <button
      onClick={onClick}
      disabled={!tiklanabilir}
      className="relative overflow-hidden rounded-2xl px-4 py-3.5 text-left transition disabled:cursor-default"
      style={{
        background: aktif
          ? `linear-gradient(140deg, ${renk}24, rgba(255,255,255,0.01) 62%)`
          : CARD_BG,
        border: `1px solid ${aktif ? `${renk}47` : CARD_BORDER}`,
        boxShadow: aktif ? `0 16px 34px -22px ${renk}` : '0 14px 32px rgba(0,0,0,0.20)',
      }}
    >
      <span
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.16]"
        style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }}
      />
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        {ikon && <span style={{ color: renk }}>{ikon}</span>}
        {etiket}
      </span>
      <span className="mt-1.5 block text-[21px] font-semibold tabular-nums" style={{ color: renk }}>
        {sayi}
      </span>
      <span className="mt-0.5 flex items-baseline justify-between gap-2">
        {aciklama && (
          <span className="text-[11px]" style={{ color: MUTED }}>
            {aciklama}
          </span>
        )}
        {tutar && (
          <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>
            {tutar}
          </span>
        )}
      </span>
    </button>
  );
}

/** Liste satırlarını saran kart — üstte renk şeridi, içeride ayraçlı satırlar */
export function ListeKarti({
  baslik,
  sayi,
  renk,
  sag,
  children,
}: {
  baslik: React.ReactNode;
  sayi?: number;
  renk: string;
  sag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${renk}66, transparent)` }}
      />
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: TEXT }}>
            {baslik}
          </span>
          {sayi !== undefined && (
            <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>
              {sayi}
            </span>
          )}
        </span>
        {sag}
      </header>
      {children}
    </section>
  );
}

export const paraTR = (n?: number | null) =>
  `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

export const paraKisa = (n?: number | null) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M ₺`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000).toLocaleString('tr-TR')}B ₺`;
  return `${Math.round(v)} ₺`;
};

export const tarihTR = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
