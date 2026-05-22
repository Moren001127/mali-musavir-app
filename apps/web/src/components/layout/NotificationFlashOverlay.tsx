'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

/**
 * NotificationFlashOverlay
 * Yeni bildirim geldiginde ekranin ortasinda BUYUK olarak yanip soner.
 * Hangi panel sayfasinda olursan ol her zaman gorunur (layout'a yerlesir).
 *
 * Davranis:
 *  - Her 5 sn'de /notifications endpoint'ini poll eder
 *  - Sayfa ilk acildiginda en yeni bildirimin ID'sini baseline alir (sessiz)
 *  - Sonra ID degisirse VE okunmamissa -> overlay'i acar
 *  - 8 sn sonra otomatik kapanir, kullanici tiklayarak da kapatabilir
 *  - "Detay" tiklarsa /panel/bildirimler'e gider ve bildirimi okundu isaretler
 */
type Notification = {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  type?: string;
  readAt?: string | null;
  createdAt?: string;
  link?: string;
  meta?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const AUTO_CLOSE_MS = 8000;

export default function NotificationFlashOverlay() {
  const lastSeenIdRef = useRef<string | null>(null);
  const [active, setActive] = useState<Notification | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useQuery<Notification[]>({
    queryKey: ['notifications', 'flash-poll'],
    queryFn: () =>
      api.get('/notifications').then((r) => {
        const arr = Array.isArray(r.data) ? r.data : (r.data as any)?.items ?? [];
        return arr as Notification[];
      }),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  useEffect(() => {
    if (!data || data.length === 0) return;
    // En yeni bildirim listenin en basinda olmali (createdAt desc varsayim)
    const newest = data[0];
    if (!newest?.id) return;

    if (lastSeenIdRef.current === null) {
      // Ilk yukleme — baseline al, ekrana cikarma
      lastSeenIdRef.current = newest.id;
      return;
    }

    // Yeni ID geldi VE okunmamissa flash et
    if (newest.id !== lastSeenIdRef.current && !newest.readAt) {
      setActive(newest);
      lastSeenIdRef.current = newest.id;
    }
  }, [data]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(null), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  const title = active.title || 'Yeni Bildirim';
  const message = active.message || active.body || '';
  const meta = ((active.metadata || active.meta) as any) || {};
  const linkHref = active.link || meta.link || '/panel/bildirimler';

  const handleOpen = async () => {
    try {
      await api.patch(`/notifications/${active.id}/read`);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // sessiz gec
    }
    setActive(null);
    if (linkHref) router.push(linkHref);
  };

  const handleClose = () => setActive(null);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center moren-flash-overlay"
      onClick={handleClose}
      role="alertdialog"
      aria-live="assertive"
    >
      <div
        className="relative w-full max-w-2xl mx-4 p-10 rounded-3xl border-2 moren-flash-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background:
            'linear-gradient(135deg, rgba(26,22,15,0.96) 0%, rgba(45,35,20,0.96) 100%)',
          borderColor: '#d4b876',
          boxShadow:
            '0 0 80px rgba(212, 184, 118, 0.45), 0 25px 60px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Kapatma */}
        <button
          onClick={handleClose}
          aria-label="Kapat"
          className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(250,250,249,0.7)',
          }}
        >
          <X size={18} />
        </button>

        {/* Bell ikon */}
        <div className="flex items-center justify-center mb-6">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center moren-flash-bell"
            style={{
              background: 'rgba(212, 184, 118, 0.15)',
              border: '2px solid #d4b876',
              boxShadow: '0 0 40px rgba(212, 184, 118, 0.6)',
            }}
          >
            <Bell size={40} style={{ color: '#d4b876' }} strokeWidth={1.5} />
          </div>
        </div>

        {/* Baslik */}
        <h2
          className="text-center text-3xl font-semibold mb-3"
          style={{
            color: '#fafaf9',
            fontFamily: 'Fraunces, ui-serif, Georgia, serif',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>

        {/* Mesaj */}
        {message && (
          <p
            className="text-center text-lg leading-relaxed mb-8 max-h-48 overflow-auto"
            style={{ color: 'rgba(250,250,249,0.75)' }}
          >
            {message}
          </p>
        )}

        {/* Aksiyon dugmeleri */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleClose}
            className="px-6 py-3 rounded-xl text-sm font-medium transition-all hover:opacity-80"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(250,250,249,0.85)',
            }}
          >
            Kapat
          </button>
          <button
            onClick={handleOpen}
            className="px-6 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-105 flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #d4b876 0%, #c0a079 100%)',
              color: '#1a160f',
              boxShadow: '0 8px 24px rgba(212, 184, 118, 0.4)',
            }}
          >
            Detayı Aç
            <ExternalLink size={16} />
          </button>
        </div>

        {/* Sayaç barı (8sn) */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 rounded-b-3xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="h-full moren-flash-progress"
            style={{ background: '#d4b876' }}
          />
        </div>
      </div>

      <style jsx global>{`
        @keyframes morenFlashIn {
          0% {
            opacity: 0;
            backdrop-filter: blur(0px);
            background: rgba(0, 0, 0, 0);
          }
          100% {
            opacity: 1;
            backdrop-filter: blur(8px);
            background: rgba(0, 0, 0, 0.55);
          }
        }
        @keyframes morenFlashCardIn {
          0% {
            opacity: 0;
            transform: scale(0.85) translateY(20px);
          }
          60% {
            opacity: 1;
            transform: scale(1.03) translateY(-3px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes morenFlashBellPulse {
          0%,
          100% {
            transform: scale(1);
            box-shadow: 0 0 40px rgba(212, 184, 118, 0.6);
          }
          50% {
            transform: scale(1.08);
            box-shadow: 0 0 60px rgba(212, 184, 118, 0.9);
          }
        }
        @keyframes morenFlashProgress {
          0% {
            width: 100%;
          }
          100% {
            width: 0%;
          }
        }
        .moren-flash-overlay {
          animation: morenFlashIn 0.35s ease-out forwards;
        }
        .moren-flash-card {
          animation: morenFlashCardIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)
            forwards;
        }
        .moren-flash-bell {
          animation: morenFlashBellPulse 1.6s ease-in-out infinite;
        }
        .moren-flash-progress {
          animation: morenFlashProgress ${AUTO_CLOSE_MS}ms linear forwards;
        }
      `}</style>
    </div>
  );
}
