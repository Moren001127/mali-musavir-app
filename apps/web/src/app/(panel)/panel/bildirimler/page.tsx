'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

const GOLD = '#d4b876';

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  metadata?: any;
};

const TYPE_LABELS: Record<string, string> = {
  TAX_DEADLINE: 'Vergi Tarihi',
  TASK_DUE: 'Görev',
  SYSTEM: 'Sistem',
  AGENT: 'Ajan',
  WHATSAPP: 'WhatsApp',
  AI: 'Moren AI',
};

function typeLabel(t: string) {
  return TYPE_LABELS[t] || t;
}

function typeColor(t: string) {
  switch (t) {
    case 'TAX_DEADLINE':
      return '#ef4444';
    case 'TASK_DUE':
      return '#f59e0b';
    case 'SYSTEM':
      return '#94a3b8';
    case 'AGENT':
      return '#3b82f6';
    case 'WHATSAPP':
      return '#10b981';
    case 'AI':
      return GOLD;
    default:
      return '#94a3b8';
  }
}

export default function BildirimlerPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () =>
      api.patch('/notifications/read-all').then((r) => r.data as { count: number }),
    onSuccess: (d) => {
      toast.success(`${d.count} bildirim okundu olarak işaretlendi`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'İşaretlenemedi'),
  });

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const types = useMemo(() => {
    const set = new Set(notifications.map((n) => n.type));
    return Array.from(set);
  }, [notifications]);

  const visible = notifications.filter((n) => {
    if (filter === 'unread' && n.isRead) return false;
    if (typeFilter && n.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span
            className="text-[10px] uppercase font-bold tracking-[.18em]"
            style={{ color: '#b8a06f' }}
          >
            <Bell size={10} className="inline mr-1" /> Bildirimler
          </span>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 34,
                fontWeight: 600,
                color: '#fafaf9',
                letterSpacing: '-.03em',
              }}
            >
              Bildirimler
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
              {unreadCount > 0
                ? `${unreadCount} okunmamış bildirim · son 50 kayıt gösterilir`
                : 'Tüm bildirimler okundu · son 50 kayıt gösterilir'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{
                background: 'rgba(184,160,111,0.12)',
                color: GOLD,
                border: '1px solid rgba(184,160,111,0.3)',
              }}
            >
              {markAll.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCheck size={14} />
              )}
              Tümünü okundu işaretle
            </button>
          )}
        </div>
      </div>

      {/* Filtre barı */}
      <div className="flex flex-wrap gap-3 items-center">
        <div
          className="inline-flex rounded-lg overflow-hidden border"
          style={{ borderColor: 'rgba(255,255,255,0.08)' }}
        >
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-2 text-xs font-semibold transition"
              style={{
                background:
                  filter === f ? 'rgba(184,160,111,0.15)' : 'rgba(255,255,255,0.02)',
                color: filter === f ? GOLD : 'rgba(250,250,249,0.6)',
                borderRight: f === 'all' ? '1px solid rgba(255,255,255,0.08)' : 'none',
              }}
            >
              {f === 'all' ? 'Tümü' : `Okunmamış (${unreadCount})`}
            </button>
          ))}
        </div>

        {types.length > 1 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs border outline-none"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.08)',
              color: '#fafaf9',
            }}
          >
            <option value="" style={{ background: '#0f0d0b' }}>
              Tüm tipler
            </option>
            {types.map((t) => (
              <option key={t} value={t} style={{ background: '#0f0d0b' }}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Liste */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        {isLoading ? (
          <div
            className="p-12 flex items-center justify-center gap-2 text-sm"
            style={{ color: 'rgba(250,250,249,0.5)' }}
          >
            <Loader2 size={14} className="animate-spin" /> Yükleniyor…
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <Bell size={36} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {filter === 'unread'
                ? 'Okunmamış bildirim yok.'
                : 'Bildirim bulunmuyor.'}
            </p>
          </div>
        ) : (
          <div>
            {visible.map((n, idx) => (
              <div
                key={n.id}
                onClick={() => !n.isRead && markRead.mutate(n.id)}
                className="p-4 flex items-start gap-4 transition cursor-pointer hover:bg-white/[0.03]"
                style={{
                  background: !n.isRead ? 'rgba(184,160,111,0.06)' : 'transparent',
                  borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <div
                  className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: !n.isRead ? typeColor(n.type) : 'rgba(255,255,255,0.15)',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        background: typeColor(n.type) + '20',
                        color: typeColor(n.type),
                        border: `1px solid ${typeColor(n.type)}30`,
                      }}
                    >
                      {typeLabel(n.type)}
                    </span>
                    <p
                      className="text-sm font-semibold"
                      style={{ color: !n.isRead ? '#fafaf9' : 'rgba(250,250,249,0.7)' }}
                    >
                      {n.title}
                    </p>
                  </div>
                  <p
                    className="text-xs leading-relaxed mb-1.5"
                    style={{ color: 'rgba(250,250,249,0.6)' }}
                  >
                    {n.body}
                  </p>
                  <p className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {new Date(n.createdAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
