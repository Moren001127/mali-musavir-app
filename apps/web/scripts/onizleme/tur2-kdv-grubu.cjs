// İkinci tur beyaz tema (D) — KDV grubu görüntüleri: KDV Kontrol (kilitli sayfa), KDV Durum Panosu,
// Toplu Beyanname, e-Tebligat Kontrol, SGK Otomasyonu. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/tur2-kdv-grubu.cjs [modul,modul…] [--cikis=klasor]
// Her modül: 01 tam sayfa + 02 ilk ekran + en az bir ayrıntı; sahte API'de 404 dönen uçlar ve tarayıcı hataları yazdırılır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const cikisArg = argv.find((a) => a.startsWith('--cikis='));
const KOK_CIKIS = cikisArg ? cikisArg.slice(8) : path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2');
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;

// KDV Kontrol: sahte veride m7 (Balçık İnşaat) 2026-08 Bilanço·Alış seansı dolu gelir → mükellefi seçip dönemi ayarlarız.
async function kdvKontrolSecim(pg) {
  const sec = pg.getByRole('button', { name: /Mükellef seç/ }).first();
  if (!(await sec.count())) return;
  await sec.click();
  await pg.waitForTimeout(400);
  const satir = pg.getByRole('button', { name: /Balçık İnşaat/ }).first();
  if (await satir.count()) await satir.click();
  await pg.waitForTimeout(400);
  const ay = pg.locator('input[type=month]').first();
  if (await ay.count()) { await ay.fill('2026-08'); await pg.waitForTimeout(300); }
  const alis = pg.getByRole('button', { name: /BİLANÇO · ALIŞ/ }).first();
  if (await alis.count()) { await alis.click(); await pg.waitForTimeout(300); }
  await pg.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });
  await pg.mouse.move(2, 2);
  await pg.waitForTimeout(2500);
}

// KDV Kontrol ek görüntüler: mükellef seçme penceresi + açık eşleşme satırı
async function kdvKontrolEk(pg, CIKIS) {
  const satir = pg.locator('[data-kdv-match-satir]').first();
  if (await satir.count()) {
    await satir.click();
    await pg.waitForTimeout(1200);
    const panel = pg.locator('[data-kdv-match]').first();
    await panel.scrollIntoViewIfNeeded();
    await pg.mouse.move(2, 2);
    await pg.waitForTimeout(300);
    await panel.screenshot({ path: path.join(CIKIS, '08-eslesme-acik.png') });
  }
  const sec = pg.getByRole('button', { name: /Balçık İnşaat A\.Ş\./ }).first();
  if (await sec.count()) {
    await sec.click();
    await pg.waitForTimeout(600);
    await pg.screenshot({ path: path.join(CIKIS, '09-mukellef-sec.png') });
    const kapat = pg.locator('[data-kdv-page] > div.fixed').first();
    if (await kapat.count()) await kapat.click({ position: { x: 8, y: 8 } }); // perdeye tıkla → kapanır
    await pg.waitForTimeout(300);
  }
}

// KDV Durum Panosu: pano görünümü + mükellef detay (KDV1) görünümü
async function kdvBeyannameEk(pg, CIKIS, tam) {
  const secim = pg.locator('[data-kdvb-pano] table tbody tr button').first();
  if (!(await secim.count())) return;
  await secim.click();
  await pg.mouse.move(2, 2);
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: path.join(CIKIS, '05-kdv1-ilk-ekran.png') });
  await tam(pg, path.join(CIKIS, '06-kdv1-tam-sayfa.png'));
  const kdv2 = pg.getByRole('button', { name: /KDV2 · Tevkifat/ }).first();
  if (await kdv2.count()) {
    await kdv2.click();
    await pg.mouse.move(2, 2);
    await pg.waitForTimeout(2000);
    await tam(pg, path.join(CIKIS, '07-kdv2-tam-sayfa.png'));
  }
}

// e-Tebligat ek: gece hatası penceresi + PDF önizleme penceresi
async function tebligatEk(pg, CIKIS) {
  const hataKart = pg.locator('[data-pa-kpi="kirmizi"]').first();
  if (await hataKart.count()) {
    await hataKart.click();
    await pg.waitForTimeout(700);
    await pg.screenshot({ path: path.join(CIKIS, '05-gece-hata-penceresi.png') });
    const perde = pg.locator('[data-pa-modal="hata"]').first();
    if (await perde.count()) await pg.mouse.click(30, 30);
    await pg.waitForTimeout(400);
  }
  const goz = pg.locator('[data-pa-eye]').first();
  if (await goz.count()) {
    await goz.click();
    await pg.waitForTimeout(900);
    await pg.screenshot({ path: path.join(CIKIS, '06-pdf-penceresi.png') });
    await pg.mouse.click(30, 30);
    await pg.waitForTimeout(400);
  }
}
// SGK ek: dönem seçici açılır kutusu
async function sgkEk(pg, CIKIS) {
  const donem = pg.getByRole('button', { name: 'Dönem' }).first();
  if (await donem.count()) {
    await donem.click();
    await pg.waitForTimeout(500);
    const kart = pg.locator('[data-pa-table]').first();
    await kart.screenshot({ path: path.join(CIKIS, '05-donem-secici.png') });
    await pg.keyboard.press('Escape');
    await pg.mouse.click(700, 120);
    await pg.waitForTimeout(300);
  }
}

