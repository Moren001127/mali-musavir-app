'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertCircle,
  Bell,
  Bot,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Loader2,
  MessageCircle,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';

const GOLD = '#d4b876';
const BORDER = 'rgba(212,184,118,0.14)';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  metadata?: Record<string, any> | null;
};

type FilterMode = 'all' | 'unread' | 'read';

const TYPE_LABELS: Record<string, string> = {
  AUTOMATION: 'Otomasyon',
  TAX_DEADLINE: 'Vergi Tarihi',
  TASK_DUE: 'Görev',
  SYSTEM: 'Sistem',
  AGENT: 'Ajan',
  WHATSAPP: 'WhatsApp',
  'WhatsApp': 'WhatsApp',
  AI: 'Moren AI',
  MOREN_AI: 'Moren AI',
  'Moren AI': 'Moren AI',
  MOREN_AI_ALERT: 'Moren AI Uyarısı',
  OFFICE_CHAT: 'Ofis Sohbeti',
};

function typeLabel(t: string) {
  return TYPE_LABELS[t] || t;
}

function typeMeta(t: string) {
  switch (t) {
    case 'AUTOMATION':
      return { color: '#d4b876', Icon: CheckCircle2 };
    case 'TAX_DEADLINE':
      return { color: '#ff7a8c', Icon: CalendarClock };
    case 'TASK_DUE':
      return { color: '#f2c46d', Icon: CheckCircle2 };
    case 'SYSTEM':
      return { color: '#9da8b7', Icon: AlertCircle };
    case 'AGENT':
      return { color: '#8cc8ff', Icon: Bot };
    case 'WHATSAPP':
    case 'WhatsApp':
      return { color: '#27d39a', Icon: MessageCircle };
    case 'AI':
    case 'MOREN_AI':
    case 'Moren AI':
    case 'MOREN_AI_ALERT':
      return { color: GOLD, Icon: Sparkles };
    case 'OFFICE_CHAT':
      return { color: '#8fd7bd', Icon: Inbox };
    default:
      return { color: '#9da8b7', Icon: Bell };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeDate(iso: string) {
  const time = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'az önce';
  if (diff < hour) return `${Math.floor(diff / minute)} dk`;
  if (diff < day) return `${Math.floor(diff / hour)} sa`;
  return `${Math.floor(diff / day)} gün`;
}

function notificationHref(n: Notification) {
  const metadata = n.metadata || {};
  if (typeof metadata.link === 'string' && metadata.link) return metadata.link;
  if (n.type === 'WHATSAPP') {
    const id = metadata.taxpayerId ? String(metadata.taxpayerId) : '';
    return id ? `/panel/mesajlar?conversation=${encodeURIComponent(id)}` : '/panel/mesajlar';
  }
  if (n.type === 'OFFICE_CHAT') return '/panel?officeChat=open';
  if (n.type === 'TASK_DUE') return '/panel/gorevler';
  if (n.type === 'TAX_DEADLINE') return '/panel';
  if (n.type === 'AGENT') return '/panel/ajanlar';
  if (n.type === 'AI') return '/panel/moren-ai';
  return '';
}

function matchesSearch(n: Notification, search: string) {
  const q = search.trim().toLocaleLowerCase('tr-TR');
  if (!q) return true;
  const metadata = n.metadata || {};
  const haystack = [
    n.title,
    n.body,
    typeLabel(n.type),
    metadata.phone,
    metadata.actionText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr-TR');
  return haystack.includes(q);
}

export default function BildirimlerPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');

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

  const readCount = notifications.length - unreadCount;
  const lastNotification = notifications[0];
  const whatsappUnread = notifications.filter((n) => n.type === 'WHATSAPP' && !n.isRead).length;

  const types = useMemo(() => {
    const set = new Set(notifications.map((n) => n.type));
    return Array.from(set).sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), 'tr'));
  }, [notifications]);

  const visible = useMemo(
    () =>
      notifications.filter((n) => {
        if (filter === 'unread' && n.isRead) return false;
        if (filter === 'read' && !n.isRead) return false;
        if (typeFilter && n.type !== typeFilter) return false;
        return matchesSearch(n, search);
      }),
    [notifications, filter, typeFilter, search],
  );

  const markOneRead = (n: Notification) => {
    if (!n.isRead && !markRead.isPending) markRead.mutate(n.id);
  };

  return (
    <div className="max-w-none space-y-4">
      <section
        className="overflow-hidden rounded-2xl"
        style={{
          background: 'radial-gradient(circle at 5% 0%, rgba(212,184,118,0.10), transparent 30%), linear-gradient(180deg, rgba(11,11,10,0.98), rgba(6,6,6,0.96))',
          border: `1px solid ${BORDER}`,
          boxShadow: '0 18px 42px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(280px,1fr)_auto] xl:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-px w-9" style={{ background: GOLD }} />
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: '#c8ad73' }}>
                <Bell size={11} /> Bildirimler
              </span>
            </div>
            <h1
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 32,
                fontWeight: 650,
                color: '#fafaf9',
                letterSpacing: 0,
                lineHeight: 1.05,
              }}
            >
              Bildirimler
            </h1>
            <p className="mt-2 text-[13px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
              {unreadCount > 0
                ? `${unreadCount} okunmamış bildirim · son 50 kayıt`
                : 'Tüm bildirimler okundu · son 50 kayıt'}
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition disabled:opacity-50"
              style={{
                background: 'rgba(212,184,118,0.12)',
                color: '#e7cf91',
                border: '1px solid rgba(212,184,118,0.30)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              {markAll.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCheck size={15} />
              )}
              Tümünü okundu işaretle
            </button>
          )}
        </div>

        <div className="grid gap-2 border-t p-4 sm:grid-cols-2 xl:grid-cols-4" style={{ borderColor: SOFT_BORDER }}>
          <NotificationStat label="Okunmamış" value={unreadCount} color={unreadCount > 0 ? '#ff7a8c' : '#8fd7bd'} />
          <NotificationStat label="Okunmuş" value={readCount} color="#9da8b7" />
          <NotificationStat label="WhatsApp" value={whatsappUnread} color="#27d39a" />
          <NotificationStat label="Son kayıt" value={lastNotification ? relativeDate(lastNotification.createdAt) : '-'} color={GOLD} />
        </div>
      </section>

      <section
        className="overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, rgba(10,10,9,0.98), rgba(5,5,5,0.98))',
          border: `1px solid ${SOFT_BORDER}`,
        }}
      >
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(260px,1fr)_auto]" style={{ borderColor: SOFT_BORDER }}>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.38)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Bildirim ara"
              className="h-10 w-full rounded-lg border pl-9 pr-10 text-[13px] outline-none"
              style={{
                background: 'rgba(255,255,255,0.025)',
                borderColor: 'rgba(255,255,255,0.07)',
                color: '#fafaf9',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md"
                style={{ color: 'rgba(250,250,249,0.48)' }}
                aria-label="Aramayı temizle"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="inline-flex h-10 overflow-hidden rounded-lg border" style={{ borderColor: SOFT_BORDER }}>
            {([
              ['all', 'Tümü', notifications.length],
              ['unread', 'Okunmamış', unreadCount],
              ['read', 'Okunmuş', readCount],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className="inline-flex min-w-[96px] items-center justify-center gap-1.5 px-3 text-[12px] font-semibold transition"
                style={{
                  background: filter === value ? 'rgba(212,184,118,0.13)' : 'rgba(255,255,255,0.012)',
                  color: filter === value ? '#e7cf91' : 'rgba(250,250,249,0.58)',
                  borderRight: value !== 'read' ? `1px solid ${SOFT_BORDER}` : 'none',
                }}
              >
                {label}
                <span className="tabular-nums" style={{ color: filter === value ? '#f2d8a1' : 'rgba(250,250,249,0.36)' }}>
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={{ borderColor: SOFT_BORDER }}>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.34)' }}>
            <SlidersHorizontal size={12} /> Tip
          </span>
          <button
            type="button"
            onClick={() => setTypeFilter('')}
            className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition"
            style={{
              background: !typeFilter ? 'rgba(212,184,118,0.12)' : 'rgba(255,255,255,0.018)',
              border: `1px solid ${!typeFilter ? 'rgba(212,184,118,0.24)' : SOFT_BORDER}`,
              color: !typeFilter ? '#e7cf91' : 'rgba(250,250,249,0.52)',
            }}
          >
            Tüm tipler
          </button>
          {types.map((t) => {
            const meta = typeMeta(t);
            const active = typeFilter === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(active ? '' : t)}
                className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition"
                style={{
                  background: active ? `${meta.color}1f` : 'rgba(255,255,255,0.014)',
                  border: `1px solid ${active ? `${meta.color}55` : SOFT_BORDER}`,
                  color: active ? meta.color : 'rgba(250,250,249,0.54)',
                }}
              >
                {typeLabel(t)}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-[13px]" style={{ color: 'rgba(250,250,249,0.50)' }}>
            <Loader2 size={15} className="animate-spin" /> Yükleniyor...
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center" style={{ color: 'rgba(250,250,249,0.42)' }}>
            <Bell size={34} className="mx-auto mb-3 opacity-40" />
            <p className="text-[13px]">
              {filter === 'unread' ? 'Okunmamış bildirim yok.' : 'Bildirim bulunmuyor.'}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: SOFT_BORDER }}>
            {visible.map((n) => (
              <NotificationRow key={n.id} notification={n} onMarkRead={markOneRead} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NotificationStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: SOFT_BORDER, background: 'rgba(255,255,255,0.015)' }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.36)' }}>{label}</div>
      <div className="mt-1 text-[21px] font-black tabular-nums leading-none" style={{ color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0 }}>
        {value}
      </div>
    </div>
  );
}

function NotificationRow({ notification, onMarkRead }: { notification: Notification; onMarkRead: (n: Notification) => void }) {
  const meta = typeMeta(notification.type);
  const Icon = meta.Icon;
  const href = notificationHref(notification);
  const unread = !notification.isRead;

  return (
    <article
      onClick={() => onMarkRead(notification)}
      className="group relative grid cursor-pointer gap-3 px-4 py-4 transition md:grid-cols-[auto,minmax(0,1fr),auto]"
      style={{
        background: unread
          ? `linear-gradient(90deg, ${meta.color}12, rgba(255,255,255,0.012) 54%, rgba(255,255,255,0.004))`
          : 'rgba(255,255,255,0.004)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = unread ? `${meta.color}16` : 'rgba(255,255,255,0.018)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = unread ? `linear-gradient(90deg, ${meta.color}12, rgba(255,255,255,0.012) 54%, rgba(255,255,255,0.004))` : 'rgba(255,255,255,0.004)'; }}
    >
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: unread ? meta.color : 'rgba(255,255,255,0.10)' }} />

      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
          style={{
            background: `${meta.color}${unread ? '1f' : '10'}`,
            borderColor: `${meta.color}${unread ? '48' : '25'}`,
            color: meta.color,
          }}
        >
          <Icon size={17} />
        </span>
        <div className="hidden h-10 items-center md:flex">
          <span className="h-2 w-2 rounded-full" style={{ background: unread ? meta.color : 'rgba(255,255,255,0.16)' }} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]"
            style={{
              background: `${meta.color}16`,
              border: `1px solid ${meta.color}34`,
              color: meta.color,
            }}
          >
            {typeLabel(notification.type)}
          </span>
          {unread ? (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold" style={{ background: 'rgba(255,122,140,0.10)', color: '#ff9aaa', border: '1px solid rgba(255,122,140,0.20)' }}>
              Yeni
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold" style={{ background: 'rgba(143,215,189,0.08)', color: '#8fd7bd', border: '1px solid rgba(143,215,189,0.16)' }}>
              <Check size={11} /> Okundu
            </span>
          )}
          <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.36)' }}>
            {formatDate(notification.createdAt)}
          </span>
        </div>

        <h2 className="mt-2 truncate text-[14.5px] font-extrabold leading-snug" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0, color: unread ? '#f6f2ea' : 'rgba(250,250,249,0.78)' }}>
          {notification.title}
        </h2>
        <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-6" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0, color: unread ? 'rgba(250,250,249,0.74)' : 'rgba(250,250,249,0.56)' }}>
          {notification.body}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 md:justify-end">
        <span className="text-[11px] font-semibold tabular-nums md:hidden" style={{ color: 'rgba(250,250,249,0.36)' }}>
          {relativeDate(notification.createdAt)}
        </span>
        <div className="flex items-center gap-2">
          {unread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-semibold transition"
              style={{
                background: 'rgba(143,215,189,0.08)',
                border: '1px solid rgba(143,215,189,0.18)',
                color: '#8fd7bd',
              }}
            >
              <Check size={13} /> Okundu
            </button>
          )}
          {href && (
            <Link
              href={href}
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-semibold transition"
              style={{
                background: `${meta.color}12`,
                border: `1px solid ${meta.color}2f`,
                color: meta.color,
              }}
            >
              Aç <ChevronRight size={13} />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
