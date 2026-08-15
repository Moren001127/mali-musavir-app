import { ButceEkstreImportService } from './butce-ekstre-import.service';

/**
 * PDF ekstre ayrıştırmasının kural tabanlı (AI'sız) kısmı.
 * Bu kısım her ekstrede ilk çalışan yol olduğu için doğrulanması şart.
 */
describe('butce-ekstre-import — kural tabanlı ayrıştırma', () => {
  const svc = new ButceEkstreImportService({} as any, {} as any) as any;

  it('satıcı anahtarı: şube/şehir/numara gürültüsünü atar', () => {
    expect(ButceEkstreImportService.saticiAnahtari('MIGROS 4321 ISTANBUL')).toBe('migros istanbul');
    expect(ButceEkstreImportService.saticiAnahtari('SHELL AKARYAKIT A.S. ANKARA')).toBe(
      'shell akaryakit ankara',
    );
    // Aynı satıcının farklı şubeleri aynı anahtara düşmeli
    const a = ButceEkstreImportService.saticiAnahtari('BIM BIRLESIK MAGAZALAR 123');
    const b = ButceEkstreImportService.saticiAnahtari('BIM BIRLESIK MAGAZALAR 987');
    expect(a).toBe(b);
  });

  it('para çevirimi Türk biçimini ve eksi işaretini anlar', () => {
    expect(svc.paraCevir('1.234,56')).toBe(1234.56);
    expect(svc.paraCevir('-1.234,56')).toBe(-1234.56);
    expect(svc.paraCevir('89,90')).toBe(89.9);
    expect(svc.paraCevir('')).toBeNull();
    expect(svc.paraCevir('abc')).toBeNull();
  });

  it('ekstre satırlarını tarih + açıklama + tutar olarak çıkarır', () => {
    const metin = [
      'ISLEM TARIHI ACIKLAMA TUTAR',
      '12.07.2026    MIGROS ISTANBUL                    1.234,56',
      '14.07.2026    SHELL AKARYAKIT ANKARA               890,00',
      '15.07.2026    IADE - TRENDYOL                       75,50 -',
      '18.07.2026    TEKNOSA TAKSIT 3/12                  450,00',
      'Bu satır hareket değil',
    ].join('\n');
    const satirlar = svc.kuralIleSatirlar(metin);
    expect(satirlar).toHaveLength(4);
    expect(satirlar[0]).toMatchObject({ tarih: '2026-07-12', tutar: 1234.56 });
    expect(satirlar[0].aciklama).toContain('MIGROS');
    // Sondaki eksi işareti iade demektir
    expect(satirlar[2].tutar).toBe(-75.5);
    // Taksit bilgisi yakalanır
    expect(satirlar[3].taksitBilgi).toBe('3/12');
  });

  it('ekstre özetinden dönem borcu, asgari ve tarihleri okur', () => {
    const metin = [
      'Hesap Kesim Tarihi : 26.07.2026',
      'Son Ödeme Tarihi   : 05.08.2026',
      'Dönem Borcu        : 12.450,75',
      'Asgari Ödeme Tutarı: 2.490,15',
    ].join('\n');
    const ozet = svc.kuralIleOzet(metin);
    expect(ozet.donemBorcu).toBe(12450.75);
    expect(ozet.asgariTutar).toBe(2490.15);
    expect(ozet.kesimTarihi).toBe('2026-07-26');
    expect(ozet.sonOdemeTarihi).toBe('2026-08-05');
  });

  it('özet alanları bulunamazsa null döner, patlamaz', () => {
    const ozet = svc.kuralIleOzet('bambaşka bir belge');
    expect(ozet.donemBorcu).toBeNull();
    expect(ozet.sonOdemeTarihi).toBeNull();
  });

  it('AI çıktısındaki JSON’u kod bloğu içinden ayıklar', () => {
    const veri = svc.jsonAyikla('```json\n{"hareketler":[{"tutar":10}]}\n```');
    expect(veri.hareketler[0].tutar).toBe(10);
  });
});
