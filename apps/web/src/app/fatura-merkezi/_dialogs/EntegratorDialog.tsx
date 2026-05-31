'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plug, X, Bell, BellOff, Trash2, Edit, Plus, Loader2, Search } from 'lucide-react';
import EntegratorSorguPanel from './EntegratorSorguPanel';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   ENTEGRATÖR DIALOG — Mihsap'taki gibi tam çalışır.
   Akış:
     1) Mevcut entegratörler listelenir (varsa).
     2) "+ Yeni Entegratör" → form (3 alan: sağlayıcı + kullanıcı + şifre).
        Servis URL provider'a göre otomatik (kullanıcıya sorulmuyor).
     3) Kaydedince listede görünür.
     4) Her satırda: Düzenle / Talimat Ver-Kaldır / Sil.
   ════════════════════════════════════════════════════════════════════ */

type Provider = {
  id: string;
  label: string;
  kind?: 'efatura' | 'esmm' | 'portal';
  hint?: string;
};

const PROVIDERS: Provider[] = [
  { id: 'ELOGO',          label: 'e-Logo',           kind: 'efatura', hint: 'Logo Yazılım' },
  { id: 'UYUMSOFT',       label: 'Uyumsoft',         kind: 'efatura' },
  { id: 'PARASUT',        label: 'Paraşüt',          kind: 'efatura' },
  { id: 'KOLAYSOFT',      label: 'Kolaysoft',        kind: 'efatura' },
  { id: 'IZIBIZ',         label: 'Izibiz / i2i',     kind: 'efatura' },
  { id: 'FORIBA',         label: 'Foriba',           kind: 'efatura' },
  { id: 'MIKRO',          label: 'Mikro / E-Mikro',  kind: 'efatura' },
  { id: 'LOGO_ISBASI',    label: 'Logo İşbaşı',      kind: 'efatura' },
  { id: 'TURMOB_EFATURA', label: 'TÜRMOB e-Fatura',  kind: 'efatura' },
  { id: 'GIB_PORTAL',     label: 'GİB Portal',        kind: 'portal',  hint: 'e-Arşiv satış için (mali mühür/e-imza)' },
  { id: 'LUCA',           label: 'Luca e-Belge',     kind: 'portal' },
];

type Props = {
  taxpayer: any;
  onClose: () => void;
};

type IntegrationFormPayload = {
  provider: string;
  username: string;
  password: string;
  apiKey?: string;
  apiSecret?: string;
  senderVkn?: string;
  accountId?: string;
};

