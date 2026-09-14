import { bayatKosulariSec, bayatSonucBirlestir, kosuTavanDk, isinNabzi, EKIP_KOSU_TAVAN_DK_VARSAYILAN, BEKCI_PENDING_TAVAN_DK, BEKCI_NABIZ_TAVAN_DK, BEKCI_NABIZ_OLU_DK, SUREC_KIMLIGI } from './ekip-bekci';
import { EkipBekciService } from './ekip-bekci.service';

const T = (dkOnce: number, simdi: Date) => new Date(simdi.getTime() - dkOnce * 60000);

describe('ekip bekçi — bayat koşu seçimi', () => {
  const simdi = new Date('2026-09-13T06:00:00Z');
  const is = (id: string, dkOnce: number, ek: Partial<any> = {}) => ({
    id,
    agent: 'ekip:kdv',
    status: 'running',
    startedAt: T(dkOnce, simdi),
    createdAt: T(dkOnce + 1, simdi),
    ...ek,
  });

  it('süreç belleğinde koşan iş asla bayat sayılmaz (tavanı aşsa da)', () => {
    const k = bayatKosulariSec([is('a', 500)], { simdi, aktifMi: () => true, surecBaslangici: T(10, simdi) });
    expect(k).toEqual([]);
  });

  it('açılış taraması: süreç öncesi başlamış running iş → sunucu_yeniden_basladi', () => {
    const k = bayatKosulariSec([is('a', 20), is('b', 2)], { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi) });
    expect(k.map((x) => [x.id, x.neden, x.eskiDurum])).toEqual([['a', 'sunucu_yeniden_basladi', 'running']]);
    expect(k[0].metin).toContain('Sunucu yeniden başlatıldığı');
    expect(k[0].metin).toContain('20 dk');
  });

  it('düzenli tarama: tavanı aşan iş → sure_asimi; aşmayan dokunulmaz', () => {
    const k = bayatKosulariSec([is('a', 130), is('b', 90)], { simdi, aktifMi: () => false, tavanDk: 120 });
    expect(k.map((x) => [x.id, x.neden])).toEqual([['a', 'sure_asimi']]);
    expect(k[0].metin).toContain('120 dakikalık');
  });

  it('running/pending olmayan ya da ekip dışı işler seçilmez', () => {
    const k = bayatKosulariSec(
      [is('a', 500, { status: 'done' }), is('b', 500, { agent: 'luca' }), is('c', 500, { status: 'failed' })],
      { simdi, aktifMi: () => false, surecBaslangici: T(1, simdi), tavanDk: 10 },
    );
    expect(k).toEqual([]);
  });

  // PLAN/19 H9-a (2026-09-14): 'pending' takılı iş — runner pending→running geçişini anında yapar; 10 dk'dır pending
  // kalan iş ölmüş sürecin kalıntısıdır ve ekip_ajan_baslat "çalışan iş var" diye yenisini açmıyordu.
  it('açılış taraması: 10 dk\'dan eski pending → takili_pending (eskiDurum pending); taze pending dokunulmaz', () => {
    const k = bayatKosulariSec(
      [is('eski', 0, { status: 'pending', startedAt: null, createdAt: T(BEKCI_PENDING_TAVAN_DK + 5, simdi) }), is('taze', 0, { status: 'pending', startedAt: null, createdAt: T(3, simdi) })],
      { simdi, aktifMi: () => false, surecBaslangici: T(1, simdi) },
    );
    expect(k.map((x) => [x.id, x.neden, x.eskiDurum])).toEqual([['eski', 'takili_pending', 'pending']]);
    expect(k[0].metin).toContain('süreç yeniden başladı, iş takılı kalmıştı');
    expect(k[0].metin).toContain('15 dk');
  });

  it('düzenli taramada pending işe bakılmaz (yalnız açılış)', () => {
    const k = bayatKosulariSec([is('p', 0, { status: 'pending', startedAt: null, createdAt: T(500, simdi) })], { simdi, aktifMi: () => false, tavanDk: 10 });
    expect(k).toEqual([]);
  });

  // PLAN/19 H9-b (2026-09-14): payload.surec = bu sürecin kimliği → kendi canlı koşusu, dokunma; başka süreç / alan yok → aday.
  it('süreç kimliği: payload.surec bu sürece eşitse dokunulmaz (tavanı aşsa, süreç öncesi görünse de); farklı ya da yoksa aday', () => {
    const isler = [
      is('benim', 500, { payload: { surec: 'p1@100' } }),
      is('baska', 500, { payload: { surec: 'p0@50' } }),
      is('eski', 500, { payload: { gorev: 'x' } }),
      is('bosPayload', 500, { payload: null }),
    ];
    const k = bayatKosulariSec(isler, { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi), tavanDk: 120, surecKimligi: 'p1@100' });
    expect(k.map((x) => x.id).sort()).toEqual(['baska', 'bosPayload', 'eski']);
    // surecKimligi verilmezse (eski çağrı biçimi) herkes aday
    const k2 = bayatKosulariSec(isler, { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi), tavanDk: 120 });
    expect(k2.map((x) => x.id).sort()).toEqual(['baska', 'benim', 'bosPayload', 'eski']);
    // pending için de aynı kural
    const k3 = bayatKosulariSec(
      [is('pBenim', 0, { status: 'pending', startedAt: null, createdAt: T(60, simdi), payload: { surec: 'p1@100' } })],
      { simdi, aktifMi: () => false, surecBaslangici: T(1, simdi), surecKimligi: 'p1@100' },
    );
    expect(k3).toEqual([]);
  });

  // NABIZ (2026-09-15): dağıtım drenajı — eski süreç koşuyu bitirirken yeni sürecin bekçisi "sunucu yeniden başladı" diye kapatmasın.
  it('nabız taze (≤2 dk) → açılış taramasında bile dokunulmaz (drenajdaki eski süreç koşuyu yürütüyor)', () => {
    const isler = [
      is('drenajda', 20, { payload: { surec: 'eski@1', nabiz: T(1, simdi).toISOString() } }),
      is('sinirda', 20, { payload: { surec: 'eski@1', nabiz: T(BEKCI_NABIZ_TAVAN_DK, simdi).toISOString() } }),
      is('nabizsiz', 20, { payload: { surec: 'eski@1' } }),
    ];
    const k = bayatKosulariSec(isler, { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi), surecKimligi: 'yeni@2' });
    expect(k.map((x) => [x.id, x.neden])).toEqual([['nabizsiz', 'sunucu_yeniden_basladi']]);
  });

  it('nabız kesildi (>4 dk) → açılışta da düzenli taramada da nabiz_kesildi; tavanı beklemez', () => {
    const olu = is('olu', 30, { payload: { surec: 'eski@1', nabiz: T(BEKCI_NABIZ_OLU_DK + 1, simdi).toISOString() } });
    const k1 = bayatKosulariSec([olu], { simdi, aktifMi: () => false, tavanDk: 120 });
    expect(k1.map((x) => [x.id, x.neden, x.eskiDurum])).toEqual([['olu', 'nabiz_kesildi', 'running']]);
    expect(k1[0].metin).toContain('sunucu kopyası durdu');
    expect(k1[0].metin).toContain('5 dk önce');
    const k2 = bayatKosulariSec([olu], { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi), tavanDk: 120 });
    expect(k2.map((x) => x.neden)).toEqual(['nabiz_kesildi']);
    // 2-4 dk arası gri bölge: açılışta süreç öncesi kuralı, düzenli taramada tavan kuralı işler
    const gri = is('gri', 30, { payload: { surec: 'eski@1', nabiz: T(3, simdi).toISOString() } });
    expect(bayatKosulariSec([gri], { simdi, aktifMi: () => false, tavanDk: 120 })).toEqual([]);
    expect(bayatKosulariSec([gri], { simdi, aktifMi: () => false, surecBaslangici: T(5, simdi) }).map((x) => x.neden)).toEqual(['sunucu_yeniden_basladi']);
  });

  it('süreç belleğindeki koşu nabzı eski görünse de dokunulmaz; isinNabzi bozuk değeri null sayar', () => {
    const k = bayatKosulariSec([is('a', 30, { payload: { nabiz: T(30, simdi).toISOString() } })], { simdi, aktifMi: () => true, tavanDk: 5 });
    expect(k).toEqual([]);
    expect(isinNabzi({ payload: { nabiz: 'saçma' } } as any)).toBeNull();
    expect(isinNabzi({ payload: { nabiz: 12345 } } as any)).toBeNull();
    expect(isinNabzi({ payload: null } as any)).toBeNull();
    expect(isinNabzi({ payload: { nabiz: '2026-09-15T00:00:00.000Z' } } as any)?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('SUREC_KIMLIGI pid@zaman biçiminde ve süreç ömrünce sabit', () => {
    expect(SUREC_KIMLIGI).toMatch(/^\d+@\d{13}$/);
    expect(SUREC_KIMLIGI.startsWith(`${process.pid}@`)).toBe(true);
  });

  it('startedAt yoksa createdAt kullanılır', () => {
    const k = bayatKosulariSec([is('a', 0, { startedAt: null, createdAt: T(200, simdi) })], { simdi, aktifMi: () => false, tavanDk: 120 });
    expect(k.map((x) => x.id)).toEqual(['a']);
  });

  it('tavan env: geçersiz/küçük değer varsayılana düşer', () => {
    expect(kosuTavanDk({} as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: 'abc' } as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: '5' } as any)).toBe(EKIP_KOSU_TAVAN_DK_VARSAYILAN);
    expect(kosuTavanDk({ EKIP_KOSU_TAVAN_DK: '45' } as any)).toBe(45);
  });

  it('sonuç birleştirme eski raporu korur, hata + bayat ekler', () => {
    const r = bayatSonucBirlestir({ rapor: 'yarım rapor', toolUses: [1] }, { id: 'a', neden: 'sure_asimi', eskiDurum: 'running', metin: 'aştı' });
    expect(r).toEqual({ rapor: 'yarım rapor', toolUses: [1], hata: 'aştı', bayat: true, bayatNeden: 'sure_asimi' });
    expect(bayatSonucBirlestir(null, { id: 'a', neden: 'sunucu_yeniden_basladi', eskiDurum: 'running', metin: 'x' }).bayat).toBe(true);
  });
});

