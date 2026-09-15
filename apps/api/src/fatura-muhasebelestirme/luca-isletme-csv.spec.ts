/**
 * İşletme HIZLI FİŞ CSV kodlaması (2026-09-15, AYTEKİN ÖZDEMİR bulgusu): Luca okuyucusu cp1254 (UTF-8 gönderince KATEGORİ
 * "Defter Fişleri" eşleşmedi); "Soyadı Ünvan" denetimi Türkçe harfi "özel karakter" sayıyor (yalnız ASCII "Z RAPORU" geçiyordu).
 *  - varsayılan: cp1254 + ünvanda Türkçe harf katlama ('1'); 'I' yalnız İ→I; '2' noktalama da boşluğa; '0' kapalı.
 *  - LUCA_ISLETME_CSV_KODLAMA=utf8|utf8bom seçenekleri (geri dönüş / deneme).
 */
import { buildLucaIsletmeHizliFisCsv, isletmeUnvanDuzelt } from './luca-excel.service';

const payload = (): any => ({
  mode: 'BATCH_EXCEL', taxpayerId: 't1', period: '2026-08', totalCount: 1, defterTuru: 'ISLETME', direction: 'ALIS', format: 'ISLETME_CSV',
  invoices: [{
    documentId: 'd1', documentType: 'E_FATURA', invoiceKind: 'ALIS', belgeNo: 'GIB2026000000015', faturaTarihi: '2026-08-31',
    sellerVkn: '4380376614', vendorName: 'GÜNYER OTOMOTİV TURİZM TİCARET LİMİTED ŞİRKETİ', totalAmount: '60500',
    lines: [
      { group: 'matrah', accountCode: '', description: 'x', rate: '20', debit: '55000', credit: '0', orderNo: 0 },
      { group: 'vergi', accountCode: '', description: 'kdv', rate: '20', debit: '5500', credit: '0', orderNo: 1 },
    ],
  }],
});

describe('İşletme HIZLI FİŞ CSV — kodlama', () => {
  const eski = { k: process.env.LUCA_ISLETME_CSV_KODLAMA, a: process.env.LUCA_ISLETME_UNVAN_ASCII };
  afterEach(() => {
    if (eski.k === undefined) delete process.env.LUCA_ISLETME_CSV_KODLAMA; else process.env.LUCA_ISLETME_CSV_KODLAMA = eski.k;
    if (eski.a === undefined) delete process.env.LUCA_ISLETME_UNVAN_ASCII; else process.env.LUCA_ISLETME_UNVAN_ASCII = eski.a;
  });

  it('varsayılan: cp1254 başlık (KATEGORİ "Defter Fişleri" Luca ile eşleşsin) + ünvan ASCII (GUNYER OTOMOTIV…)', () => {
    delete process.env.LUCA_ISLETME_CSV_KODLAMA; delete process.env.LUCA_ISLETME_UNVAN_ASCII;
    const buf = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(buf.includes(Buffer.from([0xdd, 0xde, 0x4c, 0x45, 0x4d, 0x3b]))).toBe(true); // "İŞLEM;" cp1254
    expect(buf.includes(Buffer.from('GUNYER OTOMOTIV TURIZM TICARET LIMITED SIRKETI', 'ascii'))).toBe(true);
    expect(buf.includes(Buffer.from('Ü', 'utf8'))).toBe(false);
  });

  it("LUCA_ISLETME_UNVAN_ASCII='I' → yalnız İ→I; '0' → dokunma; '2' → noktalama da boşluğa", () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = 'I';
    expect(isletmeUnvanDuzelt('GÜNYER OTOMOTİV ŞİRKETİ')).toBe('GÜNYER OTOMOTIV ŞIRKETI');
    process.env.LUCA_ISLETME_UNVAN_ASCII = '0';
    expect(isletmeUnvanDuzelt('GÜNYER OTOMOTİV')).toBe('GÜNYER OTOMOTİV');
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    expect(isletmeUnvanDuzelt('ESENYURT PETROL VE TİC.A.Ş')).toBe('ESENYURT PETROL VE TIC A S');
  });

  it('LUCA_ISLETME_CSV_KODLAMA=utf8 → UTF-8 baytları; utf8bom → başta BOM', () => {
    process.env.LUCA_ISLETME_CSV_KODLAMA = 'utf8';
    process.env.LUCA_ISLETME_UNVAN_ASCII = '0';
    const buf = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf.toString('utf8').split('\r\n')[0].startsWith('İŞLEM;KATEGORİ;')).toBe(true);
    expect(buf.includes(Buffer.from('Ü', 'utf8'))).toBe(true);
    process.env.LUCA_ISLETME_CSV_KODLAMA = 'utf8bom';
    const buf2 = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf2.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
  });
});
