'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Link2, Loader2, Mic, MicOff, Play, SlidersHorizontal, Square, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Ajan, MukellefOzet } from '@/lib/ekip';
import { mukellefAdi } from '@/lib/ekip';
import { startListening, isSpeechSupported } from '../../../luca-operator/_components/voice';
import type { KosularApi } from '../kosular';
import { MukellefSecici } from '../MukellefSecici';
import { ajanTamAd, firmaKisalt } from '../ortak';
import { OfisAvatar } from './Parcalar';

const KOORDINATOR = 'koordinator';

/**
 * Şablon / pano / tekrar / cevap / kadro bunu doldurur; ÇALIŞTIRMAZ.
 * Varsayılan hedef Koordinatör; `hedefAjanId` yalnız Kadro çekmecesindeki "Bu personele görev ver" ile dolar
 * (koordinatörü atlayan doğrudan koşu — mevcut `kosular.baslat(ajanId, …)` ile).
 */
export interface KomutTaslak {
  ajanId?: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: true;
  kaynak?: 'sablon' | 'pano' | 'tekrar' | 'cevap' | 'oneri' | 'kadro';
  vakaId?: string;
  hedefAjanId?: string;
  nonce: number;
}

/**
 * GÖREV KUTUSU — tek satır: metin · sesli mikrofon · ayarlar açılır menüsü (mükellef + Kuru/Canlı) · Başlat/Durdur.
 * Kuru varsayılan, depoya yazılmaz; canlıya geçiş kart içi 6 sn teyit. Tek aktif koşu kilidi: koşu sürerken Başlat yerine Durdur.
 */
export const GorevKutusu = forwardRef<
  HTMLDivElement,
  {
    ajanlar: Ajan[];
    mukellefler: MukellefOzet[];
    komutTaslak: KomutTaslak | null;
    kosular: KosularApi;
    odakNonce: number;
    escNonce: number;
    maxBagli?: boolean;
  }
