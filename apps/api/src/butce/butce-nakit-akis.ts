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

/** Ek hesap (KMH) tanımı — öneri hangi hesaptan kullanılacağını söylemek zorunda */
export interface KmhHesabi {
  id?: string;
  banka: string;
  ad: string;
  /** Bu hesapta kullanılabilir kalan KMH limiti */
  kullanilabilir: number;
  /** Aylık faiz oranı (%) */
  aylikFaiz: number;
}

export interface AkisOnerisi {
  tarih: string;
  /** Bu gün EK olarak gereken para — devreden açık düşülmüştür */
  acik: number;
  /** O günkü toplam nakit açığı (devreden dahil) */
  toplamAcik?: number;
  /** Önceki açık günlerinde kapatıldığı varsayılan tutar */
  devredenAcik?: number;
  baslik: string;
  /** O gün çıkan ödemeler — "neden açık çıktı" sorusunun cevabı */
  oGunkuOdemeler?: Array<{ ad: string; tutar: number; tur: string }>;
  secenekler: Array<{
    ad: string;
    aciklama: string;
    /** Tahmini maliyet (TL). 0 = bedelsiz çözüm */
    maliyet: number;
    /** Faiz oranı girilmediği için maliyet hesaplanamadı — "maliyetsiz" sanılmasın */
    maliyetBilinmiyor?: boolean;
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
  p: {
    kmhAylikFaiz?: number;
    gecikmeAylikFaiz?: number;
    kmhKullanilabilir?: number;
    /** Ek hesaplar — hangi hesaptan ne kadar kullanılacağı buradan söylenir */
    kmhHesaplari?: KmhHesabi[];
  } = {},
): AkisOnerisi[] {
  const gecikmeFaiz = (p.gecikmeAylikFaiz ?? 4.75) / 100;
  // KMH seçeneği yalnız GERÇEKTEN kullanılabilir limit varsa önerilir ve
  // HANGİ HESAPTAN kullanılacağı adıyla söylenir. Eskiden koşulsuz "KMH ile kapat"
  // deniyordu; hesabı olmayan kullanıcıya olmayan bir imkân öneriliyordu.
  //
  // LİMİT TÜKENİR. Kullanıcı bulgusu (2026-08-16): her açık günde limit
  // sıfırdan 50.000 sayılıyordu. Oysa 17'sinde 34.210 kullanılırsa 25'inde
  // kalan limit 15.789'dur. Öneriler gün sırasıyla üretilir ve her önerilen
  // kullanım limitten DÜŞÜLÜR; böylece sonraki günler gerçek kalanı görür.
  const kmhHesaplari = (p.kmhHesaplari || [])
    .filter((h) => h && h.kullanilabilir > 0)
    .sort((a, b) => a.aylikFaiz - b.aylikFaiz) // en ucuz hesap önce
    .map((h) => ({ ...h })); // kopyala: çağıranın verisi bozulmasın
  let kmhSerbest = kmhHesaplari.length
    ? KURUS(kmhHesaplari.reduce((t, h) => t + h.kullanilabilir, 0))
    : Math.max(p.kmhKullanilabilir ?? 0, 0);
  const oneriler: AkisOnerisi[] = [];

  // Önceki günlerde önerilerle ZATEN kapatılmış en derin açık.
  // Açık günleri birbirinden bağımsız değildir: bakiye eksideyken daha da
  // derinleşirse, yalnız ARADAKİ FARK kadar yeni para gerekir.
  let kapatilmisAcik = 0;

  for (const gun of sonuc.acikGunler) {
    // Bu güne özgü EK ihtiyaç. Sıfırsa açık zaten önceki öneriyle kapanmıştır.
    const ekIhtiyac = KURUS(gun.acik - kapatilmisAcik);
    if (ekIhtiyac <= 0.009) continue;

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
      const rahatlama = Math.min(ertelenen, ekIhtiyac);
      const maliyet = KURUS(ertelenen * kart.esnek!.aylikFaiz);
      secenekler.push({
        ad: `${kart.ad}: asgari öde`,
        aciklama: `Tamamı ${tam.toLocaleString('tr-TR')} TL yerine asgari ${asgari.toLocaleString('tr-TR')} TL öde; ${rahatlama.toLocaleString('tr-TR')} TL nakit kalır. Kalan ${ertelenen.toLocaleString('tr-TR')} TL'ye bir ay akdi faiz işler. Ödeme gecikmediği için kredi notun etkilenmez.`,
        maliyet,
        onerilen: false,
      });
    }

    // 2) Ek hesap (KMH) — hangi hesaptan ne kadar, adıyla ve faiziyle
    if (kmhSerbest > 0) {
      const yeterli = kmhSerbest >= ekIhtiyac;
      const kapanan = KURUS(Math.min(kmhSerbest, ekIhtiyac));

      // Açığı en ucuz hesaptan başlayarak dağıt
      let kalanIhtiyac = kapanan;
      const kullanim: Array<{ hesap: KmhHesabi; tutar: number; kalanLimit: number }> = [];
      for (const h of kmhHesaplari) {
        if (kalanIhtiyac <= 0.009) break;
        const al = KURUS(Math.min(h.kullanilabilir, kalanIhtiyac));
        if (al <= 0) continue;
        // Bu öneri uygulanırsa limitin bu kadarı gider — sonraki günler için düş
        h.kullanilabilir = KURUS(h.kullanilabilir - al);
        kullanim.push({ hesap: h, tutar: al, kalanLimit: h.kullanilabilir });
        kalanIhtiyac = KURUS(kalanIhtiyac - al);
      }
      kmhSerbest = KURUS(Math.max(kmhSerbest - kapanan, 0));

      const maliyet = kullanim.length
        ? KURUS(kullanim.reduce((t, x) => t + x.tutar * (x.hesap.aylikFaiz / 100) * (kacGun / 30), 0))
        : KURUS(kapanan * ((p.kmhAylikFaiz ?? 5) / 100) * (kacGun / 30));

      const hesapMetni = kullanim.length
        ? kullanim
            .map(
              (x) =>
                `${x.hesap.banka} ${x.hesap.ad} ek hesabından ${x.tutar.toLocaleString('tr-TR')} TL` +
                ` (bu kullanımdan sonra kalan limit ${x.kalanLimit.toLocaleString('tr-TR')} TL` +
                (x.hesap.aylikFaiz > 0 ? `, aylık %${x.hesap.aylikFaiz}` : ', faiz oranı girilmemiş') +
                `)`,
            )
            .join(' + ')
        : `ek hesabınızdan ${kapanan.toLocaleString('tr-TR')} TL`;

      // Faiz oranı girilmemişse maliyet 0 çıkar ve seçenek "maliyetsiz" görünür.
      // KMH'da faiz her zaman vardır; bunu bedava göstermek yanlış yönlendirmedir.
      const faizBilinmiyor = kullanim.length > 0 && kullanim.every((x) => x.hesap.aylikFaiz <= 0);

      secenekler.push({
        ad: !yeterli
          ? 'Ek hesap limitinin tamamını kullan (yetmez)'
          : kullanim.length === 1
            ? `${kullanim[0].hesap.banka} ${kullanim[0].hesap.ad} — ek hesabı kullan`
            : 'Ek hesaplarını kullan',
        aciklama:
          (yeterli
            ? `${kacGun} gün için ${hesapMetni} kullanın. Faiz günlük işler; para girince hemen kapatılırsa maliyet sınırlı kalır.`
            : `${hesapMetni} kullansanız bile ${KURUS(ekIhtiyac - kapanan).toLocaleString('tr-TR')} TL eksik kalır.`) +
          (faizBilinmiyor
            ? ' Bu hesabın faiz oranı girilmediği için maliyet hesaplanamıyor — Hesaplar ekranından oranı girin.'
            : ''),
        maliyet,
        maliyetBilinmiyor: faizBilinmiyor,
        onerilen: false,
      });
    }

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

    // Hiç seçenek üretilemediyse uydurma yapma; durumu olduğu gibi söyle
    if (secenekler.length === 0) {
      secenekler.push({
        ad: 'Ek gelir ya da gider kısıntısı gerekiyor',
        aciklama:
          'Elinizdeki araçlarla (asgari ödeme, ek hesap, tahsilatı öne çekme) bu açık kapanmıyor. ' +
          'Tanımlı ek hesabınız (KMH) yok. Varsa Hesaplar ekranından limitiyle ekleyin; yoksa bu tarihe kadar ek tahsilat planlamanız gerekiyor.',
        maliyet: 0,
        onerilen: true,
      });
    }

    // En ucuz seçenek önerilir (bedelsiz varsa o)
    if (secenekler.length > 0) {
      const uygunlar = secenekler.filter((s) => !s.ad.includes('önerilmez'));
      const enUcuz = uygunlar.sort((a, b) => a.maliyet - b.maliyet)[0];
      if (enUcuz) enUcuz.onerilen = true;
    }

    // O gün NE ÖDEMESİ olduğu başlıkta yazsın; yalnız tarih ve tutar görmek
    // "neden açık çıkmış" sorusunu cevapsız bırakıyordu.
    const oGunCikanlar = gun.hareketler
      .filter((h) => h.tutar < 0)
      .sort((a, b) => a.tutar - b.tutar);
    const oGunToplam = KURUS(oGunCikanlar.reduce((t, h) => t + Math.abs(h.tutar), 0));
    const neOdemesi =
      oGunCikanlar.length === 0
        ? ''
        : oGunCikanlar.length === 1
          ? `${oGunCikanlar[0].ad} ${Math.abs(oGunCikanlar[0].tutar).toLocaleString('tr-TR')} TL`
          : `${oGunCikanlar[0].ad} ve ${oGunCikanlar.length - 1} ödeme daha (toplam ${oGunToplam.toLocaleString('tr-TR')} TL)`;

    const devreden = KURUS(kapatilmisAcik);
    oneriler.push({
      tarih: gun.tarih,
      /** Bu gün için EK olarak gereken para (önceki günlerde kapatılan düşülmüş) */
      acik: ekIhtiyac,
      /** O günkü toplam nakit açığı — devreden dahil */
      toplamAcik: gun.acik,
      /** Önceki açık günlerinde kapatıldığı varsayılan tutar */
      devredenAcik: devreden,
      baslik: neOdemesi
        ? `${new Date(gun.tarih).toLocaleDateString('tr-TR')} · ${neOdemesi} — ${ekIhtiyac.toLocaleString('tr-TR')} TL ek para gerekiyor`
        : `${new Date(gun.tarih).toLocaleDateString('tr-TR')} günü ${ekIhtiyac.toLocaleString('tr-TR')} TL ek para gerekiyor`,
      /** O gün çıkan ödemeler — ekran ayrıntı gösterebilsin */
      oGunkuOdemeler: oGunCikanlar.map((h) => ({ ad: h.ad, tutar: KURUS(Math.abs(h.tutar)), tur: h.tur })),
      secenekler,
    });

    // Bu gün de kapatılmış sayılır; sonraki günler yalnız farkı ister
    kapatilmisAcik = gun.acik;
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
