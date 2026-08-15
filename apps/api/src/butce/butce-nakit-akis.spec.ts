import { nakitAkisiHesapla, akisOnerileri, AkisHareketi, gunAnahtari } from './butce-nakit-akis';

const G = (gun: number) => new Date(`2026-09-${String(gun).padStart(2, '0')}T00:00:00.000Z`);
const BUGUN = G(1);

describe('nakit akışı takvimi', () => {
  it('girişi geç, çıkışı erken olan ay: toplam yetse bile açık gün çıkar', () => {
    // Ayın 5'inde 30.000 kart ödemesi, 6'sında 50.000 tahsilat.
    // Ay toplamı artıda ama 5'inde para yok — aylık ortalama bunu gizler.
    const hareketler: AkisHareketi[] = [
      { tarih: G(5), tutar: -30000, ad: 'Ziraat kart', tur: 'KART_ODEME', kesin: true },
      { tarih: G(6), tutar: 50000, ad: 'Mükellef tahsilatı', tur: 'GELIR', kesin: false },
    ];
    const s = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, gunSayisi: 20 });

    expect(s.acikGunler.length).toBeGreaterThan(0);
    expect(s.enDusuk.tarih).toBe('2026-09-05');
    expect(s.enDusuk.tutar).toBe(-25000);
    // 6'sındaki tahsilat sonrası artıya döner
    const alti = s.gunler.find((g) => g.tarih === '2026-09-06')!;
    expect(alti.bakiye).toBe(25000);
  });

  it('nakit yeterliyse açık gün olmaz', () => {
    const s = nakitAkisiHesapla({
      baslangicNakit: 60000,
      hareketler: [{ tarih: G(5), tutar: -30000, ad: 'kart', tur: 'KART_ODEME', kesin: true }],
      bugun: BUGUN,
      gunSayisi: 15,
    });
    expect(s.acikGunler).toHaveLength(0);
    expect(s.enDusuk.tutar).toBe(30000);
  });

  it('vadesi geçmiş ödeme bugüne çekilir, kaybolmaz', () => {
    const s = nakitAkisiHesapla({
      baslangicNakit: 1000,
      hareketler: [
        { tarih: new Date('2026-08-20T00:00:00.000Z'), tutar: -5000, ad: 'geciken kart', tur: 'KART_ODEME', kesin: true },
      ],
      bugun: BUGUN,
      gunSayisi: 10,
    });
    expect(s.gunler[0].cikis).toBe(5000);
    expect(s.gunler[0].bakiye).toBe(-4000);
  });

  it('KMH limiti açığı karşılıyorsa işaretlenir', () => {
    const hareketler: AkisHareketi[] = [
      { tarih: G(3), tutar: -20000, ad: 'kart', tur: 'KART_ODEME', kesin: true },
    ];
    const kmhVar = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, kmhLimitToplam: 50000 });
    const kmhYok = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, kmhLimitToplam: 1000 });
    expect(kmhVar.kmhIleKarsilanir).toBe(true);
    expect(kmhYok.kmhIleKarsilanir).toBe(false);
  });

  it('toplam giriş ve çıkış doğru toplanır', () => {
    const s = nakitAkisiHesapla({
      baslangicNakit: 0,
      hareketler: [
        { tarih: G(2), tutar: 10000, ad: 'tahsilat', tur: 'GELIR', kesin: false },
        { tarih: G(2), tutar: 5000, ad: 'tahsilat 2', tur: 'GELIR', kesin: false },
        { tarih: G(4), tutar: -3000, ad: 'kira', tur: 'GIDER', kesin: true },
      ],
      bugun: BUGUN,
      gunSayisi: 10,
    });
    expect(s.toplamGiris).toBe(15000);
    expect(s.toplamCikis).toBe(3000);
    expect(s.gunler[9].bakiye).toBe(12000);
  });
});

describe('nakit akışı önerileri', () => {
  const hareketler: AkisHareketi[] = [
    {
      tarih: G(5),
      tutar: -30000,
      ad: 'Ziraat kart',
      tur: 'KART_ODEME',
      kesin: true,
      esnek: { asgari: 6000, aylikFaiz: 0.0425 },
    },
    { tarih: G(6), tutar: 50000, ad: 'Mükellef tahsilatı', tur: 'GELIR', kesin: false },
  ];

  it('açık gün için seçenek üretir ve en ucuzu önerir', () => {
    const s = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, gunSayisi: 20 });
    const o = akisOnerileri(s, hareketler, { kmhAylikFaiz: 5 });
    expect(o.length).toBeGreaterThan(0);

    const ilk = o[0];
    expect(ilk.tarih).toBe('2026-09-05');
    expect(ilk.acik).toBe(25000);
    // Asgari ödeme seçeneği üretilmeli
    expect(ilk.secenekler.some((x) => x.ad.includes('asgari'))).toBe(true);
    // KMH seçeneği üretilmeli
    expect(ilk.secenekler.some((x) => x.ad.includes('KMH'))).toBe(true);
    // Tam olarak bir seçenek önerilmiş olmalı ve o "önerilmez" olmamalı
    const onerilenler = ilk.secenekler.filter((x) => x.onerilen);
    expect(onerilenler).toHaveLength(1);
    expect(onerilenler[0].ad).not.toContain('önerilmez');
  });

  it('bedelsiz seçenek (tahsilatı öne çekme) varsa o önerilir', () => {
    const s = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, gunSayisi: 20 });
    const o = akisOnerileri(s, hareketler);
    const onerilen = o[0].secenekler.find((x) => x.onerilen)!;
    expect(onerilen.maliyet).toBe(0);
  });

  it('açık yoksa öneri de yok', () => {
    const s = nakitAkisiHesapla({
      baslangicNakit: 100000,
      hareketler,
      bugun: BUGUN,
      gunSayisi: 20,
    });
    expect(akisOnerileri(s, hareketler)).toHaveLength(0);
  });

  it('gün anahtarı UTC gün olarak sabittir', () => {
    expect(gunAnahtari(new Date('2026-09-05T21:30:00.000Z'))).toBe('2026-09-05');
  });
});
