'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sayfalama, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { SORGU_TURU_ADI, genelSorgularApi, sorguMukellefAdi, type GuncelSatir, type SorguTuru } from '@/lib/genel-sorgular';
import { adet, donemEtiketi, tarihKisa, tarihSaat, tutar } from '../_lib/bicim';
import { csvIndir } from '../_lib/disa-aktar';
import { EksikGorseller } from './EksikGorseller';

/*
 * GÜNCEL DURUM tabloları (2026-09-22, Muzaffer Bey: "her gün bir sorgu satırı mı gelecek? mantığı saçma").
 * Satırlar sorgu koşusu DEĞİL, mükellefin güncel durumu:
 *   Vergi Borcu → mükellef başına 1 satır (ayrıntıda kalemler) · e-Haciz → bildiri başına · Yoklama/Denetim → tutanak
 *   başına · POS → ay + banka başına · Gelen e-Arşiv → fatura başına (+ "Görseli eksik faturalar" sekmesi).
 * "Son sorgu" sütunu verinin ne zaman çekildiğini söyler. Kenarlıklı düz tablo; durum kelimeyle.
 */

/** Tablo en az genişliği — Mükellef sütunu daralıp satır kırılmasın (sığmazsa yatay kaydırma). */
const EN_AZ_GENISLIK: Record<SorguTuru, number> = { VERGI_BORCU: 900, E_HACIZ: 1150, YOKLAMA_DENETIM: 1150, POS: 950, GELEN_EARSIV: 1230 };

const BOS_BASLIK = 'Henüz sorgu çalıştırılmadı';
const BOS_ACIKLAMA = "Yukarıdan mükellef seçip Sorgula'ya basın ya da gece sorgusunu bekleyin.";

type Sutun = { baslik: string; genislik?: number; sag?: boolean; tekSatir?: boolean; hucre: (s: GuncelSatir) => React.ReactNode };

const MUKELLEF: Sutun = {
  baslik: 'Mükellef',
  genislik: 250,
  tekSatir: true,
  hucre: (s) => (
    <>
      <Link href={`/panel/mukellefler/${s.taxpayerId}`} className="gs-mukellef" title={sorguMukellefAdi(s.taxpayer) || s.taxpayerId} onClick={(e) => e.stopPropagation()}>{sorguMukellefAdi(s.taxpayer) || s.taxpayerId}</Link>
      {s.taxpayer?.taxNumber && <span className="gs-vkn-kucuk">{s.taxpayer.taxNumber}</span>}
    </>
  ),
};
const SON_SORGU: Sutun = { baslik: 'Son sorgu', genislik: 140, hucre: (s) => <span className="gs-sayi gs-soluk">{tarihSaat(s.sorguTarihi)}</span> };
const DONEM: Sutun = { baslik: 'Dönem', genislik: 100, hucre: (s) => donemEtiketi(s.donem) || '—' };
const para = (n: number, kirmizi = false) => <span className={n === 0 ? 'gs-sifir' : kirmizi ? 'gs-kirmizi' : ''}>{tutar(n)}</span>;

