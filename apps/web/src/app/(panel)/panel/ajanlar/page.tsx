'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentDefinition, agentsApi } from '@/lib/agents';
import { api } from '@/lib/api';
import {
  Bot, Receipt, FileInput, Mailbox, Calculator, BookOpen, ShieldCheck,
  Activity, CheckCircle2, Clock, ArrowRight, TrendingUp, AlertCircle, Zap,
  Cpu, DollarSign, XCircle, HelpCircle, Plus, Wallet,
} from 'lucide-react';
import AgentControlCard from './_components/AgentControlCard';

const AGENT_VISUALS: Record<string, any> = {
  'agent-core-orchestrator': { href: '/panel/ajanlar/loglar', icon: Cpu, gradient: 'linear-gradient(135deg, #64748b, #334155)' },
  'mihsap-fatura-isleme-agent': { href: '/panel/ajanlar/mihsap', icon: Receipt, gradient: 'linear-gradient(135deg, #b8a06f, #8b7649)' },
  'mihsap-supervised-agent': { href: '/panel/ajanlar/mihsap', icon: Receipt, gradient: 'linear-gradient(135deg, #b8a06f, #8b7649)' },
  'mihsap-invoice-sync-agent': { href: '/panel/faturalar', icon: FileInput, gradient: 'linear-gradient(135deg, #0ea5e9, #0369a1)' },
  'luca-ebelge-agent': { href: '/panel/e-arsiv', icon: FileInput, gradient: 'linear-gradient(135deg, #14b8a6, #0f766e)' },
  'luca-mizan-agent': { href: '/panel/mizan', icon: Calculator, gradient: 'linear-gradient(135deg, #22c55e, #15803d)' },
  'luca-kdv-agent': { href: '/panel/kdv-kontrol', icon: ShieldCheck, gradient: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  'luca-isletme-agent': { href: '/panel/isletme-hesap-ozeti', icon: BookOpen, gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
  'hgs-agent': { href: '/panel/galeri/hgs-ihlal', icon: Activity, gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)' },
  'beyanname-collector-agent': { href: '/panel/beyannameler', icon: FileInput, gradient: 'linear-gradient(135deg, #ec4899, #be185d)' },
  'etebligat-watch-agent': { href: '/panel/ajanlar/tebligat', icon: Mailbox, gradient: 'linear-gradient(135deg, #6366f1, #4338ca)' },
  'finansal-rapor-agent': { href: '/panel/bilanco', icon: TrendingUp, gradient: 'linear-gradient(135deg, #10b981, #047857)' },
};

const FALLBACK_AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: 'mihsap-fatura-isleme-agent',
    title: 'Mihsap Fatura Isleme Agent',
    mode: 'supervised',
    queue: 'agent-command',
    stage: 'alias_ready',
    modules: ['ajanlar/mihsap'],
    legacyRunner: 'mihsap',
    description: 'Mihsap tarayicisinda AI destekli fatura isleme yapar.',
  },
];

