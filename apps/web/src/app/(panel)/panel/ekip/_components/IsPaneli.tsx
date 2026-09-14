'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, Send, XCircle, MessageSquareReply, RotateCcw, ShieldAlert, ClipboardCheck, StickyNote, FlaskConical, GraduationCap, HelpCircle, ChevronDown, Sunrise, Wrench, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, istekKapat, onayla, reddet, sabahOzetiUret, isZamanAsimi, type AcikKalem, type IsDosyasi, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { Avatar, Dugme, DurumKelimesi, Kart, Rozet } from './Kart';
import { TEMA, adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, aracAdi, cevapAyristir, goreliSaat, kaynakEtiketi, konuKisalt, raporBolumleri, saatKisa, sayacMetni, sureKisa, yokMu, type RaporBolumu } from './ortak';

/* ─────────────────────────── yardımcılar ─────────────────────────── */

type Asama = { ad: string; durum: 'bitti' | 'aktif' | 'bekliyor' | 'hata' };

/** Aşama çubuğu: Görev alındı → Bilgi toplandı → Personelde → Sonuç. */
function asamalar(p: { basladi: boolean; aracVar: boolean; personelVar: boolean; personelBitti: boolean; bitti: boolean; hata: boolean }): Asama[] {
  const liste: Asama[] = [];
  liste.push({ ad: 'Görev alındı', durum: p.basladi ? 'bitti' : 'aktif' });
  liste.push({ ad: 'Bilgi toplandı', durum: p.bitti || p.personelVar ? 'bitti' : p.aracVar ? 'aktif' : p.basladi ? 'aktif' : 'bekliyor' });
  if (p.personelVar) liste.push({ ad: 'Personelde', durum: p.personelBitti ? 'bitti' : 'aktif' });
  liste.push({ ad: 'Sonuç', durum: p.hata ? 'hata' : p.bitti && (!p.personelVar || p.personelBitti) ? 'bitti' : 'bekliyor' });
  return liste;
}

