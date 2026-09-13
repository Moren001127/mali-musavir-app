import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { Q2, YIL, d, mizan, satir } from './test-yardimcilari';
import { dogalYon, hesapAdiAnlamsizMi, kuralHesapAdiBos, kuralHesapTabiatinaAykiriBakiye } from './hesap-tabiati';

// Tek fis: hesap borc ya da alacak, karsi taraf 102 banka
function hareket(key: string, tarih: string, hesap: string, ad: string, taraf: 'BORC' | 'ALACAK', tutar: number) {
  return [
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: hesap, hesapAdi: ad, ...(taraf === 'BORC' ? { borc: tutar } : { alacak: tutar }) }),
    satir({ voucherKey: key, fisTarihi: d(tarih), hesapKodu: '102.01.001', hesapAdi: 'BANKA', ...(taraf === 'BORC' ? { alacak: tutar } : { borc: tutar }) }),
  ];
}

describe('dogal yon tablosu', () => {
  it('siniflar, eksi hesaplar, yansitma ve haric hesaplar', () => {
    expect(dogalYon('101')).toBe('BORC');
    expect(dogalYon('103')).toBe('ALACAK');
    expect(dogalYon('257')).toBe('ALACAK');
    expect(dogalYon('268')).toBe('ALACAK');
    expect(dogalYon('279')).toBe('BORC'); // verilen avanslar (278 tukenme payi alacak)
    expect(dogalYon('278')).toBe('ALACAK');
    expect(dogalYon('300')).toBe('ALACAK');
    expect(dogalYon('322')).toBe('BORC'); // borc senetleri reeskontu (-)
    expect(dogalYon('340')).toBe('ALACAK');
    expect(dogalYon('501')).toBe('BORC');
    expect(dogalYon('580')).toBe('BORC');
    expect(dogalYon('590')).toBe('ALACAK');
    expect(dogalYon('600')).toBe('ALACAK');
    expect(dogalYon('610')).toBe('BORC');
    expect(dogalYon('621')).toBe('BORC');
    expect(dogalYon('642')).toBe('ALACAK');
    expect(dogalYon('656')).toBe('BORC');
    expect(dogalYon('679')).toBe('ALACAK');
    expect(dogalYon('689')).toBe('BORC');
    expect(dogalYon('770')).toBe('BORC');
    expect(dogalYon('771')).toBe('ALACAK');
    expect(dogalYon('798')).toBe('ALACAK');
    for (const haric of ['100', '102', '120', '320', '131', '331', '190', '191', '391', '335', '360', '361', '690', '691', '692', '153', '158', '772', '900', '950']) {
      expect(dogalYon(haric)).toBeNull();
    }
  });
});

