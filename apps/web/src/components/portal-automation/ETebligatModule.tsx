'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Inbox, RefreshCw, Loader2, Search, ShieldCheck, Building2, FileText, Download, ChevronDown,
  Activity, Eye, CheckCheck, AlertTriangle, Filter,
} from 'lucide-react';
import { portalAutomationApi, type BelgeSatiri } from '@/lib/portal-automation';
import { Sayfalama, sayfaSayisi } from '@/components/ui/Sayfalama';
import {
  ALAN_STILI, GOLD, METIN, TON, GeceHataModali, IletimRozeti, MukellefSecici, PdfOnizlemeModali, TebligRozeti,
  fmtTrTarih, mukellefAdi, useGecikmeliDeger, useSayfaAdresi, useSuzgecSayfaSifirla, type PdfModalDurumu,
} from './belge-ortak';

const BELGE_TURU = 'E_TEBLIGAT';
const SAYFA_ANAHTARI = 'etebligat-sayfa';

// Durum süzgeci (sunucuda): sözleşme §1 `durum`.
const DURUMLAR: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tümü' },
  { value: 'teblig_yaklasan', label: 'Tebliğ yaklaşan' },
  { value: 'teblig_edildi', label: 'Tebliğ edildi' },
  { value: 'goruntulenmemis', label: 'Görüntülenmemiş' },
];

function Kpi({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; onClick?: () => void }) {
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
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: METIN, lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</div>}
    </div>
  );
}

