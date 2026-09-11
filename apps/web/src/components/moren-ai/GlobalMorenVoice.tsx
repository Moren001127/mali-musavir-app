'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Maximize2, MessageSquareText, Mic, MicOff, Minimize2, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { chat, getConversation, listConversations, type Message } from '@/lib/moren-ai';
import {
  getStoredMorenAiConversationId,
  MOREN_AI_CONVERSATION_EVENT,
  setStoredMorenAiConversationId,
} from '@/lib/moren-ai-conversation-state';
import { getCurrentRoute, resolveLocalPortalCommand } from '@/lib/moren-voice-routes';
import { morenVoice, voiceStatusLabel } from '@/lib/moren-voice-session';
import { useMorenVoice } from '@/hooks/useMorenVoice';
import OfficeChatWidget from '@/components/office-chat/OfficeChatWidget';

const ROSE = '#f09aa8';
const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const VOICE_BUTTON_MARGIN = 16;
const CHAT_PANEL_DEFAULT_WIDTH = 380;
const CHAT_PANEL_DEFAULT_HEIGHT = 520;
const CHAT_PANEL_POSITION_KEY = 'moren-ai-chat-panel-position';

type FloatingPoint = { x: number; y: number };

function clampFloatingRect(point: FloatingPoint, width: number, height: number): FloatingPoint {
  if (typeof window === 'undefined') return point;
  const maxX = Math.max(VOICE_BUTTON_MARGIN, window.innerWidth - width - VOICE_BUTTON_MARGIN);
  const maxY = Math.max(VOICE_BUTTON_MARGIN, window.innerHeight - height - VOICE_BUTTON_MARGIN);
  return {
    x: Math.min(Math.max(point.x, VOICE_BUTTON_MARGIN), maxX),
    y: Math.min(Math.max(point.y, VOICE_BUTTON_MARGIN), maxY),
  };
}

/**
 * Üst bar "Konuş" düğmesi — her portal sayfasında. Tıklayınca global ses oturumu
 * başlar/durur; konuşurken orb + halka + dalga göstergesi. Portal dili: gradyan,
 * az altın vurgu, düz gri kutu yok.
 */
function TopbarTalkButton({
  onToggle,
  onExpand,
  showExpand,
}: {
  onToggle: () => void;
  onExpand: () => void;
  showExpand: boolean;
}) {
  const voice = useMorenVoice();
  const active = voice.active;
  const busy = voice.status === 'connecting';
  const thinking = voice.status === 'thinking';
  const label = active ? voiceStatusLabel(voice) : voice.status === 'error' ? 'Tekrar dene' : 'Konuş';
  const isError = voice.status === 'error';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className="group relative flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3.5 transition disabled:opacity-70"
        style={{
          background: active
            ? `linear-gradient(135deg, ${ROSE}, #b8687a 60%, #9f5260)`
            : 'linear-gradient(135deg, rgba(240,154,168,0.18), rgba(212,184,118,0.10) 70%, rgba(255,255,255,0.03))',
          border: `1px solid ${isError ? 'rgba(248,113,113,0.5)' : active ? 'rgba(255,255,255,0.22)' : 'rgba(240,154,168,0.34)'}`,
          boxShadow: active
            ? '0 10px 26px rgba(240,154,168,0.32), inset 0 1px 0 rgba(255,255,255,0.28)'
            : 'inset 0 1px 0 rgba(255,255,255,0.05)',
          color: active ? '#1a1012' : '#fbe3e8',
        }}
        title={active ? 'Sesi kapat' : 'Canlı MOREN AI ile konuş'}
        aria-label={active ? 'Canlı sesi kapat' : 'Canlı MOREN AI ile konuş'}
        aria-pressed={active}
      >
        <span className="relative grid h-6 w-6 shrink-0 place-items-center">
          {active && !busy ? (
            <>
              <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '1.5px solid rgba(255,255,255,0.55)' }} />
              <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '1.5px solid rgba(255,255,255,0.45)', animationDelay: '1.2s' }} />
            </>
          ) : null}
          <span
            className={`grid h-6 w-6 place-items-center rounded-full ${active ? 'moren-voice-orb-live' : ''}`}
            style={{
              background: active
                ? 'radial-gradient(circle at 35% 30%, #fff1f4, #ffd9e0 45%, #f09aa8)'
                : `radial-gradient(circle at 35% 30%, #ffd9e0, ${ROSE} 55%, #9f5260)`,
              color: '#1a1012',
              boxShadow: active ? '0 0 14px rgba(255,255,255,0.35)' : '0 4px 12px rgba(240,154,168,0.35)',
            }}
          >
            {busy || thinking ? <Loader2 size={12} className="animate-spin" /> : voice.status === 'speaking' ? <Sparkles size={12} /> : active ? <MicOff size={12} /> : <Mic size={12} />}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[12.5px] font-black tracking-wide">{label}</span>
          {active && (voice.status === 'listening' || voice.status === 'speaking') ? (
            <span className="flex items-end gap-[2px]" style={{ height: 12 }} aria-hidden>
              {Array.from({ length: 5 }).map((_, index) => (
                <span
                  key={index}
                  className="moren-voice-bar w-[2px] rounded-full"
                  style={{ background: 'rgba(26,16,18,0.75)', animationDelay: `${index * 0.09}s` }}
                />
              ))}
            </span>
          ) : null}
        </span>
        {!active ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
            style={{
              background: isError ? '#f87171' : GOLD,
              border: '2px solid #080807',
              boxShadow: isError ? '0 0 10px rgba(248,113,113,0.8)' : `0 0 10px ${GOLD}`,
            }}
          />
        ) : null}
      </button>
      {showExpand ? (
        <button
          type="button"
          onClick={onExpand}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
          style={{ border: '1px solid rgba(240,154,168,0.22)', color: ROSE, background: 'rgba(240,154,168,0.08)' }}
          title="Ses panelini aç"
          aria-label="Ses panelini aç"
        >
          <Maximize2 size={15} />
        </button>
      ) : null}
    </div>
  );
}

