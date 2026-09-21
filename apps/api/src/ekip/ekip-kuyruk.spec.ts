/**
 * KUYRUK İŞLEYİCİSİ (PLAN/20 §D): sıra (tikte tek öğe, bitince sıradaki), kalıp doldurma ({mukellef}/{donem}), tek koşu kilidi,
 * kota beklemesi (öğe bekliyor'da kalır, kuyruk kota_bekliyor, sıfırlanınca sürer), Durdur (süren koşuya iptal) / Devam,
 * kapanış drenajı, kiracı dışı mükellef 'atlandi'. Sahte Prisma + sahte runner; ağ/DB/alt süreç yok.
 */
import { EkipKotaService } from './ekip-kota.service';
import { bugunPlani, kuyrukOzeti, sablonDoldur, tenantKuyruguSec } from './ekip-kuyruk';
import { EkipKuyrukService } from './ekip-kuyruk.service';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ekip kuyruk — saf yardımcılar', () => {
  it('sablonDoldur: yer tutucular dolar, ad yoksa silinir, çift boşluk tekleşir', () => {
    expect(sablonDoldur('{mukellef} için {donem} dönemi KDV kontrolünü yap (R1).', { mukellef: 'A Ltd', donem: '2026-08' })).toBe('A Ltd için 2026-08 dönemi KDV kontrolünü yap (R1).');
    expect(sablonDoldur('{ Mukellef } faturalarını işle', { mukellef: null })).toBe('faturalarını işle');
    expect(sablonDoldur('Ofis özeti {baska}', {})).toBe('Ofis özeti {baska}');
  });

  it('kuyrukOzeti: sayaçlar + sıradaki + süren; bugunPlani; tenantKuyruguSec önce suruyor sonra en eski', () => {
    const satir: any = {
      id: 'k1', tenantId: 't', ad: 'x', ajanId: 'beyanname', sablon: 's', dryRun: true, kaynak: 'toplu', rutinId: null, durum: 'suruyor', aktifIsId: 'is2', olusturan: 'u',
      createdAt: new Date(), updatedAt: new Date(), bitisAt: null,
      ogeler: [
        { taxpayerId: 'a', ad: 'A', durum: 'bitti', isId: 'is1' },
        { taxpayerId: 'b', ad: 'B', durum: 'suruyor', isId: 'is2' },
        { taxpayerId: 'c', ad: 'C', durum: 'bekliyor' },
        { taxpayerId: 'd', ad: 'D', durum: 'hata', hata: 'x' },
        { taxpayerId: 'e', ad: null, durum: 'atlandi' },
        'bozuk',
      ],
    };
    const o = kuyrukOzeti(satir);
    expect(o).toMatchObject({ id: 'k1', durum: 'suruyor', toplam: 5, biten: 1, hatali: 1, bekleyen: 2, atlanan: 1, siradaki: { taxpayerId: 'c', ad: 'C' }, suruyor: { taxpayerId: 'b', ad: 'B', isId: 'is2' }, aktifIsId: 'is2' });
    expect(bugunPlani([satir, { ogeler: null }])).toEqual({ planlanan: 5, suruyor: 1, biten: 1, yarim: 2, bekleyen: 1 });
    const eski = { ...satir, id: 'eski', durum: 'bekliyor', createdAt: new Date(1000) };
    const yeni = { ...satir, id: 'yeni', durum: 'bekliyor', createdAt: new Date(2000) };
    const suren = { ...satir, id: 'suren', durum: 'suruyor', createdAt: new Date(3000) };
    expect(tenantKuyruguSec([yeni, eski, suren])?.id).toBe('suren');
    expect(tenantKuyruguSec([yeni, eski])?.id).toBe('eski');
    expect(tenantKuyruguSec([{ ...satir, durum: 'bitti' }])).toBeNull();
  });
});

// ─── Sahte ortam ───

interface SahteSecenek {
  /** runner.calistir davranışı: 'ok' | 'hata:<metin>' | 'kota' | 'bekle' (dıştan bitir) */
  kosu?: (p: any) => 'ok' | `hata:${string}` | 'kota' | 'bekle';
  surenKosu?: number;
  kapaniyor?: boolean;
  taxpayers?: Array<{ id: string; companyName?: string; firstName?: string; lastName?: string }>;
}

