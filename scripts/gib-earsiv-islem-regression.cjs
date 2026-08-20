#!/usr/bin/env node
/**
 * GİB e-ARŞİV İŞLEM regresyonu: LİSTELE · SİL · DÜZELT.
 *
 * SÖZLEŞMELER CANLIDAN ÇIKARILDI (2026-08-21, EDELER hesabı, çöp taslaklar):
 *   • Silme: cmd=EARSIV_PORTAL_FATURA_SIL, jp={silinecekler:[TAM SATIR], aciklama}
 *   • Güncelleme komutu YOK (denenen 4 ad da "Bu işlem için yetkiniz yok" döndü)
 *     ⇒ düzeltme = SİL + YENİDEN OLUŞTUR, numara DEĞİŞİR.
 *
 * Bu test, yıkıcı işlemlerin kaza ile çalışmasını engelleyen korumaları kilitler:
 *   1) Açık onay olmadan silme/düzeltme YOK.
 *   2) Belge referansı olmadan "sil" komut SAYILMAZ (yanlış belge silinmesin).
 *   3) İMZALANMIŞ belge silinmez.
 *   4) Silme, GİB'den TEKRAR OKUNARAK doğrulanır.
 *   5) Her yolda güvenli çıkış yapılır.
 *   6) Düzeltmede önce SİL, sonra OLUŞTUR (ters sıra iki belge bırakır).
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const KOMUT = path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes-komut.service.ts');
const SERVIS = path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes-gib.service.ts');
const BOT = path.join(ROOT, 'apps/api/src/whatsapp/whatsapp-bot.controller.ts');
const { FaturaKesKomutService } = require(KOMUT);
const servis = fs.readFileSync(SERVIS, 'utf8');
const bot = fs.readFileSync(BOT, 'utf8');

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

// ---------- 1) NİYET OKUMA ----------
const niyet = (m) => FaturaKesKomutService.gibIslemMi(m);

ok('"faturaları listele" -> LISTELE', niyet('faturaları listele')?.tur === 'LISTELE');
ok('"kesilen faturalar" -> LISTELE', niyet('kesilen faturalar')?.tur === 'LISTELE');
ok('"137 nolu faturayı sil" -> SIL/137',
  niyet('137 nolu faturayı sil')?.tur === 'SIL' && niyet('137 nolu faturayı sil')?.belgeNo === '137');
ok('tam numarayla sil',
  niyet('GIB2026000000138 sil')?.belgeNo === 'GIB2026000000138');
ok('"son faturayı sil" -> SIL/son',
  niyet('son faturayı sil')?.tur === 'SIL' && niyet('son faturayı sil')?.sonMu === true);
ok('REFERANSSIZ "faturayı sil" komut SAYILMAZ', niyet('faturayı sil') === null,
  'hangi belge olduğu belli değilken silme başlatılamaz');
ok('"138 nolu faturayı düzelt tutar 2000" -> DUZELT',
  niyet('138 nolu faturayı düzelt tutar 2000')?.tur === 'DUZELT');
ok('tam numarayla düzelt (botun önerdiği kalıp)',
  niyet('GIB2026000000138 düzelt tutar 2000 kdv 20')?.tur === 'DUZELT');
// BİLEREK REDDEDİLİR: "fatura/belge" geçmeyen çıplak sayı+fiil, başka modülün komutu olabilir.
ok('çıplak "138 düzelt" komut SAYILMAZ', niyet('138 düzelt tutar 2000') === null,
  'fatura demeden verilen sayı+fiil başka modüle ait olabilir');
ok('faturayla ilgisiz cümle komut değil', niyet('bugün hava güzel') === null);
ok('"silah" gibi kelimeler sil sanılmaz', niyet('fatura silahı mı') === null);

// ---------- 2) KESİN ONAY SÖZCÜKLERİ ----------
ok('"evet sil" onaydır', FaturaKesKomutService.evetSilMi('evet sil') === true);
ok('"EVET SİL" onaydır', FaturaKesKomutService.evetSilMi('EVET SİL') === true);
ok('"evet" TEK BAŞINA silmez', FaturaKesKomutService.evetSilMi('evet') === false);
ok('"sil" TEK BAŞINA silmez', FaturaKesKomutService.evetSilMi('sil') === false);
ok('"tamam" silmez', FaturaKesKomutService.evetSilMi('tamam') === false);
ok('"evet düzelt" onaydır', FaturaKesKomutService.evetDuzeltMi('evet düzelt') === true);
ok('silme onayı düzeltmeyi tetiklemez', FaturaKesKomutService.evetDuzeltMi('evet sil') === false);

// ---------- 3) DÜZELTME ALANLARI ----------
const d1 = FaturaKesKomutService.duzeltmeDegisiklikleri('138 düzelt tutar 2.000 kdv 20');
ok('tutar okunur (binlik nokta dahil)', d1.matrah === 2000, `okunan: ${d1.matrah}`);
ok('kdv oranı okunur', d1.kdvOrani === 20);
const d2 = FaturaKesKomutService.duzeltmeDegisiklikleri('138 düzelt kdv 7');
ok('geçersiz KDV oranı ALINMAZ', d2.kdvOrani === undefined, 'uydurma oran faturaya basılamaz');
const d3 = FaturaKesKomutService.duzeltmeDegisiklikleri('138 düzelt açıklama Danışmanlık bedeli');
ok('açıklama okunur', d3.aciklama === 'Danışmanlık bedeli');
ok('belirsiz cümleden alan UYDURULMAZ',
  Object.keys(FaturaKesKomutService.duzeltmeDegisiklikleri('138 düzelt şunu bir bak')).length === 0);

// ---------- 4) SERVİS KORUMALARI ----------
ok('silmede açık onay şartı var', /onay\?\.onay !== true|opts\?\.onay !== true/.test(servis)
  && servis.includes('Silme için açık onay gerekir'));
ok('düzeltmede açık onay şartı var', servis.includes('Düzeltme için açık onay gerekir'));
ok('İMZALANMIŞ belge silinmez', /İMZALANMIŞ fatura SİLİNEMEZ/.test(servis),
  'onaylı fatura resmî belgedir; silinirse kayıt tutarsız kalır');
ok('kesinleşmiş kayıt silinmez', servis.includes('Bu fatura kesinleşmiş — silinemez'));
ok('ETTN yoksa silme yapılmaz', servis.includes("ETTN'i yok"));
ok('belge listede yoksa silme yapılmaz', servis.includes('GİB listesinde bulunamadı — silme YAPILMADI'));
ok('silme TEKRAR OKUNARAK doğrulanır', servis.includes('GİB silme DOĞRULANAMADI'),
  'GİB "sildim" dese de listeden teyit edilmeli');
ok('doğru komut ve gövde kullanılıyor',
  servis.includes("'EARSIV_PORTAL_FATURA_SIL'") && /silinecekler: \[satir\]/.test(servis));
ok('silme her yolda güvenli çıkış yapıyor',
  /gibTaslakSil[\s\S]*?finally \{[\s\S]*?gibLogout/.test(servis));
ok('listeleme her yolda güvenli çıkış yapıyor',
  /gibListe[\s\S]*?finally \{[\s\S]*?gibLogout/.test(servis));

const iSil = servis.indexOf('await this.gibTaslakSil(tenantId, draftId, { onay: true');
const iOlustur = servis.indexOf('const yeni: any = await this.gibeGonder(tenantId, draftId');
ok('düzeltmede ÖNCE sil SONRA oluştur', iSil > 0 && iOlustur > iSil,
  'ters sıra GİB’de iki belge bırakır');
ok('düzeltmede numara değişimi bildiriliyor', servis.includes('numaraDegisti: true'));
ok('düzeltmede KDV/toplam yeniden hesaplanıyor',
  /const kdvTutari = Math\.round\(matrah \* kdvOrani\) \/ 100/.test(servis),
  'tutar değişince eski KDV kalırsa fatura yanlış olur');

// ---------- 5) BOT KORUMALARI ----------
ok('bot: GİB işlemleri fatura KESMEDEN ÖNCE bakılıyor',
  bot.indexOf('maybeHandleGibIslem(ownerTenant, msg, ownerContact?.id)') <
  bot.indexOf('maybeHandleFaturaKes(ownerTenant, msg, ownerContact?.id)'),
  '"faturayı düzelt" cümlesi kesme komutu sanılmamalı');
ok('bot: HTTP webhook kaynaklı yıkıcı işlem reddediliyor',
  /maybeHandleGibIslem[\s\S]*?__kaynak === 'http'[\s\S]*?işlem YAPILMADI/.test(bot));
ok('bot: kuru testte GİB’e dokunulmuyor',
  /maybeHandleGibIslem[\s\S]*?__dryRun[\s\S]*?DOKUNULMADI/.test(bot));
ok('bot: araya başka mesaj girerse onay düşüyor',
  /maybeHandleGibIslem[\s\S]*?onay DÜŞER[\s\S]*?islemiUnut/.test(bot));
ok('bot: düzeltmede numara değişeceği yazılıyor',
  /YENİ NUMARAYLA\* kesilir/.test(bot));

if (hata) process.exit(1);
console.log('[gib-earsiv-islem] OK: silme/düzeltme yalnız açık onayla, imzalı belge korunuyor');
