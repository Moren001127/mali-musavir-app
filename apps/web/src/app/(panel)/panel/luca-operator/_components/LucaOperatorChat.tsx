'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { chat } from '@/lib/moren-ai';
import { speak, stopSpeech, startListening, isSpeechSupported, isSynthesisSupported } from './voice';

const ACCENT = '#a78bfa'; // mor — Luca Operatörü modül rengi

interface Msg {
  role: 'user' | 'assistant';
  content: string;
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
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || sending) return;
    setMessages((m) => [...m, { role: 'user', content: message, ts: Date.now() }]);
    setText('');
    setSending(true);
    try {
      const res = await chat({ conversationId, message, currentPath: '/panel/luca-operator' });
      setConversationId(res.conversationId);
      const reply = res.assistantMessage || '(boş yanıt)';
      setMessages((m) => [...m, { role: 'assistant', content: reply, ts: Date.now() }]);
      if (speakEnabled && isSynthesisSupported()) {
        speak(reply).catch(() => {});
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Yanıt alınamadı';
      toast.error('Çalışan cevap veremedi', { description: String(msg) });
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Hata: ${msg}`, ts: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  const toggleMic = () => {
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
      return;
    }
    if (!isSpeechSupported()) {
      toast.error('Sesli komut için Chrome veya Edge kullanın', {
        description: 'Tarayıcı ses tanımayı desteklemiyor.',
      });
      return;
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
        listenerRef.current = null;
      },
      onEnd: () => {
        setListening(false);
        listenerRef.current = null;
      },
    });
    listenerRef.current = l;
    if (!l) setListening(false);
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
      className="flex flex-col rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(15,12,21,0.85)',
        border: `1px solid ${ACCENT}26`,
        backdropFilter: 'blur(10px)',
        height: 620,
      }}
    >
      {/* Başlık */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] uppercase tracking-[.16em] font-bold" style={{ color: ACCENT }}>
          Luca Operatörü ile Konuşma
        </div>
        <div className="text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {messages.length === 0 ? 'Bir şey iste — gerekirse sana soru sorar' : `${messages.length} mesaj`}
        </div>
      </div>

      {/* Mesajlar */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="py-10 space-y-4">
            <div className="text-center text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz konuşma yok
            </div>
            <div className="flex flex-col items-center gap-2">
              {ORNEKLER.map((o) => (
                <button
                  key={o}
                  onClick={() => send(o)}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: `${ACCENT}12`,
                    border: `1px solid ${ACCENT}2e`,
                    color: 'rgba(250,250,249,0.8)',
                  }}
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
                    className="px-3 py-2 rounded-lg max-w-[80%] text-sm"
                    style={{
                      background: `${ACCENT}1f`,
                      border: `1px solid ${ACCENT}3a`,
                      color: '#fafaf9',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: ACCENT }}>
                  LUCA OPERATÖRÜ
                </span>
                <div
                  className="px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    color: 'rgba(250,250,249,0.92)',
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        {sending && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ color: ACCENT }}>
            <Loader2 size={12} className="animate-spin" />
            Çalışıyor...
          </div>
        )}
      </div>

      {/* Girdi + ses */}
      <div className="px-3 py-3 border-t space-y-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
          <button
            onClick={toggleSpeak}
            className="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{
              background: speakEnabled ? `${ACCENT}1a` : 'rgba(255,255,255,0.04)',
              color: speakEnabled ? ACCENT : 'rgba(250,250,249,0.5)',
            }}
            title={speakEnabled ? 'Sesli yanıt açık - kapat' : 'Sesli yanıt - aç'}
          >
            {speakEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
            {speakEnabled ? 'Sesli Yanıt' : 'Sessiz'}
          </button>
          <span className="opacity-50">·</span>
          <span>Enter ile gönder, mikrofonla konuş</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleMic}
            disabled={sending}
            className="px-3 rounded-lg disabled:opacity-50 transition-colors"
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
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : `${ACCENT}3a`}`,
              color: '#fafaf9',
            }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending}
            className="px-3 rounded-lg disabled:opacity-50"
            style={{ background: ACCENT, color: '#15110b' }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
