// Aylık Ödeme Listesi — Playwright ile ekran görüntüleri + istek gövdesi doğrulaması (sahte API 3001 + web 3000 açık olmalı)
// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan) + pnpm --filter @mali-musavir/web dev, sonra
//          node apps/web/scripts/aylik-odeme-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/aylik-odeme)
// Tarayıcı: apps/luca-local-agent/node_modules/playwright (Chromium)
//
// 2026-09-14 (kalem bazlı gönderim): iki grup (VERGİ / SGK ÖDEMELERİ), "ara toplam" yazısı yok, GÖNDERİM sütunu düz yazı,
// WhatsApp / E-posta AYRI düğmeler (test modunda "… (test alıcısına)", canlı modda "(1 yeni)" / "yeniden gönder" / pasif+ipucu),
// toplu düğme yanında "Yalnız WhatsApp / Yalnız e-posta" menüsü (kanal parametresi), özet şeridinde "N yeni kalem".
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/aylik-odeme');
fs.mkdirSync(CIKIS, { recursive: true });
const KOK = 'http://localhost:3000';
// Sahte API adresi: web'in GERÇEKTEN çağırdığı adres ilk /api/v1 isteğinden saptanır (paylaşılan .next parçaları başka portla
// derlenmiş olabilir — 2026-09-14: dev-sahte-kart.cjs 3005/3002 çifti aynı .next'i yazınca giriş parçası 3002'ye bağlanıyordu).
let SAHTE = process.env.SAHTE_API || 'http://localhost:3001/api/v1';
let sahteSaptandi = false;

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
    const k = u.indexOf('/api/v1/');
    if (!sahteSaptandi && k > 0) {
      const taban = u.slice(0, k + '/api/v1'.length);
      if (taban !== SAHTE) console.log(`  ! sahte API adresi: ${taban} (web bu adrese bağlı)`);
      SAHTE = taban;
      sahteSaptandi = true;
    }
    if (u.includes('/api/v1/aylik-odeme') || u.includes('/taxpayer-portal/')) istekler.push({ yontem: r.method(), url: u.replace(/^https?:\/\/[^/]+\/api\/v1/, ''), govde: r.postData() });
  });
  const sonIstek = (yontem, parca) => [...istekler].reverse().find((i) => i.yontem === yontem && i.url.includes(parca));
  const sonGovde = (parca) => {
    const i = sonIstek('POST', parca);
    return { i, g: i ? JSON.parse(i.govde || '{}') : null };
  };

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
  const sahteAyar = (govde) => fetch(`${SAHTE}/aylik-odeme/__ayar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde) }).catch(() => {});

  // ── Giriş (/giris/musavir — sahte API her e-posta/şifreyi kabul eder) ──
  await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle' });
  await page.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await page.locator('input[type=password]').fill('deneme123');
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL(/\/panel/, { timeout: 30000 });

  // Sahte API bellek durumunu sıfırla (gönderimler, SGK-yok, otomatik ayar, test modu) — betik tekrar koşulabilsin
  await fetch(`${SAHTE}/aylik-odeme/__sifirla`, { method: 'POST' }).catch(() => {});

  // ── Aylık Ödeme Listesi ──
  await page.goto(`${KOK}/panel/aylik-odeme`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="cetvel"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  await cek('01-genel-1400');

  // Özet şeridi + test bandı
  kontrol('Özet şeridi: mükellef hapı', await page.getByRole('button', { name: /mükellef$/ }).count() > 0);
  kontrol('Özet şeridi: gönderildi/bekliyor/hata hapları', (await page.getByRole('button', { name: /gönderildi$/ }).count()) === 1 && (await page.getByRole('button', { name: /bekliyor$/ }).count()) === 1 && (await page.getByRole('button', { name: /hata$/ }).count()) === 1);
  {
    const yeni = page.getByTestId('yeni-kalem');
    const t = (await yeni.count()) ? (await yeni.innerText()).replace(/\s+/g, ' ').trim() : '';
    kontrol('Özet şeridi: "N yeni kalem"', /^\d+ yeni kalem$/.test(t) && Number(t) !== 0, t);
  }
  kontrol('Özet şeridi: en yakın son gün', (await page.getByText(/En yakın son gün/).count()) > 0);
  kontrol('TEST MODU bandı', (await page.getByTestId('test-bandi').count()) === 1);
  kontrol('Toplu düğme test modunda "Test alıcısına gönder (N)"', (await page.getByRole('button', { name: /Test alıcısına gönder \(\d+\)/ }).count()) === 1);
  kontrol('Toplu düğme yanında kanal menüsü oku', (await page.getByRole('button', { name: 'Gönderim kanalı seç' }).count()) === 1);

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

  // ── Cetvel: Famcoffee (aylık + geçici + yıllık + SGK → yalnız İKİ grup; 1/2 taksit; fiş bağlantısı; hiç gönderilmemiş) ──
  const cetvel = page.getByTestId('cetvel');
  const satirYazisi = async (ad) => (await page.getByRole('option', { name: ad }).locator('[data-testid="mukellef-gonderim"]').innerText()).replace(/\s+/g, ' ').trim();
  await page.getByRole('option', { name: /Famcoffee/ }).click();
  await page.waitForTimeout(400);
  kontrol('Cetvel: seçili mükellef Famcoffee', /Famcoffee/.test(await cetvel.locator('h2').innerText()));
  kontrol('Cetvel: yalnız İKİ grup bandı (VERGİ / SGK)', (await cetvel.locator('tr[data-grup]').count()) === 2, String(await cetvel.locator('tr[data-grup]').count()));
  {
    const bantlar = await cetvel.locator('tr[data-grup]').allInnerTexts();
    // innerText CSS uppercase'i yansıtır ("VERGİ ÖDEMELERİ"); İ/i eşleşmesi için tr-TR küçük harfe çevrilir
    const temiz = bantlar.map((b) => b.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR'));
    kontrol('Grup bandı: "VERGİ ÖDEMELERİ · 4 kalem" + sağda yalnız tutar', /^vergi ödemeleri · 4 kalem [\d.,]+ ₺$/.test(temiz[0]) && /^sgk ödemeleri · 1 kalem [\d.,]+ ₺$/.test(temiz[1]), temiz.join(' | '));
    const cssUpper = await cetvel.locator('tr[data-grup] span').first().evaluate((el) => getComputedStyle(el).textTransform);
    kontrol('Grup adı büyük harf (CSS uppercase, lang=tr → VERGİ)', cssUpper === 'uppercase', cssUpper);
  }
  kontrol('"ARA TOPLAM" yazısı YOK', (await cetvel.getByText(/ara toplam/i).count()) === 0);
  {
    const toplam = page.getByTestId('genel-toplam');
    const t = (await toplam.innerText()).replace(/\s+/g, ' ').trim();
    kontrol('En altta tek "TOPLAM" satırı', (await toplam.count()) === 1 && /^Toplam [\d.,]+ ₺$/i.test(t), t);
  }
  kontrol('GÖNDERİM sütunu başlığı', (await cetvel.locator('thead th', { hasText: /^Gönderim$/i }).count()) === 1);
  {
    const ilkSatir = (await cetvel.locator('tbody tr:not([data-grup]):not([aria-hidden])').first().innerText()).replace(/\s+/g, ' ');
    kontrol('VERGİ grubu son ödeme gününe göre sıralı (Famcoffee: önce Kurum Geçici 17.)', /Kurum Geçici/.test(ilkSatir), ilkSatir.slice(0, 60));
  }
  kontrol('Cetvel: taksit etiketi', (await cetvel.getByText(/taksit/).count()) > 0);
  kontrol('Cetvel: hafta sonu kaydırma ipucu', (await cetvel.getByText('hafta sonu → ilk iş günü').count()) > 0);
  kontrol('Hiç gönderilmemiş: her kalemde "gönderilmedi" (soluk)', (await cetvel.locator('[data-testid="kalem-gonderim"]', { hasText: 'gönderilmedi' }).count()) === 5);
  kontrol('Durum satırı: "Vergi: gönderilmedi · SGK: gönderilmedi"', /Vergi: gönderilmedi.*SGK: gönderilmedi/.test((await page.getByTestId('gonderim-durumu').innerText()).replace(/\s+/g, ' ')));
  kontrol('İKİ AYRI düğme, test modunda "WhatsApp (test alıcısına)" / "E-posta (test alıcısına)"', (await cetvel.getByRole('button', { name: 'WhatsApp (test alıcısına)' }).count()) === 1 && (await cetvel.getByRole('button', { name: 'E-posta (test alıcısına)' }).count()) === 1);
  kontrol('Listede hiç gönderilmemiş: "— gönderilmedi"', (await satirYazisi(/Famcoffee/)) === 'gönderilmedi', await satirYazisi(/Famcoffee/));
  await cek('04-mukellef-famcoffee-iki-grup', false);

  // Telefonsuz mükellef ipucu (Mert Reklam)
  kontrol('Listede telefonsuz mükellef ⚠ ipucu', (await page.locator('[data-testid="mukellef-listesi"] [aria-label^="Telefon yok"]').count()) >= 1);

  // ── Öz Ela: KISMEN gönderilmiş + 1 yeni kalem ──
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  kontrol('Listede kısmi: "3/4 gönderildi · 1 yeni"', (await satirYazisi(/Öz Ela/)) === '3/4 gönderildi · 1 yeni', await satirYazisi(/Öz Ela/));
  {
    const d = (await page.getByTestId('gonderim-durumu').innerText()).replace(/\s+/g, ' ').trim();
    kontrol('Durum satırı: "Vergi: 2/3 kalem gönderildi (1 yeni) · SGK: gönderildi 12.09"', /^Vergi: 2\/3 kalem gönderildi \(1 yeni\) · SGK: gönderildi \d{2}\.\d{2}$/.test(d), d);
    const hucreler = (await cetvel.locator('[data-testid="kalem-gonderim"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    kontrol('GÖNDERİM sütunu düz yazı: 3× "WhatsApp gg.aa" + 1× "gönderilmedi"', hucreler.filter((h) => /^WhatsApp \d{2}\.\d{2}$/.test(h)).length === 3 && hucreler.filter((h) => h === 'gönderilmedi').length === 1, hucreler.join(' | '));
  }
  kontrol('Listede tamamen gönderilmiş: "hepsi gönderildi"', (await satirYazisi(/Ayşegül Kaya/)) === 'hepsi gönderildi', await satirYazisi(/Ayşegül Kaya/));
  kontrol('Listede hatalı: "hata"', (await satirYazisi(/Ela Tekstil/)) === 'hata', await satirYazisi(/Ela Tekstil/));
  await cek('05-oz-ela-kismi-gonderim', false);

  // Yıldız: yalnız vergi TEST alıcısına gitti → sütunda "· test" etiketi
  await page.getByRole('option', { name: /Yıldız Otomotiv/ }).click();
  await page.waitForTimeout(400);
  {
    const hucreler = (await cetvel.locator('[data-testid="kalem-gonderim"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    kontrol('Test gönderimi: "WhatsApp gg.aa · test" etiketi', hucreler.filter((h) => /^WhatsApp \d{2}\.\d{2} · test$/.test(h)).length === 3, hucreler.join(' | '));
    const d = (await page.getByTestId('gonderim-durumu').innerText()).replace(/\s+/g, ' ');
    kontrol('Durum satırı test etiketi + SGK gönderilmedi', /Vergi: gönderildi \d{2}\.\d{2} · test · SGK: gönderilmedi/.test(d), d);
  }

  // Ayşegül (hepsi gitti) → WhatsApp test modunda mod:'yeniden' + kanal:'WHATSAPP' (onay penceresi test modunda çıkmaz)
  await page.getByRole('option', { name: /Ayşegül Kaya/ }).click();
  await page.waitForTimeout(400);
  await cetvel.getByRole('button', { name: 'WhatsApp (test alıcısına)' }).click();
  await page.waitForTimeout(900);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (hepsi gitmiş mükellef, WhatsApp) {taxpayerId:m3, mod:yeniden, kanal:WHATSAPP}', !!g && g.mod === 'yeniden' && g.kanal === 'WHATSAPP' && g.taxpayerId === 'm3' && /^\d{4}-\d{2}$/.test(g.month), i && i.govde);
  }

  // Öz Ela → E-posta (hiç e-posta gitmemiş) test modunda mod:'gonderilmemis' + kanal:'EMAIL'
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  await cetvel.getByRole('button', { name: 'E-posta (test alıcısına)' }).click();
  await page.waitForTimeout(900);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (Öz Ela, E-posta) {taxpayerId:m1, mod:gonderilmemis, kanal:EMAIL}', !!g && g.mod === 'gonderilmemis' && g.kanal === 'EMAIL' && g.taxpayerId === 'm1', i && i.govde);
  }
  kontrol('Gönderim sonrası cetvel yenilendi (Öz Ela: E-posta sütunda)', (await cetvel.locator('[data-testid="kalem-gonderim"]', { hasText: /E-posta \d{2}\.\d{2}/ }).count()) === 4);

  // ── CANLI MOD (test modu kapalı): düğme yazıları "(1 yeni)" / "yeniden gönder" / pasif + ipucu ──
  await fetch(`${SAHTE}/aylik-odeme/__sifirla`, { method: 'POST' }).catch(() => {});
  await sahteAyar({ testMode: false });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="cetvel"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  kontrol('Canlı mod: TEST bandı yok, toplu düğme "Gönderilmemişleri gönder (N)"', (await page.getByTestId('test-bandi').count()) === 0 && (await page.getByRole('button', { name: /Gönderilmemişleri gönder \(\d+\)/ }).count()) === 1);
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  kontrol('Canlı: kısmi mükellefte "WhatsApp ile gönder (1 yeni)" + "E-posta ile gönder"', (await cetvel.getByRole('button', { name: 'WhatsApp ile gönder (1 yeni)' }).count()) === 1 && (await cetvel.getByRole('button', { name: 'E-posta ile gönder' }).count()) === 1);
  await cek('06-canli-mod-oz-ela-1-yeni', false);
  await page.getByRole('option', { name: /Ayşegül Kaya/ }).click();
  await page.waitForTimeout(400);
  // Ayşegül: 4 kalemin hepsi WhatsApp ile gitti → "yeniden gönder"; e-posta ile yalnız 3 vergi kalemi gitti, SGK gitmedi → "(1 yeni)"
  kontrol('Canlı: kanal bazında — "WhatsApp ile yeniden gönder" + "E-posta ile gönder (1 yeni)"', (await cetvel.getByRole('button', { name: 'WhatsApp ile yeniden gönder' }).count()) === 1 && (await cetvel.getByRole('button', { name: 'E-posta ile gönder (1 yeni)' }).count()) === 1, (await cetvel.locator('button[data-kanal]').allInnerTexts()).join(' | '));
  await cek('06b-canli-mod-aysegul-yeniden', false);
  await page.getByRole('option', { name: /Erdoğan Balçık/ }).click();
  await page.waitForTimeout(400);
  {
    const ep = cetvel.locator('button[data-kanal="EMAIL"]');
    kontrol('Canlı: e-postası olmayan mükellefte E-posta düğmesi PASİF + ipucu', (await ep.isDisabled()) && /E-posta kayıtlı değil/.test((await ep.getAttribute('title')) || ''), await ep.getAttribute('title'));
    kontrol('Canlı: WhatsApp düğmesi aktif "WhatsApp ile gönder"', !(await cetvel.locator('button[data-kanal="WHATSAPP"]').isDisabled()) && (await cetvel.getByRole('button', { name: 'WhatsApp ile gönder' }).count()) === 1);
  }
  await cek('07-canli-mod-pasif-eposta', false);
  await page.getByRole('option', { name: /Mert Reklam/ }).click();
  await page.waitForTimeout(400);
  {
    const wa = cetvel.locator('button[data-kanal="WHATSAPP"]');
    kontrol('Canlı: telefonu olmayan mükellefte WhatsApp düğmesi PASİF + ipucu', (await wa.isDisabled()) && /Telefon kayıtlı değil/.test((await wa.getAttribute('title')) || ''), await wa.getAttribute('title'));
  }
  // Canlı: Öz Ela WhatsApp (1 yeni) → onay YOK (yeniden değil) → {mod:gonderilmemis, kanal:WHATSAPP}
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  await cetvel.getByRole('button', { name: 'WhatsApp ile gönder (1 yeni)' }).click();
  await page.waitForTimeout(900);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (canlı, 1 yeni) {taxpayerId:m1, mod:gonderilmemis, kanal:WHATSAPP}', !!g && g.mod === 'gonderilmemis' && g.kanal === 'WHATSAPP' && g.taxpayerId === 'm1', i && i.govde);
  }
  kontrol('Gönderim sonrası liste yenilendi (Öz Ela → hepsi gönderildi)', (await satirYazisi(/Öz Ela/)) === 'hepsi gönderildi', await satirYazisi(/Öz Ela/));
  kontrol('Gönderim sonrası düğme "WhatsApp ile yeniden gönder"', (await cetvel.getByRole('button', { name: 'WhatsApp ile yeniden gönder' }).count()) === 1);
  // Canlı: yeniden gönder → onay penceresi (otomatik kabul) → mod:'yeniden'
  await cetvel.getByRole('button', { name: 'WhatsApp ile yeniden gönder' }).click();
  await page.waitForTimeout(900);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (canlı, yeniden) {taxpayerId:m1, mod:yeniden, kanal:WHATSAPP}', !!g && g.mod === 'yeniden' && g.kanal === 'WHATSAPP' && g.taxpayerId === 'm1', i && i.govde);
  }
  // Test moduna geri dön
  await fetch(`${SAHTE}/aylik-odeme/__sifirla`, { method: 'POST' }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="cetvel"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  kontrol('Test moduna dönüldü', (await page.getByTestId('test-bandi').count()) === 1);

  // Şablonu bana gönder → POST ornek-gonder
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
  await cetvel.getByRole('button', { name: /Şablonu bana gönder/ }).click();
  await page.waitForTimeout(700);
  {
    const { i, g } = sonGovde('/aylik-odeme/ornek-gonder');
    kontrol('POST /ornek-gonder {month, taxpayerId}', !!g && g.taxpayerId === 'm1' && !!g.month, i && i.govde);
  }

  // Toplu gönder (test modu → onay penceresi yok) → mod:'gonderilmemis', taxpayerId ve kanal YOK
  await page.getByRole('button', { name: /Test alıcısına gönder \(\d+\)/ }).click();
  await page.waitForTimeout(1000);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (toplu) mod=gonderilmemis, taxpayerId/kanal yok', !!g && g.mod === 'gonderilmemis' && !('taxpayerId' in g) && !('kanal' in g), i && i.govde);
  }
  // Toplu düğmenin sonrası: hepsi gitti → yeni kalem 0, "Test alıcısına gönder (0)"
  await page.waitForTimeout(600);
  kontrol('Toplu sonrası özet "0 yeni kalem"', /^0 yeni kalem$/.test((await page.getByTestId('yeni-kalem').innerText()).replace(/\s+/g, ' ').trim()));

  // Kanal menüsü: "Yalnız e-posta" → kanal:'EMAIL' (sıfırla ki gönderilecek kalem olsun)
  await fetch(`${SAHTE}/aylik-odeme/__sifirla`, { method: 'POST' }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="cetvel"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Gönderim kanalı seç' }).click();
  await page.waitForTimeout(250);
  kontrol('Kanal menüsü: "Yalnız WhatsApp" / "Yalnız e-posta"', (await page.getByRole('menuitem', { name: 'Yalnız WhatsApp' }).count()) === 1 && (await page.getByRole('menuitem', { name: 'Yalnız e-posta' }).count()) === 1);
  await cek('08-kanal-menusu', false);
  await page.getByRole('menuitem', { name: 'Yalnız e-posta' }).click();
  await page.waitForTimeout(1000);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
    kontrol('POST /send (Yalnız e-posta) {mod:gonderilmemis, kanal:EMAIL}, taxpayerId yok', !!g && g.mod === 'gonderilmemis' && g.kanal === 'EMAIL' && !('taxpayerId' in g), i && i.govde);
  }

  // Menü: Hepsine yeniden gönder (onay otomatik kabul) → mod:'hepsi'
  await page.getByTitle('Diğer işlemler').click();
  await page.waitForTimeout(250);
  await cek('09-baslik-menusu', false);
  await page.getByRole('menuitem', { name: 'Hepsine yeniden gönder' }).click();
  await page.waitForTimeout(1000);
  {
    const { i, g } = sonGovde('/aylik-odeme/send');
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
  await page.getByRole('option', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(400);
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
  kontrol('Yazdır: tıklama anında yeni sekme + GET /aylik-odeme/pdf (window.print yok)', !!sekme && !!pi, pi && pi.url().replace(SAHTE, ''));
  if (sekme) await sekme.close().catch(() => {});

  // Otomatik gönderim kartı → PUT /aylik-odeme/otomatik
  const kart = page.getByTestId('otomatik-kart');
  await kart.scrollIntoViewIfNeeded();
  await kart.getByTitle('Otomatik gönderim').click();
  await kart.getByLabel('Gün').selectOption('25');
  await kart.getByLabel('Saat').selectOption('10');
  await page.waitForTimeout(200);
  await cek('10-otomatik-kart', false);
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
  await cek('11-eksikler-acik', false);
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
  await cek('12-onceki-ay', false);
  await page.getByRole('button', { name: /Bu ay/ }).click();
  await page.waitForTimeout(600);
  kontrol('"Bu ay" düğmesi', (await ayGirdi.inputValue()) === ayOnce);

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('13-genel-1000');
  await page.getByRole('option', { name: /Famcoffee/ }).click();
  await cetvel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await cek('13b-cetvel-1000', false);

  // ── Mükellef portalı: Bu Ayki Ödemelerim (aynı grupla() → iki grup, ara toplam yazısı yok) ──
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
  kontrol('Portal: iki grup (Vergi ödemeleri / SGK ödemeleri), "ara toplam" yazısı yok', (await bolum.getByText(/Vergi ödemeleri/i).count()) === 1 && (await bolum.getByText(/SGK ödemeleri/i).count()) === 1 && (await bolum.getByText(/ara toplam/i).count()) === 0);
  await bolum.scrollIntoViewIfNeeded();
  await cek('14-mukellef-portali-1400', false);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(500);
  await bolum.scrollIntoViewIfNeeded();
  await cek('15-mukellef-portali-1000', false);

  // Sahte durumu temizle
  await fetch(`${SAHTE}/aylik-odeme/__sifirla`, { method: 'POST' }).catch(() => {});

  await browser.close();
  console.log('\n' + kontroller.join('\n'));
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok, tüm kontroller geçti');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
