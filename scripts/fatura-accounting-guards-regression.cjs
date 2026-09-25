#!/usr/bin/env node
/**
 * MUHASEBE KORUMALARI regresyonu — İŞLETME DEFTERİ (Defter-Beyan) kapıları.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *   apps/web/src/app/fatura-merkezi/page.tsx
 *   packages/shared/src/isletme-referans.ts
 *
 * 2026-09-25 denetimi: bu betik eskiden korumaları KAYNAK METNİNDE ARIYORDU
 *   (service.includes('isletmeDocumentReady(doc)') gibi). Metin yerinde dururken koşul
 *   tersine çevrilebilir, kapı kaldırılabilir ya da kod başka dosyaya taşınabilir —
 *   test yine yeşil kalırdı. Artık korumalar GERÇEKTEN ÇALIŞTIRILARAK sınanıyor:
 *     · arka uç: ts-node + sahte prisma ile gerçek servis metotları çağrılır,
 *     · ön uç: page.tsx'teki gerçek karar işlevleri/ifadeleri TypeScript ayrıştırıcısıyla
 *       dosyadan çıkarılıp gerçek girdilerle koşturulur (React sayfası burada render edilemez,
 *       ama karar mantığı saf olduğu için birebir çalıştırılabiliyor).
 *
 * METİN TABANLI KALAN KONTROL: yok.
 *   Ön yüzde yalnız BULMA adımı ada/imzaya göredir (işlev adı, değişken adı, "disabled" özniteliği);
 *   DOĞRULAMA adımı her yerde bulunan kodu gerçek girdiyle ÇALIŞTIRIR. Ad değişirse betik
 *   "bulunamadı" diye kırmızıya döner, sessizce geçmez.
 *   Ayrı konu olduğu için sabitlenen (gerçek çağrılmayan) yerler: hesap planı okuması
 *   (getPlanCodeSet), belge doğrulaması (revalidateDocument), satıcı hafızası okuması
 *   (pickLearnedAccountCode). Üçünün de kendi regresyonu/kapsamı var; burada sınanan KAPILAR.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'apps', 'api', 'node_modules', 'typescript'));

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const shared = require(path.join(ROOT, 'packages/shared/src/isletme-referans.ts'));
const { FaturaMuhasebelestirmeService } = require(
  path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/** Verilen çağrı HATA FIRLATIYOR mu ve mesaj beklenen desene uyuyor mu? */
