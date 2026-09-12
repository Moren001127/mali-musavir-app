/**
 * ekip_ajan_baslat / ekip_is_durum (PLAN/17 §3, 2026-09-13) — Koordinatör başka ajanı ARKA PLANDA başlatır:
 *  - beklemez; çocuk koşunun 'baslangic' olayından isId alır, {ok:true, isId, dryRun:true} döner,
 *  - aynı ajan + mükellef için pending/running iş varsa {ok:false, mevcutIsId} (tekrar kilidi),
 *  - canlı yalnız Koordinatör koşusu canlıysa VE args.canli=true; kaynak 'koordinator' (ekip_onayla kapalı),
 *  - koordinatör kendine iş atayamaz; bilinmeyen ajan / boş görev reddedilir,
 *  - ekip_is_durum: iş dosyasını okur; bitmişse rapor.
 * Prisma / Agent SDK sahte.
 */
import { EkipRunnerService } from './ekip-runner.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sahtePrisma(mevcutIs: any = null) {
  const olusturulan: any[] = [];
  let sayac = 0;
  const kayitlar = new Map<string, any>();
  return {
    olusturulan,
    kayitlar,
    agentCommand: {
      create: async (arg: any) => {
        const id = `is-cocuk-${++sayac}`;
        olusturulan.push({ id, ...arg.data });
        kayitlar.set(id, { id, ...arg.data, result: null });
        return { id };
      },
      update: async (arg: any) => {
        const k = kayitlar.get(arg.where.id) || {};
        kayitlar.set(arg.where.id, { ...k, ...arg.data });
        return { id: arg.where.id };
      },
      findUnique: async () => ({ payload: {} }),
      findFirst: async (arg: any) => {
        if (arg?.where?.status?.in) return mevcutIs; // tekrar kilidi sorgusu
        return kayitlar.get(arg?.where?.id) || null; // isGetir
      },
    },
    agentEvent: { create: async () => ({}) },
    aiMemory: { create: async () => ({}) },
    aiUsageLog: { create: async () => ({}) },
  };
}

/** Hızlı sahte SDK: bir metin parçası + result. */
function sahteSdk() {
  return {
    tool: () => ({}),
    createSdkMcpServer: () => ({}),
    query: () => {
      async function* uret() {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'RAPOR: çocuk koşu bitti.' } } };
        await bekle(5);
        yield { type: 'result', is_error: false, total_cost_usd: 0 };
      }
      return uret();
    },
  };
}

