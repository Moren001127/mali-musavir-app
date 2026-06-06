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

const MUTED = 'rgba(245,245,244,0.60)';
const FAINT = 'rgba(245,245,244,0.36)';
const HAIR = 'rgba(255,255,255,0.07)';
const FIELD = '#0c0d11';
const RED = '#ef6b6b';
const STEEL_BR = '#74a6e6';

/**
 * Süresi yaklaşan / geçmiş belgeleri içgörü rayında özet gösterir.
 * Mükellef detay sayfasının sağ rayında "Evrak Yenileme" bölümü olarak render edilir.
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

  const safeDocs = Array.isArray(docs) ? docs : [];
  const expired = safeDocs.filter((d: ExpiringDocument) => d.status === 'EXPIRED');
  const soon = safeDocs.filter((d: ExpiringDocument) => d.status === 'EXPIRING_SOON');

  if (isLoading) return null;
  if (safeDocs.length === 0) return null;

  const visible = compact ? safeDocs.slice(0, 5) : safeDocs;

  function taxpayerName(t: ExpiringDocument['taxpayer']) {
    return (
      t.companyName ||
      [t.firstName, t.lastName].filter(Boolean).join(' ') ||
      '(isim yok)'
    );
  }

  return (
    <div className="border-b p-4" style={{ borderColor: HAIR }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
          <AlertTriangle size={13} style={{ color: RED }} /> Evrak Yenileme
          <span className="font-medium normal-case tracking-normal" style={{ color: FAINT }}>
            · {expired.length > 0 && `${expired.length} dolmuş`}
            {expired.length > 0 && soon.length > 0 && ' · '}
            {soon.length > 0 && `${soon.length} yaklaşıyor`}
          </span>
        </span>
        {!taxpayerId && (
          <Link
            href="/panel/evraklar/yenileme"
            className="flex items-center gap-1 text-[11px] font-bold"
            style={{ color: STEEL_BR }}
          >
            Tümü <ArrowRight size={11} />
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
              className="flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2 transition hover:bg-white/[0.03]"
              style={{ borderColor: HAIR, background: FIELD }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <FileText size={13} style={{ color: FAINT, flexShrink: 0 }} />
                <span className="truncate text-[12px]" style={{ color: 'rgba(245,245,244,0.86)' }}>
                  {d.title}
                </span>
                {!taxpayerId && (
                  <span className="truncate text-[11px]" style={{ color: FAINT }}>
                    · {taxpayerName(d.taxpayer)}
                  </span>
                )}
              </div>
              <span
                className="whitespace-nowrap rounded-md px-2 py-[2px] text-[10.5px] font-bold"
                style={{ color, background: `${color}22` }}
              >
                {expiringStatusLabel(d.status, d.daysLeft)}
              </span>
            </Link>
          );
        })}
      </div>

      {compact && safeDocs.length > visible.length && !taxpayerId && (
        <div className="mt-2 text-center">
          <Link
            href="/panel/evraklar/yenileme"
            className="text-[11px]"
            style={{ color: STEEL_BR }}
          >
            +{safeDocs.length - visible.length} daha…
          </Link>
        </div>
      )}
    </div>
  );
}
