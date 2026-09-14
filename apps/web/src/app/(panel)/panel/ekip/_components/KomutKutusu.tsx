'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, AlertTriangle, Square, Link2, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { SABLONLAR, SAKIN, SIK_SABLON_IDLERI, ajanKisaltma, sablonDoldur, sakinAlan, sakinAvatar, sakinDugme, type SablonGrubu } from './ortak';

const KOORDINATOR = 'koordinator';
const GRUP_SIRASI: SablonGrubu[] = ['Günlük', 'Fatura', 'Beyanname ve KDV', 'Denetim ve analiz', 'Diğer'];

/** Şablon / pano / tekrar-çalıştır / cevapla bunu doldurur; ÇALIŞTIRMAZ. Hep Koordinatör'e gider (ajanId yok sayılır). */
export interface KomutTaslak {
  /** Geriye uyumluluk (DonemPanosu sonrakiAdim ajanId verir) — kullanılmaz; komut Koordinatör'e gider. */
  ajanId?: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: true;
  kaynak?: 'sablon' | 'pano' | 'tekrar' | 'cevap';
  /** Aynı iş dosyası zincirinde devam (Cevapla / Tekrar). */
  vakaId?: string;
  /** Aynı içerik ikinci kez gelince de uygulansın diye. */
  nonce: number;
}

/**
 * TEK görev kutusu — yalnız Koordinatör. SAKİN (PLAN/19 §A.3-3):
 * düz kart + üstte 1px çelik mavi çizgi; 2 satır metin; altında tek satır: mükellef seçici · 5 sık şablon düz bağlantı + "Diğer ▾" (gruplu liste) ·
 * Kuru test | Canlı (nötr anahtar; canlıda kırmızı kelime + teyit) · Sesli · Çalıştır. "sonnet" rozeti ve açıklama satırları KALKTI.
 * Mantık aynen: Enter çalıştırır, '/' odak, Esc teyit/listeyi kapatır, Kuru/Canlı depoya yazılmaz (her açılışta KURU).
 */
export const KomutKutusu = forwardRef<
  HTMLElement,
  {
    ajanlar: Ajan[];
    mukellefler: MukellefOzet[];
    mukellefAd: (id?: string | null) => string | undefined;
    seciliDonem: string | null;
    komutTaslak: KomutTaslak | null;
    kosular: KosularApi;
    odakNonce: number;
    escNonce: number;
    maxBagli?: boolean;
  }
