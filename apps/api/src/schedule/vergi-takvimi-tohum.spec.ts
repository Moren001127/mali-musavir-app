import { vergiTakvimiKayitlari, takvimAnahtari } from './vergi-takvimi-tohum';
import { VergiTakvimiTohumService } from './vergi-takvimi-tohum.service';

const gun = (d: Date) => new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10); // İstanbul günü
const bulucu = (kayitlar: any[]) => (tip: string, y: number, m: number | null, q: number | null) =>
  kayitlar.find((k) => takvimAnahtari(k) === takvimAnahtari({ declarationType: tip, periodYear: y, periodMonth: m, periodQuarter: q }));

describe('vergiTakvimiKayitlari', () => {
  const kayitlar = vergiTakvimiKayitlari(new Date('2026-09-01T00:00:00+03:00'), new Date('2026-12-31T23:59:59+03:00'));
  const bul = bulucu(kayitlar);

  it('aylık KDV1 28, MUHSGK 26 — izleyen ay', () => {
    expect(gun(bul('KDV1', 2026, 8, null)!.dueDate)).toBe('2026-09-28');
    expect(gun(bul('MUHSGK', 2026, 8, null)!.dueDate)).toBe('2026-09-26');
    expect(gun(bul('KDV1', 2026, 11, null)!.dueDate)).toBe('2026-12-28');
    expect(bul('KDV1', 2026, 7, null)).toBeUndefined(); // 28 Ağustos aralık dışı
  });

  it('3 aylık: MUHSGK Q3 → 26 Ekim; geçici vergi Q3 → 17 Kasım (canlı beyan kayıtlarıyla uyumlu)', () => {
    expect(gun(bul('MUHSGK', 2026, null, 3)!.dueDate)).toBe('2026-10-26');
    expect(gun(bul('GGECICI', 2026, null, 3)!.dueDate)).toBe('2026-11-17');
    expect(gun(bul('KGECICI', 2026, null, 3)!.dueDate)).toBe('2026-11-17');
    expect(bul('GGECICI', 2026, null, 2)).toBeUndefined(); // 17 Ağustos aralık dışı
  });

  it('Q4 → izleyen yıl 17 Şubat; yıllık GELİR 31 Mart, KURUMLAR 30 Nisan', () => {
    const b = bulucu(vergiTakvimiKayitlari(new Date('2027-01-01T00:00:00+03:00'), new Date('2027-05-31T23:59:59+03:00')));
    expect(gun(b('GGECICI', 2026, null, 4)!.dueDate)).toBe('2027-02-17');
    expect(gun(b('MUHSGK', 2026, null, 4)!.dueDate)).toBe('2027-01-26');
    expect(gun(b('GELIR', 2026, null, null)!.dueDate)).toBe('2027-03-31');
    expect(gun(b('KURUMLAR', 2026, null, null)!.dueDate)).toBe('2027-04-30');
    expect(gun(b('KDV1', 2026, 12, null)!.dueDate)).toBe('2027-01-28');
  });

  it('sıralı, tekil anahtarlı, açıklamalı; Eylül–Aralık 2026 = 11 kayıt', () => {
    const anahtarlar = kayitlar.map(takvimAnahtari);
    expect(new Set(anahtarlar).size).toBe(anahtarlar.length);
    for (let i = 1; i < kayitlar.length; i++) expect(kayitlar[i].dueDate.getTime()).toBeGreaterThanOrEqual(kayitlar[i - 1].dueDate.getTime());
    expect(kayitlar.every((k) => k.description && k.description.length > 5)).toBe(true);
    // 4 KDV1 + 4 MUHSGK aylık + MUHSGK Q3 + GGECICI Q3 + KGECICI Q3
    expect(kayitlar).toHaveLength(11);
  });
});

describe('VergiTakvimiTohumService.tohumla', () => {
  function kur(mevcut: any[]) {
    const eklenen: any[] = [];
    const db: any = {
      taxCalendar: {
        findMany: async () => mevcut,
        createMany: async (q: any) => { eklenen.push(...q.data); return { count: q.data.length }; },
      },
    };
    const svc = new VergiTakvimiTohumService(db);
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, eklenen };
  }

  it('boş tabloya 15 ay ileriye kadar ekler; var olanları atlar (elle düzeltilen tarih korunur)', async () => {
    const simdi = new Date('2026-09-14T10:00:00+03:00');
    const { svc, eklenen } = kur([]);
    const n = await svc.tohumla(simdi);
    expect(n).toBeGreaterThan(40);
    expect(eklenen.every((k) => k.dueDate >= new Date('2026-09-01T00:00:00+03:00'))).toBe(true);
    expect(eklenen.some((k) => k.declarationType === 'GELIR' && k.periodYear === 2026)).toBe(true); // 31 Mart 2027 ufuk içinde
    expect(eklenen.some((k) => k.declarationType === 'KDV2')).toBe(false);

    // ikinci koşu: hepsi mevcut → 0
    const { svc: svc2, eklenen: e2 } = kur(eklenen.map((k) => ({ declarationType: k.declarationType, periodYear: k.periodYear, periodMonth: k.periodMonth, periodQuarter: k.periodQuarter })));
    expect(await svc2.tohumla(simdi)).toBe(0);
    expect(e2).toHaveLength(0);
  });
});
