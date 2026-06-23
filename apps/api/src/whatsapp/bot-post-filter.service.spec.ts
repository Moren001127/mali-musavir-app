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

  it('owner cevabından iç hata/debug jargonunu (previewId, ok:false) keser', () => {
    const out = svc.filterTaxpayerReply(
      'Fatih Gedik için kontrol başlattım.\nPortal şu an bu kombinasyonu desteklemiyor — edefter_kontrol aksiyonu için uyumlu agent bulunamadı (ok: false, previewId üretilmedi).',
      { mode: 'owner' },
    );
    expect(out).not.toMatch(/previewId/i);
    expect(out.toLowerCase()).not.toContain('ok: false');
    expect(out.toLowerCase()).not.toContain('uyumlu agent');
  });

  it('debug jargonu cevabın tamamıysa güvenli mesaja düşer (owner)', () => {
    const out = svc.filterTaxpayerReply('ok: false, previewId üretilmedi; API katmanı yanıt vermedi.', { mode: 'owner' });
    expect(out).not.toMatch(/previewId|API katman/i);
    expect(out.trim().length).toBeGreaterThan(0);
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

  // ── Eskalasyon sinyalleri (controller deterministik ağı bunları kullanır) ──
  it('isContentFreeStall: içi-boş "kontrol edeyim" savsaklamasını yakalar', () => {
    expect(svc.isContentFreeStall('Bunu bir kontrol edeyim, size net bilgiyle döneyim.')).toBe(true);
    expect(svc.isContentFreeStall('Bir bakıp size döneyim.')).toBe(true);
    expect(svc.isContentFreeStall('Müşavirimiz netleştirir.')).toBe(true);
  });

  it('isContentFreeStall: gerçek veri/rakam içeren cevabı stall SAYMAZ', () => {
    expect(svc.isContentFreeStall('Borcunuz 28.750₺, detayını kontrol edip döneyim.')).toBe(false);
    expect(svc.isContentFreeStall('KDV durumunuz 5.421₺ ödenecek görünüyor.')).toBe(false);
  });

  it('isContentFreeStall: standart eskalasyon cümlesini stall SAYMAZ (ağ döngüye girmesin)', () => {
    expect(
      svc.isContentFreeStall("Konuyu müşavirimiz Muzaffer Bey'e iletiyorum; en kısa sürede sizinle bu konuda iletişime geçecektir."),
    ).toBe(false);
  });

  it('mentionsAiInfra: AI-altyapı terimi sızıntısını yakalar', () => {
    expect(svc.mentionsAiInfra('Mesajınızı aldık, Claude Max bağlantısı geçici yanıt vermediği için ofisimiz dönüş yapacak.')).toBe(true);
    expect(svc.mentionsAiInfra('Anthropic API hattı kapalı.')).toBe(true);
  });

  it('mentionsAiInfra: normal muhasebe cevabını altyapı-sızıntısı SAYMAZ', () => {
    expect(svc.mentionsAiInfra('KDV oranı genel olarak %20, bazı mal/hizmetlerde %10 veya %1.')).toBe(false);
    expect(svc.mentionsAiInfra("Konuyu müşavirimiz Muzaffer Bey'e iletiyorum; en kısa sürede iletişime geçecektir.")).toBe(false);
  });
});
