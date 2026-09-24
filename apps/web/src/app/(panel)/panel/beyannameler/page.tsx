'use client';
import { portalStyle, portalPaint } from '@/lib/portal-theme';
import './beyannameler-white.css';


import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  akilliBildirimApi,
  beyanKayitlariApi,
  beyanKaydiMukellefAdi,
  BEYAN_GONDER_MAX_ID,
  type BeyanBelgeSuzgec,
  type BeyanGonderSonucu,
  type BeyanIletimSuzgec,
  type BeyanKaydi,
  type BeyanSayfaParams,
  type IletimKanal,
  type ImportResult,
} from '@/lib/beyan-kayitlari';
import { type PortalJob, portalAutomationApi } from '@/lib/portal-automation';
import { api } from '@/lib/api';
import PortalAutomationPanel from '@/components/portal-automation/PortalAutomationPanel';
import { Sayfalama, boyutParamOku, sayfaParamOku, sayfaSayisi, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import Link from 'next/link';
import {
  Search, Upload, Download, FileText, Trash2, Printer,
  CheckCircle2, AlertCircle, FileQuestion, Loader2, X as IconX,
  FolderUp, FileX2, Archive, Sparkles, Mail, MessageCircle,
  Filter, CalendarDays, UserRound, RotateCcw, KeyRound, Send, FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { BeyanSatiri } from './_components/BeyanSatiri';
import { GonderimOnayKutusu } from './_components/GonderimOnayKutusu';
import {
  FILTER_KEYS, type FilterKey, type BeyanDocKind,
  beyanMahiyeti, beyanTipiParam, declarationTypeCode, declarationTypeLabel, dosyaAdiTemizle,
  fmtCurrency, fmtDate, fmtDateTime, fmtDonem, fmtDonemHattat, lastThreeDaysRange, parcala,
  portalJobProgress, portalJobStatus,
} from './_components/beyan-yardimcilar';

const GOLD = '#d4b876';
// Süzgeç bandı kutu stili — e-Defter seçici bandıyla aynı dil (tek zemin, ince kenar, altın ok).
const SUZGEC_KUTU: CSSProperties = { height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' };
const VARSAYILAN_BOYUT: SayfaBoyutu = 50;
/** CSV dışa aktarımda sunucudan tek seferde istenen en çok kayıt (sözleşme §4: ≤1000). */
const CSV_TAVAN = 1000;

type PdfPreview = {
  url: string;
  title: string;
  subtitle: string;
  docKey: string;
};
type GonderimIstegi = { channel: IletimKanal; kayitlar: BeyanKaydi[] };

export default function BeyannamelerPage() {
  // useSearchParams statik ön-derlemede Suspense sınırı ister (Next 15) — sayfa/boyut adres çubuğunda tutuluyor.
  return (
    <Suspense fallback={null}>
      <BeyannamelerIcerik />
    </Suspense>
  );
}

function BeyannamelerIcerik() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ---- Sayfa / boyut adres çubuğunda: ?sayfa=2&boyut=50 (geri tuşu çalışır) ----
  const sayfa = sayfaParamOku(searchParams.get('sayfa'));
  const boyut = boyutParamOku(searchParams.get('boyut'), VARSAYILAN_BOYUT);
  const adresYaz = useCallback((yeni: { sayfa?: number; boyut?: SayfaBoyutu }) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('sayfa', String(yeni.sayfa ?? sayfaParamOku(searchParams.get('sayfa'))));
    q.set('boyut', String(yeni.boyut ?? boyutParamOku(searchParams.get('boyut'), VARSAYILAN_BOYUT)));
    const hedef = `${pathname}?${q.toString()}`;
    if (hedef !== `${pathname}?${searchParams.toString()}`) router.replace(hedef, { scroll: false });
  }, [router, pathname, searchParams]);
  const adresYazRef = useRef(adresYaz);
  adresYazRef.current = adresYaz;
  const ilkSayfa = () => adresYaz({ sayfa: 1 });

  // ---- Süzgeçler (hepsi sunucuya gider; değişince 1. sayfa) ----
  const [search, setSearch] = useState('');
  const [searchGecikmeli, setSearchGecikmeli] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterKey>('all');
  const [docFilter, setDocFilter] = useState<BeyanBelgeSuzgec>('all');
  const [iletimFilter, setIletimFilter] = useState<BeyanIletimSuzgec>('all');
  const [selectedTaxpayer, setSelectedTaxpayer] = useState('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const suzgec = <T,>(set: (v: T) => void) => (v: T) => { set(v); ilkSayfa(); };

  // Arama 300 ms gecikmeli; metin gerçekten değişince 1. sayfaya dön.
  useEffect(() => {
    const yeni = search.trim();
    if (yeni === searchGecikmeli) return;
    const t = setTimeout(() => {
      setSearchGecikmeli(yeni);
      adresYazRef.current({ sayfa: 1 });
    }, 300);
    return () => clearTimeout(t);
  }, [search, searchGecikmeli]);

  const defaultPullRange = useMemo(() => lastThreeDaysRange(), []);
  const [pullFrom, setPullFrom] = useState(defaultPullRange.from);
  const [pullTo, setPullTo] = useState(defaultPullRange.to);

  // ---- Seçim: kayıt id'si; sayfa değişse de dursun. Kayıt nesneleri (iletişim/PDF kontrolü için) ayrı haritada. ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const seciliKayitlarRef = useRef(new Map<string, BeyanKaydi>());
  const [viewedDocKeys, setViewedDocKeys] = useState<Set<string>>(() => new Set());
  const [indirilenler, setIndirilenler] = useState<Set<string>>(() => new Set());
  const [gonderimIstegi, setGonderimIstegi] = useState<GonderimIstegi | null>(null);
  const [csvYaziliyor, setCsvYaziliyor] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<PdfPreview | null>(null);
  const [previewPortalReady, setPreviewPortalReady] = useState(false);
  const pdfPreviewUrlRef = useRef<string | null>(null);

  const { data: portalSummary } = useQuery({
    queryKey: ['portal-automation-summary', 'beyanname-page'],
    queryFn: () => portalAutomationApi.summary(),
    // Aktif iş varken 3 sn (ilerleme için), boştayken 15 sn — sayfa açık dururken sunucuyu yormasın.
    refetchInterval: (query) => {
      const job = query.state.data?.latestJobs?.find((j) => j.jobType === 'EBEYANNAME_DAILY_DOWNLOAD' || j.jobType === 'EBEYAN_NEW_DOWNLOAD');
      return job?.status === 'running' || job?.status === 'pending' ? 3000 : 15000;
    },
  });

  // Son iş: eski (EBEYANNAME_DAILY_DOWNLOAD) VEYA yeni e-Beyan (EBEYAN_NEW_DOWNLOAD) —
  // hangisi daha yeniyse onun ilerlemesini göster (latestJobs recency sırasında).
  const latestBeyanJob = portalSummary?.latestJobs?.find((job) => job.jobType === 'EBEYANNAME_DAILY_DOWNLOAD' || job.jobType === 'EBEYAN_NEW_DOWNLOAD');
  const isBeyanJobRunning = latestBeyanJob?.status === 'running';
  const isBeyanJobActive = latestBeyanJob?.status === 'running' || latestBeyanJob?.status === 'pending';

  // Son başarılı çekim — iş bittiğinde durum şeridinde tarih/saat olarak durur
  // (Muzaffer Bey, 2026-09-24: "çekimin en son ne zaman olduğu görünsün").
  const sonCekimMetni = !isBeyanJobActive && latestBeyanJob?.status === 'done'
    ? fmtDateTime(latestBeyanJob.createdAt)
    : '';

  // ---- Sunucu sayfalı liste (GET /beyan-kayitlari?page=…) — sözleşme §4 ----
  const sorgu = useMemo<BeyanSayfaParams>(() => ({
    page: sayfa,
    pageSize: boyut,
    taxpayerId: selectedTaxpayer !== 'all' ? selectedTaxpayer : undefined,
    beyanTipi: beyanTipiParam(typeFilter),
    donemBas: periodStart || undefined,
    donemBit: periodEnd || undefined,
    belge: docFilter !== 'all' ? docFilter : undefined,
    iletim: iletimFilter !== 'all' ? iletimFilter : undefined,
    search: searchGecikmeli || undefined,
    sirala: 'yeni',
  }), [sayfa, boyut, selectedTaxpayer, typeFilter, periodStart, periodEnd, docFilter, iletimFilter, searchGecikmeli]);

  const { data: sayfaVerisi, isLoading, isFetching } = useQuery({
    queryKey: ['beyan-kayitlari', 'sayfa', sorgu],
    queryFn: () => beyanKayitlariApi.listSayfa(sorgu),
    placeholderData: keepPreviousData,
    // İş sürerken 5 sn'de bir yalnız bu sayfa + toplam yenilenir (ucuz).
    refetchInterval: isBeyanJobRunning ? 5000 : false,
  });
  const rows = sayfaVerisi?.rows ?? [];
  const toplam = sayfaVerisi?.total ?? 0;
  const suzgecAktif = !!(searchGecikmeli || typeFilter !== 'all' || docFilter !== 'all' || iletimFilter !== 'all' || selectedTaxpayer !== 'all' || periodStart || periodEnd);

  // Adres çubuğundaki sayfa toplamı aşıyorsa (kayıt silindi / süzgeç daraldı) son sayfaya çek.
  useEffect(() => {
    if (isFetching || !sayfaVerisi) return;
    const son = sayfaSayisi(toplam, boyut);
    if (sayfa > son) adresYazRef.current({ sayfa: son });
  }, [isFetching, sayfaVerisi, toplam, boyut, sayfa]);

  // Seçili kayıtların taze nesnelerini tut (iletim rozeti / PDF durumu yenilenince).
  useEffect(() => {
    for (const r of rows) if (seciliKayitlarRef.current.has(r.id)) seciliKayitlarRef.current.set(r.id, r);
  }, [rows]);

  useEffect(() => {
    // Yalnız iş BİTTİĞİNDE (done/failed/cancelled) tazele. İş sırasında zaten 5 sn'lik refetchInterval var.
    if (!latestBeyanJob) return;
    const terminal = latestBeyanJob.status === 'done' || latestBeyanJob.status === 'failed' || latestBeyanJob.status === 'cancelled';
    if (!terminal) return;
    qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
    qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
  }, [qc, latestBeyanJob?.id, latestBeyanJob?.status]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    setPreviewPortalReady(true);
  }, []);

  useEffect(() => {
    if (!pdfPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pdfPreview]);

  const pullMut = useMutation({
    mutationFn: (force?: boolean) => portalAutomationApi.manualRun({
      scope: 'beyanname',
      jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD'],
      dateFrom: pullFrom,
      dateTo: pullTo,
      force: force === true,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      const created = res.created?.length || 0;
      if (created > 0) {
        toast.success(`${created} e-Beyanname işi kuyruğa alındı${res.runnerWake ? ' ve sunucu uyandırıldı' : ''}.`);
      } else {
        toast.info(res.message || 'Yeni e-Beyanname işi oluşmadı.');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'e-Beyanname çekme işi başlatılamadı'),
  });

  // YENİ e-Beyan sistemi (ebeyan.gib.gov.tr) — AYRI iş. Eski sistemle karışmaz.
  const pullNewMut = useMutation({
    mutationFn: (force?: boolean) => portalAutomationApi.manualRun({
      jobTypes: ['EBEYAN_NEW_DOWNLOAD'],
      dateFrom: pullFrom,
      dateTo: pullTo,
      force: force === true,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      const created = res.created?.length || 0;
      if (created > 0) {
        toast.success(`Yeni e-Beyan işi kuyruğa alındı${res.runnerWake ? ' ve sunucu uyandırıldı' : ''}.`);
      } else {
        toast.info(res.message || 'Yeni e-Beyan işi oluşmadı.');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Yeni e-Beyan çekme işi başlatılamadı'),
  });

  const cancelJobMut = useMutation({
    mutationFn: (id: string) => portalAutomationApi.cancelJob(id, 'Kullanıcı Beyannameler ekranından iptal etti'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.info('e-Beyanname işi iptal edildi');
    },
    onError: (e: any) => toast.error(e?.message || 'İş iptal edilemedi'),
  });

  // Mükellef seçici: TÜM aktif mükellefler /taxpayers'tan (liste sayfalı olduğu için kayıtlardan türetilmez).
  const { data: allTaxpayers = [] } = useQuery<any[]>({
    queryKey: ['taxpayers-for-beyanname-filter'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data || []),
  });

  const taxpayerOptions = useMemo(() => {
    return (allTaxpayers || [])
      .map((t: any) => ({
        id: String(t.id),
        name: t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)',
        taxNumber: t.taxNumber || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [allTaxpayers]);

  // Akıllı Bildirim VERGI ayarı — yalnız onay kutusu açıkken okunur (TEST MODU uyarısı için).
  const { data: bildirimAyarlari } = useQuery({
    queryKey: ['akilli-bildirim-settings'],
    queryFn: () => akilliBildirimApi.settings(),
    enabled: !!gonderimIstegi,
    staleTime: 60_000,
  });
  const vergiTestModu = useMemo<boolean | null>(() => {
    const ayar = Array.isArray(bildirimAyarlari) ? bildirimAyarlari.find((s) => s.kategori === 'VERGI') : null;
    return ayar ? !!ayar.testMode : null;
  }, [bildirimAyarlari]);

  // ---- Seçim yardımcıları ----
  const seciliKayitlar = useMemo(
    () => Array.from(selectedIds).map((id) => seciliKayitlarRef.current.get(id)).filter((k): k is BeyanKaydi => !!k),
    [selectedIds],
  );
  const kaydiSec = (row: BeyanKaydi, secili: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (secili) { next.add(row.id); seciliKayitlarRef.current.set(row.id, row); }
      else { next.delete(row.id); seciliKayitlarRef.current.delete(row.id); }
      return next;
    });
  };
  const sayfayiSec = (secili: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (secili) { next.add(r.id); seciliKayitlarRef.current.set(r.id, r); }
        else { next.delete(r.id); seciliKayitlarRef.current.delete(r.id); }
      }
      return next;
    });
  };
  const secimiTemizle = (ids?: string[]) => {
    setSelectedIds((prev) => {
      if (!ids) { seciliKayitlarRef.current.clear(); return new Set(); }
      const next = new Set(prev);
      for (const id of ids) { next.delete(id); seciliKayitlarRef.current.delete(id); }
      return next;
    });
  };

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => beyanKayitlariApi.bulkDeleteIds(ids),
    onSuccess: (res, ids) => {
      secimiTemizle(ids);
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success(`${res.deleted} kayıt silindi`);
    },
    onError: (e: any) => toast.error(e?.message || 'Kayıtlar silinemedi'),
  });

  // ---- GERÇEK gönderim: POST /beyan-kayitlari/gonder (sözleşme §5; tek istekte ≤50 id) ----
  const gonderMut = useMutation({
    mutationFn: async ({ ids, channel }: { ids: string[]; channel: IletimKanal }) => {
      const results: BeyanGonderSonucu[] = [];
      let testMode = false;
      for (const parca of parcala(ids, BEYAN_GONDER_MAX_ID)) {
        const r = await beyanKayitlariApi.gonder({ ids: parca, channel });
        testMode = testMode || !!r.testMode;
        results.push(...(r.results || []));
      }
      return { testMode, results };
    },
    onSuccess: (res, vars) => {
      const kanal = vars.channel === 'EMAIL' ? 'E-posta' : 'WhatsApp';
      const gonderilen = res.results.filter((r) => r.status === 'SENT');
      const hatali = res.results.filter((r) => r.status === 'FAILED');
      if (gonderilen.length) {
        const kayitSayisi = gonderilen.reduce((a, r) => a + (r.kayitSayisi || 0), 0);
        toast.success(`${kanal}: ${gonderilen.length} mükellefe gönderildi (${kayitSayisi} kayıt)${res.testMode ? ' — TEST MODU: test alıcısına gitti' : ''}`);
      }
      if (hatali.length) {
        const ilk = hatali.slice(0, 3).map((r) => `${r.unvan}${r.error ? ` (${r.error})` : ''}`).join(', ');
        toast.error(`${kanal}: ${hatali.length} mükellefe gönderilemedi — ${ilk}${hatali.length > 3 ? '…' : ''}`, { duration: 9000 });
      }
      if (!gonderilen.length && !hatali.length) toast.info('Gönderilecek kayıt bulunamadı');
      // Gönderilen mükelleflerin kayıtları seçimden düşer; liste yenilenir (iletim rozetleri).
      const gidenMukellefler = new Set(gonderilen.map((r) => r.taxpayerId));
      const gidenIdler = vars.ids.filter((id) => {
        const k = seciliKayitlarRef.current.get(id);
        return k ? gidenMukellefler.has(k.taxpayerId) : false;
      });
      secimiTemizle(gidenIdler);
      setGonderimIstegi(null);
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Gönderim başarısız'),
  });

  const gonderimBaslat = (channel: IletimKanal, kayitlar: BeyanKaydi[]) => {
    if (!kayitlar.length) { toast.warning('Seçili kayıt yok'); return; }
    // Onay kutusu açılırken satır nesneleri haritada olsun (tek satırdan gelen istekte seçim olmayabilir).
    for (const k of kayitlar) if (!seciliKayitlarRef.current.has(k.id)) seciliKayitlarRef.current.set(k.id, k);
    setGonderimIstegi({ channel, kayitlar });
  };

  const clearFilters = () => {
    setSearch('');
    setSearchGecikmeli('');
    setTypeFilter('all');
    setDocFilter('all');
    setIletimFilter('all');
    setSelectedTaxpayer('all');
    setPeriodStart('');
    setPeriodEnd('');
    ilkSayfa();
  };

  // ---- PDF önizleme / indirme ----
  const previewTitle = (row: BeyanKaydi, kind: BeyanDocKind) =>
    `${beyanKaydiMukellefAdi(row)} - ${declarationTypeCode(row)} - ${fmtDonemHattat(row.donem)} - ${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'}`;

  const closePdfPreview = () => {
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    pdfPreviewUrlRef.current = null;
    setPdfPreview(null);
  };

  const showPdfPreview = (blob: Blob, row: BeyanKaydi, kind: BeyanDocKind) => {
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    const url = URL.createObjectURL(blob);
    const docKey = `${row.id}:${kind}`;
    pdfPreviewUrlRef.current = url;
    setViewedDocKeys((prev) => new Set(prev).add(docKey));
    setPdfPreview({
      url,
      docKey,
      title: previewTitle(row, kind),
      subtitle: kind === 'tahakkuk'
        ? `${beyanMahiyeti(row) === 'DUZELTME' ? 'DÜZELTME' : 'ASIL'} · ${fmtDate(row.beyanTarihi || row.createdAt)} · ${fmtCurrency(row.tahakkukTutari)}`
        : `${beyanMahiyeti(row) === 'DUZELTME' ? 'DÜZELTME' : 'ASIL'} · ${fmtDate(row.beyanTarihi || row.createdAt)}`,
    });
  };

  const fetchDocumentBlob = async (row: BeyanKaydi, kind: BeyanDocKind) => {
    const hasFile = kind === 'beyanname' ? !!row.beyannameUrl : !!row.pdfUrl;
    if (!hasFile) return null;
    const endpoint = kind === 'beyanname'
      ? `/beyan-kayitlari/${row.id}/beyanname`
      : `/beyan-kayitlari/${row.id}/pdf`;
    const res = await api.get(endpoint, { responseType: 'blob' });
    return res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
  };

  const openDocumentBlob = async (row: BeyanKaydi, kind: BeyanDocKind = 'beyanname') => {
    const blob = await fetchDocumentBlob(row, kind).catch((err) => {
      toast.error(err?.message || 'PDF açılamadı');
      return null;
    });
    if (!blob) {
      toast.warning(`${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'} PDF yok`);
      return;
    }
    showPdfPreview(blob, row, kind);
  };

  const downloadDocument = async (row: BeyanKaydi, kind: BeyanDocKind) => {
    const blob = await fetchDocumentBlob(row, kind).catch(() => null);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dosyaAdiTemizle(`${beyanKaydiMukellefAdi(row)}-${declarationTypeCode(row)}-${fmtDonemHattat(row.donem)}-${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'}.pdf`);
    a.click();
    URL.revokeObjectURL(url);
    return true;
  };

  /** Kaydın iki PDF'ini de (varsa) indirir. Tarayıcı art arda indirmeyi engellemesin diye kısa ara verir. */
  const downloadRow = async (row: BeyanKaydi) => {
    if (indirilenler.has(row.id)) return;
    setIndirilenler((prev) => new Set(prev).add(row.id));
    try {
      let sayi = 0;
      if (row.beyannameUrl && await downloadDocument(row, 'beyanname')) sayi++;
      if (row.pdfUrl) {
        if (sayi) await new Promise((r) => setTimeout(r, 400));
        if (await downloadDocument(row, 'tahakkuk')) sayi++;
      }
      if (!sayi) toast.warning('İndirilecek PDF yok');
    } finally {
      setIndirilenler((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
    }
  };

  const downloadSelected = async () => {
    if (!seciliKayitlar.length) { toast.warning('Seçili kayıt yok'); return; }
    toast.info(`${seciliKayitlar.length} kaydın PDF'leri indiriliyor…`);
    for (const row of seciliKayitlar) {
      await downloadRow(row);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  // ---- CSV: geçerli süzgeçle sunucudan en çok 1000 kayıt ----
  const exportCsv = async () => {
    if (csvYaziliyor) return;
    setCsvYaziliyor(true);
    try {
      const veri = await beyanKayitlariApi.listSayfa({ ...sorgu, page: 1, pageSize: CSV_TAVAN });
      const kayitlar = veri.rows || [];
      if (!kayitlar.length) { toast.info('Dışa aktarılacak kayıt yok'); return; }
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const iletimMetni = (k: BeyanKaydi) => {
        const son = k.iletim?.[0];
        if (!son) return '';
        const kanal = son.channel === 'EMAIL' ? 'E-posta' : 'WhatsApp';
        if (son.status === 'SENT') return `${kanal} · ${fmtDate(son.sentAt)}${son.testMode ? ' (test)' : ''}`;
        if (son.status === 'FAILED') return `${kanal} · iletilemedi`;
        return `${kanal} · ${son.status.toLowerCase()}`;
      };
      const lines = [
        ['Mükellef', 'VKN/TCKN', 'Tür', 'Dönem', 'Mahiyet', 'Beyan Tarihi', 'Onay No', 'Tahakkuk', 'Beyanname PDF', 'Tahakkuk PDF', 'İletim']
          .map(cell).join(';'),
        ...kayitlar.map((k) => [
          beyanKaydiMukellefAdi(k),
          k.taxpayer?.taxNumber || '',
          declarationTypeLabel(k),
          k.donem,
          beyanMahiyeti(k) === 'DUZELTME' ? 'DÜZELTME' : 'ASIL',
          fmtDate(k.beyanTarihi),
          k.onayNo || '',
          k.tahakkukTutari ?? '',
          k.beyannameUrl ? 'var' : 'yok',
          k.pdfUrl ? 'var' : 'yok',
          iletimMetni(k),
        ].map(cell).join(';')),
      ];
      const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beyanname-listesi-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if ((veri.total || 0) > kayitlar.length) {
        toast.warning(`Toplam ${veri.total.toLocaleString('tr-TR')} kayıttan ilk ${kayitlar.length.toLocaleString('tr-TR')} tanesi yazıldı — daha azı için süzgeci daraltın.`);
      } else {
        toast.success(`${kayitlar.length.toLocaleString('tr-TR')} kayıt CSV'ye yazıldı`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'CSV hazırlanamadı');
    } finally {
      setCsvYaziliyor(false);
    }
  };

  const sayfadakiHepsiSecili = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const seciliSayi = selectedIds.size;

  return (
    <div data-beyan-page className="max-w-[1500px] space-y-4">
      {/* ===================== KOMUT KONSOLU ===================== */}
      <section data-beyan-konsol
        className="relative overflow-hidden rounded-2xl"
        style={portalStyle({
          background: 'linear-gradient(135deg, rgba(17,22,28,0.96), rgba(10,12,16,0.99))',
          border: '1px solid rgba(76,198,245,0.16)',
          boxShadow: '0 24px 60px -32px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
        })}
      >
        <div data-beyan-dekor className="absolute inset-x-0 top-0 h-[2px]" style={portalStyle({ background: 'linear-gradient(90deg, transparent, #4cc6f5, #f4c451, transparent)', opacity: 0.8 })} />
        <div data-beyan-dekor className="pointer-events-none absolute" style={portalStyle({ width: 420, height: 420, left: -60, top: -220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(76,198,245,0.16), transparent 62%)' })} />
        <div data-beyan-dekor className="pointer-events-none absolute" style={portalStyle({ width: 420, height: 420, right: -80, top: -260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(244,196,81,0.10), transparent 62%)' })} />

        <div data-beyan-konsol-ic className="relative px-4 pt-3 sm:px-5">
          <div data-beyan-kafa className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div data-beyan-konsol-icon className="grid flex-none place-items-center" style={portalStyle({ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(150deg, rgba(76,198,245,0.22), rgba(76,198,245,0.05))', border: '1px solid rgba(76,198,245,0.3)' })}>
                <FileText size={19} style={portalStyle({ color: '#bfe9ff' })} />
              </div>
              <div className="min-w-0">
                <div data-beyan-eyebrow className="text-[10px] font-extrabold uppercase tracking-[0.2em]" style={portalStyle({ color: '#7fcdee' })}>e-Beyanname · GİB</div>
                <h1 className="text-[18px] font-bold tracking-[-0.02em]" style={portalStyle({ color: '#f3f5f7' })}>Beyanname İndirme</h1>
                <p data-beyan-aciklama className="hidden text-[13px]">GİB e-Beyanname sisteminden beyanname ve tahakkuk PDF'leri indirilir; süzülür, mükellefe iletilir.</p>
              </div>
            </div>

          </div>

          {/* EYLEM KARTI (tasarım 1, Muzaffer Bey onayı 2026-09-24): indirme işi tek beyaz kartta —
              üstte tarih + çek düğmeleri, altında ilerleme, en altta durum şeridi. */}
          <div data-beyan-eylem-kart className="mt-3">
            <div data-beyan-konsol-eylem className="flex flex-col items-end gap-1.5">
              <div className="flex w-full flex-wrap items-stretch justify-end gap-2">
                <div data-beyan-tarih className="flex items-center overflow-hidden rounded-[11px]" style={portalStyle({ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' })}>
                  <label className="flex flex-col gap-px px-2.5 py-1">
                    <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[0.14em]" style={portalStyle({ color: 'rgba(243,245,247,0.4)' })}>Başlangıç</span>
                    <input type="date" value={pullFrom} onChange={(e) => setPullFrom(e.target.value)} onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }} className="bg-transparent text-[13px] font-semibold outline-none cursor-pointer" style={portalStyle({ color: '#f3f5f7', colorScheme: 'dark' })} />
                  </label>
                  <div data-beyan-tarih-ayrac className="self-stretch" style={portalStyle({ width: 1, background: 'rgba(255,255,255,0.07)' })} />
                  <label className="flex flex-col gap-px px-2.5 py-1">
                    <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[0.14em]" style={portalStyle({ color: 'rgba(243,245,247,0.4)' })}>Bitiş</span>
                    <input type="date" value={pullTo} onChange={(e) => setPullTo(e.target.value)} onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }} className="bg-transparent text-[13px] font-semibold outline-none cursor-pointer" style={portalStyle({ color: '#f3f5f7', colorScheme: 'dark' })} />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => pullMut.mutate(false)}
                  disabled={pullMut.isPending}
                  title="Eski e-Beyanname sisteminden beyanname + tahakkuk indirir"
                  data-beyan-btn="birincil"
                  className="inline-flex h-[38px] items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-bold"
                  style={portalStyle({ background: 'linear-gradient(135deg, #f4c451, #e0a93c)', color: '#1a1407', boxShadow: '0 12px 26px -12px rgba(244,196,81,0.6)', opacity: pullMut.isPending ? 0.65 : 1 })}
                >
                  {pullMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Beyannameleri Çek
                </button>
                <button
                  type="button"
                  onClick={() => pullNewMut.mutate(false)}
                  disabled={pullNewMut.isPending}
                  title="Yeni GİB e-Beyan sisteminden (ebeyan.gib.gov.tr) çeker — eski sistemden ayrı"
                  data-beyan-btn="yesil"
                  className="inline-flex h-[38px] items-center justify-center gap-2 rounded-[10px] px-3.5 text-[13px] font-bold"
                  style={portalStyle({ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.38)', color: '#6ee7b7', opacity: pullNewMut.isPending ? 0.65 : 1 })}
                >
                  {pullNewMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Yeni Beyanname Sitesinden Çek
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Bu tarih aralığındaki TÜM beyannameler (zaten inmiş olanlar dahil) yeniden indirilecek; PDF ve tahakkuk tutarı yenilenir. "Tutar okunamadı" / eksik PDF kayıtlarını düzeltir. Tarih aralığını dar tutman önerilir. Devam edilsin mi?')) {
                      pullMut.mutate(true);
                    }
                  }}
                  disabled={pullMut.isPending}
                  title="Yenile (force) — var olanları da yeniden indir, Tutar okunamadı / eksik PDF kayıtlarını düzeltir"
                  data-beyan-btn="ikincil"
                  className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px]"
                  style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(243,245,247,0.62)' })}
                >
                  {pullMut.isPending ? <Loader2 size={17} className="animate-spin" /> : <RotateCcw size={17} />}
                </button>
              </div>
            </div>

          {isBeyanJobActive && (
            <div data-beyan-ilerleme className="relative h-[3px] overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.05)' })}>
              <div className="absolute inset-y-0 left-0 transition-all" style={portalStyle({ width: `${Math.max(6, Math.min(100, portalJobProgress(latestBeyanJob).pct ?? (isBeyanJobRunning ? 45 : 12)))}%`, background: 'linear-gradient(90deg, #4cc6f5, #f4c451)' })} />
            </div>
          )}
          {/* canlı durum: son iş + runner/şifre */}
          <div data-beyan-durum className="mt-2.5 flex flex-wrap items-center gap-3 py-2" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.07)' })}>
            <ConsoleJob
              job={latestBeyanJob}
              onCancel={isBeyanJobActive && latestBeyanJob ? () => cancelJobMut.mutate(latestBeyanJob.id) : undefined}
              cancelPending={cancelJobMut.isPending}
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {sonCekimMetni && (
                <span data-beyan-son-cekim className="text-[11.5px]" style={portalStyle({ color: 'rgba(243,245,247,0.42)' })}>
                  Son çekim {sonCekimMetni}
                </span>
              )}
              <span data-beyan-durum-madde className="inline-flex items-center gap-2 text-[12px] font-semibold" style={portalStyle({ color: 'rgba(243,245,247,0.62)' })}>
                <span data-beyan-nokta={portalSummary?.runner?.enabled ? 'acik' : 'kapali'} className="inline-block h-2 w-2 rounded-full" style={portalStyle({ background: portalSummary?.runner?.enabled ? '#4ade80' : '#fb7185', boxShadow: `0 0 0 3px ${portalSummary?.runner?.enabled ? 'rgba(74,222,128,0.16)' : 'rgba(251,113,133,0.16)'}` })} /> Runner
              </span>
              <span data-beyan-durum-madde className="inline-flex items-center gap-2 text-[12px] font-semibold" style={portalStyle({ color: 'rgba(243,245,247,0.62)' })}>
                <span data-beyan-nokta={portalSummary?.credentials.eBeyannameReady ? 'acik' : 'kapali'} className="inline-block h-2 w-2 rounded-full" style={portalStyle({ background: portalSummary?.credentials.eBeyannameReady ? '#4ade80' : '#fb7185', boxShadow: `0 0 0 3px ${portalSummary?.credentials.eBeyannameReady ? 'rgba(74,222,128,0.16)' : 'rgba(251,113,133,0.16)'}` })} /> Şifre
              </span>
              <Link href="/panel/ayarlar" data-beyan-btn="ikincil" className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-semibold" style={portalStyle({ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(243,245,247,0.62)' })}>
                <KeyRound size={13} /> Şifre Ayarları
              </Link>
            </div>
          </div>

          </div>
        </div>
      </section>

      {/* ===================== LİSTE ===================== */}
      <section data-beyan-liste className="rounded-2xl overflow-hidden" style={portalStyle({ background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))', border: '1px solid rgba(255,255,255,0.07)' })}>
        <div data-beyan-liste-head className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.06)' })}>
          <div>
            <h2 className="text-[15px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>Beyanname Listesi</h2>
            <p className="mt-0.5 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
              {toplam > 0 ? <><b style={portalStyle({ color: 'rgba(250,250,249,0.75)' })}>{toplam.toLocaleString('tr-TR')}</b> kayıt </> : null}</p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={csvYaziliyor || toplam === 0}
            title={toplam > CSV_TAVAN ? `Geçerli süzgeçle ilk ${CSV_TAVAN} kayıt` : 'Geçerli süzgeçle CSV indir'}
            data-beyan-btn="ikincil"
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-semibold disabled:opacity-50"
            style={portalStyle({ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' })}
          >
            {csvYaziliyor ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} CSV
          </button>
        </div>

        {/* Süzgeç bandı — e-Defter seçici bandı dili: küçük büyük-harf etiket üstte + hizalı kutu (hepsi sunucuda) */}
        <div data-beyan-suzgec className="flex flex-wrap items-end gap-x-3 gap-y-3 px-4 py-3.5" style={portalStyle({ background: 'rgba(0,0,0,0.22)', borderBottom: '1px solid rgba(255,255,255,0.07)' })}>
          <label className="flex min-w-[220px] flex-[1.7] flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Ara</span>
            <span data-beyan-kutu className="flex items-center gap-2 rounded-xl px-3" style={portalStyle(SUZGEC_KUTU)}>
              <Search size={14} className="shrink-0" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mükellef, VKN, onay no" className="w-full bg-transparent text-[13px] outline-none" style={portalStyle({ color: '#fafaf9' })} />
              {search && (
                <button type="button" onClick={() => setSearch('')} title="Aramayı temizle" className="shrink-0" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}><IconX size={13} /></button>
              )}
            </span>
          </label>
          <div className="flex min-w-[200px] flex-[1.3] flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Mükellef</span>
            <SelectBox value={selectedTaxpayer} onChange={suzgec(setSelectedTaxpayer)}>
              <option value="all">Tümü</option>
              {taxpayerOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </SelectBox>
          </div>
          <div className="flex min-w-[130px] flex-1 flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Tür</span>
            <SelectBox value={typeFilter} onChange={(v) => suzgec(setTypeFilter)(v as FilterKey)}>
              {FILTER_KEYS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </SelectBox>
          </div>
          <div className="flex min-w-[130px] flex-1 flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Belge</span>
            <SelectBox value={docFilter} onChange={(v) => suzgec(setDocFilter)(v as BeyanBelgeSuzgec)}>
              <option value="all">Tümü</option>
              <option value="beyanname">Beyanname</option>
              <option value="tahakkuk">Tahakkuk</option>
            </SelectBox>
          </div>
          <div className="flex min-w-[130px] flex-1 flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>İletim</span>
            <SelectBox value={iletimFilter} onChange={(v) => suzgec(setIletimFilter)(v as BeyanIletimSuzgec)}>
              <option value="all">Tümü</option>
              <option value="iletildi">İletildi</option>
              <option value="iletilmedi">İletilmedi</option>
              <option value="hata">Hata</option>
            </SelectBox>
          </div>
          <div className="flex flex-col gap-1.5">
            <span data-beyan-etiket className="text-[9px] font-bold uppercase tracking-[.16em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>Dönem</span>
            <div data-beyan-kutu className="flex items-center gap-1 rounded-xl px-2.5" style={portalStyle(SUZGEC_KUTU)} title="Beyanname dönem aralığı (ay olarak)">
              <input type="date" value={periodStart ? `${periodStart}-01` : ''} onChange={(e) => suzgec(setPeriodStart)(e.target.value ? e.target.value.slice(0, 7) : '')} onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }} aria-label="Dönem başlangıç" className="bg-transparent text-[12.5px] font-semibold outline-none cursor-pointer" style={portalStyle({ color: periodStart ? '#fafaf9' : 'rgba(250,250,249,0.45)', colorScheme: 'dark', width: 104 })} />
              <span className="shrink-0" style={portalStyle({ color: 'rgba(250,250,249,0.3)' })}>–</span>
              <input type="date" value={periodEnd ? `${periodEnd}-01` : ''} onChange={(e) => suzgec(setPeriodEnd)(e.target.value ? e.target.value.slice(0, 7) : '')} onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch {} }} aria-label="Dönem bitiş" className="bg-transparent text-[12.5px] font-semibold outline-none cursor-pointer" style={portalStyle({ color: periodEnd ? '#fafaf9' : 'rgba(250,250,249,0.45)', colorScheme: 'dark', width: 104 })} />
            </div>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!suzgecAktif}
            data-beyan-btn="ikincil"
            data-aktif={suzgecAktif ? 'evet' : 'hayir'}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition disabled:opacity-35"
            style={portalStyle({ background: suzgecAktif ? 'rgba(212,184,118,0.10)' : 'transparent', border: `1px solid ${suzgecAktif ? 'rgba(212,184,118,0.35)' : 'rgba(255,255,255,0.10)'}`, color: suzgecAktif ? GOLD : 'rgba(250,250,249,0.5)' })}
            title="Süzgeçleri temizle"
          >
            <RotateCcw size={13} /> Temizle
          </button>
        </div>

        {/* Toplu işlemler — YALNIZ seçim varken (Muzaffer Bey, 2026-09-24: boşta duran
            "Seçili kayıt yok" + beş sönük düğme görsel gürültüydü, kaldırıldı). */}
        {seciliSayi > 0 && (
          <div data-beyan-toplu data-secili="evet" className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(212,184,118,0.05)' })}>
            <span data-beyan-secili-sayi className="mr-1 text-[12.5px] font-semibold tabular-nums" style={portalStyle({ color: GOLD })}>
              {seciliSayi.toLocaleString('tr-TR')} kayıt seçildi
            </span>
            <ToolbarButton icon={MessageCircle} label="WhatsApp gönder" tone="whatsapp" onClick={() => gonderimBaslat('WHATSAPP', seciliKayitlar)} />
            <ToolbarButton icon={Mail} label="E-posta gönder" tone="mail" onClick={() => gonderimBaslat('EMAIL', seciliKayitlar)} />
            <ToolbarButton icon={Download} label="İndir" tone="default" onClick={downloadSelected} />
            <ToolbarButton icon={Trash2} label="Sil" tone="danger" disabled={bulkDeleteMut.isPending} onClick={() => {
              const ids = Array.from(selectedIds);
              if (!ids.length) return toast.warning('Seçili kayıt yok');
              if (confirm(`${ids.length} kayıt silinsin mi?`)) bulkDeleteMut.mutate(ids);
            }} />
            <span data-beyan-toplu-ayrac className="ml-auto" />
            <ToolbarButton icon={IconX} label="Seçimi bırak" tone="default" onClick={() => secimiTemizle()} />
          </div>
        )}

        {isLoading ? (
          <div data-beyan-bos className="p-10 text-center text-[13px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
            <Loader2 size={18} className="animate-spin mx-auto mb-3" /> Kayıtlar yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div data-beyan-bos className="p-12 text-center">
            <FileQuestion size={34} className="mx-auto mb-3" style={portalStyle({ color: 'rgba(250,250,249,0.24)' })} />
            {suzgecAktif ? (
              <>
                <p className="text-[14px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.78)' })}>Süzgeçle eşleşen kayıt yok</p>
                <button type="button" onClick={clearFilters} className="mt-3 text-[12.5px] font-semibold" style={portalStyle({ color: GOLD })}>
                  Süzgeçleri temizle
                </button>
              </>
            ) : (
              <>
                <p className="text-[14px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.78)' })}>Henüz indirilmiş beyanname yok</p>
                <p className="mt-1.5 text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                  Üstteki <b style={portalStyle({ color: GOLD })}>Beyannameleri Çek</b> ile mali müşavir şifresiyle e-Beyanname sisteminden indirin.
                </p>
              </>
            )}
          </div>
        ) : (
          <div data-beyan-tablo className="overflow-x-auto">
            <table className="w-full text-[13px]" style={portalStyle({ tableLayout: 'fixed', minWidth: 920 })}>
              <colgroup>
                <col style={portalStyle({ width: 40 })} />
                <col />
                <col style={portalStyle({ width: 78 })} />
                <col style={portalStyle({ width: 108 })} />
                <col style={portalStyle({ width: 82 })} />
                <col style={portalStyle({ width: 112 })} />
                <col style={portalStyle({ width: 84 })} />
                <col style={portalStyle({ width: 84 })} />
                <col style={portalStyle({ width: 104 })} />
              </colgroup>
              <thead style={portalStyle({ background: 'rgba(255,255,255,0.025)' })}>
                <tr className="text-left uppercase tracking-[.12em] text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
                  <th className="w-[42px] px-3 py-3">
                    <input
                      type="checkbox"
                      checked={sayfadakiHepsiSecili}
                      onChange={(e) => sayfayiSec(e.target.checked)}
                      aria-label="Bu sayfadaki kayıtları seç"
                      title="Bu sayfadaki kayıtları seç"
                    />
                  </th>
                  <th className="px-3 py-3">Mükellef</th>
                  <th className="px-3 py-3 whitespace-nowrap">Dönem</th>
                  <th className="px-3 py-3 whitespace-nowrap">Tür</th>
                  <th className="px-3 py-3">Mahiyet</th>
                  <th className="px-3 py-3 text-right">Tutar</th>
                  <th className="px-3 py-3">Belgeler</th>
                  <th className="px-3 py-3">İletim</th>
                  <th className="px-3 py-3 text-right">Eylemler</th>
                </tr>
              </thead>
              <tbody style={portalStyle({ opacity: isFetching && !isLoading ? 0.7 : 1, transition: 'opacity .15s' })}>
                {rows.map((row) => (
                  <BeyanSatiri
                    key={row.id}
                    row={row}
                    secili={selectedIds.has(row.id)}
                    onSecim={(secili) => kaydiSec(row, secili)}
                    goruntulenen={{ beyanname: viewedDocKeys.has(`${row.id}:beyanname`), tahakkuk: viewedDocKeys.has(`${row.id}:tahakkuk`) }}
                    onOnizle={(kind) => openDocumentBlob(row, kind)}
                    onIndir={() => downloadRow(row)}
                    onGonder={(channel) => gonderimBaslat(channel, [row])}
                    onMukellefSec={() => suzgec(setSelectedTaxpayer)(row.taxpayerId)}
                    indiriliyor={indirilenler.has(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && toplam > 0 && (
          <Sayfalama
            sayfa={sayfa}
            sayfaBoyutu={boyut}
            toplam={toplam}
            onSayfa={(n) => adresYaz({ sayfa: n })}
            onSayfaBoyutu={(b) => adresYaz({ sayfa: 1, boyut: b })}
            birim="kayıt"
            yukleniyor={isFetching}
          />
        )}
      </section>

      {gonderimIstegi && (
        <GonderimOnayKutusu
          channel={gonderimIstegi.channel}
          kayitlar={gonderimIstegi.kayitlar}
          testMode={vergiTestModu}
          gonderiliyor={gonderMut.isPending}
          onKapat={() => { if (!gonderMut.isPending) setGonderimIstegi(null); }}
          onOnayla={(ids) => gonderMut.mutate({ ids, channel: gonderimIstegi.channel })}
        />
      )}

      {previewPortalReady && pdfPreview && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={portalStyle({ background: 'rgba(0,0,0,0.72)' })}
          onClick={closePdfPreview}
        >
          <div
            data-beyan-pdf
            className="flex h-[min(92vh,900px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[10px]"
            style={portalStyle({ background: '#12100d', border: '1px solid rgba(255,255,255,0.12)' })}
            onClick={(e) => e.stopPropagation()}
          >
            <div data-beyan-pdf-head className="flex items-center justify-between gap-3 px-4 py-3" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.08)' })}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>{pdfPreview.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.48)' })}>{pdfPreview.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={pdfPreview.url}
                  download={dosyaAdiTemizle(`${pdfPreview.title}.pdf`)}
                  data-beyan-btn="mavi"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="PDF indir"
                  style={portalStyle({ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.24)', color: '#bae6fd' })}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const frame = document.getElementById('beyan-pdf-preview') as HTMLIFrameElement | null;
                    frame?.contentWindow?.print();
                  }}
                  data-beyan-btn="ikincil"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Yazdır"
                  style={portalStyle({ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.72)' })}
                >
                  <Printer size={15} />
                </button>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  data-beyan-btn="tehlike"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Kapat"
                  style={portalStyle({ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.24)', color: '#fda4af' })}
                >
                  <IconX size={16} />
                </button>
              </div>
            </div>
            <iframe key={pdfPreview.docKey} id="beyan-pdf-preview" title={pdfPreview.title} src={pdfPreview.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

// Toplu işlem şeridi düğmesi (üstte, tek sayaçla)
function ToolbarButton({ icon: Icon, label, onClick, disabled, tone }: { icon: any; label: string; onClick: () => void; disabled?: boolean; tone: 'default' | 'mail' | 'whatsapp' | 'danger' }) {
  const tones = {
    default: { background: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.72)' },
    mail: { background: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.28)', color: '#bae6fd' },
    whatsapp: { background: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.28)', color: '#86efac' },
    danger: { background: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.24)', color: '#fda4af' },
  } as const;
  const c = tones[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-beyan-tool={tone}
      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      style={portalStyle({ background: c.background, border: `1px solid ${c.border}`, color: c.color })}
    >
      <Icon size={13} strokeWidth={2.2} /> {label}
    </button>
  );
}

// Komut konsolu içinde kompakt "Son iş" göstergesi (ilerleme halkası + durum + iptal)
function ConsoleJob({ job, onCancel, cancelPending }: { job?: PortalJob; onCancel?: () => void; cancelPending?: boolean }) {
  if (!job) return null;
  const noRecords = job.status === 'done' && Number(job.recordCount || 0) === 0;
  const status = noRecords
    ? { label: 'Kayıt yok', color: '#fbbf24', bg: 'rgba(251,191,36,0.16)' }
    : portalJobStatus(job.status);
  const progress = portalJobProgress(job);
  const active = job.status === 'running' || job.status === 'pending';
  const pct = Math.max(0, Math.min(100, progress.pct ?? (job.status === 'running' ? 45 : job.status === 'pending' ? 12 : 100)));
  const sub = active
    ? (progress.message || (job.status === 'pending' ? 'Kuyrukta bekliyor' : 'İşlem sürüyor'))
    : job.errorMessage ? job.errorMessage.slice(0, 90)
    : noRecords ? 'Bu aralıkta indirilecek kayıt yok'
    : `${Number(job.recordCount || 0).toLocaleString('tr-TR')} işlem · ${fmtDateTime(job.createdAt)}`;
  return (
    <div data-beyan-job={active ? 'aktif' : noRecords ? 'bos' : 'bitti'} className="my-1 flex items-center gap-3 rounded-[13px] px-3 py-2" style={portalStyle({ background: 'rgba(76,198,245,0.06)', border: '1px solid rgba(76,198,245,0.18)', minWidth: 230 })}>
      <div data-beyan-job-halka className="grid flex-none place-items-center" style={portalStyle({ width: 34, height: 34, borderRadius: '50%', background: `conic-gradient(${active ? '#4cc6f5' : '#4ade80'} 0 ${pct}%, rgba(255,255,255,0.08) ${pct}% 100%)`, ...({ '--beyan-pct': `${pct}%` } as CSSProperties) })}>
        <span data-beyan-job-ic className="grid place-items-center" style={portalStyle({ width: 26, height: 26, borderRadius: '50%', background: '#0c1117', fontSize: 9.5, fontWeight: 800, color: active ? '#bfe9ff' : '#86efac' })}>
          {active ? `%${Math.round(pct)}` : (noRecords ? '0' : '✓')}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <b data-beyan-job-baslik className="text-[12.5px]" style={portalStyle({ color: '#f3f5f7' })}>Son iş</b>
          <span data-beyan-job-durum={noRecords ? 'bos' : job.status} className="rounded-[6px] px-[7px] py-[2px] text-[9.5px] font-extrabold tracking-[0.06em]" style={portalStyle({ background: status.bg, color: status.color })}>{status.label}</span>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={cancelPending} data-beyan-btn="tehlike" className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px] font-bold disabled:opacity-50" style={portalStyle({ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.28)', color: '#fca5a5' })}>
              {cancelPending ? <Loader2 size={10} className="animate-spin" /> : <IconX size={10} />} İptal
            </button>
          )}
        </div>
        <div data-beyan-job-alt className="truncate text-[11px]" style={portalStyle({ color: 'rgba(243,245,247,0.42)', maxWidth: 300 })}>
          {sub}{active && progress.current != null && progress.total != null ? ` · ${progress.current}/${progress.total}` : ''}
        </div>
      </div>
    </div>
  );
}

function SelectBox({ icon: Icon, etiket, value, onChange, children }: { icon?: any; /** Kutuda değerin önünde görünen sabit etiket: "Belge: Tümü" */ etiket?: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  // React children'i flat string'e çevir (array, sayı, undefined hepsini düzgün)
  const childrenToText = (node: any): string => {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(childrenToText).join('');
    if (typeof node === 'object' && node.props?.children !== undefined) return childrenToText(node.props.children);
    return '';
  };

  // Children içindeki <option> elementlerini parse et — dark dropdown için
  const items = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    const walk = (node: any) => {
      if (node == null || node === false) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object' && node?.type === 'option') {
        list.push({
          value: String(node.props?.value ?? ''),
          label: childrenToText(node.props?.children).trim(),
        });
      } else if (typeof node === 'object' && node?.props?.children) {
        walk(node.props.children);
      }
    };
    walk(children);
    return list;
  }, [children]);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentLabel = items.find((it) => it.value === value)?.label || items[0]?.label || '—';
  // Varsayılan dışı bir seçim varsa kutu altın tonuna döner (süzgeç aktif).
  const aktifSecim = items.length > 0 && value !== items[0]?.value;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-beyan-select
        data-aktif={aktifSecim ? 'evet' : 'hayir'}
        className={`w-full h-10 ${Icon ? 'pl-9' : 'pl-3'} pr-8 rounded-xl text-[13px] font-semibold outline-none text-left flex items-center transition`}
        style={portalStyle({ background: 'rgba(255,255,255,0.05)', border: `1px solid ${aktifSecim ? 'rgba(212,184,118,0.45)' : 'rgba(255,255,255,0.12)'}`, color: aktifSecim ? '#d4b876' : '#fafaf9' })}
      >
        {Icon && <Icon size={14} className="absolute left-3 pointer-events-none" style={portalStyle({ color: aktifSecim ? '#d4b876' : 'rgba(250,250,249,0.4)' })} />}
        {etiket && <span className="mr-1.5 shrink-0 font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>{etiket}:</span>}
        <span className="truncate">{currentLabel}</span>
        <svg data-beyan-select-ok className="absolute right-2.5 pointer-events-none" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="#d4b876" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          data-beyan-dropdown
          className="absolute mt-1.5 max-h-[320px] overflow-y-auto rounded-xl py-1"
          style={portalStyle({
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#121110',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 18px 44px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
          })}
        >
          {items.length === 0 ? (
            <div className="px-3 py-2 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>Liste boş</div>
          ) : (
            items.map((it) => {
              const active = it.value === value;
              return (
                <button
                  key={it.value}
                  type="button"
                  onClick={() => { onChange(it.value); setOpen(false); }}
                  data-beyan-secenek={active ? 'aktif' : 'pasif'}
                  className="w-full text-left px-3 py-[7px] text-[12.5px] flex items-center justify-between transition"
                  style={portalStyle({
                    background: active ? 'rgba(212,184,118,0.10)' : 'transparent',
                    color: active ? '#d4b876' : 'rgba(250,250,249,0.85)',
                    fontWeight: active ? 600 : 500,
                  })}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = portalPaint('rgba(255,255,255,0.04)', 'background'); }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = portalPaint('transparent', 'background'); }}
                >
                  <span className="truncate">{it.label}</span>
                  {active && <span style={portalStyle({ color: '#d4b876' })}>✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function LegacyBeyannamelerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [importModal, setImportModal] = useState(false);

  const { data: kayitlar = [], isLoading } = useQuery<BeyanKaydi[]>({
    queryKey: ['beyan-kayitlari', filter],
    queryFn: () => beyanKayitlariApi.list({
      beyanTipi: filter === 'all' ? undefined : filter,
      limit: 1000,
    }),
  });

  const { data: ozet } = useQuery({
    queryKey: ['beyan-kayitlari-ozet'],
    queryFn: () => beyanKayitlariApi.ozet(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => beyanKayitlariApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success('Kayıt silindi');
    },
    onError: (e: any) => toast.error(e?.message || 'Silinemedi'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kayitlar;
    return kayitlar.filter((k) => {
      const hay = `${beyanKaydiMukellefAdi(k)} ${k.taxpayer?.taxNumber || ''} ${k.onayNo || ''} ${k.donem} ${k.beyanTipi}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kayitlar, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: kayitlar.length };
    for (const k of kayitlar) c[k.beyanTipi] = (c[k.beyanTipi] || 0) + 1;
    return c;
  }, [kayitlar]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div data-portal-page-header className="flex items-end justify-between p-5 flex-wrap gap-3" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.05)' })}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={portalStyle({ background: GOLD })} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: '#b8a06f' })}>Belgeler</span>
          </div>
          <h1 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' })}>Beyannameler</h1>
          <p className="text-[13px] mt-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>
            Hattat'tan veya başka kaynaktan PDF klasörünü yükle, her beyanname otomatik parse edilip arşivlenir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportModal(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' })}
          >
            <FolderUp size={15} /> PDF Klasörü Aktar
          </button>
        </div>
      </div>

      {/* ÖZET KARTLARI — rakamsal tutar yok, sadece sayım */}
      {ozet && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OzetCard label="Toplam Beyanname" value={ozet.toplam.toLocaleString('tr-TR')} icon={FileText} />
          <OzetCard label="KDV Kayıtları" value={(ozet.byTip.KDV1 || 0) + (ozet.byTip.KDV2 || 0)} icon={FileText} />
          <OzetCard label="MUHSGK Kayıtları" value={ozet.byTip.MUHSGK || 0} icon={FileText} />
          <OzetCard label="Geçici Vergi" value={(ozet.byTip.GECICI_VERGI || 0) + (ozet.byTip.GGECICI || 0) + (ozet.byTip.KGECICI || 0)} icon={FileText} />
        </div>
      )}

      <PortalAutomationPanel focus="beyanname" />

      {/* ARAMA + FİLTRELER */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef, VKN, onay no, dönem ara..."
            className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none"
            style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' })}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_KEYS.map((f) => {
            const active = filter === f.key;
            const count = counts[f.key] || 0;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition-all"
                style={portalStyle({
                  background: active ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: active ? GOLD : 'rgba(250,250,249,0.65)',
                })}
              >
                {f.label} {count > 0 && <span className="opacity-60 ml-0.5">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* LİSTE */}
      {isLoading && <div className="text-stone-500 text-sm">Yükleniyor...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl p-16 text-center" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' })}>
          <FileText className="w-12 h-12 mx-auto mb-4" style={portalStyle({ color: 'rgba(250,250,249,0.2)' })} />
          <p className="text-[14px]" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
            {search || filter !== 'all' ? 'Filtreye uyan kayıt yok.' : 'Henüz beyanname kaydedilmemiş.'}
          </p>
          {kayitlar.length === 0 && (
            <button
              onClick={() => setImportModal(true)}
              className="mt-4 text-[13px] font-semibold"
              style={portalStyle({ color: GOLD })}
            >
              + Hattat'tan PDF klasörü yükle
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' })}>
          <table className="w-full text-[13px]" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
            <thead style={portalStyle({ background: 'rgba(184,160,111,0.08)' })}>
              <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
                <th className="px-4 py-3">Mükellef</th>
                <th className="px-4 py-3">Tip</th>
                <th className="px-4 py-3">Dönem</th>
                <th className="px-4 py-3">Onay No</th>
                <th className="px-4 py-3">Beyanname</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id} className="group" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.04)' })}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium truncate max-w-[260px]" style={portalStyle({ color: '#fafaf9' })}>
                      {beyanKaydiMukellefAdi(k)}
                    </div>
                    <div className="text-[11px] font-mono" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
                      {k.taxpayer?.taxNumber}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md" style={portalStyle({ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' })}>
                      {declarationTypeLabel(k)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px]">{fmtDonem(k.donem)}</td>
                  <td className="px-4 py-2.5 text-[12px] font-mono" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
                    {k.onayNo || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      {k.beyannameUrl ? (
                        <a
                          href={beyanKayitlariApi.beyannameUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={portalStyle({ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' })}
                        >
                          <FileText size={11} /> Beyanname
                        </a>
                      ) : (
                        <span className="text-[10.5px] italic" style={portalStyle({ color: 'rgba(250,250,249,0.35)' })}>—</span>
                      )}
                      {k.pdfUrl && (
                        <a
                          href={beyanKayitlariApi.pdfUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={portalStyle({ background: 'rgba(212,184,118,0.1)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' })}
                        >
                          <FileText size={11} /> Tahakkuk
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => {
                          if (confirm(`Bu kaydı silmek istediğine emin misin?\n\n${beyanKaydiMukellefAdi(k)} · ${declarationTypeLabel(k)} · ${fmtDonem(k.donem)}`)) {
                            deleteMut.mutate(k.id);
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-rose-500/10"
                        style={portalStyle({ color: 'rgba(244,63,94,0.7)' })}
                        title="Sil"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* IMPORT MODAL */}
      {importModal && (
        <ImportModal onClose={() => setImportModal(false)} onDone={() => {
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
        }} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ÖZET KARTI
// ════════════════════════════════════════════════════════════
function OzetCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' })}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={portalStyle({ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD })}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wider" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{label}</div>
        <div className="text-[18px] font-semibold tabular-nums mt-0.5" style={portalStyle({ color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' })}>{value}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// IMPORT MODAL — klasör/dosya yükleme + AI parse progress
// ════════════════════════════════════════════════════════════
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  type Mod = 'zip' | 'pdf';
  const [mode, setMode] = useState<Mod>('zip');
  const [files, setFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [zipOzet, setZipOzet] = useState<{ mukellefBulundu: number; mukellefYok: number; kayitEklendi: number; mevcut: number; parseHatasi: number } | null>(null);
  const [eslesmeyenler, setEslesmeyenler] = useState<Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const addFiles = (fl: FileList | null) => {
    if (!fl) return;
    const onlyPdf = Array.from(fl).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((prev) => {
      const fileKey = (f: File) => `${((f as any).webkitRelativePath || f.name)}-${f.size}`;
      const existing = new Set(prev.map(fileKey));
      const fresh = onlyPdf.filter((f) => !existing.has(fileKey(f)));
      return [...prev, ...fresh];
    });
  };

  const start = async () => {
    if (mode === 'pdf' && files.length === 0) return;
    if (mode === 'zip' && !zipFile) return;
    setUploading(true);
    setProgress(0);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    try {
      if (mode === 'zip' && zipFile) {
        const resp = await beyanKayitlariApi.importZip(zipFile, (p) => setProgress(p));
        setResults(resp.sonuclar);
        setZipOzet(resp.ozet);
        setEslesmeyenler(resp.eslesmeyenler);
        if (resp.ozet.kayitEklendi > 0) toast.success(`${resp.ozet.kayitEklendi} beyanname kaydı eklendi`);
        if (resp.ozet.mukellefYok > 0) toast.warning(`${resp.ozet.mukellefYok} mükellef eşleşmedi — aşağıda listelendi`);
      } else {
        const resp = await beyanKayitlariApi.importPdfs(files, (p) => setProgress(p));
        setResults(resp.results);
        const okCount = resp.results.filter((r) => r.durum === 'ok').length;
        const errCount = resp.results.filter((r) => r.durum !== 'ok').length;
        if (okCount > 0) toast.success(`${okCount} beyanname başarıyla eklendi`);
        if (errCount > 0) toast.warning(`${errCount} dosya işlenemedi — detay aşağıda`);
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setZipFile(null);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    setProgress(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={portalStyle({ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' })}
      onClick={uploading ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden"
        style={portalStyle({ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)', maxHeight: '85vh' })}
      >
        <div className="px-5 py-4 flex items-center justify-between" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.06)' })}>
          <div>
            <h3 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' })}>PDF Klasörü Aktar</h3>
            <p className="text-[12px] mt-0.5" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
              Hattat'tan indirdiğin tahakkuk fişi PDF'lerini toplu yükle. AI her dosyayı okuyup arşive kaydeder.
            </p>
          </div>
          <button onClick={onClose} disabled={uploading} className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-40" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
            <IconX size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!results && (
            <>
              {/* Mod sekmeleri — ZIP vs PDF */}
              <div className="flex rounded-xl overflow-hidden" style={portalStyle({ border: '1px solid rgba(255,255,255,0.08)' })}>
                <button
                  type="button"
                  onClick={() => setMode('zip')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={portalStyle({
                    background: mode === 'zip' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'zip' ? GOLD : 'rgba(250,250,249,0.55)',
                  })}
                >
                  <Archive size={15} /> Hattat ZIP (Önerilen)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('pdf')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={portalStyle({
                    background: mode === 'pdf' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'pdf' ? GOLD : 'rgba(250,250,249,0.55)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                  })}
                >
                  <Sparkles size={15} /> PDF/Klasor (Hizli)
                </button>
              </div>

              {/* Açıklama */}
              {mode === 'zip' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={portalStyle({ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' })}>
                  <strong style={portalStyle({ color: GOLD })}>Hattat ZIP modu</strong> — Hattat'tan dönem bazlı indirdiğin ZIP dosyasını olduğu gibi yükle. Klasör yapısı ve dosya adlarından otomatik parse edilir. AI'a gerek yok, hızlı + doğru.
                </div>
              )}
              {mode === 'pdf' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={portalStyle({ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' })}>
                  <strong style={portalStyle({ color: GOLD })}>PDF modu</strong> — Tek tek PDF seçersin, Claude AI her birini okuyup parse eder. ZIP modu varsa ONU kullan — çok daha hızlı.
                </div>
              )}

              {/* ZIP MODU — tek dosya */}
              {mode === 'zip' && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const f = e.dataTransfer.files[0];
                      if (f && (/\.zip$/i.test(f.name) || f.type === 'application/zip')) setZipFile(f);
                    }}
                    onClick={() => zipRef.current?.click()}
                    className="rounded-xl p-8 text-center cursor-pointer transition-all"
                    style={portalStyle({
                      background: zipFile ? 'rgba(34,197,94,0.06)' : 'rgba(212,184,118,0.04)',
                      border: `2px dashed ${zipFile ? 'rgba(34,197,94,0.4)' : 'rgba(212,184,118,0.35)'}`,
                    })}
                  >
                    <Archive className="w-12 h-12 mx-auto mb-3" style={portalStyle({ color: zipFile ? '#22c55e' : GOLD })} />
                    {zipFile ? (
                      <>
                        <p className="text-[14px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>{zipFile.name}</p>
                        <p className="text-[12px] mt-1 tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.6)' })}>
                          {(zipFile.size / 1024 / 1024).toFixed(1)} MB · Yüklemeye hazır
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setZipFile(null); }}
                          className="text-[11px] mt-2"
                          style={portalStyle({ color: '#f43f5e' })}
                        >
                          Kaldır
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[14px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>Hattat ZIP dosyasını buraya bırak</p>
                        <p className="text-[12px] mt-1" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                          Örn. "2025 1. DÖNEM.zip" · Max 500 MB
                        </p>
                      </>
                    )}
                    <input
                      ref={zipRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setZipFile(f);
                      }}
                    />
                  </div>
                </>
              )}

              {/* PDF MODU — mevcut */}
              {mode === 'pdf' && (<>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); }}
                className="rounded-xl p-8 text-center cursor-pointer transition-all"
                style={portalStyle({
                  background: 'rgba(212,184,118,0.04)',
                  border: '2px dashed rgba(212,184,118,0.35)',
                })}
                onClick={() => inputRef.current?.click()}
              >
                <FolderUp className="w-12 h-12 mx-auto mb-3" style={portalStyle({ color: GOLD })} />
                <p className="text-[14px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>
                  PDF dosyaları buraya sürükle
                </p>
                <p className="text-[12px] mt-1" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                  veya aşağıdaki butonlardan seç — tek dosya veya tüm klasör
                </p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={portalStyle({ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' })}
                  >
                    <Upload size={13} /> Dosya Seç
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={portalStyle({ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' })}
                  >
                    <FolderUp size={13} /> Klasör Seç
                  </button>
                </div>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                {/* webkitdirectory tipik olarak TS'de bilinmez; any cast ile */}
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                  // @ts-expect-error - webkitdirectory is non-standard but supported in Chromium/WebKit
                  webkitdirectory=""
                  directory=""
                />
              </div>

              {/* Dosya listesi */}
              {files.length > 0 && (
                <div className="rounded-xl" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' })}>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.04)' })}>
                    <span className="text-[12.5px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>
                      {files.length} PDF dosyası hazır
                    </span>
                    <button onClick={() => setFiles([])} className="text-[11px]" style={portalStyle({ color: '#f43f5e' })}>Temizle</button>
                  </div>
                  <ul className="max-h-[200px] overflow-y-auto divide-y" style={portalStyle({ borderColor: 'rgba(255,255,255,0.04)' })}>
                    {files.slice(0, 50).map((f, i) => (
                      <li key={i} className="px-4 py-1.5 flex items-center justify-between text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>
                        <span className="truncate flex-1">{((f as any).webkitRelativePath || f.name) as string}</span>
                        <span className="text-[10.5px] font-mono ml-3" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>{(f.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                    {files.length > 50 && (
                      <li className="px-4 py-1.5 text-center text-[11px] italic" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
                        ... ve {files.length - 50} dosya daha
                      </li>
                    )}
                  </ul>
                </div>
              )}
              </>)}{/* end mode === 'pdf' */}
            </>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="rounded-xl p-4" style={portalStyle({ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.25)' })}>
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="animate-spin" size={16} style={portalStyle({ color: GOLD })} />
                <span className="text-[13px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>
                  {progress < 100 ? `Yükleniyor: %${progress}` : 'AI dosyaları parse ediyor...'}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.06)' })}>
                <div className="h-full transition-all" style={portalStyle({ width: `${progress}%`, background: `linear-gradient(90deg, ${GOLD}aa, ${GOLD})` })} />
              </div>
              <p className="text-[11px] mt-2" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                {progress < 100
                  ? 'Dosyalar sunucuya gönderiliyor...'
                  : 'Her PDF Claude AI ile okunuyor, VKN/tip/dönem/tutar çıkarılıyor. Dosya başına ~3-5 saniye sürer.'}
              </p>
            </div>
          )}

          {/* ZIP özet kartları (zip modunda) */}
          {zipOzet && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11.5px]">
              <div className="rounded-lg px-3 py-2" style={portalStyle({ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' })}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={portalStyle({ color: '#22c55e' })}>Eklendi</div>
                <div className="text-[18px] font-bold tabular-nums" style={portalStyle({ color: '#22c55e' })}>{zipOzet.kayitEklendi}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={portalStyle({ background: 'rgba(250,250,249,0.03)', border: '1px solid rgba(255,255,255,0.08)' })}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>Zaten Var</div>
                <div className="text-[18px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>{zipOzet.mevcut}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={portalStyle({ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' })}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={portalStyle({ color: '#22c55e' })}>Mükellef Eşleşti</div>
                <div className="text-[18px] font-bold tabular-nums" style={portalStyle({ color: '#22c55e' })}>{zipOzet.mukellefBulundu}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={portalStyle({ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' })}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={portalStyle({ color: '#f59e0b' })}>Mükellef Yok</div>
                <div className="text-[18px] font-bold tabular-nums" style={portalStyle({ color: '#f59e0b' })}>{zipOzet.mukellefYok}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={portalStyle({ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' })}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={portalStyle({ color: '#ef4444' })}>Parse Hatası</div>
                <div className="text-[18px] font-bold tabular-nums" style={portalStyle({ color: '#ef4444' })}>{zipOzet.parseHatasi}</div>
              </div>
            </div>
          )}

          {/* Eşleşmeyen mükellefler listesi */}
          {eslesmeyenler.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={portalStyle({ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.3)' })}>
              <div className="px-4 py-2.5" style={portalStyle({ borderBottom: '1px solid rgba(245,158,11,0.2)' })}>
                <h4 className="text-[13px] font-semibold" style={portalStyle({ color: '#f59e0b' })}>
                  ⚠ {eslesmeyenler.length} mükellef portalınızda eşleşmedi
                </h4>
                <p className="text-[11px] mt-1" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
                  Bu mükellefleri ya portal'a eklemeniz ya da isim/VKN'sini Hattat'taki ile eşitlemeniz gerek:
                </p>
              </div>
              <ul className="max-h-[200px] overflow-y-auto divide-y text-[12px]" style={portalStyle({ borderColor: 'rgba(245,158,11,0.1)' })}>
                {eslesmeyenler.map((e, i) => (
                  <li key={i} className="px-4 py-1.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" style={portalStyle({ color: '#fafaf9' })}>{e.ad}</div>
                      <div className="text-[10.5px] font-mono" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>Hattat ID: {e.hattatId}</div>
                    </div>
                    <span className="text-[10.5px] opacity-60 whitespace-nowrap" style={portalStyle({ color: 'rgba(250,250,249,0.6)' })}>{e.pdfSayisi} PDF</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sonuç listesi */}
          {results && (
            <div className="rounded-xl overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' })}>
              <div className="px-4 py-3" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.04)' })}>
                <h4 className="text-[13.5px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>İşlem Sonucu</h4>
                <div className="flex items-center gap-4 mt-2 text-[11.5px]">
                  <span className="flex items-center gap-1.5" style={portalStyle({ color: '#22c55e' })}>
                    <CheckCircle2 size={13} /> {results.filter((r) => r.durum === 'ok').length} eklendi
                  </span>
                  <span className="flex items-center gap-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                    <FileQuestion size={13} /> {results.filter((r) => r.durum === 'mevcut').length} zaten var
                  </span>
                  <span className="flex items-center gap-1.5" style={portalStyle({ color: '#f59e0b' })}>
                    <AlertCircle size={13} /> {results.filter((r) => r.durum === 'mukellef_yok').length} mükellef yok
                  </span>
                  <span className="flex items-center gap-1.5" style={portalStyle({ color: '#ef4444' })}>
                    <FileX2 size={13} /> {results.filter((r) => r.durum === 'parse_hatasi' || r.durum === 'hata').length} hata
                  </span>
                </div>
              </div>
              <ul className="max-h-[300px] overflow-y-auto divide-y" style={portalStyle({ borderColor: 'rgba(255,255,255,0.04)' })}>
                {results.map((r, i) => (
                  <li key={i} className="px-4 py-2 text-[12px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" style={portalStyle({ color: '#fafaf9' })}>{r.dosyaAdi}</div>
                        {r.parsed?.mukellefAdi && (
                          <div className="text-[10.5px] mt-0.5" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
                            {r.parsed.mukellefAdi} · {r.parsed.beyanTipi || '?'} · {r.parsed.donem || '?'}
                          </div>
                        )}
                        {r.sebep && (
                          <div className="text-[10.5px] mt-0.5 italic" style={portalStyle({ color: '#f59e0b' })}>{r.sebep}</div>
                        )}
                      </div>
                      <ResultBadge durum={r.durum} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.06)' })}>
          {!results ? (
            <>
              <span className="text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
                {mode === 'zip'
                  ? 'ZIP içeriği sunucuda açılır, klasör/dosya adları parse edilir — AI yok, saniyeler içinde biter.'
                  : 'Her PDF için Claude AI ~3-5 saniye sürer. 100 PDF = ~6-8 dakika.'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={uploading}
                  className="px-4 py-2 text-[12.5px] font-medium rounded-md disabled:opacity-40"
                  style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' })}
                >
                  İptal
                </button>
                <button
                  onClick={start}
                  disabled={uploading || (mode === 'pdf' ? files.length === 0 : !zipFile)}
                  className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40"
                  style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' })}
                >
                  {uploading
                    ? 'Yükleniyor...'
                    : mode === 'zip'
                      ? (zipFile ? 'ZIP\'i İşle' : 'ZIP seçin')
                      : `${files.length} dosyayı yükle`}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 text-[12.5px] font-medium rounded-md"
                style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' })}
              >
                Yeni Yükleme
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 text-[12.5px] font-bold rounded-md"
                style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' })}
              >
                Kapat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ durum }: { durum: ImportResult['durum'] }) {
  const cfg: Record<ImportResult['durum'], { label: string; bg: string; color: string }> = {
    ok:             { label: 'Eklendi',       bg: 'rgba(34,197,94,0.1)',  color: '#22c55e' },
    mevcut:         { label: 'Zaten var',     bg: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.6)' },
    mukellef_yok:   { label: 'Mükellef yok',  bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' },
    parse_hatasi:   { label: 'Parse hatası',  bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
    hata:           { label: 'Hata',          bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
  };
  const c = cfg[durum];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex-shrink-0" style={portalStyle({ background: c.bg, color: c.color })}>
      {c.label}
    </span>
  );
}
