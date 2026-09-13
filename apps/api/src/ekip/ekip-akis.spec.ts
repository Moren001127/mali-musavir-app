/**
 * EKİP AKIŞI (PLAN/18) kilit testleri:
 *  - vakaGrupla: kök + çocuklar tek vaka; eski kayıt (vakaId yok) kendi vakası; pencere dışı kök bağlanır
 *  - vakaKutusu öncelik: onay > istek > suruyor > bitti; failed → durum 'hata', kutu 'bitti'
 *  - açık kalem: PRV PENDING (süresi dolmamış) / bildirim isRead=false + kapandi yok; 'bilgi' kutu değiştirmez
 *  - "İŞ ATAMASI" başlığı zorla 'bilgi'; enum dışı tur → 'onay'
 *  - kimde: onay/istek → Muzaffer Bey; sürüyor → koşan ajan; bitti → son biten ajan
 *  - konu: kökün ilk satırı ≤80; "İŞ ATAMASI → …" ok işaretinden sonrası
 *  - gecikti: kutu ≠ bitti ve 24 saattir güncellenmemiş; sayaçlar; özet satırı
 *  - EkipAkisService: akis süzgeç/sayaç ayrımı, bildirim JSON süzgeci düşünce bellekte süzme, istekKapat
 *  - runner: kök vakaId = kendi id; ekip_ajan_baslat çocuk vakaId/ustIsId/devirSayisi; 3. devir reddi + bildirim
 *  - dispatcher.createPendingAction: ekip yolunda metadata tur/vakaId/isId/ajanId/taxpayerId; otomasyon yolunda değişmez
 * DB / Agent SDK yok (sahte).
 */
import {
  akisOzetSatiri,
  akisSayaclari,
  automationIdIsId,
  bildirimTuru,
  konuBasligi,
  vakaGrupla,
  vakaKutusu,
} from './ekip-akis';
import { EkipAkisService } from './ekip-akis.service';
import { EkipRunnerService } from './ekip-runner.service';
import { ActionDispatcherService } from '../automations/action-dispatcher.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SIMDI = Date.parse('2026-09-13T10:00:00Z');
const T = (dkOnce: number) => new Date(SIMDI - dkOnce * 60 * 1000);
const is = (o: Partial<any> & { id: string; agent: string }) => {
  const { gorev, payload, ...kalan } = o;
  const createdAt = o.createdAt || T(60);
  return {
    action: 'x',
    status: 'done',
    result: null,
    createdAt,
    startedAt: o.startedAt === undefined ? createdAt : o.startedAt,
    finishedAt: o.finishedAt === undefined ? new Date(createdAt.getTime() + 10 * 60 * 1000) : o.finishedAt,
    ...kalan,
    payload: { gorev: gorev || 'Görev', dryRun: true, ...(payload || {}) },
  };
};

describe('vakaKutusu — öncelik', () => {
  it('onay > istek > suruyor > bitti; failed → durum hata, kutu bitti', () => {
    expect(vakaKutusu({ isler: [{ status: 'running' }], acikOnayVar: true, acikIstekVar: true })).toEqual({ kutu: 'onay', durum: 'suruyor' });
    expect(vakaKutusu({ isler: [{ status: 'done' }], acikOnayVar: false, acikIstekVar: true })).toEqual({ kutu: 'istek', durum: 'bitti' });
    expect(vakaKutusu({ isler: [{ status: 'done' }, { status: 'pending' }], acikOnayVar: false, acikIstekVar: false })).toEqual({ kutu: 'suruyor', durum: 'suruyor' });
    expect(vakaKutusu({ isler: [{ status: 'done' }], acikOnayVar: false, acikIstekVar: false })).toEqual({ kutu: 'bitti', durum: 'bitti' });
    expect(vakaKutusu({ isler: [{ status: 'done' }, { status: 'failed' }], acikOnayVar: false, acikIstekVar: false })).toEqual({ kutu: 'bitti', durum: 'hata' });
  });
});

