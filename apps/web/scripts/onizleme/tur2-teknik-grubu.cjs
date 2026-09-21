// İkinci tur beyaz tema (D) — teknik grup görüntüleri: Luca Operatörü, Otomasyonlar (liste/yeni/ayrıntı), Mesaj Şablonları,
// Bot Kalite, Masaüstü, Luca Oturumu (+ güvenlik kodu), Ayarlar (ana/entegrasyonlar/kullanıcılar/akıllı bildirim/denetim),
// ortak Luca güvenlik kodu penceresi. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/tur2-teknik-grubu.cjs [modul,modul…] [--cikis=klasor] [--tema=A]
// Her modül: 01 tam sayfa + 02 ilk ekran + ayrıntılar; sahte API'de 404 dönen uçlar ve tarayıcı hataları yazdırılır.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const cikisArg = argv.find((a) => a.startsWith('--cikis='));
const temaArg = argv.find((a) => a.startsWith('--tema='));
const TEMA = temaArg ? temaArg.slice(7) : null;
const KOK_CIKIS = cikisArg ? cikisArg.slice(8) : path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2');
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const API_PORT = process.env.SAHTE_API_PORT || '3006';
const KOK = `http://localhost:${PORT}`;
const API = `http://localhost:${API_PORT}/api/v1`;

const bekle = (pg, ms) => pg.waitForTimeout(ms);
async function goruntu(pg, CIKIS, ad, secici) {
  if (secici) {
    const loc = pg.locator(secici).first();
    if (!(await loc.count())) return false;
    await loc.scrollIntoViewIfNeeded();
    await bekle(pg, 200);
    await loc.screenshot({ path: path.join(CIKIS, ad) });
    return true;
  }
  await pg.screenshot({ path: path.join(CIKIS, ad) });
  return true;
}
/** Yerleşik boş Luca durumu yerine dolu sahte durum (page.route). */
async function lucaDurumYonlendir(pg, varyant = 'status') {
  await pg.unroute(`${API}/luca/session-manager/status`).catch(() => {});
  await pg.route(`${API}/luca/session-manager/status`, (route) => route.continue({ url: `${API}/luca-sahte/session-manager/${varyant}` }));
}

