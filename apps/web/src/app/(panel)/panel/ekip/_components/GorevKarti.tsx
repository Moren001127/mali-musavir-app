'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, AlertTriangle, Square, Link2, X, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { Avatar, CARD_BORDER, Dugme, GOLD, KIRMIZI, Kbd, Kutu, MUTED, OK, Rozet, TEXT, ipucuStil, koyuAlan } from './Tema';
import { ajanKisaltma } from './ortak';

const KOORDINATOR = 'koordinator';

/** Şablon / pano / tekrar-çalıştır / cevapla bunu doldurur; ÇALIŞTIRMAZ. Hep Koordinatör'e gider (ajanId yok sayılır). */
export interface KomutTaslak {
  ajanId?: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: true;
  kaynak?: 'sablon' | 'pano' | 'tekrar' | 'cevap' | 'oneri';
  vakaId?: string;
  nonce: number;
}

/**
 * "Koordinatör'e görev ver" kutusu (Bütçe dili: altın şeritli Kutu).
 * Yazı alanı (içinde mikrofon) · mükellef seçici · Kuru test / Canlı · Çalıştır (altın; canlıda kırmızı).
 * Kuru/Canlı depoya yazılmaz; her açılışta KURU. Canlıya geçiş kart içi teyitle.
 */
export const GorevKarti = forwardRef<
  HTMLElement,
  {
    ajanlar: Ajan[];
    mukellefler: MukellefOzet[];
    komutTaslak: KomutTaslak | null;
    kosular: KosularApi;
    odakNonce: number;
    escNonce: number;
    maxBagli?: boolean;
    koordinatorNotu: string;
    className?: string;
  }
