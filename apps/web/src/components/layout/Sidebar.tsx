'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe, useLogout } from '@/hooks/useAuth';
import {
  BellRing,
  BookMarked,
  BookOpenText,
  BotMessageSquare,
  BrainCircuit,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  DatabaseZap,
  FileCheck2,
  FileScan,
  FileStack,
  FileText,
  Gauge,
  Gavel,
  HandCoins,
  History,
  Landmark,
  LockKeyhole,
  LogOut,
  MailSearch,
  Megaphone,
  MessageSquareText,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  Printer,
  ReceiptText,
  Scale,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Table2,
  TrendingUp,
  UserCog,
  UserRoundSearch,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { pendingDecisionsApi } from '@/lib/pending-decisions';

const GOLD = '#d4b876';
const ROSE = '#f09aa8';
const SAGE = '#8fd7bd';
const AMBER = '#d8ad70';
const SKY = '#8cbde8';
const COPPER = '#d9a06c';
const STEEL = '#9da8b7';
const SIDEBAR_COLLAPSED_KEY = 'moren-sidebar-collapsed';
const SIDEBAR_WIDTH = 284;
const SIDEBAR_COLLAPSED_WIDTH = 68;
// Sidebar gruplari kullanicinin gunluk akisi icin siralandi.
const navGroups = [
  {
    label: 'Moren AI',
    color: ROSE,
    icon: BrainCircuit,
    items: [
      { href: '/panel/moren-ai', label: 'MOREN AI', icon: BrainCircuit },
      { href: '/panel/otomasyonlar', label: 'Otomasyonlar', icon: WandSparkles },
    ],
  },
  {
    label: 'Genel',
    color: GOLD,
    icon: PanelTop,
    items: [
      { href: '/panel', label: 'Gösterge Paneli', icon: Gauge },
      { href: '/panel/mukellefler', label: 'Mükellef Listesi', icon: UserRoundSearch },
      { href: '/panel/mesajlar', label: 'Mesajlar', icon: MessageCircle },
      { href: '/panel/bot-kalite', label: 'Bot Kalite', icon: ShieldCheck },
      { href: '/panel/is-yuku', label: 'İş Akışı', icon: Workflow },
      { href: '/panel/gorevler', label: 'Görevler & Notlar', icon: ClipboardCheck },
      { href: '/panel/bildirimler', label: 'Bildirimler', icon: BellRing },
    ],
  },
  {
    label: 'Fatura & Muhasebe',
    color: SAGE,
    icon: ReceiptText,
    items: [
      { href: '/fatura-merkezi', label: 'Fatura İşleme Merkezi', icon: FileStack },
      { href: '/panel/e-arsiv', label: 'E-Fatura / E-Arşiv Sorgulama', icon: FileScan },
      { href: '/panel/ajanlar/mihsap', label: 'Fatura İşleme', icon: BotMessageSquare },
      { href: '/panel/faturalar', label: 'İşlenen Faturalar', icon: ReceiptText },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma', icon: Printer },
      { href: '/panel/banka-takip', label: 'Banka Takip', icon: Landmark },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: UserCog },
    ],
  },
  {
    label: 'Vergi & Beyanname',
    color: AMBER,
    icon: FileCheck2,
    items: [
      { href: '/panel/kdv-kontrol', label: 'KDV Kontrol', icon: FileCheck2 },
      { href: '/panel/kdv-beyanname', label: 'KDV Beyanname', icon: FileCheck2 },
      { href: '/panel/beyannameler', label: 'Beyannameler', icon: FileText },
      { href: '/panel/ajanlar/tebligat', label: 'e-Tebligat Kontrol', icon: MailSearch },
      { href: '/panel/ajanlar/sgk', label: 'SGK Otomasyonu', icon: ShieldAlert },
    ],
  },
  {
    label: 'Mali Veriler',
    color: SKY,
    icon: DatabaseZap,
    items: [
      { href: '/panel/mizan', label: 'Mizan', icon: Table2 },
      { href: '/panel/isletme-hesap-ozeti', label: 'İşletme Hesap Özeti', icon: BookOpenText },
      { href: '/panel/gelir-tablosu', label: 'Gelir Tablosu', icon: TrendingUp },
      { href: '/panel/bilanco', label: 'Bilanço', icon: Scale },
      { href: '/panel/ajanlar/e-defter', label: 'E-Defter Kontrol', icon: BookMarked },
    ],
  },
  {
    label: 'Ofis',
    color: COPPER,
    icon: Building2,
    items: [
      { href: '/panel/cari-kasa', label: 'Cari Kasa & Tahsilat', icon: HandCoins },
      { href: '/panel/duyurular', label: 'Duyurular', icon: Megaphone },
      { href: '/panel/galeri/hgs-ihlal', label: 'HGS İhlal Sorgulama', icon: Gavel },
    ],
  },
  {
    label: 'Teknik & Sistem',
    color: STEEL,
    icon: Settings2,
    items: [
      { href: '/panel/hatirlatmalar', label: 'WhatsApp Otomasyonu', icon: MessageSquareText },
      { href: '/panel/ajanlar', label: 'Tüm Ajanlar', icon: Cpu },
      { href: '/panel/ajanlar/luca', label: 'Luca Oturumu', icon: ShieldCheck },
      { href: '/panel/ajan-saglik', label: 'Sağlık Panosu', icon: Stethoscope },
      { href: '/panel/ajanlar/loglar', label: 'Yapılan İşlemler', icon: History },
      { href: '/panel/ayarlar', label: 'Ayarlar', icon: Settings2 },
      { href: '/panel/ayarlar/denetim', label: 'Denetim Günlüğü', icon: Shield },
      { href: '/panel/sistem/kilitli-moduller', label: 'Kilitli Modüller', icon: LockKeyhole },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: user } = useMe();
  const logout = useLogout();
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedTooltip, setCollapsedTooltip] = useState<{ label: string; color: string; top: number } | null>(null);

  // Onay kuyrugu bekleyen sayisi — badge icin
  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => pendingDecisionsApi.count().catch(() => ({ bekleyen: 0 })),
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const bekleyenSayisi = pendingCount?.bekleyen || 0;

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch {
      setCollapsed(false);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (!collapsed) {
      setCollapsedTooltip(null);
    }
  }, [collapsed]);

  const showCollapsedTooltip = (event: React.MouseEvent<HTMLElement>, label: string, color = GOLD) => {
    if (!collapsed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCollapsedTooltip({ label, color, top: rect.top + rect.height / 2 });
  };

  const hideCollapsedTooltip = () => setCollapsedTooltip(null);

  const exactActiveHrefs = new Set(['/panel', '/panel/ajanlar', '/panel/ayarlar']);
  const isActive = (href: string) =>
    exactActiveHrefs.has(href) ? pathname === href : pathname.startsWith(href);

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  return (
    <>
    <aside
      className="flex flex-col flex-shrink-0 overflow-hidden relative"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        background: 'linear-gradient(180deg, #090807 0%, #070706 46%, #050505 100%)',
        borderRight: '1px solid rgba(212,184,118,0.12)',
        transition: 'width 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.022), 14px 0 42px rgba(0,0,0,0.28)',
      }}
    >
      {/* Dekoratif radial gradient arka plan */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          background: 'radial-gradient(circle at 42% 0%, rgba(212,184,118,0.10), transparent 33%), radial-gradient(circle at 110% 28%, rgba(240,154,168,0.045), transparent 36%), radial-gradient(circle at 40% 100%, rgba(143,215,189,0.04), transparent 42%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-px"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(212,184,118,0.20), transparent)' }}
      />

      {/* === LOGO === */}
      <div
        className={collapsed ? 'relative px-1.5 py-2.5' : 'relative px-3 py-3'}
        style={{
          borderBottom: '1px solid rgba(212,184,118,0.10)',
          background: 'linear-gradient(180deg, rgba(212,184,118,0.045), rgba(5,5,5,0.20) 68%, transparent)',
        }}
      >
        <Link
          href="/panel"
          className={collapsed
            ? 'group relative flex h-12 items-center justify-center rounded-xl border transition-all duration-300 hover:border-[#d4b87666]'
            : 'group relative flex h-[122px] items-center justify-center rounded-2xl border px-5 py-3 transition-all duration-300 hover:border-[#d4b87666]'
          }
          style={{
            background: 'linear-gradient(145deg, rgba(212,184,118,0.045), rgba(255,255,255,0.008) 52%, rgba(0,0,0,0.20))',
            borderColor: 'rgba(212,184,118,0.11)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035), 0 16px 34px rgba(0,0,0,0.24)',
          }}
          aria-label="Moren"
          onMouseEnter={(e) => showCollapsedTooltip(e, 'Moren Mali Müşavirlik', GOLD)}
          onMouseLeave={hideCollapsedTooltip}
        >
          <span className={collapsed ? 'block h-9 w-[54px]' : 'block h-[104px] w-[150px]'}>
            <img
              src={collapsed ? '/brand/moren-logo-mark.png' : '/brand/moren-logo-gold.png'}
              alt="Moren Mali Müşavirlik"
              className="block h-full w-full object-contain"
              style={{ filter: 'none' }}
            />
          </span>
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={collapsed
            ? 'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]'
            : 'absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]'
          }
          style={{
            background: 'rgba(15,13,11,0.78)',
            borderColor: 'rgba(212,184,118,0.28)',
            color: GOLD,
            boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
          }}
          aria-label={collapsed ? 'Sol menuyu genislet' : 'Sol menuyu daralt'}
          onMouseEnter={(e) => showCollapsedTooltip(e, 'Menüyü genişlet', GOLD)}
          onMouseLeave={hideCollapsedTooltip}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* === NAVIGASYON === */}
      <nav className={collapsed ? 'flex-1 px-1.5 pt-2.5 pb-4 space-y-2.5 overflow-y-auto relative' : 'flex-1 px-2.5 pt-3 pb-4 space-y-3 overflow-y-auto relative'}>
        {navGroups.map((group) => {
          const GIcon = group.icon;
          return (
            <div key={group.label}>
              {/* Grup Başlığı */}
              <div className={collapsed ? 'mb-1 flex justify-center px-0' : 'px-1 mb-1.5'}>
                <div
                  className={collapsed
                    ? 'flex h-8 w-8 items-center justify-center rounded-lg border'
                    : 'flex items-center gap-1.5 rounded-lg border px-2 py-1.5'
                  }
                  onMouseEnter={(e) => showCollapsedTooltip(e, group.label, group.color)}
                  onMouseLeave={hideCollapsedTooltip}
                  style={{
                    background: `linear-gradient(90deg, ${group.color}0d 0%, rgba(255,255,255,0.010) 46%, transparent 100%)`,
                    borderColor: `${group.color}1c`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.025), 0 6px 18px ${group.color}05`,
                  }}
                >
                  <span
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-md"
                    style={{
                      background: `${group.color}18`,
                      border: `1px solid ${group.color}32`,
                      boxShadow: `0 0 14px ${group.color}10, inset 0 1px 0 rgba(255,255,255,0.07)`,
                    }}
                  >
                    <GIcon size={12} strokeWidth={2.15} style={{ color: group.color }} />
                  </span>
                  {!collapsed && (
                    <>
                      <p
                        className="text-[10.5px] font-extrabold uppercase flex-none"
                        style={{
                          color: group.color,
                          letterSpacing: 0,
                          textShadow: `0 0 16px ${group.color}26`,
                        }}
                      >
                        {group.label}
                      </p>
                      <div
                        className="h-px flex-1"
                        style={{ background: `linear-gradient(90deg, ${group.color}44, transparent)` }}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Menü Öğeleri */}
              <div className={collapsed ? 'space-y-1' : 'ml-2.5 space-y-1'}>
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  const baseBackground = active
                    ? `linear-gradient(135deg, ${group.color}1a 0%, rgba(255,255,255,0.03) 50%, ${group.color}0b 100%)`
                    : 'rgba(255,255,255,0.006)';
                  const baseBorder = active ? `${group.color}42` : 'rgba(255,255,255,0.026)';
                  const baseColor = active ? '#fafaf9' : 'rgba(250,250,249,0.58)';
                  const baseShadow = active
                    ? `inset 0 1px 0 rgba(255,255,255,0.055), 0 8px 22px ${group.color}0d`
                    : 'inset 0 1px 0 rgba(255,255,255,0.016)';

                  return (
                    <Link
                      key={href}
                      href={href}
                      className={collapsed
                        ? 'group relative flex items-center justify-center rounded-xl border py-2.5 text-[13px] overflow-hidden'
                        : 'group relative flex items-center gap-3 px-3 py-[9px] rounded-xl border text-[13.5px] overflow-hidden'
                      }
                      style={{
                        color: baseColor,
                        background: baseBackground,
                        borderColor: baseBorder,
                        boxShadow: baseShadow,
                        fontWeight: active ? 600 : 450,
                        letterSpacing: 0,
                        transition: 'all 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      onMouseEnter={(e) => {
                        showCollapsedTooltip(e, label, group.color);
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = `linear-gradient(135deg, ${group.color}16 0%, rgba(255,255,255,0.045) 48%, ${group.color}06 100%)`;
                          el.style.borderColor = `${group.color}42`;
                          el.style.color = '#fffaf2';
                          el.style.transform = collapsed ? 'translateY(-1px)' : 'translateX(6px)';
                          el.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.075), 0 10px 28px ${group.color}10`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        hideCollapsedTooltip();
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = baseBackground;
                          el.style.borderColor = baseBorder;
                          el.style.color = baseColor;
                          el.style.transform = 'translateX(0)';
                          el.style.boxShadow = baseShadow;
                        }
                      }}
                      aria-label={label}
                    >
                      <span
                        className="absolute inset-y-1 left-1 w-10 rounded-full opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-50"
                        style={{ background: `${group.color}1b` }}
                      />
                      <span
                        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                        style={{
                          background: `linear-gradient(90deg, transparent 0%, ${group.color}0f 46%, transparent 100%)`,
                        }}
                      />

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
                        className="relative flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-105"
                        style={{
                          width: collapsed ? 28 : 26,
                          height: collapsed ? 28 : 26,
                          borderRadius: collapsed ? 10 : 8,
                          background: active ? `${group.color}1f` : `${group.color}0c`,
                          border: `1px solid ${active ? `${group.color}3a` : `${group.color}18`}`,
                          boxShadow: active
                            ? `0 0 14px ${group.color}20`
                            : `inset 0 1px 0 rgba(255,255,255,0.035)`,
                        }}
                      >
                        <Icon
                          size={14}
                          strokeWidth={active ? 2.25 : 1.75}
                          style={{ color: group.color, opacity: active ? 1 : 0.78 }}
                        />
                      </div>

                      {!collapsed && (
                        <span className="flex-1 min-w-0 truncate leading-none relative transition-colors duration-200">{label}</span>
                      )}

                      {/* Bekleyen onay badge — Fatura İşleme menüsünde göster (Onay Kuyruğu oraya entegre) */}
                      {href === '/panel/ajanlar/mihsap' && bekleyenSayisi > 0 && (
                        <span
                          className={collapsed
                            ? 'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold'
                            : 'inline-flex items-center justify-center px-1.5 h-4 text-[10px] font-bold rounded-full flex-shrink-0'
                          }
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
                      {active && !collapsed && (
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

        {/* === KULLANICI KARTI === */}
        <div className={collapsed ? 'relative px-0 pt-3 pb-1' : 'relative px-1 pt-4 pb-1'} style={{ borderTop: '1px solid rgba(212,184,118,0.10)' }}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="relative h-10 w-10 rounded-xl flex items-center justify-center text-[12px] font-bold"
                onMouseEnter={(e) =>
                  showCollapsedTooltip(
                    e,
                    user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : 'Kullanıcı',
                    GOLD
                  )
                }
                onMouseLeave={hideCollapsedTooltip}
                style={{
                  background: 'linear-gradient(135deg, #d4b876, #8b7649)',
                  color: '#0f0d0b',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px rgba(0,0,0,0.24)',
                }}
                aria-label={user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : 'Kullanici'}
              >
                {initials}
              </div>
              <button
                onClick={() => logout.mutate()}
                className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-red-500/15"
                style={{ borderColor: 'rgba(239,68,68,0.22)', color: '#ef4444' }}
                aria-label="Cikis yap"
                onMouseEnter={(e) => showCollapsedTooltip(e, 'Çıkış yap', '#ef4444')}
                onMouseLeave={hideCollapsedTooltip}
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
          <div
            className="relative overflow-hidden rounded-xl p-3 group transition-all duration-300"
            style={{
              background: 'linear-gradient(135deg, rgba(212,184,118,0.055), rgba(255,255,255,0.012))',
              border: '1px solid rgba(212,184,118,0.11)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.032)',
            }}
          >
            <div
              className="absolute -bottom-5 -right-5 w-20 h-20 rounded-full"
              style={{ background: 'radial-gradient(circle, #d4b876, transparent 70%)', opacity: 0.18 }}
            />
            <div className="relative flex items-center gap-3">
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-lg blur-sm opacity-40"
                  style={{ background: 'linear-gradient(135deg, #d4b876, #8b7649)' }}
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
                <p className="text-[10px] font-medium mt-0.5 flex items-center gap-1" style={{ color: '#d4b876' }}>
                  <span className="w-1 h-1 rounded-full" style={{ background: '#d4b876' }} />
                  {user?.role === 'ADMIN' ? 'YÖNETİCİ' : 'PERSONEL'}
                </p>
              </div>
              <button
                onClick={() => logout.mutate()}
                className="opacity-60 hover:opacity-100 transition-all p-1.5 rounded-md hover:bg-red-500/20"
                title="Çıkış Yap"
                aria-label="Çıkış yap"
              >
                <LogOut size={13} style={{ color: '#ef4444' }} />
              </button>
            </div>
          </div>
          )}
          {!collapsed && (
          <p
            className="text-center mt-3 text-[9px] uppercase tabular-nums"
            style={{ color: 'rgba(250,250,249,0.22)', letterSpacing: 0 }}
          >
            v0.1.0 · KVKK
          </p>
          )}
        </div>
      </nav>
    </aside>
    {collapsed && collapsedTooltip && (
      <div
        className="pointer-events-none fixed z-[9999] max-w-[260px] rounded-lg border px-3 py-2 text-[12px] font-semibold shadow-2xl"
        style={{
          left: SIDEBAR_COLLAPSED_WIDTH + 10,
          top: collapsedTooltip.top,
          transform: 'translateY(-50%)',
          background: 'linear-gradient(135deg, rgba(22,18,15,0.98), rgba(10,9,7,0.98))',
          borderColor: `${collapsedTooltip.color}4d`,
          color: '#fafaf9',
          boxShadow: `0 14px 30px rgba(0,0,0,0.36), 0 0 20px ${collapsedTooltip.color}20`,
          whiteSpace: 'nowrap',
        }}
      >
        {collapsedTooltip.label}
      </div>
    )}
    </>
  );
}
