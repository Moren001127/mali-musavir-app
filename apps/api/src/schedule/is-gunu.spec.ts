import { ilkIsGunu, isGunuMu, isoGun, resmiTatilMi } from './is-gunu';

const g = (s: string, saat = 23) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, saat, 59, 59);
};

describe('is-gunu — hafta sonu / resmî tatil kayması', () => {
  it('iş günü aynı kalır (28 Ağustos 2026 Cuma)', () => {
    expect(isoGun(ilkIsGunu(g('2026-08-28')))).toBe('2026-08-28');
    expect(isGunuMu(g('2026-08-28'))).toBe(true);
  });

  it('Cumartesi → Pazartesi, Pazar → Pazartesi', () => {
    expect(isoGun(ilkIsGunu(g('2026-09-26')))).toBe('2026-09-28'); // 26 Eylül 2026 Cumartesi
    expect(isoGun(ilkIsGunu(g('2026-09-27')))).toBe('2026-09-28'); // Pazar
  });

  it('30 Ağustos 2026 (Pazar + Zafer Bayramı) → 31 Ağustos Pazartesi', () => {
    expect(resmiTatilMi(g('2026-08-30'))).toBe(true);
    expect(isoGun(ilkIsGunu(g('2026-08-30')))).toBe('2026-08-31');
  });

  it('15 Temmuz 2026 Çarşamba resmî tatil → 16 Temmuz', () => {
    expect(isoGun(ilkIsGunu(g('2026-07-15')))).toBe('2026-07-16');
  });

  it('Kurban Bayramı 2026 (27-30 Mayıs) + 31 Mayıs Pazar → 1 Haziran', () => {
    expect(isoGun(ilkIsGunu(g('2026-05-27')))).toBe('2026-06-01');
    expect(isoGun(ilkIsGunu(g('2026-05-30')))).toBe('2026-06-01');
  });

  it('Ramazan 2026: arife 19 Mart tam gün SAYILMAZ, 20 Mart bayram → 23 Mart Pazartesi', () => {
    expect(isGunuMu(g('2026-03-19'))).toBe(true);
    expect(isoGun(ilkIsGunu(g('2026-03-20')))).toBe('2026-03-23');
  });

  it('2027 dini bayramlar tabloda: 9 Mart 2027 → 12 Mart; 16 Mayıs 2027 → 20 Mayıs', () => {
    expect(isoGun(ilkIsGunu(g('2027-03-09')))).toBe('2027-03-12');
    expect(isoGun(ilkIsGunu(g('2027-05-16')))).toBe('2027-05-20'); // 19 Mayıs da tatil
  });

  it('günün saati korunur, kaynak nesne değişmez', () => {
    const kaynak = g('2026-08-30', 23);
    const sonuc = ilkIsGunu(kaynak);
    expect(sonuc.getHours()).toBe(23);
    expect(isoGun(kaynak)).toBe('2026-08-30');
  });
});
