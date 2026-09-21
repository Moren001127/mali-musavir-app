/**
 * KOTA BEKÇİSİ (PLAN/20 §D): mesaj çözümleme (resets … biçimleri), doldu/sıfırlanma, kendiliğinden temizlenme,
 * runner'ın hata yolunda işaretleme, koordinatör cron kapısı. Ağ/DB yok.
 */
import { EkipKotaService, KOTA_KALIBI, KOTA_VARSAYILAN_BEKLEME_MS, istanbulParcalari, istanbulTarihi, sifirlanmaZamaniCoz } from './ekip-kota.service';
import { KoordinatorService } from './koordinator.service';

const IST = (yil: number, ay: number, gun: number, saat: number, dk = 0) => istanbulTarihi(yil, ay, gun, saat, dk);

describe('ekip kota — sıfırlanma zamanı çözümleme', () => {
  // Pazartesi 21 Eylül 2026, 10:15 Istanbul
  const simdi = IST(2026, 9, 21, 10, 15);

  it('istanbulParcalari sabit UTC+3 ile gün/saat/hafta günü verir (1=Pazartesi, 7=Pazar)', () => {
    expect(istanbulParcalari(simdi)).toEqual({ yil: 2026, ay: 9, gun: 21, saat: 10, dakika: 15, haftaGunu: 1 });
    expect(istanbulParcalari(IST(2026, 9, 20, 23, 59)).haftaGunu).toBe(7);
    expect(istanbulTarihi(2026, 9, 21, 9, 0).toISOString()).toBe('2026-09-21T06:00:00.000Z');
  });

  it('"resets Sep 21, 9am (Europe/Istanbul)" → o gün 09:00 Istanbul', () => {
    const t = sifirlanmaZamaniCoz("You've hit your weekly limit · resets Sep 21, 9am (Europe/Istanbul)", IST(2026, 9, 20, 22, 0));
    expect(t?.toISOString()).toBe(IST(2026, 9, 21, 9, 0).toISOString());
  });

  it('"resets 9am": saat geçmişse yarın, geçmemişse bugün', () => {
    expect(sifirlanmaZamaniCoz('usage limit reached, resets 9am', simdi)?.toISOString()).toBe(IST(2026, 9, 22, 9, 0).toISOString());
    expect(sifirlanmaZamaniCoz('resets 3pm', simdi)?.toISOString()).toBe(IST(2026, 9, 21, 15, 0).toISOString());
    expect(sifirlanmaZamaniCoz('resets at 14:30', simdi)?.toISOString()).toBe(IST(2026, 9, 21, 14, 30).toISOString());
    expect(sifirlanmaZamaniCoz('resets tomorrow 9am', IST(2026, 9, 21, 6, 0))?.toISOString()).toBe(IST(2026, 9, 22, 9, 0).toISOString());
  });

  it('"resets in 2 hours" / "resets in 45 minutes" → göreli', () => {
    expect(sifirlanmaZamaniCoz('rate limit — resets in 2 hours', simdi)?.getTime()).toBe(simdi.getTime() + 2 * 3600 * 1000);
    expect(sifirlanmaZamaniCoz('rate limit — resets in 45 minutes', simdi)?.getTime()).toBe(simdi.getTime() + 45 * 60 * 1000);
  });

  it('Aralık sonunda "resets Jan 2, 9am" gelecek yıla düşer; 12am/12pm doğru', () => {
    expect(sifirlanmaZamaniCoz('resets Jan 2, 9am', IST(2026, 12, 30, 12, 0))?.toISOString()).toBe(IST(2027, 1, 2, 9, 0).toISOString());
    expect(sifirlanmaZamaniCoz('resets 12am', IST(2026, 9, 21, 6, 0))?.toISOString()).toBe(IST(2026, 9, 22, 0, 0).toISOString());
    expect(sifirlanmaZamaniCoz('resets 12pm', IST(2026, 9, 21, 6, 0))?.toISOString()).toBe(IST(2026, 9, 21, 12, 0).toISOString());
  });

  it('çözülemeyen mesaj → null', () => {
    expect(sifirlanmaZamaniCoz('weekly limit reached', simdi)).toBeNull();
    expect(sifirlanmaZamaniCoz('', simdi)).toBeNull();
    expect(sifirlanmaZamaniCoz('resets 27:00', simdi)).toBeNull();
  });

  it('KOTA_KALIBI: limit mesajları eşleşir, sıradan hatalar eşleşmez', () => {
    for (const m of ["You've hit your usage limit", 'weekly limit reached', 'Rate limit exceeded', 'rate_limit: too many', 'Max kotası doldu', 'hit your 5-hour limit']) {
      expect(KOTA_KALIBI.test(m)).toBe(true);
    }
    for (const m of ['iptal edildi (Muzaffer Bey)', 'Agent SDK (Max) sonucu hata döndü.', 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).', 'Sunucu yeniden başlıyor']) {
      expect(KOTA_KALIBI.test(m)).toBe(false);
    }
  });
});

