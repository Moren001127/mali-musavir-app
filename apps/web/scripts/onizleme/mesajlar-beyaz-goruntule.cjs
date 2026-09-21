// WhatsApp Mesajlar — beyaz tema (D) görüntüleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/mesajlar-beyaz-goruntule.cjs [cikisKlasoru]
// Çekilenler: 01 liste + boş sohbet · 02 seçili dolu sohbet · 03 sohbet alanı (yakın) · 04 kişi bilgisi paneli ·
//             05 yeni konuşma penceresi · 06 kayıtsız numara (mükellefe bağla) · 07 koyu tema (A) denetimi
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'mesajlar');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.goto(`${KOK}/panel/mesajlar`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
  const cek = (ad, opts = {}) => pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), ...opts });
  await cek('01-liste-bos-sohbet');
  // Dolu sohbet: Yavuz Nakliyat (18 mesaj, 3 gün)
  await pg.getByRole('button', { name: /Yavuz/ }).first().click();
  await pg.waitForTimeout(1800);
  await cek('02-secili-sohbet');
  const sohbet = pg.locator('[data-wm-sohbet]').first();
  if (await sohbet.count()) await sohbet.screenshot({ path: path.join(CIKIS, '03-sohbet-yakin.png') });
  // Kişi bilgisi paneli
  const kisi = pg.locator('button[title="Kişi bilgisi"]').first();
  if (await kisi.count()) { await kisi.click(); await pg.waitForTimeout(800); await cek('04-kisi-bilgisi'); const kapat = pg.locator('button[title="Kapat"]').first(); if (await kapat.count()) await kapat.click(); await pg.waitForTimeout(300); }
  // Yeni konuşma penceresi
  const yeni = pg.locator('button[title="Yeni konuşma"]').first();
  if (await yeni.count()) { await yeni.click(); await pg.waitForTimeout(1200); await cek('05-yeni-konusma'); await pg.locator('button[title="Pencereyi kapat"]').first().click(); await pg.waitForTimeout(400); }
  // Kayıtsız numara
  const kayitsiz = pg.getByRole('button', { name: /905551234567/ }).first();
  if (await kayitsiz.count()) { await kayitsiz.click(); await pg.waitForTimeout(1500); await cek('06-kayitsiz-numara'); }
  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  // Koyu tema (A) bozulmadı mı?
  await pg.evaluate(() => { document.documentElement.setAttribute('data-theme', 'A'); });
  await pg.waitForTimeout(600);
  await pg.getByRole('button', { name: /Yavuz/ }).first().click();
  await pg.waitForTimeout(1200);
  await cek('07-koyu-tema-a');
  // Dar masaüstü (1280): sol sütun 350px, yazı taşması var mı?
  const ctx = await b.newContext({ storageState: await pg.context().storageState(), viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const dar = await ctx.newPage();
  await dar.goto(`${KOK}/panel/mesajlar`, { waitUntil: 'networkidle', timeout: 120000 });
  await dar.waitForTimeout(1500);
  await dar.getByRole('button', { name: /Yavuz/ }).first().click();
  await dar.waitForTimeout(1200);
  await dar.screenshot({ path: path.join(CIKIS, '08-dar-1280.png') });
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