// Servis: açılışta running+pending sorgusu, güncellemede eski durum yarış koruması, kendi sürecinin kaydına dokunmaz (sahte Prisma).
describe('ekip bekçi — servis taraması (sahte DB)', () => {
  const simdi = Date.now();
  const dk = (n: number) => new Date(simdi - n * 60000);

  function servisKur(isler: any[]) {
    const sorgular: any[] = [];
    const guncellemeler: any[] = [];
    const olaylar: any[] = [];
    const prisma = {
      agentCommand: {
        findMany: async (q: any) => (sorgular.push(q.where), isler),
        updateMany: async (q: any) => (guncellemeler.push(q), { count: 1 }),
      },
      agentEvent: { create: async (d: any) => (olaylar.push(d.data), {}) },
    };
    const runner = { kosuAktifMi: () => false };
    const s = new EkipBekciService(prisma as any, runner as any);
    (s as any).surecBaslangici = dk(3);
    (s as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined };
    return { s, sorgular, guncellemeler, olaylar };
  }

  it('açılış: pending de sorgulanır; takılı pending ve ölmüş sürecin running işi failed; kendi sürecinin kaydı atlanır', async () => {
    const { s, sorgular, guncellemeler, olaylar } = servisKur([
      { id: 'p', tenantId: 't', agent: 'ekip:fatura', status: 'pending', startedAt: null, createdAt: dk(30), result: null, payload: { taxpayerId: 'tx1' } },
      { id: 'r', tenantId: 't', agent: 'ekip:denetci', status: 'running', startedAt: dk(40), createdAt: dk(41), result: { rapor: 'yarım' }, payload: { surec: 'olmus@1' } },
      { id: 'benim', tenantId: 't', agent: 'ekip:risk', status: 'running', startedAt: dk(40), createdAt: dk(41), result: null, payload: { surec: SUREC_KIMLIGI } },
    ]);
    const n = await s.tara(true);
    expect(n).toBe(2);
    expect(sorgular[0]).toEqual({ agent: { startsWith: 'ekip:' }, status: { in: ['running', 'pending'] } });
    expect(guncellemeler.map((g) => [g.where.id, g.where.status, g.data.status])).toEqual([
      ['p', 'pending', 'failed'],
      ['r', 'running', 'failed'],
    ]);
    expect(guncellemeler[0].data.result).toMatchObject({ bayat: true, bayatNeden: 'takili_pending' });
    expect(guncellemeler[0].data.result.hata).toContain('iş takılı kalmıştı');
    expect(guncellemeler[1].data.result).toMatchObject({ rapor: 'yarım', bayat: true, bayatNeden: 'sunucu_yeniden_basladi' });
    expect(olaylar.map((o) => [o.action, o.meta.bayatNeden, o.meta.taxpayerId])).toEqual([
      ['fatura', 'takili_pending', 'tx1'],
      ['denetci', 'sunucu_yeniden_basladi', null],
    ]);
  });

  it('düzenli tarama: yalnız running sorgulanır', async () => {
    const { s, sorgular, guncellemeler } = servisKur([]);
    expect(await s.tara(false)).toBe(0);
    expect(sorgular[0]).toEqual({ agent: { startsWith: 'ekip:' }, status: 'running' });
    expect(guncellemeler).toEqual([]);
  });
});
