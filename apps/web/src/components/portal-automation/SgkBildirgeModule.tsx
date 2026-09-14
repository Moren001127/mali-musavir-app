'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, RefreshCw, Loader2, Search, Download, ChevronDown, Eye, CheckCheck, CalendarClock,
  Receipt, ListChecks, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { portalAutomationApi, type BelgeSatiri } from '@/lib/portal-automation';
import { Sayfalama, sayfaSayisi } from '@/components/ui/Sayfalama';
import {
  ALAN_STILI, GOLD, METIN, GeceHataModali, HataSeridi, IletimRozeti, MukellefSecici, PdfOnizlemeModali,
  mukellefAdi, tutarBicimle, useGecikmeliDeger, useSayfaAdresi, useSuzgecSayfaSifirla, type PdfModalDurumu,
} from './belge-ortak';

const SGK_BELGE = 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI';
const SAYFA_ANAHTARI = 'sgk-sayfa';
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

// Tür süzgeci sunucuya `durum=hizmet|tahakkuk` olarak gider (birleşik modda yalnız o belgesi olan satırlar).
const TURLER: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tüm türler' },
  { value: 'hizmet', label: 'Hizmet Listesi' },
  { value: 'tahakkuk', label: 'Tahakkuk Fişi' },
];

type BelgeParcasi = { id: string; pdfVar: boolean; viewedAt: string | null } | null | undefined;

// Birleşik satırdaki tek belge çipi: yeşil (görüntülendi) / kırmızı (yeni) / soluk "bekliyor" (PDF yok) / soluk "yok".
function BelgeCipi({ label, ikon, belge, goruldu, onClick }: { label: string; ikon: React.ReactNode; belge: BelgeParcasi; goruldu: boolean; onClick: () => void }) {
  if (!belge) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] whitespace-nowrap" style={{ border: '1px dashed rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.3)' }}>
        {ikon} {label} · yok
      </span>
    );
  }
  if (!belge.pdfVar) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] whitespace-nowrap" style={{ border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.35)' }}>
        {ikon} {label} · bekliyor
      </span>
    );
  }
  const renk = goruldu
    ? { bg: 'rgba(95,207,142,0.1)', bd: 'rgba(95,207,142,0.32)', fg: '#5fcf8e' }   // yeşil (görüntülendi)
    : { bg: 'rgba(239,107,107,0.12)', bd: 'rgba(239,107,107,0.45)', fg: '#ef6b6b' }; // kırmızı (yeni)
  return (
    <button
      type="button"
      onClick={onClick}
      title={goruldu ? `${label} — görüntülendi` : `${label} — yeni, henüz görüntülenmedi`}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap hover:brightness-110 transition"
      style={{ background: renk.bg, border: `1px solid ${renk.bd}`, color: renk.fg }}
    >
      <Eye size={11} /> {label}
    </button>
  );
}

