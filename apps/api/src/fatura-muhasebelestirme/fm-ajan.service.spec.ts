/**
 * FmAjanService (fm_* araçlarının arkası, PLAN/15 Faz 5) — sahte Prisma + sahte FaturaMuhasebelestirmeService.
 *  - belgeBayraklari: durum/uyarı → bekleyen/eslesti/kod_eksik/celiski/okunmadi/demirbas/tevkifat/mukerrer/iade
 *  - hesapAta: KULLANICI satırı EZİLMEZ; onaylı belgeye yazılmaz; plan dışı / grup hesap reddedilir; yazılan satır kaynak=AJAN
 *  - hesapAta (işletme): kayitTuruKod + alt tür zorunluluğu; userEdited ezilmez
 *  - isaretle: ocrData.ajanIsaretleri + READY → NEEDS_REVIEW; hesap yazmaz
 *  - donemOzeti / belgeListele / uyumsuzluklar: sayaçlar ve süzgeç tek tanımdan
 */
jest.mock('./fatura-muhasebelestirme.service', () => ({ FaturaMuhasebelestirmeService: class FaturaMuhasebelestirmeService {} }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

import { FmAjanService, belgeBayraklari } from './fm-ajan.service';

const TP = 'tp1';
const PLAN = [
  { code: '770', name: 'GENEL YÖNETİM GİDERLERİ', level: 1 },
  { code: '770.01', name: 'GENEL YÖNETİM GİDERLERİ', level: 2 },
  { code: '770.01.004', name: 'ARAÇ BAKIM ONARIM', level: 3 },
  { code: '770.01.003', name: 'AKARYAKIT', level: 3 },
  { code: '191.01', name: 'İNDİRİLECEK KDV %20', level: 2 },
  { code: '320.01.001', name: 'ELİT PETROL', level: 3 },
];

function belge(p: any = {}) {
  return {
    id: 'b1', tenantId: 't1', taxpayerId: TP, invoiceKind: 'ALIS', status: 'READY', ocrStatus: 'DONE', lucaStatus: null,
    belgeNo: 'ELT2026000000001', faturaTarihi: new Date('2026-08-10T00:00:00Z'), createdAt: new Date('2026-08-11T00:00:00Z'),
    vendorName: 'ELİT PETROL', customerName: null, totalAmount: 1200, validationStatus: 'VALID', validationIssues: [], duplicateOfId: null,
    ocrData: { matrah: 1000, kdvTutari: 200, kdvOrani: 20 },
    lines: [
      { id: 'l0', orderNo: 0, group: 'matrah', accountCode: null, debit: 1000, credit: 0, kaynak: null },
      { id: 'l1', orderNo: 1, group: 'vergi', accountCode: '191.01', debit: 200, credit: 0, kaynak: 'KURAL' },
      { id: 'l2', orderNo: 2, group: 'cari', accountCode: '320.01.001', debit: 0, credit: 1200, kaynak: 'VKN' },
    ],
    ...p,
  };
}

function kur(opts: { belgeler?: any[]; taxpayer?: any; plan?: any[] } = {}) {
  const belgeler = opts.belgeler ?? [belge()];
  const yazilan: any[] = [];
  const prisma: any = {
    taxpayer: { findFirst: async () => opts.taxpayer ?? { id: TP, companyName: 'FAMCOFFEE', defterTuru: 'BILANCO' } },
    invoiceAccountingDocument: {
      findMany: async () => belgeler,
      update: async (q: any) => { yazilan.push({ model: 'doc', ...q }); return {}; },
    },
    invoiceAccountingLine: { update: async (q: any) => { yazilan.push({ model: 'line', ...q }); return {}; } },
    lucaAccountPlanSnapshot: { findFirst: async () => ((opts.plan ?? PLAN).length ? { id: 'p' } : null) },
    auditLog: { create: async (q: any) => { yazilan.push({ model: 'audit', ...q }); return {}; } },
  };
  const fmCagri: any[] = [];
  const fm: any = {
    get: async (_t: string, id: string) => {
      const d = belgeler.find((b) => b.id === id);
      if (!d) throw new Error('Belge bulunamadı');
      return d;
    },
    accountPlan: async () => opts.plan ?? PLAN,
    revalidateDocument: async (_t: string, id: string) => { fmCagri.push(['revalidate', id]); return { validationStatus: 'VALID' }; },
    aiReadBatch: async (_t: string, ids: string[]) => { fmCagri.push(['aiReadBatch', ids]); return { queued: ids.length, skipped: 0 }; },
    approve: async (_t: string, id: string) => { fmCagri.push(['approve', id]); return { status: 'APPROVED', lucaStatus: 'PENDING' }; },
    batchPostToLuca: async (_t: string, p: any) => { fmCagri.push(['batchPostToLuca', p]); return { queued: 1 }; },
  };
  const svc = new FmAjanService(prisma, fm);
  return { svc, yazilan, fmCagri };
}

describe('belgeBayraklari', () => {
  it('READY + matrah boş → bekleyen + kod_eksik; matrah dolu → eslesti', () => {
    const b1 = belgeBayraklari(belge());
    expect(b1).toMatchObject({ bekleyen: true, kodEksik: true, eslesti: false, okunmadi: false, celiski: false, onaylandi: false, luca: false });
    const dolu = belge({ lines: belge().lines.map((l: any) => ({ ...l, accountCode: l.accountCode || '770.01.004' })) });
    expect(belgeBayraklari(dolu)).toMatchObject({ eslesti: true, kodEksik: false });
  });

  it('okunmadı: OCR PENDING/FAILED, matchDeferred ya da satırsız+tutarsız; çelişki: INVALID/INCOMPLETE ya da issue', () => {
    expect(belgeBayraklari(belge({ ocrStatus: 'PENDING' })).okunmadi).toBe(true);
    expect(belgeBayraklari(belge({ ocrData: { matchDeferred: true } })).okunmadi).toBe(true);
    expect(belgeBayraklari(belge({ lines: [], totalAmount: 0, ocrData: {} })).okunmadi).toBe(true);
    expect(belgeBayraklari(belge({ validationStatus: 'INCOMPLETE' })).celiski).toBe(true);
    expect(belgeBayraklari(belge({ validationIssues: [{ code: 'ACCOUNT_IS_GROUP', message: 'x' }] })).celiski).toBe(true);
  });

  it('demirbaş / tevkifat / mükerrer / iade: doğrulama kodu, ocr alanı ya da ajan işaretiyle', () => {
    expect(belgeBayraklari(belge({ ocrData: { fixedAsset: { is: true } } })).demirbas).toBe(true);
    expect(belgeBayraklari(belge({ ocrData: { ajanIsaretleri: [{ etiket: 'demirbas' }] } })).demirbas).toBe(true);
    expect(belgeBayraklari(belge({ ocrData: { kdvTevkifat: 40 } })).tevkifatVar).toBe(true);
    expect(belgeBayraklari(belge({ ocrData: { uyarilar: [{ kod: 'TEV_NAKL_EKSIK', mesaj: 'x' }] } })).tevkifatSupheli).toBe(true);
    expect(belgeBayraklari(belge({ duplicateOfId: 'b0' })).mukerrer).toBe(true);
    expect(belgeBayraklari(belge({ ocrData: { isReturn: true } })).iade).toBe(true);
    expect(belgeBayraklari(belge({ status: 'APPROVED', lucaStatus: 'POSTED' })).luca).toBe(true);
  });
});

describe('FmAjanService.hesapAta (bilanço)', () => {
  it('boş matrah satırına yaprak hesap yazar: kaynak=AJAN, gerekçe notu, yeniden doğrulama, denetim izi', async () => {
    const { svc, yazilan, fmCagri } = kur();
    const r = await svc.hesapAta('t1', { belgeId: 'b1', satir: 'matrah', hesapKodu: '770.01.004', gerekce: 'motor yağı → araç bakım', userId: 'u1' });
    expect(r).toMatchObject({ ok: true, kaynak: 'AJAN', defterTuru: 'bilanco', yazilan: { satirNo: 0, grup: 'matrah', hesapKodu: '770.01.004', hesapAdi: 'ARAÇ BAKIM ONARIM', eski: null } });
    const satir = yazilan.find((y) => y.model === 'line');
    expect(satir.where).toEqual({ id: 'l0' });
    expect(satir.data).toMatchObject({ accountCode: '770.01.004', kaynak: 'AJAN' });
    const doc = yazilan.find((y) => y.model === 'doc');
    expect(doc.data.ocrData.ajanNotlari[0]).toMatchObject({ tur: 'hesap_ata', hesapKodu: '770.01.004', gerekce: 'motor yağı → araç bakım' });
    expect(fmCagri).toContainEqual(['revalidate', 'b1']);
    expect(yazilan.find((y) => y.model === 'audit').data.action).toBe('AJAN_HESAP_ATA');
  });

  it('KULLANICI kaynaklı satır EZİLMEZ (ok:false, yazma yok)', async () => {
    const d = belge({ lines: [{ id: 'l0', orderNo: 0, group: 'matrah', accountCode: '770.01.003', debit: 1000, credit: 0, kaynak: 'KULLANICI' }] });
    const { svc, yazilan } = kur({ belgeler: [d] });
    const r = await svc.hesapAta('t1', { belgeId: 'b1', satir: 0, hesapKodu: '770.01.004', gerekce: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/KULLANICI/);
    expect(yazilan.filter((y) => y.model !== 'audit')).toHaveLength(0);
  });

  it('onaylı belge, gerekçesiz çağrı, plan dışı kod ve GRUP hesap reddedilir', async () => {
    const { svc, yazilan } = kur({ belgeler: [belge(), belge({ id: 'b2', status: 'APPROVED' })] });
    await expect(svc.hesapAta('t1', { belgeId: 'b2', satir: 0, hesapKodu: '770.01.004', gerekce: 'x' })).rejects.toThrow(/Onaylı/);
    await expect(svc.hesapAta('t1', { belgeId: 'b1', satir: 0, hesapKodu: '770.01.004', gerekce: '' })).rejects.toThrow(/gerekce/);
    await expect(svc.hesapAta('t1', { belgeId: 'b1', satir: 0, hesapKodu: '999.99', gerekce: 'x' })).rejects.toThrow(/planında yok/);
    await expect(svc.hesapAta('t1', { belgeId: 'b1', satir: 0, hesapKodu: '770.01', gerekce: 'x' })).rejects.toThrow(/GRUP/);
    await expect(svc.hesapAta('t1', { belgeId: 'b1', satir: 'yok', hesapKodu: '770.01.004', gerekce: 'x' })).rejects.toThrow(/grubunda satır yok/);
    expect(yazilan).toHaveLength(0);
  });
});

describe('FmAjanService.hesapAta (işletme defteri)', () => {
  const isletme = { id: TP, companyName: 'AYŞEGÜL', defterTuru: 'ISLETME' };

  it('kayitTuruKod + alt tür ile ocrData.isletme yazılır (kaynak AJAN); alt tür eksikse reddedilir', async () => {
    const { svc, yazilan } = kur({ taxpayer: isletme });
    await expect(svc.hesapAta('t1', { belgeId: 'b1', kayitTuruKod: '4', gerekce: 'x' })).rejects.toThrow(/alt tür ister/);
    await expect(svc.hesapAta('t1', { belgeId: 'b1', hesapKodu: '770', gerekce: 'x' })).rejects.toThrow(/kayitTuruKod/);
    const r = await svc.hesapAta('t1', { belgeId: 'b1', kayitTuruKod: '4', kayitAltKod: '114', gerekce: 'taşıt bakım' });
    expect(r).toMatchObject({ ok: true, defterTuru: 'isletme', kaynak: 'AJAN', yazilan: { kayitTuruKod: '4', kayitAltKod: '114' } });
    expect((r as any).yazilan.kayitAltAd).toMatch(/Bakım Onarım/);
    const doc = yazilan.find((y) => y.model === 'doc');
    expect(doc.data.ocrData.isletme).toMatchObject({ kayitTuruKod: '4', kayitAltKod: '114', kaynak: 'AJAN', autoMatched: false });
  });

  it('kullanıcı elle seçmişse (userEdited) ezilmez', async () => {
    const d = belge({ ocrData: { isletme: { kayitTuruKod: '1', kayitAltKod: '', userEdited: true } } });
    const { svc, yazilan } = kur({ taxpayer: isletme, belgeler: [d] });
    const r = await svc.hesapAta('t1', { belgeId: 'b1', kayitTuruKod: '4', kayitAltKod: '114', gerekce: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/KULLANICI/);
    expect(yazilan).toHaveLength(0);
  });
});

describe('FmAjanService.isaretle / aiIleOku / onayla / lucaGonder', () => {
  it('isaretle: etiket doğrulanır, READY → NEEDS_REVIEW, aynı etiket tekrarında üstüne yazar, hesap satırına dokunmaz', async () => {
    const { svc, yazilan } = kur();
    await expect(svc.isaretle('t1', { belgeId: 'b1', etiket: 'uydurma' as any, not: 'x' })).rejects.toThrow(/etiket/);
    await expect(svc.isaretle('t1', { belgeId: 'b1', etiket: 'demirbas', not: '' })).rejects.toThrow(/not/);
    const r = await svc.isaretle('t1', { belgeId: 'b1', etiket: 'demirbas', not: 'had üstü, 255 + amortisman' });
    expect(r).toMatchObject({ ok: true, durum: 'NEEDS_REVIEW', onayBekleyen: true, isaret: { etiket: 'demirbas' } });
    const doc = yazilan.find((y) => y.model === 'doc');
    expect(doc.data.status).toBe('NEEDS_REVIEW');
    expect(doc.data.ocrData.ajanIsaretleri).toHaveLength(1);
    expect(yazilan.some((y) => y.model === 'line')).toBe(false);
  });

  it('aiIleOku mevcut kuyruğu kullanır; onayla approve; lucaGonder batchPostToLuca (id listesi ya da dönem+yön)', async () => {
    const { svc, fmCagri } = kur();
    expect(await svc.aiIleOku('t1', ['b1', 'b1', ''])).toMatchObject({ ok: true, kuyrugaAlinan: 1 });
    await expect(svc.aiIleOku('t1', [])).rejects.toThrow(/boş/);
    expect(await svc.onayla('t1', 'b1', 'u1')).toMatchObject({ ok: true, status: 'APPROVED' });
    await expect(svc.lucaGonder('t1', { taxpayerId: TP })).rejects.toThrow(/belgeIdler ya da donem/);
    await svc.lucaGonder('t1', { taxpayerId: TP, belgeIdler: ['b1'], yon: 'alis', userId: 'u1' });
    await svc.lucaGonder('t1', { taxpayerId: TP, donem: '2026-08', yon: 'satis' });
    expect(fmCagri).toEqual([
      ['aiReadBatch', ['b1']],
      ['approve', 'b1'],
      ['batchPostToLuca', { taxpayerId: TP, documentIds: ['b1'], period: undefined, direction: 'ALIS' }],
      ['batchPostToLuca', { taxpayerId: TP, documentIds: undefined, period: '2026-08', direction: 'SATIS' }],
    ]);
  });
});

describe('FmAjanService okuma: donemOzeti / belgeListele / uyumsuzluklar', () => {
  const belgeler = [
    belge(),
    belge({ id: 'b2', ocrStatus: 'PENDING', lines: [] }),
    belge({ id: 'b3', status: 'APPROVED', lucaStatus: 'POSTED', lines: belge().lines.map((l: any) => ({ ...l, accountCode: l.accountCode || '770.01.004' })) }),
    belge({ id: 'b4', validationIssues: [{ code: 'ACCOUNT_IS_GROUP', message: 'Grup hesaba fiş kesilmez' }], duplicateOfId: 'b1', duplicateReason: 'aynı no' }),
    belge({ id: 'b5', invoiceKind: 'SATIS', customerName: 'MÜŞTERİ AŞ', ocrData: { matrah: 1000, kdvTutari: 200, fixedAsset: { is: true } } }),
  ];

  it('donemOzeti sayaçları ve alış/satış kırılımı; dönem biçimi zorunlu', async () => {
    const { svc } = kur({ belgeler });
    await expect(svc.donemOzeti('t1', TP, 'Ağustos')).rejects.toThrow(/YYYY-MM/);
    const r = await svc.donemOzeti('t1', TP, '2026-08');
    expect(r.defterTuru).toBe('bilanco');
    expect(r.hesapPlaniVar).toBe(true);
    expect(r.sayaclar).toMatchObject({ toplam: 5, bekleyen: 4, kodEksik: 4, eslesti: 0, okunmadi: 1, celiski: 1, mukerrer: 1, onaylandi: 1, lucayaGitti: 1, demirbas: 1 });
    expect(r.yon.alis.toplam).toBe(4);
    expect(r.yon.satis).toMatchObject({ toplam: 1, tutar: 1200 });
  });

  it('belgeListele durum süzgeci tek tanımdan; satır özeti hesap adı + kaynak taşır', async () => {
    const { svc } = kur({ belgeler });
    const okunmadi = await svc.belgeListele('t1', { taxpayerId: TP, donem: '2026-08', durum: 'okunmadi' });
    expect(okunmadi.belgeler.map((b: any) => b.id)).toEqual(['b2']);
    const luca = await svc.belgeListele('t1', { taxpayerId: TP, donem: '2026-08', durum: 'luca' });
    expect(luca.belgeler.map((b: any) => b.id)).toEqual(['b3']);
    // 'kod_eksik' (araç şeması, alt çizgi) → bayrak 'kodEksik' (deve harfi): eşleme olmadan hep boş dönüyordu.
    const kodEksik = await svc.belgeListele('t1', { taxpayerId: TP, donem: '2026-08', durum: 'kod_eksik' });
    expect(kodEksik.toplam).toBe(4);
    expect(kodEksik.belgeler.map((b: any) => b.id)).toContain('b1');
    expect(kodEksik.belgeler.map((b: any) => b.id)).not.toContain('b3');
    const hepsi = await svc.belgeListele('t1', { taxpayerId: TP, donem: '2026-08', limit: 2 });
    expect(hepsi.toplam).toBe(5);
    expect(hepsi.gosterilen).toBe(2);
    expect(hepsi.not).toMatch(/3 belge daha/);
    expect(hepsi.belgeler[0].hesapSatirlari).toContain('vergi: 191.01 İNDİRİLECEK KDV %20 (B 200, KURAL)');
    expect(hepsi.belgeler[0].hesapSatirlari[0]).toMatch(/^matrah: BOŞ/);
  });

  it('uyumsuzluklar gruplar: okunmadı önce ve tek başına; içerik-hesap, mükerrer, demirbaş; Luca\'ya gitmiş belge atlanır', async () => {
    const { svc } = kur({ belgeler });
    const r = await svc.uyumsuzluklar('t1', TP, '2026-08');
    expect(r.ozet).toMatchObject({ okunmadi: 1, icerikHesapUyumsuz: 1, mukerrer: 1, demirbas: 1, tutarTutarsiz: 0, iade: 0 });
    expect(r.gruplar.okunmadi[0].belgeId).toBe('b2');
    expect(r.gruplar.icerikHesapUyumsuz[0]).toMatchObject({ belgeId: 'b4', kod: 'ACCOUNT_IS_GROUP' });
    expect(r.gruplar.mukerrer[0]).toMatchObject({ belgeId: 'b4', kod: 'MUKERRER', mesaj: 'aynı no' });
    expect(r.gruplar.demirbas[0]).toMatchObject({ belgeId: 'b5', karsiTaraf: 'MÜŞTERİ AŞ' });
    expect(JSON.stringify(r.gruplar)).not.toContain('"b3"');
  });

  it('hesapPlaniAra: bilançoda yalnız yaprak; işletmede Kayıt Türü + alt tür listesi', async () => {
    const { svc } = kur({ belgeler });
    const b = await svc.hesapPlaniAra('t1', { taxpayerId: TP, sorgu: '770' });
    expect((b as any).hesaplar.map((h: any) => h.kod)).toEqual(['770.01.004', '770.01.003']);
    const bakim = await svc.hesapPlaniAra('t1', { taxpayerId: TP, sorgu: 'bakım' });
    expect(bakim.hesaplar).toEqual([{ kod: '770.01.004', ad: 'ARAÇ BAKIM ONARIM', seviye: 3, yerel: false }]);
    const { svc: isl } = kur({ taxpayer: { id: TP, companyName: 'AYŞEGÜL', defterTuru: 'İşletme Defteri' } });
    const i = await isl.hesapPlaniAra('t1', { taxpayerId: TP, sorgu: 'bakım', yon: 'alis' });
    expect(i.defterTuru).toBe('isletme');
    expect((i as any).kayitTurleri.some((k: any) => k.kod === '4' && k.altTurler.some((a: any) => a.kod === '114'))).toBe(true);
  });
});
