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
    label: 'Kontrol & Raporlama',
    items: [
      { href: '/panel/kdv-kontrol',  label: 'KDV Kontrol',     icon: FileCheck },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma',    icon: Printer },
    ],
  },
  {
    label: 'Otomasyon',
    items: [
      { href: '/panel/ajanlar',           label: 'Ajanlar',             icon: Bot },
      { href: '/panel/ajanlar/loglar',    label: 'Yapılan İşlemler',    icon: Activity },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: Sliders },
    ],
  },
  {
    label: 'Sistem',
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
      style={{
        background: '#1c1917',
        borderRight: '1px solid #2c2725',
      }}
    >
      {/* Logo & Marka */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid #2c2725' }}>
        <Link href="/panel" className="flex items-start gap-3 group">
          <div
            className="w-11 h-11 flex-shrink-0 flex items-center justify-center transition-all duration-200 group-hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #b8a06f 0%, #8b7649 100%)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(184,160,111,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
          >
            <span
              style={{
                color: '#1c1917',
                fontFamily: 'Fraunces, Georgia, serif',
                fontWeight: 700,
                fontSize: 20,
                lineHeight: 1,
                letterSpacing: '-0.04em',
              }}
            >
              M
            </span>
          </div>
          <div className="min-w-0 mt-0.5">
            <p
              className="leading-none mb-1"
              style={{
                color: '#fafaf9',
                fontFamily: 'Fraunces, Georgia, serif',
                fontWeight: 600,
                fontSize: 17,
                letterSpacing: '-0.02em',
              }}
            >
              Moren
            </p>
            <p
              className="text-[10.5px] uppercase font-medium"
              style={{ color: '#b8a06f', letterSpacing: '0.12em' }}
            >
              Mali Müşavirlik
            </p>
          </div>
        </Link>
      </div>

      {/* Navigasyon */}
      <nav className="flex-1 px-3 pt-4 pb-4 space-y-5 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p
              className="text-[10px] font-semibold uppercase px-3 mb-2"
              style={{ color: 'rgba(184,160,111,0.7)', letterSpacing: '0.14em' }}
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
                    className="group flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] relative transition-all duration-150"
                    style={{
                      color: active ? '#fafaf9' : 'rgba(250,250,249,0.6)',
                      background: active ? 'rgba(184,160,111,0.12)' : 'transparent',
                      fontWeight: active ? 500 : 450,
                      letterSpacing: '-0.005em',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'rgba(255,255,255,0.04)';
                        el.style.color = '#fafaf9';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'transparent';
                        el.style.color = 'rgba(250,250,249,0.6)';
                      }
                    }}
                  >
                    {/* Aktif sol şerit (altın) */}
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                        style={{ background: '#b8a06f' }}
                      />
                    )}
                    <Icon
                      size={16}
                      className="flex-shrink-0 transition-transform duration-150 group-hover:scale-110"
                      style={{ color: active ? '#b8a06f' : 'rgba(250,250,249,0.5)' }}
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
      <div className="px-3 pt-3 pb-4" style={{ borderTop: '1px solid #2c2725' }}>
        <div
          className="flex items-center gap-3 px-2 py-2 rounded-md group cursor-pointer transition-all duration-150"
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
        >
          <div
            className="w-9 h-9 rounded-md flex-shrink-0 flex items-center justify-center text-[12.5px] font-semibold transition-transform duration-150 group-hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #b8a06f 0%, #8b7649 100%)',
              color: '#1c1917',
              boxShadow: '0 2px 6px rgba(184,160,111,0.3)',
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: '#fafaf9' }}>
              {user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : '...'}
            </p>
            <p className="text-[10.5px] uppercase tracking-wider" style={{ color: 'rgba(184,160,111,0.7)' }}>
              {user?.role === 'ADMIN' ? 'Yönetici' : 'Personel'}
            </p>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded"
            title="Çıkış Yap"
          >
            <LogOut size={13} style={{ color: 'rgba(250,250,249,0.5)' }} />
          </button>
        </div>
        <p
          className="text-center mt-3 text-[10px] uppercase"
          style={{ color: 'rgba(250,250,249,0.25)', letterSpacing: '0.15em' }}
        >
          v0.1.0 · KVKK
        </p>
      </div>
    </aside>
  );
}