>(function KomutKutusu({ ajanlar, mukellefler, mukellefAd, seciliDonem, komutTaslak, kosular, odakNonce, escNonce, maxBagli }, ref) {
  const ajan = ajanlar.find((a) => a.id === KOORDINATOR);

  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [vakaId, setVakaId] = useState<string | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true); // her açılışta KURU — depoya yazılmaz
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [kilitli, setKilitli] = useState(false);
  const [aktifSablonId, setAktifSablonId] = useState<string | null>(null);
  const [mukellefOdak, setMukellefOdak] = useState(0);
  const [listening, setListening] = useState(false);
  const [digerAcik, setDigerAcik] = useState(false);
  const [odakta, setOdakta] = useState(false);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const calistirRef = useRef<HTMLButtonElement>(null);
  const kutuRef = useRef<HTMLElement | null>(null);
  const digerRef = useRef<HTMLDivElement>(null);

  const kosu = kosular.kosular.get(KOORDINATOR);
  const buCalisiyor = !!kosu && !kosu.bitti;
  const sabahOzetiSuruyor = buCalisiyor && kosu?.kaynak === 'sabahOzeti'; // SSE yok, kesilecek bağlantı yok
  const baskaCalisiyor = !!kosular.aktifKosu && kosular.aktifKosu.ajanId !== KOORDINATOR;

  const aktifSablon = SABLONLAR.find((s) => s.id === aktifSablonId);
  const mukellefEksik = !!aktifSablon?.mukellefIster && !taxpayerId;

  const sikSablonlar = useMemo(() => SIK_SABLON_IDLERI.map((id) => SABLONLAR.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s), []);
  const digerGruplar = useMemo(() => {
    const sik = new Set<string>(SIK_SABLON_IDLERI);
    return GRUP_SIRASI.map((grup) => ({ grup, sablonlar: SABLONLAR.filter((s) => s.grup === grup && !sik.has(s.id)) })).filter((g) => g.sablonlar.length);
  }, []);

  // Dış doldurma: komutTaslak değişince metin/mükellef/vaka dolar + kaydır + Çalıştır'a odak
  useEffect(() => {
    if (!komutTaslak) return;
    setGorev(komutTaslak.gorev);
    setTaxpayerId(komutTaslak.taxpayerId || '');
    setVakaId(komutTaslak.vakaId || undefined);
    setKilitli(komutTaslak.kaynak === 'pano' || komutTaslak.kaynak === 'tekrar');
    setAktifSablonId(null);
    setDryRun(true);
    setCanliTeyit(false);
    kutuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => calistirRef.current?.focus(), 250);
  }, [komutTaslak?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (odakNonce) textareaRef.current?.focus();
  }, [odakNonce]);

  useEffect(() => {
    if (escNonce) {
      setCanliTeyit(false);
      setDigerAcik(false);
    }
  }, [escNonce]);

  // "Diğer ▾" listesi dışına tıklayınca kapanır
  useEffect(() => {
    if (!digerAcik) return;
    const dinle = (e: MouseEvent) => {
      if (digerRef.current && !digerRef.current.contains(e.target as Node)) setDigerAcik(false);
    };
    document.addEventListener('mousedown', dinle);
    return () => document.removeEventListener('mousedown', dinle);
  }, [digerAcik]);

  // CANLI teyiti 5 sn'de kendiliğinden kapanır
  useEffect(() => {
    if (!canliTeyit) return;
    const t = setTimeout(() => setCanliTeyit(false), 5000);
    return () => clearTimeout(t);
  }, [canliTeyit]);

  const calistirabilir = !!gorev.trim() && !buCalisiyor && !baskaCalisiyor && !mukellefEksik && maxBagli !== false;

  const calistir = () => {
    if (!calistirabilir) return;
    void kosular.baslat(KOORDINATOR, { gorev: gorev.trim(), taxpayerId: taxpayerId || undefined, dryRun, vakaId });
    // Koşu başladı: vaka bağı tek seferlik (bir sonraki komut yeni zincir açar)
    setVakaId(undefined);
  };

  const sablonSec = (id: string) => {
    const s = SABLONLAR.find((x) => x.id === id);
    if (!s) return;
    setAktifSablonId(id);
    setGorev(sablonDoldur(s.gorev, mukellefAd(taxpayerId), s.donemIster ? seciliDonem : null));
    setKilitli(false);
    setVakaId(undefined);
    setDigerAcik(false);
    if (s.mukellefIster && !taxpayerId) setMukellefOdak((n) => n + 1);
    else textareaRef.current?.focus();
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

  const ustCizgi = !dryRun ? SAKIN.kirmizi : SAKIN.vurgu;
  const alanKenar = listening ? `${SAKIN.kirmizi}88` : odakta ? SAKIN.vurgu : !dryRun ? `${SAKIN.kirmizi}66` : SAKIN.cizgi;

  const sablonBaglanti = (s: { id: string; ad: string; mukellefIster: boolean }) => {
    const aktif = aktifSablonId === s.id;
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => sablonSec(s.id)}
        className="whitespace-nowrap rounded px-1 py-0.5 text-[12px] transition-colors duration-150"
        style={{ color: aktif ? SAKIN.vurguAcik : SAKIN.ikincil, background: aktif ? `${SAKIN.vurgu}1a` : 'transparent' }}
        title={s.mukellefIster ? 'Bu görev mükellef ister · metni doldurur, çalıştırmaz' : 'Metni doldurur, çalıştırmaz'}
      >
        {s.ad}
      </button>
    );
  };

  return (
    <section
      ref={(el) => {
        kutuRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className="relative min-w-0 overflow-hidden rounded-xl"
      style={{ background: SAKIN.zemin, border: `1px solid ${!dryRun ? `${SAKIN.kirmizi}66` : SAKIN.kilcal}` }}
    >
      <div className="h-px w-full" style={{ background: ustCizgi }} />
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* Üst satır: kimlik (sol) · vaka bağı */}
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tracking-wide" style={sakinAvatar(buCalisiyor ? 'calisiyor' : 'bos')}>
            {ajanKisaltma(KOORDINATOR, ajan?.ad)}
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-tight" style={{ color: SAKIN.metin }}>
              Koordinatör’e görev ver
            </div>
            <div className="truncate text-[11.5px]" style={{ color: SAKIN.ikincil }}>
              {ajan?.unvan || 'Ofis müdürü'} · işi doğru çalışana verir, ilerlemeyi aşağıdaki akıştan izlersiniz
            </div>
          </div>
          {vakaId && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold leading-4" style={{ border: `1px solid ${SAKIN.vurgu}66`, color: SAKIN.vurguAcik }} title={`Aynı iş dosyası zincirinde devam: ${vakaId}`}>
              <Link2 size={10} /> vaka #{vakaId.slice(0, 8)}
              <button type="button" onClick={() => setVakaId(undefined)} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Bağı kaldır — yeni zincir aç">
                <X size={10} />
              </button>
            </span>
          )}
        </div>

        {/* Metin */}
        <textarea
          ref={textareaRef}
          value={gorev}
          onChange={(e) => {
            setGorev(e.target.value);
            if (aktifSablonId) setAktifSablonId(null);
          }}
          onFocus={() => setOdakta(true)}
          onBlur={() => setOdakta(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              calistir();
            }
          }}
          rows={2}
          placeholder={listening ? 'Dinliyorum…' : 'Görevi yazın… (Enter çalıştırır, Shift+Enter yeni satır, / odaklanır)'}
          className="min-h-[72px] w-full resize-y rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none transition-[border-color,box-shadow] duration-150"
          style={{ ...sakinAlan(), border: `1px solid ${alanKenar}`, boxShadow: odakta ? `0 0 0 3px ${SAKIN.vurgu}2e` : 'none' }}
        />

        {/* CANLI teyit / uyarı */}
        {canliTeyit && dryRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}88`, color: SAKIN.metin }}>
            <span className="min-w-0 flex-1">
              <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir.
            </span>
            <button
              type="button"
              onClick={() => {
                setDryRun(false);
                setCanliTeyit(false);
              }}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: SAKIN.kirmizi, color: '#fff' }}
            >
              Evet, canlı
            </button>
            <button type="button" onClick={() => setCanliTeyit(false)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={sakinDugme('ikincil')}>
              Vazgeç
            </button>
          </div>
        )}
        {!dryRun && (
          <div className="flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}66`, color: SAKIN.metin }}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: SAKIN.kirmiziAcik }} />
            <span>
              <b>Canlı koşu.</b> Mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sadece Muzaffer Bey’e aittir; dışarı gönderimler akışta "Onayınızı bekleyen" kutusuna düşer. Sayfa yenilenince kuru teste döner.
            </span>
          </div>
        )}

        {/* Alt satır: mükellef · sık şablonlar + Diğer (sol) · mod + Sesli + Çalıştır (sağ) */}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
            <div className="w-full min-w-0 sm:w-[240px] sm:flex-shrink-0">
              <MukellefSecici
                mukellefler={mukellefler}
                value={taxpayerId}
                onChange={(id) => {
                  setTaxpayerId(id);
                  setKilitli(false);
                  if (aktifSablon && id) setGorev(sablonDoldur(aktifSablon.gorev, mukellefAd(id), aktifSablon.donemIster ? seciliDonem : null));
                }}
                renk={SAKIN.vurgu}
                kilitli={kilitli}
                odakNonce={mukellefOdak}
                escNonce={escNonce}
              />
            </div>
            <span className="hidden h-3 w-px sm:mx-1 sm:inline-block" style={{ background: SAKIN.cizgi }} />
            {sikSablonlar.map(sablonBaglanti)}
            <div ref={digerRef} className="relative">
              <button
                type="button"
                onClick={() => setDigerAcik((a) => !a)}
                aria-expanded={digerAcik}
                className="inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[12px]"
                style={{ color: digerAcik ? SAKIN.metin : SAKIN.ikincil }}
                title="Diğer hazır görevler"
              >
                Diğer <ChevronDown size={12} className="transition-transform" style={{ transform: digerAcik ? 'rotate(180deg)' : 'none' }} />
              </button>
              {digerAcik && (
                <div className="absolute left-0 top-full z-20 mt-1 w-[260px] rounded-lg p-1.5" style={{ background: '#121317', border: `1px solid ${SAKIN.cizgiKoyu}`, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
                  {digerGruplar.map((g) => (
                    <div key={g.grup} className="py-1">
                      <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: SAKIN.soluk }}>
                        {g.grup}
                      </div>
                      {g.sablonlar.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => sablonSec(s.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.06]"
                          style={{ color: SAKIN.metin }}
                          title={s.mukellefIster ? 'Mükellef ister' : undefined}
                        >
                          <span className="truncate">{s.ad}</span>
                          {s.mukellefIster && (
                            <span className="flex-shrink-0 text-[10px]" style={{ color: SAKIN.soluk }}>
                              mükellef
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {mukellefEksik && (
              <span className="text-[11px]" style={{ color: SAKIN.kehribar }}>
                Bu görev mükellef ister — seçin.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-shrink-0">
            {/* Mod anahtarı — nötr; canlıda kırmızı kelime */}
            <div className="inline-flex flex-shrink-0 items-center rounded-md p-[2px]" style={{ background: SAKIN.alan, border: `1px solid ${dryRun ? SAKIN.cizgi : `${SAKIN.kirmizi}66`}` }} title="Kuru test: mükellefe mesaj gitmez, Luca'ya yazılmaz; yalnız 'yapacaktım' raporu">
              <button
                type="button"
                onClick={() => {
                  setDryRun(true);
                  setCanliTeyit(false);
                }}
                className="rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150"
                style={dryRun ? { background: SAKIN.zeminAcik, color: SAKIN.metin } : { background: 'transparent', color: SAKIN.ikincil }}
                aria-pressed={dryRun}
              >
                Kuru test
              </button>
              <button
                type="button"
                onClick={() => {
                  if (dryRun) setCanliTeyit(true);
                }}
                className="rounded px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150"
                style={!dryRun ? { background: 'rgba(214,69,69,0.16)', color: SAKIN.kirmiziAcik } : { background: 'transparent', color: SAKIN.ikincil }}
                aria-pressed={!dryRun}
              >
                Canlı
              </button>
            </div>

            <button
              type="button"
              onClick={toggleMic}
              disabled={buCalisiyor}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold transition-[border-color] duration-150 disabled:opacity-50"
              style={listening ? sakinDugme('tehlike') : sakinDugme('ikincil')}
              title={listening ? 'Dinlemeyi durdur' : 'Sesli görev — konuş, metne dönüşsün'}
            >
              {listening ? <MicOff size={13} className="animate-pulse" /> : <Mic size={13} />} {listening ? 'Dinliyor' : 'Sesli'}
            </button>

            {sabahOzetiSuruyor ? (
              <button type="button" disabled className="inline-flex flex-shrink-0 items-center gap-2 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold opacity-70" style={sakinDugme('ikincil')} title="Sabah özeti sunucuda üretiliyor; bitince (en çok 150 sn) kilit açılır">
                <Loader2 size={14} className="animate-spin" /> Sabah özeti üretiliyor
              </button>
            ) : buCalisiyor ? (
              <button
                type="button"
                onClick={() => void kosular.durdur(KOORDINATOR)}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold"
                style={sakinDugme('tehlike')}
                title="Koşu sunucuda durdurulur; iş dosyası 'Hata: iptal edildi (Muzaffer Bey)' olarak kapanır"
              >
                <Square size={13} /> Çalışıyor — Durdur
              </button>
            ) : (
              <button
                ref={calistirRef}
                type="button"
                onClick={calistir}
                disabled={!calistirabilir}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-md px-4 py-1.5 text-[12.5px] font-semibold transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                style={dryRun ? sakinDugme('birincil') : { background: SAKIN.kirmizi, border: `1px solid ${SAKIN.kirmizi}`, color: '#fff' }}
                title={baskaCalisiyor ? 'Tek Max hesabı + Luca tek oturum: aynı anda tek koşu' : dryRun ? 'Kuru test koşusu' : 'CANLI koşu'}
              >
                {baskaCalisiyor ? <Loader2 size={14} className="animate-spin" /> : dryRun ? <Play size={14} /> : <AlertTriangle size={14} />}
                {baskaCalisiyor ? 'Koşu sürüyor — bitince' : maxBagli === false ? 'Max bağlı değil' : dryRun ? 'Çalıştır' : 'Canlı çalıştır'}
              </button>
            )}
          </div>
        </div>

        <div className="text-[11px]" style={{ color: SAKIN.soluk }}>
          {baskaCalisiyor ? 'Aynı anda tek koşu — bitince açılır.' : 'Kuru test: mesaj gitmez, Luca’ya yazılmaz. Hazır görev bağlantıları metni doldurur, çalıştırmaz.'}
        </div>
      </div>
    </section>
  );
});
