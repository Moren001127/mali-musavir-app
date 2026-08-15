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
    const o = akisOnerileri(s, hareketler, { kmhAylikFaiz: 5, kmhHesaplari: [{ banka: 'Ziraat', ad: 'Vadesiz', kullanilabilir: 50000, aylikFaiz: 5 }] });
    expect(o.length).toBeGreaterThan(0);

    const ilk = o[0];
    expect(ilk.tarih).toBe('2026-09-05');
    expect(ilk.acik).toBe(25000);
    // Asgari ödeme seçeneği üretilmeli
    expect(ilk.secenekler.some((x) => x.ad.includes('asgari'))).toBe(true);
    // Ek hesap (KMH) seçeneği yalnız limit verildiği için üretilmeli
    expect(ilk.secenekler.some((x) => /ek hesab|ek hesap/i.test(x.ad))).toBe(true);
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

describe('nakit akışı — KMH önerisi yalnız gerçek limit varsa', () => {
  // Canlıda görülen hata: hiç ek hesabı olmayan kullanıcıya da "KMH ile kapat"
  // öneriliyordu. Olmayan bir imkânı önermek yanlış yönlendirmedir.
  const hareketler: AkisHareketi[] = [
    {
      tarih: G(5),
      tutar: -30000,
      ad: 'Kart',
      tur: 'KART_ODEME',
      kesin: true,
      esnek: { asgari: 6000, aylikFaiz: 0.0425 },
    },
  ];
  const sonuc = nakitAkisiHesapla({ baslangicNakit: 5000, hareketler, bugun: BUGUN, gunSayisi: 20 });

  it('KMH limiti yoksa KMH seçeneği hiç üretilmez', () => {
    const o = akisOnerileri(sonuc, hareketler, { kmhHesaplari: [] });
    const hepsi = o.flatMap((x) => x.secenekler.map((s) => s.ad));
    expect(hepsi.some((ad) => /KMH|ek hesab/i.test(ad))).toBe(false);
  });

  it('KMH limiti açığı karşılıyorsa normal seçenek olarak çıkar', () => {
    const o = akisOnerileri(sonuc, hareketler, { kmhHesaplari: [{ banka: 'Ziraat', ad: 'Vadesiz', kullanilabilir: 100000, aylikFaiz: 5 }] });
    const kmh = o[0].secenekler.find((s) => /ek hesab/i.test(s.ad))!;
    expect(kmh).toBeTruthy();
    expect(kmh.ad).not.toMatch(/yetmez/i);
    // Hangi hesaptan kullanılacağı ADIYLA söylenmeli
    expect(kmh.ad).toContain('Ziraat');
    expect(kmh.aciklama).toContain('100.000');
  });

  it('KMH limiti yetersizse "yetmez" olarak işaretlenir ve kalan açık söylenir', () => {
    const o = akisOnerileri(sonuc, hareketler, { kmhHesaplari: [{ banka: 'Ziraat', ad: 'Vadesiz', kullanilabilir: 10000, aylikFaiz: 5 }] });
    const kmh = o[0].secenekler.find((s) => /ek hesap/i.test(s.ad))!;
    expect(kmh.ad).toMatch(/yetmez/i);
    expect(kmh.aciklama).toMatch(/eksik kalır/);
  });

  it('hiç seçenek üretilemezse uydurma yapmaz, durumu söyler', () => {
    // Esnek olmayan tek ödeme + KMH yok + sonraki giriş yok
    const h: AkisHareketi[] = [
      { tarih: G(3), tutar: -50000, ad: 'Kredi taksiti', tur: 'KREDI_TAKSIT', kesin: true },
    ];
    const s2 = nakitAkisiHesapla({ baslangicNakit: 0, hareketler: h, bugun: BUGUN, gunSayisi: 15 });
    const o = akisOnerileri(s2, h, { kmhHesaplari: [] });
    expect(o[0].secenekler).toHaveLength(1);
    expect(o[0].secenekler[0].ad).toMatch(/ek gelir/i);
    expect(o[0].secenekler[0].onerilen).toBe(true);
  });
});

describe('nakit akışı — hangi ek hesaptan ne kadar', () => {
  const hareketler: AkisHareketi[] = [
    { tarih: G(5), tutar: -60000, ad: 'Kart', tur: 'KART_ODEME', kesin: true },
  ];
  const sonuc = nakitAkisiHesapla({ baslangicNakit: 0, hareketler, bugun: BUGUN, gunSayisi: 20 });

  it('tek hesap varsa seçenek başlığında banka ve hesap adı geçer', () => {
    const o = akisOnerileri(sonuc, hareketler, {
      kmhHesaplari: [{ banka: 'Ziraat', ad: 'Muzaffer Ören', kullanilabilir: 100000, aylikFaiz: 4.25 }],
    });
    const kmh = o[0].secenekler.find((s) => /ek hesab/i.test(s.ad))!;
    expect(kmh.ad).toBe('Ziraat Muzaffer Ören — ek hesabı kullan');
    expect(kmh.aciklama).toContain('100.000');
    expect(kmh.aciklama).toContain('%4.25');
  });

  it('birden çok hesapta önce EN UCUZ faizli kullanılır', () => {
    const o = akisOnerileri(sonuc, hareketler, {
      kmhHesaplari: [
        { banka: 'Akbank', ad: 'Ticari', kullanilabilir: 50000, aylikFaiz: 6 },
        { banka: 'Ziraat', ad: 'Vadesiz', kullanilabilir: 40000, aylikFaiz: 3 },
      ],
    });
    const kmh = o[0].secenekler.find((s) => /ek hesap/i.test(s.ad) || /ek hesab/i.test(s.ad))!;
    // Önce Ziraat (%3) 40.000, kalan 20.000 Akbank'tan (%6)
    expect(kmh.aciklama.indexOf('Ziraat')).toBeLessThan(kmh.aciklama.indexOf('Akbank'));
    expect(kmh.aciklama).toContain('40.000');
    expect(kmh.aciklama).toContain('20.000');
  });

  it('toplam limit yetmezse eksik kalan tutar söylenir', () => {
    const o = akisOnerileri(sonuc, hareketler, {
      kmhHesaplari: [{ banka: 'Ziraat', ad: 'Vadesiz', kullanilabilir: 10000, aylikFaiz: 4 }],
    });
    const kmh = o[0].secenekler.find((s) => /ek hesap/i.test(s.ad))!;
    expect(kmh.ad).toMatch(/yetmez/i);
    expect(kmh.aciklama).toContain('50.000'); // 60.000 açık − 10.000 limit
  });
});
