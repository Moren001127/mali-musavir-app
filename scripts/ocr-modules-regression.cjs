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
const postProcess = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/validation/post-process.ts'));

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
// BEREKET tipi: "Z GÜNLÜK RAPORU" (araya GÜNLÜK girer) + "FİŞ NO"/"EKÜ NO" tasir;
// eskiden OKC_FIS sanilip Z parser'ina hic gitmiyordu → 22/28 okunamadi.
eq(
  azureHelpers.detectBelgeTipi('BEREKET AVM\nFİŞ NO: 0007\nZ GÜNLÜK RAPORU\nZ SAYAÇ\n920\nKUM TOP\nEKÜ NO:0001'),
  'Z_RAPORU',
  'helpers detect Z GÜNLÜK RAPORU (FİŞ NO/EKÜ NO olsa bile Z raporu)',
);
eq(azureHelpers.detectBelgeTipi('E-ARSIV FATURA'), 'EARSIV', 'helpers detect EARSIV');
eq(azureHelpers.detectBelgeTipi('E-FATURA'), 'EFATURA', 'helpers detect EFATURA');
deepEq(azureHelpers.extractMoneyAmounts('Tutar: 1.330,00 ve 665,00', ublDeps.parseAmount), [1330, 665], 'helpers extract money');
// GERÇEK bozuk OCR (0029.image / ŞOK): "TOPKDV" -> "TOPKOV" (D->O) + "FİŞ No" -> "115 No".
// Hiçbir OKC/Z imzası kalmadığından belgeTipi=null oluyordu → KDV hiç okunmuyordu.
// TOPKDV varyantı yakalanınca yazarkasa fişi Z_RAPORU olarak sınıflanır.
eq(azureHelpers.detectBelgeTipi('SOK MARKETLER\n115 No\n0029\nTOPKOV\n*3,36'), 'Z_RAPORU', 'helpers detect TOPKOV (D->O) variant');
// GERÇEK örnek (FİLE/BİM e-Arşiv): notlarında "Gün Sonu No"/"Fiş No" geçtiği için
// yanlışlıkla Z_RAPORU sınıflanıp çok-oranlı KDV (%20) düşüyordu. Güçlü e-belge
// sinyali (EARSIVFATURA) artık Z_RAPORU/OKC'den ÖNCE değerlendirilir → EARSIV.
eq(
  azureHelpers.detectBelgeTipi('FİLE MARKET\nSenaryo:\nEARSIVFATURA\ne-Arşiv Fatura\nFatura No:\nZE02026000238705\nHesaplanan KDV(%20)\n86,83\nNot: NOT:Gün Sonu No: 551\nNot: NOT:Fiş No: 457'),
  'EARSIV',
  'helpers e-Arşiv (notunda Gün Sonu/Fiş No olsa bile) EARSIV kalır',
);
ok('azure/helpers.ts (10 assertion)');

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

// ─── BEREKET tipi "VERGI DOKUMU / MALI VERI" duzeni (gercek Adem Can kayitlari) ───
// Etiketler: "%N TOPLAM" (brut, alt satir tutar), duz "KDV" (oran KDV'si, alt satir),
// "TOP"/"KDV" (genel toplam). Generic mantik "TOPKDV/KDV TOPLAM" arar, bunlari kacirir.
// Tek oranli (921 — %10): real KDV 964,07 fis uzerinde acik yaziyordu, sistem OKUNAMADI demisti.
const zBereket921Text = [
  'BEREKET AVM',
  'FİŞ NO: 0013',
  'Z GÜNLÜK RAPORU',
  'Z SAYAÇ',
  '921',
  'TUHAFIYE',
  '%10',
  '11,000',
  '*10.605,00',
  'NET SATIŞ',
  '11',
  '*10.605,00',
  'VERGİ DÖKÜMÜ - -',
  '%10 TOPLAM',
  '*10.605,00',
  'KDV',
  '*964,07',
  'MALI VERİ',
  'TOP',
  '*10.605,00',
  'KDV',
  '*964,07',
  'KUM TOP',
  '*1.683.617,23',
  'KUM KDV',
  '*153.140,38',
].join('\n');
const zBereket921 = zRaporu.extractZRaporuKdv(zBereket921Text, zDeps);
eq(zBereket921.kdvTutari, '964,07', 'z bereket 921 tek oran genel KDV (OKUNAMADI degil)');
approx(zBereket921.breakdown.find((b) => b.oran === 10).tutar, 964.07, 0.01, 'z bereket 921 %10 KDV');

