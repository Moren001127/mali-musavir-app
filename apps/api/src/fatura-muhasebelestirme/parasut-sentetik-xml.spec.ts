/**
 * PARAŞÜT SENTETİK XML — tevkifat / stopaj / ÖTV-ÖİV (2026-09-15 canlı bulgu — Zeki Özkaynak).
 * Paraşüt liste alanlarından üretilen XML'de WithholdingTaxTotal yoktu; 18 tevkifatlı satış faturası
 * "Tutar tutarsız" engeline düşüyordu. Bu kilit: üretilen XML'i GERÇEK ayrıştırıcıdan geçirip tutarları doğrular.
 * Servisin yalnız `syntheticParasutXml` metodu prototipten alınır (DB/ağ yok).
 */
jest.mock('./fatura-muhasebelestirme.service', () => jest.requireActual('./fatura-muhasebelestirme.service'));
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { parseUblInvoice, ublOcrDataFields } from './ubl-parse';

const svc: any = Object.create(FaturaMuhasebelestirmeService.prototype);
svc.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
const taxpayer = { firstName: 'ZEKİ', lastName: 'ÖZKAYNAK', identityNumber: '65647060374' };
const included = [{ type: 'contacts', id: '77', attributes: { name: 'CASALİNDA HASIR', tax_number: '2030651445' } }];
function item(attrs: Record<string, any>) {
  return {
    id: '289014721',
    attributes: { invoice_no: 'ZE22026000000009', issue_date: '2026-08-01', currency: 'TRL', ...attrs },
    relationships: { contact: { data: { type: 'contacts', id: '77' } }, active_e_document: { data: { type: 'e_invoices', id: '5' } } },
  };
}
const xmlUret = (attrs: Record<string, any>) => String(svc.syntheticParasutXml(item(attrs), included, 'SATIS', taxpayer));

describe('syntheticParasutXml — kesintiler', () => {
  it('KDV tevkifatlı satış: WithholdingTaxTotal yazılır, KDV dahil 22.800 / ödenecek 22.040 ayrışır, ayrıştırıcı 2/10 bulur', () => {
    const xml = xmlUret({ before_taxes_total: 19000, total_vat: 3800, total_vat_withholding: 760, net_total: 22040, gross_total: 19000 });
    expect(xml).toContain('<WithholdingTaxTotal>');
    expect(xml).toContain('<Percent>20</Percent>');
    expect(xml).toContain('<TaxInclusiveAmount currencyID="TRY">22800.00</TaxInclusiveAmount>');
    expect(xml).toContain('<PayableAmount currencyID="TRY">22040.00</PayableAmount>');
    const p: any = parseUblInvoice(xml);
    expect(p.matrah).toBe(19000);
    expect(p.kdvTutari).toBe(3800);
    expect(p.tevkifatKdv).toBe(760);
    expect(p.tevkifatYuzde).toBe(20);
    expect(p.tevkifatOrani).toBeCloseTo(0.2, 6);
    expect(p.tevkifatCikarim).toBeUndefined(); // açık veri, çıkarım değil
    expect(p.tevkifatUygulanmamis).toBeUndefined();
    expect(p.odenecekTutar).toBe(22040);
    expect(p.toplamTutar).toBe(22040);
    expect(ublOcrDataFields(p).tevkifatHint).toBe(true);
  });

  it('kesinti yoksa XML eski biçimde: tek TaxTotal, KDV dahil = ödenecek = net_total, WithholdingTaxTotal yok', () => {
    const xml = xmlUret({ before_taxes_total: 1000, total_vat: 200, total_vat_withholding: 0, net_total: 1200 });
    expect(xml).not.toContain('WithholdingTaxTotal');
    expect(xml).not.toContain('<TaxSubtotal>');
    expect(xml).toContain('<TaxInclusiveAmount currencyID="TRY">1200.00</TaxInclusiveAmount>');
    expect(xml).toContain('<PayableAmount currencyID="TRY">1200.00</PayableAmount>');
    const p: any = parseUblInvoice(xml);
    expect(p.kdvTutari).toBe(200);
    expect(p.tevkifatKdv ?? 0).toBe(0);
    expect(p.tevkifatCikarim).toBeUndefined();
  });

  it('tam x/10 olmayan tevkifat tutarı: yüzde yazılmaz, tutar yine okunur', () => {
    const xml = xmlUret({ before_taxes_total: 1000, total_vat: 200, total_vat_withholding: 33.33, net_total: 1166.67 });
    expect(xml).toContain('<WithholdingTaxTotal>');
    expect(xml).not.toContain('<Percent>');
    const p: any = parseUblInvoice(xml);
    expect(p.tevkifatKdv).toBe(33.33);
  });

  it('stopaj (şahıs → 0003): KDV tevkifatı sayılmaz, stopajTutari döner', () => {
    const xml = xmlUret({ before_taxes_total: 10000, total_vat: 2000, withholding: 2000, withholding_rate: 20, net_total: 10000 });
    expect(xml).toContain('<TaxTypeCode>0003</TaxTypeCode>');
    const p: any = parseUblInvoice(xml);
    expect(p.stopajTutari).toBe(2000);
    expect(p.tevkifatKdv ?? 0).toBe(0);
    expect(p.odenecekTutar).toBe(10000);
  });

  it('ÖTV/ÖİV: alt toplamlar yazılır, KDV yalnız KDV kırılımından, diğer vergi ayrı toplanır', () => {
    const xml = xmlUret({ before_taxes_total: 1000, total_vat: 200, total_excise_duty: 50, total_communications_tax: 25, net_total: 1275 });
    expect(xml).toContain('<TaxTypeCode>0071</TaxTypeCode>');
    expect(xml).toContain('<TaxTypeCode>4171</TaxTypeCode>');
    const p: any = parseUblInvoice(xml);
    expect(p.kdvTutari).toBe(200);
    expect(p.digerVergiToplam).toBe(75);
    expect(p.odenecekTutar).toBe(1275);
    expect(p.tevkifatCikarim).toBeUndefined();
  });
});

