'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, XCircle, Eye, Loader2, ZoomIn, ZoomOut, X as XIcon, Maximize2 } from 'lucide-react';
import { kdvApi } from '@/lib/kdv';
import { toast } from 'sonner';

const GOLD = '#b8a06f';
const THRESHOLD = 0.7;

type FilterMode = 'needsReview' | 'success' | 'confirmed' | 'lowConf' | 'failed' | 'all';

export interface ReviewImage {
  id: string;
  originalName: string;
  ocrStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'NEEDS_REVIEW' | 'LOW_CONFIDENCE' | 'FAILED';
  ocrBelgeNo: string | null;
  ocrDate: string | null;
  ocrKdvTutari: string | null;
  ocrBelgeNoConfidence: number | null;
  ocrDateConfidence: number | null;
  ocrKdvConfidence: number | null;
  ocrEngine: string | null;
  confirmedBelgeNo: string | null;
  confirmedDate: string | null;
  confirmedKdvTutari: string | null;
  isManuallyConfirmed: boolean;
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
}) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState<{ belgeNo: string; date: string; kdvTutari: string }>({
    belgeNo: '',
    date: '',
    kdvTutari: '',
  });
  /** Hangi durumdaki faturalar listelensin? Chip'lere tıklayınca değişir. */
  const [filter, setFilter] = useState<FilterMode>('needsReview');

  /** Filtreye göre gösterilecek görseller. */
  const filtered = useMemo(() => {
    const list = images.filter((i) => {
      switch (filter) {
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
    // Düşük confidence'a sahip olanlar önce gelsin (needsReview filter için mantıklı)
    return [...list].sort((a, b) => (avgConf(a) ?? 0) - (avgConf(b) ?? 0));
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
      setForm({ belgeNo: '', date: '', kdvTutari: '' });
      setPreviewUrl(null);
      return;
    }
    setForm({
      belgeNo: activeImg.confirmedBelgeNo ?? activeImg.ocrBelgeNo ?? '',
      date: activeImg.confirmedDate ?? activeImg.ocrDate ?? '',
      kdvTutari: activeImg.confirmedKdvTutari ?? activeImg.ocrKdvTutari ?? '',
    });
    // Presigned URL'i yükle
    let cancelled = false;
    kdvApi.getImageUrl(activeImg.id).then((r: any) => {
      if (!cancelled) setPreviewUrl(r.url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeImg?.id]);

  const confirmMut = useMutation({
    mutationFn: (payload: {
      imageId: string;
      data: { belgeNo?: string; date?: string; kdvTutari?: string };
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

  function handleConfirm() {
    if (!activeImg) return;
    confirmMut.mutate({
      imageId: activeImg.id,
      data: {
        belgeNo: form.belgeNo.trim() || undefined,
        date: form.date.trim() || undefined,
        kdvTutari: form.kdvTutari.trim() || undefined,
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
              Düşük güvenli alanları kontrol et ve teyit et —{' '}
              <span className="font-semibold" style={{ color: '#f59e0b' }}>
                {pending.length}
              </span>{' '}
              / {summary.total} fatura bekliyor
            </p>
          </div>
        </div>
        {/* Özet chips: tıklayınca filtre değişir */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {summary.needsReview > 0 && (
            <SummaryChip
              label="İnceleme"
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
          style={{ color: filter === 'needsReview' ? '#22c55e' : 'rgba(250,250,249,0.55)' }}
        >
          {filter === 'needsReview' ? (
            <>
              <CheckCircle2 size={18} />
              <span className="font-semibold">Tüm faturalar incelendi — teyit bekleyen yok</span>
            </>
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
            return (
              <button
                key={img.id}
                onClick={() => setActiveId(img.id)}
                className="w-full text-left px-4 py-3 transition"
                style={{
                  background: active ? 'rgba(245,158,11,0.1)' : 'transparent',
                  borderLeft: `3px solid ${active ? '#f59e0b' : 'transparent'}`,
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p
                    className="text-[12px] font-medium truncate"
                    style={{ color: active ? '#fafaf9' : 'rgba(250,250,249,0.75)' }}
                  >
                    {img.originalName}
                  </p>
                  {typeof avg === 'number' && (
                    <span
                      className="text-[10px] font-bold tabular-nums"
                      style={{ color: avg < THRESHOLD ? '#f43f5e' : '#f59e0b' }}
                    >
                      %{Math.round(avg * 100)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  <StatusTag status={img.ocrStatus} />
                  <span className="truncate">{img.ocrBelgeNo ?? '—'}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Sağ: detay */}
        {activeImg ? (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Fatura görseli — büyüteçli */}
            <ZoomableImage src={previewUrl} alt={activeImg.originalName} />

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
                label="KDV Tutarı"
                placeholder="123,45"
                value={form.kdvTutari}
                confidence={activeImg.ocrKdvConfidence}
                onChange={(v) => setForm((f) => ({ ...f, kdvTutari: v }))}
                onEnter={handleConfirm}
                numeric
              />

              {activeImg.ocrEngine && (
                <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                  OCR: <span style={{ color: 'rgba(250,250,249,0.6)' }}>{activeImg.ocrEngine}</span>
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleConfirm}
                  disabled={confirmMut.isPending}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-[9px] transition hover:brightness-110 disabled:opacity-60"
                  style={{
                    background: `linear-gradient(135deg, ${GOLD}, ${GOLD}cc)`,
                    color: '#0f0d0b',
                  }}
                >
                  {confirmMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={14} />
                  )}
                  Teyit Et &amp; Sonraki
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
}: {
  label: string;
  value: string;
  confidence: number | null;
  placeholder?: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  numeric?: boolean;
}) {
  const low = typeof confidence === 'number' && confidence < THRESHOLD;
  const missing = confidence === null;
  const color = missing ? '#f43f5e' : low ? '#f59e0b' : '#22c55e';
  const pct = typeof confidence === 'number' ? Math.round(confidence * 100) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {label}
        </label>
        <span
          className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded"
          style={{
            background: color + '1a',
            color,
          }}
        >
          {missing ? 'OKUNAMADI' : `%${pct}`}
        </span>
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        inputMode={numeric ? 'decimal' : 'text'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
        className="w-full px-3 py-2 text-[13px] rounded-lg outline-none transition focus:brightness-110"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${low || missing ? color + '55' : 'rgba(255,255,255,0.08)'}`,
          color: '#fafaf9',
        }}
      />
    </div>
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
  const [zoom, setZoom] = useState(2.5);
  const [lightbox, setLightbox] = useState(false);

  const LENS = 200; // lens çapı (px)

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
    setZoom((z) => {
      const next = z + (e.deltaY < 0 ? 0.25 : -0.25);
      return Math.max(1.5, Math.min(5, next));
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

            {/* Lupe (büyüteç lensi) */}
            {hoverPos && imgRef.current && containerRef.current && (
              <div
                className="pointer-events-none absolute rounded-full shadow-2xl"
                style={{
                  width: LENS,
                  height: LENS,
                  left: hoverPos.x - LENS / 2,
                  top: hoverPos.y - LENS / 2,
                  border: `2px solid ${GOLD}`,
                  boxShadow: '0 0 0 2px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.6)',
                  backgroundImage: `url(${src})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: `${imgRef.current.offsetWidth * zoom}px ${imgRef.current.offsetHeight * zoom}px`,
                  backgroundPosition: `${-(
                    ((hoverPos.x - (containerRef.current.clientWidth - imgRef.current.offsetWidth) / 2) * zoom) -
                    LENS / 2
                  )}px ${-(
                    ((hoverPos.y - (containerRef.current.clientHeight - imgRef.current.offsetHeight) / 2) * zoom) -
                    LENS / 2
                  )}px`,
                }}
              />
            )}

            {/* Zoom indikatörü */}
            {hoverPos && (
              <div
                className="pointer-events-none absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold tabular-nums"
                style={{ background: 'rgba(0,0,0,0.7)', color: GOLD }}
              >
                {zoom.toFixed(1)}× · wheel
              </div>
            )}

            {/* Fullscreen hint */}
            <div
              className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fafaf9' }}
            >
              <Maximize2 size={10} /> Tam ekran için tıkla
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
  const scores = [i.ocrBelgeNoConfidence, i.ocrDateConfidence, i.ocrKdvConfidence].filter(
    (v): v is number => typeof v === 'number',
  );
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
