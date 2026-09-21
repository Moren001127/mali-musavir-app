/**
 * /ekip/kadro ekleri (PLAN/20 §E-6): reçete başlıkları (kadro/<ajan>/receteler.md "## R1 — …") + kapalı personel;
 * /ekip/durum ekleri (kota / kuyruk / bugunPlan). Gerçek kadro dosyaları okunur (repo içi), gerisi sahte.
 */
import { EkipController } from './ekip.controller';
import { EkipKotaService } from './ekip-kota.service';
import { KAPALI_PERSONEL, personelKapaliMi, receteBasliklariniAyikla, receteleriOku } from './ekip-receteler';

describe('ekip reçete başlıkları', () => {
  it('"## KOD — başlık" satırları {kod, baslik}; kodsuz başlıklar ve tekrarlar atlanır', () => {
    const md = [
      '# Beyanname Uzmanı — Reçeteler',
      'Ortak: …',
      "## R1 — KDV Kontrol zinciri (aylık) — PORTAL işi; Luca Operatörü'ne DEVRETME",
      '1) adım',
      '## R10 — e-Tebligat İLETİMİ',
      '## R-K1 — Mükellef risk puan kartı (çeyreklik tam kart) (mevcut iş)',
      '## S1 - Aylık   bordro özeti',
      '## M2: Soruya cevap',
      '## Dönem çevirisi (atama metnine BU biçimde yaz)',
      '## DEVİR CEVABI — bana gelen PORTAL işi',
      '## §5 Yönlendirme tablosu',
      '## R1 — tekrar',
      '### R99 — alt başlık sayılmaz',
    ].join('\n');
    expect(receteBasliklariniAyikla(md)).toEqual([
      { kod: 'R1', baslik: "KDV Kontrol zinciri (aylık) — PORTAL işi; Luca Operatörü'ne DEVRETME" },
      { kod: 'R10', baslik: 'e-Tebligat İLETİMİ' },
      { kod: 'R-K1', baslik: 'Mükellef risk puan kartı (çeyreklik tam kart) (mevcut iş)' },
      { kod: 'S1', baslik: 'Aylık bordro özeti' },
      { kod: 'M2', baslik: 'Soruya cevap' },
    ]);
    expect(receteBasliklariniAyikla('')).toEqual([]);
  });

  it('gerçek kadro dosyaları: beyanname R1/R3/R7, bordro-sgk S1-S3, risk R-K1/R-K2; olmayan ajan boş', async () => {
    expect((await receteleriOku('beyanname')).map((r) => r.kod)).toEqual(['R1', 'R3', 'R7']);
    expect((await receteleriOku('bordro-sgk')).map((r) => r.kod)).toEqual(['S1', 'S2', 'S3']);
    expect((await receteleriOku('risk')).map((r) => r.kod)).toEqual(['R-K1', 'R-K2']);
    expect((await receteleriOku('edefter')).map((r) => r.kod)).toEqual(['K1', 'K2', 'K3']);
    expect(await receteleriOku('yok-boyle')).toEqual([]);
    expect(await receteleriOku('../../etc')).toEqual([]);
  });

  it('kapalı personel: yalnız bordro-sgk (bordro modülü kapalı)', () => {
    expect(personelKapaliMi('bordro-sgk')).toEqual({ neden: 'Bordro modülü kapalı — portalda bordro verisi yok' });
    expect(personelKapaliMi('beyanname')).toBeNull();
    expect(Object.keys(KAPALI_PERSONEL)).toEqual(['bordro-sgk']);
  });
});

