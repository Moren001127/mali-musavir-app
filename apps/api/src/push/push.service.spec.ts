/**
 * ANLIK BİLDİRİM (push) — birim testleri. Ağ yok (fetch sahte), DB yok (Prisma sahte).
 *  - belirteç kaydı idempotent, persona kimlikten türer, geçersiz belirteç reddedilir
 *  - sessiz saat (22:00–08:00 İstanbul) atlanır; acil (yeni cihaz) gece de gider
 *  - 100'lük parçalama
 *  - DeviceNotRegistered (bilet + makbuz) → disabledAt
 *  - kanca hatası ana akışı bozmaz; rota eşlemesi; atlanan tipler; tekrar süzgeci
 *  - JWT gövdesinden strateji seçimi (jwtGovdesi / kimlikCikar)
 */
import { BadRequestException } from '@nestjs/common';
import { PushService } from './push.service';
import { kimlikCikar } from './push-kimlik.guard';
import { jwtGovdesi, kisalt, oluBelirtecler, parcala, rotaSec, sessizSaatMi } from './expo-push';

const GUNDUZ = new Date('2026-09-13T07:00:00Z'); // 10:00 İstanbul
const GECE = new Date('2026-09-13T20:30:00Z'); // 23:30 İstanbul
const belirtec = (i: number) => `ExponentPushToken[cihaz${String(i).padStart(6, '0')}]`;

type Satir = { id: string; tenantId: string; userId: string | null; taxpayerId: string | null; token: string; platform: string; persona: string; disabledAt: Date | null; lastSeenAt?: Date };

function sahtePrisma(baslangic: Partial<Satir>[] = []) {
  const satirlar = new Map<string, Satir>();
  baslangic.forEach((s, i) =>
    satirlar.set(s.token!, { id: `pt${i}`, tenantId: 't1', userId: null, taxpayerId: null, platform: 'android', persona: 'adv', disabledAt: null, ...s } as Satir),
  );
  const eslesir = (r: Satir, where: any) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as any) ? (v as any).in.includes((r as any)[k]) : (r as any)[k] === v));
  const kancalar: Array<(n: any) => void> = [];
  return {
    satirlar,
    kancalar,
    onNotificationCreated: (cb: (n: any) => void) => kancalar.push(cb),
    pushToken: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const m = satirlar.get(where.token);
        if (m) {
          Object.assign(m, update);
          return m;
        }
        const y: Satir = { id: `pt${satirlar.size}`, disabledAt: null, ...create };
        satirlar.set(where.token, y);
        return y;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        let n = 0;
        for (const r of Array.from(satirlar.values())) if (eslesir(r, where)) { satirlar.delete(r.token); n++; }
        return { count: n };
      }),
      findMany: jest.fn(async ({ where }: any) => Array.from(satirlar.values()).filter((r) => eslesir(r, where)).map((r) => ({ token: r.token }))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of satirlar.values()) if (eslesir(r, where)) { Object.assign(r, data); n++; }
        return { count: n };
      }),
    },
  };
}

/** Sahte Expo: her mesaja 'ok' bileti; `olu` listesindekilere DeviceNotRegistered. */
function sahteFetch(olu: string[] = []) {
  const istekler: any[] = [];
  const fn = jest.fn(async (_url: string, init: any) => {
    const govde = JSON.parse(init.body);
    istekler.push(govde);
    const data = Array.isArray(govde)
      ? govde.map((m: any, i: number) => (olu.includes(m.to) ? { status: 'error', message: 'kayıtsız', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `bilet-${istekler.length}-${i}` }))
      : {};
    return { ok: true, status: 200, text: async () => JSON.stringify({ data }) };
  });
  return { fn, istekler };
}

function kur(prisma: any, zaman: Date = GUNDUZ) {
  const s = new PushService(prisma);
  jest.spyOn(s as any, 'simdi').mockImplementation(() => zaman);
  return s;
}

