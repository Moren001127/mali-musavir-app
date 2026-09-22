// Genel Sorgulamalar (beyaz tema, Hattat düzeni) görüntüleri — sahte çift KENDİ portlarında:
//   SAHTE_API_PORT=3022 SAHTE_WEB_PORT=3023 node apps/web/scripts/dev-sahte-kart.cjs
//   node apps/web/scripts/onizleme/genel-sorgular-goruntule.cjs [cikisKlasoru]
// Sahte veri: scripts/mock/oncelik/genel-sorgular.cjs (öncelikli eklenti). Çıktılar _previews/genel-sorgular/:
//   01-tam · 02-sorgu-kurulumu · 03-tablo-detay · 03b-diger-detaylar · 03c-tutanak-penceresi · 04-kart-salterler
//   05-kosu-kuyruk / 05b-kosu-calisiyor / 05c-kosu-bitti · 06-suzgec-earsiv · 07-bos-durum · renk-1..4
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');

const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'genel-sorgular');
const PORT = process.env.SAHTE_WEB_PORT || '3023';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });

/** Kaydıran zinciri gevşetip sayfanın üstten `yukseklik` px'lik kısmını çeker (renk varyantı karşılaştırması). */
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
  await pg.screenshot({ path: dosya, fullPage: true, clip: { x: 0, y: 0, width: 1500, height: yukseklik } });
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
    await pg.waitForTimeout(15000); // paralel derleme geçici 500
  }
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(2500);
}

/** Sorgu Kurulumu'nda örnek seçim yap (vurgu rengi görünsün): 2 mükellef + 3 tür. */
async function ornekSecim(pg) {
  const satirlar = pg.locator('.gs-liste-satir');
  await satirlar.filter({ hasText: 'EDELER' }).first().click();
  await satirlar.filter({ hasText: 'SEDA' }).first().click();
  const onaylar = pg.locator('.gs-onay');
  await onaylar.filter({ hasText: 'Vergi Borcu' }).click();
  await onaylar.filter({ hasText: 'e-Haciz' }).click();
  await onaylar.filter({ hasText: 'POS Bilgisi' }).click();
  await pg.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  // Elle sorgu: oncelik/edefter-takip.cjs aynı POST ucunu önce yakalıyor → bu modülün sahte ucuna yönlendir.
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

  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular`);
  await pg.locator('.gs').first().waitFor({ state: 'visible', timeout: 30000 });
  await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });

  // 1) Tam sayfa (varsayılan renk 1)
  await tamSayfa(pg, path.join(CIKIS, '01-tam.png'));

  // 2) Sorgu Kurulumu yakın plan (örnek seçimle)
  await ornekSecim(pg);
  await tamSayfa(pg, path.join(CIKIS, '02-sorgu-kurulumu.png'), '[data-gs-kart="kurulum"]');

  // 3) Vergi Borcu tablosunda ilk satır açık (kalemler)
  const borcGrubu = pg.locator('[data-gs-grup="VERGI_BORCU"]');
  await borcGrubu.locator('tr.gs-satir').first().click();
  await pg.waitForTimeout(400);
  await tamSayfa(pg, path.join(CIKIS, '03-tablo-detay.png'), '[data-gs-grup="VERGI_BORCU"]');
  // 3b) e-Haciz + yoklama detayları da (tek görüntü, sonuç kartı)
  await pg.locator('[data-gs-grup="E_HACIZ"] tr.gs-satir').first().click();
  await pg.locator('[data-gs-grup="YOKLAMA_DENETIM"] tr.gs-satir').first().click();
  await pg.waitForTimeout(400);
  await tamSayfa(pg, path.join(CIKIS, '03b-diger-detaylar.png'), '[data-gs-kart="sonuclar"]');
  // Yoklama tutanağı penceresi
  const tutanak = pg.locator('[data-gs-grup="YOKLAMA_DENETIM"] button', { hasText: 'Tutanağı aç' }).first();
  if (await tutanak.count()) {
    await tutanak.click();
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: path.join(CIKIS, '03c-tutanak-penceresi.png') });
    await pg.keyboard.press('Escape');
    await pg.locator('[data-pa-modal="pdf"] button[aria-label="Kapat"]').click({ timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(300);
  }

  // 4 renk varyantı — aynı görünüm (örnek seçim + Sorgu Kurulumu + ilk iki tablo); koşu testinden ÖNCE ki veri temiz kalsın
  for (const renk of ['1', '2', '3', '4']) {
    await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?renk=${renk}`);
    await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });
    await ornekSecim(pg);
    await ustKesit(pg, path.join(CIKIS, `renk-${renk}.png`), 2100);
  }


  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular`);
  await pg.locator('.gs-grup').first().waitFor({ state: 'visible', timeout: 30000 });
  await ornekSecim(pg);

  // 5) Sorgula → koşu şeridi (kuyrukta → çalışıyor → tamamlandı)
  await pg.locator('[data-gs-sorgula]').click();
  await pg.waitForTimeout(1500);
  await tamSayfa(pg, path.join(CIKIS, '05-kosu-kuyruk.png'), '[data-gs-kart="kurulum"]');
  await pg.waitForTimeout(9000);
  await tamSayfa(pg, path.join(CIKIS, '05b-kosu-calisiyor.png'), '[data-gs-kart="kurulum"]');
  await pg.waitForTimeout(14000);
  await tamSayfa(pg, path.join(CIKIS, '05c-kosu-bitti.png'), '[data-gs-kart="kurulum"]');

  // 6) Süzgeç: yalnız EDELER + Gelen e-Arşiv + Ağustos 2026
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=gs1&tur=GELEN_EARSIV&donem=2026-08`);
  await pg.locator('[data-gs-grup="GELEN_EARSIV"] tr.gs-satir').first().click();
  await pg.waitForTimeout(400);
  await tamSayfa(pg, path.join(CIKIS, '06-suzgec-earsiv.png'));

  // 7) Boş durum: sonucu olmayan mükellef (Ela Tekstil) → her türde kesik çizgili kutu
  await sayfayaGit(pg, `${KOK}/panel/genel-sorgular?mukellef=m6`);
  await tamSayfa(pg, path.join(CIKIS, '07-bos-durum.png'), '[data-gs-kart="sonuclar"]');

  // 4) Mükellef kartı — Otomatik Sorgulama Ayarı (7 şalter)
  await sayfayaGit(pg, `${KOK}/panel/mukellefler/m7`);
  const bolum = pg.getByText('Otomatik Sorgulama Ayarı', { exact: false }).first();
  await bolum.waitFor({ state: 'visible', timeout: 30000 });
  await bolum.click();
  await pg.waitForTimeout(600);
  const salterler = pg.locator('[data-otomatik-sorgu]').first();
  await salterler.waitFor({ state: 'visible', timeout: 15000 });
  // bir şalteri aç (kaydedildi mesajı) — e-Haciz
  await salterler.locator('button[data-sorgu="eHaciz"]').click();
  await pg.waitForTimeout(800);
  const kutu = await salterler.boundingBox();
  if (kutu) {
    await pg.mouse.move(2, 2);
    await pg.screenshot({ path: path.join(CIKIS, '04-kart-salterler.png'), clip: { x: Math.max(0, kutu.x - 40), y: Math.max(0, kutu.y - 90), width: Math.min(1500 - Math.max(0, kutu.x - 40), kutu.width + 80), height: kutu.height + 120 } });
  }

  console.log(JSON.stringify({ cikis: CIKIS }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
