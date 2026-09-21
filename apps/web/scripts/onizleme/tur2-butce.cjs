// İkinci tur beyaz tema (D) — Kişisel Bütçe görüntüleri (PIN, 9 sekme, pencereler).
//   sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/tur2-butce.cjs [sekme,sekme…] [--cikis=klasor] [--tema=A]
// Yerleşik sahte uç `/butce/erisim` {yetkili:false} döndürdüğü için burada page.route ile
// {yetkili:true} verilir; diğer `/butce/*` istekleri scripts/mock/butce.cjs eklentisinin
// `/butce-sahte/*` yollarına yönlendirilir. PIN: 6 hane, eklenti her şifreyi kabul eder.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const cikisArg = argv.find((a) => a.startsWith('--cikis='));
const temaArg = argv.find((a) => a.startsWith('--tema='));
const TEMA = temaArg ? temaArg.slice(7) : 'D';
const CIKIS = cikisArg ? cikisArg.slice(8) : path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2', TEMA === 'D' ? 'butce' : `butce-tema-${TEMA}`);
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

const SEKMELER = [
  { ad: 'genel', etiket: 'Genel Bakış' },
  { ad: 'gelir-gider', etiket: 'Gelir & Gider', ek: async (pg, n) => { await pencere(pg, n, 'Kayıt ekle', 'kayit-ekle'); await pencere(pg, n, 'Aktarım', 'aktarim'); await tikla(pg, 'Filtreler'); await tikla(pg, 'Tüm yıl'); await pg.waitForTimeout(600); await tamSayfa(pg, path.join(CIKIS, `${n}-filtre-ve-tum-yil.png`)); const mt = pg.locator('table[data-butce-matris]').first(); if (await mt.count()) { await mt.scrollIntoViewIfNeeded(); await pg.mouse.move(2, 2); await pg.waitForTimeout(200); await mt.screenshot({ path: path.join(CIKIS, `${n}-tum-yil-matris.png`) }); } } },
  { ad: 'hesaplar', etiket: 'Hesaplar', ek: async (pg, n) => { await pencere(pg, n, 'Hareketler', 'hesap-hareketleri'); await pencere(pg, n, 'Hesap ekle', 'hesap-ekle'); } },
  { ad: 'kartlar', etiket: 'Kredi Kartları', ek: async (pg, n) => { await pencere(pg, n, 'Hareketler', 'ekstre-hareketleri'); await pencere(pg, n, 'Ekstre PDF yükle', 'pdf-yukle'); await pencere(pg, n, 'Tutar / ödeme', 'tutar-odeme'); } },
  { ad: 'borclar', etiket: 'Borçlar', ek: async (pg, n) => { await pencere(pg, n, 'Borç ekle', 'borc-ekle'); await pencere(pg, n, 'Ödeme', 'borc-odeme'); } },
  { ad: 'nakit', etiket: 'Nakit Akışı', ek: async (pg, n) => { const svg = pg.locator('[data-butce-akis-grafik]').first(); if (await svg.count()) { const k = await svg.boundingBox(); if (k) { await pg.mouse.move(k.x + k.width * 0.35, k.y + k.height * 0.5); await pg.waitForTimeout(300); await pg.locator('[data-butce-kutu]').first().screenshot({ path: path.join(CIKIS, `${n}-grafik-imlec.png`) }); await pg.mouse.move(2, 2); } } } },
  { ad: 'plan', etiket: 'Ödeme Planı' },
  { ad: 'danisman', etiket: 'Danışman' },
  { ad: 'ayarlar', etiket: 'Ayarlar', ek: async (pg, n) => { await tikla(pg, 'Önizle'); await pg.waitForTimeout(600); const k = pg.locator('[data-butce-kutu]').filter({ hasText: 'Bildirim şablonlarını test et' }).first(); if (await k.count()) await k.screenshot({ path: path.join(CIKIS, `${n}-sablon-onizleme.png`) }); } },
];
const hedefler = secilen.length ? SEKMELER.filter((s) => secilen.includes(s.ad)) : SEKMELER;

async function tikla(pg, metin) {
  const b = pg.getByRole('button', { name: metin, exact: true }).first();
  if (await b.count()) { await b.click(); await pg.waitForTimeout(400); return true; }
  return false;
}
async function pencere(pg, n, dugme, dosya) {
  if (!(await tikla(pg, dugme))) return;
  await pg.waitForTimeout(700);
  const m = pg.locator('[data-butce-modal]').first();
  if (await m.count()) await m.screenshot({ path: path.join(CIKIS, `${n}-${dosya}.png`) });
  await pg.keyboard.press('Escape');
  const kapat = pg.locator('[data-butce-modal] button[aria-label="Kapat"]').first();
  if (await kapat.count()) await kapat.click();
  await pg.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  const eksikUclar = new Set();
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 200)));
  pg.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/v1/')) eksikUclar.add(r.request().method() + ' ' + r.url().replace(/^.*\/api\/v1/, '')); });
  await pg.route(/\/api\/v1\/butce\//, async (route) => {
    const url = route.request().url();
    if (/\/api\/v1\/butce\/erisim(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ yetkili: true }) });
    return route.continue({ url: url.replace('/api/v1/butce/', '/api/v1/butce-sahte/') });
  });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'commit', timeout: 120000 });
  // Başka bir oturumun derleme hatası Next kaplamasını açabilir; giriş formunu bekle, kaplamayı kaldır.
  await pg.locator('input[type=email]').waitFor({ state: 'visible', timeout: 120000 }).catch(async () => {
    console.error('giriş formu bulunamadı; url=', pg.url(), 'inputs=', await pg.locator('input').count());
    await pg.screenshot({ path: path.join(CIKIS, '_giris-hata.png') });
    throw new Error('giriş formu yok');
  });
  await pg.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()));
  await pg.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {}); // form JS ile bağlansın (hidrasyon)
  await pg.waitForTimeout(800);
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000, waitUntil: 'commit' });
  if (TEMA !== 'D') await pg.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('moren-theme', t); } catch { /* */ } }, TEMA);
  await pg.goto(`${KOK}/panel/butce`, { waitUntil: 'networkidle', timeout: 120000 });
  if (TEMA !== 'D') await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), TEMA);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: path.join(CIKIS, '00-pin.png') });
  const pin = pg.locator('[data-butce-pin-girdi]').first();
  await pin.fill('123456');
  await pg.getByRole('button', { name: 'Aç' }).click();
  await pg.waitForTimeout(2500);
  const rapor = {};
  for (const s of hedefler) {
    hatalar.length = 0; eksikUclar.clear();
    const sekme = pg.locator('[data-butce-sekme]').filter({ hasText: s.etiket }).first();
    await sekme.click();
    await pg.waitForTimeout(2200);
    await pg.mouse.move(2, 2);
    // Dosya numarası sekmenin sabit sırası (alt küme seçilse de aynı ad)
    const no = String(SEKMELER.indexOf(s) + 1).padStart(2, '0');
    await pg.screenshot({ path: path.join(CIKIS, `${no}-${s.ad}-ilk-ekran.png`) });
    await tamSayfa(pg, path.join(CIKIS, `${no}-${s.ad}-tam.png`));
    if (typeof s.ek === 'function') { try { await s.ek(pg, no); } catch (e) { hatalar.push('ek ' + s.ad + ': ' + String(e).slice(0, 160)); } }
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[s.ad] = { hatalar: [...hatalar], eksikUclar: [...eksikUclar], yatayTasma: tasma };
  }
  console.log(JSON.stringify({ cikis: CIKIS, rapor }, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
