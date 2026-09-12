#!/usr/bin/env node
/**
 * PLAN ADAYLARI regresyonu — PLAN/15 Faz 1 "Karar çekirdeği" B parçası (2026-09-12).
 *   apps/api/src/fatura-muhasebelestirme/plan-adaylari.ts (SAF modül) + service kaynak kilitleri.
 *
 * Kilitler:
 *   1) ALIŞ: yalnız 15x / 25x / 73x-78x KAYDEDİLEBİLİR yaprak (noktalı, ana segment ≥3 hane, alt kodu yok);
 *      6xx / 3xx / 1xx (15x dışı) / 191 / 391 / 79x YOK; sıra 15x → 25x → 7xx; grup içi kodlar SAYISAL artan;
 *      roller doğru; metin satırı `kod = ad [rol]`, ad ≤ 80 karakter; grup kodu (770.02) ve noktasız ana hesap listede yok.
 *   2) Grup tavanı (ana hesap başına) çalışır; toplam tavan EN KALABALIK gruptan kırpar (7xx aç kalmaz); varsayılanlar 60/300.
 *   3) SATIŞ: 7xx / 15x / 25x YOK; 600/601/602 → 64x → 67x; 610/611/612 yalnız iade=true; 632 yok.
 *   4) Kaynak kilitleri (service): runQueuedClassify'da [CLS-IPUCU] var ve atlama YALNIZ detAtlamaAcikMi() ile;
 *      aiReadDocument'ta detHit ipucu yolu var; SATIŞ GELİR kuralı TEK sabitten (plan-adaylari.ts) iki yerde;
 *      eskalasyon koşulunda `guven` geçiyor; classify şemasında guven; aiMatrahKodu/aiMatrahGuven yazımı;
 *      aiPickGiderAccount planAdaylariHazirla kullanıyor; saatlik eskalasyon tavanı 60.
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

const pa = loadTs('apps/api/src/fatura-muhasebelestirme/plan-adaylari.ts');
const { planAdaylariHazirla, planAdayKodSeti, planKodKarsilastir, SATIS_GELIR_HESABI_KURALI, PLAN_ADAY_ROL_ACIKLAMASI } = pa;

const h = (accountCode, accountName) => ({ accountCode, accountName });
const uzunAd = 'ARAÇ YAKIT GİDERLERİ — BENZİN, MOTORİN, LPG VE DİĞER AKARYAKIT ALIMLARI (ŞİRKET ARAÇLARI, KİRALIK ARAÇLAR DAHİL)';

// Sentetik plan: grup kodları + 15/25/7xx/6xx/3xx/1xx/191/391/79x karışık yapraklar.
const PLAN = [
  h('1', 'DÖNEN VARLIKLAR'), h('10', 'HAZIR DEĞERLER'), h('100', 'KASA'), h('100.01', 'MERKEZ KASA'), h('100.01.001', 'TL KASASI'),
  h('102', 'BANKALAR'), h('102.01.001', 'ZİRAAT BANKASI'),
  h('15', 'STOKLAR'), h('150', 'İLK MADDE VE MALZEME'), h('150.01', 'HAMMADDE'), h('150.01.001', 'UN'), h('150.01.002', 'YAĞ'),
  h('153', 'TİCARİ MALLAR'), h('153.01', 'TİCARİ MALLAR'), h('153.01.001', 'TİCARİ MALLAR %20'), h('153.01.002', 'TİCARİ MALLAR %10'), h('153.01.003', 'TİCARİ MALLAR %1'),
  h('191', 'İNDİRİLECEK KDV'), h('191.01.001', 'İNDİRİLECEK KDV %20'),
  h('25', 'MADDİ DURAN VARLIKLAR'), h('255', 'DEMİRBAŞLAR'), h('255.01', 'DEMİRBAŞLAR'), h('255.01.001', 'BÜRO DEMİRBAŞLARI'), h('255.01.002', 'BİLGİSAYARLAR'),
  h('254', 'TAŞITLAR'), h('254.01.001', 'BİNEK ARAÇLAR'),
  h('3', 'KISA VADELİ YABANCI KAYNAKLAR'), h('320', 'SATICILAR'), h('320.01.001', 'SATICI X'), h('391', 'HESAPLANAN KDV'), h('391.01.001', 'HESAPLANAN KDV %20'),
  h('6', 'GELİR TABLOSU'), h('600', 'YURTİÇİ SATIŞLAR'), h('600.01', 'YURTİÇİ SATIŞLAR'), h('600.01.001', 'YURTİÇİ SATIŞLAR %20'), h('600.01.002', 'YURTİÇİ SATIŞLAR %10'),
  h('601', 'YURTDIŞI SATIŞLAR'), h('601.01.001', 'İHRACAT'),
  h('602', 'DİĞER GELİRLER'), h('602.01.001', 'CİRO PRİMİ'),
  h('610', 'SATIŞTAN İADELER'), h('610.01.001', 'SATIŞTAN İADELER %20'),
  h('611.01.001', 'SATIŞ İSKONTOLARI'),
  h('632', 'GENEL YÖNETİM GİDERLERİ'), h('632.01.001', 'GENEL YÖNETİM GİDERLERİ YANSITMA'),
  h('649', 'DİĞER OLAĞAN GELİR VE KÂRLAR'), h('649.01.001', 'KUR FARKI GELİRİ'),
  h('679.01.001', 'DİĞER OLAĞANDIŞI GELİR'),
  h('7', 'MALİYET HESAPLARI'), h('740', 'HİZMET ÜRETİM MALİYETİ'), h('740.01.001', 'HİZMET ÜRETİM — MALZEME'),
  h('760', 'PAZARLAMA SATIŞ DAĞITIM'), h('760.01.001', 'REKLAM GİDERİ'),
  h('770', 'GENEL YÖNETİM GİDERLERİ'), h('770.01', 'GENEL GİDERLER'), h('770.01.001', 'KİRA GİDERİ'), h('770.01.002', 'ELEKTRİK GİDERİ'),
  h('770.01.010', 'TELEFON GİDERİ'), h('770.01.100', uzunAd),
  h('770.02', 'ARAÇ GİDERLERİ'), h('770.02.001', 'ARAÇ BAKIM ONARIM'),
  h('790', '7/B İLK MADDE'), h('790.01.001', '7/B İLK MADDE VE MALZEME'),
  h('77.1', 'HATALI KISA ANA SEGMENT'),
  h('153.01.001', 'MÜKERRER SATIR (tekilleşmeli)'),
];

console.log('1) ALIŞ listesi');
{
  const r = planAdaylariHazirla(PLAN, { yon: 'ALIS' });
  const kodlar = r.adaylar.map((a) => a.kod);
  assert(kodlar.length > 0, 'alışta aday var');
  assert(!kodlar.some((k) => /^6/.test(k)), 'alışta 6xx YOK');
  assert(!kodlar.some((k) => /^3/.test(k)), 'alışta 3xx YOK');
  assert(!kodlar.some((k) => /^1/.test(k) && !/^15/.test(k)), 'alışta 1xx (15x dışı: kasa/banka/191) YOK');
  assert(!kodlar.some((k) => /^(19|39)/.test(k)), 'alışta 19x/39x YOK');
  assert(!kodlar.some((k) => /^79/.test(k)), 'alışta 79x (7/B) YOK');
  assert(!kodlar.includes('770.02') && !kodlar.includes('770') && !kodlar.includes('153.01') && !kodlar.includes('150'), 'grup kodu / noktasız ana hesap listede YOK');
  assert(!kodlar.includes('77.1'), 'ana segment <3 hane listede YOK');
  assert(kodlar.filter((k) => k === '153.01.001').length === 1, 'mükerrer satır tekilleşti');
  const ix = (k) => kodlar.indexOf(k);
  assert(ix('150.01.001') >= 0 && ix('153.01.003') >= 0 && ix('255.01.001') >= 0 && ix('254.01.001') >= 0 && ix('740.01.001') >= 0 && ix('770.02.001') >= 0, 'beklenen yapraklar listede');
  const son15 = Math.max(...kodlar.map((k, i) => (/^15/.test(k) ? i : -1)));
  const ilk25 = Math.min(...kodlar.map((k, i) => (/^25/.test(k) ? i : Infinity)));
  const son25 = Math.max(...kodlar.map((k, i) => (/^25/.test(k) ? i : -1)));
  const ilk7 = Math.min(...kodlar.map((k, i) => (/^7/.test(k) ? i : Infinity)));
  assert(son15 < ilk25 && son25 < ilk7, 'sıra 15x → 25x → 7xx');
  assert(ix('740.01.001') < ix('760.01.001') && ix('760.01.001') < ix('770.01.001'), '7xx içinde 740 → 760 → 770 artan');
  assert(ix('770.01.002') < ix('770.01.010') && ix('770.01.010') < ix('770.01.100'), 'grup içi kodlar SAYISAL artan (002 < 010 < 100)');
  assert(ix('254.01.001') < ix('255.01.001'), '25x içinde 254 → 255 artan');
  const rol = (k) => (r.adaylar.find((a) => a.kod === k) || {}).rol;
  assert(rol('153.01.001') === 'stok/ticari mal' && rol('150.01.001') === 'stok/ticari mal', '15x rolü "stok/ticari mal"');
  assert(rol('255.01.001') === 'duran varlık (demirbaş)', '25x rolü "duran varlık (demirbaş)"');
  assert(/^gider \(/.test(rol('770.01.001')) && /^gider \(/.test(rol('740.01.001')) && /^gider \(/.test(rol('760.01.001')), '7xx rolü "gider (...)"');
  assert(/genel yönetim/.test(rol('770.01.001')) && /hizmet üretim/.test(rol('740.01.001')) && /pazarlama/.test(rol('760.01.001')), '7xx rol etiketi gruba özgü (genel yönetim / hizmet üretim / pazarlama)');
  const satirlar = r.metin.split('\n');
  assert(satirlar.length === r.adaylar.length, 'metin satır sayısı = aday sayısı');
  assert(satirlar.every((s) => /^\S+ = .+ \[[^\]]+\]$/.test(s)), 'her satır `kod = ad [rol]` biçiminde');
  assert(satirlar.includes('153.01.001 = TİCARİ MALLAR %20 [stok/ticari mal]'), 'örnek satır birebir');
  const uzun = satirlar.find((s) => s.startsWith('770.01.100 = '));
  assert(uzun && uzun.slice('770.01.100 = '.length, uzun.lastIndexOf(' [')).length === 80, 'ad 80 karaktere kırpıldı');
  assert(planAdayKodSeti(r.adaylar).has('770.01.001') && !planAdayKodSeti(r.adaylar).has('600.01.001'), 'planAdayKodSeti aday kümesi');
}

console.log('2) Grup tavanı + toplam tavan');
{
  const mk = (ana, n, ad) => Array.from({ length: n }, (_, i) => h(`${ana}.01.${String(i + 1).padStart(3, '0')}`, `${ad} ${i + 1}`));
  const plan = [h('153', 'TİCARİ MALLAR'), ...mk('153', 120, 'ÜRÜN'), h('770', 'GENEL YÖNETİM'), ...mk('770', 5, 'GİDER')];
  const r = planAdaylariHazirla(plan, { yon: 'ALIS', grupTavani: 10 });
  const k153 = r.adaylar.filter((a) => a.kod.startsWith('153')).map((a) => a.kod);
  const k770 = r.adaylar.filter((a) => a.kod.startsWith('770')).map((a) => a.kod);
  assert(k153.length === 10 && k153[0] === '153.01.001' && k153[9] === '153.01.010', 'grup tavanı 10: 153 ilk 10 kod (artan)');
  assert(k770.length === 5, 'grup tavanı diğer grubu etkilemez (770: 5)');
  const rv = planAdaylariHazirla(plan, { yon: 'ALIS' });
  assert(rv.adaylar.filter((a) => a.kod.startsWith('153')).length === 60, 'varsayılan grup tavanı 60');
  const plan2 = [...mk('153', 120, 'ÜRÜN'), ...mk('770', 100, 'GİDER'), ...mk('255', 50, 'DEMİRBAŞ')];
  const rt = planAdaylariHazirla(plan2, { yon: 'ALIS', grupTavani: 200, toplamTavan: 100 });
  const say = (p) => rt.adaylar.filter((a) => a.kod.startsWith(p)).length;
  assert(rt.adaylar.length === 100, 'toplam tavan 100 uygulandı');
  assert(say('770') >= 30 && say('153') >= 30 && say('255') >= 30, 'toplam tavan EN KALABALIK gruptan kırpar — 7xx aç kalmaz (her grup ≥30)');
  const rd = planAdaylariHazirla(plan2, { yon: 'ALIS', grupTavani: 500 });
  assert(rd.adaylar.length === 270 && rd.adaylar.length <= 300, 'varsayılan toplam tavan 300 (270 sığar)');
  const plan3 = [...mk('153', 200, 'ÜRÜN'), ...mk('770', 200, 'GİDER')];
  const r3 = planAdaylariHazirla(plan3, { yon: 'ALIS', grupTavani: 500 });
  assert(r3.adaylar.length === 300, 'varsayılan toplam tavan 300 (400 → 300)');
  assert(planAdaylariHazirla(plan, { yon: 'ALIS', grupTavani: 0, toplamTavan: -5 }).adaylar.filter((a) => a.kod.startsWith('153')).length === 60, 'geçersiz tavan → varsayılan');
}

console.log('3) SATIŞ listesi');
{
  const r = planAdaylariHazirla(PLAN, { yon: 'SATIS' });
  const kodlar = r.adaylar.map((a) => a.kod);
  assert(!kodlar.some((k) => /^(7|15|25)/.test(k)), 'satışta 7xx / 15x / 25x YOK');
  assert(kodlar.includes('600.01.001') && kodlar.includes('600.01.002') && kodlar.includes('601.01.001') && kodlar.includes('602.01.001'), '600/601/602 yaprakları var');
  assert(kodlar.includes('649.01.001') && kodlar.includes('679.01.001'), '64x / 67x var');
  assert(!kodlar.includes('632.01.001'), '632 (yansıtma) satışta YOK');
  assert(!kodlar.includes('610.01.001') && !kodlar.includes('611.01.001'), 'iade=false → 610/611 YOK');
  assert(!kodlar.includes('600') && !kodlar.includes('600.01'), 'satışta grup kodu YOK');
  const ix = (k) => kodlar.indexOf(k);
  assert(ix('600.01.001') < ix('601.01.001') && ix('601.01.001') < ix('602.01.001') && ix('602.01.001') < ix('649.01.001') && ix('649.01.001') < ix('679.01.001'), 'sıra 600 → 601 → 602 → 64x → 67x');
  const rol = (k) => (r.adaylar.find((a) => a.kod === k) || {}).rol;
  assert(/^gelir \(/.test(rol('600.01.001')) && /yurtiçi/.test(rol('600.01.001')) && /yurtdışı/.test(rol('601.01.001')) && /diğer/.test(rol('602.01.001')), '60x rolleri gelir (yurtiçi/yurtdışı/diğer)');
  assert(/olağan gelir/.test(rol('649.01.001')) && /olağandışı/.test(rol('679.01.001')), '64x/67x rolleri');
  const ri = planAdaylariHazirla(PLAN, { yon: 'SATIS', iade: true });
  const ki = ri.adaylar.map((a) => a.kod);
  assert(ki.includes('610.01.001') && ki.includes('611.01.001'), 'iade=true → 610/611 var');
  assert(ri.adaylar.find((a) => a.kod === '610.01.001').rol === 'satıştan iade/iskonto', '610 rolü "satıştan iade/iskonto"');
  assert(ki.indexOf('602.01.001') < ki.indexOf('610.01.001') && ki.indexOf('610.01.001') < ki.indexOf('649.01.001'), 'iade 60x sonrası, 64x öncesi');
  assert(planAdaylariHazirla(PLAN, { yon: 'ALIS', iade: true }).adaylar.every((a) => !/^61/.test(a.kod)), 'alışta iade=true olsa da 61x YOK');
}

console.log('4) Yardımcılar + boş girdi');
{
  assert(planKodKarsilastir('153.01.002', '153.01.010') < 0 && planKodKarsilastir('770.01.100', '770.01.010') > 0 && planKodKarsilastir('740.01.001', '770.01.001') < 0 && planKodKarsilastir('153.01', '153.01.001') < 0, 'planKodKarsilastir sayısal segment sırası');
  const bos = planAdaylariHazirla([], { yon: 'ALIS' });
  assert(Array.isArray(bos.adaylar) && bos.adaylar.length === 0 && bos.metin === '', 'boş plan → boş liste');
  const dz = planAdaylariHazirla([h('', 'ADSIZ'), h(null, null), h('770.01.001', '   KİRA   GİDERİ  ')], { yon: 'ALIS' });
  assert(dz.adaylar.length === 1 && dz.adaylar[0].ad === 'KİRA GİDERİ', 'boş/null kod atlanır, ad boşlukları sadeleşir');
  assert(typeof SATIS_GELIR_HESABI_KURALI === 'string' && SATIS_GELIR_HESABI_KURALI.startsWith('SATIŞ GELİR HESABI (mükellef SATICIYSA') && /602 DİĞER GELİRLER/.test(SATIS_GELIR_HESABI_KURALI), 'SATIŞ GELİR kuralı sabiti tam metin');
  assert(typeof PLAN_ADAY_ROL_ACIKLAMASI === 'string' && /STOK \(15x\)/.test(PLAN_ADAY_ROL_ACIKLAMASI) && /GİDER \(7xx\)/.test(PLAN_ADAY_ROL_ACIKLAMASI) && /DURAN VARLIK \(25x\)/.test(PLAN_ADAY_ROL_ACIKLAMASI), 'rol açıklaması sabiti');
}

console.log('5) Kaynak kilitleri (service)');
{
  const svc = fs.readFileSync(path.join(root, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
  const modSrc = fs.readFileSync(path.join(root, 'apps/api/src/fatura-muhasebelestirme/plan-adaylari.ts'), 'utf8');
  const between = (from, to) => { const a = svc.indexOf(from); const b = a >= 0 ? svc.indexOf(to, a + from.length) : -1; return a >= 0 && b > a ? svc.slice(a, b) : ''; };
  const say = (hay, needle) => hay.split(needle).length - 1;

  const rq = between('private async runQueuedClassify(', 'private async runQueuedAiRead(');
  assert(rq.length > 0, 'runQueuedClassify bulundu');
  assert(rq.includes('[CLS-IPUCU]'), 'runQueuedClassify: [CLS-IPUCU] ipucu yolu var');
  assert(rq.includes('detC && this.detAtlamaAcikMi()'), 'runQueuedClassify: atlama YALNIZ detAtlamaAcikMi() ile');
  assert(!rq.includes('detC || await this.aiClassifyAccounting'), 'runQueuedClassify: eski koşulsuz atlama (detC || AI) KALDIRILDI');
  assert(say(rq, '[CLS-SKIP]') === 1 && rq.includes('FM_DET_ATLA=1'), 'runQueuedClassify: [CLS-SKIP] yalnız anahtar açıkken (tek yer)');
  assert(rq.includes('planAdaylariHazirla(lines, { yon: kind, toplamTavan: 150') && rq.includes('planKodlari = planAdayKodSeti('), 'runQueuedClassify: plan adayları (Haiku tavan 150) + kod kümesi');
  assert(rq.includes('patch.aiMatrahKodu = aiKod') && rq.includes('patch.aiMatrahGuven = c.guven') && rq.includes('planKodlari.has(aiKod)'), 'runQueuedClassify: geçerli yaprak ise aiMatrahKodu + aiMatrahGuven yazılır');
  assert(rq.includes('if (doc.taxpayerId && !isIsletme)'), 'runQueuedClassify: işletme mükellefinde plan verilmez');
  assert(rq.includes('if (!c && detC) { c = detC;'), 'runQueuedClassify: AI boşsa detC yedek');

  const ar = between('async aiReadDocument(tenantId: string, documentId: string)', 'private classifyHeadSegments(');
  assert(ar.length > 0, 'aiReadDocument bulundu');
  assert(ar.includes('const detAtla = !!detHit && this.detAtlamaAcikMi()'), 'aiReadDocument: detHit atlaması yalnız detAtlamaAcikMi() ile');
  assert(ar.includes('[CLS-IPUCU]') && ar.includes('ipucu: detHit ?'), 'aiReadDocument: detHit ipucu yolu var');
  assert(ar.includes('if (!c && detSonuc && !ogrenilmisAtla) { c = detSonuc;'), 'aiReadDocument: AI boşsa detHit yedek');
  assert(ar.includes('planAdaylariHazirla(allLines, {') && ar.includes("yon: d.invoiceKind === 'SATIS' ? 'SATIS' : 'ALIS'"), 'aiReadDocument: plan adayları yön ile tek kaynaktan');
  assert(!ar.includes('cand.slice(0, semMotor ? 400 : 100)'), 'aiReadDocument: eski dağınık plan besleme kaldırıldı');
  const esk = between('İKİ-AŞAMALI OKUMA (pilot, 2026-08-11)', '_sonnetEskale = true');
  assert(esk.includes("=== 'dusuk'") && esk.includes('_guvenDusuk ||'), 'aiReadDocument eskalasyon koşulunda guven === dusuk var');
  assert(esk.includes('!planLeafSet.has(_kodStr)'), 'aiReadDocument eskalasyon: geçersiz (listede olmayan) kod boş sayılır');

  assert(say(svc, '${SATIS_GELIR_HESABI_KURALI}') >= 2, 'SATIŞ GELİR kuralı TEK sabitten ≥2 yerde kullanılıyor');
  assert(!svc.includes('SATIŞ GELİR HESABI (mükellef SATICIYSA'), 'SATIŞ GELİR metni serviste kopya değil');
  assert(say(modSrc, 'SATIŞ GELİR HESABI (mükellef SATICIYSA') === 1, 'SATIŞ GELİR metni plan-adaylari.ts içinde tek');
  const cb = between('private classifyBodySegments(', 'private kalemBazliHesapFor(');
  assert(cb.includes("invoiceKind === 'SATIS'") && cb.includes('${SATIS_GELIR_HESABI_KURALI}'), 'classifyBodySegments: satışta SATIŞ GELİR kuralı');
  assert(cb.includes('KELİME KURALI İPUCU') && cb.includes('körü körüne kopyalama'), 'classifyBodySegments: ipucu satırı');
  assert(cb.includes('ÖNCEKİ DENEME DÜŞÜK GÜVENLİ'), 'classifyBodySegments: eskalasyon notu');
  assert(say(svc, '${PLAN_ADAY_ROL_ACIKLAMASI}') >= 3, 'rol açıklaması 3 yerde (okuma promptu, classify, aiPickGiderAccount)');

  const js = between('private classifyJsonShape(', 'private parseClassifyObject(');
  assert(js.includes('"matrahHesapKodu":"","guven":"yuksek|orta|dusuk"'), 'classify şeması: matrahHesapKodu + guven');
  const pc = between('private parseClassifyObject(', 'private async aiClassifyAccountingMulti(');
  assert(pc.includes("g === 'yuksek' || g === 'orta' || g === 'dusuk'"), 'parseClassifyObject: guven normalize');
  assert(pc.includes("if (r.guven === 'dusuk') return true;") && pc.includes('!planKodlari.has(kod)'), 'classifyEskalasyonGerekli: dusuk | boş | geçersiz kod');

  const ac = between('private async aiClassifyAccounting(', 'private cleanBaseNeden(');
  assert(ac.includes('strong ? MAX_MODEL_DEFAULT : MAX_MODEL_CHEAP'), 'aiClassifyAccounting: eskalasyonda MAX_MODEL_DEFAULT (Sonnet)');
  assert(ac.includes('!strong && this.classifyEskalasyonGerekli(r, planAdaylar, ek?.planKodlari)') && ac.includes('strongModel: true'), 'aiClassifyAccounting: Haiku sonrası bir kez Sonnet');
  assert(ac.includes('strong && !this.eskalasyonHakkiAl()'), 'aiClassifyAccounting: saatlik tavan kapısı');
  assert(svc.includes('ESKALASYON_SAAT_TAVANI = 60') && svc.includes('private static eskalasyonSayaci'), 'eskalasyon tavanı 60/saat, statik sayaç');
  const mu = between('private async aiClassifyAccountingMulti(', 'private aiClassifyAccountingCoalesced(');
  assert(mu.includes('KELİME KURALI İPUCU (bu belge)'), 'Multi: belge-bazlı ipucu belge bloğunda');
  const fl = between('private async flushClassifyBatch(', 'private async aiClassifyAccounting(');
  assert(fl.includes('this.classifyEskalasyonGerekli(results[i], buf.shared.planAdaylar, buf.shared.planKodlari)') && fl.includes('strongModel: true') && fl.includes('resolveAt(i, r2 || results[i] || null)'), 'flushClassifyBatch: toplu sonuçta tek tek Sonnet eskalasyonu, diğerleri hemen çözülür, Haiku sonucu yedek');
  assert(svc.includes("String(process.env.FM_DET_ATLA || '').trim() === '1'"), 'detAtlamaAcikMi: FM_DET_ATLA=1 anahtarı');
  assert(say(svc, 'this.detAtlamaAcikMi()') === 2, 'detAtlamaAcikMi iki yerde (runQueuedClassify + aiReadDocument)');

  const pg = between('private async aiPickGiderAccount(', 'private async rematchPendingDocumentsWithAccountPlan(');
  assert(pg.includes("planAdaylariHazirla(accounts, { yon: 'ALIS' })") && pg.includes('adayKodlari.has(kod)'), 'aiPickGiderAccount: tek kaynak liste + aday kümesi doğrulaması');
  assert(!pg.includes('.slice(0, 250)'), 'aiPickGiderAccount: eski 250 listesi kaldırıldı');
  assert(svc.includes("from './plan-adaylari'"), 'service plan-adaylari modülünü içe aktarıyor');
}

if (failed) { console.error(`\n[plan-adaylari] ${failed} kilit BAŞARISIZ`); process.exit(1); }
console.log('\n[plan-adaylari] tüm kilitler geçti');
