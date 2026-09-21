'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, Eye, Loader2, Pause, Play, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, istekKapat, onayla, type EkipOnay, type Kuyruk, type Rutin, type Vaka, type VakaAdimIs } from '@/lib/ekip';
import type { BekleyenKalem } from '../Kararlar';
import type { Kosu } from '../kosular';
import { OnayTeyit } from '../OnayBekleyenler';
import { adimAciklamasi, ajanKisaAd, ajanTamAd, aracAdi, bugunMu, kalanSure, konuKisalt, sayacMetni, sureKisa } from '../ortak';
import { BosDurum, Cip, OfisAvatar } from './Parcalar';
import { saatEtiketi } from './yardimci';

/* ─────────────────────────── satır modeli ─────────────────────────── */

type Grup = 'beklenen' | 'suan' | 'sirada' | 'bitti';

const GRUP_BASLIK: Record<Grup, string> = { beklenen: 'Sizden beklenen', suan: 'Şu an', sirada: 'Sırada', bitti: 'Bitti' };

type Satir =
  | { grup: 'beklenen'; anahtar: string; tur: 'onay' | 'karar' | 'istek' | 'yarim'; vaka: Vaka; kalem?: BekleyenKalem['kalem']; ajanId: string; onay?: EkipOnay | null }
  | { grup: 'suan'; anahtar: string; tur: 'kuyruk'; kuyruk: Kuyruk }
  | { grup: 'suan'; anahtar: string; tur: 'kosu'; ajanId: string; mukellef: string; konu: string; basladi: number; kuru: boolean; suAn: string; vaka?: Vaka; kosu?: Kosu; kosanIsId?: string }
  | { grup: 'sirada'; anahtar: string; tur: 'rutin'; rutin: Rutin }
  | { grup: 'sirada'; anahtar: string; tur: 'kuyrukBekliyor'; kuyruk: Kuyruk }
  | { grup: 'sirada'; anahtar: string; tur: 'vakaSirada'; vaka: Vaka; ajanId: string }
  | { grup: 'bitti'; anahtar: string; tur: 'vaka'; vaka: Vaka; ajanId: string };

