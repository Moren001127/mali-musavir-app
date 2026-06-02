'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, CheckCircle2, AlertCircle, Clock, Cpu, Monitor, Server,
  XCircle, Wifi, WifiOff, RefreshCw, ArrowLeft,
} from 'lucide-react';
import { agentsApi, type AgentHealthEntry, type AgentHealthDevice } from '@/lib/agents';

const GOLD = '#d4b876';

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'şimdi';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s önce`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}sa önce`;
  const d = Math.floor(h / 24);
  return `${d}g önce`;
}

function StatusDot({ device }: { device: AgentHealthDevice }) {
  if (device.controlState === 'STOP') {
    return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#64748b' }} title="STOP" />;
  }
  if (device.controlState === 'PAUSED') {
    return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} title="PAUSED" />;
  }
  if (!device.running || device.stale) {
    return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} title="Offline" />;
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#22c55e' }} title="Online" />;
}

function AgentCard({ entry }: { entry: AgentHealthEntry }) {
  const onlineDevices = entry.devices.filter((d) => d.running && !d.stale).length;
  const totalDevices = entry.devices.length;
  const status = totalDevices === 0 ? 'no-device' : onlineDevices > 0 ? 'online' : 'offline';
  const statusColor = status === 'online' ? '#22c55e' : status === 'offline' ? '#ef4444' : '#94a3b8';
  const statusBg =
    status === 'online'
      ? 'rgba(34,197,94,0.10)'
      : status === 'offline'
      ? 'rgba(239,68,68,0.10)'
      : 'rgba(148,163,184,0.10)';

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${status === 'online' ? 'rgba(34,197,94,0.30)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)', boxShadow: '0 4px 12px rgba(34,197,94,0.30)' }}>
            {entry.agent === 'luca' ? <Server size={16} style={{ color: '#052e16' }} /> : <Cpu size={16} style={{ color: '#052e16' }} />}
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: '#4ade80' }}>
              {entry.agent}
            </div>
            <div className="mt-0.5 text-sm font-semibold" style={{ color: '#fafaf9' }}>
              {entry.displayName}
            </div>
          </div>
        </div>
        <div
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
          style={{ background: statusBg, color: statusColor, border: `1px solid ${statusColor}40` }}
        >
          {status === 'online' ? <Wifi size={10} /> : status === 'offline' ? <WifiOff size={10} /> : <AlertCircle size={10} />}
          {status === 'online' ? `${onlineDevices}/${totalDevices} çevrimiçi` : status === 'offline' ? 'Çevrimdışı' : 'Cihaz yok'}
        </div>
      </div>

      {entry.devices.length === 0 ? (
        <div className="text-xs italic" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Bu ajan için hiç ping alınmadı. Kurulum gerekebilir.
        </div>
      ) : (
        <div className="space-y-1.5">
          {entry.devices.slice(0, 3).map((d, i) => (
            <div
              key={(d.deviceId || 'noid') + i}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px]"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <StatusDot device={d} />
              <Monitor size={11} style={{ color: 'rgba(250,250,249,0.55)' }} />
              <span className="font-mono" style={{ color: 'rgba(250,250,249,0.78)' }}>
                {d.deviceId?.slice(0, 24) || 'unknown'}
              </span>
              {d.isLocal && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
                  LOCAL
                </span>
              )}
              <span className="ml-auto" style={{ color: 'rgba(250,250,249,0.45)' }}>
                {relTime(d.lastPing)}
              </span>
            </div>
          ))}
          {entry.devices.length > 3 && (
            <div className="text-[10px] italic" style={{ color: 'rgba(250,250,249,0.4)' }}>
              +{entry.devices.length - 3} cihaz daha
            </div>
          )}
        </div>
      )}

      {/* Bugünkü iş özeti */}
      <div className="grid grid-cols-4 gap-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <Stat label="Toplam" value={entry.todayJobs.total} color="#fafaf9" />
        <Stat label="Tamam" value={entry.todayJobs.done} color="#22c55e" />
        <Stat label="Çalışan" value={entry.todayJobs.running} color="#60a5fa" />
        <Stat label="Hata" value={entry.todayJobs.failed} color="#f87171" />
      </div>

      {entry.activeJobs.length > 0 && (
        <div className="pt-2 border-t space-y-1" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[10px] uppercase font-bold tracking-wider" style={{ color: '#4ade80' }}>
            Şu an
          </div>
          {entry.activeJobs.slice(0, 3).map((j) => (
            <div key={j.id} className="text-[11px] flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.7)' }}>
              {j.status === 'running' ? (
                <RefreshCw size={10} className="animate-spin" style={{ color: '#60a5fa' }} />
              ) : (
                <Clock size={10} style={{ color: '#f59e0b' }} />
              )}
              <span className="font-medium">{j.tip}</span>
              {j.donem && <span style={{ color: 'rgba(250,250,249,0.45)' }}>· {j.donem}</span>}
              <span className="ml-auto text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                {relTime(j.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {entry.recentErrors.length > 0 && (
        <div className="pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: '#f87171' }}>
            Son Hatalar
          </div>
          {entry.recentErrors.slice(0, 2).map((e) => (
            <div key={e.id} className="text-[11px] mb-1" style={{ color: 'rgba(252,165,165,0.85)' }}>
              <XCircle size={10} className="inline mr-1" />
              {e.message.slice(0, 90)}
              <span className="ml-1" style={{ color: 'rgba(250,250,249,0.4)' }}>
                · {relTime(e.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
        {label}
      </div>
    </div>
  );
}

function HourlyChart({ data }: { data: Array<{ hour: string; done: number; failed: number }> }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.done + d.failed)), [data]);
  return (
    <div className="flex items-end gap-1 h-32 px-2">
      {data.map((d, i) => {
        const total = d.done + d.failed;
        const heightPct = total === 0 ? 2 : (total / max) * 100;
        const failRatio = total === 0 ? 0 : d.failed / total;
        const t = new Date(d.hour);
        const hh = t.getHours().toString().padStart(2, '0');
        return (
          <div key={d.hour} className="flex-1 flex flex-col items-center justify-end" title={`${hh}:00 — ${d.done} tamam, ${d.failed} hata`}>
            <div
              className="w-full rounded-t"
              style={{
                height: `${heightPct}%`,
                background: failRatio > 0.3 ? '#f87171' : failRatio > 0 ? '#f59e0b' : '#22c55e',
                minHeight: 2,
                opacity: total === 0 ? 0.15 : 1,
              }}
            />
            {i % 4 === 0 && (
              <div className="text-[8px] mt-1 font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                {hh}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AjanSaglikPage() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['agent-health-summary'],
    queryFn: () => agentsApi.healthSummary(),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-5">
      {/* === BAŞLIK (AI Maliyet imzası — yeşil nabız + kırmızı durum teması) === */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(34,197,94,0.18), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(248,113,113,0.12), transparent 45%), #0f0d0b',
        }}
      >
        {/* üst renk şeridi */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #22c55e, #4ade80, #a3e635, #fbbf24, #f87171)' }}
        />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(250,250,249,0.58)' }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)', boxShadow: '0 6px 18px rgba(34,197,94,0.35)' }}
            >
              <Activity size={22} style={{ color: '#052e16' }} />
            </span>
            Ajan Sağlık Panosu
          </h1>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
            title="Yenile"
            style={{ background: 'rgba(34,197,94,0.16)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.35)' }}
          >
            <RefreshCw size={14} /> Yenile
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Local agent, Chrome uzantısı ve diğer worker'ların canlı durumu — 5 saniyede bir yenilenir.
        </p>
      </header>

      {/* Toplam özet */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryTile label="Aktif İş" value={data.totals.activeJobs} icon={Activity} color={GOLD} />
          <SummaryTile label="Bekleyen Luca" value={data.totals.pendingLucaJobs} icon={Clock} color="#f59e0b" />
          <SummaryTile label="Çalışan Luca" value={data.totals.runningLucaJobs} icon={RefreshCw} color="#60a5fa" />
          <SummaryTile label="Bugün Tamam" value={data.totals.doneToday} icon={CheckCircle2} color="#22c55e" />
          <SummaryTile label="Bugün Hata" value={data.totals.failedToday} icon={XCircle} color="#f87171" />
        </div>
      )}

      {/* Saatlik aktivite */}
      {data && data.hourlyActivity.length > 0 && (
        <div className="rounded-2xl border p-4" style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'rgba(34,197,94,0.18)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'rgba(34,197,94,0.16)', border: '1px solid rgba(34,197,94,0.35)' }}>
              <Activity size={14} style={{ color: '#4ade80' }} />
            </span>
            <div className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: '#4ade80' }}>
              Son 24 Saat Aktivitesi
            </div>
          </div>
          <HourlyChart data={data.hourlyActivity} />
        </div>
      )}

      {/* Ajan kartları */}
      {isLoading && <div className="text-sm text-center py-8" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor…</div>}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.agents.map((entry) => (
            <AgentCard key={entry.agent} entry={entry} />
          ))}
        </div>
      )}

      {/* Kurulum yardımı */}
      <div className="rounded-2xl border p-4" style={{ background: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.20)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'rgba(34,197,94,0.16)', border: '1px solid rgba(34,197,94,0.35)' }}>
            <Server size={14} style={{ color: '#4ade80' }} />
          </span>
          <div className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: '#4ade80' }}>
            Kurulum Notu
          </div>
        </div>
        <div className="text-sm space-y-1" style={{ color: 'rgba(250,250,249,0.75)' }}>
          <div><strong>Local Node Worker</strong> — Luca için: <code className="px-1 rounded text-[11px]" style={{ background: 'rgba(0,0,0,0.3)' }}>apps/luca-local-agent</code> klasöründe <code>baslat.bat</code> çalıştır.</div>
          <div><strong>Chrome Uzantısı</strong> — Mihsap için: portal Ayarlar → Moren Agent → ZIP indir → chrome://extensions → yükle.</div>
        </div>
      </div>

      {data && (
        <div className="text-[10px] text-right" style={{ color: 'rgba(250,250,249,0.35)' }}>
          Son güncelleme: {new Date(data.generatedAt).toLocaleTimeString('tr-TR')}
          {' · '}
          Veri yaşı: {dataUpdatedAt ? `${Math.round((Date.now() - dataUpdatedAt) / 1000)}s` : '—'}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4 flex flex-col"
      style={{ borderColor: `${color}40`, background: `linear-gradient(135deg, ${color}26, ${color}0a 58%, rgba(255,255,255,0.02))` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color }}>{label}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
          <Icon size={14} style={{ color }} />
        </span>
      </div>
      <div className="mt-3 text-[30px] font-semibold leading-none tabular-nums" style={{ color: '#fafaf9' }}>
        {value}
      </div>
    </div>
  );
}
