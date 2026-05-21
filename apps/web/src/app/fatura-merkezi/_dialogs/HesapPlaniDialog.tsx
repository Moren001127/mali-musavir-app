'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, X, Plus, RefreshCw, Send, Search, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   HESAP PLANI DIALOG — Mihsap'taki yaklaşım.
   - Luca'dan mevcut hesap planı çekilir
   - Yeni hesap açılır → senkronize edilir → Luca'da otomatik açılır
   - Filtre + arama
   ════════════════════════════════════════════════════════════════════ */

type Props = { taxpayer: any; onClose: () => void };

export default function HesapPlaniDialog({ taxpayer, onClose }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const planQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayer.id],
    queryFn: () => api
      .get('/account-plan', { params: { taxpayerId: taxpayer.id } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data.items || []))
      .catch(() => []),
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      return api.post('/account-plan/refresh', { taxpayerId: taxpayer.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] }),
  });

  const pushMut = useMutation({
    mutationFn: async () => {
      return api.post('/account-plan/push-to-luca', { taxpayerId: taxpayer.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] }),
  });

  const items: any[] = planQ.data || [];

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) =>
      String(i.code || '').includes(q) ||
      (i.name || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const unsynced = items.filter((i) => i.syncedToLuca === false || i.local === true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
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
              disabled={refreshMut.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-lg"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Luca'dan hesap planını yeniden çek"
            >
              <RefreshCw size={13} className={refreshMut.isPending ? 'animate-spin' : ''} />
              Luca'dan Çek
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
      return api.post('/account-plan', { taxpayerId, code, name });
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
