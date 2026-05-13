'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Plus, X, Trash2, Search, Star, Loader2, Sparkles } from 'lucide-react';
import { ofisApi, type MorenFact } from '@/lib/moren-ofis';
import { toast } from 'sonner';

const GOLD = '#d4b876';

export default function MorenOfisHafizaPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: '', predicate: '', object: '', importance: 5 });
  const qc = useQueryClient();

  const { data: facts = [], isLoading } = useQuery({
    queryKey: ['moren-facts'],
    queryFn: () => ofisApi.facts(),
    refetchInterval: 30_000,
  });

  const filtered = facts.filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLocaleLowerCase('tr');
    return (
      f.subject.toLocaleLowerCase('tr').includes(q) ||
      f.predicate.toLocaleLowerCase('tr').includes(q) ||
      f.object.toLocaleLowerCase('tr').includes(q)
    );
  });

  // Subject'e göre grupla
  const grouped: Record<string, MorenFact[]> = {};
  for (const f of filtered) {
    if (!grouped[f.subject]) grouped[f.subject] = [];
    grouped[f.subject].push(f);
  }

  const createMut = useMutation({
    mutationFn: () => ofisApi.upsertFact(form),
    onSuccess: () => {
      toast.success('Bilgi kaydedildi');
      setForm({ subject: '', predicate: '', object: '', importance: 5 });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['moren-facts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ofisApi.deleteFact(id),
    onSuccess: () => {
      toast.success('Silindi');
      qc.invalidateQueries({ queryKey: ['moren-facts'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Brain size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1 className="mt-1" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafaf9' }}>
            Ekip Hafızası
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            Moren AI ekibinin bildiği kalıcı gerçekler — her konuşmaya otomatik enjekte olur. Yanlış varsa sil.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-3 py-2 rounded-md text-xs font-bold flex items-center gap-1.5"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
        >
          <Plus size={13} /> Yeni Bilgi
        </button>
      </div>

      {/* Arama */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(212,184,118,0.20)' }}>
        <Search size={13} style={{ color: 'rgba(250,250,249,0.55)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Konu, alan veya değer ile ara..."
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: '#fafaf9' }}
        />
        <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {filtered.length}/{facts.length}
        </span>
      </div>

      {/* Yeni bilgi formu */}
      {showForm && (
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.30)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>
              Yeni Bilgi (Subject · Predicate · Object)
            </h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-white/5">
              <X size={14} style={{ color: 'rgba(250,250,249,0.55)' }} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Kim/ne hakkında? (örn. Petravet)"
              className="px-3 py-2 rounded text-[13px] outline-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }}
            />
            <input
              value={form.predicate}
              onChange={(e) => setForm({ ...form, predicate: e.target.value })}
              placeholder="Hangi alan? (örn. iletişim_tercihi)"
              className="px-3 py-2 rounded text-[13px] outline-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }}
            />
            <input
              value={form.object}
              onChange={(e) => setForm({ ...form, object: e.target.value })}
              placeholder="Değer? (örn. WhatsApp)"
              className="px-3 py-2 rounded text-[13px] outline-none"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: '#fafaf9' }}
            />
          </div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
              Önem: <span style={{ color: GOLD, fontWeight: 700 }}>{form.importance}</span>/10
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={form.importance}
              onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })}
              className="flex-1"
            />
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={!form.subject.trim() || !form.predicate.trim() || !form.object.trim() || createMut.isPending}
            className="px-3 py-2 rounded text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Kaydet
          </button>
        </div>
      )}

      {/* Liste — subject'e göre gruplu */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)', minHeight: 320 }}>
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>Yükleniyor...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Sparkles size={32} style={{ color: GOLD, opacity: 0.4, margin: '0 auto' }} />
            <div className="text-sm" style={{ color: 'rgba(250,250,249,0.55)' }}>
              {search ? 'Eşleşen kayıt yok' : 'Henüz hafızada bilgi yok'}
            </div>
            <div className="text-xs" style={{ color: 'rgba(250,250,249,0.35)' }}>
              Konuşma sürdükçe ekip otomatik bilgi çıkarır.
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {Object.entries(grouped).map(([subject, items]) => (
              <div key={subject} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] uppercase font-bold tracking-[.14em]" style={{ color: GOLD }}>
                    {subject}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {items.length} bilgi
                  </span>
                </div>
                <div className="space-y-1.5">
                  {items.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-[12px]"
                      style={{
                        background: f.importance >= 8 ? `${GOLD}10` : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${f.importance >= 8 ? `${GOLD}30` : 'rgba(255,255,255,0.05)'}`,
                      }}
                    >
                      <span className="font-mono" style={{ color: 'rgba(250,250,249,0.55)' }}>
                        {f.predicate}
                      </span>
                      <span style={{ color: 'rgba(250,250,249,0.4)' }}>=</span>
                      <span style={{ color: '#fafaf9' }}>{f.object}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <Star size={10} style={{ color: f.importance >= 8 ? GOLD : 'rgba(250,250,249,0.4)' }} fill={f.importance >= 8 ? GOLD : 'none'} />
                        <span className="text-[10px] font-mono" style={{ color: 'rgba(250,250,249,0.5)' }}>
                          {f.importance}
                        </span>
                        {f.source && (
                          <span
                            className="text-[9px] uppercase tracking-wider ml-1 px-1 py-[1px] rounded"
                            style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.45)' }}
                            title={f.source}
                          >
                            {f.source.slice(0, 8)}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`"${f.subject} → ${f.predicate} → ${f.object}" bilgisini silmek istiyor musun?`)) {
                              deleteMut.mutate(f.id);
                            }
                          }}
                          className="p-1 rounded hover:bg-white/5 ml-1"
                          style={{ color: 'rgba(250,250,249,0.45)' }}
                          title="Sil"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
