'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Activity, CalendarCheck, Sunrise, FlaskConical, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { sabahOzetiUret, isZamanAsimi, type EkipDurum, type EkipOnay, type IsDosyasi, type Pano } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { hedefMetni } from './OnayBekleyenler';
import { EKIP_ACCENT, RENK, bugunMu, donemEtiketi, goreliSaat, kalanSure, kartArkaPlan, saatKisa } from './ortak';

function Kutu({
  renk,
  ikon,
  sayi,
  etiket,
  alt,
  onClick,
  className = '',
  ek,
}: {
  renk: string;
  ikon: ReactNode;
  sayi: ReactNode;
  etiket: string;
  alt: ReactNode;
  onClick?: () => void;
  className?: string;
  ek?: ReactNode;
}) {
  const stil: CSSProperties = { ...kartArkaPlan(renk), minHeight: 76 };
  const icerik = (
    <>
      <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full" style={{ background: `radial-gradient(circle, ${renk}33, transparent 70%)` }} />
      <div className="relative flex flex-wrap items-center gap-2.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: `${renk}1f`, color: renk }}>
          {ikon}
        </span>
        <div className="min-w-[120px] flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-black leading-none tabular-nums" style={{ color: RENK.metin }}>{sayi}</span>
            <span className="truncate text-[11px] font-semibold" style={{ color: renk }}>{etiket}</span>
          </div>
          <div className="mt-1 truncate text-[11px]" style={{ color: RENK.ikincil }}>{alt}</div>
        </div>
        {ek}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`relative overflow-hidden rounded-xl px-3 py-2.5 text-left transition-transform hover:scale-[1.01] ${className}`} style={stil}>
        {icerik}
      </button>
    );
  }
  return (
    <div className={`relative overflow-hidden rounded-xl px-3 py-2.5 ${className}`} style={stil}>
      {icerik}
    </div>
  );
}

/**
 * Sabah bandı — 5 sayaç: bekleyen onay (altın) · koşu bugün · beyanname hazır · sabah özeti (+Şimdi üret, gönderme YOK) · KURU varsayılan.
 * Veriler isler(200) / onaylar / pano'dan istemcide; backend #2 gelince durum.calisan/bugunHata/sonSabahOzeti kullanılır.
 */
