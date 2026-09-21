'use client';
import './moren-ai-white.css';

// MOREN AI (Elif) — 2026-09-21 beyaz tema yeniden tasarımı (bilgi/BEYAZ-TEMA-TASARIM-DILI.md).
//   Üç parçalı düzen: kompakt başlık · sol sohbet listesi (arama + mükellef bağlamı) · sağda ince canlı ses şeridi + sohbet paneli.
//   Sayfa satır içi renk kullanmaz; renkler moren-ai-white.css'te tema değişkeni (A koyu / D beyaz).
//   Veri akışları, uçlar ve kısayollar aynen korunur; yalnız düzen, hiyerarşi ve renk değişti.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import {
  Building2,
  CheckCircle2,
  Edit3,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  chat,
  confirmAgentCommand,
  deleteConversation,
  getConversation,
  getOfficeBrain,
  listConversations,
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
import { morenVoice, voiceStatusLabel } from '@/lib/moren-voice-session';
import { useMorenVoice } from '@/hooks/useMorenVoice';

const TZ = 'Europe/Istanbul';
function gunAnahtari(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/** Sohbet listesi: bugün "14:20", bu yıl "21 Eyl", eski "21.09.2025". */
function kisaTarih(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const simdi = new Date();
  if (gunAnahtari(d) === gunAnahtari(simdi)) return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  if (d.getFullYear() === simdi.getFullYear()) return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
  return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ }).format(d);
}
/** Mesaj zaman damgası: bugün "14:22", diğer "21 Eyl 14:22". */
function mesajSaati(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const saat = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  if (gunAnahtari(d) === gunAnahtari(new Date())) return saat;
  return `${new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d)} ${saat}`;
}

