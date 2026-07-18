'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, XCircle, Eye, Loader2, ZoomIn, ZoomOut, X as XIcon, Maximize2, RefreshCw } from 'lucide-react';
import { kdvApi } from '@/lib/kdv';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const GOLD = '#b8a06f';
const THRESHOLD = 0.7;

function ocrEngineBadge(engine?: string | null) {
  const e = (engine || '').toLowerCase();
  if (e.includes('cache')) return { label: 'Cache', color: '#38bdf8', bg: 'rgba(56,189,248,0.13)' };
  if (e.includes('xml')) return { label: 'XML', color: '#86efac', bg: 'rgba(34,197,94,0.13)' };
  if (e.includes('azure')) return { label: 'Azure', color: '#60a5fa', bg: 'rgba(96,165,250,0.13)' };
  if (e.includes('claude')) return { label: 'Claude', color: '#c084fc', bg: 'rgba(192,132,252,0.13)' };
  return { label: 'OCR', color: 'rgba(250,250,249,0.6)', bg: 'rgba(250,250,249,0.08)' };
}

type FilterMode = 'reviewFlow' | 'needsReview' | 'success' | 'confirmed' | 'lowConf' | 'failed' | 'all';

export interface KdvBreakdownItem {
  oran: number;
  tutar: number;
  matrah?: number | null;
}

export interface ReviewImage {
  id: string;
  originalName: string;
  ocrStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'NEEDS_REVIEW' | 'LOW_CONFIDENCE' | 'FAILED';
  ocrBelgeNo: string | null;
  ocrDate: string | null;
  ocrKdvTutari: string | null;
  ocrKdvTevkifat?: string | null;
  ocrBelgeTipi?: string | null;
  ocrKdvBreakdown?: KdvBreakdownItem[] | null;
  ocrValidationScore?: number | null;
  ocrBelgeNoConfidence: number | null;
  ocrDateConfidence: number | null;
  ocrKdvConfidence: number | null;
  ocrEngine: string | null;
  confirmedBelgeNo: string | null;
  confirmedDate: string | null;
  confirmedKdvTutari: string | null;
  confirmedKdvTevkifat?: string | null;
  confirmedKdvBreakdown?: KdvBreakdownItem[] | null;
  isManuallyConfirmed: boolean;
}

// Dosya adı Prisma cuid()/rastgele DB id'si mi? ("cmqgpx7xd0d7swns6sw3am42o").
// Böyle dosyalar yüklenirken cuid adıyla geldi; listede çirkin cuid yerine belge
// no gösterilmeli.
function isCuidName(base: string): boolean {
  return /^c[a-z0-9]{23,30}$/.test(base) && /[a-z]/.test(base) && /\d/.test(base);
}

// Liste başlığı için temiz ad: dosya adı cuid ise "Fiş <belge no>", değilse dosya adı.
function imageDisplayName(img: {
  originalName: string;
  ocrBelgeNo: string | null;
  confirmedBelgeNo: string | null;
  id: string;
}): string {
  const base = (img.originalName || '').replace(/\.[^/.]+$/, '');
  const belge = img.confirmedBelgeNo ?? img.ocrBelgeNo ?? null;
  if (!base || isCuidName(base)) {
    return belge ? `Fiş ${belge}` : img.originalName || img.id.slice(0, 8);
  }
  return img.originalName;
}

/**
 * OCR teyit paneli — alan-bazlı confidence ile düşük güvenli okunmuş görselleri
 * kullanıcıya tek tek elle kontrol ettirir. Excel import'tan sonra burası
 * "OCR Teyit Bekler" sayaçındaki her fatura için inceleme ekranı sunar.
 *
 * Mantık:
 *  - Sadece ocrStatus ∈ {NEEDS_REVIEW, LOW_CONFIDENCE, FAILED} olanlar listelenir.
 *  - isManuallyConfirmed olanlar da ayrı "Teyit edildi" sekmesinde gösterilir.
 *  - Her alan confidence < 0.7 ise kırmızı/turuncu highlight ile işaretlenir.
 *  - "Teyit Et" tıklanınca PATCH /kdv-control/images/:id/confirm-ocr çağrılır.
 *  - Enter: kaydet; Tab: sonraki alana geç.
 */