describe('ekip controller — kadro ve durum ekleri', () => {
  it('GET /ekip/kadro: her personele receteler + kapali eklenir', async () => {
    const runner = { kadroOzeti: async () => [{ id: 'beyanname', ad: 'B' }, { id: 'bordro-sgk', ad: 'S' }, { id: 'luca-operator', ad: 'L' }] };
    const c = new EkipController(runner as any, {} as any, {} as any, {} as any, {} as any);
    const r: any = await c.kadro({ user: { tenantId: 't1' } });
    expect(r.ajanlar[0]).toMatchObject({ id: 'beyanname', kapali: null });
    expect(r.ajanlar[0].receteler.map((x: any) => x.kod)).toEqual(['R1', 'R3', 'R7']);
    expect(r.ajanlar[1]).toMatchObject({ id: 'bordro-sgk', kapali: { neden: 'Bordro modülü kapalı — portalda bordro verisi yok' } });
    expect(r.ajanlar[1].receteler.map((x: any) => x.kod)).toEqual(['S1', 'S2', 'S3']);
    expect(r.ajanlar[2].receteler).toEqual([]); // luca-operator reçetelerinde kodlu başlık yok
  });

  it('GET /ekip/durum: kota / kuyruk / bugunPlan alanları; servisler yoksa (eski kurulum) boş değerler', async () => {
    const runner = {
      bekleyenOnaySayisi: async () => 1,
      bugunkuKosuSayisi: async () => 2,
      calisanSayisi: async () => 0,
      bugunHataSayisi: async () => 0,
      sonSabahOzeti: async () => null,
    };
    const luca = { getOperatorDeviceStatus: async () => ({ online: true, deviceId: 'pc1' }) };
    const akis = { sayaclar: async () => ({ suruyor: 0, onay: 1, istek: 0, bitti: 3, gecikti: 0 }) };
    const kota = new EkipKotaService();
    (kota as any).logger = { warn: () => undefined, log: () => undefined };
    kota.hatadanIsaretle("You've hit your weekly limit · resets in 2 hours");
    const kuyruk = {
      durumOzeti: async () => ({ aktif: 1, suruyorId: 'k1', siradaki: { taxpayerId: 'a', ad: 'A Ltd' } }),
      bugunPlan: async () => ({ planlanan: 8, suruyor: 1, biten: 3, yarim: 1, bekleyen: 3 }),
    };
    const c = new EkipController(runner as any, {} as any, {} as any, luca as any, akis as any, {} as any, kuyruk as any, kota);
    const d: any = await c.durum({ user: { tenantId: 't1' } });
    expect(d.kota.doldu).toBe(true);
    expect(d.kota.sifirlanma).toBeInstanceOf(Date);
    expect(d.kota.sonHata).toContain('weekly limit');
    expect(d.kuyruk).toEqual({ aktif: 1, suruyorId: 'k1', siradaki: { taxpayerId: 'a', ad: 'A Ltd' } });
    expect(d.bugunPlan).toEqual({ planlanan: 8, suruyor: 1, biten: 3, yarim: 1, bekleyen: 3 });
    expect(d).toMatchObject({ bekleyenOnay: 1, bugunkuKosu: 2, operator: { cevrimici: true, cihaz: 'pc1' } });

    const eski = new EkipController(runner as any, {} as any, {} as any, luca as any, akis as any);
    const d2: any = await eski.durum({ user: { tenantId: 't1' } });
    expect(d2.kota).toEqual({ doldu: false, sifirlanma: null, sonHata: null });
    expect(d2.kuyruk).toEqual({ aktif: 0, suruyorId: null, siradaki: null });
    expect(d2.bugunPlan).toEqual({ planlanan: 0, suruyor: 0, biten: 0, yarim: 0, bekleyen: 0 });
  });

  it('POST /ekip/kuyruk: kaynak toplu, olusturan kullanıcı, dryRun varsayılan kuru', async () => {
    const cagrilar: any[] = [];
    const kuyruk = { olustur: async (p: any) => (cagrilar.push(p), { ok: true, id: 'k1', ogeSayisi: 2, atlanan: 0 }) };
    const c = new EkipController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, kuyruk as any, {} as any);
    await c.kuyrukOlustur({ user: { tenantId: 't1', sub: 'u9' } }, { ajanId: 'beyanname', sablon: '{mukellef} KDV', taxpayerIds: ['a', 'b'] });
    expect(cagrilar[0]).toEqual({ tenantId: 't1', ad: null, ajanId: 'beyanname', sablon: '{mukellef} KDV', taxpayerIds: ['a', 'b'], dryRun: true, kaynak: 'toplu', olusturan: 'u9' });
    await c.kuyrukOlustur({ user: { tenantId: 't1', sub: 'u9' } }, { ad: 'Toplu', ajanId: 'fatura', sablon: 'x', taxpayerIds: ['a'], dryRun: false });
    expect(cagrilar[1]).toMatchObject({ ad: 'Toplu', dryRun: false, kaynak: 'toplu' });
  });
});
