'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Users, FileText, Bell, AlertTriangle, ArrowRight, Receipt, FileCheck, Plus,
  Bot, FileInput, Mailbox, Calculator, BookOpen, Printer, User, CheckCircle2, XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

const GOLD = '#d4b876';

/* ═════ KPI KARTI ═════ */
function StatCard({
  title, value, icon: Icon, href, sub, trend, trendKind,
}: {
  title: string;
  value: number | string;
  icon: any;
  href?: string;
  sub?: string;
  trend?: string;
  trendKind?: 'up' | 'down' | 'flat';
}) {
  const card = (
    <div
      className="group relative rounded-2xl p-5 transition-all duration-300 cursor-pointer overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(184,160,111,0.04)';
        el.style.borderColor = 'rgba(184,160,111,0.18)';
        el.style.transform = 'translateY(-3px)';
        el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(255,255,255,0.02)';
        el.style.borderColor = 'rgba(255,255,255,0.05)';
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'none';
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: 'rgba(184,160,111,0.08)',
            border: '1px solid rgba(184,160,111,0.15)',
            color: GOLD,
          }}
        >
          <Icon size={17} />
        </div>
        {trend && (
          <span
            className="text-[10px] font-bold px-2.5 py-[3px] rounded-md tracking-wide"
            style={{
              background:
                trendKind === 'up' ? 'rgba(34,197,94,0.1)' :
                trendKind === 'down' ? 'rgba(244,63,94,0.1)' :
                'rgba(255,255,255,0.04)',
              color:
                trendKind === 'up' ? '#22c55e' :
                trendKind === 'down' ? '#f43f5e' :
                'rgba(250,250,249,0.35)',
            }}
          >
            {trend}
          </span>
        )}
      </div>
      <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>
        {title}
      </p>
      <p
        className="mt-1.5 leading-none tabular-nums"
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: GOLD,
        }}
      >
        {value ?? 0}
      </p>
      {sub && <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{card}</Link> : card;
}

/* ═════ KART BAŞLIĞI ═════ */
function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden transition-colors"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ═════ CANLI AKIŞ ÖĞESİ ═════ */
type FeedKind = 'ok' | 'warn' | 'err' | 'info';
function FeedRow({ time, icon: Icon, title, meta, kind = 'info' }: { time: string; icon: any; title: ReactNode; meta: string; kind?: FeedKind }) {
  const colors: Record<FeedKind, { bg: string; bd: string; c: string }> = {
    ok:   { bg: 'rgba(34,197,94,0.08)',  bd: 'rgba(34,197,94,0.2)',  c: '#22c55e' },
    warn: { bg: 'rgba(245,158,11,0.08)', bd: 'rgba(245,158,11,0.2)', c: '#f59e0b' },
    err:  { bg: 'rgba(244,63,94,0.08)',  bd: 'rgba(244,63,94,0.2)',  c: '#f43f5e' },
    info: { bg: 'rgba(184,160,111,0.08)',bd: 'rgba(184,160,111,0.15)',c: GOLD      },
  };
  const C = colors[kind];
  return (
    <div
      className="flex items-start gap-3 px-5 py-[11px] transition-colors"
      style={{ borderLeft: '2px solid transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(184,160,111,0.04)';
        e.currentTarget.style.borderLeftColor = GOLD;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderLeftColor = 'transparent';
      }}
    >
      <span
        className="min-w-[40px] pt-[3px] tabular-nums"
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'rgba(250,250,249,0.3)' }}
      >
        {time}
      </span>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: C.bg, border: `1px solid ${C.bd}`, color: C.c }}
      >
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] leading-[1.45]" style={{ color: 'rgba(250,250,249,0.85)' }}>
          {title}
        </div>
        <div className="text-[10.5px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.35)' }}>
          {meta}
        </div>
      </div>
    </div>
  );
}

