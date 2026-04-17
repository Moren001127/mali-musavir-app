'use client';
import { Bell, Palette } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';

const THEMES = [
  { id: 'A', label: 'Editorial', desc: 'Klasik gazete' },
  { id: 'B', label: 'Terminal', desc: 'Bloomberg dark' },
  { id: 'C', label: 'Swiss', desc: 'Mimari minimal' },
];

export default function TopBar({ user }: { user: any }) {
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const [theme, setTheme] = useState<string>('A');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('moren-theme') || 'A';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem('moren-theme', t);
    document.documentElement.setAttribute('data-theme', t);
    setOpen(false);
  };

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
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <p className="text-sm capitalize" style={{ color: 'rgba(250,250,249,0.45)' }}>
        {today}
      </p>

      <div className="flex items-center gap-2">
        {/* Tema Seçici */}
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="relative h-9 px-3 rounded-lg flex items-center gap-2 transition-colors hover:opacity-80"
            style={{ border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)' }}
            title="Tema değiştir"
          >
            <Palette size={14} style={{ color: 'rgba(250,250,249,0.7)' }} />
            <span className="text-[12px] font-medium" style={{ color: '#fafaf9' }}>
              Tema {theme}
            </span>
          </button>
          {open && (
            <div
              className="absolute right-0 mt-2 w-56 rounded-lg overflow-hidden z-50"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}
            >
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTheme(t.id)}
                  className="w-full px-4 py-3 text-left transition-colors hover:opacity-80"
                  style={{
                    background: theme === t.id ? 'rgba(184,160,111,0.12)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                        {t.id} · {t.label}
                      </p>
                      <p className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                        {t.desc}
                      </p>
                    </div>
                    {theme === t.id && (
                      <span className="text-[11px]" style={{ color: '#d4b876' }}>● aktif</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bildirim */}
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

        {/* Kullanıcı */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold"
            style={{ background: '#d4b876', color: '#fff' }}
          >
            {`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || '?'}
          </div>
          <span className="text-sm font-medium" style={{ color: '#fafaf9' }}>
            {user?.firstName} {user?.lastName}
          </span>
        </div>
      </div>
    </header>
  );
}
