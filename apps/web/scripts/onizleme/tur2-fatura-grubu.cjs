// İkinci tur beyaz tema (D) — fatura grubu görüntüleri: e-Arşiv, Genel Sorgulamalar, İşlenen Faturalar,
// Fiş Yazdırma, Banka Takip, Mükellef Profilleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007);
// eksik uçlar scripts/mock/fatura-grubu.cjs eklentisinden gelir.
//   node apps/web/scripts/onizleme/tur2-fatura-grubu.cjs [modul,modul…] [--cikis=klasor] [--tema=A]
// Her modül: 01 tam sayfa · 02 ilk ekran · 03+ ayrıntılar (tablo, seçici, açık satır…). Çıktı: _previews/beyaz-modul2/<modul>/.
// Ayrıca sahte API'de 404 dönen uçlar, tarayıcı hataları ve yatay taşma yazdırılır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const secenek = (ad) => { const a = argv.find((x) => x.startsWith(`--${ad}=`)); return a ? a.slice(ad.length + 3) : ''; };
const KOK_CIKIS = secenek('cikis') || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2');
const TEMA = secenek('tema') || '';
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;

const bekle = (pg, ms) => pg.waitForTimeout(ms);
const kes = async (pg, klasor, ad, secici) => {
  const dosya = path.join(klasor, `${ad}.png`);
  if (!secici) return pg.screenshot({ path: dosya });
  const loc = pg.locator(secici).first();
  if (!(await loc.count())) return null;
  await loc.scrollIntoViewIfNeeded(); await bekle(pg, 250);
  return loc.screenshot({ path: dosya });
};

