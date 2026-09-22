/**
 * e-Defter berat takibi — saf yardımcı testleri (Prisma yok).
 *   cd apps/api && npx jest src/beyanname-takip
 * Kural: Sıra No 5 Tebliğ (RG 08.11.2024). Eylül 2026 verilme dönemi → dört grup:
 *   şahıs aylık → Mayıs 2026 (10.09) · firma aylık → Mayıs 2026 (14.09)
 *   şahıs 3 aylık → Nis–Haz 2026 (10.09) · firma 3 aylık → Nis–Haz 2026 (14.09)
 */
import {
  eDefterBaslangicCoz,
  eDefterBeklenenDonemler,
  eDefterBeratVerildiMi,
  eDefterDurumCoz,
  eDefterOzetVergiDonemi,
  eDefterSonYukleme,
  eDefterTercihCoz,
  eDefterTipiCoz,
  type EDefterBeratSatiri,
} from './edefter-takip';

const berat = (donem: string, belgeTuru: string, durumKodu: number | null = 0, alinmaZamani?: string): EDefterBeratSatiri => ({
  donem, belgeTuru, durumKodu, alinmaZamani: alinmaZamani ?? null,
});

describe('e-Defter beklenen dönemler — Eylül 2026 (verilme dönemi)', () => {
  it('şahıs aylık → Mayıs 2026, son gün 10.09.2026', () => {
    const d = eDefterBeklenenDonemler('2026-09', 'VERILME', 'AYLIK', 'SAHIS');
    expect(d.map((x) => x.donem)).toEqual(['2026-05']);
    expect(d[0].sonGun).toBe('2026-09-10');
    expect(d[0].aylar).toEqual(['2026-05']);
    expect(d[0].uzatildi).toBe(false);
  });

  it('firma aylık → Mayıs 2026, son gün 14.09.2026', () => {
    const d = eDefterBeklenenDonemler('2026-09', 'VERILME', 'AYLIK', 'FIRMA');
    expect(d.map((x) => x.donem)).toEqual(['2026-05']);
    expect(d[0].sonGun).toBe('2026-09-14');
  });

  it('şahıs 3 aylık → Nis–Haz 2026 (2026-Q2), son gün 10.09.2026', () => {
    const d = eDefterBeklenenDonemler('2026-09', 'VERILME', 'UCAYLIK', 'SAHIS');
    expect(d.map((x) => x.donem)).toEqual(['2026-Q2']);
    expect(d[0].sonGun).toBe('2026-09-10');
    expect(d[0].aylar).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('firma 3 aylık → Nis–Haz 2026 (2026-Q2), son gün 14.09.2026', () => {
    const d = eDefterBeklenenDonemler('2026-09', 'VERILME', 'UCAYLIK', 'FIRMA');
    expect(d.map((x) => x.donem)).toEqual(['2026-Q2']);
    expect(d[0].sonGun).toBe('2026-09-14');
  });

  it('Ağustos 2026: 3 aylık mükellefe dönem düşmez (çeyrek yükleme ayı değil), aylık şahıs → Nisan 2026', () => {
    expect(eDefterBeklenenDonemler('2026-08', 'VERILME', 'UCAYLIK', 'SAHIS')).toEqual([]);
    expect(eDefterBeklenenDonemler('2026-08', 'VERILME', 'AYLIK', 'SAHIS').map((x) => x.donem)).toEqual(['2026-04']);
  });
});

describe('e-Defter beklenen dönemler — Haziran 2026 sirküler uzatması', () => {
  it('şahıs aylık: Ocak (10 Mayıs → 10 Haziran) + Şubat (10 Haziran) → 30 Haziran (VUK-202)', () => {
    const d = eDefterBeklenenDonemler('2026-06', 'VERILME', 'AYLIK', 'SAHIS');
    expect(d.map((x) => x.donem)).toEqual(['2026-01', '2026-02']);
    for (const x of d) {
      expect(x.sonGun).toBe('2026-06-30');
      expect(x.uzatildi).toBe(true);
      expect(x.uzatmaKaynagi).toContain('VUK-202');
    }
  });

  it('firma aylık: Aralık 2025 (14 Mayıs → 15 Haziran → 30 Haziran) + Ocak + Şubat', () => {
    const d = eDefterBeklenenDonemler('2026-06', 'VERILME', 'AYLIK', 'FIRMA');
    expect(d.map((x) => x.donem)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(d.every((x) => x.sonGun === '2026-06-30')).toBe(true);
  });

  it('şahıs 3 aylık: Oca–Mar 2026 (2026-Q1) → 30 Haziran uzatmalı', () => {
    const d = eDefterBeklenenDonemler('2026-06', 'VERILME', 'UCAYLIK', 'SAHIS');
    expect(d.map((x) => x.donem)).toEqual(['2026-Q1']);
    expect(d[0].sonGun).toBe('2026-06-30');
    expect(d[0].uzatildi).toBe(true);
  });
});

describe('e-Defter başlangıç ayı', () => {
  it('başlangıcı 2026-07 olan firma Eylül 2026’da beklenmez (Mayıs beratı öncesi)', () => {
    expect(eDefterBeklenenDonemler('2026-09', 'VERILME', 'AYLIK', 'FIRMA', '2026-07')).toEqual([]);
    expect(eDefterBeklenenDonemler('2026-09', 'VERILME', 'UCAYLIK', 'FIRMA', '2026-07')).toEqual([]);
  });

  it('başlangıcı 2026-05 olan firma Eylül 2026’da beklenir; Haziran’da yalnız başlangıçtan sonrakiler', () => {
    expect(eDefterBeklenenDonemler('2026-09', 'VERILME', 'AYLIK', 'FIRMA', '2026-05').map((x) => x.donem)).toEqual(['2026-05']);
    expect(eDefterBeklenenDonemler('2026-06', 'VERILME', 'AYLIK', 'FIRMA', '2026-02').map((x) => x.donem)).toEqual(['2026-02']);
  });

  it('geçersiz başlangıç yok sayılır', () => {
    expect(eDefterBaslangicCoz('2026-13')).toBeNull();
    expect(eDefterBaslangicCoz('')).toBeNull();
    expect(eDefterBaslangicCoz(null)).toBeNull();
    expect(eDefterBaslangicCoz('2026-07')).toBe('2026-07');
    expect(eDefterBeklenenDonemler('2026-09', 'VERILME', 'AYLIK', 'FIRMA', '2026-13').map((x) => x.donem)).toEqual(['2026-05']);
  });
});

describe('e-Defter vergi dönemi görünümü', () => {
  it('aylık → seçilen ay; 3 aylık → yalnız 3/6/9/12’de çeyrek', () => {
    expect(eDefterBeklenenDonemler('2026-08', 'VERGI', 'AYLIK', 'SAHIS').map((x) => x.donem)).toEqual(['2026-08']);
    expect(eDefterBeklenenDonemler('2026-08', 'VERGI', 'UCAYLIK', 'SAHIS')).toEqual([]);
    const q3 = eDefterBeklenenDonemler('2026-09', 'VERGI', 'UCAYLIK', 'FIRMA');
    expect(q3.map((x) => x.donem)).toEqual(['2026-Q3']);
    expect(q3[0].sonGun).toBe('2026-12-14');
  });

  it('vergi görünümünde de başlangıç ayı uygulanır', () => {
    expect(eDefterBeklenenDonemler('2026-05', 'VERGI', 'AYLIK', 'SAHIS', '2026-07')).toEqual([]);
  });
});

describe('verildi kararı (KB + YB, durumKodu 0)', () => {
  it('KB + YB durumKodu 0 → onaylandı', () => {
    expect(eDefterDurumCoz(['2026-05'], [berat('2026-05', 'KB'), berat('2026-05', 'YB')])).toBe('onaylandi');
  });

  it('KB var YB yok → kalan', () => {
    expect(eDefterDurumCoz(['2026-05'], [berat('2026-05', 'KB'), berat('2026-05', 'Y')])).toBe('kalan');
    expect(eDefterBeratVerildiMi(['2026-05'], [berat('2026-05', 'KB')])).toBe(false);
  });

  it('durumKodu 0 olmayan berat sayılmaz', () => {
    expect(eDefterDurumCoz(['2026-05'], [berat('2026-05', 'KB', 1), berat('2026-05', 'YB', 0)])).toBe('kalan');
    expect(eDefterDurumCoz(['2026-05'], [berat('2026-05', 'KB', null), berat('2026-05', 'YB', 0)])).toBe('kalan');
  });

  it('3 aylık dönemde HER ay gerekir: iki ay tam, üçüncü eksik → kalan', () => {
    const aylar = ['2026-04', '2026-05', '2026-06'];
    const ikiAy = [berat('2026-04', 'KB'), berat('2026-04', 'YB'), berat('2026-05', 'KB'), berat('2026-05', 'YB')];
    expect(eDefterDurumCoz(aylar, ikiAy)).toBe('kalan');
    expect(eDefterDurumCoz(aylar, [...ikiAy, berat('2026-06', 'KB'), berat('2026-06', 'YB')])).toBe('onaylandi');
  });

  it('berat yoksa elle "onaylandi" işareti onaylandı sayar; başka işaret saymaz', () => {
    expect(eDefterDurumCoz(['2026-05'], [], 'onaylandi')).toBe('onaylandi');
    expect(eDefterDurumCoz(['2026-05'], [], 'hatali')).toBe('kalan');
    expect(eDefterDurumCoz(['2026-05'], [], null)).toBe('kalan');
  });

  it('son yükleme = KB/YB içindeki en geç GİB yükleme zamanı', () => {
    const satirlar = [
      berat('2026-05', 'KB', 0, '2026-09-14T11:40:00.000Z'),
      berat('2026-05', 'YB', 0, '2026-09-14T11:42:00.000Z'),
      berat('2026-05', 'Y', 0, '2026-09-15T08:00:00.000Z'), // defter dosyası sayılmaz
    ];
    expect(eDefterSonYukleme(['2026-05'], satirlar)).toBe('2026-09-14T11:42:00.000Z');
    expect(eDefterSonYukleme(['2026-05'], [])).toBeNull();
  });
});

describe('tercih / tip / özet dönem anahtarı', () => {
  it('tercih yalnız AYLIK / UCAYLIK', () => {
    expect(eDefterTercihCoz('AYLIK')).toBe('AYLIK');
    expect(eDefterTercihCoz('UCAYLIK')).toBe('UCAYLIK');
    expect(eDefterTercihCoz(null)).toBeNull();
    expect(eDefterTercihCoz('ON_BES_GUNLUK')).toBeNull();
  });

  it('tüzel kişi → FIRMA (14’ü), gerçek kişi → SAHIS (10’u); tür yoksa yıllık vergi türüne bakılır', () => {
    expect(eDefterTipiCoz('TUZEL_KISI', 'GELIR')).toBe('FIRMA');
    expect(eDefterTipiCoz('GERCEK_KISI', 'KURUMLAR')).toBe('SAHIS');
    expect(eDefterTipiCoz(null, 'KURUMLAR')).toBe('FIRMA');
    expect(eDefterTipiCoz(undefined, null)).toBe('SAHIS');
  });

  it('özet satırının vergiDonem alanı: verilme Eylül 2026 → 2026-05; vergi görünümünde seçilen ay', () => {
    expect(eDefterOzetVergiDonemi('2026-09', 'VERILME', ['2026-Q2', '2026-05'])).toBe('2026-05');
    expect(eDefterOzetVergiDonemi('2026-09', 'VERILME', [])).toBe('2026-05');
    expect(eDefterOzetVergiDonemi('2026-09', 'VERGI', ['2026-09'])).toBe('2026-09');
    // Mayıs 2026: aylık son günler uzatmayla Haziran'a kaydı → küme boş → 4 ay geri (Ocak)
    expect(eDefterOzetVergiDonemi('2026-05', 'VERILME', [])).toBe('2026-01');
  });
});
