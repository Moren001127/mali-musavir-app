'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  RefreshCw,
  Trash2,
  Plus,
  X,
  ArrowLeft,
  CheckCircle2,
  FileQuestion,
} from 'lucide-react';

const ROSE = '#f43f5e';

type LockedModule = {
  id: string;
  path: string;
  sha256: string;
  reason: string;
  lockedBy: string;
  lockedAt: string;
  rebaselined: number;
  notes: string | null;
  active: boolean;
  // Server-computed
  currentSha: string | null;
  exists: boolean;
  matches: boolean;
  status: 'OK' | 'DRIFT' | 'MISSING';
};

export default function KilitliModullerPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: modules, isLoading } = useQuery<LockedModule[]>({
    queryKey: ['locked-modules'],
    queryFn: () => api.get('/system/locked-modules').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const lockMut = useMutation({
    mutationFn: (input: { path: string; reason: string; notes?: string }) =>
      api.post('/system/locked-modules', input).then((r) => r.data),
    onSuccess: () => {
      toast.success('Modül kilitlendi');
      qc.invalidateQueries({ queryKey: ['locked-modules'] });
      setAddOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kilitleme başarısız'),
  });

  const rebaselineMut = useMutation({
    mutationFn: (id: string) =>
      api.put(`/system/locked-modules/${id}/rebaseline`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Hash baseline güncellendi');
      qc.invalidateQueries({ queryKey: ['locked-modules'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Rebaseline başarısız'),
  });

  const unlockMut = useMutation({
    mutationFn: (id: string) =>
      api.put(`/system/locked-modules/${id}/unlock`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Kilit kaldırıldı');
      qc.invalidateQueries({ queryKey: ['locked-modules'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Unlock başarısız'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/system/locked-modules/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Kayıt silindi');
      qc.invalidateQueries({ queryKey: ['locked-modules'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silme başarısız'),
  });

  const list = modules || [];
  const okCount = list.filter((m) => m.status === 'OK').length;
  const driftCount = list.filter((m) => m.status === 'DRIFT').length;
  const missingCount = list.filter((m) => m.status === 'MISSING').length;

  return (
    <div className="space-y-6">
      {/* === BAŞLIK (AI Maliyet imzası — gül-kırmızı kilit teması) === */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(244,63,94,0.16), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(251,191,36,0.12), transparent 45%), #0f0d0b',
        }}
      >
        {/* üst renk şeridi */}
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #f43f5e, #fb7185, #fbbf24, #d4b876)' }}
        />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(250,250,249,0.58)' }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #f43f5e, #be123c)', boxShadow: '0 6px 18px rgba(244,63,94,0.35)' }}
            >
              <Lock size={22} style={{ color: '#ffffff' }} />
            </span>
            Kilitli Modüller
          </h1>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #f43f5e, #be123c)', color: '#fff' }}
          >
            <Plus size={16} />
            Yeni Modül Kilitle
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Hash baseline takibi yapılan kritik dosyalar. SystemHealth her 5 dakikada bir kontrol eder, drift varsa kritik uyarı atar.
        </p>
      </header>

      {/* Sayaclar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Sağlam"
          value={okCount}
          color="#10b981"
          Icon={CheckCircle2}
          description="hash baseline ile eşleşiyor"
        />
        <StatCard
          label="Drift"
          value={driftCount}
          color="#f59e0b"
          Icon={ShieldAlert}
          description="dosya değişmiş, baseline güncel değil"
        />
        <StatCard
          label="Eksik"
          value={missingCount}
          color="#f43f5e"
          Icon={FileQuestion}
          description="dosya silinmiş veya path yanlış"
        />
      </div>

      {/* Liste */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
            Kilitli Dosyalar ({list.length})
          </h2>
          <span className="text-xs" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Otomatik yenileme: 30sn
          </span>
        </div>

        {isLoading && (
          <div className="px-5 py-12 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Yükleniyor...
          </div>
        )}

        {!isLoading && list.length === 0 && (
          <div className="px-5 py-12 text-center">
            <ShieldCheck size={48} style={{ color: ROSE, margin: '0 auto 12px' }} />
            <h3 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
              Henüz kilitli modül yok
            </h3>
            <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
              "Yeni Modül Kilitle" ile bir dosya ekle, hash takibi başlasın.
            </p>
          </div>
        )}

        {list.length > 0 && (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {list.map((m) => (
              <ModuleRow
                key={m.id}
                module={m}
                onRebaseline={() => rebaselineMut.mutate(m.id)}
                onUnlock={() => {
                  if (confirm(`"${m.path}" kilidini kaldır?`)) unlockMut.mutate(m.id);
                }}
                onDelete={() => {
                  if (confirm(`"${m.path}" kaydını TAMAMEN sil? (audit kaybolur)`)) deleteMut.mutate(m.id);
                }}
                rebaselining={rebaselineMut.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Yardım kutusu */}
      <div
        className="rounded-xl p-4 text-sm"
        style={{
          background: 'rgba(244,63,94,0.06)',
          border: '1px solid rgba(244,63,94,0.2)',
          color: 'rgba(250,250,249,0.7)',
        }}
      >
        <p className="font-semibold mb-2" style={{ color: ROSE }}>Nasıl çalışır?</p>
        <ul className="space-y-1.5 text-xs leading-relaxed">
          <li>
            • <strong>Lock</strong>: Kritik bir dosyayı baseline'a ekler. SHA256 hash'i hesaplar, DB'ye yazar.
          </li>
          <li>
            • <strong>Rebaseline</strong>: Dosyayı kasıtlı değiştirdin → yeni hash'i baseline yap. Drift uyarısı kalkar.
          </li>
          <li>
            • <strong>Unlock</strong>: Artık takip etme, ama kayıt geçmişte tutulur (audit).
          </li>
          <li>
            • <strong>Sil</strong>: Kaydı tamamen kaldır (audit kaybolur).
          </li>
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
          Drift veya eksik durumda otomatik olarak top-bar'daki 🛡️ ikonu kırmızı yanıp söner.
        </p>
      </div>

      {/* ADD MODAL */}
      {addOpen && (
        <AddModal
          onClose={() => setAddOpen(false)}
          onSubmit={(input) => lockMut.mutate(input)}
          submitting={lockMut.isPending}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  Icon,
  description,
}: {
  label: string;
  value: number;
  color: string;
  Icon: any;
  description: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{
        borderColor: `${color}40`,
        background: `linear-gradient(135deg, ${color}22, ${color}0a 58%, rgba(255,255,255,0.02))`,
      }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color }}>
          {label}
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
          <Icon size={14} style={{ color }} />
        </span>
      </div>
      <p className="mt-3 text-[34px] font-bold leading-none" style={{ color: value > 0 ? color : '#fafaf9' }}>
        {value}
      </p>
      <p className="text-[11px] mt-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
        {description}
      </p>
    </div>
  );
}

function ModuleRow({
  module: m,
  onRebaseline,
  onUnlock,
  onDelete,
  rebaselining,
}: {
  module: LockedModule;
  onRebaseline: () => void;
  onUnlock: () => void;
  onDelete: () => void;
  rebaselining: boolean;
}) {
  const statusColor = m.status === 'OK' ? '#10b981' : m.status === 'DRIFT' ? '#f59e0b' : '#f43f5e';
  const statusLabel = m.status === 'OK' ? 'Sağlam' : m.status === 'DRIFT' ? 'Drift' : 'Eksik';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded mt-1"
          style={{
            color: statusColor,
            background: `${statusColor}1a`,
            border: `1px solid ${statusColor}40`,
            flexShrink: 0,
          }}
        >
          {statusLabel.toUpperCase()}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-mono font-semibold break-all" style={{ color: '#fafaf9' }}>
            {m.path}
          </p>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.7)' }}>
            {m.reason}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <span>Kilitleyen: {m.lockedBy}</span>
            <span>Tarih: {new Date(m.lockedAt).toLocaleDateString('tr-TR')}</span>
            <span>Rebaseline: {m.rebaselined}x</span>
            <span className="font-mono">SHA: {m.sha256.slice(0, 8)}…</span>
          </div>
          {m.status === 'DRIFT' && m.currentSha && (
            <div
              className="mt-2 px-3 py-2 rounded text-[11px] font-mono"
              style={{
                background: 'rgba(245,158,11,0.08)',
                color: 'rgba(250,250,249,0.7)',
                border: '1px solid rgba(245,158,11,0.2)',
              }}
            >
              <div>Beklenen: {m.sha256.slice(0, 24)}…</div>
              <div>Mevcut  : {m.currentSha.slice(0, 24)}…</div>
            </div>
          )}
          {m.notes && (
            <p className="text-[11px] mt-2 italic" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Not: {m.notes}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(m.status === 'DRIFT') && (
            <button
              onClick={onRebaseline}
              disabled={rebaselining}
              className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium hover:opacity-80"
              style={{
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.3)',
                color: '#f59e0b',
              }}
              title="Mevcut hash'i baseline yap (kasıtlı değişiklikse)"
            >
              <RefreshCw size={12} className={rebaselining ? 'animate-spin' : ''} />
              Rebaseline
            </button>
          )}
          <button
            onClick={onUnlock}
            className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium hover:opacity-80"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(250,250,249,0.7)',
            }}
            title="Kilidi kaldır (kayıt geçmişte kalır)"
          >
            <Unlock size={12} />
            Aç
          </button>
          <button
            onClick={onDelete}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
            style={{
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.2)',
              color: '#f43f5e',
            }}
            title="Tamamen sil"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (input: { path: string; reason: string; notes?: string }) => void;
  submitting: boolean;
}) {
  const [path, setPath] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const submit = () => {
    if (!path.trim()) return toast.error('Path zorunlu');
    if (!reason.trim()) return toast.error('Sebep zorunlu (1 cümle)');
    onSubmit({ path: path.trim(), reason: reason.trim(), notes: notes.trim() || undefined });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{
          background: 'rgb(15,13,11)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <h3 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-7 w-7 place-items-center rounded-lg"
              style={{ background: 'linear-gradient(135deg, #f43f5e, #be123c)', boxShadow: '0 4px 12px rgba(244,63,94,0.35)' }}
            >
              <Lock size={14} style={{ color: '#ffffff' }} />
            </span>
            Yeni Modül Kilitle
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <X size={14} style={{ color: 'rgba(250,250,249,0.7)' }} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Dosya Yolu <span style={{ color: '#f43f5e' }}>*</span>
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="apps/web/src/app/(panel)/panel/mizan/page.tsx"
              className="w-full h-10 px-3 rounded-lg text-sm font-mono"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fafaf9',
              }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.4)' }}>
              Repo root'a göre yol (slash ile başlatma)
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Kilitleme Sebebi <span style={{ color: '#f43f5e' }}>*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tam otomasyon, dokunma"
              className="w-full h-10 px-3 rounded-lg text-sm"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fafaf9',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Notlar (opsiyonel)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Detaylı açıklama, neden değiştirilmemeli vs."
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fafaf9',
              }}
            />
          </div>
        </div>

        <div
          className="px-5 py-4 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg text-sm font-medium hover:opacity-80"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(250,250,249,0.7)',
            }}
          >
            İptal
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="h-10 px-5 rounded-lg text-sm font-medium hover:opacity-90 flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #f43f5e, #be123c)',
              color: '#fff',
            }}
          >
            {submitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Kilitleniyor…
              </>
            ) : (
              <>
                <Lock size={14} />
                Kilitle
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
