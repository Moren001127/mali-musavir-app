import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { HDD_KOD_SETI, hddKural } from '../katalog';
import { Q2, YIL, alisFaturasi, d, giderFaturasi, mizan, satir, satisFaturasi } from './test-yardimcilari';
import {
  STOK_GIDER_KURALLARI,
  hesapAdindakiKdvOrani,
  kkegDeseni,
  kuralAylikHareketKesintisi,
  kuralBrutSatisZarari,
  kuralDemirbasDogrudanGider,
  kuralGelecekAy180Aktarim,
  kuralKkegNitelikliGider,
  kuralKrediFaizGideriYok,
  kuralSabitGiderAyAtlamis,
  kuralSmm621Yok,
  kuralStokCiroOrani,
  kuralStokKdvOraniUyumsuz,
} from './stok-gider-maliyet';

const AY = { start: d('2026-04-01'), end: d('2026-04-30') };
const IKI_AY = { start: d('2026-04-01'), end: d('2026-05-31') };

// ---- yerel ureticiler (ortak dosya degistirilmez)
// SMM kaydi: 621 borc / 153 alacak
function smmKaydi(key: string, tarih: string, tutar: number) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '621.01.001', hesapAdi: 'SATILAN TICARI MALLAR MALIYETI', aciklama: 'SMM', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '153.01.001', hesapAdi: 'TICARI MALLAR', aciklama: 'SMM', alacak: tutar }),
  ];
}
// Adli stok alisi: stok + 191 borc / 320 alacak (KDV tutari elle verilir)
function stokAlis(key: string, tarih: string, stokKod: string, stokAd: string, matrah: number, kdv: number, cari = '320.01.S001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: stokKod, hesapAdi: stokAd, aciklama: 'mal alisi', borc: matrah }),
    ...(kdv > 0 ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '191.01.001', hesapAdi: 'INDIRILECEK KDV', aciklama: 'mal alisi', borc: kdv })] : []),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: cari, hesapAdi: 'SATICI', aciklama: 'mal alisi', alacak: matrah + kdv }),
  ];
}
// Kasadan odenen gider (aciklamali): 7xx borc / 100 alacak
function nakitGider(key: string, tarih: string, hesapKod: string, hesapAd: string, aciklama: string, tutar: number) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: hesapKod, hesapAdi: hesapAd, aciklama, borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '100.01.001', hesapAdi: 'KASA', aciklama, alacak: tutar }),
  ];
}
// Kredi kullanimi: 102 borc / 300 alacak
function krediKullanim(key: string, tarih: string, tutar: number, hesap = '300.01.001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama: 'kredi kullanimi', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: hesap, hesapAdi: 'X BANKASI KREDI', aciklama: 'kredi kullanimi', alacak: tutar }),
  ];
}
// Kredi taksiti: 300 borc + faiz hesabi borc / 102 alacak
function krediTaksit(key: string, tarih: string, anapara: number, faiz: number, faizHesap = '780.01.001', faizAd = 'FINANSMAN GIDERLERI', aciklama = 'kredi taksiti') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '300.01.001', hesapAdi: 'X BANKASI KREDI', aciklama, borc: anapara }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: faizHesap, hesapAdi: faizAd, aciklama, borc: faiz }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama, alacak: anapara + faiz }),
  ];
}
// Pesin odenen gider: 180 borc / 102 alacak
function pesinGider(key: string, tarih: string, tutar: number) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '180.01.001', hesapAdi: 'GELECEK AYLARA AIT GIDERLER', aciklama: 'yillik kira pesin', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama: 'yillik kira pesin', alacak: tutar }),
  ];
}
// 180 aktarimi: 770 borc / 180 alacak
function aktarim180(key: string, tarih: string, tutar: number) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '770.01.001', hesapAdi: 'KIRA GIDERLERI', aciklama: 'aylik kira payi', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '180.01.001', hesapAdi: 'GELECEK AYLARA AIT GIDERLER', aciklama: 'aylik kira payi', alacak: tutar }),
  ];
}

