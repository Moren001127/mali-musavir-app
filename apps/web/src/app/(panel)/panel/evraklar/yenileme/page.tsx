'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Calendar,
  Edit3,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import {
  documentsApi,
  expiringStatusColor,
  expiringStatusLabel,
  type ExpiringDocument,
} from '@/lib/documents';

const GOLD = '#d4b876';

function taxpayerName(t: ExpiringDocument['taxpayer']) {
  return (
    t.companyName ||
    [t.firstName, t.lastName].filter(Boolean).join(' ') ||
    '(isim yok)'
  );
}

export default function EvrakYenilemePage() {
  const qc = useQueryClient();
  const [daysAhead, setDaysAhead] = useState<number>(60);
  const [filter, setFilter] = useState<'all' | 'expired' | 'soon'>('all');
  const [editing, setEditing] = useState<{
    id: string;
    expiresAt: string;
    reminderDays: number;
    notes: string;
  } | null>(null);

  const { data: docs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['expiring-docs', daysAhead],
    queryFn: () =>
      documentsApi.getExpiring({ daysAhead, includeExpired: true }),
  });

  const updateMut = useMutation({
    mutationFn: (payload: {
      id: string;
      expiresAt: string | null;
      reminderDays: number;
      notes: string | null;
    }) =>
      documentsApi.update(payload.id, {
        expiresAt: payload.expiresAt
          ? new Date(payload.expiresAt).toISOString()
          : null,
        reminderDays: payload.reminderDays,
        notes: payload.notes,
      }),
    onSuccess: () => {
      toast.success('Belge güncellendi');
      qc.invalidateQueries({ queryKey: ['expiring-docs'] });
      qc.invalidateQueries({ queryKey: ['documents-expiring'] });
      setEditing(null);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Güncellenemedi'),
  });

  const visible = useMemo(
    () =>
      docs.filter((d: ExpiringDocument) => {
        if (filter === 'all') return true;
        if (filter === 'expired') return d.status === 'EXPIRED';
        return d.status === 'EXPIRING_SOON';
      }),
    [docs, filter],
  );

  const counts = useMemo(() => {
    const expired = docs.filter((d: ExpiringDocument) => d.status === 'EXPIRED').length;
    const soon = docs.filter((d: ExpiringDocument) => d.status === 'EXPIRING_SOON').length;
    return { expired, soon };
  }, [docs]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div
        className="pb-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span
            className="text-[10px] uppercase font-bold tracking-[.18em]"
            style={{ color: '#b8a06f' }}
          >
            <AlertTriangle size={10} className="inline mr-1" /> Yenileme
          </span>
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 34,
            fontWeight: 600,
            color: '#fafaf9',
            letterSpacing: '-.03em',
          }}
        >
          Evrak Yenileme
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Vekaletname, imza sirküleri, ticaret sicil, vergi levhası gibi süreli belgelerin
          son kullanım tarihini takip et. {counts.expired > 0 && <span style={{ color: '#ef4444' }}> · {counts.expired} dolmuş</span>}
          {counts.soon > 0 && <span style={{ color: '#f59e0b' }}> · {counts.soon} yaklaşıyor</span>}
        </p>
      </div>

      {/* Filtre barı */}
      <div className="flex flex-wrap gap-3 items-center">
        <div
          className="inline-flex rounded-lg overflow-hidden border"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
          {(
            [
              { v: 'all' as const, l: 'Tümü', c: docs.length },
              { v: 'expired' as const, l: 'Dolmuş', c: counts.expired },
              { v: 'soon' as const, l: 'Yaklaşan', c: counts.soon },
            ]
          ).map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className="px-3 py-2 text-xs font-semibold transition"
              style={{
                background:
                  filter === f.v
                    ? 'rgba(184,160,111,0.15)'
                    : 'rgba(255,255,255,0.02)',
                color: filter === f.v ? GOLD : 'rgba(250,250,249,0.6)',
                borderRight:
                  f.v === 'soon' ? 'none' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {f.l} ({f.c})
            </button>
          ))}
        </div>

        <select
          value={daysAhead}
          onChange={(e) => setDaysAhead(parseInt(e.target.value, 10))}
          className="px-3 py-2 rounded-lg text-xs border outline-none"
          style={{
            background: 'rgba(255,255,255,0.03)',
            borderColor: 'rgba(255,255,255,0.08)',
            color: '#fafaf9',
          }}
        >
          <option value={30} style={{ background: '#0f0d0b' }}>30 gün içinde</option>
          <option value={60} style={{ background: '#0f0d0b' }}>60 gün içinde</option>
          <option value={90} style={{ background: '#0f0d0b' }}>90 gün içinde</option>
          <option value={180} style={{ background: '#0f0d0b' }}>180 gün içinde</option>
          <option value={365} style={{ background: '#0f0d0b' }}>1 yıl içinde</option>
        </select>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
          style={{
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(250,250,249,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Yenile
        </button>
      </div>

      {/* Liste */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        {isLoading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={14} className="animate-spin" /> Yükleniyor…
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <FileText size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              Bu kriterlere uygun belge yok. Belgelerin "Geçerlilik Sonu"
              alanını mükellef detay sayfasından doldurabilirsin.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Belge</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Mükellef</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Geçerlilik</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Durum</th>
                <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const color = expiringStatusColor(d.status, d.daysLeft);
                return (
                  <tr
                    key={d.id}
                    className="border-t hover:bg-white/[0.02] transition"
                    style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/panel/evraklar/${d.id}`}
                        className="flex items-center gap-2 hover:underline"
                        style={{ color: '#fafaf9' }}
                      >
                        <FileText size={12} style={{ color: 'rgba(250,250,249,0.4)' }} />
                        {d.title}
                      </Link>
                      {d.notes && (
                        <div className="text-[11px] mt-0.5 ml-5" style={{ color: 'rgba(250,250,249,0.4)' }}>
                          {d.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/panel/mukellefler/${d.taxpayer.id}`}
                        className="hover:underline"
                        style={{ color: 'rgba(250,250,249,0.85)' }}
                      >
                        {taxpayerName(d.taxpayer)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.7)' }}>
                      <Calendar size={11} className="inline mr-1" />
                      {new Date(d.expiresAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-semibold inline-block"
                        style={{
                          background: color + '20',
                          color,
                          border: `1px solid ${color}40`,
                        }}
                      >
                        {expiringStatusLabel(d.status, d.daysLeft)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() =>
                          setEditing({
                            id: d.id,
                            expiresAt: d.expiresAt
                              ? new Date(d.expiresAt).toISOString().slice(0, 10)
                              : '',
                            reminderDays: d.reminderDays,
                            notes: d.notes || '',
                          })
                        }
                        className="px-2 py-1 rounded text-xs flex items-center gap-1 inline-flex"
                        style={{
                          background: 'rgba(184,160,111,0.12)',
                          color: GOLD,
                          border: '1px solid rgba(184,160,111,0.3)',
                        }}
                      >
                        <Edit3 size={11} /> Düzenle
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Düzenleme modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => !updateMut.isPending && setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[480px] max-w-[90vw] rounded-xl p-5"
            style={{
              background: '#1a1714',
              border: '1px solid rgba(184,160,111,0.3)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: GOLD }}>
                Geçerlilik Tarihi
              </h3>
              <button
                onClick={() => setEditing(null)}
                disabled={updateMut.isPending}
                className="p-1 rounded hover:bg-white/5"
              >
                <X size={16} style={{ color: 'rgba(250,250,249,0.6)' }} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
                  style={{ color: 'rgba(250,250,249,0.6)' }}
                >
                  Son Kullanım Tarihi
                </label>
                <input
                  type="date"
                  value={editing.expiresAt}
                  onChange={(e) =>
                    setEditing((s) => s && { ...s, expiresAt: e.target.value })
                  }
                  className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    color: '#fafaf9',
                  }}
                />
                <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  Boş bırakırsan belge süresiz kabul edilir (uyarı çıkmaz).
                </p>
              </div>

              <div>
                <label
                  className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
                  style={{ color: 'rgba(250,250,249,0.6)' }}
                >
                  Bitime Kaç Gün Kala Uyar
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={editing.reminderDays}
                  onChange={(e) =>
                    setEditing((s) => s && { ...s, reminderDays: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    color: '#fafaf9',
                  }}
                />
              </div>

              <div>
                <label
                  className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5"
                  style={{ color: 'rgba(250,250,249,0.6)' }}
                >
                  Not
                </label>
                <textarea
                  rows={3}
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing((s) => s && { ...s, notes: e.target.value })
                  }
                  placeholder="örn: 2027 sonunda yenilenmeli"
                  className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none resize-none"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    color: '#fafaf9',
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditing(null)}
                disabled={updateMut.isPending}
                className="px-4 py-2 rounded-lg text-sm"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(250,250,249,0.7)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                İptal
              </button>
              <button
                onClick={() =>
                  editing &&
                  updateMut.mutate({
                    id: editing.id,
                    expiresAt: editing.expiresAt || null,
                    reminderDays: editing.reminderDays,
                    notes: editing.notes || null,
                  })
                }
                disabled={updateMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                style={{
                  background: GOLD,
                  color: '#1a1714',
                  border: 0,
                }}
              >
                {updateMut.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
