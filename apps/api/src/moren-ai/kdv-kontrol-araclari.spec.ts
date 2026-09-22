/**
 * PLAN/17 §3 — Ekip iş zinciri araçları (2026-09-13).
 *  - kdv_kontrol_* zinciri, luca_is_bekle, mali_yorum_oku, mali_donemler_listele, ekip_ajan_baslat / ekip_is_durum
 *  - get_taxpayer / list_taxpayers defterTuru; get_taxpayer_work_status periodLabel + çeyrek mizan; get_gelir_tablosu kilitli tercih
 * Kilitli servisler (KDV Kontrol, Mizan/GT, Luca) ve runner jest.mock ile sahte; moduleRef sınıf ADIYLA sahteyi döner.
 * Prisma: Proxy tabanlı sahte — tanımlanmayan model/metot güvenli boş değer döner (findMany [] · findFirst null · count 0).
 */
jest.mock('../kdv-control/kdv-control.service', () => ({ KdvControlService: class KdvControlService {} }));
jest.mock('../luca/luca.service', () => ({ LucaService: class LucaService {} }));
jest.mock('../mali-yorum/mali-yorum.service', () => ({ MaliYorumService: class MaliYorumService {} }));
jest.mock('../mizan/gelir-tablosu.service', () => ({ GelirTablosuService: class GelirTablosuService {} }));
jest.mock('../ekip/ekip-runner.service', () => ({ EkipRunnerService: class EkipRunnerService {} }));

import { BadRequestException } from '@nestjs/common';
import { ToolExecutorService } from './tool-executor.service';
import { EKIP_IS_ZINCIRI_ARACLARI, EKIP_IS_ZINCIRI_ARAC_ADLARI, MOREN_AI_TOOLS } from './tools';

type Cagri = { model: string; metot: string; args: any };

/** Proxy Prisma: prisma.<model>.<metot>(args) → kayıt + override ya da varsayılan. */
function prismaKur(overrides: Record<string, Record<string, (args: any) => any>> = {}) {
  const cagrilar: Cagri[] = [];
  const varsayilan = (metot: string) => (metot === 'findMany' ? [] : metot === 'count' ? 0 : null);
  const prisma: any = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, metot: string) => async (args: any) => {
              cagrilar.push({ model, metot, args });
              const ov = overrides[model]?.[metot];
              return ov ? ov(args) : varsayilan(metot);
            },
          },
        ),
    },
  );
  return { prisma, cagrilar };
}

function aracKur(opts: { prisma?: any; servisler?: Record<string, any> } = {}) {
  const servisler = opts.servisler || {};
  const moduleRef = { get: (cls: any) => servisler[cls?.name] ?? null };
  const tool = new ToolExecutorService(opts.prisma ?? prismaKur().prisma, moduleRef as any);
  // Bekleme döngüleri gerçek uyumasın (spec hızlı kalsın).
  const bekle = jest.spyOn(tool as any, 'bekle').mockResolvedValue(undefined);
  return { tool, bekle };
}

const ctx = { tenantId: 't1', userId: 'u1', taxpayerId: null };
const TAXPAYER = 'cmnydmgbx000heazyp9i4fq23';

describe('araç şemaları', () => {
  it('zincir araç adları sabit; MOREN_AI_TOOLS dışında (genel bot/otomasyon görmez); mali_* genel listede', () => {
    expect(EKIP_IS_ZINCIRI_ARAC_ADLARI).toEqual([
      'kdv_kontrol_oturum_bul_olustur',
      'kdv_kontrol_luca_cek',
      'luca_is_bekle',
      'kdv_kontrol_fatura_bagla',
      'kdv_kontrol_ocr_baslat',
      'kdv_kontrol_ocr_bekle',
      'kdv_kontrol_eslestir',
      'kdv_kontrol_sonuc_satirlari',
      // OCR teyit (R1 7b/9b, 2026-09-22)
      'kdv_kontrol_belge_yeniden_oku',
      'kdv_kontrol_ocr_teyit',
      // Boş dönem kilidi (2026-09-22)
      'kdv_kontrol_bos_oturum_kilitle',
      // Fatura çekimi zinciri (R5, 2026-09-15)
      'fm_cekim_baslat',
      'fm_cekim_durum',
      'fm_cekim_bekle',
      'fm_cekim_aktar',
      'ekip_ajan_baslat',
      'ekip_is_durum',
    ]);
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const t of EKIP_IS_ZINCIRI_ARACLARI) {
      expect(genel.has(t.name)).toBe(false);
      expect(t.input_schema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(40);
    }
    expect(genel.has('mali_yorum_oku')).toBe(true);
    expect(genel.has('mali_donemler_listele')).toBe(true);
  });
});

describe('defterTuru (get_taxpayer / list_taxpayers)', () => {
  it('BILANCO/ISLETME doğrudan; Mihsap DEFTER_BEYAN → ISLETME; boş → null', async () => {
    const satirlar = [
      { id: 'a', type: 'TUZEL_KISI', companyName: 'A', defterTuru: 'BILANCO', mihsapDefterTuru: 'BILANCO', isActive: true },
      { id: 'b', type: 'GERCEK_KISI', firstName: 'B', lastName: 'B', defterTuru: null, mihsapDefterTuru: 'DEFTER_BEYAN', isActive: true },
      { id: 'c', type: 'GERCEK_KISI', firstName: 'C', lastName: 'C', defterTuru: null, mihsapDefterTuru: null, isActive: true },
    ];
    const { prisma, cagrilar } = prismaKur({
      taxpayer: {
        findMany: () => satirlar,
        findFirst: () => ({ ...satirlar[1], contacts: [], monthlyStatuses: [], phones: [] }),
      },
    });
    const { tool } = aracKur({ prisma });
    const liste = await tool.execute('list_taxpayers', {}, ctx);
    expect(liste.taxpayers.map((t: any) => t.defterTuru)).toEqual(['BILANCO', 'ISLETME', null]);
    expect(cagrilar[0].args.select.defterTuru).toBe(true);
    const tek = await tool.execute('get_taxpayer', { taxpayerId: 'b' }, ctx);
    expect(tek.defterTuru).toBe('ISLETME');
    expect(tek.mihsapDefterTuru).toBe('DEFTER_BEYAN');
  });
});

