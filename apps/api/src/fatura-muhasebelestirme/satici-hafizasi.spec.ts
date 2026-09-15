/**
 * satici-hafizasi.ts — SATICI HAFIZASI (2026-09-15): aynı satıcının önceki faturalarından AI'ya sormadan sınıflandırma.
 * Muzaffer Bey'in üç şartı: (1) en az 2 aynı sınıflandırma, (2) kalem/içerik benzer, (3) tutar olağan aralıkta;
 * demirbaş/taşıt şüphesinde hafıza devre dışı.
 */
import {
  saticiHafizasiKarari, hafizaKelimeleri, hafizaKatla, jaccard, demirbasSuphesi, saticiHafizasiModu, HafizaOrnegi,
} from './satici-hafizasi';

const ornek = (p: Partial<HafizaOrnegi> & { kalemAdlari?: string[] }): HafizaOrnegi => ({
  hesapKodu: '770.01.005',
  matrahKategori: 'genel_gider',
  giderTuru: 'telefon',
  kalemAdlari: ['Mobil hat ücreti', 'Tarife bedeli'],
  tutar: 1300,
  tarih: '2026-08-01',
  onayli: false,
  ...p,
});

describe('satici-hafizasi — normalize / benzerlik', () => {
  it('Türkçe küçük harf + aksan katlama + rakam/noktalama temizliği + 3+ harf + dolgu dışı', () => {
    expect(hafizaKatla('ARAÇ ŞASİ Iİı ÖĞÜ')).toBe('arac sasi iii ogu');
    const k = hafizaKelimeleri(['Mobil Hat Ücreti (05xx) - 12 adet', 'KDV dahil hizmet bedeli']);
    expect([...k].sort()).toEqual(['hat', 'mobil']); // "ücreti/adet/kdv/dahil/hizmet/bedeli" dolgu; "xx" kısa; rakamlar atıldı
  });
  it('jaccard: kesişim/birleşim; boş küme 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(['x']))).toBe(0);
  });
  it('demirbaş şüphesi: yeni kalemde taşıt/plaka var, örneklerde yok → şüphe; örneklerde de varsa yok', () => {
    expect(demirbasSuphesi(new Set(['ford', 'transit', 'plakali', 'sasi']), new Set(['cimento', 'demir']))).toMatch(/^(sasi|plaka)$/);
    expect(demirbasSuphesi(new Set(['ford', 'transit', 'plakali']), new Set(['cimento', 'demir']))).toBe('plaka'); // önek eşleşmesi (plaka→plakali)
    expect(demirbasSuphesi(new Set(['forklift', 'kiralama']), new Set(['forklift', 'kiralama']))).toBeNull();
    // "aracilik" (aracılık hizmeti) "arac" sayılmaz — kısa anahtarlar birebir eşleşir.
    expect(demirbasSuphesi(new Set(['aracilik', 'komisyonu']), new Set(['komisyon']))).toBeNull();
  });
});

