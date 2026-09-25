'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Sayfalama, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { genelSorgularApi, sorguMukellefAdi, type PanoSatiri, type SorguTuru } from '@/lib/genel-sorgular';
import { adet, donemEtiketi, tarihKisa, tarihSaat, tutar } from '../_lib/bicim';
import { csvIndir } from '../_lib/disa-aktar';
import { TurIkonu } from './TurIkonu';

/*
 * MÜKELLEF PANOSU (2026-09-25, Muzaffer Bey: "tüm mükellefler tek tabloda görünmesin, karışık duruyor").
 * Mükellef seçilmemiş + tür seçilmemişken ekranın ANA görünümü: her mükellef TEK satır, 5 sorgunun güncel
 * özeti yan yana. Satıra tıklamak o mükellefin ayrıntı tablolarını açar (?mukellef=<id>); tek bir sorgu
 * hücresine tıklamak doğrudan o türe götürür (?mukellef=<id>&tur=…).
 * İki boşluk AYRI yazılır: "—" = bu sorgu o mükellefte hiç çalışmadı · "Yok" = çalıştı, kayıt çıkmadı.
 * Renk TEK AİLE: şiddet yalnız iki yerde — satır başı nokta + o hücrenin ana değeri (vadesi geçmiş borç,
 * tatbik edilmiş haciz). POS / e-Arşiv / yoklama hiç renklenmez.
 */

/** Sütun toplamı; altına inince yatay kaydırma. Mükellef ve ok sabit, 5 sorgu sütunu kalanı eşit paylaşır. */
const EN_AZ_GENISLIK = 1206;

export interface MukellefPanosuProps {
  donem: string;
  sayfa: number;
  sayfaBoyutu: SayfaBoyutu;
  onSayfa: (n: number) => void;
  onSayfaBoyutu: (b: SayfaBoyutu) => void;
  /** Satır / hücre tıklaması: mükellefi (ve istenirse türü) süzgece yazar. */
  onAc: (taxpayerId: string, tur?: SorguTuru) => void;
  vurgu: string;
}

