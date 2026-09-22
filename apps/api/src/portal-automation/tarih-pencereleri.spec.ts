/**
 * GİB e-Arşiv 7 gün sınırı (2026-09-22): ay sorgusu 7'şer günlük pencerelere bölünür.
 * Pencereler ARDIŞIK ve ÇAKIŞMAZ olmalı — aksi hâlde fatura ya kaçar ya mükerrer listelenir.
 */
import { EARSIV_PENCERE_GUN, gunBasi, tarihPencereleri } from './tarih-pencereleri';

describe('tarih pencereleri (GİB e-Arşiv 7 gün sınırı)', () => {
  it('31 günlük ay → 5 pencere, hepsi ≤7 gün, boşluk/çakışma yok', () => {
    const p = tarihPencereleri('2026-08-01', '2026-08-31');
    expect(p).toEqual([
      { bas: '2026-08-01', bit: '2026-08-07' },
      { bas: '2026-08-08', bit: '2026-08-14' },
      { bas: '2026-08-15', bit: '2026-08-21' },
      { bas: '2026-08-22', bit: '2026-08-28' },
      { bas: '2026-08-29', bit: '2026-08-31' },
    ]);
    // ardışıklık: her pencerenin başı, öncekinin bitişinin ertesi günü
    for (let i = 1; i < p.length; i++) {
      const oncekiBitis = Date.parse(p[i - 1].bit + 'T00:00:00Z');
      const buBas = Date.parse(p[i].bas + 'T00:00:00Z');
      expect(buBas - oncekiBitis).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('şubat (28 gün) tam 4 pencere; artık yıl 29 gün → 5. pencere tek gün', () => {
    expect(tarihPencereleri('2026-02-01', '2026-02-28')).toHaveLength(4);
    const artik = tarihPencereleri('2024-02-01', '2024-02-29');
    expect(artik).toHaveLength(5);
    expect(artik[4]).toEqual({ bas: '2024-02-29', bit: '2024-02-29' });
  });

  it('7 gün ve altı aralık TEK pencere kalır (davranış değişmez)', () => {
    expect(tarihPencereleri('2026-09-01', '2026-09-07')).toEqual([{ bas: '2026-09-01', bit: '2026-09-07' }]);
    expect(tarihPencereleri('2026-09-10', '2026-09-10')).toEqual([{ bas: '2026-09-10', bit: '2026-09-10' }]);
  });

  it('ay sonu → ay başı geçişi ve yıl geçişi doğru', () => {
    expect(tarihPencereleri('2026-12-28', '2027-01-03')).toEqual([{ bas: '2026-12-28', bit: '2027-01-03' }]);
    const ceyrek = tarihPencereleri('2026-01-01', '2026-03-31');
    expect(ceyrek[0].bas).toBe('2026-01-01');
    expect(ceyrek[ceyrek.length - 1].bit).toBe('2026-03-31');
    expect(ceyrek.every((x) => (Date.parse(x.bit) - Date.parse(x.bas)) / 86400000 <= EARSIV_PENCERE_GUN - 1)).toBe(true);
  });

  it('ters aralık tek günlük pencere; bozuk tarih boş dizi (çağıran eski yola düşsün)', () => {
    expect(tarihPencereleri('2026-08-31', '2026-08-01')).toEqual([{ bas: '2026-08-31', bit: '2026-08-31' }]);
    expect(tarihPencereleri('', '2026-08-01')).toEqual([]);
    expect(tarihPencereleri('dün', 'bugün')).toEqual([]);
    expect(tarihPencereleri(null, null)).toEqual([]);
  });

  it('farklı tarih biçimleri okunur (Date, ISO saatli, 31.08.2026, 31/08/2026)', () => {
    expect(gunBasi(new Date('2026-08-15T21:30:00Z'))?.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(gunBasi('2026-08-15T10:00:00.000Z')?.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(gunBasi('31.08.2026')?.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(gunBasi('31/08/2026')?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('pencere boyu ayarlanabilir (GİB sınırı değişirse tek yerden)', () => {
    expect(tarihPencereleri('2026-08-01', '2026-08-10', 3)).toEqual([
      { bas: '2026-08-01', bit: '2026-08-03' },
      { bas: '2026-08-04', bit: '2026-08-06' },
      { bas: '2026-08-07', bit: '2026-08-09' },
      { bas: '2026-08-10', bit: '2026-08-10' },
    ]);
  });
});
