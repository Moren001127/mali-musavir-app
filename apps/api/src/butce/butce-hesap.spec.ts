import {
  ayGunSayisi,
  donemKaydir,
  kesimVeSonOdeme,
  asgariTutarHesapla,
  odemePlaniHesapla,
  stratejiKarsilastir,
  ekstraOdemeFaydasi,
  PlanKalemi,
} from './butce-hesap';

describe('butce-hesap — takvim', () => {
  it('ay gün sayısını doğru verir (artık yıl dahil)', () => {
    expect(ayGunSayisi(2026, 2)).toBe(28);
    expect(ayGunSayisi(2028, 2)).toBe(29);
    expect(ayGunSayisi(2026, 4)).toBe(30);
    expect(ayGunSayisi(2026, 12)).toBe(31);
  });

  it('dönem kaydırma yıl sınırını aşar', () => {
    expect(donemKaydir('2026-11', 3)).toBe('2027-02');
    expect(donemKaydir('2026-01', -2)).toBe('2025-11');
  });

  it('kesim günü ayın son gününü aşarsa ay sonuna çekilir (31 → Şubat)', () => {
    const { kesimTarihi, sonOdemeTarihi } = kesimVeSonOdeme('2026-02', 31, 10);
    expect(kesimTarihi.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(sonOdemeTarihi.toISOString().slice(0, 10)).toBe('2026-03-10');
  });

  it('son ödeme tarihi kesim + gün farkı, ay atlayarak', () => {
    const { kesimTarihi, sonOdemeTarihi } = kesimVeSonOdeme('2026-08', 26, 10);
    expect(kesimTarihi.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(sonOdemeTarihi.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('asgari tutar: oran hem % hem ondalık kabul eder, borcu aşmaz', () => {
    expect(asgariTutarHesapla(10000, 20)).toBe(2000);
    expect(asgariTutarHesapla(10000, 0.2)).toBe(2000);
    expect(asgariTutarHesapla(50, 0.2)).toBe(10);
    expect(asgariTutarHesapla(0, 0.2)).toBe(0);
  });
});

describe('butce-hesap — ödeme planı', () => {
  const kart: PlanKalemi = {
    id: 'k1',
    ad: 'Bankamatik Kart',
    tip: 'KART',
    kalan: 30000,
    aylikFaiz: 0.0425,
    asgariOran: 0.2,
  };
  const kredi: PlanKalemi = {
    id: 'b1',
    ad: 'İhtiyaç Kredisi',
    tip: 'KREDI',
    kalan: 60000,
    aylikFaiz: 0.02,
    taksitTutari: 5000,
  };

  it('borç yoksa 0 ay döner', () => {
    const s = odemePlaniHesapla({ aylikKapasite: 5000, kalemler: [], strateji: 'CIG' });
    expect(s.ayAdedi).toBe(0);
    expect(s.kapanmiyor).toBe(false);
  });

  it('yeterli kapasitede tüm borçlar kapanır ve kapanış sırası dolar', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 20000,
      kalemler: [kart, kredi],
      strateji: 'CIG',
    });
    expect(s.ayAdedi).not.toBeNull();
    expect(s.kapanmiyor).toBe(false);
    expect(s.kapanisSirasi.length).toBe(2);
    // Çığ: pahalı olan kart (%4,25) önce kapanmalı
    expect(s.kapanisSirasi[0].id).toBe('k1');
  });

  it('çığ, kartopundan daha az faiz ödetir (pahalı borç önce)', () => {
    const kucukUcuz: PlanKalemi = {
      id: 'ucuz',
      ad: 'Küçük Ucuz Borç',
      tip: 'KREDI',
      kalan: 5000,
      aylikFaiz: 0.01,
      taksitTutari: 500,
    };
    const k = stratejiKarsilastir({
      aylikKapasite: 12000,
      kalemler: [kart, kucukUcuz],
    });
    expect(k.cig.toplamFaiz).toBeLessThanOrEqual(k.kartopu.toplamFaiz);
    expect(k.onerilen).toBe('CIG');
    // Kartopu küçüğü önce kapatır
    expect(k.kartopu.kapanisSirasi[0].id).toBe('ucuz');
    expect(k.cig.kapanisSirasi[0].id).toBe('k1');
  });

  it('ilk ay dağılımı zorunlu + ekstra ayrımını verir ve kapasiteyi aşmaz', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 12000,
      kalemler: [kart, kredi],
      strateji: 'CIG',
    });
    const toplam = s.ilkAy.reduce((t, x) => t + x.toplam, 0);
    expect(toplam).toBeLessThanOrEqual(12000 + 0.01);
    const kartSatir = s.ilkAy.find((x) => x.id === 'k1')!;
    expect(kartSatir.zorunlu).toBeGreaterThan(0);
    expect(kartSatir.ekstra).toBeGreaterThan(0); // çığ hedefi kart
    const krediSatir = s.ilkAy.find((x) => x.id === 'b1')!;
    expect(krediSatir.ekstra).toBe(0);
  });

  it('kapasite asgarileri karşılamıyorsa açık raporlanır', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 3000,
      kalemler: [kart, kredi],
      strateji: 'CIG',
    });
    // Gereken: kart asgarisi 6000 + kredi taksiti 5000 = 11000
    expect(s.acik).toBeCloseTo(8000, 1);
  });

  it('faiz kapasiteyi aşıyorsa sonsuz döngüye girmez, kapanmıyor der', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 100,
      kalemler: [{ ...kart, asgariOran: 0 }],
      strateji: 'CIG',
      maxAy: 120,
    });
    expect(s.kapanmiyor).toBe(true);
    expect(s.ayAdedi).toBeNull();
  });

  it('ekstra ödeme faydası en pahalı/uzun borcu öne alır', () => {
    const sira = ekstraOdemeFaydasi([kart, kredi], 10000, (k) => (k.id === 'k1' ? 6 : 12));
    expect(sira[0].id).toBe('k1'); // %4,25 × 6 ay > %2 × 12 ay
    expect(sira[0].kazanc).toBeGreaterThan(sira[1].kazanc);
  });

  it('ekstra ödeme faydası borç tutarını aşan parayı hesaba katmaz', () => {
    const sira = ekstraOdemeFaydasi(
      [{ id: 'x', ad: 'Küçük', tip: 'KART', kalan: 1000, aylikFaiz: 0.05, asgariOran: 0.2 }],
      50000,
      () => 10,
    );
    // Sadece 1000 TL uygulanabilir
    expect(sira[0].kazanc).toBeLessThan(1000 * (Math.pow(1.05, 10) - 1) + 0.01);
  });
});

