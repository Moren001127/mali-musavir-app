// İletim Raporu (Hattat mantığı: düz günlük) — Playwright ile ekran görüntüleri + davranış/istek doğrulaması
// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan) + pnpm --filter @mali-musavir/web dev, sonra
//          node apps/web/scripts/iletim-raporu-onizleme-goruntule.cjs [çıkış klasörü]   (varsayılan: _previews/iletim-raporu)
// Tarayıcı: apps/luca-local-agent/node_modules/playwright (Chromium)
// Kontroller: süzgeç çubuğu (mükellef/tür/belge türü/gönderim/dönem → Filtrele), Ara, kayıt sayısı, sıralama, sayfalama,
//             Excel isteği+indirme, yeniden dene isteği, rozet renkleri (WhatsApp yeşil / Mail mavi / Hata kırmızı),
//             sarı/altın DOLGU yok (başlık hariç), konsol hatası 0, yatay taşma yok. Görüntüler 20-*.png (1400 ve 1000 px).
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) hatalar.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => hatalar.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

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
  const sonParam = (parca) => {
    const i = sonIstek('GET', parca);
    return i ? Object.fromEntries(new URL('http://x' + i.url).searchParams.entries()) : null;
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

  // ── Giriş (sahte API her e-posta/şifreyi kabul eder) ──
  let girisOldu = false;
  for (let deneme = 1; deneme <= 3 && !girisOldu; deneme++) {
    await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle' });
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
  const sifirla = await fetch(`${API}/akilli-bildirim/__sifirla`, { method: 'POST' }).then((r) => r.status).catch((e) => `hata ${e.message}`);
  console.log('  sahte veri sıfırlandı:', sifirla);

  // ── İletim Raporu ──
  await page.goto(`${KOK}/panel/iletim-raporu`, { waitUntil: 'networkidle' });
  const tablo = page.getByTestId('iletim-tablosu');
  await tablo.waitFor({ timeout: 30000 });
  await page.waitForSelector('[data-testid="iletim-tablosu"] tbody tr[data-durum]', { timeout: 30000 });
  await page.waitForTimeout(600);
  await cek('20-genel-1400');
  await page.setViewportSize({ width: 1400, height: 2400 });
  await page.waitForTimeout(400);
  await page.locator('section', { has: tablo }).screenshot({ path: path.join(CIKIS, '20b-tablo-tam-1400.png') });
  console.log('  ✓ 20b-tablo-tam-1400');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);

  const satirlar = () => tablo.locator('tbody tr[data-durum]');
  const satirSayisi = async () => satirlar().count();
  const hucre = async (i, j) => (await satirlar().nth(i).locator('td').nth(j).innerText()).replace(/\s+/g, ' ').trim();
  const ozet = async () => (await page.getByTestId('ozet-satiri').innerText()).replace(/\s+/g, ' ').trim();
  const sayfaBilgisi = async () => (await page.getByTestId('sayfa-bilgisi').innerText()).trim();
  const bekle = async () => { await page.waitForTimeout(700); };
  const filtrele = async () => { await page.getByRole('button', { name: 'Filtrele' }).click(); await bekle(); };

  // Başlıklar, sıra, sayfa
  const basliklar = await tablo.locator('thead th').allInnerTexts();
  kontrol('Sütunlar: Tarih | Mükellef | Belge Türü | Belge Adı | Durum', basliklar.map((b) => b.replace(/\s+/g, ' ').trim()).join('|').toLocaleLowerCase('tr-TR') === 'tarih|mükellef|belge türü|belge adı|durum', basliklar.join('|'));
  kontrol('Varsayılan 50 kayıt / sayfa → 50 satır', (await satirSayisi()) === 50, String(await satirSayisi()));
  kontrol('Sayfa bilgisi "1–50 / 60 kayıt"', (await sayfaBilgisi()) === '1–50 / 60 kayıt', await sayfaBilgisi());
  kontrol('Özet satırı: "… · 60 gönderim · 50 iletildi · 8 iletilemedi · 2 test"', /· 60 gönderim · 50 iletildi · 8 iletilemedi · 2 test$/.test(await ozet()), await ozet());
  kontrol('Tarih biçimi "14.09.2026 08:04:00" ve en yeni üstte', /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/.test(await hucre(0, 0)) && /^14\./.test(await hucre(0, 0)), await hucre(0, 0));
  {
    const tarihler = await satirlar().evaluateAll((trs) => trs.map((t) => t.querySelector('td').innerText.trim()));
    const anahtar = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s); return m ? `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}${m[6]}` : ''; };
    kontrol('Tarih azalan sıralı', tarihler.every((t, i) => i === 0 || anahtar(tarihler[i - 1]) >= anahtar(t)));
  }
  kontrol('Matris/son durum/hap YOK (5 sütun, sayfada hap düğmesi yok)', basliklar.length === 5 && (await page.locator('[data-panel-main] button[aria-pressed]').count()) === 0, String(await page.locator('[data-panel-main] button[aria-pressed]').count()));

  // Rozet renkleri
  const rozetRenk = async (metin) => {
    const el = tablo.locator('tbody td span', { hasText: new RegExp(`^${metin}$`) }).first();
    return el.evaluate((e) => getComputedStyle(e).backgroundColor);
  };
  kontrol('WhatsApp rozeti yeşil dolu (#25a55a)', (await rozetRenk('WhatsApp')) === 'rgb(37, 165, 90)', await rozetRenk('WhatsApp'));
  kontrol('Mail rozeti mavi dolu (#2f7ed8)', (await rozetRenk('Mail')) === 'rgb(47, 126, 216)', await rozetRenk('Mail'));
  kontrol('Hata rozeti kırmızı dolu (#d64545)', (await rozetRenk('Hata')) === 'rgb(214, 69, 69)', await rozetRenk('Hata'));
  {
    const hataSatir = satirlar().filter({ has: page.locator('span', { hasText: /^Hata$/ }) }).first();
    const title = await hataSatir.locator('td').nth(4).locator('[title]').first().getAttribute('title');
    kontrol('Hata rozeti üzerine gelince sebep (title)', /İletilemedi: .+/.test(title || ''), title || '');
    kontrol('İletilemeyen satır data-durum="İletilemedi"', (await hataSatir.getAttribute('data-durum')) === 'İletilemedi');
  }
  kontrol('Test satırında gri "Test" rozeti', (await tablo.locator('tbody tr[data-durum="Test"] span', { hasText: /^Test$/ }).count()) >= 1);
  kontrol('Tabloda ikon (svg) YOK', (await tablo.locator('tbody svg').count()) === 0);

  // Sarı/altın dolgu (başlık ikon karesi ve süs çizgisi hariç)
  const sariDolgu = await page.evaluate(() => {
    const kok = document.querySelector('[data-panel-main]') || document.body;
    const sorunlu = [];
    for (const el of kok.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg);
      if (!m) continue;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const a = m[4] === undefined ? 1 : Number(m[4]);
      const sari = (r > 190 && g > 150 && b < 150 && r > b + 50);
      if (sari && a >= 0.12) sorunlu.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} bg=${bg}`);
    }
    return sorunlu;
  });
  const sariDisi = sariDolgu.filter((s) => !/^span\.grid shrink-0 place-items-center/.test(s) && !/^span\.h-px w-\[18px\]/.test(s));
  kontrol('Sarı/altın DOLGU yok (başlık ikon karesi hariç)', sariDisi.length === 0, sariDisi.slice(0, 4).join(' ; '));

  // Sayfalama
  await page.getByRole('button', { name: 'Sonraki', exact: true }).click();
  await bekle();
  kontrol('Sonraki → 10 satır, "51–60 / 60 kayıt", istek page=2', (await satirSayisi()) === 10 && (await sayfaBilgisi()) === '51–60 / 60 kayıt' && sonParam('/iletim-gunlugu?')?.page === '2', `${await satirSayisi()} · ${await sayfaBilgisi()}`);
  await cek('21-sayfa-2', false);
  await page.getByRole('button', { name: 'Önceki', exact: true }).click();
  await bekle();
  kontrol('Önceki → 1. sayfa', (await sayfaBilgisi()) === '1–50 / 60 kayıt');
  await page.getByLabel('Sayfa başına kayıt').selectOption('20');
  await bekle();
  kontrol('Kayıt 20 → 20 satır, Sayfa 1 / 3, istek pageSize=20', (await satirSayisi()) === 20 && /Sayfa 1 \/ 3/.test(await page.locator('section', { has: tablo }).innerText()) && sonParam('/iletim-gunlugu?')?.pageSize === '20');
  await page.getByLabel('Sayfa başına kayıt').selectOption('100');
  await bekle();
  kontrol('Kayıt 100 → 60 satır tek sayfa', (await satirSayisi()) === 60);

  // Sıralama
  await page.getByRole('button', { name: /^Tarih/ }).click();
  await bekle();
  kontrol('Tarih başlığı → artan (istek sira=asc, ilk satır ayın 1\'i)', sonParam('/iletim-gunlugu?')?.sira === 'asc' && /^01\./.test(await hucre(0, 0)), await hucre(0, 0));
  await page.getByRole('button', { name: /^Tarih/ }).click();
  await bekle();
  // (aynı sorgu önbellekte — istek atılmayabilir; tablo durumu ve aria-sort yeter)
  kontrol('Tarih başlığı → yine azalan (aria-sort=descending)', (await page.getByRole('button', { name: /^Tarih/ }).getAttribute('aria-sort')) === 'descending' && /^14\./.test(await hucre(0, 0)), await hucre(0, 0));

  // Ara
  await page.getByLabel('Ara', { exact: true }).fill('kdv1');
  await page.waitForTimeout(900);
  {
    const adlar = await satirlar().evaluateAll((trs) => trs.map((t) => t.querySelectorAll('td')[3].innerText));
    kontrol('Ara "kdv1" → yalnız KDV1 satırları (12), istek q=kdv1', adlar.length === 12 && adlar.every((a) => /KDV1/.test(a)) && sonParam('/iletim-gunlugu?')?.q === 'kdv1', `${adlar.length}`);
  }
  await cek('22-arama', false);
  await page.getByLabel('Aramayı temizle').click();
  await page.waitForTimeout(900);
  kontrol('Arama temizlenince 60', (await satirSayisi()) === 60);

  // Süzgeç: Tür = İletilmeyen Raporlar → Filtrele
  await page.getByLabel('Tür', { exact: true }).selectOption('iletilmeyen');
  kontrol('Filtrele\'ye basılmadan tablo değişmez (60)', (await satirSayisi()) === 60);
  await filtrele();
  kontrol('İletilmeyen Raporlar → 8 satır, hepsinde Hata rozeti, istek durum=iletilmeyen', (await satirSayisi()) === 8 && (await tablo.locator('tbody tr span', { hasText: /^Hata$/ }).count()) === 8 && sonParam('/iletim-gunlugu?')?.durum === 'iletilmeyen', String(await satirSayisi()));
  kontrol('Özet süzgeçle: "8 gönderim · 0 iletildi · 8 iletilemedi"', /8 gönderim · 0 iletildi · 8 iletilemedi/.test(await ozet()), await ozet());
  await cek('23-iletilmeyen', false);

  // Süzgeç: Tür Tümü + Belge Türü = Cari Kasa
  await page.getByLabel('Tür', { exact: true }).selectOption('tumu');
  await page.getByLabel('Belge Türü').selectOption('Cari Kasa');
  await filtrele();
  kontrol('Belge Türü Cari Kasa → 4 satır, istek belgeTuru=Cari Kasa', (await satirSayisi()) === 4 && sonParam('/iletim-gunlugu?')?.belgeTuru === 'Cari Kasa', String(await satirSayisi()));
  kontrol('Cari Kasa belge adı "… Hesap Dökümü" / "Tahsilat hatırlatma"', /Hesap Dökümü|Tahsilat hatırlatma/.test(await hucre(0, 3)), await hucre(0, 3));

  // Süzgeç: Belge Türü Tümü + Gönderim Şekli = Mail
  await page.getByLabel('Belge Türü').selectOption('');
  await page.getByLabel('Gönderim Şekli').selectOption('EMAIL');
  await filtrele();
  {
    const kanallar = await satirlar().evaluateAll((trs) => trs.map((t) => t.getAttribute('data-kanal')));
    kontrol('Gönderim Şekli Mail → yalnız Mail satırları (23), istek kanal=EMAIL', kanallar.length === 23 && kanallar.every((k) => k === 'Mail') && sonParam('/iletim-gunlugu?')?.kanal === 'EMAIL', String(kanallar.length));
  }
  await cek('24-mail', false);

  // Süzgeç: Mükellef seçici (arama kutulu) → Mert Reklam
  await page.getByLabel('Gönderim Şekli').selectOption('');
  await page.getByRole('button', { name: /Tüm mükellefler/ }).click();
  await page.getByPlaceholder('Ara — ad veya VKN…').fill('mert');
  await page.waitForTimeout(200);
  await page.locator('div[style*="z-index: 9999"]').getByText('Mert Reklam Ajansı Ltd. Şti.', { exact: true }).click();
  await filtrele();
  {
    const adlar = await satirlar().evaluateAll((trs) => trs.map((t) => t.querySelectorAll('td')[1].innerText));
    kontrol('Mükellef Mert Reklam → yalnız onun satırları (7), istek taxpayerId=m4', adlar.length === 7 && adlar.every((a) => /Mert Reklam/.test(a)) && sonParam('/iletim-gunlugu?')?.taxpayerId === 'm4', `${adlar.length} · ${JSON.stringify(sonParam('/iletim-gunlugu?'))}`);
  }
  await cek('25-mukellef', false);

  // Excel İndir → GET /iletim-gunlugu/excel aynı süzgeçlerle + indirme
  const indirme = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.getByRole('button', { name: 'Excel İndir' }).click();
  const d = await indirme;
  {
    const p = sonParam('/iletim-gunlugu/excel');
    kontrol('Excel isteği aynı süzgeçlerle (taxpayerId=m4, month, durum) ve sayfa=1', !!p && p.taxpayerId === 'm4' && /^\d{4}-\d{2}$/.test(p.month) && p.durum === 'tumu' && p.page === '1', JSON.stringify(p));
    kontrol('Excel dosyası indi (iletim-gunlugu-YYYY-MM.xlsx)', !!d && /^iletim-gunlugu-\d{4}-\d{2}\.xlsx$/.test(d.suggestedFilename()), d && d.suggestedFilename());
    if (d) {
      const yol = path.join(CIKIS, d.suggestedFilename());
      await d.saveAs(yol);
      const bas = fs.readFileSync(yol).subarray(0, 2).toString();
      kontrol('İndirilen dosya gerçek xlsx (PK)', bas === 'PK', bas);
    }
  }

  // Temizle → tüm mükellefler, bu ay
  await page.getByRole('button', { name: 'Temizle' }).click();
  await bekle();
  kontrol('Temizle → 60 satır', (await satirSayisi()) === 60, String(await satirSayisi()));

  // Başarısızları yeniden dene (3) → POST /resend-failed {month}
  const yenidenDugme = page.getByRole('button', { name: /Başarısızları yeniden dene \(\d+\)/ });
  kontrol('"Başarısızları yeniden dene (3)" — Beyanname/SGK/Tebligat hatalı (mükellef,tür) çiftleri', /\(3\)/.test(await yenidenDugme.innerText()), await yenidenDugme.innerText());
  await yenidenDugme.click();
  await page.waitForTimeout(1200);
  {
    const i = sonIstek('POST', '/akilli-bildirim/resend-failed');
    const g = i ? JSON.parse(i.govde || '{}') : null;
    kontrol('POST /akilli-bildirim/resend-failed {month} — yalnız ay', !!g && /^\d{4}-\d{2}$/.test(g.month) && Object.keys(g).length === 1, i && i.govde);
  }

  // Dönem: önceki ay → Filtrele
  const ayGirdi = page.getByLabel('Ay', { exact: true });
  const ayOnce = await ayGirdi.inputValue();
  await page.getByTitle('Önceki ay').click();
  const aySonra = await ayGirdi.inputValue();
  kontrol('Önceki ay düğmesi Filtrele\'ye kadar tabloyu değiştirmez', ayOnce !== aySonra && (await satirSayisi()) === 60, `${ayOnce} → ${aySonra}`);
  await filtrele();
  kontrol('Önceki ay → istek month=önceki, hepsi iletildi, Hata rozeti yok', sonParam('/iletim-gunlugu?')?.month === aySonra && (await satirSayisi()) > 0 && (await tablo.locator('tbody tr span', { hasText: /^Hata$/ }).count()) === 0 && /0 iletilemedi/.test(await ozet()), await ozet());
  await cek('26-onceki-ay', false);
  await page.getByTitle('Sonraki ay').click();
  await page.getByTitle('Sonraki ay').click();
  await filtrele();
  kontrol('Boş ay → "Bu süzgeçlere uyan gönderim yok." ve "0 kayıt"', /gönderim yok/.test(await tablo.innerText()) && (await sayfaBilgisi()) === '0 kayıt', await sayfaBilgisi());
  await page.getByTitle('Önceki ay').click();
  await filtrele();
  kontrol('Bu aya dönüş → 60', (await satirSayisi()) === 60);

  // Dar ekran 1000px
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(600);
  await cek('27-genel-1000');

  await browser.close();
  console.log('\n' + kontroller.join('\n'));
  console.log(hatalar.length ? `\n✗ ${hatalar.length} sorun:\n - ${hatalar.join('\n - ')}` : '\n✓ konsol hatası 0, yatay taşma yok, tüm kontroller geçti');
  console.log('Klasör:', CIKIS);
  process.exit(hatalar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
