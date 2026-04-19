'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pendingDecisionsApi, PendingDecisionRow } from '@/lib/pending-decisions';
import { AlertTriangle, Check, X, Edit3, Eye, Image as ImageIcon, Clock } from 'lucide-react';

type Durum = 'bekliyor' | 'onaylandi' | 'reddedildi';

export default function OnayKuyruguPage() {
  const qc = useQueryClient();
  const [durum, setDurum] = useState<Durum>('bekliyor');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideKategori, setOverrideKategori] = useState('');
  const [overrideAltKategori, setOverrideAltKategori] = useState('');
  const [notlar, setNotlar] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pending-decisions', durum],
    queryFn: () => pendingDecisionsApi.list({ durum, limit: 200 }),
    refetchInterval: durum === 'bekliyor' ? 5000 : false,
  });

  const { data: detail } = useQuery({
    queryKey: ['pending-decision', selectedId],
    queryFn: () => (selectedId ? pendingDecisionsApi.detail(selectedId) : null),
    enabled: !!selectedId,
  });

  const onaylaMut = useMutation({
    mutationFn: (args: { id: string; override?: { kategori: string; altKategori?: string }; notlar?: string }) =>
      pendingDecisionsApi.onayla(args.id, { override: args.override, notlar: args.notlar }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions'] });
      qc.invalidateQueries({ queryKey: ['pending-count'] });
      closeDetail();
    },
  });

  const reddetMut = useMutation({
    mutationFn: (args: { id: string; notlar?: string }) =>
      pendingDecisionsApi.reddet(args.id, { notlar: args.notlar }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-decisions'] });
      qc.invalidateQueries({ queryKey: ['pending-count'] });
      closeDetail();
    },
  });

  const closeDetail = () => {
    setSelectedId(null);
    setOverrideMode(false);
    setOverrideKategori('');
    setOverrideAltKategori('');
    setNotlar('');
  };

  const counts = useMemo(() => ({
    bekliyor: rows.filter((r) => r.durum === 'bekliyor').length,
    onaylandi: rows.filter((r) => r.durum === 'onaylandi').length,
    reddedildi: rows.filter((r) => r.durum === 'reddedildi').length,
  }), [rows]);

  const getAiKarariOzet = (row: PendingDecisionRow): string => {
    const ai = row.aiKarari || {};
    if (row.kararTipi === 'fatura') {
      return ai.hesapKodu || ai.kategori || '(bos)';
    }
    return [ai.kayitTuru, ai.altTuru].filter(Boolean).join(' → ') || '(bos)';
  };

  const getGecmisOzet = (row: PendingDecisionRow): string => {
    const g = row.gecmisBeklenen || {};
    if (g.enCok) {
      return `${g.enCok}${g.enCokSayisi ? ` (${g.enCokSayisi} kez)` : ''}`;
    }
    return '-';
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">Onay Kuyrugu</h1>
          <p className="text-sm text-stone-500 mt-1">
            AI karari gecmis beklentiyle celisenler — insan onayi bekler.
          </p>
        </div>
        <div className="flex gap-2">
          {(['bekliyor', 'onaylandi', 'reddedildi'] as Durum[]).map((d) => (
            <button
              key={d}
              onClick={() => setDurum(d)}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                durum === d
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              {d === 'bekliyor' && <Clock className="inline w-3.5 h-3.5 mr-1" />}
              {d === 'onaylandi' && <Check className="inline w-3.5 h-3.5 mr-1" />}
              {d === 'reddedildi' && <X className="inline w-3.5 h-3.5 mr-1" />}
              {d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-stone-500 text-sm">Yukleniyor...</div>}

      {!isLoading && rows.length === 0 && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-12 text-center">
          <AlertTriangle className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-500">
            {durum === 'bekliyor' ? 'Bekleyen karar yok — tum AI kararlari otomatik isleniyor.' : 'Kayit yok.'}
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="bg-white border border-stone-200 rounded-lg p-4 hover:border-amber-300 transition cursor-pointer"
            onClick={() => setSelectedId(row.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    row.durum === 'bekliyor' ? 'bg-amber-100 text-amber-900' :
                    row.durum === 'onaylandi' ? 'bg-emerald-50 text-emerald-800' :
                    'bg-rose-50 text-rose-800'
                  }`}>
                    {row.durum}
                  </span>
                  <span className="text-xs text-stone-400 uppercase">{row.kararTipi}</span>
                  <span className="text-sm font-medium text-stone-700 truncate">
                    {row.firmaUnvan || row.firmaKimlikNo || '(firma yok)'}
                  </span>
                  {row.firmaKimlikNo && row.firmaUnvan && (
                    <span className="text-xs text-stone-400 font-mono">{row.firmaKimlikNo}</span>
                  )}
                </div>
                <div className="text-sm text-stone-600 mb-2">
                  <span className="text-stone-500">Mukellef:</span> {row.mukellef || '-'}
                  {row.belgeNo && <> · <span className="text-stone-500">Belge:</span> {row.belgeNo}</>}
                  {row.tutar && <> · <span className="text-stone-500">Tutar:</span> {row.tutar}</>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-amber-50/50 border border-amber-100 rounded p-2">
                    <div className="text-xs text-amber-700 font-medium mb-0.5">AI karari</div>
                    <div className="text-stone-800 font-mono text-xs">{getAiKarariOzet(row)}</div>
                  </div>
                  <div className="bg-stone-50 border border-stone-100 rounded p-2">
                    <div className="text-xs text-stone-600 font-medium mb-0.5">Gecmis beklenen</div>
                    <div className="text-stone-800 font-mono text-xs">{getGecmisOzet(row)}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-stone-500 italic">
                  {row.sapmaSebep}
                </div>
              </div>
              <Eye className="w-4 h-4 text-stone-400 flex-shrink-0 ml-3 mt-1" />
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      {selectedId && detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeDetail}>
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">Bekleyen karar detayi</h2>
                <p className="text-sm text-stone-500 mt-1">{detail.firmaUnvan || detail.firmaKimlikNo}</p>
              </div>
              <button onClick={closeDetail} className="text-stone-400 hover:text-stone-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Bilgi */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-stone-500">Mukellef:</span> <span className="text-stone-800">{detail.mukellef || '-'}</span></div>
                <div><span className="text-stone-500">Firma VKN:</span> <span className="text-stone-800 font-mono">{detail.firmaKimlikNo || '-'}</span></div>
                <div><span className="text-stone-500">Belge No:</span> <span className="text-stone-800">{detail.belgeNo || '-'}</span></div>
                <div><span className="text-stone-500">Belge Turu:</span> <span className="text-stone-800">{detail.belgeTuru || '-'}</span></div>
                <div><span className="text-stone-500">Tarih:</span> <span className="text-stone-800">{detail.faturaTarihi ? new Date(detail.faturaTarihi).toLocaleDateString('tr-TR') : '-'}</span></div>
                <div><span className="text-stone-500">Tutar:</span> <span className="text-stone-800">{detail.tutar || '-'}</span></div>
              </div>

              {/* Gorsel */}
              {detail.imageBase64 && (
                <div className="border border-stone-200 rounded p-2">
                  <div className="text-xs text-stone-500 mb-2 flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" /> Fatura gorseli
                  </div>
                  <img
                    src={`data:image/jpeg;base64,${detail.imageBase64}`}
                    alt="Fatura"
                    className="max-w-full max-h-96 mx-auto"
                  />
                </div>
              )}

              {/* AI karari */}
              <div className="bg-amber-50/50 border border-amber-200 rounded p-3">
                <div className="text-sm font-medium text-amber-900 mb-2">AI'nin onerisi</div>
                <pre className="text-xs text-stone-700 overflow-auto max-h-40">
                  {JSON.stringify(detail.aiKarari, null, 2)}
                </pre>
              </div>

              {/* Gecmis */}
              <div className="bg-stone-50 border border-stone-200 rounded p-3">
                <div className="text-sm font-medium text-stone-700 mb-2">Gecmis beklenen</div>
                <pre className="text-xs text-stone-700 overflow-auto max-h-40">
                  {JSON.stringify(detail.gecmisBeklenen, null, 2)}
                </pre>
              </div>

              <div className="bg-rose-50 border border-rose-100 rounded p-3 text-sm text-rose-900">
                <strong>Sapma sebebi:</strong> {detail.sapmaSebep}
              </div>

              {detail.durum === 'bekliyor' && (
                <>
                  {/* Override alanlari */}
                  {overrideMode && (
                    <div className="border border-stone-200 rounded p-3 bg-stone-50 space-y-2">
                      <div className="text-sm font-medium text-stone-700">Kendi kararini gir</div>
                      <input
                        type="text"
                        placeholder="Kategori (hesap kodu veya kayit turu)"
                        value={overrideKategori}
                        onChange={(e) => setOverrideKategori(e.target.value)}
                        className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm"
                      />
                      {detail.kararTipi === 'isletme' && (
                        <input
                          type="text"
                          placeholder="Alt kategori (opsiyonel)"
                          value={overrideAltKategori}
                          onChange={(e) => setOverrideAltKategori(e.target.value)}
                          className="w-full border border-stone-300 rounded px-3 py-1.5 text-sm"
                        />
                      )}
                    </div>
                  )}

                  <textarea
                    placeholder="Notlar (opsiyonel)"
                    value={notlar}
                    onChange={(e) => setNotlar(e.target.value)}
                    className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
                    rows={2}
                  />

                  {/* Aksiyonlar */}
                  <div className="flex flex-wrap gap-2 justify-end">
                    {!overrideMode ? (
                      <button
                        onClick={() => setOverrideMode(true)}
                        className="px-4 py-2 bg-stone-100 text-stone-700 rounded hover:bg-stone-200 text-sm flex items-center gap-1.5 border border-stone-200"
                      >
                        <Edit3 className="w-4 h-4" /> Kendim Duzelt
                      </button>
                    ) : (
                      <button
                        onClick={() => { setOverrideMode(false); setOverrideKategori(''); setOverrideAltKategori(''); }}
                        className="px-4 py-2 bg-stone-100 text-stone-700 rounded hover:bg-stone-200 text-sm border border-stone-200"
                      >
                        Iptal
                      </button>
                    )}
                    <button
                      disabled={reddetMut.isPending}
                      onClick={() => reddetMut.mutate({ id: detail.id, notlar })}
                      className="px-4 py-2 bg-rose-50 text-rose-700 rounded hover:bg-rose-100 text-sm flex items-center gap-1.5 border border-rose-200"
                    >
                      <X className="w-4 h-4" /> Reddet
                    </button>
                    <button
                      disabled={onaylaMut.isPending || (overrideMode && !overrideKategori.trim())}
                      onClick={() => {
                        const override = overrideMode
                          ? { kategori: overrideKategori.trim(), altKategori: overrideAltKategori.trim() || undefined }
                          : undefined;
                        onaylaMut.mutate({ id: detail.id, override, notlar });
                      }}
                      className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" /> {overrideMode ? 'Kendi Kararinla Onayla' : "AI'yi Onayla"}
                    </button>
                  </div>
                </>
              )}

              {detail.durum !== 'bekliyor' && (
                <div className="bg-stone-50 border border-stone-200 rounded p-3 text-sm text-stone-700">
                  <strong>{detail.durum === 'onaylandi' ? 'Onaylandi' : 'Reddedildi'}</strong>
                  {detail.onayTarihi && <> · {new Date(detail.onayTarihi).toLocaleString('tr-TR')}</>}
                  {detail.sonucKarari && (
                    <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(detail.sonucKarari, null, 2)}</pre>
                  )}
                  {detail.notlar && <div className="mt-2 italic">"{detail.notlar}"</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
