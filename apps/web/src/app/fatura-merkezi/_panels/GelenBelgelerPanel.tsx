'use client';

import { Inbox } from 'lucide-react';

type Props = { taxpayerId?: string; period: string };

/* GELEN BELGELER — Per-mukellef özet tablosu + detay drill-down
   Mihsap referansı: kolonlar = Firma · Defter · Bekleyen Alış · Bekleyen Satış · Bekleyen Banka · Onaylanan Faturalar · Onaylanan Banka */
export default function GelenBelgelerPanel({ taxpayerId, period }: Props) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Gelen Belgeler
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {taxpayerId ? 'Seçili mukellef için' : 'Tüm mukellefler'} · Dönem {period}
        </div>
      </div>

      <Placeholder
        title="Gelen Belgeler özet tablosu"
        body="Her mukellef için Bekleyen Alış/Satış/Banka ve Onaylanan sayıları tek tabloda gösterilecek. Detayına tıklayınca PDF + form yan yana açılacak (F8/F9 keyboard, Toplu Onayla)."
      />
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl p-8 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <Inbox size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
      <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>{title}</h3>
      <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>{body}</p>
    </div>
  );
}
