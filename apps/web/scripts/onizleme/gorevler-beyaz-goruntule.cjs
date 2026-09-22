// Görevler & Notlar — beyaz tema (D) ekran görüntüleri (sahte çift: web 3007 + API 3006 açık olmalı)
//   node apps/web/scripts/onizleme/gorevler-beyaz-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/beyaz-modul/gorevler)
// Giriş: /giris/musavir → muzaffer@morenmusavirlik.com / sahte-deneme-1; sayfa: /panel/gorevler
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'gorevler');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hatalar = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) hatalar.push(m.text());
  });
  page.on('pageerror', (e) => hatalar.push(`pageerror: ${e.message}`));

  const yatay = async (ad) => {
    const r = await page.evaluate(() => {
      const m = document.querySelector('[data-panel-main]');
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: m ? m.scrollWidth - m.clientWidth : 0 };
    });
    if (r.doc > 0 || r.main > 0) hatalar.push(`YATAY TAŞMA (${ad}): belge ${r.doc}px, ana alan ${r.main}px`);
  };
  const cek = async (ad, tam = true) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: tam });
    await yatay(ad);
    console.log('  ✓', ad);
  };

  // Giriş
  await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await page.locator('input[type=password]').fill('sahte-deneme-1');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/panel/, { timeout: 60000 });
  await page.goto(`${KOK}/panel/gorevler`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  await cek('01-ajanda-tam');
  await cek('01b-ajanda-ust', false);
  // Ana alan kendi içinde kayar (fullPage iç kaydırmayı yakalamaz) → alt bölüm (Sonra / Tarihsiz / Notlar)
  const anaAlan = page.locator('[data-panel-main]');
  await anaAlan.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(400);
  await cek('01c-ajanda-alt', false);
  await anaAlan.evaluate((el) => el.scrollTo(0, 0));

  // Akıllı giriş: yazınca çipler
  const giris = page.getByLabel('Akıllı görev girişi');
  await giris.fill('Öz Ela KDV kontrolü yarın 10:00 acil');
  await page.waitForTimeout(400);
  await cek('02-akilli-giris-cipler', false);
  await giris.fill('');

  // Sayaç çipi: Gecikmiş
  await page.locator('[data-gorev-sayac="gecikmis"]').click();
  await page.waitForTimeout(400);
  await cek('03-cip-gecikmis', false);
  await page.locator('[data-gorev-sayac="acik"]').click();

  // Toplu seçim şeridi
  const kutular = page.locator('table tbody input[type=checkbox][title="Seç"]');
  await kutular.nth(0).check();
  await kutular.nth(1).check();
  await kutular.nth(2).check();
  await page.waitForTimeout(300);
  await cek('04-toplu-serit', false);
  await page.getByTitle('Seçimi bırak').click();

  // Detay paneli
  await page.locator('table tbody button[title="Detayı aç"]').first().click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(900);
  await cek('05-detay-paneli', false);
  await page.locator('aside[role=dialog] .overflow-y-auto').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
  await cek('05b-detay-paneli-alt', false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Ertele menüsü + satır menüsü
  await page.locator('table tbody button[title="Ertele"]').first().click();
  await page.waitForTimeout(300);
  await cek('06-ertele-menusu', false);
  await page.keyboard.press('Escape');
  await page.locator('table tbody button[title="Diğer eylemler"]').first().click();
  await page.waitForTimeout(300);
  await cek('07-satir-menusu', false);
  await page.keyboard.press('Escape');

  // Kanban
  await page.getByRole('tab', { name: /Kanban/ }).click();
  await page.waitForTimeout(1500);
  await cek('08-kanban');

  // Takvim
  await page.getByRole('tab', { name: /Takvim/ }).click();
  await page.waitForTimeout(900);
  await cek('09-takvim-ay');
  await page.getByRole('button', { name: 'Hafta', exact: true }).click();
  await page.waitForTimeout(500);
  await cek('10-takvim-hafta', false);
  await page.getByRole('button', { name: 'Ay', exact: true }).click();

  // Mükellefe göre
  await page.getByRole('tab', { name: /Mükellefe göre/ }).click();
  await page.waitForTimeout(900);
  await cek('11-mukellefe-gore');

  // Notlar çipi
  await page.getByRole('tab', { name: /Ajanda/ }).click();
  await page.locator('[data-gorev-sayac="not"]').click();
  await page.waitForTimeout(500);
  await cek('12-notlar', false);
  await page.locator('[data-gorev-sayac="acik"]').click();

  // Süzgeç menüsü
  await page.getByTitle('Kategoriye göre süz').click();
  await page.waitForTimeout(300);
  await cek('13-kategori-suzgec', false);
  await page.keyboard.press('Escape');

  // Yeni görev paneli
  await page.getByRole('button', { name: /Yeni Görev/ }).click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(600);
  await cek('14-yeni-gorev-paneli', false);
  await page.keyboard.press('Escape');

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('15-ajanda-1000', false);

  await browser.close();
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
