// Bildirge "çalışan var / yok" penceresi görüntüleri — sahte çift 3022/3023 (dev-sahte-kart.cjs).
//   node apps/web/scripts/onizleme/bildirge-calisan-goruntule.cjs
// Çıktı _previews/bildirge-calisan/: 01-verilmemis (Yok/Var sütunu) · 02-yok-isaretlendi · 03-verilmis (çalışan yok etiketi)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));

const CIKIS = path.join(__dirname, '..', '..', '..', '..', '_previews', 'bildirge-calisan');
const KOK = `http://localhost:${process.env.SAHTE_WEB_PORT || '3023'}`;
fs.mkdirSync(CIKIS, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
  await pg.waitForTimeout(1200);
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(3000);

  // Bildirge satırı → "kalan" sayısı (son sütun)
  const satir = pg.locator('[data-beyan-panel] tbody tr.bd-row', { hasText: 'Bildirge' }).first();
  await satir.waitFor({ state: 'visible', timeout: 60000 });
  await satir.locator('button.bd-num').last().click();
  const pencere = pg.locator('[data-dashboard-surface]', { hasText: 'Beyannamesi Verilmemiş Mükellefler' });
  await pencere.waitFor({ state: 'visible', timeout: 30000 });
  await pg.waitForTimeout(1500);
  await pencere.screenshot({ path: path.join(CIKIS, '01-verilmemis.png') });

  // İlk satırda "Yok" → satır verildi listesine geçer
  await pencere.locator('button', { hasText: /^Yok$/ }).first().click();
  await pg.waitForTimeout(2000);
  await pencere.screenshot({ path: path.join(CIKIS, '02-yok-isaretlendi.png') });

  // Kapat → verilmiş listesi
  await pencere.locator('button', { hasText: /^Kapat$/ }).click();
  await pg.waitForTimeout(500);
  await satir.locator('button.bd-num').nth(1).click();
  const pencere2 = pg.locator('[data-dashboard-surface]', { hasText: 'Beyannamesi Verilmiş Mükellefler' });
  await pencere2.waitFor({ state: 'visible', timeout: 30000 });
  await pg.waitForTimeout(1500);
  await pencere2.screenshot({ path: path.join(CIKIS, '03-verilmis.png') });
  await b.close();
  console.log('bitti →', CIKIS);
})().catch((e) => { console.error(e); process.exit(1); });
