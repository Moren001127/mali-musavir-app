'use client';
import { useQuery } from '@tanstack/react-query';
import { agentsApi, AGENTS } from '@/lib/agents';
import { Bot, Activity, Play, Pause, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

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

  const statusMap = new Map(status.map((s: any) => [s.agent, s]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            Otomasyon Ajanları
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Ofis operasyonlarını otomatikleştiren yapay zeka ajanları — canlı durum
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
        <StatBox label="Bu Ay İşlenen" value={stats?.buAy ?? 0} color="var(--green-500)" />
        <StatBox label="Bugün Log" value={stats?.buGun ?? 0} color="var(--navy-500)" />
        <StatBox label="Hata (24 saat)" value={stats?.hataBugun ?? 0} color="var(--red-500)" />
        <StatBox label="Toplam Log" value={stats?.toplam ?? 0} color="var(--text-muted)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {AGENTS.map((a) => {
          const s: any = statusMap.get(a.id);
          const calisiyor = s?.running === true;
          const hedefAy = s?.hedefAy;
          const lastPing = s?.lastPing ? new Date(s.lastPing) : null;
          return (
            <div
              key={a.id}
              className="rounded-xl p-5 border"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      background: a.aktif ? 'var(--navy-50)' : 'var(--muted)',
                      color: a.aktif ? 'var(--navy-500)' : 'var(--text-muted)',
                    }}
                  >
                    <Bot size={18} />
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--text)' }}>
                      {a.ad}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {a.desc}
                    </div>
                  </div>
                </div>
                <StatusBadge calisiyor={calisiyor} aktif={a.aktif} />
              </div>

              <div className="flex items-center gap-4 text-xs pt-3 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                {hedefAy && <span>Hedef ay: <strong>{hedefAy}</strong></span>}
                {lastPing && (
                  <span>Son ping: {lastPing.toLocaleString('tr-TR')}</span>
                )}
                {!s && <span>Hiç ping almadı</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="rounded-xl p-4 text-sm border"
        style={{ background: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        <strong>Not:</strong> Ajanlar yerel bilgisayarınızda çalışır; her işlemde portal'a canlı rapor gönderir.
        Uzaktan Başlat/Durdur kontrolü sonraki sürümde aktif olacak (WebSocket üzerinden).
      </div>
    </div>
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

function StatusBadge({ calisiyor, aktif }: { calisiyor: boolean; aktif: boolean }) {
  if (!aktif) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'var(--muted)', color: 'var(--text-muted)' }}
      >
        Yakında
      </span>
    );
  }
  if (calisiyor) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'rgba(16,185,129,.15)', color: 'var(--green-500)' }}
      >
        <Play size={11} />
        Çalışıyor
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: 'rgba(245,158,11,.15)', color: 'var(--gold)' }}
    >
      <Pause size={11} />
      Beklemede
    </span>
  );
}
