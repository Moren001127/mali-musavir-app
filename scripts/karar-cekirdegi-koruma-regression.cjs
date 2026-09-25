#!/usr/bin/env node
/**
 * KARAR CEKIRDEGI KORUMA regresyonu — Fatura Merkezi Faz 1 / A parcasi (PLAN/15 denetim sentezi, 2026-09-12).
 *
 * SAHIP KARARI: "hesap silinmez, oneri sunulur; kullanici satiri ezilmez; ogrenilmis kod kategori
 * vetosuyla silinmez, yalniz mevzuat agi."
 *
 * Kilitler (apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts):
 *   A1) KULLANICI korumasi: rematch matrah dongusunde (alis VE satis) kaynak=KULLANICI + planda gecerli yaprak
 *       -> continue (tum alt bloklardan ONCE). applyLearnedVendorCodes de KULLANICI satirina ogrenilmis kod yazmaz.
 *   A2) learnedMatrahCompatibleWithContent = YALNIZ MEVZUAT AGI: alista 6xx, satista 7xx/15x/25x, had-ustu
 *       demirbasta 25x-disi -> red; kelime kategorisi (ticari_mal/hammadde/pazarlama/genel_gider) VETO DEGIL.
 *   A3) Uyum karari (uretVeCachele): matrah satiri NULL'lanmaz; ONERILEN_HESAP ayristirilir; hesap KORUNDU dili;
 *       rematch'te "hesapUyumsuz ise null don" kapisi yok; kor varsayilan blogu KALIR.
 *   A4) Vetolar: _aracBaglamYok AI/ogrenilmis reddi yok -> hesapSuphe; _yagIcerik bakim hesabi yoksa BOSALTMA ->
 *       hesapSuphe; _forceTicariMal + yag->bakim deterministik duzeltmeleri KALIR. revalidate "Hesap supheli" uretir;
 *       uyariEylem hesapSuphe'yi temizler.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'apps', 'api', 'src', 'fatura-muhasebelestirme', 'fatura-muhasebelestirme.service.ts');
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n'); // CRLF dosya — cok satirli kilitler LF ile yazildi

let hata = 0;
function ok(cond, msg) { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); hata++; } }

/** Sinif metodunun kaynak metnini (imza + govde) suslu parantez eslestirerek cikarir. */
function metodGovdesi(ad) {
  const ix = src.indexOf(`private ${ad}(`);
  const ixAsync = src.indexOf(`private async ${ad}(`);
  const start = ix >= 0 ? ix : ixAsync;
  if (start < 0) return '';
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// ── A2: yalniz mevzuat agi ──
const lmc = metodGovdesi('learnedMatrahCompatibleWithContent');
ok(!!lmc, 'learnedMatrahCompatibleWithContent tanimli');
ok(/isSale\?: boolean/.test(lmc), 'imzaya opsiyonel isSale eklendi');
ok(!/ticari_mal|hammadde|pazarlama|genel_gider/.test(lmc), 'fonksiyon govdesinde kelime-kategori vetosu (ticari_mal/hammadde/pazarlama/genel_gider) YOK');
ok(/if \(fixedAsset\) return \/\^25\/\.test\(c\);/.test(lmc), 'mevzuat agi: had-ustu demirbas -> yalniz 25x');
ok(/if \(isSale === true\) return !\/\^\(7\|15\|25\)\/\.test\(c\);/.test(lmc), 'mevzuat agi: satista 7xx/15x/25x red');
ok(/return !\/\^6\/\.test\(c\);/.test(lmc), 'mevzuat agi: alista 6xx red');
ok(src.includes('kat, giderTuru, faDet.is, isSale && !isReturn)'), 'rematch cagrisi yon bilgisini (isSale && !isReturn) geciriyor');
ok(src.includes(', fixedAsset, false)) continue;'), 'applyLearnedVendorCodes cagrisi alis (false) + gercek demirbas tespiti geciriyor');
ok(src.includes("matrahKategori || '').toLowerCase().trim() === 'demirbas')) continue;") === false, 'applyLearnedVendorCodes artik AI kategorisini fixedAsset diye gecirmiyor');
ok((src.match(/this\.kategoriKodUyumluMu\(/g) || []).length >= 2 && /this\.logger\.debug\(`\[HAFIZA\]/.test(src), 'kategori uyusmazligi yalniz logger.debug (iki cagri yeri)');

// Saf mantik testi: metodu TS'ten JS'e cevirip calistir.
function metodYukle(ad) {
  const kod = metodGovdesi(ad).replace(/^\s*private\s+/, '');
  const js = ts.transpileModule(`class X { ${kod} }\nmodule.exports = X;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console }, { filename: ad + '.js' });
  return new mod.exports();
}
try {
  const x = metodYukle('learnedMatrahCompatibleWithContent');
  const f = (code, kat, gt, fa, sale) => x.learnedMatrahCompatibleWithContent(code, kat, gt, fa, sale);
  ok(f('153.01.001', 'genel_gider', 'kirtasiye', false, false) === true, 'ALIS: ogrenilmis 153 + kategori genel_gider -> UYUMLU (eski veto kalkti)');
  ok(f('770.01.003', 'ticari_mal', '', false, false) === true, 'ALIS: ogrenilmis 770 + kategori ticari_mal -> UYUMLU (eski veto kalkti)');
  ok(f('740.01.002', 'hammadde', 'motor yagi', false, false) === true, 'ALIS: ogrenilmis 740 + kategori hammadde -> UYUMLU');
  ok(f('632.01.001', 'genel_gider', '', false, false) === false, 'ALIS: 6xx (632 yansitma) -> RED (mevzuat)');
  ok(f('600.01.001', '', '', false, false) === false, 'ALIS: 600 gelir -> RED (mevzuat)');
  ok(f('770.01.001', 'genel_gider', '', true, false) === false, 'ALIS had-ustu demirbas: 770 -> RED (yalniz 25x)');
  ok(f('255.01.004', 'genel_gider', '', true, false) === true, 'ALIS had-ustu demirbas: 255 -> UYUMLU');
  ok(f('600.01.002', '', '', false, true) === true, 'SATIS: 600 -> UYUMLU');
  ok(f('649.01.001', '', '', false, true) === true, 'SATIS: 649 diger gelir -> UYUMLU');
  ok(f('770.01.001', '', '', false, true) === false, 'SATIS: 770 gider -> RED (mevzuat)');
  ok(f('153.01.001', '', '', false, true) === false, 'SATIS: 153 stok -> RED (mevzuat)');
  ok(f('255.01.001', '', '', true, true) === true, 'SATIS demirbas cikisi: 255 -> UYUMLU');
  ok(f('', 'genel_gider', '', false, false) === false, 'bos kod -> RED');
  const y = metodYukle('kategoriKodUyumluMu');
  ok(y.kategoriKodUyumluMu('770.01.001', 'ticari_mal') === false && y.kategoriKodUyumluMu('153.01.001', 'ticari_mal') === true, 'kategoriKodUyumluMu yalnizca teshis amacli dogru calisiyor');
} catch (e) { ok(false, `metod yukleme/transpile hatasi: ${e && e.message}`); }

// ── A1: KULLANICI korumasi ──
ok(src.includes("if (group === 'matrah' && String(line.kaynak || '').toUpperCase() === 'KULLANICI' && isPostableLeaf(String(line.accountCode || '').trim())) {\n          continue;\n        }"),
  'rematch matrah dongusunde KULLANICI + gecerli yaprak -> continue kapisi var');
{
  const kapi = src.indexOf("if (group === 'matrah' && String(line.kaynak || '').toUpperCase() === 'KULLANICI' && isPostableLeaf(");
  const iade = src.indexOf("if (isReturn && (group === 'matrah' || group === 'vergi' || group === 'tevkifat')) {");
  const kardes = src.indexOf('const _tevkifatKardesi = (acc: any, istenenTevkifat: boolean) =>');
  const saleFix = src.indexOf("if (group === 'matrah' && isSale && saleMatrahDefault) {");
  const alisKapi = src.indexOf("if (group === 'matrah' && !isSale && current) {");
  const placeholder = src.indexOf('const isPlaceholder =');
  ok(kapi > 0 && iade > kapi && saleFix > kapi && alisKapi > kapi && placeholder > kapi, 'KULLANICI kapisi iade/saleMatrahDefault/alis giderTuru/isPlaceholder bloklarindan ONCE');
  ok(kardes > 0 && kardes < kapi, 'tevkifat kardes gecisi matrahForRate icinde (satir dongusunden once) — kapi satiri ezmez');
}
const alvc = metodGovdesi('applyLearnedVendorCodes');
ok(alvc.includes("if (String(l.kaynak || '').toUpperCase() === 'KULLANICI' && cur && (!planCodes || planCodes.has(cur))) continue;"), 'applyLearnedVendorCodes: KULLANICI satirina ogrenilmis kod yazilmaz');
ok(alvc.includes('kaynak: true'), 'applyLearnedVendorCodes satir secimi kaynak alanini okuyor');
ok(alvc.includes("this.detectFixedAsset(doc.ocrData, tpRow, 'ALIS')") && alvc.includes('this.demirbasHaddiAltinda('), 'applyLearnedVendorCodes had-ustu demirbas tespitini (icerik+faaliyet+had) kullaniyor');

// ── A3: uyum karari hesap silmez ──
const grn = (() => { const s = src.indexOf('async generateRichMuhasebeNeden('); const e = src.indexOf('private async aiPickGiderAccount(', s); return src.slice(s, e); })();
ok(!!grn && grn.length > 1000, 'generateRichMuhasebeNeden bulundu');
ok(!/updateMany\(\{ where: \{ documentId: doc\.id, group: 'matrah' \}, data: \{ accountCode: null \} \}\)/.test(grn), 'uretVeCachele matrah satirini NULL\'lamiyor (updateMany accountCode:null yok)');
ok(!/accountCode: null/.test(grn), 'generateRichMuhasebeNeden icinde hicbir accountCode:null yazimi yok');
ok(grn.includes("'ONERILEN_HESAP: <"), 'prompt ONERILEN_HESAP satiri istiyor');
ok(grn.includes('ADAY LİSTESİ:') && grn.includes('...oneriAdaylari'), 'prompt yon filtreli aday listesi (kod = ad) veriyor');
ok(/const oneriYonRe = isReturn \? \(isSale \? \/\^\(15\|25\|7\)\/ : \/\^\(61\|60\)\/\) : \(isSale \? \/\^\(60\|64\|67\)\/ : \/\^\(15\|25\|7\)\/\);/.test(grn), 'aday yon filtresi: alista 15x/25x/7xx, satista 60x/64x/67x');
// 2026-09-25: BAYAT SINAMA DÜZELTİLDİ. Bu kontrol '.slice(0, 80)' arıyordu ama aday sınırı bilinçli
//   olarak 40'a indirilmişti (kaynaktaki yorum: "en çok 40 aday → yorum çağrısı ~%25 küçülür, öneri
//   kalitesi korunur"). Yani koruma kaybolmamış, sayı değişmiş; test güncellenmediği için zincirde
//   KIRIK duruyordu ve fark edilmiyordu (pre-commit bu zinciri koşmuyor). Sınır yine değişirse burası
//   da güncellenmeli — bu kontrol metin tabanlıdır, çünkü sınır prompt üretiminin içine gömülü.
ok(grn.includes('.slice(0, 40)'), 'aday listesi en cok 40 (maliyet siniri)');
ok(/rawText\.match\(\/ONERILEN_HESAP\\s\*:\?\\s\*\(\[0-9\]\[0-9\.\]\*\|YOK\)\/i\)/.test(grn), 'ONERILEN_HESAP yanittan ayristiriliyor');
ok(grn.includes('planYaprakMi(oneriHam) && oneriYonRe.test(oneriHam) && !mevcutMatrahKodlari.has(oneriHam)'), 'oneri planda gecerli yaprak + yon + mevcut hesaptan farkli olmali');
ok(grn.includes('onerilenHesap: uyumsuz ? onerilen : null,'), 'ocrData.onerilenHesap yaziliyor');
ok(grn.includes("hesapUyumNot: uyumsuz ? 'Fatura içeriği ana faaliyet/hesapla uyuşmuyor — hesap KORUNDU; öneriyi uygulayın ya da editörde düzeltin.' : null,"), 'hesapUyumNot "hesap KORUNDU" dilinde');
ok(grn.includes('hesapUyumKod: uyumsuz ?'), 'yargilanan kod (hesapUyumKod) saklaniyor (bayat uyari korumasi)');
{
  // Yalniz URETIM yolu (uretVeCachele): eski kapanis metni artik uretilmez. ("hesap bos" dalindaki ESKI metni
  //   yeni dile ceviren regex, bu ifadeyi kalip olarak icerir — o kasitli, uretim degil.)
  const uvc = grn.slice(grn.indexOf('const uretVeCachele = async'), grn.indexOf('return { text: finalText, denetim };'));
  ok(uvc.length > 500 && !uvc.includes('OTOMATİK HESAP ATANMADI') && !uvc.includes('otomatik hesap atanmadı'), 'uretVeCachele eski "OTOMATIK HESAP ATANMADI" kapanisini uretmiyor');
  ok(grn.includes('uyum kararı hesabı silmez — bu belgede hesap boş'), '"hesap bos" dali da hesap-silinmez diline cevrildi');
}
ok(grn.includes('yalnız KORUNDU — önerilen hesap: ${onerilen}'), 'UYUMSUZ kapanisi "hesap korundu, oneri: X"');
ok(grn.includes('await this.revalidateDocument(tenantId, doc.id).catch(() => null);'), 'uretVeCachele sonunda revalidateDocument cagriliyor (uyari uretilsin)');
ok(src.includes(".replace(/^\\s*ONERILEN_HESAP\\s*:.*$/gim, '')"), 'cleanRichMuhasebeNeden ONERILEN_HESAP satirini kullaniciya gostermiyor');
ok(!src.includes("if (!m && (doc.ocrData as any)?.hesapUyumsuz === true) { matrahCache.set(rate, null); return null; }"), 'rematch: hesapUyumsuz ise null don kapisi KALDIRILDI');
ok(src.includes("if (!m && (doc.ocrData as any)?.hesapUyumsuz !== true) { m = leafOnly(saleMatrahDefault); if (m) mKaynak = 'VARSAYILAN'; }"), 'rematch: kor varsayilan blogu KALIYOR');
ok(src.includes("if (!matchCode && (doc.ocrData as any)?.hesapUyumsuz === true && isPostableLeaf(current)) continue;"), 'rematch alis kapisi: uyumsuz belgede alternatif yoksa gecerli mevcut kod bosaltilmaz');
ok(src.includes("if (group === 'matrah' && (doc.ocrData as any)?.hesapUyumsuz === true && isPostableLeaf(current)) continue;"), 'rematch placeholder dali: uyumsuz belgede gecerli mevcut kod bosaltilmaz');

// ── A4: vetolar -> hesapSuphe ──
ok(!src.includes("(_aracBaglamYok && _aracHesapAdRe.test(_af(String((_aiCand as any).accountName || ''))))"), '_aracBaglamYok AI aday reddi KALDIRILDI');
ok(!src.includes("if (m && _aracBaglamYok && _aracHesapAdRe.test(_af(String((m as any).accountName || '')))) {\n          m = null;"), '_aracBaglamYok ogrenilmis kod reddi KALDIRILDI');
ok((src.match(/_hesapSuphe = \{ neden: 'arac-baglam-yok'/g) || []).length >= 2, 'arac-baglam-yok -> hesapSuphe (ogrenilmis + AI secimi)');
ok(src.includes("_hesapSuphe = { neden: 'yag-bakim-hesabi-yok', kod: String((m as any).accountCode || ''), not: 'Motor yağı içeriği; planda araç bakım/onarım hesabı yok' };"), 'yag icerigi + bakim hesabi yok -> hesap korunur + hesapSuphe');
ok(!/m = bakim \? leafOnly\(bakim\) : null;/.test(src), 'yag->yakit SON GUVENLIK artik hesabi BOSALTMIYOR');
ok(src.includes("(_forceTicariMal && /^7/.test(String((_aiCand as any).accountCode || '')))"), '_forceTicariMal deterministik 153 duzeltmesi KALIYOR');
ok(src.includes("(_yagIcerik && !!_bakimAcc && _isYakitHesapAd(String((_aiCand as any).accountName || '')))"), 'yag->bakim deterministik duzeltmesi (bakim varsa) KALIYOR');
ok(src.includes('if (_hesapSuphe) ocrYeni.hesapSuphe = _hesapSuphe; else delete ocrYeni.hesapSuphe;'), 'rematch belge guncellemesi hesapSuphe yaziyor / temizliyor');
ok(src.includes('const supheDegisti = JSON.stringify(prevSuphe) !== JSON.stringify(_hesapSuphe);'), 'hesapSuphe her turda yeniden hesaplanip degisim kontrol ediliyor');
// revalidate uyarisi
const rv = (() => { const s = src.indexOf('async revalidateDocument('); return src.slice(s, s + 120000); })();
ok(rv.includes("const suphe: any = ocrData?.hesapSuphe && typeof ocrData.hesapSuphe === 'object' ? ocrData.hesapSuphe : null;"), 'revalidate hesapSuphe okuyor');
ok(rv.includes("baslik: uyumsuzGecerli ? 'İçerik ↔ hesap uyumsuz' : `Hesap şüpheli: ${supheNot}`,"), 'revalidate "Hesap supheli: <not>" basligi (seviye uyari) uretiyor');
ok(rv.includes("seviye: 'uyari',\n            baslik: uyumsuzGecerli"), 'ICERIK_HESAP_UYUMSUZ seviyesi uyari');
ok(rv.includes("eylemler: onerilenFarkli ? [{ id: 'oneriyi-uygula', etiket: 'Öneriyi uygula' }] : undefined,"), 'onerilenHesap varsa "Oneriyi uygula" eylemi');
ok(rv.includes("const uyumsuzGecerli = ocrData?.hesapUyumsuz === true && (!uyumKod || matrahKodlari.has(uyumKod));"), 'yargilanan kod matrahta yoksa (kullanici degistirdi) uyari uretilmez');
ok((rv.match(/UYARI_KOD\.ICERIK_HESAP_UYUMSUZ/g) || []).length === 1, 'tek ICERIK_HESAP_UYUMSUZ uretimi (kod cogaltilmadi)');
// uyariEylem
const ue = (() => { const s = src.indexOf('async uyariEylem('); return src.slice(s, s + 4000); })();
ok(ue.includes('hesapSuphe: null') && ue.includes('onerilenHesap: null') && ue.includes('hesapUyumKod: null'), 'uyariEylem "oneriyi-uygula" hesapSuphe/onerilenHesap/hesapUyumKod temizliyor');
ok(ue.includes("kaynak: 'KULLANICI'"), 'uyariEylem uygulanan oneri KULLANICI kaynakli (rematch korur)');

if (hata) { console.error(`[karar-cekirdegi-koruma-regression] ${hata} kilit KIRIK`); process.exit(1); }
console.log('[karar-cekirdegi-koruma-regression] OK: hesap silinmez + kullanici satiri ezilmez + ogrenilmis kod yalniz mevzuat agi + vetolar supheye donustu');
