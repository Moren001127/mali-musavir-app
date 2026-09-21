'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Bos, Dugme, GOLD, KIRMIZI, MAVI, MUTED, OK, ROW_SEP, Rozet, TEXT } from './Tema';
import { OfisAvatar } from './ofis/Parcalar';
import { KUTULAR, ajanKisaAd, tarihKisa, vakaSirasi } from './ortak';

/** Sayfa başına satır. */
const SAYFA = 8;

/** Yalnız İşler listesinde kullanılan sade süzgeç. */
function IsFiltresi({ aktif, onClick, children, sayi, dikkat = false }: { aktif: boolean; onClick: () => void; children: ReactNode; sayi?: number | null; dikkat?: boolean }) {
  return (
    <button type="button" aria-pressed={aktif} onClick={onClick}
      data-dikkat={dikkat || undefined} className="ekip-isler-filtre"
      style={portalStyle({ color: aktif || dikkat ? GOLD : MUTED, border: `1px solid ${aktif ? `${GOLD}4d` : 'transparent'}`, background: aktif ? `${GOLD}14` : undefined })}>
      {children}
      {sayi != null && <span className="font-semibold tabular-nums" style={portalStyle({ opacity: aktif || dikkat ? 1 : 0.7 })}>{sayi}</span>}
    </button>
  );
}

/** Durum rozeti (kutu + durum). */
export function vakaRozeti(v: Vaka, kosuyor: boolean): { ad: string; renk: string } {
  if (v.kutu === 'onay') return { ad: 'onay', renk: GOLD };
  if (v.kutu === 'istek') return { ad: 'karar', renk: GOLD };
  if (v.kutu === 'suruyor' || kosuyor) return { ad: 'sürüyor', renk: MAVI };
  if (v.durum === 'hata') return { ad: 'yarım', renk: KIRMIZI };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: MUTED };
  return { ad: 'bitti', renk: OK };
}

