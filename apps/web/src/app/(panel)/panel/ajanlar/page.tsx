'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi, AGENTS, AgentStatus, AgentCommand } from '@/lib/agents';
import { api } from '@/lib/api';
import { Bot, Play, Square, Activity, Calendar, Users, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react';
import Link from 'next/link';

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  lucaSlug?: string | null;
  mihsapId?: string | null;
  mihsapDefterTuru?: string | null;
}

function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function AjanlarPage() {
  const { data: status = [] } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => agentsApi.status(),
    refetchInterval: 5000,
  });
  const { data: stats } = useQuery({
    queryKey: ['agent-stats'],
    queryFn: () => agentsApi.stats(),
    refetchInterval: 10000,
  });
  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });
  const { data: commands = [] } = useQuery({
    queryKey: ['agent-commands'],
    queryFn: () => agentsApi.listCommands({ limit: 20 }),
    refetchInterval: 3000,
  });

  const statusMap = new Map(status.map((s) => [s.agent, s]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            Otomasyon Ajanları
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Mükellef seçip ajanları çalıştırın — tüm işlemler canlı loglanır
          </p>
        </div>
        <Link
          href="/panel/ajanlar/loglar"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--navy-500)', color: 'white' }}
        >
          <Activity size={15} />
          Yapılan İşlemler
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatBox label="Bu Ay İşlenen" value={stats?.buAy ?? 0} color="#059669" />
        <StatBox label="Bugün Log" value={stats?.buGun ?? 0} color="#1e40af" />
        <StatBox label="Hata (24 saat)" value={stats?.hataBugun ?? 0} color="#dc2626" />
        <StatBox label="Bekleyen Komut" value={commands.filter((c) => c.status === 'pending' || c.status === 'running').length} color="#d97706" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {AGENTS.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            statusInfo={statusMap.get(a.id)}
            taxpayers={taxpayers}
          />
        ))}
      </div>

      <div
        className="rounded-xl border"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>Son Komutlar</h2>
        </div>
        {commands.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Henüz komut gönderilmedi
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {commands.map((c) => (
              <CommandRow key={c.id} command={c} taxpayers={taxpayers} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  statusInfo,
  taxpayers,
}: {
  agent: (typeof AGENTS)[number];
  statusInfo?: AgentStatus;
  taxpayers: Taxpayer[];
}) {
  const qc = useQueryClient();
  const [ay, setAy] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const runMut = useMutation({
    mutationFn: (action: string) =>
      agentsApi.createCommand({
        agent: agent.id,
        action,
        payload: {
          ay,
          mukellefIds: selectedIds,
          mukellefler: selectedIds
            .map((id) => taxpayers.find((t) => t.id === id))
            .filter(Boolean)
            .map((t: any) => ({
              id: t.id,
              ad: taxpayerName(t),
              lucaSlug: t.lucaSlug,
              mihsapId: t.mihsapId,
              mihsapDefterTuru: t.mihsapDefterTuru,
            })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-commands'] });
    },
  });

  const calisiyor = statusInfo?.running === true;
  const filtered = taxpayers.filter(
    (t) =>
      taxpayerName(t).toLowerCase().includes(search.toLowerCase()) &&
      (agent.id === 'luca' ? t.lucaSlug : agent.id === 'mihsap' ? t.mihsapId : true),
  );

  return (
    <div
      className="rounded-xl p-5 border"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: agent.aktif ? 'rgba(55,48,163,.1)' : 'var(--muted)',
              color: agent.aktif ? '#3730a3' : 'var(--text-muted)',
            }}
          >
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate" style={{ color: 'var(--text)' }}>
              {agent.ad}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {agent.desc}
            </div>
          </div>
        </div>
        <AgentBadge calisiyor={calisiyor} aktif={agent.aktif} />
      </div>

      {agent.aktif && (
        <div className="space-y-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={11} className="inline mr-1" />
                Hedef Ay
              </label>
              <input
                type="month"
                value={ay}
                onChange={(e) => setAy(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-sm border outline-none"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <Users size={11} className="inline mr-1" />
                Mükellef ({selectedIds.length})
              </label>
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="w-full px-3 py-1.5 rounded-lg text-sm border text-left outline-none truncate"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                {selectedIds.length === 0
                  ? 'Mükellef seç...'
                  : selectedIds.length === 1
                  ? taxpayerName(taxpayers.find((t) => t.id === selectedIds[0])!)
                  : `${selectedIds.length} mükellef seçili`}
              </button>
            </div>
          </div>

          {pickerOpen && (
            <div
              className="rounded-lg border p-2 max-h-56 overflow-y-auto"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara..."
                className="w-full px-2 py-1 text-sm border rounded mb-2 outline-none"
                style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
              <div className="flex items-center gap-2 mb-1 pb-1 border-b text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                <button
                  onClick={() => setSelectedIds(filtered.map((t) => t.id))}
                  className="px-2 py-0.5 rounded hover:opacity-80"
                  style={{ background: 'var(--navy-50, rgba(55,48,163,.08))', color: 'var(--navy-500, #3730a3)' }}
                >
                  Hepsi
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-2 py-0.5 rounded hover:opacity-80"
                  style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}
                >
                  Temizle
                </button>
                <span className="ml-auto">
                  {filtered.length} / {taxpayers.length}
                </span>
              </div>
              {filtered.length === 0 ? (
                <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>
                  Bu ajan için uygun mükellef yok.{' '}
                  <Link href="/panel/mukellefler" className="underline">
                    Mükellefler sayfasından
                  </Link>{' '}
                  {agent.id === 'luca' ? 'Luca slug' : 'Mihsap ID'} değerini ekleyin.
                </div>
              ) : (
                filtered.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-black/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds([...selectedIds, t.id]);
                        else setSelectedIds(selectedIds.filter((x) => x !== t.id));
                      }}
                    />
                    <span className="flex-1" style={{ color: 'var(--text)' }}>
                      {taxpayerName(t)}
                    </span>
                    {agent.id === 'luca' && t.lucaSlug && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {t.lucaSlug}
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => runMut.mutate('isle')}
              disabled={selectedIds.length === 0 || runMut.isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
              style={{
                background: selectedIds.length > 0 ? '#059669' : 'var(--muted)',
                color: selectedIds.length > 0 ? 'white' : 'var(--text-muted)',
                opacity: runMut.isPending ? 0.6 : 1,
              }}
            >
              <Play size={14} />
              {runMut.isPending ? 'Gönderiliyor...' : 'Şimdi İşle'}
            </button>
            {calisiyor && (
              <button
                onClick={() => runMut.mutate('durdur')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'rgba(239,68,68,.1)', color: '#dc2626' }}
              >
                <Square size={14} />
                Durdur
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs pt-3 mt-3 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        {statusInfo?.hedefAy && <span>Son ay: <strong>{statusInfo.hedefAy}</strong></span>}
        {statusInfo?.lastPing && (
          <span>
            <Clock size={10} className="inline mr-1" />
            {new Date(statusInfo.lastPing).toLocaleString('tr-TR')}
          </span>
        )}
        {!statusInfo && <span>Yerel runner henüz ping atmadı</span>}
      </div>
    </div>
  );
}

function AgentBadge({ calisiyor, aktif }: { calisiyor: boolean; aktif: boolean }) {
  if (!aktif) {
    return <Badge text="Yakında" bg="var(--muted)" color="var(--text-muted)" />;
  }
  if (calisiyor) {
    return <Badge text="Çalışıyor" bg="rgba(16,185,129,.15)" color="#059669" icon={<Loader2 size={11} className="animate-spin" />} />;
  }
  return <Badge text="Hazır" bg="rgba(55,48,163,.1)" color="#3730a3" />;
}

function Badge({ text, bg, color, icon }: { text: string; bg: string; color: string; icon?: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
      style={{ background: bg, color }}
    >
      {icon}
      {text}
    </span>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
      </div>
    </div>
  );
}

function CommandRow({ command, taxpayers }: { command: AgentCommand; taxpayers: Taxpayer[] }) {
  const { icon: Icon, color } = statusIconFor(command.status);
  const ts = new Date(command.createdAt).toLocaleString('tr-TR');
  const payload = command.payload || {};
  const mukellefAds: string[] = Array.isArray(payload.mukellefler)
    ? payload.mukellefler.map((m: any) => m.ad).filter(Boolean)
    : Array.isArray(payload.mukellefIds)
    ? payload.mukellefIds.map((id: string) => {
        const t = taxpayers.find((x) => x.id === id);
        return t ? taxpayerName(t) : id;
      })
    : [];
  return (
    <div className="flex items-start gap-3 p-3 text-sm">
      <Icon size={18} style={{ color }} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color: 'var(--text)' }}>
            {command.agent.toUpperCase()} · {command.action}
          </span>
          {payload.ay && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}>
              {payload.ay}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
            {command.status}
          </span>
        </div>
        {mukellefAds.length > 0 && (
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Mükellefler: {mukellefAds.slice(0, 3).join(', ')}
            {mukellefAds.length > 3 ? ` +${mukellefAds.length - 3}` : ''}
          </div>
        )}
        {command.result?.message && (
          <div className="text-xs mt-1" style={{ color }}>
            {command.result.message}
          </div>
        )}
      </div>
      <div className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
        {ts}
      </div>
    </div>
  );
}

function statusIconFor(status: string) {
  switch (status) {
    case 'done':
      return { icon: CheckCircle2, color: '#059669' };
    case 'failed':
      return { icon: AlertCircle, color: '#dc2626' };
    case 'running':
      return { icon: Loader2, color: '#1e40af' };
    default:
      return { icon: Clock, color: '#d97706' };
  }
}
