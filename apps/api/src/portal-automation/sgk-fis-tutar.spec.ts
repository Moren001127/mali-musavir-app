// SGK tahakkuk fişi ÖDENECEK NET TUTAR — gerçek fişlerden alınmış sütun/metin örnekleri (2026-09-14).
import { metindenOdenecek, primTutariSutunu, sgkOdenecekTutar, sutundanOdenecek } from './sgk-fis-tutar';

const tablo = (sutun: string) => ({ pages: [{ num: 1, tables: [[['T.C. SGK TAHAKKUK FİŞİ', `PRİM TUTARI ${sutun}`], []], [['1 KISA VADELİ', '', '6.606,00', '2,25', '']]] }] });

describe('sgk-fis-tutar', () => {
  it('belge türü 02 (SGDP, işsizlik 0,00): PEK değil ödenecek net (ERCAN ÖZTAMUR)', () => {
    const r = sgkOdenecekTutar(tablo('148,64\n 1.981,80\n2.130,44\n2.130,44\n0,00\n2.130,44'), 'metin 6.606,00 2,25 148,64 6.606,00 30,00 1.981,80');
    expect(r).toMatchObject({ tutar: '2.130,44', dogrulandi: true, yontem: 'tablo' });
  });
  it('ZEYREK: 22.020,00 PEK değil 7.101,45', () => {
    expect(sutundanOdenecek(['495,45', '6.606,00', '7.101,45', '7.101,45', '0,00', '7.101,45'])).toEqual({ tutar: '7.101,45', dogrulandi: true });
  });
  it('belge türü 01 işsizlikli: net + işsizlik = ödenecek', () => {
    expect(sutundanOdenecek(['74,32', '693,63', '412,88', '99,09', '1.180,83', '1.180,83', '99,09', '1.279,92'])).toEqual({ tutar: '1.279,92', dogrulandi: true });
  });
  it('%5 indirimli fiş: TOPLAM PRİM (690,09) değil ödenecek (650,09)', () => {
    expect(sutundanOdenecek(['40,01', '400,05', '250,03', '60,01', '690,09', '100,01', '590,08', '60,01', '650,09'])).toEqual({ tutar: '650,09', dogrulandi: true });
  });
  it('eski biçim (damga vergisi satırı): net + damga + işsizlik', () => {
    expect(sutundanOdenecek(['60,39', '603,91', '377,44', '90,59', '1.041,74', '150,98', '890,76', '23,50', '90,59', '1.004,85'])).toEqual({ tutar: '1.004,85', dogrulandi: true });
    expect(sutundanOdenecek(['3,29', '32,94', '20,59', '4,94', '56,82', '8,24', '48,58', '23,50', '4,94', '77,02'])).toEqual({ tutar: '77,02', dogrulandi: true });
  });
  it('tahakkuk yok (hepsi 0,00) → 0,00 doğrulanmış', () => {
    expect(sutundanOdenecek(['0,00', '0,00', '0,00', '0,00'])).toEqual({ tutar: '0,00', dogrulandi: true });
  });
  it('ödenecek altında ek satır olsa da doğru değer (6111 kalıbı)', () => {
    expect(sutundanOdenecek(['100,00', '200,00', '300,00', '300,00', '9,00', '309,00', '6,00'])).toEqual({ tutar: '309,00', dogrulandi: true });
  });
  it('sütun bulunamazsa metin yedeği: 0,00 tuzağına düşmez', () => {
    const r = metindenOdenecek('6.606,00 2,25 148,64 6.606,00 30,00 1.981,80 2.130,44 2.130,44 0,00 2.130,44');
    expect(r).toEqual({ tutar: '2.130,44', dogrulandi: true });
  });
  it('tablo yok + metin yok → yok', () => {
    expect(sgkOdenecekTutar(null, '')).toEqual({ tutar: null, dogrulandi: false, yontem: 'yok' });
  });
  it('primTutariSutunu: başlık hücresinden değerleri sırayla çıkarır', () => {
    expect(primTutariSutunu(tablo('1,00\n2,00\n3,00'))).toEqual(['1,00', '2,00', '3,00']);
    expect(primTutariSutunu({ pages: [] })).toBeNull();
  });
});
