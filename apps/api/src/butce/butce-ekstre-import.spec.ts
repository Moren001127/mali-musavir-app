import {
  ButceEkstreImportService,
  baslikBlogunuAt,
  hassasVerileriMaskele,
} from './butce-ekstre-import.service';

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

/**
 * AI'ya kimlik bilgisi gitmemeli. Ama maskeleme tutarı ya da tarihi bozarsa
 * ayrıştırma tümden çöker — bu yüzden "bozmuyor" testleri en kritik olanlar.
 */
describe('butce-ekstre-import — hassas veri maskeleme', () => {
  const svc = new ButceEkstreImportService({} as any, {} as any) as any;

  it('16 haneli kart numarasını son 4 hane kalacak şekilde maskeler', () => {
    expect(hassasVerileriMaskele('Kart No: 5528 7900 1234 9012')).toBe(
      'Kart No: **** **** **** 9012',
    );
    // Bitişik yazım
    expect(hassasVerileriMaskele('5528790012349012')).toBe('**** **** **** 9012');
    // Bankanın kendi yıldızladığı biçim
    expect(hassasVerileriMaskele('5528 **** **** 9012')).toBe('**** **** **** 9012');
    expect(hassasVerileriMaskele('Kart 5528-7900-1234-9012 ile')).toBe(
      'Kart **** **** **** 9012 ile',
    );
    expect(hassasVerileriMaskele('Kart No: 5528 7900 1234 9012')).not.toContain('7900');
  });

  it('TCKN (11 hane) maskelenir', () => {
    const cikti = hassasVerileriMaskele('TC Kimlik No: 12345678901');
    expect(cikti).not.toContain('12345678901');
    expect(cikti).toBe('TC Kimlik No: ***********');
  });

  it('IBAN (TR + 24 hane) maskelenir — boşluklu ve bitişik', () => {
    const bosluklu = hassasVerileriMaskele('IBAN: TR33 0006 1005 1978 6457 8413 26');
    expect(bosluklu).not.toContain('0006');
    expect(bosluklu).not.toContain('8413');
    expect(bosluklu.startsWith('IBAN: TR')).toBe(true);

    const bitisik = hassasVerileriMaskele('IBAN TR330006100519786457841326 hesabına');
    expect(bitisik).not.toMatch(/\d{6}/);
    expect(bitisik).toContain('hesabına');
  });

  it('e-posta adresi maskelenir', () => {
    expect(hassasVerileriMaskele('Bilgi: muzaffer.oren1@banka.com.tr adresine')).toBe(
      'Bilgi: ***@*** adresine',
    );
  });

  it('telefon numarası maskelenir (0 / +90 / boşluklu biçimler)', () => {
    expect(hassasVerileriMaskele('Tel: 05321234567')).not.toContain('5321234567');
    expect(hassasVerileriMaskele('Tel: 0532 123 45 67')).not.toContain('123 45 67');
    expect(hassasVerileriMaskele('Tel: +90 532 123 45 67')).not.toContain('532');
    expect(hassasVerileriMaskele('Tel: 0212 444 0 000')).not.toContain('0212 444');
  });

  it('KRİTİK: tutar ve tarih biçimleri BOZULMAZ', () => {
    const metin = [
      '12.07.2026    MIGROS ISTANBUL                    1.234,56',
      '14.07.2026    SHELL AKARYAKIT ANKARA               890,00',
      'Dönem Borcu        : 12.450,75',
      'Asgari Ödeme Tutarı: 2.490,15',
      'Son Ödeme Tarihi   : 05.08.2026',
      'Hesap Kesim Tarihi : 26.07.2026',
    ].join('\n');
    // Hiçbir satır değişmemeli
    expect(hassasVerileriMaskele(metin)).toBe(metin);
  });

  it('KRİTİK: maskelenmiş metinde kural ayıklaması aynı sonucu verir', () => {
    const metin = [
      'MUZAFFER ÖREN',
      'Kart No: 5528 7900 1234 9012   TCKN: 12345678901',
      'IBAN: TR33 0006 1005 1978 6457 8413 26   Tel: 0532 123 45 67',
      '12.07.2026    MIGROS ISTANBUL                    1.234,56',
      '15.07.2026    IADE - TRENDYOL                       75,50 -',
      '18.07.2026    TEKNOSA TAKSIT 3/12                  450,00',
      'Dönem Borcu        : 12.450,75',
    ].join('\n');
    const maskeli = hassasVerileriMaskele(metin);

    expect(svc.kuralIleSatirlar(maskeli)).toEqual(svc.kuralIleSatirlar(metin));
    expect(svc.kuralIleOzet(maskeli).donemBorcu).toBe(12450.75);
    // Kimlik bilgileri gitmiş olmalı
    expect(maskeli).not.toContain('12345678901');
    expect(maskeli).not.toContain('5528 7900');
    expect(maskeli).not.toContain('0532 123 45 67');
  });

  it('boş/geçersiz girdide patlamaz', () => {
    expect(hassasVerileriMaskele('')).toBe('');
    expect(hassasVerileriMaskele(null as any)).toBe('');
  });
});

describe('butce-ekstre-import — başlık bloğu ve dosya doğrulama', () => {
  it('ad-adres bloğunu atar ama ÖZET satırlarını korur', () => {
    const metin = [
      'MUZAFFER ÖREN',
      'ATATÜRK CADDESİ NO:12 DAİRE:3',
      'KADIKÖY / İSTANBUL',
      'Dönem Borcu : 12.450,75',
      '12.07.2026    MIGROS ISTANBUL     1.234,56',
    ].join('\n');
    const kalan = baslikBlogunuAt(metin);
    expect(kalan).not.toContain('MUZAFFER');
    expect(kalan).not.toContain('KADIKÖY');
    expect(kalan).toContain('Dönem Borcu');
    expect(kalan).toContain('MIGROS');
  });

  it('ilk satır zaten hareket satırıysa metne dokunmaz', () => {
    const metin = '12.07.2026    MIGROS ISTANBUL     1.234,56\n14.07.2026 SHELL 890,00';
    expect(baslikBlogunuAt(metin)).toBe(metin);
  });

  it('PDF imzasını doğrular', () => {
    expect(ButceEkstreImportService.pdfMi(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(ButceEkstreImportService.pdfMi(Buffer.from('PK zip dosyası'))).toBe(false);
    expect(ButceEkstreImportService.pdfMi(Buffer.alloc(0))).toBe(false);
  });
});
