'use client';
import './is-yuku-white.css';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Workflow, Clock, ChevronRight, ChevronLeft, FileText, Receipt, FileCheck, FileInput,
  Loader2, ArrowRight, CheckCircle2, SkipForward, Sparkles, Flame, UploadCloud, X,
} from 'lucide-react';

type Stage = 'EVRAK_BEKLIYOR' | 'YUKLEME_BEKLIYOR' | 'ISLENMEYI_BEKLIYOR' | 'KONTROL_BEKLIYOR' | 'BEYANNAME_BEKLIYOR' | 'TAMAM';

interface QueueItem {
  statusId: string;
  taxpayerId: string;
  taxpayerName: string;
  taxNumber: string;
  type: string;
  stage: Stage;
  actionLabel: string;
  actionPath: string;
  bekleyenGun: number;
  updatedAt: string;
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  kontrolEdildi: boolean;
  beyannameVerildi: boolean;
  monthlyStatusExists?: boolean;
}

type WorkflowCounts = { evrak: number; yukleme: number; islenme: number; kontrol: number; beyanname: number; tamam: number };

interface WorkflowData {
  year: number;
  month: number;
  donem: string;
  total: number;
  counts: WorkflowCounts;
  /** Sunucu 10 taneyle sınırlar; eksik gelirse sayfa boş listeyle çalışır. */
  siradaki?: QueueItem[];
  grouped?: Partial<Record<Stage, QueueItem[]>>;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Aşama dili: gösterge panelindeki "Bu Ay İş Akışı" kutucuklarıyla aynı ad, açıklama ve simge.
 *  Renkler CSS'te `data-akis-asama` ile: evrak kehribar · yükleme deniz yeşili · işleme mavi · kontrol mor · beyanname çivit · tamam yeşil. */
const STAGE_CONFIG: Record<Stage, { label: string; title: string; sub: string; icon: any; countKey: keyof WorkflowCounts }> = {
  EVRAK_BEKLIYOR:     { label: 'Evrak Bekleniyor',       title: 'Evrak Bekliyor', sub: 'Mükelleften gelecek', icon: FileInput,    countKey: 'evrak' },
  YUKLEME_BEKLIYOR:   { label: 'Yükleme Bekliyor',       title: 'Yükleme',        sub: 'Sisteme yüklenecek',  icon: UploadCloud,  countKey: 'yukleme' },
  ISLENMEYI_BEKLIYOR: { label: 'İşlenmeyi Bekliyor',     title: 'Fatura İşleme',  sub: 'İşlenmeyi bekliyor',  icon: Receipt,      countKey: 'islenme' },
  KONTROL_BEKLIYOR:   { label: 'KDV Kontrol Bekliyor',   title: 'KDV Kontrol',    sub: 'Kontrol bekliyor',    icon: FileCheck,    countKey: 'kontrol' },
  BEYANNAME_BEKLIYOR: { label: 'Beyanname Hazırlanacak', title: 'Beyanname',      sub: 'Hazırlanacak',        icon: FileText,     countKey: 'beyanname' },
  TAMAM:              { label: 'Tamamlandı',             title: 'Tamamlandı',     sub: 'Bu ay kapandı',       icon: CheckCircle2, countKey: 'tamam' },
};

const STAGE_ORDER: Stage[] = ['EVRAK_BEKLIYOR', 'YUKLEME_BEKLIYOR', 'ISLENMEYI_BEKLIYOR', 'KONTROL_BEKLIYOR', 'BEYANNAME_BEKLIYOR', 'TAMAM'];

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

function parseStageParam(value: string | null): Stage | null {
  return value && STAGE_ORDER.includes(value as Stage) ? value as Stage : null;
}

/** Bekleme süresi çipi tonu: 5+ gün kırmızı (acil), 2–4 gün kehribar, 0–1 gün nötr. */
function bekleyenTon(gun: number): 'kirmizi' | 'kehribar' | 'notr' {
  if (gun >= 5) return 'kirmizi';
  if (gun >= 2) return 'kehribar';
  return 'notr';
}

function StageChip({ stage, size = 'md' }: { stage: Stage; size?: 'sm' | 'md' }) {
  const cfg = STAGE_CONFIG[stage];
  const Icon = cfg.icon;
  return (
    <span data-akis-asama={stage} className={`ay-chip ay-chip-asama ${size === 'sm' ? 'ay-chip-sm' : ''}`}>
      <Icon size={size === 'sm' ? 11 : 12} /> {cfg.label}
    </span>
  );
}

/**
 * İş Akışı — sayfa başlığı + aylık özet (6 aşama kutucuğu) + "Şimdi yapılacak" + "Sıradakiler" +
 * aşama sütunları + geç kalanlar. Sıralama / ilerletme ("Sonraki", "Önceki") / süzgeç (?stage, ?late=1) korunur.
 */
export default function IsYukuPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [skipIndex, setSkipIndex] = useState(0); // "Sonraki" tıklandığında kaçıncı sıradaki gösterilecek
  const [stageFilter, setStageFilter] = useState<Stage | null>(() => parseStageParam(getQueryParam('stage')));
  const [lateOnly, setLateOnly] = useState(() => getQueryParam('late') === '1');

