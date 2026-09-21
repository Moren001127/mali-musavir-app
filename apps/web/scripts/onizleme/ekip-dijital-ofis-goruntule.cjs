// Ekip — sadeleştirilmiş "Dijital Ofis" görüntüleri. Sahte çift (bu oturum): API 3016 (vekil → 3026) + web 3017.
//   node apps/web/scripts/onizleme/ekip-dijital-ofis-goruntule.cjs [cikisKlasoru]
// Çekilenler: 01-ekip (tam) · 02-ust-satir · 03-bugun-listesi · 04-kadro-cekmece · 05-is-paneli (koşu → çekmece; +05b Durdur sonrası) ·
//   06-donem-sayfasi · 07-isler-sayfasi (iş paneli açık) · 08-duzenli-isler · 09-kota-dolu · 10-telefon (390×844).
// KOSU=0 ile koşu adımı atlanır. Çıktı: _previews/ekip-dijital-ofis/
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'ekip-dijital-ofis');
const PORT = process.env.SAHTE_WEB_PORT || '3017';
const KOK = `http://localhost:${PORT}`;
const API = process.env.SAHTE_API_KOK || 'http://localhost:3016/api/v1';
const KOSU = process.env.KOSU !== '0';
fs.mkdirSync(CIKIS, { recursive: true });
for (const f of fs.readdirSync(CIKIS)) if (f.endsWith('.png')) fs.unlinkSync(path.join(CIKIS, f));

// Tam sayfa görüntü için: panel kabuğu kendi içinde kaydırır (main overflow); yalnız görüntü anında kabuğu serbest bırak.
const TAM_SAYFA_CSS = '[data-panel-shell]{height:auto!important;overflow:visible!important}[data-panel-content]{overflow:visible!important}main[data-panel-main]{overflow:visible!important}';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const pg = await ctx.newPage();
  const hatalar = [];
  const iptalIstekleri = [];
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) hatalar.push(m.text().slice(0, 240)); });
  pg.on('response', (r) => { if (r.status() >= 400) hatalar.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  pg.on('request', (r) => { if (/\/ekip\/isler\/[^/]+\/iptal$/.test(r.url()) && r.method() === 'POST') iptalIstekleri.push(r.url()); });

  const cek = async (ad, secici, tam = false) => {
    if (secici) {
      const el = pg.locator(secici).first();
      await el.scrollIntoViewIfNeeded();
      await pg.waitForTimeout(350);
      await el.screenshot({ path: path.join(CIKIS, `${ad}.png`) });
    } else await pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: tam });
    console.log('çekildi', ad);
  };
  const git = async (sayfa, tamSayfa = false) => {
    for (let deneme = 0; deneme < 3; deneme++) {
      const r = await pg.goto(`${KOK}${sayfa}`, { waitUntil: 'networkidle', timeout: 180000 });
      if (r && r.status() < 500) break;
      await pg.waitForTimeout(15000);
    }
    await pg.evaluate(() => document.fonts.ready);
    if (tamSayfa) await pg.addStyleTag({ content: TAM_SAYFA_CSS });
    await pg.waitForTimeout(2200);
  };
  const tasmaVar = async (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 || [...document.querySelectorAll('main')].some((e) => e.scrollWidth > e.clientWidth + 2));

  // Sahte veriyi tohuma döndür (kuyruk 3/8'den başlasın; dört grup dolu)
  await pg.request.post(`${API}/ekip-ofis/sifirla`).catch(() => null);
  await git('/giris/musavir');
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });

  await git('/panel/ekip');
  await cek('03-bugun-listesi', '#bugun');
  await cek('02-ust-satir', '.of-ust');
  const tasma = await tasmaVar(pg);
  await pg.addStyleTag({ content: TAM_SAYFA_CSS });
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(400);
  await cek('01-ekip', null, true);

  await pg.locator('.of-kadro .of-personel').filter({ hasText: 'Beyanname' }).first().click();
  await pg.waitForTimeout(600);
  await cek('04-kadro-cekmece');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);

  let durdurSonucu = null;
  if (KOSU) {
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.locator('.of-gorev-girdi').fill('Ömer Özen’in Ağustos 2026 KDV kontrolünü yap');
    await pg.getByRole('button', { name: /^Başlat$/ }).click();
    await pg.waitForTimeout(4000);
    const cekmeceAcik = await pg.locator('.of-cekmece[data-genis]').count();
    await cek('05-is-paneli');
    const durdur = pg.locator('.of-cekmece').getByRole('button', { name: /^Durdur$/ }).first();
    if (await durdur.count()) {
      await durdur.click();
      await pg.waitForTimeout(1500);
      durdurSonucu = { cekmeceAcik, iptalIstegi: iptalIstekleri.length, durdurulduYazisi: await pg.locator('.of-cekmece').getByText(/Durduruldu|İş durduruldu/).count() };
      await cek('05b-durduruldu');
    }
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(400);
  }

  // Alt sayfalar
  await git('/panel/ekip/donem', true);
  const kutular = pg.locator('.epk-table tbody input[type=checkbox]:not(:disabled)');
  const n = await kutular.count();
  for (let i = 0; i < Math.min(2, n); i++) await kutular.nth(i).check();
  await pg.waitForTimeout(300);
  await cek('06-donem-sayfasi', null, true);

  await git('/panel/ekip/isler', true);
  const ilkIs = pg.locator('button[title="İşi aç"]').first();
  if (await ilkIs.count()) {
    await ilkIs.click();
    await pg.waitForTimeout(1200);
  }
  await cek('07-isler-sayfasi');
  await pg.keyboard.press('Escape');

  await git('/panel/ekip/duzen', true);
  await cek('08-duzenli-isler', null, true);

  // Kota dolu: durum isteğine kota=1 ekle
  await pg.route('**/api/v1/ekip/durum*', (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('kota', '1');
    route.continue({ url: u.toString() });
  });
  await git('/panel/ekip');
  await cek('09-kota-dolu', '.of-ust');
  await pg.unroute('**/api/v1/ekip/durum*');

  // Telefon
  const mctx = await b.newContext({ storageState: await ctx.storageState(), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await m.goto(`${KOK}/panel/ekip`, { waitUntil: 'networkidle', timeout: 180000 });
  await m.evaluate(() => document.fonts.ready);
  await m.waitForTimeout(2000);
  const mobilTasma = await tasmaVar(m);
  const mobilYapiskan = await m.evaluate(() => [...document.querySelectorAll('.ekip-ofis *')].some((e) => getComputedStyle(e).position === 'sticky'));
  await m.addStyleTag({ content: TAM_SAYFA_CSS });
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(CIKIS, '10-telefon.png'), fullPage: true });

  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, mobilTasma, mobilYapiskan, durdurSonucu, cikis: CIKIS }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
