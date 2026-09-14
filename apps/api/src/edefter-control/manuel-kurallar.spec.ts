import type { HesapKarti, MizanBaglami } from './hesap-davranis/tipler';
import {
  MANUEL_ONEK, hesapOnekleri, kodEslesir, manuelKuralCumlesi, manuelKuralDogrula, manuelKuralTanimi, manuelKurallariCalistir,
  type ManuelKural,
} from './manuel-kurallar';

// ── yardimcilar ─────────────────────────────────────────────────────────────
function kural(p: Partial<ManuelKural>): ManuelKural {
  return { id: 'k1', ad: 'Test kurali', seviye: 'WARN', hesap: '500', kaynak: 'MIZAN', kosul: 'BAKIYE_YOK', esik: null, herHesapAyri: false, donemKisiti: 'HEPSI', aktif: true, ...p };
}
function kart(p: Partial<HesapKarti>): HesapKarti {
  return { kod: '120.01.001', ad: 'MUSTERI', ana: '120', borc: 0, alacak: 0, borcAdet: 0, alacakAdet: 0, acilis: null, kapanis: null, mizanKapanis: null, hareketsiz: false, ...p };
}
// bakiye: borc pozitif, alacak negatif (servisteki MizanCtx ile ayni)
function mizan(satirlar: Array<[string, number, string?]>): MizanBaglami {
  const bakiyeByCode = new Map<string, number>();
  const toplamByCode = new Map<string, { borc: number; alacak: number; ad: string }>();
  for (const [kod, bakiye, ad] of satirlar) {
    bakiyeByCode.set(kod, bakiye);
    toplamByCode.set(kod, { borc: bakiye > 0 ? bakiye : 0, alacak: bakiye < 0 ? -bakiye : 0, ad: ad || '' });
  }
  return { found: true, bakiyeByCode, toplamByCode };
}
const calistir = (k: ManuelKural, g: { mizan?: MizanBaglami | null; kartlar?: HesapKarti[]; donemTipi?: string }) =>
  manuelKurallariCalistir([k], { hesapKartlari: g.kartlar || [], mizan: g.mizan ?? null, donemTipi: g.donemTipi || 'GECICI_Q2' });

// ── onek eslesmesi ──────────────────────────────────────────────────────────
describe('hesapOnekleri / kodEslesir', () => {
  it('virgul/bosluk ayirir, buyuk harfe cevirir', () => {
    expect(hesapOnekleri('500, 320.01 120;  ')).toEqual(['500', '320.01', '120']);
    expect(hesapOnekleri('320.01.ç003')).toEqual(['320.01.Ç003']);
  });
  it('ana hesap oneki alt kirilimlari kapsar, farkli ana hesabi kapsamaz', () => {
    expect(kodEslesir('500', '500')).toBe(true);
    expect(kodEslesir('500.01.001', '500')).toBe(true);
    expect(kodEslesir('501', '500')).toBe(false);
    expect(kodEslesir('320.01.001', '320.01')).toBe(true);
    expect(kodEslesir('320.02.001', '320.01')).toBe(false);
    expect(kodEslesir('320.011', '320.01')).toBe(false);
  });
});

// ── dogrulama ───────────────────────────────────────────────────────────────
describe('manuelKuralDogrula', () => {
  it('gecerli kural hata vermez', () => {
    expect(manuelKuralDogrula(kural({}))).toEqual([]);
  });
  it('eksik ad / hesap / kosul-kaynak uyusmazligi / esik yakalar', () => {
    expect(manuelKuralDogrula(kural({ ad: '' }))).toContain('Kural adı boş olamaz');
    expect(manuelKuralDogrula(kural({ hesap: '' })).some((h) => h.includes('Hesap kodu boş'))).toBe(true);
    expect(manuelKuralDogrula(kural({ hesap: 'abc' })).some((h) => h.includes('geçersiz'))).toBe(true);
    expect(manuelKuralDogrula(kural({ kaynak: 'HAREKET', kosul: 'BAKIYE_YOK' }))).toContain('Koşul seçilen kaynağa uymuyor');
    expect(manuelKuralDogrula(kural({ kosul: 'BAKIYE_USTUNDE', esik: null })).some((h) => h.includes('eşik'))).toBe(true);
    expect(manuelKuralDogrula(kural({ kosul: 'BAKIYE_USTUNDE', esik: 1000 }))).toEqual([]);
  });
});

