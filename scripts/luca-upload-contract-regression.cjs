#!/usr/bin/env node
/**
 * LUCA YÜKLEME SÖZLEŞMESİ regresyonu.
 *   apps/api/src/luca/luca.controller.ts        (runner upload uçları + assertRunnerUploadJob)
 *   apps/api/src/luca/luca.service.ts           (iş kuyruğu: mükerrer koruma, cooldown, teknik retry)
 *   apps/api/src/edefter-control/edefter-control.controller.ts (e-Defter runner ucu)
 *   packages/shared/src/contracts/luca.contract.ts
 *   apps/luca-local-agent/src/agent.js          (desteklenen iş tipleri)
 *   apps/api/public/agent-runtime.js            (KDV Defteri Kebir menü denemeleri)
 *
 * 2026-09-25 denetimi: bu betik eskiden BÜTÜN kaynakları birleştirip içinde METİN ARIYORDU
 *   (requireText('job.status !== \'running\'') gibi). Metin yerinde dururken koşul ters çevrilebilir,
 *   kapı kaldırılabilir, kod başka dosyaya taşınabilir — test yine yeşil kalırdı.
 *   Artık korumalar GERÇEKTEN ÇALIŞTIRILARAK sınanıyor:
 *     · ts-node + sahte prisma/sahte servislerle gerçek controller ve servis metotları çağrılır,
 *     · sahte prisma "where" koşullarını GERÇEKTEN uygular (küçük eşleştirici) → süzgeç davranışı ölçülür,
 *     · shared sözleşme zod şeması gerçek girdilerle parse edilir,
 *     · uç (endpoint) varlığı Nest yol metadata'sından okunur — metinden değil,
 *     · tarayıcıda çalışan agent-runtime.js ve ajanın agent.js dosyasındaki saf işlevler
 *       TypeScript ayrıştırıcısıyla dosyadan çıkarılıp sahte ortamda koşturulur.
 *
 * METİN TABANLI KALAN KONTROL: yok.
 *   Yalnız BULMA adımı ada göredir (işlev/değişken adı); DOĞRULAMA adımı her yerde kodu çalıştırır.
 *   Ad değişirse betik "bulunamadı" diye kırmızıya döner, sessizce geçmez.
 *
 * NOT (kapsam dışı, bilerek bırakıldı): upload-kdv-isletme-gg ucunun kabul ettiği KDV_ISLETME_GG
 *   tipi shared sözleşme listesinde YOK; e-Defter ucu ise kendi yerel kapısını kullanıyor ve
 *   job.status='running' kontrolü YAPMIYOR. Bu betik var olan davranışı ölçer, düzeltme önermez.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'apps', 'api', 'node_modules', 'typescript'));
require(path.join(ROOT, 'apps', 'api', 'node_modules', 'reflect-metadata'));
require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const contract = require(path.join(ROOT, 'packages/shared/src/contracts/luca.contract.ts'));
const { LucaService } = require(path.join(ROOT, 'apps/api/src/luca/luca.service.ts'));
const { LucaController } = require(path.join(ROOT, 'apps/api/src/luca/luca.controller.ts'));
const { EDefterControlController } = require(path.join(ROOT, 'apps/api/src/edefter-control/edefter-control.controller.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

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

/** Prisma "where" koşulunu GERÇEKTEN uygular — süzgeçleri metinle değil davranışla ölçmek için. */
function eslesir(kayit, where) {
  if (!where || typeof where !== 'object') return true;
  for (const [alan, kosul] of Object.entries(where)) {
    if (alan === 'AND') { if (!(Array.isArray(kosul) ? kosul : [kosul]).every((w) => eslesir(kayit, w))) return false; continue; }
    if (alan === 'OR') { if (!(Array.isArray(kosul) ? kosul : [kosul]).some((w) => eslesir(kayit, w))) return false; continue; }
    if (alan === 'NOT') { if (eslesir(kayit, kosul)) return false; continue; }
    const deger = kayit ? kayit[alan] : undefined;
    if (kosul && typeof kosul === 'object' && !(kosul instanceof Date)) {
      if ('in' in kosul && !kosul.in.includes(deger)) return false;
      if ('notIn' in kosul && kosul.notIn.includes(deger)) return false;
      if ('not' in kosul) {
        const n = kosul.not;
        if (n && typeof n === 'object' && 'in' in n) { if (n.in.includes(deger)) return false; }
        else if (deger === n) return false;
      }
      if ('lte' in kosul && !(deger != null && new Date(deger).getTime() <= new Date(kosul.lte).getTime())) return false;
      if ('lt' in kosul && !(deger != null && new Date(deger).getTime() < new Date(kosul.lt).getTime())) return false;
      if ('gte' in kosul && !(deger != null && new Date(deger).getTime() >= new Date(kosul.gte).getTime())) return false;
      if ('equals' in kosul && deger !== kosul.equals) return false;
      continue;
    }
    if (deger !== kosul) return false;
  }
  return true;
}

/** Sahte prisma: verilen tablolar elle, gerisi zararsız boş (log/audit yan yolları testi düşürmesin). */
function makePrisma(tablolar = {}) {
  const bos = () => ({
    findFirst: async () => null, findUnique: async () => null, findMany: async () => [],
    count: async () => 0, create: async (a) => (a && a.data) || {}, update: async (a) => (a && a.data) || {},
    updateMany: async () => ({ count: 0 }), upsert: async (a) => (a && a.create) || {},
    deleteMany: async () => ({ count: 0 }), groupBy: async () => [], aggregate: async () => ({}),
  });
  const cache = new Map();
  return new Proxy({}, {
    get(_t, ad) {
      if (typeof ad !== 'string' || ad === 'then') return undefined;
      if (tablolar[ad]) return tablolar[ad];
      if (!cache.has(ad)) cache.set(ad, bos());
      return cache.get(ad);
    },
  });
}

