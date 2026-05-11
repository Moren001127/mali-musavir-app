'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  vendorMemoryApi,
  VendorMemoryRow,
  VendorMukellefOzet,
  VendorMukellefDetay,
} from '@/lib/vendor-memory';
import { api } from '@/lib/api';
import { Brain, Search, Trash2, X, Users, RefreshCw, Filter } from 'lucide-react';
import { toast } from 'sonner';

export default function FirmaHafizasiPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedVkn, setSelectedVkn] = useState<string | null>(null);
  const [filterMukellef, setFilterMukellef] = useState<string>('');

  // Mükellef listesi (filtre dropdown için)
  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as any[]),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['vendor-memory', search, filterMukellef],
    queryFn: () => vendorMemoryApi.list({
      search: search || undefined,
      limit: 500,
      taxpayerId: filterMukellef || undefined,
    }),
  });

  const taxpayerName = (t: any) =>
    t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';

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

  const backfillMut = useMutation({
    mutationFn: () => vendorMemoryApi.backfillMukellef(),
    onSuccess: (data: any) => {
      toast.success(data?.mesaj || 'Toplu bağlama tamamlandı');
      qc.invalidateQueries({ queryKey: ['vendor-memory'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Backfill hatası');
    },
  });

  const importMihsapMut = useMutation({
    mutationFn: () => vendorMemoryApi.importMihsapEvents(),
    onSuccess: (data: any) => {
      toast.success(data?.mesaj || 'Mihsap geçmişi hafızaya aktarıldı');
      qc.invalidateQueries({ queryKey: ['vendor-memory'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Mihsap hafıza aktarım hatası');
    },
  });

  const renderMukellefOzet = (row: VendorMemoryRow): JSX.Element => {
    const list = row.mukellefler || [];
    if (list.length === 0) return <span className="italic" style={{ color: 'rgba(250,250,249,0.4)' }}>-</span>;
    const count = list.length;
    const isimler = list.slice(0, 3).map((m) => `${m.ad} (${m.onayAdedi})`).join(', ');
    return (
      <div className="flex items-center gap-1.5 group" title={list.map((m) => `${m.ad}: ${m.onayAdedi}`).join('\n')}>
        <Users className="w-3.5 h-3.5" style={{ color: 'rgba(250,250,249,0.45)' }} />
        <span className="text-sm" style={{ color: 'rgba(250,250,249,0.85)' }}>
          {count === 1 ? list[0].ad : `${count} mükellef`}
        </span>
        {count > 1 && (
          <span className="hidden group-hover:inline text-xs truncate max-w-[240px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
            · {isimler}{count > 3 ? '…' : ''}
          </span>
        )}
      </div>
    );
  };

  const renderEnCokKategori = (row: VendorMemoryRow): string => {
    if (!row.decisions || row.decisions.length === 0) return '-';
    const top = [...row.decisions].sort((a, b) => b.onayAdedi - a.onayAdedi)[0];
    const label = top.altKategori ? `${top.kategori} → ${top.altKategori}` : top.kategori;
    return `${label} (${top.onayAdedi})`;
  };

  // v1.36.48: Tüm sayfa dark theme — input/select/tablo hepsi portal teması
  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#fafaf9',
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <Brain className="w-6 h-6" style={{ color: '#d4b876' }} /> Firma Hafızası
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
            AI her mükellefin firma için geçmiş kararlarını ayrı öğrenir. Sapma olursa onay kuyruğuna düşer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => importMihsapMut.mutate()}
            disabled={importMihsapMut.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: '#d4b876', color: '#0c0a09' }}
          >
            <RefreshCw size={14} className={importMihsapMut.isPending ? 'animate-spin' : ''} />
            {importMihsapMut.isPending ? 'Aktarılıyor...' : 'Mihsap Geçmişini Aktar'}
          </button>
        <button
          onClick={() => {
            if (confirm('Tüm "(ortak — mükellef atanmamış)" kayıtları, geçmiş işlem verilerine bakılarak mükelleflere bağlanacak. Devam edilsin mi?')) {
              backfillMut.mutate();
            }
          }}
          disabled={backfillMut.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: '#d4b876', color: '#0c0a09' }}
        >
          <RefreshCw size={14} className={backfillMut.isPending ? 'animate-spin' : ''} />
          {backfillMut.isPending ? 'Bağlanıyor...' : 'Eski kayıtları mükelleflere bağla'}
        </button>
      </div>

      {/* Arama + Mükellef filtresi */}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[300px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            placeholder="VKN veya unvan ile ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md text-sm outline-none focus:border-amber-400"
            style={inputStyle}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <select
            value={filterMukellef}
            onChange={(e) => setFilterMukellef(e.target.value)}
            className="pl-9 pr-8 py-2 rounded-md text-sm outline-none min-w-[260px]"
            style={{ ...inputStyle, colorScheme: 'dark' }}
          >
            <option value="" style={{ background: '#1c1917', color: '#fafaf9' }}>Tüm Mükellefler (ortak dahil)</option>
            {taxpayers.map((t: any) => (
              <option key={t.id} value={t.id} style={{ background: '#1c1917', color: '#fafaf9' }}>{taxpayerName(t)}</option>
            ))}
          </select>
        </div>
        {filterMukellef && (
          <button
            onClick={() => setFilterMukellef('')}
            className="text-xs inline-flex items-center gap-1"
            style={{ color: '#d4b876' }}
          >
            <X size={12} /> Filtreyi Kaldır
          </button>
        )}
      </div>

      {/* Aktif filtre durumu */}
      {filterMukellef && (
        <div
          className="text-xs rounded-md px-3 py-1.5 inline-flex items-center gap-1.5"
          style={{ background: 'rgba(212,184,118,0.08)', border: '1px solid rgba(212,184,118,0.25)', color: '#d4b876' }}
        >
          <Users size={12} />
          <strong>{taxpayerName(taxpayers.find((t: any) => t.id === filterMukellef) || {})}</strong>
          <span style={{ color: 'rgba(250,250,249,0.7)' }}>için kararlar gösteriliyor — diğer mükelleflerin kararları gizlendi.</span>
        </div>
      )}

      {isLoading && <div className="text-sm" style={{ color: 'rgba(250,250,249,0.55)' }}>Yükleniyor...</div>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-lg p-12 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <Brain className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.25)' }} />
          <p style={{ color: 'rgba(250,250,249,0.55)' }}>
            {search ? 'Aramaya uyan firma yok.' : 'Henüz hafızada firma yok. AI fatura işledikçe otomatik oluşur.'}
          </p>
        </div>
      )}

      {/* Tablo */}
      {rows.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <table className="w-full">
            <thead style={{ background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <tr className="text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-4 py-3">Firma</th>
                <th className="px-4 py-3">VKN/TCKN</th>
                <th className="px-4 py-3 text-right">Toplam Onay</th>
                <th className="px-4 py-3">Mükellefler</th>
                <th className="px-4 py-3">En Çok Kategori</th>
                <th className="px-4 py-3">Son Kullanım</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedVkn(row.firmaKimlikNo)}
                  className="cursor-pointer transition"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(212,184,118,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-2.5 text-sm" style={{ color: '#fafaf9' }}>
                    {row.firmaUnvan || <span className="italic" style={{ color: 'rgba(250,250,249,0.4)' }}>(unvan yok)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'rgba(250,250,249,0.6)' }}>{row.firmaKimlikNo}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-medium" style={{ color: '#fafaf9' }}>{row.toplamOnay}</td>
                  <td className="px-4 py-2.5">{renderMukellefOzet(row)}</td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'rgba(250,250,249,0.85)' }}>{renderEnCokKategori(row)}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    {new Date(row.sonKullanim).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${row.firmaUnvan || row.firmaKimlikNo}" hafızası silinecek. Emin misin?`)) {
                          deleteMut.mutate(row.firmaKimlikNo);
                        }
                      }}
                      className="p-1 transition-colors"
                      style={{ color: 'rgba(250,250,249,0.4)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#f43f5e')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(250,250,249,0.4)')}
                      title="Hafızayı temizle"
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

      {/* Detail Modal — mükellef bazlı kategori dağılımı (v1.36.46: dark theme) */}
      {selectedVkn && detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelectedVkn(null)}
        >
          <div
            className="rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
            style={{ background: 'rgb(15,13,11)', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <h2 className="text-xl font-semibold" style={{ color: '#fafaf9' }}>{detail.firmaUnvan || '(unvan yok)'}</h2>
                <p className="text-sm font-mono mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>{detail.firmaKimlikNo}</p>
              </div>
              <button onClick={() => setSelectedVkn(null)} className="hover:opacity-80" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="text-xs uppercase" style={{ color: 'rgba(250,250,249,0.5)' }}>Toplam Onay</div>
                  <div className="text-2xl font-semibold" style={{ color: '#fafaf9' }}>{detail.toplamOnay}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="text-xs uppercase" style={{ color: 'rgba(250,250,249,0.5)' }}>Mükellef Sayısı</div>
                  <div className="text-2xl font-semibold" style={{ color: '#fafaf9' }}>{detail.mukellefler?.length || 0}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="text-xs uppercase" style={{ color: 'rgba(250,250,249,0.5)' }}>Son Kullanım</div>
                  <div className="text-sm font-medium mt-1" style={{ color: 'rgba(250,250,249,0.85)' }}>
                    {new Date(detail.sonKullanim).toLocaleString('tr-TR')}
                  </div>
                </div>
              </div>

              {/* v1.36.46: SIFIRLA / SIL — yanlış öğrenilmiş hafızayı temizle */}
              <div
                className="rounded-lg p-3 flex items-start justify-between gap-4"
                style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)' }}
              >
                <div className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
                  <div className="font-semibold mb-0.5" style={{ color: '#f43f5e' }}>Yanlış öğrenme tespit ettiysen</div>
                  <div style={{ color: 'rgba(250,250,249,0.65)' }}>
                    Bu firma için tüm VendorMemory kayıtları silinir. AI sıfırdan öğrenmeye başlar — bir sonraki faturada onay kuyruğuna düşer ve sen doğru kodla onaylarsın.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `${detail.firmaUnvan || detail.firmaKimlikNo} için tüm hafıza silinecek (${detail.toplamOnay} kayıt). Devam edilsin mi?`,
                      )
                    ) {
                      deleteMut.mutate(detail.firmaKimlikNo, {
                        onSuccess: () => {
                          toast.success('Firma hafızası sıfırlandı');
                        },
                        onError: (e: any) => {
                          toast.error(e?.response?.data?.message || 'Silme başarısız');
                        },
                      });
                    }
                  }}
                  disabled={deleteMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 whitespace-nowrap"
                  style={{ background: '#f43f5e', color: '#fff' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deleteMut.isPending ? 'Siliniyor...' : 'Hafızayı Sıfırla'}
                </button>
              </div>

              {/* Mükellef bazlı kategori dağılımı */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.85)' }}>
                  <Users className="w-4 h-4" style={{ color: '#d4b876' }} />
                  Mükellef Bazlı Kategori Dağılımı
                </h3>
                {detail.mukellefler && detail.mukellefler.length > 0 ? (
                  <div className="space-y-3">
                    {detail.mukellefler.map((m: VendorMukellefDetay, idx) => (
                      <div
                        key={m.taxpayerId || `ortak-${idx}`}
                        className="rounded-lg overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        <div
                          className="px-4 py-2.5 flex items-center justify-between"
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: m.taxpayerId ? 'rgba(212,184,118,0.08)' : 'rgba(255,255,255,0.02)',
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-semibold ${!m.taxpayerId ? 'italic' : ''}`}
                              style={{ color: m.taxpayerId ? '#fafaf9' : 'rgba(250,250,249,0.55)' }}
                            >
                              {m.ad}
                            </span>
                            {!m.taxpayerId && (
                              <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.55)' }}
                              >
                                eski kayıt
                              </span>
                            )}
                          </div>
                          <span className="text-sm font-medium" style={{ color: '#d4b876' }}>
                            {m.toplamOnay} toplam onay
                          </span>
                        </div>
                        <div className="p-2 space-y-1.5">
                          {m.kategoriler.map((k, ki) => (
                            <div
                              key={ki}
                              className="flex items-center justify-between px-2.5 py-1.5 rounded"
                              style={{ background: 'transparent' }}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-[10px] font-semibold uppercase w-14" style={{ color: 'rgba(250,250,249,0.4)' }}>
                                  {k.kararTipi}
                                </span>
                                <span className="text-sm font-mono truncate" style={{ color: '#fafaf9' }}>
                                  {k.altKategori ? `${k.kategori} → ${k.altKategori}` : k.kategori}
                                </span>
                              </div>
                              <div className="text-sm flex items-center gap-3" style={{ color: 'rgba(250,250,249,0.85)' }}>
                                <span className="font-semibold">{k.onayAdedi} kez</span>
                                <span className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
                                  {new Date(k.sonKullanim).toLocaleDateString('tr-TR')}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: 'rgba(250,250,249,0.55)' }}>Henüz kategori kaydı yok.</div>
                )}
              </div>

              <div className="text-xs text-right" style={{ color: 'rgba(250,250,249,0.4)' }}>
                Oluşturma: {new Date(detail.createdAt).toLocaleString('tr-TR')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
