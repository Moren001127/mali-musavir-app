'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsApi, AGENTS, AgentEvent } from '@/lib/agents';
import { Search, Pause, Play, Download } from 'lucide-react';

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
  const onaylandi = filtered.filter((e) => e.status === 'onaylandi' || e.status === 'basarili').length;
  const atlandi = filtered.filter((e) => e.status === 'atlandi').length;
  const hata = filtered.filter((e) => e.status === 'hata').length;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
          Yapılan İşlemler
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Canlı terminal akışı — ajan her işlem yaptığında anında görünür
        </p>
      </div>

      <div
        className="rounded-xl p-3 border flex-shrink-0"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
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
            style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
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
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mükellef, firma, fiş no ara..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--text)' }}
            />
          </div>
          <button
            onClick={() => setPaused(!paused)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
            style={{
              background: paused ? 'rgba(16,185,129,.15)' : 'var(--muted)',
              color: paused ? '#059669' : 'var(--text-muted)',
            }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Devam' : 'Duraklat'}
          </button>
          <label className="inline-flex items-center gap-1 text-xs px-2" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Otomatik kaydır
          </label>
          <button
            onClick={exportLog}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
            style={{ background: 'var(--muted)', color: 'var(--text)' }}
          >
            <Download size={13} /> Dışa aktar
          </button>
        </div>
        <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Toplam: <strong style={{ color: 'var(--text)' }}>{total}</strong></span>
          <span>Onaylandı: <strong style={{ color: '#059669' }}>{onaylandi}</strong></span>
          <span>Atlandı: <strong style={{ color: '#d97706' }}>{atlandi}</strong></span>
          <span>Hata: <strong style={{ color: '#dc2626' }}>{hata}</strong></span>
          {!paused && <span className="ml-auto inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981' }} />
            CANLI · 2 saniye yenileme
          </span>}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="rounded-xl border flex-1 overflow-y-auto font-mono text-xs"
        style={{
          background: '#0a0e1a',
          borderColor: 'var(--border)',
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
              <LogLine key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogLine({ event }: { event: AgentEvent }) {
  const d = new Date(event.ts);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const { color, icon, bg, label } = styleFor(event.status);
  const parts = [event.fisNo && `#${event.fisNo}`, event.hesapKodu, event.kdv, event.tutar ? `${Number(event.tutar).toLocaleString('tr-TR')} TL` : null].filter(Boolean);

  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-md transition-colors hover:brightness-110"
      style={{
        background: bg,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center rounded text-[11px] font-bold px-1.5 py-0.5"
        style={{ background: color + '33', color, minWidth: 52 }}
      >
        {icon} {label}
      </span>
      <span className="text-[11px] tabular-nums flex-shrink-0 pt-0.5" style={{ color: '#94a3b8' }}>
        {t}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          {event.firma && (
            <span className="font-semibold truncate" style={{ color: '#fafaf9' }}>
              {event.firma}
            </span>
          )}
          {parts.map((p, i) => (
            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.06)', color: '#cbd5e1' }}>
              {p}
            </span>
          ))}
        </div>
        {event.message && (
          <div className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
            {event.message}
          </div>
        )}
        {event.mukellef && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: '#64748b' }}>
            {event.mukellef}
          </div>
        )}
      </div>
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
  const t = d.toLocaleString('tr-TR');
  const sym = event.status === 'hata' ? '[!]' : event.status === 'atlandi' ? '[~]' : '[+]';
  const parts = [event.agent?.toUpperCase(), event.mukellef, event.firma, event.fisNo, event.hesapKodu, event.message]
    .filter(Boolean)
    .join(' · ');
  return `[${t}] ${sym} ${parts}`;
}