// ── cumle + katalog ─────────────────────────────────────────────────────────
describe('manuelKuralCumlesi / manuelKuralTanimi', () => {
  it('okunur cumle uretir', () => {
    expect(manuelKuralCumlesi(kural({}))).toBe('500 hesabında mizan bakiyesi yoksa');
    expect(manuelKuralCumlesi(kural({ kosul: 'BAKIYE_ALTINDA', esik: 250000, herHesapAyri: true, donemKisiti: 'YILLIK' })))
      .toBe('500 hesabında mizan bakiyesi eşiğin altındaysa (eşik 250.000,00 TL) — her alt hesap ayrı — yalnız yıllık');
    expect(manuelKuralCumlesi(kural({ hesap: '120, 320', kaynak: 'HAREKET', kosul: 'ADET_ALTINDA', esik: 3 })))
      .toBe('120, 320 hesaplarında dönem hareket adedi eşiğin altındaysa (eşik 3 hareket)');
  });
  it('katalog girdisi: kod MANUEL:<id>, alan Manuel Kurallar, mizanGerekli kaynaga gore', () => {
    const t = manuelKuralTanimi(kural({ id: 'abc', aciklama: 'sermaye taahhudu' }));
    expect(t.kod).toBe(`${MANUEL_ONEK}abc`);
    expect(t.alan).toBe('Manuel Kurallar');
    expect(t.mizanGerekli).toBe(true);
    expect(t.motor).toBe('MANUEL');
    expect(t.aciklama).toBe('500 hesabında mizan bakiyesi yoksa. sermaye taahhudu');
    expect(manuelKuralTanimi(kural({ kaynak: 'HAREKET', kosul: 'HAREKET_YOK' })).mizanGerekli).toBe(false);
  });
});

// ── MIZAN kosullari ─────────────────────────────────────────────────────────
describe('MIZAN kosullari', () => {
  it('BAKIYE_YOK: hesap mizanda yoksa bulgu, varsa temiz', () => {
    const yok = calistir(kural({}), { mizan: mizan([['100', 5000, 'KASA']]) });
    expect(yok.bulgular).toHaveLength(1);
    expect(yok.bulgular[0].category).toBe('MANUEL:k1');
    expect(yok.bulgular[0].hesapKodu).toBe('500');
    expect(yok.bulgular[0].message).toContain('mizanda hesap yok');
    expect(yok.kapsam[0]).toMatchObject({ kod: 'MANUEL:k1', durum: 'BULGU', bulgu: 1 });
    const var_ = calistir(kural({}), { mizan: mizan([['500', -250000, 'SERMAYE']]) });
    expect(var_.bulgular).toHaveLength(0);
    expect(var_.kapsam[0].durum).toBe('TEMIZ');
  });
  it('BAKIYE_YOK: hesap mizanda var ama sifir → bulgu', () => {
    const r = calistir(kural({}), { mizan: mizan([['500', 0, 'SERMAYE']]) });
    expect(r.bulgular[0].message).toContain('500 SERMAYE: mizan bakiyesi yok (sıfır)');
  });
  it('BORC/ALACAK_BAKIYE yonu ayirir', () => {
    const m = mizan([['500', -250000, 'SERMAYE'], ['100', 12000, 'KASA']]);
    expect(calistir(kural({ kosul: 'ALACAK_BAKIYE' }), { mizan: m }).bulgular).toHaveLength(1);
    expect(calistir(kural({ kosul: 'BORC_BAKIYE' }), { mizan: m }).bulgular).toHaveLength(0);
    expect(calistir(kural({ hesap: '100', kosul: 'BORC_BAKIYE' }), { mizan: m }).bulgular[0].message).toContain('borç bakiyesi veriyor: 12.000,00 TL');
  });
  it('BAKIYE_ALTINDA / USTUNDE esikle (mutlak deger)', () => {
    const m = mizan([['500', -250000, 'SERMAYE']]);
    expect(calistir(kural({ kosul: 'BAKIYE_ALTINDA', esik: 300000 }), { mizan: m }).bulgular[0].message).toContain('eşik 300.000,00 TL altında');
    expect(calistir(kural({ kosul: 'BAKIYE_ALTINDA', esik: 200000 }), { mizan: m }).bulgular).toHaveLength(0);
    expect(calistir(kural({ kosul: 'BAKIYE_USTUNDE', esik: 200000 }), { mizan: m }).bulgular[0].detail).toMatchObject({ tutar: 250000, esik: 200000 });
  });
  it('toplam modu: ana hesap satiri yoksa yapraklar toplanir (cift sayim yok)', () => {
    const m = mizan([['320.01', -1500, 'SATICILAR'], ['320.01.001', -1000, 'A'], ['320.01.002', -500, 'B']]);
    const r = calistir(kural({ hesap: '320', kosul: 'ALACAK_BAKIYE' }), { mizan: m });
    expect(r.bulgular).toHaveLength(1);
    expect(r.bulgular[0].detail?.tutar).toBe(1500);
  });
  it('her alt hesap ayri: yaprak basina bulgu', () => {
    const m = mizan([['320.01', -1500, 'SATICILAR'], ['320.01.001', -1000, 'A'], ['320.01.002', -500, 'B']]);
    const r = calistir(kural({ hesap: '320', kosul: 'BAKIYE_USTUNDE', esik: 700, herHesapAyri: true }), { mizan: m });
    expect(r.bulgular.map((b) => b.hesapKodu)).toEqual(['320.01.001']);
  });
  it('mizan yoksa VERI_YOK, bulgu uretmez', () => {
    const r = calistir(kural({}), { mizan: null });
    expect(r.bulgular).toHaveLength(0);
    expect(r.kapsam[0]).toMatchObject({ durum: 'VERI_YOK', not: 'Mizan yok' });
  });
});

