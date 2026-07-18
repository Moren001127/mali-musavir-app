import { resolveBeyanState, gibTarihFromNotlar } from './beyanname-takip.service';

// YILMAZ vakası: GİB'de hatalı duran beyanname panelde "onay bekliyor" görünüyordu.
// GİB sorgusu hatalı→onay-bekliyor sırayla yazdığı için beklemede kaydının updatedAt'i
// hep daha yeni çıkıyordu; güncellik artık GİB satır tarihine (gibTarih) göre.

const TAXPAYER = 'tp-yilmaz';

function durumKaydi(partial: any) {
  return {
    taxpayerId: TAXPAYER,
    beyanTipi: 'MUHSGK',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...partial,
  };
}

function indexOf(records: any[]) {
  const map = new Map<string, any>();
  for (const r of records) map.set(`${r.taxpayerId}::${r.beyanTipi}::${r.donem}`, r);
  return map;
}

function resolveMuhsgkTemmuz(durumlar: any[], kayitlar: any[] = []) {
  return resolveBeyanState(
    indexOf(durumlar),
    indexOf(kayitlar),
    TAXPAYER,
    'MUHSGK',
    2026,
    7,
    '2026-07',
    'VERILME',
  );
}

describe('gibTarihFromNotlar', () => {
  it('gibTarih değerini nottan okur', () => {
    const d = gibTarihFromNotlar('GIB agent hata | gibTarih=2026-07-16T09:30:00.000Z | {"raw":1}');
    expect(d?.toISOString()).toBe('2026-07-16T09:30:00.000Z');
  });

  it('gibTarih yoksa null döner', () => {
    expect(gibTarihFromNotlar('GIB agent onay bekliyor | {"raw":1}')).toBeNull();
    expect(gibTarihFromNotlar(null)).toBeNull();
  });
});

describe('resolveBeyanState güncellik (gibTarih)', () => {
  it('updatedAt daha yeni olsa da GİB tarihi eski olan beklemede, yeni hatalıyı ezmez', () => {
    const beklemede = durumKaydi({
      donem: '2026-06',
      durum: 'beklemede',
      notlar: 'GIB agent onay bekliyor | gibTarih=2026-07-10T08:00:00.000Z | {"raw":1}',
      updatedAt: new Date('2026-07-18T06:00:00Z'), // koşuda sonra yazıldı
    });
    const hatali = durumKaydi({
      donem: '2026-Q2',
      durum: 'hatali',
      notlar: 'GIB agent hata | gibTarih=2026-07-16T09:30:00.000Z | {"raw":1}',
      updatedAt: new Date('2026-07-18T05:59:00Z'), // koşuda önce yazıldı
    });
    expect(resolveMuhsgkTemmuz([beklemede, hatali]).durum).toBe('hatali');
  });

  it('GİB tarihi daha yeni olan beklemede hatalıyı geçer (düzeltme verilmiş)', () => {
    const hatali = durumKaydi({
      donem: '2026-06',
      durum: 'hatali',
      notlar: 'GIB agent hata | gibTarih=2026-07-10T08:00:00.000Z',
      updatedAt: new Date('2026-07-18T06:00:00Z'),
    });
    const beklemede = durumKaydi({
      donem: '2026-Q2',
      durum: 'beklemede',
      notlar: 'GIB agent onay bekliyor | gibTarih=2026-07-16T09:30:00.000Z',
      updatedAt: new Date('2026-07-18T05:59:00Z'),
    });
    expect(resolveMuhsgkTemmuz([hatali, beklemede]).durum).toBe('beklemede');
  });

  it('gibTarihsiz ESKİ GİB beklemede kaydı (updatedAt daha yeni olsa da) gibTarihli hatalıyı ezemez', () => {
    const eskiBeklemede = durumKaydi({
      donem: '2026-06',
      durum: 'beklemede',
      notlar: 'GIB agent onay bekliyor', // düzeltme öncesi kayıt — gibTarih yok
      updatedAt: new Date('2026-07-18T08:19:00Z'), // sabah koşusu tazeledi
    });
    const hatali = durumKaydi({
      donem: '2026-Q2',
      durum: 'hatali',
      notlar: 'GIB agent hata | gibTarih=2026-07-14T10:00:00.000Z',
      updatedAt: new Date('2026-07-18T07:00:00Z'),
    });
    expect(resolveMuhsgkTemmuz([eskiBeklemede, hatali]).durum).toBe('hatali');
  });

  it('elle işaretlenen durum GİB kayıtlarına karşı korunur', () => {
    const elleHatali = durumKaydi({
      donem: '2026-06',
      durum: 'hatali',
      notlar: 'muhasebeci elle işaretledi',
      updatedAt: new Date('2026-07-12T09:00:00Z'),
    });
    const gibBeklemede = durumKaydi({
      donem: '2026-Q2',
      durum: 'beklemede',
      notlar: 'GIB agent onay bekliyor | gibTarih=2026-07-16T09:30:00.000Z',
      updatedAt: new Date('2026-07-18T06:00:00Z'),
    });
    expect(resolveMuhsgkTemmuz([elleHatali, gibBeklemede]).durum).toBe('hatali');
  });

  it('gibTarih yoksa eski davranış: updatedAt yeni olan geçerli', () => {
    const beklemede = durumKaydi({
      donem: '2026-06',
      durum: 'beklemede',
      notlar: 'GIB agent onay bekliyor',
      updatedAt: new Date('2026-07-18T05:00:00Z'),
    });
    const hatali = durumKaydi({
      donem: '2026-Q2',
      durum: 'hatali',
      notlar: 'GIB agent hata',
      updatedAt: new Date('2026-07-18T06:00:00Z'),
    });
    expect(resolveMuhsgkTemmuz([beklemede, hatali]).durum).toBe('hatali');
  });

  it('onaylı (indirilmiş BeyanKaydı) her durumda kesin kazanır', () => {
    const hatali = durumKaydi({
      donem: '2026-06',
      durum: 'hatali',
      notlar: 'GIB agent hata | gibTarih=2026-07-16T09:30:00.000Z',
      updatedAt: new Date('2026-07-18T06:00:00Z'),
    });
    const kayit = { taxpayerId: TAXPAYER, beyanTipi: 'MUHSGK', donem: '2026-06', tahakkukTutari: 939.7 };
    expect(resolveMuhsgkTemmuz([hatali], [kayit]).durum).toBe('onaylandi');
  });
});
