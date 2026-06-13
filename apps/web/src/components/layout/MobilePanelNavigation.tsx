'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BellRing,
  BookMarked,
  BookOpenText,
  BotMessageSquare,
  BrainCircuit,
  Building2,
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
  LucideIcon,
  MailSearch,
  Menu,
  Megaphone,
  MessageSquareText,
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
  X,
} from 'lucide-react';

const GROUP_COLORS = {
  ai: '#f09aa8',
  general: '#d4b876',
  invoice: '#8fd7bd',
  tax: '#d8ad70',
  finance: '#8cbde8',
  office: '#d9a06c',
  system: '#9da8b7',
};

type ModuleStatus = 'active' | 'planned';

type ModuleItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  status?: ModuleStatus;
};

type ModuleGroup = {
  label: string;
  color: string;
  icon: LucideIcon;
  items: ModuleItem[];
};

const moduleGroups: ModuleGroup[] = [
  {
    label: 'Moren AI',
    color: GROUP_COLORS.ai,
    icon: BrainCircuit,
    items: [
      { href: '/panel/moren-ai', label: 'MOREN AI', icon: BrainCircuit },
      { href: '/panel/otomasyonlar', label: 'Otomasyonlar', icon: WandSparkles },
    ],
  },
  {
    label: 'Genel',
    color: GROUP_COLORS.general,
    icon: PanelTop,
    items: [
      { href: '/panel', label: 'Gösterge Paneli', icon: Gauge },
      { href: '/panel/mukellef-listesi', label: 'Mükellef Listesi', icon: UserRoundSearch },
      { href: '/panel/mukellefler', label: 'Aylık Takip Listesi', icon: ClipboardCheck },
      { href: '/panel/is-yuku', label: 'İş Akışı', icon: Workflow },
      { href: '/panel/gorevler', label: 'Görevler & Notlar', icon: ClipboardCheck },
      { href: '/panel/bildirimler', label: 'Bildirimler', icon: BellRing },
    ],
  },
  {
    label: 'Fatura & Muhasebe',
    color: GROUP_COLORS.invoice,
    icon: ReceiptText,
    items: [
      { href: '/fatura-merkezi', label: 'Fatura Merkezi', icon: FileStack },
      { href: '/panel/e-arsiv', label: 'E-Fatura / E-Arşiv', icon: FileScan },
      { href: '/panel/ajanlar/mihsap', label: 'Mihsap Fatura İşleme', icon: BotMessageSquare },
      { href: '/panel/faturalar', label: 'İşlenen Faturalar', icon: ReceiptText },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma', icon: Printer },
      { href: '/panel/banka-takip', label: 'Banka Takip', icon: Landmark },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', icon: UserCog },
    ],
  },
  {
    label: 'Vergi & Beyanname',
    color: GROUP_COLORS.tax,
    icon: FileCheck2,
    items: [
      { href: '/panel/kdv-kontrol', label: 'KDV Kontrol', icon: FileCheck2 },
      { href: '/panel/kdv-beyanname', label: 'KDV Beyanname', icon: FileCheck2 },
      { href: '/panel/beyannameler', label: 'Toplu Beyanname', icon: FileText },
      { href: '/panel/ajanlar/tebligat', label: 'e-Tebligat Kontrol', icon: MailSearch, status: 'planned' },
      { href: '/panel/ajanlar/sgk', label: 'SGK Otomasyonu', icon: ShieldAlert, status: 'planned' },
    ],
  },
  {
    label: 'Mali Veriler',
    color: GROUP_COLORS.finance,
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
    color: GROUP_COLORS.office,
    icon: Building2,
    items: [
      { href: '/panel/cari-kasa', label: 'Cari Kasa & Tahsilat', icon: HandCoins },
      { href: '/panel/duyurular', label: 'Duyurular', icon: Megaphone },
      { href: '/panel/galeri/hgs-ihlal', label: 'HGS İhlal Sorgulama', icon: Gavel },
    ],
  },
  {
    label: 'Teknik & Sistem',
    color: GROUP_COLORS.system,
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

const bottomItems: ModuleItem[] = [
  { href: '/panel', label: 'Panel', icon: Gauge },
  { href: '/panel/mukellef-listesi', label: 'Mükellef', icon: UserRoundSearch },
  { href: '/panel/ajanlar/mihsap', label: 'Fatura', icon: ReceiptText },
  { href: '/panel/kdv-kontrol', label: 'KDV', icon: FileCheck2 },
  { href: '/panel/moren-ai', label: 'AI', icon: BrainCircuit },
];

const exactActiveHrefs = new Set(['/panel', '/panel/ajanlar', '/panel/ayarlar', '/panel/mukellefler']);

function isRouteActive(pathname: string, href: string) {
  if (href === '/panel/mukellef-listesi') {
    return pathname === href || pathname.startsWith('/panel/mukellefler/');
  }
  return exactActiveHrefs.has(href) ? pathname === href : pathname.startsWith(href);
}

export default function MobilePanelNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <header
        className="lg:hidden sticky top-0 z-40 flex h-14 items-center justify-between px-4"
        style={{
          background: 'rgba(15,13,11,0.96)',
          borderBottom: '1px solid rgba(212,184,118,0.16)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Modül menüsünü aç"
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ border: '1px solid rgba(212,184,118,0.22)', color: '#d4b876' }}
        >
          <Menu size={19} />
        </button>

        <Link href="/panel" className="flex items-center gap-2" aria-label="Moren panel">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[14px] font-bold"
            style={{ background: 'linear-gradient(135deg, #d4b876, #8b7649)', color: '#0f0d0b', fontFamily: 'Fraunces, serif' }}
          >
            M
          </span>
          <span className="text-[14px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
            Moren Portal
          </span>
        </Link>

        <Link
          href="/panel/bildirimler"
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.76)' }}
          aria-label="Bildirimler"
        >
          <BellRing size={18} />
        </Link>
      </header>

      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2"
        style={{
          background: 'rgba(15,13,11,0.97)',
          borderTop: '1px solid rgba(212,184,118,0.18)',
          backdropFilter: 'blur(14px)',
        }}
        aria-label="Mobil hızlı menü"
      >
        {bottomItems.map((item) => {
          const active = isRouteActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold"
              style={{
                background: active ? 'rgba(212,184,118,0.16)' : 'transparent',
                border: active ? '1px solid rgba(212,184,118,0.28)' : '1px solid transparent',
                color: active ? '#d4b876' : 'rgba(250,250,249,0.52)',
              }}
            >
              <Icon size={17} />
              <span className="leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 h-full w-full"
            aria-label="Menüyü kapat"
            onClick={() => setOpen(false)}
            style={{ background: 'rgba(0,0,0,0.56)' }}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[min(92vw,380px)] flex-col"
            style={{
              background: '#0f0d0b',
              borderRight: '1px solid rgba(212,184,118,0.18)',
              boxShadow: '20px 0 50px rgba(0,0,0,0.42)',
            }}
          >
            <div className="flex h-16 items-center justify-between px-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: '#d4b876' }}>
                  Mevcut Portal
                </p>
                <h2 className="text-[17px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
                  Modüller
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Menüyü kapat"
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
              {moduleGroups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section key={group.label}>
                    <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2" style={{ background: `${group.color}12`, border: `1px solid ${group.color}24` }}>
                      <GroupIcon size={15} style={{ color: group.color }} />
                      <h3 className="text-[11px] font-bold uppercase" style={{ color: group.color, letterSpacing: 0 }}>
                        {group.label}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isRouteActive(pathname, item.href);
                        const planned = item.status === 'planned';
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium"
                            style={{
                              background: active ? `${group.color}18` : 'rgba(255,255,255,0.022)',
                              border: `1px solid ${active ? `${group.color}42` : 'rgba(255,255,255,0.055)'}`,
                              color: active ? '#fafaf9' : 'rgba(250,250,249,0.68)',
                            }}
                          >
                            <span
                              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                              style={{ background: `${group.color}14`, color: group.color }}
                            >
                              <Icon size={15} />
                            </span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {planned && (
                              <span
                                className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase"
                                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.46)' }}
                              >
                                Plan
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
