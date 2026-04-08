'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Building2, User, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

export default function MukelleflerPage() {
  const [search, setSearch] = useState('');

  const { data: taxpayers, isLoading } = useQuery({
    queryKey: ['taxpayers', search],
    queryFn: () =>
      api.get('/taxpayers', { params: { search: search || undefined } }).then((r) => r.data),
  });

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Mükellefler"
        subtitle={`${taxpayers?.length ?? 0} kayıtlı mükellef`}
        action={
          <Link href="/panel/mukellefler/yeni" className="btn-primary">
            <Plus size={15} />
            Yeni Mükellef
          </Link>
        }
      />

      {/* Arama */}
      <div className="relative">
        <Search
          size={15}
          className="absolute left-3.5 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ad, soyad veya şirket adı ara..."
          className="input-base pl-10 w-full max-w-md"
        />
      </div>

      {/* Tablo */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : taxpayers?.length === 0 ? (
          <EmptyState
            icon={<User size={28} />}
            title={search ? 'Aramanızla eşleşen mükellef bulunamadı.' : 'Henüz mükellef eklenmedi.'}
            description={!search ? 'İlk mükellefi ekleyerek başlayın.' : undefined}
            action={!search ? { label: '+ Mükellef Ekle', href: '/panel/mukellefler/yeni' } : undefined}
          />
        ) : (
          <table className="w-full">
            <thead style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                {['Mükellef', 'VKN / TCKN', 'Vergi Dairesi', 'Tür', 'Beyanname', 'Evrak', ''].map((h) => (
                  <th
                    key={h}
                    className="text-left text-2xs font-bold uppercase tracking-widest px-4 py-3"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {taxpayers?.map((t: any, i: number) => {
                const name = t.companyName || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim();
                const initial = name[0]?.toUpperCase() ?? '?';
                return (
                  <tr
                    key={t.id}
                    className="group transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'white' : 'var(--bg)',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F0F4FA')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'white' : 'var(--bg)')}
                  >
                    {/* Mükellef */}
                    <td className="px-4 py-3">
                      <Link href={`/panel/mukellefler/${t.id}`} className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                          style={{ background: 'var(--navy)', color: 'var(--gold-light)' }}
                        >
                          {t.type === 'TUZEL_KISI' ? <Building2 size={14} /> : initial}
                        </div>
                        <div>
                          <p className="text-sm font-semibold group-hover:text-[var(--gold)] transition-colors" style={{ color: 'var(--text)' }}>
                            {name}
                          </p>
                          {t.email && (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.email}</p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {t.taxNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {t.taxOffice}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={t.type === 'TUZEL_KISI' ? 'navy' : 'teal'}>
                        {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                      {t._count?.taxDeclarations ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                      {t._count?.documents ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
