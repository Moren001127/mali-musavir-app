'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Gauge, FileText, Wallet, FolderArchive, Sparkles, UserRound } from 'lucide-react';
import { getTaxpayerToken, setTaxpayerToken } from '@/lib/taxpayer-api';

const GOLD = '#d4b876';

const NAV = [
  { href: '/mukellef', label: 'Gösterge Paneli', icon: Gauge },
  { href: '/mukellef/beyannameler', label: 'Beyannamelerim', icon: FileText },
  { href: '/mukellef/cari', label: 'Cari Hesabım', icon: Wallet },
  { href: '/mukellef/evraklar', label: 'Evraklarım', icon: FolderArchive },
  { href: '/mukellef/asistan', label: 'MOREN AI', icon: Sparkles },
  { href: '/mukellef/profil', label: 'Profilim', icon: UserRound },
];

export default function MukellefLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getTaxpayerToken()) {
      router.replace('/giris/mukellef');
      return;
    }
    setReady(true);
  }, [router]);

  function logout() {
    setTaxpayerToken(null);
    router.replace('/giris/mukellef');
  }

  const isActive = (href: string) => (href === '/mukellef' ? pathname === '/mukellef' : pathname.startsWith(href));

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f0d0b' }}>
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(180deg, #15110d, #0f0d0b)' }}>
      {/* SOL MENÜ (masaüstü) */}
      <aside
        className="hidden lg:flex w-60 shrink-0 flex-col"
        style={{ background: 'rgba(12,10,8,0.6)', borderRight: '1px solid rgba(184,160,111,0.16)' }}
      >
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 30, width: 'auto' }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>Mükellef</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition"
                style={{
                  background: active ? 'rgba(184,160,111,0.14)' : 'transparent',
                  color: active ? GOLD : 'rgba(250,250,249,0.62)',
                  border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'transparent'}`,
                }}
              >
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={logout}
          className="m-3 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-medium"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.7)' }}
        >
          <LogOut size={14} /> Çıkış
        </button>
      </aside>

      {/* SAĞ İÇERİK */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobil üst bar + yatay menü */}
        <header className="lg:hidden sticky top-0 z-20" style={{ background: 'rgba(15,13,11,0.95)', borderBottom: '1px solid rgba(184,160,111,0.18)', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <img src="/brand/moren-logo-gold.png" alt="Moren" style={{ height: 28, width: 'auto' }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>Mükellef</span>
            </div>
            <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.7)' }}>
              <LogOut size={13} /> Çıkış
            </button>
          </div>
          <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap"
                  style={{
                    background: active ? 'rgba(184,160,111,0.14)' : 'rgba(255,255,255,0.03)',
                    color: active ? GOLD : 'rgba(250,250,249,0.6)',
                    border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <Icon size={13} /> {label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
