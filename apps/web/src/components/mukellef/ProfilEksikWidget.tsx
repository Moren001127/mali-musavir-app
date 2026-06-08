'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AlertTriangle, ChevronRight, Users } from 'lucide-react';

const GOLD = '#d4b876';

interface Item {
  id: string;
  ad: string;
  score: number;
  durum: 'TAM' | 'IYI' | 'EKSIK' | 'KRITIK_EKSIK';
  kritikEksikSayisi: number;
  eksikSayisi: number;
}

interface Summary {
  total: number;
  tam: number;
  iyi: number;
  eksik: number;
  kritikEksik: number;
  averageScore: number;
  taxpayers: Item[];
}

/**
 * v1.36.76: Dashboard widget — profili eksik mükellefleri özet liste.
 * Sadece eksiği olanlar (KRITIK_EKSIK + EKSIK) gösterilir, en eksik üstte.
 */
export function ProfilEksikWidget() {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ['taxpayers-completeness-summary'],
    queryFn: () => api.get('/taxpayers/completeness/summary').then((r) => r.data),
    staleTime: 60_000,
  });

  if (isLoading || !data) return null;

  const eksikler = data.taxpayers.filter((t) => t.durum === 'KRITIK_EKSIK' || t.durum === 'EKSIK').slice(0, 5);
  const toplamEksik = data.kritikEksik + data.eksik;

  // Hiç eksik yoksa widget gösterme
  if (toplamEksik === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
      <div className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: '#f59e0b' }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
            Profili Eksik Mükellefler
          </h3>
          <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-2"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
            {toplamEksik} mükellef
          </span>
        </div>
        <div className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>
          Ortalama %{data.averageScore}
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        {eksikler.map((t) => {
          const color = t.durum === 'KRITIK_EKSIK' ? '#ef4444' : '#f59e0b';
          return (
            <Link
              key={t.id}
              href={`/panel/mukellefler/${t.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition group"
            >
              <div className="w-2 h-2 rounded-full shrink-0"
                style={{ background: color, boxShadow: t.durum === 'KRITIK_EKSIK' ? `0 0 6px ${color}` : undefined }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
                    {t.ad}
                  </span>
                  <span className="text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: `${color}22`, color }}>
                    %{t.score}
                  </span>
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  {t.kritikEksikSayisi > 0 && (
                    <span className="font-semibold" style={{ color: '#ef4444' }}>
                      {t.kritikEksikSayisi} kritik eksik
                    </span>
                  )}
                  {t.kritikEksikSayisi > 0 && t.eksikSayisi > t.kritikEksikSayisi && ' · '}
                  {t.eksikSayisi > t.kritikEksikSayisi && (
                    <span>{t.eksikSayisi - t.kritikEksikSayisi} önemli eksik</span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 transition"
                style={{ color: GOLD }} />
            </Link>
          );
        })}
      </div>

      {toplamEksik > 5 && (
        <Link
          href="/panel/mukellef-listesi"
          className="flex items-center justify-center gap-2 px-5 py-3 text-[12px] font-semibold transition hover:bg-white/[0.03]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: GOLD }}
        >
          <Users size={12} /> Tüm eksik profilleri gör ({toplamEksik})
        </Link>
      )}
    </div>
  );
}
