// SGK Otomasyonu › "Rapor · İş Kazası · Giriş-Çıkış" bölümü görüntüleri (2026-09-26) — sahte çift KENDİ portlarında:
//   SAHTE_API_PORT=3042 SAHTE_WEB_PORT=3043 node apps/web/scripts/dev-sahte-kart.cjs
//   SAHTE_API_PORT=3042 SAHTE_WEB_PORT=3043 node apps/web/scripts/onizleme/sgk-rapor-goruntule.cjs [cikisKlasoru]
// Sahte veri: scripts/mock/oncelik/sgk-vizite.cjs (her genişlik turunun başında /sahte/sgk-vizite/sifirla ile sıfırlanır).
// Genişlikler: 1760 (Muzaffer Bey'in gerçek penceresi) ve 1366. Çıktılar _previews/sgk-rapor/<genislik>-NN-*.png:
//   01-bildirgeler (1. sekme bozulmadı mı) · 02-rapor-tam (yeni sekme baştan sona) · 03-onaylanmis (rapor kartı)
//   04-onay-penceresi · 05-onay-hata (SGK 802) · 06-personelim-degil · 07-sorgu-hatalari
//   yalnız 1760: 08-sorgu-onayi · 09-sorgu-suruyor · 10-onay-basarili · 11-onay-sonrasi · 12-mukellef-bos · 13-uc-yok
// Her turda tablo taşması ölçülür (sarmalayıcıdan geniş tablo / kırpılan hücre) ve konsola yazılır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');

const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'sgk-rapor');
const WEB = `http://localhost:${process.env.SAHTE_WEB_PORT || '3043'}`;
const API = `http://localhost:${process.env.SAHTE_API_PORT || '3042'}/api/v1`;
fs.mkdirSync(CIKIS, { recursive: true });

async function sayfayaGit(pg, adres) {
  for (let deneme = 0; deneme < 4; deneme++) {
    const yanit = await pg.goto(adres, { waitUntil: 'networkidle', timeout: 180000 });
    if (yanit && yanit.status() < 500) break;
    await pg.waitForTimeout(15000);
  }
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(1500);
}

async function tasmaOlc(pg, etiket) {
  const sonuc = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-sr-tablo]').forEach((t, i) => {
      const sar = t.parentElement;
      const tablo = { tablo: i, tabloGen: Math.round(t.getBoundingClientRect().width), sarGen: sar.clientWidth, tasiyor: t.scrollWidth > sar.clientWidth + 1 };
      const kirpik = [];
      t.querySelectorAll('td, th').forEach((c) => { if (c.scrollWidth > c.clientWidth + 1) kirpik.push(`${c.tagName} "${c.textContent.trim().slice(0, 40)}" ${c.scrollWidth}>${c.clientWidth}`); });
      tablo.kirpikHucre = kirpik;
      out.push(tablo);
    });
    return out;
  });
  console.log(`[${etiket}] tablolar:`, JSON.stringify(sonuc));
}

const satirDugmesi = (pg, ad, tur) => pg.locator('tr[data-sr-satir]', { hasText: ad }).locator(`[data-sr-btn="${tur}"]`);