const SUTUNLAR: Record<SorguTuru, Sutun[]> = {
  VERGI_BORCU: [
    MUKELLEF,
    { baslik: 'Vadesi geçmiş (₺)', genislik: 150, sag: true, hucre: (s) => para(s.vadesiGecmis, s.vadesiGecmis > 0) },
    { baslik: 'Vadesi gelmemiş (₺)', genislik: 150, sag: true, hucre: (s) => para(s.vadesiGelmemis) },
    { baslik: 'Toplam borç (₺)', genislik: 150, sag: true, hucre: (s) => <b>{tutar(s.toplam)}</b> },
    { baslik: 'Kalem', genislik: 70, sag: true, hucre: (s) => adet(s.kalemSayisi) },
    SON_SORGU,
  ],
  E_HACIZ: [
    MUKELLEF,
    { baslik: 'Kapsam', genislik: 90, hucre: (s) => (s.kapsam === 'ARAC' ? 'Araç' : 'Banka') },
    { baslik: 'Bildiri no', genislik: 190, hucre: (s) => <span className="gs-sayi">{s.bildiriNo}</span> },
    { baslik: 'Vergi dairesi', genislik: 150, hucre: (s) => s.vergiDairesi || s.vergiDairesiKodu || '—' },
    { baslik: 'Tutar (₺)', genislik: 130, sag: true, hucre: (s) => <b>{tutar(s.tutar)}</b> },
    { baslik: 'Durum', genislik: 260, hucre: (s) => <span className={s.tatbikEdildi ? 'gs-kirmizi' : 'gs-soluk'}>{durumYazisi(s.durum)}</span> },
    SON_SORGU,
  ],
  YOKLAMA_DENETIM: [
    MUKELLEF,
    { baslik: 'Kayıt', genislik: 90, hucre: (s) => (s.kayit === 'DENETIM' ? 'Denetim' : 'Yoklama') },
    { baslik: 'Vergi dairesi', genislik: 170, hucre: (s) => s.vergiDairesi || '—' },
    { baslik: 'Kod', genislik: 240, hucre: (s) => <span className="gs-sayi">{s.kod || '—'}</span> },
    { baslik: 'Türü', tekSatir: true, hucre: (s) => <span title={s.turu}>{s.turu || '—'}</span> },
    { baslik: 'Tarih', genislik: 140, hucre: (s) => <span className="gs-sayi">{tarihSaat(s.tarih) || '—'}</span> },
    SON_SORGU,
  ],
  POS: [
    MUKELLEF,
    DONEM,
    { baslik: 'Banka / kuruluş', tekSatir: true, hucre: (s) => <span title={s.unvan}>{`${s.unvan || '—'}${s.kaynak === 'ODEME_KURULUSU' ? ' (ödeme kuruluşu)' : ''}`}</span> },
    { baslik: 'Üye işyeri no', genislik: 160, hucre: (s) => <span className="gs-sayi gs-soluk">{s.uyeIsyeriNo || '—'}</span> },
    { baslik: 'Tutar (₺)', genislik: 140, sag: true, hucre: (s) => <b>{tutar(s.tutar)}</b> },
    SON_SORGU,
  ],
  GELEN_EARSIV: [
    MUKELLEF,
    DONEM,
    { baslik: 'Fatura tarihi', genislik: 110, hucre: (s) => <span className="gs-sayi">{tarihKisa(s.duzenlenmeTarihi) || '—'}</span> },
    { baslik: 'Fatura no', genislik: 175, hucre: (s) => <span className="gs-sayi">{s.faturaNo}</span> },
    { baslik: 'Satıcı', tekSatir: true, hucre: (s) => <span title={s.saticiUnvan}>{s.saticiUnvan || '—'}</span> },
    { baslik: 'Satıcı VKN', genislik: 115, hucre: (s) => <span className="gs-sayi gs-soluk">{s.saticiVkn || '—'}</span> },
    { baslik: 'Tutar (₺)', genislik: 110, sag: true, hucre: (s) => tutar(s.toplamTutar) },
    { baslik: 'Ödenecek (₺)', genislik: 120, sag: true, hucre: (s) => <b>{tutar(s.odenecekTutar)}</b> },
  ],
};

/** "HACİZ TATBİK EDİLMİŞTİR" → "Haciz tatbik edilmiştir" */
function durumYazisi(d: string): string {
  if (!d) return '—';
  const k = d.toLocaleLowerCase('tr-TR');
  return k.charAt(0).toLocaleUpperCase('tr-TR') + k.slice(1);
}

/** Grup başlığındaki sayı/özet cümlesi. */
function ozetCumlesi(tur: SorguTuru, total: number, ozet?: { mukellef: number; bos: number }): string {
  if (!ozet || ozet.mukellef === 0) return '';
  const m = `${adet(ozet.mukellef)} mükellef`;
  switch (tur) {
    case 'VERGI_BORCU': return `${m}${ozet.bos ? ` · ${adet(ozet.bos)} borçsuz` : ''}`;
    case 'E_HACIZ': return `${adet(total)} bildiri · ${m} sorgulandı${ozet.bos ? `, ${adet(ozet.bos)}'inde haciz yok` : ''}`;
    case 'YOKLAMA_DENETIM': return `${adet(total)} tutanak · ${m} sorgulandı${ozet.bos ? `, ${adet(ozet.bos)}'inde tutanak yok` : ''}`;
    case 'POS': return `${adet(total)} satır · ${m}`;
    case 'GELEN_EARSIV': return `${adet(total)} fatura · ${m}`;
  }
}

