/**
 * AYLIK ÖDEME LİSTESİ — davranış kilidi (sahte prisma).
 *  - Çeyreklik geçici vergi ve yıllık taksitler listeye girer; yanlış aya düşmez.
 *  - Son günler hafta sonu/tatilden ilk iş gününe kayar; ham gün korunur.
 *  - Gönderim durumu mükellefe eklenir; 'gonderilmemis' modu gerçekten gideni atlar, test gönderimini atlamaz.
 *  - Otomatik koşu yalnız seçilen gün+saatte ve ayda bir kez.
 */
import { AylikOdemeService, istanbulSimdi } from './aylik-odeme.service';

const tp = (id: string, ad: string) => ({ id, companyName: ad, firstName: null, lastName: null, phone: '905551112233', phones: [], email: 'a@b.c', emails: [] });

function sahtePrisma(opts: { beyan?: any[]; sgk?: any[]; dispatch?: any[]; vergiAyar?: any; odemeAyar?: any } = {}) {
  const state: any = { odemeAyar: opts.odemeAyar === undefined ? null : opts.odemeAyar, yazilan: [] as any[], guncellenen: [] as any[] };
  const prisma: any = {
    _state: state,
    beyanKaydi: {
      findMany: jest.fn(async (q: any) => {
        const donemler: string[] = q?.where?.donem?.in || [];
        return (opts.beyan || []).filter((b) => donemler.includes(b.donem) && (!q?.where?.taxpayerId || b.taxpayerId === q.where.taxpayerId));
      }),
    },
    portalDocument: {
      findMany: jest.fn(async (q: any) => {
        const periods = (q?.where?.OR || []).map((o: any) => o.period);
        return (opts.sgk || []).filter((d) => periods.includes(d.period) && (!q?.where?.taxpayerId || d.taxpayerId === q.where.taxpayerId));
      }),
    },
    documentDispatch: {
      findMany: jest.fn(async (q: any) => (opts.dispatch || []).filter((d) => d.donem === q?.where?.donem)),
      upsert: jest.fn(async (q: any) => {
        state.yazilan.push(q);
        return q.create;
      }),
    },
    smartDispatchSetting: {
      findUnique: jest.fn(async (q: any) => {
        const kat = q?.where?.tenantId_kategori?.kategori;
        if (kat === 'VERGI') return opts.vergiAyar === undefined ? { testMode: true, testPhone: '905000000000', testEmail: 'test@x.y', whatsapp: true, email: true, senderName: null } : opts.vergiAyar;
        if (kat === 'ODEME_LISTESI') return state.odemeAyar;
        return null;
      }),
      create: jest.fn(async (q: any) => {
        state.odemeAyar = { id: 'o1', ...q.data };
        return state.odemeAyar;
      }),
      update: jest.fn(async (q: any) => {
        state.guncellenen.push(q.data);
        state.odemeAyar = { ...(state.odemeAyar || {}), ...q.data };
        return state.odemeAyar;
      }),
    },
    portalCredential: { findFirst: jest.fn(async () => null) },
    tenant: { findMany: jest.fn(async () => [{ id: 't1', name: 'T' }]) },
  };
  return prisma;
}

function servis(prisma: any, ek: { whatsapp?: any; email?: any; notifications?: any; beyannameTakip?: any } = {}) {
  const whatsapp = ek.whatsapp || { sendMessageDetailed: jest.fn(async () => ({ ok: true })), sendMessage: jest.fn(async () => true) };
  const email = ek.email || { send: jest.fn(async () => ({ sent: true })) };
  const notifications = ek.notifications || { createForTenant: jest.fn(async () => ({ id: 'n1' })) };
  const beyannameTakip = ek.beyannameTakip || { upsertConfig: jest.fn(async () => ({})), listDonemDetay: jest.fn(async () => []) };
  const storage = { getBuffer: jest.fn(async () => { throw new Error('yok'); }), putBuffer: jest.fn(async () => undefined) };
  const shortLink = { create: jest.fn(async () => 'https://portal/b/x') };
  const s = new AylikOdemeService(prisma, storage as any, whatsapp, email, shortLink as any, beyannameTakip, notifications);
  return { s, whatsapp, email, notifications, beyannameTakip, storage, shortLink };
}

