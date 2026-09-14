'use client';

import type { ReactNode } from 'react';

import { Building2, CalendarDays, ChevronDown, Flag, KanbanSquare, ListTodo, Search, Tag, Users, Waypoints, X } from 'lucide-react';
import { CATEGORY_OPTIONS, KAYNAK_COLOR, KAYNAK_OPTIONS, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER, kategoriEtiketi, kategoriRengi, type TaskKaynak, type TaskPriority } from '@/lib/tasks';
import { AcilirMenu, MenuAyrac, MenuBaslik, MenuSatiri } from './AcilirMenu';
import { MukellefMenusu } from './AkilliGiris';
import { mukellefAdi, type MukellefSecenek } from './akilli-giris';
import { GIRDI, GOLD, IKINCIL, METIN } from './ortak';

export type Gorunum = 'ajanda' | 'kanban' | 'takvim' | 'mukellef';

const GORUNUMLER: Array<{ key: Gorunum; ad: string; ikon: typeof ListTodo }> = [
  { key: 'ajanda', ad: 'Ajanda', ikon: ListTodo },
  { key: 'kanban', ad: 'Kanban', ikon: KanbanSquare },
  { key: 'takvim', ad: 'Takvim', ikon: CalendarDays },
  { key: 'mukellef', ad: 'Mükellefe göre', ikon: Building2 },
];

export interface Suzgecler {
  kategori: string;
  oncelik: string;
  kaynak: string;
  mukellefId: string;
  arama: string;
}

