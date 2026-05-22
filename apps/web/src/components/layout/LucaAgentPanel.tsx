'use client';

/**
 * Global Luca Ajanı durum panel'i — üst bar'da (TopBar) yer alır, her
 * sayfada görünür.
 *
 * Compact buton: 36x36 kutu, sağ üstte aktif job sayısı badge. Tıklayınca
 * sağ tarafa hizalanmış geniş dropdown açılır; aktif (pending+running) job'lar
 * listelenir, her job için tip rozeti, mükellef adı, son log satırı ve iptal
 * butonu gösterilir.
 *
 * Polling: /luca/jobs (mevcut endpoint) — 5 sn'de bir.
 * Veri kalıcılığı: Job log'ları zaten DB'de (LucaFetchJob.errorMsg, son 20
 * satır) — sayfaya geri gelince otomatik yüklenir.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Bot, X, Loader2, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { lucaSessionApi } from '@/lib/luca-session';

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
  priority?: number | null;
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

function jobNeedsCaptcha(job: LucaJob): boolean {
  return /captcha|g[uü]venlik kodu.*bekleniyor|kod portalda/i.test(String(job.errorMsg || ''));
}

function jobHasAgentProgress(job: LucaJob): boolean {
  if (job.status === 'running') return true;
  const log = String(job.errorMsg || '');
  return /Local Node ajan|otomatik giris|giris ekraninda|g[uü]venlik kodu|klasik|firma kontrol|Sira geldi|Sıra geldi|hazir/i.test(log);
}

function activeSort(a: LucaJob, b: LucaJob): number {
  const aWorking = jobHasAgentProgress(a) ? 0 : 1;
  const bWorking = jobHasAgentProgress(b) ? 0 : 1;
  if (aWorking !== bWorking) return aWorking - bWorking;
  const priorityDiff = (b.priority || 0) - (a.priority || 0);
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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
  const [captchaText, setCaptchaText] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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

  const { data: lucaSession } = useQuery({
    queryKey: ['luca-session-manager', 'topbar'],
    queryFn: lucaSessionApi.status,
    refetchInterval: 2500,
    staleTime: 1000,
  });

  const activeChallenge = lucaSession?.activeChallenge || null;

  const taxpayerById = useMemo(() => {
    const m = new Map<string, Taxpayer>();
    for (const t of taxpayers) m.set(t.id, t);
    return m;
  }, [taxpayers]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === 'pending' || j.status === 'running').sort(activeSort),
    [jobs],
  );
  const runningCount = activeJobs.filter(jobHasAgentProgress).length;
  const pendingCount = Math.max(0, activeJobs.length - runningCount);
  const totalActive = activeJobs.length;

  // Dış tıklamada panel kapansın
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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

  const answerCaptchaMut = useMutation({
    mutationFn: () => lucaSessionApi.answerCaptcha(activeChallenge!.id, captchaText.trim()),
    onSuccess: () => {
      setCaptchaText('');
      qc.invalidateQueries({ queryKey: ['luca-session-manager'] });
      qc.invalidateQueries({ queryKey: ['luca-session-manager', 'topbar'] });
      qc.invalidateQueries({ queryKey: ['luca-agent-jobs'] });
      toast.success('Güvenlik kodu agenta gönderildi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kod gönderilemedi'),
  });

  const isIdle = totalActive === 0;
  const statusColor = activeChallenge ? '#f59e0b' : isIdle ? '#22c55e' : runningCount > 0 ? '#f59e0b' : '#64748b';
  const lucaStatusLabel = activeChallenge
    ? 'Luca güvenlik kodu bekliyor'
    : isIdle
      ? 'Luca ajanı boşta'
      : `Luca ajanı · ${runningCount} çalışıyor${pendingCount > 0 ? `, ${pendingCount} sırada` : ''}`;

  return (
    <div ref={wrapperRef} className="relative">
      {/* COMPACT TRIGGER — TopBar'ın diğer butonları (Tema, Bildirim) ile aynı yükseklikte */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative h-9 px-3 rounded-lg flex items-center gap-2 transition-all hover:brightness-110"
        style={{
          background: activeChallenge
            ? 'rgba(245,158,11,0.16)'
            : isIdle ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${activeChallenge ? 'rgba(245,158,11,0.55)' : isIdle ? 'rgba(34,197,94,0.22)' : 'rgba(245,158,11,0.3)'}`,
        }}
        aria-label={lucaStatusLabel}
      >
        <div className="relative">
          {activeChallenge ? <KeyRound size={14} style={{ color: statusColor }} /> : <Bot size={14} style={{ color: statusColor }} />}
          {(!isIdle || activeChallenge) && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse"
              style={{ background: statusColor }}
            />
          )}
        </div>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: statusColor }}>
          {activeChallenge ? 'Kod' : isIdle ? 'Luca' : `${totalActive}`}
        </span>
        {activeChallenge && (
          <span
            className="text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center"
            style={{ background: statusColor, color: '#0f0d0b' }}
          >
            !
          </span>
        )}
        {!isIdle && !activeChallenge && (
          <span
            className="text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center"
            style={{ background: statusColor, color: '#0f0d0b' }}
          >
            {runningCount > 0 ? '●' : '◌'}
          </span>
        )}
      </button>

      {/* DROPDOWN PANEL — TopBar'ın hemen altına sağa hizalı, geniş */}
      {open && (
        <div
          className="absolute right-0 mt-2 rounded-xl overflow-hidden z-50"
          style={{
            width: 420,
            maxWidth: 'calc(100vw - 32px)',
            background: 'rgba(15,13,11,0.98)',
            border: '1px solid rgba(212,184,118,0.2)',
            boxShadow: '0 18px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,184,118,0.08)',
            backdropFilter: 'blur(14px)',
          }}
        >
          {/* HEADER */}
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(212,184,118,0.05)' }}
          >
            <div className="flex items-center gap-2">
              <Bot size={14} style={{ color: GOLD }} />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: GOLD, letterSpacing: '0.14em' }}>
                  Luca Ajanı
                </p>
                <p className="text-[11px] font-medium" style={{ color: statusColor }}>
                  {activeChallenge ? 'Güvenlik kodu bekliyor' : isIdle ? 'Boşta · son işten beri bekliyor' : `${runningCount} çalışıyor${pendingCount > 0 ? ` · ${pendingCount} sırada` : ''}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-md hover:bg-white/10 transition"
              style={{ color: 'rgba(250,250,249,0.5)' }}
              title="Kapat"
            >
              <X size={13} />
            </button>
          </div>

          {activeChallenge && (
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(245,158,11,0.08)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound size={13} style={{ color: '#fbbf24' }} />
                  <span className="text-[12px] font-semibold truncate" style={{ color: '#fafaf9' }}>
                    Luca güvenlik kodu gerekiyor
                  </span>
                </div>
                <Link href="/panel/ajanlar/luca" className="text-[10.5px] font-semibold shrink-0" style={{ color: GOLD }}>
                  Oturum
                </Link>
              </div>
              <div className="flex items-center gap-2">
                {activeChallenge.captchaImage && (
                  <div className="rounded-md px-2 py-1 shrink-0" style={{ background: '#f8fafc' }}>
                    <img src={activeChallenge.captchaImage} alt="Luca güvenlik kodu" style={{ width: 112, height: 42, objectFit: 'contain' }} />
                  </div>
                )}
                <input
                  value={captchaText}
                  onChange={(e) => setCaptchaText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && captchaText.trim().length >= 3) answerCaptchaMut.mutate();
                  }}
                  placeholder="Kod"
                  className="min-w-0 flex-1 px-2.5 py-2 rounded-md text-[12px] outline-none"
                  style={{ background: 'rgba(15,13,11,0.92)', color: '#fafaf9', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <button
                  type="button"
                  disabled={answerCaptchaMut.isPending || captchaText.trim().length < 3}
                  onClick={() => answerCaptchaMut.mutate()}
                  className="px-3 py-2 rounded-md text-[11px] font-semibold disabled:opacity-50"
                  style={{ background: GOLD, color: '#111827' }}
                >
                  {answerCaptchaMut.isPending ? '...' : 'Gönder'}
                </button>
              </div>
            </div>
          )}

          {/* JOB LIST */}
          <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
            {activeJobs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto mb-2" style={{ color: '#22c55e' }} />
                <p className="text-[13px] font-medium" style={{ color: 'rgba(250,250,249,0.65)' }}>
                  Luca ajanı şu an boşta
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.35)' }}>
                  Yeni iş tetiklediğinde burada anlık görürsün
                </p>
              </div>
            ) : (
              activeJobs.map((job) => {
                const tp = taxpayerById.get(job.mukellefId);
                const tipColor = TIP_COLOR[job.tip] || '#64748b';
                const tipLabel = TIP_LABEL[job.tip] || job.tip;
                const isRunning = jobHasAgentProgress(job);
                const needsCaptcha = jobNeedsCaptcha(job);
                const refTime = job.startedAt || job.createdAt;

                return (
                  <div
                    key={job.id}
                    className="px-4 py-3 transition-colors hover:bg-white/[0.03]"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {/* Üst satır: tip rozeti + dönem + süre */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {needsCaptcha ? (
                        <KeyRound size={11} className="shrink-0" style={{ color: '#fbbf24' }} />
                      ) : isRunning ? (
                        <Loader2 size={11} className="animate-spin shrink-0" style={{ color: '#f59e0b' }} />
                      ) : (
                        <AlertCircle size={11} className="shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }} />
                      )}
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide"
                        style={{ background: `${tipColor}22`, color: tipColor }}
                      >
                        {tipLabel}
                      </span>
                      {job.donem && (
                        <span className="text-[10.5px] tabular-nums shrink-0" style={{ color: 'rgba(250,250,249,0.55)' }}>
                          {job.donem}
                        </span>
                      )}
                      <span className="text-[10.5px] tabular-nums ml-auto shrink-0" style={{ color: 'rgba(250,250,249,0.42)' }}>
                        {timeSince(refTime)}
                      </span>
                    </div>
                    {/* Mükellef adı */}
                    <p className="text-[12.5px] font-semibold truncate mb-1" style={{ color: '#fafaf9' }} title={taxpayerName(tp)}>
                      {taxpayerName(tp)}
                    </p>
                    {/* Son log satırı */}
                    <p
                      className="text-[11px] truncate"
                      style={{ color: 'rgba(250,250,249,0.55)', fontFamily: 'Manrope, Inter, system-ui, sans-serif' }}
                      title={lastLogLine(job.errorMsg)}
                    >
                      {lastLogLine(job.errorMsg)}
                    </p>
                    {/* Aksiyon: iptal */}
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => {
                          if (confirm(`${tipLabel} işi iptal edilsin mi?`)) cancelMut.mutate(job.id);
                        }}
                        disabled={cancelMut.isPending}
                        className="text-[10.5px] px-2.5 py-1 rounded-md transition hover:brightness-110 disabled:opacity-50 font-semibold"
                        style={{
                          background: 'rgba(239,68,68,0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.22)',
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
