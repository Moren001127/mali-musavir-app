import { WhatsAppBotPostFilterService } from './bot-post-filter.service';

/**
 * K0.5 kalite/devrik testi: post-filter markdown'ı temizlemeli, boş çıktı
 * bırakmamalı, owner raporlarında satır yapısını korumalı, hassas içerikte
 * güvenli cevaba düşmeli.
 */
describe('WhatsAppBotPostFilterService', () => {
  const svc = new WhatsAppBotPostFilterService();

  it('markdown işaretlerini temizler (mükellef sohbeti)', () => {
    const out = svc.filterTaxpayerReply('## Başlık **kalın** _italik_ `kod`', {});
    expect(out).not.toMatch(/[*_`#]/);
    expect(out).toContain('Başlık');
    expect(out).toContain('kalın');
  });

  it('boş girdide bile anlamlı (boş olmayan) cevap döner', () => {
    const out = svc.filterTaxpayerReply('', {});
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('owner raporunda satır yapısını korur', () => {
    const out = svc.filterTaxpayerReply('📊 DURUM\n\n• Bir madde\n• İki madde', { mode: 'owner' });
    expect(out.split('\n').length).toBeGreaterThan(1);
    expect(out).toContain('Bir madde');
    expect(out).toContain('İki madde');
  });

  it('hassas içerikte güvenli cevaba düşer', () => {
    const out = svc.filterTaxpayerReply('access token: sk-123 paylaşıyorum', {});
    expect(out.toLowerCase()).not.toContain('sk-123');
    expect(out.toLowerCase()).toContain('kontrol');
  });

  it('yalın "şifre" KELİMESİ geçen normal cevabı YUTMAZ (yanlış-pozitif değil)', () => {
    const out = svc.filterTaxpayerReply('Şifrenizi sıfırlamak için portala girip "şifremi unuttum" adımını izleyin.', {});
    expect(out.toLowerCase()).toContain('sıfırla');
    expect(out.toLowerCase()).not.toContain('net bilgiyle döneyim');
  });

  it('en fazla 3 cümleye indirir (sohbet)', () => {
    const out = svc.filterTaxpayerReply('Bir. İki. Üç. Dört. Beş.', {});
    const sentences = out.match(/[^.!?]+[.!?]/g) || [];
    expect(sentences.length).toBeLessThanOrEqual(3);
  });
});