describe('bildirimTuru / konuBasligi / automationIdIsId', () => {
  it('İŞ ATAMASI başlığı zorla bilgi; enum dışı → onay; istek korunur', () => {
    expect(bildirimTuru({ title: 'İŞ ATAMASI → beyanname: R1', metadata: { tur: 'istek' } })).toBe('bilgi');
    expect(bildirimTuru({ title: 'Fiş yükleyin', metadata: { tur: 'istek' } })).toBe('istek');
    expect(bildirimTuru({ title: 'x', metadata: { tur: 'uydurma' } })).toBe('onay');
    expect(bildirimTuru({ title: 'x' })).toBe('onay');
  });
  it('konu: ilk satır ≤80, ok işaretinden sonrası, markdown soyulur', () => {
    expect(konuBasligi('İŞ ATAMASI → beyanname: R1 FAMCOFFEE 2026/08 kuru\nikinci satır')).toBe('beyanname: R1 FAMCOFFEE 2026/08 kuru');
    expect(konuBasligi('**Erdoğan Balçık KDV kontrolü**')).toBe('Erdoğan Balçık KDV kontrolü');
    expect(konuBasligi('a'.repeat(100))).toHaveLength(80);
    expect(konuBasligi('')).toBe('');
  });
  it('automationId ekip:<ajan>:<isId> → isId', () => {
    expect(automationIdIsId('ekip:beyanname:cmf1abc')).toBe('cmf1abc');
    expect(automationIdIsId('auto-123')).toBeNull();
  });
});

