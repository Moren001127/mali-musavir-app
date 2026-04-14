'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/agents';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Bot, Play, Calendar, Users, Search, CheckCircle2, AlertCircle, Loader2, Clock, Sparkles,
  Receipt, ArrowRight, Zap,
} from 'lucide-react';

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  mihsapId?: string | null;
  mihsapDefterTuru?: string | null;
}
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function MihsapAgentPage() {
  const qc = useQueryClient();
  const [ay, setAy] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<'isle_alis' | 'isle_satis'>('isle_alis');

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });
  const { data: status = [] } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => agentsApi.status(),
    refetchInterval: 5000,
  });
  const { data: commands = [] } = useQuery({
    queryKey: ['agent-commands', 'mihsap'],
    queryFn: () => agentsApi.listCommands({ agent: 'mihsap', limit: 15 }),
    refetchInterval: 3000,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['agent-events', 'mihsap'],
    queryFn: () =>
      api.get('/agent/events', { params: { agent: 'mihsap', limit: 30 } }).then((r) => r.data),
    refetchInterval: 3000,
  });

  const statusInfo = status.find((s: any) => s.agent === 'mihsap');
  const calisiyor = statusInfo?.running === true;
  const filtered = taxpayers
    .filter((t) => t.mihsapId)
    .filter((t) => taxpayerName(t).toLowerCase().includes(search.toLowerCase()));

  const runMut = useMutation({
    mutationFn: () =>
      agentsApi.createCommand({
        agent: 'mihsap',
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
              mihsapId: t.mihsapId,
              mihsapDefterTuru: t.mihsapDefterTuru,
            })),
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-commands'] }),
  });

  // Son 24 saat Mihsap istatistikleri
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recentEvents = events.filter((e: any) => e.ts >= dayAgo);
  const kpi = {
    onay: recentEvents.filter((e: any) => e.status === 'ok' || e.status === 'onaylandi').length,
    atla: recentEvents.filter((e: any) => e.status === 'skip' || e.status === 'atlandi').length,
    hata: recentEvents.filter((e: any) => e.status === 'error' || e.status === 'hata').length,
  };

  return (
    <div className="space-y-5">
      {/* HERO */}
      <div
        className="relative rounded-2xl overflow-hidden p-7 border"
        style={{
          background:
            'linear-gradient(135deg, rgba(184,160,111,.08) 0%, rgba(14,165,233,.05) 50%, rgba(99,102,241,.08) 100%)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #b8a06f, transparent 70%)' }} />
        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #b8a06f, #8b7649)',
                boxShadow: '0 6px 20px rgba(184,160,111,.4)',
              }}
            >
              <Receipt size={26} style={{ color: '#0f0d0b' }} strokeWidth={2} />
            </div>
            <div>
              <div className="text-xs uppercase font-semibold tracking-widest mb-1" style={{ color: '#b8a06f' }}>
                <Sparkles size={10} className="inline mr-1" /> Claude Haiku 4.5
              </div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
                Mihsap Fatura İşleyici
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Bekleyen alış/satış faturalarını OCR ile okur, hesap kodları ile karşılaştırır, karar verir
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {calisiyor ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(16,185,129,.15)', color: '#059669' }}
              >
                <Loader2 size={12} className="animate-spin" /> Runner Çalışıyor
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(55,48,163,.1)', color: '#3730a3' }}
              >
                <CheckCircle2 size={12} /> Hazır
              </span>
            )}
          </div>
        </div>

        {/* Mini KPI */}
        <div className="relative grid grid-cols-3 gap-3 mt-6">
          <KpiMini label="Son 24s Onay" value={kpi.onay} color="#22c55e" icon={CheckCircle2} />
          <KpiMini label="Son 24s Atla" value={kpi.atla} color="#f59e0b" icon={ArrowRight} />
          <KpiMini label="Son 24s Hata" value={kpi.hata} color="#ef4444" icon={AlertCircle} />
        </div>
      </div>

      {/* KOMUT PANELİ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-xl border p-5"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Zap size={16} style={{ color: '#b8a06f' }} /> Yeni Komut
          </h2>

          {/* Ay + Tip */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={11} className="inline mr-1" /> Hedef Ay
              </label>
              <input
                type="month"
                value={ay}
                onChange={(e) => setAy(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
                İşlem Türü
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setAction('isle_alis')}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium border"
                  style={{
                    background: action === 'isle_alis' ? 'rgba(5,150,105,.1)' : 'var(--bg)',
                    borderColor: action === 'isle_alis' ? '#059669' : 'var(--border)',
                    color: action === 'isle_alis' ? '#059669' : 'var(--text)',
                  }}
                >
                  Alış
                </button>
                <button
                  onClick={() => setAction('isle_satis')}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium border"
                  style={{
                    background: action === 'isle_satis' ? 'rgba(37,99,235,.1)' : 'var(--bg)',
                    borderColor: action === 'isle_satis' ? '#2563eb' : 'var(--border)',
                    color: action === 'isle_satis' ? '#2563eb' : 'var(--text)',
                  }}
                >
                  Satış
                </button>
              </div>
            </div>
          </div>

          {/* Mükellef seçici */}
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
            <Users size={11} className="inline mr-1" /> Mükellefler ({selectedIds.length}/{filtered.length})
          </label>
          <div
            className="rounded-lg border p-2"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text)' }}
              />
              <button
                onClick={() => setSelectedIds(filtered.map((t) => t.id))}
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'rgba(184,160,111,.1)', color: '#b8a06f' }}
              >
                Hepsi
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}
              >
                Temizle
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {filtered.length === 0 ? (
                <div className="text-xs p-3 text-center" style={{ color: 'var(--text-muted)' }}>
                  Mihsap ID tanımlı mükellef yok.{' '}
                  <Link href="/panel/mukellefler" className="underline">Mükelleflere git</Link>
                </div>
              ) : (
                filtered.map((t) => {
                  const checked = selectedIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer hover:bg-black/5"
                      style={{ color: 'var(--text)' }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds([...selectedIds, t.id]);
                          else setSelectedIds(selectedIds.filter((x) => x !== t.id));
                        }}
                      />
                      <span className="flex-1 truncate">{taxpayerName(t)}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {t.mihsapId}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <button
            onClick={() => runMut.mutate()}
            disabled={selectedIds.length === 0 || runMut.isPending}
            className="w-full mt-4 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{
              background: selectedIds.length > 0
                ? 'linear-gradient(135deg, #b8a06f, #8b7649)'
                : 'var(--muted)',
              color: selectedIds.length > 0 ? '#0f0d0b' : 'var(--text-muted)',
              boxShadow: selectedIds.length > 0 ? '0 4px 12px rgba(184,160,111,.3)' : 'none',
            }}
          >
            {runMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {action === 'isle_alis' ? 'Alış Faturalarını İşle' : 'Satış Faturalarını İşle'}
          </button>
        </div>

        {/* Son komutlar */}
        <div
          className="rounded-xl border p-4"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Clock size={16} style={{ color: '#b8a06f' }} /> Son Komutlar
          </h2>
          {commands.length === 0 ? (
            <div className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
              Henüz komut yok
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {commands.map((c: any) => (
                <CommandItem key={c.id} cmd={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiMini({ label, value, color, icon: Icon }: any) {
  return (
    <div
      className="rounded-xl p-3 border flex items-center gap-3"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, color }}
      >
        <Icon size={16} />
      </div>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className="text-lg font-bold tabular-nums" style={{ color }}>{value.toLocaleString('tr-TR')}</div>
      </div>
    </div>
  );
}

function CommandItem({ cmd }: { cmd: any }) {
  const status = cmd.status;
  const color = status === 'done' ? '#22c55e' : status === 'failed' ? '#ef4444' : status === 'running' ? '#3b82f6' : '#f59e0b';
  const Icon = status === 'done' ? CheckCircle2 : status === 'failed' ? AlertCircle : status === 'running' ? Loader2 : Clock;
  const mukAds = Array.isArray(cmd.payload?.mukellefler)
    ? cmd.payload.mukellefler.map((m: any) => m.ad).filter(Boolean)
    : [];
  return (
    <div
      className="rounded-lg p-2.5 border"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)', borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color }} className={status === 'running' ? 'animate-spin' : ''} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
          {cmd.action}
        </span>
        {cmd.payload?.ay && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}>
            {cmd.payload.ay}
          </span>
        )}
        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
          {new Date(cmd.createdAt).toLocaleTimeString('tr-TR')}
        </span>
      </div>
      {mukAds.length > 0 && (
        <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
          {mukAds.slice(0, 2).join(', ')}
          {mukAds.length > 2 ? ` +${mukAds.length - 2}` : ''}
        </div>
      )}
      {cmd.result?.message && (
        <div className="text-[11px] mt-1" style={{ color }}>
          {cmd.result.message}
        </div>
      )}
    </div>
  );
}
