'use client';

import React, { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft,
  Wand2,
  Clock,
  Webhook,
  Sparkles,
  Pause,
  Play,
  Archive,
  Trash2,
  Zap,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Activity,
  FileText,
  Settings as SettingsIcon,
  ShieldAlert,
  Copy,
} from 'lucide-react';
import { automationsApi, type Automation, type AutomationRun, type AutomationStatus } from '@/lib/automations';

const GOLD = '#d4b876';

type Tab = 'definition' | 'history' | 'logs';

export default function OtomasyonDetayPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('definition');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: auto, isLoading, error } = useQuery({
    queryKey: ['automation', id],
    queryFn: () => automationsApi.getOne(id),
    refetchInterval: 5000, // çalışan otomasyonlar için sürekli güncelle
  });

  const { data: runs } = useQuery({
    queryKey: ['automation-runs', id],
    queryFn: () => automationsApi.listRuns(id, 50),
    refetchInterval: 5000,
    enabled: !!auto,
  });

  const setStatus = useMutation({
    mutationFn: (status: AutomationStatus) => automationsApi.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation', id] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Durum güncellendi');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Hata'),
  });

  const archive = useMutation({
    mutationFn: () => automationsApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Arşivlendi');
      router.push('/panel/otomasyonlar');
    },
  });

  const hardDelete = useMutation({
    mutationFn: () => automationsApi.hardDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Kalıcı olarak silindi');
      router.push('/panel/otomasyonlar');
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.message ||
          'Kalıcı silme başarısız. Sadece hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir.',
      );
    },
  });

  const runNow = useMutation({
    mutationFn: () => automationsApi.runNow(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automation', id] });
      qc.invalidateQueries({ queryKey: ['automation-runs', id] });
      if (result.status === 'running') {
        toast.info(result.summary || 'Çalışma kuyruğa alındı');
        return;
      }
      const icon = result.status === 'success' ? '✓' : result.status === 'failure' ? '✗' : '⚠';
      toast.success(`${icon} ${result.summary || 'Çalışma tamamlandı'}`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Çalıştırma başarısız'),
  });

  const dryRun = useMutation({
    mutationFn: () => automationsApi.dryRun(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automation-runs', id] });
      toast.info(`Dry-run: ${result.summary || 'Simüle edildi'}`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Dry-run başarısız'),
  });

  const duplicate = useMutation({
    mutationFn: () => automationsApi.duplicate(id),
    onSuccess: (newAuto) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success(`"${newAuto.title}" oluşturuldu (DRAFT)`);
      router.push(`/panel/otomasyonlar/${newAuto.id}`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Çoğaltma başarısız'),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center text-stone-500 dark:text-stone-400">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <div className="mt-2 text-sm">Yükleniyor…</div>
      </div>
    );
  }

  if (error || !auto) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <button
          onClick={() => router.push('/panel/otomasyonlar')}
          className="mb-4 inline-flex items-center gap-1 text-sm text-stone-600 dark:text-stone-300 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> Geri
        </button>
        <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-200">
          Otomasyon yüklenemedi: {(error as any)?.message || 'Bulunamadı'}
        </div>
      </div>
    );
  }

  const stepsBlob: any = auto.steps;
  const stepList: any[] = Array.isArray(stepsBlob?.steps) ? stepsBlob.steps : [];

  const canHardDelete = auto.status === 'DRAFT' && auto.totalRuns === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Üst başlık */}
      <div className="mb-2">
        <button
          onClick={() => router.push('/panel/otomasyonlar')}
          className="inline-flex items-center gap-1 text-sm text-stone-600 dark:text-stone-300 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> Otomasyonlarım
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Wand2 className="h-6 w-6" style={{ color: GOLD }} />
            <h1 className="text-2xl font-serif text-stone-800 dark:text-stone-100">{auto.title}</h1>
            <StatusBadge status={auto.status} />
          </div>
          {auto.description && (
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{auto.description}</p>
          )}
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            <span className="font-medium">Orijinal cümle:</span> "{auto.prompt}"
          </p>
        </div>

        {/* Aksiyon butonları */}
        <div className="flex flex-wrap items-center gap-2">
          {auto.status === 'ACTIVE' && (
            <>
              <button
                onClick={() => runNow.mutate()}
                disabled={runNow.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
              >
                {runNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Şimdi Çalıştır
              </button>
              <button
                onClick={() => dryRun.mutate()}
                disabled={dryRun.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                {dryRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                Dry-Run
              </button>
            </>
          )}
          {auto.status !== 'ACTIVE' && auto.status !== 'ARCHIVED' && (
            <button
              onClick={() => dryRun.mutate()}
              disabled={dryRun.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              {dryRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Dry-Run
            </button>
          )}
          {(auto.status === 'ACTIVE' || auto.status === 'PAUSED' || auto.status === 'DRAFT' || auto.status === 'ERROR') && (
            <button
              onClick={() =>
                setStatus.mutate(auto.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')
              }
              className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              {auto.status === 'ACTIVE' ? (
                <>
                  <Pause className="h-4 w-4" /> Duraklat
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Aktive Et
                </>
              )}
            </button>
          )}
          <button
            onClick={() => duplicate.mutate()}
            disabled={duplicate.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50"
            title="Bu otomasyonu kopyalayıp yeni bir DRAFT oluştur"
          >
            {duplicate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Çoğalt
          </button>
          {auto.status !== 'ARCHIVED' && (
            <button
              onClick={() => {
                if (confirm(`"${auto.title}" arşivlensin mi?`)) archive.mutate();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              <Archive className="h-4 w-4" /> Arşivle
            </button>
          )}
          {canHardDelete && (
            <button
              onClick={() => {
                if (confirm(`"${auto.title}" KALICI olarak silinsin mi?`)) hardDelete.mutate();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-700 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950"
            >
              <Trash2 className="h-4 w-4" /> Sil
            </button>
          )}
        </div>
      </div>

      {/* Özet istatistik */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Activity className="h-4 w-4" />} label="Toplam Çalışma" value={String(auto.totalRuns)} />
        <Stat
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Başarılı"
          value={String(auto.successRuns)}
        />
        <Stat
          icon={<XCircle className="h-4 w-4 text-rose-500" />}
          label="Başarısız"
          value={String(auto.failureRuns)}
        />
        <Stat
          icon={<Zap className="h-4 w-4" style={{ color: GOLD }} />}
          label="~ Run Maliyet"
          value={
            auto.estimatedCostPerRun ? `$${auto.estimatedCostPerRun.toFixed(4)}` : '$0'
          }
        />
      </div>

      {/* Sekme başlıkları */}
      <div className="mb-4 flex gap-1 border-b border-stone-200 dark:border-stone-700">
        <TabButton active={tab === 'definition'} onClick={() => setTab('definition')} icon={<FileText className="h-4 w-4" />}>
          Tanım
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<Activity className="h-4 w-4" />}>
          Çalışma Geçmişi ({runs?.length ?? 0})
        </TabButton>
        <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<SettingsIcon className="h-4 w-4" />}>
          Detay Log
        </TabButton>
      </div>

      {/* Sekme içerikleri */}
      {tab === 'definition' && (
        <DefinitionTab auto={auto} stepList={stepList} />
      )}
      {tab === 'history' && (
        <HistoryTab runs={runs ?? []} onSelect={(rid) => { setSelectedRunId(rid); setTab('logs'); }} />
      )}
      {tab === 'logs' && (
        <LogsTab
          runs={runs ?? []}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
      )}
    </div>
  );
}

// ─── Tanım sekmesi ───────────────────────────────────────────

function DefinitionTab({ auto, stepList }: { auto: Automation; stepList: any[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InfoCard
          icon={<TriggerIcon t={auto.triggerType} />}
          label="Tetikleyici"
          value={triggerLabel(auto.triggerType, auto.triggerConfig)}
        />
        <InfoCard
          icon={<Clock className="h-4 w-4" style={{ color: GOLD }} />}
          label="Son Çalışma"
          value={
            auto.lastRunAt
              ? new Date(auto.lastRunAt).toLocaleString('tr-TR') +
                (auto.lastRunStatus ? ` (${auto.lastRunStatus})` : '')
              : 'Hiç çalıştırılmadı'
          }
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-200">Adımlar</h3>
        <ol className="space-y-2 text-xs">
          {stepList.length === 0 && (
            <li className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3 text-stone-500 dark:text-stone-400">
              Bu otomasyonda hiç adım yok.
            </li>
          )}
          {stepList.map((step, i) => (
            <StepItem key={step.id ?? i} step={step} depth={0} index={i + 1} />
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── Çalışma Geçmişi sekmesi ──────────────────────────────────

function HistoryTab({ runs, onSelect }: { runs: AutomationRun[]; onSelect: (id: string) => void }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-8 text-center text-sm text-stone-500 dark:text-stone-400">
        Henüz çalışma geçmişi yok. "Şimdi Çalıştır" veya tetikleyici ateşlemesi olunca burada listelenir.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 dark:bg-stone-800 text-left text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
          <tr>
            <th className="px-4 py-2 font-medium">Başlangıç</th>
            <th className="px-4 py-2 font-medium">Durum</th>
            <th className="px-4 py-2 font-medium">Süre</th>
            <th className="px-4 py-2 font-medium">Özet</th>
            <th className="px-4 py-2 font-medium text-right">Maliyet</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {runs.map((run) => {
            const ms =
              run.finishedAt && run.startedAt
                ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
                : null;
            return (
              <tr
                key={run.id}
                className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800"
                onClick={() => onSelect(run.id)}
              >
                <td className="px-4 py-2 text-stone-700 dark:text-stone-200">
                  {new Date(run.startedAt).toLocaleString('tr-TR')}
                </td>
                <td className="px-4 py-2">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-4 py-2 text-stone-600 dark:text-stone-300">
                  {ms !== null ? `${(ms / 1000).toFixed(1)}s` : 'devam ediyor'}
                </td>
                <td className="px-4 py-2 text-stone-700 dark:text-stone-200 max-w-md truncate">
                  {run.summary || run.errorMessage || '—'}
                </td>
                <td className="px-4 py-2 text-right text-stone-600 dark:text-stone-300">
                  {run.costUsd ? `$${run.costUsd.toFixed(4)}` : '$0'}
                </td>
                <td className="px-4 py-2 text-right">
                  <ChevronRight className="h-4 w-4 text-stone-400 dark:text-stone-500" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Log sekmesi (run detay) ──────────────────────────────────

function LogsTab({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: AutomationRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const run = selectedRunId
    ? runs.find((r) => r.id === selectedRunId) ?? runs[0]
    : runs[0];

  if (!run) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-8 text-center text-sm text-stone-500 dark:text-stone-400">
        Henüz çalışma kaydı yok.
      </div>
    );
  }

  const stepLogs: any[] = Array.isArray(run.stepLogs) ? run.stepLogs : [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      {/* Sol: run listesi (özet) */}
      <div className="space-y-1 max-h-[600px] overflow-auto">
        {runs.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`w-full rounded-lg border p-2 text-left text-xs transition ${
              r.id === run.id
                ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700'
                : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <RunStatusBadge status={r.status} />
              <span className="text-[10px] text-stone-500 dark:text-stone-400">
                {new Date(r.startedAt).toLocaleString('tr-TR')}
              </span>
            </div>
            <div className="mt-1 truncate text-stone-700 dark:text-stone-200">
              {r.summary || r.errorMessage || '—'}
            </div>
          </button>
        ))}
      </div>

      {/* Sağ: seçili run'ın detayı */}
      <div className="space-y-3">
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">Run</div>
              <code className="text-xs text-stone-700 dark:text-stone-200">{run.id}</code>
            </div>
            <RunStatusBadge status={run.status} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-stone-500 dark:text-stone-400">Başlangıç</div>
              <div className="text-stone-700 dark:text-stone-200">
                {new Date(run.startedAt).toLocaleString('tr-TR')}
              </div>
            </div>
            <div>
              <div className="text-stone-500 dark:text-stone-400">Bitiş</div>
              <div className="text-stone-700 dark:text-stone-200">
                {run.finishedAt ? new Date(run.finishedAt).toLocaleString('tr-TR') : 'Devam'}
              </div>
            </div>
            <div>
              <div className="text-stone-500 dark:text-stone-400">Maliyet</div>
              <div className="text-stone-700 dark:text-stone-200">
                {run.costUsd ? `$${run.costUsd.toFixed(4)}` : '$0'}
              </div>
            </div>
            <div>
              <div className="text-stone-500 dark:text-stone-400">Adım</div>
              <div className="text-stone-700 dark:text-stone-200">{stepLogs.length}</div>
            </div>
          </div>
          {run.summary && (
            <div className="mt-3 rounded-md bg-stone-50 dark:bg-stone-800 p-2 text-xs text-stone-700 dark:text-stone-200">
              <span className="font-medium">Özet:</span> {run.summary}
            </div>
          )}
          {run.errorMessage && (
            <div className="mt-3 rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-2 text-xs text-rose-800 dark:text-rose-200">
              <span className="font-medium">Hata:</span> {run.errorMessage}
            </div>
          )}
        </div>

        {/* Adım adım log */}
        <div className="space-y-2">
          {stepLogs.map((sl, i) => (
            <StepLogEntry key={i} log={sl} index={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepLogEntry({ log, index }: { log: any; index: number }) {
  const [open, setOpen] = useState(!!log.error);
  const hasError = !!log.error;
  return (
    <div
      className={`rounded-lg border ${
        hasError
          ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20'
          : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-stone-800"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: hasError ? '#dc2626' : GOLD }}
        >
          {index}
        </span>
        <code className="font-medium text-stone-700 dark:text-stone-200">{log.tool}</code>
        <span className="ml-auto text-[10px] text-stone-500 dark:text-stone-400">
          {log.ms}ms
        </span>
        {hasError && (
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-stone-200 dark:border-stone-700 p-3 text-[11px] space-y-2">
          {log.input !== undefined && (
            <details>
              <summary className="cursor-pointer text-stone-500 dark:text-stone-400">
                input
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-stone-50 dark:bg-stone-800 p-2 text-stone-700 dark:text-stone-200">
                {JSON.stringify(log.input, null, 2)}
              </pre>
            </details>
          )}
          {log.output !== undefined && (
            <details>
              <summary className="cursor-pointer text-stone-500 dark:text-stone-400">
                output
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-stone-50 dark:bg-stone-800 p-2 text-stone-700 dark:text-stone-200">
                {JSON.stringify(log.output, null, 2)}
              </pre>
            </details>
          )}
          {log.error && (
            <div className="rounded bg-rose-50 dark:bg-rose-950/30 p-2 text-rose-800 dark:text-rose-200">
              <span className="font-medium">Hata:</span> {log.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Yardımcı bileşenler ──────────────────────────────────────

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-medium text-stone-800 dark:text-stone-100">{value}</div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-stone-800 dark:text-stone-100">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? 'border-amber-400 text-stone-800 dark:text-stone-100'
          : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function StepItem({ step, depth, index }: { step: any; depth: number; index: number }) {
  const isFlow = ['for_each', 'branch_if', 'parallel', 'wait', 'format_list'].includes(step.tool);
  return (
    <li
      className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: isFlow ? '#94a3b8' : GOLD }}
        >
          {index}
        </span>
        <div className="flex-1">
          <code className="rounded bg-white dark:bg-stone-900 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-200">
            {step.tool}
          </code>
          {step.outputAs && (
            <span className="ml-2 text-[11px] text-stone-500 dark:text-stone-400">
              → <code className="text-stone-700 dark:text-stone-200">{step.outputAs}</code>
            </span>
          )}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-stone-600 dark:text-stone-300">
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </div>
      </div>
      {Array.isArray(step.steps) && step.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {step.steps.map((s: any, i: number) => (
            <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
          ))}
        </ol>
      )}
      {Array.isArray(step.then) && step.then.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase text-stone-500 dark:text-stone-400">then:</div>
          <ol className="space-y-1">
            {step.then.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: AutomationStatus }) {
  const styles: Record<AutomationStatus, string> = {
    DRAFT: 'bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
    ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    PAUSED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    ERROR: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    ARCHIVED: 'bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
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

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    running: { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', label: 'Çalışıyor' },
    success: { color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'Başarılı' },
    failure: { color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300', label: 'Başarısız' },
    partial: { color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: 'Kısmi' },
  };
  const s = map[status] || { color: 'bg-stone-100 text-stone-700', label: status };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}

function TriggerIcon({ t }: { t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL' }) {
  if (t === 'CRON') return <Clock className="h-4 w-4" style={{ color: GOLD }} />;
  if (t === 'WEBHOOK') return <Webhook className="h-4 w-4" style={{ color: GOLD }} />;
  return <Sparkles className="h-4 w-4" style={{ color: GOLD }} />;
}

function triggerLabel(
  type: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL',
  cfg: any,
): string {
  if (type === 'CRON' && typeof cfg?.cron === 'string') {
    const tz = cfg?.timezone ? ` (${cfg.timezone})` : '';
    return `Zamanlı: ${cfg.cron}${tz}`;
  }
  if (type === 'EVENT' && typeof cfg?.eventName === 'string') return `Olay: ${cfg.eventName}`;
  if (type === 'WEBHOOK') return 'Webhook';
  return 'Manuel';
}