/** Görünüm sekmeleri (hap) + süzgeç hap-menüleri (Kategori · Öncelik · Kaynak · Mükellef) + arama kutusu — tek satır. */
export function AracCubugu({
  gorunum,
  onGorunum,
  suzgec,
  onSuzgec,
  mukellefler,
}: {
  gorunum: Gorunum;
  onGorunum: (g: Gorunum) => void;
  suzgec: Suzgecler;
  onSuzgec: (s: Suzgecler) => void;
  mukellefler: MukellefSecenek[];
}) {
  const mukellef = suzgec.mukellefId ? mukellefler.find((m) => m.id === suzgec.mukellefId) : undefined;
  const suzgecVar = !!(suzgec.kategori || suzgec.oncelik || suzgec.kaynak || suzgec.mukellefId || suzgec.arama);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {/* Görünüm sekmeleri */}
      <div className="inline-flex flex-shrink-0 items-center rounded-full p-[3px]" style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }} role="tablist">
        {GORUNUMLER.map((g) => {
          const Ikon = g.ikon;
          const aktif = gorunum === g.key;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={aktif}
              onClick={() => onGorunum(g.key)}
              title={`${g.ad} görünümü`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[background-color,color] duration-150"
              style={aktif ? { background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' } : { background: 'transparent', color: IKINCIL }}
            >
              <Ikon size={12} /> {g.ad}
            </button>
          );
        })}
      </div>

      <span className="mx-0.5 hidden h-4 w-px flex-shrink-0 sm:block" style={{ background: 'rgba(255,255,255,0.12)' }} />

      {/* Kategori */}
      <HapMenu ikon={<Tag size={11} />} etiket={suzgec.kategori ? kategoriEtiketi(suzgec.kategori) : 'Kategori'} aktif={!!suzgec.kategori} renk={suzgec.kategori ? kategoriRengi(suzgec.kategori) : GOLD} title="Kategoriye göre süz">
        {(kapat) => (
          <div className="py-1">
            <MenuBaslik>Kategori</MenuBaslik>
            <MenuSatiri aktif={!suzgec.kategori} onClick={() => { onSuzgec({ ...suzgec, kategori: '' }); kapat(); }}>Tümü</MenuSatiri>
            <MenuAyrac />
            {CATEGORY_OPTIONS.map((c) => (
              <MenuSatiri key={c.value} aktif={suzgec.kategori === c.value} ikon={<span className="h-2 w-2 rounded-full" style={{ background: c.color }} />} onClick={() => { onSuzgec({ ...suzgec, kategori: c.value }); kapat(); }}>
                {c.label}
              </MenuSatiri>
            ))}
          </div>
        )}
      </HapMenu>

      {/* Öncelik */}
      <HapMenu ikon={<Flag size={11} />} etiket={suzgec.oncelik ? PRIORITY_LABEL[suzgec.oncelik as TaskPriority] : 'Öncelik'} aktif={!!suzgec.oncelik} renk={suzgec.oncelik ? PRIORITY_COLOR[suzgec.oncelik as TaskPriority] : GOLD} title="Önceliğe göre süz">
        {(kapat) => (
          <div className="py-1">
            <MenuBaslik>Öncelik</MenuBaslik>
            <MenuSatiri aktif={!suzgec.oncelik} onClick={() => { onSuzgec({ ...suzgec, oncelik: '' }); kapat(); }}>Tümü</MenuSatiri>
            <MenuAyrac />
            {[...PRIORITY_ORDER].reverse().map((p) => (
              <MenuSatiri key={p} aktif={suzgec.oncelik === p} ikon={<Flag size={12} />} renk={PRIORITY_COLOR[p]} onClick={() => { onSuzgec({ ...suzgec, oncelik: p }); kapat(); }}>
                {PRIORITY_LABEL[p]}
              </MenuSatiri>
            ))}
          </div>
        )}
      </HapMenu>

      {/* Kaynak */}
      <HapMenu ikon={<Waypoints size={11} />} etiket={suzgec.kaynak ? KAYNAK_OPTIONS.find((k) => k.value === suzgec.kaynak)?.label || suzgec.kaynak : 'Kaynak'} aktif={!!suzgec.kaynak} renk={suzgec.kaynak ? KAYNAK_COLOR[suzgec.kaynak as TaskKaynak] : GOLD} title="Kaynağa göre süz (Elle / Banka / Ekip / Takvim / AI / WhatsApp)">
        {(kapat) => (
          <div className="py-1">
            <MenuBaslik>Kaynak</MenuBaslik>
            <MenuSatiri aktif={!suzgec.kaynak} onClick={() => { onSuzgec({ ...suzgec, kaynak: '' }); kapat(); }}>Tümü</MenuSatiri>
            <MenuAyrac />
            {KAYNAK_OPTIONS.map((k) => (
              <MenuSatiri key={k.value} aktif={suzgec.kaynak === k.value} ikon={k.value === 'EKIP' ? <Users size={12} /> : <span className="h-2 w-2 rounded-full" style={{ background: KAYNAK_COLOR[k.value] }} />} renk={KAYNAK_COLOR[k.value]} onClick={() => { onSuzgec({ ...suzgec, kaynak: k.value }); kapat(); }}>
                {k.label}
              </MenuSatiri>
            ))}
          </div>
        )}
      </HapMenu>

      {/* Mükellef */}
      <HapMenu ikon={<Building2 size={11} />} etiket={mukellef ? mukellefAdi(mukellef) : 'Mükellef'} aktif={!!suzgec.mukellefId} renk="#34d399" title="Mükellefe göre süz" genislik={300}>
        {(kapat) => (
          <MukellefMenusu
            mukellefler={mukellefler}
            deger={suzgec.mukellefId || null}
            onSec={(id) => {
              onSuzgec({ ...suzgec, mukellefId: id || '' });
              kapat();
            }}
          />
        )}
      </HapMenu>

      {/* Arama */}
      <div className="relative min-w-[160px] flex-1 sm:max-w-[280px]">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: IKINCIL }} />
        <input
          type="search"
          value={suzgec.arama}
          onChange={(e) => onSuzgec({ ...suzgec, arama: e.target.value })}
          placeholder="Ara — başlık, açıklama, mükellef"
          aria-label="Görev ara"
          className="h-8 w-full rounded-full text-[12px] [&::-webkit-search-cancel-button]:hidden"
          style={{ ...GIRDI, borderRadius: 999, paddingLeft: 32, paddingRight: 12, WebkitAppearance: 'none', appearance: 'none' }}
        />
      </div>

      {suzgecVar && (
        <button
          type="button"
          onClick={() => onSuzgec({ kategori: '', oncelik: '', kaynak: '', mukellefId: '', arama: '' })}
          title="Süzgeçleri temizle"
          className="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold transition hover:brightness-125"
          style={{ color: IKINCIL, border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <X size={12} /> Temizle
        </button>
      )}
    </div>
  );
}

/** Hap biçimli süzgeç menüsü tetikleyicisi. */
function HapMenu({ ikon, etiket, aktif, renk, title, genislik = 230, children }: { ikon: ReactNode; etiket: string; aktif: boolean; renk: string; title: string; genislik?: number; children: (kapat: () => void) => ReactNode }) {
  return (
    <AcilirMenu
      genislik={genislik}
      hiza="sol"
      tetik={({ ref, ac, acik }) => (
        <button
          ref={ref}
          type="button"
          onClick={ac}
          title={title}
          aria-expanded={acik}
          className="inline-flex max-w-[220px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-[transform,filter] hover:-translate-y-px hover:brightness-125"
          style={aktif ? { background: `${renk}18`, border: `1px solid ${renk}66`, color: renk } : { background: 'transparent', border: `1px solid rgba(255,255,255,${acik ? '0.24' : '0.12'})`, color: acik ? METIN : IKINCIL }}
        >
          {ikon}
          <span className="truncate">{etiket}</span>
          <ChevronDown size={11} style={{ opacity: 0.7 }} />
        </button>
      )}
    >
      {children}
    </AcilirMenu>
  );
}
