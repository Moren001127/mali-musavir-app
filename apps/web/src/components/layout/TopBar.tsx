'use client';
import { Bell, ChevronDown, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import SystemHealthBell from './SystemHealthBell';
import LucaAgentPanel from './LucaAgentPanel';

type TopbarTaxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};

function taxpayerLabel(t: TopbarTaxpayer): string {
  return (t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || 'Mükellef').trim();
}

export default function TopBar() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    // 60sn -> 15sn (daha hizli refresh)
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const { data: taxpayers = [] } = useQuery<TopbarTaxpayer[]>({
    queryKey: ['taxpayers', 'topbar-picker'],
    queryFn: () =>
      api
        .get('/taxpayers', { params: { scope: 'directory', status: 'active' } })
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
    staleTime: 60_000,
  });

  // Window focus event: kullanici sekmeye geri donunce taze veri
  useEffect(() => {
    const onFocus = () => qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    const onVisibility = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [qc]);

  const today = new Date().toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header
      className="h-14 flex items-center justify-between px-6 flex-shrink-0"
      style={{
        background: '#080807',
        borderBottom: '1px solid rgba(212,184,118,0.08)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.55)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <p className="shrink-0 text-sm capitalize" style={{ color: 'rgba(250,250,249,0.42)' }}>
          {today}
        </p>
        <label
          className="relative hidden min-w-[280px] md:block"
          title="Mükellef kartına git"
        >
          <Users size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(212,184,118,0.78)' }} />
          <select
            value=""
            onChange={(e) => {
              const taxpayerId = e.target.value;
              if (taxpayerId) router.push(`/panel/mukellefler/${taxpayerId}`);
            }}
            className="h-9 w-full appearance-none rounded-[8px] border bg-[#10100f] pl-9 pr-9 text-[12.5px] font-semibold outline-none"
            style={{ borderColor: 'rgba(212,184,118,0.18)', color: 'rgba(250,250,249,0.74)', colorScheme: 'dark' }}
          >
            <option value="">Mükellef Listesi</option>
            {taxpayers.map((taxpayer) => (
              <option key={taxpayer.id} value={taxpayer.id}>
                {taxpayerLabel(taxpayer)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.45)' }} />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <div id="moren-topbar-actions" className="flex items-center gap-2" />
        <LucaAgentPanel />
        <SystemHealthBell />

        <Link
          href="/panel/bildirimler"
          className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
          style={{ border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <Bell size={16} style={{ color: 'rgba(250,250,249,0.7)' }} />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: '#f43f5e' }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
