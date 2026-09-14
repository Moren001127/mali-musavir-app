'use client';
import React from 'react';
import { Loader2, Save } from 'lucide-react';
import { HAIR, NOTR_DUGME } from '../../_lib/tema';

/** Bölüm içi kaydet: nötr ikincil düğme (altın yalnız başlıktaki Kaydet'te). Aynı onSave'i çağırır. */
export function SectionSaveButton({
  onSave,
  saving,
  hasRecord,
}: {
  onSave: () => void;
  saving: boolean;
  hasRecord: boolean;
}) {
  return (
    <div className="flex justify-start border-t pt-3" style={{ borderColor: HAIR }}>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-medium transition hover:brightness-125 disabled:opacity-50"
        style={NOTR_DUGME}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {hasRecord ? 'Güncelle' : 'Kaydet'}
      </button>
    </div>
  );
}
