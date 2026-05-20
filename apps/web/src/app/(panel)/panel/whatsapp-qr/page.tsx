'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Smartphone,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  LogOut,
  RefreshCw,
  Send,
  PhoneCall,
} from 'lucide-react';
import { api } from '@/lib/api';

const GOLD = '#d4b876';

interface QrStatus {
  connected: boolean;
  phone?: string;
  qrDataUrl?: string;
  lastUpdate?: string;
  reconnectAttempts?: number;
  lastError?: string;
  initSecondsAgo?: number;
}

export default function WhatsAppQrPage() {
  const qc = useQueryClient();
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Test mesajı — Moren AI QR entegrasyonu çalışıyor.');

  const { data: status } = useQuery<QrStatus>({
    queryKey: ['wa-qr-status'],
    queryFn: async () => (await api.get('/whatsapp-qr/status')).data,
    refetchInterval: 3000,
  });

  const connect = useMutation({
    mutationFn: async () => (await api.post('/whatsapp-qr/connect')).data,
    onSuccess: () => {
      toast.success('QR kod hazırlanıyor… birkaç saniye içinde görünecek.');
      qc.invalidateQueries({ queryKey: ['wa-qr-status'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Bağlantı başlatılamadı'),
  });

  const disconnect = useMutation({
    mutationFn: async () => (await api.delete('/whatsapp-qr')).data,
    onSuccess: () => {
      toast.success('Oturum kapatıldı');
      qc.invalidateQueries({ queryKey: ['wa-qr-status'] });
    },
  });

  const sendTest = useMutation({
    mutationFn: async () =>
      (
        await api.post('/whatsapp-qr/send', {
          to: testPhone,
          message: testMessage,
        })
      ).data,
    onSuccess: () => toast.success('Test mesajı gönderildi'),
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Mesaj gönderilemedi'),
  });

  // Backend her zaman bir obje dönüyor — "hiç başlatılmadı" durumunu
  // initSecondsAgo / lastError / qrDataUrl alanlarının varlığından anlıyoruz.
  const hasActivity =
    !!status &&
    (status.initSecondsAgo !== undefined ||
      !!status.lastError ||
      !!status.qrDataUrl);
  const isInitial = !status?.connected && !hasActivity;
  const isWaiting = !!status && !status.connected && !status.qrDataUrl && hasActivity;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Smartphone className="h-6 w-6" style={{ color: GOLD }} />
        <h1 className="text-2xl font-serif text-stone-800 dark:text-stone-100">
          WhatsApp QR Bağlantısı
        </h1>
      </div>

      <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
        Kişisel WhatsApp hesabınızı portal'a QR kodla bağlayın. Otomasyonlar bu kanaldan
        serbest mesaj gönderebilir (Meta Cloud API'sinin yanında ek kanal).
      </p>

      {/* Uyarı kartı */}
      <div className="mb-6 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div>
          <b>Dikkat — resmi olmayan yöntem.</b> WhatsApp Hizmet Şartları'na uygun değildir.
          Toplu mesaj attığınızda Meta numarayı banlayabilir. Mali müşavirlik için kritik
          bir numara kullanmayın, mesaj sayısını sınırlı tutun ve sadece kişiselleştirilmiş
          mesajlar için kullanın. Toplu hatırlatma için Meta Cloud API + onaylı şablon
          (send_whatsapp_template) tercih edilmeli.
        </div>
      </div>

      {/* Durum kartı */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-sm">
        {status?.connected ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <div className="mt-2 text-lg font-medium text-stone-800 dark:text-stone-100">
              Bağlı
            </div>
            <div className="mt-1 text-sm text-stone-600 dark:text-stone-300">
              Numara: <code className="font-mono">+{status.phone}</code>
            </div>
            <button
              onClick={() => {
                if (confirm('WhatsApp oturumunu kapatmak istediğinden emin misin?'))
                  disconnect.mutate();
              }}
              disabled={disconnect.isPending}
              className="mt-4 inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 text-sm font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40"
            >
              {disconnect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <LogOut className="h-4 w-4" /> Bağlantıyı Kes
            </button>
          </div>
        ) : status?.qrDataUrl ? (
          <div className="text-center">
            <div className="text-sm text-stone-600 dark:text-stone-300 mb-3">
              Telefonunuzdan WhatsApp → <b>Ayarlar</b> → <b>Bağlı Cihazlar</b> → <b>Cihaz Bağla</b>'yı açın ve aşağıdaki QR'ı okutun:
            </div>
            <div className="inline-block rounded-lg bg-white p-3 shadow">
              <img src={status.qrDataUrl} alt="WhatsApp QR" width={280} height={280} />
            </div>
            <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">
              QR 20 saniyede yenilenir — eski QR'ı okutmaya çalışmayın.
            </div>
          </div>
        ) : isWaiting ? (
          <div className="text-center text-sm text-stone-600 dark:text-stone-300">
            {status.lastError ? (
              <>
                <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
                <div className="mt-2 font-medium text-rose-700 dark:text-rose-400">
                  QR oluşturulamadı
                </div>
                <div className="mt-1 text-xs">{status.lastError}</div>
                <button
                  onClick={() => connect.mutate()}
                  className="mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: GOLD }}
                >
                  <RefreshCw className="h-4 w-4" /> Tekrar Dene
                </button>
              </>
            ) : (status.initSecondsAgo ?? 0) > 30 ? (
              <>
                <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
                <div className="mt-2 font-medium text-amber-700 dark:text-amber-400">
                  QR {status.initSecondsAgo} saniyedir gelmiyor
                </div>
                <div className="mt-1 text-xs">
                  Genelde 5-10 saniye sürer. Sunucu loglarına bakman gerekebilir.
                </div>
                <button
                  onClick={() => connect.mutate()}
                  className="mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: GOLD }}
                >
                  <RefreshCw className="h-4 w-4" /> Tekrar Dene
                </button>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto h-8 w-8 animate-spin" />
                <div className="mt-2">
                  QR hazırlanıyor… {status.initSecondsAgo ?? 0}sn
                </div>
              </>
            )}
            {status.reconnectAttempts && status.reconnectAttempts > 0 && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Yeniden bağlanma denemesi: {status.reconnectAttempts}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <Smartphone className="mx-auto h-10 w-10 text-stone-400 dark:text-stone-500" />
            <div className="mt-2 text-sm text-stone-600 dark:text-stone-300">
              Henüz bir oturum yok. Başlamak için aşağıdaki butona basın.
            </div>
            <button
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              style={{ backgroundColor: GOLD }}
            >
              {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              QR Üret ve Bağlan
            </button>
          </div>
        )}

        {/* Hangi durumda olursa olsun, sıfırlama imkanı */}
        {!isInitial && (
          <div className="mt-4 border-t border-stone-200 dark:border-stone-700 pt-3 text-center">
            <button
              onClick={() => {
                if (confirm('Mevcut oturumu kapatıp baştan başlatmak istediğine emin misin?')) {
                  disconnect.mutate();
                }
              }}
              disabled={disconnect.isPending}
              className="text-xs text-stone-500 dark:text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 underline"
            >
              Oturumu sıfırla ve baştan başla
            </button>
          </div>
        )}
      </div>

      {/* Test mesaj paneli — sadece bağlıyken */}
      {status?.connected && (
        <div className="mt-6 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-sm">
          <h2 className="mb-3 text-base font-medium text-stone-800 dark:text-stone-100 inline-flex items-center gap-2">
            <PhoneCall className="h-4 w-4" style={{ color: GOLD }} />
            Test Mesajı Gönder
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                Hedef Telefon
              </label>
              <input
                type="text"
                placeholder="5551234567 veya +905551234567"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="w-full rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                Mesaj
              </label>
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="w-full rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400"
              />
            </div>
          </div>
          <button
            onClick={() => sendTest.mutate()}
            disabled={!testPhone || !testMessage || sendTest.isPending}
            className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: GOLD }}
          >
            {sendTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Test Gönder
          </button>
          <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">
            Bu kanaldan otomasyon mesajı atmak için <code>send_whatsapp_qr</code>
            aksiyonunu kullanan otomasyon kur — bkz. /panel/otomasyonlar.
          </div>
        </div>
      )}

      {/* Bilgi notu */}
      <div className="mt-6 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-4 text-xs text-stone-600 dark:text-stone-300">
        <p className="mb-2 font-medium text-stone-700 dark:text-stone-200">
          Önemli Notlar
        </p>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            Telefonunuz çevrimiçi olmasa bile mesaj gönderilebilir (multi-device protokolü),
            ama bağlantı uzun süre kullanılmazsa cihaz silinebilir.
          </li>
          <li>
            Railway gibi geçici dosya sistemli sunucularda her deploy'dan sonra QR
            yeniden okutmanız gerekebilir.{' '}
            <code>WHATSAPP_QR_AUTH_PATH</code> env ile kalıcı volume yolu verilirse oturum
            korunur.
          </li>
          <li>
            Bağlantı koptuğunda sistem otomatik yeniden bağlanmaya çalışır (üstel
            backoff ile 10 deneme).
          </li>
          <li>
            Aynı anda Meta Cloud API ve QR sistemi birlikte çalışır. Her ikisi de farklı
            aksiyon adları kullanır: <code>send_whatsapp_template</code> (Meta) vs{' '}
            <code>send_whatsapp_qr</code> (QR).
          </li>
        </ul>
      </div>
    </div>
  );
}
