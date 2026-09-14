/**
 * FATURA ÇEKİMİ ZİNCİRİ (R5, 2026-09-15) — fm_cekim_baslat / fm_cekim_durum / fm_cekim_bekle / fm_cekim_aktar.
 * Muzaffer Bey: "faturaları çek ve işle → Fatura İşleme Merkezi; e-Fatura mükellefi ise e-Fatura sorgulama, değilse GİB e-Arşiv".
 *  - Yol seçimi: Taxpayer.isEFaturaMukellefi (ya da mükellef kartında e-Fatura entegratörü) → efatura; değilse earsiv.
 *  - e-Fatura yolu: ekranın efatura-sync çağrısıyla aynı (TURKCELL/TÜRMOB → startEfaturaSyncBackground, gerisi senkron).
 *  - GİB e-Arşiv yolu: fetchConfiguredIntegrations {providers:[GIB_PORTAL], mode:query} + runner wake; yalnız SATIŞ.
 *  - Entegratör yoksa HAZIR DEĞİL; hata asla fırlatılmaz ({ok:false, neden}).
 *  - Kuru test kesme kademe defterinden (arac-defteri): baslat/aktar luca_yaz → "yapılacaktı"; durum/bekle oku.
 * Kilitli servisler (Fatura Merkezi, e-Fatura senkron, portal otomasyon, runner) jest.mock ile sahte; moduleRef sınıf ADIYLA döner.
 */
jest.mock('../fatura-muhasebelestirme/fatura-muhasebelestirme.service', () => ({ FaturaMuhasebelestirmeService: class FaturaMuhasebelestirmeService {} }));
jest.mock('../efatura-adapters/efatura-sync.service', () => ({ EFaturaSyncService: class EFaturaSyncService {} }));
jest.mock('../portal-automation/portal-automation.service', () => ({ PortalAutomationService: class PortalAutomationService {} }));
jest.mock('../portal-automation/portal-automation-railway-runner.service', () => ({ PortalAutomationRailwayRunnerService: class PortalAutomationRailwayRunnerService {} }));

import { BadRequestException } from '@nestjs/common';
import { ToolExecutorService } from './tool-executor.service';
import { EKIP_IS_ZINCIRI_ARACLARI, MOREN_AI_TOOLS } from './tools';
import { aracAcikMi, aracKademesi } from '../ekip/arac-defteri';
import { ajanBul } from '../ekip/ajan-tanimlari';

type Cagri = { model: string; metot: string; args: any };

/** Proxy Prisma: prisma.<model>.<metot>(args) → kayıt + override ya da varsayılan (findMany [] · findFirst null · count 0). */
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

const TP = 'cmnydmgbx000heazyp9i4fq23';
const ctx = { tenantId: 't1', userId: 'u1', taxpayerId: null as string | null };

/** Mükellef kaydı: efatura=true → e-Fatura mükellefi; entegrator → mükellef kartındaki e-Fatura entegratörü. */
const mukellef = (efatura: boolean, entegrator: string | null = null) => ({
  taxpayer: {
    findFirst: () => ({ id: TP, companyName: 'ERDOĞAN BALÇIK', isEFaturaMukellefi: efatura, eFaturaEntegrator: entegrator, contacts: [], monthlyStatuses: [], phones: [] }),
  },
});

/** listIntegrations satırı (ekranın okuduğu alanlar). */
const saglayici = (provider: string, o: { configured?: boolean; isActive?: boolean; taxpayerScoped?: boolean; kind?: string } = {}) => {
  const configured = o.configured ?? true;
  const isActive = o.isActive ?? true;
  return { provider, label: provider === 'TURMOB_EFATURA' ? 'TURMOB e-Fatura' : provider, kind: o.kind ?? 'efatura', configured, isActive, connected: configured && isActive, taxpayerScoped: o.taxpayerScoped ?? configured };
};

function aracKur(opts: { prisma?: any; servisler?: Record<string, any> } = {}) {
  const servisler = opts.servisler || {};
  const moduleRef = { get: (cls: any) => servisler[cls?.name] ?? null };
  const tool = new ToolExecutorService(opts.prisma ?? prismaKur().prisma, moduleRef as any);
  const bekle = jest.spyOn(tool as any, 'bekle').mockResolvedValue(undefined);
  return { tool, bekle };
}

