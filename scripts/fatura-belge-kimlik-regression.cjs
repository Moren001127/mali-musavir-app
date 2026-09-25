#!/usr/bin/env node
/**
 * BELGE KİMLİĞİ + DÖNEM KURALI regresyonu — 2026-09-25 denetim bulguları 4, 15, 6.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *
 * Gerçek fonksiyonlar sahte prisma ile ÇAĞRILIR (kaynakta metin ARANMAZ).
 *
 * BULGU 4 — "Aynı numaralı farklı faturalar karışıyor": mevcut belge arama anahtarı yalnız belge
 *   NO'suydu. GİB belge numarası satıcı başına sayaçtır, küresel tekil değildir → aynı numaralı
 *   FARKLI satıcı faturası mevcut belgeye bağlanıyor, o belgenin yönünü ve DOSYASINI eziyor, eski
 *   dosyayı depodan siliyordu (geri alınamaz). Anahtar artık YÖN + SATICI VKN + BELGE NO; satıcı
 *   VKN'si boşsa belge-no eşleşmesi hiç kullanılmaz; mevcut belgenin yönü/kimliği/dosyası yalnız
 *   ETTN (dış kimlik) teyidi varsa güncellenir.
 *
 * BULGU 15 — "Dönem kuralı üç yerde farklı": asıl aktarım döngüsü yalnız dönem METNİ eşitliğine
 *   bakıyordu. Serbest tarih aralığıyla çekilen satırda rawJson.period "2026-08-01_2026-08-31"
 *   biçiminde olduğu için tarihi okunamamış satır atlanıyor, sayaçta bile görünmüyordu (sessiz kayıp).
 *
 * BULGU 6 — kanal seçiliyken dönem süzgeci SQL'e hiç girmiyordu ve tek sorguda sert tavan vardı:
 *   çok e-Arşiv kesen mükellefte "en yeni 1000" satırın içinde hiç e-Fatura kalmıyor, kullanıcı
 *   hata almadan "0 belge" görüyordu.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { FaturaMuhasebelestirmeService } = require(
  path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

const XML = '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:UUID>ETTN-AAA</cbc:UUID><cbc:ID>GIB2026000000083</cbc:ID></Invoice>';

/** Satıcı "EFE NAKLİYAT" (2222222222) tarafından kesilmiş GIB2026000000083 numaralı alış faturası. */
const satir = (over = {}) => ({
  id: 'r1', tenantId: 't1', taxpayerId: 'tp1', entegrator: 'TURKCELL',
  uuid: 'uuid-aaa', ettn: 'ETTN-AAA', faturaNo: 'GIB2026000000083',
  senderVkn: '2222222222', senderTitle: 'EFE NAKLIYAT', receiverVkn: '1111111111',
  faturaDate: new Date('2026-08-05T00:00:00.000Z'),
  direction: 'IN', ublXmlRaw: XML,
  documentId: null, isTransferred: false, processedAt: null,
  rawJson: { channel: 'IN_EFATURA', period: '2026-08', queryPeriodStart: '2026-08-01', queryPeriodEnd: '2026-08-31' },
  ...over,
});

/** AYNI numaralı ama BAŞKA satıcının (FEDAT AYDOĞDU, 3333333333) faturasından oluşmuş mevcut belge. */
const baskaSaticiBelgesi = (over = {}) => ({
  id: 'mevcut-fedat', tenantId: 't1', taxpayerId: 'tp1',
  source: 'integration-turkcell', sourceRefId: 'uuid-fedat',
  belgeNo: 'GIB2026000000083', sellerVkn: '3333333333', invoiceKind: 'ALIS',
  ...over,
});

/** Sahte prisma. `suzgecsizBelge` = belge sorgusu WHERE'i UYGULAMAZ (hepsini döndürür):
 *  böylece koruma yalnız SQL süzgecine değil, BELLEKTEKİ anahtara da bağlı mı görülür. */