function ortamKur(o: SahteSecenek = {}) {
  const kuyruklar: any[] = [];
  const isler: Record<string, any> = {};
  const calistirilan: any[] = [];
  const iptaller: any[] = [];
  let sayac = 0;
  let isSayac = 0;
  const bekleyenler: Array<() => void> = [];
  const taxpayers = o.taxpayers || [
    { id: 'a', companyName: 'A Ltd' },
    { id: 'b', firstName: 'Ayşe', lastName: 'Yılmaz' },
    { id: 'c', companyName: 'C AŞ' },
  ];
  const suz = (rows: any[], where: any) =>
    rows.filter((r) => {
      for (const [k, v] of Object.entries(where || {})) {
        if (k === 'OR') {
          if (!(v as any[]).some((alt) => suz([r], alt).length)) return false;
          continue;
        }
        if (k === 'createdAt') {
          if ((v as any).gte && !(r.createdAt >= (v as any).gte)) return false;
          continue;
        }
        if (v && typeof v === 'object' && 'in' in (v as any)) {
          if (!(v as any).in.includes(r[k])) return false;
          continue;
        }
        if (r[k] !== v) return false;
      }
      return true;
    });
  const prisma = {
    taxpayer: { findMany: async (q: any) => taxpayers.filter((t) => q.where.id.in.includes(t.id)) },
    agentCommand: {
      count: async () => o.surenKosu || 0,
      findUnique: async (q: any) => isler[q.where.id] || null,
    },
    ekipKuyruk: {
      create: async (q: any) => {
        const r = { id: `k${++sayac}`, aktifIsId: null, bitisAt: null, createdAt: new Date(), updatedAt: new Date(), ...q.data, ogeler: JSON.parse(JSON.stringify(q.data.ogeler)) };
        kuyruklar.push(r);
        return r;
      },
      findMany: async (q: any) => suz(kuyruklar, q?.where).map((r) => ({ ...r, ogeler: JSON.parse(JSON.stringify(r.ogeler)) })),
      findFirst: async (q: any) => {
        const r = suz(kuyruklar, q?.where)[0];
        return r ? { ...r, ogeler: JSON.parse(JSON.stringify(r.ogeler)) } : null;
      },
      findUnique: async (q: any) => {
        const r = kuyruklar.find((x) => x.id === q.where.id);
        return r ? { ...r, ogeler: JSON.parse(JSON.stringify(r.ogeler)) } : null;
      },
      update: async (q: any) => {
        const r = kuyruklar.find((x) => x.id === q.where.id);
        Object.assign(r, q.data, q.data.ogeler ? { ogeler: JSON.parse(JSON.stringify(q.data.ogeler)) } : {}, { updatedAt: new Date() });
        return r;
      },
    },
  };
  const runner = {
    kapaniyorMu: () => o.kapaniyor === true,
    pano: async () => ({ donemler: [{ istenenDonem: '2026-09', beyannameDonem: '2026-08', mukellefler: [] }] }),
    iptalEt: (tenantId: string, isId: string, neden: string) => {
      iptaller.push([tenantId, isId, neden]);
      const is = isler[isId];
      if (is && is.status === 'running') {
        is.iptal = true;
        return { ok: true, isId };
      }
      return { ok: false, isId, error: 'Çalışan koşu bulunamadı (bitmiş olabilir).' };
    },
    calistir: async (p: any) => {
      calistirilan.push(p);
      const karar = o.kosu ? o.kosu(p) : 'ok';
      if (p.tenantId === 'kapali') {
        p.emit?.({ type: 'error', error: 'Sunucu yeniden başlıyor; bu iş açılmadı. Bir dakika sonra aynı görevi yeniden verin.' });
        return { isId: '', hata: 'Sunucu yeniden başlıyor; bu iş açılmadı. Bir dakika sonra aynı görevi yeniden verin.' };
      }
      const isId = `is${++isSayac}`;
      isler[isId] = { status: 'running', result: null };
      p.emit?.({ type: 'baslangic', isId, ajanId: p.ajanId, model: 'm', dryRun: p.dryRun });
      await bekle(5);
      if (karar === 'bekle') await new Promise<void>((r) => bekleyenler.push(r));
      if (isler[isId].iptal) {
        isler[isId] = { status: 'failed', result: { hata: 'iptal edildi (Muzaffer Bey)' } };
        p.emit?.({ type: 'error', error: 'iptal edildi (Muzaffer Bey)', isId });
        return { isId, hata: 'iptal edildi (Muzaffer Bey)', rapor: '' };
      }
      if (karar === 'kota') {
        const hata = "You've hit your weekly limit · resets Sep 21, 9am (Europe/Istanbul)";
        isler[isId] = { status: 'failed', result: { hata } };
        kota.hatadanIsaretle(hata); // runner'ın yaptığı gibi
        p.emit?.({ type: 'error', error: hata, isId });
        return { isId, hata, rapor: '' };
      }
      if (typeof karar === 'string' && karar.startsWith('hata:')) {
        const hata = karar.slice(5);
        isler[isId] = { status: 'failed', result: { hata } };
        p.emit?.({ type: 'error', error: hata, isId });
        return { isId, hata, rapor: '' };
      }
      isler[isId] = { status: 'done', result: { rapor: 'RAPOR: tamam' } };
      p.emit?.({ type: 'done', isId, model: 'm', toolUses: [], durationMs: 5, kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [] });
      return { isId, rapor: 'RAPOR: tamam' };
    },
  };
  const kota = new EkipKotaService();
  (kota as any).logger = { warn: () => undefined, log: () => undefined };
  const s = new EkipKuyrukService(prisma as any, runner as any, kota);
  const loglar: string[] = [];
  (s as any).logger = { warn: (m: string) => loglar.push(`warn ${m}`), log: (m: string) => loglar.push(`log ${m}`), error: (m: string) => loglar.push(`error ${m}`), debug: () => undefined };
  /** Bir tik + arka plandaki öğe bitene kadar bekle. */
  const tikVeBekle = async () => {
    const b = await s.tara();
    for (let i = 0; i < 200 && s.isleyenKuyruklar().length; i++) await bekle(5);
    return b;
  };
  return { s, prisma, kuyruklar, isler, calistirilan, iptaller, kota, loglar, bekleyenler, tikVeBekle };
}

