'use client';

import { Upload, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

/* YÜKLENEN FATURALAR — ham dosya pipeline durumu
   Mihsap referansı: "Bu menü sadece yüklediğiniz dosyaların durumunu incelemek içindir"
   Sütunlar: Mukellef, Dosya Adı, Yükleme Tarihi, Fatura Türü, Tarama Durumu, İşlemler */
export default function YuklenenlerPanel({ taxpayerId, period }: { taxpayerId?: string; period: string }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Yüklenen Faturalar — Pipeline
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          OCR taraması bekleyen, taranan ve hata alan ham dosyalar
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <PipelineStat label="Taranmayı Bekleyen" value={0} tone="#f59e0b" icon={Clock} />
        <PipelineStat label="Başarıyla Taranan"    value={0} tone="#10b981" icon={CheckCircle2} />
        <PipelineStat label="Hata Alan"             value={0} tone="#ef4444" icon={AlertTriangle} />
      </div>

      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Upload size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
        <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>OCR pipeline durumu</h3>
        <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
          Buradan ham dosya tarama durumu izlenir. İşlenmiş faturaları görmek için &quot;Gelen Belgeler&quot;e geçin.
        </p>
      </div>
    </div>
  );
}

function PipelineStat({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: React.ComponentType<{ size?: number }> }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 rounded-lg" style={{ background: `${tone}18`, color: tone }}><Icon size={15} /></div>
        <div className="text-[10px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>{label.toUpperCase()}</div>
      </div>
      <div className="text-[28px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{value}</div>
    </div>
  );
}
