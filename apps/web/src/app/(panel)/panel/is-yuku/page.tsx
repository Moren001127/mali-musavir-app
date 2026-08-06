'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Workflow, Clock, ChevronRight, FileText, Receipt, FileCheck,
  Loader2, Building2, ArrowRight, AlertTriangle, CheckCircle2,
  SkipForward, Sparkles, Calendar, Flame, UploadCloud,
} from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

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

interface WorkflowData {
  year: number;
  month: number;
  donem: string;
  total: number;
  counts: { evrak: number; yukleme: number; islenme: number; kontrol: number; beyanname: number; tamam: number };
  siradaki: QueueItem[];
  grouped: Record<Stage, QueueItem[]>;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const STAGE_CONFIG: Record<Stage, { label: string; short: string; color: string; icon: any; gradient: string; bg: string }> = {
  EVRAK_BEKLIYOR:     { label: 'Evrak Bekleniyor',       short: 'BEKLİYOR',  color: '#cbd5e1', icon: Clock,        gradient: 'rgba(203,213,225,0.16)', bg: 'rgba(203,213,225,0.06)' },
  YUKLEME_BEKLIYOR:   { label: 'Yükleme Bekliyor',       short: 'YÜKLEME',   color: '#2dd4bf', icon: UploadCloud,  gradient: 'rgba(45,212,191,0.18)',  bg: 'rgba(45,212,191,0.06)' },
  ISLENMEYI_BEKLIYOR: { label: 'İşlenmeyi Bekliyor',     short: 'İŞLENECEK', color: '#60a5fa', icon: Receipt,      gradient: 'rgba(96,165,250,0.18)',  bg: 'rgba(96,165,250,0.06)' },
  KONTROL_BEKLIYOR:   { label: 'KDV Kontrol Bekliyor',   short: 'KONTROL',   color: '#fbbf24', icon: FileCheck,    gradient: 'rgba(251,191,36,0.20)',  bg: 'rgba(251,191,36,0.07)' },
  BEYANNAME_BEKLIYOR: { label: 'Beyanname Hazırlanacak', short: 'BEYAN',     color: '#c084fc', icon: FileText,     gradient: 'rgba(192,132,252,0.20)', bg: 'rgba(192,132,252,0.07)' },
  TAMAM:              { label: 'Tamamlandı',             short: 'TAMAM',     color: '#4ade80', icon: CheckCircle2, gradient: 'rgba(74,222,128,0.18)',  bg: 'rgba(74,222,128,0.05)' },
};

const STAGE_ORDER: Stage[] = ['EVRAK_BEKLIYOR', 'YUKLEME_BEKLIYOR', 'ISLENMEYI_BEKLIYOR', 'KONTROL_BEKLIYOR', 'BEYANNAME_BEKLIYOR', 'TAMAM'];

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

function parseStageParam(value: string | null): Stage | null {
  return value && STAGE_ORDER.includes(value as Stage) ? value as Stage : null;
}

/**
 * v1.36.79: İş Akışı sayfası — HERO + KANBAN + GEÇ KALANLAR hibrit tasarımı.
 *
 *  ┌─ ŞİMDİ YAPILACAK (büyük hero kart) ──────┐
 *  │ #1 mükellef + aksiyon butonu              │
 *  └────────────────────────────────────────────┘
 *
 *  Pipeline (5 sütunlu yatay)  Geç Kalanlar (5+ gün)
 */
export default function IsYukuPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [skipIndex, setSkipIndex] = useState(0); // "Sonraki" tıklandığında hero'da kaçıncı item gösterilecek
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

  const filteredQueue = useMemo(() => {
    let items = data?.siradaki || [];
    if (stageFilter) items = items.filter((item) => item.stage === stageFilter);
    if (lateOnly) items = items.filter((item) => item.bekleyenGun >= 5);
    return items;
  }, [data?.siradaki, stageFilter, lateOnly]);