// Canlı ses (OpenAI Realtime) artık sayfaya bağlı DEĞİL: tek oturum lib/moren-voice-session.ts'te
// yaşar (GlobalMorenVoice her sayfada durur). Bu sayfa yalnız aynı oturumu gösterir/başlatır/durdurur;
// sayfa değişince ses kopmaz. Seçili mükellef bağlamı morenVoice.setTaxpayer ile oturuma geçer.

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
  // Yerel ses durumu yalnız eski STT/TTS yolu içindir; canlı ses durumu global depodan (voice) gelir.
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'>('idle');
  const voice = useMorenVoice();
  const [memoryText, setMemoryText] = useState('');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Sağdaki "Ofis Beyni" paneli kaldırıldı (kullanıcı kararı 2026-07-04) —
  // içeriği başlıktaki küçük "Hızlı menü" açılırına taşındı.
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voiceSendRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const selectedTaxpayerIdRef = useRef('');
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

  // Seçili mükellef → global ses oturumunun bağlamı (sesli soruda taxpayerId + ad gider).
  useEffect(() => {
    morenVoice.setTaxpayer(selectedTaxpayerId || null, selectedTaxpayer ? taxpayerName(selectedTaxpayer) : null);
  }, [selectedTaxpayerId, selectedTaxpayer]);

  const startGlobalVoice = async () => {
    setTtsEnabled(true);
    try {
      await morenVoice.start();
    } catch (error: any) {
      toast.error('Canlı ses başlatılamadı: ' + (error?.message || 'Bağlantı hatası'));
    }
  };

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

      const shouldSpeak = !morenVoice.getSnapshot().active && (ttsEnabled || voiceSendRef.current) && !!res.assistantMessage;
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

  const handleVoiceModeToggle = async () => {
    if (voice.active) {
      morenVoice.stop();
      if (recorder.recording) await recorder.stop();
      setVoiceStatus('idle');
      return;
    }
    await startGlobalVoice();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    voiceSendRef.current = false;
    sendMutation.mutate({ message: text, voiceMode: voice.active });
  };

  const askQuick = (text: string) => {
    setInput('');
    voiceSendRef.current = false;
    sendMutation.mutate({ message: text, voiceMode: voice.active });
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setIsDraftingNewChat(true);
    setInput('');
    setStoredMorenAiConversationId(null);
  };

  const handleMic = async () => {
    if (voice.active) {
      morenVoice.stop();
      setVoiceStatus('idle');
      return;
    }
    if (recorder.recording) {
      const blob = await recorder.stop();
      await handleVoiceBlob(blob);
      return;
    }
    await startGlobalVoice();
  };

  const handleRename = (conv: ConversationSummary) => {
    const newTitle = prompt('Yeni başlık:', conv.title);
    if (newTitle && newTitle.trim() && newTitle !== conv.title) {
      renameMut.mutate({ id: conv.id, title: newTitle.trim() });
    }
  };

  const totalCost = useMemo(() => messages.reduce((sum, message) => sum + (message.costUsd || 0), 0), [messages]);
  const visibleSessionCost = Math.max(activeConv?.totalCostUsd ?? 0, totalCost + voice.sessionCost);
  const realtimeActive = voice.active;
  const voiceLabel = realtimeActive
    ? voiceStatusLabel(voice)
    : recorder.recording
      ? 'Dinliyor'
      : voiceStatus === 'transcribing'
        ? 'Yazıyor'
        : voiceStatus === 'thinking'
          ? 'Düşünüyor'
          : voiceStatus === 'speaking'
            ? 'Konuşuyor'
            : voice.status === 'error'
              ? 'Hata'
              : 'Ses modu';
  const inputPlaceholder = realtimeActive
    ? (voice.status === 'thinking'
        ? (voice.longWait ? 'Koordinatör hâlâ çalışıyor…' : 'Koordinatör düşünüyor…')
        : 'Canlı ses açık; normal konuşabilirsiniz...')
    : recorder.recording
      ? 'Dinliyorum...'
      : voiceStatus === 'speaking'
        ? 'Elif konuşuyor...'
        : voiceStatus === 'transcribing'
          ? 'Ses yazıya çevriliyor...'
          : 'Mali tablo, mükellef veya ofis akışı sor...';

  const voiceActive = realtimeActive || ['listening', 'transcribing', 'thinking', 'speaking'].includes(voiceStatus);

  const sekreterDurum = sendMutation.isPending
    ? 'yazıyor…'
    : recorder.recording
      ? 'dinliyor…'
      : voiceStatus === 'speaking' || voice.status === 'speaking'
        ? 'konuşuyor…'
        : realtimeActive
          ? (voice.status === 'thinking' ? (voice.longWait ? 'hâlâ çalışıyor…' : 'düşünüyor…') : 'canlı ses açık')
          : 'çevrimiçi';
  const sekreterMesgul = sendMutation.isPending || recorder.recording || voiceStatus === 'speaking' || voice.status === 'speaking' || voice.status === 'thinking';

  const [conversationSearch, setConversationSearch] = useState('');
  const filteredConversations = useMemo(() => {
    const q = conversationSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return conversations;
    return conversations.filter((conversation) => conversation.title.toLocaleLowerCase('tr-TR').includes(q));
  }, [conversations, conversationSearch]);
  const taxpayerLabel = useCallback(
    (id: string | null) => {
      if (!id) return 'Genel ofis';
      const t = taxpayers.find((item) => item.id === id);
      return t ? taxpayerName(t) : 'Mükellef';
    },
    [taxpayers],
  );
  const contextLabel = selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Genel ofis sorusu';
  const showCost = messages.length > 0 || voice.sessionCost > 0;
  const voiceChipState = !voiceActive
    ? 'idle'
    : voice.status === 'error'
      ? 'error'
      : voice.status === 'thinking' || voice.status === 'connecting' || voiceStatus === 'transcribing' || voiceStatus === 'thinking'
        ? 'busy'
        : 'online';
  const micLive = recorder.recording || realtimeActive;

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    setIsDraftingNewChat(false);
    setInput('');
  };

  return (
    <div className="ai-root relative flex h-full min-h-0 max-w-none flex-col gap-3 overflow-hidden">
      {/* ── Başlık: Elif (kompakt) ── */}
      <header className="ai-card ai-header flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ai-avatar" title="Elif — MOREN AI Ofis Sekreteri">
            E
            <span className="ai-avatar__dot" data-busy={sekreterMesgul ? 'true' : 'false'} />
          </span>
          <div className="min-w-0">
            <h1 className="ai-title">Elif</h1>
            <p className="ai-subtitle">MOREN AI Ofis Sekreteri</p>
          </div>
          <span className="ai-chip ai-chip--status ml-1" data-state={sekreterMesgul ? 'busy' : 'online'}>
            {sekreterDurum}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showCost && (
            <span className="ai-chip ai-hide-sm" title="Bu sohbet + canlı ses oturumunun maliyeti">
              Oturum <b className="tabular-nums">${visibleSessionCost.toFixed(4)}</b>
            </span>
          )}
          <button
            type="button"
            onClick={() => setTtsEnabled((value) => !value)}
            className="ai-btn ai-btn--icon"
            data-active={ttsEnabled ? 'true' : 'false'}
            aria-pressed={ttsEnabled}
            title={ttsEnabled ? 'Sesli okuma açık — kapatmak için tıkla' : 'Sesli okuma kapalı — açmak için tıkla'}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setLeftCollapsed((value) => !value)}
            className="ai-btn ai-btn--icon ai-hide-md"
            aria-pressed={!leftCollapsed}
            title={leftCollapsed ? 'Sohbet listesini göster' : 'Sohbet listesini gizle'}
          >
            {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setQuickMenuOpen((value) => !value)}
            className="ai-btn"
            data-active={quickMenuOpen ? 'true' : 'false'}
            aria-expanded={quickMenuOpen}
            title="Hızlı sorular, canlı özet ve hafıza notu"
          >
            <Sparkles size={15} /> Hızlı menü
          </button>
          <button type="button" onClick={handleNewChat} className="ai-btn" title="Yeni konuşma başlat">
            <Plus size={15} /> Yeni sohbet
          </button>
        </div>
      </header>

      {/* ── Hızlı menü açılırı (eski Ofis Beyni içeriği, kompakt) ── */}
      {quickMenuOpen && (
        <div className="ai-pop" role="dialog" aria-label="Hızlı menü">
          <div className="ai-pop__head">
            <Sparkles size={14} style={{ color: 'var(--ai-accent-ink)' }} />
            <span className="ai-pop__title">Hızlı menü</span>
            <button type="button" onClick={() => refetchBrain()} className="ai-btn ai-btn--sm ai-btn--icon ai-btn--ghost" title="Yenile">
              {brainLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
            <button type="button" onClick={() => setQuickMenuOpen(false)} className="ai-btn ai-btn--sm ai-btn--icon ai-btn--ghost" title="Kapat">
              <X size={14} />
            </button>
          </div>
          <div className="ai-pop__body">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Evrak bekleyen', value: officeBrain?.briefing?.ozet?.evrakEksik ?? 0 },
                { label: 'Beyan riski', value: officeBrain?.briefing?.ozet?.kdvKontrolEksik ?? 0 },
                { label: 'Banka aksiyonu', value: (officeBrain?.briefing?.ozet?.bankaEksik ?? 0) + (officeBrain?.briefing?.ozet?.bankaHesapsiz ?? 0) },
                { label: 'Cari borçlu', value: officeBrain?.briefing?.ozet?.borcluMukellef ?? 0 },
              ].map((metric) => (
                <div key={metric.label} className="ai-metric">
                  <p className="ai-metric__label">{metric.label}</p>
                  <p className="ai-metric__value">{metric.value}</p>
                </div>
              ))}
            </div>
            <p className="ai-label">Hazır sorular</p>
            <div className="grid gap-1.5">
              {[
                'Bugün önce neye bakmalıyım?',
                'Beyana hazır olmayanları risk sırasına koy.',
                'Agent hatalarında acil bir şey var mı?',
                'Evrak bekleyenler için WhatsApp taslakları hazırla.',
                'Tahsilat riski yüksek olanlara WhatsApp mesajı öner.',
              ].map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => {
                    askQuick(quick);
                    setQuickMenuOpen(false);
                  }}
                  className="ai-quick"
                >
                  {quick}
                </button>
              ))}
            </div>
            <p className="ai-label">Son hafıza</p>
            <div className="grid gap-1.5">
              {(memoryData?.memories || []).slice(0, 3).map((memory: any) => (
                <div key={memory.id} className="ai-memo">
                  <p className="ai-memo__title">{memory.title}</p>
                  <p className="ai-memo__text">{memory.content}</p>
                </div>
              ))}
              {!(memoryData?.memories || []).length && <p className="ai-empty-note !py-2 !text-left">Henüz kayıtlı not yok.</p>}
            </div>
          </div>
          <div className="ai-pop__foot">
            <div className="flex gap-2">
              <input
                value={memoryText}
                onChange={(event) => setMemoryText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && memoryText.trim() && !saveMemoryMut.isPending) saveMemoryMut.mutate();
                }}
                placeholder="Hafızaya kısa not..."
                aria-label="Hafızaya kısa not"
                className="ai-input min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={!memoryText.trim() || saveMemoryMut.isPending}
                onClick={() => saveMemoryMut.mutate()}
                className="ai-btn ai-btn--primary ai-btn--icon shrink-0"
                title="Hafızaya kaydet"
              >
                {saveMemoryMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Gövde: sohbet listesi · canlı ses · konuşma ── */}
      <div className="ai-body flex min-h-0 flex-1 gap-3 overflow-hidden">
        {!leftCollapsed && (
          <aside className="ai-card ai-side flex shrink-0 flex-col overflow-hidden">
            <div className="ai-side__head">
              <MessageSquare size={15} style={{ color: 'var(--ai-accent-ink)' }} />
              <h2 className="ai-side__title flex-1">Sohbetler</h2>
              <span className="ai-count" title="Kayıtlı konuşma sayısı">{conversations.length}</span>
              <button type="button" onClick={handleNewChat} className="ai-btn ai-btn--sm ai-btn--icon" title="Yeni konuşma">
                <Plus size={15} />
              </button>
            </div>

            <div className="ai-side__tools">
              <div className="ai-search">
                <Search size={14} />
                <input
                  value={conversationSearch}
                  onChange={(event) => setConversationSearch(event.target.value)}
                  placeholder="Sohbetlerde ara"
                  aria-label="Sohbetlerde ara"
                  className="ai-search__input"
                />
              </div>
              <div
                className="relative"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setTaxpayerPickerOpen(false);
                  }
                }}
              >
                <label className="ai-label" htmlFor="moren-ai-context">
                  Mükellef bağlamı
                </label>
                <button
                  id="moren-ai-context"
                  type="button"
                  onClick={() => setTaxpayerPickerOpen((value) => !value)}
                  className="ai-select"
                  data-set={selectedTaxpayerId ? 'true' : 'false'}
                  aria-expanded={taxpayerPickerOpen}
                  title="Sorular bu mükellefin verisiyle yanıtlanır"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 size={14} />
                    <span className="truncate">{contextLabel}</span>
                  </span>
                  <ChevronDown size={14} className={`transition ${taxpayerPickerOpen ? 'rotate-180' : ''}`} />
                </button>

                {taxpayerPickerOpen && (
                  <div className="ai-dd" role="listbox" aria-label="Mükellef bağlamı">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTaxpayerId('');
                        setTaxpayerPickerOpen(false);
                      }}
                      className="ai-dd__item"
                      data-active={selectedTaxpayerId ? 'false' : 'true'}
                    >
                      Genel ofis sorusu
                    </button>
                    <div className="ai-dd__sep" />
                    {taxpayers.map((taxpayer) => (
                      <button
                        key={taxpayer.id}
                        type="button"
                        onClick={() => {
                          setSelectedTaxpayerId(taxpayer.id);
                          setTaxpayerPickerOpen(false);
                        }}
                        className="ai-dd__item truncate"
                        data-active={selectedTaxpayerId === taxpayer.id ? 'true' : 'false'}
                      >
                        {taxpayerName(taxpayer)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="ai-side__list">
              {conversations.length === 0 ? (
                <div className="ai-empty-note">Henüz konuşma yok.</div>
              ) : filteredConversations.length === 0 ? (
                <div className="ai-empty-note">Aramayla eşleşen sohbet yok.</div>
              ) : (
                filteredConversations.map((conversation) => {
                  const active = activeConversationId === conversation.id;
                  return (
                    <div
                      key={conversation.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectConversation(conversation.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectConversation(conversation.id);
                        }
                      }}
                      className="ai-conv"
                      data-active={active ? 'true' : 'false'}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="ai-conv__icon">
                        <MessageSquare size={14} />
                      </span>
                      <div className="ai-conv__body">
                        <p className="ai-conv__title" title={conversation.title}>{conversation.title}</p>
                        <p className="ai-conv__meta">
                          {taxpayerLabel(conversation.taxpayerId)} · ${conversation.totalCostUsd.toFixed(3)}
                        </p>
                      </div>
                      <span className="ai-conv__time" title={new Date(conversation.updatedAt).toLocaleString('tr-TR')}>
                        {kisaTarih(conversation.updatedAt)}
                      </span>
                      <div className="ai-conv__tools">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRename(conversation);
                          }}
                          className="ai-conv__tool"
                          title="Yeniden adlandır"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (confirm('Konuşma silinsin mi?')) deleteMut.mutate(conversation.id);
                          }}
                          className="ai-conv__tool ai-conv__tool--danger"
                          title="Sil"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        <section className="ai-main flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* ── Canlı MOREN AI — ince şerit ── */}
          <div className="ai-card ai-voice shrink-0" data-live={voiceActive ? 'true' : 'false'}>
            <div className="ai-voice__orb">
              {voiceActive && (
                <>
                  <span className="moren-voice-ring" />
                  <span className="moren-voice-ring" style={{ animationDelay: '0.8s' }} />
                  <span className="moren-voice-ring" style={{ animationDelay: '1.6s' }} />
                </>
              )}
              <div className={`ai-voice__disc ${voiceActive ? 'moren-voice-orb-live' : ''}`}>
                {voice.status === 'connecting' || voice.status === 'thinking' ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : voiceStatus === 'speaking' || voice.status === 'speaking' ? (
                  <Sparkles size={16} />
                ) : (
                  <Mic size={16} />
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="ai-voice__title">
                Canlı MOREN AI
                <span className={`ai-chip ${voiceChipState === 'idle' ? '' : 'ai-chip--status'}`} data-state={voiceChipState}>
                  {voiceLabel}
                </span>
              </p>
              {voiceActive && voice.status === 'thinking' ? (
                <p className="ai-voice__sub" data-warn={voice.longWait ? 'true' : 'false'}>
                  {voice.longWait ? 'Hâlâ çalışıyor — koordinatör işi yürütüyor; sonuç mesajlaşmaya da düşer.' : 'Koordinatör veriyi topluyor…'}
                </p>
              ) : voiceActive ? (
                <div className="ai-voice__bars" aria-hidden>
                  {Array.from({ length: 18 }).map((_, index) => (
                    <span key={index} className="moren-voice-bar" style={{ animationDelay: `${index * 0.05}s` }} />
                  ))}
                </div>
              ) : (
                <p className="ai-voice__sub" data-warn={voice.errorText ? 'true' : 'false'}>
                  {voice.errorText || 'Gerçek zamanlı sesli asistan — muhatap ekip koordinatörü; sayfa değişse de ses sürer.'}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="ai-voice__cost ai-hide-sm">
                <p>maliyet · token</p>
                <p>${voice.sessionCost.toFixed(4)} · {voice.sessionTokens}</p>
              </div>
              <button
                type="button"
                onClick={handleVoiceModeToggle}
                className={`ai-btn ${voiceActive ? 'ai-btn--danger' : 'ai-btn--primary'}`}
                title={voiceActive ? 'Canlı ses oturumunu kapat' : 'Canlı ses oturumu başlat'}
              >
                {voice.status === 'connecting' ? <Loader2 size={15} className="animate-spin" /> : voiceActive ? <MicOff size={15} /> : <Mic size={15} />}
                {voiceActive ? 'Sesi Kapat' : 'Canlı Konuş'}
              </button>
            </div>
          </div>

          {/* ── Konuşma kartı ── */}
          <div className="ai-card ai-chat flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="ai-chat__head">
              <div className="min-w-0 flex-1">
                <p className="ai-eyebrow">{selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Genel çalışma'}</p>
                <h2 className="ai-chat__title">{activeConv?.title || 'Yeni konuşma'}</h2>
              </div>
              {messages.length > 0 && <span className="ai-chip ai-hide-sm">{messages.length} mesaj</span>}
            </div>

            <div ref={scrollRef} className="ai-chat__scroll">
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
                    <div className="ai-msg" data-role="assistant">
                      <span className="ai-avatar ai-avatar--sm">E</span>
                      <div className="ai-typing" aria-live="polite">
                        <span className="ai-typing__dot" />
                        <span className="ai-typing__dot" />
                        <span className="ai-typing__dot" />
                        <span className="ai-typing__text">Elif yazıyor…</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ai-composer">
              <div className="ai-composer__box">
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
                  className="moren-ai-input ai-composer__input"
                />
                <button
                  type="button"
                  onClick={handleMic}
                  disabled={sendMutation.isPending}
                  className={`ai-btn ai-btn--icon shrink-0 ${micLive ? 'ai-btn--danger' : ''}`}
                  title={micLive ? 'Sesi durdur' : 'Mikrofonla sor'}
                >
                  {voice.status === 'connecting' ? <Loader2 size={16} className="animate-spin" /> : micLive ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || sendMutation.isPending}
                  className="ai-btn ai-btn--primary ai-btn--icon shrink-0"
                  title="Gönder (Enter)"
                >
                  {sendMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              <p className="ai-composer__hint">Enter gönderir · Shift+Enter yeni satır</p>
            </div>
          </div>
        </section>
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
        <div className="ai-hello">
          <span className="ai-avatar ai-avatar--lg">
            E
            <span className="ai-avatar__dot" />
          </span>
          <div>
            <h3 className="ai-hello__title">Merhaba, ben Elif</h3>
            <p className="ai-hello__text">Ofisin sekreteriyim — mükellef, beyan, evrak, tahsilat… ne lazımsa yazman yeterli.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => askQuick(prompt)} className="ai-prompt">
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type ToolView = {
  name: string;
  input?: any;
  result?: any;
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
  const zaman = mesajSaati(message.createdAt);
  const tokenVar = !isUser && !!(message.inputTokens || message.outputTokens);

  return (
    <div className="ai-msg" data-role={isUser ? 'user' : 'assistant'}>
      {!isUser && (
        <span className="ai-avatar ai-avatar--sm" title="Elif — MOREN AI Ofis Sekreteri">
          E
        </span>
      )}
      <div className="ai-msg__bubble">
        <div className="moren-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
        {/* "Kullanılan veri ve araçlar" rozeti kaldırıldı (kullanıcı kararı 2026-07-04) —
            teknik araç listesi sekreter sohbetinde görünmesin. previews için tools hâlâ okunuyor. */}
        {!isUser && previews.length > 0
          ? previews.map((preview: any, index: number) => (
              <div key={`${preview.agent}-${preview.action}-${index}`} className="ai-action" data-ok={preview.ok ? 'true' : 'false'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="ai-action__title">Onay bekleyen aksiyon</p>
                    <p className="ai-action__meta">{preview.agent} · {preview.action}</p>
                  </div>
                  <span className="ai-action__badge">{preview.ok ? 'Hazır' : 'Eksik'}</span>
                </div>
                {preview.etki ? <p className="ai-action__effect">{preview.etki}</p> : null}
                {Array.isArray(preview.errors) && preview.errors.length > 0 ? (
                  <ul className="ai-action__errors">
                    {preview.errors.map((error: string) => <li key={error}>{error}</li>)}
                  </ul>
                ) : null}
                <button
                  type="button"
                  disabled={!preview.ok || confirming}
                  onClick={() => onConfirmAction?.(preview)}
                  className="ai-btn ai-btn--sm ai-btn--primary mt-2.5"
                >
                  {confirming ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Onayla ve kuyruğa al
                </button>
              </div>
            ))
          : null}
        {(zaman || tokenVar) && (
          <div className="ai-msg__foot">
            {zaman && <time dateTime={message.createdAt}>{zaman}</time>}
            {tokenVar && (
              <>
                <span aria-hidden>·</span>
                <span title="Bu yanıtın maliyeti">${message.costUsd?.toFixed(4) || '0.0000'}</span>
                <span aria-hidden>·</span>
                <span>{message.inputTokens || 0}+{message.outputTokens || 0} token</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
