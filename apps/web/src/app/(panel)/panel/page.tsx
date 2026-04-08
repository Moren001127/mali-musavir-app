'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Users, FileText, Bell, AlertTriangle, ArrowRight, Building2, User, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

function StatCard({
  title,
  value,
  icon: Icon,
  gradient,
  href,
  sub,
}: {
  title: string;
  value: number | string;
  icon: any;
  gradient: string;
  href?: string;
  sub?: string;
}) {
  const card = (
    <div
      className="relative overflow-hidden rounded-xl p-5 group transition-all duration-200 hover:-translate-y-0.5"
      style={{ background: gradient, boxShadow: '0 4px 20px rgba(10,22,40,.15)' }}
    >
      {/* Dekoratif daire */}
      <div
        className="absolute -top-4 -right-4 w-24 h-24 rounded-full opacity-10"
        style={{ background: 'white' }}
      />
      <div
        className="absolute -bottom-6 -right-2 w-16 h-16 rounded-full opacity-10"
        style={{ background: 'white' }}
      />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,.2)' }}
          >
            <Icon size={20} className="text-white" />
          </div>
          {href && (
            <ArrowRight
              size={15}
              className="text-white opacity-60 group-hover:opacity-100 transition-opacity"
            />
          )}
        </div>
        <p className="text-3xl font-extrabold text-white leading-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {value ?? 0}
        </p>
        <p className="text-sm font-medium text-white/80 mt-1">{title}</p>
        {sub && <p className="text-xs text-white/50 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
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

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Başlık */}
      <div>
        <h1 className="page-title text-2xl">Gösterge Paneli</h1>
        <p className="page-subtitle">Ofis genel durumu — güncel özet</p>
      </div>

      {/* Stat Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Toplam Mükellef"
          value={taxpayers?.length ?? 0}
          icon={Users}
          gradient="linear-gradient(135deg, #0A1628 0%, #253660 100%)"
          href="/panel/mukellefler"
          sub="Aktif kayıtlar"
        />
        <StatCard
          title="Bekleyen Beyanname"
          value={0}
          icon={FileText}
          gradient="linear-gradient(135deg, #C9982A 0%, #A77819 100%)"
          href="/panel/beyannameler"
          sub="Bu ay"
        />
        <StatCard
          title="Okunmamış Bildirim"
          value={unreadCount ?? 0}
          icon={Bell}
          gradient="linear-gradient(135deg, #0D9488 0%, #0A7A70 100%)"
          href="/panel/bildirimler"
        />
        <StatCard
          title="Yaklaşan Son Tarih"
          value={0}
          icon={AlertTriangle}
          gradient="linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)"
        />
      </div>

      {/* Alt Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Beyanname Takvimi */}
        <SectionCard title="Yaklaşan Beyanname Tarihleri">
          <div className="space-y-2">
            {[
              { label: 'KDV Beyannamesi',       date: '25 Nisan', status: 'warning' },
              { label: 'Muhtasar Beyanname',     date: '25 Nisan', status: 'warning' },
              { label: 'Gelir Vergisi',          date: '31 Mart',  status: 'danger'  },
              { label: 'SGK Primi',              date: '15 Nisan', status: 'info'    },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg"
                style={{ background: 'var(--bg)' }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-1.5 h-8 rounded-full"
                    style={{
                      background: item.status === 'danger'  ? 'var(--danger)'  :
                                  item.status === 'warning' ? 'var(--warning)' :
                                  'var(--info)',
                    }}
                  />
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{item.label}</p>
                </div>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {item.date}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Son Mükellefler */}
        <SectionCard
          title="Son Eklenen Mükellefler"
          action={
            <Link
              href="/panel/mukellefler"
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: 'var(--gold)' }}
            >
              Tümü <ArrowRight size={12} />
            </Link>
          }
        >
          {!taxpayers || taxpayers.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Henüz mükellef eklenmedi.</p>
              <Link
                href="/panel/mukellefler/yeni"
                className="text-xs font-semibold mt-2 inline-block"
                style={{ color: 'var(--gold)' }}
              >
                + İlk mükellefi ekle
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {taxpayers.slice(0, 5).map((t: any) => {
                const name = t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
                const initial = name[0]?.toUpperCase() ?? '?';
                return (
                  <Link
                    key={t.id}
                    href={`/panel/mukellefler/${t.id}`}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors hover:bg-[var(--bg)]"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: 'var(--navy-50, #EEF2F7)', color: 'var(--navy)' }}
                    >
                      {t.type === 'TUZEL_KISI' ? <Building2 size={14} /> : initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.taxOffice}</p>
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {new Date(t.createdAt).toLocaleDateString('tr-TR')}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Hızlı Erişim */}
      <div>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          Hızlı Erişim
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Mükellef Ekle',    href: '/panel/mukellefler/yeni', color: 'var(--navy)' },
            { label: 'KDV Kontrolü',     href: '/panel/kdv-kontrol/yeni', color: 'var(--teal)' },
            { label: 'Fiş Yazdırma',     href: '/panel/fis-yazdirma',     color: 'var(--gold)' },
            { label: 'Evrak Yönetimi',   href: '/panel/evraklar',          color: '#7C3AED' },
          ].map(({ label, href, color }) => (
            <Link
              key={href}
              href={href}
              className="card px-4 py-3.5 flex items-center gap-3 hover:-translate-y-0.5 transition-all duration-150"
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</span>
              <ArrowRight size={13} className="ml-auto flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
