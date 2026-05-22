'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, MessageSquareText, Mic, MicOff, Minimize2, Radio, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  chat,
  getConversation,
  getRealtimeVoiceToken,
  listConversations,
  logRealtimeVoiceUsage,
  realtimePortalQuery,
  type Message,
} from '@/lib/moren-ai';
import {
  getStoredMorenAiConversationId,
  MOREN_AI_CONVERSATION_EVENT,
  setStoredMorenAiConversationId,
} from '@/lib/moren-ai-conversation-state';
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

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

type PortalRoute = {
  label: string;
  path: string;
  aliases?: string[];
};

type FloatingPoint = { x: number; y: number };

const PORTAL_ROUTES: PortalRoute[] = [
  { label: 'Gösterge Paneli', path: '/panel', aliases: ['dashboard', 'ana ekran', 'gösterge'] },
  { label: 'MOREN AI', path: '/panel/moren-ai', aliases: ['moren ai', 'yapay zeka', 'ai'] },
  { label: 'Otomasyonlar', path: '/panel/otomasyonlar', aliases: ['otomasyon'] },
  { label: 'Mükellef Listesi', path: '/panel/mukellefler', aliases: ['mükellefler', 'mukellef listesi'] },
  { label: 'İş Akışı', path: '/panel/is-yuku', aliases: ['iş yükü', 'is akisi', 'işler'] },
  { label: 'Görevler & Notlar', path: '/panel/gorevler', aliases: ['görevler', 'notlar'] },
  { label: 'Bildirimler', path: '/panel/bildirimler', aliases: ['bildirim'] },
  { label: 'Fatura İşleme Merkezi', path: '/fatura-merkezi', aliases: ['fatura merkezi', 'fatura muhasebe'] },
  { label: 'E-Fatura / E-Arşiv Sorgulama', path: '/panel/e-arsiv', aliases: ['e arşiv', 'e fatura', 'earsiv'] },
  { label: 'Fatura İşleme', path: '/panel/ajanlar/mihsap', aliases: ['mihsap', 'mihsap fatura'] },
  { label: 'İşlenen Faturalar', path: '/panel/faturalar', aliases: ['faturalar'] },
  { label: 'Fiş Yazdırma', path: '/panel/fis-yazdirma', aliases: ['fiş', 'fis yazdirma'] },
  { label: 'Banka Takip', path: '/panel/banka-takip', aliases: ['banka'] },
  { label: 'Mükellef Profilleri', path: '/panel/ajanlar/profiller', aliases: ['profiller'] },
  { label: 'KDV Kontrol', path: '/panel/kdv-kontrol', aliases: ['kdv'] },
  { label: 'KDV Beyanname', path: '/panel/kdv-beyanname', aliases: ['kdv beyan'] },
  { label: 'Beyannameler', path: '/panel/beyannameler', aliases: ['beyanname'] },
  { label: 'e-Tebligat Kontrol', path: '/panel/ajanlar/tebligat', aliases: ['tebligat'] },
  { label: 'SGK Otomasyonu', path: '/panel/ajanlar/sgk', aliases: ['sgk'] },
  { label: 'Mizan', path: '/panel/mizan', aliases: ['mizan'] },
  { label: 'İşletme Hesap Özeti', path: '/panel/isletme-hesap-ozeti', aliases: ['işletme', 'isletme hesap'] },
  { label: 'Gelir Tablosu', path: '/panel/gelir-tablosu', aliases: ['gelir'] },
  { label: 'Bilanço', path: '/panel/bilanco', aliases: ['bilanço', 'bilanco'] },
  { label: 'E-Defter Kontrol', path: '/panel/ajanlar/e-defter', aliases: ['edefter', 'e defter'] },
  { label: 'Cari Kasa & Tahsilat', path: '/panel/cari-kasa', aliases: ['cari', 'kasa', 'tahsilat'] },
  { label: 'Duyurular', path: '/panel/duyurular', aliases: ['duyuru'] },
  { label: 'HGS İhlal Sorgulama', path: '/panel/galeri/hgs-ihlal', aliases: ['hgs'] },
  { label: 'WhatsApp Otomasyonu', path: '/panel/hatirlatmalar', aliases: ['whatsapp otomasyon', 'hatırlatmalar'] },
  { label: 'WhatsApp QR', path: '/panel/whatsapp-qr', aliases: ['whatsapp qr', 'qr'] },
  { label: 'Tüm Ajanlar', path: '/panel/ajanlar', aliases: ['ajanlar', 'tüm ajanlar'] },
  { label: 'Luca Oturumu', path: '/panel/ajanlar/luca', aliases: ['luca'] },
  { label: 'Sağlık Panosu', path: '/panel/ajan-saglik', aliases: ['sağlık', 'ajan sağlık'] },
  { label: 'Yapılan İşlemler', path: '/panel/ajanlar/loglar', aliases: ['loglar', 'işlem geçmişi'] },
  { label: 'Ayarlar', path: '/panel/ayarlar', aliases: ['ayar'] },
  { label: 'Denetim Günlüğü', path: '/panel/ayarlar/denetim', aliases: ['denetim'] },
  { label: 'Kilitli Modüller', path: '/panel/sistem/kilitli-moduller', aliases: ['kilitli'] },
];

