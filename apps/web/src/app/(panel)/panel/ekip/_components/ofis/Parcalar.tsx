'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ajanKisaltma } from '../ortak';
import { ajanTonu } from './yardimci';

/**
 * Dijital Ofis — ortak parçalar. Renkler ofis.css'ten (`[data-ton]` aileleri); satır içi renk YOK.
 *  - OfisAvatar: gradyan halkalı personel avatarı + canlı nokta (çalışıyor).
 *  - OfisKart: beyaz kart (başlık · alt satır · sağ eylemler).
 *  - Cekmece: sağdan açılan panel (Esc kapatır, arka plan tıklaması kapatır).
 *  - KucukTeyit: kart içi iki adımlı onay (5 sn geri sayım) — tarayıcı onay penceresi kullanılmaz.
 *  - Anahtar: aç/kapa.
 */

export function OfisAvatar({ ajanId, boyut = 40, canli = false, kapali = false, title, className = '' }: { ajanId: string; boyut?: number; canli?: boolean; kapali?: boolean; title?: string; className?: string }) {
  return (
    <span className={`of-avatar ${className}`} data-ton={ajanTonu(ajanId)} data-canli={canli || undefined} data-kapali={kapali || undefined} style={{ width: boyut, height: boyut, fontSize: Math.max(10, Math.round(boyut * 0.3)) }} title={title} aria-hidden={title ? undefined : true}>
      <span className="of-avatar-ic">{ajanKisaltma(ajanId)}</span>
      {canli && <i className="of-avatar-nokta" aria-label="çalışıyor" />}
    </span>
  );
}

export function OfisKart({ id, baslik, alt, sag, simge, className = '', govdeSinifi = '', children }: { id?: string; baslik: ReactNode; alt?: ReactNode; sag?: ReactNode; simge?: ReactNode; className?: string; govdeSinifi?: string; children: ReactNode }) {
  return (
    <section id={id} className={`of-kart ${className}`} aria-label={typeof baslik === 'string' ? baslik : undefined}>
      <header className="of-kart-baslik">
        {simge && <span className="of-kart-simge" aria-hidden="true">{simge}</span>}
        <div className="of-kart-baslik-metin">
          <h2>{baslik}</h2>
          {alt && <p>{alt}</p>}
        </div>
        {sag && <div className="of-kart-eylemler">{sag}</div>}
      </header>
      <div className={`of-kart-govde ${govdeSinifi}`}>{children}</div>
    </section>
  );
}

/** Sağdan çekmece: gövdeye portal ile; genişlik `genis` ile 720px (iş paneli), değilse 460px. */
export function Cekmece({ acik, baslik, alt, onKapat, genis = false, children, altBar }: { acik: boolean; baslik: ReactNode; alt?: ReactNode; onKapat: () => void; genis?: boolean; children: ReactNode; altBar?: ReactNode }) {
  const kapatRef = useRef(onKapat);
  kapatRef.current = onKapat;
  useEffect(() => {
    if (!acik) return;
    const dinle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') kapatRef.current();
    };
    window.addEventListener('keydown', dinle);
    return () => window.removeEventListener('keydown', dinle);
  }, [acik]);
  if (!acik || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ekip-ofis of-cekmece-kok" role="presentation">
      <div className="of-cekmece-perde" onClick={onKapat} />
      <aside className="of-cekmece" data-genis={genis || undefined} role="dialog" aria-modal="true" aria-label={typeof baslik === 'string' ? baslik : 'Çekmece'}>
        <header className="of-cekmece-baslik">
          <div className="min-w-0 flex-1">
            <h3>{baslik}</h3>
            {alt && <p>{alt}</p>}
          </div>
          <button type="button" className="of-kapat" onClick={onKapat} aria-label="Kapat" title="Kapat (Esc)">
            <X size={16} />
          </button>
        </header>
        <div className="of-cekmece-govde">{children}</div>
        {altBar && <footer className="of-cekmece-alt">{altBar}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** İki adımlı teyit: 5 sn içinde "Evet" denmezse kendiliğinden kapanır (OnayBekleyenler.OnayTeyit ile aynı kural). */
export function KucukTeyit({ metin, evet = 'Evet', mesgul = false, onEvet, onVazgec, tehlike = false }: { metin: ReactNode; evet?: string; mesgul?: boolean; onEvet: () => void; onVazgec: () => void; tehlike?: boolean }) {
  const [kalan, setKalan] = useState(5);
  const vazgecRef = useRef(onVazgec);
  vazgecRef.current = onVazgec;
  useEffect(() => {
    if (mesgul) return;
    const t = setInterval(() => setKalan((k) => k - 1), 1000);
    return () => clearInterval(t);
  }, [mesgul]);
  useEffect(() => {
    if (kalan <= 0 && !mesgul) vazgecRef.current();
  }, [kalan, mesgul]);
  return (
    <div className="of-teyit" data-tehlike={tehlike || undefined} role="alertdialog">
      <span className="of-teyit-metin">{metin}</span>
      <span className="of-teyit-dugmeler">
        <button type="button" className="of-dugme" data-tur={tehlike ? 'tehlike-dolu' : 'birincil'} disabled={mesgul} onClick={onEvet}>
          {evet}
        </button>
        <button type="button" className="of-dugme" data-tur="ikincil" disabled={mesgul} onClick={onVazgec}>
          Vazgeç {!mesgul && <span className="of-soluk">({kalan})</span>}
        </button>
      </span>
    </div>
  );
}

/** Aç/kapa anahtarı. */
export function Anahtar({ acik, onChange, etiket, mesgul = false, kucuk = false }: { acik: boolean; onChange: (v: boolean) => void; etiket: string; mesgul?: boolean; kucuk?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={acik} aria-label={etiket} title={etiket} disabled={mesgul} className="of-anahtar" data-acik={acik || undefined} data-kucuk={kucuk || undefined} onClick={() => onChange(!acik)}>
      <i />
    </button>
  );
}

/** Ton çipi: `data-ton` ile renk ailesi; `nokta` → önünde küçük daire. */
export function Cip({ ton = 'kursuni', nokta = false, nabiz = false, children, title, className = '' }: { ton?: string; nokta?: boolean; nabiz?: boolean; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`of-cip ${className}`} data-ton={ton} data-nokta={nokta || undefined} data-nabiz={nabiz || undefined} title={title}>
      {nokta && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Boş durum: kesik çizgili kutu + tek cümle. */
export function BosDurum({ children, simge }: { children: ReactNode; simge?: ReactNode }) {
  return (
    <div className="of-bos">
      {simge}
      <span>{children}</span>
    </div>
  );
}
