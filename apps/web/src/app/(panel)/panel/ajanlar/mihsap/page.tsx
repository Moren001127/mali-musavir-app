'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/agents';
import { pendingDecisionsApi } from '@/lib/pending-decisions';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Play, Pause, Calendar, Users, Search, CheckCircle2, AlertCircle, Loader2, Clock,
  Receipt, ArrowRight, Zap, ChevronDown, X, AlertTriangle, Edit3, ThumbsUp, ThumbsDown,
  PlayCircle, Download, Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { LogCard, LogEvent } from '../_components/LogCard';

// Pause/Resume Button — agent durumunu portaldan kontrol eder.
// State: RUNNING (devam ediyor) / PAUSED (durdurulmuş)
// 5sn polling ile state'i takip eder, agent her mükellef arası bu state'i okur.
function AgentPauseResumeButton() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ controlState?: string; running?: boolean; lastPing?: string | null }>({
    queryKey: ['agent-control-state', 'mihsap'],
    queryFn: () => api.get('/agent/control/state?agent=mihsap').then((r) => r.data),
    refetchInterval: 5000,
  });
  const setMut = useMutation({
    mutationFn: (state: 'RUNNING' | 'PAUSED' | 'STOP') =>
      api.post('/agent/control/state', { agent: 'mihsap', state }).then((r) => r.data),
    onSuccess: (_, state) => {
      qc.invalidateQueries({ queryKey: ['agent-control-state', 'mihsap'] });
      toast.success(state === 'PAUSED' ? 'Agent durduruldu' : state === 'RUNNING' ? 'Agent devam ediyor' : 'Agent kapatıldı');
    },
    onError: (e: any) => toast.error(e?.message || 'Komut başarısız'),
  });
  const isPaused = (data?.controlState || 'RUNNING') === 'PAUSED';
  // Agent ping eski mi? (5 dk+) → "Agent kapalı" göster
  const lastPingMs = data?.lastPing ? new Date(data.lastPing).getTime() : 0;
  const stale = lastPingMs ? (Date.now() - lastPingMs) > 5 * 60 * 1000 : true;
  const offline = stale && !data?.running;

  if (isLoading) {
    return (
      <button disabled className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.45)', height: 42 }}>
        <Loader2 size={14} className="animate-spin" /> ...
      </button>
    );
  }

  if (isPaused) {
    return (
      <button
        onClick={() => setMut.mutate('RUNNING')}
        disabled={setMut.isPending}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
        style={{
          background: 'rgba(245,158,11,0.15)',
          border: '1px solid rgba(245,158,11,0.4)',
          color: '#f59e0b',
          height: 42,
        }}
        title="Agent şu an duraklatılmış — devam ettir"
      >
        {setMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
        Devam Et
      </button>
    );
  }

  return (
    <button
      onClick={() => setMut.mutate('PAUSED')}
      disabled={setMut.isPending || offline}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
      style={{
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid rgba(239,68,68,0.35)',
        color: '#ef4444',
        height: 42,
      }}
      title={offline ? 'Agent çalışmıyor — Mihsap sekmesini aç' : 'Çalışan agent\'ı duraklat (kaldığı yerden devam edebilir)'}
    >
      {setMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
      Durdur
    </button>
  );
}

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
  const [exportingReport, setExportingReport] = useState(false);

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

  // Bekleyen onaylar — Onay Kuyruğu modülünden inline gösterilir
  const { data: pendingDecisions = [] } = useQuery({
    queryKey: ['pending-decisions', 'bekliyor'],
    queryFn: () => pendingDecisionsApi.list({ durum: 'bekliyor', limit: 50 }),
    refetchInterval: 5000,
  });

  // v1.36.39 — onayla override destekli. Kullanici farkli hesap kodu yazdiysa
  // VendorMemory bu kodu ogrenir, ayni firma + ayni KDV oraninda otomatik dogru kod secer.
  const onaylaPendingMut = useMutation({
    mutationFn: (params: { id: string; override?: string }) =>
      pendingDecisionsApi.onayla(
        params.id,
        params.override && params.override.trim().length > 0
          ? { override: { kategori: params.override.trim() } }
          : {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions'] });
      toast.success('Karar onaylandı — VendorMemory güncellendi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Onaylama başarısız'),
  });

  const reddetPendingMut = useMutation({
    mutationFn: (id: string) => pendingDecisionsApi.reddet(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-decisions'] }),
  });

  // Atlama İncelemesi — atlanan faturalar sebebe göre gruplu + "bizim hata mı" etiketli
  type AtlamaOrnek = { id: string; mukellef: string | null; firma: string | null; belgeNo: string | null; tutar: string | null; sebep: string | null; ts: string };
  type AtlamaGrup = { key: string; kategori: string; bizimHata: 'evet' | 'muhtemel' | 'incele' | 'hayir'; aciklama: string; adet: number; ornekler: AtlamaOrnek[] };
  type AtlamaAnaliz = { donem: string; toplam: number; bizimHataAdet: number; inceleAdet: number; onayAdet: number; gruplar: AtlamaGrup[] };
  const { data: atlamaAnaliz } = useQuery<AtlamaAnaliz>({
    queryKey: ['agent-events-atlama', 'mihsap', ay],
    queryFn: () => {
      const [yStr, mStr] = ay.split('-');
      return api
        .get('/agent/events/atlama-analizi', { params: { agent: 'mihsap', year: yStr, month: mStr } })
        .then((r) => r.data);
    },
    refetchInterval: 10000,
  });

  const downloadProcessingReport = async () => {
    const [yStr, mStr] = ay.split('-');
    setExportingReport(true);
    try {
      const resp = await api.get('/agent/events/mihsap-report.xlsx', {
        params: {
          year: yStr,
          month: mStr,
          taxpayerIds: selectedIds.join(',') || undefined,
          actions: actions.join(',') || undefined,
        },
        responseType: 'blob',
      });
      const blob = new Blob([resp.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mihsap-fatura-islem-raporu-${ay}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Excel döküm indirildi');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Excel döküm alınamadı');
    } finally {
      setExportingReport(false);
    }
  };

  const statusInfo: any = status.find((s: any) => s.agent === 'mihsap');
  const calisiyor = statusInfo?.running === true;
  const mihsapTaxpayers = taxpayers.filter((t) => t.mihsapId);
  const filtered = mihsapTaxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  const runMut = useMutation({
    mutationFn: async () => {
      if (!calisiyor && typeof window !== 'undefined') {
        window.open('https://app.mihsap.com/', '_blank');
      }
      await api.post('/agent/control/state', { agent: 'mihsap', state: 'RUNNING' }).catch(() => null);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-commands'] });
      qc.invalidateQueries({ queryKey: ['agent-commands', 'mihsap'] });
      qc.invalidateQueries({ queryKey: ['agent-control-state', 'mihsap'] });
      toast.success(calisiyor ? 'Komut kuyruğa atıldı' : 'Komut kuyruğa atıldı · Mihsap sekmesi açıldı');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Komut gönderilemedi'),
  });

  // Aktif komutu iptal et ve runner'a bu turu kapatma sinyali gönder.
  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const result = await agentsApi.cancelCommand(id);
      await api.post('/agent/control/state', { agent: 'mihsap', state: 'STOP' }).catch(() => null);
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-commands'] });
      qc.invalidateQueries({ queryKey: ['agent-commands', 'mihsap'] });
      qc.invalidateQueries({ queryKey: ['agent-control-state', 'mihsap'] });
      toast.success('Komut iptal edildi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İptal başarısız'),
  });
  const aktifKomut = (commands as any[]).find((c) => c.status === 'running' || c.status === 'pending');

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

  // Atlama İncelemesi "yeniden işle için seç": grup mükelleflerini mevcut seçime koyar.
  // İşlemi KULLANICI "Mükellef ile Devam" ile başlatır (2. onay kapısı) — burada başlatmıyoruz.
  const atlananlariSec = (mukellefAdlari: string[]) => {
    const istenen = new Set(mukellefAdlari.map((a) => a.trim().toLocaleLowerCase('tr')));
    const ids = (taxpayers as any[])
      .filter((t) => istenen.has(taxpayerName(t).trim().toLocaleLowerCase('tr')))
      .map((t) => t.id);
    if (ids.length === 0) {
      toast.error('Eşleşen mükellef bulunamadı (Mihsap kimliği tanımlı mı?)');
      return;
    }
    setSelectedIds(ids);
    toast.success(`${ids.length} mükellef seçildi — işlem türünü seçip "Mükellef ile Devam" ile başlat`);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reportPeriodLabel = new Date(`${ay}-01T00:00:00`).toLocaleDateString('tr-TR', {
    month: 'long',
    year: 'numeric',
  });
  const reportScopeLabel =
    selectedIds.length === 0
      ? `${reportPeriodLabel} · tüm mükellefler`
      : selectedIds.length === 1
        ? `${reportPeriodLabel} · ${selectedNames[0] ? taxpayerName(selectedNames[0]) : 'seçili mükellef'}`
        : `${reportPeriodLabel} · ${selectedIds.length} mükellef`;

  return (
    <div className="space-y-3.5 max-w-7xl">
      {/* HEADER — Fiş Yazdırma imzası: kart + üst renk şeridi + degrade ikon kutusu (KPI sağda korunur) */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.06)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Otomasyon</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span
              className="grid place-items-center rounded-xl flex-shrink-0"
              style={{ width: 46, height: 46, background: 'linear-gradient(135deg, #d4b876, #b8a06f)', boxShadow: '0 8px 22px rgba(212,184,118,0.32)' }}
            >
              <Bot size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>
                Mihsap Fatura İşleme
              </h1>
              <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Bekleyen alış/satış faturalarını OCR ile okur, kodlarla karşılaştırır, karar verir
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {calisiyor ? (
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-[11.5px] font-bold"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}
            >
              <Loader2 size={12} className="animate-spin" /> Runner Çalışıyor
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-[11.5px] font-bold"
              style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.25)', color: '#d4b876' }}
            >
              <CheckCircle2 size={12} /> Hazır
            </span>
          )}
          <div className="flex gap-2">
            <KpiMini label="Onay" value={kpi.onay} color="#22c55e" icon="✓" />
            <KpiMini label="Atla" value={kpi.atla} color="#f59e0b" icon="↷" />
            <KpiMini label="Hata" value={kpi.hata} color="#ef4444" icon="✗" />
          </div>
        </div>
      </div>
      </div>

      {/* KOMUT BARI */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(184,160,111,0.15)' }}
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

          <div className="flex-shrink-0 flex items-end gap-2">
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
            {/* Durdur/Devam Et — agent paused state'ine göre toggle */}
            <AgentPauseResumeButton />
            {aktifKomut && (
              <button
                onClick={() => cancelMut.mutate(aktifKomut.id)}
                disabled={cancelMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  color: '#f87171',
                  height: 42,
                }}
                title="Aktif komutu tamamen iptal et ve bu turu kapat"
              >
                {cancelMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                İptal Et
              </button>
            )}
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
                      : commands[0].status === 'cancelled'
                      ? 'rgba(148,163,184,.12)'
                      : 'rgba(245,158,11,.15)',
                  color:
                    commands[0].status === 'done'
                      ? '#22c55e'
                      : commands[0].status === 'failed'
                      ? '#ef4444'
                      : commands[0].status === 'cancelled'
                      ? '#94a3b8'
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
                    : commands[0].status === 'cancelled'
                    ? 'İptal Edildi'
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

      {/* BEKLEYEN ONAYLAR — Onay Kuyruğu (inline) */}
      {pendingDecisions.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.30)' }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(245,158,11,0.20)' }}>
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
              <h2 className="font-semibold" style={{ color: '#fbbf24' }}>
                Bekleyen Onaylar
                <span className="ml-2 text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.25)', color: '#fbbf24' }}>
                  {pendingDecisions.length}
                </span>
              </h2>
              <span className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                AI kararı geçmişle çelişen — onayını bekliyor
              </span>
            </div>

          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {(pendingDecisions as any[]).slice(0, 20).map((row: any) => (
              <PendingDecisionRow
                key={row.id}
                row={row}
                onaylaPendingMut={onaylaPendingMut}
                reddetPendingMut={reddetPendingMut}
              />
            ))}
          </div>
        </div>
      )}

      {/* CANLI LOG FEED — Bekleyen Onaylar'ın altında, Mükellef Listesi'nin üstünde */}
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
              Son {events.length} işlem — 3 saniyede bir yenilenir · Excel: {reportScopeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadProcessingReport}
              disabled={exportingReport}
              className="text-xs inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border disabled:opacity-50"
              style={{
                background: 'rgba(184,160,111,0.10)',
                borderColor: 'rgba(184,160,111,0.28)',
                color: '#d4b876',
              }}
              title={`${reportScopeLabel} · fatura tarihine göre süzülür`}
            >
              {exportingReport ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {selectedIds.length === 0 ? 'Tüm Dönem Excel' : 'Seçili Excel'}
            </button>
            <Link
              href="/panel/ajanlar/loglar?agent=mihsap"
              className="text-xs inline-flex items-center gap-1"
              style={{ color: 'rgba(250,250,249,0.45)' }}
            >
              Tümü <ArrowRight size={11} />
            </Link>
          </div>
        </div>
        <div className="p-2 space-y-2 max-h-[680px] overflow-y-auto">
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

      {/* ATLAMA İNCELEMESİ — atlanan faturalar sebebe göre gruplu + "bizim hata mı" */}
      <AtlamaIncelemesi ay={ay} data={atlamaAnaliz} onSec={atlananlariSec} />

    </div>
  );
}

/**
 * Bekleyen onay satiri — kullanici hesap kodunu duzeltip onaylayabilir.
 * Override edilen kod VendorMemory'ye yazilir → ayni firma + ayni KDV oranindaki
 * fatura bir daha onaya dusmez.
 */
function PendingDecisionRow({ row, onaylaPendingMut, reddetPendingMut }: {
  row: any;
  onaylaPendingMut: any;
  reddetPendingMut: any;
}) {
  const ai = row.aiKarari || {};
  const aiKodu: string = row.kararTipi === 'fatura'
    ? (ai.hesapKodu || ai.kategori || '')
    : [ai.kayitTuru, ai.altTuru].filter(Boolean).join(' → ');
  const [override, setOverride] = useState<string>(aiKodu);
  const isFatura = row.kararTipi === 'fatura';
  const editilmis = override.trim() !== aiKodu.trim() && override.trim().length > 0;
  const gecmis = row.gecmisBeklenen?.enCok
    ? `${row.gecmisBeklenen.enCok}${row.gecmisBeklenen.enCokSayisi ? ` (${row.gecmisBeklenen.enCokSayisi}×)` : ''}`
    : '—';
  const isPending = onaylaPendingMut.isPending || reddetPendingMut.isPending;

  return (
    <div
      className="grid grid-cols-[1fr_auto] gap-3 items-start px-4 py-3"
      style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
            {row.kararTipi}
          </span>
          <span className="font-semibold text-[13px] truncate" style={{ color: '#fafaf9' }}>
            {row.firmaUnvan || row.firmaKimlikNo || '(firma yok)'}
          </span>
          {row.belgeNo && (
            <span className="text-[11px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.55)' }}>
              #{row.belgeNo}
            </span>
          )}
          {row.tutar && (
            <span className="text-[11px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.55)' }}>
              {row.tutar}
            </span>
          )}
        </div>
        <div className="text-[11.5px] mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
          Mükellef: <span style={{ color: '#fafaf9' }}>{row.mukellef || '—'}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11.5px] mb-1.5">
          <div className="px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: '#fbbf24' }}>AI Önerisi</div>
            <div className="font-mono mt-0.5" style={{ color: '#fafaf9' }}>{aiKodu || '(boş)'}</div>
          </div>
          <div className="px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Geçmiş Beklenen</div>
            <div className="font-mono mt-0.5" style={{ color: '#fafaf9' }}>{gecmis}</div>
          </div>
        </div>
        {isFatura && (
          <div className="px-2 py-1.5 rounded mb-1.5" style={{ background: editilmis ? 'rgba(212,184,118,0.10)' : 'rgba(255,255,255,0.025)', border: editilmis ? '1px solid rgba(212,184,118,0.30)' : '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: editilmis ? '#d4b876' : 'rgba(250,250,249,0.55)' }}>
                {editilmis ? 'Override Edilecek Kod' : 'Onaylanacak Kod (gerekirse düzelt)'}
              </div>
              {editilmis && (
                <button
                  type="button"
                  onClick={() => setOverride(aiKodu)}
                  className="text-[10px] underline"
                  style={{ color: 'rgba(250,250,249,0.45)' }}
                  title="AI önerisine geri dön"
                >
                  sıfırla
                </button>
              )}
            </div>
            <input
              type="text"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder="Hesap kodu (ör. 153.01.001-%01 TICARI MAL ALISLAR)"
              spellCheck={false}
              className="w-full text-[12px] font-mono outline-none"
              style={{
                background: 'transparent',
                color: '#fafaf9',
                borderBottom: '1px dashed rgba(255,255,255,0.15)',
                padding: '2px 0',
              }}
            />
            {editilmis && (
              <div className="text-[10.5px] mt-1" style={{ color: '#d4b876' }}>
                Onaylayınca VendorMemory bu kodu öğrenir — aynı firma + KDV oranı bir daha onaya düşmez.
              </div>
            )}
          </div>
        )}
        {row.sapmaSebep && (
          <div className="text-[11px] italic" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {row.sapmaSebep}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => onaylaPendingMut.mutate({ id: row.id, override: editilmis ? override : undefined })}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded disabled:opacity-50"
          style={{
            background: editilmis ? 'rgba(212,184,118,0.20)' : 'rgba(34,197,94,0.18)',
            color: editilmis ? '#d4b876' : '#22c55e',
            border: editilmis ? '1px solid rgba(212,184,118,0.45)' : '1px solid rgba(34,197,94,0.4)',
          }}
          title={editilmis ? 'Düzeltilmiş kodu onayla' : "AI önerisini onayla"}
        >
          <ThumbsUp size={12} /> {editilmis ? 'Onayla (override)' : 'Onayla'}
        </button>
        <button
          onClick={() => {
            if (confirm('Bu kararı reddet — tekrar onay kuyruğuna düşmesin diye sebep belirtmen gerekirse Detaylı Görünüm sayfasına git.')) {
              reddetPendingMut.mutate(row.id);
            }
          }}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded disabled:opacity-50"
          style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.35)' }}
          title="Reddet"
        >
          <ThumbsDown size={12} /> Reddet
        </button>
      </div>
    </div>
  );
}

function KpiMini({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 border flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{ background: color + '18', color }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex items-baseline gap-2">
        <div className="text-[10px] uppercase font-semibold tracking-wider whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {label}
        </div>
        <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>
          {value.toLocaleString('tr-TR')}
        </div>
      </div>
    </div>
  );
}

/** Seçili ayda her mükellef için portal üzerinden işlenen alış/satış fatura sayıları.
 *  Hangi mükellefin ne kadarını sistem üzerinden, ne kadarını manuel işlediğini görmek için. */
function AtlamaIncelemesi({
  ay,
  data,
  onSec,
}: {
  ay: string;
  onSec: (mukellefAdlari: string[]) => void;
  data?: {
    donem: string;
    toplam: number;
    bizimHataAdet: number;
    inceleAdet: number;
    onayAdet: number;
    gruplar: {
      key: string;
      kategori: string;
      bizimHata: string;
      aciklama: string;
      adet: number;
      ornekler: { id: string; mukellef: string | null; firma: string | null; belgeNo: string | null; tutar: string | null; sebep: string | null; ts: string }[];
    }[];
  };
}) {
  const [acik, setAcik] = useState<string | null>(null);
  const [teshisler, setTeshisler] = useState<Record<string, any>>({});
  const [teshisYukleniyor, setTeshisYukleniyor] = useState<string | null>(null);
  const teshisEt = async (key: string) => {
    setTeshisYukleniyor(key);
    try {
      const [yy, mm] = ay.split('-');
      const r = await api.post('/agent/events/atlama-teshis', { agent: 'mihsap', year: Number(yy), month: Number(mm), key });
      setTeshisler((t) => ({ ...t, [key]: r.data }));
    } catch (e: any) {
      setTeshisler((t) => ({ ...t, [key]: { ok: false, sebep: e?.response?.data?.message || 'Teşhis hatası' } }));
    } finally {
      setTeshisYukleniyor(null);
    }
  };
  const [talepDurum, setTalepDurum] = useState<Record<string, 'gonderiliyor' | 'eklendi'>>({});
  const { data: talepler, refetch: refetchTalepler } = useQuery<{ bekleyen: any[]; yapilan: any[] }>({
    queryKey: ['atlama-talepler'],
    queryFn: () => api.get('/agent/events/atlama-talepler').then((r) => r.data),
    refetchInterval: 15000,
  });
  const duzeltTalebiEkle = async (key: string, kategori: string, t: any) => {
    setTalepDurum((s) => ({ ...s, [key]: 'gonderiliyor' }));
    try {
      const [yy, mm] = ay.split('-');
      await api.post('/agent/events/atlama-talep', {
        key, donem: `${yy}-${mm}`, kategori,
        kokNeden: t.kokNeden, onerilenDuzeltme: t.onerilenDuzeltme,
        adet: t.adet, bizimHata: t.bizimHata, guven: t.guven,
      });
      setTalepDurum((s) => ({ ...s, [key]: 'eklendi' }));
      refetchTalepler();
    } catch {
      setTalepDurum((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  };
  const bekleyenTalepler = talepler?.bekleyen || [];
  const AYLAR_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const [yStr, mStr] = ay.split('-');
  const ayEtiket = `${AYLAR_TR[parseInt(mStr, 10) - 1] || ''} ${yStr}`;
  const gruplar = data?.gruplar || [];
  const toplam = data?.toplam ?? 0;

  const rozet = (b: string) =>
    b === 'evet' ? { t: 'Bizim hata', c: '#f87171', bg: 'rgba(248,113,113,0.12)' }
    : b === 'muhtemel' ? { t: 'Muhtemelen bizim', c: '#fb923c', bg: 'rgba(251,146,60,0.12)' }
    : b === 'incele' ? { t: 'İncele', c: '#facc15', bg: 'rgba(250,204,21,0.12)' }
    : { t: 'Normal', c: '#34d399', bg: 'rgba(52,211,153,0.12)' };

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <h2 className="font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
          <AlertTriangle size={14} style={{ color: '#f59e0b' }} /> Atlama İncelemesi — {ayEtiket}
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
          İşlenemeyen faturalar — &quot;bizim sistemden mi, gerçek belge sorunundan mı&quot; diye sınıflandırılır
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <OzetHucre label="Toplam Atlanan" value={toplam} alt="fatura" color="#d4b876" />
        <OzetHucre label="Bizim Hata (muhtemel)" value={data?.bizimHataAdet ?? 0} alt="düzeltilebilir" color="#fb923c" />
        <OzetHucre label="İncelenecek" value={data?.inceleAdet ?? 0} alt="belirsiz" color="#facc15" />
        <OzetHucre label="Onay/Normal" value={data?.onayAdet ?? 0} alt="hata değil" color="#34d399" />
      </div>
      {/* GELİŞTİRME KUYRUĞU (Faz 2 "Düzelt" talepleri) */}
      {bekleyenTalepler.length > 0 && (
        <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(248,113,113,0.04)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#d4b876' }}>
            Claude'a Gönderilen Düzeltmeler — {bekleyenTalepler.length} bekliyor
          </div>
          <div className="space-y-1">
            {bekleyenTalepler.slice(0, 6).map((tl: any) => (
              <div key={tl.id} className="text-[12px] flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase shrink-0" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>Bekliyor</span>
                <span className="min-w-0" style={{ color: 'rgba(250,250,249,0.8)' }}>
                  <b style={{ color: '#fafaf9' }}>{tl.kategori || 'Atlama'}</b>
                  {tl.kokNeden ? ` — ${tl.kokNeden}` : ''}
                  {tl.adet ? <span style={{ color: 'rgba(250,250,249,0.4)' }}> · {tl.adet} fatura</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {gruplar.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Bu dönem için atlanan fatura yok 🎉
        </div>
      ) : (
        <div>
          {gruplar.map((g, i) => {
            const r = rozet(g.bizimHata);
            const open = acik === g.key;
            return (
              <div key={g.key} style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                <button
                  onClick={() => setAcik(open ? null : g.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0" style={{ background: r.bg, color: r.c }}>{r.t}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: '#fafaf9' }}>{g.kategori}</div>
                      <div className="text-[11px] truncate" style={{ color: 'rgba(250,250,249,0.4)' }}>{g.aciklama}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums font-semibold" style={{ color: '#d4b876' }}>{g.adet}</span>
                    <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>fatura</span>
                    <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.4)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3">
                    {/* AI TEŞHİS (Faz 2) */}
                    {(() => {
                      const t = teshisler[g.key];
                      const yukleniyor = teshisYukleniyor === g.key;
                      if (!t) {
                        return (
                          <button
                            onClick={() => teshisEt(g.key)}
                            disabled={yukleniyor}
                            className="mb-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all hover:opacity-90"
                            style={{ background: 'rgba(184,160,111,0.12)', color: '#d4b876', border: '1px solid rgba(184,160,111,0.25)' }}
                          >
                            {yukleniyor ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                            {yukleniyor ? 'AI inceliyor…' : 'AI ile Teşhis Et'}
                          </button>
                        );
                      }
                      if (!t.ok) {
                        return (
                          <div className="mb-2 text-[12px] px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                            <span>Teşhis alınamadı: {t.sebep}</span>
                            <button onClick={() => teshisEt(g.key)} className="underline shrink-0" style={{ color: '#f87171' }}>tekrar</button>
                          </div>
                        );
                      }
                      const renk = t.bizimHata === 'evet' ? '#f87171' : t.bizimHata === 'kismi' ? '#fb923c' : '#34d399';
                      const etiket = t.bizimHata === 'evet' ? 'Bizim hata' : t.bizimHata === 'kismi' ? 'Kısmen bizim' : 'Bizim hata değil';
                      return (
                        <div className="mb-2 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: 'rgba(184,160,111,0.06)', border: '1px solid rgba(184,160,111,0.18)' }}>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="inline-flex items-center gap-1" style={{ color: '#d4b876', fontWeight: 600 }}><Zap size={12} /> AI Teşhis</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ background: `${renk}22`, color: renk }}>{etiket}</span>
                            {t.guven != null && <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>%{t.guven} güven</span>}
                          </div>
                          {t.kokNeden && <div style={{ color: 'rgba(250,250,249,0.8)' }}><b style={{ color: 'rgba(250,250,249,0.5)' }}>Kök neden:</b> {t.kokNeden}</div>}
                          {t.onerilenDuzeltme && <div className="mt-0.5" style={{ color: 'rgba(250,250,249,0.8)' }}><b style={{ color: 'rgba(250,250,249,0.5)' }}>Öneri:</b> {t.onerilenDuzeltme}</div>}
                          {t.bizimHata !== 'hayir' && t.onerilenDuzeltme && (
                            <div className="mt-1.5">
                              {talepDurum[g.key] === 'eklendi' ? (
                                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#34d399' }}><CheckCircle2 size={12} /> Claude'a gönderildi — düzeltilecek</span>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Bu düzeltmeyi Claude'a, düzeltmesi için göndereyim mi?\n\n${g.kategori}\n${t.onerilenDuzeltme || ''}`)) {
                                      duzeltTalebiEkle(g.key, g.kategori, t);
                                    }
                                  }}
                                  disabled={talepDurum[g.key] === 'gonderiliyor'}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium hover:opacity-90"
                                  style={{ background: 'rgba(184,160,111,0.14)', color: '#d4b876', border: '1px solid rgba(184,160,111,0.3)' }}
                                >
                                  <Edit3 size={12} /> Claude'a gönder (düzeltsin)
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* ATLANANLARI YENİDEN İŞLE (Faz 2) — mevcut seçim akışına koyar; işlemi "Mükellef ile Devam" başlatır (2. onay) */}
                    <button
                      onClick={() => {
                        const adlar = Array.from(new Set(g.ornekler.map((o) => (o.mukellef || '').trim()).filter(Boolean)));
                        onSec(adlar);
                      }}
                      className="mb-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all hover:opacity-90"
                      style={{ background: 'rgba(52,211,153,0.10)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}
                    >
                      <PlayCircle size={13} /> Bu mükellefleri seç (yeniden işle)
                    </button>
                    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                      {g.ornekler.map((o, j) => (
                        <div key={o.id} className="px-3 py-2 text-[12px]" style={{ borderTop: j > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none', background: 'rgba(255,255,255,0.01)' }}>
                          <div className="min-w-0">
                            <span style={{ color: '#fafaf9' }}>{o.mukellef || '—'}</span>
                            <span style={{ color: 'rgba(250,250,249,0.4)' }}> · #{o.belgeNo || '—'}{o.tutar ? ` · ${o.tutar} TL` : ''}</span>
                            <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{o.sebep}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
