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

describe('İşletme HIZLI FİŞ CSV — Luca fiş türü ve tevkifatlı satış sütunları (2026-09-15)', () => {
  const hucreler = (buf: Buffer) => require('iconv-lite').decode(buf, 'win1254').split('\r\n')[1].split(';');
  const gider = (kayitTuruKod: string, kayitTuruAd: string): any => ({
    ...payload(),
    invoices: [{ ...payload().invoices[0], isletme: { belgeTuruKod: '10', belgeTuruAd: 'e-Arşiv Fatura', kayitTuruKod, kayitTuruAd, kayitAltKod: '113', kayitAltAd: 'Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)', kdvOranKod: 'KDV20' } }],
  });

  it('gider: İndirilecek Giderler → BELGE TURU "Diğer Alışlar"; Mal Alışı → "Alış"', () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    expect(hucreler(buildLucaIsletmeHizliFisCsv(gider('4', 'İndirilecek Giderler (GVK Md. 40)')))[2]).toBe('Diğer Alışlar');
    expect(hucreler(buildLucaIsletmeHizliFisCsv(gider('1', 'Mal Alışı')))[2]).toBe('Alış');
  });

  it('tevkifatlı satış (5/10, kod 614): KDV İSTİSNASI Tablo 2, KOD 614, ALIŞ/SATIŞ TÜRÜ Kısmi Tevkifat, TEVKİFAT 5/10; normal satışta boş', () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    const satis: any = { ...payload(), direction: 'SATIS', invoices: [{ ...payload().invoices[0], invoiceKind: 'SATIS', buyerVkn: '9980839672', customerName: 'ZİRVE ULUSAL İSTİHDAM', vendorName: null,
      isletme: { belgeTuruKod: '8', belgeTuruAd: 'e-Arşiv Fatura', kayitTuruKod: '2', kayitTuruAd: 'Hizmet Satışı', kayitAltKod: '2', kayitAltAd: 'Hizmet Satışı', kdvOranKod: 'KDV20', tevkifatOrani: '5/10', tevkifatKodu: '614' },
      lines: [{ group: 'matrah', description: 'x', rate: '20', debit: '0', credit: '50416.67', orderNo: 0 }, { group: 'vergi', description: 'kdv', rate: '20', debit: '0', credit: '5041.67', orderNo: 1 }] }] };
    const h = hucreler(buildLucaIsletmeHizliFisCsv(satis));
    expect(h[2]).toBe('Satış');
    expect(h[13]).toBe('Tablo 2(KISMİ TEVKİFAT UYGULANAN İŞLEMLER)');
    expect(h[14]).toBe('614');
    expect(h[16]).toBe('Kısmi Tevkifat Uygulanan İşlemler');
    expect(h[23]).toBe('5/10');
    const normal: any = { ...satis, invoices: [{ ...satis.invoices[0], isletme: { ...satis.invoices[0].isletme, tevkifatOrani: '', tevkifatKodu: '' } }] };
    const n = hucreler(buildLucaIsletmeHizliFisCsv(normal));
    // 2026-09-23 (045e14b): normal satışta da KDV İSTİSNASI Tablo 1 + KOD 1100 dolu gider (eskiden boştu — test o günkü hâlde kalmıştı).
    expect([n[13], n[14], n[16], n[23]]).toEqual(['Tablo 1(TEVKİFAT UYGULANMAYAN İŞLEMLER)', '1100', 'Normal Satışlar', '']);
  });
});

describe('lucaVergiDairesiAdi — Luca çekirdek vergi dairesi adı (2026-09-23)', () => {
  const { lucaVergiDairesiAdi } = require('./luca-excel.service');
  it('GİB uzun adı, UBL kısaltmaları ve il eki → çekirdek ad, Türkçe büyük harf', () => {
    expect(lucaVergiDairesiAdi('BEYLİKDÜZÜ VERGİ DAİRESİ MÜD.')).toBe('BEYLİKDÜZÜ');
    expect(lucaVergiDairesiAdi('KAĞITHANE V.D.')).toBe('KAĞITHANE');
    expect(lucaVergiDairesiAdi('Boğaziçi Kurumlar V.D.')).toBe('BOĞAZİÇİ KURUMLAR');
    expect(lucaVergiDairesiAdi('ESENYURT VERGİ DAİRESİ MÜDÜRLÜĞÜ - İSTANBUL')).toBe('ESENYURT');
    expect(lucaVergiDairesiAdi('KASIMPAŞA VERGİ DAİRESİ')).toBe('KASIMPAŞA');
    expect(lucaVergiDairesiAdi('Beylikdüzü')).toBe('BEYLİKDÜZÜ');
    expect(lucaVergiDairesiAdi('B.MUKELLEFLER')).toBe('B.MUKELLEFLER');
    expect(lucaVergiDairesiAdi('')).toBe('');
  });
});

