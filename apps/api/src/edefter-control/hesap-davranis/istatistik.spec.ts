import { baglamKur, hareketSinifla, normalizeCariAdi } from './istatistik';
import { Q2, bordroFisi, mizan, satisFaturasi, tahsilat } from './kurallar/test-yardimcilari';

describe('istatistik motoru', () => {
  it('Mizan yaprak tespiti: noktasiz ust seviyeler (1, 12, 120) ve noktali ara seviye (120.01) yaprak sayilmaz', () => {
    const mz = mizan({
      '1': 1_000, '12': 1_000, '120': 1_000, '120.01': 1_000,
      '120.01.A001': 600, '120.01.A002': 400,
      '3': -500, '36': -500, '360': -500, '360.01': -500, '360.01.001': -500,
    });
    const b = baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
    expect([...b.mizanHesaplari.keys()].sort()).toEqual(['120.01.A001', '120.01.A002', '360.01.001']);
  });

  it('karsi hesap siniflandirmasi: fatura / tahsilat / iade / tahakkuk / odeme / tesvik', () => {
    const rows = [
      ...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'ALICI', 10_000),
      ...tahsilat('t1', '2026-04-20', '120.01.A001', 'ALICI', 12_000),
      ...bordroFisi('b4', '2026-04-30'),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const alici = b.hesaplar.get('120.01.A001')!;
    expect(alici.hareketler.map((m) => m.sinif)).toEqual(['FATURA', 'TAHSILAT']);
    const sgk = b.hesaplar.get('361.01.001')!;
    // alacak = tahakkuk, ayni fisteki borc (tesvik) = DUZELTME (odeme degil)
    expect(sgk.hareketler.map((m) => `${m.taraf}:${m.sinif}`).sort()).toEqual(['ALACAK:TAHAKKUK', 'BORC:DUZELTME']);
    expect(hareketSinifla('360', 'BORC', new Set(['102']))).toBe('ODEME');
    expect(hareketSinifla('120', 'ALACAK', new Set(['610', '391']))).toBe('IADE');
    expect(hareketSinifla('320', 'ALACAK', new Set(['153', '191']))).toBe('FATURA');
  });

  it('acilis Mizan kapanisindan turetilir (acilis = kapanis − donem net)', () => {
    const rows = [...satisFaturasi('f1', '2026-04-05', '120.01.A001', 'ALICI', 10_000, 0)];
    const mz = mizan({ '120.01.A001': { bakiye: 25_000, ad: 'ALICI' } });
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
    const h = b.hesaplar.get('120.01.A001')!;
    expect(h.net).toBe(10_000);
    expect(h.acilis).toBe(15_000);
    expect(h.kapanis).toBe(25_000);
  });

  it('cari adi normalizasyonu sirket eklerini atar', () => {
    expect(normalizeCariAdi('ÖZTİRYAKİLER MADENİ EŞYA SAN. VE TİC. A.Ş.')).toBe(normalizeCariAdi('Oztiryakiler Madeni'));
    expect(normalizeCariAdi('AND POLİSTİREN AMBALAJ VE DEKO')).toBe('and polistiren');
  });
});
