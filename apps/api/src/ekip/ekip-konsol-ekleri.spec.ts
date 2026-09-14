/**
 * Operasyon konsolu backend ekleri (PLAN/14-EKIP-EKRANI-OPERASYON-KONSOLU.md §7) kilit testleri:
 *  1) pano 60 sn tenant önbelleği — eşzamanlı iki istek TEK üretim, yenile=true önbelleği atlar
 *  2) /ekip/durum ekleri — sonSabahOzeti raporun ilk anlamlı satırını verir
 *  3) kadro → sonKosu / bekleyenOnay / bugunKosu / calisiyor
 *  4) /ekip/isler süzgeçleri — where koşulu ve {isler, toplam, suzgec} şekli
 *  7) onay özeti mukellefAd — taxpayerId ve telefon (rehber) çözümü
 *  8) KoordinatorService sabah özeti (PLAN/19 H1/H2, 2026-09-14): gönderim kapısı, kiracı seçimi, görev metni, rapor süzgeci
 * Prisma/araçlar sahte; ağ/DB yok.
 */
import { EkipRunnerService } from './ekip-runner.service';
import { EkipOnayService } from './ekip-onay.service';
import { KoordinatorService } from './koordinator.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runnerKur(prisma: any, tools?: any): EkipRunnerService {
  return new EkipRunnerService(prisma, tools || ({} as any), {} as any, {} as any, {} as any);
}

describe('pano önbelleği (§7-1)', () => {
  it('eşzamanlı iki istek tek üretim paylaşır; 60 sn içinde ikinci istek önbellekten; yenile atlar', async () => {
    let cagri = 0;
    const tools = {
      execute: async () => {
        cagri++;
        await bekle(5);
        return { mukellefler: [{ id: 't1', isim: 'FAMCOFFEE', kayitVar: true, evraklarGeldi: true }] };
      },
    };
    const r = runnerKur({}, tools);
    const [a, b] = await Promise.all([r.pano('t', 2), r.pano('t', 2)]);
    expect(cagri).toBe(2); // 2 dönem × 1 üretim — ikinci istek yeni üretim başlatmadı
    expect(a.onbellek.vurdu).toBe(false);
    expect(b.onbellek.vurdu).toBe(true);
    expect(a.donemler).toHaveLength(2);
    expect(a.donemler[0].mukellefler[0].ad).toBe('FAMCOFFEE');

    const c = await r.pano('t', 2);
    expect(c.onbellek.vurdu).toBe(true);
    expect(cagri).toBe(2);

    const d = await r.pano('t', 2, true);
    expect(d.onbellek.vurdu).toBe(false);
    expect(cagri).toBe(4);

    // Farklı tenant / dönem sayısı ayrı anahtar
    await r.pano('baska', 2);
    expect(cagri).toBe(6);
  });

  it('üretim hata verirse önbelleğe girmez; sonraki istek yeniden dener', async () => {
    let ilk = true;
    const tools = {
      execute: async () => {
        if (ilk) {
          ilk = false;
          throw new Error('araç patladı');
        }
        return { mukellefler: [] };
      },
    };
    const r = runnerKur({}, tools);
    // pano() içindeki tools.execute .catch ile hata satırı üretir — panoUret kendisi atmaz; yine de vurdu=false bekleriz
    const a = await r.pano('t', 1);
    expect(a.donemler[0].hata).toBe('araç patladı');
    expect(a.onbellek.vurdu).toBe(false);
  });
});

