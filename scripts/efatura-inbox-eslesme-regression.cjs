#!/usr/bin/env node
/**
 * e-FATURA GELEN KUTUSU EŞLEŞME regresyonu — 2026-09-25 denetim bulguları 5 ve 6.
 *   apps/api/src/efatura-adapters/efatura-sync.service.ts → listInbox()
 *
 * METİN ARAMA DEĞİL: gerçek listInbox sahte prisma ile çağrılır, DAVRANIŞ kilitlenir.
 *
 * BULGU 5 — çapraz ETTN eşleştirmesi mükellefleri/yönleri karıştırıyordu:
 *   1) Aynı ETTN iki mükellefte → A'nın satırı B'nin belgesine BAĞLANMAZ.
 *      (Eskiden bağlanıyordu: satır "Aktarıldı" görünüp kullanıcı Aktar'a basmıyor, fatura HİÇ
 *       aktarılmıyordu; üstüne satıra başka mükellefin documentId'si yazılıyordu → gizlilik.)
 *   2) Aynı ETTN aynı mükellefte ama TERS yön (alış satırı ↔ satış belgesi) → BAĞLANMAZ.
 *   3) Doğru mükellef + doğru yön → BAĞLANIR (işlev bozulmadı; ALIŞ ve SATIŞ ayrı ayrı).
 *   4) taxpayerId verilmemişse çapraz eşleştirme sorgusu HİÇ çalışmaz (güvenli kestirme).
 *   5) Belge sorgusunun select'i taxpayerId + invoiceKind okur (yoksa anahtar kurulamaz).
 *
 * BULGU 6 — dönem süzgeci sınırdan sonra uygulanıyordu:
 *   6) Dönem süzgeci KANAL SEÇİLİ OLSA DA SQL where'ine giriyor; kanal da JSON yol süzgeciyle SQL'de.
 *   7) Sıralama fatura tarihine göre (çekim anı syncedAt değil), ikincil anahtarlarla kararlı.
 *   8) Sınır aşılırsa satırlarda listeKirpildi bilgisi var — sessiz eksik yok.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { EFaturaSyncService } = require(
  path.join(ROOT, 'apps/api/src/efatura-adapters/efatura-sync.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/**
 * Sahte prisma.
 *   · eFaturaInbox.findMany  → verilen satırları (take kadar) döner, ARGÜMANLARI KAYDEDER.
 *   · invoiceAccountingDocument.findMany → çapraz eşleştirme sorgusunda where süzgeçlerini KASITLI
 *     UYGULAMAZ, tohumlanan belgeleri olduğu gibi döner. Böylece satır-belge eşleşmesini SQL değil,
 *     bellekteki ANAHTAR (mükellef + yön + ETTN) koruyor mu, onu sınarız.
 */
function makePrisma(seed) {
  const izler = { inbox: [], belge: [], varlik: [], yazma: [] };
  return {
    izler,
    eFaturaInbox: {
      findMany: async (args) => {
        izler.inbox.push(args);
        const take = Number(args && args.take) || seed.rows.length;
        return seed.rows.slice(0, take);
      },
      updateMany: async (args) => { izler.yazma.push(args); return { count: 0 }; },
    },
    invoiceAccountingDocument: {
      findMany: async (args) => {
        // Varlık denetimi sorgusu (where.id) ile çapraz eşleştirme sorgusu (where.OR) ayrılır.
        if (args && args.where && args.where.id) { izler.varlik.push(args); return []; }
        izler.belge.push(args);
        return seed.docs || [];
      },
    },
  };
}

function makeSvc(prisma) {
  const svc = new EFaturaSyncService(prisma);
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  return svc;
}

/** Gelen kutusu satırı — varsayılan: tpA mükellefi, ALIŞ (IN), 2026-08 dönemi, IN_EFATURA kanalı. */
const satir = (over = {}) => ({
  id: 'r1', tenantId: 't1', taxpayerId: 'tpA', entegrator: 'MIKRO', uuid: 'u-1', ettn: 'E1',
  faturaNo: 'ABC2026000000001', faturaDate: new Date('2026-08-15T00:00:00.000Z'),
  senderVkn: '1111111111', senderTitle: 'TEDARİKÇİ A.Ş.', receiverVkn: '2222222222',
  matrah: '1000.00', kdv: '200.00', toplam: '1200.00', paraBirimi: 'TRY',
  direction: 'IN', invoiceProfile: 'e-Fatura', isTransferred: false, documentId: null,
  ublXmlRaw: '', rawJson: { channel: 'IN_EFATURA', period: '2026-08' },
  markedAt: null, processedAt: null, syncedAt: new Date('2026-09-01T10:00:00.000Z'),
  ...over,
});

