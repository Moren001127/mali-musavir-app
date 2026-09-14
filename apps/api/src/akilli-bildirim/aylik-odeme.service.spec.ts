/**
 * AYLIK ÖDEME LİSTESİ — davranış kilidi (sahte prisma).
 *  - Çeyreklik geçici vergi ve yıllık taksitler listeye girer; yanlış aya düşmez.
 *  - Son günler hafta sonu/tatilden ilk iş gününe kayar; ham gün korunur.
 *  - Gönderim KALEM BAZLI izlenir: satırda kanal→son gönderim, grupta kalem sayaçları; 'gonderilmemis' modu yalnız
 *    o kanaldan gerçek gitmemiş kalemleri gönderir, test gönderimini "gitti" saymaz; her kalem kümesi ayrı dispatch satırı.
 *  - Otomatik koşu yalnız seçilen gün+saatte ve ayda bir kez.
 */
import { AylikOdemeService, istanbulSimdi } from './aylik-odeme.service';
import { kalemAnahtari, kalemHash } from './aylik-odeme-donem';

const tp = (id: string, ad: string) => ({ id, companyName: ad, firstName: null, lastName: null, phone: '905551112233', phones: [], email: 'a@b.c', emails: [] });

/** Gerçek gönderim kaydı (docRefs'li, yeni biçim). */
function sentKaydi(taxpayerId: string, month: string, grup: 'VERGI' | 'SGK', channel: 'WHATSAPP' | 'EMAIL', keys: string[], ek: Partial<{ testMode: boolean; status: string; sentAt: Date | null }> = {}) {
  const testMode = ek.testMode ?? false;
  return {
    taxpayerId,
    donem: month,
    channel,
    status: ek.status ?? 'SENT',
    testMode,
    sentAt: ek.sentAt === undefined ? new Date('2026-08-20T05:09:14Z') : ek.sentAt,
    createdAt: new Date('2026-08-20T05:09:14Z'),
    dedupeKey: `ODEME:${taxpayerId}:${month}:${grup}:${kalemHash(keys)}${testMode ? ':T' : ''}`,
    docRefs: keys.map((key) => ({ key, tur: key.split('|')[1], donem: key.split('|')[2], taksit: key.split('|')[3] || null, tutar: 1 })),
  };
}

