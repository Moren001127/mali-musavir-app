// MOREN AI (Elif) beyaz tema önizlemesi — sahte çift (3006/3007) üzerinde Playwright görüntüleri.
//   node apps/web/scripts/onizleme/moren-ai-onizleme-goruntule.cjs [cikisKlasoru]
//   Yerleşik `/moren-ai/conversations` ucu sahte API'de boş döndüğü için tarayıcıda page.route ile
//   eklentinin `/moren-ai-sahte/conversations` yoluna yönlendirilir (kodda geçici değişiklik YOK).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'moren-ai');
const WEB = `http://localhost:${process.env.SAHTE_WEB_PORT || '3007'}`;
const API = `http://localhost:${process.env.SAHTE_API_PORT || '3006'}/api/v1`;
fs.mkdirSync(CIKIS, { recursive: true });

async function giris(pg) {
  await pg.goto(`${WEB}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  // Boş dönen yerleşik listeyi eklentideki dolu listeye yönlendir
  await pg.route(/\/api\/v1\/moren-ai\/conversations(\?.*)?$/, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(`${API}/moren-ai-sahte/conversations${u.search}`);
    route.fulfill({ status: 200, contentType: 'application/json', body: await r.text() });
  });
  await giris(pg);
  await pg.goto(`${WEB}/panel/moren-ai`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(3000);

  // 1) Tam sayfa — dolu sohbet
  await pg.screenshot({ path: path.join(CIKIS, '01-tam-sayfa.png') });
  // 2) Sohbet paneli yakın
  const chat = pg.locator('.ai-root section').first();
  await chat.screenshot({ path: path.join(CIKIS, '02-sohbet-paneli.png') });
  // 3) Sol sütun + mükellef bağlamı açık
  await pg.locator('#moren-ai-context').click();
  await pg.waitForTimeout(400);
  await pg.locator('.ai-side').screenshot({ path: path.join(CIKIS, '03-sol-sutun-baglam-acik.png') });
  await pg.locator('.ai-dd__item').nth(1).click();
  await pg.waitForTimeout(300);
  // 4) Hızlı menü açık
  await pg.getByRole('button', { name: /Hızlı menü/ }).click();
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(CIKIS, '04-hizli-menu.png'), clip: { x: 224, y: 0, width: 1276, height: 760 } });
  await pg.getByRole('button', { name: 'Kapat' }).click();
  await pg.waitForTimeout(200);
  // 5) Yazı kutusuna metin + gönder (sahte cevap) → yazıyor + yeni balon
  await pg.locator('#moren-ai-chat-input').fill('Famcoffee için ödeme hatırlatması hazırla.');
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(CIKIS, '05-yazi-kutusu-dolu.png'), clip: { x: 224, y: 780, width: 1276, height: 220 } });
  await pg.locator('button[title="Gönder (Enter)"]').click();
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: path.join(CIKIS, '06-gonderim-sonrasi.png') });
  // 6) Yeni sohbet — boş durum
  await pg.getByRole('button', { name: /Yeni sohbet/ }).click();
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: path.join(CIKIS, '07-yeni-sohbet-bos.png') });
  // 7) Sohbet listesi arama
  await pg.locator('.ai-search__input').fill('luca');
  await pg.waitForTimeout(300);
  await pg.locator('.ai-side').screenshot({ path: path.join(CIKIS, '08-liste-arama.png') });
  await pg.locator('.ai-search__input').fill('');
  // 8) Koyu tema (A) — aynı sayfa, modülün A değişkenleri bozulmadı mı?
  await pg.locator('.ai-conv').first().click();
  await pg.waitForTimeout(600);
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'A'));
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: path.join(CIKIS, '09-koyu-tema-A.png') });
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'D'));
  // 9) Dar ekran (tablet)
  await pg.setViewportSize({ width: 1024, height: 900 });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: path.join(CIKIS, '10-tablet-1024.png') });
  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
