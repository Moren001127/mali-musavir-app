/**
 * 7582 / Seri:B Sıra No:20 TECİL-TAKSİTLENDİRME HESAP MOTORU (SAF — ağ/DB yok).
 *
 * MEVZUAT KAYNAĞI (hepsi birincil metinden alındı, tahmin yok):
 *  • 7582 sayılı Kanun (RG 4/6/2026, 33270): 6183/48'deki azami tecil süresi 36→72 ay,
 *    teminatsız tecil sınırı 1.000.000 TL.
 *  • 11414 sayılı Cumhurbaşkanı Kararı (RG 13/6/2026, 33279): teminatsız sınır 10.000.000 TL.
 *  • Tahsilat Genel Tebliği Seri:B Sıra No:20 (RG 16/6/2026) + GİB Rehberi (Yayın No: 610).
 *
 * BU BİR AF DEĞİLDİR: borç aslı silinmez, sadece tecil faiziyle taksitlendirilir.
 */
import { sadeTr } from './vade';

/** Tebliğ kapsamı: 5/6/2026 (dahil) itibarıyla vadesi gelmiş borçlar. */
export const KAPSAM_VADE_SON = '2026-06-05';
/** Başvuru son günü (dahil). */
export const BASVURU_SON = '2026-08-31';
/** İlk taksit ayı: Eylül/2026 (vade ayın son günü). */
export const ILK_TAKSIT_YIL = 2026;
export const ILK_TAKSIT_AY = 9;
/** Tebliğ kapsamında yıllık tecil faizi (cari %39 yerine). */
export const TECIL_FAIZI_YILLIK = 29;
/** Teminatsız tecil sınırı; aşan kısmın YARISI kadar teminat istenir. */
export const TEMINATSIZ_SINIR = 10_000_000;

export type BorcTuru = 'KDV_BSMV' | 'DIGER' | 'KAPSAM_DISI' | 'BELIRSIZ';

export type DefterTuru = 'BILANCO' | 'ISLETME' | 'DIGER';

/** Borçlunun hukuki statüsü — belediye vb. tür ayrımı olmadan 72 taksit alır. */
export type HukukiStatu = 'NORMAL' | 'BELEDIYE_VB';

export type BorcSatiri = {
  /** Excel'den gelen ham vergi türü metni (örn. "KATMA DEĞER VERGİSİ", "0015") */
  vergiTuru: string;
  /** Asıl + gecikme zammı dahil, tecil talep tarihine göre hesaplanmış toplam */
  tutar: number;
  /** Sınıflandırma elle yapıldıysa buraya yazılır; yoksa metinden türetilir. */
  turElle?: BorcTuru;
  /** "05/2026-05/2026" — VARSA vade türetilip kapsam elemesi YAPILIR (bkz. vade.ts). */
  donem?: string;
};

