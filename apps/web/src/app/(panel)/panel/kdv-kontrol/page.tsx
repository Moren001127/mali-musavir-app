'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import { api } from '@/lib/api';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Play, Calendar, Users, Search, CheckCircle2, Loader2, Clock, FileSpreadsheet,
  ImageIcon, ScanLine, ChevronDown, X, Sparkles, Download, Trash2, Archive,
  ArrowRight, Activity, AlertTriangle, XCircle, FileText, Zap, Upload,
} from 'lucide-react';
import { OcrReviewPanel } from '@/components/kdv/OcrReviewPanel';

const GOLD = '#d4b876';

/** Canlı akış (log) satırı */
type FeedItem = {
  ts: number;
  kind: 'ok' | 'warn' | 'err' | 'info';
  title: string;
  detail?: string;
  resultId?: string;
  /** Stale hata temizleme için: "luca" | "faturalar" | "ocr" | "kontrol" */
  group?: string;
};

/** Kullanıcının istediği terminoloji */
type KdvAction = 'BILANCO_ALIS' | 'BILANCO_SATIS' | 'ISLETME_ALIS' | 'ISLETME_SATIS';
const ACTION_TO_TYPE: Record<KdvAction, 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER'> = {
  BILANCO_ALIS: 'KDV_191',
  BILANCO_SATIS: 'KDV_391',
  ISLETME_ALIS: 'ISLETME_GIDER',
  ISLETME_SATIS: 'ISLETME_GELIR',
};
const ACTION_LABEL: Record<KdvAction, string> = {
  BILANCO_ALIS:  'BİLANÇO · ALIŞ',
  BILANCO_SATIS: 'BİLANÇO · SATIŞ',
  ISLETME_ALIS:  'İŞLETME · ALIŞ',
  ISLETME_SATIS: 'İŞLETME · SATIŞ',
};
const ACTION_COLOR: Record<KdvAction, string> = {
  BILANCO_ALIS:  '#059669',
  BILANCO_SATIS: '#2563eb',
  ISLETME_ALIS:  '#a855f7',
  ISLETME_SATIS: '#ea580c',
};