function sonPersonel(v: Vaka): string {
  const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
  return [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator')?.ajanId || isAdimlari[0]?.ajanId || 'koordinator';
}

/** Sunucuda koşan işin canlı adımı (8 sn yoklama). */
function CanliAdim({ isId, ajanAd, mukellefAd, simdi, yedek }: { isId: string; ajanAd: (id: string) => string; mukellefAd: (id?: string | null) => string | undefined; simdi: number; yedek: string }) {
  const { data } = useQuery({ queryKey: ['ekip-is', isId], queryFn: () => getIs(isId), staleTime: 5_000, retry: 1, refetchInterval: 8_000 });
  const adimlar = data?.canli?.adimlar || [];
  const son = adimlar.length ? adimlar[adimlar.length - 1] : null;
  if (!son) return <>{yedek}</>;
  const { baslik } = adimAciklamasi(son.ad, son.args, mukellefAd, ajanAd);
  const bas = new Date(son.basladi).getTime();
  return (
    <>
      şu an: {baslik}
      {son.durum === 'suruyor' && bas ? ` · ${sayacMetni(simdi - bas)}` : ''}
    </>
  );
}

/* ─────────────────────────── satır ─────────────────────────── */

function Satir({ avatar, mukellef, is, alt, cip, dugme, onAc, ek, canli }: { avatar: ReactNode; mukellef: ReactNode; is: ReactNode; alt?: ReactNode; cip: ReactNode; dugme: ReactNode; onAc?: () => void; ek?: ReactNode; canli?: boolean }) {
  const Icerik = (
    <>
      <span className="of-satir-avatar">{avatar}</span>
      <span className="of-satir-mukellef">{mukellef}</span>
      <span className="of-satir-is">
        <span className="of-satir-is-ad">{is}</span>
        {alt && <span className="of-satir-alt">{alt}</span>}
      </span>
      <span className="of-satir-cip">{cip}</span>
    </>
  );
  return (
    <li className="of-satir" data-canli={canli || undefined}>
      {onAc ? (
        <button type="button" className="of-satir-govde of-satir-tikla" onClick={onAc} title="İşi aç">
          {Icerik}
        </button>
      ) : (
        <div className="of-satir-govde">{Icerik}</div>
      )}
      <span className="of-satir-dugme">{dugme}</span>
      {ek && <div className="of-satir-ek">{ek}</div>}
    </li>
  );
}

/* ─────────────────────────── liste ─────────────────────────── */

export function Bugun({
  kosu,
  vakalar,
  bekleyenler,
  onaylar,
  kuyruklar,
  rutinler,
  ajanAd,
  mukellefAd,
  onAc,
  onIsAc,
  onKuyrukDurdur,
  onKuyrukDevam,
  kuyrukMesgul,
  onBitti,
  yukleniyor,
  hata,
}: {
  kosu: Kosu | undefined;
  vakalar: Vaka[] | undefined;
  bekleyenler: BekleyenKalem[];
  onaylar: EkipOnay[];
  kuyruklar: Kuyruk[];
  rutinler: Rutin[];
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  onAc: (vakaId: string | null) => void;
  onIsAc: (isId: string) => void;
  onKuyrukDurdur: (id: string) => void;
  onKuyrukDevam: (id: string) => void;
  kuyrukMesgul: boolean;
  onBitti: () => void;
  yukleniyor?: boolean;
  hata?: unknown;
}) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const [teyit, setTeyit] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const onayHaritasi = useMemo(() => new Map(onaylar.map((o) => [o.previewId, o])), [onaylar]);

  const satirlar = useMemo<Satir[]>(() => {
    const out: Satir[] = [];
    const yerelVakaId = kosu && !kosu.bitti ? kosu.vakaId || kosu.isId : undefined;
    const kalemliVakalar = new Set(bekleyenler.map((b) => b.vaka.vakaId));

    // Sizden beklenen: açık kalemler (onay · karar · istek) + bugün yarım kalanlar
    for (const b of bekleyenler) {
      const tur = b.kalem.tip === 'onay' ? (b.kalem.kaynak === 'PRV' ? 'onay' : 'karar') : 'istek';
      out.push({ grup: 'beklenen', anahtar: `k-${b.vaka.vakaId}-${b.kalem.id}`, tur, vaka: b.vaka, kalem: b.kalem, ajanId: b.ajanId, onay: tur === 'onay' ? onayHaritasi.get(b.kalem.id) || null : null });
    }
    for (const v of vakalar || []) {
      if (v.durum === 'hata' && !kalemliVakalar.has(v.vakaId) && bugunMu(v.guncellendi)) out.push({ grup: 'beklenen', anahtar: `y-${v.vakaId}`, tur: 'yarim', vaka: v, ajanId: sonPersonel(v) });
    }

    // Şu an: kuyruklar (süren · duran · kota bekleyen) + yerel koşu + sunucuda süren vakalar
    for (const k of kuyruklar) if (k.durum === 'suruyor' || k.durum === 'durduruldu' || k.durum === 'kota_bekliyor') out.push({ grup: 'suan', anahtar: `q-${k.id}`, tur: 'kuyruk', kuyruk: k });
    if (kosu && !kosu.bitti) {
      const calisanAdim = kosu.adimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
      out.push({
        grup: 'suan',
        anahtar: 'yerel',
        tur: 'kosu',
        kosu,
        ajanId: kosu.ajanId,
        mukellef: kosu.kaynak === 'sabahOzeti' ? 'Sabah özeti' : mukellefAd(kosu.taxpayerId) || 'Ofis geneli',
        konu: kosu.kaynak === 'sabahOzeti' ? 'Koordinatör bugünü topluyor' : konuKisalt(kosu.gorev, 80),
        basladi: kosu.basladi,
        kuru: kosu.dryRun,
        suAn: calisanAdim ? `şu an: ${adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd).baslik}` : kosu.isId ? `${ajanKisaAd(kosu.ajanId, ajanAd(kosu.ajanId))} düşünüyor` : `${ajanKisaAd(kosu.ajanId, ajanAd(kosu.ajanId))} göreve başlıyor`,
      });
    }
    for (const v of vakalar || []) {
      if (v.kutu !== 'suruyor') continue;
      if (yerelVakaId && (v.vakaId === yerelVakaId || v.adimlar.some((a) => a.tip === 'is' && a.isId === yerelVakaId))) continue;
      const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
      const kosan = isAdimlari.find((a) => a.durum === 'running');
      const bekleyen = !kosan && isAdimlari.find((a) => a.durum === 'pending');
      if (!kosan && bekleyen) {
        out.push({ grup: 'sirada', anahtar: `s-${v.vakaId}`, tur: 'vakaSirada', vaka: v, ajanId: bekleyen.ajanId });
        continue;
      }
      const ajanId = kosan?.ajanId || v.kimde.ajanId;
      out.push({
        grup: 'suan',
        anahtar: `v-${v.vakaId}`,
        tur: 'kosu',
        vaka: v,
        ajanId,
        mukellef: v.mukellef?.ad || 'Ofis geneli',
        konu: v.konu,
        basladi: new Date(kosan?.baslangic || v.olusturuldu).getTime(),
        kuru: v.kuru,
        suAn: kosan ? `${ajanTamAd(kosan.ajanId, ajanAd(kosan.ajanId))} çalışıyor` : 'Sırada',
        kosanIsId: kosan?.isId,
      });
    }

    // Sırada: bekleyen kuyruklar + bugün planlı rutinler
    for (const k of kuyruklar) if (k.durum === 'bekliyor') out.push({ grup: 'sirada', anahtar: `qb-${k.id}`, tur: 'kuyrukBekliyor', kuyruk: k });
    for (const r of rutinler) if (r.aktif && r.bugun.planlanan > r.bugun.biten + r.bugun.hatali) out.push({ grup: 'sirada', anahtar: `r-${r.id}`, tur: 'rutin', rutin: r });

    // Bitti: bugün biten (yarım olmayan; kalemi olmayan)
    const bitenler = (vakalar || [])
      .filter((v) => v.kutu === 'bitti' && v.durum !== 'hata' && bugunMu(v.guncellendi) && !kalemliVakalar.has(v.vakaId))
      .sort((a, b) => new Date(b.guncellendi).getTime() - new Date(a.guncellendi).getTime())
      .slice(0, 8);
    for (const v of bitenler) out.push({ grup: 'bitti', anahtar: `b-${v.vakaId}`, tur: 'vaka', vaka: v, ajanId: sonPersonel(v) });
    return out;
  }, [kosu, vakalar, bekleyenler, onayHaritasi, kuyruklar, rutinler, ajanAd, mukellefAd]);

  const canliVar = satirlar.some((s) => s.grup === 'suan');
  useEffect(() => {
    if (!canliVar) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [canliVar]);

  const yap = async (anahtar: string, fn: () => Promise<{ ok: boolean; error?: string; zatenKapali?: boolean }>, okMetin: string) => {
    if (mesgul) return;
    setMesgul(anahtar);
    try {
      const r = await fn();
      if (r.ok) toast.success(r.zatenKapali ? 'Zaten kapalıydı' : okMetin);
      else toast.error('Olmadı', { description: r.error || 'Sunucu kabul etmedi.' });
    } catch (e: any) {
      toast.error('Olmadı', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(null);
      setTeyit(null);
      onBitti();
    }
  };

  const gruplar = (['beklenen', 'suan', 'sirada', 'bitti'] as Grup[]).map((g) => ({ g, satirlar: satirlar.filter((s) => s.grup === g) })).filter((x) => x.satirlar.length > 0);

  if (!gruplar.length) {
    return (
      <div className="of-bugun-bos">
        {!!hata && <p role="alert" className="of-hata-yazi">İş akışı yenilenemedi. Lütfen yeniden deneyin.</p>}
        <BosDurum simge={yukleniyor ? <Loader2 size={18} className="animate-spin" /> : <CalendarClock size={20} />}>
          {yukleniyor ? 'Bugünün işleri yükleniyor…' : (
            <>
              Bugün planlı iş yok — Görev ver ya da <Link href="/panel/ekip/duzen" className="of-baglanti">Düzenli işler</Link>’den açın.
            </>
          )}
        </BosDurum>
      </div>
    );
  }

  return (
    <div className="of-bugun">
      {!!hata && <p role="alert" className="of-hata-yazi">İş akışı yenilenemedi. Lütfen yeniden deneyin.</p>}
      {gruplar.map(({ g, satirlar: liste }) => (
        <section key={g} className="of-grup" aria-label={GRUP_BASLIK[g]}>
          <h3 className="of-grup-baslik" data-grup={g}>
            {GRUP_BASLIK[g]}
            {g === 'beklenen' && <span className="of-grup-sayi">{liste.length}</span>}
          </h3>
          <ul className="of-liste">
            {liste.map((s) => {
              /* ── Sizden beklenen ── */
              if (s.grup === 'beklenen') {
                const v = s.vaka;
                const teyitAcik = teyit === s.anahtar;
                const buMesgul = mesgul === s.anahtar;
                const mukellef = v.mukellef?.ad || 'Ofis geneli';
                const isAd = s.tur === 'yarim' ? v.konu || 'İş yarım kaldı' : s.tur === 'onay' ? `${s.onay?.arac ? aracAdi(s.onay.arac) : 'Dışarı mesaj'} — onayınız` : s.kalem?.baslik || v.konu;
                const kalan = s.onay?.expiresAt ? kalanSure(s.onay.expiresAt) : null;
                const alt =
                  s.tur === 'onay'
                    ? `${ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · ${s.onay?.arac ? aracAdi(s.onay.arac) : 'dışarı mesaj'}${kalan && kalan.ms > 0 ? ` · ${kalan.metin}` : ''}`
                    : s.tur === 'yarim'
                      ? `${ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · ${saatEtiketi(v.guncellendi)} · tamamlanamadı`
                      : `${ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · ${saatEtiketi(v.guncellendi)}`;
                const cip = s.tur === 'onay' ? <Cip ton="kehribar" nokta>onay bekliyor</Cip> : s.tur === 'karar' ? <Cip ton="kehribar" nokta>kararınız</Cip> : s.tur === 'istek' ? <Cip ton="kehribar" nokta>sizden istenen</Cip> : <Cip ton="kirmizi" nokta>yarım kaldı</Cip>;
                const dugme =
                  s.tur === 'onay' ? (
                    <button type="button" className="of-dugme" data-tur="birincil" disabled={buMesgul || teyitAcik} onClick={() => setTeyit(s.anahtar)}>
                      {buMesgul ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Onayla ve gönder
                    </button>
                  ) : s.tur === 'istek' ? (
                    <button type="button" className="of-dugme" data-tur="birincil" disabled={buMesgul} onClick={() => void yap(s.anahtar, () => istekKapat(s.kalem!.id), 'Yapıldı olarak kapatıldı')}>
                      {buMesgul ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Yapıldı
                    </button>
                  ) : (
                    <button type="button" className="of-dugme" data-tur="civit-yumusak" onClick={() => onAc(v.vakaId)}>
                      <Eye size={14} /> Aç
                    </button>
                  );
                return (
                  <Satir
                    key={s.anahtar}
                    avatar={<OfisAvatar ajanId={s.ajanId} boyut={36} title={ajanTamAd(s.ajanId, ajanAd(s.ajanId))} />}
                    mukellef={mukellef}
                    is={isAd}
                    alt={alt}
                    cip={cip}
                    dugme={dugme}
                    onAc={() => onAc(v.vakaId)}
                    ek={teyitAcik && s.tur === 'onay' ? <OnayTeyit metin={<>Bu mesaj <b>GERÇEKTEN</b> gidecek → #{s.kalem!.id}{s.onay?.mukellefAd ? ` · ${s.onay.mukellefAd}` : ''}</>} mesgul={buMesgul} onEvet={() => void yap(s.anahtar, () => onayla(s.kalem!.id), 'Onaylandı ve gönderildi')} onVazgec={() => setTeyit(null)} /> : undefined}
                  />
                );
              }

              /* ── Şu an: kuyruk ── */
              if (s.tur === 'kuyruk' || s.tur === 'kuyrukBekliyor') {
                const k = s.kuyruk;
                const suren = k.ogeler.find((o) => o.durum === 'suruyor');
                const yuzde = k.toplam ? Math.round(((k.biten + k.hatali) / k.toplam) * 100) : 0;
                const durumCip = k.durum === 'suruyor' ? <Cip ton="civit" nokta nabiz>sürüyor</Cip> : k.durum === 'durduruldu' ? <Cip ton="kehribar" nokta>durduruldu</Cip> : k.durum === 'kota_bekliyor' ? <Cip ton="kirmizi" nokta>kota bekliyor</Cip> : <Cip ton="kursuni" nokta>sırada</Cip>;
                const dugme =
                  k.durum === 'durduruldu' ? (
                    <button type="button" className="of-dugme" data-tur="birincil" disabled={kuyrukMesgul} onClick={() => onKuyrukDevam(k.id)}>
                      <Play size={14} /> Devam
                    </button>
                  ) : (
                    <button type="button" className="of-dugme" data-tur="tehlike" disabled={kuyrukMesgul} onClick={() => onKuyrukDurdur(k.id)}>
                      <Pause size={14} /> Durdur
                    </button>
                  );
                return (
                  <Satir
                    key={s.anahtar}
                    canli={k.durum === 'suruyor'}
                    avatar={<OfisAvatar ajanId={k.ajanId} boyut={36} canli={k.durum === 'suruyor'} title={ajanTamAd(k.ajanId, ajanAd(k.ajanId))} />}
                    mukellef={
                      <>
                        {k.ad}
                        <span className="of-satir-not">
                          {k.kaynak === 'rutin' ? 'Rutin' : 'Toplu'} · {k.dryRun ? 'kuru' : 'canlı'}
                        </span>
                      </>
                    }
                    is={
                      <>
                        <span className="of-tabular">
                          {k.biten}/{k.toplam}
                        </span>
                        {suren ? ` · şu an: ${suren.ad}` : ''}
                        {k.siradaki ? ` · sıradaki: ${k.siradaki.ad}` : ''}
                      </>
                    }
                    alt={
                      <span className="of-ilerleme" aria-hidden="true">
                        <i style={{ width: `${Math.max(yuzde > 0 ? 3 : 0, yuzde)}%` }} />
                      </span>
                    }
                    cip={durumCip}
                    dugme={dugme}
                    onAc={suren?.isId ? () => onIsAc(suren.isId!) : undefined}
                  />
                );
              }

              /* ── Şu an: koşu ── */
              if (s.tur === 'kosu') {
                const vakaId = s.vaka?.vakaId || s.kosu?.vakaId || s.kosu?.isId || null;
                return (
                  <Satir
                    key={s.anahtar}
                    canli
                    avatar={<OfisAvatar ajanId={s.ajanId} boyut={36} canli title={ajanTamAd(s.ajanId, ajanAd(s.ajanId))} />}
                    mukellef={s.mukellef}
                    is={s.konu}
                    alt={
                      <>
                        {ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · <span className="of-tabular">{sayacMetni(Math.max(0, simdi - s.basladi))}</span> · {s.kuru ? 'kuru' : 'canlı'} ·{' '}
                        {s.kosanIsId ? <CanliAdim isId={s.kosanIsId} ajanAd={ajanAd} mukellefAd={mukellefAd} simdi={simdi} yedek={s.suAn} /> : s.suAn}
                      </>
                    }
                    cip={<Cip ton="civit" nokta nabiz>sürüyor</Cip>}
                    dugme={
                      <button type="button" className="of-dugme" data-tur="civit-yumusak" onClick={() => onAc(vakaId)}>
                        <Eye size={14} /> İzle
                      </button>
                    }
                    onAc={() => onAc(vakaId)}
                  />
                );
              }

              /* ── Sırada: rutin ── */
              if (s.tur === 'rutin') {
                const r = s.rutin;
                const kalan = r.bugun.planlanan - r.bugun.biten - r.bugun.hatali;
                const baslar = r.zaman.tur === 'haftalik' ? `${r.zaman.baslangic}’da başlar` : `${r.zaman.saat}’da başlar`;
                return (
                  <Satir
                    key={s.anahtar}
                    avatar={<OfisAvatar ajanId={r.ajanId} boyut={36} title={ajanTamAd(r.ajanId, ajanAd(r.ajanId))} />}
                    mukellef={`Bugün planlı: ${r.bugun.planlanan} ${r.ad.split(' — ')[0]}`}
                    is={`${kalan} sırada${r.bugun.biten ? ` · ${r.bugun.biten} bitti` : ''}`}
                    alt={`${ajanKisaAd(r.ajanId, ajanAd(r.ajanId))} · ${baslar} · günde en çok ${r.gunlukTavan} · ${r.dryRun ? 'kuru' : 'canlı'}`}
                    cip={<Cip ton="kursuni" nokta>planlı</Cip>}
                    dugme={
                      <Link href="/panel/ekip/duzen" className="of-dugme" data-tur="ikincil">
                        Düzen
                      </Link>
                    }
                  />
                );
              }

              /* ── Sırada: sunucuda bekleyen vaka ── */
              if (s.tur === 'vakaSirada') {
                const v = s.vaka;
                return (
                  <Satir
                    key={s.anahtar}
                    avatar={<OfisAvatar ajanId={s.ajanId} boyut={36} title={ajanTamAd(s.ajanId, ajanAd(s.ajanId))} />}
                    mukellef={v.mukellef?.ad || 'Ofis geneli'}
                    is={v.konu}
                    alt={`${ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · sırada`}
                    cip={<Cip ton="kursuni" nokta>sırada</Cip>}
                    dugme={
                      <button type="button" className="of-dugme" data-tur="civit-yumusak" onClick={() => onAc(v.vakaId)}>
                        <Eye size={14} /> Aç
                      </button>
                    }
                    onAc={() => onAc(v.vakaId)}
                  />
                );
              }

              /* ── Bitti ── */
              const v = s.vaka;
              const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
              const sonIs = isAdimlari[isAdimlari.length - 1];
              const sure = sonIs?.baslangic && sonIs?.bitis ? sureKisa(new Date(sonIs.bitis).getTime() - new Date(sonIs.baslangic).getTime()) : '';
              const cevaplandi = v.kimde.ajanId === 'koordinator' && isAdimlari.length === 1;
              return (
                <Satir
                  key={s.anahtar}
                  avatar={<OfisAvatar ajanId={s.ajanId} boyut={36} title={ajanTamAd(s.ajanId, ajanAd(s.ajanId))} />}
                  mukellef={v.mukellef?.ad || 'Ofis geneli'}
                  is={v.konu || 'İş'}
                  alt={`${ajanKisaAd(s.ajanId, ajanAd(s.ajanId))} · ${saatEtiketi(v.guncellendi)}${sure ? ` · ${sure}` : ''}`}
                  cip={cevaplandi ? <Cip ton="deniz" nokta>cevaplandı</Cip> : <Cip ton="yesil" nokta>bitti</Cip>}
                  dugme={
                    <button type="button" className="of-dugme" data-tur="ikincil" onClick={() => onAc(v.vakaId)}>
                      <Eye size={14} /> Aç
                    </button>
                  }
                  onAc={() => onAc(v.vakaId)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