// Cok oranli (936 — %10+%20). OCR % yerine $ okumus ("$10 TOPLAM"), tutar alt satirda.
// Eskiden miktar (3,000/1,000) tutar sanilip 0,44 TL gibi sahte "basarili" uretiliyordu.
const zBereket936Text = [
  'BEREKET AVM',
  'FIŞ NO: 0006',
  'Z GÜNLÜK RAPORU',
  'Z SAYAÇ',
  '936',
  'TUHAFIYE',
  '%10',
  '3,000',
  "'535,00",
  'BALIK.AV.MALZEME %20',
  '1,000',
  '¥685,00',
  'VERGI DÖKÜMÜ',
  '$10 TOPLAM',
  '+535,00',
  'KDV',
  '*48,64',
  '$20 TOPLAM',
  '+685,00',
  'KDV',
  '¥114,17',
  'MALI VERI',
  'TOP',
  '*1.220,00',
  'KDV',
  '*162,81',
  'KUM TOP',
  '*1.719.679,23',
].join('\n');
const zBereket936 = zRaporu.extractZRaporuKdv(zBereket936Text, zDeps);
eq(zBereket936.kdvTutari, '162,81', 'z bereket 936 cok oran genel KDV (0,44 sahte degil)');
approx(zBereket936.breakdown.find((b) => b.oran === 10).tutar, 48.64, 0.01, 'z bereket 936 %10 KDV');
approx(zBereket936.breakdown.find((b) => b.oran === 20).tutar, 114.17, 0.01, 'z bereket 936 %20 KDV');

// 938 — OCR "%20 TOPLAM"i "120 TOPLAM" okumus (% -> 1). Eskiden %20 dilimi (134,16)
// atlanip toplam 338,19 kaliyordu; dogrusu 472,35. rateOfToplam artik 120->20 esler;
// ayrica "MALI VERI" genel KDV'si (472,35) guvenlik agi.
const zBereket938Text = [
  'BEREKET AVM',
  'FIŞ NO: 0015',
  'Z GÜNLÜK RAPORU',
  'Z SAYAÇ',
  '938',
  'TUHAFIYE',
  '$10',
  '11,000',
  '+3.720,00',
  'BALIK. AV. MALZEME %20',
  '3.000',
  '*805,00',
  'NET SATIŞ',
  '14',
  '*4.525,00',
  '- KASIYER SATIŞ RAPORU',
  '1 0014',
  '+4.525,00',
  'VERGI DOKUMÜ',
  '%10 TOPLAM',
  '$3.720,00',
  'KDV',
  '+338,19',
  '120 TOPLAM',
  '+805,00',
  'KDV',
  '*134,16',
  'MALI VERI',
  'TOP',
  '*4.525,00',
  'KDV',
  '*472,35',
  'KUM TOP',
  '*1.726.764,23',
  'KUM KDV',
  '*157.213,58',
].join('\n');
const zBereket938 = zRaporu.extractZRaporuKdv(zBereket938Text, zDeps);
eq(zBereket938.kdvTutari, '472,35', 'z bereket 938 "120 TOPLAM" (%20) okundu, toplam 472,35');
approx(zBereket938.breakdown.find((b) => b.oran === 10).tutar, 338.19, 0.01, 'z bereket 938 %10 KDV');
approx(zBereket938.breakdown.find((b) => b.oran === 20).tutar, 134.16, 0.01, 'z bereket 938 %20 KDV (120 TOPLAM cozuldu)');

