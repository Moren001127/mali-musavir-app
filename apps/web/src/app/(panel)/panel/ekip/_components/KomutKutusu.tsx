'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, ShieldCheck, AlertTriangle, Unplug, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { RENK, SABLONLAR, ajanKisaltma, ajanRengi, ajanYuzeyRengi, ikonStili, kartArkaPlan, sablonDoldur, seritStili } from './ortak';

/** Şablon / pano / tekrar-çalıştır / cevapla bunu doldurur; ÇALIŞTIRMAZ. */
export interface KomutTaslak {
  ajanId: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: true;
  kaynak?: 'sablon' | 'pano' | 'tekrar' | 'cevap';
  /** Aynı içerik ikinci kez gelince de uygulansın diye. */
  nonce: number;
}

/**
 * Her zaman açık görev kutusu: ajan çipi · mükellef seçici · KURU/CANLI · hazır görev çipleri · metin · Çalıştır.
 * Kuru/Canlı ASLA localStorage'a yazılmaz; her açılışta KURU. Mikrofon yalnız koordinatörde (voice.ts).
 */
export const KomutKutusu = forwardRef<
  HTMLElement,
  {
    ajanlar: Ajan[];
    seciliAjanId: string;
    onAjanSec: (id: string) => void;
    mukellefler: MukellefOzet[];
    mukellefAd: (id?: string | null) => string | undefined;
    seciliDonem: string | null;
    komutTaslak: KomutTaslak | null;
    kosular: KosularApi;
    odakNonce: number;
    escNonce: number;
    maxBagli?: boolean;
  }