describe('ekip kuyruk — oluşturma', () => {
  it('adlar taxpayer tablosundan dolar; kiracıda olmayan id atlandi; tekrar eden id tek; bilinmeyen personel / boş kalıp reddedilir', async () => {
    const t = ortamKur();
    const r: any = await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '{mukellef} KDV', taxpayerIds: ['a', 'b', 'yok', 'a'], dryRun: false, kaynak: 'toplu', olusturan: 'u1' });
    expect(r).toEqual({ ok: true, id: 'k1', ogeSayisi: 2, atlanan: 1 });
    expect(t.kuyruklar[0]).toMatchObject({ tenantId: 't1', ad: 'KDV/Beyanname Uzmanı — toplu görev', ajanId: 'beyanname', dryRun: false, kaynak: 'toplu', durum: 'bekliyor', olusturan: 'u1', rutinId: null });
    expect(t.kuyruklar[0].ogeler).toEqual([
      { taxpayerId: 'a', ad: 'A Ltd', donem: null, durum: 'bekliyor', hata: null },
      { taxpayerId: 'b', ad: 'Ayşe Yılmaz', donem: null, durum: 'bekliyor', hata: null },
      { taxpayerId: 'yok', ad: null, donem: null, durum: 'atlandi', hata: 'Mükellef bu ofiste bulunamadı.' },
    ]);
    expect(await t.s.olustur({ tenantId: 't1', ajanId: 'yokboyle', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' })).toMatchObject({ ok: false, error: expect.stringMatching(/Bilinmeyen personel/) });
    expect(await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '  ', taxpayerIds: ['a'], kaynak: 'toplu' })).toMatchObject({ ok: false, error: expect.stringMatching(/kalıbı boş/) });
    expect(await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: [], kaynak: 'toplu' })).toMatchObject({ ok: false, error: expect.stringMatching(/en az bir/) });
    // rutin kaynağı: ogeler ile (ofis işi taxpayerId null), kaynak rutin, dryRun varsayılan kuru
    const r2: any = await t.s.olustur({ tenantId: 't1', ad: 'Ofis', ajanId: 'koordinator', sablon: 'özet', ogeler: [{ taxpayerId: null }], kaynak: 'rutin', rutinId: 'r1' });
    expect(r2).toEqual({ ok: true, id: 'k2', ogeSayisi: 1, atlanan: 0 });
    expect(t.kuyruklar[1]).toMatchObject({ ad: 'Ofis', kaynak: 'rutin', rutinId: 'r1', dryRun: true, ogeler: [{ taxpayerId: null, ad: null, durum: 'bekliyor' }] });
  });
});

