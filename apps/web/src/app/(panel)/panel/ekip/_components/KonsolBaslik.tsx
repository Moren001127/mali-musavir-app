'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, MonitorOff, Plug, PlugZap, Sunrise, AlertOctagon, ShieldCheck, Activity, CalendarCheck, Play, Users } from 'lucide-react';
import { toast } from 'sonner';
import { sabahOzetiUret, isZamanAsimi, isOmurgaYok, type AkisSayaclari, type EkipDurum, type Pano } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { Hap } from './Kart';
import { EKIP_ACCENT, RENK, bugunMu, donemEtiketi, saatKisa, seritStili } from './ortak';

/** "Cumartesi 13 Eylül" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
  return `${gun} ${tarih}`;
}

/**
 * İNCE başlık şeridi (≤56px, tek satır; dar ekranda yatay kayar, sayfa gövdesi kaymaz).
 * Sol: küçük "Moren Ekip" + tarih. Sağ: `13 çalışan` · `N çalışıyor` · `Onay N` · `Beyanname x/64` · Operatör · Max · Sabah özeti + [Şimdi üret].
 * Serif büyük başlık ve büyük ikon KALKTI (Muzaffer Bey: "çok geniş"). "Şimdi üret" işlevi aynen (gonder:false); sonuç akışta Koordinatör vakası.
 */
