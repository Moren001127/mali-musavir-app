// Genel Sorgulamalar (2026-09-25 2. tur: mükellef seçimli) görüntüleri — sahte çift KENDİ portlarında:
//   SAHTE_API_PORT=3022 SAHTE_WEB_PORT=3023 node apps/web/scripts/dev-sahte-kart.cjs
//   node apps/web/scripts/onizleme/genel-sorgular-goruntule.cjs [cikisKlasoru]
// Sahte veri: scripts/mock/oncelik/genel-sorgular.cjs. Çıktılar _previews/genel-sorgular/:
//   01-tam (mükellef seçili, 5 tablo alt alta, başlıklar gradyanlı) · 02-ust (mükellef SEÇİLMEDEN: yönlendirme
//   kartı) · 03-donem-takvim (takvimli dönem seçici açık) · 04-mukellef-suzgec · 05-sorgu-suruyor
//   06-tek-tur-haciz · 07-earsiv-eksik · 08-tek-tur-earsiv (en geniş tablo — taşma denetimi)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');

const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'genel-sorgular');
const PORT = process.env.SAHTE_WEB_PORT || '3023';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

async function ustKesit(pg, dosya, yukseklik) {
  await pg.mouse.move(2, 2);
  await pg.evaluate(() => {
    const main = document.querySelector('[data-panel-main]') || document.querySelector('main');
    const zincir = [];
    for (let el = main; el; el = el.parentElement) zincir.push(el);
    window.__ustKesitEski = zincir.map((el) => ({ el, style: el.getAttribute('style') }));
    for (const el of zincir) {
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
    }
  });
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: dosya, fullPage: true, clip: { x: 0, y: 0, width: 1760, height: yukseklik } });
  await pg.evaluate(() => {
    for (const { el, style } of window.__ustKesitEski || []) {
      if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
    }
    delete window.__ustKesitEski;
  });
  await pg.waitForTimeout(150);
}

async function sayfayaGit(pg, adres) {
  for (let deneme = 0; deneme < 4; deneme++) {
    const yanit = await pg.goto(adres, { waitUntil: 'networkidle', timeout: 180000 });
    if (yanit && yanit.status() < 500) break;
    await pg.waitForTimeout(15000);
  }
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1760, height: 1000 }, deviceScaleFactor: 2 });
  await pg.route(/\/api\/v1\/portal-automation\/dvd-sorgu$/, async (route) => {
    const u = new URL(route.request().url());
    u.pathname = u.pathname.replace('/portal-automation/dvd-sorgu', '/sahte/genel-sorgular/dvd-sorgu');
    const yanit = await route.fetch({ url: u.toString() });
    await route.fulfill({ response: yanit });
  });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
  await pg.waitForTimeout(1500);
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });

  // 02 — MÜKELLEF SEÇİLMEDEN: tablo yok, tek yönlendirme kartı
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular`);
  await pg.locator('.gs-secim-bekliyor').waitFor({ state: 'visible', timeout: 30000 });
  await ustKesit(pg, path.join(CIKIS, '02-ust.png'), 620);

  // 01 — mükellef seçili: 5 tablo alt alta, kart başlıkları türün renginde gradyan
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=gs1`);
  await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });
  await tamSayfa(pg, path.join(CIKIS, '01-tam.png'));

  // 03 — takvimli dönem seçici açık
  await pg.locator('.gs-donem-dugme').click();
  await pg.locator('.gs-donem-panel').waitFor({ state: 'visible', timeout: 15000 });
  await pg.waitForTimeout(400);
  await ustKesit(pg, path.join(CIKIS, '03-donem-takvim.png'), 620);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);

  // Mükellef süzgeci + Sorgula sürüyor
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=gs1`);
  await pg.locator('.gs-arac').waitFor({ state: 'visible' });
  await ustKesit(pg, path.join(CIKIS, '04-mukellef-suzgec.png'), 1000);
  await pg.locator('[data-gs-sorgula]').click();
  await pg.waitForTimeout(6000);
  await pg.locator('.gs-arac').screenshot({ path: path.join(CIKIS, '05-sorgu-suruyor.png') });

  // Tek tür sekmesi (E-Haciz) ve Gelen e-Arşiv "Görseli eksik faturalar"
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=gs1&tur=E_HACIZ`);
  await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });
  await ustKesit(pg, path.join(CIKIS, '06-tek-tur-haciz.png'), 1000);
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=gs1&tur=GELEN_EARSIV`);
  await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });
  // En geniş tablo — taşma denetimi (sütunlar 2026-09-25'te daraltıldı)
  await ustKesit(pg, path.join(CIKIS, '08-tek-tur-earsiv.png'), 1000);
  await pg.locator('.gs-sekme', { hasText: 'Görseli eksik' }).click();
  await pg.waitForTimeout(1500);
  await ustKesit(pg, path.join(CIKIS, '07-earsiv-eksik.png'), 1000);

  await b.close();
  console.log('bitti →', CIKIS);
})().catch((e) => { console.error(e); process.exit(1); });
