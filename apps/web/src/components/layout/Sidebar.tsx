'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  Bot,
  Activity,
  Sliders,
} from 'lucide-react';

const navGroups = [
  {
    label: 'Ana Modüller',
    accent: '#3b82f6', // mavi
    items: [
      { href: '/panel',             label: 'Gösterge Paneli',  icon: LayoutDashboard },
      { href: '/panel/mukellefler', label: 'Mükellefler',       icon: Users },
      { href: '/panel/beyannameler',label: 'Beyannameler',      icon: FileText },
      { href: '/panel/faturalar',   label: 'Faturalar',         icon: Receipt },
      { href: '/panel/bordro',      label: 'Bordro & SGK',      icon: Users2 },
      { href: '/panel/evraklar',    label: 'Evrak Yönetimi',    icon: FolderOpen },
    ],
  },
  {
    label: 'Kontrol',
    accent: '#10b981', // yeşil
    items: [
      { href: '/panel/kdv-kontrol',  label: 'KDV Kontrol',     icon: FileCheck },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma',    icon: Printer },
    ],
  },
  {
    label: 'Otomasyon',
    accent: '#8b5cf6', // mor
    items: [
      { href: '/panel/ajanlar',           label: 'Ajanlar',             icon: Bot },
      { href: '/panel/ajanlar/loglar',    label: 'Yapılan İşlemler',    icon: Activity },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: Sliders },
    ],
  },
  {
    label: 'Sistem',
    accent: '#64748b', // gri-mavi
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

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  return (
    <aside
      className="w-64 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ background: '#fafafa', borderRight: '1px solid var(--border)' }}
    >
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/panel" className="flex items-center gap-3 group">
          <div
            className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center transition-all duration-200 group-hover:scale-105"
            style={{
              background: 'var(--accent)',
              boxShadow: '0 4px 12px rgba(26,31,54,0.15)',
            }}
          >
            <span style={{ color: 'white', fontWeight: 700, fontSize: 16, letterSpacing: '-0.03em' }}>M</span>
          </div>
          <div className="min-w-0">
            <p
              className="text-[15px] font-semibold leading-none mb-1"
              style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}
            >
              Moren
            </p>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
              Mali Müşavirlik
            </p>
          </div>
        </Link>
      </div>

      {/* Navigasyon */}
      <nav className="flex-1 px-3 pt-1 pb-4 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="flex items-center gap-2 px-3 mb-2">
              <span
                className="w-1 h-1 rounded-full"
                style={{ background: group.accent }}
              />
              <p
                className="text-[10.5px] font-semibold uppercase"
                style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
              >
                {group.label}
              </p>
            </div>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="nav-item group flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] relative overflow-hidden transition-all duration-150"
                    style={{
                      color: active ? 'var(--text)' : 'var(--text-secondary)',
                      background: active ? '#ffffff' : 'transparent',
                      fontWeight: active ? 600 : 450,
                      letterSpacing: '-0.005em',
                      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' : 'none',
                      border: active ? '1px solid var(--border)' : '1px solid transparent',
                    }}
                  >
                    {/* Aktif sol şerit (gruba göre renkli) */}
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
                        style={{ background: group.accent }}
                      />
                    )}
                    <Icon
                      size={16}
                      className="flex-shrink-0 transition-transform duration-150 group-hover:scale-110"
                      style={{ color: active ? group.accent : 'var(--text-muted)' }}
                    />
                    <span className="flex-1 leading-none">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Alt Kullanıcı */}
      <div className="px-3 pt-3 pb-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="flex items-center gap-3 px-2 py-2 rounded-lg group cursor-pointer transition-all duration-150"
          style={{ background: 'transparent' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#ffffff')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
        >
          <div
            className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-[12px] font-semibold transition-transform duration-150 group-hover:scale-110"
            style={{
              background: 'linear-gradient(135deg, var(--accent), #2a3052)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(26,31,54,0.2)',
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>
              {user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : '...'}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {user?.role === 'ADMIN' ? 'Yönetici' : 'Personel'}
            </p>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-50"
            title="Çıkış Yap"
          >
            <LogOut size={13} style={{ color: 'var(--danger)' }} />
          </button>
        </div>
        <p className="text-center mt-3 text-[10.5px]" style={{ color: 'var(--text-light)' }}>
          v0.1.0 · KVKK Uyumlu
        </p>
      </div>
    </aside>
  );
}