  const { data, isLoading } = useQuery<WorkflowData>({
    queryKey: ['workflow-queue', year, month],
    queryFn: () =>
      api.get('/taxpayers/workflow/queue', { params: { year, month } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  React.useEffect(() => {
    setStageFilter(parseStageParam(getQueryParam('stage')));
    setLateOnly(getQueryParam('late') === '1');
  }, []);

  React.useEffect(() => {
    setSkipIndex(0);
  }, [stageFilter, lateOnly]);

  const siradaki = useMemo(() => data?.siradaki ?? [], [data?.siradaki]);

  const filteredQueue = useMemo(() => {
    let items = siradaki;
    if (stageFilter) items = items.filter((item) => item.stage === stageFilter);
    if (lateOnly) items = items.filter((item) => item.bekleyenGun >= 5);
    return items;
  }, [siradaki, stageFilter, lateOnly]);

  // Öne çıkan iş — "Sonraki" ile değişir
  const heroItem = filteredQueue[skipIndex] || null;
  const nextItems = filteredQueue.slice(skipIndex + 1, skipIndex + 5);
  const visibleStages = stageFilter ? [stageFilter] : STAGE_ORDER;

  // Geç kalanlar — 5+ gün bekleyenler
  const gecKalanlar = useMemo(() => {
    let items = siradaki.filter((i) => i.bekleyenGun >= 5);
    if (stageFilter) items = items.filter((i) => i.stage === stageFilter);
    return items.slice(0, 8);
  }, [siradaki, stageFilter]);

  const donemAdi = `${AYLAR[month - 1]} ${year}`;

  return (
    <div className="is-yuku ay-root max-w-7xl space-y-5" data-ay-root>
      {/* Sayfa başlığı: yumuşak tonlu simge kutusu + başlık + kısa açıklama; sağda ay/yıl */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="ay-head-icon"><Workflow size={18} /></span>
          <div className="min-w-0">
            <h1 className="ay-title">İş Akışı</h1>
            <p className="ay-subtitle">Sabah aç, sırasıyla yap — sistem hangi mükellefin işini önce yapacağını söylüyor</p>
            {(stageFilter || lateOnly) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {stageFilter && <StageChip stage={stageFilter} size="sm" />}
                {lateOnly && (
                  <span className="ay-chip ay-chip-sm ay-chip-kirmizi"><Flame size={11} /> 5+ gün bekleyen</span>
                )}
                <button
                  type="button"
                  onClick={() => { setStageFilter(null); setLateOnly(false); }}
                  className="ay-chip ay-chip-sm ay-chip-notr ay-chip-button"
                >
                  <X size={11} /> Süzgeci temizle
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="ay-select" aria-label="Ay">
            {AYLAR.map((a, i) => <option key={i} value={i + 1}>{a}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="ay-select" aria-label="Yıl">
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>

      {isLoading ? (
        <div className="ay-loading py-16 text-center text-[13px]">
          <Loader2 className="mr-2 inline animate-spin" size={16} /> Yükleniyor...
        </div>
      ) : !data ? (
        <div className="ay-loading py-16 text-center text-[13px]">Veri yok</div>
      ) : (
        <>
          <WorkflowSummary data={data} donemAdi={donemAdi} />

          {/* ŞİMDİ YAPILACAK */}
          {heroItem ? (
            <HeroCard
              item={heroItem}
              sira={skipIndex + 1}
              total={filteredQueue.length}
              onSkip={() => setSkipIndex((idx) => Math.min(idx + 1, filteredQueue.length - 1))}
              canSkip={skipIndex < filteredQueue.length - 1}
              canGoBack={skipIndex > 0}
              onBack={() => setSkipIndex((idx) => Math.max(0, idx - 1))}
            />
          ) : data.counts.tamam === data.total && data.total > 0 ? (
            <AllDoneCard total={data.total} />
          ) : (
            <EmptyHero />
          )}

          {/* SIRADAKİLER */}
          {nextItems.length > 0 && (
            <section data-ay-siradakiler>
              <SectionLabel>Sıradakiler</SectionLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {nextItems.map((item, idx) => (
                  <MiniSiraKart key={item.statusId} item={item} sira={skipIndex + idx + 2} />
                ))}
              </div>
            </section>
          )}

          {/* AŞAMALARA GÖRE AKIŞ */}
          <section>
            <SectionLabel>Aşamalara göre akış</SectionLabel>
            <div id="pipeline" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {visibleStages.map((stage) => (
                <PipelineSutun
                  key={stage}
                  stage={stage}
                  items={(data.grouped?.[stage] ?? []).filter((item) => !lateOnly || item.bekleyenGun >= 5)}
                />
              ))}
            </div>
          </section>

          {/* GEÇ KALANLAR */}
          {gecKalanlar.length > 0 && (
            <section className="ay-card ay-late overflow-hidden">
              <div className="ay-card-head">
                <span className="ay-late-icon"><Flame size={15} /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="ay-card-title">Geç Kalanlar</h3>
                  <p className="ay-card-sub">5 gün ve daha uzun süredir aynı aşamada bekleyenler</p>
                </div>
                <span className="ay-chip ay-chip-kirmizi">{gecKalanlar.length} mükellef</span>
              </div>
              <div className="ay-rows">
                {gecKalanlar.map((item) => <GecKalanSatir key={item.statusId} item={item} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-3 px-0.5">
      <span className="ay-section-label">{children}</span>
      <span className="ay-section-rule h-px flex-1" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// AYLIK AKIŞ ÖZETİ — gösterge panelindeki "Bu Ay İş Akışı" kutucuklarıyla aynı dil
// ════════════════════════════════════════════════════════════════════
function WorkflowSummary({ data, donemAdi }: { data: WorkflowData; donemAdi: string }) {
  const counts = data.counts;
  const aktifIs = counts.yukleme + counts.islenme + counts.kontrol + counts.beyanname;

  return (
    <section className="ay-card overflow-hidden">
      <div className="ay-card-head">
        <span className="ay-card-bar" />
        <div className="min-w-0 flex-1">
          <h3 className="ay-card-title">Aylık Akış Özeti</h3>
          <p className="ay-card-sub">{donemAdi} · {data.total} mükellef akışta</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ay-chip ay-chip-civit">{aktifIs} aktif iş</span>
          <span className="ay-chip ay-chip-yesil">{counts.tamam} tamamlandı</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const Icon = cfg.icon;
            const count = counts[cfg.countKey] ?? data.grouped?.[stage]?.length ?? 0;
            const pct = data.total ? Math.round((count / data.total) * 100) : 0;
            return (
              <Link key={stage} href="#pipeline" data-akis-asama={stage} className="ay-counter block">
                <div className="flex items-start justify-between gap-2">
                  <span className="ay-counter-icon"><Icon size={16} /></span>
                  <span className="ay-counter-pct tabular-nums">%{pct}</span>
                </div>
                <div className="mt-2.5">
                  <div className="ay-counter-num tabular-nums">{count}</div>
                  <div className="ay-counter-title truncate">{cfg.title}</div>
                  <div className="ay-counter-sub truncate">{cfg.sub}</div>
                </div>
                <div className="ay-counter-bar mt-2.5">
                  <div style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// ŞİMDİ YAPILACAK — öne çıkan iş
// ════════════════════════════════════════════════════════════════════
function HeroCard({
  item, sira, total, onSkip, canSkip, canGoBack, onBack,
}: {
  item: QueueItem; sira: number; total: number;
  onSkip: () => void; canSkip: boolean; canGoBack: boolean; onBack: () => void;
}) {
  const ton = bekleyenTon(item.bekleyenGun);
  const isUrgent = item.bekleyenGun >= 5;

  return (
    <section data-akis-asama={item.stage} className="ay-card ay-hero">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ay-eyebrow"><Sparkles size={13} /> Şimdi yapılacak</span>
          {isUrgent && <span className="ay-chip ay-chip-sm ay-chip-kirmizi"><Flame size={11} /> Acil</span>}
        </div>
        <span className="ay-chip ay-chip-sm ay-chip-notr tabular-nums">Sıra {sira} / {total}</span>
      </div>

      <h2 className="ay-hero-name mt-2.5">{item.taxpayerName}</h2>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StageChip stage={item.stage} />
        <span className={`ay-chip ay-chip-${ton} tabular-nums`}>
          <Clock size={12} /> {item.bekleyenGun} gündür bekliyor
        </span>
        {item.taxNumber && <span className="ay-vkn tabular-nums">VKN {item.taxNumber}</span>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Link href={item.actionPath} className="ay-btn ay-btn-primary">
          {item.actionLabel} <ArrowRight size={15} />
        </Link>
        <button type="button" onClick={onSkip} disabled={!canSkip} className="ay-btn ay-btn-secondary">
          Sonraki <SkipForward size={13} />
        </button>
        {canGoBack && (
          <button type="button" onClick={onBack} className="ay-link">
            <ChevronLeft size={13} /> Önceki
          </button>
        )}
      </div>
    </section>
  );
}

function EmptyHero() {
  return (
    <section className="ay-empty px-8 py-12 text-center">
      <CheckCircle2 size={30} className="mx-auto mb-3" />
      <h2 className="ay-empty-title">Sıra boş</h2>
      <p className="ay-empty-text mx-auto mt-1.5 max-w-md">
        Şu an işlenmeyi veya kontrol bekleyen iş yok. Mükellef evrakları geldikçe burada görünür.
      </p>
    </section>
  );
}

function AllDoneCard({ total }: { total: number }) {
  return (
    <section className="ay-card ay-done px-8 py-10 text-center">
      <span className="ay-done-icon mx-auto mb-3"><Sparkles size={20} /></span>
      <h2 className="ay-empty-title">Bu ay tamamen kapandı</h2>
      <p className="ay-empty-text mt-1.5">
        Tüm <strong>{total} mükellefin</strong> beyannameleri verildi.
      </p>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// SIRADAKİLER — sonraki 4 iş
// ════════════════════════════════════════════════════════════════════
function MiniSiraKart({ item, sira }: { item: QueueItem; sira: number }) {
  return (
    <Link href={item.actionPath} data-akis-asama={item.stage} className="ay-next block">
      <div className="mb-2 flex items-center gap-2">
        <span className="ay-order tabular-nums">{sira}</span>
        <StageChip stage={item.stage} size="sm" />
      </div>
      <div className="ay-next-name truncate">{item.taxpayerName}</div>
      <div className="ay-next-sub mt-0.5 truncate tabular-nums">
        {item.bekleyenGun} gün · {item.actionLabel}
      </div>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// AŞAMA SÜTUNU — her aşamada bekleyenler (en eski önce, ilk 5)
// ════════════════════════════════════════════════════════════════════
function PipelineSutun({ stage, items }: { stage: Stage; items: QueueItem[] }) {
  const cfg = STAGE_CONFIG[stage];
  const Icon = cfg.icon;
  const sirali = [...items].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  const isEmpty = sirali.length === 0;

  return (
    <div data-akis-asama={stage} className="ay-col flex flex-col">
      <div className="ay-col-head">
        <span className="ay-col-icon"><Icon size={13} /></span>
        <span className="ay-col-title truncate">{cfg.title}</span>
        <span className="ay-col-count tabular-nums">{items.length}</span>
      </div>
      <div className="flex-1 space-y-1.5 p-2">
        {isEmpty ? (
          <div className="ay-col-empty flex h-full min-h-[120px] items-center justify-center">boş</div>
        ) : (
          sirali.slice(0, 5).map((item) => {
            const gec = stage !== 'TAMAM' && item.bekleyenGun >= 5; // tamamlananda gecikme anlamı yok
            return (
              <Link key={item.statusId} href={item.actionPath} className="ay-col-item block">
                <div className="ay-col-item-name truncate">{item.taxpayerName}</div>
                <div className={`ay-col-item-sub mt-0.5 flex items-center gap-1 tabular-nums ${gec ? 'ay-col-item-late' : ''}`}>
                  <Clock size={10} /> {item.bekleyenGun} gün {gec && <Flame size={10} />}
                </div>
              </Link>
            );
          })
        )}
        {sirali.length > 5 && (
          <div className="ay-col-more py-1 text-center tabular-nums">+{sirali.length - 5} daha</div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// GEÇ KALAN SATIRI
// ════════════════════════════════════════════════════════════════════
function GecKalanSatir({ item }: { item: QueueItem }) {
  const cfg = STAGE_CONFIG[item.stage];
  return (
    <Link href={item.actionPath} className="ay-row group flex items-center gap-3">
      <span className="ay-row-flame"><Flame size={13} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="ay-row-name truncate">{item.taxpayerName}</span>
          <span className="ay-chip ay-chip-sm ay-chip-kirmizi tabular-nums">{item.bekleyenGun} gün</span>
        </div>
        <div className="ay-row-sub mt-0.5 truncate">{cfg.label} · {item.actionLabel}</div>
      </div>
      <ChevronRight size={14} className="ay-row-arrow" />
    </Link>
  );
}
