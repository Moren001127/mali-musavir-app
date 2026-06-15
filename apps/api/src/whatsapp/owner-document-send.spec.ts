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
  it('gönder + belge türü → true (beyanname/fatura/evrak/sözleşme/dosya)', () => {
    expect(c.isOwnerDocumentSendRequest('gitonun nisan 2026 kdv beyannamesini gönder')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('ahmet atalay muhtasar beyannamesini ilet')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('gitonun faturasını bana yolla')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('gito sözleşmesini gönder')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('ahmet vergi levhasını at')).toBe(true);
    expect(c.isOwnerDocumentSendRequest('gitonun imza sirkülerini gönder')).toBe(true);
  });
  it('sadece soru / selam → false', () => {
    expect(c.isOwnerDocumentSendRequest('gitonun kdv beyannamesi verildi mi')).toBe(false);
    expect(c.isOwnerDocumentSendRequest('merhaba kolay gelsin')).toBe(false);
    expect(c.isOwnerDocumentSendRequest('bu ay kaç beyanname kaldı')).toBe(false);
  });
});

describe('Owner belge gönderme — kategori çıkarımı', () => {
  const c = ctrl();
  it('belge türünü kategoriye eşler', () => {
    expect(c.inferDocCategory('faturasını gönder')).toBe('FATURA');
    expect(c.inferDocCategory('sözleşmesini ilet')).toBe('SOZLESME');
    expect(c.inferDocCategory('vergi levhasını yolla')).toBe('EVRAK');
    expect(c.inferDocCategory('kdv beyannamesini gönder')).toBe('BEYANNAME');
    expect(c.inferDocCategory('şu dosyayı gönder')).toBeNull();
  });
  it('başlık anahtar kelimeleri mükellef adını ve dolguyu eler', () => {
    const keys = c.docTitleKeywords('gitonun vergi levhasını gönder', 'GİTO GIDA');
    expect(keys).toContain('vergi');
    expect(keys).toContain('levhasini');
    expect(keys).not.toContain('gonder');
    expect(keys).not.toContain('gito');
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

describe('Belge türü çıkarımı (beyanname / tahakkuk / ikisi)', () => {
  const c = ctrl();
  it('beyannamesi → beyanname, tahakkuku → tahakkuk, ikisi → ikisi', () => {
    expect(c.inferBelgeKindFromText('kdv beyannamesini gönder')).toBe('beyanname');
    expect(c.inferBelgeKindFromText('tahakkukunu gönder')).toBe('tahakkuk');
    expect(c.inferBelgeKindFromText('nisan kdv beyannamesi ve tahakkukunu gönder')).toBe('ikisi');
    expect(c.inferBelgeKindFromText('gönderebilir misin')).toBe('ikisi'); // belirsiz → ikisi (güvenli)
  });
});
