// HESAP DAVRANIS DENETIMI — Her hesabin tabiati (dogal bakiye yonu) ve hesap plani hijyeni.
//   Gercek musavir bakisi: Tek Duzen Hesap Plani'nda her hesabin dogal bir bakiye yonu vardir (varlik/gider
//   borc, kaynak/gelir alacak; eksi "(-)" hesaplar ve yansitma hesaplari ters). Kapanis bakiyesi bu yonun
//   tersindeyse buyuk ihtimalle yanlis hesaba kayit ya da eksik bacak vardir. Ayrica alt hesabin adi bos/anlamsizsa
//   berat ve raporlar okunmaz olur.
import { ESIK } from '../esikler';
import { fmtTL, hesapEtiketi, ustSinirla } from '../istatistik';
import type { Bulgu, DenetimBaglami, KuralSonucu } from '../tipler';

export type BakiyeYonu = 'BORC' | 'ALACAK';

// ---------------------------------------------------------------- DOGAL YON TABLOSU (TDHP)
//   Genel kural: sinif 1-2 (varlik) ve 7 (maliyet) BORC; sinif 3-4-5 (kaynak) ALACAK; sinif 6'da gelir
//   hesaplari (60x, 64x, 67x) ALACAK, gider/indirim hesaplari (61x, 62x, 63x, 65x, 66x, 68x) BORC.
//   Istisnalar asagida; kendi ozel kurali olan hesaplar (kasa, banka, cari, ortak, KDV, vergi/SGK/ucret,
//   stok, donem kar/zarar) burada degerlendirilmez.
export const DOGAL_YON = {
  // Baska kurallarin konusu → burada bakilmaz
  HARIC: new Set([
    '100', '102', // kasa gunluk negatif / banka kurallari
    '120', '320', // cari kurallari
    '131', '331', // ortak kurallari
    '190', '191', '391', // KDV kurallari
    '335', '360', '361', // odeme dongusu kurallari
    '690', '691', '692', // donem kar/zarar: yon donemin sonucuna gore degisir
  ]),
  // Stok hesaplari (15x) icin ayri negatif-stok kurali var
  STOK_PREFIX: /^15/,
  // Sinif 1-2-7 icinde ALACAK calisan hesaplar: eksi "(-)" duzenleyici hesaplar (karsilik, reeskont, birikmis
  //   amortisman, sermaye taahhudu) ve 7xx yansitma hesaplari
  ALACAK_ISTISNA: new Set([
    '103', // verilen cekler ve odeme emirleri (-)
    '119', '122', '124', '129', '137', '139', '199', // donen varlik karsilik/reeskont (-)
    '222', '224', '229', '237', '239', // duran varlik alacak reeskont/karsilik (-)
    '241', '243', '244', '246', '247', '249', // mali duran varlik karsilik/taahhut (-)
    '257', '268', '278', '298', '299', // birikmis amortisman / tukenme payi / stok deger dusuklugu (-)
    '711', '721', '731', '741', '751', '761', '771', '781', '798', // yansitma hesaplari
  ]),
  // Sinif 3-4-5 icinde BORC calisan hesaplar: eksi "(-)" duzenleyici hesaplar
  BORC_ISTISNA: new Set([
    '302', '308', '322', '337', // ertelenmis fin. kiralama maliyeti, ihrac farki, borc senetleri reeskontu (-)
    '371', // donem karinin pesin odenen vergi ve diger yukumlulukleri (-)
    '402', '408', '422', '437',
    '501', '503', // odenmemis sermaye (-), sermaye duzeltmesi olumsuz farklari (-)
    '580', '591', // gecmis yillar zararlari (-), donem net zarari (-)
  ]),
  // Iki yonlu calisabilen hesaplar: 393 merkez/subeler cari, 7xx fark hesaplari (fiili-standart maliyet farki)
  DEGERLENDIRME_DISI: new Set(['393', '712', '722', '732', '742', '752', '762', '772', '782']),
} as const;

