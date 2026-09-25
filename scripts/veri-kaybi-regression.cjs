#!/usr/bin/env node
/**
 * VERİ KAYBI regresyonu — portal denetimi Faz C (bulgu 38, 21a, 21b, 39).
 *
 * 38 — Mihsap yenileme veriyi ÇEKMEDEN eski dönemi siliyordu; üstelik silme `faturaTuru` ve
 *      `kaynak` süzmüyordu: "alış yenile" SATIŞ kayıtlarını, arşiv yenilemesi "bekleyen"
 *      kayıtları da siliyordu. Token düşmüşse dönem tamamen boşalıyordu.
 * 21a — `getYil()` (GET) içinde `updateManuel` çağrılıyordu: ekranı açmak / Excel'e aktarmak
 *      mükellefin GEÇİCİ VERGİ TUTARINI kalıcı olarak değiştiriyordu.
 * 21b — `list()` (GET) mükerrer onarımını ateşliyordu; o da satır SİLİYORDU.
 * 39  — e-Defter yeniden analizi "çözüldü / yok sayıldı" işaretlerini ve kullanıcı notunu siliyordu.
 *
 * Betik GERÇEK servisleri sahte prisma ile çağırır — kaynakta metin ARAMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

const { MihsapService } = require(path.join(ROOT, 'apps/api/src/mihsap/mihsap.service.ts'));
const { IsletmeHesapOzetiService } = require(path.join(ROOT, 'apps/api/src/isletme-hesap-ozeti/isletme-hesap-ozeti.service.ts'));

/** Sahte MihsapInvoice tablosu — deleteMany süzgecini GERÇEKTEN uygular. */
function sahteTablo(satirlar) {
  const state = { rows: [...satirlar], silmeler: [] };
  const uyar = (w, r) => {
    if (w.tenantId && r.tenantId !== w.tenantId) return false;
    if (w.mukellefId && r.mukellefId !== w.mukellefId) return false;
    if (w.donem && r.donem !== w.donem) return false;
    if (w.kaynak && r.kaynak !== w.kaynak) return false;
    if (w.faturaTuru) {
      if (typeof w.faturaTuru === 'string') { if (r.faturaTuru !== w.faturaTuru) return false; }
      else if (w.faturaTuru.not && r.faturaTuru === w.faturaTuru.not) return false;
    }
    if (w.mihsapId && w.mihsapId.notIn && w.mihsapId.notIn.includes(r.mihsapId)) return false;
    return true;
  };
  return {
    state,
    mihsapInvoice: {
      deleteMany: async ({ where }) => {
        state.silmeler.push(where);
        const kalan = state.rows.filter((r) => !uyar(where, r));
        const n = state.rows.length - kalan.length;
        state.rows = kalan;
        return { count: n };
      },
    },
  };
}