const beklet = () => new Promise((r) => setImmediate(r));

describe('PushService — belirteç kaydı', () => {
  const eskiEnv = { ...process.env };
  afterEach(() => { process.env = { ...eskiEnv }; (global as any).fetch = undefined; });

  it('aynı belirteç ikinci kez gelince tek satır kalır, lastSeenAt tazelenir, kapalıysa açılır', async () => {
    const p = sahtePrisma();
    const s = kur(p);
    const ilk = await s.kaydet({ tenantId: 't1', userId: 'u1' }, { token: belirtec(1), platform: 'android', persona: 'adv', deviceName: 'Pixel' });
    expect(ilk.ok).toBe(true);
    p.satirlar.get(belirtec(1))!.disabledAt = new Date('2026-01-01');
    const ikinci = await s.kaydet({ tenantId: 't1', userId: 'u1' }, { token: belirtec(1), platform: 'android', persona: 'adv' });
    expect(ikinci.id).toBe(ilk.id);
    expect(p.satirlar.size).toBe(1);
    expect(p.satirlar.get(belirtec(1))!.disabledAt).toBeNull();
    expect(p.satirlar.get(belirtec(1))!.lastSeenAt).toEqual(GUNDUZ);
  });

  it('persona kimlikten türer: mükellef belirteci adv olarak KAYDEDİLEMEZ; aynı cihaz el değiştirince sahip güncellenir', async () => {
    const p = sahtePrisma();
    const s = kur(p);
    await s.kaydet({ tenantId: 't1', taxpayerId: 'tp1' }, { token: belirtec(2), platform: 'ios', persona: 'adv' });
    const r = p.satirlar.get(belirtec(2))!;
    expect(r.persona).toBe('tax');
    expect(r.taxpayerId).toBe('tp1');
    expect(r.userId).toBeNull();
    // aynı cihazda müşavir girdi
    await s.kaydet({ tenantId: 't1', userId: 'u9' }, { token: belirtec(2), platform: 'ios' });
    expect(r.persona).toBe('adv');
    expect(r.userId).toBe('u9');
    expect(r.taxpayerId).toBeNull();
  });

  it('geçersiz belirteç reddedilir', async () => {
    const s = kur(sahtePrisma());
    await expect(s.kaydet({ tenantId: 't1', userId: 'u1' }, { token: 'abc', platform: 'android' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sil: yalnız kendi kaydını siler', async () => {
    const p = sahtePrisma([{ token: belirtec(3), userId: 'u1' }, { token: belirtec(4), userId: 'u2' }]);
    const s = kur(p);
    expect((await s.sil({ tenantId: 't1', userId: 'u1' }, belirtec(4))).silinen).toBe(0); // başkasının
    expect((await s.sil({ tenantId: 't1', userId: 'u1' }, belirtec(3))).silinen).toBe(1);
    expect(p.satirlar.size).toBe(1);
  });
});

describe('PushService — gönderim', () => {
  const eskiEnv = { ...process.env };
  afterEach(() => { process.env = { ...eskiEnv }; (global as any).fetch = undefined; });

  it('sessiz saatte (23:30 İstanbul) gönderilmez, gündüz gönderilir, acil gece de gider', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const gece = kur(p, GECE);
    expect(await gece.gonder({ userId: 'u1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 0, hatali: 0, atlandi: 'sessiz-saat' });
    expect(f.fn).not.toHaveBeenCalled();
    expect(await gece.gonder({ userId: 'u1' }, { title: 'Yeni cihaz', body: 'giriş', acil: true })).toEqual({ gonderildi: 1, hatali: 0 });
    const gunduz = kur(p, GUNDUZ);
    expect(await gunduz.gonder({ userId: 'u1' }, { title: 'a', body: 'b', data: { route: 'bildirim' } })).toEqual({ gonderildi: 1, hatali: 0 });
    expect(f.istekler[1][0]).toMatchObject({ to: belirtec(1), title: 'a', body: 'b', data: { route: 'bildirim' }, sound: 'default', priority: 'high', channelId: 'varsayilan' });
  });

  it('sessiz saat sınırları: 22:00 dahil, 08:00 hariç; env ile değiştirilebilir', () => {
    expect(sessizSaatMi(new Date('2026-09-13T19:00:00Z'))).toBe(true); // 22:00
    expect(sessizSaatMi(new Date('2026-09-13T18:59:00Z'))).toBe(false); // 21:59
    expect(sessizSaatMi(new Date('2026-09-13T04:59:00Z'))).toBe(true); // 07:59
    expect(sessizSaatMi(new Date('2026-09-13T05:00:00Z'))).toBe(false); // 08:00
    process.env.PUSH_SESSIZ_BASLANGIC = '23';
    process.env.PUSH_SESSIZ_BITIS = '7';
    expect(sessizSaatMi(new Date('2026-09-13T19:00:00Z'))).toBe(false); // 22:00 artık serbest
  });

  it('PUSH_BILDIRIM=off → hiç gönderilmez', async () => {
    process.env.PUSH_BILDIRIM = 'off';
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(sahtePrisma([{ token: belirtec(1), userId: 'u1' }]));
    expect(await s.gonder({ userId: 'u1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 0, hatali: 0, atlandi: 'kapali' });
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('250 cihaz → 100 + 100 + 50 olarak üç istek', async () => {
    const satirlar = Array.from({ length: 250 }, (_, i) => ({ token: belirtec(i), tenantId: 't1', persona: 'adv' }));
    const p = sahtePrisma(satirlar);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(p);
    const sonuc = await s.gonder({ tenantId: 't1' }, { title: 'Ofis geneli', body: 'duyuru' });
    expect(sonuc).toEqual({ gonderildi: 250, hatali: 0 });
    expect(f.istekler.map((g) => g.length)).toEqual([100, 100, 50]);
    expect(f.fn.mock.calls[0][0]).toBe('https://exp.host/--/api/v2/push/send');
  });

  it('tenant geneli hedef yalnız müşavir (adv) ve açık cihazlara gider', async () => {
    const p = sahtePrisma([
      { token: belirtec(1), tenantId: 't1', persona: 'adv' },
      { token: belirtec(2), tenantId: 't1', persona: 'tax' },
      { token: belirtec(3), tenantId: 't1', persona: 'adv', disabledAt: new Date() },
      { token: belirtec(4), tenantId: 't2', persona: 'adv' },
    ]);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(p);
    expect(await s.gonder({ tenantId: 't1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 1, hatali: 0 });
    expect(f.istekler[0].map((m: any) => m.to)).toEqual([belirtec(1)]);
  });

  it('DeviceNotRegistered bileti → belirteç kapatılır (disabledAt), diğerleri gider', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }, { token: belirtec(2), userId: 'u1' }]);
    const f = sahteFetch([belirtec(2)]);
    (global as any).fetch = f.fn;
    const s = kur(p);
    expect(await s.gonder({ userId: 'u1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 1, hatali: 1 });
    expect(p.satirlar.get(belirtec(2))!.disabledAt).toEqual(GUNDUZ);
    expect(p.satirlar.get(belirtec(1))!.disabledAt).toBeNull();
    // ikinci gönderimde kapalı cihaz artık listede yok
    (global as any).fetch = sahteFetch().fn;
    expect(await s.gonder({ userId: 'u1' }, { title: 'c', body: 'd' })).toEqual({ gonderildi: 1, hatali: 0 });
  });

  it('makbuz kontrolü: bilet ok ama makbuz DeviceNotRegistered → kapatılır', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    const gonderim = sahteFetch();
    (global as any).fetch = gonderim.fn;
    const s = kur(p);
    await s.gonder({ userId: 'u1' }, { title: 'a', body: 'b' });
    const biletId = 'bilet-1-0';
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      expect(url).toBe('https://exp.host/--/api/v2/push/getReceipts');
      expect(JSON.parse(init.body)).toEqual({ ids: [biletId] });
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { [biletId]: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) };
    });
    expect(await s.makbuzKontrol()).toBe(1);
    expect(p.satirlar.get(belirtec(1))!.disabledAt).toEqual(GUNDUZ);
    expect(await s.makbuzKontrol()).toBe(0); // liste boşaldı
  });

  it('Expo 5xx ya da ağ hatası fırlatmaz; hatalı sayılır', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'bakım' }));
    const s = kur(p);
    expect(await s.gonder({ userId: 'u1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 0, hatali: 1 });
    (global as any).fetch = jest.fn(async () => { throw new Error('ağ yok'); });
    expect(await s.gonder({ userId: 'u1' }, { title: 'a', body: 'b' })).toEqual({ gonderildi: 0, hatali: 1 });
  });
});

describe('PushService — merkezi kanca (Prisma onNotificationCreated)', () => {
  const eskiEnv = { ...process.env };
  afterEach(() => { process.env = { ...eskiEnv }; (global as any).fetch = undefined; });

  it('onModuleInit kancayı kaydeder; bildirim kaydı → kullanıcının cihazına push, rota bildirim', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(p);
    s.onModuleInit();
    expect(p.kancalar).toHaveLength(1);
    p.kancalar[0]({ id: 'n1', tenantId: 't1', userId: 'u1', type: 'TASK_DUE', title: 'Görev   son gün', body: 'KDV beyannamesi\n\nyarın', metadata: { link: '/panel/gorevler' } });
    await beklet();
    await beklet();
    expect(f.istekler).toHaveLength(1);
    expect(f.istekler[0][0]).toMatchObject({ to: belirtec(1), title: 'Görev son gün', body: 'KDV beyannamesi yarın', data: { route: 'bildirim', bildirimId: 'n1', tip: 'TASK_DUE' } });
  });

  it('kanca hatası ana akışı BOZMAZ (DB düşse de fırlatmaz, Prisma ara katmanı sonucu döner)', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    p.pushToken.findMany.mockImplementation(async () => { throw new Error('DB kopuk'); });
    const s = kur(p);
    s.onModuleInit();
    // PrismaService.$use ara katmanının yaptığı gibi: callback senkron çağrılır, sonuç aynen döner
    const araKatman = (kayit: any) => { for (const cb of p.kancalar) cb(kayit); return kayit; };
    const sonuc = araKatman({ id: 'n2', tenantId: 't1', userId: 'u1', type: 'TASK_DUE', title: 'x', body: 'y' });
    expect(sonuc.id).toBe('n2');
    await beklet();
    await beklet();
    expect(() => s.bildirimKancasi(null)).not.toThrow();
    expect(() => s.bildirimKancasi({ tenantId: 't1', title: 'z', metadata: 'bozuk', type: 'AGENT', userId: 'u1' })).not.toThrow();
    await beklet();
  });

  it('WHATSAPP tipi ve PUSH_ATLA_TIPLER atlanır; tenant geneli (userId=null) tüm müşavir cihazlarına gider', async () => {
    process.env.PUSH_ATLA_TIPLER = 'KDV_RESULT';
    const p = sahtePrisma([{ token: belirtec(1), tenantId: 't1', persona: 'adv' }, { token: belirtec(2), tenantId: 't1', persona: 'tax' }]);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(p);
    s.bildirimKancasi({ id: 'a', tenantId: 't1', userId: null, type: 'WHATSAPP', title: 'mesaj', body: 'b' });
    s.bildirimKancasi({ id: 'b', tenantId: 't1', userId: null, type: 'KDV_RESULT', title: 'kdv', body: 'b' });
    s.bildirimKancasi({ id: 'c', tenantId: 't1', userId: null, type: 'E_TEBLIGAT', title: 'tebligat', body: 'b' });
    await beklet();
    await beklet();
    expect(f.istekler).toHaveLength(1);
    expect(f.istekler[0].map((m: any) => m.to)).toEqual([belirtec(1)]);
    expect(f.istekler[0][0].title).toBe('tebligat');
  });

  it('tekrar süzgeci: aynı hedef+tip 10 sn içinde ikinci kez gitmez (e-Tebligat muaf)', async () => {
    const p = sahtePrisma([{ token: belirtec(1), userId: 'u1' }]);
    const f = sahteFetch();
    (global as any).fetch = f.fn;
    const s = kur(p);
    for (let i = 0; i < 5; i++) s.bildirimKancasi({ id: `t${i}`, tenantId: 't1', userId: 'u1', type: 'TAX_DEADLINE', title: `Mükellef ${i}`, body: 'b' });
    for (let i = 0; i < 3; i++) s.bildirimKancasi({ id: `e${i}`, tenantId: 't1', userId: 'u1', type: 'E_TEBLIGAT', title: `Tebligat ${i}`, body: 'b' });
    await beklet();
    await beklet();
    expect(f.istekler).toHaveLength(4); // 1 TAX_DEADLINE + 3 E_TEBLIGAT
  });

  it('rota eşlemesi: ekip (automationId ekip: / tur onay-istek) → m:ekip, diğerleri → bildirim', () => {
    expect(rotaSec({ metadata: { automationId: 'ekip:muhasebe:is1' } })).toBe('m:ekip');
    expect(rotaSec({ metadata: { automationId: 'auto-1', tur: 'onay' } })).toBe('m:ekip');
    expect(rotaSec({ metadata: { tur: 'istek' } })).toBe('m:ekip');
    expect(rotaSec({ metadata: { tur: 'bilgi' } })).toBe('bildirim');
    expect(rotaSec({ metadata: { automationId: 'auto-1' } })).toBe('bildirim');
    expect(rotaSec({ metadata: null })).toBe('bildirim');
    expect(rotaSec(null)).toBe('bildirim');
  });
});

describe('saf yardımcılar', () => {
  it('parcala / kisalt / oluBelirtecler', () => {
    expect(parcala([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(parcala([], 100)).toEqual([]);
    expect(kisalt('  çok   uzun \n metin ', 8)).toBe('çok uzu…');
    expect(kisalt('kısa', 10)).toBe('kısa');
    const gonderilen = [{ to: 'A' }, { to: 'B' }, { to: 'C' }] as any[];
    expect(oluBelirtecler([{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageTooBig' } }], gonderilen)).toEqual(['B']);
    expect(oluBelirtecler(undefined, gonderilen)).toEqual([]);
  });

  it('jwtGovdesi doğrulamadan gövdeyi okur; kimlikCikar tarafı ayırır', () => {
    const govde = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const mukellef = `Bearer x.${govde({ sub: 'tp1', type: 'taxpayer' })}.imza`;
    const musavir = `Bearer x.${govde({ sub: 'u1', tenantId: 't1' })}.imza`;
    expect(jwtGovdesi(mukellef)?.type).toBe('taxpayer');
    expect(jwtGovdesi(musavir)?.type).toBeUndefined();
    expect(jwtGovdesi('Bearer bozuk')).toBeNull();
    expect(jwtGovdesi(undefined)).toBeNull();
    expect(kimlikCikar({ taxpayerId: 'tp1', tenantId: 't1', type: 'taxpayer' })).toEqual({ tenantId: 't1', taxpayerId: 'tp1' });
    expect(kimlikCikar({ sub: 'u1', userId: 'u1', tenantId: 't1', roles: ['OWNER'] })).toEqual({ tenantId: 't1', userId: 'u1' });
    expect(() => kimlikCikar({ tenantId: 't1' })).toThrow();
    expect(() => kimlikCikar(null)).toThrow();
  });
});