export default function GlobalMorenVoice() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const voice = useMorenVoice();
  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [localChatNotice, setLocalChatNotice] = useState('');
  const [chatPanelPosition, setChatPanelPosition] = useState<FloatingPoint | null>(null);
  const [topbarActionsEl, setTopbarActionsEl] = useState<HTMLElement | null>(null);
  const [desktopTopbar, setDesktopTopbar] = useState(false);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const chatPanelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    width: number;
    height: number;
    dragged: boolean;
  } | null>(null);

  const isPortalPath = !!pathname && (pathname.startsWith('/panel') || pathname.startsWith('/fatura-merkezi'));
  // MOREN AI sayfasının kendi ses şeridi var; orada yüzen paneli göstermeyiz (üst bar
  // "Konuş" düğmesi her sayfada kalır, sayfa aynı global oturumu gösterir).
  const isMorenAiPage = !!pathname && pathname.startsWith('/panel/moren-ai');
  const currentRoute = useMemo(() => getCurrentRoute(pathname), [pathname]);
  const status = voice.status;
  const active = voice.active;

  // Global ses oturumu kancaları: gezinme (router) + sorgu bitince önbellek tazeleme.
  useEffect(() => {
    morenVoice.setHooks({
      navigate: (path) => {
        router.push(path);
        setExpanded(true);
      },
      onQueryDone: (conversationId) => {
        conversationIdRef.current = conversationId;
        setChatConversationId(conversationId);
        qc.invalidateQueries({ queryKey: ['ai-conversations'] }).catch(() => {});
        qc.invalidateQueries({ queryKey: ['ai-conversation', conversationId] }).catch(() => {});
      },
    });
  }, [qc, router]);

  // Sayfa değişince oturum KOPMAZ; yalnız bağlam (aktif ekran) güncellenir.
  useEffect(() => {
    if (isPortalPath) morenVoice.setContext(pathname);
  }, [isPortalPath, pathname]);

  useEffect(() => {
    if (!isPortalPath && voice.active) morenVoice.stop('Portal dışına çıkıldı');
  }, [isPortalPath, voice.active]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isPortalPath) {
      setDesktopTopbar(false);
      setTopbarActionsEl(null);
      return;
    }
    const media = window.matchMedia('(min-width: 1024px)');
    let timer: number | null = null;
    const sync = () => {
      setDesktopTopbar(media.matches);
      const target = document.getElementById('moren-topbar-actions');
      setTopbarActionsEl(target);
      if (target && timer) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    sync();
    timer = window.setInterval(sync, 500);
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
      if (timer) window.clearInterval(timer);
    };
  }, [isPortalPath, pathname]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_PANEL_POSITION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as FloatingPoint;
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        setChatPanelPosition(clampFloatingRect(parsed, CHAT_PANEL_DEFAULT_WIDTH, CHAT_PANEL_DEFAULT_HEIGHT));
      }
    } catch {}
  }, []);

  const saveChatPanelPosition = useCallback((point: FloatingPoint, width = CHAT_PANEL_DEFAULT_WIDTH, height = CHAT_PANEL_DEFAULT_HEIGHT) => {
    const next = clampFloatingRect(point, width, height);
    setChatPanelPosition(next);
    try {
      window.localStorage.setItem(CHAT_PANEL_POSITION_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }, []);

  const handleChatPanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = chatPanelRef.current?.getBoundingClientRect();
    if (!rect) return;
    chatPanelDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleChatPanelPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = chatPanelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.dragged = true;
    if (!drag.dragged) return;
    setChatPanelPosition(clampFloatingRect({ x: drag.startLeft + dx, y: drag.startTop + dy }, drag.width, drag.height));
  }, []);

  const handleChatPanelPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = chatPanelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    chatPanelDragRef.current = null;

    if (drag.dragged) {
      saveChatPanelPosition({
        x: drag.startLeft + event.clientX - drag.startX,
        y: drag.startTop + event.clientY - drag.startY,
      }, drag.width, drag.height);
    }
  }, [saveChatPanelPosition]);

  const rememberConversationId = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setChatConversationId(id);
    setStoredMorenAiConversationId(id);
  }, []);

  useEffect(() => {
    const stored = getStoredMorenAiConversationId();
    if (stored) {
      conversationIdRef.current = stored;
      setChatConversationId(stored);
    }

    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string | null }>).detail?.conversationId || null;
      conversationIdRef.current = id;
      setChatConversationId(id);
    };
    window.addEventListener(MOREN_AI_CONVERSATION_EVENT, handler);
    return () => window.removeEventListener(MOREN_AI_CONVERSATION_EVENT, handler);
  }, []);

  const resolveActiveConversationId = useCallback(async () => {
    const existing = conversationIdRef.current || getStoredMorenAiConversationId();
    if (existing) {
      rememberConversationId(existing);
      return existing;
    }

    try {
      const latest = await qc.fetchQuery({
        queryKey: ['ai-conversations', 'latest'],
        queryFn: () => listConversations(1),
        staleTime: 15_000,
      });
      const id = latest?.[0]?.id || null;
      if (id) rememberConversationId(id);
      return id;
    } catch {
      return null;
    }
  }, [qc, rememberConversationId]);

  const { data: miniConversation, isFetching: miniConversationLoading } = useQuery({
    queryKey: ['ai-conversation', chatConversationId],
    queryFn: () => (chatConversationId ? getConversation(chatConversationId) : Promise.resolve(null)),
    enabled: chatOpen && !!chatConversationId,
    refetchOnWindowFocus: false,
  });

  const miniMessages: Message[] = miniConversation?.messages || [];

  const sendMiniMessage = useMutation({
    mutationFn: async (message: string) => {
      const conversationIdForSend = await resolveActiveConversationId();
      return chat({
        conversationId: conversationIdForSend || undefined,
        message,
        currentPath: pathname || undefined,
      });
    },
    onSuccess: async (result) => {
      rememberConversationId(result.conversationId);
      setChatInput('');
      setLocalChatNotice('');
      await qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      await qc.invalidateQueries({ queryKey: ['ai-conversation', result.conversationId] });
    },
    onError: (error: any) => {
      toast.error('Mesaj gönderilemedi: ' + (error?.response?.data?.message || error?.message || 'Bağlantı hatası'));
    },
  });

  const handleMiniChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sendMiniMessage.isPending) return;

    const localCommand = resolveLocalPortalCommand(text);
    if (localCommand?.type === 'ack') {
      setChatInput('');
      setLocalChatNotice(localCommand.message);
      return;
    }
    if (localCommand?.type === 'navigate') {
      setChatInput('');
      router.push(localCommand.route.path);
      setLocalChatNotice(`${localCommand.route.label} açıldı.`);
      return;
    }

    sendMiniMessage.mutate(text);
  }, [chatInput, router, sendMiniMessage]);

  const startVoice = useCallback(async () => {
    try {
      await morenVoice.start();
    } catch (error: any) {
      toast.error('Canlı MOREN AI başlatılamadı: ' + (error?.message || 'Bağlantı hatası'));
    }
  }, []);

  const toggleVoice = useCallback(() => {
    if (voice.active) {
      morenVoice.stop();
      return;
    }
    if (!isMorenAiPage) setExpanded(true);
    startVoice().catch(() => {});
  }, [isMorenAiPage, startVoice, voice.active]);

  const openMessaging = useCallback(() => {
    setExpanded(false);
    setChatOpen(true);
    resolveActiveConversationId().catch(() => {});
  }, [resolveActiveConversationId]);

  // "Düşünüyor" sayacı: uzun bekleyişte saniye aksın (depo yalnız değişimde tetikler).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!voice.thinkingSince || !expanded) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [voice.thinkingSince, expanded]);

  const statusLabel = voiceStatusLabel(voice);
  const thinkingSeconds = voice.thinkingSince ? Math.max(0, Math.round((Date.now() - voice.thinkingSince) / 1000)) : 0;

  if (!isPortalPath) return null;

  const useTopbarActions = desktopTopbar && !!topbarActionsEl;

  const mobileTrigger = (!expanded && !isMorenAiPage && !useTopbarActions) ? (
    <button
      type="button"
      onClick={() => {
        setExpanded(true);
        if (!voice.active) startVoice().catch(() => {});
      }}
      className="fixed right-6 bottom-6 z-[85] flex h-14 w-14 items-center justify-center rounded-full transition hover:scale-[1.04] lg:hidden"
      style={{
        background: active ? `linear-gradient(135deg, ${ROSE}, #9f5260)` : `linear-gradient(135deg, ${GOLD}, #8b7649)`,
        boxShadow: active ? '0 18px 45px rgba(240,154,168,0.34), inset 0 1px 0 rgba(255,255,255,0.28)' : '0 18px 45px rgba(212,184,118,0.28), inset 0 1px 0 rgba(255,255,255,0.28)',
        color: '#0f0d0b',
      }}
      title="Canlı MOREN AI"
      aria-label="Canlı MOREN AI"
    >
      <span className={`grid h-9 w-9 place-items-center rounded-full ${active ? 'moren-voice-orb-live' : ''}`} style={{ background: 'rgba(255,255,255,0.18)' }}>
        {status === 'connecting' || status === 'thinking' ? <Loader2 size={20} className="animate-spin" /> : active ? <MicOff size={20} /> : <Mic size={20} />}
      </span>
      <span
        className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full"
        style={{ background: '#17110f', border: '1px solid rgba(212,184,118,0.48)', color: GOLD, boxShadow: '0 8px 18px rgba(0,0,0,0.28)' }}
      >
        <MessageSquareText size={12} />
      </span>
    </button>
  ) : null;

  const topbarActions = useTopbarActions
    ? createPortal(
        <>
          <OfficeChatWidget enabled={isPortalPath} triggerMode="topbar" />
          <TopbarTalkButton
            onToggle={toggleVoice}
            onExpand={() => setExpanded(true)}
            showExpand={active && !expanded && !isMorenAiPage}
          />
        </>,
        topbarActionsEl,
      )
    : null;

  return (
    <>
      {topbarActions}
      {!useTopbarActions ? <OfficeChatWidget enabled={isPortalPath} /> : null}
      {mobileTrigger}
      {isMorenAiPage || !expanded ? null : (
        <div
          className="fixed right-6 top-16 z-[85] w-[330px] overflow-hidden rounded-xl border shadow-2xl"
          style={{
            background: 'radial-gradient(120% 90% at 0% 0%, rgba(240,154,168,0.14), transparent 55%), linear-gradient(180deg, rgba(26,18,19,0.98), rgba(10,9,6,0.98))',
            borderColor: status === 'error' ? 'rgba(248,113,113,0.38)' : 'rgba(240,154,168,0.32)',
            boxShadow: '0 22px 70px rgba(0,0,0,0.46), 0 0 35px rgba(240,154,168,0.12)',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg,#f09aa8,#e7b6a0,#d4b876,#c8a25e,#f09aa8)' }} />
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: LINE }}>
            <div className="relative grid h-10 w-10 shrink-0 place-items-center">
              {active && status !== 'connecting' ? (
                <>
                  <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '2px solid rgba(240,154,168,0.5)' }} />
                  <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '2px solid rgba(240,154,168,0.5)', animationDelay: '1.2s' }} />
                </>
              ) : null}
              <div
                className={`grid h-9 w-9 place-items-center rounded-full ${active ? 'moren-voice-orb-live' : ''}`}
                style={{ background: 'radial-gradient(circle at 35% 30%, #ffd9e0, #f09aa8 55%, #9f5260)', color: '#1a1012' }}
              >
                {status === 'connecting' ? <Loader2 size={17} className="animate-spin" /> : <Bot size={17} />}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>Canlı MOREN AI</p>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: status === 'error' ? 'rgba(248,113,113,0.14)' : active ? 'rgba(34,197,94,0.12)' : 'rgba(212,184,118,0.14)',
                    color: status === 'error' ? '#fca5a5' : active ? '#86efac' : GOLD,
                  }}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>
                {voice.koordinator ? 'Muhatap: Koordinatör · ' : ''}{currentRoute.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
              style={{ color: MUTED }}
              title="Küçült"
            >
              <Minimize2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                morenVoice.stop();
                setExpanded(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
              style={{ color: MUTED }}
              title="Kapat"
            >
              <X size={15} />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            <div
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
              style={{
                borderColor: voice.longWait ? 'rgba(212,184,118,0.34)' : LINE,
                background: voice.longWait
                  ? 'linear-gradient(135deg, rgba(212,184,118,0.12), rgba(255,255,255,0.02))'
                  : 'linear-gradient(135deg, rgba(240,154,168,0.07), rgba(255,255,255,0.02))',
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{
                  background: !active || status === 'error' ? 'rgba(212,184,118,0.13)' : 'rgba(34,197,94,0.14)',
                  color: !active || status === 'error' ? GOLD : '#86efac',
                }}
              >
                {status === 'speaking' ? <Sparkles size={15} /> : status === 'thinking' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>{voice.lastAction}</p>
                <p className="truncate text-[10.5px]" style={{ color: MUTED }}>
                  {status === 'thinking'
                    ? voice.longWait
                      ? `${thinkingSeconds} sn — iş uzun sürüyor; sonuç mesajlaşmaya da düşer.`
                      : 'Koordinatör veriyi topluyor…'
                    : 'Ses açıkken modüller arasında çalışmaya devam edebilirsiniz.'}
                </p>
              </div>
            </div>

            {voice.errorText ? (
              <p className="rounded-lg border px-3 py-2 text-[11.5px]" style={{ borderColor: 'rgba(248,113,113,0.28)', color: '#fca5a5', background: 'rgba(248,113,113,0.08)' }}>
                {voice.errorText}
              </p>
            ) : null}

            {voice.lastAnswer ? (
              <p
                className="rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed"
                style={{ borderColor: 'rgba(240,154,168,0.18)', color: 'rgba(250,250,249,0.82)', background: 'rgba(240,154,168,0.06)', whiteSpace: 'pre-wrap' }}
              >
                {voice.lastAnswer.slice(0, 420)}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, color: MUTED, background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)' }}>
                <p>Oturum maliyeti</p>
                <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>${voice.sessionCost.toFixed(4)}</p>
              </div>
              <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, color: MUTED, background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)' }}>
                <p>Canlı token</p>
                <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>{voice.sessionTokens}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={openMessaging}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06]"
                style={{ borderColor: 'rgba(212,184,118,0.26)', color: GOLD, background: 'rgba(212,184,118,0.08)' }}
              >
                <MessageSquareText size={15} />
                Mesajlaşma
              </button>
              <button
                type="button"
                onClick={toggleVoice}
                disabled={status === 'connecting'}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition disabled:opacity-50"
                style={{
                  background: active ? 'rgba(248,113,113,0.16)' : `linear-gradient(135deg, ${ROSE}, #9f5260)`,
                  border: active ? '1px solid rgba(248,113,113,0.34)' : '1px solid rgba(255,255,255,0.12)',
                  color: active ? '#fca5a5' : '#160d10',
                }}
              >
                {status === 'connecting'
                  ? <Loader2 size={15} className="animate-spin" />
                  : active
                    ? <MicOff size={15} />
                    : <Mic size={15} />}
                {active ? 'Sesi Kapat' : 'Canlı Konuş'}
              </button>
            </div>
          </div>
        </div>
      )}
      {chatOpen ? (
        <div
          ref={chatPanelRef}
          className="fixed z-[86] flex max-h-[calc(100vh-48px)] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
          style={{
            ...(chatPanelPosition ? { left: chatPanelPosition.x, top: chatPanelPosition.y } : { right: 24, top: 64 }),
            background: 'linear-gradient(180deg, rgba(18,14,12,0.99), rgba(9,8,6,0.99))',
            borderColor: 'rgba(212,184,118,0.28)',
            boxShadow: '0 24px 75px rgba(0,0,0,0.52), 0 0 36px rgba(212,184,118,0.12)',
          }}
        >
          <div
            className="flex items-center gap-3 border-b px-4 py-3"
            onPointerDown={handleChatPanelPointerDown}
            onPointerMove={handleChatPanelPointerMove}
            onPointerUp={handleChatPanelPointerUp}
            onPointerCancel={handleChatPanelPointerUp}
            style={{ borderColor: LINE, cursor: 'move', touchAction: 'none' }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: 'rgba(212,184,118,0.12)',
                border: '1px solid rgba(212,184,118,0.28)',
                color: GOLD,
              }}
            >
              <MessageSquareText size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>MOREN AI Mesajlaşma</p>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>
                {miniConversation?.title || currentRoute.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
              style={{ color: MUTED }}
              title="Kapat"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-[260px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {miniConversationLoading ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: GOLD }}>
                <Loader2 size={14} className="animate-spin" />
                Konuşma yükleniyor...
              </div>
            ) : miniMessages.length === 0 && !localChatNotice ? (
              <div className="rounded-lg border px-3 py-3 text-[12.5px] leading-relaxed" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.025)' }}>
                Buradan modül değiştirmeden MOREN AI ile yazışabilirsiniz.
              </div>
            ) : null}

            {miniMessages.slice(-8).map((message) => {
              const isUser = message.role === 'user';
              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[82%] rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
                    style={{
                      borderColor: isUser ? 'rgba(212,184,118,0.32)' : LINE,
                      background: isUser ? 'rgba(212,184,118,0.13)' : 'rgba(255,255,255,0.035)',
                      color: TEXT,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {message.content}
                  </div>
                </div>
              );
            })}

            {localChatNotice ? (
              <div className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: 'rgba(212,184,118,0.28)', color: GOLD, background: 'rgba(212,184,118,0.08)' }}>
                {localChatNotice}
              </div>
            ) : null}

            {sendMiniMessage.isPending ? (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: GOLD }}>
                <Loader2 size={14} className="animate-spin" />
                Yanıt hazırlanıyor...
              </div>
            ) : null}
          </div>

          <div className="border-t p-3" style={{ borderColor: LINE }}>
            <div className="flex items-end gap-2 rounded-lg border bg-black/20 p-2" style={{ borderColor: LINE }}>
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleMiniChatSend();
                  }
                }}
                rows={1}
                placeholder="MOREN AI'a yaz..."
                className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none"
                style={{ color: TEXT, caretColor: GOLD, boxShadow: 'none' }}
              />
              <button
                type="button"
                onClick={handleMiniChatSend}
                disabled={!chatInput.trim() || sendMiniMessage.isPending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-semibold transition disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}
                title="Gönder"
              >
                {sendMiniMessage.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
