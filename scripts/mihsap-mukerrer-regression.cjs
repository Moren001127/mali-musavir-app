#!/usr/bin/env node
/**
 * MİHSAP MÜKERRER KONTROLÜ regresyonu — 2026-09-25 denetim bulgusu 4 devamı.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *
 * KANIT ZİNCİRİ (canlı veriden):
 *   - Mihsap belgeleri processMihsapDocumentOcr'a gidiyordu (processUploadedDocumentOcr DEĞİL) ve
 *     orada findDuplicate HİÇ çağrılmıyordu → Mihsap'tan gelen belge mükerrer kontrolünden geçmiyordu.
 *   - Canlıda EY42026000192714 aynı mükellefte, aynı satıcıda (VKN 9982016230), aynı günde (31.05.2026)
 *     İKİ KEZ duruyor: biri e-Arşiv'den 774,32 ₺, biri Mihsap'tan 774,63 ₺ (31 kuruş fark = okuma hatası).
 *   - Sistemde mükerrer işaretli belge sayısı 0'dı; imageHash 2.578 belgenin 2.091'inde boş, yani
 *     görsel bazlı tespit de çoğunda çalışamıyor. Tek kalan yol alan bazlı findDuplicate.
 *
 * Bu betik findDuplicate'in o gerçek vakayı YAKALADIĞINI kanıtlar (gerçek fonksiyon, sahte prisma).
 * Böylece Mihsap yoluna eklenen çağrının işe yarayacağı gösterilmiş olur.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { FaturaMuhasebelestirmeService } = require(
  path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/** Sahte prisma: where'i UYGULAMAZ, eldeki belgeyi döndürür. Böylece "eşleşmedi" sonucu
 *  "veri yoktu"dan değil, findDuplicate'in kendi kararından gelir. */
function makeSvc(mevcut) {
  const sorgular = [];
  const prisma = {
    invoiceAccountingDocument: {
      findFirst: async (args) => { sorgular.push(args); return mevcut; },
      findMany: async (args) => { sorgular.push(args); return mevcut ? [mevcut] : []; },
    },
  };
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  return { svc, sorgular };
}

const MEVCUT = {
  id: 'earsiv-belge',
  belgeNo: 'EY42026000192714',
  vendorName: 'SATICI A.Ş.',
  customerName: null,
  taxpayerId: 'tp1',
  faturaTarihi: new Date('2026-05-31T00:00:00.000Z'),
  originalName: 'EY42026000192714.pdf',
};

(async () => {
  console.log('1) Canlı vaka: aynı belge no + aynı satıcı + aynı gün, tutar 31 kuruş farklı');
  {
    const { svc, sorgular } = makeSvc(MEVCUT);
    const r = await svc.findDuplicate('t1', {
      taxpayerId: 'tp1',
      belgeNo: 'EY42026000192714',
      sellerVkn: '9982016230',
      totalAmount: 774.63,            // Mihsap kopyası; mevcut 774,32
      faturaTarihi: new Date('2026-05-31T00:00:00.000Z'),
      invoiceKind: 'ALIS',
    }, 'mihsap-belge');
    ok(!!r && r.duplicateOfId === 'earsiv-belge', `mükerrer yakalandı (${r && r.duplicateOfId})`);
    ok(!!r && r.duplicateSeverity === 'BLOCKING', `seviye BLOCKING (${r && r.duplicateSeverity})`);
    ok(!!r && /belge no/i.test(String(r.duplicateReason || '')), `sebep anlaşılır: "${r && r.duplicateReason}"`);
    // Uzun belge no dalında tutar ve tarih ŞART DEĞİL → 31 kuruş fark tespiti engellemiyor.
    const w = sorgular[0] && sorgular[0].where;
    ok(!!w && w.belgeNo === 'EY42026000192714', 'sorgu belge no ile yapıldı');
    ok(!!w && !('totalAmount' in w), 'uzun belge no dalında tutar eşitliği aranmıyor (31 kuruş fark engel değil)');
  }

  console.log('2) Kendi kendini mükerrer sanmasın');
  {
    const { svc } = makeSvc(null); // notSelf süzgeci uygulanmış gibi: eşleşme yok
    const r = await svc.findDuplicate('t1', {
      taxpayerId: 'tp1', belgeNo: 'EY42026000192714', sellerVkn: '9982016230',
      totalAmount: 774.63, faturaTarihi: new Date('2026-05-31T00:00:00.000Z'), invoiceKind: 'ALIS',
    }, 'mihsap-belge');
    ok(r === null, 'başka belge yoksa mükerrer yok');
  }

  console.log('3) VKN okunamadıysa alan bazlı eşleşme denenmez (yanlış pozitif olmasın)');
  {
    const { svc, sorgular } = makeSvc(MEVCUT);
    const r = await svc.findDuplicate('t1', {
      taxpayerId: 'tp1', belgeNo: 'EY42026000192714', sellerVkn: null,
      totalAmount: 774.63, faturaTarihi: new Date('2026-05-31T00:00:00.000Z'), invoiceKind: 'ALIS',
    }, 'mihsap-belge');
    ok(r === null, 'VKN yoksa null döner');
    ok(sorgular.length === 0, 'VKN yoksa veritabanına hiç gitmiyor');
  }

  console.log('4) Farklı satıcı aynı numara → mükerrer DEĞİL (bulgu 4 ile tutarlı)');
  {
    // Sahte prisma where uygulamadığı için mevcut belge dönüyor; ama VKN listesi farklı olduğundan
    //   gerçek sorguda vknOr eşleşmez. Burada kritik olan: sorgunun VKN süzgecini TAŞIMASI.
    const { svc, sorgular } = makeSvc(MEVCUT);
    await svc.findDuplicate('t1', {
      taxpayerId: 'tp1', belgeNo: 'EY42026000192714', sellerVkn: '1111111111',
      totalAmount: 500, faturaTarihi: new Date('2026-05-31T00:00:00.000Z'), invoiceKind: 'ALIS',
    }, 'yeni');
    const w = sorgular[0] && sorgular[0].where;
    const vknSuzgeci = JSON.stringify((w && w.OR) || []);
    ok(vknSuzgeci.includes('1111111111'), 'sorgu satıcı VKN süzgecini taşıyor (farklı satıcı eşleşmez)');
    ok(!vknSuzgeci.includes('9982016230'), 'başka satıcının VKN\'si sorguya karışmıyor');
  }

  if (failed) { console.error(`\nmihsap-mukerrer-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nmihsap-mukerrer-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
