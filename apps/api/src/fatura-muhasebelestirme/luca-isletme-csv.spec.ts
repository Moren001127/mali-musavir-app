/**
 * İşletme HIZLI FİŞ CSV kodlaması (2026-09-15, AYTEKİN ÖZDEMİR bulgusu): Luca yükleme okuyucusu cp1254 Türkçe harfleri
 * "Soyadı Ünvan, özel karakter bulunduramaz!" diye reddediyordu (yalnız ASCII "Z RAPORU" geçiyordu).
 *  - varsayılan: UTF-8 (BOM'suz); LUCA_ISLETME_CSV_KODLAMA=win1254 geri dönüş; utf8bom seçeneği.
 *  - LUCA_ISLETME_UNVAN_ASCII=1 → ünvanda Türkçe harfler ASCII'ye katlanır (son çare).
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

  it('varsayılan UTF-8 (BOM yok): Ü = C3 9C, İ = C4 B0; ünvan olduğu gibi', () => {
    delete process.env.LUCA_ISLETME_CSV_KODLAMA; delete process.env.LUCA_ISLETME_UNVAN_ASCII;
    const buf = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    const metin = buf.toString('utf8');
    expect(metin.split('\r\n')[0].startsWith('İŞLEM;KATEGORİ;')).toBe(true);
    expect(metin).toContain('GÜNYER OTOMOTİV TURİZM TİCARET LİMİTED ŞİRKETİ');
    expect(buf.includes(Buffer.from('Ü', 'utf8'))).toBe(true);
  });

  it('LUCA_ISLETME_CSV_KODLAMA=win1254 → cp1254 baytları (Ü=DC, İ=DD, Ş=DE)', () => {
    process.env.LUCA_ISLETME_CSV_KODLAMA = 'win1254';
    const buf = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf.includes(Buffer.from([0x47, 0xdc, 0x4e, 0x59, 0x45, 0x52]))).toBe(true); // "GÜNYER" cp1254
    expect(buf.includes(Buffer.from('Ü', 'utf8'))).toBe(false);
  });

  it('utf8bom → başta BOM; ASCII katlama açıkken ünvan İ→I Ş→S Ü→U', () => {
    process.env.LUCA_ISLETME_CSV_KODLAMA = 'utf8bom';
    process.env.LUCA_ISLETME_UNVAN_ASCII = '1';
    const buf = buildLucaIsletmeHizliFisCsv(payload());
    expect(buf.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(buf.toString('utf8')).toContain('GUNYER OTOMOTIV TURIZM TICARET LIMITED SIRKETI');
    expect(isletmeUnvanDuzelt('ESENYURT PETROL VE TİC.A.Ş')).toBe('ESENYURT PETROL VE TIC.A.S');
  });
});
