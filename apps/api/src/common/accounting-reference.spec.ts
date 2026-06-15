import { TDHP, tdhpAciklama, vergiOraniAciklama, vergiOranlari } from './accounting-reference';

describe('Muhasebe referansı — TDHP + vergi oranı (uydurma yasağı)', () => {
  it('botun YANLIŞ verdiği kodlar artık DOĞRU', () => {
    // Canlı hatalar: bot 101=Banka, 102=Elektronik Para, 110=Müşteriler, 120=Alınan Çekler, 131=Verilen Çekler demişti
    expect(TDHP['100']).toBe('Kasa');
    expect(TDHP['101']).toBe('Alınan Çekler');
    expect(TDHP['102']).toBe('Bankalar');
    expect(TDHP['110']).toBe('Hisse Senetleri');
    expect(TDHP['120']).toBe('Alıcılar');
    expect(TDHP['131']).toBe('Ortaklardan Alacaklar');
    expect(TDHP['191']).toBe('İndirilecek KDV');
    expect(TDHP['391']).toBe('Hesaplanan KDV');
    expect(TDHP['320']).toBe('Satıcılar');
  });

  it('tdhpAciklama kod→isim satırları üretir; bilinmeyen kodu UYDURMAZ', () => {
    const out = tdhpAciklama(['100', '101', '102', '110', '120', '131']);
    expect(out).toContain('101 — Alınan Çekler');
    expect(out).toContain('102 — Bankalar');
    expect(out).not.toContain('Banka Hesapları');
    // standart cetvelde olmayan kod → uydurma yok, açık belirsizlik
    expect(tdhpAciklama(['99999'])).toMatch(/tanımlı değil|bilinmiyor/i);
  });

  it('kurumlar/geçici vergi oranı %25 (flip-flop %20 yok)', () => {
    expect(vergiOranlari().kurumlar).toBe('%25');
    expect(vergiOraniAciklama('kurumlar')).toContain('%25'); // doğru oran %25 (uyarı metni %20'nin geçersizliğini de söyler)
    expect(vergiOraniAciklama('gecici')).toContain('%25');
    // KDV2 tevkifat tek oran değil
    expect(vergiOraniAciklama('kdv2')).toMatch(/değişir|işlem türü/i);
  });
});
