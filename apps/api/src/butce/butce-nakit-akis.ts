/**
 * NAKİT AKIŞI TAKVİMİ — SAF motor (DI yok, yan etki yok, test edilebilir).
 *
 * Neden gerekli: "aylık kapasite" hesabı düzenli maaşlı biri için çalışır.
 * Geliri tahsilata bağlı biri için çalışmaz — ayın toplamı yetse bile PARANIN
 * GELDİĞİ GÜN ile ÖDEMENİN DÜŞTÜĞÜ GÜN tutmayabilir. Örnek: ayın 5'inde kart
 * son ödemesi var ama tahsilat 6'sında geliyor. Ay sonunda "para yetti" görünür,
 * gerçekte 5'inde ödeme yapılamaz ve gecikme faizi işler.
 *
 * Bu motor günü gününe bakiye çıkarır, açık günleri bulur ve her açık için
 * seçenekleri maliyetiyle karşılaştırır.
 */

export type AkisTuru = 'GELIR' | 'GIDER' | 'KART_ODEME' | 'KREDI_TAKSIT' | 'KMH_FAIZ';

export interface AkisHareketi {
  /** Gün (saat bilgisi yok sayılır) */
  tarih: Date;
  /** + giriş, − çıkış */
  tutar: number;
  ad: string;
  tur: AkisTuru;
  /** false = beklenen/tahmini (henüz gerçekleşmedi) */
  kesin: boolean;
  kaynakId?: string;
  /** Kart ödemesi asgariye çekilebilir; asgari tutar ve kalan borcun aylık faizi */
  esnek?: { asgari: number; aylikFaiz: number };
}

export interface AkisGunu {
  tarih: string; // YYYY-MM-DD
  giris: number;
  cikis: number;
  /** Gün sonu nakit bakiyesi (KMH kullanımı dahil değil) */
  bakiye: number;
  hareketler: Array<{ ad: string; tutar: number; tur: AkisTuru; kesin: boolean }>;
  /** Bakiye eksiye düştüyse açık tutarı (pozitif) */
  acik: number;
}

export interface AkisSonuc {
  baslangicNakit: number;
  gunler: AkisGunu[];
  /** Dönem içindeki en düşük bakiye ve günü */
  enDusuk: { tarih: string; tutar: number };
  /** Bakiyenin eksiye düştüğü günler */
  acikGunler: AkisGunu[];
  /** Toplam KMH limiti bu açıkları karşılıyor mu */
  kmhIleKarsilanir: boolean;
  toplamGiris: number;
  toplamCikis: number;
}

export interface AkisOnerisi {
  tarih: string;
  acik: number;
  baslik: string;
  secenekler: Array<{
    ad: string;
    aciklama: string;
    /** Tahmini maliyet (TL). 0 = bedelsiz çözüm */
    maliyet: number;
    onerilen: boolean;
  }>;
}

