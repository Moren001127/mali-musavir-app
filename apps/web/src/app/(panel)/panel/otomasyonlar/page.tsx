'use client';

import React, { useState, useMemo } from 'react';
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
  DollarSign,
} from 'lucide-react';
import {
  automationsApi,
  type Automation,
  type AutomationStatus,
  type AutomationTriggerType,
} from '@/lib/automations';

const GOLD = '#d4b876';

/**
 * Otomasyonlarım — minimal liste sayfası (Faz 2 sonu için yeterli).
 *
 * Faz 4'te genişletilecek:
 *  - Sayfalama UI
 *  - Filtre/arama kutusu
 *  - Detay paneli
 *  - Çalışma geçmişi sekmesi
 */
export default function OtomasyonlarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationStatus | 'all'>('all');
  const [triggerFilter, setTriggerFilter] = useState<AutomationTriggerType | 'all'>('all');

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
      const icon =
        result.status === 'success' ? '✓' : result.status === 'failure' ? '✗' : '⚠';
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Başlık */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6" style={{ color: GOLD }} />
          <h1 className="text-2xl font-serif text-stone-800 dark:text-stone-100">Otomasyonlarım</h1>
        </div>
        <Link
          href="/panel/otomasyonlar/yeni"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm"
          style={{ backgroundColor: GOLD }}
        >
          <Plus className="h-4 w-4" />
          Yeni Otomasyon
        </Link>
      </div>

      <p className="mb-6 text-sm text-stone-600 dark:text-stone-300">
        Türkçe cümleyle kurduğun otomasyonların listesi. Arka planda otomatik çalışır,
        durumlarını ve geçmişlerini buradan takip edersin.
      </p>

      {/* Özet bandı */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat
            icon={<Activity className="h-4 w-4 text-emerald-500" />}
            label="Aktif"
            value={summary.active}
            subtitle={`${summary.paused} duraklatıldı`}
          />
          <SummaryStat
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            label="Bu Hafta Başarılı"
            value={summary.weeklySuccess}
            subtitle={`${summary.weeklyTotal} toplam çalışma`}
          />
          <SummaryStat
            icon={<XCircle className="h-4 w-4 text-rose-500" />}
            label="Bu Hafta Hata"
            value={summary.weeklyFailure}
            subtitle={
              summary.error > 0 ? `${summary.error} otomasyon ERROR durumda` : 'Sistem sağlıklı'
            }
          />
          <SummaryStat
            icon={<DollarSign className="h-4 w-4" style={{ color: GOLD }} />}
            label="Bu Hafta Maliyet"
            value={`$${weeklyCostUsd.toFixed(2)}`}
            subtitle="Anthropic API kullanımı"
          />
        </div>
      )}

      {/* Arama ve filtreler */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
          <input
            type="text"
            placeholder="Otomasyonlarda ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400"
        >
          <option value="all">Tüm Durumlar</option>
          <option value="ACTIVE">Aktif</option>
          <option value="PAUSED">Duraklatıldı</option>
          <option value="DRAFT">Taslak</option>
          <option value="ERROR">Hata</option>
          <option value="ARCHIVED">Arşiv</option>
        </select>
        <select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as any)}
          className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400"
        >
          <option value="all">Tüm Tetikleyiciler</option>
          <option value="CRON">Zamanlı</option>
          <option value="EVENT">Olay</option>
          <option value="MANUAL">Manuel</option>
        </select>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-12 text-center text-sm text-stone-500 dark:text-stone-400 dark:text-stone-500">
          Yükleniyor…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Liste yüklenemedi: {(error as any)?.message}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-12 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 text-stone-400 dark:text-stone-500" />
          <h3 className="text-lg font-medium text-stone-700 dark:text-stone-200">Henüz otomasyonun yok</h3>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400 dark:text-stone-500">
            "Yeni Otomasyon" diyerek bir cümleyle ilk otomasyonunu kurabilirsin.
          </p>
          <Link
            href="/panel/otomasyonlar/yeni"
            className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm"
            style={{ backgroundColor: GOLD }}
          >
            <Plus className="h-4 w-4" />
            İlkini Oluştur
          </Link>
        </div>
      )}

      {/* Son çalışmalar widget'i */}
      {recentRuns && recentRuns.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Son Çalışmalar
          </h2>
          <div className="flex flex-wrap gap-2">
            {recentRuns.slice(0, 8).map((run) => (
              <button
                key={run.id}
                onClick={() => router.push(`/panel/otomasyonlar/${run.automation.id}`)}
                className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                  run.status === 'success'
                    ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                    : run.status === 'failure'
                      ? 'border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30'
                      : 'border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700'
                }`}
              >
                {run.status === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : run.status === 'failure' ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <Activity className="h-3.5 w-3.5" />
                )}
                <span className="font-medium">{run.automation.title}</span>
                <span className="opacity-70">
                  {timeAgo(run.startedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-800 text-left text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 dark:text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Ad</th>
                <th className="px-4 py-3 font-medium">Tetik</th>
                <th className="px-4 py-3 font-medium">Son Çalışma</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium text-right">Run</th>
                <th className="px-4 py-3 font-medium text-right">Eylem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.items.map((auto) => (
                <Row
                  key={auto.id}
                  auto={auto}
                  onOpen={(id) => router.push(`/panel/otomasyonlar/${id}`)}
                  onToggleActive={(id, current) =>
                    statusMutation.mutate({
                      id,
                      status: current === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                    })
                  }
                  onArchive={(id) => archiveMutation.mutate(id)}
                  onHardDelete={(id) => hardDeleteMutation.mutate(id)}
                  onRunNow={(id) => runNowMutation.mutate(id)}
                  onDryRun={(id) => dryRunMutation.mutate(id)}
                  runNowPending={runNowMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
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
  // Hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir (denetim izi yok)
  const canHardDelete = auto.status === 'DRAFT' && auto.totalRuns === 0;
  // Buton içinde tıklananlar satırın açılmasını engellemeli
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const lastRunStatus = auto.lastRunStatus;
  return (
    <tr
      className="cursor-pointer text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800"
      onClick={() => onOpen(auto.id)}
    >
      <td className="px-4 py-3">
        <div className="font-medium">{auto.title}</div>
        <div className="line-clamp-1 max-w-md text-xs text-stone-500 dark:text-stone-400 dark:text-stone-500">{auto.prompt}</div>
      </td>
      <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
        <span className="inline-flex items-center gap-1">
          <TriggerIcon t={auto.triggerType} />
          {triggerShort(auto.triggerType, auto.triggerConfig)}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-stone-600 dark:text-stone-300">
        {auto.lastRunAt ? (
          <span className="inline-flex items-center gap-1">
            {lastRunStatus === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : lastRunStatus === 'failure' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
            ) : null}
            {new Date(auto.lastRunAt).toLocaleString('tr-TR')}
          </span>
        ) : (
          <span className="text-stone-400 dark:text-stone-500">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={auto.status} />
      </td>
      <td className="px-4 py-3 text-right text-xs text-stone-600 dark:text-stone-300">
        {auto.totalRuns} <span className="text-stone-400 dark:text-stone-500">/ {auto.successRuns} başarı</span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {auto.status === 'ACTIVE' && (
            <>
              <button
                onClick={(e) => { stop(e); onRunNow(auto.id); }}
                disabled={runNowPending}
                className="rounded-md border border-amber-300 bg-amber-50 p-1.5 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                title="Şimdi Çalıştır (gerçek aksiyon)"
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { stop(e); onDryRun(auto.id); }}
                className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
                title="Dry-Run (aksiyon yapmadan simüle et)"
              >
                <FlaskConical className="h-4 w-4" />
              </button>
            </>
          )}
          {auto.status !== 'ACTIVE' && auto.status !== 'ARCHIVED' && (
            <button
              onClick={(e) => { stop(e); onDryRun(auto.id); }}
              className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
              title="Dry-Run (aksiyon yapmadan simüle et)"
            >
              <FlaskConical className="h-4 w-4" />
            </button>
          )}
          {(auto.status === 'ACTIVE' || auto.status === 'PAUSED' || auto.status === 'DRAFT' || auto.status === 'ERROR') && (
            <button
              onClick={(e) => { stop(e); onToggleActive(auto.id, auto.status); }}
              className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
              title={auto.status === 'ACTIVE' ? 'Duraklat' : 'Aktive et'}
            >
              {auto.status === 'ACTIVE' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
          )}
          {auto.status !== 'ARCHIVED' && (
            <button
              onClick={(e) => {
                stop(e);
                if (confirm(`"${auto.title}" arşivlensin mi?`)) onArchive(auto.id);
              }}
              className="rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-1.5 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
              title="Arşivle (çalışma geçmişi korunur)"
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
          {canHardDelete && (
            <button
              onClick={(e) => {
                stop(e);
                if (
                  confirm(
                    `"${auto.title}" KALICI olarak silinsin mi?\n\nBu işlem geri alınamaz.`,
                  )
                ) {
                  onHardDelete(auto.id);
                }
              }}
              className="rounded-md border border-rose-300 dark:border-rose-700 bg-white dark:bg-stone-900 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950"
              title="Kalıcı sil (sadece hiç çalışmamış taslaklar için)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-medium text-stone-800 dark:text-stone-100">{value}</div>
      {subtitle && (
        <div className="text-[11px] text-stone-500 dark:text-stone-400">{subtitle}</div>
      )}
    </div>
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
  const styles: Record<AutomationStatus, string> = {
    DRAFT: 'bg-stone-100 text-stone-700 dark:text-stone-200',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    PAUSED: 'bg-amber-100 text-amber-800',
    ERROR: 'bg-rose-100 text-rose-800',
    ARCHIVED: 'bg-stone-200 text-stone-500 dark:text-stone-400 dark:text-stone-500',
  };
  const labels: Record<AutomationStatus, string> = {
    DRAFT: 'Taslak',
    ACTIVE: 'Aktif',
    PAUSED: 'Duraklatıldı',
    ERROR: 'Hata',
    ARCHIVED: 'Arşivlendi',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function TriggerIcon({ t }: { t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL' }) {
  if (t === 'CRON') return <Clock className="h-3.5 w-3.5" />;
  if (t === 'WEBHOOK') return <Webhook className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function triggerShort(t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL', cfg: any): string {
  if (t === 'CRON') return cfg?.cron || 'Zamanlı';
  if (t === 'EVENT') return cfg?.eventName || 'Olay';
  if (t === 'WEBHOOK') return 'Webhook';
  return 'Manuel';
}
