'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { pendingActionsApi } from '@/lib/pending-actions';
import { toast } from 'sonner';

const GOLD = '#d4b876';

/**
 * AI Onay Kuyruğu zili — header'da, kritik bekleyen onay varsa kırmızı,
 * normal bekleyen varsa altın. Yeni eklenince toast popup.
 */
export default function AiOnayBell() {
  const lastSeenRef = useRef<number>(0);

  const { data: list = [] } = useQuery({
    queryKey: ['ai-onay-bell'],
    queryFn: () => pendingActionsApi.list({ status: 'pending', limit: 20 }),
    refetchInterval: 10_000,
  });

  const pendingCount = list.length;
  const critical = list.filter((a) => a.riskLevel === 'critical' || a.riskLevel === 'high');
  const criticalCount = critical.length;

  // Yeni gelen kayıtları yakalayıp toast at
  useEffect(() => {
    if (pendingCount === 0) {
      lastSeenRef.current = 0;
      return;
    }
    if (lastSeenRef.current === 0) {
      // İlk yüklenme — geçmişi sessiz say
      lastSeenRef.current = pendingCount;
      return;
    }
    if (pendingCount > lastSeenRef.current) {
      const added = pendingCount - lastSeenRef.current;
      const newest = list[0];
      toast.message(`${added} yeni onay bekliyor`, {
        description: newest?.title?.slice(0, 80),
        action: {
          label: 'Aç',
          onClick: () => {
            window.location.href = '/panel/ai-onay';
          },
        },
      });
    }
    lastSeenRef.current = pendingCount;
  }, [pendingCount, list]);

  if (pendingCount === 0) return null;

  const isCritical = criticalCount > 0;

  return (
    <Link
      href="/panel/ai-onay"
      className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
      style={{
        border: `1px solid ${isCritical ? 'rgba(239,68,68,0.40)' : `${GOLD}40`}`,
        background: isCritical ? 'rgba(239,68,68,0.10)' : `${GOLD}10`,
      }}
      title={
        isCritical
          ? `${criticalCount} kritik/yüksek + ${pendingCount - criticalCount} normal bekleyen AI onayı`
          : `${pendingCount} AI onayı bekleniyor`
      }
    >
      {isCritical ? (
        <AlertTriangle size={16} style={{ color: '#fca5a5' }} className="animate-pulse" />
      ) : (
        <ShieldCheck size={16} style={{ color: GOLD }} />
      )}
      <span
        className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[10px] font-bold"
        style={{
          background: isCritical ? '#ef4444' : GOLD,
          color: isCritical ? '#fafaf9' : '#0f0d0b',
        }}
      >
        {pendingCount > 9 ? '9+' : pendingCount}
      </span>
    </Link>
  );
}