describe('ekip kota — servis durumu', () => {
  const simdi = IST(2026, 9, 21, 10, 15);
  const kur = () => {
    const s = new EkipKotaService();
    (s as any).logger = { warn: () => undefined, log: () => undefined };
    return s;
  };

  it('başlangıçta açık; kota dışı hata işaretlemez', () => {
    const s = kur();
    expect(s.acikMi(simdi)).toBe(true);
    expect(s.hatadanIsaretle('iptal edildi (Muzaffer Bey)', simdi)).toBe(false);
    expect(s.durum(simdi)).toEqual({ doldu: false, sifirlanma: null, kesin: false, sonHata: null, isaretlendi: null });
  });

  it('kota mesajı → doldu, sıfırlanma mesajdan; sıfırlanma geçince kendiliğinden temizlenir', () => {
    const s = kur();
    expect(s.hatadanIsaretle("You've hit your weekly limit · resets Sep 21, 9pm (Europe/Istanbul)", simdi)).toBe(true);
    const d = s.durum(simdi);
    expect(d.doldu).toBe(true);
    expect(d.sifirlanma?.toISOString()).toBe(IST(2026, 9, 21, 21, 0).toISOString());
    expect(d.sonHata).toContain('weekly limit');
    expect(d.isaretlendi).toEqual(simdi);
    expect(s.acikMi(IST(2026, 9, 21, 20, 59))).toBe(false);
    expect(s.acikMi(IST(2026, 9, 21, 21, 0))).toBe(true); // geçti → temizlendi
    expect(s.durum(IST(2026, 9, 21, 21, 1))).toEqual({ doldu: false, sifirlanma: null, kesin: false, sonHata: null, isaretlendi: null });
  });

  it('sıfırlanma çözülemezse +6 saat', () => {
    const s = kur();
    s.hatadanIsaretle('usage limit reached', simdi);
    expect(s.durum(simdi).sifirlanma?.getTime()).toBe(simdi.getTime() + KOTA_VARSAYILAN_BEKLEME_MS);
  });

  it('daha geç bilinen sıfırlanma korunur (haftalık > 5 saatlik); yapısal isaretle resetsAt alır', () => {
    const s = kur();
    s.isaretle({ sifirlanma: IST(2026, 9, 23, 9, 0), mesaj: 'seven_day', simdi });
    s.hatadanIsaretle('rate limit, resets 3pm', simdi);
    expect(s.durum(simdi).sifirlanma?.toISOString()).toBe(IST(2026, 9, 23, 9, 0).toISOString());
    expect(s.durum(simdi).sonHata).toBe('rate limit, resets 3pm');
    // geçmiş sıfırlanma verilirse +6 saat (tahmin); sonra gelen KESİN zaman tahmini ezer (daha erken olsa da)
    const s2 = kur();
    s2.isaretle({ sifirlanma: IST(2026, 9, 20, 9, 0), mesaj: 'x', simdi });
    expect(s2.durum(simdi)).toMatchObject({ kesin: false, sifirlanma: new Date(simdi.getTime() + KOTA_VARSAYILAN_BEKLEME_MS) });
    s2.hatadanIsaretle('usage limit, resets 1pm', simdi);
    expect(s2.durum(simdi)).toMatchObject({ kesin: true, sifirlanma: IST(2026, 9, 21, 13, 0) });
    // kesin varken tahmin (çözülemeyen mesaj) kesini bozmaz
    s2.hatadanIsaretle('weekly limit reached', simdi);
    expect(s2.durum(simdi)).toMatchObject({ kesin: true, sifirlanma: IST(2026, 9, 21, 13, 0), sonHata: 'weekly limit reached' });
    // ISO biçimi (runner'ın yapısal olaydan yazdığı) çözülür
    expect(sifirlanmaZamaniCoz('Max kotası doldu (rate limit: seven_day, resets 2026-09-25T06:00:00.000Z)', simdi)?.toISOString()).toBe('2026-09-25T06:00:00.000Z');
    s2.temizle();
    expect(s2.acikMi(simdi)).toBe(true);
  });
});

