'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  FileCheck,
  FileText,
  Loader2,
  Receipt,
  Scale,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';

// Kurumsal duo palet
const GOLD = '#d4b876';
const STEEL_BR = '#74a6e6';
const TEXT = '#f5f5f4';
const MUTED = 'rgba(245,245,244,0.60)';
const FAINT = 'rgba(245,245,244,0.36)';
const HAIR = 'rgba(255,255,255,0.07)';
const FIELD = '#0c0d11';
const GREEN = '#5fcf8e';
const RED = '#ef6b6b';
const SLATE = '#aab6c6';

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
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
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

function normalizeStats(stats: Partial<Stats>): Stats {
  return {
    taxpayerId: stats.taxpayerId ?? '',
    months: stats.months ?? 0,
    since: stats.since ?? '',
    counts: {
      kdvSessions: 0,
      mihsapInvoices: 0,
      earsivInvoices: 0,
      documents: 0,
      receiptImages: 0,
      mizanCount: 0,
      beyanCount: 0,
      aiCalls: 0,
      ...(stats.counts ?? {}),
    },
    aiUsage: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      ...(stats.aiUsage ?? {}),
    },
    cari: {
      tahakkukToplam: 0,
      tahsilatToplam: 0,
      bakiye: 0,
      ...(stats.cari ?? {}),
    },
  };
}

export default function TaxpayerStatsCard({ taxpayerId }: { taxpayerId: string }) {
  const [months, setMonths] = useState<number>(1);

  const { data: stats, isLoading } = useQuery<Partial<Stats>>({
    queryKey: ['taxpayer-stats', taxpayerId, months],
    queryFn: () =>
      api.get(`/taxpayers/${taxpayerId}/stats`, { params: { months } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });

  const s = stats ? normalizeStats(stats) : null;

  const periodSelect = (
    <select
      value={months}
      onChange={(e) => setMonths(parseInt(e.target.value, 10))}
      className="rounded-lg border px-2 py-1 text-[10.5px] outline-none"
      style={{ background: FIELD, borderColor: HAIR, color: TEXT }}
    >
      <option value={1} style={{ background: '#0f0d0b' }}>Son 1 ay</option>
      <option value={3} style={{ background: '#0f0d0b' }}>Son 3 ay</option>
      <option value={6} style={{ background: '#0f0d0b' }}>Son 6 ay</option>
      <option value={12} style={{ background: '#0f0d0b' }}>Son 12 ay</option>
    </select>
  );

  if (isLoading || !s) {
    return (
      <div className="border-b p-4" style={{ borderColor: HAIR }}>
        <div className="flex items-center gap-2 py-3 text-[12.5px]" style={{ color: MUTED }}>
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      </div>
    );
  }

  const tahsilatPct = s.cari.tahakkukToplam > 0
    ? Math.min(100, Math.round((s.cari.tahsilatToplam / s.cari.tahakkukToplam) * 100))
    : 0;
  const borc = s.cari.bakiye > 0;

  const items = [
    { icon: FileCheck, label: 'KDV Kontrol',  value: s.counts.kdvSessions,    color: GOLD },
    { icon: Receipt,   label: 'Mihsap Fatura', value: s.counts.mihsapInvoices, color: STEEL_BR },
    { icon: FileText,  label: 'E-Arşiv',       value: s.counts.earsivInvoices, color: GREEN },
    { icon: Scale,     label: 'Mizan',         value: s.counts.mizanCount,     color: SLATE },
    { icon: FileCheck, label: 'Beyanname',     value: s.counts.beyanCount,     color: GOLD },
    { icon: Archive,   label: 'Evrak',         value: s.counts.documents,      color: SLATE },
  ];

  return (
    <>
      {/* CARİ BAKİYE */}
      <div className="border-b p-4" style={{ borderColor: HAIR }}>
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
            <Wallet size={13} style={{ color: STEEL_BR }} /> Cari Bakiye
          </span>
          {periodSelect}
        </div>
        <div className="mb-2.5 flex items-end justify-between">
          <span className="text-[27px] font-extrabold tabular-nums" style={{ color: TEXT, letterSpacing: '-0.01em' }}>
            {fmtTRY(Math.abs(s.cari.bakiye))} ₺
          </span>
          <span
            className="rounded-lg border px-2.5 py-[3px] text-[11px] font-bold"
            style={borc
              ? { background: 'rgba(239,107,107,0.12)', borderColor: 'rgba(239,107,107,0.28)', color: RED }
              : { background: 'rgba(95,207,142,0.12)', borderColor: 'rgba(95,207,142,0.28)', color: GREEN }}
          >
            {borc ? 'Borç' : 'Alacak'}
          </span>
        </div>
        <div className="h-[7px] overflow-hidden rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <span className="block h-full rounded-md" style={{ width: `${tahsilatPct}%`, background: `linear-gradient(90deg, ${GREEN}, #37b26c)` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px]" style={{ color: MUTED }}>
          <span>Tahakkuk <b style={{ color: 'rgba(245,245,244,0.85)', fontWeight: 600 }}>{fmtTRY(s.cari.tahakkukToplam)} ₺</b></span>
          <span>Tahsilat <b style={{ color: 'rgba(245,245,244,0.85)', fontWeight: 600 }}>{fmtTRY(s.cari.tahsilatToplam)} ₺</b></span>
        </div>
      </div>

      {/* İŞ YÜKÜ */}
      <div className="border-b p-4" style={{ borderColor: HAIR }}>
        <div className="mb-3 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
          <BarChart3 size={13} style={{ color: STEEL_BR }} /> İş Yükü · Son {months} ay
        </div>
        <div className="grid grid-cols-2 gap-2">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-2.5 rounded-xl border p-[10px]" style={{ borderColor: HAIR, background: FIELD }}>
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg" style={{ background: `${it.color}22`, color: it.color }}>
                <it.icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.04em]" style={{ color: FAINT }}>{it.label}</span>
                <span className="block text-[17px] font-extrabold leading-none tabular-nums" style={{ color: TEXT, fontFamily: 'JetBrains Mono, monospace' }}>
                  {it.value.toLocaleString('tr-TR')}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