describe('hesap tabiatina aykiri bakiye', () => {
  it('Mizan ile kesin: 257 borc, 300 borc, 600 borc → WARN; dogal yonde olanlar ve haric hesaplar temiz', () => {
    const rows = [
      ...hareket('a1', '2026-04-30', '257.01.001', 'BIRIKMIS AMORTISMANLAR', 'BORC', 2_500),
      ...hareket('k1', '2026-05-10', '300.01.001', 'BANKA KREDISI', 'BORC', 50_000),
      ...hareket('s1', '2026-05-10', '600.01.001', 'YURTICI SATISLAR', 'ALACAK', 100_000),
      ...hareket('y1', '2026-05-10', '340.01.001', 'ALINAN SIPARIS AVANSLARI', 'ALACAK', 30_000),
      ...hareket('v1', '2026-05-10', '391.01.001', 'HESAPLANAN KDV', 'BORC', 9_000),
    ];
    const mz = mizan({
      '257.01.001': { bakiye: 12_500, ad: 'BIRIKMIS AMORTISMANLAR' }, // borc bakiye → ters
      '300.01.001': { bakiye: 20_000, ad: 'BANKA KREDISI' }, // borc bakiye → ters (fazla odeme)
      '600.01.001': { bakiye: 4_000, ad: 'YURTICI SATISLAR' }, // borc bakiye → ters
      '340.01.001': { bakiye: -30_000, ad: 'ALINAN SIPARIS AVANSLARI' }, // alacak → dogal
      '391.01.001': { bakiye: 9_000, ad: 'HESAPLANAN KDV' }, // haric (KDV kurali)
      '102.01.001': { bakiye: -200_000, ad: 'BANKA' }, // haric (banka kurali)
    });
    const s = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular.map((x) => x.hesapKodu).sort()).toEqual(['257.01.001', '300.01.001', '600.01.001']);
    const b257 = s.bulgular.find((x) => x.hesapKodu === '257.01.001')!;
    expect(b257.severity).toBe('WARN');
    expect(b257.message).toContain('kapanış bakiyesi 12.500,00 TL BORÇ');
    expect(b257.message).toContain('doğal yönü ALACAK');
    expect(b257.message).toContain('eksi (-) düzenleyici hesap');
    expect(b257.message).not.toContain('açılış bakiyesi bilinmiyor');
    expect(b257.detail?.tutar).toBe(12_500);
    expect(b257.detail?.kesin).toBe(true);
    const b300 = s.bulgular.find((x) => x.hesapKodu === '300.01.001')!;
    expect(b300.message).toContain('borç/kaynak hesabı');
    const b600 = s.bulgular.find((x) => x.hesapKodu === '600.01.001')!;
    expect(b600.message).toContain('gelir hesabı');
  });

  it('kapanis bilinmiyorsa donem neti ile, yalniz 5.000 ustu ve "acilis bilinmiyor" notuyla', () => {
    const buyuk = hareket('y1', '2026-05-10', '340.01.001', 'ALINAN SIPARIS AVANSLARI', 'BORC', 8_000);
    const s = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows: buyuk, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].hesapKodu).toBe('340.01.001');
    expect(s.bulgular[0].message).toContain('dönem hareketi neti 8.000,00 TL BORÇ');
    expect(s.bulgular[0].message).toContain('açılış bakiyesi bilinmiyor');
    expect(s.bulgular[0].detail?.kesin).toBe(false);
    const kucuk = hareket('y2', '2026-05-10', '340.01.001', 'ALINAN SIPARIS AVANSLARI', 'BORC', 3_000);
    expect(kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows: kucuk, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
  });

  it('gelir tablosu hesaplari yillik defterde kesin sayilir (6xx borc, 7xx alacak); ara donemde esik gecerli', () => {
    const rows = [
      ...hareket('s1', '2026-03-10', '600.01.001', 'YURTICI SATISLAR', 'BORC', 2_000),
      ...hareket('g1', '2026-03-10', '770.01.001', 'GENEL YONETIM GIDERLERI', 'ALACAK', 1_500),
      ...hareket('g2', '2026-03-10', '771.01.001', 'GYG YANSITMA', 'ALACAK', 40_000),
    ];
    const yillik = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows, range: YIL, donemTipi: 'YILLIK' }));
    expect(yillik.durum).toBe('BULGU');
    expect(yillik.bulgular.map((x) => x.hesapKodu).sort()).toEqual(['600.01.001', '770.01.001']);
    expect(yillik.bulgular[0].message).not.toContain('açılış bakiyesi bilinmiyor');
    const ceyrek = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(ceyrek.durum).toBe('TEMIZ');
  });

  it('acilis fisi verideyse kapanis kesindir; Mizanda hareketsiz ters bakiye de yakalanir; hesap yoksa VERI_YOK', () => {
    const acilisli = [
      satir({ voucherKey: 'ac', fisTarihi: d('2026-01-01'), hesapKodu: '102.01.001', hesapAdi: 'BANKA', aciklama: 'Açılış fişi', borc: 10_000 }),
      satir({ voucherKey: 'ac', fisTarihi: d('2026-01-01'), hesapKodu: '500.01.001', hesapAdi: 'SERMAYE', aciklama: 'Açılış fişi', alacak: 10_000 }),
      ...hareket('y1', '2026-02-10', '336.01.001', 'DIGER CESITLI BORCLAR', 'BORC', 700),
    ];
    const s = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows: acilisli, range: YIL, donemTipi: 'YILLIK' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular).toHaveLength(1);
    expect(s.bulgular[0].hesapKodu).toBe('336.01.001');
    expect(s.bulgular[0].detail?.kesin).toBe(true);
    const rows = hareket('x', '2026-04-10', '600.01.001', 'SATIS', 'ALACAK', 1_000);
    const mz = mizan({ '103.01.001': { bakiye: 5_000, ad: 'VERILEN CEKLER' }, '600.01.001': -1_000 });
    const s2 = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s2.durum).toBe('BULGU');
    expect(s2.bulgular[0].hesapKodu).toBe('103.01.001');
    expect(s2.bulgular[0].voucherKey).toBeNull();
    expect(kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('cok hesapta ust sinir 20 + ozet', () => {
    const rows: ParsedEDefterFisLine[] = [];
    for (let i = 1; i <= 25; i += 1) rows.push(...hareket(`h${i}`, '2026-05-10', `340.01.${String(i).padStart(3, '0')}`, `AVANS ${i}`, 'BORC', 6_000 + i));
    const s = kuralHesapTabiatinaAykiriBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.bulgular).toHaveLength(21);
    expect(s.bulgular[20].detail?.ozet).toBe(true);
    expect(s.bulgular[0].detail?.tutar).toBe(6_025);
  });
});

