// Aylık Takip Listesi (tema D) görüntüleri — sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (3006/3007)
//   node apps/web/scripts/onizleme/aylik-takip-goruntule.cjs [cikisKlasoru]
// Yerleşik sahte `/taxpayers` ucu monthlyStatus döndürmediği için tarayıcı istekleri
// scripts/mock/aylik-takip.cjs eklentisinin `/sahte/aylik-takip/taxpayers` ucuna yönlendirilir
// (aşama işaretleri PATCH ile aynı eklentinin belleğine yazılır, yeniden çekimde görünür).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'aylik-takip');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

async function sahteYonlendir(pg) {
  await pg.route(/\/api\/v1\/taxpayers(\?.*)?$/, async (route) => {
    const istek = route.request();
    if (istek.method() !== 'GET') return route.continue();
    const u = new URL(istek.url());
    u.pathname = u.pathname.replace('/api/v1/taxpayers', '/api/v1/sahte/aylik-takip/taxpayers');
    const yanit = await route.fetch({ url: u.toString() });
    await route.fulfill({ response: yanit });
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
  await pg.goto(`${KOK}/panel/mukellefler`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
  const kok = pg.locator('.at-root').first();
  await kok.waitFor({ state: 'visible', timeout: 30000 });

  // 1) Tam görünüm
  await tamSayfa(pg, path.join(CIKIS, '01-tam.png'));
  // 2) Üst alan: başlık + araç çubuğu + sayaçlar
  await pg.screenshot({ path: path.join(CIKIS, '02-ust.png'), clip: { x: 224, y: 0, width: 1276, height: 330 } });
  // 3) Tablo yakın plan
  const tablo = pg.locator('.at-table-wrap').first();
  await tamSayfa(pg, path.join(CIKIS, '03-tablo.png'), '.at-table-wrap');
  // 4) Aşama süzgeci: Evrak bekleniyor
  await pg.locator('.at-kpi[data-tone="amber"]').click();
  await pg.waitForTimeout(500);
  await tamSayfa(pg, path.join(CIKIS, '04-suzgec-evrak.png'));
  await pg.locator('.at-kpi[data-tone="amber"]').click();
  await pg.waitForTimeout(300);
  // 5) Profil eksik çipi
  await pg.locator('.at-chip[data-tone="amber"]').click();
  await pg.waitForTimeout(500);
  await tamSayfa(pg, path.join(CIKIS, '05-profil-eksik.png'));
  await pg.locator('.at-chip[data-tone="amber"]').click();
  await pg.waitForTimeout(300);
  // 6) Onay kutusu işaretle → aşama ilerler (iyimser güncelleme + eklenti belleği)
  const ilkSatir = pg.locator('.at-tr').first();
  const evrakKutu = ilkSatir.locator('.at-check').first();
  const oncekiDurum = await ilkSatir.locator('.at-stage').innerText();
  await evrakKutu.click();
  await pg.waitForTimeout(900);
  const sonrakiDurum = await ilkSatir.locator('.at-stage').innerText();
  await tamSayfa(pg, path.join(CIKIS, '06-tablo-isaretli.png'), '.at-table-wrap');
  await evrakKutu.click(); // geri al
  await pg.waitForTimeout(600);
  // 7) Not girdisi odaklı
  const not = ilkSatir.locator('.at-note');
  await not.click();
  await not.fill('Deneme notu');
  await pg.waitForTimeout(200);
  const kutu = await ilkSatir.boundingBox();
  if (kutu) await pg.screenshot({ path: path.join(CIKIS, '07-not-odak.png'), clip: { x: 224, y: Math.max(0, kutu.y - 50), width: 1276, height: 160 } });
  await not.fill('');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(300);
  console.log(JSON.stringify({ cikis: CIKIS, asamaOncesi: oncekiDurum, asamaSonrasi: sonrakiDurum }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
