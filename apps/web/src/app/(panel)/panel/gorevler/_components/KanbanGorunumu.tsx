'use client';
import { portalStyle } from '@/lib/portal-theme';


import { ArrowLeft, ArrowRight, Check, Loader2, Pin, RotateCcw } from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/tasks';
import { BosDurum } from '../../ekip/_components/Kart';
import { kartArkaPlan } from '../../ekip/_components/ortak';
import type { GorevEylemleri } from './eylemler';
import { SatirEylemleri } from './GorevTablosu';
import { DurumRozeti, GECIKME_RENK, KENAR_NOTR, KategoriEtiketi, KaynakRozeti, MukellefCipi, NotSayisi, OncelikEtiketi, SABIT_RENK, TekrarIkonu } from './Rozetler';
import { GOLD, IKINCIL, MAVI, METIN, MOR, YESIL, etkinTarih, gecikmeMetni, kisaTarih } from './ortak';

/*
 * SAKİN PALET (2026-09-14): sütun başlığı nötr zemin + küçük soluk renk noktası + gri sayı (dolu renkli başlık yok);
 * taşıma düğmeleri ince gri kenarlı, hover'da altın; gecikme tek yumuşak kırmızı; açık kart kenarı altın.
 */
/** Taşıma düğmesi — Tailwind sınıfı (satır içi stil hover'ı ezerdi). */
const TASI_SINIF = 'border border-white/[0.12] bg-white/[0.03] text-[#fafaf9]/75 hover:border-[#d4b876]/60 hover:text-[#d4b876]';

const SUTUNLAR: Array<{ key: TaskStatus; ad: string; renk: string }> = [
  { key: 'OPEN', ad: 'Açık', renk: GOLD },
  { key: 'IN_PROGRESS', ad: 'Sürüyor', renk: MAVI },
  { key: 'SNOOZED', ad: 'Ertelendi', renk: MOR },
  { key: 'DONE', ad: 'Bitti', renk: YESIL },
];

/**
 * Kanban — Açık · Sürüyor · Ertelendi · Bitti. Sürükle-bırak YOK; kart üstündeki görünür düğmelerle taşınır.
 * Bitti sütunu ajandadan gelmez (arka uç yalnız açıkları döner) → sayfa ayrıca /tasks?status=DONE çeker.
 */
