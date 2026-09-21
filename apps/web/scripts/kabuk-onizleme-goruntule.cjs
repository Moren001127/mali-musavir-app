// Portal kabuğu (tema D): sol menü + üst çubuk sağ simgeler + mükellef açılır listesi + beyan tablosu görüntüleri
//   sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (3006/3007)
//   node apps/web/scripts/kabuk-onizleme-goruntule.cjs [cikisKlasoru]
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'kabuk');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(3500);
  const menu = pg.locator('[data-moren-sidebar]').first();
  await menu.screenshot({ path: path.join(CIKIS, 'menu.png') });
  // Üst çubuk (tam) + sağ simge grubu
  const ust = pg.locator("header[data-moren-owned='surface']").first();
  if (await ust.count()) await ust.screenshot({ path: path.join(CIKIS, 'ust-cubuk.png') });
  // Mükellef açılır listesi
  const secici = pg.getByRole('button', { name: /Mükellef Listesi/ }).first();
  if (await secici.count()) {
    await secici.click();
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: path.join(CIKIS, 'mukellef-listesi-acik.png'), clip: { x: 224, y: 0, width: 1276, height: 560 } });
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
  }
  const beyan = pg.locator('[data-beyan-panel]').first();
  if (await beyan.count()) {
    await beyan.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await pg.waitForTimeout(500);
    await beyan.screenshot({ path: path.join(CIKIS, 'beyan-tablo.png') });
  }
  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
