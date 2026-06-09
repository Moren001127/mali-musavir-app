import {
  taxDueDate,
  formatTutar,
  buildBeyannameBulkMessage,
  buildCariEkstreMessage,
  buildTebligatMessage,
} from './bulk-message-templates';

describe('bulk-message-templates', () => {
  describe('taxDueDate (vergi takvimi)', () => {
    it('KDV1 / 2026-01 -> 28.2.2026 (ekran örneğiyle aynı)', () => {
      expect(taxDueDate('KDV1', '2026-01')).toBe('28.2.2026');
    });
    it('MUHSGK / 2026-01 -> 26.2.2026 (ekran örneğiyle aynı)', () => {
      expect(taxDueDate('MUHSGK', '2026-01')).toBe('26.2.2026');
    });
    it('bilinmeyen tipte tarih UYDURMAZ (null)', () => {
      expect(taxDueDate('BILINMEYEN', '2026-01')).toBeNull();
    });
    it('geçersiz dönemde null', () => {
      expect(taxDueDate('KDV1', 'bozuk')).toBeNull();
    });
  });

  it('formatTutar Türkçe biçim', () => {
    expect(formatTutar(1064.7)).toBe('1.064,70');
    expect(formatTutar(791)).toBe('791,00');
  });

  it('buildBeyannameBulkMessage ekran örneğini birebir üretir', () => {
    const msg = buildBeyannameBulkMessage({
      ad: 'SABRİ YAŞIN',
      items: [
        { beyanTipi: 'MUHSGK', donem: '2026-01', tahakkukTutari: 1064.7 },
        { beyanTipi: 'KDV1', donem: '2026-01', tahakkukTutari: 791 },
      ],
      link: 'https://www.morenmusavirlik.com/b/abc123',
    });
    expect(msg).toContain('Gönderen: MOREN MALİ MÜŞAVİRLİK');
    expect(msg).toContain('Merhaba SABRİ YAŞIN,');
    expect(msg).toContain('MUHSGK - Tahakkuk - Son Ödeme: 26.2.2026 - 1.064,70 TL');
    expect(msg).toContain('KDV1 - Tahakkuk - Son Ödeme: 28.2.2026 - 791,00 TL');
    expect(msg).toContain('Toplam: 1.855,70 TL');
    expect(msg).toContain('https://www.morenmusavirlik.com/b/abc123');
  });

  it('buildBeyannameBulkMessage bilinmeyen tipte "Son Ödeme: -" yazar', () => {
    const msg = buildBeyannameBulkMessage({
      ad: 'X',
      items: [{ beyanTipi: 'DIGER', donem: '2026-01', tahakkukTutari: 100 }],
    });
    expect(msg).toContain('Son Ödeme: - - 100,00 TL');
  });

  it('buildCariEkstreMessage ekran örneğine uyar', () => {
    const msg = buildCariEkstreMessage({ ad: 'SABRİ YAŞIN', baslangic: '01-08-2025', bitis: '31-03-2026' });
    expect(msg).toContain('Sayın SABRİ YAŞIN,');
    expect(msg).toContain('01-08-2025 / 31-03-2026 Hesap Dökümü');
  });

  it('buildTebligatMessage temel biçim', () => {
    const msg = buildTebligatMessage({ ad: 'Ali Veli', mesaj: 'Ofisimiz 9 Haziran tatil olacaktır.' });
    expect(msg).toContain('Sayın Ali Veli,');
    expect(msg).toContain('Ofisimiz 9 Haziran tatil olacaktır.');
  });
});
