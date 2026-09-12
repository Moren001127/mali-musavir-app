#!/usr/bin/env node
/**
 * UYARI KATMANI regresyonu — Faz 2 (PLAN/15 §C).
 *   apps/api/src/fatura-muhasebelestirme/{uyari-katmani,tevkifat-kurallari}.ts + service (detectFixedAsset,
 *   revalidateDocument, runValidation, createDocumentFromProviderXml iptal süzgeci, approveBatch/batchPostToLuca eleme).
 *
 * Kilitler:
 *   1) DEMİRBAŞ yön bağımsız: alışta klima (had üstü) → DEMIRBAS uyarısı, FIXED_ASSET_MANUAL WARNING (INVALID DEĞİL = kilit değil);
 *      satışta kamyon "satış" → demirbaş; onarım NACE'li mükellefin "kompresör değişimi" satışı → HİZMET (demirbaş değil);
 *      "klima + montaj" iki kalem → klima kalemi demirbaş (fiil yalnız o kalemi eler); had altı → demirbaş değil; yıl→had tablosu.
 *   2) Karar: demirbas_degil → uyarı yok; yine_de_isle → uyarı 'bilgi' + validation WARNING; karar bekliyor → uyariOzet.kararBekliyor.
 *   3) TEVKIFAT_EKSIK: tüm-mükellef kuralı (nakliye 2/10) tutar > eşik → uyarı; ≤ eşik → yok; gerçek tevkifat varsa yok;
 *      AI sınıflandırması yoksa (ham) → yok; sabit kıymet alımı → yok; kelime "tevkifata tabi değildir" notu kuralı kapatmaz.
 *   4) Belirlenmiş alıcı kuralı (bakım-onarım 7/10) + kurumTuru null → ALICI_TIPI_GEREKLI (ünvan "Belediye" → tahmin belediye, seviye uyarı;
 *      tahminsiz → bilgi); kurumTuru='diger' → yok; kurumTuru='kamu' → TEVKIFAT_EKSIK.
 *   5) MÜKERRER: belge no + karşı VKN + tutar ±0,01 + yön aynı daha eski belge → runValidation ERROR (INVALID) + uyarı 'engel' + ilkBelgeId;
 *      tutar 0,02 farklıysa / yön farklıysa → değil.
 *   6) İPTAL: UBL InvoiceTypeCode IPTAL → createDocumentFromProviderXml {created:false, skipped:'iptal'} (belge OLUŞMAZ);
 *      belgeDurumuEngelli: 'Onaylandi'+'Yok' → serbest; 'Iptal' / 'GIB Tarafında Hata' / 'Taslak' → engelli; inboxApprovalFields.
 *   7) TEVKIFAT_VAR tutarlılık: belge 2/10 + kod 624 (2/10) + satır '2/10' → bilgi; kod 201 (4/10) → uyarı; hesap adı "5/10" → uyarı.
 *   8) Eski model → yeni model haritası (TEV_NAKL_EKSIK → TEVKIFAT_EKSIK 'uyari'; INDIRME_BINEK → KKEG_SUPHESI); birleştirmede
 *      türetilen kazanır, 'dogrulama' kaynaklılar yeniden üretilir; HAFIZA_CELISKI korunur.
 *   9) Kaynak metin kilitleri: approveBatch demirbas-karar-bekliyor + mukerrer; batchPostToLuca skippedDemirbas; page.tsx UyariKutusu + 'Karar bekliyor'.
 *  DENETİM UYGULAMASI (gerileme A + mesleki B, 2026-09-12):
 *  10) A.1 eLogo liste durumu: <DOCUMENT> öğe bloğu (4 öğe, 3. iptal → komşular temiz); stateExplanation > stateCode.
 *  11) A.3 belgeDurumuEngelli: kelime sınırlı kalıp; "İptal/Red Talebi Reddedildi" istisnası; "Kredi/Redirect" engelli değil.
 *  12) A.2 MÜKERRER: kısa belge no + aynı gün şartı; yer tutucu (BILINMIYOR/boş/-/uuid) aranmaz; mukerrerKarar=mukerrer_degil → uyarı yok + duplicateOfId temiz; mukerrerKarari ucu.
 *  13) B.2 KDV=0 / iade / satıcı KDV mükellefi değil → tevkifat yok; B.4 satışta TCKN + kurum türü boş → bilgi+soru; B.3 belirlenmis_diger;
 *      B.5 216 bilgi; B.13 negatif liste + kelime başı sınırı (araç kasa tadilatı→203, pamuk ipliği/külçe altın/orijinal granül → yok); B.11/B.12 atıflar.
 *  14) B.1 taban TEVKIFAT_EKSIK yeni tablo karar verince atılır (ALICI_TIPI_GEREKLI ile birlikte çıkmaz); A.10 uyariImza (gereksiz UPDATE yok).
 *  15) B.6 satışta yine_de_isle + 25x/257 yok → FIXED_ASSET_SALE_INCOMPLETE (engel, "elle işledim" yolu); B.7 binek (KDVK 30/b);
 *      A.11 kelime+aritmetik tevkifat → TEVKIFAT_VAR engel + "Tevkifat fişini kur". B.8 satışta had yok; B.9 <=; B.15 tutarParse; B.16 2026 kesin.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const uk = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/uyari-katmani.ts'));
const tk = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/tevkifat-kurallari.ts'));
const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));

let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

// ── Servis örneği (mock prisma) ──
function makeService(db) {
  const state = {
    docs: db.docs || [],
    taxpayer: db.taxpayer || null,
    vendorMemory: db.vendorMemory || null,
    updates: [],
    raw: [],
  };
  const prisma = {
    taxpayer: { findFirst: async () => state.taxpayer },
    vendorMemory: { findUnique: async () => state.vendorMemory },
    vendorMemoryDecision: { findFirst: async () => null, findMany: async () => [] },
    invoiceAccountingDocument: {
      findFirst: async ({ where }) => {
        if (where.id && where.id.not) {
          // mükerrer araması (A.2: kısa belge no'da faturaTarihi gün aralığı şartı da gelir)
          const isSale = where.invoiceKind === 'SATIS';
          const tarihOk = (d) => !where.faturaTarihi || (d.faturaTarihi && d.faturaTarihi >= where.faturaTarihi.gte && d.faturaTarihi < where.faturaTarihi.lt);
          return state.docs.find((d) => d.id !== where.id.not && d.belgeNo === where.belgeNo && d.invoiceKind === where.invoiceKind
            && (isSale ? d.buyerVkn === where.buyerVkn : d.sellerVkn === where.sellerVkn)
            && Number(d.totalAmount) >= where.totalAmount.gte && Number(d.totalAmount) <= where.totalAmount.lte
            && !['REJECTED', 'CANCELLED'].includes(d.status)
            && tarihOk(d)
            && (d.createdAt < where.OR[0].createdAt.lt || (d.createdAt.getTime() === where.OR[1].createdAt.getTime() && d.id < where.OR[1].id.lt))) || null;
        }
        if (where.id && where.tenantId && Object.keys(where).length === 2) return state.docs.find((d) => d.id === where.id) || null;
        return state.docs.find((d) => d.id === where.id) || null;
      },
      update: async ({ where, data }) => { state.updates.push({ id: where.id, data }); const d = state.docs.find((x) => x.id === where.id); if (d) Object.assign(d, data); return d; },
    },
    lucaAccountPlanSnapshot: { findFirst: async () => null },
    $executeRawUnsafe: async (...a) => { state.raw.push(a); },
  };
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, { recordDecision: async () => {} }, {}, {}, {}, {});
  svc.logger = { log() {}, warn() {}, error() {}, debug() {} };
  return { svc, state };
}
const T0 = new Date('2026-08-01T10:00:00Z');
function doc(over = {}) {
  return {
    id: 'd1', tenantId: 't', taxpayerId: 'tp', invoiceKind: 'ALIS', status: 'READY', lucaStatus: 'NOT_STARTED', documentType: 'E_FATURA',
    belgeNo: 'ABC2026000000001', sellerVkn: '1111111111', buyerVkn: '9999999999', vendorName: 'Satıcı AŞ', customerName: 'Müşteri',
    totalAmount: 36000, faturaTarihi: new Date('2026-08-05T00:00:00Z'), createdAt: T0, duplicateOfId: null,
    ocrData: { matrah: 30000, kdvTutari: 6000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 30000, tutar: 6000 }], kalemler: [{ ad: 'Klima 24000 BTU', tutar: 30000, oran: 20 }], giderTuru: 'klima alımı', matrahKategori: 'demirbas' },
    lines: [
      { group: 'matrah', accountCode: '255.01.001', description: 'Demirbaşlar', debit: 30000, credit: 0, rate: '%20' },
      { group: 'vergi', accountCode: '191.01.020', description: 'İndirilecek KDV %20', debit: 6000, credit: 0, rate: '%20' },
      { group: 'cari', accountCode: '320.01.001', description: 'Satıcı AŞ', debit: 0, credit: 36000 },
    ],
    ...over,
  };
}
const TP = { faaliyetAciklama: 'lokanta işletmeciliği', naceKodu: '561001', companyName: 'DEMO LOKANTA LTD', kurumTuru: null, defterTuru: 'BILANCO' };
const uyOf = (state, id = 'd1') => { const d = state.docs.find((x) => x.id === id); return Array.isArray(d.ocrData.uyarilar) ? d.ocrData.uyarilar : []; };
const kodlar = (list) => list.map((u) => u.kod);

(async () => {
  console.log('1) DEMİRBAŞ yön bağımsız + istisnalar + had');
  {
    const { svc, state } = makeService({ docs: [doc()], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    const fa = v.issues.find((i) => i.code === 'FIXED_ASSET_MANUAL');
    assert(fa && fa.severity === 'WARNING', 'alışta klima (30.000 > had) → FIXED_ASSET_MANUAL WARNING (kilit değil)');
    assert(v.status === 'OK', `demirbaş belge INVALID DEĞİL (status ${v.status})`);
    const uy = uyOf(state);
    const dem = uy.find((u) => u.kod === 'DEMIRBAS');
    assert(dem && dem.seviye === 'uyari' && dem.eylemler && dem.eylemler.length === 3, 'DEMIRBAS uyarısı seviye uyari + 3 eylem (elle_islendi / yine_de_isle / demirbas_degil)');
    assert(dem && dem.kaynak === 'dogrulama' && dem.meta && dem.meta.karar == null, 'DEMIRBAS kaynak=dogrulama, karar yok');
    assert(uk.uyariOzet(uy).kararBekliyor === true, 'uyariOzet.kararBekliyor = true');
    assert(dem && dem.mesaj === dem.aciklama && dem.siddet === 'uyari', 'geriye uyum: mesaj/siddet dolu');
  }
  {
    // satışta kendi kamyonunun satışı → demirbaş
    const { svc } = makeService({ docs: [], taxpayer: { faaliyetAciklama: 'yük nakliyeciliği', naceKodu: '494100', companyName: 'YORGUN NAKLİYAT' } });
    const r = svc.detectFixedAsset({ kalemler: [{ ad: '34 ABC 123 plakalı kamyon satış bedeli', tutar: 900000 }] }, { faaliyetAciklama: 'yük nakliyeciliği', naceKodu: '494100', companyName: 'YORGUN NAKLİYAT' }, 'SATIS');
    assert(r.is === true, `satışta nakliyecinin kamyon SATIŞI → demirbaş (${r.reason})`);
    // onarım NACE'li mükellefin "kompresör değişimi" satışı → hizmet
    const tpOnarim = { faaliyetAciklama: 'beyaz eşya onarımı', naceKodu: '952201', companyName: 'SOĞUTMA SERVİS' };
    const r2 = svc.detectFixedAsset({ kalemler: [{ ad: 'Soğuk Oda Kompresörü Değişimi', tutar: 28000 }] }, tpOnarim, 'SATIS');
    assert(r2.is === false, 'onarım NACE (952201) "Soğuk Oda Kompresörü Değişimi" satışı → HİZMET, demirbaş değil');
    // aynı içerik alışta bile "değişimi" fiili → hizmet
    const r3 = svc.detectFixedAsset({ kalemler: [{ ad: 'Kompresör değişimi işçilik', tutar: 28000 }] }, TP, 'ALIS');
    assert(r3.is === false, 'alışta "kompresör değişimi işçilik" → hizmet (fiil)');
    // klima + montaj: klima kalemi fiilsiz → demirbaş kalır
    const r4 = svc.detectFixedAsset({ kalemler: [{ ad: 'Klima 24000 BTU', tutar: 30000 }, { ad: 'Klima montaj hizmeti', tutar: 1000 }] }, TP, 'ALIS');
    assert(r4.is === true && r4.reason === 'klima', 'klima + montaj (2 kalem) → klima kalemi demirbaş (montaj fiili yalnız o kalemi eler)');
    // onarım NACE'li mükellef kendi kompresörünü satıyor ("satış") → demirbaş
    const r5 = svc.detectFixedAsset({ kalemler: [{ ad: 'Kullanılmış kompresör satışı', tutar: 28000 }] }, tpOnarim, 'SATIS');
    assert(r5.is === true, 'onarım NACE ama "kompresör satışı" ibaresi → kendi varlığı, demirbaş');
    // had: 2026 → 12.000; 2025 → 9.900; 2024 → 6.900; env üstünlüğü
    assert(tk.demirbasHaddiTL(2025, {}).tutar === 9900 && tk.demirbasHaddiTL(2024, {}).tutar === 6900, 'VUK 313 had tablosu 2025=9.900, 2024=6.900');
    // B.16: 2026 haddi KESİN (VUK 588 GT: 12.000) → teyit gerekmez; 2027+ (tabloda yok) → son bilinen + teyit gerekli.
    assert(tk.demirbasHaddiTL(2026, {}).teyit_gerekli === false && tk.demirbasHaddiTL(2026, {}).tutar === 12000 && tk.demirbasHaddiTL(2026, {}).kaynak === 'tablo', 'B.16: 2026 haddi 12.000 KESİN, teyit_gerekli=false');
    assert(tk.demirbasHaddiTL(2027, {}).teyit_gerekli === true && tk.demirbasHaddiTL(2027, {}).kaynak === 'son_bilinen', 'B.16: 2027 → son bilinen + teyit_gerekli');
    assert(tk.demirbasHaddiTL(2026, { DEMIRBAS_HADDI_TL: '12400' }).tutar === 12400 && tk.demirbasHaddiTL(2026, { DEMIRBAS_HADDI_TL: '12400' }).kaynak === 'env', 'env DEMIRBAS_HADDI_TL 2026 değerini ezer');
    // B.15: Türkçe biçimli env değeri doğru parse edilir.
    assert(tk.tutarParse('12.400') === 12400 && tk.tutarParse('12.400,50') === 12400.5 && tk.tutarParse('12400.50') === 12400.5 && tk.tutarParse('1.250.000') === 1250000 && tk.tutarParse('12400') === 12400, 'B.15: tutarParse "12.400" / "12.400,50" / "12400.50" / "1.250.000"');
    assert(tk.demirbasHaddiTL(2026, { DEMIRBAS_HADDI_TL: '12.400' }).tutar === 12400 && tk.tevkifatEsikTL(2026, { TEVKIFAT_ESIK_TL: '12.400,50' }).tutar === 12400.5, 'B.15: env "12.400" → 12400 (12,4 DEĞİL)');
    assert(svc.demirbasHaddiAltinda({ matrah: 8000, kalemler: [{ ad: 'Klima', tutar: 8000 }] }, 'klima', 2025) === true, '2025: 8.000 < 9.900 → had ALTI (doğrudan gider)');
    assert(svc.demirbasHaddiAltinda({ matrah: 8000, kalemler: [{ ad: 'Klima', tutar: 8000 }] }, 'klima', 2024) === false, '2024: 8.000 > 6.900 → had ÜSTÜ (demirbaş)');
    // B.9: VUK 313 "aşmayan" → tam had dahil doğrudan gider (<=).
    assert(svc.demirbasHaddiAltinda({ matrah: 9900, kalemler: [{ ad: 'Klima', tutar: 9900 }] }, 'klima', 2025) === true, 'B.9: tam had (9.900 = 9.900) → had ALTI sayılır (aşmayan)');
    assert(svc.demirbasHaddiAltinda({ matrah: 9900.01, kalemler: [{ ad: 'Klima', tutar: 9900.01 }] }, 'klima', 2025) === false, 'B.9: 9.900,01 → had ÜSTÜ');
  }
  {
    // B.8: had yalnız ALIŞ yönünde — satışta düşük bedelli kendi kamyonunun çıkışı DEMİRBAŞ kalır.
    const satisKamyon = doc({ invoiceKind: 'SATIS', totalAmount: 6000, buyerVkn: '5555555555', customerName: 'ALICI', faturaTarihi: new Date('2026-08-05T00:00:00Z'),
      ocrData: { matrah: 5000, kdvTutari: 1000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 5000, tutar: 1000 }], kalemler: [{ ad: 'Kullanılmış kamyon satışı', tutar: 5000, oran: 20 }], giderTuru: 'kamyon satışı', matrahKategori: 'demirbas' },
      lines: [{ group: 'matrah', accountCode: '679.01.001', debit: 0, credit: 5000, rate: '%20' }, { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 1000, rate: '%20' }, { group: 'cari', accountCode: '120.01.001', debit: 6000, credit: 0 }] });
    const { svc, state } = makeService({ docs: [satisKamyon], taxpayer: TP });
    await svc.revalidateDocument('t', 'd1');
    assert(kodlar(uyOf(state)).includes('DEMIRBAS'), 'B.8: SATIŞ 5.000 ₺ kamyon (had altı) → had uygulanmaz, DEMIRBAS uyarısı KALIR');
  }
  {
    // had altı (2025, 8.000 < 9.900) → demirbaş uyarısı yok
    const { svc, state } = makeService({ docs: [doc({ faturaTarihi: new Date('2025-08-05T00:00:00Z'), totalAmount: 9600, ocrData: { matrah: 8000, kdvTutari: 1600, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 8000, tutar: 1600 }], kalemler: [{ ad: 'Klima 12000 BTU', tutar: 8000, oran: 20 }], giderTuru: 'klima alımı' }, lines: [
      { group: 'matrah', accountCode: '770.01.001', debit: 8000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 1600, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.001', debit: 0, credit: 9600 }] })], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    assert(!v.issues.some((i) => i.code === 'FIXED_ASSET_MANUAL') && !kodlar(uyOf(state)).includes('DEMIRBAS'), '2025 yılı 8.000 ₺ klima (had 9.900 altı) → demirbaş uyarısı YOK (doğrudan gider)');
  }

  console.log('2) Demirbaş kararı durumları');
  {
    const { svc, state } = makeService({ docs: [doc({ ocrData: { ...doc().ocrData, demirbasKarar: { karar: 'demirbas_degil' } } })], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    assert(!v.issues.some((i) => i.code === 'FIXED_ASSET_MANUAL') && !kodlar(uyOf(state)).includes('DEMIRBAS'), 'karar demirbas_degil → uyarı ve FIXED_ASSET_MANUAL yok');
  }
  {
    const { svc, state } = makeService({ docs: [doc({ ocrData: { ...doc().ocrData, demirbasKarar: { karar: 'yine_de_isle' } } })], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    const dem = uyOf(state).find((u) => u.kod === 'DEMIRBAS');
    assert(dem && dem.seviye === 'bilgi' && dem.meta.karar === 'yine_de_isle' && !dem.eylemler, 'karar yine_de_isle → DEMIRBAS bilgi, eylem yok');
    assert(v.status === 'OK' && uk.uyariOzet(uyOf(state)).kararBekliyor === false, 'yine_de_isle → status OK, kararBekliyor false');
  }

  console.log('3) TEVKIFAT_EKSIK (tüm KDV mükellefleri: nakliye 2/10)');
  const nakDoc = (over = {}) => doc({
    belgeNo: 'NAK2026000000001', totalAmount: 24000, invoiceKind: 'ALIS',
    ocrData: { matrah: 20000, kdvTutari: 4000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 20000, tutar: 4000 }], kalemler: [{ ad: 'İstanbul-Ankara nakliye hizmeti', tutar: 20000, oran: 20 }], giderTuru: 'nakliye hizmeti', matrahKategori: 'genel_gider', tevkifatHint: true },
    lines: [{ group: 'matrah', accountCode: '740.01.001', debit: 20000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 4000, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.002', debit: 0, credit: 24000 }],
    ...over,
  });
  {
    const { svc, state } = makeService({ docs: [nakDoc()], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'TEVKIFAT_EKSIK');
    assert(u && u.seviye === 'uyari' && u.meta.kod === '224' && u.meta.oran === '2/10', 'nakliye 24.000 > 12.000 (2026) + tevkifat yok → TEVKIFAT_EKSIK 224 2/10 (uyarı)');
    assert(u && /tabi değildir/.test(u.aciklama), '"tevkifata tabi değildir" notu (tevkifatHint) kuralı KAPATMAZ, açıklamada bilgi');
    assert(v.status === 'OK', 'TEVKIFAT_EKSIK belgeyi INVALID yapmaz (uyarı seviyesi)');
    assert(!v.issues.some((i) => i.code === 'TEVKIFAT_NEEDED'), 'kelime ipucu + tam KDV aritmetiği → TEVKIFAT_NEEDED yanlış alarmı YOK');
  }
  {
    const { svc, state } = makeService({ docs: [nakDoc({ totalAmount: 12000, ocrData: { ...nakDoc().ocrData, matrah: 10000, kdvTutari: 2000, kdvBreakdown: [{ oran: 20, matrah: 10000, tutar: 2000 }] }, lines: [{ group: 'matrah', accountCode: '740.01.001', debit: 10000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 2000, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.002', debit: 0, credit: 12000 }] })], taxpayer: TP });
    await svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(state)).includes('TEVKIFAT_EKSIK'), 'KDV dahil tam 12.000 (eşik AŞILMADI) → TEVKIFAT_EKSIK yok');
  }
  {
    const { svc, state } = makeService({ docs: [nakDoc({ ocrData: { ...nakDoc().ocrData, tevkifatOrani: 0.2, tevkifatKdv: 800, tevkifatKodu: '624', tevkifatYuzde: 20 }, lines: [...nakDoc().lines, { group: 'tevkifat', accountCode: '360.01.001', description: 'KDV Tevkifatı 2/10', debit: 0, credit: 800, rate: '2/10' }] })], taxpayer: TP });
    await svc.revalidateDocument('t', 'd1');
    const list = uyOf(state);
    assert(!kodlar(list).includes('TEVKIFAT_EKSIK') && kodlar(list).includes('TEVKIFAT_VAR'), 'gerçek tevkifat verisi → TEVKIFAT_EKSIK yok, TEVKIFAT_VAR var');
  }
  {
    const { svc, state } = makeService({ docs: [nakDoc({ ocrData: { ...nakDoc().ocrData, giderTuru: undefined, matrahKategori: undefined } })], taxpayer: TP });
    await svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(state)).includes('TEVKIFAT_EKSIK'), 'AI sınıflandırması yok (ham) → kelime ipucu tek başına TEVKIFAT_EKSIK üretmez');
  }
  {
    const r = tk.tevkifatEksikDegerlendir({ invoiceKind: 'ALIS', giderTuru: 'yarı römork alımı', matrahKategori: 'demirbas', kalemler: ['Yarı römork nakliye tipi'], kdvDahilTutar: 500000, yil: 2026, tevkifatVar: false, isFixedAsset: true, aliciKurumTuru: null, env: {} });
    assert(r === null, 'sabit kıymet alımı (yarı römork) → tevkifat kuralı çalışmaz');
    assert(tk.tevkifatEsikTL(2025, {}).tutar === 9900 && tk.tevkifatEsikTL(2026, { TEVKIFAT_ESIK_TL: '12400' }).tutar === 12400, 'tevkifat eşiği yıl tablosu + env');
  }

  console.log('4) Belirlenmiş alıcı (bakım-onarım 7/10) × kurumTuru');
  const bakimDoc = (over = {}) => nakDoc({ ocrData: { ...nakDoc().ocrData, kalemler: [{ ad: 'Jeneratör periyodik bakım hizmeti', tutar: 20000, oran: 20 }], giderTuru: 'jeneratör bakım onarım hizmeti', tevkifatHint: false }, ...over });
  {
    const { svc, state } = makeService({ docs: [bakimDoc()], taxpayer: { ...TP, companyName: 'DEMO LOKANTA LTD', kurumTuru: null } });
    await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'ALICI_TIPI_GEREKLI');
    assert(u && u.seviye === 'bilgi' && u.meta.kod === '203' && u.meta.taraf === 'mukellef' && !u.meta.tahmin, 'kurumTuru null + ünvanda kamu ipucu yok → ALICI_TIPI_GEREKLI (bilgi), eylem alıcı tipini seç');
    assert(u && u.eylemler && u.eylemler[0].id === 'alici-tipi-sec', 'eylem: alici-tipi-sec');
    assert(!kodlar(uyOf(state)).includes('TEVKIFAT_EKSIK'), 'alıcı tipi bilinmeden TEVKIFAT_EKSIK verilmez');
  }
  {
    const { svc, state } = makeService({ docs: [bakimDoc()], taxpayer: { ...TP, companyName: 'ÇANKAYA BELEDİYESİ', kurumTuru: null } });
    await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'ALICI_TIPI_GEREKLI');
    assert(u && u.seviye === 'uyari' && u.meta.tahmin === 'belediye', 'ünvan "Belediyesi" → tahmin belediye, seviye uyarı (sahip onayı)');
  }
  {
    const { svc, state } = makeService({ docs: [bakimDoc()], taxpayer: { ...TP, kurumTuru: 'diger' } });
    await svc.revalidateDocument('t', 'd1');
    const k = kodlar(uyOf(state));
    assert(!k.includes('ALICI_TIPI_GEREKLI') && !k.includes('TEVKIFAT_EKSIK'), 'kurumTuru=diger → belirlenmiş alıcı değil, uyarı yok');
  }
  {
    const { svc, state } = makeService({ docs: [bakimDoc()], taxpayer: { ...TP, kurumTuru: 'kamu' } });
    await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'TEVKIFAT_EKSIK');
    assert(u && u.meta.kod === '203' && u.meta.oran === '7/10' && u.meta.kapsam === 'belirlenmis_alicilar', 'kurumTuru=kamu → TEVKIFAT_EKSIK 203 7/10');
  }
  {
    // SATIŞ: alıcı = cari (VendorMemory.kurumTuru)
    const satis = bakimDoc({ invoiceKind: 'SATIS', customerName: 'ANKARA ÜNİVERSİTESİ REKTÖRLÜĞÜ', buyerVkn: '5555555555', lines: [{ group: 'matrah', accountCode: '600.01.001', debit: 0, credit: 20000, rate: '%20' }, { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 4000, rate: '%20' }, { group: 'cari', accountCode: '120.01.001', debit: 24000, credit: 0 }] });
    const { svc, state } = makeService({ docs: [satis], taxpayer: TP, vendorMemory: { kurumTuru: null, firmaUnvan: 'ANKARA ÜNİVERSİTESİ' } });
    await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'ALICI_TIPI_GEREKLI');
    assert(u && u.meta.taraf === 'cari' && u.meta.aliciVkn === '5555555555' && u.meta.tahmin === 'universite', 'SATIŞ: müşteri kurum türü boş → ALICI_TIPI_GEREKLI taraf=cari, tahmin üniversite');
    const { svc: svc2, state: st2 } = makeService({ docs: [JSON.parse(JSON.stringify(satis), (k, v) => (k === 'faturaTarihi' || k === 'createdAt') ? new Date(v) : v)], taxpayer: TP, vendorMemory: { kurumTuru: 'universite', firmaUnvan: 'ANKARA ÜNİVERSİTESİ' } });
    await svc2.revalidateDocument('t', 'd1');
    assert(kodlar(uyOf(st2)).includes('TEVKIFAT_EKSIK'), 'SATIŞ: cari kurumTuru=universite → TEVKIFAT_EKSIK');
  }
  assert(tk.kurumTuruTahmin('T.C. SAĞLIK BAKANLIĞI') === 'kamu' && tk.kurumTuruTahmin('ZİRAAT BANKASI A.Ş.') === 'banka' && tk.kurumTuruTahmin('ABC ÖZEL EĞİTİM KURUMLARI LTD') === null, 'kurumTuruTahmin: T.C./Bankası → kamu/banka; "Eğitim Kurumları" → null');
  assert(tk.belirlenmisAliciMi('kit') === true && tk.belirlenmisAliciMi('diger') === false && tk.belirlenmisAliciMi(null) === null, 'belirlenmisAliciMi: kit true, diger false, null bilinmiyor');

  console.log('5) MÜKERRER');
  {
    const ilk = doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z') });
    const kopya = doc({ id: 'd1', totalAmount: 36000.01 });
    const { svc, state } = makeService({ docs: [ilk, kopya], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    const m = v.issues.find((i) => i.code === 'MUKERRER');
    assert(m && m.severity === 'ERROR' && v.status === 'INVALID', 'belge no + VKN + tutar ±0,01 + yön aynı → MUKERRER ERROR, INVALID (engel)');
    const u = uyOf(state).find((x) => x.kod === 'MUKERRER');
    assert(u && u.seviye === 'engel' && u.meta.ilkBelgeId === 'd0' && u.eylemler[0].id === 'ilk-belgeyi-ac', 'MUKERRER uyarısı engel + ilkBelgeId + "ilk belgeyi aç"');
    assert(uk.uyariOzet(uyOf(state)).mukerrer === true, 'uyariOzet.mukerrer');
    const dupUpd = state.updates.find((x) => x.id === 'd1' && x.data.duplicateOfId === 'd0');
    assert(!!dupUpd && dupUpd.data.duplicateSeverity === 'BLOCKING', 'duplicateOfId/duplicateSeverity BLOCKING yazıldı');
    // ilk belge temiz kalır
    const v0 = await svc.revalidateDocument('t', 'd0');
    assert(!v0.issues.some((i) => i.code === 'MUKERRER'), 'ilk belge (daha eski) mükerrer sayılmaz');
  }
  {
    const ilk = doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), totalAmount: 36000.05 });
    const { svc } = makeService({ docs: [ilk, doc()], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    assert(!v.issues.some((i) => i.code === 'MUKERRER'), 'tutar farkı 0,05 → mükerrer değil');
    const { svc: s2 } = makeService({ docs: [doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), invoiceKind: 'SATIS' }), doc()], taxpayer: TP });
    const v2 = await s2.revalidateDocument('t', 'd1');
    assert(!v2.issues.some((i) => i.code === 'MUKERRER'), 'yön farklı (SATIS vs ALIS) → mükerrer değil');
  }

  console.log('6) İPTAL / TASLAK süzgeci');
  {
    const { svc } = makeService({ docs: [], taxpayer: TP });
    const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';
    const xml = (tip) => `<?xml version="1.0" encoding="UTF-8"?><Invoice ${NS}><cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>IPT2026000000001</cbc:ID><cbc:UUID>22222222-2222-2222-2222-222222222222</cbc:UUID><cbc:IssueDate>2026-08-01</cbc:IssueDate><cbc:InvoiceTypeCode>${tip}</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>SATICI</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">9999999999</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>ALICI</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">1000</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">200</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">1000</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">1000</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">1200</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="TRY">1200</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">1000</cbc:LineExtensionAmount><cac:Item><cbc:Name>Deneme</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">1000</cbc:PriceAmount></cac:Price></cac:InvoiceLine></Invoice>`;
    const cfg = { provider: 'ELOGO', label: 'eLogo' };
    const r = await svc.createDocumentFromProviderXml('t', 'u', { id: 'tp', taxNumber: '9999999999' }, cfg, 'ALIS', { xml: xml('IPTAL'), externalId: 'x1' }, {});
    assert(r && r.created === false && r.skipped === 'iptal' && !r.document, 'UBL InvoiceTypeCode IPTAL → belge OLUŞTURULMAZ ({created:false, skipped:"iptal"})');
    let normalThrew = null;
    try { await svc.createDocumentFromProviderXml('t', 'u', { id: 'tp', taxNumber: '9999999999' }, cfg, 'ALIS', { xml: xml('SATIS'), externalId: 'x2' }, {}); } catch (e) { normalThrew = e; }
    assert(normalThrew && !/skipped/.test(String(normalThrew.message)), 'normal (SATIS tipli) belge süzgeci GEÇER (mock depoda ilerleyip başka yerde durur — süzgeçte durmaz)');
    const e1 = svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandi', iptalItiraz: 'Yok' });
    const e2 = svc.belgeDurumuEngelli({ approvalStatus: 'Iptal', iptalItiraz: 'Yok' });
    const e3 = svc.belgeDurumuEngelli({ approvalStatus: 'GIB Tarafında Hata', iptalItiraz: 'Yok' });
    const e4 = svc.belgeDurumuEngelli({ approvalStatus: 'Onaylandi', iptalItiraz: 'Yok' }, 'taslak');
    const e5 = svc.belgeDurumuEngelli({ approvalStatus: 'Onay Bekliyor', iptalItiraz: 'Yok' });
    assert(!e1.engelli && e2.engelli && e3.engelli && e4.engelli && e4.neden === 'taslak' && !e5.engelli, 'belgeDurumuEngelli: Onaylandi serbest; Iptal / GİB hata / taslak engelli; "Onay Bekliyor" serbest (sahip kararı bekliyor)');
    const f = svc.inboxApprovalFields({ belgeDurumu: 'iptal' }, null);
    assert(f.approvalStatus === 'Iptal' && f.iptalItiraz === 'Iptal' && f.belgeDurumu === 'iptal', 'inboxApprovalFields: UBL iptal → approvalStatus Iptal + belgeDurumu');
    const f2 = svc.inboxApprovalFields({ belgeDurumu: 'onayli' }, { approval: 'Kabul', iptal: null });
    assert(f2.approvalStatus === 'Kabul' && f2.iptalItiraz === 'Yok', 'inboxApprovalFields: sağlayıcı durumu öncelikli');
    const ps = svc.providerStatusFromListItem({ Id: 1, StatusText: 'İptal Edildi', IsCancelled: true });
    assert(ps && ps.iptal === 'Iptal' && /ptal/.test(ps.approval), 'providerStatusFromListItem: Turkcell IsCancelled + StatusText');
  }

  console.log('7) TEVKIFAT_VAR tutarlılık');
  {
    const ok = tk.tevkifatTutarlilik({ tevkifatOrani: 0.2, tevkifatKodu: '624', satirOranlari: ['2/10'], hesapAdlari: ['KDV Tevkifatı 2/10'] });
    assert(ok.length === 0, 'oran 2/10 + kod 624 + satır 2/10 + hesap adı 2/10 → tutarlı');
    const kodUyumsuz = tk.tevkifatTutarlilik({ tevkifatOrani: 0.2, tevkifatKodu: '201', satirOranlari: ['2/10'] });
    assert(kodUyumsuz.length === 1 && /201/.test(kodUyumsuz[0]), 'kod 201 (4/10) ile oran 2/10 → uyuşmazlık');
    const adUyumsuz = tk.tevkifatTutarlilik({ tevkifatOrani: 0.2, tevkifatKodu: '624', hesapAdlari: ['360.01.005 KDV TEVKİFATI 5/10'] });
    assert(adUyumsuz.length === 1 && /5\/10/.test(adUyumsuz[0]), 'hesap adı 5/10, belge 2/10 → uyuşmazlık');
    const { svc, state } = makeService({ docs: [nakDoc({ ocrData: { ...nakDoc().ocrData, tevkifatOrani: 0.2, tevkifatKdv: 800, tevkifatKodu: '601', tevkifatYuzde: 20 }, lines: [...nakDoc().lines, { group: 'tevkifat', accountCode: '360.01.001', description: 'KDV Tevkifatı 2/10', debit: 0, credit: 800, rate: '2/10' }] })], taxpayer: TP });
    await svc.revalidateDocument('t', 'd1');
    const u = uyOf(state).find((x) => x.kod === 'TEVKIFAT_VAR');
    assert(u && u.seviye === 'uyari' && /601|201/.test(u.aciklama), 'belge 2/10 ama UBL kodu 601 (yapım 4/10) → TEVKIFAT_VAR uyarı (oran↔kod tutarsız)');
    assert(u && u.meta.oranMetni === '2/10' && u.meta.kod === '601', 'TEVKIFAT_VAR meta: oranMetni 2/10, kod 601');
    // B.10: kod dili — satıcı KDV1/UBL 6xx, isteğe bağlı tam tevkifat 8xx → alıcı KDV2 2xx; "3xx" ailesi YOK.
    assert(tk.tevkifatKuralBul('624').kod === '224' && tk.tevkifatKuralBul('824').kod === '224' && tk.tevkifatKuralBul('324').kod === '224', 'B.10: kod haritası 6xx (KDV1/UBL) ve 8xx (isteğe bağlı tam) → 2xx; 3xx yalnız Mihsap editör alias\'ı');
    assert(tk.tevkifatTutarlilik({ tevkifatOrani: 1, tevkifatKodu: '624', satirOranlari: ['10/10'] }).length === 0, 'B.10: 6xx kod + 10/10 (isteğe bağlı tam tevkifat) UYUMSUZ SAYILMAZ');
    assert(tk.tevkifatTutarlilik({ tevkifatOrani: 0.2, tevkifatKodu: '824' }).length === 1, 'B.10: 8xx (tam tevkifat) kodu + 2/10 belge oranı → uyuşmazlık');
    assert(tk.oranMetni(0.2) === '2/10' && tk.oranMetni(50) === '5/10' && tk.oranPay('7/10') === 7, 'oranMetni / oranPay');
  }

  console.log('8) Model haritası + birleştirme');
  {
    const eski = [{ kod: 'TEV_NAKL_EKSIK', baslik: 'Tevkifat eksik', mesaj: 'nakliye…', siddet: 'hata' }, { kod: 'INDIRME_BINEK', baslik: 'İndirilemeyen KDV', mesaj: 'binek…', siddet: 'uyari' }, { kod: 'HAFIZA_CELISKI', baslik: 'Öğrenilmiş hesapla çelişki', mesaj: 'x', siddet: 'uyari' }, { kod: 'DEMIRBAS', seviye: 'uyari', baslik: 'eski türetilen', aciklama: 'a', mesaj: 'a', siddet: 'uyari', kaynak: 'dogrulama' }];
    const m = uk.eskiUyariyiHaritala(eski[0]);
    assert(m.kod === 'TEVKIFAT_EKSIK' && m.seviye === 'uyari' && m.siddet === 'uyari' && m.meta.eskiKod === 'TEV_NAKL_EKSIK', 'TEV_NAKL_EKSIK (hata) → TEVKIFAT_EKSIK (uyarı)');
    assert(uk.eskiUyariyiHaritala(eski[1]).kod === 'KKEG_SUPHESI', 'INDIRME_BINEK → KKEG_SUPHESI');
    const birlesik = uk.uyarilariBirlestir(eski, [uk.uyariYap({ kod: 'MUKERRER', seviye: 'engel', baslik: 'M', aciklama: 'm', kaynak: 'dogrulama' }), uk.uyariYap({ kod: 'TEVKIFAT_EKSIK', seviye: 'uyari', baslik: 'Yeni', aciklama: 'yeni', kaynak: 'dogrulama' })]);
    const k = kodlar(birlesik);
    assert(k[0] === 'MUKERRER', 'sıra: engel önce');
    assert(!k.includes('DEMIRBAS'), 'eski kaynak=dogrulama kaydı atıldı (yeniden üretilir)');
    assert(k.includes('HAFIZA_CELISKI') && k.includes('KKEG_SUPHESI'), 'taban denetim kayıtları korunur');
    assert(birlesik.find((u) => u.kod === 'TEVKIFAT_EKSIK').baslik === 'Yeni', 'aynı kodda türetilen kazanır');
    const dv = uk.dogrulamaUyarilari([{ code: 'TOTAL_MISMATCH_UBL', severity: 'WARNING', message: 'a' }, { code: 'KDV_MATH_MISMATCH', severity: 'ERROR', message: 'b' }, { code: 'OWNERSHIP_MISMATCH', severity: 'ERROR', message: 'c' }, { code: 'FIXED_ASSET_MANUAL', severity: 'WARNING', message: 'd' }]);
    const tt = dv.find((u) => u.kod === 'TUTAR_TUTARSIZ');
    assert(tt && tt.seviye === 'engel' && /a · b/.test(tt.aciklama) && dv.some((u) => u.kod === 'SAHIPLIK_TERS') && !dv.some((u) => u.kod === 'DEMIRBAS'), 'dogrulamaUyarilari: TUTAR_TUTARSIZ birleşik (en yüksek seviye), SAHIPLIK_TERS, FIXED_ASSET_MANUAL burada üretilmez');
  }

  console.log('10) A.1 eLogo liste durumu — öğe bloğu (komşuya taşmaz) + stateExplanation önceliği');
  {
    const { svc } = makeService({ docs: [], taxpayer: TP });
    const item = (uuid, code, expl) => `<a:DOCUMENT><a:documentUuid>${uuid}</a:documentUuid><a:documentId>F${uuid.slice(0, 3)}</a:documentId><a:stateCode>${code}</a:stateCode><a:stateExplanation>${expl}</a:stateExplanation><a:envelopeStatus>OK</a:envelopeStatus></a:DOCUMENT>`;
    // 4 öğe: 3. öğe İPTAL. Öğeler kısa (±1500 pencere hepsini kapsar) → eski kod 2. ve 4. öğeyi de "iptal" görürdü.
    const resp = `<s:Envelope><s:Body><GetDocumentListResponse><GetDocumentListResult><a:documentList>${item('aaaa-1', '1', 'Onaylandı')}${item('bbbb-2', '2', 'Kabul Edildi')}${item('cccc-3', '9', 'İptal Edildi')}${item('dddd-4', '1', 'Onaylandı')}</a:documentList></GetDocumentListResult></GetDocumentListResponse></s:Body></s:Envelope>`;
    const m = svc.elogoStatusMapFromList(resp);
    assert(m.get('cccc-3') && /ptal/.test(m.get('cccc-3').approval), '3. öğe iptal → yalnız o uuid iptal');
    assert(m.get('bbbb-2') && m.get('bbbb-2').approval === 'Kabul Edildi' && m.get('dddd-4') && m.get('dddd-4').approval === 'Onaylandı' && m.get('aaaa-1').approval === 'Onaylandı', 'komşu öğeler (2. ve 4.) KENDİ durumunu taşır (pencere taşması yok)');
    assert(m.get('cccc-3').approval === 'İptal Edildi', 'stateExplanation metni stateCode\'a tercih edilir');
    // öğe etiketi yoksa: uuid'ler arası dilim
    const resp2 = `<x><documentUuid>u1</documentUuid><stateCode>1</stateCode><documentUuid>u2</documentUuid><stateCode>9</stateCode><stateExplanation>İptal</stateExplanation></x>`;
    const m2 = svc.elogoStatusMapFromList(resp2);
    assert(m2.get('u1').approval === '1' && m2.get('u2').approval === 'İptal', 'öğe etiketi yoksa uuid→sonraki uuid dilimi kullanılır');
    assert(svc.belgeDurumuEngelli({ approvalStatus: m.get('cccc-3').approval, iptalItiraz: 'Yok' }).engelli && !svc.belgeDurumuEngelli({ approvalStatus: m.get('bbbb-2').approval, iptalItiraz: 'Yok' }).engelli, 'harita → belgeDurumuEngelli: iptal engelli, kabul serbest');
  }

  console.log('11) A.3 iptal/red kalıpları — sınırlı + "talebi reddedildi" istisnası');
  {
    const { svc } = makeService({ docs: [], taxpayer: TP });
    const e = (approvalStatus, iptalItiraz = 'Yok') => svc.belgeDurumuEngelli({ approvalStatus, iptalItiraz });
    assert(!e('İptal Talebi Reddedildi').engelli, '"İptal Talebi Reddedildi" → talep reddedilmiş, belge GEÇERLİ (engelli değil)');
    assert(!e('Red Talebi Reddedildi').engelli && !e('Onaylandı', 'İtiraz Talebi Reddedildi').engelli, '"Red/İtiraz Talebi Reddedildi" → engelli değil');
    assert(e('İptal Talebi Kabul Edildi').engelli && e('Red Talebi Kabul Edildi').engelli, '"İptal/Red Talebi Kabul Edildi" → engelli');
    assert(!e('Kredi Kartı ile Ödendi').engelli && !e('Onaylandı (Redirect)').engelli, 'geniş "red" kalıbı yok: "Kredi" / "Redirect" engelli DEĞİL');
    assert(e('Reddedildi').engelli && e('Rejected').engelli && e('Cancelled').engelli && e('Canceled').engelli && e('İptal Edildi').engelli, 'Reddedildi / Rejected / Cancel(l)ed / İptal Edildi → engelli');
    assert(e('Onaylandı', 'İtiraz Edildi').engelli && e('Onaylandı', '1').engelli && !e('Onaylandı', 'Hayır').engelli, 'iptalItiraz: "İtiraz Edildi"/"1" engelli; "Hayır" serbest');
    assert(e('Taslak').neden === 'taslak' && e('GİB Tarafında Hata').neden === 'gib-hata', 'taslak / GİB hata nedenleri korunur');
  }

  console.log('12) A.2 MÜKERRER — kısa belge no + tarih, yer tutucu, sahip kararı');
  {
    // kısa fiş no: aynı gün → mükerrer; farklı gün → değil
    const fis = (over = {}) => doc({ belgeNo: '0049', documentType: 'OKC_FIS', totalAmount: 240, ocrData: { matrah: 200, kdvTutari: 40, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 200, tutar: 40 }], kalemler: [{ ad: 'Yemek', tutar: 200, oran: 20 }], giderTuru: 'yemek', matrahKategori: 'genel_gider' },
      lines: [{ group: 'matrah', accountCode: '770.01.001', debit: 200, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 40, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '100.01.001', debit: 0, credit: 240 }], ...over });
    const ayniGun = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-08-05T09:00:00Z') }), fis({ id: 'd1', faturaTarihi: new Date('2026-08-05T18:30:00Z') })], taxpayer: TP });
    const v1 = await ayniGun.svc.revalidateDocument('t', 'd1');
    assert(v1.issues.some((i) => i.code === 'MUKERRER'), 'kısa no "0049" + aynı VKN/tutar + AYNI GÜN → mükerrer');
    const farkliGun = makeService({ docs: [fis({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-08-04T09:00:00Z') }), fis({ id: 'd1', faturaTarihi: new Date('2026-08-05T18:30:00Z') })], taxpayer: TP });
    const v2 = await farkliGun.svc.revalidateDocument('t', 'd1');
    assert(!v2.issues.some((i) => i.code === 'MUKERRER'), 'kısa no "0049" ama FARKLI GÜN → mükerrer DEĞİL (fiş no tekrar eder)');
    // uzun numarada tarih şartı yok (mevcut kural)
    const uzun = makeService({ docs: [doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z'), faturaTarihi: new Date('2026-08-01T00:00:00Z') }), doc({ id: 'd1' })], taxpayer: TP });
    assert((await uzun.svc.revalidateDocument('t', 'd1')).issues.some((i) => i.code === 'MUKERRER'), 'uzun belge no (13 rakam) → tarih farklı olsa da mükerrer (mevcut kural)');
    // yer tutucu belge no
    for (const bn of ['BILINMIYOR', '', '-', '22222222-2222-2222-2222-222222222222']) {
      const s = makeService({ docs: [doc({ id: 'd0', belgeNo: bn, createdAt: new Date('2026-07-30T10:00:00Z') }), doc({ id: 'd1', belgeNo: bn })], taxpayer: TP });
      const v = await s.svc.revalidateDocument('t', 'd1');
      assert(!v.issues.some((i) => i.code === 'MUKERRER'), `yer tutucu belge no "${bn || '(boş)'}" → mükerrer aranmaz`);
    }
    // sahip kararı: mukerrer_degil → uyarı yok + duplicateOfId temizlenir
    const kararli = makeService({ docs: [doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z') }), doc({ id: 'd1', duplicateOfId: 'd0', duplicateSeverity: 'BLOCKING', ocrData: { ...doc().ocrData, mukerrerKarar: { karar: 'mukerrer_degil', not: 'farklı teslimat' } } })], taxpayer: TP });
    const vk = await kararli.svc.revalidateDocument('t', 'd1');
    assert(!vk.issues.some((i) => i.code === 'MUKERRER') && !kodlar(uyOf(kararli.state)).includes('MUKERRER'), 'mukerrerKarar=mukerrer_degil → MUKERRER üretilmez');
    assert(kararli.state.updates.some((u) => u.id === 'd1' && u.data.duplicateOfId === null && u.data.duplicateSeverity === null), 'mukerrer_degil → duplicateOfId/duplicateSeverity TEMİZLENDİ');
    // uyarıda "Mükerrer değil" eylemi
    const m2 = makeService({ docs: [doc({ id: 'd0', createdAt: new Date('2026-07-30T10:00:00Z') }), doc({ id: 'd1' })], taxpayer: TP });
    await m2.svc.revalidateDocument('t', 'd1');
    const um = uyOf(m2.state).find((u) => u.kod === 'MUKERRER');
    assert(um && um.eylemler.some((e) => e.id === 'mukerrer:mukerrer_degil'), 'MUKERRER uyarısında "Mükerrer değil" eylemi');
    // mukerrerKarari ucu (mock)
    const r = await m2.svc.mukerrerKarari('t', 'd1', { karar: 'mukerrer_degil', not: 'x' }, 'u');
    assert(r.ok && r.karar === 'mukerrer_degil' && !kodlar(uyOf(m2.state)).includes('MUKERRER'), 'mukerrerKarari(mukerrer_degil) → kayıt + yeniden doğrulama, uyarı kalktı');
    let bad = null; try { await m2.svc.mukerrerKarari('t', 'd1', { karar: 'x' }); } catch (e) { bad = e; }
    assert(bad && /mukerrer_degil/.test(String(bad.message)), 'geçersiz karar reddedilir');
  }

  console.log('13) B.2 / B.4 / B.5 / B.13 — tevkifat kural tablosu');
  {
    const base = { invoiceKind: 'ALIS', giderTuru: 'nakliye hizmeti', matrahKategori: 'genel_gider', kalemler: ['İstanbul-Ankara nakliye'], kdvDahilTutar: 24000, yil: 2026, tevkifatVar: false, aliciKurumTuru: null, env: {} };
    assert(tk.tevkifatEksikDegerlendir({ ...base, kdvTutari: 0 }) === null, 'B.2: hesaplanan KDV = 0 (istisna/KDV\'siz) → tevkifat uygulanmaz');
    assert(tk.tevkifatEksikDegerlendir({ ...base, isReturn: true }) === null, 'B.2: iade belgesi → tevkifat uygulanmaz');
    assert(tk.tevkifatEksikDegerlendir({ ...base, saticiKdvMukellefi: false }) === null, 'B.2: satıcı KDV mükellefi değil → tevkifat yok');
    assert(tk.tevkifatEksikDegerlendir({ ...base, kdvTutari: 4000 }) && tk.tevkifatEksikDegerlendir({ ...base }) , 'B.2: KDV var / bilinmiyor → kural çalışır');
    // B.4: satışta TCKN'li alıcı + kurum türü boş → bilgi + soru
    const satisTckn = tk.tevkifatEksikDegerlendir({ ...base, invoiceKind: 'SATIS', aliciKimlikNo: '12345678901' });
    assert(satisTckn && satisTckn.seviye === 'bilgi' && satisTckn.aliciKdvMukellefiSoru === true, 'B.4: SATIŞ + alıcı TCKN (11 hane) + kurum türü boş → bilgi + "KDV mükellefi mi?" sorusu');
    assert(tk.tevkifatEksikDegerlendir({ ...base, invoiceKind: 'SATIS', aliciKimlikNo: '12345678901', aliciKurumTuru: 'diger' }).seviye === 'uyari', 'B.4: alıcı "diger (normal KDV mükellefi)" seçildi → uyarı');
    assert(tk.tevkifatEksikDegerlendir({ ...base, invoiceKind: 'SATIS', aliciKimlikNo: '12345678901', aliciKurumTuru: 'kdv_mukellefi_degil' }) === null, 'B.4: alıcı "kdv_mukellefi_degil" → tevkifat yok');
    assert(tk.tevkifatEksikDegerlendir({ ...base, invoiceKind: 'SATIS', aliciKimlikNo: '1234567890' }).seviye === 'uyari', 'B.4: VKN\'li (10 hane) alıcı → normal uyarı');
    // B.3: belirlenmis_diger belirlenmiş alıcıdır
    assert(tk.belirlenmisAliciMi('belirlenmis_diger') === true && tk.belirlenmisAliciMi('kdv_mukellefi_degil') === false && tk.KURUM_TURLERI.includes('belirlenmis_diger'), 'B.3: belirlenmis_diger → belirlenmiş alıcı; kdv_mukellefi_degil → değil');
    const bakim = { ...base, giderTuru: 'jeneratör bakım onarım hizmeti', kalemler: ['Jeneratör periyodik bakım'] };
    assert(tk.tevkifatEksikDegerlendir({ ...bakim, aliciKurumTuru: 'belirlenmis_diger' }).tip === 'TEVKIFAT_EKSIK', 'B.3: bakım-onarım (203) + alıcı belirlenmis_diger → TEVKIFAT_EKSIK');
    // B.5: 216 diğer hizmetler — kural eşleşmedi + hizmet kategorisi + alıcı 216 kapsamında → bilgi
    const egitim = { ...base, giderTuru: 'kurumsal eğitim hizmeti', kalemler: ['Personel eğitimi'] };
    const r216 = tk.tevkifatEksikDegerlendir({ ...egitim, aliciKurumTuru: 'belediye' });
    assert(r216 && r216.kural.kod === '216' && r216.seviye === 'bilgi' && r216.digerHizmet216 === true, 'B.5: eğitim hizmeti (kural yok) + alıcı belediye + eşik üstü → 216 BİLGİ');
    assert(tk.tevkifatEksikDegerlendir({ ...egitim, aliciKurumTuru: 'diger' }) === null && tk.tevkifatEksikDegerlendir({ ...egitim, aliciKurumTuru: null }) === null, 'B.5: alıcı normal mükellef / bilinmiyor → 216 üretilmez');
    assert(tk.tevkifatEksikDegerlendir({ ...egitim, aliciKurumTuru: 'kamu', matrahKategori: 'ticari_mal', giderTuru: 'kırtasiye malzemesi' }) === null, 'B.5: mal kategorisi → 216 üretilmez');
    // B.13: kelime taşması
    const t203 = tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'araç kasa tadilatı', kalemler: ['Kamyon damper kasa tadilat işçiliği'], aliciKurumTuru: 'kamu' });
    assert(t203 && t203.kural.kod === '203', 'B.13: "araç kasa tadilatı" → 203 (taşıt tadil-bakım), 201 yapım işi DEĞİL');
    assert(tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'pamuk ipliği alımı', matrahKategori: 'hammadde', kalemler: ['Pamuk ipliği Ne 30/1'] }) === null, 'B.13: "pamuk ipliği" → 222 (ham pamuk) eşleşmez');
    assert(tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'ham pamuk alımı', matrahKategori: 'hammadde', kalemler: ['Kütlü pamuk'] }).kural.kod === '222', 'B.13: "ham pamuk / kütlü pamuk" → 222');
    assert(tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'külçe altın alımı', matrahKategori: 'ticari_mal', kalemler: ['24 ayar külçe altın'] }) === null, 'B.13: "külçe altın" → 217/218 eşleşmez (kıymetli maden)');
    assert(tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'plastik hammadde alımı', matrahKategori: 'hammadde', kalemler: ['Orijinal PP granül'] }) === null && tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'geri dönüşüm granül alımı', matrahKategori: 'hammadde', kalemler: ['Geri kazanım PP granül'] }).kural.kod === '221', 'B.13: orijinal granül → yok; geri dönüşüm granülü → 221');
    assert(tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'ihtiyat akçesi danışmanlığı', kalemler: ['etütsüz'] }) && tk.tevkifatEksikDegerlendir({ ...base, giderTuru: 'ihtiyat akçesi danışmanlığı', kalemler: ['etütsüz'] }).kural.kod === '202', 'B.13: kelime BAŞI sınırı — "danismanlik" eşleşir');
    // Tebliğ atıfları / 226 kapsamı
    const kodMadde = (k) => tk.TEVKIFAT_KURALLARI.find((r) => r.kod === k).madde;
    assert(kodMadde('208') === 'KDVGUT I/C-2.1.3.2.6' && kodMadde('224') === 'KDVGUT I/C-2.1.3.2.11' && kodMadde('225') === 'KDVGUT I/C-2.1.3.2.15', 'B.11: 208 → 2.1.3.2.6, 224 → 2.1.3.2.11, 225 → 2.1.3.2.15');
    assert(/Devlet Malzeme Ofisi/.test(tk.TEVKIFAT_KURALLARI.find((r) => r.kod === '226').ad), 'B.12: 226 kapsamı yalnız DMO');
  }

  console.log('14) B.1 / A.10 — birleştirme + imza');
  {
    const tabanEski = [{ kod: 'TEV_NAKL_EKSIK', baslik: 'Tevkifat eksik', mesaj: 'nakliye…', siddet: 'hata' }, { kod: 'HAFIZA_CELISKI', baslik: 'x', mesaj: 'x', siddet: 'uyari' }];
    const alici = uk.uyariYap({ kod: 'ALICI_TIPI_GEREKLI', seviye: 'bilgi', baslik: 'A', aciklama: 'a', kaynak: 'dogrulama' });
    const k1 = kodlar(uk.uyarilariBirlestir(tabanEski, [alici]));
    assert(k1.includes('ALICI_TIPI_GEREKLI') && !k1.includes('TEVKIFAT_EKSIK') && k1.includes('HAFIZA_CELISKI'), 'B.1: türetilen ALICI_TIPI_GEREKLI varken taban TEVKIFAT_EKSIK ATILIR (birlikte çıkmaz)');
    const k2 = kodlar(uk.uyarilariBirlestir(tabanEski, [], { tamDogrulama: true }));
    assert(!k2.includes('TEVKIFAT_EKSIK') && k2.includes('HAFIZA_CELISKI'), 'B.1: tam doğrulama (yeni tablo karar verdi, sonuç yok) → taban TEVKIFAT_EKSIK atılır');
    const k3 = kodlar(uk.uyarilariBirlestir(tabanEski, []));
    assert(k3.includes('TEVKIFAT_EKSIK'), 'B.1: kısmi birleştirme (rematch) + türetilende tevkifat kararı yok → taban TEVKIFAT_EKSIK kalır (geçiş)');
    // canlı: rematch'in yazdığı TEV_*_EKSIK + revalidate (kurumTuru=diger → kapsam dışı) → bayat TEVKIFAT_EKSIK kalmaz
    const bakimDoc2 = doc({ ocrData: { matrah: 20000, kdvTutari: 4000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 20000, tutar: 4000 }], kalemler: [{ ad: 'Jeneratör periyodik bakım hizmeti', tutar: 20000, oran: 20 }], giderTuru: 'jeneratör bakım onarım hizmeti', matrahKategori: 'genel_gider', uyarilar: [{ kod: 'TEV_MAK_EKSIK', baslik: 'Tevkifat eksik', mesaj: 'eski kural', siddet: 'hata' }] }, totalAmount: 24000,
      lines: [{ group: 'matrah', accountCode: '740.01.001', debit: 20000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 4000, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.002', debit: 0, credit: 24000 }] });
    const { svc, state } = makeService({ docs: [bakimDoc2], taxpayer: { ...TP, kurumTuru: 'diger' } });
    await svc.revalidateDocument('t', 'd1');
    assert(!kodlar(uyOf(state)).includes('TEVKIFAT_EKSIK'), 'B.1 canlı: kurumTuru=diger → eski TEV_MAK_EKSIK tabanı da kalkar');
    // A.10 imza
    const a = [{ kod: 'X', seviye: 'uyari', baslik: 'b', aciklama: 'a', mesaj: 'a', siddet: 'uyari', meta: { p: 1, q: 2 } }];
    const b = [{ meta: { q: 2, p: 1 }, siddet: 'uyari', mesaj: 'a', aciklama: 'a', baslik: 'b', seviye: 'uyari', kod: 'X' }];
    assert(uk.uyariImza(a) === uk.uyariImza(b), 'A.10: alan sırası farklı aynı içerik → imza eşit');
    assert(uk.uyariImza(a) !== uk.uyariImza([{ ...a[0], seviye: 'engel', siddet: 'hata' }]), 'A.10: seviye değişince imza değişir');
    // A.10 canlı: aynı belge iki kez doğrulanınca ikinci turda uyarilar UPDATE'i olmaz
    const { svc: s2, state: st2 } = makeService({ docs: [doc()], taxpayer: TP });
    await s2.revalidateDocument('t', 'd1');
    const n1 = st2.updates.filter((u) => u.data && u.data.ocrData && u.data.ocrData.uyarilar).length;
    await s2.revalidateDocument('t', 'd1');
    const n2 = st2.updates.filter((u) => u.data && u.data.ocrData && u.data.ocrData.uyarilar).length;
    assert(n1 === 1 && n2 === 1, `A.10 canlı: ikinci doğrulamada gereksiz uyarı UPDATE yok (${n1}→${n2})`);
  }

  console.log('15) B.6 / B.7 / A.11 — satışta yine_de_isle fiş eksik, binek, TEVKIFAT_NEEDED kutusu');
  {
    const satisBase = { invoiceKind: 'SATIS', totalAmount: 1080000, buyerVkn: '5555555555', customerName: 'ALICI LTD', ocrData: { matrah: 900000, kdvTutari: 180000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 900000, tutar: 180000 }], kalemler: [{ ad: '34 ABC 123 plakalı kamyon satış bedeli', tutar: 900000, oran: 20 }], giderTuru: 'kamyon satışı', matrahKategori: 'demirbas', demirbasKarar: { karar: 'yine_de_isle' } } };
    const eksik = doc({ ...satisBase, lines: [{ group: 'matrah', accountCode: '679.01.001', debit: 0, credit: 900000 }, { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 180000, rate: '%20' }, { group: 'cari', accountCode: '120.01.001', debit: 1080000, credit: 0 }] });
    const { svc, state } = makeService({ docs: [eksik], taxpayer: TP });
    const v = await svc.revalidateDocument('t', 'd1');
    assert(v.issues.some((i) => i.code === 'FIXED_ASSET_SALE_INCOMPLETE' && i.severity === 'ERROR') && v.status === 'INVALID', 'B.6: satış + yine_de_isle + 25x/257 yok → FIXED_ASSET_SALE_INCOMPLETE ERROR (INVALID)');
    const dem = uyOf(state).find((u) => u.kod === 'DEMIRBAS');
    assert(dem && dem.seviye === 'engel' && dem.meta.satisFisEksik === true && dem.eylemler.some((e) => e.id === 'demirbas:elle_islendi'), 'B.6: DEMIRBAS uyarısı engel + "Luca\'da elle işledim → kapat" yolu');
    assert(!kodlar(uyOf(state)).includes('FIXED_ASSET_SALE_INCOMPLETE'), 'FIXED_ASSET_SALE_INCOMPLETE ayrı uyarı olarak üretilmez (DEMIRBAS içinde)');
    // tam fiş: 254 alacak 1.000.000 / 257 borç 400.000 / 679 alacak 300.000 / 391 alacak 180.000 / 120 borç 1.080.000 → dengeli; cari = belge toplamı
    const tam = doc({ ...satisBase, lines: [{ group: 'matrah', accountCode: '254.01.001', debit: 0, credit: 1000000 }, { group: 'matrah', accountCode: '257.01.001', debit: 400000, credit: 0 }, { group: 'matrah', accountCode: '679.01.001', debit: 0, credit: 300000 }, { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 180000, rate: '%20' }, { group: 'cari', accountCode: '120.01.001', debit: 1080000, credit: 0 }] });
    const t2 = makeService({ docs: [tam], taxpayer: TP });
    const v2 = await t2.svc.revalidateDocument('t', 'd1');
    assert(!v2.issues.some((i) => i.code === 'FIXED_ASSET_SALE_INCOMPLETE') && !v2.issues.some((i) => i.code === 'TOTAL_MISMATCH'), `B.6: 25x + 257 eklenmiş dengeli fiş → eksik yok, TOTAL_MISMATCH yok (${v2.issues.map((i) => i.code).join(',') || 'temiz'})`);
    // B.7 binek sinyali
    assert(svc.binekOtomobilSinyali({ kalemler: [{ ad: 'FIAT EGEA 1.4 FIRE SEDAN' }], giderTuru: 'otomobil alımı' }, 'otomobil') === true, 'B.7: Egea sedan → binek');
    assert(svc.binekOtomobilSinyali({ kalemler: [{ ad: 'Ford Transit kamyonet' }], giderTuru: 'kamyonet alımı' }, 'kamyonet') === false, 'B.7: kamyonet → binek değil');
    assert(svc.detectFixedAsset({ kalemler: [{ ad: 'FIAT EGEA 1.4 FIRE', tutar: 900000 }] }, TP, 'ALIS').is === true, 'B.7: detectFixedAsset "egea" işareti');
    const binekDoc = doc({ totalAmount: 1080000, ocrData: { matrah: 900000, kdvTutari: 180000, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 900000, tutar: 180000 }], kalemler: [{ ad: 'FIAT EGEA 1.4 binek otomobil', tutar: 900000, oran: 20 }], giderTuru: 'binek otomobil alımı', matrahKategori: 'demirbas' },
      lines: [{ group: 'matrah', accountCode: '254.01.001', debit: 900000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 180000, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.001', debit: 0, credit: 1080000 }] });
    const b = makeService({ docs: [binekDoc], taxpayer: TP });
    await b.svc.revalidateDocument('t', 'd1');
    const demB = uyOf(b.state).find((u) => u.kod === 'DEMIRBAS');
    assert(demB && demB.meta.binek === true && /30\/b/.test(demB.aciklama), 'B.7: DEMIRBAS uyarısı binek işareti + KDVK 30/b notu');
    // A.11: kelime+aritmetik tevkifat (gerçek veri yok) → TEVKIFAT_VAR engel + "Tevkifat fişini kur"
    const hintDoc = doc({ belgeNo: 'HNT2026000000001', totalAmount: 23600, ocrData: { matrah: 20000, kdvTutari: 3600, kdvOrani: 20, kdvBreakdown: [{ oran: 20, matrah: 20000, tutar: 3600 }], kalemler: [{ ad: 'Temizlik hizmeti', tutar: 20000, oran: 20 }], giderTuru: 'temizlik hizmeti', matrahKategori: 'genel_gider', tevkifatHint: true },
      lines: [{ group: 'matrah', accountCode: '770.01.001', debit: 20000, credit: 0, rate: '%20' }, { group: 'vergi', accountCode: '191.01.020', debit: 3600, credit: 0, rate: '%20' }, { group: 'cari', accountCode: '320.01.002', debit: 0, credit: 23600 }] });
    const h = makeService({ docs: [hintDoc], taxpayer: TP });
    const vh = await h.svc.revalidateDocument('t', 'd1');
    const tv = uyOf(h.state).find((u) => u.kod === 'TEVKIFAT_VAR');
    assert(vh.issues.some((i) => i.code === 'TEVKIFAT_NEEDED') && tv && tv.seviye === 'engel' && tv.eylemler.some((e) => e.id === 'tevkifat-fisi-kur'), 'A.11: "tevkifat" ibaresi + KDV tam değil (3.600 ≠ 4.000) → TEVKIFAT_VAR engel + "Tevkifat fişini kur"');
  }

  console.log('9) Kaynak metin kilitleri');
  {
    const svcSrc = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
    assert(svcSrc.includes("reason: 'demirbas-karar-bekliyor'") && svcSrc.includes("reason: 'mukerrer'"), 'approveBatch demirbaş/mükerrer atlama');
    assert(svcSrc.includes('skippedDemirbas') && svcSrc.includes('uyariOzet(d.ocrData?.uyarilar).kararBekliyor'), 'batchPostToLuca / buildBatchExcel karar bekleyen belgeyi eler');
    assert(svcSrc.includes("lucaStatus: 'MANUAL_DONE'"), 'elle_islendi → MANUAL_DONE');
    assert(svcSrc.includes("kararTipi: 'demirbas_degil'"), 'demirbas_degil → VendorMemory notu');
    assert(svcSrc.includes("mode === 'iptal-temizle'"), 'reprocess-broken iptal-temizle modu');
    const ctl = fs.readFileSync(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts'), 'utf8');
    assert(ctl.includes("@Post('documents/:id/demirbas-karari')") && ctl.includes("@Post('alici-tipi')") && ctl.includes("@Get('documents/iptal-sayac')") && ctl.includes("@Post('documents/:id/uyari-eylem')"), 'yeni uçlar: demirbas-karari, alici-tipi, iptal-sayac, uyari-eylem');
    assert(ctl.indexOf("@Get('documents/iptal-sayac')") < ctl.indexOf("@Get('documents/:id')"), 'iptal-sayac ucu documents/:id\'den ÖNCE (Nest rota sırası)');
    // Denetim uygulaması: A.2 mukerrer-karari, A.6 revalidate-pending (owner), A.5 elle işlendi reddi, A.7 revalidate, A.3 durum sayımı
    assert(ctl.includes("@Post('documents/:id/mukerrer-karari')") && ctl.includes("@Post('documents/revalidate-pending')"), 'A.2/A.6 uçları: mukerrer-karari, revalidate-pending');
    assert(ctl.indexOf("@Post('documents/revalidate-pending')") < ctl.indexOf("@Get('documents/:id')") && /revalidate-pending'\)\s*\n\s*@UseGuards\(OwnerOnlyGuard\)/.test(ctl), 'revalidate-pending owner korumalı + documents/:id\'den önce');
    assert(svcSrc.includes('skippedElleIslendi') && svcSrc.includes('elle işlendi" olarak kapatılmış'), 'A.5: batchPostToLuca skippedElleIslendi + retryLucaPost MANUAL_DONE/elle_islendi reddi');
    assert(/delete ocrYeni\.demirbasKarar/.test(svcSrc), 'A.5: reopen demirbasKarar siler');
    assert(/A\.7 — sınıflandırma \+ eşleştirme sonrası uyarılar tazelensin[\s\S]{0,400}await this\.revalidateDocument\(tenantId, doc\.id\)/.test(svcSrc), 'A.7: runQueuedClassify sonunda revalidateDocument');
    assert(/const guncel = await \(this\.prisma as any\)\.invoiceAccountingDocument\.findFirst\(\{ where: \{ id: doc\.id, tenantId \}, select: \{ ocrData: true \} \}\)/.test(svcSrc), 'A.8: sınıflandırma yazmadan önce güncel ocrData yeniden okunur');
    assert(svcSrc.includes('durumSayim: { approvalStatus: approvalStatusSayim'), 'A.3: iptal-temizle dryRun ayrık approvalStatus sayımı');
    assert(svcSrc.includes("Demirbaş kararı bekliyor — bu belge onaylanamaz") && svcSrc.includes("/Demirbaş kararı bekliyor/i.test(msg) ? 'demirbas-karar-bekliyor'"), 'A.6: tekil onay demirbaş kararı BadRequest + approveBatch sebep eşlemesi');
    assert(svcSrc.includes("ilgiliKodlar.includes(String(u?.kod || ''))"), 'A.9: setAliciTipi yalnız ALICI_TIPI_GEREKLI/TEVKIFAT_EKSIK uyarılı belgeleri doğrular');
    const page = fs.readFileSync(path.join(ROOT, 'apps/web/src/app/fatura-merkezi/page.tsx'), 'utf8');
    assert(page.includes("e.id.startsWith('mukerrer:')") && page.includes("value: 'belirlenmis_diger'") && page.includes("value: 'kdv_mukellefi_degil'") && page.includes('d.skippedDemirbas') && page.includes('belge demirbaş kararı bekliyor (gönderilmez)'), 'page.tsx: Mükerrer değil düğmesi, yeni kurum türleri, skippedDemirbas toast + Aktarım kartı');
    assert(page.includes('function UyariKutusu') && page.includes('function UyariCipler') && page.includes("l: 'Karar bekliyor'") && page.includes("v: 'mukerrer'"), 'page.tsx: UyariKutusu, UyariCipler, Karar bekliyor kartı, Mükerrer kartı');
    assert(page.includes('docTevkifatliFE(d)') && page.includes('Tevkifatlı {tevkGrup.length} belgeyi onayla'), 'page.tsx: tevkifatlı ayrı onay grubu');
    assert(page.includes("demirbas-karar-bekliyor") && page.includes("'ilk-belgeyi-ac'") && page.includes("'alici-tipi-sec'"), 'page.tsx: eylemler (demirbaş, ilk belge, alıcı tipi)');
    const schema = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
    assert((schema.match(/kurumTuru\s+String\?/g) || []).length === 2, 'schema.prisma: Taxpayer + VendorMemory kurumTuru String? (nullable)');
    assert(fs.existsSync(path.join(ROOT, 'apps/api/prisma/migrations/20260912_kurum_turu/migration.sql')), 'migration 20260912_kurum_turu var');
  }

  if (failed) { console.error(`\n[uyari-katmani-regression] ${failed} kontrol BAŞARISIZ`); process.exit(1); }
  console.log('\nOK uyari-katmani-regression');
})().catch((e) => { console.error('[uyari-katmani-regression] beklenmeyen hata:', e && e.stack || e); process.exit(1); });
