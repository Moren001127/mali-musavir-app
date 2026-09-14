import { odemeCetveliEposta, odemeCetveliMesaji, paraTR, tarihTR, duzMetin } from './aylik-odeme-metin';
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
  it('paraTR tr-TR kuruş biçimi', () => {
    expect(paraTR(7046.77)).toBe('7.046,77 ₺');
    expect(paraTR(1320456.7)).toBe('1.320.456,70 ₺');
    expect(paraTR(0)).toBe('0,00 ₺');
  });
  it('tarihTR ISO ve sıfırsız g.a.yyyy → gg.aa.yyyy', () => {
    expect(tarihTR('2026-08-28')).toBe('28.08.2026');
    expect(tarihTR('28.8.2026')).toBe('28.08.2026');
    expect(tarihTR(null)).toBe('—');
  });
});

describe('aylik-odeme-metin — WhatsApp cetvel mesajı', () => {
  it('vergi mesajı sözleşmedeki kalıpla birebir', () => {
    const m = odemeCetveliMesaji({
      month: '2026-08', unvan: 'ADEM CAN', grup: 'VERGI', satirlar: [kdv, gecici],
      linkler: ['https://portal.morenmusavirlik.com/b/abc12345'], senderName: 'Moren Mali Müşavirlik',
    });
    expect(m).toBe(
      [
        '🧾 *Ağustos 2026 Ödeme Cetveli — Vergi*',
        '━━━━━━━━━━━━━━━━━━━━',
        'Sayın ADEM CAN,',
        'bu ay ödenecek vergi tahakkuklarınız:',
        '',
        '▸ KDV Beyannamesi · Temmuz 2026',
        '    Son ödeme 28.08.2026 · 7.046,77 ₺',
        '▸ Gelir Geçici Vergi 2. Dönem · Nisan–Haziran 2026',
        '    Son ödeme 17.08.2026 · 12.300,00 ₺',
        '',
        '*Toplam: 19.346,77 ₺*',
        '📎 Tahakkuk fişleri: https://portal.morenmusavirlik.com/b/abc12345',
        '━━━━━━━━━━━━━━━━━━━━',
        '_Moren Mali Müşavirlik_',
      ].join('\n'),
    );
  });

  it('SGK mesajı: başlık "— SGK", satır "SGK Prim Tahakkuku · Temmuz 2026", tek link "Tahakkuk fişi"', () => {
    const m = odemeCetveliMesaji({ month: '2026-08', unvan: 'ADEM CAN', grup: 'SGK', satirlar: [sgk], linkler: ['L'], senderName: 'MOREN MALİ MÜŞAVİRLİK' });
    expect(m).toContain('🧾 *Ağustos 2026 Ödeme Cetveli — SGK*');
    expect(m).toContain('bu ay ödenecek SGK primleriniz:');
    expect(m).toContain('▸ SGK Prim Tahakkuku · Temmuz 2026\n    Son ödeme 31.08.2026 · 24.277,05 ₺');
    expect(m).toContain('📎 Tahakkuk fişi: L');
    expect(m).toContain('_MOREN MALİ MÜŞAVİRLİK_');
    expect(m).not.toMatch(/Gönderen|Merhaba|Bilginize Sunulmuştur/);
  });

  it('link yoksa 📎 satırı yok; birden çok link alt alta; örnek ön eki başa gelir', () => {
    const yok = odemeCetveliMesaji({ month: '2026-08', unvan: 'X', grup: 'VERGI', satirlar: [kdv], senderName: 'S' });
    expect(yok).not.toContain('📎');
    const cok = odemeCetveliMesaji({ month: '2026-08', unvan: 'X', grup: 'VERGI', satirlar: [kdv], linkler: ['L1', 'L2'], senderName: 'S', onEk: '(ÖRNEK · X)' });
    expect(cok.startsWith('(ÖRNEK · X)\n🧾')).toBe(true);
    expect(cok).toContain('📎 Tahakkuk fişleri:\nL1\nL2');
  });

  it('kaydırılmış son gün mesajda (sonGunIso) kullanılır', () => {
    const kaydirilmis: OdemeSatiri = { ...sgk, sonGun: '2.11.2026', sonGunHam: '31.10.2026', sonGunIso: '2026-11-02' };
    const m = odemeCetveliMesaji({ month: '2026-10', unvan: 'X', grup: 'SGK', satirlar: [kaydirilmis], senderName: 'S' });
    expect(m).toContain('Son ödeme 02.11.2026');
  });
});

describe('aylik-odeme-metin — e-posta', () => {
  it('konu, düz metin ve HTML tablo', () => {
    const e = odemeCetveliEposta({ month: '2026-08', unvan: 'ADEM CAN', grup: 'VERGI', satirlar: [kdv, gecici], linkler: ['L'], senderName: 'Moren Mali Müşavirlik' });
    expect(e.subject).toBe('Ağustos 2026 Ödeme Cetveli — Vergi · ADEM CAN');
    expect(e.text).toContain('Ağustos 2026 Ödeme Cetveli — Vergi');
    expect(e.text).not.toContain('*');
    expect(e.html).toContain('<table');
    expect(e.html).toContain('KDV Beyannamesi');
    expect(e.html).toContain('28.08.2026');
    expect(e.html).toContain('19.346,77 ₺');
    expect(e.html).toContain('href="L"');
  });
  it('duzMetin yıldız/alt çizgi işaretlerini temizler', () => {
    expect(duzMetin('*Toplam: 1 ₺*\n_Ofis_')).toBe('Toplam: 1 ₺\nOfis');
  });
});
