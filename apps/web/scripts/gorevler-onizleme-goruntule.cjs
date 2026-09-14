// Görevler & Notlar — Playwright ile ekran görüntüleri (sahte API 3001 + web 3000 açık olmalı)
// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan) + pnpm --filter @mali-musavir/web dev, sonra
//          node apps/web/scripts/gorevler-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/gorevler)
// Tarayıcı: apps/luca-local-agent/node_modules/playwright (Chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/gorevler');
fs.mkdirSync(CIKIS, { recursive: true });
const URL = 'http://localhost:3000/panel/gorevler';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hatalar = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR' });
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

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('table', { timeout: 30000 });
  await cek('01-ajanda-1400');

  // Akıllı giriş: yazınca çipler
  const giris = page.getByLabel('Akıllı görev girişi');
  await giris.fill('Öz Ela KDV kontrolü yarın 10:00 acil');
  await page.waitForTimeout(300);
  await cek('02-akilli-giris-cipler', false);
  await giris.press('Enter');
  await page.waitForTimeout(1200);
  await cek('03-akilli-giris-sonrasi', false);

  // Şüpheli mükellef adayı
  await giris.fill('Ela ekstre iste cuma');
  await page.waitForTimeout(300);
  await cek('04-akilli-giris-aday', false);
  await giris.fill('');

  // Sayaç hapı: Gecikmiş
  await page.getByRole('button', { name: /^Gecikmiş/ }).click();
  await page.waitForTimeout(400);
  await cek('05-hap-gecikmis', false);
  await page.getByRole('button', { name: /^Açık/ }).click();

  // Toplu seçim şeridi
  const kutular = page.locator('table tbody input[type=checkbox][title="Seç"]');
  await kutular.nth(0).check();
  await kutular.nth(1).check();
  await kutular.nth(2).check();
  await page.waitForTimeout(300);
  await cek('06-toplu-serit', false);
  await page.getByTitle('Seçimi bırak').click();

  // Detay paneli
  await page.locator('table tbody button[title="Detayı aç"]').first().click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(800);
  await cek('07-detay-paneli', false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Satır menüsü + ertele menüsü
  await page.locator('table tbody button[title="Ertele"]').first().click();
  await page.waitForTimeout(300);
  await cek('08-ertele-menusu', false);
  await page.keyboard.press('Escape');
  await page.locator('table tbody button[title="Diğer eylemler"]').first().click();
  await page.waitForTimeout(300);
  await cek('09-satir-menusu', false);
  await page.keyboard.press('Escape');

  // Kanban
  await page.getByRole('tab', { name: /Kanban/ }).click();
  await page.waitForTimeout(1200);
  await cek('10-kanban-1400');

  // Takvim
  await page.getByRole('tab', { name: /Takvim/ }).click();
  await page.waitForTimeout(800);
  await cek('11-takvim-ay');
  await page.getByRole('button', { name: 'Hafta', exact: true }).click();
  await page.waitForTimeout(500);
  await cek('12-takvim-hafta', false);

  // Mükellefe göre
  await page.getByRole('tab', { name: /Mükellefe göre/ }).click();
  await page.waitForTimeout(800);
  await cek('13-mukellefe-gore');

  // Notlar hapı
  await page.getByRole('tab', { name: /Ajanda/ }).click();
  await page.getByRole('button', { name: /^Notlar/ }).click();
  await page.waitForTimeout(500);
  await cek('14-notlar', false);
  await page.getByRole('button', { name: /^Açık/ }).click();

  // Süzgeç menüsü
  await page.getByTitle('Kategoriye göre süz').click();
  await page.waitForTimeout(300);
  await cek('15-kategori-suzgec', false);
  await page.keyboard.press('Escape');

  // Yeni görev paneli (başlık düğmesi)
  await page.getByRole('button', { name: /Yeni Görev/ }).click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(500);
  await cek('16-yeni-gorev-paneli', false);
  await page.keyboard.press('Escape');

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('17-ajanda-1000');
  await page.getByRole('tab', { name: /Kanban/ }).click();
  await page.waitForTimeout(800);
  await cek('18-kanban-1000', false);
  await page.getByRole('tab', { name: /Takvim/ }).click();
  await page.waitForTimeout(600);
  await cek('19-takvim-1000', false);
  await page.getByRole('tab', { name: /Ajanda/ }).click();
  await page.waitForTimeout(400);
  await page.locator('table tbody button[title="Detayı aç"]').first().click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(500);
  await cek('20-detay-1000', false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Dar ekranda toplu şerit alt gezinme çubuğunun üstünde kalmalı
  const kutu1000 = page.locator('table tbody input[type=checkbox][title="Seç"]');
  await kutu1000.nth(0).check();
  await kutu1000.nth(1).check();
  await page.waitForTimeout(300);
  await cek('21-toplu-serit-1000', false);
  const serit = await page.getByRole('toolbar', { name: 'Toplu işlemler' }).boundingBox();
  if (!serit || serit.y + serit.height > 800 - 70) hatalar.push('Toplu şerit dar ekranda alt gezinme çubuğunun altında kalıyor');
  await page.getByTitle('Seçimi bırak').click();

  await browser.close();
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
