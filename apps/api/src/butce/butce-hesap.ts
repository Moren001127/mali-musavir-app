/**
 * Bütçe modülü — SAF hesaplama çekirdeği (DI yok, yan etki yok, test edilebilir).
 *
 * İki iş yapar:
 *   1) Kredi kartı hesap kesim → son ödeme tarihi takvimi (ay sonu taşmaları dahil)
 *   2) Borç kapatma simülasyonu: "çığ" (en pahalı önce) ve "kartopu" (en küçük önce)
 *      stratejilerini ay ay çalıştırıp hangisinin ne kadar faiz/ay kazandırdığını çıkarır.
 *
 * Faiz modeli: basit aylık bileşik. Ay başında kalan bakiyeye aylık faiz işler,
 * ardından o ayın ödemesi düşülür. Kredi kartı akdi faizi zaten aylık ilan edilir;
 * kredilerde yıllık oran 12'ye bölünür. Sonuçlar TAHMİNİDİR — banka hesaplama
 * yöntemi (gün sayısı, KKDF/BSMV) farklılık gösterebilir.
 */

export type BorcTipi = 'KART' | 'KREDI';
export type Strateji = 'CIG' | 'KARTOPU';

export interface PlanKalemi {
  id: string;
  ad: string;
  tip: BorcTipi;
  /** Kalan bakiye (TL) */
  kalan: number;
  /** Aylık faiz oranı — ondalık (0.0425 = %4,25) */
  aylikFaiz: number;
  /**
   * KART: asgari ödeme oranı (ondalık, 0.20 = %20)
   * KREDI: sabit aylık taksit tutarı (TL)
   */
  asgariOran?: number;
  taksitTutari?: number;
  /**
   * YALNIZ İLK AY için geçerli zorunlu tutar.
   *
   * Bu ayın asgarisi kısmen ya da tamamen ödenmişse kalan borç üzerinden
   * yeniden asgari hesaplamak yanlıştır: banka bu dönem için ikinci bir
   * asgari istemez. Servis "asgari − ödenen" farkını buraya verir; sonraki
   * aylar normal asgari hesabıyla yürür. Verilmezse davranış değişmez.
   */
  ilkAyZorunlu?: number;
}

export interface PlanGirdi {
  /**
   * HER AY TEKRARLAYAN kapasite: aylık gelir − aylık nakit gider − yastık.
   * Simülasyonun tamamı bu tutarla yürür.
   */
  aylikKapasite: number;
  /**
   * YALNIZ İLK AYA özel ek para: bugün hesabınızda duran birikim.
   *
   * Birikim tek seferliktir; her ay tekrar gelmez. Bu ayrım olmadan
   * "elimde 98.000 var" bilgisi aylık kapasiteye karışıp "5 ayda borçsuz
   * kalırsınız" gibi gerçekte tutmayacak bir süre üretiyordu.
   */
  ilkAyEkNakit?: number;
  kalemler: PlanKalemi[];
  strateji: Strateji;
  /** Simülasyon üst sınırı (ay) */
  maxAy?: number;
}

export interface KalemOdeme {
  id: string;
  ad: string;
  tip: BorcTipi;
  /** Bu ay ÖDENMESİ GEREKEN tutar (kart asgarisi / kredi taksiti) — kapasiteye göre kırpılmaz */
  zorunlu: number;
  /** Kapasiteden bu borca gerçekten ayrılabilen zorunlu tutar */
  odenen: number;
  /** Zorunlu tutarın karşılanamayan kısmı (0 ise sorun yok) */
  eksik: number;
  ekstra: number;
  /** odenen + ekstra */
  toplam: number;
  kalanSonra: number;
}

export interface PlanSonuc {
  strateji: Strateji;
  /** Tüm borçların kapandığı ay sayısı; kapanmıyorsa null */
  ayAdedi: number | null;
  toplamFaiz: number;
  toplamOdeme: number;
  /** Bu ay hangi borca ne kadar ödenmeli */
  ilkAy: KalemOdeme[];
  /** Kalemlerin kapanma sırası (kaçıncı ayda biter) */
  kapanisSirasi: Array<{ id: string; ad: string; ay: number }>;
  /** Kapasite zorunlu ödemeleri karşılamıyorsa aylık açık tutarı */
  acik: number;
  /** Simülasyon sınırına dayandıysa true (borç bu kapasiteyle kapanmıyor) */
  kapanmiyor: boolean;
}

