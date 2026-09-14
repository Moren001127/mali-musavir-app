/**
 * EKİP ↔ WHATSAPP köprüsü — bot controller kancaları (PLAN/19 §C, 2026-09-14). owner-document-send.spec kalıbı:
 * controller prototipten kurulur, alanlar elle verilir; EkipWhatsappService sahte (moduleRef.get döner).
 *  - maybeHandleEkipMesaji: ekip yolu değilse false; KURU TEST (__dryRun) → koşu yok, mesaj gitmez, __dryReply dolar;
 *    HTTP kaynağı → Koordinatör'e iletilmez; gerçek akış → sahipMesaji + gönderim + hafıza; "canlı yap" tek başına → önceki mesajla birleşir.
 *  - maybeHandleEkipKomutu: komut değilse false; ekip kaydı değilse (servis null) false → eski akış; ekip kaydıysa cevap gider.
 */
import { WhatsAppBotController } from './whatsapp-bot.controller';

function kanca(servis: any) {
  const c: any = Object.create(WhatsAppBotController.prototype);
  c.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
  c.prisma = {
    aiMessage: { create: jest.fn().mockResolvedValue({ id: 'm' }) },
    aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: 'konusma-1' }), create: jest.fn() },
    communicationLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  };
  c.whatsapp = { sendMessage: jest.fn().mockResolvedValue(true), setTyping: jest.fn().mockResolvedValue(undefined) };
  c.moduleRef = { get: jest.fn(() => servis) };
  c.refreshTaxpayerMemory = jest.fn();
  return c;
}

function sahteServis(sonuc: any = { metin: 'Beyanname Uzmanı başlatıldı.', isId: 'is-1', arkaPlanda: false }): any {
  return {
    sahipMesaji: jest.fn(async (_p: any) => sonuc),
    komutIsle: jest.fn(async (_p: any): Promise<string | null> => null),
  };
}

const tenant = { id: 'tenant-1', name: 'Moren' };

