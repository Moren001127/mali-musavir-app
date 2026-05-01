'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, FileText } from 'lucide-react';
import {
  documentsApi,
  expiringStatusColor,
  expiringStatusLabel,
  type ExpiringDocument,
} from '@/lib/documents';

const GOLD = '#d4b876';

/**
 * Süresi yaklaşan / geçmiş belgeleri özet olarak gösterir.
 * Dashboard veya mükellef detay sayfasına eklenebilir.
 *
 * Props:
 *   taxpayerId — sadece bu mükellefe ait belgeler (opsiyonel)
 *   compact    — kompakt mod: maks 5 satır (default true)
 *   daysAhead  — kaç gün sonrasına bak (default 30)
 */
export default function DocumentExpiryWidget({
  taxpayerId,
  compact = true,
  daysAhead = 30,
}: {
  taxpayerId?: string;
  compact?: boolean;
  daysAhead?: number;
}) {
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['documents-expiring', taxpayerId, daysAhead],
    queryFn: () =>
      documentsApi.getExpiring({
        taxpayerId,
        daysAhead,
        includeExpired: true,
      }),
  });

  const expired = docs.filter((d: ExpiringDocument) => d.status === 'EXPIRED');
  const soon = docs.filter((d: ExpiringDocument) => d.status === 'EXPIRING_SOON');

  if (isLoading) return null;
  if (docs.length === 0) return null;

  const visible = compact ? docs.slice(0, 5) : docs;

  function taxpayerName(t: ExpiringDocument['taxpayer']) {
    return (
      t.companyName ||
      [t.firstName, t.lastName].filter(Boolean).join(' ') ||
      '(isim yok)'
    );
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: 'rgba(239,68,68,0.04)',
        borderColor: 'rgba(239,68,68,0.18)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} style={{ color: '#ef4444' }} />
          <span
            className="text-[11px] uppercase font-bold tracking-[.12em]"
            style={{ color: 'rgba(250,250,249,0.7)' }}
          >
            Evrak Yenileme
          </span>
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            · {expired.length > 0 && `${expired.length} dolmuş`}
            {expired.length > 0 && soon.length > 0 && ' · '}
            {soon.length > 0 && `${soon.length} yaklaşıyor`}
          </span>
        </div>
        {!taxpayerId && (
          <Link
            href="/panel/evraklar/yenileme"
            className="text-[11px] flex items-center gap-1 hover:underline"
            style={{ color: GOLD }}
          >
            Tümünü gör <ArrowRight size={10} />
          </Link>
        )}
      </div>

      <div className="space-y-1.5">
        {visible.map((d) => {
          const color = expiringStatusColor(d.status, d.daysLeft);
          return (
            <Link
              key={d.id}
              href={`/panel/evraklar/${d.id}`}
              className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <FileText size={12} style={{ color: 'rgba(250,250,249,0.4)', flexShrink: 0 }} />
                <span
                  className="text-[12.5px] truncate"
                  style={{ color: 'rgba(250,250,249,0.85)' }}
                >
                  {d.title}
                </span>
                {!taxpayerId && (
                  <span
                    className="text-[11px] truncate"
                    style={{ color: 'rgba(250,250,249,0.45)' }}
                  >
                    · {taxpayerName(d.taxpayer)}
                  </span>
                )}
              </div>
              <span
                className="text-[11px] font-semibold whitespace-nowrap"
                style={{ color }}
              >
                {expiringStatusLabel(d.status, d.daysLeft)}
              </span>
            </Link>
          );
        })}
      </div>

      {compact && docs.length > visible.length && !taxpayerId && (
        <div className="mt-2 text-center">
          <Link
            href="/panel/evraklar/yenileme"
            className="text-[11px]"
            style={{ color: GOLD }}
          >
            +{docs.length - visible.length} daha…
          </Link>
        </div>
      )}
    </div>
  );
}