/** Her metodu sessizce başarılı dönen sahte servis (bildirimler vb.). */
function sessizServis() {
  return new Proxy({}, { get: () => async () => undefined });
}

/** Ada göre işlev/değişken bildiriminin gerçek kaynak metnini bulur (iç içe kapsamlarda da arar). */
function bildirimMetni(sourceFile, ad) {
  let bulunan = null;
  const gez = (n) => {
    if (bulunan) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === ad) bulunan = n.getText();
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ad && n.initializer) {
      bulunan = `const ${ad} = ${n.initializer.getText()};`;
    }
    if (!bulunan) ts.forEachChild(n, gez);
  };
  ts.forEachChild(sourceFile, gez);
  return bulunan;
}

/** Dosyadan çıkarılan kodu sahte ortamda çalıştır; istenen adları dışa verir.
 *  (vm'de `const` bildirimleri global olmadığı için adlar açıkça dışarı aktarılır.) */
function calistir(kod, ortam, disariAdlar = []) {
  const cikti = {};
  const sandbox = Object.assign(
    { console, Number, String, Boolean, Array, Object, Math, JSON, Set, Map, RegExp, Date, __cikti: cikti },
    ortam,
  );
  const son = disariAdlar.length ? `\nObject.assign(__cikti, { ${disariAdlar.join(', ')} });` : '';
  vm.runInNewContext(`${kod}${son}`, sandbox, { filename: 'cikarilan-parca.js' });
  return Object.assign(sandbox, cikti);
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // 1) SHARED SÖZLEŞME — gerçek zod şeması çalıştırılır
  //    (eski metin kontrolleri: requireIn(sharedContractSrc, "'MIZAN'") … + eski isim taraması)
  // ════════════════════════════════════════════════════════════════════
  console.log('1) Shared Luca sözleşmesi (gerçek şema)');
  const beklenenTipler = [
    'MIZAN', 'ACCOUNT_PLAN', 'KDV_MIZAN', 'KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER',
    'IHO_FETCH', 'EARSIV_SATIS', 'EARSIV_ALIS', 'EFATURA_SATIS', 'EFATURA_ALIS', 'EDEFTER_FIS_LISTESI',
  ];
  const gercekTipler = contract.LucaJobTipiSchema.options;
  {
    const eksik = beklenenTipler.filter((t) => !gercekTipler.includes(t));
    const fazla = gercekTipler.filter((t) => !beklenenTipler.includes(t));
    ok(eksik.length === 0, `sözleşme gerçek job tiplerinin tamamını içeriyor${eksik.length ? ` — EKSİK: ${eksik.join(', ')}` : ''}`);
    ok(fazla.length === 0, `sözleşmeye habersiz tip eklenmemiş${fazla.length ? ` — FAZLA: ${fazla.join(', ')}` : ''}`);
  }
  {
    const beklenenUc = {
      MIZAN: 'upload-mizan', ACCOUNT_PLAN: 'upload-account-plan', KDV_MIZAN: 'upload-kdv-mizan',
      KDV_191: 'upload-kdv', KDV_391: 'upload-kdv', ISLETME_GELIR: 'upload-kdv', ISLETME_GIDER: 'upload-kdv',
      IHO_FETCH: 'upload-iho', EARSIV_SATIS: 'upload-earsiv', EARSIV_ALIS: 'upload-earsiv',
      EFATURA_SATIS: 'upload-earsiv', EFATURA_ALIS: 'upload-earsiv', EDEFTER_FIS_LISTESI: 'upload-edefter-fis-listesi',
    };
    let hepsi = true;
    for (const tip of beklenenTipler) {
      const gercek = contract.expectedEndpointForJob(tip);
      if (gercek !== beklenenUc[tip]) { hepsi = false; console.error(`  ✗ ${tip} → ${gercek} (beklenen ${beklenenUc[tip]})`); failed++; }
    }
    ok(hepsi, 'her job tipi doğru upload ucuna kilitli (gerçek eşleme tablosu okundu)');
  }
  {
    // Eski/yanlış isimler ŞEMA TARAFINDAN reddediliyor mu (metinde yok mu değil, KABUL EDİLMİYOR mu)?
    const eskiler = ['EARSIV_GELEN', 'EARSIV_GIDEN', 'EFATURA_GELEN', 'EFATURA_GIDEN', 'HESAP_PLANI'];
    const kabulEdilen = eskiler.filter((t) => contract.LucaJobTipiSchema.safeParse(t).success);
    ok(kabulEdilen.length === 0, `eski job isimleri şema tarafından reddediliyor${kabulEdilen.length ? ` — KABUL EDİLDİ: ${kabulEdilen.join(', ')}` : ''}`);
    const anahtarlar = Object.keys(contract.LUCA_JOB_TO_ENDPOINT);
    ok(!eskiler.some((t) => anahtarlar.includes(t)), 'eşleme tablosunda eski job ismi yok');
    ok(!Object.values(contract.LUCA_JOB_TO_ENDPOINT).includes('upload-hesap-plani'), 'eski upload-hesap-plani ucu geri gelmemiş');
  }
  {
    // parseLucaJobUpload GERÇEKTEN kapı mı?
    const gecerli = { jobId: 'j1', tip: 'MIZAN', mukellefId: 'tp1', donem: '2026-09', sessionId: null };
    const r = contract.parseLucaJobUpload(gecerli, 'test');
    ok(r.tip === 'MIZAN' && r.donem === '2026-09', 'geçerli yükleme paketi kabul ediliyor');
    for (const [bozuk, ad] of [
      [{ ...gecerli, jobId: '' }, 'jobId boş'],
      [{ ...gecerli, tip: 'EARSIV_GELEN' }, 'eski job tipi'],
      [{ ...gecerli, tip: 'KDV_KONTROL' }, 'belirsiz KDV tipi'],
      [{ ...gecerli, donem: '2026-9' }, 'hatalı dönem biçimi'],
      [{ ...gecerli, mukellefId: '' }, 'mükellef boş'],
    ]) {
      let attiMi = false;
      try { contract.parseLucaJobUpload(bozuk, 'test'); } catch { attiMi = true; }
      ok(attiMi, `${ad} olan paket REDDEDİLİYOR`);
    }
    for (const donem of ['2026-09', '2026-Q3', '2026', '2026-09-01_2026-09-30']) {
      ok(contract.LucaDonemSchema.safeParse(donem).success, `geçerli dönem biçimi kabul: ${donem}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2) SÖZLEŞMEDEKİ UÇLAR GERÇEKTEN VAR MI — Nest yol metadata'sı
  // ════════════════════════════════════════════════════════════════════
  console.log('\n2) Sözleşmedeki upload uçları gerçek rota olarak var mı');
  {
    const rotalar = new Set();
    for (const kls of [LucaController, EDefterControlController]) {
      const proto = kls.prototype;
      for (const ad of Object.getOwnPropertyNames(proto)) {
        if (ad === 'constructor' || typeof proto[ad] !== 'function') continue;
        const yol = Reflect.getMetadata('path', proto[ad]);
        if (yol) rotalar.add(String(yol));
      }
    }
    const beklenen = Array.from(new Set(Object.values(contract.LUCA_JOB_TO_ENDPOINT)));
    const yok = beklenen.filter((uc) => !rotalar.has(`agent/luca/runner/${uc}`));
    ok(yok.length === 0, `sözleşmedeki ${beklenen.length} ucun tamamı canlı rota${yok.length ? ` — YOK: ${yok.join(', ')}` : ''}`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 3) assertRunnerUploadJob — gerçek kapı, her kontrol tek tek
  //    (eski metin kontrolleri: requireText("job.status !== 'running'"),
  //     'job.mukellefId !== opts.mukellefId', 'normalizeRunnerDonem', 'exactTip?: string | null' …)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n3) assertRunnerUploadJob — job/status/modül/session kilidi');
  function ctrl(is, ek = {}) {
    const cagrilar = [];
    const izle = (ad) => async (...a) => { cagrilar.push({ ad, a }); return {}; };
    const luca = {
      getJob: async (jobId) => { if (!is || is.id !== jobId) throw new Error('Luca fetch job bulunamadı'); return is; },
      markJobDone: izle('markJobDone'), markJobFailed: izle('markJobFailed'), appendJobLog: izle('appendJobLog'),
    };
    const c = new LucaController(
      luca,
      sessizServis(),
      { importFromExcel: async (...a) => { cagrilar.push({ ad: 'mizan.importFromExcel', a }); return { id: 'm1', rows: 3 }; } },
      makePrisma({ tenant: { findFirst: async () => ({ id: 't1' }) } }),
      { findSession: async () => ek.session || { id: 's1', type: 'KDV_191' },
        uploadExcelFromRunner: async (...a) => { cagrilar.push({ ad: 'kdvControl.uploadExcelFromRunner', a }); return { rows: 2 }; } },
      { importLucaSnapshotXls: async (...a) => { cagrilar.push({ ad: 'kdvBeyanname.importLucaSnapshotXls', a }); return { id: 'k1', toplamHesapAdet: 4 }; },
        importIsletmeGGSnapshot: async (...a) => { cagrilar.push({ ad: 'kdvBeyanname.importIsletmeGGSnapshot', a }); return { id: 'g1' }; } },
      { applyLucaSnapshot: async (...a) => { cagrilar.push({ ad: 'iho.applyLucaSnapshot', a }); return { id: 'i1' }; } },
      { importFromZip: async (...a) => { cagrilar.push({ ad: 'earsiv.importFromZip', a }); return { inserted: 1, duplicate: 0, skipped: 0, total: 1 }; } },
      { parse: () => [] },
      { importAccountPlanSnapshot: async (...a) => { cagrilar.push({ ad: 'fm.importAccountPlanSnapshot', a }); return { accountCount: 5 }; } },
      sessizServis(),
    );
    return { c, cagrilar };
  }
  const isNesnesi = (over = {}) => ({
    id: 'j1', tenantId: 't1', tip: 'MIZAN', status: 'running', mukellefId: 'tp1', donem: '2026-09', sessionId: null, ...over,
  });
  const kapi = (c, opts) => c.assertRunnerUploadJob(Object.assign({ tenantId: 't1', label: 'Test' }, opts));
  {
    const { c } = ctrl(isNesnesi());
    await reddedildiMi(() => kapi(c, { allowedTips: ['MIZAN'] }), /jobId zorunlu/i, 'jobId olmadan yükleme yapılamaz');
    await reddedildiMi(() => kapi(c, { jobId: 'yok', allowedTips: ['MIZAN'] }), /job bulunamadi/i, 'var olmayan job ile yükleme yapılamaz');
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['KDV_MIZAN'] }), /job tipi MIZAN, beklenen KDV_MIZAN/i, 'izinli tip listesi dışındaki job reddedilir');
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], exactTip: 'KDV_MIZAN' }), /hedef modulle uyusmuyor/i, 'exactTip uyuşmazsa reddedilir (modül karışması)');
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], mukellefId: 'tp9' }), /mukellefId job ile uyusmuyor/i, 'başka mükellefin dosyası yüklenemez');
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], donem: '2026-08' }), /donem job ile uyusmuyor/i, 'başka dönemin dosyası yüklenemez');
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], sessionId: 's9' }), /sessionId job ile uyusmuyor/i, 'başka oturumun dosyası yüklenemez');
    const gecen = await kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], exactTip: 'MIZAN', mukellefId: 'tp1', donem: '2026-09' });
    ok(gecen && gecen.id === 'j1', 'sözleşmeye uyan job geçer ve iş nesnesi döner');
    const normalize = await kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'], donem: '2026/09' });
    ok(!!normalize, 'dönem ayıracı farkı (2026/09 ↔ 2026-09) normalize edilip kabul edilir');
  }
  for (const durum of ['pending', 'done', 'failed', 'cancelled']) {
    const { c } = ctrl(isNesnesi({ status: durum }));
    await reddedildiMi(() => kapi(c, { jobId: 'j1', allowedTips: ['MIZAN'] }), /job running degil/i, `"${durum}" durumundaki job'a yükleme yapılamaz`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 4) UPLOAD UÇLARI KAPIYA BAĞLI — gerçek endpoint çağrısı
  //    (eski metin kontrolleri: functionSlice(fn).includes('assertRunnerUploadJob') …)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n4) Runner upload uçları — aykırı job içeri giremez');
  const dosya = { buffer: Buffer.from('test'), originalname: 'x.xls' };
  /** Her uç: [metod, doğru job tipi, çağrı üreteci, kapı sonrası beklenen alt servis] */
  const uclar = [
    ['uploadMizanFromRunner', 'MIZAN', (c, jobId) => c.uploadMizanFromRunner('tok', dosya, 'tp1', '2026-09', undefined, jobId), 'mizan.importFromExcel'],
    ['uploadAccountPlanFromRunner', 'ACCOUNT_PLAN', (c, jobId) => c.uploadAccountPlanFromRunner('tok', dosya, 'tp1', jobId), 'fm.importAccountPlanSnapshot'],
    ['uploadKdvMizanFromRunner', 'KDV_MIZAN', (c, jobId) => c.uploadKdvMizanFromRunner('tok', dosya, 'tp1', '2026-09', jobId), 'kdvBeyanname.importLucaSnapshotXls'],
    ['uploadKdvIsletmeGgFromRunner', 'KDV_ISLETME_GG', (c, jobId) => c.uploadKdvIsletmeGgFromRunner('tok', dosya, 'tp1', '2026-09', jobId), 'kdvBeyanname.importIsletmeGGSnapshot'],
    ['uploadIhoFromRunner', 'IHO_FETCH', (c, jobId) => c.uploadIhoFromRunner('tok', dosya, 's1', jobId), 'iho.applyLucaSnapshot'],
    ['uploadEarsivFromRunner', 'EARSIV_SATIS', (c, jobId) => c.uploadEarsivFromRunner('tok', dosya, 'tp1', '2026-09', 'SATIS', 'EARSIV', jobId), 'earsiv.importFromZip'],
    ['uploadKdvFromRunner', 'KDV_191', (c, jobId) => c.uploadKdvFromRunner('tok', dosya, 's1', jobId || ''), 'kdvControl.uploadExcelFromRunner'],
  ];
  for (const [ad, dogruTip, cagir, altServis] of uclar) {
    // (a) jobId yok → reddedilir
    {
      const { c, cagrilar } = ctrl(isNesnesi({ tip: dogruTip }));
      await reddedildiMi(() => cagir(c, undefined), /jobId|gerekli/i, `${ad}: jobId olmadan yükleme yapılamaz`);
      ok(!cagrilar.some((x) => x.ad === altServis), `${ad}: reddedilen istekte içe alma ÇAĞRILMADI`);
    }
    // (b) job "running" değil → reddedilir
    {
      const { c, cagrilar } = ctrl(isNesnesi({ tip: dogruTip, status: 'pending', sessionId: 's1' }));
      await reddedildiMi(() => cagir(c, 'j1'), /running degil|reddedildi/i, `${ad}: beklemedeki job'a yükleme yapılamaz`);
      ok(!cagrilar.some((x) => x.ad === altServis), `${ad}: durum kapısı geçilemedi (içe alma yok)`);
    }
    // (c) BAŞKA modülün job tipi → reddedilir
    {
      const yanlis = dogruTip === 'MIZAN' ? 'KDV_MIZAN' : 'MIZAN';
      const { c, cagrilar } = ctrl(isNesnesi({ tip: yanlis, sessionId: 's1' }));
      await reddedildiMi(() => cagir(c, 'j1'), /reddedildi/i, `${ad}: başka modülün job'ı (${yanlis}) reddedilir`);
      ok(!cagrilar.some((x) => x.ad === altServis), `${ad}: modül karışması içe alma yapmıyor`);
    }
    // (d) sözleşmeye UYAN job → kapı geçilir, içe alma çalışır
    {
      const oturum = ad === 'uploadKdvFromRunner' ? { id: 's1', type: dogruTip } : undefined;
      const { c, cagrilar } = ctrl(isNesnesi({ tip: dogruTip, sessionId: 's1' }), { session: oturum });
      try { await cagir(c, 'j1'); } catch (e) { /* alt servis sonrası yollar testin konusu değil */ }
      ok(cagrilar.some((x) => x.ad === altServis), `${ad}: uyumlu job'da içe alma çalıştı (kapı gereksiz kilitlemiyor)`);
    }
  }
  {
    // KDV kontrol ucu: oturum tipi ile job tipi BİREBİR eşleşmeli (modül karışması sessiz kalmasın).
    const { c, cagrilar } = ctrl(isNesnesi({ tip: 'KDV_391', sessionId: 's1' }), { session: { id: 's1', type: 'KDV_191' } });
    await reddedildiMi(() => c.uploadKdvFromRunner('tok', dosya, 's1', 'j1'), /hedef modulle uyusmuyor/i,
      'KDV kontrol: oturum KDV_191 iken KDV_391 job reddedilir');
    ok(!cagrilar.some((x) => x.ad === 'kdvControl.uploadExcelFromRunner'), 'KDV kontrol: karışan tipte Excel içe alınmadı');
  }
  {
    // Eski/belirsiz KDV job tipleri hiç kabul edilmiyor.
    for (const eski of ['KDV_KONTROL', 'KDV1', 'KDV2']) {
      const { c } = ctrl(isNesnesi({ tip: eski, sessionId: 's1' }), { session: { id: 's1', type: eski } });
      await reddedildiMi(() => c.uploadKdvFromRunner('tok', dosya, 's1', 'j1'), /reddedildi/i, `KDV kontrol: eski tip ${eski} reddedilir`);
    }
  }
  {
    // E-Arşiv ucu: belgeKaynak + tip birleşimi job tipine BİREBİR kilitli.
    const { c, cagrilar } = ctrl(isNesnesi({ tip: 'EARSIV_ALIS', sessionId: 's1' }));
    await reddedildiMi(() => c.uploadEarsivFromRunner('tok', dosya, 'tp1', '2026-09', 'SATIS', 'EARSIV', 'j1'),
      /hedef modulle uyusmuyor/i, 'E-Arşiv: SATIS isteği ALIS job\'ına yüklenemez');
    ok(!cagrilar.some((x) => x.ad === 'earsiv.importFromZip'), 'E-Arşiv: yön karışmasında ZIP içe alınmadı');
    const { c: c2, cagrilar: c2c } = ctrl(isNesnesi({ tip: 'EFATURA_SATIS', sessionId: 's1' }));
    await c2.uploadEarsivFromRunner('tok', dosya, 'tp1', '2026-09', 'SATIS', 'EFATURA', 'j1');
    ok(c2c.some((x) => x.ad === 'earsiv.importFromZip'), 'E-Fatura SATIS doğru job ile geçer');
    const { c: c3 } = ctrl(isNesnesi({ tip: 'EARSIV_SATIS', sessionId: 's1' }));
    await reddedildiMi(() => c3.uploadEarsivFromRunner('tok', dosya, 'tp1', '2026-09', 'SATIS', 'EFATURA', 'j1'),
      /hedef modulle uyusmuyor/i, 'E-Fatura isteği E-Arşiv job\'ına yüklenemez');
  }
  {
    // e-Defter Detay Fiş Listesi ucu (kendi yerel kapısı): yanlış tip/mükellef/dönem reddedilir.
    function edefterCtrl(is) {
      const cagrilar = [];
      const c = new EDefterControlController(
        { importFromExcel: async (...a) => { cagrilar.push({ ad: 'edefter.importFromExcel', a }); return { rows: 7 }; },
          createCompanionMizanJob: async () => ({ id: 'mz1' }) },
        { getJob: async (jobId) => { if (!is || is.id !== jobId) throw new Error('bulunamadı'); return is; },
          markJobDone: async () => undefined, markJobFailed: async () => undefined, appendJobLog: async () => undefined },
        makePrisma({ tenant: { findFirst: async () => ({ id: 't1' }) } }),
      );
      return { c, cagrilar };
    }
    {
      const { c, cagrilar } = edefterCtrl(isNesnesi({ tip: 'MIZAN' }));
      await reddedildiMi(() => c.uploadFromRunner('tok', dosya, 'tp1', '2026-09', undefined, 'j1'), /job tipi MIZAN/i,
        'e-Defter: yanlış tipteki job reddedilir');
      ok(!cagrilar.some((x) => x.ad === 'edefter.importFromExcel'), 'e-Defter: reddedilen işte içe alma yok');
    }
    {
      const { c } = edefterCtrl(isNesnesi({ tip: 'EDEFTER_FIS_LISTESI', mukellefId: 'tp9' }));
      await reddedildiMi(() => c.uploadFromRunner('tok', dosya, 'tp1', '2026-09', undefined, 'j1'), /mukellef job ile uyusmuyor/i,
        'e-Defter: başka mükellefin dosyası yüklenemez');
    }
    {
      const { c } = edefterCtrl(isNesnesi({ tip: 'EDEFTER_FIS_LISTESI', donem: '2026-08' }));
      await reddedildiMi(() => c.uploadFromRunner('tok', dosya, 'tp1', '2026-09', undefined, 'j1'), /donem job ile uyusmuyor/i,
        'e-Defter: başka dönemin dosyası yüklenemez');
    }
    {
      const { c, cagrilar } = edefterCtrl(isNesnesi({ tip: 'EDEFTER_FIS_LISTESI' }));
      await c.uploadFromRunner('tok', dosya, 'tp1', '2026-09', undefined, 'j1');
      ok(cagrilar.some((x) => x.ad === 'edefter.importFromExcel'), 'e-Defter: uyumlu job geçer');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5) LUCA KUYRUK SÖZLEŞMESİ — gerçek servis çağrıları
  //    (eski metin kontrolleri: 'activeDuplicate', "status: { in: ['pending','running'] }",
  //     'nextRetryAt: { lte: new Date() }', 'nextRetryCount', 'shouldFailTransient',
  //     'TRANSIENT_LUCA_FIRMA_OR_FRAME_STUCK_RESET', 'targetDeviceId: null', 'retryDelayMs',
  //     'stale: !fresh', 'ageSec <= 120', 'Luca klasik ekran 3 kez')
  // ════════════════════════════════════════════════════════════════════
  console.log('\n5) Luca iş kuyruğu — mükerrer koruma, cooldown, teknik retry');
  /** İçinde gerçek "where" eşleştirmesi yapan sahte iş tablosu. */
  function kuyruk(isler = []) {
    const kayit = { create: [], update: [], updateMany: [], log: [] };
    const tablo = {
      findFirst: async (a) => isler.filter((j) => eslesir(j, a && a.where))[0] || null,
      findUnique: async (a) => isler.find((j) => j.id === (a && a.where && a.where.id)) || null,
      findMany: async (a) => isler.filter((j) => eslesir(j, a && a.where)),
      create: async (a) => { kayit.create.push(a); const j = { id: `yeni${kayit.create.length}`, ...a.data }; isler.push(j); return j; },
      update: async (a) => { kayit.update.push(a); const j = isler.find((x) => x.id === a.where.id); Object.assign(j || {}, a.data); return j || a.data; },
      updateMany: async (a) => {
        kayit.updateMany.push(a);
        const hedef = isler.filter((j) => eslesir(j, a.where));
        hedef.forEach((j) => Object.assign(j, a.data));
        return { count: hedef.length };
      },
      count: async () => 0,
    };
    const prisma = makePrisma({ lucaFetchJob: tablo, taxpayer: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [] } });
    const svc = new LucaService(prisma, sessizServis(), undefined);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.appendJobLog = async (jobId, satir) => { kayit.log.push({ jobId, satir }); };
    return { svc, kayit, isler };
  }
  {
    // (a) Yeni iş üretimi: sözleşme alanları
    const { svc, kayit } = kuyruk([]);
    await svc.createFetchJob({ tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191', createdBy: 'u1' });
    const d = kayit.create[0] && kayit.create[0].data;
    ok(!!d, 'yeni iş gerçekten oluşturuldu');
    ok(d && d.status === 'pending', `iş "pending" olarak doğar (${d && d.status})`);
    ok(d && d.tip === 'KDV_191' && d.sessionId === 's1' && d.mukellefId === 'tp1' && d.donem === '2026-09',
      'iş nesnesi tip/oturum/mükellef/dönem alanlarını taşıyor');
    ok(d && d.preferredAgent === 'local-node', `veri çekme işi yerel ajana yönlendirilir (${d && d.preferredAgent})`);
    ok(d && d.createdBy === 'u1', 'işi kimin başlattığı kayda geçer (çoklu bilgisayar yönlendirmesi buna bakar)');
  }
  {
    // (b) MÜKERRER koruma: aynı oturum/mükellef/dönem/tip'te AKTİF iş varken kopya üretilmez
    for (const durum of ['pending', 'running']) {
      const mevcut = { id: 'j1', tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191', status: durum, createdAt: new Date() };
      const { svc, kayit } = kuyruk([mevcut]);
      const is = await svc.createFetchJob({ tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191' });
      ok(kayit.create.length === 0, `"${durum}" iş varken kopya OLUŞTURULMADI`);
      ok(is && is.id === 'j1', `mevcut iş geri döndü (${is && is.id})`);
      ok(is && is.donemTipi === 'AYLIK', `geri dönen işte dönem tipi türetilmiş (${is && is.donemTipi})`);
      ok(kayit.log.some((l) => /zaten kuyrukta/i.test(l.satir)), 'kullanıcıya iş logunda bildirildi');
    }
    // BİTMİŞ iş yeni çekimi ENGELLEMEZ
    for (const durum of ['done', 'failed', 'cancelled']) {
      const mevcut = { id: 'j1', tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191', status: durum, createdAt: new Date() };
      const { svc, kayit } = kuyruk([mevcut]);
      await svc.createFetchJob({ tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191' });
      ok(kayit.create.length === 1, `"${durum}" iş yeni çekimi engellemiyor`);
    }
    // BAŞKA dönem/tip mükerrer sayılmaz
    {
      const mevcut = { id: 'j1', tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-08', tip: 'KDV_191', status: 'pending', createdAt: new Date() };
      const { svc, kayit } = kuyruk([mevcut]);
      await svc.createFetchJob({ tenantId: 't1', sessionId: 's1', mukellefId: 'tp1', donem: '2026-09', tip: 'KDV_191' });
      ok(kayit.create.length === 1, 'farklı dönem mükerrer sayılmıyor');
    }
  }
  {
    // (c) COOLDOWN: nextRetryAt geleceği gösteren iş ajana VERİLMEZ
    const temel = { tenantId: 't1', status: 'pending', mukellefId: 'tp1', donem: '2026-09', tip: 'MIZAN', targetDeviceId: null, preferredAgent: null, createdBy: null, priority: 0, createdAt: new Date() };
    const isler = [
      { ...temel, id: 'hazir-null', nextRetryAt: null },
      { ...temel, id: 'hazir-gecmis', nextRetryAt: new Date(Date.now() - 60_000) },
      { ...temel, id: 'bekleyen', nextRetryAt: new Date(Date.now() + 5 * 60_000) },
    ];
    const { svc } = kuyruk(isler);
    const cikan = (await svc.pendingJobsForAgent('t1', 'moren-test-pc')).map((j) => j.id);
    ok(cikan.includes('hazir-null'), 'cooldown\'u olmayan iş ajana verilir');
    ok(cikan.includes('hazir-gecmis'), 'cooldown süresi geçmiş iş ajana verilir');
    ok(!cikan.includes('bekleyen'), `cooldown\'u dolmamış iş ajana VERİLMEZ (gelen: ${cikan.join(',')})`);
  }
  {
    // (d) Cihaz kilidi: başka bilgisayara atanmış iş bu ajana verilmez
    const temel = { tenantId: 't1', status: 'pending', mukellefId: 'tp1', donem: '2026-09', tip: 'MIZAN', preferredAgent: null, createdBy: null, priority: 0, nextRetryAt: null, createdAt: new Date() };
    const { svc } = kuyruk([
      { ...temel, id: 'serbest', targetDeviceId: null },
      { ...temel, id: 'baska-pc', targetDeviceId: 'moren-diger-pc', mukellefId: 'tp2' },
      { ...temel, id: 'bana', targetDeviceId: 'moren-test-pc', mukellefId: 'tp3' },
    ]);
    const cikan = (await svc.pendingJobsForAgent('t1', 'moren-test-pc')).map((j) => j.id);
    ok(cikan.includes('serbest') && cikan.includes('bana'), 'serbest ve bu cihaza atanmış işler verilir');
    ok(!cikan.includes('baska-pc'), 'başka bilgisayara kilitli iş verilmez');
  }
  {
    // (e) TEKNİK Luca kilidi → iş failed EDİLMEZ, cooldown ile yeniden sıraya girer ve cihaz kilidi çözülür
    const is = { id: 'j1', tenantId: 't1', status: 'running', tip: 'MIZAN', retryCount: 0, targetDeviceId: 'moren-test-pc', sessionId: null };
    const { svc, kayit } = kuyruk([is]);
    await svc.markJobFailed('j1', 'Firma DEGISMEDI: frm4/SirketCombo');
    const y = kayit.updateMany[0] && kayit.updateMany[0].data;
    ok(!!y && y.status === 'pending', `teknik kilitte iş yeniden sıraya alınır (${y && y.status})`);
    ok(!!y && y.retryCount === 1, `deneme sayacı artar (${y && y.retryCount})`);
    ok(!!y && y.nextRetryAt instanceof Date && y.nextRetryAt.getTime() > Date.now(), 'cooldown (bekleme) konur — sonsuz döngü yok');
    ok(!!y && y.targetDeviceId === null, 'cihaz kilidi temizlenir (başka bilgisayar devralabilir)');
    ok(kayit.log.some((l) => /TRANSIENT_LUCA_FIRMA_OR_FRAME_STUCK_RESET/.test(l.satir)), 'teknik retry sebebi loglanır');
  }
  {
    // 3 denemeden sonra teknik retry BİTER (iş failed olur, diğer işleri bloklamaz)
    const is = { id: 'j1', tenantId: 't1', status: 'running', tip: 'MIZAN', retryCount: 3, sessionId: null };
    const { svc, kayit } = kuyruk([is]);
    await svc.markJobFailed('j1', 'classic frame takildi');
    const y = kayit.updateMany[0] && kayit.updateMany[0].data;
    ok(!!y && y.status === 'failed', `3 denemeden sonra iş failed olur (${y && y.status})`);
  }
  {
    // Kalıcı (teknik olmayan) hata doğrudan failed
    const is = { id: 'j1', tenantId: 't1', status: 'running', tip: 'MIZAN', retryCount: 0, sessionId: null };
    const { svc, kayit } = kuyruk([is]);
    await svc.markJobFailed('j1', 'Excel indirilemedi: dosya bulunamadi');
    const y = kayit.updateMany[0] && kayit.updateMany[0].data;
    ok(!!y && y.status === 'failed', 'teknik olmayan hata doğrudan failed (gereksiz retry yok)');
  }
  {
    // (f) requeueJobForAgent: teknik sebeple 3. denemede failed, öncesinde cooldown'lu pending
    const { svc } = kuyruk([{ id: 'j1', tenantId: 't1', status: 'running', tip: 'MIZAN', retryCount: 0, errorMsg: null }]);
    const r1 = await svc.requeueJobForAgent('j1', 't1', 'TRANSIENT_LUCA classic frame');
    ok(r1.status === 'pending', `1. teknik toparlanmada iş sıraya alınır (${r1.status})`);
    ok(r1.retryCount === 1 && r1.nextRetryAt instanceof Date, 'sayaç + cooldown yazılır');
    const { svc: svc2 } = kuyruk([{ id: 'j1', tenantId: 't1', status: 'running', tip: 'MIZAN', retryCount: 2, errorMsg: null }]);
    const r2 = await svc2.requeueJobForAgent('j1', 't1', 'TRANSIENT_LUCA classic frame');
    ok(r2.status === 'failed', `3. denemede iş kapatılır (${r2.status})`);
    ok(/klasik ekran 3 kez/i.test(String(r2.errorMsg || '')), 'kullanıcıya sebep yazılır (klasik ekran 3 kez toparlanamadı)');
    ok(r2.nextRetryAt === null, 'kapatılan işte cooldown kalmaz');
    const { svc: svc3 } = kuyruk([{ id: 'j1', tenantId: 't1', status: 'done', tip: 'MIZAN', retryCount: 0 }]);
    const r3 = await svc3.requeueJobForAgent('j1', 't1', 'elle');
    ok(r3.status === 'done', 'bitmiş iş yeniden sıraya ALINMAZ (çift çekim olmaz)');
  }
  {
    // (g) Ajan canlılığı: 120 sn üstü ping BAYAT sayılır (ölü cihaz canlı görünmesin)
    const prismaDurum = (ping) => makePrisma({
      lucaSession: { findUnique: async () => null },
      lucaCredential: { findUnique: async () => null },
      agentStatus: { findMany: async () => [{ agent: 'luca', deviceId: 'moren-test-pc', running: true, lastPing: ping, meta: { deviceId: 'moren-test-pc', version: '1.1.8' } }] },
      lucaCaptchaChallenge: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
    });
    const durum = async (ping) => {
      const svc = new LucaService(prismaDurum(ping), sessizServis(), undefined);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      return (await svc.getSessionManagerStatus('t1')).devices[0];
    };
    const taze = await durum(new Date(Date.now() - 10_000));
    ok(taze.stale === false && taze.running === true, `10 sn önce ping atan cihaz CANLI (stale=${taze.stale})`);
    const bayat = await durum(new Date(Date.now() - 300_000));
    ok(bayat.stale === true, '5 dk sessiz cihaz BAYAT işaretlenir');
    ok(bayat.running === false, 'bayat cihaz "çalışıyor" gösterilmez');
    const sinir = await durum(new Date(Date.now() - 130_000));
    ok(sinir.stale === true, '120 sn eşiği aşan ping bayat sayılır');
  }

  // ════════════════════════════════════════════════════════════════════
  // 6) YEREL AJAN DESTEK LİSTESİ — agent.js'ten gerçek normalizeJobTypeConfig
  //    (eski metin kontrolleri: requireIn(localAgentSrc, "'MIZAN'") + 'SUPPORTED_JOB_TYPES')
  // ════════════════════════════════════════════════════════════════════
  console.log('\n6) Yerel ajan iş tipi süzgeci (agent.js gerçek kodu)');
  {
    const agentPath = path.join(ROOT, 'apps/luca-local-agent/src/agent.js');
    const agentAst = ts.createSourceFile(agentPath, fs.readFileSync(agentPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const parcalar = ['SUPPORTED_JOB_TYPES', 'OPERATOR_JOB_TYPES', 'LEGACY_DEFAULT_JOB_TYPES', 'normalizeJobTypeConfig']
      .map((ad) => [ad, bildirimMetni(agentAst, ad)]);
    const eksik = parcalar.filter(([, m]) => !m).map(([ad]) => ad);
    if (eksik.length) { failed++; console.error(`  ✗ agent.js içinde bulunamadı: ${eksik.join(', ')}`); }
    else {
      const ortam = calistir(
        parcalar.map(([, m]) => m).join('\n'),
        { cfg: { worker: {} } },
        ['SUPPORTED_JOB_TYPES', 'OPERATOR_JOB_TYPES', 'LEGACY_DEFAULT_JOB_TYPES', 'normalizeJobTypeConfig'],
      );
      const varsayilan = ortam.normalizeJobTypeConfig([]);
      const eksikTip = beklenenTipler.filter((t) => !varsayilan.jobTypes.includes(t));
      ok(eksikTip.length === 0, `ajan varsayılanı sözleşmedeki tüm tipleri kapsıyor${eksikTip.length ? ` — EKSİK: ${eksikTip.join(', ')}` : ''}`);
      ok(!varsayilan.jobTypes.some((t) => ortam.OPERATOR_JOB_TYPES.includes(t)), 'operatör işleri veri çekme ajanına verilmiyor');
      const eski = ortam.normalizeJobTypeConfig(['EARSIV_GELEN', 'HESAP_PLANI']);
      ok(eski.unknown.includes('EARSIV_GELEN') && eski.unknown.includes('HESAP_PLANI'), 'eski iş tipi adları "bilinmeyen" sayılır');
      ok(!eski.jobTypes.includes('EARSIV_GELEN'), 'eski ad kabul edilmiyor (varsayılana düşer)');
      const secili = ortam.normalizeJobTypeConfig(['MIZAN', 'UYDURMA_TIP']);
      ok(secili.jobTypes.length === 1 && secili.jobTypes[0] === 'MIZAN', 'yapılandırmada seçilen geçerli tip korunur, uydurma tip atılır');
      const eskiVarsayilan = ortam.normalizeJobTypeConfig(['ACCOUNT_PLAN', 'MIZAN', 'KDV_MIZAN', 'MUAVIN']);
      ok(eskiVarsayilan.upgradedFromLegacy === true && eskiVarsayilan.jobTypes.includes('EARSIV_SATIS'),
        'eski varsayılan yapılandırma tam listeye yükseltilir');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 7) KDV DEFTERİ KEBİR MENÜSÜ — agent-runtime.js gerçek kodu sahte DOM ipuçlarıyla
  //    (eski metin kontrolleri: requireIn(runtimeSrc, 'buildKdvLedgerMenuAttempts') /
  //     "collectLucaClickMap('Defteri Kebir')")
  // ════════════════════════════════════════════════════════════════════
  console.log('\n7) KDV Defteri Kebir menü denemeleri (agent-runtime.js gerçek kodu)');
  {
    const rtPath = path.join(ROOT, 'apps/api/public/agent-runtime.js');
    const rtAst = ts.createSourceFile(rtPath, fs.readFileSync(rtPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const parcalar = ['extractLucaMenuCode', 'buildKdvLedgerMenuAttempts'].map((ad) => [ad, bildirimMetni(rtAst, ad)]);
    const eksik = parcalar.filter(([, m]) => !m).map(([ad]) => ad);
    if (eksik.length) { failed++; console.error(`  ✗ agent-runtime.js içinde bulunamadı: ${eksik.join(', ')}`); }
    else {
      const kod = parcalar.map(([, m]) => m).join('\n');
      const satirlar = [
        { text: 'Defteri Kebir (Tüm Yazıcılar)', onclick: 'lI1lI(0,17,"79")', frame: 'frm5' },
        { text: 'Defteri Kebir Nokta Vuruşlu', onclick: 'lI1lI(0,17,"75")', frame: 'frm5' },
        { text: 'Mizan', onclick: 'lI1lI(0,1,"5")', frame: 'frm5' },
      ];
      let cagrildiMi = false;
      const ortam = calistir(kod, {
        collectLucaClickMap: (filtre) => { cagrildiMi = filtre === 'Defteri Kebir'; return satirlar; },
      });
      const denemeler = ortam.buildKdvLedgerMenuAttempts();
      ok(cagrildiMi, 'menü ipuçları ekrandan "Defteri Kebir" süzgeciyle toplanıyor');
      ok(denemeler.length >= 3, `deneme listesi üretildi (${denemeler.length} deneme)`);
      ok(denemeler[0] && denemeler[0].code === 'lI1lI(0,17,"79")', `"Tüm Yazıcılar" seçeneği ilk sırada (${denemeler[0] && denemeler[0].code})`);
      const nokta = denemeler.findIndex((a) => a.code === 'lI1lI(0,17,"75")');
      ok(nokta > 0, `nokta vuruşlu seçenek geride bırakıldı (sıra ${nokta})`);
      ok(!denemeler.some((a) => a.code === 'lI1lI(0,1,"5")'), 'ilgisiz menü satırı (Mizan) denemelere girmiyor');
      ok(denemeler.some((a) => !a.code && a.nth === 1) && denemeler.some((a) => !a.code && a.nth === 2),
        'metinle tıklama yedekleri her zaman listede (dinamik ipucu tutmazsa)');
      // Ekran okunamazsa yedekler yine çalışmalı (menü hiç açılamaz duruma düşmesin).
      const ortam2 = calistir(kod, { collectLucaClickMap: () => { throw new Error('frame yok'); } });
      const yedek = ortam2.buildKdvLedgerMenuAttempts();
      ok(yedek.length === 3 && yedek[0].code === 'lI1lI(0,17,"79")', `ekran okunamazsa statik yedekler dönüyor (${yedek.length} deneme)`);
    }
  }

  if (failed) { console.error(`\n[luca-upload-contract] ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\n[luca-upload-contract] OK: runner uploadlari ve Luca kuyrugu job/status/modul/session sozlesmesine kilitli');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