function sahtePrisma(opts: { beyan?: any[]; sgk?: any[]; dispatch?: any[]; vergiAyar?: any; odemeAyar?: any } = {}) {
  const state: any = {
    odemeAyar: opts.odemeAyar === undefined ? null : opts.odemeAyar,
    yazilan: [] as any[],
    guncellenen: [] as any[],
    dispatch: [...(opts.dispatch || [])] as any[], // upsert ile yazılanlar sonraki findMany'de görünür (canlı davranış)
  };
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
      findMany: jest.fn(async (q: any) =>
        state.dispatch.filter((d: any) => d.donem === q?.where?.donem && (!q?.where?.taxpayerId || d.taxpayerId === q.where.taxpayerId)),
      ),
      // tenantId_dedupeKey_channel tekilliği: varsa güncelle, yoksa oluştur
      upsert: jest.fn(async (q: any) => {
        state.yazilan.push(q);
        const w = q.where.tenantId_dedupeKey_channel;
        const mevcut = state.dispatch.find((d: any) => d.dedupeKey === w.dedupeKey && d.channel === w.channel);
        if (mevcut) {
          Object.assign(mevcut, q.update);
          return mevcut;
        }
        const yeni = { ...q.create, createdAt: new Date() };
        state.dispatch.push(yeni);
        return yeni;
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
  { id: 's1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/07', referenceNo: '80646-2026-7', raw: { tutar: '24.277,05' }, storageKey: null },
  { id: 's2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/09', referenceNo: '80646-2026-9', raw: { tutar: '10,00' }, storageKey: null },
];

// Ağustos 2026 listesindeki kalem anahtarları
const K_KDV = 'VERGI|KDV1|2026-07|';
const K_GECICI = 'VERGI|GGECICI|2026-Q2|';
const K_SGK = 'SGK|Tahakkuk Fişi|2026/07||80646-2026-7';
const K_B = 'VERGI|KGECICI|2026-Q2|';

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

  it('gönderim durumu (kalem bazlı): satırda kanal→son gönderim; grupta sayaçlar; gerçek > test; hatalı FAILED', async () => {
    const dispatch = [
      // A/VERGI: KDV WhatsApp'tan gerçek gitti; e-posta denemesi hatalı; sonra KDV+geçici test gönderimi (gerçeği ezmez)
      sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV], { sentAt: new Date('2026-08-20T05:09:14Z') }),
      sentKaydi('A', '2026-08', 'VERGI', 'EMAIL', [K_KDV], { status: 'FAILED', sentAt: null }),
      sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV, K_GECICI], { testMode: true, sentAt: new Date('2026-08-22T05:00:00Z') }),
      // A/SGK: gerçek e-posta
      sentKaydi('A', '2026-08', 'SGK', 'EMAIL', [K_SGK], { sentAt: new Date('2026-08-21T05:00:00Z') }),
      // B/VERGI: yalnız hatalı deneme
      sentKaydi('B', '2026-08', 'VERGI', 'WHATSAPP', [K_B], { status: 'FAILED', sentAt: null }),
    ];
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const rows = await s.list('t1', '2026-08');
    const a = rows.find((r) => r.taxpayerId === 'A')!;
    const kdv = a.satirlar.find((x) => x.tur === 'KDV1')!;
    const gecici = a.satirlar.find((x) => x.tur === 'GGECICI')!;
    const sgk = a.satirlar.find((x) => x.kaynak === 'SGK')!;
    expect(kalemAnahtari(kdv)).toBe(K_KDV);
    expect(kalemAnahtari(sgk)).toBe(K_SGK);
    // KDV: WhatsApp gerçek (test gönderimi daha yeni olsa da gerçek üstün), e-posta hiç gitmedi (FAILED sayılmaz)
    expect(kdv.gonderim).toEqual({ WHATSAPP: { sentAt: '2026-08-20T05:09:14.000Z', test: false, tutar: 1 }, EMAIL: null });
    // geçici: yalnız test gönderimi
    expect(gecici.gonderim).toEqual({ WHATSAPP: { sentAt: '2026-08-22T05:00:00.000Z', test: true, tutar: 1 }, EMAIL: null });
    expect(sgk.gonderim).toEqual({ WHATSAPP: null, EMAIL: { sentAt: '2026-08-21T05:00:00.000Z', test: false, tutar: 1 } });
    expect(a.gonderim.VERGI).toEqual({
      status: 'SENT', sentAt: '2026-08-20T05:09:14.000Z', kanallar: ['WHATSAPP'], test: false,
      toplamKalem: 2, gonderilenKalem: 1, yeniKalem: 1,
    });
    expect(a.gonderim.SGK).toEqual({ status: 'SENT', sentAt: '2026-08-21T05:00:00.000Z', kanallar: ['EMAIL'], test: false, toplamKalem: 1, gonderilenKalem: 1, yeniKalem: 0 });
    const b = rows.find((r) => r.taxpayerId === 'B')!;
    expect(b.gonderim.VERGI).toEqual({ status: 'FAILED', sentAt: null, kanallar: [], test: false, toplamKalem: 1, gonderilenKalem: 0, yeniKalem: 1 });
    expect(b.satirlar[0].gonderim).toEqual({ WHATSAPP: null, EMAIL: null });
  });

  it('eski biçim kayıt (hash\'siz dedupeKey, docRefs null): grup tarihi verir ama hiçbir kalemi "gitti" saymaz; grup eki yoksa hiç sayılmaz', async () => {
    const dispatch = [
      { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: false, sentAt: new Date('2026-08-21T05:00:00Z'), createdAt: new Date('2026-08-21T05:00:00Z'), dedupeKey: 'ODEME:A:2026-08:SGK', docRefs: null },
      { taxpayerId: 'A', donem: '2026-08', channel: 'WHATSAPP', status: 'SENT', testMode: false, sentAt: new Date('2026-08-21T05:00:00Z'), createdAt: new Date('2026-08-21T05:00:00Z'), dedupeKey: 'ODEME:A:2026-08', docRefs: null },
    ];
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const a = (await s.list('t1', '2026-08')).find((r) => r.taxpayerId === 'A')!;
    expect(a.gonderim.SGK).toEqual({ status: 'SENT', sentAt: '2026-08-21T05:00:00.000Z', kanallar: ['WHATSAPP'], test: false, toplamKalem: 1, gonderilenKalem: 0, yeniKalem: 1 });
    expect(a.gonderim.VERGI).toBeNull();
    expect(a.satirlar.every((x) => x.gonderim!.WHATSAPP === null && x.gonderim!.EMAIL === null)).toBe(true);
  });

  it('taxpayerId ile tek mükellef; geçersiz ay 400', async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler }));
    const rows = await s.list('t1', '2026-08', 'B');
    expect(rows.map((r) => r.taxpayerId)).toEqual(['B']);
    await expect(s.list('t1', '2026-13')).rejects.toThrow(/YYYY-MM/);
  });
});

