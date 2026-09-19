'use client';
import { portalStyle } from '@/lib/portal-theme';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ALTIN_DUGME, GOLD, LINE, MUTED, NOTR_DUGME, R_ALAN, RED, SELECT_CLS, TEXT, ikonRozeti } from '../_lib/tema';
import { Field } from './ortak/Field';
import { InputBase } from './ortak/InputBase';
import { Cip } from './ortak/Tablo';

// ============================================================
// YETKİLİLER (Firma Yetkili Bilgileri) — şimdilik gizli bölüm
// ============================================================
export function YetkililerSection({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newY, setNewY] = useState({ firstName: '', lastName: '', tcNo: '', gorev: '', telefon: '', eposta: '', isPrimary: false });

  const { data: yetkililer = [], isLoading } = useQuery({
    queryKey: ['taxpayer-yetkililer', taxpayerId],
    queryFn: () => api.get(`/taxpayers/${taxpayerId}/yetkililer`).then((r) => r.data),
  });

  const { mutate: createY, isPending: creating } = useMutation({
    mutationFn: (data: any) => api.post(`/taxpayers/${taxpayerId}/yetkililer`, data),
    onSuccess: () => {
      toast.success('Yetkili eklendi');
      qc.invalidateQueries({ queryKey: ['taxpayer-yetkililer', taxpayerId] });
      setAdding(false);
      setNewY({ firstName: '', lastName: '', tcNo: '', gorev: '', telefon: '', eposta: '', isPrimary: false });
    },
    onError: (e: any) => {
      const msg = e.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Yetkili eklenemedi');
    },
  });

  const { mutate: deleteY } = useMutation({
    mutationFn: (yId: string) => api.delete(`/taxpayers/${taxpayerId}/yetkililer/${yId}`),
    onSuccess: () => {
      toast.success('Yetkili silindi');
      qc.invalidateQueries({ queryKey: ['taxpayer-yetkililer', taxpayerId] });
    },
  });

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="text-[13px]" style={portalStyle({ color: MUTED })}>Yükleniyor...</div>
      ) : (
        <>
          {(yetkililer as any[]).length === 0 && !adding ? (
            <div className="p-4 text-center text-[13px]" style={portalStyle({ border: `1px solid ${LINE}`, borderRadius: R_ALAN, color: MUTED })}>
              Henüz yetkili eklenmemiş.
            </div>
          ) : (
            <div className="space-y-2">
              {(yetkililer as any[]).map((y) => (
                <div key={y.id} className="flex items-start gap-3 p-3" style={portalStyle({ border: `1px solid ${y.isPrimary ? `${GOLD}55` : LINE}`, borderRadius: R_ALAN, background: y.isPrimary ? `${GOLD}0d` : 'rgba(0,0,0,0.18)' })}>
                  <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center text-[11.5px] font-bold" style={portalStyle(ikonRozeti(y.isPrimary ? GOLD : MUTED))}>
                    {(y.firstName?.[0] || '') + (y.lastName?.[0] || '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[13px] font-bold" style={portalStyle({ color: TEXT })}>{y.firstName} {y.lastName}</strong>
                      {y.isPrimary && <Cip renk={GOLD}>Birincil</Cip>}
                      {y.gorev && <span className="text-[11.5px]" style={portalStyle({ color: MUTED })}>· {y.gorev}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11.5px]" style={portalStyle({ color: MUTED })}>
                      {y.tcNo && <span className="font-mono">TC: {y.tcNo}</span>}
                      {y.telefon && <span>{y.telefon}</span>}
                      {y.eposta && <span>{y.eposta}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`${y.firstName} ${y.lastName} silinsin mi?`)) deleteY(y.id);
                    }}
                    className="flex h-8 w-8 items-center justify-center transition hover:brightness-125"
                    style={portalStyle({ ...NOTR_DUGME, color: RED })}
                    title="Sil"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="p-4" style={portalStyle({ border: `1px solid ${LINE}`, borderRadius: R_ALAN, background: 'rgba(0,0,0,0.18)' })}>
              <div className="mb-3 text-[12px] font-bold" style={portalStyle({ color: TEXT })}>Yeni yetkili</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Ad" required>
                  <InputBase value={newY.firstName} onChange={(e) => setNewY((p) => ({ ...p, firstName: e.target.value }))} />
                </Field>
                <Field label="Soyad" required>
                  <InputBase value={newY.lastName} onChange={(e) => setNewY((p) => ({ ...p, lastName: e.target.value }))} />
                </Field>
                <Field label="TC Kimlik No">
                  <InputBase value={newY.tcNo} onChange={(e) => setNewY((p) => ({ ...p, tcNo: e.target.value.replace(/\D/g, '') }))} maxLength={11} className="font-mono" />
                </Field>
                <Field label="Görev">
                  <select
                    value={newY.gorev}
                    onChange={(e) => setNewY((p) => ({ ...p, gorev: e.target.value }))}
                    className={SELECT_CLS}
                    style={portalStyle({ colorScheme: 'dark' })}
                  >
                    <option value="">Seçiniz</option>
                    <option value="MUDUR">Müdür</option>
                    <option value="ORTAK">Ortak</option>
                    <option value="IMZA_YETKILI">İmza Yetkilisi</option>
                    <option value="MUHASEBE_SORUMLUSU">Muhasebe Sorumlusu</option>
                    <option value="DIGER">Diğer</option>
                  </select>
                </Field>
                <Field label="Telefon">
                  <InputBase type="tel" value={newY.telefon} onChange={(e) => setNewY((p) => ({ ...p, telefon: e.target.value }))} />
                </Field>
                <Field label="E-posta">
                  <InputBase type="email" value={newY.eposta} onChange={(e) => setNewY((p) => ({ ...p, eposta: e.target.value }))} />
                </Field>
                <label className="flex items-center gap-2 text-[13px] md:col-span-2" style={portalStyle({ color: TEXT })}>
                  <input
                    type="checkbox"
                    checked={newY.isPrimary}
                    onChange={(e) => setNewY((p) => ({ ...p, isPrimary: e.target.checked }))}
                    style={portalStyle({ accentColor: GOLD })}
                  />
                  Birincil iletişim kişisi olarak işaretle
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="inline-flex h-9 items-center px-3.5 text-[13px] font-medium transition hover:brightness-125" style={portalStyle(NOTR_DUGME)}>
                  İptal
                </button>
                <button
                  type="button"
                  onClick={() => createY(newY)}
                  disabled={creating || !newY.firstName || !newY.lastName}
                  className="inline-flex h-9 items-center gap-1.5 px-4 text-[13px] font-bold disabled:opacity-50"
                  style={portalStyle(ALTIN_DUGME)}
                >
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Yetkili Ekle
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-medium transition hover:brightness-125"
              style={portalStyle({ ...NOTR_DUGME, borderStyle: 'dashed' })}
            >
              <Plus size={14} /> Yetkili Ekle
            </button>
          )}
        </>
      )}
    </div>
  );
}