export default function EntegratorDialog({ taxpayer, onClose }: Props) {
  const qc = useQueryClient();

  const integrationsQ = useQuery({
    queryKey: ['fatura-merkezi', 'integrations', taxpayer.id],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: taxpayer.id } })
      .then((r) => (Array.isArray(r.data) ? r.data : [])),
  });

  const items = integrationsQ.data || [];
  const configured = items.filter((i: any) => i.configured);

  const [sorgulananProvider, setSorgulananProvider] = useState<any | null>(null);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>(
    configured.length === 0 ? 'add' : 'list',
  );
  const [editing, setEditing] = useState<any | null>(null);

  useEffect(() => {
    if (!integrationsQ.isLoading && configured.length === 0 && mode === 'list') {
      setMode('add');
    }
  }, [integrationsQ.isLoading, configured.length, mode]);

  const saveMut = useMutation({
    mutationFn: async (payload: IntegrationFormPayload) => {
      return api.post('/fatura-muhasebelestirme/integrations', {
        taxpayerId: taxpayer.id,
        provider: payload.provider,
        username: payload.username,
        password: payload.password,
        apiKey: payload.apiKey,
        apiSecret: payload.apiSecret,
        senderVkn: payload.senderVkn,
        accountId: payload.accountId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'integrations'] });
      setMode('list');
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (provider: string) => {
      return api.delete('/fatura-muhasebelestirme/integrations', {
        params: { taxpayerId: taxpayer.id, provider },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'integrations'] });
    },
  });

  const talimatMut = useMutation({
    mutationFn: async ({ provider, active }: { provider: string; active: boolean }) => {
      return api.post('/fatura-muhasebelestirme/integrations/talimat', {
        taxpayerId: taxpayer.id,
        provider,
        active,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'integrations'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#10b98120', color: '#10b981' }}>
              <Plug size={18} />
            </div>
            <div>
              <div className="text-[15.5px] font-semibold" style={{ color: 'var(--text)' }}>
                Entegratörler
              </div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {taxpayerName(taxpayer)} · VKN: {taxpayer.taxNumber || '-'}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* İçerik */}
        <div className="p-6 min-h-[200px]">
          {integrationsQ.isLoading && (
            <div className="flex items-center justify-center py-8 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={16} className="animate-spin mr-2" />
              Yükleniyor...
            </div>
          )}

          {!integrationsQ.isLoading && mode === 'list' && (
            <EntegratorList
              items={configured}
              onAdd={() => setMode('add')}
              onEdit={(item) => { setEditing(item); setMode('edit'); }}
              onDelete={(provider) => deleteMut.mutate(provider)}
              onTalimat={(provider, active) => talimatMut.mutate({ provider, active })}
              onSorgula={(item) => setSorgulananProvider(item)}
              deleting={deleteMut.isPending}
              talimatPending={talimatMut.isPending}
            />
          )}

          {!integrationsQ.isLoading && (mode === 'add' || mode === 'edit') && (
            <EntegratorForm
              editing={editing}
              configuredProviders={configured.map((c: any) => c.provider)}
              onSubmit={(payload) => saveMut.mutate(payload)}
              onCancel={() => {
                if (configured.length > 0) {
                  setMode('list');
                  setEditing(null);
                } else {
                  onClose();
                }
              }}
              saving={saveMut.isPending}
              error={saveMut.error}
            />
          )}
        </div>
      </div>
      {sorgulananProvider && (
        <EntegratorSorguPanel
          taxpayer={taxpayer}
          provider={sorgulananProvider.provider}
          providerLabel={(PROVIDERS.find((x) => x.id === sorgulananProvider.provider)?.label) || sorgulananProvider.provider}
          onClose={() => setSorgulananProvider(null)}
        />
      )}
    </div>
  );
}

/* ─── Mevcut entegratörlerin listesi ─── */
function EntegratorList({
  items, onAdd, onEdit, onDelete, onTalimat, onSorgula, deleting, talimatPending,
}: {
  items: any[];
  onAdd: () => void;
  onEdit: (item: any) => void;
  onDelete: (provider: string) => void;
  onTalimat: (provider: string, active: boolean) => void;
  onSorgula: (item: any) => void;
  deleting: boolean;
  talimatPending: boolean;
}) {
  return (
    <div>
      <div className="space-y-2 mb-4">
        {items.map((i: any) => {
          const p = PROVIDERS.find((x) => x.id === i.provider);
          return (
            <div
              key={i.provider}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <div className="p-2 rounded-lg" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                <Plug size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                  {p?.label || i.provider}
                </div>
                <div className="text-[11.5px] mt-0.5 font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                  {i.username || '(kullanıcı yok)'}
                </div>
              </div>
              <button
                onClick={() => onSorgula(i)}
                className="flex items-center gap-1 px-3 py-1.5 text-[11.5px] font-semibold rounded-md transition-colors"
                style={{ background: '#0ea5e9', color: 'white' }}
                title="Bu entegratörden fatura sorgula (tarih aralığı + alış/satış/e-arşiv)"
              >
                <Search size={12} /> Sorgula
              </button>
              <button
                onClick={() => onTalimat(i.provider, !i.talimat)}
                disabled={talimatPending}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-medium rounded-md transition-colors"
                style={{
                  background: i.talimat ? '#10b98115' : 'transparent',
                  color: i.talimat ? '#10b981' : 'var(--text-muted)',
                  border: '1px solid ' + (i.talimat ? '#10b98140' : 'var(--border)'),
                }}
                title="Talimat — her gece son 9 günün faturalarını otomatik çeker"
              >
                {i.talimat ? <Bell size={12} /> : <BellOff size={12} />}
                {i.talimat ? 'Talimatlı' : 'Talimat ver'}
              </button>
              <button
                onClick={() => onEdit(i)}
                className="p-2 rounded-md hover:bg-[var(--accent-light)]"
                style={{ color: 'var(--text-muted)' }}
                title="Düzenle"
              >
                <Edit size={14} />
              </button>
              <button
                onClick={() => { if (confirm('Bu entegratörü silmek istiyor musun?')) onDelete(i.provider); }}
                disabled={deleting}
                className="p-2 rounded-md hover:bg-red-900/20"
                style={{ color: '#ef4444' }}
                title="Sil"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold rounded-lg transition-colors"
        style={{ background: 'var(--accent)', color: 'var(--bg)' }}
      >
        <Plus size={15} />
        Yeni Entegratör Ekle
      </button>
    </div>
  );
}

/* ─── Yeni / Düzenle formu ─── */
function EntegratorForm({
  editing, configuredProviders, onSubmit, onCancel, saving, error,
}: {
  editing?: any | null;
  configuredProviders: string[];
  onSubmit: (payload: IntegrationFormPayload) => void;
  onCancel: () => void;
  saving: boolean;
  error: any;
}) {
  const [provider, setProvider] = useState<string>(editing?.provider || '');
  const [username, setUsername] = useState<string>(editing?.username || '');
  const [password, setPassword] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [firmaNo, setFirmaNo] = useState<string>(editing?.accountId || editing?.senderVkn || '');
  const [showPwd, setShowPwd] = useState(false);

  const isEdit = !!editing;
  const provInfo = PROVIDERS.find((p) => p.id === provider);
  const isParasut = provider === 'PARASUT';
  const missingParasutFirmaNo = isParasut && !firmaNo;
  const formInvalid = !provider || !username || (!isEdit && !password) || missingParasutFirmaNo;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formInvalid) return;
    onSubmit({
      provider,
      username,
      password: password || '',
      apiKey,
      apiSecret,
      accountId: firmaNo,
      senderVkn: firmaNo,
    });
  };

  // Available providers: hepsi (edit modunda) veya henüz tanımlı olmayanlar (yeni)
  const availableProviders = isEdit ? PROVIDERS : PROVIDERS.filter((p) => !configuredProviders.includes(p.id));

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {/* Sağlayıcı */}
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Sağlayıcı <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={isEdit}
            required
            className="w-full px-3 py-2.5 text-[13px] outline-none rounded-lg"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              opacity: isEdit ? 0.7 : 1,
            }}
          >
            <option value="" style={{ background: 'var(--surface)' }}>Sağlayıcı seçin...</option>
            {availableProviders.map((p) => (
              <option key={p.id} value={p.id} style={{ background: 'var(--surface)' }}>
                {p.label}{p.hint ? ` — ${p.hint}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Kullanıcı adı */}
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Kullanıcı Adı <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Genelde VKN/TCKN"
            required
            className="w-full px-3 py-2.5 text-[13px] outline-none rounded-lg font-mono"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        {/* Şifre */}
        <div>
          <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Şifre {isEdit ? '(boş bırakılırsa değişmez)' : <span style={{ color: '#ef4444' }}>*</span>}
          </label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? '••••••' : 'Sağlayıcı şifresi'}
              required={!isEdit}
              className="w-full px-3 py-2.5 pr-16 text-[13px] outline-none rounded-lg font-mono"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-medium rounded-md"
              style={{ color: 'var(--text-muted)' }}
            >
              {showPwd ? 'Gizle' : 'Göster'}
            </button>
          </div>
        </div>

        {isParasut && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Client ID {editing?.hasApiKey ? '(ofis genelinde kayitli)' : '(opsiyonel - bir kere girilirse tum firmalarda kullanilir)'}
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.hasApiKey ? 'Kayitli' : 'Parasut client_id'}
                className="w-full px-3 py-2.5 text-[13px] outline-none rounded-lg font-mono"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Client Secret {editing?.hasApiSecret ? '(ofis genelinde kayitli)' : '(opsiyonel - bir kere girilirse tum firmalarda kullanilir)'}
              </label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder={editing?.hasApiSecret ? 'Kayitli' : 'Parasut client_secret'}
                className="w-full px-3 py-2.5 text-[13px] outline-none rounded-lg font-mono"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Firma No <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={firmaNo}
                onChange={(e) => setFirmaNo(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Parasut firma/company ID"
                required
                className="w-full px-3 py-2.5 text-[13px] outline-none rounded-lg font-mono"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>
          </div>
        )}

        {/* Bilgi notu */}
        {provInfo?.hint && (
          <div
            className="p-3 rounded-lg text-[11.5px]"
            style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
          >
            <strong style={{ color: 'var(--accent)' }}>{provInfo.label}:</strong> {provInfo.hint}
          </div>
        )}

        {provider && (
          <div
            className="p-3 rounded-lg text-[11.5px]"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            {isParasut
              ? 'Parasut Client ID/Secret ofis geneline bir kere kaydedilir. Sonraki firmalarda sadece kullanici, sifre ve Firma No yeterlidir.'
              : 'Servis URL saglayiciya gore otomatik atanir. Manuel degistirmek istersen sonra Duzenle ile yapabilirsin.'}
          </div>
        )}

        {/* Hata */}
        {error && (
          <div
            className="p-3 rounded-lg text-[11.5px]"
            style={{ background: '#ef444415', border: '1px solid #ef444440', color: '#fca5a5' }}
          >
            {(error as any)?.response?.data?.message || (error as any)?.message || 'Kaydetme sırasında hata oluştu.'}
          </div>
        )}
      </div>

      {/* Aksiyon barı */}
      <div className="flex justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-[13px] font-medium rounded-lg transition-colors"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          İptal
        </button>
        <button
          type="submit"
          disabled={saving || formInvalid}
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
}
