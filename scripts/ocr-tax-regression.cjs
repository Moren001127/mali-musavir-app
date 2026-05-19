#!/usr/bin/env node
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = 'true';
  process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'Node',
  });

  const candidates = [
    'ts-node/register/transpile-only',
    path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
    path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
  ];

  for (const candidate of candidates) {
    try {
      require(candidate);
      return;
    } catch {}
  }

  throw new Error('ts-node/register/transpile-only bulunamadi');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function approx(actual, expected, message) {
  assert(Math.abs(Number(actual) - expected) < 0.005, `${message}: ${actual} != ${expected}`);
}

loadTsNode();

const { OcrService } = require(path.join(ROOT, 'apps', 'api', 'src', 'kdv-control', 'ocr', 'index.ts'));
const service = new OcrService();

const telekomInvoiceText = [
  'Turk Telekom',
  'E162026038940238',
  'Fatura Tarihi 30.04.2026',
  'Katma De\u011fer Vergisi (%20)',
  '115,77',
  '\u00d6zel \u0130leti\u015fim Vergisi (%10)',
  '55,38',
  'Telsiz Kullan\u0131m Ayl\u0131k Taksit (%4)',
  '0,00',
  'Fatura Tutar\u0131',
  '750,00',
].join('\n');

const telekomKdv = service.extractKdvOnlyFromTelekomAzure(telekomInvoiceText);
approx(telekomKdv, 115.77, 'Telekom faturasi KDV-only tutari');

const telekomFallbackBreakdown = service.extractMultiRateKdvFromItemRows(telekomInvoiceText);
assert(
  Array.isArray(telekomFallbackBreakdown) && telekomFallbackBreakdown.length === 0,
  `Telekom OIV/Telsiz satirlari KDV kirilimi olmamali: ${JSON.stringify(telekomFallbackBreakdown)}`,
);

const oivOnlyText = [
  '\u00d6zel \u0130leti\u015fim Vergisi (%10)',
  '55,38',
  'Fatura Tutar\u0131',
  '55,38',
].join('\n');
const oivOnlyBreakdown = service.extractMultiRateKdvFromItemRows(oivOnlyText);
assert(
  Array.isArray(oivOnlyBreakdown) && oivOnlyBreakdown.length === 0,
  `OIV-only metin KDV kirilimi uretmemeli: ${JSON.stringify(oivOnlyBreakdown)}`,
);

const washInvoiceText = [
  'EMO2026000000210',
  'Fatura Tarihi 01.04.2026',
  'Mal Hizmet Toplam Tutari 10.000,00 TL',
  'Hesaplanan KDV GERCEK (%20.0)',
  '2.000,00 TL',
  'Vergiler Dahil Toplam Tutar 12.000,00 TL',
].join('\n');
const washInvoiceKdv = service.extractKdvFromInvoiceTotalsAzure(washInvoiceText);
assert(washInvoiceKdv, 'WASH KDV GERCEK satiri parse edilmeli');
approx(washInvoiceKdv.kdv, 2000, 'WASH KDV GERCEK satiri orani degil tutari almali');

// ─── extractKdvTotal regression — "GERCEK" / "TEVKIFAT" gibi ara kelimeli labels ───
// BUG: "Hesaplanan KDV GERCEK (%20.0) 824,00" satırında eski regex parantezi atlayıp
// "20.0" değerini KDV tutarı olarak okuyordu. Fix: ara kelime tolere + rate echo guard.
const washVariations = [
  ['Hesaplanan KDV GERCEK (%20.0) 824,00', 824, 'GERCEK ara kelime tek satir'],
  ['Hesaplanan KDV GERCEK (%20.0)\n824,00 TL', 824, 'GERCEK ara kelime + amount sonraki satir'],
  ['Hesaplanan KDV(%20) 1.330,00', 1330, 'klasik tek oran'],
  ['Hesaplanan KDV (%20) 824,00\nHesaplanan KDV (%10) 100,00', 924, 'cok oran toplam'],
];
for (const [text, expected, label] of washVariations) {
  const result = service.extractKdvTotal(text);
  const parsed = result ? parseFloat(result.replace(/\./g, '').replace(',', '.')) : 0;
  approx(parsed, expected, `extractKdvTotal: ${label}`);
}

