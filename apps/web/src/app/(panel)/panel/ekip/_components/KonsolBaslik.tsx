'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, AlertOctagon } from 'lucide-react';
import { toast } from 'sonner';
import { sabahOzetiUret, isZamanAsimi, isOmurgaYok, type AkisSayaclari, type EkipDurum } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { SAKIN, bugunMu, saatKisa, sakinDugme } from './ortak';

/** "Pazartesi 14 Eylül" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
  return `${gun} ${tarih}`;
}

/** Tek olgu: "12 personel", "0 çalışıyor" — sayı beyaz, kelime ikincil. */
function Olgu({ sayi, kelime, renk, title, onClick }: { sayi: string | number; kelime: string; renk?: string; title?: string; onClick?: () => void }) {
  const icerik = (
    <>
      <span className="tabular-nums font-semibold" style={{ color: renk || SAKIN.metin }}>
        {sayi}
      </span>{' '}
      <span style={{ color: SAKIN.ikincil }}>{kelime}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className="whitespace-nowrap text-[12px] transition-opacity hover:opacity-80">
        {icerik}
      </button>
    );
  }
  return (
    <span className="whitespace-nowrap text-[12px]" title={title}>
      {icerik}
    </span>
  );
}

/** Sistem durumu kelimesi + nokta: "Operatör açık" / "Max bağlı" / "Sabah özeti 08:30 · bugün üretildi". */
function Durum({ renk, children, title }: { renk: string; children: React.ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: SAKIN.ikincil }} title={title}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: renk }} />
      {children}
    </span>
  );
}

/**
 * Başlık satırı — SAKİN (PLAN/19 §A.3-1): kart yok, tek satır düz metin.
 * Sol: "Ekip · Pazartesi 14 Eylül". Sağ: "12 personel · N çalışıyor · onay bekleyen N · Operatör açık · Max bağlı · Sabah özeti 08:30" + sessiz "Şimdi üret".
 * "Beyanname x/64" başlıktan KALKTI (dönem panosunun başlığında doğru dönem etiketiyle). "Şimdi üret" işlevi aynen (gonder:false).
 */
export function KonsolBaslik({
  durum,
  durumHata,
  durumYukleniyor,
  kadroSayisi,
  calisan,
  sayaclar,
  kosular,
  onSuzgec,
}: {
  durum: EkipDurum | undefined;
  durumHata: unknown;
  durumYukleniyor: boolean;
  kadroSayisi: number;
  /** Şu an koşan iş sayısı (durum.calisan ?? kadro suAn sayısı). */
  calisan: number;
  /** Akış sayaçları (durum.akis ?? akis.sayaclar). */
  sayaclar: AkisSayaclari | undefined;
  kosular: KosularApi;
  onSuzgec: (f: 'onay') => void;
}) {
  const qc = useQueryClient();
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);

  const onay = sayaclar?.onay ?? durum?.bekleyenOnay ?? 0;
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);

  // TEK AKTİF KOŞU KİLİDİ: herhangi bir koşu sürerken "Şimdi üret" pasif (iki Max koşusu aynı anda olmaz).
  const kilitli = uretiliyor || Date.now() < kilitliyeKadar || !!kosular.aktifKosu;

  /** Şimdi üret — gonder:false; sonuç akışta Koordinatör vakası (kart içi "Gönder" teyidi orada). */
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
        vakaId: r.isId,
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
      toast.success('Sabah özeti üretildi', { description: 'Akışta Koordinatör satırında.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? 'Sürüyor — akışta görünecek' : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) {
        toast.info(hata);
        setKilitliyeKadar(Date.now() + 3 * 60_000);
      } else {
        toast.error(hata);
      }
    } finally {
      setUretiliyor(false);
      qc.invalidateQueries({ queryKey: ['ekip-akis'] });
      qc.invalidateQueries({ queryKey: ['ekip-durum'] });
      qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    }
  };

  const sistemDurumu = () => {
    if (durumYukleniyor)
      return (
        <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: SAKIN.ikincil }}>
          <Loader2 size={11} className="animate-spin" /> Durum alınıyor
        </span>
      );
    if (durumHata) return <Durum renk={SAKIN.gri}>{isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı'}</Durum>;
    if (!durum) return null;
    return (
      <>
        <Durum renk={durum.operator?.acik ? SAKIN.yesil : SAKIN.kirmizi} title={durum.operator?.acik ? `Luca operatörü tarayıcısı açık${durum.operator.cihaz ? ` · ${durum.operator.cihaz}` : ''}` : 'Luca operatörü tarayıcısı kapalı'}>
          Operatör {durum.operator?.acik ? 'açık' : 'kapalı'}
        </Durum>
        <Durum renk={durum.maxBagli === false ? SAKIN.kirmizi : SAKIN.yesil} title={durum.maxBagli === false ? 'Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok' : 'Claude Max hesabı bağlı'}>
          Max {durum.maxBagli === false ? 'bağlı değil' : 'bağlı'}
        </Durum>
        <Durum
          renk={sabahBugun ? SAKIN.yesil : durum.sabahOzeti ? SAKIN.vurgu : SAKIN.gri}
          title={(durum.sabahOzeti ? 'Koordinatör her sabah 08:30 özet üretir' : 'EKIP_SABAH_OZETI=on değil') + (sonSabah ? ` · son: ${saatKisa(sonSabah).slice(0, 5)}` : '')}
        >
          Sabah özeti 08:30{sabahBugun ? ' · bugün üretildi' : durum.sabahOzeti ? '' : ' · kapalı'}
        </Durum>
        <button
          type="button"
          disabled={kilitli}
          onClick={simdiUret}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-[border-color] duration-150 disabled:opacity-50"
          style={sakinDugme('ikincil')}
          title="Yalnız üretir; Muzaffer Bey’e göndermez (gönderim akıştaki Koordinatör satırında ayrı teyit)"
        >
          {uretiliyor ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {uretiliyor ? 'Üretiliyor…' : Date.now() < kilitliyeKadar ? 'Sürüyor…' : kosular.aktifKosu ? 'Koşu sürüyor' : 'Şimdi üret'}
        </button>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <span className="inline-flex flex-shrink-0 items-baseline gap-2">
          <span className="text-[17px] font-bold leading-none" style={{ color: SAKIN.metin }}>
            Ekip
          </span>
          {gunMetni && (
            <span className="whitespace-nowrap text-[12px]" style={{ color: SAKIN.ikincil }}>
              · {gunMetni}
            </span>
          )}
        </span>

        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Olgu sayi={kadroSayisi || 12} kelime="personel" title="Kadro" />
          <Olgu sayi={calisan} kelime="çalışıyor" renk={calisan > 0 ? SAKIN.vurguAcik : undefined} title="Şu an koşan iş" />
          <Olgu sayi={onay} kelime="onay bekleyen" renk={onay > 0 ? SAKIN.kehribar : undefined} onClick={() => onSuzgec('onay')} title="Akışta 'Onayınızı bekleyen' süzgeci" />
          <span className="hidden h-3 w-px sm:inline-block" style={{ background: SAKIN.cizgi }} />
          {sistemDurumu()}
        </div>
      </header>

      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}66`, color: SAKIN.metin }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: SAKIN.kirmizi }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir ajan koşamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