/* ═════ NOT / GÖREV ÖĞESİ ═════ */
function TaskRow({ title, meta, chip, chipKind, done }: { title: string; meta: string; chip: string; chipKind: 'danger' | 'warn' | 'gold' | 'ok'; done?: boolean }) {
  const chipStyles: Record<string, { bg: string; c: string }> = {
    danger: { bg: 'rgba(244,63,94,0.1)', c: '#f43f5e' },
    warn:   { bg: 'rgba(245,158,11,0.1)', c: '#f59e0b' },
    gold:   { bg: 'rgba(184,160,111,0.12)', c: GOLD },
    ok:     { bg: 'rgba(34,197,94,0.1)', c: '#22c55e' },
  };
  const barColor: Record<string, string> = {
    danger: '#f43f5e',
    warn:   '#f59e0b',
    gold:   'rgba(184,160,111,0.5)',
    ok:     '#22c55e',
  };
  const s = chipStyles[chipKind];
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 transition-all"
      style={{ borderLeft: '2px solid transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(184,160,111,0.04)';
        e.currentTarget.style.borderLeftColor = 'rgba(184,160,111,0.4)';
        e.currentTarget.style.paddingLeft = '22px';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderLeftColor = 'transparent';
        e.currentTarget.style.paddingLeft = '20px';
      }}
    >
      <div className="w-[3px] h-7 rounded-sm flex-shrink-0" style={{ background: barColor[chipKind] }} />
      <div className="flex-1 min-w-0">
        <p
          className="text-[13.5px] font-medium truncate"
          style={{ color: '#fafaf9', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}
        >
          {title}
        </p>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.35)' }}>{meta}</p>
      </div>
      <span
        className="text-[10.5px] font-semibold px-2.5 py-[3px] rounded-md flex-shrink-0 tracking-wide"
        style={{ background: s.bg, color: s.c }}
      >
        {chip}
      </span>
    </div>
  );
}

/* ═════ AJAN MİNİ KART ═════ */
function AgentMini({ href, icon: Icon, name, stat, running }: { href: string; icon: any; name: string; stat: string; running: boolean }) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 p-[14px] rounded-2xl transition-all duration-300 overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(184,160,111,0.05)';
        el.style.borderColor = 'rgba(184,160,111,0.22)';
        el.style.transform = 'translateY(-3px) scale(1.01)';
        el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(255,255,255,0.02)';
        el.style.borderColor = 'rgba(255,255,255,0.05)';
        el.style.transform = 'translateY(0) scale(1)';
        el.style.boxShadow = 'none';
      }}
    >
      <div
        className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}
      >
        <Icon size={17} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{name}</div>
        <div className="text-[10.5px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.4)' }}>{stat}</div>
      </div>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: running ? '#22c55e' : 'rgba(255,255,255,0.18)',
          boxShadow: running ? '0 0 8px rgba(34,197,94,0.6)' : 'none',
          animation: running ? 'moren-pulse 2s infinite' : 'none',
        }}
      />
    </Link>
  );
}

