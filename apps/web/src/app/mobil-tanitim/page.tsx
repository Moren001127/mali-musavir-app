import Link from 'next/link';
import {
  BellRing,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  DatabaseZap,
  FileCheck2,
  FileScan,
  FileStack,
  Gauge,
  HandCoins,
  ReceiptText,
  Settings2,
  Smartphone,
  Table2,
  UserRoundSearch,
  Workflow,
} from 'lucide-react';

const GOLD = '#d4b876';
const ROSE = '#f09aa8';
const SAGE = '#8fd7bd';
const AMBER = '#d8ad70';
const SKY = '#8cbde8';
const COPPER = '#d9a06c';
const STEEL = '#9da8b7';

const firstModules = [
  { href: '/panel/moren-ai', label: 'MOREN AI', group: 'Moren AI', icon: BrainCircuit, color: ROSE },
  { href: '/panel', label: 'Gösterge Paneli', group: 'Genel', icon: Gauge, color: GOLD },
  { href: '/panel/mukellefler', label: 'Mükellef Listesi', group: 'Genel', icon: UserRoundSearch, color: GOLD },
  { href: '/panel/is-yuku', label: 'İş Akışı', group: 'Genel', icon: Workflow, color: GOLD },
  { href: '/panel/gorevler', label: 'Görevler & Notlar', group: 'Genel', icon: ClipboardCheck, color: GOLD },
  { href: '/panel/bildirimler', label: 'Bildirimler', group: 'Genel', icon: BellRing, color: GOLD },
  { href: '/fatura-merkezi', label: 'Fatura Merkezi', group: 'Fatura & Muhasebe', icon: FileStack, color: SAGE },
  { href: '/panel/e-arsiv', label: 'E-Fatura / E-Arşiv', group: 'Fatura & Muhasebe', icon: FileScan, color: SAGE },
  { href: '/panel/ajanlar/mihsap', label: 'Fatura İşleme', group: 'Fatura & Muhasebe', icon: ReceiptText, color: SAGE },
  { href: '/panel/faturalar', label: 'İşlenen Faturalar', group: 'Fatura & Muhasebe', icon: ReceiptText, color: SAGE },
  { href: '/panel/kdv-kontrol', label: 'KDV Kontrol', group: 'Vergi & Beyanname', icon: FileCheck2, color: AMBER },
  { href: '/panel/kdv-beyanname', label: 'KDV Beyanname', group: 'Vergi & Beyanname', icon: FileCheck2, color: AMBER },
  { href: '/panel/beyannameler', label: 'Beyannameler', group: 'Vergi & Beyanname', icon: FileCheck2, color: AMBER },
  { href: '/panel/mizan', label: 'Mizan', group: 'Mali Veriler', icon: Table2, color: SKY },
];

const groups = [
  { label: 'Moren AI', count: '2 aktif', icon: BrainCircuit, color: ROSE },
  { label: 'Genel', count: '5 aktif', icon: Gauge, color: GOLD },
  { label: 'Fatura & Muhasebe', count: '7 aktif', icon: ReceiptText, color: SAGE },
  { label: 'Vergi & Beyanname', count: '3 aktif, 2 planlı', icon: FileCheck2, color: AMBER },
  { label: 'Mali Veriler', count: '5 aktif', icon: DatabaseZap, color: SKY },
  { label: 'Ofis', count: '3 aktif', icon: Building2, color: COPPER },
  { label: 'Teknik & Sistem', count: '9 aktif', icon: Settings2, color: STEEL },
];

const quick = [
  { href: '/panel', label: 'Panel', desc: 'Günlük özet', icon: Gauge, color: GOLD },
  { href: '/panel/mukellefler', label: 'Mükellefler', desc: 'Liste ve profiller', icon: UserRoundSearch, color: GOLD },
  { href: '/panel/ajanlar/mihsap', label: 'Fatura', desc: 'İşleme merkezi', icon: ReceiptText, color: SAGE },
  { href: '/panel/kdv-kontrol', label: 'KDV', desc: 'Kontrol akışı', icon: FileCheck2, color: AMBER },
];

