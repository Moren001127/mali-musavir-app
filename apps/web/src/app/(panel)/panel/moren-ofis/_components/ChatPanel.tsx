'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import type { OfisAgent, OfisMessage, AgentId } from '@/lib/moren-ofis';
import { speakAs, stopSpeech, startListening, isSpeechSupported, isSynthesisSupported } from './voice';

export function ChatPanel({
  agents,
  messages,
  sending,
  onSend,
}: {
  agents: OfisAgent[];
  messages: OfisMessage[];
  sending: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(true);
  // Sesli sohbet modu — açıkken: sen konuş bitir, otomatik gönder;
  // ekip sesli cevap verir; cevap bitince mikrofon tekrar açılır (sonsuz döngü).
  const [voiceMode, setVoiceMode] = useState(false);
  const [lastSpokenIdx, setLastSpokenIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Yeni ajan mesajları geldikçe sesli oku (eğer ses açıksa)
  useEffect(() => {
    if (!speakEnabled || !isSynthesisSupported()) return;
    if (messages.length === 0) return;

    // Sadece yeni mesajları sırayla oku, hepsi bitince mikrofona dön
    const newMessages = messages.slice(lastSpokenIdx + 1);
    const agentMessages = newMessages.filter((m) => m.agent !== 'user');
    if (agentMessages.length === 0) {
      setLastSpokenIdx(messages.length - 1);
      return;
    }

    (async () => {
      for (const m of agentMessages) {
        await speakAs(m.agent as AgentId, m.content).catch(() => {});
      }
      // Ekip konuşmayı bitirdi — sesli sohbet modu açıksa mikrofonu yeniden aç
      if (voiceMode && !sendingRef.current) {
        startListeningAuto();
      }
    })();

    setLastSpokenIdx(messages.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, speakEnabled]);

  /**
   * Mikrofon başlat — final transcript geldiğinde otomatik onSend tetiklenir.
   * voiceMode açıkken döngü: dinle → gönder → ekip sesli cevapla → dinlemeye dön.
   */
  const startListeningAuto = () => {
    if (!isSpeechSupported()) return;
    setListening(true);
    listenerRef.current = startListening({
      onResult: (transcript, isFinal) => {
        setText(transcript);
        if (isFinal && transcript.trim().length > 0) {
          listenerRef.current = null;
          setListening(false);
          // Otomatik gönder — karşılıklı sohbet hissi
          onSend(transcript.trim());
          setText('');
        }
      },
      onError: () => {
        setListening(false);
        listenerRef.current = null;
      },
      onEnd: () => {
        setListening(false);
        listenerRef.current = null;
      },
    });
  };

  const toggleMic = () => {
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
      return;
    }
    if (!isSpeechSupported()) {
      alert('Sesli komut için Chrome veya Edge kullanın');
      return;
    }
    startListeningAuto();
  };

  /**
   * Sesli sohbet modu — sürekli karşılıklı konuşma. Açınca mikrofon otomatik
   * başlar, sen konuşunca gönderilir, ekip sesli cevap verir, bitince
   * mikrofon yeniden açılır.
   */
  const toggleVoiceMode = () => {
    if (voiceMode) {
      setVoiceMode(false);
      if (listening) {
        listenerRef.current?.stop();
        setListening(false);
      }
      stopSpeech();
    } else {
      setVoiceMode(true);
      setSpeakEnabled(true); // sesli mod açıksa sesli cevap da açık olmalı
      startListeningAuto();
    }
  };

  const toggleSpeak = () => {
    if (speakEnabled) {
      stopSpeech();
    }
    setSpeakEnabled(!speakEnabled);
  };

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const submit = () => {
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{
        background: 'rgba(15,11,21,0.85)',
        border: '1px solid rgba(212,184,118,0.18)',
        backdropFilter: 'blur(10px)',
        height: 680,
      }}
    >
      {/* Başlık */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] uppercase tracking-[.16em] font-bold" style={{ color: '#d4b876' }}>
          Ekip Konuşması
        </div>
        <div className="text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {messages.length === 0 ? 'Ekibe bir şey sor — ARDA size yönlendirir' : `${messages.length} mesaj`}
        </div>
      </div>

      {/* Mesajlar */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <div className="text-sm" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz konuşma yok
            </div>
            <div className="text-xs" style={{ color: 'rgba(250,250,249,0.35)' }}>
              Örnek: "Petravet için Mayıs KDV durumu?"<br />
              "Asgari ücretliye AGİ ne kadar?"<br />
              "Mizan'da olağandışı bir şey var mı?"
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.agent === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className="px-3 py-2 rounded-lg max-w-[80%] text-sm"
                    style={{
                      background: 'rgba(212,184,118,0.12)',
                      border: '1px solid rgba(212,184,118,0.25)',
                      color: '#fafaf9',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }
            const persona = agentMap[m.agent as AgentId];
            return (
              <div key={i} className="flex flex-col gap-1 animate-fade-in-up" style={{
                animation: 'fade-in-up 0.4s ease-out',
              }}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: persona?.accentColor || '#888' }}
                  />
                  <span className="text-[11px] font-bold tracking-wider" style={{ color: persona?.accentColor || '#888' }}>
                    {persona?.displayName || m.agent.toUpperCase()}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {persona?.role}
                  </span>
                  {m.durationMs && (
                    <span className="text-[9px] ml-auto" style={{ color: 'rgba(250,250,249,0.3)' }}>
                      {(m.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div
                  className="px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${persona?.accentColor ? `${persona.accentColor}33` : 'rgba(255,255,255,0.06)'}`,
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
          <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ color: '#d4b876' }}>
            <Loader2 size={12} className="animate-spin" />
            Ekip çalışıyor...
          </div>
        )}
      </div>

      {/* Input + ses kontrolleri */}
      <div className="px-3 py-3 border-t space-y-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {/* Ses ayar barı */}
        <div className="flex items-center gap-2 text-[10px] flex-wrap" style={{ color: 'rgba(250,250,249,0.55)' }}>
          <button
            onClick={toggleSpeak}
            className="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{
              background: speakEnabled ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
              color: speakEnabled ? '#86efac' : 'rgba(250,250,249,0.5)',
            }}
            title={speakEnabled ? 'Ekip sesli konuşuyor - kapat' : 'Ekibi sesli dinle - aç'}
          >
            {speakEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
            {speakEnabled ? 'Sesli' : 'Sessiz'}
          </button>
          <button
            onClick={toggleVoiceMode}
            className="flex items-center gap-1 px-2 py-1 rounded transition-colors font-bold"
            style={{
              background: voiceMode ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
              color: voiceMode ? '#d4b876' : 'rgba(250,250,249,0.5)',
              border: voiceMode ? '1px solid rgba(212,184,118,0.4)' : '1px solid transparent',
            }}
            title="Karşılıklı sesli sohbet — konuş, ekip cevaplasın, döngü"
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
            placeholder={listening ? 'Dinliyorum...' : 'Ekibe talimat ver...'}
            disabled={sending}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : 'rgba(212,184,118,0.25)'}`,
              color: '#fafaf9',
            }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || sending}
            className="px-3 rounded-lg disabled:opacity-50"
            style={{
              background: '#d4b876',
              color: '#15110b',
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