const beyanlar = [
  { id: 'b1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'KDV1', donem: '2026-07', tahakkukTutari: '7046.77', pdfUrl: null, beyannameUrl: null },
  { id: 'b2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'GGECICI', donem: '2026-Q2', tahakkukTutari: '12300', pdfUrl: null, beyannameUrl: null },
  { id: 'b3', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'MUHSGK', donem: '2026-Q2', tahakkukTutari: '500', pdfUrl: null, beyannameUrl: null },
  { id: 'b4', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'GELIR', donem: '2025-YIL', tahakkukTutari: '148683.10', pdfUrl: null, beyannameUrl: null },
  { id: 'b5', taxpayerId: 'B', taxpayer: tp('B', 'BETA LTD'), beyanTipi: 'KGECICI', donem: '2026-Q2', tahakkukTutari: '1000', pdfUrl: null, beyannameUrl: null },
  { id: 'b6', taxpayerId: 'C', taxpayer: tp('C', 'CEM'), beyanTipi: 'GELIR', donem: '2025-YIL', tahakkukTutari: '1483.70', pdfUrl: null, beyannameUrl: null },
  { id: 'b7', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'DAMGA', donem: '2026-09', tahakkukTutari: '100', pdfUrl: null, beyannameUrl: null },
];
const sgkler = [
  { id: 's1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/07', raw: { tutar: '24.277,05' }, storageKey: null },
  { id: 's2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/09', raw: { tutar: '10,00' }, storageKey: null },
];

describe('AylikOdemeService.list — çeyrek/yıllık eşlemesi + iş günü kayması', () => {
  it('Ağustos 2026: KDV (Temmuz) + geçici Q2 + SGK; üç aylık muhtasar ve yıllık GELIR girmez', async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler }));
    const rows = await s.list('t1', '2026-08');
    const a = rows.find((r) => r.taxpayerId === 'A')!;
    expect(a.satirlar.map((x) => `${x.tur}|${x.grup}|${x.sonGunIso}|${x.tutar}`)).toEqual([
      'KDV1|AYLIK|2026-08-28|7046.77',
      'GGECICI|GECICI|2026-08-17|12300',
      'Tahakkuk Fişi|SGK|2026-08-31|24277.05',
    ]);
    expect(a.satirlar[1].turAd).toBe('Gelir Geçici Vergi 2. Dönem');
    expect(a.satirlar[2].turAd).toBe('SGK Prim Tahakkuku');
    expect(a.satirlar[0].sonGun).toBe('28.8.2026'); // Hattat biçimi korunur
    expect(a.toplam).toBeCloseTo(43623.82, 2);
    expect(rows.find((r) => r.taxpayerId === 'B')!.satirlar[0].turAd).toBe('Kurum Geçici Vergi 2. Dönem');
    expect(rows.find((r) => r.taxpayerId === 'C')).toBeUndefined();
  });

  it('Mart 2026: GELIR 1. taksit (damga 1. taksitte); Temmuz 2026: 2. taksit; yalnız-damga kayıt Temmuz\'da yok', async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar }));
    const mart = await s.list('t1', '2026-03');
    const aMart = mart.find((r) => r.taxpayerId === 'A')!.satirlar.find((x) => x.tur === 'GELIR')!;
    expect(aMart.taksit).toBe('1/2');
    expect(aMart.turAd).toBe('Yıllık Gelir Vergisi 1. Taksit');
    expect(aMart.tutar).toBe(75083.4);
    expect(aMart.sonGunIso).toBe('2026-03-31');
    const cMart = mart.find((r) => r.taxpayerId === 'C')!.satirlar[0];
    expect(cMart.tutar).toBe(1483.7);

    const temmuz = await s.list('t1', '2026-07');
    const aTem = temmuz.find((r) => r.taxpayerId === 'A')!;
    const gelir = aTem.satirlar.find((x) => x.tur === 'GELIR')!;
    expect(gelir.taksit).toBe('2/2');
    expect(gelir.tutar).toBe(73599.7);
    expect(gelir.sonGunIso).toBe('2026-07-31');
    // üç aylık muhtasar Q2 Temmuz'da, 26 Temmuz 2026 Pazar → 27 Temmuz
    const muh = aTem.satirlar.find((x) => x.tur === 'MUHSGK')!;
    expect(muh.grup).toBe('AYLIK');
    expect(muh.sonGunHam).toBe('26.7.2026');
    expect(muh.sonGun).toBe('27.7.2026');
    expect(muh.sonGunIso).toBe('2026-07-27');
    expect(temmuz.find((r) => r.taxpayerId === 'C')).toBeUndefined();
  });

  it('Ekim 2026: DAMGA 25 Ekim Pazar → 26 Ekim; SGK 31 Ekim Cumartesi → 2 Kasım (ham gün korunur)', async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler }));
    const rows = await s.list('t1', '2026-10');
    const a = rows.find((r) => r.taxpayerId === 'A')!;
    const damga = a.satirlar.find((x) => x.tur === 'DAMGA')!;
    expect(damga.sonGunHam).toBe('25.10.2026');
    expect(damga.sonGun).toBe('26.10.2026');
    const sgk = a.satirlar.find((x) => x.kaynak === 'SGK')!;
    expect(sgk.sonGunHam).toBe('31.10.2026');
    expect(sgk.sonGunIso).toBe('2026-11-02');
  });

  it('gönderim durumu: test gönderimi test:true; gerçek SENT test:false; hatalı FAILED', async () => {
    const dispatch = [
      { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: true, sentAt: new Date('2026-08-20T05:09:14Z'), dedupeKey: 'ODEME:A:2026-08:VERGI' },
      { taxpayerId: 'A', donem: '2026-08', channel: 'EMAIL', status: 'FAILED', testMode: true, sentAt: null, dedupeKey: 'ODEME:A:2026-08:VERGI' },
      { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: false, sentAt: new Date('2026-08-21T05:00:00Z'), dedupeKey: 'ODEME:A:2026-08:SGK' },
      { taxpayerId: 'B', donem: '2026-08', channel: 'WHATSAPP', status: 'FAILED', testMode: false, sentAt: null, dedupeKey: 'ODEME:B:2026-08:VERGI' },
    ];
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const rows = await s.list('t1', '2026-08');
    const a = rows.find((r) => r.taxpayerId === 'A')!;
    expect(a.gonderim.VERGI).toEqual({ status: 'SENT', sentAt: '2026-08-20T05:09:14.000Z', kanallar: ['WHATSAPP'], test: true });
    expect(a.gonderim.SGK).toEqual({ status: 'SENT', sentAt: '2026-08-21T05:00:00.000Z', kanallar: ['WHATSAPP'], test: false });
    expect(rows.find((r) => r.taxpayerId === 'B')!.gonderim.VERGI).toEqual({ status: 'FAILED', sentAt: null, kanallar: [], test: false });
  });

  it('taxpayerId ile tek mükellef; geçersiz ay 400', async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler }));
    const rows = await s.list('t1', '2026-08', 'B');
    expect(rows.map((r) => r.taxpayerId)).toEqual(['B']);
    await expect(s.list('t1', '2026-13')).rejects.toThrow(/YYYY-MM/);
  });
});

