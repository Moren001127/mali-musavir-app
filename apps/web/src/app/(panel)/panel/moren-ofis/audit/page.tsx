'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Wrench, AlertCircle, Clock, BarChart3, CheckCircle2, XCircle, Filter } from 'lucide-react';
import { ofisApi } from '@/lib/moren-ofis';

const GOLD = '#d4b876';

export default function ToolAuditPage() {
  const [toolFilter, setToolFilter] = useState<string>('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');

  const filters = (() => {
    const f: any = {};
    if (toolFilter) f.tool = toolFilter;
    if (onlyFailures) f.onlyFailures = true;
    if (dateRange !== 'all') {
      const now = new Date();
      const from = new Date(now);
      if (dateRange === 'today') from.setHours(0, 0, 0, 0);
      else if (dateRange === 'week') from.setDate(now.getDate() - 7);
      else if (dateRange === 'month') from.setDate(now.getDate() - 30);
      f.from = from.toISOString();
    }
    return f;
  })();

  const { data, isLoading } = useQuery({
    queryKey: ['tool-audit', filters],
    queryFn: () => ofisApi.toolAudit(filters),
    refetchInterval: 15_000,
  });

  const { data: cost } = useQuery({
    queryKey: ['moren-ofis-cost'],
    queryFn: ofisApi.costSummary,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
          <Activity size={11} className="inline mr-1" /> Moren AI
        </div>
        <h1 className="mt-1" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafaf9' }}>
          Tool & Maliyet Denetimi
        </h1>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
          AI ekiplerin sistemden çektiği veriyi ve LLM harcamalarını gözle. Kaçak yakalanır.
        </p>
      </div>

      {/* Filtreler */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(212,184,118,0.20)' }}>
        <Filter size={12} style={{ color: 'rgba(250,250,249,0.55)' }} />
        <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>Filtre:</span>

        {/* Tarih aralığı */}
        {(['all', 'today', 'week', 'month'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDateRange(d)}
            className="px-2.5 py-1 rounded text-[10.5px] uppercase tracking-wider font-bold"
            style={{
              background: dateRange === d ? `${GOLD}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${dateRange === d ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`,
              color: dateRange === d ? GOLD : 'rgba(250,250,249,0.55)',
            }}
          >
            {d === 'all' ? 'Tümü' : d === 'today' ? 'Bugün' : d === 'week' ? 'Hafta' : 'Ay'}
          </button>
        ))}

        <span className="mx-1" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>

        {/* Tool dropdown */}
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="px-2 py-1 rounded text-[11px] outline-none"
          style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.10)', color: '#fafaf9' }}
        >
          <option value="">Tüm tool'lar</option>
          {data?.allTools?.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <span className="mx-1" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>

        {/* Yalnız hatalar */}
        <button
          onClick={() => setOnlyFailures(!onlyFailures)}
          className="px-2.5 py-1 rounded text-[10.5px] uppercase tracking-wider font-bold flex items-center gap-1"
          style={{
            background: onlyFailures ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${onlyFailures ? 'rgba(239,68,68,0.40)' : 'rgba(255,255,255,0.08)'}`,
            color: onlyFailures ? '#fca5a5' : 'rgba(250,250,249,0.55)',
          }}
        >
          <XCircle size={10} /> Sadece Hata
        </button>
      </div>

      {/* Üst metrik kartlar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Toplam Tool Çağrısı"
          value={isLoading ? '—' : String(data?.total || 0)}
          icon={Wrench}
        />
        <MetricCard
          label="Başarı Oranı"
          value={isLoading ? '—' : `${data ? Math.round((1 - data.failureRate) * 100) : 0}%`}
          icon={CheckCircle2}
          tone={data && data.failureRate > 0.1 ? 'danger' : data && data.failureRate > 0.05 ? 'warn' : 'ok'}
        />
        <MetricCard
          label="Hatalı Çağrı"
          value={isLoading ? '—' : String(data?.failures || 0)}
          icon={XCircle}
          tone={data && data.failures > 0 ? 'warn' : 'ok'}
        />
        <MetricCard
          label="Toplam AI Maliyeti"
          value={cost ? formatCost(cost.total) : '—'}
          subtitle={cost ? `bugün ${formatCost(cost.today)}` : undefined}
          icon={BarChart3}
        />
      </div>

      {/* Tool başına istatistik */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)' }}>
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
            Tool Başına İstatistik
          </span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor...</div>
        ) : !data?.stats?.length ? (
          <div className="p-10 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Henüz tool çağrı kaydı yok.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Tool</th>
                <th className="text-right px-4 py-2 font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Çağrı</th>
                <th className="text-right px-4 py-2 font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Ort. ms</th>
                <th className="text-right px-4 py-2 font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Toplam Byte</th>
              </tr>
            </thead>
            <tbody>
              {data.stats.map((s) => (
                <tr key={s.tool} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <td className="px-4 py-2 font-mono" style={{ color: GOLD }}>{s.tool}</td>
                  <td className="text-right px-4 py-2" style={{ color: '#fafaf9' }}>{s.count}</td>
                  <td className="text-right px-4 py-2 font-mono" style={{ color: s.avgMs > 2000 ? '#fbbf24' : 'rgba(250,250,249,0.7)' }}>
                    {s.avgMs}
                  </td>
                  <td className="text-right px-4 py-2 font-mono" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    {formatBytes(s.totalBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Son tool çağrıları */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)' }}>
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
            Son 50 Tool Çağrısı
          </span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor...</div>
        ) : !data?.recent?.length ? (
          <div className="p-10 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Henüz tool çağrı kaydı yok.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {data.recent.map((r) => (
              <div
                key={r.id}
                className="px-4 py-2 flex items-center gap-2 text-[11.5px]"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: r.ok ? '#86efac' : '#fca5a5' }}
                />
                <span className="font-mono flex-shrink-0" style={{ color: GOLD, width: 180 }}>
                  {r.tool}
                </span>
                <span className="text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {r.caller}
                </span>
                <span className="font-mono flex-shrink-0 w-12 text-right" style={{ color: r.durationMs > 2000 ? '#fbbf24' : 'rgba(250,250,249,0.55)' }}>
                  {r.durationMs}ms
                </span>
                {!r.ok && r.errorMsg && (
                  <span className="text-[10px] flex items-center gap-1 truncate" style={{ color: '#fca5a5' }}>
                    <AlertCircle size={10} /> {r.errorMsg}
                  </span>
                )}
                <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  {new Date(r.ts).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ajan başına maliyet (varsa) */}
      {cost && cost.byAgent.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)' }}>
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
              Ajan Başına Harcama (toplam)
            </span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {cost.byAgent.map((a) => (
              <div key={a.agent} className="px-3 py-2 rounded" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-[10px] uppercase font-bold tracking-wider" style={{ color: GOLD }}>{a.agent}</p>
                <p className="text-[16px] font-bold mt-0.5" style={{ fontFamily: 'Fraunces, serif', color: '#fafaf9' }}>
                  {formatCost(a.cost)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, subtitle, icon: Icon, tone }: {
  label: string; value: string; subtitle?: string; icon: any; tone?: 'ok' | 'warn' | 'danger';
}) {
  const color = tone === 'danger' ? '#fca5a5' : tone === 'warn' ? '#fbbf24' : '#fafaf9';
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(255,255,255,0.012))',
        border: '1px solid rgba(212,184,118,0.20)',
      }}
    >
      <span
        className="absolute top-0 left-4 right-4 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.4 }}
      />
      <div className="flex items-center gap-2 mb-2">
        <Icon size={12} style={{ color: GOLD, opacity: 0.7 }} />
        <span className="text-[10px] uppercase font-semibold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {label}
        </span>
      </div>
      <p style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color, lineHeight: 1 }}>
        {value}
      </p>
      {subtitle && (
        <p className="text-[10.5px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>{subtitle}</p>
      )}
    </div>
  );
}

function formatCost(usd: number) {
  if (usd < 0.01) return `${(usd * 100).toFixed(1)}¢`;
  if (usd < 1) return `${(usd * 100).toFixed(0)}¢`;
  return `$${usd.toFixed(2)}`;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
