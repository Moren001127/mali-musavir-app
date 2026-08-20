#!/usr/bin/env node
/**
 * Belge turu (e-Fatura / e-Arsiv) tespiti regresyonu.
 *
 * NEDEN VAR: 2026-08-20'ye kadar tespit TUM XML metninde "EARSIV" kelimesi ariyordu.
 * BIM'in faturasindaki <cbc:ElectronicMail>earsiv@bim.com.tr</cbc:ElectronicMail> yuzunden
 * gercek e-Faturalar e-Arsiv sanilip Alis e-Fatura kanalinda SESSIZCE atiliyordu.
 * GITO GIDA Temmuz 2026: entegrator 28 fatura dondurdu, portala 25 girdi.
 *
 * Bu test, kaynaktaki documentTypeFromProviderXml mantiginin serbest metne DEGIL,
 * UBL ProfileID / InvoiceTypeCode alanlarina bakmasini kilitler.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-muhasebelestirme', 'fatura-muhasebelestirme.service.ts');
const src = fs.readFileSync(SRC, 'utf8');

const govde = (src.match(/private documentTypeFromProviderXml\(xml: string\) \{([\s\S]*?)\n  \}/) || [])[1];
if (!govde) {
  console.error('HATA: documentTypeFromProviderXml bulunamadi');
  process.exit(1);
}

// KILIT 1: serbest metinde kelime aramaya geri donulemez.
if (/\/EARSIV\|E-ARSIV\|EARCHIVE\|E-ARCHIVE\/i\.test\(xml\)/.test(govde)) {
  console.error('HATA: belge turu yine TUM XML metninde kelime ariyor — e-posta adresindeki "earsiv" faturayi kaybettirir.');
  process.exit(1);
}
// KILIT 2: ProfileID alanina bakmali.
if (!/ProfileID/.test(govde)) {
  console.error('HATA: belge turu ProfileID alanindan okunmuyor.');
  process.exit(1);
}

// Davranis testi: kaynaktaki mantigin birebir kopyasi.
function belgeTuru(xml) {
  const profile = (xml.match(/<(?:[\w.-]+:)?ProfileID\b[^>]*>\s*([^<]+)</i) || [])[1] || '';
  if (/EARSIV|EARCHIVE/i.test(profile)) return 'E_ARSIV';
  if (/<(?:[\w.-]+:)?InvoiceTypeCode\b[^>]*>\s*EARSIV/i.test(xml)) return 'E_ARSIV';
  if (/<(?:[\w.-]+:)?ArchiveInvoice\b/i.test(xml)) return 'E_ARSIV';
  return 'E_FATURA';
}

const vakalar = [
  {
    ad: 'BIM e-Faturasi — e-posta adresinde "earsiv" geciyor (GERCEK VAKA)',
    xml: '<Invoice><cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:ElectronicMail>earsiv@bim.com.tr</cbc:ElectronicMail></Invoice>',
    bekle: 'E_FATURA',
  },
  {
    ad: 'BESTUR ticari e-Faturasi — e-posta adresinde "earsiv" (GERCEK VAKA)',
    xml: '<Invoice><cbc:ProfileID>TICARIFATURA</cbc:ProfileID><cbc:ElectronicMail>earsiv@besturturizm.com.tr</cbc:ElectronicMail></Invoice>',
    bekle: 'E_FATURA',
  },
  {
    ad: 'Gercek e-Arsiv — ProfileID EARSIVFATURA',
    xml: '<Invoice><cbc:ProfileID>EARSIVFATURA</cbc:ProfileID></Invoice>',
    bekle: 'E_ARSIV',
  },
  {
    ad: 'Parasut sentetik e-Arsiv XML (ProfileID markoru)',
    xml: '<Invoice><cbc:ProfileID>EARSIVFATURA</cbc:ProfileID><cbc:ID>FOZ1</cbc:ID></Invoice>',
    bekle: 'E_ARSIV',
  },
  {
    ad: 'ProfileID yok, InvoiceTypeCode EARSIV',
    xml: '<Invoice><cbc:InvoiceTypeCode>EARSIV</cbc:InvoiceTypeCode></Invoice>',
    bekle: 'E_ARSIV',
  },
  {
    ad: 'Duz temel e-Fatura',
    xml: '<Invoice><cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode></Invoice>',
    bekle: 'E_FATURA',
  },
  {
    ad: 'Adreste "earsiv" gecen ihracat faturasi',
    xml: '<Invoice><cbc:ProfileID>IHRACAT</cbc:ProfileID><cbc:WebsiteURI>https://earsiv.ornek.com.tr</cbc:WebsiteURI></Invoice>',
    bekle: 'E_FATURA',
  },
];

let hata = 0;
for (const v of vakalar) {
  const sonuc = belgeTuru(v.xml);
  if (sonuc === v.bekle) {
    console.log(`  \u2713 ${v.ad} -> ${sonuc}`);
  } else {
    console.error(`  \u2717 ${v.ad} -> ${sonuc} (beklenen ${v.bekle})`);
    hata++;
  }
}

// KILIT 3: ALIS kanalinda belge atilmamali.
if (/channel === 'IN_EFATURA' && docType === 'E_ARSIV'\) \{ providerSkipped\+\+; return; \}/.test(src)) {
  console.error('HATA: Alis e-Fatura kanalinda belge hala eleniyor — tur tespiti yanilirsa fatura kaybolur.');
  hata++;
}

if (hata) process.exit(1);
console.log('[belge-turu-regression] OK: belge turu ProfileID\'den okunuyor, serbest metin fatura kaybettirmiyor');
