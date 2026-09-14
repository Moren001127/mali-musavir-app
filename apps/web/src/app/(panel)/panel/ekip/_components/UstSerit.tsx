'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, AlertOctagon, Users, Activity, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { sabahOzetiUret, isZamanAsimi, isOmurgaYok, type AkisSayaclari, type EkipDurum } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { Dugme, KPI } from './Kart';
import { TEMA, bugunMu, saatKisa } from './ortak';

/** "Pazartesi, 14 Eylül 2026" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  return `${gun}, ${tarih}`;
}

function Durum({ renk, children, title }: { renk: string; children: React.ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: TEMA.ikincil }} title={title}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: renk, boxShadow: `0 0 6px ${renk}66` }} />
      {children}
    </span>
  );
}

/**
 * Üst şerit v3: sol büyük başlık "Ekip" + tarih + sistem durumu satırı; sağda 4 sayaç kutusu
 * (Personel · Şu an çalışan · Onayınızı bekleyen · Sizden istenen). Sayaçlar tıklanınca geçmiş süzgeci.
 */
export function UstSerit({
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
  calisan: number;
  sayaclar: AkisSayaclari | undefined;
  kosular: KosularApi;
  onSuzgec: (f: 'onay' | 'istek' | 'suruyor') => void;
}) {
  const qc = useQueryClient();
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);

  const onay = sayaclar?.onay ?? durum?.bekleyenOnay ?? 0;
  const istek = sayaclar?.istek ?? 0;
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);
  const kilitli = uretiliyor || Date.now() < kilitliyeKadar || !!kosular.aktifKosu;

  /** Şimdi üret — gonder:false; sonuç iş panelinde Koordinatör koşusu olarak akar. */
  const simdiUret = async () => {
    if (kilitli) return;
    setUretiliyor(true);
    const basladi = Date.now();
    kosular.ayarla('koordinator', { ajanId: 'koordinator', gorev: 'Sabah özeti — üretiliyor (gönderme yok)', dryRun: true, cevap: '', adimlar: [], bitti: false, basladi, kaynak: 'sabahOzeti' });
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
        adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: Date.now(), durum: 'bitti' as const })),
        bitti: true,
        hata: r.hata,
        durationMs: r.durationMs ?? Date.now() - basladi,
        basladi,
        kaynak: 'sabahOzeti',
        gonderildi: 0,
      });
      toast.success('Sabah özeti üretildi', { description: 'Aşağıdaki iş panelinde.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? 'Sürüyor — iş geçmişinde görünecek' : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) {
        toast.info(hata);
        setKilitliyeKadar(Date.now() + 3 * 60_000);
      } else toast.error(hata);
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
        <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: TEMA.ikincil }}>
          <Loader2 size={11} className="animate-spin" /> Durum alınıyor
        </span>
      );
    if (durumHata) return <Durum renk={TEMA.soluk}>{isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı'}</Durum>;
    if (!durum) return null;
    return (
      <>
        <Durum renk={durum.operator?.acik ? TEMA.yesil : TEMA.kirmizi} title={durum.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
          Luca operatörü {durum.operator?.acik ? 'açık' : 'kapalı'}
        </Durum>
        <Durum renk={durum.maxBagli === false ? TEMA.kirmizi : TEMA.yesil}>Max {durum.maxBagli === false ? 'bağlı değil' : 'bağlı'}</Durum>
        <Durum renk={sabahBugun ? TEMA.yesil : durum.sabahOzeti ? TEMA.mavi : TEMA.soluk} title={sonSabah ? `Son üretim ${saatKisa(sonSabah).slice(0, 5)}` : undefined}>
          Sabah özeti 08:30{sabahBugun ? ' · bugün gitti' : durum.sabahOzeti ? '' : ' · kapalı'}
        </Durum>
        <Dugme tur="sessiz" disabled={kilitli} onClick={simdiUret} title="Yalnız üretir; Muzaffer Bey’e göndermez (gönderim iş panelinde ayrı teyit)">
          {uretiliyor ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {uretiliyor ? 'Üretiliyor…' : Date.now() < kilitliyeKadar ? 'Sürüyor…' : kosular.aktifKosu ? 'Koşu sürüyor' : 'Sabah özetini şimdi üret'}
        </Dugme>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: TEMA.metin }}>
            Ekip
          </h1>
          <div className="mt-0.5 text-[12.5px]" style={{ color: TEMA.ikincil }}>
            {gunMetni || ' '} · Yapay çalışan kadrosu — görev verin, ilerlemeyi izleyin, onaylayın.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">{sistemDurumu()}</div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4 xl:w-[560px]">
          <KPI etiket="Personel" deger={kadroSayisi || 12} ikon={<Users size={12} />} altBilgi="yapay çalışan" />
          <KPI etiket="Şu an çalışan" deger={calisan} ikon={<Activity size={12} />} renk={TEMA.mavi} vurgu={calisan > 0} altBilgi={calisan > 0 ? 'iş sürüyor' : 'boşta'} onClick={() => onSuzgec('suruyor')} />
          <KPI etiket="Onayınızı bekleyen" deger={onay} ikon={<ShieldCheck size={12} />} renk={TEMA.altin} vurgu={onay > 0} altBilgi={onay > 0 ? 'karar sizde' : 'bekleyen yok'} onClick={() => onSuzgec('onay')} />
          <KPI etiket="Sizden istenen" deger={istek} ikon={<ClipboardCheck size={12} />} renk={TEMA.turuncu} vurgu={istek > 0} altBilgi={istek > 0 ? 'belge / işlem' : 'istek yok'} onClick={() => onSuzgec('istek')} />
        </div>
      </div>
      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: `${TEMA.kirmizi}14`, border: `1px solid ${TEMA.kirmizi}55`, color: TEMA.metin }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: TEMA.kirmizi }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir personel çalışamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
