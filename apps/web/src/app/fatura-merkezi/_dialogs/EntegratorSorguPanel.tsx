'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Calendar, Loader2, Search, CheckCircle2, AlertTriangle, ShoppingCart, Receipt, FileText, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Props = {
  taxpayer: any;
  provider: string;
  providerLabel: string;
  onClose: () => void;
};

type Yon = 'ALIS' | 'SATIS' | 'EARSIV' | 'ESMM_SATIS';

const TABS: Array<{ id: Yon; label: string; icon: any; description: string }> = [
  { id: 'ALIS',       label: 'Alış E-Fatura',  icon: ShoppingCart, description: 'Tedarikçilerden gelen e-faturalar' },
  { id: 'SATIS',      label: 'Satış E-Fatura', icon: Receipt,      description: 'Müşterilere kesilen e-faturalar' },
  { id: 'EARSIV',     label: 'E-Arşiv',        icon: FileText,     description: 'Nihai tüketici e-arşiv satışları' },
  { id: 'ESMM_SATIS', label: 'e-ESMM Satış',   icon: FileSpreadsheet, description: 'Serbest meslek makbuzları (e-SMM)' },
];

function ilkGun(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

function sonGun(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10);
}

export default function EntegratorSorguPanel({ taxpayer, provider, providerLabel, onClose }: Props) {
  const [yon, setYon] = useState<Yon>('ALIS');
  const [baslangic, setBaslangic] = useState<string>(ilkGun());
  const [bitis, setBitis] = useState<string>(sonGun());
  const [sonuc, setSonuc] = useState<any>(null);

  const sorguMut = useMutation({
    mutationFn: async () => {
      // Backend direction olarak sadece ALIS|SATIS biliyor.
      // EARSIV ve ESMM_SATIS şimdilik SATIS yönüne map edilir.
      const direction: 'ALIS' | 'SATIS' = yon === 'ALIS' ? 'ALIS' : 'SATIS';
      const donem = baslangic.slice(0, 7); // YYYY-MM
      const res = await api.post('/fatura-muhasebelestirme/integrations/fetch', {
        taxpayerId: taxpayer.id,
        providers: [provider],
        direction,
        donem,
        dateFrom: baslangic,
        dateTo: bitis,
        belgeKategorisi: yon,
        limit: 1000,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setSonuc(data);
      const statuses: any[] = Array.isArray(data?.providers) ? data.providers : (Array.isArray(data?.statuses) ? data.statuses : []);
      const lucaQueued = statuses.find((s) => s?.viaLuca || s?.status === 'QUEUED_VIA_LUCA');
      const created = Number(data?.totals?.created ?? data?.created ?? data?.created?.length ?? 0);
      if (lucaQueued) {
        toast.success('Sorgu Luca\'ya gonderildi. Agent acikken 1-3 dk icinde Yuklenen Faturalar sekmesine duser.');
      } else if (created > 0) {
        toast.success(`${created} belge kuyruga alindi`);
      } else {
        toast.info('Yeni belge bulunamadi (mevcut donem icin zaten cekilmis olabilir).');
      }
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      const msg = data?.message || e?.message || 'Sorgu basarisiz';
      const detail = typeof data === 'object' && data !== null ? JSON.stringify(data, null, 2) : null;
      toast.error(msg);
      setSonuc({ error: msg, detail });
    },
  });

  const activeTab = TABS.find((t) => t.id === yon)!;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { e.stopPropagation(); }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst başlık */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
            title="Geri"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
              {providerLabel} - Fatura Sorgulama
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {taxpayer.companyName || `${taxpayer.firstName ?? ''} ${taxpayer.lastName ?? ''}`.trim()}
              {taxpayer.taxNumber ? ` · VKN: ${taxpayer.taxNumber}` : ''}
            </div>
          </div>
        </div>

        {/* Uyarı banner */}
        <div className="mx-5 mt-4 px-3 py-2.5 rounded-lg flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)' }}>
          <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            Bu ekrandan sadece <strong>{providerLabel}</strong> üzerinden oluşturulan/alınan belgeler çekilir.
            Sorgulanan tarihler arasındaki fatura listesi kuyruğa alınır; sonra "Yüklenen Faturalar" sekmesinde görünür.
          </div>
        </div>

        {/* Tab'lar */}
        <div className="px-5 mt-4 flex gap-1 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = yon === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setYon(t.id); setSonuc(null); }}
                className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold transition-colors"
                style={{
                  background: active ? 'var(--accent-light)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* İçerik */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <div className="text-[11.5px] mb-3" style={{ color: 'var(--text-muted)' }}>
            {activeTab.description}
          </div>

          {/* Tarih aralığı + Sorgula */}
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Başlangıç Tarihi
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  type="date"
                  value={baslangic}
                  onChange={(e) => setBaslangic(e.target.value)}
                  className="bg-transparent outline-none text-[13px]"
                  style={{ color: 'var(--text)' }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Bitiş Tarihi
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  type="date"
                  value={bitis}
                  onChange={(e) => setBitis(e.target.value)}
                  className="bg-transparent outline-none text-[13px]"
                  style={{ color: 'var(--text)' }}
                />
              </div>
            </div>

            <div className="flex-1" />

            <button
              onClick={() => sorguMut.mutate()}
              disabled={sorguMut.isPending || !baslangic || !bitis}
              className="flex items-center gap-1.5 px-5 py-2 text-[13px] font-semibold rounded-lg disabled:opacity-50"
              style={{ background: '#0ea5e9', color: 'white' }}
            >
              {sorguMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Sorgula
            </button>
          </div>

          {/* Sonuç */}
          {sorguMut.isPending && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Loader2 size={28} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--accent)' }} />
              <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {providerLabel}'a bağlanılıyor, {activeTab.label.toLowerCase()} listesi çekiliyor...
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-light)' }}>
                Bu işlem 10-60 saniye sürebilir.
              </div>
            </div>
          )}

          {sonuc && !sorguMut.isPending && !sonuc.error && (() => {
            const statuses: any[] = Array.isArray(sonuc?.providers) ? sonuc.providers : (Array.isArray(sonuc?.statuses) ? sonuc.statuses : []);
            const lucaQueued = statuses.find((s) => s?.viaLuca || s?.status === 'QUEUED_VIA_LUCA');
            if (lucaQueued) {
              return (
                <div className="rounded-xl p-5" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.3)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={18} style={{ color: '#0ea5e9' }} />
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                      Luca'ya yönlendirildi
                    </div>
                  </div>
                  <div className="text-[12.5px] mb-3" style={{ color: 'var(--text-secondary)' }}>
                    {lucaQueued.reason || 'Sorgu Luca Local Agent kuyruğuna alındı.'}
                  </div>
                  <div className="text-[11.5px] mb-3" style={{ color: 'var(--text-muted)' }}>
                    <strong>Job ID:</strong> <span className="font-mono">{lucaQueued.jobId || '-'}</span>
                    {lucaQueued.jobStatus ? <span> · Durum: <strong>{lucaQueued.jobStatus}</strong></span> : null}
                  </div>
                  <div className="text-[11.5px] p-2.5 rounded-md" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#f59e0b' }}>Önemli:</strong> Luca Local Agent bilgisayarında <strong>açık olmalı</strong>. Açık değilse job pending kalır ve çekilmez.
                  </div>
                </div>
              );
            }
            const stat = (key: string) => Number(sonuc?.totals?.[key] ?? sonuc?.[key] ?? 0);
            return (
            <div className="rounded-xl p-5" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.22)' }}>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
                <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
                  Sorgu tamamlandı
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <ResultStat label="Yeni" value={stat('created')} tone="#22c55e" />
                <ResultStat label="Zaten kuyrukta" value={stat('alreadyQueued')} tone="#0ea5e9" />
                <ResultStat label="Atlanan" value={stat('skipped')} tone="#f59e0b" />
                <ResultStat label="Hata" value={stat('failed')} tone="#ef4444" />
              </div>
              {statuses.length > 0 && (
                <div className="mt-4 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  {statuses.map((s: any, i: number) => (
                    <div key={i} className="mt-1">
                      <strong style={{ color: 'var(--text)' }}>{s.label || s.provider}:</strong>{' '}
                      {s.status}
                      {s.reason ? ` — ${s.reason}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })()}

          {sonuc?.error && !sorguMut.isPending && (
            <div className="rounded-xl p-5 text-[13px]" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', color: '#ef4444' }}>
              <strong>Sorgu başarısız:</strong> {sonuc.error}
              {sonuc?.detail && (
                <details className="mt-2" style={{ color: 'var(--text-muted)' }}>
                  <summary className="cursor-pointer text-[11.5px]">Teknik detay</summary>
                  <pre className="text-[11px] mt-1 p-2 rounded overflow-auto" style={{ background: 'var(--surface)', maxHeight: 200 }}>{sonuc.detail}</pre>
                </details>
              )}
            </div>
          )}

          {!sonuc && !sorguMut.isPending && (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
              <FileText size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
              <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {activeTab.label} için tarih aralığını seçerek Sorgula'ya bas.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="text-[18px] font-semibold mt-0.5" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}
