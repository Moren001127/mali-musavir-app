// e-Defter berat takibi (panel kartı + E-Defter Detayı penceresi + Mükellefiyetler "Başlangıç") — Playwright görüntüleri.
// Sahte çift: SAHTE_API_PORT=3020 SAHTE_WEB_PORT=3021 node apps/web/scripts/dev-sahte-kart.cjs
//   node apps/web/scripts/onizleme/edefter-takip-goruntule.cjs [cikisKlasoru]
// Veri: scripts/mock/oncelik/edefter-takip.cjs (Eylül 2026: 3 verildi / 2 verilmedi; Sorgula → sahte DVD işleri).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'edefter-takip');
const PORT = process.env.SAHTE_WEB_PORT || '3021';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

async function giris(pg) {
  for (let deneme = 0; deneme < 3; deneme++) {
    try {
      await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
      await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
      break;
    } catch (e) {
      if (deneme === 2) throw e;
      await pg.waitForTimeout(20000); // Next dev geçici 500 → bekle, yeniden dene
    }
  }
  await pg.waitForTimeout(1500); // hidrasyon
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
}

/** Öğeyi kenar payıyla çeker (kart çevresi görünsün). */
async function payliCek(pg, secici, dosya, pay = 12) {
  const el = pg.locator(secici).first();
  await el.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  const k = await el.boundingBox();
  if (!k) throw new Error(`Öğe bulunamadı: ${secici}`);
  const vp = pg.viewportSize();
  await pg.screenshot({
    path: dosya,
    clip: { x: Math.max(0, k.x - pay), y: Math.max(0, k.y - pay), width: Math.min(vp.width, k.width + pay * 2), height: Math.min(vp.height, k.height + pay * 2) },
  });
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error' && !/404|ERR_CONNECTION|favicon/.test(m.text())) hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await giris(pg);
  await pg.mouse.move(2, 2);

  // 1) Panel: E-Defter kartı yakın plan (dönem çipleri)
  const kart = pg.locator('.yukumluluk-karti[data-kind="edefter"]').first();
  await kart.waitFor({ state: 'visible', timeout: 60000 });
  await pg.waitForTimeout(800);
  await payliCek(pg, '.yukumluluk-karti[data-kind="edefter"]', path.join(CIKIS, '01-panel-karti.png'));
  // Yan sütun bütünü (SGK + E-Defter + Fatura)
  await payliCek(pg, '.ofis-panorama__aside', path.join(CIKIS, '02-panel-yan-sutun.png'));

  // 2) Beyanname Durum Takibi tablosu — E-Defter satırındaki dönem notu
  const tablo = pg.locator('.bd-table').first();
  if (await tablo.count()) {
    await tablo.scrollIntoViewIfNeeded();
    await pg.waitForTimeout(500);
    await payliCek(pg, '.bd', path.join(CIKIS, '03-beyanname-tablosu.png'));
  }
  const edefterSatiriMetni = await pg.locator('.bd-row .bd-name small').first().innerText().catch(() => '');

  // 3) Kart tıklanır → E-Defter Detayı penceresi (Verilmemiş)
  await kart.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  await kart.locator('button').first().click();
  const pencere = pg.locator('.edd').first();
  await pencere.waitFor({ state: 'visible', timeout: 30000 });
  await pg.waitForTimeout(1200);
  await pg.mouse.move(2, 2);
  await pencere.screenshot({ path: path.join(CIKIS, '04-detay-verilmemis.png') });
  const verilmemisSayac = await pg.locator('.edd-sekmeler button').nth(0).innerText();
  const verilmisSayac = await pg.locator('.edd-sekmeler button').nth(1).innerText();

  // 4) Verilmiş sekmesi
  await pg.locator('.edd-sekmeler button').nth(1).click();
  await pg.waitForTimeout(500);
  await pg.mouse.move(2, 2);
  await pencere.screenshot({ path: path.join(CIKIS, '05-detay-verilmis.png') });

  // 5) Tablo yakın plan (ilk mükellef bloğu)
  const blok = pg.locator('.edd-blok').first();
  await blok.screenshot({ path: path.join(CIKIS, '06-tablo.png') });

  // 6) Sorgula → koşu durumu (başladı) → bitince liste yenilenir
  await pg.locator('.edd-sekmeler button').nth(0).click();
  await pg.waitForTimeout(300);
  await pg.locator('.edd-dugme--birincil').click();
  await pg.locator('.edd-kosu').waitFor({ state: 'visible', timeout: 15000 });
  await pg.waitForTimeout(600);
  const kosuBasladi = await pg.locator('.edd-kosu').innerText();
  await pg.screenshot({ path: path.join(CIKIS, '07-sorgula-basladi.png'), clip: { x: 0, y: 0, width: 1500, height: 420 } });
  // sahte işler 9 sn'de biter; izleme 5 sn'de bir → en geç ~16 sn
  await pg.locator('.edd-kosu[data-durum="bitti"]').waitFor({ state: 'visible', timeout: 40000 });
  await pg.waitForTimeout(800);
  const kosuBitti = await pg.locator('.edd-kosu').innerText();
  await pencere.screenshot({ path: path.join(CIKIS, '08-sorgula-bitti.png') });

  // 7) Telefon genişliği (pencere)
  await pg.setViewportSize({ width: 420, height: 900 });
  await pg.waitForTimeout(800);
  await pencere.screenshot({ path: path.join(CIKIS, '09-detay-telefon.png') });
  await pg.setViewportSize({ width: 1500, height: 1000 });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);
  const kapandi = (await pg.locator('.edd').count()) === 0;

  // 8) Mükellefiyetler kartı — E-Defter satırı "Başlangıç" alanı
  let baslangicAlani = false;
  try {
    await pg.goto(`${KOK}/panel/mukellefler/m7`, { waitUntil: 'networkidle', timeout: 120000 });
    await pg.waitForTimeout(2500);
    const bolum = pg.getByRole('button', { name: /Mükellefiyet Bilgileri/ }).first();
    if (await bolum.count()) {
      await bolum.click();
      await pg.waitForTimeout(1200);
    }
    // E-Defter satırında "Aylık" seç → Başlangıç alanı belirsin
    const satir = pg.locator('tr', { hasText: 'E-Defter / E-Berat' }).first();
    await satir.waitFor({ state: 'visible', timeout: 15000 });
    await satir.getByRole('button', { name: 'Aylık', exact: true }).click();
    await pg.waitForTimeout(400);
    const girdi = satir.locator('input[type=month]');
    baslangicAlani = (await girdi.count()) > 0;
    if (baslangicAlani) await girdi.fill('2026-07');
    await pg.waitForTimeout(300);
    await satir.scrollIntoViewIfNeeded();
    await pg.mouse.move(2, 2);
    const k = await satir.boundingBox();
    if (k) await pg.screenshot({ path: path.join(CIKIS, '10-mukellefiyet-baslangic.png'), clip: { x: Math.max(0, k.x - 12), y: Math.max(0, k.y - 60), width: Math.min(1500, k.width + 24), height: Math.min(1000, k.height + 120) } });
  } catch (e) {
    hatalar.push('MUKELLEFIYET ' + String(e).slice(0, 200));
  }

  console.log(JSON.stringify({ cikis: CIKIS, edefterSatiriMetni, verilmemisSayac, verilmisSayac, kosuBasladi, kosuBitti, kapandi, baslangicAlani, hatalar }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
