'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { lucaCredentialApi } from '@/lib/kdv';
import { CheckCircle2, XCircle, Loader2, KeyRound, Eye, EyeOff, Trash2 } from 'lucide-react';

function LucaAccountSection() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ['luca-credential'],
    queryFn: () => lucaCredentialApi.status(),
  });

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const save = useMutation({
    mutationFn: () => lucaCredentialApi.save(username, password),
    onSuccess: () => {
      toast.success('Luca hesabı kaydedildi');
      qc.invalidateQueries({ queryKey: ['luca-credential'] });
      setEditing(false);
      setUsername('');
      setPassword('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kayıt hatası'),
  });

  const remove = useMutation({
    mutationFn: () => lucaCredentialApi.remove(),
    onSuccess: () => {
      toast.success('Luca hesabı silindi');
      qc.invalidateQueries({ queryKey: ['luca-credential'] });
      setTestResult(null);
    },
  });

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await lucaCredentialApi.test();
      setTestResult(r);
      if (r.ok) toast.success('Luca\'ya login başarılı');
      else toast.error(r.error || 'Login başarısız');
      qc.invalidateQueries({ queryKey: ['luca-credential'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Bağlantı testi yapılamadı');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔐</span>
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>Luca Hesabı</h3>
            <p className="text-xs text-gray-500">
              Portal otomatik login olup muavin defterini indirir. Şifre AES-256-GCM ile şifrelenmiş saklanır.
            </p>
          </div>
        </div>
        {!editing && !isLoading && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-sm">
            {status?.connected ? 'Değiştir' : 'Ekle'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Luca Kullanıcı Adı
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Luca'ya giriş yaparken kullandığınız kullanıcı adı"
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(250,250,249,0.7)' }}>
              Şifre
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Luca şifreniz"
                className="w-full px-3 py-2 pr-10 rounded-lg text-sm border outline-none"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-60 hover:opacity-100"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
            <strong>Uyarı:</strong> 2FA açıksa kapatmanız gerekir. Captcha çıkarsa otomatik giriş başarısız olur.
            Şifreniz AES-256-GCM ile şifrelenmiş olarak sadece bu portalın veritabanında saklanır.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !username || !password}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button
              onClick={() => { setEditing(false); setUsername(''); setPassword(''); }}
              className="btn-secondary text-sm"
            >
              İptal
            </button>
          </div>
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound size={15} style={{ color: '#d4b876' }} />
              <div>
                <p className="text-sm font-medium" style={{ color: '#fafaf9' }}>{status.username}</p>
                <p className="text-xs text-gray-500">
                  {status.lastLoginAt
                    ? `Son login: ${new Date(status.lastLoginAt).toLocaleString('tr-TR')}`
                    : 'Henüz login denenmedi'}
                  {status.hasCachedSession && ' · Session aktif'}
                </p>
              </div>
            </div>
            {status.isActive && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                <CheckCircle2 size={12} /> Aktif
              </span>
            )}
          </div>
          {status.lastError && (
            <div className="rounded-lg p-2 text-xs" style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#fda4af' }}>
              <strong>Son hata:</strong> {status.lastError}
            </div>
          )}
          {testResult && (
            <div className="rounded-lg p-2 text-xs flex items-center gap-2"
              style={testResult.ok
                ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#86efac' }
                : { background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#fda4af' }}>
              {testResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {testResult.ok ? 'Login başarılı — Luca oturumu açıldı' : `Login başarısız: ${testResult.error}`}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={runTest}
              disabled={testing}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : null}
              Bağlantıyı Test Et
            </button>
            <button
              onClick={() => { if (confirm('Luca hesabını silmek istediğinize emin misiniz?')) remove.mutate(); }}
              disabled={remove.isPending}
              className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5 px-3 py-2"
            >
              <Trash2 size={13} /> Sil
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-400">
          Luca hesabı kayıtlı değil. "Ekle" butonu ile kullanıcı adı ve şifrenizi girin — portal Luca'dan muavin defteri otomatik indirecek.
        </div>
      )}
    </div>
  );
}

function SmsTemplateSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms-templates').then(r => r.data),
  });

  const [evrakTalep, setEvrakTalep] = useState('');
  const [evrakGeldi, setEvrakGeldi] = useState('');
  const [editing, setEditing] = useState(false);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (d: any) => api.patch('/sms-templates', d),
    onSuccess: () => {
      toast.success('SMS şablonları kaydedildi');
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      setEditing(false);
    },
    onError: () => toast.error('Kayıt hatası'),
  });

  const handleEdit = () => {
    setEvrakTalep(data?.evrakTalepMesaji || '');
    setEvrakGeldi(data?.evrakGeldiMesaji || '');
    setEditing(true);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💬</span>
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>SMS / WhatsApp Şablonları</h3>
            <p className="text-xs text-gray-500">Mükellef evrak hatırlatma mesaj şablonları</p>
          </div>
        </div>
        {!editing && (
          <button onClick={handleEdit} className="btn-secondary text-sm">Düzenle</button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Yükleniyor...</p>
      ) : editing ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">
            Kullanılabilir değişkenler:{' '}
            <code className="bg-white border rounded px-1">{'{ad}'}</code>{' '}
            <code className="bg-white border rounded px-1">{'{dönem}'}</code>
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Evrak Talebi SMS (Hatırlatma)
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              value={evrakTalep}
              onChange={e => setEvrakTalep(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              İşleme Başlama SMS (Onay)
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              value={evrakGeldi}
              onChange={e => setEvrakGeldi(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">İptal</button>
            <button
              className="btn-primary text-sm"
              disabled={isPending}
              onClick={() => save({ evrakTalepMesaji: evrakTalep, evrakGeldiMesaji: evrakGeldi })}
            >
              {isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Evrak Talebi SMS</p>
            <p className="text-sm text-gray-700">{data?.evrakTalepMesaji || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">İşleme Başlama SMS</p>
            <p className="text-sm text-gray-700">{data?.evrakGeldiMesaji || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AyarlarPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#d4b876' }}>Ayarlar</h1>
        <p className="text-sm text-gray-500 mt-1">Sistem ve entegrasyon ayarları</p>
      </div>

      <LucaAccountSection />

      <SmsTemplateSection />

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">📱</span>
          <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>WhatsApp Otomasyonu</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          WhatsApp entegrasyonu yakında aktif edilecek. Mükellef listesinde telefon numaralarını ve SMS tercihlerinizi şimdiden ayarlayabilirsiniz.
        </div>
      </div>

      <div className="card opacity-60">
        <h3 className="text-base font-semibold mb-2" style={{ color: '#d4b876' }}>Diğer Ayarlar</h3>
        <p className="text-sm text-gray-400">Yakında eklenecek: Ofis bilgileri, logo, bildirim tercihleri...</p>
      </div>
    </div>
  );
}