// useSearchParams (adres çubuğu sayfa/boyut) için Suspense sınırı.
export default function ETebligatModule() {
  return (
    <Suspense fallback={<div className="px-3 py-10 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</div>}>
      <ETebligatModuleIc />
    </Suspense>
  );
}

function ETebligatModuleIc() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [durum, setDurum] = useState<string>('');
  const [pdfModal, setPdfModal] = useState<PdfModalDurumu>(null);
  const [showErrors, setShowErrors] = useState(false);
  // Bu oturumda görüntülenenler (buton anında yeşile dönsün; kalıcısı backend viewedAt)
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());

  // Sayfa/boyut adres çubuğunda (?sayfa=&boyut=); arama 300 ms gecikmeli; süzgeç değişince sayfa 1.
  const { sayfa, boyut, setSayfa, setBoyut } = useSayfaAdresi(50);
  const aramaGecikmeli = useGecikmeliDeger(search.trim(), 300);
  const etkinSayfa = useSuzgecSayfaSifirla(JSON.stringify([aramaGecikmeli, taxpayerId, durum]), sayfa, setSayfa);

  const docsQuery = useQuery({
    queryKey: [SAYFA_ANAHTARI, { taxpayerId, search: aramaGecikmeli, durum, page: etkinSayfa, pageSize: boyut }],
    queryFn: () => portalAutomationApi.documentsSayfa({
      belgeTuru: BELGE_TURU,
      taxpayerId: taxpayerId || undefined,
      search: aramaGecikmeli || undefined,
      durum: durum || undefined,
      page: etkinSayfa,
      pageSize: boyut,
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const summaryQuery = useQuery({
    queryKey: ['etebligat-summary'],
    queryFn: () => portalAutomationApi.summary(),
    refetchInterval: 30_000,
  });
  // Mükellef seçici listesi sunucudan (belgesi olanlar ∪ vergi dairesi şifresi olanlar).
  const mukellefQuery = useQuery({
    queryKey: ['etebligat-mukellefler'],
    queryFn: () => portalAutomationApi.documentsMukellefler({ belgeTuru: BELGE_TURU }),
    staleTime: 5 * 60_000,
  });

  const rows: BelgeSatiri[] = docsQuery.data?.rows || [];
  const toplam = docsQuery.data?.total ?? 0;
  const summary = summaryQuery.data;
  const mukellefler = mukellefQuery.data?.rows || [];
  const suzgecVar = !!(aramaGecikmeli || taxpayerId || durum);

  // Adres çubuğundan gelen sayfa toplamı aşıyorsa son sayfaya çek (placeholder verisiyle değil, gerçek yanıtla).
  useEffect(() => {
    if (docsQuery.isPlaceholderData || docsQuery.data === undefined) return;
    const son = sayfaSayisi(docsQuery.data.total, boyut);
    if (sayfa > son) setSayfa(son);
  }, [docsQuery.data, docsQuery.isPlaceholderData, sayfa, boyut, setSayfa]);

  const yenile = () => {
    qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] });
    qc.invalidateQueries({ queryKey: ['etebligat-summary'] });
    qc.invalidateQueries({ queryKey: ['etebligat-mukellefler'] });
  };

  // "Tümünü Görüntüle": sayfadaki PDF'li + henüz görüntülenmemiş (kırmızı) tebligatları topluca işaretle.
  const markAllMut = useMutation({
    mutationFn: (ids: string[]) => portalAutomationApi.markDocumentsViewed({ ids }),
    onMutate: (ids: string[]) => {
      setViewedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; });
    },
    onSuccess: (d) => {
      toast.success(`${d.updated} tebligat görüntülendi olarak işaretlendi.`);
      qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] });
    },
    onError: () => toast.error('İşaretlenemedi'),
  });
  const markAll = () => {
    const ids = rows.filter((d) => d.pdfVar && !d.viewedAt && !viewedIds.has(d.id)).map((d) => d.id);
    if (!ids.length) { toast.info('Bu sayfada görüntülenecek (kırmızı) tebligat yok.'); return; }
    markAllMut.mutate(ids);
  };

  const sorgulaMut = useMutation({
    mutationFn: () => portalAutomationApi.manualRun({
      jobTypes: ['E_TEBLIGAT_CHECK'],
      taxpayerIds: taxpayerId ? [taxpayerId] : [],
      force: true,
    }),
    onSuccess: (d) => {
      const n = d.created?.length || 0;
      toast.success(n > 0 ? `${n} mükellef için e-Tebligat sorgusu kuyruğa alındı.` : (d.message || 'Sorgu kuyruğa alındı.'));
      if (d.skipped?.length) toast.info(`${d.skipped.length} mükellef atlandı (şifre yok / zaten kuyrukta).`);
      setTimeout(yenile, 1500);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Sorgu başlatılamadı'),
  });

  const openPdf = async (d: BelgeSatiri) => {
    try {
      const { url } = await portalAutomationApi.documentViewUrl(d.id);
      const baslik = [mukellefAdi(d.taxpayer), d.title, d.referenceNo].filter(Boolean).join(' · ');
      setPdfModal({ url, title: baslik || 'e-Tebligat' });
      // anında yeşile dön + kalıcı işaret backend'de damgalandı
      setViewedIds((prev) => { const n = new Set(prev); n.add(d.id); return n; });
      qc.invalidateQueries({ queryKey: [SAYFA_ANAHTARI] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Belge açılamadı');
    }
  };

  const cellBorder = '1px solid rgba(255,255,255,0.06)';
  const aktifIs = summary?.stats?.activeJobs ?? 0;
  const hataSayisi = summary?.stats?.tebligatErrorCount ?? 0;
  const buHaftaYeni = summary?.stats?.tebligat7d ?? 0;
  const buHaftaTeblig = summary?.stats?.tebligatBuHaftaTeblig ?? 0;
  // 3 gece kuralıyla sorgu dışı kalan vergi dairesi şifreleri.
  const sifreBekleyen = useMemo(
    () => (summary?.credentialsBlocked || []).filter((s) => s.provider === 'GIB_IVD'),
    [summary?.credentialsBlocked],
  );
  const hataKartiTiklanir = hataSayisi > 0 || sifreBekleyen.length > 0;

  return (
    <div className="space-y-4">
      {/* ── KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Inbox size={16} />} label="Toplam e-Tebligat" value={String(summary?.stats?.tebligatTotal ?? toplam)} sub="kayıtlı tebligat" />
        {/* "Bu hafta yeni" + "Bu hafta tebliğ sayılacak" tek kartta: "8 yeni · 3 tebliğ sayılacak" */}
        <Kpi
          icon={<Activity size={16} />}
          label="Bu hafta"
          value={(
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <span>{buHaftaYeni} <span className="text-[12px] font-normal" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'var(--font-body, Inter), system-ui, sans-serif' }}>yeni</span></span>
              <span className="text-[12px] font-normal" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>
              <span style={{ color: buHaftaTeblig > 0 ? TON.sari.fg : METIN }}>
                {buHaftaTeblig} <span className="text-[12px] font-normal" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'var(--font-body, Inter), system-ui, sans-serif' }}>tebliğ sayılacak</span>
              </span>
            </span>
          )}
          sub="son 7 gün gönderilen · 7 gün içinde tebliğ sayılacak"
        />
        <Kpi icon={<ShieldCheck size={16} />} label="Şifreli mükellef" value={String(summary?.credentials?.eTebligatTaxpayerCount ?? 0)} sub="vergi dairesi şifresi" />
        <Kpi
          icon={<AlertTriangle size={16} />}
          label="Gece sorgu hatası"
          value={String(hataSayisi)}
          sub={sifreBekleyen.length > 0 ? `${sifreBekleyen.length} şifre bekliyor · görmek için tıkla` : hataSayisi > 0 ? 'görmek için tıkla' : 'son sorguda hata yok'}
          onClick={hataKartiTiklanir ? () => setShowErrors(true) : undefined}
        />
      </div>

      {/* ── Tek şerit araç çubuğu: arama · mükellef · durum · sağda düğmeler ── */}
      <div className="rounded-2xl border p-3.5 flex flex-wrap items-center gap-2" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Belge no, kurum veya mükellef ara…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[10px] text-[13px] outline-none border"
            style={ALAN_STILI}
          />
        </div>
        <MukellefSecici value={taxpayerId} onChange={setTaxpayerId} rows={mukellefler} yukleniyor={mukellefQuery.isLoading} className="min-w-[190px] max-w-[240px]" />
        <div className="relative">
          <select
            value={durum}
            onChange={(e) => setDurum(e.target.value)}
            aria-label="Durum"
            className="h-[38px] pl-9 pr-8 rounded-[10px] text-[13px] outline-none border appearance-none min-w-[150px]"
            style={ALAN_STILI}
          >
            {DURUMLAR.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.45)' }} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={markAll}
            disabled={markAllMut.isPending}
            title="Sayfadaki tüm tebligatları görüntülendi (yeşil) işaretle"
            className="h-[38px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border disabled:opacity-50"
            style={{ background: 'rgba(95,207,142,0.12)', borderColor: 'rgba(95,207,142,0.35)', color: '#5fcf8e' }}
          >
            {markAllMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Tümünü Görüntüle
          </button>
          <button
            onClick={yenile}
            className="h-[38px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center gap-1.5 border"
            style={ALAN_STILI}
          >
            <RefreshCw size={14} className={docsQuery.isFetching ? 'animate-spin' : ''} /> Yenile
          </button>
          <button
            onClick={() => sorgulaMut.mutate()}
            disabled={sorgulaMut.isPending}
            className="h-[38px] px-4 rounded-[10px] text-[13px] font-bold flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' }}
          >
            {sorgulaMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula'}
          </button>
        </div>
      </div>

      {/* ── Tablo ── */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(0,0,0,0.18)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1020 }}>
            <colgroup>
              <col />
              <col style={{ width: 160 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 124 }} />
              <col style={{ width: 52 }} />
            </colgroup>
            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
              <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
                {['Mükellef', 'Gönderen Kurum', 'Belge Türü', 'Belge No', 'Gönderim', 'Tebliğ', 'İletim', 'Belge'].map((h, i) => (
                  <th key={h} className={`px-2.5 py-2.5 font-semibold whitespace-nowrap ${i >= 4 ? 'text-center' : 'text-left'}`} style={{ borderBottom: cellBorder }}>{h}</th>
                ))}
              </tr>
            </thead>
            {/* Sayfa geçişinde eski satırlar hafif soluk kalır (titreme yok); yeni yanıt gelince yerini alır. */}
            <tbody style={{ color: 'rgba(250,250,249,0.88)', opacity: docsQuery.isPlaceholderData ? 0.55 : 1, transition: 'opacity .15s' }}>
              {docsQuery.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}><Loader2 size={18} className="animate-spin inline" /> Yükleniyor…</td></tr>
              )}
              {docsQuery.isError && !docsQuery.isLoading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center" style={{ color: '#ef9a9a' }}>Liste alınamadı. "Yenile" ile tekrar deneyin.</td></tr>
              )}
              {!docsQuery.isLoading && !docsQuery.isError && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <Inbox size={26} className="inline mb-2 opacity-50" /><br />
                  {!suzgecVar ? 'Henüz e-Tebligat kaydı yok. "Şimdi sorgula" ile çekin ya da gece otomatik gelsin.' : 'Süzgece uyan tebligat yok.'}
                </td></tr>
              )}
              {rows.map((d) => {
                const o = d.ozet || {};
                const goruldu = !!d.viewedAt || viewedIds.has(d.id);
                const renk = goruldu
                  ? { bg: 'rgba(95,207,142,0.1)', bd: 'rgba(95,207,142,0.32)', fg: '#5fcf8e' }   // yeşil (görüntülendi)
                  : { bg: 'rgba(239,107,107,0.12)', bd: 'rgba(239,107,107,0.45)', fg: '#ef6b6b' }; // kırmızı (yeni)
                return (
                  <tr key={d.id} className="hover:bg-white/[0.02]">
                    <td className="px-2.5 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <div className="font-semibold" style={{ color: METIN }}>{mukellefAdi(d.taxpayer)}</div>
                      {d.taxpayer?.taxNumber && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{d.taxpayer.taxNumber}</div>}
                    </td>
                    <td className="px-2.5 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <div className="flex items-start gap-1.5">
                        <Building2 size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }} />
                        <div>
                          <div>{o.kurumAciklama || '—'}</div>
                          {o.altKurum && <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{o.altKurum}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 align-top" style={{ borderBottom: cellBorder }}>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
                        <FileText size={11} /> {d.title}
                      </span>
                    </td>
                    <td className="px-2.5 py-2.5 align-top font-mono text-[11.5px]" style={{ borderBottom: cellBorder, color: METIN }}>{d.referenceNo || '—'}</td>
                    <td className="px-2.5 py-2.5 align-top text-center whitespace-nowrap tabular-nums" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.7)' }}>{fmtTrTarih(o.gonderimZamani || d.issuedAt)}</td>
                    <td className="px-2.5 py-2.5 align-top text-center whitespace-nowrap tabular-nums" style={{ borderBottom: cellBorder, color: 'rgba(250,250,249,0.7)' }}>
                      <div>{fmtTrTarih(o.tebligZamani || o.tebligTarihi || d.receivedAt)}</div>
                      <div className="mt-1 flex justify-center"><TebligRozeti durum={o.tebligDurumu} tebligTarihi={o.tebligTarihi} sar /></div>
                    </td>
                    <td className="px-2.5 py-2.5 align-top text-center" style={{ borderBottom: cellBorder }}>
                      <IletimRozeti iletim={d.iletim} />
                    </td>
                    <td className="px-2.5 py-2.5 align-top text-center" style={{ borderBottom: cellBorder }}>
                      {d.pdfVar ? (
                        <button
                          onClick={() => openPdf(d)}
                          title={goruldu ? 'Görüntülendi — tekrar aç' : 'Yeni — henüz görüntülenmedi (aç)'}
                          aria-label="Belgeyi görüntüle"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:brightness-125 transition"
                          style={{ background: renk.bg, border: `1px solid ${renk.bd}`, color: renk.fg }}
                        >
                          <Eye size={14} />
                        </button>
                      ) : (
                        <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>bekliyor</span>
                      )}
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
          birim="tebligat"
          yukleniyor={docsQuery.isFetching && docsQuery.isPlaceholderData}
        />
      </div>

      <PdfOnizlemeModali modal={pdfModal} onClose={() => setPdfModal(null)} />

      <GeceHataModali
        acik={showErrors}
        onClose={() => setShowErrors(false)}
        hatalar={summary?.stats?.tebligatErrors || []}
        sifreBekleyen={sifreBekleyen}
        altNot='Son 24 saatte e-Tebligat sorgusu başarısız olan mükellefler. Mükellefi seçip "Bu mükellefi sorgula" ile tekrar deneyebilirsiniz.'
      />
    </div>
  );
}
