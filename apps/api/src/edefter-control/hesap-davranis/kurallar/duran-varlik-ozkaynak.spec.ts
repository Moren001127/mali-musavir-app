import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { Q2, YIL, bordroFisi, d, mizan, satir } from './test-yardimcilari';
import {
  kuralBinekOtoKdvIndirim,
  kuralGecmisYilKari,
  kuralKidemKarsiligiYok,
  kuralOrtakAdatFaiziYok,
  kuralSabitKiymetSatisiEksikBacak,
  kuralSermayeHareketi,
  kuralUzunVadeliKrediAktarim,
  kuralYapilmaktaOlanYatirim,
} from './duran-varlik-ozkaynak';

// Sabit kiymet satis fisi: 25x alacak + istege bagli bacaklar
function sabitKiymetSatisi(key: string, tarih: string, o: { hesap?: string; ad?: string; tutar?: number; amortisman?: number; kdv?: number; kar?: number; aciklama?: string }) {
  const hesap = o.hesap ?? '254.01.001';
  const ad = o.ad ?? 'TASITLAR';
  const tutar = o.tutar ?? 200_000;
  const aciklama = o.aciklama ?? 'arac satisi';
  const rows = [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: hesap, hesapAdi: ad, aciklama, alacak: tutar })];
  if (o.amortisman) rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '257.01.001', hesapAdi: 'BIRIKMIS AMORTISMANLAR', aciklama, borc: o.amortisman }));
  if (o.kdv) rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '391.01.001', hesapAdi: 'HESAPLANAN KDV', aciklama, alacak: o.kdv }));
  if (o.kar) rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '649.01.001', hesapAdi: 'DIGER OLAGAN GELIR', aciklama, alacak: o.kar }));
  const karsilik = tutar - (o.amortisman || 0) + (o.kdv || 0) + (o.kar || 0);
  rows.push(satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama, borc: karsilik }));
  return rows;
}

// Tasit alis fisi: 254 borc (+191 borc) / 320 alacak
function tasitAlisi(key: string, tarih: string, aciklama: string, tutar = 1_000_000, kdv: number | null = 200_000) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '254.01.001', hesapAdi: 'TASITLAR', aciklama, borc: tutar }),
    ...(kdv ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '191.01.001', hesapAdi: 'INDIRILECEK KDV', aciklama, borc: kdv })] : []),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '320.01.G001', hesapAdi: 'GALERI', aciklama, alacak: tutar + (kdv || 0) }),
  ];
}

