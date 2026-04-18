'use client';

import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronRight, Maximize2, FileText } from 'lucide-react';
import { kdvApi } from '@/lib/kdv';
import { toast } from 'sonner';

const GOLD = '#b8a06f';

type Result = any;

/**
 * Eşleşme İncele Paneli — reconciliation sonuçları NEEDS_REVIEW veya PARTIAL_MATCH
 * durumunda olan kayıtlar için kullanıcı kararı alır.
 *
 * Her satırda: fatura görseli bilgileri vs Luca kaydı bilgileri,
 * "Onayla" (eşleşme doğru) ve "Reddet" (eşleşme yanlış) butonları.
 */
export function MatchReviewPanel({
  sessionId,
  results,
}: {
  sessionId: string;
  results: Result[];
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = useMemo(
    () => results.filter((r) => ['PARTIAL_MATCH', 'NEEDS_REVIEW'].includes(r.status)),
    [results],
  );

  const resolveMut = useMutation({
    mutationFn: (args: { id: string; action: 'CONFIRMED' | 'REJECTED'; notes?: string }) =>
      kdvApi.resolveResult(args.id, args.action, args.notes),
    onSuccess: (_, args) => {
      toast.success(args.action === 'CONFIRMED' ? 'Eşleşme onaylandı' : 'Eşleşme reddedildi');
      qc.invalidateQueries({ queryKey: ['kdv-results', sessionId] });
      qc.invalidateQueries({ queryKey: ['kdv-stats', sessionId] });
      // Sonraki satıra otomatik geç
      const idx = pending.findIndex((r) => r.id === args.id);
      const next = pending[idx + 1];
      setOpenId(next?.id ?? null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşlem başarısız'),
  });

  if (pending.length === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(251,146,60,0.04)',
        border: '1px solid rgba(251,146,60,0.22)',
      }}
    >
      {/* Başlık */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 transition hover:bg-white/[0.02]"
        style={{ borderBottom: expanded ? '1px solid rgba(251,146,60,0.15)' : 'none' }}
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={14} style={{ color: '#fb923c' }} />
          <div className="text-left">
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
              Eşleşme İnceleme Paneli
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <span className="font-semibold" style={{ color: '#fb923c' }}>{pending.length}</span> eşleşme kullanıcı kararı bekliyor —
              fatura ve Luca kaydı arasında belirsizlik var, onayla ya da reddet
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown size={16} style={{ color: '#fb923c' }} /> : <ChevronRight size={16} style={{ color: '#fb923c' }} />}
      </button>

      {expanded && (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          {pending.map((r) => (
            <MatchRow
              key={r.id}
              r={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onConfirm={() => resolveMut.mutate({ id: r.id, action: 'CONFIRMED' })}
              onReject={() => resolveMut.mutate({ id: r.id, action: 'REJECTED' })}
              loading={resolveMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({
  r,
  open,
  onToggle,
  onConfirm,
  onReject,
  loading,
}: {
  r: any;
  open: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  const lucaBelgeNo = r.kdvRecord?.belgeNo ?? '—';
  const lucaTarih = r.kdvRecord?.belgeDate
    ? new Date(r.kdvRecord.belgeDate).toLocaleDateString('tr-TR')
    : '—';
  const lucaKdv = r.kdvRecord?.kdvTutari
    ? parseFloat(r.kdvRecord.kdvTutari).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })
    : '—';

  const faturaBelgeNo = r.image?.confirmedBelgeNo || r.image?.ocrBelgeNo || '—';
  const faturaTarih = r.image?.confirmedDate || r.image?.ocrDate || '—';
  const faturaKdv = r.image?.confirmedKdvTutari || r.image?.ocrKdvTutari || '—';
  const faturaDosya = r.image?.originalName ?? '—';
  const isXmlFile = /\.xml$/i.test(faturaDosya);

  // Satır açıldığında fatura görselinin presigned URL'sini çek
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!open || !r.image?.id || isXmlFile) return;
    let cancelled = false;
    kdvApi
      .getImageUrl(r.image.id)
      .then((resp: any) => {
        if (!cancelled) setImageUrl(resp?.url || null);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, r.image?.id, isXmlFile]);

  const reasons: string[] = r.mismatchReasons ?? [];
  const statusLabel = r.status === 'PARTIAL_MATCH' ? 'Kısmi Eşleşme' : 'İnceleme Gerekli';
  const scorePct = typeof r.matchScore === 'number' ? `%${Math.round(r.matchScore * 100)}` : '';

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-3 transition hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}
          >
            {statusLabel}
          </span>
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: '#fafaf9' }}>
            {lucaBelgeNo} / {faturaBelgeNo}
          </span>
          {scorePct && (
            <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>
              skor {scorePct}
            </span>
          )}
          <span className="text-[11.5px] ml-auto" style={{ color: 'rgba(250,250,249,0.6)' }}>
            {reasons.length > 0 ? reasons.join(' · ') : 'Alan farkı var'}
          </span>
          {open ? <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.4)' }} /> : <ChevronRight size={14} style={{ color: 'rgba(250,250,249,0.4)' }} />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Luca tarafı */}
          <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: GOLD }}>Luca Kaydı</div>
            <Row label="Belge No" value={lucaBelgeNo} />
            <Row label="Tarih" value={lucaTarih} />
            <Row label="KDV" value={lucaKdv} />
          </div>

          {/* Fatura tarafı — görsel önizlemeli */}
          <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#a855f7' }}>Fatura / Görsel</div>
              {imageUrl && !isXmlFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxOpen(true); }}
                  className="text-[10px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded"
                  style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)' }}
                >
                  <Maximize2 size={10} /> Tam ekran
                </button>
              )}
            </div>

            {/* Görsel önizleme */}
            {isXmlFile ? (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <FileText size={14} style={{ color: '#22c55e' }} />
                <span className="text-[11px]" style={{ color: '#22c55e' }}>
                  XML e-Fatura — doğrudan parse edildi (OCR yok)
                </span>
              </div>
            ) : imageUrl ? (
              <div
                className="mb-3 rounded overflow-hidden cursor-zoom-in"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', maxHeight: 200 }}
                onClick={(e) => { e.stopPropagation(); setLightboxOpen(true); }}
              >
                <img
                  src={imageUrl}
                  alt={faturaDosya}
                  className="w-full object-contain select-none"
                  style={{ maxHeight: 200 }}
                  draggable={false}
                />
              </div>
            ) : open && r.image?.id ? (
              <div className="mb-3 flex items-center justify-center rounded" style={{ height: 80, background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.1)' }}>
                <Loader2 size={16} className="animate-spin" style={{ color: GOLD }} />
              </div>
            ) : null}

            <Row label="Dosya" value={faturaDosya} />
            <Row label="Belge No" value={faturaBelgeNo} />
            <Row label="Tarih" value={faturaTarih} highlight={isLikelyOcrDateMisread(lucaTarih, faturaTarih)} />
            <Row label="KDV" value={faturaKdv} />
            {isLikelyOcrDateMisread(lucaTarih, faturaTarih) && (
              <p className="text-[10.5px] mt-2 px-2 py-1.5 rounded" style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}>
                ⚠ OCR muhtemelen yıl hanesini yanlış okudu ({lucaTarih} vs {faturaTarih}) — "6"↔"4" / "0"↔"8" gibi benzer rakamlar. Luca tarihi doğruysa Onayla.
              </p>
            )}
          </div>

          {/* Lightbox — tam ekran görsel */}
          {lightboxOpen && imageUrl && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-6"
              style={{ background: 'rgba(0,0,0,0.9)' }}
              onClick={() => setLightboxOpen(false)}
            >
              <img
                src={imageUrl}
                alt={faturaDosya}
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <XCircle size={20} />
              </button>
            </div>
          )}

          {/* Aksiyonlar */}
          <div className="md:col-span-2 flex items-center gap-2 mt-1">
            <button
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-lg disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff',
              }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Eşleşmeyi Onayla
            </button>
            <button
              onClick={onReject}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-lg disabled:opacity-50"
              style={{
                background: 'rgba(244,63,94,0.12)',
                border: '1px solid rgba(244,63,94,0.35)',
                color: '#f43f5e',
              }}
            >
              <XCircle size={14} />
              Reddet (eşleşme yanlış)
            </button>
            <p className="text-[10.5px] ml-2" style={{ color: 'rgba(250,250,249,0.4)' }}>
              Onay = doğru eşleşme; Reddet = ayrı kayıtlar, her biri tekil kalır
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2 mb-1 text-[12px]">
      <span className="uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.45)', minWidth: 72, fontSize: 10 }}>{label}</span>
      <span
        className="flex-1 break-words"
        style={{
          color: highlight ? '#fb923c' : '#fafaf9',
          fontWeight: highlight ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Luca ve fatura tarihleri gün+ay aynı ama yıl farklıysa, bu büyük olasılıkla
 * OCR'ın rakam yanlış okuması (örn. "2026" → "2024" çünkü "6"↔"4" benzer).
 * Gün, ay ve yılın son hanesi hariç her şey tutuyorsa muhtemelen aynı faturadır.
 */
function isLikelyOcrDateMisread(dateA: string, dateB: string): boolean {
  if (!dateA || !dateB || dateA === '—' || dateB === '—') return false;
  const parse = (s: string) => {
    // Türkçe format "DD.MM.YYYY" veya ISO gibi
    const m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!m) return null;
    return { d: +m[1], mo: +m[2], y: +m[3] };
  };
  const a = parse(dateA);
  const b = parse(dateB);
  if (!a || !b) return false;
  if (a.d !== b.d || a.mo !== b.mo) return false;
  // Yıllar farklı ama gün+ay aynı → muhtemelen OCR yıl hatası
  return a.y !== b.y && Math.abs(a.y - b.y) <= 5;
}
