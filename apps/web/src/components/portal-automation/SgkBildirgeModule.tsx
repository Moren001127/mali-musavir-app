'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldCheck, RefreshCw, Loader2, Search, Download, ChevronDown, Eye, CheckCheck, CalendarClock,
  Receipt, ListChecks, ChevronLeft, ChevronRight, AlertTriangle, Users, Layers, Check,
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

// Belge kutusu (kare): H = Hizmet Listesi, T = Tahakkuk Fişi. Yeşil tik rengi = görüntülendi · kırmızı = yeni · kesikli soluk = PDF bekliyor / yok.
function BelgeCipi({ harf, label, belge, goruldu, onClick }: { harf: string; label: string; belge: BelgeParcasi; goruldu: boolean; onClick: () => void }) {
  const taban = 'inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-[12px] font-extrabold leading-none';
  if (!belge || !belge.pdfVar) {
    return (
      <span className={taban} title={!belge ? `${label} bu dönemde yok` : `${label} PDF'i henüz inmedi`} aria-label={`${label} yok`}
        style={{ border: '1px dashed rgba(255,255,255,0.14)', color: 'rgba(250,250,249,0.28)' }}>
        {harf}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick}
      title={goruldu ? `${label} — görüntülendi (tekrar aç)` : `${label} — yeni, henüz görüntülenmedi`}
      aria-label={`${label} aç`}
      className={`${taban} transition hover:brightness-125`}
      style={goruldu
        ? { background: 'rgba(92,191,138,0.14)', border: '1px solid rgba(92,191,138,0.45)', color: '#5cbf8a' }
        : { background: 'rgba(226,112,111,0.14)', border: '1px solid rgba(226,112,111,0.5)', color: '#e2706f' }}>
      {harf}
    </button>
  );
}

// Mahiyet: ASIL sessiz; EK / DÜZELTME sarı; İPTAL kırmızı.
function MahiyetRozeti({ mahiyet }: { mahiyet?: string | null }) {
  const m = String(mahiyet || '').toLocaleUpperCase('tr-TR');
  if (!m) return <span style={{ color: 'rgba(250,250,249,0.3)' }}>—</span>;
  if (m === 'ASIL') return <span className="text-[12px]" style={{ color: 'rgba(250,250,249,0.55)' }}>ASIL</span>;
  const kirmizi = /IPTAL|İPTAL/.test(m);
  return (
    <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[10.5px] font-bold tracking-wide"
      style={kirmizi
        ? { background: 'rgba(226,112,111,0.14)', color: '#e2706f', border: '1px solid rgba(226,112,111,0.4)' }
        : { background: 'rgba(212,168,95,0.14)', color: '#d4a85f', border: '1px solid rgba(212,168,95,0.4)' }}>
      {m}
    </span>
  );
}