const MODULLER = {
  'e-arsiv': {
    yol: '/panel/e-arsiv',
    async ek(pg, klasor) {
      const kok = '[data-module-review="earsiv"]';
      // İkinci tipi de aç (Gelen E-Fatura) → iki mod birden
      await pg.locator(`${kok} > .grid.grid-cols-2 > button`).nth(2).click(); await bekle(pg, 400);
      // Mükellef seçici: aç, görüntüle, iki mükellef seç, kapat
      await pg.locator(`${kok} > .rounded-lg.p-4.grid button`).first().click(); await bekle(pg, 500);
      await kes(pg, klasor, '04-mukellef-secici');
      const liste = pg.locator(`${kok} > .fixed.inset-0 > div > .flex-1.overflow-y-auto > button`);
      await liste.nth(1).click(); await liste.nth(4).click(); await bekle(pg, 200);
      await pg.locator(`${kok} > .fixed.inset-0 > div > div:nth-child(2) > button`).last().click();
      await pg.waitForLoadState('networkidle'); await bekle(pg, 1500);
      await kes(pg, klasor, '02-ilk-ekran');
      await tamSayfa(pg, path.join(klasor, '01-tam-sayfa.png'));
      await kes(pg, klasor, '03-tablo', `${kok} [data-review-table]`);
      // Satır seç → toplu düğmeler etkin
      await pg.locator(`${kok} [data-review-table] tbody tr td:first-child button`).nth(0).click();
      await pg.locator(`${kok} [data-review-table] tbody tr td:first-child button`).nth(2).click(); await bekle(pg, 300);
      await kes(pg, klasor, '05-eylemler-secili', `${kok} > .flex.gap-3.flex-wrap.items-center`);
      return true; // tam sayfa/ilk ekran burada çekildi
    },
  },
  'genel-sorgular': {
    yol: '/panel/genel-sorgular',
    async ek(pg, klasor) {
      const kok = '[data-module-review="sorgu"]';
      await kes(pg, klasor, '03-ozet-ve-suzgec', `${kok} [data-review-band]`);
      // İlk satırı aç → detay
      const satir = pg.locator(`${kok} [data-review-table] tbody tr`).first();
      if (await satir.count()) { await satir.click(); await bekle(pg, 400); await kes(pg, klasor, '04-acik-satir', `${kok} [data-review-table]`); }
      return false;
    },
  },
  'faturalar': {
    yol: '/panel/faturalar',
    async ek(pg, klasor) {
      const kok = '[data-module-review="faturalar"]';
      await kes(pg, klasor, '03-tablo', `${kok} [data-fx-liste]`);
      // Mükellef seçici penceresi
      await pg.locator(`${kok} [data-fx-mukellef-sec]`).first().click(); await bekle(pg, 500);
      await kes(pg, klasor, '04-mukellef-secici');
      await pg.keyboard.press('Escape'); await bekle(pg, 200);
      const kapat = pg.locator('div.fixed.inset-0.z-\\[60\\]');
      if (await kapat.count()) { await pg.mouse.click(20, 500); await bekle(pg, 300); }
      return false;
    },
  },
  'fis-yazdirma': {
    yol: '/panel/fis-yazdirma',
    async ek(pg, klasor) {
      const kok = '[data-module-review="fis"]';
      // Geçmiş çıktıları aç
      const gecmis = pg.locator(`${kok} [data-fis-gecmis] > button`).first();
      if (await gecmis.count()) { await gecmis.click(); await bekle(pg, 600); }
      await tamSayfa(pg, path.join(klasor, '01-tam-sayfa.png'));
      await kes(pg, klasor, '03-gecmis-ciktilar', `${kok} [data-fis-gecmis]`);
      await kes(pg, klasor, '04-kapak-ve-yukleme', `${kok} [data-fis-kapak]`);
      // 8 sahte görsel yükle → OCR ile Tara (sahte uç) → teyit aşaması
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      await pg.locator(`${kok} input[type=file]`).setInputFiles(Array.from({ length: 8 }, (_, i) => ({ name: `fis-00${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: png })));
      await bekle(pg, 400);
      await kes(pg, klasor, '05-gorseller-secildi', `${kok} [data-fis-dosyalar]`);
      await pg.locator(`${kok} [data-fis-ocr]`).click();
      await pg.locator(`${kok} [data-review-counter]`).first().waitFor({ timeout: 30000 });
      await bekle(pg, 600);
      await kes(pg, klasor, '06-teyit-asamasi');
      await tamSayfa(pg, path.join(klasor, '07-teyit-tam-sayfa.png'));
      return 'tamSayfaHazir';
    },
  },
  'banka-takip': {
    yol: '/panel/banka-takip',
    async ek(pg, klasor) {
      const kok = '[data-banka-takip]';
      // İlk iki mükellefi aç (satır ayrıntısı)
      const satirlar = pg.locator(`${kok} [data-banka-satir] > button`);
      const n = await satirlar.count();
      if (n) { await satirlar.nth(0).click(); if (n > 2) await satirlar.nth(2).click(); await bekle(pg, 500); }
      await tamSayfa(pg, path.join(klasor, '01-tam-sayfa.png'));
      await kes(pg, klasor, '03-acik-satirlar', `${kok} [data-banka-liste]`);
      await kes(pg, klasor, '04-sayaclar', `${kok} [data-banka-sayaclar]`);
      // Hesaplar penceresi
      const hesaplar = pg.locator(`${kok} [data-banka-hesaplar-ac]`).first();
      if (await hesaplar.count()) { await hesaplar.click(); await bekle(pg, 700); await kes(pg, klasor, '05-hesap-penceresi'); await pg.keyboard.press('Escape'); await pg.mouse.click(20, 500); await bekle(pg, 300); }
      return 'tamSayfaHazir';
    },
  },
  'profiller': {
    yol: '/panel/ajanlar/profiller',
    async ek(pg, klasor) {
      const kok = '[data-ops-page="profiller"]';
      await kes(pg, klasor, '03-bos-durum', `${kok} main`);
      // Tanımlı bir mükellefi seç → form
      await pg.locator(`${kok} aside button`).filter({ hasText: 'Famcoffee' }).first().click(); await bekle(pg, 600);
      await kes(pg, klasor, '04-profil-genel');
      await tamSayfa(pg, path.join(klasor, '01-tam-sayfa.png'));
      const sekmeler = pg.locator(`${kok} main [data-pf-sekmeler] > button`);
      if (await sekmeler.count() >= 3) {
        await sekmeler.nth(1).click(); await bekle(pg, 400); await kes(pg, klasor, '05-hesap-kodlari');
        await sekmeler.nth(2).click(); await bekle(pg, 400); await kes(pg, klasor, '06-karar-kurallari');
      }
      return 'tamSayfaHazir';
    },
  },
};
const hedefler = secilen.length ? secilen : Object.keys(MODULLER);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  const eksikUclar = new Set();
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 200)));
  pg.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/v1/')) eksikUclar.add(r.request().method() + ' ' + r.url().replace(/^.*\/api\/v1/, '')); });
  // Giriş: geliştirme sunucusu meşgulken sayfa sulanmadan (hydration) form ham GET olarak gidebiliyor → 3 deneme
  for (let deneme = 1; deneme <= 3; deneme++) {
    await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
    await bekle(pg, 1500);
    await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
    await pg.locator('input[type=password]').fill('sahte-deneme-1');
    await pg.locator('button[type=submit]').click();
    try { await pg.waitForURL((u) => /\/panel/.test(u.pathname), { timeout: 60000 }); break; }
    catch (e) { if (deneme === 3) throw e; console.warn(`giriş ${deneme}. denemede olmadı, yineleniyor`); }
  }
  const rapor = {};
  for (const ad of hedefler) {
    const m = MODULLER[ad];
    if (!m) { console.warn('bilinmeyen modül', ad); continue; }
    const klasor = path.join(KOK_CIKIS, TEMA ? `${ad}-tema-${TEMA}` : ad);
    fs.mkdirSync(klasor, { recursive: true });
    hatalar.length = 0; eksikUclar.clear();
    await pg.goto(`${KOK}${m.yol}`, { waitUntil: 'networkidle', timeout: 120000 });
    if (TEMA) { await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), TEMA); }
    await pg.evaluate(() => document.fonts.ready);
    await bekle(pg, 2500);
    // Başka bir oturumun yarım kalmış düzenlemesi geliştirme katmanında "Build Error" perdesi açabiliyor;
    // bu sayfayla ilgisi yoksa perdeyi kaldır (yeniden belirirse gözlemci yine kaldırır).
    await pg.evaluate(() => {
      const kaldir = () => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove());
      kaldir();
      if (!window.__perdeGozlemci) { window.__perdeGozlemci = new MutationObserver(kaldir); window.__perdeGozlemci.observe(document.body, { childList: true }); }
    });
    let sonuc = false;
    try { sonuc = await m.ek(pg, klasor); } catch (e) { hatalar.push('ek adım: ' + String(e).slice(0, 200)); }
    if (sonuc !== true) {
      if (sonuc !== 'tamSayfaHazir') await tamSayfa(pg, path.join(klasor, '01-tam-sayfa.png'));
      await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]'); if (el) el.scrollTop = 0; window.scrollTo(0, 0); });
      await bekle(pg, 200);
      await kes(pg, klasor, '02-ilk-ekran');
    }
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[ad] = { hatalar: [...new Set(hatalar)], eksikUclar: [...eksikUclar], yatayTasma: tasma, cikis: klasor };
  }
  console.log(JSON.stringify(rapor, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
