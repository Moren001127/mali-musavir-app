'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

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

const AUTO_CLOSE_MS = 9000;

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
    const newest = data[0];
    if (!newest?.id) return;

    if (lastSeenIdRef.current === null) {
      lastSeenIdRef.current = newest.id;
      return;
    }

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

  const title = active.title || 'Yeni bildirim';
  const message = active.message || active.body || '';
  const meta = ((active.metadata || active.meta) as any) || {};
  const linkHref = active.link || meta.link || '/panel/bildirimler';
  const severity = String(meta.severity || active.type || '').toLowerCase();
  const isCritical = severity.includes('critical') || severity.includes('error');
  const tone = isCritical
    ? { accent: '#fb7185', bg: 'rgba(69,10,10,0.96)', soft: 'rgba(251,113,133,0.16)' }
    : { accent: '#d4b876', bg: 'rgba(24,22,17,0.96)', soft: 'rgba(212,184,118,0.16)' };

  const handleOpen = async () => {
    try {
      await api.patch(`/notifications/${active.id}/read`);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch {
      // Bildirim aksiyonu ekrani bloke etmemeli.
    }
    setActive(null);
    if (linkHref) router.push(linkHref);
  };

  const handleClose = () => setActive(null);

  return (
    <div
      className="fixed right-3 top-20 z-[9999] w-[calc(100vw-24px)] max-w-[420px] pointer-events-none sm:right-5 moren-flash-wrap"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="pointer-events-auto relative overflow-hidden rounded-2xl border shadow-2xl moren-flash-card"
        style={{
          background: `linear-gradient(135deg, ${tone.bg} 0%, rgba(12,12,10,0.98) 100%)`,
          borderColor: isCritical ? 'rgba(251,113,133,0.45)' : 'rgba(212,184,118,0.42)',
          boxShadow: `0 18px 45px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.04), 0 0 28px ${tone.soft}`,
          backdropFilter: 'blur(14px)',
        }}
      >
        <div className="flex items-start gap-3 p-4 pr-12">
          <div
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: tone.soft, color: tone.accent }}
          >
            <Bell size={19} strokeWidth={1.8} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: tone.accent, boxShadow: `0 0 16px ${tone.accent}` }}
              />
              <p className="truncate text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                {title}
              </p>
            </div>

            {message && (
              <p
                className="mt-1.5 text-[12.5px] leading-relaxed"
                style={{
                  color: 'rgba(250,250,249,0.68)',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {message}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleOpen}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition hover:brightness-110"
                style={{ background: tone.accent, color: '#15120c' }}
              >
                Detayı aç
                <ExternalLink size={13} />
              </button>
              <button
                onClick={handleClose}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition hover:bg-white/10"
                style={{ color: 'rgba(250,250,249,0.68)' }}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleClose}
          aria-label="Kapat"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white/10"
          style={{ color: 'rgba(250,250,249,0.62)' }}
        >
          <X size={15} />
        </button>

        <div className="h-1 w-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full moren-flash-progress" style={{ background: tone.accent }} />
        </div>
      </div>

      <style jsx global>{`
        @keyframes morenFlashWrapIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes morenFlashCardIn {
          0% {
            transform: translateX(18px) scale(0.98);
          }
          100% {
            transform: translateX(0) scale(1);
          }
        }
        @keyframes morenFlashProgress {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        .moren-flash-wrap {
          animation: morenFlashWrapIn 180ms ease-out both;
        }
        .moren-flash-card {
          animation: morenFlashCardIn 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .moren-flash-progress {
          animation: morenFlashProgress ${AUTO_CLOSE_MS}ms linear forwards;
        }
      `}</style>
    </div>
  );
}
