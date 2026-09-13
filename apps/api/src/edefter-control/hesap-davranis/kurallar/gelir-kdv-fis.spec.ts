import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { Q2, d, kdvTahakkuk, satir, satisFaturasi, tahsilat } from './test-yardimcilari';
import {
  kuralFisTarihiAySonuYigilma,
  kuralIadeKdvDuzeltmeYok,
  kuralKdvDevredenVeOdenecekAyniAy,
  kuralMukerrerFaturaCariBazli,
  kuralSatisKdvYok,
  normalizeBelgeNo,
} from './gelir-kdv-fis';

// Satis fisi (aciklamali, KDV'siz): 120 borc / 600 alacak
function kdvsizSatis(key: string, tarih: string, matrah: number, aciklama = 'satis faturasi', karsi = '120.01.A001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: karsi, hesapAdi: 'MUSTERI', aciklama, borc: matrah }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '600.01.001', hesapAdi: 'YURTICI SATISLAR', aciklama, alacak: matrah }),
  ];
}
// Iade fisi: 610 borc (+391/191 borc) / 120 alacak
function iadeFisi(key: string, tarih: string, tutar: number, kdvHesap: string | null = null, aciklama = 'satis iadesi') {
  const kdv = tutar * 0.2;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '610.01.001', hesapAdi: 'SATISTAN IADELER', aciklama, borc: tutar }),
    ...(kdvHesap ? [satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: kdvHesap, hesapAdi: 'KDV', aciklama, borc: kdv })] : []),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '120.01.A001', hesapAdi: 'MUSTERI', aciklama, alacak: tutar + (kdvHesap ? kdv : 0) }),
  ];
}
// Cari satiri: 120 borc (fatura) ya da alacak, belge no'lu
function cariSatiri(key: string, tarih: string, evrakNo: string | null, tutar: number, taraf: 'BORC' | 'ALACAK' = 'BORC', hesap = '120.01.A001', aciklama = 'fatura') {
  return satir({ voucherKey: key, fisTarihi: d(tarih), evrakNo, hesapKodu: hesap, hesapAdi: 'AND AMBALAJ', aciklama, ...(taraf === 'BORC' ? { borc: tutar } : { alacak: tutar }) });
}

