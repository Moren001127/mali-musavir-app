#!/usr/bin/env node
/**
 * eLOGO UBL-TR fatura XML regresyonu.
 *
 * SOZLESME KAYNAGI: GITO GIDA'nin eLogo'dan KESTIGI gercek fatura
 * (AAA2026000000045 — ayni aliciya, ayni icerikle, %10 KDV). Sablon ORADAN cikarildi.
 *
 * NEDEN GEREKLI: UBL'de eleman SIRASI zorunludur; bir kapanis etiketi eksik ya da sira
 * bozuk olursa entegrator belgeyi reddeder ve sebebi cogu zaman anlasilmaz olur.
 * Bu test hem bicimi hem sozlesme sabitlerini kilitler.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const mod = require(path.join(ROOT, 'apps/api/src/fatura-kes/elogo-fatura.service.ts'));
const { ElogoFaturaService, yaziyla, ublTutar } = mod;

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

const svc = new ElogoFaturaService({});
const xml = svc.ublOlustur({
  saticiVkn: '3961368714',
  saticiUnvan: 'GİTO GIDA İNŞAAT TİCARET LİMİTED ŞİRKETİ',
  saticiAdres: 'ÖMERLİ MAH. ADNAN KAHVECİ CAD. NO: 1 /1 ARNAVUTKÖY/ İSTANBUL',
  saticiIlce: 'ARNAVUTKÖY', saticiIl: 'İSTANBUL', saticiTel: '90 (534) 337-6764',
  aliciVkn: '7601043666',
  aliciUnvan: 'SELİM İNŞAAT GIDA SANAYİ VE TİCARET ANONİM ŞİRKETİ',
  aliciAdres: 'KARAAĞAÇ MAH. HADIMKÖY İSTANBUL CAD. NO 38/4 BÜYÜKÇEKMECE / İSTANBUL',
  aliciIlce: 'BÜYÜKÇEKMECE', aliciIl: 'İSTANBUL', aliciVergiDairesi: 'BÜYÜKÇEKMECE',
  faturaNo: 'ONIZLEME', faturaTarihi: new Date('2026-08-20T15:30:00'),
  aciklama: 'YEMEK BEDELİ',
  miktar: 1, matrah: 68000, kdvOrani: 10, kdvTutari: 6800, toplam: 74800,
}, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');

// ---------- 1) BICIM: etiketler duzgun kapaniyor mu ----------
function iyiBicimli(s) {
  const yigin = [];
  const re = /<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    const [, kapanis, ad, nitelik, kendiKapanan] = m;
    if (nitelik.startsWith('?') || ad.startsWith('?')) continue;
    if (kendiKapanan === '/') continue;
    if (kapanis === '/') {
      const bekle = yigin.pop();
      if (bekle !== ad) return `kapanis uyumsuz: </${ad}> gordu, </${bekle || 'yok'}> bekleniyordu`;
    } else yigin.push(ad);
  }
  return yigin.length ? `kapanmamis etiket: ${yigin.join(' > ')}` : null;
}
const bicimHata = iyiBicimli(xml.replace(/<\?xml[^>]*\?>/, ''));
ok('XML iyi bicimli (tum etiketler kapaniyor)', !bicimHata, bicimHata || '');

// ---------- 2) SOZLESME SABITLERI (gercek faturadan) ----------
const sabitler = [
  ['UBLVersionID 2.1', '<cbc:UBLVersionID>2.1</cbc:UBLVersionID>'],
  ['CustomizationID TR1.2', '<cbc:CustomizationID>TR1.2</cbc:CustomizationID>'],
  ['ProfileID TICARIFATURA', '<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>'],
  ['InvoiceTypeCode SATIS', '<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>'],
  ['KDV vergi kodu 0015', '<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>'],
  ['KDV adi GERCEK', '<cbc:Name>KDV GERCEK</cbc:Name>'],
  ['para birimi TRY', '>TRY</cbc:DocumentCurrencyCode>'],
  ['miktar birim kodu NIU', 'unitCode="NIU"'],
  ['satici VKN', '<cbc:ID schemeID="VKN">3961368714</cbc:ID>'],
  ['alici VKN', '<cbc:ID schemeID="VKN">7601043666</cbc:ID>'],
];
for (const [ad, parca] of sabitler) ok(ad, xml.includes(parca), `bulunamadi: ${parca}`);

// ---------- 3) IMZA BLOGU OLMAMALI (entegrator ekler) ----------
ok('imza blogu (ext:UBLExtensions) YOK — muhur entegratorde', !xml.includes('<ext:UBLExtensions'));
ok('gomulu XSLT YOK', !xml.includes('EmbeddedDocumentBinaryObject'));

// ---------- 4) ARITMETIK ----------
const say = (etiket) => {
  const m = xml.match(new RegExp(`<cbc:${etiket}[^>]*>([\\d.]+)</cbc:${etiket}>`));
  return m ? Number(m[1]) : NaN;
};
ok('matrah 68000', say('TaxExclusiveAmount') === 68000);
ok('KDV 6800', say('TaxAmount') === 6800);
ok('toplam 74800', say('TaxInclusiveAmount') === 74800);
ok('odenecek = toplam', say('PayableAmount') === 74800);
ok('matrah + KDV = toplam', say('TaxExclusiveAmount') + say('TaxAmount') === say('TaxInclusiveAmount'));

// ---------- 5) ELEMAN SIRASI (UBL'de ZORUNLU) ----------
const sira = ['UBLVersionID', 'CustomizationID', 'ProfileID', 'cbc:ID', 'UUID', 'IssueDate', 'IssueTime',
  'InvoiceTypeCode', 'DocumentCurrencyCode', 'LineCountNumeric', 'cac:Signature',
  'AccountingSupplierParty', 'AccountingCustomerParty', 'cac:TaxTotal', 'LegalMonetaryTotal', 'InvoiceLine'];
let onceki = -1, siraOk = true, bozuk = '';
for (const ad of sira) {
  // Onek cbc: ya da cac: olabilir — ikisini de dene (testin kendi tuzagi: sabit cbc: yaziliydi).
  const i = ad.includes(':')
    ? xml.indexOf('<' + ad)
    : Math.max(xml.indexOf('<cbc:' + ad), xml.indexOf('<cac:' + ad));
  if (i < 0) { siraOk = false; bozuk = ad + ' yok'; break; }
  if (i < onceki) { siraOk = false; bozuk = ad + ' yanlis sirada'; break; }
  onceki = i;
}
ok('eleman sirasi UBL sozlesmesine uygun', siraOk, bozuk);

// ---------- 6) TUTAR BICIMI ve YAZIYLA ----------
ok('tutar noktali ondalik (virgul YOK)', !/[\d],[\d]/.test(xml));
const yaziTestleri = [[74800, 'YetmişDörtBinSekizYüz'], [1000, 'Bin'], [2000, 'İkiBin'],
  [11000, 'OnBirBin'], [105, 'YüzBeş'], [1, 'Bir'], [0, 'Sıfır'], [78892, 'YetmişSekizBinSekizYüzDoksanİki']];
for (const [n, b] of yaziTestleri) ok(`yaziyla(${n}) = ${b}`, yaziyla(n) === b, `olan: ${yaziyla(n)}`);
ok('ublTutar tam sayida ondalik eklemez', ublTutar(68000) === '68000');
ok('ublTutar kurusu korur', ublTutar(1234.56) === '1234.56');

if (hata) process.exit(1);
console.log('[elogo-ubl-regression] OK: UBL bicimi, sozlesme sabitleri ve aritmetik kilitli');