export default function DashboardPage() {
  const { data: taxpayers } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });
  const { data: unreadCount } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
  });

  const today = new Date().toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
  }).toUpperCase();

  const feedItems = [
    { time: '14:23', icon: Receipt, kind: 'ok' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Mihsap</strong> · OPET #FAT-284 → Taşıt Akaryakıt</>, meta: 'Gito Gıda · 3.798 TL · AI %98' },
    { time: '14:22', icon: FileInput, kind: 'info' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Luca E-Arşiv</strong> · 12 fatura çekildi, eşleştirildi</>, meta: 'Figen Kabakçı · Nisan 2026' },
    { time: '14:21', icon: AlertTriangle, kind: 'warn' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Atla</strong> · Blok zaten dolu (doğrulandı)</>, meta: 'AYTEMİZ #FAT-282 · 4.050 TL' },
    { time: '14:20', icon: Calculator, kind: 'ok' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>KDV Ön-Hazırlık</strong> · ABC Lojistik ön-hesap</>, meta: 'İndirim: 24.820 TL · Ödenecek: 12.404 TL' },
    { time: '14:18', icon: User, kind: 'info' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Muzaffer Ören</strong> · Mehmet Yıldırım profilini güncelledi</>, meta: 'Telefon · E-posta' },
    { time: '14:15', icon: XCircle, kind: 'err' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Hata</strong> · K.Alt Türü eşleşmez: AI "Diğer"</>, meta: 'EVE MAĞAZACILIK #FAT-270 · 1.200 TL' },
    { time: '14:12', icon: Mailbox, kind: 'info' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Tebligat</strong> · 2 yeni tebligat özetlendi</>, meta: 'İstanbul Vergi D.B. · Kritik: 1' },
    { time: '14:08', icon: Printer, kind: 'ok' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Fiş Yazdırma</strong> · 14 adet fiş tamamlandı</>, meta: 'Selim Koç Market · Nisan 2026' },
    { time: '14:05', icon: BookOpen, kind: 'info' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>E-Defter</strong> · Şubat 2026 kontrol: uyuşmazlık yok</>, meta: 'Demir İnşaat · 148 kayıt' },
    { time: '14:02', icon: Receipt, kind: 'ok' as FeedKind, title: <><strong style={{ color: '#fafaf9', fontWeight: 600 }}>Mihsap</strong> · TURKCELL #FAT-283 → Telefon Gid.</>, meta: 'ABC Lojistik · 450 TL · AI %97' },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Başlık */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              Gösterge
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Ofis Paneli
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            {new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} · Mükellefler · Beyannameler · Ajanlar
          </p>
        </div>
        <Link
          href="/panel/mukellefler/yeni"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 6px 24px rgba(212,184,118,0.35)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <Plus size={14} /> Yeni Mükellef
        </Link>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <StatCard
          title="Toplam Mükellef"
          value={taxpayers?.length ?? 0}
          icon={Users}
          href="/panel/mukellefler"
          sub="Aktif kayıtlar"
          trend="+3 bu ay"
          trendKind="up"
        />
        <StatCard
          title="Bekleyen Beyanname"
          value={12}
          icon={FileText}
          href="/panel/beyannameler"
          sub="Son tarih: 28 Nisan"
          trend="12 gün"
          trendKind="down"
        />
        <StatCard
          title="Ajan İşlemleri (Bugün)"
          value={284}
          icon={Bot}
          href="/panel/ajanlar"
          sub="142 kayıt · 134 atla · 8 hata"
          trend="%94 başarı"
          trendKind="up"
        />
        <StatCard
          title="Okunmamış Bildirim"
          value={unreadCount ?? 5}
          icon={Bell}
          href="/panel/bildirimler"
          sub="2 beyanname · 3 tebligat"
          trend="değişmedi"
          trendKind="flat"
        />
      </div>

      {/* Ajan Durumu */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Ajan Durumu
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <AgentMini href="/panel/ajanlar/mihsap"       icon={Receipt}    name="Mihsap Fatura"     stat="142 işlem · %94"     running />
          <AgentMini href="/panel/ajanlar/luca"         icon={FileInput}  name="Luca E-Arşiv"      stat="891 fatura · %98"    running />
          <AgentMini href="/panel/ajanlar/tebligat"     icon={Mailbox}    name="Tebligat Özet"     stat="23 tebligat · 3 kritik" running={false} />
          <AgentMini href="/panel/ajanlar/kdv-hazirlik" icon={Calculator} name="KDV Ön-Hazırlık"   stat="47 mükellef · 5 uyarı" running />
        </div>
      </div>

      {/* Notlar & Görevler + Canlı Akış */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SectionCard
          title="Notlar & Görevler"
          action={
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.35)' }}>
                {today} · BUGÜN
              </span>
              <button
                className="text-[11px] font-medium px-2.5 py-[5px] rounded-md transition-all"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
              >
                ＋ Ekle
              </button>
            </div>
          }
        >
          <div className="py-1.5">
            <TaskRow title="🔔 Gelir Vergisi son günü" meta="Bugün · Saat 17:00 öncesi" chip="BUGÜN" chipKind="danger" />
            <TaskRow title="ABC Lojistik faturalarını kontrol et" meta="Bugün · Muzaffer Ören" chip="Bugün" chipKind="warn" />
            <TaskRow title="Figen Kabakçı — muhasebe toplantı" meta="Yarın 10:30 · Ofis" chip="Yarın" chipKind="gold" />
            <TaskRow title="KDV Beyannamesi · 47 mükellef" meta="28 Nisan 2026" chip="12 gün" chipKind="warn" />
            <TaskRow title="Muhtasar Beyanname" meta="28 Nisan 2026" chip="12 gün" chipKind="warn" />
            <TaskRow title="SGK Primi ödemesi" meta="15 Nisan 2026" chip="Tamam" chipKind="ok" done />
          </div>
        </SectionCard>

        <SectionCard
          title="Canlı Sistem Akışı"
          action={
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.8)', animation: 'moren-pulse 1.6s infinite' }}
              />
              <span className="text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: '#22c55e' }}>Canlı</span>
            </div>
          }
        >
          <div className="moren-feed-wrap">
            <div className="moren-feed-track">
              {[...feedItems, ...feedItems].map((item, i) => (
                <FeedRow key={i} {...item} />
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Hızlı Erişim */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Hızlı Erişim
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Mükellef Ekle',   href: '/panel/mukellefler/yeni', icon: Plus       },
            { label: 'KDV Kontrolü',    href: '/panel/kdv-kontrol/yeni', icon: CheckCircle2 },
            { label: 'Fiş Yazdırma',    href: '/panel/fis-yazdirma',     icon: Printer    },
            { label: 'Evrak Yönetimi',  href: '/panel/evraklar',         icon: FileText   },
          ].map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(184,160,111,0.05)';
                e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}
              >
                <Icon size={15} />
              </div>
              <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{label}</span>
              <ArrowRight size={14} className="ml-auto transition-all opacity-30 group-hover:opacity-100" style={{ color: GOLD }} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
