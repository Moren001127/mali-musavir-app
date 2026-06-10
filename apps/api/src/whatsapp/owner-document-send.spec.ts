/**
 * Faz 2 — owner belge gönderme niyet/parça çıkarımı (saf mantık testleri).
 * "gitonun nisan 2026 kdv beyannamesini gönder" gibi mesajları doğru çözmeli;
 * selam/veri sorusu gibi mesajlarda belge akışını TETİKLEMEMELİ.
 */
import { WhatsAppBotController } from './whatsapp-bot.controller';

function ctrl(): any {
  const c: any = Object.create(WhatsAppBotController.prototype);
  return c;
}

describe('Owner belge gönderme — niyet tespiti', () => {
  const c = ctrl();
  it('gönder + beyanname → true', () => {
    expect(c.isOwnerDocumentSendRequest('gitonun nisan 2026 kdv beyannamesini gönder')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('ahmet atalay muhtasar beyannamesini ilet')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('bu faturayı bana yolla')).toBe(true);
  });
  it('sadece soru / selam → false', () => {
    expect(c.isOwnerDocumentSendRequest('gitonun kdv beyannamesi verildi mi')).toBe(false);
    expect(c.isOwnerDocumentSendRequest('merhaba kolay gelsin')).toBe(false);
    expect(c.isOwnerDocumentSendRequest('bu ay kaç beyanname kaldı')).toBe(false);
  });
});

describe('Owner belge gönderme — dönem çıkarımı', () => {
  const c = ctrl();
  it('ay adı + yıl', () => {
    expect(c.extractPeriodFromOwnerText('nisan 2026 kdv')).toBe('2026-04');
    expect(c.extractPeriodFromOwnerText('mayıs 2026 muhtasar')).toBe('2026-05');
  });
  it('YYYY-MM doğrudan', () => {
    expect(c.extractPeriodFromOwnerText('2026-03 beyanname')).toBe('2026-03');
  });
  it('dönem yoksa null', () => {
    expect(c.extractPeriodFromOwnerText('gito kdv beyannamesi gönder')).toBeNull();
  });
});

describe('Owner belge gönderme — beyan tipi çıkarımı', () => {
  const c = ctrl();
  it('kdv → KDV grubu, muhtasar → MUHSGK', () => {
    expect(c.inferBeyanTipiFromOwnerText('kdv beyannamesi')).toEqual(['KDV1', 'KDV2', 'KDV']);
    expect(c.inferBeyanTipiFromOwnerText('muhtasar gönder')).toEqual(['MUHSGK']);
  });
  it('tip yoksa null', () => {
    expect(c.inferBeyanTipiFromOwnerText('beyannameyi gönder')).toBeNull();
  });
});
