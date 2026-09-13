import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { Q2, alisFaturasi, d, mizan, odeme, satir, satisFaturasi, tahsilat } from './test-yardimcilari';
import {
  kuralAlacakCiroOrani,
  kuralCari120OranDusuk,
  kuralCari120TahsilatYok,
  kuralCari320OdemeYok,
  kuralCariAyniTaraf,
  kuralCariHareketsizBakiye,
  kuralDefterTahsilatOdemeIslenmemis,
  kuralMukerrerCariKarti,
} from './cari';

describe('cari kurallari', () => {
  it('120: faturalar var, tahsilat yok → CARI_120_TAHSILAT_YOK; tahsilat olan cari temiz', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND AMBALAJ', 50_000),
      ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND AMBALAJ', 40_000),
      ...satisFaturasi('f3', '2026-04-10', '120.01.B001', 'BETA LTD', 30_000),
      ...tahsilat('t1', '2026-05-20', '120.01.B001', 'BETA LTD', 36_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralCari120TahsilatYok(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].hesapKodu).toBe('120.01.A001');
    expect(s.bulgular[0].message).toContain('2 satış faturası');
    expect(s.bulgular[0].message).toContain('tahsilat kaydı yok');
    expect(s.bulgular[0].detail?.tutar).toBeCloseTo(108_000, 2);
  });

  it('120: iade fisi tahsilat sayilmaz', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND AMBALAJ', 50_000),
      ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND AMBALAJ', 40_000),
      // iade: 610 borc + 391 borc / 120 alacak
      satir({ voucherKey: 'i1', fisTarihi: d('2026-05-10'), hesapKodu: '610.01.001', hesapAdi: 'IADELER', borc: 5_000 }),
      satir({ voucherKey: 'i1', fisTarihi: d('2026-05-10'), hesapKodu: '391.01.001', hesapAdi: 'KDV', borc: 1_000 }),
      satir({ voucherKey: 'i1', fisTarihi: d('2026-05-10'), hesapKodu: '120.01.A001', hesapAdi: 'AND AMBALAJ', alacak: 6_000 }),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralCari120TahsilatYok(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('iade/düzeltme var');
  });

  it('120: Mizan yil basindan beri tahsilat yok notunu ekler', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND AMBALAJ', 50_000),
      ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND AMBALAJ', 40_000),
    ];
    const mz = mizan({ '120': { bakiye: 500_000 }, '120.01': { bakiye: 500_000 }, '120.01.A001': { bakiye: 500_000, borc: 500_000, alacak: 0, ad: 'AND AMBALAJ' } });
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
    const s = kuralCari120TahsilatYok(b);
    expect(s.bulgular[0].message).toContain('Yıl başından beri de hiç tahsilat yok');
    expect(s.bulgular[0].message).toContain('500.000,00');
  });

  it('320: alis faturalari var, odeme yok → CARI_320_ODEME_YOK', () => {
    const rows = [
      ...alisFaturasi('a1', '2026-04-05', '320.01.S001', 'SERVET COMAK', 100_000),
      ...alisFaturasi('a2', '2026-05-05', '320.01.S001', 'SERVET COMAK', 120_000),
      ...alisFaturasi('a3', '2026-04-05', '320.01.T001', 'TUVTURK', 8_000),
      ...odeme('o1', '2026-05-15', '320.01.T001', 'TUVTURK', 9_600),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralCari320OdemeYok(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular.map((x) => x.hesapKodu)).toEqual(['320.01.S001']);
  });

  it('tek aylik donemde tek yonlu kurali UYGULANMAZ', () => {
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 50_000), ...satisFaturasi('f2', '2026-04-06', '120.01.A001', 'AND', 50_000)];
    const b = baglamKur({ rows, range: { start: d('2026-04-01'), end: d('2026-04-30') }, donemTipi: 'AYLIK' });
    expect(kuralCari120TahsilatYok(b).durum).toBe('UYGULANMAZ');
  });

  it('tahsilat orani dusuk → INFO; yeterli tahsilat → temiz', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 50_000),
      ...satisFaturasi('f2', '2026-05-05', '120.01.A001', 'AND', 50_000),
      ...satisFaturasi('f3', '2026-06-05', '120.01.A001', 'AND', 50_000),
      ...tahsilat('t1', '2026-05-20', '120.01.A001', 'AND', 10_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralCari120OranDusuk(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('%6');
    const rows2 = [...rows, ...tahsilat('t2', '2026-06-20', '120.01.A001', 'AND', 100_000)];
    expect(kuralCari120OranDusuk(baglamKur({ rows: rows2, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('hareketsiz cari bakiyesi Mizan ile bulunur, Mizan yoksa VERI_YOK', () => {
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 50_000)];
    const mz = mizan({
      '120': { bakiye: 110_000 },
      '120.01.A001': { bakiye: 60_000, ad: 'AND' },
      '120.01.Z009': { bakiye: 50_000, ad: 'ZEHRA GIDA' },
      '320.01.K001': { bakiye: -15_000, ad: 'KAMER SOGUTMA' },
      '320.01.K002': { bakiye: -500, ad: 'KUCUK' },
    });
    const s = kuralCariHareketsizBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular.map((x) => x.hesapKodu).sort()).toEqual(['120.01.Z009', '320.01.K001']);
    expect(kuralCariHareketsizBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('ayni cari hem 120 hem 320 → bilgi; mukerrer kart → bilgi', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.O001', 'ÖZTİRYAKİLER MADENİ EŞYA SAN. VE TİC. A.Ş.', 50_000),
      ...alisFaturasi('a1', '2026-04-07', '320.01.O002', 'ÖZTİRYAKİLER MADENİ', 20_000),
      ...satisFaturasi('f2', '2026-05-05', '120.01.O009', 'OZTIRYAKILER MADENI ESYA', 10_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const ayni = kuralCariAyniTaraf(b);
    expect(ayni.durum).toBe('BULGU');
    expect(ayni.bulgular[0].message).toContain('320.01.O002');
    const muk = kuralMukerrerCariKarti(b);
    expect(muk.durum).toBe('BULGU');
    expect(muk.bulgular[0].message).toContain('2 ayrı kart');
  });

  it('defter geneli: carilerin %80+ tek yonlu ve kasa/banka yok → ERROR; banka varsa WARN', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 6; i += 1) rows.push(...satisFaturasi(`f${i}`, '2026-04-05', `120.01.C00${i}`, `CARI ${i}`, 10_000 * i));
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralDefterTahsilatOdemeIslenmemis(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('ERROR');
    expect(s.bulgular[0].message).toContain('hiç kasa (100) ve banka (102) hareketi yok');
    const rows2 = [...rows, ...tahsilat('t1', '2026-05-01', '120.01.C001', 'CARI 1', 1_000)];
    const s2 = kuralDefterTahsilatOdemeIslenmemis(baglamKur({ rows: rows2, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s2.bulgular[0].severity).toBe('WARN');
    // tek yonlu yaygin → bireysel bulgular en fazla 10
    const cok: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 30; i += 1) cok.push(...satisFaturasi(`g${i}`, '2026-04-05', `120.01.D${String(i).padStart(3, '0')}`, `MUSTERI ${i}`, 20_000 + i));
    const s3 = kuralCari120TahsilatYok(baglamKur({ rows: cok, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s3.bulgular).toHaveLength(11); // 10 + ozet
    expect(s3.bulgular[10].detail?.ozet).toBe(true);
  });

  it('alacak/ciro orani yuksek → bilgi', () => {
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'AND', 100_000)];
    const mz = mizan({ '120.01.A001': { bakiye: 900_000, ad: 'AND' } });
    const s = kuralAlacakCiroOrani(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('9.0 katı');
    const mz2 = mizan({ '120.01.A001': { bakiye: 150_000, ad: 'AND' } });
    expect(kuralAlacakCiroOrani(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz2 })).durum).toBe('TEMIZ');
  });
});