describe('sonSabahOzeti + raporIlkSatir (§7-2)', () => {
  it('RAPOR: sonrası ilk anlamlı satırı verir; ÖĞRENDİM/SORU satırlarını atlar', () => {
    const ilk = (m: any) => (EkipRunnerService.prototype as any).raporIlkSatir.call({}, m);
    expect(ilk('Araçları çağırdım.\nRAPOR:\n\n**Günaydın.** Bugün 3 beyanname hazır.\n• ikinci')).toBe('Günaydın. Bugün 3 beyanname hazır.');
    expect(ilk('RAPOR: tek satır özet')).toBe('tek satır özet');
    expect(ilk('ÖĞRENDİM: bir şey\nSORU: neden?\nasıl satır')).toBe('asıl satır');
    expect(ilk('')).toBeNull();
    expect(ilk(null)).toBeNull();
  });

  it('koordinatör + kaynak=cron son kaydını {isId, createdAt, raporIlkSatir} şeklinde döner; yoksa null', async () => {
    const kayit = { id: 'is1', createdAt: new Date('2026-09-12T05:31:00Z'), finishedAt: null, status: 'done', result: { rapor: 'RAPOR:\nGünaydın. 2 onay bekliyor.' } };
    let sonWhere: any = null;
    const prisma = { agentCommand: { findFirst: async (q: any) => ((sonWhere = q.where), kayit) } };
    const r = runnerKur(prisma);
    const s = await r.sonSabahOzeti('t');
    expect(s).toEqual(expect.objectContaining({ isId: 'is1', status: 'done', raporIlkSatir: 'Günaydın. 2 onay bekliyor.', hata: null }));
    expect(sonWhere.agent).toBe('ekip:koordinator');
    expect(sonWhere.payload).toEqual({ path: ['kaynak'], equals: 'cron' });

    const bos = runnerKur({ agentCommand: { findFirst: async () => null } });
    expect(await bos.sonSabahOzeti('t')).toBeNull();
  });

  it('calisan / bugunHata sayaçları doğru where ile count çağırır', async () => {
    const wherler: any[] = [];
    const prisma = { agentCommand: { count: async (q: any) => (wherler.push(q.where), 4) } };
    const r = runnerKur(prisma);
    expect(await r.calisanSayisi('t')).toBe(4);
    expect(await r.bugunHataSayisi('t')).toBe(4);
    expect(wherler[0]).toEqual({ tenantId: 't', agent: { startsWith: 'ekip:' }, status: 'running' });
    expect(wherler[1].status).toBe('failed');
    expect(wherler[1].createdAt.gte).toBeInstanceOf(Date);
  });
});

describe('kadroOzeti tenant alanları (§7-3)', () => {
  it('sonKosu isOzeti şeklinde, bekleyenOnay/bugunKosu/calisiyor ajan bazında; tenant yoksa boş', async () => {
    const son = {
      id: 'is9',
      agent: 'ekip:fatura',
      action: 'Faturaları oku',
      payload: { gorev: 'Faturaları oku', dryRun: true, kaynak: 'portal', taxpayerId: 'tx1' },
      status: 'running',
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      result: null,
    };
    const prisma = {
      agentCommand: {
        findMany: async (q: any) => (expect(q.distinct).toEqual(['agent']), [son]),
        groupBy: async (q: any) => {
          if (q.where.status === 'running') return [{ agent: 'ekip:fatura', _count: { _all: 1 } }];
          return [{ agent: 'ekip:fatura', _count: { _all: 3 } }, { agent: 'ekip:denetci', _count: { _all: 1 } }];
        },
      },
      ownerApprovalRequest: {
        groupBy: async () => [{ agent: 'ekip:denetci', _count: { _all: 2 } }],
      },
    };
    const r = runnerKur(prisma);
    const kadro = await r.kadroOzeti('t');
    const fatura = kadro.find((a) => a.id === 'fatura')!;
    const denetci = kadro.find((a) => a.id === 'denetci')!;
    const koord = kadro.find((a) => a.id === 'koordinator')!;
    expect(fatura.sonKosu).toEqual(expect.objectContaining({ id: 'is9', ajanId: 'fatura', status: 'running', dryRun: true, kaynak: 'portal', taxpayerId: 'tx1' }));
    expect(fatura.bugunKosu).toBe(3);
    expect(fatura.calisiyor).toBe(true);
    expect(fatura.bekleyenOnay).toBe(0);
    expect(denetci.bekleyenOnay).toBe(2);
    expect(denetci.bugunKosu).toBe(1);
    expect(denetci.sonKosu).toBeNull();
    expect(koord.sonKosu).toBeNull();
    expect(koord.calisiyor).toBe(false);
    // Eski alanlar duruyor
    expect(fatura.aracSayisi).toBeGreaterThan(0);
    expect(fatura.kademeler).toBeDefined();

    const tenantsiz = await runnerKur({}).kadroOzeti();
    expect(tenantsiz).toHaveLength(12);
    expect(tenantsiz[0].sonKosu).toBeNull();
    expect(tenantsiz[0].bekleyenOnay).toBe(0);
  });

  it('DB hatasında kadro yine döner (alanlar boş)', async () => {
    const prisma = {
      agentCommand: { findMany: async () => { throw new Error('db yok'); }, groupBy: async () => { throw new Error('db yok'); } },
      ownerApprovalRequest: { groupBy: async () => { throw new Error('db yok'); } },
    };
    const kadro = await runnerKur(prisma).kadroOzeti('t');
    expect(kadro).toHaveLength(12);
    expect(kadro.every((a) => a.sonKosu === null && a.bekleyenOnay === 0 && a.bugunKosu === 0 && a.calisiyor === false)).toBe(true);
  });
});

