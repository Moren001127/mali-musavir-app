import {
  kademeKarari,
  gunlukPlan,
  TahsilatAdayi,
  OtomasyonAyari,
} from './tahsilat-otomasyon';

const BUGUN = new Date('2026-08-16T09:00:00.000Z');
const gunOnce = (n: number) => new Date(BUGUN.getTime() - n * 86400000);

const AYAR: OtomasyonAyari = { enabled: true, testMode: false, ofisAdi: 'Moren' };

const aday = (o: Partial<TahsilatAdayi> = {}): TahsilatAdayi => ({
  taxpayerId: 't1',
  ad: 'AHMET ATALAY',
  phone: '905550001122',
  bakiye: 12000,
  gecikmeGun: 10,
  ...o,
});

describe('tahsilat otomasyonu — durdurma kuralları', () => {
  it('otomasyon kapalıyken hiç kimseye gitmez', () => {
    const k = kademeKarari(aday(), { ...AYAR, enabled: false }, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/kapalı/i);
  });

  it('susturulmuş mükellefe gönderilmez ve sebebi yazılır', () => {
    const k = kademeKarari(
      aday({ susturmaBitis: new Date(BUGUN.getTime() + 3 * 86400000), susturmaSebebi: 'ödedim beyanı' }),
      AYAR,
      BUGUN,
    );
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toContain('ödedim beyanı');
  });

  it('susturma süresi dolduysa yeniden gönderilir', () => {
    const k = kademeKarari(aday({ susturmaBitis: gunOnce(1) }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(true);
  });

  it('telefonu olmayan atlanır, sessizce düşmez', () => {
    const k = kademeKarari(aday({ phone: null }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/telefon/i);
  });

  it('işi bırakmış mükellef otomatik akıştan çıkar', () => {
    const k = kademeKarari(aday({ isiBirakti: true }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/kapanış mutabakatı/i);
  });

  it('küçük bakiyeye mesaj gitmez (FIFO artığı korunması)', () => {
    const k = kademeKarari(aday({ bakiye: 90 }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/önemlilik/i);
  });

  it('aylık ücretin yarısının altındaki bakiye de atlanır', () => {
    // Aylık ücret 3.000 → eşik 1.500; 900 TL bakiye mesaj hak etmez
    const k = kademeKarari(aday({ bakiye: 900, aylikUcret: 3000 }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
  });

  it('mükellef son 7 günde yazdıysa bot araya girmez', () => {
    const k = kademeKarari(aday({ sonGelenMesajTarihi: gunOnce(2) }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/görüşme sürüyor/i);
  });

  it('yakın zamanda ödeme alındıysa yazılmaz', () => {
    const k = kademeKarari(
      aday({ sonTemasTarihi: gunOnce(20), sonTahsilatTarihi: gunOnce(2) }),
      AYAR,
      BUGUN,
    );
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/ödeme alınmış/i);
  });

  it('bekleme süresi dolmadan ikinci mesaj gitmez', () => {
    const k = kademeKarari(aday({ sonTemasTarihi: gunOnce(5) }), AYAR, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/en az 14 gün/i);
  });

  it('kalıcı olarak hariç tutulan mükellefe gitmez', () => {
    const k = kademeKarari(aday(), { ...AYAR, haricTutulan: ['t1'] }, BUGUN);
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/otomasyon dışı/i);
  });

  it('90+ gün: gönderilmez ama "elle görüşülmeli" olarak işaretlenir', () => {
    const k = kademeKarari(aday({ gecikmeGun: 120 }), AYAR, BUGUN);
    expect(k.kademe).toBe('ELLE');
    expect(k.gonderilebilir).toBe(false);
    expect(k.sebep).toMatch(/elle görüşülmeli/i);
  });
});

describe('tahsilat otomasyonu — mesajlar', () => {
  it('adı ve tutarı net verir', () => {
    const k = kademeKarari(aday({ gecikmeGun: 0 }), AYAR, BUGUN);
    expect(k.mesaj).toContain('AHMET ATALAY');
    expect(k.mesaj).toContain('12.000,00 TL');
    expect(k.mesaj).toMatch(/borç görünüyor/i);
  });

  it('TEK TİP: gecikme ne olursa olsun aynı metin gider', () => {
    // Kademe süzgeci kaldırıldı (kullanıcı kararı). Değişen tek şey tutar.
    const a = kademeKarari(aday({ gecikmeGun: 2 }), AYAR, BUGUN).mesaj;
    const b = kademeKarari(aday({ gecikmeGun: 45 }), AYAR, BUGUN).mesaj;
    const c = kademeKarari(aday({ gecikmeGun: 80 }), AYAR, BUGUN).mesaj;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('ekstre eki ve sahip onayı kavramları kalktı', () => {
    for (const g of [5, 40, 75]) {
      const k = kademeKarari(aday({ gecikmeGun: g }), AYAR, BUGUN);
      expect(k.ekstreEkle).toBe(false);
      expect(k.onayGerekli).toBe(false);
      expect(k.kademe).toBe('TEK');
    }
  });

  it('GEVŞETİCİ KALIPLAR YOK — hatırlatmayı geçersiz kılan ifadeler kullanılmaz', () => {
    // Kullanıcı kararı: "uygun olduğunuzda", "dikkate almayınız", "dekont
    // iletiniz" mesajı isteğe çeviriyor ve gereksiz iş yükü doğuruyor.
    // 'rica ederiz' resmî Türkçe iş dilinde doğaldır; yasak olan, hatırlatmayı
    // geçersiz kılan ve isteğe çeviren kalıplardır.
    const yasak = /uygun olduğunuzda|dikkate almay|dekont iletm|seviniriz/i;
    for (const [g, onceki] of [[0, null], [10, 'K0'], [40, 'K1'], [75, 'K2']] as const) {
      const k = kademeKarari(aday({ gecikmeGun: g }), AYAR, BUGUN);
      if (k.mesaj) expect(k.mesaj).not.toMatch(yasak);
    }
  });

  it('hiçbir mesaj tehditkâr dil içermez', () => {
    const yasak = /icra|haciz|dava|yasal işlem|avukat|savcı/i;
    for (const g of [0, 10, 40, 75]) {
      const k = kademeKarari(aday({ gecikmeGun: g }), AYAR, BUGUN);
      if (k.mesaj) expect(k.mesaj).not.toMatch(yasak);
    }
  });

  it('mesajın altında ofis adı bulunur', () => {
    const k = kademeKarari(aday(), { ...AYAR, ofisAdi: 'Moren Mali Müşavirlik' }, BUGUN);
    expect(k.mesaj).toContain('Moren Mali Müşavirlik');
  });
});

describe('tahsilat otomasyonu — günlük plan', () => {
  const cokAday = (n: number): TahsilatAdayi[] =>
    Array.from({ length: n }, (_, i) =>
      aday({ taxpayerId: `t${i}`, ad: `MÜKELLEF ${i}`, bakiye: 1000 + i * 100, gecikmeGun: 10 }),
    );

  it('günlük tavan aşılmaz, kalanlar "yarına kaldı" olarak raporlanır', () => {
    const p = gunlukPlan(cokAday(50), { ...AYAR, gunlukTavan: 20 }, BUGUN);
    expect(p.gonderilecek).toHaveLength(20);
    expect(p.yarinaKalan).toHaveLength(30);
  });

  it('tavan dolduğunda önce RİSKLİ olanlar gider', () => {
    const adaylar: TahsilatAdayi[] = [
      aday({ taxpayerId: 'kucuk', bakiye: 1000, gecikmeGun: 8 }),
      aday({ taxpayerId: 'buyuk', bakiye: 90000, gecikmeGun: 45 }),
    ];
    const p = gunlukPlan(adaylar, { ...AYAR, gunlukTavan: 1 }, BUGUN);
    expect(p.gonderilecek[0].taxpayerId).toBe('buyuk');
  });

  it('onay kuyruğu boş kalır — kademe kalktığı için onay gerekmiyor', () => {
    const p = gunlukPlan([aday({ taxpayerId: 'x', gecikmeGun: 70 })], AYAR, BUGUN);
    expect(p.onayBekleyen).toHaveLength(0);
    expect(p.gonderilecek).toHaveLength(1);
  });

  it('90+ mükellefler ayrı kulvarda toplanır', () => {
    const p = gunlukPlan([aday({ gecikmeGun: 200 })], AYAR, BUGUN);
    expect(p.elleGorusulecek).toHaveLength(1);
    expect(p.gonderilecek).toHaveLength(0);
  });

  it('otomasyon kapalıyken plan boş döner, herkes atlanan listesinde', () => {
    const p = gunlukPlan(cokAday(5), { ...AYAR, enabled: false }, BUGUN);
    expect(p.gonderilecek).toHaveLength(0);
    expect(p.atlanan).toHaveLength(5);
  });
});