const PORTAL_QUERY_TOOL = {
  type: 'function',
  name: 'portal_query',
  description:
    'Portal verisi, mükellef, vergi, SGK, beyan, mali tablo, hafıza, WhatsApp ve ofis işi sorularını MOREN AI backendine iletir.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Kullanıcının sesli isteğinin kısa ve net metin hali.',
      },
    },
    required: ['question'],
  },
};

const PORTAL_NAVIGATE_TOOL = {
  type: 'function',
  name: 'portal_navigate',
  description:
    'Kullanıcı portalda bir modüle geçmek istediğinde sayfa değiştirmek için kullanılır. Konuşma devam eder.',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Gidilecek modül adı veya portal yolu.',
      },
    },
    required: ['target'],
  },
};

function normalizeKey(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/]+/g, '');
}

function resolveRoute(target: string) {
  const raw = String(target || '').trim();
  if (!raw) return null;
  if ((raw === '/fatura-merkezi' || raw.startsWith('/panel')) && !raw.includes('://')) {
    const exact = PORTAL_ROUTES.find((route) => route.path === raw);
    return exact || { label: raw, path: raw };
  }

  const key = normalizeKey(raw);
  return PORTAL_ROUTES.find((route) => {
    if (normalizeKey(route.label) === key) return true;
    if (normalizeKey(route.path) === key) return true;
    return (route.aliases || []).some((alias) => normalizeKey(alias) === key);
  }) || null;
}

