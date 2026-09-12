'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, ShieldCheck, AlertTriangle, Square, FlaskConical, Zap, Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { RENK, SABLONLAR, ajanKisaltma, ajanRengi, ajanYuzeyRengi, avatarHalkaStili, kahramanKartStili, modelRengi, sablonDoldur } from './ortak';

const KOORDINATOR = 'koordinator';

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
 * TEK komut kutusu — yalnız Koordinatör (Muzaffer Bey: "komut vermek için tek yer").
 * Kahraman kart, renk = ajanYuzeyRengi('koordinator') (gök mavi), avatar halkası altın (kural §0.3).
 * Kaldırılan: ajan seçici, "bilgi" düğmesi. Kalan: metin ('/' odak), MukellefSecici, TÜM şablon hapları (Koordinatör yönlendirir),
 * Kuru/Canlı anahtarı (+kart içi 5 sn teyit), Sesli, Çalıştır. Kuru/Canlı ASLA depoya yazılmaz; her açılışta KURU.
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
  const renk = ajanYuzeyRengi(KOORDINATOR);
  const ikonRenk = ajanRengi(KOORDINATOR); // altın halka

  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [vakaId, setVakaId] = useState<string | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true); // her açılışta KURU — depoya yazılmaz
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [kilitli, setKilitli] = useState(false);
  const [aktifSablonId, setAktifSablonId] = useState<string | null>(null);
  const [mukellefOdak, setMukellefOdak] = useState(0);
  const [listening, setListening] = useState(false);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const calistirRef = useRef<HTMLButtonElement>(null);
  const kutuRef = useRef<HTMLElement | null>(null);

  const kosu = kosular.kosular.get(KOORDINATOR);
  const buCalisiyor = !!kosu && !kosu.bitti;
  const sabahOzetiSuruyor = buCalisiyor && kosu?.kaynak === 'sabahOzeti'; // SSE yok, kesilecek bağlantı yok
  const baskaCalisiyor = !!kosular.aktifKosu && kosular.aktifKosu.ajanId !== KOORDINATOR;

  const aktifSablon = SABLONLAR.find((s) => s.id === aktifSablonId);
  const mukellefEksik = !!aktifSablon?.mukellefIster && !taxpayerId;

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
    if (escNonce) setCanliTeyit(false);
  }, [escNonce]);

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

  const modRenk = dryRun ? renk : RENK.kirmizi;
  const modelR = ajan ? modelRengi(ajan.model) : RENK.gri;

  return (
    <section
      ref={(el) => {
        kutuRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className="relative min-w-0 overflow-hidden rounded-2xl transition-[box-shadow] duration-150"
      style={kahramanKartStili(renk, !dryRun)}
    >
      <div className="flex flex-col gap-4 p-5">
        {/* Üst satır: Koordinatör kimliği (sol) · mükellef (sağ) */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full p-[2px]" style={avatarHalkaStili(ikonRenk, false)}>
              <span className="flex h-full w-full items-center justify-center rounded-full text-[11px] font-black tracking-wide" style={{ background: 'linear-gradient(160deg, #1a1815, #0b0a08)', color: ikonRenk }}>
                {ajanKisaltma(KOORDINATOR, ajan?.ad)}
              </span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-[15px] font-bold leading-tight" style={{ color: RENK.metin }}>
                  {ajan?.ad || 'Koordinatör'}
                </span>
                {ajan?.model && (
                  <span className="rounded-full px-2 py-px text-[10px] font-bold leading-4" style={{ background: `${modelR}16`, border: `1px solid ${modelR}44`, color: modelR }}>
                    {ajan.model}
                  </span>
                )}
                {vakaId && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-semibold leading-4"
                    style={{ background: `${renk}18`, border: `1px solid ${renk}55`, color: renk }}
                    title={`Aynı iş dosyası zincirinde devam: ${vakaId}`}
                  >
                    <Link2 size={10} /> vaka #{vakaId.slice(0, 8)}
                    <button type="button" onClick={() => setVakaId(undefined)} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Bağı kaldır — yeni zincir aç">
                      <X size={10} />
                    </button>
                  </span>
                )}
              </div>
              <div className="truncate text-[11.5px]" style={{ color: RENK.ikincil }}>
                {ajan?.unvan || 'Ofis koordinatörü'} · işi doğru çalışana verir
              </div>
            </div>
          </div>

          <div className="w-full min-w-0 md:w-[300px] md:flex-shrink-0">
            <MukellefSecici
              mukellefler={mukellefler}
              value={taxpayerId}
              onChange={(id) => {
                setTaxpayerId(id);
                setKilitli(false);
                if (aktifSablon && id) setGorev(sablonDoldur(aktifSablon.gorev, mukellefAd(id), aktifSablon.donemIster ? seciliDonem : null));
              }}
              renk={renk}
              kilitli={kilitli}
              odakNonce={mukellefOdak}
              escNonce={escNonce}
            />
          </div>
        </div>

        {/* Orta: büyük metin */}
        <textarea
          ref={textareaRef}
          value={gorev}
          onChange={(e) => {
            setGorev(e.target.value);
            if (aktifSablonId) setAktifSablonId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              calistir();
            }
          }}
          rows={3}
          placeholder={listening ? 'Dinliyorum…' : 'Koordinatör’e görev yaz… (Enter çalıştırır, Shift+Enter yeni satır)'}
          className="min-h-[96px] w-full resize-y rounded-xl px-4 py-3 text-[13.5px] leading-relaxed outline-none transition-[border-color] duration-150"
          style={{
            background: 'rgba(0,0,0,0.32)',
            border: `1px solid ${listening ? `${RENK.kirmizi}66` : `${modRenk}3a`}`,
            color: RENK.metin,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          }}
        />

        {/* CANLI teyit / uyarı */}
        {canliTeyit && dryRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fecaca' }}>
            <span className="min-w-0 flex-1">
              <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir.
            </span>
            <button
              type="button"
              onClick={() => {
                setDryRun(false);
                setCanliTeyit(false);
              }}
              className="rounded-lg px-3 py-1.5 text-[12px] font-bold"
              style={{ background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }}
            >
              Evet, canlı
            </button>
            <button type="button" onClick={() => setCanliTeyit(false)} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: RENK.metin }}>
              Vazgeç
            </button>
          </div>
        )}
        {!dryRun && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fecaca' }}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              <b>Canlı koşu.</b> Mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sadece Muzaffer Bey’e aittir; dışarı gönderimler akışta "Onayınızı bekleyen" kutusuna düşer. Sayfa yenilenince kuru teste döner.
            </span>
          </div>
        )}

        {/* Alt satır: TÜM şablon çipleri (sol) · mod anahtarı + Sesli + Çalıştır (sağ) */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {SABLONLAR.map((s) => {
              const aktif = aktifSablonId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => sablonSec(s.id)}
                  className="rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px"
                  style={{
                    background: aktif ? `${renk}26` : `${renk}0e`,
                    border: `1px solid ${aktif ? `${renk}88` : `${renk}3a`}`,
                    color: aktif ? RENK.metin : 'rgba(250,250,249,0.85)',
                  }}
                  title={s.mukellefIster ? 'Bu görev mükellef ister · Koordinatör yönlendirir' : 'Metni doldurur, çalıştırmaz · Koordinatör yönlendirir'}
                >
                  {s.ad}
                </button>
              );
            })}
            {mukellefEksik && (
              <span className="text-[11px]" style={{ color: RENK.turuncu }}>
                Bu görev mükellef ister — seç.
              </span>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-1.5 md:items-end">
            <div className="flex flex-wrap items-center gap-2">
              {/* Segmentli mod anahtarı */}
              <div
                className="inline-flex flex-shrink-0 items-center rounded-full p-[3px]"
                style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${dryRun ? 'rgba(255,255,255,0.10)' : `${RENK.kirmizi}66`}` }}
                title="Kuru test: mükellefe mesaj gitmez, Luca'ya yazılmaz; yalnız 'yapacaktım' raporu"
              >
                <button
                  type="button"
                  onClick={() => {
                    setDryRun(true);
                    setCanliTeyit(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-bold transition-[background-color,color] duration-150"
                  style={dryRun ? { background: `linear-gradient(135deg, ${RENK.yesil}, ${RENK.yesil}bb)`, color: '#052e16' } : { background: 'transparent', color: RENK.ikincil }}
                  aria-pressed={dryRun}
                >
                  <FlaskConical size={11} /> Kuru test
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (dryRun) setCanliTeyit(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-bold transition-[background-color,color] duration-150"
                  style={!dryRun ? { background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' } : { background: 'transparent', color: RENK.ikincil }}
                  aria-pressed={!dryRun}
                >
                  <Zap size={11} /> Canlı
                </button>
              </div>

              <button
                type="button"
                onClick={toggleMic}
                disabled={buCalisiyor}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-[transform,background-color] duration-150 hover:-translate-y-px disabled:opacity-50"
                style={{
                  background: listening ? 'rgba(239,68,68,0.18)' : 'transparent',
                  border: `1px solid ${listening ? `${RENK.kirmizi}66` : 'rgba(255,255,255,0.14)'}`,
                  color: listening ? '#fca5a5' : RENK.metin,
                }}
                title={listening ? 'Dinlemeyi durdur' : 'Sesli görev — konuş, metne dönüşsün'}
              >
                {listening ? <MicOff size={13} className="animate-pulse" /> : <Mic size={13} />} {listening ? 'Dinliyor' : 'Sesli'}
              </button>

              {sabahOzetiSuruyor ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-bold opacity-70"
                  style={{ background: `${renk}14`, border: `1px solid ${renk}44`, color: renk }}
                  title="Sabah özeti sunucuda üretiliyor; bitince (en çok 150 sn) kilit açılır"
                >
                  <Loader2 size={14} className="animate-spin" /> Sabah özeti üretiliyor
                </button>
              ) : buCalisiyor ? (
                <button
                  type="button"
                  onClick={() => void kosular.durdur(KOORDINATOR)}
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-bold transition-[transform] duration-150 hover:-translate-y-px"
                  style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fca5a5' }}
                  title="Koşu sunucuda durdurulur; iş dosyası 'Hata: iptal edildi (Muzaffer Bey)' olarak kapanır"
                >
                  <Square size={14} /> Koordinatör çalışıyor: Durdur
                </button>
              ) : (
                <button
                  ref={calistirRef}
                  type="button"
                  onClick={calistir}
                  disabled={!calistirabilir}
                  className="inline-flex flex-shrink-0 items-center gap-2 rounded-full px-5 py-2 text-[13px] font-bold transition-[transform,filter,opacity] duration-150 hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:hover:translate-y-0"
                  style={
                    dryRun
                      ? { background: `linear-gradient(135deg, ${renk}, ${renk}99 70%, ${renk}66)`, color: '#0b1218', boxShadow: `0 8px 24px ${renk}33` }
                      : { background: 'linear-gradient(135deg,#f87171,#dc2626 70%,#991b1b)', color: '#fff', boxShadow: '0 8px 24px rgba(220,38,38,0.35)' }
                  }
                  title={baskaCalisiyor ? 'Tek Max hesabı + Luca tek oturum: aynı anda tek koşu' : dryRun ? 'Kuru test koşusu' : 'CANLI koşu'}
                >
                  {baskaCalisiyor ? <Loader2 size={14} className="animate-spin" /> : dryRun ? <Play size={14} /> : <AlertTriangle size={14} />}
                  {baskaCalisiyor ? 'Koşu sürüyor — bitince' : maxBagli === false ? 'Max bağlı değil' : dryRun ? 'Çalıştır' : 'Canlı çalıştır'}
                </button>
              )}
            </div>
            <div className="text-[10.5px] md:text-right" style={{ color: RENK.sonuk }}>
              {baskaCalisiyor ? (
                <span className="inline-flex items-center gap-1" style={{ color: RENK.ikincil }}>
                  <ShieldCheck size={10} /> Aynı anda tek koşu — bitince açılır
                </span>
              ) : (
                <>Kuru test: mesaj gitmez, Luca'ya yazılmaz · Enter çalıştırır · / odaklanır</>
              )}
            </div>
          </div>
        </div>

        {/* Tek satır ipucu */}
        <div className="text-[11.5px]" style={{ color: RENK.ikincil }}>
          Koordinatör işi doğru çalışana verir; ilerlemeyi aşağıdaki akıştan izlersiniz.
        </div>
      </div>
    </section>
  );
});