const TYPE_LABEL: Record<string, string> = {
  KDV_191:       'Bilanço — Alış',
  KDV_391:       'Bilanço — Satış',
  ISLETME_GELIR: 'İşletme — Satış',
  ISLETME_GIDER: 'İşletme — Alış',
  ALIS:          'Bilanço — Alış',
  SATIS:         'Bilanço — Satış',
};

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  mihsapId?: string | null;
}
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function KdvKontrolPage() {
  const qc = useQueryClient();

  // ── STATE ───────────────────────────────────────────
  const now = new Date();
  const [ay, setAy] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [action, setAction] = useState<KdvAction>('BILANCO_ALIS');
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // ── Canlı akış için state ───────────────────────────
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const seenResultIdsRef = useRef<Set<string>>(new Set());

  const pushFeed = (it: Omit<FeedItem, 'ts'>) => {
    setFeed((prev) => [...prev.slice(-199), { ...it, ts: Date.now() }]);
  };

  /**
   * Aynı "group" (ör. "luca", "faturalar", "ocr") içinde başarılı bir
   * olay geldiğinde o gruba ait önceki HATA kayıtlarını feed'den
   * temizler — böylece stale hatalar "Sorun" sayacını şişirmez.
   */
  const clearFeedErrorsInGroup = (group: string) => {
    setFeed((prev) => prev.filter((f) => !(f.group === group && f.kind === 'err')));
  };

  // ── DATA ────────────────────────────────────────────
  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });
  const { data: allSessions = [] } = useQuery<any[]>({
    queryKey: ['kdv-sessions'],
    queryFn: kdvApi.getSessions,
    refetchInterval: 5000,
  });
  const { data: outputs = [] } = useQuery<any[]>({
    queryKey: ['kdv-outputs'],
    queryFn: kdvApi.listOutputs,
  });

  // Seçime göre aktif seansı bul (taxpayer + donem + tip)
  const type = ACTION_TO_TYPE[action as KdvAction];
  const [year, month] = ay.split('-');
  const periodLabel = `${year}/${month}`;

  const activeSession = useMemo(() => {
    if (!taxpayerId) return null;
    return allSessions.find(
      (s) =>
        s.taxpayerId === taxpayerId &&
        s.periodLabel === periodLabel &&
        s.type === type,
    );
  }, [allSessions, taxpayerId, periodLabel, type]);

  const sessionId: string | undefined = activeSession?.id;

  const { data: stats } = useQuery<any>({
    queryKey: ['kdv-stats', sessionId],
    queryFn: () => kdvApi.getStats(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 3000,
  });
  const { data: results = [] } = useQuery<any[]>({
    queryKey: ['kdv-results', sessionId],
    queryFn: () => kdvApi.getResults(sessionId!),
    enabled: !!sessionId,
  });
  const { data: images = [] } = useQuery<any[]>({
    queryKey: ['kdv-images', sessionId],
    queryFn: () => kdvApi.getImages(sessionId!),
    enabled: !!sessionId,
    refetchInterval: (q: any) => {
      const d = q?.state?.data;
      return Array.isArray(d) && d.some((i: any) => ['PENDING', 'PROCESSING'].includes(i.ocrStatus)) ? 3000 : 8000;
    },
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);
  const processingCount = images.filter((i: any) => ['PENDING', 'PROCESSING'].includes(i.ocrStatus)).length;
  const pendingOcrCount = images.filter((i: any) => i.ocrStatus === 'PENDING').length;
  /** OCR'ı başarıyla tamamlanmış (veya teyit edilmiş) fatura sayısı */
  const readCount = images.filter(
    (i: any) =>
      i.ocrStatus === 'SUCCESS' ||
      i.ocrStatus === 'NEEDS_REVIEW' ||
      i.ocrStatus === 'LOW_CONFIDENCE' ||
      i.isManuallyConfirmed,
  ).length;
  const hasRecords = (stats?.totalRecords ?? 0) > 0;
  const hasImages = (stats?.totalImages ?? 0) > 0;
  const ocrDone = hasImages && pendingOcrCount === 0 && processingCount === 0;

  // ── MUTASYONLAR ─────────────────────────────────────
  const ensureSession = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) throw new Error('Önce mükellef seçin');
      const { session } = await kdvApi.findOrCreateSession({
        type,
        periodLabel,
        taxpayerId,
      });
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      return session as { id: string };
    },
  });

  /** Mükellef yoksa picker'ı aç, varsa action'ı çalıştır. Butonları
   *  "her zaman aktif" yapmak için aksiyon mutation'larını bu guard'dan
   *  geçiriyoruz. */
  const requireMukellef = (run: () => void) => {
    if (!taxpayerId) {
      toast.message('Önce mükellef seçin');
      setPickerOpen(true);
      return;
    }
    run();
  };

  // === EXCEL UPLOAD + KOLON MAPPING ===
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const [mappingModal, setMappingModal] = useState<null | {
    file: File;
    preview: {
      sheetName: string;
      sheetNames: string[];
      columns: string[];
      rowCount: number;
      sampleRows: Record<string, any>[];
      suggestedMapping: {
        tarihCol?: string;
        belgeNoCol?: string;
        kdvCol?: string;
      };
    };
    tarihCol: string;
    belgeNoCol: string;
    kdvCol: string;
  }>(null);
  const [mappingSubmitting, setMappingSubmitting] = useState(false);

  const openExcelPicker = () => excelFileInputRef.current?.click();

  const handleExcelSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // aynı dosyayı tekrar seçebilmek için
    if (!file) return;
    const s = await ensureSession.mutateAsync();
    pushFeed({ group: 'luca', kind: 'info', title: 'Excel yükleniyor…', detail: file.name });
    try {
      const preview = await kdvApi.previewExcel(s.id, file);
      setMappingModal({
        file,
        preview,
        tarihCol: preview.suggestedMapping.tarihCol || '',
        belgeNoCol: preview.suggestedMapping.belgeNoCol || '',
        kdvCol: preview.suggestedMapping.kdvCol || '',
      });
      pushFeed({ group: 'luca', kind: 'info', title: 'Sütunlar tespit edildi', detail: `${preview.columns.length} sütun · ${preview.rowCount} satır` });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Excel okunamadı';
      pushFeed({ group: 'luca', kind: 'err', title: 'Excel preview hatası', detail: msg });
      toast.error(msg);
    }
  };

  const submitMapping = async () => {
    if (!mappingModal || !sessionId) return;
    if (!mappingModal.tarihCol || !mappingModal.belgeNoCol || !mappingModal.kdvCol) {
      toast.error('Üç sütunu da seç');
      return;
    }
    setMappingSubmitting(true);
    try {
      const r = await kdvApi.importExcelMapped(sessionId, mappingModal.file, {
        tarihCol: mappingModal.tarihCol,
        belgeNoCol: mappingModal.belgeNoCol,
        kdvCol: mappingModal.kdvCol,
        sheetName: mappingModal.preview.sheetName,
      });
      clearFeedErrorsInGroup('luca');
      pushFeed({ group: 'luca', kind: 'ok', title: `${r.imported} satır yüklendi`, detail: r.skipped > 0 ? `${r.skipped} satır atlandı (KDV boş/0)` : undefined });
      toast.success(`${r.imported} satır yüklendi`);
      setMappingModal(null);
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-records', sessionId] });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Import hatası';
      toast.error(msg);
      pushFeed({ group: 'luca', kind: 'err', title: 'Import hatası', detail: msg });
    } finally {
      setMappingSubmitting(false);
    }
  };

  /**
   * Faturaları Çek → linkMihsapInvoices, ardından otomatik OCR başlat.
   * Tek tıklamayla iki iş zincirlenir; kullanıcı ayrı OCR butonuna
   * basmak zorunda kalmaz.
   */
  const runFaturalar = useMutation({
    mutationFn: async () => {
      const s = await ensureSession.mutateAsync();
      pushFeed({ group: 'faturalar', kind: 'info', title: 'Portaldaki faturalar bağlanıyor…', detail: `${periodLabel} · ${TYPE_LABEL[type]}` });
      const linkResult: any = await kdvApi.linkMihsapInvoices(s.id);
      clearFeedErrorsInGroup('faturalar');
      pushFeed({ group: 'faturalar', kind: 'ok', title: `${linkResult.linked} fatura bağlandı`, detail: `Toplam ${linkResult.total} · yeni eklenen ${linkResult.linked}` });

      // Zincir: OCR otomatik başlasın
      pushFeed({ group: 'ocr', kind: 'info', title: 'OCR başlatılıyor…', detail: 'Fatura görsellerinden tarih / belge no / KDV okunuyor' });
      try {
        const ocrResult: any = await kdvApi.startOcr(s.id);
        clearFeedErrorsInGroup('ocr');
        pushFeed({ group: 'ocr', kind: 'ok', title: `${ocrResult.queued} OCR işi başladı`, detail: 'Faturalar sırayla okunuyor, sayaç güncellenecek' });
      } catch (ocrErr: any) {
        pushFeed({ group: 'ocr', kind: 'err', title: 'OCR başlatılamadı', detail: ocrErr?.response?.data?.message || ocrErr?.message || 'bilinmeyen hata' });
      }

      return linkResult;
    },
    onSuccess: (d: any) => {
      toast.success(`${d.linked} fatura bağlandı · OCR başladı`);
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Faturalar bağlanamadı';
      pushFeed({ group: 'faturalar', kind: 'err', title: 'Fatura bağlama hatası', detail: msg });
      toast.error(msg);
    },
  });

  /** Manuel "Tekrar OCR'la" — OCR sayacının yanındaki küçük link için. */
  const runOcrAgain = useMutation({
    mutationFn: async () => {
      const s = await ensureSession.mutateAsync();
      pushFeed({ group: 'ocr', kind: 'info', title: 'OCR yeniden başlatılıyor…', detail: `${pendingOcrCount} bekleyen fatura` });
      return kdvApi.startOcr(s.id);
    },
    onSuccess: (d: any) => {
      clearFeedErrorsInGroup('ocr');
      pushFeed({ group: 'ocr', kind: 'ok', title: `${d.queued} OCR işi başladı`, detail: 'Faturalar yeniden okunuyor' });
      toast.success(`${d.queued} OCR başlatıldı`);
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'OCR başlatılamadı';
      pushFeed({ group: 'ocr', kind: 'err', title: 'OCR hatası', detail: msg });
      toast.error(msg);
    },
  });

  const runReconcile = useMutation({
    mutationFn: async () => {
      const s = await ensureSession.mutateAsync();
      pushFeed({ group: 'kontrol', kind: 'info', title: 'Eşleştirme başladı', detail: `Luca × Fatura karşılaştırması` });
      seenResultIdsRef.current.clear();
      return kdvApi.reconcile(s.id);
    },
    onSuccess: (d: any) => {
      clearFeedErrorsInGroup('kontrol');
      pushFeed({ group: 'kontrol', kind: 'ok', title: 'Kontrol tamamlandı', detail: `${d.matched} eşleşti · ${d.unmatched} eşleşmedi · ${d.needsReview} inceleme` });
      toast.success(`Eşleştirme: ${d.matched} ✓  ${d.unmatched} ✗`);
      qc.invalidateQueries({ queryKey: ['kdv-results', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Eşleştirme başarısız';
      pushFeed({ group: 'kontrol', kind: 'err', title: 'Eşleştirme hatası', detail: msg });
      toast.error(msg);
    },
  });

  /**
   * Sonuçlar DB'den her çekildiğinde yeni gelenleri feed'e animasyonla ekle.
   * Böylece kullanıcı reconcile bastıktan sonra "canlı akış" görür.
   */
  useEffect(() => {
    if (!results?.length) return;
    const newOnes = (results as any[]).filter((r) => !seenResultIdsRef.current.has(r.id));
    if (newOnes.length === 0) return;

    newOnes.forEach((r, i) => {
      seenResultIdsRef.current.add(r.id);
      // Animasyonla sırayla ekle (her 80ms'de bir)
      setTimeout(() => {
        const kind: FeedItem['kind'] =
          r.status === 'MATCHED' ? 'ok'
          : r.status === 'UNMATCHED' ? 'err'
          : 'warn';
        const belgeNo = r.kdvRecord?.belgeNo || r.image?.confirmedBelgeNo || r.image?.ocrBelgeNo || '—';
        const tutar = r.kdvRecord?.kdvTutari
          ? parseFloat(r.kdvRecord.kdvTutari).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })
          : r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari || '—';
        const title =
          r.status === 'MATCHED' ? `✓ ${belgeNo} · ${tutar}`
          : r.status === 'UNMATCHED' && !r.image ? `✗ ${belgeNo} · Fatura bulunamadı`
          : r.status === 'UNMATCHED' && !r.kdvRecord ? `✗ ${belgeNo} · Luca kaydı yok`
          : `⚠ ${belgeNo} · ${tutar}`;
        const detail = r.mismatchReasons?.join(' · ') || (
          r.status === 'MATCHED' ? `Skor %${Math.round((r.matchScore ?? 0) * 100)}` : ''
        );
        pushFeed({ kind, title, detail, resultId: r.id });
      }, i * 80);
    });
  }, [results]);

  // Feed değiştikçe aşağı kaydır
  useEffect(() => {
    if (feedScrollRef.current) {
      feedScrollRef.current.scrollTop = feedScrollRef.current.scrollHeight;
    }
  }, [feed.length]);

  const exportExcel = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('Önce bir kontrol başlatın');
      const ab = await kdvApi.exportExcel(sessionId);
      const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kdv-kontrol-${periodLabel.replace('/', '-')}-${action}.xlsx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      qc.invalidateQueries({ queryKey: ['kdv-outputs'] });
    },
    onError: () => toast.error('Excel indirilemedi'),
  });

  const deleteSessionMut = useMutation({
    mutationFn: (id: string) => kdvApi.deleteSession(id),
    onSuccess: () => {
      toast.success('Seans silindi');
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
    },
  });

  const downloadOutput = useMutation({
    mutationFn: async (o: { id: string; filename: string }) => {
      const ab = await kdvApi.downloadOutput(o.id);
      const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = o.filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });

  const deleteOutput = useMutation({
    mutationFn: (id: string) => kdvApi.deleteOutput(id),
    onSuccess: () => {
      toast.success('Çıktı silindi');
      qc.invalidateQueries({ queryKey: ['kdv-outputs'] });
    },
  });

  // ── PICKER LIST ─────────────────────────────────────
  const filteredTaxpayers = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  // ── RENDER ──────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <Sparkles size={10} className="inline mr-1" /> Kontrol
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            KDV Kontrol
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Mükellef seç, dönem ver, Luca muavini ile portaldaki faturaları tek tuşla eşleştir
          </p>
        </div>
      </div>

      {/* KOMUT BARI */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex items-start gap-4 flex-wrap">
          {/* Dönem */}
          <div className="flex-shrink-0">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <Calendar size={11} className="inline mr-1" /> Dönem
            </label>
            <input
              type="month"
              value={ay}
              onChange={(e) => setAy(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-base font-semibold border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9', minWidth: 170 }}
            />
          </div>

          {/* 4 kontrol türü */}
          <div className="flex-shrink-0">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Defter / İşlem
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(ACTION_LABEL) as KdvAction[]).map((k) => {
                const active = action === k;
                const c = ACTION_COLOR[k];
                return (
                  <button
                    key={k}
                    onClick={() => setAction(k)}
                    className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap"
                    style={{
                      background: active ? c + '26' : 'rgba(255,255,255,0.03)',
                      borderColor: active ? c : 'rgba(255,255,255,0.05)',
                      color: active ? c : '#fafaf9',
                    }}
                  >
                    {ACTION_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mükellef */}
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border flex items-center gap-2 text-left hover:brightness-110 transition"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate font-medium">
                {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
              </span>
              {selectedTp && (
                <span
                  onClick={(e) => { e.stopPropagation(); setTaxpayerId(''); }}
                  className="p-0.5 rounded hover:bg-white/10"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            </button>
          </div>
        </div>

        {/* AKSİYON BUTONLARI (3 adım — OCR otomatik) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 pt-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <ActionBtn
            icon={Upload}
            label="Luca Excel Yükle"
            sub={hasRecords ? `${stats?.totalRecords} satır yüklü` : !taxpayerId ? 'Önce mükellef seçin' : 'Muavin defter .xlsx'}
            color="#2563eb"
            done={hasRecords}
            onClick={() => requireMukellef(openExcelPicker)}
            loading={ensureSession.isPending}
          />
          <input
            ref={excelFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleExcelSelected}
          />
          <ActionBtn
            icon={ImageIcon}
            label="Faturaları Çek"
            sub={
              hasImages && ocrDone ? `${stats?.totalImages} fatura · OCR tamam`
              : processingCount > 0 ? `${readCount}/${stats?.totalImages} okunuyor…`
              : hasImages ? `${stats?.totalImages} fatura bağlı · OCR başladı`
              : !taxpayerId ? 'Önce mükellef seçin'
              : 'Portaldaki faturalar + otomatik OCR'
            }
            color="#a855f7"
            done={hasImages && ocrDone}
            onClick={() => requireMukellef(() => runFaturalar.mutate())}
            loading={runFaturalar.isPending || ensureSession.isPending}
          />
          <ActionBtn
            icon={Play}
            label="Kontrolü Başlat"
            sub={(results as any[]).length > 0 ? `${(results as any[]).length} sonuç` : 'Luca ↔ Fatura eşleştirme'}
            color={GOLD}
            filled
            onClick={() => {
              if (!taxpayerId) return requireMukellef(() => runReconcile.mutate());
              if (!hasRecords) return toast.error('Önce Luca\'dan veri çekin');
              if (!hasImages) return toast.error('Önce faturaları bağlayın');
              if (!ocrDone) return toast.error('OCR devam ediyor, birazdan tekrar deneyin');
              runReconcile.mutate();
            }}
            loading={runReconcile.isPending}
          />
        </div>
      </div>

      {/* AKTİF SEANS SAYAÇLARI */}
      {activeSession && stats && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2.5">
              <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
              <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
                Aktif Seans · {selectedTp ? taxpayerName(selectedTp) : 'Mükellef yok'} · {periodLabel} · {TYPE_LABEL[type]}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {processingCount > 0 ? (
                <>
                  <Loader2 size={12} className="animate-spin" style={{ color: '#60a5fa' }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#60a5fa' }}>OCR Çalışıyor</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.8)' }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Hazır</span>
                </>
              )}
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { key: 'luca',    label: 'Luca Satırı',     val: stats.totalRecords, color: GOLD,       icon: FileText },
                { key: 'uploaded',label: 'Yüklenen Fatura', val: stats.totalImages,  color: '#a855f7',  icon: ImageIcon },
                { key: 'read',    label: 'Okunan Fatura',   val: readCount,          color: '#60a5fa',  icon: ScanLine, showRerun: hasImages },
                { key: 'matched', label: 'Eşleşen',         val: stats.matched,      color: '#22c55e',  icon: CheckCircle2 },
                { key: 'pending', label: 'OCR Teyit Bekler', val: (stats.needsOcrConfirm ?? 0) + (stats.needsReview ?? 0), color: '#f59e0b', icon: AlertTriangle },
              ].map(({ key, label, val, color, icon: Icon, showRerun }) => (
                <div key={key} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center justify-between mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    <span className="flex items-center gap-1.5">
                      <Icon size={12} style={{ color }} /> {label}
                    </span>
                    {showRerun && (
                      <button
                        onClick={() => runOcrAgain.mutate()}
                        disabled={runOcrAgain.isPending}
                        title="OCR'ı tekrar çalıştır"
                        className="text-[10px] normal-case font-semibold px-1.5 py-0.5 rounded hover:brightness-125 transition"
                        style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa' }}
                      >
                        {runOcrAgain.isPending ? '…' : '⟳'}
                      </button>
                    )}
                  </div>
                  <p className="leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: '#fafaf9' }}>
                    {val ?? 0}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              {(results as any[]).length > 0 && (
                <button
                  onClick={() => exportExcel.mutate()}
                  disabled={exportExcel.isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold rounded-[9px]"
                  style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}
                >
                  <Download size={12} /> Excel İndir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OCR TEYİT PANELİ — düşük güvenli alanlar için kullanıcı incelemesi */}
      {activeSession?.id && (
        <OcrReviewPanel sessionId={activeSession.id} images={images as any} />
      )}

      {/* CANLI KONTROL AKIŞI — her zaman görünür */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2.5">
              <Zap size={14} style={{ color: GOLD }} />
              <div>
                <h3 className="text-[13.5px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
                  Canlı Kontrol Akışı
                  {runReconcile.isPending && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>
                      <Loader2 size={9} className="animate-spin" /> Çalışıyor
                    </span>
                  )}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Eşleşen · uyuşmazlık · eksik kayıtlar canlı akar
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <FeedCount kind="ok" label="Eşleşti" count={feed.filter((f) => f.kind === 'ok' && f.resultId).length} />
              <FeedCount kind="warn" label="İnceleme" count={feed.filter((f) => f.kind === 'warn').length} />
              <FeedCount kind="err" label="Sorun" count={feed.filter((f) => f.kind === 'err').length} />
              {feed.length > 0 && (
                <button
                  onClick={() => { setFeed([]); seenResultIdsRef.current.clear(); }}
                  className="ml-1 text-[10px] px-2 py-1 rounded"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.45)' }}
                >
                  Temizle
                </button>
              )}
            </div>
          </div>
          <div
            ref={feedScrollRef}
            className="p-2 space-y-1 max-h-[420px] overflow-y-auto"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >
            {feed.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: 'rgba(250,250,249,0.35)' }}>
                Henüz akış yok. Yukarıdaki butonlara bastıkça burada detaylı log görünür.
              </div>
            ) : (
              feed.map((f: FeedItem, i: number) => (
                <div key={i}>
                  <FeedRow item={f} />
                </div>
              ))
            )}
          </div>
        </div>

      {/* GEÇMİŞ KONTROLLER */}
      {allSessions.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Geçmiş Kontroller
          </h3>
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Tarih</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Tip</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Luca</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Fatura</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-right" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {allSessions.slice(0, 15).map((s: any, idx: number) => (
                  <tr key={s.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtDate(s.createdAt)}</td>
                    <td className="px-4 py-3 text-[12.5px] font-medium" style={{ color: '#fafaf9' }}>
                      {s.taxpayer ? (s.taxpayer.companyName || `${s.taxpayer.firstName ?? ''} ${s.taxpayer.lastName ?? ''}`.trim()) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.65)' }}>{s.periodLabel ?? '—'}</td>
                    <td className="px-4 py-3 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{TYPE_LABEL[s.type] || s.type}</td>
                    <td className="px-4 py-3 text-center tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{s._count?.kdvRecords ?? 0}</td>
                    <td className="px-4 py-3 text-center tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{s._count?.images ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/panel/kdv-kontrol/${s.id}`}
                          className="p-1.5 rounded-md"
                          style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }}
                          title="Detay"
                        >
                          <ArrowRight size={14} />
                        </Link>
                        <button
                          onClick={() => {
                            if (confirm('Bu seansı silmek istediğinize emin misiniz?')) deleteSessionMut.mutate(s.id);
                          }}
                          className="p-1.5 rounded-md"
                          style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
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
        </div>
      )}

      {/* KAYITLI ÇIKTILAR */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Kayıtlı Çıktılar
          {outputs.length > 0 && (
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
              {outputs.length}
            </span>
          )}
        </h3>
        {outputs.length === 0 ? (
          <div className="rounded-2xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="w-12 h-12 mx-auto mb-2 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <Archive size={20} style={{ color: 'rgba(250,250,249,0.35)' }} />
            </div>
            <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Henüz kayıtlı Excel çıktısı yok</p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.35)' }}>Bir kontrol Excel'i indirildiğinde burada arşivlenir</p>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Tarih</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Tip</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Eşleşen</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Uyuşmaz.</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-right" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((o: any, idx: number) => (
                  <tr key={o.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-3 text-[12.5px] font-medium" style={{ color: '#fafaf9' }}>{o.mukellefName ?? '—'}</td>
                    <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.65)' }}>{o.donem ?? '—'}</td>
                    <td className="px-4 py-3 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{TYPE_LABEL[o.tip] || o.tip || '—'}</td>
                    <td className="px-4 py-3 text-center tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 600, color: '#22c55e' }}>{o.matchedCount}</td>
                    <td className="px-4 py-3 text-center tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 600, color: o.unmatchedCount > 0 ? '#f43f5e' : 'rgba(250,250,249,0.35)' }}>{o.unmatchedCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => downloadOutput.mutate({ id: o.id, filename: o.filename })}
                          disabled={downloadOutput.isPending}
                          className="p-1.5 rounded-md"
                          style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }}
                          title="Excel indir"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm('Bu çıktıyı silmek istediğinize emin misiniz?')) deleteOutput.mutate(o.id); }}
                          className="p-1.5 rounded-md"
                          style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
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
      </div>

      {/* MÜKELLEF PICKER MODAL */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]"
          style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'linear-gradient(135deg, rgba(184,160,111,.08), transparent)' }}>
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>{taxpayers.length} mükellef</p>
              </div>
              <button onClick={() => setPickerOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5" style={{ color: 'rgba(250,250,249,0.45)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}>
                <Search size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
                <input
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Mükellef adı ara…"
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: '#fafaf9' }}
                />
                {pickerSearch && (
                  <button onClick={() => setPickerSearch('')} style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredTaxpayers.length === 0 ? (
                <div className="text-sm p-8 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>Sonuç yok</div>
              ) : (
                filteredTaxpayers.map((t) => {
                  const checked = taxpayerId === t.id;
                  const name = taxpayerName(t);
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTaxpayerId(t.id); setPickerOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left transition-colors"
                      style={{ background: checked ? 'rgba(184,160,111,.08)' : 'transparent', color: '#fafaf9' }}
                      onMouseEnter={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)'; }}
                      onMouseLeave={(e) => { if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: checked ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)', color: checked ? '#0f0d0b' : 'rgba(250,250,249,0.45)' }}>
                        {initial}
                      </div>
                      <span className="flex-1 truncate font-medium">{name}</span>
                      {t.taxNumber && (
                        <span className="text-[10px] px-2 py-0.5 rounded tabular-nums" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.45)' }}>
                          {t.taxNumber}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* === EXCEL KOLON MAPPING MODALI === */}
      {mappingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-4xl rounded-2xl p-6 relative max-h-[92vh] overflow-y-auto"
            style={{ background: '#1a1a19', border: '1px solid rgba(212,184,118,0.25)' }}
          >
            <button
              onClick={() => !mappingSubmitting && setMappingModal(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-300"
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
            <h3 className="text-lg font-semibold mb-1" style={{ color: GOLD }}>
              Excel Sütun Eşleştirme
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              <strong>{mappingModal.file.name}</strong> · {mappingModal.preview.rowCount} satır · {mappingModal.preview.columns.length} sütun
              {mappingModal.preview.sheetNames.length > 1 && ` · Sheet: ${mappingModal.preview.sheetName}`}
            </p>

            {/* 3 sütun seçici */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {([
                ['tarihCol', 'TARİH sütunu', 'Evrak/belge tarihi'],
                ['belgeNoCol', 'EVRAK NO sütunu', 'Fatura/fiş numarası'],
                ['kdvCol', 'KDV sütunu', 'KDV tutarı (borç/alacak)'],
              ] as const).map(([key, label, hint]) => (
                <div key={key}>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(250,250,249,0.75)' }}>
                    {label}
                  </label>
                  <select
                    value={mappingModal[key]}
                    onChange={(e) => setMappingModal({ ...mappingModal, [key]: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      borderColor: 'rgba(255,255,255,0.12)',
                      color: '#fafaf9',
                    }}
                  >
                    <option value="">— sütun seç —</option>
                    {mappingModal.preview.columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">{hint}</p>
                </div>
              ))}
            </div>

            {/* Örnek satırlar */}
            <div className="mb-5">
              <p className="text-xs font-semibold mb-2" style={{ color: GOLD }}>
                Örnek Satırlar (ilk {Math.min(mappingModal.preview.sampleRows.length, 5)})
              </p>
              <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      {mappingModal.preview.columns.map((c) => {
                        const highlight =
                          c === mappingModal.tarihCol
                            ? { bg: 'rgba(59,130,246,0.12)', tag: 'TARİH' }
                            : c === mappingModal.belgeNoCol
                              ? { bg: 'rgba(168,85,247,0.12)', tag: 'EVRAK NO' }
                              : c === mappingModal.kdvCol
                                ? { bg: 'rgba(212,184,118,0.12)', tag: 'KDV' }
                                : null;
                        return (
                          <th
                            key={c}
                            className="px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                            style={{
                              color: highlight ? GOLD : 'rgba(250,250,249,0.6)',
                              background: highlight?.bg,
                              borderBottom: '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            {highlight && <span className="mr-1 text-[9px] px-1 rounded" style={{ background: GOLD, color: '#1a1a19' }}>{highlight.tag}</span>}
                            {c}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {mappingModal.preview.sampleRows.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {mappingModal.preview.columns.map((c) => (
                          <td key={c} className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.75)' }}>
                            {row[c] != null ? String(row[c]).slice(0, 30) : <span style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMappingModal(null)}
                disabled={mappingSubmitting}
                className="btn-secondary text-sm"
              >
                İptal
              </button>
              <button
                onClick={submitMapping}
                disabled={
                  mappingSubmitting ||
                  !mappingModal.tarihCol ||
                  !mappingModal.belgeNoCol ||
                  !mappingModal.kdvCol
                }
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {mappingSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Yükle ve Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KÜÇÜK KOMPONENTLER ───────────────────────────────

function ActionBtn({
  icon: Icon, label, sub, color, done, filled, onClick, loading, disabled,
}: {
  icon: any; label: string; sub: string; color: string;
  done?: boolean; filled?: boolean;
  onClick: () => void; loading?: boolean; disabled?: boolean;
}) {
  const bg = filled
    ? `linear-gradient(135deg, ${color}, ${color}cc)`
    : done
    ? `${color}1a`
    : 'rgba(255,255,255,0.03)';
  const border = filled ? color : done ? color + '55' : 'rgba(255,255,255,0.05)';
  const textColor = filled ? '#0f0d0b' : '#fafaf9';
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="rounded-xl border p-4 text-left transition disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
      style={{ background: bg, borderColor: border }}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: filled ? 'rgba(15,13,11,0.15)' : color + '22', color: filled ? textColor : color }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
        </div>
        <p className="font-bold text-[13px]" style={{ color: textColor }}>{label}</p>
        {done && !filled && <CheckCircle2 size={14} style={{ color, marginLeft: 'auto' }} />}
      </div>
      <p className="text-[11.5px] leading-snug" style={{ color: filled ? 'rgba(15,13,11,0.7)' : 'rgba(250,250,249,0.55)' }}>
        {sub}
      </p>
    </button>
  );
}

function FeedCount({ kind, label, count }: { kind: FeedItem['kind']; label: string; count: number }) {
  const colors: Record<FeedItem['kind'], string> = {
    ok: '#22c55e',
    warn: '#f59e0b',
    err: '#f43f5e',
    info: '#60a5fa',
  };
  const c = colors[kind];
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold tabular-nums px-2 py-0.5 rounded" style={{ background: c + '1a', color: c }}>
      {label}: {count}
    </span>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const colors: Record<FeedItem['kind'], { c: string; bg: string; icon: string }> = {
    ok:   { c: '#22c55e', bg: 'rgba(34,197,94,0.06)',  icon: '✓' },
    warn: { c: '#f59e0b', bg: 'rgba(245,158,11,0.06)', icon: '⚠' },
    err:  { c: '#f43f5e', bg: 'rgba(244,63,94,0.06)',  icon: '✗' },
    info: { c: '#60a5fa', bg: 'rgba(96,165,250,0.06)', icon: '●' },
  };
  const s = colors[item.kind];
  const time = new Date(item.ts).toLocaleTimeString('tr-TR', { hour12: false });
  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-lg text-[12px] animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{ background: s.bg, borderLeft: `2px solid ${s.c}` }}
    >
      <span className="text-[10px] tabular-nums flex-shrink-0 mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
        {time}
      </span>
      <span className="font-bold flex-shrink-0" style={{ color: s.c, width: 14 }}>
        {s.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight" style={{ color: '#fafaf9' }}>
          {item.title}
        </div>
        {item.detail && (
          <div className="text-[11px] mt-0.5 leading-tight" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {item.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    MATCHED:       { label: 'Eşleşti',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    PARTIAL_MATCH: { label: 'Kısmi',      color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    NEEDS_REVIEW:  { label: 'İnceleme',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    UNMATCHED:     { label: 'Eşleşmedi',  color: '#f43f5e', bg: 'rgba(244,63,94,0.15)' },
    CONFIRMED:     { label: 'Teyit',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    REJECTED:      { label: 'Red',        color: 'rgba(250,250,249,0.5)', bg: 'rgba(255,255,255,0.05)' },
  };
  const s = map[status] ?? map.UNMATCHED;
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

