'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

interface CompletenessField {
  key: string;
  label: string;
  tier: 'KRITIK' | 'ONEMLI' | 'YARARLI';
  ok: boolean;
}

interface CompletenessData {
  taxpayerId: string;
  score: number;
  durum: 'TAM' | 'IYI' | 'EKSIK' | 'KRITIK_EKSIK';
  kritikEksikSayisi: number;
  eksikSayisi: number;
  fields: CompletenessField[];
  eksikler: CompletenessField[];
  breakdown: {
    kritik: { dolu: number; toplam: number; puan: number };
    onemli: { dolu: number; toplam: number; puan: number };
    yararli: { dolu: number; toplam: number; puan: number };
  };
}

const STATUS_CONFIG: Record<CompletenessData['durum'], { label: string; color: string; bg: string; icon: any }> = {
  TAM:           { label: 'Profil Tam',          color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  icon: CheckCircle2 },
  IYI:           { label: 'İyi Durumda',         color: '#84cc16', bg: 'rgba(132,204,22,0.10)', icon: CheckCircle2 },
  EKSIK:         { label: 'Eksiklikler Var',     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: AlertTriangle },
  KRITIK_EKSIK:  { label: 'KRİTİK Eksik',        color: '#ef4444', bg: 'rgba(239,68,68,0.14)',  icon: AlertTriangle },
};

const TIER_LABEL: Record<CompletenessField['tier'], string> = {
  KRITIK: 'Kritik (zorunlu)',
  ONEMLI: 'Önemli',
  YARARLI: 'Yararlı',
};

const TIER_COLOR: Record<CompletenessField['tier'], string> = {
  KRITIK: '#ef4444',
  ONEMLI: '#f59e0b',
  YARARLI: '#94a3b8',
};

export function ProfilTamamlikBanner({ taxpayerId }: { taxpayerId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery<CompletenessData>({
    queryKey: ['taxpayer-completeness', taxpayerId],
    queryFn: () => api.get(`/taxpayers/${taxpayerId}/completeness`).then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;
  // Tam profil için banner göstermeyelim
  if (data.durum === 'TAM') return null;

  const cfg = STATUS_CONFIG[data.durum];
  const Icon = cfg.icon;

  return (
    <div
      className="rounded-xl mb-5 overflow-hidden"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.color}33`,
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${cfg.color}22`, border: `1px solid ${cfg.color}55` }}>
          <Icon size={16} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-bold" style={{ color: '#fafaf9' }}>
              {cfg.label}
            </span>
            <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded"
              style={{ background: `${cfg.color}22`, color: cfg.color }}>
              %{data.score}
            </span>
            {data.kritikEksikSayisi > 0 && (
              <span className="text-[10.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
                {data.kritikEksikSayisi} KRİTİK EKSİK
              </span>
            )}
          </div>
          <div className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
            {data.eksikSayisi} eksik alan var — tıkla detayları gör
          </div>
        </div>
        {expanded ? (
          <ChevronDown size={16} style={{ color: 'rgba(250,250,249,0.5)' }} />
        ) : (
          <ChevronRight size={16} style={{ color: 'rgba(250,250,249,0.5)' }} />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {/* Skor breakdown */}
          <div className="grid grid-cols-3 gap-2 mb-4 mt-3">
            <BreakdownTile label="Kritik" data={data.breakdown.kritik} max={50} color="#ef4444" />
            <BreakdownTile label="Önemli" data={data.breakdown.onemli} max={30} color="#f59e0b" />
            <BreakdownTile label="Yararlı" data={data.breakdown.yararli} max={20} color="#94a3b8" />
          </div>

          {/* Eksik alanlar */}
          <div className="space-y-1.5">
            <div className="text-[10.5px] uppercase font-bold tracking-[.12em] mb-2"
              style={{ color: 'rgba(250,250,249,0.5)' }}>
              Eksik alanlar
            </div>
            {data.eksikler.map((f) => (
              <div
                key={f.key}
                className="flex items-center gap-2 text-[12.5px] px-2 py-1.5 rounded"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <span className="w-1 h-3 rounded-sm" style={{ background: TIER_COLOR[f.tier] }} />
                <span style={{ color: '#fafaf9' }}>{f.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider"
                  style={{ color: TIER_COLOR[f.tier] }}>
                  {TIER_LABEL[f.tier]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownTile({ label, data, max, color }: any) {
  const pct = Math.round((data.dolu / data.toplam) * 100);
  return (
    <div className="rounded-lg p-2.5"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="tabular-nums text-[16px] font-bold" style={{ color: '#fafaf9' }}>
          {data.dolu}/{data.toplam}
        </span>
        <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          (%{pct})
        </span>
      </div>
      <div className="text-[10.5px] mt-0.5 tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {data.puan}/{max} puan
      </div>
    </div>
  );
}
