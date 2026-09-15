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