function bosAciklama(tur: SorguTuru, ozet?: { mukellef: number }): { baslik: string; aciklama: string } {
  if (!ozet || ozet.mukellef === 0) return { baslik: BOS_BASLIK, aciklama: BOS_ACIKLAMA };
  const m = `${adet(ozet.mukellef)} mükellef sorgulandı`;
  switch (tur) {
    case 'VERGI_BORCU': return { baslik: 'Borç kaydı yok', aciklama: `${m}.` };
    case 'E_HACIZ': return { baslik: 'Haciz bildirisi yok', aciklama: `${m}; hiçbirinde e-haciz bildirisi bulunmadı.` };
    case 'YOKLAMA_DENETIM': return { baslik: 'Tutanak yok', aciklama: `${m}; yoklama ya da denetim tutanağı bulunmadı.` };
    case 'POS': return { baslik: 'POS işlemi yok', aciklama: `${m}; seçili dönemde POS tutarı bulunmadı.` };
    case 'GELEN_EARSIV': return { baslik: 'Gelen e-Arşiv faturası yok', aciklama: `${m}; seçili dönemde mükellef adına düzenlenmiş e-Arşiv faturası bulunmadı.` };
  }
}

export interface GuncelTabloProps {
  tur: SorguTuru;
  suzgec: { taxpayerId?: string; donem?: string };
  sayfa: number;
  sayfaBoyutu: SayfaBoyutu;
  onSayfa: (n: number) => void;
  onSayfaBoyutu: (b: SayfaBoyutu) => void;
  vurgu: string;
  onTutanak: (documentId: string, baslik: string) => void;
}

