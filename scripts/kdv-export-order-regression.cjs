#!/usr/bin/env node
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ExcelJS = require(path.join(ROOT, 'apps', 'api', 'node_modules', 'exceljs'));

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

loadTsNode();

const { compareKdvExportRows } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'export',
  'export-row-order.ts',
));
const { KdvControlService } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'kdv-control.service.ts',
));

function date(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function row(id, belgeNo, oran, sourceIndex) {
  return {
    id,
    status: 'MATCHED',
    imageId: `image-${belgeNo}`,
    kdvRecordId: `record-${id}`,
    kdvRecord: {
      belgeNo,
      belgeDate: date('2026-04-29'),
      kdvOrani: oran,
      rowIndex: sourceIndex,
    },
    image: {
      confirmedBelgeNo: belgeNo,
      confirmedDate: '29.04.2026',
    },
  };
}

const rows = [
  row('kdv-0125-1', '0125', 1, 40),
  row('kdv-0046-20', '46', 20, 41),
  row('kdv-0125-20', '0125', 20, 42),
];

rows.sort(compareKdvExportRows(rows, (record) => Number(record?.kdvOrani || 0) || null));

assert.deepStrictEqual(
  rows.map((r) => r.id),
  ['kdv-0125-1', 'kdv-0125-20', 'kdv-0046-20'],
  'Ayni belgeye ait KDV kirilimlari Excel exportta araya baska belge almadan alt alta gelmeli',
);

const service = Object.create(KdvControlService.prototype);
const sharedImage = {
  id: 'image-telekom',
  ocrBelgeNo: 'BC42026015523535',
  ocrDate: '09.04.2026',
  ocrKdvTutari: '62,20',
  ocrKdvBreakdown: [{ oran: 20, tutar: 62.2 }],
};
const fanoutRows = [
  {
    id: 'fanout-kdv',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-kdv',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 62.2, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
  {
    id: 'fanout-zero-1',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-zero-1',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 0, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
  {
    id: 'fanout-zero-2',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-zero-2',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 0, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
];

assert.deepStrictEqual(
  fanoutRows.map((r) => service.getExportFaturaKdvValue(r, fanoutRows, 'ISLETME_GIDER', true)),
  [62.2, 0, 0],
  'Fan-out Excel detayinda sifir KDV Luca satirlari ayni fatura KDV toplamiyla sismemeli',
);

assert.strictEqual(
  service.buildMatchSummary(fanoutRows, 'ISLETME_GIDER').amountMismatch,
  0,
  'Fan-out sifir KDV satirlari oturum ozetinde tutar uyumsuzlugu sayilmamali',
);

const telekomDecision = service.moderateContentAuditDecision(
  {
    risk: 'KONTROL_ET',
    summary: 'Türk Telekom mobil hizmet faturası, servis personel taşımacılığı faaliyetiyle ilişkili olabilir ancak belge metninde işletmesel kullanım amacı açıkça belirtilmemiştir.',
    suggestion: 'Muhasebeci bu mobil hattın işletme faaliyetine ait olduğunu ayrıca belgelemelidir.',
    findings: [],
    confidence: 0.72,
  },
  {
    originalName: 'BC12026026095937.html',
    ocrRawText: 'TÜRK TELEKOM MOBİL HİZMET FATURASI kurumsal hat fatura hizmet bedeli',
    ocrSatici: 'TÜRK TELEKOM',
    ocrBelgeTipi: 'Fatura',
  },
  {
    taxpayer: {
      companyName: 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ',
      notes: 'Servis personel taşımacılığı ve turizm faaliyeti',
    },
  },
);

assert.strictEqual(
  telekomDecision.risk,
  'UYGUN',
  'Telekom/internet gibi olağan işletme giderleri kişisel kullanım sinyali yoksa tekrar kontrol uyarısı üretmemeli',
);

const mealDecision = service.moderateContentAuditDecision(
  {
    risk: 'KONTROL_ET',
    summary: 'Servis taşımacılığı faaliyeti mükellefin restoran yemek fişi; işletme gideri olup olmadığı kontrol edilmelidir.',
    suggestion: 'Muhasebeci yemek giderinin faaliyet bağlantısını ayrıca teyit etmelidir.',
    findings: [],
    confidence: 0.68,
  },
  {
    originalName: 'restoran-fisi.image',
    ocrRawText: 'RESTORAN YEMEK FİŞİ yemek hizmet bedeli',
    ocrKategori: 'Yemek',
  },
  {
    taxpayer: {
      companyName: 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ',
      notes: 'Servis personel taşımacılığı ve turizm faaliyeti',
    },
  },
);

assert.strictEqual(
  mealDecision.risk,
  'UYGUN',
  'Yemek/restoran gibi olağan işletme giderleri açık kişisel/lüks sinyal yoksa anlamsız kontrol uyarısı üretmemeli',
);

const baklavaDecision = service.moderateContentAuditDecision(
  {
    risk: 'KONTROL_ET',
    summary: 'Servis taşımacılığı faaliyeti ile baklava satın alımı arasında doğrudan bağlantı kurulması gerekir; belge metninde işletme amacı açık değildir.',
    suggestion: 'Muhasebeci baklava satın alımının personel ikramı mı yoksa kişisel/özel tüketim mi olduğunu kontrol etmelidir.',
    findings: [
      {
        title: 'İhtiyat yorumu',
        detail: 'AI çıktısı kişisel kullanım ihtimalinden söz etse bile belge metninde böyle bir sinyal yoktur.',
        severity: 'KONTROL_ET',
      },
    ],
    confidence: 0.72,
  },
  {
    originalName: '0003.image',
    ocrRawText: 'BAKLAVA SATIŞ FİŞİ tatlı gıda bedeli',
    ocrKategori: 'Baklava',
  },
  {
    taxpayer: {
      companyName: 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ',
      notes: 'Servis personel taşımacılığı ve turizm faaliyeti',
    },
  },
);

assert.strictEqual(
  baklavaDecision.risk,
  'UYGUN',
  'Baklava/ikram belgesinde kişisel kullanım sadece AI ihtiyat metninde geçiyorsa kontrol uyarısı kalmamalı',
);

const partsDecision = service.moderateContentAuditDecision(
  {
    risk: 'KONTROL_ET',
    summary: 'Servis taşımacılığı faaliyetine yönelik yedek parça ve aksesuar satın alımı görünmektedir ancak bağlantı kurulmalıdır.',
    suggestion: 'Muhasebeci yedek parçanın hangi araca ait olduğunu ayrıca kontrol etmelidir.',
    findings: [],
    confidence: 0.7,
  },
  {
    originalName: 'yedek-parca.image',
    ocrRawText: 'OTO YEDEK PARÇA AKSESUAR BAKIM MALZEMESİ',
    ocrKategori: 'Yedek parça',
  },
  {
    taxpayer: {
      companyName: 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ',
      notes: 'Servis personel taşımacılığı ve turizm faaliyeti',
    },
  },
);

assert.strictEqual(
  partsDecision.risk,
  'UYGUN',
  'Yedek parça/bakım/aksesuar belgeleri taşıma faaliyetiyle olağan gider sayılmalı',
);

const visibleAudit = service.formatContentAuditForExport({
  contentAuditStatus: 'DONE',
  contentAuditRisk: 'KONTROL_ET',
  contentAuditSummary: 'Türk Telekom mobil hizmet faturası, servis personel taşımacılığı faaliyetiyle ilişkili olabilir ancak belge metninde işletmesel kullanım amacı açıkça belirtilmemiştir ve muhasebeci tarafından doğrulanmalıdır.',
  contentAuditSuggestion: 'Muhasebeci, bu mobil hattın işletme faaliyetine (personel taşımacılığı, depo/ofis yönetimi, sürücü iletişimi vb.) ait olduğunu belgelemeli; kişisel kullanım şüphesi varsa mükelleften yazılı açıklama almalıdır.',
  contentAuditFindings: [
    {
      title: 'Uzun bulgu',
      detail: 'Bu ayrıntılı değerlendirme hücre içinde satır yüksekliğini büyütmek yerine Excel hücre notunda kalmalıdır.',
      severity: 'KONTROL_ET',
    },
  ],
});

assert.strictEqual(
  visibleAudit.suggestion,
  'Kontrol et; ayrıntı notta',
  'Excel görünür öneri alanı uzun açıklamayla satır yüksekliğini şişirmemeli',
);
assert.ok(
  visibleAudit.summary.length <= 80,
  'Excel görünür içerik yorumu kısa kalmalı',
);
assert.strictEqual(
  visibleAudit.summary,
  'Ayrıntı hücre notunda',
  'Kontrol satırında uzun yorum hücreye sıkışmamalı',
);
assert.ok(
  visibleAudit.comment.includes('Muhasebeci, bu mobil hattın işletme faaliyetine'),
  'Excel hücre notu uzun içerik denetimi detayını korumalı',
);

async function runExcelLayoutRegression() {
  const exportService = Object.create(KdvControlService.prototype);
  exportService.logger = { warn() {} };
  exportService.findSession = async () => ({
    id: 'session-layout',
    type: 'ISLETME_GIDER',
    periodLabel: '2026/04',
    taxpayer: {
      companyName: 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ',
      taxNumber: '1234567890',
    },
  });
  exportService.checkBelgeSeriContinuity = async () => [];
  exportService.prisma = {
    reconciliationResult: {
      findMany: async () => [
        {
          id: 'layout-row',
          status: 'MATCHED',
          imageId: 'layout-image',
          kdvRecordId: 'layout-record',
          kdvRecord: {
            belgeNo: 'BC12026026095937',
            belgeDate: date('2026-04-09'),
            kdvTutari: 62.2,
            kdvOrani: 20,
            rawData: {},
          },
          image: {
            id: 'layout-image',
            confirmedBelgeNo: 'BC12026026095937',
            confirmedDate: '09.04.2026',
            confirmedKdvTutari: '62,20',
            contentAuditStatus: 'DONE',
            contentAuditRisk: 'KONTROL_ET',
            contentAuditSummary: visibleAudit.comment,
            contentAuditSuggestion: visibleAudit.comment,
            contentAuditFindings: [],
          },
          mismatchReasons: [],
        },
      ],
    },
  };

  const buffer = await exportService.exportResultsToExcel('session-layout', 'tenant-layout', { autoArchive: false });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('KDV Kontrol');
  const headerRow = worksheet.getRow(5);
  const row = worksheet.getRow(6);

  assert.strictEqual(worksheet.getRow(1).getCell(1).value, 'MOREN MALİ MÜŞAVİRLİK · KDV Kontrol Raporu', 'Excel rapor başlığı korunmalı');
  assert.strictEqual(worksheet.getRow(1).getCell(1).alignment.horizontal, 'left', 'Excel rapor başlığı sağa kaçmış gibi merkezlenmemeli');
  assert.strictEqual(worksheet.getRow(1).getCell(10).value, 'RAPOR TARİHİ', 'Excel üst bilgide rapor tarihi etiketi korunmalı');
  assert.strictEqual(worksheet.getColumn(1).width >= 10, true, 'Excel ilk sütun MÜKELLEF/VKN etiketlerini ezmeyecek genişlikte olmalı');
  assert.strictEqual(worksheet.getRow(2).getCell(3).value, 'SERVİS PERSONEL TAŞIMACILIĞI TURİZM LİMİTED ŞİRKETİ', 'Excel üst bilgide mükellef adı korunmalı');
  assert.strictEqual(worksheet.getRow(2).getCell(9).value, '2026/04', 'Excel üst bilgide dönem korunmalı');
  assert.strictEqual(worksheet.getRow(3).getCell(12).value, 0, 'Excel hatalı sayısı normal sayı olarak görünmeli');
  assert.notStrictEqual(worksheet.getRow(3).getCell(12).numFmt, '#,##0.00;[Red]-#,##0.00;0.00', 'Excel hatalı sayısı para/fark formatı miras almamalı');
  assert.strictEqual(worksheet.getRow(4).getCell(3).numFmt, '#,##0.00 "₺"', 'Excel toplam tutar satırı para formatında olmalı');
  assert.ok((worksheet.getRow(1).height || 0) <= 24, 'Excel rapor başlığı büyük boş blok oluşturmamalı');
  assert.ok((worksheet.getRow(2).height || 0) <= 24, 'Excel mükellef üst bilgi satırı kompakt kalmalı');
  assert.ok((worksheet.getRow(3).height || 0) <= 24, 'Excel özet üst bilgi satırı kompakt kalmalı');
  assert.ok((worksheet.getRow(4).height || 0) <= 24, 'Excel tutar üst bilgi satırı kompakt kalmalı');

  assert.strictEqual(headerRow.getCell(1).value, '#', 'Excel ana tablo başlığı kompakt üst bilginin hemen altında başlamalı');
  assert.strictEqual(row.getCell(1).value, 1, 'Excel veri satırı tablo başlığının hemen altında başlamalı');
  assert.strictEqual(row.height, 24, 'Excel veri satırı uzun yorum nedeniyle otomatik büyümemeli');
  assert.notStrictEqual(row.getCell(12).alignment.wrapText, true, 'Öneri hücresi satır sarma yapmamalı');
  assert.notStrictEqual(row.getCell(13).alignment.wrapText, true, 'İçerik yorumu hücresi satır sarma yapmamalı');
  assert.strictEqual(row.getCell(12).value, 'Kontrol et; ayrıntı notta', 'Excel öneri hücresi kısa görünür metin taşımalı');
  assert.strictEqual(row.getCell(13).value, 'Ayrıntı hücre notunda', 'Excel içerik yorumu hücresi kısa görünür metin taşımalı');
  assert.ok(row.getCell(13).note, 'Uzun içerik denetimi detayı hücre notunda kalmalı');
  for (let col = 1; col <= 13; col++) {
    const border = row.getCell(col).border || {};
    assert.ok(border.top?.style, `Excel tablo satırı ${col}. hücre üst kenarlığı olmalı`);
    assert.ok(border.bottom?.style, `Excel tablo satırı ${col}. hücre alt kenarlığı olmalı`);
    assert.ok(border.left?.style, `Excel tablo satırı ${col}. hücre sol kenarlığı olmalı`);
    assert.ok(border.right?.style, `Excel tablo satırı ${col}. hücre sağ kenarlığı olmalı`);
  }
}

runExcelLayoutRegression()
  .then(() => {
    console.log('OK kdv-export-order-regression');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
