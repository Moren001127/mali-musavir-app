// Ekip ekranı (Bütçe dili, 2026-09-15) — Playwright görüntüleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/ekip-onizleme-goruntule.cjs [cikisKlasoru]   (SAHTE_WEB_PORT ile port değişir)
// Akış: Genel bakış → İşler (boş panel) → ilk iş seçili → Dönem panosu → Kadro → görev çalıştır (SSE ~14 sn) → sürüyor → bitti → telefon.
// Sonunda konsol hataları ve yatay taşma yazdırılır (ikisi de boş/false olmalı).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'ekip');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const URL = `http://localhost:${PORT}/panel/ekip`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await pg.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
  const daralt = pg.getByRole('button', { name: 'Sol menuyu daralt' });
  if (await daralt.count()) await daralt.first().click();
  await pg.waitForTimeout(1500);
  const cek = async (ad) => pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: true });
  await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(500); await cek('01-genel-bakis');
  await pg.getByRole('tab', { name: /İşler/ }).click(); await pg.waitForTimeout(600); await cek('02-isler-bos');
  const ilk = pg.locator('button[title="İşi sağdaki panelde aç"]').first();
  if (await ilk.count()) { await ilk.click(); await pg.waitForTimeout(1200); }
  await cek('03-isler-panel');
  await pg.getByRole('tab', { name: /Dönem panosu/ }).click(); await pg.waitForTimeout(600); await cek('04-donem-panosu');
  await pg.getByRole('tab', { name: /Kadro/ }).click(); await pg.waitForTimeout(500); await cek('05-kadro');
  await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(400);
  await pg.locator('textarea').first().fill('Ömer Özen’in Ağustos 2026 KDV kontrolünü yap');
  await pg.getByRole('button', { name: /^Çalıştır$/ }).click();
  await pg.waitForTimeout(3500); await cek('06-kosu-suruyor');
  await pg.waitForTimeout(13000); await cek('07-kosu-bitti');
  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const m = await b.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 });
  await m.goto(URL, { waitUntil: 'networkidle', timeout: 120000 }); await m.waitForTimeout(1500);
  await m.screenshot({ path: path.join(CIKIS, '08-telefon.png'), fullPage: true });
  const mobilTasma = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, mobilTasma, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
