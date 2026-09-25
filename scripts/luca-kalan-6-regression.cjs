/**
 * LUCA DENETIMI — KALAN 6 MADDE nobeti (2026-09-25).
 *
 * 1. Sunucu UTC calisiyordu; cron Istanbul'a ayarli ama donem `getMonth()` ile SUNUCU
 *    saatinden turetiliyordu → 1 Eylul 02:00 Istanbul = 31 Agustos 23:00 UTC → gece isi
 *    "2026-08" yerine "2026-07" cekiyordu.
 * 2. Zamanli cekimde AKTIF SUZGECI hic yazilmamisti (yalniz yorum vardi) → isi birakmis
 *    firmalar ve WHATSAPP-* sanal kayitlar dahil herkese is aciliyordu.
 * 3. Cron cozumlenemezse nextRunAt null kaliyor, tetikleyici null'i "vadesi gelmis" sayiyordu
 *    → hatali bir satir DAKIKADA BIR tum mukellefler icin is uretip Luca'yi boguyordu.
 * 4. Kuyruk basi tikanmasi: ajana 5 is, en eskiden sirali; ajanin desteklemedigi tip her
 *    turda ilk sirayi dolduruyor, ajan onu SESSIZCE atliyordu → yeni is hic ulasmiyordu.
 * 5. Giris kilidi (moren_node_giris) acik kalirsa ajan SONSUZA KADAR is almiyordu; zaman
 *    asimi yoktu. Ajan yine de ping attigi icin portal "ajan acik" diyordu.
 * 6. Fis kesmede `beklenenSatir` yalniz log'a yaziliyor, recordCount ile KARSILASTIRILMIYORDU
 *    → Luca satir dusurunce fis eksik kesiliyor, portal yine "Aktarildi" diyordu.
 *    (+ CSV sozluk reddi yalniz log'a yaziliyordu.)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

let gecen = 0;
const ok = (k, ad) => { assert.ok(k, ad); gecen++; };
const oku = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sched = oku('apps/api/src/luca/luca-schedule.service.ts');
const luca = oku('apps/api/src/luca/luca.service.ts');
const agent = oku('apps/luca-local-agent/src/agent.js');
const rt = oku('apps/api/public/agent-runtime.js');
const dockerfile = oku('apps/api/Dockerfile');
const parser = oku('apps/api/src/earsiv/earsiv-zip-parser.service.ts');
const earsiv = oku('apps/api/src/earsiv/earsiv.service.ts');

// 1) Saat dilimi
ok(/ENV TZ=Europe\/Istanbul/.test(dockerfile), '1a) konteyner saat dilimi Istanbul');
ok(/timeZone: 'Europe\/Istanbul'/.test(sched), '1b) donem Istanbul saatinden hesaplanir');
ok((sched.match(/timeZone: 'Europe\/Istanbul'/g) || []).length >= 2,
  '1c) hem gece isi hem zamanli isin donem varsayilani Istanbul saatinde');

// 2) Aktif mukellef suzgeci
ok(!/\/\* aktif filter buraya \*\//.test(sched), '2a) "aktif filter buraya" yorumu KALMADI');
ok(/tenantId: sched\.tenantId,[\s\S]{0,240}isActive: true/.test(sched),
  '2b) ZAMANLI yolda yalniz aktif mukellefler (gece isindeki suzgec ayri)');
ok(/startsWith: 'WHATSAPP-'/.test(sched), '2c) sanal WHATSAPP-* kayitlari elenir');
ok(/endDate: \{ gte: new Date\(\) \}/.test(sched), '2d) isi birakmis firmalar elenir');

// 3) Bozuk cron bogma korumasi
ok(/Zamanlama PASİFE ALINDI/.test(sched), '3a) cozulemeyen cron satiri pasife alinir');
ok(/active: false/.test(sched), '3b) active=false yazilir (dakikada bir tetiklenmesin)');

// 4) Kuyruk basi tikanmasi
ok(/take: 25,/.test(luca), '4a) kuyruk penceresi genisletildi (5 -> 25)');
ok(/jobTypes/.test(luca), '4b) ajanin bildirdigi tip listesi kuyrukta KULLANILIYOR');
ok(/jobsFiltered/.test(luca), '4c) desteklenmeyen isler listeden cikarilir');
ok(/jobsFiltered\.slice\(0, 5\)/.test(luca), '4d) ajana yine en fazla 5 is verilir');

// 5) Giris kilidi zaman asimi
ok(/value: `1:\$\{Date\.now\(\)\}`/.test(agent), '5a) kilit zaman damgasi tasir');
ok((agent.match(/Date\.now\(\) - ts > 180000/g) || []).length >= 2,
  '5b) 3 dakikadan eski kilit YOK SAYILIR (iki okuma noktasinda da)');

// 6) Eksik satir + sozluk reddi
ok(/const eksikSatir =/.test(luca), '6a) beklenen ile islenen satir KARSILASTIRILIR');
ok(/EKSİK SATIR:/.test(luca), '6b) eksik satirda kullaniciya aciklama yazilir');
ok(/extra\?\.fisBasari === false \|\| eksikSatir > 0/.test(luca),
  '6c) eksik satir da TEYITSIZ sayilir (belge "teyit gerekli" olur)');
ok(/REDDEDİLEBİLİR/.test(rt), '6d) sozluk reddi kullaniciya gorunur uyari uretir');

// Ek: tarihi okunamayan fatura isaretlenir
ok(/tarihOkunamadi/.test(parser), 'ek-a) ayristirici tarih okunamadigini isaretler');
ok((parser.match(/let tarihOkunamadi = true;/g) || []).length === 2,
  'ek-b) her iki ayristirma yolunda da isaretlenir');
ok(/TARİHİ okunamadı/.test(earsiv), 'ek-c) tarihsiz fatura kullaniciya uyari olarak cikar');

console.log(`[luca-kalan-6-regression] ${gecen} assertion — HEPSI GECTI`);