function AsamaCubugu({ liste }: { liste: Asama[] }) {
  return (
    <ol className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      {liste.map((a, i) => {
        const renk = a.durum === 'bitti' ? TEMA.yesil : a.durum === 'aktif' ? TEMA.mavi : a.durum === 'hata' ? TEMA.kirmizi : 'rgba(255,255,255,0.18)';
        return (
          <li key={a.ad} className="flex flex-shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: `${renk}${a.durum === 'bekliyor' ? '00' : '1a'}`, border: `1px solid ${renk}`, color: a.durum === 'bekliyor' ? TEMA.soluk : renk }}>
              {a.durum === 'bitti' ? <Check size={11} /> : a.durum === 'aktif' ? <Loader2 size={11} className="animate-spin" /> : a.durum === 'hata' ? <X size={11} /> : <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }} />}
              {a.ad}
            </span>
            {i < liste.length - 1 && <span className="h-px w-5 flex-shrink-0" style={{ background: a.durum === 'bitti' ? `${TEMA.yesil}66` : 'rgba(255,255,255,0.12)' }} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Zaman çizelgesi satırı — sol çizgi + nokta, saat, başlık, ayrıntı. */
function CizelgeSatiri({ saat, ikon, renk, baslik, ayrinti, sag, nabiz, children }: { saat?: string; ikon?: ReactNode; renk: string; baslik: ReactNode; ayrinti?: ReactNode; sag?: ReactNode; nabiz?: boolean; children?: ReactNode }) {
  return (
    <li className="relative flex min-w-0 gap-3 pb-3 pl-6 last:pb-0">
      <span className="absolute left-[7px] top-[7px] bottom-0 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <span className={`absolute left-0 top-[3px] flex h-[15px] w-[15px] items-center justify-center rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={{ background: '#0b0a08', border: `1.5px solid ${renk}`, color: renk, boxShadow: nabiz ? `0 0 0 3px ${renk}22` : 'none' }}>
        {ikon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {saat && (
            <span className="flex-shrink-0 text-[10.5px] tabular-nums" style={{ color: TEMA.soluk }}>
              {saat}
            </span>
          )}
          <span className="text-[12.5px] font-medium" style={{ color: TEMA.metin }}>
            {baslik}
          </span>
          {ayrinti && (
            <span className="min-w-0 truncate text-[12px]" style={{ color: TEMA.ikincil }}>
              {ayrinti}
            </span>
          )}
          {sag && <span className="ml-auto flex-shrink-0">{sag}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Yerel koşu adımı → çizelge satırı. */
function YerelAdim({ adim, mukellefAd, ajanAd }: { adim: Adim; mukellefAd: (id?: string | null) => string | undefined; ajanAd: (id: string) => string }) {
  const saat = saatKisa(adim.zaman).slice(0, 5);
  if (adim.tip === 'arac') {
    const calisiyor = adim.durum === 'calisiyor';
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd);
    return <CizelgeSatiri saat={saat} renk={calisiyor ? TEMA.mavi : TEMA.yesil} ikon={calisiyor ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />} baslik={baslik} ayrinti={ayrinti} nabiz={calisiyor} />;
  }
  if (adim.tip === 'kuruTest') {
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd);
    return <CizelgeSatiri saat={saat} renk={TEMA.turuncu} ikon={<FlaskConical size={9} />} baslik={`Kuru test — yapılmadı: ${baslik}`} ayrinti={ayrinti} />;
  }
  if (adim.tip === 'red') {
    return <CizelgeSatiri saat={saat} renk={TEMA.kirmizi} ikon={<X size={9} />} baslik={`Reddedildi: ${aracAdi(adim.ad)}`} ayrinti={adim.neden} />;
  }
  return <CizelgeSatiri saat={saat} renk={TEMA.altin} ikon={<ShieldAlert size={9} />} baslik={`Onayınıza sunuldu${adim.previewId ? ` · #${adim.previewId}` : ''}`} ayrinti={aracAdi(adim.ad)} sag={adim.sonuc ? <span className="text-[11px] font-semibold" style={{ color: adim.sonuc.startsWith('Hata') ? TEMA.kirmizi : TEMA.yesil }}>{adim.sonuc}</span> : undefined} />;
}

/** Sunucu vakasındaki personel (çocuk) adımı — açılınca araçları + raporu getirir. */
function PersonelAdimi({ adim, ajanAd, mukellefAd, acikVarsayilan, onRapor }: { adim: VakaAdimIs; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; acikVarsayilan?: boolean; onRapor?: (isId: string, is: IsDosyasi) => void }) {
  const [acik, setAcik] = useState(!!acikVarsayilan);
  const bitti = adim.durum === 'done' || adim.durum === 'failed';
  const { data } = useQuery({ queryKey: ['ekip-is', adim.isId], queryFn: () => getIs(adim.isId), enabled: acik || bitti, staleTime: 15_000, retry: 1, refetchInterval: bitti ? false : 8_000 });
  const renk = adim.durum === 'running' ? TEMA.mavi : adim.durum === 'failed' ? TEMA.kirmizi : adim.durum === 'done' ? TEMA.yesil : TEMA.soluk;
  const sure = adim.baslangic && adim.bitis ? sureKisa(new Date(adim.bitis).getTime() - new Date(adim.baslangic).getTime()) : '';
  const durumAd = adim.durum === 'running' ? 'çalışıyor' : adim.durum === 'failed' ? 'yapamadı' : adim.durum === 'done' ? 'bitirdi' : 'sırada';
  const araclar = data?.result?.toolUses || [];
  useEffect(() => {
    if (data && onRapor) onRapor(adim.isId, data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <CizelgeSatiri
      saat={saatKisa(adim.baslangic).slice(0, 5)}
      renk={renk}
      ikon={adim.durum === 'running' ? <Loader2 size={9} className="animate-spin" /> : adim.durum === 'failed' ? <X size={9} /> : adim.durum === 'done' ? <Check size={9} /> : undefined}
      nabiz={adim.durum === 'running'}
      baslik={
        <span className="inline-flex items-center gap-1.5">
          <Avatar kisaltma={ajanKisaltma(adim.ajanId)} boyut={24} durum={adim.durum === 'running' ? 'calisiyor' : adim.durum === 'failed' ? 'hata' : 'bos'} />
          {ajanTamAd(adim.ajanId, ajanAd(adim.ajanId))} {durumAd}
        </span>
      }
      ayrinti={adim.baslik}
      sag={
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: TEMA.soluk }}>
          {sure && <span className="tabular-nums">{sure}</span>}
          {!adim.kuru && <Rozet renk={TEMA.kirmizi}>canlı</Rozet>}
          <button type="button" onClick={() => setAcik((a) => !a)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] hover:bg-white/5" style={{ color: TEMA.ikincil }}>
            {acik ? 'gizle' : 'ayrıntı'} <ChevronDown size={11} className="transition-transform" style={{ transform: acik ? 'rotate(180deg)' : 'none' }} />
          </button>
        </span>
      }
    >
      {adim.durum === 'failed' && adim.hata && (
        <div className="mt-1 text-[11.5px]" style={{ color: TEMA.kirmizi }}>
          {adim.hata}
        </div>
      )}
      {acik && (
        <div className="mt-2 flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${TEMA.kartKenar}` }}>
          {!data && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: TEMA.ikincil }}>
              <Loader2 size={11} className="animate-spin" /> ayrıntı yükleniyor
            </span>
          )}
          {araclar.length > 0 && (
            <ol className="flex flex-col">
              {araclar.map((t, i) => {
                const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd);
                return <CizelgeSatiri key={i} renk={TEMA.yesil} ikon={<Check size={9} />} baslik={baslik} ayrinti={ayrinti} />;
              })}
            </ol>
          )}
          {data && !araclar.length && adim.durum === 'running' && (
            <span className="text-[11.5px]" style={{ color: TEMA.ikincil }}>
              Adımlar bitince görünür (personel çalışırken canlı akış yalnız Koordinatör için).
            </span>
          )}
          {data && bitti && (
            <span className="text-[11px]" style={{ color: TEMA.soluk }}>
              Raporu sağdaki Sonuç bölümünde.
            </span>
          )}
        </div>
      )}
    </CizelgeSatiri>
  );
}

const BOLUM_RENGI: Record<RaporBolumu['anahtar'], string> = {
  yaptigim: TEMA.mavi,
  kaynaklar: TEMA.soluk,
  bulgular: TEMA.metin,
  onay: TEMA.altin,
  istek: TEMA.turuncu,
  kimde: TEMA.mor,
  ogrendim: TEMA.mor,
  emin: TEMA.turuncu,
  devir: TEMA.mor,
  diger: TEMA.metin,
};

/** Rapor bölümleri — başlık + satırlar; "yok" satırı soluk tek kelime. */
export function RaporGorunumu({ rapor, kompakt = false }: { rapor: string; kompakt?: boolean }) {
  const bolumler = useMemo(() => raporBolumleri(rapor), [rapor]);
  if (!bolumler.length) return null;
  return (
    <div className={`grid gap-2.5 ${kompakt ? '' : 'md:grid-cols-2'}`}>
      {bolumler.map((b) => {
        const genis = b.anahtar === 'bulgular' || b.anahtar === 'diger' || b.anahtar === 'yaptigim';
        const renk = BOLUM_RENGI[b.anahtar];
        const yok = b.satirlar.length === 1 && yokMu(b.satirlar[0]);
        return (
          <div key={b.anahtar} className={`rounded-xl px-3.5 py-2.5 ${genis && !kompakt ? 'md:col-span-2' : ''}`} style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${b.anahtar === 'onay' || b.anahtar === 'istek' ? `${renk}55` : TEMA.kartKenar}` }}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: renk === TEMA.metin ? TEMA.soluk : renk }}>
              {b.baslik}
            </div>
            {yok ? (
              <div className="text-[12.5px]" style={{ color: TEMA.soluk }}>
                yok
              </div>
            ) : b.satirlar.length === 1 ? (
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: TEMA.metin }}>
                {b.satirlar[0]}
              </div>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px] leading-relaxed" style={{ color: TEMA.metin }}>
                {b.satirlar.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full" style={{ background: renk === TEMA.metin ? TEMA.soluk : renk }} />
                    <span className="min-w-0 whitespace-pre-wrap">{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Açık kalem — üç tür:
 *  - PRV onayı (dışarı mesaj): Onayla ve gönder / Reddet (kart içi teyit).
 *  - KARAR (bildirim, tur 'onay'): personel "karar sizde" dedi → kararınızı yazıp gönderirsiniz (aynı iş zincirinde devam eder) ya da kapatırsınız.
 *  - İSTEK (bildirim, tur 'istek'): sizden belge/işlem → Yapıldı; isterseniz not da yazarsınız.
 */
function AcikKalemKarti({ kalem, onBitti, onCevapla, calisiyor }: { kalem: AcikKalem; onBitti: () => void; onCevapla: (metin: string) => void; calisiyor: boolean }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [cevap, setCevap] = useState('');
  const onayMi = kalem.tip === 'onay';
  const kararMi = onayMi && kalem.kaynak === 'bildirim';
  const renk = onayMi ? TEMA.altin : TEMA.turuncu;
  const cevapGonder = () => {
    if (!cevap.trim()) return;
    onCevapla(cevap.trim());
    setCevap('');
    setSonuc('Cevabınız Koordinatör’e gitti');
  };
  const yap = async (fn: () => Promise<{ ok: boolean; error?: string; zatenKapali?: boolean }>, okMetin: string) => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await fn();
      setSonuc(r.ok ? (r.zatenKapali ? 'Zaten kapalıydı' : okMetin) : `Hata: ${r.error || 'olmadı'}`);
    } catch (e: any) {
      setSonuc(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
      onBitti();
    }
  };
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: `${renk}0f`, border: `1px solid ${renk}66` }}>
      <div className="flex flex-wrap items-center gap-2">
        {onayMi ? <ShieldAlert size={14} style={{ color: renk }} /> : <ClipboardCheck size={14} style={{ color: renk }} />}
        <span className="text-[12px] font-semibold" style={{ color: renk }}>
          {kararMi ? 'Kararınız bekleniyor' : onayMi ? 'Onayınızı bekliyor' : 'Sizden istenen'}
        </span>
        <span className="min-w-0 flex-1 text-[13px]" style={{ color: TEMA.metin }}>
          {kalem.baslik}
        </span>
        {sonuc ? (
          <span className="text-[11.5px] font-semibold" style={{ color: sonuc.startsWith('Hata') ? TEMA.kirmizi : TEMA.yesil }}>
            {sonuc}
          </span>
        ) : kararMi ? (
          <Dugme disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Kapatıldı')} title="Kararı verdiniz / gerek kalmadı → kalem kapanır">
            <Check size={11} /> Kapat
          </Dugme>
        ) : onayMi ? (
          <>
            <Dugme tur="yesil" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
              {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Onayla ve gönder
            </Dugme>
            <Dugme tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(kalem.id, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
              <XCircle size={11} /> Reddet
            </Dugme>
          </>
        ) : (
          <Dugme tur="yesil" disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Yapıldı ✓')} title="İstenen yapıldı → kalem kapanır, Koordinatör devam eder">
            {mesgul ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Yapıldı
          </Dugme>
        )}
      </div>
      {kalem.confirmationText && !sonuc && (
        <div className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.25)', color: TEMA.ikincil }}>
          {kalem.confirmationText}
        </div>
      )}
      {teyit && !sonuc && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{kalem.id}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(kalem.id), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
      {!sonuc && kalem.kaynak === 'bildirim' && (
        <div className="mt-2 flex gap-2">
          <input
            value={cevap}
            onChange={(e) => setCevap(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && cevap.trim()) {
                e.preventDefault();
                cevapGonder();
              }
            }}
            placeholder={kararMi ? 'Kararınızı yazın (ör. "kilitle", "görseli düzelt", "beklet")…' : 'İsterseniz not yazın (ör. "fişi yükledim, devam et")…'}
            className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-[12.5px] outline-none"
            style={{ background: TEMA.alanZemin, border: `1px solid ${TEMA.alanKenar}`, color: TEMA.metin }}
          />
          <Dugme tur="birincil" disabled={!cevap.trim()} onClick={cevapGonder} title={calisiyor ? 'Koşu sürüyor; cevabınız bitince gönderilir' : 'Koordinatör aynı iş zincirinde devam eder'}>
            <MessageSquareReply size={12} /> {calisiyor ? 'Bitince gönder' : 'Gönder'}
          </Dugme>
        </div>
      )}
    </div>
  );
}

/**
 * CEVAP / TALİMAT ALANI — panelde HER ZAMAN görünür (Muzaffer Bey 2026-09-15: "işlem sürerken cevap verme alanım yok").
 * Yazılan metin "Cevap: …" olarak Koordinatör'e aynı iş zincirinde gider; koşu sürüyorsa kuyruğa alınır, bitince kendiliğinden gönderilir.
 */
function CevapAlani({ calisiyor, kuru, bekleyen, onGonder, onIptal }: { calisiyor: boolean; kuru: boolean; bekleyen: string | null; onGonder: (metin: string) => void; onIptal: () => void }) {
  const [metin, setMetin] = useState('');
  const gonder = () => {
    if (!metin.trim()) return;
    onGonder(metin.trim());
    setMetin('');
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${TEMA.mavi}44` }}>
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TEMA.mavi }}>
        <MessageSquareReply size={12} /> Bu işe cevap / talimat
        <span className="normal-case tracking-normal" style={{ color: TEMA.soluk }}>
          · Koordinatör aynı iş zincirinde devam eder · {kuru ? 'kuru test' : 'canlı'}
        </span>
      </div>
      {bekleyen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: `${TEMA.mavi}12`, border: `1px solid ${TEMA.mavi}44`, color: TEMA.metin }}>
          <Loader2 size={12} className="animate-spin" style={{ color: TEMA.mavi }} />
          <span className="min-w-0 flex-1">
            Koşu bitince gönderilecek: <i>{bekleyen}</i>
          </span>
          <Dugme tur="sessiz" onClick={onIptal}>
            <X size={11} /> vazgeç
          </Dugme>
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              gonder();
            }
          }}
          rows={2}
          placeholder={calisiyor ? 'Yazın; koşu bitince Koordinatör’e gider (ör. "kilitle", "beyannameyi henüz hazırlama", "Gider 0023 görselini düzelt")…' : 'Ör. "belge 0023’ü kilitle", "şimdi beyannameyi hazırla", "neden 1 satır eşleşmedi?"…'}
          className="min-h-[56px] min-w-0 flex-1 resize-y rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none"
          style={{ background: TEMA.alanZemin, border: `1px solid ${TEMA.alanKenar}`, color: TEMA.metin }}
        />
        <Dugme tur="birincil" buyuk disabled={!metin.trim()} onClick={gonder} title={calisiyor ? 'Koşu sürüyor; bitince gönderilir' : 'Gönder (Enter)'}>
          <Send size={13} /> {calisiyor ? 'Bitince gönder' : 'Gönder'}
        </Dugme>
      </div>
    </div>
  );
}

