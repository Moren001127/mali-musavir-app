#!/usr/bin/env node
/**
 * OCR modulleri davranış regression testi (Faz 3 — refactor güvencesi).
 *
 * Faz 1 + Faz 2 ile cikarilan pure modullerin orijinal davranisla AYNI
 * sonuc dondurdugunu pinleyen test suite. Her modul fixture'larla cagrilir,
 * beklenen ciktiyla karsilastirilir.
 *
 * Pre-commit hook'tan calistirilir — bir modul refactor'unda yanlislikla
 * davranisin degismesi durumunda commit reddedilir.
 *
 * Modulleri kapsiyor:
 *   - ocr/parsers/date.ts           (extractDate, normalizeOcrYear)
 *   - ocr/parsers/belge-no.ts       (extractBelgeNo)
 *   - ocr/parsers/vendor.ts         (extractSaticiVkn, extractSaticiUnvan)
 *   - ocr/parsers/text-classifiers.ts (5 boolean)
 *   - ocr/parsers/xml-helpers.ts    (5 XML helper)
 *   - ocr/providers/ubl.ts          (parseUblXml — UBL XML pipeline)
 *   - ocr/providers/azure/okc-fis.ts          (extractOkcFisKdv)
 *   - ocr/providers/azure/tevkifatli-fatura.ts (parseTevkifatRate, extractTevkifatliFatura)
 *   - ocr/providers/azure/kdv-breakdown.ts    (extractMultiRateKdv)
 *   - ocr/providers/azure/z-raporu.ts         (extractZRaporuKdv)
 *   - ocr/providers/azure/helpers.ts          (normalizeAzureText, foldTurkishAscii, detectBelgeTipi)
 *   - ocr/providers/azure/sectoral.ts         (extractKdvOnlyFromTelekom)
 */

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
  if (!condition) throw new Error(`[ASSERT] ${message}`);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`[EQ] ${message}: beklenen=${JSON.stringify(expected)} gercek=${JSON.stringify(actual)}`);
  }
}

function approx(actual, expected, tolerance, message) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
    throw new Error(`[APPROX] ${message}: beklenen=${expected} (±${tolerance}) gercek=${actual}`);
  }
}

function deepEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`[DEEP_EQ] ${message}:\n  beklenen=${e}\n  gercek=${a}`);
  }
}

loadTsNode();

// ─── PARSERS ───────────────────────────────────────────────
const dateParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/date.ts'));
const amountParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/amount.ts'));
const belgeNoParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/belge-no.ts'));
const vendorParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/vendor.ts'));
const textClassifiers = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/text-classifiers.ts'));
const xmlHelpers = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/xml-helpers.ts'));

// ─── PROVIDERS ─────────────────────────────────────────────
const ublProvider = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/ubl.ts'));
const okcFis = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/okc-fis.ts'));
const tevkifatli = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/tevkifatli-fatura.ts'));
const kdvBreakdown = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/kdv-breakdown.ts'));
const zRaporu = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/z-raporu.ts'));
const azureHelpers = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/helpers.ts'));
const sectoral = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/sectoral.ts'));
const crossCheck = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/validation/cross-check.ts'));

const log = [];
const ok = (name) => log.push(`  ✓ ${name}`);

// ═══════════════════════════════════════════════════════════
// FAZ 1: PARSERS
// ═══════════════════════════════════════════════════════════

// ─── date.ts ───
eq(dateParser.normalizeOcrYear('26'), 2026, 'normalizeOcrYear 2-digit');
eq(dateParser.normalizeOcrYear('2026'), 2026, 'normalizeOcrYear 4-digit');
eq(dateParser.normalizeOcrYear('99'), null, 'normalizeOcrYear out of range (1999)');
eq(dateParser.normalizeOcrYear('abc'), null, 'normalizeOcrYear invalid');
eq(dateParser.extractDate('Fatura tarihi 15.04.2026'), '15.04.2026', 'extractDate DD.MM.YYYY');
eq(dateParser.extractDate('Tarih: 15/04/2026'), '15.04.2026', 'extractDate DD/MM/YYYY');
eq(dateParser.extractDate('2026-04-15'), '15.04.2026', 'extractDate YYYY-MM-DD');
eq(dateParser.extractDate('15 - 04 - 2026'), '15.04.2026', 'extractDate DD - MM - YYYY');
eq(dateParser.extractDate('Hicbir tarih yok'), null, 'extractDate no match');
ok('date.ts (9 assertion)');

