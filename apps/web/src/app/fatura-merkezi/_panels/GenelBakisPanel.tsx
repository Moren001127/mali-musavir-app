'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox, CheckCircle2, AlertTriangle, Send, FileText, Users, TrendingUp, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';

type Props = {
  taxpayerId?: string;
  period: string;
  taxpayers: Array<any>;
};

/* ════════════════════════════════════════════════════════════════════
   GENEL BAKIŞ — Mihsap'taki "Genel Bakış" dashboard'ının Moren versiyonu
   ════════════════════════════════════════════════════════════════════ */
export default function GenelBakisPanel({ taxpayerId, period, taxpayers }: Props) {
  const summary = useQuery({
    queryKey: ['fatura-merkezi', 'overview', taxpayerId, period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/summary', {
        params: { taxpayerId, period },
      })
      .then((r) => r.data)
      .catch(() => ({})),
  });

  const data = summary.data || {};

  const stats = [
    { label: 'Toplam Mükellef',  value: taxpayers.length,             icon: Users,        tone: '#d4b876' },
    { label: 'Bekleyen Belge',    value: data.pending ?? 0,             icon: Inbox,        tone: '#f59e0b' },
    { label: 'Onaylanan',          value: data.approved ?? 0,            icon: CheckCircle2, tone: '#10b981' },
    { label: 'Hata',               value: data.errors ?? 0,              icon: AlertTriangle, tone: '#ef4444' },
    { label: 'Luca\'ya Aktarılan',  value: data.posted ?? 0,              icon: Send,         tone: '#a78bfa' },
    { label: 'OCR Pipeline',        value: data.ocrInProgress ?? 0,        icon: Sparkles,     tone: '#60a5fa' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Genel Bakış
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {taxpayerId
            ? taxpayers.find((t) => t.id === taxpayerId)?.name
            : `Tüm mükellefler · ${taxpayers.length} kayıt`}
        </div>
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-xl p-4 transition-colors"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between mb-2">
                <div
                  className="p-2 rounded-lg"
                  style={{ background: `${s.tone}18`, color: s.tone }}
                >
                  <Icon size={16} />
                </div>
                <div className="text-[10px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>
                  {s.label.toUpperCase()}
                </div>
              </div>
              <div
                className="text-[28px] font-semibold tabular-nums"
                style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}
              >
                {s.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Yapılacak işler / akış göstergesi */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Bu Ay Performans
            </div>
          </div>
          <ProgressLine label="Çekilen → İşlenen" value={data.processedRate ?? 0} />
          <ProgressLine label="İşlenen → Onay"       value={data.approvalRate ?? 0} />
          <ProgressLine label="Onay → Luca"           value={data.postedRate ?? 0} />
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <FileText size={15} style={{ color: 'var(--accent)' }} />
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Hızlı Aksiyonlar
            </div>
          </div>
          <div className="space-y-2">
            <QuickAction label="Bekleyen belgeleri onayla" desc="OCR'dan geçmiş, mali müşavir gözden geçirmesi bekleniyor" />
            <QuickAction label="Talimat olmayan mukellefleri tamamla" desc="Otomatik fatura çekimi için talimat ver" />
            <QuickAction label="Luca'ya aktarımı bekleyenleri gönder" desc="Toplu Excel — tek tıkla" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-[11.5px] mb-1">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-semibold" style={{ color: 'var(--accent)' }}>%{pct}</span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--accent)' }}
        />
      </div>
    </div>
  );
}

function QuickAction({ label, desc }: { label: string; desc: string }) {
  return (
    <button
      type="button"
      className="w-full text-left p-3 rounded-lg transition-all"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div className="text-[12.5px] font-semibold mb-0.5" style={{ color: 'var(--text)' }}>{label}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</div>
    </button>
  );
}
