// Sol menü görüntüsü (tema D) — sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (3006/3007)
//   node apps/web/scripts/menu-onizleme-goruntule.cjs [cikisKlasoru]   (SAHTE_WEB_PORT ile port değişir)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'menu');
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
  await pg.waitForTimeout(3000);
  const menu = pg.locator('[data-moren-sidebar]').first();
  await menu.screenshot({ path: path.join(CIKIS, 'menu.png') });
  await pg.screenshot({ path: path.join(CIKIS, 'panel-tam.png') });
  const genislik = await menu.evaluate((e) => e.getBoundingClientRect().width);
  console.log(JSON.stringify({ genislik, cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
