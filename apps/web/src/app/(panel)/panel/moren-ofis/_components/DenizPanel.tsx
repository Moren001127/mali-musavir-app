'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, AlertTriangle, Zap, Wrench, Info, ChevronRight, RefreshCw, Check, X, Clock, Code2 } from 'lucide-react';
import { ofisApi, type OfisProposal } from '@/lib/moren-ofis';
import { portalDevApi } from '@/lib/portal-dev';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const CATEGORY_META: Record<string, { label: string; icon: any; color: string }> = {
  bug: { label: 'Hata', icon: AlertTriangle, color: '#ef4444' },
  perf: { label: 'Performans', icon: Zap, color: '#f59e0b' },
  feature: { label: 'Özellik', icon: Sparkles, color: '#22c55e' },
  maintenance: { label: 'Bakım', icon: Wrench, color: '#60a5fa' },
  info: { label: 'Bilgi', icon: Info, color: '#a78bfa' },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

export function DenizPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>('open');

  const toDevMut = useMutation({
    mutationFn: (proposalId: string) => portalDevApi.fromProposal(proposalId),
    onSuccess: (task) => {
      toast.success('Portal Dev görevine çevrildi', {
        description: 'Geliştirme ekibinin sayfasına yönlendiriliyorsun',
      });
      qc.invalidateQueries({ queryKey: ['ofis-proposals'] });
      setTimeout(() => router.push('/panel/moren-portal-gelistirme'), 800);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });
  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['ofis-proposals', statusFilter],
    queryFn: () => ofisApi.proposals(statusFilter === 'all' ? undefined : statusFilter),
    refetchInterval: 60000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ofisApi.updateProposalStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ofis-proposals'] });
      toast.success('Durum güncellendi');
    },
  });

  const patrolMut = useMutation({
    mutationFn: () => ofisApi.runPatrol(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ofis-proposals'] });
      toast.success('DENİZ devriye tamamlandı');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Patrol hatası'),
  });

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(249,115,22,0.06) 0%, rgba(15,11,21,0.85) 100%)',
        border: '1px solid rgba(249,115,22,0.25)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: '#f97316' }}>
            DENİZ — Sistem Sorumlusu
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            Gece raporları + sistem önerileri + otomatik müdahaleler
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/panel/moren-ofis/rapor"
            className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition hover:opacity-80"
            style={{ background: 'rgba(212,184,118,0.12)', color: '#d4b876', border: '1px solid rgba(212,184,118,0.30)' }}
            title="Son 7 gün için DENİZ raporu — Yazdır/PDF olarak kaydet"
          >
            📄 Haftalık Rapor
          </a>
          <button
            onClick={() => patrolMut.mutate()}
            disabled={patrolMut.isPending}
            className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.35)' }}
          >
            <RefreshCw size={11} className={patrolMut.isPending ? 'animate-spin' : ''} />
            Şimdi Devriye At
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {[
          { key: 'open', label: 'Açık' },
          { key: 'in_progress', label: 'Sürüyor' },
          { key: 'done', label: 'Bitmiş' },
          { key: 'dismissed', label: 'Reddedildi' },
          { key: 'all', label: 'Tümü' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className="px-2.5 py-1 rounded text-[11px] font-semibold"
            style={{
              background: statusFilter === f.key ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.03)',
              color: statusFilter === f.key ? '#f97316' : 'rgba(250,250,249,0.6)',
              border: `1px solid ${statusFilter === f.key ? 'rgba(249,115,22,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Proposals list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {isLoading && (
          <div className="text-center py-6 text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Yükleniyor...
          </div>
        )}
        {!isLoading && proposals.length === 0 && (
          <div className="text-center py-6 text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            DENİZ henüz öneri üretmedi. "Şimdi Devriye At" ile tetikleyebilirsin.
          </div>
        )}
        {proposals.map((p: OfisProposal) => {
          const meta = CATEGORY_META[p.category] || CATEGORY_META.feature;
          const Icon = meta.icon;
          return (
            <div
              key={p.id}
              className="rounded-lg p-3"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${meta.color}22`,
              }}
            >
              <div className="flex items-start gap-2">
                <Icon size={14} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold" style={{ color: '#fafaf9' }}>
                      {p.title}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                      style={{
                        background: `${PRIORITY_COLOR[p.priority]}22`,
                        color: PRIORITY_COLOR[p.priority],
                      }}
                    >
                      {p.priority}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {new Date(p.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs mt-1.5 whitespace-pre-wrap" style={{ color: 'rgba(250,250,249,0.75)' }}>
                    {p.description}
                  </p>
                  {(p.status === 'open' || p.status === 'info') && (
                    <div className="flex gap-1.5 mt-2">
                      {p.status !== 'info' && (
                        <>
                          <button
                            onClick={() => updateMut.mutate({ id: p.id, status: 'in_progress' })}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                            style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}
                          >
                            <Clock size={9} /> Üzerinde çalış
                          </button>
                          <button
                            onClick={() => updateMut.mutate({ id: p.id, status: 'done' })}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                          >
                            <Check size={9} /> Tamamlandı
                          </button>
                          <button
                            onClick={() => updateMut.mutate({ id: p.id, status: 'dismissed' })}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                            style={{ background: 'rgba(239,68,68,0.10)', color: '#fca5a5' }}
                          >
                            <X size={9} /> Reddet
                          </button>
                          {(p.category === 'bug' || p.category === 'perf' || p.category === 'feature' || p.category === 'maintenance') && (
                            <button
                              onClick={() => toDevMut.mutate(p.id)}
                              disabled={toDevMut.isPending}
                              className="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 disabled:opacity-50"
                              style={{ background: 'rgba(212,184,118,0.18)', color: '#d4b876', border: '1px solid rgba(212,184,118,0.35)' }}
                              title="Bu öneriyi Portal Geliştirme ekibine görev olarak aktar"
                            >
                              <Code2 size={9} /> Portal Dev'e Aktar
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
