import {
  Mesaj,
  kesimGunu,
  tutarBekleniyor,
  sonOdemeYaklasti,
  odemeGecikti,
  asgariOdendi,
  krediTaksiti,
  nakitAcigi,
  gunlukOzet,
  kmhUyarisi,
  limitUyarisi,
  aylikOzet,
  faizOraniDegisti,
  whatsappMetni,
} from './butce-mesajlar';

/* --------- yardımcılar --------- */

/** Yerel tarih — saat dilimi kayması olmasın diye string değil sayı ile kuruluyor */
const gun = (yil: number, ay: number, gunNo: number) => new Date(yil, ay - 1, gunNo);

const ilkSatir = (m: Mesaj) => m.govde.split('\n')[0];

const kacKez = (metin: string, parca: string) => metin.split(parca).length - 1;

const IMZA = '_Moren · Kişisel Bütçe_';

/** Her mesaj fonksiyonundan birer örnek — ortak iskelet testleri bunların hepsini gezer */
function ornekMesajlar(): Array<[string, Mesaj]> {
  return [
    [
      'kesimGunu',
      kesimGunu({
        banka: 'Garanti',
        kart: 'Bonus Platinum',
        sonOdemeTarihi: gun(2026, 9, 5),
        harcamaBaslangic: gun(2026, 8, 6),
      }),
    ],
    [
      'tutarBekleniyor',
      tutarBekleniyor({
        banka: 'Yapı Kredi',
        kart: 'World Gold',
        donem: '2026-08',
        gecenGun: 4,
        sonOdemeTarihi: gun(2026, 9, 5),
        kalanGun: 6,
      }),
    ],
    [
      'sonOdemeYaklasti',
      sonOdemeYaklasti({
        banka: 'Garanti',
        kart: 'Bonus Platinum',
        kalanGun: 3,
        kalanTutar: 38000,
        asgariTutar: 7600,
        sonOdemeTarihi: gun(2026, 9, 5),
        nakit: 12000,
      }),
    ],
    [
      'odemeGecikti',
      odemeGecikti({
        banka: 'Akbank',
        kart: 'Axess',
        gecikmeGun: 4,
        kalanTutar: 30000,
        asgariTutar: 6000,
        gecikmeFaizi: 5,
      }),
    ],
    ['asgariOdendi', asgariOdendi({ banka: 'İş Bankası', kart: 'Maximum', kalanTutar: 21000, aylikFaiz: 4.25 })],
    [
      'krediTaksiti',
      krediTaksiti({ ad: 'Konut kredisi', tutar: 12500.5, kalanGun: 3, odemeGunu: 15, kalanAnapara: 480000, kalanTaksit: 96 }),
    ],
    [
      'nakitAcigi',
      nakitAcigi({
        tarih: gun(2026, 9, 5),
        acik: 9500,
        odemeToplami: 38000,
        nakit: 28500,
        enUcuzSecenek: { ad: 'Ek hesap', aciklama: '3 gün ek hesap kullanıp maaşla kapatın.', maliyet: 120 },
      }),
    ],
    [
      'gunlukOzet',
      gunlukOzet({
        bugun: gun(2026, 8, 15),
        nakit: 1234.56,
        odemeler: [{ ad: 'Bonus Platinum', tutar: 5000 }],
        beklenenGirisler: [],
      }),
    ],
    ['kmhUyarisi', kmhUyarisi({ banka: 'Garanti', hesap: 'Vadesiz TL', borc: 8000, limit: 10000, aylikFaiz: 6 })],
    ['limitUyarisi', limitUyarisi({ banka: 'Akbank', kart: 'Axess', doluluk: 96, kalanLimit: 1500 })],
    [
      'aylikOzet',
      aylikOzet({
        donem: '2026-08',
        gelir: 125000,
        gider: 92000,
        net: 33000,
        toplamBorc: 410000,
        kapasite: 25000,
        ilkAy: [{ ad: 'Bonus Platinum', tutar: 38000 }],
        kapanisAy: 18,
      }),
    ],
    [
      'faizOraniDegisti',
      faizOraniDegisti({ eskiAkdi: 3.66, yeniAkdi: 4.25, eskiGecikme: 3.96, yeniGecikme: 4.55, kartSayisi: 3 }),
    ],
  ];
}

/* ===================== ORTAK İSKELET ===================== */

