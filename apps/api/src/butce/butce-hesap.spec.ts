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
