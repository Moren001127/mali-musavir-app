/**
 * İŞ KAYDI ↔ MÜKELLEF BAĞI (pilot koşu bulgusu): iş dosyası mükellefsiz açıldığında
 * ilk geçerli taxpayerId'li araç çağrısı payload.taxpayerId'yi BİR KEZ günceller ve
 * ctx.taxpayerId'yi kurar. Prisma/araçlar sahte; ağ/DB/Agent SDK yok.
 */
import { EkipRunnerService } from './ekip-runner.service';
import { ajanBul } from './ajan-tanimlari';

const CUID = 'cmqgpx7xd0d7swns6sw3am42o';
const CUID2 = 'cmqgpx7xd0d7swns6sw3am43p';

function sahtePrisma(baslangicPayload: any) {
  const updates: any[] = [];
  let payload = { ...baslangicPayload };
  return {
    updates,
    agentCommand: {
      findUnique: async () => ({ payload }),
      update: async (arg: any) => {
        updates.push(arg);
        payload = arg?.data?.payload ?? payload;
        return { id: arg?.where?.id, payload };
      },
    },
  };
}

function isleyiciKur(prisma: any, opts: { taxpayerId?: string | null; dryRun?: boolean } = {}) {
  const tools = { execute: async (name: string, args: any, ctx: any) => ({ ok: true, name, gorulenTaxpayerId: ctx.taxpayerId }) };
  const runner = new EkipRunnerService(prisma, tools as any, {} as any, {} as any, {} as any);
  const ctx = { tenantId: 't', userId: null as string | null, taxpayerId: opts.taxpayerId ?? null };
  const p: any = { ajanId: 'beyanname', gorev: 'KDV hazırla', tenantId: 't', kaynak: 'portal', taxpayerId: opts.taxpayerId ?? null };
  const olaylar: any[] = [];
  const isleyici = (runner as any).portalAracIsleyici({
    p,
    ajan: ajanBul('beyanname')!,
    isId: 'is1',
    dryRun: opts.dryRun ?? true,
    ctx,
    emit: (e: any) => olaylar.push(e),
    toolUses: [],
    kuruTestYapilacaktilar: [],
    onayBekleyen: [],
  });
  const cagir = async (name: string, args: any) => JSON.parse((await isleyici({ name, args })).content[0].text);
  return { cagir, ctx, p, olaylar };
}

describe('iş ↔ mükellef bağı (runner.portalAracIsleyici)', () => {
  it('ilk taxpayerId\'li araç çağrısı payload.taxpayerId\'yi bir kez günceller, ctx/p\'ye yazar; sonraki çağrılar dokunmaz', async () => {
    const prisma = sahtePrisma({ gorev: 'KDV hazırla', dryRun: true, taxpayerId: null, kaynak: 'portal' });
    const { cagir, ctx, p } = isleyiciKur(prisma);

    // taxpayerId'siz çağrı → bağ kurulmaz
    await cagir('list_taxpayers', { search: 'FAMCOFFEE' });
    expect(prisma.updates).toHaveLength(0);
    expect(ctx.taxpayerId).toBeNull();

    // geçersiz id (cuid değil) → bağ kurulmaz
    await cagir('get_taxpayer', { taxpayerId: 'FAMCOFFEE' });
    expect(prisma.updates).toHaveLength(0);

    // ilk geçerli cuid → payload güncellenir, mevcut alanlar korunur
    const r = await cagir('get_taxpayer', { taxpayerId: CUID });
    expect(r.ok).toBe(true);
    expect(r.gorulenTaxpayerId).toBe(CUID); // araç ctx'i güncel mükellefle çağrıldı
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0]).toEqual({
      where: { id: 'is1' },
      data: { payload: { gorev: 'KDV hazırla', dryRun: true, taxpayerId: CUID, kaynak: 'portal' } },
    });
    expect(ctx.taxpayerId).toBe(CUID);
    expect(p.taxpayerId).toBe(CUID);

    // ikinci (farklı) mükellef → BİR KEZ kuralı: dokunulmaz
    await cagir('get_taxpayer', { taxpayerId: CUID2 });
    expect(prisma.updates).toHaveLength(1);
    expect(ctx.taxpayerId).toBe(CUID);
  });

  it('görevle mükellef geldiyse (ctx.taxpayerId dolu) payload\'a hiç dokunulmaz', async () => {
    const prisma = sahtePrisma({ gorev: 'x', dryRun: true, taxpayerId: CUID });
    const { cagir, ctx } = isleyiciKur(prisma, { taxpayerId: CUID });
    await cagir('get_taxpayer', { taxpayerId: CUID2 });
    expect(prisma.updates).toHaveLength(0);
    expect(ctx.taxpayerId).toBe(CUID);
  });

  it('kuru testte engellenen luca_yaz çağrısı da bağı kurar (fetch_kdv_from_luca)', async () => {
    const prisma = sahtePrisma({ gorev: 'x', dryRun: true, taxpayerId: null });
    const { cagir, ctx, olaylar } = isleyiciKur(prisma, { dryRun: true });
    const r = await cagir('fetch_kdv_from_luca', { taxpayerId: CUID, donem: '2026-08' });
    expect(r.kuruTest).toBe(true);
    expect(olaylar.some((e) => e.type === 'kuruTest' && e.name === 'fetch_kdv_from_luca')).toBe(true);
    expect(prisma.updates).toHaveLength(1);
    expect(ctx.taxpayerId).toBe(CUID);
  });

  it('prisma hata verirse yutulur; araç yine çalışır ve ctx yine kurulur', async () => {
    const prisma = {
      agentCommand: {
        findUnique: async () => { throw new Error('db yok'); },
        update: async () => { throw new Error('db yok'); },
      },
    };
    const { cagir, ctx } = isleyiciKur(prisma);
    const r = await cagir('get_taxpayer', { taxpayerId: CUID });
    expect(r.ok).toBe(true);
    expect(ctx.taxpayerId).toBe(CUID);
  });
});