describe('butce-mesajlar — ortak iskelet', () => {
  it.each(ornekMesajlar())('%s: gövde boş değil', (_ad, m) => {
    expect(m.govde.trim().length).toBeGreaterThan(0);
  });

  it.each(ornekMesajlar())('%s: ilk satır büyük harf ve *yıldız* ile kalın', (_ad, m) => {
    const bas = ilkSatir(m);
    expect(bas).toMatch(/^\*[^*]+\*$/);
    const icerik = bas.slice(1, -1);
    expect(icerik).toBe(m.baslik.toLocaleUpperCase('tr-TR'));
  });

  it.each(ornekMesajlar())('%s: imza satırıyla biter', (_ad, m) => {
    expect(m.govde.endsWith(IMZA)).toBe(true);
  });

  it.each(ornekMesajlar())('%s: arka arkaya iki boş satır yok', (_ad, m) => {
    expect(m.govde).not.toMatch(/\n\n\n/);
    expect(m.govde.startsWith('\n')).toBe(false);
    expect(m.govde.endsWith('\n')).toBe(false);
  });

  it.each(ornekMesajlar())('%s: anahtar ve başlık dolu', (_ad, m) => {
    expect(m.anahtar.length).toBeGreaterThan(0);
    expect(m.baslik.length).toBeGreaterThan(0);
  });
});

/* ===================== TUTAR BİÇİMİ ===================== */

describe('butce-mesajlar — tutar biçimi (binlik nokta, kuruş virgül, TL)', () => {
  it('sonOdemeYaklasti tutarları Türk biçiminde yazar', () => {
    const m = sonOdemeYaklasti({
      banka: 'Garanti',
      kart: 'Bonus Platinum',
      kalanGun: 3,
      kalanTutar: 38000,
      asgariTutar: 7600,
      sonOdemeTarihi: gun(2026, 9, 5),
      nakit: 50000,
    });
    expect(m.govde).toContain('38.000,00 TL');
    expect(m.govde).toContain('7.600,00 TL');
    expect(m.govde).toContain('50.000,00 TL');
  });

  it('krediTaksiti kuruşu virgülle, binliği noktayla yazar', () => {
    const m = krediTaksiti({
      ad: 'Konut kredisi',
      tutar: 12500.5,
      kalanGun: 3,
      odemeGunu: 15,
      kalanAnapara: 480000,
      kalanTaksit: 96,
    });
    expect(m.govde).toContain('12.500,50 TL');
    expect(m.govde).toContain('480.000,00 TL');
  });

  it('aylikOzet tutarları Türk biçiminde yazar', () => {
    const m = aylikOzet({
      donem: '2026-08',
      gelir: 125000,
      gider: 92000,
      net: 33000,
      toplamBorc: 410000,
      kapasite: 25000,
      ilkAy: [{ ad: 'Bonus Platinum', tutar: 38000 }],
      kapanisAy: 18,
    });
    expect(m.govde).toContain('125.000,00 TL');
    expect(m.govde).toContain('410.000,00 TL');
    expect(m.baslik).toBe('Ağustos 2026 özeti');
  });

  it('gunlukOzet kuruşlu bakiyeyi doğru yazar', () => {
    const m = gunlukOzet({
      bugun: gun(2026, 8, 15),
      nakit: 1234.56,
      odemeler: [{ ad: 'Bonus Platinum', tutar: 5000 }],
      beklenenGirisler: [],
    });
    expect(m.govde).toContain('1.234,56 TL');
  });

  it('hiçbir tutarda İngiliz biçimi (1,234.56) kullanılmaz', () => {
    for (const [, m] of ornekMesajlar()) {
      expect(m.govde).not.toMatch(/\d{1,3},\d{3}\.\d{2} TL/);
    }
  });
});

/* ===================== SON ÖDEME YAKLAŞTI ===================== */