describe('/ekip/isler süzgeçleri (§7-4)', () => {
  const where = (opts: any) => (EkipRunnerService.prototype as any).isWhere.call(runnerKur({}), 't', opts);

  it('süzgeç yoksa eski koşul', () => {
    expect(where({})).toEqual({ tenantId: 't', agent: { startsWith: 'ekip:' } });
    expect(where({ ajanId: 'fatura' })).toEqual({ tenantId: 't', agent: 'ekip:fatura' });
  });

  it('gun / status / dryRun / kaynak koşulları', () => {
    const w = where({ gun: 'bugun', status: 'running,failed,uydurma', dryRun: false, kaynak: 'cron' });
    expect(w.createdAt.gte).toBeInstanceOf(Date);
    expect(w.status).toEqual({ in: ['running', 'failed'] });
    expect(w.AND).toEqual([{ payload: { path: ['dryRun'], equals: false } }, { payload: { path: ['kaynak'], equals: 'cron' } }]);

    const w7 = where({ gun: '7', status: 'done', dryRun: true, kaynak: 'olmayan' });
    expect(Date.now() - w7.createdAt.gte.getTime()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(w7.status).toBe('done');
    // dryRun=true: payload.dryRun eksik kayıtlar da kuru sayılır → NOT(false)
    expect(w7.AND).toEqual([{ NOT: [{ payload: { path: ['dryRun'], equals: false } }] }]);

    expect(where({ gun: 'tumu', status: 'uydurma' }).createdAt).toBeUndefined();
    expect(where({ gun: 'tumu', status: 'uydurma' }).status).toBeUndefined();
  });

  it('isleriSuz {isler, toplam, suzgec} döner; toplam limit’ten bağımsız', async () => {
    const satir = { id: 'a', agent: 'ekip:denetci', action: 'x', payload: { gorev: 'x', dryRun: true, kaynak: 'ses' }, status: 'done', createdAt: new Date(), result: { toolUses: [1, 2] } };
    const prisma = {
      agentCommand: {
        findMany: async (q: any) => (expect(q.take).toBe(5), [satir]),
        count: async () => 42,
      },
    };
    const s = await runnerKur(prisma).isleriSuz('t', { gun: 'bugun', limit: 5, kaynak: 'ses' });
    expect(s.toplam).toBe(42);
    expect(s.isler).toHaveLength(1);
    expect(s.isler[0]).toEqual(expect.objectContaining({ id: 'a', ajanId: 'denetci', kaynak: 'ses', toolSayisi: 2 }));
    expect(s.suzgec).toEqual({ ajanId: null, gun: 'bugun', status: null, dryRun: null, kaynak: 'ses', limit: 5 });
  });
});

describe('onay özeti mukellefAd (§7-7)', () => {
  const onayKur = (taxpayerFindMany: any) =>
    new EkipOnayService(
      {
        ownerApprovalRequest: {
          findMany: async () => [
            { id: '1', previewId: 'PRV-1', agent: 'ekip:denetci', action: 'send_whatsapp_template', payload: { to: '0532 111 22 33', message: 'm', isId: 'is1', taxpayerId: null }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
            { id: '2', previewId: 'PRV-2', agent: 'ekip:banka-kasa', action: 'send_sms', payload: { taxpayerId: 'tx2', message: 'm', isId: 'is2' }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
            { id: '3', previewId: 'PRV-3', agent: 'ekip:denetci', action: 'send_email', payload: { email: 'a@b.c', message: 'm', isId: 'is3', taxpayerId: null }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
          ],
        },
        taxpayer: { findMany: taxpayerFindMany },
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('telefon → phones/rehber eşlemesi, taxpayerId → ad; e-posta çözümsüz kalır', async () => {
    let sorgu: any = null;
    const svc = onayKur(async (q: any) => {
      sorgu = q;
      return [
        { id: 'tx1', companyName: 'FAMCOFFEE', firstName: null, lastName: null, phone: '0532 111 22 33', phones: ['905321112233'], telefonAdlari: { '905321112233': 'Ahmet Bey' } },
        { id: 'tx2', companyName: null, firstName: 'Ayşe', lastName: 'Gül', phone: null, phones: [], telefonAdlari: null },
      ];
    });
    const { onaylar } = await svc.listele('t');
    expect(sorgu.where.tenantId).toBe('t');
    expect(sorgu.where.OR).toEqual(
      expect.arrayContaining([{ id: { in: ['tx2'] } }, { phones: { hasSome: expect.arrayContaining(['905321112233', '05321112233']) } }]),
    );
    const [tel, mk, ep] = onaylar;
    expect(tel).toEqual(expect.objectContaining({ hedef: '0532 111 22 33', hedefTuru: 'telefon', hedefNormalize: '905321112233', mukellefId: 'tx1', mukellefAd: 'FAMCOFFEE', hedefAd: 'Ahmet Bey' }));
    expect(mk).toEqual(expect.objectContaining({ hedef: 'tx2', hedefTuru: 'mukellef', mukellefId: 'tx2', mukellefAd: 'Ayşe Gül', hedefAd: null }));
    expect(ep).toEqual(expect.objectContaining({ hedef: 'a@b.c', hedefTuru: 'eposta', mukellefId: null, mukellefAd: null }));
    // Eski alanlar duruyor
    expect(tel.confirmationText).toBe('ONAYLIYORUM #PRV-1');
    expect(tel.isId).toBe('is1');
  });

  it('mükellef sorgusu patlarsa liste yine döner, adlar boş', async () => {
    const svc = onayKur(async () => { throw new Error('db yok'); });
    const { onaylar } = await svc.listele('t');
    expect(onaylar).toHaveLength(3);
    expect(onaylar.every((o: any) => o.mukellefAd === null)).toBe(true);
  });
});

// ─── PLAN/19 H1/H2 (2026-09-14): sabah özeti gönderim kapısı, kiracı seçimi, görev metni, rapor süzgeci ───
describe('KoordinatorService sabah özeti (§8)', () => {
  const eskiEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...eskiEnv };
  });

  function koordinatorKur(o: { aktif: boolean; tenants?: any[]; tenantBulunur?: boolean; rapor?: string }) {
    const calistirilan: any[] = [];
    const gonderilen: any[] = [];
    const loglar: string[] = [];
    const prisma = {
      auditLog: { findMany: async () => [] },
      tenant: {
        findMany: async () => o.tenants || [],
        findUnique: async (q: any) => (o.tenantBulunur === false ? null : { id: q.where.id }),
      },
    };
    const runner = {
      calistir: async (p: any) => {
        calistirilan.push(p);
        return { isId: 'is1', ajanId: 'koordinator', rapor: o.rapor ?? 'RAPOR: Günaydın. gece çekimi: 3 belge geldi.', toolUses: [], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'm', durationMs: 1, costUsd: 0 };
      },
    };
    const whatsapp = {
      isAutomationActive: async () => o.aktif,
      sendMessage: async (tel: string, metin: string) => (gonderilen.push({ tel, metin }), true),
    };
    const akis = { ozetSatiri: async () => 'sürüyor 0 · onay 0 · istek 0' };
    const k = new KoordinatorService(prisma as any, runner as any, whatsapp as any, akis as any);
    (k as any).logger = { warn: (m: string) => loglar.push(`warn ${m}`), log: (m: string) => loglar.push(`log ${m}`), debug: () => undefined, error: () => undefined };
    return { k, calistirilan, gonderilen, loglar };
  }

  it('gönderim istenen çağrıda WhatsApp kapalıysa koşu HİÇ başlamaz: calistir çağrılmaz, atlandi + hata dolu, log "<tenant> atlandı: …"', async () => {
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '05350587475';
    const t = koordinatorKur({ aktif: false });
    const r = await t.k.sabahOzeti('t1');
    expect(t.calistirilan).toEqual([]);
    expect(r.gonderildi).toBe(0);
    expect(r.isId).toBe('');
    expect(r.atlandi).toMatch(/WhatsApp otomasyonu kapalı/);
    expect(r.hata).toBe(r.atlandi);
    expect(t.loglar).toEqual([expect.stringMatching(/^warn \[Koordinator\] t1 atlandı: WhatsApp otomasyonu kapalı/)]);
  });

  it('WhatsApp açık ama sahip numarası yoksa da koşu başlamaz', async () => {
    delete process.env.MOREN_OWNER_WHATSAPP_PHONES;
    delete process.env.MOREN_OWNER_WHATSAPP_PHONE;
    const t = koordinatorKur({ aktif: true });
    const r = await t.k.sabahOzeti('t1');
    expect(t.calistirilan).toEqual([]);
    expect(r.atlandi).toMatch(/MOREN_OWNER_WHATSAPP_PHONES/);
  });

  it('portaldan "Şimdi üret" (gonder:false) kapıdan etkilenmez: WhatsApp kapalıyken de koşar, göndermez', async () => {
    const t = koordinatorKur({ aktif: false });
    const r = await t.k.sabahOzeti('t1', { gonder: false });
    expect(t.calistirilan).toHaveLength(1);
    expect(t.calistirilan[0]).toMatchObject({ ajanId: 'koordinator', tenantId: 't1', dryRun: true, kaynak: 'cron' });
    expect(t.gonderilen).toEqual([]);
    expect(r.atlandi).toBeUndefined();
    expect(r.gonderildi).toBe(0);
    expect(r.isId).toBe('is1');
  });

  it('WhatsApp açık + numaralar varsa koşar ve her numaraya gönderir; ders/SORU satırları mesaja girmez', async () => {
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '05350587475, 0532 111 22 33';
    const rapor = ['Araçları çağırdım.', '**RAPOR:** Günaydın. gece çekimi: 3 belge geldi.', '• 2 beyanname hazır', 'SORU: devam?', '**Öğrendiklerim:**', '- get_tax_calendar boş dönebiliyor'].join('\n');
    const t = koordinatorKur({ aktif: true, rapor });
    const r = await t.k.sabahOzeti('t1');
    expect(t.calistirilan).toHaveLength(1);
    expect(r.gonderildi).toBe(2);
    expect(t.gonderilen.map((g) => g.tel)).toEqual(['905350587475', '905321112233']);
    expect(t.gonderilen[0].metin).toBe('Günaydın. gece çekimi: 3 belge geldi.\n• 2 beyanname hazır');
  });

  it('görev metni: özeti sistem gönderir, ajan onay kaydı AÇMAZ (PLAN/19 H2-a)', () => {
    const t = koordinatorKur({ aktif: true });
    const g = (t.k as any).sabahGorevi('gece çekimi: çalışmadı', 'sürüyor 0') as string;
    expect(g).toContain("Bu özeti Muzaffer Bey'e WhatsApp'tan SİSTEM gönderir; sen göndermezsin ve onay kaydı AÇMAZSIN");
    expect(g).toContain('create_pending_action çağırma');
    expect(g).toContain("gerçekten onay isteyen başka bir iş yoksa 'yok' yaz");
  });

  it('sabahKiracilari: MOREN_OWNER_TENANT_ID varsa yalnız o (DB\'de yoksa boş + uyarı); yoksa mükellefi olmayan kiracı atlanır', async () => {
    process.env.MOREN_OWNER_TENANT_ID = 'sahip';
    const a = koordinatorKur({ aktif: true, tenants: [{ id: 'x', _count: { taxpayers: 5 } }] });
    expect(await (a.k as any).sabahKiracilari()).toEqual([{ id: 'sahip' }]);

    const b = koordinatorKur({ aktif: true, tenantBulunur: false });
    expect(await (b.k as any).sabahKiracilari()).toEqual([]);
    expect(b.loglar).toEqual([expect.stringMatching(/^warn \[Koordinator\] sahip atlandı: MOREN_OWNER_TENANT_ID/)]);

    delete process.env.MOREN_OWNER_TENANT_ID;
    const c = koordinatorKur({ aktif: true, tenants: [{ id: 'dolu', _count: { taxpayers: 12 } }, { id: 'bos', _count: { taxpayers: 0 } }, { id: 'sayimsiz' }] });
    expect(await (c.k as any).sabahKiracilari()).toEqual([{ id: 'dolu' }]);
    expect(c.loglar).toEqual([
      'log [Koordinator] bos atlandı: mükellef yok',
      'log [Koordinator] sayimsiz atlandı: mükellef yok',
    ]);
  });

  it('sabahCron: EKIP_SABAH_OZETI=on ise seçilen kiracıları koşturur; atlanan kiracı için ikinci log yazmaz', async () => {
    process.env.EKIP_SABAH_OZETI = 'on';
    process.env.MOREN_OWNER_WHATSAPP_PHONES = '05350587475';
    delete process.env.MOREN_OWNER_TENANT_ID;
    const kapali = koordinatorKur({ aktif: false, tenants: [{ id: 'dolu', _count: { taxpayers: 3 } }] });
    await kapali.k.sabahCron();
    expect(kapali.calistirilan).toEqual([]);
    expect(kapali.loglar).toEqual([expect.stringMatching(/^warn \[Koordinator\] dolu atlandı: WhatsApp otomasyonu kapalı/)]);

    const acik = koordinatorKur({ aktif: true, tenants: [{ id: 'dolu', _count: { taxpayers: 3 } }] });
    await acik.k.sabahCron();
    expect(acik.calistirilan.map((p) => p.tenantId)).toEqual(['dolu']);
    expect(acik.loglar).toEqual([expect.stringMatching(/^log \[Koordinator\] dolu sabah özeti: iş is1, 1 numaraya gitti$/)]);

    process.env.EKIP_SABAH_OZETI = 'off';
    const kapi = koordinatorKur({ aktif: true, tenants: [{ id: 'dolu', _count: { taxpayers: 3 } }] });
    await kapi.k.sabahCron();
    expect(kapi.calistirilan).toEqual([]);
  });
});
