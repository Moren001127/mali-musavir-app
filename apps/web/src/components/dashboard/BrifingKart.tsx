'use client';

/**
 * v1.36.81 — Sabah Brifingi Kartı
 *
 * Dashboard'un en üstünde görünür. AI tarafından üretilen 2-3 cümlelik
 * "bugün ne durumda" özeti gösterir. Backend endpoint: GET /moren-ai/brifing
 * Cache 4 saat (sunucu tarafında). Yenile butonu force=true ile yeniden ister.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

interface BrifingData {
  text: string;
  generatedAt: string;
  fromCache: boolean;
}

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

export function BrifingKart({ userName }: { userName?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useQuery<BrifingData>({
    queryKey: ['moren-ai-brifing'],
    queryFn: () => api.get('/moren-ai/brifing').then((r) => r.data),
    staleTime: 30 * 60 * 1000, // 30 dk client cache
    refetchOnWindowFocus: false,
  });

  const handleRefresh = async () => {
    await api.get('/moren-ai/brifing?force=1').then((r) => {
      qc.setQueryData(['moren-ai-brifing'], r.data);
    });
  };

  return (
    <div
      className="rounded-3xl overflow-hidden relative"
      style={{
        background: `radial-gradient(circle at 12% 0%, rgba(212,184,118,0.12), transparent 65%), linear-gradient(135deg, rgba(212,184,118,0.06), rgba(184,160,111,0.02))`,
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}
    >
      <div className="px-7 pt-6 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} style={{ color: GOLD }} />
          <span
            className="text-[10px] uppercase font-bold tracking-[.22em]"
            style={{ color: GOLD_SOFT }}
          >
            Bugünkü Brifing
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          title="Brifingi yenile"
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

      <div className="px-7 pt-1 pb-2">
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
        <p
          className="text-[12px] mt-1 tabular-nums"
          style={{ color: 'rgba(250,250,249,0.42)' }}
        >
          {KISA_TARIH}
        </p>
      </div>

      <div className="px-7 pb-7 pt-3">
        {isLoading ? (
          <div
            className="text-[14px] flex items-center gap-2"
            style={{ color: 'rgba(250,250,249,0.5)' }}
          >
            <Loader2 size={14} className="animate-spin" />
            Brifing hazırlanıyor...
          </div>
        ) : data?.text ? (
          <p
            className="text-[15px]"
            style={{
              color: 'rgba(250,250,249,0.85)',
              lineHeight: 1.65,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {data.text}
          </p>
        ) : (
          <p
            className="text-[13.5px]"
            style={{ color: 'rgba(250,250,249,0.5)' }}
          >
            Brifing alınamadı. Yenile butonuna basıp tekrar dene.
          </p>
        )}
      </div>
    </div>
  );
}
