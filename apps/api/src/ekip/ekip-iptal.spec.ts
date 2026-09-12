/**
 * DURDUR (gerçek iptal): çalışan ekip koşusu iptalEt(isId) ya da dış AbortSignal ile durdurulunca
 *  - Agent SDK query()'ye verilen abortController tetiklenir,
 *  - iş dosyası status='failed', result.hata='iptal edildi (Muzaffer Bey)' (dış sinyalde '(bağlantı koptu)'),
 *  - AgentEvent status='hata' + meta.iptal yazılır,
 *  - akışa {type:'error'} gider, çalışan koşu haritasından silinir.
 * 2026-09-13 (PLAN/17 Faz C): CONTROLLER SSE kopmasında sinyal VERMEZ — koşu arka planda sürer; tek iptal yolu
 * POST /ekip/isler/:id/iptal. Runner'daki `signal` alanı başka çağıranlar için kaldı (2. test onu kapsar).
 * Prisma / Agent SDK sahte; ağ/DB/alt süreç yok.
 */
import { EventEmitter } from 'events';
import { EkipRunnerService, IPTAL_HATA_METNI } from './ekip-runner.service';
import { EkipController } from './ekip.controller';

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

  it('iptalEt(isId) → SDK abortController tetiklenir, iş failed + "iptal edildi (Muzaffer Bey)", AgentEvent hata, error olayı', async () => {
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
    expect(sonuc.hata).toBe('iptal edildi (Muzaffer Bey)');
    expect(sonuc.ogrenilen).toEqual([]);
    expect(runner.calisanIsIdleri()).toEqual([]); // haritadan silindi

    // İş dosyası: running → failed, result.hata dolu, yarım rapor korunur
    const kapanis = prisma.updates.find((u) => u?.data?.status === 'failed');
    expect(kapanis).toBeTruthy();
    expect(kapanis.where).toEqual({ id: 'is-iptal-1' });
    expect(kapanis.data.result.hata).toBe('iptal edildi (Muzaffer Bey)');
    expect(kapanis.data.result.rapor).toContain('parça0');
    expect(prisma.updates.some((u) => u?.data?.status === 'done')).toBe(false);

    // AgentEvent
    expect(prisma.olaylar).toHaveLength(1);
    expect(prisma.olaylar[0]).toMatchObject({ agent: 'ekip', action: 'analist', status: 'hata', message: 'iptal edildi (Muzaffer Bey)' });
    expect(prisma.olaylar[0].meta).toMatchObject({ isId: 'is-iptal-1', iptal: 'sahip' });

    // Akış: done YOK, error VAR
    expect(akis.some((e) => e.type === 'done')).toBe(false);
    const hataOlayi = akis.find((e) => e.type === 'error');
    expect(hataOlayi).toMatchObject({ type: 'error', error: 'iptal edildi (Muzaffer Bey)', isId: 'is-iptal-1' });

    // Bitmiş iş artık durdurulamaz
    expect(runner.iptalEt('t1', 'is-iptal-1').ok).toBe(false);
  });

  it('dış AbortSignal (runner alanı; controller artık vermez) → aynı yol, hata "iptal edildi (bağlantı koptu)"', async () => {
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

  it('portal aracı ctx.signal alır (luca_is_bekle / kdv_kontrol_ocr_bekle sunucu beklemesi Durdur ile kesilsin); zincir aracı "Çalıştırıcı bulunamadı" demez (doğrulayıcı 2026-09-13)', async () => {
    const prisma = sahtePrisma();
    const gorulenCtx: any[] = [];
    const tools = { execute: async (_name: string, _args: any, ctx: any) => { gorulenCtx.push(ctx); return { ok: true, status: 'pending' }; } };
    let isleyici: any = null;
    const sdk: any = {
      tool: (_ad: string, _acik: string, _sema: any, h: any) => { isleyici = h; return {}; },
      createSdkMcpServer: () => ({}),
      query: ({ options }: any) => {
        async function* uret() {
          const r = await isleyici({ name: 'luca_is_bekle', args: { jobId: 'j1', maxSaniye: 1 } });
          const govde = JSON.parse(r.content[0].text);
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(govde) } } };
          // Durdur: sinyal araca ulaşmış olmalı
          options.abortController.abort();
          yield { type: 'result', is_error: false, total_cost_usd: 0 };
        }
        return uret();
      },
    };
    const runner = new EkipRunnerService(prisma as any, tools as any, {} as any, { getRulesForUi: async () => [] } as any, {} as any);
    (runner as any).sdkYukle = async () => sdk;
    (runner as any).sistemPromptu = async () => 'sistem';
    await runner.calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'portal', dryRun: true });
    expect(gorulenCtx.length).toBe(1);
    expect(gorulenCtx[0].signal).toBeInstanceOf(AbortSignal);
    expect(gorulenCtx[0].signal.aborted).toBe(true); // abort sonrası aynı sinyal
  });

  it('bilinmeyen iş → {ok:false, error}', () => {
    const runner = runnerKur(sahtePrisma(), sahteSdk().sdk);
    const r = runner.iptalEt('t1', 'yok');
    expect(r.ok).toBe(false);
    expect(r.isId).toBe('yok');
    expect(typeof r.error).toBe('string');
  });
});

