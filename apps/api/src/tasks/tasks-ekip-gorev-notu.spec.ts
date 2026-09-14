/**
 * Runner tarafı (2026-09-14, Görevler "Ekibe ver"): calistir({ gorevId }) →
 *  - iş dosyası payload.gorevId dolu,
 *  - koşu bitince göreve TaskNote: raporun "RAPOR:" sonrası ilk 600 karakteri + iş kimliği; görev DURUMU değişmez,
 *  - hata ile bitişte "Koşu hata ile bitti: …" notu; görev tenant'ta yoksa not yazılmaz; gorevId yoksa dokunulmaz.
 * Prisma / Agent SDK sahte (ekip-ajan-baslat.spec kalıbı).
 */
import { EkipRunnerService, raporOzeti } from '../ekip/ekip-runner.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sahtePrisma(gorev: any = { id: 'g1', tenantId: 't1', createdById: 'u-olusturan' }) {
  const olusturulan: any[] = [];
  const notlar: any[] = [];
  const gorevGuncellemeleri: any[] = [];
  let sayac = 0;
  const kayitlar = new Map<string, any>();
  return {
    olusturulan,
    notlar,
    gorevGuncellemeleri,
    agentCommand: {
      create: async (arg: any) => {
        const id = `is-${++sayac}`;
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
      findFirst: async (arg: any) => kayitlar.get(arg?.where?.id) || null,
    },
    task: {
      findFirst: async (arg: any) => (gorev && arg.where.id === gorev.id && arg.where.tenantId === gorev.tenantId ? { id: gorev.id, createdById: gorev.createdById } : null),
      update: async (arg: any) => {
        gorevGuncellemeleri.push(arg);
        return {};
      },
    },
    taskNote: {
      create: async (arg: any) => {
        notlar.push(arg.data);
        return { id: `n${notlar.length}`, ...arg.data };
      },
    },
    agentEvent: { create: async () => ({}) },
    aiMemory: { create: async () => ({}) },
    aiUsageLog: { create: async () => ({}) },
  };
}

function sahteSdk(metin: string, hata = false) {
  return {
    tool: () => ({}),
    createSdkMcpServer: () => ({}),
    query: () => {
      async function* uret() {
        if (metin) yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: metin } } };
        await bekle(5);
        yield { type: 'result', is_error: hata, total_cost_usd: 0 };
      }
      return uret();
    },
  };
}

function runnerKur(prisma: any, metin: string, hata = false) {
  const operator = { getRulesForUi: async () => [] };
  const r = new EkipRunnerService(prisma, {} as any, {} as any, operator as any, {} as any);
  (r as any).sdkYukle = async () => sahteSdk(metin, hata);
  (r as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
  return r;
}

describe('raporOzeti', () => {
  it('"RAPOR:" sonrası; 600 karakterle kırpılır; boş → ""', () => {
    expect(raporOzeti('Önce aracı yükledim.\nRAPOR: KDV kontrolü tamam.')).toBe('KDV kontrolü tamam.');
    expect(raporOzeti('**RAPOR:** bulgu yok')).toBe('bulgu yok');
    expect(raporOzeti('düz metin')).toBe('düz metin');
    expect(raporOzeti('')).toBe('');
    const uzun = raporOzeti('RAPOR: ' + 'a'.repeat(700));
    expect(uzun).toHaveLength(601);
    expect(uzun.endsWith('…')).toBe(true);
    expect(raporOzeti('RAPOR: ' + 'b'.repeat(50), 20)).toBe('b'.repeat(20) + '…');
  });
});

describe('calistir({ gorevId }) → görev notu', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  it('payload.gorevId yazılır; bitince rapor notu (RAPOR: sonrası, iş kimliği, ajan adı, kuru test); görev durumu değişmez', async () => {
    const prisma = sahtePrisma();
    const r = runnerKur(prisma, 'İyi, aracı yükledim. Şimdi bakıyorum.\nRAPOR: Erdoğan Balçık 2026/08 KDV kontrolü tamamlandı; 3 belge eksik.');
    const sonuc = await r.calistir({ ajanId: 'koordinator', gorev: 'Görev metni', tenantId: 't1', userId: 'u1', kaynak: 'portal', dryRun: true, gorevId: 'g1' });
    expect(sonuc.isId).toBe('is-1');
    expect(prisma.olusturulan[0].payload).toMatchObject({ gorevId: 'g1', kaynak: 'portal', dryRun: true });
    expect(prisma.notlar).toHaveLength(1);
    expect(prisma.notlar[0]).toMatchObject({ taskId: 'g1', userId: 'u1' });
    expect(prisma.notlar[0].content).toBe('Ekip raporu — Koordinatör (kuru test, iş is-1)\nErdoğan Balçık 2026/08 KDV kontrolü tamamlandı; 3 belge eksik.');
    expect(prisma.gorevGuncellemeleri).toEqual([]); // durum Muzaffer Bey'de
  });

  it('kullanıcı yoksa notu görevi açan yazar; canlı koşuda "canlı"', async () => {
    const prisma = sahtePrisma();
    const r = runnerKur(prisma, 'RAPOR: bitti');
    await r.calistir({ ajanId: 'analist', gorev: 'x', tenantId: 't1', userId: null, kaynak: 'cron', dryRun: false, gorevId: 'g1' });
    expect(prisma.notlar[0]).toMatchObject({ taskId: 'g1', userId: 'u-olusturan' });
    expect(prisma.notlar[0].content).toMatch(/^Ekip raporu — .+ \(canlı, iş is-1\)\nbitti$/);
  });

  it('hata ile biten koşu: "Koşu hata ile bitti" notu', async () => {
    const prisma = sahtePrisma();
    const r = runnerKur(prisma, '', true);
    const sonuc = await r.calistir({ ajanId: 'koordinator', gorev: 'x', tenantId: 't1', userId: 'u1', kaynak: 'portal', gorevId: 'g1' });
    expect(sonuc.hata).toBeTruthy();
    expect(prisma.notlar).toHaveLength(1);
    expect(prisma.notlar[0].content).toContain('Koşu hata ile bitti:');
    expect(prisma.notlar[0].content).toContain('iş is-1');
  });

  it('gorevId yoksa ya da görev bu tenant\'ta değilse not yazılmaz', async () => {
    const yok = sahtePrisma();
    await runnerKur(yok, 'RAPOR: a').calistir({ ajanId: 'koordinator', gorev: 'x', tenantId: 't1', userId: 'u1', kaynak: 'portal' });
    expect(yok.notlar).toEqual([]);
    expect(yok.olusturulan[0].payload.gorevId).toBeNull();

    const baskaTenant = sahtePrisma({ id: 'g1', tenantId: 't2', createdById: 'u9' });
    await runnerKur(baskaTenant, 'RAPOR: a').calistir({ ajanId: 'koordinator', gorev: 'x', tenantId: 't1', userId: 'u1', kaynak: 'portal', gorevId: 'g1' });
    expect(baskaTenant.notlar).toEqual([]);
  });
});