describe('hesap adi bos/anlamsiz', () => {
  it('anlamsizlik olcutu', () => {
    expect(hesapAdiAnlamsizMi('', '120.01.001')).toBe(true);
    expect(hesapAdiAnlamsizMi('   ', '120.01.001')).toBe(true);
    expect(hesapAdiAnlamsizMi('---', '120.01.001')).toBe(true);
    expect(hesapAdiAnlamsizMi('120.01.001', '120.01.001')).toBe(true);
    expect(hesapAdiAnlamsizMi('120 01 001', '120.01.001')).toBe(true); // yalniz rakam
    expect(hesapAdiAnlamsizMi('120.01.001 A', '120.01.001')).toBe(false); // harf var, kodla ayni degil
    expect(hesapAdiAnlamsizMi('AND AMBALAJ', '120.01.001')).toBe(false);
    expect(hesapAdiAnlamsizMi('12', '120.01.001')).toBe(true);
  });

  it('adi bos ya da kodla ayni hesaplar → INFO; dolu adlar temiz; hesap yoksa VERI_YOK', () => {
    const rows = [
      ...hareket('a', '2026-04-10', '120.01.A001', '', 'BORC', 5_000),
      ...hareket('b', '2026-04-10', '320.01.S001', '320.01.S001', 'ALACAK', 7_000),
      ...hareket('c', '2026-04-10', '153.01.001', 'TICARI MALLAR', 'BORC', 9_000),
    ];
    const s = kuralHesapAdiBos(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular.map((x) => x.hesapKodu).sort()).toEqual(['120.01.A001', '320.01.S001']);
    const bos = s.bulgular.find((x) => x.hesapKodu === '120.01.A001')!;
    expect(bos.severity).toBe('INFO');
    expect(bos.message).toContain('adı boş');
    expect(bos.detail?.tutar).toBe(5_000);
    const ayni = s.bulgular.find((x) => x.hesapKodu === '320.01.S001')!;
    expect(ayni.message).toContain('adı anlamsız');
    const temiz = hareket('c', '2026-04-10', '153.01.001', 'TICARI MALLAR', 'BORC', 9_000);
    expect(kuralHesapAdiBos(baglamKur({ rows: temiz, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('TEMIZ');
    expect(kuralHesapAdiBos(baglamKur({ rows: [], range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });
});