/** Sahte SSE yanıtı: EventEmitter + write/end; 'close' dışarıdan tetiklenir. */
function sahteRes() {
  const res: any = new EventEmitter();
  res.yazilan = [] as string[];
  res.writableEnded = false;
  res.setHeader = () => undefined;
  res.flushHeaders = () => undefined;
  res.write = (s: string) => {
    res.yazilan.push(s);
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
  };
  return res;
}

describe('POST /ekip/:ajanId/calistir — SSE kopması koşuyu İPTAL ETMEZ (PLAN/17 Faz C, 2026-09-13)', () => {
  it("res 'close' gelince yalnız log; runner.calistir'e signal verilmez, iptalEt çağrılmaz, koşu sonuna kadar sürer", async () => {
    let verilen: any = null;
    let iptalSayisi = 0;
    let bitir!: () => void;
    const runner: any = {
      calistir: async (p: any) => {
        verilen = p;
        p.emit({ type: 'baslangic', isId: 'is-arka-1', ajanId: p.ajanId, model: 'm', dryRun: true });
        await new Promise<void>((r) => (bitir = r));
        p.emit({ type: 'done', isId: 'is-arka-1', model: 'm', toolUses: [], durationMs: 1, kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [] });
        return { isId: 'is-arka-1' };
      },
      iptalEt: () => {
        iptalSayisi++;
        return { ok: true, isId: 'x' };
      },
    };
    const controller = new EkipController(runner, {} as any, {} as any, {} as any);
    const loglar: string[] = [];
    (controller as any).logger = { log: (m: string) => loglar.push(m), warn: (m: string) => loglar.push(m) };
    const res = sahteRes();
    const req = { user: { tenantId: 't1', sub: 'u1' } };

    const kosu = controller.calistir(req, 'beyanname', { gorev: 'KDV kontrolü yap' }, res);
    await bekle(10);
    expect(verilen).toBeTruthy();
    expect(verilen.signal).toBeUndefined(); // bağlantı sinyali artık yok
    expect(verilen.kaynak).toBe('portal');

    // İstemci koptu (sekme kapandı): yanıt bitmeden close
    res.emit('close');
    await bekle(10);
    expect(iptalSayisi).toBe(0);
    expect(loglar.some((m) => /bağlantısı koptu; koşu arka planda sürüyor \(iş is-arka-1\)/.test(m))).toBe(true);

    // Koşu kopmadan sonra da bitiyor; controller hata vermeden kapanıyor
    bitir();
    await kosu;
    expect(res.writableEnded).toBe(true);
    expect(res.yazilan.some((s: string) => s.includes('"type":"done"'))).toBe(true);
  });

  it('sahip "Durdur" → POST /ekip/isler/:id/iptal runner.iptalEt(tenant, id, "sahip")', () => {
    const cagrilar: any[] = [];
    const runner: any = { iptalEt: (...a: any[]) => (cagrilar.push(a), { ok: true, isId: a[1] }) };
    const controller = new EkipController(runner, {} as any, {} as any, {} as any);
    expect(controller.iptal({ user: { tenantId: 't1' } }, 'is-9')).toEqual({ ok: true, isId: 'is-9' });
    expect(cagrilar).toEqual([['t1', 'is-9', 'sahip']]);
  });
});
