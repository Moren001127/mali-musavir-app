'use client';

import { useMemo } from 'react';
import { AlertTriangle, ArrowDownAZ, ArrowDownWideNarrow, Check, ChevronDown, Filter, Minus, Search, X } from 'lucide-react';
import {
  gonderimOzeti, iletisimEksigi, listeyiSuz, tarihSaat, trMoney,
  SUZGEC_ADLARI, type ListeSiralama, type ListeSuzgeci, type OdemeListesi,
} from '@/lib/aylik-odeme';
import { AcilirMenu, MenuAyrac, MenuBaslik, MenuSatiri } from '../../gorevler/_components/AcilirMenu';
import { ALTIN_SOLUK, GIRDI, GOLD, IKINCIL, KART, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN, SONUK } from './ortak';

const LISTE_SUZGECLERI: ListeSuzgeci[] = ['tumu', 'sgk', 'vergi', 'eksik', 'gonderilmemis'];
const HAP_SUZGECLERI: ListeSuzgeci[] = ['gonderildi', 'bekliyor', 'hata'];

export interface MukellefListesiProps {
  rows: OdemeListesi[];
  seciliId: string | null;
  onSec: (id: string) => void;
  arama: string;
  onArama: (v: string) => void;
  suzgec: ListeSuzgeci;
  onSuzgec: (v: ListeSuzgeci) => void;
  siralama: ListeSiralama;
  onSiralama: (v: ListeSiralama) => void;
  /** Eksikler panelinde adı geçen mükellefler ("Eksiği olan" süzgeci) */
  eksikIdler: Set<string>;
  /** Açık gönderim kanalları — kapalı kanalın eksik bilgisi (ör. e-posta) uyarı üretmez */
  kanallar?: { whatsapp: boolean; email: boolean } | null;
  yukleniyor?: boolean;
}

/**
 * Sol liste — arama (ad) · sıralama (ada / tutara) · süzgeç menüsü (Tümü / Yalnız SGK / Yalnız vergi / Eksiği olan / Gönderilmeyen).
 * Satır: ad · toplam · kalem sayısı · ✓ gönderildi (tarih) / ⚠ hata / — bekliyor · telefon/e-posta yoksa küçük ⚠ ipucu.
 * 65 kayıt için süzme useMemo ile tek geçişte; satırlar hafif (tek düğme).
 */