const STAGE_META: Record<AgentDefinition['stage'], { label: string; color: string; bg: string }> = {
  active: { label: 'AKTIF', color: '#22c55e', bg: 'rgba(34,197,94,.14)' },
  alias_ready: { label: 'GECISTE', color: '#d4b876', bg: 'rgba(212,184,118,.14)' },
  planned: { label: 'PLANLI', color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  service: { label: 'ALTYAPI', color: '#38bdf8', bg: 'rgba(56,189,248,.12)' },
  report_only: { label: 'RAPOR', color: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
};

const MODE_LABEL: Record<AgentDefinition['mode'], string> = {
  background: 'Arka plan',
  supervised: 'Gorunur',
  approval_first: 'Onayli',
  service: 'Servis',
  report: 'Rapor',
};

const QUEUE_LABEL: Record<string, string> = {
  'agent-command': 'Komut kuyrugu',
  'luca-fetch-job': 'Luca job',
  'mihsap-service': 'Mihsap servis',
  'hgs-agent': 'HGS runner',
  service: 'Core',
  'report-only': 'Veri cekmez',
};

// Luca, Tebligat, KDV On-Hazirlik, SGK ajanlari gecici olarak kapatildi
// (islem yapildikca yeniden acilacak - eski kayitlar git history'de)
const AGENTS = [
  {
    id: 'mihsap', href: '/panel/ajanlar/mihsap', title: 'Mihsap Fatura',
    desc: 'Bekleyen alış/satış faturalarını OCR ile inceler',
    icon: Receipt, gradient: 'linear-gradient(135deg, #b8a06f, #8b7649)', aktif: true,
  },
  {
    id: 'e-defter', href: '/panel/ajanlar/e-defter', title: 'E-Defter Kontrol',
    desc: 'Berat durumları ve yevmiye mukayese',
    icon: BookOpen, gradient: 'linear-gradient(135deg, #6366f1, #a855f7)', aktif: false,
  },
];

export default function AjanlarDashboard() {
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
  const { data: commands = [] } = useQuery({
    queryKey: ['agent-commands'],
    queryFn: () => agentsApi.listCommands({ limit: 10 }),
    refetchInterval: 3000,
  });
  const { data: aiUsage } = useQuery({
    queryKey: ['agent-ai-usage'],
    queryFn: () => agentsApi.aiUsageStats(),
    refetchInterval: 5000,
  });
  const { data: registry = FALLBACK_AGENT_REGISTRY } = useQuery({
    queryKey: ['agent-registry'],
    queryFn: () => agentsApi.registry(),
    refetchInterval: 30000,
  });

  const statusMap = new Map(status.map((s: any) => [s.agent, s]));
  const agentRegistry = registry.length ? registry : FALLBACK_AGENT_REGISTRY;
  const liveAgents = agentRegistry.filter((a) => a.stage !== 'planned');
  const plannedAgents = agentRegistry.filter((a) => a.stage === 'planned');
  const statusForAgent = (agent: AgentDefinition) =>
    statusMap.get(agent.id) || (agent.legacyRunner ? statusMap.get(agent.legacyRunner) : null);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Otomasyon Ajanları
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Mali müşavirlik işleyişinin tekrarlayan kısımlarını otomasyon ajanlarına bırakın
          </p>
        </div>
        <Link href="/panel/ajanlar/loglar" className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}>
          <Activity size={14} /> Yapılan İşlemler <ArrowRight size={12} />
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Bu Ay Onaylanan" value={stats?.buAy ?? 0} color="#22c55e" icon={CheckCircle2} />
        <StatBox label="Bugün İşlem" value={stats?.buGun ?? 0} color="#3b82f6" icon={TrendingUp} />
        <StatBox label="Hata (24s)" value={stats?.hataBugun ?? 0} color="#ef4444" icon={AlertCircle} />
        <StatBox
          label="Bekleyen Komut"
          value={commands.filter((c: any) => c.status === 'pending' || c.status === 'running').length}
          color="#f59e0b"
          icon={Clock}
        />
      </div>

      {/* v1.36.34: Auto-Agent extension kontrolü — tek tuş Luca+Mihsap başlatma */}
      <AgentControlCard />

      {/* AI Kullanım Widget'ı */}
      <AiUsageWidget data={aiUsage} />

      {/* Agents grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: '#fafaf9' }}>Agent Envanteri</h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
              Mevcut motorlar korunarak yeni dijital calisanlara gecis haritasi
            </p>
          </div>
          <Link
            href="/panel/ajanlar/loglar"
            className="inline-flex items-center gap-1 text-sm"
            style={{ color: 'rgba(250,250,249,0.45)' }}
          >
            <Activity size={13} /> Yapılan İşlemler <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {liveAgents.map((agent) => (
            <AgentRegistryTile key={agent.id} agent={agent} statusInfo={statusForAgent(agent)} />
          ))}
        </div>
        {plannedAgents.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} style={{ color: '#94a3b8' }} />
              <h3 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Sonraki Faz</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plannedAgents.map((agent) => (
                <AgentRegistryTile key={agent.id} agent={agent} statusInfo={statusForAgent(agent)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiUsageWidget({ data }: { data: any }) {
  const qc = useQueryClient();
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');

  const topupMut = useMutation({
    mutationFn: (body: { amountUsd: number; note?: string }) => agentsApi.aiCreditTopup(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-ai-usage'] });
      setTopupOpen(false);
      setTopupAmount('');
      setTopupNote('');
    },
  });

  if (!data) {
    return (
      <div
        className="rounded-2xl p-5 border"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>AI kullanımı yükleniyor…</div>
      </div>
    );
  }

  // USD → TL kuru backend'den TCMB canlı verisiyle geliyor
  const USD_TO_TL = Number(data.usdTry) > 0 ? Number(data.usdTry) : 40;
  const bakiye = data.bakiye || { toplamYuklenenUsd: 0, toplamHarcananUsd: 0, kalanBakiyeUsd: 0 };
  const kalanTl = bakiye.kalanBakiyeUsd * USD_TO_TL;
  const yuzde =
    bakiye.toplamYuklenenUsd > 0
      ? Math.min(100, (bakiye.toplamHarcananUsd / bakiye.toplamYuklenenUsd) * 100)
      : 0;

  const formatUsd = (v: number) => `$${(v || 0).toFixed(4)}`;
  const formatTl = (v: number) => `₺${((v || 0) * USD_TO_TL).toFixed(2)}`;
  const formatToken = (v: number) => (v || 0).toLocaleString('tr-TR');

  const Kart = ({ title, d, accent }: { title: string; d: any; accent: string }) => (
    <div
      className="rounded-xl p-4 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase font-bold tracking-wider" style={{ color: accent }}>
          {title}
        </div>
        <Cpu size={14} style={{ color: accent }} />
      </div>

      {/* Sorgu sayısı büyük */}
      <div className="mb-3">
        <div className="text-3xl font-bold tabular-nums" style={{ color: '#fafaf9' }}>
          {formatToken(d?.sorguSayisi ?? 0)}
        </div>
        <div className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>API sorgusu</div>
      </div>

      {/* Karar dağılımı */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex items-center gap-1">
          <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#22c55e' }}>
              {formatToken(d?.onaySayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>onay</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <XCircle size={12} style={{ color: '#f59e0b' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#f59e0b' }}>
              {formatToken(d?.atlaSayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>atla</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <HelpCircle size={12} style={{ color: '#94a3b8' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
              {formatToken(d?.eminDegilSayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>?</div>
          </div>
        </div>
      </div>

      {/* Token + Maliyet */}
      <div className="pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between text-xs mb-1">
          <span style={{ color: 'rgba(250,250,249,0.45)' }}>Token</span>
          <span className="tabular-nums font-semibold" style={{ color: '#fafaf9' }}>
            {formatToken(d?.toplamToken ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span style={{ color: 'rgba(250,250,249,0.45)' }}>Gercek / cache</span>
          <span className="tabular-nums font-semibold" style={{ color: '#fafaf9' }}>
            {formatToken(d?.gercekCagriSayisi ?? 0)} / {formatToken(d?.cacheHitSayisi ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'rgba(250,250,249,0.45)' }}>Maliyet</span>
          <span className="tabular-nums font-semibold" style={{ color: accent }}>
            {formatUsd(d?.maliyetUsd ?? 0)} · {formatTl(d?.maliyetUsd ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)' }}
        >
          <DollarSign size={15} style={{ color: '#fff' }} />
        </div>
        <h2 className="text-lg font-semibold" style={{ color: '#fafaf9' }}>
          AI Kullanım & Maliyet
        </h2>
        <span className="text-xs ml-auto tabular-nums" style={{ color: 'rgba(250,250,249,0.45)' }}>
          TCMB USD: ₺{USD_TO_TL.toFixed(4)}
        </span>
      </div>

      {/* Bakiye Kartı */}
      <div
        className="rounded-xl p-4 border mb-3 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,.08), rgba(59,130,246,.05))',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)' }}
            >
              <Wallet size={18} style={{ color: '#fff' }} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider font-bold" style={{ color: '#10b981' }}>
                Kalan Kontör Bakiyesi
              </div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: '#fafaf9' }}>
                ${bakiye.kalanBakiyeUsd.toFixed(4)}
                <span className="text-sm font-normal ml-2" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  (₺{kalanTl.toFixed(2)})
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Yüklenen: ${bakiye.toplamYuklenenUsd.toFixed(2)} · Harcanan: ${bakiye.toplamHarcananUsd.toFixed(4)}
              </div>
            </div>
          </div>
          <button
            onClick={() => setTopupOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition"
            style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', color: '#fff' }}
          >
            <Plus size={14} /> Kontör Ekle
          </button>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,.08)' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${yuzde}%`,
              background: yuzde > 90 ? '#ef4444' : yuzde > 75 ? '#f59e0b' : '#10b981',
            }}
          />
        </div>
      </div>

      {/* 3'lü dönem kartları */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Kart title="Bugün" d={data.bugun} accent="#3b82f6" />
        <Kart title="Bu Ay" d={data.buAy} accent="#8b5cf6" />
        <Kart title="Toplam" d={data.toplam} accent="#b8a06f" />
      </div>

      {/* Kontör Ekle Dialog */}
      {topupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => setTopupOpen(false)}
        >
          <div
            className="rounded-xl p-5 border w-full max-w-md"
            style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={18} style={{ color: '#10b981' }} />
              <h3 className="text-lg font-semibold" style={{ color: '#fafaf9' }}>
                Kontör Yükleme Kaydı
              </h3>
            </div>
            <p className="text-xs mb-4" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Anthropic hesabınıza yaptığınız yüklemeyi burada kaydedin. Sistem bu tutardan harcamaları düşerek
              bakiyenizi takip eder.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: '#fafaf9' }}>
                  Yüklenen Tutar (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  placeholder="50.00"
                  className="w-full px-3 py-2 rounded-lg border text-sm tabular-nums"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.05)',
                    color: '#fafaf9',
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: '#fafaf9' }}>
                  Not (opsiyonel)
                </label>
                <input
                  type="text"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.target.value)}
                  placeholder="Nisan 2026 yüklemesi"
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.05)',
                    color: '#fafaf9',
                  }}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setTopupOpen(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'transparent', color: 'rgba(250,250,249,0.45)' }}
              >
                İptal
              </button>
              <button
                disabled={!topupAmount || Number(topupAmount) <= 0 || topupMut.isPending}
                onClick={() =>
                  topupMut.mutate({
                    amountUsd: Number(topupAmount),
                    note: topupNote || undefined,
                  })
                }
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: 'linear-gradient(135deg, #10b981, #0ea5e9)', color: '#fff' }}
              >
                <Plus size={14} /> {topupMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color, icon: Icon }: any) {
  return (
    <div
      className="rounded-xl p-4 border flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, color }}
      >
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</div>
        <div className="text-xl font-bold tabular-nums" style={{ color }}>
          {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
        </div>
      </div>
    </div>
  );
}

function AgentRegistryTile({ agent, statusInfo }: { agent: AgentDefinition; statusInfo: any }) {
  const visual = AGENT_VISUALS[agent.id] || {
    href: '/panel/ajanlar/loglar',
    icon: Bot,
    gradient: 'linear-gradient(135deg, #64748b, #334155)',
  };
  const Icon = visual.icon;
  const calisiyor = statusInfo?.running === true;
  const stage = STAGE_META[agent.stage] || STAGE_META.planned;
  const lastPing = statusInfo?.lastPing ? new Date(statusInfo.lastPing).toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' }) : null;
  const modules = agent.modules?.slice(0, 3).join(' · ');

  return (
    <Link
      href={visual.href}
      className="group relative block rounded-xl p-5 border overflow-hidden transition-all hover:scale-[1.01] hover:shadow-lg"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: visual.gradient }} />
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
          style={{ background: visual.gradient, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}
        >
          <Icon size={20} style={{ color: '#fff' }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold" style={{ color: '#fafaf9' }}>{agent.title}</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: stage.bg, color: stage.color }}>
              {stage.label}
            </span>
            {calisiyor && (
              <span
                className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(16,185,129,.15)', color: '#22c55e' }}
              >
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#22c55e' }} />
                CALISIYOR
              </span>
            )}
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {agent.description}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.62)' }}>
          {MODE_LABEL[agent.mode]}
        </span>
        <span className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.62)' }}>
          {QUEUE_LABEL[agent.queue] || agent.queue}
        </span>
        {agent.legacyRunner && (
          <span className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(212,184,118,.10)', color: '#d4b876' }}>
            Eski motor: {agent.legacyRunner}
          </span>
        )}
      </div>

      <div className="text-[11px] mb-3 truncate" style={{ color: 'rgba(250,250,249,0.42)' }}>
        {modules || 'Modul baglantisi yok'}
      </div>

      <div className="flex items-center justify-between text-xs pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <span style={{ color: 'rgba(250,250,249,0.45)' }}>
          {lastPing ? `Son ping: ${lastPing}` : agent.stage === 'planned' ? 'Planlandi' : 'Hazir'}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold transition-transform group-hover:translate-x-0.5" style={{ color: '#b8a06f' }}>
          <Zap size={11} /> Ac <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}

function AgentTile({ agent, statusInfo }: any) {
  const Icon = agent.icon;
  const calisiyor = statusInfo?.running === true;
  return (
    <Link
      href={agent.href}
      className="group relative block rounded-xl p-5 border overflow-hidden transition-all hover:scale-[1.01] hover:shadow-lg"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {/* Gradient side bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: agent.gradient }}
      />
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
          style={{ background: agent.gradient, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}
        >
          <Icon size={20} style={{ color: '#fff' }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold" style={{ color: '#fafaf9' }}>{agent.title}</h3>
            {!agent.aktif && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.45)' }}
              >
                YAKINDA
              </span>
            )}
            {agent.aktif && calisiyor && (
              <span
                className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(16,185,129,.15)', color: '#059669' }}
              >
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#059669' }} />
                ÇALIŞIYOR
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {agent.desc}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <span style={{ color: 'rgba(250,250,249,0.45)' }}>
          {agent.aktif ? (statusInfo?.lastPing ? `Son: ${new Date(statusInfo.lastPing).toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' })}` : 'Hazır') : '—'}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold transition-transform group-hover:translate-x-0.5" style={{ color: '#b8a06f' }}>
          <Zap size={11} /> Aç <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}
