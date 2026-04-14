'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { agentsApi } from '@/lib/agents';
import { api } from '@/lib/api';
import {
  Bot, Receipt, FileInput, Mailbox, Calculator, BookOpen, ShieldCheck,
  Activity, CheckCircle2, Clock, ArrowRight, Sparkles, TrendingUp, AlertCircle, Zap,
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