/** Sahte Fatura Merkezi servisi — çağrıları kaydeder. */
function fmKur(o: {
  entegratorler?: any[];
  syncStatus?: (channel: string) => any;
  syncSonuc?: any;
  syncBekle?: boolean;
  fetchSonuc?: any;
  fetchHata?: Error;
  importSonuc?: (opts: any) => any;
} = {}) {
  const cagrilar: { metot: string; args: any[] }[] = [];
  const kaydet = (metot: string, args: any[]) => cagrilar.push({ metot, args });
  const svc = {
    listIntegrations: async (...a: any[]) => { kaydet('listIntegrations', a); return o.entegratorler ?? [saglayici('TURMOB_EFATURA')]; },
    startEfaturaSyncBackground: (...a: any[]) => { kaydet('startEfaturaSyncBackground', a); return { started: true, background: true, statusKey: 'k' }; },
    syncEfaturaInboxFromIntegrations: (...a: any[]) => {
      kaydet('syncEfaturaInboxFromIntegrations', a);
      if (o.syncBekle) return new Promise(() => undefined); // hiç bitmez → "sürüyor"
      return Promise.resolve(o.syncSonuc ?? { source: 'efatura-inbox', fetched: 4, added: 3, updated: 1, skipped: 0, failed: 0, providers: [{ provider: 'UYUMSOFT', status: 'OK' }] });
    },
    getEfaturaSyncStatus: (_t: string, _tp: string, channel: string) => (o.syncStatus ? o.syncStatus(channel) : { state: 'idle', import: { state: 'idle' } }),
    fetchConfiguredIntegrations: async (...a: any[]) => {
      kaydet('fetchConfiguredIntegrations', a);
      if (o.fetchHata) throw o.fetchHata;
      return o.fetchSonuc ?? { ok: true, providers: [{ provider: 'GIB_PORTAL', status: 'QUEUED_GIB_PORTAL', queued: 1, jobs: [{ id: 'job-1' }] }] };
    },
    importEfaturaInboxToAccounting: async (...a: any[]) => {
      kaydet('importEfaturaInboxToAccounting', a);
      return o.importSonuc ? o.importSonuc(a[2]) : { processed: 5, imported: 4, alreadyQueued: 1, skipped: 0, failed: 0, staleReset: 0, iptalAtlanan: 0, errors: [] };
    },
  };
  return { svc, cagrilar };
}

describe('fm_cekim_* araç şemaları', () => {
  it('4 araç EKIP_IS_ZINCIRI_ARACLARI içinde; MOREN_AI_TOOLS dışında; taxpayerId + donem zorunlu; yon enum', () => {
    const adlar = ['fm_cekim_baslat', 'fm_cekim_durum', 'fm_cekim_bekle', 'fm_cekim_aktar'];
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const ad of adlar) {
      const t = EKIP_IS_ZINCIRI_ARACLARI.find((x) => x.name === ad)!;
      expect({ ad, var: !!t }).toEqual({ ad, var: true });
      expect(t.input_schema.required).toEqual(['taxpayerId', 'donem']);
      expect(t.description.length).toBeGreaterThan(80);
      expect(genel.has(ad)).toBe(false);
    }
    const sema = (ad: string) => EKIP_IS_ZINCIRI_ARACLARI.find((x) => x.name === ad)!.input_schema as any;
    expect(sema('fm_cekim_baslat').properties.yon.enum).toEqual(['alis', 'satis', 'ikisi']);
    expect(sema('fm_cekim_durum').properties.yol.enum).toEqual(['efatura', 'earsiv']);
    expect(sema('fm_cekim_bekle').properties.maxSaniye).toBeTruthy();
  });

  it('kademe (arac-defteri): baslat/aktar luca_yaz → kuru testte kesilir ("yapılacaktı"); durum/bekle oku → kuru testte de açık; fatura ajanında', () => {
    const fatura = ajanBul('fatura')!;
    for (const ad of ['fm_cekim_baslat', 'fm_cekim_aktar']) {
      expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'luca_yaz' });
      const kuru = aracAcikMi(fatura, ad, true);
      expect({ ad, acik: kuru.acik, neden: kuru.neden }).toEqual({ ad, acik: false, neden: 'kuru_test' });
      expect(kuru.mesaj).toMatch(/yapılacaktı/);
      expect(aracAcikMi(fatura, ad, false).acik).toBe(true);
    }
    for (const ad of ['fm_cekim_durum', 'fm_cekim_bekle']) {
      expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
      expect(aracAcikMi(fatura, ad, true).acik).toBe(true);
    }
  });
});

describe('get_taxpayer — çekim yolu alanları', () => {
  it('eFaturaMukellefi / eFaturaEntegrator / faturaCekimYolu döner', async () => {
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma });
    const r = await tool.execute('get_taxpayer', { taxpayerId: TP }, ctx);
    expect(r.eFaturaMukellefi).toBe(true);
    expect(r.faturaCekimYolu).toBe('efatura');
    const { tool: t2 } = aracKur({ prisma: prismaKur(mukellef(false)).prisma });
    expect((await t2.execute('get_taxpayer', { taxpayerId: TP }, ctx)).faturaCekimYolu).toBe('earsiv');
    // anahtar kapalı ama kartta entegratör yazılı → efatura; GIB_PORTAL yazılıysa earsiv
    const { tool: t3 } = aracKur({ prisma: prismaKur(mukellef(false, 'UYUMSOFT')).prisma });
    expect((await t3.execute('get_taxpayer', { taxpayerId: TP }, ctx)).faturaCekimYolu).toBe('efatura');
    const { tool: t4 } = aracKur({ prisma: prismaKur(mukellef(false, 'GIB_PORTAL')).prisma });
    expect((await t4.execute('get_taxpayer', { taxpayerId: TP }, ctx)).faturaCekimYolu).toBe('earsiv');
  });
});

