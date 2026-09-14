// İletim Raporu — Playwright ile ekran görüntüleri + davranış/istek doğrulaması (sahte API 3001 + web 3000 açık olmalı)
// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan) + pnpm --filter @mali-musavir/web dev, sonra
//          node apps/web/scripts/iletim-raporu-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/iletim-raporu)
// Tarayıcı: apps/luca-local-agent/node_modules/playwright (Chromium)
// Kontroller: sarı/altın DOLGU yok, tabloda ikon yok, her hücre düz yazı, konsol hatası 0, yatay taşma yok,
//             özet sayıları ve hücre metinleri sahte veriyle birebir, hap/süzgeç/arama, satır ve toplu yeniden deneme istekleri.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/iletim-raporu');
fs.mkdirSync(CIKIS, { recursive: true });
const KOK = process.env.WEB_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hatalar = [];
  const kontroller = [];
  const kontrol = (ad, ok, ek) => {
    kontroller.push(`${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`);
    if (!ok) hatalar.push(`KONTROL: ${ad}${ek ? ' — ' + ek : ''}`);
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) hatalar.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => hatalar.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

  // Web'in gerçekten çağırdığı API adresi (NEXT_PUBLIC_API_URL farklı bir sahte API'ye — ör. 3002 — bakabilir)
  let API = 'http://localhost:3001/api/v1';
  let apiBulundu = false;
  const istekler = [];
  page.on('request', (r) => {
    const u = r.url();
    const m = /^(https?:\/\/[^/]+\/api\/v1)\//.exec(u);
    if (m && !apiBulundu) { API = m[1]; apiBulundu = true; }
    if (u.includes('/api/v1/akilli-bildirim')) istekler.push({ yontem: r.method(), url: u.replace(API, ''), govde: r.postData() });
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

  // ── Giriş (sahte API her e-posta/şifreyi kabul eder) ──
  // Geliştirme sunucusu yeniden derlerken (HMR) form tarayıcıca gönderilebiliyor; 3 deneme.
  let girisOldu = false;
  for (let deneme = 1; deneme <= 3 && !girisOldu; deneme++) {
    await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle' });
    // React henüz takılmamışken (hydration) formu tarayıcı kendi gönderir (?email=…) — takılmasını bekle
    await page.waitForFunction(() => Object.keys(document.querySelector('form') || {}).some((k) => k.startsWith('__reactProps')), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
    await page.locator('input[type=password]').fill('deneme123');
    await page.locator('form button[type=submit]').first().click();
    girisOldu = await page.waitForURL(/\/panel/, { timeout: 20000 }).then(() => true).catch(() => false);
    if (!girisOldu) console.log(`  … giriş ${deneme}. denemede olmadı (${page.url()}), yeniden`);
  }
  if (!girisOldu) throw new Error('Giriş yapılamadı');
  await page.waitForTimeout(500);
  console.log('  API:', API);

  // Sahte API bellek durumunu sıfırla — betik tekrar koşulabilsin
  const sifirla = await fetch(`${API}/akilli-bildirim/__sifirla`, { method: 'POST' }).then((r) => r.status).catch((e) => `hata ${e.message}`);
  console.log('  sahte veri sıfırlandı:', sifirla);

  // ── İletim Raporu ──
  await page.goto(`${KOK}/panel/iletim-raporu`, { waitUntil: 'networkidle' });
  const tablo = page.getByTestId('iletim-tablosu');
  await tablo.waitFor({ timeout: 30000 });
  await page.waitForSelector('[data-testid="iletim-tablosu"] tbody tr[data-durum]', { timeout: 30000 });
  await page.waitForTimeout(600);
  await cek('01-genel-1400');
  // Ana alan kendi içinde kaydığı için tam sayfa görüntüsü ekranla sınırlı; tablonun tamamı uzun pencereyle ayrıca
  await page.setViewportSize({ width: 1400, height: 2000 });
  await page.waitForTimeout(400);
  await page.locator('section', { has: tablo }).screenshot({ path: path.join(CIKIS, '01b-tablo-tam-1400.png') });
  console.log('  ✓ 01b-tablo-tam-1400');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);

  const satirSayisi = async () => tablo.locator('tbody tr[data-durum]').count();
  const hapSayi = async (ad) => {
    const b = page.getByRole('button', { name: new RegExp(`^\\d+ ${ad}$`) });
    return Number((await b.innerText()).trim().split(/\s+/)[0]);
  };

  // Özet satırı (sahte veri: 17 mükellef; 8 iletildi, 4 iletilemedi, 2 hiç gönderilmedi, 1 yalnız test, 1 belge yok, 13 kalem kapalı)
  kontrol('Özet: 17 mükellef', (await hapSayi('mükellef')) === 17, String(await hapSayi('mükellef')));
  kontrol('Özet: 8 iletildi', (await hapSayi('iletildi')) === 8, String(await hapSayi('iletildi')));
  kontrol('Özet: 4 iletilemedi (3 tam + 1 kısmen)', (await hapSayi('iletilemedi')) === 4, String(await hapSayi('iletilemedi')));
  kontrol('Özet: 2 hiç gönderilmedi', (await hapSayi('hiç gönderilmedi')) === 2, String(await hapSayi('hiç gönderilmedi')));
  kontrol('Özet: 1 yalnız test', (await hapSayi('yalnız test')) === 1);
  kontrol('Özet: 1 belge yok', (await hapSayi('belge yok')) === 1);
  kontrol('Özet: 13 kalem kategori kapalı', (await hapSayi('kalem kategori kapalı')) === 13, String(await hapSayi('kalem kategori kapalı')));
  kontrol('Sayaç kutusu YOK (tek satır özet)', (await page.locator('[data-testid="ozet-satiri"] button').count()) >= 6);

  // Uyarı satırları
  const kapaliUyari = page.getByTestId('kapali-uyari');
  kontrol('Kapalı kategori uyarısı: "e-Tebligat kategorisi … KAPALI; bu ay 13 gönderim"', /e-Tebligat kategorisi/.test(await kapaliUyari.innerText()) && /KAPALI/.test(await kapaliUyari.innerText()) && /13 gönderim/.test(await kapaliUyari.innerText()), (await kapaliUyari.innerText()).slice(0, 120));
  kontrol('Kapalı uyarısında Ayarlar bağlantısı', (await kapaliUyari.locator('a[href="/panel/ayarlar/akilli-bildirim"]').count()) === 1);
  const testUyari = page.getByTestId('test-uyari');
  kontrol('Test gönderimi uyarısı: "1 gönderim test alıcısına gitti"', /1 gönderim/.test(await testUyari.innerText()) && /iletildi sayılmaz/.test(await testUyari.innerText()));

  // Tablo: başlıklar + 17 satır + sorunlular üstte
  const basliklar = await tablo.locator('thead th').allInnerTexts();
  // CSS büyük harfe çevirir (innerText büyük gelir) — karşılaştırma harf duyarsız
  kontrol('Sütunlar: Mükellef | Vergi | SGK | e-Tebligat | Ödeme Listesi | Son durum', basliklar.join('|').toLocaleLowerCase('tr-TR') === 'mükellef|vergi|sgk|e-tebligat|ödeme listesi|son durum', basliklar.join('|'));
  kontrol('17 satır', (await satirSayisi()) === 17, String(await satirSayisi()));
  const durumlar = await tablo.locator('tbody tr[data-durum]').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-durum')));
  const sira = { hata: 0, bekliyor: 1, test: 2, kapali: 3, iletildi: 4, yok: 5 };
  kontrol('Sıralama: sorunlular üstte (hata → bekliyor → test → kapalı → iletildi → belge yok)', durumlar.every((d, i) => i === 0 || sira[durumlar[i - 1]] <= sira[d]), durumlar.join(','));

  // İkon / sembol / sarı dolgu denetimi
  const svgSayisi = await tablo.locator('svg').count();
  kontrol('Tabloda ikon (svg) YOK', svgSayisi === 0, String(svgSayisi));
  const semboller = await tablo.evaluate((t) => (t.innerText.match(/[✓✔✗✘⊘⏳⚠—]/g) || []).length);
  kontrol('Tabloda sembol karakteri YOK (✓ ✗ ⊘ ⏳ —)', semboller === 0, String(semboller));
  const sariDolgu = await page.evaluate(() => {
    const kok = document.querySelector('[data-panel-main]') || document.body;
    const sorunlu = [];
    for (const el of kok.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg);
      if (!m) continue;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const a = m[4] === undefined ? 1 : Number(m[4]);
      // altın (212,184,118) / amber (251,191,36) tonlarında DOLGU
      const sari = (r > 190 && g > 150 && b < 150 && r > b + 50);
      if (sari && a >= 0.12) sorunlu.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} bg=${bg}`);
    }
    return sorunlu;
  });
  // Yalnız başlık kartındaki ikon karesi ve "OFİS" üst etiketinin 26px süs çizgisi (tasarım imzası) kabul edilir
  const sariDisi = sariDolgu.filter((s) => !/^span\.grid shrink-0 place-items-center/.test(s) && !/^span\.h-px w-\[26px\]/.test(s));
  kontrol('Sarı/altın DOLGU yok (başlık ikon karesi hariç)', sariDisi.length === 0, sariDisi.slice(0, 4).join(' ; '));
  const doluRozet = await tablo.evaluate((t) => {
    let n = 0;
    for (const el of t.querySelectorAll('td span, td div, td button')) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg);
      if (!m) continue;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a >= 0.12) n++;
    }
    return n;
  });
  kontrol('Hücrelerde dolu renkli rozet YOK', doluRozet === 0, String(doluRozet));

  // Hücre metinleri (düz Türkçe)
  const satir = (ad) => tablo.locator('tbody tr', { hasText: ad }).first();
  const hucre = async (ad, i) => (await satir(ad).locator('td').nth(i).innerText()).replace(/\s+/g, ' ').trim();
  kontrol('Öz Ela · Vergi: "İletildi · 12.09 14:21 WhatsApp ve e-posta ile"', (await hucre('Öz Ela', 1)) === 'İletildi · 12.09 14:21 WhatsApp ve e-posta ile', await hucre('Öz Ela', 1));
  kontrol('Öz Ela · e-Tebligat: "Kategori kapalı belge var, gönderilmedi"', (await hucre('Öz Ela', 3)) === 'Kategori kapalı belge var, gönderilmedi', await hucre('Öz Ela', 3));
  kontrol('Öz Ela · Son durum: "Vergi, SGK, Ödeme Listesi iletildi · e-Tebligat kapalı"', (await hucre('Öz Ela', 5)) === 'Vergi, SGK, Ödeme Listesi iletildi · e-Tebligat kapalı', await hucre('Öz Ela', 5));
  kontrol('Balçık İnşaat · Son durum: "Hepsi iletildi"', (await hucre('Balçık İnşaat', 5)) === 'Hepsi iletildi', await hucre('Balçık İnşaat', 5));
  kontrol('Mert Reklam · Vergi: "İletilemedi telefon numarası yok" ("mükellefin" düştü)', (await hucre('Mert Reklam', 1)) === 'İletilemedi telefon numarası yok', await hucre('Mert Reklam', 1));
  kontrol('Mert Reklam · Son durum: "Vergi, SGK, Ödeme Listesi iletilemedi: telefon numarası yok" + Yeniden dene + Ödeme listesi bağlantısı', (await hucre('Mert Reklam', 5)) === 'Vergi, SGK, Ödeme Listesi iletilemedi: telefon numarası yok Yeniden dene Ödeme listesini oradan gönder', await hucre('Mert Reklam', 5));
  kontrol('Erdoğan Balçık · Vergi: "Kısmen iletildi e-posta gitti · WhatsApp: telefon numarası yok"', (await hucre('Erdoğan Balçık', 1)) === 'Kısmen iletildi e-posta gitti · WhatsApp: telefon numarası yok', await hucre('Erdoğan Balçık', 1));
  kontrol('Erdoğan Balçık · Son durum: "Vergi kısmen iletildi (WhatsApp: telefon numarası yok)"', /^Vergi kısmen iletildi \(WhatsApp: telefon numarası yok\) Yeniden dene$/.test(await hucre('Erdoğan Balçık', 5)), await hucre('Erdoğan Balçık', 5));
  kontrol('Gito · Vergi: iki kanal iki farklı sebep', (await hucre('Gito', 1)) === 'İletilemedi WhatsApp: numara WhatsApp kullanmıyor · e-posta: SMTP bağlantısı kurulamadı', await hucre('Gito', 1));
  kontrol('Dilek Bayageldi · Vergi: "Gönderilmedi belge var, gönderim yapılmadı"', (await hucre('Dilek Bayageldi', 1)) === 'Gönderilmedi belge var, gönderim yapılmadı', await hucre('Dilek Bayageldi', 1));
  kontrol('Dilek Bayageldi · Son durum', (await hucre('Dilek Bayageldi', 5)) === 'Vergi, SGK gönderilmedi: belge var, gönderim yapılmadı', await hucre('Dilek Bayageldi', 5));
  kontrol('Başbuğ · Vergi: "Gönderilmedi telefon numarası yok"', (await hucre('Başbuğ', 1)) === 'Gönderilmedi telefon numarası yok', await hucre('Başbuğ', 1));
  kontrol('Tuvtürk · SGK: "Test gönderimi [test] 03.09 09:16 · test alıcısına gitti, mükellef almadı"', (await hucre('Tuvtürk', 2)) === 'Test gönderimi test 03.09 09:16 · test alıcısına gitti, mükellef almadı', await hucre('Tuvtürk', 2));
  kontrol('Tuvtürk · Son durum: "Yalnız test gönderimi, mükellef almadı"', (await hucre('Tuvtürk', 5)) === 'Yalnız test gönderimi, mükellef almadı', await hucre('Tuvtürk', 5));
  kontrol('Ercan Aydın · Son durum: "Kategori kapalı, gönderilmedi"', (await hucre('Ercan Aydın', 5)) === 'Kategori kapalı, gönderilmedi', await hucre('Ercan Aydın', 5));
  kontrol('Demir Çelik · hücreler "Belge yok" / "Gönderim yok", Son durum "Bu ay belge yok"', (await hucre('Demir Çelik', 1)) === 'Belge yok' && (await hucre('Demir Çelik', 4)) === 'Gönderim yok' && (await hucre('Demir Çelik', 5)) === 'Bu ay belge yok');
  kontrol('Hücre ipucu (title) kanal kanal sonuç', /WhatsApp/.test(await satir('Erdoğan Balçık').locator('td').nth(1).locator('[title]').first().getAttribute('title')));

  // Hap süzgeçleri
  await page.getByRole('button', { name: /^\d+ iletilemedi$/ }).click();
  await page.waitForTimeout(300);
  kontrol('Hap "iletilemedi" → 4 satır', (await satirSayisi()) === 4, String(await satirSayisi()));
  await cek('02-hap-iletilemedi', false);
  await page.getByRole('button', { name: /^\d+ kalem kategori kapalı$/ }).click();
  await page.waitForTimeout(300);
  kontrol('Hap "kalem kategori kapalı" → 13 satır', (await satirSayisi()) === 13, String(await satirSayisi()));
  await page.getByRole('button', { name: /^\d+ mükellef$/ }).click();
  await page.waitForTimeout(300);
  kontrol('Hap "mükellef" süzgeci sıfırladı', (await satirSayisi()) === 17);

  // Tümü / Yalnız sorunlu / Yalnız iletilen
  await page.getByRole('button', { name: 'Yalnız sorunlu' }).click();
  await page.waitForTimeout(300);
  kontrol('"Yalnız sorunlu" → 8 (4 hata + 2 gönderilmedi + 1 test + 1 kapalı)', (await satirSayisi()) === 8, String(await satirSayisi()));
  await cek('03-yalniz-sorunlu', false);
  await page.getByRole('button', { name: 'Yalnız iletilen' }).click();
  await page.waitForTimeout(300);
  kontrol('"Yalnız iletilen" → 8', (await satirSayisi()) === 8, String(await satirSayisi()));
  await page.getByRole('button', { name: 'Tümü' }).click();
  await page.waitForTimeout(300);

  // Arama
  await page.getByLabel('Mükellef ara').fill('fam');
  await page.waitForTimeout(300);
  kontrol('Arama "fam" → 1 (Famcoffee)', (await satirSayisi()) === 1 && /Famcoffee/.test(await tablo.locator('tbody tr[data-durum]').first().innerText()));
  await cek('04-arama', false);
  await page.getByLabel('Mükellef ara').fill('');
  await page.waitForTimeout(300);

  // Satır bazlı yeniden deneme (Gito: geçici hatalar → sahte API SENT yapar)
  const topluDugme = page.getByRole('button', { name: /Başarısızları yeniden dene \(\d+\)/ });
  kontrol('Toplu düğme "(5)" — Vergi/SGK/e-Tebligat hatalı hücre sayısı (Ödeme Listesi hariç)', /\(5\)/.test(await topluDugme.innerText()), await topluDugme.innerText());
  await satir('Gito').getByRole('button', { name: 'Yeniden dene' }).click();
  await page.waitForTimeout(1200);
  {
    const i = sonIstek('POST', '/akilli-bildirim/run');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /akilli-bildirim/run {kategori:VERGI, taxpayerId:r10, sinceHours} — force YOK', !!g && g.kategori === 'VERGI' && g.taxpayerId === 'r10' && typeof g.sinceHours === 'number' && g.sinceHours > 0 && !('force' in g), i && i.govde);
  }
  kontrol('Gito satırı yenilendi → "Hepsi iletildi"', (await hucre('Gito', 5)) === 'Hepsi iletildi', await hucre('Gito', 5));
  kontrol('Toplu düğme "(4)" oldu', /\(4\)/.test(await topluDugme.innerText()), await topluDugme.innerText());
  await cek('05-satir-yeniden-dene', false);

  // Toplu yeniden deneme → POST /resend-failed {month}
  await topluDugme.click();
  await page.waitForTimeout(1200);
  {
    const i = sonIstek('POST', '/akilli-bildirim/resend-failed');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /akilli-bildirim/resend-failed {month} — yalnız ay', !!g && /^\d{4}-\d{2}$/.test(g.month) && Object.keys(g).length === 1, i && i.govde);
  }
  kontrol('Toplu deneme sonrası kalıcı hatalar (telefon/e-posta yok) yerinde: (4)', /\(4\)/.test(await topluDugme.innerText()), await topluDugme.innerText());

  // Ay gezinme
  const ayGirdi = page.getByLabel('Ay', { exact: true });
  const ayOnce = await ayGirdi.inputValue();
  await page.getByTitle('Önceki ay').click();
  await page.waitForTimeout(900);
  const aySonra = await ayGirdi.inputValue();
  kontrol('Önceki ay → GET /report?month=', ayOnce !== aySonra && !!sonIstek('GET', `/akilli-bildirim/report?month=${aySonra}`), `${ayOnce} → ${aySonra}`);
  kontrol('Önceki ay: 5 mükellef, hepsi iletildi, uyarı satırı yok', (await satirSayisi()) === 5 && (await hapSayi('iletildi')) === 5 && (await page.getByTestId('kapali-uyari').count()) === 0);
  await cek('06-onceki-ay', false);
  await page.getByRole('button', { name: /Bu ay/ }).click();
  await page.waitForTimeout(600);
  kontrol('"Bu ay" düğmesi', (await ayGirdi.inputValue()) === ayOnce);

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('07-genel-1000');

  await browser.close();
  console.log('\n' + kontroller.join('\n'));
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok, tüm kontroller geçti');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
