/**
 * BelgeKuyrukService — kalıcı belge kuyruğu (2026-09-13), sahte Prisma + sahte FaturaMuhasebelestirmeService.
 *  - idempotent ekleme + öncelik yükseltme (PENDING varsa ekleme, RUNNING varsa dokunma)
 *  - bayat kilit kurtarma (15 dk; attempts ≥ 3 → FAILED)
 *  - parti seçimi: aynı mükelleften ≤ MAX_CLASSIFY_BATCH, aynı anda başlatılır (kuyrukIsle tek çağrı)
 *  - kapasite sınırı: okuma ≤ FM_KUYRUK_OKUMA_ESZAMANLI, parti ≤ FM_KUYRUK_SINIF_PARTI_ESZAMANLI
 *  - DONE/FAILED yazımı + okuma sonrası CLASSIFY (priority 3) + iptal edilen belge okunmaz
 *  - gece seçimi: okunmamış→AI_READ (planlı mükellef), sınıflanmamış→CLASSIFY, tavan, env kapısı, AuditLog GECE_KUYRUK
 */
jest.mock('./fatura-muhasebelestirme.service', () => ({ FaturaMuhasebelestirmeService: class FaturaMuhasebelestirmeService {} }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

import { BelgeKuyrukService, MAX_DENEME, BAYAT_KILIT_MS, geceKuyrukEnvKapaliMi, kuyrukAyarlari, GECE_TAVAN } from './belge-kuyruk.service';

// ── mini sahte prisma (bellek-içi tablo + basit where/orderBy/take) ──
function esles(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where || {})) {
    if (k === 'OR') { if (!(v as any[]).some((w) => esles(row, w))) return false; continue; }
    const val = row[k];
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      const o: any = v;
      if ('in' in o && !o.in.includes(val)) return false;
      if ('notIn' in o && o.notIn.includes(val)) return false;
      if ('lt' in o && !(val != null && val < o.lt)) return false;
      if ('gte' in o && !(val != null && val >= o.gte)) return false;
      if ('not' in o && val === o.not) return false;
    } else if (val !== v) return false;
  }
  return true;
}
function sirala(rows: any[], orderBy: any) {
  const ob = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of ob) {
      const [k, dir] = Object.entries(o)[0] as [string, string];
      const x = a[k]; const y = b[k];
      if (x === y) continue;
      const c = x > y ? 1 : -1;
      return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}
function tablo(rows: any[]) {
  let seq = 0;
  const uygula = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any)) row[k] = (row[k] || 0) + (v as any).increment;
      else row[k] = v;
    }
  };
  return {
    rows,
    findMany: async (q: any = {}) => { let r = rows.filter((x) => esles(x, q.where)); r = sirala(r, q.orderBy); if (q.take) r = r.slice(0, q.take); return r.map((x) => ({ ...x })); },
    findFirst: async (q: any = {}) => { const r = sirala(rows.filter((x) => esles(x, q.where)), q.orderBy); return r[0] ? { ...r[0] } : null; },
    count: async (q: any = {}) => rows.filter((x) => esles(x, q.where)).length,
    createMany: async (q: any) => { for (const d of q.data) rows.push({ id: `j${++seq}`, attempts: 0, lastError: null, lockedBy: null, lockedAt: null, startedAt: null, finishedAt: null, createdAt: new Date(Date.now() + seq), ...d }); return { count: q.data.length }; },
    updateMany: async (q: any) => { const r = rows.filter((x) => esles(x, q.where)); for (const row of r) uygula(row, q.data); return { count: r.length }; },
    groupBy: async (q: any) => { const s = new Set(rows.filter((x) => esles(x, q.where)).map((x) => x.tenantId)); return [...s].map((tenantId) => ({ tenantId })); },
  };
}

