'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import Link from 'next/link';
import { Plus, FileSpreadsheet, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';

const STATUS_MAP: Record<string, { label: string; variant: any }> = {
  DRAFT:      { label: 'Taslak',      variant: 'default'  },
  PROCESSING: { label: 'İşleniyor',   variant: 'info'     },
  REVIEWING:  { label: 'İnceleniyor', variant: 'warning'  },
  COMPLETED:  { label: 'Tamamlandı',  variant: 'success'  },
};

const TYPE_MAP: Record<string, { label: string; variant: any }> = {
  KDV_191:       { label: '191 — İndirilecek KDV',  variant: 'info'    },
  KDV_391:       { label: '391 — Hesaplanan KDV',   variant: 'teal'    },
  ISLETME_GELIR: { label: 'İşletme — Gelir',        variant: 'purple'  },
  ISLETME_GIDER: { label: 'İşletme — Gider',        variant: 'orange'  },
  ALIS:          { label: '191 — İndirilecek KDV',  variant: 'info'    },
  SATIS:         { label: '391 — Hesaplanan KDV',   variant: 'teal'    },
};

export default function KdvKontrolPage() {
  const qc = useQueryClient();
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['kdv-sessions'],
    queryFn: kdvApi.getSessions,
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => kdvApi.deleteSession(id),
    onSuccess: () => {
      toast.success('Kontrol oturumu silindi');
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="KDV Kontrol Sistemi"
        subtitle="Luca Excel + Mihsap görsel — otomatik eşleştirme ve uyumsuzluk tespiti"
        action={
          <Link href="/panel/kdv-kontrol/yeni" className="btn-primary">
            <Plus size={15} />
            Yeni Kontrol
          </Link>
        }
      />

      {/* Bilgi kutusu */}
      <div
        className="rounded-xl p-4 text-sm"
        style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #E0F2FE 100%)', border: '1px solid #C7D7F0' }}
      >
        <p className="font-bold mb-2" style={{ color: 'var(--navy)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          Nasıl Çalışır?
        </p>
        <ol className="list-decimal pl-5 space-y-1" style={{ color: 'var(--navy-500)' }}>
          <li>Luca'dan <strong>191</strong> veya <strong>391</strong> KDV muavin defterini Excel olarak dışa aktarın</li>
          <li>Mihsap'tan fatura/fiş/Z raporu <strong>JPEG görsellerini</strong> indirin veya manuel yükleyin</li>
          <li>Sisteme yükleyin — tarih, belge no, KDV bilgileri otomatik okunur</li>
          <li>Eşleştirmeyi başlatın — uyumsuzluklar ve teyit gereken belgeler için bildirim alırsınız</li>
        </ol>
      </div>

      {/* Tablo */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
          </div>
        ) : sessions?.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet size={28} />}
            title="Henüz kontrol oturumu başlatılmadı."
            description="İlk KDV kontrolünü başlatın."
            action={{ label: '+ Yeni Kontrol', href: '/panel/kdv-kontrol/yeni' }}
          />
        ) : (
          <table className="w-full">
            <thead style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                {['Dönem', 'Mükellef', 'Tür', 'Excel', 'Görsel', 'Durum', 'Tarih', ''].map((h) => (
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
              {sessions?.map((s: any, i: number) => {
                const st = STATUS_MAP[s.status] ?? STATUS_MAP.DRAFT;
                const tp = TYPE_MAP[s.type] ?? TYPE_MAP.KDV_191;
                const taxpayerName = s.taxpayer
                  ? s.taxpayer.companyName || `${s.taxpayer.firstName ?? ''} ${s.taxpayer.lastName ?? ''}`.trim()
                  : null;
                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'white' : 'var(--bg)',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F0F4FA')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'white' : 'var(--bg)')}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/panel/kdv-kontrol/${s.id}`}
                        className="text-sm font-bold hover:underline"
                        style={{ color: 'var(--navy)' }}
                      >
                        {s.periodLabel}
                      </Link>
                      {s.notes && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {taxpayerName ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={tp.variant}>{tp.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {s._count?.kdvRecords ?? 0} satır
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {s._count?.images ?? 0} görsel
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={st.variant} dot>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(s.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          if (confirm('Bu kontrol oturumunu silmek istediğinize emin misiniz?')) {
                            deleteSession.mutate(s.id);
                          }
                        }}
                        disabled={deleteSession.isPending}
                        className="p-2 hover:bg-red-100 text-red-500 rounded-lg transition-colors"
                        title="Sil"
                      >
                        <Trash2 size={16} />
                      </button>
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
