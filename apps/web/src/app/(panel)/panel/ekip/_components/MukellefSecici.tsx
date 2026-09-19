'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, X } from 'lucide-react';
import { mukellefAdi, type MukellefOzet } from '@/lib/ekip';
import { SAKIN } from './ortak';

/**
 * Yazınca süzülen mükellef arama kutusu. Normal modda liste akış içinde açılır; `sade` modda (v5 çip içi) liste
 * document.body'ye portal ile, kutunun altında sabit konumda yüzer — kartın overflow/katman sınırına takılmaz
 * (2026-09-15 canlı bulgu: liste kartın altında kesiliyor, seçim yapılamıyordu).
 * Ok tuşları + Enter seçer; Esc kapatır; [×] temizler. Boş = ofis geneli.
 */
export function MukellefSecici({
  mukellefler,
  value,
  onChange,
  renk,
  kilitli,
  odakNonce,
  escNonce,
  sade = false,
  yerTutucu,
}: {
  mukellefler: MukellefOzet[];
  value: string;
  onChange: (id: string) => void;
  renk: string;
  /** Pano / tekrar-çalıştır doldurduğunda rozet "panodan" — yine değiştirilebilir. */
  kilitli?: boolean;
  /** Artınca kutuya odaklanır. */
  odakNonce?: number;
  /** Artınca liste kapanır (Esc — EkipEkrani'daki tek dinleyici). */
  escNonce?: number;
  /** v5 (2026-09-15): çip/arama kutusunun İÇİNE gömülü kullanım — kendi zemini/kenarı yok, liste altta yüzer (absolute). */
  sade?: boolean;
  /** Sade modda yer tutucu metni. */
  yerTutucu?: string;
}) {
  const [metin, setMetin] = useState('');
  const [acik, setAcik] = useState(false);
  const [imlec, setImlec] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const kutuRef = useRef<HTMLDivElement>(null);
  const listeRef = useRef<HTMLUListElement>(null);
  const [yer, setYer] = useState<{ top: number; left: number } | null>(null);

  // sade: liste konumu (sabit) — açılınca ve kaydırma/boyut değişince yeniden ölçülür
  useLayoutEffect(() => {
    if (!sade || !acik) return;
    const olc = () => {
      const r = kutuRef.current?.getBoundingClientRect();
      if (r) setYer({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 316)) });
    };
    olc();
    window.addEventListener('scroll', olc, true);
    window.addEventListener('resize', olc);
    return () => {
      window.removeEventListener('scroll', olc, true);
      window.removeEventListener('resize', olc);
    };
  }, [sade, acik]);

  // sade: dışarı tıklayınca kapan
  useEffect(() => {
    if (!sade || !acik) return;
    const dinle = (e: MouseEvent) => {
      const h = e.target as Node | null;
      if (h && (kutuRef.current?.contains(h) || listeRef.current?.contains(h))) return;
      setAcik(false);
    };
    document.addEventListener('mousedown', dinle);
    return () => document.removeEventListener('mousedown', dinle);
  }, [sade, acik]);

  const secili = useMemo(() => mukellefler.find((m) => m.id === value), [mukellefler, value]);

  const sonuclar = useMemo(() => {
    const q = metin.trim().toLocaleLowerCase('tr-TR');
    if (!q) return mukellefler.slice(0, 8);
    return mukellefler
      .filter((m) => mukellefAdi(m).toLocaleLowerCase('tr-TR').includes(q) || String(m.taxNumber || '').includes(q))
      .slice(0, 8);
  }, [metin, mukellefler]);

  useEffect(() => {
    if (odakNonce) {
      inputRef.current?.focus();
      setAcik(true);
    }
  }, [odakNonce]);

  useEffect(() => {
    if (escNonce) setAcik(false);
  }, [escNonce]);

  useEffect(() => setImlec(0), [metin]);

  const sec = (m: MukellefOzet) => {
    onChange(m.id);
    setMetin('');
    setAcik(false);
  };

  if (secili) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span
          className={`inline-flex max-w-full items-center gap-1 rounded-md text-xs font-semibold ${sade ? 'py-0.5 text-[12.5px]' : 'px-2 py-1'}`}
          style={portalStyle(sade ? { color: SAKIN.metin } : { background: `${renk}1a`, border: `1px solid ${renk}66`, color: SAKIN.metin })}
          title={secili.taxNumber ? `VKN ${secili.taxNumber}` : undefined}
        >
          {!sade && <Building2 size={12} style={portalStyle({ color: SAKIN.vurguAcik })} />}
          <span className="truncate">{mukellefAdi(secili)}</span>
          <button type="button" onClick={() => onChange('')} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Mükellefi kaldır (ofis geneli)">
            <X size={12} />
          </button>
        </span>
        {kilitli && (
          <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={portalStyle({ border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.ikincil })}>
            panodan
          </span>
        )}
      </div>
    );
  }

  return (
    <div ref={kutuRef} className={`min-w-0 ${sade ? 'relative' : 'flex flex-col gap-1'}`}>
      <div className="relative flex items-center">
        {!sade && <Building2 size={12} className="pointer-events-none absolute left-2" style={portalStyle({ color: SAKIN.ikincil })} />}
        <input
          ref={inputRef}
          value={metin}
          onChange={(e) => {
            setMetin(e.target.value);
            setAcik(true);
          }}
          onFocus={() => setAcik(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAcik(true);
              setImlec((i) => Math.min(i + 1, Math.max(sonuclar.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setImlec((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              if (acik && sonuclar[imlec]) {
                e.preventDefault();
                e.stopPropagation();
                sec(sonuclar[imlec]);
              }
            } else if (e.key === 'Escape') {
              setAcik(false);
            }
          }}
          placeholder={sade ? yerTutucu || 'Seçin (boş = ofis geneli)' : 'Mükellef ara… (boş = ofis geneli)'}
          className={sade ? 'w-full bg-transparent py-0.5 pr-6 text-[12.5px] outline-none' : 'w-full rounded-md py-1.5 pl-7 pr-7 text-xs outline-none transition-[border-color] duration-150 focus:[border-color:#4f86c9]'}
          style={portalStyle(sade ? { color: SAKIN.metin } : { background: SAKIN.alan, border: `1px solid ${SAKIN.cizgi}`, color: SAKIN.metin })}
        />
        {metin && (
          <button
            type="button"
            onClick={() => {
              setMetin('');
              setAcik(false);
            }}
            className="absolute right-1.5 rounded p-0.5 hover:bg-white/10"
            style={portalStyle({ color: SAKIN.ikincil })}
            title="Temizle"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {acik && liste()}
    </div>
  );

  function liste() {
    const ul = (
        <ul ref={listeRef} className={`max-h-56 overflow-y-auto rounded-[10px] p-1 ${sade ? 'fixed z-[1000] w-[308px] shadow-2xl' : ''}`} style={portalStyle(sade ? { top: yer?.top ?? -9999, left: yer?.left ?? -9999, background: '#121317', border: `1px solid ${SAKIN.cizgiKoyu}` } : { background: '#121317', border: `1px solid ${SAKIN.cizgiKoyu}` })}>
          {!sonuclar.length ? (
            <li className="px-2 py-1.5 text-[11px]" style={portalStyle({ color: SAKIN.ikincil })}>
              {mukellefler.length ? 'Eşleşen mükellef yok' : 'Mükellef listesi yükleniyor…'}
            </li>
          ) : (
            sonuclar.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseEnter={() => setImlec(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => sec(m)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                  style={portalStyle({ background: i === imlec ? `${renk}22` : 'transparent', color: SAKIN.metin })}
                >
                  <span className="truncate">{mukellefAdi(m)}</span>
                  {m.taxNumber && <span className="flex-shrink-0 text-[10px] tabular-nums" style={portalStyle({ color: SAKIN.ikincil })}>{m.taxNumber}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
    );
    if (sade && typeof document !== 'undefined') return createPortal(ul, document.body);
    return ul;
  }
}
