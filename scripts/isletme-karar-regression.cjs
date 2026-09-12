#!/usr/bin/env node
/**
 * İŞLETME DEFTERİ KARAR regresyonu — PLAN/15 "Faz 3 — İşletme defteri" (2026-09-12).
 *   packages/shared/src/isletme-referans.ts (SAF modül) + fatura-muhasebelestirme.service.ts kaynak kilitleri.
 *
 * Kilitler:
 *   1) isletmeKodCoz: AD → KOD (eski öğrenme kayıtları "Diğer Hasılat" gibi AD yazılmıştı); parantez etiketi / Türkçe harf
 *      / boşluk farkı tolere; kod verilirse aynen; yön çelişkisi (satış yönünde gider adı) → null; alt verilip bulunamazsa altCozuldu=false.
 *   2) Ünvan kuralı (#8): "SİMTAŞ ELEKTRİK SAN. TİC." TETİKLEMEZ; "BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş." → Elektrik (82);
 *      İSKİ → Su (83); Turkcell → Telefon (87); içerik varken ünvan okunmaz (streç film + SİMTAŞ → 228); "elektrik malzemesi" → sarf (228).
 *   3) Stopaj türü (#38): e-SMM → 022; kira → 041; araç kiralama → ''; satışta ''.
 *   4) Plaka (#38): "34 ABC 123" / "34ABC123" bulunur; "10 KG 100" ve il>81 bulunmaz.
 *   5) KKEG (#18): binek + yakıt/bakım/kira → 201 (%70 kuralı, indirilebilirYuzde=70); ceza → 159; bağış → 200; kamyon motorin → yok;
 *      isletmeAutoKayitAltKod('ALIS','5',…) KKEG alt seçer; GVK40 ('4') yolu değişmedi (binek bakım → 114).
 *   6) "Sabit Kıymet Satış Zararı" gider alış türü + kayıt türü + alt tür listelerinde.
 *   7) KDV=0 (#38): ihracat/istisna → Tam İstisna (5); kısmi istisna → 4; ipucu yoksa Normal (1).
 *   8) Kaynak kilitleri (service): approve işletme dalı revalidateDocument çağırıyor + engel kapısı; recordInvoiceAccountingMemory
 *      işletme dalında userEdited ŞARTI YOK (boost 2/1); pickIsletmeMemory isletmeKodCoz kullanıyor; runValidation isletme atlama
 *      kümesi; revalidate KKEG_SUPHESI üretiyor; satışta gider kategorisi yazılmıyor; faaliyet tanımsız istemi; retroaktif geçiş
 *      AI/HAFIZA sınıfını ezmiyor.
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

const ref = loadTs('packages/shared/src/isletme-referans.ts');
const {
  isletmeKodCoz, isletmeGiderSinifi, isletmeKurumUnvaniMi, isletmeStopajTuru, isletmePlakaBul, isletmeKkegTespit,
  isletmeAutoKayitAltKod, isletmeAlisSatisTuru, isletmeRef, getKayitAltList,
} = ref;

console.log('1) isletmeKodCoz — ad → kod');
{
  const a = isletmeKodCoz('SATIS', 'Diğer Hasılat');
  assert(a && a.kayitTuruKod === '4' && a.kayitAltKod === '' && a.altCozuldu === true, `SATIS "Diğer Hasılat" → 4 (alt yok): ${JSON.stringify(a)}`);
  const b = isletmeKodCoz('SATIS', 'Hizmet Satışı', 'Hizmet Satışı');
  assert(b && b.kayitTuruKod === '2' && b.kayitAltKod === '188' && b.altCozuldu === true, `SATIS "Hizmet Satışı"/"Hizmet Satışı" → 2/188: ${JSON.stringify(b)}`);
  const c = isletmeKodCoz('ALIS', 'İndirilecek Giderler', 'Elektrik Giderleri');
  assert(c && c.kayitTuruKod === '4' && c.kayitAltKod === '82', `ALIS "İndirilecek Giderler" (parantezsiz) + "Elektrik Giderleri" → 4/82: ${JSON.stringify(c)}`);
  const c2 = isletmeKodCoz('ALIS', 'indirilecek giderler (gvk md. 40)', 'elektrik giderleri (GVK 40/1)');
  assert(c2 && c2.kayitTuruKod === '4' && c2.kayitAltKod === '82', 'küçük harf + parantezli ad da çözülür');
  const d = isletmeKodCoz('ALIS', '4', '113');
  assert(d && d.kayitTuruKod === '4' && d.kayitAltKod === '113' && d.kayitAltAd.startsWith('Taşıt Akaryakıt'), 'kod verilirse aynen (4/113) + ad doldurulur');
  const e = isletmeKodCoz('ALIS', 'Gider Kabul Edilmeyen Ödemeler', 'Bağış ve Yardımlar');
  assert(e && e.kayitTuruKod === '5' && e.kayitAltKod === '200', 'KKEG adı → 5/200');
  const f = isletmeKodCoz('SATIS', 'İndirilecek Giderler (GVK Md. 40)');
  assert(f === null, 'SATIS yönünde GİDER adı → null (yön çelişkisi)');
  const g = isletmeKodCoz('ALIS', 'Mal Alışı', 'Olmayan Alt Tür');
  assert(g && g.kayitTuruKod === '1' && g.kayitAltKod === '' && g.altCozuldu === false, 'alt verilmiş ama listede yok → altCozuldu=false (hafıza yok sayar)');
  assert(isletmeKodCoz('ALIS', '') === null && isletmeKodCoz('ALIS', 'uydurma tür') === null, 'boş / bilinmeyen → null');
  const h = isletmeKodCoz('ALIS', 'Sabit Kıymet Alışı');
  assert(h && h.kayitTuruKod === '13', '"Sabit Kıymet Alışı" → 13 (Ek Maliyet ile karışmaz)');
  const i = isletmeKodCoz('ALIS', '99');
  assert(i === null, 'listede olmayan kod → null');
  const j = isletmeKodCoz('ALIS', 'Giderler GVK Md 40', 'Kira Gideri');
  assert(j && j.kayitTuruKod === '4' && j.kayitAltKod === '165', 'parantez içeriğiyle kısmi ad ("Giderler GVK Md 40") + "Kira Gideri" → 4/165');
}

console.log('2) Ünvan kuralı (#8) — isletmeGiderSinifi / isletmeKurumUnvaniMi');
{
  assert(isletmeGiderSinifi({ vendorName: 'SİMTAŞ ELEKTRİK SAN. TİC. LTD. ŞTİ.' }) === null, 'SİMTAŞ ELEKTRİK SAN. (üretici/tüccar) → TETİKLEMEZ (null)');
  assert(isletmeKurumUnvaniMi('SİMTAŞ ELEKTRİK SAN. TİC. LTD. ŞTİ.') === false, 'isletmeKurumUnvaniMi(SİMTAŞ) = false');
  const bog = isletmeGiderSinifi({ vendorName: 'BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.' });
  assert(bog && bog.kayitTuruKod === '4' && bog.kayitAltKod === '82', `BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş. → 4/82: ${JSON.stringify(bog)}`);
  assert(isletmeKurumUnvaniMi('BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.') === true, 'isletmeKurumUnvaniMi(BOĞAZİÇİ EPSAŞ) = true');
  const iski = isletmeGiderSinifi({ vendorName: 'İSKİ GENEL MÜDÜRLÜĞÜ' });
  assert(iski && iski.kayitAltKod === '83', 'İSKİ → Su (83)');
  const tc = isletmeGiderSinifi({ vendorName: 'TURKCELL İLETİŞİM HİZMETLERİ A.Ş.' });
  assert(tc && tc.kayitAltKod === '87', 'Turkcell → Telefon (87)');
  const igdas = isletmeGiderSinifi({ vendorName: 'İGDAŞ İSTANBUL GAZ DAĞITIM A.Ş.' });
  assert(igdas && igdas.kayitAltKod === '84', 'İGDAŞ → Doğalgaz (84)');
  const strec = isletmeGiderSinifi({ giderTuru: 'streç film', vendorName: 'SİMTAŞ ELEKTRİK SAN. TİC.' });
  assert(strec && strec.kayitAltKod === '228', 'içerik (streç film) varken ünvan okunmaz → 228');
  const simurg = isletmeGiderSinifi({ kalemler: ['STREÇ FİLM 500 MT', 'KOLİ BANDI'], vendorName: 'SİMURG AMBALAJ SAN.' });
  assert(simurg && simurg.kayitAltKod === '228', 'kalemler içerik sayılır (SİMURG AMBALAJ streç) → 228');
  const nak = isletmeGiderSinifi({ kalemler: ['NAKLİYE HİZMET BEDELİ'], vendorName: 'BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.' });
  assert(nak && nak.kayitAltKod === '205', 'içerik (nakliye) kurum ünvanını da yener → 205');
  const elmz = isletmeGiderSinifi({ giderTuru: 'elektrik malzemesi' });
  assert(elmz && elmz.kayitAltKod === '228', '"elektrik malzemesi" → sarf (228), Elektrik Gideri DEĞİL');
  const eltes = isletmeGiderSinifi({ giderTuru: 'elektrik tesisat onarımı' });
  assert(eltes && eltes.kayitAltKod === '85', '"elektrik tesisat" → bakım onarım (85)');
  const el = isletmeGiderSinifi({ giderTuru: 'elektrik' });
  assert(el && el.kayitAltKod === '82', 'giderTuru "elektrik" → 82 (mevcut davranış korunur)');
  assert(isletmeGiderSinifi({ giderTuru: '' }) === null, 'belirsiz alış → null');
  assert(isletmeGiderSinifi({ giderTuru: 'bilinmeyen içerik xyz', vendorName: 'BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.' }) === null, 'içerik var ama kural yok → ünvana DÜŞMEZ (null)');
  const tm = isletmeGiderSinifi({ matrahKategori: 'ticari_mal' });
  assert(tm && tm.kayitTuruKod === '1' && tm.kayitAltKod === '186', 'ticari_mal → Mal Alışı (değişmedi)');
}

console.log('3) Stopaj türü (#38)');
{
  assert(isletmeStopajTuru('ALIS', { belgeTuru: 'E_SMM' }) === '022', 'e-SMM belge → 022');
  assert(isletmeStopajTuru('ALIS', { belgeTuru: 'e-Serbest Meslek Makbuzu' }) === '022', '"e-Serbest Meslek Makbuzu" → 022');
  assert(isletmeStopajTuru('ALIS', { giderTuru: 'kira' }) === '041', 'kira gideri → 041');
  assert(isletmeStopajTuru('ALIS', { text: 'İŞYERİ KİRA BEDELİ EYLÜL' }) === '041', '"işyeri kira bedeli" → 041');
  assert(isletmeStopajTuru('ALIS', { giderTuru: 'araç kiralama' }) === '', 'araç kiralama → stopaj yok');
  assert(isletmeStopajTuru('ALIS', { giderTuru: 'akaryakıt' }) === '', 'akaryakıt → yok');
  assert(isletmeStopajTuru('SATIS', { belgeTuru: 'E_SMM' }) === '', 'satışta stopaj türetilmez');
}

console.log('4) Plaka (#38)');
{
  assert(isletmePlakaBul('34 ABC 123 plakalı araç yakıt') === '34 ABC 123', '"34 ABC 123" bulunur');
  assert(isletmePlakaBul('34abc123 motorin') === '34 ABC 123', '"34abc123" (bitişik/küçük) → "34 ABC 123"');
  assert(isletmePlakaBul('06 AB 1234') === '06 AB 1234', '4 haneli plaka');
  assert(isletmePlakaBul('10 KG 100 kömür') === '', '"10 KG 100" birim → plaka değil');
  assert(isletmePlakaBul('99 AB 123') === '', 'il kodu 99 → plaka değil');
  assert(isletmePlakaBul('') === '' && isletmePlakaBul(null) === '', 'boş → boş');
}

console.log('5) KKEG (#18) — isletmeKkegTespit / isletmeAutoKayitAltKod kod 5');
{
  const b = isletmeKkegTespit('binek otomobil akaryakıt motorin');
  assert(b && b.kayitAltKod === '201' && b.indirilebilirYuzde === 70, `binek + yakıt → 201 (%70): ${JSON.stringify(b)}`);
  const bk = isletmeKkegTespit('34 ABC 123 EGEA periyodik bakım');
  assert(bk && bk.kayitAltKod === '201', 'binek model (egea) + bakım → 201');
  const kira = isletmeKkegTespit('binek araç kiralama');
  assert(kira && kira.kayitAltKod === '201', 'binek + kiralama → 201');
  assert(isletmeKkegTespit('kamyon motorin') === null, 'kamyon motorin → KKEG yok (ticari araç)');
  assert(isletmeKkegTespit('nakliye hizmet bedeli') === null, 'nakliye → yok');
  const c = isletmeKkegTespit('trafik cezası ödemesi');
  assert(c && c.kayitAltKod === '159', 'trafik cezası → 159');
  const g = isletmeKkegTespit('bağış makbuzu');
  assert(g && g.kayitAltKod === '200', 'bağış → 200');
  const mtv = isletmeKkegTespit('binek otomobil motorlu taşıtlar vergisi');
  assert(mtv && mtv.kayitAltKod === '219', 'binek MTV → 219');
  const k = isletmeKkegTespit('kişisel kozmetik parfüm');
  assert(k && k.kayitAltKod === '154', 'kişisel harcama → 154');
  assert(isletmeAutoKayitAltKod('ALIS', '5', 'binek oto bakım') === '201', "isletmeAutoKayitAltKod('ALIS','5', binek bakım) → 201");
  assert(isletmeAutoKayitAltKod('ALIS', '5', 'nakliye') === '', "kod 5 + sinyal yok → ''");
  assert(isletmeAutoKayitAltKod('ALIS', '4', 'binek oto bakım') === '114', 'GVK40 yolu değişmedi: binek bakım → 114');
  assert(isletmeAutoKayitAltKod('SATIS', '5', 'binek') === '', 'satışta alt yok');
}

console.log('6) Sabit Kıymet Satış Zararı listede (#38)');
{
  const r = isletmeRef('ALIS');
  assert(r.alisSatisTuru.some((x) => x.ad === 'Sabit Kıymet Satış Zararı'), 'gider ALIŞ TÜRÜ listesinde');
  const kt = r.kayitTuru.find((x) => x.ad === 'Sabit Kıymet Satış Zararı');
  assert(!!kt, 'gider KAYIT TÜRÜ listesinde');
  assert(kt && getKayitAltList('ALIS', kt.kod).some((x) => x.ad === 'Sabit Kıymet Satış Zararı'), 'alt tür listesinde');
  const kods = r.kayitTuru.map((x) => x.kod);
  assert(new Set(kods).size === kods.length, 'kayıt türü kodları çakışmıyor');
  const askods = r.alisSatisTuru.map((x) => x.kod);
  assert(new Set(askods).size === askods.length, 'alış türü kodları çakışmıyor');
  assert(isletmeRef('SATIS').kayitTuru.length === 4, 'satış kayıt türleri değişmedi (4)');
}

console.log('7) KDV=0 ayrımı (#38)');
{
  assert(isletmeAlisSatisTuru('SATIS', { kdvVar: false, text: 'İhracat teslimi' }) === '5', 'ihracat → Tam İstisna (5)');
  assert(isletmeAlisSatisTuru('SATIS', { kdvVar: false, text: 'KDV istisnası uygulanmıştır' }) === '5', 'istisna kelimesi → 5');
  assert(isletmeAlisSatisTuru('SATIS', { kdvVar: false, text: 'kısmi istisna kapsamında' }) === '4', 'kısmi istisna → 4');
  assert(isletmeAlisSatisTuru('SATIS', { kdvVar: false, text: 'nakliye hizmeti' }) === '1', 'ipucu yok → KDV\'siz normal satış (1)');
  assert(isletmeAlisSatisTuru('SATIS', { kdvVar: true, text: 'nakliye' }) === '1', 'KDV var → 1');
  assert(isletmeAlisSatisTuru('SATIS', { tevkifat: true, kdvVar: false }) === '2', 'tevkifat önce (2)');
  assert(isletmeAlisSatisTuru('ALIS', { isReturn: true }) === '2' && isletmeAlisSatisTuru('ALIS', {}) === '1', 'alış: iade 2 / normal 1');
}

console.log('8) Kaynak kilitleri — fatura-muhasebelestirme.service.ts');
{
  const svc = fs.readFileSync(path.join(root, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
  const islDal = svc.slice(svc.indexOf('  async approve(tenantId: string, id: string'), svc.indexOf('// Boş hesap kodu (ör. cari) ile onaylama YASAK'));
  assert(islDal.includes('await this.revalidateDocument(tenantId, id)'), 'approve İŞLETME dalı revalidateDocument çağırıyor (F1)');
  assert(islDal.includes('islOzet.engel && force !== true'), 'approve işletme dalı ENGEL seviyeli uyarıda (force yoksa) reddediyor (F1)');
  assert(islDal.includes('recordInvoiceAccountingMemory(tenantId, { ...(doc as any), ocrData: data.ocrData }'), 'approve işletme dalı öğrenme yazıyor (F1)');
  assert(islDal.includes('doc = await this.get(tenantId, id); // doğrulama sonrası GÜNCEL belge'), 'approve işletme dalı doğrulama sonrası güncel belgeyle devam ediyor (F1)');
  assert(!svc.includes('if (islObj && islObj.userEdited === true && String(islObj.kayitTuruKod'), 'recordInvoiceAccountingMemory işletme dalında userEdited ŞARTI YOK (F1)');
  assert(svc.includes("onayBoost: islObj.userEdited === true ? 2 : 1"), 'işletme öğrenme boost: elle 2 / otomatik 1 (F1)');
  const pim = svc.slice(svc.indexOf('private async pickIsletmeMemory('), svc.indexOf('private rateTokensOf('));
  assert(pim.includes('isletmeKodCoz(kind, d.kategori, d.altKategori)') && pim.includes("kind: 'ALIS' | 'SATIS' = 'ALIS'"), 'pickIsletmeMemory isletmeKodCoz ile ad→kod çözüyor + yön parametresi (F2)');
  assert(!pim.includes("/^\\d+$/.test(String(d.kategori"), 'pickIsletmeMemory salt-kod filtresi kalktı (F2)');
  assert(svc.includes("const ISLETME_ATLANAN = new Set(['BALANCE_MISMATCH', 'TOTAL_MISMATCH'") && svc.includes('isletme: isIsletmeDoc,'), 'runValidation işletmede yevmiye kontrollerini atlıyor (F1)');
  assert(svc.includes('kod: UYARI_KOD.KKEG_SUPHESI') && svc.includes('isletmeKkegTespit(kkegMetin)'), 'revalidate işletme ALIŞ belgesinde KKEG_SUPHESI üretiyor (F6)');
  assert(svc.includes('const islSatisGiderAtla = isIsletme && kind === \'SATIS\'') && svc.includes("GIDER_KATEGORI = new Set(['genel_gider'"), 'işletme SATIŞ belgesine gider kategorisi yazılmıyor (F3)');
  assert(svc.includes('faaliyeti TANIMSIZ — kayıt türünü (mal/hizmet) fatura KALEMLERİNDEN karar ver') && (svc.match(/islFaaliyetBilgisi\(/g) || []).length >= 3, 'faaliyet boşken AI istemine "tanımsız — kalemlerden karar ver" (F3, classify + aiRead)');
  assert(svc.includes('KALEMLERDEN karar ver: nakliye/taşıma/işçilik'), 'islPromptSeg satış kuralı kalemlerden karar (F3)');
  assert((svc.match(/islIncelemeNedeni\(/g) || []).length >= 4, '"İncele" gerekçesi 3 yolda yazılıyor (classify / aiRead / retroaktif) (F5)');
  assert(svc.includes("['AI', 'HAFIZA', 'AJAN'].includes(String(ocr?.isletme?.kaynak"), 'retroaktif kural geçişi AI/HAFIZA/AJAN sınıfını ezmiyor');
  assert((svc.match(/islStopajPlaka\(kind/g) || []).length >= 3, 'stopaj türü + plaka 3 yolda yazılıyor (F7)');
  assert(svc.includes("kaynak: 'AI', neden: String(parsed?.isletmeNeden"), 'resolveIslAi sonucu kaynak=AI damgalı');
  assert(svc.includes('isletmeKodCoz(dir, ktAd, parsed?.isletmeAltTuru)'), 'resolveIslAi AI adını isletmeKodCoz ile doğruluyor (F3)');
  assert(svc.includes('isletmeGiderSinifi({ matrahKategori: ocr?.matrahKategori'), 'guards regresyonunun beklediği retroaktif isletmeGiderSinifi çağrısı duruyor');
}

console.log(failed ? `\n${failed} kilit BAŞARISIZ` : '\nTÜM KİLİTLER GEÇTİ');
process.exit(failed ? 1 : 0);