>(function KomutKutusu({ ajanlar, seciliAjanId, onAjanSec, mukellefler, mukellefAd, seciliDonem, komutTaslak, kosular, odakNonce, escNonce, maxBagli }, ref) {
  const ajan = ajanlar.find((a) => a.id === seciliAjanId);
  // Büyük yüzeyler (kart, şerit, çipler, Çalıştır gradyanı) → ajanYuzeyRengi (§0.3/§0.6/§8); yalnız 24px ikon ajanRengi.
  const renk = ajanYuzeyRengi(seciliAjanId);
  const ikonRenk = ajanRengi(seciliAjanId);
  const sesli = seciliAjanId === 'koordinator';

  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
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

  const kosu = kosular.kosular.get(seciliAjanId);
  const buCalisiyor = !!kosu && !kosu.bitti;
  const sabahOzetiSuruyor = buCalisiyor && kosu?.kaynak === 'sabahOzeti'; // SSE yok, kesilecek bağlantı yok
  const baskaCalisiyor = !!kosular.aktifKosu && kosular.aktifKosu.ajanId !== seciliAjanId;
  const baskaAjan = baskaCalisiyor ? ajanlar.find((a) => a.id === kosular.aktifKosu!.ajanId) : undefined;

  const sablonlar = useMemo(() => SABLONLAR.filter((s) => s.ajanId === seciliAjanId), [seciliAjanId]);
  const aktifSablon = sablonlar.find((s) => s.id === aktifSablonId);
  const mukellefEksik = !!aktifSablon?.mukellefIster && !taxpayerId;

  // Dış doldurma: komutTaslak değişince ajan/metin/mükellef dolar + kaydır + Çalıştır'a odak
  useEffect(() => {
    if (!komutTaslak) return;
    if (komutTaslak.ajanId !== seciliAjanId) onAjanSec(komutTaslak.ajanId);
    setGorev(komutTaslak.gorev);
    setTaxpayerId(komutTaslak.taxpayerId || '');
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
    kosular.baslat(seciliAjanId, { gorev: gorev.trim(), taxpayerId: taxpayerId || undefined, dryRun });
  };

  const sablonSec = (id: string) => {
    const s = sablonlar.find((x) => x.id === id);
    if (!s) return;
    setAktifSablonId(id);
    setGorev(sablonDoldur(s.gorev, mukellefAd(taxpayerId), s.donemIster ? seciliDonem : null));
    setKilitli(false);
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

  const kenar = dryRun ? kartArkaPlan(renk, true) : { ...kartArkaPlan(renk, true), border: `1px solid ${RENK.kirmizi}` };

  return (
    <section
      ref={(el) => {
        kutuRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className="relative min-w-0 overflow-hidden rounded-2xl"
      style={kenar}
    >
      <div className="h-1 w-full" style={seritStili(dryRun ? renk : RENK.kirmizi)} />

      <div className="flex flex-col gap-2.5 p-3">
        {/* Satır 1: ajan çipi · mükellef · KURU/CANLI */}
        <div className="flex flex-wrap items-start gap-2">
          <label className="relative inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: `${renk}14`, border: `1px solid ${renk}55` }}>
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-black" style={ikonStili(ikonRenk)}>
              {ajanKisaltma(seciliAjanId, ajan?.ad)}
            </span>
            <select
              value={seciliAjanId}
              onChange={(e) => {
                onAjanSec(e.target.value);
                setAktifSablonId(null);
              }}
              className="max-w-[160px] appearance-none truncate bg-transparent pr-4 text-xs font-bold outline-none"
              style={{ color: RENK.metin }}
              title="Ajan seç"
            >
              {(ajanlar.length ? ajanlar : [{ id: seciliAjanId, ad: seciliAjanId } as Ajan]).map((a) => (
                <option key={a.id} value={a.id} style={{ color: '#000' }}>
                  {ajanKisaltma(a.id, a.ad)} · {a.ad}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2" style={{ color: RENK.ikincil }} />
          </label>

          <div className="min-w-[180px] flex-1">
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

          <button
            type="button"
            onClick={() => {
              if (dryRun) setCanliTeyit(true);
              else setDryRun(true);
            }}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
            style={
              dryRun
                ? { background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#86efac' }
                : { background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.45)', color: '#fca5a5' }
            }
            title="Kuru test: mükellefe mesaj gitmez, Luca'ya yazılmaz; yalnız 'yapacaktım' raporu"
          >
            <span className="relative inline-block h-4 w-8 rounded-full" style={{ background: dryRun ? RENK.yesil : RENK.kirmizi }}>
              <span className="absolute top-0.5 h-3 w-3 rounded-full bg-black/80 transition-all" style={{ left: dryRun ? 16 : 2 }} />
            </span>
            {dryRun ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
            {dryRun ? 'KURU' : 'CANLI'}
          </button>
        </div>

        {canliTeyit && dryRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fecaca' }}>
            <span className="min-w-0 flex-1">
              <b>CANLI moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir.
            </span>
            <button
              type="button"
              onClick={() => {
                setDryRun(false);
                setCanliTeyit(false);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }}
            >
              Evet, CANLI
            </button>
            <button type="button" onClick={() => setCanliTeyit(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: RENK.metin }}>
              Vazgeç
            </button>
          </div>
        )}

        {!dryRun && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fecaca' }}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              <b>CANLI koşu.</b> Mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sadece sahibe aittir; dışarı gönderimler onay kuyruğuna düşer. Sayfa yenilenince KURU’ya döner.
            </span>
          </div>
        )}

        {/* Satır 2: hazır görev çipleri */}
        {sablonlar.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {sablonlar.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => sablonSec(s.id)}
                className="rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: aktifSablonId === s.id ? `${renk}2a` : `${renk}14`,
                  border: `1px solid ${aktifSablonId === s.id ? `${renk}88` : `${renk}33`}`,
                  color: RENK.metin,
                }}
                title={s.mukellefIster ? 'Bu görev mükellef ister' : 'Metni doldurur, çalıştırmaz'}
              >
                {s.ad}
              </button>
            ))}
          </div>
        )}

        {/* Satır 3: metin + Çalıştır + mikrofon */}
        <div className="flex items-start gap-2">
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
            rows={2}
            placeholder={listening ? 'Dinliyorum…' : `${ajan?.ad || 'Ajan'} için görev yaz… (Enter çalıştırır, Shift+Enter yeni satır)`}
            className="min-w-0 flex-1 resize-y rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${listening ? 'rgba(239,68,68,0.35)' : `${renk}3a`}`, color: RENK.metin }}
          />
          <div className="flex flex-shrink-0 flex-col gap-1.5">
            {sabahOzetiSuruyor ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold opacity-70"
                style={{ background: `${renk}14`, border: `1px solid ${renk}44`, color: renk }}
                title="Sabah özeti sunucuda üretiliyor; bitince (en çok 150 sn) kilit açılır"
              >
                <Loader2 size={13} className="animate-spin" /> Sabah özeti üretiliyor
              </button>
            ) : buCalisiyor ? (
              <button
                type="button"
                onClick={() => kosular.baglantiyiKes(seciliAjanId)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}`, color: '#fca5a5' }}
                title="Yalnız bağlantı kesilir; ajan sunucuda sürer, sonucu İş Dosyaları'nda görürsün"
              >
                <Unplug size={13} /> Bağlantıyı kes
              </button>
            ) : (
              <button
                ref={calistirRef}
                type="button"
                onClick={calistir}
                disabled={!calistirabilir}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-opacity disabled:opacity-50"
                style={
                  dryRun
                    ? { background: `linear-gradient(135deg, ${renk}, ${renk}aa)`, color: '#0f0d0b' }
                    : { background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }
                }
                title={baskaCalisiyor ? 'Tek Max hesabı + Luca tek oturum: aynı anda tek koşu' : dryRun ? 'Kuru test koşusu' : 'CANLI koşu'}
              >
                {baskaCalisiyor ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {baskaCalisiyor ? `${ajanKisaltma(baskaAjan?.id || '', baskaAjan?.ad)} çalışıyor — bitince` : maxBagli === false ? 'Max bağlı değil' : 'Çalıştır'}
              </button>
            )}
            {sesli && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={buCalisiyor}
                className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                style={{
                  background: listening ? 'rgba(239,68,68,0.20)' : `${renk}14`,
                  border: `1px solid ${listening ? 'rgba(239,68,68,0.45)' : `${renk}44`}`,
                  color: listening ? '#fca5a5' : renk,
                }}
                title={listening ? 'Dinlemeyi durdur' : 'Sesli görev — konuş, metne dönüşsün'}
              >
                {listening ? <MicOff size={13} className="animate-pulse" /> : <Mic size={13} />} {listening ? 'Dinliyor' : 'Sesli'}
              </button>
            )}
          </div>
        </div>

        {mukellefEksik && (
          <div className="text-[11px]" style={{ color: RENK.turuncu }}>
            Bu görev mükellef ister — seç.
          </div>
        )}

        <div className="text-[10px]" style={{ color: RENK.sonuk }}>
          Kuru test: mesaj gitmez, Luca'ya yazılmaz · Enter çalıştırır · / odaklanır
        </div>
      </div>
    </section>
  );
});