// ─── belge-no.ts ───
const foldNoop = (s) => s.toUpperCase(); // Test icin minimal fold
eq(belgeNoParser.extractBelgeNo('Z RAPORU\nZ NO: 666\n', 'Z RAPORU\nZ NO: 666\n'.toUpperCase()), '666', 'belgeNo Z NO');
eq(belgeNoParser.extractBelgeNo('Z RAPORU\nZ SAYAC: 896', 'Z RAPORU\nZ SAYAC: 896'), '896', 'belgeNo Z SAYAC');
eq(belgeNoParser.extractBelgeNo('FIS NO 12345', 'FIS NO 12345'), '12345', 'belgeNo FIS NO');
eq(belgeNoParser.extractBelgeNo('FATURA NO: ABC2026123456', 'FATURA NO: ABC2026123456'), 'ABC2026123456', 'belgeNo FATURA NO');
eq(
  belgeNoParser.extractBelgeNo(
    'FIS NO:\nSAAT: 15:28\nTOPKDV\n*85,45\nISLEM NO:0003/KP0807',
    'FIS NO:\nSAAT: 15:28\nTOPKDV\n*85,45\nISLEM NO:0003/KP0807',
  ),
  '3',
  'belgeNo blank FIS NO POS fallback',
);
ok('belge-no.ts (5 assertion)');

// ─── vendor.ts ───
const foldTr = (s) => azureHelpers.foldTurkishAscii(s);
const vknText = 'ACME TICARET LTD STI\nVKN: 1234567890\nADRES: ...\nSAYIN ALICI';
eq(vendorParser.extractSaticiVkn(vknText, foldTr), '1234567890', 'vendor VKN labeled');
const vknBare = 'XYZ ANONIM SIRKETI\n9876543210\nSAYIN MUSTERI';
eq(vendorParser.extractSaticiVkn(vknBare, foldTr), '9876543210', 'vendor VKN bare');
eq(vendorParser.extractSaticiUnvan(vknText, foldTr), 'ACME TICARET LTD STI', 'vendor unvan LTD STI');
ok('vendor.ts (3 assertion)');

// ─── text-classifiers.ts ───
eq(textClassifiers.isLikelyStandaloneTaxRate('20', foldTr), true, 'classifier rate 20');
eq(textClassifiers.isLikelyStandaloneTaxRate('20,00', foldTr), true, 'classifier rate 20,00');
eq(textClassifiers.isLikelyStandaloneTaxRate('%20', foldTr), true, 'classifier rate %20');
eq(textClassifiers.isLikelyStandaloneTaxRate('1.330,00', foldTr), false, 'classifier amount not rate');
eq(textClassifiers.isMatrahOrRateLine('KDV MATRAHI: 100,00', foldTr), true, 'classifier matrah line');
eq(textClassifiers.isMatrahOrRateLine('KDV ORANI: %20', foldTr), true, 'classifier oran line');
eq(textClassifiers.isMatrahOrRateLine('HESAPLANAN KDV: 20,00', foldTr), false, 'classifier KDV not matrah');
eq(textClassifiers.isKdvTableHeaderLine('KDV TUTARI MAL HIZMET', foldTr), true, 'classifier KDV table header');
eq(textClassifiers.isForbiddenKdvAmountLine('GENEL TOPLAM: 100,00', foldTr), true, 'classifier forbidden genel toplam');
ok('text-classifiers.ts (9 assertion)');

