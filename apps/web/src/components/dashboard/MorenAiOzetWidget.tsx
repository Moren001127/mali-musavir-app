'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, Brain, FileCheck, FileInput, MessageSquare, AlertTriangle } from 'lucide-react';
import { getOfficeBrain } from '@/lib/moren-ai';

const GOLD = '#d4b876';

function metricValue(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export function MorenAiOzetWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['moren-ai-office-widget'],
    queryFn: () => getOfficeBrain(),
    refetchInterval: 60_000,
    retry: false,
  });

  const ozet = data?.briefing?.ozet || {};
  const evrakEksik = metricValue(ozet.evrakEksik);
  const kdvBeyanEksik = metricValue(ozet.kdvKontrolEksik) + metricValue(ozet.beyanEksik);
  const whatsappAday = evrakEksik + metricValue(ozet.borcluMukellef);
  const bugunHata = metricValue(ozet.bugunAgentHata);

  const metrics = [
    { label: 'Evrak', value: evrakEksik, sub: 'bekleyen evrak', icon: FileInput, href: '/panel/hatirlatmalar', color: GOLD },
    { label: 'KDV / Beyan', value: kdvBeyanEksik, sub: 'hazirlik eksigi', icon: FileCheck, href: '/panel/moren-ai', color: '#c0a079' },
    { label: 'WhatsApp', value: whatsappAday, sub: 'aksiyon adayi', icon: MessageSquare, href: '/panel/hatirlatmalar', color: '#4ade80' },
  ];

  return (
    <section
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))',
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.30)',
      }}
    >
      <span
        className="absolute top-0 left-6 right-6 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.5 }}
      />

      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Brain size={14} style={{ color: GOLD }} />
            <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
              MOREN AI
            </span>
          </div>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.52)' }}>
            Portal verisi, mali analiz ve WhatsApp aksiyonlari tek merkezde.
          </p>
        </div>
        <Link
          href="/panel/moren-ai"
          className="text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1 hover:opacity-80 flex-shrink-0"
          style={{ color: 'rgba(250,250,249,0.65)' }}
        >
          Ac <ArrowRight size={11} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="rounded-xl p-3 transition hover:opacity-90 block"
              style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${metric.color}22` }}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon size={12} style={{ color: metric.color }} />
                <span className="text-[9.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                  {metric.label}
                </span>
              </div>
              <p
                className="tabular-nums"
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
                  fontSize: 22,
                  fontWeight: 700,
                  color: isLoading ? 'rgba(250,250,249,0.36)' : '#fafaf9',
                  letterSpacing: 0,
                  lineHeight: 1,
                }}
              >
                {isLoading ? '-' : metric.value}
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
                {metric.sub}
              </p>
            </Link>
          );
        })}
      </div>

      {bugunHata > 0 && (
        <Link
          href="/panel/moren-ai"
          className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-lg transition hover:opacity-90"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)' }}
        >
          <AlertTriangle size={13} style={{ color: '#fca5a5' }} />
          <span className="text-[12px] font-semibold" style={{ color: '#fafaf9' }}>
            Bugun {bugunHata} ajan hatasi var; MOREN AI'a sorup siraya al.
          </span>
        </Link>
      )}
    </section>
  );
}