// 952 — TEK ORAN ama "MALI VERI" bolumu OCR'da karismis: gercek KDV (310,46)
// "KDV" etiketinden ONCE, KUM TOP degeri (1.777.602,23) etiketten HEMEN SONRA.
// Genel-KDV guvenlik agi bu KUM degerini ASLA almamali (brut 3.415'i asiyor).
const zBereket952Text = [
  'BEREKET AVM',
  'FİŞ NO: 0006',
  'Z GÜNLÜK RAPORU',
  'Z SAYAÇ',
  '952',
  'TUHAFİYE',
  '%10',
  '5,000',
  '*3.415,00',
  'NET SATIŞ',
  '5',
  '*3.415,00',
  '1 0005',
  '*3.415,00',
  'VERGİ DOKÜMÜ',
  '%10 TOPLAM',
  '*3.415,00',
  'KDV',
  '*310,46',
  'MALI VERİ',
  'TOP',
  '*3.415,00',
  '*310,46',
  'KDV',
  '*1.777.602,23',
  'KUM TOP',
  'KUM KDV',
  '$161.894,71',
].join('\n');
const zBereket952 = zRaporu.extractZRaporuKdv(zBereket952Text, zDeps);
eq(zBereket952.kdvTutari, '310,46', 'z bereket 952 KUM degeri (1.7M) toplam sanilmamali');
approx(zBereket952.breakdown.find((b) => b.oran === 10).tutar, 310.46, 0.01, 'z bereket 952 %10 KDV');
ok('azure/z-raporu.ts Bereket VERGI DOKUMU (10 assertion)');

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
  extractOkcFisKdvFromAzure: () => null,
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

