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
  Bot,
  Activity,
  Sliders,
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
    label: 'OTOMASYON',
    items: [
      { href: '/panel/ajanlar',           label: 'Ajanlar',             icon: Bot },
      { href: '/panel/ajanlar/loglar',    label: 'Yapılan İşlemler',    icon: Activity },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: Sliders },
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
      style={{ background: '#ffffff', borderRight: '1px solid var(--border)' }}
    >
      {/* Logo Alanı */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center"
            style={{ background: 'var(--accent)' }}
          >
            <span style={{ color: 'white', fontWeight: 700, fontSize: 14, letterSpacing: '-0.02em' }}>M</span>
          </div>
          <div className="min-w-0">
            <p
              className="text-sm font-semibold leading-tight"
              style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}
            >
              Moren
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Mali Müşavirlik
            </p>
          </div>
        </div>
      </div>

      {/* Navigasyon */}
      <nav className="flex-1 px-3 py-2 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p
              className="text-[10.5px] font-semibold uppercase tracking-wider px-3 mb-1.5"
              style={{ color: 'var(--text-light)', letterSpacing: '0.06em' }}
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
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13.5px] transition-all duration-100"
                    style={{
                      color: active ? '#ffffff' : 'var(--text-secondary)',
                      background: active ? 'var(--accent)' : 'transparent',
                      fontWeight: active ? 500 : 450,
                      letterSpacing: '-0.005em',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'var(--surface-2)';
                        el.style.color = 'var(--text)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'transparent';
                        el.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    <Icon size={15} className="flex-shrink-0" style={{ opacity: active ? 1 : 0.85 }} />
                    <span className="flex-1 leading-none">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Alt Kullanıcı Paneli */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[var(--surface-2)] transition-colors"
        >
          <div
            className="w-8 h-8 rounded-md flex-shrink-0 flex items-center justify-center text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#ffffff' }}
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
            onClick={handleLogout}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            title="Çıkış Yap"
          >
            <LogOut size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        <p className="text-center mt-2 text-[10.5px]" style={{ color: 'var(--text-light)' }}>
          v0.1.0 · KVKK Uyumlu
        </p>
      </div>
    </aside>
  );
}