// 3 haneli ana koda gore dogal yon; null = degerlendirme disi
export function dogalYon(ana: string): BakiyeYonu | null {
  if (!/^\d{3}$/.test(ana)) return null;
  if (DOGAL_YON.HARIC.has(ana)) return null;
  if (DOGAL_YON.STOK_PREFIX.test(ana)) return null;
  if (DOGAL_YON.DEGERLENDIRME_DISI.has(ana)) return null;
  if (DOGAL_YON.ALACAK_ISTISNA.has(ana)) return 'ALACAK';
  if (DOGAL_YON.BORC_ISTISNA.has(ana)) return 'BORC';
  const sinif = ana[0];
  if (sinif === '1' || sinif === '2' || sinif === '7') return 'BORC';
  if (sinif === '3' || sinif === '4' || sinif === '5') return 'ALACAK';
  if (sinif === '6') {
    const grup = ana.slice(0, 2);
    if (grup === '60' || grup === '64' || grup === '67') return 'ALACAK';
    if (grup === '69') return null;
    return 'BORC'; // 61 iade/iskonto, 62 maliyet, 63 faaliyet gideri, 65-66 finansman/diger gider, 68 olagandisi gider
  }
  return null; // 8-9 nazim hesaplar
}

// Ekranda Turkce yon adi (tip degeri ASCII kalir)
function yonAdi(yon: BakiyeYonu): string {
  return yon === 'BORC' ? 'BORÇ' : 'ALACAK';
}

// Mesajda "neden bu yon" kisa aciklamasi
function yonNedeni(ana: string, yon: BakiyeYonu): string {
  if (DOGAL_YON.ALACAK_ISTISNA.has(ana)) return /^7/.test(ana) ? 'yansıtma hesabı' : 'eksi (-) düzenleyici hesap';
  if (DOGAL_YON.BORC_ISTISNA.has(ana)) return 'eksi (-) düzenleyici hesap';
  const sinif = ana[0];
  if (sinif === '1' || sinif === '2') return 'varlık hesabı';
  if (sinif === '3' || sinif === '4') return 'borç/kaynak hesabı';
  if (sinif === '5') return 'özkaynak hesabı';
  if (sinif === '7') return 'maliyet/gider hesabı';
  return yon === 'ALACAK' ? 'gelir hesabı' : 'gider/indirim hesabı';
}

const TABIAT_UST_SINIR = 20; // hesap basina bir bulgu; kalani ozet (brif: 20)
const TABIAT_KESIN_MIN = 1; // kapanis biliniyorsa (Mizan/acilis fisi) bu tutardan buyuk ters bakiye
const TABIAT_NET_MIN = 5_000; // kapanis bilinmiyorsa yalniz donem neti bu tutari asinca (acilis haric)