describe('SMM_621_YOK', () => {
  const temel = [
    ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND AMBALAJ', 100_000),
    ...satisFaturasi('f2', '2026-05-05', '120.01.B001', 'BETA LTD', 50_000),
    ...alisFaturasi('a1', '2026-04-10', '320.01.S001', 'SERVET COMAK', 80_000),
  ];

  it('satis + stok alisi var, 621 yok → gecici donemde INFO; yillikta WARN', () => {
    const s = kuralSmm621Yok(baglamKur({ rows: temel, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('SMM_621_YOK');
    expect(s.bulgular[0].message).toContain('satış 150.000,00 TL');
    expect(s.bulgular[0].message).toContain('stok alışı 80.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('153.01.001');
    expect(s.bulgular[0].detail?.tutar).toBeCloseTo(150_000, 2);
    expect(s.bulgular[0].detail?.stokAlis).toBeCloseTo(80_000, 2);
    const y = kuralSmm621Yok(baglamKur({ rows: temel, range: YIL, donemTipi: 'YILLIK' }));
    expect(y.durum).toBe('BULGU');
    expect(y.bulgular[0].severity).toBe('WARN');
    expect(y.bulgular[0].message).toContain('Yıllık defterde SMM kaydı zorunlu');
  });

  it('621 kaydi varsa temiz; 62x yok ama stoktan cikis varsa temiz', () => {
    const s = kuralSmm621Yok(baglamKur({ rows: [...temel, ...smmKaydi('smm', '2026-06-30', 60_000)], range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('SMM kaydı var');
    // 153 alacak / 710 borc (uretime sevk): 62x yok ama stok cikisi var
    const uretim = [
      satir({ voucherKey: 'u1', fisTarihi: d('2026-05-20'), hesapKodu: '710.01.001', hesapAdi: 'DIREKT ILK MADDE', borc: 30_000 }),
      satir({ voucherKey: 'u1', fisTarihi: d('2026-05-20'), hesapKodu: '153.01.001', hesapAdi: 'TICARI MALLAR', alacak: 30_000 }),
    ];
    expect(kuralSmm621Yok(baglamKur({ rows: [...temel, ...uretim], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('aylik donem → UYGULANMAZ; satis yok → VERI_YOK; stok hesabi yok (hizmet) → VERI_YOK', () => {
    expect(kuralSmm621Yok(baglamKur({ rows: temel, range: AY, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    const satissiz = alisFaturasi('a1', '2026-04-10', '320.01.S001', 'SERVET', 80_000);
    expect(kuralSmm621Yok(baglamKur({ rows: satissiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const hizmet = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000),
      ...giderFaturasi('g1', '2026-04-08', '770.01.001', 'GENEL GIDERLER', 5_000, 'danismanlik'),
    ];
    const h = kuralSmm621Yok(baglamKur({ rows: hizmet, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(h.durum).toBe('VERI_YOK');
    expect(h.not).toContain('hizmet');
  });

  it('donemde 15x hareketi yok ama Mizanda stok bakiyesi var → yine bulgu (Mizan notu ile)', () => {
    const rows = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    const mz = mizan({ '153.01.001': { bakiye: 250_000, ad: 'TICARI MALLAR' } });
    const s = kuralSmm621Yok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('dönemde stok alışı yok');
    expect(s.bulgular[0].message).toContain('Mizan stok bakiyesi 250.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('153.01.001');
  });
});

describe('STOK_KDV_ORANI_ALT_HESAP_UYUMSUZ', () => {
  it('hesap adindaki oran ayristirilir', () => {
    expect(hesapAdindakiKdvOrani('TİCARİ MALLAR %20')).toBe(20);
    expect(hesapAdindakiKdvOrani('%1 KDVLİ MALLAR')).toBe(1);
    expect(hesapAdindakiKdvOrani('TİC. MALLAR (KDV % 10)')).toBe(10);
    expect(hesapAdindakiKdvOrani('TİCARİ MALLAR')).toBeNull();
    expect(hesapAdindakiKdvOrani('MALLAR %100')).toBeNull();
  });

  it('%20 hesapta %10 KDV → WARN; %1 hesapta %1 KDV temiz', () => {
    const rows = [
      ...stokAlis('s1', '2026-04-10', '153.01.002', 'TİCARİ MALLAR %20', 10_000, 1_000),
      ...stokAlis('s2', '2026-04-11', '153.01.001', 'TİCARİ MALLAR %1', 20_000, 200),
      ...stokAlis('s3', '2026-04-12', '153.01.002', 'TİCARİ MALLAR %20', 8_000, 1_600),
    ];
    const s = kuralStokKdvOraniUyumsuz(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].voucherKey).toBe('s1');
    expect(s.bulgular[0].hesapKodu).toBe('153.01.002');
    expect(s.bulgular[0].message).toContain('fiili oran %10');
    expect(s.bulgular[0].message).toContain('hesap adı %20');
    expect(s.bulgular[0].message).toContain('10.04.2026');
    expect(s.bulgular[0].detail?.tutar).toBe(10_000);
    expect(s.bulgular[0].detail?.beklenenOran).toBe(20);
    expect(s.bulgular[0].detail?.gercekOran).toBe(10);
  });

  it('%0 hesapta KDV varsa uyumsuz; karma fis (gider satiri da var) atlanir', () => {
    const sifir = stokAlis('s0', '2026-04-10', '153.01.003', 'TİCARİ MALLAR %0', 5_000, 1_000);
    const s = kuralStokKdvOraniUyumsuz(baglamKur({ rows: sifir, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('hesap adı %0');
    // 153 %20 10.000 + 770 nakliye 1.000 + 191 2.200 (= 2.000 + 200) / 320
    const karma = [
      satir({ voucherKey: 'k1', fisTarihi: d('2026-04-15'), hesapKodu: '153.01.002', hesapAdi: 'TİCARİ MALLAR %20', borc: 10_000 }),
      satir({ voucherKey: 'k1', fisTarihi: d('2026-04-15'), hesapKodu: '770.01.005', hesapAdi: 'NAKLIYE', borc: 1_000 }),
      satir({ voucherKey: 'k1', fisTarihi: d('2026-04-15'), hesapKodu: '191.01.001', hesapAdi: 'KDV', borc: 2_200 }),
      satir({ voucherKey: 'k1', fisTarihi: d('2026-04-15'), hesapKodu: '320.01.S001', hesapAdi: 'SATICI', alacak: 13_200 }),
    ];
    expect(kuralStokKdvOraniUyumsuz(baglamKur({ rows: karma, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('adinda yuzde olan stok hesabi yoksa VERI_YOK', () => {
    const rows = alisFaturasi('a1', '2026-04-10', '320.01.S001', 'SERVET', 80_000);
    expect(kuralStokKdvOraniUyumsuz(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('ust sinir: 20 uyumsuz fis → 15 bulgu + ozet', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 20; i += 1) rows.push(...stokAlis(`u${i}`, '2026-05-10', '153.01.002', 'TİCARİ MALLAR %20', 1_000 * i, 10 * i));
    const s = kuralStokKdvOraniUyumsuz(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.bulgular).toHaveLength(16);
    expect(s.bulgular[15].detail?.ozet).toBe(true);
    expect(s.bulgular[0].detail?.tutar).toBe(20_000); // en buyuk once
  });
});

describe('STOK_CIRO_ORANI_YUKSEK', () => {
  const satis = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);

  it('Mizan stok 500.000, satis 100.000 → bilgi (5.0 kati); esik alti → temiz', () => {
    const mz = mizan({ '153.01.001': { bakiye: 500_000, ad: 'TICARI MALLAR' }, '153.01.002': { bakiye: -1_000, ad: 'TERS' } });
    const s = kuralStokCiroOrani(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].message).toContain('500.000,00 TL');
    expect(s.bulgular[0].message).toContain('5.0 katı');
    expect(s.bulgular[0].hesapKodu).toBe('153.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(500_000);
    const kucuk = mizan({ '153.01.001': { bakiye: 80_000, ad: 'TICARI MALLAR' } });
    expect(kuralStokCiroOrani(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2', mizan: kucuk })).durum).toBe('TEMIZ');
    const makul = mizan({ '153.01.001': { bakiye: 100_000, ad: 'TICARI MALLAR' } });
    expect(kuralStokCiroOrani(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2', mizan: makul })).durum).toBe('TEMIZ');
  });

  it('Mizan yok / Mizanda stok yok / satis yok → VERI_YOK', () => {
    expect(kuralStokCiroOrani(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const stoksuz = mizan({ '120.01.A001': { bakiye: 10_000, ad: 'AND' } });
    expect(kuralStokCiroOrani(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2', mizan: stoksuz })).durum).toBe('VERI_YOK');
    const satissiz = alisFaturasi('a1', '2026-04-10', '320.01.S001', 'SERVET', 80_000);
    const mz = mizan({ '153.01.001': { bakiye: 500_000, ad: 'TICARI MALLAR' } });
    expect(kuralStokCiroOrani(baglamKur({ rows: satissiz, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz })).durum).toBe('VERI_YOK');
  });
});

describe('SABIT_GIDER_AY_ATLAMIS', () => {
  const kira = [
    ...giderFaturasi('k4', '2026-04-01', '770.01.001', 'GENEL GIDERLER', 20_000, 'İşyeri kirası Nisan'),
    ...giderFaturasi('k5', '2026-05-01', '770.01.001', 'GENEL GIDERLER', 20_000, 'İşyeri kirası Mayıs'),
    ...giderFaturasi('k6', '2026-06-01', '770.01.001', 'GENEL GIDERLER', 20_000, 'İşyeri kirası Haziran'),
  ];

  it('elektrik Mayista yok, Nisan/Haziranda var → bilgi; her ay olan kira icin bulgu yok', () => {
    const rows = [
      ...kira,
      ...giderFaturasi('e4', '2026-04-12', '770.01.002', 'GENEL GIDERLER', 1_250, 'ENERJİSA elektrik faturası'),
      ...giderFaturasi('e6', '2026-06-12', '770.01.002', 'GENEL GIDERLER', 1_310, 'ENERJİSA elektrik faturası'),
    ];
    const s = kuralSabitGiderAyAtlamis(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].message).toContain('Elektrik gideri Mayıs 2026 ayında yok');
    expect(s.bulgular[0].message).toContain('Nisan 2026 1.250,00 TL');
    expect(s.bulgular[0].message).toContain('Haziran 2026 1.310,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('770.01.002');
    expect(s.bulgular[0].voucherKey).toBe('e4');
    expect(s.bulgular[0].detail?.tutar).toBeCloseTo(1_280, 2);
    expect(s.bulgular[0].detail?.eksikAy).toBe('2026-05');
  });

  it('hepsi duzenli → temiz; duzenli gider deseni yok → temiz (not)', () => {
    const s = kuralSabitGiderAyAtlamis(baglamKur({ rows: kira, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('1 düzenli gider türü her ay var');
    const rows = [
      ...giderFaturasi('x1', '2026-04-12', '770.01.003', 'GENEL GIDERLER', 500, 'Kırtasiye'),
      ...giderFaturasi('x2', '2026-05-12', '770.01.003', 'GENEL GIDERLER', 500, 'Temizlik malzemesi'),
    ];
    const t = kuralSabitGiderAyAtlamis(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(t.durum).toBe('TEMIZ');
    expect(t.not).toContain('Düzenli gider deseni yok');
  });

  it('tek ayda gorunen tur desen sayilmaz; 2 aylik donem → UYGULANMAZ; 7xx yok → VERI_YOK', () => {
    const rows = [...kira, ...giderFaturasi('t1', '2026-04-20', '770.01.004', 'GENEL GIDERLER', 3_000, 'Turkcell telefon faturası')];
    expect(kuralSabitGiderAyAtlamis(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralSabitGiderAyAtlamis(baglamKur({ rows: kira, range: IKI_AY, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    const satis = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    expect(kuralSabitGiderAyAtlamis(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('yillik: 11 ayda var, Temmuz yok → komsu aylar + ortalama yazilir', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let ay = 1; ay <= 12; ay += 1) {
      if (ay === 7) continue;
      rows.push(...giderFaturasi(`e${ay}`, `2026-${String(ay).padStart(2, '0')}-10`, '770.01.002', 'ELEKTRIK GIDERLERI', 1_000 + ay * 10, 'fatura'));
    }
    const s = kuralSabitGiderAyAtlamis(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Elektrik gideri Temmuz 2026 ayında yok');
    expect(s.bulgular[0].message).toContain('önceki ay Haziran 2026 1.060,00 TL');
    expect(s.bulgular[0].message).toContain('sonraki ay Ağustos 2026 1.080,00 TL');
    expect(s.bulgular[0].message).toContain('aylık ortalama');
  });
});

describe('AYLIK_HAREKET_KESINTISI', () => {
  function satislar(ay: string, adet: number, onek: string) {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= adet; i += 1) rows.push(...satisFaturasi(`${onek}${i}`, `2026-${ay}-${String(i + 2).padStart(2, '0')}`, '120.01.A001', 'AND', 10_000));
    return rows;
  }

  it('satis Nisan 6, Mayis 0, Haziran 6 → satis ve hesaplanan KDV siniflari icin bilgi', () => {
    const rows = [...satislar('04', 6, 'n'), ...satislar('06', 6, 'h')];
    const s = kuralAylikHareketKesintisi(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(2);
    const satisB = s.bulgular.find((x) => String(x.detail?.sinif).startsWith('Satış'))!;
    expect(satisB.message).toContain('Satış (600/601 alacak) kayıtları Mayıs 2026 ayında hiç yok');
    expect(satisB.message).toContain('Nisan 2026 6 kayıt / 60.000,00 TL');
    expect(satisB.hesapKodu).toBe('600.01.001');
    expect(satisB.detail?.tutar).toBeCloseTo(60_000, 2);
    expect(s.bulgular.some((x) => String(x.detail?.sinif).startsWith('Hesaplanan KDV'))).toBe(true);
  });

  it('diger aylarda esik alti (3 kayit) → temiz; her ay var → temiz', () => {
    const az = [...satislar('04', 3, 'n'), ...satislar('06', 3, 'h')];
    expect(kuralAylikHareketKesintisi(baglamKur({ rows: az, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const tam = [...satislar('04', 6, 'n'), ...satislar('05', 6, 'm'), ...satislar('06', 6, 'h')];
    expect(kuralAylikHareketKesintisi(baglamKur({ rows: tam, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('2 aylik donem → UYGULANMAZ; hic hareket yok → VERI_YOK', () => {
    const rows = [...satislar('04', 6, 'n')];
    expect(kuralAylikHareketKesintisi(baglamKur({ rows, range: IKI_AY, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    expect(kuralAylikHareketKesintisi(baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});

describe('KREDI_FAIZ_GIDERI_YOK', () => {
  it('kredi kullanimi var, faiz gideri yok → WARN', () => {
    const rows = krediKullanim('kr1', '2026-04-05', 500_000);
    const s = kuralKrediFaizGideriYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('300.01.001');
    expect(s.bulgular[0].message).toContain('finansman/faiz gideri (780/660/661) kaydı yok');
    expect(s.bulgular[0].hesapKodu).toBe('300.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(500_000);
  });

  it('780 taksit faizi → temiz; 770 altinda "kredi faizi" → temiz; "gecikme faizi" sayilmaz', () => {
    const kredi = krediKullanim('kr1', '2026-04-05', 500_000);
    const t780 = [...kredi, ...krediTaksit('kt1', '2026-05-05', 40_000, 12_000)];
    const s1 = kuralKrediFaizGideriYok(baglamKur({ rows: t780, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s1.durum).toBe('TEMIZ');
    expect(s1.not).toContain('780');
    const t770 = [...kredi, ...krediTaksit('kt2', '2026-05-05', 40_000, 12_000, '770.01.009', 'DIGER GIDERLER', 'banka kredi faizi')];
    const s2 = kuralKrediFaizGideriYok(baglamKur({ rows: t770, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s2.durum).toBe('TEMIZ');
    expect(s2.not).toContain('770.01.009');
    const gecikme = [...kredi, ...nakitGider('gz', '2026-05-26', '770.01.009', 'DIGER GIDERLER', 'KDV gecikme faizi', 800)];
    expect(kuralKrediFaizGideriYok(baglamKur({ rows: gecikme, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('BULGU');
  });

  it('Mizanda 300 alacak bakiyesi var, donemde hareket yok → bulgu; kredi hic yok → VERI_YOK', () => {
    const rows = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    const mz = mizan({ '300.01.001': { bakiye: -350_000, ad: 'X BANKASI KREDI' } });
    const s = kuralKrediFaizGideriYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Mizan kredi bakiyesi 350.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('300.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(350_000);
    expect(kuralKrediFaizGideriYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});

describe('GELECEK_AY_180_AKTARIM_YOK', () => {
  it('180 borc var, alacak yok → bilgi; aktarim varsa temiz', () => {
    const rows = pesinGider('p1', '2026-04-01', 120_000);
    const s = kuralGelecekAy180Aktarim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].message).toContain('180.01.001');
    expect(s.bulgular[0].message).toContain('dönemde 120.000,00 TL borç kaydı');
    expect(s.bulgular[0].detail?.tutar).toBe(120_000);
    const t = kuralGelecekAy180Aktarim(baglamKur({ rows: [...rows, ...aktarim180('a1', '2026-04-30', 10_000)], range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(t.durum).toBe('TEMIZ');
    expect(t.not).toContain('10.000,00');
  });

  it('180 yok → VERI_YOK; yalniz Mizanda bakiye var → bulgu', () => {
    const rows = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    expect(kuralGelecekAy180Aktarim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const mz = mizan({ '180.01.001': { bakiye: 60_000, ad: 'GELECEK AYLARA AIT GIDERLER' } });
    const s = kuralGelecekAy180Aktarim(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Mizan bakiyesi 60.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('180.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(60_000);
  });
});

describe('KKEG_NITELIKLI_GIDER_7XX', () => {
  it('desen ayristirma', () => {
    expect(kkegDeseni('trafik cezasi 34abc123')).toBe('trafik cezasi');
    expect(kkegDeseni('ozel usulsuzluk cezasi')).toBe('ozel usulsuzluk');
    expect(kkegDeseni('damga vergisi cezasi')).toBe('ceza');
    expect(kkegDeseni('cezai sart odemesi')).toBeNull();
    expect(kkegDeseni('kirtasiye')).toBeNull();
  });

  it('trafik cezasi 770e yazilmis → WARN; cezai sart atlanir; ayni fiste 689 varsa atlanir', () => {
    const rows = [
      ...nakitGider('c1', '2026-05-15', '770.01.009', 'DIGER GIDERLER', 'Trafik cezası ödemesi 34ABC123', 1_250),
      ...nakitGider('c2', '2026-05-16', '770.01.009', 'DIGER GIDERLER', 'Cezai şart ödemesi (sözleşme)', 5_000),
      // 770 + 689 ayni fiste: KKEG'e alinmis
      satir({ voucherKey: 'c3', fisTarihi: d('2026-05-20'), hesapKodu: '770.01.009', hesapAdi: 'DIGER GIDERLER', aciklama: 'Vergi cezası', borc: 1_000 }),
      satir({ voucherKey: 'c3', fisTarihi: d('2026-05-20'), hesapKodu: '689.01.001', hesapAdi: 'KKEG', aciklama: 'Vergi cezası', borc: 1_000 }),
      satir({ voucherKey: 'c3', fisTarihi: d('2026-05-20'), hesapKodu: '100.01.001', hesapAdi: 'KASA', aciklama: 'Vergi cezası', alacak: 2_000 }),
    ];
    const s = kuralKkegNitelikliGider(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].voucherKey).toBe('c1');
    expect(s.bulgular[0].hesapKodu).toBe('770.01.009');
    expect(s.bulgular[0].message).toContain('trafik cezası');
    expect(s.bulgular[0].message).toContain('1.250,00 TL');
    expect(s.bulgular[0].message).toContain('689');
    expect(s.bulgular[0].detail?.tutar).toBe(1_250);
  });

  it('temiz gider → TEMIZ; 7xx yok → VERI_YOK; 20 ceza satiri → 15 + ozet', () => {
    const temiz = giderFaturasi('g1', '2026-04-08', '770.01.001', 'GENEL GIDERLER', 5_000, 'danismanlik');
    expect(kuralKkegNitelikliGider(baglamKur({ rows: temiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const satis = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    expect(kuralKkegNitelikliGider(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const cok: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 20; i += 1) cok.push(...nakitGider(`z${i}`, '2026-05-15', '770.01.009', 'DIGER GIDERLER', `Gecikme zammı ${i}`, 100 * i));
    const s = kuralKkegNitelikliGider(baglamKur({ rows: cok, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.bulgular).toHaveLength(16);
    expect(s.bulgular[15].detail?.ozet).toBe(true);
  });
});

describe('DEMIRBAS_DOGRUDAN_GIDER', () => {
  it('laptop 25.000 (2026 siniri 12.000) → bilgi; sinir alti / bakim / telefon faturasi / 25x ile ayni fis → yok', () => {
    const rows = [
      ...nakitGider('d1', '2026-05-12', '770.01.012', 'DIGER GIDERLER', 'Laptop alımı Dell', 25_000),
      ...nakitGider('d2', '2026-05-13', '770.01.012', 'DIGER GIDERLER', 'Bilgisayar alımı', 5_000),
      ...nakitGider('d3', '2026-05-14', '770.01.012', 'DIGER GIDERLER', 'Bilgisayar bakım onarım', 20_000),
      ...nakitGider('d4', '2026-05-15', '770.01.004', 'HABERLESME', 'Telefon faturası Nisan', 15_000),
      // klima + montaj: sabit kiymet ayni fiste 255'e alinmis
      satir({ voucherKey: 'd5', fisTarihi: d('2026-05-16'), hesapKodu: '255.01.001', hesapAdi: 'DEMIRBASLAR', aciklama: 'Klima alımı', borc: 30_000 }),
      satir({ voucherKey: 'd5', fisTarihi: d('2026-05-16'), hesapKodu: '770.01.012', hesapAdi: 'DIGER GIDERLER', aciklama: 'Klima montaj', borc: 15_000 }),
      satir({ voucherKey: 'd5', fisTarihi: d('2026-05-16'), hesapKodu: '100.01.001', hesapAdi: 'KASA', aciklama: 'Klima', alacak: 45_000 }),
    ];
    const s = kuralDemirbasDogrudanGider(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].voucherKey).toBe('d1');
    expect(s.bulgular[0].message).toContain('25.000,00 TL');
    expect(s.bulgular[0].message).toContain('2026 yılı doğrudan gider sınırı 12.000,00 TL');
    expect(s.bulgular[0].detail?.tutar).toBe(25_000);
    expect(s.bulgular[0].detail?.sinir).toBe(12_000);
  });

  it('2025 tarihli satirda 2025 siniri (9.900) kullanilir; temiz → TEMIZ; 7xx yok → VERI_YOK', () => {
    const rows = nakitGider('y1', '2025-11-12', '770.01.012', 'DIGER GIDERLER', 'Yazıcı alımı', 10_000);
    const s = kuralDemirbasDogrudanGider(baglamKur({ rows, range: { start: d('2025-10-01'), end: d('2025-12-31') }, donemTipi: 'GECICI_Q4' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('2025 yılı doğrudan gider sınırı 9.900,00 TL');
    const temiz = giderFaturasi('g1', '2026-04-08', '770.01.001', 'GENEL GIDERLER', 50_000, 'danismanlik');
    expect(kuralDemirbasDogrudanGider(baglamKur({ rows: temiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const satis = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);
    expect(kuralDemirbasDogrudanGider(baglamKur({ rows: satis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});

describe('BRUT_SATIS_ZARARI', () => {
  const rows = satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000);

  it('SMM net satistan buyuk → bilgi (iadeler dusulur); kar → temiz', () => {
    const mz = mizan({ '600.01.001': -800_000, '610.01.001': 50_000, '621.01.001': 900_000 });
    const s = kuralBrutSatisZarari(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].message).toContain('net satış 750.000,00 TL');
    expect(s.bulgular[0].message).toContain('iadeler 50.000,00 TL');
    expect(s.bulgular[0].message).toContain('maliyeti (62x) 900.000,00 TL');
    expect(s.bulgular[0].message).toContain('brüt satış zararı 150.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('621.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(150_000);
    const karli = mizan({ '600.01.001': -800_000, '621.01.001': 500_000 });
    const t = kuralBrutSatisZarari(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: karli }));
    expect(t.durum).toBe('TEMIZ');
    expect(t.not).toContain('300.000,00');
  });

  it('Mizan yok / 62x yok / SMM bakiyesi sifir → VERI_YOK', () => {
    expect(kuralBrutSatisZarari(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const smmsiz = mizan({ '600.01.001': -800_000 });
    expect(kuralBrutSatisZarari(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: smmsiz })).durum).toBe('VERI_YOK');
    const sifir = mizan({ '600.01.001': -800_000, '621.01.001': 0 });
    expect(kuralBrutSatisZarari(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: sifir })).durum).toBe('VERI_YOK');
  });
});

describe('katalog uyumu', () => {
  it('10 kural, kodlar katalogda, bulgu category = kod, siddet katalogla uyumlu', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000),
      ...stokAlis('s1', '2026-04-10', '153.01.002', 'TİCARİ MALLAR %20', 10_000, 1_000),
      ...krediKullanim('kr1', '2026-04-05', 500_000),
      ...pesinGider('p1', '2026-04-01', 120_000),
      ...nakitGider('c1', '2026-05-15', '770.01.009', 'DIGER GIDERLER', 'Trafik cezası', 1_250),
      ...nakitGider('d1', '2026-05-12', '770.01.012', 'DIGER GIDERLER', 'Laptop alımı', 25_000),
    ];
    const mz = mizan({ '153.01.002': { bakiye: 500_000, ad: 'TİCARİ MALLAR %20' }, '600.01.001': -100_000, '621.01.001': 150_000 });
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
    expect(STOK_GIDER_KURALLARI).toHaveLength(10);
    const kodlar = new Set<string>();
    for (const kural of STOK_GIDER_KURALLARI) {
      const s = kural(b);
      kodlar.add(s.kod);
      expect(HDD_KOD_SETI.has(s.kod)).toBe(true);
      const tanim = hddKural(s.kod)!;
      for (const bulgu of s.bulgular) {
        expect(bulgu.category).toBe(s.kod);
        expect(typeof bulgu.detail?.tutar).toBe('number');
        // SMM_621_YOK yillikta WARN'a cikar (katalog INFO); digerleri katalogla birebir
        if (s.kod !== 'SMM_621_YOK' && !bulgu.detail?.ozet) expect(bulgu.severity).toBe(tanim.siddet);
      }
    }
    expect(kodlar.size).toBe(10);
  });
});
