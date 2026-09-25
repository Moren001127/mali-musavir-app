/**
 * LUCA DENETIMI — 7 KRITIK BULGU nobeti (2026-09-25).
 *
 * Hepsi SESSIZ hatalardi: ekranda "basarili" gorunurken veri bozuluyor ya da eksik kaliyordu.
 * Bu sinama her birinin duzeltmesinin YERINDE durdugunu dogrular; biri geri alinirsa kirmizi yanar.
 *
 * 1. Mihsap'a ikinci yukleme ayni faturayi tekrar yukluyordu → mukellefin defterine CIFT GIDER
 * 2. Ayni belge no'lu iki fatura ayni dosya anahtarini paylasiyordu → goruntu uzerine yaziliyor
 * 3. Mizan cekilmeden ONCE siliniyordu → cekim patlayinca eski veri gidiyor, geri gelmiyor
 * 4. Isletme fis kesmede dogrulanamayan commit FAILED + "tekrar dene" aciyordu → CIFT FIS
 *    (Bilanco yolunda bu koruma vardi, Isletme'de yoktu)
 * 5. Luca listesinin 1. sayfasi disi cekilmiyordu ve mutabakat sayaci bunu YAKALAMIYORDU
 * 6. "Tamamlandi" isinde eksik uyarisi ekranda HIC gorunmuyordu (15 sn sonra gunluk siliniyor)
 * 7. Gercek ayristirma hatasi ekranda "Fatura yok" diye gorunuyordu → kullanici tekrar cekmiyor
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

let gecen = 0;
const ok = (kosul, ad) => { assert.ok(kosul, ad); gecen++; };
const oku = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const earsiv = oku('apps/api/src/earsiv/earsiv.service.ts');
const mizan = oku('apps/api/src/mizan/mizan.service.ts');
const rt = oku('apps/api/public/agent-runtime.js');
const web = oku('apps/web/src/app/(panel)/panel/e-arsiv/page.tsx');

// ── 1) Mihsap cift yukleme kapisi ────────────────────────────────
ok(/mihsapUploadStatus === 'uploaded'/.test(earsiv),
  '1a) zaten yuklenmis fatura ATLANIR (cift gider kapisi)');
ok(/markMihsapStatus\([^)]*\): Promise<boolean>/.test(earsiv),
  '1b) durum yazimi basari/basarisiz DONER (eskiden hata yutuluyordu)');
ok(/const isaretlendi = await this\.markMihsapStatus/.test(earsiv),
  '1c) cagiran durum yazimini KONTROL EDER');
ok(/tekrar göndermeyin, çift gider olur/.test(earsiv),
  '1d) isaret yazilamazsa kullaniciya SOYLENIR (tekrar gonderme uyarisi)');

// ── 2) Dosya anahtari ayirici ────────────────────────────────────
ok(/private kimlikEki\(/.test(earsiv), '2a) kimlikEki yardimcisi var');
ok(/\$\{this\.safeFilePart\(opts\.faturaNo\)\}\$\{this\.kimlikEki\(opts\)\}\.pdf/.test(earsiv),
  '2b) PDF anahtari satici/ETTN ayiricisi TASIR');
ok(/\$\{this\.safeFilePart\(opts\.faturaNo\)\}\$\{this\.kimlikEki\(opts\)\}\.html/.test(earsiv),
  '2c) HTML anahtari satici/ETTN ayiricisi TASIR');
ok((earsiv.match(/saticiVergiNo: f\.saticiVergiNo,/g) || []).length >= 4,
  '2d) dort saklama cagrisina da satici bilgisi geciliyor');

// ── 3) Mizan: ONCE CEK, SONRA SIL ────────────────────────────────
{
  const iCek = mizan.indexOf('fetchMizanExcel');
  const iSil = mizan.indexOf('mizan.delete({ where: { id: existing.id } })');
  ok(iCek > 0 && iSil > 0, '3a) hem cekme hem silme kodu duruyor');
  ok(iCek < iSil, '3b) CEKME silmeden ONCE gelir (eski sira tersiydi: once sil sonra cek)');
  ok(/Mevcut mizan korundu, silinmedi/.test(mizan),
    '3c) cekim patlayinca kullaniciya "eski mizan korundu" denir');
}

// ── 4) Isletme fis kesmede CIFT FIS kapisi ───────────────────────
ok(!/throw new Error\(`İşletme Fiş Kes doğrulanamadı/.test(rt),
  '4a) Isletme yolunda doğrulanamayan commit artik THROW ETMEZ (tekrar-dene acilmiyor)');
ok(/fisBasari: !!ok/.test(rt),
  '4b) Isletme yolu da /done + fisBasari gonderir (Bilanco ile ayni)');
ok(/TEKRAR GÖNDERMEYİN \(çift fiş riski\)/.test(rt),
  '4c) kullaniciya "tekrar gondermeyin" uyarisi yazilir');

// ── 5) Sayfalama mutabakati ──────────────────────────────────────
ok(rt.includes('adet') && rt.includes('bulundu') && /parseInt\(bt\[1\], 10\)/.test(rt),
  '5a) Lucanin TOPLAM fatura sayisi okunuyor');
ok(/lucaToplam > secimSayisi/.test(rt),
  '5b) toplam > tablodaki ise TOPLAM bildirilir (eksik kontrolu tetiklensin)');
ok(/sunucuda UYARI üretecek/.test(rt),
  '5c) eksik kalan faturalar icin uyari mesaji var');

// ── 6) "Tamamlandi" isinde eksik uyarisi gorunur ─────────────────
ok(/const eksikler: string\[\] = \[\]/.test(web), '6a) eksik uyarilari toplaniyor');
ok(/eksikler\.length \? `  ⚠ \$\{eksikler\.join/.test(web),
  '6b) ozet satirinda gosteriliyor');
ok(/\/⚠\/\.test\(onceki\) \? onceki : ''/.test(web),
  '6c) 15 sn\'lik temizlik uyariyi SILMEZ');
ok(/status === 'done' && eksikUyarisi/.test(web),
  '6d) tamamlanan is satirinda da uyari gorunur');

// ── 7) Bozuk arsiv "fatura yok" degildir ─────────────────────────
ok(/ZIP_BOZUK/.test(earsiv), '7a) sunucu ayirt edici isaret uretir');
ok(/xmlSayisi > 0/.test(earsiv), '7b) ZIP\'te XML varsa AYRISTIRMA HATASI sayilir');
{
  const iZip = web.indexOf('ZIP_BOZUK');
  const iFatura = web.indexOf('Fatura yok: bu dönem için kayıtlı fatura bulunamadı');
  ok(iZip > 0 && iFatura > 0 && iZip < iFatura,
    '7c) ZIP_BOZUK kontrolu "fatura yok" kalibindan ONCE gelir');
}
ok(/!\/ZIP_BOZUK\/i\.test\(errorLog\)/.test(web),
  '7d) bozuk arsiv "fatura yok" SAYILMAZ (sayacta da degil)');

console.log(`[luca-kritik-7-regression] ${gecen} assertion — HEPSI GECTI`);
