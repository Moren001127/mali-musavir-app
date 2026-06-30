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

  function analyze(rows: ParsedEDefterFisLine[], ruleSettings = new Map<string, boolean>()) {
    return (service as any).analyze(
      rows,
      { start: d('2026-01-01'), end: d('2026-03-31') },
      'GECICI_Q1',
      ruleSettings,
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

  it('kullanici tarafindan pasife alinan kural bulgu uretmez', () => {
    const findings = analyze([
      row({
        rowIndex: 60,
        voucherKey: 'nakit-odeme',
        fisNo: '8',
        yevmiyeNo: '8',
        aciklama: 'Nakit tedarikci odemesi',
        hesapKodu: '100.01.001',
        alacak: 35000,
        vknTckn: '1234567890',
      }),
      row({
        rowIndex: 61,
        voucherKey: 'nakit-odeme',
        fisNo: '8',
        yevmiyeNo: '8',
        aciklama: 'Nakit tedarikci odemesi',
        hesapKodu: '320.01.001',
        hesapAdi: 'Saticilar',
        borc: 35000,
        vknTckn: '1234567890',
      }),
    ], new Map([['KASA_HAREKET_30000_TEVSIK_RISKI', false]]));

    expect(findings.map((f) => f.category)).not.toContain('KASA_HAREKET_30000_TEVSIK_RISKI');
  });

  it('asgari ucret istisnasi olasi bordroda damga kontrolunu aciklayici bilgi olarak uretir', () => {
    const findings = analyze([
      row({
        rowIndex: 70,
        voucherKey: 'bordro',
        fisNo: '9',
        yevmiyeNo: '9',
        hesapKodu: '770.01.001',
        hesapAdi: 'Brut ucret gideri',
        aciklama: 'Personel bordro maas',
        borc: 26005.5,
      }),
      row({
        rowIndex: 71,
        voucherKey: 'bordro',
        fisNo: '9',
        yevmiyeNo: '9',
        hesapKodu: '335.01.001',
        hesapAdi: 'Personele borclar',
        aciklama: 'Net ucret',
        alacak: 22104.68,
      }),
      row({
        rowIndex: 72,
        voucherKey: 'bordro',
        fisNo: '9',
        yevmiyeNo: '9',
        hesapKodu: '361.01.001',
        hesapAdi: 'Odenecek SGK',
        aciklama: 'SGK primi',
        alacak: 3900.82,
      }),
    ]);

    const damga = findings.find((f) => f.category === 'DAMGA_VERGISI_KONTROL');
    expect(damga?.message).toContain('Asgari ucret istisnasi');
    expect(damga?.message).toContain('ayri fiste');
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

  it('kasa gun sonu eksi bakiye verirse (acilis yok) WARN bulgu uretir', () => {
    const findings = analyze([
      row({ rowIndex: 80, voucherKey: 'odeme', fisNo: '20', yevmiyeNo: '20', fisTarihi: d('2026-01-05'), hesapKodu: '100.01.001', alacak: 5000 }),
      row({ rowIndex: 81, voucherKey: 'odeme', fisNo: '20', yevmiyeNo: '20', fisTarihi: d('2026-01-05'), hesapKodu: '320.01.001', hesapAdi: 'Saticilar', borc: 5000 }),
    ]);
    const kasa = findings.find((f) => f.category === 'KASA_GUNLUK_NEGATIF_BAKIYE');
    expect(kasa).toBeDefined();
    expect((kasa as any).severity).toBe('WARN');
  });

  it('acilis fisi defterde varsa kasa eksi gunu ERROR olur (kesin bakiye)', () => {
    const findings = analyze([
      row({ rowIndex: 90, voucherKey: 'ac', fisNo: '1', yevmiyeNo: '1', fisTarihi: d('2026-01-01'), fisTipi: 'Acilis', aciklama: 'Acilis fisi', hesapKodu: '100.01.001', borc: 3000 }),
      row({ rowIndex: 91, voucherKey: 'ac', fisNo: '1', yevmiyeNo: '1', fisTarihi: d('2026-01-01'), fisTipi: 'Acilis', aciklama: 'Acilis fisi', hesapKodu: '500.01.001', hesapAdi: 'Sermaye', alacak: 3000 }),
      row({ rowIndex: 92, voucherKey: 'odeme', fisNo: '21', yevmiyeNo: '21', fisTarihi: d('2026-01-05'), hesapKodu: '100.01.001', alacak: 5000 }),
      row({ rowIndex: 93, voucherKey: 'odeme', fisNo: '21', yevmiyeNo: '21', fisTarihi: d('2026-01-05'), hesapKodu: '320.01.001', hesapAdi: 'Saticilar', borc: 5000 }),
    ]);
    const kasa = findings.find((f) => f.category === 'KASA_GUNLUK_NEGATIF_BAKIYE');
    expect(kasa).toBeDefined();
    expect((kasa as any).severity).toBe('ERROR');
  });

  it('kasa gun sonu pozitif kalirsa bulgu uretmez', () => {
    const findings = analyze([
      row({ rowIndex: 94, voucherKey: 'ac', fisNo: '1', yevmiyeNo: '1', fisTarihi: d('2026-01-01'), fisTipi: 'Acilis', aciklama: 'Acilis fisi', hesapKodu: '100.01.001', borc: 10000 }),
      row({ rowIndex: 95, voucherKey: 'ac', fisNo: '1', yevmiyeNo: '1', fisTarihi: d('2026-01-01'), fisTipi: 'Acilis', aciklama: 'Acilis fisi', hesapKodu: '500.01.001', hesapAdi: 'Sermaye', alacak: 10000 }),
      row({ rowIndex: 96, voucherKey: 'odeme', fisNo: '22', yevmiyeNo: '22', fisTarihi: d('2026-01-05'), hesapKodu: '100.01.001', alacak: 5000 }),
      row({ rowIndex: 97, voucherKey: 'odeme', fisNo: '22', yevmiyeNo: '22', fisTarihi: d('2026-01-05'), hesapKodu: '320.01.001', hesapAdi: 'Saticilar', borc: 5000 }),
    ]);
    expect(findings.map((f) => f.category)).not.toContain('KASA_GUNLUK_NEGATIF_BAKIYE');
  });
});
