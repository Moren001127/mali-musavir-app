/**
 * WhatsApp'tan görev / hatırlatma / not ekleme — kapı + kayıt + cevap metni.
 *   cd apps/api && npx jest src/whatsapp/gorev-whatsapp
 * "Şimdi" sabit: 14 Eylül 2026 Pazartesi 11:30 İstanbul (= 08:30Z) — ortak ayrıştırıcı testiyle aynı gün.
 */
jest.mock('../common/max-inference', () => ({
  MAX_MODEL_DEFAULT: 'sahte-model',
  isMaxAvailable: jest.fn(() => false),
  claudeTextViaMax: jest.fn(async () => ({ ok: false, text: '', error: 'kapalı' })),
}));
import { claudeTextViaMax, isMaxAvailable } from '../common/max-inference';
import { GorevWhatsappService, istanbulDuvarSaati, tarihEtiketi, vadeTarihi } from './gorev-whatsapp.service';
const IMZA = '_Elif · Moren Ofis Asistanı_';
const CIZGI = '━━━━━━━━━━━━━━━━━━━━';

const SIMDI = new Date('2026-09-14T08:30:00.000Z'); // 14.09.2026 11:30 İstanbul, Pazartesi
const MUKELLEFLER = [
  { id: 'm1', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '1234567890' },
  { id: 'm2', companyName: 'Erdoğan Balçık', firstName: null, lastName: null, taxNumber: '2345678901' },
  { id: 'm3', companyName: null, firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '3456789012' },
  { id: 'm4', companyName: 'Mert Reklam Ajansı Ltd. Şti.', firstName: null, lastName: null, taxNumber: '4567890123' },
  { id: 'm5', companyName: 'Famcoffee Kahve A.Ş.', firstName: null, lastName: null, taxNumber: '5678901234' },
  { id: 'm6', companyName: 'Ela Tekstil Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6789012345' },
];
const KIMLIK = { tenantId: 'tenant-1', userId: 'user-sahip' };

function sahtePrisma() {
  return {
    taxpayer: { findMany: jest.fn().mockResolvedValue(MUKELLEFLER) },
    task: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'gorev-1', ...data })) },
  };
}

function kur() {
  const prisma = sahtePrisma();
  const servis = new GorevWhatsappService(prisma as any);
  return { prisma, servis };
}

describe('GorevWhatsappService.gorevIstegiMi (kapı)', () => {
  const olumlu = [
    'Öz Ela KDV kontrolü yarın 10:00 hatırlat',
    'görev ekle: Mert Reklam tahsilat araması cuma',
    'not: SİLBER Luca\'da açılmadı',
    'hatırlat: banka ekstrelerini iste 3 gün sonra',
    'Görev yaz: ofis kirasını öde ayın 5\'i',
    'yeni görev Ayşegül bordro',
    'hatırlatma ekle: muhtasar 26 eylül',
    'Hatırlatma: geçici vergi son gün 17 kasım',
    'not ekle: Muzaffer Bey ile konuşuldu',
    'bana yarın sabah Famcoffee faturalarını hatırlatır mısın',
    'cuma tahsilat aramalarini hatirlatsana', // Türkçe harfsiz yazım
    'GÖREV EKLE: ERDOĞAN BALÇIK KDV', // büyük harf
    'görev: 15.09 muhtasar',
    'Ödeme yapmayı hatırlat: Ziraat kartı borcu 95.000 yarın', // "borç" bütçe sözcüğü ama açık hatırlatma
  ];
  const olumsuz = [
    'bugün 850 TL market harcaması yaptım işle',
    'Ziraat kartı borcu 95.000',
    'ofisten 20 bin çektim',
    'Öz Ela\'ya evraklarını getirmesini söyle',
    'Öz Ela\'ya evraklarını getirmesini ilet',
    'edelerden 5000 TL fatura kes',
    'merhaba',
    '',
    'Öz Ela\'ya KDV ödemesini hatırlat, mesaj at', // hatırlat + iletme fiili
    'Mert Reklam\'a yaz, ekstreleri hatırlat', // "yaz" + mükellefe hitap
    'hatırlatma gönder mükelleflere', // isim + gönder
    'evrak hatırlatma mesajı gönderelim',
    'görevler neler', // ekle/iki nokta yok
    'görev listesi',
    'Öz Ela\'nın KDV\'sini hatırlat, gönderir misin',
  ];
  it.each(olumlu)('EVET: %s', (metin) => {
    expect(GorevWhatsappService.gorevIstegiMi(metin)).toBe(true);
  });
  it.each(olumsuz)('HAYIR: %s', (metin) => {
    expect(GorevWhatsappService.gorevIstegiMi(metin)).toBe(false);
  });
});

