// İş Akışı — beyaz tema (D) görüntüleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/is-yuku-beyaz-goruntule.cjs [cikisKlasoru]
// Yerleşik sahte uç (/taxpayers/workflow/queue) yalnız sayaç döndürür; tam kuyruk (10 sıradaki + gruplar) için
// scripts/mock/is-yuku.cjs → kuyruk() çıktısı tarayıcıda o uca yerleştirilir (mock-api.cjs'e dokunulmaz).
// Çekilenler: 01 tam sayfa · 02 özet + şimdi yapılacak (ilk ekran) · 03 sıradakiler + aşamalar · 04 "Sonraki" sonrası ·
//             05 geç kalan süzgeci (?late=1) · 06 sıra boş durumu · 07 koyu tema (A) denetimi
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { kuyruk } = require(path.join(__dirname, '..', 'mock', 'is-yuku.cjs'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'is-yuku');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  let bos = false;
  const CORS = { 'access-control-allow-origin': KOK, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Authorization, Content-Type, X-Agent-Token', 'access-control-allow-methods': 'GET, OPTIONS' };
  await pg.route('**/taxpayers/workflow/queue*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = new URL(route.request().url());
    const veri = kuyruk(u.searchParams.get('year'), u.searchParams.get('month'));
    if (bos) { veri.siradaki = []; }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(veri) });
  });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.goto(`${KOK}/panel/is-yuku`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
  // İçerik `main` içinde kayar; tam sayfa için kabuğu geçici olarak açıp belge akışına bırakırız.
  const cek = async (ad, opts = {}) => {
    if (opts.fullPage) {
      await pg.evaluate(() => { document.documentElement.setAttribute('data-tam-sayfa', '1'); const s = document.createElement('style'); s.id = 'tam-sayfa'; s.textContent = '[data-panel-shell]{height:auto!important;overflow:visible!important}[data-panel-main]{overflow:visible!important;height:auto!important}'; document.head.appendChild(s); });
      await pg.waitForTimeout(300);
    }
    await pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), ...opts });
    if (opts.fullPage) await pg.evaluate(() => { document.getElementById('tam-sayfa')?.remove(); document.documentElement.removeAttribute('data-tam-sayfa'); });
  };
  await cek('01-tam-sayfa', { fullPage: true });
  await cek('02-ilk-ekran');
  const sira = pg.locator('[data-ay-siradakiler]').first();
  if (await sira.count()) { await sira.evaluate((e) => e.scrollIntoView({ block: 'start' })); await pg.waitForTimeout(400); await cek('03-siradakiler-asamalar'); }
  await pg.evaluate(() => window.scrollTo(0, 0));
  const sonraki = pg.getByRole('button', { name: /Sonraki/ }).first();
  if (await sonraki.count()) { await sonraki.click(); await pg.waitForTimeout(500); await cek('04-sonraki'); }
  await pg.goto(`${KOK}/panel/is-yuku?late=1`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.waitForTimeout(1500);
  await cek('05-gec-kalan-suzgeci', { fullPage: true });
  bos = true;
  await pg.goto(`${KOK}/panel/is-yuku`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.waitForTimeout(1500);
  await cek('06-sira-bos');
  bos = false;
  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  await pg.goto(`${KOK}/panel/is-yuku`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => { document.documentElement.setAttribute('data-theme', 'A'); });
  await pg.waitForTimeout(1500);
  await cek('07-koyu-tema-a', { fullPage: true });
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
