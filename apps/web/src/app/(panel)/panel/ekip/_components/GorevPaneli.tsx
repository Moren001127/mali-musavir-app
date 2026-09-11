'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Loader2, Mic, MicOff, Wrench, X, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { ajanCalistirStream, getMukellefler, mukellefAdi, type Ajan, type AracCagrisi } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import { ajanRengi, ajanKisaltma, kartArkaPlan, sureKisa } from './ortak';

interface Kosu {
  gorev: string;
  cevap: string;
  araclar: string[];
  bitti: boolean;
  hata?: string;
  model?: string;
  durationMs?: number;
  isId?: string;
  dryRun: boolean;
}

/**
 * Seçili ajana görev verme paneli: metin + mükellef seçici + kuru test anahtarı
 * + akışlı cevap. Mikrofon (tarayıcı Web Speech) YALNIZ koordinatörde — sesli
 * muhatap odur (plan §3.1).
 */
export function GorevPaneli({
  ajan,
  onKapat,
  onIsBitti,
}: {
  ajan: Ajan;
  onKapat: () => void;
  onIsBitti?: () => void;
}) {
  const renk = ajanRengi(ajan.id);
  const sesli = ajan.id === 'koordinator';

  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [calisiyor, setCalisiyor] = useState(false);
  const [aktifArac, setAktifArac] = useState<string | null>(null);
  const [kosu, setKosu] = useState<Kosu | null>(null);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const cevapRef = useRef<HTMLDivElement>(null);

  const { data: mukellefler = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: getMukellefler,
    staleTime: 60_000,
  });

  // Ajan değişince paneli sıfırla
  useEffect(() => {
    setKosu(null);
    setAktifArac(null);
    setGorev('');
    try { abortRef.current?.abort(); } catch { /* yoksay */ }
    setCalisiyor(false);
  }, [ajan.id]);

  useEffect(() => {
    if (cevapRef.current) cevapRef.current.scrollTop = cevapRef.current.scrollHeight;
  }, [kosu?.cevap, aktifArac]);

  const calistir = async (metin?: string) => {
    const g = (metin ?? gorev).trim();
    if (!g || calisiyor) return;
    abortRef.current = new AbortController();
    setCalisiyor(true);
    setAktifArac(null);
    const araclar: string[] = [];
    let acc = '';
    setKosu({ gorev: g, cevap: '', araclar: [], bitti: false, dryRun });
    const patch = (fn: (k: Kosu) => Kosu) => setKosu((k) => (k ? fn(k) : k));

    try {
      await ajanCalistirStream(
        ajan.id,
        { gorev: g, taxpayerId: taxpayerId || undefined, dryRun },
        (e) => {
          if (e.type === 'text') {
            acc += e.delta;
            patch((k) => ({ ...k, cevap: acc }));
          } else if (e.type === 'tool') {
            if (e.name) {
              araclar.push(e.name);
              setAktifArac(e.name);
              patch((k) => ({ ...k, araclar: [...araclar] }));
            }
          } else if (e.type === 'kuruTest') {
            // Kuru testte çalıştırılmayan yazma/gönderme adımı — listede görünsün.
            araclar.push(`kuru test → ${e.name}`);
            setAktifArac(null);
            patch((k) => ({ ...k, araclar: [...araclar] }));
          } else if (e.type === 'onay') {
            araclar.push(`onay bekliyor → ${e.name}${e.previewId ? ` (${e.previewId})` : ''}`);
            patch((k) => ({ ...k, araclar: [...araclar] }));
          } else if (e.type === 'red') {
            araclar.push(`reddedildi → ${e.name}${e.neden ? `: ${e.neden}` : ''}`);
            patch((k) => ({ ...k, araclar: [...araclar] }));
          } else if (e.type === 'baslangic') {
            patch((k) => ({ ...k, isId: e.isId, model: e.model }));
          } else if (e.type === 'done') {
            patch((k) => ({
              ...k,
              model: e.model,
              durationMs: e.durationMs,
              isId: e.isId,
              araclar: k.araclar.length ? k.araclar : (e.toolUses || []).map((t: AracCagrisi) => t.name),
            }));
          } else if (e.type === 'error') {
            patch((k) => ({ ...k, hata: e.error || 'Yanıt alınamadı' }));
          }
        },
        abortRef.current.signal,
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') patch((k) => ({ ...k, hata: err?.message || String(err) }));
    } finally {
      setAktifArac(null);
      setCalisiyor(false);
      patch((k) => ({ ...k, bitti: true, cevap: k.cevap || (k.hata ? '' : '(boş yanıt)') }));
      onIsBitti?.();
    }
  };

  const durdur = () => {
    try { abortRef.current?.abort(); } catch { /* yoksay */ }
    setCalisiyor(false);
  };

  const toggleMic = () => {
    if (listening) {
      listenerRef.current?.stop();
      listenerRef.current = null;
      setListening(false);
      return;
    }
    if (!isSpeechSupported()) {
      toast.error('Sesli görev bu tarayıcıda desteklenmiyor', { description: 'Chrome veya Edge ile açıp mikrofon iznini verin.' });
      return;
    }
    setListening(true);
    const l = startListening({
      onResult: (t, isFinal) => {
        setGorev(t);
        if (isFinal && t.trim()) {
          listenerRef.current = null;
          setListening(false);
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

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl" style={kartArkaPlan(renk, true)}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${renk}, ${renk}55 55%, transparent)` }} />

      {/* Başlık */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
          style={{ background: `linear-gradient(135deg, ${renk}, ${renk}88)`, color: '#0f0d0b' }}
        >
          {ajanKisaltma(ajan.id, ajan.ad)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold" style={{ color: '#fafaf9' }}>Görev ver — {ajan.ad}</div>
          <div className="truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{ajan.unvan}</div>
        </div>
        <button
          onClick={onKapat}
          className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
          style={{ color: 'rgba(250,250,249,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
          title="Paneli kapat"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Görev metni */}
        <div className="flex gap-2">
          {sesli && (
            <button
              onClick={toggleMic}
              disabled={calisiyor}
              className="self-start rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
              style={{
                background: listening ? 'rgba(239,68,68,0.20)' : `${renk}14`,
                border: `1px solid ${listening ? 'rgba(239,68,68,0.45)' : `${renk}44`}`,
                color: listening ? '#fca5a5' : renk,
              }}
              title={listening ? 'Dinlemeyi durdur' : 'Sesli görev — konuş, metne dönüşsün'}
            >
              {listening ? <MicOff size={16} className="animate-pulse" /> : <Mic size={16} />}
            </button>
          )}
          <textarea
            value={gorev}
            onChange={(e) => setGorev(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                calistir();
              }
            }}
            rows={3}
            placeholder={listening ? 'Dinliyorum...' : `${ajan.ad} için görev yaz… (Enter ile çalıştır, Shift+Enter yeni satır)`}
            className="flex-1 resize-y rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : `${renk}3a`}`,
              color: '#fafaf9',
            }}
          />
        </div>

        {/* Mükellef + kuru test */}
        <div className="flex flex-col gap-2">
          <select
            value={taxpayerId}
            onChange={(e) => setTaxpayerId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${renk}3a`, color: taxpayerId ? '#fafaf9' : 'rgba(250,250,249,0.5)' }}
          >
            <option value="">Mükellef seçilmedi (ofis geneli)</option>
            {mukellefler.map((m) => (
              <option key={m.id} value={m.id}>
                {mukellefAdi(m)}
              </option>
            ))}
          </select>

          <button
            onClick={() => setDryRun((d) => !d)}
            className="flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors"
            style={
              dryRun
                ? { background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#86efac' }
                : { background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.45)', color: '#fca5a5' }
            }
            title="Kuru test: mükellefe mesaj gitmez, Luca'ya yazılmaz; yalnız 'yapacaktım' raporu"
          >
            <span
              className="relative inline-block h-4 w-8 rounded-full transition-colors"
              style={{ background: dryRun ? '#4ade80' : '#f87171' }}
            >
              <span
                className="absolute top-0.5 h-3 w-3 rounded-full bg-black/80 transition-all"
                style={{ left: dryRun ? 16 : 2 }}
              />
            </span>
            {dryRun ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
            Kuru test {dryRun ? 'AÇIK' : 'KAPALI'}
          </button>
        </div>

        {!dryRun && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fecaca' }}
          >
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              <b>CANLI koşu.</b> Mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sadece sahibe aittir; dışarı gönderimler onay kuyruğuna düşer.
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => calistir()}
            disabled={!gorev.trim() || calisiyor}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${renk}, ${renk}aa)`, color: '#0f0d0b' }}
          >
            {calisiyor ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {calisiyor ? 'Çalışıyor…' : 'Çalıştır'}
          </button>
          {calisiyor && (
            <button
              onClick={durdur}
              className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.32)', color: '#fca5a5' }}
            >
              ■ Durdur
            </button>
          )}
          {calisiyor && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: renk }}>
              <Loader2 size={12} className="animate-spin" />
              {aktifArac ? `${aktifArac} çalışıyor…` : 'Düşünüyor…'}
            </span>
          )}
        </div>

        {/* Cevap */}
        {kosu && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <span
                className="rounded-full px-2 py-0.5 font-bold"
                style={
                  kosu.dryRun
                    ? { background: 'rgba(74,222,128,0.12)', color: '#86efac' }
                    : { background: 'rgba(248,113,113,0.16)', color: '#fca5a5' }
                }
              >
                {kosu.dryRun ? 'KURU TEST' : 'CANLI'}
              </span>
              {kosu.model && <span>{kosu.model}</span>}
              {kosu.durationMs != null && <span>{sureKisa(kosu.durationMs)}</span>}
              {kosu.isId && <span>İş: {kosu.isId.slice(0, 8)}</span>}
              {kosu.bitti && !kosu.hata && (
                <span className="inline-flex items-center gap-1" style={{ color: '#86efac' }}>
                  <Check size={11} /> bitti
                </span>
              )}
            </div>

            {/* Araç adımları */}
            {kosu.araclar.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Wrench size={11} style={{ color: renk }} />
                {kosu.araclar.map((a, i) => (
                  <span
                    key={`${a}-${i}`}
                    className="rounded-md px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: aktifArac === a && calisiyor ? `${renk}2a` : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${aktifArac === a && calisiyor ? `${renk}66` : 'rgba(255,255,255,0.08)'}`,
                      color: 'rgba(250,250,249,0.8)',
                    }}
                  >
                    {i + 1}. {a}
                  </span>
                ))}
              </div>
            )}

            {kosu.hata && (
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}
              >
                ⚠️ {kosu.hata}
              </div>
            )}

            {kosu.cevap && (
              <div
                ref={cevapRef}
                className="max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed"
                style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${renk}22`, color: 'rgba(250,250,249,0.92)' }}
              >
                {kosu.cevap}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
