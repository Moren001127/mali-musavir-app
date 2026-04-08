'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Image from 'next/image';

function WhatsAppSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get('/whatsapp/status').then(r => r.data),
    refetchInterval: 5000, // 5 saniyede bir yenile
  });

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl" style={{ background: '#25D36620' }}>
          📱
        </div>
        <div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--navy)' }}>WhatsApp Bağlantısı</h3>
          <p className="text-xs text-gray-500">Otomatik evrak hatırlatmaları için WhatsApp bağlantısı gereklidir</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Durum kontrol ediliyor...</p>
      ) : data?.ready ? (
        <div className="flex items-center gap-2 text-green-600">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
          <span className="font-medium">WhatsApp Bağlı</span>
          <span className="text-sm text-gray-500 ml-2">Mesajlar otomatik olarak gönderilebilir</span>
        </div>
      ) : data?.hasQr ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">
            WhatsApp'ı bağlamak için aşağıdaki QR kodu telefonunuzdaki WhatsApp ile tarayın:
          </p>
          <div className="flex flex-col items-center gap-2">
            <img
              src={`${process.env.NEXT_PUBLIC_API_URL}/whatsapp/qr`}
              alt="WhatsApp QR Kod"
              className="w-48 h-48 border-4 border-gray-200 rounded-xl"
            />
            <p className="text-xs text-gray-400">QR kod bağlantı kurulana kadar her 30 saniyede güncellenir</p>
            <button
              onClick={() => refetch()}
              className="text-xs text-blue-500 hover:underline"
            >
              QR'ı Yenile
            </button>
          </div>
        </div>
      ) : data?.error ? (
        <div className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
          <strong>WhatsApp modülü yüklenemedi:</strong> {data.error}
          <p className="text-xs mt-1 text-gray-500">Sistem çalışmaya devam eder, sadece otomatik WhatsApp mesajları gönderilemez.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-gray-400 inline-block"></span>
          <span className="text-sm">Bağlantı bekleniyor...</span>
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

      <WhatsAppSection />

      <div className="card opacity-60">
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--navy)' }}>Diğer Ayarlar</h3>
        <p className="text-sm text-gray-400">Yakında eklenecek: Ofis bilgileri, logo, bildirim tercihleri...</p>
      </div>
    </div>
  );
}
