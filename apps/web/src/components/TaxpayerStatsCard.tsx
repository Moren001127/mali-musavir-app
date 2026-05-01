'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  Brain,
  FileCheck,
  FileText,
  Image as ImageIcon,
  Loader2,
  Receipt,
  Scale,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';

type Stats = {
  taxpayerId: string;
  months: number;
  since: string;
  counts: {
    kdvSessions: number;
    mihsapInvoices: number;
    earsivInvoices: number;
    documents: number;
    receiptImages: number;
    mizanCount: number;
    beyanCount: number;
    aiCalls: number;
  };
  aiUsage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  cari: {
    tahakkukToplam: number;
    tahsilatToplam: number;
    bakiye: number;
  };
};

function fmtTRY(n: number): string {
  if (!isFinite(n)) return '0,00';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUSD(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1_000_000).toFixed(1) + 'M';
}

export default function TaxpayerStatsCard({ taxpayerId }: { taxpayerId: string }) {
  const [months, setMonths] = useState<number>(1);

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['taxpayer-stats', taxpayerId, months],
    queryFn: () =>
      api.get(`/taxpayers/${taxpayerId}/stats`, { params: { months } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const items = stats
    ? [
        { icon: FileCheck, label: 'KDV Kontrol', value: stats.counts.kdvSessions, color: GOLD },
        { icon: Receipt, label: 'Mihsap Fatura', value: stats.counts.mihsapInvoices, color: '#3b82f6' },
        { icon: FileText, label: 'E-Arşiv', value: stats.counts.earsivInvoices, color: '#10b981' },
        { icon: ImageIcon, label: 'Fiş Görüntü', value: stats.counts.receiptImages, color: '#f59e0b' },
        { icon: Scale, label: 'Mizan', value: stats.counts.mizanCount, color: '#a78bfa' },
        { icon: FileText, label: 'Beyanname', value: stats.counts.beyanCount, color: '#ef4444' },
        { icon: FileText, label: 'Evrak', value: stats.counts.documents, color: '#94a3b8' },
        { icon: Brain, label: 'AI Çağrı', value: stats.counts.aiCalls, color: '#d4b876' },
      ]
    : [];

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: GOLD }} />
          <span
            className="text-[11px] uppercase font-bold tracking-[.12em]"
            style={{ color: 'rgba(250,250,249,0.7)' }}
          >
            Karlılık & İş Yükü
          </span>
        </div>
        <select
          value={months}
          onChange={(e) => setMonths(parseInt(e.target.value, 10))}
          className="px-2 py-1 rounded text-[11px] border outline-none"
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderColor: 'rgba(255,255,255,0.08)',
            color: '#fafaf9',
          }}
        >
          <option value={1} style={{ background: '#0f0d0b' }}>Son 1 ay</option>
          <option value={3} style={{ background: '#0f0d0b' }}>Son 3 ay</option>
          <option value={6} style={{ background: '#0f0d0b' }}>Son 6 ay</option>
          <option value={12} style={{ background: '#0f0d0b' }}>Son 12 ay</option>
        </select>
      </div>

      {isLoading ? (
        <div
          className="flex items-center gap-2 text-sm py-4"
          style={{ color: 'rgba(250,250,249,0.5)' }}
        >
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : !stats ? (
        <div
          className="text-sm py-4"
          style={{ color: 'rgba(250,250,249,0.4)' }}
        >
          Veri alınamadı.
        </div>
      ) : (
        <>
          {/* Sayaç grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {items.map((it, i) => (
              <div
                key={i}
                className="rounded-lg p-2.5 border"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  borderColor: 'rgba(255,255,255,0.05)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <it.icon size={11} style={{ color: it.color }} />
                  <span
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: 'rgba(250,250,249,0.5)' }}
                  >
                    {it.label}
                  </span>
                </div>
                <div
                  className="text-lg font-bold tabular-nums"
                  style={{ color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {it.value.toLocaleString('tr-TR')}
                </div>
              </div>
            ))}
          </div>

          {/* Detay satırları */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Cari kasa */}
            <div
              className="rounded-lg p-3 border"
              style={{
                background: 'rgba(255,255,255,0.02)',
                borderColor: 'rgba(255,255,255,0.05)',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Wallet size={12} style={{ color: GOLD }} />
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  Cari Kasa (toplam)
                </span>
              </div>
              <div className="flex justify-between text-[11px] mb-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                <span>Tahakkuk</span>
                <span style={{ color: 'rgba(250,250,249,0.85)' }}>{fmtTRY(stats.cari.tahakkukToplam)} ₺</span>
              </div>
              <div className="flex justify-between text-[11px] mb-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                <span>Tahsilat</span>
                <span style={{ color: 'rgba(250,250,249,0.85)' }}>{fmtTRY(stats.cari.tahsilatToplam)} ₺</span>
              </div>
              <div className="flex justify-between text-[12px] pt-1 mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: GOLD, fontWeight: 600 }}>Bakiye</span>
                <span
                  style={{
                    color: stats.cari.bakiye > 0 ? '#ef4444' : '#10b981',
                    fontWeight: 700,
                  }}
                >
                  {fmtTRY(stats.cari.bakiye)} ₺
                </span>
              </div>
            </div>

            {/* AI maliyeti */}
            <div
              className="rounded-lg p-3 border"
              style={{
                background: 'rgba(255,255,255,0.02)',
                borderColor: 'rgba(255,255,255,0.05)',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Brain size={12} style={{ color: '#d4b876' }} />
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  Moren AI Kullanım
                </span>
              </div>
              <div className="flex justify-between text-[11px] mb-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                <span>Çağrı sayısı</span>
                <span style={{ color: 'rgba(250,250,249,0.85)' }}>{stats.aiUsage.calls}</span>
              </div>
              <div className="flex justify-between text-[11px] mb-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                <span>Token (in / out)</span>
                <span style={{ color: 'rgba(250,250,249,0.85)' }}>
                  {fmtTokens(stats.aiUsage.inputTokens)} / {fmtTokens(stats.aiUsage.outputTokens)}
                </span>
              </div>
              <div className="flex justify-between text-[12px] pt-1 mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: GOLD, fontWeight: 600 }}>Maliyet</span>
                <span style={{ color: '#fafaf9', fontWeight: 700 }}>
                  {fmtUSD(stats.aiUsage.costUsd)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