describe('butce-mesajlar — sonOdemeYaklasti', () => {
  const temel = {
    banka: 'Garanti',
    kart: 'Bonus Platinum',
    kalanTutar: 38000,
    asgariTutar: 7600,
    sonOdemeTarihi: gun(2026, 9, 5),
  };

  it('kalanGun 0 ise başlık "BUGÜN son ödeme günü"', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 0, nakit: 50000 });
    expect(m.baslik).toBe('BUGÜN son ödeme günü');
    expect(ilkSatir(m)).toBe('*BUGÜN SON ÖDEME GÜNÜ*');
    expect(m.kritik).toBe(true);
  });

  it('kalanGun 1 ise başlık "Son ödeme yarın"', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 1, nakit: 50000 });
    expect(m.baslik).toBe('Son ödeme yarın');
    expect(m.kritik).toBe(true);
  });

  it('kalanGun 3 ise başlık "Son ödemeye 3 gün" ve kritik değil', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 3, nakit: 50000 });
    expect(m.baslik).toBe('Son ödemeye 3 gün');
    expect(m.kritik).toBe(false);
  });

  it('nakit yetmiyorsa aksiyon satırında eksik tutar yazar', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 2, nakit: 12000 });
    const aksiyon = m.govde.split('\n').find((s) => s.startsWith('▸')) as string;
    expect(aksiyon).toBeDefined();
    expect(aksiyon).toContain('26.000,00 TL');
    expect(aksiyon).toContain('eksiğiniz var');
  });

  it('nakit yeterliyse eksik tutar geçmez', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 2, nakit: 50000 });
    expect(m.govde).not.toContain('eksiğiniz var');
    expect(m.govde).toContain('▸ Ödemeyi tamamlayın.');
  });

  it('nakit bilinmiyorsa (null) eksik tutar hesaplanmaz', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 2, nakit: null });
    expect(m.govde).not.toContain('eksiğiniz var');
    expect(m.govde).not.toContain('Hesaplarınızdaki para');
  });

  it('banka ve kart adı gövdede yalnız BİR kez geçer (tekrar regresyonu)', () => {
    const m = sonOdemeYaklasti({ ...temel, kalanGun: 3, nakit: 12000 });
    expect(kacKez(m.govde, 'Garanti')).toBe(1);
    expect(kacKez(m.govde, 'Bonus Platinum')).toBe(1);
    expect(m.govde).toContain('Garanti — Bonus Platinum');
  });

  it('diğer kart mesajlarında da kart adı tekrarlanmaz', () => {
    const kartlilar: Mesaj[] = [
      kesimGunu({ banka: 'Garanti', kart: 'Bonus Platinum', sonOdemeTarihi: gun(2026, 9, 5) }),
      tutarBekleniyor({
        banka: 'Garanti',
        kart: 'Bonus Platinum',
        donem: '2026-08',
        gecenGun: 4,
        sonOdemeTarihi: gun(2026, 9, 5),
        kalanGun: 6,
      }),
      odemeGecikti({ banka: 'Garanti', kart: 'Bonus Platinum', gecikmeGun: 4, kalanTutar: 30000, gecikmeFaizi: 5 }),
      asgariOdendi({ banka: 'Garanti', kart: 'Bonus Platinum', kalanTutar: 21000, aylikFaiz: 4.25 }),
      limitUyarisi({ banka: 'Garanti', kart: 'Bonus Platinum', doluluk: 96, kalanLimit: 1500 }),
    ];
    for (const m of kartlilar) {
      expect(kacKez(m.govde, 'Bonus Platinum')).toBe(1);
      expect(kacKez(m.govde, 'Garanti')).toBe(1);
    }
  });
});

/* ===================== ÖDEME GECİKTİ ===================== */

describe('butce-mesajlar — odemeGecikti', () => {
  const m = odemeGecikti({
    banka: 'Akbank',
    kart: 'Axess',
    gecikmeGun: 4,
    kalanTutar: 30000,
    asgariTutar: 6000,
    gecikmeFaizi: 5,
  });

  it('her zaman kritiktir', () => {
    expect(m.kritik).toBe(true);
    expect(m.baslik).toBe('Ödeme gecikti · 4 gün');
  });

  it('günlük gecikme faizi aylık orandan 30 güne bölünerek bulunur', () => {
    // 30.000 × %5 / 30 = 50,00 TL
    expect(m.govde).toContain('Günlük gecikme faizi: 50,00 TL');
  });

  it('"Bugüne kadar işleyen" satırı günlük faiz × gecikme günüdür', () => {
    // 50,00 × 4 gün = 200,00 TL
    expect(m.govde).toContain('Bugüne kadar işleyen: 200,00 TL');
  });

  it('asgari tutar verilmezse o satır hiç yazılmaz', () => {
    const m2 = odemeGecikti({ banka: 'Akbank', kart: 'Axess', gecikmeGun: 2, kalanTutar: 30000, gecikmeFaizi: 5 });
    expect(m2.govde).not.toContain('Asgari ödeme');
    expect(m2.govde).toContain('Bugüne kadar işleyen: 100,00 TL');
  });
});

/* ===================== GÜNLÜK ÖZET ===================== */