describe('kdv_kontrol_oturum_bul_olustur', () => {
  const mukellef = (defterTuru: string | null, mihsap: string | null = null) => ({
    taxpayer: { findFirst: () => ({ id: TAXPAYER, companyName: 'ERDOĞAN BALÇIK', defterTuru, mihsapDefterTuru: mihsap }) },
  });

  it('ISLETME + type yok → GIDER + GELIR iki oturum; yeni oturumda _count yok → ayrı sayım; 2026-08 → 2026/08', async () => {
    const cagrilar: any[] = [];
    const svc = {
      findOrCreateSession: async (tenantId: string, userId: string, dto: any) => {
        cagrilar.push({ tenantId, userId, dto });
        return dto.type === 'ISLETME_GIDER'
          ? { session: { id: 's-gider', type: dto.type, status: 'DRAFT', _count: { kdvRecords: 12, images: 7 } }, created: false }
          : { session: { id: 's-gelir', type: dto.type, status: 'DRAFT' }, created: true };
      },
    };
    const { prisma } = prismaKur({ ...mukellef('ISLETME'), kdvRecord: { count: () => 0 }, receiptImage: { count: () => 10 } });
    const { tool } = aracKur({ prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_oturum_bul_olustur', { taxpayerId: TAXPAYER, periodLabel: '2026-08' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.periodLabel).toBe('2026/08');
    expect(r.defterTuru).toBe('ISLETME');
    expect(cagrilar.map((c) => c.dto.type)).toEqual(['ISLETME_GIDER', 'ISLETME_GELIR']);
    expect(cagrilar[0]).toEqual({ tenantId: 't1', userId: 'u1', dto: { type: 'ISLETME_GIDER', periodLabel: '2026/08', taxpayerId: TAXPAYER } });
    expect(r.oturumlar).toEqual([
      { sessionId: 's-gider', type: 'ISLETME_GIDER', status: 'DRAFT', yeni: false, lucaKayitSayisi: 12, faturaSayisi: 7, kilitli: false },
      { sessionId: 's-gelir', type: 'ISLETME_GELIR', status: 'DRAFT', yeni: true, lucaKayitSayisi: 0, faturaSayisi: 10, kilitli: false },
    ]);
    expect(r.uyari).toBeUndefined();
  });

  it('BILANCO → KDV_191 + KDV_391; COMPLETED oturum kilitli:true + uyarı', async () => {
    const svc = {
      findOrCreateSession: async (_t: string, _u: string, dto: any) => ({
        session: { id: `s-${dto.type}`, type: dto.type, status: dto.type === 'KDV_391' ? 'COMPLETED' : 'REVIEWING', _count: { kdvRecords: 1, images: 1 } },
        created: false,
      }),
    };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(null, 'BILANCO')).prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_oturum_bul_olustur', { taxpayerId: TAXPAYER, periodLabel: '2026/07' }, ctx);
    expect(r.oturumlar.map((o: any) => [o.type, o.kilitli])).toEqual([
      ['KDV_191', false],
      ['KDV_391', true],
    ]);
    expect(r.uyari).toMatch(/KDV_391 \(s-KDV_391\) KİLİTLİ/);
  });

  it('defter türü boş ve type yok → DUR (servis çağrılmaz); type verilirse tek oturum', async () => {
    const cagrilar: any[] = [];
    const svc = { findOrCreateSession: async (_t: string, _u: string, dto: any) => (cagrilar.push(dto), { session: { id: 'x', type: dto.type, status: 'DRAFT', _count: { kdvRecords: 0, images: 0 } }, created: true }) };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(null)).prisma, servisler: { KdvControlService: svc } });
    const dur = await tool.execute('kdv_kontrol_oturum_bul_olustur', { taxpayerId: TAXPAYER, periodLabel: '2026/08' }, ctx);
    expect(dur.ok).toBe(false);
    expect(dur.error).toMatch(/defter türü tanımsız/);
    expect(cagrilar).toHaveLength(0);
    const tek = await tool.execute('kdv_kontrol_oturum_bul_olustur', { taxpayerId: TAXPAYER, periodLabel: '2026/08', type: 'KDV_191' }, ctx);
    expect(tek.ok).toBe(true);
    expect(cagrilar.map((d) => d.type)).toEqual(['KDV_191']);
  });

  it('ctx.userId boşsa createdBy = tenant sahibi (MOREN_OWNER_EMAIL ile users tablosundan)', async () => {
    process.env.MOREN_OWNER_EMAIL = 'muzaffer@morenmusavirlik.com';
    const kullanilan: string[] = [];
    const svc = { findOrCreateSession: async (_t: string, u: string, dto: any) => (kullanilan.push(u), { session: { id: 'x', type: dto.type, status: 'DRAFT', _count: { kdvRecords: 0, images: 0 } }, created: true }) };
    const { prisma, cagrilar } = prismaKur({ ...mukellef('ISLETME'), user: { findFirst: (a: any) => (a?.where?.email ? { id: 'sahip-id' } : null) } });
    const { tool } = aracKur({ prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_oturum_bul_olustur', { taxpayerId: TAXPAYER, periodLabel: '2026/08' }, { tenantId: 't1', userId: null });
    expect(r.ok).toBe(true);
    expect(kullanilan).toEqual(['sahip-id', 'sahip-id']);
    const userSorgu = cagrilar.find((c) => c.model === 'user');
    expect(userSorgu?.args.where.email.equals).toBe('muzaffer@morenmusavirlik.com');
    delete process.env.MOREN_OWNER_EMAIL;
  });
});

