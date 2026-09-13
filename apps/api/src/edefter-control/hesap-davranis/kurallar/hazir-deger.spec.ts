import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { HDD_KOD_SETI, hddKural } from '../katalog';
import type { DenetimBaglami } from '../tipler';
import { Q2, YIL, d, giderFaturasi, mizan, satir, satisFaturasi, tahsilat } from './test-yardimcilari';
import {
  HAZIR_DEGER_KURALLARI,
  kuralBankaHareketiYok,
  kuralBankaMasrafKaydiYok,
  kuralBankaTekYonlu,
  kuralDovizKurDegerlemeYok,
  kuralKasaBakiyeYuksek,
  kuralKasaHareketiYok,
  kuralPos108TekYonlu,
  kuralVadeliMevduatFaizYok,
} from './hazir-deger';

const NISAN = { start: d('2026-04-01'), end: d('2026-04-30') };

// ---------------------------------------------------------------- yerel satir ureticileri
// Bankaya para girisi: banka borc / cari alacak (banka adi serbest)
function bankaGiris(key: string, tarih: string, tutar: number, banka = '102.01.001', bankaAd = 'GARANTI VADESIZ', karsi = '120.01.A001', karsiAd = 'AND AMBALAJ') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: banka, hesapAdi: bankaAd, aciklama: 'havale', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: karsi, hesapAdi: karsiAd, aciklama: 'havale', alacak: tutar }),
  ];
}
// Bankadan para cikisi: cari borc / banka alacak
function bankaCikis(key: string, tarih: string, tutar: number, banka = '102.01.001', bankaAd = 'GARANTI VADESIZ', karsi = '320.01.S001', karsiAd = 'SERVET COMAK') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: karsi, hesapAdi: karsiAd, aciklama: 'odeme', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: banka, hesapAdi: bankaAd, aciklama: 'odeme', alacak: tutar }),
  ];
}
// n giris + n cikis (aktif banka)
function aktifBanka(n: number, banka = '102.01.001', bankaAd = 'GARANTI VADESIZ'): ParsedEDefterFisLine[] {
  const rows: ParsedEDefterFisLine[] = [];
  for (let i = 0; i < n; i += 1) {
    const ay = 4 + (i % 3);
    rows.push(...bankaGiris(`${banka}-g${i}`, `2026-0${ay}-1${i % 9}`, 1_000 + i, banka, bankaAd));
    rows.push(...bankaCikis(`${banka}-c${i}`, `2026-0${ay}-2${i % 8}`, 500 + i, banka, bankaAd));
  }
  return rows;
}
// Banka masrafi: gider borc / banka alacak
function bankaMasrafi(key: string, tarih: string, tutar: number, o: { giderHesap?: string; giderAd?: string; giderAciklama?: string; banka?: string; bankaAciklama?: string } = {}) {
  const giderHesap = o.giderHesap ?? '770.01.005';
  const giderAd = o.giderAd ?? 'BANKA MASRAFLARI';
  const giderAciklama = o.giderAciklama ?? 'Banka masraf ve komisyon';
  const banka = o.banka ?? '102.01.001';
  const bankaAciklama = o.bankaAciklama ?? giderAciklama;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: giderHesap, hesapAdi: giderAd, aciklama: giderAciklama, borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: banka, hesapAdi: 'GARANTI VADESIZ', aciklama: bankaAciklama, alacak: tutar }),
  ];
}
// POS satisi: 108 borc / 600 + 391 alacak
function posSatisi(key: string, tarih: string, matrah: number, pos = '108.01.001') {
  const kdv = matrah * 0.2;
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: pos, hesapAdi: 'POS GARANTI', aciklama: 'kredi karti satis', borc: matrah + kdv }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '600.01.001', hesapAdi: 'SATISLAR', aciklama: 'kredi karti satis', alacak: matrah }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '391.01.001', hesapAdi: 'HESAPLANAN KDV', aciklama: 'kredi karti satis', alacak: kdv }),
  ];
}
// POS aktarimi: 102 borc / 108 alacak
function posAktarimi(key: string, tarih: string, tutar: number, pos = '108.01.001', banka = '102.01.001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: banka, hesapAdi: 'GARANTI VADESIZ', aciklama: 'POS aktarimi', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: pos, hesapAdi: 'POS GARANTI', aciklama: 'POS aktarimi', alacak: tutar }),
  ];
}
// Kur farki gideri: 656 borc / banka alacak (tarih null → tarihsiz satir)
function kurFarkiGideri(key: string, tarih: string | null, tutar: number, banka = '102.02.001', bankaAd = 'GARANTI USD HESABI') {
  const fisTarihi = tarih ? d(tarih) : null;
  return [
    satir({ voucherKey: key, fisTarihi, hesapKodu: '656.01.001', hesapAdi: 'KAMBIYO ZARARLARI', aciklama: 'kur degerleme', borc: tutar }),
    satir({ voucherKey: key, fisTarihi, hesapKodu: banka, hesapAdi: bankaAd, aciklama: 'kur degerleme', alacak: tutar }),
  ];
}
// Vadeli hesaba virman: vadeli borc / vadesiz alacak
function vadeliVirman(key: string, tarih: string, tutar: number, vadeli = '102.03.001', vadeliAd = 'GARANTI VADELI MEVDUAT', kaynak = '102.01.001') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: vadeli, hesapAdi: vadeliAd, aciklama: 'vadeli hesaba virman', borc: tutar }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: kaynak, hesapAdi: 'VADESIZ HESAP', aciklama: 'vadeli hesaba virman', alacak: tutar }),
  ];
}
// Faiz geliri: banka borc + 193 borc / 642 alacak
function faizGeliri(key: string, tarih: string, brut: number, stopaj: number, banka = '102.03.001', bankaAd = 'GARANTI VADELI MEVDUAT') {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: banka, hesapAdi: bankaAd, aciklama: 'faiz tahakkuku', borc: brut - stopaj }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '193.01.001', hesapAdi: 'PESIN ODENEN VERGILER', aciklama: 'faiz stopaji', borc: stopaj }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '642.01.001', hesapAdi: 'FAIZ GELIRLERI', aciklama: 'faiz tahakkuku', alacak: brut }),
  ];
}