// ---------------------------------------------------------------- 1) Hesap tabiatina aykiri bakiye
export function kuralHesapTabiatinaAykiriBakiye(b: DenetimBaglami): KuralSonucu {
  const kod = 'HESAP_TABIATINA_AYKIRI_BAKIYE';
  const bulgular: Bulgu[] = [];
  let incelenen = 0;
  const gorulen = new Set<string>();

  const degerlendir = (o: { kod: string; ad: string; ana: string; bakiye: number; kesin: boolean; borc: number; alacak: number; acilis: number | null; capa: Pick<Bulgu, 'voucherKey' | 'rowIndex' | 'hesapKodu'> }) => {
    const yon = dogalYon(o.ana);
    if (!yon) return;
    incelenen += 1;
    const esik = o.kesin ? TABIAT_KESIN_MIN : TABIAT_NET_MIN;
    if (Math.abs(o.bakiye) <= esik) return;
    const fiili: BakiyeYonu = o.bakiye > 0 ? 'BORC' : 'ALACAK';
    if (fiili === yon) return;
    const tutar = Math.abs(o.bakiye);
    const kaynak = o.kesin ? 'kapanış bakiyesi' : 'dönem hareketi neti';
    const kesinNotu = o.kesin ? '' : ' (açılış bakiyesi bilinmiyor; Mizan yüklenirse kesinleşir)';
    bulgular.push({
      severity: 'WARN',
      category: kod,
      message: `${hesapEtiketi(o)}: ${kaynak} ${fmtTL(tutar)} TL ${yonAdi(fiili)} bakiye veriyor; ${yonNedeni(o.ana, yon)} olduğundan doğal yönü ${yonAdi(yon)}${kesinNotu}. Kayıt yönü ya da karşı hesap yanlış olabilir; hesabın hareketlerini kontrol edin.`,
      ...o.capa,
      detail: { tutar, bakiye: o.bakiye, fiiliYon: fiili, beklenenYon: yon, kesin: o.kesin, borc: o.borc, alacak: o.alacak, acilis: o.acilis, hesapAdi: o.ad },
    });
  };

  for (const h of b.hesaplar.values()) {
    gorulen.add(h.kod);
    let bakiye: number;
    let kesin: boolean;
    if (h.kapanis != null) {
      bakiye = h.kapanis;
      kesin = true;
    } else if (b.ozet.isYillik && /^[67]/.test(h.ana)) {
      // Gelir tablosu hesaplari yila sifirdan baslar: yillik defterde donem neti = kapanis
      bakiye = h.net;
      kesin = true;
    } else {
      bakiye = h.net;
      kesin = false;
    }
    degerlendir({ kod: h.kod, ad: h.ad, ana: h.ana, bakiye, kesin, borc: h.borc, alacak: h.alacak, acilis: h.acilis, capa: { voucherKey: h.ilkSatir.voucherKey, rowIndex: h.ilkSatir.rowIndex, hesapKodu: h.kod } });
  }
  // Mizan'da olup donemde hareket gormeyen hesaplar (kapanis kesin)
  for (const m of b.mizanHesaplari.values()) {
    if (gorulen.has(m.kod)) continue;
    degerlendir({ kod: m.kod, ad: m.ad, ana: m.ana, bakiye: m.kapanis, kesin: true, borc: 0, alacak: 0, acilis: m.kapanis, capa: { voucherKey: null, rowIndex: null, hesapKodu: m.kod } });
  }

  if (!incelenen) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Değerlendirilecek hesap yok' };
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${incelenen} hesabın bakiye yönü tabiatına uygun` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, TABIAT_UST_SINIR, (kalan, toplam) => `Toplam ${toplam} hesap tabiatına aykırı bakiye veriyor; en büyük ${toplam - kalan} tanesi listelendi, ${kalan} tanesi daha var.`, kod),
  };
}

// ---------------------------------------------------------------- 2) Hesap adi bos / anlamsiz
const ANLAMSIZ_AD = /^[\d\s.,;:_\-/\\()[\]'"*#+]*$/; // yalniz rakam, bosluk ve noktalama

export function hesapAdiAnlamsizMi(ad: string, kod: string): boolean {
  const t = String(ad || '').trim();
  if (!t) return true;
  if (ANLAMSIZ_AD.test(t)) return true;
  const sikistir = (v: string) => v.replace(/\s+/g, '').toLocaleLowerCase('tr-TR');
  return sikistir(t) === sikistir(kod);
}

export function kuralHesapAdiBos(b: DenetimBaglami): KuralSonucu {
  const kod = 'HESAP_ADI_BOS';
  if (!b.hesaplar.size) return { kod, durum: 'VERI_YOK', bulgular: [], not: 'Dönemde hareketli hesap yok' };
  const bulgular: Bulgu[] = [];
  for (const h of b.hesaplar.values()) {
    if (!hesapAdiAnlamsizMi(h.ad, h.kod)) continue;
    const tutar = h.borc + h.alacak;
    const durum = !h.ad.trim() ? 'adı boş' : `adı anlamsız ("${h.ad.trim()}")`;
    bulgular.push({
      severity: 'INFO',
      category: kod,
      message: `${h.kod}: hesabın ${durum}; dönemde ${h.borcAdet + h.alacakAdet} hareket, ${fmtTL(tutar)} TL. Beratta ve raporlarda hesap adı görünür; hesap planında adı tamamlayın.`,
      voucherKey: h.ilkSatir.voucherKey,
      rowIndex: h.ilkSatir.rowIndex,
      hesapKodu: h.kod,
      detail: { tutar, borc: h.borc, alacak: h.alacak, adet: h.borcAdet + h.alacakAdet, hesapAdi: h.ad },
    });
  }
  if (!bulgular.length) return { kod, durum: 'TEMIZ', bulgular: [], not: `${b.hesaplar.size} hesabın adı dolu` };
  return {
    kod,
    durum: 'BULGU',
    bulgular: ustSinirla(bulgular, ESIK.UST_SINIR_STANDART, (kalan, toplam) => `${toplam} hesabın adı boş/anlamsız; ${kalan} tanesi daha listelenmedi.`, kod),
  };
}

export const HESAP_TABIATI_KURALLARI = [kuralHesapTabiatinaAykiriBakiye, kuralHesapAdiBos];
