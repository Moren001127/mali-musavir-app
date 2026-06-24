'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Play, Calendar, Users, Search, CheckCircle2, Loader2, Clock, FileSpreadsheet,
  ImageIcon, ScanLine, ChevronDown, X, Sparkles, Download, Trash2, Archive,
  ArrowRight, Activity, AlertTriangle, XCircle, FileText, Zap, Upload,
  Lock, Unlock, ShieldCheck,
} from 'lucide-react';
import { OcrReviewPanel } from '@/components/kdv/OcrReviewPanel';
import { MatchReviewPanel } from '@/components/kdv/MatchReviewPanel';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import { useLucaAgent } from '@/hooks/useLucaAgent';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const KDV_STEEL = '#8db6c6';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wakeLucaAgentForFetch(onStatus?: (status: string) => void) {
  if (typeof window === 'undefined') return false;
  const bridge = (window as any).__morenAutoAgent;
  if (!bridge) return false;
  try {
    onStatus?.('Luca ajani uyandiriliyor; acik Luca sekmesine guncel runtime yukleniyor...');
    if (typeof bridge.setAgentToken === 'function') {
      const tokenInfo = await api.get('/agent/me/token').then((r) => r.data).catch(() => null);
      if (tokenInfo?.token) await bridge.setAgentToken(tokenInfo.token).catch(() => null);
    }
    if (typeof bridge.openAgent === 'function') {
      await bridge.openAgent('luca', { focus: false, create: false, navigate: false });
    } else if (typeof bridge.restartAll === 'function') {
      await bridge.restartAll();
    } else {
      return false;
    }
    await wait(5200);
    return true;
  } catch (e) {
    console.warn('[KDV Kontrol] Luca agent uyandirma basarisiz:', e);
    return false;
  }
}

/** Canlı akış (log) satırı */
type FeedItem = {
  ts: number;
  kind: 'ok' | 'warn' | 'err' | 'info';
  title: string;
  detail?: string;
  resultId?: string;
  /** Aynı faturanın duplicate sayılmaması için event kaynağı imageId */
  imageId?: string;
  /** Stale hata temizleme için: "luca" | "faturalar" | "ocr" | "kontrol" */
  group?: string;
};

/** Kullanıcının istediği terminoloji */
type KdvAction = 'BILANCO_ALIS' | 'BILANCO_SATIS' | 'ISLETME_ALIS' | 'ISLETME_SATIS';
type LucaQueuedJob = { id: string; action: KdvAction; sessionId: string };
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
  /** Mükellef kartından gelen defter türü — 'BILANCO' | 'ISLETME' | null */
  defterTuru?: 'BILANCO' | 'ISLETME' | null;
}

/**
 * Bir KDV aksiyonu, mükellefin defter türüyle uyumlu mu?
 * - defterTuru BILANCO → sadece BILANCO_* aksiyonları
 * - defterTuru ISLETME → sadece ISLETME_* aksiyonları
 * - defterTuru null/undefined → hepsi geçerli (kart doldurulmamış)
 */