(async () => {
  console.log('1) BULGU 38 — clearPeriod süzgeçleri');
  {
    const satirlar = [
      { mihsapId: 'a1', tenantId: 't1', mukellefId: 'm1', donem: '2026-08', faturaTuru: 'ALIS', kaynak: 'arsiv' },
      { mihsapId: 'a2', tenantId: 't1', mukellefId: 'm1', donem: '2026-08', faturaTuru: 'TEVKIFATLI_ALIS', kaynak: 'arsiv' },
      { mihsapId: 's1', tenantId: 't1', mukellefId: 'm1', donem: '2026-08', faturaTuru: 'SATIS', kaynak: 'arsiv' },
      { mihsapId: 'b1', tenantId: 't1', mukellefId: 'm1', donem: '2026-08', faturaTuru: 'ALIS', kaynak: 'bekleyen' },
      { mihsapId: 'x1', tenantId: 't2', mukellefId: 'm9', donem: '2026-08', faturaTuru: 'ALIS', kaynak: 'arsiv' },
    ];

    // (a) "alış yenile" SATIŞ'a dokunmamalı
    let p = sahteTablo(satirlar);
    let svc = new MihsapService(p);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    await svc.clearPeriod('t1', 'm1', '2026-08', { faturaTuru: 'ALIS', kaynak: 'arsiv' });
    let kalanId = p.state.rows.map((r) => r.mihsapId).sort();
    ok(kalanId.includes('s1'), `SATIS kaydı DURUYOR (eski kodda siliniyordu) — kalan: ${kalanId.join(',')}`);
    ok(kalanId.includes('b1'), 'bekleyen kaydı DURUYOR (kaynak süzgeci)');
    ok(kalanId.includes('x1'), 'başka ofisin kaydına dokunulmadı');
    ok(!kalanId.includes('a1') && !kalanId.includes('a2'), 'ALIS + TEVKIFATLI_ALIS silindi (tevkifat da alıştır)');

    // (b) koruId — bu çekimde görülenler korunur
    p = sahteTablo(satirlar);
    svc = new MihsapService(p);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    const r = await svc.clearPeriod('t1', 'm1', '2026-08', { faturaTuru: 'ALIS', kaynak: 'arsiv', koruId: ['a1'] });
    kalanId = p.state.rows.map((x) => x.mihsapId).sort();
    ok(r.deleted === 1 && kalanId.includes('a1'),
      `yalnız çekimde GÖRÜLMEYEN silindi (silinen: ${r.deleted}, kalan: ${kalanId.join(',')})`);

    // (c) süzgeçsiz çağrı eski davranışı korur (başka çağıran kırılmasın)
    p = sahteTablo(satirlar);
    svc = new MihsapService(p);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    const hepsi = await svc.clearPeriod('t1', 'm1', '2026-08');
    ok(hepsi.deleted === 4, `süzgeçsiz çağrı dönemin hepsini siliyor (${hepsi.deleted}) — geriye uyumlu`);
  }

  console.log('\n2) BULGU 38 — çekim patlarsa HİÇBİR ŞEY silinmiyor');
  {
    const p = sahteTablo([
      { mihsapId: 'a1', tenantId: 't1', mukellefId: 'm1', donem: '2026-08', faturaTuru: 'ALIS', kaynak: 'arsiv' },
    ]);
    // listAllInvoices patlasın: fetchAndStoreInvoices hatayı yakalayıp errorMsg kuruyor.
    const prisma = {
      ...p,
      mihsapFetchJob: { create: async () => ({ id: 'job1' }), update: async () => ({}) },
      taxpayer: { findFirst: async () => null },
    };
    const svc = new MihsapService(prisma);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.listAllInvoices = async () => { throw new Error('token gecersiz'); };

    let atti = false;
    try {
      await svc.fetchAndStoreInvoices({
        tenantId: 't1', mukellefId: 'm1', mukellefMihsapId: 'mm1',
        donem: '2026-08', faturaTuru: 'ALIS', forceRefresh: true, kaynak: 'arsiv',
      });
    } catch { atti = true; }

    ok(atti, 'çekim hatası yukarı bildiriliyor');
    ok(p.state.silmeler.length === 0, `HİÇ silme çağrısı yapılmadı (gelen: ${p.state.silmeler.length}) — bulgu 38'in özü`);
    ok(p.state.rows.length === 1, 'kayıt yerinde duruyor');
  }

  console.log('\n3) BULGU 21a — yıl görünümü/Excel ARTIK YAZMIYOR');
  {
    const yazmalar = [];
    const kayitlar = [
      { id: 'q1', donem: 1, locked: false, gecmisYilZarari: 20000, donemKari: 50000, oncekiOdenenGecVergi: 0, gecVergiMatrahi: 30000, hesaplananGecVergi: 4500, odenecekGecVergi: 4500, taxpayer: { companyName: 'TEST' } },
      { id: 'q2', donem: 2, locked: false, gecmisYilZarari: 0, donemKari: 80000, oncekiOdenenGecVergi: 4500, gecVergiMatrahi: 80000, hesaplananGecVergi: 12000, odenecekGecVergi: 7500, taxpayer: { companyName: 'TEST' } },
    ];
    const prisma = {
      isletmeHesapOzeti: {
        findMany: async () => kayitlar.map((k) => ({ ...k })),
        update: async (a) => { yazmalar.push(a); return a.data; },
        findFirst: async () => null,
        findUnique: async () => null,
        create: async (a) => a.data,
      },
      taxpayer: { findFirst: async () => ({ id: 'tp1' }) },
    };
    const svc = new IsletmeHesapOzetiService(prisma);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };

    const sonuc = await svc.getYil('t1', 'tp1', 2026);
    ok(yazmalar.length === 0, `okuma ucu HİÇ yazmadı (gelen: ${yazmalar.length} update) — eski kodda Q2 güncelleniyordu`);

    const q2 = sonuc.ceyrekler[1];
    ok(Number(q2.gecmisYilZarari) === 20000, `Q2 ekranda zararı yayılmış görüyor (${q2.gecmisYilZarari})`);
    ok(Number(q2.gecVergiMatrahi) === 60000, `matrah bellekte doğru: 80.000−20.000=60.000 (gelen: ${q2.gecVergiMatrahi})`);
    ok(Number(q2.hesaplananGecVergi) === 9000, `hesaplanan %15 → 9.000 (gelen: ${q2.hesaplananGecVergi})`);
    ok(Number(q2.odenecekGecVergi) === 4500, `ödenecek 9.000−4.500=4.500 (gelen: ${q2.odenecekGecVergi})`);
    ok(q2.zararYayilmisGorunum === true, 'kayıt "bu değer kaydedilmedi" diye işaretli');
    ok(sonuc.ceyrekler[0].zararYayilmisGorunum === undefined, 'kaynak çeyrek olduğu gibi dönüyor');
  }

  console.log('\n4) BULGU 21a — kilitli çeyreğe dokunulmuyor');
  {
    const kayitlar = [
      { id: 'q1', donem: 1, locked: false, gecmisYilZarari: 20000, donemKari: 50000, oncekiOdenenGecVergi: 0, taxpayer: {} },
      { id: 'q2', donem: 2, locked: true, gecmisYilZarari: 0, donemKari: 80000, oncekiOdenenGecVergi: 0, gecVergiMatrahi: 80000, taxpayer: {} },
    ];
    const prisma = {
      isletmeHesapOzeti: { findMany: async () => kayitlar.map((k) => ({ ...k })), update: async () => { throw new Error('yazmamali'); } },
      taxpayer: { findFirst: async () => null },
    };
    const svc = new IsletmeHesapOzetiService(prisma);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    const sonuc = await svc.getYil('t1', 'tp1', 2026);
    ok(Number(sonuc.ceyrekler[1].gecmisYilZarari) === 0, 'kilitli çeyrek olduğu gibi kalıyor');
  }

  console.log('\n5) BULGU 21b — beyan listesini AÇMAK artık kayıt silmiyor');
  {
    const { BeyanKayitlariService } = require(path.join(ROOT, 'apps/api/src/beyan-kayitlari/beyan-kayitlari.service.ts'));
    const cagrilar = [];
    const prisma = {
      beyanKaydi: {
        findMany: async (a) => { cagrilar.push(['findMany', a]); return []; },
        deleteMany: async (a) => { cagrilar.push(['deleteMany', a]); return { count: 0 }; },
        update: async (a) => { cagrilar.push(['update', a]); return {}; },
      },
      beyanDurumu: {
        findMany: async () => [],
        deleteMany: async (a) => { cagrilar.push(['durumDeleteMany', a]); return { count: 0 }; },
        update: async () => ({}),
      },
      $transaction: async (fn) => fn(prisma),
    };
    const svc = new BeyanKayitlariService(prisma, {}, {});
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };

    await svc.list('t1', {});
    // Ateşle-unut olduğu için bir tur bekle: eski kodda silme BU noktada düşüyordu.
    await new Promise((r) => setTimeout(r, 60));

    const yazma = cagrilar.filter(([tip]) => tip !== 'findMany');
    ok(yazma.length === 0, `liste okuması HİÇ yazma yapmadı (gelen: ${yazma.map(([t]) => t).join(',') || 'yok'})`);
    ok(cagrilar.some(([tip]) => tip === 'findMany'), 'liste yine de veri okudu (işlev bozulmadı)');
    ok(typeof svc.repairTemporaryTaxDuplicates === 'function',
      'onarım kaldırılmadı, yalnız yolu değişti — elle/planlı çağrılabiliyor');
    ok(typeof svc.gecelikMukerrerOnarimi === 'function', 'gecelik planlı iş var');
  }

  console.log('\n6) BULGU 39 — bulgu kimliği kararları doğru eşliyor');
  {
    const { EDefterControlService } = require(path.join(ROOT, 'apps/api/src/edefter-control/edefter-control.service.ts'));
    const svc = Object.create(EDefterControlService.prototype);
    const anahtar = (f) => svc.bulguAnahtari(f);

    const temel = { severity: 'WARN', category: 'KASA', message: 'Kasa negatife düştü: -1.250,00', voucherKey: 'V12', rowIndex: 7, hesapKodu: '100' };
    ok(anahtar(temel) === anahtar({ ...temel }), 'aynı bulgu aynı anahtarı veriyor');
    ok(anahtar(temel) !== anahtar({ ...temel, message: 'Kasa negatife düştü: -9.999,00' }),
      'aynı hesapta FARKLI tutar farklı bulgu — kararlar birbirine geçmiyor');
    ok(anahtar(temel) !== anahtar({ ...temel, hesapKodu: '101' }), 'farklı hesap farklı anahtar');
    ok(anahtar(temel) !== anahtar({ ...temel, voucherKey: 'V13' }), 'farklı fiş farklı anahtar');
    ok(anahtar(temel) !== anahtar({ ...temel, rowIndex: 8 }), 'farklı satır farklı anahtar');
    ok(anahtar(temel) !== anahtar({ ...temel, severity: 'ERROR' }), 'farklı ağırlık farklı anahtar');
    // Boş alanlar çakışma üretmemeli
    ok(anahtar({ category: 'A', message: 'B' }) !== anahtar({ category: 'A|B', message: '' }),
      'boş alanlar ayraçla çakışmıyor');
    ok(anahtar({ ...temel, message: '  Kasa negatife düştü: -1.250,00  ' }) === anahtar(temel),
      'baş/son boşluk anahtarı bozmuyor');
  }

  console.log('\n7) BULGU 10a — kilitli mizan artık Excel yolundan da silinemiyor');
  {
    const { MizanService } = require(path.join(ROOT, 'apps/api/src/mizan/mizan.service.ts'));

    const kur = (kilitliVarMi) => {
      const izler = { silmeler: [], olusturma: 0 };
      const prisma = {
        mizan: {
          findFirst: async (a) => (a?.where?.locked === true && kilitliVarMi
            ? { id: 'eski', lockedAt: new Date('2026-08-15T10:00:00Z') }
            : null),
          deleteMany: async (a) => { izler.silmeler.push(a.where); return { count: 1 }; },
          create: async (a) => { izler.olusturma++; return { id: 'yeni', ...a.data }; },
          update: async () => ({}),
        },
        mizanHesap: { createMany: async () => ({ count: 0 }) },
        mizanAnomali: { createMany: async () => ({ count: 0 }) },
        taxpayer: { findFirst: async () => ({ id: 'tp1', companyName: 'TEST' }) },
      };
      const svc = new MizanService(prisma, { parse: () => [] }, {}, {});
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.parser = { parse: () => [{ hesapKodu: '100', hesapAdi: 'KASA', borc: 1, alacak: 0 }] };
      return { svc, izler };
    };

    // (a) kilitli mizan varsa: hata ver, HİÇBİR ŞEY silme
    {
      const { svc, izler } = kur(true);
      let hata = null;
      try {
        await svc.importFromExcel({ tenantId: 't1', taxpayerId: 'tp1', donem: '2026-Q2', donemTipi: 'GECICI_Q2', buffer: Buffer.from('x') });
      } catch (e) { hata = e; }
      ok(!!hata, 'kilitli dönemde hata fırlatıldı');
      ok(hata && /kesin kayıtlı/i.test(hata.message || ''), `mesaj kullanıcıya ne yapacağını söylüyor: "${hata && String(hata.message).slice(0, 70)}"`);
      ok(izler.silmeler.length === 0, `HİÇ silme yapılmadı (gelen: ${izler.silmeler.length}) — eski kodda 58 kesin kayıtlı mizan buradan silinebiliyordu`);
      ok(izler.olusturma === 0, 'yerine boş kayıt da yazılmadı');
    }

    // (b) kilit yoksa eski davranış aynen sürüyor
    {
      const { svc, izler } = kur(false);
      await svc.importFromExcel({ tenantId: 't1', taxpayerId: 'tp1', donem: '2026-Q2', donemTipi: 'GECICI_Q2', buffer: Buffer.from('x') });
      ok(izler.silmeler.length === 1, 'kilitsiz dönemde eski mizan yine siliniyor (işlev bozulmadı)');
      ok(izler.olusturma === 1, 'yeni mizan oluşturuldu');
    }

    // (c) replaceExisting:false ise kilit kontrolü de silme de yok (e-Defter eşlik eden yol)
    {
      const { svc, izler } = kur(true);
      await svc.importFromExcel({ tenantId: 't1', taxpayerId: 'tp1', donem: '2026-Q2', donemTipi: 'GECICI_Q2', buffer: Buffer.from('x'), replaceExisting: false });
      ok(izler.silmeler.length === 0 && izler.olusturma === 1,
        'replaceExisting:false yolunda kilit engel değil, silme de yok (e-Defter eşlik eden mizan)');
    }
  }

  if (failed) { console.error(`\nveri-kaybi-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nveri-kaybi-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