const KURUS = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Date → 'YYYY-MM-DD' (UTC gün) */
export function gunAnahtari(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Saat bilgisini atıp güne sabitler */
function gunBasi(d: Date): Date {
  return new Date(`${gunAnahtari(d)}T00:00:00.000Z`);
}

/**
 * Gün gün nakit projeksiyonu.
 * Hareketler tarihe göre gruplanır; her günün sonunda bakiye hesaplanır.
 */
export function nakitAkisiHesapla(p: {
  baslangicNakit: number;
  hareketler: AkisHareketi[];
  gunSayisi?: number;
  bugun?: Date;
  kmhLimitToplam?: number;
}): AkisSonuc {
  const gunSayisi = Math.max(p.gunSayisi ?? 60, 1);
  const bugun = gunBasi(p.bugun ?? new Date());
  const kmhLimit = Math.max(p.kmhLimitToplam ?? 0, 0);

  // Hareketleri güne göre topla (geçmiş tarihli olanlar bugüne çekilir —
  // vadesi geçmiş ödeme hâlâ ödenecek demektir)
  const gunlukMap = new Map<string, AkisHareketi[]>();
  for (const h of p.hareketler || []) {
    if (!h || !Number.isFinite(h.tutar) || h.tutar === 0) continue;
    const t = gunBasi(h.tarih);
    const anahtar = gunAnahtari(t < bugun ? bugun : t);
    const liste = gunlukMap.get(anahtar) || [];
    liste.push(h);
    gunlukMap.set(anahtar, liste);
  }

  const gunler: AkisGunu[] = [];
  let bakiye = KURUS(p.baslangicNakit);
  let enDusuk = { tarih: gunAnahtari(bugun), tutar: bakiye };
  let toplamGiris = 0;
  let toplamCikis = 0;

  for (let i = 0; i < gunSayisi; i++) {
    const gun = new Date(bugun.getTime() + i * 86400000);
    const anahtar = gunAnahtari(gun);
    const hareketler = gunlukMap.get(anahtar) || [];

    let giris = 0;
    let cikis = 0;
    for (const h of hareketler) {
      if (h.tutar > 0) giris = KURUS(giris + h.tutar);
      else cikis = KURUS(cikis + Math.abs(h.tutar));
    }
    bakiye = KURUS(bakiye + giris - cikis);
    toplamGiris = KURUS(toplamGiris + giris);
    toplamCikis = KURUS(toplamCikis + cikis);

    const kayit: AkisGunu = {
      tarih: anahtar,
      giris,
      cikis,
      bakiye,
      hareketler: hareketler.map((h) => ({ ad: h.ad, tutar: h.tutar, tur: h.tur, kesin: h.kesin })),
      acik: bakiye < 0 ? KURUS(-bakiye) : 0,
    };
    gunler.push(kayit);

    if (bakiye < enDusuk.tutar) enDusuk = { tarih: anahtar, tutar: bakiye };
  }

  const acikGunler = gunler.filter((g) => g.acik > 0);
  return {
    baslangicNakit: KURUS(p.baslangicNakit),
    gunler,
    enDusuk,
    acikGunler,
    kmhIleKarsilanir: acikGunler.length === 0 || Math.abs(enDusuk.tutar) <= kmhLimit,
    toplamGiris,
    toplamCikis,
  };
}

/**
 * Açık günler için seçenek üretir ve maliyetlerini karşılaştırır.
 *
 * Seçenekler:
 *  1) Kart ödemesini asgariye çek → kalan borca akdi faiz işler (ödeme gecikmez, kredi notu bozulmaz)
 *  2) KMH kullan → açık tutarına KMH faizi (bir sonraki girişe kadar)
 *  3) Ödemeyi geciktir → gecikme faizi + kredi notu; hesaplanır ama ASLA önerilmez
 *  4) Beklenen tahsilatı öne çekmek → bedelsiz, mümkünse en iyisi
 */
export function akisOnerileri(
  sonuc: AkisSonuc,
  hareketler: AkisHareketi[],
  p: { kmhAylikFaiz?: number; gecikmeAylikFaiz?: number } = {},
): AkisOnerisi[] {
  const kmhFaiz = (p.kmhAylikFaiz ?? 5) / 100;
  const gecikmeFaiz = (p.gecikmeAylikFaiz ?? 4.75) / 100;
  const oneriler: AkisOnerisi[] = [];

  for (const gun of sonuc.acikGunler) {
    // Aynı açığın devamı olan günleri tekrar tekrar raporlama
    const oncekiVar = oneriler.some((o) => {
      const fark = (new Date(gun.tarih).getTime() - new Date(o.tarih).getTime()) / 86400000;
      return fark > 0 && fark <= 7;
    });
    if (oncekiVar) continue;

    // Açığın kapandığı ilk giriş: sonraki günlerde bakiyenin artıya döndüğü gün
    const idx = sonuc.gunler.findIndex((g) => g.tarih === gun.tarih);
    const duzelen = sonuc.gunler.slice(idx + 1).find((g) => g.bakiye >= 0);
    const kacGun = duzelen
      ? Math.max(
          Math.round((new Date(duzelen.tarih).getTime() - new Date(gun.tarih).getTime()) / 86400000),
          1,
        )
      : 30;

    const secenekler: AkisOnerisi['secenekler'] = [];

    // 1) O gün düşen esnek (kart) ödemelerini asgariye çekmek
    const oGunkuKartlar = (hareketler || []).filter(
      (h) => h.esnek && gunAnahtari(h.tarih) === gun.tarih && h.tutar < 0,
    );
    for (const kart of oGunkuKartlar) {
      const tam = Math.abs(kart.tutar);
      const asgari = Math.max(kart.esnek!.asgari, 0);
      const ertelenen = KURUS(tam - asgari);
      if (ertelenen <= 0) continue;
      const rahatlama = Math.min(ertelenen, gun.acik);
      const maliyet = KURUS(ertelenen * kart.esnek!.aylikFaiz);
      secenekler.push({
        ad: `${kart.ad}: asgari öde`,
        aciklama: `Tamamı ${tam.toLocaleString('tr-TR')} TL yerine asgari ${asgari.toLocaleString('tr-TR')} TL öde; ${rahatlama.toLocaleString('tr-TR')} TL nakit kalır. Kalan ${ertelenen.toLocaleString('tr-TR')} TL'ye bir ay akdi faiz işler. Ödeme gecikmediği için kredi notun etkilenmez.`,
        maliyet,
        onerilen: false,
      });
    }

    // 2) KMH kullanmak
    secenekler.push({
      ad: 'KMH (ek hesap) kullan',
      aciklama: `${gun.acik.toLocaleString('tr-TR')} TL açığı ${kacGun} gün KMH ile kapat. KMH faizi günlük işler; girişten sonra hemen kapatılırsa maliyet sınırlı kalır.`,
      maliyet: KURUS(gun.acik * kmhFaiz * (kacGun / 30)),
      onerilen: false,
    });

    // 3) Girişi öne çekmek (tahsilat hızlandırma) — bedelsiz
    const sonrakiGiris = sonuc.gunler
      .slice(idx + 1)
      .find((g) => g.hareketler.some((h) => h.tutar > 0));
    if (sonrakiGiris) {
      const tutar = sonrakiGiris.hareketler.filter((h) => h.tutar > 0).reduce((t, h) => t + h.tutar, 0);
      secenekler.push({
        ad: 'Tahsilatı öne çek',
        aciklama: `${new Date(sonrakiGiris.tarih).toLocaleDateString('tr-TR')} günü beklenen ${KURUS(tutar).toLocaleString('tr-TR')} TL girişi birkaç gün öne alabilirsen açık kapanır ve hiç faiz ödemezsin.`,
        maliyet: 0,
        onerilen: false,
      });
    }

    // 4) Geciktirmek — maliyeti gösterilir, önerilmez
    const geciktirilebilir = oGunkuKartlar.reduce((t, h) => t + Math.abs(h.tutar), 0);
    if (geciktirilebilir > 0) {
      secenekler.push({
        ad: 'Ödemeyi geciktir (önerilmez)',
        aciklama: `Gecikme faizi akdi faizden yüksektir ve gecikme kredi notuna işler. Yalnız karşılaştırma için gösteriliyor.`,
        maliyet: KURUS(geciktirilebilir * gecikmeFaiz * (kacGun / 30)),
        onerilen: false,
      });
    }

    // En ucuz seçenek önerilir (bedelsiz varsa o)
    if (secenekler.length > 0) {
      const uygunlar = secenekler.filter((s) => !s.ad.includes('önerilmez'));
      const enUcuz = uygunlar.sort((a, b) => a.maliyet - b.maliyet)[0];
      if (enUcuz) enUcuz.onerilen = true;
    }

    oneriler.push({
      tarih: gun.tarih,
      acik: gun.acik,
      baslik: `${new Date(gun.tarih).toLocaleDateString('tr-TR')} günü ${gun.acik.toLocaleString('tr-TR')} TL nakit açığı`,
      secenekler,
    });
  }

  return oneriler;
}

/**
 * Bir ödeme gününe kadar biriken nakit: "5'inde ödeme var, o güne kadar
 * elimde ne kadar olacak?" sorusunun cevabı.
 */
export function tariheKadarNakit(sonuc: AkisSonuc, tarih: Date): number {
  const anahtar = gunAnahtari(tarih);
  const gun = sonuc.gunler.find((g) => g.tarih === anahtar);
  return gun ? gun.bakiye : sonuc.gunler[sonuc.gunler.length - 1]?.bakiye ?? sonuc.baslangicNakit;
}