describe('fm_cekim_baslat — giriş kapıları', () => {
  it('taxpayerId yok / dönem bozuk / mükellef yok → {ok:false, neden}; throw yok', async () => {
    const { tool } = aracKur({ prisma: prismaKur().prisma });
    expect(await tool.execute('fm_cekim_baslat', { donem: '2026-08' }, ctx)).toEqual({ ok: false, neden: expect.stringMatching(/taxpayerId gerekli/) });
    expect(await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: 'Ağustos' }, ctx)).toEqual({ ok: false, neden: expect.stringMatching(/YYYY-MM/) });
    expect(await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx)).toEqual({ ok: false, neden: 'Mükellef bulunamadı.' });
  });

  it('servis çözülemezse {ok:false, neden}', async () => {
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026/08' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'efatura', donem: '2026-08', neden: expect.stringMatching(/servisi kullanılamıyor/) });
  });
});

describe('fm_cekim_baslat — e-Fatura yolu (mükellef e-Fatura mükellefi)', () => {
  it('TÜRMOB bağlı → 3 kanal (alış e-Fatura, satış e-Fatura, satış e-Arşiv) startEfaturaSyncBackground; ekranla aynı opts; arkaPlan:true', async () => {
    const fm = fmKur();
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'efatura', mukellef: 'ERDOĞAN BALÇIK', donem: '2026-08', yon: 'ikisi', arkaPlan: true, isler: [] });
    expect(r.saglayicilar).toEqual([{ provider: 'TURMOB_EFATURA', label: 'TURMOB e-Fatura' }]);
    expect(r.karar).toMatch(/e-Fatura mükellefi/);
    const bg = fm.cagrilar.filter((c) => c.metot === 'startEfaturaSyncBackground');
    expect(bg.map((c) => c.args[2].channel)).toEqual(['IN_EFATURA', 'OUT_EFATURA', 'OUT_EARSIV']);
    expect(bg[0].args[0]).toBe('t1');
    expect(bg[0].args[1]).toBe('u1');
    expect(bg[0].args[2]).toEqual({ taxpayerId: TP, period: '2026-08', direction: 'IN', channel: 'IN_EFATURA', limit: 2000, providers: ['TURMOB_EFATURA'] });
    expect(bg[2].args[2].direction).toBe('OUT');
    expect(r.kanallar.map((k: any) => k.basladi)).toEqual([true, true, true]);
    expect(r.mesaj).toMatch(/arka planda başladı/);
    expect(r.sonraki).toMatch(/fm_cekim_bekle/);
    // senkron sorgu / GİB yolu çağrılmadı
    expect(fm.cagrilar.some((c) => c.metot === 'syncEfaturaInboxFromIntegrations' || c.metot === 'fetchConfiguredIntegrations')).toBe(false);
  });

  it('yon:alis → yalnız IN_EFATURA; yon:satis → OUT_EFATURA + OUT_EARSIV', async () => {
    const fm = fmKur();
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(fm.cagrilar.filter((c) => c.metot === 'startEfaturaSyncBackground').map((c) => c.args[2].channel)).toEqual(['IN_EFATURA']);
    fm.cagrilar.length = 0;
    await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'satis' }, ctx);
    expect(fm.cagrilar.filter((c) => c.metot === 'startEfaturaSyncBackground').map((c) => c.args[2].channel)).toEqual(['OUT_EFATURA', 'OUT_EARSIV']);
  });

  it('TÜRMOB sorgusu zaten sürüyorsa (alreadyRunning) zatenSuruyor:true, ok:true, mesaj "zaten sürüyordu"', async () => {
    const fm = fmKur();
    fm.svc.startEfaturaSyncBackground = () => ({ started: false, background: true, alreadyRunning: true, statusKey: 'k' });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', zatenSuruyor: true, basladi: false });
    expect(r.mesaj).toMatch(/zaten sürüyordu/);
  });

  it('entegratör tanımsız (hiçbiri yapılandırılmamış) → HAZIR DEĞİL, sorgu çağrılmaz', async () => {
    const fm = fmKur({ entegratorler: [saglayici('TURMOB_EFATURA', { configured: false, taxpayerScoped: false }), saglayici('UYUMSOFT', { configured: false, taxpayerScoped: false }), saglayici('GIB_PORTAL', { kind: 'portal' })] });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'efatura', neden: expect.stringMatching(/^HAZIR DEĞİL: mükellefin e-Fatura entegratörü tanımlı değil/) });
    expect(r.neden).toMatch(/Mükellef kartı › Entegrasyon/);
    expect(fm.cagrilar.map((c) => c.metot)).toEqual(['listIntegrations']);
  });

  it('entegratör tanımlı ama pasif/kimlik eksik (connected=false) → HAZIR DEĞİL kimlik eksik; sorgu çağrılmaz', async () => {
    const fm = fmKur({ entegratorler: [saglayici('UYUMSOFT', { configured: true, isActive: false })] });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'efatura', saglayicilar: [{ provider: 'UYUMSOFT', label: 'UYUMSOFT' }], neden: expect.stringMatching(/HAZIR DEĞİL: UYUMSOFT entegratör kimliği eksik/) });
    expect(fm.cagrilar.map((c) => c.metot)).toEqual(['listIntegrations']);
  });

  it('bağlı sağlayıcı seçimi ekranla aynı: TÜRMOB öne; TÜRMOB bağlı değilse bağlı olan (ELOGO) seçilir', async () => {
    const fm = fmKur({ entegratorler: [saglayici('ELOGO'), saglayici('TURMOB_EFATURA', { configured: true, isActive: false })] });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r.saglayicilar).toEqual([{ provider: 'ELOGO', label: 'ELOGO' }]);
    expect(r.arkaPlan).toBe(false);
  });

  it('senkron sağlayıcı (UYUMSOFT): syncEfaturaInboxFromIntegrations beklenir, sayılar döner, arkaPlan:false', async () => {
    const fm = fmKur({ entegratorler: [saglayici('UYUMSOFT')] });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(false, 'UYUMSOFT')).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'efatura', arkaPlan: false });
    expect(r.karar).toMatch(/entegratörü yazılı \(UYUMSOFT\)/);
    const s = fm.cagrilar.find((c) => c.metot === 'syncEfaturaInboxFromIntegrations')!;
    expect(s.args[2]).toEqual({ taxpayerId: TP, period: '2026-08', direction: 'IN', channel: 'IN_EFATURA', limit: 2000, providers: ['UYUMSOFT'] });
    expect(r.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', suruyor: false, sonuc: { fetched: 4, added: 3, updated: 1, skipped: 0, failed: 0 } });
    expect(r.mesaj).toMatch(/4 satır geldi, 3 yeni/);
  });

  it('senkron sağlayıcı tavanı aşarsa: suruyor:true döner (çağrı sunucuda sürer); fm_cekim_durum "sorgu suruyor" gösterir, bitti:false', async () => {
    const fm = fmKur({ entegratorler: [saglayici('UYUMSOFT')], syncBekle: true });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    (tool as any).fmCekimSenkronTavanSn = 0.02;
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r).toMatchObject({ ok: true, arkaPlan: false });
    expect(r.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', suruyor: true });
    expect(r.mesaj).toMatch(/sunucuda sürüyor/);
    const d = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(d.bitti).toBe(false);
    expect(d.ayrinti.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', sorgu: 'suruyor' });
    // aynı kanal tekrar başlatılırsa yeni sorgu açılmaz (zatenSuruyor)
    const r2 = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r2.kanallar[0]).toMatchObject({ suruyor: true, zatenSuruyor: true });
    expect(fm.cagrilar.filter((c) => c.metot === 'syncEfaturaInboxFromIntegrations')).toHaveLength(1);
  });

  it('senkron sağlayıcı hata fırlatırsa kanal hata ile döner, koşu düşmez', async () => {
    const fm = fmKur({ entegratorler: [saglayici('UYUMSOFT')] });
    fm.svc.syncEfaturaInboxFromIntegrations = () => Promise.reject(new BadRequestException('Tarih aralığı geçersiz'));
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.neden).toMatch(/Tarih aralığı geçersiz/);
    expect(r.kanallar[0].hata).toMatch(/Tarih aralığı geçersiz/);
  });
});