const MODULLER = {
  'luca-operator': {
    yol: '/panel/luca-operator',
    // Sohbet tarayıcıda saklanır ama geliştirme modunda çift bağlanma boşaltıyor; mesajlar sahte akış ucuyla gerçekten yazılır.
    hazirla: async (pg) => { await pg.evaluate(() => localStorage.removeItem('luca-operator-chat-v1')); },
    ayrinti: ['[data-ops-page="luca-operator"] aside'],
    ek: async (pg, CIKIS) => {
      await goruntu(pg, CIKIS, '04-bos-sohbet.png');
      const girdi = pg.locator('[data-ops-page="luca-operator"] input[placeholder]').first();
      for (const m of ['Öz Ela Gıda için Ağustos mizanını çek', 'Aynı dönem için KDV beyannamesi ekranını aç, ne görüyorsun?']) {
        await girdi.fill(m); await girdi.press('Enter'); await bekle(pg, 2600);
      }
      await goruntu(pg, CIKIS, '05-sohbet-dolu.png');
      await goruntu(pg, CIKIS, '06-sohbet-ayrinti.png', '[data-ops-page="luca-operator"] [data-lo-sohbet]');
      await girdi.fill('Bu ay KDV son günü olan mükellefler kim?'); await girdi.press('Enter'); await bekle(pg, 250);
      await goruntu(pg, CIKIS, '07-calisiyor.png');
      await bekle(pg, 2600);
    },
  },
  otomasyonlar: {
    yol: '/panel/otomasyonlar',
    ayrinti: ['[data-ops-page="otomasyonlar"] section.grid', '[data-ops-page="otomasyonlar"] [data-ops-card="interactive"]'],
    ek: async (pg, CIKIS) => {
      const son = pg.getByRole('button', { name: /Son çalışmalar/ });
      if (await son.count()) { await son.click(); await bekle(pg, 400); await goruntu(pg, CIKIS, '05-son-calismalar.png'); }
    },
  },
  'otomasyon-ayrinti': {
    yol: '/panel/otomasyonlar/a1',
    ayrinti: ['[data-ops-page="otomasyonlar"] header', '[data-ops-page="otomasyonlar"] section.grid'],
    ek: async (pg, CIKIS) => {
      const gecmis = pg.getByRole('button', { name: /Çalışma Geçmişi/ });
      if (await gecmis.count()) { await gecmis.click(); await bekle(pg, 500); await tamSayfa(pg, path.join(CIKIS, '05-gecmis.png')); }
      const log = pg.getByRole('button', { name: /Detay Log/ });
      if (await log.count()) { await log.click(); await bekle(pg, 500); await tamSayfa(pg, path.join(CIKIS, '06-log.png')); }
      const tanim = pg.getByRole('button', { name: /^Tanım$/ });
      if (await tanim.count()) { await tanim.click(); await bekle(pg, 300); }
      const duzenle = pg.getByRole('button', { name: /Düzenle/ });
      if (await duzenle.count()) { await duzenle.click(); await bekle(pg, 400); await tamSayfa(pg, path.join(CIKIS, '07-duzenle.png')); }
    },
  },
  'otomasyon-yeni': {
    yol: '/panel/otomasyonlar/yeni',
    ayrinti: ['[data-ops-page="otomasyonlar"] section'],
    ek: async (pg, CIKIS) => {
      const ozet = pg.locator('details > summary').first();
      if (await ozet.count()) { await ozet.click(); await bekle(pg, 300); await tamSayfa(pg, path.join(CIKIS, '05-yetenek-acik.png')); }
    },
  },
  sablonlar: {
    yol: '/panel/sablonlar',
    ayrinti: ['[data-inceleme="sablonlar"] [data-inceleme-sablon]'],
    ek: async (pg, CIKIS) => {
      const kart = pg.locator('[data-inceleme-sablon]').first();
      if (await kart.count()) {
        await kart.click(); await bekle(pg, 700);
        await goruntu(pg, CIKIS, '05-cekmece.png');
        await goruntu(pg, CIKIS, '06-cekmece-duzenleyici.png', '[data-inceleme-yuzey]');
        const eposta = pg.locator('[data-inceleme-yuzey] button', { hasText: 'E-posta' }).last();
        if (await eposta.count()) { await eposta.click(); await bekle(pg, 400); await goruntu(pg, CIKIS, '07-cekmece-eposta-onizleme.png', '[data-inceleme-yuzey]'); }
      }
    },
  },
  'bot-kalite': {
    yol: '/panel/bot-kalite',
    ayrinti: ['[data-bot-kalite] section', '[data-bot-kalite] [data-bk-sayaclar]'],
    ek: async (pg, CIKIS) => {
      const testler = pg.getByRole('button', { name: /Test Senaryoları/ });
      if (await testler.count()) { await testler.click(); await bekle(pg, 500); await tamSayfa(pg, path.join(CIKIS, '05-testler.png')); }
      const rapor = pg.getByRole('button', { name: /Haftalık Rapor/ });
      if (await rapor.count()) { await rapor.click(); await bekle(pg, 500); await tamSayfa(pg, path.join(CIKIS, '06-rapor.png')); }
    },
  },
  masaustu: { yol: '/panel/masaustu', ayrinti: ['[data-masaustu] section'] },
  'ajanlar-luca': {
    yol: '/panel/ajanlar/luca',
    hazirla: async (pg) => lucaDurumYonlendir(pg, 'status'),
    ayrinti: ['[data-ops-page="luca"] > .grid', '[data-ops-page="luca"] section'],
    ek: async (pg, CIKIS) => {
      const guncelle = pg.getByRole('button', { name: /Şifreyi Güncelle/ });
      if (await guncelle.count()) { await guncelle.click(); await bekle(pg, 400); await goruntu(pg, CIKIS, '05-sifre-formu.png', '[data-ops-page="luca"] section'); }
      await lucaDurumYonlendir(pg, 'status-captcha');
      await bekle(pg, 3200);
      await tamSayfa(pg, path.join(CIKIS, '06-guvenlik-kodu.png'));
      await lucaDurumYonlendir(pg, 'status');
    },
  },
  'luca-kod-penceresi': {
    yol: '/panel/masaustu',
    hazirla: async (pg) => lucaDurumYonlendir(pg, 'status-captcha'),
    ayrinti: ['[data-luca-captcha-overlay]'],
    ek: async (pg) => lucaDurumYonlendir(pg, 'status'),
  },
  ayarlar: {
    yol: '/panel/ayarlar',
    ayrinti: ['[data-ops-page="ayarlar"] .grid'],
    ek: async (pg, CIKIS) => {
      for (const id of ['2fa', 'agent', 'portal-creds']) {
        const dugme = pg.locator(`[id="${id}"] button`).first();
        if (await dugme.count()) { await dugme.click(); await bekle(pg, 500); }
      }
      await tamSayfa(pg, path.join(CIKIS, '05-bolumler-acik.png'));
      const etkin = pg.locator('[id="2fa"]').getByRole('button', { name: /Etkinleştir/ }).first();
      if (await etkin.count()) { await etkin.click(); await bekle(pg, 600); await goruntu(pg, CIKIS, '06-2fa-kurulum.png', '[id="2fa"]'); }
    },
  },
  'ayarlar-entegrasyonlar': { yol: '/panel/ayarlar/entegrasyonlar', ayrinti: ['[data-ops-page="ayarlar"] section'] },
  'ayarlar-kullanicilar': {
    yol: '/panel/ayarlar/kullanicilar',
    ayrinti: ['[data-ops-page="ayarlar"] table'],
    ek: async (pg, CIKIS) => {
      const yeni = pg.getByRole('button', { name: /Yeni Kullanıcı/ });
      if (await yeni.count()) { await yeni.click(); await bekle(pg, 500); await goruntu(pg, CIKIS, '05-yeni-kullanici.png'); await pg.keyboard.press('Escape'); }
    },
  },
  'ayarlar-akilli-bildirim': {
    yol: '/panel/ayarlar/akilli-bildirim',
    // Ayar listesi kdv-grubu eklentisinde başka biçimde; dolu liste teknik-grubu'nun ayrı yolundan gelir.
    hazirla: async (pg) => { await pg.route(`${API}/akilli-bildirim/settings`, (route) => route.continue({ url: `${API}/akilli-sahte/settings` })); },
    ayrinti: ['[data-ops-page="ayarlar"] .grid'],
    ek: async (pg, CIKIS) => {
      const sgk = pg.getByRole('button', { name: /^e-Tebligat$/ });
      if (await sgk.count()) { await sgk.click(); await bekle(pg, 500); await tamSayfa(pg, path.join(CIKIS, '05-etebligat-test-modu.png')); }
    },
  },
  'ayarlar-denetim': { yol: '/panel/ayarlar/denetim', ayrinti: ['[data-ops-page="ayarlar"] table', '[data-ops-page="ayarlar"] [data-denetim-suzgec]'] },
};
const hedefler = secilen.length ? secilen : Object.keys(MODULLER);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  const hatalar = [];
  const eksikUclar = new Set();
  pg.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => hatalar.push('PAGEERROR ' + String(e).slice(0, 200)));
  pg.on('response', (r) => { if (r.status() === 404 && r.url().includes('/api/v1/')) eksikUclar.add(r.request().method() + ' ' + r.url().replace(/^.*\/api\/v1/, '')); });
  await pg.goto(`${KOK}/giris/musavir`, { waitUntil: 'networkidle', timeout: 120000 });
  await pg.locator('input[type=email]').fill('muzaffer@morenmusavirlik.com');
  await pg.locator('input[type=password]').fill('sahte-deneme-1');
  await pg.locator('button[type=submit]').click();
  await pg.waitForURL(/\/panel/, { timeout: 60000, waitUntil: 'commit' });
  await bekle(pg, 1500);
  if (TEMA) {
    await pg.evaluate((t) => { try { localStorage.setItem('moren-theme', t); document.cookie = `moren-theme=${t}; path=/`; } catch {} document.documentElement.setAttribute('data-theme', t); }, TEMA);
  }
  const rapor = {};
  for (const ad of hedefler) {
    const m = MODULLER[ad];
    if (!m) { console.warn('bilinmeyen modül', ad); continue; }
    const CIKIS = path.join(KOK_CIKIS, ad);
    fs.mkdirSync(CIKIS, { recursive: true });
    hatalar.length = 0; eksikUclar.clear();
    if (typeof m.hazirla === 'function') await m.hazirla(pg);
    await pg.goto(`${KOK}${m.yol}`, { waitUntil: 'networkidle', timeout: 120000 });
    if (TEMA) await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), TEMA);
    await pg.evaluate(() => document.fonts.ready);
    await bekle(pg, 2500);
    await pg.screenshot({ path: path.join(CIKIS, '02-ilk-ekran.png') });
    await tamSayfa(pg, path.join(CIKIS, '01-tam-sayfa.png'));
    let n = 3;
    for (const sec of m.ayrinti || []) {
      try { if (await goruntu(pg, CIKIS, `${String(n).padStart(2, '0')}-ayrinti.png`, sec)) n++; } catch (e) { hatalar.push('ayrinti ' + sec + ': ' + String(e).slice(0, 120)); }
    }
    if (typeof m.ek === 'function') { try { await m.ek(pg, CIKIS, tamSayfa); } catch (e) { hatalar.push('ek: ' + String(e).slice(0, 160)); } }
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[ad] = { hatalar: [...hatalar], eksikUclar: [...eksikUclar], yatayTasma: tasma, cikis: CIKIS };
  }
  console.log(JSON.stringify(rapor, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
