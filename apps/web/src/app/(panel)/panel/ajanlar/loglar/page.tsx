'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsApi, AGENTS, AgentEvent } from '@/lib/agents';
import { CheckCircle2, XCircle, SkipForward, Info, Search, Filter } from 'lucide-react';

export default function LoglarPage() {
  const [agent, setAgent] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data: events = [] } = useQuery({
    queryKey: ['agent-events', agent, status],
    queryFn: () =>
      agentsApi.listEvents({
        agent: agent || undefined,
        status: status || undefined,
        limit: 500,
      }),
    refetchInterval: 3000,
  });

  const filtered = useMemo(() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter((e: AgentEvent) =>
      JSON.stringify(e).toLowerCase().includes(q),
    );
  }, [events, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
          Yapılan İşlemler
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Canlı log akışı — her 3 saniyede yenilenir
        </p>
      </div>

      <div
        className="rounded-xl p-4 border"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Filter size={14} />
            Filtre:
          </div>
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
            <option value="onaylandi">Onaylandı</option>
            <option value="atlandi">Atlandı</option>
            <option value="basarili">Başarılı</option>
            <option value="hata">Hata</option>
            <option value="bilgi">Bilgi</option>
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
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {filtered.length} kayıt
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Henüz log yok. Yerel ajanlar ping attığında burada görünecek.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {filtered.map((e: AgentEvent) => (
              <LogRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ event }: { event: AgentEvent }) {
  const { icon: Icon, color, bg } = iconFor(event.status);
  const ts = new Date(event.ts).toLocaleString('tr-TR');
  const sub = [event.firma, event.fisNo, event.hesapKodu, event.kdv, event.tutar ? `${event.tutar} TL` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex items-start gap-3 p-3 text-sm">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: bg, color }}
      >
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold" style={{ color: 'var(--text)' }}>
            {event.mukellef || event.agent.toUpperCase()}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}>
            {event.agent}
          </span>
          {event.action && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--navy-50)', color: 'var(--navy-500)' }}>
              {event.action}
            </span>
          )}
        </div>
        <div className="mt-0.5" style={{ color: 'var(--text)' }}>
          {event.message || event.status}
        </div>
        {sub && (
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </div>
        )}
      </div>
      <div className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
        {ts}
      </div>
    </div>
  );
}

function iconFor(status: string) {
  switch (status) {
    case 'onaylandi':
    case 'basarili':
      return { icon: CheckCircle2, color: '#059669', bg: 'rgba(16,185,129,.15)' };
    case 'hata':
      return { icon: XCircle, color: '#dc2626', bg: 'rgba(239,68,68,.15)' };
    case 'atlandi':
      return { icon: SkipForward, color: '#d97706', bg: 'rgba(245,158,11,.15)' };
    default:
      return { icon: Info, color: '#1e40af', bg: 'rgba(59,130,246,.15)' };
  }
}
