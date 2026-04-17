'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, XCircle, Eye, Loader2 } from 'lucide-react';
import { kdvApi } from '@/lib/kdv';
import { toast } from 'sonner';

const GOLD = '#b8a06f';
const THRESHOLD = 0.7;

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

  // Review bekleyen görseller (önce eski tarihliler, sonra düşük confidence)
  const pending = useMemo(
    () =>
      images
        .filter(
          (i) =>
            !i.isManuallyConfirmed &&
            ['NEEDS_REVIEW', 'LOW_CONFIDENCE', 'FAILED'].includes(i.ocrStatus),
        )
        // Düşük confidence'a sahip olanlar önce gelsin
        .sort((a, b) => (avgConf(a) ?? 0) - (avgConf(b) ?? 0)),
    [images],
  );

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

  if (pending.length === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(245,158,11,0.04)',
        border: '1px solid rgba(245,158,11,0.22)',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
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
              fatura bekliyor
            </p>
          </div>
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
          Eşik %{Math.round(THRESHOLD * 100)}
        </div>
      </div>

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
            {/* Fatura görseli */}
            <div
              className="rounded-lg overflow-hidden flex items-center justify-center min-h-[260px]"
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              {previewUrl ? (
                <a href={previewUrl} target="_blank" rel="noreferrer" className="block w-full h-full">
                  <img
                    src={previewUrl}
                    alt={activeImg.originalName}
                    className="w-full h-full object-contain"
                    style={{ maxHeight: 420 }}
                  />
                </a>
              ) : (
                <Loader2 size={20} className="animate-spin" style={{ color: GOLD }} />
              )}
            </div>

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
