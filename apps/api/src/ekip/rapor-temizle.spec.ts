import { raporTemizle } from './ekip-runner.service';

describe('raporTemizle — rapor bloğu öncesindeki süreç cümleleri atılır (2026-09-13)', () => {
  it('"Yaptığım iş:" öncesi süreç metni ve --- ayraçları düşer', () => {
    const ham = 'İyi, aracı yükledim. Şimdi çekiyorum.\n\n---\n\nYaptığım iş: Kontrol ettim.\nBulgular: temiz.';
    expect(raporTemizle(ham)).toBe('Yaptığım iş: Kontrol ettim.\nBulgular: temiz.');
  });
  it('şablon başlığı (KDV KONTROL — …) rapor başlangıcı sayılır', () => {
    const ham = 'Zinciri kurdum, şimdi yazıyorum.\nKDV KONTROL — Erdoğan Balçık 2026/08 (İşletme) — CANLI\nOturumlar: a · b\n\nYaptığım iş: x';
    expect(raporTemizle(ham).startsWith('KDV KONTROL — Erdoğan Balçık')).toBe(true);
  });
  it('başlık yoksa metin olduğu gibi kalır', () => {
    expect(raporTemizle('  düz cevap  ')).toBe('düz cevap');
  });
});
