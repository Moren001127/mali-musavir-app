'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCw, Search, ChevronDown } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import { Anahtar, AvatarV5, CamKart, Dug, DurumSozu, Kapsul, V5 } from './Cam';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { KUTULAR, ajanKisaAd, ajanKisaltma, tarihKisa, vakaSirasi } from './ortak';

/** Sayfa başına satır (Muzaffer Bey 2026-09-15: "iş kayıtlarının hepsi görünüyor, liste çok uzun"). */
const SAYFA = 8;

/** Durum sözü rengi/metni (kutu + durum). */
function durumSozu(v: Vaka, kosuyor: boolean): { ad: string; renk: string; nabiz: boolean } {
  if (v.kutu === 'onay') return { ad: 'onayınızı bekliyor', renk: V5.amber, nabiz: false };
  if (v.kutu === 'istek') return { ad: 'kararınız bekleniyor', renk: V5.amber, nabiz: false };
  if (v.kutu === 'suruyor' || kosuyor) return { ad: 'sürüyor', renk: V5.mavi, nabiz: true };
  if (v.durum === 'hata') return { ad: 'yarım kaldı', renk: V5.coral, nabiz: false };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: '#9cc0ff', nabiz: false };
  return { ad: 'bitti', renk: V5.mint, nabiz: false };
}

/** Günlük iş sayısı (son 7 gün) → küçük çizgi grafik. */
function Sparkline({ vakalar }: { vakalar: Vaka[] }) {
  const noktalar = useMemo(() => {
    const gunler: number[] = Array(7).fill(0);
    const simdi = Date.now();
    for (const v of vakalar) {
      const gun = Math.floor((simdi - new Date(v.olusturuldu).getTime()) / 86_400_000);
      if (gun >= 0 && gun < 7) gunler[6 - gun]++;
    }
    const enCok = Math.max(1, ...gunler);
    return gunler.map((n, i) => `${2 + (i * 116) / 6},${24 - (n / enCok) * 18}`);
  }, [vakalar]);
  const cizgi = noktalar.join(' ');
  return (
    <svg viewBox="0 0 120 26" width={120} height={26} aria-hidden>
      <polyline fill="rgba(110,163,255,0.15)" stroke="none" points={`${cizgi} 118,26 2,26`} />
      <polyline fill="none" stroke={V5.mavi} strokeWidth="2" strokeLinejoin="round" points={cizgi} />
    </svg>
  );
}

/**
 * İş kayıtları v5 — SAĞ SÜTUN, kompakt (Muzaffer Bey 2026-09-15: dönem panosu ile yer değişti):
 * kapsül süzgeçler · gün anahtarı · mükellef arama; her iş bir kart-satır (mükellef + durum sözü / konu / personel çipi + mod + saat);
 * 8'er 8'er ("Daha fazla göster"); tıklanan iş üstteki Aktif iş panelinde açılır.
 */
