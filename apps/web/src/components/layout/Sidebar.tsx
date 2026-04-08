'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { useMe, useLogout } from '@/hooks/useAuth';
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  Users2,
  FolderOpen,
  Bell,
  Settings,
  FileCheck,
  Printer,
  LogOut,
  ChevronRight,
} from 'lucide-react';

const navGroups = [
  {
    label: 'ANA MODÜLLER',
    items: [
      { href: '/panel',            label: 'Gösterge Paneli', icon: LayoutDashboard },
      { href: '/panel/mukellefler', label: 'Mükellefler',    icon: Users },
      { href: '/panel/beyannameler',label: 'Beyannameler',   icon: FileText },
      { href: '/panel/faturalar',   label: 'Faturalar',      icon: Receipt },
      { href: '/panel/bordro',      label: 'Bordro & SGK',   icon: Users2 },
      { href: '/panel/evraklar',    label: 'Evrak Yönetimi', icon: FolderOpen },
    ],
  },
  {
    label: 'KONTROL & RAPORLAMA',
    items: [
      { href: '/panel/kdv-kontrol',  label: 'KDV Kontrol',    icon: FileCheck },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma',   icon: Printer },
    ],
  },
  {
    label: 'SİSTEM',
    items: [
      { href: '/panel/bildirimler', label: 'Bildirimler', icon: Bell },
      { href: '/panel/ayarlar',     label: 'Ayarlar',     icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: user } = useMe();
  const logout = useLogout();

  const isActive = (href: string) =>
    href === '/panel' ? pathname === '/panel' : pathname.startsWith(href);

  const handleLogout = () => {
    logout.mutate();
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  return (
    <aside
      className="w-64 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ background: 'var(--navy)' }}
    >
      {/* Logo Alanı */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center"
            style={{ background: 'rgba(201,152,42,.15)', border: '1px solid rgba(201,152,42,.3)' }}
          >
            <Image
              src="/brand/logo.jpg"
              alt="Moren"
              width={36}
              height={36}
              className="object-contain w-full h-full"
            />
          </div>
          <div className="min-w-0">
            <p
              className="text-xs font-extrabold uppercase tracking-wider leading-tight"
              style={{ color: 'var(--gold-light)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Moren
            </p>
            <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: 'rgba(255,255,255,.45)' }}>
              Mali Müşavirlik Portalı
            </p>
          </div>
        </div>
      </div>

      {/* Navigasyon */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p
              className="text-[10px] font-bold uppercase tracking-widest px-3 mb-1.5"
              style={{ color: 'rgba(255,255,255,.28)' }}
            >
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative group"
                    style={{
                      color: active ? '#FFFFFF' : 'rgba(255,255,255,.55)',
                      background: active ? 'rgba(201,152,42,.18)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    {/* Aktif sol çizgi */}
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                        style={{ background: 'var(--gold)' }}
                      />
                    )}
                    <Icon size={16} className="flex-shrink-0" style={{ opacity: active ? 1 : 0.7 }} />
                    <span className="flex-1 leading-none">{label}</span>
                    {active && (
                      <ChevronRight size={13} style={{ opacity: 0.5, color: 'var(--gold-light)' }} />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Alt Kullanıcı Paneli */}
      <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,.06)' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold"
            style={{ background: 'var(--gold)', color: 'var(--navy)' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : '...'}
            </p>
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,.4)' }}>
              {user?.role === 'ADMIN' ? 'Yönetici' : 'Personel'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            title="Çıkış Yap"
          >
            <LogOut size={14} style={{ color: 'rgba(255,255,255,.45)' }} />
          </button>
        </div>
        <p className="text-center mt-2 text-[10px]" style={{ color: 'rgba(255,255,255,.2)' }}>
          v0.1.0 · KVKK Uyumlu
        </p>
      </div>
    </aside>
  );
}