// ─── xml-helpers.ts ───
eq(xmlHelpers.decodeXmlText('A &amp; B &lt;c&gt;'), 'A & B <c>', 'xml decode escape');
const xml = '<Invoice><cbc:ID>FB001</cbc:ID><cbc:IssueDate>2026-05-19</cbc:IssueDate></Invoice>';
eq(xmlHelpers.getXmlTagValue(xml, 'ID'), 'FB001', 'xml getTagValue namespace prefix');
eq(xmlHelpers.getXmlTagValue(xml, 'IssueDate'), '2026-05-19', 'xml getTagValue plain');
const multi = '<a><b>1</b></a><a><b>2</b></a>';
deepEq(xmlHelpers.getXmlBlocks(multi, 'a'), ['<b>1</b>', '<b>2</b>'], 'xml getBlocks multi');
eq(xmlHelpers.parseXmlAmount('<cbc:Amount>1234.56</cbc:Amount>', 'Amount', parseFloat), 1234.56, 'xml parseAmount');
ok('xml-helpers.ts (5 assertion)');

// ═══════════════════════════════════════════════════════════
// FAZ 2: PROVIDERS
// ═══════════════════════════════════════════════════════════

// ─── ubl.ts ───
const ublXml = `<?xml version="1.0"?>
<Invoice xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>EFM2026000000123</cbc:ID>
  <cbc:IssueDate>2026-04-15</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>ACME TICARET LTD STI</cbc:Name></cac:PartyName>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount>100.00</cbc:TaxableAmount>
      <cbc:TaxAmount>20.00</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount>120.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
const silentLogger = { log: () => {}, warn: () => {} };
const ublDeps = {
  parseAmount: (s) => amountParser.parseOcrAmount(s),
  formatAmount: (n) => n.toFixed(2).replace('.', ','),
  normalizeTaxText: (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(),
  logger: silentLogger,
};
const ublResult = ublProvider.parseUblXml(ublXml, ublDeps);
assert(ublResult !== null, 'ubl result not null');
eq(ublResult.belgeNo, 'EFM2026000000123', 'ubl belge no');
eq(ublResult.date, '2026-04-15', 'ubl date');
eq(ublResult.kdvTutari, '20,00', 'ubl kdv tutari');
eq(ublResult.totalTutari, '120,00', 'ubl total');
eq(ublResult.satici, 'ACME TICARET LTD STI', 'ubl satici');
eq(ublResult.saticiVkn, '1234567890', 'ubl vkn');
eq(ublResult.belgeTipi, 'EFATURA', 'ubl belge tipi');
eq(ublResult.engine, 'ubl-xml-direct', 'ubl engine');
ok('ubl.ts (9 assertion)');

// ─── azure/helpers.ts ───
eq(azureHelpers.normalizeAzureText('test space'), 'TEST SPACE', 'helpers normalize NBSP');
eq(azureHelpers.foldTurkishAscii('İŞÇİ'), 'ISCI', 'helpers fold tr');
eq(azureHelpers.detectBelgeTipi('FIS NO 123 EKU NO 456'), 'OKC_FIS', 'helpers detect OKC');
eq(azureHelpers.detectBelgeTipi('Z RAPORU KUM TOPLAM'), 'Z_RAPORU', 'helpers detect Z RAPORU');
eq(azureHelpers.detectBelgeTipi('E-ARSIV FATURA'), 'EARSIV', 'helpers detect EARSIV');
eq(azureHelpers.detectBelgeTipi('E-FATURA'), 'EFATURA', 'helpers detect EFATURA');
deepEq(azureHelpers.extractMoneyAmounts('Tutar: 1.330,00 ve 665,00', ublDeps.parseAmount), [1330, 665], 'helpers extract money');
ok('azure/helpers.ts (7 assertion)');

// ─── azure/sectoral.ts (telekom) ───
const telekomDeps = {
  parseAmount: ublDeps.parseAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  stripMatrahFragments: azureHelpers.stripMatrahFragments,
  isMatrahOrRateLine: (v) => textClassifiers.isMatrahOrRateLine(v, azureHelpers.foldTurkishAscii),
  isLikelyStandaloneTaxRate: (v) => textClassifiers.isLikelyStandaloneTaxRate(v, azureHelpers.foldTurkishAscii),
};
const telekomText = [
  'Turk Telekom',
  'Katma Değer Vergisi (%20)',
  '115,77',
  'Özel İletişim Vergisi (%10)',
  '55,38',
].join('\n');
approx(sectoral.extractKdvOnlyFromTelekom(telekomText, telekomDeps), 115.77, 0.01, 'telekom KDV');
ok('azure/sectoral.ts (1 assertion)');

// ─── azure/z-raporu.ts ───
const zText = [
  'Z RAPORU',
  'TOPLAM %20  *140,00',
  'TOPLAM %10  *50,00',
  'TOPKDV %20  *23,33',
  'TOPKDV %10  *4,55',
].join('\n');
const zDeps = {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
};
const zResult = zRaporu.extractZRaporuKdv(zText, zDeps);
approx(zResult.matrahByOran[20], 140, 0.01, 'z matrah %20');
approx(zResult.matrahByOran[10], 50, 0.01, 'z matrah %10');
eq(zResult.breakdown.length, 2, 'z breakdown count');
const zPetravet1434Text = [
  'Z RAPORU',
  'TOPLAM /20',
  '*625,00',
  'TOPKDV /20',
  '* 104 17',
  'TOPLAM /10',
  '*2.375,00',
  'TOPKDV /10',
  '*215,91',
  'TOPLAM',
  '*3.000,00',
  'TOPKDV',
  '*320,08',
  'KUM TOPKDV',
  '*602.964,48',
].join('\n');
const zPetravet1434 = zRaporu.extractZRaporuKdv(zPetravet1434Text, zDeps);
eq(zPetravet1434.kdvTutari, '320,08', 'z petravet 1434 spaced topkdv total');
approx(zPetravet1434.breakdown.find((b) => b.oran === 20).tutar, 104.17, 0.01, 'z petravet 1434 %20 spaced decimal');
approx(zPetravet1434.breakdown.find((b) => b.oran === 10).tutar, 215.91, 0.01, 'z petravet 1434 %10 normal decimal');

const zPetravet1418Text = [
  'TOPLAM /20',
  '*2.950,00',
  'TOPKDV /20',
  '+491,66',
  'TOPLAM /10',
  '*3.450,00',
  'TOPKDV Z10',
  '*313,64',
  'TOPLAM',
  '*6.400,00',
  'TOPKDV',
  '*805,30',
].join('\n');
const zPetravet1418 = zRaporu.extractZRaporuKdv(zPetravet1418Text, zDeps);
eq(zPetravet1418.kdvTutari, '805,30', 'z petravet 1418 z10 alias total');
approx(zPetravet1418.breakdown.find((b) => b.oran === 10).tutar, 313.64, 0.01, 'z petravet 1418 z10 alias');
approx(zPetravet1418.breakdown.find((b) => b.oran === 20).tutar, 491.66, 0.01, 'z petravet 1418 %20 direct');

const zPetravet1432Text = [
  'TOPLAM /20',
  '*1.600,00',
  'TOPKDV 720',
  '*266,67',
  'TOPLAM %10',
  '*2.675,00',
  'TOPKDV %10',
  '243,18',
  'TOPKDV',
  '*509 85',
].join('\n');
const zPetravet1432 = zRaporu.extractZRaporuKdv(zPetravet1432Text, zDeps);
eq(zPetravet1432.kdvTutari, '509,85', 'z petravet 1432 slash alias and spaced total');
approx(zPetravet1432.breakdown.find((b) => b.oran === 20).tutar, 266.67, 0.01, 'z petravet 1432 720 alias');
approx(zPetravet1432.breakdown.find((b) => b.oran === 10).tutar, 243.18, 0.01, 'z petravet 1432 %10 direct');

const zPetravet1430Text = [
  'TOPLAM %20',
  '*2.055,00',
  'TOPKDV %20',
  '*342,50',
  'TOPLAM %10',
  '*9.770,00',
  'TOPKDV %10',
  '*888,18',
  'TOPKDV',
  '*1.230,68',
].join('\n');
const zPetravet1430 = zRaporu.extractZRaporuKdv(zPetravet1430Text, zDeps);
eq(zPetravet1430.kdvTutari, '1230,68', 'z petravet 1430 multi-rate total');
approx(zPetravet1430.breakdown.find((b) => b.oran === 20).tutar, 342.50, 0.01, 'z petravet 1430 %20');
approx(zPetravet1430.breakdown.find((b) => b.oran === 10).tutar, 888.18, 0.01, 'z petravet 1430 %10');

const zPetravet1420Text = [
  'TOPLAM /20',
  '*2. 350,00',
  'TOPKDV /20',
  'TOPLAM /10',
  '.391,67',
  '*2. 600, 00',
  'TOPKDV /10',
  '· 236, 36',
  'TOPLAM',
  '*4 950,00',
  'TOPKDV',
  '*628.03',
].join('\n');
const zPetravet1420 = zRaporu.extractZRaporuKdv(zPetravet1420Text, zDeps);
eq(zPetravet1420.kdvTutari, '628,03', 'z petravet 1420 interleaved label total');
approx(zPetravet1420.breakdown.find((b) => b.oran === 20).tutar, 391.67, 0.01, 'z petravet 1420 interleaved %20');
approx(zPetravet1420.breakdown.find((b) => b.oran === 10).tutar, 236.36, 0.01, 'z petravet 1420 interleaved %10');

const zPetravet1421Text = [
  'TOPLAM /20',
  'TOPKDV 720',
  '*2. 770, 00',
  'TOPLAM Z10',
  '*461.66',
  'TOPKDV /10',
  '*1 250, 00',
  '* 113,64',
  'TOPLAM',
  'TOPKDV',
  '* 4. 020.00',
  '*575,30',
].join('\n');
const zPetravet1421 = zRaporu.extractZRaporuKdv(zPetravet1421Text, zDeps);
eq(zPetravet1421.kdvTutari, '575,30', 'z petravet 1421 interleaved label total');
approx(zPetravet1421.breakdown.find((b) => b.oran === 20).tutar, 461.66, 0.01, 'z petravet 1421 interleaved %20');
approx(zPetravet1421.breakdown.find((b) => b.oran === 10).tutar, 113.64, 0.01, 'z petravet 1421 interleaved %10');

const zPetravet1407CounterText = [
  'TOPLAM FIS SAYISI',
  '6',
  'TOPLAM %20',
  '*1. 980, 00',
  'TOPKDV /20',
  '* 330, 00',
  'TOPLAM /10',
  '*7. 750,00',
  'TOPKDV %10',
  '*704,54',
  'TOPLAM',
  '.9. 730, 00',
  'TOPKDV',
  '* 1. 034,54',
].join('\n');
const zPetravet1407Counter = zRaporu.extractZRaporuKdv(zPetravet1407CounterText, zDeps);
eq(zPetravet1407Counter.kdvTutari, '1034,54', 'z petravet 1407 ignores total fis count');
approx(zPetravet1407Counter.breakdown.find((b) => b.oran === 20).tutar, 330, 0.01, 'z petravet 1407 counter %20');
approx(zPetravet1407Counter.breakdown.find((b) => b.oran === 10).tutar, 704.54, 0.01, 'z petravet 1407 counter %10');

const zPetravet1425DotText = [
  'TOPLAM %10',
  '* 12. 850.00',
  'TOPKDV %10',
  '*1. 168, 17',
  'TOPLAM',
  '* 12. 850 00',
  'TOPKDV',
  '* 1. 168: 17',
].join('\n');
const zPetravet1425Dot = zRaporu.extractZRaporuKdv(zPetravet1425DotText, zDeps);
eq(zPetravet1425Dot.kdvTutari, '1168,17', 'z petravet 1425 dotted amount total');
approx(zPetravet1425Dot.breakdown.find((b) => b.oran === 10).tutar, 1168.17, 0.01, 'z petravet 1425 dotted %10');
approx(zPetravet1425Dot.matrahByOran[10], 12850, 0.01, 'z petravet 1425 dotted gross');
ok('azure/z-raporu.ts (27 assertion)');

// ─── validation/cross-check.ts ───
const zCrossText = [
  'Z RAPORU',
  'Z NO: 1.407',
  'TOPLAM %20',
  '*1. 980, 00',
  'TOPKDV /20',
  '* 330, 00',
  'TOPLAM /10',
  '*7. 750,00',
  'TOPKDV %10',
  '*704,54',
  'TOPLAM',
  '.9. 730, 00',
  'TOPKDV',
  '* 1. 034,54',
].join('\n');
const zCrossResult = {
  rawText: zCrossText,
  belgeNo: '1407',
  date: '02.04.2026',
  kdvTutari: '17480,00',
  kdvBreakdown: [
    { oran: 20, tutar: 7750, matrah: 330 },
    { oran: 10, tutar: 9730, matrah: 704.54 },
  ],
  belgeTipi: 'Z_RAPORU',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
};
crossCheck.crossCheckWithAzure(zCrossResult, zCrossText, '1407.image', '1407', {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  eBelgeNoDistance: () => 0,
  extractZRaporuKdvFromAzure: (text) => zRaporu.extractZRaporuKdv(text, zDeps),
  extractTevkifatliFaturaFromAzure: () => null,
  extractKdvOnlyFromTelekomAzure: () => null,
  extractKdvFromInvoiceTotalsAzure: () => null,
  extractMultiRateKdvFromAzure: () => [{ oran: 20, tutar: 7750, matrah: 330 }],
  extractMultiRateKdvFromItemRows: () => [{ oran: 20, tutar: 7750, matrah: 330 }, { oran: 10, tutar: 9730, matrah: 704.54 }],
  extractHesMatrahKdvTable: () => ({ breakdown: [], totalKdv: null }),
  isFieldInAzureText: () => true,
  logger: { log: () => {}, warn: () => {} },
});
eq(zCrossResult.kdvTutari, '1034,54', 'cross-check z report keeps TOPKDV total');
approx(zCrossResult.kdvBreakdown.find((b) => b.oran === 20).tutar, 330, 0.01, 'cross-check z report %20 stays Azure Z parser');
approx(zCrossResult.kdvBreakdown.find((b) => b.oran === 10).tutar, 704.54, 0.01, 'cross-check z report %10 stays Azure Z parser');
ok('validation/cross-check.ts Z_RAPORU guard (3 assertion)');

// ─── azure/tevkifatli-fatura.ts ───
const foldFn = azureHelpers.foldTurkishAscii;
eq(tevkifatli.parseTevkifatRate('KDV Tevkifati (5/10)', foldFn), 50, 'tevkifat rate fraction');
eq(tevkifatli.parseTevkifatRate('KDV Tevkifati (%50)', foldFn), 50, 'tevkifat rate percent');
eq(tevkifatli.parseTevkifatRate('Hicbir tevkifat', foldFn), 0, 'tevkifat rate none');
ok('azure/tevkifatli-fatura.ts parseTevkifatRate (3 assertion)');

// ─── azure/kdv-breakdown.ts (multi-rate) ───
const breakdownDeps = {
  parseAmount: ublDeps.parseAmount,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  stripMatrahFragments: azureHelpers.stripMatrahFragments,
  isMatrahOrRateLine: (v) => textClassifiers.isMatrahOrRateLine(v, foldFn),
  isForbiddenKdvAmountLine: (v) => textClassifiers.isForbiddenKdvAmountLine(v, foldFn),
  isLikelyKdvAmountColumnHeader: (ls, i) => textClassifiers.isLikelyKdvAmountColumnHeader(ls, i, foldFn),
  isLikelyStandaloneTaxRate: (v) => textClassifiers.isLikelyStandaloneTaxRate(v, foldFn),
  extractElectricityKdvFromAzure: () => null,
};
const multiText = [
  'Hesaplanan KDV (%20) 200,00',
  'Hesaplanan KDV (%10) 50,00',
].join('\n');
const multiResult = kdvBreakdown.extractMultiRateKdv(multiText, breakdownDeps);
eq(multiResult.length, 2, 'multi-rate count');
approx(multiResult.find((b) => b.oran === 20).tutar, 200, 0.01, 'multi-rate %20 tutar');
approx(multiResult.find((b) => b.oran === 10).tutar, 50, 0.01, 'multi-rate %10 tutar');
ok('azure/kdv-breakdown.ts extractMultiRateKdv (3 assertion)');

// ─── azure/okc-fis.ts ───
const okcDeps = {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  stripMatrahFragments: azureHelpers.stripMatrahFragments,
  isMatrahOrRateLine: (v) => textClassifiers.isMatrahOrRateLine(v, foldFn),
  logger: { warn: () => {} },
};
const okcText = [
  'FIS NO 12345',
  'TOPKDV %20  20,00',
].join('\n');
const okcResult = okcFis.extractOkcFisKdv(okcText, okcDeps);
assert(okcResult !== null, 'okc result not null');
eq(okcResult.kdvTutari, '20,00', 'okc kdv tutari');
const okcShokText = [
  'FIS NO',
  '0159',
  'MIS BARDAK AYRAN TAM',
  '%01',
  '*9,50',
  'ALISVERIS POSETI',
  '%20',
  '*1,00',
  'MEZZET RUS SALATASI',
  '401',
  '*31,50',
  'CAFE CROWN',
  '%01',
  '*11,50',
  'CAFE CROWN',
  '%01',
  '*11,50',
  'TOPKDV',
  '*0,80',
  'TOPLAM',
  '*65,00',
].join('\n');
const okcShok = okcFis.extractOkcFisKdv(okcShokText, okcDeps);
assert(okcShok !== null, 'okc shok result not null');
eq(okcShok.kdvTutari, '0,80', 'okc shok topkdv wins');
approx(okcShok.breakdown.find((b) => b.oran === 1).tutar, 0.63, 0.01, 'okc shok 401 alias as %1');
approx(okcShok.breakdown.find((b) => b.oran === 20).tutar, 0.17, 0.01, 'okc shok %20 gross to kdv');

const okcCancelText = [
  'FIS NO: 00016',
  '%10',
  '*300,00',
  '%1',
  '*71,98',
  '%1',
  '*91,80',
  '%1',
  '*71,98',
  '%1',
  '*- 71,98',
  '%1',
  '*138,60',
  'TOPKDV',
  '*30,26',
  'TOPLAM',
  '*602,38',
].join('\n');
const okcCancel = okcFis.extractOkcFisKdv(okcCancelText, okcDeps);
assert(okcCancel !== null, 'okc cancel result not null');
eq(okcCancel.kdvTutari, '30,26', 'okc cancel topkdv preserved');
approx(okcCancel.breakdown.find((b) => b.oran === 1).tutar, 2.99, 0.01, 'okc cancel negative line subtracts');
approx(okcCancel.breakdown.find((b) => b.oran === 10).tutar, 27.27, 0.01, 'okc cancel %10 gross to kdv');

const okcSuspiciousTopKdvText = [
  'FIS NO',
  '13',
  '/20',
  '*3.100,00',
  'TOPKDV',
  '1516,67',
  'TOPLAM',
  '*3.100,00',
].join('\n');
const okcSuspicious = okcFis.extractOkcFisKdv(okcSuspiciousTopKdvText, okcDeps);
assert(okcSuspicious !== null, 'okc suspicious topkdv result not null');
eq(okcSuspicious.kdvTutari, '516,67', 'okc suspicious topkdv corrected from gross/rate');
approx(okcSuspicious.breakdown.find((b) => b.oran === 20).tutar, 516.67, 0.01, 'okc slash-rate gross to kdv');

const okcDotRateAliasText = [
  'FIS NO:',
  '17',
  'YEMEK',
  '7.10',
  '*620,00',
  'TOPKDV',
  '*56,36',
  'TOPLAM',
  '*620,00',
].join('\n');
const okcDotRate = okcFis.extractOkcFisKdv(okcDotRateAliasText, okcDeps);
assert(okcDotRate !== null, 'okc dotted 710 rate result not null');
eq(okcDotRate.kdvTutari, '56,36', 'okc dotted 710 topkdv preserved');
approx(okcDotRate.breakdown.find((b) => b.oran === 10).tutar, 56.36, 0.01, 'okc dotted 710 alias is not parsed as amount');

const okcSpacedAmountText = [
  'FIS NO: 7',
  'YIYECEK',
  '%10',
  '* 1. 000, 00',
  'ICECEK',
  '%10',
  '* 290,00',
  'TOPKDV',
  '*117,27',
  'TOPLAM',
  '*1.290,00',
].join('\n');
const okcSpacedAmount = okcFis.extractOkcFisKdv(okcSpacedAmountText, okcDeps);
assert(okcSpacedAmount !== null, 'okc spaced amount result not null');
eq(okcSpacedAmount.kdvTutari, '117,27', 'okc spaced gross topkdv preserved');
approx(okcSpacedAmount.breakdown.find((b) => b.oran === 10).tutar, 117.27, 0.01, 'okc spaced gross amounts summed');

const okcTahir0095Text = [
  'FIS NO',
  '0095',
  '%01',
  '*106,83',
  '%01',
  '*149,95',
  'TOPKDV',
  'TOPLAM',
  '*2,54',
  '*256,78',
  'KDV Orani',
  'KDV Dahil Tutar',
  'KDV',
  '%1',
  '*256,78',
  '*2,54',
].join('\n');
const okcTahir0095 = okcFis.extractOkcFisKdv(okcTahir0095Text, okcDeps);
assert(okcTahir0095 !== null, 'okc tahir 0095 result not null');
eq(okcTahir0095.kdvTutari, '2,54', 'okc tahir 0095 topkdv/table not double counted');
approx(okcTahir0095.breakdown.reduce((sum, b) => sum + b.tutar, 0), 2.54, 0.01, 'okc tahir 0095 breakdown total');

const okcTahir0368Text = [
  'FIS NO',
  ':0368',
  '3 AD x 26,00 TL/AD',
  'EVIN MARGARIN 250GR',
  '%1',
  '*78,00',
  '%1',
  '21 AD x 17,90 TL/AD',
  '*449,00',
  'ETI TUTKU MOZAIK 100',
  '%1',
  '*375,90',
  'ASPEROX SARI GUC 650',
  '%20',
  '*99,00',
  'ALISVERIS POSETI',
  '%20',
  '*1,00',
  'INDIRIMLER',
  '*- 30,00',
  'TOPKDV',
  'TOPLAM',
  '*20,61',
  '*972,90',
].join('\n');
const okcTahir0368 = okcFis.extractOkcFisKdv(okcTahir0368Text, okcDeps);
assert(okcTahir0368 !== null, 'okc tahir 0368 result not null');
eq(okcTahir0368.kdvTutari, '20,61', 'okc tahir 0368 topkdv wins over discounted item inference');
approx(okcTahir0368.breakdown.reduce((sum, b) => sum + b.tutar, 0), 20.61, 0.01, 'okc tahir 0368 breakdown total');
ok('azure/okc-fis.ts (25 assertion)');

// ═══════════════════════════════════════════════════════════
// SONUC
// ═══════════════════════════════════════════════════════════

console.log('[ocr-modules-regression] Tum modul testleri gecti:');
console.log(log.join('\n'));
const totalAssertions = log.reduce((sum, line) => {
  const m = line.match(/\((\d+) assertion\)/);
  return sum + (m ? parseInt(m[1], 10) : 0);
}, 0);
console.log(`\n  Toplam: ${log.length} modul, ${totalAssertions} assertion`);