// useSearchParams (adres çubuğu sayfa/boyut) için Suspense sınırı.
export default function SgkBildirgeModule() {
  return (
    <Suspense fallback={<div className="px-3 py-10 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</div>}>
      <SgkBildirgeModuleIc />
    </Suspense>
  );
}

function SgkBildirgeModuleIc() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [turFilter, setTurFilter] = useState<string>(''); // '' | hizmet | tahakkuk
  const [search, setSearch] = useState('');
  const [pdfModal, setPdfModal] = useState<PdfModalDurumu>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());
  const now = useMemo(() => new Date(), []);
  const [queryYear, setQueryYear] = useState(String(now.getFullYear()));
  const [queryMonth, setQueryMonth] = useState(''); // '' = tüm dönemler (sorguda: son dönemler)
  const [donemOpen, setDonemOpen] = useState(false);
  const donemRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!donemOpen) return;
    const h = (e: MouseEvent) => { if (donemRef.current && !donemRef.current.contains(e.target as Node)) setDonemOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [donemOpen]);

  // Dönem süzgeci + sorgu hedefi: YYYY/MM
  const period = queryMonth ? `${queryYear}/${queryMonth}` : '';

  // Sayfa/boyut adres çubuğunda; arama 300 ms gecikmeli; süzgeç değişince sayfa 1.
  const { sayfa, boyut, setSayfa, setBoyut } = useSayfaAdresi(50);
  const aramaGecikmeli = useGecikmeliDeger(search.trim(), 300);
  const etkinSayfa = useSuzgecSayfaSifirla(JSON.stringify([aramaGecikmeli, taxpayerId, turFilter, period]), sayfa, setSayfa);

  const docsQuery = useQuery({
    queryKey: [SAYFA_ANAHTARI, { taxpayerId, search: aramaGecikmeli, durum: turFilter, period, page: etkinSayfa, pageSize: boyut }],
    queryFn: () => portalAutomationApi.documentsSayfa({
      belgeTuru: SGK_BELGE,
      birlesik: '1',
      taxpayerId: taxpayerId || undefined,
      search: aramaGecikmeli || undefined,
      period: period || undefined,
      durum: turFilter || undefined,
      page: etkinSayfa,
      pageSize: boyut,
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const summaryQuery = useQuery({ queryKey: ['sgk-summary'], queryFn: () => portalAutomationApi.summary(), refetchInterval: 30_000 });
  // Mükellef seçici listesi sunucudan (belgesi olanlar ∪ SGK şifresi olanlar).
  const mukellefQuery = useQuery({
    queryKey: ['sgk-mukellefler'],
    queryFn: () => portalAutomationApi.documentsMukellefler({ belgeTuru: SGK_BELGE }),
    staleTime: 5 * 60_000,
  });

  const rows: BelgeSatiri[] = docsQuery.data?.rows || [];
  const toplam = docsQuery.data?.total ?? 0;
  const summary = summaryQuery.data;
  const mukellefler = mukellefQuery.data?.rows || [];
  const suzgecVar = !!(aramaGecikmeli || taxpayerId || turFilter || period);

  // Adres çubuğundan gelen sayfa toplamı aşıyorsa son sayfaya çek (gerçek yanıtla).
  useEffect(() => {
    if (docsQuery.isPlaceholderData || docsQuery.data === undefined) return;
    const son = sayfaSayisi(docsQuery.data.total, boyut);
    if (sayfa > son) setSayfa(son);
  }, [docsQuery.data, docsQuery.isPlaceholderData, sayfa, boyut, setSayfa]);

  const yenile = () => {
    qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] });
    qc.invalidateQueries({ queryKey: ['sgk-summary'] });
    qc.invalidateQueries({ queryKey: ['sgk-mukellefler'] });
  };

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
      setTimeout(yenile, 1500);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Sorgu başlatılamadı'),
  });

  const markAllMut = useMutation({
    mutationFn: (ids: string[]) => portalAutomationApi.markDocumentsViewed({ ids }),
    onMutate: (ids: string[]) => setViewedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; }),
    onSuccess: (d) => { toast.success(`${d.updated} belge görüntülendi işaretlendi.`); qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] }); },
    onError: () => toast.error('İşaretlenemedi'),
  });
  // "Tümünü Görüntüle": sayfadaki birleşik satırlarda hizmet + tahakkuk id'lerinin ikisi de.
  const markAll = () => {
    const ids: string[] = [];
    for (const d of rows) {
      for (const b of [d.hizmet, d.tahakkuk]) {
        if (b && b.pdfVar && !b.viewedAt && !viewedIds.has(b.id)) ids.push(b.id);
      }
    }
    if (!ids.length) { toast.info('Bu sayfada görüntülenecek (kırmızı) belge yok.'); return; }
    markAllMut.mutate(ids);
  };

  const openPdf = async (id: string, baslik: string) => {
    try {
      const { url } = await portalAutomationApi.documentViewUrl(id);
      setPdfModal({ url, title: baslik });
      setViewedIds((prev) => { const n = new Set(prev); n.add(id); return n; });
      qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Belge açılamadı');
    }
  };

  const cellBorder = '1px solid rgba(255,255,255,0.06)';
  const aktifIs = summary?.stats?.activeJobs ?? 0;
  const sgkErr = summary?.stats?.sgkErrorCount ?? 0;
  // 3 gece kuralıyla sorgu dışı kalan SGK şifreleri.
  const sifreBekleyen = useMemo(
    () => (summary?.credentialsBlocked || []).filter((s) => s.provider === 'SGK_EBILDIRGE'),
    [summary?.credentialsBlocked],
  );

  return (
    <div className="space-y-4">
      {/* Gece sorgu hatası şeridi (sayaç kartı yok) */}
      <HataSeridi hataSayisi={sgkErr} sifreBekleyenSayisi={sifreBekleyen.length} onClick={() => setShowErrors(true)} />

      {/* ── Tek şerit araç çubuğu: mükellef · tür · dönem · arama · sağda düğmeler ── */}
      <div className="rounded-2xl border p-3.5 flex flex-wrap items-center gap-2" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <MukellefSecici value={taxpayerId} onChange={setTaxpayerId} rows={mukellefler} yukleniyor={mukellefQuery.isLoading} className="min-w-[180px] max-w-[220px]" />

        <div className="relative">
          <select value={turFilter} onChange={(e) => setTurFilter(e.target.value)} aria-label="SGK türü" className="h-[38px] pl-9 pr-8 rounded-[10px] text-[13px] outline-none border appearance-none min-w-[140px]" style={ALAN_STILI}>
            {TURLER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ListChecks size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
        </div>

        <div className="relative" ref={donemRef}>
          <button type="button" onClick={() => setDonemOpen((o) => !o)} aria-label="Dönem"
            className="h-[38px] min-w-[140px] pl-9 pr-8 rounded-[10px] text-[13px] border flex items-center text-left outline-none" style={ALAN_STILI}>
            <CalendarClock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
            <span className="truncate" style={{ color: queryMonth ? METIN : 'rgba(250,250,249,0.55)' }}>
              {queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear}` : 'Tüm dönemler'}
            </span>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform" style={{ color: 'rgba(250,250,249,0.45)', transform: donemOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          {donemOpen && (
            <div className="absolute z-50 mt-1.5 left-0 w-[270px] rounded-xl border p-3" style={{ background: '#1a1410', borderColor: 'rgba(212,184,118,0.25)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
              <div className="flex items-center justify-between mb-2.5">
                <button type="button" onClick={() => setQueryYear(String(Number(queryYear) - 1))} className="h-7 w-7 grid place-items-center rounded-lg border hover:brightness-125" style={{ borderColor: 'rgba(255,255,255,0.1)', color: METIN }} aria-label="Önceki yıl"><ChevronLeft size={15} /></button>
                <span className="text-[14px] font-bold tabular-nums" style={{ color: METIN }}>{queryYear}</span>
                <button type="button" onClick={() => setQueryYear(String(Number(queryYear) + 1))} className="h-7 w-7 grid place-items-center rounded-lg border hover:brightness-125" style={{ borderColor: 'rgba(255,255,255,0.1)', color: METIN }} aria-label="Sonraki yıl"><ChevronRight size={15} /></button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {AY_KISA.map((ad, i) => {
                  const mv = String(i + 1).padStart(2, '0');
                  const sel = queryMonth === mv;
                  return (
                    <button key={i} type="button" onClick={() => { setQueryMonth(mv); setDonemOpen(false); }}
                      className="h-9 rounded-lg text-[12.5px] font-semibold transition hover:brightness-125"
                      style={sel ? { background: GOLD, color: '#1a1410' } : { background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.8)' }}>
                      {ad}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button type="button" onClick={() => { setQueryMonth(''); setDonemOpen(false); }} className="text-[12px] font-semibold hover:brightness-125" style={{ color: 'rgba(250,250,249,0.6)' }}>Tüm dönemler</button>
                <button type="button" onClick={() => { setQueryMonth(String(now.getMonth() + 1).padStart(2, '0')); setQueryYear(String(now.getFullYear())); setDonemOpen(false); }} className="text-[12px] font-semibold hover:brightness-125" style={{ color: GOLD }}>Bu ay</button>
              </div>
            </div>
          )}
        </div>

        <div className="relative flex-1 min-w-[120px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Dönem, mükellef, kanun no…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[10px] text-[13px] outline-none border" style={ALAN_STILI} />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => sorgulaMut.mutate()} disabled={sorgulaMut.isPending} title={queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} dönemini çek` : 'Son dönemleri çek (eksik/yeni bildirgeler)'}
            className="h-[38px] px-3.5 rounded-[10px] text-[13px] font-bold flex items-center gap-2 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}>
            {sorgulaMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} sorgula` : (taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula')}
          </button>
          <button onClick={yenile}
            className="h-[38px] px-2.5 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border" style={ALAN_STILI}>
            <RefreshCw size={14} className={docsQuery.isFetching ? 'animate-spin' : ''} /> Yenile
          </button>
          <button onClick={markAll} disabled={markAllMut.isPending} title="Sayfadaki tüm belgeleri görüntülendi (yeşil) işaretle"
            className="h-[38px] px-2.5 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border disabled:opacity-50" style={{ background: 'rgba(95,207,142,0.12)', borderColor: 'rgba(95,207,142,0.35)', color: '#5fcf8e' }}>
            {markAllMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Tümünü Görüntüle
          </button>
        </div>
      </div>

      {/* ── Tablo: mükellef + dönem tek satır, iki belge çipi ── */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', minWidth: 1040 }}>
            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
              <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
                {['Mükellef', 'Dönem', 'Mahiyet', 'Kanun No', 'Çalışan', 'Tutar', 'Belgeler', 'İletim'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i >= 3 ? 'text-center' : 'text-left'}`} style={{ borderBottom: cellBorder }}>{h}</th>
                ))}
              </tr>
            </thead>
            {/* Sayfa geçişinde eski satırlar hafif soluk kalır (titreme yok). */}
            <tbody style={{ color: 'rgba(250,250,249,0.88)', opacity: docsQuery.isPlaceholderData ? 0.55 : 1, transition: 'opacity .15s' }}>
              {docsQuery.isLoading && (<tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</td></tr>)}
              {docsQuery.isError && !docsQuery.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: '#ef9a9a' }}>Liste alınamadı. "Yenile" ile tekrar deneyin.</td></tr>
              )}
              {!docsQuery.isLoading && !docsQuery.isError && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <ShieldCheck size={26} className="inline mb-2 opacity-50" /><br />
                  {!suzgecVar ? 'Henüz SGK belgesi yok. "Şimdi sorgula" ile çekin ya da gece otomatik gelsin.' : 'Süzgece uyan belge yok.'}
                </td></tr>
              )}
              {rows.map((d) => {
                const o = d.ozet || {};
                const ad = mukellefAdi(d.taxpayer);
                const donem = d.period || '—';
                const tutar = d.tahakkuk?.tutar ?? o.tutar ?? null;
                const hizmetGoruldu = !!(d.hizmet && (d.hizmet.viewedAt || viewedIds.has(d.hizmet.id)));
                const tahakkukGoruldu = !!(d.tahakkuk && (d.tahakkuk.viewedAt || viewedIds.has(d.tahakkuk.id)));
                return (
                  <tr key={d.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 align-middle" style={{ borderBottom: cellBorder }}>
                      <div className="font-semibold text-[13px]" style={{ color: METIN }}>{ad}</div>
                      {d.taxpayer?.taxNumber && <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>{d.taxpayer.taxNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5 align-middle tabular-nums text-[13px] whitespace-nowrap" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.9)' }}>{donem}</td>
                    <td className="px-3 py-2.5 align-middle text-[13px]" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.9)' }}>{o.mahiyet || '—'}</td>
                    <td className="px-3 py-2.5 align-middle text-center tabular-nums text-[13px]" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.9)' }}>{o.kanunNo || '0000'}</td>
                    <td className="px-3 py-2.5 align-middle text-center tabular-nums text-[13px]" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.9)' }}>{o.calisan ?? '—'}</td>
                    <td className="px-3 py-2.5 align-middle text-center tabular-nums whitespace-nowrap text-[13px]" style={{ borderBottom: cellBorder, color: tutar !== null ? METIN : 'rgba(250,250,249,0.35)', fontWeight: tutar !== null ? 600 : 400 }}>{tutarBicimle(tutar)}</td>
                    <td className="px-3 py-2.5 align-middle text-center" style={{ borderBottom: cellBorder }}>
                      <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                        <BelgeCipi
                          label="Hizmet Listesi"
                          ikon={<ListChecks size={11} />}
                          belge={d.hizmet}
                          goruldu={hizmetGoruldu}
                          onClick={() => d.hizmet && openPdf(d.hizmet.id, [ad, 'Hizmet Listesi', d.period].filter(Boolean).join(' · '))}
                        />
                        <BelgeCipi
                          label="Tahakkuk Fişi"
                          ikon={<Receipt size={11} />}
                          belge={d.tahakkuk}
                          goruldu={tahakkukGoruldu}
                          onClick={() => d.tahakkuk && openPdf(d.tahakkuk.id, [ad, 'Tahakkuk Fişi', d.period].filter(Boolean).join(' · '))}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-center" style={{ borderBottom: cellBorder }}>
                      <IletimRozeti iletim={d.iletim} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(aktifIs > 0 || summary?.runner) && (
          <div className="px-4 py-2 flex items-center gap-x-3 flex-wrap text-[11px]" style={{ borderTop: cellBorder, color: 'rgba(250,250,249,0.5)' }}>
            {aktifIs > 0 && <span className="inline-flex items-center gap-1" style={{ color: GOLD }}><Loader2 size={11} className="animate-spin" /> {aktifIs} sorgu çalışıyor</span>}
            {summary?.runner && <span className="ml-auto inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: summary.runner.enabled ? '#5fcf8e' : '#ef6b6b' }} /> Sunucu runner {summary.runner.enabled ? 'aktif' : 'kapalı'}</span>}
          </div>
        )}
        <Sayfalama
          sayfa={etkinSayfa}
          sayfaBoyutu={boyut}
          toplam={toplam}
          onSayfa={setSayfa}
          onSayfaBoyutu={setBoyut}
          birim="dönem kaydı"
          yukleniyor={docsQuery.isFetching && docsQuery.isPlaceholderData}
        />
      </div>

      <PdfOnizlemeModali modal={pdfModal} onClose={() => setPdfModal(null)} />

      <GeceHataModali
        acik={showErrors}
        onClose={() => setShowErrors(false)}
        hatalar={summary?.stats?.sgkErrors || []}
        sifreBekleyen={sifreBekleyen}
        altNot='Son 24 saatte SGK e-Bildirge sorgusu başarısız olan mükellefler. "Bu mükellefi sorgula" ile tekrar deneyebilirsiniz.'
      />
    </div>
  );
}
