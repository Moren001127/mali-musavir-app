import type { ParsedEDefterFisLine } from '../../edefter-fis-listesi-parser.service';
import { baglamKur } from '../istatistik';
import { Q2, bankaOdeme, bordroFisi, d, kdvTahakkuk, mizan, satir } from './test-yardimcilari';
import {
  kuralBordroNetBrutOrani,
  kuralBordroSgkOrani,
  kuralGeciciVergiKarsilik,
  kuralPersonel335OdemeYok,
  kuralPersonelOdemeKasadan,
  kuralSgk361OdemeYok,
  kuralVergi360OdemeYok,
  kuralVergiSgkDevredenBorc,
  kuralVergiSgkTersBakiye,
  kuralVergiSgkTutarUyumsuz,
} from './vergi-sgk-personel';

describe('vergi / SGK / personel odeme dongusu', () => {
  it('normal dongu: her ay tahakkuk, izleyen ay odeme → temiz', () => {
    const rows = [
      ...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000),
      ...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV', 20_000),
      ...kdvTahakkuk('k5', '2026-05-31', 40_000, 35_000),
      ...bankaOdeme('o6', '2026-06-26', '360.01.001', 'ODENECEK KDV', 5_000),
      ...kdvTahakkuk('k6', '2026-06-30', 60_000, 20_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralVergi360OdemeYok(b).durum).toBe('TEMIZ');
    expect(kuralVergiSgkTutarUyumsuz(b).durum).toBe('TEMIZ');
    expect(kuralVergiSgkTersBakiye(b).durum).toBe('TEMIZ');
  });

  it('tahakkuk ve odeme ayni gun ayni fiste (beyanname gunu) → temiz', () => {
    const rows: ParsedEDefterFisLine[] = [
      ...kdvTahakkuk('k4', '2026-05-26', 50_000, 30_000),
      ...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV', 20_000),
      ...kdvTahakkuk('k5', '2026-06-26', 40_000, 35_000),
      ...bankaOdeme('o6', '2026-06-26', '360.01.001', 'ODENECEK KDV', 5_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralVergi360OdemeYok(b).durum).toBe('TEMIZ');
  });

  it('hic odeme yok (YORGUN kalibi): 360 iki ay ust uste → ERROR; son ay sayilmaz; tesvik borcu odeme sayilmaz', () => {
    const rows = [
      ...bordroFisi('b4', '2026-04-30'),
      ...bordroFisi('b5', '2026-05-31'),
      ...bordroFisi('b6', '2026-06-30'),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const sgk = kuralSgk361OdemeYok(b);
    expect(sgk.durum).toBe('BULGU');
    expect(sgk.bulgular[0].severity).toBe('ERROR');
    expect(sgk.bulgular[0].message).toContain('Nisan 2026 tahakkuku 25.000,00 TL');
    expect(sgk.bulgular[0].message).toContain('Mayıs 2026 tahakkuku 25.000,00 TL');
    expect(sgk.bulgular[0].message).toContain('2 ay üst üste');
    expect(sgk.bulgular[0].message).toContain('Haziran 2026 tahakkuku (25.000,00 TL) sonraki dönemde');
    expect(sgk.bulgular[0].message).toContain('5510');
    const gv = kuralVergi360OdemeYok(b);
    expect(gv.durum).toBe('BULGU');
    expect(gv.bulgular[0].severity).toBe('ERROR');
    const net = kuralPersonel335OdemeYok(b);
    expect(net.durum).toBe('BULGU');
    expect(net.bulgular[0].severity).toBe('WARN'); // ucret her zaman WARN
    // tesvik borcu odeme sayilmadi → ters bakiye yok
    expect(kuralVergiSgkTersBakiye(b).durum).toBe('TEMIZ');
  });

  it('bordro odemeleri bankadan yapilmis → 335 temiz; tek ay odenmemis → WARN', () => {
    const rows = [
      ...bordroFisi('b4', '2026-04-30'),
      ...bankaOdeme('m5', '2026-05-05', '335.01.001', 'PERSONELE BORCLAR', 70_000),
      ...bordroFisi('b5', '2026-05-31'),
      // Mayis ucreti odenmemis
      ...bordroFisi('b6', '2026-06-30'),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    const s = kuralPersonel335OdemeYok(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].severity).toBe('WARN');
    expect(s.bulgular[0].message).toContain('Mayıs 2026 tahakkuku');
    expect(s.bulgular[0].message).not.toContain('Nisan 2026 tahakkuku');
  });

  it('kismi odeme → VERGI_SGK_ODEME_TUTAR_UYUMSUZ (INFO), odenmemis degil', () => {
    const rows = [
      ...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000), // 20.000 tahakkuk
      ...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV', 15_000),
      ...kdvTahakkuk('k5', '2026-05-31', 40_000, 35_000),
      ...bankaOdeme('o6', '2026-06-26', '360.01.001', 'ODENECEK KDV', 5_000),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralVergi360OdemeYok(b).durum).toBe('TEMIZ');
    const u = kuralVergiSgkTutarUyumsuz(b);
    expect(u.durum).toBe('BULGU');
    expect(u.bulgular[0].message).toContain('Nisan 2026 tahakkuku 20.000,00 TL, ödenmeyen 5.000,00 TL');
  });

  it('cok kayitli tahakkuk (21 tevkifat satiri) tek odeme ile kapanir', () => {
    const rows: ParsedEDefterFisLine[] = [];
    let toplam = 0;
    for (let i = 0; i < 21; i += 1) {
      const t = 1_000 + i * 10;
      toplam += t;
      rows.push(satir({ voucherKey: `a${i}`, fisTarihi: d('2026-04-10'), hesapKodu: '153.01.001', hesapAdi: 'MAL', borc: t * 5 }));
      rows.push(satir({ voucherKey: `a${i}`, fisTarihi: d('2026-04-10'), hesapKodu: '191.01.001', hesapAdi: 'KDV', borc: t }));
      rows.push(satir({ voucherKey: `a${i}`, fisTarihi: d('2026-04-10'), hesapKodu: '360.01.001', hesapAdi: 'ODENECEK KDV 2', alacak: t }));
      rows.push(satir({ voucherKey: `a${i}`, fisTarihi: d('2026-04-10'), hesapKodu: '320.01.X001', hesapAdi: 'SATICI', alacak: t * 5 }));
    }
    rows.push(...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV 2', toplam));
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralVergi360OdemeYok(b).durum).toBe('TEMIZ');
    expect(kuralVergiSgkTutarUyumsuz(b).durum).toBe('TEMIZ');
  });

  it('Mizan acilis borcu donem boyunca odenmemis → DEVREDEN_BORC; Mizan yoksa VERI_YOK', () => {
    const rows = [
      ...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000),
      ...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV', 20_000),
      ...kdvTahakkuk('k5', '2026-05-31', 40_000, 35_000),
      ...bankaOdeme('o6', '2026-06-26', '360.01.001', 'ODENECEK KDV', 5_000),
    ];
    // Mizan kapanis: alacak 25.000 + acilis 80.000 = 105.000 alacak → -105.000 ; donem net = 25.000-25.000-... (tahakkuk 25.000+... )
    // donem hareketi net = borc 25.000 − alacak (20.000+5.000+? ) → kdvTahakkuk k4 alacak 20.000, k5 alacak 5.000 → net 0 ; acilis = kapanis − 0 = −80.000
    const mz = mizan({ '360.01.001': -80_000 });
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz });
    const s = kuralVergiSgkDevredenBorc(b);
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('80.000,00 TL borcun 80.000,00 TL');
    expect(kuralVergiSgkDevredenBorc(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' })).durum).toBe('VERI_YOK');
  });

  it('odeme tahakkuku asiyor → ters bakiye (Mizan ile kesin)', () => {
    const rows = [
      ...kdvTahakkuk('k4', '2026-04-30', 50_000, 30_000),
      ...bankaOdeme('o5', '2026-05-26', '360.01.001', 'ODENECEK KDV', 35_000),
    ];
    const mz = mizan({ '360.01.001': 15_000 }); // borc bakiye
    const s = kuralVergiSgkTersBakiye(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('kapanış 15.000,00 TL BORÇ');
  });

  it('ucret kasadan odenmis → bilgi; bordro oranlari makul → temiz, anormal → bulgu', () => {
    const rows = [
      ...bordroFisi('b4', '2026-04-30'),
      satir({ voucherKey: 'kasa', fisTarihi: d('2026-05-03'), hesapKodu: '335.01.001', hesapAdi: 'PERSONELE BORCLAR', borc: 70_000 }),
      satir({ voucherKey: 'kasa', fisTarihi: d('2026-05-03'), hesapKodu: '100.01.001', hesapAdi: 'KASA', alacak: 70_000 }),
    ];
    const b = baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralPersonelOdemeKasadan(b).durum).toBe('BULGU');
    expect(kuralBordroNetBrutOrani(b).durum).toBe('TEMIZ');
    expect(kuralBordroSgkOrani(b).durum).toBe('TEMIZ');
    const anormal = baglamKur({ rows: bordroFisi('x', '2026-04-30', 100_000, 20_000, 2_000, 1_000, 0), range: Q2, donemTipi: 'GECICI_Q2' });
    expect(kuralBordroNetBrutOrani(anormal).durum).toBe('BULGU');
    expect(kuralBordroSgkOrani(anormal).durum).toBe('BULGU');
  });

  it('gecici vergi karsiligi: kar var, 370 yok → bilgi; yillikte uygulanmaz', () => {
    const rows = [...kdvTahakkuk('k6', '2026-06-30', 10_000, 5_000)];
    const mz = mizan({ '600.01.001': -500_000, '621.01.001': 300_000, '770.01.001': 50_000, '771.01.001': -50_000, '632.01.001': 50_000 });
    const s = kuralGeciciVergiKarsilik(baglamKur({ rows, range: Q2, donemTipi: 'GECICI_Q2', mizan: mz }));
    expect(s.durum).toBe('BULGU');
    expect(s.bulgular[0].message).toContain('150.000,00');
    expect(kuralGeciciVergiKarsilik(baglamKur({ rows, range: { start: d('2026-01-01'), end: d('2026-12-31') }, donemTipi: 'YILLIK', mizan: mz })).durum).toBe('UYGULANMAZ');
  });
});
