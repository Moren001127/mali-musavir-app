'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cloud, X, Upload, FileText, CreditCard, Banknote, Smartphone, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   UPLOAD DIALOG — Mihsap'taki "yükleme menüsü" karşılığı.
   Belge tipi seçilir → drag-drop ile yüklenir → OCR pipeline'a düşer.
   QR kod ile mobil yükleme (ileride mobil app'le entegre).
   ════════════════════════════════════════════════════════════════════ */

const UPLOAD_TYPES = [
  { id: 'ALIS_FATURA',  label: 'Alış Faturası',   icon: FileText,  color: '#60a5fa', mode: 'ALIS' },
  { id: 'SATIS_FATURA', label: 'Satış Faturası',  icon: FileText,  color: '#10b981', mode: 'SATIS' },
  { id: 'ODEME',         label: 'Ödeme Belgesi',   icon: CreditCard, color: '#f59e0b' },
  { id: 'TAHSILAT',      label: 'Tahsilat Belgesi', icon: CreditCard, color: '#a78bfa' },
  { id: 'BANKA_PDF',     label: 'Banka Ekstre PDF', icon: Banknote,   color: '#f97316' },
  { id: 'BANKA_EXCEL',   label: 'Banka Ekstre Excel', icon: Banknote, color: '#06b6d4' },
];

type Props = { taxpayer: any; period: string; onClose: () => void };

export default function UploadDialog({ taxpayer, period, onClose }: Props) {
  const qc = useQueryClient();
  const [tip, setTip] = useState<string>('ALIS_FATURA');
  const [direction, setDirection] = useState<'ALIS' | 'SATIS'>('ALIS');
  const [useClaudeOnly, setUseClaudeOnly] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      for (const file of files) fd.append('files', file);
      fd.append('taxpayerId', taxpayer.id);
      fd.append('source', 'fatura-merkezi');
      fd.append('documentType', tip);
      fd.append('invoiceKind', direction);
      fd.append('period', period);
      if (useClaudeOnly) fd.append('forceClaude', 'true');

      try {
        const r = await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setProgress({ done: files.length, total: files.length });
        const uploaded = Number(r.data?.uploaded || r.data?.documents?.length || 0);
        const skipped = Array.isArray(r.data?.skipped) ? r.data.skipped : [];
        return { results: [r.data], errors: [], skipped, uploaded };
      } catch (e: any) {
        const raw = e?.response?.data?.message;
        const skipped = Array.isArray(raw?.skipped) ? raw.skipped : [];
        const message = typeof raw === 'string'
          ? raw
          : raw?.message || e?.response?.data?.error || e?.message || 'Yukleme hatasi';
        const err = new Error(message) as Error & { uploadErrors?: Array<{ name: string; message: string }> };
        err.uploadErrors = skipped.map((item: any) => ({
          name: item?.name || 'dosya',
          message: item?.reason || message,
        }));
        throw err;
      }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
      if (!data.errors.length && !data.skipped.length) setTimeout(() => onClose(), 800);
    },
    onError: () => setProgress(null),
  });

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setProgress({ done: 0, total: arr.length });
    uploadMut.mutate(arr);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#60a5fa20', color: '#60a5fa' }}>
              <Cloud size={18} />
            </div>
            <div>
              <div className="text-[15.5px] font-semibold" style={{ color: 'var(--text)' }}>Belge Yükle</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {taxpayerName(taxpayer)} · Dönem {period}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Belge tipi seçimi */}
          <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Belge Tipi
          </label>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {UPLOAD_TYPES.map((t) => {
              const Icon = t.icon;
              const active = tip === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTip(t.id);
                    if (t.mode) setDirection(t.mode as 'ALIS' | 'SATIS');
                  }}
                  className="flex items-center gap-2 p-3 rounded-lg text-[12.5px] font-medium transition-all"
                  style={{
                    background: active ? `${t.color}15` : 'var(--surface-2)',
                    border: '1px solid ' + (active ? `${t.color}60` : 'var(--border)'),
                    color: active ? t.color : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={14} />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Yön + AI seçimi */}
          <div className="flex items-center gap-3 mb-4 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <label className="flex items-center gap-2">
              <span>Yön:</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as any)}
                className="px-2 py-1 text-[12px] rounded-md outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                <option value="ALIS">Alış (gelen)</option>
                <option value="SATIS">Satış (giden)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 ml-4 cursor-pointer">
              <input
                type="checkbox"
                checked={useClaudeOnly}
                onChange={(e) => setUseClaudeOnly(e.target.checked)}
              />
              <span>Sadece Claude OCR (Azure'u atla)</span>
            </label>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl p-10 text-center cursor-pointer transition-colors"
            style={{
              background: dragOver ? 'var(--accent-light)' : 'var(--surface-2)',
              border: '2px dashed ' + (dragOver ? 'var(--accent)' : 'var(--border)'),
            }}
          >
            <Upload size={28} className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
            <div className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
              {dragOver ? 'Bırak' : 'Sürükle bırak veya tıkla'}
            </div>
            <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              .pdf .jpg .png .xml .zip · Çoklu dosya · Max 25 MB
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif,.avif,.xml,.ubl,.zip"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {/* Progress / sonuç */}
          {progress && (
            <div className="mt-4 p-3 rounded-lg text-[12px]" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              {uploadMut.isPending ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--text)' }}>
                  <Loader2 size={14} className="animate-spin" />
                  Yükleniyor... <strong>{progress.done}/{progress.total}</strong>
                </div>
              ) : uploadMut.isSuccess ? (
                <div style={{ color: '#10b981' }}>
                  ✓ {uploadMut.data.uploaded} belge yüklendi. OCR pipeline'a düştü.
                  {uploadMut.data.skipped.length > 0 ? ` ${uploadMut.data.skipped.length} dosya atlandı.` : ''}
                </div>
              ) : null}
            </div>
          )}

          {uploadMut.isSuccess && uploadMut.data.skipped.length > 0 && (
            <div className="mt-3 max-h-32 overflow-auto rounded-lg p-3 text-[11.5px]" style={{ background: '#f59e0b12', border: '1px solid #f59e0b40', color: '#fcd34d' }}>
              <div className="mb-1 font-semibold">
                {uploadMut.data.uploaded} belge yüklendi, {uploadMut.data.skipped.length} dosya atlandı.
              </div>
              {uploadMut.data.skipped.slice(0, 20).map((e: any, idx: number) => (
                <div key={`${e.name}-${idx}`} className="break-all">
                  <strong>{e.name}</strong>: {e.reason || 'Desteklenmeyen dosya tipi'}
                </div>
              ))}
            </div>
          )}

          {uploadMut.error && (
            <div className="mt-3 p-3 rounded-lg text-[11.5px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
              {(uploadMut.error as any)?.message || 'Yükleme hatası'}
            </div>
          )}

          {/* QR mobil kısa kart */}
          {uploadMut.isError && (uploadMut.error as any)?.uploadErrors?.length > 0 && (
            <div className="mt-3 max-h-32 overflow-auto rounded-lg p-3 text-[11.5px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
              {(uploadMut.error as any).uploadErrors.slice(0, 12).map((e: any, idx: number) => (
                <div key={`${e.name}-${idx}`} className="break-all">
                  <strong>{e.name}</strong>: {e.message}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 p-4 rounded-xl flex items-center gap-3" style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)' }}>
            <div className="p-2 rounded-lg" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
              <Smartphone size={18} />
            </div>
            <div className="flex-1">
              <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>Mobil yükleme</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Moren mobil uygulamasından bu mukellef için fotoğrafla belge yükleyebilirsin (ileride aktif olacak).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
