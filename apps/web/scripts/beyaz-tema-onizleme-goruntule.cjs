// Gösterge paneli beyaz tema: Beyanname Durum Takibi + Bu Ay İş Akışı + Bu Ay Mali Takvim görüntüleri
//   sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (3006/3007)
//   node apps/web/scripts/beyaz-tema-onizleme-goruntule.cjs [cikisKlasoru]   (SAHTE_WEB_PORT ile port değişir)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'beyaz-tema');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(3500);
  const hedefler = [
    ['sayaclar', '[data-dashboard-counters]'],
    ['panorama', '.ofis-panorama'],
    ['beyan-tablo', '[data-beyan-panel]'],
    ['is-akisi', '[data-workflow-counter]'],
    ['takvim', '[data-calendar]'],
  ];
  for (const [ad, sec] of hedefler) {
    let el = pg.locator(sec).first();
    if (!(await el.count())) { console.log('yok:', ad); continue; }
    // iş akışı için kutucuğun kart sarmalayıcısı (data-dashboard-surface) alınır
    if (ad === 'is-akisi') el = pg.locator('[data-workflow-counter]').first().locator('xpath=ancestor::*[@data-dashboard-surface][1]');
    await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await pg.waitForTimeout(600);
    await el.screenshot({ path: path.join(CIKIS, `${ad}.png`) });
  }
  // Panorama yan kartları: hafif renk seçeneği (--panorama-tint 1; canlı 1.8) ayrı dosyaya
  const pan = pg.locator('.ofis-panorama').first();
  if (await pan.count()) {
    await pg.addStyleTag({ content: "html[data-theme='D'] .yukumluluk-karti, html[data-theme='D'] .fatura-grafik-karti { --panorama-tint: 1 !important; }" });
    await pg.waitForTimeout(300);
    await pan.screenshot({ path: path.join(CIKIS, 'panorama-hafif.png') });
    await pg.addStyleTag({ content: "html[data-theme='D'] .yukumluluk-karti, html[data-theme='D'] .fatura-grafik-karti { --panorama-tint: 1.8 !important; }" });
  }
  // Üçü birlikte (beyan başlığından takvim sonuna) tam sayfa dilimi
  const bas = pg.locator('[data-dashboard-section-title]').first();
  const tak = pg.locator('[data-calendar]').first();
  if (await bas.count() && await tak.count()) {
    const y1 = await bas.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    const y2 = await tak.evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);
    await pg.screenshot({ path: path.join(CIKIS, 'ucu-birlikte.png'), fullPage: true, clip: { x: 224, y: y1 - 12, width: 1276, height: Math.min(y2 - y1 + 24, 4000) } });
  }
  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