// Edge case: salt rate (20,00) tek başına olduğunda KDV olarak alınmamalı
const justRateText = 'Hesaplanan KDV GERCEK (%20.0)\n20,00';
const justRateResult = service.extractKdvTotal(justRateText);
// 20,00 rate echo, gerçek KDV değil — null veya başka bir değer dönmeli
if (justRateResult) {
  const v = parseFloat(justRateResult.replace(/\./g, '').replace(',', '.'));
  assert(v !== 20, `extractKdvTotal salt rate echo dönmemeli: ${justRateResult}`);
}


const zReportText = [
  'TOPLAM %20',
  '65,00',
  'TOPKDV %20',
  '10,83',
  'TOPLAM %10',
  '4.984,00',
  'TOPKDV %10',
  '453,08',
].join('\n');
const zReportBreakdown = service.extractMultiRateKdvFromItemRows(zReportText);
assert(zReportBreakdown.length === 2, `Z raporu iki KDV orani uretmeli: ${JSON.stringify(zReportBreakdown)}`);
approx(zReportBreakdown.find((row) => row.oran === 20)?.tutar, 10.83, 'Z raporu %20 KDV');
approx(zReportBreakdown.find((row) => row.oran === 10)?.tutar, 453.08, 'Z raporu %10 KDV');

const zeyrekTevkifatText = [
  'ZEYREK LOJISTIK TASIMACILIK OTOMOTIV INS. GIDA SAN. VE TIC. LTD. STI.',
  'Fatura No ZEF2026000000097',
  'KDV TEVKIFAT',
  '(%20,00)=158,00 TL',
  'KDV TEVKIFAT',
  '(%20,00)=251,20 TL',
  'Mal Hizmet Toplam Tutari 10.230,00 TL',
  'Hesaplanan KDV(%20) 2.046,00 TL',
  'Vergiler Dahil Toplam Tutar 12.276,00 TL',
  'Odenecek Tutar 11.866,80 TL',
].join('\n');
const zeyrekTevkifat = service.extractTevkifatliFaturaFromAzure(zeyrekTevkifatText);
assert(zeyrekTevkifat, 'Zeyrek cok satirli tevkifat faturasi parse edilmeli');
approx(zeyrekTevkifat.tamKdv, 2046, 'Zeyrek tam KDV');
approx(zeyrekTevkifat.tevkifat, 409.2, 'Zeyrek toplam tevkifat');
approx(zeyrekTevkifat.netKdv, 1636.8, 'Zeyrek net KDV');

const zeyrekDotDecimalTevkifatText = [
  'ZEF2026000000105',
  'KDV TEVKIFAT',
  '(%20.00)=220.00 TL',
  'KDV TEVKIFAT',
  '(%20.00)=126.00 TL',
  'KDV TEVKIFAT',
  '(%20.00)=196.00 TL',
  'Hesaplanan KDV(%20) 2.710.00 TL',
  'Odenecek Tutar 15.718.00 TL',
].join('\n');
const zeyrekDotDecimalTevkifat = service.extractTevkifatliFaturaFromAzure(zeyrekDotDecimalTevkifatText);
assert(zeyrekDotDecimalTevkifat, 'Zeyrek nokta ondalikli cok satirli tevkifat faturasi parse edilmeli');
approx(zeyrekDotDecimalTevkifat.tamKdv, 2710, 'Zeyrek 105 tam KDV');
approx(zeyrekDotDecimalTevkifat.tevkifat, 542, 'Zeyrek 105 toplam tevkifat');
approx(zeyrekDotDecimalTevkifat.netKdv, 2168, 'Zeyrek 105 net KDV');

const zeyrekInterleavedTevkifatText = [
  'ZEF2026000000103',
  'KDV TEVKIFAT',
  'TOPKAPI NAKLIYE BEDELI',
  '(%20,00)=251,20 TL',
  'KDV TEVKIFAT',
  'NAKLIYE BEDELI',
  '(%20,00)=180,00 TL',
  'Hesaplanan KDV(%20)',
  '2.156,00 TL',
  'Hesaplanan KDV',
  'Tevkifat(%20',
  '431,20 TL',
  'Odenecek Tutar',
  '12.504,80 TL',
].join('\n');
const zeyrekInterleavedTevkifat = service.extractTevkifatliFaturaFromAzu