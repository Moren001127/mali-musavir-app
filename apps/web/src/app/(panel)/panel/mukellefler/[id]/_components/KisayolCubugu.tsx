'use client';
import { portalStyle } from '@/lib/portal-theme';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Search, Zap } from 'lucide-react';
import { FAINT, GOLD, HAIR, LINE, MUTED, R_ALAN, TEXT, ikonRozeti, kartZemin } from '../_lib/tema';
import { KISAYOL_GRUPLARI, kisayolFold, type Kisayol } from '../_lib/kisayollar';

const ACIK_ANAHTAR = 'mukellef-kisayol-acik';

/**
 * Kısayollar & Sorgulamalar — "A: daraltılmış çubuk".
 * Tek satır: ⚡ · başlık · "N bağlantı" · grup hapları · arama · açma oku. Tıklayınca altına sıkı ızgara açılır.
 * Açık/kapalı tercihi localStorage'da (varsayılan KAPALI). Grup hapı: açar + o gruba kaydırır.
 * Kısayolların çoğu şimdilik dış bağlantı; `sorguTuru` alanı ileride gerçek sorgulara bağlanmak için hazır (kullanılmıyor).
 */
export function KisayolIcerik({
  vkn,
  onKisayol,
}: {
  vkn: string;
  onKisayol: (k: Kisayol) => void;
}) {
  const [q, setQ] = useState('');
  const [acik, setAcik] = useState(false);
  const [hedefGrup, setHedefGrup] = useState<string | null>(null);
  const grupRef = useRef<Record<string, HTMLDivElement | null>>({});

  const qn = kisayolFold(q.trim());
  const gosterilenAcik = acik || !!qn;

  // Tercihi yalnız istemcide oku (hidrasyon uyuşmazlığı olmasın)
  useEffect(() => {
    try { setAcik(localStorage.getItem(ACIK_ANAHTAR) === '1'); } catch { /* yok say */ }
  }, []);

  const acKapat = (v: boolean) => {
    setAcik(v);
    try { localStorage.setItem(ACIK_ANAHTAR, v ? '1' : '0'); } catch { /* yok say */ }
  };
  /** Ok/başlık tıklaması: görünen durumu tersine çevirir; arama zorlamasıyla açıksa kapatırken aramayı da temizler. */
  const tersineCevir = () => {
    if (gosterilenAcik) { acKapat(false); setQ(''); } else acKapat(true);
  };

  // Grup hapına tıklanınca: açık değilse aç, sonra gruba kaydır
  useEffect(() => {
    if (!acik || !hedefGrup) return;
    const el = grupRef.current[hedefGrup];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHedefGrup(null);
  }, [acik, hedefGrup]);

  const gruplar = KISAYOL_GRUPLARI
    .map((g) => ({ ...g, items: qn ? g.items.filter((k) => kisayolFold(k.label).includes(qn)) : g.items }))
    .filter((g) => g.items.length > 0);
  const toplam = KISAYOL_GRUPLARI.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="overflow-hidden" style={portalStyle(kartZemin())}>
      {/* Daraltılmış çubuk */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={tersineCevir}
          aria-expanded={gosterilenAcik}
          className="flex min-w-0 items-center gap-2.5 text-left"
          title={gosterilenAcik ? 'Kısayolları daralt' : 'Kısayolları aç'}
        >
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center" style={portalStyle(ikonRozeti(GOLD))}>
            <Zap size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold leading-5" style={portalStyle({ color: TEXT })}>Kısayollar &amp; Sorgulamalar</span>
            <span className="block truncate text-[11.5px]" style={portalStyle({ color: MUTED })}>{vkn ? `VKN ${vkn} · ${toplam} bağlantı` : `${toplam} bağlantı`}</span>
          </span>
        </button>

        <span className="mx-1 hidden h-5 w-px sm:block" style={portalStyle({ background: LINE })} />

        {/* Grup hapları */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {KISAYOL_GRUPLARI.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { if (!acik) acKapat(true); setHedefGrup(g.id); }}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-medium transition hover:brightness-125"
              style={portalStyle({ border: `1px solid ${LINE}`, color: MUTED, background: 'rgba(255,255,255,0.02)' })}
              title={`${g.baslik} — ${g.aciklama}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: g.renk, opacity: 0.9 })} />
              {g.baslik}
              <span className="tabular-nums" style={portalStyle({ color: FAINT })}>{g.items.length}</span>
            </button>
          ))}
        </div>

        {/* Arama */}
        <div className="relative w-full shrink-0 sm:w-[170px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={portalStyle({ color: MUTED })} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            placeholder="Kısayol ara…"
            aria-label="Kısayol ara"
            className="h-8 w-full rounded-full border border-white/[0.10] pl-8 pr-3 text-[13px] font-medium outline-none transition-colors placeholder:text-white/25 hover:border-white/[0.18] focus:border-[#d4b876]/60"
            style={portalStyle({ background: 'rgba(0,0,0,0.30)', color: TEXT })}
          />
        </div>

        <button
          type="button"
          onClick={tersineCevir}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-white/[0.06]"
          style={portalStyle({ color: MUTED })}
          title={gosterilenAcik ? 'Daralt' : 'Aç'}
          aria-label={gosterilenAcik ? 'Kısayolları daralt' : 'Kısayolları aç'}
        >
          <ChevronDown size={16} className="transition-transform duration-200" style={portalStyle({ transform: gosterilenAcik ? 'rotate(180deg)' : 'rotate(0deg)' })} />
        </button>
      </div>

      {/* Açılan sıkı ızgara */}
      {gosterilenAcik && (
        <div className="space-y-4 border-t px-3 pb-3 pt-3" style={portalStyle({ borderColor: HAIR })}>
          {gruplar.map((g) => {
            const Icon = g.ikon;
            return (
              <div key={g.id} ref={(el) => { grupRef.current[g.id] = el; }} className="scroll-mt-2">
                <div className="mb-2 flex items-center gap-2 border-b pb-1.5" style={portalStyle({ borderColor: HAIR })}>
                  <Icon size={13} style={portalStyle({ color: g.renk })} />
                  <span className="text-[12px] font-bold" style={portalStyle({ color: TEXT })}>{g.baslik}</span>
                  <span className="text-[11.5px]" style={portalStyle({ color: FAINT })}>· {g.aciklama}</span>
                  <span className="ml-auto text-[11.5px] tabular-nums" style={portalStyle({ color: FAINT })}>{g.items.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {g.items.map((k) => <KisayolCard key={k.id} k={k} onClick={() => onKisayol(k)} />)}
                </div>
              </div>
            );
          })}
          {gruplar.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-[13px]" style={portalStyle({ color: MUTED })}>“{q}” için sonuç bulunamadı.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 22px logo; yoksa renkli kısaltma kutusu. */
export function KisayolLogo({ k }: { k: Kisayol }) {
  const [imgOk, setImgOk] = useState(!!k.logo);
  if (k.logo && imgOk) {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-white p-[2px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={k.logo}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setImgOk(false)}
        />
      </span>
    );
  }
  return (
    <span
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[9px] font-bold tracking-tight"
      style={portalStyle({ background: `${k.renk}22`, color: k.renk, border: `1px solid ${k.renk}55` })}
    >
      {k.kisaltma}
    </span>
  );
}

/** 40px yüksek sıkı kısayol kartı. */
export function KisayolCard({ k, onClick }: { k: Kisayol; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={k.label}
      className="group flex h-10 items-center gap-2.5 px-2.5 text-left transition-colors duration-150 hover:bg-white/[0.05]"
      style={portalStyle({ border: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.02)', borderRadius: R_ALAN })}
    >
      <KisayolLogo k={k} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={portalStyle({ color: TEXT })}>
        {k.label}
      </span>
      <ExternalLink size={12} className="shrink-0" style={portalStyle({ color: FAINT })} />
    </button>
  );
}