describe('ekip kuyruk — sıralı işleme', () => {
  it('tikte tek öğe koşar; kalıp mükellef adı + pano dönemiyle dolar; kaynak/kuyrukId/taxpayerId/dryRun runner\'a gider; bitince sıradaki; hepsi bitince kuyruk bitti', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '{mukellef} için {donem} dönemi KDV kontrolünü yap (R1).', taxpayerIds: ['a', 'b'], dryRun: false, kaynak: 'toplu', olusturan: 'u1' });
    expect(await t.tikVeBekle()).toEqual(['k1']);
    expect(t.calistirilan).toHaveLength(1);
    expect(t.calistirilan[0]).toMatchObject({ ajanId: 'beyanname', gorev: 'A Ltd için 2026-08 dönemi KDV kontrolünü yap (R1).', tenantId: 't1', userId: 'u1', taxpayerId: 'a', dryRun: false, kaynak: 'toplu', kuyrukId: 'k1' });
    let k = t.kuyruklar[0];
    expect(k.durum).toBe('suruyor');
    expect(k.aktifIsId).toBeNull();
    expect(k.ogeler[0]).toMatchObject({ durum: 'bitti', isId: 'is1', hata: null, donem: '2026-08' });
    expect(k.ogeler[0].bitisAt).toBeTruthy();
    expect(k.ogeler[1].durum).toBe('bekliyor');
    // ikinci tik → ikinci öğe
    await t.tikVeBekle();
    expect(t.calistirilan).toHaveLength(2);
    expect(t.calistirilan[1]).toMatchObject({ gorev: 'Ayşe Yılmaz için 2026-08 dönemi KDV kontrolünü yap (R1).', taxpayerId: 'b' });
    k = t.kuyruklar[0];
    expect(k.durum).toBe('bitti');
    expect(k.bitisAt).toBeTruthy();
    expect(k.ogeler.map((o: any) => o.durum)).toEqual(['bitti', 'bitti']);
    // üçüncü tik: iş yok
    expect(await t.tikVeBekle()).toEqual([]);
    expect(t.calistirilan).toHaveLength(2);
    // liste: son 5 bitmiş görünür
    const l = await t.s.listele('t1');
    expect(l.kuyruklar.map((x) => [x.id, x.durum, x.toplam, x.biten, x.hatali, x.siradaki])).toEqual([['k1', 'bitti', 2, 2, 0, null]]);
  });

  it('hata ile biten öğe hata olur, kuyruk sürer; kiracı başına tek kuyruk: ikinci kuyruk ilki bitince başlar', async () => {
    const t = ortamKur({ kosu: (p) => (p.taxpayerId === 'a' ? 'hata:Agent SDK (Max) sonucu hata döndü.' : 'ok') });
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '{mukellef}', taxpayerIds: ['a', 'b'], kaynak: 'toplu' });
    await t.s.olustur({ tenantId: 't1', ajanId: 'fatura', sablon: '{mukellef} faturaları', taxpayerIds: ['c'], kaynak: 'toplu' });
    await t.tikVeBekle();
    expect(t.kuyruklar[0].ogeler[0]).toMatchObject({ durum: 'hata', isId: 'is1', hata: 'Agent SDK (Max) sonucu hata döndü.' });
    expect(t.kuyruklar[0].durum).toBe('suruyor');
    expect(t.kuyruklar[1].durum).toBe('bekliyor');
    await t.tikVeBekle();
    expect(t.kuyruklar[0].durum).toBe('bitti');
    expect(t.calistirilan).toHaveLength(2);
    await t.tikVeBekle();
    expect(t.calistirilan).toHaveLength(3);
    expect(t.calistirilan[2]).toMatchObject({ ajanId: 'fatura', gorev: 'C AŞ faturaları', taxpayerId: 'c', dryRun: true });
    expect(t.kuyruklar[1].durum).toBe('bitti');
    const d = await t.s.durumOzeti('t1');
    expect(d).toEqual({ aktif: 0, suruyorId: null, siradaki: null });
    expect(await t.s.bugunPlan('t1')).toEqual({ planlanan: 3, suruyor: 0, biten: 2, yarim: 1, bekleyen: 0 });
  });

  it('tek koşu kilidi: kiracıda süren ekip koşusu varken öğe başlamaz; runner kapanıyorsa hiç başlamaz', async () => {
    const t = ortamKur({ surenKosu: 1 });
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    expect(await t.tikVeBekle()).toEqual([]);
    expect(t.calistirilan).toEqual([]);
    expect(t.kuyruklar[0].durum).toBe('bekliyor');
    const t2 = ortamKur({ kapaniyor: true });
    await t2.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    expect(await t2.tikVeBekle()).toEqual([]);
    expect(t2.calistirilan).toEqual([]);
  });

  it('kota: koşu kota hatasıyla bitince öğe bekliyor\'da kalır, kuyruk kota_bekliyor; kota kapalıyken tik başlatmaz; sıfırlanınca sürer', async () => {
    let kotaVer = true;
    const t = ortamKur({ kosu: () => (kotaVer ? 'kota' : 'ok') });
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '{mukellef}', taxpayerIds: ['a', 'b'], kaynak: 'toplu' });
    await t.tikVeBekle();
    expect(t.calistirilan).toHaveLength(1);
    let k = t.kuyruklar[0];
    expect(k.durum).toBe('kota_bekliyor');
    expect(k.ogeler[0]).toMatchObject({ durum: 'bekliyor', isId: 'is1', hata: expect.stringMatching(/weekly limit/) });
    expect(t.kota.acikMi()).toBe(false);
    // kota kapalı: tik hiçbir şey başlatmaz
    expect(await t.tikVeBekle()).toEqual([]);
    expect(t.calistirilan).toHaveLength(1);
    // durum ucu için: aktif 1, sıradaki a
    expect(await t.s.durumOzeti('t1')).toEqual({ aktif: 1, suruyorId: null, siradaki: { taxpayerId: 'a', ad: 'A Ltd' } });
    // sıfırlanma geldi (temizle ile taklit) → kuyruk kaldığı yerden (a) sürer
    t.kota.temizle();
    kotaVer = false;
    await t.tikVeBekle();
    expect(t.calistirilan).toHaveLength(2);
    expect(t.calistirilan[1]).toMatchObject({ taxpayerId: 'a' });
    k = t.kuyruklar[0];
    expect(k.ogeler[0]).toMatchObject({ durum: 'bitti', isId: 'is2', hata: null });
    expect(k.durum).toBe('suruyor');
    await t.tikVeBekle();
    expect(t.kuyruklar[0].durum).toBe('bitti');
  });

  it('kota başka yoldan dolmuşsa (runner işaretledi) tik bekleyen kuyruğu kota_bekliyor yapar; devam ile bekliyor\'a döner', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    t.kota.hatadanIsaretle('rate limit, resets 9pm');
    expect(await t.tikVeBekle()).toEqual([]);
    expect(t.kuyruklar[0].durum).toBe('kota_bekliyor');
    expect(await t.s.devam('t1', 'k1')).toEqual({ ok: true, id: 'k1', durum: 'bekliyor' });
    expect(t.kuyruklar[0].durum).toBe('bekliyor');
  });

  it('Durdur: süren koşuya iptal verilir (runner.iptalEt sahip), kuyruk durduruldu, öğe hata; Devam → bekliyor → kalanlar sürer', async () => {
    const t = ortamKur({ kosu: (p) => (p.taxpayerId === 'a' ? 'bekle' : 'ok') });
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: '{mukellef}', taxpayerIds: ['a', 'b'], kaynak: 'toplu' });
    await t.s.tara();
    await bekle(20); // baslangic geldi, koşu bekliyor
    expect(t.kuyruklar[0]).toMatchObject({ durum: 'suruyor', aktifIsId: 'is1' });
    expect((await t.s.durumOzeti('t1')).suruyorId).toBe('k1');
    expect((await t.s.listele('t1')).kuyruklar[0].suruyor).toEqual({ taxpayerId: 'a', ad: 'A Ltd', isId: 'is1' });
    // başka kiracı durduramaz
    expect(await t.s.durdur('t2', 'k1')).toMatchObject({ ok: false, error: 'Kuyruk bulunamadı.' });
    const r = await t.s.durdur('t1', 'k1');
    expect(r).toEqual({ ok: true, id: 'k1', durum: 'durduruldu', iptal: { ok: true, isId: 'is1' } });
    expect(t.iptaller).toEqual([['t1', 'is1', 'sahip']]);
    t.bekleyenler.forEach((b) => b()); // runner iptali görüp döner
    for (let i = 0; i < 100 && t.s.isleyenKuyruklar().length; i++) await bekle(5);
    const k = t.kuyruklar[0];
    expect(k.durum).toBe('durduruldu');
    expect(k.aktifIsId).toBeNull();
    expect(k.ogeler[0]).toMatchObject({ durum: 'hata', isId: 'is1', hata: 'iptal edildi (Muzaffer Bey)' });
    expect(k.ogeler[1].durum).toBe('bekliyor');
    // durdurulmuş kuyruk tikte alınmaz
    expect(await t.tikVeBekle()).toEqual([]);
    expect(t.calistirilan).toHaveLength(1);
    // ikinci Durdur zararsız; Devam → bekliyor → b koşar → bitti
    expect(await t.s.durdur('t1', 'k1')).toEqual({ ok: true, id: 'k1', durum: 'durduruldu', iptal: null });
    expect(await t.s.devam('t1', 'k1')).toEqual({ ok: true, id: 'k1', durum: 'bekliyor' });
    await t.tikVeBekle();
    expect(t.calistirilan).toHaveLength(2);
    expect(t.calistirilan[1]).toMatchObject({ taxpayerId: 'b' });
    expect(t.kuyruklar[0].durum).toBe('bitti');
    expect(await t.s.devam('t1', 'k1')).toMatchObject({ ok: false, error: 'Kuyruk zaten bitmiş.' });
    expect(await t.s.durdur('t1', 'k1')).toMatchObject({ ok: false, error: 'Kuyruk zaten bitmiş.' });
  });

  it('durdurulmuş kuyrukta kalan öğe yoksa Devam kuyruğu bitti yapar', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    await t.tikVeBekle();
    t.kuyruklar[0].durum = 'durduruldu'; // yarışta Durdur son öğe bitince gelmiş gibi
    expect(await t.s.devam('t1', 'k1')).toEqual({ ok: true, id: 'k1', durum: 'bitti' });
  });

  it('süreç yeniden başlamış: takılı suruyor öğe iş dosyasına göre çözülür (done → bitti, failed → hata, running → beklenir)', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a', 'b', 'c'], kaynak: 'toplu' });
    const k = t.kuyruklar[0];
    k.durum = 'suruyor';
    k.ogeler[0] = { ...k.ogeler[0], durum: 'suruyor', isId: 'eski-1' };
    t.isler['eski-1'] = { status: 'running', result: null };
    // hâlâ koşuyor (drenajdaki eski süreç) → dokunulmaz, yeni öğe açılmaz
    await t.tikVeBekle();
    expect(t.calistirilan).toEqual([]);
    expect(t.kuyruklar[0].ogeler[0].durum).toBe('suruyor');
    // eski süreç öldü, bekçi failed yazdı → öğe hata, sıradaki (b) başlar
    t.isler['eski-1'] = { status: 'failed', result: { hata: 'Sunucu yeniden başlatıldığı için bu koşu yarım kaldı' } };
    await t.tikVeBekle();
    expect(t.kuyruklar[0].ogeler[0]).toMatchObject({ durum: 'hata', hata: expect.stringMatching(/yarım kaldı/) });
    expect(t.calistirilan[0]).toMatchObject({ taxpayerId: 'b' });
    // done kapanmış eski iş → bitti
    t.kuyruklar[0].ogeler[2] = { ...t.kuyruklar[0].ogeler[2], durum: 'suruyor', isId: 'eski-2' };
    t.isler['eski-2'] = { status: 'done', result: { rapor: 'ok' } };
    await t.tikVeBekle();
    expect(t.kuyruklar[0].ogeler[2]).toMatchObject({ durum: 'bitti', isId: 'eski-2' });
    expect(t.kuyruklar[0].durum).toBe('bitti');
  });

  it('runner "Sunucu yeniden başlıyor" derse (iş açılmadı) öğe bekliyor\'da kalır, kuyruk bitmez', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 'kapali', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    await t.tikVeBekle();
    expect(t.kuyruklar[0].ogeler[0]).toMatchObject({ durum: 'bekliyor', isId: null });
    expect(t.kuyruklar[0].durum).toBe('suruyor');
  });

  it('iki kiracı bağımsız: her biri kendi kuyruğunu aynı tikte başlatır', async () => {
    const t = ortamKur();
    await t.s.olustur({ tenantId: 't1', ajanId: 'beyanname', sablon: 'x', taxpayerIds: ['a'], kaynak: 'toplu' });
    await t.s.olustur({ tenantId: 't2', ajanId: 'beyanname', sablon: 'y', taxpayerIds: ['b'], kaynak: 'toplu' });
    expect(await t.tikVeBekle()).toEqual(['k1', 'k2']);
    expect(t.calistirilan.map((p) => p.tenantId)).toEqual(['t1', 't2']);
  });
});