export function OcrReviewPanel({
  sessionId,
  images,
}: {
  sessionId: string;
  images: ReviewImage[];
  sessionType?: string | null;
}) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [form, setForm] = useState<{
    belgeNo: string;
    date: string;
    kdvTutari: string;
    kdvTevkifat: string;
    breakdown: KdvBreakdownItem[] | null;
  }>({
    belgeNo: '',
    date: '',
    kdvTutari: '',
    kdvTevkifat: '',
    breakdown: null,
  });
  /** Hangi durumdaki faturalar listelensin? Chip'lere tıklayınca değişir.
   *  Default 'reviewFlow' — bekleyen + onaylanan birlikte (kullanıcının yaptığı + yapacağı tek listede). */
  const [filter, setFilter] = useState<FilterMode>('reviewFlow');
  const tevkifatAmount = parseLooseMoney(form.kdvTevkifat);
  const netKdvAmount = parseLooseMoney(form.kdvTutari);
  const hasTevkifat = tevkifatAmount > 0;

  /** Filtreye göre gösterilecek görseller. */
  const filtered = useMemo(() => {
    const list = images.filter((i) => {
      switch (filter) {
        case 'reviewFlow':
          // OCR'ı biten tüm faturalar: Başarılı (SUCCESS) + Bekleyen + Teyit edilen
          // Sadece hâlâ işlemdekiler (PENDING/PROCESSING) dışarıda.
          return i.isManuallyConfirmed ||
            ['SUCCESS', 'NEEDS_REVIEW', 'LOW_CONFIDENCE', 'FAILED'].includes(i.ocrStatus);
        case 'needsReview':
          return !i.isManuallyConfirmed &&
            ['NEEDS_REVIEW', 'LOW_CONFIDENCE', 'FAILED'].includes(i.ocrStatus);
        case 'success':
          return !i.isManuallyConfirmed && i.ocrStatus === 'SUCCESS';
        case 'confirmed':
          return i.isManuallyConfirmed;
        case 'lowConf':
          return !i.isManuallyConfirmed && i.ocrStatus === 'LOW_CONFIDENCE';
        case 'failed':
          return !i.isManuallyConfirmed && i.ocrStatus === 'FAILED';
        case 'all':
          return true;
      }
    });
    // Sıralama önceliği:
    //   1. Bekleyen (NEEDS_REVIEW / LOW_CONFIDENCE / FAILED) — eylem gerek
    //   2. Başarılı (SUCCESS, otomatik okundu, info)
    //   3. Teyit edildi — tamamlanmış
    // Aynı grup içinde: confidence düşük olan önce
    const priority = (img: ReviewImage): number => {
      if (img.isManuallyConfirmed) return 3;
      if (['NEEDS_REVIEW', 'LOW_CONFIDENCE', 'FAILED'].includes(img.ocrStatus)) return 1;
      if (img.ocrStatus === 'SUCCESS') return 2;
      return 4;
    };
    return [...list].sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return (avgConf(a) ?? 0) - (avgConf(b) ?? 0);
    });
  }, [images, filter]);

  /** Geriye dönük uyumluluk için pending adı — mevcut kullanım yerleri bozulmasın */
  const pending = filtered;

  /** Kısa özet: kaç fatura hangi durumda (başlıkta gösterilir) */
  const summary = useMemo(() => {
    let success = 0;
    let confirmed = 0;
    let processing = 0;
    let needsReview = 0;
    let lowConf = 0;
    let failed = 0;
    for (const i of images) {
      if (i.isManuallyConfirmed) confirmed++;
      else if (['PENDING', 'PROCESSING'].includes(i.ocrStatus)) processing++;
      else if (i.ocrStatus === 'SUCCESS') success++;
      else if (i.ocrStatus === 'NEEDS_REVIEW') needsReview++;
      else if (i.ocrStatus === 'LOW_CONFIDENCE') lowConf++;
      else if (i.ocrStatus === 'FAILED') failed++;
    }
    return { total: images.length, success, confirmed, processing, needsReview, lowConf, failed };
  }, [images]);

  const activeImg = pending.find((i) => i.id === activeId) ?? pending[0] ?? null;

  // Aktif görsel değişince formu doldur
  useEffect(() => {
    if (!activeImg) {
      setForm({ belgeNo: '', date: '', kdvTutari: '', kdvTevkifat: '', breakdown: null });
      setPreviewUrl(null);
      setPreviewError(false);
      return;
    }
    setForm({
      belgeNo: activeImg.confirmedBelgeNo ?? activeImg.ocrBelgeNo ?? '',
      date: activeImg.confirmedDate ?? activeImg.ocrDate ?? '',
      kdvTutari: activeImg.confirmedKdvTutari ?? activeImg.ocrKdvTutari ?? '',
      kdvTevkifat: activeImg.confirmedKdvTevkifat ?? activeImg.ocrKdvTevkifat ?? '',
      breakdown: (activeImg.confirmedKdvBreakdown ?? activeImg.ocrKdvBreakdown ?? null) as KdvBreakdownItem[] | null,
    });
    // Görsel kaynağı — ANA KAYNAK DRIVE (proxyPath: kimlikli backend akışı,
    // Drive-öncelik + MIHSAP fallback). proxyPath varsa blob olarak çekilir
    // (img src'ye Authorization eklenemez); yoksa eski davranış (presigned/CDN url).
    // Hata yakalama + retry; takılırsa sonsuz spinner kalmasın.
    let cancelled = false;
    let objectUrl: string | null = null;
    const id = activeImg.id;
    setPreviewUrl(null);
    setPreviewError(false);
    let tries = 0;
    const attempt = () => {
      kdvApi.getImageUrl(id)
        .then(async (r: any) => {
          if (cancelled) return;
          // Drive-öncelikli: proxyPath'i blob olarak çek (İşlenen Faturalar ile
          // birebir aynı akış). Proxy başarısızsa (Drive yedeği bulunamazsa)
          // doğrudan MIHSAP CDN linkine (r.url) düş — böylece görüntü İşlenen
          // Faturalar'daki gibi yine gelir, "yüklenemedi" ekranı çıkmaz.
          if (r?.proxyPath) {
            try {
              const resp = await api.get(r.proxyPath, { responseType: 'blob' });
              if (cancelled) return;
              objectUrl = URL.createObjectURL(resp.data);
              setPreviewUrl(objectUrl);
              return;
            } catch { /* proxy başarısız → CDN fallback */ }
          }
          if (cancelled) return;
          if (r?.url) {
            setPreviewUrl(r.url);
          } else {
            throw new Error('görsel url yok');
          }
        })
        .catch(() => {
          if (cancelled) return;
          tries += 1;
          if (tries < 3) setTimeout(attempt, 700);
          else setPreviewError(true);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeImg?.id, previewNonce]);

  const confirmMut = useMutation({
    mutationFn: (payload: {
      imageId: string;
      data: {
        belgeNo?: string;
        date?: string;
        kdvTutari?: string;
        kdvTevkifat?: string | null;
        kdvBreakdown?: KdvBreakdownItem[] | null;
      };
    }) => kdvApi.confirmOcr(payload.imageId, payload.data),
    onSuccess: () => {
      toast.success('Teyit edildi');
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
      // Listedeki bir sonraki kayıda geç
      const idx = pending.findIndex((i) => i.id === (activeId ?? activeImg?.id));
      const next = pending[idx + 1] ?? null;
      setActiveId(next?.id ?? null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Teyit başarısız'),
  });

  /**
   * Tek-fatura yeniden OCR: her satırın yanındaki ⟳ butonu ve detay
   * panelinin üst kısmındaki "Bu faturayı yeniden oku" butonu için.
   *
   * useMutation.isPending tek seferde tek mutation takip ettiği için
   * birden fazla butonun aynı anda loading görünmesi için reocringIds
   * set'ini ayrıca tutuyoruz (birden fazla satıra hızlıca basılabilir).
   */
  const [reocringIds, setReocringIds] = useState<Set<string>>(new Set());
  const reocrMut = useMutation({
    mutationFn: (payload: { imageId: string; forceClaude?: boolean }) =>
      kdvApi.reocrImage(payload.imageId, { forceClaude: payload.forceClaude }),
    onMutate: (payload) => {
      setReocringIds((prev) => {
        const next = new Set(prev);
        next.add(payload.imageId);
        return next;
      });
    },
    onSuccess: (_data, payload) => {
      toast.success('OCR yeniden başlatıldı — birkaç saniye içinde sonuç gelir');
      // getImages polling zaten her 3sn'de bir güncelleniyor; tek sefer
      // anlık invalidate ile durumu PROCESSING'e çek.
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
      // Set'ten kaldır — polling artık durumu gösterir
      setReocringIds((prev) => {
        const next = new Set(prev);
        next.delete(payload.imageId);
        return next;
      });
    },
    onError: (e: any, payload) => {
      toast.error(e?.response?.data?.message ?? 'OCR yeniden başlatılamadı');
      setReocringIds((prev) => {
        const next = new Set(prev);
        next.delete(payload.imageId);
        return next;
      });
    },
  });
  const handleReocr = (imageId: string, e?: React.MouseEvent, forceClaude = false) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (reocringIds.has(imageId)) return;
    reocrMut.mutate({ imageId, forceClaude });
  };

  // Eksik KDV oranlarını TAMAMLA — görseli yeniden okumadan, kayıtlı veriden türet.
  const backfillMut = useMutation({
    mutationFn: () => kdvApi.backfillOran(sessionId),
    onSuccess: (d) => {
      if (d.fixed > 0) {
        toast.success(
          `${d.fixed} faturanın oranı dolduruldu (≈${d.kdvMoved.toFixed(2)} TL)` +
            (d.stillMissing > 0 ? ` · ${d.stillMissing} fatura elle girilmeli` : ''),
        );
      } else if (d.stillMissing > 0) {
        toast(`${d.stillMissing} faturanın oranı veriden türetilemedi — elle girilmeli`, { icon: 'ℹ️' });
      } else {
        toast('Doldurulacak eksik oran yok', { icon: '✅' });
      }
      qc.invalidateQueries({ queryKey: ['kdv-images', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Oran tamamlama başarısız'),
  });

  function handleConfirm() {
    if (!activeImg) return;
    // Breakdown varsa toplamı hesapla, yoksa form.kdvTutari'yi kullan
    let kdvToSave = form.kdvTutari.trim() || undefined;
    if (form.breakdown && form.breakdown.length > 0) {
      const toplam = form.breakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
      if (toplam > 0) {
        kdvToSave = toplam.toFixed(2).replace('.', ',');
      }
    }
    confirmMut.mutate({
      imageId: activeImg.id,
      data: {
        belgeNo: form.belgeNo.trim() || undefined,
        date: form.date.trim() || undefined,
        kdvTutari: kdvToSave,
        // Tevkifat: form değerini gönder (boşsa null = temizle)
        kdvTevkifat: form.kdvTevkifat.trim() || null,
        kdvBreakdown: form.breakdown && form.breakdown.length > 0 ? form.breakdown : null,
      },
    });
  }

  if (pending.length === 0 && summary.total === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(245,158,11,0.04)',
        border: '1px solid rgba(245,158,11,0.22)',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4 flex-wrap gap-3"
        style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
          <div>
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
              OCR Teyit Paneli
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              OCR sonuçları tek liste —{' '}
              <span className="font-semibold" style={{ color: '#22c55e' }}>
                {summary.success}
              </span>{' '}
              başarılı ·{' '}
              <span className="font-semibold" style={{ color: '#f59e0b' }}>
                {summary.needsReview + summary.lowConf + summary.failed}
              </span>{' '}
              teyit bekler ·{' '}
              <span className="font-semibold" style={{ color: '#22c55e' }}>
                {summary.confirmed}
              </span>{' '}
              teyit edildi · {summary.total} toplam
            </p>
          </div>
        </div>
        {/* Özet chips: tıklayınca filtre değişir */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => backfillMut.mutate()}
            disabled={backfillMut.isPending}
            title="OCR'ın okuyamadığı KDV oranlarını, görseli yeniden okumadan kayıtlı veriden (matrah + metin) doldurur"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition disabled:opacity-50"
            style={{ background: 'rgba(20,184,166,0.14)', color: '#2dd4bf', border: '1px solid rgba(20,184,166,0.4)' }}
          >
            {backfillMut.isPending ? '…' : '%'} Oranları Tamamla
          </button>
          {(summary.success + summary.needsReview + summary.lowConf + summary.failed + summary.confirmed) > 0 && (
            <SummaryChip
              label="Teyit Akışı"
              count={summary.success + summary.needsReview + summary.lowConf + summary.failed + summary.confirmed}
              color="#b8a06f"
              active={filter === 'reviewFlow'}
              onClick={() => { setFilter('reviewFlow'); setActiveId(null); }}
            />
          )}
          {summary.needsReview > 0 && (
            <SummaryChip
              label="Sadece Bekleyen"
              count={summary.needsReview}
              color="#f59e0b"
              active={filter === 'needsReview'}
              onClick={() => { setFilter('needsReview'); setActiveId(null); }}
            />
          )}
          {summary.success > 0 && (
            <SummaryChip
              label="Yüksek güven"
              count={summary.success}
              color="#22c55e"
              active={filter === 'success'}
              onClick={() => { setFilter('success'); setActiveId(null); }}
            />
          )}
          {summary.confirmed > 0 && (
            <SummaryChip
              label="Teyit edildi"
              count={summary.confirmed}
              color="#22c55e"
              active={filter === 'confirmed'}
              onClick={() => { setFilter('confirmed'); setActiveId(null); }}
            />
          )}
          {summary.lowConf > 0 && (
            <SummaryChip
              label="Okunamadı"
              count={summary.lowConf}
              color="#f43f5e"
              active={filter === 'lowConf'}
              onClick={() => { setFilter('lowConf'); setActiveId(null); }}
            />
          )}
          {summary.failed > 0 && (
            <SummaryChip
              label="Hata"
              count={summary.failed}
              color="#f43f5e"
              active={filter === 'failed'}
              onClick={() => { setFilter('failed'); setActiveId(null); }}
            />
          )}
          {summary.processing > 0 && (
            <SummaryChip label="İşleniyor" count={summary.processing} color="#60a5fa" />
          )}
          <SummaryChip
            label="Hepsi"
            count={summary.total}
            color="#a855f7"
            active={filter === 'all'}
            onClick={() => { setFilter('all'); setActiveId(null); }}
          />
          <div className="text-[11px] font-bold uppercase tracking-wider ml-1" style={{ color: '#f59e0b' }}>
            Eşik %{Math.round(THRESHOLD * 100)}
          </div>
        </div>
      </div>

      {pending.length === 0 ? (
        <div
          className="flex items-center justify-center gap-3 py-10 text-[13px]"
          style={{
            color:
              summary.processing > 0
                ? '#60a5fa'
                : filter === 'needsReview'
                  ? '#22c55e'
                  : 'rgba(250,250,249,0.55)',
          }}
        >
          {summary.processing > 0 && (filter === 'reviewFlow' || filter === 'needsReview') ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span className="font-semibold">
                OCR devam ediyor — {summary.processing} fatura işleniyor, bittikçe burada görünecek
              </span>
            </>
          ) : filter === 'needsReview' ? (
            <>
              <CheckCircle2 size={18} />
              <span className="font-semibold">Tüm faturalar incelendi — teyit bekleyen yok</span>
            </>
          ) : filter === 'reviewFlow' ? (
            <span>Henüz OCR sonucu yok — fatura yüklenip okunduktan sonra burada listelenir</span>
          ) : (
            <span>Bu durumda fatura yok</span>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-[460px]">
        {/* Sol: liste */}
        <div
          className="overflow-y-auto max-h-[520px]"
          style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}
        >
          {pending.map((img) => {
            const active = img.id === (activeImg?.id ?? null);
            const avg = avgConf(img);
            const confirmed = img.isManuallyConfirmed;
            const isSuccess = !confirmed && img.ocrStatus === 'SUCCESS';
            const isPending = !confirmed && !isSuccess;
            const isReocring = reocringIds.has(img.id) ||
              ['PENDING', 'PROCESSING'].includes(img.ocrStatus);
            const engineBadge = ocrEngineBadge(img.ocrEngine);
            // Accent rengi: teyit=yeşil, success=mavi, bekleyen=turuncu
            const accentColor = confirmed ? '#22c55e' : isSuccess ? '#60a5fa' : '#f59e0b';
            // Confidence rakamı rengi
            const avgColor = confirmed
              ? '#22c55e'
              : isSuccess
                ? '#22c55e'
                : (typeof avg === 'number' && avg < THRESHOLD ? '#f43f5e' : '#f59e0b');
            return (
              <div
                key={img.id}
                className="w-full transition relative"
                style={{
                  background: active
                    ? `${accentColor}1a`
                    : 'transparent',
                  borderLeft: `3px solid ${active ? accentColor : (confirmed ? 'rgba(34,197,94,0.3)' : isSuccess ? 'rgba(96,165,250,0.2)' : 'transparent')}`,
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  opacity: (confirmed || isSuccess) && !active ? 0.75 : 1,
                }}
              >
                <button
                  onClick={() => setActiveId(img.id)}
                  className="w-full text-left px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p
                      className="text-[12px] font-medium truncate flex items-center gap-1.5"
                      style={{ color: active ? '#fafaf9' : 'rgba(250,250,249,0.75)' }}
                    >
                      {confirmed && <CheckCircle2 size={11} style={{ color: '#22c55e', flexShrink: 0 }} />}
                      {isSuccess && <CheckCircle2 size={11} style={{ color: '#60a5fa', flexShrink: 0 }} />}
                      <span className="truncate">{imageDisplayName(img)}</span>
                    </p>
                    {typeof avg === 'number' && (
                      <span
                        className="text-[10px] font-bold tabular-nums"
                        style={{ color: avgColor, marginRight: 28 }}
                      >
                        %{Math.round(avg * 100)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    {confirmed ? (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                      >
                        Teyit Edildi
                      </span>
                    ) : isSuccess ? (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}
                      >
                        Başarılı
                      </span>
                    ) : (
                      <StatusTag status={img.ocrStatus} />
                    )}
                    {img.ocrEngine && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: engineBadge.bg, color: engineBadge.color }}
                      >
                        {engineBadge.label}
                      </span>
                    )}
                    <span className="truncate">{img.confirmedBelgeNo ?? img.ocrBelgeNo ?? '—'}</span>
                  </div>
                </button>
                {/* Tek-fatura ⟳ "yeniden OCR" butonu — sağ üst köşe.
                    Satır seçimini kapatmamak için stopPropagation.
                    PROCESSING/PENDING durumda spin gösterilir, tıklama disable. */}
                <button
                  type="button"
                  onClick={(e) => handleReocr(img.id, e)}
                  disabled={isReocring}
                  title={
                    isReocring
                      ? 'OCR işleniyor…'
                      : 'Ucuz yeniden oku (cache/Azure öncelikli)'
                  }
                  className="absolute top-2.5 right-2.5 inline-flex items-center justify-center w-6 h-6 rounded-md transition disabled:opacity-70"
                  style={{
                    background: isReocring
                      ? 'rgba(96,165,250,0.18)'
                      : 'rgba(184,160,111,0.12)',
                    border: `1px solid ${isReocring ? 'rgba(96,165,250,0.35)' : 'rgba(184,160,111,0.3)'}`,
                    color: isReocring ? '#60a5fa' : GOLD,
                    cursor: isReocring ? 'wait' : 'pointer',
                  }}
                >
                  {isReocring ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Sağ: detay */}
        {activeImg ? (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Fatura görseli — büyüteçli */}
            {previewError ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl" style={{ minHeight: 320, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <AlertTriangle size={26} style={{ color: '#fbbf24' }} />
                <p className="text-[13px] text-center px-4" style={{ color: 'rgba(250,250,249,0.6)' }}>Fatura görseli yüklenemedi.<br />Bağlantı yavaş olabilir.</p>
                <button
                  type="button"
                  onClick={() => setPreviewNonce((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold"
                  style={{ background: 'rgba(212,184,118,0.14)', border: '1px solid rgba(212,184,118,0.3)', color: GOLD }}
                >
                  <RefreshCw size={13} /> Tekrar dene
                </button>
              </div>
            ) : (
              <ZoomableImage key={activeImg.id} src={previewUrl} alt={activeImg.originalName} />
            )}

            {/* Alan inputları */}
            <div className="space-y-4">
              <FieldInput
                label="Belge / Fatura No"
                placeholder="ABC2025000123"
                value={form.belgeNo}
                confidence={activeImg.ocrBelgeNoConfidence}
                onChange={(v) => setForm((f) => ({ ...f, belgeNo: v }))}
                onEnter={handleConfirm}
              />
              <FieldInput
                label="Belge Tarihi"
                placeholder="01.04.2026"
                value={form.date}
                confidence={activeImg.ocrDateConfidence}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                onEnter={handleConfirm}
              />
              <FieldInput
                label={
                  hasTevkifat
                    ? 'KDV Tutarı (NET — tevkifat düşülmüş)'
                    : form.breakdown && form.breakdown.length > 0
                      ? 'KDV Tutarı (toplam — otomatik)'
                      : 'KDV Tutarı'
                }
                placeholder="123,45"
                value={
                  form.breakdown && form.breakdown.length > 0
                    ? form.breakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0).toFixed(2).replace('.', ',')
                    : form.kdvTutari
                }
                confidence={activeImg.ocrKdvConfidence}
                onChange={(v) => setForm((f) => ({ ...f, kdvTutari: v }))}
                onEnter={handleConfirm}
                numeric
                readOnly={!!(form.breakdown && form.breakdown.length > 0)}
              />

              {/* KDV Tevkifat — varsa görünür (tevkifatsız faturalarda gizleyebiliriz). */}
              {/* confidence verilmediği için badge görünmüyor — opsiyonel alan. */}
              <FieldInput
                label="KDV Tevkifatı (varsa)"
                placeholder="0,00"
                value={form.kdvTevkifat}
                onChange={(v) => setForm((f) => ({ ...f, kdvTevkifat: v }))}
                onEnter={handleConfirm}
                numeric
              />
              {hasTevkifat && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px]"
                  style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.24)', color: 'rgba(250,250,249,0.72)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>Tevkifat kontrolü</span>
                    <span className="font-mono" style={{ color: '#fafaf9' }}>
                      Tam KDV {fmtLooseMoney(netKdvAmount + tevkifatAmount)}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed">
                    Net KDV {fmtLooseMoney(netKdvAmount)} + tevkifat {fmtLooseMoney(tevkifatAmount)} ayrı saklanır. Satışta Luca net KDV ile eşleşir; alışta net + tevkifat toplamı da kontrol edilir.
                  </p>
                </div>
              )}

              {/* KDV Breakdown paneli — çok oranlı belgelerde (Z Raporu, karma fatura) */}
              <KdvBreakdownEditor
                breakdown={form.breakdown}
                onChange={(next) => setForm((f) => ({ ...f, breakdown: next }))}
              />

              {activeImg.ocrBelgeTipi && (
                <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                  Belge tipi: <span className="font-semibold" style={{ color: GOLD }}>{activeImg.ocrBelgeTipi}</span>
                </p>
              )}

              {activeImg.ocrEngine && (
                <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                  OCR: <span style={{ color: 'rgba(250,250,249,0.6)' }}>{activeImg.ocrEngine}</span>
                  {typeof activeImg.ocrValidationScore === 'number' && (
                    <span
                      className="ml-2"
                      style={{
                        color:
                          activeImg.ocrValidationScore >= 0.9
                            ? '#86efac'
                            : activeImg.ocrValidationScore >= 0.7
                            ? '#fbbf24'
                            : '#fca5a5',
                      }}
                    >
                      · doğrulama %{Math.round(activeImg.ocrValidationScore * 100)}
                    </span>
                  )}
                </p>
              )}

              {activeImg.isManuallyConfirmed && (
                <div
                  className="flex items-center gap-2 text-[11.5px] font-semibold px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}
                >
                  <CheckCircle2 size={12} /> Bu fatura daha önce teyit edildi — değiştirirsen üzerine yazılır.
                </div>
              )}

              {!activeImg.isManuallyConfirmed && activeImg.ocrStatus === 'SUCCESS' && (
                <div
                  className="flex items-center gap-2 text-[11.5px] font-semibold px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(96,165,250,0.08)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}
                >
                  <CheckCircle2 size={12} /> OCR yüksek güvenle okudu — değerler doğruysa atla, yanlışsa düzeltip teyit et.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleConfirm}
                  disabled={confirmMut.isPending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-[9px] transition hover:brightness-110 disabled:opacity-60"
                  style={{
                    background: activeImg.isManuallyConfirmed
                      ? 'rgba(34,197,94,0.15)'
                      : `linear-gradient(135deg, ${GOLD}, ${GOLD}cc)`,
                    color: activeImg.isManuallyConfirmed ? '#22c55e' : '#0f0d0b',
                    border: activeImg.isManuallyConfirmed ? '1px solid rgba(34,197,94,0.35)' : 'none',
                  }}
                >
                  {confirmMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  {activeImg.isManuallyConfirmed
                    ? 'Güncelle & Sonraki'
                    : activeImg.ocrStatus === 'SUCCESS'
                      ? 'Onayla & Sonraki'
                      : 'Teyit Et & Sonraki'}
                </button>
                {/* Bu faturayı yeniden OCR et — aktif kayıtta hızlı erişim.
                    Sol listedeki ⟳ ile aynı işi yapar, ama detay panelinden tek
                    tıkta erişim için burada da var. */}
                <button
                  type="button"
                  onClick={() => handleReocr(activeImg.id)}
                  disabled={
                    reocringIds.has(activeImg.id) ||
                    ['PENDING', 'PROCESSING'].includes(activeImg.ocrStatus)
                  }
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-[12px] rounded-[9px] disabled:opacity-70"
                  style={{
                    background: 'rgba(184,160,111,0.1)',
                    color: GOLD,
                    border: '1px solid rgba(184,160,111,0.28)',
                  }}
                  title="Ucuz yeniden oku (cache/Azure öncelikli)"
                >
                  {reocringIds.has(activeImg.id) ||
                  ['PENDING', 'PROCESSING'].includes(activeImg.ocrStatus) ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleReocr(activeImg.id, undefined, true)}
                  disabled={
                    reocringIds.has(activeImg.id) ||
                    ['PENDING', 'PROCESSING'].includes(activeImg.ocrStatus)
                  }
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-[12px] rounded-[9px] disabled:opacity-70"
                  style={{
                    background: 'rgba(192,132,252,0.1)',
                    color: '#c084fc',
                    border: '1px solid rgba(192,132,252,0.28)',
                  }}
                  title="AI ile zorla oku (Claude maliyeti oluşabilir)"
                >
                  AI
                </button>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-[12px] rounded-[9px]"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      color: 'rgba(250,250,249,0.7)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                    title="Büyük önizleme"
                  >
                    <Eye size={12} />
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Listeden bir fatura seçin
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Alt Komponentler ──────────────────────────────────────────

function FieldInput({
  label,
  value,
  confidence,
  placeholder,
  onChange,
  onEnter,
  numeric,
  readOnly,
}: {
  label: string;
  value: string;
  /** Confidence verilmezse (undefined) badge hiç gösterilmez — tevkifat gibi opsiyonel alanlar için. */
  confidence?: number | null;
  placeholder?: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  numeric?: boolean;
  readOnly?: boolean;
}) {
  const hasValue = String(value ?? '').trim().length > 0 && (!numeric || parseLooseMoney(value) > 0);
  const effectiveConfidence = hasValue ? confidence : null;
  const showBadge = confidence !== undefined;
  const low = typeof effectiveConfidence === 'number' && effectiveConfidence < THRESHOLD;
  const missing = effectiveConfidence === null;
  const color = missing ? '#f43f5e' : low ? '#f59e0b' : '#22c55e';
  const pct = typeof effectiveConfidence === 'number' ? Math.round(effectiveConfidence * 100) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {label}
        </label>
        {showBadge && (
          <span
            className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded"
            style={{
              background: color + '1a',
              color,
            }}
          >
            {missing ? 'OKUNAMADI' : `%${pct}`}
          </span>
        )}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        inputMode={numeric ? 'decimal' : 'text'}
        readOnly={readOnly}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-full px-3 py-2 text-[13px] rounded-lg outline-none transition focus:brightness-110"
        style={{
          background: readOnly ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${readOnly ? 'rgba(34,197,94,0.2)' : low || missing ? color + '55' : 'rgba(255,255,255,0.08)'}`,
          color: readOnly ? 'rgba(34,197,94,0.9)' : '#fafaf9',
          cursor: readOnly ? 'not-allowed' : 'text',
        }}
      />
    </div>
  );
}

function parseLooseMoney(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtLooseMoney(value: unknown): string {
  return parseLooseMoney(value).toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
  });
}

/**
 * KDV oran-bazlı kırılım editörü. Z raporu / karma faturada her KDV oranı
 * için ayrı tutar girilir, toplam KDV otomatik hesaplanır.
 */
function KdvBreakdownEditor({
  breakdown,
  onChange,
}: {
  breakdown: KdvBreakdownItem[] | null;
  onChange: (next: KdvBreakdownItem[] | null) => void;
}) {
  const list = breakdown || [];
  const toplam = list.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
  const fmtNum = (n: number | null | undefined) =>
    n == null ? '' : Number(n).toFixed(2).replace('.', ',');
  const parseNum = (s: string): number => {
    const c = String(s || '').trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(c);
    return Number.isFinite(n) ? n : 0;
  };

  function setItem(idx: number, patch: Partial<KdvBreakdownItem>) {
    const next = list.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange(next);
  }
  function addRow() {
    const usedRates = new Set(list.map((b) => b.oran));
    const nextRate = [20, 10, 18, 8, 1, 0].find((r) => !usedRates.has(r)) ?? 0;
    onChange([...list, { oran: nextRate, tutar: 0, matrah: null }]);
  }
  function removeRow(idx: number) {
    const next = list.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : null);
  }

  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(184,160,111,0.04)', border: '1px solid rgba(184,160,111,0.18)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: GOLD }}>
            KDV Kırılımı
          </span>
          {list.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(184,160,111,0.15)', color: GOLD }}>
              {list.length} oran
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="px-2 py-0.5 rounded text-[10.5px] font-bold"
          style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
        >
          + Oran Ekle
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          Çok oranlı belge (Z raporu, karma fatura) değilse boş bırak. Gerekiyorsa "+ Oran Ekle" ile satır ekle.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[70px_1fr_28px] gap-2 items-center pb-1 mb-1 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>Oran</span>
            <span>KDV Tutarı</span>
            <span></span>
          </div>
          {list.map((b, idx) => (
            <div key={idx} className="grid grid-cols-[70px_1fr_28px] gap-2 items-center mb-1.5">
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={b.oran}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value.replace(',', '.')) || 0;
                    setItem(idx, { oran: n });
                  }}
                  className="w-full px-2 py-1 pr-5 text-[12px] rounded text-right font-mono outline-none"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: GOLD }}
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: 'rgba(250,250,249,0.4)' }}>%</span>
              </div>
              <KirilimTutarInput
                value={b.tutar}
                onCommit={(n) => setItem(idx, { tutar: n })}
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="w-6 h-6 flex items-center justify-center rounded"
                style={{ background: 'rgba(244,63,94,0.08)', color: '#f43f5e' }}
                title="Bu satırı sil"
              >
                <XIcon size={12} />
              </button>
            </div>
          ))}
          <div className="grid grid-cols-[70px_1fr_28px] gap-2 items-center pt-1.5 mt-1" style={{ borderTop: '1px solid rgba(184,160,111,0.2)' }}>
            <span></span>
            <div className="col-span-2 flex items-center justify-between gap-3 px-2 py-1">
              <span className="text-[11px] font-bold" style={{ color: GOLD }}>Toplam KDV</span>
              <span className="text-[12.5px] font-mono font-bold text-right" style={{ color: GOLD }}>
                {toplam.toFixed(2).replace('.', ',')}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** KDV kırılımı TUTAR girişi — İMLEÇ ZIPLAMASI FIX: eski hali her tuşta değeri "1,00" biçimine
 *  çevirip inputa geri basıyordu → imleç başa dönüyor, yazı yazılamıyordu. Artık odaktayken HAM
 *  metin korunur (toplam yine anlık güncellenir), biçimlendirme yalnız kutudan çıkınca yapılır. */
function KirilimTutarInput({ value, onCommit }: { value: number | null | undefined; onCommit: (n: number) => void }) {
  const fmt = (n: number | null | undefined) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
  const parse = (s: string): number => {
    const c = String(s || '').trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(c);
    return Number.isFinite(n) ? n : 0;
  };
  const [txt, setTxt] = useState<string>(fmt(value));
  const [odak, setOdak] = useState(false);
  useEffect(() => { if (!odak) setTxt(fmt(value)); }, [value, odak]); // dışarıdan değişirse (odak yokken) tazele
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="0,00"
      value={txt}
      onFocus={() => setOdak(true)}
      onChange={(e) => { setTxt(e.target.value); onCommit(parse(e.target.value)); }}
      onBlur={() => { setOdak(false); setTxt(fmt(parse(txt))); }}
      className="w-full px-2 py-1 text-[12px] rounded text-right font-mono outline-none"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}
    />
  );
}

/**
 * Hover'da büyüteç lensi, tıklayınca tam-ekran lightbox.
 *  - Fareyi görselin üstünde gezdirince yuvarlak lupe açılır (default 2.5x)
 *  - Wheel ile zoom değişir (1.5x–5x)
 *  - Görsele tıklayınca fullscreen modal; +/– ve scroll ile zoom, drag ile pan
 */
function ZoomableImage({ src, alt }: { src: string | null; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // localStorage persist — her belgede sıfırlanmasın
  const [zoom, setZoom] = useState(() => {
    if (typeof window === 'undefined') return 3.5;
    const v = parseFloat(window.localStorage.getItem('ocr.lens.zoom') || '');
    return Number.isFinite(v) && v >= 1.5 && v <= 8 ? v : 3.5;
  });
  const [lensSize, setLensSize] = useState(() => {
    if (typeof window === 'undefined') return 280;
    const v = parseInt(window.localStorage.getItem('ocr.lens.size') || '', 10);
    return Number.isFinite(v) && v >= 120 && v <= 500 ? v : 280;
  });
  const [showSidePanel, setShowSidePanel] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('ocr.lens.sidepanel') !== '0';
  });
  const [controlsOpen, setControlsOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  // Persist on change
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ocr.lens.zoom', String(zoom));
  }, [zoom]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ocr.lens.size', String(lensSize));
  }, [lensSize]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ocr.lens.sidepanel', showSidePanel ? '1' : '0');
  }, [showSidePanel]);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) {
      setHoverPos(null);
      return;
    }
    setHoverPos({ x, y });
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!hoverPos) return;
    e.preventDefault();
    // Shift + wheel → lens boyutunu değiştirir
    if (e.shiftKey) {
      setLensSize((s) => Math.max(120, Math.min(500, s + (e.deltaY < 0 ? 30 : -30))));
      return;
    }
    setZoom((z) => {
      // Zoom step zoom'a oranlı: düşükse 0.3, yüksekse 0.7
      const step = z < 3 ? 0.3 : z < 5 ? 0.5 : 0.7;
      const next = z + (e.deltaY < 0 ? step : -step);
      return Math.max(1.5, Math.min(8, next));
    });
  }

  return (
    <>
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden flex items-center justify-center min-h-[260px] group cursor-zoom-in"
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverPos(null)}
        onWheel={handleWheel}
        onClick={() => src && setLightbox(true)}
      >
        {src ? (
          <>
            <img
              ref={imgRef}
              src={src}
              alt={alt}
              className="w-full h-full object-contain select-none"
              style={{ maxHeight: 420, pointerEvents: 'none' }}
              draggable={false}
            />

            {/* Lupe (büyüteç lensi) — NETLEŞTİRME:
               Görselin naturalWidth'i render boyutundan büyükse (genelde öyle — 2000px
               orijinal, 300px render), offset*zoom = 750px büyüteç arka planı orijinali
               2000→750 downscale ettiği için blur olur. Çözüm: backgroundSize'ı
               en az naturalWidth kadar tut → browser 1:1 piksel oranında render eder,
               netlik artar. */}
            {hoverPos && imgRef.current && containerRef.current && (() => {
              const img = imgRef.current;
              const container = containerRef.current;
              const offsetW = img.offsetWidth || 1;
              const offsetH = img.offsetHeight || 1;
              const natW = img.naturalWidth || offsetW;
              const natH = img.naturalHeight || offsetH;
              // Natural resolution baz — zoom bunun üzerine çarpar. En az 1:1 natural kalır.
              const effectiveZoom = Math.max(zoom, natW / offsetW);
              const bgW = offsetW * effectiveZoom;
              const bgH = offsetH * effectiveZoom;
              const relX = hoverPos.x - (container.clientWidth - offsetW) / 2;
              const relY = hoverPos.y - (container.clientHeight - offsetH) / 2;
              const bgX = -(relX * effectiveZoom - lensSize / 2);
              const bgY = -(relY * effectiveZoom - lensSize / 2);
              // Yazı okumak için KARE lens (daire yazıyı keser). Genişlik biraz fazla.
              const lensW = Math.round(lensSize * 1.4);
              const lensH = lensSize;
              // Lens kenara yapışmasın — imleçten yukarıda gösterilebilir kontainer kenarlarına göre
              let lx = hoverPos.x - lensW / 2;
              let ly = hoverPos.y - lensH / 2;
              // Container içinde kalması için clamp
              if (container) {
                const maxX = container.clientWidth - lensW;
                const maxY = container.clientHeight - lensH;
                if (lx < 0) lx = 0;
                else if (lx > maxX) lx = maxX;
                if (ly < 0) ly = 0;
                else if (ly > maxY) ly = maxY;
              }
              const lensBgX = -(relX * effectiveZoom - lensW / 2);
              const lensBgY = -(relY * effectiveZoom - lensH / 2);
              return (
                <div
                  className="pointer-events-none absolute rounded-md shadow-2xl"
                  style={{
                    width: lensW,
                    height: lensH,
                    left: lx,
                    top: ly,
                    border: `2px solid ${GOLD}`,
                    boxShadow: '0 0 0 2px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.8)',
                    backgroundColor: '#fff',
                    backgroundImage: `url(${src})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${bgW}px ${bgH}px`,
                    backgroundPosition: `${lensBgX}px ${lensBgY}px`,
                    imageRendering: 'crisp-edges' as any,
                    WebkitImageRendering: '-webkit-optimize-contrast',
                  } as any}
                />
              );
            })()}

            {/* Büyüteç kontrolleri — sağ üst köşede kompakt panel */}
            <div
              className="absolute top-2 right-2 flex flex-col items-end gap-1.5"
              onMouseEnter={() => setControlsOpen(true)}
              onMouseLeave={() => setControlsOpen(false)}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setControlsOpen((v) => !v); }}
                className="px-2 py-1 rounded text-[10px] font-bold tabular-nums flex items-center gap-1 transition-all"
                style={{ background: 'rgba(0,0,0,0.75)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
                title="Büyüteç kontrolleri"
              >
                <ZoomIn size={11} />
                {zoom.toFixed(1)}× · {lensSize}px
              </button>

              {controlsOpen && (
                <div
                  className="rounded-lg p-2.5 flex flex-col gap-2 text-[10.5px]"
                  style={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(184,160,111,0.3)', minWidth: 200, backdropFilter: 'blur(4px)' }}
                >
                  {/* Zoom slider + butonları */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9.5px] uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                      <span>Yakınlık</span>
                      <span className="font-bold tabular-nums" style={{ color: GOLD }}>{zoom.toFixed(1)}×</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(1.2, z - 0.25)); }}
                        className="w-6 h-6 flex items-center justify-center rounded"
                        style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}
                      >
                        <ZoomOut size={12} />
                      </button>
                      <input
                        type="range"
                        min={1.2}
                        max={6}
                        step={0.1}
                        value={zoom}
                        onChange={(e) => setZoom(parseFloat(e.target.value))}
                        className="flex-1"
                        style={{ accentColor: GOLD }}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(6, z + 0.25)); }}
                        className="w-6 h-6 flex items-center justify-center rounded"
                        style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}
                      >
                        <ZoomIn size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Lens boyut slider */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9.5px] uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                      <span>Büyüteç Çapı</span>
                      <span className="font-bold tabular-nums" style={{ color: GOLD }}>{lensSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={400}
                      step={10}
                      value={lensSize}
                      onChange={(e) => setLensSize(parseInt(e.target.value, 10))}
                      className="w-full"
                      style={{ accentColor: GOLD }}
                    />
                  </div>

                  {/* Yan panel toggle */}
                  <label className="flex items-center gap-2 cursor-pointer pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <input
                      type="checkbox"
                      checked={showSidePanel}
                      onChange={(e) => { e.stopPropagation(); setShowSidePanel(e.target.checked); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: GOLD }}
                    />
                    <span className="text-[10px] font-semibold" style={{ color: 'rgba(250,250,249,0.85)' }}>
                      Sabit Yan Panel (görsel kapanmaz)
                    </span>
                  </label>

                  {/* Sıfırla + hint */}
                  <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setZoom(3.5); setLensSize(280); }}
                      className="flex-1 px-2 py-1 rounded text-[10px] font-semibold"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.7)' }}
                    >
                      Sıfırla (3.5× · 280px)
                    </button>
                    <span className="text-[9px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      Wheel: zoom · Shift+Wheel: çap
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Fullscreen hint */}
            <div
              className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fafaf9' }}
            >
              <Maximize2 size={10} /> Görsele tıkla → tam ekran
            </div>
          </>
        ) : (
          <Loader2 size={20} className="animate-spin" style={{ color: GOLD }} />
        )}
      </div>

      {lightbox && src && (
        <LightboxModal src={src} alt={alt} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

/** Tam ekran lightbox: scroll = zoom, drag = pan, ESC/tık = kapat, +/– butonları */
function LightboxModal({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(8, s + 0.25));
      if (e.key === '-') setScale((s) => Math.max(0.5, s - 0.25));
      if (e.key === '0') {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  const content = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
      onWheel={(e) => {
        e.preventDefault();
        setScale((s) => Math.max(0.5, Math.min(8, s + (e.deltaY < 0 ? 0.25 : -0.25))));
      }}
    >
      {/* Toolbar */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          className="p-2 rounded-lg hover:brightness-125 transition"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fafaf9' }}
          title="Uzaklaş (−)"
        >
          <ZoomOut size={16} />
        </button>
        <span
          className="px-3 py-1.5 rounded-lg text-[12px] font-bold tabular-nums min-w-[60px] text-center"
          style={{ background: 'rgba(255,255,255,0.08)', color: GOLD }}
        >
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(8, s + 0.25))}
          className="p-2 rounded-lg hover:brightness-125 transition"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fafaf9' }}
          title="Yaklaş (+)"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="px-3 py-2 rounded-lg text-[11px] font-semibold hover:brightness-125 transition"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fafaf9' }}
          title="Sıfırla (0)"
        >
          1:1
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:brightness-125 transition"
          style={{ background: 'rgba(244,63,94,0.2)', color: '#f43f5e' }}
          title="Kapat (Esc)"
        >
          <XIcon size={16} />
        </button>
      </div>

      {/* Görsel */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return;
          setOffset({
            x: e.clientX - dragging.current.x,
            y: e.clientY - dragging.current.y,
          });
        }}
        onMouseUp={() => (dragging.current = null)}
        onMouseLeave={() => (dragging.current = null)}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          maxWidth: '92vw',
          maxHeight: '92vh',
          cursor: dragging.current ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          transition: dragging.current ? 'none' : 'transform 0.1s ease-out',
          userSelect: 'none',
        }}
      />

      {/* Kısayol ipucu */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-[11px]"
        style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(250,250,249,0.7)' }}
      >
        Scroll: zoom · Drag: kaydır · + / −: zoom · 0: sıfırla · Esc: kapat
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function SummaryChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  const bg = active ? color + '33' : color + '1a';
  const border = active ? color : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`inline-flex items-center gap-1 text-[10.5px] font-bold tabular-nums px-2 py-0.5 rounded transition ${
        clickable ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'
      }`}
      style={{
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      {label}: {count}
    </button>
  );
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    NEEDS_REVIEW: { label: 'Teyit Bekler', color: '#f59e0b' },
    LOW_CONFIDENCE: { label: 'Okunamadı', color: '#f43f5e' },
    FAILED: { label: 'Hata', color: '#f43f5e' },
    SUCCESS: { label: 'Hazır', color: '#22c55e' },
  };
  const m = map[status] ?? map.NEEDS_REVIEW;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: m.color + '1a', color: m.color }}
    >
      {m.label}
    </span>
  );
}

function avgConf(i: ReviewImage): number | null {
  const scores = [
    i.ocrBelgeNo ? i.ocrBelgeNoConfidence : 0,
    i.ocrDate ? i.ocrDateConfidence : 0,
    parseLooseMoney(i.ocrKdvTutari) > 0 ? i.ocrKdvConfidence : 0,
  ].map((v) => (typeof v === 'number' ? v : 0));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