>(function GorevKutusu({ ajanlar, mukellefler, komutTaslak, kosular, odakNonce, escNonce, maxBagli }, ref) {
  const [gorev, setGorev] = useState('');
  const [taxpayerId, setTaxpayerId] = useState('');
  const [vakaId, setVakaId] = useState<string | undefined>(undefined);
  const [hedefAjanId, setHedefAjanId] = useState<string | undefined>(undefined);
  const [dryRun, setDryRun] = useState(true);
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [menuAcik, setMenuAcik] = useState(false);
  const [listening, setListening] = useState(false);
  const listenerRef = useRef<{ stop: () => void } | null>(null);
  const girdiRef = useRef<HTMLInputElement>(null);
  const baslatRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const aktif = kosular.aktifKosu;
  const calisiyor = !!aktif;
  const sabahOzetiSuruyor = !!aktif && aktif.kaynak === 'sabahOzeti';

  useEffect(() => {
    if (!komutTaslak) return;
    setGorev(komutTaslak.gorev);
    setTaxpayerId(komutTaslak.taxpayerId || '');
    setVakaId(komutTaslak.vakaId || undefined);
    setHedefAjanId(komutTaslak.hedefAjanId || undefined);
    setDryRun(true);
    setCanliTeyit(false);
    setTimeout(() => (komutTaslak.gorev ? baslatRef.current : girdiRef.current)?.focus(), 200);
  }, [komutTaslak?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (odakNonce) setTimeout(() => girdiRef.current?.focus(), 40);
  }, [odakNonce]);
  useEffect(() => {
    if (escNonce) {
      setCanliTeyit(false);
      setMenuAcik(false);
    }
  }, [escNonce]);
  useEffect(() => {
    if (!canliTeyit) return;
    const t = setTimeout(() => setCanliTeyit(false), 6000);
    return () => clearTimeout(t);
  }, [canliTeyit]);
  // Menü: dışarı tıklayınca kapan (mükellef listesi gövdeye taşındığı için `.ekip-secici-liste` içi tıklama dışarı sayılmaz)
  useEffect(() => {
    if (!menuAcik) return;
    const dinle = (e: MouseEvent) => {
      const h = e.target as HTMLElement | null;
      if (h && (menuRef.current?.contains(h) || h.closest('.ekip-secici-liste'))) return;
      setMenuAcik(false);
    };
    document.addEventListener('mousedown', dinle);
    return () => document.removeEventListener('mousedown', dinle);
  }, [menuAcik]);

  const calistirabilir = !!gorev.trim() && !calisiyor && maxBagli !== false;
  const calistir = () => {
    if (!calistirabilir) return;
    void kosular.baslat(hedefAjanId || KOORDINATOR, { gorev: gorev.trim(), taxpayerId: taxpayerId || undefined, dryRun, vakaId });
    setVakaId(undefined);
    setMenuAcik(false);
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
      onError: () => {
        toast.error('Mikrofon başlatılamadı', { description: 'Mikrofon iznini kontrol edip yeniden deneyin.' });
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

  const secili = mukellefler.find((m) => m.id === taxpayerId);
  const hedefAd = hedefAjanId ? ajanTamAd(hedefAjanId, ajanlar.find((a) => a.id === hedefAjanId)?.ad) : '';
  const menuEtiketi = `${secili ? firmaKisalt(mukellefAdi(secili), 99) : 'Ofis geneli'} · ${dryRun ? 'Kuru' : 'Canlı'}`;

  return (
    <div ref={ref} className="of-gorev" data-canli={!dryRun || undefined} data-dinliyor={listening || undefined}>
      <div className="of-gorev-baslik">
        <span className="of-gorev-baslik-simge" aria-hidden="true"><Sparkles size={14} /></span>
        <b>Görev ver</b>
        <span>Yazın ya da söyleyin — Koordinatör işi doğru personele verir</span>
      </div>
      <div className="of-gorev-satir">
        <input
          ref={girdiRef}
          value={gorev}
          onChange={(e) => setGorev(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              calistir();
            }
          }}
          type="text"
          aria-label="Görev"
          className="of-gorev-girdi"
          placeholder={listening ? 'Dinliyorum…' : calisiyor ? 'Bir görev sürüyor — bitince yenisini verebilirsiniz' : 'Görev yazın ya da söyleyin  ( / )'}
        />
        <button type="button" className="of-simge-dugme" data-aktif={listening || undefined} onClick={toggleMic} disabled={calisiyor} title={listening ? 'Dinlemeyi durdur' : 'Sesli söyle'} aria-label={listening ? 'Dinlemeyi durdur' : 'Sesli söyle'}>
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <div className="of-gorev-menu" ref={menuRef}>
          <button type="button" className="of-dugme" data-tur="ikincil" data-canli={!dryRun || undefined} aria-expanded={menuAcik} aria-haspopup="dialog" onClick={() => setMenuAcik((a) => !a)} title="Mükellef ve çalışma modu">
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="of-gorev-menu-etiket">{menuEtiketi}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuAcik && (
            <div className="of-acilir" role="dialog" aria-label="Görev ayarları">
              <label className="of-acilir-alan">
                <span>Mükellef</span>
                <span className="of-acilir-secici">
                  <MukellefSecici sade yerTutucu="Ofis geneli · mükellef seç" mukellefler={mukellefler} value={taxpayerId} onChange={setTaxpayerId} renk="#4263eb" escNonce={escNonce} />
                </span>
              </label>
              <div className="of-acilir-alan">
                <span>Çalışma modu</span>
                <span className="of-mod" role="radiogroup" aria-label="Çalışma modu">
                  <button type="button" role="radio" aria-checked={dryRun} data-mod="kuru" onClick={() => { setDryRun(true); setCanliTeyit(false); }} title="Mükellefe mesaj gitmez, Luca’ya yazılmaz; yalnız 'yapacaktım' raporu">
                    Kuru test
                  </button>
                  <button type="button" role="radio" aria-checked={!dryRun} data-mod="canli" onClick={() => { if (dryRun) setCanliTeyit(true); }} title="Gerçek işlem — dışarı gönderimler yine onayınıza düşer">
                    Canlı
                  </button>
                </span>
                {canliTeyit && dryRun && (
                  <div className="of-teyit" data-tehlike role="alertdialog">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span className="of-teyit-metin">
                      <b>Canlı moda geçiliyor</b> — mükellefe mesaj gidebilir, Luca’ya fiş yazılabilir. Resmi gönderim (GİB/SGK/berat) yine sizde kalır.
                    </span>
                    <span className="of-teyit-dugmeler">
                      <button type="button" className="of-dugme" data-tur="tehlike-dolu" onClick={() => { setDryRun(false); setCanliTeyit(false); }}>
                        Evet, canlı
                      </button>
                      <button type="button" className="of-dugme" data-tur="ikincil" onClick={() => setCanliTeyit(false)}>
                        Vazgeç
                      </button>
                    </span>
                  </div>
                )}
                <small>{dryRun ? 'Kuru testte mesaj gönderilmez, Luca’ya yazılmaz; personel yalnız "yapacaktım" raporu verir.' : 'Canlı: gerçek işlem yapılır; dışarı gönderimler onayınıza gelir.'}</small>
              </div>
              {(hedefAjanId || vakaId) && (
                <div className="of-acilir-alan">
                  <span>Bağlar</span>
                  <span className="of-gorev-rozetler">
                    {hedefAjanId && (
                      <span className="of-cip" data-ton="mor" title="Koordinatörü atlayıp doğrudan bu personele gider">
                        <OfisAvatar ajanId={hedefAjanId} boyut={16} /> doğrudan {hedefAd}
                        <button type="button" className="of-cip-kapat" onClick={() => setHedefAjanId(undefined)} title="Koordinatöre ver (varsayılan)">
                          <X size={11} />
                        </button>
                      </span>
                    )}
                    {vakaId && (
                      <span className="of-cip" data-ton="kursuni" title={`Aynı iş zincirinde devam: ${vakaId}`}>
                        <Link2 size={11} /> iş zinciri
                        <button type="button" className="of-cip-kapat" onClick={() => setVakaId(undefined)} title="Bağı kaldır — yeni zincir aç">
                          <X size={11} />
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        {sabahOzetiSuruyor ? (
          <button type="button" className="of-dugme of-baslat" data-tur="ikincil" disabled>
            <Loader2 size={15} className="animate-spin" /> Sabah özeti
          </button>
        ) : calisiyor ? (
          <button type="button" className="of-dugme of-baslat" data-tur="tehlike" onClick={() => void kosular.durdur(aktif!.ajanId)}>
            <Square size={14} /> Durdur
          </button>
        ) : (
          <button ref={baslatRef} type="button" onClick={calistir} disabled={!calistirabilir} title={dryRun ? 'Görevi deneme modunda başlat' : 'Gerçek işlemi başlat'} className="of-dugme of-baslat" data-tur={dryRun ? 'birincil' : 'tehlike-dolu'}>
            {dryRun ? <Play size={15} /> : <AlertTriangle size={15} />}
            {maxBagli === false ? 'Bağlantı gerekli' : dryRun ? 'Başlat' : 'Canlı başlat'}
          </button>
        )}
      </div>
      {(hedefAjanId || !dryRun) && !menuAcik && (
        <div className="of-gorev-rozetler of-gorev-rozetler--alt">
          {hedefAjanId && (
            <span className="of-cip" data-ton="mor">
              <OfisAvatar ajanId={hedefAjanId} boyut={16} /> doğrudan {hedefAd}
              <button type="button" className="of-cip-kapat" onClick={() => setHedefAjanId(undefined)} title="Koordinatöre ver (varsayılan)">
                <X size={11} />
              </button>
            </span>
          )}
          {!dryRun && (
            <span className="of-cip" data-ton="kirmizi">
              canlı — gerçek işlem
            </span>
          )}
        </div>
      )}
    </div>
  );
});
