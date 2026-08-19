import { telefonAnahtari, telefonAdi, telefonAdlariHaritasi, telefonRakamlari } from './telefon';

/**
 * TELEFON REHBERİ — sessiz başarısızlığa karşı kilit.
 *
 * Ad, numara ANAHTARIYLA saklanıyor. Kullanıcı karta "0533 923 36 74" yazar,
 * WhatsApp "905339233674" getirir. İki taraf aynı anahtarı üretmezse ad hiç
 * görünmez — ve ekran HATA VERMEZ, sessizce boş kalır. Bu yüzden burada her
 * gerçek yazım biçimi tek tek kilitli.
 */

describe('telefon anahtarı — aynı numaranın her yazımı aynı anahtarı üretir', () => {
  const beklenen = '905339233674';

  it('kullanıcının karta yazdığı biçimler', () => {
    for (const g of [
      '0533 923 36 74',
      '0(533) 923 36 74',
      '0533-923-36-74',
      '05339233674',
    ]) {
      expect(telefonAnahtari(g)).toBe(beklenen);
    }
  });

  it('WhatsApp/uluslararası biçimler', () => {
    for (const g of [
      '905339233674',
      '+90 533 923 36 74',
      '+905339233674',
      '00905339233674',
    ]) {
      expect(telefonAnahtari(g)).toBe(beklenen);
    }
  });

  it('başında sıfır olmadan (10 hane)', () => {
    expect(telefonAnahtari('5339233674')).toBe(beklenen);
  });

  it('boş girdi boş anahtar üretir — eşleşme denenmez', () => {
    expect(telefonAnahtari('')).toBe('');
    expect(telefonAnahtari(null)).toBe('');
    expect(telefonAnahtari(undefined)).toBe('');
    expect(telefonAnahtari('   ')).toBe('');
  });

  it('sabit hat da bozulmadan geçer — veri kaybetme', () => {
    // 0212... 11 hane, aynı kural: baştaki 0 atılıp 90 eklenir
    expect(telefonAnahtari('0212 555 44 33')).toBe('902125554433');
  });

  it('çözülemeyen girdi rakamlarıyla döner, kırpılmaz', () => {
    expect(telefonAnahtari('123')).toBe('123');
  });

  it('rakam ayıklama harf ve işaretleri atar', () => {
    expect(telefonRakamlari('0(533) 923-36 74 dahili')).toBe('05339233674');
  });
});

describe('telefon adı — harita okuma', () => {
  const ham = {
    '0533 923 36 74': 'Umut Balçık',
    '905079270870': 'Muhasebeci Ayşe',
  };

  it('kart farklı, WhatsApp farklı yazsa da ad bulunur', () => {
    // Haritada "0533 923 36 74" yazıyor, WhatsApp "905339233674" soruyor
    expect(telefonAdi(ham, '905339233674')).toBe('Umut Balçık');
    // Tersi de doğru
    expect(telefonAdi(ham, '0507 927 08 70')).toBe('Muhasebeci Ayşe');
  });

  it('kayıtsız numara için null — firma adına düşülsün', () => {
    expect(telefonAdi(ham, '905550001122')).toBeNull();
  });

  it('boş/bozuk harita çökertmez', () => {
    expect(telefonAdi(null, '905339233674')).toBeNull();
    expect(telefonAdi(undefined, '905339233674')).toBeNull();
    expect(telefonAdi('metin', '905339233674')).toBeNull();
    expect(telefonAdi([], '905339233674')).toBeNull();
  });

  it('boş ad kaydı yok sayılır — boş başlık gösterilmesin', () => {
    expect(telefonAdi({ '905339233674': '   ' }, '905339233674')).toBeNull();
    expect(telefonAdi({ '905339233674': '' }, '905339233674')).toBeNull();
  });

  it('harita anahtarları normalize edilerek kurulur', () => {
    const h = telefonAdlariHaritasi({ '0533 923 36 74': 'Umut' });
    expect(h.get('905339233674')).toBe('Umut');
    expect(h.size).toBe(1);
  });
});