// ─── validation/cross-check.ts: KDV-dahil (brüt) tutarı KDV sanma koruması ───
// Köprü/geçiş fişi (İÇTAŞ YSS): satırlar "%10 *125,00" KDV-DAHİL tutar taşır;
// jenerik extractor 125/670'i KDV sanıp toplamı 795'e şişiriyordu. Belgede açık
// "KDV 123,03" var; oran satırları brüt kabul edilip çevrilince (11,36 + 111,67 =
// 123,03) bu toplama oturduğu için düzeltilmeli.
const bridgeText = [
  'ICTAS ALTYAPI YSS KOPRUSU',
  'GECISI %10 *125,00',
  'GECISI %20 *670,00',
  'KDV *123,03',
  'TOPLAM *795,00',
].join('\n');
const bridgeResult = {
  rawText: bridgeText,
  belgeNo: '0695',
  date: '07.05.2026',
  kdvTutari: '795,00',
  kdvBreakdown: [
    { oran: 10, tutar: 125, matrah: null },
    { oran: 20, tutar: 670, matrah: null },
  ],
  belgeTipi: 'DIGER',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
};
crossCheck.crossCheckWithAzure(bridgeResult, bridgeText, '0695.image', '0695', {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  eBelgeNoDistance: () => 0,
  extractZRaporuKdvFromAzure: () => ({ kdvTutari: null, breakdown: [], matrahByOran: {} }),
  extractOkcFisKdvFromAzure: () => null,
  extractTevkifatliFaturaFromAzure: () => null,
  extractKdvOnlyFromTelekomAzure: () => null,
  extractKdvFromInvoiceTotalsAzure: () => null,
  extractMultiRateKdvFromAzure: () => [],
  extractMultiRateKdvFromItemRows: () => [
    { oran: 10, tutar: 125, matrah: null },
    { oran: 20, tutar: 670, matrah: null },
  ],
  extractHesMatrahKdvTable: () => ({ breakdown: [], totalKdv: null }),
  isFieldInAzureText: () => true,
  logger: { log: () => {}, warn: () => {} },
});
approx(bridgeResult.kdvBreakdown.find((b) => b.oran === 10).tutar, 11.36, 0.01, 'kopru %10 brut 125 -> KDV 11,36');
approx(bridgeResult.kdvBreakdown.find((b) => b.oran === 20).tutar, 111.67, 0.01, 'kopru %20 brut 670 -> KDV 111,67');
approx(ublDeps.parseAmount(bridgeResult.kdvTutari), 123.03, 0.02, 'kopru toplam KDV 123,03 (brutten cevrildi)');
// Doğru-okunan belge dokunulmamalı: oran satırları zaten KDV ise brüt-çevrimi açık
// toplama oturmaz, breakdown korunur.
const goodMultiText = [
  'Hesaplanan KDV (%10) 50,00',
  'Hesaplanan KDV (%20) 200,00',
  'KDV 250,00',
  'Odenecek Tutar 1.750,00',
].join('\n');
const goodMultiResult = {
  rawText: goodMultiText,
  belgeNo: 'A1',
  date: '07.05.2026',
  kdvTutari: '250,00',
  kdvBreakdown: [
    { oran: 10, tutar: 50, matrah: null },
    { oran: 20, tutar: 200, matrah: null },
  ],
  belgeTipi: 'DIGER',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
};
crossCheck.crossCheckWithAzure(goodMultiResult, goodMultiText, 'A1.image', 'A1', {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  eBelgeNoDistance: () => 0,
  extractZRaporuKdvFromAzure: () => ({ kdvTutari: null, breakdown: [], matrahByOran: {} }),
  extractOkcFisKdvFromAzure: () => null,
  extractTevkifatliFaturaFromAzure: () => null,
  extractKdvOnlyFromTelekomAzure: () => null,
  extractKdvFromInvoiceTotalsAzure: () => null,
  extractMultiRateKdvFromAzure: () => [
    { oran: 10, tutar: 50, matrah: null },
    { oran: 20, tutar: 200, matrah: null },
  ],
  extractMultiRateKdvFromItemRows: () => [],
  extractHesMatrahKdvTable: () => ({ breakdown: [], totalKdv: null }),
  isFieldInAzureText: () => true,
  logger: { log: () => {}, warn: () => {} },
});
approx(goodMultiResult.kdvBreakdown.find((b) => b.oran === 10).tutar, 50, 0.01, 'dogru breakdown %10 korunur (brut-cevrim yok)');
approx(goodMultiResult.kdvBreakdown.find((b) => b.oran === 20).tutar, 200, 0.01, 'dogru breakdown %20 korunur (brut-cevrim yok)');
// Genel-toplam çapası (b): açık "KDV" satırı OCR'da kırpık/garbled ("SDV") olsa bile,
// oran satırlarının ham toplamı (125+670=795) belgenin en büyük tutarına (795) eşitse
// → brüt kabul edilip çevrilir (11,36 + 111,67 = 123,03).
const bridgeNoKdvText = [
  'ICTAS ALTYAPI YSS KOPRUSU',
  'GECISI %10 *125,00',
  'GECISI %20 *670,00',
  'SDV *123,03',
  'AM *795,00',
  '*795,00',
].join('\n');
const bridgeNoKdvResult = {
  rawText: bridgeNoKdvText,
  belgeNo: '0695',
  date: '07.05.2026',
  kdvTutari: '795,00',
  kdvBreakdown: [
    { oran: 10, tutar: 125, matrah: null },
    { oran: 20, tutar: 670, matrah: null },
  ],
  belgeTipi: 'DIGER',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
};
crossCheck.crossCheckWithAzure(bridgeNoKdvResult, bridgeNoKdvText, '0695b.image', '0695', {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  eBelgeNoDistance: () => 0,
  extractZRaporuKdvFromAzure: () => ({ kdvTutari: null, breakdown: [], matrahByOran: {} }),
  extractOkcFisKdvFromAzure: () => null,
  extractTevkifatliFaturaFromAzure: () => null,
  extractKdvOnlyFromTelekomAzure: () => null,
  extractKdvFromInvoiceTotalsAzure: () => null,
  extractMultiRateKdvFromAzure: () => [],
  extractMultiRateKdvFromItemRows: () => [
    { oran: 10, tutar: 125, matrah: null },
    { oran: 20, tutar: 670, matrah: null },
  ],
  extractHesMatrahKdvTable: () => ({ breakdown: [], totalKdv: null }),
  isFieldInAzureText: () => true,
  logger: { log: () => {}, warn: () => {} },
});
approx(bridgeNoKdvResult.kdvBreakdown.find((b) => b.oran === 10).tutar, 11.36, 0.01, 'kopru (acik KDV yok) %10 genel-toplam capasiyla 11,36');
approx(bridgeNoKdvResult.kdvBreakdown.find((b) => b.oran === 20).tutar, 111.67, 0.01, 'kopru (acik KDV yok) %20 genel-toplam capasiyla 111,67');
ok('validation/cross-check.ts KDV-dahil brut koruması (7 assertion)');

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
// GERÇEK örnek (A101 e-Arşiv): Azure kapanış parantezini kaçırıyor → "Hesaplanan
// KDV(%20" satırı eskiden eşleşmeyip %20 oranı komple düşüyordu. Kapanış parantezi
// opsiyonel olunca tutar (alt satırda) yakalanır.
const multiNoParenText = [
  'Hesaplanan KDV(%1)',
  '16,23 TL',
  'Hesaplanan KDV(%10)',
  '107,45 TL',
  'Hesaplanan KDV(%20',
  '31,50 TL',
  'Vergiler Dahil Toplam Tutar',
].join('\n');
const multiNoParen = kdvBreakdown.extractMultiRateKdv(multiNoParenText, breakdownDeps);
eq(multiNoParen.length, 3, 'multi-rate eksik parantezde de 3 oran');
approx(multiNoParen.find((b) => b.oran === 20).tutar, 31.5, 0.01, 'multi-rate "KDV(%20" (parantezsiz) %20 yakalanir');
ok('azure/kdv-breakdown.ts extractMultiRateKdv (5 assertion)');