export default function MobilTanitimPublicPage() {
  return (
    <main className="mobil-page">
      <style>{`
        .mobil-page {
          min-height: 100vh;
          padding: 14px;
          background: #0a0906;
          color: #fafaf9;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .mobil-page * { box-sizing: border-box; }
        .mobil-shell {
          width: 100%;
          max-width: 920px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .mobil-card {
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          padding: 14px;
        }
        .mobil-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .module-list {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .group-list {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        @media (min-width: 760px) {
          .mobil-page { padding: 24px; }
          .mobil-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .module-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .group-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      <div className="mobil-shell">
        <section className="mobil-card" style={{ borderColor: 'rgba(212,184,118,0.2)', background: '#0f0d0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={logoBox(GOLD)}>
              <Smartphone size={22} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, color: GOLD, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}>
                Mobil PWA Önizlemesi
              </p>
              <h1 style={{ margin: '6px 0 0', color: '#fafaf9', fontSize: 25, lineHeight: 1.14, fontFamily: 'Fraunces, Georgia, serif', letterSpacing: 0 }}>
                Portalın gerçek modülleri
              </h1>
            </div>
          </div>
          <p style={{ margin: '12px 0 0', color: 'rgba(250,250,249,0.64)', fontSize: 14, lineHeight: 1.55 }}>
            Bu görünüm telefonda kurulacak PWA için hazırlandı. Hayali alanlar yok; aktif portal modülleri öne çıkarıldı.
          </p>
        </section>

        <section className="mobil-grid">
          <Stat label="Grup" value="7" color={GOLD} />
          <Stat label="Aktif modül" value="34" color={SAGE} />
          <Stat label="İlk sıra" value="14" color={ROSE} />
          <Stat label="Planlı" value="2" color={STEEL} />
        </section>

        <section className="mobil-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={smallLogo}>M</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={sectionTitle}>Moren Portal</h2>
              <p style={sectionSub}>Telefonda ilk açılacak hızlı işlemler</p>
            </div>
            <BellRing size={18} style={{ color: GOLD }} />
          </div>

          <div className="mobil-grid">
            {quick.map((item) => (
              <QuickCard key={item.href} item={item} />
            ))}
          </div>
        </section>

        <section className="mobil-card">
          <div style={sectionHeader}>
            <div>
              <h2 style={sectionTitle}>İlk PWA modülleri</h2>
              <p style={sectionSub}>Telefonda öncelikli kullanılacak ekranlar</p>
            </div>
            <span style={countBadge(GOLD)}>{firstModules.length}</span>
          </div>
          <div className="module-list">
            {firstModules.map((module) => (
              <ModuleRow key={module.href} module={module} />
            ))}
          </div>
        </section>

        <section className="mobil-card">
          <div style={sectionHeader}>
            <div>
              <h2 style={sectionTitle}>Portal grupları</h2>
              <p style={sectionSub}>Tasarım bu gerçek menü haritasına göre ilerliyor</p>
            </div>
            <CheckCircle2 size={19} style={{ color: SAGE }} />
          </div>
          <div className="group-list">
            {groups.map((group) => (
              <GroupCard key={group.label} group={group} />
            ))}
          </div>
        </section>

        <section className="mobil-card" style={{ borderColor: 'rgba(212,184,118,0.22)' }}>
          <h2 style={sectionTitle}>Kurulum notu</h2>
          <p style={{ margin: '8px 0 0', color: 'rgba(250,250,249,0.62)', fontSize: 13, lineHeight: 1.55 }}>
            Gerçek kurulum için canlı HTTPS adresine deploy gerekir. Lokal Wi-Fi adresi sadece önizleme içindir.
          </p>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="mobil-card" style={{ minHeight: 82, background: `${color}0f`, borderColor: `${color}28` }}>
      <p style={{ margin: 0, color: 'rgba(250,250,249,0.54)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 0', color, fontSize: 25, lineHeight: 1, fontWeight: 800, fontFamily: 'Fraunces, Georgia, serif', letterSpacing: 0 }}>
        {value}
      </p>
    </div>
  );
}

function QuickCard({ item }: { item: (typeof quick)[number] }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} style={cardLink(item.color, 96)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Icon size={19} style={{ color: item.color }} />
        <ChevronRight size={16} style={{ color: 'rgba(250,250,249,0.42)' }} />
      </div>
      <p style={{ margin: '12px 0 0', color: '#fafaf9', fontSize: 14, fontWeight: 750, lineHeight: 1.15 }}>{item.label}</p>
      <p style={{ margin: '5px 0 0', color: 'rgba(250,250,249,0.48)', fontSize: 11.5, lineHeight: 1.2 }}>{item.desc}</p>
    </Link>
  );
}

function ModuleRow({ module }: { module: (typeof firstModules)[number] }) {
  const Icon = module.icon;
  return (
    <Link href={module.href} style={rowLink(module.color)}>
      <span style={logoBox(module.color)}>
        <Icon size={17} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', color: '#fafaf9', fontSize: 13.5, fontWeight: 750, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {module.label}
        </span>
        <span style={{ display: 'block', marginTop: 4, color: 'rgba(250,250,249,0.48)', fontSize: 11, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {module.group}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: module.color, flexShrink: 0 }} />
    </Link>
  );
}

function GroupCard({ group }: { group: (typeof groups)[number] }) {
  const Icon = group.icon;
  return (
    <div style={rowBox(group.color)}>
      <span style={logoBox(group.color)}>
        <Icon size={17} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', color: '#fafaf9', fontSize: 13.5, fontWeight: 750, lineHeight: 1.2 }}>{group.label}</span>
        <span style={{ display: 'block', marginTop: 4, color: 'rgba(250,250,249,0.48)', fontSize: 11, lineHeight: 1.2 }}>{group.count}</span>
      </span>
    </div>
  );
}

const sectionTitle = {
  margin: 0,
  color: '#fafaf9',
  fontSize: 18,
  lineHeight: 1.16,
  fontWeight: 700,
  fontFamily: 'Fraunces, Georgia, serif',
  letterSpacing: 0,
};

const sectionSub = {
  margin: '5px 0 0',
  color: 'rgba(250,250,249,0.52)',
  fontSize: 12,
  lineHeight: 1.35,
};

const sectionHeader = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12,
};

const smallLogo = {
  display: 'flex',
  width: 36,
  height: 36,
  borderRadius: 10,
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #d4b876, #8b7649)',
  color: '#0f0d0b',
  fontSize: 15,
  fontWeight: 800,
  fontFamily: 'Fraunces, Georgia, serif',
  flexShrink: 0,
};

function logoBox(color: string) {
  return {
    display: 'flex',
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    background: `${color}16`,
    border: `1px solid ${color}32`,
    color,
    flexShrink: 0,
  };
}

function countBadge(color: string) {
  return {
    borderRadius: 8,
    padding: '5px 8px',
    background: `${color}18`,
    color,
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 800,
    flexShrink: 0,
  };
}

function cardLink(color: string, minHeight: number) {
  return {
    display: 'block',
    minHeight,
    padding: 12,
    borderRadius: 12,
    background: `${color}0f`,
    border: `1px solid ${color}28`,
    textDecoration: 'none',
  };
}

function rowLink(color: string) {
  return {
    ...rowBox(color),
    textDecoration: 'none',
  };
}

function rowBox(color: string) {
  return {
    display: 'flex',
    minHeight: 62,
    alignItems: 'center',
    gap: 11,
    padding: '9px 10px',
    borderRadius: 12,
    background: `${color}0d`,
    border: `1px solid ${color}22`,
  };
}