describe('vakaGrupla — gruplama + kutular', () => {
  it('kök + iki çocuk tek vaka; adımlar zamana göre; konu kökten; kimde sürüyorsa koşan ajan', () => {
    const isler = [
      is({ id: 'kok', agent: 'ekip:koordinator', gorev: 'FAMCOFFEE Ağustos KDV kontrolü\nek', payload: { vakaId: 'kok', devirSayisi: 0, taxpayerId: 'tx1' }, createdAt: T(90), startedAt: T(90), finishedAt: T(85) }),
      is({ id: 'c1', agent: 'ekip:beyanname', payload: { vakaId: 'kok', ustIsId: 'kok', devirSayisi: 1 }, createdAt: T(80), startedAt: T(80), finishedAt: T(70), result: { rapor: 'R1 bitti' } }),
      is({ id: 'c2', agent: 'ekip:luca-operator', payload: { vakaId: 'kok', ustIsId: 'c1', devirSayisi: 2 }, status: 'running', createdAt: T(10), startedAt: T(10), finishedAt: null }),
    ];
    const v = vakaGrupla(isler, [], [], { now: SIMDI });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ vakaId: 'kok', konu: 'FAMCOFFEE Ağustos KDV kontrolü', kutu: 'suruyor', durum: 'suruyor', kuru: true, gecikti: false, mukellef: { id: 'tx1', ad: null } });
    expect(v[0].kimde).toEqual({ ajanId: 'luca-operator', ad: expect.any(String) });
    expect(v[0].adimlar.map((a: any) => a.isId)).toEqual(['kok', 'c1', 'c2']);
    expect((v[0].adimlar[1] as any).raporOzet).toBe('R1 bitti');
    expect((v[0].adimlar[2] as any).devir).toBe(2);
    expect(v[0].guncellendi).toBe(T(10).toISOString());
  });

  it('eski kayıt (vakaId yok) kendi vakası; pencere dışı kök listeye eklenince çocuk ona bağlanır', () => {
    const eski = is({ id: 'eski', agent: 'ekip:fatura', payload: {} });
    const cocuk = is({ id: 'c', agent: 'ekip:denetci', payload: { vakaId: 'disKok' } });
    const disKok = is({ id: 'disKok', agent: 'ekip:koordinator', gorev: 'Kök görev', createdAt: T(600) });
    const v = vakaGrupla([eski, cocuk, disKok], [], [], { now: SIMDI });
    expect(v.map((x) => x.vakaId).sort()).toEqual(['disKok', 'eski']);
    expect(v.find((x) => x.vakaId === 'disKok')!.konu).toBe('Kök görev');
    expect(v.find((x) => x.vakaId === 'disKok')!.adimlar).toHaveLength(2);
  });

  it('açık PRV → kutu onay, kimde Muzaffer Bey, acikKalemler PRV; süresi dolmuş PRV açık sayılmaz (EXPIRED adımı)', () => {
    const isler = [is({ id: 'k', agent: 'ekip:musteri', payload: { vakaId: 'k', taxpayerId: 'tx1' } })];
    const acik = { id: 'o1', previewId: 'PRV-AAAA', agent: 'ekip:musteri', action: 'send_whatsapp_freeform', payload: { isId: 'k', to: '905551112233' }, status: 'PENDING', expiresAt: T(-600), createdAt: T(45) };
    const v = vakaGrupla(isler, [acik], [], { now: SIMDI });
    expect(v[0].kutu).toBe('onay');
    expect(v[0].durum).toBe('bitti');
    expect(v[0].kimde).toEqual({ ajanId: 'siz', ad: 'Muzaffer Bey' });
    expect(v[0].acikKalemler).toEqual([{ tip: 'onay', id: 'PRV-AAAA', baslik: expect.stringContaining('905551112233'), kaynak: 'PRV', confirmationText: 'ONAYLIYORUM #PRV-AAAA' }]);
    expect(v[0].guncellendi).toBe(T(45).toISOString());

    const dolmus = { ...acik, expiresAt: T(5) };
    const v2 = vakaGrupla(isler, [dolmus], [], { now: SIMDI });
    expect(v2[0].kutu).toBe('bitti');
    expect(v2[0].acikKalemler).toEqual([]);
    expect((v2[0].adimlar.find((a) => a.tip === 'onay') as any).durum).toBe('EXPIRED');
  });

  it('bildirim: istek → kutu istek; bilgi kutu değiştirmez; kapandi olan açık değil; isId automationId’den çözülür', () => {
    const isler = [is({ id: 'k', agent: 'ekip:denetci', payload: { vakaId: 'k' } })];
    const istek = { id: 'n1', title: 'Fiş yükleyin', body: 'Ağustos fişleri', isRead: false, metadata: { automationId: 'ekip:denetci:k', tur: 'istek' }, createdAt: T(30) };
    const bilgi = { id: 'n2', title: 'İŞ ATAMASI → evrak: R9', body: '', isRead: false, metadata: { automationId: 'ekip:koordinator:k', vakaId: 'k', tur: 'onay' }, createdAt: T(55) };
    let v = vakaGrupla(isler, [], [istek, bilgi], { now: SIMDI });
    expect(v[0].kutu).toBe('istek');
    expect(v[0].acikKalemler).toEqual([{ tip: 'istek', id: 'n1', baslik: 'Fiş yükleyin', kaynak: 'bildirim' }]);
    expect((v[0].adimlar.find((a) => a.tip === 'bildirim' && (a as any).id === 'n2') as any).tur).toBe('bilgi');

    const kapali = { ...istek, isRead: true, metadata: { ...istek.metadata, kapandi: '2026-09-13T09:00:00Z' } };
    v = vakaGrupla(isler, [], [kapali, bilgi], { now: SIMDI });
    expect(v[0].kutu).toBe('bitti');
    expect(v[0].acikKalemler).toEqual([]);
    expect((v[0].adimlar.find((a) => a.tip === 'bildirim' && (a as any).id === 'n1') as any).durum).toBe('kapandi');
  });

  it('kimde bitti → son biten ajan; failed varsa durum hata; mukellef kökte yoksa çocuktan', () => {
    const isler = [
      is({ id: 'k', agent: 'ekip:koordinator', payload: { vakaId: 'k' }, createdAt: T(100), finishedAt: T(95) }),
      is({ id: 'c1', agent: 'ekip:analist', payload: { vakaId: 'k', taxpayerId: 'txC' }, status: 'failed', createdAt: T(90), finishedAt: T(80), result: { hata: 'patladı' } }),
    ];
    const v = vakaGrupla(isler, [], [], { now: SIMDI });
    expect(v[0]).toMatchObject({ kutu: 'bitti', durum: 'hata', kimde: { ajanId: 'analist' }, mukellef: { id: 'txC', ad: null } });
    expect((v[0].adimlar[1] as any).hata).toBe('patladı');
  });

  it('gecikti: kutu ≠ bitti ve 24 saattir güncellenmemiş; sayaçlar ve özet satırı', () => {
    const isler = [
      is({ id: 'a', agent: 'ekip:fatura', gorev: 'Eski sürüyor', payload: { vakaId: 'a', taxpayerId: 'tx1' }, status: 'running', createdAt: T(60 * 30), startedAt: T(60 * 30), finishedAt: null }),
      is({ id: 'b', agent: 'ekip:fatura', gorev: 'Yeni sürüyor', payload: { vakaId: 'b' }, status: 'running', createdAt: T(5), startedAt: T(5), finishedAt: null }),
      is({ id: 'c', agent: 'ekip:denetci', gorev: 'Eski bitti', payload: { vakaId: 'c' }, createdAt: T(60 * 30), finishedAt: T(60 * 29) }),
      is({ id: 'd', agent: 'ekip:denetci', gorev: 'Dün bitti', payload: { vakaId: 'd' }, createdAt: T(120), finishedAt: T(110) }),
    ];
    const v = vakaGrupla(isler, [], [], { now: SIMDI });
    const vaka = (id: string) => v.find((x) => x.vakaId === id)!;
    vaka('a').mukellef!.ad = 'FAMCOFFEE';
    expect(vaka('a').gecikti).toBe(true);
    expect(vaka('b').gecikti).toBe(false);
    expect(vaka('c').gecikti).toBe(false); // bitti gecikmez
    expect(v.map((x) => x.vakaId)).toEqual(['b', 'd', 'c', 'a']); // guncellendi desc
    expect(akisSayaclari(v)).toEqual({ suruyor: 2, onay: 0, istek: 0, bitti: 2, gecikti: 1 });
    expect(akisOzetSatiri(v, SIMDI)).toBe('Ekip akışı: sürüyor 2 · onayınızı bekleyen 0 · sizden istenen 0 · dün bitti 1 · gecikti: FAMCOFFEE · Eski sürüyor · Fatura Muhasebecisi');
    expect(akisOzetSatiri([], SIMDI)).toMatch(/gecikti: yok$/);
  });

  it('gecikti: devir sınırı bildirimi (metadata.gecikme=devir) açıkken 24 saati beklemez; okununca kalkar', () => {
    const isler = [
      is({ id: 'k', agent: 'ekip:koordinator', gorev: 'Öz Ela kasa negatifi', payload: { vakaId: 'k', taxpayerId: 'tx1' }, createdAt: T(20), finishedAt: T(15) }),
      is({ id: 'c1', agent: 'ekip:denetci', payload: { vakaId: 'k', ustIsId: 'k', devirSayisi: 1 }, createdAt: T(19), finishedAt: T(18) }),
      is({ id: 'c2', agent: 'ekip:analist', payload: { vakaId: 'k', ustIsId: 'c1', devirSayisi: 2 }, createdAt: T(17), finishedAt: T(16) }),
    ];
    const karar = { id: 'n9', title: 'Karar sizde: Öz Ela kasa negatifi', body: '3. devire geldi', isRead: false, metadata: { automationId: 'ekip:koordinator:k', vakaId: 'k', tur: 'bilgi', gecikme: 'devir' }, createdAt: T(15) };
    const acik = vakaGrupla(isler, [], [karar], { now: SIMDI })[0];
    expect(acik).toMatchObject({ kutu: 'bitti', gecikti: true }); // bilgi kutu değiştirmez ama bayrak kalkar
    expect(akisSayaclari([acik]).gecikti).toBe(1);
    const okundu = vakaGrupla(isler, [], [{ ...karar, isRead: true }], { now: SIMDI })[0];
    expect(okundu.gecikti).toBe(false);
  });
});

