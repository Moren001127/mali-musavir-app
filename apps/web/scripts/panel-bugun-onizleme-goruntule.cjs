// Gösterge paneli üst alanı ("Bugünün İş Listesi" + "Başvuru Sayıları") — Playwright görüntüleri.
// Sahte çift: node apps/web/scripts/dev-sahte-kart.cjs (API 3002 + web 3005)
//   node apps/web/scripts/panel-bugun-onizleme-goruntule.cjs [cikisKlasoru]   (SAHTE_WEB_PORT ile port değişir)
// Akış: giriş → /panel → sol menü daralt → üst alan kapalı → tahsilat + fatura yığını açık → telefon.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'panel-bugun');
const TASARIM = 'b'; // Karar 2026-09-18: B (Mükellef Masası) + nane; A liste yedek bileşen olarak duruyor
const TEMA = process.env.TEMA || 'nane';      // nane | gece | bakir
const ON_EK = (TEMA === 'nane' ? TASARIM : `${TASARIM}-${TEMA}`) + (process.env.MENU_ACIK ? '-menu' : '');
const PORT = process.env.SAHTE_WEB_PORT || '3005';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

async function giris(pg) {
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000, waitUntil: 'commit' });
  if (TASARIM !== 'a' || TEMA !== 'nane') { await pg.goto(`${KOK}/panel?tasarim=${TASARIM}&tema=${TEMA}`, { waitUntil: 'networkidle', timeout: 120000 }); }
  await pg.waitForTimeout(2500);
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1920, height: 1750 }, deviceScaleFactor: 1 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error' && !/404|ERR_CONNECTION/.test(m.text())) hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await giris(pg);
  if (!process.env.MENU_ACIK) {
    const daralt = pg.getByRole('button', { name: 'Sol menuyu daralt' });
    if (await daralt.count()) { await daralt.first().click(); await pg.waitForTimeout(600); }
  }

  // Üst alan: iki kartı kapsayan ızgara
  const alan = pg.locator('main .grid.xl\\:grid-cols-3').first();
  await alan.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(800);
  await alan.screenshot({ path: path.join(CIKIS, `${ON_EK}-01-kapali.png`) });

  // Tahsilat ve fatura yığını satırlarını aç
  const daha = pg.getByRole('button', { name: /mükellef daha/ });
  if (await daha.count()) await daha.click();
  await pg.waitForTimeout(500);
  await alan.screenshot({ path: path.join(CIKIS, `${ON_EK}-02-acik.png`) });

  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const m = await b.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 });
  await giris(m);
  await m.locator('main .grid.xl\\:grid-cols-3').first().screenshot({ path: path.join(CIKIS, `${ON_EK}-03-telefon.png`) });
  const mobilTasma = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, mobilTasma, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