export function KanbanGorunumu({ gorevler, bitenler, bitenlerYukleniyor, eylemler, acikId }: { gorevler: Task[]; bitenler: Task[]; bitenlerYukleniyor?: boolean; eylemler: GorevEylemleri; acikId?: string | null }) {
  const gruplar: Record<TaskStatus, Task[]> = { OPEN: [], IN_PROGRESS: [], SNOOZED: [], DONE: [], MISSED: [], CANCELLED: [] };
  for (const t of gorevler) (gruplar[t.status] || gruplar.OPEN).push(t);
  const gorulen = new Set(gorevler.map((t) => t.id));
  for (const t of bitenler) if (!gorulen.has(t.id)) gruplar.DONE.push(t);
  // MISSED (kaçırıldı) açık sayılır
  gruplar.OPEN.push(...gruplar.MISSED);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {SUTUNLAR.map((s) => {
        const liste = gruplar[s.key];
        return (
          <section key={s.key} className="min-w-0 overflow-hidden rounded-2xl" style={portalStyle({ ...kartArkaPlan(s.renk), minHeight: 240 })}>
            <div className="flex items-center gap-2 px-3.5 py-2.5" style={portalStyle({ background: 'rgba(255,255,255,0.045)', borderBottom: `1px solid ${KENAR_NOTR}` })}>
              <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: s.renk, opacity: 0.8 })} />
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[.08em]" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
                {s.ad}
              </h3>
              <span className="ml-auto text-[11.5px] tabular-nums" style={portalStyle({ color: IKINCIL })}>
                {liste.length}
              </span>
            </div>
            <div className="space-y-2 p-2">
              {s.key === 'DONE' && bitenlerYukleniyor && liste.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-6 text-[12px]" style={portalStyle({ color: IKINCIL })}>
                  <Loader2 size={13} className="animate-spin" /> Bitenler alınıyor
                </div>
              )}
              {liste.length === 0 && !(s.key === 'DONE' && bitenlerYukleniyor) && <BosDurum ikon={<Check size={16} />} metin={`${s.ad} sütununda görev yok`} renk={s.renk} />}
              {liste.map((t) => (
                <KanbanKarti key={t.id} gorev={t} sutun={s.key} eylemler={eylemler} acik={acikId === t.id} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanKarti({ gorev: t, sutun, eylemler, acik }: { gorev: Task; sutun: TaskStatus; eylemler: GorevEylemleri; acik?: boolean }) {
  const tarih = etkinTarih(t);
  const gecikme = t.status !== 'DONE' ? gecikmeMetni(tarih) : '';
  const gecikti = gecikme.endsWith('gecikti');
  const tasi = `inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-medium transition ${TASI_SINIF}`;

  return (
    <article className="rounded-xl p-3" style={portalStyle({ background: 'rgba(0,0,0,0.30)', border: `1px solid ${acik ? `${GOLD}99` : KENAR_NOTR}` })}>
      <button type="button" onClick={() => eylemler.ac(t.id)} title="Detayı aç" className={`block w-full text-left text-[13px] font-medium leading-5 hover:underline decoration-dotted underline-offset-4 ${t.status === 'DONE' ? 'line-through opacity-60' : ''}`} style={portalStyle({ color: METIN })}>
        {t.pinned && <Pin size={11} className="mr-1 inline -translate-y-px" style={portalStyle({ color: SABIT_RENK })} />}
        {t.title}
      </button>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <MukellefCipi taxpayer={t.taxpayer} />
        <KategoriEtiketi value={t.category} />
        <OncelikEtiketi value={t.priority} />
        <KaynakRozeti value={t.kaynak} />
        {sutun !== t.status && <DurumRozeti task={t} />}
        <NotSayisi n={t._count?.notes} />
        <TekrarIkonu task={t} />
      </div>
      {tarih && (
        <div className="mt-1.5 text-[11.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.8)' })}>
          {kisaTarih(tarih)}
          {!t.allDay && t.dueTime ? ` ${t.dueTime}` : ''}
          {gecikme ? <span style={portalStyle({ color: gecikti ? GECIKME_RENK : IKINCIL })}> · {gecikme}</span> : null}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t pt-2" style={portalStyle({ borderColor: 'rgba(255,255,255,0.07)' })}>
        <div className="flex flex-wrap items-center gap-1">
          {sutun === 'OPEN' && (
            <button type="button" onClick={() => eylemler.baslat(t.id)} className={tasi} title="Sürüyor sütununa taşı">
              Sürüyor <ArrowRight size={11} />
            </button>
          )}
          {sutun === 'IN_PROGRESS' && (
            <button type="button" onClick={() => eylemler.durumDegistir(t.id, 'OPEN')} className={tasi} title="Açık sütununa geri taşı">
              <ArrowLeft size={11} /> Açık
            </button>
          )}
          {sutun === 'SNOOZED' && (
            <button type="button" onClick={() => eylemler.yenidenAc(t.id)} className={tasi} title="Ertelemeyi kaldır, Açık'a taşı">
              <ArrowLeft size={11} /> Açık
            </button>
          )}
          {sutun === 'DONE' && (
            <button type="button" onClick={() => eylemler.yenidenAc(t.id)} className={tasi} title="Yeniden aç">
              <RotateCcw size={11} /> Yeniden aç
            </button>
          )}
          {sutun !== 'DONE' && (
            <button type="button" onClick={() => eylemler.tamamla(t.id)} className={tasi} title="Bitti sütununa taşı (tamamla)">
              <Check size={11} /> Bitti
            </button>
          )}
        </div>
        <SatirEylemleri gorev={t} eylemler={eylemler} kompakt durumDugmesiz />
      </div>
    </article>
  );
}
