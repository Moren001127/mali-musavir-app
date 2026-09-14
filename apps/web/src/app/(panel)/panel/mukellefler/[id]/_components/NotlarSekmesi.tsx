'use client';
import React from 'react';
import type { FormState } from '../_lib/form';
import { AlanMetin, FormAltBilgi, FormGrup, Satir } from './ortak/Form';
import { SekmeBasligi } from './ortak/Tablo';
import { MukellefGorevleri } from '../MukellefGorevleri';

// ============================================================
// MÜKELLEF NOT SEKMESİ — serbest not + bağlı görev/notlar
// ============================================================
export function NotlarTab({
  form,
  setForm,
  onSave,
  saving,
  hasRecord,
  taxpayerId,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  saving: boolean;
  hasRecord: boolean;
  taxpayerId?: string | null;
}) {
  return (
    <div className="space-y-3">
      <SekmeBasligi title="Mükellef hakkında notlar" text="Bu mükellefe özel serbest notlar; Kaydet ile form üzerinden saklanır." />
      <FormGrup baslik="Serbest not" aciklama="Yalnız ofis görür; mükellef portalında gösterilmez" sutun={1}>
        <Satir etiket="Not" hizala="ust">
          <AlanMetin
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            rows={8}
            placeholder="Bu mükellefe özel notlar…"
          />
        </Satir>
      </FormGrup>
      <FormAltBilgi onSave={onSave} saving={saving} hasRecord={hasRecord} />
      {/* 2026-09-14: Görevler & Notlar modülündeki bu mükellefe bağlı görev/notlar */}
      {hasRecord && taxpayerId && <MukellefGorevleri taxpayerId={taxpayerId} />}
    </div>
  );
}
