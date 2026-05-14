'use client';

/**
 * Global Luca Ajanı durum panel'i — sidebar'da yer alır, her sayfada görünür.
 *
 * Kullanıcı bir mükellefe fatura/mizan/kdv çekmesi tetikledikten sonra başka
 * menüye geçerse, log akışını kaybediyordu. Bu panel global olarak agent'ın
 * o anki kuyruğunu (pending+running) ve son log satırını gösterir; tıklayınca
 * ayrıntılı dropdown açılır, oradan job iptal edilebilir.
 *
 * Polling: /luca/jobs (mevcut endpoint) — 5 sn'de bir.
 * Veri kalıcılığı: Job log'ları zaten DB'de (LucaFetchJob.errorMsg, son 20 satır)
 * — sayfaya geri gelince otomatik yüklenir.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Bot, X, ChevronDown, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';

type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

interface LucaJob {
  id: string;
  tip: string;
  status: JobStatus;
  mukellefId: string;
  donem?: string | null;
  errorMsg?: string | null;
  recordCount?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

const TIP_LABEL: Record<string, string> = {
  MIZAN: 'Mizan',
  KDV_MIZAN: 'KDV Mizan',
  KDV_191: 'KDV İnd.',
  KDV_391: 'KDV Hes.',
  ISLETME_GELIR: 'İşl. Gelir',
  ISLETME_GIDER: 'İşl. Gider',
  IHO_FETCH: 'İşl. Hesap Özeti',
  EARSIV_SATIS: 'E-Arşiv Satış',
  EARSIV_ALIS: 'E-Arşiv Alış',
  EFATURA_SATIS: 'E-Fatura Satış',
  EFATURA_ALIS: 'E-Fatura Alış',
  ACCOUNT_PLAN: 'Hesap Planı',
};

const TIP_COLOR: Record<string, string> = {
  MIZAN: '#3b82f6',
  KDV_MIZAN: '#06b6d4',
  KDV_191: '#10b981',
  KDV_391: '#2563eb',
  ISLETME_GELIR: '#ea580c',
  ISLETME_GIDER: '#a855f7',
  IHO_FETCH: '#8b5cf6',
  EARSIV_SATIS: '#f59e0b',
  EARSIV_ALIS: '#ec4899',
  EFATURA_SATIS: '#84cc16',
  EFATURA_ALIS: '#06b6d4',
  ACCOUNT_PLAN: '#64748b',
};

function taxpayerName(t?: Taxpayer): string {
  if (!t) return '—';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

function lastLogLine(errorMsg?: string | null): string {
  if (!errorMsg) return 'Henüz log yok';
  const lines = String(errorMsg).split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : 'Henüz log yok';
}

function timeSince(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}sn`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}dk`;
  const h = Math.floor(min / 60);
  return `${h}sa`;
}

export default function LucaAgentPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const { data: jobs = [] } = useQuery<LucaJob[]>({
    queryKey: ['luca-agent-jobs'],
    queryFn: () => api.get('/luca/jobs').then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 60_000,
  });

  const taxpayerById = useMemo(() => {
    const m = new Map<string, Taxpayer>();
    for (const t of taxpayers) m.set(t.id, t);
    return m;
  }, [taxpayers]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'pending' || j.status === 'running'),
    [jobs],
  );
  const runningCount = activeJobs.filter((j) => j.status === 'running').length;
  const pendingCount = activeJobs.filter((j) => j.status === 'pending').length;

  // Dış tıklamada panel kapansın
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const cancelMut = useMutation({
    mutationFn: (jobId: string) => api.post(`/luca/jobs/${jobId}/cancel`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['luca-agent-jobs'] });
      toast.success('İş iptal edildi');
    },
    onError: () => toast.error('İptal başarısız'),
  });

  const isIdle = activeJobs.length === 0;
  const statusColor = isIdle ? '#22c55e' : runningCount > 0 ? '#f59e0b' : '#64748b';
  const statusLabel = isIdle
    ? 'Boşta'
    : `${runningCount} çalışıyor${pendingCount > 0 ? ` · ${pendingCount} sırada` : ''}`;

  return (
    <div ref={panelRef} className="relative px-2 pt-3 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all hover:brightness-110"
        style={{
          background: isIdle ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${isIdle ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.25)'}`,
        }}
        title="Luca ajanı durum panel'i"
      >
        <div className="relative">
          <Bot size={14} style={{ color: statusColor }} />
          {!isIdle && (
            <div
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse"
              style={{ background: statusColor }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)', letterSpacing: '0.12em' }}>
            Luca Ajanı
          </p>
          <p className="text-[11.5px] font-semibold truncate" style={{ color: statusColor }}>
            {statusLabel}
          </p>
        </div>
        <ChevronDown
          size={12}
          style={{
            color: 'rgba(250,250,249,0.5)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute left-2 right-2 mt-1.5 rounded-xl shadow-2xl overflow-hidden z-50"
          style={{
            background: 'rgba(15,13,11,0.98)',
            border: '1px solid rgba(212,184,118,0.18)',
            backdropFilter: 'blur(10px)',
            maxHeight: 520,
          }}
        >
          <div
            className="px-3 py-2.5 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(212,184,118,0.04)' }}
          >
            <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: GOLD, letterSpacing: '0.14em' }}>
              Aktif Luca İşleri
            </p>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/10 transition" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <X size={12} />
            </button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 460 }}>
            {activeJobs.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <CheckCircle2 size={20} className="mx-auto mb-1.5" style={{ color: '#22c55e' }} />
                <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                  Luca ajanı şu an boşta
                </p>
                <p className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.32)' }}>
                  Yeni iş tetiklendiğinde burada görünür
                </p>
              </div>
            ) : (
              activeJobs.map((job) => {
                const tp = taxpayerById.get(job.mukellefId);
                const tipColor = TIP_COLOR[job.tip] || '#64748b';
                const tipLabel = TIP_LABEL[job.tip] || job.tip;
                const isRunning = job.status === 'running';
                const refTime = job.startedAt || job.createdAt;

                return (
                  <div
                    key={job.id}
                    className="px-3 py-2.5 transition-colors hover:bg-white/[0.025]"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {isRunning ? (
                        <Loader2 size={11} className="animate-spin shrink-0" style={{ color: '#f59e0b' }} />
                      ) : (
                        <AlertCircle size={11} className="shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }} />
                      )}
                      <span
                        className="text-[9.5px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide"
                        style={{ background: `${tipColor}22`, color: tipColor }}
                      >
                        {tipLabel}
                      </span>
                      {job.donem && (
                        <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'rgba(250,250,249,0.5)' }}>
                          {job.donem}
                        </span>
                      )}
                      <span className="text-[10px] tabular-nums ml-auto shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        {timeSince(refTime)}
                      </span>
                    </div>
                    <p className="text-[12px] font-semibold truncate mb-1" style={{ color: '#fafaf9' }} title={taxpayerName(tp)}>
                      {taxpayerName(tp)}
                    </p>
                    <p
                      className="text-[10.5px] truncate"
                      style={{ color: 'rgba(250,250,249,0.55)', fontFamily: 'Manrope, Inter, system-ui, sans-serif' }}
                      title={lastLogLine(job.errorMsg)}
                    >
                      {lastLogLine(job.errorMsg)}
                    </p>
                    <div className="flex justify-end mt-1.5">
                      <button
                        onClick={() => {
                          if (confirm(`${tipLabel} işi iptal edilsin mi?`)) cancelMut.mutate(job.id);
                        }}
                        disabled={cancelMut.isPending}
                        className="text-[10px] px-2 py-0.5 rounded transition hover:brightness-110 disabled:opacity-50"
                        style={{
                          background: 'rgba(239,68,68,0.08)',
                          color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.18)',
                        }}
                      >
                        İptal
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
