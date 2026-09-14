// Kullanım: node apps/web/scripts/mock-api.cjs (arka plan; her koşuda YENİDEN başlatın, veri bellekte) + web dev sunucusu, sonra
//          node apps/web/scripts/gorevler-onizleme-akis-testi.cjs [çıkış klasörü]
// Görevler & Notlar — işlevsel akış testi (sahte API'ye karşı): tamamla / ertele / not / istek kapat / takvimden görev /
// toplu işlem / şablon / not olarak kaydet / detay paneli kaydet + ekibe ver. Her adımda beklenen metin doğrulanır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../luca-local-agent/node_modules/playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '../../../_previews/gorevler');
fs.mkdirSync(CIKIS, { recursive: true });
const URL = 'http://localhost:3000/panel/gorevler';
const sorunlar = [];
const kontrol = (ad, kosul) => {
  if (!kosul) sorunlar.push(ad);
  console.log(kosul ? '  ✓' : '  ✗', ad);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'tr-TR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => sorunlar.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) sorunlar.push(`console: ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept());
  const cek = async (ad) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(CIKIS, `${ad}.png`) });
  };
  const toastBekle = async (metin) => {
    try {
      await page.getByText(metin, { exact: false }).first().waitFor({ timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  };

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('table');

  // 1) Tamamla (ilk gecikmiş satır: Mert Reklam tahsilat araması)
  const gecikmisOnce = await page.getByRole('button', { name: /^Gecikmiş/ }).innerText();
  await page.locator('table tbody tr').filter({ hasText: 'Mert Reklam tahsilat araması' }).locator('button[title="Tamamla"]').click();
  kontrol('Tamamla → "Görev tamamlandı" bildirimi', await toastBekle('Görev tamamlandı'));
  await page.waitForTimeout(800);
  kontrol('Tamamla → satır listeden düştü', (await page.locator('table tbody tr').filter({ hasText: 'Mert Reklam tahsilat araması' }).count()) === 0);
  const gecikmisSonra = await page.getByRole('button', { name: /^Gecikmiş/ }).innerText();
  kontrol(`Gecikmiş sayacı düştü (${gecikmisOnce.replace(/\s+/g, ' ')} → ${gecikmisSonra.replace(/\s+/g, ' ')})`, gecikmisOnce !== gecikmisSonra);

  // 2) Ertele (Öz Ela Ağustos KDV kontrolü → 3 gün sonra)
  await page.locator('table tbody tr').filter({ hasText: 'Öz Ela Ağustos KDV kontrolü' }).locator('button[title="Ertele"]').click();
  await page.getByRole('menuitem', { name: /3 gün sonra/ }).click();
  kontrol('Ertele → "Ertelendi" bildirimi', await toastBekle('Ertelendi ·'));
  await page.waitForTimeout(800);
  kontrol('Ertele → satırda "Ertelendi →" rozeti', (await page.locator('table tbody tr').filter({ hasText: 'Öz Ela Ağustos KDV kontrolü' }).getByText(/Ertelendi →/).count()) > 0);

  // 3) Hızlı not
  await page.locator('table tbody tr').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).locator('button[title="Not ekle"]').click();
  await page.getByPlaceholder('Not yaz…', { exact: false }).fill('Ziraat şubesi arandı, ekstre yarın gelecek.');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  kontrol('Hızlı not → "Not eklendi"', await toastBekle('Not eklendi'));
  await page.waitForTimeout(700);
  kontrol('Hızlı not → satırda not sayısı 1', (await page.locator('table tbody tr').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).locator('[title="1 not"]').count()) === 1);

  // 4) Ekip isteği "Yapıldı"
  const istekOnce = await page.getByRole('button', { name: /^Sizden istenen/ }).innerText();
  await page.locator('table tbody tr').filter({ hasText: 'Famcoffee — Ağustos kira faturası eksik' }).getByTitle('Yapıldı — isteği kapat').click();
  kontrol('İstek kapat → bildirim', await toastBekle('İstek kapatıldı'));
  await page.waitForTimeout(800);
  const istekSonra = await page.getByRole('button', { name: /^Sizden istenen/ }).innerText();
  kontrol(`İstek sayacı düştü (${istekOnce.replace(/\s+/g, ' ')} → ${istekSonra.replace(/\s+/g, ' ')})`, istekOnce !== istekSonra);

  // 5) Takvimden görev yap (Damga Vergisi)
  const damga = page.locator('table tbody tr').filter({ hasText: 'Damga Vergisi Beyannamesi' }).first();
  kontrol('Takvim satırı görünür (Damga Vergisi)', (await damga.count()) === 1);
  await damga.getByTitle('Bu takvim kaleminden görev aç').click();
  kontrol('Takvimden görev → bildirim', await toastBekle('Görev açıldı'));
  await page.waitForTimeout(900);
  kontrol('Takvimden görev → "görev var" işareti', (await page.locator('table tbody tr').filter({ hasText: 'Damga Vergisi Beyannamesi' }).getByText('görev var').count()) >= 1);
  kontrol('Takvimden görev → yeni görev satırı (Takvim rozeti)', (await page.locator('table tbody tr').filter({ hasText: 'Damga Vergisi Beyannamesi — Ağustos 2026' }).count()) >= 1);
  await cek('31-akis-tamamla-ertele-not-takvim');

  // 6) Şablon + mükellef çipi + Enter
  const giris = page.getByLabel('Akıllı görev girişi');
  await page.getByRole('button', { name: /Banka ekstresi iste/ }).first().click();
  kontrol('Şablon → metin doldu', (await giris.inputValue()) === 'Banka ekstresi iste');
  kontrol('Şablon → tarih BOŞ çipi', (await page.getByTitle('Vade tarihi — değiştirmek için tıkla').innerText()).includes('Tarih yok'));
  kontrol('Şablon → kategori Banka', (await page.getByTitle('Kategori — değiştirmek için tıkla').innerText()).includes('Banka'));
  await page.getByTitle('Mükellef — değiştirmek için tıkla').click();
  await page.getByPlaceholder('Ad ya da VKN ara…').fill('famco');
  await page.getByRole('menuitem', { name: /Famcoffee/ }).click();
  kontrol('Mükellef çipi seçildi', (await page.getByTitle('Mükellef — değiştirmek için tıkla').innerText()).includes('Famcoffee'));
  await page.getByTitle('Vade tarihi — değiştirmek için tıkla').click();
  await page.getByRole('menuitem', { name: /^Yarın/ }).click();
  await cek('32-sablon-cipler');
  await giris.press('Enter');
  kontrol('Şablon Enter → "Görev eklendi"', await toastBekle('Görev eklendi'));
  await page.waitForTimeout(900);
  kontrol('Şablon → Yarın grubunda Famcoffee satırı', (await page.locator('table tbody tr').filter({ hasText: 'Banka ekstresi iste' }).filter({ hasText: 'Famcoffee' }).count()) >= 1);

  // 7) Not olarak kaydet
  await giris.fill('Muzaffer Bey ile Balçık İnşaat hakediş konuşuldu');
  await page.getByText('Not olarak kaydet').click();
  kontrol('Not anahtarı → düğme "Not kaydet"', (await page.getByRole('button', { name: /Not kaydet/ }).count()) === 1);
  await giris.press('Enter');
  kontrol('Not → "Not kaydedildi"', await toastBekle('Not kaydedildi'));
  await page.waitForTimeout(900);
  kontrol('Not → Notlar bölümünde görünür', (await page.getByText('Muzaffer Bey ile Balçık İnşaat hakediş konuşuldu').count()) >= 1);

  // 8) Toplu: 2 satır seç → öncelik ACİL
  const kutular = page.locator('table tbody input[type=checkbox][title="Seç"]');
  await kutular.nth(0).check();
  await kutular.nth(1).check();
  await page.getByTitle('Seçilenlerin önceliğini değiştir').click();
  await page.getByRole('menuitem', { name: 'ACİL' }).click();
  kontrol('Toplu öncelik → "2 kayıt güncellendi"', await toastBekle('2 kayıt güncellendi'));
  await page.waitForTimeout(600);
  kontrol('Toplu → seçim temizlendi', (await page.getByTitle('Seçimi bırak').count()) === 0);

  // 9) Detay paneli: başlık düzenle + kaydet, ekibe ver (kuru)
  await page.locator('table tbody tr').filter({ hasText: 'Ayşegül Kaya işe giriş bildirgesi' }).locator('button[title="Detayı aç"]').click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(600);
  const baslik = page.getByLabel('Başlık');
  await baslik.fill('Ayşegül Kaya işe giriş bildirgesi (SGK)');
  await page.getByTitle('Değişiklikleri kaydet (Enter)').click();
  kontrol('Panel kaydet → "Kaydedildi"', await toastBekle('Kaydedildi'));
  await page.waitForTimeout(700);
  kontrol('Panel kaydet → listede yeni başlık', (await page.locator('table tbody tr').filter({ hasText: 'Ayşegül Kaya işe giriş bildirgesi (SGK)' }).count()) >= 1);
  await page.getByTitle("Görevi Ekip'e ver").click();
  kontrol('Ekibe ver → bildirim', await toastBekle('Ekibe verildi (kuru test)'));
  await page.waitForTimeout(900);
  kontrol('Ekibe ver → "Konsolda aç" bağlantısı', (await page.locator('aside[role=dialog]').getByText('Konsolda aç').count()) >= 1);
  kontrol('Ekibe ver → not zincirine düştü', (await page.locator('aside[role=dialog]').getByText(/Ekibe verildi \(kuru test\) — iş/).count()) >= 1);
  // panel içini kaydır → alt bölümler
  await page.locator('aside[role=dialog] .overflow-y-auto').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await cek('33-detay-paneli-alt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  kontrol('Esc → panel kapandı', (await page.locator('aside[role=dialog]').count()) === 0);

  // 10) Süzgeç: Mükellef = Öz Ela → yalnız Öz Ela satırları
  await page.getByTitle('Mükellefe göre süz').click();
  await page.getByPlaceholder('Ad ya da VKN ara…').fill('öz ela');
  await page.getByRole('menuitem', { name: /Öz Ela/ }).click();
  await page.waitForTimeout(900);
  const satirlar = await page.locator('table tbody tr').filter({ has: page.locator('button[title="Detayı aç"]') }).allInnerTexts();
  kontrol(`Mükellef süzgeci → tüm satırlar Öz Ela (${satirlar.length} satır)`, satirlar.length > 0 && satirlar.every((s) => s.includes('Öz Ela')));
  await cek('34-mukellef-suzgec');
  await page.getByTitle('Süzgeçleri temizle').click();

  // 11) Ajanda alt bölümü (Sonra / Tarihsiz / Notlar)
  await page.locator('[data-panel-main]').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await cek('35-ajanda-alt');

  // 12) Hata durumu: sahte API kapalıymış gibi → "Veri alınamadı"
  await ctx.route('**/api/v1/tasks/ajanda**', (r) => r.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const hata = await page.getByText('Veri alınamadı').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  kontrol('Hata durumu → "Veri alınamadı · Tekrar dene"', hata && (await page.getByRole('button', { name: /Tekrar dene/ }).count()) === 1);
  await cek('36-hata-durumu');
  await ctx.unroute('**/api/v1/tasks/ajanda**');
  await page.getByRole('button', { name: /Tekrar dene/ }).click();
  kontrol('Tekrar dene → tablo geldi', await page.waitForSelector('table', { timeout: 15000 }).then(() => true).catch(() => false));

  await browser.close();
  console.log(sorunlar.length ? `\n✗ ${sorunlar.length} sorun:\n - ${sorunlar.join('\n - ')}` : '\n✓ tüm akışlar geçti, konsol hatası 0');
  process.exit(sorunlar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
