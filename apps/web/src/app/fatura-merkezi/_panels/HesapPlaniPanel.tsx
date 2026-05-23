'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, CheckCircle2, AlertCircle, Users, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import HesapPlaniDialog from '../_dialogs/HesapPlaniDialog';
import { taxpayerName, taxpayerTaxNumber } from '../_lib/taxpayer';

export default function HesapPlaniPanel({ taxpayerId }: { taxpayerId?: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const taxpayersQ = useQuery({
    queryKey: ['fatura-merkezi', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const taxpayers: any[] = Array.isArray(taxpayersQ.data) ? taxpayersQ.data : (taxpayersQ.data?.items || []);
  // Hesap plani sadece Bilanco esasi mukelleflerde olur (Isletme defterinde tek duzen hesap plani yok)
  const bilancoTaxpayers = taxpayers.filter((t) =>
    (t?.isActive ?? true) &&
    (t?.defterTuru === 'BILANCO' || t?.mihsapDefterTuru === 'BILANCO') &&
    (!t?.endDate || new Date(t.endDate) >= new Date())
  );
  const selected = taxpayerId ? taxpayers.find((t) => t.id === taxpayerId) : null;
  const selectedIsBilanco = selected && (selected?.defterTuru === 'BILANCO' || selected?.mihsapDefterTuru === 'BILANCO');

  const planQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayerId],
    enabled: !!taxpayerId,
    queryFn: () => api
      .get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 1000 } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data.accounts || r.data.items || [])),
  });

  const bulkRefreshMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-muhasebelestirme/account-plan/refresh-all', {}).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(`Toplu yenileme basladi: ${data?.success || 0}/${data?.total || 0} is kuyruga alindi`);
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Toplu yenileme baslatilamadi');
    },
  });

  const items: any[] = planQ.data || [];
  const total = items.length;
  const synced = items.filter((i: any) => i.syncedToLuca).length;
  const pending = total - synced;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Hesap Plani
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {selected ? `${taxpayerName(selected)} - ${taxpayerTaxNumber(selected) || '-'}` : `Mükellef seç ya da toplu yenile · ${bilancoTaxpayers.length} aktif Bilanço mükellefi`}
          </div>
          {selected && !selectedIsBilanco && (
            <div className="text-[11.5px] mt-1 px-2 py-1 rounded inline-block" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
              Bu mükellef İşletme defteri tutuyor — hesap planı yok.
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {selected && (
            <button onClick={() => setDialogOpen(true)} className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold rounded-lg" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              <BookOpen size={14} /> Hesap Planini Ac
            </button>
          )}
          <button onClick={() => bulkRefreshMut.mutate()} disabled={bulkRefreshMut.isPending || bilancoTaxpayers.length === 0} className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg disabled:opacity-50" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} title={`${bilancoTaxpayers.length} aktif Bilanço mükellefinin hesap planını Luca'dan yenile`}>
            {bulkRefreshMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            {bilancoTaxpayers.length} Bilanço Mükellefini Yenile
          </button>
        </div>
      </div>

      {selected && !selectedIsBilanco ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <AlertCircle size={32} className="mx-auto mb-3" style={{ color: '#f59e0b' }} />
          <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>İşletme defteri mükellefi</h3>
          <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
            Bu mükellef Tek Düzen Hesap Planı kullanmıyor. Hesap planı sadece Bilanço esası mükelleflerde olur.
          </p>
        </div>
      ) : selected ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat label="Toplam Hesap" value={total} icon={BookOpen} tone="var(--accent)" />
            <Stat label="Luca'da Senkron" value={synced} icon={CheckCircle2} tone="#22c55e" />
            <Stat label="Beklemede" value={pending} icon={AlertCircle} tone="#f59e0b" />
          </div>

          {planQ.isLoading ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Loader2 size={28} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--accent)' }} />
              <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Hesap plani yukleniyor...</div>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <BookOpen size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
              <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>Hesap plani bos</h3>
              <p className="text-[12.5px] max-w-lg mx-auto mb-4" style={{ color: 'var(--text-muted)' }}>
                Bu mukellefin Luca'sindan hesap plani henuz cekilmemis. &quot;Hesap Planini Ac&quot; diyaloginda yenileme butonuyla baslat.
              </p>
              <button onClick={() => setDialogOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
                <RefreshCw size={14} /> Yenile
              </button>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Kod</th>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Ad</th>
                      <th className="px-3 py-2 text-center font-semibold" style={{ color: 'var(--text-muted)' }}>Luca</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 500).map((a: any) => (
                      <tr key={a.id || a.accountCode} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2 font-mono" style={{ color: 'var(--text)' }}>{a.accountCode}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{a.accountName}</td>
                        <td className="px-3 py-2 text-center">
                          {a.syncedToLuca ? <CheckCircle2 size={14} style={{ color: '#22c55e', display: 'inline' }} /> : <span className="text-[11px]" style={{ color: '#f59e0b' }}>Bekliyor</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items.length > 500 && (
                <div className="px-3 py-2 text-[11px] text-center" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-light)' }}>
                  Tabloda ilk 500 hesap gosterildi. Detayli gorunum icin &quot;Hesap Planini Ac&quot; diyalogunu kullan.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <BookOpen size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
          <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>Mukellef secin</h3>
          <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
            Ustteki mukellef seciciden bir mukellef secin; o mukellefin hesap plani listelenir.
            Veya tum mukellefler icin &quot;Tumunu Luca'dan Yenile&quot; butonunu kullan.
          </p>
        </div>
      )}

      {dialogOpen && selected && <HesapPlaniDialog taxpayer={selected} onClose={() => setDialogOpen(false)} />}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: string }) {
  return (
    <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 8, background: `${tone}1a`, color: tone }}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className="text-[20px] font-semibold" style={{ color: 'var(--text)' }}>{value}</div>
      </div>
    </div>
  );
}
