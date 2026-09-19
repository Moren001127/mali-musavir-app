'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useState } from 'react';
import { AlarmClock, Check, ChevronDown, Flag, Loader2, Tag, Trash2, X } from 'lucide-react';
import { CATEGORY_OPTIONS, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER, type TaskPriority, type TopluInput } from '@/lib/tasks';
import { AcilirMenu, ErtelemeSecenekleri, MenuAyrac, MenuBaslik, MenuSatiri } from './AcilirMenu';
import { GOLD, IKINCIL, KIRMIZI, METIN, MOR, YESIL, vadeIso } from './ortak';

/**
 * Toplu işlem şeridi — satır kutucukları seçilince içerik akışının altında belirir (sayfa kayarken alt kenarda kalır;
 * yapışkan BAŞLIK değil, seçim varken görünen eylem çubuğu).
 * Tamamla · Ertele (yarın / 3 gün / gelecek hafta / tarih seç) · Kategori · Öncelik · Sil
 */
export function TopluSerit({ secili, onTemizle, onIslem }: { secili: string[]; onTemizle: () => void; onIslem: (dto: Omit<TopluInput, 'ids'>) => Promise<unknown> }) {
  const [calisan, setCalisan] = useState<string | null>(null);
  if (secili.length === 0) return null;

  const calistir = async (ad: string, dto: Omit<TopluInput, 'ids'>) => {
    setCalisan(ad);
    try {
      await onIslem(dto);
    } finally {
      setCalisan(null);
    }
  };

  const dugme = 'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12px] font-bold transition-[transform,filter] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:hover:translate-y-0';

  return (
    // dar ekranda alt gezinme çubuğu (fixed, ~76px) şeridi örtmesin → bottom 84px; geniş ekranda 12px
    <div className="pointer-events-none sticky bottom-[84px] z-[41] flex justify-center px-1 lg:bottom-3">
      <div
        role="toolbar"
        aria-label="Toplu işlemler"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl px-3 py-2"
        style={portalStyle({
          background: 'linear-gradient(160deg, rgba(28,24,20,0.98), rgba(14,12,10,0.98))',
          border: `1px solid ${GOLD}55`,
          boxShadow: `0 0 0 1px ${GOLD}22, 0 20px 60px rgba(0,0,0,0.6)`,
        })}
      >
        <span className="inline-flex items-center gap-1.5 pr-1 text-[12.5px] font-bold" style={portalStyle({ color: METIN })}>
          <span className="rounded-md px-1.5 text-[11px] font-extrabold tabular-nums leading-5" style={portalStyle({ background: GOLD, color: '#0f0d0b' })}>
            {secili.length}
          </span>
          seçili
        </span>
        <span className="h-4 w-px" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />

        <button type="button" disabled={!!calisan} onClick={() => calistir('tamamla', { islem: 'tamamla' })} className={dugme} style={portalStyle({ background: `${YESIL}1f`, color: YESIL, border: `1px solid ${YESIL}55` })} title="Seçilenleri tamamla">
          {calisan === 'tamamla' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Tamamla
        </button>

        <AcilirMenu genislik={240} tetik={({ ref, ac }) => (
          <button ref={ref} type="button" disabled={!!calisan} onClick={ac} className={dugme} style={portalStyle({ background: `${MOR}1f`, color: '#c084fc', border: `1px solid ${MOR}55` })} title="Seçilenleri ertele">
            {calisan === 'ertele' ? <Loader2 size={13} className="animate-spin" /> : <AlarmClock size={13} />} Ertele <ChevronDown size={11} />
          </button>
        )}>
          {(kapat) => (
            <ErtelemeSecenekleri
              onSec={(g) => {
                kapat();
                calistir('ertele', { islem: 'ertele', until: vadeIso(g) });
              }}
            />
          )}
        </AcilirMenu>

        <AcilirMenu genislik={230} tetik={({ ref, ac }) => (
          <button ref={ref} type="button" disabled={!!calisan} onClick={ac} className={dugme} style={portalStyle({ background: 'rgba(255,255,255,0.05)', color: METIN, border: '1px solid rgba(255,255,255,0.12)' })} title="Seçilenlerin kategorisini değiştir">
            {calisan === 'kategori' ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />} Kategori <ChevronDown size={11} />
          </button>
        )}>
          {(kapat) => (
            <div className="py-1">
              <MenuBaslik>Kategori ata</MenuBaslik>
              {CATEGORY_OPTIONS.map((c) => (
                <MenuSatiri key={c.value} ikon={<span className="h-2 w-2 rounded-full" style={portalStyle({ background: c.color })} />} onClick={() => { kapat(); calistir('kategori', { islem: 'kategori', category: c.value }); }}>
                  {c.label}
                </MenuSatiri>
              ))}
              <MenuAyrac />
              <MenuSatiri ikon={<X size={12} />} onClick={() => { kapat(); calistir('kategori', { islem: 'kategori', category: '' }); }}>
                Kategoriyi kaldır
              </MenuSatiri>
            </div>
          )}
        </AcilirMenu>

        <AcilirMenu genislik={200} tetik={({ ref, ac }) => (
          <button ref={ref} type="button" disabled={!!calisan} onClick={ac} className={dugme} style={portalStyle({ background: 'rgba(255,255,255,0.05)', color: METIN, border: '1px solid rgba(255,255,255,0.12)' })} title="Seçilenlerin önceliğini değiştir">
            {calisan === 'oncelik' ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />} Öncelik <ChevronDown size={11} />
          </button>
        )}>
          {(kapat) => (
            <div className="py-1">
              <MenuBaslik>Öncelik ata</MenuBaslik>
              {[...PRIORITY_ORDER].reverse().map((p: TaskPriority) => (
                <MenuSatiri key={p} ikon={<Flag size={12} />} renk={PRIORITY_COLOR[p]} onClick={() => { kapat(); calistir('oncelik', { islem: 'oncelik', priority: p }); }}>
                  {PRIORITY_LABEL[p]}
                </MenuSatiri>
              ))}
            </div>
          )}
        </AcilirMenu>

        <button
          type="button"
          disabled={!!calisan}
          onClick={() => {
            if (confirm(`${secili.length} kayıt silinsin mi? Geri alınamaz.`)) calistir('sil', { islem: 'sil' });
          }}
          className={dugme}
          style={portalStyle({ background: `${KIRMIZI}1a`, color: '#fca5a5', border: `1px solid ${KIRMIZI}55` })}
          title="Seçilenleri sil"
        >
          {calisan === 'sil' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Sil
        </button>

        <button type="button" onClick={onTemizle} className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10" style={portalStyle({ color: IKINCIL })} title="Seçimi bırak">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