>(function GorevKarti({ ajanlar, mukellefler, komutTaslak, kosular, odakNonce, escNonce, maxBagli, koordinatorNotu, className = '' }, ref) {
  const ajan = ajanlar.find((a) => a.id === KOORDINATOR);
  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [vakaId, setVakaId] = useState<string | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [listening, setListening] = useState(false);
  const [odakta, setOdakta] = useState(false);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const calistirRef = useRef<HTMLButtonElement>(null);
  const kutuRef = useRef<HTMLElement | null>(null);

  const kosu = kosular.kosular.get(KOORDINATOR);
  const buCalisiyor = !!kosu && !kosu.bitti;
  const sabahOzetiSuruyor = buCalisiyor && kosu?.kaynak === 'sabahOzeti';
  const baskaCalisiyor = !!kosular.aktifKosu && kosular.aktifKosu.ajanId !== KOORDINATOR;

  useEffect(() => {
    if (!komutTaslak) return;
    setGorev(komutTaslak.gorev);
    setTaxpayerId(komutTaslak.taxpayerId || '');
    setVakaId(komutTaslak.vakaId || undefined);
    setDryRun(true);
    setCanliTeyit(false);
    kutuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => (komutTaslak.gorev ? calistirRef.current : textareaRef.current)?.focus(), 250);
  }, [komutTaslak?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (odakNonce) textareaRef.current?.focus();
  }, [odakNonce]);
  useEffect(() => {
    if (escNonce) setCanliTeyit(false);
  }, [escNonce]);
  useEffect(() => {
    if (!canliTeyit) return;
    const t = setTimeout(() => setCanliTeyit(false), 6000);
    return () => clearTimeout(t);
  }, [canliTeyit]);

  const calistirabilir = !!gorev.trim() && !buCalisiyor && !baskaCalisiyor && maxBagli !== false;
  const calistir = () => {
    if (!calistirabilir) return;
    void kosular.baslat(KOORDINATOR, { gorev: gorev.trim(), taxpayerId: taxpayerId || undefined, dryRun, vakaId });
    setVakaId(undefined);
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

  const kenar = listening ? `${KIRMIZI}99` : !dryRun ? `${KIRMIZI}73` : odakta ? `${GOLD}66` : CARD_BORDER;

  return (
    <Kutu
      baslik="Koordinatör’e görev ver"
      aciklama="Yazın ya da söyleyin; işi doğru uzmana o verir"
      renk={dryRun ? GOLD : KIRMIZI}
      sag={
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          {vakaId && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${MUTED}1f`, border: `1px solid ${MUTED}44`, color: TEXT }} title={`Aynı iş zincirinde devam: ${vakaId}`}>
              <Link2 size={10} /> iş zinciri
              <button type="button" onClick={() => setVakaId(undefined)} className="rounded p-px hover:bg-white/10" title="Bağı kaldır — yeni zincir aç">
                <X size={10} />
              </button>
            </span>
          )}
          {dryRun ? <Rozet metin="Kuru test" renk={OK} /> : <Rozet metin="Canlı — gerçek işlem" renk={KIRMIZI} />}
        </span>
      }
      style={{ scrollMarginTop: 16 }}
      className={className}
    >
      <div
        ref={(el) => {
          kutuRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
      >
        {/* Yazı alanı */}
        <div className="relative rounded-xl transition-[border-color,box-shadow]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${kenar}`, boxShadow: odakta ? `0 0 0 3px ${GOLD}14` : 'none' }}>
          <textarea
            ref={textareaRef}
            value={gorev}
            onChange={(e) => setGorev(e.target.value)}
            onFocus={() => setOdakta(true)}
            onBlur={() => setOdakta(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                calistir();
              }
            }}
            rows={7}
            placeholder={listening ? 'Dinliyorum…' : 'Örn: Ömer Özen’in Ağustos 2026 KDV kontrolünü yap · Zeyrek Lojistik’in Ağustos faturalarını işle · Öz Ela’nın son tebligatları ne?'}
            className="min-h-[190px] w-full resize-y bg-transparent px-4 py-3.5 pr-24 text-[14px] leading-relaxed outline-none"
            style={{ color: TEXT }}
          />
          <button
            type="button"
            onClick={toggleMic}
            disabled={buCalisiyor}
            title={listening ? 'Dinlemeyi durdur' : 'Sesli söyle — konuş, metne dönüşsün'}
            className={`absolute right-2.5 top-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition hover:brightness-125 disabled:opacity-40 ${listening ? 'animate-pulse' : ''}`}
            style={listening ? { background: `${KIRMIZI}1f`, border: `1px solid ${KIRMIZI}66`, color: KIRMIZI } : { background: 'rgba(255,255,255,0.04)', border: `1px solid ${CARD_BORDER}`, color: MUTED }}
          >
            {listening ? <MicOff size={13} /> : <Mic size={13} />} {listening ? 'Dinliyor' : 'Sesli'}
          </button>
        </div>

        {/* Alt satır: mükellef · mod · çalıştır */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-xl px-3 text-[12.5px]" style={koyuAlan}>
            <Users size={13} style={{ color: MUTED }} />
            <span className="min-w-0 flex-1">
              <MukellefSecici sade yerTutucu="Mükellef seçin (boş = ofis geneli)" mukellefler={mukellefler} value={taxpayerId} onChange={setTaxpayerId} renk={GOLD} escNonce={escNonce} />
            </span>
          </span>
          <span className="inline-flex h-9 overflow-hidden rounded-xl" style={koyuAlan} role="radiogroup" aria-label="Çalışma modu">
            {(
              [
                ['kuru', 'Kuru test', 'Mükellefe mesaj gitmez, Luca’ya yazılmaz; yalnız "yapacaktım" raporu'],
                ['canli', 'Canlı', 'Gerçek işlem — dışarı gönderimler yine onayınıza düşer'],
              ] as const
            ).map(([id, ad, title]) => {
              const aktif = dryRun ? id === 'kuru' : id === 'canli';
              const renk = id === 'canli' ? KIRMIZI : GOLD;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={aktif}
                  title={title}
                  onClick={() => {
                    if (id === 'kuru') {
                      setDryRun(true);
                      setCanliTeyit(false);
                    } else if (dryRun) setCanliTeyit(true);
                  }}
                  className="px-3 text-[12px] font-medium transition"
                  style={aktif ? { background: `${renk}1f`, color: renk, boxShadow: `inset 0 0 0 1px ${renk}4d` } : { color: MUTED }}
                >
                  {ad}
                </button>
              );
            })}
          </span>
          {sabahOzetiSuruyor ? (
            <Dugme disabled>
              <Loader2 size={13} className="animate-spin" /> Sabah özeti üretiliyor
            </Dugme>
          ) : buCalisiyor ? (
            <Dugme tur="tehlike" onClick={() => void kosular.durdur(KOORDINATOR)}>
              <Square size={12} /> Durdur
            </Dugme>
          ) : (
            <button
              ref={calistirRef}
              type="button"
              onClick={calistir}
              disabled={!calistirabilir}
              title={baskaCalisiyor ? 'Aynı anda tek koşu' : dryRun ? 'Kuru test koşusu (Enter)' : 'CANLI koşu'}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12.5px] font-semibold transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: `linear-gradient(140deg, ${dryRun ? GOLD : KIRMIZI}dd, ${dryRun ? GOLD : KIRMIZI}99)`, border: `1px solid ${dryRun ? GOLD : KIRMIZI}`, color: '#0b0b0d' }}
            >
              {baskaCalisiyor ? <Loader2 size={13} className="animate-spin" /> : dryRun ? <Play size={13} /> : <AlertTriangle size={13} />}
              {baskaCalisiyor ? 'Koşu sürüyor' : maxBagli === false ? 'Max bağlı değil' : dryRun ? 'Çalıştır' : 'Canlı çalıştır'}
            </button>
          )}
        </div>

        {canliTeyit && dryRun && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}66`, color: TEXT }}>
            <AlertTriangle size={14} style={{ color: KIRMIZI }} />
            <span className="min-w-0 flex-1">
              <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sizde kalır.
            </span>
            <Dugme tur="tehlike" onClick={() => { setDryRun(false); setCanliTeyit(false); }}>
              Evet, canlı
            </Dugme>
            <Dugme onClick={() => setCanliTeyit(false)}>Vazgeç</Dugme>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" style={ipucuStil}>
          <span>{dryRun ? 'Kuru test: mükellefe mesaj gitmez, Luca’ya yazılmaz; yapılacaklar raporlanır' : 'Canlı: dışarı giden her mesaj yine onayınıza düşer · sayfa yenilenince kuru teste döner'}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> çalıştırır · <Kbd>⇧ Enter</Kbd> yeni satır · <Kbd>/</Kbd> kutuya odak</span>
        </div>

        {/* Koordinatör'ün tek cümlelik notu */}
        <div className="mt-3 flex items-center gap-2.5 text-[12px]" style={{ color: MUTED }}>
          <Avatar kisaltma={ajanKisaltma(KOORDINATOR, ajan?.ad)} ton="gold" boyut={24} nabiz={buCalisiyor} />
          <span className="min-w-0">
            <b className="font-medium" style={{ color: TEXT }}>
              {ajan?.ad || 'Koordinatör'}:
            </b>{' '}
            {koordinatorNotu}
          </span>
        </div>
      </div>
    </Kutu>
  );
});
