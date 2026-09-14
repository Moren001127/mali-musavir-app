'use client';
import React from 'react';
import { TEXTAREA_CLS } from '../_lib/tema';
import type { FormState } from '../_lib/form';
import { SectionSaveButton } from './ortak/SectionSaveButton';
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
      <textarea
        value={form.notes}
        onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
        rows={10}
        placeholder="Bu mükellefe özel notlar..."
        className={TEXTAREA_CLS}
      />
      <SectionSaveButton onSave={onSave} saving={saving} hasRecord={hasRecord} />
      {/* 2026-09-14: Görevler & Notlar modülündeki bu mükellefe bağlı görev/notlar */}
      {hasRecord && taxpayerId && <MukellefGorevleri taxpayerId={taxpayerId} />}
    </div>
  );
}
