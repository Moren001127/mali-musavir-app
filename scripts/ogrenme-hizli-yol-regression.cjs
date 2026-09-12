#!/usr/bin/env node
/**
 * ÖĞRENME HIZLI YOLU regresyonu — GÖREV B (2026-09-13): sahip onayıyla öğrenilmiş satıcı+içerik kararı → Max ÇAĞRILMADAN
 *   sınıflandırma + hesap. apps/api/src/fatura-muhasebelestirme/ogrenme-hizli-yol.ts (SAF modül) + service kaynak kilitleri.
 *
 * Kilitler:
 *   1) (a) HAFIZA: aynı mükellef + VKN + imza eşleşmesi → kod (planda kaydedilebilir yaprak); eşik onayAdedi ≥ 2; tek onay YOK;
 *      imza+oran > imza; imzaZorunlu=true'da imzasız genel/oran kararı KABUL EDİLMEZ; imzaZorunlu=false'ta oran → genel yedekler.
 *   2) (b) HAFIZA_AD: kod planda yok, ad var → aynı adlı TEK yaprak; oran etiketi (%20) korunur; aynı adda iki yaprak → belirsiz → null.
 *   3) (c) mükellefler arası: başka mükellefte imza eşleşen kararlar toplam ≥ 2 ve tek (baskın) ad → HAFIZA_AD guven orta;
 *      rakip ad varsa null; işletme kararı dışlanır; toplam < 2 → null.
 *   4) (d) mevzuat: alışta 6xx, satışta 7xx/15x/25x, demirbaşta 25x-dışı → null (AI yoluna düşer).
 *   5) plan dışı kod / grup kodu / noktasız ana hesap seçilmez; işletme defteri dışarıda; geçersiz VKN null.
 *   6) Kaynak kilitleri: runQueuedClassify'da ogrenilmisHizliYol AI'dan (aiClassifyAccounting) ÖNCE, [CLS-SKIP-LEARNED] logu,
 *      ocrData.ogrenmeKaynak yazımı; aiReadDocument aynı saf yola bağlı; rematch HAFIZA_AD'ı HAFIZA gibi uygular;
 *      recordInvoiceAccountingMemory hesapAdi+defterTuru yazar; API anahtarı yok.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

function loadTs(rel) {
  const file = path.join(root, rel);
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, console }, { filename: file });
  return mod.exports;
}

const hy = loadTs('apps/api/src/fatura-muhasebelestirme/ogrenme-hizli-yol.ts');
const { ogrenilmisKararSec, adCozumAdaylari, hesapAdiNormalize, mevzuatUygunMu, planYaprakHaritasi, adlaYaprakBul, kodKategori } = hy;

const h = (code, name) => ({ code, name });
const PLAN = [
  h('1', 'DÖNEN VARLIKLAR'), h('153', 'TİCARİ MALLAR'), h('153.01', 'TİCARİ MALLAR'), h('153.01.001', 'TİCARİ MALLAR %20'), h('153.01.002', 'TİCARİ MALLAR %10'),
  h('191', 'İNDİRİLECEK KDV'), h('191.01.001', 'İNDİRİLECEK KDV %20'),
  h('255', 'DEMİRBAŞLAR'), h('255.01.001', 'BÜRO DEMİRBAŞLARI'),
  h('320.01.001', 'SATICI X'),
  h('600', 'YURTİÇİ SATIŞLAR'), h('600.01.001', 'YURTİÇİ SATIŞLAR %20'), h('600.01.002', 'NAKLİYE GELİRLERİ %20'),
  h('632.01.001', 'GENEL YÖNETİM GİDERLERİ YANSITMA'),
  h('770', 'GENEL YÖNETİM GİDERLERİ'), h('770.01', 'GENEL GİDERLER'), h('770.01.001', 'KİRA GİDERİ'), h('770.01.002', 'ELEKTRİK GİDERİ'),
  h('770.01.005', 'ARAÇ BAKIM ONARIM'), h('770.01.010', 'TELEFON GİDERİ %20'), h('770.02.001', 'KARGO GİDERİ'), h('770.02.002', 'KARGO GİDERİ'),
  h('77.1', 'HATALI KISA ANA SEGMENT'),
];
const TP = 'tp-A';
const VKN = '1234567890';
const IMZA = 'elektrik|enerji|tuketim';
const K = (o) => Object.assign({ taxpayerId: TP, kategori: '', altKategori: null, icerikImza: IMZA, onayAdedi: 2, hesapAdi: null, defterTuru: null }, o);
const G = (o) => Object.assign({ kararlar: [], taxpayerId: TP, vkn: VKN, icerikImza: IMZA, defterTuru: 'bilanco', yon: 'ALIS', plan: PLAN }, o);

console.log('1) Kural (a) — aynı mükellef + VKN + imza → HAFIZA');
{
  const r = ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01.002' })] }));
  assert(r && r.kod === '770.01.002' && r.kaynak === 'HAFIZA' && r.guven === 'yuksek' && r.kural === 'a', 'imza eşleşmesi + onay 2 → 770.01.002 HAFIZA yüksek');
  assert(r && r.ad === 'ELEKTRİK GİDERİ' && /2 kez onaylandı/.test(r.neden), 'ad plandan, neden onay sayısını söylüyor');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01.002', onayAdedi: 1 })] })) === null, 'tek onaylı karar UYGULANMAZ (eşik 2)');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01.002', icerikImza: 'kira|bedeli' })] })) === null, 'farklı imza → null (içerik-körü atlama yok)');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01.002', icerikImza: null })] })) === null, 'imzaZorunlu (varsayılan): imzasız genel karar KABUL EDİLMEZ');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '320.01.001', altKategori: 'CARI' })] })) === null, 'CARI kararı matrah değildir → null');
  const oranli = ogrenilmisKararSec(G({ oran: '10', kararlar: [K({ kategori: '153.01.001', altKategori: '20' }), K({ kategori: '153.01.002', altKategori: '10' })] }));
  assert(oranli && oranli.kod === '153.01.002', 'imza+oran (%10) imza-genel karardan ÖNCE');
  const sirali = ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01.001', onayAdedi: 5 }), K({ kategori: '770.01.002', onayAdedi: 2 })] }));
  assert(sirali && sirali.kod === '770.01.001', 'giriş sırası (onay ↓) korunur: en çok onaylanan kazanır');
  const rematch = ogrenilmisKararSec(G({ imzaZorunlu: false, icerikImza: 'baska|icerik', oran: '20', kararlar: [K({ kategori: '770.01.010', icerikImza: null, altKategori: '20' })] }));
  assert(rematch && rematch.kod === '770.01.010' && rematch.kaynak === 'HAFIZA', 'imzaZorunlu=false (rematch): imzasız oran kararı yedek olarak uygulanır');
  const genel = ogrenilmisKararSec(G({ imzaZorunlu: false, icerikImza: null, kararlar: [K({ kategori: '770.01.001', icerikImza: null })] }));
  assert(genel && genel.kod === '770.01.001', 'imzaZorunlu=false: tamamen genel karar (imza+oran yok) uygulanır');
  assert(ogrenilmisKararSec(G({ imzaZorunlu: false, icerikImza: null, oran: '10', kararlar: [K({ kategori: '770.01.010', icerikImza: null, altKategori: '20' })] })) === null, 'imzaZorunlu=false: başka oran için öğrenilmiş kod sessizce UYGULANMAZ (R5)');
}

console.log('2) Kural (b) — kod planda yok, ad var → HAFIZA_AD');
{
  const r = ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.099', hesapAdi: 'Elektrik Gideri' })] }));
  assert(r && r.kod === '770.01.002' && r.kaynak === 'HAFIZA_AD' && r.kural === 'b' && r.guven === 'yuksek', 'planda olmayan kod → aynı adlı yaprak (normalize: küçük/büyük harf) 770.01.002 HAFIZA_AD');
  const oranAd = ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.010', hesapAdi: 'TELEFON GİDERİ % 20' })] }));
  assert(oranAd && oranAd.kod === '770.01.010', 'oran etiketi korunur ("% 20" → "%20") → TELEFON GİDERİ %20');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.010', hesapAdi: 'TELEFON GİDERİ' })] })) === null, 'oransız ad ≠ oranlı yaprak adı → eşleşmez (yanlış oran hesabına gitmez)');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.001', hesapAdi: 'KARGO GİDERİ' })] })) === null, 'aynı adda İKİ yaprak (770.02.001/002) → belirsiz → null');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.099', hesapAdi: null })] })) === null, 'ad yoksa çözüm yok → null');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.099', hesapAdi: 'Elektrik Gideri', icerikImza: 'kira|bedeli' })] })) === null, 'ad çözümü imza eşleşmesi şart');
  const ihtiyac = adCozumAdaylari(G({ kararlar: [K({ kategori: '770.09.099' }), K({ kategori: '770.01.001' }), K({ taxpayerId: 'tp-B', kategori: '770.05.001' })] }));
  assert(ihtiyac.length === 2 && ihtiyac.some((x) => x.taxpayerId === TP && x.kod === '770.09.099') && ihtiyac.some((x) => x.taxpayerId === 'tp-B' && x.kod === '770.05.001'), 'adCozumAdaylari: planda olmayan aynı-mükellef kodu + başka mükellef kararı (plandaki kod hariç)');
}

console.log('3) Kural (c) — mükellefler arası baskın ad');
{
  const digerler = [K({ taxpayerId: 'tp-B', kategori: '770.05.001', hesapAdi: 'ELEKTRİK GİDERİ', onayAdedi: 1, defterTuru: 'bilanco' }), K({ taxpayerId: 'tp-C', kategori: '770.07.003', hesapAdi: 'Elektrik  Gideri', onayAdedi: 1, defterTuru: 'bilanco' })];
  const r = ogrenilmisKararSec(G({ kararlar: digerler }));
  assert(r && r.kod === '770.01.002' && r.kaynak === 'HAFIZA_AD' && r.kural === 'c' && r.guven === 'orta' && r.kararTaxpayerId === null, 'iki başka mükellefte 1+1=2 onay aynı ad → HAFIZA_AD guven ORTA');
  assert(r && /2 başka mükellefte 2 onayla/.test(r.neden), 'neden: mükellef sayısı + toplam onay');
  assert(ogrenilmisKararSec(G({ kararlar: [digerler[0]] })) === null, 'toplam onay 1 < 2 → null');
  const rakip = [...digerler, K({ taxpayerId: 'tp-D', kategori: '770.01.001', hesapAdi: 'KİRA GİDERİ', onayAdedi: 3, defterTuru: 'bilanco' })];
  assert(ogrenilmisKararSec(G({ kararlar: rakip })) === null, 'rakip ad varsa (baskınlık yok) → null (yanlış öğrenme yayılmaz)');
  assert(ogrenilmisKararSec(G({ kararlar: digerler.map((k) => Object.assign({}, k, { defterTuru: 'isletme' })) })) === null, 'işletme mükellefinin kararı çapraz kuralda dışlanır');
  assert(ogrenilmisKararSec(G({ defterTuru: 'isletme', kararlar: [K({ kategori: '770.01.002' })] })) === null, 'işletme defteri mükellefinde hızlı yol yok (dışarıda)');
  assert(ogrenilmisKararSec(G({ kararlar: digerler.map((k) => Object.assign({}, k, { icerikImza: 'baska|imza' })) })) === null, 'çapraz kuralda imza eşleşmesi şart');
  const tekGuclu = ogrenilmisKararSec(G({ kararlar: [K({ taxpayerId: 'tp-B', kategori: '770.05.001', hesapAdi: 'ELEKTRİK GİDERİ', onayAdedi: 4, defterTuru: 'bilanco' })] }));
  assert(tekGuclu && tekGuclu.kod === '770.01.002', 'tek başka mükellefte 4 onay da eşiği geçer');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ taxpayerId: 'tp-B', kategori: '770.05.001', hesapAdi: 'ELEKTRİK GİDERİ', onayAdedi: 4, defterTuru: 'bilanco' }), K({ kategori: '770.01.001', onayAdedi: 3 })] })).kod === '770.01.001', 'aynı mükellefin (a) kararı çapraz karardan ÖNCE');
}

console.log('4) Kural (d) — mevzuat ağı');
{
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '632.01.001' })] })) === null, 'alışta 6xx öğrenilmiş olsa da REDDEDİLİR');
  assert(ogrenilmisKararSec(G({ yon: 'SATIS', kararlar: [K({ kategori: '770.01.002' })] })) === null, 'satışta 7xx REDDEDİLİR');
  assert(ogrenilmisKararSec(G({ yon: 'SATIS', kararlar: [K({ kategori: '153.01.001' })] })) === null, 'satışta 15x REDDEDİLİR');
  const satis = ogrenilmisKararSec(G({ yon: 'SATIS', kararlar: [K({ kategori: '600.01.002' })] }));
  assert(satis && satis.kod === '600.01.002', 'satışta 600 öğrenilmiş kod uygulanır');
  assert(ogrenilmisKararSec(G({ demirbas: true, kararlar: [K({ kategori: '770.01.002' })] })) === null, 'had-üstü demirbaşta 25x-dışı REDDEDİLİR');
  const dem = ogrenilmisKararSec(G({ demirbas: true, kararlar: [K({ kategori: '255.01.001' })] }));
  assert(dem && dem.kod === '255.01.001', 'had-üstü demirbaşta 25x kabul');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.09.099', hesapAdi: 'GENEL YÖNETİM GİDERLERİ YANSITMA' })] })) === null, 'ad çözümü 6xx\'e çıkarsa da alışta REDDEDİLİR');
  assert(mevzuatUygunMu('770.01.001', 'ALIS') && !mevzuatUygunMu('600.01.001', 'ALIS') && mevzuatUygunMu('600.01.001', 'SATIS') && !mevzuatUygunMu('255.01.001', 'SATIS') && mevzuatUygunMu('255.01.001', 'ALIS', true) && !mevzuatUygunMu('770.01.001', 'ALIS', true), 'mevzuatUygunMu tablo (learnedMatrahCompatibleWithContent ile aynı)');
}

console.log('5) Plan dışı / grup / işletme / VKN');
{
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '999.01.001' })] })) === null, 'planda olmayan kod (ad da yok) → null');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770.01' })] })) === null, 'grup kodu (770.01) seçilmez');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '770' })] })) === null, 'noktasız ana hesap seçilmez');
  assert(ogrenilmisKararSec(G({ kararlar: [K({ kategori: '77.1' })] })) === null, 'ana segment <3 hane seçilmez');
  assert(ogrenilmisKararSec(G({ vkn: '123', kararlar: [K({ kategori: '770.01.002' })] })) === null, 'geçersiz VKN → null');
  assert(ogrenilmisKararSec(G({ plan: [], kararlar: [K({ kategori: '770.01.002' })] })) === null, 'plan boş → null');
  assert(ogrenilmisKararSec(G({ icerikImza: null, kararlar: [K({ kategori: '770.01.002' })] })) === null, 'belgenin imzası yok (kalemsiz) → AI atlama yolu kapalı');
  const yaprak = planYaprakHaritasi(PLAN);
  assert(yaprak.has('770.01.002') && !yaprak.has('770.01') && !yaprak.has('770') && !yaprak.has('77.1') && !yaprak.has('1'), 'planYaprakHaritasi yalnız kaydedilebilir yaprak');
  assert(hesapAdiNormalize('  ELEKTRİK   GİDERİ, (Ofis) ') === 'elektrik gideri ofis' && hesapAdiNormalize('Telefon Gideri % 20') === 'telefon gideri %20', 'hesapAdiNormalize: tr küçük harf + noktalama + %oran korunur');
  assert(adlaYaprakBul(yaprak, 'kira gideri').kod === '770.01.001' && adlaYaprakBul(yaprak, 'KARGO GİDERİ') === null, 'adlaYaprakBul tek yaprak / belirsiz');
  assert(kodKategori('153.01.001', 'ALIS') === 'ticari_mal' && kodKategori('150.01.001', 'ALIS') === 'hammadde' && kodKategori('255.01.001', 'ALIS') === 'demirbas' && kodKategori('760.01.001', 'ALIS') === 'pazarlama' && kodKategori('770.01.001', 'ALIS') === 'genel_gider' && kodKategori('600.01.001', 'SATIS') === '', 'kodKategori: kod öneki → matrahKategori (satışta boş)');
}

console.log('6) Kaynak kilitleri (service)');
{
  const SRC = path.join(root, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts');
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const fnBody = (name, len = 60000) => { const i = src.indexOf(name); return i >= 0 ? src.slice(i, i + len) : ''; };
  assert(src.includes("from './ogrenme-hizli-yol'"), 'service saf modülü içe aktarıyor');
  const rqc = fnBody('private async runQueuedClassify(');
  const iHy = rqc.indexOf('await this.ogrenilmisHizliYol(');
  // Doğrulama 2026-09-13: runQueuedClassify KOALESANS yolunu (aiClassifyAccountingCoalesced) kullanır — kuyruk partisi tek Max çağrısı.
  const iAi = rqc.indexOf('await this.aiClassifyAccountingCoalesced(');
  assert(iHy > 0 && iAi > 0 && iHy < iAi, 'runQueuedClassify: ogrenilmisHizliYol AI\'dan (aiClassifyAccountingCoalesced) ÖNCE çağrılıyor');
  assert(!rqc.includes('await this.aiClassifyAccounting(content,'), 'runQueuedClassify: tekil aiClassifyAccounting KALDIRILDI (parti koalesansı)');
  assert(rqc.includes('[CLS-SKIP-LEARNED]') && rqc.indexOf('[CLS-SKIP-LEARNED]') < iAi, 'runQueuedClassify: hit → [CLS-SKIP-LEARNED] logu, Max atlanıyor');
  assert(rqc.includes('if (ogrenmeSecimi) {') && rqc.includes('matrahHesapKodu: ogrenmeSecimi.kod'), 'hit → c.matrahHesapKodu öğrenilmiş kod (rematch aiMatrahKodu okur)');
  assert(rqc.includes('patch.ogrenmeKaynak = ogrenmeSecimi ?'), 'runQueuedClassify: ocrData.ogrenmeKaynak ölçüm izi (miss → null)');
  assert(rqc.includes('imzaZorunlu: true'), 'AI atlama yolu imzaZorunlu=true');
  assert(rqc.includes('sellerVkn: true, buyerVkn: true'), 'runQueuedClassify belge seçimi sellerVkn/buyerVkn okuyor (islVkn boş kalmıyordu)');
  assert(rqc.includes("await this.rematchDocumentsWithLatestAccountPlan(tenantId, doc.taxpayerId, [doc.id])") && rqc.includes('await this.revalidateDocument(tenantId, doc.id)'), 'hit sonrası rematch + revalidate yine çalışıyor');
  const ard = fnBody('async aiReadDocument(', 200000);
  assert(ard.includes('ogrenmeSecimiOkuma = await this.ogrenilmisHizliYol(') && ard.includes('ogrenilmisAtla = !!ogrenmeSecimiOkuma;'), 'aiReadDocument: ogrenilmisAtla aynı saf yola bağlı (tekilleşti)');
  assert(!ard.includes("include: { decisions: { where: { taxpayerId: d.taxpayerId, kararTipi: 'fatura' } } }"), 'aiReadDocument eski ham vendorMemory sorgusu kalktı');
  assert(ard.includes('ogrenmeKaynak: ogrenmeSecimiOkuma ?'), 'aiReadDocument ocrData.ogrenmeKaynak yazıyor');
  const hyFn = fnBody('private async ogrenilmisHizliYol(');
  assert(hyFn.includes('this.vendorMemory.faturaKararlariByVkn(tenantId, vkn, 200)'), 'kararlar TEK sorguyla (faturaKararlariByVkn, limit 200)');
  assert(hyFn.includes('adCozumAdaylari(girdi)') && hyFn.includes('lucaAccountPlanLine.findMany'), 'ad çözümü yalnız gerekince plan snapshot\'larından');
  assert(hyFn.includes('isIsletmeLedger(t.defterTuru, t.mihsapDefterTuru)'), 'çapraz kuralda kararın mükellefi defter türüyle etiketleniyor');
  const rm = fnBody('const matrahForRate = async (rate: string) => {');
  assert(rm.includes("(okz.kaynak === 'HAFIZA_AD' || okz.kaynak === 'HAFIZA')") && rm.includes("if (m) mKaynak = 'HAFIZA';"), 'rematch: HAFIZA_AD kodu HAFIZA gibi öncelikli (satır kaynak=HAFIZA)');
  const iHafAd = rm.indexOf("okz.kaynak === 'HAFIZA_AD'");
  const iMevzuat = rm.indexOf('learnedMatrahCompatibleWithContent(');
  const iAiSecim = rm.indexOf('if (!m && aiMatrahAcc)');
  assert(iHafAd > 0 && iMevzuat > iHafAd && iAiSecim > iMevzuat, 'rematch sırası: HAFIZA_AD → mevzuat ağı → AI seçimi');
  const ram = fnBody('private async recordInvoiceAccountingMemory(');
  assert(ram.includes('hesapAdi: p.kararTipi === \'fatura\' && p.altKategori !== \'CARI\' ? hesapAdiBul(p.kategori) : null') && ram.includes('defterTuru: ogrDefter'), 'recordInvoiceAccountingMemory: hesapAdi + defterTuru ogrenmeKayitlari\'na yazılıyor');
  assert(src.includes('await this.approve(tenantId, id, userId, force);'), 'approveBatch → approve → recordInvoiceAccountingMemory (aynı yol)');
  const vms = fs.readFileSync(path.join(root, 'apps/api/src/vendor-memory/vendor-memory.service.ts'), 'utf8');
  assert(vms.includes('async faturaKararlariByVkn(') && vms.includes("where: { kararTipi: 'fatura' }"), 'VendorMemoryService.faturaKararlariByVkn tenant geneli fatura kararları');
  const hySrc = fs.readFileSync(path.join(root, 'apps/api/src/fatura-muhasebelestirme/ogrenme-hizli-yol.ts'), 'utf8');
  assert(!/ANTHROPIC_API_KEY|@anthropic-ai\/sdk|prisma|@nestjs/i.test(hySrc), 'saf modül: API anahtarı / DB / Nest bağımlılığı yok');
  assert(!/ANTHROPIC_API_KEY/.test(hyFn), 'hızlı yol API anahtarı kullanmıyor (Max-only)');
}

console.log(failed ? `\n${failed} kilit BAŞARISIZ` : '\nTÜM KİLİTLER GEÇTİ');
process.exit(failed ? 1 : 0);
