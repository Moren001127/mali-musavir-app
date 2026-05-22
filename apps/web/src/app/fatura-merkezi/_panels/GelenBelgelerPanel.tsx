'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Download, Loader2, Search } from 'lucide-react';
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
  const [selectedDoc, setSelectedDoc] = useState<{ taxpayerId: string; direction: 'ALIS' | 'SATIS'; defterTuru?: string | null } | null>(null);

  /* e-Arşiv ALIŞ kayıtlarını gelen belgeye çevir (toplu)
     — sadece tip=ALIS + belgeKaynak=EARSIV. Satış ve e-fatura akışları ayrı butonlarla. */
  const earsivBackfillMut = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) {
        throw new Error('Önce tek bir mükellef seçmelisin');
      }
      return api.post('/fatura-muhasebelestirme/documents/backfill-earsiv', {
        taxpayerId,
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
    issue: acc.issue + r.hasIssue,
    postedToLuca: acc.postedToLuca + r.postedToLuca,
  }), { pendingAlis: 0, pendingSatis: 0, pendingBanka: 0, approvedAlis: 0, approvedSatis: 0, approvedBanka: 0, issue: 0, postedToLuca: 0 }), [rows]);

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
          disabled={earsivBackfillMut.isPending || !taxpayerId}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#a78bfa15', border: '1px solid #a78bfa40', color: '#a78bfa' }}
          title={taxpayerId ? "e-Arşiv'den çekilmiş faturaları bu dönem için Gelen Belgeler'e aktarır" : 'Tüm faturaları almamak için önce tek bir mükellef seç'}
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

      {!taxpayerId && (
        <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-[11.5px]" style={{ background: '#a78bfa12', border: '1px solid #a78bfa35', color: '#c4b5fd' }}>
          <AlertTriangle size={13} className="shrink-0" />
          <span>e-Arşiv içe aktar için üstten tek mükellef seç; bu yüzden toplu çekmez.</span>
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

      {/* Kompakt özet bandı */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <MetricPill
          label="Bekleyen"
          value={totals.pendingAlis + totals.pendingSatis + totals.pendingBanka}
          sub={`${totals.pendingAlis} alış · ${totals.pendingSatis} satış`}
          tone="#f59e0b"
        />
        <MetricPill
          label="Kontrol"
          value={totals.issue}
          sub="Onaydan önce bakılacak"
          tone="#ef4444"
        />
        <MetricPill
          label="Onaylanan"
          value={totals.approvedAlis + totals.approvedSatis + totals.approvedBanka}
          sub={`${totals.approvedAlis} alış · ${totals.approvedSatis} satış`}
          tone="#10b981"
        />
        <MetricPill
          label="Luca"
          value={totals.postedToLuca}
          sub="Aktarılan belge"
          tone="#a78bfa"
        />
        <MetricPill
          label="Mükellef"
          value={rows.length}
          sub={`Dönem ${period}`}
          tone="var(--accent)"
        />
      </div>

      {/* Tablo */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid rgba(212,184,118,0.38)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.035), 0 10px 30px rgba(0,0,0,0.20)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(212,184,118,0.10)' }}>
              <tr style={{ borderBottom: '1px solid rgba(212,184,118,0.30)' }}>
                <Th>FİRMA / AD</Th>
                <Th>DEFTER</Th>
                <Th align="right" tone="#f59e0b">BEKL. ALIŞ</Th>
                <Th align="right" tone="#f59e0b">BEKL. SATIŞ</Th>
                <Th align="right" tone="#10b981">ONAY. ALIŞ</Th>
                <Th align="right" tone="#10b981">ONAY. SATIŞ</Th>
                <Th align="right">LUCA</Th>
                <th className="px-3 py-2.5" style={{ borderLeft: '1px solid rgba(212,184,118,0.14)' }}></th>
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
                  style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid rgba(212,184,118,0.13)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(212,184,118,0.055)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-3 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text)', borderRight: '1px solid rgba(212,184,118,0.12)' }}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS', defterTuru: r.defterTuru || r.mihsapDefterTuru })}
                        className="text-left hover:underline"
                      >
                        {taxpayerName(r)}
                      </button>
                      {r.hasIssue > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedDoc({ taxpayerId: r.id, direction: r.pendingAlis > 0 ? 'ALIS' : 'SATIS', defterTuru: r.defterTuru || r.mihsapDefterTuru })}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums"
                          style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455' }}
                          title="Veri kontrolü uyarısı: yevmiye dengesi, belge toplamı, mükellef eşleşmesi veya eksik hesap nedeniyle inceleme bekleyen belge."
                        >
                          <AlertTriangle size={10} /> {r.hasIssue} kontrol
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)', borderRight: '1px solid rgba(212,184,118,0.12)' }}>{taxpayerBookType(r)}</td>
                  <NumCell value={r.pendingAlis} tone="#f59e0b" onClick={() => r.pendingAlis > 0 && setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS', defterTuru: r.defterTuru || r.mihsapDefterTuru })} />
                  <NumCell value={r.pendingSatis} tone="#f59e0b" onClick={() => r.pendingSatis > 0 && setSelectedDoc({ taxpayerId: r.id, direction: 'SATIS', defterTuru: r.defterTuru || r.mihsapDefterTuru })} />
                  <NumCell value={r.approvedAlis} tone="#10b981" />
                  <NumCell value={r.approvedSatis} tone="#10b981" />
                  <NumCell value={r.postedToLuca} tone="#a78bfa" />
                  <td className="px-3 py-2.5 text-right" style={{ borderLeft: '1px solid rgba(212,184,118,0.12)' }}>
                    <button
                      onClick={() => setSelectedDoc({ taxpayerId: r.id, direction: 'ALIS', defterTuru: r.defterTuru || r.mihsapDefterTuru })}
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
          defterTuru={selectedDoc.defterTuru}
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
      style={{ color: tone || 'var(--text-muted)', borderRight: '1px solid rgba(212,184,118,0.14)' }}
    >
      {children}
    </th>
  );
}

function NumCell({ value, tone, onClick }: { value: number; tone: string; onClick?: () => void }) {
  return (
    <td className="px-3 py-2.5 text-right" style={{ borderRight: '1px solid rgba(212,184,118,0.10)' }}>
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

function MetricPill({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] tracking-wider font-semibold uppercase truncate" style={{ color: 'var(--text-light)' }}>{label}</div>
        <div className="text-[18px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{value}</div>
      </div>
      <div className="mt-0.5 text-[10.5px] truncate" style={{ color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}
