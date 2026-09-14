'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, AlertTriangle, Square, Link2, X, FlaskConical, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { Avatar, Dugme, Kart } from './Kart';
import { SABLONLAR, TEMA, ajanKisaltma, sablonDoldur, type SablonGrubu } from './ortak';

const KOORDINATOR = 'koordinator';
const GRUP_SIRASI: SablonGrubu[] = ['Günlük', 'Beyanname ve KDV', 'Fatura', 'Denetim ve analiz', 'Diğer'];

/** Şablon / pano / tekrar-çalıştır / cevapla bunu doldurur; ÇALIŞTIRMAZ. Hep Koordinatör'e gider (ajanId yok sayılır). */
export interface KomutTaslak {
  ajanId?: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: true;
  kaynak?: 'sablon' | 'pano' | 'tekrar' | 'cevap';
  vakaId?: string;
  nonce: number;
}

/**
 * Görev kartı v3 — tek görev yeri (Koordinatör). Sol: büyük metin alanı + mükellef seçici + hazır görevler (gruplu çipler).
 * Sağ: mod anahtarı (Kuru test / Canlı) + Sesli + Çalıştır. Kuru/Canlı depoya yazılmaz; her açılışta KURU.
 */
export const GorevKarti = forwardRef<
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
>(function GorevKarti({ ajanlar, mukellefler, mukellefAd, seciliDonem, komutTaslak, kosular, odakNonce, escNonce, maxBagli }, ref) {
  const ajan = ajanlar.find((a) => a.id === KOORDINATOR);
  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [vakaId, setVakaId] = useState<string | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [kilitli, setKilitli] = useState(false);
  const [aktifSablonId, setAktifSablonId] = useState<string | null>(null);
  const [mukellefOdak, setMukellefOdak] = useState(0);
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
  const aktifSablon = SABLONLAR.find((s) => s.id === aktifSablonId);
  const mukellefEksik = !!aktifSablon?.mukellefIster && !taxpayerId;

  const gruplar = useMemo(() => GRUP_SIRASI.map((grup) => ({ grup, sablonlar: SABLONLAR.filter((s) => s.grup === grup) })).filter((g) => g.sablonlar.length), []);

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
    const t = setTimeout(() => setCanliTeyit(false), 5000);
    return () => clearTimeout(t);
  }, [canliTeyit]);

  const calistirabilir = !!gorev.trim() && !buCalisiyor && !baskaCalisiyor && !mukellefEksik && maxBagli !== false;
  const calistir = () => {
    if (!calistirabilir) return;
    void kosular.baslat(KOORDINATOR, { gorev: gorev.trim(), taxpayerId: taxpayerId || undefined, dryRun, vakaId });
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

  const alanKenar = listening ? `${TEMA.kirmizi}88` : odakta ? `${TEMA.altin}99` : !dryRun ? `${TEMA.kirmizi}66` : TEMA.alanKenar;

  return (
    <Kart
      ref={(el) => {
        kutuRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      renk={dryRun ? TEMA.altin : TEMA.kirmizi}
      baslik={
        <span className="inline-flex items-center gap-2.5">
          <Avatar kisaltma={ajanKisaltma(KOORDINATOR, ajan?.ad)} boyut={28} durum={buCalisiyor ? 'calisiyor' : 'bos'} />
          Koordinatör’e görev ver
        </span>
      }
      aciklama="Ofis müdürü işi doğru personele verir; ilerlemeyi aşağıdaki iş panelinden izlersiniz."
      sag={
        vakaId ? (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ border: `1px solid ${TEMA.mavi}66`, color: TEMA.mavi }} title={`Aynı iş zincirinde devam: ${vakaId}`}>
            <Link2 size={10} /> iş zinciri #{vakaId.slice(0, 8)}
            <button type="button" onClick={() => setVakaId(undefined)} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Bağı kaldır — yeni zincir aç">
              <X size={10} />
            </button>
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
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
          rows={3}
          placeholder={listening ? 'Dinliyorum…' : 'Örnek: Ömer Özen’in Ağustos 2026 KDV kontrolünü yap · Zeyrek Lojistik Ağustos faturalarını işle · Öz Ela son tebligatlar ne?'}
          className="min-h-[92px] w-full resize-y rounded-xl px-4 py-3 text-[14px] leading-relaxed outline-none transition-[border-color,box-shadow] duration-150"
          style={{ background: TEMA.alanZemin, border: `1px solid ${alanKenar}`, color: TEMA.metin, boxShadow: odakta ? `0 0 0 3px ${TEMA.altin}22` : 'none' }}
        />

        {/* Hazır görevler — gruplu çipler */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10.5px] uppercase tracking-wider" style={{ color: TEMA.soluk }}>
            Hazır görevler <span className="normal-case tracking-normal">· metni doldurur, çalıştırmaz</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {gruplar.map((g) => (
              <span key={g.grup} className="inline-flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px]" style={{ color: TEMA.soluk }}>
                  {g.grup}
                </span>
                {g.sablonlar.map((s) => {
                  const aktif = aktifSablonId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => sablonSec(s.id)}
                      className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-[border-color,background-color] duration-150"
                      style={{ background: aktif ? `${TEMA.altin}22` : 'rgba(255,255,255,0.04)', border: `1px solid ${aktif ? `${TEMA.altin}88` : TEMA.alanKenar}`, color: aktif ? TEMA.altin : TEMA.metin }}
                      title={s.mukellefIster ? 'Mükellef ister' : undefined}
                    >
                      {s.ad}
                    </button>
                  );
                })}
              </span>
            ))}
          </div>
        </div>

        {canliTeyit && dryRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${TEMA.kirmizi}14`, border: `1px solid ${TEMA.kirmizi}77`, color: TEMA.metin }}>
            <span className="min-w-0 flex-1">
              <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir.
            </span>
            <Dugme tur="tehlike" onClick={() => { setDryRun(false); setCanliTeyit(false); }}>
              Evet, canlı
            </Dugme>
            <Dugme onClick={() => setCanliTeyit(false)}>Vazgeç</Dugme>
          </div>
        )}
        {!dryRun && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${TEMA.kirmizi}12`, border: `1px solid ${TEMA.kirmizi}55`, color: TEMA.metin }}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: TEMA.kirmizi }} />
            <span>
              <b>Canlı koşu.</b> Mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sadece size aittir; dışarı gönderimler "Onayınızı bekleyen" olarak size düşer. Sayfa yenilenince kuru teste döner.
            </span>
          </div>
        )}

        {/* Alt satır: mükellef (sol) · mod + Sesli + Çalıştır (sağ) */}
        <div className="flex flex-col gap-3 pt-1 lg:flex-row lg:items-center lg:justify-between" style={{ borderTop: `1px solid ${TEMA.satirCizgi}` }}>
          <div className="flex min-w-0 flex-wrap items-center gap-2 pt-3">
            <span className="text-[11px]" style={{ color: TEMA.soluk }}>
              Mükellef
            </span>
            <div className="w-full min-w-0 sm:w-[280px]">
              <MukellefSecici
                mukellefler={mukellefler}
                value={taxpayerId}
                onChange={(id) => {
                  setTaxpayerId(id);
                  setKilitli(false);
                  if (aktifSablon && id) setGorev(sablonDoldur(aktifSablon.gorev, mukellefAd(id), aktifSablon.donemIster ? seciliDonem : null));
                }}
                renk={TEMA.altin}
                kilitli={kilitli}
                odakNonce={mukellefOdak}
                escNonce={escNonce}
              />
            </div>
            {mukellefEksik && (
              <span className="text-[11px]" style={{ color: TEMA.turuncu }}>
                Bu görev mükellef ister — seçin.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <div className="inline-flex flex-shrink-0 items-center rounded-lg p-[3px]" style={{ background: TEMA.alanZemin, border: `1px solid ${dryRun ? TEMA.alanKenar : `${TEMA.kirmizi}66`}` }} title="Kuru test: mükellefe mesaj gitmez, Luca'ya yazılmaz; yalnız 'yapacaktım' raporu">
              <button
                type="button"
                onClick={() => { setDryRun(true); setCanliTeyit(false); }}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150"
                style={dryRun ? { background: `${TEMA.yesil}22`, color: TEMA.yesil } : { background: 'transparent', color: TEMA.ikincil }}
                aria-pressed={dryRun}
              >
                <FlaskConical size={11} /> Kuru test
              </button>
              <button
                type="button"
                onClick={() => { if (dryRun) setCanliTeyit(true); }}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150"
                style={!dryRun ? { background: `${TEMA.kirmizi}22`, color: TEMA.kirmizi } : { background: 'transparent', color: TEMA.ikincil }}
                aria-pressed={!dryRun}
              >
                <Zap size={11} /> Canlı
              </button>
            </div>
            <Dugme tur={listening ? 'tehlike' : 'ikincil'} onClick={toggleMic} disabled={buCalisiyor} title={listening ? 'Dinlemeyi durdur' : 'Sesli görev — konuş, metne dönüşsün'}>
              {listening ? <MicOff size={13} className="animate-pulse" /> : <Mic size={13} />} {listening ? 'Dinliyor' : 'Sesli'}
            </Dugme>
            {sabahOzetiSuruyor ? (
              <Dugme disabled buyuk title="Sabah özeti sunucuda üretiliyor; bitince kilit açılır">
                <Loader2 size={14} className="animate-spin" /> Sabah özeti üretiliyor
              </Dugme>
            ) : buCalisiyor ? (
              <Dugme tur="tehlike" buyuk onClick={() => void kosular.durdur(KOORDINATOR)} title="Koşu sunucuda durdurulur; iş 'iptal edildi (Muzaffer Bey)' olarak kapanır">
                <Square size={13} /> Durdur
              </Dugme>
            ) : (
              <Dugme ref={calistirRef} tur={dryRun ? 'birincil' : 'tehlike'} buyuk onClick={calistir} disabled={!calistirabilir} title={baskaCalisiyor ? 'Aynı anda tek koşu' : dryRun ? 'Kuru test koşusu' : 'CANLI koşu'}>
                {baskaCalisiyor ? <Loader2 size={14} className="animate-spin" /> : dryRun ? <Play size={14} /> : <AlertTriangle size={14} />}
                {baskaCalisiyor ? 'Koşu sürüyor' : maxBagli === false ? 'Max bağlı değil' : dryRun ? 'Çalıştır' : 'Canlı çalıştır'}
              </Dugme>
            )}
          </div>
        </div>
        <div className="text-[11px]" style={{ color: TEMA.soluk }}>
          Enter çalıştırır · Shift+Enter yeni satır · / metne odaklanır · Kuru test: mesaj gitmez, Luca’ya yazılmaz.
        </div>
      </div>
    </Kart>
  );
});
