import { faturadanCariler, tarafCarisi, cariBirlestir } from './cari-defteri';

/** Gerçek UBL-TR biçiminde küçük bir fatura (canlı arşivden sadeleştirilmiş). */
const FATURA = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">8540535229</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>TOPRAK TIR PAZARI OTOMOTİV İNŞAAT LTD. ŞTİ.</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>ERSOYLU İPEK YOLU</cbc:StreetName>
        <cbc:BuildingNumber>424</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>KIZILTEPE</cbc:CitySubdivisionName>
        <cbc:CityName>MARDİN</cbc:CityName>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>KIZILTEPE VERGİ DAİRESİ</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="TCKN">12345678901</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>DOĞAN ÖZKAN</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:CitySubdivisionName>ÇORLU</cbc:CitySubdivisionName><cbc:CityName>TEKİRDAĞ</cbc:CityName></cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>ÇORLU VERGİ DAİRESİ</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
</Invoice>`;

describe('cari defteri — UBL ayrıştırma', () => {
  it('faturadan HER İKİ tarafı da çıkarır (satıcı + alıcı)', () => {
    const c = faturadanCariler(FATURA);
    expect(c).toHaveLength(2);
    expect(c[0].kimlikNo).toBe('8540535229');
    expect(c[1].kimlikNo).toBe('12345678901');
  });

  it('ünvan, vergi dairesi ve adresi doğru okur', () => {
    const [satici, alici] = faturadanCariler(FATURA);
    expect(satici.unvan).toBe('TOPRAK TIR PAZARI OTOMOTİV İNŞAAT LTD. ŞTİ.');
    expect(satici.vergiDairesi).toBe('KIZILTEPE VERGİ DAİRESİ');
    expect(satici.adres).toBe('ERSOYLU İPEK YOLU / 424 / KIZILTEPE / MARDİN');
    expect(alici.vergiDairesi).toBe('ÇORLU VERGİ DAİRESİ');
  });

  it('TCKN (11 hane) de kimlik sayılır', () => {
    const [, alici] = faturadanCariler(FATURA);
    expect(alici.kimlikNo).toHaveLength(11);
  });

  it('kimlik no yoksa kayıt üretmez (defteri kirletmesin)', () => {
    const bos = '<Invoice><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>X</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty></Invoice>';
    expect(faturadanCariler(bos)).toHaveLength(0);
  });

  it('yalnız kimlik no varsa (ünvan/VD/adres yok) kayıt üretmez', () => {
    const c = tarafCarisi('<cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>');
    expect(c?.kimlikNo).toBe('1234567890');
    expect(faturadanCariler(`<Invoice><cac:AccountingSupplierParty>${'<cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>'}</cac:AccountingSupplierParty></Invoice>`)).toHaveLength(0);
  });

  it('boş XML çökertmez', () => {
    expect(faturadanCariler('')).toEqual([]);
    expect(faturadanCariler('<Invoice/>')).toEqual([]);
  });

  it('birleştirme: DOLU alan boşu ezer, yeni bilgi eskiyi günceller', () => {
    const eski = { kimlikNo: '1', unvan: 'ESKİ A.Ş.', vergiDairesi: 'KADIKÖY', adres: 'Eski adres' };
    const yeni = { kimlikNo: '1', unvan: 'YENİ A.Ş.', vergiDairesi: '', adres: '' };
    const s = cariBirlestir(eski, yeni);
    expect(s.unvan).toBe('YENİ A.Ş.');      // yeni ünvan geçerli
    expect(s.vergiDairesi).toBe('KADIKÖY'); // yenide yok → eski korunur
    expect(s.adres).toBe('Eski adres');
  });
});