export function SabahBandi({
  durum,
  onaylar,
  isler,
  pano,
  panoYukleniyor,
  ajanAd,
  mukellefAd,
  kosular,
  onOnayaGit,
  onBugunKosulara,
  onPanoyaGit,
  onKomutOdak,
}: {
  durum: EkipDurum | undefined;
  onaylar: EkipOnay[];
  isler: IsDosyasi[];
  pano: Pano | undefined;
  panoYukleniyor: boolean;
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  kosular: KosularApi;
  onOnayaGit: () => void;
  onBugunKosulara: () => void;
  onPanoyaGit: () => void;
  onKomutOdak: () => void;
}) {
  const qc = useQueryClient();
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);

  // 1 — bekleyen onay
  const bekleyen = durum?.bekleyenOnay ?? onaylar.length;
  const enEski = useMemo(() => [...onaylar].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0], [onaylar]);

  // 2 — koşu bugün (FE yedeği)
  const bugunkuler = useMemo(() => isler.filter((i) => bugunMu(i.createdAt)), [isler]);
  const bugunKosu = durum?.bugunKosu ?? bugunkuler.length;
  const calisan = durum?.calisan ?? bugunkuler.filter((i) => i.status === 'running').length;
  const bugunHata = durum?.bugunHata ?? bugunkuler.filter((i) => i.status === 'failed').length;
  const bugunKuru = bugunkuler.filter((i) => i.dryRun).length;
  const bugunCanli = bugunkuler.length - bugunKuru;

  // 3 — beyanname hazır (pano ilk dönem)
  const ozet = pano?.donemOzetleri[0];

  // 4 — sabah özeti (koordinatör + kaynak cron, en yeni)
  const sonSabah = useMemo(() => {
    if (durum?.sonSabahOzeti) return { createdAt: durum.sonSabahOzeti.createdAt, ilkSatir: durum.sonSabahOzeti.raporIlkSatir || '' };
    const k = isler.find((i) => i.ajanId === 'koordinator' && i.kaynak === 'cron');
    return k ? { createdAt: k.createdAt, ilkSatir: (k.raporOzet || k.result?.rapor || '').split('\n')[0] } : null;
  }, [isler, durum?.sonSabahOzeti]);
  const sabahBugun = !!sonSabah && bugunMu(sonSabah.createdAt);

  // 5 — son canlı koşu
  const sonCanli = useMemo(() => isler.find((i) => i.dryRun === false), [isler]);

  // TEK AKTİF KOŞU KİLİDİ (§2/§9): HERHANGİ bir ajan koşarken (koordinatör dahil) "Şimdi üret" pasif → iki Max koşusu aynı anda olmaz.
  const kilitli = uretiliyor || Date.now() < kilitliyeKadar || !!kosular.aktifKosu;

  /**
   * Şimdi üret — gonder:false; sonuç CanliAkis'te (koordinatör koşusu olarak) görünür.
   * İstek BAŞLARKEN haritaya `bitti:false` yazılır → aktifKosu dolar: KomutKutusu "KO çalışıyor — bitince" gösterir,
   * CanliAkis sayaç işletir. Bitince/zaman aşımında/hatada `bitti:true` ile kapatılır ki kilit çözülsün.
   */
  const simdiUret = async () => {
    if (kilitli) return;
    setUretiliyor(true);
    const basladi = Date.now();
    kosular.ayarla('koordinator', {
      ajanId: 'koordinator',
      gorev: 'Sabah özeti — üretiliyor (gönderme yok)',
      dryRun: true,
      cevap: '',
      adimlar: [],
      bitti: false,
      basladi,
      kaynak: 'sabahOzeti',
    });
    try {
      const r = await sabahOzetiUret({ gonder: false });
      kosular.ayarla('koordinator', {
        ajanId: 'koordinator',
        gorev: 'Sabah özeti (şimdi üretildi)',
        dryRun: true,
        isId: r.isId,
        model: r.model,
        cevap: r.rapor || '',
        adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, zaman: Date.now(), durum: 'bitti' as const })),
        bitti: true,
        hata: r.hata,
        durationMs: r.durationMs ?? Date.now() - basladi,
        basladi,
        kaynak: 'sabahOzeti',
        gonderildi: 0,
      });
      toast.success('Sabah özeti üretildi', { description: 'İş dosyalarında da var.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? "Sürüyor — İş Dosyaları'nda görünecek" : e?.message || 'Sabah özeti üretilemedi';
      // Koşuyu KAPAT (bitti:true) — kilit 150 sn sonra çözülsün; sonuç iş dosyalarında
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) {
        toast.info(hata);
        setKilitliyeKadar(Date.now() + 3 * 60_000); // çift tık yok: düğme 3 dk kilitli
      } else {
        toast.error(hata);
      }
    } finally {
      setUretiliyor(false);
      qc.invalidateQueries({ queryKey: ['ekip-isler'] });
      qc.invalidateQueries({ queryKey: ['ekip-durum'] });
      qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      <Kutu
        renk={bekleyen ? RENK.altin : RENK.sonuk}
        ikon={<ShieldCheck size={16} />}
        sayi={bekleyen}
        etiket="bekleyen onay"
        alt={
          enEski
            ? `en eski ${kalanSure(enEski.expiresAt).metin} · ${enEski.ajanAd} → ${hedefMetni(enEski, mukellefAd) || 'hedef'}`
            : 'kuru testte hiç düşmez'
        }
        onClick={onOnayaGit}
      />
      <Kutu
        renk={EKIP_ACCENT}
        ikon={<Activity size={16} />}
        sayi={bugunKosu}
        etiket="koşu bugün"
        alt={`${calisan} çalışıyor · ${bugunHata} hata · ${bugunKuru} kuru / ${bugunCanli} canlı`}
        onClick={onBugunKosulara}
      />
      <Kutu
        renk={RENK.mor}
        ikon={<CalendarCheck size={16} />}
        sayi={panoYukleniyor || !ozet ? <span className="inline-block h-5 w-12 animate-pulse rounded" style={{ background: `${RENK.mor}22` }} /> : `${ozet.ozet.beyannameHazir}/${ozet.toplam}`}
        etiket={ozet ? `beyanname hazır · ${donemEtiketi(ozet.donem)}` : 'beyanname hazır'}
        alt={ozet ? `verildi ${ozet.ozet.beyanname} · evrak eksik ${Math.max(0, ozet.toplam - ozet.ozet.evrak)} · kontrol ${ozet.ozet.kontrol}` : 'pano yükleniyor…'}
        onClick={onPanoyaGit}
      />
      <Kutu
        renk={EKIP_ACCENT}
        ikon={<Sunrise size={16} />}
        sayi={<span className="text-sm font-bold">{sabahBugun ? `Sabah özeti ${saatKisa(sonSabah!.createdAt).slice(0, 5)} ✓` : 'Bugün üretilmedi'}</span>}
        etiket=""
        alt={sabahBugun && sonSabah?.ilkSatir ? sonSabah.ilkSatir.slice(0, 60) : durum?.sabahOzeti === false ? 'cron KAPALI' : sonSabah ? `son: ${goreliSaat(sonSabah.createdAt)}` : 'henüz üretilmedi'}
        ek={
          <button
            type="button"
            disabled={kilitli}
            onClick={simdiUret}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${EKIP_ACCENT}, ${EKIP_ACCENT}aa)`, color: '#0b1218' }}
            title="Yalnız üretir; sahibe göndermez (gönderim CanliAkis'te ayrı düğme)"
          >
            {uretiliyor ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {uretiliyor ? 'Üretiliyor… (30-90 sn)' : Date.now() < kilitliyeKadar ? 'Sürüyor…' : kosular.aktifKosu ? 'Koşu sürüyor — bitince' : 'Şimdi üret'}
          </button>
        }
      />
      <Kutu
        renk={RENK.yesil}
        ikon={<FlaskConical size={16} />}
        sayi={<span className="text-sm font-bold">KURU varsayılan</span>}
        etiket=""
        alt={sonCanli ? `son canlı koşu ${goreliSaat(sonCanli.createdAt)} · ${ajanAd(sonCanli.ajanId)}` : 'hiç canlı koşu yok'}
        onClick={onKomutOdak}
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
}