/**
 * İşler listesi (İşler sekmesi, sol): tek araç çubuğu; sütunlar = mükellef/görev · sorumlu · durum · güncelleme.
 * Tıklanan iş sağdaki panelde açılır. 8'er 8'er "Daha fazla göster".
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
  useEffect(() => {
    if (!seciliVakaId) return;
    const i = vakalar.findIndex((v) => v.vakaId === seciliVakaId);
    if (i >= 0 && i >= gorunen) setGorunen(Math.ceil((i + 1) / SAYFA) * SAYFA);
  }, [seciliVakaId, vakalar, gorunen]);
  const liste = vakalar.slice(0, gorunen);

  return (
    <section aria-label="İşler" className="ekip-isler-liste ekip-isler-yuzey"
      style={portalStyle({ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.065)', boxShadow: '0 18px 44px rgba(0,0,0,0.24)' })}>
      <header className="ekip-isler-liste-baslik">
        <div className="min-w-0">
          <h3 className="ekip-isler-baslik" style={portalStyle({ color: TEXT })}>İşler</h3>
          <p className="ekip-isler-aciklama mt-1 text-[12px]" style={portalStyle({ color: MUTED })}>
            {akis ? `${gun === 1 ? 'Bugün' : `Son ${gun} gün`} · ${vakalar.length} iş · ${bittiN} bitti${hataN ? ` · ${hataN} yarım` : ''}` : 'Verilen görevler'}
          </p>
        </div>
        <Dugme tur="sade" onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })}>
          <RefreshCw size={12} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
        </Dugme>
      </header>
      {/* Süzgeçler */}
      <div className="ekip-isler-araclar">
        <div className="ekip-isler-filtre-grubu" role="group" aria-label="İş durumu">
          {KUTULAR.map((k) => {
            const sayi = k.id === 'tumu' ? toplam : k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
            const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
            return (
              <IsFiltresi key={k.id} aktif={suzgec === k.id} onClick={() => onSuzgec(k.id)} sayi={sayi} dikkat={dikkat}>
                {k.id === 'onay' ? 'Onay' : k.id === 'istek' ? 'Sizden istenen' : k.ad}
              </IsFiltresi>
            );
          })}
          {!!sayaclar?.gecikti && <Rozet metin={`${sayaclar.gecikti} gecikti`} renk={KIRMIZI} ton="kirmizi" />}
        </div>
        <div className="ekip-isler-donem">
          <div className="ekip-isler-filtre-grubu" role="group" aria-label="Zaman aralığı">
            {([1, 7, 30] as AkisGun[]).map((g) => (
              <IsFiltresi key={g} aktif={gun === g} onClick={() => onGun(g)}>
                {g === 1 ? 'Bugün' : `${g} gün`}
              </IsFiltresi>
            ))}
          </div>
          <span className="ekip-isler-arama" style={portalStyle({ background: 'rgba(255,255,255,0.025)', border: `1px solid ${ROW_SEP}` })}>
            <Search size={13} className="ekip-isler-arama-simge flex-shrink-0" style={portalStyle({ color: MUTED })} />
            <span className="min-w-0 flex-1">
              <MukellefSecici sade yerTutucu="Mükellef ara…" mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={GOLD} />
            </span>
          </span>
        </div>
      </div>

      {/* Satırlar */}
      <div className="mt-3">
        {omurgaYok ? (
          <OmurgaYokBilgi kucuk />
        ) : error ? (
          <div className="eg-hata-yazi py-3 text-[12.5px]" style={portalStyle({ color: KIRMIZI })}>
            Geçmiş alınamadı: {(error as any)?.message || 'hata'}
          </div>
        ) : isLoading && !akis ? (
          <div className="ekip-yukleniyor flex items-center justify-center gap-2 py-8 text-[12px]" style={portalStyle({ color: MUTED })}>
            <Loader2 size={13} className="animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : !vakalar.length ? (
          <Bos metin={suzgec === 'tumu' ? 'Bu pencerede iş yok.' : 'Bu kutuda iş yok.'} />
        ) : (
          <div className="ekip-isler-tablo-kaydir">
            <table className="ekip-isler-tablo" aria-label="İş listesi">
              <caption className="sr-only">İş ayrıntısını açmak için satıra tıklayın veya görev düğmesinde Enter tuşuna basın.</caption>
              <thead><tr>
                <th scope="col">Mükellef / görev</th>
                <th scope="col">Sorumlu</th>
                <th scope="col">Durum</th>
                <th scope="col">Güncelleme</th>
              </tr></thead>
              <tbody>
                {liste.map((v) => {
                  const secili = seciliVakaId === v.vakaId;
                  const siz = v.kimde.ajanId === 'siz';
                  const kosuyor = v.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
                  const r = vakaRozeti(v, kosuyor);
                  const isAdimlari = v.adimlar.filter((a) => a.tip === 'is') as Array<{ ajanId: string }>;
                  const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
                  const personelId = siz ? sonPersonel?.ajanId || 'koordinator' : v.kimde.ajanId;
                  return (
                    <tr key={v.vakaId} data-secili={secili} onClick={() => onSec(v)}>
                      <td>
                        <button type="button" className="ekip-isler-gorev" aria-current={secili}
                          onClick={(event) => { event.stopPropagation(); onSec(v); }}
                          title="İşi aç" style={portalStyle({ color: TEXT })}>
                          <span className="ekip-isler-firma">{v.mukellef?.ad || 'Ofis geneli'}</span>
                          <span className="ekip-isler-konu" title={v.konu} style={portalStyle({ color: MUTED })}>{v.konu || 'Konu yok'}</span>
                        </button>
                        {(siz || !v.kuru || v.gecikti) && <div className="ekip-isler-uyarilar">
                          {siz && <span data-ton="kehribar" style={portalStyle({ color: GOLD })}>Sizden işlem bekliyor</span>}
                          {!v.kuru && <span data-ton="kirmizi" style={portalStyle({ color: KIRMIZI })}>Canlı işlem</span>}
                          {v.gecikti && <span data-ton="kirmizi" style={portalStyle({ color: KIRMIZI })}>Gecikti</span>}
                        </div>}
                      </td>
                      <td><span className="ekip-isler-sorumlu">
                        <OfisAvatar ajanId={personelId} boyut={28} canli={kosuyor} title={ajanKisaAd(personelId, ajanAd(personelId))} />
                        <span>{ajanKisaAd(personelId, ajanAd(personelId))}</span>
                      </span></td>
                      <td><span className="ekip-isler-durum" data-durum={r.ad} style={portalStyle({ color: r.renk })}>
                        <span aria-hidden="true" className={kosuyor ? 'animate-pulse' : ''} />{r.ad}
                      </span></td>
                      <td className="ekip-isler-zaman" style={portalStyle({ color: MUTED })}>
                        {tarihKisa(v.guncellendi || v.olusturuldu)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {vakalar.length > gorunen && (
          <div className="ekip-isler-daha pt-2">
            <Dugme tur="ikincil" onClick={() => setGorunen((g) => g + SAYFA)} className="w-full justify-center">
              <ChevronDown size={12} /> Daha fazla göster ({vakalar.length - gorunen} iş daha)
            </Dugme>
          </div>
        )}
      </div>
    </section>
  );
}