function makePrisma(satirlar, belgeler, opts = {}) {
  const kayit = { inboxSorgu: [], belgeSorgu: [], inboxYazma: [] };
  const inFiltre = (kosul, deger) => {
    if (kosul === undefined) return true;
    if (kosul && Array.isArray(kosul.in)) return kosul.in.map(String).includes(String(deger ?? ''));
    return String(kosul) === String(deger ?? '');
  };
  return {
    kayit,
    taxpayer: {
      findFirst: async () => ({ id: 'tp1', companyName: 'MOREN MUKELLEF', firstName: null, lastName: null, taxNumber: '1111111111' }),
      findMany: async () => [],
    },
    eFaturaInbox: {
      findMany: async (args) => {
        kayit.inboxSorgu.push(args);
        const atla = Number(args.skip || 0);
        const al = Number(args.take || satirlar.length);
        return satirlar.slice(atla, atla + al);
      },
      update: async (args) => { kayit.inboxYazma.push(args); return {}; },
    },
    invoiceAccountingDocument: {
      findMany: async (args) => {
        kayit.belgeSorgu.push(args);
        if (opts.suzgecsizBelge) return belgeler;
        const w = args.where || {};
        return belgeler.filter((d) => inFiltre(w.id, d.id)
          && inFiltre(w.source, d.source)
          && inFiltre(w.sourceRefId, d.sourceRefId)
          && inFiltre(w.belgeNo, d.belgeNo)
          && inFiltre(w.sellerVkn, d.sellerVkn)
          && inFiltre(w.invoiceKind, d.invoiceKind));
      },
      findFirst: async () => null,
    },
  };
}