export function GuncelTablo(p: GuncelTabloProps) {
  const [acik, setAcik] = useState<string | null>(null);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [sekme, setSekme] = useState<'sonuc' | 'eksik'>('sonuc');
  const earsiv = p.tur === 'GELEN_EARSIV';
  const ayBazli = earsiv || p.tur === 'POS';
  const sutunlar = SUTUNLAR[p.tur];
  const ayrintiVar = p.tur === 'VERGI_BORCU' || p.tur === 'E_HACIZ' || p.tur === 'YOKLAMA_DENETIM';
  const SUTUN = sutunlar.length + (ayrintiVar ? 1 : 0);

  const q = useQuery({
    queryKey: ['genel-sorgular', 'guncel', p.tur, p.suzgec.taxpayerId || '', ayBazli ? p.suzgec.donem || '' : '', p.sayfa, p.sayfaBoyutu],
    queryFn: () => genelSorgularApi.guncel({ tur: p.tur, taxpayerId: p.suzgec.taxpayerId, donem: ayBazli ? p.suzgec.donem : undefined, page: p.sayfa, pageSize: p.sayfaBoyutu }),
    placeholderData: (onceki) => onceki,
  });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const ozet = q.data?.ozet;

  const excelIndir = async () => {
    setIndiriliyor(true);
    try {
      const hepsi = await genelSorgularApi.guncel({ tur: p.tur, taxpayerId: p.suzgec.taxpayerId, donem: ayBazli ? p.suzgec.donem : undefined, page: 1, pageSize: 5000 });
      if (!hepsi.rows.length) { toast.info('İndirilecek satır yok.'); return; }
      const { basliklar, satirlar } = disaAktar(p.tur, hepsi.rows);
      csvIndir(`Genel-Sorgular_${SORGU_TURU_ADI[p.tur].replace(/[^\p{L}\p{N}]+/gu, '-')}_${new Date().toISOString().slice(0, 10)}.csv`, basliklar, satirlar);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      toast.error(err?.response?.data?.message || err?.message || 'Dosya oluşturulamadı');
    } finally {
      setIndiriliyor(false);
    }
  };

  const bos = bosAciklama(p.tur, ozet);
  const hata = q.isError ? ((q.error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (q.error as Error)?.message || 'Bilinmeyen hata') : null;

  return (
    <section className="gs-grup" data-gs-grup={p.tur}>
      <div className="gs-grup-bas">
        <span className="gs-grup-adi">{SORGU_TURU_ADI[p.tur]}</span>
        <span className="gs-grup-sayi">{q.isLoading ? 'yükleniyor…' : ozetCumlesi(p.tur, total, ozet)}{!ayBazli && p.suzgec.donem ? ' · güncel durum (dönem süzgeci bu türde uygulanmaz)' : ''}</span>
        {earsiv && (
          <div className="gs-sekmeler" role="tablist" aria-label="Gelen e-Arşiv görünümü">
            <button type="button" role="tab" aria-selected={sekme === 'sonuc'} className="gs-sekme" onClick={() => setSekme('sonuc')}>Faturalar</button>
            <button type="button" role="tab" aria-selected={sekme === 'eksik'} className="gs-sekme" onClick={() => setSekme('eksik')} title="Dijital Vergi Dairesi listesinde olup Luca çekiminde görseli olmayan faturalar">Görseli eksik faturalar</button>
          </div>
        )}
        <div className="gs-grup-sag">
          {!(earsiv && sekme === 'eksik') && (
            <button type="button" className="gs-dugme-ikincil" onClick={excelIndir} disabled={indiriliyor || total === 0} title="Süzgece uyan tüm satırları Excel'de açılan dosya olarak indir">
              {indiriliyor ? 'Hazırlanıyor…' : 'Excel indir'}
            </button>
          )}
        </div>
      </div>

      {earsiv && sekme === 'eksik' ? (
        <EksikGorseller suzgec={p.suzgec} />
      ) : hata ? (
        <div className="gs-hata">Sonuçlar alınamadı: {hata}</div>
      ) : total === 0 && !q.isLoading ? (
        <div className="gs-bos"><b>{bos.baslik}</b>{bos.aciklama}</div>
      ) : (
        <>
          <div className="gs-tablo-sar">
            <table className="gs-tablo" style={{ minWidth: EN_AZ_GENISLIK[p.tur] }}>
              <colgroup>
                {sutunlar.map((s, i) => <col key={i} style={s.genislik ? { width: s.genislik } : undefined} />)}
                {ayrintiVar && <col style={{ width: 72 }} />}
              </colgroup>
              <thead>
                <tr>
                  {sutunlar.map((s) => <th key={s.baslik} className={s.sag ? 'sag' : undefined}>{s.baslik}</th>)}
                  {ayrintiVar && <th className="orta">Ayrıntı</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const anahtar = satirAnahtari(s, i);
                  const acikMi = acik === anahtar;
                  const acilabilir = ayrintiVar && ayrintiVarMi(s);
                  return (
                    <Fragment key={anahtar}>
                      <tr className={acilabilir ? 'gs-satir' : undefined} data-acik={acikMi ? 'true' : undefined} onClick={acilabilir ? () => setAcik(acikMi ? null : anahtar) : undefined}>
                        {sutunlar.map((c) => <td key={c.baslik} className={[c.sag ? 'sag' : '', c.tekSatir ? 'gs-tek-satir' : ''].filter(Boolean).join(' ') || undefined}>{c.hucre(s)}</td>)}
                        {ayrintiVar && (
                          <td className="orta">
                            {p.tur === 'YOKLAMA_DENETIM' ? (
                              s.pdfDocumentId ? <button type="button" className="gs-baglanti" onClick={(e) => { e.stopPropagation(); p.onTutanak(s.pdfDocumentId!, `${s.turu || 'Tutanak'} · ${s.kod}`); }}>Tutanak</button> : <span className="gs-sifir">—</span>
                            ) : acilabilir ? (
                              <button type="button" className="gs-baglanti" onClick={(e) => { e.stopPropagation(); setAcik(acikMi ? null : anahtar); }} aria-expanded={acikMi}>{acikMi ? 'Kapat' : 'Aç'}</button>
                            ) : <span className="gs-sifir">—</span>}
                          </td>
                        )}
                      </tr>
                      {acikMi && (
                        <tr data-gs-detay-satir>
                          <td colSpan={SUTUN} className="gs-detay"><Ayrinti tur={p.tur} satir={s} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && q.isLoading && <tr className="gs-yukleniyor-satir"><td colSpan={SUTUN}>Yükleniyor…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="gs-sayfalama">
            <Sayfalama sayfa={p.sayfa} sayfaBoyutu={p.sayfaBoyutu} toplam={total} onSayfa={p.onSayfa} onSayfaBoyutu={p.onSayfaBoyutu} birim={birim(p.tur)} renk={p.vurgu} yukleniyor={q.isFetching} />
          </div>
        </>
      )}
    </section>
  );
}

function birim(tur: SorguTuru): string {
  switch (tur) {
    case 'VERGI_BORCU': return 'mükellef';
    case 'E_HACIZ': return 'bildiri';
    case 'YOKLAMA_DENETIM': return 'tutanak';
    case 'POS': return 'satır';
    case 'GELEN_EARSIV': return 'fatura';
  }
}

function satirAnahtari(s: GuncelSatir, i: number): string {
  return `${s.sonucId}-${s.bildiriNo || s.kod || s.faturaNo || s.uyeIsyeriNo || ''}-${i}`;
}

function ayrintiVarMi(s: GuncelSatir): boolean {
  if (s.kind === 'borc') return (s.kalemler?.length ?? 0) > 0;
  if (s.kind === 'haciz') return (s.borclar?.length ?? 0) > 0;
  return false;
}

/** Açılan ayrıntı: borç kalemleri ya da haciz bildirisini oluşturan borçlar. */
function Ayrinti({ tur, satir }: { tur: SorguTuru; satir: GuncelSatir }) {
  if (tur === 'VERGI_BORCU') {
    const kalemler = satir.kalemler || [];
    return (
      <>
        <div className="gs-detay-ust">
          <span>Son sorgu: <b>{tarihSaat(satir.sorguTarihi)}</b></span>
          {satir.hesaplamaZamani && <span>GİB hesaplama zamanı: <b>{tarihSaat(satir.hesaplamaZamani)}</b></span>}
          <span>Gecikme zammı: <b>{tutar(satir.gecikmeZammi)}</b></span>
        </div>
        <div className="gs-detay-adi">Borç kalemleri ({kalemler.length})</div>
        <table className="gs-alt-tablo">
          <thead>
            <tr><th>Vergi türü</th><th>Dönem</th><th>Vade</th><th className="sag">Asıl borç (₺)</th><th className="sag">Gecikme zammı (₺)</th><th className="sag">Toplam (₺)</th><th>Vergi dairesi</th><th>Durum</th></tr>
          </thead>
          <tbody>
            {kalemler.map((k, i) => (
              <tr key={`${k.vergiKodu}-${k.donem}-${i}`}>
                <td>{k.vergiTuru || k.vergiKodu || '—'}</td>
                <td className="gs-sayi">{k.donem || '—'}</td>
                <td className="gs-sayi">{tarihKisa(k.vadeTarihi) || '—'}</td>
                <td className="sag">{tutar(k.asilBorc)}</td>
                <td className="sag">{tutar(k.gecikmeZammi)}</td>
                <td className={`sag${k.vadesiGecmisMi ? ' gs-kirmizi' : ''}`}>{tutar(k.toplam)}</td>
                <td>{k.vergiDairesi || '—'}</td>
                <td className={k.vadesiGecmisMi ? 'gs-kirmizi-yazi' : 'gs-soluk'}>{k.vadesiGecmisMi ? 'Vadesi geçmiş' : 'Vadesi gelmemiş'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  if (tur === 'E_HACIZ') {
    const borclar = satir.borclar || [];
    return (
      <>
        <div className="gs-detay-adi">Bildiriyi oluşturan borçlar ({borclar.length})</div>
        <table className="gs-alt-tablo">
          <thead><tr><th>Vergi türü</th><th>Vergi dönemi</th></tr></thead>
          <tbody>{borclar.map((b, i) => <tr key={i}><td>{b.vergiTuru || '—'}</td><td className="gs-sayi">{vergiDonemi(b.vergiDonem)}</td></tr>)}</tbody>
        </table>
      </>
    );
  }
  return null;
}

/** GİB "112025112025" → "11/2025 – 11/2025" */
function vergiDonemi(v: string): string {
  const m = /^(\d{2})(\d{4})(\d{2})(\d{4})$/.exec(String(v || ''));
  if (!m) return v || '—';
  return `${m[1]}/${m[2]} – ${m[3]}/${m[4]}`;
}

/** Excel (CSV) — düz satırlar. */
type Hucre = string | number;
const h = (v: unknown): Hucre => (typeof v === 'number' ? v : v == null ? '' : String(v));
function disaAktar(tur: SorguTuru, rows: GuncelSatir[]): { basliklar: string[]; satirlar: Hucre[][] } {
  const ad = (s: GuncelSatir) => sorguMukellefAdi(s.taxpayer) || s.taxpayerId;
  const vkn = (s: GuncelSatir) => s.taxpayer?.taxNumber || '';
  switch (tur) {
    case 'VERGI_BORCU': {
      const basliklar = ['Mükellef', 'VKN/TCKN', 'Son sorgu', 'Vadesi geçmiş', 'Vadesi gelmemiş', 'Toplam borç', 'Gecikme zammı', 'Vergi türü', 'Dönem', 'Vade', 'Kalem asıl borç', 'Kalem gecikme zammı', 'Kalem toplam', 'Vergi dairesi'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const ust: Hucre[] = [ad(s), vkn(s), tarihSaat(s.sorguTarihi), s.vadesiGecmis, s.vadesiGelmemis, s.toplam, s.gecikmeZammi];
        if (!s.kalemler?.length) satirlar.push([...ust, 'Borç yok', '', '', 0, 0, 0, '']);
        for (const k of s.kalemler || []) satirlar.push([...ust, h(k.vergiTuru), h(k.donem), tarihKisa(k.vadeTarihi), h(k.asilBorc), h(k.gecikmeZammi), h(k.toplam), h(k.vergiDairesi)]);
      }
      return { basliklar, satirlar };
    }
    case 'E_HACIZ':
      return { basliklar: ['Mükellef', 'VKN/TCKN', 'Son sorgu', 'Kapsam', 'Bildiri no', 'Vergi dairesi', 'Tutar', 'Durum', 'Vergi türü / dönem'], satirlar: rows.map((s) => [ad(s), vkn(s), tarihSaat(s.sorguTarihi), s.kapsam === 'ARAC' ? 'Araç' : 'Banka', h(s.bildiriNo), h(s.vergiDairesi || s.vergiDairesiKodu), s.tutar, s.durum, (s.borclar || []).map((b) => `${b.vergiTuru} ${vergiDonemi(b.vergiDonem)}`).join(' | ')]) };
    case 'YOKLAMA_DENETIM':
      return { basliklar: ['Mükellef', 'VKN/TCKN', 'Son sorgu', 'Kayıt', 'Vergi dairesi', 'Kod', 'Türü', 'Tarih', 'Sonuç', 'Tutanak PDF'], satirlar: rows.map((s) => [ad(s), vkn(s), tarihSaat(s.sorguTarihi), s.kayit === 'DENETIM' ? 'Denetim' : 'Yoklama', h(s.vergiDairesi), h(s.kod), h(s.turu), tarihSaat(s.tarih), h(s.sonuc), s.pdfVarMi ? 'Var' : 'Yok']) };
    case 'POS':
      return { basliklar: ['Mükellef', 'VKN/TCKN', 'Dönem', 'Son sorgu', 'Kaynak', 'Banka / kuruluş', 'Üye işyeri no', 'Tutar'], satirlar: rows.map((s) => [ad(s), vkn(s), donemEtiketi(s.donem), tarihSaat(s.sorguTarihi), s.kaynak === 'ODEME_KURULUSU' ? 'Ödeme kuruluşu' : 'Banka', h(s.unvan), h(s.uyeIsyeriNo), s.tutar]) };
    case 'GELEN_EARSIV':
      return { basliklar: ['Mükellef', 'VKN/TCKN', 'Dönem', 'Fatura tarihi', 'Fatura no', 'Satıcı', 'Satıcı VKN', 'Tutar', 'Vergiler', 'Ödenecek', 'Gönderim', 'Son sorgu'], satirlar: rows.map((s) => [ad(s), vkn(s), donemEtiketi(s.donem), tarihKisa(s.duzenlenmeTarihi), h(s.faturaNo), h(s.saticiUnvan), h(s.saticiVkn), s.toplamTutar, s.vergilerTutari, s.odenecekTutar, s.gonderimSekli === 'KAGIT' ? 'Kâğıt' : 'Elektronik', tarihSaat(s.sorguTarihi)]) };
  }
}