describe('butce-hesap — zorunlu ödeme kırpılmaz (gerçek vaka)', () => {
  // Canlıda görülen hata: kapasite 35.000, kart asgarileri 29.607 → kalan 5.393.
  // Kredi taksiti 60.000 iken tabloda "zorunlu 5.393" yazıyordu; doğrusu
  // zorunlu 60.000, ödenebilen 5.393, eksik 54.607.
  it('kapasite yetmediğinde zorunlu tutar olduğu gibi kalır, eksik ayrı gösterilir', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 35000,
      kalemler: [
        { id: 'k1', ad: 'Kart', tip: 'KART', kalan: 100000, aylikFaiz: 0.0425, asgariOran: 0.2 },
        { id: 'b1', ad: 'Araç kredisi', tip: 'KREDI', kalan: 660000, aylikFaiz: 0, taksitTutari: 60000 },
      ],
      strateji: 'CIG',
      maxAy: 12,
    });

    const kart = s.ilkAy.find((x) => x.id === 'k1')!;
    const kredi = s.ilkAy.find((x) => x.id === 'b1')!;

    // Kart asgarisi tam ödenir
    expect(kart.zorunlu).toBe(20850); // faiz işledikten sonraki bakiyenin %20'si
    expect(kart.eksik).toBe(0);

    // Kredi taksiti KIRPILMAZ; ödenebilen kadarı ayrı alanda
    expect(kredi.zorunlu).toBe(60000);
    expect(kredi.odenen).toBeLessThan(60000);
    expect(kredi.eksik).toBeGreaterThan(0);
    expect(kredi.odenen + kredi.eksik).toBe(60000);

    // Ödenen toplam kapasiteyi aşmaz
    const odenenToplam = s.ilkAy.reduce((t, x) => t + x.toplam, 0);
    expect(odenenToplam).toBeLessThanOrEqual(35000 + 0.01);
  });

  it('kapasite yeterliyken eksik sıfırdır', () => {
    const s = odemePlaniHesapla({
      aylikKapasite: 200000,
      kalemler: [{ id: 'b1', ad: 'Kredi', tip: 'KREDI', kalan: 100000, aylikFaiz: 0.01, taksitTutari: 20000 }],
      strateji: 'CIG',
    });
    expect(s.ilkAy[0].eksik).toBe(0);
    expect(s.ilkAy[0].odenen).toBe(20000);
  });
});