function makeSvc(prisma, storage) {
  // Constructor yalnız atama yapar (gövdesi boş) → sahte bağımlılıklar güvenli.
  const svc = new FaturaMuhasebelestirmeService(prisma, storage || {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  svc.maybeRefreshAccountPlan = async () => null;
  svc.resolveRuntimeConfigForProvider = async () => null;   // → providerStubConfig kullanılır
  svc.aktarSonrasiOkumaKuyruga = async () => null;
  svc.reapplyAccountCodes = async () => null;
  // UBL ayrıştırma ayrı konu → sabitlenir (bu sınama KİMLİK ve DÖNEM kararlarını ölçer).
  svc.parseProviderUblInvoice = () => ({
    faturaNo: 'GIB2026000000083', ettn: 'ETTN-AAA',
    satici: 'EFE NAKLIYAT', saticiVergiNo: '2222222222',
    alici: 'MOREN MUKELLEF', aliciVergiNo: '1111111111',
    matrah: 1000, kdvTutari: 200, kdvOrani: 20, toplamTutar: 1200,
    paraBirimi: 'TL', faturaTarihi: new Date('2026-08-05T00:00:00.000Z'),
    documentType: 'E_FATURA', belgeDurumu: null, iade: false, kalemler: [],
  });
  return svc;
}

/** Aktar yolunu izle: createDocumentFromProviderXml çağrıldı mı, hangi belgeye bağlandı? */
function belgeOlusturmaSahtesi(svc) {
  const cagrilar = [];
  svc.createDocumentFromProviderXml = async (tenantId, userId, taxpayer, cfg, yon, payload, o = {}) => {
    cagrilar.push({ yon, externalId: payload && payload.externalId, opts: o });
    return { created: true, document: { id: 'belge-yeni' } };
  };
  return cagrilar;
}

(async () => {
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('1) BULGU 4 — aynı belge no + FARKLI satıcı VKN → mevcut belgeye BAĞLANMAZ');
  {
    // suzgecsizBelge: SQL yanlış belgeyi döndürse BİLE bellekteki anahtar onu kabul etmemeli.
    const prisma = makePrisma([satir()], [baskaSaticiBelgesi()], { suzgecsizBelge: true });
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.imported === 1, `yeni belge yolu seçildi (imported=${r.imported}, alreadyQueued=${r.alreadyQueued})`);
    ok(cagrilar.length === 1, `createDocumentFromProviderXml çağrıldı (${cagrilar.length})`);
    ok(!cagrilar.some((c) => c.opts && c.opts.existingDocumentId),
      'çağrı MEVCUT belgeye bağlı değil (existingDocumentId geçilmedi)');
    const baglama = prisma.kayit.inboxYazma.find((a) => a.data && a.data.documentId === 'mevcut-fedat');
    ok(!baglama, 'inbox satırı başka satıcının belgesine BAĞLANMADI');
  }

  console.log('2) BULGU 4 — belge-no sorgusuna YÖN ve SATICI VKN de giriyor');
  {
    const prisma = makePrisma([satir()], [baskaSaticiBelgesi()]);
    const svc = makeSvc(prisma);
    belgeOlusturmaSahtesi(svc);
    await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    const noSorgu = prisma.kayit.belgeSorgu.find((a) => a.where && a.where.belgeNo);
    ok(!!noSorgu, 'belge-no sorgusu yapıldı');
    ok(!!noSorgu && !!noSorgu.where.sellerVkn, `sorguda sellerVkn var (${JSON.stringify(noSorgu && noSorgu.where.sellerVkn)})`);
    ok(!!noSorgu && noSorgu.where.invoiceKind === 'ALIS', `sorguda invoiceKind=ALIS var (${noSorgu && noSorgu.where.invoiceKind})`);
    ok(!!noSorgu && noSorgu.select && noSorgu.select.sellerVkn === true && noSorgu.select.invoiceKind === true,
      'select sellerVkn + invoiceKind okuyor (anahtar bunlardan kuruluyor)');
  }

  console.log('3) BULGU 4 — AYNI satıcının aynı numaralı faturası MEVCUT belgeye bağlanır (geriye uyum)');
  {
    const prisma = makePrisma([satir()], [baskaSaticiBelgesi({ id: 'mevcut-efe', sellerVkn: '2222222222' })]);
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.alreadyQueued === 1 && r.imported === 0, `mevcut belgeye bağlandı (alreadyQueued=${r.alreadyQueued}, imported=${r.imported})`);
    const baglama = prisma.kayit.inboxYazma.find((a) => a.data && a.data.documentId === 'mevcut-efe');
    ok(!!baglama, 'inbox satırı doğru belgeye bağlandı');
    ok(cagrilar.length === 0, 'yeni belge açılmadı');
  }

  console.log('4) BULGU 4 — satıcı VKN BOŞSA belge-no eşleşmesi hiç kullanılmaz');
  {
    const prisma = makePrisma([satir({ senderVkn: null, rawJson: { channel: 'IN_EFATURA', period: '2026-08' } })],
      [baskaSaticiBelgesi({ id: 'mevcut-efe', sellerVkn: '2222222222' })], { suzgecsizBelge: true });
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.imported === 1 && r.alreadyQueued === 0, `VKN'siz satır mevcut belgeye bağlanmadı (imported=${r.imported})`);
    ok(cagrilar.length === 1, 'kimlik ETTN yolundan aranmak üzere belge oluşturma yoluna gidildi');
    const noSorgu = prisma.kayit.belgeSorgu.find((a) => a.where && a.where.belgeNo);
    ok(!noSorgu, 'satıcı VKN adayı olmadığı için belge-no sorgusu hiç yapılmadı');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('5) BULGU 4 — ETTN teyidi YOKSA yön/kimlik/dosya güncellenmez, eski dosya SİLİNMEZ');
  {
    const depo = { yuklenen: [], silinen: [] };
    const storage = {
      putBuffer: async (key) => { depo.yuklenen.push(key); },
      deleteObject: async (key) => { depo.silinen.push(key); },
    };
    const guncelleme = [];
    const mevcut = {
      id: 'mevcut-fedat', tenantId: 't1', taxpayerId: 'tp1', status: 'NEEDS_REVIEW',
      source: 'integration-turkcell', sourceRefId: 'uuid-fedat',
      belgeNo: 'GIB2026000000083', sellerVkn: '3333333333', invoiceKind: 'SATIS',
      s3Key: 'invoice-accounting/t1/tp1/turkcell-ESKI.xml', originalName: 'eski.xml',
      mimeType: 'application/xml', sizeBytes: 10,
      ocrData: { ettn: 'ETTN-BBB' }, lines: [],
    };
    const prisma = {
      invoiceAccountingDocument: { findFirst: async () => mevcut, findMany: async () => [] },
      $transaction: async (fn) => fn({
        invoiceAccountingLine: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
        invoiceAccountingDocument: { update: async (a) => { guncelleme.push(a); return { ...mevcut, lines: [] }; } },
      }),
    };
    const svc = makeSvc(prisma, storage);
    const cfg = { provider: 'TURKCELL' };
    await svc.createDocumentFromProviderXml('t1', 'u1', { id: 'tp1', taxNumber: '1111111111' }, cfg, 'ALIS',
      { xml: XML, externalId: 'uuid-aaa', originalName: 'yeni.xml' },
      { existingDocumentId: 'mevcut-fedat', skipMatching: true });
    const d = (guncelleme[0] && guncelleme[0].data) || {};
    ok(guncelleme.length === 1, 'mevcut belge güncellendi (tek yazma)');
    ok(!('invoiceKind' in d), `YÖN yazılmadı (gelen: ${JSON.stringify(d.invoiceKind)})`);
    ok(!('s3Key' in d) && !('originalName' in d) && !('mimeType' in d) && !('sizeBytes' in d),
      'DOSYA alanları yazılmadı (s3Key/originalName/mimeType/sizeBytes)');
    ok(!('sourceRefId' in d) && !('source' in d),
      'kimlik alanları yazılmadı (teyitsiz sourceRefId yazılırsa belge bir sonraki turda "teyitli" görünürdü)');
    ok(depo.silinen.length === 0, `eski dosya SİLİNMEDİ (silinen: ${JSON.stringify(depo.silinen)})`);
    ok(depo.yuklenen.length === 0, 'teyit yoksa yeni dosya da yüklenmedi (depoda sahipsiz nesne kalmaz)');
  }

  console.log('6) BULGU 4 — ETTN teyidi VARSA yön/kimlik/dosya güncellenir, eski dosya silinir');
  {
    const depo = { yuklenen: [], silinen: [] };
    const storage = {
      putBuffer: async (key) => { depo.yuklenen.push(key); },
      deleteObject: async (key) => { depo.silinen.push(key); },
    };
    const guncelleme = [];
    const mevcut = {
      id: 'mevcut-efe', tenantId: 't1', taxpayerId: 'tp1', status: 'NEEDS_REVIEW',
      source: 'integration-turkcell', sourceRefId: 'uuid-eski',
      belgeNo: 'GIB2026000000083', sellerVkn: '2222222222', invoiceKind: 'SATIS',
      s3Key: 'invoice-accounting/t1/tp1/turkcell-ESKI.xml', originalName: 'eski.xml',
      mimeType: 'application/xml', sizeBytes: 10,
      ocrData: { ettn: 'ETTN-AAA' }, lines: [],   // ← gelen ETTN ile AYNI
    };
    const prisma = {
      invoiceAccountingDocument: { findFirst: async () => mevcut, findMany: async () => [] },
      $transaction: async (fn) => fn({
        invoiceAccountingLine: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
        invoiceAccountingDocument: { update: async (a) => { guncelleme.push(a); return { ...mevcut, lines: [] }; } },
      }),
    };
    const svc = makeSvc(prisma, storage);
    await svc.createDocumentFromProviderXml('t1', 'u1', { id: 'tp1', taxNumber: '1111111111' }, { provider: 'TURKCELL' }, 'ALIS',
      { xml: XML, externalId: 'uuid-aaa', originalName: 'yeni.xml' },
      { existingDocumentId: 'mevcut-efe', skipMatching: true });
    const d = (guncelleme[0] && guncelleme[0].data) || {};
    ok(d.invoiceKind === 'ALIS', `YÖN düzeltildi (${d.invoiceKind})`);
    ok(typeof d.s3Key === 'string' && d.s3Key.length > 0, 'dosya alanları yazıldı');
    ok(depo.yuklenen.length === 1, 'yeni dosya depoya yüklendi');
    ok(depo.silinen.length === 1 && depo.silinen[0] === mevcut.s3Key, `eski dosya silindi (${JSON.stringify(depo.silinen)})`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('7) BULGU 15 — serbest tarih aralığı + TARİHSİZ satır → asıl döngü ATLAMIYOR');
  {
    const tarihsiz = satir({
      faturaDate: null,
      rawJson: { channel: 'IN_EFATURA', period: '2026-08-01_2026-08-31', queryPeriodStart: '2026-08-01', queryPeriodEnd: '2026-08-31' },
    });
    const prisma = makePrisma([tarihsiz], []);
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.processed === 1, `satır işlendi (processed=${r.processed}) — eskiden dönem METNİ "2026-08" ile eşleşmediği için atlanıyordu`);
    ok(r.imported === 1 && cagrilar.length === 1, `belge aktarıldı (imported=${r.imported})`);
    ok(r.donemDisi === 0, `dönem dışı sayacı 0 (${r.donemDisi})`);
  }

  console.log('8) BULGU 15 — gerçekten BAŞKA döneme ait tarihsiz satır atlanıyor ve SAYILIYOR');
  {
    const baskaDonem = satir({
      faturaDate: null,
      rawJson: { channel: 'IN_EFATURA', period: '2026-07-01_2026-07-15', queryPeriodStart: '2026-07-01', queryPeriodEnd: '2026-07-15' },
    });
    const prisma = makePrisma([baskaDonem], []);
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.processed === 0 && cagrilar.length === 0, `dönem dışı satır aktarılmadı (processed=${r.processed})`);
    ok(r.donemDisi === 1, `atlama SESSİZ değil, sonuçta raporlandı (donemDisi=${r.donemDisi})`);
  }

  console.log('9) BULGU 15 — iptalSayac aynı dönem kuralını kullanıyor');
  {
    const iptalSatiri = {
      id: 'i1', faturaNo: 'GIB2026000000099', faturaDate: null, senderTitle: 'X', direction: 'IN',
      rawJson: { channel: 'IN_EFATURA', period: '2026-08-01_2026-08-31', queryPeriodStart: '2026-08-01', queryPeriodEnd: '2026-08-31', approvalStatus: 'Iptal edildi' },
    };
    const disSatir = {
      id: 'i2', faturaNo: 'GIB2026000000100', faturaDate: null, senderTitle: 'Y', direction: 'IN',
      rawJson: { channel: 'IN_EFATURA', period: '2026-06-01_2026-06-30', queryPeriodStart: '2026-06-01', queryPeriodEnd: '2026-06-30', approvalStatus: 'Iptal edildi' },
    };
    const prisma = {
      eFaturaInbox: { findMany: async () => [iptalSatiri, disSatir] },
      invoiceAccountingDocument: { count: async () => 0 },
    };
    const svc = makeSvc(prisma);
    const r = await svc.iptalSayac('t1', { taxpayerId: 'tp1', period: '2026-08' });
    ok(r.inbox === 1, `serbest aralıkla çekilen iptal satırı sayaçta görünüyor, başka dönem sayılmıyor (inbox=${r.inbox})`);
    ok(r.kirpildi === false, 'tavan bilgisi dönüyor');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('10) BULGU 6 — dönem süzgeci kanal seçiliyken de SQL\'e giriyor');
  {
    const prisma = makePrisma([], []);
    const svc = makeSvc(prisma);
    belgeOlusturmaSahtesi(svc);
    await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-07', channel: 'OUT_EFATURA' });
    const w = (prisma.kayit.inboxSorgu[0] || {}).where || {};
    const tarihKosulu = Array.isArray(w.OR) ? w.OR.find((o) => o.faturaDate && o.faturaDate.gte) : null;
    ok(!!tarihKosulu, `kanal seçiliyken de dönem SQL'de süzülüyor (${JSON.stringify(w.OR)})`);
    ok(Array.isArray(w.OR) && w.OR.some((o) => o.faturaDate === null),
      'tarihi okunamamış satırlar SQL\'de elenmiyor (dönem kararı bellekte)');
  }

  console.log('11) BULGU 6 — diğer kanalın 1500 satırı hedefi yemiyor (sayfalı çekim)');
  {
    // 1500 satır IN_EFATURA (istenmeyen kanal) + sonda 2 satır OUT_EFATURA.
    const kalabalik = [];
    for (let i = 0; i < 1500; i++) {
      kalabalik.push(satir({
        id: `dolgu-${i}`, uuid: `uuid-dolgu-${i}`, faturaNo: `IN${i}`, direction: 'OUT',
        rawJson: { channel: 'IN_EFATURA', period: '2026-07', queryPeriodStart: '2026-07-01', queryPeriodEnd: '2026-07-31' },
        faturaDate: new Date('2026-07-20T00:00:00.000Z'),
      }));
    }
    for (let i = 0; i < 2; i++) {
      kalabalik.push(satir({
        id: `satis-${i}`, uuid: `uuid-satis-${i}`, faturaNo: `OUT${i}`, direction: 'OUT',
        rawJson: { channel: 'OUT_EFATURA', period: '2026-07', queryPeriodStart: '2026-07-01', queryPeriodEnd: '2026-07-31' },
        faturaDate: new Date('2026-07-02T00:00:00.000Z'),
      }));
    }
    const prisma = makePrisma(kalabalik, []);
    const svc = makeSvc(prisma);
    const cagrilar = belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-07', channel: 'OUT_EFATURA' });
    ok(r.imported === 2 && cagrilar.length === 2,
      `1000'in ötesindeki e-Fatura satırları bulundu (imported=${r.imported}) — eski tek sorgu "0 belge" diyordu`);
    ok(prisma.kayit.inboxSorgu.length >= 4, `sayfalı ilerlendi (${prisma.kayit.inboxSorgu.length} sorgu)`);
    ok(prisma.kayit.inboxSorgu[1] && prisma.kayit.inboxSorgu[1].skip === 500, `ikinci sayfa skip=500 (${prisma.kayit.inboxSorgu[1] && prisma.kayit.inboxSorgu[1].skip})`);
    ok(r.kanalDisi === 1500, `kanal dışı satır sayısı raporlandı (kanalDisi=${r.kanalDisi})`);
    ok(r.sinirAsildi === false, `veri bittiği için sınır uyarısı verilmedi (sinirAsildi=${r.sinirAsildi})`);
  }

  console.log('12) BULGU 6 — hedefe dayanıldığında SESSİZ kalmıyor');
  {
    const cok = [];
    for (let i = 0; i < 1200; i++) {
      cok.push(satir({
        id: `c-${i}`, uuid: `uuid-c-${i}`, faturaNo: `A${i}`,
        rawJson: { channel: 'IN_EFATURA', period: '2026-08', queryPeriodStart: '2026-08-01', queryPeriodEnd: '2026-08-31' },
      }));
    }
    const prisma = makePrisma(cok, []);
    const svc = makeSvc(prisma);
    belgeOlusturmaSahtesi(svc);
    const r = await svc.importEfaturaInboxToAccounting('t1', 'u1', { taxpayerId: 'tp1', period: '2026-08', limit: 500 });
    ok(r.aktarilacak === 500, `bu turda hedef kadar satır alındı (aktarilacak=${r.aktarilacak})`);
    ok(r.sinirAsildi === true && typeof r.sinirNotu === 'string' && r.sinirNotu.length > 0,
      `sınır AÇIKÇA bildirildi: "${String(r.sinirNotu).slice(0, 60)}…"`);
  }

  if (failed) { console.error(`\nfatura-belge-kimlik-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-belge-kimlik-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
