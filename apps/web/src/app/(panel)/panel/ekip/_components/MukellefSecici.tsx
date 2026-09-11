'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, X } from 'lucide-react';
import { mukellefAdi, type MukellefOzet } from '@/lib/ekip';
import { kartArkaPlan, RENK } from './ortak';

/**
 * Yazınca süzülen mükellef arama kutusu. Liste akış içinde açılır (absolute/sticky YOK).
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
}) {
  const [metin, setMetin] = useState('');
  const [acik, setAcik] = useState(false);
  const [imlec, setImlec] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
          className="inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
          style={{ background: `${renk}1a`, border: `1px solid ${renk}55`, color: RENK.metin }}
          title={secili.taxNumber ? `VKN ${secili.taxNumber}` : undefined}
        >
          <Building2 size={12} style={{ color: renk }} />
          <span className="truncate">{mukellefAdi(secili)}</span>
          <button type="button" onClick={() => onChange('')} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Mükellefi kaldır (ofis geneli)">
            <X size={12} />
          </button>
        </span>
        {kilitli && (
          <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.4)', color: '#c4b5fd' }}>
            panodan
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative flex items-center">
        <Building2 size={12} className="pointer-events-none absolute left-2" style={{ color: RENK.ikincil }} />
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
          placeholder="Mükellef ara… (boş = ofis geneli)"
          className="w-full rounded-lg py-1.5 pl-7 pr-7 text-xs outline-none"
          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${renk}3a`, color: RENK.metin }}
        />
        {metin && (
          <button
            type="button"
            onClick={() => {
              setMetin('');
              setAcik(false);
            }}
            className="absolute right-1.5 rounded p-0.5 hover:bg-white/10"
            style={{ color: RENK.ikincil }}
            title="Temizle"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {acik && (
        <ul className="max-h-56 overflow-y-auto rounded-lg p-1" style={kartArkaPlan(renk)}>
          {!sonuclar.length ? (
            <li className="px-2 py-1.5 text-[11px]" style={{ color: RENK.ikincil }}>
              {mukellefler.length ? 'Eşleşen mükellef yok' : 'Mükellef listesi yükleniyor…'}
            </li>
          ) : (
            sonuclar.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseEnter={() => setImlec(i)}
                  onClick={() => sec(m)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                  style={{ background: i === imlec ? `${renk}22` : 'transparent', color: RENK.metin }}
                >
                  <span className="truncate">{mukellefAdi(m)}</span>
                  {m.taxNumber && <span className="flex-shrink-0 text-[10px] tabular-nums" style={{ color: RENK.ikincil }}>{m.taxNumber}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