describe('AylikOdemeService.send — gönderim modları', () => {
  const dispatch = [
    // A/VERGI: WhatsApp GERÇEKTEN gitmiş, e-posta hatalı → gonderilmemis modunda yalnız e-posta gider
    { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: false, sentAt: new Date(), dedupeKey: 'ODEME:A:2026-08:VERGI' },
    { taxpayerId: 'A', donem: '2026-08', channel: 'EMAIL', status: 'FAILED', testMode: false, sentAt: null, dedupeKey: 'ODEME:A:2026-08:VERGI' },
    // A/SGK: TEST gönderimi → atlanmaz
    { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: true, sentAt: new Date(), dedupeKey: 'ODEME:A:2026-08:SGK' },
  ];

  it("'gonderilmemis': gerçekten giden kanal atlanır (atlanan=1), test gönderimi yeniden gider, kayıt testMode ile yazılır", async () => {
    const prisma = sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch });
    const { s, whatsapp, email } = servis(prisma);
    const r = await s.send('t1', '2026-08');
    expect(r.testMode).toBe(true);
    expect(r.atlanan).toBe(1);
    const aVergi = r.results.filter((x: any) => x.taxpayerId === 'A' && x.grup === 'VERGI').map((x: any) => x.channel);
    expect(aVergi).toEqual(['EMAIL']);
    const aSgk = r.results.filter((x: any) => x.taxpayerId === 'A' && x.grup === 'SGK').map((x: any) => x.channel);
    expect(aSgk).toEqual(['WHATSAPP', 'EMAIL']);
    // test modunda alıcı TEST telefonu/e-postası — mükellefe hiçbir şey gitmez
    for (const c of whatsapp.sendMessageDetailed.mock.calls) expect(c[0]).toBe('905000000000');
    for (const c of email.send.mock.calls) expect(c[0].to).toBe('test@x.y');
    expect(prisma._state.yazilan.every((y: any) => y.create.testMode === true && y.create.kategori === 'ODEME_LISTESI')).toBe(true);
    // yeni mesaj kalıbı
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('Ödeme Cetveli — SGK');
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).not.toContain('Bilginize Sunulmuştur');
    expect(email.send.mock.calls[0][0].subject).toMatch(/^Ağustos 2026 Ödeme Cetveli — Vergi · ADEM CAN$/);
    expect(email.send.mock.calls[0][0].html).toContain('<table');
  });

  it("'hepsi' hiçbir kanalı atlamaz; 'yeniden' taxpayerId ister", async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const r = await s.send('t1', '2026-08', undefined, 'hepsi');
    expect(r.atlanan).toBe(0);
    expect(r.results.filter((x: any) => x.taxpayerId === 'A' && x.grup === 'VERGI').length).toBe(2);
    await expect(s.send('t1', '2026-08', undefined, 'yeniden')).rejects.toThrow(/taxpayerId/);
    const tek = await s.send('t1', '2026-08', 'A', 'yeniden');
    expect(tek.results.every((x: any) => x.taxpayerId === 'A')).toBe(true);
    expect(tek.atlanan).toBe(0);
  });
});

