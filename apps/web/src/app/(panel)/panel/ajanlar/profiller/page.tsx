'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi, AgentRule } from '@/lib/agents';
import { Plus, Save, Trash2, Sliders } from 'lucide-react';

const DEFAULT_PROFILE = {
  faaliyet: '',
  hesap_kod_mantigi: {
    motorin_yakit: {
      kod: '740.01.001',
      kdv: '%20',
      anahtar_kelimeler: ['motorin', 'benzin', 'mazot', 'yakıt', 'svpd'],
    },
    yedek_parca_bakim: {
      kod: '740.01.002',
      kdv: '%20',
      anahtar_kelimeler: ['yedek parça', 'lastik', 'akü', 'bakım', 'onarım'],
    },
  },
  vergi_kodu: { indirilecek_kdv: '191.01.003' },
  cari_kodlari: { kasa: '100.01.001-KASA' },
};

export default function ProfillerPage() {
  const qc = useQueryClient();
  const { data: rules = [], refetch } = useQuery({
    queryKey: ['agent-rules'],
    queryFn: () => agentsApi.rules(),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [json, setJson] = useState<string>('');
  const [faaliyet, setFaaliyet] = useState('');
  const [defterTuru, setDefterTuru] = useState('');
  const [newName, setNewName] = useState('');

  const current = rules.find((r: AgentRule) => r.mukellef === selected);

  useEffect(() => {
    if (current) {
      setJson(JSON.stringify(current.profile, null, 2));
      setFaaliyet(current.faaliyet ?? '');
      setDefterTuru(current.defterTuru ?? '');
    }
  }, [current]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Mükellef seçin');
      const profile = JSON.parse(json);
      return agentsApi.upsertRule(selected, { faaliyet, defterTuru, profile });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      alert('Profil kaydedildi');
    },
    onError: (e: any) => alert('Hata: ' + (e?.message ?? 'bilinmeyen')),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      if (!confirm(`${selected} profilini silmek istediğinize emin misiniz?`)) return;
      return agentsApi.deleteRule(selected);
    },
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
    },
  });

  const createNew = () => {
    if (!newName.trim()) return;
    setSelected(newName.trim());
    setJson(JSON.stringify(DEFAULT_PROFILE, null, 2));
    setFaaliyet('');
    setDefterTuru('Bilanço');
    setNewName('');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
          Mükellef Profilleri
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Her mükellef için hesap kodu kuralları — ajan bu kuralları kullanarak faturaları otomatik işler
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <div
          className="rounded-xl border p-2"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="flex gap-2 p-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Yeni mükellef adı..."
              className="flex-1 px-3 py-1.5 rounded-lg text-sm border outline-none"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onKeyDown={(e) => e.key === 'Enter' && createNew()}
            />
            <button
              onClick={createNew}
              className="px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1"
              style={{ background: 'var(--navy-500)', color: 'white' }}
            >
              <Plus size={14} /> Ekle
            </button>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {rules.length === 0 && !selected ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Henüz profil yok
              </div>
            ) : (
              <>
                {selected && !current && (
                  <ProfileItem
                    name={selected}
                    active
                    onClick={() => {}}
                    badge="Yeni (kaydedilmedi)"
                  />
                )}
                {rules.map((r: AgentRule) => (
                  <ProfileItem
                    key={r.id}
                    name={r.mukellef}
                    active={selected === r.mukellef}
                    onClick={() => setSelected(r.mukellef)}
                    badge={r.defterTuru ?? undefined}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <div
          className="rounded-xl border p-4 flex flex-col"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
              <div className="text-center">
                <Sliders size={32} className="mx-auto mb-2 opacity-40" />
                Sol listeden bir mükellef seçin veya yenisini ekleyin
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 pb-3 border-b mb-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <div className="font-semibold text-base" style={{ color: 'var(--text)' }}>
                    {selected}
                  </div>
                </div>
                <div className="flex gap-2">
                  {current && (
                    <button
                      onClick={() => deleteMut.mutate()}
                      className="px-3 py-1.5 rounded-lg text-sm inline-flex items-center gap-1"
                      style={{ background: 'rgba(239,68,68,.1)', color: '#dc2626' }}
                    >
                      <Trash2 size={13} /> Sil
                    </button>
                  )}
                  <button
                    onClick={() => saveMut.mutate()}
                    disabled={saveMut.isPending}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1"
                    style={{ background: 'var(--green-500, #059669)', color: 'white' }}
                  >
                    <Save size={13} /> {saveMut.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Faaliyet
                  </label>
                  <input
                    value={faaliyet}
                    onChange={(e) => setFaaliyet(e.target.value)}
                    placeholder="servis turizmi"
                    className="w-full px-3 py-1.5 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Defter Türü
                  </label>
                  <select
                    value={defterTuru}
                    onChange={(e) => setDefterTuru(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-sm border outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="">-</option>
                    <option value="Bilanço">Bilanço</option>
                    <option value="Defter Beyan">Defter Beyan</option>
                  </select>
                </div>
              </div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                Kural JSON (hesap kodu mantığı, anahtar kelimeler, KDV oranları)
              </label>
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                className="flex-1 min-h-[360px] p-3 rounded-lg text-xs font-mono border outline-none"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileItem({
  name,
  active,
  onClick,
  badge,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between"
      style={{
        background: active ? 'var(--navy-500)' : 'transparent',
        color: active ? 'white' : 'var(--text)',
      }}
    >
      <span className="truncate">{name}</span>
      {badge && (
        <span
          className="text-xs px-2 py-0.5 rounded-full ml-2 flex-shrink-0"
          style={{
            background: active ? 'rgba(255,255,255,.2)' : 'var(--muted)',
            color: active ? 'white' : 'var(--text-muted)',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
