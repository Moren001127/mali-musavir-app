import { sonrakiTekrar, uretilecekGunler, tekrarMetni, gunYap, gunAnahtari, istanbulGunu } from './gorev-tekrar';

const g = (s: string) => { const [y, m, d] = s.split('-').map(Number); return gunYap(y, m, d); };
const k = (t: Date | null) => (t ? gunAnahtari(t) : null);

describe('gorev-tekrar — sonrakiTekrar', () => {
  it('günlük: aralık kadar gün ekler', () => {
    expect(k(sonrakiTekrar({ type: 'DAILY' }, g('2026-09-14')))).toBe('2026-09-15');
    expect(k(sonrakiTekrar({ type: 'DAILY', interval: 3 }, g('2026-09-14')))).toBe('2026-09-17');
  });

  it('haftalık: seçili günlerden sonraki ilk gün; aynı hafta önce', () => {
    // 14 Eylül 2026 Pazartesi; Salı(2) + Perşembe(4)
    expect(k(sonrakiTekrar({ type: 'WEEKLY', weekdays: [2, 4] }, g('2026-09-14')))).toBe('2026-09-15');
    expect(k(sonrakiTekrar({ type: 'WEEKLY', weekdays: [2, 4] }, g('2026-09-15')))).toBe('2026-09-17');
    expect(k(sonrakiTekrar({ type: 'WEEKLY', weekdays: [2, 4] }, g('2026-09-17')))).toBe('2026-09-22');
    // gün seçilmemişse aynı haftaiçi günü, 1 hafta sonra
    expect(k(sonrakiTekrar({ type: 'WEEKLY' }, g('2026-09-14')))).toBe('2026-09-21');
  });

  it('haftalık aralık 2: bir sonraki uygun hafta', () => {
    // Pazartesi(1) her 2 haftada: 14 Eyl → 28 Eyl
    expect(k(sonrakiTekrar({ type: 'WEEKLY', weekdays: [1], interval: 2 }, g('2026-09-14')))).toBe('2026-09-28');
  });

  it("aylık: ayın N'i; ayın son günü (-1); 31 → kısa ay son günü", () => {
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: 20 }, g('2026-09-14')))).toBe('2026-09-20');
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: 20 }, g('2026-09-20')))).toBe('2026-10-20');
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: -1 }, g('2026-09-14')))).toBe('2026-09-30');
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: 31 }, g('2026-09-30')))).toBe('2026-10-31');
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: 31 }, g('2026-10-31')))).toBe('2026-11-30');
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthDay: 15, interval: 3 }, g('2026-09-15')))).toBe('2026-12-15');
  });

  it('aylık: N. haftaiçi günü (ikinci Salı, son Cuma)', () => {
    // Eylül 2026: Salılar 1,8,15,22,29 → ikinci Salı 8 Eylül (14'ten önce) → Ekim ikinci Salı 13 Ekim
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthOrdinal: 'SECOND', monthOrdinalDay: 2 }, g('2026-09-14')))).toBe('2026-10-13');
    // Eylül 2026 son Cuma: 25 Eylül
    expect(k(sonrakiTekrar({ type: 'MONTHLY', monthOrdinal: 'LAST', monthOrdinalDay: 5 }, g('2026-09-14')))).toBe('2026-09-25');
  });

  it('yıllık: ay/gün; 29 Şubat artık yıl olmayan yılda 28', () => {
    expect(k(sonrakiTekrar({ type: 'YEARLY', yearMonth: 4, yearDay: 1 }, g('2026-09-14')))).toBe('2027-04-01');
    expect(k(sonrakiTekrar({ type: 'YEARLY', yearMonth: 2, yearDay: 29 }, g('2026-01-10')))).toBe('2026-02-28');
  });

  it('bitiş tarihi geçilirse null; NONE/boş null', () => {
    expect(sonrakiTekrar({ type: 'DAILY', endDate: '2026-09-14' }, g('2026-09-14'))).toBeNull();
    expect(sonrakiTekrar({ type: 'NONE' }, g('2026-09-14'))).toBeNull();
    expect(sonrakiTekrar(null, g('2026-09-14'))).toBeNull();
  });
});

describe('gorev-tekrar — uretilecekGunler', () => {
  it('ufuk içinde kalan günleri sırayla üretir; count tavanına uyar', () => {
    const gunler = uretilecekGunler({ type: 'DAILY', interval: 5 }, g('2026-09-10'), g('2026-09-14'), 14).map(gunAnahtari);
    expect(gunler).toEqual(['2026-09-15', '2026-09-20', '2026-09-25']);
    const sinirli = uretilecekGunler({ type: 'DAILY', count: 3 }, g('2026-09-14'), g('2026-09-14'), 14, 12, 2).map(gunAnahtari);
    expect(sinirli).toEqual(['2026-09-15']); // 2 üretilmiş, tavan 3 → 1 tane daha
  });

  it('istanbulGunu: UTC gece 22:30 = İstanbul ertesi gün', () => {
    expect(gunAnahtari(istanbulGunu(new Date('2026-09-14T22:30:00Z')))).toBe('2026-09-15');
    expect(gunAnahtari(istanbulGunu(new Date('2026-09-14T20:30:00Z')))).toBe('2026-09-14');
  });
});

describe('gorev-tekrar — tekrarMetni', () => {
  it('Türkçe okunur metin', () => {
    expect(tekrarMetni({ type: 'WEEKLY', weekdays: [1, 5] })).toBe('Her hafta (Pazartesi, Cuma)');
    expect(tekrarMetni({ type: 'MONTHLY', monthDay: -1 })).toBe('Her ay — ayın son günü');
    expect(tekrarMetni({ type: 'MONTHLY', monthOrdinal: 'SECOND', monthOrdinalDay: 2, interval: 2 })).toBe('2 ayda bir — ikinci Salı');
    expect(tekrarMetni({ type: 'YEARLY', yearMonth: 4, yearDay: 1 })).toBe('Her yıl — 1 Nisan');
    expect(tekrarMetni(null)).toBe('Tekrar yok');
  });
});
