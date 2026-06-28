import { EDefterControlService } from './edefter-control.service';
import { ParsedEDefterFisLine } from './edefter-fis-listesi-parser.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

function row(overrides: Partial<ParsedEDefterFisLine>): ParsedEDefterFisLine {
  return {
    rowIndex: 1,
    voucherKey: 'v1',
    fisNo: '1',
    yevmiyeNo: '1',
    fisTarihi: d('2026-01-01'),
    fisTipi: 'Mahsup',
    evrakNo: null,
    evrakTarihi: null,
    belgeTuru: null,
    hesapKodu: '100.01.001',
    hesapAdi: 'Kasa',
    aciklama: 'Nakit odeme',
    karsiHesap: null,
    vknTckn: null,
    borc: 0,
    alacak: 0,
    rawData: {},
    ...overrides,
  };
}

describe('EDefterControlService tevsik kasa kontrolleri', () => {
  let service: EDefterControlService;

  beforeEach(() => {
    service = new EDefterControlService(null as any, null as any, null as any);
  });

  function analyze(rows: ParsedEDefterFisLine[]) {
    return (service as any).analyze(
      rows,
      { start: d('2026-01-01'), end: d('2026-03-31') },
      'GECICI_Q1',
    ) as Array<{ category: string; message: string }>;
  }

  it('acilis fisindeki kasa borc bakiyesini tevsik riski saymaz', () => {
    const findings = analyze([
      row({
        rowIndex: 10,
        voucherKey: 'acilis',
        fisNo: '1',
        yevmiyeNo: '1',
        fisTipi: 'Acilis',
        aciklama: 'Acilis fisi',
        hesapKodu: '100.01.001',
        borc: 105802.08,
      }),
      row({
        rowIndex: 11,
        voucherKey: 'acilis',
        fisNo: '1',
        yevmiyeNo: '1',
        fisTipi: 'Acilis',
        aciklama: 'Acilis fisi',
        hesapKodu: '500.01.001',
        hesapAdi: 'Sermaye',
        borc: 0,
        alacak: 105802.08,
      }),
    ]);

    expect(findings.map((f) => f.category)).not.toContain('KASA_HAREKET_30000_TEVSIK_RISKI');
    expect(findings.map((f) => f.category)).not.toContain('KASA_GUNLUK_30000_TEVSIK_RISKI');
  });

  it('tek 100 Kasa hareketi 30.000 TL sinirini asarsa hareket bazli bulgu uretir', () => {
    const findings = analyze([
      row({
        rowIndex: 20,
        voucherKey: 'nakit-odeme',
        fisNo: '2',
        yevmiyeNo: '2',
        aciklama: 'Nakit tedarikci odemesi',
        hesapKodu: '100.01.001',
        alacak: 35000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 21,
        voucherKey: 'nakit-odeme',
        fisNo: '2',
        yevmiyeNo: '2',
        aciklama: 'Nakit tedarikci odemesi',
        hesapKodu: '320.01.001',
        hesapAdi: 'Saticilar',
        borc: 35000,
        vknTckn: '1234567890',
      }),
    ]);

    expect(findings.map((f) => f.category)).toContain('KASA_HAREKET_30000_TEVSIK_RISKI');
  });

  it('ayni gun ayni VKN icin parcalanan kasa hareketlerini birlikte kontrol eder', () => {
    const findings = analyze([
      row({
        rowIndex: 30,
        voucherKey: 'p1',
        fisNo: '3',
        yevmiyeNo: '3',
        hesapKodu: '100.01.001',
        alacak: 20000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 31,
        voucherKey: 'p1',
        fisNo: '3',
        yevmiyeNo: '3',
        hesapKodu: '320.01.001',
        hesapAdi: 'Saticilar',
        borc: 20000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 32,
        voucherKey: 'p2',
        fisNo: '4',
        yevmiyeNo: '4',
        hesapKodu: '100.01.001',
        alacak: 15000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 33,
        voucherKey: 'p2',
        fisNo: '4',
        yevmiyeNo: '4',
        hesapKodu: '320.01.001',
        hesapAdi: 'Saticilar',
        borc: 15000,
        vknTckn: '1234567890',
      }),
    ]);

    expect(findings.map((f) => f.category)).toContain('KASA_TEVSIK_PARCALAMA');
    expect(findings.map((f) => f.category)).not.toContain('KASA_HAREKET_30000_TEVSIK_RISKI');
  });

  it('farkli taraflarin gunluk kasa toplamlarini tek bulguya toplamaz', () => {
    const findings = analyze([
      row({
        rowIndex: 40,
        voucherKey: 'u1',
        fisNo: '5',
        yevmiyeNo: '5',
        hesapKodu: '100.01.001',
        borc: 20000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 41,
        voucherKey: 'u1',
        fisNo: '5',
        yevmiyeNo: '5',
        hesapKodu: '120.01.001',
        hesapAdi: 'Alicilar',
        alacak: 20000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 42,
        voucherKey: 'u2',
        fisNo: '6',
        yevmiyeNo: '6',
        hesapKodu: '100.01.001',
        borc: 20000,
        vknTckn: '11111111110',
      }),
      row({
        rowIndex: 43,
        voucherKey: 'u2',
        fisNo: '6',
        yevmiyeNo: '6',
        hesapKodu: '120.01.001',
        hesapAdi: 'Alicilar',
        alacak: 20000,
        vknTckn: '11111111110',
      }),
    ]);

    expect(findings.map((f) => f.category)).not.toContain('KASA_GUNLUK_30000_TEVSIK_RISKI');
    expect(findings.map((f) => f.category)).not.toContain('KASA_TEVSIK_PARCALAMA');
  });

  it('banka veya POS bacagi olan fislerde kasa tevsik bulgusu uretmez', () => {
    const findings = analyze([
      row({
        rowIndex: 50,
        voucherKey: 'bankali',
        fisNo: '7',
        yevmiyeNo: '7',
        hesapKodu: '100.01.001',
        alacak: 45000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 51,
        voucherKey: 'bankali',
        fisNo: '7',
        yevmiyeNo: '7',
        hesapKodu: '102.01.001',
        hesapAdi: 'Banka',
        borc: 45000,
        vknTckn: '1234567890',
      }),
    ]);

    expect(findings.map((f) => f.category)).not.toContain('KASA_HAREKET_30000_TEVSIK_RISKI');
  });

  it('fis kimligi ve hesap kodu olmayan rapor ozet satirlarini tarih hatasi saymaz', () => {
    const findings = analyze([
      row({
        rowIndex: 485,
        voucherKey: 'BLOCK|2',
        fisNo: null,
        yevmiyeNo: null,
        fisTarihi: null,
        hesapKodu: null,
        hesapAdi: null,
        aciklama: null,
        borc: 100000,
        alacak: 0,
      }),
    ]);

    expect(findings.map((f) => f.category)).not.toContain('FIS_TARIHI_PARSE_HATASI');
  });
});