// ————————————————————————————————————————————————————————————————
// 1) BORÇ TÜRÜ SINIFLANDIRMA
//
// ÜÇ GRUP VAR ve üçü de sonucu değiştirir:
//   • KDV + BSMV (ve bunların vergi ziyaı cezası, gecikme faizi/zammı, bu beyannameler
//     üzerinden tahakkuk eden damga vergisi ve gecikme zammı) → 12 EŞİT TAKSİT.
//     Likidite oranına BAKILMAZ. Çoğu mükellefin borcunun büyük kısmı burada olduğu için
//     "72 ay" başlığı pratikte KDV'ye uygulanmaz.
//   • Kapsam DIŞI: ÖTV · 2026 gelir/kurumlar vergisine mahsup edilecek geçici vergi ·
//     bunların fer'ileri · bu beyannameler üzerinden damga vergisi ve gecikme zammı.
//   • Diğer tüm borçlar → likidite/statü kuralına göre 36/48/72.
//
// TANIYAMAZSA "BELİRSİZ" DÖNER — UYDURMAZ. Kullanıcı elle sınıflandırır; yanlış grup
// yanlış taksit sayısı ve yanlış plan demektir.
// ————————————————————————————————————————————————————————————————
export function borcTuruBelirle(vergiTuru: string): BorcTuru {
  const t = sadeTr(vergiTuru);
  if (!t) return 'BELIRSIZ';

  // KAPSAM DIŞI önce bakılır: "özel tüketim vergisi gecikme zammı" hem ÖTV hem zam içerir.
  if (/(ozel tuketim|özel tüketim|\botv\b|ö\.?t\.?v\.?)/.test(t)) return 'KAPSAM_DISI';
  if (/gecici vergi|geçici vergi/.test(t)) return 'KAPSAM_DISI';

  if (/katma deger|katma değer|\bkdv\b|^0015$/.test(t)) return 'KDV_BSMV';
  if (/banka ve sigorta|\bbsmv\b/.test(t)) return 'KDV_BSMV';

  // Bilinen "diğer" türler — listede yoksa BELİRSİZ kalır ve sorulur.
  if (/gelir vergisi|kurumlar vergisi|stopaj|muhtasar|damga|mtv|motorlu tasit|motorlu taşıt/.test(t)) {
    return 'DIGER';
  }
  if (/gecikme zamm|gecikme faiz|vergi ziya|usulsuzluk|usulsüzlük|idari para cezas/.test(t)) {
    // Fer'i alacak: asıl borcun türünü izler. Hangi asla bağlı olduğu metinden çıkmıyorsa
    // KARAR VERİLMEZ — çünkü KDV'ye bağlıysa 12, değilse 36/48/72 taksit olur.
    return 'BELIRSIZ';
  }
  return 'BELIRSIZ';
}

// ————————————————————————————————————————————————————————————————
// 2) LİKİDİTE ORANI ve AZAMİ TAKSİT
//
// GİB Rehberi (soru 9) formülleri:
//   Bilanço esası : (Dönen Varlıklar − Stoklar) / Kısa Vadeli Yabancı Kaynaklar
//   İşletme esası : (Kasa + Banka + Kısa Vadeli Alacaklar) / Kısa Vadeli Borçlar
//
// HANGİ DÖNEM? Mevzuatta YAZMIYOR (7582, Seri:B No:20 ve GİB rehberi sessiz). Oran beyan
// esaslıdır; dönem seçimi kullanıcıya aittir ve kullanılan dönem çıktıda gösterilir.
//
// VERİ KAYNAĞI: portalda DURAN mizan KULLANILMAZ — güncel olmadığı için yanlış oran verir
// (kullanıcı uyarısı 2026-08-21). Bilanço mükellefinde seçilen dönem için LUCA'DAN TAZE
// MİZAN ÇEKİLİR (mevcut /mizan/fetch-from-luca yolu) ve oran o mizandan üretilen
// bilançonun kalemlerinden hesaplanır. İşletme hesabı esasında Luca'da mizan olmadığı
// için kalemler ELLE girilir.
// ————————————————————————————————————————————————————————————————
export function likiditeOrani(g: {
  defter: DefterTuru;
  donenVarliklar?: number; stoklar?: number; kisaVadeliYabanciKaynak?: number;
  kasa?: number; banka?: number; kisaVadeliAlacaklar?: number; kisaVadeliBorclar?: number;
}): number | null {
  const say = (v: any) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
  if (g.defter === 'BILANCO') {
    const payda = say(g.kisaVadeliYabanciKaynak);
    if (payda <= 0) return null; // sıfıra bölme yok; oran hesaplanamaz demektir
    return (say(g.donenVarliklar) - say(g.stoklar)) / payda;
  }
  if (g.defter === 'ISLETME') {
    const payda = say(g.kisaVadeliBorclar);
    if (payda <= 0) return null;
    return (say(g.kasa) + say(g.banka) + say(g.kisaVadeliAlacaklar)) / payda;
  }
  return null;
}