export function KonsolBaslik({
  durum,
  durumHata,
  durumYukleniyor,
  kadroSayisi,
  calisan,
  sayaclar,
  pano,
  panoYukleniyor,
  kosular,
  onSuzgec,
  onPanoAc,
}: {
  durum: EkipDurum | undefined;
  durumHata: unknown;
  durumYukleniyor: boolean;
  kadroSayisi: number;
  /** Şu an koşan iş sayısı (durum.calisan ?? kadro suAn sayısı). */
  calisan: number;
  /** Akış sayaçları (durum.akis ?? akis.sayaclar). */
  sayaclar: AkisSayaclari | undefined;
  pano: Pano | undefined;
  panoYukleniyor: boolean;
  kosular: KosularApi;
  onSuzgec: (f: 'onay') => void;
  onPanoAc: () => void;
}) {
  const qc = useQueryClient();
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);

  const onay = sayaclar?.onay ?? durum?.bekleyenOnay ?? 0;
  // En yeni dönem özeti (donemOzetleri sırası backend'e bağlı → en büyük dönem etiketi seçilir)
  const ozet = (pano?.donemOzetleri || []).reduce<Pano['donemOzetleri'][number] | undefined>((en, o) => (!en || o.donem > en.donem ? o : en), undefined);

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

  const sistemRozetleri = () => {
    if (durumYukleniyor)
      return (
        <Hap renk="rgba(250,250,249,0.6)">
          <Loader2 size={11} className="animate-spin" /> Durum alınıyor
        </Hap>
      );
    if (durumHata)
      return (
        <Hap renk={RENK.gri}>
          <MonitorOff size={11} /> {isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı'}
        </Hap>
      );
    if (!durum) return null;
    return (
      <>
        {durum.operator?.acik ? (
          <Hap renk={RENK.yesil} title={`Luca operatörü tarayıcısı açık${durum.operator.cihaz ? ` · ${durum.operator.cihaz}` : ''}`}>
            <Monitor size={11} /> Operatör <span className="h-1.5 w-1.5 rounded-full" style={{ background: RENK.yesil }} />
          </Hap>
        ) : (
          <Hap renk={RENK.kirmizi} title="Luca operatörü tarayıcısı kapalı">
            <MonitorOff size={11} /> Operatör <span className="h-1.5 w-1.5 rounded-full" style={{ background: RENK.kirmizi }} />
          </Hap>
        )}
        {durum.maxBagli === false ? (
          <Hap renk={RENK.kirmizi} title="Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok">
            <Plug size={11} /> Max <span className="h-1.5 w-1.5 rounded-full" style={{ background: RENK.kirmizi }} />
          </Hap>
        ) : (
          <Hap renk={RENK.yesil} title="Claude Max hesabı bağlı">
            <PlugZap size={11} /> Max <span className="h-1.5 w-1.5 rounded-full" style={{ background: RENK.yesil }} />
          </Hap>
        )}
        <span className="inline-flex flex-shrink-0 items-center gap-1">
          <Hap
            renk={durum.sabahOzeti ? EKIP_ACCENT : 'rgba(250,250,249,0.6)'}
            title={
              (durum.sabahOzeti ? 'Koordinatör her sabah 08:30 özet üretir' : 'EKIP_SABAH_OZETI=on değil') +
              (sonSabah ? ` · son: ${saatKisa(sonSabah).slice(0, 5)}` : '')
            }
          >
            <Sunrise size={11} /> Sabah özeti 08:30{' '}
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: sabahBugun ? RENK.yesil : durum.sabahOzeti ? EKIP_ACCENT : RENK.gri }} />
          </Hap>
          <button
            type="button"
            disabled={kilitli}
            onClick={simdiUret}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-bold leading-4 transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ background: `linear-gradient(135deg, ${EKIP_ACCENT}, #5b9fd1)`, color: '#0b1218' }}
            title="Yalnız üretir; Muzaffer Bey’e göndermez (gönderim akıştaki Koordinatör satırında ayrı teyit)"
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
      {/* İnce şerit: 4px renk çizgisi + ≤52px tek satır */}
      <header
        className="relative overflow-hidden rounded-xl"
        style={{
          background: 'linear-gradient(160deg, rgba(20,18,16,0.97), rgba(9,8,7,0.97))',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.22)',
        }}
      >
        <div className="h-1 w-full" style={seritStili(EKIP_ACCENT)} />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(40% 200% at 0% 0%, ${EKIP_ACCENT}1f, transparent 60%)` }}
        />
        <div className="relative flex h-[46px] min-w-0 items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 pr-1">
            <Users size={13} style={{ color: EKIP_ACCENT }} />
            <span className="text-[13px] font-bold leading-none" style={{ color: RENK.metin }}>
              Moren Ekip
            </span>
            {gunMetni && (
              <span className="whitespace-nowrap text-[11px]" style={{ color: RENK.ikincil }}>
                · {gunMetni}
              </span>
            )}
          </span>
          <span className="mx-0.5 h-3 w-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />

          <Hap renk="rgba(250,250,249,0.6)" title="Kadro">
            {kadroSayisi || 13} çalışan
          </Hap>
          <Hap renk={calisan > 0 ? EKIP_ACCENT : 'rgba(250,250,249,0.6)'} title="Şu an koşan iş">
            {calisan > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: EKIP_ACCENT, boxShadow: `0 0 8px ${EKIP_ACCENT}` }} />}
            <Activity size={11} /> {calisan} çalışıyor
          </Hap>
          <Hap renk={onay ? RENK.altin : 'rgba(250,250,249,0.6)'} onClick={() => onSuzgec('onay')} title="Akışta 'Onayınızı bekleyen' süzgeci">
            <ShieldCheck size={11} /> Onay {onay}
          </Hap>
          <Hap renk={RENK.mor} onClick={onPanoAc} title={ozet ? `${donemEtiketi(ozet.donem)} · verildi ${ozet.ozet.beyanname} · hazır ${ozet.ozet.beyannameHazir}` : 'Dönem panosunu aç'}>
            <CalendarCheck size={11} />{' '}
            {panoYukleniyor || !ozet ? <span className="inline-block h-3 w-10 animate-pulse rounded" style={{ background: `${RENK.mor}33` }} /> : `Beyanname ${ozet.ozet.beyanname}/${ozet.toplam}`}
          </Hap>
          <span className="mx-0.5 h-3 w-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />
          {sistemRozetleri()}
        </div>
      </header>

      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: 'rgba(248,113,113,0.10)', border: `1px solid ${RENK.kirmizi}55`, color: '#fecaca' }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: RENK.kirmizi }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir ajan koşamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
