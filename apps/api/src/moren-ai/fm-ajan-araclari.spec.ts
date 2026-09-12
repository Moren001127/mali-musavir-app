/**
 * fm_* araçları (Fatura Merkezi ajan araçları, PLAN/15 Faz 5) — ToolExecutorService.execute dalları.
 *  - FmAjanService SAHTE: moduleRef.get ile verilir (dinamik import gerçek servisi yüklemesin diye jest.mock).
 *  - Parametre kapıları (taxpayerId / donem / belgeId) serviste değil çalıştırıcıda: servis hiç çağrılmaz.
 *  - Servis hatası {ok:false, error} olarak döner; ajan koşusu düşmez.
 *  - get_taxpayer_work_status'un Fatura Merkezi sayımları (faturaMerkeziSayimlari) sahte Prisma ile.
 */
jest.mock('../fatura-muhasebelestirme/fm-ajan.service', () => ({ FmAjanService: class FmAjanService {} }));

import { ToolExecutorService } from './tool-executor.service';
import { FATURA_MERKEZI_AJAN_ARACLARI, FM_AJAN_ARAC_ADLARI, MOREN_AI_TOOLS } from './tools';

type Cagri = { metod: string; args: any[] };

function aracKur(opts: { servisYok?: boolean; hata?: string } = {}) {
  const cagrilar: Cagri[] = [];
  const kaydet = (metod: string) => async (...args: any[]) => {
    cagrilar.push({ metod, args });
    if (opts.hata) throw new Error(opts.hata);
    return { ok: true, metod };
  };
  const svc = {
    belgeListele: kaydet('belgeListele'),
    belgeDetay: kaydet('belgeDetay'),
    donemOzeti: kaydet('donemOzeti'),
    uyumsuzluklar: kaydet('uyumsuzluklar'),
    hesapPlaniAra: kaydet('hesapPlaniAra'),
    hesapAta: kaydet('hesapAta'),
    aiIleOku: kaydet('aiIleOku'),
    isaretle: kaydet('isaretle'),
    onayla: kaydet('onayla'),
    lucaGonder: kaydet('lucaGonder'),
  };
  const moduleRef = { get: () => (opts.servisYok ? null : svc) };
  const tool = new ToolExecutorService({} as any, moduleRef as any);
  return { tool, cagrilar };
}

const ctx = { tenantId: 't1', userId: 'u1', taxpayerId: null as string | null };
const TP = 'cmqgpx7xd0d7swns6sw3am42o';

describe('fm_* araç tanımları', () => {
  it('10 araç; ad/şema tam; genel bot listesinde değil', () => {
    expect(FM_AJAN_ARAC_ADLARI).toEqual([
      'fm_belge_listele', 'fm_belge_detay', 'fm_donem_ozeti', 'fm_uyumsuzluklar', 'fm_hesap_plani_ara',
      'fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle', 'fm_onayla', 'fm_luca_gonder',
    ]);
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const t of FATURA_MERKEZI_AJAN_ARACLARI) {
      expect(genel.has(t.name)).toBe(false);
      expect(t.input_schema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(40);
    }
    const sema = (ad: string) => FATURA_MERKEZI_AJAN_ARACLARI.find((t) => t.name === ad)!.input_schema;
    expect(sema('fm_belge_listele').required).toEqual(['taxpayerId', 'donem']);
    expect(sema('fm_hesap_ata').required).toEqual(['belgeId', 'gerekce']);
    expect(sema('fm_isaretle').required).toEqual(['belgeId', 'etiket', 'not']);
    expect((sema('fm_isaretle').properties as any).etiket.enum).toEqual(['demirbas', 'tevkifat_supheli', 'incele', 'mukerrer_supheli', 'iade']);
    expect((sema('fm_belge_listele').properties as any).durum.enum).toEqual(['bekleyen', 'eslesti', 'kod_eksik', 'celiski', 'demirbas', 'okunmadi', 'onaylandi', 'luca']);
    expect(sema('fm_luca_gonder').required).toEqual(['taxpayerId']);
  });
});

