// Mükellef Listesi (tema D) görüntüleri — sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (3006/3007)
//   node apps/web/scripts/onizleme/mukellef-listesi-goruntule.cjs [cikisKlasoru]
// Yerleşik sahte `/taxpayers` ucu isActive/taxOffice/şifre alanlarını döndürmediği için tarayıcı istekleri
// scripts/mock/mukellef-listesi.cjs eklentisinin `/sahte/mukellef-listesi/taxpayers` ucuna yönlendirilir.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'mukellef-listesi');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

async function sahteYonlendir(pg) {
  // Liste: GET /taxpayers?scope=directory… → zengin sahte liste
  await pg.route(/\/api\/v1\/taxpayers(\?.*)?$/, async (route) => {
    const istek = route.request();
    const u = new URL(istek.url());
    if (istek.method() !== 'GET') return route.continue();
    u.pathname = u.pathname.replace('/api/v1/taxpayers', '/api/v1/sahte/mukellef-listesi/taxpayers');
    const yanit = await route.fetch({ url: u.toString() });
    await route.fulfill({ response: yanit });
  });
  // Durum değişimi / silme: PUT|DELETE /taxpayers/:id → eklentinin bellek listesi
  await pg.route(/\/api\/v1\/taxpayers\/[^/?]+$/, async (route) => {
    const istek = route.request();
    if (istek.method() !== 'PUT' && istek.method() !== 'DELETE') return route.continue();
    const u = new URL(istek.url());
    u.pathname = u.pathname.replace('/api/v1/taxpayers/', '/api/v1/sahte/mukellef-listesi/taxpayers/');
    const yanit = await route.fetch({ url: u.toString() });
    await route.fulfill({ response: yanit });
  });
  // Oturum: canlı API roles dizisi döner; sahte tekil role → Sil düğmesi görünsün diye tamamlanır
  await pg.route(/\/api\/v1\/auth\/me$/, async (route) => {
    const yanit = await route.fetch();
    const govde = await yanit.json();
    await route.fulfill({ response: yanit, json: { ...govde, roles: govde.roles || [govde.role || 'ADMIN'] } });
  });
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await sahteYonlendir(pg);
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
  await pg.waitForTimeout(1500); // hidrasyon; erken gönderim formu GET ile yeniden yükler
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });
  await pg.goto(`${KOK}/panel/mukellef-listesi`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
  const kok = pg.locator('.ml-root').first();
  await kok.waitFor({ state: 'visible', timeout: 30000 });

  // 1) Tam sayfa
  await tamSayfa(pg, path.join(CIKIS, '01-tam.png'));
  // 2) Üst alan: başlık + çipler + araç çubuğu + harfler
  await pg.screenshot({ path: path.join(CIKIS, '02-ust.png'), clip: { x: 224, y: 0, width: 1276, height: 300 } });
  // 3) Tablo yakın plan
  const tablo = pg.locator('.ml-table-wrap').first();
  if (await tablo.count()) await tamSayfa(pg, path.join(CIKIS, '03-tablo.png'), '.ml-table-wrap');
  // 4) Durum menüsü açık
  const durum = pg.locator('.ml-status').first();
  if (await durum.count()) {
    await durum.click();
    await pg.waitForTimeout(300);
    const kutu = await durum.boundingBox();
    if (kutu) await pg.screenshot({ path: path.join(CIKIS, '04-durum-menu.png'), clip: { x: Math.max(0, kutu.x - 520), y: Math.max(0, kutu.y - 60), width: 900, height: 200 } });
    await pg.keyboard.press('Escape');
    await pg.mouse.click(700, 60);
    await pg.waitForTimeout(200);
  }
  // 5) Uyarı çipi → liste penceresi
  const dolucip = pg.locator('.ml-chip[data-tone="red"], .ml-chip[data-tone="amber"]').first();
  if (await dolucip.count()) {
    await dolucip.click();
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(CIKIS, '05-uyari-pencere.png') });
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
  }
  // 6) Pasif süzgeci
  await pg.getByRole('tab', { name: 'Pasif' }).click();
  await pg.waitForTimeout(400);
  await tamSayfa(pg, path.join(CIKIS, '06-pasif.png'));
  await pg.getByRole('tab', { name: 'Tümü', exact: true }).last().click();
  await pg.waitForTimeout(300);
  // 7) Harf + tür süzgeci
  await pg.locator('.ml-letter', { hasText: /^B$/ }).click();
  await pg.getByRole('tab', { name: /^Firma/ }).click();
  await pg.waitForTimeout(400);
  await tamSayfa(pg, path.join(CIKIS, '07-harf-firma.png'));
  // 8) Fare satır üzerinde
  await pg.locator('.ml-letter', { hasText: 'Tümü' }).click();
  await pg.getByRole('tab', { name: /^Tümü/ }).first().click();
  await pg.waitForTimeout(400);
  const satir = pg.locator('.ml-tr-link').nth(1);
  await satir.hover();
  await pg.waitForTimeout(200);
  const satirKutu = await satir.boundingBox();
  if (satirKutu) await pg.screenshot({ path: path.join(CIKIS, '08-tablo-fare.png'), clip: { x: 224, y: Math.max(0, satirKutu.y - 70), width: 1276, height: 200 } });
  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