function runnerKur(prisma: any) {
  const operator = { getRulesForUi: async () => [] };
  const r = new EkipRunnerService(prisma, {} as any, {} as any, operator as any, {} as any);
  (r as any).sdkYukle = async () => sahteSdk();
  (r as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
  const koordinatorP = (dryRun = true) => ({ ajanId: 'koordinator', gorev: 'ata', tenantId: 't1', userId: 'u1', kaynak: 'ses', dryRun });
  const arac = (name: string, args: any, dryRun = true) => (r as any).ekipAraciCalistir(name, args, koordinatorP(dryRun));
  return { r, arac };
}

describe('ekip_ajan_baslat (Koordinatör → ajan, arka plan)', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  it('beklemeden isId döner; çocuk iş dosyası kaynak=koordinator, dryRun=true; sonra ekip_is_durum ile rapor okunur', async () => {
    const prisma = sahtePrisma();
    const { arac } = runnerKur(prisma);
    const t0 = Date.now();
    const r = await arac('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'Erdoğan Balçık 2026/08 KDV kontrolünü yap (R1)', taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
    expect(r.ok).toBe(true);
    expect(r.isId).toBe('is-cocuk-1');
    expect(r.dryRun).toBe(true);
    expect(r.mesaj).toMatch(/kuru testte başladı/);
    expect(Date.now() - t0).toBeLessThan(2500); // baslangic olayı gelir gelmez döner
    expect(prisma.olusturulan[0]).toMatchObject({ agent: 'ekip:beyanname', status: 'pending', createdBy: 'u1' });
    expect(prisma.olusturulan[0].payload).toMatchObject({ kaynak: 'koordinator', dryRun: true, taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });

    // sürerken: bitti=false
    const surerken = await arac('ekip_is_durum', { isId: 'is-cocuk-1' });
    expect(surerken.ok).toBe(true);
    expect(['running', 'pending']).toContain(surerken.is.status);
    expect(surerken.is.bitti).toBe(false);
    expect(surerken.is.rapor).toBeNull();

    await bekle(60); // çocuk koşu arka planda biter
    const bitti = await arac('ekip_is_durum', { isId: 'is-cocuk-1' });
    expect(bitti.is.status).toBe('done');
    expect(bitti.is.bitti).toBe(true);
    expect(bitti.is.rapor).toContain('çocuk koşu bitti');
  });

  it('tekrar kilidi: aynı ajan+mükellef için çalışan iş varsa {ok:false, mevcutIsId}; yeni iş dosyası açılmaz', async () => {
    const prisma = sahtePrisma({ id: 'is-eski', status: 'running' });
    const { arac } = runnerKur(prisma);
    const r = await arac('ekip_ajan_baslat', { ajanId: 'analist', gorev: 'x', taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
    expect(r.ok).toBe(false);
    expect(r.mevcutIsId).toBe('is-eski');
    expect(r.error).toMatch(/çalışan\/bekleyen iş var/);
    expect(prisma.olusturulan).toEqual([]);
  });

  it('canlı yalnız Koordinatör koşusu canlı + canli:true; kuru koordinatörde canli:true yine kuru', async () => {
    const kuru = sahtePrisma();
    const a = runnerKur(kuru);
    const r1 = await a.arac('ekip_ajan_baslat', { ajanId: 'fatura', gorev: 'x', canli: true }, true);
    expect(r1.dryRun).toBe(true);
    expect(kuru.olusturulan[0].payload.dryRun).toBe(true);
    const canli = sahtePrisma();
    const b = runnerKur(canli);
    const r2 = await b.arac('ekip_ajan_baslat', { ajanId: 'fatura', gorev: 'x', canli: true }, false);
    expect(r2.dryRun).toBe(false);
    expect(canli.olusturulan[0].payload.dryRun).toBe(false);
    await bekle(60);
  });

  it('dryRun:false (tools.ts şeması) canli:true ile aynı: canlı koordinatörde canlı, kuru koordinatörde yine kuru (doğrulayıcı 2026-09-13)', async () => {
    const kuru = runnerKur(sahtePrisma());
    const r1 = await kuru.arac('ekip_ajan_baslat', { ajanId: 'fatura', gorev: 'x', dryRun: false }, true);
    expect({ ok: r1.ok, dryRun: r1.dryRun }).toEqual({ ok: true, dryRun: true });
    const canliP = sahtePrisma();
    const canli = runnerKur(canliP);
    const r2 = await canli.arac('ekip_ajan_baslat', { ajanId: 'fatura', gorev: 'x', dryRun: false }, false);
    expect({ ok: r2.ok, dryRun: r2.dryRun }).toEqual({ ok: true, dryRun: false });
    expect(canliP.olusturulan[0].payload.dryRun).toBe(false);
  });

  it('bilinmeyen ajan / kendine atama / boş görev reddedilir; ekip_is_durum bilinmeyen iş → ok:false', async () => {
    const prisma = sahtePrisma();
    const { arac } = runnerKur(prisma);
    expect((await arac('ekip_ajan_baslat', { ajanId: 'yok', gorev: 'x' })).error).toMatch(/Bilinmeyen ajan/);
    expect((await arac('ekip_ajan_baslat', { ajanId: 'koordinator', gorev: 'x' })).error).toMatch(/kendine iş atamaz/);
    expect((await arac('ekip_ajan_baslat', { ajanId: 'evrak', gorev: '' })).error).toMatch(/gorev zorunlu/);
    expect((await arac('ekip_is_durum', { isId: 'yok' })).ok).toBe(false);
    expect((await arac('ekip_is_durum', {})).error).toMatch(/isId zorunlu/);
    expect(prisma.olusturulan).toEqual([]);
  });
});