export function MukellefListesi(p: MukellefListesiProps) {
  const { rows, seciliId, onSec, arama, onArama, suzgec, onSuzgec, siralama, onSiralama, eksikIdler, kanallar, yukleniyor } = p;
  const gorunen = useMemo(() => listeyiSuz(rows, { arama, suzgec, siralama, eksikIdler }), [rows, arama, suzgec, siralama, eksikIdler]);
  const gorunenToplam = useMemo(() => gorunen.reduce((a, r) => a + (r.toplam || 0), 0), [gorunen]);
  const suzgecAktif = suzgec !== 'tumu';

  return (
    <div className="flex min-h-0 flex-col" style={KART} data-testid="mukellef-listesi">
      {/* Araçlar */}
      <div className="flex flex-col gap-2 p-2.5" style={{ borderBottom: `1px solid ${KENAR_NOTR}` }}>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: IKINCIL }} />
          <input
            type="search"
            value={arama}
            onChange={(e) => onArama(e.target.value)}
            placeholder="Mükellef ara"
            aria-label="Mükellef ara"
            className="h-8 w-full text-[12px] [&::-webkit-search-cancel-button]:hidden"
            style={{ ...GIRDI, borderRadius: 999, paddingLeft: 30, paddingRight: arama ? 28 : 12, WebkitAppearance: 'none', appearance: 'none' }}
          />
          {arama && (
            <button type="button" onClick={() => onArama('')} title="Aramayı temizle" aria-label="Aramayı temizle" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-white/[0.06]" style={{ color: IKINCIL }}>
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <AcilirMenu
            genislik={210}
            hiza="sol"
            tetik={({ ref, ac, acik }) => (
              <button
                ref={ref}
                type="button"
                onClick={ac}
                aria-expanded={acik}
                title="Listeyi süz"
                className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold transition hover:brightness-125"
                style={suzgecAktif ? { background: `${GOLD}18`, border: `1px solid ${GOLD}66`, color: GOLD } : { background: 'transparent', border: `1px solid rgba(255,255,255,${acik ? '0.24' : '0.12'})`, color: acik ? METIN : IKINCIL }}
              >
                <Filter size={11} />
                <span className="truncate">{SUZGEC_ADLARI[suzgec]}</span>
                <ChevronDown size={11} className="ml-auto" style={{ opacity: 0.7 }} />
              </button>
            )}
          >
            {(kapat) => (
              <div className="py-1">
                <MenuBaslik>Süz</MenuBaslik>
                {LISTE_SUZGECLERI.map((k) => (
                  <MenuSatiri key={k} aktif={suzgec === k} onClick={() => { onSuzgec(k); kapat(); }}>
                    {SUZGEC_ADLARI[k]}
                  </MenuSatiri>
                ))}
                <MenuAyrac />
                <MenuBaslik>Gönderim durumu</MenuBaslik>
                {HAP_SUZGECLERI.map((k) => (
                  <MenuSatiri key={k} aktif={suzgec === k} onClick={() => { onSuzgec(k); kapat(); }}>
                    {SUZGEC_ADLARI[k]}
                  </MenuSatiri>
                ))}
              </div>
            )}
          </AcilirMenu>
          <button
            type="button"
            onClick={() => onSiralama(siralama === 'ad' ? 'tutar' : 'ad')}
            title={siralama === 'ad' ? 'Ada göre sıralı — tutara göre sırala' : 'Tutara göre sıralı (büyükten küçüğe) — ada göre sırala'}
            aria-label="Sıralama"
            className="inline-flex h-7 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold transition hover:brightness-125"
            style={{ border: `1px solid ${KENAR_NOTR}`, color: IKINCIL }}
          >
            {siralama === 'ad' ? <ArrowDownAZ size={12} /> : <ArrowDownWideNarrow size={12} />}
            {siralama === 'ad' ? 'Ad' : 'Tutar'}
          </button>
        </div>
      </div>

      {/* Satırlar */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" style={{ maxHeight: 640 }} role="listbox" aria-label="Mükellefler">
        {yukleniyor ? (
          <div className="space-y-1.5 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }} />
            ))}
          </div>
        ) : gorunen.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px]" style={{ color: IKINCIL }}>
            {rows.length === 0 ? 'Bu ay için kayıt yok.' : 'Süzgece uyan mükellef yok.'}
            {(suzgecAktif || arama) && (
              <button type="button" onClick={() => { onSuzgec('tumu'); onArama(''); }} className="mt-2 block w-full text-[11.5px] font-semibold hover:underline" style={{ color: GOLD }}>
                Süzgeci temizle
              </button>
            )}
          </div>
        ) : (
          gorunen.map((r) => <Satir key={r.taxpayerId} r={r} secili={seciliId === r.taxpayerId} onSec={() => onSec(r.taxpayerId)} kanallar={kanallar} />)
        )}
      </div>

      {/* Alt toplam */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11.5px]" style={{ borderTop: `1px solid ${KENAR_NOTR}`, color: IKINCIL }}>
        <span>
          {gorunen.length}{gorunen.length !== rows.length ? ` / ${rows.length}` : ''} mükellef
        </span>
        <span className="tabular-nums" title={gorunen.length !== rows.length ? 'Süzülen listenin toplamı' : 'Genel toplam'}>
          <b style={{ color: GOLD }}>{trMoney(gorunenToplam)}</b>
        </span>
      </div>
    </div>
  );
}

function Satir({ r, secili, onSec, kanallar }: { r: OdemeListesi; secili: boolean; onSec: () => void; kanallar?: { whatsapp: boolean; email: boolean } | null }) {
  const g = gonderimOzeti(r);
  const eksik = iletisimEksigi(r, kanallar);
  const durum =
    g.durum === 'gonderildi'
      ? { ikon: <Check size={12} />, renk: ALTIN_SOLUK, yazi: g.sentAt ? tarihSaat(g.sentAt).slice(0, 5) : 'gönderildi', title: `Gönderildi${g.sentAt ? ' · ' + tarihSaat(g.sentAt) : ''}${g.test ? ' (test alıcısına)' : ''}` }
      : g.durum === 'hata'
        ? { ikon: <AlertTriangle size={12} />, renk: KIRMIZI_YUMUSAK, yazi: 'hata', title: `Gönderim hatası${g.sentAt ? ' · ' + tarihSaat(g.sentAt) : ''}` }
        : { ikon: <Minus size={12} />, renk: SONUK, yazi: g.kismi ? 'kısmen' : 'bekliyor', title: g.kismi ? 'Yalnız bir bölümü gönderildi (vergi ya da SGK); diğeri bekliyor' : 'Henüz gönderilmedi' };
  return (
    <button
      type="button"
      role="option"
      aria-selected={secili}
      onClick={onSec}
      className="mb-1 block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      style={{ background: secili ? 'rgba(212,184,118,0.09)' : 'transparent', boxShadow: secili ? `inset 3px 0 0 ${GOLD}` : undefined }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5" style={{ color: METIN }} title={r.unvan}>
          {r.unvan}
        </span>
        {eksik && (
          <span title={eksik.metin} aria-label={eksik.metin} className="flex-shrink-0" style={{ color: eksik.kritik ? KIRMIZI_YUMUSAK : IKINCIL }}>
            <AlertTriangle size={12} />
          </span>
        )}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px]">
        <span className="tabular-nums font-semibold" style={{ color: GOLD }}>{trMoney(r.toplam)}</span>
        <span style={{ color: SONUK }}>· {r.satirlar.length} kalem</span>
        <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-[10.5px]" style={{ color: durum.renk }} title={durum.title}>
          {durum.ikon}
          {durum.yazi}
        </span>
      </div>
    </button>
  );
}
