'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertTriangle, Calendar, CheckCircle2, Eye, FileText,
  Filter, Loader2, RefreshCw, Search, ShieldAlert, Users, X,
} from 'lucide-react';

const GOLD = '#d4b876';

type ReviewItem = {
  id: string;
  sessionId: string;
  originalName: string;
  ocrStatus: string;
  ocrBelgeNo: string | null;
  ocrDate: string | null;
  ocrKdvTutari: string | null;
  ocrKdvTevkifat: string | null;
  ocrSatici: string | null;
  ocrSaticiVkn: string | null;
  ocrBelgeTipi: string | null;
  ocrKategori: string | null;
  ocrConfidence: number | null;
  ocrBelgeNoConfidence: number | null;
  ocrDateConfidence: number | null;
  ocrKdvConfidence: number | null;
  ocrEngine: string | null;
  ocrValidationScore: number | null;
  uploadedAt: string;
  mukellefAdi: string;
  mukellefVkn: string | null;
  session: { id: string; taxpayerId: string; donem: string; kayitTuru: string } | null;
};

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
};
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const fmtConf = (v: number | null | undefined): string =>
  typeof v === 'number' ? `%${Math.round(v * 100)}` : '—';

const confColor = (v: number | null | undefined): string => {
  if (v == null) return 'rgba(250,250,249,0.3)';
  if (v >= 0.8) return '#22c55e';
  if (v >= 0.5) return '#f59e0b';
  return '#ef4444';
};

