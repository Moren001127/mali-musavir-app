'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ShieldCheck, DollarSign, Sparkles, ArrowRight, AlertTriangle, Brain } from 'lucide-react';
import { ofisApi } from '@/lib/moren-ofis';
import { pendingActionsApi } from '@/lib/pending-actions';

const GOLD = '#d4b876';

function fmtCost(usd: number) {
  if (usd === 0) return '—';
  if (usd < 0.01) return `${(usd * 100).toFixed(1)}¢`;
  if (usd < 1) return `${(usd * 100).toFixed(0)}¢`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Dashboard'a yerleştirilen Moren AI özet widget'ı. Üç hızlı bilgi:
 *  - Bugünkü AI maliyeti
 *  - Bekleyen AI onay sayısı (var ise vurgulu)
 *  - DENİZ'in son açık önerisi (high priority varsa kırmızı şerit)
 */
export function MorenAiOzetWidget() {
  const { data: cost } = useQuery({
    queryKey: ['moren-ofis-cost'],
    queryFn: ofisApi.costSummary,
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: pending = [] } = useQuery({
    queryKey: ['ai-onay-widget'],
    queryFn: () => pendingActionsApi.list({ status: 'pending', limit: 5 }),
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: proposals = [] } = useQuery({
    queryKey: ['moren-ofis-proposals-open'],
    queryFn: () => ofisApi.proposals('open'),
    refetchInterval: 60_000,
    retry: false,
  });

  const criticalPending = pending.filter(
    (p) => p.riskLevel === 'high' || p.riskLevel === 'critical',
  ).length;
  const topProposal = proposals[0];

  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))',
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.30)',
      }}
    >
      {/* Üst altın hairline */}
      <span
        className="absolute top-0 left-6 right-6 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          opacity: 0.5,
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={14} style={{ color: GOLD }} />
          <span
            className="text-[10.5px] uppercase font-bold tracking-[.18em]"
            style={{ color: GOLD }}
          >
            Moren AI Özeti
          </span>
        </div>
        <Link
          href="/panel/moren-ofis"
          className="text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1 hover:opacity-80"
          style={{ color: 'rgba(250,250,249,0.55)' }}
        >
          Aç <ArrowRight size={11} />
        </Link>
      </div>

      {/* 3 metrik */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* AI Maliyet */}
        <Link
          href="/panel/moren-ofis/audit"
          className="rounded-xl p-3 transition hover:opacity-90 block"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSign size={11} style={{ color: GOLD, opacity: 0.7 }} />
            <span className="text-[9.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Bugün
            </span>
          </div>
          <p
            className="tabular-nums"
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: cost && cost.today > 0 ? '#fafaf9' : 'rgba(250,250,249,0.45)',
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {cost ? fmtCost(cost.today) : '—'}
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {cost ? `${cost.msgCount} mesaj toplam` : ''}
          </p>
        </Link>

        {/* Bekleyen Onay */}
        <Link
          href="/panel/ai-onay"
          className="rounded-xl p-3 transition hover:opacity-90 block"
          style={{
            background: criticalPending > 0 ? 'rgba(239,68,68,0.08)' : pending.length > 0 ? 'rgba(212,184,118,0.08)' : 'rgba(255,255,255,0.025)',
            border: `1px solid ${criticalPending > 0 ? 'rgba(239,68,68,0.28)' : pending.length > 0 ? 'rgba(212,184,118,0.28)' : 'rgba(255,255,255,0.06)'}`,
          }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <ShieldCheck size={11} style={{ color: GOLD, opacity: 0.7 }} />
            <span className="text-[9.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Bekleyen
            </span>
          </div>
          <p
            className="tabular-nums"
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: criticalPending > 0 ? '#fca5a5' : pending.length > 0 ? GOLD : 'rgba(250,250,249,0.45)',
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {pending.length}
          </p>
          <p className="text-[10px] mt-1" style={{ color: criticalPending > 0 ? '#fca5a5' : 'rgba(250,250,249,0.45)' }}>
            {criticalPending > 0 ? `${criticalPending} kritik!` : 'onay aksiyonu'}
          </p>
        </Link>

        {/* Açık Öneri */}
        <Link
          href="/panel/moren-ofis"
          className="rounded-xl p-3 transition hover:opacity-90 block"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles size={11} style={{ color: GOLD, opacity: 0.7 }} />
            <span className="text-[9.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
              DENİZ
            </span>
          </div>
          <p
            className="tabular-nums"
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: proposals.length > 0 ? '#fafaf9' : 'rgba(250,250,249,0.45)',
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {proposals.length}
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            açık öneri
          </p>
        </Link>
      </div>

      {/* DENİZ son öneri preview (varsa) */}
      {topProposal && (
        <Link
          href="/panel/moren-ofis"
          className="block px-3 py-2.5 rounded-lg transition hover:opacity-90"
          style={{
            background: topProposal.priority === 'high' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${topProposal.priority === 'high' ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.05)'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            {topProposal.priority === 'high' && (
              <AlertTriangle size={11} style={{ color: '#fca5a5' }} />
            )}
            <span
              className="text-[9.5px] uppercase font-bold tracking-wider"
              style={{ color: topProposal.priority === 'high' ? '#fca5a5' : GOLD }}
            >
              Son öneri · {topProposal.priority}
            </span>
            <span className="text-[9.5px] ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
              {new Date(topProposal.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
          <p className="text-[12.5px] font-semibold line-clamp-1" style={{ color: '#fafaf9' }}>
            {topProposal.title}
          </p>
          <p className="text-[11px] line-clamp-1 mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {topProposal.description}
          </p>
        </Link>
      )}
    </div>
  );
}