describe('EkipAkisService', () => {
  function sahtePrisma(opts: { jsonSuzgecDusur?: boolean } = {}) {
    const cagrilar: any[] = [];
    const isler = [
      is({ id: 'k', agent: 'ekip:koordinator', gorev: 'FAMCOFFEE KDV', payload: { vakaId: 'k', taxpayerId: 'tx1' } }),
      is({ id: 'c', agent: 'ekip:beyanname', payload: { vakaId: 'disKok' }, status: 'running', finishedAt: null }),
      is({ id: 'eski', agent: 'ekip:denetci', payload: {} }),
    ];
    const bildirimler = [
      { id: 'n1', title: 'Fiş yükleyin', body: '', isRead: false, metadata: { automationId: 'ekip:denetci:eski', tur: 'istek' }, createdAt: T(3) },
      { id: 'n2', title: 'Otomasyon', body: '', isRead: false, metadata: { automationId: 'auto-1' }, createdAt: T(3) },
    ];
    return {
      cagrilar,
      agentCommand: {
        findMany: async (q: any) => {
          cagrilar.push(['agentCommand', q]);
          if (q.where?.id?.in) return [is({ id: 'disKok', agent: 'ekip:koordinator', gorev: 'Dış kök', createdAt: T(60 * 24 * 9) })];
          return isler;
        },
      },
      ownerApprovalRequest: { findMany: async () => [] },
      notification: {
        findMany: async (q: any) => {
          cagrilar.push(['notification', q]);
          if (q.where?.metadata) {
            if (opts.jsonSuzgecDusur) throw new Error('json filter yok');
            return bildirimler.filter((b) => b.metadata.automationId.startsWith('ekip:'));
          }
          return bildirimler;
        },
        findFirst: async (q: any): Promise<any> => bildirimler.find((b) => b.id === q.where.id) || null,
        update: async (q: any) => (cagrilar.push(['update', q]), { id: q.where.id }),
      },
      taxpayer: { findMany: async () => [{ id: 'tx1', companyName: 'FAMCOFFEE', firstName: '', lastName: '' }] },
    };
  }

  it('akis: eksik kök bağlanır, mükellef adı çözülür, sayaçlar süzgeçten bağımsız, vakalar süzgeçli', async () => {
    const prisma = sahtePrisma();
    const s = new EkipAkisService(prisma as any);
    const a = await s.akis('t1', { gun: 7, filtre: 'istek' });
    expect(a.sayaclar).toEqual({ suruyor: 1, onay: 0, istek: 1, bitti: 1, gecikti: 0 });
    expect(a.vakalar).toHaveLength(1);
    expect(a.vakalar[0]).toMatchObject({ vakaId: 'eski', kutu: 'istek', kimde: { ajanId: 'siz' } });
    expect(a.pencere.gun).toBe(7);
    const hepsi = await s.akis('t1', {});
    expect(hepsi.vakalar.map((v) => v.vakaId).sort()).toEqual(['disKok', 'eski', 'k']);
    expect(hepsi.vakalar.find((v) => v.vakaId === 'k')!.mukellef).toEqual({ id: 'tx1', ad: 'FAMCOFFEE' });
    expect(hepsi.vakalar.find((v) => v.vakaId === 'disKok')!.konu).toBe('Dış kök');
    const tx = await s.akis('t1', { taxpayerId: 'tx1' });
    expect(tx.vakalar.map((v) => v.vakaId)).toEqual(['k']);
    // eksik kök sorgusu id.in ile
    expect(prisma.cagrilar.some(([m, q]) => m === 'agentCommand' && q.where?.id?.in?.includes('disKok'))).toBe(true);
  });

  it('bildirim JSON süzgeci düşerse bellekte süzülür (otomasyon bildirimi karışmaz)', async () => {
    const prisma = sahtePrisma({ jsonSuzgecDusur: true });
    const s = new EkipAkisService(prisma as any);
    (s as any).logger = { debug: () => undefined, warn: () => undefined };
    const a = await s.akis('t1', {});
    expect(a.sayaclar.istek).toBe(1);
    expect(a.vakalar.flatMap((v) => v.adimlar).some((ad: any) => ad.id === 'n2')).toBe(false);
    expect(await s.ozetSatiri('t1')).toMatch(/^Ekip akışı: sürüyor 1 · onayınızı bekleyen 0 · sizden istenen 1/);
  });

  it('istekKapat: ekip bildirimi → isRead + metadata.kapandi/kapatan; otomasyon bildirimi → bulunamadı; kapalı → zatenKapali', async () => {
    const prisma = sahtePrisma();
    const s = new EkipAkisService(prisma as any);
    const r = await s.istekKapat('t1', 'u1', 'n1');
    expect(r).toEqual({ ok: true, id: 'n1', vakaId: null });
    const upd = prisma.cagrilar.find(([m]) => m === 'update')![1];
    expect(upd.data.isRead).toBe(true);
    expect(upd.data.metadata).toMatchObject({ automationId: 'ekip:denetci:eski', tur: 'istek', kapatan: 'u1' });
    expect(typeof upd.data.metadata.kapandi).toBe('string');
    expect(await s.istekKapat('t1', 'u1', 'n2')).toEqual({ ok: false, error: 'Bildirim bulunamadı' });
    expect(await s.istekKapat('t1', 'u1', 'yok')).toEqual({ ok: false, error: 'Bildirim bulunamadı' });
    (prisma.notification as any).findFirst = async () => ({ id: 'n9', metadata: { automationId: 'ekip:x:y', kapandi: '2026-01-01', vakaId: 'v9' } });
    expect(await s.istekKapat('t1', 'u1', 'n9')).toEqual({ ok: true, id: 'n9', vakaId: 'v9', zatenKapali: true });
  });

  it('DB düşerse sayaclar sıfır, ozetSatiri "veri alınamadı"', async () => {
    const s = new EkipAkisService({ agentCommand: { findMany: async () => { throw new Error('db'); } }, ownerApprovalRequest: { findMany: async () => [] }, notification: { findMany: async () => [] } } as any);
    (s as any).logger = { debug: () => undefined, warn: () => undefined };
    expect(await s.sayaclar('t1')).toEqual({ suruyor: 0, onay: 0, istek: 0, bitti: 0, gecikti: 0 });
    expect(await s.ozetSatiri('t1')).toMatch(/^Ekip akışı: sürüyor 0/);
  });
});

