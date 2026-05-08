'use client';

/**
 * v1.36.82 — Profesyonel Sabah/Gün Brifingi Kartı
 *
 * Backend artık structured JSON döner: { summary, alerts[], suggestions[], focus, metrics }
 * Bu kart sadece düz metin değil, uyarı rozetleri + tıklanabilir aksiyon önerileri + odak
 * göstergesi (calm/busy/critical/review) gösterir.
 *
 * Auto-refresh: dashboard her 5 dakikada yeniden ister (backend cache 30 dk).
 * Force yenileme butonu cache'i bypass eder.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowRight,
  Receipt, FileText, FileCheck, Bell, Zap, Calendar, Clock,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

interface BrifingAlert {
  severity: 'high' | 'medium' | 'low';
  text: string;
  href?: string;
}
interface BrifingSuggestion {
  text: string;
  href: string;
  icon?: string;
}
interface BrifingResponse {
  summary: string;
  alerts: BrifingAlert[];
  suggestions: BrifingSuggestion[];
  focus: 'calm' | 'busy' | 'critical' | 'review';
  metrics: Record<string, any>;
  generatedAt: string;
  fromCache: boolean;
}

const ICON_MAP: Record<string, any> = {
  Receipt, FileText, FileCheck, Bell, Sparkles, Zap, Calendar, Clock, ArrowRight,
};

const SELAMLAMA = (() => {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
})();

const KISA_TARIH = new Date().toLocaleDateString('tr-TR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const FOCUS_TONES: Record<string, { label: string; color: string; bg: string }> = {
  calm:     { label: 'Sakin',     color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  busy:     { label: 'Yoğun',     color: '#d4b876', bg: 'rgba(212,184,118,0.14)' },
  critical: { label: 'Kritik',    color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
  review:   { label: 'Gözden Geçir', color: '#a855f7', bg: 'rgba(168,85,247,0.14)' },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  return `${hr} sa önce`;
}

export function BrifingKart({ userName }: { userName?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<BrifingResponse>({
    queryKey: ['moren-ai-brifing'],
    queryFn: () => api.get('/moren-ai/brifing').then((r) => r.data),
    staleTime: 5 * 60 * 1000,    // 5 dk client cache
    refetchInterval: 5 * 60 * 1000, // her 5 dk yeniden iste (backend zaten 30 dk cache)
    refetchOnWindowFocus: true,
  });

  const handleRefresh = async () => {
    const r = await api.get('/moren-ai/brifing?force=1').then((res) => res.data);
    qc.setQueryData(['moren-ai-brifing'], r);
  };

  const focus = data?.focus ?? 'busy';
  const focusTone = FOCUS_TONES[focus] ?? FOCUS_TONES.busy;

  return (
    <div
      className="rounded-3xl overflow-hidden relative"
      style={{
        background: `radial-gradient(circle at 12% 0%, ${focusTone.bg.replace(',0.14)', ',0.10)')}, transparent 65%), linear-gradient(135deg, rgba(212,184,118,0.06), rgba(184,160,111,0.02))`,
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}
    >
      {/* Üst etiket bandı */}
      <div className="px-7 pt-6 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} style={{ color: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: GOLD_SOFT }}>
            Bugünkü Brifing
          </span>
          {data && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-1 inline-flex items-center gap-1"
              style={{ background: focusTone.bg, color: focusTone.color, border: `1px solid ${focusTone.color}30` }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: focusTone.color }} />
              {focusTone.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.generatedAt && (
            <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              {data.fromCache ? '↻' : '✓'} {formatRelativeTime(data.generatedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            title="Brifingi yeniden üret"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(250,250,249,0.6)',
            }}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {/* Selamlama başlığı */}
      <div className="px-7 pt-1 pb-3">
        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 30,
            fontWeight: 600,
            color: '#fafaf9',
            letterSpacing: '-.025em',
            lineHeight: 1.1,
          }}
        >
          {SELAMLAMA}
          {userName ? `, ${userName.split(' ')[0]}` : ''}
        </h2>
        <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.42)' }}>
          {KISA_TARIH}
        </p>
      </div>

      {/* Ana özet metni */}
      <div className="px-7 pb-3">
        {isLoading ? (
          <div className="text-[14px] flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={14} className="animate-spin" />
            Brifing hazırlanıyor...
          </div>
        ) : data?.summary ? (
          <p
            className="text-[15px]"
            style={{
              color: 'rgba(250,250,249,0.85)',
              lineHeight: 1.65,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {data.summary}
          </p>
        ) : (
          <p className="text-[13.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Brifing alınamadı. Yenile butonuna basıp tekrar dene.
          </p>
        )}
      </div>

      {/* Uyarılar (alerts) */}
      {data?.alerts && data.alerts.length > 0 && (
        <div className="px-7 pb-3 space-y-1.5">
          {data.alerts.map((a, i) => {
            const cfg = a.severity === 'high'
              ? { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.32)' }
              : a.severity === 'medium'
                ? { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.32)' }
                : { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.28)' };
            const Inner = (
              <div
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition group"
                style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                }}
              >
                <AlertTriangle size={13} style={{ color: cfg.color }} />
                <span className="text-[13px] flex-1" style={{ color: '#fafaf9' }}>
                  {a.text}
                </span>
                {a.href && (
                  <ArrowRight size={13} className="opacity-50 group-hover:opacity-100 transition" style={{ color: cfg.color }} />
                )}
              </div>
            );
            return a.href ? (
              <Link key={i} href={a.href} className="block">
                {Inner}
              </Link>
            ) : (
              <div key={i}>{Inner}</div>
            );
          })}
        </div>
      )}

      {/* Aksiyon önerileri (suggestions) */}
      {data?.suggestions && data.suggestions.length > 0 && (
        <div className="px-7 pb-7 pt-2 flex flex-wrap gap-2">
          {data.suggestions.map((s, i) => {
            const Icon = ICON_MAP[s.icon || 'Sparkles'] || Sparkles;
            return (
              <Link
                key={i}
                href={s.href}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition hover:scale-[1.03]"
                style={{
                  background: 'linear-gradient(135deg, rgba(212,184,118,0.14), rgba(212,184,118,0.06))',
                  color: GOLD,
                  border: '1px solid rgba(212,184,118,0.28)',
                }}
              >
                <Icon size={12} />
                {s.text}
                <ArrowRight size={11} className="opacity-60" />
              </Link>
            );
          })}
        </div>
      )}

      {/* Suggestion yoksa boş alt boşluk verme — direkt bitir */}
      {(!data?.suggestions || data.suggestions.length === 0) && <div className="pb-5" />}
    </div>
  );
}