/**
 * AZAMİ TAKSİT SAYISI.
 *
 * Sıralama önemli — üç kural birbirini ezer:
 *  1. Borç KDV/BSMV ise → 12 (likidite ve statüye BAKILMAZ).
 *  2. Borçlu belediye/il özel idare vb. ise → 72 (tür ayrımı yok).
 *  3. Faal + bilanço/işletme esası ve likidite oranı VARSA → 36/48/72.
 *  4. Bunların dışında kalan tüm borçlular → 48.
 *
 * Likidite oranı hesaplanamadıysa (payda 0, veri yok) 36/48/72'den birini SEÇMEZ;
 * "diğer borçlular" kuralına düşmez de — null döner ve çağıran taraf kullanıcıya sorar.
 * Sebep: oranı bilmeden 72 yazmak mükellefi yanlış beyana sokar.
 */
export function azamiTaksit(g: {
  borcTuru: BorcTuru;
  statu: HukukiStatu;
  faalMi: boolean;
  defter: DefterTuru;
  oran: number | null;
}): { taksit: number | null; gerekce: string } {
  if (g.borcTuru === 'KAPSAM_DISI') {
    return { taksit: null, gerekce: 'Bu borç tebliğ kapsamı dışında (ÖTV / 2026 geçici vergi)' };
  }
  if (g.borcTuru === 'BELIRSIZ') {
    return { taksit: null, gerekce: 'Borç türü belirlenemedi — KDV/BSMV mi değil mi elle işaretlenmeli' };
  }
  if (g.borcTuru === 'KDV_BSMV') {
    return { taksit: 12, gerekce: 'KDV/BSMV ve fer’ileri: alacak türü kuralı gereği 12 eşit taksit' };
  }
  if (g.statu === 'BELEDIYE_VB') {
    return { taksit: 72, gerekce: 'Belediye / il özel idaresi vb.: tür ayrımı olmaksızın 72 eşit taksit' };
  }
  if (g.faalMi && (g.defter === 'BILANCO' || g.defter === 'ISLETME')) {
    if (g.oran == null) {
      return { taksit: null, gerekce: 'Likidite oranı hesaplanamadı — bilanço/işletme verisi eksik' };
    }
    if (g.oran >= 0.5) return { taksit: 36, gerekce: `Likidite oranı ${g.oran.toFixed(2)} ≥ 0,50 → 36 taksit` };
    if (g.oran > 0.3) return { taksit: 48, gerekce: `Likidite oranı ${g.oran.toFixed(2)} (0,30–0,50) → 48 taksit` };
    return { taksit: 72, gerekce: `Likidite oranı ${g.oran.toFixed(2)} ≤ 0,30 → 72 taksit` };
  }
  return { taksit: 48, gerekce: 'Diğer borçlular: 48 eşit taksit' };
}

// ————————————————————————————————————————————————————————————————
// 3) ÖDEME PLANI
//
// Tebliğ (soru 12): "Toplam borç tutarı taksit sayısına bölünerek taksit tutarları
// hesaplanacaktır. Lira kesirleri İLK TAKSİT tutarına eklenecektir. Taksit tutarlarına
// uygulanacak tecil faizi ödeme planlarında AYIN SON GÜNÜ esas alınarak hesaplanır."
//
// Faiz formülü (6183/48, Seri:A No:1): her taksit için AYRI —
//        faiz = taksit tutarı × yıllık oran × gün sayısı / 36.000
// 36.000 = 360 gün × 100. Gün sayımı 30 gün/ay esasına göre yapılır (kullanıcı teyidi
// 2026-08-21: "30 gün olarak alıyor"), yani 30/360 yöntemi.
// ————————————————————————————————————————————————————————————————

/** 30/360 gün sayımı: aylar 30 gün kabul edilir, ayın 31'i 30 sayılır. */
export function gunSayisi30_360(baslangic: Date, bitis: Date): number {
  const g1 = Math.min(baslangic.getUTCDate(), 30);
  const g2 = Math.min(bitis.getUTCDate(), 30);
  return (
    (bitis.getUTCFullYear() - baslangic.getUTCFullYear()) * 360 +
    (bitis.getUTCMonth() - baslangic.getUTCMonth()) * 30 +
    (g2 - g1)
  );
}