describe('ToolExecutorService fm_* dalları', () => {
  it('servis çözülemezse ok:false ve servis çağrısı yok', async () => {
    const { tool, cagrilar } = aracKur({ servisYok: true });
    const r = await tool.execute('fm_donem_ozeti', { taxpayerId: TP, donem: '2026-08' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/kullanılamıyor/);
    expect(cagrilar).toHaveLength(0);
  });

  it('fm_belge_listele: taxpayerId + YYYY-MM şart; "2026/8" normalize; yon/durum/limit geçer', async () => {
    const { tool, cagrilar } = aracKur();
    expect((await tool.execute('fm_belge_listele', { donem: '2026-08' }, ctx)).error).toMatch(/taxpayerId/);
    expect((await tool.execute('fm_belge_listele', { taxpayerId: TP, donem: 'Ağustos' }, ctx)).error).toMatch(/YYYY-MM/);
    expect(cagrilar).toHaveLength(0);
    await tool.execute('fm_belge_listele', { taxpayerId: TP, donem: '2026/8', yon: 'ALIS', durum: 'kod_eksik', limit: 20 }, ctx);
    expect(cagrilar).toEqual([{ metod: 'belgeListele', args: ['t1', { taxpayerId: TP, donem: '2026-08', yon: 'alis', durum: 'kod_eksik', limit: 20 }] }]);
  });

  it('taxpayerId bağlamdan (ctx.taxpayerId) da gelir; yon geçersizse null', async () => {
    const { tool, cagrilar } = aracKur();
    await tool.execute('fm_donem_ozeti', { donem: '2026-08', yon: 'hepsi' }, { ...ctx, taxpayerId: TP });
    expect(cagrilar).toEqual([{ metod: 'donemOzeti', args: ['t1', TP, '2026-08'] }]);
  });

  it('fm_belge_detay / fm_uyumsuzluklar / fm_hesap_plani_ara doğru imzayla gider', async () => {
    const { tool, cagrilar } = aracKur();
    await tool.execute('fm_belge_detay', { belgeId: 'b1' }, ctx);
    await tool.execute('fm_uyumsuzluklar', { taxpayerId: TP, donem: '2026-08', limit: 5 }, ctx);
    await tool.execute('fm_hesap_plani_ara', { taxpayerId: TP, sorgu: 'bakım', yon: 'alis' }, ctx);
    expect((await tool.execute('fm_hesap_plani_ara', { sorgu: 'bakım' }, ctx)).error).toMatch(/taxpayerId/);
    expect(cagrilar).toEqual([
      { metod: 'belgeDetay', args: ['t1', 'b1'] },
      { metod: 'uyumsuzluklar', args: ['t1', TP, '2026-08', 5] },
      { metod: 'hesapPlaniAra', args: ['t1', { taxpayerId: TP, sorgu: 'bakım', yon: 'alis', limit: undefined }] },
    ]);
  });

  it('fm_hesap_ata: belgeId/satir/hesapKodu/kayitTuru/gerekce + userId servise gider (kaynak AJAN kararı serviste)', async () => {
    const { tool, cagrilar } = aracKur();
    await tool.execute('fm_hesap_ata', { belgeId: 'b1', satir: '0', hesapKodu: '770.01.004', gerekce: 'motor yağı → araç bakım' }, ctx);
    await tool.execute('fm_hesap_ata', { belgeId: 'b2', kayitTuruKod: '4', kayitAltKod: '114', gerekce: 'işletme: taşıt bakım' }, ctx);
    expect(cagrilar[0]).toEqual({
      metod: 'hesapAta',
      args: ['t1', { belgeId: 'b1', satir: '0', hesapKodu: '770.01.004', kayitTuruKod: null, kayitAltKod: null, gerekce: 'motor yağı → araç bakım', userId: 'u1' }],
    });
    expect(cagrilar[1].args[1]).toMatchObject({ belgeId: 'b2', satir: null, hesapKodu: null, kayitTuruKod: '4', kayitAltKod: '114' });
  });

  it('fm_ai_ile_oku: tek id de dizi olur; fm_isaretle etiket+not+userId; fm_onayla belgeId+userId', async () => {
    const { tool, cagrilar } = aracKur();
    await tool.execute('fm_ai_ile_oku', { belgeId: 'b1' }, ctx);
    await tool.execute('fm_ai_ile_oku', { belgeIdler: ['b1', 'b2'] }, ctx);
    await tool.execute('fm_isaretle', { belgeId: 'b3', etiket: 'demirbas', not: 'had üstü' }, ctx);
    await tool.execute('fm_onayla', { belgeId: 'b4' }, ctx);
    expect(cagrilar).toEqual([
      { metod: 'aiIleOku', args: ['t1', ['b1']] },
      { metod: 'aiIleOku', args: ['t1', ['b1', 'b2']] },
      { metod: 'isaretle', args: ['t1', { belgeId: 'b3', etiket: 'demirbas', not: 'had üstü', userId: 'u1' }] },
      { metod: 'onayla', args: ['t1', 'b4', 'u1'] },
    ]);
  });

  it('fm_luca_gonder: taxpayerId şart; belgeIdler / donem / yon servise gider', async () => {
    const { tool, cagrilar } = aracKur();
    expect((await tool.execute('fm_luca_gonder', { donem: '2026-08' }, ctx)).error).toMatch(/taxpayerId/);
    await tool.execute('fm_luca_gonder', { taxpayerId: TP, belgeIdler: ['b1'], yon: 'satis' }, ctx);
    await tool.execute('fm_luca_gonder', { taxpayerId: TP, donem: '2026-08', yon: 'alis' }, ctx);
    expect(cagrilar).toEqual([
      { metod: 'lucaGonder', args: ['t1', { taxpayerId: TP, belgeIdler: ['b1'], donem: null, yon: 'satis', userId: 'u1' }] },
      { metod: 'lucaGonder', args: ['t1', { taxpayerId: TP, belgeIdler: [], donem: '2026-08', yon: 'alis', userId: 'u1' }] },
    ]);
  });

  it('servis hata fırlatırsa {ok:false, error} döner — koşu düşmez', async () => {
    const { tool } = aracKur({ hata: 'Satır 0 (matrah) KULLANICI tarafından seçilmiş; ajan ezmez.' });
    const r = await tool.execute('fm_hesap_ata', { belgeId: 'b1', hesapKodu: '770', gerekce: 'x' }, ctx);
    expect(r).toEqual({ ok: false, error: 'Satır 0 (matrah) KULLANICI tarafından seçilmiş; ajan ezmez.' });
  });
});

describe('get_taxpayer_work_status → faturaMerkeziSayimlari', () => {
  const belge = (p: Partial<any>) => ({ status: 'READY', lucaStatus: null, ocrStatus: 'DONE', validationStatus: 'VALID', validationIssues: [], duplicateOfId: null, ocrData: {}, ...p });

  it('durum/Luca/OCR/doğrulama/mükerrer sayaçları; dönem süzgeci faturaTarihi ya da createdAt', async () => {
    let where: any = null;
    const prisma = { invoiceAccountingDocument: { findMany: async (q: any) => { where = q.where; return [
      belge({}),
      belge({ status: 'NEEDS_REVIEW', validationStatus: 'INCOMPLETE' }),
      belge({ status: 'APPROVED', lucaStatus: 'POSTED' }),
      belge({ status: 'APPROVED', lucaStatus: 'FAILED' }),
      belge({ ocrStatus: 'PENDING' }),
      belge({ ocrData: { matchDeferred: true } }),
      belge({ validationIssues: [{ code: 'ACCOUNT_IS_GROUP' }], duplicateOfId: 'x' }),
      belge({ status: 'REJECTED' }),
    ]; } } };
    const tool = new ToolExecutorService(prisma as any, undefined);
    const r = await (tool as any).faturaMerkeziSayimlari('t1', TP, '2026-08');
    expect(r).toEqual({ toplam: 8, bekleyen: 5, onayli: 2, lucayaGitti: 1, lucaHatali: 1, okunmadi: 2, celiski: 2, mukerrer: 1 });
    expect(where.tenantId).toBe('t1');
    expect(where.taxpayerId).toBe(TP);
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].faturaTarihi.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(where.OR[0].faturaTarihi.lt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(where.OR[1]).toMatchObject({ faturaTarihi: null });
  });

  it('dönem/mükellef yoksa ya da Prisma hata verirse sıfır sayaç', async () => {
    const bos = { toplam: 0, bekleyen: 0, onayli: 0, lucayaGitti: 0, lucaHatali: 0, okunmadi: 0, celiski: 0, mukerrer: 0 };
    const patlayan = { invoiceAccountingDocument: { findMany: () => Promise.reject(new Error('db yok')) } };
    const tool = new ToolExecutorService(patlayan as any, undefined);
    expect(await (tool as any).faturaMerkeziSayimlari('t1', TP, 'Ağustos')).toEqual(bos);
    expect(await (tool as any).faturaMerkeziSayimlari('t1', '', '2026-08')).toEqual(bos);
    expect(await (tool as any).faturaMerkeziSayimlari('t1', TP, '2026-08')).toEqual(bos);
  });
});