/* ─────────────────────────── ana panel ─────────────────────────── */

/**
 * İş paneli v3 — komut verilen işin TEK ekranda, baştan sona görünümü:
 *  başlık (kim · ne · süre · mod) → aşama çubuğu → sol: insan dilinde adımlar (personel adımları açılır) · sağ: sonuç (rapor bölümleri, onay/istek kartları, sorular, öğrendikleri).
 * Kaynak: yerel koşu (SSE, Koordinatör) ve/veya sunucu vakası (personel adımları, açık kalemler, geçmiş işler).
 */
export function IsPaneli({ kosu, vaka, kosular, ajanAd, mukellefAd, onTaslak, onKapat }: { kosu?: Kosu; vaka?: Vaka; kosular: KosularApi; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void; onKapat?: () => void }) {
  const qc = useQueryClient();
  const [simdi, setSimdi] = useState(() => Date.now());
  const [cevapMetni, setCevapMetni] = useState('');
  const [durduruluyor, setDurduruluyor] = useState(false);
  const [gonderTeyit, setGonderTeyit] = useState(false);
  const [gonderMesgul, setGonderMesgul] = useState(false);

  const yerelCalisiyor = !!kosu && !kosu.bitti;
  const isAdimlari = (vaka?.adimlar || []).filter((a): a is VakaAdimIs => a.tip === 'is');
  const kokIsId = vaka?.vakaId || kosu?.vakaId || kosu?.isId;
  const kokAdim = isAdimlari.find((a) => a.isId === kokIsId) || isAdimlari[0];
  const personelAdimlari = isAdimlari.filter((a) => a.isId !== kokAdim?.isId);
  const sunucuCalisiyor = isAdimlari.some((a) => a.durum === 'running' || a.durum === 'pending');
  const calisiyor = yerelCalisiyor || sunucuCalisiyor;

  useEffect(() => {
    if (!calisiyor) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [calisiyor]);

  // Kök işin tam raporu + araçları sunucudan: geçmiş işte her zaman; yerel koşuda cevap boş kaldıysa (SSE metin gelmedi) yedek olarak
  const yerelCevapBos = !!kosu?.bitti && (!kosu.cevap || kosu.cevap === '(boş yanıt)');
  const kokGetirilsin = !!kokAdim?.isId && (!kosu || yerelCevapBos);
  const kokS = useQuery({ queryKey: ['ekip-is', kokAdim?.isId], queryFn: () => getIs(kokAdim!.isId), enabled: kokGetirilsin, staleTime: 15_000, retry: 1, refetchInterval: sunucuCalisiyor ? 8_000 : false });
  const kokIs: IsDosyasi | undefined = kokS.data;

  // Adımlar: yerel koşu varsa SSE adımları; yoksa sunucudaki kök işin araçları
  const yerelAdimlar: Adim[] = kosu ? kosu.adimlar : (kokIs?.result?.toolUses || []).map((t, i) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: kokIs?.startedAt ? new Date(kokIs.startedAt).getTime() + i : Date.now(), durum: 'bitti' as const }));
  const koordinatorRaporu = (kosu?.bitti && !yerelCevapBos ? kosu.cevap : '') || kokIs?.result?.rapor || kokAdim?.raporOzet || '';
  const hata = kosu?.hata || kokIs?.hata || (kokAdim?.durum === 'failed' ? kokAdim.hata || 'Hata' : '');

  // Personel (çocuk) raporları — PersonelAdimi getirdikçe buraya düşer; zincirin SONUCU = son biten personelin raporu
  const [personelRaporlari, setPersonelRaporlari] = useState<Record<string, IsDosyasi>>({});
  const personelRaporAl = useCallback((isId: string, is: IsDosyasi) => setPersonelRaporlari((p) => (p[isId] === is ? p : { ...p, [isId]: is })), []);
  const sonBitenPersonel = [...personelAdimlari].reverse().find((a) => a.durum === 'done' || a.durum === 'failed');
  const sonucIsi: IsDosyasi | undefined = sonBitenPersonel ? personelRaporlari[sonBitenPersonel.isId] : undefined;
  const sonucRaporu = sonBitenPersonel ? sonucIsi?.result?.rapor || sonBitenPersonel.raporOzet || '' : koordinatorRaporu;
  const raporMetni = sonucRaporu;
  const ayrisik = useMemo(() => (raporMetni ? cevapAyristir(raporMetni) : null), [raporMetni]);
  const ogrenilen = sonBitenPersonel ? sonucIsi?.result?.ogrenilen || [] : kosu?.bitti && !yerelCevapBos ? ayrisik?.ogrenilen || [] : kokIs?.result?.ogrenilen || [];
  const sorular = ayrisik?.sorular || [];
  const kuruListesi = sonBitenPersonel ? sonucIsi?.result?.kuruTestYapilacaktilar || [] : kokIs?.result?.kuruTestYapilacaktilar || [];
  const bitti = kosu ? kosu.bitti : !sunucuCalisiyor && !!kokAdim && kokAdim.durum !== 'running';
  const personelVar = personelAdimlari.length > 0 || yerelAdimlar.some((a) => a.tip === 'arac' && a.ad === 'ekip_ajan_baslat');
  const personelBitti = personelAdimlari.length > 0 && personelAdimlari.every((a) => a.durum === 'done' || a.durum === 'failed');

  const basladi = kosu?.basladi ?? (kokAdim?.baslangic ? new Date(kokAdim.baslangic).getTime() : vaka ? new Date(vaka.olusturuldu).getTime() : Date.now());
  const sureMetni = calisiyor ? sayacMetni(simdi - basladi) : sureKisa(kosu?.durationMs ?? kokIs?.durationMs ?? (kokAdim?.baslangic && kokAdim?.bitis ? new Date(kokAdim.bitis).getTime() - new Date(kokAdim.baslangic).getTime() : null));
  const kimde = vaka?.kimde.ajanId || kosu?.ajanId || 'koordinator';
  const konu = vaka?.konu || konuKisalt(kosu?.gorev || '', 110);
  const mukellef = vaka?.mukellef?.ad || mukellefAd(kosu?.taxpayerId);
  const kuru = kosu ? kosu.dryRun : vaka ? vaka.kuru : kokIs ? kokIs.dryRun : true;
  const kaynak = kosu?.kaynak === 'sabahOzeti' ? { ad: 'sabah özeti', ikon: '' } : kaynakEtiketi(kokIs?.kaynak || null);
  const sabahOzetiMi = kosu?.kaynak === 'sabahOzeti';
  const durumRenk = hata ? TEMA.kirmizi : calisiyor ? TEMA.mavi : bitti ? TEMA.yesil : TEMA.soluk;
  const durumAd = hata ? (hata === DURDURULDU_METNI ? 'Durduruldu' : 'Hata') : calisiyor ? 'Çalışıyor' : bitti ? 'Bitti' : 'Bekliyor';

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    if (kokAdim?.isId) qc.invalidateQueries({ queryKey: ['ekip-is', kokAdim.isId] });
  };

  const durdur = async () => {
    if (durduruluyor) return;
    setDurduruluyor(true);
    try {
      if (yerelCalisiyor && kosu) await kosular.durdur(kosu.ajanId);
      else {
        const kosan = isAdimlari.find((a) => a.durum === 'running');
        if (kosan) {
          const r = await iptalEt(kosan.isId);
          if (r.ok) toast.success('Durduruldu', { description: 'İş "iptal edildi (Muzaffer Bey)" olarak kapandı.' });
          else toast.error('Durdurulamadı', { description: r.error });
        }
      }
    } finally {
      setDurduruluyor(false);
      tazele();
    }
  };

  // Cevap/talimat: aynı iş zincirinde Koordinatör koşusu (vakanın modunda). Koşu sürüyorsa kuyruğa alınır, bitince gönderilir.
  const [bekleyenCevap, setBekleyenCevap] = useState<string | null>(null);
  const cevapGonderSimdi = useCallback(
    (metin: string) => {
      const kuruMod = kosu ? kosu.dryRun : vaka ? vaka.kuru : true;
      void kosular.baslat('koordinator', { gorev: `Cevap: ${metin}`, taxpayerId: vaka?.mukellef?.id || kosu?.taxpayerId || undefined, dryRun: kuruMod, vakaId: vaka?.vakaId || kosu?.vakaId || kosu?.isId });
    },
    [kosu, vaka, kosular],
  );
  const cevapla = (metin: string) => {
    if (kosular.aktifKosu) setBekleyenCevap(metin);
    else cevapGonderSimdi(metin);
  };
  const aktifKosuVar = !!kosular.aktifKosu;
  useEffect(() => {
    if (!aktifKosuVar && bekleyenCevap) {
      const m = bekleyenCevap;
      setBekleyenCevap(null);
      cevapGonderSimdi(m);
    }
  }, [aktifKosuVar, bekleyenCevap, cevapGonderSimdi]);
  const tekrar = () => onTaslak({ gorev: kokIs?.gorev || kosu?.gorev || vaka?.konu || '', taxpayerId: vaka?.mukellef?.id || kosu?.taxpayerId, dryRun: true, kaynak: 'tekrar', vakaId: vaka?.vakaId || kosu?.vakaId });

  /** Sabah özeti → Muzaffer Bey'e GERÇEK WhatsApp (yeniden üretir ve gönderir). */
  const sahibeGonder = async () => {
    if (gonderMesgul || kosular.aktifKosu) return;
    setGonderMesgul(true);
    const b = Date.now();
    kosular.ayarla('koordinator', { ajanId: 'koordinator', gorev: 'Sabah özeti — yeniden üretiliyor ve Muzaffer Bey’e gönderiliyor', dryRun: false, cevap: '', adimlar: [], bitti: false, basladi: b, kaynak: 'sabahOzeti' });
    try {
      const r = await sabahOzetiUret({ gonder: true });
      kosular.ayarla('koordinator', { ajanId: 'koordinator', gorev: 'Sabah özeti (yeniden üretildi ve gönderildi)', dryRun: false, isId: r.isId, vakaId: r.isId, model: r.model, cevap: r.rapor || '', adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: Date.now(), durum: 'bitti' as const })), bitti: true, hata: r.hata, durationMs: r.durationMs ?? Date.now() - b, basladi: b, kaynak: 'sabahOzeti', gonderildi: r.gonderildi });
      toast.success(`Sabah özeti ${r.gonderildi} numaraya gönderildi`);
    } catch (e: any) {
      const h = isZamanAsimi(e) ? 'Sürüyor — iş geçmişinde görünecek' : e?.message || 'Gönderilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata: h, durationMs: Date.now() - b }));
      toast.error(h);
    } finally {
      setGonderMesgul(false);
      setGonderTeyit(false);
      tazele();
    }
  };

  const asamaListesi = asamalar({ basladi: !!kosu?.isId || !!kokAdim || (!!kosu && kosu.adimlar.length > 0), aracVar: yerelAdimlar.length > 0, personelVar, personelBitti, bitti, hata: !!hata });
  const calisanAdim = yerelAdimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
  const suAnMetni = calisiyor
    ? calisanAdim
      ? adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd).baslik
      : personelAdimlari.some((a) => a.durum === 'running')
        ? `${ajanTamAd(personelAdimlari.find((a) => a.durum === 'running')!.ajanId, ajanAd(personelAdimlari.find((a) => a.durum === 'running')!.ajanId))} çalışıyor`
        : kosu && !kosu.isId
          ? 'Koordinatör göreve başlıyor'
          : 'Koordinatör düşünüyor'
    : '';

  const bildirimAdimlari = (vaka?.adimlar || []).filter((a): a is Exclude<VakaAdim, VakaAdimIs> => a.tip !== 'is' && !(a.tip === 'bildirim' && a.tur === 'bilgi' && /^İŞ ATAMASI/i.test(a.baslik)));

  return (
    <Kart
      renk={durumRenk}
      baslik={
        <span className="inline-flex min-w-0 items-center gap-2.5">
          {sabahOzetiMi ? <Sunrise size={16} style={{ color: TEMA.altin }} /> : <Avatar kisaltma={kimde === 'siz' ? 'MB' : ajanKisaltma(kimde)} boyut={28} durum={kimde === 'siz' ? 'siz' : calisiyor ? 'calisiyor' : hata ? 'hata' : 'bos'} />}
          <span className="min-w-0">
            <span className="block truncate text-[14px]" title={konu}>
              {sabahOzetiMi ? (calisiyor ? 'Sabah özeti üretiliyor' : 'Sabah özeti') : konu || 'İş'}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-normal" style={{ color: TEMA.ikincil }}>
              {mukellef && <span className="font-medium" style={{ color: TEMA.metin }}>{mukellef}</span>}
              <span>kimde: {kimde === 'siz' ? 'Siz' : ajanKisaAd(kimde, vaka?.kimde.ad)}</span>
              <span className="tabular-nums">{calisiyor ? `${sureMetni} sürüyor` : sureMetni ? `${sureMetni} sürdü` : ''}</span>
              {vaka?.olusturuldu && <span>{goreliSaat(vaka.olusturuldu)} açıldı</span>}
              {kaynak.ad !== 'portal' && <span>{kaynak.ikon} {kaynak.ad}</span>}
              {!kuru && <Rozet renk={TEMA.kirmizi}>canlı</Rozet>}
              {kuru && <Rozet renk={TEMA.yesil}>kuru test</Rozet>}
            </span>
          </span>
        </span>
      }
      sag={
        <>
          <DurumKelimesi renk={durumRenk} nabiz={calisiyor}>
            {durumAd}
          </DurumKelimesi>
          {calisiyor && !sabahOzetiMi && (
            <Dugme tur="tehlike" onClick={durdur} disabled={durduruluyor} title="Koşu sunucuda durdurulur">
              {durduruluyor ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />} Durdur
            </Dugme>
          )}
          {!calisiyor && !sabahOzetiMi && (
            <Dugme onClick={tekrar} title="Görev kutusunu aynı görevle doldurur (kuru); çalıştırmaz">
              <RotateCcw size={11} /> Tekrar
            </Dugme>
          )}
          {!calisiyor && onKapat && (
            <Dugme tur="sessiz" onClick={onKapat} title="Paneli kapat">
              <X size={12} />
            </Dugme>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Aşama çubuğu + şu an */}
        <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${TEMA.kartKenar}` }}>
          <AsamaCubugu liste={asamaListesi} />
          {calisiyor && (
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: TEMA.mavi }}>
              <Loader2 size={12} className="animate-spin" /> Şu an: {suAnMetni}…
            </div>
          )}
          {hata && (
            <div className="flex items-start gap-2 text-[12.5px]" style={{ color: TEMA.kirmizi }}>
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{hata === DURDURULDU_METNI ? 'Durduruldu — koşu sunucuda iptal edildi.' : hata}</span>
            </div>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Sol: adımlar */}
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TEMA.soluk }}>
              <Wrench size={11} /> Adımlar {yerelAdimlar.length + personelAdimlari.length > 0 && <span className="normal-case tracking-normal">· {yerelAdimlar.filter((a) => a.tip === 'arac').length + personelAdimlari.length} adım</span>}
            </div>
            <ol className="flex max-h-[520px] flex-col overflow-y-auto pr-1 [scrollbar-width:thin]">
              {!yerelAdimlar.length && !personelAdimlari.length && !bildirimAdimlari.length && (
                <li className="text-[12px]" style={{ color: TEMA.ikincil }}>
                  {calisiyor ? 'İlk adım bekleniyor…' : 'Adım kaydı yok.'}
                </li>
              )}
              {yerelAdimlar.map((a, i) => (
                <YerelAdim key={`${a.zaman}-${i}`} adim={a} mukellefAd={mukellefAd} ajanAd={ajanAd} />
              ))}
              {personelAdimlari.map((a) => (
                <PersonelAdimi key={a.isId} adim={a} ajanAd={ajanAd} mukellefAd={mukellefAd} acikVarsayilan={a.durum === 'running' || personelAdimlari.length === 1} onRapor={personelRaporAl} />
              ))}
              {bildirimAdimlari.map((a, i) =>
                a.tip === 'onay' ? (
                  <CizelgeSatiri key={`onay-${a.id}`} saat={saatKisa(a.baslangic).slice(0, 5)} renk={a.durum === 'EXECUTED' ? TEMA.yesil : a.durum === 'PENDING' ? TEMA.altin : TEMA.soluk} ikon={<ShieldAlert size={9} />} baslik={`Onay kaydı #PRV-${a.id.slice(0, 8)}`} ayrinti={`${a.durum === 'EXECUTED' ? 'gönderildi' : a.durum === 'PENDING' ? 'onay bekliyor' : a.durum === 'REJECTED' ? 'reddedildi' : a.durum === 'EXPIRED' ? 'süresi doldu' : a.durum}${a.baslik ? ` · ${a.baslik}` : ''}`} />
                ) : (
                  <CizelgeSatiri key={`not-${a.id || i}`} saat={saatKisa(a.baslangic).slice(0, 5)} renk={a.tur === 'istek' ? TEMA.turuncu : a.tur === 'onay' ? TEMA.altin : TEMA.soluk} ikon={<StickyNote size={9} />} baslik={a.tur === 'istek' ? 'Sizden istendi' : a.tur === 'onay' ? 'Onayınıza sunuldu' : 'Koordinatör notu'} ayrinti={`${a.baslik}${a.durum === 'kapandi' ? ' · kapandı' : ''}`}>
                    {a.govde && (
                      <div className="mt-0.5 whitespace-pre-wrap text-[11.5px]" style={{ color: TEMA.ikincil }}>
                        {a.govde}
                      </div>
                    )}
                  </CizelgeSatiri>
                ),
              )}
            </ol>
          </div>

          {/* Sağ: sonuç */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TEMA.soluk }}>
              Sonuç
              {kokS.isLoading && !kokIs && (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                  <Loader2 size={10} className="animate-spin" /> yükleniyor
                </span>
              )}
            </div>

            {/* Açık kalemler — sizden bir şey bekleyenler en üstte */}
            {vaka && vaka.acikKalemler.length > 0 && (
              <div className="flex flex-col gap-2">
                {vaka.acikKalemler.map((k) => (
                  <AcikKalemKarti key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} onCevapla={cevapla} calisiyor={calisiyor || aktifKosuVar} />
                ))}
              </div>
            )}

            {/* Akış içi onay adımları (yerel koşu) */}
            {kosu?.adimlar.filter((a) => a.tip === 'onay' && a.previewId && !a.sonuc).map((a) => (
              <YerelOnay key={a.previewId} adim={a} kosu={kosu} kosular={kosular} onBitti={tazele} />
            ))}

            {calisiyor && !raporMetni && kosu?.cevap && (
              <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl px-3.5 py-3 text-[13px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${TEMA.kartKenar}`, color: TEMA.ikincil }}>
                {kosu.cevap}
              </div>
            )}
            {calisiyor && !raporMetni && !kosu?.cevap && (
              <div className="rounded-xl px-3.5 py-6 text-center text-[12.5px]" style={{ background: 'rgba(0,0,0,0.16)', border: `1px dashed ${TEMA.kartKenar}`, color: TEMA.soluk }}>
                Sonuç, iş bitince burada bölümler halinde görünecek.
              </div>
            )}
            {!calisiyor && !raporMetni && !hata && (
              <div className="rounded-xl px-3.5 py-6 text-center text-[12.5px]" style={{ background: 'rgba(0,0,0,0.16)', border: `1px dashed ${TEMA.kartKenar}`, color: TEMA.soluk }}>
                Rapor yok.
              </div>
            )}
            {raporMetni && (
              <>
                {sonBitenPersonel && (
                  <div className="-mb-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: TEMA.ikincil }}>
                    <Avatar kisaltma={ajanKisaltma(sonBitenPersonel.ajanId)} boyut={24} durum={sonBitenPersonel.durum === 'failed' ? 'hata' : 'bos'} /> {ajanTamAd(sonBitenPersonel.ajanId, ajanAd(sonBitenPersonel.ajanId))} raporu
                  </div>
                )}
                <RaporGorunumu rapor={ayrisik?.rapor || raporMetni} />
                {sonBitenPersonel && koordinatorRaporu && (
                  <details className="rounded-xl px-3.5 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${TEMA.kartKenar}` }}>
                    <summary className="cursor-pointer text-[11.5px]" style={{ color: TEMA.ikincil }}>
                      Koordinatör’ün notu
                    </summary>
                    <div className="pt-2">
                      <RaporGorunumu rapor={koordinatorRaporu} kompakt />
                    </div>
                  </details>
                )}
              </>
            )}

            {sorular.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: `${TEMA.turuncu}0f`, border: `1px solid ${TEMA.turuncu}66` }}>
                <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: TEMA.turuncu }}>
                  <HelpCircle size={13} /> {ajanKisaAd(kimde)} soruyor
                </div>
                {sorular.map((s, i) => (
                  <div key={i} className="whitespace-pre-wrap text-[13px]" style={{ color: TEMA.metin }}>
                    {s}
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={cevapMetni}
                    onChange={(e) => setCevapMetni(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cevapMetni.trim()) {
                        e.preventDefault();
                        cevapla(cevapMetni.trim());
                        setCevapMetni('');
                      }
                    }}
                    placeholder="Cevabınızı yazın…"
                    className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-[12.5px] outline-none"
                    style={{ background: TEMA.alanZemin, border: `1px solid ${TEMA.alanKenar}`, color: TEMA.metin }}
                  />
                  <Dugme tur="birincil" disabled={!cevapMetni.trim()} onClick={() => { cevapla(cevapMetni.trim()); setCevapMetni(''); }} title="Görev kutusunu 'Cevap: …' ile doldurur (aynı iş zincirinde)">
                    <MessageSquareReply size={12} /> Cevapla
                  </Dugme>
                </div>
              </div>
            )}

            {kuruListesi.length > 0 && (
              <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${TEMA.kartKenar}` }}>
                <div className="mb-1 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TEMA.turuncu }}>
                  <FlaskConical size={11} /> Kuru test — yapılacaktı ({kuruListesi.length})
                </div>
                <ul className="flex flex-col gap-0.5 text-[12.5px]" style={{ color: TEMA.metin }}>
                  {kuruListesi.map((t, i) => {
                    const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd);
                    return (
                      <li key={i}>
                        {baslik}
                        {ayrinti && <span style={{ color: TEMA.ikincil }}> · {ayrinti}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {ogrenilen.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <GraduationCap size={13} style={{ color: TEMA.mor }} />
                {ogrenilen.map((o, i) => (
                  <span key={i} className="rounded-md px-2 py-0.5 text-[11.5px]" style={{ background: `${TEMA.mor}14`, border: `1px solid ${TEMA.mor}44`, color: TEMA.metin }}>
                    {o}
                  </span>
                ))}
              </div>
            )}

            {!sabahOzetiMi && <CevapAlani calisiyor={calisiyor || aktifKosuVar} kuru={kuru} bekleyen={bekleyenCevap} onGonder={cevapla} onIptal={() => setBekleyenCevap(null)} />}

            {sabahOzetiMi && kosu?.bitti && !kosu.hata && (
              <div className="flex flex-col gap-2">
                <Dugme tur="yesil" disabled={gonderMesgul || gonderTeyit || !!kosular.aktifKosu} onClick={() => setGonderTeyit(true)} title="Koordinatör özeti yeniden üretir ve WhatsApp'a gönderir">
                  {gonderMesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Muzaffer Bey’e WhatsApp gönder
                </Dugme>
                {gonderTeyit && <OnayTeyit metin={<>Numaralarınıza <b>GERÇEK</b> mesaj gidecek — koordinatör özeti <b>yeniden üretir ve gönderir</b> (30-90 sn).</>} mesgul={gonderMesgul} onEvet={sahibeGonder} onVazgec={() => setGonderTeyit(false)} />}
              </div>
            )}

            {(bitti || hata) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: TEMA.soluk }}>
                {(kosu?.model || kokIs?.model) && <span>{String(kosu?.model || kokIs?.model).replace(/^claude-/, '')}</span>}
                <span>{yerelAdimlar.filter((a) => a.tip === 'arac').length} araç çağrısı</span>
                {kokAdim?.isId && <span className="font-mono">iş #{kokAdim.isId.slice(0, 8)}</span>}
                {!kokAdim?.isId && kosu?.isId && <span className="font-mono">iş #{kosu.isId.slice(0, 8)}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </Kart>
  );
}

/** Yerel koşu içinde açılan onay (SSE 'onay' olayı) — kart içi teyitle onayla/reddet. */
function YerelOnay({ adim, kosu, kosular, onBitti }: { adim: Adim; kosu: Kosu; kosular: KosularApi; onBitti: () => void }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const sonucYaz = (sonuc: string) => {
    kosular.guncelle(kosu.ajanId, (k) => ({ ...k, adimlar: k.adimlar.map((a) => (a.previewId === adim.previewId ? { ...a, sonuc } : a)) }));
    onBitti();
  };
  const yap = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMetin: string) => {
    if (mesgul) return;
    setMesgul(true);
    try {
      const r = await fn();
      sonucYaz(r.ok ? okMetin : `Hata: ${r.error || 'olmadı'}`);
    } catch (e: any) {
      sonucYaz(`Hata: ${e?.message || e}`);
    } finally {
      setMesgul(false);
      setTeyit(false);
    }
  };
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: `${TEMA.altin}0f`, border: `1px solid ${TEMA.altin}66` }}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert size={14} style={{ color: TEMA.altin }} />
        <span className="text-[12px] font-semibold" style={{ color: TEMA.altin }}>
          Onayınızı bekliyor · #{adim.previewId}
        </span>
        <span className="min-w-0 flex-1 text-[13px]" style={{ color: TEMA.metin }}>
          {aracAdi(adim.ad)}
        </span>
        <Dugme tur="yesil" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
          <Send size={11} /> Onayla ve gönder
        </Dugme>
        <Dugme tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(adim.previewId!, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
          Reddet
        </Dugme>
      </div>
      {teyit && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{adim.previewId}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(adim.previewId!), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
    </div>
  );
}
