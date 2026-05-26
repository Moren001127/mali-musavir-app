'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  BellRing,
  BookMarked,
  BookOpenText,
  BotMessageSquare,
  BrainCircuit,
  Building2,
  CheckCircle2,
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
  LucideIcon,
  MailSearch,
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
  Smartphone,
  Stethoscope,
  Table2,
  TrendingUp,
  UserCog,
  UserRoundSearch,
  WandSparkles,
  Workflow,
} from 'lucide-react';

const GOLD = '#d4b876';
const ROSE = '#f09aa8';
const SAGE = '#8fd7bd';
const AMBER = '#d8ad70';
const SKY = '#8cbde8';
const COPPER = '#d9a06c';
const STEEL = '#9da8b7';

type ModuleStatus = 'active' | 'planned';
type ModulePriority = 'first' | 'second' | 'system' | 'planned';

type PortalModule = {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  status?: ModuleStatus;
  priority: ModulePriority;
};

type PortalGroup = {
  label: string;
  color: string;
  icon: LucideIcon;
  modules: PortalModule[];
};

const portalGroups: PortalGroup[] = [
  {
    label: 'Moren AI',
    color: ROSE,
    icon: BrainCircuit,
    modules: [
      { href: '/panel/moren-ai', label: 'MOREN AI', desc: 'Sohbet, analiz ve portal içi AI yardımcısı', icon: BrainCircuit, priority: 'first' },
      { href: '/panel/otomasyonlar', label: 'Otomasyonlar', desc: 'Tanımlı otomasyonlar ve çalışma detayları', icon: WandSparkles, priority: 'second' },
    ],
  },
  {
    label: 'Genel',
    color: GOLD,
    icon: PanelTop,
    modules: [
      { href: '/panel', label: 'Gösterge Paneli', desc: 'Günlük özet, kritik uyarılar ve iş akışı', icon: Gauge, priority: 'first' },
      { href: '/panel/mukellefler', label: 'Mükellef Listesi', desc: 'Arama, liste, profil ve hızlı işlemler', icon: UserRoundSearch, priority: 'first' },
      { href: '/panel/is-yuku', label: 'İş Akışı', desc: 'Evrak, fatura, kontrol ve beyanname akışı', icon: Workflow, priority: 'first' },
      { href: '/panel/gorevler', label: 'Görevler & Notlar', desc: 'Ofis görevleri, notlar ve hatırlatmalar', icon: ClipboardCheck, priority: 'first' },
      { href: '/panel/bildirimler', label: 'Bildirimler', desc: 'Okunmamış uyarılar ve sistem mesajları', icon: BellRing, priority: 'first' },
    ],
  },
  {
    label: 'Fatura & Muhasebe',
    color: SAGE,
    icon: ReceiptText,
    modules: [
      { href: '/fatura-merkezi', label: 'Fatura Merkezi', desc: 'Yüklenen belgeler, aktarım ve süreç takibi', icon: FileStack, priority: 'first' },
      { href: '/panel/e-arsiv', label: 'E-Fatura / E-Arşiv', desc: 'Belge sorgulama ve e-arşiv ekranı', icon: FileScan, priority: 'first' },
      { href: '/panel/ajanlar/mihsap', label: 'Fatura İşleme', desc: 'MİHSAP akışı, OCR ve muhasebeleştirme', icon: BotMessageSquare, priority: 'first' },
      { href: '/panel/faturalar', label: 'İşlenen Faturalar', desc: 'İşlenmiş fatura listesi ve durumları', icon: ReceiptText, priority: 'first' },
      { href: '/panel/fis-yazdirma', label: 'Fiş Yazdırma', desc: 'Fiş çıktısı ve belge hazırlama ekranı', icon: Printer, priority: 'second' },
      { href: '/panel/banka-takip', label: 'Banka Takip', desc: 'Hesap hareketleri ve mutabakat takibi', icon: Landmark, priority: 'second' },
      { href: '/panel/ajanlar/profiller', label: 'Mükellef Profilleri', desc: 'MİHSAP ve mükellef bazlı ayarlar', icon: UserCog, priority: 'second' },
    ],
  },
  {
    label: 'Vergi & Beyanname',
    color: AMBER,
    icon: FileCheck2,
    modules: [
      { href: '/panel/kdv-kontrol', label: 'KDV Kontrol', desc: 'Alış, satış, LUCA ve beyan öncesi kontrol', icon: FileCheck2, priority: 'first' },
      { href: '/panel/kdv-beyanname', label: 'KDV Beyanname', desc: 'KDV beyanname hazırlığı ve kayıtları', icon: FileCheck2, priority: 'first' },
      { href: '/panel/beyannameler', label: 'Beyannameler', desc: 'Beyan takip listesi ve durum özetleri', icon: FileText, priority: 'first' },
      { href: '/panel/ajanlar/tebligat', label: 'e-Tebligat Kontrol', desc: 'Route var, aktif işlev sınırlı', icon: MailSearch, status: 'planned', priority: 'planned' },
      { href: '/panel/ajanlar/sgk', label: 'SGK Otomasyonu', desc: 'Route var, aktif işlev sınırlı', icon: ShieldAlert, status: 'planned', priority: 'planned' },
    ],
  },
  {
    label: 'Mali Veriler',
    color: SKY,
    icon: DatabaseZap,
    modules: [
      { href: '/panel/mizan', label: 'Mizan', desc: 'Mizan yükleme, kontrol ve sonuç ekranı', icon: Table2, priority: 'first' },
      { href: '/panel/isletme-hesap-ozeti', label: 'İşletme Hesap Özeti', desc: 'İşletme defteri için dönem özeti', icon: BookOpenText, priority: 'second' },
      { href: '/panel/gelir-tablosu', label: 'Gelir Tablosu', desc: 'Gelir tablosu hazırlama ve analiz ekranı', icon: TrendingUp, priority: 'second' },
      { href: '/panel/bilanco', label: 'Bilanço', desc: 'Bilanço hazırlama ve kontrol ekranı', icon: Scale, priority: 'second' },
      { href: '/panel/ajanlar/e-defter', label: 'E-Defter Kontrol', desc: 'E-defter kontrol ve hata yakalama akışı', icon: BookMarked, priority: 'second' },
    ],
  },
  {
    label: 'Ofis',
    color: COPPER,
    icon: Building2,
    modules: [
      { href: '/panel/cari-kasa', label: 'Cari Kasa & Tahsilat', desc: 'Ofis tahsilatları, kasa ve bakiye takibi', icon: HandCoins, priority: 'second' },
      { href: '/panel/duyurular', label: 'Duyurular', desc: 'Mükellef duyuru hazırlığı ve yayınlama', icon: Megaphone, priority: 'second' },
      { href: '/panel/galeri/hgs-ihlal', label: 'HGS İhlal Sorgulama', desc: 'HGS ihlal sorgulama ve takip ekranı', icon: Gavel, priority: 'second' },
    ],
  },
  {
    label: 'Teknik & Sistem',
    color: STEEL,
    icon: Settings2,
    modules: [
      { href: '/panel/hatirlatmalar', label: 'WhatsApp Otomasyonu', desc: 'Hatırlatma mesajları ve otomasyon akışı', icon: MessageSquareText, priority: 'system' },
      { href: '/panel/ajanlar', label: 'Tüm Ajanlar', desc: 'Ajan modüllerinin genel görünümü', icon: Cpu, priority: 'system' },
      { href: '/panel/ajanlar/luca', label: 'Luca Oturumu', desc: 'LUCA oturum ve bağlantı yönetimi', icon: ShieldCheck, priority: 'system' },
      { href: '/panel/ajan-saglik', label: 'Sağlık Panosu', desc: 'Sistem ve ajan çalışma sağlığı', icon: Stethoscope, priority: 'system' },
      { href: '/panel/ajanlar/loglar', label: 'Yapılan İşlemler', desc: 'Ajan logları ve işlem geçmişi', icon: History, priority: 'system' },
      { href: '/panel/ayarlar', label: 'Ayarlar', desc: 'Genel ayarlar ve sistem tercihleri', icon: Settings2, priority: 'system' },
      { href: '/panel/ayarlar/denetim', label: 'Denetim Günlüğü', desc: 'Audit kayıtları ve işlem izleri', icon: Shield, priority: 'system' },
      { href: '/panel/sistem/kilitli-moduller', label: 'Kilitli Modüller', desc: 'Kilitlenen modüllerin yönetimi', icon: LockKeyhole, priority: 'system' },
    ],
  },
];

