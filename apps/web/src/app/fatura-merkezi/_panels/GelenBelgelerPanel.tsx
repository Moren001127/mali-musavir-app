'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, Inbox, ArrowUpDown, Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName, taxpayerBookType, taxpayerSearchMatch } from '../_lib/taxpayer';
import FaturaDetayDrawer from '../_dialogs/FaturaDetayDrawer';

type Props = { taxpayerId?: string; period: string };

/* GELEN BELGELER — Per-mukellef özet tablosu
   Mihsap referansı: Firma · Defter · Bekleyen Alış · Bekleyen Satış · Bekleyen Banka · Onaylanan Alış · Onaylanan Satış · Onaylanan Banka */
export default function GelenBelgelerPanel({ taxpayerId, period }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'pending' | 'approved'>('pending');
  const [selectedDoc, setSelectedDoc] = useState<{ taxpayerId: string; direction: 'ALIS' | 'SATIS' } | null>(null);

  /* e-Arşiv ALIŞ kayıtlarını gelen belgeye çevir (toplu)
     — sadece tip=ALIS + belgeKaynak=EARSIV. Satış ve e-fatura akışları ayrı butonlarla. */
  const earsivBackfillMut = useMutation({
    mutationFn: async () => {
      return api.post('/fatura-muhasebelestirme/documents/backfill-earsiv', {
        taxpayerId: taxpayerId || undefined,
        donem: period,
        tip: 'ALIS',
        belgeKaynak: 'EARSIV',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    },
  });

  /* Inbox özeti — orphan / invalid sayıları için (perTaxpayerSummary ile karışmasın) */
  const inboxSummaryQ = useQuery({
    queryKey: ['fatura-merkezi', 'summary', period],
    queryFn: () => api.get('/fatura-muhasebelestirme/summary', { params: { period } }).then((r) => r.data).catch(() => ({})),
  });

  /* Orphan belgeleri VKN/TC ile mevcut mukelleflere eşleştir */
  const matchOrphansMut = useMutation({
    mutationFn: async () => api.post('/fatura-muhasebelestirme/documents/match-orphans', { period }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    },
  });

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

  /* ─── Filtre + birleştir ─── */
  const rows = useMemo(() => {
    const merged = taxpayers
      .filter((t) => !taxpayerId || t.id === taxpayerId)
      .filter((t) => !search || taxpayerSearchMatch(t, search))
      .map((t) => {
        const s: any = summaryMap.get(t.id) || {};
        return {
          ...t,
          pendingAlis: s.pendingAlis || 0,
          pendingSatis: s.pendingSatis || 0,
          pendingBanka: s.pendingBanka || 0,
          approvedAlis: s.approvedAlis || 0,
          approvedSatis: s.approvedSatis || 0,
          approvedBanka: s.approvedBanka || 0,
          postedToLuca: s.postedToLuca || 0,
          hasIssue: s.hasIssue || 0,
          pendingTotal: (s.pendingAlis || 0) + (s.pendingSatis || 0) + (s.pendingBanka || 0),
          approvedTotal: (s.approvedAlis || 0) + (s.approvedSatis || 0) + (s.approvedBanka || 0),
        };
      });

    if (sortBy === 'name') merged.sort((a, b) => taxpayerName(a).localeCompare(taxpayerName(b), 'tr'));
    else if (sortBy === 'pending') merged.sort((a, b) => b.pendingTotal - a.pendingTotal);
    else if (sortBy === 'approved') merged.sort((a, b) => b.approvedTotal - a.approvedTotal);

    return merged;
  }, [taxpayers, summaryMap, taxpayerId, search, sortBy]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    pendingAlis: acc.pendingAlis + r.pendingAlis,
    pendingSatis: acc.pendingSatis + r.pendingSatis,
    pendingBanka: acc.pendingBanka + r.pendingBanka,
    approvedAlis: acc.approvedAlis + r.approvedAlis,
    approvedSatis: acc.approvedSatis + r.approvedSatis,
    approvedBanka: acc.approvedBanka + r.approvedBanka,
  }), { pendingAlis: 0, pendingSatis: 0, pendingBanka: 0, approvedAlis: 0, approvedSatis: 0, approvedBanka: 0 }), [rows]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end gap-3 mb-5 flex-wrap">
        <div className="min-w-0">
          <div className="text-[22px] font-semibold tracking-tight whitespace-nowrap" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Gelen Belgeler
          </div>
          <div className="text-[12.5px] mt-0.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {rows.length} mukellef · Dönem {period}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 240 }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            placeholder="Mukellef ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--text)' }}
          />
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-[12.5px] outline-none flex-shrink-0"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <option value="pending">Bekleyene göre</option>
          <option value="approved">Onaylanana göre</option>
          <option value="name">Ada göre</option>
        </select>

        <button
          onClick={() => earsivBackfillMut.mutate()}
          disabled={earsivBackfillMut.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
          style={{ background: '#a78bfa15', border: '1px solid #a78bfa40', color: '#a78bfa' }}
          title="e-Arşiv'den çekilmiş faturaları bu dönem için Gelen Belgeler'e aktarır"
        >
          {earsivBackfillMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          e-Arşiv İçe Aktar
        </button>
      </div>

      {earsivBackfillMut.isSuccess && (() => {
        const r = (earsivBackfillMut.data as any)?.data || {};
        if (r.scanned === 0) {
          return (
            <div className="mb-3 p-2.5 rounded-lg text-[12px] flex items-center gap-2" style={{ background: '#f59e0b15', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
              Bu dönem için e-Arşiv kaydı bulunamadı. Önce e-Arşiv modülünden faturaları çekmen lazım.
            </div>
          );
        }
        const errorsList: Array<{ id: string; message: string }> = Array.isArray(r.errors) ? r.errors : [];
        const isMostlyFailing = r.failed && r.failed >= r.scanned * 0.5;
        return (
          <div className="mb-3 p-2.5 rounded-lg text-[12px]" style={{
            background: isMostlyFailing ? '#ef444415' : '#10b98115',
            border: `1px solid ${isMostlyFailing ? '#ef444440' : '#10b98140'}`,
            color: isMostlyFailing ? '#fca5a5' : '#86efac',
          }}>
            <div>
              {isMostlyFailing ? '⚠' : '✓'} {r.scanned} e-arşiv tarandı · {r.created || 0} yeni belge · {r.alreadyQueued || 0} zaten vardı{r.failed ? ` · ${r.failed} hata` : ''}
            </div>
            {errorsList.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] underline" style={{ color: '#fca5a5' }}>
                  Hata detayları (ilk {errorsList.length})
                </summary>
                <ul className="mt-1 ml-3 space-y-0.5 text-[10.5px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {errorsList.map((e, idx) => (
                    <li key={idx} className="break-all">
                      <span style={{ color: 'var(--text-light)' }}>{e.id?.slice(0, 8) || '?'}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })()}

      {earsivBackfillMut.error && (
        <div className="mb-3 p-2.5 rounded-lg text-[12px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
          {(earsivBackfillMut.error as any)?.response?.data?.message || 'Backfill hatası'}
        </div>
      )}

      {/* v2.2: Orphan (mukellef bağı yok) belgeler uyarı bandı */}
      {(inboxSummaryQ.data?.orphanCount ?? 0) > 0 && (
        <div className="mb-3 p-3 rounded-lg flex items-center gap-3" style={{ background: '#f59e0b15', border: '1px solid #f59e0b60' }}>
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold" style={{ color: '#fbbf24' }}>
              {inboxSummaryQ.data.orphanCount} belge mukellefe bağlı değil
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Bu yüzden aşağıdaki tabloda görünmüyor. VKN/TC'leri mevcut mukelleflerle otomatik eşleştirebilirim.
            </div>
          </div>
          <button
            onClick={() => matchOrphansMut.mutate()}
            disabled={matchOrphansMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg disabled:opacity-50"
            style={{ background: '#f59e0b', color: 'white' }}
          >
            {matchOrphansMut.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Mukellef eşleştir
          </button>
        </div>
      )}
      {matchOrphansMut.isSuccess && (() => {
        const r = (matchOrphansMut.data as any)?.data || {};
        return (
          <div className="mb-3 p-2.5 rounded-lg text-[12px]" style={{ background: '#10b98115', border: '1px solid #10b98140', color: '#86efac' }}>
            ✓ {r.matched ?? 0} belge mukelleflere eşleştirildi · {r.stillOrphan ?? 0} hâlâ bağlı değil (VKN/TC eşleşmedi){r.notFoundExamples?.length ? ` — örnek VKN: ${r.notFoundExamples.slice(0, 3).join(', ')}` : ''}
          </div>
        );
      })()}

      {/* Hızlı özet kart */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryCard
          label="Bekleyen Toplam"
          alis={totals.pendingAlis}
          satis={totals.pendingSatis}
          tone="#f59e0b"
        />
        <SummaryCard
          label="Onaylanan Toplam"
          alis={totals.approvedAlis}
          satis={totals.approvedSatis}
          tone="#10b981"
        />
        <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <div className="text-[10.5px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>HEDEF</div>
            <div className="text-[15px] font-semibold mt-0.5" style={{ color: 'var(--text)' }}>Toplu Onayla</div>
            <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Sıraya almak için aşağıdaki satıra bas</div>
          </div>
          <Inbox size={28} style={{ color: 'var(--accent)' }} />
        </div>
      </div>

      {/* Tablo */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>FİRMA / AD</Th>
                <Th>DEFTER</Th>
                <Th align="right" tone="#f59e0b">BEKL. ALIŞ</Th>
                <Th align="right" tone="#f59e0b">BEKL. SATIŞ</Th>
                <Th align="right" tone="#10b981">ONAY. ALIŞ</Th>
                <Th align="right" tone="#10b981">ONAY. SATIŞ</Th>
                <Th align="right">LUCA</Th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {summaryQ.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
              )}
              {!summaryQ.isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {search ? 'Eşleşen mukellef yok' : `${period} dönemi için kayıt yok`}
                </td></tr>
              )}
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border-soft)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-3 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS' })}
                        className="text-left hover:underline"
                      >
                        {taxpayerName(r)}
                      </button>
                      {r.hasIssue > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums"
                          style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455' }}
                          title="Bu mükellefte veri kontrolü hatası olan belgeler var — onaylanamaz"
                        >
                          ⚠ {r.hasIssue} hata
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{taxpayerBookType(r)}</td>
                  <NumCell value={r.pendingAlis} tone="#f59e0b" onClick={() => r.pendingAlis > 0 && setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS' })} />
                  <NumCell value={r.pendingSatis} tone="#f59e0b" onClick={() => r.pendingSatis > 0 && setSelectedDoc({ taxpayerId: r.id, direction: 'SATIS' })} />
                  <NumCell value={r.approvedAlis} tone="#10b981" />
                  <NumCell value={r.approvedSatis} tone="#10b981" />
                  <NumCell value={r.postedToLuca} tone="#a78bfa" />
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS' })}
                      className="p-1 rounded-md transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDoc && (
        <FaturaDetayDrawer
          taxpayerId={selectedDoc.taxpayerId}
          direction={selectedDoc.direction}
          period={period}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}

/* ─── Yardımcı bileşenler ─── */
function Th({ children, align, tone }: { children: React.ReactNode; align?: 'right' | 'left'; tone?: string }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10.5px] font-semibold tracking-wide whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: tone || 'var(--text-muted)' }}
    >
      {children}
    </th>
  );
}

function NumCell({ value, tone, onClick }: { value: number; tone: string; onClick?: () => void }) {
  return (
    <td className="px-3 py-2.5 text-right">
      {value > 0 ? (
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          className="px-2.5 py-1 rounded-md text-[13px] font-bold tabular-nums transition-all"
          style={{
            background: `${tone}28`,
            color: tone,
            border: `1px solid ${tone}55`,
            cursor: onClick ? 'pointer' : 'default',
          }}
        >
          {value}
        </button>
      ) : (
        <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-light)' }}>0</span>
      )}
    </td>
  );
}

function SummaryCard({ label, alis, satis, tone }: { label: string; alis: number; satis: number; tone: string }) {
  const total = alis + satis;
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10.5px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>{label.toUpperCase()}</div>
        <div className="text-[22px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{total}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <SubStat label="Alış"  value={alis}  tone={tone} />
        <SubStat label="Satış" value={satis} tone={tone} />
      </div>
    </div>
  );
}

function SubStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-center p-2 rounded-md" style={{ background: `${tone}22`, border: `1px solid ${tone}40` }}>
      <div className="text-[18px] font-bold tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="text-[10.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}