// ─── extractKdvFromInvoiceTotals: tek-oranlı e-Arşiv (Ömer Özen OKUNAMADI fix) ───
// Gerçek IGA/ARV OCR metni (kayıtlı fişlerden birebir). (1) "KDV-VAT(%20)" etiketi:
// "-VAT" arası yüzünden eskiden kaçıyordu; tutarlar "KDV Tutarı" başlığından uzakta.
const earsivVatText = [
  "KDV Oranı","KDV Tutarı","Mal Hizmet Tutarı","Row","Material","Goods or Service","Quantity",
  "Unit Price","Discount","Amount","Vat Rate","Vat Amount","Goods or Service","Code","Rate","Amount",
  "1","SD000302","OTOPARK (OTOMOBİL) /","CARPARK AUTO","1,0 Adet","225,00 TL","%20,00","45,00 TL",
  "225,00 TL","Mal Hizmet Toplam Tutarı","Goods or Service Total Amount","225,00 TL","Toplam İskonto",
  "Total Discount","0,00 TL","KDV-VAT(%20)","45,00 TL","KDV Matrahı","Vat Exclusive Amount","225,00 TL",
  "Ödenecek Tutar","Payable Amount",
].join('\n');
const earsivVat = kdvBreakdown.extractKdvFromInvoiceTotals(earsivVatText, breakdownDeps);
assert(earsivVat && Math.abs(earsivVat.kdv - 45) < 0.01, `KDV-VAT(%20) tek oran e-arsiv 45 okunmali (gercek=${JSON.stringify(earsivVat)})`);
// (2) Totali OCR'da kesik çok-kalemli tek-oran fatura (ARV): "KDV Oranı" etiketi +
// kalem-içi "% 20,00" oranlar + "Mal/Hizmet Toplam 6.185,09" → matrah×oran = 1.237,02.
const earsivTruncText = [
  "KDV Oranı","KDV Tutarı","Vergiler","Açıklaması","Tutarı","Embraco NEU","6.090,09","1","AE-6220GK",
  "AE-6220GK","1 Adet","6.090,0900 TL","% 20,00 1.218,02 TL","6220 GK-CSR","TL","Bakır Kılcal","2",
  "BK-002","BK-002","Boru","0,1 KG","950,0000 TL","% 20,00","19,00 TL","95,00 TL","1.00×2.00mm",
  "Mal / Hizmet Toplam Tutarı","6.185,09 TL","Toplam İskonto","0,00 TL",
].join('\n');
const earsivTrunc = kdvBreakdown.extractKdvFromInvoiceTotals(earsivTruncText, breakdownDeps);
assert(earsivTrunc && Math.abs(earsivTrunc.kdv - 1237.02) < 0.02, `kesik çok-kalem tek oran matrah×oran -> 1237,02 (gercek=${JSON.stringify(earsivTrunc)})`);
ok('azure/kdv-breakdown.ts extractKdvFromInvoiceTotals tek-oran e-arsiv (2 assertion)');

