'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, Send, MessageSquareReply, RotateCcw, ChevronDown, AlertTriangle, GraduationCap, HelpCircle, FlaskConical, Clock, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, sabahOzetiUret, isZamanAsimi, type CanliAdim, type IsDosyasi, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { AcikKalemKarti, YerelOnay } from './Kararlar';
import { Avatar, Bos, CARD_BORDER, Dugme, GOLD, IcKutu, Ilerleme, KIRMIZI, Kutu, MAVI, MOR, MUTED, OK, ROW_SEP, Rozet, TEXT, TURUNCU } from './Tema';
import { adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, aracAdi, cevapAyristir, gorevSadelestir, kaynakEtiketi, konuKisalt, raporBolumleri, saatKisa, sayacMetni, sureKisa, yokMu, type RaporBolumu } from './ortak';

/** Adım metinlerinde panelin mükellefi tekrar yazılmasın diye adimAciklamasi'ne geçen bağlam. */
type AdimSecenek = { mukellefId?: string | null; mukellefAd?: string | null };

/* ─────────────────────────── aşamalar ─────────────────────────── */

type Asama = { ad: string; durum: 'bitti' | 'aktif' | 'bekliyor' | 'hata' };

/** Aşama listesi: Görev alındı → Bilgi toplandı → (Personelde) → Sonuç. */
function asamalar(p: { basladi: boolean; aracVar: boolean; personelVar: boolean; personelBitti: boolean; bitti: boolean; hata: boolean }): Asama[] {
  const liste: Asama[] = [];
  liste.push({ ad: 'Görev alındı', durum: p.basladi ? 'bitti' : 'aktif' });
  liste.push({ ad: 'Bilgi toplandı', durum: p.bitti || p.personelVar ? 'bitti' : p.aracVar ? 'aktif' : p.basladi ? 'aktif' : 'bekliyor' });
  if (p.personelVar) liste.push({ ad: 'Personelde', durum: p.personelBitti ? 'bitti' : 'aktif' });
  liste.push({ ad: 'Sonuç', durum: p.hata ? 'hata' : p.bitti && (!p.personelVar || p.personelBitti) ? 'bitti' : 'bekliyor' });
  return liste;
}

