'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorMemoryApi, VendorMemoryRow } from '@/lib/vendor-memory';
import { Brain, Search, Trash2, X } from 'lucide-react';

export default function FirmaHafizasiPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedVkn, setSelectedVkn] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['vendor-memory', search],
    queryFn: () => vendorMemoryApi.list({ search: search || undefined, limit: 500 }),
  });

  const { data: detail } = useQuery({
    queryKey: ['vendor-memory-detail', selectedVkn],
    queryFn: () => (selectedVkn ? vendorMemoryApi.detail(selectedVkn) : null),
    enabled: !!selectedVkn,
  });

  const deleteMut = useMutation({
    mutationFn: (vkn: string) => vendorMemoryApi.remove(vkn),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-memory'] });
      setSelectedVkn(null);
    },
  });

  const getEnCokKategori = (row: VendorMemoryRow): string => {
    if (!row.decisions || row.decisions.length === 0) return '-';
    const top = [...row.decisions].sort((a, b) => b.onayAdedi - a.onayAdedi)[0];
    const label = top.altKategori ? `${top.kategori} → ${top.altKategori}` : top.kategori;
    return `${label} (${top.onayAdedi})`;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800 flex items-center gap-2">
            <Brain className="w-6 h-6 text-amber-600" /> Firma Hafizasi
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            AI her firmanin gecmis kararlarini ogrenir. Sapma olursa onay kuyruguna duser.
          </p>
        </div>
      </div>

      {/* Arama */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="VKN veya unvan ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-amber-300"
        />
      </div>

      {isLoading && <div className="text-stone-500 text-sm">Yukleniyor...</div>}

      {!isLoading && rows.length === 0 && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-12 text-center">
          <Brain className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-500">
            {search ? 'Aramaya uyan firma yok.' : 'Henuz hafizada firma yok. AI fatura isledikce otomatik olusur.'}
          </p>
        </div>
      )}

      {/* Tablo */}
      {rows.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr className="text-left text-xs font-medium text-stone-600 uppercase tracking-wider">
                <th className="px-4 py-3">Firma</th>
                <th className="px-4 py-3">VKN/TCKN</th>
                <th className="px-4 py-3 text-right">Toplam Onay</th>
                <th className="px-4 py-3">En Cok Kategori</th>
                <th className="px-4 py-3">Son Kullanim</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedVkn(row.firmaKimlikNo)}
                  className="hover:bg-amber-50/30 cursor-pointer transition"
                >
                  <td className="px-4 py-2.5 text-sm text-stone-800">
                    {row.firmaUnvan || <span className="text-stone-400 italic">(unvan yok)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-stone-600">{row.firmaKimlikNo}</td>
                  <td className="px-4 py-2.5 text-sm text-stone-800 text-right font-medium">{row.toplamOnay}</td>
                  <td className="px-4 py-2.5 text-sm text-stone-700">{getEnCokKategori(row)}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">
                    {new Date(row.sonKullanim).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${row.firmaUnvan || row.firmaKimlikNo}" hafizasi silinecek. Emin misin?`)) {
                          deleteMut.mutate(row.firmaKimlikNo);
                        }
                      }}
                      className="text-stone-400 hover:text-rose-600 p-1"
                      title="Hafizayi temizle"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {selectedVkn && detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedVkn(null)}>
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">{detail.firmaUnvan || '(unvan yok)'}</h2>
                <p className="text-sm text-stone-500 font-mono mt-1">{detail.firmaKimlikNo}</p>
              </div>
              <button onClick={() => setSelectedVkn(null)} className="text-stone-400 hover:text-stone-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-stone-50 rounded p-3">
                  <div className="text-xs text-stone-500 uppercase">Toplam Onay</div>
                  <div className="text-2xl font-semibold text-stone-800">{detail.toplamOnay}</div>
                </div>
                <div className="bg-stone-50 rounded p-3">
                  <div className="text-xs text-stone-500 uppercase">Kategori Sayisi</div>
                  <div className="text-2xl font-semibold text-stone-800">{detail.decisions?.length || 0}</div>
                </div>
                <div className="bg-stone-50 rounded p-3">
                  <div className="text-xs text-stone-500 uppercase">Son Kullanim</div>
                  <div className="text-sm font-medium text-stone-700 mt-1">
                    {new Date(detail.sonKullanim).toLocaleString('tr-TR')}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-stone-700 mb-2">Kategori Dokumu</h3>
                <div className="space-y-2">
                  {detail.decisions && detail.decisions.length > 0 ? (
                    detail.decisions.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between bg-stone-50 border border-stone-100 rounded p-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-stone-400 uppercase mr-2">{d.kararTipi}</span>
                          <span className="text-sm text-stone-800 font-mono">
                            {d.altKategori ? `${d.kategori} → ${d.altKategori}` : d.kategori}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-amber-700">
                          {d.onayAdedi} kez
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-stone-500 text-sm">Henuz kategori kaydi yok.</div>
                  )}
                </div>
              </div>

              <div className="text-xs text-stone-400 text-right">
                Olusturma: {new Date(detail.createdAt).toLocaleString('tr-TR')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
