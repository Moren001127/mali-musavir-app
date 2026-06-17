'use client';

/**
 * Mükellef Günlük Brifing — ofis BrifingKart bileşeninin BİREBİR görsel kopyası,
 * mükellefe uygun veriyle (/portal/brifing). Uyarı/öneri/odak/özet aynı düzen.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowRight,
  Receipt, FileText, FileCheck, Bell, Zap, Calendar, Clock,
} from 'lucide-react';
import Link from 'next/link';
import { taxpayerApi } from '@/lib/taxpayer-api';

interface BrifingAlert { severity: 'high' | 'medium' | 'low'; text: string; href?: string }
interface BrifingSuggestion { text: string; href: string; icon?: string }
interface BrifingResponse {
  summary: string; motivation?: string; alerts: BrifingAlert[]; suggestions: BrifingSuggestion[];
  focus: 'calm' | 'busy' | 'critical' | 'review'; generatedAt: string; fromCache: boolean; ad?: string;
}

const ICON_MAP: Record<string, any> = { Receipt, FileText, FileCheck, Bell, Sparkles, Zap, Calendar, Clock, ArrowRight, RefreshCw };

const KISA_TARIH = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

const FOCUS_TONES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  calm: { label: 'Sakin', color: '#86c7a0', bg: 'rgba(134,199,160,0.08)', border: 'rgba(134,199,160,0.16)' },
  busy: { label: 'Yoğun', color: '#d8bd86', bg: 'rgba(216,189,134,0.075)', border: 'rgba(216,189,134,0.16)' },
  critical: { label: 'Kritik', color: '#e58c9b', bg: 'rgba(229,140,155,0.075)', border: 'rgba(229,140,155,0.16)' },
  review: { label: 'Kontrol', color: '#8db6c6', bg: 'rgba(141,182,198,0.075)', border: 'rgba(141,182,198,0.16)' },
};

const CHROME = {
  color: '#8fd7bd', text: '#bfe9dc',
  actionBg: 'rgba(143,215,189,0.050)', actionBorder: 'rgba(143,215,189,0.15)',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  return `${Math.round(min / 60)} sa önce`;
}

export function MukellefBrifing({ userName }: { userName?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<BrifingResponse>({
    queryKey: ['portal-brifing'],
    queryFn: () => taxpayerApi.get('/portal/brifing').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const handleRefresh = async () => {
    const r = await taxpayerApi.get('/portal/brifing?force=1').then((res) => res.data);
    qc.setQueryData(['portal-brifing'], r);
  };

  const focus = data?.focus ?? 'busy';
  const focusTone = FOCUS_TONES[focus] ?? FOCUS_TONES.busy;
  const adi = userName || data?.ad;

  return (
    <div
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: 'radial-gradient(circle at 7% 0%, rgba(143,215,189,0.11), transparent 34%), radial-gradient(circle at 95% 10%, rgba(216,189,134,0.08), transparent 31%), linear-gradient(180deg, rgba(8,14,13,0.96), rgba(5,7,7,0.94))',
        border: '1px solid rgba(143,215,189,0.18)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(143,215,189,0.65), rgba(216,189,134,0.38), transparent)' }} />
      <div className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: 'linear-gradient(180deg, #8fd7bd, #d8bd86)', boxShadow: '0 0 18px rgba(143,215,189,0.22)' }} />

      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(143,215,189,0.08)' }}>
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} style={{ color: CHROME.color }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: CHROME.text }}>Bugünkü Brifing</span>
          {data && (
            <span className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ml-1 inline-flex items-center gap-1" style={{ background: focusTone.bg, color: focusTone.color, border: `1px solid ${focusTone.border}` }}>
              <span className="w-1 h-1 rounded-full" style={{ background: focusTone.color }} />{focusTone.label}
            </span>
          )}
          {data && (
            <span className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md inline-flex items-center gap-1" style={{ background: 'rgba(216,189,134,0.075)', color: '#d8c38f', border: '1px solid rgba(216,189,134,0.18)' }}>AI Destekli</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.generatedAt && <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{data.fromCache ? '↻' : '✓'} {formatRelativeTime(data.generatedAt)}</span>}
          <button onClick={handleRefresh} disabled={isFetching} title="Brifingi yeniden üret" className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50" style={{ background: 'rgba(143,215,189,0.055)', border: '1px solid rgba(143,215,189,0.14)', color: 'rgba(221,246,238,0.72)' }}>
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Yenile
          </button>
        </div>
      </div>

      <div className="px-5 pt-3 pb-2 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] xl:items-start">
        <div className="min-w-0">
          <h2 style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 22, fontWeight: 800, color: '#f6fbf7', lineHeight: 1.1 }}>Bugünkü Öncelikler</h2>
          <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.42)' }}>{KISA_TARIH}{adi ? ` · ${adi}` : ''}</p>
        </div>
        {!isLoading && data?.motivation && (
          <div className="w-full rounded-lg px-3 py-2 flex items-center gap-2.5 select-none xl:justify-self-end" style={{ background: 'linear-gradient(135deg, rgba(143,215,189,0.075), rgba(216,189,134,0.045))', border: '1px solid rgba(143,215,189,0.16)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)' }}>
            <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: focusTone.bg, border: `1px solid ${focusTone.border}`, color: focusTone.color }}><Sparkles size={13} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[9px] uppercase font-black tracking-[.14em]" style={{ color: '#d8c38f' }}><Sparkles size={10} /> Odak Notu</span>
              <span className="block mt-0.5 text-[12.5px] font-semibold leading-snug" style={{ color: 'rgba(250,250,249,0.88)' }}>{data.motivation}</span>
            </span>
          </div>
        )}
      </div>

      <div className="px-5 pt-1.5 pb-2">
        {isLoading ? (
          <div className="rounded-xl px-4 py-3 text-[14px] flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Loader2 size={14} className="animate-spin" /> Brifing hazırlanıyor...
          </div>
        ) : data?.summary ? (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(143,215,189,0.10)', boxShadow: 'inset 3px 0 0 rgba(143,215,189,0.55)' }}>
            <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.88)', lineHeight: 1.58, fontFamily: 'Inter, sans-serif' }}>{data.summary}</p>
          </div>
        ) : (
          <p className="rounded-xl px-4 py-3 text-[13.5px]" style={{ color: 'rgba(250,250,249,0.5)', background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.06)' }}>Brifing alınamadı. Yenile butonuna basıp tekrar dene.</p>
        )}
      </div>

      {data?.alerts && data.alerts.length > 0 && (
        <div className="px-5 pb-3 space-y-1.5">
          {data.alerts.slice(0, 3).map((a, i) => {
            const cfg = a.severity === 'high'
              ? { color: '#d8bd86', bg: 'rgba(255,255,255,0.024)', border: 'rgba(216,189,134,0.17)' }
              : a.severity === 'medium'
                ? { color: '#8db6c6', bg: 'rgba(255,255,255,0.022)', border: 'rgba(141,182,198,0.14)' }
                : { color: '#86c7a0', bg: 'rgba(255,255,255,0.020)', border: 'rgba(134,199,160,0.13)' };
            const Inner = (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition group" style={{ background: `linear-gradient(90deg, ${cfg.bg}, rgba(255,255,255,0.012))`, border: `1px solid ${cfg.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.018)' }}>
                <AlertTriangle size={13} style={{ color: cfg.color }} />
                <span className="text-[13px] flex-1" style={{ color: '#fafaf9' }}>{a.text}</span>
                {a.href && <ArrowRight size={13} className="opacity-50 group-hover:opacity-100 transition" style={{ color: cfg.color }} />}
              </div>
            );
            return a.href ? <Link key={i} href={a.href} className="block">{Inner}</Link> : <div key={i}>{Inner}</div>;
          })}
        </div>
      )}

      {data?.suggestions && data.suggestions.length > 0 ? (
        <div className="px-5 pb-4 pt-1 grid grid-cols-1 xl:grid-cols-3 gap-2">
          {data.suggestions.slice(0, 3).map((s, i) => {
            const Icon = ICON_MAP[s.icon || 'Sparkles'] || Sparkles;
            return (
              <Link key={i} href={s.href} className="inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition hover:bg-white/[0.035]" style={{ background: `linear-gradient(135deg, ${CHROME.actionBg}, rgba(216,189,134,0.035))`, color: 'rgba(228,248,241,0.80)', border: `1px solid ${CHROME.actionBorder}` }}>
                <Icon size={12} />{s.text}<ArrowRight size={11} className="opacity-60" />
              </Link>
            );
          })}
        </div>
      ) : <div className="pb-4" />}
    </div>
  );
}
