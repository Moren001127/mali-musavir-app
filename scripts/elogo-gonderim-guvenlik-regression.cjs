#!/usr/bin/env node
/**
 * eLOGO GONDERIM GUVENLIK regresyonu.
 *
 * KULLANICI KURALI (2026-08-20): "sakin fatura no verip gonder yapma, firmaya gider
 * fatura yoksa" + "eLogo'da fatura numarasi verildikten sonra fatura iptal edilemiyor".
 *
 * Bu test, gonderim yolunun KAZA ILE calismasini engelleyen korumalari kilitler:
 *  1) Acik onay olmadan gonderim YOK.
 *  2) Gonderimi kendiliginden tetikleyen bir cagri KODDA YOK (bot tek basina kesemez).
 *  3) Atomik durum kilidi var (ayni taslak iki kez gonderilemez).
 *  4) Belirsiz yanitta durum TASLAK'a DONDURULMEZ (mukerrer fatura riski).
 *  5) On ek (seri) UYDURULMAZ; eLogo'dan okunur.
 *  6) Alicinin birden fazla posta kutusu varsa SECILMEZ, sorulur.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const SERVIS = path.join(ROOT, 'apps/api/src/fatura-kes/elogo-fatura.service.ts');
const { ElogoFaturaService } = require(SERVIS);
const kaynak = fs.readFileSync(SERVIS, 'utf8');

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

// ---------- 1) ACIK ONAY OLMADAN GONDERIM YOK ----------
(async () => {
  const svc = new ElogoFaturaService({
    salesInvoiceDraft: { findFirst: async () => ({ id: 'x', taxpayerId: 't', aliciVkn: '1', durum: 'TASLAK' }) },
  });
  for (const girdi of [undefined, {}, { onay: false }, { onay: 'true' }, { onay: 1 }]) {
    let firlattiMi = false;
    let mesaj = '';
    try {
      await svc.onaylaVeGonder('t', 'x', girdi);
    } catch (e) { firlattiMi = true; mesaj = String(e.message || ''); }
    ok(`onay=${JSON.stringify(girdi)} ile gonderim REDDEDILIR`, firlattiMi && mesaj.includes('onay'),
      firlattiMi ? 'mesaj: ' + mesaj.slice(0, 80) : 'HIC HATA FIRLATMADI — gonderim yolu acik!');
  }

  // ---------- 2) KENDILIGINDEN TETIKLEYEN CAGRI YOK ----------
  const otoCagri = [];
  const tarananlar = ['apps/api/src/whatsapp', 'apps/api/src/fatura-kes'];
  const gez = (dizin) => {
    for (const ad of fs.readdirSync(dizin)) {
      const tam = path.join(dizin, ad);
      const st = fs.statSync(tam);
      if (st.isDirectory()) { gez(tam); continue; }
      if (!ad.endsWith('.ts')) continue;
      if (tam.endsWith('elogo-fatura.service.ts')) continue;   // tanimin kendisi
      const s = fs.readFileSync(tam, 'utf8');
      if (s.includes('onaylaVeGonder') || s.includes('belgeGonder(') || s.includes('numaraAl(')) {
        otoCagri.push(path.relative(ROOT, tam));
      }
    }
  };
  for (const d of tarananlar) gez(path.join(ROOT, d));
  ok('gonderimi kendiliginden cagiran dosya YOK', otoCagri.length === 0,
    'cagiran: ' + otoCagri.join(', ') + ' — bot tek basina fatura kesmemeli');

  // ---------- 3) ATOMIK KILIT ----------
  ok('atomik durum kilidi var (TASLAK -> GONDERILIYOR)',
    /updateMany\([\s\S]{0,200}durum: 'TASLAK'[\s\S]{0,200}GONDERILIYOR/.test(kaynak));
  ok('kilit alinamazsa gonderim durur', kaynak.includes('kilit.count !== 1'));

  // ---------- 4) BELIRSIZ YANITTA TASLAK'A DONULMEZ ----------
  const basarisizBlok = kaynak.slice(kaynak.indexOf('if (sonuc.basarili)'));
  ok('basarisiz/belirsiz yanitta durum TASLAK yapilmaz',
    basarisizBlok.indexOf("durum: 'TASLAK'") < 0,
    'belirsizlik red degildir; TASLAK a donmek mukerrer faturaya yol acar');

  // ---------- 5) ON EK UYDURULMAZ ----------
  ok('on ek eLogo dan okunuyor (sonNumara)', kaynak.includes('const seri = await this.sonNumara('));
  ok('sabit on ek yedegi YOK', !/String\(d\.onEk \|\| 'AAA'\)/.test(kaynak));

  // ---------- 6) COKLU ETIKETTE SECIM YAPILMAZ ----------
  ok('coklu posta kutusunda secim yapilmaz, sorulur',
    kaynak.includes('postaKutulari.length > 1') && /postaKutulari\.length > 1[\s\S]{0,200}BadRequestException/.test(kaynak));

  // ---------- 7) PK/GB ETIKET AYRIMI ----------
  ok('InvoicePkList ile InvoiceGbList ayri okunuyor',
    kaynak.includes("listeEtiketleri(govde, 'InvoicePkList')") && kaynak.includes("listeEtiketleri(govde, 'InvoiceGbList')"));
  ok('eFaturaMi PK listesine bakar', kaynak.includes('eFaturaMi: postaKutulari.length > 0'));

  if (hata) process.exit(1);
  console.log('[elogo-gonderim-guvenlik] OK: acik onaysiz gonderim yok, kilit ve etiket kurallari saglam');
})();
