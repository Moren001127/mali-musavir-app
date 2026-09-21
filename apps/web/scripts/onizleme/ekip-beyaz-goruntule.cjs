// Ekip — beyaz tema (D) görüntüleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/ekip-beyaz-goruntule.cjs [cikisKlasoru]
// Çekilenler: 01 genel bakış (tam sayfa) · 02 işler · 03 iş paneli · 04 dönem panosu · 05 kadro · 06 koşu sürüyor (+06b genel bakış) · 07 koşu bitti (+07b sonuç, 07c ayrıntılar) · 08 telefon
// KOSU=0 ile koşu adımı atlanır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'ekip');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
const KOSU = process.env.KOSU !== '0';
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.goto(`${KOK}/panel/ekip`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
  const cek = async (ad, tam = true) => {
    await pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: tam });
  };
  await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(600); await cek('01-genel-bakis');
  await pg.getByRole('tab', { name: /İşler/ }).click(); await pg.waitForTimeout(800); await cek('02-isler');
  const ilk = pg.locator('button[title="İşi aç"]').first();
  if (await ilk.count()) { await ilk.click(); await pg.waitForTimeout(1500); await cek('03-is-paneli'); await pg.getByRole('button', { name: /İş listesine dön/ }).click(); await pg.waitForTimeout(300); }
  await pg.getByRole('tab', { name: /Dönem panosu/ }).click(); await pg.waitForTimeout(800); await cek('04-donem-panosu');
  await pg.getByRole('tab', { name: /Kadro/ }).click(); await pg.waitForTimeout(600); await cek('05-kadro');
  if (KOSU) {
    await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(400);
    await pg.locator('textarea').first().fill('Ömer Özen’in Ağustos 2026 KDV kontrolünü yap');
    await pg.getByRole('button', { name: /^Başlat$/ }).click();
    await pg.waitForTimeout(3500); await cek('06-kosu-suruyor');
    await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(600); await cek('06b-genel-suruyor');
    await pg.getByRole('tab', { name: /İşler/ }).click(); await pg.waitForTimeout(400);
    await pg.getByRole('button', { name: /^Durdur$/ }).waitFor({ state: 'hidden', timeout: 60000 });
    await pg.waitForTimeout(800); await cek('07-kosu-bitti');
    const sonuc = pg.locator('section[aria-label="Sonuç ve özet"]').first();
    if (await sonuc.count()) { await sonuc.scrollIntoViewIfNeeded(); await pg.waitForTimeout(300); await sonuc.screenshot({ path: path.join(CIKIS, '07b-sonuc.png') }); }
    const ayrinti = pg.getByRole('button', { name: /Ayrıntılar/ }).first();
    if (await ayrinti.count()) { await ayrinti.click(); await pg.waitForTimeout(600); const g = pg.locator('.ekip-isler-gunluk').first(); await g.scrollIntoViewIfNeeded(); await g.screenshot({ path: path.join(CIKIS, '07c-ayrintilar.png') }); await ayrinti.click(); }
  }
  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const ctx = await b.newContext({ storageState: await pg.context().storageState(), viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  const m = await ctx.newPage();
  await m.goto(`${KOK}/panel/ekip`, { waitUntil: 'networkidle', timeout: 120000 }); await m.waitForTimeout(1500);
  await m.getByRole('tab', { name: /Genel bakış/ }).click(); await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(CIKIS, '08-telefon-genel.png'), fullPage: true });
  const mobilTasma = await m.evaluate(() => [...document.querySelectorAll('main')].some((e) => e.scrollWidth > e.clientWidth + 2));
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, mobilTasma, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
