/**
 * UBL FATURA TARİHİ OKUMA (2026-09-26): `new Date(ham)` '2026-08-31+03:00' ve '31.08.2026' için
 *  Invalid Date veriyordu → inbox satırında tarih boş kalıyordu. ublTarihOku sonucu eski davranışla
 *  aynı (UTC gece yarısı) olmalı ki dönem hesapları değişmesin.
 */
import { parseUblInvoice, ublTarihOku } from './ubl-parse';

const utc = (s: string) => new Date(s).toISOString();

describe('ublTarihOku', () => {
  it('düz YYYY-AA-GG eski davranışla aynı', () => {
    expect(ublTarihOku('2026-08-31')!.toISOString()).toBe(utc('2026-08-31'));
  });
  it('saat dilimi eki atılır', () => {
    expect(ublTarihOku('2026-08-31+03:00')!.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(ublTarihOku('2026-08-31Z')!.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(ublTarihOku('2026-08-31T23:30:00+03:00')!.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
  it('GG.AA.YYYY ve GG/AA/YYYY', () => {
    expect(ublTarihOku('31.08.2026')!.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(ublTarihOku('01/09/2026')!.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(ublTarihOku(' 5.9.2026 ')!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });
  it('geçersiz → null', () => {
    expect(ublTarihOku('')).toBeNull();
    expect(ublTarihOku(null)).toBeNull();
    expect(ublTarihOku('tarih yok')).toBeNull();
    expect(ublTarihOku('2026-02-31')).toBeNull();
    expect(ublTarihOku('31.13.2026')).toBeNull();
  });
});

describe('parseUblInvoice IssueDate', () => {
  const xml = (tarih: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>GIB2026000000001</cbc:ID>
  <cbc:UUID>11111111-2222-3333-4444-555555555555</cbc:UUID>
  <cbc:IssueDate>${tarih}</cbc:IssueDate>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="TRY">120</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;
  it('saat dilimli tarih okunur', () => {
    expect(parseUblInvoice(xml('2026-08-31+03:00'))?.faturaTarihi?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
  it('düz tarih değişmez', () => {
    expect(parseUblInvoice(xml('2026-08-31'))?.faturaTarihi?.toISOString()).toBe(utc('2026-08-31'));
  });
});
