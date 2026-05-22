'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, Loader2, MessageCircle, Search, Send, UserRound, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMe } from '@/hooks/useAuth';
import { officeChatApi, type OfficeChatThread, type OfficeChatUser } from '@/lib/office-chat';

const GOLD = '#d4b876';
const CHAT = '#8fd8c2';
const CHAT_DARK = '#286d5f';
const LINE = 'rgba(212,184,118,0.16)';
const CHAT_LINE = 'rgba(143,216,194,0.16)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.52)';

export default function OfficeChatWidget({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const threadsQuery = useQuery({
    queryKey: ['office-chat', 'threads'],
    queryFn: officeChatApi.threads,
    enabled,
    refetchInterval: open ? 5000 : 15000,
  });

  const usersQuery = useQuery({
    queryKey: ['office-chat', 'users'],
    queryFn: officeChatApi.users,
    enabled: enabled && open,
    staleTime: 60_000,
  });

  const threads = threadsQuery.data || [];
  const unreadTotal = useMemo(
    () => threads.reduce((sum, thread) => sum + (thread.unreadCount || 0), 0),
    [threads],
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('officeChat') === 'open') {
      setOpen(true);
      const threadId = params.get('threadId');
      if (threadId) setSelectedThreadId(threadId);
    }
  }, [enabled]);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

  const threadQuery = useQuery({
    queryKey: ['office-chat', 'thread', selectedThreadId],
    queryFn: () => officeChatApi.thread(selectedThreadId!),
    enabled: enabled && open && !!selectedThreadId,
    refetchInterval: open ? 5000 : false,
  });

  useEffect(() => {
    if (!threadQuery.data) return;
    queryClient.invalidateQueries({ queryKey: ['office-chat', 'threads'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] });
  }, [threadQuery.data?.id, threadQuery.data?.messages.length, queryClient]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, threadQuery.data?.messages.length]);

  const directMutation = useMutation({
    mutationFn: officeChatApi.openDirect,
    onSuccess: (thread) => {
      setOpen(true);
      setSelectedThreadId(thread.id);
      queryClient.invalidateQueries({ queryKey: ['office-chat', 'threads'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Sohbet acilamadi'),
  });

  const sendMutation = useMutation({
    mutationFn: ({ threadId, content }: { threadId: string; content: string }) =>
      officeChatApi.sendMessage(threadId, content),
    onSuccess: (result) => {
      setInput('');
      setSelectedThreadId(result.thread.id);
      queryClient.invalidateQueries({ queryKey: ['office-chat', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['office-chat', 'thread', result.thread.id] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Mesaj gonderilemedi'),
  });

  if (!enabled) return null;

  const selectedThread = threadQuery.data || threads.find((thread) => thread.id === selectedThreadId);
  const currentUserId = (me as any)?.sub || (me as any)?.id;
  const users = (usersQuery.data || []).filter((user) => !user.isCurrent && matchesSearch(user, search));

  const send = () => {
    const content = input.trim();
    if (!content || !selectedThreadId || sendMutation.isPending) return;
    sendMutation.mutate({ threadId: selectedThreadId, content });
  };

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-24 top-20 z-[84] flex h-14 w-14 items-center justify-center rounded-full transition hover:scale-[1.04]"
          style={{
            background: `linear-gradient(135deg, ${CHAT}, ${CHAT_DARK})`,
            color: '#07110f',
            boxShadow: '0 18px 44px rgba(143,216,194,0.22), inset 0 1px 0 rgba(255,255,255,0.24)',
          }}
          title="Ofis ici mesajlasma"
          aria-label="Ofis ici mesajlasma"
        >
          <MessageCircle size={21} />
          {unreadTotal > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
              style={{ background: '#f43f5e', color: '#fff' }}
            >
              {unreadTotal > 9 ? '9+' : unreadTotal}
            </span>
          ) : null}
        </button>
      ) : (
        <div
          className="fixed right-6 top-36 z-[84] grid h-[560px] max-h-[calc(100vh-160px)] w-[720px] max-w-[calc(100vw-32px)] grid-cols-[210px_minmax(0,1fr)] overflow-hidden rounded-xl border shadow-2xl"
          style={{
            background: 'linear-gradient(180deg, rgba(18,14,12,0.99), rgba(9,8,6,0.99))',
            borderColor: 'rgba(212,184,118,0.28)',
            boxShadow: '0 24px 75px rgba(0,0,0,0.52), 0 0 36px rgba(212,184,118,0.12)',
          }}
        >
          <aside className="flex min-w-0 flex-col border-r" style={{ borderColor: LINE }}>
            <div className="flex items-center gap-3 border-b px-3 py-3" style={{ borderColor: LINE }}>
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'rgba(143,216,194,0.12)', border: '1px solid rgba(143,216,194,0.28)', color: CHAT }}
              >
                <Users size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>Ofis Chat</p>
                <p className="truncate text-[11px]" style={{ color: MUTED }}>
                  {unreadTotal > 0 ? `${unreadTotal} okunmamis` : 'Ekip ici mesajlasma'}
                </p>
              </div>
            </div>

            <div className="border-b p-2" style={{ borderColor: LINE }}>
              <div className="flex items-center gap-2 rounded-lg border px-2" style={{ borderColor: CHAT_LINE, background: 'rgba(255,255,255,0.025)' }}>
                <Search size={13} style={{ color: MUTED }} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Kisi ara"
                  className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none"
                  style={{ color: TEXT }}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <p className="mb-1 px-1 text-[10px] font-bold uppercase" style={{ color: 'rgba(212,184,118,0.72)', letterSpacing: 0 }}>
                Kanallar
              </p>
              <div className="space-y-1">
                {threads.map((thread) => (
                  <ThreadButton
                    key={thread.id}
                    thread={thread}
                    active={thread.id === selectedThreadId}
                    onClick={() => setSelectedThreadId(thread.id)}
                  />
                ))}
              </div>

              <p className="mb-1 mt-4 px-1 text-[10px] font-bold uppercase" style={{ color: 'rgba(212,184,118,0.72)', letterSpacing: 0 }}>
                Kisiler
              </p>
              <div className="space-y-1">
                {usersQuery.isLoading ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-[11px]" style={{ color: MUTED }}>
                    <Loader2 size={12} className="animate-spin" /> Yukleniyor
                  </div>
                ) : users.length === 0 ? (
                  <p className="px-2 py-2 text-[11px]" style={{ color: MUTED }}>Kisi bulunmadi.</p>
                ) : (
                  users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => directMutation.mutate(user.id)}
                      className="flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition hover:bg-white/[0.04]"
                      style={{ borderColor: 'rgba(255,255,255,0.04)', color: TEXT }}
                    >
                      <Avatar name={user.displayName} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{user.displayName}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col">
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: LINE }}>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'rgba(143,216,194,0.12)', border: '1px solid rgba(143,216,194,0.28)', color: CHAT }}
              >
                {selectedThread?.kind === 'GENERAL' ? <Hash size={18} /> : <UserRound size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>
                  {selectedThread?.title || 'Ofis Chat'}
                </p>
                <p className="truncate text-[11px]" style={{ color: MUTED }}>
                  {selectedThread?.kind === 'GENERAL' ? 'Tum ofis kanali' : 'Birebir sohbet'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
                style={{ color: MUTED }}
                title="Kapat"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {threadQuery.isLoading || threadsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: GOLD }}>
                  <Loader2 size={14} className="animate-spin" /> Sohbet yukleniyor...
                </div>
              ) : !selectedThreadId ? (
                <div className="rounded-lg border px-3 py-3 text-[12.5px]" style={{ borderColor: LINE, color: MUTED }}>
                  Genel kanal hazirlaniyor.
                </div>
              ) : (threadQuery.data?.messages || []).length === 0 ? (
                <div className="rounded-lg border px-3 py-3 text-[12.5px] leading-relaxed" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.025)' }}>
                  Ilk mesaji yazin; ekip arkadaslarina bildirim gidecek.
                </div>
              ) : (
                threadQuery.data?.messages.map((message) => {
                  const isMine = message.sender.id === currentUserId;
                  return (
                    <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex max-w-[82%] gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                        {!isMine ? <Avatar name={message.sender.displayName} size={28} /> : null}
                        <div>
                          {!isMine ? (
                            <p className="mb-1 text-[10.5px] font-semibold" style={{ color: 'rgba(212,184,118,0.76)' }}>
                              {message.sender.displayName}
                            </p>
                          ) : null}
                          <div
                            className="rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
                            style={{
                              borderColor: isMine ? 'rgba(212,184,118,0.32)' : LINE,
                              background: isMine ? 'rgba(212,184,118,0.13)' : 'rgba(255,255,255,0.035)',
                              color: TEXT,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {message.content}
                          </div>
                          <p className={`mt-1 text-[10px] ${isMine ? 'text-right' : ''}`} style={{ color: 'rgba(250,250,249,0.32)' }}>
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t p-3" style={{ borderColor: LINE }}>
              <div className="flex items-end gap-2 rounded-lg border bg-black/20 p-2" style={{ borderColor: LINE }}>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Ofise mesaj yaz..."
                  className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none"
                  style={{ color: TEXT, caretColor: GOLD, boxShadow: 'none' }}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!input.trim() || !selectedThreadId || sendMutation.isPending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-semibold transition disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}
                  title="Gonder"
                >
                  {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ThreadButton({
  thread,
  active,
  onClick,
}: {
  thread: OfficeChatThread;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition hover:bg-white/[0.04]"
      style={{
        borderColor: active ? 'rgba(212,184,118,0.34)' : 'rgba(255,255,255,0.04)',
        background: active ? 'rgba(212,184,118,0.10)' : 'transparent',
        color: TEXT,
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: '1px solid rgba(212,184,118,0.22)' }}
      >
        {thread.kind === 'GENERAL' ? <Hash size={14} /> : <UserRound size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold">{thread.title}</span>
        <span className="block truncate text-[10.5px]" style={{ color: MUTED }}>
          {thread.lastMessage?.content || 'Henuz mesaj yok'}
        </span>
      </span>
      {thread.unreadCount > 0 ? (
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: '#f43f5e', color: '#fff' }}>
          {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
        </span>
      ) : null}
    </button>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #d4b876, #8b7649)',
        color: '#0f0d0b',
      }}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
}

function matchesSearch(user: OfficeChatUser, search: string) {
  const term = search.trim().toLocaleLowerCase('tr-TR');
  if (!term) return true;
  const haystack = `${user.displayName} ${user.email}`.toLocaleLowerCase('tr-TR');
  return haystack.includes(term);
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