const MODULLER = {
  'kdv-kontrol': { yol: '/panel/kdv-kontrol', hazirla: kdvKontrolSecim, ayrinti: ['[data-kdv-page] > header', '[data-kdv-commands]', '[data-kdv-page] [data-portal-kpi]:first-child >> xpath=../..', '[data-kdv-ocr]', '[data-kdv-page] table'], ek: kdvKontrolEk },
  'kdv-beyanname': { yol: '/panel/kdv-beyanname', ayrinti: ['[data-kdvb-page] > header', '[data-kdvb-pano]'], ek: kdvBeyannameEk },
  'beyannameler': { yol: '/panel/beyannameler', ayrinti: ['[data-beyan-page] > section:first-child', '[data-beyan-page] table'] },
  'tebligat': { yol: '/panel/ajanlar/tebligat?durum=goruntulenmemis', ayrinti: ['[data-pa-page] [data-pa-kpi-grid]', '[data-pa-page] table'], ek: tebligatEk },
  'sgk': { yol: '/panel/ajanlar/sgk', ayrinti: ['[data-pa-page] [data-pa-durum-seridi]', '[data-pa-page] table'], ek: sgkEk },
};
const hedefler = secilen.length ? secilen : Object.keys(MODULLER);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  const eksikUclar = new Set();
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 200)));
  pg.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/v1/')) eksikUclar.add(r.request().method() + ' ' + r.url().replace(/^.*\/api\/v1/, '')); });
  // Paralel ajanlar geçici derleme hatası bırakabilir (500) → giriş sayfası 200 dönene kadar bekle (en çok ~6 dk).
  for (let i = 0; i < 36; i++) {
    let kod = 0;
    try { kod = (await pg.request.get(`${KOK}/giris/musavir`, { timeout: 120000 })).status(); } catch { /* sunucu meşgul */ }
    if (kod === 200) break;
    console.error(`giriş sayfası ${kod || 'yanıtsız'} — 10 sn sonra tekrar`);
    await pg.waitForTimeout(10000);
  }
  // Giriş: geliştirme sunucusu yoğunken sayfa hidrasyonu gecikebilir (form GET olarak gider) → birkaç kez dene.
  for (let deneme = 1; deneme <= 4; deneme++) {
    await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
    await pg.waitForTimeout(1500 * deneme);
    await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
    await pg.locator('input[type=password]').fill('sahte-deneme-1');
    await pg.locator('button[type=submit]').click();
    try { await pg.waitForURL(/\/panel/, { timeout: 30000, waitUntil: 'commit' }); break; } catch (e) { if (deneme === 4) throw e; }
  }
  const rapor = {};
  for (const ad of hedefler) {
    const m = MODULLER[ad];
    if (!m) { console.warn('bilinmeyen modül', ad); continue; }
    const CIKIS = path.join(KOK_CIKIS, ad);
    fs.mkdirSync(CIKIS, { recursive: true });
    hatalar.length = 0; eksikUclar.clear();
    await pg.goto(`${KOK}${m.yol}`, { waitUntil: 'networkidle', timeout: 120000 });
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(2500);
    if (typeof m.hazirla === 'function') await m.hazirla(pg);
    await pg.screenshot({ path: path.join(CIKIS, '02-ilk-ekran.png') });
    await tamSayfa(pg, path.join(CIKIS, '01-tam-sayfa.png'));
    let n = 3;
    for (const sec of m.ayrinti) {
      const loc = pg.locator(sec).first();
      if (await loc.count()) { try { await loc.scrollIntoViewIfNeeded(); await pg.waitForTimeout(200); await loc.screenshot({ path: path.join(CIKIS, `${String(n).padStart(2, '0')}-ayrinti.png`) }); n++; } catch (e) { hatalar.push('ayrinti ' + sec + ': ' + String(e).slice(0, 120)); } }
    }
    if (typeof m.ek === 'function') await m.ek(pg, CIKIS, tamSayfa);
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[ad] = { hatalar: [...hatalar], eksikUclar: [...eksikUclar], yatayTasma: tasma, cikis: CIKIS };
  }
  console.log(JSON.stringify(rapor, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
