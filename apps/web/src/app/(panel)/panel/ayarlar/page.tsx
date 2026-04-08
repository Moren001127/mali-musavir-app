'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
            <h3 className="text-base font-semibold" style={{ color: 'var(--navy)' }}>SMS / WhatsApp Şablonları</h3>
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
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
              value={evrakTalep}
              onChange={e => setEvrakTalep(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              İşleme Başlama SMS (Onay)
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--gold)]"
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
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Ayarlar</h1>
        <p className="text-sm text-gray-500 mt-1">Sistem ve entegrasyon ayarları</p>
      </div>

      <SmsTemplateSection />

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">📱</span>
          <h3 className="text-base font-semibold" style={{ color: 'var(--navy)' }}>WhatsApp Otomasyonu</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          WhatsApp entegrasyonu yakında aktif edilecek. Mükellef listesinde telefon numaralarını ve SMS tercihlerinizi şimdiden ayarlayabilirsiniz.
        </div>
      </div>

      <div className="card opacity-60">
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--navy)' }}>Diğer Ayarlar</h3>
        <p className="text-sm text-gray-400">Yakında eklenecek: Ofis bilgileri, logo, bildirim tercihleri...</p>
      </div>
    </div>
  );
}