describe('AylikOdemeService.ozet', () => {
  it('bölümleme toplamları ve mükellef sayaçları', async () => {
    const dispatch = [
      { taxpayerId: 'B', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: false, sentAt: new Date(), dedupeKey: 'ODEME:B:2026-08:VERGI' },
    ];
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const oz = await s.ozet('t1', '2026-08');
    expect(oz.mukellef).toBe(2);
    expect(oz.kalem).toBe(4);
    expect(oz.vergiToplam).toBe(7046.77);
    expect(oz.geciciToplam).toBe(13300);
    expect(oz.sgkToplam).toBe(24277.05);
    expect(oz.yillikToplam).toBe(0);
    expect(oz.toplam).toBeCloseTo(44623.82, 2);
    expect(oz.gonderilen).toBe(1);
    expect(oz.bekleyen).toBe(1);
    expect(oz.hatali).toBe(0);
    expect(oz.testMode).toBe(true);
    expect(oz.kanallar).toEqual({ whatsapp: true, email: true });
    expect(oz.otomatik).toEqual({ aktif: false, gun: 1, saat: 10, onayGerekli: true, sonKosu: null });
  });
});

describe('AylikOdemeService — otomatik gönderim', () => {
  it('ODEME_LISTESI satırı yoksa VERGI değerleriyle KAPALI oluşturulur; kaydet doğrular', async () => {
    const prisma = sahtePrisma();
    const { s } = servis(prisma);
    expect(await s.otomatikAyar('t1')).toEqual({ aktif: false, gun: 1, saat: 10, onayGerekli: true, sonKosu: null });
    expect(prisma.smartDispatchSetting.create.mock.calls[0][0].data).toMatchObject({ kategori: 'ODEME_LISTESI', enabled: false, sendDay: null, sendHour: 10, onayGerekli: true, testMode: true, testPhone: '905000000000' });
    await expect(s.otomatikKaydet('t1', { aktif: true, gun: 31, saat: 10, onayGerekli: true })).rejects.toThrow(/gun/);
    await expect(s.otomatikKaydet('t1', { aktif: true, gun: 5, saat: 24, onayGerekli: true })).rejects.toThrow(/saat/);
    const k = await s.otomatikKaydet('t1', { aktif: true, gun: 5, saat: 9, onayGerekli: false });
    expect(k).toMatchObject({ aktif: true, gun: 5, saat: 9, onayGerekli: false });
  });

  afterEach(() => jest.useRealTimers());

  it('tetik: kapalıysa/gün-saat tutmuyorsa/bu ay koşulduysa null; onay gerekliyse sahibe WhatsApp + portal bildirimi', async () => {
    // lastRunAt "şimdi" yazılır; "bu ay koşuldu" kontrolü gerçek saatle simüle edilen ayın aynı olmasını ister
    jest.useFakeTimers({ now: new Date('2026-08-05T07:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '905350000001, 905350000002';
    const prisma = sahtePrisma({ beyan: beyanlar, sgk: sgkler, odemeAyar: { enabled: true, sendDay: 5, sendHour: 10, onayGerekli: true, lastRunAt: null } });
    const { s, whatsapp, notifications } = servis(prisma);
    expect(await s.otomatikTetikle('t1', { month: '2026-08', gun: 4, saat: 10 })).toBeNull();
    expect(await s.otomatikTetikle('t1', { month: '2026-08', gun: 5, saat: 9 })).toBeNull();
    const r = await s.otomatikTetikle('t1', { month: '2026-08', gun: 5, saat: 10 });
    expect(r).toEqual({ month: '2026-08', sonuc: 'onay-bekliyor', gonderilen: null });
    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(2);
    expect(whatsapp.sendMessage.mock.calls[0][0]).toBe('905350000001');
    expect(whatsapp.sendMessage.mock.calls[0][1]).toContain('Ağustos 2026 ödeme cetveli hazır: 2 mükellef');
    expect(whatsapp.sendMessage.mock.calls[0][1]).toContain('/panel/aylik-odeme');
    expect(notifications.createForTenant).toHaveBeenCalledTimes(1);
    expect(notifications.createForTenant.mock.calls[0][0].metadata.link).toContain('/panel/aylik-odeme');
    expect(prisma._state.guncellenen.at(-1).lastRunResult).toEqual({ month: '2026-08', sonuc: 'onay-bekliyor', gonderilen: null });
    // aynı ay ikinci kez koşmaz; gönderim hiç yapılmadı
    expect(await s.otomatikTetikle('t1', { month: '2026-08', gun: 5, saat: 10 })).toBeNull();
    expect(prisma._state.yazilan.length).toBe(0);
    expect(whatsapp.sendMessageDetailed).not.toHaveBeenCalled();
  });

  it('onay gerekmiyorsa gönderilmemişlere gönderir ve koşu izini yazar', async () => {
    const prisma = sahtePrisma({ beyan: beyanlar, sgk: sgkler, odemeAyar: { enabled: true, sendDay: 5, sendHour: 10, onayGerekli: false, lastRunAt: new Date('2026-07-05T07:00:00Z') } });
    const { s, notifications } = servis(prisma);
    const r = await s.otomatikTetikle('t1', { month: '2026-08', gun: 5, saat: 10 });
    expect(r?.sonuc).toBe('gonderildi');
    expect(r?.gonderilen).toBe(6); // A: VERGI+SGK (2 kanal), B: VERGI (2 kanal)
    expect(prisma._state.yazilan.length).toBe(6);
    expect(notifications.createForTenant.mock.calls[0][0].title).toContain('(test modu)');
  });

  it('istanbulSimdi UTC anını İstanbul gün/saatine çevirir', () => {
    expect(istanbulSimdi(new Date('2026-08-04T22:30:00Z'))).toEqual({ month: '2026-08', gun: 5, saat: 1 });
    expect(istanbulSimdi(new Date('2026-08-05T07:00:00Z'))).toEqual({ month: '2026-08', gun: 5, saat: 10 });
  });
});

describe('AylikOdemeService.sgkYok', () => {
  it('beyanname-takip config sgkBildirgeEnabled=false yazar', async () => {
    const prisma = sahtePrisma();
    const { s, beyannameTakip } = servis(prisma);
    expect(await s.sgkYok('t1', 'A')).toEqual({ ok: true });
    expect(beyannameTakip.upsertConfig).toHaveBeenCalledWith('t1', 'A', { sgkBildirgeEnabled: false });
    await expect(s.sgkYok('t1', '')).rejects.toThrow(/taxpayerId/);
  });
});
