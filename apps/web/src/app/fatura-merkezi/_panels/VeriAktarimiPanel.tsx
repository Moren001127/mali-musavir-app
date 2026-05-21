'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, FileSpreadsheet, BookOpen, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   LUCA'YA AKTARIM — Mihsap referansı.
   Her mukellef için onaylı belgeleri tek tıkla Luca Toplu Aktarım
   Excel'ine dönüştürür ve agent üzerinden Luca'ya gönderir.

   Ek: Hesap planı senkron — tek seferde tüm yeni hesapları Luca'ya gönder.
   ════════════════════════════════════════════════════════════════════ */

type Props = { period: string };

export default function VeriAktarimiPanel({ period }: Props) {
  const qc = useQueryClient();
  const [defterFilter, setDefterFilter] = useState<'all' | 'BILANCO' | 'ISLETME'>('all');

  /* Mukellef + onaylanan sayıları */
  const taxpayersQ = useQuery({
    queryKey: ['fatura-merkezi', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const summaryQ = useQuery({
    queryKey: ['fatura-merkezi', 'per-taxpayer-summary', period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
      .then((r) => Array.isArray(r.data) ? r.data : []),
  });

  const taxpayers: any[] = Array.isArray(taxpayersQ.data) ? taxpayersQ.data : (taxpayersQ.data?.items || []);
  const summaryMap = new Map((summaryQ.data || []).map((s: any) => [s.taxpayerId, s]));

  /* Aktarıma hazır mukellefler */
  const rows = useMemo(() => {
    return taxpayers
      .filter((t) => defterFilter === 'all' || t.defterTuru === defterFilter)
      .map((t) => {
        const s: any = summaryMap.get(t.id) || {};
        const transferable = (s.approvedAlis || 0) + (s.approvedSatis || 0);
        const alreadyPosted = s.postedToLuca || 0;
        return {
          ...t,
          transferable,
          alreadyPosted,
        };
      })
      .filter((r) => r.transferable > 0 || r.alreadyPosted > 0)
      .sort((a, b) => b.transferable - a.transferable);
  }, [taxpayers, summaryMap, defterFilter]);

  const batchMut = useMutation({
    mutationFn: async (taxpayerId: string) => {
      return api.post('/fatura-muhasebelestirme/batch-post-to-luca', {
        taxpayerId,
        period,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const pushAllMut = useMutation({
    mutationFn: async () => {
      const eligible = rows.filter((r) => r.transferable > 0);
      for (const r of eligible) await api.post('/fatura-muhasebelestirme/batch-post-to-luca', { taxpayerId: r.id, period }).catch(() => null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const totalTransferable = rows.reduce((sum, r) => sum + r.transferable, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end gap-3 mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Luca'ya Aktarım
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Dönem {period} · {totalTransferable} onaylı belge aktarıma hazır
          </div>
        </div>

        <div className="flex-1" />

        <select
          value={defterFilter}
          onChange={(e) => setDefterFilter(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-[12.5px] outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <option value="all">Tüm defterler</option>
          <option value="BILANCO">Bilanço</option>
          <option value="ISLETME">İşletme Defteri</option>
        </select>

        <button
          onClick={() => { if (confirm(`${rows.filter((r) => r.transferable > 0).length} mukellef için toplam ${totalTransferable} belge Luca'ya gönderilecek. Devam?`)) pushAllMut.mutate(); }}
          disabled={pushAllMut.isPending || totalTransferable === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold rounded-lg disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {pushAllMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Tümünü Luca'ya Gönder
        </button>
      </div>

      {/* Mukellef başına aktarım tablosu */}
      <div className="rounded-xl overflow-hidden mb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>MÜKELLEF</th>
              <th className="text-left px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>DEFTER</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: '#10b981' }}>BEKLEYEN</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: '#a78bfa' }}>AKTARILDI</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>İŞLEM</th>
            </tr>
          </thead>
          <tbody>
            {summaryQ.isLoading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
            )}
            {!summaryQ.isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Aktarıma hazır mukellef yok. Önce Gelen Belgeler'den onayla.
              </td></tr>
            )}
            {rows.map((r, idx) => (
              <tr key={r.id} style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border-soft)' }}>
                <td className="px-4 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text)' }}>{taxpayerName(r)}</td>
                <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {r.defterTuru === 'BILANCO' ? 'Bilanço' : r.defterTuru === 'ISLETME' ? 'İşletme' : '-'}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {r.transferable > 0 ? (
                    <span className="px-2 py-0.5 rounded-md text-[12.5px] font-semibold tabular-nums" style={{ background: '#10b98115', color: '#10b981' }}>
                      {r.transferable}
                    </span>
                  ) : <span className="text-[12px]" style={{ color: 'var(--text-light)' }}>0</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {r.alreadyPosted > 0 ? (
                    <span className="px-2 py-0.5 rounded-md text-[12.5px] font-semibold tabular-nums" style={{ background: '#a78bfa15', color: '#a78bfa' }}>
                      ✓ {r.alreadyPosted}
                    </span>
                  ) : <span className="text-[12px]" style={{ color: 'var(--text-light)' }}>—</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => batchMut.mutate(r.id)}
                    disabled={r.transferable === 0 || (batchMut.isPending && batchMut.variables === r.id)}
                    className="flex items-center justify-center gap-1.5 ml-auto px-3 py-1.5 text-[12px] font-semibold rounded-md disabled:opacity-40"
                    style={{
                      background: r.transferable > 0 ? 'var(--accent)' : 'transparent',
                      color: r.transferable > 0 ? 'var(--bg)' : 'var(--text-muted)',
                      border: r.transferable === 0 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    {batchMut.isPending && batchMut.variables === r.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Send size={12} />
                    }
                    Luca'ya Aktar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {batchMut.isSuccess && (
        <div className="mb-4 p-3 rounded-lg text-[12px] flex items-center gap-2" style={{ background: '#10b98115', border: '1px solid #10b98140', color: '#86efac' }}>
          <CheckCircle2 size={14} />
          <strong>Kuyruğa alındı.</strong> Excel agent tarafından üretilip Luca'ya yüklenecek. İlerlemeyi Luca tab'ından izleyebilirsin.
        </div>
      )}

      {batchMut.error && (
        <div className="mb-4 p-3 rounded-lg text-[12px] flex items-center gap-2" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
          <AlertCircle size={14} />
          {(batchMut.error as any)?.response?.data?.message || 'Aktarım hatası'}
        </div>
      )}

      {/* Bilgi notu */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet size={15} style={{ color: 'var(--accent)' }} />
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Faturalar nasıl gönderilir?</div>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Her mukellef için onaylanmış faturalar Luca'nın "Toplu Fis Aktarım" Excel formatına dönüştürülür.
            Tek mukellef = tek fiş (sonradan Luca'da fiş böl yapılabilir).
            Agent (Luca Local Agent) Excel'i alıp Luca arayüzüne yükler.
          </p>
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={15} style={{ color: '#a78bfa' }} />
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Hesap planı eşleşmiyor mu?</div>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Faturada eşleşmeyen hesap kodu varsa, Hesap Planı dialog'undan yeni hesap aç →
            "Luca'ya Gönder" butonuyla Luca'da otomatik açılır → sonraki aktarımda eşleşir.
            (Mukellef kartında BookOpen ikonu)
          </p>
        </div>
      </div>
    </div>
  );
}
