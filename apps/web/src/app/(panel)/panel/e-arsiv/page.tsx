'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { earsivApi, fmtTRY, type EarsivTip, type BelgeKaynak, type EarsivFatura, type LucaFetchJob } from '@/lib/earsiv';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import { toast } from 'sonner';
import {
  Download, Search, Users, Calendar, Sparkles, Loader2, FileText,
  Package, X, CheckSquare, Square, Eye, Printer, AlertCircle, XCircle,
} from 'lucide-react';

const GOLD = '#d4b876';

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
      // create:false, navigate:false → mevcut Luca sekmesi varsa kullan,
      // yoksa yeni sekme AÇMA (lokal Node agent zaten arka planda hallediyor).
      await bridge.openAgent('luca', { focus: false, create: false, navigate: false });
    } else if (typeof bridge.restartAll === 'function') {
      await bridge.restartAll();
    } else {
      return false;
    }
    await wait(5200);
    return true;
  } catch (e) {
    console.warn('[E-Arsiv] Luca agent uyandirma basarisiz:', e);
    return false;
  }
}

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  isEFaturaMukellefi?: boolean;
};
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

// Sorgulama modu — 4 farklı tipin tip+belgeKaynak ve UI bilgileri
type Mode = 'GELEN_EARSIV' | 'GIDEN_EARSIV' | 'GELEN_EFATURA' | 'GIDEN_EFATURA';
const MODE_INFO: Record<Mode, { label: string; tip: EarsivTip; belgeKaynak: BelgeKaynak; title: string; desc: string; color: string; bg: string }> = {
  GELEN_EARSIV:  { label: 'Gelen E-Arşiv',  tip: 'ALIS',  belgeKaynak: 'EARSIV',  title: 'Gelen E-Arşiv Sorgulama',
    desc: "Luca'dan mükellefin gelen (alış) e-arşiv faturalarını çek, listele, aç ve yazdır.",
    color: '#d4b876', bg: 'rgba(212,184,118,0.15)' },
  GIDEN_EARSIV:  { label: 'Giden E-Arşiv',  tip: 'SATIS', belgeKaynak: 'EARSIV',  title: 'Giden E-Arşiv Sorgulama',
    desc: "Mükellefin kestiği (satış) e-arşiv faturalarını çek — sadece e-fatura mükellefi olmayan mükellefler.",
    color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  GELEN_EFATURA: { label: 'Gelen E-Fatura', tip: 'ALIS',  belgeKaynak: 'EFATURA', title: 'Gelen E-Fatura Sorgulama',
    desc: "Mükellefe gelen (alış) e-faturalar — sadece e-fatura mükellefi olan mükellefler.",
    color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  GIDEN_EFATURA: { label: 'Giden E-Fatura', tip: 'SATIS', belgeKaynak: 'EFATURA', title: 'Giden E-Fatura Sorgulama',
    desc: "Mükellefin kestiği (satış) e-faturalar — sadece e-fatura mükellefi olan mükellefler.",
    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
};
// Hangi modlarda hangi mükellefler uygun?
function isModeAllowedForTaxpayer(mode: Mode, t: Taxpayer): boolean {
  const isEF = !!t.isEFaturaMukellefi;
  if (mode === 'GELEN_EARSIV') return true;       // herkes
  if (mode === 'GIDEN_EARSIV') return !isEF;       // sadece e-fatura mükellefi olmayanlar
  return isEF;                                     // gelen/giden e-fatura → sadece e-fatura mükellefleri
}

function getVisibleJobLines(errorLog: string | null | undefined): string[] {
  return errorLog
    ? errorLog.split('\n').filter((l: string) => l.trim() && !l.startsWith('[META]'))
    : [];
}

function cleanJobReason(line: string): string {
  let text = String(line || '')
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')
    .replace(/^[-–—•\s]+/, '')
    .replace(/^[✗×x❌⚠️⚠ℹ️ℹ✅✓⏳🔍📥📊📋]\s*/u, '')
    .replace(/^(EARSIV|EFATURA)_(SATIS|ALIS)\s*hata\s*:?\s*/i, '')
    .replace(/^NO_FATURA\s*:?\s*/i, '')
    .replace(/^hata\s*:?\s*/i, '')
    .trim();

  if (/fatura\s+bulunamad[ıi]|fatura\s+yok|kay[ıi]tl[ıi]\s+fatura\s+yok|NO_FATURA/i.test(text)) {
    return 'Fatura yok: bu dönem için kayıtlı fatura bulunamadı';
  }
  if (/firma.*(bulunamad[ıi]|se[cç]ilemedi)|m[üu]kellef.*(bulunamad[ıi]|se[cç]ilemedi)/i.test(text)) {
    return 'Luca firma seçilemedi';
  }
  if (/oturum|session|login|giri[şs]|yetki|[şs]ifre/i.test(text)) {
    return text || 'Luca oturum/yetki hatası';
  }
  if (/zaman\s+a[şs][ıi]m[ıi]|timeout|dk\s+i[cç]inde\s+tamamlanmad[ıi]|yakalanamad[ıi]/i.test(text)) {
    return text || 'Zaman aşımı';
  }
  if (/ZIP|zip|download|indir|dosya/i.test(text)) {
    return text || 'Dosya indirme/yükleme hatası';
  }
  if (/beklenen yap[ıi]da de[ğg]il|bulunamad[ıi]|tan[ıi]ml[ıi] de[ğg]il/i.test(text)) {
    return text;
  }
  return text || 'Sebep alınamadı';
}

function getJobFailureReason(lines: string[], status: string, isNoFatura: boolean): string {
  if (isNoFatura) return 'Fatura yok: bu dönem için kayıtlı fatura bulunamadı';
  const reasonLine = [...lines].reverse().find((line) =>
    /hata|error|bulunamad|bulunamadı|bulunamadi|zaman|timeout|NO_FATURA|fatura\s+yok|fatura\s+bulunamad|ZIP|zip|download|indir|oturum|yetki|şifre|sifre|seçilemedi|secilemedi/i.test(line)
  );
  if (reasonLine) return cleanJobReason(reasonLine);
  if (status === 'failed') return 'Sebep alınamadı';
  return '';
}
// Job kuyruğa atılma sırası — sabit (tıklama sırası önemli değil, kullanıcıya tutarlı görünüm)
const MODE_ORDER: Mode[] = ['GELEN_EARSIV', 'GIDEN_EARSIV', 'GELEN_EFATURA', 'GIDEN_EFATURA'];
const JOB_TIP_TO_MODE: Record<string, Mode> = {
  EARSIV_ALIS: 'GELEN_EARSIV',
  EARSIV_SATIS: 'GIDEN_EARSIV',
  EFATURA_ALIS: 'GELEN_EFATURA',
  EFATURA_SATIS: 'GIDEN_EFATURA',
};

export default function EarsivPage() {
  const qc = useQueryClient();
  // Sorgulama tipleri — birden fazla seçilebilir (Gelen E-Arşiv + Gelen E-Fatura gibi)
  const [modes, setModes] = useState<Set<Mode>>(new Set(['GELEN_EARSIV']));
  const modeArr = useMemo(() => Array.from(modes), [modes]);
  // Multi-select: birden fazla mükellef seçilebilir
  const [taxpayerIds, setTaxpayerIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [tumMukellefler, setTumMukellefler] = useState<boolean>(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [lucaLogLines, setLucaLogLines] = useState<string[]>([]);
  // Multi-job: her bir mükellef × mod için job ID + meta
  const [lucaJobIds, setLucaJobIds] = useState<string[]>([]);
  const [lucaJobMeta, setLucaJobMeta] = useState<Record<string, { mode: Mode; mukellef: string }>>({});
  const [lucaSummary, setLucaSummary] = useState<{ done: number; failed: number; nofatura: number; cancelled: number; total: number }>({ done: 0, failed: 0, nofatura: 0, cancelled: 0, total: 0 });
  // En son log/progress alan job — canlı görüş için banner & highlight kullanılır
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // Live log container ref'i — yeni satır geldiğinde otomatik en alta kaydır
  const liveLogRef = useRef<HTMLDivElement>(null);
  const [printingBulk, setPrintingBulk] = useState(false);
  // Sayfa içi fatura önizleme (yeni sekme yerine lightbox)
  const [previewFatura, setPreviewFatura] = useState<EarsivFatura | null>(null);
  const [previewAutoPrint, setPreviewAutoPrint] = useState(false);
  const [bulkPreviewHtml, setBulkPreviewHtml] = useState<string | null>(null);
  const [bulkPreviewCount, setBulkPreviewCount] = useState(0);

  // Mükellef listesi
  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });

  const taxpayerMap = useMemo(
    () => new Map(taxpayers.map((t) => [t.id, t] as const)),
    [taxpayers],
  );

  // E-arşiv fatura listesi — her seçili mod için ayrı sorgu, sonra birleştir
  const donem = `${year}-${String(month).padStart(2, '0')}`;
  const activeJobTips = useMemo(
    () => modeArr.map((m) => `${MODE_INFO[m].belgeKaynak}_${MODE_INFO[m].tip}`),
    [modeArr],
  );
  const activeJobTipsKey = activeJobTips.join(',');

  const { data: activeLucaJobs = [] } = useQuery({
    queryKey: ['earsiv-active-luca-jobs', donem, activeJobTipsKey],
    queryFn: () => earsivApi.listLucaJobs({
      limit: 100,
      status: 'active',
      tip: activeJobTipsKey,
    }),
    enabled: activeJobTips.length > 0,
    refetchInterval: 5000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const jobs = (activeLucaJobs || [])
      .filter((job: LucaFetchJob) =>
        job?.id &&
        job.donem === donem &&
        ['pending', 'running'].includes(String(job.status || '').toLowerCase()) &&
        JOB_TIP_TO_MODE[String(job.tip || '').toUpperCase()]
      )
      .sort((a: LucaFetchJob, b: LucaFetchJob) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );
    if (jobs.length === 0) return;

    const ids = jobs.map((job) => job.id);
    setLucaJobIds((prev) => {
      const merged = [...new Set([...prev, ...ids])];
      return merged.length === prev.length && merged.every((id, idx) => id === prev[idx]) ? prev : merged;
    });
    setLucaJobMeta((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const job of jobs) {
        if (next[job.id]) continue;
        const mode = JOB_TIP_TO_MODE[String(job.tip || '').toUpperCase()] || 'GELEN_EARSIV';
        const taxpayer = job.mukellefId ? taxpayerMap.get(job.mukellefId) : null;
        next[job.id] = {
          mode,
          mukellef: taxpayer ? taxpayerName(taxpayer) : `Mükellef ${job.mukellefId?.slice(-6) || ''}`.trim(),
        };
        changed = true;
      }
      return changed ? next : prev;
    });
    setLucaJobId((prev) => prev || ids[0] || null);
    setLucaStatus((prev) => prev || `Canlı sorgu bulundu: ${jobs.length} iş takip ediliyor`);
  }, [activeLucaJobs, donem, taxpayerMap]);

  const idsKey = [...taxpayerIds].sort().join(',');
  const queries = useQueries({
    queries: modeArr.map((m) => ({
      queryKey: ['earsiv-list', idsKey, donem, MODE_INFO[m].tip, MODE_INFO[m].belgeKaynak, search],
      queryFn: () => earsivApi.list({
        taxpayerId: idsKey || undefined,
        donem,
        tip: MODE_INFO[m].tip,
        belgeKaynak: MODE_INFO[m].belgeKaynak,
        search: search || undefined,
        pageSize: 5000,
      }),
      // Mükellef seçilmemiş olsa bile listeyi yükle — kullanıcı seçili dönem/tip için tüm faturaları görür
      enabled: true,
      // Cache yerine her mount/focus'ta yeniden çek — kullanıcı ay değiştirip
      // geri döndüğünde stale data göstermesin (Mihsap status, yeni faturalar vb.)
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: 'always' as const,
      refetchOnWindowFocus: true,
    })),
  });

  // Ay/yıl değişince TÜM earsiv-list cache'ini temizle ve refetch tetikle.
  // Bu sayede dropdown'dan başka aya geçince ekran kesin yenilenir.
  useEffect(() => {
    qc.removeQueries({ queryKey: ['earsiv-list'] });
    qc.refetchQueries({ queryKey: ['earsiv-list'], type: 'active' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);
  const isLoading = queries.some((q: any) => q.isLoading);
  // Mod bazında satırlar (mode tag ekleyerek)
  const rowsPerMode = useMemo(() => modeArr.map((m, i) => ({
    mode: m,
    rows: ((queries[i]?.data as any)?.rows ?? []) as EarsivFatura[],
  })), [modeArr, queries.map((q) => q.data).join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Birleşik satır listesi (her satıra hangi mod'tan geldiği eklenir)
  const rows = useMemo(() => rowsPerMode.flatMap(({ mode: m, rows: rs }) =>
    rs.map((r) => ({ ...r, _mode: m } as EarsivFatura & { _mode: Mode }))
  ), [rowsPerMode]);

  // Luca'dan Çek — her (mükellef × seçili mode) kombinasyonu için ayrı job
  const lucaMut = useMutation({
    mutationFn: async () => {
      if (modes.size === 0) throw new Error('En az bir sorgulama tipi seç (Gelen E-Arşiv, Giden E-Arşiv vb.)');
      // Mukellef listesi: her bir seçili moda uygun olanların union'u
      const isAllowedForAny = (t: Taxpayer) => modeArr.some((m) => isModeAllowedForTaxpayer(m, t));
      const uygunMukellefler = taxpayers.filter(isAllowedForAny);
      const hedefMukellefler = tumMukellefler
        ? uygunMukellefler
        : taxpayers.filter((t) => taxpayerIds.has(t.id));
      if (hedefMukellefler.length === 0) {
        throw new Error('Mükellef seçmedin — ya mükellef seç ya da "Tüm Mükellefler"i işaretle');
      }
      void wakeLucaAgentForFetch(setLucaStatus);
      // SABIT SIRA: önce Gelen E-Arşiv, sonra Giden E-Arşiv, sonra E-Fatura'lar
      // Mükellef bazlı dış döngü — bir mükellef için tüm tipler bittikten sonra diğeri
      const sortedModes = MODE_ORDER.filter((m) => modes.has(m));
      const jobIds: string[] = [];
      const jobMeta: Record<string, { mode: Mode; mukellef: string }> = {};
      let toplamJob = 0;
      for (const mk of hedefMukellefler) {
        for (const m of sortedModes) {
          if (!isModeAllowedForTaxpayer(m, mk)) continue;
          toplamJob++;
          try {
            const r = await earsivApi.fetchFromLuca({
              mukellefId: mk.id,
              donem,
              tip: MODE_INFO[m].tip,
              belgeKaynak: MODE_INFO[m].belgeKaynak,
            });
            jobIds.push(r.jobId);
            jobMeta[r.jobId] = { mode: m, mukellef: taxpayerName(mk) };
          } catch (e) {
            // tek tek başarısızlıkları görmezden gel
          }
        }
      }
      return { jobIds, jobMeta, mukellefSayisi: hedefMukellefler.length, toplamJob };
    },
    onSuccess: (d) => {
      if (d.jobIds.length === 0) {
        toast.error('Hiç job oluşturulamadı');
        return;
      }
      // Tüm jobIds'i + meta'yı state'e koy — multi-job polling devreye girecek
      setLucaJobIds(d.jobIds);
      setLucaJobMeta(d.jobMeta);
      setLucaSummary({ done: 0, failed: 0, nofatura: 0, cancelled: 0, total: d.jobIds.length });
      setLucaJobId(d.jobIds[0]); // tekil progress için ilk job (eski UI uyumluluğu)
      setLucaStatus(`Toplam ${d.jobIds.length} iş kuyruğa alındı (sıraya göre işlenecek)`);
      toast.success(`${d.jobIds.length} iş kuyruğa alındı`);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || e?.message || 'Job oluşturulamadı'),
  });

  // Multi-job polling — TÜM job'ları paralel olarak takip eder
  const cancelLucaJobsMut = useMutation({
    mutationFn: async () => {
      const ids = lucaJobIds.length > 0 ? lucaJobIds : (lucaJobId ? [lucaJobId] : []);
      await Promise.allSettled(ids.map((id) => earsivApi.cancelLucaJob(id)));
      return ids.length;
    },
    onSuccess: (count) => {
      setLucaStatus(`Iptal komutu gonderildi (${count} is) - Luca agent durdurma sinyalini aliyor`);
      toast.success('Iptal komutu Luca agentina gonderildi');
      lucaJobIds.forEach((id) => qc.invalidateQueries({ queryKey: ['earsiv-luca-job', id] }));
      setLucaJobId(null);
      setLucaJobIds([]);
      setLucaJobMeta({});
      setLucaSummary({ done: 0, failed: 0, nofatura: 0, cancelled: 0, total: 0 });
      setLucaStatus('');
      setLucaLogLines([]);
      setActiveJobId(null);
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || e?.message || 'Iptal komutu gonderilemedi');
    },
  });

  const allJobQueries = useQueries({
    queries: lucaJobIds.map((id) => ({
      queryKey: ['earsiv-luca-job', id],
      queryFn: () => earsivApi.getLucaJob(id),
      enabled: !!id,
      refetchInterval: (query: any) => {
        const data: any = query.state.data;
        const job = data?.job ?? data;
        if (job?.status === 'done' || job?.status === 'failed' || job?.status === 'cancelled') return false; // bitti, durdur
        // Çalışan job'lar için hızlı polling (1.5s) — anlık ilerleme görünsün.
        // Pending'ler için biraz daha rahat (2.5s) — gereksiz network'ten kaçın.
        if (job?.status === 'running') return 1500;
        return 2500;
      },
    })),
  });

  // Eski tekli query (geriye uyumluluk için ilk job'u izler)
  const lucaJobQuery = allJobQueries[0] || { data: null };

  // Tüm job'ların durumunu birleştir
  useEffect(() => {
    if (lucaJobIds.length === 0) return;
    let done = 0, failed = 0, nofatura = 0, cancelled = 0, running = 0, pending = 0;
    const liveLogLines: string[] = [];
    let activeJobIdLocal: string | null = null;
    let activeJobLastTs = 0;
    const sonuclar: { mode: Mode; mukellef: string; status: string; sonLog: string; isNoFatura: boolean }[] = [];
    for (let i = 0; i < lucaJobIds.length; i++) {
      const id = lucaJobIds[i];
      const q: any = allJobQueries[i];
      const job = (q?.data?.job ?? q?.data) || null;
      const meta = lucaJobMeta[id];
      const errorLog = job?.errorMsg || '';
      // [META] satırlarını filtrele — kullanıcıya gösterme
      const lines = getVisibleJobLines(errorLog);
      const lastLine = lines[lines.length - 1] || '';
      const isNoFatura = /fatura bulunamadı|NO_FATURA|fatura yok/i.test(lastLine) || job?.noFatura === true;

      if ((job?.status === 'done' || job?.status === 'failed') && isNoFatura) {
        nofatura++;
      } else if (job?.status === 'done') {
        done++;
      } else if (job?.status === 'cancelled') {
        cancelled++;
      } else if (job?.status === 'failed') {
        failed++;
      } else if (job?.status === 'running') {
        running++;
      } else {
        pending++;
      }

      sonuclar.push({
        mode: meta?.mode || 'GELEN_EARSIV',
        mukellef: meta?.mukellef || '?',
        status: job?.status || 'pending',
        sonLog: lastLine,
        isNoFatura,
      });

      // Live log: hem RUNNING hem de PENDING job'lardan progress mesajı varsa al.
      // Agent firma değiştirme sırasında /start öncesi de log gönderiyor; pending de
      // olsa son satırı göster ki kullanıcı hareket görebilsin.
      const isActiveStatus = job?.status === 'running' || job?.status === 'pending';
      if (isActiveStatus && lastLine) {
        liveLogLines.push(`[${MODE_INFO[meta?.mode || 'GELEN_EARSIV'].label} · ${meta?.mukellef || '?'}] ${lastLine}`);
      }

      // En son güncellenen aktif job'ı bul — UI'da üste çıkar/highlight et
      if (isActiveStatus && lastLine) {
        // updatedAt yoksa errorMsg'in son timestamp'ini parse etmeyi dene
        const tsMatch = lastLine.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
        let ts = 0;
        if (tsMatch) {
          ts = parseInt(tsMatch[1], 10) * 3600 + parseInt(tsMatch[2], 10) * 60 + parseInt(tsMatch[3], 10);
        }
        if (ts >= activeJobLastTs) {
          activeJobLastTs = ts;
          activeJobIdLocal = id;
        }
      }
    }
    setLucaSummary({ done, failed, nofatura, cancelled, total: lucaJobIds.length });
    setLucaLogLines(liveLogLines.slice(-30));
    setActiveJobId(activeJobIdLocal);

    const tamamlanan = done + failed + nofatura + cancelled;
    if (tamamlanan === lucaJobIds.length) {
      // Hepsi bitti — özet göster
      setLucaStatus(`Tamamlandi - ${done} basarili / ${nofatura} fatura yok / ${failed} hata / ${cancelled} iptal`);
      // Listeyi ZORLA yenile (invalidate queue'lar, refetch hemen tetikler)
      qc.refetchQueries({ queryKey: ['earsiv-list'], type: 'active' });
      // 5sn sonra status'ü temizle
      const t = setTimeout(() => {
        setLucaJobId(null);
        setLucaJobIds([]);
        setLucaJobMeta({});
        setLucaStatus('');
        setLucaLogLines([]);
        setActiveJobId(null);
      }, 5000);
      return () => clearTimeout(t);
    } else {
      setLucaStatus(`İşleniyor ${tamamlanan}/${lucaJobIds.length} · ${running} çalışıyor, ${pending} sırada`);
      // Bir job done olduysa liste yenile (kısmi sonuç da görünür) — refetch zorla
      if (done > 0 || nofatura > 0) qc.refetchQueries({ queryKey: ['earsiv-list'], type: 'active' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobQueries.map((q: any) => q?.data?.job?.status || q?.data?.status || '').join(',')]);

  // Live log auto-scroll — yeni satır geldikçe en alta in
  useEffect(() => {
    if (liveLogRef.current) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
    }
  }, [lucaLogLines]);

  const lucaAgentRunningHint = useMemo(
    () => /Luca agent|Moren Agent|giris ekraninda|LUCASSO|agiris\.luca\.com\.tr|Klasik Luca|auygs\.luca\.com\.tr\/Luca\//i.test(lucaLogLines.join('\n')),
    [lucaLogLines],
  );

  // (Eski yeni-sekme akışı kaldırıldı — artık sayfa içi EarsivPreviewModal ile gösteriliyor)

  // Toplu yazdır — seçili faturaların hepsini tek HTML'e topla, yeni sekmede aç + print tetikle
  const topluYazdirMut = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error('En az bir fatura seç');
      // Auth'lu fetch (api axios → Authorization header otomatik)
      const r = await api.post('/earsiv/print-bulk', { ids: [...selected] }, { responseType: 'text' });
      const html = typeof r.data === 'string' ? r.data : String(r.data);
      return { html, count: selected.size };
    },
    onSuccess: ({ html, count }) => {
      // Sayfa içi modal — yeni sekme açma, popup engelli sorunu yok
      setBulkPreviewHtml(html);
      setBulkPreviewCount(count);
      toast.success(`${count} fatura yazdırma için açıldı`);
    },
    onError: (e: any) => toast.error(e?.message || 'Toplu yazdırma başarısız'),
  });

  // Seçili faturaların ne kadarı GELEN E-ARŞİV — Mihsap upload sadece bunları kabul eder.
  const mihsapEligibleIds = useMemo(() => {
    const eligible: string[] = [];
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      // Sadece tip=ALIS ve belgeKaynak=EARSIV olanlar
      if ((r as any).tip === 'ALIS' && (r as any).belgeKaynak === 'EARSIV') {
        eligible.push(r.id);
      }
    }
    return eligible;
  }, [rows, selected]);

  // Mihsap'a Yükle — sadece Gelen E-Arşiv faturalarını Gider Faturası olarak Mihsap'a aktar
  const aktarMerkezeMut = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) {
        throw new Error('Once aktarilacak fatura(lar)i secin.');
      }
      const ids = Array.from(selected);
      const r = await api.post('/fatura-muhasebelestirme/documents/backfill-earsiv', { ids });
      return r.data as { ok?: boolean; created?: number; alreadyQueued?: number; failed?: number; errors?: Array<{ id: string; message: string }> };
    },
    onSuccess: (d) => {
      const created = d?.created || 0;
      const already = d?.alreadyQueued || 0;
      const failed = d?.failed || 0;
      const parts: string[] = [];
      if (created) parts.push(`${created} yeni belge`);
      if (already) parts.push(`${already} zaten vardi`);
      if (failed) parts.push(`${failed} hata`);
      toast.success(`Fatura Merkezi'ne aktarildi: ${parts.join(' . ') || 'islem bos'}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['earsiv', 'list'] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || e?.message || 'Aktarim basarisiz');
    },
  });

  const mihsapYukleMut = useMutation({
    mutationFn: async () => {
      if (mihsapEligibleIds.length === 0) {
        throw new Error('Seçimde Gelen E-Arşiv fatura yok — Mihsap sadece bunları kabul eder');
      }
      const r = await api.post('/earsiv/upload-to-mihsap', { ids: mihsapEligibleIds });
      return r.data as { total: number; uploaded: number; failed: number; skipped: number };
    },
    onSuccess: (d) => {
      const parts: string[] = [];
      if (d.uploaded) parts.push(`${d.uploaded} yüklendi`);
      if (d.failed) parts.push(`${d.failed} hata`);
      if (d.skipped) parts.push(`${d.skipped} atlandı`);
      const msg = parts.join(' · ') || `${d.total} fatura işlendi`;
      if (d.failed > 0) toast.error(`Mihsap: ${msg}`);
      else toast.success(`Mihsap: ${msg}`);
      qc.refetchQueries({ queryKey: ['earsiv-list'], type: 'active' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Mihsap yükleme başarısız'),
  });

  // Toplu İndir — her faturayı AYRI PDF olarak ZIP içinde döner, tarayıcı ZIP'i indirir
  const topluIndirMut = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error('En az bir fatura seç');
      const r = await api.post(
        '/earsiv/download-bulk-pdfs',
        { ids: [...selected] },
        { responseType: 'blob' },
      );
      return { blob: r.data as Blob, count: selected.size };
    },
    onSuccess: ({ blob, count }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `e-arsiv-faturalar-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      toast.success(`${count} fatura PDF olarak indiriliyor`);
    },
    onError: (e: any) => toast.error(e?.message || 'Toplu indirme başarısız'),
  });

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  // Mükellef filtresi: seçili modlardan EN AZ BİRİNE uygun olanlar (union)
  const uygunMukellefler = useMemo(
    () => taxpayers.filter((t) => modeArr.some((m) => isModeAllowedForTaxpayer(m, t))),
    [taxpayers, modeArr],
  );
  const filteredTp = useMemo(
    () => uygunMukellefler.filter((t) => taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase())),
    [uygunMukellefler, pickerSearch],
  );
  const selectedTpList = useMemo(
    () => taxpayers.filter((t) => taxpayerIds.has(t.id)),
    [taxpayers, taxpayerIds],
  );

  // Mod başına totaller (her bir Mode için ayrı toplam)
  const totalsPerMode = useMemo(() => rowsPerMode.map(({ mode: m, rows: rs }) => {
    let mat = 0, k = 0, t = 0;
    rs.forEach((r: any) => {
      mat += parseFloat(String(r.matrah ?? 0)) || 0;
      k += parseFloat(String(r.kdvTutari ?? 0)) || 0;
      t += parseFloat(String(r.toplamTutar ?? 0)) || 0;
    });
    return { mode: m, matrah: mat, kdv: k, toplam: t, count: rs.length };
  }), [rowsPerMode]);
  // Yön bazında toplam (ALIŞ ve SATIŞ ayrı toplanır — gelen+giden toplamak anlamsız)
  const yonTotals = useMemo(() => {
    const acc = {
      ALIS:  { matrah: 0, kdv: 0, toplam: 0, count: 0 },
      SATIS: { matrah: 0, kdv: 0, toplam: 0, count: 0 },
    };
    totalsPerMode.forEach((x) => {
      if (x.count === 0) return;
      const yon = MODE_INFO[x.mode].tip; // 'ALIS' | 'SATIS'
      acc[yon].matrah += x.matrah;
      acc[yon].kdv    += x.kdv;
      acc[yon].toplam += x.toplam;
      acc[yon].count  += x.count;
    });
    return acc;
  }, [totalsPerMode]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Otomasyon
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          E-Fatura / E-Arşiv Fatura Sorgulama
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Luca'dan gelen/giden e-arşiv ve e-fatura kayıtlarını çek, listele, aç ve yazdır. Birden fazla tip aynı anda sorgulanabilir.
        </p>
      </div>

      {/* 4-Tip Sorgulama Seçici — ÇOKLU SEÇİM (toggle) — her tip kendi renginde */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => {
          const aktif = modes.has(m);
          const info = MODE_INFO[m];
          return (
            <button
              key={m}
              onClick={() => {
                setModes((s) => {
                  const ns = new Set(s);
                  if (ns.has(m)) {
                    if (ns.size > 1) ns.delete(m); // en az 1 mod seçili kalsın
                  } else {
                    ns.add(m);
                  }
                  return ns;
                });
                // Mükellef seçimi KORUNUYOR — sadece tablo satır seçimi sıfırlanır
                // (liste yeniden yüklenecek, eski fatura id'leri geçersiz)
                setSelected(new Set());
              }}
              className="px-3 py-2.5 rounded-md text-sm font-semibold text-center transition-all flex items-center justify-center gap-1.5"
              style={{
                background: aktif ? info.bg : 'rgba(255,255,255,0.03)',
                color: aktif ? info.color : 'rgba(250,250,249,0.6)',
                border: `1.5px solid ${aktif ? info.color : 'rgba(255,255,255,0.08)'}`,
                boxShadow: aktif ? `0 0 0 2px ${info.bg}` : 'none',
              }}
              title={aktif ? 'Tıklayarak kapat' : 'Tıklayarak aç'}
            >
              {aktif
                ? <CheckSquare size={12} style={{ color: info.color }} />
                : <Square size={12} style={{ color: 'rgba(250,250,249,0.3)' }} />}
              {info.label}
            </button>
          );
        })}
      </div>

      {/* Tüm mükellefler toggle — toplu çekim için */}
      <div className="flex items-center gap-3">
        <label
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium cursor-pointer"
          style={{
            background: tumMukellefler ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${tumMukellefler ? 'rgba(184,160,111,0.35)' : 'rgba(255,255,255,0.08)'}`,
            color: tumMukellefler ? GOLD : 'rgba(250,250,249,0.7)',
          }}
        >
          <input
            type="checkbox"
            checked={tumMukellefler}
            onChange={(e) => {
              setTumMukellefler(e.target.checked);
              if (e.target.checked) setTaxpayerIds(new Set()); // tüm seçildiyse manuel seçimi sıfırla
            }}
            style={{ accentColor: '#d4b876' }}
          />
          Tüm Uygun Mükellefler ({uygunMukellefler.length})
        </label>
        {tumMukellefler && (
          <span className="text-[11px] italic" style={{ color: 'rgba(250,250,249,0.55)' }}>
            · Tek "Luca'dan Çek" tıklaması ile {uygunMukellefler.length} mükellef × {modes.size} sorgu tipi (uyumlu kombinasyonlar) işleme alınacak
          </span>
        )}
        {!tumMukellefler && taxpayerIds.size > 0 && (
          <span className="text-[11px] italic" style={{ color: GOLD }}>
            · {taxpayerIds.size} mükellef seçildi
          </span>
        )}
      </div>

      {/* Filtreler */}
      <div className="rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Mükellef */}
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            <Users size={10} className="inline mr-1" /> Mükellef
          </label>
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            <span className="truncate">
              {selectedTpList.length === 0 ? 'Mükellef seç… (birden fazla seçebilirsin)'
                : selectedTpList.length === 1 ? taxpayerName(selectedTpList[0])
                : `${selectedTpList.length} mükellef seçildi: ${selectedTpList.slice(0, 2).map(taxpayerName).join(', ')}${selectedTpList.length > 2 ? '…' : ''}`}
            </span>
            <Search size={14} style={{ color: GOLD }} />
          </button>
        </div>
        {/* Yıl */}
        <div>
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            <Calendar size={10} className="inline mr-1" /> Yıl
          </label>
          <input
            type="number"
            min={2020}
            max={2099}
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || now.getFullYear())}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        {/* Ay */}
        <div>
          <label className="text-[10px] uppercase tracking-[.16em] mb-1.5 block" style={{ color: '#b8a06f' }}>
            Ay
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {[
              'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
              'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
            ].map((adi, i) => (
              <option key={i + 1} value={i + 1} style={{ background: '#1a1a1a', color: '#fafaf9' }}>
                {adi}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex gap-3 flex-wrap items-center">
        <button
          disabled={(!tumMukellefler && taxpayerIds.size === 0) || lucaMut.isPending || !!lucaJobId}
          onClick={() => lucaMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: GOLD, color: '#1a1a18', border: 0 }}
        >
          {lucaMut.isPending || lucaJobId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {lucaJobId ? 'Çekiliyor…' : "Luca'dan Çek"}
        </button>

        <button
          disabled={selected.size === 0 || topluYazdirMut.isPending}
          onClick={() => topluYazdirMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
        >
          {topluYazdirMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
          Toplu Yazdır {selected.size > 0 ? `(${selected.size})` : ''}
        </button>

        <button
          disabled={selected.size === 0 || topluIndirMut.isPending}
          onClick={() => topluIndirMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.9)', border: '1px solid rgba(255,255,255,0.1)' }}
          title="Seçili faturaları AYRI AYRI PDF olarak ZIP içinde indir"
        >
          {topluIndirMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Toplu İndir {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
          <button
            onClick={() => aktarMerkezeMut.mutate()}
            disabled={aktarMerkezeMut.isPending || selected.size === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: '#0ea5e9', color: 'white' }}
            title="Secili faturalari Fatura Isleme Merkezi'ne aktar"
          >
            {aktarMerkezeMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            Fatura Merkezi&apos;ne Aktar ({selected.size})
          </button>

        <button
          disabled={mihsapEligibleIds.length === 0 || mihsapYukleMut.isPending}
          onClick={() => mihsapYukleMut.mutate()}
          className="px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.35)' }}
          title={mihsapEligibleIds.length === 0
            ? 'Sadece Gelen E-Arşiv faturalarını Mihsap\'a yükleyebilirsin'
            : `${mihsapEligibleIds.length} Gelen E-Arşiv fatura Mihsap\'a Gider Faturası olarak yüklenecek`}
        >
          {mihsapYukleMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Mihsap'a Yükle {mihsapEligibleIds.length > 0 ? `(${mihsapEligibleIds.length})` : ''}
        </button>

        <input
          placeholder="Fatura no, satıcı, vergi no ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-md text-sm"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
      </div>

      {/* Job durumu — detaylı per-job status listesi */}
      {(lucaJobIds.length > 0 || lucaJobId) && (
        <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(184,160,111,0.06)', border: '1px solid rgba(184,160,111,0.25)', color: '#fafaf9' }}>
          <div className="flex items-center gap-3 mb-3">
            {lucaSummary.done + lucaSummary.failed + lucaSummary.nofatura + lucaSummary.cancelled < lucaSummary.total
              ? <Loader2 size={16} className="animate-spin" style={{ color: GOLD, flexShrink: 0 }} />
              : <span style={{ color: '#22c55e', fontSize: 18 }}>✓</span>}
            <div className="flex-1">
              <div style={{ color: GOLD, fontWeight: 600, fontSize: 13 }}>
                {lucaSummary.done + lucaSummary.failed + lucaSummary.nofatura + lucaSummary.cancelled < lucaSummary.total
                  ? 'Luca işlemi portal içinde yönetiliyor'
                  : 'Tüm işler tamamlandı'}
              </div>
              <div style={{ color: 'rgba(250,250,249,0.65)', fontSize: 12, marginTop: 2 }}>
                {lucaStatus}
              </div>
            </div>
            {/* Sayaç rozetleri */}
            <div className="flex items-center gap-1.5">
              {lucaSummary.done > 0 && (
                <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
                  ✓ {lucaSummary.done}
                </span>
              )}
              {lucaSummary.nofatura > 0 && (
                <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
                  ⊝ {lucaSummary.nofatura} fatura yok
                </span>
              )}
              {lucaSummary.failed > 0 && (
                <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                  ✗ {lucaSummary.failed} hata
                </span>
              )}
              {lucaSummary.cancelled > 0 && (
                <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ background: 'rgba(148,163,184,0.15)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}>
                  {lucaSummary.cancelled} iptal
                </span>
              )}
            </div>
            <button
              onClick={() => {
                const finished = lucaSummary.done + lucaSummary.failed + lucaSummary.nofatura + lucaSummary.cancelled === lucaSummary.total;
                if (!finished) {
                  cancelLucaJobsMut.mutate();
                  return;
                }
                setLucaJobId(null);
                setLucaJobIds([]);
                setLucaJobMeta({});
                setLucaStatus('');
                setLucaLogLines([]);
                setActiveJobId(null);
              }}
              disabled={cancelLucaJobsMut.isPending}
              className="px-3 py-1.5 rounded-md text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)', border: 0 }}
            >
              {cancelLucaJobsMut.isPending
                ? 'Iptal ediliyor...'
                : lucaSummary.done + lucaSummary.failed + lucaSummary.nofatura + lucaSummary.cancelled === lucaSummary.total ? 'Kapat' : 'Iptal'}
            </button>
          </div>

          <LucaInlineCaptchaPanel
            jobIds={lucaJobIds.length > 0 ? lucaJobIds : (lucaJobId ? [lucaJobId] : [])}
            color={GOLD}
            agentRunningHint={lucaAgentRunningHint}
            onAnswered={() => lucaJobIds.forEach((id) => qc.invalidateQueries({ queryKey: ['earsiv-luca-job', id] }))}
            onCancel={() => cancelLucaJobsMut.mutate()}
          />

          {/* AKTİF JOB BANNER — şu an Luca'da hangi mükellef işleniyor */}
          {(() => {
            const activeIdx = activeJobId ? lucaJobIds.indexOf(activeJobId) : -1;
            if (activeIdx < 0) return null;
            const activeMeta = lucaJobMeta[activeJobId!];
            const activeQ: any = allJobQueries[activeIdx];
            const activeJob = (activeQ?.data?.job ?? activeQ?.data) || null;
            const activeErr = activeJob?.errorMsg || '';
            const activeLines = getVisibleJobLines(activeErr);
            const activeLast = activeLines[activeLines.length - 1] || 'Hazırlanıyor…';
            const activeMode = MODE_INFO[activeMeta?.mode || 'GELEN_EARSIV'];
            return (
              <div
                className="mb-3 p-3 rounded-md flex items-center gap-3"
                style={{
                  background: 'rgba(212,184,118,0.10)',
                  border: '1px solid rgba(212,184,118,0.4)',
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              >
                <Loader2 size={18} className="animate-spin" style={{ color: GOLD, flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                      style={{ background: activeMode.bg, color: activeMode.color, border: `1px solid ${activeMode.color}33` }}
                    >
                      {activeMode.label}
                    </span>
                    <span style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>
                      ŞU AN: {activeMeta?.mukellef || '?'}
                    </span>
                  </div>
                  <div className="text-[12px] truncate font-mono" style={{ color: 'rgba(250,250,249,0.75)' }}>
                    {activeLast}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Per-job status grid */}
          {lucaJobIds.length > 0 && (
            <div className="space-y-1.5 mb-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {lucaJobIds.map((id, i) => {
                if (id === activeJobId) return null;
                const q: any = allJobQueries[i];
                const job = (q?.data?.job ?? q?.data) || null;
                const meta = lucaJobMeta[id];
                const errorLog = job?.errorMsg || '';
                // [META] satırlarını UI'da gösterme
                const lines = getVisibleJobLines(errorLog);
                const lastLine = lines[lines.length - 1] || '';
                const isNoFatura = /fatura bulunamadı|NO_FATURA|fatura yok/i.test(lastLine) || job?.noFatura === true;
                const status = job?.status || 'pending';
                const failureReason = getJobFailureReason(lines, status, isNoFatura);
                const isActiveRow = id === activeJobId;
                let icon = <span style={{ color: 'rgba(250,250,249,0.4)' }}>⏸</span>;
                let badge = 'Sırada';
                let badgeColor = '#94a3b8';
                let badgeBg = 'rgba(148,163,184,0.12)';
                if (status === 'running') {
                  icon = <Loader2 size={12} className="animate-spin" style={{ color: GOLD }} />;
                  badge = 'Çalışıyor';
                  badgeColor = '#d4b876';
                  badgeBg = 'rgba(212,184,118,0.15)';
                } else if (isNoFatura && (status === 'done' || status === 'failed')) {
                  icon = <span>⊝</span>;
                  badge = 'Fatura yok';
                  badgeColor = '#fbbf24';
                  badgeBg = 'rgba(245,158,11,0.15)';
                } else if (status === 'done') {
                  icon = <span style={{ color: '#22c55e' }}>✓</span>;
                  badge = 'Tamamlandı';
                  badgeColor = '#4ade80';
                  badgeBg = 'rgba(34,197,94,0.15)';
                } else if (status === 'cancelled') {
                  icon = <span style={{ color: '#94a3b8' }}>×</span>;
                  badge = 'Iptal';
                  badgeColor = '#cbd5e1';
                  badgeBg = 'rgba(148,163,184,0.15)';
                } else if (status === 'failed') {
                  icon = <span style={{ color: '#ef4444' }}>✗</span>;
                  badge = 'Hata';
                  badgeColor = '#fca5a5';
                  badgeBg = 'rgba(239,68,68,0.15)';
                } else if (status === 'pending' && lastLine) {
                  // Pending ama log var → agent firma değiştiriyor / hazırlık aşamasında
                  icon = <Loader2 size={12} className="animate-spin" style={{ color: '#a78bfa' }} />;
                  badge = 'Hazırlanıyor';
                  badgeColor = '#a78bfa';
                  badgeBg = 'rgba(167,139,250,0.15)';
                }
                const modeInfo = MODE_INFO[meta?.mode || 'GELEN_EARSIV'];
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md"
                    style={{
                      background: isActiveRow ? 'rgba(212,184,118,0.10)' : 'rgba(0,0,0,0.25)',
                      border: isActiveRow
                        ? '1px solid rgba(212,184,118,0.45)'
                        : '1px solid rgba(255,255,255,0.04)',
                      boxShadow: isActiveRow ? '0 0 0 1px rgba(212,184,118,0.15)' : 'none',
                    }}
                  >
                    <div style={{ width: 18, textAlign: 'center', fontSize: 14 }}>{icon}</div>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                      style={{ background: modeInfo.bg, color: modeInfo.color, border: `1px solid ${modeInfo.color}33` }}
                    >
                      {modeInfo.label}
                    </span>
                    <div className="flex-1 text-[12px] truncate" style={{ color: '#fafaf9' }}>
                      {meta?.mukellef || '—'}
                    </div>
                    {/* Çalışan VE hazırlanan job'larda son log satırı görünür */}
                    {(status === 'running' || status === 'pending') && lastLine && (
                      <div className="text-[11px] truncate font-mono" style={{ color: 'rgba(250,250,249,0.55)', maxWidth: 360 }}>
                        {lastLine}
                      </div>
                    )}
                    {((status === 'failed') || isNoFatura) && failureReason && (
                      <div
                        className="text-[11px] truncate"
                        title={failureReason}
                        style={{
                          color: isNoFatura ? '#fbbf24' : '#fca5a5',
                          maxWidth: 420,
                          fontWeight: 600,
                        }}
                      >
                        {failureReason}
                      </div>
                    )}
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                      style={{ background: badgeBg, color: badgeColor }}
                    >
                      {badge}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live log container — çalışan + hazırlanan job'ların son satırları, auto-scroll */}
          {lucaLogLines.length > 0 && (
            <div
              ref={liveLogRef}
              className="rounded-md p-2.5 text-[11px] font-mono space-y-0.5"
              style={{
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.05)',
                color: 'rgba(250,250,249,0.65)',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {lucaLogLines.map((line, i) => {
                const isErr = /✗|hata|error|başarısız/i.test(line);
                const isOk = /✓|✅|tamamlandı|başarılı|yüklendi/i.test(line);
                const isProgress = /🔄|📥|🔍|⏳|hazırlanıyor|değiştiriliyor|indiriliyor|çekiliyor/i.test(line);
                return (
                  <div
                    key={i}
                    style={{
                      color: isErr
                        ? '#ef4444'
                        : isOk
                        ? '#10b981'
                        : isProgress
                        ? '#d4b876'
                        : 'rgba(250,250,249,0.6)',
                    }}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Özet — mod başına ayrı + grand total */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {/* Mod başına satır (tek mod seçiliyse 1 satır, çokluda her biri) */}
          {totalsPerMode.filter((x) => x.count > 0).map((x) => (
            <div
              key={x.mode}
              className="rounded-lg p-3 grid grid-cols-[160px_1fr_1fr_1fr_80px] gap-3 items-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: '#fafaf9' }}>
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold"
                  style={{
                    background: MODE_INFO[x.mode].tip === 'SATIS' ? 'rgba(34,197,94,.15)' : 'rgba(59,130,246,.15)',
                    color: MODE_INFO[x.mode].tip === 'SATIS' ? '#4ade80' : '#60a5fa',
                  }}
                >
                  {MODE_INFO[x.mode].tip === 'SATIS' ? 'GİDEN' : 'GELEN'}
                </span>
                {MODE_INFO[x.mode].belgeKaynak === 'EFATURA' ? 'E-Fatura' : 'E-Arşiv'}
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Matrah</div>
                <div style={{ color: GOLD, fontSize: 14, fontWeight: 600 }}>{fmtTRY(x.matrah)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.45)' }}>KDV</div>
                <div style={{ color: '#fafaf9', fontSize: 14, fontWeight: 600 }}>{fmtTRY(x.kdv)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Toplam</div>
                <div style={{ color: '#fafaf9', fontSize: 14, fontWeight: 600 }}>{fmtTRY(x.toplam)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Adet</div>
                <div style={{ color: '#fafaf9', fontSize: 14, fontWeight: 600 }}>{x.count}</div>
              </div>
            </div>
          ))}
          {/* Yön bazında toplam — ALIŞ ve SATIŞ ayrı (gelen ile gideni toplamak anlamsız).
              Sadece bir tipte birden fazla mod seçildiğinde gösterir (örn Gelen E-Arşiv + Gelen E-Fatura → ALIŞ TOPLAM). */}
          {(() => {
            // Aynı yönde 2+ mod varsa o yön için toplam göster
            const alisModeCount = totalsPerMode.filter((x) => x.count > 0 && MODE_INFO[x.mode].tip === 'ALIS').length;
            const satisModeCount = totalsPerMode.filter((x) => x.count > 0 && MODE_INFO[x.mode].tip === 'SATIS').length;
            return (
              <>
                {alisModeCount > 1 && (
                  <div
                    className="rounded-lg p-3 grid grid-cols-[160px_1fr_1fr_1fr_80px] gap-3 items-center"
                    style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' }}
                  >
                    <div className="text-[12px] font-bold uppercase tracking-wider" style={{ color: '#60a5fa' }}>
                      ALIŞ TOPLAM
                    </div>
                    <div className="text-right"><div style={{ color: '#60a5fa', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.ALIS.matrah)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.ALIS.kdv)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.ALIS.toplam)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{yonTotals.ALIS.count}</div></div>
                  </div>
                )}
                {satisModeCount > 1 && (
                  <div
                    className="rounded-lg p-3 grid grid-cols-[160px_1fr_1fr_1fr_80px] gap-3 items-center"
                    style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}
                  >
                    <div className="text-[12px] font-bold uppercase tracking-wider" style={{ color: '#4ade80' }}>
                      SATIŞ TOPLAM
                    </div>
                    <div className="text-right"><div style={{ color: '#4ade80', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.SATIS.matrah)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.SATIS.kdv)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{fmtTRY(yonTotals.SATIS.toplam)}</div></div>
                    <div className="text-right"><div style={{ color: '#fafaf9', fontSize: 16, fontWeight: 700 }}>{yonTotals.SATIS.count}</div></div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Tablo */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {taxpayerIds.size === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Önce mükellef seç…
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <Loader2 size={16} className="inline animate-spin mr-2" /> Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Bu dönem için kayıtlı fatura yok. Yukarıdan <strong>Luca'dan Çek</strong> ile getir.
          </div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-3 py-3 w-8 text-left">
                  <button onClick={toggleAll}>
                    {selected.size === rows.length && rows.length > 0
                      ? <CheckSquare size={14} style={{ color: GOLD }} />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-[11px] uppercase tracking-wider font-semibold w-[120px]">Tür</th>
                <th className="px-3 py-3 text-left text-[11px] uppercase tracking-wider font-semibold">Belge No</th>
                <th className="px-3 py-3 text-left text-[11px] uppercase tracking-wider font-semibold">Karşı Firma</th>
                <th className="px-3 py-3 text-left text-[11px] uppercase tracking-wider font-semibold w-[100px]">Tarih</th>
                <th className="px-3 py-3 text-right text-[11px] uppercase tracking-wider font-semibold">Matrah</th>
                <th className="px-3 py-3 text-right text-[11px] uppercase tracking-wider font-semibold">KDV</th>
                <th className="px-3 py-3 text-right text-[11px] uppercase tracking-wider font-semibold">Toplam</th>
                <th className="px-3 py-3 text-center text-[11px] uppercase tracking-wider font-semibold w-[140px]">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isAlis = (r as any).tip !== 'SATIS';
                const isEFatura = (r as any).belgeKaynak === 'EFATURA';
                const tipColor = isAlis ? '#60a5fa' : '#4ade80';
                const tipBg    = isAlis ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)';
                const tipBorder= isAlis ? 'rgba(59,130,246,0.3)'  : 'rgba(34,197,94,0.3)';
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: '#fafaf9' }}>
                    <td className="px-3 py-3">
                      <button onClick={() => toggleSelect(r.id)}>
                        {selected.has(r.id)
                          ? <CheckSquare size={14} style={{ color: GOLD }} />
                          : <Square size={14} style={{ color: 'rgba(250,250,249,0.3)' }} />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider w-fit"
                          style={{ background: tipBg, color: tipColor, border: `1px solid ${tipBorder}` }}
                        >
                          {isAlis ? 'ALIŞ' : 'SATIŞ'}
                        </span>
                        <span className="text-[10px] font-medium" style={{ color: 'rgba(250,250,249,0.45)' }}>
                          {isEFatura ? 'E-FATURA' : 'E-ARŞİV'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-[11.5px] font-medium">{r.faturaNo}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'rgba(250,250,249,0.35)' }}>
                        {r.aliciVergiNo || r.saticiVergiNo || ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-[12.5px] font-medium truncate" style={{ maxWidth: 280 }}>
                        {isAlis ? r.satici : r.alici}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                      {new Date(r.faturaTarihi).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-3 text-right text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.85)' }}>
                      {fmtTRY(r.matrah)}
                    </td>
                    <td className="px-3 py-3 text-right text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.65)' }}>
                      {fmtTRY(r.kdvTutari)}
                    </td>
                    <td className="px-3 py-3 text-right text-[13px] tabular-nums font-semibold" style={{ color: GOLD }}>
                      {fmtTRY(r.toplamTutar)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex gap-1.5 justify-center items-center">
                        {/* Mihsap durum işareti — küçük icon-only rozet (Aç butonundan ÖNCE) */}
                        {(() => {
                          const ms = (r as any).mihsapUploadStatus as string | undefined;
                          const at = (r as any).mihsapUploadedAt as string | null | undefined;
                          const err = (r as any).mihsapUploadError as string | undefined;
                          if (ms === 'uploaded' || at) {
                            return (
                              <span
                                className="inline-flex items-center justify-center rounded-full"
                                style={{
                                  width: 22, height: 22,
                                  background: 'rgba(34,197,94,0.18)',
                                  color: '#4ade80',
                                  border: '1px solid rgba(34,197,94,0.4)',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                                title={at ? `Mihsap'a yüklendi · ${new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}` : 'Mihsap\'a yüklendi'}
                              >
                                ✓
                              </span>
                            );
                          }
                          if (ms === 'failed') {
                            return (
                              <span
                                className="inline-flex items-center justify-center rounded-full"
                                style={{
                                  width: 22, height: 22,
                                  background: 'rgba(239,68,68,0.18)',
                                  color: '#fca5a5',
                                  border: '1px solid rgba(239,68,68,0.4)',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                                title={`Mihsap'a yükleme hatası: ${err || 'bilinmeyen hata'}`}
                              >
                                ✗
                              </span>
                            );
                          }
                          // Henüz Mihsap'a yüklenmemiş — boş yer (kolonlar hizalı kalsın)
                          return <span style={{ width: 22, height: 22, display: 'inline-block' }} />;
                        })()}
                        <button
                          onClick={() => { setPreviewFatura(r); setPreviewAutoPrint(false); }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 hover:opacity-80"
                          style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)' }}
                          title="Faturayı önizle"
                        >
                          <Eye size={11} /> Aç
                        </button>
                        <button
                          onClick={() => { setPreviewFatura(r); setPreviewAutoPrint(true); }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 hover:opacity-80"
                          style={{ background: 'rgba(239,68,68,0.10)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}
                          title="Faturayı önizle ve yazıcıya gönder"
                        >
                          <Printer size={11} /> Yazdır
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mükellef picker modal — modern, sayısal görsel */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col rounded-xl shadow-2xl overflow-hidden"
            style={{ background: '#15140f', border: '1px solid rgba(184,160,111,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(184,160,111,0.05)', borderBottom: '1px solid rgba(184,160,111,0.15)' }}>
              <div>
                <div className="text-[15px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
                  <Users size={16} style={{ color: GOLD }} /> Mükellef Seçimi
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  {filteredTp.length} mükellef listede · birden fazla seçebilirsin
                </div>
              </div>
              <div className="flex items-center gap-2">
                {taxpayerIds.size > 0 && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}>
                    {taxpayerIds.size} seçildi
                  </span>
                )}
                <button
                  onClick={() => setPickerOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.7)' }}
                  title="Kapat (ESC)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Arama + Toplu eylem barı */}
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
                <input
                  autoFocus
                  placeholder="Mükellef adı veya VKN/TCKN ara…"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />
              </div>
              <button
                onClick={() => {
                  // Listede görünenlerin tümünü seç (filtreliye göre)
                  setTaxpayerIds((s) => {
                    const ns = new Set(s);
                    filteredTp.forEach((t) => ns.add(t.id));
                    return ns;
                  });
                  setTumMukellefler(false);
                  setSelected(new Set());
                }}
                className="px-3 py-2 rounded-lg text-xs font-medium hover:opacity-80"
                style={{ background: 'rgba(184,160,111,0.1)', color: GOLD, border: '1px solid rgba(184,160,111,0.25)' }}
                title="Şu an listede görünenleri seç"
              >
                Tümünü Seç
              </button>
              {taxpayerIds.size > 0 && (
                <button
                  onClick={() => setTaxpayerIds(new Set())}
                  className="px-3 py-2 rounded-lg text-xs font-medium hover:opacity-80"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  Temizle
                </button>
              )}
              <button
                onClick={() => setPickerOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90"
                style={{ background: GOLD, color: '#1a1a18' }}
              >
                Tamam
              </button>
            </div>

            {/* Mükellef listesi */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredTp.map((t) => {
                const checked = taxpayerIds.has(t.id);
                const ad = taxpayerName(t);
                const initial = (ad || '?').trim().charAt(0).toLocaleUpperCase('tr-TR');
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTaxpayerIds((s) => {
                        const ns = new Set(s);
                        if (ns.has(t.id)) ns.delete(t.id); else ns.add(t.id);
                        return ns;
                      });
                      setTumMukellefler(false);
                      setSelected(new Set());
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors mb-1"
                    style={{
                      color: '#fafaf9',
                      background: checked ? 'rgba(184,160,111,0.14)' : 'transparent',
                      border: `1px solid ${checked ? 'rgba(184,160,111,0.3)' : 'transparent'}`,
                    }}
                    onMouseEnter={(e) => { if (!checked) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { if (!checked) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    {/* Checkbox */}
                    {checked
                      ? <CheckSquare size={16} style={{ color: GOLD, flexShrink: 0 }} />
                      : <Square size={16} style={{ color: 'rgba(250,250,249,0.3)', flexShrink: 0 }} />}
                    {/* Avatar (ilk harf) */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: checked ? 'rgba(184,160,111,0.25)' : 'rgba(255,255,255,0.05)',
                        color: checked ? GOLD : 'rgba(250,250,249,0.6)',
                        border: `1px solid ${checked ? 'rgba(184,160,111,0.4)' : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      {initial}
                    </div>
                    {/* İsim + VKN */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{ad}</div>
                      <div className="text-[11px] mt-0.5 font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        VKN/TCKN: {t.taxNumber || '—'}
                      </div>
                    </div>
                    {/* E-Fatura badge */}
                    {t.isEFaturaMukellefi && (
                      <span
                        className="px-2 py-0.5 rounded text-[9px] font-semibold flex-shrink-0"
                        style={{ background: 'rgba(59,130,246,0.18)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}
                      >
                        e-Fatura
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredTp.length === 0 && (
                <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  {uygunMukellefler.length === 0
                    ? `Seçili sorgulama tiplerine uygun mükellef yok (${modeArr.map((m) => MODE_INFO[m].label).join(' / ')})`
                    : 'Aradığın mükellef bulunamadı'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sayfa içi fatura önizleme modalı (lightbox) */}
      {previewFatura && (
        <EarsivPreviewModal
          fatura={previewFatura}
          autoPrint={previewAutoPrint}
          onClose={() => { setPreviewFatura(null); setPreviewAutoPrint(false); }}
        />
      )}

      {/* Toplu yazdırma sayfa içi modal (yeni sekme yerine) */}
      {bulkPreviewHtml && (
        <BulkPrintModal
          html={bulkPreviewHtml}
          count={bulkPreviewCount}
          onClose={() => { setBulkPreviewHtml(null); setBulkPreviewCount(0); }}
        />
      )}
    </div>
  );
}

/** E-Arşiv fatura sayfa-içi önizleme modalı — backend HTML'i auth'lu fetch ile alır,
 *  iframe srcDoc içine basar. Yazdır butonu iframe.contentWindow.print() tetikler.
 */
function EarsivPreviewModal({
  fatura,
  autoPrint,
  onClose,
}: {
  fatura: EarsivFatura;
  autoPrint: boolean;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderSource, setRenderSource] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ESC + body scroll kilit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  // Önce orijinal PDF'i dene; yoksa HTML/XSLT render'a düş.
  useEffect(() => {
    let cancel = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setHtml(null);
        setPdfUrl(null);
        setRenderSource(null);

        try {
          const pdfRes = await api.get(`/earsiv/${fatura.id}/original-pdf`, { responseType: 'blob' });
          if (cancel) return;
          objectUrl = URL.createObjectURL(new Blob([pdfRes.data], { type: 'application/pdf' }));
          setPdfUrl(objectUrl);
          setRenderSource('Orijinal PDF');
          return;
        } catch (pdfErr: any) {
          if (pdfErr?.response?.status && pdfErr.response.status !== 404) {
            console.warn('Orijinal PDF alınamadı, HTML render deneniyor:', pdfErr?.message || pdfErr);
          }
        }

        const res = await api.get(`/earsiv/${fatura.id}/html`, { responseType: 'text' });
        if (cancel) return;
        setHtml(typeof res.data === 'string' ? res.data : String(res.data));
        const source = String(res.headers?.['x-moren-render-source'] || '');
        setRenderSource(source === 'original-html' ? 'Luca HTML' : 'XML render');
      } catch (e: any) {
        if (cancel) return;
        setError(e?.response?.data?.message || e?.message || 'Fatura HTML alınamadı');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fatura.id]);

  // İçerik yüklendiğinde autoPrint ise yazdırma tetikle
  useEffect(() => {
    if ((!html && !pdfUrl) || !autoPrint || !iframeRef.current) return;
    const tid = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.print(); } catch {}
    }, 500);
    return () => clearTimeout(tid);
  }, [html, pdfUrl, autoPrint]);

  const triggerPrint = () => {
    try { iframeRef.current?.contentWindow?.print(); }
    catch { toast.error('Yazdırma başlatılamadı'); }
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const tarihStr = new Date(fatura.faturaTarihi).toLocaleDateString('tr-TR');

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.85)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[900px] flex flex-col"
        style={{ height: 'min(92vh, 1100px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst bar */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-xl"
          style={{ background: 'rgba(15,13,11,.95)', color: '#fff' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              const tipTxt = (fatura as any).tip === 'SATIS' ? 'SATIŞ' : 'ALIŞ';
              const kaynakTxt = (fatura as any).belgeKaynak === 'EFATURA' ? 'E-FATURA' : 'E-ARŞİV';
              const isAlis = (fatura as any).tip !== 'SATIS';
              return (
                <span
                  className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    background: isAlis ? 'rgba(59,130,246,.2)' : 'rgba(34,197,94,.2)',
                    color: isAlis ? '#60a5fa' : '#4ade80',
                  }}
                >
                  {tipTxt} · {kaynakTxt}
                </span>
              );
            })()}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{fatura.satici || '—'}</div>
              <div className="text-xs opacity-70">
                #{fatura.faturaNo} · {tarihStr} · ₺
                {Number(fatura.toplamTutar || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {renderSource && (
              <span
                className="px-2 py-1 rounded-md text-[11px] font-semibold"
                style={{ background: 'rgba(212,184,118,.18)', color: '#d4b876', border: '1px solid rgba(212,184,118,.35)' }}
              >
                {renderSource}
              </span>
            )}
            <button
              onClick={triggerPrint}
              disabled={(!html && !pdfUrl) || loading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
            >
              <Printer size={12} /> Yazdır
            </button>
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
          className="flex-1 rounded-b-xl overflow-hidden"
          style={{ background: 'rgba(15,13,11,.85)' }}
        >
          {loading && (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
            </div>
          )}
          {error && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center p-8" style={{ color: '#fca5a5' }}>
                <AlertCircle size={32} className="mx-auto mb-2" />
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          {pdfUrl && !loading && !error && (
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              className="w-full h-full bg-white"
              title={fatura.faturaNo}
            />
          )}
          {!pdfUrl && html && !loading && !error && (
            <iframe
              ref={iframeRef}
              srcDoc={html}
              className="w-full h-full bg-white"
              title={fatura.faturaNo}
              sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

/** Toplu yazdırma için sayfa-içi modal — backend POST /earsiv/print-bulk
 *  cevabındaki birleştirilmiş HTML'i iframe srcDoc içinde gösterir.
 */
function BulkPrintModal({
  html,
  count,
  onClose,
}: {
  html: string;
  count: number;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  // İçerik mount olduğunda otomatik print tetiklensin (bulk = yazdırma odaklı)
  useEffect(() => {
    const tid = setTimeout(() => {
      try { iframeRef.current?.contentWindow?.print(); } catch {}
    }, 700);
    return () => clearTimeout(tid);
  }, []);

  const triggerPrint = () => {
    try { iframeRef.current?.contentWindow?.print(); }
    catch { toast.error('Yazdırma başlatılamadı'); }
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.85)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-xl"
          style={{ background: 'rgba(15,13,11,.95)', color: '#fff' }}
        >
          <div className="text-sm font-semibold">{count} fatura toplu yazdırma</div>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerPrint}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
            >
              <Printer size={12} /> Tekrar Yazdır
            </button>
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
        <div
          className="flex-1 rounded-b-xl overflow-hidden"
          style={{ background: 'rgba(15,13,11,.85)' }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={html}
            className="w-full h-full bg-white"
            title="Toplu yazdırma"
            sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-forms"
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
