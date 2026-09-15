/**
 * İADE FATURASI YÖN KURALI (2026-09-15, Muzaffer Bey: "biz kesiyorsak ALIŞTAN iade; borç/alacak yanlış").
 *  - Giden iade (SATIS, mükellef kesti) = alıştan iade: 320 BORÇ, stok/gider ALACAK, 391-iade ALACAK (satış fişiyle aynı yönler).
 *  - Gelen iade (ALIS) = satıştan iade: 610 BORÇ, 191-iade BORÇ, 120 ALACAK (alış fişiyle aynı yönler).
 *  - Nihai tüketiciye e-Arşiv iade (SATIS + 'satistan'): satış yönleri TAKAS (610 BORÇ, 391 BORÇ, 120 ALACAK).
 * Canlı: SN22026000000267 610 ALACAK / cari BORÇ, GIB2026000000463 153 BORÇ / 120 ALACAK çıkıyordu (eski "her iadede takas").
 */
jest.mock('./fatura-muhasebelestirme.service', () => jest.requireActual('./fatura-muhasebelestirme.service'));
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

const svc: any = Object.create(FaturaMuhasebelestirmeService.prototype);
svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
const n = (v: any) => Number(v?.toString?.() ?? v);
const satir = (lines: any[], group: string) => lines.find((l) => l.group === group);

describe('linesFromAmounts — iade yönleri', () => {
  const ortak = { matrah: 1000, kdvTutari: 200, kdvOrani: 20, total: 1200, kdvBreakdown: [{ rate: 20, base: 1000, amount: 200 }] };

  it('giden iade (SATIS, alıştan): cari 320 BORÇ, matrah ALACAK, KDV ALACAK; açıklama "Alıştan iade" + "Hesaplanan KDV — İADE"', () => {
    const lines = svc.linesFromAmounts({ invoiceKind: 'SATIS', vendorName: 'ÖZTİRYAKİLER', isReturn: true, ...ortak });
    const c = satir(lines, 'cari'), m = satir(lines, 'matrah'), v = satir(lines, 'vergi');
    expect(c.accountCode).toBe('320.01.001');
    expect([n(c.debit), n(c.credit)]).toEqual([1200, 0]);
    expect([n(m.debit), n(m.credit)]).toEqual([0, 1000]);
    expect([n(v.debit), n(v.credit)]).toEqual([0, 200]);
    expect(m.description).toBe('Alıştan iade');
    expect(v.description).toMatch(/Hesaplanan KDV — İADE/);
    expect(m.accountCode).not.toMatch(/^60/); // ciro hesabı değil, alış yer-tutucusu
  });

  it('gelen iade (ALIS, satıştan): matrah BORÇ, KDV BORÇ, cari ALACAK; açıklama "Satıştan iade" + "İndirilecek KDV — İADE"', () => {
    const lines = svc.linesFromAmounts({ invoiceKind: 'ALIS', vendorName: 'ŞENNİK', isReturn: true, ...ortak });
    const c = satir(lines, 'cari'), m = satir(lines, 'matrah'), v = satir(lines, 'vergi');
    expect([n(c.debit), n(c.credit)]).toEqual([0, 1200]);
    expect([n(m.debit), n(m.credit)]).toEqual([1000, 0]);
    expect([n(v.debit), n(v.credit)]).toEqual([200, 0]);
    expect(m.description).toBe('Satıştan iade');
    expect(v.description).toMatch(/İndirilecek KDV — İADE/);
  });

  it("nihai tüketiciye e-Arşiv iade (SATIS + iadeTuru 'satistan'): satış yönleri takas — cari 120 ALACAK, matrah/KDV BORÇ", () => {
    const lines = svc.linesFromAmounts({ invoiceKind: 'SATIS', vendorName: 'AHMET', isReturn: true, iadeTuru: 'satistan', ...ortak });
    const c = satir(lines, 'cari'), m = satir(lines, 'matrah'), v = satir(lines, 'vergi');
    expect(c.accountCode).toBe('120.01.001');
    expect([n(c.debit), n(c.credit)]).toEqual([0, 1200]);
    expect([n(m.debit), n(m.credit)]).toEqual([1000, 0]);
    expect([n(v.debit), n(v.credit)]).toEqual([200, 0]);
    expect(m.description).toBe('Satıştan iade');
  });

  it('iade değilse yönler ve açıklamalar değişmez', () => {
    const lines = svc.linesFromAmounts({ invoiceKind: 'SATIS', vendorName: 'MÜŞTERİ', ...ortak });
    const c = satir(lines, 'cari'), m = satir(lines, 'matrah');
    expect([n(c.debit), n(c.credit)]).toEqual([1200, 0]);
    expect([n(m.debit), n(m.credit)]).toEqual([0, 1000]);
    expect(m.description).not.toMatch(/iade/i);
  });
});

describe('iadeTuruSaf', () => {
  it('iade değil → null; gelen iade → satistan; giden iade VKN → alistan; giden iade TCKN alış geçmişi yok → satistan, var → alistan; kayıtlı tür esas', () => {
    expect(svc.iadeTuruSaf('SATIS', { isReturn: false }, '1234567890', false)).toBeNull();
    expect(svc.iadeTuruSaf('ALIS', { isReturn: true }, '1234567890', false)).toBe('satistan');
    expect(svc.iadeTuruSaf('SATIS', { isReturn: true }, '7080013433', false)).toBe('alistan');
    expect(svc.iadeTuruSaf('SATIS', { isReturn: true }, '12345678901', false)).toBe('satistan');
    expect(svc.iadeTuruSaf('SATIS', { isReturn: true }, '12345678901', true)).toBe('alistan');
    expect(svc.iadeTuruSaf('SATIS', { isReturn: true, iadeTuru: 'satistan' }, '7080013433', true)).toBe('satistan');
  });
});