function kur(opts: { docs?: any[]; planlar?: any[]; isle?: (kind: string, tenantId: string, ids: string[]) => Promise<any[]> } = {}) {
  const jobs = tablo([]);
  const docs = tablo(opts.docs || []);
  const planlar = tablo(opts.planlar || []);
  const audit: any[] = [];
  const prisma: any = {
    invoiceProcessingJob: jobs,
    invoiceAccountingDocument: docs,
    lucaAccountPlanSnapshot: planlar,
    auditLog: { create: async (q: any) => { audit.push(q.data); return q.data; } },
  };
  const cagrilar: Array<{ kind: string; tenantId: string; ids: string[] }> = [];
  const fm: any = {
    bagli: null,
    kuyrukBagla(k: any) { this.bagli = k; },
    kuyrukIsle: async (kind: string, tenantId: string, ids: string[]) => {
      cagrilar.push({ kind, tenantId, ids });
      if (opts.isle) return opts.isle(kind, tenantId, ids);
      return ids.map((documentId) => ({ documentId, ok: true }));
    },
  };
  const svc = new BelgeKuyrukService(prisma, fm);
  return { svc, jobs, docs, audit, cagrilar, fm };
}
const g = (documentId: string, kind: 'CLASSIFY' | 'AI_READ' = 'CLASSIFY', priority = 0, taxpayerId = 'tp1') => ({ tenantId: 't1', taxpayerId, documentId, kind, priority });
const bekle = () => new Promise((r) => setImmediate(r));

