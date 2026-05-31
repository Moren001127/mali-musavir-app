'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coins, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const SOFT = 'rgba(255,255,255,0.035)';
const GREEN = '#4ade80';
const RED = '#f87171';

type ModuleCost = {
  module: string;
  sources: string[];
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
};
type Summary = {
  month: string;
  totalUsd: number;
  totalCalls: number;
  previousMonth: string;
  previousTotalUsd: number;
  modules: ModuleCost[];
};

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: `${aylar[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

const usd = (n: number) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tl = (n: number, kur: number) =>
  `${((n || 0) * kur).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₺`;

export default function MaliyetPage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [kur, setKur] = useState(41);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ai-cost', month],
    queryFn: () => api.get(`/ai-cost/summary?month=${month}`).then((r) => r.data as Summary),
  });

  const total = data?.totalUsd || 0;
  const prev = data?.previousTotalUsd || 0;
  const diff = total - prev;
  const diffPct = prev > 0 ? Math.round((diff / prev) * 100) : 0;
  const maxModule = Math.max(1, ...(data?.modules || []).map((m) => m.costUsd));

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <header className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: MUTED }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="text-[28px] font-semibold leading-tight flex items-center gap-2" style={{ color: TEXT }}>
            <Coins size={26} style={{ color: GOLD }} /> AI Maliyet
          </h1>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-semibold"
            style={{ borderColor: LINE, color: TEXT }}
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          Tüm yapay zekâ harcamalarının tek yerde, modül bazında gerçek dökümü. Rakamlar her çağrının kaydedilen gerçek maliyetinden gelir — yeni bir modül eklendiğinde otomatik buraya dahil olur.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border bg-transparent px-3 py-2 text-[13px]"
            style={{ borderColor: LINE, color: TEXT }}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value} style={{ background: '#0f0d0b' }}>{m.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
            <span>USD/TL kuru:</span>
            <input
              type="number"
              value={kur}
              onChange={(e) => setKur(Number(e.target.value) || 0)}
              className="w-20 rounded-md border bg-transparent px-2 py-1.5 text-[13px]"
              style={{ borderColor: LINE, color: TEXT }}
            />
          </div>
        </div>
      </header>

      {/* Toplam kartı */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-[#0f0d0b]/80 p-5 sm:col-span-2" style={{ borderColor: LINE }}>
          <div className="text-[12px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>
            Bu ay toplam ({data?.month || '—'})
          </div>
          <div className="mt-1 text-[40px] font-semibold leading-none" style={{ color: TEXT }}>{usd(total)}</div>
          <div className="mt-1 text-[15px]" style={{ color: GOLD }}>≈ {tl(total, kur)}</div>
          <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: diff > 0 ? RED : GREEN }}>
            {diff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>
              Önceki ay ({data?.previousMonth || '—'}): {usd(prev)} · {diff >= 0 ? '+' : ''}{diffPct}%
            </span>
          </div>
        </div>
        <div className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
          <div className="text-[12px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Toplam çağrı</div>
          <div className="mt-1 text-[40px] font-semibold leading-none" style={{ color: TEXT }}>
            {(data?.totalCalls || 0).toLocaleString('tr-TR')}
          </div>
          <div className="mt-1 text-[12px]" style={{ color: MUTED }}>AI/OCR çağrısı</div>
        </div>
      </section>

      {/* Modül dökümü */}
      <section className="rounded-lg border bg-[#0f0d0b]/80 p-5" style={{ borderColor: LINE }}>
        <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>Modül bazında döküm</h2>

        {isLoading ? (
          <div className="mt-4 text-[13px]" style={{ color: MUTED }}>Yükleniyor…</div>
        ) : !data?.modules?.length ? (
          <div className="mt-4 text-[13px]" style={{ color: MUTED }}>Bu ay için kayıtlı AI harcaması yok.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {data.modules.map((m) => {
              const pct = total > 0 ? Math.round((m.costUsd / total) * 100) : 0;
              const barW = Math.round((m.costUsd / maxModule) * 100);
              return (
                <div key={m.module} className="rounded-md border p-3" style={{ borderColor: LINE, background: SOFT }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[13.5px] font-medium" style={{ color: TEXT }}>{m.module}</div>
                    <div className="text-right">
                      <div className="text-[14px] font-semibold" style={{ color: TEXT }}>{usd(m.costUsd)}</div>
                      <div className="text-[11px]" style={{ color: GOLD }}>≈ {tl(m.costUsd, kur)}</div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${barW}%`, background: GOLD }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]" style={{ color: MUTED }}>
                    <span>{m.calls.toLocaleString('tr-TR')} çağrı · toplam %{pct}</span>
                    <span>{(m.inputTokens + m.outputTokens).toLocaleString('tr-TR')} token</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
