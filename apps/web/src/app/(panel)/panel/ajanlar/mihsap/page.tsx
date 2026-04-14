'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/agents';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Play, Calendar, Users, Search, CheckCircle2, AlertCircle, Loader2, Clock, Sparkles,
  Receipt, ArrowRight, Zap, ChevronDown, X,
} from 'lucide-react';
import { LogCard, LogEvent } from '../_components/LogCard';

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
  const [action, setAction] = useState<'isle_alis' | 'isle_satis'>('isle_alis');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

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
    queryFn: () => agentsApi.listCommands({ agent: 'mihsap', limit: 10 }),
    refetchInterval: 3000,
  });
  const { data: events = [] } = useQuery<LogEvent[]>({
    queryKey: ['agent-events', 'mihsap'],
    queryFn: () =>
      api.get('/agent/events', { params: { agent: 'mihsap', limit: 100 } }).then((r) => r.data),
    refetchInterval: 3000,
  });

  const statusInfo: any = status.find((s: any) => s.agent === 'mihsap');
  const calisiyor = statusInfo?.running === true;
  const mihsapTaxpayers = taxpayers.filter((t) => t.mihsapId);
  const filtered = mihsapTaxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

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

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recentEvents = events.filter((e) => e.ts >= dayAgo);
  const kpi = {
    onay: recentEvents.filter((e) => e.status === 'ok' || e.status === 'onaylandi').length,
    atla: recentEvents.filter((e) => e.status === 'skip' || e.status === 'atlandi').length,
    hata: recentEvents.filter((e) => e.status === 'error' || e.status === 'hata').length,
  };

  const selectedNames = selectedIds
    .map((id) => taxpayers.find((t) => t.id === id))
    .filter(Boolean) as Taxpayer[];

  return (
    <div className="space-y-5">
      {/* HERO */}
      <div
        className="relative rounded-2xl overflow-hidden p-6 border"
        style={{
          background:
            'linear-gradient(135deg, rgba(184,160,111,.12) 0%, rgba(139,118,73,.06) 100%)',
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
              <div className="text-[10px] uppercase font-bold tracking-widest mb-1" style={{ color: '#b8a06f' }}>
                <Sparkles size={10} className="inline mr-1" /> Claude Haiku 4.5
              </div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
                Mihsap Fatura İşleyici
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Bekleyen alış/satış faturalarını OCR ile okur, kodlarla karşılaştırır, karar verir
              </p>
            </div>
          </div>
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

        <div className="relative grid grid-cols-3 gap-3 mt-5">
          <KpiMini label="Son 24s Onay" value={kpi.onay} color="#22c55e" />
          <KpiMini label="Son 24s Atla" value={kpi.atla} color="#f59e0b" />
          <KpiMini label="Son 24s Hata" value={kpi.hata} color="#ef4444" />
        </div>
      </div>

      {/* KOMUT BARI (kompakt, tek satır) */}
      <div
        className="rounded-xl border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              type="month"
              value={ay}
              onChange={(e) => setAy(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-sm border outline-none"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setAction('isle_alis')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
              style={{
                background: action === 'isle_alis' ? 'rgba(5,150,105,.12)' : 'var(--bg)',
                borderColor: action === 'isle_alis' ? '#059669' : 'var(--border)',
                color: action === 'isle_alis' ? '#059669' : 'var(--text)',
              }}
            >
              ALIŞ
            </button>
            <button
              onClick={() => setAction('isle_satis')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
              style={{
                background: action === 'isle_satis' ? 'rgba(37,99,235,.12)' : 'var(--bg)',
                borderColor: action === 'isle_satis' ? '#2563eb' : 'var(--border)',
                color: action === 'isle_satis' ? '#2563eb' : 'var(--text)',
              }}
            >
              SATIŞ
            </button>
          </div>

          {/* Mükellef seçici butonu */}
          <button
            onClick={() => setPickerOpen(true)}
            className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg text-sm border flex items-center gap-2 text-left hover:brightness-110 transition"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Users size={13} style={{ color: 'var(--text-muted)' }} />
            <span className="flex-1 truncate">
              {selectedIds.length === 0
                ? 'Mükellef seç…'
                : selectedIds.length === 1
                ? taxpayerName(selectedNames[0])
                : `${selectedIds.length} mükellef`}
            </span>
            <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
          </button>

          <button
            onClick={() => runMut.mutate()}
            disabled={selectedIds.length === 0 || runMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
            style={{
              background: selectedIds.length > 0 ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'var(--muted)',
              color: selectedIds.length > 0 ? '#0f0d0b' : 'var(--text-muted)',
              boxShadow: selectedIds.length > 0 ? '0 4px 12px rgba(184,160,111,.25)' : 'none',
            }}
          >
            {runMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Çalıştır
          </button>
        </div>

        {/* Seçili mükellef chip'leri (1'den fazlaysa) */}
        {selectedIds.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            {selectedNames.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(184,160,111,.1)', color: '#b8a06f' }}
              >
                {taxpayerName(t)}
                <button
                  onClick={() => setSelectedIds(selectedIds.filter((x) => x !== t.id))}
                  className="hover:opacity-70"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Son komut durumu */}
        {commands[0] && (
          <div className="text-[11px] mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            <Clock size={10} />
            Son komut: <strong>{commands[0].status}</strong> · {new Date(commands[0].createdAt).toLocaleString('tr-TR')}
            {commands[0].result?.message && <span className="ml-2">{commands[0].result.message}</span>}
          </div>
        )}
      </div>

      {/* CANLI LOG FEED */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Zap size={14} style={{ color: '#b8a06f' }} /> Canlı İşlem Akışı
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Son {events.length} işlem — 3 saniyede bir yenilenir
            </p>
          </div>
          <Link
            href="/panel/ajanlar/loglar?agent=mihsap"
            className="text-xs inline-flex items-center gap-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Tümü <ArrowRight size={11} />
          </Link>
        </div>
        <div className="p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
              Henüz işlem yok. Bir komut çalıştırdığında buraya akar.
            </div>
          ) : (
            events.map((e) => <LogCard key={e.id} event={e} />)
          )}
        </div>
      </div>

      {/* MÜKELLEF PICKER MODAL */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border p-4 max-h-[80vh] flex flex-col"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold" style={{ color: 'var(--text)' }}>Mükellef Seç</h3>
              <button onClick={() => setPickerOpen(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border mb-3"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Ara…"
                autoFocus
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {selectedIds.length}/{mihsapTaxpayers.length}
              </span>
            </div>
            <div className="flex gap-2 mb-2 text-xs">
              <button
                onClick={() => setSelectedIds(filtered.map((t) => t.id))}
                className="px-2.5 py-1 rounded"
                style={{ background: 'rgba(184,160,111,.12)', color: '#b8a06f' }}
              >
                Filtreli hepsini seç
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1 rounded"
                style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}
              >
                Temizle
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {filtered.length === 0 ? (
                <div className="text-xs p-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  Sonuç yok
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
            <button
              onClick={() => setPickerOpen(false)}
              className="mt-3 w-full py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#b8a06f', color: '#0f0d0b' }}
            >
              Tamam ({selectedIds.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiMini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg p-3 border"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-1" style={{ color }}>
        {value.toLocaleString('tr-TR')}
      </div>
    </div>
  );
}