describe('kdv_kontrol_luca_cek', () => {
  it('Luca ajanı çevrimdışı → iş AÇILMAZ (queueLucaImport çağrılmaz)', async () => {
    const svc = { queueLucaImport: jest.fn() };
    const { tool } = aracKur({ prisma: prismaKur({ agentStatus: { findMany: () => [] } }).prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_luca_cek', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.neden).toMatch(/Luca ajanı bağlı değil/);
    expect(svc.queueLucaImport).not.toHaveBeenCalled();
  });

  it('yalnız DEV-* (Chrome uzantısı) çevrimiçiyse atamasız iş açılmaz; yerel işçi varsa açılır; mevcut iş → mevcutIs:true', async () => {
    const svc = { queueLucaImport: jest.fn(async () => ({ jobId: 'job-eski', status: 'queued', message: 'kuyruk' })) };
    let cihazlar: any[] = [{ deviceId: 'DEV-abc', lastPing: new Date() }];
    const { prisma } = prismaKur({
      agentStatus: { findMany: () => cihazlar },
      lucaFetchJob: { findFirst: () => ({ id: 'job-eski', status: 'running' }) },
    });
    const { tool } = aracKur({ prisma, servisler: { KdvControlService: svc } });
    expect((await tool.execute('kdv_kontrol_luca_cek', { sessionId: 's1' }, ctx)).ok).toBe(false);
    cihazlar = [{ deviceId: 'DEV-abc', lastPing: new Date() }, { deviceId: 'moren-5255e7bb', lastPing: new Date() }];
    const r = await tool.execute('kdv_kontrol_luca_cek', { sessionId: 's1' }, ctx);
    expect(r).toMatchObject({ ok: true, jobId: 'job-eski', mevcutIs: true, status: 'running', hedefCihaz: 'moren-5255e7bb' });
    expect(svc.queueLucaImport).toHaveBeenCalledWith('s1', 't1', 'u1', undefined);
  });

  it('kilitli oturumda 400 → neden metni, adım 2 yönlendirmesi', async () => {
    const svc = { queueLucaImport: async () => { throw new BadRequestException('Bu KDV kontrolü kilitli. Müdahale etmek için önce kilidi açın.'); } };
    const { prisma } = prismaKur({ agentStatus: { findMany: () => [{ deviceId: 'moren-1', lastPing: new Date() }] } });
    const { tool } = aracKur({ prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_luca_cek', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.neden).toMatch(/Oturum kilitli/);
  });
});

describe('luca_is_bekle', () => {
  it('pending → done: 5 sn döngü, bitti:true, recordCount', async () => {
    let n = 0;
    const { prisma } = prismaKur({
      lucaFetchJob: { findFirst: () => (++n < 3 ? { id: 'j1', status: 'pending', recordCount: 0, retryCount: 0 } : { id: 'j1', status: 'done', recordCount: 41, retryCount: 0, finishedAt: new Date('2026-09-13T10:00:00Z') }) },
    });
    const { tool, bekle } = aracKur({ prisma, servisler: { LucaService: { getActiveCaptchaChallenge: async () => null } } });
    const r = await tool.execute('luca_is_bekle', { jobId: 'j1', maxSaniye: 60 }, ctx);
    expect(r).toMatchObject({ ok: true, status: 'done', recordCount: 41, bitti: true, kontrolSayisi: 3, captcha: { challengeId: null } });
    expect(bekle).toHaveBeenCalledTimes(2);
    expect(r.yorum).toMatch(/41 satır/);
  });

  it('failed → errorMsg son satırı, tekrar yok; captcha bekleyen pending → challengeId; maxSaniye tavanı 60', async () => {
    const { prisma } = prismaKur({ lucaFetchJob: { findFirst: () => ({ id: 'j2', status: 'failed', errorMsg: 'satır 1\nLuca giriş hatası: oturum düştü', retryCount: 3 }) } });
    const { tool } = aracKur({ prisma });
    const r = await tool.execute('luca_is_bekle', { jobId: 'j2', maxSaniye: 500 }, ctx);
    expect(r).toMatchObject({ status: 'failed', bitti: true, errorMsgSonSatir: 'Luca giriş hatası: oturum düştü', retryCount: 3 });
    expect(r.yorum).toMatch(/tekrar deneme YOK/);

    const { prisma: p2 } = prismaKur({ lucaFetchJob: { findFirst: () => ({ id: 'j3', status: 'running', retryCount: 0 }) } });
    const { tool: t2 } = aracKur({ prisma: p2, servisler: { LucaService: { getActiveCaptchaChallenge: async () => ({ id: 'cap-1' }) } } });
    const r2 = await t2.execute('luca_is_bekle', { jobId: 'j3', maxSaniye: 5 }, ctx);
    expect(r2).toMatchObject({ status: 'running', bitti: false, captcha: { challengeId: 'cap-1' } });
    expect(r2.yorum).toMatch(/güvenlik kodu/);
  });

  it('iptal sinyali gelince döngü kesilir', async () => {
    const ac = new AbortController();
    ac.abort();
    const { prisma } = prismaKur({ lucaFetchJob: { findFirst: () => ({ id: 'j4', status: 'pending', retryCount: 0 }) } });
    const { tool, bekle } = aracKur({ prisma });
    const r = await tool.execute('luca_is_bekle', { jobId: 'j4', maxSaniye: 60 }, { ...ctx, signal: ac.signal });
    expect(r.bitti).toBe(false);
    expect(bekle).not.toHaveBeenCalled();
    expect(r.yorum).toMatch(/iptal/);
  });
});

describe('kdv_kontrol_fatura_bagla / ocr_baslat', () => {
  it('bağlama: linked/alreadyLinked/toplam; 400 "Mihsap\'tan çekilmiş faturası yok" → HAZIR DEĞİL', async () => {
    const svc = {
      linkMihsapInvoices: jest
        .fn()
        .mockResolvedValueOnce({ linked: 7, total: 17, alreadyLinked: 10 })
        .mockRejectedValueOnce(new BadRequestException("Bu mükellefin 2026-08 döneminde (ALIS) Mihsap'tan çekilmiş faturası yok. Önce Mihsap'tan faturaları çekin.")),
    };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    expect(await tool.execute('kdv_kontrol_fatura_bagla', { sessionId: 's1' }, ctx)).toMatchObject({ ok: true, linked: 7, alreadyLinked: 10, toplam: 17 });
    const yok = await tool.execute('kdv_kontrol_fatura_bagla', { sessionId: 's1' }, ctx);
    expect(yok).toMatchObject({ ok: false, neden: 'HAZIR DEĞİL: faturalar portala inmemiş (Mihsap çekimi Muzaffer Bey’de)' });
  });

  it('OCR başlat: forceFresh gönderilmez; {queued,total,cacheHits}', async () => {
    const svc = { startOcrForSession: jest.fn(async () => ({ queued: 5, total: 7, cacheHits: 2, message: '5 yeni OCR · 2 fatura önceden OCR edilmişti, atlandı' })) };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_ocr_baslat', { sessionId: 's1' }, ctx);
    expect(r).toMatchObject({ ok: true, queued: 5, total: 7, cacheHits: 2 });
    expect(svc.startOcrForSession).toHaveBeenCalledWith('s1', 't1', {});
  });
});

describe('kdv_kontrol_ocr_bekle', () => {
  it('ocrStatus sayımı; pending/processing sıfırlanınca bitti:true; needsOcrConfirm = review+low+failed', async () => {
    let tur = 0;
    const gorseller = (bekleyen: number) => [
      ...Array.from({ length: bekleyen }, () => ({ ocrStatus: 'PENDING' })),
      { ocrStatus: 'PROCESSING' },
      { ocrStatus: 'SUCCESS' },
      { ocrStatus: 'SUCCESS' },
      { ocrStatus: 'NEEDS_REVIEW' },
      { ocrStatus: 'LOW_CONFIDENCE' },
      { ocrStatus: 'FAILED' },
    ];
    const svc = {
      getImages: async () => {
        tur++;
        if (tur < 3) return gorseller(2);
        return gorseller(0).map((g) => (g.ocrStatus === 'PROCESSING' ? { ocrStatus: 'SUCCESS' } : g));
      },
    };
    const { tool, bekle } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_ocr_bekle', { sessionId: 's1', maxSaniye: 60 }, ctx);
    expect(r).toMatchObject({ ok: true, pending: 0, processing: 0, success: 3, needsReview: 1, lowConfidence: 1, failed: 1, toplam: 6, needsOcrConfirm: 3, bitti: true, kontrolSayisi: 3 });
    expect(bekle).toHaveBeenCalledTimes(2);
  });

  it('süre tavanı dolunca bitti:false ve "OCR sürüyor" yorumu', async () => {
    const svc = { getImages: async () => [{ ocrStatus: 'PENDING' }, { ocrStatus: 'SUCCESS' }] };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_ocr_bekle', { sessionId: 's1', maxSaniye: 5 }, ctx);
    expect(r).toMatchObject({ pending: 1, bitti: false });
    expect(r.yorum).toMatch(/OCR sürüyor/);
  });
});

describe('kdv_kontrol_eslestir — ön koşul kapısı', () => {
  const kur = (session: any, images: any[], sonStatus = 'REVIEWING') => {
    const svc = {
      findSession: async () => session,
      getImages: async () => images,
      runReconciliation: jest.fn(async () => ({ matched: 5, partial: 1, unmatched: 2, needsReview: 0 })),
      getSessionStats: async () => ({ mismatch: 1, rejected: 0 }),
    };
    const { prisma } = prismaKur({ kdvControlSession: { findFirst: () => ({ status: sonStatus }) } });
    return { svc, tool: aracKur({ prisma, servisler: { KdvControlService: svc } }).tool };
  };

  it('Luca kaydı yok → ok:false, servis ÇAĞRILMAZ', async () => {
    const { svc, tool } = kur({ id: 's1', status: 'DRAFT', _count: { kdvRecords: 0, images: 3 } }, [{ ocrStatus: 'SUCCESS' }]);
    const r = await tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.neden).toMatch(/Luca kaydı yok/);
    expect(svc.runReconciliation).not.toHaveBeenCalled();
  });

  it('görsel yok ya da OCR sürüyor → ok:false, servis ÇAĞRILMAZ; kilitli oturum → çağrılmaz', async () => {
    const a = kur({ id: 's1', status: 'DRAFT', _count: { kdvRecords: 4, images: 0 } }, []);
    expect((await a.tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx)).neden).toMatch(/fatura görseli yok/);
    expect(a.svc.runReconciliation).not.toHaveBeenCalled();
    const b = kur({ id: 's1', status: 'PROCESSING', _count: { kdvRecords: 4, images: 2 } }, [{ ocrStatus: 'PENDING' }, { ocrStatus: 'SUCCESS' }]);
    expect((await b.tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx)).neden).toMatch(/OCR bitmedi \(1 bekliyor/);
    expect(b.svc.runReconciliation).not.toHaveBeenCalled();
    const c = kur({ id: 's1', status: 'COMPLETED', _count: { kdvRecords: 4, images: 2 } }, [{ ocrStatus: 'SUCCESS' }]);
    expect((await c.tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx)).neden).toMatch(/kilitli/);
    expect(c.svc.runReconciliation).not.toHaveBeenCalled();
  });

  it('ön koşul tamam → runReconciliation; REVIEWING → otoKilit:false; COMPLETED → otoKilit:true + açıklama', async () => {
    const a = kur({ id: 's1', status: 'PROCESSING', _count: { kdvRecords: 4, images: 2 } }, [{ ocrStatus: 'SUCCESS' }, { ocrStatus: 'NEEDS_REVIEW' }]);
    const r = await a.tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx);
    expect(a.svc.runReconciliation).toHaveBeenCalledWith('s1', 't1');
    expect(r).toMatchObject({ ok: true, matched: 5, partial: 1, needsReview: 0, unmatched: 2, mismatch: 1, sessionStatus: 'REVIEWING', otoKilit: false });
    const b = kur({ id: 's1', status: 'PROCESSING', _count: { kdvRecords: 4, images: 2 } }, [{ ocrStatus: 'SUCCESS' }], 'COMPLETED');
    const r2 = await b.tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx);
    expect(r2).toMatchObject({ ok: true, sessionStatus: 'COMPLETED', otoKilit: true });
    expect(r2.aciklama).toMatch(/kendiliğinden KİLİTLENDİ/);
  });
});