describe('BelgeKuyrukService', () => {
  const envYedek = { ...process.env };
  afterEach(() => { process.env = { ...envYedek }; });

  it('onModuleInit fatura servisine bağlanır', () => {
    const { svc, fm } = kur();
    svc.onModuleInit();
    expect(fm.bagli).toBe(svc);
  });

  it('açılış kurtarması: önceki süreçte RUNNING kalan işler PENDING olur; kendi kilidi ve açılış sonrası kilitler dokunulmaz', async () => {
    const { svc, jobs } = kur();
    const boot = new Date();
    const eski = new Date(boot.getTime() - 60_000);
    const yeniKilit = new Date(boot.getTime() + 1_000);
    jobs.rows.push(
      { id: 'r1', status: 'RUNNING', lockedBy: 'olu-surec:1', lockedAt: eski, attempts: 1, kind: 'CLASSIFY' },
      { id: 'r2', status: 'RUNNING', lockedBy: svc.instanceId, lockedAt: eski, attempts: 0, kind: 'CLASSIFY' },
      { id: 'r3', status: 'RUNNING', lockedBy: 'baska:2', lockedAt: yeniKilit, attempts: 0, kind: 'AI_READ' },
      { id: 'r4', status: 'DONE', lockedBy: 'olu-surec:1', lockedAt: eski, attempts: 0, kind: 'CLASSIFY' },
    );
    expect(await svc.acilisKurtar(boot)).toBe(1);
    const r1 = jobs.rows.find((r: any) => r.id === 'r1');
    expect(r1.status).toBe('PENDING');
    expect(r1.lockedBy).toBeNull();
    expect(r1.attempts).toBe(1); // deneme sayısı artmaz
    expect(String(r1.lastError)).toContain('deploy');
    expect(jobs.rows.find((r: any) => r.id === 'r2').status).toBe('RUNNING');
    expect(jobs.rows.find((r: any) => r.id === 'r3').status).toBe('RUNNING');
    expect(jobs.rows.find((r: any) => r.id === 'r4').status).toBe('DONE');
  });
  it('idempotent ekleme + öncelik yükseltme', async () => {
    const { svc, jobs } = kur();
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 0))).toEqual({ eklendi: true, yukseltildi: false });
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 0))).toEqual({ eklendi: false, yukseltildi: false });
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 10))).toEqual({ eklendi: false, yukseltildi: true });
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 5))).toEqual({ eklendi: false, yukseltildi: false }); // düşük öncelik düşürmez
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0].priority).toBe(10);
    // Aynı belge farklı kind → ayrı iş
    expect(await svc.kuyrugaAl(g('d1', 'AI_READ', 0))).toEqual({ eklendi: true, yukseltildi: false });
    // RUNNING ise dokunulmaz
    jobs.rows[0].status = 'RUNNING';
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 10))).toEqual({ eklendi: false, yukseltildi: false });
    // DONE ise yeniden eklenir
    jobs.rows[0].status = 'DONE';
    expect(await svc.kuyrugaAl(g('d1', 'CLASSIFY', 3))).toEqual({ eklendi: true, yukseltildi: false });
    // toplu: aynı istekte tekrar eden belge tekilleşir, sayaçlar
    const r = await svc.topluKuyrugaAl([g('d2'), g('d2', 'CLASSIFY', 5), g('d3'), g('d3', 'CLASSIFY', 0)]);
    expect(r.eklenen).toBe(2);
    expect(jobs.rows.find((x) => x.documentId === 'd2')!.priority).toBe(5);
    expect(r.bekleyen).toBe(4);
  });

  it('bayat RUNNING kilit → PENDING attempts+1; attempts ≥ 3 → FAILED', async () => {
    const { svc, jobs } = kur();
    const now = new Date('2026-09-13T03:00:00Z');
    const eski = new Date(now.getTime() - BAYAT_KILIT_MS - 1000);
    const taze = new Date(now.getTime() - 60 * 1000);
    jobs.rows.push({ id: 'a', tenantId: 't1', documentId: 'd1', kind: 'CLASSIFY', status: 'RUNNING', attempts: 0, lockedAt: eski, lockedBy: 'x' });
    jobs.rows.push({ id: 'b', tenantId: 't1', documentId: 'd2', kind: 'CLASSIFY', status: 'RUNNING', attempts: MAX_DENEME - 1, lockedAt: eski, lockedBy: 'x' });
    jobs.rows.push({ id: 'c', tenantId: 't1', documentId: 'd3', kind: 'AI_READ', status: 'RUNNING', attempts: 0, lockedAt: taze, lockedBy: 'x' });
    expect(await svc.bayatKilitleriKurtar(now)).toBe(2);
    expect(jobs.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lockedBy: null, lockedAt: null });
    expect(jobs.rows[1]).toMatchObject({ status: 'FAILED', attempts: MAX_DENEME });
    expect(jobs.rows[1].lastError).toMatch(/bayat/);
    expect(jobs.rows[2].status).toBe('RUNNING'); // taze kilit dokunulmaz
  });

  it('parti seçimi: aynı mükelleften ≤ MAX_CLASSIFY_BATCH, en yüksek öncelik önce, tek kuyrukIsle çağrısı', async () => {
    process.env.MAX_CLASSIFY_BATCH = '3';
    process.env.FM_KUYRUK_SINIF_PARTI_ESZAMANLI = '1';
    const { svc, jobs, cagrilar } = kur();
    await svc.topluKuyrugaAl([g('a1', 'CLASSIFY', 0, 'tpA'), g('a2', 'CLASSIFY', 0, 'tpA'), g('a3', 'CLASSIFY', 0, 'tpA'), g('a4', 'CLASSIFY', 0, 'tpA'), g('b1', 'CLASSIFY', 10, 'tpB'), g('b2', 'CLASSIFY', 0, 'tpB')]);
    const t = await svc.tik();
    expect(t.baslatilanParti).toBe(1);
    await bekle(); await bekle();
    // Öncelik 10'lu b1'in mükellefi (tpB) seçilir; aynı mükelleften b2 de partiye girer (≤3)
    expect(cagrilar).toHaveLength(1);
    expect(cagrilar[0].kind).toBe('CLASSIFY');
    expect([...cagrilar[0].ids].sort()).toEqual(['b1', 'b2']);
    expect(jobs.rows.filter((x) => x.status === 'DONE').map((x) => x.documentId).sort()).toEqual(['b1', 'b2']);
    // İkinci tik: tpA'dan en çok 3
    await svc.tik();
    await bekle(); await bekle();
    expect(cagrilar).toHaveLength(2);
    expect(cagrilar[1].ids).toHaveLength(3);
    expect(cagrilar[1].ids.every((id) => id.startsWith('a'))).toBe(true);
    // Üçüncü tik: kalan 1
    await svc.tik();
    await bekle(); await bekle();
    expect(cagrilar[2].ids).toEqual(['a4']);
    expect(jobs.rows.every((x) => x.status === 'DONE' && x.lockedBy === null && x.finishedAt)).toBe(true);
  });

  it('kapasite sınırı: okuma ≤ FM_KUYRUK_OKUMA_ESZAMANLI, parti ≤ FM_KUYRUK_SINIF_PARTI_ESZAMANLI; RUNNING lockedBy=instance', async () => {
    process.env.FM_KUYRUK_OKUMA_ESZAMANLI = '2';
    process.env.FM_KUYRUK_SINIF_PARTI_ESZAMANLI = '1';
    process.env.MAX_CLASSIFY_BATCH = '10';
    let serbest!: () => void;
    const kilit = new Promise<void>((r) => { serbest = r; });
    const { svc, jobs, cagrilar } = kur({
      docs: [{ id: 'r1', tenantId: 't1', ocrStatus: 'PENDING', status: 'NEEDS_REVIEW' }, { id: 'r2', tenantId: 't1', ocrStatus: 'PENDING', status: 'NEEDS_REVIEW' }, { id: 'r3', tenantId: 't1', ocrStatus: 'PENDING', status: 'NEEDS_REVIEW' }],
      isle: async (_k, _t, ids) => { await kilit; return ids.map((documentId) => ({ documentId, ok: true })); },
    });
    await svc.topluKuyrugaAl([g('r1', 'AI_READ', 10), g('r2', 'AI_READ', 0), g('r3', 'AI_READ', 0), g('c1', 'CLASSIFY', 0, 'tpA'), g('c2', 'CLASSIFY', 0, 'tpB')]);
    const t = await svc.tik();
    expect(t).toMatchObject({ baslatilanOkuma: 2, baslatilanParti: 1 });
    expect(svc.aktifOkuma).toBe(2);
    expect(svc.aktifParti).toBe(1);
    const running = jobs.rows.filter((x) => x.status === 'RUNNING');
    expect(running).toHaveLength(3);
    expect(running.every((x) => x.lockedBy === svc.instanceId && x.lockedAt && x.startedAt)).toBe(true);
    // r1 (öncelik 10) ilk okunan
    expect(cagrilar.filter((c) => c.kind === 'AI_READ').map((c) => c.ids[0])).toContain('r1');
    // Dolu kapasitede ikinci tik yeni iş başlatmaz
    const t2 = await svc.tik();
    expect(t2).toMatchObject({ baslatilanOkuma: 0, baslatilanParti: 0 });
    serbest();
    await bekle(); await bekle(); await bekle();
    expect(svc.aktifOkuma).toBe(0);
    expect(svc.aktifParti).toBe(0);
    // Boşalınca kalan r3 + c2 alınır
    const t3 = await svc.tik();
    expect(t3).toMatchObject({ baslatilanOkuma: 1, baslatilanParti: 1 });
    await bekle(); await bekle();
    expect(jobs.rows.filter((x) => x.status === 'DONE')).toHaveLength(5);
  });

  it('hata → FAILED (300 kr) ; iptal edilen belge okunmaz; okuma sonrası sınıflanmamış → CLASSIFY priority 3', async () => {
    process.env.FM_KUYRUK_OKUMA_ESZAMANLI = '4';
    const uzunHata = 'x'.repeat(500);
    const { svc, jobs } = kur({
      docs: [
        { id: 'ok1', tenantId: 't1', taxpayerId: 'tp1', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'lastik' }] } },
        { id: 'sinifli', tenantId: 't1', taxpayerId: 'tp1', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'lastik' }], giderTuru: 'ARAÇ BAKIM' } },
        { id: 'hata1', tenantId: 't1', taxpayerId: 'tp1', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', ocrStatus: 'FAILED', ocrData: {} },
        { id: 'iptal1', tenantId: 't1', taxpayerId: 'tp1', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', ocrStatus: 'CANCELLED', ocrData: {} },
      ],
      isle: async (_k, _t, ids) => ids.map((documentId) => documentId === 'hata1' ? { documentId, ok: false, hata: uzunHata } : { documentId, ok: true }),
    });
    await svc.topluKuyrugaAl([g('ok1', 'AI_READ'), g('sinifli', 'AI_READ'), g('hata1', 'AI_READ'), g('iptal1', 'AI_READ')]);
    await svc.tik();
    await bekle(); await bekle(); await bekle();
    const by = (d: string, k = 'AI_READ') => jobs.rows.find((x) => x.documentId === d && x.kind === k)!;
    expect(by('ok1').status).toBe('DONE');
    expect(by('sinifli').status).toBe('DONE');
    expect(by('hata1').status).toBe('FAILED');
    expect(by('hata1').lastError).toHaveLength(300);
    expect(by('hata1').attempts).toBe(1);
    expect(by('iptal1').status).toBe('DONE');
    expect(by('iptal1').lastError).toMatch(/iptal/);
    // okuma sonrası: ok1 sınıflanmamış → CLASSIFY priority 3; sinifli → yok
    expect(by('ok1', 'CLASSIFY')).toMatchObject({ priority: 3 });
    expect(['PENDING', 'DONE']).toContain(by('ok1', 'CLASSIFY').status); // aynı tikte parti döngüsü onu alıp işlemiş olabilir
    expect(jobs.rows.find((x) => x.documentId === 'sinifli' && x.kind === 'CLASSIFY')).toBeUndefined();
    expect(jobs.rows.find((x) => x.documentId === 'hata1' && x.kind === 'CLASSIFY')).toBeUndefined(); // hatalı okuma sınıfa gitmez
    // tekrar-dene
    const r = await svc.tekrarDene('t1', { ids: [by('hata1').id] });
    expect(r.tekrarDenenen).toBe(1);
    expect(by('hata1')).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
    expect((await svc.tekrarDene('t1', {})).ok).toBe(false); // ids/hepsi yoksa reddet
    // durum
    const d = await svc.durum('t1');
    expect(d.pending.AI_READ).toBe(1);
    expect(d.done24h).toBeGreaterThanOrEqual(3);
    expect(d.running).toBe(0);
    expect(d.sonHata).toHaveLength(0); // tekrar-dene sonrası FAILED kalmadı
  });

  it('gece seçimi: okunmamış→AI_READ (yalnız planlı mükellef), sınıflanmamış ALIŞ→CLASSIFY, priority 5, tavan, AuditLog', async () => {
    const docs: any[] = [
      // okunmamış + planlı → AI_READ
      { id: 'o1', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: {}, createdAt: new Date(1) },
      // okunmamış + plansız → atlanır
      { id: 'o2', tenantId: 't1', taxpayerId: 'tpX', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: {}, createdAt: new Date(2) },
      // okunmuş, sınıflanmamış ALIŞ → CLASSIFY
      { id: 's1', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }] }, createdAt: new Date(3) },
      // okunmuş, sınıflı → hiçbir şey
      { id: 's2', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }], kategori: 'SARF' }, createdAt: new Date(4) },
      // SATIŞ sınıflanmamış → gece almaz
      { id: 's3', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'SATIS', status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }] }, createdAt: new Date(5) },
      // Luca'ya gitmiş → almaz
      { id: 'l1', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'POSTED', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }] }, createdAt: new Date(6) },
      // onaylı → almaz
      { id: 'ap', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'APPROVED', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: {}, createdAt: new Date(7) },
      // okunması FAILED → almaz
      { id: 'f1', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED', ocrStatus: 'FAILED', ocrData: {}, createdAt: new Date(8) },
    ];
    const { svc, jobs, audit } = kur({ docs, planlar: [{ tenantId: 't1', taxpayerId: 'tpP', status: 'READY' }, { tenantId: 't1', taxpayerId: 'tpX', status: 'FAILED' }] });
    const r = await svc.geceKuyrukla(new Date('2026-09-13T00:45:00Z'));
    expect(r).toEqual([{ tenantId: 't1', okuma: 1, sinif: 1, atlanan: 1 }]);
    const by = (d: string) => jobs.rows.find((x) => x.documentId === d);
    expect(by('o1')).toMatchObject({ kind: 'AI_READ', priority: 5, status: 'PENDING' });
    expect(by('s1')).toMatchObject({ kind: 'CLASSIFY', priority: 5, status: 'PENDING' });
    expect(jobs.rows).toHaveLength(2);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'GECE_KUYRUK', resource: 'belge-kuyruk', tenantId: 't1' });
    expect(audit[0].newData).toMatchObject({ okuma: 1, sinif: 1, eklenen: 2 });
    // İkinci gece: idempotent (zaten PENDING) → eklenen 0
    const r2 = await svc.geceKuyruklaTenant('t1', new Date('2026-09-14T00:45:00Z'));
    expect(r2).toMatchObject({ okuma: 1, sinif: 1 });
    expect(jobs.rows).toHaveLength(2);
    // Son 72 saatte FAILED olan belge gece tekrar alınmaz
    const o1 = by('o1')!; o1.status = 'FAILED'; o1.finishedAt = new Date('2026-09-13T20:00:00Z');
    const r3 = await svc.geceKuyruklaTenant('t1', new Date('2026-09-14T00:45:00Z'));
    expect(r3.okuma).toBe(0);
    // özet metni
    const oz = await svc.geceKuyrukOzeti('t1');
    expect(oz.metin).toMatch(/Belge kuyruğu/);
  });

  it('gece tavanı 400/tenant', async () => {
    const docs = Array.from({ length: GECE_TAVAN + 50 }, (_, i) => ({ id: `d${i}`, tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }] }, createdAt: new Date(i) }));
    const { svc, jobs } = kur({ docs, planlar: [{ tenantId: 't1', taxpayerId: 'tpP', status: 'READY' }] });
    const r = await svc.geceKuyruklaTenant('t1');
    expect(r.sinif).toBe(GECE_TAVAN);
    expect(r.atlanan).toBe(50);
    expect(jobs.rows).toHaveLength(GECE_TAVAN);
  });

  it('env: FM_GECE_KUYRUK kapısı + kuyruk ayarları', () => {
    expect(geceKuyrukEnvKapaliMi(undefined)).toBe(false);
    expect(geceKuyrukEnvKapaliMi('on')).toBe(false);
    expect(geceKuyrukEnvKapaliMi('1')).toBe(false);
    expect(geceKuyrukEnvKapaliMi('off')).toBe(true);
    expect(geceKuyrukEnvKapaliMi('0')).toBe(true);
    expect(geceKuyrukEnvKapaliMi('KAPALI')).toBe(true);
    expect(kuyrukAyarlari({} as any)).toEqual({ okumaEszamanli: 4, sinifPartiEszamanli: 2, partiBoyu: 10 });
    expect(kuyrukAyarlari({ FM_KUYRUK_OKUMA_ESZAMANLI: '0', FM_KUYRUK_SINIF_PARTI_ESZAMANLI: 'abc', MAX_CLASSIFY_BATCH: '6' } as any)).toEqual({ okumaEszamanli: 1, sinifPartiEszamanli: 2, partiBoyu: 6 });
  });

  it('geceTik env kapalıyken hiçbir şey kuyruklamaz', async () => {
    process.env.FM_GECE_KUYRUK = 'off';
    const docs = [{ id: 'o1', tenantId: 't1', taxpayerId: 'tpP', invoiceKind: 'ALIS', status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED', ocrStatus: 'SUCCESS', ocrData: {} }];
    const { svc, jobs } = kur({ docs, planlar: [{ tenantId: 't1', taxpayerId: 'tpP', status: 'READY' }] });
    await svc.geceTik();
    expect(jobs.rows).toHaveLength(0);
  });
});