/** Muhasebe belgesi — varsayılan: tpA mükellefi, ALIŞ, ETTN E1, Paraşüt kaynağı. */
const belge = (over = {}) => ({
  id: 'doc-1', source: 'integration-parasut', sourceRefId: 'E1',
  ocrData: { ettn: 'E1' }, taxpayerId: 'tpA', invoiceKind: 'ALIS',
  ...over,
});

const opts = (over = {}) => ({
  taxpayerId: 'tpA', direction: 'IN', period: '2026-08', channel: 'IN_EFATURA', limit: '200', ...over,
});

(async () => {
  // ── BULGU 5.1) Aynı ETTN iki mükellefte → BAŞKA mükellefin belgesine bağlanmaz ──
  console.log('1) BULGU 5 — aynı ETTN iki mükellefte: A\'nın satırı B\'nin belgesine bağlanmaz');
  {
    const prisma = makePrisma({
      rows: [satir()],                                            // tpA · ALIŞ · E1
      docs: [belge({ id: 'doc-B', taxpayerId: 'tpB' })],           // tpB · ALIŞ · E1 (BAŞKA mükellef)
    });
    const out = await makeSvc(prisma).listInbox('t1', opts());
    ok(out.length === 1, `satır döndü (${out.length})`);
    // KANIT: eşleştirici tpB'nin belgesini GERÇEKTEN gördü (sahte prisma where süzgecini uygulamıyor),
    //   yine de bağlamadı → bağlanmamasının sebebi "veri yoktu" değil, ANAHTAR koruması.
    ok(prisma.izler.belge.length === 1, `çapraz eşleştirme sorgusu atıldı ve yanlış mükellefin belgesi eşleştiriciye ULAŞTI (${prisma.izler.belge.length} sorgu)`);
    ok(out[0].documentId === null, `başka mükellefin belgesine BAĞLANMADI (documentId=${JSON.stringify(out[0].documentId)})`);
    ok(out[0].isTransferred === false, 'yanlış "Aktarıldı" işareti YOK');
    ok(!out[0].baskaKaynaktanAktarildi, 'baskaKaynaktanAktarildi işareti YOK');
  }

  // ── BULGU 5.2) Aynı mükellef, TERS yön → bağlanmaz ──
  console.log('2) BULGU 5 — aynı mükellef aynı ETTN ama TERS yön: bağlanmaz');
  {
    const prisma = makePrisma({
      rows: [satir()],                                            // tpA · ALIŞ (direction IN)
      docs: [belge({ id: 'doc-satis', invoiceKind: 'SATIS' })],    // tpA · SATIŞ · aynı ETTN
    });
    const out = await makeSvc(prisma).listInbox('t1', opts());
    ok(out[0].documentId === null, `ters yöndeki belgeye BAĞLANMADI (documentId=${JSON.stringify(out[0].documentId)})`);
    ok(out[0].isTransferred === false, 'yanlış "Aktarıldı" işareti YOK');
  }
  {
    // Simetrik: SATIŞ satırı (direction OUT) ↔ ALIŞ belgesi de bağlanmaz.
    const prisma = makePrisma({
      rows: [satir({ direction: 'OUT', rawJson: { channel: 'OUT_EFATURA', period: '2026-08' } })],
      docs: [belge({ id: 'doc-alis', invoiceKind: 'ALIS' })],
    });
    const out = await makeSvc(prisma).listInbox('t1', opts({ direction: 'OUT', channel: 'OUT_EFATURA' }));
    ok(out[0].documentId === null, 'SATIŞ satırı ALIŞ belgesine bağlanmadı');
  }

  // ── BULGU 5.3) Doğru mükellef + doğru yön → bağlanır (işlev bozulmadı) ──
  console.log('3) BULGU 5 — doğru mükellef + doğru yön: bağlanır (işlev korundu)');
  {
    const prisma = makePrisma({ rows: [satir()], docs: [belge({ id: 'doc-dogru' })] });
    const out = await makeSvc(prisma).listInbox('t1', opts());
    ok(out[0].documentId === 'doc-dogru', `doğru belgeye bağlandı (documentId=${out[0].documentId})`);
    ok(out[0].isTransferred === true && out[0].hasAccountingDocument === true, '"Aktarıldı" işaretlendi');
    ok(out[0].baskaKaynaktanAktarildi === true, 'baskaKaynaktanAktarildi=true');
    ok(out[0].aktarimKaynagi === 'Paraşüt', `kaynak adı okunur (${out[0].aktarimKaynagi})`);
  }
  {
    // SATIŞ tarafı da çalışıyor: direction OUT ↔ invoiceKind SATIS.
    const prisma = makePrisma({
      rows: [satir({ direction: 'OUT', rawJson: { channel: 'OUT_EFATURA', period: '2026-08' } })],
      docs: [belge({ id: 'doc-satis-ok', invoiceKind: 'SATIS' })],
    });
    const out = await makeSvc(prisma).listInbox('t1', opts({ direction: 'OUT', channel: 'OUT_EFATURA' }));
    ok(out[0].documentId === 'doc-satis-ok', `OUT satırı SATIŞ belgesine bağlandı (${out[0].documentId})`);
  }
  {
    // Karışık tohum: doğru belge de, yanlış mükellefin belgesi de aynı ETTN ile dönüyor →
    //   doğru olan seçilmeli (anahtar yanlış olanı ELEMELİ).
    const prisma = makePrisma({
      rows: [satir()],
      docs: [belge({ id: 'doc-B', taxpayerId: 'tpB' }), belge({ id: 'doc-A' })],
    });
    const out = await makeSvc(prisma).listInbox('t1', opts());
    ok(out[0].documentId === 'doc-A', `karışık listede DOĞRU mükellefin belgesi seçildi (${out[0].documentId})`);
  }

  // ── BULGU 5.4) taxpayerId yok → çapraz eşleştirme HİÇ çalışmaz ──
  console.log('4) BULGU 5 — taxpayerId yok: çapraz eşleştirme çalışmaz');
  {
    const prisma = makePrisma({ rows: [satir()], docs: [belge({ id: 'doc-dogru' })] });
    const o = opts(); delete o.taxpayerId;
    const out = await makeSvc(prisma).listInbox('t1', o);
    ok(prisma.izler.belge.length === 0, `çapraz eşleştirme sorgusu hiç atılmadı (${prisma.izler.belge.length} sorgu)`);
    ok(out[0].documentId === null && out[0].isTransferred === false, 'satır "aktarıldı" işaretlenmedi (yanlış bilgi vermek yerine boş)');
  }

  // ── BULGU 5.5) Belge sorgusu taxpayerId + invoiceKind okuyor ──
  console.log('5) BULGU 5 — belge sorgusu anahtar alanlarını okuyor');
  {
    const prisma = makePrisma({ rows: [satir()], docs: [belge()] });
    await makeSvc(prisma).listInbox('t1', opts());
    const sorgu = prisma.izler.belge[0] || {};
    ok(!!(sorgu.select && sorgu.select.taxpayerId), 'select.taxpayerId var');
    ok(!!(sorgu.select && sorgu.select.invoiceKind), 'select.invoiceKind var');
    ok(sorgu.where && sorgu.where.tenantId === 't1', 'where.tenantId sınırı duruyor');
  }

  // ── BULGU 6.6) Dönem + kanal SQL where'inde (kanal seçili olsa da) ──
  console.log('6) BULGU 6 — dönem süzgeci kanal seçiliyken de SQL where\'ine giriyor');
  {
    const prisma = makePrisma({ rows: [satir()], docs: [] });
    await makeSvc(prisma).listInbox('t1', opts());
    const sorgu = prisma.izler.inbox[0] || {};
    const and = (sorgu.where && sorgu.where.AND) || [];
    const donemKosulu = and.find((k) => Array.isArray(k.OR) && k.OR.some((x) => x.faturaDate && x.faturaDate.gte));
    ok(!!donemKosulu, `dönem koşulu SQL where.AND içinde (AND=${JSON.stringify(and).slice(0, 160)})`);
    const gte = donemKosulu && donemKosulu.OR.find((x) => x.faturaDate && x.faturaDate.gte).faturaDate;
    ok(gte && gte.gte.toISOString() === '2026-08-01T00:00:00.000Z', `dönem başlangıcı doğru (${gte && gte.gte.toISOString()})`);
    ok(gte && gte.lt.toISOString() === '2026-09-01T00:00:00.000Z', `dönem bitişi doğru (${gte && gte.lt.toISOString()})`);
    ok(donemKosulu && donemKosulu.OR.some((x) => x.faturaDate === null), 'tarihi olmayan satırlar dışta bırakılmıyor (faturaDate:null dalı var)');
    const kanalKosulu = and.find((k) => Array.isArray(k.OR) && k.OR.some((x) => x.rawJson && Array.isArray(x.rawJson.path)));
    ok(!!kanalKosulu, 'kanal süzgeci de SQL\'de (rawJson JSON yol süzgeci)');
    ok(kanalKosulu && kanalKosulu.OR.some((x) => x.rawJson.equals === 'IN_EFATURA'), 'kanal değeri IN_EFATURA olarak süzülüyor');
    ok(sorgu.where && sorgu.where.taxpayerId === 'tpA' && sorgu.where.direction === 'IN', 'mükellef + yön sınırı SQL\'de');
  }

  // ── BULGU 6.7) Sıralama fatura tarihine göre, kararlı ──
  console.log('7) BULGU 6 — sıralama fatura tarihine göre (çekim anına göre DEĞİL)');
  {
    const prisma = makePrisma({ rows: [satir()], docs: [] });
    await makeSvc(prisma).listInbox('t1', opts());
    const orderBy = (prisma.izler.inbox[0] || {}).orderBy;
    ok(Array.isArray(orderBy) && !!orderBy[0].faturaDate, `ilk sıralama anahtarı faturaDate (${JSON.stringify(orderBy && orderBy[0])})`);
    ok(Array.isArray(orderBy) && orderBy.length >= 2, `eşitlik için ikincil anahtar var (${orderBy && orderBy.length} anahtar)`);
    ok(JSON.stringify(orderBy) !== JSON.stringify({ syncedAt: 'desc' }), 'artık yalnız syncedAt ile sıralanmıyor');
  }

  // ── BULGU 6.8) Sınır aşılırsa SESSİZ kalınmıyor ──
  console.log('8) BULGU 6 — sınır aşılırsa satırlarda kırpılma bilgisi var');
  {
    const rows = [satir({ id: 'r1' }), satir({ id: 'r2' }), satir({ id: 'r3' }), satir({ id: 'r4' })];
    const prisma = makePrisma({ rows, docs: [] });
    const out = await makeSvc(prisma).listInbox('t1', opts({ limit: '2' }));
    ok((prisma.izler.inbox[0] || {}).take === 3, `sınırı aşan satır var mı diye limit+1 çekiliyor (take=${(prisma.izler.inbox[0] || {}).take})`);
    ok(out.length === 2, `limit uygulandı (${out.length})`);
    ok(out.every((r) => r.listeKirpildi === true), 'dönen satırlarda listeKirpildi=true');
    ok(out.every((r) => typeof r.listeKirpildiBilgi === 'string' && r.listeKirpildiBilgi.length > 0), 'kırpılma gerekçesi yazılı');
  }
  {
    // Sınır aşılmadıysa bilgi EKLENMEZ (gereksiz gürültü olmasın).
    const prisma = makePrisma({ rows: [satir()], docs: [] });
    const out = await makeSvc(prisma).listInbox('t1', opts({ limit: '10' }));
    ok(out[0].listeKirpildi === undefined, 'kırpılma yoksa bayrak eklenmiyor');
  }

  // ── Bellekteki ikinci kapı: dönem/kanal uymayan satır yine de elenir ──
  console.log('9) Bellekteki ikinci kapı — dönem/kanal uymayan satır elenir');
  {
    const prisma = makePrisma({
      rows: [
        satir({ id: 'r-ic' }),                                                                   // dönem içi, kanal uyar
        satir({ id: 'r-dis', faturaDate: new Date('2026-07-15T00:00:00.000Z') }),                // dönem dışı
        satir({ id: 'r-kanal', rawJson: { channel: 'OUT_EARSIV', period: '2026-08' } }),         // kanal uymaz
        satir({ id: 'r-tarihsiz', faturaDate: null }),                                           // tarihsiz ama rawJson.period uyar
      ],
      docs: [],
    });
    const out = await makeSvc(prisma).listInbox('t1', opts());
    const kimlikler = out.map((r) => r.id).sort();
    ok(JSON.stringify(kimlikler) === JSON.stringify(['r-ic', 'r-tarihsiz']),
      `yalnız dönem+kanal uyanlar döndü (${JSON.stringify(kimlikler)})`);
  }

  if (failed) { console.error(`\nefatura-inbox-eslesme-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nefatura-inbox-eslesme-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
