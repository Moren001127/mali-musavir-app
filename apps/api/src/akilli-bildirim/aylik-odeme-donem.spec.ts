import { donemEtiketi, gelirTaksitTutari, hamSonGun, kaydinSecimi, odemeAyiDonemleri, turAdi } from './aylik-odeme-donem';
import { isoGun } from '../schedule/is-gunu';

describe('aylik-odeme-donem — ödeme ayı → dönem anahtarları', () => {
  it('Ağustos 2026: aylık 2026-07 + geçici 2026-Q2 (MUHSGK çeyreği girmez)', () => {
    const s = odemeAyiDonemleri('2026-08');
    expect(s.map((x) => x.donem)).toEqual(['2026-07', '2026-Q2']);
    expect(kaydinSecimi(s, 'GGECICI', '2026-Q2')?.grup).toBe('GECICI');
    expect(kaydinSecimi(s, 'KGECICI', '2026-Q2')?.grup).toBe('GECICI');
    expect(kaydinSecimi(s, 'MUHSGK', '2026-Q2')).toBeNull(); // üç aylık muhtasar Temmuz'da ödenir
    expect(kaydinSecimi(s, 'KDV1', '2026-07')?.grup).toBe('AYLIK');
  });

  it('Temmuz 2026: aylık 2026-06 + üç aylık diğerleri 2026-Q2 (geçici hariç) + GELIR 2. taksit', () => {
    const s = odemeAyiDonemleri('2026-07');
    expect(s.map((x) => x.donem)).toEqual(['2026-06', '2026-Q2', '2025-YIL']);
    expect(kaydinSecimi(s, 'MUHSGK', '2026-Q2')?.grup).toBe('AYLIK');
    expect(kaydinSecimi(s, 'GGECICI', '2026-Q2')).toBeNull();
    expect(kaydinSecimi(s, 'GELIR', '2025-YIL')?.taksit).toBe('2/2');
    expect(kaydinSecimi(s, 'KURUMLAR', '2025-YIL')).toBeNull();
  });

  it('Mart: GELIR 1. taksit; Nisan: KURUMLAR + Q1 üç aylıklar; Şubat 2027: 2026-Q4 geçici; Ocak 2027: 2026-Q4 diğerleri', () => {
    expect(kaydinSecimi(odemeAyiDonemleri('2026-03'), 'GELIR', '2025-YIL')?.taksit).toBe('1/2');
    expect(kaydinSecimi(odemeAyiDonemleri('2026-04'), 'KURUMLAR', '2025-YIL')?.grup).toBe('YILLIK');
    expect(kaydinSecimi(odemeAyiDonemleri('2026-04'), 'MUHSGK', '2026-Q1')?.grup).toBe('AYLIK');
    expect(odemeAyiDonemleri('2027-02').map((x) => x.donem)).toEqual(['2027-01', '2026-Q4']);
    expect(odemeAyiDonemleri('2027-01').map((x) => x.donem)).toEqual(['2026-12', '2026-Q4']);
    expect(kaydinSecimi(odemeAyiDonemleri('2027-01'), 'GGECICI', '2026-Q4')).toBeNull();
  });
});

describe('aylik-odeme-donem — ham son gün', () => {
  const g = (d: Date | null) => (d ? isoGun(d) : null);
  it('aylık tek kaynaktan: KDV1 2026-07 → 28.08, MUHSGK → 26.08, DAMGA → 25.08', () => {
    expect(g(hamSonGun('KDV1', '2026-07', '2026-08'))).toBe('2026-08-28');
    expect(g(hamSonGun('MUHSGK', '2026-07', '2026-08'))).toBe('2026-08-26');
    expect(g(hamSonGun('DAMGA', '2026-07', '2026-08'))).toBe('2026-08-25');
  });
  it('geçici vergi: Q2 → 17 Ağustos, Q4 → 17 Şubat (ertesi yıl)', () => {
    expect(g(hamSonGun('GGECICI', '2026-Q2', '2026-08'))).toBe('2026-08-17');
    expect(g(hamSonGun('KGECICI', '2026-Q4', '2027-02'))).toBe('2027-02-17');
  });
  it('üç aylık muhtasar Q2 → 26 Temmuz; üç aylık KDV Q3 → 28 Ekim', () => {
    expect(g(hamSonGun('MUHSGK', '2026-Q2', '2026-07'))).toBe('2026-07-26');
    expect(g(hamSonGun('KDV1', '2026-Q3', '2026-10'))).toBe('2026-10-28');
  });
  it('yıllık: GELIR Mart 31 / Temmuz 31; KURUMLAR 30 Nisan', () => {
    expect(g(hamSonGun('GELIR', '2025-YIL', '2026-03'))).toBe('2026-03-31');
    expect(g(hamSonGun('GELIR', '2025-YIL', '2026-07'))).toBe('2026-07-31');
    expect(g(hamSonGun('KURUMLAR', '2025-YIL', '2026-04'))).toBe('2026-04-30');
  });
});

describe('aylik-odeme-donem — adlar ve taksit', () => {
  it('turAdi ve donemEtiketi', () => {
    expect(turAdi('KDV1', '2026-07')).toBe('KDV Beyannamesi');
    expect(turAdi('GGECICI', '2026-Q2')).toBe('Gelir Geçici Vergi 2. Dönem');
    expect(turAdi('KGECICI', '2026-Q4')).toBe('Kurum Geçici Vergi 4. Dönem');
    expect(turAdi('GELIR', '2025-YIL', '1/2')).toBe('Yıllık Gelir Vergisi 1. Taksit');
    expect(turAdi('KURUMLAR', '2025-YIL')).toBe('Kurumlar Vergisi');
    expect(turAdi('MUHSGK', '2026-Q2')).toBe('Muhtasar ve Prim Hizmet Beyannamesi (3 aylık)');
    expect(donemEtiketi('2026-07')).toBe('Temmuz 2026');
    expect(donemEtiketi('2026/07')).toBe('Temmuz 2026');
    expect(donemEtiketi('2026-Q2')).toBe('Nisan–Haziran 2026');
    expect(donemEtiketi('2025-YIL')).toBe('2025 Yılı');
  });

  it('GELIR taksit: damga 1. taksitle tam ödenir; yalnız-damga kayıtta 2. taksit sıfır', () => {
    expect(gelirTaksitTutari(1483.7, 2026, '1/2')).toBe(1483.7);
    expect(gelirTaksitTutari(1483.7, 2026, '2/2')).toBe(0);
    expect(gelirTaksitTutari(148683.1, 2026, '1/2')).toBe(75083.4);
    expect(gelirTaksitTutari(148683.1, 2026, '2/2')).toBe(73599.7);
    expect(gelirTaksitTutari(148683.1, 2026, '1/2') + gelirTaksitTutari(148683.1, 2026, '2/2')).toBeCloseTo(148683.1, 2);
    // yılı tabloda olmayan beyanname: kör /2
    expect(gelirTaksitTutari(1000, 2031, '1/2')).toBe(500);
  });
});