function getCurrentRoute(pathname: string | null) {
  const path = pathname || '';
  const exact = PORTAL_ROUTES.find((route) => route.path === path);
  if (exact) return exact;
  return [...PORTAL_ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((route) => route.path !== '/panel' && path.startsWith(route.path)) || PORTAL_ROUTES[0];
}

function resolveLocalPortalCommand(text: string) {
  const key = normalizeKey(text);
  if (!key) return null;

  if (/^(tamam|ok|olur|evet|hayir|hayır|sagol|sağol|tesekkurler|teşekkürler)$/.test(key)) {
    return { type: 'ack' as const, message: 'Tamam.' };
  }

  const hasCommand = /(ac|aç|git|gid|gec|geç|goster|göster|listele|ekran|sayfa)/i.test(text);
  for (const route of PORTAL_ROUTES) {
    const names = [route.label, route.path, ...(route.aliases || [])].map(normalizeKey);
    if (names.some((name) => key === name || (hasCommand && key.includes(name)))) {
      return { type: 'navigate' as const, route };
    }
  }

  return null;
}

function realtimeInstructions(currentModule: string, currentPath: string) {
  const moduleList = PORTAL_ROUTES.map((route) => `${route.label}: ${route.path}`).join(' | ');
  return [
    'Türkçe konuş. Kadın sesli, doğal, sıcak ve sakin ol.',
    'Sen portal genelinde çalışan canlı MOREN AI ses katmanısın.',
    'Kullanıcı bir modüle geçmek isterse portal_navigate toolunu kullan; konuşmayı kapatma.',
    'Kullanıcı veri, mükellef, mali tablo, beyan, SGK, WhatsApp veya ofis işi sorarsa portal_query toolunu kullan.',
    'Selamlaşma, tamam/evet/hayır gibi kısa onaylar ve sohbet niteliğindeki cümlelerde portal_query kullanma; doğrudan çok kısa cevap ver.',
    'Cevapları kısa, net ve mesleki tut: 1-3 cümle.',
    'Karşındaki kişi mali müşavir meslek mensubu; "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme.',
    `Aktif ekran: ${currentModule} (${currentPath || '/panel'}).`,
    `Gezilebilir modüller: ${moduleList}.`,
  ].join(' ');
}

function clampFloatingRect(point: FloatingPoint, width: number, height: number): FloatingPoint {
  if (typeof window === 'undefined') return point;
  const maxX = Math.max(VOICE_BUTTON_MARGIN, window.innerWidth - width - VOICE_BUTTON_MARGIN);
  const maxY = Math.max(VOICE_BUTTON_MARGIN, window.innerHeight - height - VOICE_BUTTON_MARGIN);
  return {
    x: Math.min(Math.max(point.x, VOICE_BUTTON_MARGIN), maxX),
    y: Math.min(Math.max(point.y, VOICE_BUTTON_MARGIN), maxY),
  };
}

export default function GlobalMorenVoice() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [localChatNotice, setLocalChatNotice] = useState('');
  const [lastAction, setLastAction] = useState('Hazır');
  const [errorText, setErrorText] = useState('');
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [chatPanelPosition, setChatPanelPosition] = useState<FloatingPoint | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const activeRef = useRef(false);
  const modelRef = useRef('gpt-realtime-mini');
  const startedAtRef = useRef(0);
  const loggedResponsesRef = useRef<Set<string>>(new Set());
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
  const currentRoute = useMemo(() => getCurrentRoute(pathname), [pathname]);

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
    setConversationId(id);
    setChatConversationId(id);
    setStoredMorenAiConversationId(id);
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const stored = getStoredMorenAiConversationId();
    if (stored) {
      conversationIdRef.current = stored;
      setConversationId(stored);
      setChatConversationId(stored);
    }

    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string | null }>).detail?.conversationId || null;
      conversationIdRef.current = id;
      setConversationId(id);
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
      setLastAction(`${localCommand.route.label} açıldı`);
      return;
    }

    sendMiniMessage.mutate(text);
  }, [chatInput, router, sendMiniMessage]);

  const sendRealtimeEvent = useCallback((payload: any) => {
    const dc = dataChannelRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(payload));
  }, []);

  const stopVoice = useCallback(() => {
    activeRef.current = false;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    setStatus('idle');
    setLastAction('Durduruldu');
  }, []);

  const recordUsage = useCallback(async (event: any) => {
    const response = event?.response;
    const usage = response?.usage;
    const responseId = response?.id || event?.event_id;
    if (!usage || !responseId || loggedResponsesRef.current.has(responseId)) return;
    loggedResponsesRef.current.add(responseId);
    try {
      const activeConversationId = await resolveActiveConversationId();
      const logged = await logRealtimeVoiceUsage({
        conversationId: activeConversationId || undefined,
        model: modelRef.current,
        responseId,
        usage,
        durationMs: startedAtRef.current ? Date.now() - startedAtRef.current : undefined,
      });
      setSessionCost((value) => value + (logged.costUsd || 0));
      setSessionTokens((value) => value + (logged.inputTokens || 0) + (logged.outputTokens || 0));
    } catch {
      // Ses akışı maliyet logu yüzünden kesilmesin.
    }
  }, [resolveActiveConversationId]);

  const sendFunctionOutput = useCallback((call: any, output: any) => {
    sendRealtimeEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output),
      },
    });
  }, [sendRealtimeEvent]);

  const runPortalQuery = useCallback(async (call: any, args: any) => {
    const question = String(args?.question || '').trim();
    if (!question) {
      sendFunctionOutput(call, { ok: false, answer: 'Soruyu net duyamadım, tekrar söyler misiniz?' });
      return;
    }

    setStatus('thinking');
    setLastAction('Yanıt hazırlanıyor');
    const activeConversationId = await resolveActiveConversationId();
    const result = await realtimePortalQuery({
      conversationId: activeConversationId || undefined,
      question,
      currentPath: pathname || undefined,
    });
    rememberConversationId(result.conversationId);
    await qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    await qc.invalidateQueries({ queryKey: ['ai-conversation', result.conversationId] });
    sendFunctionOutput(call, {
      ok: true,
      answer: result.assistantMessage,
      conversationId: result.conversationId,
      usage: result.usage,
    });
    setLastAction('Yanıt hazırlandı');
  }, [pathname, qc, rememberConversationId, resolveActiveConversationId, sendFunctionOutput]);

  const runNavigation = useCallback((call: any, args: any) => {
    const route = resolveRoute(String(args?.target || ''));
    if (!route) {
      sendFunctionOutput(call, {
        ok: false,
        answer: 'Bu modülü bulamadım. Modül adını bir kez daha söyleyin.',
      });
      return;
    }
    router.push(route.path);
    setExpanded(true);
    setLastAction(`${route.label} açıldı`);
    sendFunctionOutput(call, {
      ok: true,
      answer: `${route.label} ekranını açtım. Konuşmaya devam edebilirsiniz.`,
      path: route.path,
      label: route.label,
    });
  }, [router, sendFunctionOutput]);

  const handleFunctionCall = useCallback(async (call: any) => {
    let args: any = {};
    try {
      args = call?.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = {};
    }

    try {
      if (call?.name === 'portal_navigate') {
        runNavigation(call, args);
      } else if (call?.name === 'portal_query') {
        await runPortalQuery(call, args);
      } else {
        sendFunctionOutput(call, { ok: false, answer: 'Bu sesli işlem şu an desteklenmiyor.' });
      }
    } catch (error: any) {
      sendFunctionOutput(call, {
        ok: false,
        answer: 'Portal işlemi tamamlanamadı; bağlantıyı kontrol edip tekrar deneyelim.',
        error: error?.response?.data?.message || error?.message || 'tool_failed',
      });
      setStatus('error');
      setErrorText(error?.response?.data?.message || error?.message || 'İşlem tamamlanamadı');
    }
  }, [runNavigation, runPortalQuery, sendFunctionOutput]);

  const handleRealtimeEvent = useCallback(async (raw: MessageEvent) => {
    let event: any;
    try {
      event = JSON.parse(String(raw.data || '{}'));
    } catch {
      return;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      setStatus('listening');
      setErrorText('');
      sendRealtimeEvent({ type: 'response.cancel' });
    }
    if (event.type === 'input_audio_buffer.speech_stopped') setStatus('thinking');
    if (event.type === 'response.created') setStatus('thinking');
    if (event.type === 'response.audio.delta' || event.type === 'response.audio_transcript.delta') setStatus('speaking');
    if (event.type !== 'response.done') return;

    await recordUsage(event);
    const calls = (event?.response?.output || []).filter((item: any) => item?.type === 'function_call');
    if (calls.length > 0) {
      for (const call of calls) await handleFunctionCall(call);
      sendRealtimeEvent({
        type: 'response.create',
        response: {
          tool_choice: 'none',
          instructions:
            'Tool çıktısındaki answer alanlarını temel alarak kısa, doğal Türkçe cevap ver. En fazla 1-3 cümle. Konuşmanın devam ettiğini hissettir.',
        },
      });
      return;
    }

    if (activeRef.current) setStatus('listening');
  }, [handleFunctionCall, recordUsage, sendRealtimeEvent]);

  const startVoice = useCallback(async () => {
    if (peerRef.current) return;
    setExpanded(true);
    setStatus('connecting');
    setErrorText('');
    setLastAction('Bağlanıyor');
    setSessionCost(0);
    setSessionTokens(0);
    startedAtRef.current = Date.now();
    loggedResponsesRef.current = new Set();

    try {
      const tokenData = await getRealtimeVoiceToken();
      modelRef.current = tokenData?.model || tokenData?.session?.model || 'gpt-realtime-mini';
      const ephemeralKey =
        tokenData?.value ||
        tokenData?.client_secret?.value ||
        tokenData?.clientSecret?.value ||
        tokenData?.secret?.value;
      if (!ephemeralKey) throw new Error('Realtime oturum anahtarı alınamadı');

      const pc = new RTCPeerConnection();
      peerRef.current = pc;
      activeRef.current = true;

      pc.ontrack = async (event) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = event.streams[0];
        audioRef.current.autoplay = true;
        await audioRef.current.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          stopVoice();
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;
      dc.onmessage = (event) => {
        handleRealtimeEvent(event).catch(() => {});
      };
      dc.onopen = () => {
        setStatus('listening');
        setLastAction('Dinliyor');
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            instructions: realtimeInstructions(currentRoute.label, pathname || '/panel'),
            tools: [PORTAL_QUERY_TOOL, PORTAL_NAVIGATE_TOOL],
            tool_choice: 'auto',
          },
        }));
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpResponse.ok) {
        const text = await sdpResponse.text();
        throw new Error(text.slice(0, 200) || 'Canlı ses bağlantısı kurulamadı');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
    } catch (error: any) {
      stopVoice();
      setStatus('error');
      setErrorText(error?.response?.data?.message || error?.message || 'Canlı ses başlatılamadı');
      toast.error('Canlı MOREN AI başlatılamadı: ' + (error?.response?.data?.message || error?.message || 'Bağlantı hatası'));
    }
  }, [currentRoute.label, handleRealtimeEvent, pathname, stopVoice]);

  useEffect(() => {
    if (!isPortalPath && activeRef.current) stopVoice();
  }, [isPortalPath, stopVoice]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  useEffect(() => {
    if (!activeRef.current || dataChannelRef.current?.readyState !== 'open') return;
    sendRealtimeEvent({
      type: 'session.update',
      session: {
        instructions: realtimeInstructions(currentRoute.label, pathname || '/panel'),
        tools: [PORTAL_QUERY_TOOL, PORTAL_NAVIGATE_TOOL],
        tool_choice: 'auto',
      },
    });
    setLastAction(`${currentRoute.label} ekranındasınız`);
  }, [currentRoute.label, pathname, sendRealtimeEvent]);

  const openMessaging = useCallback(() => {
    setExpanded(false);
    setChatOpen(true);
    resolveActiveConversationId().catch(() => {});
  }, [resolveActiveConversationId]);

  const statusLabel = status === 'connecting'
    ? 'Bağlanıyor'
    : status === 'listening'
      ? 'Dinliyor'
      : status === 'thinking'
        ? 'Düşünüyor'
        : status === 'speaking'
          ? 'Konuşuyor'
          : status === 'error'
            ? 'Hata'
            : 'Hazır';

  if (!isPortalPath) return null;

  return (
    <>
      <OfficeChatWidget enabled={isPortalPath} />
      <audio ref={audioRef} />
      {!expanded ? (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            if (status === 'idle' || status === 'error') startVoice().catch(() => {});
          }}
          className="fixed z-[85] flex h-14 w-14 items-center justify-center rounded-full transition hover:scale-[1.04]"
          style={{
            right: 24,
            bottom: 24,
            background: `linear-gradient(135deg, ${GOLD}, #8b7649)`,
            boxShadow: '0 18px 45px rgba(212,184,118,0.28), inset 0 1px 0 rgba(255,255,255,0.28)',
            color: '#0f0d0b',
          }}
          title="Canlı MOREN AI"
          aria-label="Canlı MOREN AI"
        >
          <Radio size={22} />
          <span
            className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: '#17110f',
              border: '1px solid rgba(212,184,118,0.48)',
              color: GOLD,
              boxShadow: '0 8px 18px rgba(0,0,0,0.28)',
            }}
          >
            <MessageSquareText size={12} />
          </span>
          <span
            className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full"
            style={{
              background: status === 'idle' || status === 'error' ? GOLD : '#22c55e',
              border: '2px solid #0f0d0b',
              boxShadow: status === 'idle' || status === 'error' ? `0 0 12px ${GOLD}` : '0 0 12px rgba(34,197,94,0.8)',
            }}
          />
        </button>
      ) : (
        <div
          className="fixed bottom-6 right-6 z-[85] w-[330px] overflow-hidden rounded-xl border shadow-2xl"
          style={{
            background: 'linear-gradient(180deg, rgba(26,18,19,0.98), rgba(10,9,6,0.98))',
            borderColor: status === 'error' ? 'rgba(248,113,113,0.38)' : 'rgba(240,154,168,0.32)',
            boxShadow: '0 22px 70px rgba(0,0,0,0.46), 0 0 35px rgba(240,154,168,0.12)',
          }}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: LINE }}>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: 'rgba(240,154,168,0.14)',
                border: '1px solid rgba(240,154,168,0.28)',
                color: ROSE,
              }}
            >
              {status === 'connecting' ? <Loader2 size={18} className="animate-spin" /> : <Bot size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[13px] font-bold" style={{ color: TEXT }}>Canlı MOREN AI</p>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: status === 'error' ? 'rgba(248,113,113,0.14)' : 'rgba(34,197,94,0.12)',
                    color: status === 'error' ? '#fca5a5' : '#86efac',
                  }}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>{currentRoute.label}</p>
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
                stopVoice();
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
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.025)' }}>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{
                  background: status === 'idle' || status === 'error' ? 'rgba(212,184,118,0.13)' : 'rgba(34,197,94,0.14)',
                  color: status === 'idle' || status === 'error' ? GOLD : '#86efac',
                }}
              >
                {status === 'speaking' ? <Sparkles size={15} /> : status === 'thinking' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>{lastAction}</p>
                <p className="truncate text-[10.5px]" style={{ color: MUTED }}>
                  Ses açıkken modüller arasında çalışmaya devam edebilirsiniz.
                </p>
              </div>
            </div>

            {errorText ? (
              <p className="rounded-lg border px-3 py-2 text-[11.5px]" style={{ borderColor: 'rgba(248,113,113,0.28)', color: '#fca5a5', background: 'rgba(248,113,113,0.08)' }}>
                {errorText}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, color: MUTED }}>
                <p>Oturum maliyeti</p>
                <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>${sessionCost.toFixed(4)}</p>
              </div>
              <div className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, color: MUTED }}>
                <p>Canlı token</p>
                <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>{sessionTokens}</p>
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
                onClick={() => (activeRef.current ? stopVoice() : startVoice())}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition disabled:opacity-50"
                style={{
                  background: activeRef.current ? 'rgba(248,113,113,0.16)' : `linear-gradient(135deg, ${ROSE}, #9f5260)`,
                  border: activeRef.current ? '1px solid rgba(248,113,113,0.34)' : '1px solid rgba(255,255,255,0.12)',
                  color: activeRef.current ? '#fca5a5' : '#160d10',
                }}
              >
                {status === 'connecting'
                  ? <Loader2 size={15} className="animate-spin" />
                  : activeRef.current
                    ? <MicOff size={15} />
                    : <Mic size={15} />}
                {activeRef.current ? 'Sesi Kapat' : 'Canlı Konuş'}
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
            ...(chatPanelPosition ? { left: chatPanelPosition.x, top: chatPanelPosition.y } : { right: 24, bottom: 24 }),
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
