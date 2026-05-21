'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, AlertTriangle, Clock, CheckCircle2, type LucideIcon, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* YÜKLENEN FATURALAR — OCR pipeline durumu */
export default function YuklenenlerPanel({ taxpayerId, period }: { taxpayerId?: string; period: string }) {
  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'yuklenenler', taxpayerId, period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId, period, limit: 500 },
      })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])),
  });

  const docs: any[] = docsQ.data || [];

  const stats = useMemo(() => {
    let pending = 0, success = 0, error = 0;
    for (const d of docs) {
      const o = (d.ocrStatus || '').toUpperCase();
      if (o === 'PENDING' || o === 'IN_PROGRESS') pending++;
      else if (o === 'ERROR' || o === 'FAILED') error++;
      else success++;
    }
    return { pending, success, error };
  }, [docs]);

  const recent = useMemo(() =>
    [...docs]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 40),
    [docs],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end gap-3 mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Yüklenen Faturalar — Pipeline
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            OCR taranma durumları ve son yüklenenler · {docs.length} kayıt
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => docsQ.refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={13} className={docsQ.isFetching ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <PipelineStat label="Taranmayı Bekleyen" value={stats.pending} tone="#f59e0b" icon={Clock} />
        <PipelineStat label="Başarıyla Taranan"  value={stats.success} tone="#10b981" icon={CheckCircle2} />
        <PipelineStat label="Hata Alan"           value={stats.error}   tone="#ef4444" icon={AlertTriangle} />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>MÜKELLEF</th>
              <th className="text-left px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>DOSYA</th>
              <th className="text-left px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>YÜKLENME</th>
              <th className="text-left px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>YÖN</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>TARAMA</th>
            </tr>
          </thead>
          <tbody>
            {docsQ.isLoading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
            )}
            {!docsQ.isLoading && recent.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Bu dönemde yüklenmiş dosya yok.</td></tr>
            )}
            {recent.map((d, idx) => {
              const ocr = (d.ocrStatus || '').toUpperCase();
              return (
                <tr key={d.id} style={{ borderBottom: idx === recent.length - 1 ? 'none' : '1px solid var(--border-soft)' }}>
                  <td className="px-4 py-2 text-[12.5px]" style={{ color: 'var(--text)' }}>{d.taxpayer ? taxpayerName(d.taxpayer) : (d.taxpayerName || '-')}</td>
                  <td className="px-3 py-2 text-[11.5px] font-mono truncate" style={{ color: 'var(--text-muted)', maxWidth: 240 }}>
                    {d.fileName || d.documentNumber || d.id?.slice(0, 8) || '-'}
                  </td>
                  <td className="px-3 py-2 text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
                    {d.createdAt ? new Date(d.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </td>
                  <td className="px-3 py-2 text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{d.direction || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {ocr === 'ERROR' || ocr === 'FAILED' ? (
                      <span className="px-2 py-0.5 rounded-md text-[10.5px] font-medium" style={{ background: '#ef444415', color: '#ef4444' }}>Hata</span>
                    ) : ocr === 'PENDING' || ocr === 'IN_PROGRESS' ? (
                      <span className="px-2 py-0.5 rounded-md text-[10.5px] font-medium" style={{ background: '#f59e0b15', color: '#f59e0b' }}>Bekliyor</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md text-[10.5px] font-medium" style={{ background: '#10b98115', color: '#10b981' }}>✓ Tarandı</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        Son 40 kayıt gösteriliyor. Belgenin <strong>içeriğine</strong> ulaşmak için &quot;Gelen Belgeler&quot; sekmesine geç.
      </div>
    </div>
  );
}

function PipelineStat({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: LucideIcon }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 rounded-lg" style={{ background: `${tone}18`, color: tone }}><Icon size={15} /></div>
        <div className="text-[10px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>{label.toUpperCase()}</div>
      </div>
      <div className="text-[28px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{value}</div>
    </div>
  );
}