describe('kdv_kontrol_sonuc_satirlari — sınıflandırma', () => {
  const rec = (belgeNo: string, kdv: string, oran = '20') => ({ belgeNo, belgeDate: new Date('2026-08-05T00:00:00Z'), karsiTaraf: 'X', kdvTutari: kdv, kdvMatrahi: '1000', kdvOrani: oran });
  const img = (belgeNo: string, kdv: string, ek: any = {}) => ({ ocrBelgeNo: belgeNo, ocrDate: '2026-08-05', ocrKdvTutari: kdv, ocrStatus: 'SUCCESS', ...ek });
  const results = [
    { id: 'r1', status: 'MATCHED', kdvRecordId: 'k1', imageId: 'i1', kdvRecord: rec('A1', '200.00'), image: img('A1', '200,00'), mismatchReasons: [] },
    { id: 'r2', status: 'MATCHED', kdvRecordId: 'k2', imageId: 'i2', kdvRecord: rec('A2', '200.00'), image: img('A2', '185,00'), mismatchReasons: [] },
    { id: 'r3', status: 'CONFIRMED', kdvRecordId: 'k3', imageId: 'i3', kdvRecord: rec('A3', '50.00'), image: img('A3', '50,02'), mismatchReasons: [] },
    { id: 'r4', status: 'PARTIAL_MATCH', kdvRecordId: 'k4', imageId: 'i4', kdvRecord: rec('A4', '10.00'), image: img('A4', '10,00'), mismatchReasons: ['tarih farkı'] },
    { id: 'r5', status: 'UNMATCHED', kdvRecordId: 'k5', imageId: null, kdvRecord: rec('A5', '30.00'), image: null, mismatchReasons: [] },
    { id: 'r6', status: 'UNMATCHED', kdvRecordId: null, imageId: 'i6', kdvRecord: null, image: img('F6', '40,00'), mismatchReasons: [] },
    { id: 'r7', status: 'MISMATCH', kdvRecordId: 'k7', imageId: 'i7', kdvRecord: rec('A7', '5.00'), image: img('A7', '9,00'), mismatchReasons: ['KDV farkı'] },
    { id: 'r8', status: 'REJECTED', kdvRecordId: 'k8', imageId: 'i8', kdvRecord: rec('A8', '5.00'), image: img('A8', '5,00'), mismatchReasons: [] },
    // çok oranlı: aynı görsel iki Luca satırı (fan-out) → tam
    { id: 'r9', status: 'MATCHED', kdvRecordId: 'k9', imageId: 'i9', kdvRecord: rec('A9', '20.00', '20'), image: img('A9', '30,00', { ocrKdvBreakdown: [{ oran: 20, tutar: '20,00' }, { oran: 10, tutar: '10,00' }] }), mismatchReasons: [] },
    { id: 'r10', status: 'MATCHED', kdvRecordId: 'k10', imageId: 'i9', kdvRecord: rec('A9', '10.00', '10'), image: img('A9', '30,00', { ocrKdvBreakdown: [{ oran: 20, tutar: '20,00' }, { oran: 10, tutar: '10,00' }] }), mismatchReasons: [] },
  ];
  const stats = {
    needsOcrConfirm: 1,
    seriUyarilari: [],
    matchSummary: { matched: 4, reviewTotal: 2, lucaOnlyMissing: 1, imageOnlyMissing: 1, rejected: 1, mismatch: 1, otherUnmatched: 0, totalResults: 10 },
  };

  it('tam/incele/fatura_yok/luca_yok/red; %1 üstü KDV farkı incele; sayaçlar matchSummary; yalnizSorunlu', async () => {
    const svc = { getResults: async () => results, getSessionStats: async () => stats };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_sonuc_satirlari', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.sayaclar).toEqual({ tam: 4, incele: 2, faturaYok: 1, lucaYok: 1, red: 2, digerEslesmeyen: 0, toplam: 10, kaynak: 'matchSummary' });
    expect(r.hataliToplam).toBe(4);
    const sinif = Object.fromEntries(r.satirlar.map((s: any) => [s.resultId, s.sinif]));
    expect(sinif).toEqual({ r2: 'incele', r4: 'incele', r5: 'fatura_yok', r6: 'luca_yok', r7: 'red', r8: 'red' });
    expect(r.satirlar.find((s: any) => s.resultId === 'r2').sebep).toMatch(/KDV tutar farkı: Luca 200.00 \/ fatura 185.00/);
    expect(r.satirlar.find((s: any) => s.resultId === 'r5')).toMatchObject({ belgeNo: 'A5', tarih: '2026-08-05', kdv: 30, tutar: 1000 });
    expect(r.satirlar.find((s: any) => s.resultId === 'r6')).toMatchObject({ belgeNo: 'F6', kdv: 40 });
    const hepsi = await tool.execute('kdv_kontrol_sonuc_satirlari', { sessionId: 's1', yalnizSorunlu: false, limit: 3 }, ctx);
    expect(hepsi.satirlar).toHaveLength(3);
    expect(hepsi.kesildi).toBe(true);
    expect(hepsi.satirlar.map((s: any) => s.sinif)).toEqual(['tam', 'incele', 'tam']);
  });

  it('results boş → sonucYok (eşleştirme çalışmamış)', async () => {
    const { tool } = aracKur({ servisler: { KdvControlService: { getResults: async () => [], getSessionStats: async () => stats } } });
    const r = await tool.execute('kdv_kontrol_sonuc_satirlari', { sessionId: 's1' }, ctx);
    expect(r).toMatchObject({ ok: true, sonucYok: true, satirlar: [] });
  });
});

