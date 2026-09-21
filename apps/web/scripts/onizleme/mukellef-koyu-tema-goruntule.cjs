// A (koyu) teması regresyon görüntüsü: Mükellef Listesi + Aylık Takip — tarayıcıda data-theme=A anahtarlanır.
//   node apps/web/scripts/onizleme/mukellef-koyu-tema-goruntule.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const KOKDIZIN = path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul');
const KOK = `http://localhost:${process.env.SAHTE_WEB_PORT || '3007'}`;
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
  await pg.route(/\/api\/v1\/taxpayers(\?.*)?$/, async (route) => {
    const u = new URL(route.request().url());
    const aylik = u.searchParams.has('year');
    u.pathname = u.pathname.replace('/api/v1/taxpayers', aylik ? '/api/v1/sahte/aylik-takip/taxpayers' : '/api/v1/sahte/mukellef-listesi/taxpayers');
    const yanit = await route.fetch({ url: u.toString() });
    await route.fulfill({ response: yanit });
  });
  await pg.route(/\/api\/v1\/auth\/me$/, async (route) => {
    const yanit = await route.fetch();
    const govde = await yanit.json();
    await route.fulfill({ response: yanit, json: { ...govde, roles: govde.roles || [govde.role || 'ADMIN'] } });
  });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
  await pg.waitForTimeout(1500);
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });
  for (const [yol, modul, kok] of [['/panel/mukellef-listesi', 'mukellef-listesi', '.ml-root'], ['/panel/mukellefler', 'aylik-takip', '.at-root']]) {
    await pg.goto(`${KOK}${yol}`, { waitUntil: 'networkidle', timeout: 120000 });
    await pg.locator(kok).first().waitFor({ timeout: 30000 });
    await pg.waitForTimeout(1500);
    await pg.evaluate(() => { document.documentElement.setAttribute('data-theme', 'A'); });
    await pg.waitForTimeout(600);
    await pg.mouse.move(2, 2);
    fs.mkdirSync(path.join(KOKDIZIN, modul), { recursive: true });
    await pg.screenshot({ path: path.join(KOKDIZIN, modul, '09-koyu-tema-A.png') });
  }
  console.log('ok');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