// ─── azure/kdv-item-rows.ts (e-fatura alt-toplam cift-sayim regresyonu) ───
const kdvItemRows = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/kdv-item-rows.ts'));
const itemRowDeps = {
  parseAmount: ublDeps.parseAmount,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  stripMatrahFragments: azureHelpers.stripMatrahFragments,
  isForbiddenKdvAmountLine: (v) => textClassifiers.isForbiddenKdvAmountLine(v, foldFn),
  isLikelyKdvAmountColumnHeader: (ls, i) => textClassifiers.isLikelyKdvAmountColumnHeader(ls, i, foldFn),
};
// GERCEK bug (UKF2026000000235): "KDV Tutari(MATRAH %ORAN) deger" e-fatura alt-toplam
// satiri summary olarak taninmayip kalem satirlariyla TOPLANIP her oran 2x cikiyordu
// (%10 1.176 -> 2.352, %20 ... -> 2x). Footer summary sayilinca kalem satirlari atilir.
const itemRowDoubleText = [
  'GUAJ BOYA %10,00 1.176,00 TL 11.760,00 TL',
  'DEFTER %20,00 500,00 TL 2.500,00 TL',
  'Mal/Hizmet Toplam Tutari 14.260,00 TL',
  'KDV Tutari(11.760,00 %10) 1.176,00 TL',
  'KDV Tutari(2.500,00 %20) 500,00 TL',
  'Vergiler Dahil Toplam Tutar 15.936,00 TL',
].join('\n');
const itemRowResult = kdvItemRows.extractMultiRateKdvFromItemRows(itemRowDoubleText, itemRowDeps);
eq(itemRowResult.length, 2, 'item-rows cift-sayim: 2 oran');
approx(itemRowResult.find((b) => b.oran === 10).tutar, 1176, 0.01, 'item-rows %10 cift-saymaz (1.176, 2.352 degil)');
approx(itemRowResult.find((b) => b.oran === 20).tutar, 500, 0.01, 'item-rows %20 cift-saymaz (500, 1.000 degil)');
ok('azure/kdv-item-rows.ts cift-sayim regresyonu (3 assertion)');

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

// FATIH HOME tek oranli OKC: toplam KDV "KDV %20 *1.225,34" biciminde (TOPKDV / KDV
// TUTARI yok). Eskiden kdvLineRe bunu yakalamadigi + tek-oran item-breakdown bos
// dondugu icin null donuyordu -> portal "OKUNAMADI" (Omer Ozen'in 75 alis fisi).
const okcSingleRatePctText = [
  'FATIH HOME ALISVERIS MERKEZI',
  'FIS NO: 1942',
  'SIVI DETERJAN %20 *7.352,05',
  'KDV %20 *1.225,34',
  'TOPLAM *7.352,05',
  'KREDI *7.352,05',
  'EKU NO:0001 Z NO:00001',
].join('\n');
const okcSingleRatePct = okcFis.extractOkcFisKdv(okcSingleRatePctText, okcDeps);
assert(okcSingleRatePct !== null, 'OKC tek oranli "KDV %20 *tutar" sonucu null olmamali (OKUNAMADI fix)');
approx(ublDeps.parseAmount(okcSingleRatePct.kdvTutari), 1225.34, 0.01, 'OKC tek oran KDV %20 = 1.225,34');
approx(okcSingleRatePct.breakdown.find((b) => b.oran === 20).tutar, 1225.34, 0.01, 'OKC tek oran breakdown %20 = 1.225,34');
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