describe('kdv_kontrol_belge_yeniden_oku / kdv_kontrol_ocr_teyit (R1 7b/9b, 2026-09-22)', () => {
  const RAW = '[MAX] {"belgeNo":"EAR2026000001616","kdvTutari":"43,35","kdvBreakdown":[{"oran":1,"tutar":"43,35","matrah":"4.335,00"}]}\n[AZURE]\nANKA TROPİK 15.08.2026 4.335,00 %1 43,35';
  const gorsel = (id: string, ek: any = {}) => ({
    id, originalName: `${id}.html`, ocrStatus: 'SUCCESS', ocrEngine: 'azure-read', ocrBelgeNo: 'EAR2026000001616', ocrDate: '15.08.2026',
    ocrKdvTutari: '4335,00', ocrKdvTevkifat: null, ocrKdvBreakdown: [{ oran: 20, tutar: 4335, matrah: null }], ocrRawText: 'ANKA 4.335,00', isManuallyConfirmed: false, ...ek,
  });
  const lucaPrisma = prismaKur({ kdvRecord: { findMany: () => [{ id: 'k1', belgeNo: 'EAR2026000001616', belgeDate: new Date('2026-08-15'), karsiTaraf: 'ANKA', kdvTutari: '43.35', kdvOrani: '1' }] } });
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  afterEach(() => { if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken; });

  it('yeniden oku: Max bağlı değilse ok:false, servis ÇAĞRILMAZ; kilitli oturumda çağrılmaz', async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const reocr = jest.fn();
    const svc = { findSession: async () => ({ status: 'REVIEWING' }), getImages: async () => [gorsel('i1', { ocrStatus: 'NEEDS_REVIEW' })], reocrSingleImageSync: reocr };
    const { tool } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.neden).toMatch(/Max bağlı değil/);
    expect(reocr).not.toHaveBeenCalled();
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    const svcKilit = { ...svc, findSession: async () => ({ status: 'COMPLETED' }) };
    const { tool: t2 } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: svcKilit } });
    const k = await t2.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1' }, ctx);
    expect(k).toMatchObject({ ok: false, neden: expect.stringMatching(/kilitli/) });
    expect(reocr).not.toHaveBeenCalled();
  });

  it('yeniden oku: imageIds boşsa teyit bekleyenleri seçer, elle teyitliyi atlar; Max okuması → oneri teyit + teyitGirdisi aynen; 6 tavanı → kalan', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    const images = [
      gorsel('i1', { ocrStatus: 'NEEDS_REVIEW', ocrKdvTutari: null, ocrKdvBreakdown: null }),
      gorsel('i2', { ocrStatus: 'SUCCESS' }),
      gorsel('i3', { ocrStatus: 'LOW_CONFIDENCE', isManuallyConfirmed: true }),
    ];
    const reocr = jest.fn(async (imageId: string) => {
      const once = images.find((i) => i.id === imageId)!;
      return {
        imageId, once, geriAlindi: false,
        sonra: { ...once, ocrStatus: 'SUCCESS', ocrEngine: 'max-vision (max-escalation)', ocrKdvTutari: '43,35', ocrKdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], ocrValidationScore: 1, ocrRawText: RAW },
      };
    });
    const svc = { findSession: async () => ({ status: 'REVIEWING' }), getImages: async () => images, reocrSingleImageSync: reocr };
    const { tool } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1' }, ctx);
    expect(r.ok).toBe(true);
    expect(reocr).toHaveBeenCalledTimes(1); // yalnız i1 (i3 elle teyitli → atlanır, i2 teyit beklemiyor)
    expect(r.okunan).toHaveLength(1);
    expect(r.okunan[0]).toMatchObject({ imageId: 'i1', oneri: 'teyit', lucaUyum: { uyumlu: true, lucaToplam: 43.35 } });
    expect(r.okunan[0].teyitGirdisi).toMatchObject({ imageId: 'i1', kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], kdvTevkifat: null });
    expect(r.ozet).toMatchObject({ okunan: 1, teyitOnerilen: 1, kalan: 0 });

    // elle teyitli açıkça istenirse dokunulmaz; 8 id → 6 okunur, 2 kalan
    const cok = Array.from({ length: 8 }, (_, i) => `i${i}`);
    const imgs8 = cok.map((id) => gorsel(id, { ocrStatus: 'SUCCESS' }));
    const reocr8 = jest.fn(async (imageId: string) => ({ imageId, once: imgs8[0], geriAlindi: false, sonra: { ...imgs8[0], ocrEngine: 'max-vision', ocrValidationScore: 1 } }));
    const { tool: t8 } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: { ...svc, getImages: async () => [...imgs8, gorsel('m', { isManuallyConfirmed: true })], reocrSingleImageSync: reocr8 } } });
    const r8 = await t8.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1', imageIds: [...cok, 'm'] }, ctx);
    expect(reocr8).toHaveBeenCalledTimes(6);
    expect(r8.kalan).toEqual(['i6', 'i7', 'm']);
    expect(r8.okunan.every((o: any) => o.oneri === 'degismedi')).toBe(true);
  });

  it('yeniden oku: Max okuması alınamadı (Azure’a düştü) ya da geri alındı → oneri muzaffer, teyitGirdisi yok', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    const img = gorsel('i1', { ocrStatus: 'NEEDS_REVIEW', ocrKdvTutari: null });
    const svc = {
      findSession: async () => ({ status: 'REVIEWING' }), getImages: async () => [img],
      reocrSingleImageSync: async () => ({ imageId: 'i1', once: img, geriAlindi: true, sonra: img }),
    };
    const { tool } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1', imageIds: ['i1'] }, ctx);
    expect(r.okunan[0]).toMatchObject({ oneri: 'muzaffer', teyitGirdisi: null, geriAlindi: true });
  });

  it('yeniden oku: PROCESSING görsel yeniden BAŞLATILMAZ — bitmesi beklenir, önceki değer bilinmeden değerlendirilir', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    const img = gorsel('i1', { ocrStatus: 'PROCESSING' });
    const bitmis = { ...img, ocrStatus: 'SUCCESS', ocrEngine: 'max-vision (max-escalation)', ocrKdvTutari: '43,35', ocrKdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], ocrValidationScore: 1 };
    let sayac = 0;
    const pr = prismaKur({
      kdvRecord: { findMany: () => [{ id: 'k1', belgeNo: 'EAR2026000001616', kdvTutari: '43.35', kdvOrani: '1' }] },
      receiptImage: { findUnique: () => (++sayac >= 2 ? bitmis : img) },
    });
    const reocr = jest.fn();
    const svc = { findSession: async () => ({ status: 'REVIEWING' }), getImages: async () => [img], reocrSingleImageSync: reocr };
    const { tool } = aracKur({ prisma: pr.prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1', imageIds: ['i1'] }, ctx);
    expect(reocr).not.toHaveBeenCalled();
    expect(r.okunan[0]).toMatchObject({ imageId: 'i1', oneri: 'teyit', not: expect.stringMatching(/önceki değer bilinmiyor/) });
    expect(r.okunan[0].teyitGirdisi).toMatchObject({ kdvTutari: '43,35' });
  });

  it('yeniden oku: görsel başına 60 sn tavanı — aşınca suruyor:true, kalan listesine girer, çağrı takılmaz', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    jest.useFakeTimers();
    try {
      const img = gorsel('i1', { ocrStatus: 'NEEDS_REVIEW' });
      const svc = { findSession: async () => ({ status: 'REVIEWING' }), getImages: async () => [img], reocrSingleImageSync: () => new Promise(() => {}) };
      const { tool } = aracKur({ prisma: lucaPrisma.prisma, servisler: { KdvControlService: svc } });
      const soz = tool.execute('kdv_kontrol_belge_yeniden_oku', { sessionId: 's1', imageIds: ['i1'] }, ctx);
      await jest.advanceTimersByTimeAsync(61_000);
      const r = await soz;
      expect(r.okunan[0]).toMatchObject({ imageId: 'i1', ok: false, suruyor: true, oneri: 'muzaffer' });
      expect(r.kalan).toEqual(['i1']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ocr teyit: belgede görülen değer confirmImageOcr’a ekrandaki biçimde gider; uydurma rakam reddedilir; elle teyitli atlanır; gerekce zorunlu', async () => {
    const confirm = jest.fn(async (_imageId: string, _tenantId: string, _dto: any) => ({}));
    const images = [gorsel('i1', { ocrRawText: RAW }), gorsel('i2', { isManuallyConfirmed: true }), gorsel('i3', { ocrRawText: RAW })];
    const svc = { getImages: async () => images, confirmImageOcr: confirm };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute(
      'kdv_kontrol_ocr_teyit',
      {
        sessionId: 's1',
        teyitler: [
          { imageId: 'i1', kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], kdvTevkifat: null, gerekce: 'yeniden okuma' },
          { imageId: 'i2', kdvTutari: '43,35', gerekce: 'x' },
          { imageId: 'i3', kdvTutari: '86,70', gerekce: 'ajan hesabı' },
          { imageId: 'i3', kdvTutari: '43,35' },
          { imageId: 'yok', kdvTutari: '1,00', gerekce: 'x' },
        ],
      },
      ctx,
    );
    expect(r).toMatchObject({ ok: true, teyitEdilen: 1, reddedilen: 3, atlanan: 1 });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe('i1');
    expect(confirm.mock.calls[0][2]).toEqual({ kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], kdvTevkifat: null });
    const satir = (id: string, i = 0) => r.satirlar.filter((s: any) => s.imageId === id)[i];
    expect(satir('i1').degisenler.join(' ')).toMatch(/kdv 4335,00 → 43,35/);
    expect(satir('i2')).toMatchObject({ atlandi: true });
    expect(satir('i3', 0).neden).toMatch(/86,70 belge metninde görülmedi/);
    expect(satir('i3', 1).neden).toMatch(/gerekce zorunlu/);
    expect(satir('yok').neden).toMatch(/bu oturumda değil/);
  });

  it('ocr teyit: kilitli oturum 400 → satır hatası "Oturum kilitli"; 20 üstü → hata', async () => {
    const svc = { getImages: async () => [gorsel('i1', { ocrRawText: RAW })], confirmImageOcr: async () => { throw new BadRequestException('Oturum kilitli'); } };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_ocr_teyit', { sessionId: 's1', teyitler: [{ imageId: 'i1', kdvTutari: '43,35', gerekce: 'x' }] }, ctx);
    expect(r.satirlar[0].neden).toMatch(/Oturum kilitli/);
    const cok = await tool.execute('kdv_kontrol_ocr_teyit', { sessionId: 's1', teyitler: Array.from({ length: 21 }, () => ({ imageId: 'i1', gerekce: 'x' })) }, ctx);
    expect(cok.ok).toBe(false);
  });

  it('sonuc_satirlari: luca_yok/fatura_yok satırlarına ipucu + yenidenOkunacakImageIds (×100 matrah)', async () => {
    const rec = { belgeNo: 'EAR2026000001616', belgeDate: new Date('2026-08-15T00:00:00Z'), karsiTaraf: 'ANKA', kdvTutari: '43.35', kdvMatrahi: null, kdvOrani: '1' };
    const img = { ocrBelgeNo: 'EAR2026000001616', ocrDate: '15.08.2026', ocrKdvTutari: '4335,00', ocrKdvBreakdown: [{ oran: 20, tutar: 4335 }], ocrStatus: 'SUCCESS', ocrSatici: 'ANKA TROPİK' };
    const results = [
      { id: 'r1', status: 'UNMATCHED', kdvRecordId: 'k1', imageId: null, kdvRecord: rec, image: null, mismatchReasons: [] },
      { id: 'r2', status: 'UNMATCHED', kdvRecordId: null, imageId: 'i1', kdvRecord: null, image: img, mismatchReasons: [] },
    ];
    const svc = { getResults: async () => results, getSessionStats: async () => null };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_sonuc_satirlari', { sessionId: 's1' }, ctx);
    expect(r.yenidenOkunacakImageIds).toEqual(['i1']);
    expect(r.ocrSupheliSayisi).toBe(1);
    const s1 = r.satirlar.find((s: any) => s.resultId === 'r1');
    const s2 = r.satirlar.find((s: any) => s.resultId === 'r2');
    expect(s1).toMatchObject({ sinif: 'fatura_yok', ipucuTuru: 'MATRAH_KDV_SANILMIS', ocrSupheli: true, adayImageId: 'i1', adayKdvRecordIds: ['k1'] });
    expect(s2).toMatchObject({ sinif: 'luca_yok', ipucuTuru: 'MATRAH_KDV_SANILMIS', adayKdvRecordIds: ['k1'] });
    expect(s2.ipucu).toMatch(/100 katı/);
  });
});

