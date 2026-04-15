'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '@/lib/agents';
import { api } from '@/lib/api';
import {
  Bot, Receipt, FileInput, Mailbox, Calculator, BookOpen, ShieldCheck,
  Activity, CheckCircle2, Clock, ArrowRight, Sparkles, TrendingUp, AlertCircle, Zap,
  Cpu, DollarSign, XCircle, HelpCircle, Plus, Wallet,
} from 'lucide-react';

const AGENTS = [
  {
    id: 'mihsap', href: '/panel/ajanlar/mihsap', title: 'Mihsap Fatura',
    desc: 'Bekleyen alış/satış faturalarını OCR ile inceler',
    icon: Receipt, gradient: 'linear-gradient(135deg, #b8a06f, #8b7649)', aktif: true,
  },
  {
    id: 'luca', href: '/panel/ajanlar/luca', title: 'Luca E-Arşiv',
    desc: 'E-arşiv zip indir, XML ayrıştır, Drive\'a koy',
    icon: FileInput, gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1)', aktif: false,
  },
  {
    id: 'tebligat', href: '/panel/ajanlar/tebligat', title: 'Tebligat Özet',
    desc: 'Hattat tebligatları sınıflandırır, kritik olanları bildirir',
    icon: Mailbox, gradient: 'linear-gradient(135deg, #f59e0b, #ec4899)', aktif: false,
  },
  {
    id: 'kdv-hazirlik', href: '/panel/ajanlar/kdv-hazirlik', title: 'KDV Ön-Hazırlık',
    desc: 'KDV1/KDV2 beyanname taslakları ve anomali tespiti',
    icon: Calculator, gradient: 'linear-gradient(135deg, #10b981, #06b6d4)', aktif: false,
  },
  {
    id: 'e-defter', href: '/panel/ajanlar/e-defter', title: 'E-Defter Kontrol',
    desc: 'Berat durumları ve yevmiye mukayese',
    icon: BookOpen, gradient: 'linear-gradient(135deg, #6366f1, #a855f7)', aktif: false,
  },
  {
    id: 'sgk', href: '/panel/ajanlar/sgk', title: 'SGK Bildirge',
    desc: 'İşe giriş/çıkış, MUHSGK takip, tahakkuk hazırlığı',
    icon: ShieldCheck, gradient: 'linear-gradient(135deg, #dc2626, #991b1b)', aktif: false,
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

  const statusMap = new Map(status.map((s: any) => [s.agent, s]));

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div
        className="relative rounded-2xl overflow-hidden p-7 border"
        style={{
          background: 'linear-gradient(135deg, rgba(184,160,111,.1) 0%, rgba(99,102,241,.05) 100%)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, #b8a06f, transparent 70%)' }} />
        <div className="relative flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #b8a06f, #8b7649)',
              boxShadow: '0 6px 20px rgba(184,160,111,.4)',
            }}
          >
            <Bot size={26} style={{ color: '#0f0d0b' }} strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-widest mb-0.5" style={{ color: '#b8a06f' }}>
              <Sparkles size={10} className="inline mr-1" /> Claude Powered
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Otomasyon Ajanları</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Mali müşavirlik işleyişinin tekrarlayan kısımlarını Claude ajanlarına bırakın
            </p>
          </div>
        </div>
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

      {/* AI Kullanım Widget'ı */}
      <AiUsageWidget data={aiUsage} />

      {/* Agents grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Ajanlar</h2>
          <Link
            href="/panel/ajanlar/loglar"
            className="inline-flex items-center gap-1 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <Activity size={13} /> Yapılan İşlemler <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {AGENTS.map((a) => {
            const info = statusMap.get(a.id) as any;
            return <AgentTile key={a.id} agent={a} statusInfo={info} />;
          })}
        </div>
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
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>AI kullanımı yükleniyor…</div>
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
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase font-bold tracking-wider" style={{ color: accent }}>
          {title}
        </div>
        <Cpu size={14} style={{ color: accent }} />
      </div>

      {/* Sorgu sayısı büyük */}
      <div className="mb-3">
        <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>
          {formatToken(d?.sorguSayisi ?? 0)}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>API sorgusu</div>
      </div>

      {/* Karar dağılımı */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex items-center gap-1">
          <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#22c55e' }}>
              {formatToken(d?.onaySayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>onay</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <XCircle size={12} style={{ color: '#f59e0b' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#f59e0b' }}>
              {formatToken(d?.atlaSayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>atla</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <HelpCircle size={12} style={{ color: '#94a3b8' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: '#94a3b8' }}>
              {formatToken(d?.eminDegilSayisi ?? 0)}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>?</div>
          </div>
        </div>
      </div>

      {/* Token + Maliyet */}
      <div className="pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between text-xs mb-1">
          <span style={{ color: 'var(--text-muted)' }}>Token</span>
          <span className="tabular-nums font-semibold" style={{ color: 'var(--text)' }}>
            {formatToken(d?.toplamToken ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>Maliyet</span>
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
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          AI Kullanım & Maliyet
        </h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          · Claude Haiku 4.5
        </span>
        <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
          TCMB USD: ₺{USD_TO_TL.toFixed(4)}
        </span>
      </div>

      {/* Bakiye Kartı */}
      <div
        className="rounded-xl p-4 border mb-3 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,.08), rgba(59,130,246,.05))',
          borderColor: 'var(--border)',
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
              <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                ${bakiye.kalanBakiyeUsd.toFixed(4)}
                <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-muted)' }}>
                  (₺{kalanTl.toFixed(2)})
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
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
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={18} style={{ color: '#10b981' }} />
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
                Kontör Yükleme Kaydı
              </h3>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Anthropic hesabınıza yaptığınız yüklemeyi burada kaydedin. Sistem bu tutardan harcamaları düşerek
              bakiyenizi takip eder.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text)' }}>
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
                    background: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text)' }}>
                  Not (opsiyonel)
                </label>
                <input
                  type="text"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.target.value)}
                  placeholder="Nisan 2026 yüklemesi"
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    background: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setTopupOpen(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'transparent', color: 'var(--text-muted)' }}
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
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, color }}
      >
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className="text-xl font-bold tabular-nums" style={{ color }}>
          {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
        </div>
      </div>
    </div>
  );
}

function AgentTile({ agent, statusInfo }: any) {
  const Icon = agent.icon;
  const calisiyor = statusInfo?.running === true;
  return (
    <Link
      href={agent.href}
      className="group relative block rounded-xl p-5 border overflow-hidden transition-all hover:scale-[1.01] hover:shadow-lg"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
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
            <h3 className="font-semibold" style={{ color: 'var(--text)' }}>{agent.title}</h3>
            {!agent.aktif && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}
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
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {agent.desc}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {agent.aktif ? (statusInfo?.lastPing ? `Son: ${new Date(statusInfo.lastPing).toLocaleTimeString('tr-TR')}` : 'Hazır') : '—'}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold transition-transform group-hover:translate-x-0.5" style={{ color: '#b8a06f' }}>
          <Zap size={11} /> Aç <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}