describe('satici-hafizasi — karar', () => {
  it('Turkcell: 3 benzer fatura aynı hesap, tutar aralıkta → UYGULANIR (güven yüksek)', () => {
    const ornekler = [
      ornek({ tutar: 1250, tarih: '2026-06-01', onayli: true }),
      ornek({ tutar: 1310, tarih: '2026-07-01' }),
      ornek({ tutar: 1290, tarih: '2026-08-01', giderTuru: 'haberleşme' }), // gider türü metni değişse de aynı hesap = aynı sınıf
    ];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti Eylül', 'Tarife bedeli'], tutar: 1345 }, ornekler);
    expect(k.uygula).toBe(true);
    expect(k.hesapKodu).toBe('770.01.005');
    expect(k.matrahKategori).toBe('genel_gider');
    expect(k.giderTuru).toBe('telefon'); // gruptaki en sık gider türü
    expect(k.ornekSayisi).toBe(3);
    expect(k.benzerlik).toBeGreaterThanOrEqual(0.5);
    expect(k.guven).toBe('yuksek');
    expect(k.enSik?.sayi).toBe(3);
    expect(k.enSik?.onayliSayi).toBe(1);
    expect(k.ipucu).toContain('770.01.005');
  });

  it('Taşıt: hep mal alınan cariden bu kez araç (plaka/şasi) + büyük tutar → UYGULANMAZ (demirbaş/taşıt şüphesi)', () => {
    const ornekler = [
      ornek({ hesapKodu: '153.01.001', matrahKategori: 'ticari_mal', giderTuru: 'inşaat malzemesi', kalemAdlari: ['Çimento 50kg', 'İnşaat demiri 12mm'], tutar: 42000 }),
      ornek({ hesapKodu: '153.01.001', matrahKategori: 'ticari_mal', giderTuru: 'inşaat malzemesi', kalemAdlari: ['Çimento 50kg', 'Kum'], tutar: 38000 }),
      ornek({ hesapKodu: '153.01.001', matrahKategori: 'ticari_mal', giderTuru: 'inşaat malzemesi', kalemAdlari: ['İnşaat demiri', 'Tuğla'], tutar: 45000 }),
    ];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Ford Transit kamyonet', 'Şasi no: NM0…', 'Plaka: 34 ABC 123'], tutar: 850000 }, ornekler);
    expect(k.uygula).toBe(false);
    expect(k.neden).toMatch(/demirbaş\/taşıt şüphesi/);
    expect(k.hesapKodu).toBeUndefined();
    // AI ipucu yine de dolu: önceki faturalarda genelde 153.01.001
    expect(k.ipucu).toContain('153.01.001');
    expect(k.enSik?.hesapKodu).toBe('153.01.001');
  });

  it('Farklı içerik (benzerlik düşük) → UYGULANMAZ, ipucu döner', () => {
    const ornekler = [ornek({ tutar: 1200 }), ornek({ tutar: 1300 })];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Fiber internet kurulum', 'Modem cihazı'], tutar: 1250 }, ornekler);
    expect(k.uygula).toBe(false);
    expect(k.neden).toMatch(/kalem benzerliği düşük/);
    expect(k.ipucu).toMatch(/SATICI HAFIZASI İPUCU/);
  });

  it('Tutar sapması: aynı içerik ama tutar aralığın çok dışında → UYGULANMAZ', () => {
    const ornekler = [ornek({ tutar: 1200 }), ornek({ tutar: 1400 }), ornek({ tutar: 1300 })];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti', 'Tarife bedeli'], tutar: 65000 }, ornekler);
    expect(k.uygula).toBe(false);
    expect(k.neden).toMatch(/tutar olağan aralık dışında/);
    // Aralık [min/2.5, max*2.5] = [480, 3500] — 3400 içeride, 400 dışarıda
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 3400 }, ornekler).uygula).toBe(true);
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 400 }, ornekler).uygula).toBe(false);
  });

  it('Tek örnek ±%150 aralığı: 1 örnek yetmez (en az 2); 2 örnek yeter', () => {
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, [ornek({})]).uygula).toBe(false);
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, [ornek({})]).neden).toMatch(/aynı sınıflandırma 1 kez/);
    const iki = [ornek({ tutar: 1000 }), ornek({ tutar: 1000 })];
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 2500 }, iki).uygula).toBe(true);  // 1000×2.5
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 2501 }, iki).uygula).toBe(false);
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 399 }, iki).uygula).toBe(false); // 1000/2.5=400
  });

  it('Çoğunluk %70 altı (sınıflar bölünmüş) → UYGULANMAZ', () => {
    const ornekler = [
      ornek({ hesapKodu: '770.01.005' }), ornek({ hesapKodu: '770.01.005' }),
      ornek({ hesapKodu: '770.01.009' }), ornek({ hesapKodu: '770.01.009' }),
    ];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, ornekler);
    expect(k.uygula).toBe(false);
    expect(k.neden).toMatch(/en sık sınıf örneklerin %50/);
  });

  it('Kalemsiz XML (iki tarafta da kalem yok): en az 3 örnek + tutar şartı; 2 örnek yetmez', () => {
    const kalemsiz = (tutar: number) => ornek({ kalemAdlari: [], tutar, hesapKodu: '770.01.020', giderTuru: 'akaryakıt' });
    const k3 = saticiHafizasiKarari({ kalemAdlari: [], tutar: 2100 }, [kalemsiz(2000), kalemsiz(2200), kalemsiz(1900)]);
    expect(k3.uygula).toBe(true);
    expect(k3.hesapKodu).toBe('770.01.020');
    expect(k3.guven).toBe('orta'); // kalemsiz kural asla 'yuksek' vermez
    expect(k3.neden).toMatch(/iki tarafta da kalem yok/);
    const k2 = saticiHafizasiKarari({ kalemAdlari: [], tutar: 2100 }, [kalemsiz(2000), kalemsiz(2200)]);
    expect(k2.uygula).toBe(false);
    expect(k2.neden).toMatch(/en az 3 gerekli; kalemsiz belge/);
  });

  it('Tek tarafta kalem var → karşılaştırılamaz, UYGULANMAZ', () => {
    const k1 = saticiHafizasiKarari({ kalemAdlari: [], tutar: 1300 }, [ornek({}), ornek({}), ornek({})]);
    expect(k1.uygula).toBe(false);
    expect(k1.neden).toMatch(/yeni belgede kalem\/içerik yok/);
    const k2 = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat'], tutar: 1300 }, [ornek({ kalemAdlari: [] }), ornek({ kalemAdlari: [] }), ornek({ kalemAdlari: [] })]);
    expect(k2.uygula).toBe(false);
    expect(k2.neden).toMatch(/önceki faturalarda kalem yok/);
  });

  it('Kalem yokken açıklama içerik sayılır', () => {
    const ornekler = [ornek({}), ornek({})];
    const k = saticiHafizasiKarari({ kalemAdlari: [], tutar: 1300, aciklama: 'mobil hat tarife' }, ornekler);
    expect(k.uygula).toBe(true);
  });

  it('Hesap kodu yok (işletme): gider türü + kategori çiftine göre gruplanır', () => {
    const isl = (gt: string) => ornek({ hesapKodu: null, giderTuru: gt, matrahKategori: 'genel_gider' });
    const k = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, [isl('telefon'), isl('Telefon'), isl('internet')]);
    expect(k.uygula).toBe(false); // 2/3 = %67 < %70
    const k2 = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, [isl('telefon'), isl('Telefon')]);
    expect(k2.uygula).toBe(true);
    expect(k2.hesapKodu).toBeNull();
    expect(k2.giderTuru).toBe('telefon');
  });

  it('Sınıfı boş örnekler sayılmaz; hiç örnek yoksa ipucu da yok', () => {
    const bos = ornek({ hesapKodu: null, giderTuru: null, matrahKategori: null });
    const k = saticiHafizasiKarari({ kalemAdlari: ['x'], tutar: 10 }, [bos, bos]);
    expect(k.uygula).toBe(false);
    expect(k.ornekSayisi).toBe(0);
    expect(k.ipucu).toBeUndefined();
  });

  it('Yeni belgenin tutarı bilinmiyorsa UYGULANMAZ', () => {
    const k = saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 0 }, [ornek({}), ornek({})]);
    expect(k.uygula).toBe(false);
    expect(k.neden).toMatch(/tutarı bilinmiyor/);
  });

  it('enAzOnayli ayarı: onaylı örnek şartı', () => {
    const ornekler = [ornek({ onayli: false }), ornek({ onayli: false })];
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, ornekler, { enAzOnayli: 1 }).uygula).toBe(false);
    expect(saticiHafizasiKarari({ kalemAdlari: ['Mobil hat ücreti'], tutar: 1300 }, [ornek({ onayli: true }), ornek({})], { enAzOnayli: 1 }).uygula).toBe(true);
  });

  it('Aynı sınıfta örnek ama birebir tekrar (birleşim büyümüş) → en yakın örnek benzerliği kurtarır', () => {
    // 6 aylık geçmişte kalem adları çeşitli; yeni fatura ocak ayınınkiyle birebir aynı.
    const ornekler = [
      ornek({ kalemAdlari: ['Fiber internet aboneliği', 'Statik IP hizmeti'] }),
      ornek({ kalemAdlari: ['Fiber internet aboneliği', 'Modem kira'] }),
      ornek({ kalemAdlari: ['Sabit telefon görüşme', 'Fiber internet aboneliği', 'Yurtdışı arama'] }),
      ornek({ kalemAdlari: ['Fiber internet aboneliği', 'Ek paket', 'Kurulum bedeli'] }),
    ];
    const k = saticiHafizasiKarari({ kalemAdlari: ['Fiber internet aboneliği', 'Statik IP hizmeti'], tutar: 1300 }, ornekler);
    expect(k.uygula).toBe(true);
    expect(k.benzerlik).toBe(1);
  });
});

describe('satici-hafizasi — mod', () => {
  it('FM_SATICI_HAFIZASI: boş → açık; off/0/false/kapali → kapalı; ipucu/golge → ipucu', () => {
    expect(saticiHafizasiModu({} as any)).toBe('acik');
    expect(saticiHafizasiModu({ FM_SATICI_HAFIZASI: 'on' } as any)).toBe('acik');
    expect(saticiHafizasiModu({ FM_SATICI_HAFIZASI: 'off' } as any)).toBe('kapali');
    expect(saticiHafizasiModu({ FM_SATICI_HAFIZASI: 'kapali' } as any)).toBe('kapali');
    expect(saticiHafizasiModu({ FM_SATICI_HAFIZASI: 'ipucu' } as any)).toBe('ipucu');
    expect(saticiHafizasiModu({ FM_SATICI_HAFIZASI: 'golge' } as any)).toBe('ipucu');
  });
});