describe('butce-mesajlar — gunlukOzet', () => {
  it('ödemeler nakitten büyükse kritik olur ve "(açık)" yazar', () => {
    const m = gunlukOzet({
      bugun: gun(2026, 8, 15),
      nakit: 3000,
      odemeler: [
        { ad: 'Bonus Platinum', tutar: 4000 },
        { ad: 'Konut kredisi', tutar: 1000 },
      ],
      beklenenGirisler: [],
    });
    expect(m.kritik).toBe(true);
    expect(m.govde).toContain('(açık)');
    expect(m.govde).toContain('Toplam ödeme: *5.000,00 TL*');
    expect(m.govde).toContain('2.000,00 TL eksik');
  });

  it('nakit yetiyorsa kritik olmaz ve "(açık)" geçmez', () => {
    const m = gunlukOzet({
      bugun: gun(2026, 8, 15),
      nakit: 10000,
      odemeler: [{ ad: 'Bonus Platinum', tutar: 4000 }],
      beklenenGirisler: [],
    });
    expect(m.kritik).toBe(false);
    expect(m.govde).not.toContain('(açık)');
    expect(m.govde).toContain('▸ Ödemeler için para yeterli.');
  });

  it('beklenen girişler açığı kapatırsa kritik olmaz', () => {
    const m = gunlukOzet({
      bugun: gun(2026, 8, 15),
      nakit: 3000,
      odemeler: [{ ad: 'Bonus Platinum', tutar: 5000 }],
      beklenenGirisler: [{ ad: 'Maaş', tutar: 4000 }],
    });
    expect(m.kritik).toBe(false);
    expect(m.govde).toContain('• Maaş (giriş): 4.000,00 TL');
    expect(m.govde).toContain('Ödemeler sonrası: 2.000,00 TL');
  });
});

/* ===================== DİĞER KRİTİKLİK KURALLARI ===================== */

describe('butce-mesajlar — kritiklik kuralları', () => {
  it('nakitAcigi her zaman kritiktir', () => {
    const m = nakitAcigi({ tarih: gun(2026, 9, 5), acik: 9500, odemeToplami: 38000, nakit: 28500 });
    expect(m.kritik).toBe(true);
    expect(m.govde).toContain('Açık: *9.500,00 TL*');
  });

  it('tutarBekleniyor 3 günden sonra kritikleşir', () => {
    const yap = (gecenGun: number) =>
      tutarBekleniyor({
        banka: 'Garanti',
        kart: 'Bonus Platinum',
        donem: '2026-08',
        gecenGun,
        sonOdemeTarihi: gun(2026, 9, 5),
        kalanGun: 6,
      });
    expect(yap(2).kritik).toBe(false);
    expect(yap(3).kritik).toBe(true);
  });

  it('kmhUyarisi %80 dolulukta kritikleşir', () => {
    expect(kmhUyarisi({ banka: 'Garanti', hesap: 'Vadesiz TL', borc: 7000, limit: 10000, aylikFaiz: 6 }).kritik).toBe(
      false,
    );
    const m = kmhUyarisi({ banka: 'Garanti', hesap: 'Vadesiz TL', borc: 8000, limit: 10000, aylikFaiz: 6 });
    expect(m.kritik).toBe(true);
    expect(m.govde).toContain('Limit kullanımı: %80');
  });

  it('limitUyarisi %95 dolulukta kritikleşir', () => {
    expect(limitUyarisi({ banka: 'Akbank', kart: 'Axess', doluluk: 94, kalanLimit: 3000 }).kritik).toBe(false);
    expect(limitUyarisi({ banka: 'Akbank', kart: 'Axess', doluluk: 96, kalanLimit: 1500 }).kritik).toBe(true);
  });

  it('krediTaksiti yalnız ödeme günü kritiktir', () => {
    const bugun = krediTaksiti({ ad: 'Konut kredisi', tutar: 12500.5, kalanGun: 0, odemeGunu: 15, kalanAnapara: 480000 });
    expect(bugun.kritik).toBe(true);
    expect(bugun.baslik).toBe('Kredi taksiti bugün');
    const uc = krediTaksiti({ ad: 'Konut kredisi', tutar: 12500.5, kalanGun: 3, odemeGunu: 15, kalanAnapara: 480000 });
    expect(uc.kritik).toBe(false);
    expect(uc.baslik).toBe('Kredi taksitine 3 gün');
  });
});

/* ===================== WHATSAPP METNİ ===================== */

describe('butce-mesajlar — whatsappMetni', () => {
  it('kritik mesaj 🔴 ile başlar', () => {
    const m = odemeGecikti({ banka: 'Akbank', kart: 'Axess', gecikmeGun: 4, kalanTutar: 30000, gecikmeFaizi: 5 });
    expect(whatsappMetni(m).startsWith('🔴 ')).toBe(true);
  });

  it('normal mesaj 💳 ile başlar', () => {
    const m = asgariOdendi({ banka: 'İş Bankası', kart: 'Maximum', kalanTutar: 21000, aylikFaiz: 4.25 });
    expect(whatsappMetni(m).startsWith('💳 ')).toBe(true);
  });

  it('gövdeyi olduğu gibi taşır', () => {
    const m = asgariOdendi({ banka: 'İş Bankası', kart: 'Maximum', kalanTutar: 21000, aylikFaiz: 4.25 });
    expect(whatsappMetni(m)).toBe(`💳 ${m.govde}`);
    expect(whatsappMetni(m).endsWith(IMZA)).toBe(true);
  });
});
