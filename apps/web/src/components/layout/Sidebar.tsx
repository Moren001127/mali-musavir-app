'use client';
import React from 'react';
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
  PanelTop,
  Printer,
  QrCode,
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
      { href: '/panel/whatsapp-qr', label: 'WhatsApp QR', icon: QrCode },
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

  // Onay kuyrugu bekleyen sayisi — badge icin
  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => pendingDecisionsApi.count().catch(() => ({ bekleyen: 0 })),
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const bekleyenSayisi = pendingCount?.bekleyen || 0;

  const exactActiveHrefs = new Set(['/panel', '/panel/ajanlar', '/panel/ayarlar']);
  const isActive = (href: string) =>
    exactActiveHrefs.has(href) ? pathname === href : pathname.startsWith(href);

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
      <div
        className="relative px-4 pt-4 pb-4"
        style={{
          borderBottom: '1px solid rgba(212,184,118,0.18)',
          background:
            'linear-gradient(180deg, rgba(212,184,118,0.045) 0%, rgba(15,13,11,0.08) 72%, transparent 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 23% 42%, rgba(212,184,118,0.10), transparent 34%), radial-gradient(circle at 76% 42%, rgba(212,184,118,0.055), transparent 36%)',
          }}
        />
        <Link
          href="/panel"
          className="group relative flex items-center justify-center gap-3 transition-transform duration-300 hover:scale-[1.015]"
          aria-label="Moren Mali Müşavirlik"
        >
          <span className="relative block h-[52px] w-[104px] shrink-0 overflow-hidden">
            <img
              src="/brand/moren-logo-gold.png"
              alt=""
              aria-hidden="true"
              className="absolute transition-transform duration-300 group-hover:scale-[1.025]"
              style={{
                width: 132,
                height: 'auto',
                maxWidth: 'none',
                left: -16,
                top: -1,
                objectFit: 'contain',
              }}
            />
          </span>
          <span className="flex min-w-0 flex-col items-center">
            <span
              className="leading-none"
              style={{
                color: '#ecd290',
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 25,
                fontWeight: 700,
                letterSpacing: 0,
                textShadow: '0 0 14px rgba(212,184,118,0.16)',
              }}
            >
              MOREN
            </span>
            <span
              className="mt-1 leading-none"
              style={{
                color: 'rgba(212,184,118,0.78)',
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 8.8,
                fontWeight: 600,
                letterSpacing: 0,
              }}
            >
              MALİ MÜŞAVİRLİK
            </span>
            <span
              className="mt-2 h-px w-full"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(212,184,118,0.62), transparent)' }}
            />
          </span>
        </Link>
      </div>

      {/* === NAVIGASYON === */}
      <nav className="flex-1 px-2 pt-3 pb-5 space-y-4 overflow-y-auto relative">
        {navGroups.map((group) => {
          const GIcon = group.icon;
          return (
            <div key={group.label}>
              {/* Grup Başlığı */}
              <div className="px-1.5 mb-2">
                <div
                  className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
                  style={{
                    background: `linear-gradient(90deg, ${group.color}12 0%, rgba(255,255,255,0.018) 46%, transparent 100%)`,
                    borderColor: `${group.color}24`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.045), 0 6px 18px ${group.color}08`,
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
                </div>
              </div>

              {/* Menü Öğeleri */}
              <div className="ml-3 space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  const baseBackground = active
                    ? `linear-gradient(135deg, ${group.color}24 0%, rgba(255,255,255,0.04) 50%, ${group.color}0f 100%)`
                    : 'rgba(255,255,255,0.012)';
                  const baseBorder = active ? `${group.color}5c` : 'rgba(255,255,255,0.035)';
                  const baseColor = active ? '#fafaf9' : 'rgba(250,250,249,0.58)';
                  const baseShadow = active
                    ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 22px ${group.color}12`
                    : 'inset 0 1px 0 rgba(255,255,255,0.025)';

                  return (
                    <Link
                      key={href}
                      href={href}
                      className="group relative flex items-center gap-3 px-3 py-[9px] rounded-xl border text-[13px] overflow-hidden"
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
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = `linear-gradient(135deg, ${group.color}20 0%, rgba(255,255,255,0.075) 48%, ${group.color}08 100%)`;
                          el.style.borderColor = `${group.color}55`;
                          el.style.color = '#fffaf2';
                          el.style.transform = 'translateX(6px)';
                          el.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.11), 0 10px 28px ${group.color}18`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = baseBackground;
                          el.style.borderColor = baseBorder;
                          el.style.color = baseColor;
                          el.style.transform = 'translateX(0)';
                          el.style.boxShadow = baseShadow;
                        }
                      }}
                    >
                      <span
                        className="absolute inset-y-1 left-1 w-10 rounded-full opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-70"
                        style={{ background: `${group.color}28` }}
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
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          background: active ? `${group.color}24` : `${group.color}0f`,
                          border: `1px solid ${active ? `${group.color}48` : `${group.color}1f`}`,
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

                      <span className="flex-1 leading-none relative transition-colors duration-200">{label}</span>

                      {/* Bekleyen onay badge — Fatura İşleme menüsünde göster (Onay Kuyruğu oraya entegre) */}
                      {href === '/panel/ajanlar/mihsap' && bekleyenSayisi > 0 && (
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

        {/* === KULLANICI KARTI === */}
        <div className="relative px-1 pt-4 pb-1" style={{ borderTop: '1px solid rgba(212,184,118,0.16)' }}>
          <div
            className="relative overflow-hidden rounded-xl p-3 group transition-all duration-300"
            style={{
              background: 'linear-gradient(135deg, rgba(212,184,118,0.10), rgba(255,255,255,0.025))',
              border: '1px solid rgba(212,184,118,0.16)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
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
          <p
            className="text-center mt-3 text-[9px] uppercase tabular-nums"
            style={{ color: 'rgba(250,250,249,0.22)', letterSpacing: 0 }}
          >
            v0.1.0 · KVKK
          </p>
        </div>
      </nav>
    </aside>
  );
}
