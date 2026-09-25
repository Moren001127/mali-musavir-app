/**
 * GET /tasks/ajanda (2026-09-14, Görevler & Notlar yeniden tasarımı) — birleştirme:
 *  - gruplar: gorevler (tur GOREV, OPEN|IN_PROGRESS|SNOOZED) / notlar (tur NOT, DONE|CANCELLED hariç) / ekipIstekler / takvim
 *  - ekip "sizden istenen" eşlemesi: AUTOMATION + automationId 'ekip:' + tur 'istek' + açık; mükellef adı taxpayers'tan
 *  - takvim gorevVar: bu takvim kaydından açılmış AÇIK görev var mı; pencere bugünden `gun` gün
 *  - sayaçlar Istanbul günü; süzgeçten bağımsız
 * Prisma sahte; ağ yok. Sistem saati: 2026-09-14 (Pazartesi) 13:00 Istanbul.
 */
import { TasksService, ajandaZamanAraliklari, istanbulGunBasi, takvimDonemi } from './tasks.service';

const SIMDI = new Date('2026-09-14T10:00:00.000Z'); // Istanbul 13:00, Pazartesi

const GOREVLER = [
  { id: 'g1', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: '2026-09-14T00:00:00.000Z', pinned: false, taxpayerId: 'tp1' },
  { id: 'g2', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: '2026-09-13T21:30:00.000Z', pinned: false }, // Istanbul 14 Eylül 00:30 → bugün
  { id: 'g3', tenantId: 't1', tur: 'GOREV', status: 'IN_PROGRESS', isTemplate: false, dueDate: '2026-09-13T20:30:00.000Z' }, // Istanbul 13 Eylül 23:30 → gecikmiş
  // 2026-09-25 (denetim bulgusu 34): erteleme BİTİŞ TARİHİ YOK ama vadesi geçmiş →
  // ekran tarafı (etkinTarih) bunu zaten 'gecikmiş' grubuna koyuyordu; sayaç ise saymıyordu.
  // Artık sayaç da sayıyor. (Hâlâ ertelemede olan — snoozedUntil ileri tarihli — sayılmaz: g10.)
  { id: 'g4', tenantId: 't1', tur: 'GOREV', status: 'SNOOZED', isTemplate: false, dueDate: '2026-09-10T00:00:00.000Z', snoozedUntil: null },
  { id: 'g10', tenantId: 't1', tur: 'GOREV', status: 'SNOOZED', isTemplate: false, dueDate: '2026-09-09T00:00:00.000Z', snoozedUntil: '2026-10-01T00:00:00.000Z' }, // HÂLÂ ertelemede → gecikmiş DEĞİL
  { id: 'g5', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: '2026-09-20T12:00:00.000Z', taxCalendarId: 'c1' }, // Pazar → bu hafta
  { id: 'g6', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: '2026-09-21T00:00:00.000Z' }, // Pazartesi 03:00 → gelecek hafta
  { id: 'g7', tenantId: 't1', tur: 'GOREV', status: 'DONE', isTemplate: false, dueDate: '2026-09-14T08:00:00.000Z' },
  { id: 'g8', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: true, dueDate: '2026-09-14T08:00:00.000Z' },
  { id: 'g9', tenantId: 't1', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: null },
  { id: 'n1', tenantId: 't1', tur: 'NOT', status: 'OPEN', isTemplate: false, dueDate: null, pinned: true },
  { id: 'n2', tenantId: 't1', tur: 'NOT', status: 'CANCELLED', isTemplate: false, dueDate: null },
  { id: 'x1', tenantId: 't2', tur: 'GOREV', status: 'OPEN', isTemplate: false, dueDate: '2026-09-14T08:00:00.000Z' }, // başka tenant
];

