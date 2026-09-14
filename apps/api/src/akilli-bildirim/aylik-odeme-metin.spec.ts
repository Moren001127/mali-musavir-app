import { odemeCetveliEposta, odemeCetveliMesaji, paraTR, tarihTR, duzMetin, trMoney } from './aylik-odeme-metin';
import { OdemeSatiri } from './aylik-odeme-donem';

const kdv: OdemeSatiri = {
  tur: 'KDV1', turAd: 'KDV Beyannamesi', kaynak: 'VERGI', grup: 'AYLIK', donem: '2026-07',
  sonGun: '28.8.2026', sonGunHam: '28.8.2026', sonGunIso: '2026-08-28', taksit: null, tutar: 7046.77, storageKey: 'k1',
};
const gecici: OdemeSatiri = {
  tur: 'GGECICI', turAd: 'Gelir Geçici Vergi 2. Dönem', kaynak: 'VERGI', grup: 'GECICI', donem: '2026-Q2',
  sonGun: '17.8.2026', sonGunHam: '17.8.2026', sonGunIso: '2026-08-17', taksit: null, tutar: 12300, storageKey: 'k2',
};
const sgk: OdemeSatiri = {
  tur: 'Tahakkuk Fişi', turAd: 'SGK Prim Tahakkuku', kaynak: 'SGK', grup: 'SGK', donem: '2026/07',
  sonGun: '31.8.2026', sonGunHam: '31.8.2026', sonGunIso: '2026-08-31', taksit: null, tutar: 24277.05, storageKey: 's1',
};

describe('aylik-odeme-metin — biçim yardımcıları', () => {
  it('paraTR tr-TR kuruş biçimi; trMoney Hattat çift boşluklu TL', () => {
    expect(paraTR(7046.77)).toBe('7.046,77 ₺');
    expect(paraTR(0)).toBe('0,00 ₺');
    expect(trMoney(4182.86)).toBe('4.182,86  TL');
  });
  it('tarihTR ISO ve sıfırsız g.a.yyyy → gg.aa.yyyy', () => {
    expect(tarihTR('2026-08-28')).toBe('28.08.2026');
    expect(tarihTR('28.8.2026')).toBe('28.08.2026');
    expect(tarihTR(null)).toBe('—');
  });
});

describe('aylik-odeme-metin — WhatsApp cetvel mesajı (Muzaffer Bey\'in ORİJİNAL Hattat kalıbı, değiştirilmez)', () => {
  it('vergi mesajı: Gönderen / Merhaba / Bilginize Sunulmuştur / "KOD - Tahakkuk - Son Ödeme: g.a.yyyy - 1.234,56  TL" / Toplam / link', () => {
    const m = odemeCetveliMesaji({
      month: '2026-08', unvan: 'ADEM CAN', grup: 'VERGI', satirlar: [kdv, gecici],
      linkler: ['https://portal.morenmusavirlik.com/b/abc12345'], senderName: 'MOREN MALİ MÜŞAVİRLİK',
    });
    expect(m).toBe(
      [
        '*Gönderen* ',
        'MOREN MALİ MÜŞAVİRLİK',
        '',
        '*Merhaba* ',
        ' ADEM CAN,',
        '',
        'Aşağıdaki Beyanname Dökümanları Bilginize Sunulmuştur,',
        '',
        'KDV1 - Tahakkuk - Son Ödeme: 28.8.2026 - 7.046,77  TL',
        'GGECICI - Tahakkuk - Son Ödeme: 17.8.2026 - 12.300,00  TL',
        '',
        'Toplam: 19.346,77  TL',
        '',
        'https://portal.morenmusavirlik.com/b/abc12345',
      ].join('\n'),
    );
  });

  it('SGK mesajı: "SGK Dökümanları", satır "Tahakkuk Fişi - 2026/07 - Son Ödeme: 31.8.2026 - 24.277,05  TL"', () => {
    const m = odemeCetveliMesaji({ month: '2026-08', unvan: 'ADEM CAN', grup: 'SGK', satirlar: [sgk], linkler: ['https://p/b/x'], senderName: 'MOREN' });
    expect(m).toContain('Aşağıdaki SGK Dökümanları Bilginize Sunulmuştur,');
    expect(m).toContain('Tahakkuk Fişi - 2026/07 - Son Ödeme: 31.8.2026 - 24.277,05  TL');
    expect(m).toContain('Toplam: 24.277,05  TL\n\nhttps://p/b/x');
  });

  it('link yoksa link bölümü yok; birden çok link alt alta; örnek ön eki başa gelir; son gün yoksa parça atlanır', () => {
    const m = odemeCetveliMesaji({ month: '2026-08', unvan: 'X', grup: 'VERGI', satirlar: [{ ...kdv, sonGun: null }], senderName: 'M' });
    expect(m.endsWith('Toplam: 7.046,77  TL')).toBe(true);
    expect(m).toContain('KDV1 - Tahakkuk - 7.046,77  TL');
    const c = odemeCetveliMesaji({ month: '2026-08', unvan: 'X', grup: 'VERGI', satirlar: [kdv], linkler: ['a', 'b'], senderName: 'M', onEk: '(ÖRNEK · X)' });
    expect(c.startsWith('(ÖRNEK · X)\n*Gönderen* ')).toBe(true);
    expect(c.endsWith('\n\na\nb')).toBe(true);
  });

  it('kaydırılmış son gün (sonGun alanı) mesajda kullanılır', () => {
    const m = odemeCetveliMesaji({ month: '2026-09', unvan: 'X', grup: 'VERGI', satirlar: [{ ...kdv, sonGun: '28.9.2026', sonGunHam: '26.9.2026' }], senderName: 'M' });
    expect(m).toContain('Son Ödeme: 28.9.2026');
  });
});

describe('aylik-odeme-metin — e-posta (orijinal kalıp)', () => {
  it('konu "Beyanname Dökümanları — unvan", metin yıldızsız WhatsApp metni, HTML düz metin', () => {
    const e = odemeCetveliEposta({ month: '2026-08', unvan: 'ADEM CAN', grup: 'VERGI', satirlar: [kdv], linkler: ['https://p/b/x'], senderName: 'MOREN' });
    expect(e.subject).toBe('Beyanname Dökümanları — ADEM CAN');
    expect(e.text.startsWith('Gönderen \nMOREN\n\nMerhaba \n ADEM CAN,')).toBe(true);
    expect(e.text).not.toContain('*');
    expect(e.html).toContain('<pre');
    expect(e.html).toContain('KDV1 - Tahakkuk - Son Ödeme: 28.8.2026 - 7.046,77  TL');
    const s = odemeCetveliEposta({ month: '2026-08', unvan: 'ADEM CAN', grup: 'SGK', satirlar: [sgk], senderName: 'MOREN' });
    expect(s.subject).toBe('SGK Dökümanları — ADEM CAN');
  });

  it('duzMetin yıldız/alt çizgi işaretlerini temizler', () => {
    expect(duzMetin('*a* _b_ c')).toBe('a b c');
  });
});
