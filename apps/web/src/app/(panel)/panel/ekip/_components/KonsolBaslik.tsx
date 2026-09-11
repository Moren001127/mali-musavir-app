'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Loader2, Monitor, MonitorOff, Plug, PlugZap, Sunrise, AlertOctagon, ShieldCheck, Activity, CalendarCheck, Play } from 'lucide-react';
import { toast } from 'sonner';
import { sabahOzetiUret, isZamanAsimi, isOmurgaYok, type EkipDurum, type EkipOnay, type IsDosyasi, type Pano } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { Hap } from './Kart';
import { EKIP_ACCENT, RENK, bugunMu, donemEtiketi, goreliSaat, kartArkaPlan, saatKisa } from './ortak';

/** "Cuma 12 Eylül" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
  return `${gun} ${tarih}`;
}

/**
 * Başlık kartı — serif "Moren Ekip" + tek satır hap rozetler:
 * bekleyen onay · koşu bugün · beyanname hazır · Operatör · Max · Sabah özeti [Şimdi üret].
 * Eski 5 büyük sayaç kutusu (SabahBandi) buraya indi; "Şimdi üret" işlevi aynen (gonder:false).
 */
export function KonsolBaslik({
  durum,
  durumHata,
  durumYukleniyor,
  kadroSayisi,
  onaylar,
  isler,
  pano,
  panoYukleniyor,
  kosular,
  onOnayaGit,
  onBugunKosulara,
  onPanoyaGit,
}: {
  durum: EkipDurum | undefined;
  durumHata: unknown;
  durumYukleniyor: boolean;
  kadroSayisi: number;
  onaylar: EkipOnay[];
  isler: IsDosyasi[];
  pano: Pano | undefined;
  panoYukleniyor: boolean;
  kosular: KosularApi;
  onOnayaGit: () => void;
  onBugunKosulara: () => void;
  onPanoyaGit: () => void;
}) {
  const qc = useQueryClient();
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);

  // Sayaçlar — backend #2 alanları varsa onlar, yoksa isler(200)'den istemcide
  const bekleyen = durum?.bekleyenOnay ?? onaylar.length;
  const bugunkuler = useMemo(() => isler.filter((i) => bugunMu(i.createdAt)), [isler]);
  const bugunKosu = durum?.bugunKosu ?? bugunkuler.length;
  const calisan = durum?.calisan ?? isler.filter((i) => i.status === 'running').length;
  const bugunHata = durum?.bugunHata ?? bugunkuler.filter((i) => i.status === 'failed').length;
  const ozet = pano?.donemOzetleri[0];

  const sonSabah = useMemo(() => {
    if (durum?.sonSabahOzeti) return { createdAt: durum.sonSabahOzeti.createdAt };
    const k = isler.find((i) => i.ajanId === 'koordinator' && i.kaynak === 'cron');
    return k ? { createdAt: k.createdAt } : null;
  }, [isler, durum?.sonSabahOzeti]);
  const sabahBugun = !!sonSabah && bugunMu(sonSabah.createdAt);

  // TEK AKTİF KOŞU KİLİDİ: herhangi bir ajan koşarken "Şimdi üret" pasif (iki Max koşusu aynı anda olmaz).
  const kilitli = uretiliyor || Date.now() < kilitliyeKadar || !!kosular.aktifKosu;

  /** Şimdi üret — gonder:false; sonuç Canlı akışta koordinatör koşusu olarak görünür. */
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
      const hata = zamanAsimi ? "Sürüyor — İş dosyalarında görünecek" : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) {
        toast.info(hata);
        setKilitliyeKadar(Date.now() + 3 * 60_000);
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

  const sistemRozetleri = () => {
    if (durumYukleniyor) return <Hap renk="rgba(250,250,249,0.6)"><Loader2 size={11} className="animate-spin" /> Durum alınıyor</Hap>;
    if (durumHata) return <Hap renk={RENK.gri}><MonitorOff size={11} /> {isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı'}</Hap>;
    if (!durum) return null;
    return (
      <>
        {durum.operator?.acik ? (
          <Hap renk={RENK.yesil} title="Luca operatörü tarayıcısı açık"><Monitor size={11} /> Operatör açık{durum.operator.cihaz ? ` · ${durum.operator.cihaz}` : ''}</Hap>
        ) : (
          <Hap renk={RENK.kirmizi} title="Luca operatörü tarayıcısı kapalı"><MonitorOff size={11} /> Operatör kapalı</Hap>
        )}
        {durum.maxBagli === false ? (
          <Hap renk={RENK.kirmizi} title="Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok"><Plug size={11} /> Max bağlı değil</Hap>
        ) : (
          <Hap renk={RENK.yesil} title="Claude Max hesabı bağlı"><PlugZap size={11} /> Max bağlı</Hap>
        )}
        <span className="inline-flex flex-shrink-0 items-center gap-1">
          <Hap
            renk={durum.sabahOzeti ? EKIP_ACCENT : 'rgba(250,250,249,0.6)'}
            title={durum.sabahOzeti ? 'Koordinatör her sabah 08:30 özet üretir' : 'EKIP_SABAH_OZETI=on değil'}
          >
            <Sunrise size={11} />{' '}
            {sabahBugun ? `Sabah özeti ${saatKisa(sonSabah!.createdAt).slice(0, 5)} ✓` : durum.sabahOzeti ? 'Sabah özeti 08:30 açık' : 'Sabah özeti kapalı'}
            {!sabahBugun && sonSabah && <span className="opacity-70">· son {goreliSaat(sonSabah.createdAt)}</span>}
          </Hap>
          <button
            type="button"
            disabled={kilitli}
            onClick={simdiUret}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-bold leading-4 transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ background: `linear-gradient(135deg, ${EKIP_ACCENT}, #5b9fd1)`, color: '#0b1218' }}
            title="Yalnız üretir; sahibe göndermez (gönderim Canlı akışta ayrı düğme)"
          >
            {uretiliyor ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {uretiliyor ? 'Üretiliyor…' : Date.now() < kilitliyeKadar ? 'Sürüyor…' : kosular.aktifKosu ? 'Koşu sürüyor' : 'Şimdi üret'}
          </button>
        </span>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <header
        className="relative overflow-hidden rounded-2xl"
        style={{
          ...kartArkaPlan(EKIP_ACCENT),
          background: 'linear-gradient(160deg, rgba(20,18,16,0.97), rgba(9,8,7,0.97))',
        }}
      >
        {/* Üst 4px renk şeridi (gök mavisi → mor) */}
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${EKIP_ACCENT}, ${RENK.mor} 45%, ${EKIP_ACCENT}22 80%, transparent)` }} />
        {/* İki radial parıltı: gök mavisi sol-üst, mor sağ-alt */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(60% 120% at 6% 0%, ${EKIP_ACCENT}2a, transparent 55%), radial-gradient(50% 110% at 100% 120%, ${RENK.mor}22, transparent 55%)`,
          }}
        />
        <div className="relative flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${EKIP_ACCENT}, #5b9fd1)`,
                color: '#0b1218',
                boxShadow: `0 0 24px ${EKIP_ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
              }}
            >
              <Users size={22} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="serif text-[26px] leading-none" style={{ color: RENK.metin }}>
                Moren Ekip
              </h1>
              <p className="mt-1 truncate text-[11.5px]" style={{ color: RENK.ikincil }}>
                {gunMetni ? `${gunMetni} · ` : ''}
                {kadroSayisi || 13} çalışan · {calisan} çalışıyor
              </p>
            </div>
          </div>

          {/* İnce hap rozetler — mobilde tek satır yatay kayar (sayfa gövdesi kaymaz); ≥640px'te sığmazsa alt satıra iner (düğme gizlenmez) */}
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
            <Hap renk={bekleyen ? RENK.altin : 'rgba(250,250,249,0.6)'} onClick={onOnayaGit} title={bekleyen ? 'Onay şeridine git' : 'Onay geçmişi'}>
              <ShieldCheck size={11} /> {bekleyen} bekleyen onay
            </Hap>
            <Hap renk={EKIP_ACCENT} onClick={onBugunKosulara} title={`${calisan} çalışıyor · ${bugunHata} hata`}>
              <Activity size={11} /> {bugunKosu} koşu bugün{bugunHata ? <span style={{ color: RENK.kirmizi }}>· {bugunHata} hata</span> : null}
            </Hap>
            <Hap renk={RENK.mor} onClick={onPanoyaGit} title={ozet ? `verildi ${ozet.ozet.beyanname} · kontrol ${ozet.ozet.kontrol}` : 'Dönem panosu'}>
              <CalendarCheck size={11} />{' '}
              {panoYukleniyor || !ozet ? (
                <span className="inline-block h-3 w-10 animate-pulse rounded" style={{ background: `${RENK.mor}33` }} />
              ) : (
                `${ozet.ozet.beyannameHazir}/${ozet.toplam} beyanname hazır · ${donemEtiketi(ozet.donem)}`
              )}
            </Hap>
            <span className="mx-0.5 h-3 w-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />
            {sistemRozetleri()}
          </div>
        </div>
      </header>

      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[13px]" style={{ ...kartArkaPlan(RENK.kirmizi), borderColor: `${RENK.kirmizi}55`, color: '#fecaca' }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: RENK.kirmizi }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir ajan koşamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
