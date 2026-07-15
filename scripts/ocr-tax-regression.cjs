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

function parseTrAmount(value) {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.')) || 0;
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

const ttnetTaxesTotalText = [
  'TTNET ANONIM SIRKETI',
  'E162026030146823',
  'Fatura Tarihi 30.04.2026',
  'DEVLETE ODENEN VERGILER TOPLAMI',
  '148,56',
  'KDV %20 (Matrah 508.20 )',
  '101,64',
  'OIV %10 (Matrah 469.23 )',
  '46,92',
  'Telsiz Kullanim Aylik Taksit %4',
  '0,13',
].join('\n');

const ttnetKdvOnly = service.extractKdvOnlyFromTelekomAzure(ttnetTaxesTotalText);
approx(ttnetKdvOnly, 101.64, 'TTNET devlete odenen vergiler toplamindan sadece KDV alinmali');

const ttnetWrongClaudeResult = {
  rawText: '',
  belgeNo: 'E162026030146823',
  date: '30.04.2026',
  kdvTutari: '148,69',
  totalTutari: '617,02',
  fieldConfidence: { belgeNo: 0.9, date: 0.9, kdvTutari: 0.9 },
  confidence: 0.9,
  engine: 'test',
  kdvBreakdown: [
    { oran: 4, tutar: 0.13, matrah: null },
    { oran: 10, tutar: 46.92, matrah: null },
    { oran: 20, tutar: 101.64, matrah: null },
  ],
};
service.crossCheckWithAzure(
  ttnetWrongClaudeResult,
  ttnetTaxesTotalText,
  'E162026030146823.html',
  'E162026030146823',
);
approx(parseTrAmount(ttnetWrongClaudeResult.kdvTutari), 101.64, 'TTNET cross-check KDV tutarini kilitlemeli');
assert(
  Array.isArray(ttnetWrongClaudeResult.kdvBreakdown) &&
    ttnetWrongClaudeResult.kdvBreakdown.length === 1 &&
    ttnetWrongClaudeResult.kdvBreakdown[0].oran === 20,
  `TTNET cross-check OIV/Telsiz kirilimini temizlemeli: ${JSON.stringify(ttnetWrongClaudeResult.kdvBreakdown)}`,
);
approx(ttnetWrongClaudeResult.kdvBreakdown[0].tutar, 101.64, 'TTNET cross-check breakdown tutari');
approx(ttnetWrongClaudeResult.kdvBreakdown[0].matrah, 508.2, 'TTNET cross-check KDV matrahi');

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

// ─── e-arsiv kalem indirim orani ("%10 İSKONTO") KDV dilimi sanilmamali ───
// ALB... faturasi: her kalem %20 KDV; ayrica satir-ici %10 İSKONTO orani kendi
// satirinda durur, indirim tutari hemen ustte/altta "İSKONTO/İndirim" ile gelir.
// Eskiden bu indirim tutarlari (36,65...) %10 KDV dilimi olarak toplanip toplami
// sisirebiliyordu (3.227,53 yerine 3.605,07). Gercek %20 + %1 KDV korunmali, %10 cikmali.
const albDiscountText = [
  'e-Arşiv Fatura',
  'Belge No: ALB2026000001639',
  '1',
  '510 ALBA TURNA KAŞIK',
  '30 Adet',
  '%20,00',
  '305,43 TL',
  '1.527,16 TL',
  '2',
  'JIGHEAD 6435 COMPACT SET 3',
  '1 Kutu',
  '%20,00',
  '65,98 TL',
  '366,50 TL',
  '%10',
  'GR 40 LI KT',
  '36,65 TL',
  'İSKONTO',
  'İndirim',
  '3',
  'EKMEK',
  '%1',
  '4,72 TL',
  '476,00 TL',
].join('\n');
const albBreakdown = service.extractMultiRateKdvFromItemRows(albDiscountText);
assert(
  !albBreakdown.some((row) => row.oran === 10),
  `ALB indirim orani %10 KDV dilimi sanilmamali: ${JSON.stringify(albBreakdown)}`,
);
approx(albBreakdown.find((row) => row.oran === 20)?.tutar, 371.41, 'ALB %20 KDV (305,43+65,98) korunmali');
approx(albBreakdown.find((row) => row.oran === 1)?.tutar, 4.72, 'ALB %1 KDV korunmali');

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
const zeyrekInterleavedTevkifat = service.extractTevkifatliFaturaFromAzure(zeyrekInterleavedTevkifatText);
assert(zeyrekInterleavedTevkifat, 'Zeyrek araya aciklama giren tevkifat faturasi parse edilmeli');
approx(zeyrekInterleavedTevkifat.tamKdv, 2156, 'Zeyrek 103 tam KDV');
approx(zeyrekInterleavedTevkifat.tevkifat, 431.2, 'Zeyrek 103 toplam tevkifat');
approx(zeyrekInterleavedTevkifat.netKdv, 1724.8, 'Zeyrek 103 net KDV');

// EKO TEVKIFAT (GIB...045): tek oranli ama tevkifat tutari belgenin iki bolumunde
// (KDV kirilim tablosu + ozet) tekrar yaziliyor -> 1.064 + 1.064 = 2.128 toplaniyordu.
// Ayni tutar tekrari ayri oran degil; tek deger (1.064) alinmali.
const echoTevkifatText = [
  'GIB2026000000045',
  'Mal Hizmet Toplam Tutari 26.600,00 TL',
  'Hesaplanan KDV(%20) 5.320,00 TL',
  'KDV Tevkifati(%20) 1.064,00 TL',
  'Tevkifata Tabi Islem Tutari 26.600,00 TL',
  'Tevkifata Tabi Islem Uzerinden Hes. KDV 5.320,00 TL',
  'KDV Tevkifati(%20) 1.064,00 TL',
  'Vergiler Dahil Toplam Tutar 31.920,00 TL',
  'Odenecek Tutar 30.856,00 TL',
].join('\n');
const echoTevkifat = service.extractTevkifatliFaturaFromAzure(echoTevkifatText);
assert(echoTevkifat, 'eko tevkifat faturasi parse edilmeli');
approx(echoTevkifat.tamKdv, 5320, 'eko tam KDV');
approx(echoTevkifat.tevkifat, 1064, 'eko tevkifat tek deger (2x echo toplanmamali)');
approx(echoTevkifat.netKdv, 4256, 'eko net KDV');

// ── TAM BORU HATTI PINLERI (2026-07-15) ─────────────────────────────────────
// Tekil cikaricilar dogruyken TAM boru hatti (override/adapter zinciri) yanlis
// deger uretebiliyor — iki gercek vaka pipeline seviyesinde pinlenir:
//   1) lifebox LB32026007893564: sutun-basorlikli tablo; "Turkcell" gectigi icin
//      telekom override tetiklenir ve tarih parcasini (01.06) KDV sanardi.
//      Matematiksel kanitli sonuc (29,16 x %20 = 5,83) EZILMEMELI.
//   2) MEZCAR CHS2026000001375: araba servis faturasindaki "ELEKTRIK ISCILIGI"
//      kalemi elektrik adapterini tetikleyip "Fatura Kdv Matrahi" 23.553,13'u
//      KDV sanardi. Dogru: Hesaplanan KDV 4.710,61.

const lifeboxFullText = [
  'lifebox', 'Hayata Yer Aç', 'Fatura Tarihi / Saati:', '01.06.2026/17:10',
  'Fatura No:', 'LB32026007893564', 'e-Arşiv Fatura',
  'Paket Adı', 'Hizmet Dönemi', 'Fiyat', 'KDV (%20.0)', 'Toplam Fiyat',
  'lifebox Kampanyalı 100 GB İçerik', '01.06.2026 - 01.07.2026',
  '29,16 TL', '5,83 TL', '34,99 TL', 'Toplam Tutar', '34,99 TL',
  '* Bu fatura bilgilendirme amaçli gönderilmistir, tutar Turkcell faturaniz üzerinden tahsil edilecektir.',
  'Vergi No: 6081249503',
  'Lifecell Dijital Servisler ve Çözümler Anonim',
].join('\n');

const mezcarServiceText = [
  'MEZCAR OTOMOTIV İNŞ.TEKS. VE GIDA SAN.TİC.LTD.ŞTİ.',
  'e-Arşiv Fatura', 'Fatura No:', 'CHS2026000001375', 'Fatura Tarihi:', '16-06-2026',
  'Sıra', 'Malzeme / Hizmet', 'Miktar', 'Birim Fiyat', 'iskonto Oranı', 'İskonto Tutarı', 'KDV Oranı', 'KDV Tutarı',
  'CAM', '78000500TR', 'TEMİZLEYİCİ', '1,0 Adet', '190,0000 TL', '% 5,00', '9,50 TL', '% 20,00', '36,10 TL', '180,50', 'TL',
  '14', '03', 'ELEKTRİK', '170,00', 'İŞÇİLİĞİ', ',05 Adet', '3.400,0000 TL', '% 20,00', '34,00 TL', 'TI',
  'Mal / Hizmet Toplam Tutarı', '25.268,57 TL',
  'Toplam İskonto', '1.715,44 TL',
  'Fatura Ara Toplamı', '23.553,13 TL',
  'Fatura Kdv Matrahı', '23.553,13 TL',
  'Hesaplanan KDV (% 20,00 )', '4.710,61 TL',
  'Toplam Tutar', '28.263,74 TL',
].join('\n');

(async () => {
  const lifeboxSvc = new OcrService();
  lifeboxSvc.getAzureRawText = async () => lifeboxFullText;
  const lifeboxResult = await lifeboxSvc.runAzureOcr(Buffer.from('stub'), 'LB32026007893564', 'LB32026007893564.html');
  approx(parseTrAmount(lifeboxResult.kdvTutari), 5.83, 'lifebox tam-pipeline: telekom override matematiksel kanitli 5,83 KDV yi ezmemeli');

  const mezcarSvc = new OcrService();
  mezcarSvc.getAzureRawText = async () => mezcarServiceText;
  const mezcarResult = await mezcarSvc.runAzureOcr(Buffer.from('stub'), 'CHS2026000001375', 'CHS2026000001375.html');
  approx(parseTrAmount(mezcarResult.kdvTutari), 4710.61, 'MEZCAR tam-pipeline: ELEKTRIK ISCILIGI kalemi elektrik adapterini tetiklememeli, KDV=4.710,61');

  // OZH2026000003080 (2026-07-15): tevkifatli alis; kalemlerdeki ISKONTO ORANI
  // sutunu (%23, %26) KDV orani sanilip tam KDV 3.647,46 yerine 6.297,05'e
  // sisiyordu. TR gecerli KDV orani filtresi (%1/%8/%10/%18/%20) %23/%26'yi eler.
  // Net KDV = 1.823,73 (tevkifat dusulmus), tevkifat = 1.823,73, tam = 3.647,46.
  const ozhText = [
    'ÖZMUTLU DEMİR', 'VKN: 7030033123', 'e-FATURA', 'Fatura Tipi:', 'TEVKIFAT',
    'Fatura No:', 'OZH2026000003080', 'Fatura Tarihi:', '08-06-2026',
    'Sıra', 'İskonto', 'İskonto', 'KDV', 'Mal Hizmet',
    'No', 'Miktar', 'Birim Fiyat', 'Oranı', 'Tutarı', 'Oranı', 'KDV Tutarı',
    '1', '40X40X1,50.mm.BOYALI Profil', '60 m', '78,47 TL', '%23,00', '1.082,89 TL', '%20', '725,06 TL', 'KDV TEVKİFAT', '(%50,00)=362,53 TL', '3.625,31 TL',
    '2', '30X30X1,50.mm.Profil Boru.', '60 m', '59,29 TL', '%26,00', '924,92 TL', '%20', '526,50 TL', 'KDV TEVKIFAT', '(%50,00)=263,25 TL', '2.632,48 TL',
    '4', '20X20X1,50.mm.Profil Boru.', '60 m', '41,14 TL', '%26,00', '641,78 TL', '%20', '365,32 TL', 'KDV TEVKIFAT', '(%50,00)=182,66 TL', '1.826,62 TL',
    'Mal Hizmet Toplam Tutarı', '24.454,14 TL',
    'Hesaplanan KDV(%20', '3.647,46 TL',
    'Hesaplanan KDV Tevkifat(%50)', '1.823,73 TL',
    'Ödenecek Tutar', '20.061,04 TL',
  ].join('\n');
  const ozhSvc = new OcrService();
  ozhSvc.getAzureRawText = async () => ozhText;
  const ozhResult = await ozhSvc.runAzureOcr(Buffer.from('stub'), 'OZH2026000003080', 'OZH2026000003080.html');
  const ozhOranlar = (ozhResult.kdvBreakdown || []).map((b) => b.oran).sort((a, b) => a - b);
  assert(
    !ozhOranlar.includes(23) && !ozhOranlar.includes(26),
    `OZH tevkifatli: gecersiz KDV orani (%23/%26 iskonto orani) breakdown'a girmemeli, geldi: ${JSON.stringify(ozhOranlar)}`,
  );
  assert(
    ozhOranlar.every((o) => [1, 8, 10, 18, 20].includes(o)),
    `OZH tevkifatli: breakdown yalniz gecerli TR KDV orani icermeli, geldi: ${JSON.stringify(ozhOranlar)}`,
  );

  console.log('OK ocr-tax-regression');
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
