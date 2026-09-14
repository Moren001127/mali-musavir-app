// Aylık Ödeme Listesi — Playwright ile ekran görüntüleri + istek gövdesi doğrulaması (sahte API 3001 + web 3000 açık olmalı)
// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan) + pnpm --filter @mali-musavir/web dev, sonra
//          node apps/web/scripts/aylik-odeme-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/aylik-odeme)
// Tarayıcı: apps/luca-local-agent/node_modules/playwright (Chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/aylik-odeme');
fs.mkdirSync(CIKIS, { recursive: true });
const KOK = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hatalar = [];
  const kontroller = [];
  const kontrol = (ad, ok, ek) => {
    kontroller.push(`${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`);
    if (!ok) hatalar.push(`KONTROL: ${ad}${ek ? ' — ' + ek : ''}`);
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) hatalar.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => hatalar.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

  // İstek günlüğü (gövde dâhil)
  const istekler = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/v1/aylik-odeme') || u.includes('/taxpayer-portal/')) istekler.push({ yontem: r.method(), url: u.replace('http://localhost:3001/api/v1', ''), govde: r.postData() });
  });
  const sonIstek = (yontem, parca) => [...istekler].reverse().find((i) => i.yontem === yontem && i.url.includes(parca));

  const yatay = async (ad) => {
    const r = await page.evaluate(() => {
      const m = document.querySelector('[data-panel-main]');
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: m ? m.scrollWidth - m.clientWidth : 0 };
    });
    if (r.doc > 0 || r.main > 0) hatalar.push(`YATAY TAŞMA (${ad}): belge ${r.doc}px, ana alan ${r.main}px`);
  };
  const cek = async (ad, tam = true) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(CIKIS, `${ad}.png`), fullPage: tam });
    await yatay(ad);
    console.log('  ✓', ad);
  };

  // Sahte API bellek durumunu sıfırla (gönderimler, SGK-yok, otomatik ayar) — betik tekrar koşulabilsin
  await fetch('http://localhost:3001/api/v1/aylik-odeme/__sifirla', { method: 'POST' }).catch(() => {});

  // ── Giriş (/giris/musavir — sahte API her e-posta/şifreyi kabul eder) ──
  await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle' });
  await page.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await page.locator('input[type=password]').fill('deneme123');
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL(/\/panel/, { timeout: 30000 });

  // ── Aylık Ödeme Listesi ──
  await page.goto(`${KOK}/panel/aylik-odeme`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="cetvel"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  await cek('01-genel-1400');

  // Özet şeridi + test bandı
  kontrol('Özet şeridi: mükellef hapı', await page.getByRole('button', { name: /mükellef$/ }).count() > 0);
  kontrol('Özet şeridi: gönderildi/bekliyor/hata hapları', (await page.getByRole('button', { name: /gönderildi$/ }).count()) === 1 && (await page.getByRole('button', { name: /bekliyor$/ }).count()) === 1 && (await page.getByRole('button', { name: /hata$/ }).count()) === 1);
  kontrol('Özet şeridi: en yakın son gün', (await page.getByText(/En yakın son gün/).count()) > 0);
  kontrol('TEST MODU bandı', (await page.getByTestId('test-bandi').count()) === 1);
  kontrol('Gönder düğmesi test modunda "Test alıcısına gönder (N)"', (await page.getByRole('button', { name: /Test alıcısına gönder \(\d+\)/ }).count()) === 1);

  // Hap süzgeci: bekliyor → liste küçülür
  const listeSayisi = async () => page.locator('[data-testid="mukellef-listesi"] [role=option]').count();
  const tumu = await listeSayisi();
  await page.getByRole('button', { name: /bekliyor$/ }).click();
  await page.waitForTimeout(300);
  const bekleyen = await listeSayisi();
  kontrol('Hap "bekliyor" listeyi süzdü', bekleyen > 0 && bekleyen < tumu, `${bekleyen}/${tumu}`);
  await cek('02-hap-bekliyor', false);
  await page.getByRole('button', { name: /hata$/ }).click();
  await page.waitForTimeout(300);
  kontrol('Hap "hata" → 1 mükellef', (await listeSayisi()) === 1);
  await page.getByRole('button', { name: /mükellef$/ }).click();
  await page.waitForTimeout(300);
  kontrol('Hap "mükellef" süzgeci sıfırladı', (await listeSayisi()) === tumu);

  // Süzgeç menüsü
  await page.getByTitle('Listeyi süz').click();
  await page.waitForTimeout(250);
  await cek('03-suzgec-menusu', false);
  await page.getByRole('menuitem', { name: 'Yalnız SGK' }).click();
  await page.waitForTimeout(300);
  const sgk = await listeSayisi();
  kontrol('Süzgeç "Yalnız SGK"', sgk > 0 && sgk < tumu, `${sgk}/${tumu}`);
  await page.getByTitle('Listeyi süz').click();
  await page.getByRole('menuitem', { name: 'Eksiği olan' }).click();
  await page.waitForTimeout(300);
  kontrol('Süzgeç "Eksiği olan"', (await listeSayisi()) === 3, String(await listeSayisi()));
  await page.getByTitle('Listeyi süz').click();
  await page.getByRole('menuitem', { name: 'Tümü' }).click();

  // Arama + sıralama
  await page.getByLabel('Mükellef ara').fill('fam');
  await page.waitForTimeout(300);
  kontrol('Arama "fam" → 1', (await listeSayisi()) === 1);
  await page.getByLabel('Mükellef ara').fill('');
  await page.getByLabel('Sıralama').click();
  await page.waitForTimeout(300);
  const ilkAd = await page.locator('[data-testid="mukellef-listesi"] [role=option]').first().innerText();
  kontrol('Tutara göre sıralama (en büyük üstte: Famcoffee)', /Famcoffee/.test(ilkAd), ilkAd.split('\n')[0]);
  await page.getByLabel('Sıralama').click();

  // Mükellef seçimi: Famcoffee (geçici + yıllık + SGK; 1/2 taksit; fiş bağlantısı)
  await page.getByRole('option', { name: /Famcoffee/ }).click();
  await page.waitForTimeout(400);
  const cetvel = page.getByTestId('cetvel');
  kontrol('Cetvel: seçili mükellef Famcoffee', /Famcoffee/.test(await cetvel.locator('h2').innerText()));
  kontrol('Cetvel: 4 grup bandı (aylık/geçici/yıllık/SGK)', (await cetvel.locator('tr[data-grup]').count()) === 4);
  kontrol('Cetvel: taksit etiketi', (await cetvel.getByText(/taksit/).count()) > 0);
  kontrol('Cetvel: hafta sonu kaydırma ipucu', (await cetvel.getByText('hafta sonu → ilk iş günü').count()) > 0);
  kontrol('Cetvel: ara toplam', (await cetvel.getByText(/ara toplam/).count()) === 4);
  await cek('04-mukellef-famcoffee', false);

  // Telefonsuz mükellef ipucu (Mert Reklam)
  kontrol('Listede telefonsuz mükellef ⚠ ipucu', (await page.locator('[data-testid="mukellef-listesi"] [aria-label^="Telefon yok"]').count()) >= 1);

  // Gönderilmiş mükellef → "Yeniden gönder" + son gönderim
  await page.getByRole('option', { name: /Ayşegül Kaya/ }).click();
  await page.waitForTimeout(400);
  kontrol('Gönderilmiş mükellefte "Yeniden gönder"', (await cetvel.getByRole('button', { name: /Yeniden gönder/ }).count()) === 1);
  kontrol('Son gönderim tarihi', (await cetvel.getByText(/son gönderim/).count()) === 1);
  await cek('05-gonderilmis-mukellef', false);

  // Tek mükellef gönderimi → gövde {month, taxpayerId, mod:'yeniden'}
  await cetvel.getByRole('button', { name: /Yeniden gönder/ }).click();
  await page.waitForTimeout(900);
  {
    const i = sonIstek('POST', '/aylik-odeme/send');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /send (mükellef) gövdesi mod=yeniden + taxpayerId', !!g && g.mod === 'yeniden' && g.taxpayerId === 'm3' && /^\d{4}-\d{2}$/.test(g.month), i && i.govde);
  }

  // Bekleyen mükellef gönderimi → mod:'gonderilmemis'
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  await cetvel.getByRole('button', { name: /ile gönder/ }).click();
  await page.waitForTimeout(900);
  {
    const i = sonIstek('POST', '/aylik-odeme/send');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /send (bekleyen mükellef) mod=gonderilmemis', !!g && g.mod === 'gonderilmemis' && g.taxpayerId === 'm1', i && i.govde);
  }
  kontrol('Gönderim sonrası liste yenilendi (Öz Ela ✓)', /Yeniden gönder/.test(await cetvel.innerText()));

  // Şablonu bana gönder → POST ornek-gonder
  await cetvel.getByRole('button', { name: /Şablonu bana gönder/ }).click();
  await page.waitForTimeout(700);
  {
    const i = sonIstek('POST', '/aylik-odeme/ornek-gonder');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /ornek-gonder {month, taxpayerId}', !!g && g.taxpayerId === 'm1' && !!g.month, i && i.govde);
  }

  // Toplu gönder (test modu → onay penceresi yok) → mod:'gonderilmemis', taxpayerId yok
  await page.getByRole('button', { name: /Test alıcısına gönder \(\d+\)/ }).click();
  await page.waitForTimeout(1000);
  {
    const i = sonIstek('POST', '/aylik-odeme/send');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /send (toplu) mod=gonderilmemis, taxpayerId yok', !!g && g.mod === 'gonderilmemis' && !('taxpayerId' in g), i && i.govde);
  }

  // Menü: Hepsine yeniden gönder (onay otomatik kabul) → mod:'hepsi'
  await page.getByTitle('Diğer işlemler').click();
  await page.waitForTimeout(250);
  await cek('06-baslik-menusu', false);
  await page.getByRole('menuitem', { name: 'Hepsine yeniden gönder' }).click();
  await page.waitForTimeout(1000);
  {
    const i = sonIstek('POST', '/aylik-odeme/send');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /send (hepsine yeniden) mod=hepsi', !!g && g.mod === 'hepsi', i && i.govde);
  }

  // Excel (ay) → GET /aylik-odeme/excel?month=
  await page.getByTitle('Diğer işlemler').click();
  const indirme1 = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.getByRole('menuitem', { name: /^Excel/ }).click();
  const d1 = await indirme1;
  kontrol('GET /aylik-odeme/excel?month=', !!sonIstek('GET', '/aylik-odeme/excel?month='), sonIstek('GET', '/aylik-odeme/excel') && sonIstek('GET', '/aylik-odeme/excel').url);
  kontrol('Excel indirme dosya adı', !!d1 && /aylik-odeme-\d{4}-\d{2}\.xlsx/.test(d1.suggestedFilename()), d1 && d1.suggestedFilename());

  // PDF (seçili mükellef) → GET /aylik-odeme/pdf?month=&taxpayerId=
  const indirme2 = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await cetvel.getByRole('button', { name: /^PDF$/ }).click();
  const d2 = await indirme2;
  {
    const i = sonIstek('GET', '/aylik-odeme/pdf');
    kontrol('GET /aylik-odeme/pdf?month=&taxpayerId=', !!i && /taxpayerId=m1/.test(i.url) && /month=/.test(i.url), i && i.url);
    kontrol('PDF indirme dosya adı', !!d2 && /\.pdf$/.test(d2.suggestedFilename()), d2 && d2.suggestedFilename());
  }

  // Tüm mükellefler PDF → taxpayerId yok
  await page.getByTitle('Diğer işlemler').click();
  const indirme3 = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.getByRole('menuitem', { name: 'Tüm mükellefler PDF' }).click();
  await indirme3;
  {
    const i = sonIstek('GET', '/aylik-odeme/pdf');
    kontrol('GET /aylik-odeme/pdf (tüm) taxpayerId yok', !!i && !/taxpayerId=/.test(i.url), i && i.url);
  }

  // Yazdır → PDF yeni sekmede (window.print YOK). Başsız Chromium'da PDF görüntüleyici olmadığından blob adresine geçiş
  // ERR_ABORTED verir; görünür tarayıcıda (headless:false) sekme blob:… PDF'e gider — 2026-09-14 elle doğrulandı.
  const yeniSayfa = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  const pdfIstek = page.waitForRequest((r) => r.url().includes('/aylik-odeme/pdf') && r.url().includes('taxpayerId='), { timeout: 8000 }).catch(() => null);
  await cetvel.getByRole('button', { name: /Yazdır/ }).click();
  const sekme = await yeniSayfa;
  const pi = await pdfIstek;
  await page.waitForTimeout(600);
  kontrol('Yazdır: tıklama anında yeni sekme + GET /aylik-odeme/pdf (window.print yok)', !!sekme && !!pi, pi && pi.url().replace('http://localhost:3001/api/v1', ''));
  if (sekme) await sekme.close().catch(() => {});

  // Otomatik gönderim kartı → PUT /aylik-odeme/otomatik
  const kart = page.getByTestId('otomatik-kart');
  await kart.scrollIntoViewIfNeeded();
  await kart.getByTitle('Otomatik gönderim').click();
  await kart.getByLabel('Gün').selectOption('25');
  await kart.getByLabel('Saat').selectOption('10');
  await page.waitForTimeout(200);
  await cek('07-otomatik-kart', false);
  await kart.getByRole('button', { name: /Kaydet/ }).click();
  await page.waitForTimeout(800);
  {
    const i = sonIstek('PUT', '/aylik-odeme/otomatik');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('PUT /aylik-odeme/otomatik {aktif:true, gun:25, saat:10, onayGerekli:true}', !!g && g.aktif === true && g.gun === 25 && g.saat === 10 && g.onayGerekli === true, i && i.govde);
  }

  // Eksikler paneli + SGK'sı yok → POST /aylik-odeme/eksik/sgk-yok
  const eksik = page.getByTestId('eksikler-paneli');
  await eksik.scrollIntoViewIfNeeded();
  await eksik.locator('button').first().click();
  await page.waitForTimeout(400);
  await cek('08-eksikler-acik', false);
  const sgkYokOnce = await eksik.getByRole('button', { name: /SGK'sı yok/ }).count();
  await eksik.getByRole('button', { name: /SGK'sı yok/ }).first().click();
  await page.waitForTimeout(900);
  {
    const i = sonIstek('POST', '/aylik-odeme/eksik/sgk-yok');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /eksik/sgk-yok {taxpayerId}', !!g && typeof g.taxpayerId === 'string' && g.taxpayerId.length > 0, i && i.govde);
    const sonra = await eksik.getByRole('button', { name: /SGK'sı yok/ }).count();
    kontrol('Eksikler yenilendi (SGK satırı düştü)', sonra === sgkYokOnce - 1, `${sgkYokOnce} → ${sonra}`);
  }

  // Ay gezinme
  const ayGirdi = page.getByLabel('Ay', { exact: true });
  const ayOnce = await ayGirdi.inputValue();
  await page.getByTitle('Önceki ay').click();
  await page.waitForTimeout(900);
  const aySonra = await ayGirdi.inputValue();
  kontrol('Önceki ay gezinmesi', ayOnce !== aySonra && !!sonIstek('GET', `/aylik-odeme?month=${aySonra}`), `${ayOnce} → ${aySonra}`);
  await cek('09-onceki-ay', false);
  await page.getByRole('button', { name: /Bu ay/ }).click();
  await page.waitForTimeout(600);
  kontrol('"Bu ay" düğmesi', (await ayGirdi.inputValue()) === ayOnce);

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('10-genel-1000');
  await page.getByRole('option', { name: /Famcoffee/ }).click();
  await cetvel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cek('10b-cetvel-1000', false);

  // ── Mükellef portalı: Bu Ayki Ödemelerim ──
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${KOK}/giris/mukellef`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('moren_taxpayer_token', 'sahte-mukellef-token'));
  await page.goto(`${KOK}/mukellef`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Bu Ayki Ödemelerim', { timeout: 30000 });
  await page.waitForTimeout(800);
  const portalIstek = sonIstek('GET', '/taxpayer-portal/odeme-cetveli');
  kontrol('Portal GET /taxpayer-portal/odeme-cetveli?month=', !!portalIstek && /month=\d{4}-\d{2}/.test(portalIstek.url), portalIstek && portalIstek.url);
  const bolum = page.locator('section', { hasText: 'Bu Ayki Ödemelerim' }).first();
  kontrol('Portal: ödeme satırları + toplam', (await bolum.locator('tbody tr').count()) >= 4 && (await bolum.getByText(/Toplam/).count()) > 0);
  kontrol('Portal: fişi gör düğmesi', (await bolum.getByTitle('Fişi gör').count()) >= 0);
  await bolum.scrollIntoViewIfNeeded();
  await cek('11-mukellef-portali-1400', false);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(500);
  await bolum.scrollIntoViewIfNeeded();
  await cek('12-mukellef-portali-1000', false);

  await browser.close();
  console.log('\n' + kontroller.join('\n'));
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok, tüm kontroller geçti');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
