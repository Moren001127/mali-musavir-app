// İkinci tur beyaz tema (D) — ofis grubu görüntüleri: Aylık Ödeme Listesi, Cari Kasa & Tahsilat, İletim Raporu,
// Portal Erişimi, Duyurular, HGS İhlal. Sahte çift: node apps/web/scripts/dev-sahte-ekip.cjs (API 3006 + web 3007)
//   node apps/web/scripts/onizleme/tur2-ofis-grubu.cjs [modul,modul…] [--cikis=klasor]
// Her modül: 01 tam sayfa + 02 ilk ekran + ayrıntılar (sekme/pencere/açılır satır). Sahte API'de 404 dönen uçlar ve
// tarayıcı hataları sonda JSON olarak yazdırılır. Eksik uçlar: apps/web/scripts/mock/ofis-grubu.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.pnpm', 'playwright@1.60.0', 'node_modules', 'playwright'));
const { tamSayfa } = require('./_tam-sayfa.cjs');
const argv = process.argv.slice(2);
const cikisArg = argv.find((a) => a.startsWith('--cikis='));
const KOK_CIKIS = cikisArg ? cikisArg.slice(8) : path.join(__dirname, '..', '..', '..', '..', '_previews', 'beyaz-modul2');
const secilen = argv.filter((a) => !a.startsWith('--')).join(',').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.SAHTE_WEB_PORT || '3007';
const KOK = `http://localhost:${PORT}`;

const bekle = (pg, ms = 900) => pg.waitForTimeout(ms);
const kare = async (pg, dosya) => { await pg.mouse.move(2, 2); await pg.screenshot({ path: dosya }); };

