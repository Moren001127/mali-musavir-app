import { EvrakMesajService } from './evrak-mesaj.service';

/**
 * EVRAK MESAJLARI — mükellefe istenmeyen mesaj gitmesini önleyen kurallar.
 *
 * Geçmişte bir belge akışında koruma yokken üç gerçek mesaj mükellefe gitti.
 * Buradaki üç kural o hatanın tekrarını engelliyor ve hiçbiri bozulduğunda
 * ekran hata vermez — yalnız mesaj yanlış kişiye gider. O yüzden kilitli.
 */

const servisKur = () => new EvrakMesajService({} as any, {} as any);

describe('evrak mesajı — varsayılan TEST', () => {
  const eski = process.env.MOREN_EVRAK_CANLI;
  afterEach(() => {
    if (eski === undefined) delete process.env.MOREN_EVRAK_CANLI;
    else process.env.MOREN_EVRAK_CANLI = eski;
  });

  it('env yokken canlı DEĞİL — mesaj mükellefe gitmez', () => {
    delete process.env.MOREN_EVRAK_CANLI;
    expect(servisKur().canliMi()).toBe(false);
  });

  it('"1" dışındaki hiçbir değer canlıyı açmaz', () => {
    for (const v of ['0', 'true', 'evet', 'yes', '']) {
      process.env.MOREN_EVRAK_CANLI = v;
      expect(servisKur().canliMi()).toBe(false);
    }
  });

  it('yalnız tam olarak "1" canlıyı açar', () => {
    process.env.MOREN_EVRAK_CANLI = '1';
    expect(servisKur().canliMi()).toBe(true);
  });
});

describe('evrak mesajı — mesai penceresi (Pzt-Cum 09:00-17:00 TR)', () => {
  const s = servisKur();
  /** Türkiye saatiyle verilen anı UTC Date'e çevirir (yaz saati +03) */
  const tr = (iso: string) => new Date(`${iso}+03:00`);

  it('hafta içi 09:00 açılış — dahil', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T09:00:00'))).toBe(true); // Salı
  });

  it('hafta içi 16:59 — dahil', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T16:59:00'))).toBe(true);
  });

  it('hafta içi 17:00 — HARİÇ (kapanış saati dışarıda)', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T17:00:00'))).toBe(false);
  });

  it('hafta içi 08:59 — HARİÇ', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T08:59:00'))).toBe(false);
  });

  it('gece yarısı mesaj GİTMEZ', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-18T03:00:00'))).toBe(false);
  });

  it('Cumartesi kapalı', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-22T12:00:00'))).toBe(false);
  });

  it('Pazar kapalı', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-23T12:00:00'))).toBe(false);
  });

  it('Cuma öğlen açık', () => {
    expect(s.mesaiIcindeMi(tr('2026-08-21T12:00:00'))).toBe(true);
  });
});

describe('evrak mesajı — metin', () => {
  const s = servisKur();

  it('yer tutucular hem "dönem" hem "donem" yazımını kabul eder', () => {
    expect(s.doldur('{ad} · {dönem} · {donem}', 'AHMET ATALAY', 'Temmuz 2026'))
      .toBe('AHMET ATALAY · Temmuz 2026 · Temmuz 2026');
  });

  it('şirkette unvan, kişide ad soyad kullanılır', () => {
    expect(s.ad({ companyName: 'YGS PLASTİK' })).toBe('YGS PLASTİK');
    expect(s.ad({ firstName: 'Ahmet', lastName: 'Atalay' })).toBe('Ahmet Atalay');
    expect(s.ad({})).toBe('Sayın Mükellef');
  });

  it('dönem adı Türkçe ay ile yazılır', () => {
    expect(s.donemAdi(2026, 7)).toBe('Temmuz 2026');
  });

  it('phones[] öncelikli, yoksa phone alanına düşer', () => {
    expect(s.telefonlar({ phones: ['0555', '0533'], phone: '0111' })).toEqual(['0555', '0533']);
    expect(s.telefonlar({ phones: [], phone: '0111' })).toEqual(['0111']);
    expect(s.telefonlar({})).toEqual([]);
  });
});
