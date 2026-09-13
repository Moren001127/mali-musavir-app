// HESAP DAVRANIS DENETIMI — giris noktasi.
//   hesapDavranisDenetimi(girdi, aktifMi) → bulgular + kapsam (her kural calisti mi / temiz mi / neden calismadi)
//   + hesap kartlari (her yaprak hesabin donem ozeti). Servis, bulgulari mevcut FindingDraft akisina ekler,
//   kapsam+kartlari oturumun kontrolOzeti alanina yazar.
import { baglamKur } from './istatistik';
import { HDD_KATALOG } from './katalog';
import { CARI_KURALLARI } from './kurallar/cari';
import { DURAN_VARLIK_KURALLARI } from './kurallar/duran-varlik-ozkaynak';
import { GELIR_KDV_KURALLARI } from './kurallar/gelir-kdv-fis';
import { HAZIR_DEGER_KURALLARI } from './kurallar/hazir-deger';
import { HESAP_TABIATI_KURALLARI } from './kurallar/hesap-tabiati';
import { STOK_GIDER_KURALLARI } from './kurallar/stok-gider-maliyet';
import { VERGI_SGK_KURALLARI } from './kurallar/vergi-sgk-personel';
import type { Bulgu, DenetimBaglami, DenetimGirdisi, DenetimSonucu, HesapKarti, KuralKapsami, KuralSonucu } from './tipler';

export type KuralFonksiyonu = (b: DenetimBaglami) => KuralSonucu;

export const TUM_HDD_KURALLARI: KuralFonksiyonu[] = [
  ...CARI_KURALLARI,
  ...VERGI_SGK_KURALLARI,
  ...HAZIR_DEGER_KURALLARI,
  ...STOK_GIDER_KURALLARI,
  ...DURAN_VARLIK_KURALLARI,
  ...GELIR_KDV_KURALLARI,
  ...HESAP_TABIATI_KURALLARI,
];

function hesapKartlari(b: DenetimBaglami, bulgular: Bulgu[]): HesapKarti[] {
  const kartlar: HesapKarti[] = [];
  const bulguSayisi = new Map<string, number>();
  for (const f of bulgular) if (f.hesapKodu) bulguSayisi.set(f.hesapKodu, (bulguSayisi.get(f.hesapKodu) || 0) + 1);
  for (const h of b.hesaplar.values()) {
    kartlar.push({
      kod: h.kod,
      ad: h.ad,
      ana: h.ana,
      borc: Math.round(h.borc * 100) / 100,
      alacak: Math.round(h.alacak * 100) / 100,
      borcAdet: h.borcAdet,
      alacakAdet: h.alacakAdet,
      acilis: h.acilis == null ? null : Math.round(h.acilis * 100) / 100,
      kapanis: h.kapanis == null ? null : Math.round(h.kapanis * 100) / 100,
      mizanKapanis: h.mizanKapanis == null ? null : Math.round(h.mizanKapanis * 100) / 100,
      hareketsiz: false,
    });
  }
  for (const m of b.mizanHesaplari.values()) {
    if (b.hesaplar.has(m.kod)) continue;
    if (Math.abs(m.kapanis) < 0.005) continue;
    kartlar.push({
      kod: m.kod,
      ad: m.ad,
      ana: m.ana,
      borc: 0,
      alacak: 0,
      borcAdet: 0,
      alacakAdet: 0,
      acilis: Math.round(m.kapanis * 100) / 100,
      kapanis: Math.round(m.kapanis * 100) / 100,
      mizanKapanis: Math.round(m.kapanis * 100) / 100,
      hareketsiz: true,
    });
  }
  kartlar.sort((x, y) => x.kod.localeCompare(y.kod, 'tr'));
  return kartlar;
}

// aktifMi: kural kodu → acik mi (tenant ayari > katalog varsayilani). Kapali kural CALISTIRILMAZ, kapsamda PASIF gorunur.
export function hesapDavranisDenetimi(girdi: DenetimGirdisi, aktifMi: (kod: string) => boolean = () => true): DenetimSonucu {
  const b = baglamKur(girdi);
  const bulgular: Bulgu[] = [];
  const kapsam: KuralKapsami[] = [];
  const gorulen = new Set<string>();
  for (const kural of TUM_HDD_KURALLARI) {
    // Kodu, kurali calistirmadan bilemeyiz; katalogdaki fonksiyon-kod eslesmesi icin once calistirip sonra suzeriz —
    //   ama kapali kural CPU harcamasin diye once "kuru" cagri yerine dogrudan calistirip kodu okuyoruz (kurallar ucuz).
    let sonuc: KuralSonucu;
    try {
      sonuc = kural(b);
    } catch (err: any) {
      // Tek kural patlarsa denetim durmasin; kapsamda gorunsun.
      sonuc = { kod: kural.name || 'BILINMEYEN', durum: 'VERI_YOK', bulgular: [], not: `Kural hata verdi: ${String(err?.message || err).slice(0, 120)}` };
    }
    gorulen.add(sonuc.kod);
    if (!aktifMi(sonuc.kod)) {
      kapsam.push({ kod: sonuc.kod, durum: 'PASIF', bulgu: 0, not: 'Kural kapalı' });
      continue;
    }
    kapsam.push({ kod: sonuc.kod, durum: sonuc.durum, bulgu: sonuc.bulgular.length, not: sonuc.not });
    bulgular.push(...sonuc.bulgular);
  }
  // Katalogda olup hic calismayan kod (kural fonksiyonu yazilmamis) → kapsamda VERI_YOK olarak gorunsun
  for (const k of HDD_KATALOG) {
    if (!gorulen.has(k.kod)) kapsam.push({ kod: k.kod, durum: 'VERI_YOK', bulgu: 0, not: 'Kural motoru bu kodu üretmedi' });
  }
  return { bulgular, kapsam, hesapKartlari: hesapKartlari(b, bulgular), ozet: b.ozet };
}

export { HDD_KATALOG, HDD_KOD_SETI, HDD_VARSAYILAN_KAPALI, ALAN } from './katalog';
export type { KuralTanimi } from './katalog';
export type { DenetimSonucu, HesapKarti, KuralKapsami, MizanBaglami } from './tipler';