describe('AylikOdemeService.send — gönderim modları', () => {
  const dispatch = () => [
    // A/VERGI: her iki kalem WhatsApp'tan GERÇEKTEN gitmiş, e-posta hatalı → gonderilmemis modunda yalnız e-posta gider
    sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV, K_GECICI]),
    sentKaydi('A', '2026-08', 'VERGI', 'EMAIL', [K_KDV, K_GECICI], { status: 'FAILED', sentAt: null }),
    // A/SGK: TEST gönderimi → atlanmaz
    sentKaydi('A', '2026-08', 'SGK', 'WHATSAPP', [K_SGK], { testMode: true }),
  ];

  it("'gonderilmemis': gerçekten giden kanal atlanır (atlanan=1), test gönderimi yeniden gider, kayıt testMode + ':T' anahtarıyla yazılır", async () => {
    const prisma = sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch: dispatch() });
    const { s, whatsapp, email } = servis(prisma);
    const r = await s.send('t1', '2026-08');
    expect(r.testMode).toBe(true);
    expect(r.kanal).toBeNull();
    expect(r.atlanan).toBe(1);
    const aVergi = r.results.filter((x) => x.taxpayerId === 'A' && x.grup === 'VERGI');
    expect(aVergi.map((x) => x.channel)).toEqual(['EMAIL']);
    expect(aVergi[0]).toMatchObject({ kalem: 2, yeni: 2, status: 'SENT', error: null });
    const aSgk = r.results.filter((x) => x.taxpayerId === 'A' && x.grup === 'SGK').map((x) => x.channel);
    expect(aSgk).toEqual(['WHATSAPP', 'EMAIL']);
    // test modunda alıcı TEST telefonu/e-postası — mükellefe hiçbir şey gitmez
    for (const c of whatsapp.sendMessageDetailed.mock.calls) expect(c[0]).toBe('905000000000');
    for (const c of email.send.mock.calls) expect(c[0].to).toBe('test@x.y');
    expect(prisma._state.yazilan.every((y: any) => y.create.testMode === true && y.create.kategori === 'ODEME_LISTESI' && /:T$/.test(y.create.dedupeKey))).toBe(true);
    // yeni mesaj kalıbı
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('Aşağıdaki SGK Dökümanları Bilginize Sunulmuştur,'); // Muzaffer Bey'in orijinal kalıbı
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('*Gönderen* ');
    expect(email.send.mock.calls[0][0].subject).toBe('Beyanname Dökümanları — ADEM CAN');
    expect(email.send.mock.calls[0][0].html).toContain('<pre');
  });

  it("'hepsi' hiçbir kanalı atlamaz; 'yeniden' taxpayerId ister; geçersiz kanal 400", async () => {
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch: dispatch() }));
    const r = await s.send('t1', '2026-08', undefined, 'hepsi');
    expect(r.atlanan).toBe(0);
    expect(r.results.filter((x) => x.taxpayerId === 'A' && x.grup === 'VERGI').length).toBe(2);
    await expect(s.send('t1', '2026-08', undefined, 'yeniden')).rejects.toThrow(/taxpayerId/);
    await expect(s.send('t1', '2026-08', 'A', 'hepsi', 'SMS' as any)).rejects.toThrow(/kanal/);
    const tek = await s.send('t1', '2026-08', 'A', 'yeniden');
    expect(tek.results.every((x) => x.taxpayerId === 'A')).toBe(true);
    expect(tek.atlanan).toBe(0);
  });
});