// Üst durum şeridi: sayılar sessiz, sorun varsa sağda tıklanabilir kırmızı rozet.
function DurumSeridi({ donemKaydi, sifreliMukellef, aktifIs, hataSayisi, sifreBekleyen, runnerAcik, onHata }: {
  donemKaydi: number; sifreliMukellef: number; aktifIs: number; hataSayisi: number; sifreBekleyen: number; runnerAcik: boolean | null; onHata: () => void;
}) {
  const madde = (ikon: React.ReactNode, deger: React.ReactNode, etiket: string) => (
    <span className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}>{ikon}</span>
      <b className="tabular-nums" style={{ color: METIN }}>{deger}</b> {etiket}
    </span>
  );
  const sorun = hataSayisi > 0 || sifreBekleyen > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      {madde(<Layers size={12} />, donemKaydi.toLocaleString('tr-TR'), 'dönem kaydı')}
      {madde(<Users size={12} />, sifreliMukellef, 'şifreli mükellef')}
      {aktifIs > 0 && <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: GOLD }}><Loader2 size={12} className="animate-spin" /> {aktifIs} sorgu çalışıyor</span>}
      <span className="ml-auto flex items-center gap-3">
        {runnerAcik !== null && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: runnerAcik ? '#5cbf8a' : '#e2706f' }} /> gece sorgusu {runnerAcik ? 'açık' : 'kapalı'}
          </span>
        )}
        {sorun ? (
          <button type="button" onClick={onHata} title="Ayrıntı için tıkla"
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition hover:brightness-125"
            style={{ background: 'rgba(226,112,111,0.12)', border: '1px solid rgba(226,112,111,0.4)', color: '#e2706f' }}>
            <AlertTriangle size={12} />
            {hataSayisi > 0 ? `${hataSayisi} gece hatası` : ''}{hataSayisi > 0 && sifreBekleyen > 0 ? ' · ' : ''}{sifreBekleyen > 0 ? `${sifreBekleyen} şifre bekliyor` : ''}
          </button>
        ) : (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold" style={{ background: 'rgba(92,191,138,0.10)', border: '1px solid rgba(92,191,138,0.3)', color: '#5cbf8a' }}>
            <Check size={12} /> gece sorgusu sorunsuz
          </span>
        )}
      </span>
    </div>
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

  const aktifIs = summary?.stats?.activeJobs ?? 0;
  const sgkErr = summary?.stats?.sgkErrorCount ?? 0;
  // 3 gece kuralıyla sorgu dışı kalan SGK şifreleri.
  const sifreBekleyen = useMemo(
    () => (summary?.credentialsBlocked || []).filter((s) => s.provider === 'SGK_EBILDIRGE'),
    [summary?.credentialsBlocked],
  );

  const sayfadaYeniBelge = rows.some((d) => [d.hizmet, d.tahakkuk].some((b) => b && b.pdfVar && !b.viewedAt && !viewedIds.has(b.id)));
  const KENAR = '1px solid rgba(255,255,255,0.06)';
  const kutuStili: React.CSSProperties = { ...ALAN_STILI, height: 36, borderRadius: 10 };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)' }}>
        <DurumSeridi
          donemKaydi={toplam}
          sifreliMukellef={summary?.credentials?.sgkTaxpayerCount ?? 0}
          aktifIs={aktifIs}
          hataSayisi={sgkErr}
          sifreBekleyen={sifreBekleyen.length}
          runnerAcik={summary?.runner ? !!summary.runner.enabled : null}
          onHata={() => setShowErrors(true)}
        />

        {/* ── Süzgeç satırı: mükellef · tür · dönem · arama · sağda düğmeler ── */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: KENAR }}>
          <MukellefSecici value={taxpayerId} onChange={setTaxpayerId} rows={mukellefler} yukleniyor={mukellefQuery.isLoading} className="min-w-[190px] max-w-[240px]" />

          <div className="relative">
            <select value={turFilter} onChange={(e) => setTurFilter(e.target.value)} aria-label="SGK türü" className="pl-9 pr-8 text-[12.5px] outline-none border appearance-none min-w-[136px]" style={{ ...kutuStili, width: 'auto' }}>
              {TURLER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ListChecks size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
          </div>

          <div className="relative" ref={donemRef}>
            <button type="button" onClick={() => setDonemOpen((o) => !o)} aria-label="Dönem"
              className="min-w-[140px] pl-9 pr-8 text-[12.5px] border flex items-center text-left outline-none" style={kutuStili}>
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

          <div className="relative min-w-[160px] flex-[1_1_200px] max-w-[340px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.4)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mükellef, VKN, dönem, kanun no…"
              className="w-full pl-9 pr-3 text-[12.5px] outline-none border" style={{ ...kutuStili, padding: '0 12px 0 34px', fontSize: 12.5 }} />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {sayfadaYeniBelge && (
              <button onClick={markAll} disabled={markAllMut.isPending} title="Sayfadaki tüm yeni (kırmızı) belgeleri görüntülendi işaretle"
                className="h-9 px-3 rounded-[10px] text-[12.5px] font-semibold flex items-center gap-1.5 border disabled:opacity-50 transition hover:brightness-125"
                style={{ background: 'rgba(92,191,138,0.10)', borderColor: 'rgba(92,191,138,0.35)', color: '#5cbf8a' }}>
                {markAllMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Tümünü görüntülendi say
              </button>
            )}
            <button onClick={yenile} title="Listeyi yenile"
              className="h-9 w-9 rounded-[10px] flex items-center justify-center border transition hover:brightness-125" style={ALAN_STILI}>
              <RefreshCw size={14} className={docsQuery.isFetching ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => sorgulaMut.mutate()} disabled={sorgulaMut.isPending} title={queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} dönemini SGK'dan çek` : 'Son dönemleri SGK\'dan çek (eksik/yeni bildirgeler)'}
              className="h-9 px-3.5 rounded-[10px] text-[12.5px] font-bold flex items-center gap-2 disabled:opacity-50 transition hover:brightness-110" style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}>
              {sorgulaMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {queryMonth ? `${AY_ADLARI[Number(queryMonth) - 1]} ${queryYear} sorgula` : (taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula')}
            </button>
          </div>
        </div>

        {/* ── Liste: döneme göre gruplu, sabit sütun genişlikleri ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1000 }}>
            <colgroup>
              <col />
              <col style={{ width: 84 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 88 }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'rgba(250,250,249,0.42)' }}>
                {[['Mükellef', 'text-left'], ['Dönem', 'text-left'], ['Mahiyet', 'text-left'], ['Kanun', 'text-left'], ['Çalışan', 'text-right'], ['Tutar', 'text-right'], ['Belgeler', 'text-left'], ['İletim', 'text-left']].map(([h, hiza]) => (
                  <th key={h} className={`px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[.12em] whitespace-nowrap ${hiza}`} style={{ borderBottom: KENAR }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: 'rgba(250,250,249,0.88)', opacity: docsQuery.isPlaceholderData ? 0.55 : 1, transition: 'opacity .15s' }}>
              {docsQuery.isLoading && (<tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</td></tr>)}
              {docsQuery.isError && !docsQuery.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: '#e2706f' }}>Liste alınamadı. Yenile düğmesiyle tekrar deneyin.</td></tr>
              )}
              {!docsQuery.isLoading && !docsQuery.isError && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-14 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}><ShieldCheck size={18} /></span>
                  {!suzgecVar ? 'Henüz SGK belgesi yok. "Şimdi sorgula" ile çekin ya da gece otomatik gelsin.' : 'Süzgece uyan belge yok.'}
                </td></tr>
              )}
              {[{ donem: 'tum', satirlar: rows }].map((g) => (
                <React.Fragment key={g.donem}>
                  {g.satirlar.map((d, i) => {
                    const o = d.ozet || {};
                    const ad = mukellefAdi(d.taxpayer);
                    const tutar = d.tahakkuk?.tutar ?? o.tutar ?? null;
                    const kanun = o.kanunNo && !/^0+$/.test(String(o.kanunNo)) ? String(o.kanunNo) : '';
                    const hizmetGoruldu = !!(d.hizmet && (d.hizmet.viewedAt || viewedIds.has(d.hizmet.id)));
                    const tahakkukGoruldu = !!(d.tahakkuk && (d.tahakkuk.viewedAt || viewedIds.has(d.tahakkuk.id)));
                    return (
                      <tr key={d.id} className="transition-colors hover:bg-white/[0.03]" style={{ background: i % 2 ? 'rgba(255,255,255,0.012)' : 'transparent' }}>
                        <td className="px-3 py-2.5 align-middle" style={{ borderBottom: KENAR }}>
                          <div className="truncate text-[13px] font-semibold" style={{ color: METIN }} title={ad}>{ad}</div>
                          {d.taxpayer?.taxNumber && <div className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.38)' }}>{d.taxpayer.taxNumber}</div>}
                        </td>
                        <td className="px-3 py-2.5 align-middle tabular-nums text-[13px] font-semibold whitespace-nowrap" style={{ borderBottom: KENAR, color: METIN }}>{d.period || '—'}</td>
                        <td className="px-3 py-2.5 align-middle" style={{ borderBottom: KENAR }}><MahiyetRozeti mahiyet={o.mahiyet} /></td>
                        <td className="px-3 py-2.5 align-middle tabular-nums text-[12px]" style={{ borderBottom: KENAR, color: kanun ? 'rgba(250,250,249,0.7)' : 'rgba(250,250,249,0.3)' }}>{kanun || '—'}</td>
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums text-[13px]" style={{ borderBottom: KENAR, color: 'rgba(250,250,249,0.85)' }}>{o.calisan ?? '—'}</td>
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums whitespace-nowrap" style={{ borderBottom: KENAR }}>
                          {tutar !== null && Number.isFinite(tutar)
                            ? <><b className="text-[13.5px]" style={{ color: METIN }}>{tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>₺</span></>
                            : <span style={{ color: 'rgba(250,250,249,0.3)' }}>—</span>}
                        </td>
                        <td className="px-3 py-2.5 align-middle" style={{ borderBottom: KENAR }}>
                          <div className="flex items-center gap-1">
                            <BelgeCipi harf="H" label="Hizmet Listesi" belge={d.hizmet} goruldu={hizmetGoruldu}
                              onClick={() => d.hizmet && openPdf(d.hizmet.id, [ad, 'Hizmet Listesi', d.period].filter(Boolean).join(' · '))} />
                            <BelgeCipi harf="T" label="Tahakkuk Fişi" belge={d.tahakkuk} goruldu={tahakkukGoruldu}
                              onClick={() => d.tahakkuk && openPdf(d.tahakkuk.id, [ad, 'Tahakkuk Fişi', d.period].filter(Boolean).join(' · '))} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-middle" style={{ borderBottom: KENAR }}>
                          <IletimRozeti iletim={d.iletim} />
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
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