describe('WhatsAppBotController.maybeHandleEkipMesaji (kanca)', () => {
  const eski = process.env.EKIP_WHATSAPP_KOORDINATOR;
  afterAll(() => {
    if (eski === undefined) delete process.env.EKIP_WHATSAPP_KOORDINATOR;
    else process.env.EKIP_WHATSAPP_KOORDINATOR = eski;
  });

  it('ekip yolu olmayan mesaj → false; servis çağrılmaz', async () => {
    const svc = sahteServis();
    const c = kanca(svc);
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', { from: '905350000000', text: 'merhaba nasılsın' })).toBe(false);
    expect(svc.sahipMesaji).not.toHaveBeenCalled();
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('KURU TEST (__dryRun): servise kuruMesaj:true gider, mesaj gitmez, hafıza yazılmaz, cevap __dryReply\'a düşer', async () => {
    const svc = sahteServis({ metin: "Kuru deneme: mesaj Koordinatör'e iletilecekti (kuru test; yönlendirme: beyanname/R1). Koşu başlatılmadı, mesaj gönderilmedi.", isId: null, arkaPlanda: false });
    const c = kanca(svc);
    const msg: any = { from: '905350000000', text: "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın", __dryRun: true };
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', msg)).toBe(true);
    expect(svc.sahipMesaji).toHaveBeenCalledTimes(1);
    expect(svc.sahipMesaji.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1', telefon: '905350000000', kuruMesaj: true, konusmaId: null, sahipKisiId: 'contact-1' });
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(c.prisma.aiMessage.create).not.toHaveBeenCalled();
    expect(msg.__dryKind).toBe('owner:ekip');
    expect(msg.__dryReply).toMatch(/^Kuru deneme: mesaj Koordinatör'e iletilecekti/);
  });

  it('kimliksiz HTTP kaynağı: Koordinatör\'e iletilmez, ret metni gider', async () => {
    const svc = sahteServis();
    const c = kanca(svc);
    const msg: any = { from: '905350000000', text: 'işler ne durumda', __kaynak: 'http' };
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', msg)).toBe(true);
    expect(svc.sahipMesaji).not.toHaveBeenCalled();
    expect(c.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(c.whatsapp.sendMessage.mock.calls[0][1])).toMatch(/gerçek WhatsApp bağlantısından gelmediği için Koordinatör'e İLETİLMEDİ/);
  });

  it('gerçek akış: sahipMesaji (konuşma id + telefon) → cevap gönderilir, kullanıcı+asistan mesajı ekip-koordinator:whatsapp etiketiyle yazılır', async () => {
    const svc = sahteServis({ metin: "İsteğinizi aldım, Koordinatör'e ilettim (iş #is-1). Sonucu buradan yazacağım.", isId: 'is-1', arkaPlanda: true });
    const c = kanca(svc);
    const msg: any = { from: '905350000000', text: 'Ekibe söyle Tahir Sucu denetimini yapsın' };
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', msg)).toBe(true);
    expect(svc.sahipMesaji.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1', telefon: '905350000000', metin: msg.text, kuruMesaj: false, konusmaId: 'konusma-1', sahipKisiId: 'contact-1' });
    expect(c.whatsapp.sendMessage).toHaveBeenCalledWith('905350000000', "İsteğinizi aldım, Koordinatör'e ilettim (iş #is-1). Sonucu buradan yazacağım.", 'tenant-1');
    expect(c.prisma.communicationLog.create.mock.calls[0][0].data.subject).toBe('WhatsApp owner ekip cevabi');
    const yazilan = c.prisma.aiMessage.create.mock.calls.map((x: any) => x[0].data);
    expect(yazilan.map((d: any) => d.role)).toEqual(['user', 'assistant']);
    expect(yazilan[1]).toMatchObject({ conversationId: 'konusma-1', model: 'ekip-koordinator:whatsapp' });
    expect(c.whatsapp.setTyping).toHaveBeenCalled(); // yazıyor… açıldı ve kapandı
  });

  it('"canlı yap" tek başına: önceki sahip mesajı ekip işiyse birleştirilip canlı gider; değilse false', async () => {
    const svc = sahteServis();
    const c = kanca(svc);
    c.sonGelenOwnerMesaji = jest.fn(async () => "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın");
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', { from: '905350000000', text: 'canlı yap' })).toBe(true);
    expect(svc.sahipMesaji.mock.calls[0][0].metin).toBe("Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın — canlı yap");
    const c2 = kanca(sahteServis());
    c2.sonGelenOwnerMesaji = jest.fn(async () => 'selam');
    expect(await c2.maybeHandleEkipMesaji(tenant, 'contact-1', { from: '905350000000', text: 'canlı yap' })).toBe(false);
  });

  it('EKIP_WHATSAPP_KOORDINATOR=off → köprü kapalı, false (eski akış)', async () => {
    process.env.EKIP_WHATSAPP_KOORDINATOR = 'off';
    const svc = sahteServis();
    const c = kanca(svc);
    expect(await c.maybeHandleEkipMesaji(tenant, 'contact-1', { from: '905350000000', text: 'işler ne durumda' })).toBe(false);
    expect(svc.sahipMesaji).not.toHaveBeenCalled();
    delete process.env.EKIP_WHATSAPP_KOORDINATOR;
  });
});

describe('WhatsAppBotController.maybeHandleEkipKomutu (kanca)', () => {
  it('komut değilse / ekip kaydı değilse (servis null) → false, eski akış sürer', async () => {
    const svc = sahteServis();
    const c = kanca(svc);
    expect(await c.maybeHandleEkipKomutu(tenant, 'contact-1', { from: '905350000000', text: 'onaylıyorum' })).toBe(false);
    expect(svc.komutIsle).not.toHaveBeenCalled();
    expect(await c.maybeHandleEkipKomutu(tenant, 'contact-1', { from: '905350000000', text: 'ONAYLIYORUM #PRV-ZZZZ' })).toBe(false);
    expect(svc.komutIsle).toHaveBeenCalledWith({ tenantId: 'tenant-1', tur: 'ONAYLIYORUM', kimlik: 'PRV-ZZZZ', not: '', kuruMesaj: false, kimliksizKaynak: false });
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('ekip kaydı: cevap gönderilir; HTTP kaynağı ve kuru deneme bayrakları servise geçer', async () => {
    const svc = sahteServis();
    svc.komutIsle = jest.fn(async () => '✅ #PRV-1A2B onaylandı, gönderildi (send_whatsapp_message).');
    const c = kanca(svc);
    const msg: any = { from: '905350000000', text: 'onaylıyorum #prv-1a2b', __kaynak: 'http', __dryRun: true };
    expect(await c.maybeHandleEkipKomutu(tenant, 'contact-1', msg)).toBe(true);
    expect(svc.komutIsle.mock.calls[0][0]).toMatchObject({ tur: 'ONAYLIYORUM', kimlik: 'PRV-1A2B', kuruMesaj: true, kimliksizKaynak: true });
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled(); // kuru deneme: __dryReply
    expect(msg.__dryKind).toBe('owner:ekip:onayliyorum');
    const c2 = kanca(svc);
    expect(await c2.maybeHandleEkipKomutu(tenant, 'contact-1', { from: '905350000000', text: 'YAPILDI #cmnyd1a2' })).toBe(true);
    expect(c2.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(c2.prisma.aiMessage.create).toHaveBeenCalledTimes(2);
  });
});