describe('syntheticParasutXml — 2026-09-26 denetim düzeltmeleri', () => {
  it('matrah yedeği: before_taxes_total yoksa gross_total (iskonto öncesi) DEĞİL, net_total − KDV kullanılır', () => {
    const xml = xmlUret({ total_vat: 180, net_total: 1080, gross_total: 1000 }); // 100 TL iskontolu: matrah 900
    expect(xml).toContain('<TaxExclusiveAmount currencyID="TRY">900.00</TaxExclusiveAmount>');
    const p: any = parseUblInvoice(xml);
    expect(p.matrah).toBe(900);
    expect(p.kdvTutari).toBe(180);
  });

  it('matrah yedeği tevkifatlıda: net_total − KDV + tevkifat (ödenecekten geri hesap)', () => {
    const xml = xmlUret({ total_vat: 3800, total_vat_withholding: 760, net_total: 22040, gross_total: 25000 });
    expect(xml).toContain('<TaxExclusiveAmount currencyID="TRY">19000.00</TaxExclusiveAmount>');
    expect(xml).toContain('<TaxInclusiveAmount currencyID="TRY">22800.00</TaxInclusiveAmount>');
    const p: any = parseUblInvoice(xml);
    expect(p.matrah).toBe(19000);
    expect(p.tevkifatKdv).toBe(760);
    expect(p.odenecekTutar).toBe(22040);
  });

  it('iade (item_type=refund): InvoiceTypeCode IADE yazılır, ayrıştırıcı iade olarak tanır', () => {
    const xml = xmlUret({ item_type: 'refund', before_taxes_total: 100, total_vat: 20, net_total: 120 });
    expect(xml).toContain('<InvoiceTypeCode>IADE</InvoiceTypeCode>');
    const p: any = parseUblInvoice(xml);
    expect(p.faturaTipi).toBe('IADE');
    expect(p.iade).toBe(true);
  });

  it('normal faturada InvoiceTypeCode yazılmaz (eski biçim korunur)', () => {
    expect(xmlUret({ item_type: 'invoice', before_taxes_total: 100, total_vat: 20, net_total: 120 })).not.toContain('InvoiceTypeCode');
  });

  it('döviz: exchange_rate varsa PricingExchangeRate yazılır, ayrıştırıcı kuru okur; TL belgede yazılmaz', () => {
    const xml = xmlUret({ currency: 'USD', exchange_rate: '41.2345', before_taxes_total: 100, total_vat: 20, net_total: 120 });
    expect(xml).toContain('<CalculationRate>41.2345</CalculationRate>');
    const p: any = parseUblInvoice(xml);
    expect(p.kur).toBeCloseTo(41.2345, 4);
    expect(xmlUret({ exchange_rate: '1', before_taxes_total: 100, total_vat: 20, net_total: 120 })).not.toContain('PricingExchangeRate');
  });
});

describe('parasutInboundEInvoiceXml — alış (gelen e-Fatura)', () => {
  const gelen = (attrs: Record<string, any>) => String(svc.parasutInboundEInvoiceXml(
    { id: '9', attributes: { external_id: 'ABC2026000000001', issue_date: '2026-08-05', currency: 'TRL', contact_name: 'SATICI A.Ş.', from_vkn: '1234567890', ...attrs } },
    taxpayer,
  ));

  it('tevkifatsız: eski davranış — matrah = net_total − KDV, KDV dahil = ödenecek', () => {
    const xml = gelen({ net_total: 1200, total_vat: 200 });
    expect(xml).not.toContain('WithholdingTaxTotal');
    expect(xml).toContain('<TaxExclusiveAmount currencyID="TRY">1000.00</TaxExclusiveAmount>');
    expect(xml).toContain('<TaxInclusiveAmount currencyID="TRY">1200.00</TaxInclusiveAmount>');
    expect(xml).toContain('<PayableAmount currencyID="TRY">1200.00</PayableAmount>');
  });

  it('tevkifatlı alış: net_total ödenecek kabul edilir, matrah tevkifat kadar eksik ÇIKMAZ, tevkifat okunur', () => {
    const xml = gelen({ net_total: 22040, total_vat: 3800, total_vat_withholding: 760 });
    expect(xml).toContain('<WithholdingTaxTotal>');
    const p: any = parseUblInvoice(xml);
    expect(p.matrah).toBe(19000);
    expect(p.kdvTutari).toBe(3800);
    expect(p.tevkifatKdv).toBe(760);
    expect(p.tevkifatYuzde).toBe(20);
    expect(p.odenecekTutar).toBe(22040);
  });

  it('döviz alış: kur yazılır', () => {
    const p: any = parseUblInvoice(gelen({ currency: 'EUR', exchange_rate: 48.5, net_total: 120, total_vat: 20 }));
    expect(p.kur).toBe(48.5);
  });
});