describe('sabit kiymet satisinda eksik bacak', () => {
  it('257/391/649 yok → 3 eksik bacakli WARN; tam fis temiz', () => {
    const rows = sabitKiymetSatisi('s1', '2026-05-10', {});
    const s = kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('birikmiş amortisman');
    expect(s.bulgular[0].message).toContain('KDV (391)');
    expect(s.bulgular[0].message).toContain('kâr/zarar');
    expect(s.bulgular[0].hesapKodu).toBe('254.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(200_000);
    const tam = sabitKiymetSatisi('s2', '2026-05-10', { amortisman: 120_000, kdv: 20_000, kar: 20_000 });
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: tam, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('istisna aciklamasi KDV bacagini istemez; arazi (250) satisinda amortisman istenmez', () => {
    const istisna = sabitKiymetSatisi('s1', '2026-05-10', { amortisman: 120_000, kar: 5_000, aciklama: 'bina satisi KDV istisna' });
    const s = kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: istisna, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('TEMIZ');
    const arazi = sabitKiymetSatisi('s2', '2026-05-10', { hesap: '250.01.001', ad: 'ARAZI', kdv: 40_000, kar: 50_000 });
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: arazi, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('amortisman kaydi (257 alacak) ve 258→253 aktarimi satis degildir; 25x alacak hic yoksa VERI_YOK', () => {
    const amortisman = [
      satir({ voucherKey: 'a1', fisTarihi: d('2026-06-30'), hesapKodu: '770.01.001', hesapAdi: 'GENEL YONETIM', aciklama: 'amortisman', borc: 10_000 }),
      satir({ voucherKey: 'a1', fisTarihi: d('2026-06-30'), hesapKodu: '257.01.001', hesapAdi: 'BIRIKMIS AMORTISMANLAR', aciklama: 'amortisman', alacak: 10_000 }),
    ];
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: amortisman, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const aktarim = [
      satir({ voucherKey: 'y1', fisTarihi: d('2026-06-30'), hesapKodu: '253.01.001', hesapAdi: 'MAKINELER', aciklama: 'yatirim tamamlandi', borc: 500_000 }),
      satir({ voucherKey: 'y1', fisTarihi: d('2026-06-30'), hesapKodu: '258.01.001', hesapAdi: 'YAPILMAKTA OLAN YATIRIM', aciklama: 'yatirim tamamlandi', alacak: 500_000 }),
      // alt hesaplar arasi virman (253 borc + 253 alacak)
      satir({ voucherKey: 'v1', fisTarihi: d('2026-06-30'), hesapKodu: '253.01.002', hesapAdi: 'MAKINELER', aciklama: 'virman', borc: 80_000 }),
      satir({ voucherKey: 'v1', fisTarihi: d('2026-06-30'), hesapKodu: '253.01.001', hesapAdi: 'MAKINELER', aciklama: 'virman', alacak: 80_000 }),
    ];
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: aktarim, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('esik alti cikis ve kapanis fisi sayilmaz; cok fiste ust sinir 10 + ozet', () => {
    const kucuk = sabitKiymetSatisi('k1', '2026-05-10', { tutar: 500 });
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: kucuk, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const kapanis = sabitKiymetSatisi('k2', '2026-06-30', { aciklama: 'Kapanış fişi' });
    expect(kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: kapanis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const cok: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 14; i += 1) cok.push(...sabitKiymetSatisi(`c${i}`, '2026-05-10', { tutar: 10_000 * i }));
    const s = kuralSabitKiymetSatisiEksikBacak(baglamKur({ rows: cok, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.bulgular).toHaveLength(11);
    expect(s.bulgular[10].detail?.ozet).toBe(true);
  });
});

describe('tasit alisinda KDV indirimi', () => {
  it('binek anahtar kelimesi → WARN; belirsiz → INFO; ticari → temiz', () => {
    const binek = tasitAlisi('t1', '2026-04-20', 'VW Passat 1.5 TSI binek otomobil getirildi');
    const s = kuralBinekOtoKdvIndirim(baglamKur({ rows: binek, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('binek otomobil');
    expect(s.bulgular[0].detail?.tutar).toBe(200_000);
    expect(s.bulgular[0].hesapKodu).toBe('254.01.001');
    const belirsiz = tasitAlisi('t2', '2026-04-20', 'arac alimi fatura 12345');
    const s2 = kuralBinekOtoKdvIndirim(baglamKur({ rows: belirsiz, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s2.durum).toBe('BULGU');
    expect(s2.bulgular[0].severity).toBe('INFO');
    expect(s2.bulgular[0].message).toContain('anlaşılmıyor');
    const ticari = tasitAlisi('t3', '2026-04-20', 'Ford Transit kamyonet alimi');
    expect(kuralBinekOtoKdvIndirim(baglamKur({ rows: ticari, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const tir = tasitAlisi('t4', '2026-04-20', 'Mercedes Actros TIR alimi');
    expect(kuralBinekOtoKdvIndirim(baglamKur({ rows: tir, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('KDV maliyete alinmis (191 yok) → temiz; acilis fisi sayilmaz; 254 alisi hic yoksa VERI_YOK', () => {
    const maliyete = tasitAlisi('t1', '2026-04-20', 'Corolla binek', 1_200_000, null);
    expect(kuralBinekOtoKdvIndirim(baglamKur({ rows: maliyete, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const acilis = tasitAlisi('t2', '2026-04-01', 'Açılış fişi');
    expect(kuralBinekOtoKdvIndirim(baglamKur({ rows: acilis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const yok = [satir({ voucherKey: 'x', hesapKodu: '255.01.001', hesapAdi: 'DEMIRBAS', borc: 50_000 }), satir({ voucherKey: 'x', hesapKodu: '320.01.001', hesapAdi: 'SATICI', alacak: 50_000 })];
    expect(kuralBinekOtoKdvIndirim(baglamKur({ rows: yok, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});

describe('ozkaynak ve ozellikli hesaplar (Mizan)', () => {
  const rows = [satir({ voucherKey: 'x', hesapKodu: '100.01.001', hesapAdi: 'KASA', borc: 100 }), satir({ voucherKey: 'x', hesapKodu: '600.01.001', hesapAdi: 'SATIS', alacak: 100 })];

  it('258 bakiyesi → bilgi; 258 yoksa temiz; Mizan yoksa VERI_YOK', () => {
    const mz = mizan({ '258.01.001': { bakiye: 750_000, ad: 'FABRIKA INSAATI' }, '253.01.001': 300_000 });
    const s = kuralYapilmaktaOlanYatirim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('750.000,00');
    expect(s.bulgular[0].hesapKodu).toBe('258.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(750_000);
    expect(kuralYapilmaktaOlanYatirim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mizan({ '253.01.001': 300_000 }) })).durum).toBe('TEMIZ');
    expect(kuralYapilmaktaOlanYatirim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('570 alacak bakiyesi → bilgi (540 hareketi notu); 570 yoksa temiz; Mizan yoksa VERI_YOK', () => {
    const mz = mizan({ '570.01.001': { bakiye: -300_000, ad: 'GECMIS YIL KARLARI' } });
    const s = kuralGecmisYilKari(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('300.000,00');
    expect(s.bulgular[0].message).toContain('yasal yedek (540) kaydı görünmüyor');
    expect(s.bulgular[0].detail?.tutar).toBe(300_000);
    const yedekli = [
      ...rows,
      satir({ voucherKey: 'y', fisTarihi: d('2026-03-31'), hesapKodu: '570.01.001', hesapAdi: 'GECMIS YIL KARLARI', borc: 15_000 }),
      satir({ voucherKey: 'y', fisTarihi: d('2026-03-31'), hesapKodu: '540.01.001', hesapAdi: 'YASAL YEDEKLER', alacak: 15_000 }),
    ];
    const s2 = kuralGecmisYilKari(baglamKur({ rows: yedekli, range: YIL, donemTipi: 'YILLIK', mizan: mz }));
    expect(s2.bulgular[0].message).toContain('540 yasal yedek hareketi var');
    expect(kuralGecmisYilKari(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK', mizan: mizan({ '500.01.001': -1_000_000 }) })).durum).toBe('TEMIZ');
    expect(kuralGecmisYilKari(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('VERI_YOK');
  });

  it('uzun vadeli kredi: Aralikta 400→300 aktarimi yoksa bilgi; varsa temiz; yillik degilse UYGULANMAZ; Mizan yoksa VERI_YOK', () => {
    const mz = mizan({ '400.01.001': { bakiye: -1_200_000, ad: 'ZIRAAT YATIRIM KREDISI' } });
    const s = kuralUzunVadeliKrediAktarim(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('1.200.000,00');
    expect(s.bulgular[0].message).toContain('Aralık 2026');
    const aktarim = (tarih: string) => [
      satir({ voucherKey: `ak${tarih}`, fisTarihi: d(tarih), hesapKodu: '400.01.001', hesapAdi: 'ZIRAAT YATIRIM KREDISI', aciklama: 'kisa vadeye aktarim', borc: 400_000 }),
      satir({ voucherKey: `ak${tarih}`, fisTarihi: d(tarih), hesapKodu: '300.01.001', hesapAdi: 'ZIRAAT KREDI', aciklama: 'kisa vadeye aktarim', alacak: 400_000 }),
    ];
    expect(kuralUzunVadeliKrediAktarim(baglamKur({ rows: [...rows, ...aktarim('2026-12-31')], range: YIL, donemTipi: 'YILLIK', mizan: mz })).durum).toBe('TEMIZ');
    const yariYil = kuralUzunVadeliKrediAktarim(baglamKur({ rows: [...rows, ...aktarim('2026-06-30')], range: YIL, donemTipi: 'YILLIK', mizan: mz }));
    expect(yariYil.durum).toBe('BULGU');
    expect(yariYil.bulgular[0].message).toContain('Yıl içinde (Haziran 2026) aktarım');
    expect(kuralUzunVadeliKrediAktarim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz })).durum).toBe('UYGULANMAZ');
    expect(kuralUzunVadeliKrediAktarim(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('VERI_YOK');
  });
});

describe('sermaye, ortak adat, kidem karsiligi', () => {
  it('500 hareketi → bilgi (artirim); yalniz acilis/kapanis fisinde ise temiz; 500 yoksa temiz', () => {
    const artirim = [
      satir({ voucherKey: 's1', fisTarihi: d('2026-05-05'), hesapKodu: '501.01.001', hesapAdi: 'ODENMEMIS SERMAYE', aciklama: 'sermaye artirimi tescil', borc: 500_000 }),
      satir({ voucherKey: 's1', fisTarihi: d('2026-05-05'), hesapKodu: '500.01.001', hesapAdi: 'SERMAYE', aciklama: 'sermaye artirimi tescil', alacak: 500_000 }),
    ];
    const s = kuralSermayeHareketi(baglamKur({ rows: artirim, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('alacak (artırım) 500.000,00 TL');
    expect(s.bulgular[0].message).toContain('501 ödenmemiş sermaye ile birlikte');
    expect(s.bulgular[0].detail?.tutar).toBe(500_000);
    const acilis = [
      satir({ voucherKey: 'a', fisTarihi: d('2026-01-01'), hesapKodu: '100.01.001', hesapAdi: 'KASA', aciklama: 'Açılış fişi', borc: 500_000 }),
      satir({ voucherKey: 'a', fisTarihi: d('2026-01-01'), hesapKodu: '500.01.001', hesapAdi: 'SERMAYE', aciklama: 'Açılış fişi', alacak: 500_000 }),
      satir({ voucherKey: 'k', fisTarihi: d('2026-12-31'), hesapKodu: '500.01.001', hesapAdi: 'SERMAYE', aciklama: 'Kapanış fişi', borc: 500_000 }),
      satir({ voucherKey: 'k', fisTarihi: d('2026-12-31'), hesapKodu: '100.01.001', hesapAdi: 'KASA', aciklama: 'Kapanış fişi', alacak: 500_000 }),
    ];
    const s2 = kuralSermayeHareketi(baglamKur({ rows: acilis, range: YIL, donemTipi: 'YILLIK' }));
    expect(s2.durum).toBe('TEMIZ');
    expect(s2.not).toContain('açılış/kapanış');
    expect(kuralSermayeHareketi(baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('131 borc bakiyesi var, 642 adat yok → bilgi; adat kaydi varsa temiz; banka faizi adat sayilmaz', () => {
    const ortak = [
      satir({ voucherKey: 'o1', fisTarihi: d('2026-03-10'), hesapKodu: '131.01.001', hesapAdi: 'ORTAK AHMET', aciklama: 'ortaga odeme', borc: 400_000 }),
      satir({ voucherKey: 'o1', fisTarihi: d('2026-03-10'), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama: 'ortaga odeme', alacak: 400_000 }),
    ];
    const s = kuralOrtakAdatFaiziYok(baglamKur({ rows: ortak, range: YIL, donemTipi: 'YILLIK' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].hesapKodu).toBe('131.01.001');
    expect(s.bulgular[0].message).toContain('642 faiz geliri kaydı hiç yok');
    expect(s.bulgular[0].detail?.tutar).toBe(400_000);
    const adat = [
      ...ortak,
      satir({ voucherKey: 'ad', fisTarihi: d('2026-12-31'), hesapKodu: '131.01.001', hesapAdi: 'ORTAK AHMET', aciklama: 'adat faizi', borc: 60_000 }),
      satir({ voucherKey: 'ad', fisTarihi: d('2026-12-31'), hesapKodu: '642.01.001', hesapAdi: 'FAIZ GELIRLERI', aciklama: 'adat faizi', alacak: 50_000 }),
      satir({ voucherKey: 'ad', fisTarihi: d('2026-12-31'), hesapKodu: '391.01.001', hesapAdi: 'HESAPLANAN KDV', aciklama: 'adat faizi', alacak: 10_000 }),
    ];
    expect(kuralOrtakAdatFaiziYok(baglamKur({ rows: adat, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('TEMIZ');
    const bankaFaizi = [
      ...ortak,
      satir({ voucherKey: 'bf', fisTarihi: d('2026-12-31'), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama: 'mevduat faizi', borc: 5_000 }),
      satir({ voucherKey: 'bf', fisTarihi: d('2026-12-31'), hesapKodu: '642.01.001', hesapAdi: 'FAIZ GELIRLERI', aciklama: 'mevduat faizi', alacak: 5_000 }),
    ];
    const s3 = kuralOrtakAdatFaiziYok(baglamKur({ rows: bankaFaizi, range: YIL, donemTipi: 'YILLIK' }));
    expect(s3.durum).toBe('BULGU');
    expect(s3.bulgular[0].message).toContain("642'de 5.000,00 TL faiz geliri var");
  });

  it('adat: yillik degilse UYGULANMAZ; 131 hic yoksa VERI_YOK; Mizandaki hareketsiz 131 bakiyesi de yakalanir', () => {
    const rows = [satir({ voucherKey: 'x', hesapKodu: '100.01.001', hesapAdi: 'KASA', borc: 100 }), satir({ voucherKey: 'x', hesapKodu: '600.01.001', hesapAdi: 'SATIS', alacak: 100 })];
    expect(kuralOrtakAdatFaiziYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('UYGULANMAZ');
    expect(kuralOrtakAdatFaiziYok(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('VERI_YOK');
    const mz = mizan({ '131.01.001': { bakiye: 250_000, ad: 'ORTAK MEHMET' } });
    const s = kuralOrtakAdatFaiziYok(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('yıl sonu borç bakiyesi 250.000,00 TL');
  });

  it('kidem karsiligi: bordro var, 472/372 yok → bilgi; hareket ya da Mizan bakiyesi varsa temiz; bordro yoksa VERI_YOK; yillik degilse UYGULANMAZ', () => {
    const bordro = [...bordroFisi('b1', '2026-01-31'), ...bordroFisi('b2', '2026-02-28')];
    const s = kuralKidemKarsiligiYok(baglamKur({ rows: bordro, range: YIL, donemTipi: 'YILLIK' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('kıdem tazminatı karşılığı');
    expect(s.bulgular[0].detail?.tutar).toBe(140_000);
    const karsilikli = [
      ...bordro,
      satir({ voucherKey: 'kk', fisTarihi: d('2026-12-31'), hesapKodu: '770.01.005', hesapAdi: 'KIDEM TAZMINATI GIDERI', borc: 90_000 }),
      satir({ voucherKey: 'kk', fisTarihi: d('2026-12-31'), hesapKodu: '472.01.001', hesapAdi: 'KIDEM TAZMINATI KARSILIGI', alacak: 90_000 }),
    ];
    expect(kuralKidemKarsiligiYok(baglamKur({ rows: karsilikli, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('TEMIZ');
    expect(kuralKidemKarsiligiYok(baglamKur({ rows: bordro, range: YIL, donemTipi: 'YILLIK', mizan: mizan({ '472.01.001': -120_000 }) })).durum).toBe('TEMIZ');
    const bordrosuz = [satir({ voucherKey: 'x', hesapKodu: '100.01.001', hesapAdi: 'KASA', borc: 100 }), satir({ voucherKey: 'x', hesapKodu: '600.01.001', hesapAdi: 'SATIS', alacak: 100 })];
    expect(kuralKidemKarsiligiYok(baglamKur({ rows: bordrosuz, range: YIL, donemTipi: 'YILLIK' })).durum).toBe('VERI_YOK');
    expect(kuralKidemKarsiligiYok(baglamKur({ rows: bordro, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('UYGULANMAZ');
  });
});