export function IsGecmisi({ akis, isLoading, error, sayaclar, suzgec, onSuzgec, gun, onGun, taxpayerId, onTaxpayerId, mukellefler, seciliVakaId, onSec, ajanAd }: {
  akis: Akis | undefined;
  isLoading: boolean;
  error: unknown;
  sayaclar: AkisSayaclari | undefined;
  suzgec: AkisFiltre;
  onSuzgec: (f: AkisFiltre) => void;
  gun: AkisGun;
  onGun: (g: AkisGun) => void;
  taxpayerId: string;
  onTaxpayerId: (id: string) => void;
  mukellefler: MukellefOzet[];
  seciliVakaId: string | null;
  onSec: (v: Vaka) => void;
  ajanAd: (id: string) => string;
}) {
  const qc = useQueryClient();
  const yenileniyor = useIsFetching({ queryKey: ['ekip-akis'] }) > 0;
  const vakalar = useMemo(() => [...(akis?.vakalar || [])].sort(vakaSirasi), [akis?.vakalar]);
  const omurgaYok = isOmurgaYok(error);
  const toplam = sayaclar ? sayaclar.suruyor + sayaclar.onay + sayaclar.istek + sayaclar.bitti : vakalar.length;
  const bittiN = vakalar.filter((v) => v.kutu === 'bitti' && v.durum !== 'hata').length;
  const hataN = vakalar.filter((v) => v.durum === 'hata').length;
  const [gorunen, setGorunen] = useState(SAYFA);
  useEffect(() => setGorunen(SAYFA), [suzgec, gun, taxpayerId]);
  // Seçili iş listede daha aşağıdaysa o sayfaya kadar aç
  useEffect(() => {
    if (!seciliVakaId) return;
    const i = vakalar.findIndex((v) => v.vakaId === seciliVakaId);
    if (i >= 0 && i >= gorunen) setGorunen(Math.ceil((i + 1) / SAYFA) * SAYFA);
  }, [seciliVakaId, vakalar, gorunen]);
  const liste = vakalar.slice(0, gorunen);

  return (
    <CamKart
      ton="notr"
      etiket="İş kayıtları"
      ikon={<FileText size={17} />}
      baslik="Verilen görevler"
      dolguYok
      sag={
        <Dug kucuk tur="hayalet" onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })} title="Yenile">
          <RefreshCw size={12} className={yenileniyor ? 'animate-spin' : ''} />
        </Dug>
      }
    >
      {/* Süzgeçler */}
      <div className="flex flex-col gap-2 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Anahtar
            secenekler={[
              { id: 1 as AkisGun, etiket: 'Bugün' },
              { id: 7 as AkisGun, etiket: '7 gün' },
              { id: 30 as AkisGun, etiket: '30 gün' },
            ]}
            deger={gun}
            onChange={onGun}
          />
          <span className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 text-[12.5px]" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi2}` }}>
            <Search size={13} style={{ color: V5.soluk }} />
            <span className="min-w-0 flex-1">
              <MukellefSecici sade yerTutucu="Mükellef ara…" mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={V5.mavi} />
            </span>
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist">
          {KUTULAR.map((k) => {
            const aktif = suzgec === k.id;
            const sayi = k.id === 'tumu' ? toplam : k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
            const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
            return (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={aktif}
                onClick={() => onSuzgec(k.id)}
                className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold transition-[filter] hover:brightness-125"
                style={
                  aktif
                    ? { background: 'linear-gradient(180deg, rgba(110,163,255,0.28), rgba(110,163,255,0.12))', border: '1px solid rgba(110,163,255,0.5)', color: '#fff' }
                    : dikkat
                      ? { background: 'rgba(242,182,77,0.08)', border: '1px solid rgba(242,182,77,0.5)', color: '#ffd27a' }
                      : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${V5.cizgi}`, color: V5.ikincil }
                }
              >
                {k.id === 'onay' ? 'Onay' : k.id === 'istek' ? 'Sizden istenen' : k.ad}
                {sayi != null && (
                  <span className="rounded-full px-1.5 py-px text-[10.5px]" style={{ fontFamily: V5.mono, background: 'rgba(0,0,0,0.35)', border: `1px solid ${V5.cizgi}` }}>
                    {sayi}
                  </span>
                )}
              </button>
            );
          })}
          {!!sayaclar?.gecikti && (
            <Kapsul tur="hata" nokta title="2 devirden fazla dolaşan ya da 24 saatte çözülmeyen">
              {sayaclar.gecikti} gecikti
            </Kapsul>
          )}
        </div>
      </div>

      {/* Satırlar */}
      <div className="flex flex-col gap-2 px-4 pb-4">
        {omurgaYok ? (
          <OmurgaYokBilgi kucuk />
        ) : error ? (
          <div className="text-[12.5px]" style={{ color: V5.coral }}>
            Geçmiş alınamadı: {(error as any)?.message || 'hata'}
          </div>
        ) : isLoading && !akis ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12.5px]" style={{ color: V5.ikincil }}>
            <Loader2 size={12} className="animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : !vakalar.length ? (
          <div className="rounded-xl px-4 py-6 text-center text-[12.5px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
            {suzgec === 'tumu' ? 'Bu pencerede iş yok.' : 'Bu kutuda iş yok.'}
          </div>
        ) : (
          liste.map((v) => {
            const secili = seciliVakaId === v.vakaId;
            const siz = v.kimde.ajanId === 'siz';
            const kosuyor = v.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
            const d = durumSozu(v, kosuyor);
            const isAdimlari = v.adimlar.filter((a) => a.tip === 'is') as Array<{ ajanId: string }>;
            const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
            const personelId = siz ? sonPersonel?.ajanId || 'koordinator' : v.kimde.ajanId;
            return (
              <button
                key={v.vakaId}
                type="button"
                onClick={() => onSec(v)}
                aria-current={secili}
                title="İşi Aktif iş panelinde aç"
                className="flex w-full min-w-0 flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-[filter] hover:brightness-125"
                style={
                  secili
                    ? { background: 'linear-gradient(90deg, rgba(110,163,255,0.18), rgba(110,163,255,0.06))', border: '1px solid rgba(110,163,255,0.45)' }
                    : { background: 'rgba(255,255,255,0.035)', border: `1px solid ${V5.cizgi}` }
                }
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[12.8px] font-bold" style={{ color: V5.metin }} title={v.mukellef?.ad || 'Ofis geneli'}>
                    {v.mukellef?.ad || 'Ofis geneli'}
                  </span>
                  <DurumSozu renk={d.renk} nabiz={d.nabiz} className="text-[11.5px]">
                    {d.ad}
                  </DurumSozu>
                </span>
                <span className="min-w-0 truncate text-[12px]" style={{ color: V5.ikincil }} title={v.konu}>
                  {v.konu || 'Konu yok'}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: V5.soluk }}>
                  <span className="inline-flex items-center gap-1.5">
                    <AvatarV5 kisaltma={ajanKisaltma(personelId)} ton={personelId === 'koordinator' ? 'altin' : 'mavi'} boyut={18} kare />
                    {ajanKisaAd(personelId, ajanAd(personelId))}
                    {siz && <span>→ siz</span>}
                  </span>
                  <span style={{ color: v.kuru ? V5.soluk : '#ff8a96', fontWeight: 700 }}>{v.kuru ? 'kuru' : 'canlı'}</span>
                  <span className="ml-auto" style={{ fontFamily: V5.mono }}>
                    {tarihKisa(v.olusturuldu)}
                  </span>
                  {v.gecikti && <Kapsul tur="hata">gecikti</Kapsul>}
                </span>
              </button>
            );
          })
        )}
        {vakalar.length > gorunen && (
          <Dug tur="hayalet" kucuk onClick={() => setGorunen((g) => g + SAYFA)} className="w-full">
            <ChevronDown size={12} /> Daha fazla göster ({vakalar.length - gorunen} iş daha)
          </Dug>
        )}
        {akis && vakalar.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11.5px]" style={{ color: V5.soluk }}>
            <span>
              {gun === 1 ? 'Bugün' : `Son ${gun} günde`} {vakalar.length} iş · {bittiN} bitti{hataN ? ` · ${hataN} yarım` : ''}
            </span>
            {gun !== 1 && <Sparkline vakalar={vakalar} />}
          </div>
        )}
      </div>
    </CamKart>
  );
}