describe('kdv_kontrol_bos_oturum_kilitle (boş dönem kilidi, 2026-09-22)', () => {
  const svcKur = (status = 'PROCESSING') => {
    const complete = jest.fn(async () => ({}));
    return { svc: { findSession: async () => ({ status }), completeSession: complete }, complete };
  };
  it('Luca 0 + görsel 0 + Luca işi done → completeSession çağrılır, kilitlendi:true', async () => {
    const { svc, complete } = svcKur();
    const pr = prismaKur({ kdvRecord: { count: () => 0 }, receiptImage: { count: () => 0 }, lucaFetchJob: { findFirst: () => ({ id: 'lj1', recordCount: 0, finishedAt: new Date() }) } });
    const { tool } = aracKur({ prisma: pr.prisma, servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_bos_oturum_kilitle', { sessionId: 's1' }, ctx);
    expect(r).toMatchObject({ ok: true, kilitlendi: true, lucaIsId: 'lj1' });
    expect(complete).toHaveBeenCalledWith('s1', 't1');
  });
  it('Luca kaydı ya da görsel varsa kilitlemez; Luca işi yoksa kilitlemez; zaten kilitliyse dokunmaz', async () => {
    const { svc, complete } = svcKur();
    const dolu = prismaKur({ kdvRecord: { count: () => 21 }, receiptImage: { count: () => 0 } });
    const { tool } = aracKur({ prisma: dolu.prisma, servisler: { KdvControlService: svc } });
    expect((await tool.execute('kdv_kontrol_bos_oturum_kilitle', { sessionId: 's1' }, ctx)).ok).toBe(false);
    const issiz = prismaKur({ kdvRecord: { count: () => 0 }, receiptImage: { count: () => 0 }, lucaFetchJob: { findFirst: () => null } });
    const { tool: t2 } = aracKur({ prisma: issiz.prisma, servisler: { KdvControlService: svc } });
    const r2 = await t2.execute('kdv_kontrol_bos_oturum_kilitle', { sessionId: 's1' }, ctx);
    expect(r2.ok).toBe(false);
    expect(r2.neden).toMatch(/Luca çekimi/);
    expect(complete).not.toHaveBeenCalled();
    const { svc: kilitli } = svcKur('COMPLETED');
    const { tool: t3 } = aracKur({ prisma: issiz.prisma, servisler: { KdvControlService: kilitli } });
    expect(await t3.execute('kdv_kontrol_bos_oturum_kilitle', { sessionId: 's1' }, ctx)).toMatchObject({ ok: true, zatenKilitli: true });
  });
  it('kdv_kontrol_eslestir: Luca 0 + görsel 0 → bosDonemOlabilir + boş dönem kilidi yönlendirmesi', async () => {
    const svc = { findSession: async () => ({ status: 'PROCESSING', _count: { kdvRecords: 0 } }), getImages: async () => [], runReconciliation: jest.fn() };
    const { tool } = aracKur({ servisler: { KdvControlService: svc } });
    const r = await tool.execute('kdv_kontrol_eslestir', { sessionId: 's1' }, ctx);
    expect(r).toMatchObject({ ok: false, bosDonemOlabilir: true });
    expect(r.sonraki).toMatch(/kdv_kontrol_bos_oturum_kilitle/);
    expect(svc.runReconciliation).not.toHaveBeenCalled();
  });
});

describe('get_taxpayer_work_status (PLAN/17 bulgu 5)', () => {
  it('KDV oturumu periodLabel YYYY/MM ile; mizan çeyrek adayı + EDEFTER süzgeci + kilitli tercih; kilitli mizan varsa "LUCA mizan yok" YAZILMAZ', async () => {
    const { prisma, cagrilar } = prismaKur({
      taxpayer: { findFirst: () => ({ id: TAXPAYER, companyName: 'ÖZ ELA TURİZM' }) },
      kdvControlSession: { findMany: () => [{ id: 's1', type: 'KDV_191', status: 'COMPLETED', periodLabel: '2026/06' }] },
      mizan: { findFirst: () => ({ id: 'm1', donem: '2026-Q2', locked: true, kaynak: 'EXCEL', donemTipi: 'GECICI_Q2' }) },
    });
    const { tool } = aracKur({ prisma });
    const r = await tool.execute('get_taxpayer_work_status', { taxpayerId: TAXPAYER, period: '2026-06' }, ctx);
    const oturumSorgu = cagrilar.find((c) => c.model === 'kdvControlSession');
    expect(oturumSorgu?.args.where).toEqual({ tenantId: 't1', taxpayerId: TAXPAYER, periodLabel: '2026/06' });
    const mizanSorgu = cagrilar.find((c) => c.model === 'mizan');
    expect(mizanSorgu?.args.where.donem.in).toEqual(expect.arrayContaining(['2026-06', '2026-Q2']));
    expect(mizanSorgu?.args.where.kaynak).toEqual({ not: 'EDEFTER' });
    expect(mizanSorgu?.args.orderBy).toEqual([{ locked: 'desc' }, { createdAt: 'desc' }]);
    expect(r.eksikler).not.toContain('LUCA mizan yok');
    expect(r.veri.kdvKontrolOturumu).toBe(1);
    expect(r.veri.kdvKontrolOturumlari[0]).toMatchObject({ sessionId: 's1', type: 'KDV_191', kilitli: true });
    expect(r.veri.mizan).toMatchObject({ id: 'm1', donem: '2026-Q2', kilitli: true });
  });

  it('2026-08 → mizan adaylarına 2026-Q3 eklenir; mizan yoksa "LUCA mizan yok"; kilitsiz mizan ayrı uyarı', async () => {
    const { prisma, cagrilar } = prismaKur({ taxpayer: { findFirst: () => ({ id: TAXPAYER, companyName: 'X' }) } });
    const { tool } = aracKur({ prisma });
    const r = await tool.execute('get_taxpayer_work_status', { taxpayerId: TAXPAYER, period: '2026-08' }, ctx);
    expect(cagrilar.find((c) => c.model === 'mizan')?.args.where.donem.in).toContain('2026-Q3');
    expect(r.eksikler).toContain('LUCA mizan yok');
    const { prisma: p2 } = prismaKur({ taxpayer: { findFirst: () => ({ id: TAXPAYER, companyName: 'X' }) }, mizan: { findFirst: () => ({ id: 'm2', donem: '2026-Q3', locked: false, kaynak: 'LUCA' }) } });
    const r2 = await aracKur({ prisma: p2 }).tool.execute('get_taxpayer_work_status', { taxpayerId: TAXPAYER, period: '2026-08' }, ctx);
    expect(r2.eksikler).not.toContain('LUCA mizan yok');
    expect(r2.eksikler).toContain('mizan var ama kilitsiz (taslak)');
  });
});

describe('get_gelir_tablosu — kilitli tercih (PLAN/17 R2 adım 3)', () => {
  it('orderBy locked desc; 3 kopya/1 kilitli → kilitli döner, kopyaSayisi 3, geçici vergi hesabı servisten', async () => {
    const kopyalar = [
      { id: 'gt-kilitli', locked: true },
      { id: 'gt-taslak-1', locked: false },
      { id: 'gt-taslak-2', locked: false },
    ];
    const { prisma, cagrilar } = prismaKur({
      gelirTablosu: {
        findFirst: (a: any) => (a.orderBy?.[0]?.locked === 'desc' ? { id: 'gt-kilitli', donem: '2026-Q2', donemTipi: 'GECICI_Q2', locked: true, lockedAt: new Date('2026-08-01T00:00:00Z'), mizanId: 'm1', duzeltmeler: { satisMaliyeti: 100 }, netSatislar: 1000, brutSatisKari: 400, faaliyetKari: 300, donemNetKari: 250 } : { id: 'gt-taslak-2', locked: false }),
        findMany: () => kopyalar,
      },
    });
    const gtSvc = { getGelirTablosu: jest.fn(async () => ({ geciciVergiHesabi: { odenecekGeciciVergi: 62.5, donemSirasi: 2 } })) };
    const { tool } = aracKur({ prisma, servisler: { GelirTablosuService: gtSvc } });
    const r = await tool.execute('get_gelir_tablosu', { taxpayerId: TAXPAYER, donem: '2026-Q2' }, ctx);
    expect(cagrilar.find((c) => c.model === 'gelirTablosu' && c.metot === 'findFirst')?.args.orderBy).toEqual([{ locked: 'desc' }, { createdAt: 'desc' }]);
    expect(r).toMatchObject({ kayitId: 'gt-kilitli', kilitli: true, kilitTarihi: '2026-08-01', kopyaSayisi: 3, kilitliKopyaVar: true, mizanId: 'm1', duzeltmeler: { satisMaliyeti: 100 }, geciciVergiHesabi: { odenecekGeciciVergi: 62.5 } });
    expect(r.kaynak).toBe('portal GT gt-kilitli (kilitli 2026-08-01)');
    expect(gtSvc.getGelirTablosu).toHaveBeenCalledWith('gt-kilitli', 't1');
  });
});

describe('mali_yorum_oku / mali_donemler_listele', () => {
  it('mali_yorum_oku: kayıt yok → yorum null; kayıt var → {ozet, model, updatedAt}; geçersiz kaynak → hata', async () => {
    const get = jest.fn(async (_t: string, kaynak: string, id: string) => (id === 'gt-1' ? { ozet: 'Net kâr %25 arttı.', model: 'claude-sonnet-4-5', donem: '2026-Q2', updatedAt: new Date('2026-08-02T00:00:00Z') } : null));
    const { tool } = aracKur({ servisler: { MaliYorumService: { get } } });
    expect(await tool.execute('mali_yorum_oku', { kaynak: 'GELIR_TABLOSU', kaynakId: 'gt-9' }, ctx)).toMatchObject({ ok: true, yorum: null });
    const r = await tool.execute('mali_yorum_oku', { kaynak: 'gelir_tablosu', kaynakId: 'gt-1' }, ctx);
    expect(r.yorum).toEqual({ ozet: 'Net kâr %25 arttı.', model: 'claude-sonnet-4-5', donem: '2026-Q2', updatedAt: '2026-08-02T00:00:00.000Z' });
    expect(get).toHaveBeenLastCalledWith('t1', 'GELIR_TABLOSU', 'gt-1');
    expect((await tool.execute('mali_yorum_oku', { kaynak: 'X', kaynakId: '1' }, ctx)).ok).toBe(false);
  });

  it('mali_donemler_listele: GT + bilanço + mizan (EDEFTER süzülür) tek listede, dönem desc, kilitli önce, kopya sayısı', async () => {
    const { prisma, cagrilar } = prismaKur({
      gelirTablosu: { findMany: () => [{ id: 'gt1', donem: '2026-Q2', donemTipi: 'GECICI_Q2', locked: true, lockedAt: new Date('2026-08-01'), mizanId: 'm1', createdAt: new Date('2026-07-30') }, { id: 'gt2', donem: '2026-Q2', locked: false, createdAt: new Date('2026-07-29') }] },
      bilanco: { findMany: () => [{ id: 'b1', donem: '2026-Q1', locked: true, mizanId: 'm0', createdAt: new Date('2026-05-01') }] },
      mizan: { findMany: () => [{ id: 'm1', donem: '2026-Q2', donemTipi: 'GECICI_Q2', locked: true, kaynak: 'EXCEL', status: 'READY', createdAt: new Date('2026-07-28') }] },
    });
    const { tool } = aracKur({ prisma });
    const r = await tool.execute('mali_donemler_listele', { taxpayerId: TAXPAYER }, ctx);
    expect(r.ok).toBe(true);
    expect(cagrilar.find((c) => c.model === 'mizan')?.args.where.kaynak).toEqual({ not: 'EDEFTER' });
    expect(r.sayim).toEqual({ gelirTablosu: 2, bilanco: 1, mizan: 1, toplam: 4 });
    expect(r.donemler.map((d: any) => [d.tur, d.donem, d.kilitli, d.kopyaSayisi])).toEqual([
      ['GELIR_TABLOSU', '2026-Q2', true, 2],
      ['MIZAN', '2026-Q2', true, 1],
      ['GELIR_TABLOSU', '2026-Q2', false, 2],
      ['BILANCO', '2026-Q1', true, 1],
    ]);
    expect(r.donemler[1].kaynak).toBe('EXCEL');
  });
});

describe('ekip_ajan_baslat / ekip_is_durum', () => {
  it('koşu arka planda başlar (await edilmez), isId baslangic olayından; runner parametreleri', async () => {
    let cozulmedi = true;
    const calistir = jest.fn((p: any) => {
      p.emit({ type: 'baslangic', isId: 'is-1', ajanId: p.ajanId, model: 'm', dryRun: p.dryRun });
      return new Promise(() => {
        /* bitmeyen koşu: araç yine döner */
        cozulmedi = true;
      });
    });
    const { tool } = aracKur({ servisler: { EkipRunnerService: { calistir } } });
    const r = await tool.execute('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'R1 Erdoğan Balçık 2026/08 kuru', taxpayerId: TAXPAYER }, ctx);
    expect(r).toMatchObject({ ok: true, baslatildi: true, isId: 'is-1', ajanId: 'beyanname', dryRun: true });
    expect(calistir).toHaveBeenCalledTimes(1);
    expect(calistir.mock.calls[0][0]).toMatchObject({ ajanId: 'beyanname', gorev: 'R1 Erdoğan Balçık 2026/08 kuru', tenantId: 't1', userId: 'u1', taxpayerId: TAXPAYER, dryRun: true, kaynak: 'koordinator' });
    expect(cozulmedi).toBe(true);
  });

  it('tekrar kilidi: aynı ajan + mükellef için running iş varsa {ok:false, mevcutIsId}; başka mükellef ise açılır', async () => {
    const calistir = jest.fn((p: any) => {
      p.emit({ type: 'baslangic', isId: 'is-2', ajanId: p.ajanId, model: 'm', dryRun: true });
      return Promise.resolve({ isId: 'is-2' });
    });
    const { prisma } = prismaKur({ agentCommand: { findMany: () => [{ id: 'is-eski', status: 'running', payload: { taxpayerId: TAXPAYER } }] } });
    const { tool } = aracKur({ prisma, servisler: { EkipRunnerService: { calistir } } });
    const ayni = await tool.execute('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'x', taxpayerId: TAXPAYER }, ctx);
    expect(ayni).toMatchObject({ ok: false, mevcutIsId: 'is-eski' });
    expect(calistir).not.toHaveBeenCalled();
    const baska = await tool.execute('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'x', taxpayerId: 'baska' }, ctx);
    expect(baska).toMatchObject({ ok: true, isId: 'is-2' });
  });

  it('dryRun:false yalnız ctx.userId doluysa; kullanıcı yoksa kuru teste düşer; baslangic 500 ms içinde gelmezse isId null', async () => {
    const calistir = jest.fn((_p: any) => new Promise(() => undefined));
    const { tool } = aracKur({ servisler: { EkipRunnerService: { calistir } } });
    const r = await tool.execute('ekip_ajan_baslat', { ajanId: 'analist', gorev: 'R2', dryRun: false }, { tenantId: 't1', userId: null });
    expect(r).toMatchObject({ ok: true, baslatildi: true, isId: null, dryRun: true });
    expect(r.not).toMatch(/kuru teste düşürüldü/);
    expect(calistir.mock.calls[0][0]).toMatchObject({ dryRun: true, userId: null });
  });

  it('ekip_is_durum: runner.isGetir → status/rapor(≤1500)/hata/durationMs', async () => {
    const isGetir = jest.fn(async (_t: string, id: string) => id === 'yok' ? null : ({ id: 'is-1', ajanId: 'beyanname', status: 'done', dryRun: true, taxpayerId: TAXPAYER, durationMs: 4200, hata: null, kuruTestSayisi: 3, onayBekleyenSayisi: 1, result: { rapor: 'R'.repeat(2000) } }));
    const { tool } = aracKur({ servisler: { EkipRunnerService: { isGetir } } });
    const r = await tool.execute('ekip_is_durum', { isId: 'is-1' }, ctx);
    expect(isGetir).toHaveBeenCalledWith('t1', 'is-1');
    expect(r).toMatchObject({ ok: true, status: 'done', bitti: true, durationMs: 4200, raporKesildi: true, kuruTestSayisi: 3, onayBekleyenSayisi: 1 });
    expect(r.rapor).toHaveLength(1500);
    expect((await tool.execute('ekip_is_durum', { isId: 'yok' }, ctx)).ok).toBe(false);
  });
});
