'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { gunEkle } from '@/lib/tasks';
import { GIRDI, GOLD, MENU_ZEMIN, METIN, IKINCIL } from './ortak';
import { DUGME_NOTR, GECIKME_RENK } from './Rozetler';

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

/**
 * Menü satırı. Sakin palet: ikonlar nötr gri; yalnız `tehlike` (Sil) yumuşak kırmızı; aktif satır altın nokta.
 * `renk` geriye dönük uyumluluk için kabul edilir ama satır içi renk olarak UYGULANMAZ (tek palet).
 */
export function MenuSatiri({
  ikon,
  children,
  onClick,
  title,
  disabled,
  aktif,
  tehlike,
}: {
  ikon?: ReactNode;
  children: ReactNode;
  /** Kullanılmıyor — eski çağrılar bozulmasın diye tutuluyor. */
  renk?: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  aktif?: boolean;
  /** Sil gibi geri alınamaz eylem — ikon ve yazı yumuşak kırmızı. */
  tehlike?: boolean;
}) {
  const yazi = tehlike ? GECIKME_RENK : aktif ? METIN : 'rgba(250,250,249,0.85)';
  const ikonRenk = tehlike ? GECIKME_RENK : aktif ? METIN : IKINCIL;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] font-medium transition hover:bg-white/[0.05] disabled:opacity-40"
      style={{ color: yazi, background: aktif ? 'rgba(212,184,118,0.10)' : undefined }}
    >
      {ikon && <span className="flex w-4 justify-center" style={{ color: ikonRenk }}>{ikon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aktif && <span className="h-1.5 w-1.5 rounded-full" style={{ background: GOLD }} />}
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
        <MenuSatiri key={s.ad} ikon={<CalendarDays size={13} />} onClick={() => onSec(s.gun)}>
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
          className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: `1px solid ${GOLD}66` }}
        >
          Ertele
        </button>
      </div>
    </div>
  );
}

/**
 * Küçük ikon düğme — eylem sütunu; HER ZAMAN görünür (hover'a saklanmaz).
 * Sakin palet: varsayılan TEK RENK (gri ikon, .04 zemin, .10 kenar); `renk` yalnız üzerine gelince / odaklanınca / aktifken (menü açık) belirir.
 */
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
  /** İşlev rengi — yalnız hover / odak / aktif durumda uygulanır. */
  renk: string;
  onClick?: () => void;
  disabled?: boolean;
  refDis?: RefObject<HTMLButtonElement>;
  aktif?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const [ustunde, setUstunde] = useState(false);
  const vurgulu = !disabled && (ustunde || !!aktif);
  const gorunum: CSSProperties = vurgulu
    ? { background: `${renk}${aktif ? '2e' : '1f'}`, color: renk, border: `1px solid ${renk}${aktif ? '80' : '55'}` }
    : DUGME_NOTR;
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
      onMouseEnter={() => setUstunde(true)}
      onMouseLeave={() => setUstunde(false)}
      onFocus={() => setUstunde(true)}
      onBlur={() => setUstunde(false)}
      disabled={disabled}
      className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-[transform,background-color,color,border-color] duration-150 hover:-translate-y-px disabled:opacity-35 disabled:hover:translate-y-0 ${className}`}
      style={{ ...gorunum, ...style }}
    >
      {ikon}
    </button>
  );
}
