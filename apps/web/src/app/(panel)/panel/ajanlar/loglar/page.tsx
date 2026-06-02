'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { agentsApi, AGENTS, AgentEvent } from '@/lib/agents';
import { ArrowLeft, History, Search, Pause, Play, Download, CheckCircle2, SkipForward, AlertTriangle } from 'lucide-react';
import { LogCard } from '../_components/LogCard';

export default function LoglarPage() {
  const [agent, setAgent] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: events = [] } = useQuery({
    queryKey: ['agent-events', agent, status],
    queryFn: () =>
      agentsApi.listEvents({
        agent: agent || undefined,
        status: status || undefined,
        limit: 500,
      }),
    refetchInterval: paused ? false : 2000,
  });

  const filtered = useMemo(() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter((e: AgentEvent) => JSON.stringify(e).toLowerCase().includes(q));
  }, [events, search]);

  // Autoscroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const exportLog = () => {
    const text = [...filtered]
      .reverse()
      .map((e: AgentEvent) => formatLogLine(e, true))
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moren-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = filtered.length;
  // Eski ajan ('ok'/'skip'/'error') ve yeni ajan ('onaylandi'/'atlandi'/'hata') kayıtları
  // veritabanında karışık olabilir — her iki değeri de say.
  const onaylandi = filtered.filter((e) => e.status === 'onaylandi' || e.status === 'basarili' || e.status === 'ok').length;
  const atlandi = filtered.filter((e) => e.status === 'atlandi' || e.status === 'skip').length;
  const hata = filtered.filter((e) => e.status === 'hata' || e.status === 'error').length;

  return (
    <div className="space-y-5 h-full flex flex-col max-w-7xl">
      {/* === BAŞLIK (AI Maliyet imzası — çelik mavi teması) === */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5 flex-shrink-0"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(56,189,248,0.16), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(99,102,241,0.12), transparent 45%), #0f0d0b',
        }}
      >
        {/* üst renk şeridi */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #38bdf8, #60a5fa, #818cf8, #22d3ee)' }}
        />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(250,250,249,0.58)' }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #38bdf8, #3b82f6)', boxShadow: '0 6px 18px rgba(56,189,248,0.35)' }}
            >
              <History size={22} style={{ color: '#08131f' }} />
            </span>
            Yapılan İşlemler
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Canlı terminal akışı — ajan her işlem yaptığında anında görünür
        </p>
      </header>

      <div
        className="rounded-2xl p-3 border flex-shrink-0"
        style={{
          borderColor: 'rgba(56,189,248,0.18)',
          background: 'linear-gradient(135deg, rgba(56,189,248,0.08), rgba(99,102,241,0.05) 60%, rgba(255,255,255,0.02))',
        }}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
          >
            <option value="">Tüm ajanlar</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
          >
            <option value="">Tüm durumlar</option>
            <option value="onaylandi">✓ Onaylandı</option>
            <option value="atlandi">↷ Atlandı</option>
            <option value="basarili">✓ Başarılı</option>
            <option value="hata">✗ Hata</option>
            <option value="bilgi">• Bilgi</option>
          </select>
          <div
            className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border min-w-[220px]"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
          >
            <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mükellef, firma, fiş no ara..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: '#fafaf9' }}
            />
          </div>
          <button
            onClick={() => setPaused(!paused)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
            style={{
              background: paused ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,0.05)',
              color: paused ? '#059669' : 'rgba(250,250,249,0.45)',
            }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Devam' : 'Duraklat'}
          </button>
          <label className="inline-flex items-center gap-1 text-xs px-2" style={{ color: 'rgba(250,250,249,0.45)' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Otomatik kaydır
          </label>
          <button
            onClick={exportLog}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'rgba(56,189,248,0.16)', color: '#60a5fa', border: '1px solid rgba(56,189,248,0.35)' }}
          >
            <Download size={13} /> Dışa aktar
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <CountBadge icon={History} label="Toplam" value={total} color="#60a5fa" />
          <CountBadge icon={CheckCircle2} label="Onaylandı" value={onaylandi} color="#4ade80" />
          <CountBadge icon={SkipForward} label="Atlandı" value={atlandi} color="#fbbf24" />
          <CountBadge icon={AlertTriangle} label="Hata" value={hata} color="#f87171" />
          {!paused && (
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.28)' }}
            >
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981' }} />
              CANLI · 2 saniye yenileme
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="rounded-xl border flex-1 overflow-y-auto font-mono text-xs"
        style={{
          background: '#0a0e1a',
          borderColor: 'rgba(56,189,248,0.18)',
          color: '#cbd5e1',
          minHeight: '400px',
        }}
      >
        {filtered.length === 0 ? (
          <div className="p-10 text-center" style={{ color: '#64748b' }}>
            Henüz log yok. Ajan ping attığında burada terminal gibi görünecek.
          </div>
        ) : (
          <div className="p-3 space-y-1.5">
            {[...filtered].reverse().map((e: AgentEvent) => (
              <LogCard key={e.id} event={e as any} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CountBadge({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5"
      style={{ background: `linear-gradient(135deg, ${color}22, ${color}0a)`, border: `1px solid ${color}33` }}
    >
      <span className="grid h-6 w-6 place-items-center rounded-lg" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
        <Icon size={13} style={{ color }} />
      </span>
      <span className="text-[11px] font-medium" style={{ color: 'rgba(250,250,249,0.62)' }}>{label}</span>
      <span className="text-[14px] font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function styleFor(status: string) {
  switch (status) {
    case 'onaylandi':
    case 'basarili':
    case 'ok':
      return { color: '#22c55e', icon: '✓', label: 'ONAY', bg: 'rgba(34,197,94,.08)' };
    case 'hata':
    case 'error':
      return { color: '#ef4444', icon: '✗', label: 'HATA', bg: 'rgba(239,68,68,.12)' };
    case 'atlandi':
    case 'skip':
      return { color: '#f59e0b', icon: '↷', label: 'ATLA', bg: 'rgba(245,158,11,.08)' };
    case 'demirbas':
      return { color: '#a855f7', icon: '⏩', label: 'DEMR', bg: 'rgba(168,85,247,.08)' };
    default:
      return { color: '#94a3b8', icon: '•', label: 'INFO', bg: 'rgba(148,163,184,.06)' };
  }
}

function formatLogLine(event: AgentEvent, plain: boolean = true): string {
  const d = new Date(event.ts);
  const t = d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const sym = event.status === 'hata' ? '[!]' : event.status === 'atlandi' ? '[~]' : '[+]';
  const parts = [event.agent?.toUpperCase(), event.mukellef, event.firma, event.fisNo, event.hesapKodu, event.message]
    .filter(Boolean)
    .join(' · ');
  return `[${t}] ${sym} ${parts}`;
}
