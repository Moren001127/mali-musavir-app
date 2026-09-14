/**
 * POST /tasks/toplu (2026-09-14) — toplu işlem: tenant süzgeci şart (başka tenant'ın id'si etkilenmez),
 * her işlem doğru veriyi yazar, sil = hard delete (deleteMany where tenantId), geçersiz istek reddedilir.
 * Prisma sahte; ağ yok.
 */
import { BadRequestException } from '@nestjs/common';
import { TasksService } from './tasks.service';

const KAYITLAR = [
  { id: 'a', tenantId: 't1' },
  { id: 'b', tenantId: 't1' },
  { id: 'c', tenantId: 't2' }, // başka tenant
];

function sahtePrisma() {
  const cagrilar: Array<{ op: string; arg: any }> = [];
  const say = (where: any) => KAYITLAR.filter((k) => where.id.in.includes(k.id) && k.tenantId === where.tenantId).length;
  return {
    cagrilar,
    task: {
      updateMany: async (arg: any) => {
        cagrilar.push({ op: 'updateMany', arg });
        return { count: say(arg.where) };
      },
      deleteMany: async (arg: any) => {
        cagrilar.push({ op: 'deleteMany', arg });
        return { count: say(arg.where) };
      },
    },
  };
}

function servisKur(prisma: any) {
  return new TasksService(prisma as any, {} as any);
}

describe('POST /tasks/toplu', () => {
  it('tamamla: yalnız kendi tenant kayıtları etkilenir; DONE + completedAt + completedById', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.toplu('t1', 'u1', { ids: ['a', 'b', 'c', 'c', ''], islem: 'tamamla' });
    expect(r).toEqual({ ok: true, etkilenen: 2 });
    expect(prisma.cagrilar).toHaveLength(1);
    expect(prisma.cagrilar[0].op).toBe('updateMany');
    expect(prisma.cagrilar[0].arg.where).toEqual({ id: { in: ['a', 'b', 'c'] }, tenantId: 't1' });
    expect(prisma.cagrilar[0].arg.data).toMatchObject({ status: 'DONE', completedById: 'u1' });
    expect(prisma.cagrilar[0].arg.data.completedAt).toBeInstanceOf(Date);
  });

  it('yeniden-ac / iptal / sabitle / sabit-kaldir / kategori / oncelik doğru veriyi yazar', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'yeniden-ac' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'iptal' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'sabitle' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'sabit-kaldir' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'kategori', category: ' BEYANNAME ' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'kategori', category: '' });
    await s.toplu('t1', 'u1', { ids: ['a'], islem: 'oncelik', priority: 'urgent' });
    expect(prisma.cagrilar.map((c) => c.arg.data)).toEqual([
      { status: 'OPEN', completedAt: null, completedById: null, snoozedUntil: null },
      { status: 'CANCELLED' },
      { pinned: true },
      { pinned: false },
      { category: 'BEYANNAME' },
      { category: null },
      { priority: 'URGENT' },
    ]);
    for (const c of prisma.cagrilar) expect(c.arg.where.tenantId).toBe('t1');
  });

  it('ertele: geçerli until → SNOOZED + snoozedUntil; until yoksa/bozuksa 400', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.toplu('t1', 'u1', { ids: ['a', 'c'], islem: 'ertele', until: '2026-09-16T06:00:00.000Z' });
    expect(r).toEqual({ ok: true, etkilenen: 1 });
    expect(prisma.cagrilar[0].arg.data).toEqual({ status: 'SNOOZED', snoozedUntil: new Date('2026-09-16T06:00:00.000Z') });
    await expect(s.toplu('t1', 'u1', { ids: ['a'], islem: 'ertele' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toplu('t1', 'u1', { ids: ['a'], islem: 'ertele', until: 'dün' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sil: deleteMany where tenantId — başka tenant kaydı silinmez', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    const r = await s.toplu('t2', 'u9', { ids: ['a', 'b', 'c'], islem: 'sil' });
    expect(r).toEqual({ ok: true, etkilenen: 1 });
    expect(prisma.cagrilar).toEqual([{ op: 'deleteMany', arg: { where: { id: { in: ['a', 'b', 'c'] }, tenantId: 't2' } } }]);
  });

  it('boş ids / bilinmeyen işlem / eksik kategori / geçersiz öncelik → 400, yazma yok', async () => {
    const prisma = sahtePrisma();
    const s = servisKur(prisma);
    await expect(s.toplu('t1', 'u1', { ids: [], islem: 'tamamla' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toplu('t1', 'u1', { ids: ['a'], islem: 'uçur' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toplu('t1', 'u1', { ids: ['a'], islem: 'kategori' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.toplu('t1', 'u1', { ids: ['a'], islem: 'oncelik', priority: 'ÇOK' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cagrilar).toEqual([]);
  });
});