describe('fetchParasutInvoices — satış belge türü süzgeci', () => {
  const eskiFetch = global.fetch;
  afterEach(() => { global.fetch = eskiFetch; });
  const eskiEnv = { id: process.env.PARASUT_CLIENT_ID, s: process.env.PARASUT_CLIENT_SECRET };
  beforeAll(() => { process.env.PARASUT_CLIENT_ID = 'cid'; process.env.PARASUT_CLIENT_SECRET = 'sec'; });
  afterAll(() => { process.env.PARASUT_CLIENT_ID = eskiEnv.id; process.env.PARASUT_CLIENT_SECRET = eskiEnv.s; });

  const yanit = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });
  const satis = (id: string, item_type: string, ed: string | null, extra: Record<string, any> = {}) => ({
    id, attributes: { invoice_no: `NO${id}`, issue_date: '2026-08-10', item_type, total_vat: 20, net_total: 120, before_taxes_total: 100, ...extra },
    relationships: { contact: { data: { type: 'contacts', id: '77' } }, ...(ed ? { active_e_document: { data: { type: ed, id: `e${id}` } } } : {}) },
  });

  const listeFetch = () => jest.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/oauth/token')) return yanit({ access_token: 'T' }) as any;
    if (/\/sales_invoices\?/.test(u)) {
      return yanit({ data: [
        satis('1', 'invoice', 'e_invoices'),
        satis('2', 'estimate', null),
        satis('3', 'cancelled', 'e_invoices'),
        satis('4', 'invoice', 'e_archives', { archived: true }), // ARŞİVLENMİŞ ≠ iptal → alınır
        satis('5', 'recurring_invoice', null),
        satis('6', 'invoice', null),           // kâğıt fatura
        satis('7', 'refund', 'e_invoices'),
        satis('8', 'export', 'e_invoices'),
        satis('9', 'invoice', null),           // tekil sorgusu DÜŞER (500) → kâğıt SAYILMAZ
        satis('10', 'invoice', 'e_smms'),      // serbest meslek makbuzu → e-Arşiv kanalı
      ], included }) as any;
    }
    if (/\/sales_invoices\/6\?/.test(u)) return yanit({ data: { id: '6', relationships: {} } }) as any; // tekil sorgu da e-belge vermez
    if (/\/sales_invoices\/9\?/.test(u)) return yanit({ errors: [{ title: 'Internal' }] }, 500) as any;
    return yanit({}, 404) as any; // PDF uçları
  }) as any;
  const cek = (channel?: string) => {
    const progress: any = {};
    return svc.fetchParasutInvoices(
      { provider: 'PARASUT', username: 'u', password: 'p', accountId: '555' },
      { taxpayer, direction: 'SATIS', period: { donem: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31' }, limit: 100, progress, ...(channel ? { channel } : {}) },
    ).then((payloads: any[]) => ({ payloads, progress }));
  };

  it('teklif/iptal/şablon atlanır; ARŞİVLİ alınır; e-belgesiz atlanıp UYARI; tür okunamayan kâğıt SAYILMAZ; iade alınır', async () => {
    global.fetch = listeFetch();
    const { payloads, progress } = await cek();
    expect(payloads.map((p: any) => p.externalId)).toEqual(['sales_invoices:1', 'sales_invoices:4', 'sales_invoices:7', 'sales_invoices:8', 'sales_invoices:10']);
    expect(payloads[2].xml).toContain('<InvoiceTypeCode>IADE</InvoiceTypeCode>');
    expect(progress.uyarilar).toEqual([
      expect.stringMatching(/e-belgesi olmayan 1 satış faturası atlandı/),
      expect.stringMatching(/1 satış faturasının e-belge türü okunamadı/),
    ]);
  });

  it('kanal verilirse öbür kanalın belgesi indirilmez: e-Fatura ↔ e-Arşiv (+e-SMM)', async () => {
    global.fetch = listeFetch();
    const ef = await cek('OUT_EFATURA');
    expect(ef.payloads.map((p: any) => p.externalId)).toEqual(['sales_invoices:1', 'sales_invoices:7', 'sales_invoices:8']);
    global.fetch = listeFetch();
    const ea = await cek('OUT_EARSIV');
    expect(ea.payloads.map((p: any) => p.externalId)).toEqual(['sales_invoices:4', 'sales_invoices:10']);
    for (const p of ea.payloads) expect(p.xml).toContain('<ProfileID>EARSIVFATURA</ProfileID>');
  });
});