const TAKVIM = [
  { id: 'c1', declarationType: 'KDV', periodMonth: 8, periodYear: 2026, periodQuarter: null, dueDate: new Date('2026-09-26T00:00:00.000Z'), description: 'KDV Beyannamesi' },
  { id: 'c2', declarationType: 'GECICI', periodMonth: null, periodYear: 2026, periodQuarter: 3, dueDate: new Date('2026-10-10T00:00:00.000Z'), description: null },
  { id: 'c3', declarationType: 'YILLIK', periodMonth: null, periodYear: 2026, periodQuarter: null, dueDate: new Date('2026-12-01T00:00:00.000Z'), description: 'Yıllık' }, // 30 gün dışı
];

const BILDIRIMLER = [
  { id: 'b1', tenantId: 't1', type: 'AUTOMATION', isRead: false, title: 'Fiş dosyası gerekli', body: 'Ağustos fişleri taranıp yüklenmeli', createdAt: new Date('2026-09-13T09:00:00.000Z'), metadata: { automationId: 'ekip:banka-kasa:isX', tur: 'istek', taxpayerId: 'tp1', vakaId: 'vaka1', ajanId: 'banka-kasa' } },
  { id: 'b2', tenantId: 't1', type: 'AUTOMATION', isRead: false, title: 'Kapanmış istek', body: '', createdAt: new Date('2026-09-12T09:00:00.000Z'), metadata: { automationId: 'ekip:fatura:isY', tur: 'istek', kapandi: '2026-09-12T10:00:00.000Z' } },
  { id: 'b3', tenantId: 't1', type: 'AUTOMATION', isRead: false, title: 'Evrak hatırlatma', body: '', createdAt: new Date('2026-09-12T09:00:00.000Z'), metadata: { automationId: 'evrak-hatirlatma', tur: 'istek' } },
  { id: 'b4', tenantId: 't1', type: 'AUTOMATION', isRead: false, title: 'Onay bekliyor', body: '', createdAt: new Date('2026-09-12T09:00:00.000Z'), metadata: { automationId: 'ekip:musteri:isZ', tur: 'onay' } },
  { id: 'b5', tenantId: 't1', type: 'AUTOMATION', isRead: false, title: 'Şifre gerekli', body: 'GİB şifresi', createdAt: new Date('2026-09-11T09:00:00.000Z'), metadata: { automationId: 'ekip:beyanname:isW', tur: 'istek', taxpayerId: 'tp-yok' } },
];

/** where → kayıt uyuyor mu (yalnız testte kullanılan alanlar). */
function uyar(t: any, where: any): boolean {
  // 2026-09-25: OR desteği eklendi. Gecikmiş sayacı (denetim bulgusu 34) artık OR ile
  // kuruluyor; OR görmezden gelinince sahte prisma TÜM açık görevleri sayıyor ve sayaç
  // sınaması anlamsızlaşıyordu (beklenen 1, gelen 7).
  if (Array.isArray(where.OR)) {
    if (!where.OR.some((dal: any) => uyar(t, dal))) return false;
  }
  if (where.snoozedUntil !== undefined) {
    const su = t.snoozedUntil ? new Date(t.snoozedUntil).getTime() : null;
    if (where.snoozedUntil === null) {
      if (su !== null) return false;
    } else if (where.snoozedUntil.lt) {
      if (su === null || su >= where.snoozedUntil.lt.getTime()) return false;
    }
  }
  if (typeof where.status === 'string' && t.status !== where.status) return false;
  if (where.tenantId && t.tenantId !== where.tenantId) return false;
  if (where.isTemplate !== undefined && !!t.isTemplate !== where.isTemplate) return false;
  if (where.tur && t.tur !== where.tur) return false;
  if (where.taxpayerId && t.taxpayerId !== where.taxpayerId) return false;
  if (where.status?.in && !where.status.in.includes(t.status)) return false;
  if (where.status?.notIn && where.status.notIn.includes(t.status)) return false;
  if (where.dueDate) {
    const d = t.dueDate ? new Date(t.dueDate).getTime() : null;
    if (d === null) return false;
    if (where.dueDate.gte && d < where.dueDate.gte.getTime()) return false;
    if (where.dueDate.lte && d > where.dueDate.lte.getTime()) return false;
    if (where.dueDate.lt && d >= where.dueDate.lt.getTime()) return false;
  }
  if (where.taxCalendarId?.in && !where.taxCalendarId.in.includes(t.taxCalendarId)) return false;
  return true;
}

