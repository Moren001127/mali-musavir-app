'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { agentsApi } from '@/lib/agents';
import {
  Download, RefreshCw, FileText, Calendar, Users, CheckCircle2, XCircle,
  Loader2, AlertCircle, Receipt, Search, ChevronDown, X, Printer,
} from 'lucide-react';

type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  mihsapId?: string | null;
};

type MihsapInvoice = {
  id: string;
  mukellefId: string;
  donem: string;
  faturaTuru: string;
  belgeTuru: string;
  faturaNo: string;
  firmaUnvan?: string;
  firmaKimlikNo?: string;
  faturaTarihi: string;
  toplamTutar: number;
  storageKey?: string | null;
  downloadedAt?: string | null;
  orjDosyaTuru?: string | null;
  mihsapFileLink?: string | null;
};

const MONTHS = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
];
const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export default function FaturalarPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [selectedMukellef, setSelectedMukellef] = useState<string>('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [search, setSearch] = useState('');
  // Mükellef picker modal (KDV Kontrol / Mihsap deseni)
  const [mukellefPickerOpen, setMukellefPickerOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'ALIS' | 'SATIS'>('all');
  const [previewInvoice, setPreviewInvoice] = useState<MihsapInvoice | null>(null);
  // Toplu (tüm mükellefler) çekim durumu
  const [bulkProgress, setBulkProgress] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    errors: string[];
  } | null>(null);
  const [printing, setPrinting] = useState<'idle' | 'ALIS' | 'SATIS'>('idle');

  const ALL_SENTINEL = '__ALL__';

  const donem = `${year}-${month}`;

  // Mükellef listesi
  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-for-faturalar'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  // MIHSAP bağlantı durumu
  const { data: mihsapSession } = useQuery({
    queryKey: ['mihsap-session'],
    queryFn: () => agentsApi.mihsapSession(),
    refetchInterval: 10000,
  });

  // Faturalar
  const { data: invoices = [], isLoading: invLoading } = useQuery<MihsapInvoice[]>({
    queryKey: ['mihsap-invoices', selectedMukellef, donem],
    queryFn: () =>
      agentsApi.mihsapInvoices({
        // "__ALL__" seçiliyse mukellef filtresini gönderme → tüm mükelleflerin faturaları
        mukellefId:
          selectedMukellef && selectedMukellef !== ALL_SENTINEL
            ? selectedMukellef
            : undefined,
        donem,
        limit: 10000, // Büyük mükelleflerde 1500+ fatura olabilir; 10k güvenli üst sınır
      }),
    // Dönem varsa her zaman sorgula — mükellef seçili değilse tüm mükelleflerin
    // o ayki faturalarının birleşimi gelir.
    enabled: !!donem,
  });

  // Son çekme job'ları (progress gösterimi için)
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ['mihsap-jobs'],
    queryFn: () => agentsApi.mihsapJobs(5),
    refetchInterval: 3000,
  });

  // MIHSAP'tan çek mutation
  const fetchMut = useMutation({
    mutationFn: (body: {
      mukellefId: string;
      mukellefMihsapId: string;
      donem: string;
      faturaTuru?: 'ALIS' | 'SATIS';
      forceRefresh?: boolean;
    }) => agentsApi.mihsapFetch(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mihsap-invoices'] });
      qc.invalidateQueries({ queryKey: ['mihsap-jobs'] });
    },
  });

  // Toplu yazdırma — Sadece e-Fatura/e-Arşiv dahil; fiş ve Z raporları HARİÇ.
  // Backend tarafı filtreyi uygular, biz sadece /toplu-yazdir endpoint'ini çağırıp
  // gelen HTML'i yeni sekmede açarız. Yeni sekme kendi window.print()'i tetikler.
  const handleBulkPrint = async (tip: 'ALIS' | 'SATIS') => {
    if (!donem) return;
    setPrinting(tip);
    try {
      const resp = await api.get('/agent/mihsap/invoices/toplu-yazdir', {
        params: {
          donem,
          faturaTuru: tip,
          ...(selectedMukellef && selectedMukellef !== ALL_SENTINEL
            ? { mukellefId: selectedMukellef }
            : {}),
        },
        responseType: 'text',
        transformResponse: (d) => d,
      });
      // Sıfır kayıt olsa bile HTML'i yeni sekmede aç — backend'in döndürdüğü
      // boş sonuç sayfası gerçek belgeTuru sayımlarını ve sebebi gösterir.
      // Böylece "neden boş" sorusu kullanıcıya görünür hale gelir.
      const blob = new Blob([resp.data], { type: 'text/html; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        alert('Popup engellendi. Tarayıcı çubuğundan bu sayfaya popup izni verin.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e: any) {
      alert(`Yazdırma hazırlanamadı: ${e?.response?.data?.message || e?.message || 'hata'}`);
    } finally {
      setPrinting('idle');
    }
  };

  // Tek fatura yazdır (fiş/Z raporu dahil — manuel istek, filtre yok)
  const handleSinglePrint = async (invoiceId: string, faturaNo: string) => {
    try {
      const resp = await api.get(`/agent/mihsap/invoices/${invoiceId}/file`, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(resp.data);
      // Yeni sekmede aç + iframe sarmalayıcı ile otomatik print
      const win = window.open('', '_blank');
      if (!win) {
        alert('Popup engellendi.');
        return;
      }
      const isPdf = (resp.data as Blob).type.includes('pdf');
      win.document.write(`<!doctype html><html lang="tr"><head>
<meta charset="utf-8"><title>Yazdır · ${faturaNo.replace(/[<>&"]/g, '')}</title>
<style>
  html,body{margin:0;padding:0;background:#1a1a1a;color:#eee;font-family:system-ui,sans-serif;height:100%}
  .tb{position:sticky;top:0;background:#1a1a1a;padding:8px 14px;border-bottom:1px solid #333;display:flex;align-items:center;gap:12px}
  .tb h1{margin:0;font-size:14px;color:#c9a77c}
  .tb button{margin-left:auto;padding:6px 14px;background:#9c4656;color:#fff;border:0;border-radius:4px;font-weight:600;cursor:pointer}
  .frame{width:100%;height:calc(100vh - 42px);border:0;background:#fff}
  img.frame{object-fit:contain;display:block;margin:0 auto;max-height:calc(100vh - 42px)}
  @media print{.tb{display:none}.frame{height:auto;max-height:none}}
  @page{size:A4;margin:8mm}
</style></head>
<body>
<div class="tb"><h1>Fatura · ${faturaNo.replace(/[<>&"]/g, '')}</h1>
<button onclick="window.print()">🖨 Yazdır</button></div>
${isPdf
  ? `<iframe class="frame" src="${blobUrl}"></iframe>`
  : `<img class="frame" src="${blobUrl}" alt="">`}
<script>
  window.addEventListener('load', function(){
    var el = document.querySelector('.frame');
    if (el && el.tagName === 'IMG') {
      if (el.complete) setTimeout(function(){ window.print(); }, 300);
      else el.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 300); });
    } else if (el) {
      setTimeout(function(){ window.print(); }, 800);
    }
  });
</script>
</body></html>`);
      win.document.close();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
    } catch (e: any) {
      alert(`Yazdırma açılamadı: ${e?.response?.data?.message || e?.message || 'hata'}`);
    }
  };

  const taxpayerName = (t: Taxpayer) =>
    t.companyName ||
    `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
    t.taxNumber;

  const selectedTaxpayer = taxpayers.find((t) => t.id === selectedMukellef);

  const filteredTaxpayers = useMemo(() => {
    if (!search) return taxpayers;
    const s = search.toLowerCase();
    return taxpayers.filter(
      (t) =>
        taxpayerName(t).toLowerCase().includes(s) || t.taxNumber.includes(s),
    );
  }, [taxpayers, search]);

  // Tüm mükellefler için sıralı toplu çekim
  const handleFetchAll = async (
    faturaTuru?: 'ALIS' | 'SATIS',
    forceRefresh = false,
  ) => {
    const eligible = taxpayers.filter((t) => !!t.mihsapId);
    if (eligible.length === 0) {
      toast.error('MIHSAP ID tanımlı mükellef bulunamadı. Mükellef kartlarına Mihsap ID girin.', { duration: 8000 });
      return;
    }
    const label =
      faturaTuru === 'ALIS' ? 'alış' : faturaTuru === 'SATIS' ? 'satış' : 'alış + satış';
    const confirmMsg = forceRefresh
      ? `${eligible.length} mükellef için ${donem} dönemindeki ${label} faturaları SİLİNİP yeniden indirilecek. Emin misiniz?`
      : `${eligible.length} mükellef için ${donem} dönemindeki ${label} faturaları çekilecek. Başlansın mı?`;
    if (!confirm(confirmMsg)) return;

    const errors: string[] = [];
    setBulkProgress({ running: true, current: 0, total: eligible.length, currentName: '', errors: [] });
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      const name = taxpayerName(t);
      setBulkProgress((prev) => prev && { ...prev, current: i + 1, currentName: name });
      try {
        await agentsApi.mihsapFetch({
          mukellefId: t.id,
          mukellefMihsapId: t.mihsapId!,
          donem,
          faturaTuru,
          forceRefresh,
        });
      } catch (e: any) {
        errors.push(`${name}: ${e?.message || 'bilinmeyen hata'}`);
        setBulkProgress((prev) => prev && { ...prev, errors: [...prev.errors, `${name}: ${e?.message || 'hata'}`] });
      }
      // Peş peşe istek MIHSAP'ı yormasın diye küçük gecikme
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulkProgress((prev) => prev && { ...prev, running: false });
    qc.invalidateQueries({ queryKey: ['mihsap-invoices'] });
    qc.invalidateQueries({ queryKey: ['mihsap-jobs'] });
    if (errors.length > 0) {
      alert(`Toplu çekim bitti · ${errors.length} hata:\n\n${errors.slice(0, 10).join('\n')}`);
    }
  };

  const handleFetch = (faturaTuru?: 'ALIS' | 'SATIS', forceRefresh = false) => {
    console.log(
      `[Faturalar] handleFetch: faturaTuru=${faturaTuru} | selectedMukellef="${selectedMukellef}" | hasTaxpayer=${!!selectedTaxpayer} | mihsapId="${selectedTaxpayer?.mihsapId || ''}" | mihsapId-truthy=${!!selectedTaxpayer?.mihsapId} | donem="${donem}"`
    );
    if (selectedTaxpayer) {
      console.log('[Faturalar] selectedTaxpayer detail:', JSON.stringify(selectedTaxpayer));
    }
    // "Tümü" modu → toplu çekime yönlendir
    if (selectedMukellef === ALL_SENTINEL) {
      handleFetchAll(faturaTuru, forceRefresh);
      return;
    }
    if (!selectedTaxpayer) {
      toast.error('Lütfen bir mükellef seçin');
      return;
    }
    if (!selectedTaxpayer.mihsapId) {
      toast.error('Bu mükellef için MIHSAP ID kayıtlı değil. Mükellef düzenleme sayfasından "Otomasyon Ajanları" bölümüne Mihsap ID giriniz.', { duration: 8000 });
      return;
    }
    const label = faturaTuru === 'ALIS' ? 'alış' : faturaTuru === 'SATIS' ? 'satış' : 'tüm';
    if (forceRefresh) {
      if (!confirm(`${donem} dönemindeki ${label} faturaları silinip yeniden indirilecek. Emin misiniz?`)) return;
    }
    fetchMut.mutate({
      mukellefId: selectedTaxpayer.id,
      mukellefMihsapId: selectedTaxpayer.mihsapId,
      donem,
      faturaTuru,
      forceRefresh,
    });
  };

  const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'pending');

  const alisInvoices = invoices.filter((i) => i.faturaTuru.includes('ALIS'));
  const satisInvoices = invoices.filter((i) => i.faturaTuru.includes('SATIS'));
  const totalAlis = alisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);
  const totalSatis = satisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);

  // Tab filtresi
  const filteredInvoices = invoices.filter((i) => {
    if (tab === 'all') return true;
    return i.faturaTuru.includes(tab);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Belge Yönetimi</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Faturalar
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            {selectedMukellef && invoices.length > 0
              ? `${invoices.length} fatura · ${MONTH_NAMES[Number(month) - 1]} ${year} · ${selectedTaxpayer ? taxpayerName(selectedTaxpayer) : ''}`
              : 'MIHSAP\'tan fatura çekme ve arşiv yönetimi'}
          </p>
        </div>
        <MihsapConnectionBadge session={mihsapSession} />
      </div>

      {/* KPI Özet — mükellef seçili değilse tüm mükelleflerin toplamı */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {[
          { label: 'Toplam Fatura', value: invoices.length, sub: selectedMukellef ? `${MONTH_NAMES[Number(month)-1]} ${year}` : `Tüm mükellefler · ${MONTH_NAMES[Number(month)-1]} ${year}`, icon: Receipt },
          { label: 'Alış Faturası', value: alisInvoices.length, sub: `₺${totalAlis.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: FileText },
          { label: 'Satış Faturası', value: satisInvoices.length, sub: `₺${totalSatis.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: FileText },
          { label: 'İndirilmiş Dosya', value: invoices.filter(i=>i.storageKey).length, sub: invoices.length ? `/ ${invoices.length} fatura` : '—', icon: Download },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: '#d4b876' }}>
                <Icon size={17} />
              </div>
            </div>
            <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{label}</p>
            <p className="mt-1.5 leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', color: '#d4b876' }}>{typeof value === 'number' ? value.toLocaleString('tr-TR') : value}</p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Mükellef & Dönem seçici */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2.5">
            <span className="w-[3px] h-4 rounded-sm" style={{ background: '#d4b876' }} />
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Mükellef & Dönem Seçimi</h3>
          </div>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Mükellef picker butonu (KDV Kontrol / Mihsap deseni) */}
          <div className="md:col-span-6">
            <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <button
              type="button"
              onClick={() => setMukellefPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none flex items-center gap-2 text-left hover:brightness-110 transition"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate" style={{ color: selectedMukellef ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
                {selectedMukellef === ALL_SENTINEL
                  ? `✓ Tümü (${taxpayers.filter((t) => t.mihsapId).length} mükellef)`
                  : selectedMukellef
                  ? taxpayerName(taxpayers.find((t) => t.id === selectedMukellef)!) || 'Mükellef'
                  : 'Mükellef seç…'}
              </span>
              {selectedMukellef && (
                <span
                  onClick={(e) => { e.stopPropagation(); setSelectedMukellef(''); }}
                  className="p-0.5 rounded hover:bg-white/10"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            </button>
          </div>

          {/* Yıl */}
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Calendar size={11} className="inline mr-1" /> Yıl
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
              ))}
            </select>
          </div>

          {/* Ay */}
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>Ay</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={m} style={{ background: '#0f0d0b' }}>{MONTH_NAMES[i]}</option>
              ))}
            </select>
          </div>

          {/* Butonlar */}
          <div className="md:col-span-2 flex flex-col gap-1.5 justify-end">
            <div className="flex gap-1.5">
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch('ALIS', false)}
                className="flex-1 px-2 py-2 rounded-[9px] text-[11.5px] font-bold flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                style={{ background: 'rgba(59,130,246,0.22)', color: '#93c5fd', border: '1px solid rgba(96,165,250,0.55)', textShadow: '0 0 8px rgba(59,130,246,0.3)' }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'rgba(59,130,246,0.35)'; e.currentTarget.style.color = '#dbeafe'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.22)'; e.currentTarget.style.color = '#93c5fd'; }}
                title="Alış faturalarını çek"
              >
                <Download size={12} /> Alış Çek
              </button>
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch('SATIS', false)}
                className="flex-1 px-2 py-2 rounded-[9px] text-[11.5px] font-bold flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                style={{ background: 'rgba(34,197,94,0.22)', color: '#86efac', border: '1px solid rgba(74,222,128,0.55)', textShadow: '0 0 8px rgba(34,197,94,0.3)' }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'rgba(34,197,94,0.35)'; e.currentTarget.style.color = '#dcfce7'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.22)'; e.currentTarget.style.color = '#86efac'; }}
                title="Satış faturalarını çek"
              >
                <Download size={12} /> Satış Çek
              </button>
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch(undefined, false)}
                className="flex-1 px-2 py-2 rounded-[9px] text-[11.5px] font-bold flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#0f0d0b', boxShadow: '0 2px 10px rgba(212,184,118,0.35)' }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.boxShadow = '0 4px 16px rgba(212,184,118,0.55)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(212,184,118,0.35)'; }}
                title="Alış + Satış hepsini çek"
              >
                <Download size={12} />
                {bulkProgress?.running
                  ? `${bulkProgress.current}/${bulkProgress.total}…`
                  : fetchMut.isPending
                  ? 'Çekiliyor…'
                  : 'Hepsini Çek'}
              </button>
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch(tab === 'all' ? undefined : tab, true)}
                className="px-2.5 py-2 rounded-[9px] text-[11.5px] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(250,250,249,0.85)' }}
                title={tab === 'all' ? 'Dönemi sıfırla (tümü)' : `${tab === 'ALIS' ? 'Alış' : 'Satış'} yeniden indir`}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toplu (tüm mükellefler) çekim progress */}
      {bulkProgress && (
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: bulkProgress.running ? 'rgba(212,184,118,.08)' : 'rgba(34,197,94,.08)',
            borderColor: bulkProgress.running ? '#d4b876' : '#22c55e',
          }}
        >
          <div className="flex items-center gap-3">
            {bulkProgress.running ? (
              <Loader2 size={18} className="animate-spin" style={{ color: '#d4b876' }} />
            ) : (
              <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
            )}
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
                Toplu fatura çekimi · {bulkProgress.current} / {bulkProgress.total}
                {!bulkProgress.running && ' · TAMAMLANDI'}
              </div>
              {bulkProgress.running && bulkProgress.currentName && (
                <div className="text-xs truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  → {bulkProgress.currentName}
                </div>
              )}
              {bulkProgress.errors.length > 0 && (
                <div className="text-xs mt-1" style={{ color: '#ef4444' }}>
                  {bulkProgress.errors.length} hata
                </div>
              )}
            </div>
            {!bulkProgress.running && (
              <button
                onClick={() => setBulkProgress(null)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                Kapat
              </button>
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                background: bulkProgress.running
                  ? 'linear-gradient(90deg, #d4b876, #b8a06f)'
                  : '#22c55e',
              }}
            />
          </div>
        </div>
      )}

      {/* Aktif Job progress */}
      {activeJob && (
        <div
          className="rounded-2xl p-4 border flex items-center gap-3"
          style={{
            background: 'rgba(212,184,118,.08)',
            borderColor: '#d4b876',
          }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: '#d4b876' }} />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
              Fatura çekiliyor ({activeJob.donem})
            </div>
            <div className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
              {activeJob.fetchedCount} / {activeJob.totalCount} fatura
            </div>
          </div>
        </div>
      )}

      {/* Fatura listesi — mükellef seçili olmasa bile tüm mükelleflerin o ay toplam faturası */}
      {donem && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between flex-wrap gap-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-[3px] h-4 rounded-sm" style={{ background: '#d4b876' }} />
              <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
                {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Tüm Mükellefler'} · {MONTH_NAMES[Number(month) - 1]} {year}
              </h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Tab filtreleri */}
              <div className="flex gap-1">
                {(['all', 'ALIS', 'SATIS'] as const).map((t) => {
                  const count = t === 'all' ? invoices.length : invoices.filter(i => i.faturaTuru.includes(t)).length;
                  const active = tab === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className="px-3.5 py-1.5 rounded-[8px] text-[11.5px] font-semibold transition-all"
                      style={{
                        background: active ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)',
                        color: active ? '#d4b876' : 'rgba(250,250,249,0.55)',
                        border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      {t === 'all' ? 'Tümü' : t === 'ALIS' ? 'Alış' : 'Satış'} ({count})
                    </button>
                  );
                })}
              </div>
              {/* Toplu yazdırma — SADECE fatura (e-Fatura/e-Arşiv). Fiş ve Z raporu HARİÇ */}
              <div className="flex gap-1.5" title="Toplu yazdırma — fiş ve Z raporu otomatik hariç tutulur">
                <button
                  onClick={() => handleBulkPrint('ALIS')}
                  disabled={printing !== 'idle' || !donem}
                  className="px-3 py-1.5 rounded-[8px] text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  style={{
                    background: 'rgba(59,130,246,0.14)',
                    color: '#93c5fd',
                    border: '1px solid rgba(96,165,250,0.35)',
                  }}
                  title={selectedMukellef ? 'Bu mükellefin alış faturalarını yazdır' : 'Tüm mükelleflerin alış faturalarını yazdır'}
                >
                  {printing === 'ALIS' ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                  Toplu Alış Yazdır
                </button>
                <button
                  onClick={() => handleBulkPrint('SATIS')}
                  disabled={printing !== 'idle' || !donem}
                  className="px-3 py-1.5 rounded-[8px] text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  style={{
                    background: 'rgba(34,197,94,0.14)',
                    color: '#86efac',
                    border: '1px solid rgba(74,222,128,0.35)',
                  }}
                  title={selectedMukellef ? 'Bu mükellefin satış faturalarını yazdır' : 'Tüm mükelleflerin satış faturalarını yazdır'}
                >
                  {printing === 'SATIS' ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                  Toplu Satış Yazdır
                </button>
              </div>
            </div>
          </div>
          {invLoading ? (
            <div className="py-12 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: '#d4b876' }} />
              <span className="text-sm">Yükleniyor...</span>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Receipt size={24} style={{ color: 'rgba(250,250,249,0.35)' }} />
              </div>
              <p className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                Bu dönem için {tab === 'all' ? 'kayıtlı fatura' : tab === 'ALIS' ? 'alış faturası' : 'satış faturası'} yok
              </p>
              <p className="text-[11.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>MIHSAP'tan çekim yapın veya başka bir dönem seçin</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[10px] font-semibold uppercase"
                    style={{
                      background: 'rgba(255,255,255,0.015)',
                      color: 'rgba(250,250,249,0.4)',
                      letterSpacing: '0.12em',
                    }}
                  >
                    <th className="px-5 py-3">Tür</th>
                    <th className="px-5 py-3">Belge No</th>
                    <th className="px-5 py-3">Karşı Firma</th>
                    <th className="px-5 py-3">Tarih</th>
                    <th className="px-5 py-3 text-right">Tutar</th>
                    <th className="px-5 py-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      onPreview={setPreviewInvoice}
                      onPrint={handleSinglePrint}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Fatura görüntü önizleme modal (lightbox) */}
      {previewInvoice && (
        <InvoicePreviewModal
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
      )}

      {/* MÜKELLEF PICKER MODAL (KDV Kontrol / Mihsap / Fiş Yazdırma deseni) */}
      {mukellefPickerOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[8vh]"
          style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
          onClick={() => setMukellefPickerOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'linear-gradient(135deg, rgba(184,160,111,.08), transparent)' }}
            >
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  MIHSAP ID tanımlı {taxpayers.filter((t) => t.mihsapId).length} mükellef · {taxpayers.length} toplam
                </p>
              </div>
              <button
                onClick={() => setMukellefPickerOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5"
                style={{ color: 'rgba(250,250,249,0.45)' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}
              >
                <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Mükellef adı ara…"
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: '#fafaf9' }}
                />
                {search && (
                  <button onClick={() => setSearch('')} style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {/* Tümünü Seç satırı */}
              <button
                type="button"
                onClick={() => { setSelectedMukellef(ALL_SENTINEL); setMukellefPickerOpen(false); setSearch(''); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left transition-colors mb-1"
                style={{
                  background: selectedMukellef === ALL_SENTINEL ? 'rgba(184,160,111,.15)' : 'rgba(184,160,111,.05)',
                  color: '#fafaf9',
                  border: '1px dashed rgba(184,160,111,0.35)',
                }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #b8a06f, #8b7649)', color: '#0f0d0b' }}>
                  ✓
                </div>
                <span className="flex-1 truncate font-semibold" style={{ color: '#b8a06f' }}>
                  TÜMÜNÜ SEÇ ({taxpayers.filter((t) => t.mihsapId).length} mükellef)
                </span>
              </button>

              {filteredTaxpayers.length === 0 ? (
                <div className="text-sm p-8 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Sonuç yok</div>
              ) : (
                filteredTaxpayers.map((t: Taxpayer) => {
                  const checked = selectedMukellef === t.id;
                  const name = taxpayerName(t);
                  const initial = name.charAt(0).toUpperCase();
                  const disabled = !t.mihsapId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => { setSelectedMukellef(t.id); setMukellefPickerOpen(false); setSearch(''); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: checked ? 'rgba(184,160,111,.08)' : 'transparent', color: '#fafaf9' }}
                      onMouseEnter={(e) => { if (!checked && !disabled) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)'; }}
                      onMouseLeave={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: checked ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)',
                          color: checked ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
                        }}
                      >
                        {initial}
                      </div>
                      <span className="flex-1 truncate font-medium">{name}</span>
                      {disabled && (
                        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.15)', color: '#fda4af' }}>
                          MIHSAP ID yok
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function MihsapConnectionBadge({ session }: { session: any }) {
  const connected = session?.connected;
  return (
    <div
      className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
      style={{
        background: connected ? 'rgba(34,197,94,.12)' : 'rgba(244,63,94,.12)',
        color: connected ? '#22c55e' : '#f43f5e',
      }}
    >
      {connected ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {connected ? 'MIHSAP bağlı' : 'MIHSAP bağlı değil'}
      {connected && session?.email && (
        <span className="opacity-75 font-normal">· {session.email}</span>
      )}
    </div>
  );
}

function StatBox({ label, value, sub, color, icon: Icon }: any) {
  return (
    <div
      className="rounded-2xl p-4 border flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(212,184,118,0.08)', color: '#d4b876' }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-xs truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {label}
        </div>
        <div className="text-xl font-bold tabular-nums" style={{ color: '#d4b876' }}>
          {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
        </div>
        {sub && (
          <div className="text-xs tabular-nums truncate" style={{ color: 'rgba(250,250,249,0.35)' }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({
  invoice,
  onPreview,
  onPrint,
}: {
  invoice: MihsapInvoice;
  onPreview: (inv: MihsapInvoice) => void;
  onPrint: (id: string, faturaNo: string) => void;
}) {
  const isAlis = invoice.faturaTuru.includes('ALIS');
  const date = new Date(invoice.faturaTarihi);
  // S3'e arşivlenmiş veya MIHSAP'ın CDN linki varsa önizle
  const canPreview = !!invoice.storageKey || !!invoice.mihsapFileLink;
  return (
    <tr
      className="cursor-pointer transition-colors"
      style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}
      onClick={() => canPreview && onPreview(invoice)}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <td className="px-5 py-3">
        <span
          className="inline-block px-2 py-[2px] rounded-md text-[10px] font-bold uppercase"
          style={{
            background: isAlis ? 'rgba(96,165,250,0.12)' : 'rgba(74,222,128,0.12)',
            color: isAlis ? '#60a5fa' : '#4ade80',
            letterSpacing: '0.05em',
          }}
        >
          {isAlis ? 'ALIŞ' : 'SATIŞ'}
        </span>
        <div className="text-[10px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {invoice.belgeTuru}
        </div>
      </td>
      <td className="px-5 py-3 text-[12px] font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#d4b876' }}>{invoice.faturaNo}</td>
      <td className="px-5 py-3">
        <div className="truncate max-w-[240px] text-[13px] font-medium" style={{ color: '#fafaf9' }}>
          {invoice.firmaUnvan || '—'}
        </div>
        {invoice.firmaKimlikNo && (
          <div className="text-[10.5px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.4)' }}>
            {invoice.firmaKimlikNo}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.55)' }}>
        {date.toLocaleDateString('tr-TR')}
      </td>
      <td className="px-5 py-3 text-right text-[13px] tabular-nums font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#d4b876' }}>
        ₺{invoice.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
      </td>
      <td className="px-5 py-3 text-center">
        {canPreview ? (
          <div className="inline-flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPreview(invoice);
              }}
              className="px-2.5 py-1 rounded-md inline-flex items-center gap-1 text-[11.5px] font-semibold transition-all"
              style={{ background: 'rgba(184,160,111,0.12)', border: '1px solid rgba(184,160,111,0.25)', color: '#d4b876' }}
              title="Görüntüle"
            >
              <FileText size={12} /> Aç
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPrint(invoice.id, invoice.faturaNo);
              }}
              className="px-2.5 py-1 rounded-md inline-flex items-center gap-1 text-[11.5px] font-semibold transition-all"
              style={{ background: 'rgba(156,70,86,0.16)', border: '1px solid rgba(156,70,86,0.35)', color: '#f4a5b2' }}
              title="Bu faturayı yazdır"
            >
              <Printer size={12} /> Yazdır
            </button>
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}

/** Fatura görüntü önizleme modalı — sayfayı kaplayan lightbox */
function InvoicePreviewModal({
  invoice,
  onClose,
}: {
  invoice: MihsapInvoice;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ESC ile kapat + body scroll kilitle (listenin altından açıldığında
  // modal viewport'a sabitlensin, scroll konumu nerede olursa olsun)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Body scroll'u kilitle — mevcut scroll pozisyonunu koru
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      // Modal kapandıktan sonra scroll pozisyonunu geri yükle
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  useEffect(() => {
    // Öncelik 1: MIHSAP CDN URL'i (auth gerektirmez, direkt açılır)
    // Öncelik 2: Backend presigned URL (S3 arşivlenmiş dosyalar için)
    if (invoice.mihsapFileLink) {
      setUrl(invoice.mihsapFileLink);
      setLoading(false);
      return;
    }
    // Fallback: S3 presigned URL (backend'e sor)
    (async () => {
      try {
        setLoading(true);
        const r = await agentsApi.mihsapDownloadUrl(invoice.id);
        if (r?.url) setUrl(r.url);
        else setError(r?.error || 'Dosya bulunamadı');
      } catch (e: any) {
        setError(e?.message || 'Görüntü alınamadı');
      } finally {
        setLoading(false);
      }
    })();
  }, [invoice.id, invoice.mihsapFileLink]);

  const isAlis = invoice.faturaTuru.includes('ALIS');
  const date = new Date(invoice.faturaTarihi);

  // Portal için mount kontrolü (SSR uyumluluğu)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
        background: 'rgba(0,0,0,.85)',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst bar */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-xl"
          style={{ background: 'rgba(15,13,11,.95)', color: '#fff' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{
                background: isAlis ? 'rgba(59,130,246,.2)' : 'rgba(34,197,94,.2)',
                color: isAlis ? '#60a5fa' : '#4ade80',
              }}
            >
              {isAlis ? 'ALIŞ' : 'SATIŞ'} · {invoice.belgeTuru}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {invoice.firmaUnvan || '—'}
              </div>
              <div className="text-xs opacity-70">
                #{invoice.faturaNo} · {date.toLocaleDateString('tr-TR')} · ₺
                {invoice.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {url && (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
                >
                  <FileText size={12} /> Yeni Sekmede Aç
                </a>
                <button
                  onClick={() => {
                    // Cross-origin blob indirme: fetch → blob → download link
                    fetch(url)
                      .then(r => r.blob())
                      .then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${invoice.faturaNo || 'fatura'}.jpg`;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
                      })
                      .catch(() => window.open(url, '_blank'));
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
                >
                  <Download size={12} /> İndir
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
              title="Kapat (ESC)"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>
        {/* İçerik */}
        <div
          className="flex-1 rounded-b-xl overflow-auto flex items-center justify-center"
          style={{ background: 'rgba(15,13,11,.85)' }}
        >
          {loading && (
            <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
          )}
          {error && (
            <div className="text-center p-8" style={{ color: '#fca5a5' }}>
              <AlertCircle size={32} className="mx-auto mb-2" />
              <p className="text-sm">{error}</p>
            </div>
          )}
          {url && !loading && !error && (() => {
            // Presigned URL query string içerebilir; uzantıyı gerçek path'ten al.
            // MIHSAP her faturayı (XML e-fatura dahil) JPEG'e render ettiği için
            // çoğu durumda dosya tipi "jpg" olur.
            const cleanPath = url.split('?')[0].toLowerCase();
            const urlExt = cleanPath.split('.').pop() || '';
            if (urlExt === 'pdf') {
              return (
                <iframe
                  src={url}
                  className="w-full h-full bg-white"
                  title={invoice.faturaNo}
                />
              );
            }
            if (urlExt === 'xml') {
              return (
                <iframe
                  src={url}
                  className="w-full h-full bg-white"
                  title={invoice.faturaNo}
                />
              );
            }
            // Default: JPEG/PNG
            return (
              <img
                src={url}
                alt={invoice.faturaNo}
                className="max-w-full max-h-full object-contain"
                onError={() => setError('Görüntü yüklenemedi (dosya bozuk olabilir — yeniden çekin)')}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );

  // Modal'ı document.body'ye render et — parent transform'lar fixed positioning'i
  // bozmasın ve scroll pozisyonundan bağımsız olarak viewport'ta göründüğü gibi açılsın.
  return createPortal(modalContent, document.body);
}