export default function MihsapIncelePage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [donem, setDonem] = useState('');
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [editForm, setEditForm] = useState<{
    belgeNo: string;
    date: string;
    kdvTutari: string;
    kdvTevkifat: string;
  } | null>(null);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const { data: queueData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['mihsap-review-queue', taxpayerId, donem],
    queryFn: () =>
      api.get('/kdv-control/review-queue', {
        params: { taxpayerId: taxpayerId || undefined, donem: donem || undefined, limit: 200 },
      }).then((r) => r.data as { items: ReviewItem[]; total: number; limit: number; offset: number }),
  });

  const items = queueData?.items ?? [];
  const total = queueData?.total ?? 0;

  const confirmMut = useMutation({
    mutationFn: (args: { imageId: string; belgeNo: string; date: string; kdvTutari: string; kdvTevkifat: string }) =>
      api.patch(`/kdv-control/images/${args.imageId}/confirm-ocr`, {
        belgeNo: args.belgeNo,
        date: args.date,
        kdvTutari: args.kdvTutari,
        kdvTevkifat: args.kdvTevkifat || null,
      }),
    onSuccess: () => {
      toast.success('Düzeltme kaydedildi');
      qc.invalidateQueries({ queryKey: ['mihsap-review-queue'] });
      setEditing(null);
      setEditForm(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  const reocrMut = useMutation({
    mutationFn: (imageId: string) =>
      api.post(`/kdv-control/images/${imageId}/reocr`),
    onSuccess: () => {
      toast.success('OCR yeniden başlatıldı');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['mihsap-review-queue'] }), 3000);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Yeniden başlatılamadı'),
  });

  const startEdit = (item: ReviewItem) => {
    setEditing(item);
    setEditForm({
      belgeNo: item.ocrBelgeNo || '',
      date: item.ocrDate || '',
      kdvTutari: item.ocrKdvTutari || '',
      kdvTevkifat: item.ocrKdvTevkifat || '',
    });
  };

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <ShieldAlert size={10} className="inline mr-1" /> Mihsap · İncele
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          Düzeltme Bekleyen Faturalar
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          OCR güveni düşük olan ya da doğrulama hatası olan faturalar burada toplanır.
          Tek tek kontrol edip teyit et — KDV mutabakatı doğru çalışsın.
        </p>
      </div>

      {/* Filtre barı */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Users size={11} className="inline mr-1" /> Mükellef
          </label>
          <select
            value={taxpayerId}
            onChange={(e) => setTaxpayerId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            <option value="" style={{ background: '#0f0d0b' }}>Tüm mükellefler</option>
            {taxpayers.map((t) => (
              <option key={t.id} value={t.id} style={{ background: '#0f0d0b' }}>
                {taxpayerName(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Calendar size={11} className="inline mr-1" /> Dönem
          </label>
          <input
            type="text"
            placeholder="2026-03"
            value={donem}
            onChange={(e) => setDonem(e.target.value)}
            className="px-3 py-2.5 rounded-lg text-sm border outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 140 }}
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-2.5 rounded-lg text-sm flex items-center gap-1.5"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Yenile
        </button>
      </div>

      {/* Sayım banner'ı */}
      <div
        className="rounded-lg px-4 py-2.5 text-sm flex items-center gap-2"
        style={{
          background: total > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
          border: `1px solid ${total > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: total > 0 ? '#f59e0b' : '#22c55e',
        }}
      >
        {total > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
        <span>
          {total > 0 ? <strong>{total}</strong> : 'Düzeltme bekleyen fatura yok'}
          {total > 0 && ' fatura düzeltme bekliyor — KDV mutabakatından önce gözden geçir.'}
        </span>
      </div>

      {/* Liste */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        {isLoading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={14} className="animate-spin" /> Yükleniyor…
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <CheckCircle2 size={36} className="mx-auto mb-3" style={{ color: '#22c55e' }} />
            <p className="text-sm">Tüm faturalar başarıyla işlendi. Düzeltme bekleyen yok.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Belge</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Mükellef</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Belge No</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Tarih</th>
                <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>KDV</th>
                <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Satıcı</th>
                <th className="px-3 py-2.5 text-center text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>Güven</th>
                <th className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t hover:bg-white/[0.02]" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <FileText size={12} style={{ color: 'rgba(250,250,249,0.4)' }} />
                      <span className="text-[12.5px] truncate max-w-[140px] inline-block" style={{ color: '#fafaf9' }}>
                        {item.originalName}
                      </span>
                    </div>
                    {item.ocrBelgeTipi && (
                      <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded inline-block mt-1"
                        style={{ background: 'rgba(184,160,111,0.15)', color: GOLD }}>
                        {item.ocrBelgeTipi}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-[12.5px]" style={{ color: '#fafaf9' }}>{item.mukellefAdi}</div>
                    <div className="text-[10.5px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {item.session?.donem}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    <span style={{ color: item.ocrBelgeNo ? '#fafaf9' : 'rgba(250,250,249,0.3)' }}>
                      {item.ocrBelgeNo || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                    {item.ocrDate || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: item.ocrKdvTutari ? '#fafaf9' : 'rgba(250,250,249,0.3)' }}>
                    {item.ocrKdvTutari || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-[11.5px] truncate max-w-[160px] inline-block" style={{ color: 'rgba(250,250,249,0.7)' }}>
                      {item.ocrSatici || '—'}
                    </div>
                    {item.ocrSaticiVkn && (
                      <div className="text-[10px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        VKN: {item.ocrSaticiVkn}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex justify-center items-center gap-1">
                      <span title="Belge No güveni"
                        className="w-2 h-2 rounded-full"
                        style={{ background: confColor(item.ocrBelgeNoConfidence) }} />
                      <span title="Tarih güveni"
                        className="w-2 h-2 rounded-full"
                        style={{ background: confColor(item.ocrDateConfidence) }} />
                      <span title="KDV güveni"
                        className="w-2 h-2 rounded-full"
                        style={{ background: confColor(item.ocrKdvConfidence) }} />
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                      {fmtConf(item.ocrConfidence)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => startEdit(item)}
                        className="px-2 py-1 rounded text-xs flex items-center gap-1"
                        style={{ background: 'rgba(184,160,111,0.12)', color: GOLD, border: '1px solid rgba(184,160,111,0.3)' }}
                      >
                        Düzelt
                      </button>
                      <button
                        onClick={() => reocrMut.mutate(item.id)}
                        disabled={reocrMut.isPending}
                        className="px-2 py-1 rounded text-xs flex items-center"
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}
                        title="Yeniden OCR çalıştır"
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Düzeltme modal */}
      {editing && editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => !confirmMut.isPending && setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[520px] max-w-[90vw] rounded-xl p-5"
            style={{ background: '#1a1714', border: '1px solid rgba(184,160,111,0.3)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold" style={{ color: GOLD }}>OCR Düzeltme</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  {editing.mukellefAdi} · {editing.session?.donem} · {editing.originalName}
                </p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-white/5">
                <X size={16} style={{ color: 'rgba(250,250,249,0.6)' }} />
              </button>
            </div>

            <div className="space-y-3">
              {editing.ocrBelgeTipi && (
                <div className="text-[12px] px-3 py-2 rounded" style={{ background: 'rgba(184,160,111,0.06)', color: GOLD }}>
                  Tip: <strong>{editing.ocrBelgeTipi}</strong>
                  {editing.ocrEngine && <span style={{ color: 'rgba(250,250,249,0.5)', marginLeft: 8 }}>· {editing.ocrEngine}</span>}
                </div>
              )}
              <div>
                <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                  Belge No <span style={{ color: confColor(editing.ocrBelgeNoConfidence) }}>· {fmtConf(editing.ocrBelgeNoConfidence)}</span>
                </label>
                <input
                  type="text"
                  value={editForm.belgeNo}
                  onChange={(e) => setEditForm({ ...editForm, belgeNo: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none border"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />
              </div>
              <div>
                <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                  Tarih (YYYY-MM-DD) <span style={{ color: confColor(editing.ocrDateConfidence) }}>· {fmtConf(editing.ocrDateConfidence)}</span>
                </label>
                <input
                  type="text"
                  placeholder="2026-03-15"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none border"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    KDV Tutarı <span style={{ color: confColor(editing.ocrKdvConfidence) }}>· {fmtConf(editing.ocrKdvConfidence)}</span>
                  </label>
                  <input
                    type="text"
                    placeholder="0,00"
                    value={editForm.kdvTutari}
                    onChange={(e) => setEditForm({ ...editForm, kdvTutari: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none border"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                    KDV Tevkifat (varsa)
                  </label>
                  <input
                    type="text"
                    placeholder="0,00"
                    value={editForm.kdvTevkifat}
                    onChange={(e) => setEditForm({ ...editForm, kdvTevkifat: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none border"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditing(null)}
                disabled={confirmMut.isPending}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                İptal
              </button>
              <button
                onClick={() => confirmMut.mutate({
                  imageId: editing.id,
                  belgeNo: editForm.belgeNo,
                  date: editForm.date,
                  kdvTutari: editForm.kdvTutari,
                  kdvTevkifat: editForm.kdvTevkifat,
                })}
                disabled={confirmMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                style={{ background: GOLD, color: '#1a1714', border: 0 }}
              >
                {confirmMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Teyit Et
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
