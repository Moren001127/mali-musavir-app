'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import {
  Bot,
  Brain,
  CheckCircle2,
  DollarSign,
  Edit3,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  chat,
  confirmAgentCommand,
  deleteConversation,
  getConversation,
  getOfficeBrain,
  getRealtimeVoiceToken,
  logRealtimeVoiceUsage,
  listConversations,
  realtimePortalQuery,
  renameConversation,
  saveMemory,
  searchMemories,
  synthesize,
  transcribe,
  type ConversationSummary,
  type Message,
} from '@/lib/moren-ai';
import { api } from '@/lib/api';
import {
  getStoredMorenAiConversationId,
  MOREN_AI_CONVERSATION_EVENT,
  setStoredMorenAiConversationId,
} from '@/lib/moren-ai-conversation-state';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(255,255,255,0.08)';
const LINE_GOLD = 'rgba(212,184,118,0.22)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.56)';
const SOFT = 'rgba(255,255,255,0.035)';

const REALTIME_PORTAL_TOOL = {
  type: 'function',
  name: 'portal_query',
  description:
    'Her sesli kullanıcı sorusunu MOREN AI portal backendine iletir. Vergi, SGK, hukuk, mevzuat, mükellef, mali tablo, hafıza, maliyet ve portal işlemlerinde mutlaka bunu kullan.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Kullanıcının sesli sorusunun kısa ve net metin hali.',
      },
    },
    required: ['question'],
  },
};

function realtimeInstructions(selectedName?: string) {
  return [
    'Türkçe konuş. Kadın sesli, doğal ve sakin ol.',
    'Sen MOREN AI ses katmanısın; veri, mükellef, vergi, SGK, beyan, mali tablo, hafıza veya portal işlemi gereken sorularda portal_query toolunu çağır.',
    'Selamlaşma, tamam/evet/hayır gibi kısa onaylar ve sohbet niteliğindeki cümlelerde portal_query kullanma; doğrudan çok kısa cevap ver.',
    'Mali/vergi/hukuk cevabı gerekiyorsa cevabı MOREN AI backendinden gelen sonuca göre söyle; kendi başına üretme.',
    'Karşındaki kişi mali müşavir meslek mensubu; asla "mali müşavire danışın", "uzmana başvurun" veya sorumluluk reddi deme.',
    'Cevaplar kısa, net ve mesleki olsun: 1-3 cümle.',
    selectedName ? `Seçili mükellef: ${selectedName}.` : 'Seçili mükellef yok; genel ofis sorusu.',
  ].join(' ');
}

type Taxpayer = {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

function taxpayerName(t: Taxpayer) {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isimsiz)';
}

type RecorderOptions = {
  autoStopOnSilence?: boolean;
  silenceMs?: number;
  maxDurationMs?: number;
  onAutoStop?: (blob: Blob) => void;
};

function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopResolversRef = useRef<Array<(blob: Blob | null) => void>>([]);
  const cleanupAudioRef = useRef<() => void>(() => {});
  const autoStopRef = useRef(false);
  const optionsRef = useRef<RecorderOptions>({});

  async function start(options: RecorderOptions = {}): Promise<void> {
    try {
      if (recorderRef.current?.state === 'recording') return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      optionsRef.current = options;
      autoStopRef.current = false;
      cleanupAudioRef.current = () => {};
      chunksRef.current = [];
      rec.ondataavailable = (event) => chunksRef.current.push(event.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        cleanupAudioRef.current();
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setMediaRecorder(null);
        setRecording(false);
        const resolvers = stopResolversRef.current.splice(0);
        resolvers.forEach((resolve) => resolve(blob));
        if (autoStopRef.current && blob.size > 1000) {
          optionsRef.current.onAutoStop?.(blob);
        }
        autoStopRef.current = false;
      };
      rec.start();
      recorderRef.current = rec;
      setMediaRecorder(rec);
      setRecording(true);

      if (options.autoStopOnSilence) {
        const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;
        const audioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const startedAt = Date.now();
        const silenceMs = options.silenceMs || 1300;
        const maxDurationMs = options.maxDurationMs || 45_000;
        let heardVoice = false;
        let lastVoiceAt = Date.now();
        const interval = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let index = 0; index < data.length; index++) {
            peak = Math.max(peak, Math.abs(data[index] - 128));
          }
          const now = Date.now();
          if (peak > 8) {
            heardVoice = true;
            lastVoiceAt = now;
          }
          const silentEnough = heardVoice && now - lastVoiceAt > silenceMs && now - startedAt > 900;
          const tooLong = now - startedAt > maxDurationMs;
          if ((silentEnough || tooLong) && recorderRef.current?.state === 'recording') {
            stop(true).catch(() => {});
          }
        }, 180);
        cleanupAudioRef.current = () => {
          window.clearInterval(interval);
          audioContext.close().catch(() => {});
        };
      }
    } catch {
      toast.error('Mikrofon izni reddedildi veya kullanılamıyor');
    }
  }

  async function stop(autoStop = false): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recorderRef.current || mediaRecorder;
      if (!rec || rec.state === 'inactive') return resolve(null);
      autoStopRef.current = autoStop;
      stopResolversRef.current.push(resolve);
      cleanupAudioRef.current();
      rec.stop();
    });
  }

  return { recording, start, stop };
}