/**
 * KULLANICI BULGUSU (2026-08-16): bankadaki birikim aylık kapasiteye
 * karıştırılınca plan "5 ayda borçsuz kalırsınız" diyordu. Birikim bir
 * kereliktir; yalnız ilk aya eklenmeli, süre ondan sonra tekrar eden
 * kapasiteyle hesaplanmalı.
 */
describe('ödeme planı — birikim yalnız ilk aya sayılır', () => {
  const kalemler = [
    { id: 'kart:1', ad: 'Kart', tip: 'KART' as const, kalan: 100000, aylikFaiz: 0.0425, asgariOran: 0.2 },
  ];

  it('birikim ilk ayda fazladan ödeme yapar', () => {
    const birikimsiz = odemePlaniHesapla({ aylikKapasite: 10000, kalemler, strateji: 'CIG' });
    const birikimli = odemePlaniHesapla({
      aylikKapasite: 10000,
      ilkAyEkNakit: 50000,
      kalemler,
      strateji: 'CIG',
    });
    const ilkAyOdeme = (p: typeof birikimli) => p.ilkAy.reduce((t, x) => t + x.toplam, 0);
    expect(ilkAyOdeme(birikimli)).toBeGreaterThan(ilkAyOdeme(birikimsiz));
    // Birikim borcu erken kapatır ama sınırsız hızlandırmaz
    expect(birikimli.ayAdedi!).toBeLessThan(birikimsiz.ayAdedi!);
  });

  it('birikim tekrar etmez: 12 ay boyunca her ay eklenmiş gibi davranmaz', () => {
    // Birikim her ay tekrarlasaydı bu borç 2 ayda kapanırdı.
    const p = odemePlaniHesapla({
      aylikKapasite: 10000,
      ilkAyEkNakit: 50000,
      kalemler,
      strateji: 'CIG',
    });
    expect(p.ayAdedi!).toBeGreaterThan(2);
  });

  it('aylık açık tekrar eden kapasiteye göre bulunur, birikimle gizlenmez', () => {
    // Zorunlu 20.000, tekrar eden kapasite 5.000 → her ay 15.000 açık var.
    // Birikim 100.000 olsa bile bu açık kapanmış sayılmamalı.
    const p = odemePlaniHesapla({
      aylikKapasite: 5000,
      ilkAyEkNakit: 100000,
      kalemler,
      strateji: 'CIG',
    });
    expect(p.acik).toBe(15000);
  });

  it('birikim verilmezse davranış eskisiyle birebir aynı kalır', () => {
    const a = odemePlaniHesapla({ aylikKapasite: 10000, kalemler, strateji: 'CIG' });
    const b = odemePlaniHesapla({ aylikKapasite: 10000, ilkAyEkNakit: 0, kalemler, strateji: 'CIG' });
    expect(b.ayAdedi).toBe(a.ayAdedi);
    expect(b.toplamFaiz).toBe(a.toplamFaiz);
  });
});