function sahtePrisma(opts: { jsonSuzgeciDusur?: boolean } = {}) {
  const cagrilar: Array<{ model: string; op: string; arg: any }> = [];
  const kaydet = (model: string, op: string, arg: any) => cagrilar.push({ model, op, arg });
  return {
    cagrilar,
    task: {
      findMany: async (arg: any) => {
        kaydet('task', 'findMany', arg);
        const rows = GOREVLER.filter((t) => uyar(t, arg.where));
        if (arg.select?.taxCalendarId) return rows.map((r) => ({ taxCalendarId: r.taxCalendarId || null }));
        return rows.map((r) => ({ ...r, _count: { notes: 0 } }));
      },
      count: async (arg: any) => {
        kaydet('task', 'count', arg);
        return GOREVLER.filter((t) => uyar(t, arg.where)).length;
      },
    },
    taxCalendar: {
      findMany: async (arg: any) => {
        kaydet('taxCalendar', 'findMany', arg);
        return TAKVIM.filter((c) => uyar({ dueDate: c.dueDate }, { dueDate: arg.where.dueDate }));
      },
    },
    notification: {
      findMany: async (arg: any) => {
        kaydet('notification', 'findMany', arg);
        if (arg.where.metadata) {
          if (opts.jsonSuzgeciDusur) throw new Error('JSON path desteklenmiyor');
          return BILDIRIMLER.filter((b) => b.tenantId === arg.where.tenantId && b.isRead === false && b.metadata?.tur === 'istek');
        }
        return BILDIRIMLER.filter((b) => b.tenantId === arg.where.tenantId && b.isRead === false);
      },
    },
    taxpayer: {
      findMany: async (arg: any) => {
        kaydet('taxpayer', 'findMany', arg);
        return [{ id: 'tp1', companyName: 'ERDOĞAN BALÇIK', firstName: 'Erdoğan', lastName: 'Balçık' }].filter((t) => arg.where.id.in.includes(t.id));
      },
    },
  };
}

