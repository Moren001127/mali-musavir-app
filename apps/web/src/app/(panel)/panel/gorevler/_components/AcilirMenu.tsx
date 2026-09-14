'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { gunEkle } from '@/lib/tasks';
import { GIRDI, MENU_ZEMIN, METIN, MOR, IKINCIL } from './ortak';

/**
 * Açılır menü — tetikleyici düğmenin altında (sığmazsa üstünde) gövdeye portal edilir; dışarı tıklama / Esc kapatır.
 * Tetik render-prop: {ref, ac, acik}. İçerik render-prop: (kapat) => …
 */
export function AcilirMenu({
  tetik,
  children,
  genislik = 220,
  hiza = 'sag',
  onAcilis,
}: {
  tetik: (p: { ref: RefObject<HTMLButtonElement>; ac: () => void; acik: boolean }) => ReactNode;
  children: (kapat: () => void) => ReactNode;
  genislik?: number;
  hiza?: 'sag' | 'sol';
  onAcilis?: () => void;
}) {
  const [acik, setAcik] = useState(false);
  const tetikRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [konum, setKonum] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const yerlestir = () => {
    const r = tetikRef.current?.getBoundingClientRect();
    if (!r) return;
    const yukseklik = panelRef.current?.offsetHeight || 260;
    const bosluk = 6;
    let left = hiza === 'sag' ? r.right - genislik : r.left;
    left = Math.max(8, Math.min(window.innerWidth - genislik - 8, left));
    const asagiSigar = r.bottom + bosluk + yukseklik <= window.innerHeight - 8;
    const top = asagiSigar || r.top - yukseklik - bosluk < 8 ? Math.min(r.bottom + bosluk, window.innerHeight - yukseklik - 8) : r.top - yukseklik - bosluk;
    setKonum({ top: Math.max(8, top), left });
  };

  useLayoutEffect(() => {
    if (acik) yerlestir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    const disari = (e: MouseEvent) => {
      const h = e.target as Node;
      if (panelRef.current?.contains(h) || tetikRef.current?.contains(h)) return;
      setAcik(false);
    };
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAcik(false);
    };
    document.addEventListener('mousedown', disari);
    document.addEventListener('keydown', tus);
    window.addEventListener('resize', yerlestir);
    window.addEventListener('scroll', yerlestir, true);
    return () => {
      document.removeEventListener('mousedown', disari);
      document.removeEventListener('keydown', tus);
      window.removeEventListener('resize', yerlestir);
      window.removeEventListener('scroll', yerlestir, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  const ac = () => {
    setAcik((v) => {
      if (!v) onAcilis?.();
      return !v;
    });
  };
  const kapat = () => setAcik(false);

  return (
    <>
      {tetik({ ref: tetikRef, ac, acik })}
      {acik &&
        typeof document !== 'undefined' &&
        createPortal(
          <div ref={panelRef} role="menu" className="fixed z-[1000] overflow-hidden" style={{ ...MENU_ZEMIN, top: konum.top, left: konum.left, width: genislik }}>
            {children(kapat)}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Menü satırı. */
export function MenuSatiri({
  ikon,
  children,
  renk = 'rgba(250,250,249,0.85)',
  onClick,
  title,
  disabled,
  aktif,
}: {
  ikon?: ReactNode;
  children: ReactNode;
  renk?: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  aktif?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] font-medium transition hover:bg-white/[0.05] disabled:opacity-40"
      style={{ color: aktif ? METIN : 'rgba(250,250,249,0.85)', background: aktif ? 'rgba(212,184,118,0.10)' : undefined }}
    >
      {ikon && <span className="flex w-4 justify-center" style={{ color: renk }}>{ikon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aktif && <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#d4b876' }} />}
    </button>
  );
}

export function MenuAyrac() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />;
}

export function MenuBaslik({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: IKINCIL }}>
      {children}
    </div>
  );
}

/** Ertele seçenekleri: yarın · 3 gün · gelecek hafta · tarih seç. Seçim ISO gün (YYYY-MM-DD) döner. */
export function ErtelemeSecenekleri({ onSec, baslik = 'Ne zamana ertelensin?' }: { onSec: (gunIso: string) => void; baslik?: string }) {
  const [tarih, setTarih] = useState('');
  const secenekler = [
    { ad: 'Yarın', gun: gunEkle(1) },
    { ad: '3 gün sonra', gun: gunEkle(3) },
    { ad: 'Gelecek hafta', gun: gunEkle(7) },
  ];
  return (
    <div className="py-1">
      <MenuBaslik>{baslik}</MenuBaslik>
      {secenekler.map((s) => (
        <MenuSatiri key={s.ad} ikon={<CalendarDays size={13} />} renk={MOR} onClick={() => onSec(s.gun)}>
          {s.ad} <span style={{ color: IKINCIL }}>· {new Date(s.gun).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</span>
        </MenuSatiri>
      ))}
      <MenuAyrac />
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="date"
          value={tarih}
          min={gunEkle(0)}
          onChange={(e) => setTarih(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tarih) onSec(tarih);
          }}
          className="h-8 min-w-0 flex-1 px-2 text-[12px]"
          style={GIRDI}
          title="Tarih seç"
        />
        <button
          type="button"
          disabled={!tarih}
          onClick={() => tarih && onSec(tarih)}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-40"
          style={{ background: `${MOR}22`, color: '#c084fc', border: `1px solid ${MOR}55` }}
        >
          Ertele
        </button>
      </div>
    </div>
  );
}

/** Küçük ikon düğme — eylem sütunu; HER ZAMAN görünür (hover'a saklanmaz). */
export function IkonDugme({
  ikon,
  title,
  renk,
  onClick,
  disabled,
  refDis,
  aktif,
  className = '',
  style,
}: {
  ikon: ReactNode;
  title: string;
  renk: string;
  onClick?: () => void;
  disabled?: boolean;
  refDis?: RefObject<HTMLButtonElement>;
  aktif?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      ref={refDis}
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled}
      className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-125 disabled:opacity-35 disabled:hover:translate-y-0 ${className}`}
      style={{ background: aktif ? `${renk}30` : `${renk}14`, color: renk, border: `1px solid ${renk}${aktif ? '66' : '2e'}`, ...style }}
    >
      {ikon}
    </button>
  );
}
