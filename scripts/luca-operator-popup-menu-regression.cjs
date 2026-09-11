// Luca Operatörü v1.47.39 — yerel doğrulama (gerçek Chromium, sahte Luca sayfaları)
// Çalıştır: node scripts/luca-operator-popup-menu-regression.cjs  (apps/luca-local-agent playwright'ı kullanır)
// 1) popup pencere + tablo okuma (readLucaScreenSnapshot.popuplar)
// 2) menü keşfi derinlik/bekleme (readLucaMenuHaritasi)
const fs = require('fs');
const http = require('http');
const path = require('path');
const KOK = path.resolve(__dirname, '..');
const { chromium } = require(path.join(KOK, 'apps/luca-local-agent/node_modules/playwright'));

const RUNTIME = path.join(KOK, 'apps/api/public/agent-runtime.js');
const src = fs.readFileSync(RUNTIME, 'utf8').split(String.fromCharCode(13)).join('');

// Fonksiyon gövdesini kaynak metinden çıkar (süslü parantez dengesiyle)
function extractFn(name) {
  const re = new RegExp('^  (?:async )?function ' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('bulunamadı: ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0; let j = i;
  let inStr = null; let inLineC = false; let inBlockC = false;
  for (; j < src.length; j++) {
    const ch = src[j]; const nx = src[j + 1];
    if (inLineC) { if (ch === '\n') inLineC = false; continue; }
    if (inBlockC) { if (ch === '*' && nx === '/') { inBlockC = false; j++; } continue; }
    if (inStr) {
      if (ch === '\\') { j++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && nx === '/') { inLineC = true; j++; continue; }
    if (ch === '/' && nx === '*') { inBlockC = true; j++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(m.index, j);
}
const parts = ['sleep', 'visible', 'lucaDocuments', 'guessLabel', 'readLucaTablolar', 'readLucaPopuplar', 'readLucaScreenSnapshot', 'readLucaMenuHaritasi']
  .map(extractFn).join('\n');
// popup kayıt bloğu (kendiniKaydet + window.open sarmalayıcı)
const kayitBas = src.indexOf('  try {\n    const kendiniKaydet');
const kayitSon = src.indexOf('  function lucaDocuments()');
if (kayitBas < 0 || kayitSon < 0) throw new Error('popup kayıt bloğu bulunamadı');
const kayitBlok = src.slice(kayitBas, kayitSon);

const testScript = `
(function(){
${kayitBlok}
${parts}
window.__t = { readLucaTablolar, readLucaPopuplar, readLucaScreenSnapshot, readLucaMenuHaritasi, lucaDocuments };
})();`;

// ── Sahte Luca sayfaları ──
const fisSatirlari = Array.from({ length: 5 }, (_, i) =>
  `<tr><td>${i + 1}</td><td>0${i + 1}.07.2026</td><td>MAHSUP</td><td>Fiş açıklaması ${i + 1}</td><td>${(i + 1) * 100},00</td><td>${(i + 1) * 100},00</td></tr>`).join('');
const popupHtml = `<!doctype html><html><head><title>Fiş Listesi Raporu</title></head><body>
<div>Rapor: Fiş Listesi — TAHİR SUCU 2026 — 01.07.2026 / 31.07.2026</div>
<table border="1" id="fisTablo">
<tr><td>Fiş No</td><td>Tarih</td><td>Fiş Türü</td><td>Açıklama</td><td>Borç</td><td>Alacak</td></tr>
${fisSatirlari}
</table>
<script src="/rt.js"></script>
</body></html>`;

const frm3Satirlar = Array.from({ length: 4 }, (_, i) =>
  `<tr><td>10${i}</td><td>1${i}.07.2026</td><td>Çerçeve fiş ${i}</td><td>${i * 10},00</td></tr>`).join('');
const frm3Html = `<!doctype html><html><body>
<table id="duzen"><tr><td><table><tr><td>iç</td></tr></table></td><td><table><tr><td>iç2</td></tr></table></td></tr><tr><td>x</td><td>y</td></tr></table>
<table id="listeTablo"><thead><tr><th>Fiş No</th><th>Tarih</th><th>Açıklama</th><th>Tutar</th></tr></thead><tbody>${frm3Satirlar}</tbody></table>
<table id="gizli" style="display:none"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>
<input name="TARIH_ILK" value="01.07.2026">
<button>Fiş Listesi</button>
</body></html>`;

// apycom benzeri menü: tablo id apy..I, onmouseover="l1la(event,'id')" → çocuklar GECİKMELİ görünür
function menuHtml() {
  // Kökler: Muhasebe, Personel. Muhasebe > Beyannameler > KDV > KDV 1 > Dönem > Aylık (derinlik 5)
  const agac = {
    'Muhasebe': { 'Fiş İşlemleri': { 'Fiş Listesi': {} }, 'Beyannameler': { 'Muhtasar': {}, 'KDV': { 'KDV 1 Beyannamesi': { 'Dönem Seç': { 'Aylık': {}, 'Üç Aylık': {} } }, 'KDV 2 Beyannamesi': {} } } },
    'Personel': { 'Bordro': { 'Bordro Listesi': {} } },
  };
  let sayac = 0; const satirlar = [];
  const yaz = (ad, dugum, ustId) => {
    const id = 'apy' + (++sayac) + 'I';
    const cocuklar = Object.keys(dugum);
    satirlar.push(`<table id="${id}" data-ust="${ustId || ''}" style="${ustId ? 'display:none' : ''}" ${cocuklar.length ? `onmouseover="l1la(event,'${id}')"` : ''}><tr><td>${ad}</td></tr></table>`);
    for (const c of cocuklar) yaz(c, dugum[c], id);
  };
  for (const k of Object.keys(agac)) yaz(k, agac[k], null);
  return `<!doctype html><html><body>
<div id="menu">${satirlar.join('\n')}</div>
<script>
  // Alt menü: hover'dan 120-260 ms sonra görünür (gecikmeli yükleme taklidi);
  // KARDEŞ dalı hover edilince önceki dal kapanır (apycom davranışı).
  window.l1la = function(evt, id) {
    var el = document.getElementById(id);
    var ust = el.getAttribute('data-ust');
    // kardeşlerin alt ağaçlarını kapat
    document.querySelectorAll('table[data-ust="' + ust + '"]').forEach(function(k){ if (k.id !== id) kapat(k.id); });
    var gecikme = 120 + Math.floor(Math.random() * 140);
    setTimeout(function(){ document.querySelectorAll('table[data-ust="' + id + '"]').forEach(function(c){ c.style.display = ''; }); }, gecikme);
  };
  function kapat(id){ document.querySelectorAll('table[data-ust="' + id + '"]').forEach(function(c){ c.style.display='none'; kapat(c.id); }); }
</script>
</body></html>`;
}

const mainHtml = `<!doctype html><html><head><title>Luca Ana</title></head>
<frameset rows="20%,80%"><frame name="frm1" src="/frm1.html"><frame name="frm3" src="/frm3.html"></frameset>
</html>`;
const frm1Html = `<!doctype html><html><body><span>Üst çubuk TAHİR SUCU</span><script src="/rt.js"></script></body></html>`;

const pages = {
  '/': mainHtml, '/frm1.html': frm1Html, '/frm3.html': frm3Html, '/popup.html': popupHtml,
  '/menu.html': menuHtml(), '/rt.js': testScript,
};

(async () => {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const body = pages[u];
    if (!body) { res.statusCode = 404; return res.end('yok'); }
    res.setHeader('Content-Type', u.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  let hata = 0;
  const ok = (kosul, mesaj) => { console.log((kosul ? 'OK   ' : 'HATA ') + mesaj); if (!kosul) hata++; };

  // ── TEST 1: popup + tablo ──
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const frm1 = page.frames().find((f) => f.name() === 'frm1');
  // frm1'de (runtime çalışan çerçeve) window.open → ana pencere listesine düşmeli
  await frm1.evaluate((b) => { window.open(b + '/popup.html', '_blank', 'width=800,height=600'); }, base);
  await page.waitForTimeout(1500);
  const snap = await frm1.evaluate(() => window.__t.readLucaScreenSnapshot());
  ok(Array.isArray(snap.popuplar), 'snapshot.popuplar dizi');
  ok(snap.popuplar.length === 1, 'popup sayısı 1 (bulunan: ' + snap.popuplar.length + ')');
  const p0 = snap.popuplar[0] || {};
  ok(p0.baslik === 'Fiş Listesi Raporu', 'popup başlığı: ' + p0.baslik);
  ok(/popup\.html/.test(p0.url || ''), 'popup url: ' + p0.url);
  ok(/TAHİR SUCU/.test(p0.metin || ''), 'popup metni okundu');
  ok(p0.kirpildi === false, 'popup kirpildi=false');
  const t0 = (p0.tablolar || [])[0] || {};
  ok((p0.tablolar || []).length === 1, 'popup tablo sayısı 1 (bulunan: ' + (p0.tablolar || []).length + ')');
  ok(JSON.stringify(t0.basliklar) === JSON.stringify(['Fiş No', 'Tarih', 'Fiş Türü', 'Açıklama', 'Borç', 'Alacak']), 'thead yok → ilk satır başlık: ' + JSON.stringify(t0.basliklar));
  ok(t0.satirSayisi === 5 && t0.satirlar[4][3] === 'Fiş açıklaması 5' && t0.satirlar[4][4] === '500,00', 'popup 5 veri satırı, hücreler doğru');
  // çerçeve tabloları (frm3): düzen tablosu elenmeli, gizli elenmeli, thead'li liste okunmalı
  const f3 = snap.frameMetin.find((f) => f.ad === 'frm3') || {};
  ok(Array.isArray(f3.tablolar) && f3.tablolar.length === 1, 'frm3 tablo sayısı 1 (düzen+gizli elendi): ' + JSON.stringify((f3.tablolar || []).map((t) => t.id)));
  const ft = (f3.tablolar || [])[0] || {};
  ok(ft.id === 'listeTablo' && JSON.stringify(ft.basliklar) === JSON.stringify(['Fiş No', 'Tarih', 'Açıklama', 'Tutar']) && ft.satirSayisi === 4, 'frm3 thead başlıkları + 4 satır');
  ok(Array.isArray(snap.pencereler), 'pencereler alanı korunuyor');
  ok(snap.fields.some((f) => f.name === 'TARIH_ILK'), 'alanlar okunmaya devam ediyor');
  // kırpma
  const kirp = await frm1.evaluate(() => window.__t.readLucaPopuplar({ metinSiniri: 40 }));
  ok(kirp[0] && kirp[0].kirpildi === true && kirp[0].metin.length === 40, 'metin sınırı → kirpildi:true');
  const satirKirp = await frm1.evaluate(() => {
    const pops = (window.top || window).__morenLucaPopups;
    return window.__t.readLucaTablolar(pops[0].document, { enFazlaSatir: 2 });
  });
  ok(satirKirp[0] && satirKirp[0].kirpildi === true && satirKirp[0].satirSayisi === 2, 'satır sınırı → kirpildi:true');
  // popup kapanınca listeden düşmeli
  await frm1.evaluate(() => { (window.top || window).__morenLucaPopups[0].close(); });
  await page.waitForTimeout(400);
  const snap2 = await frm1.evaluate(() => window.__t.readLucaScreenSnapshot());
  ok(snap2.popuplar.length === 0, 'kapanan popup listeden düştü');

  // ── TEST 2: menü keşfi ──
  const mp = await ctx.newPage();
  await mp.goto(base + '/menu.html');
  await mp.addScriptTag({ url: base + '/rt.js' });
  const t1 = Date.now();
  const harita = await mp.evaluate(() => window.__t.readLucaMenuHaritasi({ bekle: 300 }));
  const sure = Date.now() - t1;
  const adlar = harita.dugumler.map((d) => d.ad);
  ok(harita.ok && harita.toplam === 14, 'menü toplam 14 düğüm (bulunan: ' + harita.toplam + ') · süre ' + sure + ' ms');
  ok(adlar.includes('KDV') && adlar.includes('KDV 1 Beyannamesi') && adlar.includes('Aylık'), 'KDV > KDV 1 > Dönem Seç > Aylık zinciri keşfedildi');
  ok(harita.dugumler.every((d) => typeof d.derinlik === 'number' && d.derinlik === d.seviye), 'her düğümde derinlik alanı (=seviye)');
  const aylik = harita.dugumler.find((d) => d.ad === 'Aylık') || {};
  ok(aylik.derinlik === 5 && harita.enDerin === 5, 'Aylık derinlik 5, enDerin 5 (bulunan: ' + aylik.derinlik + '/' + harita.enDerin + ')');
  ok(harita.maxDerinlik === 6, 'varsayılan maxDerinlik 6');
  ok(harita.acilamayan.length === 0, 'açılamayan 0');
  // derinlik 3 ile sınırlanınca KDV 1 görünmemeli (parametre çalışıyor)
  await mp.reload(); await mp.addScriptTag({ url: base + '/rt.js' });
  const kisa = await mp.evaluate(() => window.__t.readLucaMenuHaritasi({ derinlik: 3, bekle: 300 }));
  const kisaAdlar = kisa.dugumler.map((d) => d.ad);
  ok(kisaAdlar.includes('KDV') && !kisaAdlar.includes('KDV 1 Beyannamesi'), 'derinlik=3 → KDV var, KDV 1 yok (tavan işliyor)');

  // süre bütçesi: 30 sn tabanı var; sureSiniri altına inemez → 30000 ile menü zaten <30 sn biter, sureAsildi=false olmalı
  ok(harita.sureAsildi === false && typeof harita.sureMs === 'number', 'süre bütçesi alanları (sureAsildi=false, sureMs=' + harita.sureMs + ')');
  await browser.close();
  server.close();
  console.log(hata ? `\n${hata} HATA` : '\nTÜM TESTLER GEÇTİ');
  process.exit(hata ? 1 : 0);
})().catch((e) => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