function isActionCompatible(action: KdvAction, defterTuru?: 'BILANCO' | 'ISLETME' | null): boolean {
  if (!defterTuru) return true;
  if (defterTuru === 'BILANCO') return action === 'BILANCO_ALIS' || action === 'BILANCO_SATIS';
  if (defterTuru === 'ISLETME') return action === 'ISLETME_ALIS' || action === 'ISLETME_SATIS';
  return true;
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
  const searchParams = useSearchParams();
  const { preferredDeviceId } = useLucaAgent();
  const router = useRouter();

  // ── STATE ───────────────────────────────────────────
  const now = new Date();
  const prevMonth = now.getMonth() === 0
    ? new Date(now.getFullYear() - 1, 11)
    : new Date(now.getFullYear(), now.getMonth() - 1);
  const [ay, setAy] = useState(() => `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`);
  const [selectedActions, setSelectedActions] = useState<KdvAction[]>([]);
  const [taxpayerId, setTaxpayerId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  /** Geçmiş Kontroller'den Detay tıklayınca ?s=<sessionId> gelir — o seansa zıplarız */
  const [pendingRestoreSessionId, setPendingRestoreSessionId] = useState<string | null>(
    () => searchParams?.get('s') || null,
  );
  // URL param'ı her değiştiğinde (Next Link soft-nav dahil) state'i yenile
  useEffect(() => {
    const sParam = searchParams?.get('s');
    if (sParam) setPendingRestoreSessionId(sParam);
  }, [searchParams]);

  // ── Canlı akış için state ───────────────────────────
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const seenResultIdsRef = useRef<Set<string>>(new Set());
  /**
   * Seans yüklendikten sonra ilk veri çekilişinde mevcut result'ları
   * feed'e akıtmadan "görülmüş" işaretler. Böylece kullanıcı daha önce
   * çalışmış bir seansa geri dönünce eski sonuçlar "yeniymiş gibi"
   * tekrar animasyonla akmaz.
   */
  const resultsSeededRef = useRef<boolean>(false);
  /** imageId → son görülen ocrStatus. Status değişince bir feed satırı üretilir. */
  const seenImageStatusRef = useRef<Map<string, string>>(new Map());

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

  /**
   * Geçmiş Kontroller'den "Detay" tıklanınca URL'de ?s=<sessionId> gelir.
   * Session listesi yüklendiğinde o seansın taxpayer + dönem + tip bilgilerini
   * state'e yaz → ilgili seans aktif olur. Sonra URL'i temizle.
   */
  useEffect(() => {
    if (!pendingRestoreSessionId || allSessions.length === 0) return;
    const target = allSessions.find((s: any) => s.id === pendingRestoreSessionId);
    if (!target) return;
    // type → action
    const typeToAction: Record<string, KdvAction> = {
      KDV_191: 'BILANCO_ALIS',
      KDV_391: 'BILANCO_SATIS',
      ISLETME_GELIR: 'ISLETME_SATIS',
      ISLETME_GIDER: 'ISLETME_ALIS',
    };
    if (target.taxpayerId) setTaxpayerId(target.taxpayerId);
    if (target.type && typeToAction[target.type]) setSelectedActions([typeToAction[target.type]]);
    if (target.periodLabel) {
      // "2026/03" → "2026-03"
      const parts = String(target.periodLabel).split('/');
      if (parts.length === 2) setAy(`${parts[0]}-${parts[1].padStart(2, '0')}`);
    }
    setPendingRestoreSessionId(null);
    // URL'den ?s='i temizle
    router.replace('/panel/kdv-kontrol');
    toast.success('Detay yüklendi');
    // Sayfanın üstüne kaydır
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pendingRestoreSessionId, allSessions, router]);
  const { data: outputs = [] } = useQuery<any[]>({
    queryKey: ['kdv-outputs'],
    queryFn: kdvApi.listOutputs,
  });

  // Seçime göre aktif seansı bul (taxpayer + donem + tip)
  const action = selectedActions[0] ?? 'BILANCO_ALIS';
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
  const activeLocked = activeSession?.status === 'COMPLETED';

  // Seans değişince canlı akış buffer'ını sıfırla — önceki seansın event'leri yeni seansa
  // sızmasın (aksi halde "Eşleşti: 126" gibi kümülatif sayıları görürsün).
  useEffect(() => {
    setFeed([]);
    seenResultIdsRef.current.clear();
    resultsSeededRef.current = false;
    seenImageStatusRef.current.clear();
  }, [sessionId]);

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
      return Array.isArray(d) && d.some((i: any) =>
        ['PENDING', 'PROCESSING'].includes(i.ocrStatus) || i.contentAuditStatus === 'PROCESSING',
      ) ? 3000 : 8000;
    },
  });

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  // Mükellef seçildiğinde defter türüne göre selectedActions'ı otomatik ayarla:
  // - Hiçbir aksiyon seçili değilse defter türüne uygun varsayılanı koy
  // - Seçili aksiyonlardan uyumsuz olanları çıkar
  // - defterTuru bilinmiyorsa (kart eksik) hiçbir şey yapma — kullanıcı manuel seçer
  useEffect(() => {
    const dt = selectedTp?.defterTuru;
    if (!dt) return;
    const defaultAction: KdvAction = dt === 'BILANCO' ? 'BILANCO_ALIS' : 'ISLETME_ALIS';
    setSelectedActions((prev) => {
      if (prev.length === 0) return [defaultAction];
      const filtered = prev.filter((a) => isActionCompatible(a, dt));
      if (filtered.length === prev.length) return prev;
      if (filtered.length > 0) return filtered;
      return [defaultAction];
    });
  }, [selectedTp?.defterTuru]);

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
  const contentAuditStats = (stats as any)?.contentAudit || {};
  const contentAuditProcessingCount = images.filter((i: any) => i.contentAuditStatus === 'PROCESSING').length;
  const contentAuditDoneCount =
    Number(contentAuditStats.done ?? images.filter((i: any) => i.contentAuditStatus === 'DONE').length);
  const contentAuditFailedCount =
    Number(contentAuditStats.failed ?? images.filter((i: any) => i.contentAuditStatus === 'FAILED').length);
  const contentAuditFallbackCount =
    Number(contentAuditStats.fallback ?? images.filter((i: any) => i.contentAuditModel === 'rule-fallback').length);
  const contentAuditRuleBasedCount =
    Number(contentAuditStats.ruleBased ?? images.filter((i: any) => i.contentAuditModel === 'rule-based').length);
  const contentAuditProviderIssueCount =
    Number(contentAuditStats.providerIssue ?? (contentAuditFallbackCount + contentAuditFailedCount));
  // AI ile gerçekten yorumlanan belge sayısı (kural-fallback / kural / hata dışı).
  const contentAuditAiOkCount = Math.max(
    0,
    contentAuditDoneCount - contentAuditFallbackCount - contentAuditRuleBasedCount,
  );
  // AI çoğunluk için çalıştıysa birkaç fallback yalnızca "geç kalan"dır; tabloya
  // "AI YOK" demek yanıltıcı. "AI yok" rozeti SADECE hiçbir belge AI ile
  // yorumlanamadığında çıkar; aksi halde sade "N kural" bilgisi gösterilir.
  const contentAuditAiBroadlyDown =
    contentAuditAiOkCount === 0 && contentAuditProviderIssueCount > 0;
  const contentAuditAuditableCount = readCount;
  const contentAuditPendingAuditCount = Math.max(
    0,
    contentAuditAuditableCount - contentAuditDoneCount - contentAuditFailedCount - contentAuditProcessingCount,
  );
  const contentAuditComplete =
    hasImages &&
    ocrDone &&
    contentAuditAuditableCount > 0 &&
    contentAuditDoneCount >= contentAuditAuditableCount &&
    contentAuditProcessingCount === 0 &&
    contentAuditFailedCount === 0;

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

  const toggleAction = (next: KdvAction) => {
    setSelectedActions((prev) => {
      if (prev.includes(next)) {
        return prev.length === 1 ? prev : prev.filter((a) => a !== next);
      }
      const sameGroup = next.startsWith('BILANCO')
        ? prev.filter((a) => a.startsWith('BILANCO'))
        : prev.filter((a) => a.startsWith('ISLETME'));
      return [...sameGroup, next];
    });
  };

  const ensureSessionForAction = async (targetAction: KdvAction) => {
    const targetType = ACTION_TO_TYPE[targetAction];
    const { session } = await kdvApi.findOrCreateSession({
      type: targetType,
      periodLabel,
      taxpayerId,
    });
    qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
    return session as { id: string; type: string };
  };

  // ── LUCA'DAN ÇEK (Extension-first agent) ─────────────────────
  // Mizan'daki akışın aynısı: backend job oluşturur, agent (Luca tab'ında çalışan
  // bookmarklet) job'u alıp Defteri Kebir / İşletme Defteri Excel'ini indirip
  // backend'e POST eder. Frontend bu süreçte log/durum gösterir.
  const [lucaJobs, setLucaJobs] = useState<LucaQueuedJob[]>([]);
  const [lucaStatus, setLucaStatus] = useState<string>('');
  const [lucaLogLines, setLucaLogLines] = useState<string[]>([]);
  const lucaJobId = lucaJobs[0]?.id ?? null;

  const lucaAgentMut = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) throw new Error('Önce mükellef seçin');
      const actionsToQueue: KdvAction[] =
        selectedActions.length > 0
          ? selectedActions
          : [selectedTp?.defterTuru === 'ISLETME' ? 'ISLETME_ALIS' : 'BILANCO_ALIS'];
      void wakeLucaAgentForFetch(setLucaStatus);
      const queued: LucaQueuedJob[] = [];
      for (const selectedAction of actionsToQueue) {
        const s = await ensureSessionForAction(selectedAction);
        const d = await kdvApi.importFromLuca(s.id, preferredDeviceId ?? undefined);
        queued.push({ id: d.jobId, action: selectedAction, sessionId: s.id });
      }
      return queued;
    },
    onSuccess: (jobs) => {
      setLucaJobs(jobs);
      setLucaStatus(
        jobs.length > 1
          ? `${jobs.length} Luca komutu kuyruğa alındı — sistem sırayla çekecek`
          : 'Luca oturumu hazırlanıyor — güvenlik kodu gerekirse portalda açılacak…',
      );
      setLucaLogLines([]);
      toast.info(`${jobs.length} Luca job oluşturuldu · güvenlik kodu gerekirse portalda görünecek`, { duration: 5000 });
      pushFeed({
        group: 'luca',
        kind: 'info',
        title: 'Luca\'dan çekme başlatıldı',
        detail: jobs.map((j) => ACTION_LABEL[j.action]).join(' · '),
      });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Luca job oluşturulamadı';
      toast.error(msg);
      pushFeed({ group: 'luca', kind: 'err', title: 'Luca\'dan çekme hatası', detail: msg });
    },
  });

  const cancelLucaJobsMut = useMutation({
    mutationFn: async () => {
      await Promise.allSettled(lucaJobs.map((job) => kdvApi.cancelLucaJob(job.id)));
    },
    onSuccess: () => {
      toast.info('Luca çekimi iptal edildi');
      setLucaJobs([]);
      setLucaStatus('');
      setLucaLogLines([]);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca işlemi iptal edilemedi'),
  });

  // Job polling
  const lucaJobQueries = useQueries({
    queries: lucaJobs.map((job) => ({
      queryKey: ['kdv-luca-job', job.id],
      queryFn: () => kdvApi.getLucaJob(job.id),
      enabled: !!job.id,
      refetchInterval: 3000,
    })),
  });

  useEffect(() => {
    if (lucaJobs.length === 0) return;
    const payloads = lucaJobQueries.map((q) => q.data as any).filter((d) => d?.job);
    if (payloads.length === 0) return;
    const jobs = payloads.map((d) => d.job);
    const lines = jobs.flatMap((job) => {
      const label = TYPE_LABEL[job.tip] || job.tip;
      const logLines = String(job.errorMsg || '').split('\n').filter((l: string) => l.trim());
      return logLines.slice(-4).map((line: string) => `${label}: ${line}`);
    });
    setLucaLogLines(lines);

    const done = jobs.filter((j) => j.status === 'done').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const running = jobs.filter((j) => j.status === 'running').length;
    const pending = Math.max(0, lucaJobs.length - done - failed - running);

    if (failed > 0) {
      setLucaStatus(`${failed} hata · ${done} tamam · ${running} çalışıyor · ${pending} bekliyor`);
    } else if (done === lucaJobs.length) {
      setLucaStatus('Tamamlandı ✓');
      toast.success(`${done} Luca komutu tamamlandı`);
      pushFeed({
        group: 'luca',
        kind: 'ok',
        title: 'Luca çekimleri tamamlandı',
        detail: jobs.map((job) => `${TYPE_LABEL[job.tip] || job.tip}: ${job.recordCount || 0} satır`).join(' · '),
      });
      lucaJobs.forEach((j) => {
        qc.invalidateQueries({ queryKey: ['kdv-stats', j.sessionId] });
        qc.invalidateQueries({ queryKey: ['kdv-results', j.sessionId] });
      });
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      setTimeout(() => { setLucaJobs([]); setLucaStatus(''); setLucaLogLines([]); }, 2500);
    } else {
      setLucaStatus(`${done}/${lucaJobs.length} tamam · ${running} çalışıyor · ${pending} bekliyor`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lucaJobQueries.map((q) => q.data))]);

  const lucaAgentRunningHint = useMemo(
    () => /Luca agent|Moren Agent|giris ekraninda|LUCASSO|agiris\.luca\.com\.tr|Klasik Luca|auygs\.luca\.com\.tr\/Luca\//i.test(lucaLogLines.join('\n')),
    [lucaLogLines],
  );

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

  /**
   * Manuel "Yenile" — OCR Teyit Bekler kartının yanındaki buton.
    * Varsayılan ucuz mod: cache/Azure çalışır; Claude otomatik devreye girmez.
    * Zorla Claude tekil fatura panelindeki AI butonundadır.
   */
  const runOcrAgain = useMutation({
    mutationFn: async () => {
      const s = await ensureSession.mutateAsync();
      const needs = stats?.needsOcrConfirm ?? 0;
      pushFeed({
        group: 'ocr',
        kind: 'info',
        title: 'OCR yeniden başlatılıyor…',
        detail: `${needs} teyit bekleyen fatura yeniden okunacak (cache/Azure öncelikli)`,
      });
      return kdvApi.startOcr(s.id, { forceFresh: true, forceClaude: false });
    },
    onSuccess: (d: any) => {
      clearFeedErrorsInGroup('ocr');
      if ((d.queued ?? 0) === 0) {
        pushFeed({
          group: 'ocr',
          kind: 'info',
          title: 'Yeniden OCR: kuyrukta iş yok',
          detail: d.message || 'Teyit bekleyen fatura bulunamadı',
        });
        toast(d.message || 'Teyit bekleyen fatura yok', { icon: 'ℹ️' });
      } else {
        pushFeed({
          group: 'ocr',
          kind: 'ok',
          title: `${d.queued} OCR işi başladı`,
          detail: 'Teyit bekleyenler yeniden okunuyor (cache/Azure öncelikli)',
        });
        toast.success(`${d.queued} OCR yeniden başlatıldı`);
      }
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'OCR başlatılamadı';
      pushFeed({ group: 'ocr', kind: 'err', title: 'OCR hatası', detail: msg });
      toast.error(msg);
    },
  });

  const runContentAudit = useMutation({
    mutationFn: async () => {
      const s = await ensureSession.mutateAsync();
      // Takılan (kural-yedeği) belge varsa: SADECE onları yeniden dene (force YOK) —
      // başarılı AI yorumları korunur, hızlı biter. Her şey AI ile yorumlanmışsa
      // tekrar tıklamak güncel kurallarla tam yeniden değerlendirme yapar (force).
      const onlyRetryStragglers = contentAuditProviderIssueCount > 0;
      const force = contentAuditDoneCount > 0 && !onlyRetryStragglers;
      pushFeed({
        group: 'content',
        kind: 'info',
        title: 'İçerik denetimi başladı',
        detail: onlyRetryStragglers
          ? 'Yalnızca AI yorumu alamayan belgeler yeniden deneniyor'
          : contentAuditDoneCount > 0
          ? 'Mevcut yorumlar güncel kurallarla yeniden değerlendiriliyor'
          : 'Fatura içeriği ve mükellef faaliyeti birlikte değerlendiriliyor',
      });
      return kdvApi.startContentAudit(s.id, { force });
    },
    onSuccess: (d: any) => {
      clearFeedErrorsInGroup('content');
      if ((d.queued ?? 0) === 0) {
        pushFeed({
          group: 'content',
          kind: 'info',
          title: 'İçerik denetimi: yeni belge yok',
          detail: d.message || 'Denetlenecek yeni fatura bulunamadı',
        });
        toast(d.message || 'Denetlenecek yeni fatura yok');
      } else {
        pushFeed({
          group: 'content',
          kind: 'ok',
          title: `${d.queued} içerik denetimi kuyruğa alındı`,
          detail: 'Bulgular birazdan ayrı panelde görünecek',
        });
        toast.success(`${d.queued} fatura için içerik denetimi başladı`);
      }
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'İçerik denetimi başlatılamadı';
      pushFeed({ group: 'content', kind: 'err', title: 'İçerik denetimi hatası', detail: msg });
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
      const inceleCount = (d.needsReview ?? 0) + (d.partial ?? 0);
      const tamCount = d.matched ?? 0;
      const hataliCount = d.unmatched ?? 0;
      pushFeed({
        group: 'kontrol',
        kind: 'ok',
        title: 'Kontrol tamamlandı',
        detail: `${tamCount} tam eşleşme · ${inceleCount} incele · ${hataliCount} hatalı`,
      });
      toast.success(
        `Eşleştirme tamam — ${tamCount} ✓ tam · ${inceleCount} ⚠ incele · ${hataliCount} ✗ hatalı`,
      );
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
   *
   * ÖNEMLİ: İlk yüklemede (seans açılışı) mevcut result'lar feed'e akıtılmaz —
   * sadece "görülmüş" olarak işaretlenir. Ancak bundan sonra gelecek YENİ
   * result'lar feed'e animasyon ile düşer.
   */
  useEffect(() => {
    if (!results?.length) return;

    // İlk yüklemede mevcut tüm result'ları sessizce "seen" yap — replay olmasın
    if (!resultsSeededRef.current) {
      for (const r of results as any[]) {
        seenResultIdsRef.current.add(r.id);
      }
      resultsSeededRef.current = true;
      return;
    }

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

  /**
   * OCR canlı akışı — her fatura için durum değişimlerini log'a akıt.
   *  - PENDING/PROCESSING → SUCCESS = "✓ OZT...62 · 3/3 · %92"
   *  - PENDING/PROCESSING → NEEDS_REVIEW = "⚠ OZT...62 · tarih düşük güvenli (%45)"
   *  - PENDING/PROCESSING → LOW_CONFIDENCE = "✗ OZT...62 · hiç okunamadı"
   *  - PENDING/PROCESSING → FAILED = "✗ OZT...62 · sistem hatası"
   */
  useEffect(() => {
    if (!Array.isArray(images) || images.length === 0) return;

    const TH = 0.7;
    const pct = (v?: number | null) => (typeof v === 'number' ? `%${Math.round(v * 100)}` : '—');

    for (const img of images as any[]) {
      const prevStatus = seenImageStatusRef.current.get(img.id);
      const curr = img.ocrStatus as string;
      // Sadece son durum değişimini bir kere logla
      if (prevStatus === curr) continue;

      // Seans ilk açılışında zaten tamamlanmış OCR'ları sessizce "görülmüş" işaretle
      // Böylece eski seanslar açıldığında OCR event'leri tekrar akmaz.
      if (!prevStatus && ['SUCCESS', 'NEEDS_REVIEW', 'LOW_CONFIDENCE', 'FAILED'].includes(curr)) {
        seenImageStatusRef.current.set(img.id, curr);
        continue;
      }

      // İlk defa görüyorsak ve hâlâ işleniyorsa, sessiz kayıt ama logla
      if (!prevStatus && (curr === 'PENDING' || curr === 'PROCESSING')) {
        seenImageStatusRef.current.set(img.id, curr);
        continue;
      }

      // Son durumlar için feed satırı üret
      const base = (img.originalName || img.id).replace(/\.[^/.]+$/, '');
      const short = base.length > 22 ? '…' + base.slice(-20) : base;

      if (curr === 'SUCCESS') {
        const parts: string[] = [];
        if (img.ocrDate) parts.push(`Tarih ${img.ocrDate} ${pct(img.ocrDateConfidence)}`);
        if (img.ocrBelgeNo) parts.push(`Belge ${String(img.ocrBelgeNo).slice(0, 18)} ${pct(img.ocrBelgeNoConfidence)}`);
        if (img.ocrKdvTutari) parts.push(`KDV ${img.ocrKdvTutari} ${pct(img.ocrKdvConfidence)}`);
        pushFeed({
          group: 'ocr',
          kind: 'ok',
          title: `✓ ${short} · 3/3`,
          detail: parts.join(' · ') || 'Tüm alanlar okundu',
          imageId: img.id,
        });
      } else if (curr === 'NEEDS_REVIEW') {
        const issues: string[] = [];
        if (!img.ocrDate || (img.ocrDateConfidence ?? 1) < TH) issues.push(`tarih ${pct(img.ocrDateConfidence) || 'yok'}`);
        if (!img.ocrBelgeNo || (img.ocrBelgeNoConfidence ?? 1) < TH) issues.push(`belge no ${pct(img.ocrBelgeNoConfidence) || 'yok'}`);
        if (!img.ocrKdvTutari || (img.ocrKdvConfidence ?? 1) < TH) issues.push(`KDV ${pct(img.ocrKdvConfidence) || 'yok'}`);
        pushFeed({
          group: 'ocr',
          kind: 'warn',
          title: `⚠ ${short} · teyit bekler`,
          detail: issues.length > 0 ? `düşük: ${issues.join(' · ')}` : 'bir alan eşik altı',
          imageId: img.id,
        });
      } else if (curr === 'LOW_CONFIDENCE') {
        pushFeed({
          group: 'ocr',
          kind: 'err',
          title: `✗ ${short} · hiç okunamadı`,
          detail: `OCR hiçbir alan çıkaramadı${img.ocrEngine ? ` (${img.ocrEngine})` : ''} — elle teyit gerek`,
          imageId: img.id,
        });
      } else if (curr === 'FAILED') {
        pushFeed({
          group: 'ocr',
          kind: 'err',
          title: `✗ ${short} · OCR hatası`,
          detail: 'Görsel indirilemedi veya işleme hatası (Railway logları kontrol edin)',
          imageId: img.id,
        });
      }

      seenImageStatusRef.current.set(img.id, curr);
    }
  }, [images]);

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
    onError: async (e: any) => {
      // arraybuffer responseType'ında hata da Blob/ArrayBuffer olarak gelir — JSON'a çevir
      let msg = e?.message || 'Excel indirilemedi';
      const data = e?.response?.data;
      if (data instanceof ArrayBuffer) {
        try { msg = JSON.parse(new TextDecoder().decode(data))?.message || msg; } catch {}
      } else if (data?.message) {
        msg = data.message;
      }
      toast.error(`Excel: ${msg}`);
    },
  });

  const deleteSessionMut = useMutation({
    mutationFn: (id: string) => kdvApi.deleteSession(id),
    onSuccess: () => {
      toast.success('Seans silindi');
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
    },
  });

  const lockSessionMut = useMutation({
    mutationFn: (id: string) => kdvApi.completeSession(id),
    onSuccess: (_d, id) => {
      toast.success('Kontrol kilitlendi');
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kilitlenemedi'),
  });

  const unlockSessionMut = useMutation({
    mutationFn: (id: string) => kdvApi.unlockSession(id),
    onSuccess: (_d, id) => {
      toast.success('Kilit açıldı');
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Kilit açılamadı'),
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
    onError: async (e: any) => {
      let msg = e?.message || 'İndirme başarısız';
      const data = e?.response?.data;
      if (data instanceof ArrayBuffer) {
        try { msg = JSON.parse(new TextDecoder().decode(data))?.message || msg; } catch {}
      }
      toast.error(`İndirme: ${msg}`);
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
  const contentAuditRows = useMemo(() => {
    const rank: Record<string, number> = { ISLENMEMELI: 0, RISKLI: 1, KONTROL_ET: 2, UYGUN: 3 };
    return (images as any[])
      .filter((img) => img.contentAuditStatus || img.contentAuditRisk)
      .sort((a, b) => (rank[a.contentAuditRisk] ?? 4) - (rank[b.contentAuditRisk] ?? 4));
  }, [images]);
  const contentAuditAttentionRows = useMemo(
    () => contentAuditRows.filter((img: any) => img.contentAuditRisk && img.contentAuditRisk !== 'UYGUN'),
    [contentAuditRows],
  );
  const contentAuditHardRiskCount = contentAuditRows.filter((img: any) =>
    ['RISKLI', 'ISLENMEMELI'].includes(img.contentAuditRisk),
  ).length;
  const contentAuditReviewCount = contentAuditRows.filter((img: any) =>
    img.contentAuditRisk === 'KONTROL_ET' || img.contentAuditStatus === 'FAILED',
  ).length;
  const contentAuditPanelRows = contentAuditRows;
  const contentAuditTooltip = (img: any) => {
    const findings = Array.isArray(img.contentAuditFindings)
      ? img.contentAuditFindings
          .map((finding: any, idx: number) => `${idx + 1}. ${finding?.title || 'Bulgu'}: ${finding?.detail || ''}`.trim())
          .filter(Boolean)
      : [];
    return [
      img.originalName || img.ocrBelgeNo || img.id,
      img.contentAuditModel ? `Model: ${img.contentAuditModel}` : null,
      img.contentAuditSummary,
      img.contentAuditSuggestion,
      ...findings,
    ].filter(Boolean).join('\n');
  };

  // ── RENDER ──────────────────────────────────────────
  return (
    <div className="space-y-3 max-w-7xl">
      {/* HEADER */}
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
        style={{
          background: `radial-gradient(circle at 12% 0%, ${GOLD}2e, transparent 34%), radial-gradient(circle at 84% 8%, ${KDV_STEEL}26, transparent 40%), linear-gradient(160deg, rgba(28,23,17,0.96) 0%, #0f0d0b 72%)`,
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `linear-gradient(90deg, #8b7649, ${GOLD_SOFT}, ${GOLD}, #e7cf95, ${KDV_STEEL}, ${GOLD})` }}
        />
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>
            Vergi & Beyanname
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{
                width: 46,
                height: 46,
                background: `linear-gradient(135deg, ${GOLD}, ${KDV_STEEL})`,
                boxShadow: '0 8px 22px rgba(212,184,118,0.24)',
              }}
            >
              <FileSpreadsheet size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[30px] font-semibold leading-none tracking-normal text-[#fafaf9]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
                KDV Kontrol
              </h1>
              <p className="mt-2 text-[13px] font-semibold text-white/45">
                Mükellef, dönem ve defter tipine göre Luca verisi ile portal faturaları tek ekranda eşleştirilir.
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span
              className="inline-flex h-9 max-w-[280px] items-center gap-1.5 truncate rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
              title={selectedTp ? taxpayerName(selectedTp) : 'Mükellef seçilmedi'}
            >
              <Users size={14} style={{ color: GOLD }} />
              <span className="truncate">{selectedTp ? taxpayerName(selectedTp) : 'Mükellef seçilmedi'}</span>
            </span>
            <span
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <Calendar size={14} style={{ color: KDV_STEEL }} />
              {periodLabel}
            </span>
            <span
              className="inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
              title={selectedActions.length ? selectedActions.map((item) => ACTION_LABEL[item]).join(' + ') : 'İşlem seçilmedi'}
            >
              <ShieldCheck size={14} style={{ color: GOLD }} />
              <span className="truncate">
                {selectedActions.length ? selectedActions.map((item) => ACTION_LABEL[item]).join(' + ') : 'İşlem seçilmedi'}
              </span>
            </span>
          </div>
        </div>
      </header>

      {activeLocked && activeSession && (
        <div
          className="rounded-xl border px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.22)' }}
        >
          <div className="flex items-center gap-2 text-sm" style={{ color: '#bbf7d0' }}>
            <Lock size={15} />
            <span>Bu kontrol sorunsuz tamamlandığı için kilitli. Müdahale etmek için kilidi aç.</span>
          </div>
          <button
            onClick={() => unlockSessionMut.mutate(activeSession.id)}
            disabled={unlockSessionMut.isPending}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
            style={{ background: 'rgba(34,197,94,0.14)', color: '#bbf7d0' }}
          >
            <Unlock size={13} />
            Kilidi Aç
          </button>
        </div>
      )}

      {/* KOMUT BARI */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        {/* SIRA: 1) Mükellef → 2) Defter/İşlem → 3) Dönem.
            Mükellef seçilmeden 2 ve 3 disabled (gri); aksiyonlar zaten "Önce mükellef seçin" der. */}
        <div className="flex items-start gap-4 flex-wrap">
          {/* 1. MÜKELLEF — en sola, en geniş, ilk adım */}
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                style={{ background: GOLD + '26', color: GOLD }}
              >1</span>
              <Users size={11} className="inline" /> Mükellef
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border flex items-center gap-2 text-left hover:brightness-110 transition"
              style={{
                background: selectedTp ? 'rgba(212,184,118,0.06)' : 'rgba(255,255,255,0.03)',
                borderColor: selectedTp ? 'rgba(212,184,118,0.3)' : 'rgba(255,255,255,0.05)',
                color: '#fafaf9',
              }}
            >
              <span className="flex-1 truncate font-medium">
                {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
              </span>
              {selectedTp?.defterTuru && (
                <span
                  className="text-[9.5px] px-1.5 py-0.5 rounded font-bold tracking-wide"
                  style={{
                    background: selectedTp.defterTuru === 'BILANCO' ? 'rgba(37,99,235,0.18)' : 'rgba(168,85,247,0.18)',
                    color: selectedTp.defterTuru === 'BILANCO' ? '#60a5fa' : '#c084fc',
                  }}
                >
                  {selectedTp.defterTuru === 'BILANCO' ? 'BİLANÇO' : 'İŞLETME'}
                </span>
              )}
              {selectedTp && (
                <span
                  onClick={(e) => { e.stopPropagation(); setTaxpayerId(''); setSelectedActions([]); }}
                  className="p-0.5 rounded hover:bg-white/10"
                  style={{ color: 'rgba(250,250,249,0.5)' }}
                >
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.45)' }} />
            </button>
          </div>

          {/* 2. DEFTER / İŞLEM — mükellef seçilmeden disabled */}
          <div className="flex-shrink-0" style={{ opacity: taxpayerId ? 1 : 0.45, pointerEvents: taxpayerId ? 'auto' : 'none' }}>
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                style={{ background: taxpayerId ? GOLD + '26' : 'rgba(255,255,255,0.08)', color: taxpayerId ? GOLD : 'rgba(250,250,249,0.35)' }}
              >2</span>
              Defter / İşlem
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(ACTION_LABEL) as KdvAction[]).map((k) => {
                const active = selectedActions.includes(k);
                const c = ACTION_COLOR[k];
                const compatible = isActionCompatible(k, selectedTp?.defterTuru);
                const disabled = !taxpayerId || !compatible;
                const reason = !taxpayerId
                  ? 'Önce mükellef seçin'
                  : !compatible
                    ? selectedTp?.defterTuru === 'BILANCO'
                      ? 'Bu mükellef Bilanço esasında — İşletme seçilemez'
                      : 'Bu mükellef İşletme defterinde — Bilanço seçilemez'
                    : '';
                return (
                  <button
                    key={k}
                    onClick={() => { if (!disabled) toggleAction(k); }}
                    disabled={disabled}
                    title={reason}
                    className="px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap transition"
                    style={{
                      background: disabled
                        ? 'rgba(255,255,255,0.015)'
                        : active ? c + '26' : 'rgba(255,255,255,0.03)',
                      borderColor: disabled
                        ? 'rgba(255,255,255,0.04)'
                        : active ? c : 'rgba(255,255,255,0.05)',
                      color: disabled
                        ? 'rgba(250,250,249,0.22)'
                        : active ? c : '#fafaf9',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                      textDecoration: disabled && !compatible && taxpayerId ? 'line-through' : 'none',
                    }}
                  >
                    {ACTION_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. DÖNEM — mükellef seçilmeden disabled */}
          <div className="flex-shrink-0" style={{ opacity: taxpayerId ? 1 : 0.45, pointerEvents: taxpayerId ? 'auto' : 'none' }}>
            <label className="block text-[11px] uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                style={{ background: taxpayerId ? GOLD + '26' : 'rgba(255,255,255,0.08)', color: taxpayerId ? GOLD : 'rgba(250,250,249,0.35)' }}
              >3</span>
              <Calendar size={11} className="inline" /> Dönem
            </label>
            <input
              type="month"
              value={ay}
              onChange={(e) => setAy(e.target.value)}
              disabled={!taxpayerId}
              className="px-3 py-2.5 rounded-lg text-base font-semibold border outline-none disabled:cursor-not-allowed"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9', minWidth: 170 }}
            />
          </div>
        </div>

        {/* AKSİYON BUTONLARI (4 adım — OCR otomatik) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <ActionBtn
            icon={Upload}
            label="Luca Excel Yükle"
            sub={hasRecords ? `${stats?.totalRecords} satır yüklü` : !taxpayerId ? 'Önce mükellef seçin' : 'Manuel .xlsx upload'}
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
          {/* YENİ: Luca'dan Çek (otomatik agent) */}
          <ActionBtn
            icon={Download}
            label={lucaJobId ? 'Luca\'dan Çekiliyor…' : 'Luca\'dan Çek'}
            sub={
              lucaJobId ? (lucaStatus || 'Agent çalışıyor…')
              : hasRecords ? `${stats?.totalRecords} satır (yenile)`
              : !taxpayerId ? 'Önce mükellef seçin'
              : selectedActions.length > 1 ? `${selectedActions.length} komut · sistem sırayla çeker` : 'Otomatik · güvenlik kodu portalda'
            }
            color="#10b981"
            done={false}
            onClick={() => requireMukellef(() => lucaAgentMut.mutate())}
            loading={lucaAgentMut.isPending || !!lucaJobId}
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
            icon={ShieldCheck}
            label="İçerik Denetimi"
            sub={
              activeLocked ? 'Kilitli seans'
              : contentAuditProcessingCount > 0 ? `${contentAuditProcessingCount} denetleniyor...`
              : contentAuditFailedCount > 0 ? `${contentAuditFailedCount} hata · kontrol gerekiyor`
              : contentAuditPendingAuditCount > 0 && contentAuditDoneCount > 0 ? `${contentAuditDoneCount}/${contentAuditAuditableCount} yorum · ${contentAuditPendingAuditCount} bekliyor`
              : contentAuditDoneCount > 0 && contentAuditHardRiskCount > 0 ? `${contentAuditDoneCount} yorum · ${contentAuditHardRiskCount} net risk`
              : contentAuditDoneCount > 0 && contentAuditReviewCount > 0 ? `${contentAuditDoneCount} yorum · ${contentAuditReviewCount} kontrol`
              : contentAuditDoneCount > 0 && contentAuditAiBroadlyDown ? `${contentAuditDoneCount} yorum · AI yok, kural`
              : contentAuditDoneCount > 0 && contentAuditProviderIssueCount > 0 ? `${contentAuditDoneCount} yorum · ${contentAuditProviderIssueCount} kural`
              : contentAuditDoneCount > 0 && contentAuditRuleBasedCount > 0 ? `${contentAuditDoneCount} yorum · kural denetimi`
              : contentAuditDoneCount > 0 ? `${contentAuditDoneCount} yorum · belirgin risk yok`
              : !taxpayerId ? 'Önce mükellef seçin'
              : !hasImages ? 'Önce faturaları çek'
              : !ocrDone ? 'OCR bitsin'
              : 'Faaliyet uygunluğu'
            }
            color="#14b8a6"
            done={contentAuditComplete && contentAuditHardRiskCount === 0 && contentAuditReviewCount === 0 && contentAuditProviderIssueCount === 0}
            onClick={() => {
              if (!taxpayerId) return requireMukellef(() => runContentAudit.mutate());
              if (activeLocked) return toast.error('Kilitli kontrol; önce kilidi açın');
              if (!hasImages) return toast.error('Önce faturaları bağlayın');
              if (!ocrDone) return toast.error('OCR devam ediyor, içerik denetimi için bitmesini bekleyin');
              runContentAudit.mutate();
            }}
            loading={runContentAudit.isPending || contentAuditProcessingCount > 0}
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

        {/* Luca job durumu — portal içi güvenlik kodu + canlı log */}
        {lucaJobId && (
          <div
            className="rounded-lg p-3 text-sm mt-3"
            style={{
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.3)',
              color: '#fafaf9',
            }}
          >
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="animate-spin" style={{ color: '#10b981', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div style={{ color: '#10b981', fontWeight: 600, fontSize: 13 }}>Luca işlemi portal içinde yönetiliyor</div>
                <div style={{ color: 'rgba(250,250,249,0.65)', fontSize: 12, marginTop: 2 }} className="truncate">
                  {lucaStatus || 'Moren agent Luca\'dan KDV verisini indiriyor…'}
                </div>
              </div>
              <button
                onClick={() => cancelLucaJobsMut.mutate()}
                disabled={cancelLucaJobsMut.isPending}
                className="px-3 py-1.5 rounded-md text-xs disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)', border: 0 }}
              >
                {cancelLucaJobsMut.isPending ? 'İptal ediliyor...' : 'İptal'}
              </button>
            </div>
            <LucaInlineCaptchaPanel
              jobIds={lucaJobs.map((job) => job.id)}
              color="#10b981"
              agentRunningHint={lucaAgentRunningHint}
              onAnswered={() => lucaJobs.forEach((job) => qc.invalidateQueries({ queryKey: ['kdv-luca-job', job.id] }))}
              onCancel={() => cancelLucaJobsMut.mutate()}
            />
            {lucaLogLines.length > 0 && (
              <div
                className="mt-2 p-2 rounded text-xs font-mono overflow-y-auto"
                style={{ background: 'rgba(0,0,0,0.3)', maxHeight: 160, color: 'rgba(250,250,249,0.7)' }}
              >
                {lucaLogLines.slice(-15).map((line, i) => (
                  <div key={i} className="leading-relaxed truncate">{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
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
          <div className="p-3.5">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-2">
              {(() => {
                // Eşleşme Hatalı kartı için kırılım: iki ayrı kovadan geliyor
                //   (1) Luca var, fatura yok  → lucaOnlyMissing (Luca tarafı orphan)
                //   (2) Fatura var, Luca yok  → imageOnlyMissing (Fatura tarafı orphan)
                //   Ayrıca kullanıcı reddettikleri (REJECTED) → ayrı satır
                const _matched = stats.matched ?? 0;
                const _review = stats.reviewTotal ?? ((stats.needsReview ?? 0) + (stats.partialMatch ?? 0) + (stats.amountMismatch ?? 0));
                const _rejected = (stats.rejected ?? 0) + (stats.mismatch ?? 0);
                const _lucaOrphan = stats.lucaOnlyMissing ?? Math.max(0, (stats.totalRecords ?? 0) - _matched - _review - _rejected);
                const _imageOrphan = stats.imageOnlyMissing ?? Math.max(0, (stats.totalImages ?? 0) - _matched - _review - _rejected);
                const _otherUnmatched = stats.otherUnmatched ?? Math.max(0, (stats.unmatched ?? 0) - _lucaOrphan - _imageOrphan);
                const failedSubParts: string[] = [];
                if (_lucaOrphan > 0) failedSubParts.push(`${_lucaOrphan} fatura yok`);
                if (_imageOrphan > 0) failedSubParts.push(`${_imageOrphan} Luca'da yok`);
                if (_otherUnmatched > 0) failedSubParts.push(`${_otherUnmatched} eşleşmedi`);
                if (_rejected > 0) failedSubParts.push(`${_rejected} reddedilen`);
                return [
                  { key: 'luca',    label: 'Luca Satırı',       val: stats.totalRecords, color: GOLD,       icon: FileText },
                  { key: 'uploaded',label: 'Yüklenen Fatura',   val: stats.totalImages,  color: '#a855f7',  icon: ImageIcon },
                  { key: 'read',    label: 'OCR Fatura Okuma',  val: readCount,          color: '#60a5fa',  icon: ScanLine, showRerun: hasImages },
                  { key: 'pending', label: 'OCR Teyit Bekler',  val: stats.needsOcrConfirm ?? 0, color: '#f59e0b', icon: AlertTriangle, showRerun: (stats.needsOcrConfirm ?? 0) > 0 },
                  { key: 'matched', label: 'Tam Eşleşme',       val: stats.matched,      color: '#22c55e',  icon: CheckCircle2, sub: stats.balance?.image?.matched != null && stats.balance.image.matched !== stats.matched ? `${stats.balance.image.matched} fatura` : null },
                  { key: 'review',  label: 'Eşleşme İncele',    val: _review, color: '#fb923c', icon: AlertTriangle },
                  { key: 'failed',  label: 'Eşleşme Hatalı',    val: _lucaOrphan + _imageOrphan + _otherUnmatched + _rejected, color: '#f43f5e', icon: XCircle, sub: failedSubParts.join(' · ') || null },
                ];
              })().map(({ key, label, val, color, icon: Icon, showRerun, sub }: any) => (
                <div key={key} className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center justify-between mb-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    <span className="flex items-center gap-1.5">
                      <Icon size={12} style={{ color }} /> {label}
                    </span>
                    {showRerun && (
                      <button
                        onClick={() => runOcrAgain.mutate()}
                        disabled={runOcrAgain.isPending}
                        title={key === 'pending'
                          ? 'Bekleyen faturaları yeniden OCR\'la (başarılılara dokunulmaz)'
                          : 'OCR\'ı tekrar çalıştır'}
                        className="text-[10px] normal-case font-semibold px-2 py-0.5 rounded hover:brightness-125 transition flex items-center gap-1"
                        style={{
                          background: key === 'pending' ? 'rgba(245,158,11,0.15)' : 'rgba(96,165,250,0.12)',
                          color: key === 'pending' ? '#f59e0b' : '#60a5fa',
                        }}
                      >
                        <span>{runOcrAgain.isPending ? '…' : '⟳'}</span>
                        {key === 'pending' && !runOcrAgain.isPending && <span>Yenile</span>}
                      </button>
                    )}
                  </div>
                  <p className="leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: '#fafaf9' }}>
                    {val ?? 0}
                  </p>
                  {sub && (
                    <p className="mt-1.5 text-[10.5px] tabular-nums leading-tight" style={{ color: 'rgba(250,250,249,0.45)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {sub}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {/* MATH BALANCE — Luca ve Fatura taraflarının her biri totalRecords/totalImages'a
                nasıl bölündüğünü açıklar. Eşleşme Hatalı (rejected+unmatched) aslında
                iki ayrı kovadan geliyor: Luca satırı var ama fatura yok + Fatura var ama
                Luca'da yok. Kullanıcı neden 22+7+4=33 ≠ 31 olduğunu burada anlıyor. */}
            {(() => {
              const matched = stats.matched ?? 0;
              const review = stats.reviewTotal ?? ((stats.needsReview ?? 0) + (stats.partialMatch ?? 0) + (stats.amountMismatch ?? 0));
              const rejected = (stats.rejected ?? 0) + (stats.mismatch ?? 0);
              const balance = stats.balance || {};
              const lucaMatched = balance.luca?.matched ?? matched;
              const lucaReview = balance.luca?.review ?? review;
              const lucaRejected = balance.luca?.rejected ?? rejected;
              const imageMatched = balance.image?.matched ?? Math.min(matched, stats.totalImages ?? matched);
              const imageReview = balance.image?.review ?? review;
              const imageRejected = balance.image?.rejected ?? rejected;
              const lucaOnlyMissing = stats.lucaOnlyMissing ?? Math.max(0, (stats.totalRecords ?? 0) - lucaMatched - lucaReview - lucaRejected);
              const imageOnlyMissing = stats.imageOnlyMissing ?? Math.max(0, (stats.totalImages ?? 0) - imageMatched - imageReview - imageRejected);
              const otherUnmatched = stats.otherUnmatched ?? Math.max(0, (stats.unmatched ?? 0) - lucaOnlyMissing - imageOnlyMissing);
              return (
                <div
                  className="mt-4 px-4 py-3 rounded-xl text-[11.5px] tabular-nums space-y-1"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="flex items-center gap-2 flex-wrap" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    <span style={{ color: GOLD, fontWeight: 600 }}>{stats.totalRecords ?? 0} Luca satırı</span>
                    <span>=</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{lucaMatched} tam</span>
                    <span>+</span>
                    <span style={{ color: '#fb923c', fontWeight: 600 }}>{lucaReview} incele</span>
                    {lucaRejected > 0 && <><span>+</span><span style={{ color: '#f43f5e', fontWeight: 600 }}>{lucaRejected} reddedilen</span></>}
                    <span>+</span>
                    <span style={{ color: '#f43f5e', fontWeight: 600 }}>{lucaOnlyMissing} faturası yok</span>
                    {otherUnmatched > 0 && <><span>+</span><span style={{ color: '#f43f5e', fontWeight: 600 }}>{otherUnmatched} eşleşmedi</span></>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    <span style={{ color: '#a855f7', fontWeight: 600 }}>{stats.totalImages ?? 0} Fatura</span>
                    <span>=</span>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>{imageMatched} tam</span>
                    <span>+</span>
                    <span style={{ color: '#fb923c', fontWeight: 600 }}>{imageReview} incele</span>
                    {imageRejected > 0 && <><span>+</span><span style={{ color: '#f43f5e', fontWeight: 600 }}>{imageRejected} reddedilen</span></>}
                    <span>+</span>
                    <span style={{ color: '#f43f5e', fontWeight: 600 }}>{imageOnlyMissing} Luca'da yok</span>
                  </div>
                </div>
              );
            })()}
            {/* OCR maliyet özeti — backend ai_usage_logs + cache/XML tasarrufu */}
            {(() => {
              const ocrCost = (stats as any)?.ocrCost || {};
              const paidCalls = Number(ocrCost.paidCalls || 0);
              const cacheHits = Number(ocrCost.cacheHits || 0);
              const xmlParsed = Number(ocrCost.xmlParsed || 0);
              const azureReads = Number(ocrCost.azureReads || 0);
              const claudeEscalations = Number(ocrCost.claudeEscalations || 0);
              const freeSkips = Number(ocrCost.freeSkips || cacheHits + xmlParsed);
              const costUsd = Number(ocrCost.actualCostUsd || 0) > 0
                ? Number(ocrCost.actualCostUsd)
                : Number(ocrCost.estimatedCostUsd || 0);
              const savedUsd = Number(ocrCost.estimatedSavedUsd || 0);
              const usdToTry = 40;  // yaklaşık kur (değişken)
              const costTl = costUsd * usdToTry;
              const savedTl = savedUsd * usdToTry;
              return (
                <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-4 text-[11.5px] tabular-nums flex-wrap">
                    <span style={{ color: 'rgba(250,250,249,0.5)' }}>OCR Maliyet:</span>
                    <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                      {paidCalls} ücretli okuma ≈ <span style={{ color: '#fafaf9' }}>${costUsd.toFixed(4)}</span>
                      <span style={{ color: 'rgba(250,250,249,0.4)' }}> (~{costTl.toFixed(2)} ₺)</span>
                    </span>
                    {(azureReads > 0 || claudeEscalations > 0) && (
                      <span style={{ color: '#c084fc', fontWeight: 600 }}>
                        Akış: {azureReads} Azure
                        {claudeEscalations > 0 ? ` · ${claudeEscalations} Claude'a giden` : ''}
                      </span>
                    )}
                    {freeSkips > 0 && (
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>
                        Ücretsiz atlanan: {freeSkips} belge
                        {cacheHits > 0 ? ` · ${cacheHits} cache` : ''}
                        {xmlParsed > 0 ? ` · ${xmlParsed} XML` : ''}
                        {savedUsd > 0 ? ` (~${savedUsd.toFixed(4)} / ${savedTl.toFixed(2)} ₺ tasarruf)` : ''}
                      </span>
                    )}
                  </div>
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
              );
            })()}
          </div>
        </div>
      )}

      {/* v1.36.69: BELGE SERİ TAKİBİ UYARILARI — sadece satış (KDV_391 / ISLETME_GELIR) için */}
      {activeSession && Array.isArray((stats as any)?.seriUyarilari) && (stats as any).seriUyarilari.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
            <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
              Belge Seri Takibi Uyarıları
            </h3>
            <span className="ml-auto text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
              {(stats as any).seriUyarilari.length} uyarı
            </span>
          </div>
          <div className="p-5 space-y-2">
            {(stats as any).seriUyarilari.map((u: any, idx: number) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg"
                style={{
                  background: (u.tip === 'cross_break' || u.tip === 'z_cross_break' || u.tip === 'z_duplicate') ? 'rgba(244,63,94,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${(u.tip === 'cross_break' || u.tip === 'z_cross_break' || u.tip === 'z_duplicate') ? 'rgba(244,63,94,0.20)' : 'rgba(245,158,11,0.18)'}`,
                }}
              >
                <span
                  className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0 mt-[1px]"
                  style={{
                    background: (u.tip === 'cross_break' || u.tip === 'z_cross_break' || u.tip === 'z_duplicate') ? 'rgba(244,63,94,0.18)' : 'rgba(245,158,11,0.18)',
                    color: (u.tip === 'cross_break' || u.tip === 'z_cross_break' || u.tip === 'z_duplicate') ? '#f43f5e' : '#f59e0b',
                  }}
                >
                  {u.tip === 'z_gap' ? 'Z No Boşluğu' : u.tip === 'z_cross_break' ? 'Z Dönem Geçişi' : u.tip === 'z_duplicate' ? 'Tekrarlı Z No' : u.tip === 'cross_break' ? 'Dönem Geçişi' : 'Seri Boşluğu'}
                </span>
                <p className="text-[12.5px] leading-relaxed" style={{ color: '#fafaf9' }}>
                  {u.mesaj}
                </p>
              </div>
            ))}
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Bu uyarılar yalnızca <strong style={{ color: '#fafaf9' }}>satış kontrollerinde</strong> (KDV 391 / İşletme Geliri) e-belge seri numarası ve Z raporu sıra takibinden gelir. Atlanan belge no'lar iptal edilmiş, kayıt dışı kalmış veya başka bir döneme yazılmış olabilir.
            </p>
          </div>
        </div>
      )}

      {/* OCR Teyit paneli — içerik denetiminin ÜSTÜNDE (kullanıcı isteği) */}
      {activeSession?.id && (
        <OcrReviewPanel sessionId={activeSession.id} images={images as any} sessionType={activeSession.type} />
      )}

      {/* İçerik denetimi paneli — OCR teyit panelinin ALTINDA */}
      {activeSession && contentAuditRows.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'rgba(20,184,166,0.035)', border: '1px solid rgba(20,184,166,0.16)' }}
        >
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(20,184,166,0.10)' }}>
            <ShieldCheck size={14} style={{ color: '#14b8a6' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>İçerik Denetimi</h3>
            <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
              {contentAuditDoneCount} belge yorumlandı
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {contentAuditHardRiskCount > 0 && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.14)', color: '#fb7185' }}>
                  {contentAuditHardRiskCount} net risk
                </span>
              )}
              {contentAuditReviewCount > 0 && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.13)', color: '#fbbf24' }}>
                  {contentAuditReviewCount} kontrol
                </span>
              )}
              {contentAuditAiBroadlyDown && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(96,165,250,0.13)', color: '#93c5fd' }}>
                  AI yok, kural
                </span>
              )}
              {!contentAuditAiBroadlyDown && contentAuditProviderIssueCount > 0 && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(96,165,250,0.10)', color: '#93c5fd' }}>
                  {contentAuditProviderIssueCount} kural
                </span>
              )}
              {contentAuditPendingAuditCount > 0 && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(250,250,249,0.08)', color: 'rgba(250,250,249,0.62)' }}>
                  {contentAuditPendingAuditCount} bekliyor
                </span>
              )}
              {contentAuditHardRiskCount === 0 && contentAuditReviewCount === 0 && contentAuditProviderIssueCount === 0 && contentAuditPendingAuditCount === 0 && (
                <span className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.13)', color: '#86efac' }}>
                  belirgin risk yok
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-2">
            {contentAuditPanelRows.map((img: any) => (
              <div
                key={img.id}
                title={contentAuditTooltip(img)}
                className="grid min-h-[38px] grid-cols-[118px_minmax(130px,220px)_minmax(0,1fr)] items-start gap-3 border-b px-2.5 py-2 last:border-b-0"
                style={{ borderColor: 'rgba(20,184,166,0.10)' }}
              >
                <ContentAuditBadge risk={img.contentAuditRisk} status={img.contentAuditStatus} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] font-semibold" style={{ color: '#fafaf9' }}>{img.originalName || img.ocrBelgeNo || img.id}</span>
                    {img.contentAuditConfidence != null && (
                      <span className="shrink-0 tabular-nums text-[10px]" style={{ color: 'rgba(250,250,249,0.38)' }}>
                        %{Math.round(Number(img.contentAuditConfidence || 0) * 100)}
                      </span>
                    )}
                    {img.contentAuditModel && <ContentAuditModelBadge model={img.contentAuditModel} />}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] leading-snug" style={{ color: 'rgba(250,250,249,0.72)', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                    {img.contentAuditSummary || (img.contentAuditStatus === 'PROCESSING' ? 'Denetleniyor...' : 'Yorum bekleniyor')}
                  </p>
                  {img.contentAuditSuggestion && (
                    <p className="text-[11px] leading-snug mt-1" style={{ color: 'rgba(94,234,212,0.82)', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {img.contentAuditSuggestion}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EŞLEŞME İNCELE PANELİ — PARTIAL / NEEDS_REVIEW durumundaki eşleşmeler için kullanıcı kararı */}
      {activeSession?.id && (
        <MatchReviewPanel sessionId={activeSession.id} results={results as any[]} />
      )}

      {/* CANLI KONTROL AKIŞI — kullanıcı isteğiyle GİZLENDİ (içerik denetimine yer açmak için).
          feed/pushFeed altyapısı korunuyor (OCR akışı besliyor); sadece UI gizli. */}
      <div className="hidden rounded-xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
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
              {/* Sayaçlar imageId bazında unique — aynı fatura birkaç status geçişi yapsa bile tek sayılır */}
              <FeedCount kind="ok" label="OCR ✓" count={new Set(feed.filter((f) => f.kind === 'ok' && f.group === 'ocr' && f.imageId).map((f) => f.imageId!)).size} />
              <FeedCount kind="ok" label="Eşleşti" count={feed.filter((f) => f.kind === 'ok' && f.resultId).length} />
              <FeedCount kind="warn" label="İnceleme" count={new Set(feed.filter((f) => f.kind === 'warn' && f.imageId).map((f) => f.imageId!)).size + feed.filter((f) => f.kind === 'warn' && !f.imageId).length} />
              <FeedCount kind="err" label="Sorun" count={new Set(feed.filter((f) => f.kind === 'err' && f.imageId).map((f) => f.imageId!)).size + feed.filter((f) => f.kind === 'err' && !f.imageId).length} />
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

      {/* KONTROLLER — birleştirilmiş tablo (Geçmiş Kontroller + Kayıtlı Çıktılar) */}
      {(allSessions.length > 0 || outputs.length > 0) && (() => {
        // Output'ları mükellef+dönem+tip bazında session'larla join et.
        // Output olmayan session'lar: "—" gösterilir (henüz Excel indirilmemiş).
        const outByKey = new Map<string, any>();
        for (const o of outputs) {
          const key = `${(o.mukellefName || '').trim()}|${o.donem || ''}|${o.tip || ''}`;
          // Aynı key için en son (createdAt en yeni) output'u sakla
          const prev = outByKey.get(key);
          if (!prev || new Date(o.createdAt) > new Date(prev.createdAt)) {
            outByKey.set(key, o);
          }
        }
        const getTaxpayerName = (s: any) =>
          s.taxpayer
            ? s.taxpayer.companyName ||
              `${s.taxpayer.firstName ?? ''} ${s.taxpayer.lastName ?? ''}`.trim()
            : '—';

        // Merged list: sessions ekstra varsa o + onlara denk gelen output
        const merged = allSessions.slice(0, 20).map((s: any) => {
          const tname = getTaxpayerName(s);
          const key = `${tname}|${s.periodLabel || ''}|${s.type || ''}`;
          return { session: s, output: outByKey.get(key) || null };
        });
        // Session'ı silinmiş ama archive'da duran output'ları da sona ekle
        const sessionKeys = new Set(
          allSessions.map((s: any) => `${getTaxpayerName(s)}|${s.periodLabel || ''}|${s.type || ''}`),
        );
        const orphanOutputs = outputs
          .filter((o: any) => {
            const key = `${(o.mukellefName || '').trim()}|${o.donem || ''}|${o.tip || ''}`;
            return !sessionKeys.has(key);
          })
          .map((o: any) => ({ session: null, output: o }));

        const allRows = [...merged, ...orphanOutputs];

        return (
          <div>
            <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
              <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
              Kontroller
              {allRows.length > 0 && (
                <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
                  {allRows.length}
                </span>
              )}
            </h3>
            <div className="rounded-2xl overflow-x-auto overflow-y-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <table className="w-full min-w-[1120px] table-fixed text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <th className="w-[34%] px-5 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Kontrol</th>
                    <th className="w-[18%] px-3 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Veri</th>
                    <th className="w-[28%] px-3 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Sonuç</th>
                    <th className="w-[20%] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-right" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map(({ session: s, output: o }: any, idx: number) => {
                    const date = s?.createdAt || o?.createdAt;
                    const tname = s ? getTaxpayerName(s) : (o?.mukellefName ?? '—');
                    const donem = s?.periodLabel ?? o?.donem ?? '—';
                    const tip = s?.type ?? o?.tip ?? '—';
                    const luca = s?._count?.kdvRecords ?? '—';
                    const fatura = s?._count?.images ?? '—';
                    const summary = s?.matchSummary;
                    const matched = summary?.matched ?? o?.matchedCount ?? null;
                    const review = summary?.reviewTotal ?? o?.partialCount ?? null;
                    const amountMismatch = summary?.amountMismatch ?? 0;
                    const unmatched = summary ? (summary.unmatched ?? 0) + (summary.rejected ?? 0) : (o?.unmatchedCount ?? null);
                    const totalResults = summary?.totalResults ?? null;
                    const isLocked = Boolean(s?.isLocked || s?.status === 'COMPLETED');
                    // Tamamen boş oturum: o dönem hiç Luca hareketi VE fatura yok → manuel kilide izin ver.
                    const hasCount = !!(s && s._count && typeof s._count.kdvRecords !== 'undefined');
                    const bosOturum = !!(hasCount && Number(s._count.kdvRecords) === 0 && Number(s._count.images) === 0);
                    const canLock = Boolean(s && !isLocked && ((totalResults && totalResults > 0) || bosOturum));
                    const rowKey = s?.id || o?.id || idx;
                    return (
                      <tr key={rowKey} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 min-w-0 text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
                            <span className="block min-w-0 truncate">{tname}</span>
                            {isLocked && (
                              <span
                                className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-bold"
                                style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
                              >
                                <Lock size={11} />
                                Kilitli
                              </span>
                            )}
                            {!isLocked && review != null && review > 0 && (
                              <span
                                className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-bold"
                                style={{ background: 'rgba(245,158,11,0.13)', color: '#fbbf24' }}
                              >
                                <AlertTriangle size={11} />
                                {amountMismatch > 0 ? `Fark ${amountMismatch}` : 'İncele'}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.50)' }}>
                            <span className="shrink-0 tabular-nums">{fmtDate(date)}</span>
                            <span className="shrink-0 tabular-nums">{donem}</span>
                            <span className="min-w-0 truncate">{TYPE_LABEL[tip] || tip}</span>
                            {s?.maliyetUsd && s.maliyetUsd > 0 ? (
                              <span className="shrink-0 tabular-nums" style={{ color: 'rgba(168,85,247,0.82)' }}>
                                ${Number(s.maliyetUsd).toFixed(4)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5 text-[12px] tabular-nums">
                            <span className="px-2.5 py-1 rounded-lg" style={{ background: 'rgba(184,160,111,0.10)', color: GOLD }}>Luca {luca}</span>
                            <span className="px-2.5 py-1 rounded-lg" style={{ background: 'rgba(96,165,250,0.10)', color: '#93c5fd' }}>Fatura {fatura}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5 text-[12px] tabular-nums">
                            <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(34,197,94,0.10)', color: matched != null ? '#22c55e' : 'rgba(250,250,249,0.35)' }}>Eşleşen {matched ?? '—'}</span>
                            <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(245,158,11,0.10)', color: review && review > 0 ? '#fbbf24' : 'rgba(250,250,249,0.35)' }}>İnceleme {review ?? '—'}</span>
                            {amountMismatch > 0 && (
                              <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(245,158,11,0.14)', color: '#fbbf24' }}>Fark {amountMismatch}</span>
                            )}
                            <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(244,63,94,0.10)', color: unmatched && unmatched > 0 ? '#f43f5e' : 'rgba(250,250,249,0.35)' }}>Hata {unmatched ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex min-w-[166px] items-center justify-end gap-1.5">
                            {/* Sil — session varsa session'ı, yoksa output'u sil */}
                            <button
                              onClick={() => {
                                if (s) {
                                  if (confirm('Bu seansı silmek istediğinize emin misiniz? (Kayıtlı Excel arşivi korunacak)')) deleteSessionMut.mutate(s.id);
                                } else if (o) {
                                  if (confirm('Bu arşivlenmiş çıktıyı silmek istediğinize emin misiniz?')) deleteOutput.mutate(o.id);
                                }
                              }}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
                              title="Sil"
                            >
                              <Trash2 size={14} />
                            </button>
                            {/* Excel indir — önce archive'daki snapshot, yoksa session'dan canlı üret */}
                            <button
                              onClick={async () => {
                                if (o) {
                                  // Kayıtlı çıktı varsa onu indir
                                  downloadOutput.mutate({ id: o.id, filename: o.filename });
                                  return;
                                }
                                // Yoksa session'dan canlı Excel üret
                                if (!s) return;
                                try {
                                  toast.loading('Excel hazırlanıyor…', { id: `dl-${s.id}` });
                                  const ab = await kdvApi.exportExcel(s.id);
                                  const blob = new Blob([ab], {
                                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                  });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  const name = s.taxpayer?.companyName ||
                                    `${s.taxpayer?.firstName ?? ''} ${s.taxpayer?.lastName ?? ''}`.trim() ||
                                    'kdv-kontrol';
                                  a.download = `${name}-${(s.periodLabel || '').replace('/', '-')}-${s.type || 'kontrol'}.xlsx`;
                                  document.body.appendChild(a);
                                  a.click();
                                  URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                  toast.success('Excel indirildi', { id: `dl-${s.id}` });
                                } catch (e: any) {
                                  toast.error(e?.message || 'Excel indirilemedi', { id: `dl-${s?.id}` });
                                }
                              }}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)' }}
                              title={o ? 'Arşivlenmiş Excel indir' : 'Excel üret ve indir'}
                            >
                              <Download size={14} />
                            </button>
                            {/* Detay */}
                            {s ? (
                              <Link
                                href={`/panel/kdv-kontrol?s=${s.id}`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }}
                                title="Detay"
                              >
                                <ArrowRight size={14} />
                              </Link>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg cursor-not-allowed"
                                style={{ color: 'rgba(184,160,111,0.25)', background: 'rgba(184,160,111,0.04)' }}
                                title="Detay yok"
                              >
                                <ArrowRight size={14} />
                              </button>
                            )}
                            {s && isLocked ? (
                              <button
                                onClick={() => unlockSessionMut.mutate(s.id)}
                                disabled={unlockSessionMut.isPending}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                style={{ color: '#4ade80', background: 'rgba(34,197,94,0.08)' }}
                                title="Kilidi aç"
                              >
                                <Unlock size={14} />
                              </button>
                            ) : s && canLock ? (
                              <button
                                onClick={() => {
                                  if (bosOturum && (!totalResults || totalResults === 0)) {
                                    if (!confirm('Bu dönem hiç Luca hareketi veya fatura yok. Kontrolü BOŞ olarak kilitlemek istiyor musunuz?')) return;
                                  }
                                  lockSessionMut.mutate(s.id);
                                }}
                                disabled={lockSessionMut.isPending}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                style={{ color: '#60a5fa', background: 'rgba(96,165,250,0.08)' }}
                                title={bosOturum && (!totalResults || totalResults === 0) ? 'Boş kontrolü kilitle (hareket yok)' : 'Bu kontrolü kilitle'}
                              >
                                <Lock size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg cursor-not-allowed"
                                style={{ color: 'rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.04)' }}
                                title="Kilit işlemi yok"
                              >
                                <Lock size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

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
  // Mat ton paleti — Mihsap LogCard ile tutarlı
  const colors: Record<FeedItem['kind'], { c: string; bg: string; icon: string }> = {
    ok:   { c: '#6a9a6c', bg: 'rgba(60,120,70,0.05)',  icon: '✓' },
    warn: { c: '#b89870', bg: 'rgba(180,120,40,0.05)', icon: '⚠' },
    err:  { c: '#c85555', bg: 'rgba(180,50,50,0.07)',  icon: '✗' },
    info: { c: '#6b94c2', bg: 'rgba(96,140,200,0.05)', icon: '●' },
  };
  const s = colors[item.kind];
  const time = new Date(item.ts).toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' });
  // Detail çok satırlı olabilir — \n ile böl, anahtar kelimeli prefix yoksa tek satır kalır
  const detailLines = item.detail ? item.detail.split(/\r?\n/).filter((l) => l.length > 0) : [];
  return (
    <div
      className="flex items-start gap-3 px-3 py-2 rounded-lg text-[12px] animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{ background: s.bg, borderLeft: `2px solid ${s.c}` }}
    >
      <span className="text-[10px] tabular-nums flex-shrink-0 mt-0.5" style={{ color: '#6b6b6b' }}>
        {time}
      </span>
      <span className="font-bold flex-shrink-0" style={{ color: s.c, width: 14 }}>
        {s.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight" style={{ color: '#cbd5e1' }}>
          {item.title}
        </div>
        {detailLines.length > 0 && (
          <div className="text-[11px] mt-0.5" style={{ color: '#8a8a8a', lineHeight: '1.5' }}>
            {detailLines.map((line, i) => (
              <div key={i} style={{ minHeight: '1em' }}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentAuditModelBadge({ model }: { model?: string | null }) {
  const m = String(model || '');
  const isFallback = /^rule-fallback/i.test(m);
  const isRule = /^rule-based/i.test(m);
  const label = isFallback ? 'Kural fallback' : isRule ? 'Kural' : 'AI';
  const color = isFallback ? '#93c5fd' : isRule ? '#fbbf24' : '#5eead4';
  const bg = isFallback ? 'rgba(96,165,250,0.13)' : isRule ? 'rgba(245,158,11,0.12)' : 'rgba(20,184,166,0.12)';
  return (
    <span
      className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: bg, color }}
      title={m}
    >
      {label}
    </span>
  );
}

function ContentAuditBadge({ risk, status }: { risk?: string | null; status?: string | null }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    UYGUN: { label: 'Uygun', color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
    KONTROL_ET: { label: 'Kontrol Et', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    RISKLI: { label: 'Riskli', color: '#f43f5e', bg: 'rgba(244,63,94,0.15)' },
    ISLENMEMELI: { label: 'İşlenmemeli', color: '#fb7185', bg: 'rgba(244,63,94,0.20)' },
    PROCESSING: { label: 'İşleniyor', color: '#5eead4', bg: 'rgba(20,184,166,0.14)' },
    FAILED: { label: 'Hata', color: '#f43f5e', bg: 'rgba(244,63,94,0.15)' },
  };
  const s = map[risk || ''] || map[status || ''] || { label: 'Denetlenmedi', color: 'rgba(250,250,249,0.5)', bg: 'rgba(255,255,255,0.06)' };
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
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