/** Aşama çizgisi: ✓ biten (yeşil) · ● süren (mavi) · ○ bekleyen · ✕ hata. */
function AsamaCizgisi({ liste, zamanlar }: { liste: Asama[]; zamanlar: Array<string | undefined> }) {
  return (
    <div className="flex flex-wrap items-center gap-y-1 text-[11.5px]">
      {liste.map((a, i) => {
        const renk = a.durum === 'bitti' ? OK : a.durum === 'aktif' ? MAVI : a.durum === 'hata' ? KIRMIZI : MUTED;
        return (
          <span key={a.ad} className="inline-flex items-center">
            {i > 0 && <span className="mx-2 h-px w-5" style={{ background: ROW_SEP }} />}
            <span className="inline-flex items-center gap-1.5" style={{ color: a.durum === 'bekliyor' ? MUTED : renk, fontWeight: a.durum === 'aktif' ? 600 : 500 }} title={zamanlar[i] ? `${a.ad} · ${zamanlar[i]}` : a.ad}>
              {a.durum === 'bitti' ? <Check size={11} /> : a.durum === 'hata' ? <X size={11} /> : <span className={`inline-block h-[7px] w-[7px] rounded-full ${a.durum === 'aktif' ? 'animate-pulse' : ''}`} style={{ background: a.durum === 'aktif' ? MAVI : 'transparent', border: `1px solid ${a.durum === 'aktif' ? MAVI : MUTED}` }} />}
              {a.ad}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── zaman çizgisi ─────────────────────────── */

/** Zaman çizgisi satırı: saat · avatar · başlık + alt yazı · sağda sonuç. */
function ZamanSatiri({ saat, kisaltma, ton, baslik, alt, sonuc, devir, nabiz, children }: { saat?: string; kisaltma: string; ton: 'gold' | 'mavi' | 'gri' | 'kirmizi'; baslik: ReactNode; alt?: ReactNode; sonuc?: ReactNode; devir?: boolean; nabiz?: boolean; children?: ReactNode }) {
  return (
    <li className="grid min-w-0 grid-cols-[42px_32px_minmax(0,1fr)] items-start gap-x-2 py-1.5 md:grid-cols-[42px_32px_minmax(0,1fr)_minmax(0,180px)]">
      <span className="pt-1.5 text-[11px] tabular-nums" style={{ color: MUTED }}>
        {saat || ''}
      </span>
      <span className="pt-0.5">
        <Avatar kisaltma={kisaltma} ton={ton} boyut={26} nabiz={nabiz} />
      </span>
      <span className="min-w-0 pt-0.5">
        <b className="block text-[12.5px] font-semibold" style={{ color: TEXT }}>
          {devir && <span style={{ color: MAVI }}>→ </span>}
          {baslik}
        </b>
        {alt && (
          <span className="block text-[11.5px]" style={{ color: MUTED }}>
            {alt}
          </span>
        )}
        {children}
      </span>
      {sonuc !== undefined && (
        <span className="hidden min-w-0 pt-1 text-right text-[11.5px] md:block" style={{ color: MUTED }}>
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
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={calisiyor ? 'mavi' : ton} baslik={baslik} alt={ajanAdi} sonuc={calisiyor ? <span style={{ color: MAVI }}>sürüyor…{gecen ? ` ${gecen}` : ''}</span> : ayrinti} devir={devir} nabiz={calisiyor} />;
  }
  if (adim.tip === 'kuruTest') {
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd, secenek);
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Kuru test — yapılmadı: ${baslik}`} alt={ajanAdi} sonuc={ayrinti} />;
  }
  if (adim.tip === 'red') {
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton="kirmizi" baslik={`Reddedildi: ${aracAdi(adim.ad)}`} alt={adim.neden} />;
  }
  return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Onayınıza sunuldu${adim.previewId ? ` · #${adim.previewId}` : ''}`} alt={aracAdi(adim.ad)} sonuc={adim.sonuc ? <span style={{ color: adim.sonuc.startsWith('Hata') ? KIRMIZI : OK }}>{adim.sonuc}</span> : undefined} />;
}

/** Canlı adımın simgesi: sürüyor (dönen) · bitti ✓ · hata ✕ · kuru test (şişe) · onay bekliyor (saat) · reddedildi (yasak). */
function CanliAdimSimgesi({ durum }: { durum: CanliAdim['durum'] }) {
  if (durum === 'suruyor') return <Loader2 size={11} className="flex-shrink-0 animate-spin" style={{ color: MAVI }} />;
  if (durum === 'hata') return <X size={11} className="flex-shrink-0" style={{ color: KIRMIZI }} />;
  if (durum === 'kuru') return <FlaskConical size={11} className="flex-shrink-0" style={{ color: TURUNCU }} />;
  if (durum === 'onay') return <Clock size={11} className="flex-shrink-0" style={{ color: GOLD }} />;
  if (durum === 'red') return <Ban size={11} className="flex-shrink-0" style={{ color: KIRMIZI }} />;
  return <Check size={11} className="flex-shrink-0" style={{ color: OK }} />;
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
            <span className="flex-shrink-0" style={{ color: suruyor ? MAVI : a.durum === 'hata' || a.durum === 'red' ? KIRMIZI : TEXT, fontWeight: suruyor ? 600 : 500 }}>
              {baslik}
            </span>
            {ayrinti && (
              <span className="min-w-0 truncate" style={{ color: MUTED }}>
                {ayrinti}
              </span>
            )}
            {sagYazi && (
              <span className="ml-auto flex-shrink-0 tabular-nums text-[11px]" style={{ color: suruyor ? MAVI : MUTED }}>
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
            <span style={{ color: MAVI }}>{suAn.durum === 'suruyor' ? 'şu an' : 'son adım'}: {adimAciklamasi(suAn.ad, suAn.args, mukellefAd, ajanAd, secenek).baslik}</span>
            {gorevOzeti ? ` · ${gorevOzeti}` : ''}
          </>
        ) : (
          gorevOzeti
        )
      }
      sonuc={
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {sure && <span className="tabular-nums" style={{ color: kosuyor ? MAVI : MUTED }}>{sure}</span>}
          {!adim.kuru && <Rozet metin="canlı" renk={KIRMIZI} />}
          <button type="button" onClick={() => setAcik((a) => !a)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] hover:bg-white/5" style={{ color: MUTED }}>
            {acik ? 'gizle' : 'adımları'} <ChevronDown size={11} className="transition-transform" style={{ transform: acik ? 'rotate(180deg)' : 'none' }} />
          </button>
        </span>
      }
    >
      {adim.durum === 'failed' && adim.hata && (
        <div className="mt-1 text-[11.5px]" style={{ color: KIRMIZI }}>
          {adim.hata}
        </div>
      )}
      {acik && (
        <div className="mt-2 flex flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${CARD_BORDER}` }}>
          {!data && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: MUTED }}>
              <Loader2 size={11} className="animate-spin" /> adımlar yükleniyor
            </span>
          )}
          {canliAdimlar.length > 0 && <CanliAdimlar adimlar={canliAdimlar} simdi={simdi} mukellefAd={mukellefAd} ajanAd={ajanAd} secenek={secenek} />}
          {!canliAdimlar.length &&
            araclar.map((t, i) => {
              const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd, secenek);
              return (
                <div key={i} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                  <Check size={11} className="flex-shrink-0 self-center" style={{ color: OK }} />
                  <span style={{ color: TEXT }}>{baslik}</span>
                  {ayrinti && (
                    <span className="min-w-0 truncate" style={{ color: MUTED }}>
                      {ayrinti}
                    </span>
                  )}
                </div>
              );
            })}
          {data && !araclar.length && !canliAdimlar.length && kosuyor && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: MUTED }}>
              <Loader2 size={11} className="animate-spin" style={{ color: MAVI }} /> {ad} ilk adımı atıyor; adımlar burada yazılacak.
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
    <div className="overflow-auto rounded-xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
      <table className="w-full min-w-[420px]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th className={th} style={{ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 34 }}>#</th>
            <th className={th} style={{ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}` }}>Bulgu</th>
            <th className={th} style={{ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 96 }}>Durum</th>
            <th className={`${th} text-right`} style={{ color: MUTED, borderBottom: `1px solid ${CARD_BORDER}`, width: 120 }}>Tutar</th>
          </tr>
        </thead>
        <tbody>
          {ayrisik.map((b, i) => {
            if (b.grup)
              return (
                <tr key={i}>
                  <td colSpan={4} className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD, borderBottom: `1px solid ${ROW_SEP}`, background: `${GOLD}08` }}>
                    {b.metin}
                  </td>
                </tr>
              );
            no += 1;
            const s = SIDDET[b.siddet];
            return (
              <tr key={i}>
                <td className="px-3 py-2 align-top text-[11px] tabular-nums" style={{ color: MUTED, borderBottom: `1px solid ${ROW_SEP}` }}>
                  {no}
                </td>
                <td className="whitespace-pre-wrap px-3 py-2 align-top text-[12.5px] leading-relaxed" style={{ color: TEXT, borderBottom: `1px solid ${ROW_SEP}` }}>
                  {b.metin}
                </td>
                <td className="px-3 py-2 align-top" style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
                  <Rozet metin={s.ad} renk={s.renk} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right align-top text-[12.5px] font-medium tabular-nums" style={{ color: GOLD, borderBottom: `1px solid ${ROW_SEP}` }}>
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
 * Yaptığı iş / Baktığı kaynaklar / Kime döndü / Devir → iki sütun iç kutu. Bölümsüz rapor → düz metin.
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
      <div className="text-[12px] leading-relaxed" style={{ color: MUTED }}>
        {[...ayrinti, ...(dolu(bulgular) ? [bulgular!] : []), ...(diger ? [diger] : [])].map((b) => `${b.baslik}: ${b.satirlar.join(' ')}`).join(' — ')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {ayrinti.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {ayrinti.map((b) => (
            <IcKutu key={b.anahtar} baslik={BOLUM_BASLIK[b.anahtar] || b.baslik}>
              <ul className="flex flex-col gap-1 text-[12.5px] leading-relaxed" style={{ color: TEXT }}>
                {b.satirlar.map((s, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {s}
                  </li>
                ))}
              </ul>
            </IcKutu>
          ))}
        </div>
      )}
      {dolu(bulgular) && (
        <IcKutu baslik="Bulgular" style={{ padding: 0, background: 'transparent', border: 'none' }}>
          <BulguTablosu satirlar={bulgular!.satirlar} />
        </IcKutu>
      )}
      {bulgular && !dolu(bulgular) && (
        <IcKutu baslik="Bulgular">
          <span className="text-[12.5px]" style={{ color: MUTED }}>
            Bulgu yok.
          </span>
        </IcKutu>
      )}
      {diger && (
        <IcKutu>
          <div className="whitespace-pre-wrap text-[12.8px] leading-relaxed" style={{ color: TEXT }}>
            {diger.satirlar.join('\n')}
          </div>
        </IcKutu>
      )}
      {vurgulu.map((b) => (
        <div key={b.anahtar} className="rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: `${GOLD}0d`, border: `1px solid ${GOLD}40`, color: TEXT }}>
          <b style={{ color: GOLD }}>{b.baslik}:</b> {b.satirlar.join(' · ')}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── cevap kutusu ─────────────────────────── */

/** Cevap / talimat kutusu: koşu sürüyorsa kuyruğa alınır, bitince Koordinatör'e gider. */
function CevapKutusu({ calisiyor, bekleyen, onGonder, onIptal }: { calisiyor: boolean; bekleyen: string | null; onGonder: (metin: string) => void; onIptal: () => void }) {
  const [metin, setMetin] = useState('');
  const gonder = () => {
    if (!metin.trim()) return;
    onGonder(metin.trim());
    setMetin('');
  };
  return (
    <div className="flex flex-col gap-2">
      {bekleyen && (
        <div className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px]" style={{ background: `${MAVI}12`, border: `1px solid ${MAVI}40`, color: TEXT }}>
          <Loader2 size={12} className="flex-shrink-0 animate-spin" style={{ color: MAVI }} />
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
          style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}`, color: TEXT }}
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
 * İş paneli — komut verilen (ya da listeden seçilen) işin tek kartta görünümü (Bütçe Kutu dili):
 *  başlık (mükellef — konu · durum satırı · Durdur/Tekrar/Kapat) → aşama çizgisi (+ilerleme, "Şu an") → Kararınız →
 *  Sonuç (yaptığı iş / bulgular / kaynaklar / kuru test) → Adımlar (zaman çizgisi; bitince katlı) → not/talimat kutusu.
 * Kaynak: yerel koşu (SSE, Koordinatör) ve/veya sunucu vakası (personel adımları, açık kalemler, geçmiş işler).
 */
export function IsPaneli({ kosu, vaka, kosular, ajanAd, mukellefAd, onTaslak, onKapat }: { kosu?: Kosu; vaka?: Vaka; kosular: KosularApi; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void; onKapat?: () => void }) {
  const qc = useQueryClient();
  const [simdi, setSimdi] = useState(() => Date.now());
  const [cevapMetni, setCevapMetni] = useState('');
  const [durduruluyor, setDurduruluyor] = useState(false);
  const [gonderTeyit, setGonderTeyit] = useState(false);
  const [gonderMesgul, setGonderMesgul] = useState(false);
  const [adimlarAcik, setAdimlarAcik] = useState<boolean | null>(null);

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
  const hata = kosu?.hata || kokIs?.hata || (kokAdim?.durum === 'failed' ? kokAdim.hata || 'Hata' : '');

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
  const durumAd = hata ? (durduruldu ? 'Durduruldu' : 'Yarım kaldı') : calisiyor ? 'Sürüyor' : bitti ? 'Tamamlandı' : 'Bekliyor';

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
      const h = isZamanAsimi(e) ? 'Sürüyor — iş kayıtlarında görünecek' : e?.message || 'Gönderilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata: h, durationMs: Date.now() - b }));
      toast.error(h);
    } finally {
      setGonderMesgul(false);
      setGonderTeyit(false);
      tazele();
    }
  };

  const asamaListesi = asamalar({ basladi: !!kosu?.isId || !!kokAdim || (!!kosu && kosu.adimlar.length > 0), aracVar: yerelAdimlar.length > 0, personelVar, personelBitti, bitti, hata: !!hata });
  const tamamlanan = asamaListesi.filter((a) => a.durum === 'bitti').length;
  const yuzde = hata ? Math.round((tamamlanan / asamaListesi.length) * 100) : bitti && (!personelVar || personelBitti) ? 100 : Math.round(((tamamlanan + (calisiyor ? 0.5 : 0)) / asamaListesi.length) * 100);
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
          ? `${ajanKisaAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))}: ${adimAciklamasi(sonCanliAdim.ad, sonCanliAdim.args, mukellefAd, ajanAd, secenek).baslik}${sonCanliAdim.durum === 'suruyor' ? ` · ${sayacMetni(simdi - new Date(sonCanliAdim.basladi).getTime())}` : ' ✓ — sıradaki adıma geçiyor'}`
          : `${ajanTamAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))} çalışıyor — ${gorevSadelestir(calisanPersonel.baslik, mukellef, 80)}`
        : kosu && !kosu.isId
          ? 'Koordinatör göreve başlıyor'
          : 'Koordinatör düşünüyor'
    : '';
  const aracSayisi = yerelAdimlar.filter((a) => a.tip === 'arac').length;
  const adimSayisi = aracSayisi + personelAdimlari.length;
  const personelAdlari = Array.from(new Set(isAdimlari.map((a) => a.ajanId))).map((id) => ajanKisaAd(id, ajanAd(id)));
  const asamaZamani = (i: number): string | undefined => {
    if (i === 0) return saatKisa(basladi).slice(0, 5);
    if (asamaListesi[i].ad === 'Personelde') return personelAdimlari[0]?.baslangic ? saatKisa(personelAdimlari[0].baslangic).slice(0, 5) : undefined;
    if (asamaListesi[i].ad === 'Sonuç') return asamaListesi[i].durum === 'bitti' || asamaListesi[i].durum === 'hata' ? (sonBitis ? saatKisa(sonBitis).slice(0, 5) : toplamSureMs ? saatKisa(basladi + (toplamSureMs || 0)).slice(0, 5) : undefined) : undefined;
    if (asamaListesi[i].ad === 'Bilgi toplandı') return yerelAdimlar[0]?.zaman ? saatKisa(yerelAdimlar[0].zaman).slice(0, 5) : undefined;
    return undefined;
  };

  const bildirimAdimlari = (vaka?.adimlar || []).filter((a): a is Exclude<VakaAdim, VakaAdimIs> => a.tip !== 'is' && !(a.tip === 'bildirim' && a.tur === 'bilgi' && /^İŞ ATAMASI/i.test(a.baslik)));
  const acikKalemler = vaka?.acikKalemler || [];
  const yerelOnaylar = kosu?.adimlar.filter((a) => a.tip === 'onay' && a.previewId && !a.sonuc) || [];
  // Kararlar kendi bölümünde; Sonuç bölümü yalnız rapor/kuru liste/öğrenilen ya da biten sabah özeti varsa
  const sonucVar = !!raporMetni || kuruListesi.length > 0 || ogrenilen.length > 0 || (sabahOzetiMi && !!kosu?.bitti) || (bitti && !hata && !sabahOzetiMi);
  const kararBekliyor = acikKalemler.length > 0 || yerelOnaylar.length > 0;
  const baslikMetni = sabahOzetiMi ? (calisiyor ? 'Sabah özeti üretiliyor' : 'Sabah özeti') : mukellef ? `${mukellef} — ${konu}` : konu || 'İş';
  const adimToplam = yerelAdimlar.length + personelAdimlari.length + bildirimAdimlari.length;
  const adimlarGoster = adimlarAcik ?? calisiyor;
  const kutuRengi = hata ? KIRMIZI : kararBekliyor ? GOLD : calisiyor ? MAVI : bitti ? OK : MUTED;
  const durumRenk = hata ? KIRMIZI : kararBekliyor ? GOLD : calisiyor ? MAVI : bitti ? OK : MUTED;

  const durumSatiri = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <b className="font-semibold" style={{ color: durumRenk }}>
        {kararBekliyor && !calisiyor ? 'Kararınız bekleniyor' : durumAd}
      </b>
      {calisiyor ? <span>· {calisanPersonel ? `${ajanKisaAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))} çalışıyor` : 'Koordinatör çalışıyor'}</span> : personelAdlari.length ? <span>· {personelAdlari.join(', ')}</span> : null}
      {sureMetni && <span className="tabular-nums">· {sureMetni}</span>}
      <span>· {kuru ? 'kuru test' : <span style={{ color: KIRMIZI }}>canlı</span>}</span>
      {kaynak.ad !== 'portal' && !sabahOzetiMi && <span>· {kaynak.ad}</span>}
      <span className="tabular-nums">· {saatKisa(basladi).slice(0, 5)}</span>
      {kosu?.model || kokIs?.model ? <span>· {String(kosu?.model || kokIs?.model).replace(/^claude-/, '')}</span> : null}
    </span>
  );

  return (
    <Kutu
      baslik={<span className="text-[14px]" title={baslikMetni}>{baslikMetni}</span>}
      aciklama={durumSatiri}
      renk={kutuRengi}
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
        {/* Aşama çizgisi + ilerleme */}
        <div className="flex flex-col gap-2.5">
          <AsamaCizgisi liste={asamaListesi} zamanlar={asamaListesi.map((_, i) => asamaZamani(i))} />
          {calisiyor && (
            <>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
                <span className="w-24 flex-shrink-0">{asamaListesi.find((a) => a.durum === 'aktif')?.ad || 'Sürüyor'}</span>
                <Ilerleme yuzde={yuzde} />
                <span className="tabular-nums">{tamamlanan}/{asamaListesi.length}</span>
              </div>
              <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: `${MAVI}0f`, border: `1px solid ${MAVI}2e`, color: TEXT }}>
                <b className="font-semibold" style={{ color: MAVI }}>
                  Şu an:
                </b>{' '}
                {suAnMetni}
              </div>
            </>
          )}
        </div>

        {hata && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}59`, color: TEXT }}>
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: KIRMIZI }} />
            <span>{durduruldu ? 'Durduruldu — koşu sunucuda iptal edildi.' : hata}</span>
          </div>
        )}

        {/* Kararınız */}
        {(acikKalemler.length > 0 || yerelOnaylar.length > 0 || sorular.length > 0) && (
          <section>
            <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: GOLD }}>
              Kararınız · {acikKalemler.length + yerelOnaylar.length + (sorular.length ? 1 : 0)}
            </h4>
            {acikKalemler.map((k) => (
              <AcikKalemKarti key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} onCevapla={cevapla} calisiyor={calisiyor || aktifKosuVar} />
            ))}
            {kosu && yerelOnaylar.map((a) => <YerelOnay key={a.previewId} adim={a} kosu={kosu} kosular={kosular} onBitti={tazele} />)}
            {sorular.length > 0 && (
              <div className="py-3" style={{ borderTop: `1px solid ${ROW_SEP}` }}>
                <div className="flex items-center gap-2 text-[12.8px] font-semibold" style={{ color: TEXT }}>
                  <HelpCircle size={14} style={{ color: GOLD }} /> {ajanKisaAd(kimde)} soruyor
                </div>
                {sorular.map((s, i) => (
                  <div key={i} className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
                    {s}
                  </div>
                ))}
                <div className="mt-2.5 flex items-center gap-2">
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
                    className="h-9 min-w-0 flex-1 rounded-[10px] px-3 text-[12.5px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}`, color: TEXT }}
                  />
                  <Dugme tur="birincil" disabled={!cevapMetni.trim()} onClick={() => { cevapla(cevapMetni.trim()); setCevapMetni(''); }}>
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
              <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
                {sonBitenPersonel ? `Sonuç · ${ajanTamAd(sonBitenPersonel.ajanId, ajanAd(sonBitenPersonel.ajanId))}` : sabahOzetiMi ? 'Sabah özeti' : 'Sonuç · Koordinatör'}
              </h4>
              <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>
                {kokS.isLoading && !kokIs ? 'yükleniyor…' : `${sonBitis ? saatKisa(sonBitis).slice(0, 5) : saatKisa(basladi).slice(0, 5)} · ${kuru ? 'kuru test' : 'canlı'}`}
              </span>
            </div>
            {calisiyor && !raporMetni && kosu?.cevap && (
              <IcKutu>
                <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[12.8px] leading-relaxed" style={{ color: MUTED }}>
                  {kosu.cevap}
                </div>
              </IcKutu>
            )}
            {raporMetni && (
              <>
                <RaporGorunumu rapor={ayrisik?.rapor || raporMetni} />
                {sonBitenPersonel && koordinatorRaporu && (
                  <details className="mt-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${CARD_BORDER}` }}>
                    <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
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
              <IcKutu baslik={<span className="inline-flex items-center gap-1.5"><FlaskConical size={11} /> Kuru test — yapılacaktı ({kuruListesi.length})</span>} renk={TURUNCU} className="mt-3">
                <ul className="flex flex-col gap-1 text-[12.5px]" style={{ color: TEXT }}>
                  {kuruListesi.map((t, i) => {
                    const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd, secenek);
                    return (
                      <li key={i} className="flex gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: TURUNCU }} />
                        <span>
                          {baslik}
                          {ayrinti && <span style={{ color: MUTED }}> · {ayrinti}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </IcKutu>
            )}
            {ogrenilen.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <GraduationCap size={13} style={{ color: MOR }} />
                {ogrenilen.map((o, i) => (
                  <Rozet key={i} metin={o} renk={MOR} />
                ))}
              </div>
            )}
            {sabahOzetiMi && kosu?.bitti && !kosu.hata && (
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
              <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
                <Check size={12} style={{ color: OK }} /> Sizden bir şey beklemiyor. İsterseniz <b style={{ color: TEXT }}>Tekrar</b> ile aynı görevi yeniden verirsiniz ya da aşağıdan talimat yazarsınız.
              </div>
            )}
          </section>
        )}

        {/* Adımlar */}
        <section>
          <button type="button" onClick={() => setAdimlarAcik(!adimlarGoster)} className="mb-1 flex w-full items-center justify-between text-left">
            <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
              Adımlar · {adimToplam}
            </h4>
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
              {adimlarGoster ? 'gizle' : 'göster'} <ChevronDown size={11} className="transition-transform" style={{ transform: adimlarGoster ? 'rotate(180deg)' : 'none' }} />
            </span>
          </button>
          {adimlarGoster && (
            <ol className="flex max-h-[520px] min-w-0 flex-col overflow-y-auto [scrollbar-width:thin]" style={{ borderTop: `1px solid ${ROW_SEP}` }}>
              {!yerelAdimlar.length && !personelAdimlari.length && !bildirimAdimlari.length && (
                <li className="py-3 text-[12px]" style={{ color: MUTED }}>
                  {calisiyor ? 'İlk adım bekleniyor…' : 'Adım kaydı yok.'}
                </li>
              )}
              {yerelAdimlar.map((a, i) => (
                <YerelAdim key={`${a.zaman}-${i}`} adim={a} mukellefAd={mukellefAd} ajanAd={ajanAd} ajanId={kosu?.ajanId || kokAdim?.ajanId || 'koordinator'} secenek={secenek} simdi={simdi} />
              ))}
              {personelAdimlari.map((a) => (
                <PersonelAdimi key={a.isId} adim={a} ajanAd={ajanAd} mukellefAd={mukellefAd} acikVarsayilan={a.durum === 'running'} onRapor={personelRaporAl} secenek={secenek} simdi={simdi} />
              ))}
              {bildirimAdimlari.map((a, i) =>
                a.tip === 'onay' ? (
                  <ZamanSatiri key={`onay-${a.id}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma={ajanKisaltma(a.ajanId)} ton={a.durum === 'PENDING' ? 'gold' : 'gri'} baslik={`Onay kaydı #PRV-${a.id.slice(0, 8)}`} alt={`${a.durum === 'EXECUTED' ? 'gönderildi' : a.durum === 'PENDING' ? 'onay bekliyor' : a.durum === 'REJECTED' ? 'reddedildi' : a.durum === 'EXPIRED' ? 'süresi doldu' : a.durum}${a.baslik ? ` · ${a.baslik}` : ''}`} />
                ) : (
                  <ZamanSatiri key={`not-${a.id || i}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma="MB" ton="gold" baslik={a.tur === 'istek' ? 'Sizden istendi' : a.tur === 'onay' ? 'Onayınıza sunuldu' : 'Koordinatör notu'} alt={`${a.baslik}${a.durum === 'kapandi' ? ' · kapandı' : ''}`}>
                    {a.govde && (
                      <div className="mt-0.5 whitespace-pre-wrap text-[11.5px]" style={{ color: MUTED }}>
                        {a.govde}
                      </div>
                    )}
                  </ZamanSatiri>
                ),
              )}
            </ol>
          )}
        </section>

        {/* Not / talimat */}
        {!sabahOzetiMi && (
          <section style={{ borderTop: `1px solid ${ROW_SEP}`, paddingTop: 12 }}>
            <CevapKutusu calisiyor={calisiyor || aktifKosuVar} bekleyen={bekleyenCevap} onGonder={cevapla} onIptal={() => setBekleyenCevap(null)} />
          </section>
        )}
      </div>
    </Kutu>
  );
}
