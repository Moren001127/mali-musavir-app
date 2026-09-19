// Ekip ekranı (Bütçe dili, 2026-09-15) — Playwright görüntüleri. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/ekip-onizleme-goruntule.cjs [cikisKlasoru]   (SAHTE_WEB_PORT ile port değişir)
// Akış: Genel bakış → İşler (boş panel) → ilk iş seçili → Dönem panosu → Kadro → görev çalıştır (SSE ~14 sn) → sürüyor → bitti → telefon.
// Sonunda konsol hataları ve yatay taşma yazdırılır (ikisi de boş/false olmalı).
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '_previews', 'ekip');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const URL = `http://localhost:${PORT}/panel/ekip`;
fs.mkdirSync(CIKIS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const hatalar = [];
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 240)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 240)));
  await pg.goto(`http://localhost:${PORT}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000 });
  await pg.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
  const daralt = pg.getByRole('button', { name: 'Sol menuyu daralt' });
  if (!process.env.MENU_ACIK && await daralt.count()) await daralt.first().click();
  await pg.waitForTimeout(1500);
  const cek = async (ad) => {
    await pg.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: true });
    const tasan = await pg.evaluate(() => [...document.querySelectorAll('main')].some(e => e.scrollWidth > e.clientWidth + 2));
    assert.equal(tasan, false, `${ad}: ana içerik yatay taşıyor`);
  };
  await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(500); await cek('01-genel-bakis');
  await pg.getByRole('tab', { name: /İşler/ }).click(); await pg.waitForTimeout(600); await cek('02-isler-bos');
  const ilk = pg.locator('button[title="İşi aç"]').first();
  assert.ok(await ilk.count(), 'İş listesi boş');
  await ilk.click(); await pg.waitForTimeout(1200);
  assert.equal(await pg.locator('section[aria-label="İşler"]').isVisible(), false, 'İş açılınca geçmiş geri çekilmeli');
  await pg.getByRole('button', { name: /İş listesine dön/ }).click();
  assert.equal(await pg.locator('section[aria-label="İşler"]').isVisible(), true, 'İş listesine dönüş çalışmalı');
  await ilk.click();
  await cek('03-isler-panel');
  await pg.getByRole('tab', { name: /Dönem panosu/ }).click(); await pg.waitForTimeout(600); await cek('04-donem-panosu');
  await pg.getByRole('tab', { name: /Kadro/ }).click(); await pg.waitForTimeout(500); await cek('05-kadro');
  assert.ok((await pg.locator('main').innerText()).includes('Koordinatör'), 'Kadro içeriği yok');
  await pg.getByRole('tab', { name: /Genel bakış/ }).click(); await pg.waitForTimeout(400);
  await pg.locator('textarea').first().fill('Ömer Özen’in Ağustos 2026 KDV kontrolünü yap');
  const istekSozu = pg.waitForRequest(r => r.method() === 'POST' && /\/ekip\/[^/]+\/calistir/.test(r.url()));
  await pg.getByRole('button', { name: /^Başlat$/ }).click();
  const istek = await istekSozu;
  assert.equal(istek.postDataJSON().dryRun, true, 'Görev kuru test olarak başlamalı');
  await pg.waitForTimeout(3500); await cek('06-kosu-suruyor');
  assert.equal(await pg.locator('section[aria-label="İşler"]').isVisible(), false, 'Çalışan iş odakta olmalı');
  await pg.getByRole('button', { name: /^Durdur$/ }).waitFor({ state: 'hidden', timeout: 45000 });
  await cek('07-kosu-bitti');
  assert.equal(await pg.getByRole('button', { name: /Ayrıntılar/ }).getAttribute('aria-expanded'), 'false', 'Ayrıntılar kendiliğinden açılmamalı');
  const tasma = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const context = await b.newContext({ storageState: await pg.context().storageState(), viewport: { width: 400, height: 900 }, deviceScaleFactor: 1 });
  const m = await context.newPage();
  await m.goto(URL, { waitUntil: 'networkidle', timeout: 120000 }); await m.waitForTimeout(1500);
  for (const [i, name] of ['Genel bakış', 'İşler', 'Dönem panosu', 'Kadro'].entries()) {
    await m.getByRole('tab', { name: new RegExp(name) }).click();
    await m.waitForTimeout(400);
    await m.screenshot({ path: path.join(CIKIS, `08-telefon-${i}.png`), fullPage: true });
    assert.equal(await m.evaluate(() => [...document.querySelectorAll('main')].some(e => e.scrollWidth > e.clientWidth + 2)), false, `Telefon ${name}: yatay taşma`);
  }
  const mobilTasma = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  // Sıraya alınan cevap sekme değişince kaybolmamalı ve aynı işe gitmeli.
  await pg.getByRole('tab', { name: /Genel bakış/ }).click();
  await pg.getByRole('textbox', { name: 'Görev', exact: true }).fill('Kuyruk ve durdurma denemesi');
  await pg.getByRole('button', { name: /^Başlat$/ }).click();
  await pg.getByRole('button', { name: /^Durdur$/ }).waitFor();
  await pg.waitForTimeout(1000);
  const akis = await (await pg.request.get('http://localhost:3006/api/v1/ekip/akis')).json();
  const hedefId = akis.vakalar.find(v => v.konu === 'Kuyruk ve durdurma denemesi').vakaId;
  await pg.route('**/ekip/isler/*/iptal', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Deneme: iptal reddedildi' }) }));
  await pg.getByRole('button', { name: /^Durdur$/ }).click();
  await pg.getByText('İş durdurulamadı. İlerleme izlenmeye devam ediyor.', { exact: true }).waitFor();
  assert.ok(await pg.getByRole('button', { name: /^Durdur$/ }).isVisible(), 'Reddedilen iptal işi bitmiş göstermemeli');
  await pg.route('**/ekip/koordinator/calistir', async route => {
    if (!route.request().postDataJSON().gorev.startsWith('Cevap:')) return route.continue();
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({type:'baslangic',isId:hedefId,ajanId:'koordinator',dryRun:true})}\n\ndata: ${JSON.stringify({type:'done',isId:hedefId,toolUses:[],durationMs:1})}\n\n` });
  });
  const cevapIstegi = pg.waitForRequest(r => r.method() === 'POST' && /\/ekip\/koordinator\/calistir/.test(r.url()) && r.postDataJSON().gorev === 'Cevap: Kuyruktaki not', { timeout: 45000 });
  await pg.getByRole('textbox', { name: 'İş için not veya talimat' }).fill('Kuyruktaki not');
  await pg.getByRole('button', { name: /Bitince gönder/ }).click();
  await pg.getByRole('tab', { name: /Kadro/ }).click();
  const cevap = (await cevapIstegi).postDataJSON();
  assert.equal(cevap.vakaId, hedefId, 'Cevap özgün işe gönderilmeli');
  assert.equal(cevap.dryRun, true, 'Cevap çalışma modunu korumalı');
  console.log(JSON.stringify({ hatalar, yatayTasma: tasma, mobilTasma, cikis: CIKIS }, null, 1));
  await b.close();
  assert.deepEqual(hatalar, [], 'Tarayıcı hatası var');
  assert.equal(tasma, false);
  assert.equal(mobilTasma, false);
})().catch((e) => { console.error(e); process.exit(1); });