describe('GorevWhatsappService.onekiAyir', () => {
  it('öneki ve "hatırlat" fiilini çıkarır', () => {
    expect(GorevWhatsappService.onekiAyir('görev ekle: Mert Reklam tahsilat araması cuma')).toEqual({ govde: 'Mert Reklam tahsilat araması cuma', onekNot: false });
    expect(GorevWhatsappService.onekiAyir('Öz Ela KDV kontrolü yarın 10:00 hatırlat')).toEqual({ govde: 'Öz Ela KDV kontrolü yarın 10:00', onekNot: false });
    expect(GorevWhatsappService.onekiAyir('bana yarın sabah Famcoffee faturalarını hatırlatır mısın')).toEqual({ govde: 'yarın sabah Famcoffee faturalarını', onekNot: false });
    expect(GorevWhatsappService.onekiAyir('not: SİLBER Luca\'da açılmadı')).toEqual({ govde: 'SİLBER Luca\'da açılmadı', onekNot: true });
    expect(GorevWhatsappService.onekiAyir('not ekle: Muzaffer Bey ile konuşuldu')).toEqual({ govde: 'Muzaffer Bey ile konuşuldu', onekNot: true });
    expect(GorevWhatsappService.onekiAyir('hatırlat: banka ekstrelerini iste 3 gün sonra')).toEqual({ govde: 'banka ekstrelerini iste 3 gün sonra', onekNot: false });
    expect(GorevWhatsappService.onekiAyir('GÖREV EKLE: ERDOĞAN BALÇIK KDV')).toEqual({ govde: 'ERDOĞAN BALÇIK KDV', onekNot: false });
  });
  it('"hatırlatma" ismini (ekle/iki nokta olmadan) başlıktan silmez', () => {
    expect(GorevWhatsappService.onekiAyir('hatırlatma ekle: KDV hatırlatma yazısı hazırla').govde).toBe('KDV hatırlatma yazısı hazırla');
  });
});

describe('tarih yardımcıları', () => {
  it('istanbulDuvarSaati: UTC 22:30 → İstanbul ertesi gün 01:30 (yerel alanlar)', () => {
    const d = istanbulDuvarSaati(new Date('2026-09-14T22:30:00.000Z'));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 15, 1, 30]);
  });
  it('vadeTarihi: İstanbul saatiyle (+03:00) — portal vadeIso ile aynı an', () => {
    expect(vadeTarihi('2026-09-15', '10:00')?.toISOString()).toBe('2026-09-15T07:00:00.000Z');
    expect(vadeTarihi('2026-09-18', null)?.toISOString()).toBe('2026-09-17T21:00:00.000Z');
    expect(vadeTarihi('bozuk', null)).toBeNull();
  });
  it('tarihEtiketi: Bugün / Yarın / gün adı', () => {
    const bugun = istanbulDuvarSaati(SIMDI);
    expect(tarihEtiketi('2026-09-14', bugun)).toBe('Bugün 14.09.2026');
    expect(tarihEtiketi('2026-09-15', bugun)).toBe('Yarın 15.09.2026');
    expect(tarihEtiketi('2026-09-16', bugun)).toBe('Çarşamba 16.09.2026');
    expect(tarihEtiketi('2026-09-18', bugun)).toBe('Cuma 18.09.2026');
  });
});

