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
  type ActionKey = 'isle_alis' | 'isle_satis' | 'isle_alis_isletme' | 'isle_satis_isletme';
  // Çoklu seçim — aynı defter (Bilanço veya İşletme) içinde Alış+Satış birlikte seçilebilir.
  // Farklı defter karışımı engelli (Mihsap URL'si farklı, runner aynı session içinde geçemez).
  const [actions, setActions] = useState<ActionKey[]>(['isle_alis']);

  const toggleAction = (a: ActionKey) => {
    const isIsletme = (k: ActionKey) => k.endsWith('_isletme');
    setActions((prev) => {
      // Zaten seçili → kaldır (en az bir seçili kalmalı)
      if (prev.includes(a)) {
        const next = prev.filter((x) => x !== a);
        return next.length > 0 ? next : prev;
      }
      // Defter karışımı engelle: yeni seçim mevcut defter ailesinden farklıysa, eskiyi sıfırla
      const yeniIsletme = isIsletme(a);
      const mevcutIsletme = prev.length > 0 ? isIsletme(prev[0]) : yeniIsletme;
      if (yeniIsletme !== mevcutIsletme) return [a];
      return [...prev, a];
    });
  };
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

  // Ay bazında mükellef başına işlenen fatura özeti (portal üzerinden sistem içi işlemler)
  type MukellefSummaryItem = {
    mukellef: string;
    alis: number;
    satis: number;
    atlanan: number;
    toplam: number;
    maliyetUsd?: number;
  };
  type MukellefSummary = {
    period: { year: number; month: number };
    toplam: { alis: number; satis: number; toplam: number; mukellefSayisi: number; maliyetUsd?: number };
    items: MukellefSummaryItem[];
  };
  const { data: mukellefSummary } = useQuery<MukellefSummary>({
    queryKey: ['agent-events-summary', 'mihsap', ay],
    queryFn: () => {
      const [yStr, mStr] = ay.split('-');
      return api
        .get('/agent/events/summary-by-mukellef', {
          params: { agent: 'mihsap', year: yStr, month: mStr },
        })
        .then((r) => r.data);
    },
    refetchInterval: 5000,
  });

  const statusInfo: any = status.find((s: any) => s.agent === 'mihsap');
  const calisiyor = statusInfo?.running === true;
  const mihsapTaxpayers = taxpayers.filter((t) => t.mihsapId);
  const filtered = mihsapTaxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  const runMut = useMutation({
    mutationFn: async () => {
      // Çoklu action — her biri için ayrı komut sırayla oluştur
      const mukellefler = selectedIds
        .map((id) => taxpayers.find((t) => t.id === id))
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          ad: taxpayerName(t),
          mihsapId: t.mihsapId,
          mihsapDefterTuru: t.mihsapDefterTuru,
        }));
      const sonuclar: any[] = [];
      for (const a of actions) {
        const r = await agentsApi.createCommand({
          agent: 'mihsap',
          action: a,
          payload: { ay, mukellefIds: selectedIds, mukellefler },
        });
        sonuclar.push(r);
      }
      return sonuclar;
    },
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
              Defter / İşlem <span style={{ color: 'rgba(250,250,249,0.35)', fontWeight: 400, textTransform: 'none' }}>(çoklu seçim — aynı defter ailesinde)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => toggleAction('isle_alis')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: actions.includes('isle_alis') ? 'rgba(5,150,105,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: actions.includes('isle_alis') ? '#059669' : 'rgba(255,255,255,0.05)',
                  color: actions.includes('isle_alis') ? '#059669' : '#fafaf9',
                }}
              >
                BİLANÇO · ALIŞ
              </button>
              <button
                onClick={() => toggleAction('isle_satis')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: actions.includes('isle_satis') ? 'rgba(37,99,235,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: actions.includes('isle_satis') ? '#2563eb' : 'rgba(255,255,255,0.05)',
                  color: actions.includes('isle_satis') ? '#2563eb' : '#fafaf9',
                }}
              >
                BİLANÇO · SATIŞ
              </button>
              <button
                onClick={() => toggleAction('isle_alis_isletme')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: actions.includes('isle_alis_isletme') ? 'rgba(168,85,247,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: actions.includes('isle_alis_isletme') ? '#a855f7' : 'rgba(255,255,255,0.05)',
                  color: actions.includes('isle_alis_isletme') ? '#a855f7' : '#fafaf9',
                }}
              >
                İŞLETME · ALIŞ
              </button>
              <button
                onClick={() => toggleAction('isle_satis_isletme')}
                className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                style={{
                  background: actions.includes('isle_satis_isletme') ? 'rgba(234,88,12,.15)' : 'rgba(255,255,255,0.03)',
                  borderColor: actions.includes('isle_satis_isletme') ? '#ea580c' : 'rgba(255,255,255,0.05)',
                  color: actions.includes('isle_satis_isletme') ? '#ea580c' : '#fafaf9',
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

      {/* MÜKELLEF BAZINDA AYLIK ÖZET — portal üzerinden işlenen fatura sayıları */}
      <MukellefIslemOzeti
        ay={ay}
        summary={mukellefSummary}
        mihsapTaxpayers={mihsapTaxpayers}
        taxpayerName={taxpayerName}
      />

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

/** Seçili ayda her mükellef için portal üzerinden işlenen alış/satış fatura sayıları.
 *  Hangi mükellefin ne kadarını sistem üzerinden, ne kadarını manuel işlediğini görmek için. */
function MukellefIslemOzeti({
  ay,
  summary,
  mihsapTaxpayers,
  taxpayerName,
}: {
  ay: string;
  summary: any;
  mihsapTaxpayers: Taxpayer[];
  taxpayerName: (t: Taxpayer) => string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const AYLAR_TR = [
    'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
    'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
  ];
  const [yStr, mStr] = ay.split('-');
  const ayEtiket = `${AYLAR_TR[parseInt(mStr, 10) - 1] || ''} ${yStr}`;

  // API'den gelen özet + mihsapId tanımlı olup henüz işlem GÖRMEMİŞ mükellefleri birleştir.
  // Böylece 0 işlem gören mükellefler de listede olur.
  type Row = { mukellef: string; alis: number; satis: number; atlanan: number; toplam: number; maliyetUsd?: number };
  const items: Row[] = summary?.items || [];
  const islenenSet = new Set(items.map((i) => i.mukellef));
  const islenmeyen: Row[] = mihsapTaxpayers
    .map(taxpayerName)
    .filter((ad) => ad && !islenenSet.has(ad))
    .map((mukellef) => ({ mukellef, alis: 0, satis: 0, atlanan: 0, toplam: 0, maliyetUsd: 0 }));

  // Alfabetik sıralama (Türkçe locale): işlem gören + görmeyen tek listede.
  const tumu = [...items, ...islenmeyen].sort((a, b) =>
    a.mukellef.localeCompare(b.mukellef, 'tr', { sensitivity: 'base' }),
  );
  const filtreli = searchQuery
    ? tumu.filter((i) => i.mukellef.toLowerCase().includes(searchQuery.toLowerCase()))
    : tumu;
  const goruntulenen = showAll ? filtreli : filtreli.slice(0, 20);

  const toplamAlis = summary?.toplam?.alis ?? 0;
  const toplamSatis = summary?.toplam?.satis ?? 0;
  const toplamMaliyetUsd = summary?.toplam?.maliyetUsd ?? 0;
  const islemGorenAdedi = items.length;
  const islemGormeyenAdedi = islenmeyen.length;
  const fmtUsd = (v: number) =>
    `$${(v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between p-4 border-b flex-wrap gap-3" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div>
          <h2 className="font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <Users size={14} style={{ color: '#b8a06f' }} /> Mükellef Bazında İşlem Özeti — {ayEtiket}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Portal üzerinden işlenen fatura sayıları — manuel işlenenler bu listede görünmez
          </p>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Mükellef ara..."
            className="pl-8 pr-3 py-2 text-[12.5px] rounded-lg outline-none"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fafaf9',
              minWidth: 220,
            }}
          />
        </div>
      </div>

      {/* TOPLAM ŞERİDİ */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-px"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      >
        <OzetHucre label="Dönemde İşlem Gören" value={islemGorenAdedi} alt={`toplam ${mihsapTaxpayers.length} mükellef`} color="#d4b876" />
        <OzetHucre label="İşlem Görmeyen" value={islemGormeyenAdedi} alt={islemGormeyenAdedi > 0 ? 'manuel ya da eksik' : ''} color="#f59e0b" />
        <OzetHucre label="Toplam Alış" value={toplamAlis} alt="fatura" color="#059669" />
        <OzetHucre label="Toplam Satış" value={toplamSatis} alt="fatura" color="#2563eb" />
        <OzetHucre label="Toplam Maliyet" valueText={fmtUsd(toplamMaliyetUsd)} alt="AI kullanımı" color="#a78bfa" />
      </div>

      {/* TABLO */}
      {filtreli.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {searchQuery ? 'Aramayla eşleşen mükellef yok' : 'Bu dönem için işlem kaydı bulunamadı'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Mükellef</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Alış</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Satış</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Atlanan</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Toplam</th>
                <th className="text-right px-4 py-2.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {goruntulenen.map((row, i) => {
                // Toplam ETKİLEŞİM = alış + satış + atlanan (her biri bir işlemdir).
                // "İşlem yok" badge'i: hiçbir kayıt yoksa.
                const tumToplam = row.alis + row.satis + row.atlanan;
                const islemYok = tumToplam === 0;
                return (
                <tr
                  key={row.mukellef}
                  className="transition-all"
                  style={{
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                    background: islemYok ? 'rgba(245,158,11,0.02)' : 'transparent',
                  }}
                >
                  <td className="px-4 py-2.5">
                    <span style={{ color: islemYok ? 'rgba(250,250,249,0.55)' : '#fafaf9', fontWeight: 500 }}>
                      {row.mukellef}
                    </span>
                    {islemYok && (
                      <span
                        className="ml-2 inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase"
                        style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
                      >
                        İşlem yok
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: row.alis > 0 ? '#059669' : 'rgba(250,250,249,0.3)' }}>
                    {row.alis}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: row.satis > 0 ? '#2563eb' : 'rgba(250,250,249,0.3)' }}>
                    {row.satis}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: row.atlanan > 0 ? '#f59e0b' : 'rgba(250,250,249,0.3)' }}>
                    {row.atlanan}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ color: tumToplam > 0 ? '#d4b876' : 'rgba(250,250,249,0.3)' }}>
                    {tumToplam}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: (row.maliyetUsd ?? 0) > 0 ? '#a78bfa' : 'rgba(250,250,249,0.3)' }}>
                    {fmtUsd(row.maliyetUsd ?? 0)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {filtreli.length > 20 && (
            <div className="text-center py-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-[12px] font-medium hover:opacity-80 transition-all"
                style={{ color: '#b8a06f' }}
              >
                {showAll ? `İlk 20'yi göster` : `Tümünü göster (${filtreli.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OzetHucre({
  label, value, valueText, alt, color,
}: {
  label: string;
  value?: number;
  valueText?: string;
  alt: string;
  color: string;
}) {
  const display = valueText !== undefined ? valueText : (value ?? 0).toLocaleString('tr-TR');
  return (
    <div className="px-4 py-3" style={{ background: 'rgba(12,10,7,0.5)' }}>
      <div className="text-[10px] uppercase font-semibold tracking-wider mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>
          {display}
        </span>
        {alt && (
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
            {alt}
          </span>
        )}
      </div>
    </div>
  );
}
