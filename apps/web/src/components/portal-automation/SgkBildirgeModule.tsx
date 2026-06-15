'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, RefreshCw, Loader2, Search, Users, FileText, Download, ChevronDown,
  Activity, Eye, X, CheckCheck, AlertTriangle, CalendarClock, Receipt, ListChecks,
} from 'lucide-react';
import { portalAutomationApi, type PortalDocument } from '@/lib/portal-automation';

const GOLD = '#d4b876';
const SGK_BELGE = 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI';

function taxpayerName(tp?: PortalDocument['taxpayer']): string {
  if (!tp) return '—';
  if (tp.companyName) return tp.companyName;
  const ad = [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim();
  return ad || tp.taxNumber || '—';
}

// SGK satır meta verisi: backend PDF'ten çıkarıp raw'a yazdı (belgeMahiyeti/kanunNo/calisan/tutar).
// Yoksa (eski kayıt) raw metninden en iyi çabayla çıkar.
function sgkMeta(d: any): { donem: string; mahiyet: string; kanunNo: string; calisan: string; tutar: string } {
  const raw = d?.raw || {};
  const cells: string[] = Array.isArray(raw.cells) ? raw.cells : [];
  const text: string = String(raw.rowText || cells.join(' ') || '');
  const donem = String(raw.donem || d?.period || '').trim();
  const mahiyet = String(raw.belgeMahiyeti || '').trim() || (text.match(/\b(ASIL|EK|İPTAL|IPTAL)\b/i) || [])[0] || '';
  const kanunRaw = String(raw.kanunNo || '').trim() || (text.match(/\b0?5510\b/) || text.match(/\b\d{5}\b/) || [])[0] || '';
  let tutar = String(raw.tutar || '').trim();
  if (!tutar) { const tt = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []; tutar = tt.length ? tt[tt.length - 1] : ''; }
  let calisan = String(raw.calisan || '').trim();
  if (!calisan) {
    const nums = (text.match(/\b\d{1,4}\b/g) || []).filter((n) => n !== kanunRaw && !/^20\d{2}$/.test(n) && n.length <= 4);
    if (nums.length) calisan = nums.find((n) => Number(n) > 0 && Number(n) < 1000) || '';
  }
  return { donem, mahiyet, kanunNo: kanunRaw.replace(/^0/, '') || kanunRaw, calisan, tutar };
}

function turLabel(belgeTuru: string): { label: string; icon: React.ReactNode; color: string } {
  if (belgeTuru === 'SGK_TAHAKKUK') return { label: 'Tahakkuk Fişi', icon: <Receipt size={11} />, color: '#d4b876' };
  if (belgeTuru === 'SGK_HIZMET_LISTESI') return { label: 'Hizmet Listesi', icon: <ListChecks size={11} />, color: '#7bb3e0' };
  return { label: belgeTuru, icon: <FileText size={11} />, color: GOLD };
}

function Kpi({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border p-4 ${onClick ? 'cursor-pointer hover:brightness-125 transition' : ''}`}
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="grid place-items-center rounded-lg flex-shrink-0" style={{ width: 30, height: 30, background: 'rgba(212,184,118,0.12)', color: GOLD }}>{icon}</span>
        <span className="text-[10px] uppercase font-bold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: '#fafaf9', lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</div>}
    </div>
  );
}

function PgBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="h-7 min-w-[28px] px-2 rounded-md text-[12px] font-semibold border disabled:opacity-30 hover:enabled:brightness-125 transition"
      style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.1)', color: '#fafaf9' }}>
      {children}
    </button>
  );
}

export default function SgkBildirgeModule() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [pdfModal, setPdfModal] = useState<{ url: string; title: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());
  const PAGE_SIZE = 200;
  const [page, setPage] = useState(1);
  const now = useMemo(() => new Date(), []);
  const [queryYear, setQueryYear] = useState(String(now.getFullYear()));
  const [queryMonth, setQueryMonth] = useState(''); // '' = tüm dönemler (gece gibi son dönemler)
  const years = useMemo(() => { const y = now.getFullYear(); return [y, y - 1, y - 2]; }, [now]);
  const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  const docsQuery = useQuery({
    queryKey: ['sgk-docs'],
    queryFn: () => portalAutomationApi.documents({ belgeTuru: SGK_BELGE, limit: 0 }),
    refetchInterval: 30_000,
  });
  const summaryQuery = useQuery({ queryKey: ['sgk-summary'], queryFn: () => portalAutomationApi.summary(), refetchInterval: 30_000 });
  const credsQuery = useQuery({ queryKey: ['sgk-creds'], queryFn: () => portalAutomationApi.credentials(), staleTime: 5 * 60_000 });

  const docs = (docsQuery.data || []) as Array<PortalDocument & { raw?: any }>;
  const summary = summaryQuery.data;

  const mukellefler = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of credsQuery.data?.rows || []) {
      if (c.provider === 'SGK_EBILDIRGE' && c.taxpayer?.id) {
        const t = c.taxpayer;
        const name = t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || t.taxNumber || '—';
        map.set(t.id, name);
      }
    }
    for (const d of docs) {
      if (d.taxpayerId && !map.has(d.taxpayerId)) map.set(d.taxpayerId, taxpayerName(d.taxpayer));
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [docs, credsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const arr = docs.filter((d) => {
      if (taxpayerId && d.taxpayerId !== taxpayerId) return false;
      if (!q) return true;
      const m = sgkMeta(d);
      const hay = [taxpayerName(d.taxpayer), turLabel(d.belgeTuru).label, m.donem, d.referenceNo, m.kanunNo].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
    // Dönem (yeni→eski), sonra tür: önce tahakkuk sonra hizmet
    const ts = (d: any) => {
      const dn = sgkMeta(d).donem; const m = dn.match(/(\d{4})[/.-](\d{1,2})/); return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
    };
    // Dönem (yeni->eski) -> firma (A-Z) -> BİLDİRGE (refNo grubu) -> belge türü (Hizmet, sonra Tahakkuk).
    // refNo grubu sayesinde aynı bildirgenin Hizmet Listesi + Tahakkuk Fişi YAN YANA gelir
    // (önce hizmet, hemen ardından kendi tahakkuku; sonra diğer bildirge).
    return arr.sort((a, b) =>
      ts(b) - ts(a)
      || taxpayerName(a.taxpayer).localeCompare(taxpayerName(b.taxpayer), 'tr')
      || String(a.referenceNo || '').localeCompare(String(b.referenceNo || ''), 'tr')
      || (a.belgeTuru < b.belgeTuru ? -1 : a.belgeTuru > b.belgeTuru ? 1 : 0),
    );
  }, [docs, taxpayerId, search]);

  useEffect(() => { setPage(1); }, [search, taxpayerId]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE), [filtered, pageClamped]);

  // Tek sorgu: dönem (ay) seçiliyse o dönemi, değilse son dönemleri (gece gibi) çeker.
  const sorgulaMut = useMutation({
    mutationFn: () => portalAutomationApi.manualRun({
      scope: 'sgk',
      jobTypes: ['SGK_HIZMET_LISTESI', 'SGK_TAHAKKUK'],
      taxpayerIds: taxpayerId ? [taxpayerId] : [],
      force: true,
      ...(queryMonth ? { targetPeriod: `${queryYear}/${queryMonth}` } : {}),
    }),
    onSuccess: (d) => {
      const n = d.created?.length || 0;
      const et = queryMonth ? ` (${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear})` : '';
      toast.success(n > 0 ? `${n} iş kuyruğa alındı${et}.` : (d.message || 'Sorgu kuyruğa alındı.'));
      setTimeout(() => { qc.invalidateQueries({ queryKey: ['sgk-docs'] }); qc.invalidateQueries({ queryKey: ['sgk-summary'] }); }, 1500);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Sorgu başlatılamadı'),
  });

  const markAllMut = useMutation({
    mutationFn: (ids: string[]) => portalAutomationApi.markDocumentsViewed({ ids }),
    onMutate: (ids: string[]) => setViewedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; }),
    onSuccess: (d) => { toast.success(`${d.updated} belge görüntülendi işaretlendi.`); qc.invalidateQueries({ queryKey: ['sgk-docs'] }); },
    onError: () => toast.error('İşaretlenemedi'),
  });
  const markAll = () => {
    const ids = filtered.filter((d) => d.storageKey && !d.viewedAt && !viewedIds.has(d.id)).map((d) => d.id);
    if (!ids.length) { toast.info('Görüntülenecek (kırmızı) belge yok.'); return; }
    markAllMut.mutate(ids);
  };

  const openPdf = async (d: PortalDocument) => {
    try {
      const { url } = await portalAutomationApi.documentViewUrl(d.id);
      const m = sgkMeta(d);
      setPdfModal({ url, title: [taxpayerName(d.taxpayer), turLabel(d.belgeTuru).label, m.donem].filter(Boolean).join(' · ') });
      setViewedIds((prev) => { const n = new Set(prev); n.add(d.id); return n; });
      qc.invalidateQueries({ queryKey: ['sgk-docs'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Belge açılamadı');
    }
  };

  const cellBorder = '1px solid rgba(255,255,255,0.06)';
  const aktifIs = summary?.stats?.activeJobs ?? 0;
  const sgkErr = summary?.stats?.sgkErrorCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<ShieldCheck size={16} />} label="Toplam SGK belgesi" value={String(summary?.stats?.sgkTotal ?? docs.length)} sub="tahakkuk + hizmet listesi" />
        <Kpi icon={<Users size={16} />} label="Şifreli mükellef" value={String(summary?.credentials?.sgkTaxpayerCount ?? 0)} sub="SGK e-Bildirge" />
        <Kpi icon={<Activity size={16} />} label="Çekilen mükellef" value={String(mukellefler.filter((m) => docs.some((d) => d.taxpayerId === m.id)).length)} sub="belgesi olan" />
        <Kpi icon={<AlertTriangle size={16} />} label="Gece sorgu hatası" value={String(sgkErr)} sub={sgkErr > 0 ? 'görmek için tıkla' : 'son sorguda hata yok'} onClick={sgkErr > 0 ? () => setShowErrors(true) : undefined} />
      </div>

      <div className="rounded-2xl border p-3.5 flex flex-wrap items-center gap-2.5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Dönem, tür, mükellef veya kanun no ara…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[10px] text-[13px] outline-none border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }} />
        </div>
        <div className="relative">
          <select value={taxpayerId} onChange={(e) => setTaxpayerId(e.target.value)} className="h-[38px] pl-9 pr-8 rounded-[10px] text-[13px] outline-none border appearance-none min-w-[200px]" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
            <option value="">Tüm mükellefler ({mukellefler.length})</option>
            {mukellefler.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
        </div>
        {/* Dönem seçici: Ay boş = tüm dönemler (gece gibi); ay seçilince Sorgula o dönemi çeker */}
        <div className="flex items-center gap-1.5 h-[38px] px-2 rounded-[10px] border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
          <CalendarClock size={14} style={{ color: 'rgba(250,250,249,0.4)', flexShrink: 0 }} />
          <select value={queryMonth} onChange={(e) => setQueryMonth(e.target.value)} className="h-[30px] pr-1 rounded-[7px] text-[12.5px] outline-none bg-transparent appearance-none cursor-pointer" style={{ color: '#fafaf9' }}>
            <option value="" style={{ background: '#1a1410' }}>Tüm dönemler</option>
            {AY_ADLARI.map((ad, i) => <option key={i + 1} value={String(i + 1).padStart(2, '0')} style={{ background: '#1a1410' }}>{ad}</option>)}
          </select>
          {queryMonth && (
            <select value={queryYear} onChange={(e) => setQueryYear(e.target.value)} className="h-[30px] pr-1 rounded-[7px] text-[12.5px] outline-none bg-transparent appearance-none cursor-pointer" style={{ color: '#fafaf9' }}>
              {years.map((y) => <option key={y} value={String(y)} style={{ background: '#1a1410' }}>{y}</option>)}
            </select>
          )}
        </div>
        <button onClick={markAll} disabled={markAllMut.isPending} title="Ekrandaki tüm belgeleri görüntülendi (yeşil) işaretle"
          className="h-[38px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border disabled:opacity-50" style={{ background: 'rgba(95,207,142,0.12)', borderColor: 'rgba(95,207,142,0.35)', color: '#5fcf8e' }}>
          {markAllMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Tümünü Görüntüle
        </button>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['sgk-docs'] })} className="h-[38px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}>
          <RefreshCw size={14} className={docsQuery.isFetching ? 'animate-spin' : ''} /> Yenile
        </button>
        <button onClick={() => sorgulaMut.mutate()} disabled={sorgulaMut.isPending} title={queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} dönemini çek` : 'Son dönemleri çek (eksik/yeni bildirgeler)'}
          className="h-[38px] px-4 rounded-[10px] text-[13px] font-bold flex items-center gap-2 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}>
          {sorgulaMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {queryMonth
            ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} sorgula`
            : (taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula')}
        </button>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 980 }}>
            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
              <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
                {['Mükellef', 'Tür', 'Dönem', 'Belge Mahiyeti', 'Kanun No', 'Çalışan', 'Tutar', 'Belge'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i >= 4 && i <= 6 ? 'text-center' : 'text-left'} ${i === 7 ? 'text-center' : ''}`} style={{ borderBottom: cellBorder }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: 'rgba(250,250,249,0.88)' }}>
              {docsQuery.isLoading && (<tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</td></tr>)}
              {!docsQuery.isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <ShieldCheck size={26} className="inline mb-2 opacity-50" /><br />
                  {docs.length === 0 ? 'Henüz SGK belgesi yok. "Şimdi sorgula" ile çekin ya da gece otomatik gelsin.' : 'Filtreye uyan belge yok.'}
                </td></tr>
              )}
              {pageItems.map((d) => {
                const m = sgkMeta(d);
                const tur = turLabel(d.belgeTuru);
                const goruldu = !!d.viewedAt || viewedIds.has(d.id);
                const renk = goruldu ? { bg: 'rgba(95,207,142,0.1)', bd: 'rgba(95,207,142,0.32)', fg: '#5fcf8e' } : { bg: 'rgba(239,107,107,0.12)', bd: 'rgba(239,107,107,0.45)', fg: '#ef6b6b' };
                return (
                  <tr key={d.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <div className="font-semibold" style={{ color: '#fafaf9' }}>{taxpayerName(d.taxpayer)}</div>
                      {d.taxpayer?.taxNumber && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{d.taxpayer.taxNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: `${tur.color}1a`, border: `1px solid ${tur.color}40`, color: tur.color }}>{tur.icon} {tur.label}</span>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-[12.5px] font-semibold" style={{ borderBottom: cellBorder, color: '#fafaf9' }}>{m.donem || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-[12.5px] font-semibold" style={{ borderBottom: cellBorder, color: '#fafaf9' }}>{m.mahiyet || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-center font-mono tabular-nums text-[12.5px] font-semibold" style={{ borderBottom: cellBorder, color: '#fafaf9' }}>{m.kanunNo || '0000'}</td>
                    <td className="px-3 py-2.5 align-top text-center tabular-nums text-[12.5px] font-semibold" style={{ borderBottom: cellBorder, color: '#fafaf9' }}>{m.calisan || '—'}</td>
                    <td className="px-3 py-2.5 align-top text-center tabular-nums whitespace-nowrap text-[12.5px] font-semibold" style={{ borderBottom: cellBorder, color: d.belgeTuru === 'SGK_TAHAKKUK' ? '#fafaf9' : 'rgba(250,250,249,0.4)' }}>{d.belgeTuru === 'SGK_TAHAKKUK' ? (m.tutar ? `${m.tutar} ₺` : '—') : '—'}</td>
                    <td className="px-3 py-2.5 align-top text-center" style={{ borderBottom: cellBorder }}>
                      {d.storageKey ? (
                        <button onClick={() => openPdf(d)} title={goruldu ? 'Görüntülendi' : 'Yeni — henüz görüntülenmedi'} aria-label="Görüntüle"
                          className="inline-grid place-items-center rounded-md hover:brightness-110 transition" style={{ width: 32, height: 32, background: renk.bg, border: `1px solid ${renk.bd}`, color: renk.fg }}>
                          <Eye size={15} />
                        </button>
                      ) : (<span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>bekliyor</span>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-3 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap text-[11px]" style={{ borderTop: cellBorder, color: 'rgba(250,250,249,0.5)' }}>
            <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {(pageClamped - 1) * PAGE_SIZE + 1}–{Math.min(pageClamped * PAGE_SIZE, filtered.length)} / {filtered.length} belge{taxpayerId ? ' (süzüldü)' : ''}</span>
            {aktifIs > 0 && <span className="inline-flex items-center gap-1" style={{ color: GOLD }}><Loader2 size={11} className="animate-spin" /> {aktifIs} sorgu çalışıyor</span>}
            {totalPages > 1 && (
              <div className="inline-flex items-center gap-1">
                <PgBtn disabled={pageClamped <= 1} onClick={() => setPage(1)}>«</PgBtn>
                <PgBtn disabled={pageClamped <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Önceki</PgBtn>
                <span className="px-2 text-[12px] font-semibold" style={{ color: '#fafaf9' }}>Sayfa {pageClamped} / {totalPages}</span>
                <PgBtn disabled={pageClamped >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Sonraki ›</PgBtn>
                <PgBtn disabled={pageClamped >= totalPages} onClick={() => setPage(totalPages)}>»</PgBtn>
              </div>
            )}
            {summary?.runner && <span className="ml-auto inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: summary.runner.enabled ? '#5fcf8e' : '#ef6b6b' }} /> Sunucu runner {summary.runner.enabled ? 'aktif' : 'kapalı'}</span>}
          </div>
        )}
      </div>

      {pdfModal && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setPdfModal(null)} className="fixed inset-0 z-[1000] flex items-center justify-center p-3 md:p-8" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-5xl h-[90vh] rounded-2xl overflow-hidden border shadow-2xl" style={{ background: '#1a1410', borderColor: 'rgba(212,184,118,0.25)', animation: 'sgkZoom .22s ease-out' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-center gap-2 min-w-0"><FileText size={15} style={{ color: GOLD, flexShrink: 0 }} /><span className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{pdfModal.title}</span></div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <a href={pdfModal.url} target="_blank" rel="noopener noreferrer" className="h-8 px-2.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 border hover:brightness-110" style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}><Download size={13} /> İndir</a>
                <button onClick={() => setPdfModal(null)} className="h-8 w-8 grid place-items-center rounded-lg border hover:brightness-110" style={{ borderColor: 'rgba(255,255,255,0.12)', color: '#fafaf9' }} aria-label="Kapat"><X size={16} /></button>
              </div>
            </div>
            <iframe src={pdfModal.url} title={pdfModal.title} className="w-full" style={{ height: 'calc(90vh - 45px)', border: 'none', background: '#fff' }} />
          </div>
          <style>{`@keyframes sgkZoom { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>
        </div>, document.body,
      )}

      {showErrors && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setShowErrors(false)} className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-lg max-h-[80vh] rounded-2xl overflow-hidden border shadow-2xl flex flex-col" style={{ background: '#1a1410', borderColor: 'rgba(239,107,107,0.3)', animation: 'sgkZoom .22s ease-out' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(239,107,107,0.06)' }}>
              <div className="flex items-center gap-2"><AlertTriangle size={15} style={{ color: '#ef6b6b' }} /><span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>SGK sorgusunda hata alan mükellefler</span></div>
              <button onClick={() => setShowErrors(false)} className="h-8 w-8 grid place-items-center rounded-lg border hover:brightness-110" style={{ borderColor: 'rgba(255,255,255,0.12)', color: '#fafaf9' }} aria-label="Kapat"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-2">
              {(summary?.stats?.sgkErrors || []).length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>Hata kaydı yok.</div>
              ) : (summary?.stats?.sgkErrors || []).map((e, i) => (
                <div key={e.taxpayerId || i} className="px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="font-semibold text-[13px]" style={{ color: '#fafaf9' }}>{e.name}</div>
                  {e.taxNumber && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{e.taxNumber}</div>}
                  <div className="text-[11.5px] mt-1" style={{ color: '#ef9a9a' }}>{e.reason || 'Sorgu başarısız (sebep belirtilmedi).'}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 text-[11px] border-t flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.4)' }}>Son 24 saatte SGK e-Bildirge sorgusu başarısız olan mükellefler. "Bu mükellefi sorgula" ile tekrar deneyebilirsiniz.</div>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
