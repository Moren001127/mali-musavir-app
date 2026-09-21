// Bildirimler beyaz tema önizlemesi — sahte çift (3006/3007) üzerinde Playwright görüntüleri.
//   node apps/web/scripts/onizleme/bildirimler-onizleme-goruntule.cjs [cikisKlasoru]
//   Yerleşik `/notifications` ucu sahte API'de boş döndüğü için tarayıcıda page.route ile eklentinin
//   `/bildirimler-sahte/liste` yoluna yönlendirilir (kodda geçici değişiklik YOK).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'bildirimler');
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
  await pg.route(/\/api\/v1\/notifications(\?.*)?$/, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(`${API}/bildirimler-sahte/liste${u.search}`);
    route.fulfill({ status: 200, contentType: 'application/json', body: await r.text() });
  });
  await giris(pg);
  await pg.goto(`${WEB}/panel/bildirimler`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);

  // 1) Tam sayfa (ilk ekran)
  await pg.screenshot({ path: path.join(CIKIS, '01-tam-sayfa.png') });
  // 2) Tüm sayfa (kaydırmalı) — liste
  await pg.screenshot({ path: path.join(CIKIS, '02-liste-tam.png'), fullPage: true });
  // 3) Kritik sekmesi
  await pg.locator('[data-tab="kritik"]').click();
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(CIKIS, '03-kritik-sekmesi.png') });
  // 4) Okunmamış sekmesi + tekrar katlama açık
  await pg.locator('[data-tab="okunmamis"]').click();
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(CIKIS, '04-okunmamis-sekmesi.png') });
  await pg.locator('[data-tab="tumu"]').click();
  await pg.waitForTimeout(300);
  const kat = pg.locator('.bd-fold').first();
  if (await kat.count()) { await kat.click(); await pg.waitForTimeout(300); await kat.evaluate((e) => e.closest('.bd-row').scrollIntoView({ block: 'center' })); }
  await pg.locator('.bd-row').first().hover();
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(CIKIS, '05-katlama-acik.png') });
  await pg.evaluate(() => document.querySelector('[data-panel-main]').scrollTo(0, 0));
  await pg.waitForTimeout(200);
  // 5) Tercihler paneli
  await pg.getByRole('button', { name: /Tercihler/ }).click();
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(CIKIS, '06-tercihler.png') });
  await pg.getByRole('button', { name: /Tercihler/ }).click();
  // 6) Arama + tür süzgeci
  await pg.locator('.bd-input').fill('luca');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(CIKIS, '07-arama.png') });
  await pg.locator('.bd-input').fill('');
  await pg.locator('.bd-select').selectOption('WHATSAPP');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(CIKIS, '08-tur-suzgeci.png') });
  await pg.locator('.bd-select').selectOption('');
  // 7) Boş durum (eşleşmeyen arama)
  await pg.locator('.bd-input').fill('zzzz-yok');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(CIKIS, '09-bos-durum.png'), clip: { x: 224, y: 0, width: 1276, height: 420 } });
  await pg.locator('.bd-input').fill('');
  await pg.waitForTimeout(300);
  // 8) Koyu tema (A)
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'A'));
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(CIKIS, '10-koyu-tema-A.png') });
  await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'D'));
  // 9) Dar ekran
  await pg.setViewportSize({ width: 820, height: 900 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(CIKIS, '11-dar-820.png') });
  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
