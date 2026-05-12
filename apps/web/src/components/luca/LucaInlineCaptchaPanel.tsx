'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { lucaSessionApi } from '@/lib/luca-session';

type Props = {
  jobIds: string[];
  color?: string;
  agentRunningHint?: boolean;
  onAnswered?: () => void;
  onCancel?: () => void;
};

export function LucaInlineCaptchaPanel({ jobIds, color = '#60a5fa', agentRunningHint = false, onAnswered, onCancel }: Props) {
  const [answer, setAnswer] = useState('');
  const activeIds = useMemo(() => jobIds.filter(Boolean), [jobIds]);

  const statusQuery = useQuery({
    queryKey: ['luca-inline-captcha', activeIds.join(',')],
    queryFn: lucaSessionApi.status,
    enabled: activeIds.length > 0,
    refetchInterval: 2500,
  });

  const challenge = useMemo(() => {
    const ch = statusQuery.data?.activeChallenge;
    if (!ch || ch.status !== 'pending') return null;
    if (ch.jobId && activeIds.length > 0 && !activeIds.includes(ch.jobId)) return null;
    return ch;
  }, [statusQuery.data?.activeChallenge, activeIds]);

  const agentRunning = agentRunningHint || (statusQuery.data?.devices || []).some((device) => device.running);

  const answerMut = useMutation({
    mutationFn: () => {
      if (!challenge) throw new Error('Güvenlik kodu isteği bulunamadı');
      if (!answer.trim()) throw new Error('Güvenlik kodunu girin');
      return lucaSessionApi.answerCaptcha(challenge.id, answer.trim());
    },
    onSuccess: () => {
      toast.success('Güvenlik kodu Luca ajanına gönderildi');
      setAnswer('');
      statusQuery.refetch();
      onAnswered?.();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Güvenlik kodu gönderilemedi'),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (challenge) await lucaSessionApi.cancelCaptcha(challenge.id).catch(() => null);
    },
    onSuccess: () => {
      setAnswer('');
      statusQuery.refetch();
      onCancel?.();
    },
  });

  if (activeIds.length === 0) return null;

  if (!challenge) {
    return (
      <div
        className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
        style={{
          background: agentRunning ? 'rgba(34,197,94,0.08)' : 'rgba(244,63,94,0.08)',
          border: `1px solid ${agentRunning ? 'rgba(34,197,94,0.20)' : 'rgba(244,63,94,0.22)'}`,
          color: 'rgba(250,250,249,0.70)',
        }}
      >
        {agentRunning ? <ShieldCheck size={14} style={{ color: '#86efac' }} /> : <AlertTriangle size={14} style={{ color: '#fca5a5' }} />}
        <span>
          {agentRunning
            ? 'Arka plan Luca ajanı açık. Güvenlik kodu çıkarsa burada sorulacak.'
            : 'Arka plan Luca ajanı açık görünmüyor. Ajan çalışmadan Luca verisi çekilemez.'}
        </span>
      </div>
    );
  }

  return (
    <div
      className="mt-3 grid gap-3 rounded-lg p-3 md:grid-cols-[220px_1fr_auto]"
      style={{ background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.30)' }}
    >
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: '#bfdbfe' }}>
          Luca Güvenlik Kodu
        </div>
        {challenge.captchaImage ? (
          <img
            src={challenge.captchaImage}
            alt="Luca güvenlik kodu"
            className="h-16 w-full rounded-md object-contain"
            style={{ background: '#fff', border: '1px solid rgba(255,255,255,0.22)' }}
          />
        ) : (
          <div className="flex h-16 items-center justify-center rounded-md text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.65)' }}>
            Kod görseli bekleniyor
          </div>
        )}
      </div>
      <div>
        <label className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.68)' }}>
          Kodu buraya gir
        </label>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && answer.trim()) answerMut.mutate();
          }}
          autoFocus
          className="h-11 w-full rounded-lg border px-3 text-base font-bold outline-none"
          style={{
            background: 'rgba(0,0,0,0.28)',
            borderColor: 'rgba(191,219,254,0.35)',
            color: '#fafaf9',
            letterSpacing: '.08em',
          }}
        />
        <p className="mt-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.62)' }}>
          Ayrı Luca sekmesi açılmadan, bu kod arka plandaki ajana iletilir.
        </p>
      </div>
      <div className="flex items-end gap-2">
        <button
          onClick={() => cancelMut.mutate()}
          disabled={cancelMut.isPending}
          className="rounded-lg px-3 py-3 text-sm font-bold disabled:opacity-45"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.70)' }}
        >
          İptal
        </button>
        <button
          onClick={() => answerMut.mutate()}
          disabled={answerMut.isPending || !answer.trim()}
          className="rounded-lg px-4 py-3 text-sm font-bold disabled:opacity-45"
          style={{ background: color, color: '#06121f' }}
        >
          {answerMut.isPending ? 'Gönderiliyor...' : 'Kodu Gönder'}
        </button>
      </div>
    </div>
  );
}