describe('AylikOdemeService.send — KALEM BAZLI takip (Muzaffer Bey 2026-09-14: "sonra bir beyanname daha verildi")', () => {
  const beyanA = (): any[] => [
    { id: 'b1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'KDV1', donem: '2026-07', tahakkukTutari: '7046.77', pdfUrl: null, beyannameUrl: null },
    { id: 'b2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'GGECICI', donem: '2026-Q2', tahakkukTutari: '12300', pdfUrl: null, beyannameUrl: null },
  ];
  const gercekAyar = () => ({ testMode: false, testPhone: '905000000000', testEmail: 'test@x.y', whatsapp: true, email: true, senderName: null });

  it('ilk gönderim 2 kalem → docRefs 2; 3. beyanname gelince yalnız o kalem gider (metin/PDF/tutar yalnız o); tekrar → atlanan; yeniden → hepsi; kanal EMAIL → yalnız e-posta', async () => {
    const beyan = beyanA();
    const prisma = sahtePrisma({ beyan, vergiAyar: gercekAyar() });
    const { s, whatsapp, email, storage } = servis(prisma);

    // 1) ilk gönderim — her iki kanal, 2 kalem
    const r1 = await s.send('t1', '2026-08', 'A');
    expect(r1.testMode).toBe(false);
    expect(r1.count).toBe(2);
    expect(r1.atlanan).toBe(0);
    expect(r1.results.map((x) => [x.channel, x.kalem, x.yeni, x.status])).toEqual([['WHATSAPP', 2, 2, 'SENT'], ['EMAIL', 2, 2, 'SENT']]);
    const y1 = prisma._state.yazilan[0].create;
    expect(y1.docRefs.map((d: any) => d.key)).toEqual([K_KDV, K_GECICI]);
    expect(y1.docRefs[0]).toEqual({ key: K_KDV, tur: 'KDV1', donem: '2026-07', taksit: null, tutar: 7046.77 });
    expect(y1.itemCount).toBe(2);
    expect(y1.totalAmount).toBe(19346.77);
    expect(y1.testMode).toBe(false);
    expect(y1.dedupeKey).toBe(`ODEME:A:2026-08:VERGI:${kalemHash([K_KDV, K_GECICI])}`);
    expect(y1.dedupeKey).toMatch(/^ODEME:A:2026-08:VERGI:[0-9a-f]{10}$/);
    // WhatsApp + e-posta aynı küme: iki kanal aynı dedupeKey (kanal ayrı sütun), mesaj 2 satır
    expect(prisma._state.yazilan[1].create.dedupeKey).toBe(y1.dedupeKey);
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('KDV1 - Tahakkuk');
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('GGECICI - Tahakkuk');
    // gerçek modda alıcı mükellefin numarası/e-postası
    expect(whatsapp.sendMessageDetailed.mock.calls[0][0]).toBe('905551112233');
    expect(email.send.mock.calls[0][0].to).toBe('a@b.c');

    // 2) bir beyanname daha verildi (DAMGA, fişi var) → 'gonderilmemis' yalnız onu gönderir
    beyan.push({ id: 'b3', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'DAMGA', donem: '2026-07', tahakkukTutari: '100', pdfUrl: 'dosya/damga.pdf', beyannameUrl: null });
    storage.getBuffer.mockClear();
    const r2 = await s.send('t1', '2026-08', 'A');
    expect(r2.count).toBe(2);
    expect(r2.atlanan).toBe(0);
    expect(r2.results.map((x) => [x.channel, x.kalem, x.yeni])).toEqual([['WHATSAPP', 3, 1], ['EMAIL', 3, 1]]);
    const m2 = whatsapp.sendMessageDetailed.mock.calls[1][1] as string;
    expect(m2).toContain('DAMGA - Tahakkuk - Son Ödeme: 25.8.2026 - 100,00  TL');
    expect(m2).not.toContain('KDV1');
    expect(m2).not.toContain('GGECICI');
    expect(m2).toContain('Toplam: 100,00  TL');
    // PDF birleşimi yalnız yeni kalemin fişini okur (eski kalemlerin pdf'i yok zaten; yeni olan bir kez istenir)
    expect(storage.getBuffer.mock.calls.map((c: any) => c[0])).toEqual(['dosya/damga.pdf']);
    const y2 = prisma._state.yazilan[2].create;
    expect(y2.docRefs.map((d: any) => d.key)).toEqual(['VERGI|DAMGA|2026-07|']);
    expect(y2.itemCount).toBe(1);
    expect(y2.totalAmount).toBe(100);
    expect(y2.dedupeKey).toBe(`ODEME:A:2026-08:VERGI:${kalemHash(['VERGI|DAMGA|2026-07|'])}`);
    expect(y2.dedupeKey).not.toBe(y1.dedupeKey);
    expect(prisma._state.dispatch.length).toBe(4); // geçmiş korunur: 2 kanal × 2 küme

    // 3) tekrar 'gonderilmemis' → her şey gitmiş, iki kanal da atlanır, mesaj çıkmaz
    const r3 = await s.send('t1', '2026-08', 'A');
    expect(r3.count).toBe(0);
    expect(r3.atlanan).toBe(2);
    expect(whatsapp.sendMessageDetailed).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledTimes(2);

    // 4) 'yeniden' → 3 kalemin tamamı, üçlü kümenin kendi anahtarı
    const r4 = await s.send('t1', '2026-08', 'A', 'yeniden');
    expect(r4.results.map((x) => [x.channel, x.kalem, x.yeni])).toEqual([['WHATSAPP', 3, 3], ['EMAIL', 3, 3]]);
    const m4 = whatsapp.sendMessageDetailed.mock.calls[2][1] as string;
    expect(m4).toContain('KDV1');
    expect(m4).toContain('GGECICI');
    expect(m4).toContain('DAMGA');
    expect(prisma._state.yazilan[4].create.dedupeKey).toBe(`ODEME:A:2026-08:VERGI:${kalemHash([K_KDV, K_GECICI, 'VERGI|DAMGA|2026-07|'])}`);
    expect(prisma._state.dispatch.length).toBe(6);

    // 5) kanal: 'EMAIL' → yalnız e-posta (hepsi modunda)
    const r5 = await s.send('t1', '2026-08', 'A', 'hepsi', 'EMAIL');
    expect(r5.kanal).toBe('EMAIL');
    expect(r5.results.map((x) => x.channel)).toEqual(['EMAIL']);
    expect(whatsapp.sendMessageDetailed).toHaveBeenCalledTimes(3);
    expect(email.send).toHaveBeenCalledTimes(4);
    // aynı küme aynı kanaldan yeniden → upsert (yeni satır değil)
    expect(prisma._state.dispatch.length).toBe(6);

    // 6) list(): her satır kanal bazlı, grup sayaçları tam
    const a = (await s.list('t1', '2026-08', 'A'))[0];
    expect(a.satirlar.map((x) => [x.tur, !!x.gonderim!.WHATSAPP && !x.gonderim!.WHATSAPP.test, !!x.gonderim!.EMAIL && !x.gonderim!.EMAIL.test])).toEqual([
      ['KDV1', true, true],
      ['GGECICI', true, true],
      ['DAMGA', true, true],
    ]);
    expect(a.satirlar[2].gonderim!.WHATSAPP!.tutar).toBe(100);
    expect(a.gonderim.VERGI).toMatchObject({ status: 'SENT', kanallar: ['WHATSAPP', 'EMAIL'], test: false, toplamKalem: 3, gonderilenKalem: 3, yeniKalem: 0 });
    expect(a.gonderim.SGK).toBeNull();
  });

  it('kanal bazlı fark: WhatsApp gitmiş, e-posta gitmemiş kalem → yalnız e-postadan gider; kısmi hata sonraki koşuda yeniden denenir', async () => {
    const prisma = sahtePrisma({ beyan: beyanA(), vergiAyar: gercekAyar(), dispatch: [sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV, K_GECICI])] });
    const email = { send: jest.fn(async () => ({ sent: false })) };
    const { s, whatsapp } = servis(prisma, { email });
    const r = await s.send('t1', '2026-08', 'A');
    expect(r.atlanan).toBe(1);
    expect(r.results).toEqual([{ taxpayerId: 'A', unvan: 'ADEM CAN', grup: 'VERGI', channel: 'EMAIL', status: 'FAILED', error: 'e-posta gönderilemedi', kalem: 2, yeni: 2 }]);
    expect(whatsapp.sendMessageDetailed).not.toHaveBeenCalled();
    // hatalı deneme "gitti" sayılmaz → tekrar denenir
    const r2 = await s.send('t1', '2026-08', 'A');
    expect(r2.results.map((x) => [x.channel, x.status])).toEqual([['EMAIL', 'FAILED']]);
    const a = (await s.list('t1', '2026-08', 'A'))[0];
    expect(a.gonderim.VERGI).toMatchObject({ status: 'SENT', kanallar: ['WHATSAPP'], toplamKalem: 2, gonderilenKalem: 2, yeniKalem: 0 });
    expect(a.satirlar[0].gonderim!.EMAIL).toBeNull();
  });

  it('test modunda gidenler "gönderilmiş" sayılmaz: test modu kapanınca aynı kalemler gerçekten gider; gerçek kayıt test kaydıyla ezilmez', async () => {
    const ayar = { testMode: true, testPhone: '905000000000', testEmail: 'test@x.y', whatsapp: true, email: false, senderName: null };
    const prisma = sahtePrisma({ beyan: beyanA(), vergiAyar: ayar });
    const { s, whatsapp } = servis(prisma);
    const t = await s.send('t1', '2026-08', 'A');
    expect(t.results.map((x) => [x.channel, x.yeni])).toEqual([['WHATSAPP', 2]]);
    expect(prisma._state.dispatch[0].dedupeKey).toMatch(/:T$/);
    let a = (await s.list('t1', '2026-08', 'A'))[0];
    expect(a.satirlar[0].gonderim!.WHATSAPP).toMatchObject({ test: true });
    expect(a.gonderim.VERGI).toMatchObject({ status: 'SENT', test: true, gonderilenKalem: 0, yeniKalem: 2 });

    ayar.testMode = false;
    const g = await s.send('t1', '2026-08', 'A');
    expect(g.atlanan).toBe(0);
    expect(g.results.map((x) => [x.channel, x.yeni])).toEqual([['WHATSAPP', 2]]);
    expect(whatsapp.sendMessageDetailed.mock.calls[1][0]).toBe('905551112233');
    expect(prisma._state.dispatch.length).toBe(2); // test satırı + gerçek satırı ayrı
    a = (await s.list('t1', '2026-08', 'A'))[0];
    expect(a.satirlar[0].gonderim!.WHATSAPP).toMatchObject({ test: false });
    expect(a.gonderim.VERGI).toMatchObject({ status: 'SENT', test: false, gonderilenKalem: 2, yeniKalem: 0 });

    // tekrar test moduna dönülüp 'hepsi' denense bile gerçek kayıt kaybolmaz
    ayar.testMode = true;
    await s.send('t1', '2026-08', 'A', 'hepsi');
    a = (await s.list('t1', '2026-08', 'A'))[0];
    expect(a.satirlar[0].gonderim!.WHATSAPP).toMatchObject({ test: false });
    expect((await s.send('t1', '2026-08', 'A')).atlanan).toBe(1); // test modunda da 'gonderilmemis' gerçek gitmiş kalemi atlar (test alıcısına bile gitmez)
  });

  it('aynı dönemde iki SGK fişi ayrı kalemdir (ref no): ikinci fiş sonradan gelirse yalnız o gider', async () => {
    const sgk = [
      { id: 's1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/07', referenceNo: '80646-2026-7', raw: { tutar: '4.420,95' }, storageKey: null },
    ];
    const prisma = sahtePrisma({ sgk, vergiAyar: gercekAyar() });
    const { s, whatsapp } = servis(prisma);
    await s.send('t1', '2026-08', 'A');
    sgk.push({ id: 's2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), title: 'SGK Tahakkuk Fişi', period: '2026/07', referenceNo: '39191-2026-7', raw: { tutar: '10.405,89' }, storageKey: null });
    const r = await s.send('t1', '2026-08', 'A');
    expect(r.results.map((x) => [x.channel, x.kalem, x.yeni])).toEqual([['WHATSAPP', 2, 1], ['EMAIL', 2, 1]]);
    const m = whatsapp.sendMessageDetailed.mock.calls[1][1] as string;
    expect(m).toContain('10.405,89  TL');
    expect(m).not.toContain('4.420,95');
    expect(prisma._state.yazilan[2].create.docRefs.map((d: any) => d.key)).toEqual(['SGK|Tahakkuk Fişi|2026/07||39191-2026-7']);
  });
});

describe('AylikOdemeService.ozet', () => {
  it('bölümleme toplamları ve KALEM BAZLI mükellef sayaçları (B tüm kalemleri gitti; A 3 yeni kalem)', async () => {
    const dispatch = [sentKaydi('B', '2026-08', 'VERGI', 'WHATSAPP', [K_B])];
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
    expect(oz.yeniKalemToplam).toBe(3);
    expect(oz.testMode).toBe(true);
    expect(oz.kanallar).toEqual({ whatsapp: true, email: true });
    expect(oz.otomatik).toEqual({ aktif: false, gun: 1, saat: 10, onayGerekli: true, sonKosu: null });
  });

  it('kısmi gönderim: A/VERGI gitti, SGK ve sonradan gelen kalem gitmedi → bekleyen; hiç iletilemeyen grup → hatali', async () => {
    const dispatch = [
      sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV, K_GECICI]),
      sentKaydi('B', '2026-08', 'VERGI', 'WHATSAPP', [K_B], { status: 'FAILED', sentAt: null }),
    ];
    const { s } = servis(sahtePrisma({ beyan: beyanlar, sgk: sgkler, dispatch }));
    const oz = await s.ozet('t1', '2026-08');
    expect(oz.gonderilen).toBe(0);
    expect(oz.bekleyen).toBe(1); // A: SGK kalemi yeni
    expect(oz.hatali).toBe(1); // B
    expect(oz.yeniKalemToplam).toBe(2);
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

  it('otomatik koşu (onaysız) kalem bazlıdır: daha önce giden kalemler atlanır, yalnız yeni beyanname gider', async () => {
    const beyan: any[] = [
      { id: 'b1', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'KDV1', donem: '2026-07', tahakkukTutari: '7046.77', pdfUrl: null, beyannameUrl: null },
      { id: 'b2', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'GGECICI', donem: '2026-Q2', tahakkukTutari: '12300', pdfUrl: null, beyannameUrl: null },
      { id: 'b3', taxpayerId: 'A', taxpayer: tp('A', 'ADEM CAN'), beyanTipi: 'DAMGA', donem: '2026-07', tahakkukTutari: '100', pdfUrl: null, beyannameUrl: null },
    ];
    const prisma = sahtePrisma({
      beyan,
      vergiAyar: { testMode: false, testPhone: null, testEmail: null, whatsapp: true, email: false, senderName: null },
      odemeAyar: { enabled: true, sendDay: 5, sendHour: 10, onayGerekli: false, lastRunAt: null },
      dispatch: [sentKaydi('A', '2026-08', 'VERGI', 'WHATSAPP', [K_KDV, K_GECICI])],
    });
    const { s, whatsapp, notifications } = servis(prisma);
    const r = await s.otomatikKosu('t1', '2026-08', false);
    expect(r).toEqual({ month: '2026-08', sonuc: 'gonderildi', gonderilen: 1 });
    expect(whatsapp.sendMessageDetailed).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).toContain('DAMGA');
    expect(whatsapp.sendMessageDetailed.mock.calls[0][1]).not.toContain('KDV1');
    expect(notifications.createForTenant.mock.calls[0][0].body).toBe('1 gönderim başarılı, 0 hatalı, 0 daha önce gönderildiği için atlandı.');
    // ikinci koşu: her şey gitmiş → 0 gönderim, 1 atlanan
    const r2 = await s.otomatikKosu('t1', '2026-08', false);
    expect(r2.gonderilen).toBe(0);
    expect(notifications.createForTenant.mock.calls[1][0].body).toBe('0 gönderim başarılı, 0 hatalı, 1 daha önce gönderildiği için atlandı.');
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

describe('AkilliBildirimService.odemeListesiTekille — rapor hücresi en son işlem satırını görsün', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AkilliBildirimService } = require('./akilli-bildirim.service');
  it('aynı mükellef/grup/kanal için eski FAILED, sonraki SENT tarafından yerini bırakır; test satırı ayrı; diğer kategoriler dokunulmaz', () => {
    const rows = [
      { kategori: 'ODEME_LISTESI', taxpayerId: 't1', dedupeKey: 'ODEME:t1:2026-09:VERGI:aaaaaaaaaa', channel: 'WHATSAPP', testMode: false, status: 'FAILED', createdAt: new Date('2026-09-10T09:00:00Z'), sentAt: null },
      { kategori: 'ODEME_LISTESI', taxpayerId: 't1', dedupeKey: 'ODEME:t1:2026-09:VERGI:bbbbbbbbbb', channel: 'WHATSAPP', testMode: false, status: 'SENT', createdAt: new Date('2026-09-12T09:00:00Z'), sentAt: new Date('2026-09-12T09:00:00Z') },
      { kategori: 'ODEME_LISTESI', taxpayerId: 't1', dedupeKey: 'ODEME:t1:2026-09:VERGI:cccccccccc:T', channel: 'WHATSAPP', testMode: true, status: 'SENT', createdAt: new Date('2026-09-13T09:00:00Z'), sentAt: new Date('2026-09-13T09:00:00Z') },
      { kategori: 'ODEME_LISTESI', taxpayerId: 't1', dedupeKey: 'ODEME:t1:2026-09:SGK:dddddddddd', channel: 'EMAIL', testMode: false, status: 'SENT', createdAt: new Date('2026-09-11T09:00:00Z'), sentAt: new Date('2026-09-11T09:00:00Z') },
      { kategori: 'VERGI', taxpayerId: 't1', dedupeKey: 'x', channel: 'WHATSAPP', testMode: false, status: 'FAILED', createdAt: new Date('2026-09-01T09:00:00Z'), sentAt: null },
    ];
    const out = AkilliBildirimService.odemeListesiTekille(rows);
    expect(out).toHaveLength(4);
    const vergiWa = out.filter((r: any) => r.kategori === 'ODEME_LISTESI' && r.channel === 'WHATSAPP' && !r.testMode);
    expect(vergiWa).toHaveLength(1);
    expect(vergiWa[0].status).toBe('SENT');
    expect(out.some((r: any) => r.kategori === 'VERGI' && r.status === 'FAILED')).toBe(true);
    expect(out.some((r: any) => r.testMode)).toBe(true);
  });
});
