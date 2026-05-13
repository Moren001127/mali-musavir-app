'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, MicOff, Volume2, VolumeX, Sparkles, RefreshCw, Wrench, Bell, Paperclip, X, FileText, CheckCircle2, AlertTriangle, Clock3, FileSpreadsheet } from 'lucide-react';
import type { OfisAgent, OfisMessage, AgentId, MizanGelirWorkflowEvent } from '@/lib/moren-ofis';
import { ofisApi } from '@/lib/moren-ofis';
import { speakAs, stopSpeech, startListening, isSpeechSupported, isSynthesisSupported } from './voice';
import { toast } from 'sonner';

const GOLD = '#d4b876';

function formatTry(value?: number) {
  const num = Number(value || 0);
  return `${num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function WorkflowEventCard({ workflow, content }: { workflow: MizanGelirWorkflowEvent; content: string }) {
  const terminal = workflow.phase === 'completed';
  const failed = workflow.phase === 'failed' || workflow.phase === 'cancelled';
  const accent = terminal ? '#86efac' : failed ? '#fca5a5' : GOLD;
  const Icon = terminal ? CheckCircle2 : failed ? AlertTriangle : Clock3;
  const phaseLabel: Record<string, string> = {
    queued: 'Sırada',
    running: 'Çalışıyor',
    waiting_mizan: 'Mizan bekleniyor',
    completed: 'Tamamlandı',
    failed: 'Hata',
    cancelled: 'İptal',
    needs_clarification: 'Netleştirme',
  };

  return (
    <div
      className="animate-fade-in-up rounded-lg px-3.5 py-3 text-[12px]"
      style={{
        animation: 'fade-in-up 0.35s ease-out',
        background: 'rgba(15,11,21,0.72)',
        border: `1px solid ${accent}35`,
        color: 'rgba(250,250,249,0.88)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} style={{ color: accent }} />
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: accent }}>
          Sistem Olayı
        </span>
        <span className="ml-auto text-[10px] font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>
          {phaseLabel[workflow.phase] || workflow.phase}
        </span>
      </div>
      <div className="font-medium mb-2">{content}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        {workflow.jobId && <WorkflowPill label="jobId" value={workflow.jobId} />}
        {workflow.taxpayerName && <WorkflowPill label="mükellef" value={workflow.taxpayerName} />}
        {workflow.donem && <WorkflowPill label="dönem" value={workflow.donem} />}
        {workflow.donemTipi && <WorkflowPill label="tip" value={workflow.donemTipi} />}
        {workflow.mizanId && <WorkflowPill label="mizanId" value={workflow.mizanId} />}
        {workflow.gelirTablosuId && <WorkflowPill label="gelirTablosuId" value={workflow.gelirTablosuId} />}
      </div>
      {workflow.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-2">
          <WorkflowPill label="net satış" value={formatTry(workflow.summary.netSatislar)} />
          <WorkflowPill label="brüt kâr" value={formatTry(workflow.summary.brutSatisKari)} />
          <WorkflowPill label="faaliyet kârı" value={formatTry(workflow.summary.faaliyetKari)} />
          <WorkflowPill label="net kâr" value={formatTry(workflow.summary.donemNetKari)} />
        </div>
      )}
      {workflow.error && (
        <div className="mt-2 text-[11px]" style={{ color: '#fca5a5' }}>
          {workflow.error}
        </div>
      )}
      {workflow.logs && workflow.logs.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
          <FileSpreadsheet size={11} style={{ color: accent, flexShrink: 0, marginTop: 2 }} />
          <span>{workflow.logs.slice(-2).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

function WorkflowPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="min-w-0 rounded px-2 py-1"
      style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="text-[9px] uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.36)' }}>
        {label}
      </div>
      <div className="truncate font-mono text-[10.5px]" style={{ color: 'rgba(250,250,249,0.82)' }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Dashboard'un "Bugünkü Brifing" kartı tarzında — koyu altın çerçeve,
 * Fraunces başlık, mesajlar madde madde liste gibi akar.
 */
export function BriefingChat({
  agents,
  messages,
  sending,
  onSend,
  onSendFile,
}: {
  agents: OfisAgent[];
  messages: OfisMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  onSendFile?: (files: File[], text: string) => void;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  // speakEnabled localStorage'da kalıcı — sayfa yenilenince geri açılmasın
  const [speakEnabled, setSpeakEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('moren-ofis-speak') === 'true';
  });
  const [voiceMode, setVoiceMode] = useState(false);
  const [lastSpokenIdx, setLastSpokenIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  // İlk mount'ta geçmiş mesajları sesli OKUMA — sadece bookmark olarak işaretle
  const initialBookmarkRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    // İlk yüklemede (sayfa açılınca DB'den gelen geçmiş mesajlar)
    // hiçbirini sesli OKUMA — sadece son indeksi bookmark koy.
    if (!initialBookmarkRef.current && messages.length > 0) {
      initialBookmarkRef.current = true;
      setLastSpokenIdx(messages.length - 1);
      return;
    }

    if (!speakEnabled || !isSynthesisSupported()) return;
    if (messages.length === 0) return;
    const newMessages = messages.slice(lastSpokenIdx + 1);
    const agentMessages = newMessages.filter((m) => m.agent !== 'user' && m.agent !== 'system');
    if (agentMessages.length === 0) {
      setLastSpokenIdx(messages.length - 1);
      return;
    }
    (async () => {
      for (const m of agentMessages) {
        await speakAs(m.agent as AgentId, m.content).catch(() => {});
      }
      if (voiceMode && !sendingRef.current) {
        startListeningAuto();
      }
    })();
    setLastSpokenIdx(messages.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, speakEnabled]);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const submit = () => {
    if (sending) return;
    if (pendingFiles.length > 0 && onSendFile) {
      onSendFile(pendingFiles, text.trim());
      setText('');
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;
    // 10MB üstü reddet
    const oversize = newFiles.filter((f) => f.size > 10 * 1024 * 1024);
    if (oversize.length > 0) {
      toast.error(`${oversize.length} dosya 10MB üstü, atlandı`);
    }
    const valid = newFiles.filter((f) => f.size <= 10 * 1024 * 1024);
    setPendingFiles((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > 5) {
        toast.error('Max 5 dosya — fazlası atıldı');
        return combined.slice(0, 5);
      }
      return combined;
    });
    // input clear ki aynı dosya tekrar seçilebilir
    if (e.target) e.target.value = '';
  };

  const startListeningAuto = () => {
    if (!isSpeechSupported()) {
      toast.error('Sesli komut bu tarayıcıda desteklenmiyor', {
        description: 'Chrome veya Edge ile açıp mikrofon iznini verin.',
      });
      setVoiceMode(false);
      return false;
    }
    setListening(true);
    const listener = startListening({
      onResult: (transcript, isFinal) => {
        setText(transcript);
        if (isFinal && transcript.trim().length > 0) {
          listenerRef.current = null;
          setListening(false);
          onSend(transcript.trim());
          setText('');
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
    listenerRef.current = listener;
    if (!listener) {
      setListening(false);
      return false;
    }
    return true;
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
        description: 'Tarayıcı mikrofon/ses tanıma desteği vermiyor.',
      });
      return;
    }
    startListeningAuto();
  };

  const toggleSpeak = () => {
    const next = !speakEnabled;
    if (speakEnabled) stopSpeech();
    setSpeakEnabled(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('moren-ofis-speak', String(next));
    }
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
      setSpeakEnabled(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('moren-ofis-speak', 'true');
      }
      if (startListeningAuto()) {
        setVoiceMode(true);
      }
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.06) 0%, rgba(15,11,21,0.85) 100%)',
        border: '1px solid rgba(212,184,118,0.22)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        minHeight: 540,
      }}
    >
      {/* Üst hairline */}
      <span
        className="h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          opacity: 0.45,
        }}
      />

      {/* Başlık — brifing tarzı */}
      <div
        className="px-5 pt-4 pb-3 flex items-start justify-between gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={13} style={{ color: GOLD }} />
            <span
              className="text-[10.5px] uppercase font-bold tracking-[.18em]"
              style={{ color: GOLD }}
            >
              Ekip Brifingi
            </span>
            {sending && (
              <span
                className="text-[10px] font-bold px-2 py-[2px] rounded flex items-center gap-1"
                style={{ background: 'rgba(212,184,118,0.15)', color: GOLD }}
              >
                <Loader2 size={9} className="animate-spin" /> ÇALIŞIYOR
              </span>
            )}
          </div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#fafaf9',
              lineHeight: 1.2,
            }}
          >
            {messages.length === 0
              ? 'Ekibe talimat ver, dinleyelim'
              : `${messages.length} mesaj akışta`}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            7 kişilik ekip · Arda yönlendirir, uzmanlar cevaplar
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleSpeak}
            className="px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase flex items-center gap-1 tracking-wider transition"
            style={{
              background: speakEnabled ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${speakEnabled ? 'rgba(34,197,94,0.30)' : 'rgba(255,255,255,0.08)'}`,
              color: speakEnabled ? '#86efac' : 'rgba(250,250,249,0.55)',
            }}
            title={speakEnabled ? 'Sesli kapat' : 'Sesli aç'}
          >
            {speakEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
            {speakEnabled ? 'Yanıt Sesi' : 'Sessiz'}
          </button>
          <button
            onClick={toggleVoiceMode}
            className="px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase flex items-center gap-1 tracking-wider transition"
            style={{
              background: voiceMode ? `${GOLD}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${voiceMode ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`,
              color: voiceMode ? GOLD : 'rgba(250,250,249,0.55)',
            }}
            title="Karşılıklı sesli sohbet — konuşunca otomatik gönderilir"
          >
            <Mic size={11} /> {voiceMode ? 'Sohbet Açık' : 'Sohbet Modu'}
          </button>
        </div>
      </div>

      {/* Mesaj akışı — brifing maddeleri tarzı */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        {messages.length === 0 ? (
          <div className="space-y-2 py-4">
            {[
              '"Petravet için Mayıs KDV durumu nedir?" — NEVRA bakar',
              '"Asgari ücretliye AGİ hesabı" — VOLKAN cevaplar',
              '"Mizan\'da olağandışı bir şey var mı?" — CEM kontrol eder',
              '"Bu hafta hangi mükellefe hatırlatma gönderelim?" — DEFNE planlar',
              '"Sistem nasıl, gece olaylar var mı?" — DENİZ raporlar',
            ].map((tip, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  color: 'rgba(250,250,249,0.65)',
                }}
              >
                <Sparkles size={11} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
                <span>{tip}</span>
              </div>
            ))}
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.agent === 'system') {
              return m.workflow?.kind === 'mizan_gelir_workflow' ? (
                <WorkflowEventCard key={i} workflow={m.workflow} content={m.content} />
              ) : (
                <div
                  key={i}
                  className="rounded-lg px-3.5 py-2.5 text-[12px] animate-fade-in-up"
                  style={{
                    animation: 'fade-in-up 0.35s ease-out',
                    background: 'rgba(212,184,118,0.08)',
                    border: `1px solid ${GOLD}28`,
                    color: 'rgba(250,250,249,0.78)',
                  }}
                >
                  {m.content}
                </div>
              );
            }
            if (m.agent === 'user') {
              return (
                <div
                  key={i}
                  className="flex justify-end animate-fade-in-up"
                  style={{ animation: 'fade-in-up 0.3s ease-out' }}
                >
                  <div
                    className="px-3.5 py-2 rounded-lg max-w-[80%] text-[13px]"
                    style={{
                      background: `${GOLD}18`,
                      border: `1px solid ${GOLD}30`,
                      color: '#fafaf9',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              );
            }
            const persona = agentMap[m.agent as AgentId];
            const accent = persona?.accentColor || GOLD;
            return (
              <div
                key={i}
                className="animate-fade-in-up"
                style={{ animation: 'fade-in-up 0.4s ease-out' }}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: accent, animation: 'pulse 2s' }}
                  />
                  <span
                    className="text-[10.5px] uppercase font-bold tracking-[.14em]"
                    style={{ color: accent }}
                  >
                    {persona?.displayName || m.agent.toUpperCase()}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    · {persona?.role.split('/')[0].trim()}
                  </span>
                  {m.durationMs && (
                    <span
                      className="text-[9.5px] ml-auto font-mono"
                      style={{ color: 'rgba(250,250,249,0.3)' }}
                    >
                      {(m.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div
                  className="px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${accent}28`,
                    color: 'rgba(250,250,249,0.92)',
                  }}
                >
                  {m.content}
                </div>
                {/* FAZ 1 — Tool çağrı rozeti (hangi canlı veri yüklendi) */}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 px-1">
                    {m.toolCalls.map((tc, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded text-[9.5px] font-mono"
                        style={{
                          background: tc.ok ? `${accent}12` : 'rgba(239,68,68,0.12)',
                          border: `1px solid ${tc.ok ? `${accent}30` : 'rgba(239,68,68,0.30)'}`,
                          color: tc.ok ? accent : '#fca5a5',
                        }}
                        title={`${tc.tool}(${JSON.stringify(tc.input)}) — ${tc.durationMs}ms`}
                      >
                        <Wrench size={9} />
                        {tc.tool}
                        {!tc.ok && ' ✕'}
                      </span>
                    ))}
                  </div>
                )}
                {/* FAZ 3 — Hatırlatmaya çevir butonu (PendingAction'a düşer) */}
                <div className="flex gap-1.5 mt-1 px-1">
                  <button
                    onClick={async () => {
                      try {
                        await ofisApi.proposeReminder({
                          agent: m.agent as string,
                          title: m.content.slice(0, 80),
                          content: m.content,
                        });
                        toast.success('Onay kuyruğuna eklendi', {
                          description: 'AI Onay Kuyruğu sayfasından onaylayabilirsin',
                        });
                      } catch (e: any) {
                        toast.error(e?.response?.data?.message || e?.message || 'Hata');
                      }
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded text-[9.5px] uppercase tracking-wider font-bold transition hover:opacity-100 opacity-60"
                    style={{
                      background: 'rgba(212,184,118,0.08)',
                      border: '1px solid rgba(212,184,118,0.20)',
                      color: GOLD,
                    }}
                    title="Bu mesajı hatırlatma önerisi olarak AI Onay Kuyruğu'na ekle"
                  >
                    <Bell size={9} /> Hatırlatmaya Çevir
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pending file chips — çoklu, input üzerinde */}
      {pendingFiles.length > 0 && (
        <div
          className="px-4 py-2 flex flex-wrap items-center gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(212,184,118,0.06)' }}
        >
          <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: GOLD }}>
            {pendingFiles.length} evrak
          </span>
          {pendingFiles.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
              style={{ background: 'rgba(0,0,0,0.30)', border: `1px solid ${GOLD}30` }}
            >
              <FileText size={11} style={{ color: GOLD }} />
              <span style={{ color: '#fafaf9' }}>{f.name}</span>
              <span className="font-mono opacity-60" style={{ color: 'rgba(250,250,249,0.6)' }}>
                {(f.size / 1024).toFixed(0)}KB
              </span>
              <button
                onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-0.5 p-0.5 rounded hover:bg-white/10"
                title="Kaldır"
              >
                <X size={10} style={{ color: 'rgba(250,250,249,0.55)' }} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input — alt bar */}
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(15,11,21,0.55)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.csv,.md,.pdf,application/pdf"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
        {onSendFile && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || pendingFiles.length >= 5}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition disabled:opacity-50 relative"
            style={{
              background: pendingFiles.length > 0 ? `${GOLD}25` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pendingFiles.length > 0 ? `${GOLD}50` : 'rgba(255,255,255,0.08)'}`,
              color: pendingFiles.length > 0 ? GOLD : 'rgba(250,250,249,0.65)',
            }}
            title="Evrak/resim ekle (max 5 dosya, dosya başı 10MB, OCR + PDF)"
          >
            <Paperclip size={15} />
            {pendingFiles.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: GOLD, color: '#0f0d0b' }}>
                {pendingFiles.length}
              </span>
            )}
          </button>
        )}
        <button
          onClick={toggleMic}
          disabled={sending}
          className="w-10 h-10 rounded-xl flex items-center justify-center transition disabled:opacity-50"
          style={{
            background: listening ? 'rgba(239,68,68,0.20)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${listening ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`,
            color: listening ? '#fca5a5' : 'rgba(250,250,249,0.65)',
          }}
          title={listening ? 'Dinlemeyi durdur' : 'Sesli komut'}
        >
          {listening ? <MicOff size={15} className="animate-pulse" /> : <Mic size={15} />}
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
          placeholder={listening ? 'Dinliyorum...' : pendingFiles.length > 0 ? `${pendingFiles.length} evrak hakkında soru yaz (boş bırakırsan AYLİN değerlendirir)...` : 'Ekibe talimat ver...'}
          disabled={sending}
          className="flex-1 px-4 py-2.5 rounded-xl text-[13px] outline-none"
          style={{
            background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : 'rgba(212,184,118,0.20)'}`,
            color: '#fafaf9',
          }}
        />
        <button
          onClick={submit}
          disabled={(!text.trim() && pendingFiles.length === 0) || sending}
          className="px-4 h-10 rounded-xl text-[13px] font-bold flex items-center gap-1.5 transition disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`,
            color: '#0f0d0b',
          }}
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {pendingFiles.length > 0 ? 'Değerlendir' : 'Gönder'}
        </button>
      </div>

      <style jsx>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