  // Hero'daki aktif item — atlama ile değişebilir
  const heroItem = filteredQueue?.[skipIndex] || null;
  const nextItems = filteredQueue.slice(skipIndex + 1, skipIndex + 5);
  const evrakPct = data?.total ? Math.round((data.counts.evrak / data.total) * 100) : 0;
  const visibleStages = stageFilter ? [stageFilter] : STAGE_ORDER;

  // Geç kalanlar — 5+ gün bekleyenler
  const gecKalanlar = useMemo(() => {
    if (!data) return [];
    let items = [...data.siradaki].filter((i) => i.bekleyenGun >= 5);
    if (stageFilter) items = items.filter((i) => i.stage === stageFilter);
    return items.slice(0, 8);
  }, [data, stageFilter]);

  return (
    <div className="space-y-6 max-w-7xl">
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-3"
        style={{
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="mb-2 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Ofis Akışı</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{
                width: 40,
                height: 40,
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`,
                boxShadow: '0 8px 22px rgba(212,184,118,0.30)',
              }}
            >
              <Workflow size={20} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>
                İş Akışı
              </h1>
              <p className="mt-1 text-[12.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.48)' }}>
                Sabah aç, sırasıyla yap — sistem hangi mükellefin işini önce yapacağını söylüyor
              </p>
              {(stageFilter || lateOnly) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {stageFilter && (
                    <span className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
                      {STAGE_CONFIG[stageFilter].label}
                    </span>
                  )}
                  {lateOnly && (
                    <span className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.24)', color: '#fca5a5' }}>
                      5+ gün bekleyen
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setStageFilter(null); setLateOnly(false); }}
                    className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.55)' }}
                  >
                    Filtreyi temizle
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-[10px] p-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="cursor-pointer bg-transparent px-2 py-1.5 text-[12.5px] font-medium outline-none"
              style={{ color: '#fafaf9' }}>
              {AYLAR.map((a, i) => <option key={i} value={i + 1} style={{ background: '#0f0d0b' }}>{a}</option>)}
            </select>
            <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)' }} />
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="cursor-pointer bg-transparent px-2 py-1.5 text-[12.5px] font-medium outline-none"
              style={{ color: '#fafaf9' }}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>)}
            </select>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.4)' }}>
          <Loader2 className="inline animate-spin mr-2" size={16} /> Yükleniyor...
        </div>
      ) : !data ? (
        <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.4)' }}>Veri yok</div>
      ) : (
        <>
          <WorkflowSummary data={data} evrakPct={evrakPct} />

          {/* HERO — ŞİMDİ YAP */}
          {heroItem ? (
            <HeroCard
              item={heroItem}
              sira={skipIndex + 1}
              total={filteredQueue.length}
              onSkip={() => setSkipIndex((idx) => Math.min(idx + 1, filteredQueue.length - 1))}
              canGoBack={skipIndex > 0}
              onBack={() => setSkipIndex((idx) => Math.max(0, idx - 1))}
            />
          ) : data.counts.tamam === data.total && data.total > 0 ? (
            <AllDoneCard total={data.total} />
          ) : (
            <EmptyHero />
          )}

          {/* SIRADAKİ MINI KARTLAR */}
          {nextItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD_SOFT }}>
                  Sıradakiler
                </span>
                <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {nextItems.map((item, idx) => (
                  <MiniSiraKart key={item.statusId} item={item} sira={skipIndex + idx + 2} />
                ))}
              </div>
            </div>
          )}

          {/* PIPELINE — Yatay 5 sütun */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD_SOFT }}>
                Aşamalara Göre Akış
              </span>
              <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
            </div>
            <div id="pipeline" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {visibleStages.map((stage) => (
                <PipelineSutun
                  key={stage}
                  stage={stage}
                  items={(data.grouped[stage] || []).filter((item) => !lateOnly || item.bekleyenGun >= 5)}
                />
              ))}
            </div>
          </div>

          {/* GEÇ KALANLAR — uyarı kartı */}
          {gecKalanlar.length > 0 && (
            <div className="rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02))',
                border: '1px solid rgba(239,68,68,0.25)',
              }}>
              <div className="flex items-center gap-2.5 px-5 py-4"
                style={{ borderBottom: '1px solid rgba(239,68,68,0.20)' }}>
                <Flame size={16} style={{ color: '#ef4444' }} />
                <h3 className="text-[14px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
                  Geç Kalanlar
                </h3>
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1"
                  style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
                  {gecKalanlar.length} mükellef · 5+ gün
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {gecKalanlar.map((item) => <GecKalanSatir key={item.statusId} item={item} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// HERO CARD — ŞİMDİ YAPILACAK (büyük öne çıkan kart)
// ════════════════════════════════════════════════════════════════════
function WorkflowSummary({ data, evrakPct }: { data: WorkflowData; evrakPct: number }) {
  const aktifIs = data.counts.yukleme + data.counts.islenme + data.counts.kontrol + data.counts.beyanname;
  const kaydiOlmayan = Object.values(data.grouped || {})
    .flat()
    .filter((i) => !i.monthlyStatusExists).length;

  return (
    <div
      className="rounded-3xl overflow-hidden"
      style={{
        background: 'radial-gradient(circle at 0% 0%, rgba(212,184,118,0.14), transparent 46%), linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))',
        border: '1px solid rgba(212,184,118,0.24)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.22)',
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_2fr]">
        <div className="p-4" style={{ borderRight: '1px solid rgba(212,184,118,0.16)' }}>
          <div className="text-[10px] uppercase font-bold tracking-[.18em] mb-2" style={{ color: GOLD_SOFT }}>
            Aylık Akış Özeti
          </div>
          <div className="flex items-end gap-4">
            <div>
              <div className="tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 700, color: '#fafaf9', lineHeight: 1 }}>
                {data.total}
              </div>
              <div className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.48)' }}>
                {data.donem} döneminde aktif mükellef
              </div>
            </div>
            <div className="pb-1">
              <div className="text-[13px] font-semibold" style={{ color: aktifIs > 0 ? GOLD : '#86efac' }}>
                {aktifIs} aktif iş
              </div>
              <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
                {data.counts.tamam} tamamlandı
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.72)' }}>
            Evrak bekliyor: aktif olup bu ay evrak geldi işaretlenmemiş mükellefler. Aylık kayıt açılmamış olanlar da burada sayılır{kaydiOlmayan > 0 ? ` (${kaydiOlmayan} kayıt otomatik tamamlandı).` : '.'}
          </div>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6">
          {STAGE_ORDER.map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const Icon = cfg.icon;
            const count = data.grouped?.[stage]?.length || 0;
            const pct = data.total ? Math.round((count / data.total) * 100) : 0;
            return (
              <Link
                key={stage}
                href="#pipeline"
                className="p-3 transition hover:bg-white/[0.03]"
                style={{ borderLeft: '1px solid rgba(255,255,255,0.055)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: cfg.gradient, border: `1px solid ${cfg.color}30` }}>
                    <Icon size={15} style={{ color: cfg.color }} />
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: stage === 'EVRAK_BEKLIYOR' ? GOLD : 'rgba(250,250,249,0.44)' }}>
                    {stage === 'EVRAK_BEKLIYOR' ? `%${evrakPct}` : `%${pct}`}
                  </span>
                </div>
                <div className="mt-2 tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 25, fontWeight: 700, color: cfg.color, lineHeight: 1 }}>
                  {count}
                </div>
                <div className="text-[11px] uppercase font-bold tracking-[.08em] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
                  {cfg.short}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HeroCard({
  item, sira, total, onSkip, canGoBack, onBack,
}: {
  item: QueueItem; sira: number; total: number;
  onSkip: () => void; canGoBack: boolean; onBack: () => void;
}) {
  const cfg = STAGE_CONFIG[item.stage];
  const Icon = cfg.icon;
  const isUrgent = item.bekleyenGun >= 5;

  return (
    <div className="rounded-3xl overflow-hidden relative"
      style={{
        background: `radial-gradient(circle at 30% 0%, ${cfg.gradient}, transparent 70%), linear-gradient(135deg, rgba(212,184,118,0.08), rgba(212,184,118,0.02))`,
        border: '1px solid rgba(212,184,118,0.30)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
      }}>
      {/* Üst etiket bandı */}
      <div className="flex items-center justify-between px-7 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: GOLD_SOFT }}>
              ŞİMDİ YAPILACAK
            </span>
          </div>
          {isUrgent && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
              <Flame size={10} /> ACIL
            </span>
          )}
        </div>
        <div className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Sıra {sira}/{total}
        </div>
      </div>

      {/* Mükellef adı — büyük serif */}
      <div className="px-7 pt-2 pb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <Building2 size={20} style={{ color: 'rgba(250,250,249,0.4)' }} />
          <h2 style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 42,
            fontWeight: 600,
            color: '#fafaf9',
            letterSpacing: '-.03em',
            lineHeight: 1.05,
          }}>
            {item.taxpayerName}
          </h2>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded"
            style={{ background: cfg.gradient, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
            <Icon size={11} /> {cfg.label}
          </span>
          <span className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
            <Clock size={12} className="inline mr-1" />
            {item.bekleyenGun} gündür bekliyor
          </span>
          <span className="text-[12px] font-mono" style={{ color: 'rgba(250,250,249,0.35)' }}>
            {item.taxNumber}
          </span>
        </div>
      </div>

      {/* Aksiyon butonları */}
      <div className="px-7 pb-7 pt-2 flex items-center gap-3 flex-wrap">
        <Link
          href={item.actionPath}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-bold transition-all hover:scale-[1.02]"
          style={{
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`,
            color: '#0f0d0b',
            boxShadow: `0 8px 24px ${GOLD}33`,
          }}
        >
          {item.actionLabel} <ArrowRight size={16} />
        </Link>
        <button onClick={onSkip}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-[12.5px] font-medium transition"
          style={{
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(250,250,249,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
          Sonraki <SkipForward size={13} />
        </button>
        {canGoBack && (
          <button onClick={onBack}
            className="text-[11.5px] underline-offset-2 hover:underline"
            style={{ color: 'rgba(250,250,249,0.5)' }}>
            ← Önceki
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyHero() {
  return (
    <div className="rounded-3xl py-16 px-8 text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))',
        border: '1px solid rgba(34,197,94,0.20)',
      }}>
      <CheckCircle2 size={36} className="mx-auto mb-4" style={{ color: '#22c55e' }} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 600, color: '#fafaf9' }}>
        Sıra boş
      </h2>
      <p className="text-[13.5px] mt-2 max-w-md mx-auto" style={{ color: 'rgba(250,250,249,0.5)' }}>
        Şu an işlenmeyi bekleyen veya kontrol bekleyen iş yok. Mükellef evrakları geldikçe burada görünür.
      </p>
    </div>
  );
}

function AllDoneCard({ total }: { total: number }) {
  return (
    <div className="rounded-3xl py-12 px-8 text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.04))',
        border: '1px solid rgba(34,197,94,0.30)',
      }}>
      <Sparkles size={36} className="mx-auto mb-4" style={{ color: '#22c55e' }} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 600, color: '#fafaf9' }}>
        Bu ay tamamen kapandı 🎉
      </h2>
      <p className="text-[14px] mt-2" style={{ color: 'rgba(250,250,249,0.55)' }}>
        Tüm <strong style={{ color: '#22c55e' }}>{total} mükellefin</strong> beyannameleri verildi.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MİNİ SIRA KARTI — Sıradaki 4 iş (yatay grid)
// ════════════════════════════════════════════════════════════════════
function MiniSiraKart({ item, sira }: { item: QueueItem; sira: number }) {
  const cfg = STAGE_CONFIG[item.stage];
  return (
    <Link href={item.actionPath}
      className="rounded-xl p-3.5 transition-all hover:scale-[1.02] block"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="tabular-nums" style={{
          fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: GOLD, lineHeight: 1,
        }}>
          {sira}
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: cfg.color }}>
          {cfg.short}
        </span>
      </div>
      <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
        {item.taxpayerName}
      </div>
      <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {item.bekleyenGun} gün · {item.actionLabel}
      </div>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// PIPELINE SÜTUNU — Aşama bazlı 5 sütun (Kanban)
// v1.36.80: Renkler daha doygun, header'da büyük serif sayı, boş sütun
// daha şık empty state, kartlar hover'da kalkıyor.
// ════════════════════════════════════════════════════════════════════
function PipelineSutun({ stage, items }: { stage: Stage; items: QueueItem[] }) {
  const cfg = STAGE_CONFIG[stage];
  const Icon = cfg.icon;
  const sirali = [...items].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  const isEmpty = sirali.length === 0;

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: `linear-gradient(180deg, ${cfg.gradient} 0%, ${cfg.bg} 100%)`,
        border: `1px solid ${cfg.color}38`,
        minHeight: 240,
        boxShadow: isEmpty ? 'none' : `0 4px 16px ${cfg.color}10`,
      }}>
      {/* Header — büyük rakam + ikon */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between"
        style={{ borderBottom: `1px solid ${cfg.color}28` }}>
        <div className="flex flex-col gap-1.5">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md"
            style={{ background: `${cfg.color}22`, width: 'fit-content' }}>
            <Icon size={11} style={{ color: cfg.color }} />
            <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: cfg.color }}>
              {cfg.short}
            </span>
          </div>
        </div>
        <span className="tabular-nums leading-none"
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 28,
            fontWeight: 700,
            color: isEmpty ? `${cfg.color}55` : cfg.color,
            letterSpacing: '-0.03em',
          }}>
          {items.length}
        </span>
      </div>

      {/* Kartlar */}
      <div className="p-2 space-y-1.5 flex-1">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-8 gap-2"
            style={{ opacity: 0.4 }}>
            <Icon size={18} style={{ color: cfg.color }} />
            <span className="text-[10.5px] uppercase tracking-wider" style={{ color: cfg.color }}>
              boş
            </span>
          </div>
        ) : (
          sirali.slice(0, 5).map((item) => (
            <Link key={item.statusId} href={item.actionPath}
              className="block rounded-lg px-3 py-2.5 transition-all hover:translate-y-[-1px]"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${cfg.color}1a`,
              }}>
              <div className="text-[12.5px] font-semibold truncate" style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}>
                {item.taxpayerName}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[10.5px]"
                style={{ color: item.bekleyenGun >= 5 ? '#ef4444' : 'rgba(250,250,249,0.55)' }}>
                <Clock size={9} />
                <span className="tabular-nums">{item.bekleyenGun}gün</span>
                {item.bekleyenGun >= 5 && <Flame size={9} />}
              </div>
            </Link>
          ))
        )}
        {sirali.length > 5 && (
          <div className="text-center text-[11px] py-1.5 font-medium"
            style={{ color: cfg.color, opacity: 0.7 }}>
            +{sirali.length - 5} daha
          </div>
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
    <Link href={item.actionPath}
      className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition group">
      <Flame size={14} style={{ color: '#ef4444' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
            {item.taxpayerName}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
            {item.bekleyenGun}gün
          </span>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
          {cfg.label} · {item.actionLabel}
        </div>
      </div>
      <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 transition"
        style={{ color: GOLD }} />
    </Link>
  );
}