// ── HAREKET kosullari ───────────────────────────────────────────────────────
describe('HAREKET kosullari', () => {
  const kartlar = [
    kart({ kod: '120.01.001', ad: 'A', borc: 1000, borcAdet: 2 }),
    kart({ kod: '120.01.002', ad: 'B', borc: 0, borcAdet: 0, hareketsiz: true, mizanKapanis: 500 }),
    kart({ kod: '320.01.001', ad: 'C', alacak: 4000, alacakAdet: 4 }),
  ];
  it('HAREKET_YOK toplam: onekte hareket varsa temiz, hic hesap yoksa bulgu', () => {
    expect(calistir(kural({ hesap: '120', kaynak: 'HAREKET', kosul: 'HAREKET_YOK' }), { kartlar }).bulgular).toHaveLength(0);
    const r = calistir(kural({ hesap: '500', kaynak: 'HAREKET', kosul: 'HAREKET_YOK' }), { kartlar });
    expect(r.bulgular).toHaveLength(1);
    expect(r.bulgular[0].message).toContain('hesap defterde ve mizanda görünmüyor');
  });
  it('HAREKET_YOK her hesap ayri: yalniz hareketsiz alt hesap', () => {
    const r = calistir(kural({ hesap: '120', kaynak: 'HAREKET', kosul: 'HAREKET_YOK', herHesapAyri: true }), { kartlar });
    expect(r.bulgular.map((b) => b.hesapKodu)).toEqual(['120.01.002']);
    expect(r.bulgular[0].message).toContain('120.01.002 B: dönemde hareket yok');
  });
  it('BORC/ALACAK_USTUNDE ve ADET_ALTINDA', () => {
    expect(calistir(kural({ hesap: '320', kaynak: 'HAREKET', kosul: 'ALACAK_USTUNDE', esik: 3000 }), { kartlar }).bulgular[0].message).toContain('dönem alacak toplamı 4.000,00 TL, eşik 3.000,00 TL üstünde');
    expect(calistir(kural({ hesap: '120', kaynak: 'HAREKET', kosul: 'BORC_USTUNDE', esik: 3000 }), { kartlar }).bulgular).toHaveLength(0);
    expect(calistir(kural({ hesap: '120', kaynak: 'HAREKET', kosul: 'ADET_ALTINDA', esik: 3 }), { kartlar }).bulgular[0].message).toContain('dönemde 2 hareket var, eşik 3 altında');
  });
  it('HAREKET kaynagi mizan olmadan da calisir', () => {
    const r = calistir(kural({ hesap: '120', kaynak: 'HAREKET', kosul: 'HAREKET_VAR' }), { kartlar, mizan: null });
    expect(r.kapsam[0].durum).toBe('BULGU');
    expect(r.bulgular[0].detail).toMatchObject({ adet: 2, borc: 1000 });
  });
});

// ── kapsam: pasif / donem kisiti / birden fazla kural ───────────────────────
describe('kapsam ve kisitlar', () => {
  it('pasif kural calismaz', () => {
    const r = calistir(kural({ aktif: false }), { mizan: mizan([]) });
    expect(r.bulgular).toHaveLength(0);
    expect(r.kapsam[0].durum).toBe('PASIF');
  });
  it('donem kisiti: yalniz yillik / yalniz gecici', () => {
    expect(calistir(kural({ donemKisiti: 'YILLIK' }), { mizan: mizan([]), donemTipi: 'GECICI_Q2' }).kapsam[0].durum).toBe('UYGULANMAZ');
    expect(calistir(kural({ donemKisiti: 'YILLIK' }), { mizan: mizan([]), donemTipi: 'YILLIK' }).kapsam[0].durum).toBe('BULGU');
    expect(calistir(kural({ donemKisiti: 'GECICI' }), { mizan: mizan([]), donemTipi: 'AYLIK' }).kapsam[0].durum).toBe('UYGULANMAZ');
  });
  it('birden fazla kural ve onek: her kural bir kapsam satiri, onek basina bulgu', () => {
    const r = manuelKurallariCalistir(
      [kural({ id: 'a', hesap: '500, 501' }), kural({ id: 'b', hesap: '100', kosul: 'BAKIYE_VAR' })],
      { hesapKartlari: [], mizan: mizan([['100', 5000, 'KASA']]), donemTipi: 'YILLIK' },
    );
    expect(r.kapsam.map((k) => `${k.kod}:${k.durum}:${k.bulgu}`)).toEqual(['MANUEL:a:BULGU:2', 'MANUEL:b:BULGU:1']);
    expect(r.bulgular.map((b) => b.hesapKodu)).toEqual(['500', '501', '100']);
    expect(r.bulgular[2].message).toBe('100 KASA: mizan bakiyesi var: 5.000,00 TL borç. Ofis kuralı: Test kurali.');
  });
});
