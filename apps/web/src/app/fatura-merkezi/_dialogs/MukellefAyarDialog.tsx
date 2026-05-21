'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   MUKELLEF AYAR DIALOG — fatura işleme tercihleri
   - Defter türü (BILANCO / ISLETME)
   - Matrah KDV oranına göre ayrılsın mı?
   - Stok / miktar gösterim
   - Tevkifat / Stopaj
   - Denetlemeye tabi mi?
   ════════════════════════════════════════════════════════════════════ */

type Props = { taxpayer: any; onClose: () => void };

export default function MukellefAyarDialog({ taxpayer, onClose }: Props) {
  const qc = useQueryClient();

  const [defterTuru, setDefterTuru] = useState(taxpayer.defterTuru || 'BILANCO');
  const [splitByKdv, setSplitByKdv] = useState(taxpayer.splitByKdv ?? true);
  const [showStock, setShowStock] = useState(taxpayer.showStock ?? false);
  const [showMiktar, setShowMiktar] = useState(taxpayer.showMiktar ?? false);
  const [showTevkifat, setShowTevkifat] = useState(taxpayer.showTevkifat ?? false);
  const [auditScope, setAuditScope] = useState(taxpayer.auditScope ?? false);
  const [isEFatura, setIsEFatura] = useState(!!taxpayer.isEFaturaMukellefi);

  const saveMut = useMutation({
    mutationFn: async () => {
      return api.patch(`/taxpayers/${taxpayer.id}`, {
        defterTuru,
        splitByKdv,
        showStock,
        showMiktar,
        showTevkifat,
        auditScope,
        isEFaturaMukellefi: isEFatura,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'taxpayers'] });
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#9ca3af20', color: '#9ca3af' }}>
              <Settings size={18} />
            </div>
            <div>
              <div className="text-[15.5px] font-semibold" style={{ color: 'var(--text)' }}>Mukellef Ayarları</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{taxpayerName(taxpayer)}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Defter Türü</label>
            <select
              value={defterTuru}
              onChange={(e) => setDefterTuru(e.target.value)}
              className="w-full px-3 py-2 text-[13px] outline-none rounded-lg"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="BILANCO">Bilanço</option>
              <option value="ISLETME">İşletme Defteri</option>
              <option value="SERBEST_MESLEK">Serbest Meslek</option>
            </select>
          </div>

          <div className="space-y-2 pt-2">
            <ToggleRow label="Matrah KDV oranına göre ayrılsın" value={splitByKdv} onChange={setSplitByKdv} />
            <ToggleRow label="e-Fatura mükellefi" value={isEFatura} onChange={setIsEFatura} />
            <ToggleRow label="Stok takibi var" value={showStock} onChange={setShowStock} />
            <ToggleRow label="Miktar bilgisi gösterilsin" value={showMiktar} onChange={setShowMiktar} />
            <ToggleRow label="Satışta tevkifat gösterilsin" value={showTevkifat} onChange={setShowTevkifat} />
            <ToggleRow label="Denetlemeye tabi" value={auditScope} onChange={setAuditScope} />
          </div>

          {saveMut.error && (
            <div className="p-3 rounded-lg text-[11.5px]" style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}>
              {(saveMut.error as any)?.response?.data?.message || 'Kaydetme hatası'}
            </div>
          )}
        </div>

        <div className="px-6 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <button
            onClick={onClose}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 text-[12.5px] rounded-md font-medium"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            İptal
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[12.5px] rounded-md font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            {saveMut.isPending && <Loader2 size={13} className="animate-spin" />}
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors" style={{ background: 'var(--surface-2)' }}>
      <span className="text-[12.5px]" style={{ color: 'var(--text)' }}>{label}</span>
      <div
        onClick={() => onChange(!value)}
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{ background: value ? 'var(--accent)' : 'var(--border)' }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{ background: 'white', left: value ? 'calc(100% - 18px)' : '2px' }}
        />
      </div>
    </label>
  );
}
