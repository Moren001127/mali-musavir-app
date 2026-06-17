'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LogOut, Gauge, FileText, Wallet, FolderArchive, Sparkles, UserRound,
  PanelTop, BrainCircuit, ReceiptText, MailWarning, ShieldCheck,
} from 'lucide-react';
import { getTaxpayerToken, setTaxpayerToken, taxpayerApi } from '@/lib/taxpayer-api';

const GOLD = '#d4b876';
const ROSE = '#f09aa8';
const STEEL = '#9da8b7';

// Ofis paneliyle aynı dil: renkli gruplu navigasyon.
const NAV_GROUPS = [
  {
    label: 'Moren AI', color: ROSE, icon: BrainCircuit,
    items: [{ href: '/mukellef/asistan', label: 'MOREN AI', icon: Sparkles }],
  },
  {
    label: 'Genel', color: GOLD, icon: PanelTop,
    items: [
      { href: '/mukellef', label: 'Gösterge Paneli', icon: Gauge },
      { href: '/mukellef/beyannameler', label: 'Beyannamelerim', icon: FileText },
      { href: '/mukellef/faturalar', label: 'Faturalarım', icon: ReceiptText },
      { href: '/mukellef/cari', label: 'Cari Hesabım', icon: Wallet },
      { href: '/mukellef/tebligatlar', label: 'e-Tebligat', icon: MailWarning },
      { href: '/mukellef/sgk', label: 'SGK Belgeleri', icon: ShieldCheck },
      { href: '/mukellef/evraklar', label: 'Evraklarım', icon: FolderArchive },
    ],
  },
  {
    label: 'Hesap', color: STEEL, icon: UserRound,
    items: [{ href: '/mukellef/profil', label: 'Profilim', icon: UserRound }],
  },
];
const FLAT_NAV = NAV_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, color: g.color })));

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

  const { data: me } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => taxpayerApi.get('/portal/me').then((r) => r.data),
    enabled: ready,
  });
  const ad = me?.companyName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'Mükellef';
  const initials = (ad.match(/\S+/g) || []).slice(0, 2).map((s: string) => s[0]).join('').toLocaleUpperCase('tr-TR') || 'M';

  function logout() {
    setTaxpayerToken(null);
    router.replace('/giris/mukellef');
  }

  const isActive = (href: string) => (href === '/mukellef' ? pathname === '/mukellef' : pathname.startsWith(href));

  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="w-10 h-10 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: GOLD, borderRightColor: GOLD }} />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden" style={{ background: '#050505' }}>
      {/* ═════ SOL MENÜ (masaüstü) — ofis Sidebar dili ═════ */}
      <aside
        className="hidden lg:flex w-[264px] shrink-0 flex-col overflow-hidden relative"
        style={{
          background: 'linear-gradient(180deg, #090807 0%, #070706 46%, #050505 100%)',
          borderRight: '1px solid rgba(212,184,118,0.12)',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.022), 14px 0 42px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{ background: 'radial-gradient(circle at 42% 0%, rgba(212,184,118,0.10), transparent 33%), radial-gradient(circle at 40% 100%, rgba(143,215,189,0.04), transparent 42%)' }}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px" style={{ background: 'linear-gradient(180deg, transparent, rgba(212,184,118,0.20), transparent)' }} />

        {/* LOGO KARTI */}
        <div className="relative px-3 py-3" style={{ borderBottom: '1px solid rgba(212,184,118,0.10)', background: 'linear-gradient(180deg, rgba(212,184,118,0.045), rgba(5,5,5,0.20) 68%, transparent)' }}>
          <Link
            href="/mukellef"
            className="group relative flex h-[104px] items-center justify-center rounded-2xl border px-5 py-3 transition-all duration-300 hover:border-[#d4b87666]"
            style={{
              background: 'linear-gradient(145deg, rgba(212,184,118,0.045), rgba(255,255,255,0.008) 52%, rgba(0,0,0,0.20))',
              borderColor: 'rgba(212,184,118,0.11)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035), 0 16px 34px rgba(0,0,0,0.24)',
            }}
            aria-label="Moren"
          >
            <span className="block h-[88px] w-[140px]">
              <img src="/brand/moren-logo-gold.png" alt="Moren Mali Müşavirlik" className="block h-full w-full object-contain" />
            </span>
          </Link>
          <div className="mt-2 flex justify-center">
            <span className="text-[10.5px] font-bold uppercase tracking-[.18em]" style={{ color: 'rgba(212,184,118,0.85)' }}>Mükellef Portalı</span>
          </div>
        </div>

        {/* NAVİGASYON */}
        <nav className="flex-1 px-2.5 pt-3 pb-4 space-y-3 overflow-y-auto relative">
          {NAV_GROUPS.map((group) => {
            const GIcon = group.icon;
            return (
              <div key={group.label}>
                <div className="px-1 mb-1.5">
                  <div
                    className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5"
                    style={{
                      background: `linear-gradient(90deg, ${group.color}0d 0%, rgba(255,255,255,0.010) 46%, transparent 100%)`,
                      borderColor: `${group.color}1c`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.025), 0 6px 18px ${group.color}05`,
                    }}
                  >
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md" style={{ background: `${group.color}18`, border: `1px solid ${group.color}32`, boxShadow: `0 0 14px ${group.color}10, inset 0 1px 0 rgba(255,255,255,0.07)` }}>
                      <GIcon size={12} strokeWidth={2.15} style={{ color: group.color }} />
                    </span>
                    <p className="text-[10.5px] font-extrabold uppercase flex-none" style={{ color: group.color, textShadow: `0 0 16px ${group.color}26` }}>{group.label}</p>
                    <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${group.color}44, transparent)` }} />
                  </div>
                </div>
                <div className="ml-2.5 space-y-1">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        className="group relative flex items-center gap-3 px-3 py-[9px] rounded-xl border text-[13.5px] overflow-hidden transition-all"
                        style={{
                          color: active ? '#fafaf9' : 'rgba(250,250,249,0.58)',
                          background: active ? `linear-gradient(135deg, ${group.color}1a 0%, rgba(255,255,255,0.03) 50%, ${group.color}0b 100%)` : 'rgba(255,255,255,0.006)',
                          borderColor: active ? `${group.color}42` : 'rgba(255,255,255,0.026)',
                          boxShadow: active ? `inset 0 1px 0 rgba(255,255,255,0.055), 0 8px 22px ${group.color}0d` : 'inset 0 1px 0 rgba(255,255,255,0.016)',
                          fontWeight: active ? 600 : 450,
                        }}
                      >
                        <Icon size={16} style={{ color: active ? group.color : 'rgba(250,250,249,0.5)' }} /> {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* ÇIKIŞ */}
        <div className="px-3 pb-3 pt-1 relative" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            type="button"
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition hover:bg-white/[0.05]"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.7)' }}
          >
            <LogOut size={14} /> Çıkış
          </button>
        </div>
      </aside>

      {/* ═════ SAĞ İÇERİK ═════ */}
      <div className="flex-1 min-w-0 max-w-full flex flex-col">
        {/* TopBar (masaüstü) — ofis dili */}
        <header
          className="hidden lg:flex h-14 items-center justify-between px-6 flex-shrink-0"
          style={{ background: '#080807', borderBottom: '1px solid rgba(212,184,118,0.08)', boxShadow: '0 1px 0 rgba(0,0,0,0.55)' }}
        >
          <p className="text-sm capitalize" style={{ color: 'rgba(250,250,249,0.42)' }}>{today}</p>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-[10px] border px-3 h-9" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.040), rgba(255,255,255,0.018))', borderColor: 'rgba(212,184,118,0.18)' }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-[7px] text-[10.5px] font-black" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>{initials}</span>
              <span className="max-w-[220px] truncate text-[12.5px] font-bold" style={{ color: '#f5f5f4' }}>{ad}</span>
            </div>
          </div>
        </header>

        {/* Mobil üst bar + yatay menü */}
        <header className="lg:hidden sticky top-0 z-20" style={{ background: 'rgba(8,8,7,0.96)', borderBottom: '1px solid rgba(212,184,118,0.14)', backdropFilter: 'blur(8px)' }}>
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
            {FLAT_NAV.map(({ href, label, icon: Icon, color }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap"
                  style={{
                    background: active ? `${color}1f` : 'rgba(255,255,255,0.03)',
                    color: active ? '#fafaf9' : 'rgba(250,250,249,0.6)',
                    border: `1px solid ${active ? `${color}45` : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <Icon size={13} style={{ color: active ? color : 'rgba(250,250,249,0.5)' }} /> {label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 min-w-0 max-w-full overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-4 lg:p-6 animate-fade-up">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