const firstWave = portalGroups.flatMap((group) => group.modules.filter((module) => module.priority === 'first'));
const secondWave = portalGroups.flatMap((group) => group.modules.filter((module) => module.priority === 'second'));
const systemWave = portalGroups.flatMap((group) => group.modules.filter((module) => module.priority === 'system'));
const plannedWave = portalGroups.flatMap((group) => group.modules.filter((module) => module.status === 'planned'));

export default function MobilTanitimPage() {
  const [selectedGroup, setSelectedGroup] = useState(portalGroups[1].label);
  const activeGroup = portalGroups.find((group) => group.label === selectedGroup) ?? portalGroups[0];
  const stats = useMemo(() => {
    const allModules = portalGroups.flatMap((group) => group.modules);
    return {
      groups: portalGroups.length,
      active: allModules.filter((module) => module.status !== 'planned').length,
      planned: allModules.filter((module) => module.status === 'planned').length,
      first: firstWave.length,
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-lg p-5 sm:p-6" style={{ background: '#0f0d0b', border: '1px solid rgba(212,184,118,0.18)' }}>
        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
          <div>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD, border: '1px solid rgba(212,184,118,0.28)' }}>
              <Smartphone size={22} />
            </div>
            <p className="mb-2 text-[12px] font-bold uppercase" style={{ color: GOLD, letterSpacing: 0 }}>
              Mobil PWA Önizlemesi
            </p>
            <h1 className="max-w-3xl text-[28px] font-semibold leading-tight sm:text-[36px]" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              Portalın gerçek modülleriyle telefonda kurulabilir kullanım
            </h1>
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.64)' }}>
              Bu ekran artık hayali mobil uygulama modüllerini değil, şu an portalda bulunan gerçek menüleri ve PWA ilk sürüm sırasını gösterir.
              Aktif olmayan alanlar ayrı işaretlenir.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            <StatBox label="Grup" value={stats.groups} color={GOLD} />
            <StatBox label="Aktif modül" value={stats.active} color={SAGE} />
            <StatBox label="İlk mobil dalga" value={stats.first} color={ROSE} />
            <StatBox label="Planlı" value={stats.planned} color={STEEL} />
          </div>
        </div>
      </section>

      <section className="lg:hidden">
        <MobileLivePreview />
      </section>

      <section className="hidden gap-5 lg:grid xl:grid-cols-3">
        <PhoneMockup label="01, Ana ekran" accent={GOLD}>
          <HomePhone />
        </PhoneMockup>
        <PhoneMockup label="02, Modül menüsü" accent={SAGE}>
          <ModulesPhone />
        </PhoneMockup>
        <PhoneMockup label="03, İş akışı" accent={AMBER}>
          <WorkflowPhone />
        </PhoneMockup>
      </section>

      <section className="rounded-lg p-4 sm:p-5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-[22px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              Mevcut Portal Modül Haritası
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: 'rgba(250,250,249,0.56)' }}>
              Tasarım ve mobil menü bu listeye göre üretildi.
            </p>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg p-1" style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {portalGroups.map((group) => {
              const selected = group.label === selectedGroup;
              const Icon = group.icon;
              return (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => setSelectedGroup(group.label)}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold"
                  style={{
                    background: selected ? `${group.color}20` : 'transparent',
                    border: selected ? `1px solid ${group.color}45` : '1px solid transparent',
                    color: selected ? group.color : 'rgba(250,250,249,0.52)',
                  }}
                >
                  <Icon size={14} />
                  {group.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {activeGroup.modules.map((module) => (
            <ModuleCard key={module.href} module={module} color={activeGroup.color} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <RoadmapColumn title="İlk PWA sürümü" color={GOLD} items={firstWave} />
        <RoadmapColumn title="İkinci dalga" color={SKY} items={secondWave} />
        <RoadmapColumn title="Sistem ekranları" color={STEEL} items={systemWave} />
        <RoadmapColumn title="Gizli / planlı" color={AMBER} items={plannedWave} />
      </section>
    </div>
  );
}

function MobileLivePreview() {
  const quickModules = [
    { href: '/panel', label: 'Panel', desc: 'Günlük özet', icon: Gauge, color: GOLD },
    { href: '/panel/mukellefler', label: 'Mükellefler', desc: 'Liste ve profiller', icon: UserRoundSearch, color: GOLD },
    { href: '/panel/ajanlar/mihsap', label: 'Fatura', desc: 'İşleme merkezi', icon: ReceiptText, color: SAGE },
    { href: '/panel/kdv-kontrol', label: 'KDV', desc: 'Kontrol akışı', icon: FileCheck2, color: AMBER },
  ];

  return (
    <div className="space-y-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.028)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg text-[14px] font-bold" style={{ background: 'linear-gradient(135deg, #d4b876, #8b7649)', color: '#0f0d0b', fontFamily: 'Fraunces, serif' }}>
            M
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>Moren Portal PWA</p>
            <p className="text-[12px] leading-tight" style={{ color: 'rgba(250,250,249,0.52)' }}>Telefonda gerçek kullanım düzeni</p>
          </div>
          <BellRing size={18} style={{ color: GOLD }} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {quickModules.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="min-h-[82px] rounded-lg p-3"
                style={{ background: `${item.color}10`, border: `1px solid ${item.color}28` }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <Icon size={18} style={{ color: item.color }} />
                  <ChevronRight size={15} style={{ color: 'rgba(250,250,249,0.42)' }} />
                </div>
                <p className="text-[13px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>{item.label}</p>
                <p className="mt-1 text-[11px] leading-tight" style={{ color: 'rgba(250,250,249,0.48)' }}>{item.desc}</p>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.028)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              İlk PWA modülleri
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.52)' }}>
              Telefonda ilk açılacak aktif ekranlar
            </p>
          </div>
          <span className="rounded-md px-2 py-1 text-[12px] font-bold" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>
            {firstWave.length}
          </span>
        </div>

        <div className="space-y-2">
          {firstWave.map((module) => (
            <MobileModuleRow key={module.href} module={module} />
          ))}
        </div>
      </div>

      <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.028)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <h2 className="text-[18px] font-semibold leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
          Tüm portal grupları
        </h2>
        <div className="mt-3 space-y-2">
          {portalGroups.map((group) => (
            <MobileGroupCard key={group.label} group={group} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileModuleRow({ module }: { module: PortalModule }) {
  const Icon = module.icon;
  const group = portalGroups.find((item) => item.modules.some((candidate) => candidate.href === module.href));
  const color = group?.color ?? GOLD;

  return (
    <Link
      href={module.href}
      className="flex min-h-[58px] items-center gap-3 rounded-lg px-3 py-2"
      style={{ background: `${color}0d`, border: `1px solid ${color}22` }}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}16`, color }}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>{module.label}</span>
        <span className="mt-1 block truncate text-[11px] leading-tight" style={{ color: 'rgba(250,250,249,0.48)' }}>{group?.label}</span>
      </span>
      <ChevronRight size={16} style={{ color }} />
    </Link>
  );
}

function MobileGroupCard({ group }: { group: PortalGroup }) {
  const Icon = group.icon;
  const activeCount = group.modules.filter((module) => module.status !== 'planned').length;
  const plannedCount = group.modules.length - activeCount;

  return (
    <div className="rounded-lg p-3" style={{ background: `${group.color}0c`, border: `1px solid ${group.color}22` }}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: `${group.color}16`, color: group.color }}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>{group.label}</p>
          <p className="mt-1 text-[11px] leading-tight" style={{ color: 'rgba(250,250,249,0.48)' }}>
            {activeCount} aktif modül{plannedCount > 0 ? `, ${plannedCount} planlı` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: `${color}0f`, border: `1px solid ${color}28` }}>
      <p className="text-[11px] font-semibold uppercase" style={{ color: 'rgba(250,250,249,0.52)', letterSpacing: 0 }}>
        {label}
      </p>
      <p className="mt-1 text-[26px] font-bold leading-none" style={{ color, fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
        {value}
      </p>
    </div>
  );
}

function PhoneMockup({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.022)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div
        className="mx-auto"
        style={{
          width: 286,
          maxWidth: '100%',
          height: 586,
          borderRadius: 34,
          padding: 8,
          background: '#0a0907',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: `0 18px 44px rgba(0,0,0,0.34), 0 0 36px ${accent}12`,
        }}
      >
        <div className="relative flex h-full flex-col overflow-hidden" style={{ borderRadius: 26, background: '#0f0d0b' }}>
          <div className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-lg" style={{ background: '#050403' }} />
          <div className="flex items-center justify-between px-5 pb-2 pt-3 text-[10px] font-bold" style={{ color: '#fafaf9' }}>
            <span>09:41</span>
            <span>5G</span>
          </div>
          <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">{children}</div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] font-bold uppercase" style={{ color: accent, letterSpacing: 0 }}>
        {label}
      </p>
    </div>
  );
}

function PhoneHeader({ title, color = GOLD }: { title: string; color?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold" style={{ background: `linear-gradient(135deg, ${color}, #8b7649)`, color: '#0f0d0b', fontFamily: 'Fraunces, serif' }}>
        M
      </span>
      <span className="text-[13px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
        {title}
      </span>
      <span className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.045)', color }}>
        <BellRing size={14} />
      </span>
    </div>
  );
}

function HomePhone() {
  const quickModules = [
    { href: '/panel/mukellefler', label: 'Mükellef', value: '42', icon: UserRoundSearch, color: GOLD },
    { href: '/panel/ajanlar/mihsap', label: 'Fatura', value: '18', icon: ReceiptText, color: SAGE },
    { href: '/panel/kdv-kontrol', label: 'KDV', value: '6', icon: FileCheck2, color: AMBER },
    { href: '/panel/moren-ai', label: 'AI', value: 'Canlı', icon: BrainCircuit, color: ROSE },
  ];

  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="Gösterge Paneli" />
      <h3 className="text-[18px] font-semibold leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
        Bugünkü portal özeti
      </h3>
      <p className="mb-3 mt-1 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
        Kritik işler, mükellefler ve bekleyen kontroller
      </p>

      <div className="grid grid-cols-2 gap-2">
        {quickModules.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="rounded-lg p-2" style={{ background: `${item.color}10`, border: `1px solid ${item.color}28` }}>
              <div className="mb-2 flex items-center justify-between">
                <Icon size={15} style={{ color: item.color }} />
                <ChevronRight size={13} style={{ color: 'rgba(250,250,249,0.42)' }} />
              </div>
              <p className="text-[10px] font-semibold" style={{ color: 'rgba(250,250,249,0.58)' }}>{item.label}</p>
              <p className="mt-1 text-[18px] font-bold leading-none" style={{ color: item.color, fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>{item.value}</p>
            </Link>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mb-2 flex items-center gap-2">
          <Workflow size={14} style={{ color: GOLD }} />
          <p className="text-[11px] font-bold" style={{ color: '#fafaf9' }}>İş Akışı</p>
          <span className="ml-auto text-[10px]" style={{ color: 'rgba(250,250,249,0.42)' }}>Bu ay</span>
        </div>
        {[
          ['Evrak bekliyor', 8, STEEL],
          ['Fatura işleme', 12, SAGE],
          ['KDV kontrol', 6, AMBER],
          ['Beyanname', 4, GOLD],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="mb-2 last:mb-0">
            <div className="mb-1 flex justify-between text-[10px]">
              <span style={{ color: 'rgba(250,250,249,0.58)' }}>{label}</span>
              <span style={{ color: String(color), fontWeight: 700 }}>{value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-lg" style={{ width: `${Number(value) * 6}%`, background: String(color) }} />
            </div>
          </div>
        ))}
      </div>

      <PhoneBottom active="Panel" />
    </div>
  );
}

function ModulesPhone() {
  const menuGroups = portalGroups.slice(0, 5);

  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="Modüller" color={SAGE} />
      <div className="mb-3 flex items-center justify-between rounded-lg p-2" style={{ background: 'rgba(143,215,189,0.08)', border: '1px solid rgba(143,215,189,0.24)' }}>
        <div>
          <p className="text-[11px] font-bold" style={{ color: '#fafaf9' }}>Aktif modüller</p>
          <p className="text-[9.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>Gruplu mobil menü</p>
        </div>
        <span className="text-[18px] font-bold" style={{ color: SAGE, fontFamily: 'Fraunces, serif' }}>34</span>
      </div>

      <div className="space-y-2 overflow-hidden">
        {menuGroups.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.label} className="rounded-lg p-2" style={{ background: `${group.color}0c`, border: `1px solid ${group.color}22` }}>
              <div className="mb-2 flex items-center gap-2">
                <GroupIcon size={13} style={{ color: group.color }} />
                <p className="text-[10px] font-bold uppercase" style={{ color: group.color, letterSpacing: 0 }}>{group.label}</p>
                <span className="ml-auto text-[9px]" style={{ color: 'rgba(250,250,249,0.42)' }}>{group.modules.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.modules.slice(0, 4).map((module) => {
                  const Icon = module.icon;
                  return (
                    <Link key={module.href} href={module.href} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[9.5px] font-semibold" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.68)' }}>
                      <Icon size={11} style={{ color: group.color }} />
                      <span className="truncate">{module.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <PhoneBottom active="Modül" />
    </div>
  );
}

function WorkflowPhone() {
  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="İş Akışı" color={AMBER} />
      <h3 className="text-[17px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
        Mükellef bazlı takip
      </h3>
      <p className="mb-3 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
        Evrak, fatura, KDV ve beyanname hattı
      </p>

      {[
        { title: 'Petravet Veteriner', sub: 'KDV kontrol bekliyor', color: AMBER, icon: FileCheck2, href: '/panel/kdv-kontrol' },
        { title: 'Akgöz Otomotiv', sub: 'Fatura işleme devam ediyor', color: SAGE, icon: ReceiptText, href: '/panel/ajanlar/mihsap' },
        { title: 'Yıldız Tekstil', sub: 'Mizan yüklendi', color: SKY, icon: Table2, href: '/panel/mizan' },
        { title: 'Yeşil Market', sub: 'Görev notu açık', color: GOLD, icon: ClipboardCheck, href: '/panel/gorevler' },
      ].map((row) => {
        const Icon = row.icon;
        return (
          <Link key={row.title} href={row.href} className="mb-2 flex items-center gap-2 rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.032)', border: `1px solid ${row.color}22` }}>
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: `${row.color}12`, color: row.color }}>
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-bold" style={{ color: '#fafaf9' }}>{row.title}</span>
              <span className="block truncate text-[9.5px]" style={{ color: 'rgba(250,250,249,0.46)' }}>{row.sub}</span>
            </span>
            <ChevronRight size={13} style={{ color: row.color }} />
          </Link>
        );
      })}

      <div className="mt-auto rounded-lg p-3" style={{ background: 'rgba(216,173,112,0.09)', border: '1px solid rgba(216,173,112,0.26)' }}>
        <div className="mb-2 flex items-center gap-2">
          <CheckCircle2 size={14} style={{ color: AMBER }} />
          <p className="text-[11px] font-bold" style={{ color: '#fafaf9' }}>Mobil öncelik</p>
        </div>
        <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.58)' }}>
          İlk ekranda işlem yapan modüller, planlı ekranlar menü dışında kalır.
        </p>
      </div>

      <PhoneBottom active="Akış" />
    </div>
  );
}

function PhoneBottom({ active }: { active: string }) {
  const items = [
    { label: 'Panel', icon: Gauge },
    { label: 'Mükellef', icon: UserRoundSearch },
    { label: 'Fatura', icon: ReceiptText },
    { label: 'KDV', icon: FileCheck2 },
    { label: 'AI', icon: BrainCircuit },
  ];

  return (
    <div className="mt-auto grid grid-cols-5 gap-1 rounded-lg p-1" style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {items.map((item) => {
        const selected = active === item.label || (active === 'Modül' && item.label === 'Panel') || (active === 'Akış' && item.label === 'KDV');
        const Icon = item.icon;
        return (
          <div key={item.label} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-lg" style={{ background: selected ? 'rgba(212,184,118,0.14)' : 'transparent', color: selected ? GOLD : 'rgba(250,250,249,0.42)' }}>
            <Icon size={14} />
            <span className="text-[8px] font-semibold leading-none">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ModuleCard({ module, color }: { module: PortalModule; color: string }) {
  const Icon = module.icon;
  const planned = module.status === 'planned';
  const priorityLabel: Record<ModulePriority, string> = {
    first: 'İlk sürüm',
    second: 'İkinci dalga',
    system: 'Sistem',
    planned: 'Planlı',
  };

  return (
    <Link
      href={module.href}
      className="group flex min-h-[116px] items-start gap-3 rounded-lg p-3 transition"
      style={{
        background: planned ? 'rgba(255,255,255,0.018)' : `${color}0d`,
        border: `1px solid ${planned ? 'rgba(255,255,255,0.06)' : `${color}24`}`,
      }}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}14`, color }}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{module.label}</span>
          <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: planned ? 'rgba(255,255,255,0.06)' : `${color}16`, color: planned ? 'rgba(250,250,249,0.42)' : color }}>
            {priorityLabel[module.priority]}
          </span>
        </span>
        <span className="mt-1 block text-[12px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.56)' }}>{module.desc}</span>
      </span>
      <ChevronRight size={16} className="mt-1 flex-shrink-0 opacity-70 transition group-hover:translate-x-0.5" style={{ color }} />
    </Link>
  );
}

function RoadmapColumn({ title, color, items }: { title: string; color: string; items: PortalModule[] }) {
  return (
    <section className="rounded-lg p-4" style={{ background: `${color}0a`, border: `1px solid ${color}22` }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>{title}</h3>
        <span className="rounded-md px-2 py-1 text-[11px] font-bold" style={{ background: `${color}16`, color }}>{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 8).map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="flex items-center gap-2 rounded-lg px-2 py-2" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.045)' }}>
              <Icon size={14} style={{ color }} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: 'rgba(250,250,249,0.72)' }}>{item.label}</span>
            </Link>
          );
        })}
        {items.length > 8 && (
          <p className="px-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.42)' }}>
            +{items.length - 8} modül daha
          </p>
        )}
      </div>
    </section>
  );
}
