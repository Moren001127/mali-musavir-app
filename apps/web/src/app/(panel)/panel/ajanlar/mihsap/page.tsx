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
  const [action, setAction] = useState<
    'isle_alis' | 'isle_satis' | 'isle_alis_isletme' | 'isle_satis_isletme'
  >('isle_alis');
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
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <Sparkles size={10} className="inline mr-1" /> Claude Haiku 4.5 · Ajan
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Mihsap Fatura İşleyici
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Bekleyen alış/satış faturalarını OCR ile okur, kodlarla karşılaştırır, karar verir
          </p>
        </div>
        {calisiyor ? (
          <span
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[12.5px] font-bold"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}
          >
            <Loader2 size={14} className="animate-spin" /> Runner Çalışıyor
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[12.5px] font-bold"
            style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.25)', color: '#d4b876' }}
          >
            <CheckCircle2 size={14} /> Hazır
          </span>
        )}
      </div>

      {/* KPI KARTLARI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <KpiMini label="Son 24s Onay" value={kpi.onay} color="#22c55e" icon="✓" />
        <KpiMini label="Son 24s Atla" value={kpi.atla} color="#f59e0b" icon="↷" />
        <KpiMini label="Son 24s Hata" value={kpi.hata} color="#ef4444" icon="✗" />
      </div>

      {/* KOMUT BARI */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-shrink-0">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <Calendar size={11} className="inline mr-1" /> Dönem
            </label>
            <input
              type="month"
              value={ay}
              onChange={(e) => setAy(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-base font-semibold border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9', minWidth: 170 }}
            />
          </div>

          <div className="flex-shrink-0">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Defter / İşlem
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setAction('isle_alis')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: action === 'isle_alis' ? 'rgba(5,150,105,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: action === 'isle_alis' ? '#059669' : 'rgba(255,255,255,0.05)',
                  color: action === 'isle_alis' ? '#059669' : '#fafaf9',
                }}
              >
                BİLANÇO · ALIŞ
              </button>
              <button
                onClick={() => setAction('isle_satis')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: action === 'isle_satis' ? 'rgba(37,99,235,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: action === 'isle_satis' ? '#2563eb' : 'rgba(255,255,255,0.05)',
                  color: action === 'isle_satis' ? '#2563eb' : '#fafaf9',
                }}
              >
                BİLANÇO · SATIŞ
              </button>
              <button
                onClick={() => setAction('isle_alis_isletme')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: action === 'isle_alis_isletme' ? 'rgba(168,85,247,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: action === 'isle_alis_isletme' ? '#a855f7' : 'rgba(255,255,255,0.05)',
                  color: action === 'isle_alis_isletme' ? '#a855f7' : '#fafaf9',
                }}
              >
                İŞLETME · ALIŞ
              </button>
              <button
                onClick={() => setAction('isle_satis_isletme')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: action === 'isle_satis_isletme' ? 'rgba(234,88,12,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: action === 'isle_satis_isletme' ? '#ea580c' : 'rgba(255,255,255,0.05)',
                  color: action === 'isle_satis_isletme' ? '#ea580c' : '#fafaf9',
                }}
              >
                İŞLETME · SATIŞ
              </button>
            </div>
          </div>

          <div className="flex-1 min-w-[240px]">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef ({selectedIds.length})
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border flex items-center gap-2 text-left hover:brightness-110 transition"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate font-medium">
                {selectedIds.length === 0
                  ? 'Mükellef seç…'
                  : selectedIds.length === 1
                  ? taxpayerName(selectedNames[0])
                  : `${selectedIds.length} mükellef seçili`}
              </span>
              <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            </button>
          </div>

          <div className="flex-shrink-0 flex items-end">
            <button
              onClick={() => runMut.mutate()}
              disabled={selectedIds.length === 0 || runMut.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{
                background: selectedIds.length > 0 ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)',
                color: selectedIds.length > 0 ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
                boxShadow: selectedIds.length > 0 ? '0 4px 12px rgba(184,160,111,.3)' : 'none',
                height: 42,
              }}
            >
              {runMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Çalıştır
            </button>
          </div>
        </div>

        {/* Seçili mükellef chip'leri (1'den fazlaysa) */}
        {selectedIds.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
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
          <div
            className="mt-4 pt-4 border-t flex items-start gap-3 flex-wrap"
            style={{ borderColor: 'rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background:
                    commands[0].status === 'done'
                      ? 'rgba(34,197,94,.15)'
                      : commands[0].status === 'failed'
                      ? 'rgba(239,68,68,.15)'
                      : 'rgba(245,158,11,.15)',
                  color:
                    commands[0].status === 'done'
                      ? '#22c55e'
                      : commands[0].status === 'failed'
                      ? '#ef4444'
                      : '#f59e0b',
                }}
              >
                <Clock size={14} />
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Son Komut
                </div>
                <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
                  {commands[0].status === 'done'
                    ? 'Tamamlandı'
                    : commands[0].status === 'failed'
                    ? 'Başarısız'
                    : commands[0].status === 'running'
                    ? 'Çalışıyor'
                    : 'Beklemede'}
                  <span className="text-xs ml-2 font-normal" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    {new Date(commands[0].createdAt).toLocaleString('tr-TR')}
                  </span>
                </div>
              </div>
            </div>
            {commands[0].result?.message && (
              <div className="flex-1 min-w-[200px] text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', color: '#fafaf9' }}>
                {commands[0].result.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CANLI LOG FEED */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <div>
            <h2 className="font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
              <Zap size={14} style={{ color: '#b8a06f' }} /> Canlı İşlem Akışı
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Son {events.length} işlem — 3 saniyede bir yenilenir
            </p>
          </div>
          <Link
            href="/panel/ajanlar/loglar?agent=mihsap"
            className="text-xs inline-flex items-center gap-1"
            style={{ color: 'rgba(250,250,249,0.45)' }}
          >
            Tümü <ArrowRight size={11} />
          </Link>
        </div>
        <div className="p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
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
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]"
          style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            style={{
              // --card alias'ı globals.css'te tanımlı olsa da, herhangi bir
              // build sırasında CSS'in gelmesinden önce modal render edilirse
              // transparan görünüyordu. İki katmanlı fallback: önce --card-bg
              // (her temada tanımlı solid renk), sonra --card, sonra beyaz.
              background: 'rgba(17,14,12,0.98)',
              borderColor: 'rgba(255,255,255,0.05)',
              maxHeight: '84vh',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'linear-gradient(135deg, rgba(184,160,111,.08), transparent)' }}
            >
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>
                  Mükellef Seç
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Mihsap ID tanımlı {mihsapTaxpayers.length} mükellef · {selectedIds.length} seçili
                </p>
              </div>
              <button
                onClick={() => setPickerOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Search + bulk actions */}
            <div className="px-5 py-3 border-b space-y-2.5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}
              >
                <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <input
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Mükellef adı ara…"
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: '#fafaf9' }}
                />
                {pickerSearch && (
                  <button
                    onClick={() => setPickerSearch('')}
                    style={{ color: 'rgba(250,250,249,0.45)' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setSelectedIds(filtered.map((t) => t.id))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium"
                  style={{ background: 'rgba(184,160,111,.15)', color: '#b8a06f' }}
                >
                  ✓ Filtreli hepsini seç ({filtered.length})
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-2.5 py-1 rounded-md"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.45)' }}
                >
                  Temizle
                </button>
                <span className="ml-auto" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {filtered.length} sonuç
                </span>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="text-sm p-8 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Sonuç yok
                </div>
              ) : (
                filtered.map((t) => {
                  const checked = selectedIds.includes(t.id);
                  const name = taxpayerName(t);
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-colors"
                      style={{
                        background: checked ? 'rgba(184,160,111,.08)' : 'transparent',
                        color: '#fafaf9',
                      }}
                      onMouseEnter={(e) => {
                        if (!checked) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)';
                      }}
                      onMouseLeave={(e) => {
                        if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds([...selectedIds, t.id]);
                          else setSelectedIds(selectedIds.filter((x) => x !== t.id));
                        }}
                        className="w-4 h-4"
                      />
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: checked
                            ? 'linear-gradient(135deg, #b8a06f, #8b7649)'
                            : 'rgba(255,255,255,0.05)',
                          color: checked ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
                        }}
                      >
                        {initial}
                      </div>
                      <span className="flex-1 truncate font-medium">{name}</span>
                      {t.mihsapId && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded tabular-nums"
                          style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.45)' }}
                        >
                          #{t.mihsapId}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div
              className="px-5 py-3 border-t flex items-center gap-3"
              style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)' }}
            >
              <button
                onClick={() => {
                  setSelectedIds([]);
                  setPickerOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                İptal
              </button>
              <button
                onClick={() => setPickerOpen(false)}
                disabled={selectedIds.length === 0}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                style={{
                  background: selectedIds.length > 0
                    ? 'linear-gradient(135deg, #b8a06f, #8b7649)'
                    : 'rgba(255,255,255,0.05)',
                  color: selectedIds.length > 0 ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
                }}
              >
                {selectedIds.length} Mükellef ile Devam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiMini({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div
      className="rounded-xl p-4 border flex items-center gap-4"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold flex-shrink-0"
        style={{ background: color + '18', color }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {label}
        </div>
        <div className="text-3xl font-bold tabular-nums leading-none mt-1" style={{ color }}>
          {value.toLocaleString('tr-TR')}
        </div>
      </div>
    </div>
  );
}