describe('ekip kota — koordinatör sabah özeti kapısı', () => {
  const eskiEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...eskiEnv };
  });

  function kur(kotaDolu: boolean) {
    const loglar: string[] = [];
    const calistirilan: any[] = [];
    const prisma = { tenant: { findUnique: async (q: any) => ({ id: q.where.id }), findMany: async () => [] } };
    const runner = { calistir: async (p: any) => (calistirilan.push(p), { isId: 'is1', rapor: '', hata: undefined }) };
    const whatsapp = { isAutomationActive: async () => true, sendMessage: async () => true };
    const akis = { ozetSatiri: async () => '' };
    const kota = new EkipKotaService();
    (kota as any).logger = { warn: () => undefined, log: () => undefined };
    if (kotaDolu) kota.hatadanIsaretle('weekly limit reached, resets 9am');
    const k = new KoordinatorService(prisma as any, runner as any, whatsapp as any, akis as any, kota);
    (k as any).logger = { warn: (m: string) => loglar.push(m), log: (m: string) => loglar.push(m), debug: () => undefined, error: () => undefined };
    return { k, loglar, calistirilan };
  }

  it('kota doluysa cron koşmaz, günlüğe yazar; açıksa koşar', async () => {
    process.env.EKIP_SABAH_OZETI = 'on';
    process.env.MOREN_OWNER_TENANT_ID = 't1';
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '05350587475';
    const dolu = kur(true);
    await dolu.k.sabahCron();
    expect(dolu.calistirilan).toEqual([]);
    expect(dolu.loglar.some((m) => /Max kotası dolu; sabah özeti atlandı/.test(m))).toBe(true);

    const acik = kur(false);
    await acik.k.sabahCron();
    expect(acik.calistirilan).toHaveLength(1);
  });
});

// ─── Runner: koşu hatası / SDK rate_limit_event → kota bekçisi işaretlenir; payload.kuyrukId + kaynak 'rutin' yazılır ───
import { EkipRunnerService } from './ekip-runner.service';

function sahtePrisma() {
  const creates: any[] = [];
  const updates: any[] = [];
  return {
    creates,
    updates,
    agentCommand: {
      create: async (arg: any) => (creates.push(arg?.data), { id: 'is-kota-1' }),
      update: async (arg: any) => (updates.push(arg), { id: arg?.where?.id }),
      findUnique: async () => ({ payload: {} }),
    },
    agentEvent: { create: async () => ({}) },
    aiMemory: { create: async () => ({}) },
    aiUsageLog: { create: async () => ({}) },
  };
}

