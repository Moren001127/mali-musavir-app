'use client';

import { usePathname } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { lucaSessionApi } from '@/lib/luca-session';

const INLINE_PAGES = [
  '/panel/mizan',
  '/panel/kdv-kontrol',
  '/panel/kdv-beyanname',
  '/panel/isletme-hesap-ozeti',
  '/panel/e-arsiv',
];

function routeForJobTip(jobTip?: string | null) {
  const tip = String(jobTip || '').toUpperCase();
  if (tip.includes('EARSIV') || tip.includes('EFATURA')) return '/panel/e-arsiv';
  if (tip === 'MIZAN') return '/panel/mizan';
  if (tip === 'KDV_MIZAN') return '/panel/kdv-beyanname';
  if (tip.startsWith('KDV_') || tip.startsWith('ISLETME_')) return '/panel/kdv-kontrol';
  if (tip === 'IHO_FETCH') return '/panel/isletme-hesap-ozeti';
  if (tip === 'ACCOUNT_PLAN') return '/panel/fatura-muhasebelestirme';
  return '/panel/ajanlar/luca';
}

export function LucaCaptchaOverlay() {
  const pathname = usePathname();
  const hiddenOnManager = pathname?.startsWith('/panel/ajanlar/luca');
  const hiddenOnInlinePage = INLINE_PAGES.some((page) => pathname?.startsWith(page));

  const statusQuery = useQuery({
    queryKey: ['luca-captcha-overlay'],
    queryFn: lucaSessionApi.status,
    enabled: !hiddenOnManager && !hiddenOnInlinePage,
    refetchInterval: 2000,
  });

  const challenge = statusQuery.data?.activeChallenge?.status === 'pending'
    ? statusQuery.data.activeChallenge
    : null;

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (challenge) await lucaSessionApi.cancelCaptcha(challenge.id).catch(() => null);
    },
    onSuccess: () => {
      statusQuery.refetch();
      toast.info('Luca guvenlik kodu istegi iptal edildi');
    },
  });

  if (hiddenOnManager || hiddenOnInlinePage || !challenge) return null;

  const moduleRoute = routeForJobTip(challenge.context?.jobTip);

  return (
    <div
      className="fixed bottom-4 right-6 z-[80] max-w-md rounded-xl p-4 shadow-2xl"
      style={{
        background: 'rgba(20,17,13,0.98)',
        border: '1px solid rgba(212,184,118,0.42)',
        boxShadow: '0 22px 70px rgba(0,0,0,0.55)',
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: '#d4b876' }}>
        <AlertTriangle size={14} />
        Luca guvenlik kodu bekliyor
      </div>
      <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
        Kod, isi baslattigin modulun icinde girilecek.
      </div>
      <p className="mt-1 text-xs" style={{ color: 'rgba(250,250,249,0.62)' }}>
        Bu kutu sadece hatirlatma; ikinci kod formu acilmiyor.
      </p>
      <div className="mt-3 flex gap-2">
        <a
          href={moduleRoute}
          className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-bold"
          style={{ background: '#d4b876', color: '#15110b' }}
        >
          Module don
        </a>
        <button
          type="button"
          onClick={() => cancelMut.mutate()}
          disabled={cancelMut.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold disabled:opacity-45"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.76)' }}
        >
          <X size={15} />
          Iptal
        </button>
      </div>
    </div>
  );
}