// GERÇEK bozuk OCR (16.image / ANADOLU YAPI): "TOPKDV" -> "1OPKDV" (T->1) +
// "+125,00" -> "¥125,00". Eski özet-KDV regex'i "1OPKDV"yi kaçırıp KDV=null veriyordu.
const okcGarbledTopKdvText = [
  'ANADOLU YAPI MARKET',
  'FİŞ NO 16',
  'INŞAAT MALZEMESI /20',
  '*750,00',
  '1OPKDV',
  '¥125,00',
  'TOPLAM',
  '+750,00',
].join('\n');
const okcGarbled = okcFis.extractOkcFisKdv(okcGarbledTopKdvText, okcDeps);
assert(okcGarbled !== null, 'okc 1OPKDV (T->1) variant result not null');
eq(okcGarbled.kdvTutari, '125,00', 'okc 1OPKDV (T->1) variant kdv read');

// GERÇEK bozuk OCR (0283.image / ERSAN): alttaki "KDV Oranı | KDV Dahil Tutar | KDV"
// kırılım tablosu sütun-sütun karışıp yalın bir "KDV" satırı oluşturuyor. Eski akış
// bunu KDV-toplam satırı sanıp ardından gelen "*70,00" (%10 brütü) değerini ekliyor
// ve TOPKDV 12,06 yerine 82,06 üretiyordu.
const okcKdvHeaderText = [
  'FIS NO',
  '0283',
  'COCA COLA 1,5 LT',
  '%10',
  '*70,00',
  'ULKER CIK',
  '%01',
  '*70,00',
  'TOPKDV',
  'TOPLAM',
  '*12,06',
  '*645,46',
  'KDV Orani',
  'KDV Dahil Tutar',
  '%1',
  '*575,46',
  'KDV',
  '%10',
  '*70,00',
  '*5,70',
  '*6,36',
].join('\n');
const okcKdvHeader = okcFis.extractOkcFisKdv(okcKdvHeaderText, okcDeps);
assert(okcKdvHeader !== null, 'okc KDV-header table result not null');
eq(okcKdvHeader.kdvTutari, '12,06', 'okc bare-KDV header does not add gross 70,00 (TOPKDV wins)');
ok('azure/okc-fis.ts (32 assertion)');

const okcCrossText = [
  'FIS NO : 0276',
  '%01',
  '*85,96',
  '%01',
  '*103,96',
  '%01',
  '*103,56',
  'TOPKDV',
  'TOPLAM',
  '*2,91',
  '*293,88',
].join('\n');
const okcCrossResult = {
  rawText: okcCrossText,
  belgeNo: '0276',
  date: '10.04.2026',
  kdvTutari: '43,91',
  kdvBreakdown: [{ oran: 1, tutar: 43.91, matrah: null }],
  belgeTipi: 'OKC_FIS',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
};
crossCheck.crossCheckWithAzure(okcCrossResult, okcCrossText, '0276.image', '0276', {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  foldTurkishAscii: azureHelpers.foldTurkishAscii,
  normalizeAzureText: azureHelpers.normalizeAzureText,
  eBelgeNoDistance: () => 0,
  extractZRaporuKdvFromAzure: (text) => zRaporu.extractZRaporuKdv(text, zDeps),
  extractOkcFisKdvFromAzure: (text) => okcFis.extractOkcFisKdv(text, okcDeps),
  extractTevkifatliFaturaFromAzure: () => null,
  extractKdvOnlyFromTelekomAzure: () => null,
  extractKdvFromInvoiceTotalsAzure: () => null,
  extractMultiRateKdvFromAzure: () => [],
  extractMultiRateKdvFromItemRows: () => [],
  extractHesMatrahKdvTable: () => ({ breakdown: [], totalKdv: null }),
  isFieldInAzureText: () => true,
  logger: { log: () => {}, warn: () => {} },
});
eq(okcCrossResult.kdvTutari, '2,91', 'cross-check okc receipt keeps Azure TOPKDV total');
approx(okcCrossResult.kdvBreakdown.reduce((sum, b) => sum + b.tutar, 0), 2.91, 0.01, 'cross-check okc receipt breakdown total');
ok('validation/cross-check.ts OKC_FIS guard (2 assertion)');

