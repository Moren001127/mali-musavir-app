'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Inbox, CheckCircle2, AlertTriangle, Send, Sparkles,
  Users, Cloud, TrendingUp, ArrowRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName, taxpayerBookType } from '../_lib/taxpayer';

type Props = {
  taxpayerId?: string;
  period: string;
  taxpayers: Array<any>;
  dashData?: any;
  dashLoading?: boolean;
};

/* Renk paleti her metrik kart icin */
const METRIC_CARDS = [
  { key: 'pending',  label: 'Bekleyen Belge',     color: '#60a5fa', icon: Inbox },
  { key: 'conflict', label: 'İcerik Celiskili',    color: '#f59e0b', icon: AlertTriangle },
  { key: 'posted',   label: "Luca'ya Aktarilan",   color: '#4ade80', icon: Send },
  { key: 'autoRate', label: 'Otomatik İsabet %',   color: '#2dd4bf', icon: Sparkles },
];

export default function GenelBakisPanel({ taxpayerId, period, taxpayers, dashData, dashLoading }: Props) {
  /* Per-mukellef ozet */
  const summaryQ = useQuery({
    queryKey: ['fatura-merkezi', 'per-taxpayer-summary', period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });

  /* Entegrator durumu */
  const integrationsQ = useQuery({
    queryKey: ['fatura-merkezi', 'integrations-overview'],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/integrations')
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });

  const d = dashData || {};
  const metricValues: Record<string, number> = {
    pending:  d.pending  ?? 0,
    conflict: d.conflict ?? 0,
    posted:   d.posted   ?? 0,
    autoRate: d.autoRate ?? 0,
  };

  const summaryRows: any[] = summaryQ.data || [];
  const integrations: any[] = integrationsQ.data || [];

  /* Mukellef tablosu icin veri birlestir */
  const summaryMap = new Map(summaryRows.map((s: any) => [s.taxpayerId, s]));
  const tableRows = taxpayers
    .filter((t) => !taxpayerId || t.id === taxpayerId)
    .map((t) => {
      const s: any = summaryMap.get(t.id) || {};
      const gelen = (s.pendingAlis || 0) + (s.pendingSatis || 0);
      const onay  = (s.approvedAlis || 0) + (s.approvedSatis || 0);
      const aktar = s.postedToLuca || 0;
      const total = gelen + onay + aktar;
      return { ...t, gelen, onay, aktar, total };
    })
    .sort((a, b) => b.gelen - a.gelen);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>

      {/* 4 metrik kart */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {METRIC_CARDS.map((card) => {
          const Icon = card.icon;
          const value = metricValues[card.key];
          const isPercent = card.key === 'autoRate';
          return (
            <div
              key={card.key}
              style={{
                background: '#15110d',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16,
                padding: '18px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: `${card.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon size={17} color={card.color} />
                </div>
                {dashLoading && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: card.color, opacity: 0.5 }} />
                )}
              </div>
              <div
                style={{
                  fontSize: 30, fontWeight: 700, color: card.color,
                  lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
                }}
              >
                {value}{isPercent ? '%' : ''}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.5)', marginTop: 4 }}>
                {card.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Alt: 2 sutun */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Sol: Mukellef durum tablosu */}
        <div
          style={{
            background: '#15110d',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={15} color="#2dd4bf" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fafaf9' }}>Mukellef Durumu</span>
            <span style={{ fontSize: 11, color: 'rgba(250,250,249,0.4)', marginLeft: 'auto' }}>{tableRows.length} mukellef</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 360 }}>
            {summaryQ.isLoading && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>Yukleniyor...</div>
            )}
            {tableRows.map((row) => {
              const total = row.total || 1;
              const pct = Math.round((row.aktar / total) * 100);
              return (
                <div
                  key={row.id}
                  style={{
                    padding: '10px 18px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#fafaf9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {taxpayerName(row)}
                    </span>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                        background: /ISLETME/i.test(row.defterTuru || '') ? 'rgba(56,189,248,0.12)' : 'rgba(167,139,250,0.12)',
                        color: /ISLETME/i.test(row.defterTuru || '') ? '#7dd3fc' : '#c4b5fd',
                      }}
                    >
                      {taxpayerBookType(row)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(250,250,249,0.5)', marginBottom: 5 }}>
                    <span style={{ color: '#60a5fa' }}>Gelen: {row.gelen}</span>
                    <span style={{ color: '#4ade80' }}>Onay: {row.onay}</span>
                    <span style={{ color: '#a78bfa' }}>Aktar: {row.aktar}</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #2dd4bf, #4ade80)', borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
            {!summaryQ.isLoading && tableRows.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>
                {period} donemi icin kayit yok
              </div>
            )}
          </div>
        </div>

        {/* Sag: Entegrator durumu */}
        <div
          style={{
            background: '#15110d',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cloud size={15} color="#2dd4bf" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fafaf9' }}>Entegrator Durumu</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 360 }}>
            {integrationsQ.isLoading && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>Yukleniyor...</div>
            )}
            {integrations.map((intg: any, idx: number) => {
              const hasError = intg.status === 'ERROR' || intg.lastError;
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 18px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 9,
                      background: hasError ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Cloud size={15} color={hasError ? '#f87171' : '#4ade80'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#fafaf9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {intg.provider || intg.name || 'Entegrator'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(250,250,249,0.4)', marginTop: 1 }}>
                      Son cekim: {intg.lastSync ? new Date(intg.lastSync).toLocaleDateString('tr-TR') : '—'}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '3px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
                      background: hasError ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.12)',
                      color: hasError ? '#f87171' : '#4ade80',
                      border: `1px solid ${hasError ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)'}`,
                    }}
                  >
                    {hasError ? 'Hata' : 'Bagli'}
                  </div>
                </div>
              );
            })}
            {!integrationsQ.isLoading && integrations.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.4)' }}>
                Tanimli entegrator yok
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
