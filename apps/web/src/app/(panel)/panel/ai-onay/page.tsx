'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, Check, X, Clock, Sparkles, Filter } from 'lucide-react';
import { pendingActionsApi, type PendingAction, type PendingActionStatus, type PendingActionSource } from '@/lib/pending-actions';
import { toast } from 'sonner';

const GOLD = '#d4b876';

const SOURCE_LABEL: Record<string, string> = {
  moren_ofis: 'Moren Ofis',
  portal_dev: 'Portal Geliştirme',
  mukellef_msg: 'Mükellef Mesajı',
  github_merge: 'GitHub Merge',
  migration: 'Migration',
  mobile: 'Mobil',
};

const RISK_COLOR: Record<string, string> = {
  low: '#86efac',
  medium: '#fbbf24',
  high: '#f97316',
  critical: '#ef4444',
};

export default function AiOnayPage() {
  const [statusFilter, setStatusFilter] = useState<PendingActionStatus>('pending');
  const [sourceFilter, setSourceFilter] = useState<PendingActionSource | undefined>();
  const [selected, setSelected] = useState<PendingAction | null>(null);
  const [note, setNote] = useState('');
  const qc = useQueryClient();

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['ai-pending-actions', statusFilter, sourceFilter],
    queryFn: () => pendingActionsApi.list({ status: statusFilter, source: sourceFilter }),
    refetchInterval: 10000,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => pendingActionsApi.approve(id, note || undefined),
    onSuccess: () => {
      toast.success('Onaylandı');
      setSelected(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['ai-pending-actions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => pendingActionsApi.reject(id, note || undefined),
    onSuccess: () => {
      toast.success('Reddedildi');
      setSelected(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['ai-pending-actions'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const pendingCount = list.filter((a) => a.status === 'pending').length;
  const criticalCount = list.filter((a) => a.status === 'pending' && a.riskLevel === 'critical').length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <ShieldCheck size={11} className="inline mr-1" /> AI Onay Merkezi
          </div>
          <h1 className="mt-1" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafaf9' }}>
            AI Onay Kuyruğu
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            AI ekiplerin önerdiği yazma/iletim eylemleri burada onayınızı bekler — tek merkez, tek audit.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {criticalCount > 0 && (
            <span className="px-3 py-2 rounded-md text-[11px] font-bold flex items-center gap-1.5" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.40)' }}>
              <AlertTriangle size={12} /> {criticalCount} kritik
            </span>
          )}
          {pendingCount > 0 && (
            <span className="px-3 py-2 rounded-md text-[11px] font-bold flex items-center gap-1.5" style={{ background: 'rgba(212,184,118,0.15)', color: GOLD, border: '1px solid rgba(212,184,118,0.40)' }}>
              <Clock size={12} /> {pendingCount} bekleyen
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center text-[11px]">
        <Filter size={12} style={{ color: 'rgba(250,250,249,0.55)' }} />
        {(['pending', 'approved', 'rejected', 'applied', 'failed', 'expired'] as PendingActionStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="px-2.5 py-1 rounded uppercase tracking-wider font-bold transition"
            style={{
              background: statusFilter === s ? `${GOLD}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${statusFilter === s ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`,
              color: statusFilter === s ? GOLD : 'rgba(250,250,249,0.55)',
            }}
          >
            {s === 'pending' ? 'Bekleyen' : s === 'approved' ? 'Onaylı' : s === 'rejected' ? 'Reddedildi' : s === 'applied' ? 'Uygulandı' : s === 'failed' ? 'Başarısız' : 'Süresi Dolmuş'}
          </button>
        ))}
        <span className="mx-1" style={{ color: 'rgba(250,250,249,0.3)' }}>·</span>
        <button
          onClick={() => setSourceFilter(undefined)}
          className="px-2.5 py-1 rounded uppercase tracking-wider font-bold transition"
          style={{
            background: !sourceFilter ? `${GOLD}22` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${!sourceFilter ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`,
            color: !sourceFilter ? GOLD : 'rgba(250,250,249,0.55)',
          }}
        >
          Hepsi
        </button>
        {Object.entries(SOURCE_LABEL).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSourceFilter(k as PendingActionSource)}
            className="px-2.5 py-1 rounded uppercase tracking-wider font-bold transition"
            style={{
              background: sourceFilter === k ? `${GOLD}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${sourceFilter === k ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`,
              color: sourceFilter === k ? GOLD : 'rgba(250,250,249,0.55)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)', minHeight: 380 }}>
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor...</div>
        ) : list.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Sparkles size={32} style={{ color: GOLD, opacity: 0.4, margin: '0 auto' }} />
            <div className="text-sm" style={{ color: 'rgba(250,250,249,0.55)' }}>
              {statusFilter === 'pending' ? 'Bekleyen onay yok' : 'Kayıt bulunamadı'}
            </div>
            <div className="text-xs" style={{ color: 'rgba(250,250,249,0.35)' }}>
              AI ekipler yazma/iletim eylemi önerirse burada görünür.
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {list.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)} className="w-full text-left px-4 py-3 transition flex items-start gap-3 hover:bg-white/[0.02]">
                <div className="w-1 h-12 rounded-full flex-shrink-0" style={{ background: RISK_COLOR[a.riskLevel] || RISK_COLOR.low }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-[.12em] px-1.5 py-[2px] rounded" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}>
                      {SOURCE_LABEL[a.source] || a.source}
                    </span>
                    {a.requestedByAgent && (
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
                        {a.requestedByAgent}
                      </span>
                    )}
                    <span className="text-[9.5px] uppercase font-bold px-1.5 py-[2px] rounded" style={{ background: `${RISK_COLOR[a.riskLevel]}20`, color: RISK_COLOR[a.riskLevel] }}>
                      {a.riskLevel}
                    </span>
                    <span className="text-[10px] ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {new Date(a.requestedAt).toLocaleString('tr-TR')}
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: '#fafaf9' }}>{a.title}</p>
                  <p className="text-[11.5px] line-clamp-2" style={{ color: 'rgba(250,250,249,0.65)' }}>{a.summary}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setSelected(null)}>
          <div className="rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.98) 100%)', border: '1px solid rgba(212,184,118,0.30)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-[.14em] px-2 py-[2px] rounded" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}>
                  {SOURCE_LABEL[selected.source] || selected.source}
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-[2px] rounded" style={{ background: `${RISK_COLOR[selected.riskLevel]}20`, color: RISK_COLOR[selected.riskLevel] }}>
                  {selected.riskLevel} risk
                </span>
              </div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: '#fafaf9', letterSpacing: '-0.02em' }}>
                {selected.title}
              </h2>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5" style={{ color: GOLD }}>Özet</p>
                <p className="text-[13px] whitespace-pre-wrap" style={{ color: 'rgba(250,250,249,0.85)' }}>{selected.summary}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5" style={{ color: GOLD }}>Payload</p>
                <pre className="text-[11px] p-3 rounded overflow-x-auto" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.75)' }}>
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>
              {selected.status === 'pending' && (
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5" style={{ color: GOLD }}>Not (opsiyonel)</p>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Onay/red gerekçeni yaz..." rows={2} className="w-full px-3 py-2 rounded text-[12px] outline-none" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }} />
                </div>
              )}
              {selected.reviewNote && (
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-[.14em] mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Önceki not</p>
                  <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.65)' }}>{selected.reviewNote}</p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}>
              <button onClick={() => setSelected(null)} className="px-3 py-2 rounded text-[12px] font-semibold" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.65)' }}>
                Kapat
              </button>
              {selected.status === 'pending' && (
                <>
                  <button onClick={() => rejectMut.mutate(selected.id)} disabled={rejectMut.isPending} className="px-3 py-2 rounded text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.30)' }}>
                    <X size={13} /> Reddet
                  </button>
                  <button onClick={() => approveMut.mutate(selected.id)} disabled={approveMut.isPending} className="px-3 py-2 rounded text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
                    <Check size={13} /> Onayla
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