export default function MorenAIPage() {
  const qc = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isDraftingNewChat, setIsDraftingNewChat] = useState(false);
  const [input, setInput] = useState('');
  const [selectedTaxpayerId, setSelectedTaxpayerId] = useState('');
  const [taxpayerPickerOpen, setTaxpayerPickerOpen] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking'>('idle');
  const [realtimeSessionCost, setRealtimeSessionCost] = useState(0);
  const [realtimeSessionTokens, setRealtimeSessionTokens] = useState(0);
  const [memoryText, setMemoryText] = useState('');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voiceModeRef = useRef(false);
  const voiceSendRef = useRef(false);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeActiveRef = useRef(false);
  const realtimeModelRef = useRef('gpt-realtime-mini');
  const realtimeStartedAtRef = useRef<number>(0);
  const realtimeResponsesLoggedRef = useRef<Set<string>>(new Set());
  const activeConversationIdRef = useRef<string | null>(null);
  const selectedTaxpayerIdRef = useRef('');
  const restartVoiceRef = useRef<() => void>(() => {});
  const handleVoiceBlobRef = useRef<(blob: Blob | null) => void>(() => {});
  const recorder = useRecorder();

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-mini'],
    queryFn: async () => {
      const { data } = await api.get('/taxpayers', { params: { search: '' } });
      return Array.isArray(data) ? data : data?.taxpayers || data?.data || [];
    },
  });

  const { data: officeBrain, isLoading: brainLoading, refetch: refetchBrain } = useQuery({
    queryKey: ['moren-ai-office-brain'],
    queryFn: () => getOfficeBrain(),
    refetchInterval: 60_000,
  });

  const { data: memoryData } = useQuery({
    queryKey: ['moren-ai-memories', selectedTaxpayerId || 'office'],
    queryFn: () => searchMemories({
      taxpayerId: selectedTaxpayerId || undefined,
      limit: 6,
    }),
  });

  const { data: conversations = [] } = useQuery<ConversationSummary[]>({
    queryKey: ['ai-conversations'],
    queryFn: () => listConversations(30),
  });

  useEffect(() => {
    if (!activeConversationId && !isDraftingNewChat && conversations.length > 0) {
      const stored = getStoredMorenAiConversationId();
      const storedConversation = stored ? conversations.find((conversation) => conversation.id === stored) : null;
      setActiveConversationId(storedConversation?.id || conversations[0].id);
    }
  }, [activeConversationId, conversations, isDraftingNewChat]);

  const { data: activeConv } = useQuery({
    queryKey: ['ai-conversation', activeConversationId],
    queryFn: () => (activeConversationId ? getConversation(activeConversationId) : Promise.resolve(null)),
    enabled: !!activeConversationId,
    refetchOnWindowFocus: false,
  });

  const messages: Message[] = activeConv?.messages || [];
  const selectedTaxpayer = taxpayers.find((item) => item.id === selectedTaxpayerId);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    if (activeConversationId) setStoredMorenAiConversationId(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string | null }>).detail?.conversationId || null;
      if (id) {
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setIsDraftingNewChat(false);
      }
    };
    window.addEventListener(MOREN_AI_CONVERSATION_EVENT, handler);
    return () => window.removeEventListener(MOREN_AI_CONVERSATION_EVENT, handler);
  }, []);

  useEffect(() => {
    selectedTaxpayerIdRef.current = selectedTaxpayerId;
  }, [selectedTaxpayerId]);

  const focusChatInput = useCallback(() => {
    window.setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputRef.current?.focus();
    }, 80);
  }, []);

  useEffect(() => {
    const handler = () => focusChatInput();
    window.addEventListener('moren-ai:focus-chat', handler);

    let shouldFocus = window.location.hash === '#chat';
    try {
      shouldFocus = shouldFocus || window.sessionStorage.getItem('moren-ai-focus-chat') === '1';
      window.sessionStorage.removeItem('moren-ai-focus-chat');
    } catch {}
    if (shouldFocus) focusChatInput();

    return () => window.removeEventListener('moren-ai:focus-chat', handler);
  }, [focusChatInput]);

  const stopRealtimeVoice = () => {
    realtimeActiveRef.current = false;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
  };

  const recordRealtimeUsage = async (event: any) => {
    const response = event?.response;
    const usage = response?.usage;
    const responseId = response?.id || event?.event_id;
    if (!usage || !responseId || realtimeResponsesLoggedRef.current.has(responseId)) return;
    realtimeResponsesLoggedRef.current.add(responseId);
    try {
      const logged = await logRealtimeVoiceUsage({
        conversationId: activeConversationIdRef.current || undefined,
        taxpayerId: selectedTaxpayerIdRef.current || undefined,
        model: realtimeModelRef.current,
        responseId,
        usage,
        durationMs: realtimeStartedAtRef.current ? Date.now() - realtimeStartedAtRef.current : undefined,
      });
      setRealtimeSessionCost((value) => value + (logged.costUsd || 0));
      setRealtimeSessionTokens((value) => value + (logged.inputTokens || 0) + (logged.outputTokens || 0));
      if (activeConversationIdRef.current) {
        await qc.invalidateQueries({ queryKey: ['ai-conversation', activeConversationIdRef.current] });
        await qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      }
    } catch {
      // Maliyet kaydı ses akışını bozmasın.
    }
  };

  const runRealtimePortalCall = async (call: any, dc: RTCDataChannel) => {
    let args: any = {};
    try {
      args = call?.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = {};
    }
    const question = String(args?.question || '').trim();
    if (!question || dc.readyState !== 'open') return;

    setVoiceStatus('thinking');
    try {
      const result = await realtimePortalQuery({
        conversationId: activeConversationIdRef.current || undefined,
        taxpayerId: selectedTaxpayerIdRef.current || undefined,
        question,
        currentPath: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      activeConversationIdRef.current = result.conversationId;
      if (!activeConversationId) setActiveConversationId(result.conversationId);
      setIsDraftingNewChat(false);
      await qc.invalidateQueries({ queryKey: ['ai-conversation', result.conversationId] });
      await qc.invalidateQueries({ queryKey: ['ai-conversations'] });

      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({
            answer: result.assistantMessage,
            conversationId: result.conversationId,
            usage: result.usage,
          }),
        },
      }));
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          tool_choice: 'none',
          instructions:
            'Tool çıktısındaki answer alanını temel alarak kısa ve doğal Türkçe söyle. En fazla 1-3 cümle. Mali müşavire danışın, uzmana başvurun veya sorumluluk reddi deme.',
        },
      }));
    } catch (error: any) {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({
            answer: 'Portal cevabı alınamadı; bağlantıyı kontrol edip tekrar deneyelim.',
            error: error?.response?.data?.message || error?.message || 'portal_query_failed',
          }),
        },
      }));
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          tool_choice: 'none',
          instructions: 'Kısa söyle: Portal cevabı alınamadı, tekrar deneyelim.',
        },
      }));
    }
  };

  const handleRealtimeServerEvent = async (raw: MessageEvent, dc: RTCDataChannel) => {
    let event: any;
    try {
      event = JSON.parse(String(raw.data || '{}'));
    } catch {
      return;
    }
    if (event.type === 'response.created') setVoiceStatus('thinking');
    if (event.type === 'response.audio.delta' || event.type === 'response.audio_transcript.delta') setVoiceStatus('speaking');
    if (event.type === 'input_audio_buffer.speech_started') setVoiceStatus('listening');
    if (event.type !== 'response.done') return;

    await recordRealtimeUsage(event);
    const calls = (event?.response?.output || []).filter((item: any) => item?.type === 'function_call' && item?.name === 'portal_query');
    if (calls.length > 0) {
      for (const call of calls) await runRealtimePortalCall(call, dc);
      return;
    }
    if (voiceModeRef.current && realtimeActiveRef.current) setVoiceStatus('listening');
  };

  const startRealtimeVoice = async () => {
    if (realtimePeerRef.current) return;
    setVoiceStatus('connecting');
    setRealtimeSessionCost(0);
    setRealtimeSessionTokens(0);
    realtimeStartedAtRef.current = Date.now();
    realtimeResponsesLoggedRef.current = new Set();
    const tokenData = await getRealtimeVoiceToken();
    realtimeModelRef.current = tokenData?.model || tokenData?.session?.model || 'gpt-realtime-mini';
    const ephemeralKey =
      tokenData?.value ||
      tokenData?.client_secret?.value ||
      tokenData?.clientSecret?.value ||
      tokenData?.secret?.value;
    if (!ephemeralKey) throw new Error('Realtime oturum anahtarı alınamadı');

    const pc = new RTCPeerConnection();
    realtimePeerRef.current = pc;
    realtimeActiveRef.current = true;

    pc.ontrack = async (event) => {
      if (!audioRef.current) return;
      audioRef.current.srcObject = event.streams[0];
      audioRef.current.autoplay = true;
      await audioRef.current.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        stopRealtimeVoice();
        voiceModeRef.current = false;
        setVoiceMode(false);
        setVoiceStatus('idle');
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    realtimeStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    const dc = pc.createDataChannel('oai-events');
    dc.onmessage = (event) => {
      handleRealtimeServerEvent(event, dc).catch(() => {});
    };
    dc.onopen = () => {
      setVoiceStatus('listening');
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: realtimeInstructions(selectedTaxpayer ? taxpayerName(selectedTaxpayer) : undefined),
          tools: [REALTIME_PORTAL_TOOL],
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
      const errorText = await sdpResponse.text();
      throw new Error(errorText.slice(0, 200) || 'Realtime bağlantı kurulamadı');
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
  };

  useEffect(() => {
    voiceModeRef.current = voiceMode;
    if (!voiceMode && audioRef.current) {
      stopRealtimeVoice();
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setVoiceStatus('idle');
    }
  }, [voiceMode]);

  useEffect(() => () => stopRealtimeVoice(), []);

  const sendMutation = useMutation({
    mutationFn: async ({ message, voiceMode: vm }: { message: string; voiceMode?: boolean }) =>
      chat({
        conversationId: activeConversationId || undefined,
        message,
        taxpayerId: selectedTaxpayerId || undefined,
        currentPath: typeof window !== 'undefined' ? window.location.pathname : undefined,
        voiceMode: vm,
      }),
    onSuccess: async (res) => {
      if (!activeConversationId) setActiveConversationId(res.conversationId);
      setStoredMorenAiConversationId(res.conversationId);
      setIsDraftingNewChat(false);
      await qc.invalidateQueries({ queryKey: ['ai-conversation', res.conversationId] });
      await qc.invalidateQueries({ queryKey: ['ai-conversations'] });

      const shouldSpeak = !realtimeActiveRef.current && (ttsEnabled || voiceModeRef.current || voiceSendRef.current) && !!res.assistantMessage;
      if (shouldSpeak && res.assistantMessage) {
        try {
          setVoiceStatus('speaking');
          const blob = await synthesize(
            res.assistantMessage,
            'nova',
            'Doğal, sıcak, profesyonel bir Türkçe kadın sesiyle konuş. Cümleleri kısa tut, acele etme, robotik okuma yapma.',
          );
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = url;
            audioRef.current.onended = () => {
              URL.revokeObjectURL(url);
              setVoiceStatus('idle');
              if (voiceModeRef.current) {
                window.setTimeout(() => restartVoiceRef.current(), 250);
              }
            };
            await audioRef.current.play();
          }
        } catch (error: any) {
          setVoiceStatus('idle');
          toast.error('Sesli okuma başarısız: ' + (error?.response?.data?.message || error?.message));
        }
      } else {
        setVoiceStatus('idle');
      }
      voiceSendRef.current = false;
    },
    onError: (error: any) => {
      setVoiceStatus('idle');
      voiceSendRef.current = false;
      toast.error('Mesaj gönderilemedi: ' + (error?.response?.data?.message || error?.message));
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      setActiveConversationId(null);
      setIsDraftingNewChat(false);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-conversations'] }),
  });

  const saveMemoryMut = useMutation({
    mutationFn: () =>
      saveMemory({
        title: memoryText.slice(0, 80) || 'Ofis hafızası',
        content: memoryText,
        taxpayerId: selectedTaxpayerId || undefined,
        scope: selectedTaxpayerId ? 'taxpayer' : 'office',
        importance: 4,
        tags: selectedTaxpayerId ? ['mukellef'] : ['ofis'],
      }),
    onSuccess: () => {
      toast.success('MOREN hafızasına alındı');
      setMemoryText('');
      qc.invalidateQueries({ queryKey: ['moren-ai-memories'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Hafıza kaydedilemedi'),
  });

  const confirmActionMut = useMutation({
    mutationFn: (preview: any) =>
      confirmAgentCommand({
        agent: preview.agent,
        action: preview.action,
        payload: preview.payload || {},
        confirmationText: preview.confirmationText || 'ONAYLIYORUM',
      }),
    onSuccess: () => {
      toast.success('Aksiyon onay kuyruğuna alındı');
      qc.invalidateQueries({ queryKey: ['pending-count'] });
      qc.invalidateQueries({ queryKey: ['moren-ai-office-brain'] });
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Aksiyon onaylanamadı'),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sendMutation.isPending]);

  const handleVoiceBlob = async (blob: Blob | null) => {
    if (!blob || blob.size < 1000) {
      setVoiceStatus('idle');
      if (voiceModeRef.current) window.setTimeout(() => restartVoiceRef.current(), 450);
      return;
    }
    try {
      setVoiceStatus('transcribing');
      toast.loading('Ses metne çevriliyor...', { id: 'stt' });
      const { text } = await transcribe(blob, blob.type || 'audio/webm');
      toast.dismiss('stt');
      if (!text) {
        setVoiceStatus('idle');
        toast.error('Ses anlaşılmadı, tekrar deneyin.');
        if (voiceModeRef.current) window.setTimeout(() => restartVoiceRef.current(), 450);
        return;
      }
      setInput('');
      setVoiceStatus('thinking');
      voiceSendRef.current = true;
      sendMutation.mutate({ message: text, voiceMode: true });
    } catch (error: any) {
      toast.dismiss('stt');
      setVoiceStatus('idle');
      voiceSendRef.current = false;
      toast.error('STT hatası: ' + (error?.response?.data?.message || error?.message));
    }
  };

  handleVoiceBlobRef.current = handleVoiceBlob;

  const startVoiceListening = async () => {
    if (realtimeActiveRef.current) return;
    if (recorder.recording || sendMutation.isPending) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setVoiceStatus('listening');
    await recorder.start({
      autoStopOnSilence: true,
      silenceMs: 1250,
      maxDurationMs: 45_000,
      onAutoStop: (blob) => handleVoiceBlobRef.current(blob),
    });
  };

  restartVoiceRef.current = () => {
    // Canlı konuşmada eski "sesi yazıya çevir ve gönder" akışına otomatik düşmüyoruz.
  };

  const handleVoiceModeToggle = async () => {
    const next = !voiceModeRef.current;
    setVoiceMode(next);
    if (next) {
      setTtsEnabled(true);
      voiceModeRef.current = true;
      try {
        await startRealtimeVoice();
      } catch (error: any) {
        stopRealtimeVoice();
        toast.error('Canlı ses başlatılamadı; eski yazıya çeviren ses moduna düşmedim.');
        setVoiceMode(false);
        voiceModeRef.current = false;
        setVoiceStatus('idle');
      }
      return;
    }
    voiceModeRef.current = false;
    stopRealtimeVoice();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (recorder.recording) await recorder.stop();
    setVoiceStatus('idle');
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    voiceSendRef.current = false;
    sendMutation.mutate({ message: text, voiceMode });
  };

  const askQuick = (text: string) => {
    setInput('');
    voiceSendRef.current = false;
    sendMutation.mutate({ message: text, voiceMode });
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setIsDraftingNewChat(true);
    setInput('');
    setStoredMorenAiConversationId(null);
  };

  const handleMic = async () => {
    if (realtimeActiveRef.current) {
      setVoiceMode(false);
      voiceModeRef.current = false;
      stopRealtimeVoice();
      setVoiceStatus('idle');
      return;
    }
    if (recorder.recording) {
      const blob = await recorder.stop();
      await handleVoiceBlob(blob);
      return;
    }
    setVoiceMode(true);
    setTtsEnabled(true);
    voiceModeRef.current = true;
    try {
      await startRealtimeVoice();
    } catch (error: any) {
      stopRealtimeVoice();
      setVoiceMode(false);
      voiceModeRef.current = false;
      setVoiceStatus('idle');
      toast.error('Canlı ses başlatılamadı: ' + (error?.response?.data?.message || error?.message || 'Bağlantı hatası'));
    }
  };

  const handleRename = (conv: ConversationSummary) => {
    const newTitle = prompt('Yeni başlık:', conv.title);
    if (newTitle && newTitle.trim() && newTitle !== conv.title) {
      renameMut.mutate({ id: conv.id, title: newTitle.trim() });
    }
  };

  const totalCost = useMemo(() => messages.reduce((sum, message) => sum + (message.costUsd || 0), 0), [messages]);
  const visibleSessionCost = Math.max(activeConv?.totalCostUsd ?? 0, totalCost + realtimeSessionCost);
  const voiceLabel = voiceStatus === 'connecting'
    ? 'Bağlanıyor'
    : realtimeActiveRef.current
      ? 'Canlı ses'
      : recorder.recording
        ? 'Dinliyor'
        : voiceStatus === 'transcribing'
          ? 'Yazıyor'
          : voiceStatus === 'thinking'
            ? 'Düşünüyor'
            : voiceStatus === 'speaking'
              ? 'Konuşuyor'
              : voiceMode
                ? 'Ses açık'
                : 'Ses modu';
  const inputPlaceholder = realtimeActiveRef.current
    ? 'Canlı ses açık; normal konuşabilirsiniz...'
    : recorder.recording
      ? 'Dinliyorum...'
      : voiceStatus === 'speaking'
        ? 'MOREN AI konuşuyor...'
        : voiceStatus === 'transcribing'
          ? 'Ses yazıya çevriliyor...'
          : 'Mali tablo, mükellef veya ofis akışı sor...';

  const voiceActive = voiceMode || realtimeActiveRef.current || ['listening', 'transcribing', 'thinking', 'speaking'].includes(voiceStatus);

  return (
    <div className="flex h-full min-h-0 max-w-none flex-col gap-3 overflow-hidden">
      {/* ── İmza başlık (gül+altın radial + renk şeridi, yapışkan değil) ── */}
      <header
        className="relative shrink-0 overflow-hidden rounded-2xl border px-5 py-3.5"
        style={{
          borderColor: LINE,
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(240,154,168,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(212,184,118,0.14), transparent 46%), #0f0d0b',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg,#f09aa8,#e7b6a0,#d4b876,#c8a25e,#f09aa8)' }} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#f09aa8,#d4b876)', boxShadow: '0 6px 18px rgba(240,154,168,0.34)', color: '#1a1410' }}>
              <Brain size={21} />
            </span>
            <div>
              <h1 className="text-[22px] font-bold leading-tight" style={{ color: TEXT }}>MOREN AI</h1>
              <p className="text-[12px]" style={{ color: MUTED }}>Ofisin aklı — konuş, sor, yönet.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(messages.length > 0 || realtimeSessionCost > 0) && (
              <div className="hidden items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] sm:flex" style={{ borderColor: LINE, color: MUTED }}>
                Oturum <b className="tabular-nums" style={{ color: TEXT }}>${visibleSessionCost.toFixed(4)}</b>
              </div>
            )}
            <button
              type="button"
              onClick={() => setTtsEnabled((value) => !value)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border transition hover:bg-white/[0.06]"
              style={{ borderColor: ttsEnabled ? LINE_GOLD : LINE, color: ttsEnabled ? GOLD : MUTED }}
              title={ttsEnabled ? 'Sesli okuma açık' : 'Sesli okuma kapalı'}
            >
              {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setLeftCollapsed((value) => !value)}
              className="hidden h-10 items-center gap-2 rounded-xl border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] lg:flex"
              style={{ borderColor: leftCollapsed ? LINE : LINE_GOLD, color: leftCollapsed ? MUTED : GOLD }}
              title="Sohbet panelini gizle/göster"
            >
              <MessageSquare size={15} /> Sohbetler
            </button>
            <button
              type="button"
              onClick={() => setRightCollapsed((value) => !value)}
              className="hidden h-10 items-center gap-2 rounded-xl border px-3 text-[12.5px] font-semibold transition hover:bg-white/[0.06] xl:flex"
              style={{ borderColor: rightCollapsed ? LINE : LINE_GOLD, color: rightCollapsed ? MUTED : GOLD }}
              title="Ofis Beyni panelini gizle/göster"
            >
              <Brain size={15} /> Ofis Beyni
            </button>
          </div>
        </div>
      </header>

      {/* ── Gövde: sohbet listesi · konuşma · ofis beyni ── */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      {!leftCollapsed && (
      <aside className="flex w-[260px] shrink-0 flex-col overflow-hidden rounded-lg border bg-[#0f0d0b]/80" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: LINE }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}>
            <Brain size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-tight" style={{ color: TEXT }}>MOREN AI</h1>
            <p className="truncate text-[11px]" style={{ color: MUTED }}>Ofis hafızası ve sohbetler</p>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]"
            style={{ borderColor: LINE_GOLD, color: GOLD }}
            title="Yeni konuşma"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="relative border-b p-3" style={{ borderColor: LINE }}>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Mükellef konteksti
          </label>
          <div
            className="relative"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setTaxpayerPickerOpen(false);
              }
            }}
          >
            <button
              type="button"
              onClick={() => setTaxpayerPickerOpen((value) => !value)}
              className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-[12.5px] transition hover:bg-white/[0.06]"
              style={{ background: SOFT, borderColor: taxpayerPickerOpen ? LINE_GOLD : LINE, color: TEXT }}
              aria-expanded={taxpayerPickerOpen}
            >
              <span className="min-w-0 truncate">
                {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Genel ofis sorusu'}
              </span>
              <ChevronDown
                size={14}
                className={`shrink-0 transition ${taxpayerPickerOpen ? 'rotate-180' : ''}`}
                style={{ color: GOLD }}
              />
            </button>

            {taxpayerPickerOpen && (
              <div
                className="absolute left-0 right-0 z-30 mt-2 max-h-[280px] overflow-y-auto rounded-lg border p-1 shadow-2xl"
                style={{
                  background: '#14110e',
                  borderColor: LINE_GOLD,
                  boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTaxpayerId('');
                    setTaxpayerPickerOpen(false);
                  }}
                  className="w-full rounded-md px-3 py-2 text-left text-[12.5px] font-semibold transition hover:bg-white/[0.06]"
                  style={{
                    color: selectedTaxpayerId ? MUTED : TEXT,
                    background: selectedTaxpayerId ? 'transparent' : 'rgba(212,184,118,0.12)',
                  }}
                >
                  Genel ofis sorusu
                </button>
                <div className="my-1 border-t" style={{ borderColor: LINE }} />
                {taxpayers.map((taxpayer) => {
                  const active = selectedTaxpayerId === taxpayer.id;
                  return (
                    <button
                      key={taxpayer.id}
                      type="button"
                      onClick={() => {
                        setSelectedTaxpayerId(taxpayer.id);
                        setTaxpayerPickerOpen(false);
                      }}
                      className="w-full rounded-md px-3 py-2 text-left text-[12.5px] transition hover:bg-white/[0.06]"
                      style={{
                        color: active ? TEXT : 'rgba(250,250,249,0.72)',
                        background: active ? 'rgba(212,184,118,0.12)' : 'transparent',
                      }}
                    >
                      <span className="block truncate">{taxpayerName(taxpayer)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px]" style={{ color: MUTED }}>
              Henüz konuşma yok.
            </div>
          ) : (
            <div className="space-y-1.5">
              {conversations.map((conversation) => {
                const active = activeConversationId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    onClick={() => {
                      setActiveConversationId(conversation.id);
                      setIsDraftingNewChat(false);
                      setInput('');
                    }}
                    className="group relative cursor-pointer rounded-lg border px-3 py-2.5 transition"
                    style={{
                      background: active ? 'rgba(212,184,118,0.11)' : 'transparent',
                      borderColor: active ? LINE_GOLD : 'transparent',
                    }}
                  >
                    <div className="flex gap-2">
                      <MessageSquare size={14} className="mt-0.5 shrink-0" style={{ color: active ? GOLD : 'rgba(250,250,249,0.38)' }} />
                      <div className="min-w-0 flex-1 pr-9">
                        <p className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>{conversation.title}</p>
                        <p className="mt-1 text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.38)' }}>
                          {new Date(conversation.updatedAt).toLocaleDateString('tr-TR')} · ${conversation.totalCostUsd.toFixed(3)}
                        </p>
                      </div>
                    </div>
                    <div className="absolute right-2 top-2 flex opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRename(conversation);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10"
                        title="Yeniden adlandır"
                      >
                        <Edit3 size={11} style={{ color: MUTED }} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (confirm('Konuşma silinsin mi?')) deleteMut.mutate(conversation.id);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-red-500/15"
                        title="Sil"
                      >
                        <Trash2 size={11} style={{ color: '#f87171' }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        {/* ── Canlı MOREN AI — kompakt şerit (konuşma öncelikli) ── */}
        <div
          className="relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-4 py-2.5"
          style={{
            borderColor: voiceActive ? 'rgba(240,154,168,0.5)' : LINE_GOLD,
            background: 'radial-gradient(90% 160% at 10% 0%, rgba(240,154,168,0.12), transparent 60%), #14110e',
            boxShadow: voiceActive ? '0 0 0 1px rgba(240,154,168,0.16)' : 'none',
          }}
        >
          <div className="relative grid h-11 w-11 shrink-0 place-items-center">
            {voiceActive && (
              <>
                <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '2px solid rgba(240,154,168,0.5)' }} />
                <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '2px solid rgba(240,154,168,0.5)', animationDelay: '0.8s' }} />
                <span className="moren-voice-ring absolute inset-0 rounded-full" style={{ border: '2px solid rgba(240,154,168,0.5)', animationDelay: '1.6s' }} />
              </>
            )}
            <div
              className={`grid h-10 w-10 place-items-center rounded-full ${voiceActive ? 'moren-voice-orb-live' : ''}`}
              style={{ background: 'radial-gradient(circle at 35% 30%, #ffd9e0, #f09aa8 55%, #9f5260)', color: '#1a1012', boxShadow: '0 6px 16px rgba(240,154,168,0.4), inset 0 2px 5px rgba(255,255,255,0.4)' }}
            >
              {voiceStatus === 'connecting' ? <Loader2 size={18} className="animate-spin" /> : voiceStatus === 'speaking' ? <Sparkles size={18} /> : <Mic size={18} />}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-bold" style={{ color: TEXT }}>Canlı MOREN AI</p>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                style={{ background: voiceActive ? 'rgba(34,197,94,0.14)' : 'rgba(212,184,118,0.14)', color: voiceActive ? '#86efac' : GOLD }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
                {voiceLabel}
              </span>
            </div>
            {voiceActive ? (
              <div className="mt-1 flex items-end gap-[2px]" style={{ height: 15 }}>
                {Array.from({ length: 18 }).map((_, index) => (
                  <span
                    key={index}
                    className="moren-voice-bar w-[2.5px] rounded-full"
                    style={{ background: 'linear-gradient(180deg,#f09aa8,#d4b876)', animationDelay: `${index * 0.05}s` }}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>
                Gerçek zamanlı sesli asistan — bas, konuş, gerçek biriyle konuşur gibi.
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[9.5px]" style={{ color: 'rgba(250,250,249,0.40)' }}>maliyet · token</p>
              <p className="text-[12px] font-bold tabular-nums" style={{ color: TEXT }}>${realtimeSessionCost.toFixed(4)} · {realtimeSessionTokens}</p>
            </div>
            <button
              type="button"
              onClick={handleVoiceModeToggle}
              className="flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold transition"
              style={{
                background: voiceActive ? 'rgba(248,113,113,0.16)' : 'linear-gradient(135deg,#f09aa8,#9f5260)',
                color: voiceActive ? '#fca5a5' : '#160d10',
                border: voiceActive ? '1px solid rgba(248,113,113,0.34)' : 'none',
              }}
            >
              {voiceStatus === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : voiceActive ? <MicOff size={16} /> : <Mic size={16} />}
              {voiceActive ? 'Sesi Kapat' : 'Canlı Konuş'}
            </button>
          </div>
        </div>

        {/* ── Konuşma kartı ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-[#0f0d0b]/80" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: LINE }}>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: GOLD }}>
              {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Genel çalışma'}
            </p>
            <h2 className="truncate text-[14px] font-semibold" style={{ color: TEXT }}>
              {activeConv?.title || 'Yeni konuşma'}
            </h2>
          </div>
          {messages.length > 0 && (
            <p className="hidden text-[11px] tabular-nums sm:block" style={{ color: MUTED }}>{messages.length} mesaj</p>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !sendMutation.isPending ? (
            <EmptyChatState askQuick={askQuick} />
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onConfirmAction={(preview) => confirmActionMut.mutate(preview)}
                  confirming={confirmActionMut.isPending}
                />
              ))}
              {sendMutation.isPending && (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: GOLD }}>
                  <Loader2 size={14} className="animate-spin" />
                  MOREN AI verileri topluyor...
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t p-3" style={{ borderColor: LINE }}>
          <div className="flex items-end gap-2 rounded-lg border bg-black/20 p-2" style={{ borderColor: LINE }}>
            <textarea
              ref={inputRef}
              id="moren-ai-chat-input"
              name="moren-ai-question"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={inputPlaceholder}
              disabled={sendMutation.isPending || recorder.recording}
              rows={1}
              className="moren-ai-input min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none"
              style={{ color: TEXT, caretColor: GOLD, boxShadow: 'none' }}
            />
            <button
              type="button"
              onClick={handleMic}
              disabled={sendMutation.isPending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40"
              style={{
                background: (recorder.recording || realtimeActiveRef.current) ? 'rgba(239,68,68,0.18)' : SOFT,
                borderColor: (recorder.recording || realtimeActiveRef.current) ? 'rgba(239,68,68,0.45)' : LINE,
                color: (recorder.recording || realtimeActiveRef.current) ? '#fca5a5' : GOLD,
              }}
              title={recorder.recording || realtimeActiveRef.current ? 'Sesi durdur' : 'Mikrofon'}
            >
              {voiceStatus === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : (recorder.recording || realtimeActiveRef.current) ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-semibold transition disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
              title="Gönder"
            >
              {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
        </div>
      </section>

      {!rightCollapsed && (
      <OfficeBrainPanel
        data={officeBrain}
        loading={brainLoading}
        memoryText={memoryText}
        setMemoryText={setMemoryText}
        saveMemory={() => saveMemoryMut.mutate()}
        savingMemory={saveMemoryMut.isPending}
        memories={memoryData?.memories || []}
        refetch={() => refetchBrain()}
        askQuick={askQuick}
      />
      )}
      </div>

      <audio ref={audioRef} />
    </div>
  );
}

function EmptyChatState({ askQuick }: { askQuick: (text: string) => void }) {
  const prompts = [
    'Bu hafta beyanname riski en yüksek mükellefleri sırala.',
    'Evrak bekleyen mükellefler için kısa aksiyon listesi çıkar.',
    'Bugünkü LUCA ve Mihsap agent hatalarını özetle.',
    'Tahsilat ve evrak WhatsApp mesajlarını hazırla.',
  ];

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.10)', color: GOLD }}>
            <Sparkles size={22} />
          </div>
          <div>
            <h3 className="text-[22px] font-semibold" style={{ color: TEXT }}>Ofis aklını tek yerde topla</h3>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>Mükellef, beyan, evrak, agent ve tahsilat verileri aynı konuşma içinde.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => askQuick(prompt)}
              className="rounded-lg border p-3 text-left text-[12.5px] leading-relaxed transition hover:bg-white/[0.05]"
              style={{ borderColor: LINE, color: TEXT, background: SOFT }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function OfficeBrainPanel({
  data,
  loading,
  memoryText,
  setMemoryText,
  saveMemory,
  savingMemory,
  memories,
  refetch,
  askQuick,
}: {
  data: any;
  loading: boolean;
  memoryText: string;
  setMemoryText: (value: string) => void;
  saveMemory: () => void;
  savingMemory: boolean;
  memories: any[];
  refetch: () => void;
  askQuick: (text: string) => void;
}) {
  const summary = data?.briefing?.ozet || {};
  const agents = data?.agentCatalog || [];
  const metrics = [
    { label: 'Evrak bekleyen', value: summary.evrakEksik ?? 0 },
    { label: 'Beyan riski', value: summary.kdvKontrolEksik ?? 0 },
    { label: 'Banka aksiyonu', value: (summary.bankaEksik ?? 0) + (summary.bankaHesapsiz ?? 0) },
    { label: 'Cari borçlu', value: summary.borcluMukellef ?? 0 },
  ];
  const quicks = [
    'Bugün önce neye bakmalıyım?',
    'Beyana hazır olmayanları risk sırasına koy.',
    'Agent hatalarında acil bir şey var mı?',
    'Evrak bekleyenler için WhatsApp taslakları hazırla.',
    'Tahsilat riski yüksek olanlara WhatsApp mesajı öner.',
  ];

  return (
    <aside className="hidden w-[292px] shrink-0 flex-col overflow-hidden rounded-lg border bg-[#0f0d0b]/80 xl:flex" style={{ borderColor: LINE }}>
      <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: LINE }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD }}>
          <Brain size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold" style={{ color: TEXT }}>Ofis Beyni</h2>
          <p className="text-[11px]" style={{ color: MUTED }}>Canlı özet ve hafıza</p>
        </div>
        <button type="button" onClick={refetch} className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]" style={{ borderColor: LINE, color: GOLD }} title="Yenile">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border p-3" style={{ borderColor: LINE, background: SOFT }}>
              <p className="text-[10.5px]" style={{ color: MUTED }}>{metric.label}</p>
              <p className="mt-1 text-[24px] font-semibold leading-none tabular-nums" style={{ color: TEXT }}>{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>Hızlı analiz</p>
          <div className="space-y-2">
            {quicks.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => askQuick(quick)}
                className="w-full rounded-lg border px-3 py-2 text-left text-[12px] transition hover:bg-white/[0.05]"
                style={{ borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.02)' }}
              >
                {quick}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>Aktif ajanlar</p>
          <div className="flex flex-wrap gap-1.5">
            {agents.slice(0, 10).map((agent: any) => (
              <span key={agent.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px]" style={{ borderColor: LINE, color: MUTED }}>
                <Bot size={10} style={{ color: GOLD }} />
                {agent.ad}
              </span>
            ))}
            {agents.length === 0 && <span className="text-[12px]" style={{ color: MUTED }}>Ajan bilgisi yok.</span>}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>Son hafıza</p>
          <div className="space-y-2">
            {memories.slice(0, 4).map((memory: any) => (
              <div key={memory.id} className="rounded-lg border px-3 py-2" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.02)' }}>
                <p className="truncate text-[12px] font-semibold" style={{ color: TEXT }}>{memory.title}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>{memory.content}</p>
              </div>
            ))}
            {memories.length === 0 && <p className="text-[12px]" style={{ color: MUTED }}>Henüz kayıtlı not yok.</p>}
          </div>
        </div>
      </div>

      <div className="border-t p-4" style={{ borderColor: LINE }}>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Hafızaya not
        </label>
        <div className="flex gap-2">
          <input
            value={memoryText}
            onChange={(event) => setMemoryText(event.target.value)}
            placeholder="Kısa not..."
            className="h-9 rounded-lg border px-3 text-[12px]"
            style={{ background: SOFT, borderColor: LINE, color: TEXT }}
          />
          <button
            type="button"
            disabled={!memoryText.trim() || savingMemory}
            onClick={saveMemory}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40"
            style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.08)' }}
            title="Kaydet"
          >
            {savingMemory ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

type ToolView = {
  name: string;
  input?: any;
  result?: any;
};

const TOOL_LABELS: Record<string, string> = {
  get_operation_briefing: 'Ofis brifingi',
  get_taxpayer_work_status: 'Mükellef durumu',
  get_beyanname_readiness_summary: 'Beyan hazırlığı',
  get_collection_risk_summary: 'Tahsilat riski',
  get_invoice_summary: 'Fatura özeti',
  list_invoices: 'İşlenen faturalar',
  list_taxpayers: 'Mükellef arama',
  search_ai_memory: 'Hafıza',
  save_ai_memory: 'Hafıza kaydı',
  get_agent_status: 'Ajan durumu',
  get_luca_agent_jobs: 'Luca işleri',
  get_mihsap_agent_jobs: 'Mihsap işleri',
  preview_agent_command: 'Aksiyon önizleme',
  create_confirmed_agent_command: 'Onaylı aksiyon',
  research_official_sources: 'Resmi kaynak',
};

function parseJsonish(value: any) {
  if (!value) return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asToolArray(value: any): any[] {
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.toolUses)) return parsed.toolUses;
  if (Array.isArray(parsed?.tools)) return parsed.tools;
  return [];
}

function normalizeTools(message: Message): ToolView[] {
  const results = asToolArray(message.toolResults).map((tool) => ({
    name: String(tool?.name || tool?.tool || ''),
    input: tool?.input,
    result: parseJsonish(tool?.result),
  })).filter((tool) => tool.name);
  const resultKeys = new Set(results.map((tool) => `${tool.name}:${JSON.stringify(tool.input || {})}`));
  const calls = asToolArray(message.toolCalls)
    .map((tool) => ({
      name: String(tool?.name || tool?.tool || ''),
      input: tool?.input,
      result: undefined,
    }))
    .filter((tool) => tool.name && !resultKeys.has(`${tool.name}:${JSON.stringify(tool.input || {})}`));
  return [...results, ...calls];
}

function getActionPreviews(tools: ToolView[]) {
  return tools
    .filter((tool) => tool.name === 'preview_agent_command')
    .map((tool) => parseJsonish(tool.result))
    .filter((result) => result && typeof result === 'object' && result.requiresConfirmation && result.agent && result.action);
}

function MessageBubble({
  message,
  onConfirmAction,
  confirming,
}: {
  message: Message;
  onConfirmAction?: (preview: any) => void;
  confirming?: boolean;
}) {
  const isUser = message.role === 'user';
  const tools = !isUser ? normalizeTools(message) : [];
  const previews = getActionPreviews(tools);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[78%] rounded-lg border px-4 py-3 text-sm"
        style={{
          background: isUser ? 'rgba(212,184,118,0.12)' : 'rgba(255,255,255,0.035)',
          borderColor: isUser ? LINE_GOLD : LINE,
          color: TEXT,
        }}
      >
        <div className="moren-md text-[13px] leading-[1.6]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
        {!isUser && tools.length > 0 ? (
          <div className="mt-3 rounded-lg border px-3 py-2" style={{ borderColor: LINE, background: 'rgba(0,0,0,0.16)' }}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>
              Kullanılan veri ve araçlar
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool, index) => (
                <span
                  key={`${tool.name}-${index}`}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold"
                  style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.07)' }}
                >
                  <Bot size={10} />
                  {TOOL_LABELS[tool.name] || tool.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!isUser && previews.length > 0 ? (
          <div className="mt-3 space-y-2">
            {previews.map((preview: any, index: number) => (
              <div
                key={`${preview.agent}-${preview.action}-${index}`}
                className="rounded-lg border p-3"
                style={{ borderColor: preview.ok ? 'rgba(240,154,168,0.34)' : 'rgba(248,113,113,0.34)', background: preview.ok ? 'rgba(240,154,168,0.08)' : 'rgba(248,113,113,0.08)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold" style={{ color: TEXT }}>Onay bekleyen aksiyon</p>
                    <p className="mt-1 text-[11px]" style={{ color: MUTED }}>{preview.agent} · {preview.action}</p>
                  </div>
                  <span className="rounded-md border px-2 py-1 text-[10px] font-semibold" style={{ borderColor: LINE, color: preview.ok ? GOLD : '#fca5a5' }}>
                    {preview.ok ? 'Hazır' : 'Eksik'}
                  </span>
                </div>
                {preview.etki ? (
                  <p className="mt-2 text-[12px] leading-relaxed" style={{ color: TEXT }}>{preview.etki}</p>
                ) : null}
                {Array.isArray(preview.errors) && preview.errors.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[11px]" style={{ color: '#fca5a5' }}>
                    {preview.errors.map((error: string) => <li key={error}>{error}</li>)}
                  </ul>
                ) : null}
                <button
                  type="button"
                  disabled={!preview.ok || confirming}
                  onClick={() => onConfirmAction?.(preview)}
                  className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[11.5px] font-semibold transition disabled:opacity-45"
                  style={{ borderColor: LINE_GOLD, color: GOLD, background: 'rgba(212,184,118,0.08)' }}
                >
                  {confirming ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Onayla ve kuyruğa al
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {!isUser && (message.inputTokens || message.outputTokens) ? (
          <div className="mt-2 flex gap-3 border-t pt-2 text-[10px]" style={{ borderColor: LINE, color: 'rgba(250,250,249,0.36)' }}>
            <span className="flex items-center gap-1"><DollarSign size={10} />${message.costUsd?.toFixed(4) || '0.0000'}</span>
            <span>{message.inputTokens}+{message.outputTokens} token</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