async function tur(tarayici, genislik) {
  await fetch(`${API}/sahte/sgk-vizite/sifirla`, { method: 'POST' });
  const ctx = await tarayici.newContext({ viewport: { width: genislik, height: 1000 }, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const pg = await ctx.newPage();
  const dosya = (ad) => path.join(CIKIS, `${genislik}-${ad}.png`);

  await pg.goto(`${WEB}/giris/musavir`, { waitUntil: 'networkidle', timeout: 180000 });
  await pg.locator('input[type=email]').waitFor({ timeout: 120000 });
  await pg.waitForTimeout(1000);
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 90000 });

  // 01 — Bildirgeler sekmesi (varsayılan, adreste bolum yok)
  await sayfayaGit(pg, `${WEB}/panel/ajanlar/sgk`);
  await pg.locator('[data-pa-module="sgk"] table').waitFor({ timeout: 60000 });
  await pg.waitForTimeout(800);
  await tamSayfa(pg, dosya('01-bildirgeler'));

  // 02 — sekmeye tıklayarak yeni bölüm (adres ?bolum=rapor olmalı), baştan sona
  await pg.locator('[data-sr-sekme]', { hasText: 'Rapor' }).click();
  await pg.waitForURL(/bolum=rapor/, { timeout: 30000 });
  await pg.locator('[data-sr-kart="rapor"] [data-sr-tablo]').waitFor({ timeout: 60000 });
  await pg.locator('[data-sr-kart="kaza"] [data-sr-tablo]').waitFor({ timeout: 60000 });
  await pg.waitForTimeout(1200);
  await tasmaOlc(pg, `${genislik} bekleyen+kaza`);
  await tamSayfa(pg, dosya('02-rapor-tam'));

  // 03 — Onaylanmış listesi (rapor kartı)
  await pg.locator('[data-sr-ikili-dugme]', { hasText: 'Onaylanmış' }).click();
  await pg.locator('[data-sr-kart="rapor"] tr[data-sr-satir]', { hasText: 'BURAK YILDIZ' }).waitFor({ timeout: 30000 });
  await pg.waitForTimeout(600);
  await tasmaOlc(pg, `${genislik} onaylanan`);
  await tamSayfa(pg, dosya('03-onaylanmis'), '[data-sr-kart="rapor"]');
  await pg.locator('[data-sr-ikili-dugme]', { hasText: 'Onay bekleyen' }).click();
  await pg.waitForTimeout(500);

  // 04 — Onay penceresi (varsayılan bitiş = en geç onay günü, "Çalışmamıştır")
  await satirDugmesi(pg, 'SELİN ARSLAN', 'onayla').click();
  await pg.locator('[data-sr-pencere="sgk-onay"]').waitFor();
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: dosya('04-onay-penceresi') });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);

  // 05 — SGK reddi (sahte: MURAT KILIÇ → 802), pencere açık kalır
  await satirDugmesi(pg, 'MURAT KILIÇ', 'onayla').click();
  await pg.locator('[data-sr-pencere="sgk-onay"]').waitFor();
  await pg.locator('[data-sr-pencere="sgk-onay"] [data-pa-btn="birincil"]').click();
  await pg.locator('[data-sr-sonuc="hata"]').waitFor({ timeout: 15000 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: dosya('05-onay-hata') });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);

  // 06 — Personelim Değil onayı
  await satirDugmesi(pg, 'ELİF ŞAHİN', 'personel').click();
  await pg.locator('[data-sr-pencere="sgk-personel"]').waitFor();
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: dosya('06-personelim-degil') });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);

  // 07 — "1 mükellefte sorgu yapılamadı" → hata listesi
  await pg.locator('[data-sr-hata-link]').click();
  await pg.locator('[data-sr-pencere="hata"] [data-pa-hata-satir]').first().waitFor({ timeout: 15000 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: dosya('07-sorgu-hatalari') });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(400);

  if (genislik === 1760) {
    // 08 — "Şimdi sorgula" (tüm mükellefler) onayı
    await pg.locator('[data-sr-arac] [data-pa-btn="birincil"]').click();
    await pg.locator('[data-sr-pencere="sgk-sorgu"]').waitFor();
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: dosya('08-sorgu-onayi') });
    // 09 — sorgu sürüyor (ilerleme 5 sn'de bir tazelenir)
    await pg.locator('[data-sr-pencere="sgk-sorgu"] [data-pa-btn="birincil"]').click();
    await pg.locator('[data-sr-suruyor]').waitFor({ timeout: 15000 });
    await pg.waitForTimeout(5600);
    await pg.mouse.move(2, 2);
    await pg.locator('[data-sr-arac]').screenshot({ path: dosya('09-sorgu-suruyor') });
    // 10 — başarılı onay (sahte: SELİN ARSLAN), sonra pencere kendiliğinden kapanır ve liste tazelenir
    await satirDugmesi(pg, 'SELİN ARSLAN', 'onayla').click();
    await pg.locator('[data-sr-pencere="sgk-onay"]').waitFor();
    await pg.locator('[data-sr-pencere="sgk-onay"] [data-pa-btn="birincil"]').click();
    await pg.locator('[data-sr-sonuc="basarili"]').waitFor({ timeout: 15000 });
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: dosya('10-onay-basarili') });
    await pg.locator('[data-sr-pencere="sgk-onay"]').waitFor({ state: 'detached', timeout: 10000 });
    await pg.waitForTimeout(1500);
    await tamSayfa(pg, dosya('11-onay-sonrasi'), '[data-sr-kart="rapor"]');

    // 12 — mükellef seçili, onay bekleyeni ve iş kazası olmayan işyeri: boş durum satırları
    await pg.locator('[data-sr-arac] select[aria-label="Mükellef"]').selectOption('m6');
    await pg.locator('[data-sr-kart="rapor"] [data-sr-durum-satiri]').waitFor({ timeout: 15000 });
    await pg.waitForTimeout(1200);
    await tamSayfa(pg, dosya('12-mukellef-bos'));

    // 13 — sunucuda /sgk-vizite uçları yokken (henüz yayına alınmadıysa) sayfa nasıl görünür
    await pg.route('**/api/v1/sgk-vizite/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Cannot GET"}' }));
    await sayfayaGit(pg, `${WEB}/panel/ajanlar/sgk?bolum=rapor`);
    await pg.locator('[data-sr-durum-satiri="hata"]').first().waitFor({ timeout: 30000 });
    await pg.waitForTimeout(800);
    await tamSayfa(pg, dosya('13-uc-yok'));
    await pg.unroute('**/api/v1/sgk-vizite/**');
  }
  await ctx.close();
}

(async () => {
  const tarayici = await chromium.launch();
  for (const g of [1760, 1366]) await tur(tarayici, g);
  await tarayici.close();
  console.log('bitti →', CIKIS);
})().catch((e) => { console.error(e); process.exit(1); });
