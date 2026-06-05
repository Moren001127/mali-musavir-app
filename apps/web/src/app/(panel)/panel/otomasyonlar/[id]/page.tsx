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
  CalendarClock,
  Bell,
  Copy,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import {
  automationsApi,
  describeCron,
  describeEvent,
  type Automation,
  type AutomationRun,
  type AutomationStatus,
} from '@/lib/automations';

// ── Otomasyon modülü imza paleti (koyu zemin, mor imza) ──
const VIOLET = '#a855f7';
const VIOLET_SOFT = '#c084fc';
const GOLD = '#d4b876';
const BG = '#0f0d0b';
const CARD = '#15110d';
const CARD2 = '#1c1712';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const GREEN = '#4ade80';
const RED = '#f87171';
const AMBER = '#fbbf24';
const BLUE = '#60a5fa';

type Tab = 'definition' | 'history' | 'logs';

const POLICY_LABEL: Record<string, string> = {
  notify: 'Hata olursa bana bildir',
  pause_after_3: '3 hatadan sonra duraklat',
  ignore: 'Hataları yok say',
};

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
    refetchInterval: 5000,
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
    onError: (err: any) =>
      toast.error(
        err?.response?.data?.message ||
          'Kalıcı silme başarısız. Sadece hiç çalışmamış DRAFT otomasyonlar tamamen silinebilir.',
      ),
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
      <div className="mx-auto max-w-4xl px-4 py-12 text-center" style={{ color: MUTED }}>
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <div className="mt-2 text-[13px]">Yükleniyor…</div>
      </div>
    );
  }

  if (error || !auto) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8" style={{ color: TEXT }}>
        <button
          onClick={() => router.push('/panel/otomasyonlar')}
          className="mb-4 inline-flex items-center gap-1 text-[13px]"
          style={{ color: MUTED }}
        >
          <ChevronLeft size={16} /> Geri
        </button>
        <div className="rounded-lg border p-4 text-[13px]" style={{ borderColor: `${RED}55`, background: `${RED}14`, color: '#fecaca' }}>
          Otomasyon yüklenemedi: {(error as any)?.message || 'Bulunamadı'}
        </div>
      </div>
    );
  }

  const stepsBlob: any = auto.steps;
  const stepList: any[] = Array.isArray(stepsBlob?.steps) ? stepsBlob.steps : [];
  const canHardDelete = auto.status === 'DRAFT' && auto.totalRuns === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16" style={{ color: TEXT }}>
      {/* ── Başlık ── */}
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
        <button
          onClick={() => router.push('/panel/otomasyonlar')}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: MUTED }}
        >
          <ChevronLeft size={14} /> Otomasyonlarım
        </button>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="grid h-9 w-9 place-items-center rounded-xl"
                style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', boxShadow: '0 6px 18px rgba(168,85,247,0.40)' }}
              >
                <Wand2 size={18} style={{ color: '#1a1410' }} />
              </span>
              <h1 className="text-[22px] font-semibold leading-tight">{auto.title}</h1>
              <StatusBadge status={auto.status} />
            </div>
            {auto.description && <p className="mt-1.5 text-[13px]" style={{ color: MUTED }}>{auto.description}</p>}
            <p className="mt-1.5 text-[12px]" style={{ color: MUTED }}>
              <span className="font-medium">Cümle:</span> "{auto.prompt}"
            </p>
          </div>

          {/* Aksiyon butonları */}
          <div className="flex flex-wrap items-center gap-1.5">
            {auto.status === 'ACTIVE' && (
              <ActionBtn color={AMBER} onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Şimdi Çalıştır
              </ActionBtn>
            )}
            {auto.status !== 'ARCHIVED' && (
              <ActionBtn color={BLUE} onClick={() => dryRun.mutate()} disabled={dryRun.isPending}>
                {dryRun.isPending ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Dry-Run
              </ActionBtn>
            )}
            {(auto.status === 'ACTIVE' || auto.status === 'PAUSED' || auto.status === 'DRAFT' || auto.status === 'ERROR') && (
              <ActionBtn
                color={auto.status === 'ACTIVE' ? AMBER : GREEN}
                onClick={() => setStatus.mutate(auto.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
              >
                {auto.status === 'ACTIVE' ? <><Pause size={14} /> Duraklat</> : <><Play size={14} /> Aktive Et</>}
              </ActionBtn>
            )}
            <ActionBtn color={MUTED} onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
              {duplicate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Çoğalt
            </ActionBtn>
            {auto.status !== 'ARCHIVED' && (
              <ActionBtn color={MUTED} onClick={() => { if (confirm(`"${auto.title}" arşivlensin mi?`)) archive.mutate(); }}>
                <Archive size={14} /> Arşivle
              </ActionBtn>
            )}
            {canHardDelete && (
              <ActionBtn color={RED} onClick={() => { if (confirm(`"${auto.title}" KALICI olarak silinsin mi?`)) hardDelete.mutate(); }}>
                <Trash2 size={14} /> Sil
              </ActionBtn>
            )}
          </div>
        </div>
      </header>

      {/* ── Özet istatistik ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat color={VIOLET_SOFT} icon={<Activity size={15} />} label="Toplam Çalışma" value={String(auto.totalRuns)} />
        <Stat color={GREEN} icon={<CheckCircle2 size={15} />} label="Başarılı" value={String(auto.successRuns)} />
        <Stat color={RED} icon={<XCircle size={15} />} label="Başarısız" value={String(auto.failureRuns)} />
        <Stat
          color={VIOLET_SOFT}
          icon={<Zap size={15} />}
          label="~ Çalışma Maliyeti"
          value={auto.estimatedCostPerRun ? `$${auto.estimatedCostPerRun.toFixed(4)}` : '$0'}
        />
      </section>

      {/* ── Sekmeler ── */}
      <div className="flex gap-1 border-b" style={{ borderColor: LINE }}>
        <TabBtn active={tab === 'definition'} onClick={() => setTab('definition')} icon={<FileText size={15} />}>Tanım</TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')} icon={<Activity size={15} />}>
          Çalışma Geçmişi ({runs?.length ?? 0})
        </TabBtn>
        <TabBtn active={tab === 'logs'} onClick={() => setTab('logs')} icon={<SettingsIcon size={15} />}>Detay Log</TabBtn>
      </div>

      {tab === 'definition' && <DefinitionTab auto={auto} stepList={stepList} />}
      {tab === 'history' && (
        <HistoryTab runs={runs ?? []} onSelect={(rid) => { setSelectedRunId(rid); setTab('logs'); }} />
      )}
      {tab === 'logs' && <LogsTab runs={runs ?? []} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />}
    </div>
  );
}

// ─── Tanım sekmesi + DÜZENLEME ───────────────────────────────
function DefinitionTab({ auto, stepList }: { auto: Automation; stepList: any[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(auto.title);
  const [description, setDescription] = useState(auto.description ?? '');
  const [failurePolicy, setFailurePolicy] = useState(auto.failurePolicy || 'notify');
  const [cron, setCron] = useState((auto.triggerConfig as any)?.cron ?? '');
  const [stepsText, setStepsText] = useState(() => JSON.stringify(auto.steps, null, 2));
  const [stepsError, setStepsError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: () => {
      let stepsParsed: any;
      try {
        stepsParsed = JSON.parse(stepsText);
      } catch {
        throw new Error('Adımlar JSON olarak geçersiz — kontrol et.');
      }
      const payload: any = { title, description, failurePolicy, steps: stepsParsed };
      if (auto.triggerType === 'CRON') {
        payload.triggerConfig = { ...(auto.triggerConfig as any), cron };
      }
      return automationsApi.update(auto.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation', auto.id] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Otomasyon güncellendi');
      setEditing(false);
      setStepsError(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Güncelleme başarısız';
      setStepsError(msg);
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-4">
      {/* Tetik + sonraki/son çalışma + politika */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info
          icon={<TriggerIcon t={auto.triggerType} />}
          label="Tetikleyici"
          value={triggerLabel(auto.triggerType, auto.triggerConfig)}
        />
        <Info
          icon={<CalendarClock size={15} style={{ color: VIOLET_SOFT }} />}
          label="Sonraki çalışma"
          value={
            auto.status === 'ACTIVE' && auto.nextRunAt
              ? new Date(auto.nextRunAt).toLocaleString('tr-TR')
              : auto.status === 'ACTIVE'
                ? 'Hesaplanıyor…'
                : 'Aktif değil'
          }
        />
        <Info
          icon={<Clock size={15} style={{ color: VIOLET_SOFT }} />}
          label="Son çalışma"
          value={
            auto.lastRunAt
              ? new Date(auto.lastRunAt).toLocaleString('tr-TR') + (auto.lastRunStatus ? ` (${auto.lastRunStatus})` : '')
              : 'Hiç çalıştırılmadı'
          }
        />
        <Info
          icon={<Bell size={15} style={{ color: VIOLET_SOFT }} />}
          label="Hata politikası"
          value={POLICY_LABEL[auto.failurePolicy] || auto.failurePolicy}
        />
      </div>

      {/* Düzenleme bloğu */}
      <div className="rounded-xl border p-4" style={{ borderColor: LINE, background: CARD }}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-medium" style={{ color: TEXT }}>Tanım</h3>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium"
              style={{ borderColor: `${VIOLET}55`, background: `${VIOLET}14`, color: VIOLET_SOFT }}
            >
              <Pencil size={13} /> Düzenle
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => update.mutate()}
                disabled={update.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
              >
                {update.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Kaydet
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setTitle(auto.title);
                  setDescription(auto.description ?? '');
                  setFailurePolicy(auto.failurePolicy || 'notify');
                  setCron((auto.triggerConfig as any)?.cron ?? '');
                  setStepsText(JSON.stringify(auto.steps, null, 2));
                  setStepsError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px]"
                style={{ borderColor: LINE, color: MUTED }}
              >
                <X size={13} /> Vazgeç
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <Field label="Başlık">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: LINE, color: TEXT }}
              />
            </Field>
            <Field label="Açıklama">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: LINE, color: TEXT }}
              />
            </Field>
            {auto.triggerType === 'CRON' && (
              <Field label={`Zamanlama (cron) — ${describeCron(cron)}`}>
                <input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 10 22 * *"
                  className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-[13px] outline-none"
                  style={{ borderColor: LINE, color: TEXT }}
                />
              </Field>
            )}
            <Field label="Hata politikası">
              <select
                value={failurePolicy}
                onChange={(e) => setFailurePolicy(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: LINE, color: TEXT }}
              >
                <option value="notify" style={{ background: BG }}>Hata olursa bana bildir</option>
                <option value="pause_after_3" style={{ background: BG }}>3 hatadan sonra duraklat</option>
                <option value="ignore" style={{ background: BG }}>Hataları yok say</option>
              </select>
            </Field>
            <Field label="Adımlar (JSON — ileri kullanım)">
              <textarea
                value={stepsText}
                onChange={(e) => setStepsText(e.target.value)}
                spellCheck={false}
                className="min-h-[220px] w-full resize-y rounded-lg border p-3 font-mono text-[11.5px] outline-none"
                style={{ borderColor: LINE, background: CARD2, color: TEXT }}
              />
            </Field>
            {stepsError && (
              <div className="rounded-lg border p-2 text-[12px]" style={{ borderColor: `${RED}55`, background: `${RED}14`, color: '#fecaca' }}>
                {stepsError}
              </div>
            )}
          </div>
        ) : (
          <ol className="space-y-2 text-[12px]">
            {stepList.length === 0 && (
              <li className="rounded-lg border p-3" style={{ borderColor: LINE, background: CARD2, color: MUTED }}>
                Bu otomasyonda hiç adım yok.
              </li>
            )}
            {stepList.map((step, i) => (
              <StepItem key={step.id ?? i} step={step} depth={0} index={i + 1} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ─── Çalışma Geçmişi ─────────────────────────────────────────
function HistoryTab({ runs, onSelect }: { runs: AutomationRun[]; onSelect: (id: string) => void }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-[13px]" style={{ borderColor: LINE, background: CARD, color: MUTED }}>
        Henüz çalışma geçmişi yok. "Şimdi Çalıştır" veya tetikleyici ateşlenince burada listelenir.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: LINE, background: CARD }}>
      <table className="w-full text-[13px]">
        <thead style={{ background: CARD2 }}>
          <tr style={{ color: MUTED }} className="text-left text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2.5 font-medium">Başlangıç</th>
            <th className="px-4 py-2.5 font-medium">Durum</th>
            <th className="px-4 py-2.5 font-medium">Süre</th>
            <th className="px-4 py-2.5 font-medium">Özet</th>
            <th className="px-4 py-2.5 text-right font-medium">Maliyet</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const ms = run.finishedAt && run.startedAt
              ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
              : null;
            return (
              <tr
                key={run.id}
                onClick={() => onSelect(run.id)}
                className="cursor-pointer border-t"
                style={{ borderColor: LINE }}
              >
                <td className="px-4 py-2.5" style={{ color: TEXT }}>{new Date(run.startedAt).toLocaleString('tr-TR')}</td>
                <td className="px-4 py-2.5"><RunStatusBadge status={run.status} /></td>
                <td className="px-4 py-2.5" style={{ color: MUTED }}>{ms !== null ? `${(ms / 1000).toFixed(1)}s` : 'devam ediyor'}</td>
                <td className="max-w-md truncate px-4 py-2.5" style={{ color: TEXT }}>{run.summary || run.errorMessage || '—'}</td>
                <td className="px-4 py-2.5 text-right" style={{ color: MUTED }}>{run.costUsd ? `$${run.costUsd.toFixed(4)}` : '$0'}</td>
                <td className="px-4 py-2.5 text-right"><ChevronRight size={15} style={{ color: MUTED }} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Log sekmesi ─────────────────────────────────────────────
function LogsTab({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: AutomationRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const run = selectedRunId ? runs.find((r) => r.id === selectedRunId) ?? runs[0] : runs[0];
  if (!run) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-[13px]" style={{ borderColor: LINE, background: CARD, color: MUTED }}>
        Henüz çalışma kaydı yok.
      </div>
    );
  }
  const stepLogs: any[] = Array.isArray(run.stepLogs) ? run.stepLogs : [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      <div className="max-h-[600px] space-y-1.5 overflow-auto">
        {runs.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className="w-full rounded-lg border p-2 text-left text-[11.5px] transition-colors"
            style={{
              borderColor: r.id === run.id ? `${VIOLET}66` : LINE,
              background: r.id === run.id ? `${VIOLET}14` : CARD,
            }}
          >
            <div className="flex items-center justify-between">
              <RunStatusBadge status={r.status} />
              <span style={{ color: MUTED }}>{new Date(r.startedAt).toLocaleString('tr-TR')}</span>
            </div>
            <div className="mt-1 truncate" style={{ color: TEXT }}>{r.summary || r.errorMessage || '—'}</div>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border p-4" style={{ borderColor: LINE, background: CARD }}>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>Çalışma</div>
              <code className="text-[12px]" style={{ color: TEXT }}>{run.id}</code>
            </div>
            <RunStatusBadge status={run.status} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            <Mini label="Başlangıç" value={new Date(run.startedAt).toLocaleString('tr-TR')} />
            <Mini label="Bitiş" value={run.finishedAt ? new Date(run.finishedAt).toLocaleString('tr-TR') : 'Devam'} />
            <Mini label="Maliyet" value={run.costUsd ? `$${run.costUsd.toFixed(4)}` : '$0'} />
            <Mini label="Adım" value={String(stepLogs.length)} />
          </div>
          {run.summary && (
            <div className="mt-3 rounded-lg p-2 text-[12px]" style={{ background: CARD2, color: TEXT }}>
              <span className="font-medium">Özet:</span> {run.summary}
            </div>
          )}
          {run.errorMessage && (
            <div className="mt-3 rounded-lg border p-2 text-[12px]" style={{ borderColor: `${RED}55`, background: `${RED}14`, color: '#fecaca' }}>
              <span className="font-medium">Hata:</span> {run.errorMessage}
            </div>
          )}
        </div>

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
    <div className="rounded-lg border" style={{ borderColor: hasError ? `${RED}55` : LINE, background: hasError ? `${RED}0f` : CARD }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
          style={{ background: hasError ? RED : VIOLET, color: '#1a1410' }}
        >
          {index}
        </span>
        <code className="font-medium" style={{ color: TEXT }}>{log.tool}</code>
        <span className="ml-auto text-[10px]" style={{ color: MUTED }}>{log.ms}ms</span>
        {hasError && <AlertTriangle size={14} style={{ color: RED }} />}
      </button>
      {open && (
        <div className="space-y-2 border-t p-3 text-[11px]" style={{ borderColor: LINE }}>
          {log.input !== undefined && (
            <details>
              <summary className="cursor-pointer" style={{ color: MUTED }}>input</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded p-2" style={{ background: CARD2, color: TEXT }}>{JSON.stringify(log.input, null, 2)}</pre>
            </details>
          )}
          {log.output !== undefined && (
            <details>
              <summary className="cursor-pointer" style={{ color: MUTED }}>output</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded p-2" style={{ background: CARD2, color: TEXT }}>{JSON.stringify(log.output, null, 2)}</pre>
            </details>
          )}
          {log.error && (
            <div className="rounded p-2" style={{ background: `${RED}14`, color: '#fecaca' }}>
              <span className="font-medium">Hata:</span> {log.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Yardımcı bileşenler ─────────────────────────────────────
function ActionBtn({
  color,
  onClick,
  disabled,
  children,
}: {
  color: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
      style={{ borderColor: `${color}44`, background: `${color}12`, color }}
    >
      {children}
    </button>
  );
}

function Stat({ color, icon, label, value }: { color: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: LINE, background: CARD }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold" style={{ color: TEXT }}>{value}</div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: LINE, background: CARD }}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[13px]" style={{ color: TEXT }}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: MUTED }}>{label}</div>
      <div style={{ color: TEXT }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function TabBtn({
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
      className="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors"
      style={{
        borderColor: active ? VIOLET : 'transparent',
        color: active ? TEXT : MUTED,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function StepItem({ step, depth, index }: { step: any; depth: number; index: number }) {
  const isFlow = ['for_each', 'branch_if', 'parallel', 'wait', 'format_list'].includes(step.tool);
  return (
    <li className="rounded-lg border p-3" style={{ borderColor: LINE, background: CARD2, marginLeft: depth * 14 }}>
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
          style={{ background: isFlow ? '#64748b' : VIOLET, color: '#1a1410' }}
        >
          {index}
        </span>
        <div className="flex-1">
          <code className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: '#0b0907', color: VIOLET_SOFT }}>
            {step.tool}
          </code>
          {step.outputAs && (
            <span className="ml-2 text-[11px]" style={{ color: MUTED }}>
              → <code style={{ color: TEXT }}>{step.outputAs}</code>
            </span>
          )}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]" style={{ color: MUTED }}>
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
          <div className="text-[10px] uppercase" style={{ color: MUTED }}>then:</div>
          <ol className="space-y-1">
            {step.then.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
      {Array.isArray(step.else) && step.else.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: MUTED }}>else:</div>
          <ol className="space-y-1">
            {step.else.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
    </li>
  );
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
    <span className="inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: `${s.c}1f`, color: s.c }}>
      {s.label}
    </span>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; label: string }> = {
    running: { c: BLUE, label: 'Çalışıyor' },
    success: { c: GREEN, label: 'Başarılı' },
    failure: { c: RED, label: 'Başarısız' },
    partial: { c: AMBER, label: 'Kısmi' },
  };
  const s = map[status] || { c: MUTED, label: status };
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: `${s.c}1f`, color: s.c }}>
      {s.label}
    </span>
  );
}

function TriggerIcon({ t }: { t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL' }) {
  if (t === 'CRON') return <Clock size={15} style={{ color: VIOLET_SOFT }} />;
  if (t === 'WEBHOOK') return <Webhook size={15} style={{ color: VIOLET_SOFT }} />;
  return <Sparkles size={15} style={{ color: VIOLET_SOFT }} />;
}

function triggerLabel(type: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL', cfg: any): string {
  if (type === 'CRON' && typeof cfg?.cron === 'string') {
    const tz = cfg?.timezone ? ` · ${cfg.timezone}` : '';
    return `${describeCron(cfg.cron)} (${cfg.cron})${tz}`;
  }
  if (type === 'EVENT' && typeof cfg?.eventName === 'string') return describeEvent(cfg.eventName);
  if (type === 'WEBHOOK') return 'Webhook';
  return 'Manuel';
}