describe('GorevWhatsappService.islemYap (sahte prisma)', () => {
  it('saatli görev: Öz Ela KDV kontrolü yarın 10:00 hatırlat', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'Öz Ela KDV kontrolü yarın 10:00 hatırlat', { simdi: SIMDI });

    expect(prisma.taxpayer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }));
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: 'tenant-1',
      createdById: 'user-sahip',
      title: 'Öz Ela KDV kontrolü',
      description: null,
      category: 'KDV_KONTROL',
      priority: 'MEDIUM',
      tags: [],
      taxpayerId: 'm1',
      dueTime: '10:00',
      allDay: false,
      kaynak: 'WHATSAPP',
      tur: 'GOREV',
      notifyInApp: true,
      notifyBrowser: true,
      notifyWhatsapp: true,
      notifyPush: true,
      notifyEmail: false,
    });
    expect(data.dueDate.toISOString()).toBe('2026-09-15T07:00:00.000Z'); // 15.09.2026 10:00 İstanbul
    expect(data).not.toHaveProperty('hatirlatUserIds');

    expect(cevap).toBe(
      [
        '✅ *Görev eklendi*',
        CIZGI,
        '*Öz Ela Gıda San. ve Tic. Ltd. Şti.* — Öz Ela KDV kontrolü',
        'Yarın 15.09.2026 10:00 · KDV Kontrol',
        '',
        // 1 gün önce 10:00 = bugün 10:00 (11:30'da GEÇMİŞ → gösterilmez); vade günü 30 dk önce 09:30
        '🔔 Hatırlatma: yarın 09:30 → portal · telefon · WhatsApp',
        CIZGI,
        IMZA,
      ].join('\n'),
    );
  });

  it('önekli, günlü, acil: görev ekle: Mert Reklam tahsilat araması cuma acil', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle: Mert Reklam tahsilat araması cuma acil', { simdi: SIMDI });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Mert Reklam tahsilat araması', category: 'TAHSILAT', priority: 'URGENT', taxpayerId: 'm4', dueTime: null, allDay: true, tur: 'GOREV', kaynak: 'WHATSAPP' });
    expect(data.dueDate.toISOString()).toBe('2026-09-17T21:00:00.000Z'); // 18.09.2026 00:00 İstanbul
    expect(cevap).toContain('✅ *Görev eklendi*');
    expect(cevap).toContain('*Mert Reklam Ajansı Ltd. Şti.* — Mert Reklam tahsilat araması');
    expect(cevap).toContain('Cuma 18.09.2026 · 🔴 Acil · Tahsilat');
    expect(cevap).toContain('🔔 Hatırlatma: 17.09 09:00 ve 18.09 09:00 → portal · telefon · WhatsApp');
  });

  it('not: tür NOT, vadesiz, kategori DIGER', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'not: SİLBER Luca\'da açılmadı', { simdi: SIMDI });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'SİLBER Luca\'da açılmadı', tur: 'NOT', kaynak: 'WHATSAPP', dueDate: null, dueTime: null, allDay: true, category: 'DIGER', priority: 'MEDIUM', taxpayerId: null });
    expect(cevap).toBe(['📝 *Not eklendi*', CIZGI, '*SİLBER Luca\'da açılmadı*', 'Diğer', CIZGI, IMZA].join('\n'));
  });

  it('hatırlat: öneki + "3 gün sonra" + banka kategorisi', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'hatırlat: banka ekstrelerini iste 3 gün sonra', { simdi: SIMDI });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Banka ekstrelerini iste', category: 'BANKA', tur: 'GOREV', taxpayerId: null }); // ilk harf büyük
    expect(data.dueDate.toISOString()).toBe('2026-09-16T21:00:00.000Z'); // 17.09.2026 00:00 İstanbul
    expect(cevap).toContain('*Banka ekstrelerini iste*\nPerşembe 17.09.2026 · Banka');
  });

  it('belirsiz mükellef: görev mükellefsiz kaydedilir, adaylar cevapta', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'Ela ekstre iste yarın hatırlat', { simdi: SIMDI });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data.taxpayerId).toBeNull();
    expect(data.title).toBe('Ela ekstre iste');
    expect(cevap).toContain('👤 Mükellef netleşmedi — adaylar: ');
    expect(cevap).toContain('Ela Tekstil Ltd. Şti.');
    expect(cevap).toContain('Öz Ela Gıda San. ve Tic. Ltd. Şti.');
    expect(cevap).toContain('(portaldan seçin)');
    expect(String(cevap).split('\n')[2]).toBe('*Ela ekstre iste*'); // başlık satırında mükellef yok
  });

  it('bugün vadeli: hatırlatma satırı yalnız vade günü', async () => {
    const { servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle: Ayşegül Kaya bordro bugün 15:00', { simdi: SIMDI });
    expect(cevap).toContain('Bugün 14.09.2026 15:00 · Bordro/SGK');
    expect(cevap).toContain('🔔 Hatırlatma: bugün 14:30 → portal · telefon · WhatsApp');
  });

  it('kuru test: kayıt YAZILMAZ, cevap KURU TEST ile başlar', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle: Famcoffee fatura kontrolü yarın', { simdi: SIMDI, kuru: true });
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(cevap?.startsWith('KURU TEST (kaydedilmedi)\n✅ *Görev eklendi*')).toBe(true);
    expect(cevap).toContain('*Famcoffee Kahve A.Ş.* — Famcoffee fatura kontrolü');
  });

  it('Max düzeltmesi: serbest cümle → düzgün başlık + açıklama; mükellef yalnız adaylardan; tarih/saat kuraldan', async () => {
    (isMaxAvailable as jest.Mock).mockReturnValueOnce(true);
    (claudeTextViaMax as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: '```json\n{"baslik":"Ceza ihbarnamelerine uzlaşma / indirim talebi","aciklama":"Öz Ela Turizm\'e gelen ceza ihbarnameleri için uzlaşma ya da indirim talep edilecek.","tarih":"2026-09-15","saat":null,"kategori":"DIGER","oncelik":"MEDIUM","mukellefId":"m1","tur":"GOREV"}\n```',
    });
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'öz ela gıda ya gelen ceza ihbarnamelerine uzlaşma ya da indirim talep edilecek bana bunu yarın hatırlat', { simdi: SIMDI });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Ceza ihbarnamelerine uzlaşma / indirim talebi', description: 'Öz Ela Turizm\'e gelen ceza ihbarnameleri için uzlaşma ya da indirim talep edilecek.', taxpayerId: 'm1', category: 'DIGER', tur: 'GOREV' });
    expect(data.dueDate.toISOString()).toBe('2026-09-14T21:00:00.000Z'); // 15.09 00:00 İstanbul
    const prompt = String((claudeTextViaMax as jest.Mock).mock.calls[0][0].prompt);
    expect(prompt).toContain('Bugün: 2026-09-14 (Pazartesi)');
    expect(prompt).toContain('m1 · Öz Ela Gıda San. ve Tic. Ltd. Şti.');
    expect(cevap).toContain('*Öz Ela Gıda San. ve Tic. Ltd. Şti.* — Ceza ihbarnamelerine uzlaşma / indirim talebi');
    expect(cevap).toContain('_Öz Ela Turizm\'e gelen ceza ihbarnameleri için uzlaşma ya da indirim talep edilecek._');
    expect(cevap).toContain('🔔 Hatırlatma: yarın 09:00 → portal · telefon · WhatsApp');
  });

  it('Max düzeltmesi: geçersiz mükellefId / kategori / tarih → kural değerleri korunur; Max hata → kural', async () => {
    (isMaxAvailable as jest.Mock).mockReturnValueOnce(true);
    (claudeTextViaMax as jest.Mock).mockResolvedValueOnce({ ok: true, text: '{"baslik":"KDV kontrolü","aciklama":null,"tarih":"yarın","saat":"10","kategori":"UYDURMA","oncelik":"COK","mukellefId":"yok-boyle-id","tur":"GOREV"}' });
    const { prisma, servis } = kur();
    await servis.islemYap(KIMLIK, 'Öz Ela KDV kontrolü yarın 10:00 hatırlat', { simdi: SIMDI });
    let data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'KDV kontrolü', category: 'KDV_KONTROL', priority: 'MEDIUM', taxpayerId: 'm1', dueTime: '10:00' });
    expect(data.dueDate.toISOString()).toBe('2026-09-15T07:00:00.000Z');

    (isMaxAvailable as jest.Mock).mockReturnValueOnce(true);
    (claudeTextViaMax as jest.Mock).mockRejectedValueOnce(new Error('zaman aşımı'));
    const { prisma: p2, servis: s2 } = kur();
    await s2.islemYap(KIMLIK, 'Öz Ela KDV kontrolü yarın 10:00 hatırlat', { simdi: SIMDI });
    data = p2.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Öz Ela KDV kontrolü', taxpayerId: 'm1' });
  });

  it('boş gövde ("görev ekle" tek başına): kayıt yok, kullanım ipucu', async () => {
    const { prisma, servis } = kur();
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle', { simdi: SIMDI });
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(cevap).toContain('Görev metni boş');
  });

  it('İstanbul gün kayması: UTC 22:30 (İst. 01:30 ertesi gün) → "yarın" İstanbul gününe göre', async () => {
    const { prisma, servis } = kur();
    await servis.islemYap(KIMLIK, 'görev ekle: muhtasar yarın', { simdi: new Date('2026-09-14T22:30:00.000Z') });
    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data.dueDate.toISOString()).toBe('2026-09-15T21:00:00.000Z'); // 16.09.2026 00:00 İstanbul (İstanbul'da bugün 15'i)
  });

  it('veritabanı hatası: null döner (bot normal akışa devam eder)', async () => {
    const { prisma, servis } = kur();
    prisma.task.create.mockRejectedValueOnce(new Error('db kapalı'));
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle: KDV yarın', { simdi: SIMDI });
    expect(cevap).toBeNull();
  });

  it('mükellef listesi hatası: null döner', async () => {
    const { prisma, servis } = kur();
    prisma.taxpayer.findMany.mockRejectedValueOnce(new Error('db kapalı'));
    const cevap = await servis.islemYap(KIMLIK, 'görev ekle: KDV yarın', { simdi: SIMDI });
    expect(cevap).toBeNull();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------
 * Controller kancası (maybeHandleGorev) — owner-document-send.spec kalıbı: prototipten kurulur, alanlar elle verilir.
 * ------------------------------------------------------------------------- */
import { WhatsAppBotController } from './whatsapp-bot.controller';

function kanca() {
  const prisma = sahtePrisma();
  const c: any = Object.create(WhatsAppBotController.prototype);
  c.logger = { warn: jest.fn(), log: jest.fn() };
  c.prisma = {
    ...prisma,
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-sahip', tenantId: 'tenant-1' }) },
    communicationLog: { create: jest.fn().mockResolvedValue({}) },
  };
  c.whatsapp = { sendMessage: jest.fn().mockResolvedValue(true) };
  c.gorevWhatsapp = new GorevWhatsappService(c.prisma);
  return { c, prisma };
}

describe('WhatsAppBotController.maybeHandleGorev (kanca)', () => {
  // OwnerOnlyGuard.ownerEmail(): MOREN_BUTCE_OWNER_EMAIL, yoksa MOREN_OWNER_EMAIL — ikisini de sabitle
  const ENV = ['MOREN_BUTCE_OWNER_EMAIL', 'MOREN_OWNER_EMAIL'] as const;
  const eski: Record<string, string | undefined> = {};
  const geriYukle = () => { for (const a of ENV) { if (eski[a] === undefined) delete process.env[a]; else process.env[a] = eski[a]; } };
  beforeAll(() => { for (const a of ENV) eski[a] = process.env[a]; process.env.MOREN_BUTCE_OWNER_EMAIL = 'sahip@ofis.test'; process.env.MOREN_OWNER_EMAIL = 'sahip@ofis.test'; });
  afterAll(geriYukle);

  it('kapıdan geçmeyen mesaj → false, hiçbir şey yazılmaz', async () => {
    const { c, prisma } = kanca();
    const msg = { from: '905350000000', text: 'bugün 850 TL market harcaması yaptım işle' };
    expect(await c.maybeHandleGorev({ id: 'tenant-1' }, msg, 'contact-1')).toBe(false);
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('KURU TEST (__dryRun): kayıt yazılmaz, mesaj gitmez, cevap __dryReply\'a düşer', async () => {
    const { c, prisma } = kanca();
    const msg: any = { from: '905350000000', text: 'görev ekle: Öz Ela KDV kontrolü yarın 10:00', __dryRun: true };
    expect(await c.maybeHandleGorev({ id: 'tenant-1' }, msg, 'contact-1')).toBe(true);
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(c.whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(msg.__dryKind).toBe('owner:gorev');
    expect(msg.__dryReply.startsWith('KURU TEST (kaydedilmedi)\n✅ *Görev eklendi*')).toBe(true);
  });

  it('gerçek akış: görev yazılır, cevap owner\'a gönderilir, iletişim günlüğü tutulur', async () => {
    const { c, prisma } = kanca();
    const msg: any = { from: '905350000000', text: 'Öz Ela KDV kontrolü yarın 10:00 hatırlat' };
    expect(await c.maybeHandleGorev({ id: 'tenant-1' }, msg, 'contact-1')).toBe(true);
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect(prisma.task.create.mock.calls[0][0].data).toMatchObject({ tenantId: 'tenant-1', createdById: 'user-sahip', kaynak: 'WHATSAPP', taxpayerId: 'm1' });
    expect(c.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(c.whatsapp.sendMessage.mock.calls[0][1])).toContain('✅ *Görev eklendi*');
    expect(c.prisma.communicationLog.create).toHaveBeenCalledTimes(1);
    expect(c.prisma.communicationLog.create.mock.calls[0][0].data.subject).toBe('WhatsApp owner gorev ekleme');
  });

  it('sahip e-postası tanımsız → false (görev yazılmaz)', async () => {
    const { c, prisma } = kanca();
    delete process.env.MOREN_BUTCE_OWNER_EMAIL;
    delete process.env.MOREN_OWNER_EMAIL;
    try {
      expect(await c.maybeHandleGorev({ id: 'tenant-1' }, { from: 'x', text: 'görev ekle: KDV yarın' }, 'contact-1')).toBe(false);
      expect(prisma.task.create).not.toHaveBeenCalled();
    } finally {
      process.env.MOREN_BUTCE_OWNER_EMAIL = 'sahip@ofis.test';
      process.env.MOREN_OWNER_EMAIL = 'sahip@ofis.test';
    }
  });
});
