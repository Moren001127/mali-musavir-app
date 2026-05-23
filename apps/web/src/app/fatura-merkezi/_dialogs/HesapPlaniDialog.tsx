'use client';

import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, X, Plus, RefreshCw, Send, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   HESAP PLANI DIALOG — Mihsap'taki yaklaşım.
   - Luca'dan mevcut hesap planı çekilir
   - Yeni hesap açılır → senkronize edilir → Luca'da otomatik açılır
   - Filtre + arama
   ════════════════════════════════════════════════════════════════════ */

type Props = { taxpayer: any; onClose: () => void };

function jobLogLines(errorMsg?: string | null) {
  return String(errorMsg || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
}

function jobStatusLabel(status?: string | null) {
  if (status === 'done') return 'Tamamlandı';
  if (status === 'failed') return 'Hata';
  if (status === 'cancelled') return 'İptal';
  if (status === 'running') return 'Çekiliyor';
  return 'Sırada';
}

export default function HesapPlaniDialog({ taxpayer, onClose }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [queuedJob, setQueuedJob] = useState<any>(null);

  const planQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayer.id],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId: taxpayer.id, limit: 1000 } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data.accounts || r.data.items || [])),
  });

  const jobQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan-job', queuedJob?.id],
    enabled: !!queuedJob?.id,
    queryFn: () => api.get(`/luca/jobs/${queuedJob.id}`).then((r) => r.data),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.status || queuedJob?.status;
      return !status || status === 'pending' || status === 'running' ? 2000 : false;
    },
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      return api.post('/fatura-muhasebelestirme/account-plan/refresh', { taxpayerId: taxpayer.id });
    },
    onSuccess: (resp) => {
      setQueuedJob(resp.data?.job || resp.data || {});
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] });
    },
  });

  const pushMut = useMutation({
    mutationFn: async () => {
      return api.post('/fatura-muhasebelestirme/account-plan/push-to-luca', { taxpayerId: taxpayer.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] }),
  });

  const items: any[] = planQ.data || [];
  const trackedJob = jobQ.data || queuedJob;
  const trackedJobStatus = trackedJob?.status as string | undefined;
  const trackedJobActive = trackedJobStatus === 'pending' || trackedJobStatus === 'running';
  const trackedJobLogs = jobLogLines(trackedJob?.errorMsg);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) =>
      String(i.code || '').includes(q) ||
      (i.name || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const unsynced = items.filter((i) => i.syncedToLuca === false || i.local === true);

  useEffect(() => {
    if (trackedJobStatus === 'done') {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan', taxpayer.id] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] });
    }
  }, [trackedJobStatus, qc, taxpayer.id]);

  const cancelJobMut = useMutation({
    mutationFn: (jobId: string) => api.post(`/luca/jobs/${jobId}/cancel`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan-job', queuedJob?.id] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#a78bfa20', color: '#a78bfa' }}>
              <BookOpen size={18} />
            </div>
            <div>
              <div className="text-[15.5px] font-semibold" style={{ color: 'var(--text)' }}>Hesap Planı</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{taxpayerName(taxpayer)}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Üst aksiyon barı */}
          <div className="flex gap-2 mb-4">
            <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <Search size={14} style={{ color: 'var(--text-muted)' }} />
              <input
                placeholder="Hesap kodu veya açıklama..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px]"
                style={{ color: 'var(--text)' }}
              />
            </div>

            <button
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending || trackedJobActive}
              className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Luca'dan hesap planını yeniden çek"
            >
              <RefreshCw size={13} className={refreshMut.isPending || trackedJobActive ? 'animate-spin' : ''} />
              {trackedJobActive ? 'Çekiliyor...' : "Luca'dan Çek"}
            </button>

            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <Plus size={13} />
              Yeni Hesap
            </button>

            {unsynced.length > 0 && (
              <button
                onClick={() => pushMut.mutate()}
                disabled={pushMut.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold rounded-lg"
                style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                title={`${unsynced.length} yeni hesap Luca'ya gönderilecek`}
              >
                {pushMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Luca'ya Gönder ({unsynced.length})
              </button>
            )}
          </div>

          {showAddForm && (
            <AddAccountForm
              taxpayerId={taxpayer.id}
              onSaved={() => {
                setShowAddForm(false);
                qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] });
              }}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {(queuedJob || refreshMut.error || planQ.error || pushMut.error) && (
            <div
              className="mb-4 rounded-xl px-3 py-2 text-[12px]"
              style={{
                background: refreshMut.error || planQ.error || pushMut.error ? '#ef444415' : '#a78bfa12',
                border: `1px solid ${refreshMut.error || planQ.error || pushMut.error ? '#ef444455' : '#a78bfa45'}`,
                color: refreshMut.error || planQ.error || pushMut.error ? '#fca5a5' : '#c4b5fd',
              }}
            >
              {queuedJob && !trackedJob?.errorMsg && (
                <span>
                  Luca hesap planı çekimi kuyruğa alındı. Loglar burada canlı görünecek.
                  {queuedJob.id ? <span className="ml-1 font-mono opacity-70">#{String(queuedJob.id).slice(0, 8)}</span> : null}
                </span>
              )}
              {refreshMut.error && ((refreshMut.error as any)?.response?.data?.message || 'Luca hesap planı çekimi başlatılamadı.')}
              {planQ.error && ((planQ.error as any)?.response?.data?.message || 'Hesap planı okunamadı.')}
              {pushMut.error && ((pushMut.error as any)?.response?.data?.message || 'Luca aktarımı başlatılamadı.')}
            </div>
          )}

          {trackedJob?.id && (
            <div
              className="mb-4 rounded-xl overflow-hidden"
              style={{
                background: trackedJobStatus === 'failed' ? '#ef444410' : trackedJobStatus === 'done' ? '#10b98110' : '#a78bfa10',
                border: `1px solid ${trackedJobStatus === 'failed' ? '#ef444455' : trackedJobStatus === 'done' ? '#10b98155' : '#a78bfa45'}`,
              }}
            >
              <div className="px-3 py-2 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {trackedJobStatus === 'done' ? (
                    <CheckCircle2 size={15} style={{ color: '#10b981' }} />
                  ) : trackedJobStatus === 'failed' ? (
                    <AlertCircle size={15} style={{ color: '#f87171' }} />
                  ) : (
                    <Loader2 size={15} className="animate-spin" style={{ color: '#c4b5fd' }} />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
                      Luca çekim günlüğü · {jobStatusLabel(trackedJobStatus)}
                    </div>
                    <div className="text-[10.5px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      #{String(trackedJob.id).slice(0, 8)}
                      {typeof trackedJob.recordCount === 'number' && trackedJobStatus === 'done' ? ` · ${trackedJob.recordCount} hesap` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {trackedJobActive && (
                    <button
                      type="button"
                      onClick={() => cancelJobMut.mutate(trackedJob.id)}
                      disabled={cancelJobMut.isPending}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
                      style={{ color: '#fca5a5', border: '1px solid #ef444455', background: '#ef444410' }}
                    >
                      İptal
                    </button>
                  )}
                </div>
              </div>
              <div className="px-3 py-2 max-h-40 overflow-y-auto space-y-1">
                {trackedJobLogs.length > 0 ? trackedJobLogs.map((line, idx) => (
                  <div
                    key={`${idx}-${line}`}
                    className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap"
                    style={{ color: line.includes('✅') || line.includes('✓') ? '#6ee7b7' : line.includes('hata') || line.includes('failed') || line.includes('X ') ? '#fca5a5' : '#d6d3d1' }}
                  >
                    {line}
                  </div>
                )) : (
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Ajan sırayı alınca ilk log burada görünecek.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Liste */}
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', maxHeight: 420 }}>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="w-full">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)', zIndex: 1 }}>
                  <tr>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>HESAP KODU</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>AÇIKLAMA</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>DURUM</th>
                  </tr>
                </thead>
                <tbody>
                  {planQ.isLoading && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}><Loader2 size={14} className="inline mr-1 animate-spin" /> Yükleniyor...</td></tr>
                  )}
                  {!planQ.isLoading && filtered.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{search ? 'Eşleşme yok' : 'Hesap planı boş — Luca\'dan çek butonuna bas'}</td></tr>
                  )}
                  {filtered.map((i: any, idx: number) => (
                    <tr key={i.id || `${i.code}-${idx}`} style={{ borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border-soft)' }}>
                      <td className="px-3 py-2 text-[12.5px] font-mono" style={{ color: 'var(--text)' }}>{i.code}</td>
                      <td className="px-3 py-2 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>{i.name}</td>
                      <td className="px-3 py-2 text-right">
                        {i.syncedToLuca === false || i.local ? (
                          <span className="px-2 py-0.5 text-[10.5px] font-medium rounded-md" style={{ background: '#f59e0b15', color: '#f59e0b' }}>
                            Lokal · gönderilecek
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10.5px] font-medium rounded-md" style={{ background: '#10b98115', color: '#10b981' }}>
                            ✓ Luca senkron
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Akış:</strong> Burada açtığın yeni hesaplar, fatura işlerken eşleştirilir. Luca'ya aktarım sırasında otomatik olarak Luca'da da açılır — sen tek tek hesap kodu girmek zorunda kalmazsın.
          </div>
        </div>
      </div>
    </div>
  );
}

function AddAccountForm({ taxpayerId, onSaved, onCancel }: { taxpayerId: string; onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const saveMut = useMutation({
    mutationFn: async () => {
      return api.post('/fatura-muhasebelestirme/account-plan', { taxpayerId, code, name });
    },
    onSuccess: () => onSaved(),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }}
      className="mb-4 p-4 rounded-xl"
      style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)' }}
    >
      <div className="flex gap-2">
        <input
          placeholder="Hesap kodu (örn. 153.01.01)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="flex-1 px-3 py-2 text-[13px] outline-none rounded-lg font-mono"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
        />
        <input
          placeholder="Açıklama"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1 px-3 py-2 text-[13px] outline-none rounded-lg"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
        />
        <button
          type="submit"
          disabled={saveMut.isPending}
          className="flex items-center gap-1 px-3 py-2 text-[12.5px] font-semibold rounded-lg"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Ekle
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-[12.5px] rounded-lg"
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          İptal
        </button>
      </div>
    </form>
  );
}