/** Taksit vadesi: ilk taksit Eylül/2026 olmak üzere, her ayın SON GÜNÜ. */
export function taksitVadesi(sira: number): Date {
  const ay = ILK_TAKSIT_AY + (sira - 1);
  const yil = ILK_TAKSIT_YIL + Math.floor((ay - 1) / 12);
  const ayIndeks = (ay - 1) % 12;
  // Bir sonraki ayın 0. günü = bu ayın son günü.
  return new Date(Date.UTC(yil, ayIndeks + 1, 0));
}

export type TaksitSatiri = {
  sira: number;
  vade: string;          // YYYY-MM-DD
  anapara: number;
  gun: number;
  tecilFaizi: number;
  odenecek: number;
};

export type OdemePlani = {
  taksitSayisi: number;
  toplamBorc: number;
  toplamFaiz: number;
  toplamOdeme: number;
  aylikTaksit: number;   // ilk taksit hariç sabit tutar
  ilkTaksit: number;     // lira kesirleri buraya eklenir
  teminatGerekli: number; // 0 ise teminat istenmiyor
  satirlar: TaksitSatiri[];
};

const yuvarla = (n: number) => Math.round(n * 100) / 100;

/**
 * ÖDEME PLANI ÜRETİR.
 * @param toplamBorc  asıl + tecil talep tarihine kadar gecikme zammı (tebliğ soru 11)
 * @param taksitSayisi seçilen taksit sayısı
 * @param talepTarihi  tecil talep (başvuru) tarihi — faiz gün sayımı buradan başlar
 */
export function odemePlani(toplamBorc: number, taksitSayisi: number, talepTarihi: Date): OdemePlani {
  if (!(toplamBorc > 0)) throw new Error('Toplam borç sıfırdan büyük olmalı');
  if (!Number.isInteger(taksitSayisi) || taksitSayisi < 1) throw new Error('Taksit sayısı geçersiz');

  // Lira kesirleri İLK taksite eklenir: diğer taksitler tam liraya yuvarlanır.
  const tamTaksit = Math.floor(toplamBorc / taksitSayisi);
  const ilkTaksit = yuvarla(toplamBorc - tamTaksit * (taksitSayisi - 1));

  const satirlar: TaksitSatiri[] = [];
  let toplamFaiz = 0;
  for (let i = 1; i <= taksitSayisi; i++) {
    const vade = taksitVadesi(i);
    const anapara = i === 1 ? ilkTaksit : tamTaksit;
    const gun = Math.max(0, gunSayisi30_360(talepTarihi, vade));
    const faiz = yuvarla((anapara * TECIL_FAIZI_YILLIK * gun) / 36000);
    toplamFaiz = yuvarla(toplamFaiz + faiz);
    satirlar.push({
      sira: i,
      vade: vade.toISOString().slice(0, 10),
      anapara: yuvarla(anapara),
      gun,
      tecilFaizi: faiz,
      odenecek: yuvarla(anapara + faiz),
    });
  }

  const asan = toplamBorc - TEMINATSIZ_SINIR;
  return {
    taksitSayisi,
    toplamBorc: yuvarla(toplamBorc),
    toplamFaiz,
    toplamOdeme: yuvarla(toplamBorc + toplamFaiz),
    aylikTaksit: tamTaksit,
    ilkTaksit,
    teminatGerekli: asan > 0 ? yuvarla(asan / 2) : 0,
    satirlar,
  };
}

/**
 * TÜM TAKSİT SEÇENEKLERİ.
 * Borçlu tebliğdeki sayıdan DAHA AZ taksit seçebilir (rehber soru 8). Bu yüzden
 * azami sayıya kadar anlamlı seçenekler üretilip karşılaştırma tablosu çıkarılır.
 */
export function taksitSecenekleri(azami: number): number[] {
  const adaylar = [1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72];
  const liste = adaylar.filter((x) => x <= azami);
  if (!liste.includes(azami)) liste.push(azami);
  return liste.sort((a, b) => a - b);
}