describe('satis fisinde KDV yok', () => {
  it('600 alacak var, 391 yok, cari karsiligi var → WARN; KDV li fis temiz', () => {
    const rows = kdvsizSatis('f1', '2026-04-05', 50_000);
    const s = kuralSatisKdvYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('hesaplanan KDV (391) yok');
    expect(s.bulgular[0].hesapKodu).toBe('600.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(50_000);
    const kdvli = satisFaturasi('f2', '2026-04-05', '120.01.A001', 'AND', 50_000);
    expect(kuralSatisKdvYok(baglamKur({ rows: kdvli, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('istisna/ihracat aciklamasi, kapanis virmani (690↔600), esik alti tutar → temiz; 600 yoksa VERI_YOK', () => {
    const ihracat = kdvsizSatis('f1', '2026-04-05', 80_000, 'ihracat faturasi GCB 123');
    expect(kuralSatisKdvYok(baglamKur({ rows: ihracat, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const kdvsiz = kdvsizSatis('f2', '2026-04-05', 80_000, "KDV'siz satis (tevkifatli)");
    expect(kuralSatisKdvYok(baglamKur({ rows: kdvsiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    const virman = [
      satir({ voucherKey: 'v', fisTarihi: d('2026-06-30'), hesapKodu: '600.01.001', hesapAdi: 'SATISLAR', aciklama: 'gelir hesaplarinin devri', borc: 900_000 }),
      satir({ voucherKey: 'v', fisTarihi: d('2026-06-30'), hesapKodu: '690.01.001', hesapAdi: 'DONEM KARI', aciklama: 'gelir hesaplarinin devri', alacak: 900_000 }),
      satir({ voucherKey: 'v2', fisTarihi: d('2026-06-30'), hesapKodu: '690.01.001', hesapAdi: 'DONEM KARI', aciklama: 'virman', borc: 5_000 }),
      satir({ voucherKey: 'v2', fisTarihi: d('2026-06-30'), hesapKodu: '600.01.001', hesapAdi: 'SATISLAR', aciklama: 'virman', alacak: 5_000 }),
    ];
    expect(kuralSatisKdvYok(baglamKur({ rows: virman, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralSatisKdvYok(baglamKur({ rows: kdvsizSatis('k', '2026-04-05', 500), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralSatisKdvYok(baglamKur({ rows: tahsilat('t', '2026-04-05', '120.01.A001', 'AND', 1_000), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('cok fiste ust sinir 15 + ozet', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 20; i += 1) rows.push(...kdvsizSatis(`f${i}`, '2026-04-05', 1_000 * i));
    const s = kuralSatisKdvYok(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.bulgular).toHaveLength(16);
    expect(s.bulgular[15].detail?.ozet).toBe(true);
    expect(s.bulgular[0].detail?.tutar).toBe(20_000); // buyukten kucuge
  });
});

describe('satis iadesinde KDV duzeltmesi yok', () => {
  it('610 borc var, 391/191 borc yok → INFO; 391 ya da 191 borc varsa temiz', () => {
    const s = kuralIadeKdvDuzeltmeYok(baglamKur({ rows: iadeFisi('i1', '2026-05-10', 5_000), range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].hesapKodu).toBe('610.01.001');
    expect(s.bulgular[0].detail?.tutar).toBe(5_000);
    expect(kuralIadeKdvDuzeltmeYok(baglamKur({ rows: iadeFisi('i2', '2026-05-10', 5_000, '391.01.001'), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralIadeKdvDuzeltmeYok(baglamKur({ rows: iadeFisi('i3', '2026-05-10', 5_000, '191.01.001'), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('ihracat iadesi temiz; 61x yoksa VERI_YOK', () => {
    expect(kuralIadeKdvDuzeltmeYok(baglamKur({ rows: iadeFisi('i1', '2026-05-10', 5_000, null, 'ihracat iadesi'), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralIadeKdvDuzeltmeYok(baglamKur({ rows: satisFaturasi('f', '2026-04-05', '120.01.A001', 'AND', 10_000), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});

describe('ayni ayda hem devreden hem odenecek KDV', () => {
  it('tahakkuk fisinde 190 borc + 360 KDV alacak → WARN; normal tahakkuk temiz; tahakkuk yoksa VERI_YOK', () => {
    const hatali = [
      ...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000), // 360 alacak 20.000
      satir({ voucherKey: 'k4', fisTarihi: d('2026-04-30'), hesapKodu: '190.01.001', hesapAdi: 'DEVREDEN KDV', aciklama: 'KDV tahakkuk', borc: 5_000 }),
    ];
    const s = kuralKdvDevredenVeOdenecekAyniAy(baglamKur({ rows: hatali, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('5.000,00 TL devreden');
    expect(s.bulgular[0].message).toContain('20.000,00 TL ödenecek');
    expect(s.bulgular[0].detail?.tutar).toBe(20_000);
    const normal = [...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000), ...kdvTahakkuk('k5', '2026-05-31', 20_000, 35_000)];
    const s2 = kuralKdvDevredenVeOdenecekAyniAy(baglamKur({ rows: normal, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s2.durum).toBe('TEMIZ');
    expect(s2.not).toContain('2 KDV tahakkuk fişi');
    expect(kuralKdvDevredenVeOdenecekAyniAy(baglamKur({ rows: satisFaturasi('f', '2026-04-05', '120.01.A001', 'AND', 10_000), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('sorumlu sifatiyla (KDV-2) 360 satiri ile devreden ayni fiste olabilir → temiz', () => {
    const rows = [
      ...kdvTahakkuk('k4', '2026-04-30', 30_000, 50_000), // 190 borc 20.000
      satir({ voucherKey: 'k4', fisTarihi: d('2026-04-30'), hesapKodu: '191.01.002', hesapAdi: 'INDIRILECEK KDV (SORUMLU)', aciklama: 'KDV2 tahakkuk', borc: 4_000 }),
      satir({ voucherKey: 'k4', fisTarihi: d('2026-04-30'), hesapKodu: '360.01.002', hesapAdi: 'SORUMLU SIFATIYLA ODENECEK KDV', aciklama: 'KDV2 tahakkuk', alacak: 4_000 }),
    ];
    expect(kuralKdvDevredenVeOdenecekAyniAy(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });
});

describe('mukerrer fatura (cari + belge no + tutar)', () => {
  it('ayni cari, ayni belge no, ayni tutar iki fiste → ERROR; belge no bicim farki normalize edilir', () => {
    const rows = [
      cariSatiri('f1', '2026-04-05', 'ABC2026000000123', 12_000),
      satir({ voucherKey: 'f1', fisTarihi: d('2026-04-05'), hesapKodu: '600.01.001', hesapAdi: 'SATIS', alacak: 12_000 }),
      cariSatiri('f2', '2026-04-06', 'abc 2026-000000123', 12_000),
      satir({ voucherKey: 'f2', fisTarihi: d('2026-04-06'), hesapKodu: '600.01.001', hesapAdi: 'SATIS', alacak: 12_000 }),
      cariSatiri('f3', '2026-04-07', 'ABC2026000000124', 12_000), // farkli belge → temiz
    ];
    const s = kuralMukerrerFaturaCariBazli(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('ERROR');
    expect(s.bulgular[0].message).toContain('ABC2026000000123');
    expect(s.bulgular[0].message).toContain('12.000,00 TL ile 2 ayrı fişte');
    expect(s.bulgular[0].message).toContain('Mükerrer fatura');
    expect(s.bulgular[0].hesapKodu).toBe('120.01.A001');
    expect(s.bulgular[0].detail?.tutar).toBe(12_000);
    expect(s.bulgular[0].detail?.fisSayisi).toBe(2);
  });

  it('fatura + ayni belge nolu tahsilat (yon farkli), farkli tutar, iade fisi ve ayni fis icindeki iki satir mukerrer degildir', () => {
    const rows = [
      cariSatiri('f1', '2026-04-05', 'ABC2026000000123', 12_000),
      cariSatiri('t1', '2026-04-20', 'ABC2026000000123', 12_000, 'ALACAK'),
      cariSatiri('f2', '2026-04-05', 'ABC2026000000200', 9_000),
      cariSatiri('f3', '2026-04-06', 'ABC2026000000200', 9_500),
      cariSatiri('f4', '2026-04-05', 'ABC2026000000300', 4_000),
      cariSatiri('f5', '2026-04-08', 'ABC2026000000300', 4_000, 'BORC', '120.01.A001', 'iade faturasi ters kayit'),
      cariSatiri('f6', '2026-04-05', 'ABC2026000000400', 2_000),
      cariSatiri('f6', '2026-04-05', 'ABC2026000000400', 2_000),
    ];
    const s = kuralMukerrerFaturaCariBazli(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('TEMIZ');
  });

  it('anlamsiz/kisa belge no atlanir; hic belge no yoksa VERI_YOK; 320 tarafinda da calisir', () => {
    expect(normalizeBelgeNo('MUHTELİF')).toBeNull();
    expect(normalizeBelgeNo('12345')).toBeNull();
    expect(normalizeBelgeNo('123456')).toBe('123456');
    expect(normalizeBelgeNo('nakit')).toBeNull();
    expect(normalizeBelgeNo(' GIB-2026 000000137 ')).toBe('GIB2026000000137');
    const belgesiz = [cariSatiri('f1', '2026-04-05', null, 12_000), cariSatiri('f2', '2026-04-06', 'MUHTELIF', 12_000), cariSatiri('f3', '2026-04-07', '123', 12_000)];
    expect(kuralMukerrerFaturaCariBazli(baglamKur({ rows: belgesiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
    const satici = [
      cariSatiri('a1', '2026-04-05', 'SRV2026000000077', 36_000, 'ALACAK', '320.01.S001'),
      cariSatiri('a2', '2026-04-05', 'SRV2026000000077', 36_000, 'ALACAK', '320.01.S001'),
    ];
    const s = kuralMukerrerFaturaCariBazli(baglamKur({ rows: satici, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].hesapKodu).toBe('320.01.S001');
    expect(s.bulgular[0].message).toContain('Mükerrer fatura');
  });
});

describe('fisler ay sonuna yigilmis', () => {
  it('fislerin %60+ ay sonunda → bilgi; dagilmis fisler temiz; 30 fisten az → VERI_YOK', () => {
    const yigilmis: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 30; i += 1) yigilmis.push(...satisFaturasi(`s${i}`, i % 2 ? '2026-04-30' : '2026-05-31', '120.01.A001', 'AND', 1_000 * i));
    for (let i = 1; i <= 10; i += 1) yigilmis.push(...satisFaturasi(`m${i}`, '2026-05-12', '120.01.A001', 'AND', 500));
    const s = kuralFisTarihiAySonuYigilma(baglamKur({ rows: yigilmis, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].message).toContain('40 fişin 30 tanesi (%75)');
    expect(s.bulgular[0].detail?.aySonuFis).toBe(30);
    expect(typeof s.bulgular[0].detail?.tutar).toBe('number');
    const dagilmis: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 40; i += 1) dagilmis.push(...satisFaturasi(`s${i}`, `2026-04-${String((i % 28) + 1).padStart(2, '0')}`, '120.01.A001', 'AND', 1_000));
    expect(kuralFisTarihiAySonuYigilma(baglamKur({ rows: dagilmis, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralFisTarihiAySonuYigilma(baglamKur({ rows: yigilmis.slice(0, 60), range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('tahakkuk/bordro/amortisman fisleri sayima girmez', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 35; i += 1) rows.push(...kdvTahakkuk(`k${i}`, '2026-04-30', 10_000 + i, 5_000));
    for (let i = 1; i <= 5; i += 1) rows.push(...satisFaturasi(`m${i}`, '2026-05-12', '120.01.A001', 'AND', 500));
    const s = kuralFisTarihiAySonuYigilma(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('VERI_YOK');
  });
});
