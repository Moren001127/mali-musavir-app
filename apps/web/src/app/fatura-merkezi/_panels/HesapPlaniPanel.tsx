'use client';

import { BookOpen, Plus, Send } from 'lucide-react';

/* HESAP PLANI — Luca senkron, yeni hesap aç, fatura işlerken eşleştir */
export default function HesapPlaniPanel({ taxpayerId }: { taxpayerId?: string }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Hesap Planı
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {taxpayerId ? 'Seçili mukellef hesap planı' : 'Mükellef seçin'}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Plus size={14} /> Yeni Hesap Aç
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold rounded-lg" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
            <Send size={14} /> Luca'ya Senkronize Et
          </button>
        </div>
      </div>

      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <BookOpen size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
        <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>
          Hesap planı senkronizasyonu
        </h3>
        <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
          Luca'dan mevcut hesap planı çekilir, burada yeni hesap açılır, fatura işlerken eşleştirilir.
          Luca'ya aktarım sırasında olmayan hesaplar Luca'da otomatik açılır. Çift yönlü senkron.
        </p>
      </div>
    </div>
  );
}
