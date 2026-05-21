'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plug, Plus, RefreshCw, Search, Download, Bell, BellOff } from 'lucide-react';
import { api } from '@/lib/api';

/* ENTEGRATÖR LİSTESİ — Mihsap referansı.
   Bütün mukelleflerin entegratörleri tek tabloda. Filtre + "Talimat Ver".
   Talimat = cron job (her gece otomatik fetch). */
type Props = { taxpayers: Array<any> };

type Row = {
  taxpayerId: string;
  taxpayerName: string;
  taxNumber: string | null;
  provider: string;
  configured: boolean;
  talimat: boolean;
  username: string | null;
};

const PROVIDER_LABEL: Record<string, string> = {
  ELOGO:        'e-Logo',
  UYUMSOFT:     'Uyumsoft',
  PARASUT:      'Paraşüt',
  KOLAYSOFT:    'Kolaysoft',
  GIB_PORTAL:   'GİB Portal',
  LUCA:         'Luca',
  IZIBIZ:       'Izibiz',
  FORIBA:       'Foriba',
  MIKRO:        'Mikro',
  LOGO_ISBASI:  'Logo İşbaşı',
  TURMOB_EFATURA:'TÜRMOB e-Fatura',
};

export default function EntegratorListesiPanel({ taxpayers }: Props) {
  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState<string>('');

  const integrationsQ = useQuery({
    queryKey: ['fatura-merkezi', 'integrations', 'all'],
    queryFn: async () => {
      // Her mukellef için integrations çek — backend bunu tek seferde dönmüyorsa parallel yap
      const all = await Promise.all(
        taxpayers.map((t) =>
          api
            .get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: t.id } })
            .then((r) => ({
              taxpayerId: t.id,
              taxpayerName: t.name,
              taxNumber: t.taxNumber || t.identityNumber || null,
              items: r.data || [],
            }))
            .catch(() => ({
              taxpayerId: t.id,
              taxpayerName: t.name,
              taxNumber: t.taxNumber || t.identityNumber || null,
              items: [],
            })),
        ),
      );
      const rows: Row[] = [];
      all.forEach((entry) => {
        const configured = (entry.items as Array<any>).filter((i) => i.configured);
        configured.forEach((i) => {
          rows.push({
            taxpayerId: entry.taxpayerId,
            taxpayerName: entry.taxpayerName,
            taxNumber: entry.taxNumber,
            provider: i.provider,
            configured: true,
            talimat: i.talimat ?? false,
            username: i.username || null,
          });
        });
      });
      return rows;
    },
    enabled: taxpayers.length > 0,
  });

  const qc = useQueryClient();
  const talimatVer = useMutation({
    mutationFn: async (row: Row) => {
      // backend endpoint'i kuralım — bir sonraki commit'te ekleyeceğiz
      return api.post('/fatura-muhasebelestirme/integrations/talimat', {
        taxpayerId: row.taxpayerId,
        provider: row.provider,
        active: !row.talimat,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'integrations'] });
    },
  });

  const rows = integrationsQ.data || [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterProvider && r.provider !== filterProvider) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.taxpayerName.toLowerCase().includes(q) ||
          (r.taxNumber || '').includes(q) ||
          r.provider.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, filterProvider, search]);

  const withTalimat = rows.filter((r) => r.talimat).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end gap-3 mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Entegratör Listesi
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {rows.length} entegratör · {withTalimat} aktif talimat · {rows.length - withTalimat} talimatsız
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => integrationsQ.refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg transition-colors"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={14} className={integrationsQ.isFetching ? 'animate-spin' : ''} />
          Yenile
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg transition-colors"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <Download size={14} />
          Excel İndir
        </button>
      </div>

      {/* Filtreler */}
      <div className="flex gap-2 mb-4">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            placeholder="Mükellef, VKN veya entegratör adı..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--text)' }}
          />
        </div>
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="px-3 py-2 rounded-lg text-[13px] outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <option value="">Tüm sağlayıcılar</option>
          {Object.keys(PROVIDER_LABEL).map((k) => (
            <option key={k} value={k}>{PROVIDER_LABEL[k]}</option>
          ))}
        </select>
      </div>

      {/* Tablo */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>MÜKELLEF</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>VKN/TCKN</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>ENTEGRATÖR</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>KULLANICI</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>TALİMAT</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>İŞLEMLER</th>
            </tr>
          </thead>
          <tbody>
            {integrationsQ.isLoading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
            )}
            {!integrationsQ.isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Henüz tanımlı entegratör yok.</td></tr>
            )}
            {filtered.map((r, idx) => (
              <tr
                key={`${r.taxpayerId}-${r.provider}-${idx}`}
                style={{ borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border-soft)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <td className="px-4 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text)' }}>{r.taxpayerName}</td>
                <td className="px-3 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>{r.taxNumber}</td>
                <td className="px-3 py-2.5 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    {PROVIDER_LABEL[r.provider] || r.provider}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>{r.username || '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  {r.talimat ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: '#10b981' }}>
                      <Bell size={12} /> Aktif
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      <BellOff size={12} /> Yok
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => talimatVer.mutate(r)}
                    disabled={talimatVer.isPending}
                    className="px-3 py-1 text-[12px] font-medium rounded-md transition-colors"
                    style={{
                      background: r.talimat ? 'transparent' : '#10b981',
                      color: r.talimat ? '#ef4444' : 'white',
                      border: r.talimat ? '1px solid #ef444460' : '1px solid #10b98180',
                    }}
                  >
                    {r.talimat ? 'Talimatı Kaldır' : '+ Talimat Ver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-[11.5px] p-3 rounded-lg" style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--accent)' }}>Talimat nedir?</strong> · Talimat verdiğin entegratörden her gece 00:00'da son 9 günün faturaları otomatik çekilir. Hata olursa müşaviriye mail bildirilir.
      </div>
    </div>
  );
}
