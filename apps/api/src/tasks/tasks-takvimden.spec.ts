/**
 * POST /tasks/takvimden (2026-09-14) — vergi takvimi kaydından görev: kaynak TAKVIM, taxCalendarId,
 * başlık "<açıklama> — <dönem>", vade takvim tarihi (dueDate verilirse o), category BEYANNAME, priority HIGH;
 * mükellef bu tenant'ta olmalı. Ayrıca create/update DTO ekleri (tur, pinned, kaynak, notifyWhatsapp, notifyPush)
 * ve GET /tasks süzgeçleri (kaynak, tur) + counts şekli. Prisma sahte; ağ yok.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';

const TAKVIM: Record<string, any> = {
  c1: { id: 'c1', declarationType: 'KDV', periodMonth: 8, periodYear: 2026, periodQuarter: null, dueDate: new Date('2026-09-26T00:00:00.000Z'), description: 'KDV Beyannamesi' },
  c2: { id: 'c2', declarationType: 'GECICI', periodMonth: null, periodYear: 2026, periodQuarter: 3, dueDate: new Date('2026-11-17T00:00:00.000Z'), description: null },
};

function sahtePrisma() {
  const olusturulan: any[] = [];
  const sorgular: any[] = [];
  return {
    olusturulan,
    sorgular,
    taxCalendar: { findUnique: async (arg: any) => TAKVIM[arg.where.id] || null },
    taxpayer: { findFirst: async (arg: any) => (arg.where.id === 'tp1' && arg.where.tenantId === 't1' ? { id: 'tp1' } : null) },
    task: {
      create: async (arg: any) => {
        olusturulan.push(arg);
        return { id: `g${olusturulan.length}`, ...arg.data };
      },
      findFirst: async () => ({ id: 'g1', tenantId: 't1' }),
      update: async (arg: any) => {
        olusturulan.push(arg);
        return { id: arg.where.id, ...arg.data };
      },
      findMany: async (arg: any) => {
        sorgular.push(arg);
        return [];
      },
      count: async (arg: any) => {
        sorgular.push(arg);
        return 0;
      },
    },
  };
}

const servisKur = (prisma: any) => new TasksService(prisma as any, {} as any);

describe('POST /tasks/takvimden', () => {
  it('takvim kaydından görev: başlık + dönem, vade takvim tarihi, BEYANNAME/HIGH, kaynak TAKVIM, hatırlatma varsayılanları açık', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.takvimdenOlustur('t1', 'u1', { taxCalendarId: 'c1', taxpayerId: 'tp1' });
    expect(r.title).toBe('KDV Beyannamesi — 2026-08');
    expect(prisma.olusturulan[0].data).toMatchObject({
      tenantId: 't1',
      createdById: 'u1',
      taxpayerId: 'tp1',
      title: 'KDV Beyannamesi — 2026-08',
      category: 'BEYANNAME',
      priority: 'HIGH',
      kaynak: 'TAKVIM',
      tur: 'GOREV',
      taxCalendarId: 'c1',
      dueDate: new Date('2026-09-26T00:00:00.000Z'),
      dueTime: null,
      allDay: true,
      notifyWhatsapp: true,
      notifyPush: true,
    });
    expect(prisma.olusturulan[0].include.taxpayer).toBeTruthy();
  });

  it('dueDate/dueTime verilirse onlar; açıklamasız kayıtta ad = beyanname türü; mükellefsiz de olur', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.takvimdenOlustur('t1', 'u1', { taxCalendarId: 'c2', dueDate: '2026-11-10T00:00:00.000Z', dueTime: '09:30' });
    expect(r.title).toBe('GECICI — 2026-Q3');
    expect(prisma.olusturulan[0].data).toMatchObject({ taxpayerId: null, dueDate: new Date('2026-11-10T00:00:00.000Z'), dueTime: '09:30', allDay: false });
  });

  it('bilinmeyen takvim / başka tenant mükellefi → 404; taxCalendarId yoksa / dueDate bozuksa → 400', async () => {
    const s = servisKur(sahtePrisma());
    await expect(s.takvimdenOlustur('t1', 'u1', { taxCalendarId: 'yok' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.takvimdenOlustur('t2', 'u1', { taxCalendarId: 'c1', taxpayerId: 'tp1' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.takvimdenOlustur('t1', 'u1', { taxCalendarId: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.takvimdenOlustur('t1', 'u1', { taxCalendarId: 'c1', dueDate: 'yarın' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('create / update DTO ekleri + list süzgeçleri + counts (2026-09-14)', () => {
  it('create: varsayılanlar tur GOREV, kaynak MANUEL, pinned false, WhatsApp+push açık; geçersiz tur/kaynak varsayılana düşer', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    await s.create('t1', 'u1', { title: 'x' });
    expect(prisma.olusturulan[0].data).toMatchObject({ tur: 'GOREV', kaynak: 'MANUEL', pinned: false, notifyWhatsapp: true, notifyPush: true, taxCalendarId: null, isTemplate: false });
    await s.create('t1', 'u1', { title: 'not', tur: 'NOT', pinned: true, kaynak: 'AI', notifyWhatsapp: false, notifyPush: false, recurrence: { type: 'WEEKLY' } });
    // not: tekrar şablonu olmaz
    expect(prisma.olusturulan[1].data).toMatchObject({ tur: 'NOT', kaynak: 'AI', pinned: true, notifyWhatsapp: false, notifyPush: false, isTemplate: false });
    await s.create('t1', 'u1', { title: 'y', tur: 'BAŞKA' as any, kaynak: 'UZAY' as any, recurrence: { type: 'WEEKLY' } });
    expect(prisma.olusturulan[2].data).toMatchObject({ tur: 'GOREV', kaynak: 'MANUEL', isTemplate: true });
  });

  it('update: yeni alanlar yazılır; geçersiz tur/kaynak 400', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    await s.update('t1', 'g1', 'u1', { tur: 'NOT', pinned: true, kaynak: 'EKIP', notifyWhatsapp: false, notifyPush: true, taxCalendarId: '' });
    expect(prisma.olusturulan[0].data).toEqual({ tur: 'NOT', pinned: true, kaynak: 'EKIP', notifyWhatsapp: false, notifyPush: true, taxCalendarId: null });
    await expect(s.update('t1', 'g1', 'u1', { tur: 'X' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.update('t1', 'g1', 'u1', { kaynak: 'X' as any })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list: kaynak/tur süzgeçleri where’e girer; verilmezse eski davranış; arama mükellef adını da kapsar', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    await s.list({ tenantId: 't1', kaynak: 'banka', tur: 'not', search: 'balçık' });
    const where = prisma.sorgular[0].where;
    expect(where).toMatchObject({ tenantId: 't1', kaynak: 'BANKA', tur: 'NOT' });
    expect(where.OR).toHaveLength(3);
    expect(where.OR[2].taxpayer).toBeTruthy();
    prisma.sorgular.length = 0;
    await s.list({ tenantId: 't1', kaynak: 'uzay', tur: 'x' });
    expect(prisma.sorgular[0].where).toEqual({ tenantId: 't1' });
  });

  it('counts: eski şekil korunur (today/overdue/thisWeek/totalOpen) + acik + not; yalnız tur GOREV sayılır', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.getCounts('t1');
    expect(Object.keys(r).sort()).toEqual(['acik', 'not', 'overdue', 'thisWeek', 'today', 'totalOpen']);
    const gorevSayimlari = prisma.sorgular.filter((q) => q.where.tur === 'GOREV');
    expect(gorevSayimlari).toHaveLength(4);
    for (const q of gorevSayimlari) expect(q.where).toMatchObject({ tenantId: 't1', isTemplate: false, status: { in: ['OPEN', 'IN_PROGRESS'] } });
    const notSayimi = prisma.sorgular.find((q) => q.where.tur === 'NOT')!;
    expect(notSayimi.where.status).toEqual({ notIn: ['DONE', 'CANCELLED'] });
  });
});