describe('fm_cekim_baslat — GİB e-Arşiv yolu (e-Fatura mükellefi değil)', () => {
  const runnerKur = () => {
    const wakes: string[] = [];
    return { svc: { wake: (r: string) => { wakes.push(r); return true; } }, wakes };
  };

  it('fetchConfiguredIntegrations {direction:SATIS, providers:[GIB_PORTAL], mode:query} + runner wake; isler döner; alış GİB\'de yok notu', async () => {
    const fm = fmKur();
    const runner = runnerKur();
    const { tool } = aracKur({ prisma: prismaKur(mukellef(false)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, PortalAutomationRailwayRunnerService: runner.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', yon: 'satis', arkaPlan: true, isler: ['job-1'], runnerUyandi: true, saglayicilar: [{ provider: 'GIB_PORTAL', label: 'GİB e-Arşiv Portal' }] });
    expect(r.not).toMatch(/Alış belgeleri GİB e-Arşiv'de yoktur/);
    const f = fm.cagrilar.find((c) => c.metot === 'fetchConfiguredIntegrations')!;
    expect(f.args[0]).toBe('t1');
    expect(f.args[1]).toEqual({ taxpayerId: TP, direction: 'SATIS', donem: '2026-08', providers: ['GIB_PORTAL'], mode: 'query' });
    expect(f.args[2]).toBe('u1');
    expect(runner.wakes).toEqual(['fatura-integrations-fetch']);
    expect(r.mesaj).toMatch(/kuyruğa alındı \(1 iş; sunucu runner uyandırıldı\)/);
    // e-Fatura sorgusu hiç çağrılmadı
    expect(fm.cagrilar.some((c) => /Efatura/.test(c.metot))).toBe(false);
  });

  it('yon:alis → ok:false (GİB e-Arşiv yalnız satış), sorgu açılmaz', async () => {
    const fm = fmKur();
    const { tool } = aracKur({ prisma: prismaKur(mukellef(false)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'earsiv', neden: expect.stringMatching(/yalnız SATIŞ/) });
    expect(fm.cagrilar).toHaveLength(0);
  });

  it('GİB şifresi yok (SKIPPED) → HAZIR DEĞİL neden; runner uyandırılmaz', async () => {
    const fm = fmKur({ fetchSonuc: { ok: true, providers: [{ provider: 'GIB_PORTAL', status: 'SKIPPED', reason: 'Mukellef kartinda GIB vergi dairesi kullanici kodu/sifresi yok' }] } });
    const runner = runnerKur();
    const { tool } = aracKur({ prisma: prismaKur(mukellef(false)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, PortalAutomationRailwayRunnerService: runner.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'earsiv', neden: expect.stringMatching(/^HAZIR DEĞİL: mükellef kartında GİB/), detay: expect.stringMatching(/sifresi yok/) });
    expect(runner.wakes).toEqual([]);
  });

  it('aynı dönem için pending iş varsa mevcutIs:true, yeni iş açılmaz (fetch çağrılmaz)', async () => {
    const fm = fmKur();
    const { prisma } = prismaKur({
      ...mukellef(false),
      portalAutomationJob: { findMany: () => [{ id: 'job-eski', status: 'pending', donem: '2026-08', payload: { donem: '2026-08' }, createdAt: new Date(), updatedAt: new Date() }] },
    });
    const { tool } = aracKur({ prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', mevcutIs: true, isler: ['job-eski'] });
    expect(fm.cagrilar.some((c) => c.metot === 'fetchConfiguredIntegrations')).toBe(false);
  });

  it('aralıklı iş etiketi (YYYY-MM-DD_YYYY-MM-DD) ayı kapsıyorsa mevcut iş sayılır; başka ay sayılmaz', async () => {
    const fm = fmKur();
    const is = (donem: string) => ({ id: 'j', status: 'running', donem, payload: { donem }, createdAt: new Date(), updatedAt: new Date() });
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => [is('2026-08-15_2026-08-20')] } });
    const { tool } = aracKur({ prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    expect((await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx)).mevcutIs).toBe(true);
    expect((await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-07' }, ctx)).mevcutIs).toBeUndefined();
  });

  it('servis BadRequest fırlatırsa {ok:false, neden}; throw yok', async () => {
    const fm = fmKur({ fetchHata: new BadRequestException('Sorgu basarisiz: GIB portal yanit vermedi') });
    const { tool } = aracKur({ prisma: prismaKur(mukellef(false)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_baslat', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'earsiv', neden: expect.stringMatching(/GIB portal yanit vermedi/) });
  });
});

describe('fm_cekim_durum / fm_cekim_bekle', () => {
  const inboxSatiri = (o: { indi?: string; aktarildi?: boolean } = {}) => ({
    id: 'r', faturaNo: 'ABC1', hasAccountingDocument: o.aktarildi === true, documentId: o.aktarildi ? 'doc' : null,
    rawJson: { channel: 'IN_EFATURA', ...(o.indi ? { documentDownloadStatus: o.indi } : {}) }, ublXmlRaw: o.indi === 'READY' ? '<Invoice xmlns="x"/>' : '',
  });

  it('e-Fatura: kanal başına sorgu durumu + gelen/aktarılan/indirme bekleyen; indirme sürerken bitti:false, hepsi bitince bitti:true', async () => {
    let durum: any = { state: 'running', rounds: 2, added: 10, import: { state: 'idle' } };
    let satirlar: any[] = [inboxSatiri({ indi: 'READY', aktarildi: true }), inboxSatiri({ indi: 'PENDING_DOWNLOAD' }), inboxSatiri({ indi: 'MISSING' })];
    const fm = fmKur({ syncStatus: () => durum });
    const es = { listInbox: async (_t: string, o: any) => (o.channel === 'IN_EFATURA' ? satirlar : []) };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, EFaturaSyncService: es } });
    const d1 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(d1).toMatchObject({ ok: true, yol: 'efatura', bitti: false });
    expect(d1.ayrinti.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', sorgu: 'suruyor', tur: 2, eklenen: 10, gelen: 3, aktarilan: 1, indirmeBekleyen: 1, inemedi: 1, aktarim: 'yok' });
    expect(d1.ozet).toMatch(/Alış e-Fatura: sorgu suruyor \(2\. tur\) · gelen 3 · aktarılan 1 · indirme bekleyen 1 · inemedi 1/);
    // sorgu bitti ama indirme sürüyor → hâlâ bitti:false
    durum = { state: 'done', rounds: 3, added: 12, import: { state: 'idle' } };
    expect((await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx)).bitti).toBe(false);
    // indirme de bitti → bitti:true
    satirlar = [inboxSatiri({ indi: 'READY', aktarildi: true }), inboxSatiri({ indi: 'READY' }), inboxSatiri({ indi: 'MISSING' })];
    const d3 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(d3.bitti).toBe(true);
    expect(d3.ayrinti.kanallar[0]).toMatchObject({ sorgu: 'bitti', indirmeBekleyen: 0 });
    // aktarım sürüyor (taze) → bitti:false; 90 sn'den eski → bayat, sayılmaz
    durum = { state: 'done', rounds: 3, added: 12, import: { state: 'running', processed: 2, total: 5, imported: 1, updatedAt: new Date().toISOString() } };
    const d4 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(d4.bitti).toBe(false);
    expect(d4.ayrinti.kanallar[0]).toMatchObject({ aktarim: 'suruyor', aktarimIlerleme: { islenen: 2, toplam: 5, aktarilan: 1 } });
    durum = { state: 'done', import: { state: 'running', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() } };
    expect((await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx)).bitti).toBe(true);
  });

  it('yol parametresi verilirse mükellef kartına bakılmaz: e-Fatura mükellefinde yol:earsiv → GİB iş durumu okunur', async () => {
    const { prisma } = prismaKur({ ...mukellef(true), portalAutomationJob: { findMany: () => [] } });
    const { tool } = aracKur({ prisma, servisler: {} });
    const d = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yol: 'earsiv' }, ctx);
    expect(d).toMatchObject({ ok: true, yol: 'earsiv', bitti: true, isYok: true });
    expect(d.ozet).toMatch(/sorgu işi yok/);
  });

  it('GİB e-Arşiv: iş pending → bitti:false; done + satırlar → bitti:true, sayaçlar (sorgulanan/aktarılabilir/aktarılmış/iptal); failed → hata son satırı', async () => {
    let isler: any[] = [{ id: 'job-1', status: 'pending', donem: '2026-08', payload: { donem: '2026-08', earsivMode: 'query' }, recordCount: 0, createdAt: new Date(), updatedAt: new Date() }];
    const satirlar = [
      { sourceRefId: 'ETTN-1', isProcessable: true, zatenVar: false, aktarimDurumu: 'indirildi' },
      { sourceRefId: 'ETTN-2', isProcessable: true, zatenVar: true, muhasebeBelgeId: 'd2', aktarimDurumu: 'indirildi' },
      { sourceRefId: 'ETTN-3', isProcessable: false, zatenVar: false, aktarimDurumu: 'sorgulandi' },
    ];
    const pa = { listEarsivPortalInvoices: async () => satirlar };
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => isler } });
    const { tool } = aracKur({ prisma, servisler: { PortalAutomationService: pa } });
    const d1 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(d1).toMatchObject({ ok: true, yol: 'earsiv', bitti: false, isYok: false });
    expect(d1.ayrinti.isler[0]).toMatchObject({ id: 'job-1', status: 'pending', mod: 'query', satir: 0 });
    expect(d1.ayrinti.satirlar).toEqual({ sorgulanan: 3, aktarilabilir: 1, aktarilan: 1, iptal: 1, indirilen: 2 });
    isler = [{ ...isler[0], status: 'done', recordCount: 26, finishedAt: new Date() }];
    const d2 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(d2.bitti).toBe(true);
    expect(d2.ozet).toMatch(/GİB e-Arşiv: iş done · 26 satır; sorgulanan 3 · aktarılabilir 1 · aktarılmış 1 · iptal 1/);
    isler = [{ ...isler[0], status: 'failed', errorMessage: 'satır 1\nGIB girisi basarisiz: sifre hatali' }];
    const d3 = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(d3.bitti).toBe(true);
    expect(d3.ayrinti.isler[0].hata).toBe('GIB girisi basarisiz: sifre hatali');
    // başka dönemin işi sayılmaz
    isler = [{ ...isler[0], donem: '2026-07', payload: { donem: '2026-07' }, status: 'running' }];
    expect((await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08' }, ctx))).toMatchObject({ bitti: true, isYok: true });
  });

  it('fm_cekim_bekle: bitene kadar 10 sn uyur (mock), kontrolSayisi + yorum döner; tavan aşılınca "sürüyor" der; iptal sinyali keser', async () => {
    let tur = 0;
    const isler = () => (++tur >= 3 ? [{ id: 'j', status: 'done', donem: '2026-08', payload: { donem: '2026-08' }, recordCount: 5, createdAt: new Date(), updatedAt: new Date() }] : [{ id: 'j', status: 'running', donem: '2026-08', payload: { donem: '2026-08' }, recordCount: 0, createdAt: new Date(), updatedAt: new Date() }]);
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: isler } });
    const { tool, bekle } = aracKur({ prisma, servisler: { PortalAutomationService: { listEarsivPortalInvoices: async () => [] } } });
    const r = await tool.execute('fm_cekim_bekle', { taxpayerId: TP, donem: '2026-08', maxSaniye: 60 }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', bitti: true, kontrolSayisi: 3 });
    expect(bekle).toHaveBeenCalledTimes(2);
    expect(bekle.mock.calls[0][0]).toBe(10_000);
    expect(r.yorum).toMatch(/^Çekim bitti: GİB e-Arşiv: iş done · 5 satır/);
    // tavan: maxSaniye 5 → ilk kontrolden sonra 10 sn sığmaz → tek kontrol, "sürüyor"
    tur = -10;
    const r2 = await tool.execute('fm_cekim_bekle', { taxpayerId: TP, donem: '2026-08', maxSaniye: 5 }, ctx);
    expect(r2).toMatchObject({ bitti: false, kontrolSayisi: 1 });
    expect(r2.yorum).toMatch(/Çekim sürüyor: .* tekrar fm_cekim_bekle çağır/);
    // iptal sinyali
    tur = -10;
    const ac = new AbortController();
    ac.abort();
    const r3 = await tool.execute('fm_cekim_bekle', { taxpayerId: TP, donem: '2026-08' }, { ...ctx, signal: ac.signal });
    expect(r3).toMatchObject({ bitti: false, kontrolSayisi: 1, yorum: expect.stringMatching(/iptal sinyali/) });
    // giriş hatası olduğu gibi döner
    expect(await tool.execute('fm_cekim_bekle', { donem: '2026-08' }, ctx)).toMatchObject({ ok: false, neden: expect.stringMatching(/taxpayerId/) });
  });
});

describe('fm_cekim_aktar', () => {
  it('e-Fatura: kanal başına importEfaturaInboxToAccounting {skipMatching:true, limit:2000}; sayılar toplanır; arkaPlan:false', async () => {
    const fm = fmKur({ importSonuc: (o: any) => (o.channel === 'IN_EFATURA' ? { processed: 5, imported: 4, alreadyQueued: 1, skipped: 0, failed: 1, iptalAtlanan: 0, errors: [{ faturaNo: 'X', message: 'belge inmedi' }] } : { processed: 2, imported: 2, alreadyQueued: 0, skipped: 0, failed: 0, iptalAtlanan: 1, errors: [] }) });
    const es = { listInbox: async () => [] };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, EFaturaSyncService: es } });
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'efatura', arkaPlan: false, aktarilan: 8, kontrolEdilen: 9, zatenVar: 1, hatali: 1, iptalAtlanan: 2 });
    const imps = fm.cagrilar.filter((c) => c.metot === 'importEfaturaInboxToAccounting');
    expect(imps.map((c) => c.args[2].channel)).toEqual(['IN_EFATURA', 'OUT_EFATURA', 'OUT_EARSIV']);
    expect(imps[0].args[2]).toEqual({ taxpayerId: TP, period: '2026-08', direction: 'IN', channel: 'IN_EFATURA', limit: 2000, skipMatching: true });
    expect(imps[0].args[1]).toBe('u1');
    expect(r.kanallar[0]).toMatchObject({ kanal: 'IN_EFATURA', aktarilan: 4, hatali: 1, hatalar: [{ faturaNo: 'X', message: 'belge inmedi' }] });
    expect(r.mesaj).toMatch(/8 fatura Fatura Merkezi'ne aktarıldı .*1 belge inmediği için atlandı, 2 iptal\/red atlandı/);
  });

  it('e-Fatura: belgeler hâlâ iniyorsa (PENDING_DOWNLOAD) ya da sorgu sürüyorsa {ok:false, neden} — aktarım çağrılmaz (ekranda Aktar pasif)', async () => {
    let durum: any = { state: 'done', import: { state: 'idle' } };
    let satirlar: any[] = [{ id: 'r', rawJson: { channel: 'IN_EFATURA', documentDownloadStatus: 'PENDING_DOWNLOAD' } }];
    const fm = fmKur({ syncStatus: () => durum });
    const es = { listInbox: async (_t: string, o: any) => (o.channel === 'IN_EFATURA' ? satirlar : []) };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, EFaturaSyncService: es } });
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r).toMatchObject({ ok: false, yol: 'efatura', neden: expect.stringMatching(/Belgeler hâlâ iniyor \(Alış e-Fatura: 1\)/) });
    satirlar = [];
    durum = { state: 'running', import: { state: 'idle' } };
    const r2 = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r2).toMatchObject({ ok: false, neden: expect.stringMatching(/Sorgu hâlâ sürüyor/) });
    expect(fm.cagrilar.some((c) => c.metot === 'importEfaturaInboxToAccounting')).toBe(false);
  });

  it('e-Fatura: aktarım tavanı aşarsa arkaPlan:true "sürüyor" döner; fm_cekim_durum aktarım suruyor gösterir, bitti:false', async () => {
    const fm = fmKur();
    fm.svc.importEfaturaInboxToAccounting = () => new Promise(() => undefined);
    const es = { listInbox: async () => [] };
    const { tool } = aracKur({ prisma: prismaKur(mukellef(true)).prisma, servisler: { FaturaMuhasebelestirmeService: fm.svc, EFaturaSyncService: es } });
    (tool as any).fmCekimSenkronTavanSn = 0.02;
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'efatura', arkaPlan: true, suruyor: true, aktarilan: 0 });
    expect(r.mesaj).toMatch(/Aktarım sürüyor/);
    const d = await tool.execute('fm_cekim_durum', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(d.bitti).toBe(false);
    expect(d.ayrinti.kanallar[0].aktarim).toBe('suruyor');
    // ikinci aktar çağrısı: "zaten sürüyor"
    const r2 = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(r2).toMatchObject({ ok: false, neden: expect.stringMatching(/Aktarım zaten sürüyor/) });
  });

  it('GİB e-Arşiv: aktarılabilir satırlar selectedRefs ile syncEarsivPortalDocumentsToAccounting; sayılar döner', async () => {
    const satirlar = [
      { sourceRefId: 'ETTN-1', isProcessable: true, zatenVar: false },
      { sourceRefId: 'ETTN-2', isProcessable: true, zatenVar: true, muhasebeBelgeId: 'd2' },
      { sourceRefId: 'ETTN-3', isProcessable: false },
      { sourceRefId: 'ETTN-4', isProcessable: true, zatenVar: false },
    ];
    const cagrilar: any[] = [];
    const pa = {
      listEarsivPortalInvoices: async () => satirlar,
      syncEarsivPortalDocumentsToAccounting: async (t: string, o: any) => { cagrilar.push({ t, o }); return { processed: 2, imported: 2, skipped: 1, totalPortalDocuments: 3 }; },
    };
    const fm = fmKur();
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => [] } });
    const { tool } = aracKur({ prisma, servisler: { PortalAutomationService: pa, FaturaMuhasebelestirmeService: fm.svc } });
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', aktarilan: 2, kontrolEdilen: 2, atlanan: 1, zatenVar: 1, iptal: 1, toplamSatir: 4 });
    expect(cagrilar).toEqual([{ t: 't1', o: { taxpayerId: TP, period: '2026-08', selectedRefs: ['ETTN-1', 'ETTN-4'] } }]);
    expect(r.mesaj).toMatch(/2 fatura bekleyen satışa aktarıldı/);
    expect(fm.cagrilar).toHaveLength(0); // indirme yedeği gerekmedi
  });

  it('GİB e-Arşiv: belgeler inmemiş (0/0) → ekranla aynı yedek: mode:download + selectedRefs işi kuyruğa, indirmeKuyrukta:true, wake', async () => {
    const pa = {
      listEarsivPortalInvoices: async () => [{ sourceRefId: 'ETTN-1', isProcessable: true, zatenVar: false }],
      syncEarsivPortalDocumentsToAccounting: async () => ({ processed: 0, imported: 0, skipped: 0, totalPortalDocuments: 0 }),
    };
    const fm = fmKur({ fetchSonuc: { ok: true, providers: [{ provider: 'GIB_PORTAL', status: 'QUEUED_GIB_PORTAL', queued: 1, jobs: [{ id: 'job-dl' }] }] } });
    const wakes: string[] = [];
    const runner = { wake: (r: string) => { wakes.push(r); return true; } };
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => [] } });
    const { tool } = aracKur({ prisma, servisler: { PortalAutomationService: pa, FaturaMuhasebelestirmeService: fm.svc, PortalAutomationRailwayRunnerService: runner } });
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', aktarilan: 0, indirmeKuyrukta: true, isler: ['job-dl'], runnerUyandi: true });
    const f = fm.cagrilar.find((c) => c.metot === 'fetchConfiguredIntegrations')!;
    expect(f.args[1]).toEqual({ taxpayerId: TP, direction: 'SATIS', donem: '2026-08', providers: ['GIB_PORTAL'], mode: 'download', selectedRefs: ['ETTN-1'] });
    expect(wakes).toEqual(['fatura-integrations-fetch']);
    expect(r.mesaj).toMatch(/indirme işi kuyruğa alındı .*fm_cekim_bekle → bitti:true → fm_cekim_aktar tekrar/);
  });

  it('GİB e-Arşiv: aktarılacak satır yok → aktarilan:0 açıklamalı; sorgu sürüyorsa {ok:false, neden}', async () => {
    const pa = { listEarsivPortalInvoices: async () => [{ sourceRefId: 'E1', isProcessable: true, zatenVar: true }], syncEarsivPortalDocumentsToAccounting: async () => { throw new Error('çağrılmamalı'); } };
    let isler: any[] = [];
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => isler } });
    const { tool } = aracKur({ prisma, servisler: { PortalAutomationService: pa } });
    const r = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r).toMatchObject({ ok: true, yol: 'earsiv', aktarilan: 0, kontrolEdilen: 1, zatenVar: 1, iptal: 0 });
    expect(r.mesaj).toMatch(/Aktarılacak yeni belge yok/);
    isler = [{ id: 'j', status: 'running', donem: '2026-08', payload: { donem: '2026-08' }, createdAt: new Date(), updatedAt: new Date() }];
    const r2 = await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r2).toMatchObject({ ok: false, neden: expect.stringMatching(/sorgusu hâlâ sürüyor \(j, running\)/) });
  });

  it('servis fırlatırsa {ok:false, neden}; throw yok', async () => {
    const pa = { listEarsivPortalInvoices: async () => [{ sourceRefId: 'E1', isProcessable: true }], syncEarsivPortalDocumentsToAccounting: async () => { throw new BadRequestException('depo erişilemedi'); } };
    const { prisma } = prismaKur({ ...mukellef(false), portalAutomationJob: { findMany: () => [] } });
    const { tool } = aracKur({ prisma, servisler: { PortalAutomationService: pa } });
    expect(await tool.execute('fm_cekim_aktar', { taxpayerId: TP, donem: '2026-08' }, ctx)).toMatchObject({ ok: false, yol: 'earsiv', neden: expect.stringMatching(/depo erişilemedi/) });
  });
});
