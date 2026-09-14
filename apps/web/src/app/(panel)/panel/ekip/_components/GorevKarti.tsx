'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { Play, Loader2, Mic, MicOff, AlertTriangle, Square, Link2, X, Zap, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../luca-operator/_components/voice';
import type { KosularApi } from './kosular';
import { MukellefSecici } from './MukellefSecici';
import { Anahtar, AvatarV5, CamKart, Dug, Kapsul, Kbd, MetrikKutu, V5, cukur } from './Cam';
import { ajanKisaltma } from './ortak';

const KOORDINATOR = 'koordinator';

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
 * Görev merkezi v5 — sol: büyük yazı kutusu (içinde mikrofon), altında mükellef · Kuru/Canlı anahtarı · Çalıştır;
 * sağ: Koordinatör kartı (avatar, 3 metrik: çalışan / uzman / karar, tek cümle durum notu).
 * Kuru/Canlı depoya yazılmaz; her açılışta KURU. Canlıya geçiş kart içi teyitle.
 */
export const GorevKarti = forwardRef<
  HTMLElement,
  {
    ajanlar: Ajan[];
    mukellefler: MukellefOzet[];
    mukellefAd: (id?: string | null) => string | undefined;
    komutTaslak: KomutTaslak | null;
    kosular: KosularApi;
    odakNonce: number;
    escNonce: number;
    maxBagli?: boolean;
    calisan: number;
    kararSayisi: number;
    koordinatorNotu: string;
  }