function runnerKur(prisma: any, sdk: any, kota: EkipKotaService): EkipRunnerService {
  const operator = { getRulesForUi: async () => [] };
  const r = new EkipRunnerService(prisma, {} as any, {} as any, operator as any, {} as any, kota);
  (r as any).sdkYukle = async () => sdk;
  (r as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  return r;
}

const sdkKur = (uret: () => AsyncGenerator<any>) => ({ tool: () => ({}), createSdkMcpServer: () => ({}), query: () => uret() });

describe('ekip kota — runner bağı', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  it('SDK rate_limit_event (rejected, resetsAt epoch sn) → iş failed, hata "Max kotası doldu", bekçi sıfırlanmayı yapısal alır; payload.kuyrukId + kaynak rutin', async () => {
    const prisma = sahtePrisma();
    const kota = new EkipKotaService();
    (kota as any).logger = { warn: () => undefined, log: () => undefined };
    const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600;
    const sdk = sdkKur(async function* () {
      yield { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'seven_day' } };
      yield { type: 'result', is_error: true, errors: [], total_cost_usd: 0 };
    });
    const runner = runnerKur(prisma, sdk, kota);
    const akis: any[] = [];
    const sonuc = await runner.calistir({ ajanId: 'beyanname', gorev: 'A için KDV', tenantId: 't1', kaynak: 'rutin', kuyrukId: 'k1', taxpayerId: null, dryRun: false, emit: (e) => akis.push(e) });
    expect(sonuc.hata).toMatch(/Max kotası doldu \(rate limit: seven_day/);
    expect(akis.find((e) => e.type === 'error')?.error).toBe(sonuc.hata);
    expect(prisma.updates.find((u) => u?.data?.status === 'failed')).toBeTruthy();
    expect(prisma.creates[0]).toMatchObject({ agent: 'ekip:beyanname', payload: { kaynak: 'rutin', kuyrukId: 'k1', dryRun: false } });
    const d = kota.durum();
    expect(d.doldu).toBe(true);
    expect(d.sifirlanma?.getTime()).toBe(resetsAt * 1000);
    expect(kota.acikMi()).toBe(false);
  });

  it('SDK çağrısı "usage limit … resets 9am" ile fırlatırsa hata yolunda hatadanIsaretle çalışır; sıradan hata işaretlemez', async () => {
    const kota = new EkipKotaService();
    (kota as any).logger = { warn: () => undefined, log: () => undefined };
    const sdk = sdkKur(async function* () {
      throw new Error("You've hit your usage limit · resets 9am (Europe/Istanbul)");
    });
    const sonuc = await runnerKur(sahtePrisma(), sdk, kota).calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'toplu' });
    expect(sonuc.hata).toContain('usage limit');
    expect(kota.durum().doldu).toBe(true);
    expect(kota.durum().sonHata).toContain('usage limit');

    const kota2 = new EkipKotaService();
    (kota2 as any).logger = { warn: () => undefined, log: () => undefined };
    const sdk2 = sdkKur(async function* () {
      throw new Error('ECONNRESET');
    });
    const sonuc2 = await runnerKur(sahtePrisma(), sdk2, kota2).calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'portal' });
    expect(sonuc2.hata).toBe('ECONNRESET');
    expect(kota2.durum().doldu).toBe(false);
  });

  it('assistant mesajı error:"rate_limit" + result is_error → hata metni SDK mesajından, bekçi işaretli; kota bekçisi verilmeyen (eski) kurulumda koşu çökmez', async () => {
    const kota = new EkipKotaService();
    (kota as any).logger = { warn: () => undefined, log: () => undefined };
    const sdk = sdkKur(async function* () {
      yield { type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 25, 9am (Europe/Istanbul)" }] } };
      yield { type: 'result', is_error: true, errors: ['rate limit'], total_cost_usd: 0 };
    });
    const sonuc = await runnerKur(sahtePrisma(), sdk, kota).calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'rutin' });
    expect(sonuc.hata).toBe("rate_limit: You've hit your weekly limit · resets Sep 25, 9am (Europe/Istanbul)");
    expect(kota.durum().doldu).toBe(true);
    // rate_limit_event isUsingOverage:true → aşım izinliyken duraklatma yok
    const kota3 = new EkipKotaService();
    (kota3 as any).logger = { warn: () => undefined, log: () => undefined };
    const sdk3 = sdkKur(async function* () {
      yield { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', isUsingOverage: true } };
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'RAPOR: tamam' } } };
      yield { type: 'result', is_error: false, total_cost_usd: 0.01 };
    });
    const sonuc3 = await runnerKur(sahtePrisma(), sdk3, kota3).calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'portal' });
    expect(sonuc3.hata).toBeUndefined();
    expect(kota3.durum().doldu).toBe(false);
    // kota bekçisi yok (eski spec kurulumu): hata yolu yine çalışır
    const r = new EkipRunnerService(sahtePrisma() as any, {} as any, {} as any, { getRulesForUi: async () => [] } as any, {} as any);
    (r as any).sdkYukle = async () => sdkKur(async function* () {
      throw new Error('weekly limit');
    });
    (r as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
    expect((await r.calistir({ ajanId: 'beyanname', gorev: 'x', tenantId: 't1', kaynak: 'portal' })).hata).toBe('weekly limit');
  });
});
