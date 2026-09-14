'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X, Square, Send, XCircle, MessageSquareReply, RotateCcw, ShieldAlert, ClipboardCheck, StickyNote, FlaskConical, GraduationCap, HelpCircle, ChevronDown, Sunrise, Clock, AlertTriangle, BarChart3, Bell, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, iptalEt, istekKapat, onayla, reddet, sabahOzetiUret, isZamanAsimi, type AcikKalem, type IsDosyasi, type Vaka, type VakaAdim, type VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { DURDURULDU_METNI, type Adim, type Kosu, type KosularApi } from './kosular';
import { OnayTeyit } from './OnayBekleyenler';
import { AvatarV5, CamKart, Dug, Halka, Kapsul, V5, camBlok, type AvatarTonu } from './Cam';
import { adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, aracAdi, cevapAyristir, goreliSaat, kaynakEtiketi, konuKisalt, raporBolumleri, saatKisa, sayacMetni, sureKisa, yokMu, type RaporBolumu } from './ortak';

/* ─────────────────────────── yardımcılar ─────────────────────────── */

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

/** Aşama kartı (v5): numara/onay halkası + ad + saat; biten mavi, süren nabızlı mavi, sonuç yeşil, hata bordo. */
function AsamaKarti({ no, asama, zaman, son }: { no: number; asama: Asama; zaman?: string; son: boolean }) {
  const d = asama.durum;
  const stil: React.CSSProperties =
    d === 'bitti' && son
      ? { border: '1px solid rgba(63,211,154,0.4)', background: 'linear-gradient(180deg, rgba(63,211,154,0.16), rgba(63,211,154,0.05))' }
      : d === 'bitti'
        ? { border: '1px solid rgba(110,163,255,0.35)', background: 'linear-gradient(180deg, rgba(110,163,255,0.14), rgba(110,163,255,0.05))' }
        : d === 'aktif'
          ? { border: '1px solid rgba(110,163,255,0.6)', background: 'linear-gradient(180deg, rgba(110,163,255,0.2), rgba(110,163,255,0.06))', boxShadow: '0 0 0 1px rgba(110,163,255,0.25), 0 10px 30px rgba(110,163,255,0.15)' }
          : d === 'hata'
            ? { border: '1px solid rgba(255,107,122,0.5)', background: 'linear-gradient(180deg, rgba(255,107,122,0.16), rgba(255,107,122,0.05))' }
            : { border: `1px solid ${V5.cizgi}`, background: 'rgba(0,0,0,0.28)' };
  const halka: React.CSSProperties =
    d === 'bitti'
      ? { background: son ? 'linear-gradient(145deg, #1f8a5f, #3fd39a)' : 'linear-gradient(145deg, #2f5cb8, #6ea3ff)', border: '1.5px solid transparent', color: '#fff', boxShadow: `0 0 14px ${son ? 'rgba(63,211,154,0.45)' : 'rgba(110,163,255,0.45)'}` }
      : d === 'aktif'
        ? { border: `1.5px solid ${V5.mavi}`, color: V5.mavi }
        : d === 'hata'
          ? { background: 'linear-gradient(145deg, #b03c4a, #ff6b7a)', border: '1.5px solid transparent', color: '#fff' }
          : { border: `1.5px solid ${V5.cizgi2}`, color: V5.soluk };
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3" style={stil}>
      <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[12px]" style={{ fontFamily: V5.mono, ...halka }}>
        {d === 'bitti' ? <Check size={14} /> : d === 'hata' ? <X size={14} /> : d === 'aktif' ? <span className="h-[9px] w-[9px] animate-pulse rounded-full" style={{ background: V5.mavi, boxShadow: `0 0 10px ${V5.mavi}` }} /> : no}
      </span>
      <span className="min-w-0">
        <b className="block truncate text-[13px]" style={{ color: d === 'bekliyor' ? V5.ikincil : V5.metin }}>
          {asama.ad}
        </b>
        <span className="block text-[11.5px]" style={{ fontFamily: V5.mono, color: V5.soluk }}>
          {zaman || '—'}
        </span>
      </span>
    </div>
  );
}

/** Zaman çizgisi satırı (v5): saat · kare avatar · başlık + alt yazı · sağda sonuç. */
function ZamanSatiri({ saat, kisaltma, ton, baslik, alt, sonuc, devir, nabiz, children }: { saat?: string; kisaltma: string; ton: AvatarTonu; baslik: ReactNode; alt?: ReactNode; sonuc?: ReactNode; devir?: boolean; nabiz?: boolean; children?: ReactNode }) {
  return (
    <li className="relative grid min-w-0 grid-cols-[46px_34px_minmax(0,1fr)] items-start gap-x-3 py-2 md:grid-cols-[46px_34px_minmax(0,1fr)_minmax(0,190px)]">
      <span className="absolute bottom-0 left-[74px] top-0 w-[2px]" style={{ background: V5.cizgi }} />
      <span className="pt-2 text-right text-[11.5px]" style={{ fontFamily: V5.mono, color: V5.soluk }}>
        {saat || ''}
      </span>
      <span className="relative z-[1]">
        <AvatarV5 kisaltma={kisaltma} ton={ton} boyut={34} kare nabiz={nabiz} />
      </span>
      <span className="min-w-0 pt-1">
        <b className="block text-[13px] font-semibold" style={{ color: devir ? '#cfe0ff' : V5.metin }}>
          {devir && <span style={{ color: V5.mavi }}>→ </span>}
          {baslik}
        </b>
        {alt && (
          <span className="block text-[12px]" style={{ color: V5.ikincil }}>
            {alt}
          </span>
        )}
        {children}
      </span>
      {sonuc !== undefined && (
        <span className="hidden min-w-0 pt-1.5 text-right text-[12px] md:block" style={{ color: V5.soluk }}>
          {sonuc}
        </span>
      )}
    </li>
  );
}