>(function GorevKarti({ ajanlar, mukellefler, komutTaslak, kosular, odakNonce, escNonce, maxBagli, calisan, kararSayisi, koordinatorNotu }, ref) {
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

  const kenar = listening ? 'rgba(255,107,122,0.6)' : odakta ? 'rgba(227,194,111,0.6)' : !dryRun ? 'rgba(255,107,122,0.45)' : V5.cizgi2;

  return (
    <CamKart
      ref={(el) => {
        kutuRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      ton="altin"
      etiket="Görev merkezi"
      ikon={<Zap size={17} />}
      baslik="Koordinatör’e ne yaptıralım?"
      sag={
        <>
          {vakaId && (
            <Kapsul tur="calisiyor" title={`Aynı iş zincirinde devam: ${vakaId}`}>
              <Link2 size={11} /> iş zinciri
              <button type="button" onClick={() => setVakaId(undefined)} className="ml-0.5 rounded p-0.5 hover:bg-white/10" title="Bağı kaldır — yeni zincir aç">
                <X size={10} />
              </button>
            </Kapsul>
          )}
          {dryRun ? (
            <Kapsul tur="kuru">
              <ShieldCheck size={12} /> Kuru test: mesaj gitmez, Luca’ya yazılmaz
            </Kapsul>
          ) : (
            <Kapsul tur="canli" nokta>
              Canlı mod: gerçek işlem
            </Kapsul>
          )}
        </>
      }
    >
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Sol: yazı kutusu */}
        <div className="min-w-0">
          <div className="relative" style={cukur({ borderColor: kenar, boxShadow: odakta ? '0 0 0 3px rgba(227,194,111,0.12), inset 0 2px 12px rgba(0,0,0,0.35)' : 'inset 0 2px 12px rgba(0,0,0,0.35)' })}>
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
              rows={3}
              placeholder={listening ? 'Dinliyorum…' : 'Örnek: Ömer Özen’in Ağustos 2026 KDV kontrolünü yap · Zeyrek Lojistik Ağustos faturalarını çek ve işle · Öz Ela son tebligatlar ne?'}
              className="min-h-[96px] w-full resize-none bg-transparent px-[18px] py-4 pr-16 text-[15px] leading-relaxed outline-none"
              style={{ color: V5.metin }}
            />
            <button
              type="button"
              onClick={toggleMic}
              disabled={buCalisiyor}
              title={listening ? 'Dinlemeyi durdur' : 'Sesli söyle — konuş, metne dönüşsün'}
              className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl transition-[filter] hover:brightness-125 disabled:opacity-40 ${listening ? 'animate-pulse' : ''}`}
              style={
                listening
                  ? { background: 'linear-gradient(180deg, rgba(255,107,122,0.35), rgba(255,107,122,0.15))', border: '1px solid rgba(255,107,122,0.6)', color: '#ffd0d5', boxShadow: '0 6px 18px rgba(255,107,122,0.25)' }
                  : { background: 'linear-gradient(180deg, rgba(110,163,255,0.25), rgba(110,163,255,0.10))', border: '1px solid rgba(110,163,255,0.4)', color: '#cfe0ff', boxShadow: '0 6px 18px rgba(110,163,255,0.2)' }
              }
            >
              {listening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>

            <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5" style={{ borderTop: `1px solid ${V5.cizgi}` }}>
              <span className="inline-flex min-w-0 items-center gap-2 rounded-[10px] px-3 py-1.5 text-[12.5px]" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${V5.cizgi2}` }}>
                <Users size={13} style={{ color: V5.soluk }} />
                <span style={{ color: V5.soluk }}>Mükellef</span>
                <span className="w-[230px] min-w-0">
                  <MukellefSecici sade yerTutucu="Seçin (boş = ofis geneli)" mukellefler={mukellefler} value={taxpayerId} onChange={setTaxpayerId} renk={V5.altin} escNonce={escNonce} />
                </span>
              </span>
              <Anahtar
                secenekler={[
                  { id: 'kuru', etiket: 'Kuru test', title: 'Mükellefe mesaj gitmez, Luca’ya yazılmaz; yalnız "yapacaktım" raporu' },
                  { id: 'canli', etiket: <><Zap size={11} /> Canlı</>, tehlike: true, title: 'Gerçek işlem — dışarı gönderimler yine onayınıza düşer' },
                ]}
                deger={dryRun ? 'kuru' : 'canli'}
                onChange={(id) => {
                  if (id === 'kuru') {
                    setDryRun(true);
                    setCanliTeyit(false);
                  } else if (dryRun) setCanliTeyit(true);
                }}
              />
              <span className="flex-1" />
              {sabahOzetiSuruyor ? (
                <Dug disabled title="Sabah özeti sunucuda üretiliyor; bitince kilit açılır">
                  <Loader2 size={14} className="animate-spin" /> Sabah özeti üretiliyor
                </Dug>
              ) : buCalisiyor ? (
                <Dug tur="tehlike" onClick={() => void kosular.durdur(KOORDINATOR)} title="Koşu sunucuda durdurulur; iş 'iptal edildi (Muzaffer Bey)' olarak kapanır">
                  <Square size={13} /> Durdur
                </Dug>
              ) : (
                <Dug ref={calistirRef} tur={dryRun ? 'altin' : 'tehlike'} onClick={calistir} disabled={!calistirabilir} title={baskaCalisiyor ? 'Aynı anda tek koşu' : dryRun ? 'Kuru test koşusu (Enter)' : 'CANLI koşu'}>
                  {baskaCalisiyor ? <Loader2 size={14} className="animate-spin" /> : dryRun ? <Play size={14} /> : <AlertTriangle size={14} />}
                  {baskaCalisiyor ? 'Koşu sürüyor' : maxBagli === false ? 'Max bağlı değil' : dryRun ? 'Çalıştır' : 'Canlı çalıştır'}
                </Dug>
              )}
            </div>
          </div>

          {canliTeyit && dryRun && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(255,107,122,0.10)', border: '1px solid rgba(255,107,122,0.5)', color: V5.metin }}>
              <AlertTriangle size={14} style={{ color: V5.coral }} />
              <span className="min-w-0 flex-1">
                <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sizde kalır.
              </span>
              <Dug tur="tehlike" kucuk onClick={() => { setDryRun(false); setCanliTeyit(false); }}>
                Evet, canlı
              </Dug>
              <Dug kucuk onClick={() => setCanliTeyit(false)}>Vazgeç</Dug>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: V5.soluk }}>
            <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> çalıştırır</span>
            <span className="inline-flex items-center gap-1.5"><Kbd>⇧ Enter</Kbd> yeni satır</span>
            <span>{dryRun ? 'Kuru test: gerçek işlem yapılmaz, yapılacaklar raporlanır' : 'Canlı modda dışarı giden her mesaj yine onayınıza düşer · sayfa yenilenince kuru teste döner'}</span>
          </div>
        </div>

        {/* Sağ: Koordinatör kartı */}
        <div className="flex flex-col gap-3 rounded-[14px] p-4" style={{ background: 'linear-gradient(160deg, rgba(227,194,111,0.14), rgba(227,194,111,0.04))', border: '1px solid rgba(227,194,111,0.35)' }}>
          <div className="flex items-center gap-3">
            <AvatarV5 kisaltma={ajanKisaltma(KOORDINATOR, ajan?.ad)} ton="altin" boyut={44} nokta={maxBagli !== false} nabiz={buCalisiyor} />
            <div className="min-w-0">
              <div className="text-[14px] font-bold" style={{ color: V5.metin }}>
                {ajan?.ad || 'Koordinatör'}
              </div>
              <div className="text-[12px]" style={{ color: V5.ikincil }}>
                Ofis müdürü · işi doğru uzmana verir
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetrikKutu deger={calisan} etiket="çalışan" renk={calisan > 0 ? V5.mavi : undefined} />
            <MetrikKutu deger={Math.max(0, ajanlar.length - 1) || 11} etiket="uzman" />
            <MetrikKutu deger={kararSayisi} etiket="karar" renk={kararSayisi > 0 ? V5.amber : undefined} />
          </div>
          <div className="text-[12.3px] leading-relaxed" style={{ color: V5.ikincil }}>
            {koordinatorNotu}
          </div>
        </div>
      </div>
    </CamKart>
  );
});
