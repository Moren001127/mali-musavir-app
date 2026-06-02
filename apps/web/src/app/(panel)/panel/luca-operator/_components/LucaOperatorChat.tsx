'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, MicOff, Volume2, VolumeX, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { lucaOperatorChatStream } from '@/lib/moren-ai';
import { speak, stopSpeech, startListening, isSpeechSupported, isSynthesisSupported } from './voice';

const ACCENT = '#d4b876'; // altın — Luca Operatörü modül rengi
const STORAGE_KEY = 'luca-operator-chat-v1'; // sohbet tarayıcıda saklanır (ekran değişince kaybolmasın)

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  ts: number;
}

const ORNEKLER = [
  'Petravet için Mayıs mizanını çek',
  'Hangi mükelleflerin işletme defteri var?',
  'Bu ay KDV son günü olan mükellefler kim?',
];

export function LucaOperatorChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const voiceModeRef = useRef(false);
  const speakEnabledRef = useRef(false);
  const sendingRef = useRef(false);
  voiceModeRef.current = voiceMode;
  speakEnabledRef.current = speakEnabled;
  sendingRef.current = sending;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, currentTool]);

  // Sohbeti tarayıcıdan geri yükle (ekran değişse de kaybolmasın)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setMessages(arr);
      }
    } catch {}
  }, []);

  // Her değişiklikte sakla (son 50 mesaj)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
    } catch {}
  }, [messages]);

  const clearChat = () => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const lastAssistantIndex = (arr: Msg[]) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].role === 'assistant') return i;
    return -1;
  };
  const patchLastAssistant = (fn: (m: Msg) => Msg) =>
    setMessages((arr) => {
      const i = lastAssistantIndex(arr);
      if (i < 0) return arr;
      const c = [...arr];
      c[i] = fn(c[i]);
      return c;
    });

  // Mikrofonu başlat — final transcript gelince otomatik gönderir.
  const startListeningAuto = (): boolean => {
    if (!isSpeechSupported()) {
      toast.error('Sesli komut bu tarayıcıda desteklenmiyor', {
        description: 'Chrome veya Edge ile açıp mikrofon iznini verin.',
      });
      setVoiceMode(false);
      return false;
    }
    setListening(true);
    const l = startListening({
      onResult: (transcript, isFinal) => {
        setText(transcript);
        if (isFinal && transcript.trim()) {
          listenerRef.current = null;
          setListening(false);
          send(transcript);
        }
      },
      onError: (err) => {
        toast.error('Mikrofon başlatılamadı', { description: err });
        setListening(false);
        setVoiceMode(false);
        listenerRef.current = null;
      },
      onEnd: () => {
        setListening(false);
        listenerRef.current = null;
      },
    });
    listenerRef.current = l;
    if (!l) {
      setListening(false);
      return false;
    }
    return true;
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || sendingRef.current) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const now = Date.now();
    setMessages((m) => [
      ...m,
      { role: 'user', content: message, ts: now },
      { role: 'assistant', content: '', tools: [], ts: now + 1 },
    ]);
    setText('');
    setSending(true);
    setCurrentTool(null);

    let acc = '';
    let hadError = false;
    const toolset = new Set<string>();

    try {
      await lucaOperatorChatStream({ message, history, voiceMode: voiceModeRef.current }, (e) => {
        if (e.type === 'text') {
          acc += e.delta;
          patchLastAssistant((m) => ({ ...m, content: acc }));
        } else if (e.type === 'tool') {
          if (e.name) {
            toolset.add(e.name);
            setCurrentTool(e.name);
            patchLastAssistant((m) => ({ ...m, tools: [...toolset] }));
          }
        } else if (e.type === 'error') {
          hadError = true;
          acc = (acc ? acc + '\n\n' : '') + `⚠️ ${e.error || 'Yanıt alınamadı'}`;
          patchLastAssistant((m) => ({ ...m, content: acc }));
        }
      });
    } catch (err: any) {
      hadError = true;
      acc = (acc ? acc + '\n\n' : '') + `⚠️ Hata: ${err?.message || err}`;
      patchLastAssistant((m) => ({ ...m, content: acc }));
    } finally {
      setCurrentTool(null);
      patchLastAssistant((m) => ({ ...m, content: acc || '(boş yanıt)', tools: [...toolset] }));
      setSending(false);
    }

    // Sesli yanıt açıksa cevabı oku; sohbet modundaysa mikrofonu tekrar aç (eller serbest döngü).
    if (!hadError && acc && speakEnabledRef.current && isSynthesisSupported()) {
      await speak(acc).catch(() => {});
    }
    if (voiceModeRef.current && !listenerRef.current && !sendingRef.current) {
      startListeningAuto();
    }
  };

  const toggleMic = () => {
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
      return;
    }
    startListeningAuto();
  };

  const toggleVoiceMode = () => {
    if (voiceMode) {
      setVoiceMode(false);
      if (listening) {
        listenerRef.current?.stop();
        setListening(false);
      }
      stopSpeech();
    } else {
      stopSpeech();
      setSpeakEnabled(true); // sohbet modu açıksa sesli yanıt da açık olmalı
      if (startListeningAuto()) setVoiceMode(true);
    }
  };

  const toggleSpeak = () => {
    if (speakEnabled) stopSpeech();
    setSpeakEnabled((s) => !s);
  };

  const submit = () => {
    if (!text.trim() || sending) return;
    send(text);
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-2xl"
      style={{ background: 'rgba(15,13,9,0.85)', border: `1px solid ${ACCENT}26`, backdropFilter: 'blur(10px)' }}
    >
      {/* Başlık */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: ACCENT }}>
            Luca Operatörü ile Konuşma
          </div>
          <div className="text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {voiceMode
              ? 'Sohbet modu açık — konuş, cevap versin, mikrofon tekrar açılır'
              : messages.length === 0
                ? 'Bir şey iste — gerekirse sana soru sorar'
                : `${messages.length} mesaj · kaydedildi`}
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-white/5"
            style={{ color: 'rgba(250,250,249,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
            title="Sohbeti temizle"
          >
            Temizle
          </button>
        )}
      </div>

      {/* Mesajlar */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="space-y-4 py-10">
            <div className="text-center text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz konuşma yok
            </div>
            <div className="flex flex-col items-center gap-2">
              {ORNEKLER.map((o) => (
                <button
                  key={o}
                  onClick={() => send(o)}
                  className="rounded-lg px-3 py-1.5 text-xs transition-colors"
                  style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}2e`, color: 'rgba(250,250,249,0.8)' }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
                    style={{ background: `${ACCENT}1f`, border: `1px solid ${ACCENT}3a`, color: '#fafaf9' }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }
            const empty = !m.content;
            return (
              <div key={i} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: ACCENT }}>
                  LUCA OPERATÖRÜ
                </span>
                {m.tools && m.tools.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    <Wrench size={10} />
                    {m.tools.length} veri sorgusu
                  </div>
                )}
                {!empty && (
                  <div
                    className="whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.92)' }}
                  >
                    {m.content}
                  </div>
                )}
              </div>
            );
          })
        )}
        {sending && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ color: ACCENT }}>
            <Loader2 size={12} className="animate-spin" />
            {currentTool ? `${currentTool} çalışıyor...` : 'Düşünüyor...'}
          </div>
        )}
      </div>

      {/* Girdi + ses */}
      <div className="flex-shrink-0 space-y-2 border-t px-3 py-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex flex-wrap items-center gap-2 text-[10px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
          <button
            onClick={toggleSpeak}
            className="flex items-center gap-1 rounded px-2 py-1 transition-colors"
            style={{
              background: speakEnabled ? `${ACCENT}1a` : 'rgba(255,255,255,0.04)',
              color: speakEnabled ? ACCENT : 'rgba(250,250,249,0.5)',
            }}
            title={speakEnabled ? 'Sesli yanıt açık - kapat' : 'Sesli yanıt - aç'}
          >
            {speakEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
            {speakEnabled ? 'Sesli Yanıt' : 'Sessiz'}
          </button>
          <button
            onClick={toggleVoiceMode}
            className="flex items-center gap-1 rounded px-2 py-1 font-bold transition-colors"
            style={{
              background: voiceMode ? `${ACCENT}22` : 'rgba(255,255,255,0.04)',
              color: voiceMode ? ACCENT : 'rgba(250,250,249,0.5)',
              border: voiceMode ? `1px solid ${ACCENT}55` : '1px solid transparent',
            }}
            title="Karşılıklı sesli sohbet — konuş, cevap versin, mikrofon tekrar açılsın"
          >
            {voiceMode ? '🎙 SOHBET AÇIK' : '🎙 Sohbet Modu'}
          </button>
          <span className="opacity-50">·</span>
          <span>{voiceMode ? 'Konuşunca otomatik gönderilir' : 'Enter ile gönder, mikrofonla konuş'}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleMic}
            disabled={sending}
            className="rounded-lg px-3 transition-colors disabled:opacity-50"
            style={{
              background: listening ? 'rgba(239,68,68,0.20)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`,
              color: listening ? '#fca5a5' : 'rgba(250,250,249,0.6)',
            }}
            title={listening ? 'Dinlemeyi durdur' : 'Sesli komut için tıkla'}
          >
            {listening ? <MicOff size={16} className="animate-pulse" /> : <Mic size={16} />}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={listening ? 'Dinliyorum...' : 'Luca operatörüne talimat ver...'}
            disabled={sending}
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : `${ACCENT}3a`}`,
              color: '#fafaf9',
            }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending}
            className="rounded-lg px-3 disabled:opacity-50"
            style={{ background: ACCENT, color: '#15110b' }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
