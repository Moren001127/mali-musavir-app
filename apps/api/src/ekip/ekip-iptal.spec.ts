/**
 * DURDUR (gerçek iptal): çalışan ekip koşusu iptalEt(isId) ya da dış AbortSignal ile durdurulunca
 *  - Agent SDK query()'ye verilen abortController tetiklenir,
 *  - iş dosyası status='failed', result.hata='iptal edildi (sahip)' (bağlantı kopmasında '(bağlantı koptu)'),
 *  - AgentEvent status='hata' + meta.iptal yazılır,
 *  - akışa {type:'error'} gider, çalışan koşu haritasından silinir.
 * Prisma / Agent SDK sahte; ağ/DB/alt süreç yok.
 */
import { EkipRunnerService, IPTAL_HATA_METNI } from './ekip-runner.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sahtePrisma() {
  const updates: any[] = [];
  const olaylar: any[] = [];
  return {
    updates,
    olaylar,
    agentCommand: {
      create: async () => ({ id: 'is-iptal-1' }),
      update: async (arg: any) => {
        updates.push(arg);
        return { id: arg?.where?.id };
      },
      findUnique: async () => ({ payload: {} }),
    },
    agentEvent: { create: async (arg: any) => olaylar.push(arg?.data) },
    aiMemory: { create: async () => ({}) },
    aiUsageLog: { create: async () => ({}) },
  };
}

/** Sahte Agent SDK: abort gelene kadar metin akıtır; abort olunca gerçek SDK gibi AbortError fırlatır. */
function sahteSdk() {
  const durum = { abortController: null as AbortController | null, verilenOptions: null as any };
  const sdk = {
    tool: (..._a: any[]) => ({}),
    createSdkMcpServer: (..._a: any[]) => ({}),
    query: ({ options }: any) => {
      durum.verilenOptions = options;
      durum.abortController = options?.abortController || null;
      const ac: AbortController = options.abortController;
      async function* uret() {
        for (let i = 0; i < 200; i++) {
          if (ac.signal.aborted) {
            const e: any = new Error('The operation was aborted');
            e.name = 'AbortError';
            throw e;
          }
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `parça${i} ` } } };
          await bekle(5);
        }
        yield { type: 'result', is_error: false, total_cost_usd: 0.01 };
      }
      return uret();
    },
  };
  return { sdk, durum };
}

function runnerKur(prisma: any, sdk: any): EkipRunnerService {
  const operator = { getRulesForUi: async () => [] };
  const r = new EkipRunnerService(prisma, {} as any, {} as any, operator as any, {} as any);
  (r as any).sdkYukle = async () => sdk;
  return r;
}

describe('ekip koşusu DURDUR (iptalEt / AbortSignal → failed)', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  it('iptalEt(isId) → SDK abortController tetiklenir, iş failed + "iptal edildi (sahip)", AgentEvent hata, error olayı', async () => {
    const prisma = sahtePrisma();
    const { sdk, durum } = sahteSdk();
    const runner = runnerKur(prisma, sdk);
    const akis: any[] = [];

    const kosu = runner.calistir({ ajanId: 'analist', gorev: 'ciro özeti çıkar', tenantId: 't1', kaynak: 'portal', emit: (e) => akis.push(e) });

    // Koşu başlasın, birkaç parça aksın
    await bekle(40);
    expect(runner.calisanIsIdleri()).toEqual(['is-iptal-1']);
    expect(akis.some((e) => e.type === 'text')).toBe(true);

    // Başka tenant durduramaz
    expect(runner.iptalEt('baska', 'is-iptal-1').ok).toBe(false);
    expect(durum.abortController!.signal.aborted).toBe(false);

    // Sahip durdurur
    const r = runner.iptalEt('t1', 'is-iptal-1');
    expect(r).toEqual({ ok: true, isId: 'is-iptal-1' });
    expect(durum.abortController!.signal.aborted).toBe(true);
    // İkinci çağrı da ok; neden değişmez
    expect(runner.iptalEt('t1', 'is-iptal-1').ok).toBe(true);

    const sonuc = await kosu;
    expect(sonuc.hata).toBe(IPTAL_HATA_METNI.sahip);
    expect(sonuc.hata).toBe('iptal edildi (sahip)');
    expect(sonuc.ogrenilen).toEqual([]);
    expect(runner.calisanIsIdleri()).toEqual([]); // haritadan silindi

    // İş dosyası: running → failed, result.hata dolu, yarım rapor korunur
    const kapanis = prisma.updates.find((u) => u?.data?.status === 'failed');
    expect(kapanis).toBeTruthy();
    expect(kapanis.where).toEqual({ id: 'is-iptal-1' });
    expect(kapanis.data.result.hata).toBe('iptal edildi (sahip)');
    expect(kapanis.data.result.rapor).toContain('parça0');
    expect(prisma.updates.some((u) => u?.data?.status === 'done')).toBe(false);

    // AgentEvent
    expect(prisma.olaylar).toHaveLength(1);
    expect(prisma.olaylar[0]).toMatchObject({ agent: 'ekip', action: 'analist', status: 'hata', message: 'iptal edildi (sahip)' });
    expect(prisma.olaylar[0].meta).toMatchObject({ isId: 'is-iptal-1', iptal: 'sahip' });

    // Akış: done YOK, error VAR
    expect(akis.some((e) => e.type === 'done')).toBe(false);
    const hataOlayi = akis.find((e) => e.type === 'error');
    expect(hataOlayi).toMatchObject({ type: 'error', error: 'iptal edildi (sahip)', isId: 'is-iptal-1' });

    // Bitmiş iş artık durdurulamaz
    expect(runner.iptalEt('t1', 'is-iptal-1').ok).toBe(false);
  });

  it('dış AbortSignal (bağlantı koptu) → aynı yol, hata "iptal edildi (bağlantı koptu)"', async () => {
    const prisma = sahtePrisma();
    const { sdk, durum } = sahteSdk();
    const runner = runnerKur(prisma, sdk);
    const kopma = new AbortController();

    const kosu = runner.calistir({ ajanId: 'analist', gorev: 'x', tenantId: 't1', kaynak: 'portal', signal: kopma.signal });
    await bekle(30);
    kopma.abort();
    const sonuc = await kosu;

    expect(durum.abortController!.signal.aborted).toBe(true);
    expect(sonuc.hata).toBe(IPTAL_HATA_METNI.baglanti);
    const kapanis = prisma.updates.find((u) => u?.data?.status === 'failed');
    expect(kapanis.data.result.hata).toBe('iptal edildi (bağlantı koptu)');
    expect(prisma.olaylar[0].meta.iptal).toBe('baglanti');
    expect(runner.calisanIsIdleri()).toEqual([]);
  });

  it('bilinmeyen iş → {ok:false, error}', () => {
    const runner = runnerKur(sahtePrisma(), sahteSdk().sdk);
    const r = runner.iptalEt('t1', 'yok');
    expect(r.ok).toBe(false);
    expect(r.isId).toBe('yok');
    expect(typeof r.error).toBe('string');
  });
});
