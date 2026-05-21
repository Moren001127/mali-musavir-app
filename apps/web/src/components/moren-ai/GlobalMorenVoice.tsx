'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Mic, MicOff, Minimize2, Navigation, Radio, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getRealtimeVoiceToken,
  logRealtimeVoiceUsage,
  realtimePortalQuery,
} from '@/lib/moren-ai';

const ROSE = '#f09aa8';
const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

type PortalRoute = {
  label: string;
  path: string;
  aliases?: string[];
};

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

function realtimeInstructions(currentModule: string, currentPath: string) {
  const moduleList = PORTAL_ROUTES.map((route) => `${route.label}: ${route.path}`).join(' | ');
  return [
    'Türkçe konuş. Kadın sesli, doğal, sıcak ve sakin ol.',
    'Sen portal genelinde çalışan canlı MOREN AI ses katmanısın.',
    'Kullanıcı bir modüle geçmek isterse portal_navigate toolunu kullan; konuşmayı kapatma.',
    'Kullanıcı veri, mükellef, mali tablo, beyan, SGK, WhatsApp veya ofis işi sorarsa portal_query toolunu kullan.',
    'Cevapları kısa, net ve mesleki tut: 1-3 cümle.',
    'Karşındaki kişi mali müşavir meslek mensubu; "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme.',
    `Aktif ekran: ${currentModule} (${currentPath || '/panel'}).`,
    `Gezilebilir modüller: ${moduleList}.`,
  ].join(' ');
}

export default function GlobalMorenVoice() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState('Hazır');
  const [errorText, setErrorText] = useState('');
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionTokens, setSessionTokens] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const activeRef = useRef(false);
  const modelRef = useRef('gpt-realtime-mini');
  const startedAtRef = useRef(0);
  const loggedResponsesRef = useRef<Set<string>>(new Set());
  const conversationIdRef = useRef<string | null>(null);

  const isPortalPath = !!pathname && (pathname.startsWith('/panel') || pathname.startsWith('/fatura-merkezi'));
  const currentRoute = useMemo(() => getCurrentRoute(pathname), [pathname]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

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
      const logged = await logRealtimeVoiceUsage({
        conversationId: conversationIdRef.current || undefined,
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
  }, []);

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
    setLastAction('Portal verisi okunuyor');
    const result = await realtimePortalQuery({
      conversationId: conversationIdRef.current || undefined,
      question,
      currentPath: pathname || undefined,
    });
    conversationIdRef.current = result.conversationId;
    setConversationId(result.conversationId);
    await qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    await qc.invalidateQueries({ queryKey: ['ai-conversation', result.conversationId] });
    sendFunctionOutput(call, {
      ok: true,
      answer: result.assistantMessage,
      conversationId: result.conversationId,
      usage: result.usage,
    });
    setLastAction('Yanıt hazırlandı');
  }, [pathname, qc, sendFunctionOutput]);

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
            tool_choice: 'required',
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
        tool_choice: 'required',
      },
    });
    setLastAction(`${currentRoute.label} ekranındasınız`);
  }, [currentRoute.label, pathname, sendRealtimeEvent]);

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
      <audio ref={audioRef} />
      {!expanded ? (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            if (status === 'idle' || status === 'error') startVoice().catch(() => {});
          }}
          className="fixed bottom-24 right-6 z-[85] flex h-14 w-14 items-center justify-center rounded-full transition hover:scale-[1.04]"
          style={{
            background: `linear-gradient(135deg, ${ROSE}, #7d4350)`,
            boxShadow: '0 18px 45px rgba(240,154,168,0.28), inset 0 1px 0 rgba(255,255,255,0.24)',
            color: '#160d10',
          }}
          title="Canlı MOREN AI"
          aria-label="Canlı MOREN AI"
        >
          <Radio size={22} />
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
              onClick={stopVoice}
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
              <button
                type="button"
                onClick={() => router.push('/panel/moren-ai')}
                className="flex h-10 w-10 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]"
                style={{ borderColor: LINE, color: ROSE }}
                title="MOREN AI ekranı"
              >
                <Navigation size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