describe('İşletme HIZLI FİŞ CSV — karşı taraf VERGİ DAİRESİ + ADRES (2026-09-23, DOĞAN ÖZKAN → ECT TURİZM)', () => {
  const hucreler = (buf: Buffer) => require('iconv-lite').decode(buf, 'win1254').split('\r\n')[1].split(';');
  it('vergi dairesi 9. sütuna GİB adıyla, adres 12. sütuna ASCII katlanmış; bilgi yoksa ikisi de boş', () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    const p: any = { ...payload(), direction: 'SATIS', invoices: [{ ...payload().invoices[0], invoiceKind: 'SATIS', buyerVkn: '3241180695', customerName: 'ECT TURİZM VE OTOMOTİV TİCARET LİMİTED ŞİRKETİ', vendorName: null,
      counterpartyVergiDairesi: ' BEYLİKDÜZÜ  VERGİ DAİRESİ MÜD. ', counterpartyAdres: 'YAKUPLU MAH. HÜRRİYET CAD. NO:131/6 BEYLİKDÜZÜ / İSTANBUL',
      isletme: { belgeTuruKod: '8', belgeTuruAd: 'e-Arşiv Fatura', kayitTuruKod: '2', kayitTuruAd: 'Hizmet Satışı', kayitAltKod: '2', kayitAltAd: 'Hizmet Satışı', kdvOranKod: 'KDV20' },
      lines: [{ group: 'matrah', description: 'x', rate: '20', debit: '0', credit: '128700', orderNo: 0 }, { group: 'vergi', description: 'kdv', rate: '20', debit: '0', credit: '12870', orderNo: 1 }] }] };
    const h = hucreler(buildLucaIsletmeHizliFisCsv(p));
    expect(h[7]).toBe('3241180695');
    // Luca adla arar; uzun GİB adı listede yok (canlı: "… adlı vergi dairesi bulunamadı") → çekirdek ad.
    expect(h[8]).toBe('BEYLİKDÜZÜ');
    expect(h[11]).toBe(require('./luca-excel.service').isletmeUnvanDuzelt('YAKUPLU MAH. HÜRRİYET CAD. NO:131/6 BEYLİKDÜZÜ / İSTANBUL'));
    expect(h[11]).not.toMatch(/[ÜİŞ]/);
    const bos: any = { ...p, invoices: [{ ...p.invoices[0], counterpartyVergiDairesi: null, counterpartyAdres: undefined }] };
    const b = hucreler(buildLucaIsletmeHizliFisCsv(bos));
    expect([b[8], b[11]]).toEqual(['', '']);
  });
});

describe('İşletme HIZLI FİŞ CSV — KDV dışı vergi (ÖİV) ve stopaj sütunları (2026-09-15)', () => {
  const hucreler = (buf: Buffer) => require('iconv-lite').decode(buf, 'win1254').split('\r\n')[1].split(';');
  it('Turkcell: ÖİV 28. sütuna (matraha dahil olmayan), TUTAR salt matrah, KDV ve toplam tutarlı', () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    const p: any = { ...payload(), invoices: [{ ...payload().invoices[0], vendorName: 'TURKCELL', isletme: { belgeTuruKod: '9', belgeTuruAd: 'e-Fatura', kayitTuruKod: '4', kayitTuruAd: 'İndirilecek Giderler (GVK Md. 40)', kayitAltKod: '87', kayitAltAd: 'Telefon Giderleri (GVK 40/1)', kdvOranKod: 'KDV20' },
      lines: [
        { group: 'matrah', description: 'tel', rate: '20', debit: '65.18', credit: '0', orderNo: 0 },
        { group: 'vergi', description: 'kdv', rate: '20', debit: '13.04', credit: '0', orderNo: 1 },
        { group: 'diger_vergi', description: 'ÖİV', rate: 'ÖİV', debit: '6.52', credit: '0', orderNo: 2 },
      ] }] };
    const h = hucreler(buildLucaIsletmeHizliFisCsv(p));
    expect(h[2]).toBe('Diğer Alışlar');
    expect([h[22], h[27], h[28], h[29]]).toEqual(['65,18', '6,52', '13,04', '84,74']);
  });
  it('SMM: stopaj kodu Luca etiketi (022) + tutar; oran "20" artık kod sütununa yazılmaz', () => {
    process.env.LUCA_ISLETME_UNVAN_ASCII = '2';
    const p: any = { ...payload(), invoices: [{ ...payload().invoices[0], documentType: 'E_SMM', vendorName: 'AVUKAT X', isletme: { belgeTuruKod: '13', belgeTuruAd: 'e-Serbest Meslek Makbuzu', kayitTuruKod: '4', kayitTuruAd: 'İndirilecek Giderler (GVK Md. 40)', kayitAltKod: '196', kayitAltAd: 'Avukatlık, Hukuk ve Müşavirlik Giderleri (GVK 40/1)', kdvOranKod: 'KDV20', stopajKod: '022', stopajTutar: 11000, stopajOrani: '20' } }] };
    const h = hucreler(buildLucaIsletmeHizliFisCsv(p));
    expect(h[31]).toBe('Diğer Serbest Meslek Kazancı Ödemeleri (GVK Md. 94/2-b)');
    expect(h[32]).toBe('11000,00');
    const q: any = { ...p, invoices: [{ ...p.invoices[0], isletme: { ...p.invoices[0].isletme, stopajKod: '', stopajTutar: 0, stopajOrani: '20' } }] };
    const g = hucreler(buildLucaIsletmeHizliFisCsv(q));
    expect(g[31]).toBe('Diğer Serbest Meslek Kazancı Ödemeleri (GVK Md. 94/2-b)'); // SMM + oran → 022
    expect(g[32]).toBe('');
  });
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
