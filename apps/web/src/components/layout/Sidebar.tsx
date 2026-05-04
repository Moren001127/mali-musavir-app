'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe, useLogout } from '@/hooks/useAuth';
import {
  LayoutDashboard, Users, FileText, Receipt, Users2, FolderOpen,
  Bell, Settings, FileCheck, Printer, LogOut, Bot, Activity, Sliders,
  Zap, Sparkles, ChevronRight, Cpu, FileInput, Mailbox, Calculator, BookOpen, ShieldCheck, ShieldAlert,
  Scale, TrendingUp, Table2, MessageSquare, AlertTriangle, Brain,
  Car, Gavel, Wallet, Megaphone, Archive,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { pendingDecisionsApi } from '@/lib/pending-decisions';

// Elit Boutique altın ailesi — her grup kendi tonunu alır
const GOLD      = '#d4b876';  // Ana altın
const CHAMPAGNE = '#e8d6a0';  // Parlak şampanya
const BRONZE    = '#c0a079';  // Bronz
const COPPER    = '#d99560';  // Bakır
const navGroups = [
  {
    label: 'Genel',
    color: GOLD,
    icon: Sparkles,
    items: [
      { href: '/panel',              label: 'Gösterge Paneli', icon: LayoutDashboard },
      { href: '/panel/moren-ai',     label: 'Moren AI',         icon: MessageSquare },
      { href: '/panel/mukellefler',  label: 'Mükellefler',      icon: Users },
    ],
  },
  {
    label: 'Faturalar & Belgeler',
    color: CHAMPAGNE,
    icon: Receipt,
    items: [
      { href: '/panel/faturalar',              label: 'Faturalar',          icon: Receipt },
      { href: '/panel/e-arsiv',                label: 'E-Arşiv / E-Fatura', icon: Archive },
      { href: '/panel/ajanlar/mihsap',         label: 'Mihsap Fatura',      icon: Bot },
      { href: '/panel/ajanlar/mihsap/incele',  label: 'Düzeltme Bekleyen',  icon: ShieldAlert },
      { href: '/panel/fis-yazdirma',           label: 'Fiş Yazdırma',       icon: Printer },
      { href: '/panel/evraklar',               label: 'Evrak Yönetimi',     icon: FolderOpen },
      { href: '/panel/evraklar/yenileme',      label: 'Evrak Yenileme',     icon: AlertTriangle },
    ],
  },
  {
    label: 'KDV & Beyanname',
    color: BRONZE,
    icon: FileCheck,
    items: [
      { href: '/panel/kdv-kontrol',          label: 'KDV Kontrol',     icon: FileCheck },
      { href: '/panel/kdv-beyanname',        label: 'KDV Beyanname',   icon: FileCheck },
      { href: '/panel/ajanlar/kdv-hazirlik', label: 'KDV Ön-Hazırlık', icon: Calculator },
      { href: '/panel/beyannameler',         label: 'Beyannameler',    icon: FileText },
      { href: '/panel/ajanlar/e-defter',     label: 'E-Defter Kontrol', icon: BookOpen },
      { href: '/panel/ajanlar/sgk',          label: 'SGK Bildirge',    icon: ShieldCheck },
      { href: '/panel/ajanlar/tebligat',     label: 'Tebligat Özet',   icon: Mailbox },
    ],
  },
  {
    label: 'Muhasebe & Raporlar',
    color: GOLD,
    icon: Table2,
    items: [
      { href: '/panel/mizan',         label: 'Mizan',         icon: Table2 },
      { href: '/panel/bilanco',       label: 'Bilanço',       icon: Scale },
      { href: '/panel/gelir-tablosu', label: 'Gelir Tablosu', icon: TrendingUp },
      { href: '/panel/isletme-hesap-ozeti', label: 'İşletme Hesap Özeti', icon: BookOpen },
      { href: '/panel/cari-kasa',     label: 'Cari Kasa',     icon: Wallet },
      { href: '/panel/bordro',        label: 'Bordro & SGK',  icon: Users2 },
    ],
  },
  {
    label: 'Otomasyon',
    color: BRONZE,
    icon: Zap,
    items: [
      { href: '/panel/ajanlar',           label: 'Tüm Ajanlar',         icon: Cpu },
      { href: '/panel/ajanlar/luca',      label: 'Luca Çekim',          icon: FileInput },
      { href: '/panel/onay-kuyrugu',      label: 'Onay Kuyruğu',        icon: AlertTriangle },
      { href: '/panel/ajanlar/loglar',    label: 'Yapılan İşlemler',    icon: Activity },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: Sliders },
      { href: '/panel/firma-hafizasi',    label: 'Firma Hafızası',      icon: Brain },
    ],
  },
  {
    label: 'Galeri',
    color: COPPER,
    icon: Car,
    items: [
      { href: '/panel/galeri/hgs-ihlal', label: 'HGS İhlal Sorgulama', icon: Gavel },
    ],
  },
  {
    label: 'İletişim',
    color: CHAMPAGNE,
    icon: Bell,
    items: [
      { href: '/panel/bildirimler', label: 'Bildirimler', icon: Bell },
      { href: '/panel/duyurular',   label: 'Duyurular',   icon: Megaphone },
    ],
  },
  {
    label: 'Sistem',
    color: COPPER,
    icon: Settings,
    items: [
      { href: '/panel/ayarlar/denetim', label: 'Denetim Günlüğü', icon: ShieldCheck },
      { href: '/panel/ayarlar',         label: 'Ayarlar',         icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: user } = useMe();
  const logout = useLogout();

  // Onay kuyrugu bekleyen sayisi — badge icin
  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => pendingDecisionsApi.count().catch(() => ({ bekleyen: 0 })),
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const bekleyenSayisi = pendingCount?.bekleyen || 0;

  const isActive = (href: string) =>
    href === '/panel' ? pathname === '/panel' : pathname.startsWith(href);

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  return (
    <aside
      className="w-64 flex flex-col flex-shrink-0 overflow-hidden relative"
      style={{ background: '#0f0d0b', borderRight: '1px solid #1f1a15' }}
    >
      {/* Dekoratif radial gradient arka plan */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background: 'radial-gradient(circle at 20% 0%, rgba(184,160,111,0.15), transparent 50%), radial-gradient(circle at 80% 100%, rgba(184,160,111,0.08), transparent 40%)',
        }}
      />

      {/* === LOGO === */}
      <div className="relative px-3 pt-5 pb-5 flex justify-center" style={{ borderBottom: '1px solid #1f1a15' }}>
        <Link href="/panel" className="block group">
          <img
            src="/brand/moren-logo-gold.png"
            alt="Moren Mali Müşavirlik"
            className="transition-transform duration-300 group-hover:scale-105"
            style={{
              height: 140,
              width: 'auto',
              maxWidth: '100%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 20px rgba(212,184,118,0.4))',
            }}
          />
        </Link>
      </div>

      {/* === NAVIGASYON === */}
      <nav className="flex-1 px-2 pt-3 pb-4 space-y-4 overflow-y-auto relative">
        {navGroups.map((group) => {
          const GIcon = group.icon;
          return (
            <div key={group.label}>
              {/* Grup Başlığı */}
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <GIcon size={11} style={{ color: group.color, opacity: 0.85 }} />
                <p
                  className="text-[9.5px] font-bold uppercase flex-1"
                  style={{ color: 'rgba(250,250,249,0.42)', letterSpacing: '0.15em' }}
                >
                  {group.label}
                </p>
                <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(184,160,111,0.2), transparent)' }} />
              </div>

              {/* Menü Öğeleri */}
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className="group relative flex items-center gap-3 px-3 py-[9px] rounded-lg text-[13px] overflow-hidden"
                      style={{
                        color: active ? '#fafaf9' : 'rgba(250,250,249,0.55)',
                        background: active
                          ? `linear-gradient(90deg, ${group.color}20, ${group.color}08)`
                          : 'transparent',
                        fontWeight: active ? 600 : 450,
                        letterSpacing: '-0.005em',
                        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = 'rgba(184,160,111,0.08)';
                          el.style.color = '#fafaf9';
                          el.style.transform = 'translateX(4px) scale(1.02)';
                          el.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = 'transparent';
                          el.style.color = 'rgba(250,250,249,0.55)';
                          el.style.transform = 'translateX(0) scale(1)';
                          el.style.boxShadow = 'none';
                        }
                      }}
                    >
                      {/* Aktif sol şerit */}
                      {active && (
                        <>
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                            style={{
                              background: `linear-gradient(180deg, ${group.color}, ${group.color}99)`,
                              boxShadow: `0 0 8px ${group.color}66`,
                            }}
                          />
                          {/* Parıltı efekti */}
                          <span
                            className="absolute left-0 top-0 bottom-0 w-full opacity-50 pointer-events-none"
                            style={{
                              background: `linear-gradient(90deg, ${group.color}10 0%, transparent 50%)`,
                            }}
                          />
                        </>
                      )}

                      {/* İkon kutucuğu */}
                      <div
                        className="relative flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: active ? `${group.color}22` : 'transparent',
                        }}
                      >
                        <Icon
                          size={14}
                          strokeWidth={active ? 2.25 : 1.75}
                          style={{ color: active ? group.color : 'currentColor' }}
                        />
                      </div>

                      <span className="flex-1 leading-none relative">{label}</span>

                      {/* Onay kuyruğu badge */}
                      {href === '/panel/onay-kuyrugu' && bekleyenSayisi > 0 && (
                        <span
                          className="inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-bold rounded-full flex-shrink-0"
                          style={{
                            background: '#d97706',
                            color: '#fafaf9',
                            minWidth: 16,
                            boxShadow: '0 0 8px rgba(217, 119, 6, 0.5)',
                          }}
                        >
                          {bekleyenSayisi > 99 ? '99+' : bekleyenSayisi}
                        </span>
                      )}

                      {/* Sağ ok - aktifse */}
                      {active && (
                        <ChevronRight
                          size={12}
                          className="transition-transform duration-300 group-hover:translate-x-0.5"
                          style={{ color: group.color, opacity: 0.7 }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* === KULLANICI KARTI === */}
      <div className="relative px-3 pt-3 pb-4" style={{ borderTop: '1px solid #1f1a15' }}>
        <div
          className="relative overflow-hidden rounded-xl p-3 group transition-all duration-300"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Dekoratif */}
          <div
            className="absolute -bottom-4 -right-4 w-16 h-16 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #b8a06f, transparent 70%)' }}
          />
          <div className="relative flex items-center gap-3">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-lg blur-sm opacity-40"
                style={{ background: 'linear-gradient(135deg, #b8a06f, #8b7649)' }}
              />
              <div
                className="relative w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center text-[12px] font-bold transition-transform duration-200 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #d4b876, #8b7649)',
                  color: '#0f0d0b',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                {initials}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
                {user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : '...'}
              </p>
              <p className="text-[10px] font-medium mt-0.5 flex items-center gap-1" style={{ color: '#b8a06f' }}>
                <span className="w-1 h-1 rounded-full" style={{ background: '#b8a06f' }} />
                {user?.role === 'ADMIN' ? 'YÖNETİCİ' : 'PERSONEL'}
              </p>
            </div>
            <button
              onClick={() => logout.mutate()}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-500/20"
              title="Çıkış Yap"
            >
              <LogOut size={13} style={{ color: '#ef4444' }} />
            </button>
          </div>
        </div>
        <p
          className="text-center mt-3 text-[9px] uppercase tabular-nums"
          style={{ color: 'rgba(250,250,249,0.22)', letterSpacing: '0.2em' }}
        >
          v0.1.0 · KVKK
        </p>
      </div>
    </aside>
  );
}
