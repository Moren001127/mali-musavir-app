'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Users, FileText, Bell, AlertTriangle, ArrowRight, Building2, Receipt, FileCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  sub,
  accent = '#3b82f6',
}: {
  title: string;
  value: number | string;
  icon: any;
  href?: string;
  sub?: string;
  accent?: string;
}) {
  const card = (
    <div
      className="kpi-accent group relative bg-white rounded-xl p-5 transition-all duration-150"
      style={{
        border: '1px solid var(--border)',
        ['--accent-color' as any]: accent,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform duration-150 group-hover:scale-110"
          style={{ background: `${accent}15`, color: accent }}
        >
          <Icon size={17} />
        </div>
        {href && (
          <ArrowRight
            size={14}
            className="opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
            style={{ color: 'var(--text-muted)' }}
          />
        )}
      </div>
      <p className="text-[12px] uppercase font-medium tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {title}
      </p>
      <p className="text-[28px] font-semibold mt-1 leading-none tabular-nums" style={{ color: 'var(--text)', letterSpacing: '-0.025em' }}>
        {value ?? 0}
      </p>
      {sub && <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:shadow-sm transition-shadow rounded-xl">
      {card}
    </Link>
  ) : card;
}

function SectionCard({ title, children, action, accent }: { title: string; children: ReactNode; action?: ReactNode; accent?: string }) {
  return (
    <div
      className="bg-white rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <div className="flex items-center gap-2">
          {accent && (
            <span
              className="w-1 h-4 rounded-full"
              style={{ background: accent }}
            />
          )}
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div>{children}</div>
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
    <div className="space-y-6 max-w-7xl">
      {/* Başlık */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-semibold" style={{ color: 'var(--text)', letterSpacing: '-0.025em' }}>
            Gösterge Paneli
          </h1>
          <p className="text-[14px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Ofis genel durumu — güncel özet
          </p>
        </div>
        <Link href="/panel/mukellefler/yeni" className="btn-primary">
          <Plus size={14} /> Yeni Mükellef
        </Link>
      </div>

      {/* KPI Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Toplam Mükellef"
          value={taxpayers?.length ?? 0}
          icon={Users}
          href="/panel/mukellefler"
          sub="Aktif kayıtlar"
          accent="#3b82f6"
        />
        <StatCard
          title="Bekleyen Beyanname"
          value={0}
          icon={FileText}
          href="/panel/beyannameler"
          sub="Bu ay"
          accent="#f59e0b"
        />
        <StatCard
          title="Okunmamış Bildirim"
          value={unreadCount ?? 0}
          icon={Bell}
          href="/panel/bildirimler"
          accent="#10b981"
        />
        <StatCard
          title="Yaklaşan Son Tarih"
          value={0}
          icon={AlertTriangle}
          accent="#f43f5e"
        />
      </div>

      {/* İki Sütun Bölümü */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Yaklaşan Beyannameler */}
        <SectionCard title="Yaklaşan Beyanname Tarihleri" accent="#f59e0b">
          <div>
            {[
              { label: 'KDV Beyannamesi',   date: '25 Nisan', remain: '11 gün', status: 'warning' },
              { label: 'Muhtasar Beyanname', date: '25 Nisan', remain: '11 gün', status: 'warning' },
              { label: 'Gelir Vergisi',      date: '31 Mart',  remain: 'Geçti',  status: 'danger'  },
              { label: 'SGK Primi',          date: '15 Nisan', remain: '1 gün',  status: 'info'    },
            ].map((item) => (
              <div key={item.label} className="row-item">
                <div
                  className="w-1 h-7 rounded-full flex-shrink-0"
                  style={{
                    background:
                      item.status === 'danger' ? 'var(--danger)' :
                      item.status === 'warning' ? 'var(--warning)' :
                      'var(--info)',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium" style={{ color: 'var(--text)' }}>{item.label}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.date}</p>
                </div>
                <span
                  className={`chip ${
                    item.status === 'danger' ? 'chip-danger' :
                    item.status === 'warning' ? 'chip-warning' :
                    'chip-info'
                  }`}
                >
                  {item.remain}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Son Mükellefler */}
        <SectionCard
          title="Son Eklenen Mükellefler"
          accent="#3b82f6"
          action={
            <Link
              href="/panel/mukellefler"
              className="text-[12.5px] font-medium flex items-center gap-1 hover:gap-1.5 transition-all"
              style={{ color: 'var(--accent)' }}
            >
              Tümü <ArrowRight size={12} />
            </Link>
          }
        >
          {!taxpayers || taxpayers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Users size={20} /></div>
              <p className="text-[13px]">Henüz mükellef eklenmedi.</p>
              <Link
                href="/panel/mukellefler/yeni"
                className="text-[13px] font-medium mt-2 inline-block"
                style={{ color: 'var(--accent)' }}
              >
                + İlk mükellefi ekle
              </Link>
            </div>
          ) : (
            <div>
              {taxpayers.slice(0, 5).map((t: any) => {
                const name = t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
                const initial = name[0]?.toUpperCase() ?? '?';
                return (
                  <Link key={t.id} href={`/panel/mukellefler/${t.id}`} className="row-item">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
                    >
                      {t.type === 'TUZEL_KISI' ? <Building2 size={15} /> : initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-medium truncate" style={{ color: 'var(--text)' }}>{name}</p>
                      <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t.taxOffice}</p>
                    </div>
                    <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--text-light)' }}>
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
        <h3 className="text-[14px] font-semibold mb-3 px-1" style={{ color: 'var(--text)' }}>
          Hızlı Erişim
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Mükellef Ekle',   href: '/panel/mukellefler/yeni', icon: Plus,      accent: '#3b82f6' },
            { label: 'KDV Kontrolü',    href: '/panel/kdv-kontrol/yeni', icon: FileCheck, accent: '#10b981' },
            { label: 'Fiş Yazdırma',    href: '/panel/fis-yazdirma',     icon: Receipt,   accent: '#f59e0b' },
            { label: 'Evrak Yönetimi',  href: '/panel/evraklar',         icon: FileText,  accent: '#8b5cf6' },
          ].map(({ label, href, icon: Icon, accent }) => (
            <Link
              key={href}
              href={href}
              className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3 transition-all duration-150 hover:shadow-sm group"
              style={{ border: '1px solid var(--border)' }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-150 group-hover:scale-110"
                style={{ background: `${accent}15`, color: accent }}
              >
                <Icon size={15} />
              </div>
              <span className="text-[13.5px] font-medium" style={{ color: 'var(--text)' }}>{label}</span>
              <ArrowRight size={13} className="ml-auto opacity-30 group-hover:opacity-80 transition-opacity" style={{ color: 'var(--text-muted)' }} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
