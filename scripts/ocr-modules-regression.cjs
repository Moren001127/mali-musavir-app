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
ok('belge-no.ts (4 assertion)');

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
ok('azure/z-raporu.ts (3 assertion)');

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
ok('azure/okc-fis.ts (2 assertion)');

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