/** Yerel koşu adımı → zaman çizgisi satırı. */
function YerelAdim({ adim, mukellefAd, ajanAd, ajanId }: { adim: Adim; mukellefAd: (id?: string | null) => string | undefined; ajanAd: (id: string) => string; ajanId: string }) {
  const saat = saatKisa(adim.zaman).slice(0, 5);
  const kisaltma = ajanKisaltma(ajanId);
  const ton: AvatarTonu = ajanId === 'koordinator' ? 'altin' : 'mavi';
  const ajanAdi = ajanTamAd(ajanId, ajanAd(ajanId));
  if (adim.tip === 'arac') {
    const calisiyor = adim.durum === 'calisiyor';
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd);
    const devir = adim.ad === 'ekip_ajan_baslat';
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={baslik} alt={ajanAdi} sonuc={calisiyor ? <span style={{ color: V5.mavi }}>sürüyor…</span> : ayrinti} devir={devir} nabiz={calisiyor} />;
  }
  if (adim.tip === 'kuruTest') {
    const { baslik, ayrinti } = adimAciklamasi(adim.ad, adim.args, mukellefAd, ajanAd);
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Kuru test — yapılmadı: ${baslik}`} alt={ajanAdi} sonuc={ayrinti} />;
  }
  if (adim.tip === 'red') {
    return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton="coral" baslik={`Reddedildi: ${aracAdi(adim.ad)}`} alt={adim.neden} />;
  }
  return <ZamanSatiri saat={saat} kisaltma={kisaltma} ton={ton} baslik={`Onayınıza sunuldu${adim.previewId ? ` · #${adim.previewId}` : ''}`} alt={aracAdi(adim.ad)} sonuc={adim.sonuc ? <span style={{ color: adim.sonuc.startsWith('Hata') ? V5.coral : V5.mint }}>{adim.sonuc}</span> : undefined} />;
}

/** Sunucu vakasındaki personel (çocuk) adımı — açılınca araçları getirir; raporu üst bileşene verir. */
function PersonelAdimi({ adim, ajanAd, mukellefAd, acikVarsayilan, onRapor }: { adim: VakaAdimIs; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; acikVarsayilan?: boolean; onRapor?: (isId: string, is: IsDosyasi) => void }) {
  const [acik, setAcik] = useState(!!acikVarsayilan);
  const bitti = adim.durum === 'done' || adim.durum === 'failed';
  const { data } = useQuery({ queryKey: ['ekip-is', adim.isId], queryFn: () => getIs(adim.isId), enabled: acik || bitti, staleTime: 15_000, retry: 1, refetchInterval: bitti ? false : 8_000 });
  const sure = adim.baslangic && adim.bitis ? sureKisa(new Date(adim.bitis).getTime() - new Date(adim.baslangic).getTime()) : '';
  const durumAd = adim.durum === 'running' ? 'çalışıyor' : adim.durum === 'failed' ? 'yapamadı' : adim.durum === 'done' ? 'bitirdi' : 'sırada';
  const araclar = data?.result?.toolUses || [];
  useEffect(() => {
    if (data && onRapor) onRapor(adim.isId, data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ad = ajanTamAd(adim.ajanId, ajanAd(adim.ajanId));
  return (
    <ZamanSatiri
      saat={saatKisa(adim.baslangic).slice(0, 5)}
      kisaltma={ajanKisaltma(adim.ajanId)}
      ton={adim.durum === 'failed' ? 'coral' : 'mavi'}
      nabiz={adim.durum === 'running'}
      baslik={`${ad} ${durumAd}`}
      alt={adim.baslik}
      sonuc={
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {sure && <span style={{ fontFamily: V5.mono }}>{sure}</span>}
          {!adim.kuru && <Kapsul tur="canli">canlı</Kapsul>}
          <button type="button" onClick={() => setAcik((a) => !a)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] hover:bg-white/5" style={{ color: V5.ikincil }}>
            {acik ? 'gizle' : 'adımları'} <ChevronDown size={11} className="transition-transform" style={{ transform: acik ? 'rotate(180deg)' : 'none' }} />
          </button>
        </span>
      }
    >
      {adim.durum === 'failed' && adim.hata && (
        <div className="mt-1 text-[12px]" style={{ color: V5.coral }}>
          {adim.hata}
        </div>
      )}
      {acik && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-xl px-3 py-2.5" style={camBlok()}>
          {!data && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: V5.ikincil }}>
              <Loader2 size={11} className="animate-spin" /> adımlar yükleniyor
            </span>
          )}
          {araclar.map((t, i) => {
            const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd);
            return (
              <div key={i} className="flex min-w-0 items-baseline gap-2 text-[12.3px]">
                <Check size={11} className="flex-shrink-0 self-center" style={{ color: V5.mint }} />
                <span style={{ color: V5.metin }}>{baslik}</span>
                {ayrinti && (
                  <span className="min-w-0 truncate" style={{ color: V5.soluk }}>
                    {ayrinti}
                  </span>
                )}
              </div>
            );
          })}
          {data && !araclar.length && adim.durum === 'running' && (
            <span className="text-[11.5px]" style={{ color: V5.ikincil }}>
              Adımlar bitince görünür (personel çalışırken canlı akış yalnız Koordinatör için).
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
  temiz: { ad: 'temiz', renk: V5.mint },
  uyari: { ad: 'dikkat', renk: V5.amber },
  karar: { ad: 'kararınız', renk: V5.coral },
  bilgi: { ad: 'bilgi', renk: V5.ikincil },
};

/** Bulgular tablosu (v5): # · Bulgu · Durum · Tutar; grup başlıkları mavi şerit. */
function BulguTablosu({ satirlar }: { satirlar: string[] }) {
  const ayrisik = satirlar.map(bulguAyristir);
  let no = 0;
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${V5.cizgi}`, background: 'rgba(0,0,0,0.25)' }}>
      <table className="w-full">
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            {['#', 'Bulgu', 'Durum', 'Tutar'].map((b, i) => (
              <th key={b} className={`px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] ${i === 3 ? 'text-right' : 'text-left'}`} style={{ color: V5.soluk, borderBottom: `1px solid ${V5.cizgi}`, width: i === 0 ? 36 : i === 2 ? 110 : i === 3 ? 130 : undefined }}>
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ayrisik.map((b, i) => {
            if (b.grup)
              return (
                <tr key={i}>
                  <td colSpan={4} className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ background: 'rgba(110,163,255,0.08)', color: '#cfe0ff', borderBottom: `1px solid ${V5.cizgi}` }}>
                    {b.metin}
                  </td>
                </tr>
              );
            no += 1;
            const s = SIDDET[b.siddet];
            return (
              <tr key={i}>
                <td className="px-3.5 py-2.5 align-top text-[11.5px]" style={{ fontFamily: V5.mono, color: V5.soluk, borderBottom: `1px solid ${V5.cizgi}` }}>
                  {no}
                </td>
                <td className="whitespace-pre-wrap px-3.5 py-2.5 align-top text-[12.8px] leading-relaxed" style={{ color: V5.metin, borderBottom: `1px solid ${V5.cizgi}` }}>
                  {b.metin}
                </td>
                <td className="px-3.5 py-2.5 align-top" style={{ borderBottom: `1px solid ${V5.cizgi}` }}>
                  <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[12px] font-bold" style={{ color: s.renk }}>
                    <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor', boxShadow: '0 0 8px currentColor' }} />
                    {s.ad}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 text-right align-top text-[12.5px] font-semibold" style={{ fontFamily: V5.mono, color: V5.metin, borderBottom: `1px solid ${V5.cizgi}` }}>
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

const BOLUM_RENGI: Record<RaporBolumu['anahtar'], string> = {
  yaptigim: V5.mavi,
  kaynaklar: V5.soluk,
  bulgular: V5.metin,
  onay: V5.altin,
  istek: V5.amber,
  kimde: V5.mor,
  ogrendim: V5.mor,
  emin: V5.amber,
  devir: V5.mor,
  diger: V5.metin,
};

/**
 * Rapor görünümü v5: Bulgular → kenarlıklı tablo; Emin olmadığı / Sizden istenen / Onayınızı bekleyen → vurgulu satır;
 * Yaptığı iş / Baktığı kaynaklar / Kime döndü / Devir → katlanır ayrıntı. Bölümsüz rapor → düz metin bloğu.
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
  return (
    <div className="flex flex-col gap-3">
      {dolu(bulgular) && <BulguTablosu satirlar={bulgular!.satirlar} />}
      {bulgular && !dolu(bulgular) && (
        <div className="rounded-xl px-3.5 py-3 text-[12.5px]" style={camBlok({ color: V5.ikincil })}>
          Bulgu yok.
        </div>
      )}
      {diger && (
        <div className="whitespace-pre-wrap rounded-xl px-3.5 py-3 text-[13px] leading-relaxed" style={camBlok({ color: V5.metin })}>
          {diger.satirlar.join('\n')}
        </div>
      )}
      {vurgulu.map((b) => (
        <div key={b.anahtar} className="rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{ background: `${BOLUM_RENGI[b.anahtar]}12`, border: `1px solid ${BOLUM_RENGI[b.anahtar]}55`, color: V5.ikincil }}>
          <b style={{ color: V5.metin }}>{b.baslik}:</b> {b.satirlar.join(' · ')}
        </div>
      ))}
      {ayrinti.length > 0 && !kompakt && (
        <details className="rounded-xl px-3.5 py-2" style={camBlok()}>
          <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: V5.soluk }}>
            Nasıl yaptı — {ayrinti.map((b) => b.baslik.toLocaleLowerCase('tr-TR')).join(' · ')}
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {ayrinti.map((b) => (
              <div key={b.anahtar} className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${V5.cizgi}` }}>
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: BOLUM_RENGI[b.anahtar] === V5.metin ? V5.soluk : BOLUM_RENGI[b.anahtar] }}>
                  {b.baslik}
                </div>
                <ul className="flex flex-col gap-1 text-[12.5px] leading-relaxed" style={{ color: V5.ikincil }}>
                  {b.satirlar.map((s, i) => (
                    <li key={i} className="whitespace-pre-wrap">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
      {ayrinti.length > 0 && kompakt && (
        <div className="text-[12px] leading-relaxed" style={{ color: V5.ikincil }}>
          {ayrinti.map((b) => `${b.baslik}: ${b.satirlar.join(' ')}`).join(' — ')}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── kararlar ─────────────────────────── */

/**
 * Açık kalem (v5, bordo karar kartı) — üç tür:
 *  - PRV onayı (dışarı mesaj): Onayla ve gönder / Reddet (kart içi teyit).
 *  - KARAR (bildirim, tur 'onay'): personel "karar sizde" dedi → kararınızı yazıp gönderirsiniz ya da kapatırsınız.
 *  - İSTEK (bildirim, tur 'istek'): sizden belge/işlem → Yapıldı; isterseniz not da yazarsınız.
 */
function AcikKalemKarti({ kalem, onBitti, onCevapla, calisiyor }: { kalem: AcikKalem; onBitti: () => void; onCevapla: (metin: string) => void; calisiyor: boolean }) {
  const [teyit, setTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [cevap, setCevap] = useState('');
  const onayMi = kalem.tip === 'onay';
  const kararMi = onayMi && kalem.kaynak === 'bildirim';
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
  const renk = onayMi && !kararMi ? V5.altin : V5.coral;
  return (
    <div className="rounded-[14px] p-4" style={{ background: `linear-gradient(160deg, ${renk}2e, ${renk}0d)`, border: `1px solid ${renk}73`, boxShadow: `0 12px 30px ${renk}1f` }}>
      <div className="flex items-center gap-2 text-[14px] font-extrabold" style={{ color: V5.metin }}>
        {onayMi && !kararMi ? <ShieldAlert size={15} style={{ color: renk }} /> : kararMi ? <Bell size={15} style={{ color: renk }} /> : <ClipboardCheck size={15} style={{ color: renk }} />}
        {kararMi ? 'Kararınız bekleniyor' : onayMi ? 'Onayınızı bekliyor' : 'Sizden istenen'}
      </div>
      <div className="mt-1.5 text-[12.8px] leading-relaxed" style={{ color: V5.ikincil }}>
        {kalem.baslik}
      </div>
      {kalem.confirmationText && !sonuc && (
        <div className="mt-2 line-clamp-5 whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.3px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.3)', color: V5.ikincil }}>
          {kalem.confirmationText}
        </div>
      )}
      {sonuc ? (
        <div className="mt-3 text-[12.5px] font-bold" style={{ color: sonuc.startsWith('Hata') ? V5.coral : V5.mint }}>
          {sonuc}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {kalem.kaynak === 'bildirim' && (
            <input
              value={cevap}
              onChange={(e) => setCevap(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && cevap.trim()) {
                  e.preventDefault();
                  cevapGonder();
                }
              }}
              placeholder={kararMi ? 'Kararınızı yazın (ör. "kilitle", "beklet")…' : 'İsterseniz not yazın (ör. "fişi yükledim, devam et")…'}
              className="h-9 min-w-0 rounded-[10px] px-3 text-[12.5px] outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${V5.cizgi2}`, color: V5.metin }}
            />
          )}
          {kararMi ? (
            <>
              <Dug tur="mavi" disabled={!cevap.trim()} onClick={cevapGonder} title={calisiyor ? 'Koşu sürüyor; cevabınız bitince gönderilir' : 'Koordinatör aynı iş zincirinde devam eder'}>
                <MessageSquareReply size={13} /> {calisiyor ? 'Kararı bitince gönder' : 'Kararı gönder'}
              </Dug>
              <Dug disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Kapatıldı')} title="Kararı verdiniz / gerek kalmadı → kalem kapanır">
                <Check size={12} /> Kapat
              </Dug>
            </>
          ) : onayMi ? (
            <>
              <Dug tur="mavi" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
                {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Onayla ve gönder
              </Dug>
              <Dug tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(kalem.id, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
                <XCircle size={12} /> Reddet
              </Dug>
            </>
          ) : (
            <>
              <Dug tur="mavi" disabled={mesgul} onClick={() => yap(() => istekKapat(kalem.id), 'Yapıldı ✓')} title="İstenen yapıldı → kalem kapanır, Koordinatör devam eder">
                {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Yapıldı
              </Dug>
              {cevap.trim() && (
                <Dug onClick={cevapGonder}>
                  <MessageSquareReply size={13} /> Notu gönder
                </Dug>
              )}
            </>
          )}
          {teyit && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{kalem.id}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(kalem.id), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
        </div>
      )}
    </div>
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
    <div className="rounded-[14px] p-4" style={{ background: 'linear-gradient(160deg, rgba(227,194,111,0.18), rgba(227,194,111,0.05))', border: '1px solid rgba(227,194,111,0.45)' }}>
      <div className="flex items-center gap-2 text-[14px] font-extrabold" style={{ color: V5.metin }}>
        <ShieldAlert size={15} style={{ color: V5.altin }} /> Onayınızı bekliyor · #{adim.previewId}
      </div>
      <div className="mt-1.5 text-[12.8px]" style={{ color: V5.ikincil }}>
        {aracAdi(adim.ad)}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Dug tur="mavi" disabled={mesgul || teyit} onClick={() => setTeyit(true)}>
          <Send size={12} /> Onayla ve gönder
        </Dug>
        <Dug tur="tehlike" disabled={mesgul} onClick={() => yap(() => reddet(adim.previewId!, 'Ekip ekranından reddedildi'), 'Reddedildi')}>
          Reddet
        </Dug>
      </div>
      {teyit && <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{adim.previewId}</>} mesgul={mesgul} onEvet={() => yap(() => onayla(adim.previewId!), 'Gönderildi ✓')} onVazgec={() => setTeyit(false)} />}
    </div>
  );
}

/** Cevap / talimat kutusu (v5, sağ panel altı): koşu sürüyorsa kuyruğa alınır, bitince Koordinatör'e gider. */
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
        <div className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px]" style={{ background: 'rgba(110,163,255,0.1)', border: '1px solid rgba(110,163,255,0.35)', color: V5.metin }}>
          <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: V5.mavi }} />
          <span className="min-w-0 flex-1 truncate">
            Bitince gidecek: <i>{bekleyen}</i>
          </span>
          <button type="button" onClick={onIptal} className="rounded p-0.5 hover:bg-white/10" title="Vazgeç">
            <X size={12} />
          </button>
        </div>
      )}
      <input
        value={metin}
        onChange={(e) => setMetin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            gonder();
          }
        }}
        placeholder={calisiyor ? 'Cevap ya da talimat yazın…' : 'Uzmana cevap ya da yeni talimat…'}
        className="h-[38px] min-w-0 rounded-[10px] px-3 text-[13px] outline-none"
        style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${V5.cizgi2}`, color: V5.metin }}
      />
      <div className="flex items-center justify-between gap-2 text-[11.5px]" style={{ color: V5.soluk }}>
        <span>{calisiyor ? 'Koşu sürerken kuyruğa alınır' : 'Aynı iş zincirinde devam eder'}</span>
        <Dug kucuk disabled={!metin.trim()} onClick={gonder} title={calisiyor ? 'Koşu sürüyor; bitince gönderilir' : 'Gönder (Enter)'}>
          <Send size={12} /> {calisiyor ? 'Bitince gönder' : 'Gönder'}
        </Dug>
      </div>
    </div>
  );
}

/** Anahtar-değer satırları (Şu an / Özet paneli). */
function KV({ satirlar }: { satirlar: Array<[string, ReactNode]> }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[12.3px]">
      {satirlar.map(([k, v]) => (
        <div key={k} className="contents">
          <span style={{ color: V5.soluk }}>{k}</span>
          <span className="text-right" style={{ fontFamily: V5.mono, color: V5.metin }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── ana panel ─────────────────────────── */

/**
 * Aktif iş paneli v5 — komut verilen (ya da geçmişten seçilen) işin tek ekranda görünümü:
 *  başlık (mükellef büyük · konu · kapsüller · ilerleme halkası) → aşama kartları → sol: zaman çizgisi · sağ: "Şu an" / Özet + cevap kutusu
 *  → Sonuç: bulgular tablosu (sol) + karar kartları / sorular / kuru test / öğrendikleri (sağ).
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

  const yerelCevapBos = !!kosu?.bitti && (!kosu.cevap || kosu.cevap === '(boş yanıt)');
  const kokGetirilsin = !!kokAdim?.isId && (!kosu || yerelCevapBos);
  const kokS = useQuery({ queryKey: ['ekip-is', kokAdim?.isId], queryFn: () => getIs(kokAdim!.isId), enabled: kokGetirilsin, staleTime: 15_000, retry: 1, refetchInterval: sunucuCalisiyor ? 8_000 : false });
  const kokIs: IsDosyasi | undefined = kokS.data;

  const yerelAdimlar: Adim[] = kosu ? kosu.adimlar : (kokIs?.result?.toolUses || []).map((t, i) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: kokIs?.startedAt ? new Date(kokIs.startedAt).getTime() + i : Date.now(), durum: 'bitti' as const }));
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
  const kuru = kosu ? kosu.dryRun : vaka ? vaka.kuru : kokIs ? kokIs.dryRun : true;
  const kaynak = kosu?.kaynak === 'sabahOzeti' ? { ad: 'sabah özeti', ikon: '' } : kaynakEtiketi(kokIs?.kaynak || null);
  const sabahOzetiMi = kosu?.kaynak === 'sabahOzeti';
  const durduruldu = hata === DURDURULDU_METNI;
  const durumAd = hata ? (durduruldu ? 'Durduruldu' : 'Yarım kaldı') : calisiyor ? 'Sürüyor' : bitti ? 'Tamamlandı' : 'Bekliyor';
  const ton = hata ? 'coral' : calisiyor ? 'mavi' : bitti ? 'mint' : 'notr';

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
  const halkaRenk = hata ? V5.coral : calisiyor ? V5.mavi : V5.mint;
  const calisanAdim = yerelAdimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
  const calisanPersonel = personelAdimlari.find((a) => a.durum === 'running');
  const suAnMetni = calisiyor
    ? calisanAdim
      ? `Koordinatör: ${adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd).baslik}`
      : calisanPersonel
        ? `${ajanTamAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))} çalışıyor — ${calisanPersonel.baslik}`
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
  const sonucVar = !!raporMetni || acikKalemler.length > 0 || yerelOnaylar.length > 0 || sorular.length > 0 || kuruListesi.length > 0 || ogrenilen.length > 0 || (sabahOzetiMi && !!kosu?.bitti);
  const kararBekliyor = acikKalemler.length > 0 || yerelOnaylar.length > 0;
  const baslikMetni = sabahOzetiMi ? (calisiyor ? 'Sabah özeti üretiliyor' : 'Sabah özeti') : mukellef || konu || 'İş';

  return (
    <CamKart
      ton={ton}
      etiket="Aktif iş"
      ikon={sabahOzetiMi ? <Sunrise size={17} /> : <Clock size={17} />}
      baslik={durumAd}
      dolguYok
      sag={
        <>
          {calisiyor && !sabahOzetiMi && (
            <Dug kucuk tur="tehlike" onClick={durdur} disabled={durduruluyor} title="Koşu sunucuda durdurulur">
              {durduruluyor ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />} Durdur
            </Dug>
          )}
          {!calisiyor && !sabahOzetiMi && (
            <Dug kucuk onClick={tekrar} title="Görev kutusunu aynı görevle doldurur (kuru); çalıştırmaz">
              <RotateCcw size={12} /> Tekrar
            </Dug>
          )}
          {!calisiyor && onKapat && (
            <Dug kucuk tur="hayalet" onClick={onKapat} title="Paneli kapat">
              <X size={13} />
            </Dug>
          )}
        </>
      }
    >
      {/* Başlık satırı: mükellef büyük · konu · kapsüller · halka */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[22px] font-extrabold leading-tight tracking-tight" style={{ color: V5.metin, fontFamily: "var(--font-body, 'Inter'), system-ui, sans-serif" }} title={baslikMetni}>
            {baslikMetni}
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[13.5px]" style={{ color: V5.ikincil }}>
            {mukellef && !sabahOzetiMi && <span className="min-w-0 truncate" title={konu}>{konu}</span>}
            {kuru ? <Kapsul tur="kuru">kuru test</Kapsul> : <Kapsul tur="canli" nokta>canlı</Kapsul>}
            {calisiyor ? (
              <Kapsul tur="calisiyor" nokta nabiz>
                {calisanPersonel ? `${ajanKisaAd(calisanPersonel.ajanId, ajanAd(calisanPersonel.ajanId))} çalışıyor` : 'Koordinatör çalışıyor'}
              </Kapsul>
            ) : hata ? (
              <Kapsul tur="hata" nokta>
                {durduruldu ? 'durduruldu' : 'yarım kaldı'}
              </Kapsul>
            ) : bitti ? (
              <Kapsul tur="bitti" nokta>
                bitti{sureMetni ? ` · ${sureMetni}` : ''}
              </Kapsul>
            ) : null}
            {kararBekliyor && (
              <Kapsul tur="karar" nokta>
                kararınız bekleniyor
              </Kapsul>
            )}
            {kaynak.ad !== 'portal' && !sabahOzetiMi && <span className="text-[12px]" style={{ color: V5.soluk }}>{kaynak.ikon} {kaynak.ad}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3.5">
          <Halka yuzde={yuzde} renk={halkaRenk} etiket={hata ? 'YARIM' : yuzde >= 100 ? 'BİTTİ' : 'İLERLEME'} />
          <div className="flex flex-col gap-0.5">
            <b className="text-[13.5px]" style={{ color: V5.metin }}>
              {calisiyor ? `${asamaListesi.find((a) => a.durum === 'aktif')?.ad || 'Sürüyor'} · ${sureMetni}` : `${asamaListesi.length} aşama${sureMetni ? ` · ${sureMetni}` : ''}`}
            </b>
            <span className="text-[12px]" style={{ color: V5.ikincil }}>
              {calisiyor ? `Başladı ${saatKisa(basladi).slice(0, 5)} · kimde: ${kimde === 'siz' ? 'siz' : ajanKisaAd(kimde, vaka?.kimde.ad)}` : `${saatKisa(basladi).slice(0, 5)}${sonBitis ? ` → ${saatKisa(sonBitis).slice(0, 5)}` : ''} · ${adimSayisi} adım${personelAdlari.length ? ` · ${personelAdlari.length} personel` : ''}`}
            </span>
          </div>
        </div>
      </div>

      {/* Aşama kartları */}
      <div className="grid gap-2.5 px-5 pb-4" style={{ gridTemplateColumns: `repeat(${asamaListesi.length}, minmax(0, 1fr))` }}>
        {asamaListesi.map((a, i) => (
          <AsamaKarti key={a.ad} no={i + 1} asama={a} zaman={asamaZamani(i)} son={i === asamaListesi.length - 1} />
        ))}
      </div>

      {hata && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: 'rgba(255,107,122,0.10)', border: '1px solid rgba(255,107,122,0.45)', color: V5.metin }}>
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: V5.coral }} />
          <span>{durduruldu ? 'Durduruldu — koşu sunucuda iptal edildi.' : hata}</span>
        </div>
      )}

      {/* Gövde: zaman çizgisi + sağ panel */}
      <div className="grid gap-4 px-5 pb-5 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <ol className="flex max-h-[560px] min-w-0 flex-col overflow-y-auto pl-2 pr-2 [scrollbar-width:thin]">
          {!yerelAdimlar.length && !personelAdimlari.length && !bildirimAdimlari.length && (
            <li className="py-3 text-[12.5px]" style={{ color: V5.ikincil }}>
              {calisiyor ? 'İlk adım bekleniyor…' : 'Adım kaydı yok.'}
            </li>
          )}
          {yerelAdimlar.map((a, i) => (
            <YerelAdim key={`${a.zaman}-${i}`} adim={a} mukellefAd={mukellefAd} ajanAd={ajanAd} ajanId={kosu?.ajanId || kokAdim?.ajanId || 'koordinator'} />
          ))}
          {personelAdimlari.map((a) => (
            <PersonelAdimi key={a.isId} adim={a} ajanAd={ajanAd} mukellefAd={mukellefAd} acikVarsayilan={a.durum === 'running'} onRapor={personelRaporAl} />
          ))}
          {bildirimAdimlari.map((a, i) =>
            a.tip === 'onay' ? (
              <ZamanSatiri key={`onay-${a.id}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma={ajanKisaltma(a.ajanId)} ton={a.durum === 'PENDING' ? 'altin' : a.durum === 'EXECUTED' ? 'mavi' : 'gri'} baslik={`Onay kaydı #PRV-${a.id.slice(0, 8)}`} alt={`${a.durum === 'EXECUTED' ? 'gönderildi' : a.durum === 'PENDING' ? 'onay bekliyor' : a.durum === 'REJECTED' ? 'reddedildi' : a.durum === 'EXPIRED' ? 'süresi doldu' : a.durum}${a.baslik ? ` · ${a.baslik}` : ''}`} />
            ) : (
              <ZamanSatiri key={`not-${a.id || i}`} saat={saatKisa(a.baslangic).slice(0, 5)} kisaltma="MB" ton="mor" baslik={a.tur === 'istek' ? 'Sizden istendi' : a.tur === 'onay' ? 'Onayınıza sunuldu' : 'Koordinatör notu'} alt={`${a.baslik}${a.durum === 'kapandi' ? ' · kapandı' : ''}`}>
                {a.govde && (
                  <div className="mt-0.5 whitespace-pre-wrap text-[11.5px]" style={{ color: V5.soluk }}>
                    {a.govde}
                  </div>
                )}
              </ZamanSatiri>
            ),
          )}
        </ol>

        <aside className="flex flex-col gap-3.5 self-start rounded-[14px] p-4" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi2}` }}>
          {calisiyor ? (
            <>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: V5.soluk }}>
                <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: V5.mavi, boxShadow: `0 0 10px ${V5.mavi}` }} /> Şu an
              </div>
              <div className="text-[14px] font-semibold leading-snug" style={{ color: V5.metin }}>
                {suAnMetni}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <i className="block h-full rounded-full" style={{ width: `${Math.max(6, yuzde)}%`, background: 'linear-gradient(90deg, #3b6fd6, #6ea3ff, #4dd6e6)', boxShadow: '0 0 12px rgba(110,163,255,0.5)', transition: 'width .6s ease' }} />
              </div>
              <KV
                satirlar={[
                  ['Süre', sureMetni],
                  ['Adım', String(adimSayisi)],
                  ['Kimde', kimde === 'siz' ? 'siz' : ajanKisaAd(kimde, vaka?.kimde.ad)],
                  ['Mod', kuru ? 'kuru test' : 'canlı'],
                ]}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: V5.soluk }}>
                <BarChart3 size={13} /> Özet
              </div>
              <KV
                satirlar={[
                  ['Süre', sureMetni || '—'],
                  ['Adım', String(adimSayisi)],
                  ['Personel', personelAdlari.length ? personelAdlari.join(', ') : 'Koordinatör'],
                  ['Mod', kuru ? 'kuru test' : 'canlı'],
                  ['Kimde', kimde === 'siz' ? 'siz' : ajanKisaAd(kimde, vaka?.kimde.ad)],
                  ...(vaka?.olusturuldu ? [['Açıldı', goreliSaat(vaka.olusturuldu)] as [string, ReactNode]] : []),
                  ...(kosu?.model || kokIs?.model ? [['Model', String(kosu?.model || kokIs?.model).replace(/^claude-/, '')] as [string, ReactNode]] : []),
                ]}
              />
            </>
          )}
          {!sabahOzetiMi && <CevapKutusu calisiyor={calisiyor || aktifKosuVar} bekleyen={bekleyenCevap} onGonder={cevapla} onIptal={() => setBekleyenCevap(null)} />}
          {sabahOzetiMi && kosu?.bitti && !kosu.hata && (
            <div className="flex flex-col gap-2">
              <Dug tur="mint" disabled={gonderMesgul || gonderTeyit || !!kosular.aktifKosu} onClick={() => setGonderTeyit(true)} title="Koordinatör özeti yeniden üretir ve WhatsApp'a gönderir">
                {gonderMesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Muzaffer Bey’e WhatsApp gönder
              </Dug>
              {gonderTeyit && <OnayTeyit metin={<>Numaralarınıza <b>GERÇEK</b> mesaj gidecek — koordinatör özeti <b>yeniden üretir ve gönderir</b> (30-90 sn).</>} mesgul={gonderMesgul} onEvet={sahibeGonder} onVazgec={() => setGonderTeyit(false)} />}
            </div>
          )}
        </aside>
      </div>

      {/* Sonuç */}
      {(sonucVar || (calisiyor && !!kosu?.cevap)) && (
        <div className="grid gap-4 px-5 pb-5 2xl:grid-cols-[minmax(0,1fr)_330px]" style={{ borderTop: `1px solid ${V5.cizgi}`, paddingTop: 18 }}>
          <div className="min-w-0">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: V5.soluk }}>
              <span className="inline-flex items-center gap-2">
                <FileText size={13} /> {sonBitenPersonel ? `Bulgular · ${ajanTamAd(sonBitenPersonel.ajanId, ajanAd(sonBitenPersonel.ajanId))}` : sabahOzetiMi ? 'Sabah özeti' : 'Sonuç · Koordinatör'}
              </span>
              <span className="normal-case tracking-normal" style={{ fontFamily: V5.mono }}>
                {kokS.isLoading && !kokIs ? 'yükleniyor…' : `${sonBitis ? saatKisa(sonBitis).slice(0, 5) : saatKisa(basladi).slice(0, 5)} · ${kuru ? 'kuru test' : 'canlı'}`}
              </span>
            </div>
            {calisiyor && !raporMetni && kosu?.cevap && (
              <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl px-3.5 py-3 text-[13px] leading-relaxed" style={camBlok({ color: V5.ikincil })}>
                {kosu.cevap}
              </div>
            )}
            {raporMetni && (
              <>
                <RaporGorunumu rapor={ayrisik?.rapor || raporMetni} />
                {sonBitenPersonel && koordinatorRaporu && (
                  <details className="mt-3 rounded-xl px-3.5 py-2" style={camBlok()}>
                    <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: V5.soluk }}>
                      Koordinatör’ün notu
                    </summary>
                    <div className="pt-2">
                      <RaporGorunumu rapor={koordinatorRaporu} kompakt />
                    </div>
                  </details>
                )}
              </>
            )}
            {!raporMetni && !calisiyor && !hata && (
              <div className="rounded-xl px-3.5 py-6 text-center text-[12.5px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
                Rapor yok.
              </div>
            )}
            {ogrenilen.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <GraduationCap size={13} style={{ color: V5.mor }} />
                {ogrenilen.map((o, i) => (
                  <span key={i} className="rounded-md px-2 py-0.5 text-[11.5px]" style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.4)', color: V5.metin }}>
                    {o}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {acikKalemler.map((k) => (
              <AcikKalemKarti key={`${k.tip}-${k.id}`} kalem={k} onBitti={tazele} onCevapla={cevapla} calisiyor={calisiyor || aktifKosuVar} />
            ))}
            {kosu && yerelOnaylar.map((a) => <YerelOnay key={a.previewId} adim={a} kosu={kosu} kosular={kosular} onBitti={tazele} />)}
            {sorular.length > 0 && (
              <div className="rounded-[14px] p-4" style={{ background: 'linear-gradient(160deg, rgba(242,182,77,0.16), rgba(242,182,77,0.04))', border: '1px solid rgba(242,182,77,0.45)' }}>
                <div className="flex items-center gap-2 text-[14px] font-extrabold" style={{ color: V5.metin }}>
                  <HelpCircle size={15} style={{ color: V5.amber }} /> {ajanKisaAd(kimde)} soruyor
                </div>
                {sorular.map((s, i) => (
                  <div key={i} className="mt-1.5 whitespace-pre-wrap text-[12.8px] leading-relaxed" style={{ color: V5.ikincil }}>
                    {s}
                  </div>
                ))}
                <div className="mt-3 flex flex-col gap-2">
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
                    className="h-9 min-w-0 rounded-[10px] px-3 text-[12.5px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${V5.cizgi2}`, color: V5.metin }}
                  />
                  <Dug tur="mavi" disabled={!cevapMetni.trim()} onClick={() => { cevapla(cevapMetni.trim()); setCevapMetni(''); }} title="Aynı iş zincirinde Koordinatör'e gider">
                    <MessageSquareReply size={13} /> Cevapla
                  </Dug>
                </div>
              </div>
            )}
            {kuruListesi.length > 0 && (
              <div className="rounded-[14px] p-4" style={camBlok()}>
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: V5.amber }}>
                  <FlaskConical size={13} /> Kuru test — yapılacaktı ({kuruListesi.length})
                </div>
                <ul className="flex flex-col gap-1 text-[12.3px]" style={{ color: V5.metin }}>
                  {kuruListesi.map((t, i) => {
                    const { baslik, ayrinti } = adimAciklamasi(t.name, t.args, mukellefAd, ajanAd);
                    return (
                      <li key={i} className="flex gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: V5.amber }} />
                        <span>
                          {baslik}
                          {ayrinti && <span style={{ color: V5.soluk }}> · {ayrinti}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {!acikKalemler.length && !yerelOnaylar.length && !sorular.length && !kuruListesi.length && bitti && !hata && (
              <div className="rounded-[14px] p-4 text-[12.5px] leading-relaxed" style={camBlok({ color: V5.ikincil })}>
                <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: V5.mint }}>
                  <Check size={13} /> Sizden bir şey beklemiyor
                </div>
                İş kapandı. İsterseniz sağ üstteki <b style={{ color: V5.metin }}>Tekrar</b> ile aynı görevi yeniden verirsiniz ya da yukarıdaki kutudan talimat yazarsınız.
              </div>
            )}
          </div>
        </div>
      )}
    </CamKart>
  );
}