// ─── validation/post-process.ts belge no format (e-belge regex) ───
const ppDeps = {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  formatIsoToTr: () => null,
  logger: { log: () => {}, warn: () => {} },
};
// GERÇEK örnek (EDELER alış): "12A2026000000104" = rakamla başlayan e-Arşiv no.
// Doğru okunup 0.95 verilmiş; eski regex bu biçimi tanımayıp 0.30 düşürüp %65
// yapıyordu. Artık format geçerli → güven korunur.
const eArsivOk = {
  belgeTipi: 'EARSIV', belgeNo: '12A2026000000104', date: '2026-05-21',
  kdvTutari: '36,14', kdvBreakdown: [{ oran: 1, tutar: 36.14, matrah: null }],
  fieldConfidence: { belgeNo: 0.95, date: 0.9, kdvTutari: 0.92 },
};
postProcess.validateOcrResult(eArsivOk, '12A2026000000104.pdf', ppDeps);
assert(eArsivOk.fieldConfidence.belgeNo >= 0.9, 'e-belge "12A..." formatı belge no güvenini düşürmemeli');
// Negatif kontrol: gerçekten bozuk EFATURA no'su hâlâ cezalandırılmalı
const eFaturaBad = {
  belgeTipi: 'EFATURA', belgeNo: 'XYZ', date: '2026-05-21',
  kdvTutari: '10,00', kdvBreakdown: [],
  fieldConfidence: { belgeNo: 0.95, date: 0.9, kdvTutari: 0.9 },
};
postProcess.validateOcrResult(eFaturaBad, 'bozuk.pdf', ppDeps);
assert(eFaturaBad.fieldConfidence.belgeNo < 0.9, 'gerçekten bozuk e-belge no hâlâ cezalanmalı');
ok('validation/post-process.ts belge no format (2 assertion)');

// ─── post-process matrah×oran çapraz doğrulama (eskiden ölü koddu) ───
const ppDeps2 = {
  parseAmount: ublDeps.parseAmount,
  formatAmount: ublDeps.formatAmount,
  formatIsoToTr: () => null,
  eBelgeNoDistance: () => 99,
  extractDateFromText: () => null,
  logger: { log: () => {}, warn: () => {} },
};
// TUTARSIZ: %20 oran, matrah=100 → beklenen ~20, ama tutar=50 (matrah×oran tutmuyor).
// Eskiden bestDiff=0 sabit olduğu için hiç yakalanmazdı; artık breakdown null + güven düşer.
const badBreakdown = {
  belgeTipi: 'EFATURA', belgeNo: 'ABC2026000000123', date: '2026-05-21', rawText: '',
  kdvTutari: '500,00', totalTutari: null, kdvBreakdown: [{ oran: 20, tutar: 500, matrah: 1000 }],
  fieldConfidence: { belgeNo: 0.95, date: 0.9, kdvTutari: 0.92 },
};
postProcess.postProcessOcrResult(badBreakdown, null, 'tutarsiz.pdf', ppDeps2);
assert(badBreakdown.kdvBreakdown === null, 'matrah×oran tutarsiz breakdown null edilmeli');
assert((badBreakdown.fieldConfidence.kdvTutari ?? 1) <= 0.4, 'tutarsiz breakdown KDV guveni dusurulmeli');
// TUTARLI: %20 oran, matrah=1000, tutar=200 → korunur (yanlış pozitif olmamalı).
const goodBreakdown = {
  belgeTipi: 'EFATURA', belgeNo: 'ABC2026000000124', date: '2026-05-21', rawText: '',
  kdvTutari: '200,00', totalTutari: null, kdvBreakdown: [{ oran: 20, tutar: 200, matrah: 1000 }],
  fieldConfidence: { belgeNo: 0.95, date: 0.9, kdvTutari: 0.92 },
};
postProcess.postProcessOcrResult(goodBreakdown, null, 'tutarli.pdf', ppDeps2);
assert(Array.isArray(goodBreakdown.kdvBreakdown) && goodBreakdown.kdvBreakdown.length === 1, 'tutarli breakdown korunmali');
ok('validation/post-process.ts matrah×oran capraz dogrulama (3 assertion)');

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
