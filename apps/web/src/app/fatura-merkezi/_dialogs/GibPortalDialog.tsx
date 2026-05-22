'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, FileText, X, Search, Bell, BellOff, Loader2, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   GIB PORTAL DIALOG — Mihsap referansı.
   "Bu ekrandan sadece GİB Portal üzerinden oluşturduğunuz Satış
    faturalarını alabilirsiniz."

   2 sekme: Aktarım (anlık çekim) · Aktarım Arşivi (geçmiş)
   Butonlar: Sorgula · Talimat Ver · GİB'den Güvenli Çıkış
   ════════════════════════════════════════════════════════════════════ */

type Props = { taxpayer: any; onClose: () => void };

const formatYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

export default function GibPortalDialog({ taxpayer, onClose }: Props) {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const [start, setStart] = useState(formatYMD(first));
  const [end, setEnd] = useState(formatYMD(today));
  const [tab, setTab] = useState<'aktarim' | 'arsiv'>('aktarim');
  const [hasTalimat, setHasTalimat] = useState(false);
  const gibPortalAgentReady = false;

  const fetchMut = useMutation({
    mutationFn: async () => {
      if (!gibPortalAgentReady) {
        throw new Error('GIB Portal cekimi henuz aktif degil. Resmi portal API yok; bunun icin ayri tarayici/agent otomasyonu gerekir.');
      }
      return api.post('/agent/gib-portal/fetch-earsiv-sales', {
        taxpayerId: taxpayer.id,
        startDate: start,
        endDate: end,
      });
    },
  });

  const talimatMut = useMutation({
    mutationFn: async () => {
      return api.post('/fatura-muhasebelestirme/integrations/talimat', {
        taxpayerId: taxpayer.id,
        provider: 'GIB_PORTAL',
        active: !hasTalimat,
      });
    },
    onSuccess: () => setHasTalimat((v) => !v),
  });

  const logoutMut = useMutation({
    mutationFn: async () => {
      return api.post('/agent/gib-portal/logout', { taxpayerId: taxpayer.id });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#f9731620', color: '#f97316' }}>
              <FileText size={18} />
            </div>
            <div>
              <div className="text-[15.5px] font-semibold" style={{ color: 'var(--text)' }}>GİB Portal — e-Arşiv Satış</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{taxpayerName(taxpayer)}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Sekmeler */}
        <div className="px-6 pt-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex gap-1">
            {[
              { id: 'aktarim', label: 'Aktarım' },
              { id: 'arsiv',   label: 'Aktarım Arşivi' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as any)}
                className="px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors"
                style={{
                  borderColor: tab === t.id ? 'var(--accent)' : 'transparent',
                  color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {tab === 'aktarim' && (
            <>
              <div className="rounded-lg p-3 mb-4 text-[12px]" style={{ background: '#f9731610', border: '1px solid #f9731640', color: '#fdba74' }}>
                <strong>Uyarı:</strong> Bu ekrandan sadece GİB Portal üzerinden oluşturduğunuz <strong>Satış</strong> faturalarını alabilirsiniz. Mukellefin GİB hesabı (e-imza/mali mühür) gerekiyor.
              </div>

              <div className="rounded-lg p-3 mb-4 text-[12px] flex gap-2" style={{ background: '#ef444412', border: '1px solid #ef444440', color: '#fecaca' }}>
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Bu akış şu an aktif değil.</strong> GİB e-Arşiv Portal için kullanılabilecek resmi bir fatura çekme API'si bağlı değil. Burayı çalıştırmak için ayrı tarayıcı/agent otomasyonu yazılmalı; şifre kaynağı da mükellef kartındaki Vergi Dairesi şifresi olmalı.
                </div>
              </div>

              <div className="flex items-end gap-2 mb-4">
                <div className="flex-1">
                  <label className="block text-[11.5px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Başlangıç</label>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] outline-none rounded-lg"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[11.5px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Bitiş</label>
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] outline-none rounded-lg"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                </div>
                <button
                  onClick={() => fetchMut.mutate()}
                  disabled={fetchMut.isPending || !gibPortalAgentReady}
                  className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                  title={gibPortalAgentReady ? 'GIB Portal sorgusu baslat' : 'GIB Portal agent otomasyonu henuz aktif degil'}
                >
                  {fetchMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {gibPortalAgentReady ? 'Sorgula' : 'Agent hazır değil'}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => talimatMut.mutate()}
                  disabled={talimatMut.isPending || !gibPortalAgentReady}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg"
                  style={{
                    background: hasTalimat ? '#10b98115' : 'transparent',
                    border: '1px solid ' + (hasTalimat ? '#10b98140' : 'var(--border)'),
                    color: hasTalimat ? '#10b981' : 'var(--text-secondary)',
                  }}
                  title="Her gece otomatik çekim için talimat"
                >
                  {hasTalimat ? <Bell size={13} /> : <BellOff size={13} />}
                  {hasTalimat ? 'Talimatı Kaldır' : '+ Talimat Ver'}
                </button>

                <button
                  onClick={() => logoutMut.mutate()}
                  disabled={logoutMut.isPending || !gibPortalAgentReady}
                  className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg"
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: '#fbbf24' }}
                  title="GİB Portal'daki aktif oturumu sonlandır"
                >
                  <LogOut size={13} />
                  GİB'den Güvenli Çıkış
                </button>
              </div>

              {fetchMut.isSuccess && (
                <div className="mt-4 p-3 rounded-lg text-[12px]" style={{ background: '#10b98115', border: '1px solid #10b98140', color: '#86efac' }}>
                  ✓ Sorgu kuyruğa alındı. Agent (Luca Local Agent) GİB'e gidip belgeleri çekecek. Birkaç dakika sonra Gelen Belgeler'e düşer.
                </div>
              )}

              {fetchMut.error && (
                <div className="mt-4 p-3 rounded-lg text-[12px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
                  {(fetchMut.error as any)?.response?.data?.message || 'Sorgu hatası'}
                </div>
              )}
            </>
          )}

          {tab === 'arsiv' && (
            <div className="text-center py-10 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Geçmiş GİB çekim logları (tarih, sonuç, kayıt sayısı) burada listelenecek.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
