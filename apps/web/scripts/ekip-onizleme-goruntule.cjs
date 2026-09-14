// Ekip ekranı — Playwright ile ekran görüntüleri (sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs → API 3006 + web 3007)
// Kullanım: node apps/web/scripts/ekip-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/ekip)
// Akış: boş ekran → görev yaz → Çalıştır → koşu sürerken (adımlar akarken) → koşu bitti → personel bitti (istek kartı) → geçmişten iş seç.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/ekip');
fs.mkdirSync(CIKIS, { recursive: true });
const URL = process.env.EKIP_URL || 'http://localhost:3007/panel/ekip';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hatalar = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1, locale: 'tr-TR' });
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
  await page.waitForSelector('text=Koordinatör’e ne yaptıralım', { timeout: 90000 });
  await page.waitForTimeout(800);
  await cek('01-bos-ekran');

  // Görev yaz + çalıştır
  const alan = page.locator('textarea').first();
  await alan.fill("Ömer Özen'in Ağustos 2026 dönemi KDV kontrolünü yapın");
  await page.getByRole('button', { name: /^Çalıştır$/ }).click();
  await page.waitForTimeout(3500);
  await cek('02-kosu-suruyor', false);
  // Koşu sürerken cevap/talimat yaz → "Bitince gönder" kuyruğu
  const cevapAlani = page.locator('input[placeholder*="talimat"]').first();
  await cevapAlani.fill('beyannameyi henüz hazırlama, sadece kontrol');
  await page.getByRole('button', { name: /Bitince gönder/ }).first().click();
  await page.waitForTimeout(500);
  await cek('02b-cevap-kuyrukta', false);
  await page.waitForTimeout(5500);
  await cek('03-kosu-personele-verildi', false);
  await page.waitForTimeout(4500);
  await cek('04-koordinator-bitti', true);
  await page.waitForTimeout(9000);
  await cek('05-personel-bitti-istek', true);

  // Geçmişten iş seç (Hüseyin Salı canlı)
  await page.getByRole('button', { name: /HÜSEYİN SALI/ }).first().click();
  await page.waitForTimeout(1500);
  await cek('06-gecmis-is-paneli', true);

  // Sizden istenen sekmesi
  await page.getByRole('tab', { name: /Sizden istenen/ }).click();
  await page.waitForTimeout(600);
  await cek('07-sizden-istenen', false);

  await browser.close();
  if (hatalar.length) {
    console.log('HATALAR:');
    for (const h of hatalar) console.log(' -', h);
    process.exitCode = 1;
  } else console.log('Konsol hatası yok, yatay taşma yok.');
})();
