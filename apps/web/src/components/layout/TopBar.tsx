'use client';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import SystemHealthBell from './SystemHealthBell';
import LucaAgentPanel from './LucaAgentPanel';

export default function TopBar() {
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    refetchInterval: 60_000,
  });

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
      <p className="text-sm capitalize" style={{ color: 'rgba(250,250,249,0.42)' }}>
        {today}
      </p>

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