function servisKur(prisma: any) {
  const s = new TasksService(prisma as any, {} as any);
  (s as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
  return s;
}

describe('ajanda zaman aralıkları (Istanbul günü)', () => {
  it('gün başı/sonu ve hafta sonu (Pazar) Istanbul saatine göre; Pazar günü haftaSonu = günün sonu', () => {
    const z = ajandaZamanAraliklari(SIMDI);
    expect(z.gunBasi.toISOString()).toBe('2026-09-13T21:00:00.000Z');
    expect(z.gunSonu.toISOString()).toBe('2026-09-14T20:59:59.999Z');
    expect(z.haftaSonu.toISOString()).toBe('2026-09-20T20:59:59.999Z');
    // Sunucu UTC'de 22:30 iken Istanbul'da ertesi gün 01:30 — gün başı ertesi güne kayar
    expect(istanbulGunBasi(new Date('2026-09-14T22:30:00.000Z')).toISOString()).toBe('2026-09-14T21:00:00.000Z');
    const pazar = ajandaZamanAraliklari(new Date('2026-09-20T10:00:00.000Z'));
    expect(pazar.haftaSonu.toISOString()).toBe('2026-09-20T20:59:59.999Z');
  });

  it('takvim dönemi etiketi: ay / çeyrek / yıl', () => {
    expect(takvimDonemi({ periodYear: 2026, periodMonth: 8 })).toBe('2026-08');
    expect(takvimDonemi({ periodYear: 2026, periodQuarter: 2 })).toBe('2026-Q2');
    expect(takvimDonemi({ periodYear: 2026 })).toBe('2026');
  });
});

describe('GET /tasks/ajanda — birleştirme', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: SIMDI });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('gruplar + sayaçlar: görevler yalnız açık GOREV, notlar DONE/CANCELLED hariç, sayaçlar Istanbul günü', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.ajanda('t1');

    expect(r.gorevler.map((g: any) => g.id).sort()).toEqual(['g1', 'g10', 'g2', 'g3', 'g4', 'g5', 'g6', 'g9']);
    expect(r.notlar.map((n: any) => n.id)).toEqual(['n1']);
    expect(r.sayaclar).toEqual({ bugun: 2, gecikmis: 2, buHafta: 3, acik: 8, istek: 2, not: 1 });

    // görev sorgusu: tenant + tur + açık durumlar + sabit önce, not sayısı dahil
    const gorevSorgu = prisma.cagrilar.find((c) => c.model === 'task' && c.op === 'findMany' && c.arg.where.tur === 'GOREV')!;
    expect(gorevSorgu.arg.where).toMatchObject({ tenantId: 't1', isTemplate: false, tur: 'GOREV', status: { in: ['OPEN', 'IN_PROGRESS', 'SNOOZED'] } });
    expect(gorevSorgu.arg.orderBy[0]).toEqual({ pinned: 'desc' });
    expect(gorevSorgu.arg.include._count).toEqual({ select: { notes: true } });
    expect(gorevSorgu.arg.include.taxpayer).toBeTruthy();
    const notSorgu = prisma.cagrilar.find((c) => c.model === 'task' && c.op === 'findMany' && c.arg.where.tur === 'NOT')!;
    expect(notSorgu.arg.where.status).toEqual({ notIn: ['DONE', 'CANCELLED'] });
    expect(notSorgu.arg.orderBy[0]).toEqual({ pinned: 'desc' });
  });

  it('ekip "sizden istenen": yalnız açık ekip istekleri; mükellef adı çözülür; bilinmeyen mükellef null', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.ajanda('t1');
    expect(r.ekipIstekler).toEqual([
      { id: 'b1', baslik: 'Fiş dosyası gerekli', aciklama: 'Ağustos fişleri taranıp yüklenmeli', taxpayerId: 'tp1', mukellefAd: 'ERDOĞAN BALÇIK', vakaId: 'vaka1', ajanId: 'banka-kasa', createdAt: '2026-09-13T09:00:00.000Z' },
      { id: 'b5', baslik: 'Şifre gerekli', aciklama: 'GİB şifresi', taxpayerId: 'tp-yok', mukellefAd: null, vakaId: null, ajanId: null, createdAt: '2026-09-11T09:00:00.000Z' },
    ]);
    // mükellef adları tek sorguyla, tenant süzgeçli
    const tp = prisma.cagrilar.filter((c) => c.model === 'taxpayer');
    expect(tp).toHaveLength(1);
    expect(tp[0].arg.where).toEqual({ tenantId: 't1', id: { in: ['tp1', 'tp-yok'] } });
  });

  it('JSON süzgeci düşerse bellekte süzülür — aynı sonuç (kapanmış / ekip-dışı / onay türü elenir)', async () => {
    const prisma = sahtePrisma({ jsonSuzgeciDusur: true });
    const s = servisKur(prisma);
    const r = await s.ajanda('t1');
    expect(r.ekipIstekler.map((i: any) => i.id)).toEqual(['b1', 'b5']);
    expect(r.sayaclar.istek).toBe(2);
  });

  it('takvim: bugünden gun gün ileri (varsayılan 30), gorevVar bu kayıttan açılmış açık görev', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.ajanda('t1');
    expect(r.takvim).toEqual([
      { id: 'c1', ad: 'KDV Beyannamesi', tur: 'KDV', tarih: '2026-09-26T00:00:00.000Z', donem: '2026-08', gorevVar: true },
      { id: 'c2', ad: 'GECICI', tur: 'GECICI', tarih: '2026-10-10T00:00:00.000Z', donem: '2026-Q3', gorevVar: false },
    ]);
    const takvimSorgu = prisma.cagrilar.find((c) => c.model === 'taxCalendar')!;
    expect(takvimSorgu.arg.where.dueDate.gte.toISOString()).toBe('2026-09-13T21:00:00.000Z');
    expect(takvimSorgu.arg.where.dueDate.lte.toISOString()).toBe('2026-10-14T20:59:59.999Z');
    expect(takvimSorgu.arg.take).toBe(100);
    // gorevVar sorgusu yalnız açık görevlere bakar
    const gv = prisma.cagrilar.find((c) => c.model === 'task' && c.op === 'findMany' && c.arg.select?.taxCalendarId)!;
    expect(gv.arg.where).toMatchObject({ tenantId: 't1', taxCalendarId: { in: ['c1', 'c2'] }, status: { in: ['OPEN', 'IN_PROGRESS', 'SNOOZED'] } });

    // gun=90 → c3 de girer; gun sınırı 1..365
    const r90 = await s.ajanda('t1', { gun: '90' });
    expect(r90.takvim.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('süzgeçler listelere uygulanır, sayaçlar değişmez: taxpayerId / search (mükellef adıyla) / tur', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);

    const tp = await s.ajanda('t1', { taxpayerId: 'tp1' });
    expect(tp.gorevler.map((g: any) => g.id)).toEqual(['g1']);
    expect(tp.ekipIstekler.map((i: any) => i.id)).toEqual(['b1']);
    expect(tp.sayaclar).toEqual({ bugun: 2, gecikmis: 2, buHafta: 3, acik: 8, istek: 2, not: 1 });

    const ara = await s.ajanda('t1', { search: 'balçık' });
    expect(ara.ekipIstekler.map((i: any) => i.id)).toEqual(['b1']); // mükellef adından, büyük/küçük harf duyarsız
    const gorevSorgu = prisma.cagrilar.filter((c) => c.model === 'task' && c.op === 'findMany' && c.arg.where.tur === 'GOREV').pop()!;
    expect(gorevSorgu.arg.where.OR).toEqual([
      { title: { contains: 'balçık', mode: 'insensitive' } },
      { description: { contains: 'balçık', mode: 'insensitive' } },
      { taxpayer: { OR: [{ companyName: { contains: 'balçık', mode: 'insensitive' } }, { firstName: { contains: 'balçık', mode: 'insensitive' } }, { lastName: { contains: 'balçık', mode: 'insensitive' } }] } },
    ]);

    const yalnizNot = await s.ajanda('t1', { tur: 'NOT' });
    expect(yalnizNot.gorevler).toEqual([]);
    expect(yalnizNot.notlar.map((n: any) => n.id)).toEqual(['n1']);
    const yalnizGorev = await s.ajanda('t1', { tur: 'GOREV', kaynak: 'BANKA', priority: 'HIGH', category: 'BANKA' });
    expect(yalnizGorev.notlar).toEqual([]);
    const sonGorevSorgu = prisma.cagrilar.filter((c) => c.model === 'task' && c.op === 'findMany' && c.arg.where.tur === 'GOREV').pop()!;
    expect(sonGorevSorgu.arg.where).toMatchObject({ kaynak: 'BANKA', priority: 'HIGH', category: 'BANKA' });
  });

  it('başka tenant görünmez; takvim okunamazsa boş liste, akış bozulmaz', async () => {
    const prisma = sahtePrisma();
    prisma.taxCalendar.findMany = async () => {
      throw new Error('tablo yok');
    };
    const s = servisKur(prisma);
    const r = await s.ajanda('t2');
    expect(r.gorevler.map((g: any) => g.id)).toEqual(['x1']);
    expect(r.takvim).toEqual([]);
    expect(r.ekipIstekler).toEqual([]);
    expect(r.sayaclar).toEqual({ bugun: 1, gecikmis: 0, buHafta: 1, acik: 1, istek: 0, not: 0 });
  });
});
