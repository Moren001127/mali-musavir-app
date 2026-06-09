'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  Loader2,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

type Summary = {
  count: number;
  onlineCount: number;
  syntheticCount: number;
  averageScore: number;
  lowQualityCount: number;
  retryCount: number;
  fallbackCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimatedTry: number;
};

type QualityLog = {
  id: string;
  status: string;
  score: number;
  intent?: string | null;
  reasons?: string[];
  originalReply?: string | null;
  finalReply?: string | null;
  source: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  scenarioKey?: string | null;
  metadata?: any;
  createdAt: string;
};

type LastResults = {
  latestBatch?: string | null;
  results: QualityLog[];
};

type Report = {
  totalLogs: number;
  lowScore: number;
  negativeFeedback: number;
  topReasons: Array<{ reason: string; count: number }>;
  suggestions: string[];
};

const reasonOptions = ['tekrar', 'alakasız', 'uzun', 'ton kötü', 'taahhüt var', 'veri riski'];

export default function BotKalitePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'low' | 'tests' | 'report'>('low');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data: summary, isLoading: summaryLoading } = useQuery<Summary>({
    queryKey: ['whatsapp-quality-summary'],
    queryFn: () => api.get('/whatsapp/quality/summary').then((r) => r.data),
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<QualityLog[]>({
    queryKey: ['whatsapp-quality-logs'],
    queryFn: () => api.get('/whatsapp/quality/logs?limit=80').then((r) => r.data),
  });

  const { data: tests, isLoading: testsLoading } = useQuery<LastResults>({
    queryKey: ['whatsapp-quality-tests'],
    queryFn: () => api.get('/whatsapp/quality/test/last-results').then((r) => r.data),
  });

  const { data: report, isLoading: reportLoading } = useQuery<Report>({
    queryKey: ['whatsapp-quality-report'],
    queryFn: () => api.get('/whatsapp/quality/improvement-report').then((r) => r.data),
  });

  const feedback = useMutation({
    mutationFn: (input: { logId: string; rating: 'UP' | 'DOWN'; reason?: string }) =>
      api.post('/whatsapp/quality/feedback', input),
    onSuccess: () => toast.success('Geri bildirim kaydedildi'),
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Geri bildirim kaydedilemedi'),
  });

  const runTests = useMutation({
    mutationFn: () => api.post('/whatsapp/quality/test/run-now').then((r) => r.data),
    onSuccess: (data) => {
      toast.success(`Test tamamlandı: ${data.passed}/${data.total} geçti`);
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-logs'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-tests'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-report'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Test çalıştırılamadı'),
  });

  const lowLogs = useMemo(
    () => logs.filter((log) => log.score < 6 || ['LOW_SCORE', 'FALLBACK_USED', 'SYNTHETIC_FAIL'].includes(log.status)),
    [logs],
  );

  return (
    <div className="space-y-5">
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
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
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>WhatsApp Bot QA</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{
                width: 46,
                height: 46,
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`,
                boxShadow: '0 8px 22px rgba(212,184,118,0.30)',
              }}
            >
              <Bot size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[30px] font-semibold leading-none tracking-[-.03em] text-[#fafaf9]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
                Bot Kalite
              </h1>
              <p className="mt-2 text-[13px] font-semibold text-white/45">
                Cevaplar müşteriye gitmeden skorlanır; düşük kalite, test ve maliyet burada izlenir.
              </p>
            </div>
          </div>
          <button
            onClick={() => runTests.mutate()}
            disabled={runTests.isPending}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold transition-all disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', boxShadow: '0 10px 24px rgba(212,184,118,0.16)' }}
          >
            {runTests.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Testleri Çalıştır
          </button>
        </div>
      </header>

      <section className="grid gap-3 xl:grid-cols-4">
        <StatCard icon={<Activity size={18} />} label="Bu hafta cevap/test" value={summaryLoading ? '...' : String(summary?.count || 0)} sub={`${summary?.onlineCount || 0} canlı · ${summary?.syntheticCount || 0} test`} />
        <StatCard icon={<CheckCircle2 size={18} />} label="Ortalama skor" value={summaryLoading ? '...' : (summary?.averageScore || 0).toFixed(2)} sub="0-10 kalite puanı" />
        <StatCard icon={<AlertTriangle size={18} />} label="Düşük kalite" value={summaryLoading ? '...' : String(summary?.lowQualityCount || 0)} sub={`${summary?.retryCount || 0} retry · ${summary?.fallbackCount || 0} fallback`} danger={(summary?.lowQualityCount || 0) > 0} />
        <StatCard icon={<DollarSign size={18} />} label="Eval maliyeti" value={`$${(summary?.costUsd || 0).toFixed(4)}`} sub={`${summary?.inputTokens || 0}/${summary?.outputTokens || 0} token · ~${summary?.estimatedTry || 0} TL`} />
      </section>

      <div className="inline-flex overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        {[
          ['low', 'Düşük Kaliteli'],
          ['tests', 'Test Sonuçları'],
          ['report', 'Auto-improvement'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className="px-4 py-2.5 text-sm font-semibold"
            style={{ background: tab === key ? 'rgba(212,184,118,0.16)' : 'transparent', color: tab === key ? GOLD : 'rgba(250,250,249,0.62)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'low' && (
        <section className="rounded-xl border border-white/10 bg-white/[0.025]">
          {logsLoading ? (
            <Loading />
          ) : lowLogs.length === 0 ? (
            <Empty icon={<CheckCircle2 size={34} />} text="Düşük kaliteli cevap bulunmadı." />
          ) : (
            <div className="divide-y divide-white/5">
              {lowLogs.map((log) => (
                <article key={log.id} className="grid gap-4 p-4 xl:grid-cols-[1fr_260px]">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge color={log.status === 'FALLBACK_USED' ? '#f97316' : '#ef4444'}>{log.status}</Badge>
                      <Badge color={GOLD}>Skor {log.score}/10</Badge>
                      {log.intent && <Badge color="#8fd7bd">{log.intent}</Badge>}
                      <span className="text-xs text-white/38">{new Date(log.createdAt).toLocaleString('tr-TR')}</span>
                    </div>
                    <p className="text-sm font-semibold text-white/85">{log.finalReply || log.originalReply || '(cevap yok)'}</p>
                    <p className="mt-2 text-xs text-white/45">{(log.reasons || []).join(', ') || 'Sebep yok'}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <select
                      value={reasons[log.id] || ''}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [log.id]: e.target.value }))}
                      className="h-10 rounded-lg border border-white/10 bg-[#11100d] px-3 text-sm text-white outline-none"
                    >
                      <option value="">Neden seç</option>
                      {reasonOptions.map((reason) => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => feedback.mutate({ logId: log.id, rating: 'UP', reason: reasons[log.id] })} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-500/15 text-sm font-semibold text-emerald-300">
                        <ThumbsUp size={15} /> İyi
                      </button>
                      <button onClick={() => feedback.mutate({ logId: log.id, rating: 'DOWN', reason: reasons[log.id] })} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-500/15 text-sm font-semibold text-rose-300">
                        <ThumbsDown size={15} /> Kötü
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'tests' && (
        <section className="rounded-xl border border-white/10 bg-white/[0.025]">
          {testsLoading ? (
            <Loading />
          ) : !tests?.results?.length ? (
            <Empty icon={<ClipboardCheck size={34} />} text="Henüz synthetic test sonucu yok." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-white/45">
                  <tr>
                    <th className="px-4 py-3">Senaryo</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Skor</th>
                    <th className="px-4 py-3">Intent</th>
                    <th className="px-4 py-3">Sebep</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tests.results.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-semibold text-white/85">{row.metadata?.title || row.scenarioKey}</td>
                      <td className="px-4 py-3">{row.status === 'PASSED' ? <Badge color="#22c55e">PASS</Badge> : <Badge color="#ef4444">FAIL</Badge>}</td>
                      <td className="px-4 py-3 text-white/70">{row.score}/10</td>
                      <td className="px-4 py-3 text-white/55">{row.intent || '-'}</td>
                      <td className="px-4 py-3 text-white/45">{(row.reasons || []).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'report' && (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>Haftalık Özet</h2>
            {reportLoading ? <Loading compact /> : (
              <div className="space-y-3 text-sm text-white/65">
                <Line label="Toplam log" value={report?.totalLogs || 0} />
                <Line label="Düşük skor" value={report?.lowScore || 0} />
                <Line label="Negatif feedback" value={report?.negativeFeedback || 0} />
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>Öneriler</h2>
            {reportLoading ? <Loading compact /> : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(report?.topReasons || []).map((item) => <Badge key={item.reason} color="#f59e0b">{item.reason}: {item.count}</Badge>)}
                </div>
                <ul className="space-y-2 text-sm text-white/68">
                  {(report?.suggestions || ['Bu hafta öneri oluşmadı.']).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, danger }: { icon: ReactNode; label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: danger ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)', background: danger ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.03)' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-white/48">{icon}</span>
        {danger && <XCircle size={15} className="text-rose-300" />}
      </div>
      <div className="text-[26px] font-bold tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-white/42">{label}</div>
      <div className="mt-2 text-xs text-white/38">{sub}</div>
    </div>
  );
}

function Badge({ children, color }: { children: ReactNode; color: string }) {
  return <span className="inline-flex rounded-md border px-2 py-1 text-[11px] font-bold" style={{ borderColor: `${color}55`, color, background: `${color}18` }}>{children}</span>;
}

function Loading({ compact }: { compact?: boolean }) {
  return <div className={compact ? 'flex items-center gap-2 text-sm text-white/45' : 'flex items-center justify-center gap-2 p-10 text-sm text-white/45'}><Loader2 size={15} className="animate-spin" /> Yükleniyor</div>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="flex flex-col items-center justify-center gap-3 p-12 text-center text-white/42">{icon}<span className="text-sm font-medium">{text}</span></div>;
}

function Line({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between border-b border-white/5 pb-2"><span>{label}</span><b className="text-white">{value}</b></div>;
}