/** Tahsilatlar sekmesi: yerleşik /cari-kasa/hareket ucu mükellef adı vermez; görüntü için zenginleştirilmiş yanıt. */
async function tahsilatRotasi(pg) {
  await pg.route(/\/api\/v1\/cari-kasa\/hareket\?.*tip=TAHSILAT/, (route) => {
    const gun = (n) => new Date(Date.now() + n * 86400000).toISOString();
    const rows = [
      { id: 't1', tarih: gun(-1), tutar: 15000, odemeYontemi: 'HAVALE', belgeNo: 'DK-2026-0912', aciklama: 'Eylül muhasebe ücreti', donem: '2026-09', taxpayer: { companyName: 'Balçık İnşaat A.Ş.', taxNumber: '1400032109' }, account: { id: 'hs-ziraat', name: 'Ziraat Bankası — Vadesiz', color: '#2f9e44' } },
      { id: 't2', tarih: gun(-3), tutar: 4500, odemeYontemi: 'NAKIT', belgeNo: 'MKB-118', aciklama: 'Elden — makbuz', donem: '2026-09', taxpayer: { firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745' }, account: null },
      { id: 't3', tarih: gun(-4), tutar: 2500, odemeYontemi: 'KREDI_KARTI', belgeNo: null, aciklama: null, donem: '2026-09', taxpayer: { firstName: 'Sabri', lastName: 'Aksoy', taxNumber: '12345678901' }, account: { id: 'hs-garanti', name: 'Garanti BBVA — Vadesiz', color: '#0ca678' } },
      { id: 't4', tarih: gun(-6), tutar: 12000, odemeYontemi: 'HAVALE', belgeNo: 'DK-2026-0899', aciklama: 'Eylül muhasebe ücreti', donem: '2026-09', taxpayer: { companyName: 'Famcoffee Kahve A.Ş.', taxNumber: '3850098765' }, account: { id: 'hs-ziraat', name: 'Ziraat Bankası — Vadesiz', color: '#2f9e44' } },
      { id: 't5', tarih: gun(-9), tutar: 3000, odemeYontemi: 'HAVALE', belgeNo: null, aciklama: 'Eylül ücreti', donem: '2026-09', taxpayer: { firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '36985214778' }, account: { id: 'hs-garanti', name: 'Garanti BBVA — Vadesiz', color: '#0ca678' } },
      { id: 't6', tarih: gun(-12), tutar: 8000, odemeYontemi: 'CEK', belgeNo: 'ÇK-4471', aciklama: 'Ağustos bakiyesi', donem: '2026-08', taxpayer: { companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', taxNumber: '6420011234' }, account: { id: 'hs-ziraat', name: 'Ziraat Bankası — Vadesiz', color: '#2f9e44' } },
    ];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
}

const MODULLER = {
  'aylik-odeme': {
    yol: '/panel/aylik-odeme',
    ayrinti: ['[data-testid="cetvel"]', '[data-testid="mukellef-listesi"]'],
    ek: async (pg, CIKIS) => {
      const eks = pg.locator('[data-testid="eksikler-paneli"] button').first();
      if (await eks.count()) { await eks.click(); await bekle(pg, 500); await pg.locator('[data-testid="eksikler-paneli"]').screenshot({ path: path.join(CIKIS, '05-eksikler-acik.png') }); await eks.click(); }
      const menu = pg.locator('button[title="Diğer işlemler"]');
      if (await menu.count()) { await menu.click(); await bekle(pg, 400); await kare(pg, path.join(CIKIS, '06-menu-acik.png')); await pg.keyboard.press('Escape'); }
    },
  },
  'cari-kasa': {
    yol: '/panel/cari-kasa',
    ayrinti: ['main table'],
    once: tahsilatRotasi,
    ek: async (pg, CIKIS, tam) => {
      const sekmeler = [['Otomasyon', '04-otomasyon'], ['Tahsilatlar', '05-tahsilatlar'], ['İstatistik', '06-istatistik']];
      for (const [ad, dosya] of sekmeler) {
        const b = pg.locator('nav button', { hasText: ad }).first();
        if (!(await b.count())) continue;
        await b.click(); await bekle(pg, 1200);
        await tam(pg, path.join(CIKIS, `${dosya}.png`));
      }
      await pg.locator('nav button', { hasText: 'Tahsilat' }).first().click(); await bekle(pg, 600);
      const hizli = pg.locator('button[title="Tahsilat ekle"]').first();
      if (await hizli.count()) { await hizli.click(); await bekle(pg, 700); await kare(pg, path.join(CIKIS, '07-hizli-tahsilat-penceresi.png')); await pg.keyboard.press('Escape'); await pg.locator('button', { hasText: 'Vazgeç' }).first().click().catch(() => {}); await bekle(pg, 300); }
      await pg.goto(`${KOK}/panel/cari-kasa?mukellef=m1`, { waitUntil: 'networkidle', timeout: 120000 }); await bekle(pg, 1500);
      await tam(pg, path.join(CIKIS, '08-mukellef-detay.png'));
      const hz = pg.locator('nav button', { hasText: 'Hizmetler' }).first();
      if (await hz.count()) { await hz.click(); await bekle(pg, 600); await tam(pg, path.join(CIKIS, '09-hizmetler.png')); }
      const th = pg.locator('button', { hasText: 'Tahsilat al' }).first();
      if (await th.count()) { await th.click(); await bekle(pg, 700); await kare(pg, path.join(CIKIS, '10-tahsilat-penceresi.png')); }
    },
  },
  'iletim-raporu': {
    yol: '/panel/iletim-raporu',
    ayrinti: ['[data-testid="iletim-tablosu"]', '[data-testid="suzgec-cubugu"]'],
  },
  'mukellef-erisim': {
    yol: '/panel/mukellef-erisim',
    ayrinti: [],
    /** Sayfa yalnız ADMIN rolüne açık; sahte /auth/me `roles` dizisi vermez → görüntü için eklenir. */
    once: async (pg) => {
      await pg.route(/\/api\/v1\/auth\/me(\?.*)?$/, async (route) => {
        const yanit = await route.fetch();
        const govde = await yanit.json();
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...govde, roles: ['ADMIN'] }) });
      });
    },
    ek: async (pg, CIKIS, tam) => {
      await pg.reload({ waitUntil: 'networkidle' }); await bekle(pg, 1500);
      await kare(pg, path.join(CIKIS, '02-ilk-ekran.png'));
      await tam(pg, path.join(CIKIS, '01-tam-sayfa.png'));
      const ilk = pg.locator('[data-inceleme-yuzey] > button').first();
      if (await ilk.count()) { await ilk.click(); await bekle(pg, 900); await tam(pg, path.join(CIKIS, '03-satir-acik.png')); }
      const ikinci = pg.locator('[data-inceleme-yuzey] > button').nth(2);
      if (await ikinci.count()) { await ikinci.click(); await bekle(pg, 900); await tam(pg, path.join(CIKIS, '04-kapali-satir-acik.png')); }
    },
  },
  'duyurular': {
    yol: '/panel/duyurular',
    ayrinti: [],
    ek: async (pg, CIKIS) => {
      for (const [ad, dosya] of [['Hazır', '03-hazir'], ['Gönderim', '04-gonderim'], ['Geçmiş', '05-gecmis']]) {
        const b = pg.locator('aside button', { hasText: ad }).first();
        if (!(await b.count())) continue;
        await b.click(); await bekle(pg, 700); await kare(pg, path.join(CIKIS, `${dosya}.png`));
      }
      await pg.locator('aside button', { hasText: 'Düzenle' }).first().click(); await bekle(pg, 400);
    },
  },
  'hgs-ihlal': {
    yol: '/panel/galeri/hgs-ihlal',
    ayrinti: ['main table'],
    ek: async (pg, CIKIS) => {
      const ekle = pg.locator('button', { hasText: 'Araç Ekle' }).first();
      if (await ekle.count()) { await ekle.click(); await bekle(pg, 600); await kare(pg, path.join(CIKIS, '04-arac-ekle.png')); await pg.keyboard.press('Escape'); await pg.locator('button', { hasText: 'İptal' }).first().click().catch(() => {}); await bekle(pg, 300); }
      const sonuc = pg.locator('button[title="Sonuç kaydet"]').first();
      if (await sonuc.count()) { await sonuc.click(); await bekle(pg, 900); await kare(pg, path.join(CIKIS, '05-sonuc-penceresi.png')); }
    },
  },
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
  const rapor = {};
  for (const ad of hedefler) {
    const m = MODULLER[ad];
    if (!m) { console.warn('bilinmeyen modül', ad); continue; }
    const CIKIS = path.join(KOK_CIKIS, ad);
    fs.mkdirSync(CIKIS, { recursive: true });
    hatalar.length = 0; eksikUclar.clear();
    if (typeof m.once === 'function') await m.once(pg);
    await pg.goto(`${KOK}${m.yol}`, { waitUntil: 'networkidle', timeout: 120000 });
    await pg.evaluate(() => document.fonts.ready);
    await bekle(pg, 2500);
    await kare(pg, path.join(CIKIS, '02-ilk-ekran.png'));
    await tamSayfa(pg, path.join(CIKIS, '01-tam-sayfa.png'));
    let n = 3;
    for (const sec of m.ayrinti) {
      const loc = pg.locator(sec).first();
      if (await loc.count()) { try { await loc.scrollIntoViewIfNeeded(); await bekle(pg, 200); await loc.screenshot({ path: path.join(CIKIS, `${String(n).padStart(2, '0')}-ayrinti.png`) }); n++; } catch (e) { hatalar.push('ayrinti ' + sec + ': ' + String(e).slice(0, 120)); } }
    }
    if (typeof m.ek === 'function') { try { await m.ek(pg, CIKIS, tamSayfa); } catch (e) { hatalar.push('ek: ' + String(e).slice(0, 200)); } }
    const tasma = await pg.evaluate(() => { const el = document.querySelector('[data-panel-main]') || document.documentElement; return el.scrollWidth > el.clientWidth + 2; });
    rapor[ad] = { hatalar: [...hatalar], eksikUclar: [...eksikUclar], yatayTasma: tasma, cikis: CIKIS };
    await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  }
  console.log(JSON.stringify(rapor, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