function ucSatis(): ParsedEDefterFisLine[] {
  return [
    ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND AMBALAJ', 50_000),
    ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND AMBALAJ', 40_000),
    ...satisFaturasi('f3', '2026-06-05', '120.01.B001', 'BETA LTD', 30_000),
  ];
}

function q2(rows: ParsedEDefterFisLine[], mz?: ReturnType<typeof mizan>): DenetimBaglami {
  return baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
}

// ================================================================ 1) BANKA_HAREKETI_YOK
describe('BANKA_HAREKETI_YOK', () => {
  it('satış var + Mizanda 102 var, dönemde 102 hareketi yok → WARN (hesapKodu 102, Mizan sayısı/bakiyesi mesajda)', () => {
    const mz = mizan({ '102.01.001': { bakiye: 125_000, ad: 'GARANTI VADESIZ' }, '102.01.002': { bakiye: -5_000, ad: 'ISBANK KMH' } });
    const s = kuralBankaHareketiYok(q2(ucSatis(), mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].category).toBe('BANKA_HAREKETI_YOK');
    expect(s.bulgular[0].hesapKodu).toBe('102');
    expect(s.bulgular[0].message).toContain('Mizanda 2 banka hesabı var (toplam bakiye 120.000,00 TL)');
    expect(s.bulgular[0].message).toContain('3 satış fişi');
    expect(s.bulgular[0].detail?.tutar).toBe(120_000);
    expect(s.bulgular[0].detail?.mizanHesapSayisi).toBe(2);
  });

  it('Mizan yok ama ≥3 satış fişi var → yine WARN', () => {
    const s = kuralBankaHareketiYok(q2(ucSatis()));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Mizan yok');
    expect(s.bulgular[0].message).toContain('3 satış fişi');
    expect(s.bulgular[0].detail?.tutar).toBe(0);
  });

  it('Mizanda 102 var, satış hiç yok → yine WARN (banka hesabı var ama ekstre işlenmemiş)', () => {
    const rows = giderFaturasi('g1', '2026-04-05', '770.01.001', 'KIRA', 10_000, 'kira');
    const mz = mizan({ '102.01.001': { bakiye: 0, ad: 'GARANTI VADESIZ' } });
    const s = kuralBankaHareketiYok(q2(rows, mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Mizanda 1 banka hesabı var');
    expect(s.bulgular[0].message).toContain('satış fişi de yok');
  });

  it('banka hareketi varsa TEMIZ', () => {
    const rows = [...ucSatis(), ...tahsilat('t1', '2026-05-20', '120.01.A001', 'AND AMBALAJ', 36_000)];
    const s = kuralBankaHareketiYok(q2(rows));
    expect(s.durum).toBe('TEMIZ');
    expect(s.bulgular).toHaveLength(0);
  });

  it('ne Mizanda 102 ne yeterli satış → VERI_YOK', () => {
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 50_000), ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND', 40_000)];
    expect(kuralBankaHareketiYok(q2(rows)).durum).toBe('VERI_YOK');
    const mz = mizan({ '100.01.001': { bakiye: 5_000, ad: 'KASA' } });
    expect(kuralBankaHareketiYok(q2(rows, mz)).durum).toBe('VERI_YOK');
    expect(kuralBankaHareketiYok(q2([], mz)).not).toContain('satış fişi yok');
  });
});

// ================================================================ 2) BANKA_TEK_YONLU
describe('BANKA_TEK_YONLU', () => {
  it('yalnız giriş gören banka → INFO; iki yönlü banka ve vadeli hesap listelenmez', () => {
    const rows = [
      ...bankaGiris('g1', '2026-04-10', 10_000),
      ...bankaGiris('g2', '2026-05-10', 12_000),
      ...bankaGiris('g3', '2026-06-10', 8_000),
      // iki yonlu ikinci banka
      ...bankaGiris('g4', '2026-04-12', 5_000, '102.01.002', 'ISBANK VADESIZ'),
      ...bankaCikis('c1', '2026-05-12', 3_000, '102.01.002', 'ISBANK VADESIZ'),
      ...bankaGiris('g5', '2026-06-12', 5_000, '102.01.002', 'ISBANK VADESIZ'),
      // vadeli hesap yalniz borc (virman, kaynak iki yonlu ikinci banka) → atlanir
      ...vadeliVirman('v1', '2026-04-15', 100_000, '102.03.001', 'GARANTI VADELI MEVDUAT', '102.01.002'),
      ...vadeliVirman('v2', '2026-05-15', 100_000, '102.03.001', 'GARANTI VADELI MEVDUAT', '102.01.002'),
      ...vadeliVirman('v3', '2026-06-15', 100_000, '102.03.001', 'GARANTI VADELI MEVDUAT', '102.01.002'),
    ];
    const s = kuralBankaTekYonlu(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('BANKA_TEK_YONLU');
    expect(s.bulgular[0].hesapKodu).toBe('102.01.001');
    expect(s.bulgular[0].message).toContain('102.01.001 GARANTI VADESIZ');
    expect(s.bulgular[0].message).toContain('3 hareketin tümü giriş (borç) yönlü, 30.000,00 TL');
    expect(s.bulgular[0].detail?.tutar).toBe(30_000);
    expect(s.bulgular[0].detail?.yon).toBe('BORC');
    expect(s.bulgular[0].voucherKey).toBe('g1');
  });

  it('yalnız çıkış gören banka → INFO (alacak yönlü); Mizan bakiyesi mesaja eklenir', () => {
    const rows = [
      ...bankaCikis('c1', '2026-04-10', 4_000, '102.01.005', 'ZIRAAT VADESIZ'),
      ...bankaCikis('c2', '2026-05-10', 6_000, '102.01.005', 'ZIRAAT VADESIZ'),
      ...bankaCikis('c3', '2026-06-10', 5_000, '102.01.005', 'ZIRAAT VADESIZ'),
    ];
    const mz = mizan({ '102.01.005': { bakiye: 85_000, ad: 'ZIRAAT VADESIZ' } });
    const s = kuralBankaTekYonlu(q2(rows, mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('çıkış (alacak) yönlü, 15.000,00 TL');
    expect(s.bulgular[0].message).toContain('Mizan bakiyesi 85.000,00 TL');
    expect(s.bulgular[0].detail?.yon).toBe('ALACAK');
  });

  it('iki yönlü çalışan banka → TEMIZ; 3 hareketin altındaki tek yönlü hesap da temiz', () => {
    const rows = [
      ...bankaGiris('g1', '2026-04-10', 10_000),
      ...bankaCikis('c1', '2026-05-10', 2_000),
      ...bankaGiris('g2', '2026-06-10', 8_000),
      ...bankaGiris('g3', '2026-04-11', 1_000, '102.01.009', 'KUCUK BANKA'),
      ...bankaGiris('g4', '2026-05-11', 1_000, '102.01.009', 'KUCUK BANKA'),
    ];
    const s = kuralBankaTekYonlu(q2(rows));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('2 banka hesabı incelendi');
  });

  it('tek aylık dönem → UYGULANMAZ; 102 hareketi yok → VERI_YOK', () => {
    const rows = [...bankaGiris('g1', '2026-04-10', 10_000), ...bankaGiris('g2', '2026-04-11', 10_000), ...bankaGiris('g3', '2026-04-12', 10_000)];
    expect(kuralBankaTekYonlu(baglamKur({ rows, range: NISAN, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    expect(kuralBankaTekYonlu(q2(ucSatis())).durum).toBe('VERI_YOK');
  });

  it('çok sayıda tek yönlü banka → en fazla 10 bireysel bulgu + özet', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const kod = `102.01.${String(i).padStart(3, '0')}`;
      rows.push(...bankaGiris(`a${i}`, '2026-04-10', 1_000 * i, kod, `BANKA ${i}`));
      rows.push(...bankaGiris(`b${i}`, '2026-05-10', 1_000 * i, kod, `BANKA ${i}`));
      rows.push(...bankaGiris(`c${i}`, '2026-06-10', 1_000 * i, kod, `BANKA ${i}`));
    }
    const s = kuralBankaTekYonlu(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(11);
    expect(s.bulgular[10].detail?.ozet).toBe(true);
    expect(s.bulgular[0].hesapKodu).toBe('102.01.012'); // en buyuk tutar once
  });
});

// ================================================================ 3) KASA_HAREKETI_YOK
describe('KASA_HAREKETI_YOK', () => {
  it('satış var, banka var, kasa hiç yok → INFO (hesapKodu 100)', () => {
    const rows = [...ucSatis(), ...tahsilat('t1', '2026-05-20', '120.01.A001', 'AND AMBALAJ', 36_000)];
    const s = kuralKasaHareketiYok(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('KASA_HAREKETI_YOK');
    expect(s.bulgular[0].hesapKodu).toBe('100');
    expect(s.bulgular[0].message).toContain('3 satış fişi işlenmiş ama hiç kasa (100) hareketi yok');
    expect(s.bulgular[0].message).not.toContain('Banka hareketi de yok');
    expect(s.bulgular[0].detail?.tutar).toBe(0);
  });

  it('banka da yoksa mesaja eklenir; Mizan kasa bakiyesi mesajda', () => {
    const mz = mizan({ '100.01.001': { bakiye: 12_500, ad: 'MERKEZ KASA' } });
    const s = kuralKasaHareketiYok(q2(ucSatis(), mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Banka hareketi de yok');
    expect(s.bulgular[0].message).toContain('Mizanda kasa bakiyesi 12.500,00 TL');
    expect(s.bulgular[0].detail?.tutar).toBe(12_500);
  });

  it('kasa hareketi varsa TEMIZ', () => {
    const rows = [...ucSatis(), ...tahsilat('t1', '2026-05-20', '120.01.A001', 'AND AMBALAJ', 5_000, '100.01.001')];
    expect(kuralKasaHareketiYok(q2(rows)).durum).toBe('TEMIZ');
  });

  it('satış yok ya da 3 fişin altında → VERI_YOK', () => {
    expect(kuralKasaHareketiYok(q2(giderFaturasi('g1', '2026-04-05', '770.01.001', 'KIRA', 10_000, 'kira'))).durum).toBe('VERI_YOK');
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 50_000), ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND', 40_000)];
    const s = kuralKasaHareketiYok(q2(rows));
    expect(s.durum).toBe('VERI_YOK');
    expect(s.not).toContain('2 satış fişi');
  });
});

// ================================================================ 4) KASA_BAKIYE_YUKSEK
describe('KASA_BAKIYE_YUKSEK', () => {
  it('Mizan kasa bakiyesi eşiğin üstünde → INFO (fiili sayım / adat faizi uyarısı)', () => {
    const mz = mizan({ '100.01.001': { bakiye: 300_000, ad: 'MERKEZ KASA' } });
    const s = kuralKasaBakiyeYuksek(q2(ucSatis(), mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('KASA_BAKIYE_YUKSEK');
    expect(s.bulgular[0].hesapKodu).toBe('100.01.001');
    expect(s.bulgular[0].message).toContain('300.000,00 TL');
    expect(s.bulgular[0].message).toContain('fiili kasa sayımı');
    expect(s.bulgular[0].message).toContain('adat faizi');
    expect(s.bulgular[0].message).toContain('örtülü kazanç');
    expect(s.bulgular[0].detail?.tutar).toBe(300_000);
    expect(s.bulgular[0].voucherKey).toBeNull(); // kasa donemde hareketsiz
  });

  it('birden çok kasa hesabının toplamı eşiği aşıyor → tek bulgu, en büyük hesaba çapa; hareketliyse fiş çapası dolu', () => {
    const rows = [...ucSatis(), ...tahsilat('t1', '2026-05-20', '120.01.A001', 'AND AMBALAJ', 5_000, '100.01.001')];
    const mz = mizan({ '100.01.001': { bakiye: 150_000, ad: 'MERKEZ KASA' }, '100.01.002': { bakiye: 120_000, ad: 'SUBE KASA' } });
    const s = kuralKasaBakiyeYuksek(q2(rows, mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('270.000,00 TL');
    expect(s.bulgular[0].message).toContain('2 kasa hesabı; en büyüğü 100.01.001 MERKEZ KASA 150.000,00 TL');
    expect(s.bulgular[0].hesapKodu).toBe('100.01.001');
    expect(s.bulgular[0].voucherKey).toBe('t1');
    expect(s.bulgular[0].detail?.hesapSayisi).toBe(2);
  });

  it('eşik altı → TEMIZ (not eşiği yazar)', () => {
    const mz = mizan({ '100.01.001': { bakiye: 50_000, ad: 'MERKEZ KASA' } });
    const s = kuralKasaBakiyeYuksek(q2(ucSatis(), mz));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('50.000,00 TL');
    expect(s.not).toContain('250.000,00 TL');
  });

  it('Mizan yok ya da Mizanda 100 yok → VERI_YOK', () => {
    expect(kuralKasaBakiyeYuksek(q2(ucSatis())).durum).toBe('VERI_YOK');
    const mz = mizan({ '102.01.001': { bakiye: 900_000, ad: 'BANKA' } });
    const s = kuralKasaBakiyeYuksek(q2(ucSatis(), mz));
    expect(s.durum).toBe('VERI_YOK');
    expect(s.not).toContain('Mizanda 100 hesabı yok');
  });
});

// ================================================================ 5) POS_108_TEK_YONLU
describe('POS_108_TEK_YONLU', () => {
  it('108 yalnız borç çalışmış (≥3 tahsilat) → INFO, tutar = borç toplamı', () => {
    const rows = [...posSatisi('p1', '2026-04-03', 1_000), ...posSatisi('p2', '2026-05-03', 2_000), ...posSatisi('p3', '2026-06-03', 3_000)];
    const s = kuralPos108TekYonlu(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('POS_108_TEK_YONLU');
    expect(s.bulgular[0].hesapKodu).toBe('108.01.001');
    expect(s.bulgular[0].message).toContain('3 POS tahsilatı (7.200,00 TL)');
    expect(s.bulgular[0].message).toContain('108 → 102');
    expect(s.bulgular[0].detail?.tutar).toBeCloseTo(7_200, 2);
  });

  it('POS aktarımı (108 alacak) varsa TEMIZ; 3 tahsilatın altındaysa da temiz', () => {
    const rows = [...posSatisi('p1', '2026-04-03', 1_000), ...posSatisi('p2', '2026-05-03', 2_000), ...posSatisi('p3', '2026-06-03', 3_000), ...posAktarimi('a1', '2026-06-05', 7_200)];
    expect(kuralPos108TekYonlu(q2(rows)).durum).toBe('TEMIZ');
    const az = [...posSatisi('p1', '2026-04-03', 1_000), ...posSatisi('p2', '2026-05-03', 2_000)];
    expect(kuralPos108TekYonlu(q2(az)).durum).toBe('TEMIZ');
  });

  it('tek aylık dönem → UYGULANMAZ; 108 hareketi yok → VERI_YOK', () => {
    const rows = [...posSatisi('p1', '2026-04-03', 1_000), ...posSatisi('p2', '2026-04-04', 2_000), ...posSatisi('p3', '2026-04-05', 3_000)];
    expect(kuralPos108TekYonlu(baglamKur({ rows, range: NISAN, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    expect(kuralPos108TekYonlu(q2(ucSatis())).durum).toBe('VERI_YOK');
  });
});

// ================================================================ 6) BANKA_MASRAF_KAYDI_YOK
describe('BANKA_MASRAF_KAYDI_YOK', () => {
  it('aktif banka (≥10 hareket) var, masraf/komisyon kaydı yok → INFO; çapa en aktif banka', () => {
    const rows = [...aktifBanka(5), ...aktifBanka(6, '102.01.002', 'ISBANK VADESIZ')];
    const s = kuralBankaMasrafKaydiYok(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('BANKA_MASRAF_KAYDI_YOK');
    expect(s.bulgular[0].hesapKodu).toBe('102.01.002');
    expect(s.bulgular[0].message).toContain('102.01.002 ISBANK VADESIZ: dönemde 12 banka hareketi işlenmiş (2 aktif banka hesabında toplam 22 hareket)');
    expect(s.bulgular[0].message).toContain('hiç banka masrafı, komisyon ya da BSMV gider kaydı yok');
    expect(s.bulgular[0].detail?.tutar).toBe(0);
    expect(s.bulgular[0].detail?.aktifHesapSayisi).toBe(2);
  });

  it('770 BANKA MASRAFLARI borç / 102 alacak kaydı varsa TEMIZ', () => {
    const rows = [...aktifBanka(5), ...bankaMasrafi('m1', '2026-04-30', 125.5)];
    const s = kuralBankaMasrafKaydiYok(q2(rows));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('1 banka masraf/komisyon kaydı var (125,50 TL)');
  });

  it('masraf metni yalnız 102 satırında yazıyorsa da sayılır (gider satırı genel adlı)', () => {
    const rows = [...aktifBanka(5), ...bankaMasrafi('m1', '2026-05-31', 80, { giderHesap: '770.01.001', giderAd: 'GENEL GIDERLER', giderAciklama: 'dekont', bankaAciklama: 'EFT ücreti' })];
    expect(kuralBankaMasrafKaydiYok(q2(rows)).durum).toBe('TEMIZ');
  });

  it('BSMV 780 finansman gideri de masraf sayılır', () => {
    const rows = [...aktifBanka(5), ...bankaMasrafi('m1', '2026-06-30', 42, { giderHesap: '780.01.002', giderAd: 'FINANSMAN GIDERLERI', giderAciklama: 'BSMV' })];
    expect(kuralBankaMasrafKaydiYok(q2(rows)).durum).toBe('TEMIZ');
  });

  it('komisyon metni var ama karşı taraf 102 değil (320 fatura) → sayılmaz, bulgu sürer; masraf metni olmayan 7xx/102 kaydı da sayılmaz', () => {
    const rows = [
      ...aktifBanka(5),
      ...giderFaturasi('gf', '2026-05-10', '760.01.001', 'PAZARLAMA', 1_000, 'satış komisyonu'),
      ...bankaMasrafi('k1', '2026-05-15', 15_000, { giderHesap: '770.01.002', giderAd: 'KIRA GIDERI', giderAciklama: 'mayıs kirası', bankaAciklama: 'mayıs kirası' }),
    ];
    expect(kuralBankaMasrafKaydiYok(q2(rows)).durum).toBe('BULGU');
  });

  it('aktif banka yok (<10 hareket) → VERI_YOK; 102 yok → VERI_YOK; tek ay → UYGULANMAZ', () => {
    const az = aktifBanka(4); // 8 hareket
    const s = kuralBankaMasrafKaydiYok(q2(az));
    expect(s.durum).toBe('VERI_YOK');
    expect(s.not).toContain('en çok 8 hareket');
    expect(kuralBankaMasrafKaydiYok(q2(ucSatis())).durum).toBe('VERI_YOK');
    expect(kuralBankaMasrafKaydiYok(baglamKur({ rows: aktifBanka(6), range: NISAN, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
  });
});

// ================================================================ 7) DOVIZ_HESAP_KUR_DEGERLEME_YOK
describe('DOVIZ_HESAP_KUR_DEGERLEME_YOK', () => {
  const usdBanka = () => [
    ...bankaGiris('u1', '2026-04-10', 50_000, '102.02.001', 'GARANTI USD HESABI'),
    ...bankaGiris('u2', '2026-05-10', 20_000, '102.02.001', 'GARANTI USD HESABI'),
  ];

  it('USD banka hesabı var, son ayda 646/656 yok → WARN (dönem sonu ayı ve hesap kodu mesajda)', () => {
    const s = kuralDovizKurDegerlemeYok(q2(usdBanka()));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].category).toBe('DOVIZ_HESAP_KUR_DEGERLEME_YOK');
    expect(s.bulgular[0].hesapKodu).toBe('102.02.001');
    expect(s.bulgular[0].voucherKey).toBe('u1');
    expect(s.bulgular[0].message).toContain('102.02.001 GARANTI USD HESABI');
    expect(s.bulgular[0].message).toContain('Haziran 2026 sonunda kur farkı (646/656) kaydı yok');
    expect(s.bulgular[0].message).not.toContain('Önceki aylarda');
    expect(s.bulgular[0].detail?.tutar).toBe(70_000);
    expect(s.bulgular[0].detail?.sonAy).toBe('2026-06');
  });

  it('son ayda 656 hareketi varsa TEMIZ; yalnız önceki ayda varsa bulgu + not', () => {
    const temiz = [...usdBanka(), ...kurFarkiGideri('kf', '2026-06-30', 1_500)];
    expect(kuralDovizKurDegerlemeYok(q2(temiz)).durum).toBe('TEMIZ');
    const eski = [...usdBanka(), ...kurFarkiGideri('kf', '2026-04-30', 1_500)];
    const s = kuralDovizKurDegerlemeYok(q2(eski));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('Önceki aylarda kur farkı kaydı var');
    expect(s.bulgular[0].detail?.digerAydaKurFarki).toBe(true);
  });

  it('656 kaydı tarihsizse bulgu sürer ama mesajda belirtilir', () => {
    const rows = [...usdBanka(), ...kurFarkiGideri('kf', null, 1_500)];
    const s = kuralDovizKurDegerlemeYok(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('tarihsiz kayıt var');
    expect(s.bulgular[0].detail?.tarihsizKurFarki).toBe(true);
  });

  it('aylık dönemde UYGULANMAZ (dönem tipi boş + tek ay da aylık sayılır)', () => {
    expect(kuralDovizKurDegerlemeYok(baglamKur({ rows: usdBanka(), range: NISAN, donemTipi: 'AYLIK' })).durum).toBe('UYGULANMAZ');
    expect(kuralDovizKurDegerlemeYok(baglamKur({ rows: usdBanka(), range: NISAN })).durum).toBe('UYGULANMAZ');
    // dönem tipi boş ama 3 aylık aralık → uygulanır
    expect(kuralDovizKurDegerlemeYok(baglamKur({ rows: usdBanka(), range: Q2 })).durum).toBe('BULGU');
  });

  it('adında döviz geçen hesap yok → VERI_YOK; "EURASIA" gibi cari adı döviz sayılmaz', () => {
    expect(kuralDovizKurDegerlemeYok(q2(ucSatis())).durum).toBe('VERI_YOK');
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.E001', 'EURASIA LOJISTIK LTD', 50_000), ...tahsilat('t1', '2026-05-01', '120.01.E001', 'EURASIA LOJISTIK LTD', 60_000)];
    expect(kuralDovizKurDegerlemeYok(q2(rows)).durum).toBe('VERI_YOK');
  });

  it('yalnız Mizanda olan bakiyeli dövizli cari (120 EUR) da yakalanır; bakiyesi sıfırsa yakalanmaz', () => {
    const mz = mizan({ '120.01.E001': { bakiye: 50_000, ad: 'EXPORT GMBH EUR' } });
    const s = kuralDovizKurDegerlemeYok(q2(ucSatis(), mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].hesapKodu).toBe('120.01.E001');
    expect(s.bulgular[0].voucherKey).toBeNull();
    expect(s.bulgular[0].detail?.tutar).toBe(50_000);
    const sifir = mizan({ '120.01.E001': { bakiye: 0, ad: 'EXPORT GMBH EUR' } });
    expect(kuralDovizKurDegerlemeYok(q2(ucSatis(), sifir)).durum).toBe('VERI_YOK');
  });

  it('yıllık dönemde son ay Aralık; Aralıkta 646 varsa TEMIZ', () => {
    const rows = [
      ...bankaGiris('u1', '2026-03-10', 50_000, '102.02.001', 'GARANTI USD HESABI'),
      satir({ voucherKey: 'kf', fisTarihi: d('2026-12-31'), hesapKodu: '102.02.001', hesapAdi: 'GARANTI USD HESABI', aciklama: 'kur degerleme', borc: 2_000 }),
      satir({ voucherKey: 'kf', fisTarihi: d('2026-12-31'), hesapKodu: '646.01.001', hesapAdi: 'KAMBIYO KARLARI', aciklama: 'kur degerleme', alacak: 2_000 }),
    ];
    const s = kuralDovizKurDegerlemeYok(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' }));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('Aralık 2026');
  });

  it('5 hesaptan fazlası "ve N hesap daha" olarak özetlenir; banka hesapları listede önce gelir', () => {
    const rows: ParsedEDefterFisLine[] = [];
    const adlar = ['ALPHA GMBH EUR', 'BETA INC USD', 'GAMMA LTD GBP', 'DELTA AG CHF', 'EPSILON DOLAR', 'ZETA DÖVİZ'];
    adlar.forEach((ad, i) => rows.push(...satisFaturasi(`f${i}`, '2026-04-05', `120.01.D00${i}`, ad, 10_000 * (i + 1))));
    rows.push(...bankaGiris('u1', '2026-04-10', 1_000, '102.02.001', 'GARANTI USD HESABI'));
    const s = kuralDovizKurDegerlemeYok(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('ve 2 hesap daha');
    expect(s.bulgular[0].hesapKodu).toBe('102.02.001');
    expect(s.bulgular[0].detail?.hesapSayisi).toBe(7);
    expect((s.bulgular[0].detail?.hesaplar as string[]).length).toBe(5);
  });
});

// ================================================================ 8) VADELI_MEVDUAT_FAIZ_YOK
describe('VADELI_MEVDUAT_FAIZ_YOK', () => {
  it('vadeli hesap hareketli, dönemde 642 alacak yok → INFO', () => {
    const rows = [...vadeliVirman('v1', '2026-04-15', 500_000)];
    const s = kuralVadeliMevduatFaizYok(q2(rows));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].severity).toBe('INFO');
    expect(s.bulgular[0].category).toBe('VADELI_MEVDUAT_FAIZ_YOK');
    expect(s.bulgular[0].hesapKodu).toBe('102.03.001');
    expect(s.bulgular[0].voucherKey).toBe('v1');
    expect(s.bulgular[0].message).toContain('102.03.001 GARANTI VADELI MEVDUAT');
    expect(s.bulgular[0].message).toContain('faiz geliri (642) kaydı yok');
    expect(s.bulgular[0].message).toContain('stopajı (193)');
  });

  it('642 faiz geliri kaydı varsa TEMIZ', () => {
    const rows = [...vadeliVirman('v1', '2026-04-15', 500_000), ...faizGeliri('fz', '2026-06-30', 10_000, 500)];
    const s = kuralVadeliMevduatFaizYok(q2(rows));
    expect(s.durum).toBe('TEMIZ');
    expect(s.not).toContain('642 faiz geliri kaydı var');
  });

  it('yalnız Mizanda bakiyeli vadeli hesap → bulgu (bakiye mesajda); bakiyesi sıfırsa VERI_YOK', () => {
    const mz = mizan({ '102.03.001': { bakiye: 500_000, ad: 'ISBANK VADELI' } });
    const s = kuralVadeliMevduatFaizYok(q2(ucSatis(), mz));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('bakiye 500.000,00 TL');
    expect(s.bulgular[0].voucherKey).toBeNull();
    expect(s.bulgular[0].detail?.tutar).toBe(500_000);
    const sifir = mizan({ '102.03.001': { bakiye: 0, ad: 'ISBANK VADELI' } });
    expect(kuralVadeliMevduatFaizYok(q2(ucSatis(), sifir)).durum).toBe('VERI_YOK');
  });

  it('vadeli hesap yok → VERI_YOK ("vadesiz" vadeli sayılmaz)', () => {
    const rows = [...bankaGiris('g1', '2026-04-10', 10_000, '102.01.001', 'GARANTI VADESIZ')];
    const s = kuralVadeliMevduatFaizYok(q2(rows));
    expect(s.durum).toBe('VERI_YOK');
  });
});

// ================================================================ katalog uyumu
describe('HAZIR_DEGER_KURALLARI katalog uyumu', () => {
  it('8 kural; her kod katalogda; bulgu category = kod; şiddet katalogla aynı', () => {
    expect(HAZIR_DEGER_KURALLARI).toHaveLength(8);
    const rows = [
      ...ucSatis(),
      ...bankaGiris('g1', '2026-04-10', 10_000),
      ...bankaGiris('g2', '2026-05-10', 10_000),
      ...bankaGiris('g3', '2026-06-10', 10_000),
      ...posSatisi('p1', '2026-04-03', 1_000), ...posSatisi('p2', '2026-05-03', 2_000), ...posSatisi('p3', '2026-06-03', 3_000),
      ...bankaGiris('u1', '2026-04-10', 50_000, '102.02.001', 'GARANTI USD HESABI'),
      ...vadeliVirman('v1', '2026-04-15', 500_000, '102.03.001', 'GARANTI VADELI MEVDUAT', '102.01.009'),
    ];
    const mz = mizan({ '100.01.001': { bakiye: 300_000, ad: 'MERKEZ KASA' } });
    const kodlar = new Set<string>();
    for (const kural of HAZIR_DEGER_KURALLARI) {
      const s = kural(q2(rows, mz));
      expect(HDD_KOD_SETI.has(s.kod)).toBe(true);
      kodlar.add(s.kod);
      const tanim = hddKural(s.kod)!;
      for (const bulgu of s.bulgular) {
        expect(bulgu.category).toBe(s.kod);
        expect(bulgu.severity).toBe(tanim.siddet);
        expect(typeof bulgu.detail?.tutar).toBe('number');
        expect(bulgu.message.length).toBeGreaterThan(20);
      }
    }
    expect(kodlar.size).toBe(8);
  });
});
