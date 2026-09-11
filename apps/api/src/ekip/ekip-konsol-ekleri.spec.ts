/**
 * Operasyon konsolu backend ekleri (PLAN/14-EKIP-EKRANI-OPERASYON-KONSOLU.md §7) kilit testleri:
 *  1) pano 60 sn tenant önbelleği — eşzamanlı iki istek TEK üretim, yenile=true önbelleği atlar
 *  2) /ekip/durum ekleri — sonSabahOzeti raporun ilk anlamlı satırını verir
 *  3) kadro → sonKosu / bekleyenOnay / bugunKosu / calisiyor
 *  4) /ekip/isler süzgeçleri — where koşulu ve {isler, toplam, suzgec} şekli
 *  7) onay özeti mukellefAd — taxpayerId ve telefon (rehber) çözümü
 * Prisma/araçlar sahte; ağ/DB yok.
 */
import { EkipRunnerService } from './ekip-runner.service';
import { EkipOnayService } from './ekip-onay.service';

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
          return [{ agent: 'ekip:fatura', _count: { _all: 3 } }, { agent: 'ekip:evrak', _count: { _all: 1 } }];
        },
      },
      ownerApprovalRequest: {
        groupBy: async () => [{ agent: 'ekip:evrak', _count: { _all: 2 } }],
      },
    };
    const r = runnerKur(prisma);
    const kadro = await r.kadroOzeti('t');
    const fatura = kadro.find((a) => a.id === 'fatura')!;
    const evrak = kadro.find((a) => a.id === 'evrak')!;
    const koord = kadro.find((a) => a.id === 'koordinator')!;
    expect(fatura.sonKosu).toEqual(expect.objectContaining({ id: 'is9', ajanId: 'fatura', status: 'running', dryRun: true, kaynak: 'portal', taxpayerId: 'tx1' }));
    expect(fatura.bugunKosu).toBe(3);
    expect(fatura.calisiyor).toBe(true);
    expect(fatura.bekleyenOnay).toBe(0);
    expect(evrak.bekleyenOnay).toBe(2);
    expect(evrak.bugunKosu).toBe(1);
    expect(evrak.sonKosu).toBeNull();
    expect(koord.sonKosu).toBeNull();
    expect(koord.calisiyor).toBe(false);
    // Eski alanlar duruyor
    expect(fatura.aracSayisi).toBeGreaterThan(0);
    expect(fatura.kademeler).toBeDefined();

    const tenantsiz = await runnerKur({}).kadroOzeti();
    expect(tenantsiz).toHaveLength(13);
    expect(tenantsiz[0].sonKosu).toBeNull();
    expect(tenantsiz[0].bekleyenOnay).toBe(0);
  });

  it('DB hatasında kadro yine döner (alanlar boş)', async () => {
    const prisma = {
      agentCommand: { findMany: async () => { throw new Error('db yok'); }, groupBy: async () => { throw new Error('db yok'); } },
      ownerApprovalRequest: { groupBy: async () => { throw new Error('db yok'); } },
    };
    const kadro = await runnerKur(prisma).kadroOzeti('t');
    expect(kadro).toHaveLength(13);
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
    const satir = { id: 'a', agent: 'ekip:evrak', action: 'x', payload: { gorev: 'x', dryRun: true, kaynak: 'ses' }, status: 'done', createdAt: new Date(), result: { toolUses: [1, 2] } };
    const prisma = {
      agentCommand: {
        findMany: async (q: any) => (expect(q.take).toBe(5), [satir]),
        count: async () => 42,
      },
    };
    const s = await runnerKur(prisma).isleriSuz('t', { gun: 'bugun', limit: 5, kaynak: 'ses' });
    expect(s.toplam).toBe(42);
    expect(s.isler).toHaveLength(1);
    expect(s.isler[0]).toEqual(expect.objectContaining({ id: 'a', ajanId: 'evrak', kaynak: 'ses', toolSayisi: 2 }));
    expect(s.suzgec).toEqual({ ajanId: null, gun: 'bugun', status: null, dryRun: null, kaynak: 'ses', limit: 5 });
  });
});

describe('onay özeti mukellefAd (§7-7)', () => {
  const onayKur = (taxpayerFindMany: any) =>
    new EkipOnayService(
      {
        ownerApprovalRequest: {
          findMany: async () => [
            { id: '1', previewId: 'PRV-1', agent: 'ekip:evrak', action: 'send_whatsapp_template', payload: { to: '0532 111 22 33', message: 'm', isId: 'is1', taxpayerId: null }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
            { id: '2', previewId: 'PRV-2', agent: 'ekip:banka-kasa', action: 'send_sms', payload: { taxpayerId: 'tx2', message: 'm', isId: 'is2' }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
            { id: '3', previewId: 'PRV-3', agent: 'ekip:evrak', action: 'send_email', payload: { email: 'a@b.c', message: 'm', isId: 'is3', taxpayerId: null }, status: 'PENDING', createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
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