export interface PlanKarsilastirma {
  onerilen: Strateji;
  cig: PlanSonuc;
  kartopu: PlanSonuc;
  /** Çığ yönteminin kartopuna göre kazandırdığı faiz (TL, + ise çığ daha ucuz) */
  faizFarki: number;
  /** Çığ yönteminin kazandırdığı ay (+ ise çığ daha kısa) */
  ayFarki: number;
}

const KURUS = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/* ===================== TAKVİM ===================== */

/** Ayın gün sayısı (1-12 ay indeksli) */
export function ayGunSayisi(yil: number, ay: number): number {
  return new Date(Date.UTC(yil, ay, 0)).getUTCDate();
}

/** 'YYYY-MM' → {yil, ay} */
export function donemAyir(donem: string): { yil: number; ay: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(String(donem || '').trim());
  if (!m) throw new Error(`Geçersiz dönem: ${donem} (YYYY-MM bekleniyor)`);
  const yil = Number(m[1]);
  const ay = Number(m[2]);
  if (ay < 1 || ay > 12) throw new Error(`Geçersiz ay: ${donem}`);
  return { yil, ay };
}

export function donemKur(yil: number, ay: number): string {
  const y = yil + Math.floor((ay - 1) / 12);
  const a = ((((ay - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(a).padStart(2, '0')}`;
}

/** Dönemi n ay ileri/geri kaydırır */
export function donemKaydir(donem: string, n: number): string {
  const { yil, ay } = donemAyir(donem);
  return donemKur(yil, ay + n);
}

/**
 * Kredi kartı hesap kesim ve son ödeme tarihi.
 *
 * - Kesim günü ayın gün sayısını aşıyorsa (31 → Şubat) ay sonuna çekilir.
 * - Son ödeme = kesim + gün farkı (banka bazında değişir, kartta tanımlı).
 */
export function kesimVeSonOdeme(
  donem: string,
  kesimGunu: number,
  sonOdemeGunFarki: number,
): { kesimTarihi: Date; sonOdemeTarihi: Date } {
  const { yil, ay } = donemAyir(donem);
  const gunSayisi = ayGunSayisi(yil, ay);
  const gun = Math.min(Math.max(Math.trunc(kesimGunu) || 1, 1), gunSayisi);
  const kesimTarihi = new Date(Date.UTC(yil, ay - 1, gun));
  const fark = Math.max(Math.trunc(sonOdemeGunFarki) || 0, 0);
  const sonOdemeTarihi = new Date(kesimTarihi.getTime() + fark * 86400000);
  return { kesimTarihi, sonOdemeTarihi };
}

/** Kart asgari ödeme tutarı (borç küçükse tamamı) */
export function asgariTutarHesapla(borc: number, asgariOran: number): number {
  const b = Math.max(KURUS(borc), 0);
  if (b <= 0) return 0;
  const oran = asgariOran > 1 ? asgariOran / 100 : asgariOran; // %20 veya 0.20 kabul
  return KURUS(Math.min(b, b * (Number.isFinite(oran) ? oran : 0.2)));
}

/* ===================== BORÇ SİMÜLASYONU ===================== */

interface SimKalem extends PlanKalemi {
  _kalan: number;
}

function zorunluOdeme(k: SimKalem, ay = 2): number {
  if (k._kalan <= 0) return 0;
  // İlk ayda, bu dönemin asgarisi ödenmişse servis 0 (ya da kalan farkı) verir
  if (ay === 1 && k.ilkAyZorunlu !== undefined && k.ilkAyZorunlu !== null) {
    return KURUS(Math.min(Math.max(k.ilkAyZorunlu, 0), k._kalan));
  }
  if (k.tip === 'KART') return asgariTutarHesapla(k._kalan, k.asgariOran ?? 0.2);
  const taksit = KURUS(k.taksitTutari ?? 0);
  return Math.min(k._kalan, taksit > 0 ? taksit : k._kalan);
}

/** Strateji sırası: çığ = en yüksek aylık faiz önce, kartopu = en küçük kalan önce */
function hedefSirala(kalemler: SimKalem[], strateji: Strateji): SimKalem[] {
  const acik = kalemler.filter((k) => k._kalan > 0.009);
  return acik.sort((a, b) =>
    strateji === 'CIG'
      ? b.aylikFaiz - a.aylikFaiz || a._kalan - b._kalan
      : a._kalan - b._kalan || b.aylikFaiz - a.aylikFaiz,
  );
}

/**
 * Ay ay simülasyon. Her ay:
 *   1) Kalan bakiyelere faiz işler
 *   2) Her borcun zorunlu ödemesi (kart asgarisi / kredi taksiti) yapılır
 *   3) Artan kapasite, stratejinin ilk sıradaki borcuna ekstra olarak gider
 */
export function odemePlaniHesapla(girdi: PlanGirdi): PlanSonuc {
  const maxAy = girdi.maxAy ?? 600;
  const kalemler: SimKalem[] = (girdi.kalemler || [])
    .filter((k) => KURUS(k.kalan) > 0)
    .map((k) => ({ ...k, kalan: KURUS(k.kalan), _kalan: KURUS(k.kalan) }));

  const sonuc: PlanSonuc = {
    strateji: girdi.strateji,
    ayAdedi: null,
    toplamFaiz: 0,
    toplamOdeme: 0,
    ilkAy: [],
    kapanisSirasi: [],
    acik: 0,
    kapanmiyor: false,
  };
  if (kalemler.length === 0) {
    sonuc.ayAdedi = 0;
    return sonuc;
  }

  const aylikKapasite = Math.max(KURUS(girdi.aylikKapasite), 0);
  const ilkAyEk = Math.max(KURUS(girdi.ilkAyEkNakit || 0), 0);
  let toplamFaiz = 0;
  let toplamOdeme = 0;
  let oncekiToplamKalan = kalemler.reduce((t, k) => t + k._kalan, 0);
  let artmaSayaci = 0;

  for (let ay = 1; ay <= maxAy; ay++) {
    // 1) Faiz
    for (const k of kalemler) {
      if (k._kalan <= 0) continue;
      const faiz = KURUS(k._kalan * Math.max(k.aylikFaiz, 0));
      k._kalan = KURUS(k._kalan + faiz);
      toplamFaiz = KURUS(toplamFaiz + faiz);
    }

    // 2) Zorunlu ödemeler — birikim yalnız ilk ay eklenir, sonraki aylar tekrarlayan tutarla yürür
    const kapasite = ay === 1 ? KURUS(aylikKapasite + ilkAyEk) : aylikKapasite;
    let kalanKapasite = kapasite;
    const ayDagilim = new Map<string, KalemOdeme>();
    for (const k of kalemler) {
      // Gerçek zorunlu tutar kapasiteye göre KIRPILMAZ: kredi taksiti bölünemez,
      // kart asgarisi de öyle. Kapasite yetmiyorsa fark "eksik" olarak raporlanır.
      const gercekZorunlu = KURUS(zorunluOdeme(k, ay));
      const odenen = KURUS(Math.min(gercekZorunlu, kalanKapasite > 0 ? kalanKapasite : 0));
      if (odenen > 0) {
        k._kalan = KURUS(k._kalan - odenen);
        kalanKapasite = KURUS(kalanKapasite - odenen);
        toplamOdeme = KURUS(toplamOdeme + odenen);
      }
      ayDagilim.set(k.id, {
        id: k.id,
        ad: k.ad,
        tip: k.tip,
        zorunlu: gercekZorunlu,
        odenen,
        eksik: KURUS(Math.max(gercekZorunlu - odenen, 0)),
        ekstra: 0,
        toplam: odenen,
        kalanSonra: KURUS(k._kalan),
      });
    }

    // 3) Ekstra kapasite → strateji hedefi
    while (kalanKapasite > 0.009) {
      const hedefler = hedefSirala(kalemler, girdi.strateji);
      if (hedefler.length === 0) break;
      const hedef = hedefler[0];
      const odenecek = Math.min(hedef._kalan, kalanKapasite);
      hedef._kalan = KURUS(hedef._kalan - odenecek);
      kalanKapasite = KURUS(kalanKapasite - odenecek);
      toplamOdeme = KURUS(toplamOdeme + odenecek);
      const satir = ayDagilim.get(hedef.id);
      if (satir) {
        satir.ekstra = KURUS(satir.ekstra + odenecek);
        satir.toplam = KURUS(satir.odenen + satir.ekstra);
        satir.kalanSonra = KURUS(hedef._kalan);
      }
    }

    // Kapanışları kaydet
    for (const k of kalemler) {
      if (k._kalan <= 0.009 && !sonuc.kapanisSirasi.some((x) => x.id === k.id)) {
        sonuc.kapanisSirasi.push({ id: k.id, ad: k.ad, ay });
      }
    }

    if (ay === 1) {
      sonuc.ilkAy = Array.from(ayDagilim.values());
    }

    const toplamKalan = kalemler.reduce((t, k) => t + Math.max(k._kalan, 0), 0);
    if (toplamKalan <= 0.009) {
      sonuc.ayAdedi = ay;
      break;
    }

    // Borç azalmıyorsa (kapasite faizi bile karşılamıyor) erken çık
    if (toplamKalan >= oncekiToplamKalan - 0.009) {
      artmaSayaci++;
      if (artmaSayaci >= 3) {
        sonuc.kapanmiyor = true;
        break;
      }
    } else {
      artmaSayaci = 0;
    }
    oncekiToplamKalan = toplamKalan;
  }

  if (sonuc.ayAdedi === null) sonuc.kapanmiyor = true;
  sonuc.toplamFaiz = KURUS(toplamFaiz);
  sonuc.toplamOdeme = KURUS(toplamOdeme);

  // Aylık açık: zorunlu toplam − TEKRARLAYAN kapasite.
  //
  // Birikim (ilkAyEk) burada kasten sayılmaz: birikimle bu ayı kurtarmak
  // açığı kapatmaz, sadece erteler. Asıl soru "her ay zorunluları
  // karşılayabiliyor muyum" sorusudur.
  const gereken = (girdi.kalemler || [])
    .filter((k) => KURUS(k.kalan) > 0)
    .reduce((t, k) => {
      // ay=2 verilir: "her ay tekrar eden" zorunlu yük ölçülür, bu ayın
      // ödenmiş olması açığı gizlemesin
      const gecici: SimKalem = { ...k, _kalan: KURUS(k.kalan) };
      return t + zorunluOdeme(gecici, 2);
    }, 0);
  sonuc.acik = KURUS(Math.max(gereken - aylikKapasite, 0));

  return sonuc;
}

/** İki stratejiyi çalıştırıp karşılaştırır ve hangisinin daha faydalı olduğunu söyler. */
export function stratejiKarsilastir(
  girdi: Omit<PlanGirdi, 'strateji'>,
): PlanKarsilastirma {
  const cig = odemePlaniHesapla({ ...girdi, strateji: 'CIG' });
  const kartopu = odemePlaniHesapla({ ...girdi, strateji: 'KARTOPU' });
  const faizFarki = KURUS(kartopu.toplamFaiz - cig.toplamFaiz);
  const ayFarki =
    cig.ayAdedi !== null && kartopu.ayAdedi !== null ? kartopu.ayAdedi - cig.ayAdedi : 0;
  return {
    onerilen: faizFarki >= 0 ? 'CIG' : 'KARTOPU',
    cig,
    kartopu,
    faizFarki,
    ayFarki,
  };
}

/**
 * "Elimdeki fazladan X TL'yi hangi borca koymalıyım?" — her borç için
 * o parayı oraya koyunca kazanılacak faizi hesaplar ve sıralar.
 *
 * Kazanç yaklaşımı: X TL bugün kapatılırsa, o borcun kalan ömrü boyunca
 * işlemeyecek faiz. Ömür = borcun mevcut kapanış ayı (simülasyondan).
 */
export function ekstraOdemeFaydasi(
  kalemler: PlanKalemi[],
  ekstra: number,
  kalanAySayisi: (kalem: PlanKalemi) => number,
): Array<{ id: string; ad: string; kazanc: number; ay: number }> {
  const tutar = Math.max(KURUS(ekstra), 0);
  return kalemler
    .filter((k) => KURUS(k.kalan) > 0)
    .map((k) => {
      const ay = Math.max(Math.trunc(kalanAySayisi(k)), 1);
      const uygulanan = Math.min(tutar, KURUS(k.kalan));
      // Bileşik faiz: uygulanan tutarın ay boyunca doğuracağı faiz
      const kazanc = KURUS(uygulanan * (Math.pow(1 + Math.max(k.aylikFaiz, 0), ay) - 1));
      return { id: k.id, ad: k.ad, kazanc, ay };
    })
    .sort((a, b) => b.kazanc - a.kazanc);
}

/**
 * Bir ekstrenin KAPSADIĞI harcama aralığı.
 *
 * "2026-08 dönemi" = 7 Ağustos'ta kesilen ekstre demektir; içindeki harcamalar
 * bir önceki kesimin ertesi gününden (8 Temmuz) bu kesim gününe (7 Ağustos) kadardır.
 * Ekranda dönem etiketi tek başına yanıltıcı olduğu için bu aralık gösterilir.
 */
export function ekstreHarcamaAraligi(
  donem: string,
  kesimGunu: number,
  sonOdemeGunFarki: number,
): { baslangic: Date; bitis: Date; kesimTarihi: Date; sonOdemeTarihi: Date } {
  const buAy = kesimVeSonOdeme(donem, kesimGunu, sonOdemeGunFarki);
  const oncekiAy = kesimVeSonOdeme(donemKaydir(donem, -1), kesimGunu, sonOdemeGunFarki);
  return {
    baslangic: new Date(oncekiAy.kesimTarihi.getTime() + 86400000), // önceki kesimin ertesi günü
    bitis: buAy.kesimTarihi,
    kesimTarihi: buAy.kesimTarihi,
    sonOdemeTarihi: buAy.sonOdemeTarihi,
  };
}

/**
 * Kredili mevduat hesabı (KMH) borcu, plan motoru için borç kalemine çevrilir.
 *
 * KMH'de sabit taksit yoktur; ödenmezse faiz anaparaya biner. Zorunlu ödeme
 * olarak aylık faiz kadarı alınır — en azından faizi karşılamayan bir plan
 * borcu büyütür ve motor bunu "kapanmıyor" olarak gösterir.
 */
export function kmhBorcKalemi(p: {
  id: string;
  ad: string;
  eksiBakiye: number; // pozitif tutar olarak KMH borcu
  aylikFaizYuzde: number;
}): PlanKalemi | null {
  const kalan = Math.round(Math.max(p.eksiBakiye, 0) * 100) / 100;
  if (kalan <= 0) return null;
  const aylikFaiz = Math.max(p.aylikFaizYuzde, 0) / 100;
  return {
    id: p.id,
    ad: p.ad,
    tip: 'KREDI',
    kalan,
    aylikFaiz,
    // Zorunlu ödeme = işleyen faiz (anaparayı azaltmaz ama borcu büyütmez)
    taksitTutari: Math.max(Math.round(kalan * aylikFaiz * 100) / 100, 1),
  };
}

/**
 * Kart için "dönem içi harcama": son kesimden SONRA yapılan, henüz ekstreye
 * girmemiş harcamalar. Banka ekranlarındaki "güncel borç" bunu içerir,
 * "ekstre borcu" içermez — ikisi karıştırılırsa limit ve plan yanlış çıkar.
 */
export function donemIciAralik(
  kesimGunu: number,
  sonOdemeGunFarki: number,
  bugun: Date = new Date(),
): { sonKesim: Date; simdi: Date } {
  const donem = `${bugun.getUTCFullYear()}-${String(bugun.getUTCMonth() + 1).padStart(2, '0')}`;
  const buAy = kesimVeSonOdeme(donem, kesimGunu, sonOdemeGunFarki);
  // Bu ayın kesimi henüz gelmediyse son kesim önceki aydadır
  const sonKesim =
    buAy.kesimTarihi.getTime() <= bugun.getTime()
      ? buAy.kesimTarihi
      : kesimVeSonOdeme(donemKaydir(donem, -1), kesimGunu, sonOdemeGunFarki).kesimTarihi;
  return { sonKesim, simdi: bugun };
}
