'use client';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function TopBar({ user }: { user: any }) {
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
        background: '#FFFFFF',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <p className="text-sm capitalize" style={{ color: 'var(--text-muted)' }}>
        {today}
      </p>

      <div className="flex items-center gap-3">
        {/* Bildirim */}
        <Link
          href="/panel/bildirimler"
          className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-50"
          style={{ border: '1px solid var(--border)' }}
        >
          <Bell size={16} style={{ color: 'var(--text-secondary)' }} />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: 'var(--danger)' }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>

        {/* Kullanıcı */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || '?'}
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {user?.firstName} {user?.lastName}
          </span>
        </div>
      </div>
    </header>
  );
}
