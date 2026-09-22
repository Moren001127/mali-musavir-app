'use client';

import { Fragment, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Sayfalama, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import {
  SORGU_TURU_ADI,
  eHacizVerisi,
  gelenEArsivVerisi,
  genelSorgularApi,
  posVerisi,
  sorguMukellefAdi,
  vergiBorcuVerisi,
  yoklamaVerisi,
  type SorguListeParams,
  type SorguSonucu,
  type SorguTuru,
} from '@/lib/genel-sorgular';
import { adet, donemEtiketi, tarihKisa, tarihSaat, tutar, yilAyEtiketi } from '../_lib/bicim';
import { csvIndir, disaAktarimTablosu } from '../_lib/disa-aktar';
import { EHacizDetay, GelenEArsivDetay, PosDetay, VergiBorcuDetay, YoklamaDetay } from './Detaylar';
import { EksikGorseller } from './EksikGorseller';

/*
 * Tür başına kenarlıklı GERÇEK tablo — grup başlığı düz kurşuni bant (büyük harf) + sol ince vurgu çizgisi.
 * Satıra tıklayınca (ya da "Aç") altında kalem/bildiri/fatura tablosu açılır. Sayfalama ve Excel her grupta.
 */

/** Boş durum: "Henüz sorgu çalıştırılmadı — yukarıdan mükellef ve tür seçip Sorgula'ya basın ya da gece sorgusunu bekleyin." */
const BOS_BASLIK = 'Henüz sorgu çalıştırılmadı';
const BOS_ACIKLAMA = "Yukarıdan mükellef ve tür seçip Sorgula'ya basın ya da gece sorgusunu bekleyin.";

type Sutun = { baslik: string; genislik?: number; sag?: boolean; hucre: (s: SorguSonucu) => ReactNode };

const MUKELLEF: Sutun = {
  baslik: 'Mükellef',
  hucre: (s) => {
    const ad = sorguMukellefAdi(s.taxpayer) || s.taxpayerId;
    return (
      <>
        <Link href={`/panel/mukellefler/${s.taxpayer?.id || s.taxpayerId}`} onClick={(e) => e.stopPropagation()} className="gs-mukellef" title={`Mükellef kartını aç: ${ad}`}>
          {ad}
        </Link>
        {s.taxpayer?.taxNumber && <span className="gs-vkn-kucuk">{s.taxpayer.taxNumber}</span>}
      </>
    );
  },
};
const SORGU_TARIHI: Sutun = { baslik: 'Sorgu tarihi', genislik: 150, hucre: (s) => <span className="gs-sayi gs-soluk">{tarihSaat(s.sorguTarihi)}</span> };
const DONEM: Sutun = { baslik: 'Dönem', genislik: 130, hucre: (s) => donemEtiketi(s.donem) };

function sayi(n: number, sifirSoluk = true): ReactNode {
  return <span className={n === 0 && sifirSoluk ? 'gs-sifir' : undefined}>{tutar(n)}</span>;
}

const SUTUNLAR: Record<SorguTuru, Sutun[]> = {
  VERGI_BORCU: [
    MUKELLEF,
    SORGU_TARIHI,
    { baslik: 'Vadesi geçmiş (₺)', genislik: 150, sag: true, hucre: (s) => { const v = vergiBorcuVerisi(s); return <span className={v.vadesiGecmis > 0 ? 'gs-kirmizi' : 'gs-sifir'}>{tutar(v.vadesiGecmis)}</span>; } },
    { baslik: 'Vadesi gelmemiş (₺)', genislik: 150, sag: true, hucre: (s) => sayi(vergiBorcuVerisi(s).vadesiGelmemis) },
    { baslik: 'Toplam borç (₺)', genislik: 150, sag: true, hucre: (s) => { const v = vergiBorcuVerisi(s); return <b className={v.toplam === 0 ? 'gs-sifir' : undefined}>{tutar(v.toplam)}</b>; } },
    { baslik: 'Kalem', genislik: 80, sag: true, hucre: (s) => adet(vergiBorcuVerisi(s).kalemler.length) },
  ],
  E_HACIZ: [
    MUKELLEF,
    SORGU_TARIHI,
    { baslik: 'Bildiri sayısı', genislik: 120, sag: true, hucre: (s) => adet(eHacizVerisi(s).bildiriSayisi) },
    { baslik: 'Tatbik edilen', genislik: 120, sag: true, hucre: (s) => { const n = eHacizVerisi(s).tatbikEdilenSayisi; return <span className={n > 0 ? 'gs-kirmizi' : 'gs-sifir'}>{adet(n)}</span>; } },
    { baslik: 'Toplam tutar (₺)', genislik: 150, sag: true, hucre: (s) => <b>{tutar(eHacizVerisi(s).toplamTutar)}</b> },
  ],
  YOKLAMA_DENETIM: [
    MUKELLEF,
    SORGU_TARIHI,
    { baslik: 'Yoklama', genislik: 100, sag: true, hucre: (s) => adet(yoklamaVerisi(s).yoklamaSayisi) },
    { baslik: 'Denetim', genislik: 100, sag: true, hucre: (s) => adet(yoklamaVerisi(s).denetimSayisi) },
    { baslik: 'Son yoklama', genislik: 150, hucre: (s) => { const v = yoklamaVerisi(s); return <span className="gs-sayi">{v.sonYoklamaTarihi ? tarihKisa(v.sonYoklamaTarihi) : '—'}</span>; } },
    { baslik: 'Son yoklama türü', genislik: 200, hucre: (s) => yoklamaVerisi(s).yoklamalar[0]?.yoklamaTuru || '—' },
  ],
  POS: [
    MUKELLEF,
    { baslik: 'Dönem', genislik: 130, hucre: (s) => { const v = posVerisi(s); return v.yil && v.ay ? yilAyEtiketi(v.yil, v.ay) : donemEtiketi(s.donem); } },
    SORGU_TARIHI,
    { baslik: 'Banka / kuruluş', genislik: 130, sag: true, hucre: (s) => adet(posVerisi(s).satirlar.length || posVerisi(s).satirSayisi) },
    { baslik: 'Toplam tutar (₺)', genislik: 160, sag: true, hucre: (s) => <b>{tutar(posVerisi(s).toplamTutar)}</b> },
  ],
  GELEN_EARSIV: [
    MUKELLEF,
    DONEM,
    SORGU_TARIHI,
    { baslik: 'Fatura sayısı', genislik: 120, sag: true, hucre: (s) => adet(gelenEArsivVerisi(s).faturaSayisi) },
    { baslik: 'Toplam ödenecek (₺)', genislik: 170, sag: true, hucre: (s) => <b>{tutar(gelenEArsivVerisi(s).toplamOdenecek)}</b> },
  ],
};

export interface SonucGrubuProps {
  tur: SorguTuru;
  rows: SorguSonucu[];
  total: number;
  sayfa: number;
  sayfaBoyutu: SayfaBoyutu;
  onSayfa: (n: number) => void;
  onSayfaBoyutu: (b: SayfaBoyutu) => void;
  yukleniyor?: boolean;
  hata?: string | null;
  /** Excel için süzgeç (tüm sayfalar çekilir). */
  suzgec: Omit<SorguListeParams, 'page' | 'pageSize'>;
  /** Sayfalama vurgu rengi (renk varyantı). */
  vurgu: string;
  onTutanak: (documentId: string, baslik: string) => void;
}

export function SonucGrubu(p: SonucGrubuProps) {
  const [acik, setAcik] = useState<string | null>(null);
  const [indiriliyor, setIndiriliyor] = useState(false);
  // Gelen e-Arşiv: ikinci sekme — DVD listesi ↔ Luca çekimi karşılaştırması ("Görseli eksik faturalar")
  const [sekme, setSekme] = useState<'sonuc' | 'eksik'>('sonuc');
  const earsiv = p.tur === 'GELEN_EARSIV';
  const sutunlar = SUTUNLAR[p.tur];
  const SUTUN = sutunlar.length + 1;

  const excelIndir = async () => {
    setIndiriliyor(true);
    try {
      const hepsi = await genelSorgularApi.tumunuGetir({ ...p.suzgec, tur: p.tur });
      if (hepsi.length === 0) { toast.info('İndirilecek sonuç yok.'); return; }
      const { basliklar, satirlar } = disaAktarimTablosu(p.tur, hepsi);
      const gun = new Date().toISOString().slice(0, 10);
      csvIndir(`Genel-Sorgular_${SORGU_TURU_ADI[p.tur].replace(/[^\p{L}\p{N}]+/gu, '-')}_${gun}.csv`, basliklar, satirlar);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      toast.error(err?.response?.data?.message || err?.message || 'Dosya oluşturulamadı');
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <section className="gs-grup" data-gs-grup={p.tur}>
      <div className="gs-grup-bas">
        <span className="gs-grup-adi">{SORGU_TURU_ADI[p.tur]}</span>
        <span className="gs-grup-sayi">{adet(p.total)} sorgu{p.yukleniyor ? ' · yükleniyor…' : ''}</span>
        {earsiv && (
          <div className="gs-sekmeler" role="tablist" aria-label="Gelen e-Arşiv görünümü">
            <button type="button" role="tab" aria-selected={sekme === 'sonuc'} className="gs-sekme" onClick={() => setSekme('sonuc')}>Sorgu sonuçları</button>
            <button type="button" role="tab" aria-selected={sekme === 'eksik'} className="gs-sekme" onClick={() => setSekme('eksik')} title="Dijital Vergi Dairesi listesinde olup Luca çekiminde görseli olmayan faturalar">Görseli eksik faturalar</button>
          </div>
        )}
        <div className="gs-grup-sag">
          {!(earsiv && sekme === 'eksik') && (
            <button type="button" className="gs-dugme-ikincil" onClick={excelIndir} disabled={indiriliyor || p.total === 0} title="Süzgece uyan tüm sonuçları Excel'de açılan dosya olarak indir">
              {indiriliyor ? 'Hazırlanıyor…' : 'Excel indir'}
            </button>
          )}
        </div>
      </div>

      {earsiv && sekme === 'eksik' ? (
        <EksikGorseller suzgec={p.suzgec} />
      ) : p.hata ? (
        <div className="gs-hata">Sonuçlar alınamadı: {p.hata}</div>
      ) : p.total === 0 && !p.yukleniyor ? (
        <div className="gs-bos">
          <b>{BOS_BASLIK}</b>
          {BOS_ACIKLAMA}
        </div>
      ) : (
        <>
          <div className="gs-tablo-sar">
            <table className="gs-tablo" style={{ minWidth: 760 }}>
              <colgroup>
                {sutunlar.map((s, i) => <col key={i} style={s.genislik ? { width: s.genislik } : undefined} />)}
                <col style={{ width: 72 }} />
              </colgroup>
              <thead>
                <tr>
                  {sutunlar.map((s) => <th key={s.baslik} className={s.sag ? 'sag' : undefined}>{s.baslik}</th>)}
                  <th className="orta">Ayrıntı</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((s) => {
                  const acikMi = acik === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr className="gs-satir" data-acik={acikMi ? 'true' : undefined} onClick={() => setAcik(acikMi ? null : s.id)} title={acikMi ? 'Ayrıntıyı kapat' : 'Ayrıntıyı aç'}>
                        {sutunlar.map((c) => <td key={c.baslik} className={c.sag ? 'sag' : undefined}>{c.hucre(s)}</td>)}
                        <td className="orta">
                          <button type="button" className="gs-baglanti" onClick={(e) => { e.stopPropagation(); setAcik(acikMi ? null : s.id); }} aria-expanded={acikMi}>
                            {acikMi ? 'Kapat' : 'Aç'}
                          </button>
                        </td>
                      </tr>
                      {acikMi && (
                        <tr data-gs-detay-satir>
                          <td colSpan={SUTUN} className="gs-detay">
                            <Detay tur={p.tur} sonuc={s} onTutanak={p.onTutanak} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {p.rows.length === 0 && p.yukleniyor && (
                  <tr className="gs-yukleniyor-satir"><td colSpan={SUTUN}>Yükleniyor…</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="gs-sayfalama">
            <Sayfalama sayfa={p.sayfa} sayfaBoyutu={p.sayfaBoyutu} toplam={p.total} onSayfa={p.onSayfa} onSayfaBoyutu={p.onSayfaBoyutu} birim="sorgu" renk={p.vurgu} yukleniyor={p.yukleniyor} />
          </div>
        </>
      )}
    </section>
  );
}

function Detay({ tur, sonuc, onTutanak }: { tur: SorguTuru; sonuc: SorguSonucu; onTutanak: SonucGrubuProps['onTutanak'] }) {
  switch (tur) {
    case 'VERGI_BORCU': return <VergiBorcuDetay sonuc={sonuc} />;
    case 'E_HACIZ': return <EHacizDetay sonuc={sonuc} />;
    case 'YOKLAMA_DENETIM': return <YoklamaDetay sonuc={sonuc} onTutanak={onTutanak} />;
    case 'POS': return <PosDetay sonuc={sonuc} />;
    case 'GELEN_EARSIV': return <GelenEArsivDetay sonuc={sonuc} />;
  }
}
