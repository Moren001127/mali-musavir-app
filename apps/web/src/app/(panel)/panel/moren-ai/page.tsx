'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  deleteConversation,
  getConversation,
  getOfficeBrain,
  getRealtimeVoiceToken,
  listConversations,
  renameConversation,
  saveMemory,
  synthesize,
  transcribe,
  type ConversationSummary,
  type Message,
} from '@/lib/moren-ai';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const LINE = 'rgba(255,255,255,0.08)';
const LINE_GOLD = 'rgba(212,184,118,0.22)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.56)';
const SOFT = 'rgba(255,255,255,0.035)';

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
  const [memoryText, setMemoryText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voiceModeRef = useRef(false);
  const voiceSendRef = useRef(false);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeActiveRef = useRef(false);
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

  const { data: conversations = [] } = useQuery<ConversationSummary[]>({
    queryKey: ['ai-conversations'],
    queryFn: () => listConversations(30),
  });

  useEffect(() => {
    if (!activeConversationId && !isDraftingNewChat && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
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

  const startRealtimeVoice = async () => {
    if (realtimePeerRef.current) return;
    setVoiceStatus('connecting');
    const tokenData = await getRealtimeVoiceToken();
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
        if (voiceModeRef.current) setVoiceStatus('idle');
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    realtimeStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    const dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setVoiceStatus('listening');
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions:
            'Türkçe konuş. Cevaplar çok kısa, net ve mesleki olsun: 1-3 cümle. Kullanıcı konuşurken sözünü kesme.',
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
        voiceMode: vm,
      }),
    onSuccess: async (res) => {
      if (!activeConversationId) setActiveConversationId(res.conversationId);
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
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || error?.message || 'Hafıza kaydedilemedi'),
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
    if (!voiceModeRef.current || sendMutation.isPending || recorder.recording) return;
    startVoiceListening().catch(() => {});
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
        toast.info('Canlı ses başlatılamadı; kayıtlı ses moduna geçiyorum.');
        window.setTimeout(() => restartVoiceRef.current(), 100);
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
    } catch {
      stopRealtimeVoice();
      await startVoiceListening();
    }
  };

  const handleRename = (conv: ConversationSummary) => {
    const newTitle = prompt('Yeni başlık:', conv.title);
    if (newTitle && newTitle.trim() && newTitle !== conv.title) {
      renameMut.mutate({ id: conv.id, title: newTitle.trim() });
    }
  };

  const totalCost = useMemo(() => messages.reduce((sum, message) => sum + (message.costUsd || 0), 0), [messages]);
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

  return (
    <div className="flex h-full min-h-0 max-w-none gap-3 overflow-hidden">
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

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[#0f0d0b]/80" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: LINE }}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>
              {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Genel çalışma'}
            </p>
            <h2 className="truncate text-[18px] font-semibold" style={{ color: TEXT }}>
              {activeConv?.title || 'Yeni konuşma'}
            </h2>
          </div>
          {messages.length > 0 && (
            <div className="hidden rounded-lg border px-3 py-2 text-right sm:block" style={{ borderColor: LINE, color: MUTED }}>
              <p className="text-[10px] uppercase tracking-[0.12em]">Oturum</p>
              <p className="text-[12px] tabular-nums" style={{ color: TEXT }}>{messages.length} mesaj · ${totalCost.toFixed(4)}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleVoiceModeToggle}
            className="hidden h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold transition hover:bg-white/[0.06] md:flex"
            style={{ borderColor: voiceMode ? LINE_GOLD : LINE, color: voiceMode ? GOLD : MUTED }}
          >
            {voiceStatus === 'connecting' || recorder.recording ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
            {voiceLabel}
          </button>
          <button
            type="button"
            onClick={() => setTtsEnabled((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition hover:bg-white/[0.06]"
            style={{ borderColor: ttsEnabled ? LINE_GOLD : LINE, color: ttsEnabled ? GOLD : MUTED }}
            title={ttsEnabled ? 'Sesli okuma açık' : 'Sesli okuma kapalı'}
          >
            {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
          {messages.length === 0 && !sendMutation.isPending ? (
            <EmptyChatState askQuick={askQuick} />
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
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
      </section>

      <OfficeBrainPanel
        data={officeBrain}
        loading={brainLoading}
        memoryText={memoryText}
        setMemoryText={setMemoryText}
        saveMemory={() => saveMemoryMut.mutate()}
        savingMemory={saveMemoryMut.isPending}
        refetch={() => refetchBrain()}
        askQuick={askQuick}
      />

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
  refetch,
  askQuick,
}: {
  data: any;
  loading: boolean;
  memoryText: string;
  setMemoryText: (value: string) => void;
  saveMemory: () => void;
  savingMemory: boolean;
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

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