describe('runner — vaka alanları + devir sınırı', () => {
  const eskiToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  beforeAll(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (eskiToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = eskiToken;
  });

  function sahtePrisma(cocukSayisi = 0) {
    const kayitlar = new Map<string, any>();
    const olusturulan: any[] = [];
    const sayimlar: any[] = [];
    let sayac = 0;
    return {
      kayitlar,
      olusturulan,
      sayimlar,
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
        findFirst: async (arg: any) => {
          if (arg?.where?.status?.in) return null;
          if (arg?.where?.payload) return { id: 'son', agent: 'ekip:luca-operator', result: { rapor: 'Luca ekranı okundu, fiş listesi boş.' } };
          return kayitlar.get(arg?.where?.id) || null;
        },
        count: async (arg: any) => (sayimlar.push(arg.where), cocukSayisi),
      },
      agentEvent: { create: async () => ({}) },
      aiMemory: { create: async () => ({}) },
      aiUsageLog: { create: async () => ({}) },
    };
  }
  function sahteSdk() {
    return {
      tool: () => ({}),
      createSdkMcpServer: () => ({}),
      query: () => {
        async function* uret() {
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'RAPOR: bitti.' } } };
          await bekle(5);
          yield { type: 'result', is_error: false, total_cost_usd: 0 };
        }
        return uret();
      },
    };
  }
  function runnerKur(prisma: any, dispatcher?: any) {
    const r = new EkipRunnerService(prisma, {} as any, dispatcher || ({} as any), { getRulesForUi: async () => [] } as any, {} as any);
    (r as any).sdkYukle = async () => sahteSdk();
    (r as any).logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, error: () => undefined };
    return r;
  }

  it('kök koşu: payload.vakaId = kendi id (running update ile), ustIsId null, devirSayisi 0; verilen vakaId ile çocuk olur', async () => {
    const prisma = sahtePrisma();
    const r = runnerKur(prisma);
    await r.calistir({ ajanId: 'denetci', gorev: 'x', tenantId: 't1', userId: 'u1', kaynak: 'portal', dryRun: true });
    const kok = prisma.kayitlar.get('is-1');
    expect(kok.payload).toMatchObject({ vakaId: 'is-1', ustIsId: null, devirSayisi: 0, gorev: 'x' });
    expect(kok.status).toBe('done');
    await r.calistir({ ajanId: 'koordinator', gorev: 'devam', tenantId: 't1', userId: 'u1', kaynak: 'portal', dryRun: true, vakaId: 'is-1' });
    expect(prisma.kayitlar.get('is-2').payload).toMatchObject({ vakaId: 'is-1', ustIsId: null, devirSayisi: 0 });
  });

  it('ekip_ajan_baslat: çocuk vakaId=koordinatör vakası, ustIsId=koordinatör işi, devirSayisi=çocuk sayısı+1; sayım koordinatörü dışlar', async () => {
    const prisma = sahtePrisma(1);
    const r = runnerKur(prisma);
    const p = { ajanId: 'koordinator', gorev: 'ata', tenantId: 't1', userId: 'u1', kaynak: 'ses' as const, dryRun: true, vakaId: 'vaka-kok' };
    const s = await (r as any).ekipAraciCalistir('ekip_ajan_baslat', { ajanId: 'beyanname', gorev: 'R1 yap' }, p, 'is-koord');
    expect(s).toMatchObject({ ok: true, isId: 'is-1', vakaId: 'vaka-kok', devirSayisi: 2 });
    expect(prisma.olusturulan[0].payload).toMatchObject({ vakaId: 'vaka-kok', ustIsId: 'is-koord', devirSayisi: 2, kaynak: 'koordinator' });
    expect(prisma.sayimlar[0]).toEqual({ tenantId: 't1', agent: { startsWith: 'ekip:', not: 'ekip:koordinator' }, payload: { path: ['vakaId'], equals: 'vaka-kok' } });
    await bekle(60);
    expect(prisma.kayitlar.get('is-1').payload.vakaId).toBe('vaka-kok'); // running update kökü ezmez
  });

  it('3. devir: çocuk AÇILMAZ, {ok:false, neden:devir_siniri}; "Karar sizde" bildirimi tur=bilgi, dedupe ekip:devir:<vaka>', async () => {
    const prisma = sahtePrisma(2);
    const dispatchler: any[] = [];
    const dispatcher = { dispatch: async (...a: any[]) => (dispatchler.push(a), { created: true }) };
    const r = runnerKur(prisma, dispatcher);
    const p = { ajanId: 'koordinator', gorev: 'ata', tenantId: 't1', userId: 'u1', kaynak: 'ses' as const, dryRun: true, taxpayerId: 'cmnydmgbx000heazyp9i4fq23' };
    const s = await (r as any).ekipAraciCalistir('ekip_ajan_baslat', { ajanId: 'fatura', gorev: 'FAMCOFFEE Ağustos faturaları' }, p, 'is-koord');
    expect(s).toMatchObject({ ok: false, neden: 'devir_siniri', vakaId: 'is-koord', devirSayisi: 3 });
    expect(s.error).toMatch(/3\. devire gelindi/);
    expect(prisma.olusturulan).toEqual([]);
    expect(dispatchler).toHaveLength(1);
    const [ad, args, ctx] = dispatchler[0];
    expect(ad).toBe('create_pending_action');
    expect(args).toMatchObject({ title: 'Karar sizde: FAMCOFFEE Ağustos faturaları', tur: 'bilgi', dedupeKey: 'ekip:devir:is-koord', taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
    expect(args.body).toMatch(/3\. devire geldi; kimde kaldı: Luca Operatörü; son rapor: Luca ekranı okundu/);
    expect(ctx).toMatchObject({ tenantId: 't1', isId: 'is-koord', vakaId: 'is-koord', ajanId: 'koordinator' });
  });

  it('görev başlığında VAKA satırı; dispatcher çağrısına isId/vakaId/ajanId/taxpayerId geçer', async () => {
    const prisma = sahtePrisma();
    const dispatchler: any[] = [];
    const dispatcher = { dispatch: async (...a: any[]) => (dispatchler.push(a), { created: true, notificationId: 'n1' }) };
    const r = runnerKur(prisma, dispatcher);
    let prompt = '';
    (r as any).sdkYukle = async () => ({
      ...sahteSdk(),
      tool: (_n: string, _d: string, _s: any, isleyici: any) => ({ isleyici }),
      createSdkMcpServer: (o: any) => o,
      query: (q: any) => {
        prompt = q.prompt;
        const isleyici = q.options.mcpServers.portal.tools[0].isleyici;
        async function* uret() {
          await isleyici({ name: 'create_pending_action', args: { title: 'Fiş yükleyin', body: 'x', tur: 'istek' } });
          yield { type: 'result', is_error: false, total_cost_usd: 0 };
        }
        return uret();
      },
    });
    await r.calistir({ ajanId: 'denetci', gorev: 'x', tenantId: 't1', userId: 'u1', kaynak: 'portal', dryRun: true, taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
    expect(prompt).toContain('VAKA: is-1 (create_pending_action çağrılarında vakaId olarak bunu ver; devir 0/2)');
    expect(dispatchler[0][2]).toEqual({ tenantId: 't1', userId: 'u1', automationId: 'ekip:denetci:is-1', isId: 'is-1', vakaId: 'is-1', ajanId: 'denetci', taxpayerId: 'cmnydmgbx000heazyp9i4fq23' });
  });

  it('kadroOzeti suAn: koşan ajanın vaka/iş/mükellef/konu; koşmayan null', async () => {
    const prisma: any = {
      agentCommand: {
        findMany: async (q: any) => (q.where.status === 'running' ? [{ id: 'is5', agent: 'ekip:fatura', status: 'running', payload: { gorev: 'İŞ ATAMASI → fatura: R4 FAMCOFFEE', vakaId: 'v1', taxpayerId: 'tx1' }, createdAt: T(10), startedAt: T(9) }] : []),
        groupBy: async () => [],
      },
      ownerApprovalRequest: { groupBy: async () => [] },
      taxpayer: { findMany: async () => [{ id: 'tx1', companyName: 'FAMCOFFEE' }] },
    };
    const r = new EkipRunnerService(prisma, {} as any, {} as any, {} as any, {} as any);
    const kadro = await r.kadroOzeti('t1');
    expect(kadro.find((a) => a.id === 'fatura')!.suAn).toEqual({ vakaId: 'v1', isId: 'is5', mukellefId: 'tx1', mukellefAd: 'FAMCOFFEE', konu: 'fatura: R4 FAMCOFFEE', basladi: T(9) });
    expect(kadro.find((a) => a.id === 'denetci')!.suAn).toBeNull();
  });
});

describe('ActionDispatcherService.createPendingAction — tur + vaka metadata', () => {
  function dispatcherKur() {
    const olusturulan: any[] = [];
    const notifications = { create: async (d: any) => (olusturulan.push(d), { id: 'n1' }) };
    const d = new ActionDispatcherService({} as any, {} as any, notifications as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { d, olusturulan };
  }

  it('ekip yolu: tur enum, İŞ ATAMASI zorla bilgi, vakaId/isId/ajanId/taxpayerId metadata; dedupeKey geçer', async () => {
    const { d, olusturulan } = dispatcherKur();
    const ctx = { tenantId: 't1', userId: 'u1', automationId: 'ekip:denetci:is1', isId: 'is1', vakaId: 'v1', ajanId: 'denetci', taxpayerId: 'txCtx' };
    let r: any = await d.dispatch('create_pending_action', { title: 'Fiş yükleyin', body: 'b', tur: 'istek' }, ctx);
    expect(r).toEqual({ created: true, notificationId: 'n1', tur: 'istek', vakaId: 'v1' });
    expect(olusturulan[0].metadata).toEqual({ automationId: 'ekip:denetci:is1', taxpayerId: 'txCtx', priority: 'normal', tur: 'istek', vakaId: 'v1', isId: 'is1', ajanId: 'denetci' });
    await d.dispatch('create_pending_action', { title: 'İŞ ATAMASI → beyanname: R1', body: 'b', tur: 'onay', taxpayerId: 'txArg' }, ctx);
    expect(olusturulan[1].metadata).toMatchObject({ tur: 'bilgi', taxpayerId: 'txArg' });
    r = await d.dispatch('create_pending_action', { title: 'x', body: 'b', tur: 'uydurma', dedupeKey: 'ekip:devir:v1', gecikme: 'devir' }, { ...ctx, vakaId: null });
    expect(olusturulan[2]).toMatchObject({ dedupeKey: 'ekip:devir:v1', dedupeWindowMin: 60 });
    expect(olusturulan[2].metadata).toMatchObject({ tur: 'onay', vakaId: 'is1', gecikme: 'devir' });
  });

  it('otomasyon yolu (ctx.isId yok): metadata eskisi gibi, tur yok', async () => {
    const { d, olusturulan } = dispatcherKur();
    const r = await d.dispatch('create_pending_action', { title: 't', body: 'b', taxpayerId: 'tx', tur: 'istek' }, { tenantId: 't1', userId: 'u1', automationId: 'auto-1' });
    expect(r).toEqual({ created: true, notificationId: 'n1' });
    expect(olusturulan[0].metadata).toEqual({ automationId: 'auto-1', taxpayerId: 'tx', priority: 'normal' });
    expect(olusturulan[0].dedupeKey).toBeUndefined();
  });
});