export function MukellefPanosu(p: MukellefPanosuProps) {
  const [indiriliyor, setIndiriliyor] = useState(false);
  const q = useQuery({
    queryKey: ['genel-sorgular', 'pano', p.donem, p.sayfa, p.sayfaBoyutu],
    queryFn: () => genelSorgularApi.pano({ donem: p.donem || undefined, page: p.sayfa, pageSize: p.sayfaBoyutu }),
    placeholderData: (onceki) => onceki,
  });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const ozet = q.data?.ozet;
  const hata = q.isError
    ? (q.error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (q.error as Error)?.message || 'Bilinmeyen hata'
    : null;

  const excelIndir = async () => {
    setIndiriliyor(true);
    try {
      const hepsi = await genelSorgularApi.pano({ donem: p.donem || undefined, page: 1, pageSize: 500 });
      if (!hepsi.rows.length) {
        toast.info('İndirilecek satır yok.');
        return;
      }
      csvIndir(`Genel-Sorgular_Mukellef-Panosu_${new Date().toISOString().slice(0, 10)}.csv`, PANO_BASLIK, hepsi.rows.map(panoSatiriCsv));
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      toast.error(err?.response?.data?.message || err?.message || 'Dosya oluşturulamadı');
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <section className="gs-grup gs-pano" data-gs-pano>
      <div className="gs-grup-bas">
        <span className="gs-grup-adi"><TurIkonu tur="TUMU" buyuk />Mükellef Panosu</span>
        <span className="gs-grup-sayi">{q.isLoading ? 'Yükleniyor…' : panoOzetCumlesi(total, ozet)}</span>
        <div className="gs-grup-sag">
          <button type="button" className="gs-dugme-ikincil" onClick={excelIndir} disabled={indiriliyor || total === 0} title="Panodaki tüm mükellefleri Excel'de açılan dosya olarak indir">
            {indiriliyor ? 'Hazırlanıyor…' : 'Excel indir'}
          </button>
        </div>
      </div>

      {hata ? (
        <div className="gs-hata">Pano alınamadı: {hata}</div>
      ) : total === 0 && !q.isLoading ? (
        <div className="gs-bos"><b>Henüz sorgu çalıştırılmadı</b><span>Yukarıdan mükellef seçip Sorgula düğmesine basın ya da gece sorgusunu bekleyin.</span></div>
      ) : (
        <>
          <div className="gs-tablo-sar">
            <table className="gs-tablo gs-pano-tablo" style={{ minWidth: EN_AZ_GENISLIK }}>
              <colgroup>
                <col style={{ width: 300 }} />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col style={{ width: 56 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Mükellef</th>
                  <th className="sag">Vergi borcu (₺)</th>
                  <th>e-Haciz</th>
                  <th>Yoklama / denetim</th>
                  <th className="sag">POS (₺)</th>
                  <th>Gelen e-Arşiv</th>
                  <th className="orta" aria-label="Aç" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.taxpayerId} className="gs-satir" onClick={() => p.onAc(r.taxpayerId)} title={`${sorguMukellefAdi(r.taxpayer) || r.taxpayerId} — ayrıntı tablolarını aç`}>
                    <td className="gs-pano-kim">
                      <span className="gs-nokta" data-ton={r.uyari === 2 ? 'hata' : r.uyari === 1 ? 'uyari' : undefined} aria-hidden />
                      <span className="gs-pano-ad">
                        <b>{sorguMukellefAdi(r.taxpayer) || r.taxpayerId}</b>
                        {/* Çalışmayan sorgular zaten "—" hücresiyle görünüyor; burada tekrar edip satırı şişirmiyoruz. */}
                        <small>
                          <span className="gs-sayi">{r.taxpayer?.taxNumber || '—'}</span>
                          <span className="gs-ayrac">·</span>
                          {r.sonSorgu ? `son sorgu ${tarihSaat(r.sonSorgu)}` : 'sorgu yok'}
                        </small>
                      </span>
                    </td>
                    <PanoHucre satir={r} tur="VERGI_BORCU" sag onAc={p.onAc} />
                    <PanoHucre satir={r} tur="E_HACIZ" onAc={p.onAc} />
                    <PanoHucre satir={r} tur="YOKLAMA_DENETIM" onAc={p.onAc} />
                    <PanoHucre satir={r} tur="POS" sag onAc={p.onAc} />
                    <PanoHucre satir={r} tur="GELEN_EARSIV" onAc={p.onAc} />
                    <td className="orta gs-pano-ok" aria-hidden><ChevronRight size={16} strokeWidth={2.2} /></td>
                  </tr>
                ))}
                {rows.length === 0 && q.isLoading && <tr className="gs-yukleniyor-satir"><td colSpan={7}>Yükleniyor…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="gs-sayfalama">
            <Sayfalama sayfa={p.sayfa} sayfaBoyutu={p.sayfaBoyutu} toplam={total} onSayfa={p.onSayfa} onSayfaBoyutu={p.onSayfaBoyutu} birim="mükellef" renk={p.vurgu} yukleniyor={q.isFetching} />
          </div>
        </>
      )}
    </section>
  );
}

// ── Hücre ────────────────────────────────────────────────────────────────────────
type Icerik = { ana: string; not?: string; ton?: 'hata' | 'uyari' | 'bos' | 'sakin'; ipucu: string };

/**
 * Bir mükellefin bir sorgu türündeki özeti: üstte ana değer, altında not.
 * Sorgu ÇALIŞMIŞSA hücre tıklanabilir (doğrudan o türün tablosuna gider); hiç çalışmamışsa ("—") düz
 * yazıdır — tıklayınca boş tabloya düşmesin, satırın kendisi açılsın.
 */
function PanoHucre({ satir, tur, sag, onAc }: { satir: PanoSatiri; tur: SorguTuru; sag?: boolean; onAc: (id: string, tur?: SorguTuru) => void }) {
  const i = hucreIcerigi(satir, tur);
  const govde = (
    <>
      <span className="gs-oge-ana">{i.ana}</span>
      {i.not && <span className="gs-oge-not">{i.not}</span>}
    </>
  );
  return (
    <td className={sag ? 'sag' : undefined}>
      {i.ton === 'bos' ? (
        <span className="gs-oge" data-ton="bos" data-sag={sag ? 'true' : undefined} title={i.ipucu}>{govde}</span>
      ) : (
        <button
          type="button"
          className="gs-oge"
          data-ton={i.ton}
          data-sag={sag ? 'true' : undefined}
          title={i.ipucu}
          onClick={(e) => {
            e.stopPropagation();
            onAc(satir.taxpayerId, tur);
          }}
        >
          {govde}
        </button>
      )}
    </td>
  );
}

const YOK: Icerik = { ana: '—', ton: 'bos', ipucu: 'Bu sorgu bu mükellefte hiç çalışmadı' };

function hucreIcerigi(r: PanoSatiri, tur: SorguTuru): Icerik {
  switch (tur) {
    case 'VERGI_BORCU': {
      const b = r.borc;
      if (!b) return YOK;
      if (b.toplam === 0) return { ana: 'Borç yok', ton: 'sakin', ipucu: `Vergi borcu sorgulandı (${tarihSaat(b.sorguTarihi)}); borç kaydı çıkmadı` };
      // Tamamı gecikmişse tutarı ikinci kez yazmıyoruz (aynı sayı iki satır = gürültü).
      const not =
        b.vadesiGecmis === 0 ? `${adet(b.kalemSayisi)} kalem · vadesi gelmemiş`
        : b.vadesiGecmis >= b.toplam ? 'tamamı vadesi geçmiş'
        : `${tutar(b.vadesiGecmis)} vadesi geçmiş`;
      return {
        ana: tutar(b.toplam),
        not,
        ton: b.vadesiGecmis > 0 ? 'hata' : 'uyari',
        ipucu: `Toplam borç ${tutar(b.toplam)} ₺ · ${adet(b.kalemSayisi)} kalem · vadesi geçmiş ${tutar(b.vadesiGecmis)} ₺`,
      };
    }
    case 'E_HACIZ': {
      const h = r.haciz;
      if (!h) return YOK;
      if (h.bildiri === 0) return { ana: 'Yok', ton: 'sakin', ipucu: `e-Haciz sorgulandı (${tarihSaat(h.sorguTarihi)}); bildiri çıkmadı` };
      return {
        ana: `${adet(h.bildiri)} bildiri`,
        not: h.tatbik > 0 ? `${adet(h.tatbik)} tatbik · ${tutar(h.tutar)} ₺` : `${tutar(h.tutar)} ₺`,
        ton: h.tatbik > 0 ? 'hata' : 'uyari',
        ipucu: `${adet(h.bildiri)} haciz bildirisi · ${adet(h.tatbik)} tanesi tatbik edilmiş · toplam ${tutar(h.tutar)} ₺`,
      };
    }
    case 'YOKLAMA_DENETIM': {
      const y = r.yoklama;
      if (!y) return YOK;
      if (y.tutanak === 0) return { ana: 'Yok', ton: 'sakin', ipucu: `Yoklama / denetim sorgulandı (${tarihSaat(y.sorguTarihi)}); tutanak çıkmadı` };
      return { ana: `${adet(y.tutanak)} tutanak`, not: y.sonTarih ? `son ${tarihKisa(y.sonTarih)}` : undefined, ipucu: `${adet(y.tutanak)} yoklama / denetim tutanağı` };
    }
    case 'POS': {
      const s = r.pos;
      if (!s) return YOK;
      const ay = donemEtiketi(s.donem);
      if (s.satir === 0) return { ana: 'Yok', ton: 'sakin', ipucu: `POS sorgulandı (${tarihSaat(s.sorguTarihi)}); ${ay} döneminde tutar çıkmadı` };
      return { ana: tutar(s.tutar), not: `${ay} · ${adet(s.satir)} kayıt`, ipucu: `${ay} POS tahsilatı ${tutar(s.tutar)} ₺ · ${adet(s.satir)} banka / kuruluş satırı` };
    }
    case 'GELEN_EARSIV': {
      const e = r.earsiv;
      if (!e) return YOK;
      const ay = donemEtiketi(e.donem);
      if (e.fatura === 0) return { ana: 'Yok', ton: 'sakin', ipucu: `Gelen e-Arşiv sorgulandı (${tarihSaat(e.sorguTarihi)}); ${ay} döneminde fatura çıkmadı` };
      return { ana: `${adet(e.fatura)} fatura`, not: `${ay} · ${tutar(e.tutar)} ₺`, ipucu: `${ay} döneminde gelen ${adet(e.fatura)} e-Arşiv faturası · ödenecek ${tutar(e.tutar)} ₺` };
    }
  }
}

/** Kart başlığındaki tek satır özet. */
function panoOzetCumlesi(
  total: number,
  o?: { mukellef: number; borclu: number; hacizli: number; toplamBorc: number; vadesiGecmis: number; enYeniSorgu: string | null },
): string {
  if (!o || total === 0) return '';
  const parcalar = [`${adet(total)} mükellef`];
  if (o.borclu > 0) parcalar.push(`${adet(o.borclu)} mükellefte borç ${tutar(o.toplamBorc)} ₺${o.vadesiGecmis > 0 ? ` (${tutar(o.vadesiGecmis)} vadesi geçmiş)` : ''}`);
  if (o.hacizli > 0) parcalar.push(`${adet(o.hacizli)} mükellefte e-haciz`);
  if (o.enYeniSorgu) parcalar.push(`son sorgu ${tarihSaat(o.enYeniSorgu)}`);
  return parcalar.join(' · ');
}

// ── Excel (CSV) ──────────────────────────────────────────────────────────────────
const PANO_BASLIK = [
  'Mükellef', 'VKN / TCKN', 'Son sorgu', 'Çalışmayan sorgu',
  'Toplam borç', 'Vadesi geçmiş', 'Vadesi gelmemiş', 'Borç kalemi',
  'Haciz bildirisi', 'Tatbik edilen', 'Haciz tutarı',
  'Tutanak', 'Son tutanak',
  'POS dönemi', 'POS tutarı', 'POS kaydı',
  'e-Arşiv dönemi', 'e-Arşiv faturası', 'e-Arşiv ödenecek',
];
function panoSatiriCsv(r: PanoSatiri): Array<string | number> {
  return [
    sorguMukellefAdi(r.taxpayer) || r.taxpayerId, r.taxpayer?.taxNumber || '', r.sonSorgu ? tarihSaat(r.sonSorgu) : '', r.sorgulanmayan,
    r.borc?.toplam ?? '', r.borc?.vadesiGecmis ?? '', r.borc?.vadesiGelmemis ?? '', r.borc?.kalemSayisi ?? '',
    r.haciz?.bildiri ?? '', r.haciz?.tatbik ?? '', r.haciz?.tutar ?? '',
    r.yoklama?.tutanak ?? '', r.yoklama?.sonTarih ? tarihKisa(r.yoklama.sonTarih) : '',
    r.pos ? donemEtiketi(r.pos.donem) : '', r.pos?.tutar ?? '', r.pos?.satir ?? '',
    r.earsiv ? donemEtiketi(r.earsiv.donem) : '', r.earsiv?.fatura ?? '', r.earsiv?.tutar ?? '',
  ];
}