async function reddedildiMi(fn, desen, msg) {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} — HATA FIRLATMADI (kapı açık!)`);
  } catch (e) {
    const m = String((e && e.message) || e);
    if (desen.test(m)) ok(true, `${msg} — reddedildi: "${m.slice(0, 80)}…"`);
    else { failed++; console.error(`  ✗ ${msg} — beklenmeyen hata: ${m.slice(0, 140)}`); }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Sahte prisma: ilgilendiğimiz tablolar elle verilir, gerisi zararsız boş döner
// (logAudit / hafıza kaydı gibi yan yollar testi düşürmesin).
// ──────────────────────────────────────────────────────────────────────────
function makePrisma(tablolar) {
  const bos = () => ({
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async (a) => (a && a.data) || {},
    update: async (a) => (a && a.data) || {},
    updateMany: async () => ({ count: 0 }),
    upsert: async (a) => (a && a.create) || {},
    deleteMany: async () => ({ count: 0 }),
    groupBy: async () => [],
    aggregate: async () => ({}),
  });
  const cache = new Map();
  return new Proxy({}, {
    get(_t, ad) {
      if (typeof ad !== 'string') return undefined;
      if (tablolar[ad]) return tablolar[ad];
      if (ad === '$transaction') return async (fn) => (typeof fn === 'function' ? fn(proxy) : []);
      if (ad === 'then') return undefined;
      if (!cache.has(ad)) cache.set(ad, bos());
      return cache.get(ad);
    },
  });
}

function makeSvc(prisma, opts = {}) {
  // Constructor yalnız atama yapar (yan etki onModuleInit'te) → sahte bağımlılıklar güvenli.
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  // Hesap planı okuması AYRI konu (kendi regresyonu var) → sabitlenir.
  svc.getPlanCodeSet = async () => (opts.plan === undefined ? null : opts.plan);
  // Doğrulama (revalidate) AYRI konu — burada sınanan işletme HAZIRLIK kapıları.
  if (opts.revalidate !== false) svc.revalidateDocument = async () => ({ status: 'OK', issues: [] });
  return svc;
}

/** İşletme defteri ALIŞ belgesi — alanları testte tek tek bozacağız. */
const islBelge = (over = {}) => ({
  id: 'd1', tenantId: 't1', taxpayerId: 'tp1', status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED',
  invoiceKind: 'ALIS', documentType: 'e-Arşiv Fatura', belgeNo: 'A1', totalAmount: 1180,
  faturaTarihi: new Date('2026-09-10T00:00:00Z'), vendorName: 'ÖRNEK TİCARET LTD ŞTİ', sellerVkn: '1234567890',
  lines: [],
  ocrData: { matrah: 1000, kdvTutari: 180, isletme: { kayitTuruKod: '1', kayitAltKod: '186' } },
  ...over,
});

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // 1) PAYLAŞILAN REFERANS — saf işlevler doğrudan çağrılır (zaten davranış sınamasıydı)
  // ════════════════════════════════════════════════════════════════════
  console.log('1) Paylaşılan işletme referansı (saf işlevler)');
  ok(shared.normalizeDocumentType('e-Arşiv Fatura') === 'E_ARSIV', 'e-Arşiv metni E_ARSIV olmalı');
  ok(shared.normalizeDocumentType('EARSIVFATURA') === 'E_ARSIV', 'EARSIVFATURA E_ARSIV olmalı');
  ok(shared.normalizeDocumentType('Ticari Fatura') === 'E_FATURA', 'Ticari Fatura E_FATURA olmalı');
  ok(shared.defaultBelgeTuruKod('e-arsiv', 'ALIS') === '10', 'Alış e-Arşiv belge kodu 10 olmalı');
  ok(shared.defaultBelgeTuruKod('e-arsiv', 'SATIS') === '8', 'Satış e-Arşiv belge kodu 8 olmalı');
  ok(shared.defaultBelgeTuruKod('e-fatura', 'ALIS') === '9', 'Alış e-Fatura belge kodu 9 olmalı');
  {
    const ticari = shared.isletmeGiderSinifi({ matrahKategori: 'ticari_mal' });
    ok(!!ticari && ticari.kayitTuruKod === '1' && ticari.kayitAltKod === '186', 'ticari_mal → Mal Alışı (1/186)');
    const elektrik = shared.isletmeGiderSinifi({ giderTuru: 'elektrik' });
    ok(!!elektrik && elektrik.kayitTuruKod === '4' && elektrik.kayitAltKod === '82', 'elektrik → GVK40 (4/82)');
    ok(shared.isletmeGiderSinifi({ giderTuru: '' }) === null, 'belirsiz alış otomatik gider olmamalı');
  }

  // ════════════════════════════════════════════════════════════════════
  // 2) approve() İŞLETME HAZIRLIK KAPISI — gerçek çağrı
  //    (eski metin kontrolü: service.includes("isletmeDocumentReady(doc)"))
  // ════════════════════════════════════════════════════════════════════
  console.log('\n2) approve() — eksik işletme alanı Luca\'ya geçemez');
  const tpIsletme = { findFirst: async () => ({ defterTuru: 'ISLETME', mihsapDefterTuru: null, naceKodu: '', faaliyetAciklama: '' }), findMany: async () => [] };

  /** İşletme mükellefi + verilen belge ile servis kurar; belge yazmalarını kaydeder. */
  function islKurulum(doc) {
    const yazmalar = [];
    const prisma = makePrisma({
      invoiceAccountingDocument: {
        findFirst: async () => JSON.parse(JSON.stringify(doc), (k, v) => (k === 'faturaTarihi' && v ? new Date(v) : v)),
        findMany: async () => [doc],
        update: async (a) => { yazmalar.push(a); return doc; },
        updateMany: async () => ({ count: 1 }),
      },
      taxpayer: tpIsletme,
    });
    return { svc: makeSvc(prisma), yazmalar };
  }

  {
    // KAYIT TÜRÜ boş → onaylanamaz.
    const { svc, yazmalar } = islKurulum(islBelge({ ocrData: { matrah: 1000, kdvTutari: 180, isletme: {} } }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /İşletme defteri için kayit turu secilmemis/i,
      'kayıt türü seçilmemiş belge onaylanamaz');
    ok(yazmalar.every((a) => !(a.data && a.data.status === 'APPROVED')), 'reddedilen onayda APPROVED yazılmadı');
  }
  {
    // KAYIT ALT TÜRÜ boş (kayıt türü 1 için alt liste var) → onaylanamaz.
    const { svc } = islKurulum(islBelge({ ocrData: { matrah: 1000, kdvTutari: 180, isletme: { kayitTuruKod: '1' } } }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /kayit alt turu secilmemis/i,
      'kayıt alt türü seçilmemiş belge onaylanamaz');
  }
  {
    // TUTAR okunamamış → onaylanamaz (ayrı mesaj).
    const { svc } = islKurulum(islBelge({ totalAmount: 0, ocrData: { isletme: { kayitTuruKod: '1', kayitAltKod: '186' } } }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /tutar okunamamış/i, 'tutarsız belge onaylanamaz');
  }
  {
    // BELGE TÜRÜ ne elle seçilmiş ne documentType'tan türetilebiliyor → onaylanamaz.
    const { svc } = islKurulum(islBelge({ documentType: '', ocrData: { matrah: 1000, isletme: { kayitTuruKod: '1', kayitAltKod: '186' } } }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /belge turu secilmemis/i, 'belge türü belirsiz belge onaylanamaz');
  }
  {
    // TAM belge → geçer, APPROVED + Luca kuyruğuna girer.
    const { svc, yazmalar } = islKurulum(islBelge());
    await svc.approve('t1', 'd1', 'u1');
    const onay = yazmalar.find((a) => a.data && a.data.status === 'APPROVED');
    ok(!!onay, 'tam alanlı işletme belgesi ONAYLANIR (kapı gereksiz kilitlemiyor)');
    ok(!!onay && onay.data.lucaStatus === 'QUEUED', `onaylı belge Luca kuyruğuna girer (${onay && onay.data.lucaStatus})`);
  }
  {
    // ÇOK SATIRLI belge: satırlardan birinin kayıt türü eksikse geçmez.
    const isl = { belgeTuruKod: '10', satirlar: [
      { matrah: 500, kdvTutar: 90, kayitTuruKod: '1', kayitAltKod: '186' },
      { matrah: 500, kdvTutar: 90, kayitTuruKod: '', kayitAltKod: '' },
    ] };
    const { svc } = islKurulum(islBelge({ ocrData: { matrah: 1000, kdvTutari: 180, isletme: isl } }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /kayit turu secilmemis/i,
      'çok satırlı belgede tek eksik satır bile onayı durdurur');
  }

  // ════════════════════════════════════════════════════════════════════
  // 3) approve() BELGE TÜRÜ VARSAYIMINI ocrData.isletme'ye YAZAR — gerçek çağrı
  //    (eski metin kontrolü: service.includes("isletmeWithBelgeDefaults(doc)"))
  // ════════════════════════════════════════════════════════════════════
  console.log('\n3) approve() — belge türü/tevkifat varsayımı kayda yazılır');
  {
    const { svc, yazmalar } = islKurulum(islBelge({
      documentType: 'e-Arşiv Fatura',
      ocrData: { matrah: 1000, kdvTutari: 180, tevkifatOrani: 0.5, tevkifatKdv: 90, isletme: { kayitTuruKod: '1', kayitAltKod: '186' } },
    }));
    await svc.approve('t1', 'd1', 'u1');
    const onay = yazmalar.find((a) => a.data && a.data.status === 'APPROVED');
    const yazilan = onay && onay.data.ocrData && onay.data.ocrData.isletme;
    ok(!!yazilan && yazilan.belgeTuruKod === '10', `e-Arşiv ALIŞ → belgeTuruKod 10 yazıldı (${yazilan && yazilan.belgeTuruKod})`);
    ok(!!yazilan && String(yazilan.belgeTuruAd || '').trim().length > 0, `belge türü ADI da yazıldı ("${yazilan && yazilan.belgeTuruAd}")`);
    ok(!!yazilan && String(yazilan.tevkifatOrani || '').includes('/'), `tevkifat oranı metne çevrilip yazıldı (${yazilan && yazilan.tevkifatOrani})`);
    ok(!!yazilan && Number(yazilan.tevkifatTutar) === 90, `tevkifat tutarı belgeden alındı (${yazilan && yazilan.tevkifatTutar})`);
  }
  {
    // ELLE seçilen belge türü EZİLMEZ (varsayılan yalnız boş alanı doldurur).
    const { svc, yazmalar } = islKurulum(islBelge({
      ocrData: { matrah: 1000, isletme: { belgeTuruKod: '8', kayitTuruKod: '1', kayitAltKod: '186' } },
    }));
    await svc.approve('t1', 'd1', 'u1');
    const onay = yazmalar.find((a) => a.data && a.data.status === 'APPROVED');
    ok(onay && onay.data.ocrData.isletme.belgeTuruKod === '8', 'elle girilmiş belge türü korunur (varsayılan ezmiyor)');
  }

  // ════════════════════════════════════════════════════════════════════
  // 4) LUCA DOSYASI (CSV) AYNI KAPIDAN GEÇER — buildBatchExcel gerçek çağrı
  // ════════════════════════════════════════════════════════════════════
  console.log('\n4) Luca işletme CSV\'si — eksik alanlı belge dosyaya girmez');
  {
    const eksik = islBelge({ id: 'd9', status: 'APPROVED', ocrData: { matrah: 1000, isletme: {} } });
    const prisma = makePrisma({
      invoiceAccountingDocument: { findMany: async () => [eksik], findFirst: async () => eksik },
      taxpayer: tpIsletme,
    });
    await reddedildiMi(() => makeSvc(prisma).buildBatchExcel('t1', { taxpayerId: 'tp1', direction: 'ALIS' }),
      /Aktarılacak.*İşletme belgesi yok/i, 'belge/kayıt türü eksik belge CSV\'ye alınmaz');
  }
  {
    const tam = islBelge({ id: 'd8', status: 'APPROVED' });
    const prisma = makePrisma({
      invoiceAccountingDocument: { findMany: async () => [tam], findFirst: async () => tam },
      taxpayer: tpIsletme,
    });
    const out = await makeSvc(prisma).buildBatchExcel('t1', { taxpayerId: 'tp1', direction: 'ALIS' });
    ok(/luca-isletme-alis/.test(out.filename), `tam belge için işletme CSV üretildi (${out.filename})`);
    ok(out.buffer && out.buffer.length > 0, 'CSV içeriği boş değil');
  }

  // ════════════════════════════════════════════════════════════════════
  // 5) SATICI HAFIZASI İÇERİK UYUMU — gerçek çağrı
  //    (eski metin kontrolü: service.includes("!this.learnedMatrahCompatibleWithContent"))
  // ════════════════════════════════════════════════════════════════════
  console.log('\n5) Satıcı hafızası — mevzuata aykırı öğrenilmiş kod UYGULANMAZ');
  function hafizaKurulum(ogrenilen, ocrEk = {}) {
    const satirYazmalari = [];
    const doc = {
      id: 'd1', sellerVkn: '1234567890', faturaTarihi: new Date('2026-09-10T00:00:00Z'),
      ocrData: { matrah: 1000, kdvTutari: 180, ...ocrEk },
      lines: [{ id: 'l1', accountCode: '770.01.010', rate: '20', kaynak: 'AI' }],
    };
    const prisma = makePrisma({
      invoiceAccountingDocument: { findMany: async () => [doc] },
      invoiceAccountingLine: { update: async (a) => { satirYazmalari.push(a); return a.data; } },
      taxpayer: { findFirst: async () => ({ companyName: 'ÖRNEK', naceKodu: '', faaliyetAciklama: '', kurumTuru: null }) },
      vendorMemoryDecision: { findMany: async () => [] },
    });
    const svc = makeSvc(prisma, { plan: new Set(['770.01.010', '600.01.001', '253.01.001', '740.01.001']) });
    // Hafıza OKUMASI ayrı konu → sabit: satıcı için bu kod öğrenilmiş sayılsın.
    svc.pickLearnedAccountCode = async () => ogrenilen;
    return { svc, satirYazmalari };
  }
  {
    const { svc, satirYazmalari } = hafizaKurulum('600.01.001'); // ALIŞ'ta 6xx (gelir) = mevzuata aykırı
    const uygulanan = await svc.applyLearnedVendorCodes('t1', 'tp1');
    ok(uygulanan === 0, `alışta 6xx öğrenilmiş kod uygulanmadı (uygulanan=${uygulanan})`);
    ok(satirYazmalari.length === 0, 'satıra hiç yazma yapılmadı');
  }
  {
    const { svc, satirYazmalari } = hafizaKurulum('740.01.001'); // uyumlu gider kodu
    const uygulanan = await svc.applyLearnedVendorCodes('t1', 'tp1');
    ok(uygulanan === 1, `uyumlu öğrenilmiş kod UYGULANIR (uygulanan=${uygulanan})`);
    ok(satirYazmalari.length === 1 && satirYazmalari[0].data.accountCode === '740.01.001',
      `satıra öğrenilmiş kod yazıldı (${satirYazmalari[0] && satirYazmalari[0].data.accountCode})`);
    ok(satirYazmalari[0].data.kaynak === 'HAFIZA', 'kaynak HAFIZA olarak işaretlendi');
  }
  {
    // KULLANICI'nın elle seçtiği (planda geçerli) kod öğrenilmiş kodla EZİLMEZ.
    const satirYazmalari = [];
    const doc = {
      id: 'd1', sellerVkn: '1234567890', faturaTarihi: new Date('2026-09-10T00:00:00Z'),
      ocrData: { matrah: 1000 },
      lines: [{ id: 'l1', accountCode: '770.01.010', rate: '20', kaynak: 'KULLANICI' }],
    };
    const prisma = makePrisma({
      invoiceAccountingDocument: { findMany: async () => [doc] },
      invoiceAccountingLine: { update: async (a) => { satirYazmalari.push(a); return a.data; } },
      taxpayer: { findFirst: async () => ({ companyName: 'ÖRNEK' }) },
      vendorMemoryDecision: { findMany: async () => [] },
    });
    const svc = makeSvc(prisma, { plan: new Set(['770.01.010', '740.01.001']) });
    svc.pickLearnedAccountCode = async () => '740.01.001';
    await svc.applyLearnedVendorCodes('t1', 'tp1');
    ok(satirYazmalari.length === 0, 'kullanıcının elle seçtiği hesap öğrenilmiş kodla ezilmiyor');
  }
  {
    // Mevzuat ağının diğer iki dalı doğrudan sınanır (had-üstü demirbaş / satış yönü).
    const svc = makeSvc(makePrisma({}));
    const uyum = (kod, fa, satis) => svc.learnedMatrahCompatibleWithContent(kod, '', '', fa, satis);
    ok(uyum('253.01.001', true, false) === true, 'had-üstü demirbaşta 25x kod uyumlu');
    ok(uyum('770.01.010', true, false) === false, 'had-üstü demirbaşta 7xx kod REDDEDİLİR');
    ok(uyum('600.01.001', false, true) === true, 'satışta 6xx gelir kodu uyumlu');
    ok(uyum('770.01.010', false, true) === false, 'satışta 7xx gider kodu REDDEDİLİR');
    ok(uyum('153.01.001', false, true) === false, 'satışta 15x stok kodu REDDEDİLİR');
    ok(uyum('', false, false) === false, 'boş kod hiçbir zaman uygulanmaz');
  }

  // ════════════════════════════════════════════════════════════════════
  // 6) İŞLETME OTOMATİK SINIFLANDIRMA isletmeGiderSinifi'ni GERÇEKTEN KULLANIR
  //    (eski metin kontrolü: service.includes("isletmeGiderSinifi({ matrahKategori: ocr?.matrahKategori"))
  // ════════════════════════════════════════════════════════════════════
  console.log('\n6) Retroaktif işletme sınıflandırması — gider sınıfı kuralı uygulanıyor');
  function sinifKurulum(ocrData, ek = {}) {
    const yazmalar = [];
    const doc = { id: 'd1', invoiceKind: 'ALIS', documentType: 'e-Arşiv Fatura', totalAmount: 1180, vendorName: 'ÖRNEK TİCARET LTD ŞTİ', customerName: '', ocrData, ...ek };
    const prisma = makePrisma({
      taxpayer: { findFirst: async () => ({ defterTuru: 'ISLETME', mihsapDefterTuru: null, naceKodu: '', faaliyetAciklama: '' }) },
      invoiceAccountingDocument: { findMany: async () => [doc], update: async (a) => { yazmalar.push(a); return a.data; } },
    });
    return { svc: makeSvc(prisma), yazmalar };
  }
  {
    const { svc, yazmalar } = sinifKurulum({ matrah: 1000, matrahKategori: 'ticari_mal' });
    await svc.applyIsletmeFallbackClassification('t1', 'tp1');
    const isl = yazmalar[0] && yazmalar[0].data.ocrData.isletme;
    ok(!!isl && isl.kayitTuruKod === '1' && isl.kayitAltKod === '186',
      `ticari_mal → Mal Alışı (1/186) yazıldı (${isl && isl.kayitTuruKod}/${isl && isl.kayitAltKod})`);
    ok(!!isl && isl.belgeTuruKod === '10', `belge türü de documentType'tan türetildi (${isl && isl.belgeTuruKod})`);
    ok(!!isl && isl.kaynak === 'KURAL', 'sınıfın kaynağı KURAL olarak işaretlendi');
  }
  {
    const { svc, yazmalar } = sinifKurulum({ matrah: 1000, giderTuru: 'elektrik' });
    await svc.applyIsletmeFallbackClassification('t1', 'tp1');
    const isl = yazmalar[0] && yazmalar[0].data.ocrData.isletme;
    ok(!!isl && isl.kayitTuruKod === '4' && isl.kayitAltKod === '82',
      `elektrik → GVK40 (4/82) yazıldı (${isl && isl.kayitTuruKod}/${isl && isl.kayitAltKod})`);
  }
  {
    // BELİRSİZ alış: tür UYDURULMAZ — boş bırakılıp gerekçe yazılır ("İncele").
    const { svc, yazmalar } = sinifKurulum({ matrah: 1000 }, { vendorName: 'AHMET YILMAZ' });
    await svc.applyIsletmeFallbackClassification('t1', 'tp1');
    const isl = yazmalar[0] && yazmalar[0].data.ocrData.isletme;
    ok(!!isl && String(isl.kayitTuruKod || '') === '', 'belirsiz alışta kayıt türü BOŞ kalıyor (uydurma yok)');
    ok(!!isl && String(isl.neden || '').trim().length > 0, `gerekçe yazıldı ("${String((isl && isl.neden) || '').slice(0, 50)}…")`);
  }
  {
    // AI / HAFIZA sınıfı retroaktif kuralla EZİLMEZ.
    const { svc, yazmalar } = sinifKurulum({ matrah: 1000, matrahKategori: 'ticari_mal', isletme: { kayitTuruKod: '4', kayitAltKod: '82', kaynak: 'HAFIZA' } });
    await svc.applyIsletmeFallbackClassification('t1', 'tp1');
    ok(yazmalar.length === 0, 'HAFIZA kaynaklı sınıfa dokunulmuyor');
  }
  {
    // Kullanıcının elle düzelttiği sınıf da EZİLMEZ.
    const { svc, yazmalar } = sinifKurulum({ matrah: 1000, matrahKategori: 'ticari_mal', isletme: { kayitTuruKod: '4', kayitAltKod: '82', userEdited: true } });
    await svc.applyIsletmeFallbackClassification('t1', 'tp1');
    ok(yazmalar.length === 0, 'elle düzeltilmiş sınıfa dokunulmuyor');
  }

  // ════════════════════════════════════════════════════════════════════
  // 7) ÖN YÜZ (page.tsx) — gerçek karar işlevleri dosyadan çıkarılıp koşturulur
  //    (eski metin kontrolleri: page.includes("isletmeDocReady(d).ok") /
  //     page.includes("currentIslReady") / page.includes("normalizeDocumentType(selDoc.documentType"))
  // ════════════════════════════════════════════════════════════════════
  console.log('\n7) Ön yüz karar mantığı (page.tsx içinden gerçek kod)');
  const pagePath = path.join(ROOT, 'apps/web/src/app/fatura-merkezi/page.tsx');
  const pageSrc = fs.readFileSync(pagePath, 'utf8');
  const pageAst = ts.createSourceFile(pagePath, pageSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** Ada göre işlev/değişken bildiriminin GERÇEK kaynak metnini bulur (satır taşınsa da çalışır). */
  function bildirimMetni(ad) {
    let bulunan = null;
    const gez = (n) => {
      if (bulunan) return;
      if (ts.isFunctionDeclaration(n) && n.name && n.name.text === ad) bulunan = n.getText();
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ad && n.initializer) {
        bulunan = `const ${ad} = ${n.initializer.getText()};`;
      }
      if (!bulunan) ts.forEachChild(n, gez);
    };
    ts.forEachChild(pageAst, gez);
    return bulunan;
  }
  /** Ada göre değişkenin YALNIZ ilk-değer ifadesi (koşulu olduğu gibi çalıştırmak için).
   *  Aynı ad birden çok yerde geçiyorsa `filtre` ile doğru olan seçilir. */
  function ifadeMetni(ad, filtre) {
    const adaylar = [];
    const gez = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ad && n.initializer) adaylar.push(n.initializer.getText());
      ts.forEachChild(n, gez);
    };
    ts.forEachChild(pageAst, gez);
    const secilen = filtre ? adaylar.filter(filtre) : adaylar;
    return secilen.length ? secilen[0] : null;
  }
  /** JSX'te disabled={...} özniteliğinin ifadesi (içinde aranan değişken geçen ilki). */
  function disabledIfadesi(icerenAd) {
    let bulunan = null;
    const gez = (n) => {
      if (bulunan) return;
      if (ts.isJsxAttribute(n) && n.name && n.name.getText() === 'disabled' && n.initializer
        && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
        const t = n.initializer.expression.getText();
        if (t.includes(icerenAd)) bulunan = t;
      }
      if (!bulunan) ts.forEachChild(n, gez);
    };
    ts.forEachChild(pageAst, gez);
    return bulunan;
  }
  /** TS ifadesini/kod bloğunu sahte ortamda ÇALIŞTIR (serbest adlar sandbox'tan çözülür). */
  function calistir(tsKodu, ortam) {
    const js = ts.transpileModule(tsKodu, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
    }).outputText;
    const sandbox = Object.assign({ console, Number, String, Boolean, Array, Object, Math, JSON }, ortam);
    return vm.runInNewContext(js, sandbox, { filename: 'page-parca.js' });
  }

  // 7a) isletmeDocReady + isletmeRowReady + kdvParts — gerçek kod, gerçek girdi
  const feIslevler = ['kdvParts', 'isletmeRowReady', 'isletmeDocReady'].map((ad) => [ad, bildirimMetni(ad)]);
  const eksikIslev = feIslevler.filter(([, m]) => !m).map(([ad]) => ad);
  if (eksikIslev.length) {
    failed++;
    console.error(`  ✗ page.tsx içinde bulunamadı: ${eksikIslev.join(', ')} (ad değişmiş olabilir)`);
  } else {
    const kod = `${feIslevler.map(([, m]) => m).join('\n')}\nmodule.exports = { isletmeDocReady, isletmeRowReady, kdvParts };`;
    const mod = { exports: {} };
    const fe = (() => {
      calistir(kod, {
        module: mod, exports: mod.exports,
        getKayitAltList: shared.getKayitAltList,
        normalizeDocumentType: shared.normalizeDocumentType,
        defaultBelgeTuruKod: shared.defaultBelgeTuruKod,
      });
      return mod.exports;
    })();
    const feBelge = (over = {}) => ({
      invoiceKind: 'ALIS', documentType: 'e-Arşiv Fatura', totalAmount: 1180, lines: [],
      ocrData: { matrah: 1000, kdvTutari: 180, isletme: { kayitTuruKod: '1', kayitAltKod: '186' } },
      ...over,
    });
    ok(fe.isletmeDocReady(feBelge()).ok === true, 'ekran: tam belge HAZIR (belge türü documentType\'tan türetiliyor)');
    ok(fe.isletmeDocReady(feBelge({ documentType: '' })).reason === 'Belge türü yok', 'ekran: belge türü yoksa HAZIR DEĞİL');
    ok(fe.isletmeDocReady(feBelge({ totalAmount: 0, ocrData: { isletme: { kayitTuruKod: '1', kayitAltKod: '186' } } })).reason === 'Tutar okunamadı',
      'ekran: tutar okunamadıysa HAZIR DEĞİL');
    ok(fe.isletmeDocReady(feBelge({ ocrData: { matrah: 1000, isletme: { kayitTuruKod: '1' } } })).reason === 'Kayıt türü eksik',
      'ekran: kayıt alt türü eksikse HAZIR DEĞİL');
    ok(fe.isletmeDocReady(feBelge({ ocrData: { matrah: 1000, isletme: {} } })).ok === false, 'ekran: kayıt türü boş belge HAZIR DEĞİL');
    ok(fe.isletmeDocReady(feBelge({
      ocrData: { matrah: 1000, isletme: { belgeTuruKod: '10', satirlar: [{ matrah: 500, kayitTuruKod: '1', kayitAltKod: '186' }, { matrah: 500, kayitTuruKod: '' }] } },
    })).ok === false, 'ekran: çok satırlıda tek eksik satır bile HAZIR DEĞİL yapar');
    // Ekran ile arka uç AYNI kararı vermeli (yoksa "Muhasebeleştir" açık görünür, onay reddedilir).
    ok(fe.isletmeDocReady(feBelge({ ocrData: { matrah: 1000, isletme: { kayitTuruKod: '1' } } })).ok === false
      && fe.isletmeDocReady(feBelge()).ok === true, 'ekran kararı arka uç kapısıyla aynı yönde');
  }

  // 7b) currentIslReady — formdaki işletme seçimlerinin gerçek koşulu
  {
    const ifade = ifadeMetni('currentIslReady');
    if (!ifade) { failed++; console.error('  ✗ page.tsx: currentIslReady ifadesi bulunamadı'); }
    else {
      const rowReadyMetni = bildirimMetni('isletmeRowReady');
      // İfade, isletmeRowReady ile birlikte çalıştırılır; sonuç module.exports üzerinden okunur.
      const degerlendir = (isl, satirlar) => {
        const m = { exports: {} };
        calistir(`${rowReadyMetni}\nmodule.exports = (${ifade});`, {
          module: m, exports: m.exports, isl, islSatirlar: satirlar, islKind: 'ALIS', getKayitAltList: shared.getKayitAltList,
        });
        return m.exports;
      };
      ok(degerlendir({ belgeTuruKod: '10' }, [{ kayitTuruKod: '1', kayitAltKod: '186' }]) === true,
        'ekran: belge türü + kayıt türü tamsa "Kaydet+Onayla" koşulu SAĞLANIR');
      ok(degerlendir({ belgeTuruKod: '' }, [{ kayitTuruKod: '1', kayitAltKod: '186' }]) === false,
        'ekran: belge türü boşsa koşul SAĞLANMAZ');
      ok(degerlendir({ belgeTuruKod: '10' }, [{ kayitTuruKod: '1', kayitAltKod: '' }]) === false,
        'ekran: kayıt alt türü boşsa koşul SAĞLANMAZ');
      ok(degerlendir({ belgeTuruKod: '10' }, []) === false, 'ekran: hiç satır yoksa koşul SAĞLANMAZ');
    }
  }

  // 7c) ggReady + "Kaydet + Onayla" düğmesinin disabled ifadesi
  {
    const gg = ifadeMetni('ggReady');
    if (!gg) { failed++; console.error('  ✗ page.tsx: ggReady ifadesi bulunamadı'); }
    else {
      const calc = (ortam) => { const m = { exports: {} }; calistir(`module.exports = (${gg});`, Object.assign({ module: m, exports: m.exports }, ortam)); return m.exports; };
      ok(calc({ isIsletme: true, amountReady: true, currentIslReady: true, dengeli: false }) === true, 'ekran: işletmede tutar+seçim tamsa onay serbest');
      ok(calc({ isIsletme: true, amountReady: true, currentIslReady: false, dengeli: true }) === false, 'ekran: işletmede seçim eksikse onay KAPALI (denge kurtarmaz)');
      ok(calc({ isIsletme: true, amountReady: false, currentIslReady: true, dengeli: true }) === false, 'ekran: tutar okunmadıysa onay KAPALI');
      ok(calc({ isIsletme: false, amountReady: true, currentIslReady: false, dengeli: true }) === true, 'ekran: bilançoda ölçü DENGE (işletme koşulu karışmıyor)');
    }
    const dis = disabledIfadesi('ggReady');
    if (!dis) { failed++; console.error('  ✗ page.tsx: ggReady\'e bağlı disabled ifadesi bulunamadı (düğme kopmuş olabilir)'); }
    else {
      const bekle = { isPending: false };
      const calc = (ggReady) => { const m = { exports: {} }; calistir(`module.exports = (${dis});`, { module: m, exports: m.exports, ggReady, approveMut: bekle, saveMetaMut: bekle, saveLinesMut: bekle }); return m.exports; };
      ok(calc(false) === true, 'ekran: hazır değilken "Kaydet + Onayla" düğmesi KAPALI');
      ok(calc(true) === false, 'ekran: hazırken düğme AÇIK');
    }
  }

  // 7d) Toplu "Muhasebeleştir" ve aktarım listesi hazır süzgeçleri
  {
    const isReady = ifadeMetni('isReadyDoc');
    // "ready" adı sayfada birkaç yerde var → aktarım listesindeki (hasCode'lu) süzgeç seçilir.
    const listReady = ifadeMetni('ready', (t) => t.includes('hasCode') && t.includes('isletmeDocReady'));
    const docReadyMetni = bildirimMetni('isletmeDocReady');
    const rowReadyMetni = bildirimMetni('isletmeRowReady');
    const kdvPartsMetni = bildirimMetni('kdvParts');
    const ortakKod = `${kdvPartsMetni}\n${rowReadyMetni}\n${docReadyMetni}\n`;
    const ortakOrtam = {
      getKayitAltList: shared.getKayitAltList,
      normalizeDocumentType: shared.normalizeDocumentType,
      defaultBelgeTuruKod: shared.defaultBelgeTuruKod,
    };
    const feBelge = (over = {}) => ({
      invoiceKind: 'ALIS', documentType: 'e-Arşiv Fatura', totalAmount: 1180, lines: [],
      ocrData: { matrah: 1000, isletme: { kayitTuruKod: '1', kayitAltKod: '186' } },
      ...over,
    });
    if (!isReady) { failed++; console.error('  ✗ page.tsx: toplu muhasebeleştirmedeki isReadyDoc bulunamadı'); }
    else {
      const calc = (d, isIsletme) => {
        const m = { exports: {} };
        calistir(`${ortakKod}module.exports = (${isReady});`, Object.assign({ module: m, exports: m.exports, isIsletme }, ortakOrtam));
        return m.exports(d);
      };
      ok(calc(feBelge(), true) === true, 'toplu: tam işletme belgesi seçime girer');
      ok(calc(feBelge({ ocrData: { matrah: 1000, isletme: {} } }), true) === false, 'toplu: eksik işletme belgesi seçime GİRMEZ');
      ok(calc(feBelge({ status: 'APPROVED' }), true) === false, 'toplu: zaten onaylı belge tekrar onaya girmez');
      ok(calc({ status: 'NEEDS_REVIEW', lines: [{ accountCode: '' }] }, false) === false, 'toplu: bilançoda boş hesap kodlu belge girmez');
      ok(calc({ status: 'NEEDS_REVIEW', lines: [{ accountCode: '770.01.010' }] }, false) === true, 'toplu: bilançoda kodu tam belge girer');
    }
    if (!listReady) { failed++; console.error('  ✗ page.tsx: aktarım listesindeki ready süzgeci bulunamadı'); }
    else {
      const calc = (d, isIsletme) => {
        const m = { exports: {} };
        calistir(`${ortakKod}const hasCode = (d) => Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l) => l.accountCode);\nmodule.exports = (${listReady});`,
          Object.assign({ module: m, exports: m.exports, isIsletme }, ortakOrtam));
        return m.exports(d);
      };
      ok(calc(feBelge(), true) === true, 'liste: tam işletme belgesi HAZIR sayılır');
      ok(calc(feBelge({ ocrData: { matrah: 1000, isletme: { kayitTuruKod: '1' } } }), true) === false, 'liste: alt türü eksik belge EKSİK sayılır');
    }
  }

  // 7e) Form varsayılanı: belge türü selDoc.documentType'tan türetiliyor
  {
    const bulunanlar = [];
    const gez = (n) => {
      if (ts.isCallExpression(n) && ts.isParenthesizedExpression(n.expression)
        && n.getText().includes('normalizeDocumentType(selDoc')) bulunanlar.push(n.getText());
      ts.forEachChild(n, gez);
    };
    ts.forEachChild(pageAst, gez);
    if (!bulunanlar.length) { failed++; console.error('  ✗ page.tsx: belge türü varsayılanını üreten ifade bulunamadı'); }
    else {
      let hepsiDogru = true;
      for (const ifade of bulunanlar) {
        const m = { exports: {} };
        calistir(`module.exports = (${ifade});`, {
          module: m, exports: m.exports,
          selDoc: { documentType: 'e-Arşiv Fatura', ocrData: {} }, kind: 'ALIS',
          normalizeDocumentType: shared.normalizeDocumentType, defaultBelgeTuruKod: shared.defaultBelgeTuruKod,
        });
        if (m.exports !== '10') hepsiDogru = false;
      }
      ok(hepsiDogru, `form varsayılanı: e-Arşiv ALIŞ → belge türü 10 (${bulunanlar.length} yerde aynı)`);
      const m2 = { exports: {} };
      calistir(`module.exports = (${bulunanlar[0]});`, {
        module: m2, exports: m2.exports, selDoc: { documentType: '', ocrData: {} }, kind: 'ALIS',
        normalizeDocumentType: shared.normalizeDocumentType, defaultBelgeTuruKod: shared.defaultBelgeTuruKod,
      });
      ok(m2.exports === '', 'belge türü bilinmiyorsa varsayılan UYDURULMUYOR (boş kalır)');
    }
  }

  if (failed) { console.error(`\nfatura-accounting-guards-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-accounting-guards-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
