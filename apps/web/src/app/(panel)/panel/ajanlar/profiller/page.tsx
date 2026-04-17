'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Save, Trash2, Bot } from 'lucide-react';
import { toast } from 'sonner';

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}
interface Rule {
  id: string;
  mukellef: string;
  profile: { talimat?: string } | any;
}

function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function ProfillerPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [talimat, setTalimat] = useState('');
  const [search, setSearch] = useState('');

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });
  const { data: rules = [] } = useQuery({
    queryKey: ['agent-rules'],
    queryFn: () => api.get('/agent/rules').then((r) => r.data as Rule[]),
  });

  const upsert = useMutation({
    mutationFn: (data: { mukellef: string; talimat: string }) =>
      api.put(`/agent/rules/${encodeURIComponent(data.mukellef)}`, {
        profile: { talimat: data.talimat },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      toast.success('Profil kaydedildi');
    },
    onError: () => toast.error('Kayıt başarısız'),
  });

  const del = useMutation({
    mutationFn: (m: string) => api.delete(`/agent/rules/${encodeURIComponent(m)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      toast.success('Silindi');
      setSelected(null);
      setTalimat('');
    },
  });

  const ruleMap = new Map(rules.map((r) => [r.mukellef, r]));
  const filtered = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(search.toLowerCase()),
  );

  const selectTaxpayer = (name: string) => {
    setSelected(name);
    setTalimat(ruleMap.get(name)?.profile?.talimat || '');
  };

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ajan</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Mükellef Profilleri
          </h1>
          <p className="text-[13px] mt-1.5 max-w-2xl" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Her mükellef için Claude'a özel talimat yazın. Fatura işlenirken bu talimatlar agent'a ek context olarak verilir.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sol: Mükellef listesi */}
        <div
          className="rounded-xl border p-3"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef ara…"
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none mb-2"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
          />
          <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
            {filtered.map((t) => {
              const name = taxpayerName(t);
              const has = ruleMap.has(name);
              const active = selected === name;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTaxpayer(name)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                  style={{
                    background: active ? 'rgba(55,48,163,.1)' : 'transparent',
                    color: active ? '#3730a3' : '#fafaf9',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {has && <Bot size={13} style={{ color: '#059669' }} />}
                  <span className="flex-1 truncate">{name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-xs p-3 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Sonuç yok
              </div>
            )}
          </div>
        </div>

        {/* Sağ: Talimat editör */}
        <div
          className="md:col-span-2 rounded-xl border p-5"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          {!selected ? (
            <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Sol listeden mükellef seç
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs uppercase tracking-wide" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    Mükellef
                  </div>
                  <div className="font-semibold text-lg" style={{ color: '#fafaf9' }}>
                    {selected}
                  </div>
                </div>
                {ruleMap.has(selected) && (
                  <button
                    onClick={() => {
                      if (confirm(`${selected} için profil silinsin mi?`)) del.mutate(selected);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
                    style={{ background: 'rgba(239,68,68,.1)', color: '#dc2626' }}
                  >
                    <Trash2 size={13} /> Sil
                  </button>
                )}
              </div>

              <label className="block text-sm font-medium mb-2" style={{ color: '#fafaf9' }}>
                Claude'a Özel Talimatlar
              </label>
              <textarea
                value={talimat}
                onChange={(e) => setTalimat(e.target.value)}
                rows={14}
                placeholder={`Örnek:\n- Bu mükellef nakliye firması.\n- Akaryakıt (benzin/motorin) faturaları 740.01.001'e yazılır.\n- Araç bakım/onarım 740.01.002'ye.\n- Lastik 740.01.005'e.\n- Yemek/yiyecek faturaları 770.01.030'a (mutfak/yemekhane).\n- ÖNEMLİ: Faturanın GERÇEK içeriğine bak. Sadece mükellefin sektörü "nakliye" diye her şeyi yakıt sayma.\n- Fatura içeriğini görmüyorsan emin_degil de.`}
                className="w-full px-4 py-3 rounded-lg text-sm border outline-none font-mono leading-relaxed"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.05)',
                  color: '#fafaf9',
                  minHeight: 300,
                }}
              />

              <div className="flex items-center justify-between mt-3">
                <p className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Bu talimatlar her fatura kararında Claude'un system prompt'una eklenir.
                </p>
                <button
                  onClick={() => upsert.mutate({ mukellef: selected, talimat })}
                  disabled={!talimat.trim() || upsert.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  style={{ background: '#059669', color: 'white' }}
                >
                  <Save size={14} /> Kaydet
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
