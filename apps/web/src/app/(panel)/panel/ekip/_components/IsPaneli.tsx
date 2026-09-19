'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, Send, MessageSquareReply, RotateCcw, ChevronDown, AlertTriangle, GraduationCap, HelpCircle, FlaskConical, Clock, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, sabahOzetiUret, isZamanAsimi, type CanliAdim, type IsDosyasi, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { AcikKalemKarti, YerelOnay } from './Kararlar';
import { Avatar, Bos, CARD_BORDER, Dugme, GOLD, KIRMIZI, MAVI, MOR, MUTED, OK, ROW_SEP, Rozet, TEXT, TURUNCU } from './Tema';
import { adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, aracAdi, cevapAyristir, gorevSadelestir, kaynakEtiketi, konuKisalt, raporBolumleri, saatKisa, sayacMetni, sureKisa, yokMu, type RaporBolumu } from './ortak';

/** Adım metinlerinde panelin mükellefi tekrar yazılmasın diye adimAciklamasi'ne geçen bağlam. */
type AdimSecenek = { mukellefId?: string | null; mukellefAd?: string | null };

/** Ortak temaya dokunmadan İşler panelinin sade dış yüzeyi. */
function IsKarti({ baslik, mukellef, aciklama, sag, children }: { baslik: ReactNode; mukellef?: string; aciklama: ReactNode; sag: ReactNode; children: ReactNode }) {
  return (
    <section aria-label="İş ayrıntıları" className="relative min-w-0 rounded-[18px] px-4 pb-5 pt-[18px] sm:px-6"
      style={portalStyle({ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.065)', boxShadow: '0 18px 44px rgba(0,0,0,0.24)' })}>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px" style={portalStyle({ background: `linear-gradient(90deg, transparent, ${GOLD}73, transparent)` })} />
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          {mukellef && <div className="mb-1.5 truncate text-[12px]" title={mukellef} style={portalStyle({ color: MUTED })}>{mukellef}</div>}
          <h3 className="break-words text-[22px] font-semibold leading-snug sm:text-[26px]" style={portalStyle({ color: TEXT })}>{baslik}</h3>
          <div className="mt-1 text-[11.5px] leading-relaxed" style={portalStyle({ color: MUTED })}>{aciklama}</div>
        </div>
        {sag}
      </header>
      {children}
    </section>
  );
}

/** Rapor bölümleri kutu yerine ince bir ayırıcıyla okunur. */
function RaporBolum({ baslik, renk = MUTED, className = '', children }: { baslik?: ReactNode; renk?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 py-3 ${className}`} style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
      {baslik && <h5 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em]" style={portalStyle({ color: renk })}>{baslik}</h5>}
      {children}
    </section>
  );
}

/** Sağlayıcı yanıtları ana görünümde sade Türkçe, özgün metin ayrıntılarda kalır. */
function saglayiciOzeti(metin: string): string | null {
  if (/quota|rate.?limit|usage.?limit|insufficient.credit|credit.balance|billing|too many requests|resource.exhausted|429|hit your (?:weekly |monthly |daily )?limit|(?:weekly|monthly|daily)[\s_-]+(?:usage[\s_-]+)?limit|limit reached/i.test(metin))
    return 'Yapay zekâ hizmetinin kullanım sınırına ulaşıldı. Kullanım hakkı açıldığında yeniden deneyin.';
  if (/overloaded|service.unavailable|529|503/i.test(metin))
    return 'Yapay zekâ hizmeti şu anda yanıt veremiyor. Daha sonra yeniden deneyin.';
  if (/unauthorized|authentication|invalid.api.key|401/i.test(metin))
    return 'Yapay zekâ hizmetine erişilemiyor. Bağlantı bilgilerinin kontrol edilmesi gerekiyor.';
  return null;
}

function hataOzeti(metin: string): string {
  return saglayiciOzeti(metin) || 'İş tamamlanamadı. Hata kaydı ayrıntılarda; kontrol ettikten sonra yeniden deneyebilirsiniz.';
}

type BekleyenCevap = { metin: string; vakaId: string; taxpayerId?: string; dryRun: boolean };

/* ─────────────────────────── zaman çizgisi ─────────────────────────── */

/** Zaman çizgisi satırı: saat · avatar · başlık + alt yazı · sağda sonuç. */
function ZamanSatiri({ saat, kisaltma, ton, baslik, alt, sonuc, devir, nabiz, children }: { saat?: string; kisaltma: string; ton: 'gold' | 'mavi' | 'gri' | 'kirmizi'; baslik: ReactNode; alt?: ReactNode; sonuc?: ReactNode; devir?: boolean; nabiz?: boolean; children?: ReactNode }) {
  return (
    <li className="grid min-w-0 grid-cols-[42px_32px_minmax(0,1fr)] items-start gap-x-2 py-1.5 md:grid-cols-[42px_32px_minmax(0,1fr)_minmax(0,180px)]">
      <span className="pt-1.5 text-[11px] tabular-nums" style={portalStyle({ color: MUTED })}>
        {saat || ''}
      </span>
      <span className="pt-0.5">
        <Avatar kisaltma={kisaltma} ton={ton} boyut={26} nabiz={nabiz} />
      </span>
      <span className="min-w-0 pt-0.5">
        <b className="block text-[12.5px] font-semibold" style={portalStyle({ color: TEXT })}>
          {devir && <span style={portalStyle({ color: MAVI })}>→ </span>}
          {baslik}
        </b>
        {alt && (
          <span className="block text-[11.5px]" style={portalStyle({ color: MUTED })}>
            {alt}
          </span>
        )}
        {children}
      </span>
      {sonuc !== undefined && (
        <span className="col-start-3 min-w-0 pt-1 text-[11.5px] md:col-start-auto md:text-right" style={portalStyle({ color: MUTED })}>
          {sonuc}
        </span>
      )}
    </li>
  );
}

/** Yerel koşu adımı → zaman çizgisi satırı. */
function YerelAdim({ adim, mukellefAd, ajanAd, ajanId, secenek, simdi }: { adim: Adim; mukellefAd: (id?: string | null) => string | undefined; ajanAd: (id: string) => string; ajanId: string; secenek?: AdimSecenek; simdi?: number }) {
  const saat = saatKisa(adim.zaman).slice(0, 5);
  const kisaltma = ajanKisaltma(ajanId);
  const ton = ajanId === 'koordinator' ? 'gold' : 'mavi';
  const ajanAdi = ajanTamAd(ajanId, ajanAd(ajanId));
  if (adim.tip === 'arac') {
    const calisiyor = adim.durum === 'calisiyor';
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd, secenek);
    const devir = adim.ad === 'ekip_ajan_baslat';
    const gecen = calisiyor && simdi ? sayacMetni(simdi - adim.zaman) : '';
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={calisiyor ? 'mavi' : ton} baslik={baslik} alt={ajanAdi} sonuc={calisiyor ? <span style={portalStyle({ color: MAVI })}>sürüyor…{gecen ? ` ${gecen}` : ''}</span> : ayrinti} devir={devir} nabiz={calisiyor} />;
  }
  if (adim.tip === 'kuruTest') {
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd, secenek);
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Kuru test — yapılmadı: ${baslik}`} alt={ajanAdi} sonuc={ayrinti} />;
  }
  if (adim.tip === 'red') {
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton="kirmizi" baslik={`Reddedildi: ${aracAdi(adim.ad)}`} alt={adim.neden} />;
  }
  return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Onayınıza sunuldu${adim.previewId ? ` · #${adim.previewId}` : ''}`} alt={aracAdi(adim.ad)} sonuc={adim.sonuc ? <span style={portalStyle({ color: adim.sonuc.startsWith('Hata') ? KIRMIZI : OK })}>{adim.sonuc}</span> : undefined} />;
}

/** Canlı adımın simgesi: sürüyor (dönen) · bitti ✓ · hata ✕ · kuru test (şişe) · onay bekliyor (saat) · reddedildi (yasak). */
function CanliAdimSimgesi({ durum }: { durum: CanliAdim['durum'] }) {
  if (durum === 'suruyor') return <Loader2 size={11} className="flex-shrink-0 animate-spin" style={portalStyle({ color: MAVI })} />;
  if (durum === 'hata') return <X size={11} className="flex-shrink-0" style={portalStyle({ color: KIRMIZI })} />;
  if (durum === 'kuru') return <FlaskConical size={11} className="flex-shrink-0" style={portalStyle({ color: TURUNCU })} />;
  if (durum === 'onay') return <Clock size={11} className="flex-shrink-0" style={portalStyle({ color: GOLD })} />;
  if (durum === 'red') return <Ban size={11} className="flex-shrink-0" style={portalStyle({ color: KIRMIZI })} />;
  return <Check size={11} className="flex-shrink-0" style={portalStyle({ color: OK })} />;
}

/**
 * Koşu sürerken sunucudan gelen canlı adımlar (IsDosyasi.canli, 8 sn'de bir tazelenir): kısa ad + kısa ayrıntı; süren adımda sayaç.
 * (Muzaffer Bey 2026-09-15: "iş devam ederken aşamaları daha açık ama kısa yazsın".)
 */
function CanliAdimlar({ adimlar, simdi, mukellefAd, ajanAd, secenek }: { adimlar: CanliAdim[]; simdi: number; mukellefAd: (id?: string | null) => string | undefined; ajanAd: (id: string) => string; secenek?: AdimSecenek }) {
  return (
    <>
      {adimlar.map((a, i) => {
        const { baslik, ayrinti } = adimAciklamasi(a.ad, a.args, mukellefAd, ajanAd, secenek);
        const suruyor = a.durum === 'suruyor';
        const bas = new Date(a.basladi).getTime();
        const bit = a.bitti ? new Date(a.bitti).getTime() : 0;
        const sureMs = suruyor ? simdi - bas : bit && bas ? bit - bas : 0;
        const sagYazi = suruyor ? `sürüyor · ${sayacMetni(sureMs)}` : a.durum === 'hata' ? 'olmadı' : a.durum === 'kuru' ? 'kuru test — yapılmadı' : a.durum === 'onay' ? 'onayınızda' : a.durum === 'red' ? 'kapalı araç' : sureMs >= 3000 ? sureKisa(sureMs) : '';
        return (
          <div key={`${a.basladi}-${i}`} className="flex min-w-0 items-center gap-2 text-[12px]">
            <CanliAdimSimgesi durum={a.durum} />
            <span className="flex-shrink-0" style={portalStyle({ color: suruyor ? MAVI : a.durum === 'hata' || a.durum === 'red' ? KIRMIZI : TEXT, fontWeight: suruyor ? 600 : 500 })}>
              {baslik}
            </span>
            {ayrinti && (
              <span className="min-w-0 truncate" style={portalStyle({ color: MUTED })}>
                {ayrinti}
              </span>
            )}
            {sagYazi && (
              <span className="ml-auto flex-shrink-0 tabular-nums text-[11px]" style={portalStyle({ color: suruyor ? MAVI : MUTED })}>
                {sagYazi}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Sunucu vakasındaki personel (çocuk) adımı — açılınca araçları getirir; koşarken canlı adımlar; raporu üst bileşene verir. */
function PersonelAdimi({ adim, ajanAd, mukellefAd, acikVarsayilan, onRapor, secenek, simdi }: { adim: VakaAdimIs; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; acikVarsayilan?: boolean; onRapor?: (isId: string, is: IsDosyasi) => void; secenek?: AdimSecenek; simdi: number }) {
  const [acik, setAcik] = useState(!!acikVarsayilan);
  const bitti = adim.durum === 'done' || adim.durum === 'failed';
  const kosuyor = adim.durum === 'running';
  const { data } = useQuery({ queryKey: ['ekip-is', adim.isId], queryFn: () => getIs(adim.isId), enabled: acik || bitti || kosuyor, staleTime: 15_000, retry: 1, refetchInterval: bitti ? false : 8_000 });
  const basMs = adim.baslangic ? new Date(adim.baslangic).getTime() : 0;
  const sure = adim.baslangic && adim.bitis ? sureKisa(new Date(adim.bitis).getTime() - basMs) : kosuyor && basMs ? sayacMetni(simdi - basMs) : '';
  const durumAd = kosuyor ? 'çalışıyor' : adim.durum === 'failed' ? 'yapamadı' : adim.durum === 'done' ? 'bitirdi' : 'sırada';
  const araclar = data?.result?.toolUses || [];
  const canliAdimlar = kosuyor ? data?.canli?.adimlar || [] : [];
  const suAn = canliAdimlar.length ? canliAdimlar[canliAdimlar.length - 1] : null;
  useEffect(() => {
    if (data && onRapor) onRapor(adim.isId, data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ad = ajanTamAd(adim.ajanId, ajanAd(adim.ajanId));
  const gorevOzeti = gorevSadelestir(adim.baslik, secenek?.mukellefAd, 90);
  return (
    <ZamanSatiri
      saat={saatKisa(adim.baslangic).slice(0, 5)}
      kisaltma={ajanKisaltma(adim.ajanId)}
      ton={adim.durum === 'failed' ? 'kirmizi' : kosuyor ? 'mavi' : 'gri'}
      nabiz={kosuyor}
      baslik={`${ad} ${durumAd}`}
      alt={
        kosuyor && suAn ? (
          <>
            <span style={portalStyle({ color: MAVI })}>{suAn.durum === 'suruyor' ? 'şu an' : 'son adım'}: {adimAciklamasi(suAn.ad, suAn.args, mukellefAd, ajanAd, secenek).baslik}</span>
            {gorevOzeti ? ` · ${gorevOzeti}` : ''}
          </>
        ) : (
          gorevOzeti
        )
      }
      sonuc={
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {sure && <span className="tabular-nums" style={portalStyle({ color: kosuyor ? MAVI : MUTED })}>{sure}</span>}
          {!adim.kuru && <Rozet metin="canlı" renk={KIRMIZI} />}
          <button type="button" onClick={() => setAcik((a) => !a)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] hover:bg-white/5" style={portalStyle({ color: MUTED })}>
            {acik ? 'gizle' : 'adımları'} <ChevronDown size={11} className="transition-transform" style={portalStyle({ transform: acik ? 'rotate(180deg)' : 'none' })} />
          </button>
        </span>
      }
    >
      {adim.durum === 'failed' && adim.hata && (
        <div className="mt-1 text-[11.5px]" style={portalStyle({ color: KIRMIZI })}>
          {adim.hata}
        </div>
      )}
      {acik && (
        <div className="mt-2 flex flex-col gap-2 py-2 pl-3" style={portalStyle({ borderLeft: `1px solid ${ROW_SEP}` })}>
          {!data && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={portalStyle({ color: MUTED })}>
              <Loader2 size={11} className="animate-spin" /> adımlar yükleniyor
            </span>
          )}
          {canliAdimlar.length > 0 && <CanliAdimlar adimlar={canliAdimlar} simdi={simdi} mukellefAd={mukellefAd} ajanAd={ajanAd} secenek={secenek} />}
          {!canliAdimlar.length &&
            araclar.map((t, i) => {
              const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd, secenek);
              return (
                <div key={i} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                  <Check size={11} className="flex-shrink-0 self-center" style={portalStyle({ color: OK })} />
                  <span style={portalStyle({ color: TEXT })}>{baslik}</span>
                  {ayrinti && (
                    <span className="min-w-0 truncate" style={portalStyle({ color: MUTED })}>
                      {ayrinti}
                    </span>
                  )}
                </div>
              );
            })}
          {data && !araclar.length && !canliAdimlar.length && kosuyor && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={portalStyle({ color: MUTED })}>
              <Loader2 size={11} className="animate-spin" style={portalStyle({ color: MAVI })} /> {ad} ilk adımı atıyor; adımlar burada yazılacak.
            </span>
          )}
        </div>
      )}
    </ZamanSatiri>
  );
}

/* ─────────────────────────── bulgular ─────────────────────────── */

type BulguSiddet = 'temiz' | 'uyari' | 'karar' | 'bilgi';

/** Bulgu satırı: metin · şiddet (kelimelerden) · tutar (sondaki ₺/TL). */
function bulguAyristir(s: string): { metin: string; siddet: BulguSiddet; tutar: string | null; grup: boolean } {
  const t = s.trim();
  const grup = (/:$/.test(t) && t.length < 60) || (/^[A-ZÇĞİÖŞÜ0-9\s·\-–/()]+$/.test(t) && t.length < 60 && t.length > 3);
  const m = t.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(₺|TL)\b/);
  const tutar = m ? `${m[1]} ₺` : null;
  const siddet: BulguSiddet = /karar|onay[ıi]n[ıi]z|sizde|bekleniyor|bekliyor/i.test(t)
    ? 'karar'
    : /hata|eksik|okunamad|uyuşm|farkl|fark(?!\s*yok)|incele|eşleşme(di|yen)|yarım|bulunamad|tutmuyor|riskl|şüphel|mükerrer/i.test(t)
      ? 'uyari'
      : /fark yok|temiz|tamam|eşleşti|kapandı|doğru|uyumlu|sorunsuz|başarı/i.test(t)
        ? 'temiz'
        : 'bilgi';
  return { metin: t.replace(/:$/, ''), siddet, tutar, grup };
}

const SIDDET: Record<BulguSiddet, { ad: string; renk: string }> = {
  temiz: { ad: 'temiz', renk: OK },
  uyari: { ad: 'dikkat', renk: TURUNCU },
  karar: { ad: 'kararınız', renk: GOLD },
  bilgi: { ad: 'bilgi', renk: MUTED },
};

/** Bulgular tablosu: # · Bulgu · Durum · Tutar; grup başlıkları soluk. */
function BulguTablosu({ satirlar }: { satirlar: string[] }) {
  const ayrisik = satirlar.map(bulguAyristir);
  let no = 0;
  const th = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em]';
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full min-w-[420px]" style={portalStyle({ borderCollapse: 'collapse' })}>
        <thead>
          <tr>
            <th className={th} style={portalStyle({ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 34 })}>#</th>
            <th className={th} style={portalStyle({ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}` })}>Bulgu</th>
            <th className={th} style={portalStyle({ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 96 })}>Durum</th>
            <th className={`${th} text-right`} style={portalStyle({ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 120 })}>Tutar</th>
          </tr>
        </thead>
        <tbody>
          {ayrisik.map((b, i) => {
            if (b.grup)
              return (
                <tr key={i}>
                  <td colSpan={4} className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={portalStyle({ color: GOLD, borderBottom: `1px solid ${ROW_SEP}`, background: `${GOLD}08` })}>
                    {b.metin}
                  </td>
                </tr>
              );
            no += 1;
            const s = SIDDET[b.siddet];
            return (
              <tr key={i}>
                <td className="px-3 py-2 align-top text-[11px] tabular-nums" style={portalStyle({ color: MUTED, borderBottom: `1px solid ${ROW_SEP}` })}>
                  {no}
                </td>
                <td className="whitespace-pre-wrap px-3 py-2 align-top text-[12.5px] leading-relaxed" style={portalStyle({ color: TEXT, borderBottom: `1px solid ${ROW_SEP}` })}>
                  {b.metin}
                </td>
                <td className="px-3 py-2 align-top" style={portalStyle({ borderBottom: `1px solid ${ROW_SEP}` })}>
                  <Rozet metin={s.ad} renk={s.renk} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top text-[12.5px] font-medium tabular-nums" style={portalStyle({ color: GOLD, borderBottom: `1px solid ${ROW_SEP}` })}>
                  {b.tutar || ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BOLUM_BASLIK: Partial<Record<RaporBolumu['anahtar'], string>> = { yaptigim: 'Yaptığı iş', kaynaklar: 'Baktığı kaynaklar', kimde: 'Kime döndü', devir: 'Devir' };

/**
 * Rapor görünümü: Bulgular → tablo; Emin olmadığı / Sizden istenen / Onayınızı bekleyen → altın vurgulu satır;
 * Yaptığı iş / Baktığı kaynaklar / Kime döndü / Devir → ince çizgilerle ayrılan bölümler. Bölümsüz rapor → düz metin.
 */
export function RaporGorunumu({ rapor, kompakt = false }: { rapor: string; kompakt?: boolean }) {
  const bolumler = useMemo(() => raporBolumleri(rapor), [rapor]);
  if (!bolumler.length) return null;
  const bul = (a: RaporBolumu['anahtar']) => bolumler.find((b) => b.anahtar === a);
  const dolu = (b?: RaporBolumu) => !!b && !(b.satirlar.length === 1 && yokMu(b.satirlar[0])) && b.satirlar.length > 0;
  const bulgular = bul('bulgular');
  const diger = bul('diger');
  const vurgulu = (['emin', 'istek', 'onay'] as const).map(bul).filter(dolu) as RaporBolumu[];
  const ayrinti = (['yaptigim', 'kaynaklar', 'kimde', 'devir'] as const).map(bul).filter(dolu) as RaporBolumu[];
  if (kompakt) {
    return (
      <div className="text-[12px] leading-relaxed" style={portalStyle({ color: MUTED })}>
        {[...ayrinti, ...(dolu(bulgular) ? [bulgular!] : []), ...(diger ? [diger] : [])].map((b) => `${b.baslik}: ${b.satirlar.join(' ')}`).join(' — ')}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      {ayrinti.length > 0 && (
        <div className="grid gap-x-5 md:grid-cols-2">
          {ayrinti.map((b) => (
            <RaporBolum key={b.anahtar} baslik={BOLUM_BASLIK[b.anahtar] || b.baslik} className={b.anahtar === 'yaptigim' ? 'md:col-span-2' : ''}>
              <ul className="flex flex-col gap-1 text-[12.5px] leading-relaxed" style={portalStyle({ color: TEXT })}>
                {b.satirlar.map((s, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {s}
                  </li>
                ))}
              </ul>
            </RaporBolum>
          ))}
        </div>
      )}
      {dolu(bulgular) && (
        <RaporBolum baslik="Bulgular">
          <BulguTablosu satirlar={bulgular!.satirlar} />
        </RaporBolum>
      )}
      {bulgular && !dolu(bulgular) && (
        <RaporBolum baslik="Bulgular">
          <span className="text-[12.5px]" style={portalStyle({ color: MUTED })}>
            Bulgu yok.
          </span>
        </RaporBolum>
      )}
      {diger && (
        <RaporBolum>
          <div className="whitespace-pre-wrap text-[12.8px] leading-relaxed" style={portalStyle({ color: TEXT })}>
            {diger.satirlar.join('\n')}
          </div>
        </RaporBolum>
      )}
      {vurgulu.map((b) => (
        <RaporBolum key={b.anahtar} baslik={b.baslik} renk={GOLD}>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={portalStyle({ color: TEXT })}>{b.satirlar.join(' · ')}</p>
        </RaporBolum>
      ))}
    </div>
  );
}

/* ─────────────────────────── cevap kutusu ─────────────────────────── */

/** Cevap / talimat kutusu: koşu sürüyorsa kuyruğa alınır, bitince Koordinatör'e gider. */
function CevapKutusu({ calisiyor, bekleyen, onGonder, onIptal }: { calisiyor: boolean; bekleyen: string | null; onGonder: (metin: string) => boolean; onIptal: () => void }) {
  const [metin, setMetin] = useState('');
  const gonder = () => {
    if (!metin.trim()) return;
    if (onGonder(metin.trim())) setMetin('');
  };
  return (
    <div className="flex flex-col gap-2">
      {bekleyen && (
        <div className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px]" style={portalStyle({ background: `${MAVI}12`, border: `1px solid ${MAVI}40`, color: TEXT })}>
          <Loader2 size={12} className="flex-shrink-0 animate-spin" style={portalStyle({ color: MAVI })} />
          <span className="min-w-0 flex-1 truncate">
            Bitince gidecek: <i>{bekleyen}</i>
          </span>
          <button type="button" onClick={onIptal} className="rounded p-0.5 hover:bg-white/10" title="Vazgeç">
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="İş için not veya talimat"
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              gonder();
            }
          }}
          placeholder={calisiyor ? 'Bu işe not / talimat — koşu bitince Koordinatör’e gider' : 'Bu işe not / talimat — Koordinatör aynı işte devam eder'}
          className="h-9 min-w-0 flex-1 rounded-[10px] px-3 text-[12.5px] outline-none"
          style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}`, color: TEXT })}
        />
        <Dugme disabled={!metin.trim()} onClick={gonder}>
          <Send size={12} /> {calisiyor ? 'Bitince gönder' : 'Gönder'}
        </Dugme>
      </div>
    </div>
  );
}

/* ─────────────────────────── ana panel ─────────────────────────── */

/**
 * İş paneli: görev, gerçek durum, gereken karar ve sonuç ön planda.
 * Teknik kayıtlar başlangıçta kapalı; alt iş sorguları kapalıyken de güncellenir.
 * Kaynak: yerel koşu (SSE, Koordinatör) ve/veya sunucu vakası (personel adımları, açık kalemler, geçmiş işler).
 */
export function IsPaneli({ kosu, vaka, kosular, ajanAd, mukellefAd, onTaslak, onKapat }: { kosu?: Kosu; vaka?: Vaka; kosular: KosularApi; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void; onKapat?: () => void }) {
  const qc = useQueryClient();
  const [simdi, setSimdi] = useState(() => Date.now());
  const [cevapMetni, setCevapMetni] = useState('');
  const [durduruluyor, setDurduruluyor] = useState(false);
  const [gonderTeyit, setGonderTeyit] = useState(false);
  const [gonderMesgul, setGonderMesgul] = useState(false);
  const [acikAyrintiId, setAcikAyrintiId] = useState<string | null>(null);

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

  const yerelCevapBos = !!kosu?.bitti && (!kosu.cevap || kosu.cevap === '(boş yanıt)');
  const kokGetirilsin = !!kokAdim?.isId && (!kosu || yerelCevapBos);
  const kokS = useQuery({ queryKey: ['ekip-is', kokAdim?.isId], queryFn: () => getIs(kokAdim!.isId), enabled: kokGetirilsin, staleTime: 15_000, retry: 1, refetchInterval: sunucuCalisiyor ? 8_000 : false });
  const kokIs: IsDosyasi | undefined = kokS.data;

  // Kök koşu bu sekmede başlatılmadıysa (başka sekme / WhatsApp / ses): bitmişse result.toolUses, sürüyorsa sunucunun canlı adımları
  const yerelAdimlar: Adim[] = kosu
    ? kosu.adimlar
    : kokIs?.canli?.adimlar?.length && kokIs.status === 'running'
      ? kokIs.canli.adimlar.map((a): Adim => {
          const zaman = new Date(a.basladi).getTime() || Date.now();
          if (a.durum === 'kuru') return { tip: 'kuruTest', ad: a.ad, args: a.args, zaman };
          if (a.durum === 'red') return { tip: 'red', ad: a.ad, neden: 'kapalı araç', zaman };
          if (a.durum === 'onay') return { tip: 'onay', ad: a.ad, args: a.args, zaman };
          return { tip: 'arac', ad: a.ad, args: a.args, zaman, durum: a.durum === 'suruyor' ? 'calisiyor' : 'bitti' };
        })
      : (kokIs?.result?.toolUses || []).map((t, i) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: kokIs?.startedAt ? new Date(kokIs.startedAt).getTime() + i : Date.now(), durum: 'bitti' as const }));
  const koordinatorRaporu = (kosu?.bitti && !yerelCevapBos ? kosu.cevap : '') || kokIs?.result?.rapor || kokAdim?.raporOzet || '';

  const [personelRaporlari, setPersonelRaporlari] = useState<Record<string, IsDosyasi>>({});
  const personelRaporAl = useCallback((isId: string, is: IsDosyasi) => setPersonelRaporlari((p) => (p[isId] === is ? p : { ...p, [isId]: is })), []);
  const sonBitenPersonel = [...personelAdimlari].reverse().find((a) => a.durum === 'done' || a.durum === 'failed');
  const sonucIsi: IsDosyasi | undefined = sonBitenPersonel ? personelRaporlari[sonBitenPersonel.isId] : undefined;
  const sonucRaporu = sonBitenPersonel ? sonucIsi?.result?.rapor || sonBitenPersonel.raporOzet || '' : koordinatorRaporu;
  const hataliPersonel = personelAdimlari.find((a) => a.durum === 'failed' || personelRaporlari[a.isId]?.status === 'failed' || personelRaporlari[a.isId]?.hata);
  const hata = kosu?.hata || kokIs?.hata
    || (kokAdim?.durum === 'failed' ? kokAdim.hata || 'İş tamamlanamadı.' : '')
    || (hataliPersonel ? hataliPersonel.hata || personelRaporlari[hataliPersonel.isId]?.hata || 'Alt iş tamamlanamadı.' : '')
    || (vaka?.durum === 'hata' ? 'İş tamamlanamadı.' : '')
    || (saglayiciOzeti(sonucRaporu) ? sonucRaporu : '');
  const raporMetni = saglayiciOzeti(sonucRaporu) ? '' : sonucRaporu;
  const ayrisik = useMemo(() => (raporMetni ? cevapAyristir(raporMetni) : null), [raporMetni]);
  const ogrenilen = sonBitenPersonel ? sonucIsi?.result?.ogrenilen || [] : kosu?.bitti && !yerelCevapBos ? ayrisik?.ogrenilen || [] : kokIs?.result?.ogrenilen || [];
  const sorular = ayrisik?.sorular || [];
  const kuruListesi = sonBitenPersonel ? sonucIsi?.result?.kuruTestYapilacaktilar || [] : kokIs?.result?.kuruTestYapilacaktilar || [];
  const bitti = kosu ? kosu.bitti : !sunucuCalisiyor && !!kokAdim && kokAdim.durum !== 'running';
  const basladi = kosu?.basladi ?? (kokAdim?.baslangic ? new Date(kokAdim.baslangic).getTime() : vaka ? new Date(vaka.olusturuldu).getTime() : Date.now());
  const toplamSureMs = kosu?.durationMs ?? kokIs?.durationMs ?? (kokAdim?.baslangic && kokAdim?.bitis ? new Date(kokAdim.bitis).getTime() - new Date(kokAdim.baslangic).getTime() : null);
  const sonBitis = isAdimlari.map((a) => (a.bitis ? new Date(a.bitis).getTime() : 0)).reduce((m, t) => Math.max(m, t), 0);
  const zincirSureMs = sonBitis > basladi ? sonBitis - basladi : toplamSureMs;
  const sureMetni = calisiyor ? sayacMetni(simdi - basladi) : sureKisa(zincirSureMs);
  const kimde = vaka?.kimde.ajanId || kosu?.ajanId || 'koordinator';
  const konu = vaka?.konu || konuKisalt(kosu?.gorev || '', 110);
  const mukellef = vaka?.mukellef?.ad || mukellefAd(kosu?.taxpayerId);
  /** Adım metinlerinde panelin mükellefi tekrar yazılmaz (başlıkta var). */
  const secenek: AdimSecenek = { mukellefId: vaka?.mukellef?.id || kosu?.taxpayerId || null, mukellefAd: mukellef || null };
  const kuru = kosu ? kosu.dryRun : vaka ? vaka.kuru : kokIs ? kokIs.dryRun : true;
  const kaynak = kosu?.kaynak === 'sabahOzeti' ? { ad: 'sabah özeti', ikon: '' } : kaynakEtiketi(kokIs?.kaynak || null);
  const sabahOzetiMi = kosu?.kaynak === 'sabahOzeti';
  const durduruldu = hata === DURDURULDU_METNI;
  const durumAd = hata ? (durduruldu ? 'Durduruldu' : calisiyor ? 'Sorun var · çalışma sürüyor' : 'Yarım kaldı') : calisiyor ? 'Sürüyor' : bitti ? 'Tamamlandı' : 'Bekliyor';

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
          else toast.error('Durdurulamadı', { description: r.error ? hataOzeti(r.error) : 'İptal işlemi doğrulanamadı.' });
        }
      }
    } finally {
      setDurduruluyor(false);
      tazele();
    }
  };

  const { bekleyenCevap, setBekleyenCevap } = kosular;
  const cevapGonderSimdi = useCallback((cevap: BekleyenCevap) => {
    void kosular.baslat('koordinator', { gorev: `Cevap: ${cevap.metin}`, taxpayerId: cevap.taxpayerId, dryRun: cevap.dryRun, vakaId: cevap.vakaId });
  }, [kosular]);
  const cevapla = (metin: string) => {
    if (!kokIsId) {
      toast.error('İş kaydı henüz oluşmadı. Kısa süre sonra tekrar gönderin.');
      return false;
    }
    if (calisiyor && !kosular.aktifKosu) {
      toast.error('İş sunucuda hâlâ çalışıyor. Cevabınız korunuyor; iş bitince gönderin.');
      return false;
    }
    if (bekleyenCevap) {
      toast.error('Sırada bir cevap var. Yeni cevap için önce onu gönderin veya iptal edin.');
      return false;
    }
    const cevap: BekleyenCevap = { metin, vakaId: kokIsId, taxpayerId: vaka?.mukellef?.id || kosu?.taxpayerId || undefined, dryRun: kuru };
    if (kosular.aktifKosu) setBekleyenCevap(cevap);
    else cevapGonderSimdi(cevap);
    return true;
  };
  const aktifKosuVar = !!kosular.aktifKosu;
  useEffect(() => {
    setCevapMetni('');
    setGonderTeyit(false);
  }, [kokIsId]);
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
      if (r.hata) toast.error(hataOzeti(r.hata));
      else if (r.gonderildi) toast.success(`Sabah özeti ${r.gonderildi} numaraya gönderildi`);
      else toast.error('Sabah özeti hazırlandı ancak gönderim doğrulanamadı.');
    } catch (e: any) {
      const h = isZamanAsimi(e) ? 'Sürüyor — iş kayıtlarında görünecek' : e?.message || 'Gönderilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata: h, durationMs: Date.now() - b }));
      toast.error(isZamanAsimi(e) ? h : hataOzeti(h));
    } finally {
      setGonderMesgul(false);
      setGonderTeyit(false);
      tazele();
    }
  };

  const calisanAdim = yerelAdimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
  const calisanPersonel = personelAdimlari.find((a) => a.durum === 'running');
  // Personelin canlı adımı (PersonelAdimi'nin 8 sn'lik sorgusundan onRapor ile gelir): "Beyanname: Luca çekimi başlatıldı · 01:12"
  const calisanPersonelCanli = calisanPersonel ? personelRaporlari[calisanPersonel.isId]?.canli?.adimlar : undefined;
  const sonCanliAdim = calisanPersonelCanli?.length ? calisanPersonelCanli[calisanPersonelCanli.length - 1] : null;
  const suAnMetni = calisiyor
    ? calisanAdim
      ? `Koordinatör: ${adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd, secenek).baslik}${calisanAdim.zaman ? ` · ${sayacMetni(simdi - calisanAdim.zaman)}` : ''}`
      : calisanPersonel
        ? sonCanliAdim
          ? `${ajanKisaAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))}: ${adimAciklamasi(sonCanliAdim.ad, sonCanliAdim.args, mukellefAd, ajanAd, secenek).baslik}${sonCanliAdim.durum === 'suruyor' ? ` · ${sayacMetni(simdi - new Date(sonCanliAdim.basladi).getTime())}` : sonCanliAdim.durum === 'hata' ? ' · son adım tamamlanamadı' : ' · son kayıt'}`
          : `${ajanTamAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))} çalışıyor — ${gorevSadelestir(calisanPersonel.baslik, mukellef, 80)}`
        : kosu && !kosu.isId
          ? 'Koordinatör göreve başlıyor'
          : 'Koordinatör düşünüyor'
    : '';
  const bildirimAdimlari = (vaka?.adimlar || []).filter((a): a is Exclude<VakaAdim, VakaAdimIs> => a.tip !== 'is' && !(a.tip === 'bildirim' && a.tur === 'bilgi' && /^İŞ ATAMASI/i.test(a.baslik)));
  const acikKalemler = vaka?.acikKalemler || [];
  const yerelOnaylar = kosu?.adimlar.filter((a) => a.tip === 'onay' && a.previewId && !a.sonuc) || [];
  // Kararlar kendi bölümünde; Sonuç bölümü yalnız rapor/kuru liste/öğrenilen ya da biten sabah özeti varsa
  const sonucVar = !!raporMetni || kuruListesi.length > 0 || ogrenilen.length > 0 || (sabahOzetiMi && !!kosu?.bitti) || (bitti && !hata && !sabahOzetiMi);
  const kararBekliyor = acikKalemler.length > 0 || yerelOnaylar.length > 0 || sorular.length > 0;
  const baslikMetni = sabahOzetiMi ? (calisiyor ? 'Sabah özeti üretiliyor' : 'Sabah özeti') : gorevSadelestir(vaka?.konu || kosu?.gorev || konu, mukellef, 72) || 'İş';
  const adimToplam = yerelAdimlar.length + personelAdimlari.length + bildirimAdimlari.length;
  const ayrintiId = kokIsId || String(kosu?.basladi || 'is');
  const adimlarGoster = acikAyrintiId === ayrintiId;
  const durumRenk = hata ? KIRMIZI : kararBekliyor ? GOLD : calisiyor ? MAVI : bitti ? OK : MUTED;

  const durumSatiri = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <b className="font-semibold" style={portalStyle({ color: durumRenk })}>
        {hata ? durumAd : kararBekliyor ? 'Cevabınız / onayınız bekleniyor' : durumAd}
      </b>
      {sureMetni && <span className="tabular-nums">· {sureMetni}</span>}
      <span>· {kuru ? 'Deneme · işlem uygulanmaz' : 'Gerçek işlem'}</span>
    </span>
  );

  return (
    <IsKarti
      baslik={<span title={vaka?.konu || kosu?.gorev || baslikMetni}>{baslikMetni}</span>}
      mukellef={mukellef}
      aciklama={durumSatiri}
      sag={
        <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
          {calisiyor && !sabahOzetiMi && (
            <Dugme tur="tehlike" onClick={durdur} disabled={durduruluyor}>
              {durduruluyor ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />} Durdur
            </Dugme>
          )}
          {!calisiyor && !sabahOzetiMi && (
            <Dugme onClick={tekrar}>
              <RotateCcw size={12} /> Tekrar
            </Dugme>
          )}
          {!calisiyor && onKapat && (
            <Dugme tur="sade" onClick={onKapat}>
              Kapat
            </Dugme>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {calisiyor && (
          <div role="status" className="flex items-center gap-3 rounded-xl px-4 py-3 text-[14px]" style={portalStyle({ background: `${GOLD}09`, border: `1px solid ${GOLD}25`, color: TEXT })}>
            <Loader2 size={16} className="flex-shrink-0 animate-spin" style={portalStyle({ color: GOLD })} />
            <span>{saglayiciOzeti(suAnMetni) || suAnMetni}</span>
          </div>
        )}

        {hata && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={portalStyle({ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}59`, color: TEXT })}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={portalStyle({ color: KIRMIZI })} />
            <span>{durduruldu ? 'İş durduruldu.' : hataOzeti(hata)}</span>
          </div>
        )}

        {/* Kararınız */}
        {(acikKalemler.length > 0 || yerelOnaylar.length > 0 || sorular.length > 0) && (
          <section className="pt-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
            <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={portalStyle({ color: GOLD })}>
              Sizden beklenen · {acikKalemler.length + yerelOnaylar.length + (sorular.length ? 1 : 0)}
            </h4>
            {acikKalemler.map((k) => (
              <AcikKalemKarti key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} onCevapla={cevapla} calisiyor={calisiyor || aktifKosuVar} />
            ))}
            {kosu && yerelOnaylar.map((a) => <YerelOnay key={a.previewId} adim={a} kosu={kosu} kosular={kosular} onBitti={tazele} />)}
            {sorular.length > 0 && (
              <div className="py-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
                <div className="flex items-center gap-2 text-[12.8px] font-semibold" style={portalStyle({ color: TEXT })}>
                  <HelpCircle size={14} style={portalStyle({ color: GOLD })} /> {ajanKisaAd(kimde)} soruyor
                </div>
                {sorular.map((s, i) => (
                  <div key={i} className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed" style={portalStyle({ color: MUTED })}>
                    {s}
                  </div>
                ))}
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    aria-label="İş için cevabınız"
                    value={cevapMetni}
                    onChange={(e) => setCevapMetni(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cevapMetni.trim()) {
                        e.preventDefault();
                        if (cevapla(cevapMetni.trim())) setCevapMetni('');
                      }
                    }}
                    placeholder="Cevabınızı yazın…"
                    className="h-9 min-w-0 flex-1 rounded-[10px] px-3 text-[12.5px] outline-none"
                    style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}`, color: TEXT })}
                  />
                  <Dugme tur="birincil" disabled={!cevapMetni.trim()} onClick={() => { if (cevapla(cevapMetni.trim())) setCevapMetni(''); }}>
                    <MessageSquareReply size={13} /> Cevapla
                  </Dugme>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Sonuç */}
        {(sonucVar || (calisiyor && !!kosu?.cevap)) && (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={portalStyle({ color: MUTED })}>
                {sonBitenPersonel ? `Sonuç · ${ajanTamAd(sonBitenPersonel.ajanId, ajanAd(sonBitenPersonel.ajanId))}` : sabahOzetiMi ? 'Sabah özeti' : 'Sonuç · Koordinatör'}
              </h4>
              <span className="text-[11px] tabular-nums" style={portalStyle({ color: MUTED })}>
                {kokS.isLoading && !kokIs ? 'yükleniyor…' : `${sonBitis ? saatKisa(sonBitis).slice(0, 5) : saatKisa(basladi).slice(0, 5)} · ${kuru ? 'kuru test' : 'canlı'}`}
              </span>
            </div>
            {calisiyor && !raporMetni && kosu?.cevap && (
              <RaporBolum>
                <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[12.8px] leading-relaxed" style={portalStyle({ color: MUTED })}>
                  {saglayiciOzeti(kosu.cevap) || kosu.cevap}
                </div>
              </RaporBolum>
            )}
            {raporMetni && (
              <>
                <RaporGorunumu rapor={ayrisik?.rapor || raporMetni} />
                {sonBitenPersonel && koordinatorRaporu && (
                  <details className="mt-2 py-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
                    <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em]" style={portalStyle({ color: MUTED })}>
                      Koordinatör’ün notu
                    </summary>
                    <div className="pt-2">
                      <RaporGorunumu rapor={koordinatorRaporu} kompakt />
                    </div>
                  </details>
                )}
              </>
            )}
            {!raporMetni && !calisiyor && !hata && <Bos metin="Rapor yok." />}
            {kuruListesi.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12px]" style={portalStyle({ color: MUTED })}>Deneme ayrıntıları · {kuruListesi.length} işlem</summary>
              <RaporBolum baslik={<span className="inline-flex items-center gap-1.5"><FlaskConical size={11} /> Kuru test — yapılacaktı ({kuruListesi.length})</span>} renk={TURUNCU} className="mt-3">
                <ul className="flex flex-col gap-1 text-[12.5px]" style={portalStyle({ color: TEXT })}>
                  {kuruListesi.map((t, i) => {
                    const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd, secenek);
                    return (
                      <li key={i} className="flex gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full" style={portalStyle({ background: TURUNCU })} />
                        <span>
                          {baslik}
                          {ayrinti && <span style={portalStyle({ color: MUTED })}> · {ayrinti}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </RaporBolum>
              </details>
            )}
            {ogrenilen.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <GraduationCap size={13} style={portalStyle({ color: MOR })} />
                {ogrenilen.map((o, i) => (
                  <Rozet key={i} metin={o} renk={MOR} />
                ))}
              </div>
            )}
            {sabahOzetiMi && kosu?.bitti && !hata && (
              <div className="mt-3 flex flex-col gap-2">
                <div>
                  <Dugme tur="birincil" renk={OK} disabled={gonderMesgul || gonderTeyit || !!kosular.aktifKosu} onClick={() => setGonderTeyit(true)}>
                    {gonderMesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Muzaffer Bey’e WhatsApp gönder
                  </Dugme>
                </div>
                {gonderTeyit && <OnayTeyit metin={<>Numaralarınıza <b>GERÇEK</b> mesaj gidecek — koordinatör özeti <b>yeniden üretir ve gönderir</b> (30-90 sn).</>} mesgul={gonderMesgul} onEvet={sahibeGonder} onVazgec={() => setGonderTeyit(false)} />}
              </div>
            )}
            {!acikKalemler.length && !yerelOnaylar.length && !sorular.length && bitti && !calisiyor && !hata && !sabahOzetiMi && (
              <div className="mt-3 flex items-center gap-2 text-[12px]" style={portalStyle({ color: MUTED })}>
                <Check size={12} style={portalStyle({ color: OK })} /> İş tamamlandı. Sizden beklenen başka bir işlem yok.
              </div>
            )}
          </section>
        )}

        {/* Adımlar */}
        <section className="pt-3" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
          <button type="button" aria-expanded={adimlarGoster} onClick={() => setAcikAyrintiId(adimlarGoster ? null : ayrintiId)} className="mb-1 flex w-full items-center justify-between text-left">
            <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={portalStyle({ color: MUTED })}>
              Ayrıntılar · {adimToplam} kayıt
            </h4>
            <span className="inline-flex items-center gap-1 text-[11px]" style={portalStyle({ color: MUTED })}>
              {adimlarGoster ? 'gizle' : 'göster'} <ChevronDown size={11} className="transition-transform" style={portalStyle({ transform: adimlarGoster ? 'rotate(180deg)' : 'none' })} />
            </span>
          </button>
          <div hidden={!adimlarGoster}>
            <div className="py-3 text-[12px]" style={portalStyle({ color: MUTED })}>
              Başlangıç: {saatKisa(basladi)} · Kaynak: {kaynak.ad}
              {(kosu?.model || kokIs?.model) && <span> · Model: {kosu?.model || kokIs?.model}</span>}
            </div>
            {hata && <pre className="mb-3 whitespace-pre-wrap break-words text-[12px]" style={portalStyle({ color: KIRMIZI })}>{hata}</pre>}
            <ol className="flex max-h-[520px] min-w-0 flex-col overflow-y-auto [scrollbar-width:thin]" style={portalStyle({ borderTop: `1px solid ${ROW_SEP}` })}>
              {!yerelAdimlar.length && !personelAdimlari.length && !bildirimAdimlari.length && (
                <li className="py-3 text-[12px]" style={portalStyle({ color: MUTED })}>
                  {calisiyor ? 'İlk adım bekleniyor…' : 'Adım kaydı yok.'}
                </li>
              )}
              {yerelAdimlar.map((a, i) => (
                <YerelAdim key={`${a.zaman}-${i}`} adim={a} mukellefAd={mukellefAd} ajanAd={ajanAd} ajanId={kosu?.ajanId || kokAdim?.ajanId || 'koordinator'} secenek={secenek} simdi={simdi} />
              ))}
              {personelAdimlari.map((a) => (
                <PersonelAdimi key={a.isId} adim={a} ajanAd={ajanAd} mukellefAd={mukellefAd} onRapor={personelRaporAl} secenek={secenek} simdi={simdi} />
              ))}
              {bildirimAdimlari.map((a, i) =>
                a.tip === 'onay' ? (
                  <ZamanSatiri key={`onay-${a.id}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma={ajanKisaltma(a.ajanId)} ton={a.durum === 'PENDING' ? 'gold' : 'gri'} baslik={`Onay kaydı #PRV-${a.id.slice(0, 8)}`} alt={`${a.durum === 'EXECUTED' ? 'gönderildi' : a.durum === 'PENDING' ? 'onay bekliyor' : a.durum === 'REJECTED' ? 'reddedildi' : a.durum === 'EXPIRED' ? 'süresi doldu' : a.durum}${a.baslik ? ` · ${a.baslik}` : ''}`} />
                ) : (
                  <ZamanSatiri key={`not-${a.id || i}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma="MB" ton="gold" baslik={a.tur === 'istek' ? 'Sizden istendi' : a.tur === 'onay' ? 'Onayınıza sunuldu' : 'Koordinatör notu'} alt={`${a.baslik}${a.durum === 'kapandi' ? ' · kapandı' : ''}`}>
                    {a.govde && (
                      <div className="mt-0.5 whitespace-pre-wrap text-[11.5px]" style={portalStyle({ color: MUTED })}>
                        {a.govde}
                      </div>
                    )}
                  </ZamanSatiri>
                ),
              )}
            </ol>
          </div>
        </section>

        {/* Not / talimat */}
        {!sabahOzetiMi && (
          <section style={portalStyle({ borderTop: `1px solid ${ROW_SEP}`, paddingTop: 12 })}>
            <CevapKutusu key={kokIsId || kosu?.basladi} calisiyor={calisiyor || aktifKosuVar} bekleyen={bekleyenCevap ? `${bekleyenCevap.vakaId === kokIsId ? "Bu iş" : "Önceki seçili iş"}: ${bekleyenCevap.metin}` : null} onGonder={cevapla} onIptal={() => setBekleyenCevap(null)} />
          </section>
        )}
      </div>
    </IsKarti>
  );
}
