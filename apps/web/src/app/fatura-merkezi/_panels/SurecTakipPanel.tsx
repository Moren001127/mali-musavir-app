'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Workflow, CheckCircle2, Search, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName, taxpayerSearchMatch } from '../_lib/taxpayer';

/* SÜREÇ TAKİBİ — Bir mükellefin dönemde hangi aşamada olduğunu gösterir.
   Aşamalar (bir sonrakine geçmek için öncekinin biter olması gerekir):
     1) Onay Bekliyor    → e-Arşiv/yüklenen ama henüz onaylanmamış faturası var
     2) Belge Yok        → Bu döneme ait hiç belge gelmemiş
     3) Aktarım Bekliyor → Faturalar onaylanmış ama Luca'ya gönderilmemiş
     4) Tamamlandı       → Faturalar Luca'ya başarıyla atılmış */
export default function SurecTakipPanel({ period, taxpayers }: { period: string; taxpayers: Array<any> }) {
  const [stage, setStage] = useState<'pending' | 'report' | 'review' | 'done'>('pending');
  const [search, setSearch] = useState('');

  const summaryQ = useQuery({
    queryKey: ['fatura-merkezi', 'per-taxpayer-summary', period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
      .then((r) => Array.isArray(r.data) ? r.data : []),
  });

  const summaryMap = new Map((summaryQ.data || []).map((s: any) => [s.taxpayerId, s]));

  const enriched = useMemo(() => taxpayers.map((t) => {
    const s: any = summaryMap.get(t.id) || {};
    // Banka kullanılmıyor — sadece alış+satış
    const pending = (s.pendingAlis || 0) + (s.pendingSatis || 0);
    const approved = (s.approvedAlis || 0) + (s.approvedSatis || 0);
    const posted = s.postedToLuca || 0;
    return { ...t, pending, approved, posted };
  }), [taxpayers, summaryMap]);

  const buckets = useMemo(() => ({
    pending: enriched.filter((t) => t.pending > 0),
    report:  enriched.filter((t) => t.pending === 0 && t.approved === 0 && t.posted === 0),
    review:  enriched.filter((t) => t.pending === 0 && t.approved > 0 && t.posted === 0),
    done:    enriched.filter((t) => t.posted > 0),
  }), [enriched]);

  const currentList = buckets[stage].filter((t) => !search || taxpayerSearchMatch(t, search));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Süreç Takibi
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Dönem {period} · {taxpayers.length} mukellef · Hangi mükellefte ne kaldı tek bakışta
        </div>
      </div>

      {/* 4 aşama — sıralı iş akışı (soldan sağa) */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stage
          step="1"
          label="Onay Bekliyor"
          desc="Faturası gelmiş ama henüz onaylanmamış"
          count={buckets.pending.length}
          tone="#ef4444"
          active={stage === 'pending'}
          onClick={() => setStage('pending')}
        />
        <Stage
          step="2"
          label="Belge Yok"
          desc="Bu döneme ait hiç fatura çekilmemiş"
          count={buckets.report.length}
          tone="#f59e0b"
          active={stage === 'report'}
          onClick={() => setStage('report')}
        />
        <Stage
          step="3"
          label="Aktarım Bekliyor"
          desc="Onaylanmış ama Luca'ya gönderilmemiş"
          count={buckets.review.length}
          tone="#60a5fa"
          active={stage === 'review'}
          onClick={() => setStage('review')}
        />
        <Stage
          step="4"
          label="Tamamlandı"
          desc="Faturalar Luca'ya başarıyla atıldı"
          count={buckets.done.length}
          tone="#10b981"
          active={stage === 'done'}
          onClick={() => setStage('done')}
        />
      </div>

      {/* Arama */}
      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--text-muted)' }} />
        <input
          placeholder="Mukellef ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: 'var(--text)' }}
        />
      </div>

      {/* Liste */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>MÜKELLEF</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: '#f59e0b' }}>BEKLEYEN</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: '#10b981' }}>ONAYLANAN</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: '#a78bfa' }}>LUCA</th>
              <th className="text-right px-3 py-2.5 text-[10.5px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>DURUM</th>
            </tr>
          </thead>
          <tbody>
            {summaryQ.isLoading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>Yükleniyor...</td></tr>
            )}
            {!summaryQ.isLoading && currentList.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Bu aşamada mukellef yok.
              </td></tr>
            )}
            {currentList.map((t, idx) => (
              <tr key={t.id} style={{ borderBottom: idx === currentList.length - 1 ? 'none' : '1px solid var(--border-soft)' }}>
                <td className="px-4 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text)' }}>{taxpayerName(t)}</td>
                <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums" style={{ color: t.pending ? '#f59e0b' : 'var(--text-light)' }}>{t.pending}</td>
                <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums" style={{ color: t.approved ? '#10b981' : 'var(--text-light)' }}>{t.approved}</td>
                <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums" style={{ color: t.posted ? '#a78bfa' : 'var(--text-light)' }}>{t.posted}</td>
                <td className="px-3 py-2.5 text-right">
                  <StageBadge stage={stage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 rounded-lg text-[11.5px] leading-relaxed" style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--accent)' }}>İş akışı:</strong>{' '}
        Her mükellef her dönemde 4 aşamadan birinde bulunur. Sırasıyla:
        <span style={{ color: '#ef4444' }}> Onay Bekliyor</span> (faturalar geldi, onayı bekleniyor) →
        <span style={{ color: '#f59e0b' }}> Belge Yok</span> (mükellefin bu ay hiç faturası gelmedi) →
        <span style={{ color: '#60a5fa' }}> Aktarım Bekliyor</span> (onaylandı, Luca'ya gönderilmeyi bekliyor) →
        <span style={{ color: '#10b981' }}> Tamamlandı</span> (Luca'ya gitti, dönem kapanmış sayılır).
        Mükellefler otomatik geçer; manuel müdahale gerekmez.
      </div>
    </div>
  );
}

function Stage({ step, label, desc, count, tone, active, onClick }: { step: string; label: string; desc: string; count: number; tone: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl p-4 text-left transition-all"
      style={{
        background: active ? `${tone}10` : 'var(--surface)',
        border: `1px solid ${active ? `${tone}60` : 'var(--border)'}`,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold tabular-nums"
          style={{ background: `${tone}28`, color: tone, border: `1px solid ${tone}55` }}
        >
          {step}
        </span>
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: active ? tone : 'var(--text)' }}>
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{count}</div>
        <div className="text-[10px] tabular-nums" style={{ color: 'var(--text-light)' }}>mukellef</div>
      </div>
      <div className="text-[10.5px] mt-2 leading-snug" style={{ color: 'var(--text-secondary)' }}>{desc}</div>
    </button>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const map = {
    pending: { label: 'Onay Bekliyor', color: '#ef4444' },
    report:  { label: 'Belge Yok', color: '#f59e0b' },
    review:  { label: 'Aktarım Bekliyor', color: '#60a5fa' },
    done:    { label: 'Tamamlandı', color: '#10b981' },
  } as const;
  const info = (map as any)[stage] || map.pending;
  return (
    <span className="px-2 py-0.5 rounded-md text-[10.5px] font-medium" style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}40` }}>
      {info.label}
    </span>
  );
}
