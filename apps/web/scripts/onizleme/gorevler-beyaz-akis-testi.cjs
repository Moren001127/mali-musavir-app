// Görevler & Notlar — işlevsel akış testi, beyaz tema (sahte çift: web 3007 + API 3006; veri bellekte, her koşuda değişir)
//   node apps/web/scripts/onizleme/gorevler-beyaz-akis-testi.cjs [çıkış klasörü]   (varsayılan: _previews/beyaz-modul/gorevler)
// Kapsam: tamamla / ertele / hızlı not / ekip isteği kapat / akıllı giriş (mükellef + tarih çipi, Enter) / not olarak kaydet /
// toplu işlem / detay paneli kaydet + ekibe ver / mükellef süzgeci / Kanban taşı / Takvim gün seç / hata durumu.
// 2026-09-14 sonrası kaldırılan şablon düğmeleri ve Mali Takvim satırları bu testte YOK (eski gorevler-onizleme-akis-testi.cjs'ten uyarlandı).
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));

const CIKIS = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul', 'gorevler');
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;
fs.mkdirSync(CIKIS, { recursive: true });
const sorunlar = [];
const kontrol = (ad, kosul) => {
  if (!kosul) sorunlar.push(ad);
  console.log(kosul ? '  ✓' : '  ✗', ad);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2, locale: 'tr-TR' });
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
      await page.getByText(metin, { exact: false }).first().waitFor({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };

  // Giriş
  await page.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await page.locator('input[type=password]').fill('sahte-deneme-1');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/panel/, { timeout: 60000 });
  await page.goto(`${KOK}/panel/gorevler`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await page.getByRole('tab', { name: /Ajanda/ }).click();
  await page.waitForTimeout(500);
  kontrol('Beyaz tema etkin (html[data-theme=D])', (await page.locator('html').getAttribute('data-theme')) === 'D');

  // 1) Tamamla (ilk gecikmiş satır: Mert Reklam tahsilat araması)
  const gecikmisOnce = await page.getByRole('button', { name: /^Gecikmiş/ }).innerText();
  await page.locator('table tbody tr').filter({ hasText: 'Mert Reklam tahsilat araması' }).locator('button[title="Tamamla"]').click();
  kontrol('Tamamla → "Görev tamamlandı" bildirimi', await toastBekle('Görev tamamlandı'));
  await page.waitForTimeout(900);
  kontrol('Tamamla → satır listeden düştü', (await page.locator('table tbody tr').filter({ hasText: 'Mert Reklam tahsilat araması' }).count()) === 0);
  const gecikmisSonra = await page.getByRole('button', { name: /^Gecikmiş/ }).innerText();
  kontrol(`Gecikmiş sayacı düştü (${gecikmisOnce.replace(/\s+/g, ' ')} → ${gecikmisSonra.replace(/\s+/g, ' ')})`, gecikmisOnce !== gecikmisSonra);

  // 2) Ertele (Öz Ela Ağustos KDV kontrolü → 3 gün sonra)
  await page.locator('table tbody tr').filter({ hasText: 'Öz Ela Ağustos KDV kontrolü' }).locator('button[title="Ertele"]').click();
  await page.getByRole('menuitem', { name: /3 gün sonra/ }).click();
  kontrol('Ertele → "Ertelendi" bildirimi', await toastBekle('Ertelendi ·'));
  await page.waitForTimeout(900);
  kontrol('Ertele → satırda "Ertelendi →" rozeti', (await page.locator('table tbody tr').filter({ hasText: 'Öz Ela Ağustos KDV kontrolü' }).getByText(/Ertelendi →/).count()) > 0);

  // 3) Hızlı not
  await page.locator('table tbody tr').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).locator('button[title="Not ekle"]').click();
  await page.getByPlaceholder('Not yaz…', { exact: false }).fill('Ziraat şubesi arandı, ekstre yarın gelecek.');
  await cek('31-hizli-not-menusu');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  kontrol('Hızlı not → "Not eklendi"', await toastBekle('Not eklendi'));
  await page.waitForTimeout(800);
  kontrol('Hızlı not → satırda not sayısı 1', (await page.locator('table tbody tr').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).locator('[title="1 not"]').count()) === 1);

  // 4) Ekip isteği "Yapıldı"
  const istekOnce = await page.getByRole('button', { name: /^Sizden istenen/ }).innerText();
  await page.locator('table tbody tr').filter({ hasText: 'Famcoffee — Ağustos kira faturası eksik' }).getByTitle('Yapıldı — isteği kapat').click();
  kontrol('İstek kapat → bildirim', await toastBekle('İstek kapatıldı'));
  await page.waitForTimeout(900);
  const istekSonra = await page.getByRole('button', { name: /^Sizden istenen/ }).innerText();
  kontrol(`İstek sayacı düştü (${istekOnce.replace(/\s+/g, ' ')} → ${istekSonra.replace(/\s+/g, ' ')})`, istekOnce !== istekSonra);

  // 5) Akıllı giriş: metin + mükellef çipi + tarih çipi + Enter
  const giris = page.getByLabel('Akıllı görev girişi');
  await giris.fill('Banka ekstresi iste');
  await page.waitForTimeout(400);
  kontrol('Akıllı giriş → tarih BOŞ çipi', (await page.getByTitle('Vade tarihi — değiştirmek için tıkla').innerText()).includes('Tarih yok'));
  kontrol('Akıllı giriş → kategori Banka kendiliğinden', (await page.getByTitle('Kategori — değiştirmek için tıkla').innerText()).includes('Banka'));
  await page.getByTitle('Mükellef — değiştirmek için tıkla').click();
  await page.getByPlaceholder('Ad ya da VKN ara…').fill('famco');
  await page.getByRole('menuitem', { name: /Famcoffee/ }).click();
  kontrol('Mükellef çipi seçildi', (await page.getByTitle('Mükellef — değiştirmek için tıkla').innerText()).includes('Famcoffee'));
  await page.getByTitle('Vade tarihi — değiştirmek için tıkla').click();
  await page.getByRole('menuitem', { name: /^Yarın/ }).click();
  await cek('32-akilli-giris-cipler');
  await giris.press('Enter');
  kontrol('Akıllı giriş Enter → "Görev eklendi"', await toastBekle('Görev eklendi'));
  await page.waitForTimeout(900);
  kontrol('Akıllı giriş → Yarın grubunda Famcoffee satırı', (await page.locator('table tbody tr').filter({ hasText: 'Banka ekstresi iste' }).filter({ hasText: 'Famcoffee' }).count()) >= 1);

  // 6) Not olarak kaydet
  await giris.fill('Muzaffer Bey ile Balçık İnşaat hakediş konuşuldu');
  await page.getByText('Not olarak kaydet').click();
  kontrol('Not anahtarı → düğme "Not kaydet"', (await page.getByRole('button', { name: /Not kaydet/ }).count()) === 1);
  await giris.press('Enter');
  kontrol('Not → "Not kaydedildi"', await toastBekle('Not kaydedildi'));
  await page.waitForTimeout(900);
  kontrol('Not → Notlar bölümünde görünür', (await page.getByText('Muzaffer Bey ile Balçık İnşaat hakediş konuşuldu').count()) >= 1);

  // 7) Toplu: 2 satır seç → öncelik ACİL
  const kutular = page.locator('table tbody input[type=checkbox][title="Seç"]');
  await kutular.nth(0).check();
  await kutular.nth(1).check();
  await page.getByTitle('Seçilenlerin önceliğini değiştir').click();
  await cek('33-toplu-oncelik-menusu');
  await page.getByRole('menuitem', { name: 'ACİL' }).click();
  kontrol('Toplu öncelik → "2 kayıt güncellendi"', await toastBekle('2 kayıt güncellendi'));
  await page.waitForTimeout(700);
  kontrol('Toplu → seçim temizlendi', (await page.getByTitle('Seçimi bırak').count()) === 0);

  // 8) Detay paneli: başlık düzenle + kaydet, ekibe ver (kuru)
  await page.locator('table tbody tr').filter({ hasText: 'Ayşegül Kaya işe giriş bildirgesi' }).locator('button[title="Detayı aç"]').click();
  await page.waitForSelector('aside[role=dialog]');
  await page.waitForTimeout(700);
  const baslik = page.getByLabel('Başlık');
  await baslik.fill('Ayşegül Kaya işe giriş bildirgesi (SGK)');
  await page.getByTitle('Değişiklikleri kaydet (Enter)').click();
  kontrol('Panel kaydet → "Kaydedildi"', await toastBekle('Kaydedildi'));
  await page.waitForTimeout(800);
  kontrol('Panel kaydet → listede yeni başlık', (await page.locator('table tbody tr').filter({ hasText: 'Ayşegül Kaya işe giriş bildirgesi (SGK)' }).count()) >= 1);
  await page.getByTitle("Görevi Ekip'e ver").click();
  kontrol('Ekibe ver → bildirim', await toastBekle('Ekibe verildi (kuru test)'));
  await page.waitForTimeout(1000);
  kontrol('Ekibe ver → "Konsolda aç" bağlantısı', (await page.locator('aside[role=dialog]').getByText('Konsolda aç').count()) >= 1);
  kontrol('Ekibe ver → not zincirine düştü', (await page.locator('aside[role=dialog]').getByText(/Ekibe verildi \(kuru test\) — iş/).count()) >= 1);
  await page.locator('aside[role=dialog] .overflow-y-auto').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await cek('34-detay-paneli-ekibe-verildi');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  kontrol('Esc → panel kapandı', (await page.locator('aside[role=dialog]').count()) === 0);

  // 9) Süzgeç: Mükellef = Öz Ela → yalnız Öz Ela satırları
  await page.getByTitle('Mükellefe göre süz').click();
  await page.getByPlaceholder('Ad ya da VKN ara…').fill('öz ela');
  await page.getByRole('menuitem', { name: /Öz Ela/ }).first().click();
  await page.waitForTimeout(1000);
  const satirlar = await page.locator('table tbody tr').filter({ has: page.locator('button[title="Detayı aç"]') }).allInnerTexts();
  kontrol(`Mükellef süzgeci → tüm satırlar Öz Ela (${satirlar.length} satır)`, satirlar.length > 0 && satirlar.every((s) => s.includes('Öz Ela')));
  await cek('35-mukellef-suzgec');
  await page.getByTitle('Süzgeçleri temizle').click();
  await page.waitForTimeout(800);

  // 10) Kanban: kartı Sürüyor'a taşı
  await page.getByRole('tab', { name: /Kanban/ }).click();
  await page.waitForTimeout(1200);
  const kart = page.locator('[data-gorev-kart]').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).first();
  await kart.getByTitle('Sürüyor sütununa taşı').click();
  kontrol('Kanban taşı → "Görev başlatıldı"', await toastBekle('Görev başlatıldı'));
  await page.waitForTimeout(900);
  kontrol('Kanban → kart Sürüyor sütununda', (await page.locator('[data-gorev-sutun="IN_PROGRESS"] [data-gorev-kart]').filter({ hasText: 'Erdoğan Balçık banka ekstresi eksik' }).count()) === 1);
  await cek('36-kanban-tasindi');

  // 11) Takvim: bir gün seç → alttaki liste o günün görevlerini gösterir
  await page.getByRole('tab', { name: /Takvim/ }).click();
  await page.waitForTimeout(900);
  const doluGun = page.locator('[data-gorev-gun]').filter({ has: page.locator('[data-gorev-gun-sayi]') }).filter({ hasNot: page.locator('[data-bugun="true"]') }).nth(1);
  const gunBaslik = await doluGun.getAttribute('title');
  await doluGun.click();
  await page.waitForTimeout(600);
  const gunSayi = Number((gunBaslik || '').match(/(\d+) görev/)?.[1] || 0);
  const listeSayi = await page.locator('table tbody tr').filter({ has: page.locator('button[title="Detayı aç"]') }).count();
  kontrol(`Takvim gün seç → liste günün görevlerini gösterir (${gunSayi} = ${listeSayi})`, gunSayi > 0 && gunSayi === listeSayi);
  kontrol('Takvim → seçili gün vurgulu', (await doluGun.getAttribute('data-secili')) === 'true');
  await cek('37-takvim-gun-secili');

  // 12) Hata durumu: sahte API kapalıymış gibi → "Veri alınamadı"
  await page.getByRole('tab', { name: /Ajanda/ }).click();
  await ctx.route('**/api/v1/tasks/ajanda**', (r) => r.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const hata = await page.getByText('Veri alınamadı').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  kontrol('Hata durumu → "Veri alınamadı · Tekrar dene"', hata && (await page.getByRole('button', { name: /Tekrar dene/ }).count()) === 1);
  await cek('38-hata-durumu');
  await ctx.unroute('**/api/v1/tasks/ajanda**');
  await page.getByRole('button', { name: /Tekrar dene/ }).click();
  kontrol('Tekrar dene → tablo geldi', await page.waitForSelector('table', { timeout: 20000 }).then(() => true).catch(() => false));

  await browser.close();
  console.log(sorunlar.length ? `\n✗ ${sorunlar.length} sorun:\n - ${sorunlar.join('\n - ')}` : '\n✓ tüm akışlar geçti, konsol hatası 0');
  process.exit(sorunlar.length ? 1 : 0);
})().catch((e) => {
  console.error('HATA', e);
  process.exit(2);
});
