'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Wand2,
  Clock,
  Webhook,
  Sparkles,
  Pause,
  Play,
  Archive,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Zap,
  FlaskConical,
  Trash2,
  Search,
  Activity,
  XCircle,
  Wallet,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  History,
} from 'lucide-react';
import {
  automationsApi,
  describeCron,
  describeEvent,
  type Automation,
  type AutomationStatus,
  type AutomationTriggerType,
} from '@/lib/automations';

// ── Otomasyon modülü imza paleti (AI Maliyet stili — koyu zemin, mor imza) ──
const VIOLET = '#a855f7';
const VIOLET_SOFT = '#c084fc';
const GOLD = '#d4b876';
const BG = '#0f0d0b';
const CARD = '#15110d';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const GREEN = '#4ade80';
const RED = '#f87171';
const AMBER = '#fbbf24';
const BLUE = '#60a5fa';

export default function OtomasyonlarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | 'all'>('all');
  const [triggerFilter, setTriggerFilter] = useState<AutomationTriggerType | 'all'>('all');
  const [showRecent, setShowRecent] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['automations', { search, status: statusFilter, trigger: triggerFilter }],
    queryFn: () =>
      automationsApi.list({
        pageSize: 50,
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        triggerType: triggerFilter !== 'all' ? triggerFilter : undefined,
      }),
  });

  const { data: summary } = useQuery({
    queryKey: ['automations-summary'],
    queryFn: () => automationsApi.summary(),
    refetchInterval: 30000,
  });

  const { data: recentRuns } = useQuery({
    queryKey: ['automations-recent-runs'],
    queryFn: () => automationsApi.recentRuns(15),
    refetchInterval: 15000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AutomationStatus }) =>
      automationsApi.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automations-summary'] });
      toast.success('Durum güncellendi');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Güncelleme başarısız');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => automationsApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Otomasyon arşivlendi');
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => automationsApi.runNow(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automations-recent-runs'] });
      if (result.status === 'running') {
        toast.info(result.summary || 'Çalışma kuyruğa alındı');
        return;
      }
      const icon = result.status === 'success' ? '✓' : result.status === 'failure' ? '✗' : '⚠';
      toast.success(`${icon} ${result.summary || 'Çalışma tamamlandı'}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Çalıştırma başarısız');
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: (id: string) => automationsApi.dryRun(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automations-recent-runs'] });
      toast.info(`Dry-run: ${result.summary || 'Adımlar simüle edildi'}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Dry-run başarısız');
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => automationsApi.hardDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Otomasyon kalıcı olarak silindi');
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.message ||
          'Kalıcı silme başarısız. Sadece hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir.',
      );
    },
  });

  const weeklyCostUsd = Number(summary?.weeklyCostUsd ?? 0);
  const monthlyCostUsd = Number(summary?.monthlyCostUsd ?? 0);
  const monthlyBudgetUsd = summary?.monthlyBudgetUsd ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-16" style={{ color: TEXT }}>
      {/* ── Başlık (radial + üst renk şeridi, yapışkan değil) ── */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: LINE,
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(168,85,247,0.18), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(212,184,118,0.14), transparent 46%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #a855f7, #c084fc, #60a5fa, #4ade80, #d4b876)' }}
        />
        <Link
          href="/panel"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: MUTED }}
        >
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{
                background: 'linear-gradient(135deg, #a855f7, #c084fc)',
                boxShadow: '0 6px 18px rgba(168,85,247,0.40)',
              }}
            >
              <Wand2 size={20} style={{ color: '#1a1410' }} />
            </span>
            Otomasyonlarım
          </h1>
          <Link
            href="/panel/otomasyonlar/yeni"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold"
            style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
          >
            <Plus size={16} /> Yeni Otomasyon
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          Türkçe bir cümleyle kurduğun işler arka planda kendiliğinden çalışır. Durumlarını,
          bir sonraki çalışma zamanını ve geçmişlerini buradan takip edersin.
        </p>
      </header>

      {/* ── Özet bandı ── */}
      {summary && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            color={GREEN}
            icon={<Activity size={15} />}
            label="Aktif"
            value={summary.active}
            sub={`${summary.paused} duraklatıldı`}
          />
          <Stat
            color={GREEN}
            icon={<CheckCircle2 size={15} />}
            label="Bu hafta başarılı"
            value={summary.weeklySuccess}
            sub={`${summary.weeklyTotal} toplam çalışma`}
          />
          <Stat
            color={summary.weeklyFailure > 0 ? RED : MUTED}
            icon={<XCircle size={15} />}
            label="Bu hafta hata"
            value={summary.weeklyFailure}
            sub={summary.error > 0 ? `${summary.error} otomasyon HATA'da` : 'Sistem sağlıklı'}
          />
          <BudgetStat monthly={monthlyCostUsd} weekly={weeklyCostUsd} budget={monthlyBudgetUsd} />
        </section>
      )}

      {/* ── Arama + filtre (kompakt tek satır) ── */}
      <section className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input
            type="text"
            placeholder="Otomasyonlarda ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-transparent py-2 pl-9 pr-3 text-[13px] outline-none"
            style={{ borderColor: LINE, color: TEXT }}
          />
        </div>
        <div className="flex gap-2">
          <FilterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as any)}>
            <option value="all" style={{ background: BG }}>Tüm durumlar</option>
            <option value="ACTIVE" style={{ background: BG }}>Aktif</option>
            <option value="PAUSED" style={{ background: BG }}>Duraklatıldı</option>
            <option value="DRAFT" style={{ background: BG }}>Taslak</option>
            <option value="ERROR" style={{ background: BG }}>Hata</option>
            <option value="ARCHIVED" style={{ background: BG }}>Arşiv</option>
          </FilterSelect>
          <FilterSelect value={triggerFilter} onChange={(v) => setTriggerFilter(v as any)}>
            <option value="all" style={{ background: BG }}>Tüm tetikleyiciler</option>
            <option value="CRON" style={{ background: BG }}>Zamanlı</option>
            <option value="EVENT" style={{ background: BG }}>Olay</option>
            <option value="MANUAL" style={{ background: BG }}>Manuel</option>
          </FilterSelect>
        </div>
      </section>

      {/* ── Son çalışmalar (varsayılan gizli — tıkla aç) ── */}
      {recentRuns && recentRuns.length > 0 && (
        <section>
          <button
            onClick={() => setShowRecent((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors"
            style={{ color: MUTED }}
          >
            <History size={13} />
            Son çalışmalar ({recentRuns.length})
            <ChevronDown
              size={14}
              style={{ transform: showRecent ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
            />
          </button>
          {showRecent && (
            <div className="mt-2 flex flex-wrap gap-2">
              {recentRuns.slice(0, 12).map((run) => {
                const c = run.status === 'success' ? GREEN : run.status === 'failure' ? RED : BLUE;
                return (
                  <button
                    key={run.id}
                    onClick={() => router.push(`/panel/otomasyonlar/${run.automation.id}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors"
                    style={{ borderColor: LINE, background: CARD }}
                  >
                    {run.status === 'success' ? (
                      <CheckCircle2 size={13} style={{ color: c }} />
                    ) : run.status === 'failure' ? (
                      <XCircle size={13} style={{ color: c }} />
                    ) : (
                      <Activity size={13} style={{ color: c }} />
                    )}
                    <span className="font-medium" style={{ color: TEXT }}>{run.automation.title}</span>
                    <span style={{ color: MUTED }}>{timeAgo(run.startedAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Durumlar ── */}
      {isLoading && (
        <div className="rounded-2xl border p-12 text-center text-[13px]" style={{ borderColor: LINE, color: MUTED, background: CARD }}>
          Yükleniyor…
        </div>
      )}
      {error && (
        <div className="rounded-2xl border p-4 text-[13px]" style={{ borderColor: `${RED}55`, background: `${RED}14`, color: RED }}>
          Liste yüklenemedi: {(error as any)?.message}
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed p-12 text-center" style={{ borderColor: LINE, background: CARD }}>
          <Inbox size={40} className="mx-auto mb-3" style={{ color: MUTED }} />
          <h3 className="text-[16px] font-medium">Henüz otomasyonun yok</h3>
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
            "Yeni Otomasyon" diyerek bir cümleyle ilk otomasyonunu kurabilirsin.
          </p>
          <Link
            href="/panel/otomasyonlar/yeni"
            className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold"
            style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
          >
            <Plus size={16} /> İlkini Oluştur
          </Link>
        </div>
      )}

      {/* ── Otomasyon kart-listesi ── */}
      {data && data.items.length > 0 && (
        <section className="space-y-2.5">
          {data.items.map((auto) => (
            <AutomationRow
              key={auto.id}
              auto={auto}
              onOpen={(id) => router.push(`/panel/otomasyonlar/${id}`)}
              onToggleActive={(id, current) =>
                statusMutation.mutate({ id, status: current === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })
              }
              onArchive={(id) => archiveMutation.mutate(id)}
              onHardDelete={(id) => hardDeleteMutation.mutate(id)}
              onRunNow={(id) => runNowMutation.mutate(id)}
              onDryRun={(id) => dryRunMutation.mutate(id)}
              runNowPending={runNowMutation.isPending}
            />
          ))}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Otomasyon satır-kartı
// ─────────────────────────────────────────────────────────────
function AutomationRow({
  auto,
  onOpen,
  onToggleActive,
  onArchive,
  onHardDelete,
  onRunNow,
  onDryRun,
  runNowPending,
}: {
  auto: Automation;
  onOpen: (id: string) => void;
  onToggleActive: (id: string, current: AutomationStatus) => void;
  onArchive: (id: string) => void;
  onHardDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onDryRun: (id: string) => void;
  runNowPending: boolean;
}) {
  const canHardDelete = auto.status === 'DRAFT' && auto.totalRuns === 0;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const lastOk = auto.lastRunStatus === 'success';
  const lastFail = auto.lastRunStatus === 'failure' || auto.lastRunStatus === 'partial';

  return (
    <div
      onClick={() => onOpen(auto.id)}
      className="group cursor-pointer rounded-xl border p-3.5 transition-colors"
      style={{ borderColor: LINE, background: CARD }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Sol: başlık + cümle + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>
              {auto.title}
            </span>
            <StatusBadge status={auto.status} />
          </div>
          <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: MUTED }}>
            {auto.prompt}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]" style={{ color: MUTED }}>
            <span className="inline-flex items-center gap-1.5">
              <TriggerIcon t={auto.triggerType} />
              {triggerShort(auto.triggerType, auto.triggerConfig)}
            </span>
            {auto.status === 'ACTIVE' && auto.nextRunAt && (
              <span className="inline-flex items-center gap-1.5" style={{ color: VIOLET_SOFT }}>
                <CalendarClock size={13} /> Sıradaki: {new Date(auto.nextRunAt).toLocaleString('tr-TR')}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              {lastOk && <CheckCircle2 size={13} style={{ color: GREEN }} />}
              {lastFail && <AlertTriangle size={13} style={{ color: RED }} />}
              {auto.lastRunAt
                ? `Son: ${new Date(auto.lastRunAt).toLocaleString('tr-TR')}`
                : 'Hiç çalışmadı'}
            </span>
            <span>
              {auto.totalRuns} çalışma · <span style={{ color: GREEN }}>{auto.successRuns} başarı</span>
            </span>
          </div>
        </div>

        {/* Sağ: aksiyonlar */}
        <div className="flex shrink-0 items-center gap-1" onClick={stop}>
          {auto.status === 'ACTIVE' && (
            <IconBtn title="Şimdi Çalıştır (gerçek)" color={AMBER} disabled={runNowPending} onClick={() => onRunNow(auto.id)}>
              <Zap size={15} />
            </IconBtn>
          )}
          {auto.status !== 'ARCHIVED' && (
            <IconBtn title="Dry-Run (aksiyon yapmadan dene)" color={MUTED} onClick={() => onDryRun(auto.id)}>
              <FlaskConical size={15} />
            </IconBtn>
          )}
          {(auto.status === 'ACTIVE' || auto.status === 'PAUSED' || auto.status === 'DRAFT' || auto.status === 'ERROR') && (
            <IconBtn
              title={auto.status === 'ACTIVE' ? 'Duraklat' : 'Aktive et'}
              color={auto.status === 'ACTIVE' ? AMBER : GREEN}
              onClick={() => onToggleActive(auto.id, auto.status)}
            >
              {auto.status === 'ACTIVE' ? <Pause size={15} /> : <Play size={15} />}
            </IconBtn>
          )}
          {auto.status !== 'ARCHIVED' && (
            <IconBtn
              title="Arşivle (geçmiş korunur)"
              color={MUTED}
              onClick={() => {
                if (confirm(`"${auto.title}" arşivlensin mi?`)) onArchive(auto.id);
              }}
            >
              <Archive size={15} />
            </IconBtn>
          )}
          {canHardDelete && (
            <IconBtn
              title="Kalıcı sil (hiç çalışmamış taslak)"
              color={RED}
              onClick={() => {
                if (confirm(`"${auto.title}" KALICI olarak silinsin mi?\n\nBu işlem geri alınamaz.`))
                  onHardDelete(auto.id);
              }}
            >
              <Trash2 size={15} />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ─────────────────────────────────────────────────────────────
function Stat({
  color,
  icon,
  label,
  value,
  sub,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: LINE, background: CARD }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>{value}</div>
      {sub && <div className="text-[11px]" style={{ color: MUTED }}>{sub}</div>}
    </div>
  );
}

function BudgetStat({ monthly, weekly, budget }: { monthly: number; weekly: number; budget: number | null }) {
  const usd = (n: number) => `$${(n || 0).toFixed(2)}`;
  const pct = budget && budget > 0 ? Math.min(100, Math.round((monthly / budget) * 100)) : null;
  const barColor = pct === null ? VIOLET : pct >= 90 ? RED : pct >= 70 ? AMBER : VIOLET;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: LINE, background: CARD }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        <span style={{ color: VIOLET_SOFT }}><Wallet size={15} /></span>
        Bu ay maliyet
      </div>
      <div className="mt-1 text-[20px] font-semibold" style={{ color: VIOLET_SOFT }}>{usd(monthly)}</div>
      {budget && budget > 0 ? (
        <>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
          </div>
          <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
            {usd(monthly)} / {usd(budget)} bütçe (%{pct})
          </div>
        </>
      ) : (
        <div className="text-[11px]" style={{ color: MUTED }}>Bu hafta {usd(weekly)} · limitsiz</div>
      )}
    </div>
  );
}

function IconBtn({
  title,
  color,
  onClick,
  disabled,
  children,
}: {
  title: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg border transition-colors hover:bg-white/5 disabled:opacity-40"
      style={{ borderColor: LINE, color }}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
      style={{ borderColor: LINE, color: TEXT }}
    >
      {children}
    </select>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}sn önce`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}sa önce`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}

function StatusBadge({ status }: { status: AutomationStatus }) {
  const map: Record<AutomationStatus, { c: string; label: string }> = {
    DRAFT: { c: MUTED, label: 'Taslak' },
    ACTIVE: { c: GREEN, label: 'Aktif' },
    PAUSED: { c: AMBER, label: 'Duraklatıldı' },
    ERROR: { c: RED, label: 'Hata' },
    ARCHIVED: { c: MUTED, label: 'Arşiv' },
  };
  const s = map[status];
  return (
    <span
      className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: `${s.c}1f`, color: s.c }}
    >
      {s.label}
    </span>
  );
}

function TriggerIcon({ t }: { t: AutomationTriggerType }) {
  if (t === 'CRON') return <Clock size={13} style={{ color: VIOLET_SOFT }} />;
  if (t === 'WEBHOOK') return <Webhook size={13} style={{ color: VIOLET_SOFT }} />;
  return <Sparkles size={13} style={{ color: VIOLET_SOFT }} />;
}

function triggerShort(t: AutomationTriggerType, cfg: any): string {
  if (t === 'CRON') return describeCron(cfg?.cron);
  if (t === 'EVENT') return describeEvent(cfg?.eventName);
  if (t === 'WEBHOOK') return 'Webhook';
  return 'Manuel';
}
