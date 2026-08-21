#!/usr/bin/env node
/**
 * luca-operator-routing-regression.cjs
 *
 * 2026-08-21 — LUCA OPERATÖRÜ "ayrı tarayıcı" kurulumunun KORUMA testi.
 *
 * Kural (kullanıcı kararı 2026-08-21):
 *   - Operatör komutları (EKRAN_OKU / LUCA_ACTION) kullanıcının bilgisayarında,
 *     KENDİ Chrome profilinden AYRI açılan bir pencerede çalışır.
 *   - Veri çekme işleri sunucudaki ajanda kalır. İki taraf birbirinin işini ALMAZ.
 *   - Operatör tarayıcısı kapalıysa eski yol (Chrome uzantısı) çalışmaya devam eder.
 *
 * Bu davranış kazara geri alınırsa commit'i keser.
 * Bypass: MOREN_UNLOCK=1 (geçici).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

const fails = [];
const need = (cond, msg) => { if (!cond) fails.push(msg); };

// ─── 1) Sunucu: iş yönlendirme ───────────────────────────────────────────────
const SVC = 'apps/api/src/luca/luca.service.ts';
const svc = read(SVC);
if (!svc) {
  fails.push(`${SVC} bulunamadı`);
} else {
  need(/-operator\$\/i\.test\(id\)\)\s*return\s*'operator'/.test(svc),
    `${SVC}: '-operator' ile biten cihaz artık ayrı ajan türü sayılmıyor (agentKindForDeviceId).`);
  need(/private async findOnlineOperatorDevice\s*\(/.test(svc),
    `${SVC}: findOnlineOperatorDevice() kaldırılmış — çevrimiçi operatör tarayıcısı bulunamaz.`);
  need(/endsWith:\s*'-operator'/.test(svc),
    `${SVC}: operatör cihazı araması (deviceId endsWith '-operator') bozulmuş.`);
  // Hem ekran okuma hem işlem işi operatöre yönlensin; operatör yoksa eski yola düşsün.
  const fallbackCount = (svc.match(/preferredAgent:\s*operatorDeviceId\s*\?\s*'operator'\s*:\s*'browser-ext'/g) || []).length;
  need(fallbackCount === 2,
    `${SVC}: EKRAN_OKU + LUCA_ACTION işlerinin operatör yönlendirmesi eksik (beklenen 2, bulunan ${fallbackCount}).`);
  need(/async getOperatorDeviceStatus\s*\(/.test(svc),
    `${SVC}: getOperatorDeviceStatus() kaldırılmış — panel/beyin operatörün açık olup olmadığını göremez.`);
}

// ─── 2) Operatör beyni: soğuk açılış süresi ──────────────────────────────────
const OPS = 'apps/api/src/calisan/luca-operator.service.ts';
const ops = read(OPS);
if (!ops) {
  fails.push(`${OPS} bulunamadı`);
} else {
  const m = ops.match(/const OPERATOR_JOB_TIMEOUT_MS\s*=\s*(\d+)/);
  need(!!m, `${OPS}: OPERATOR_JOB_TIMEOUT_MS kaldırılmış.`);
  need(m && Number(m[1]) >= 60000,
    `${OPS}: operatör bekleme süresi 60 sn altına düşürülmüş — ayrı tarayıcının soğuk açılışı (pencere + Luca girişi) sığmaz.`);
  need(!/Date\.now\(\)\s*\+\s*25000/.test(ops),
    `${OPS}: eski 25 sn'lik sabit bekleme geri gelmiş.`);
}

// ─── 3) Yerel ajan: operatör modu ────────────────────────────────────────────
const AG = 'apps/luca-local-agent/src/agent.js';
const ag = read(AG);
if (!ag) {
  fails.push(`${AG} bulunamadı`);
} else {
  need(/const OPERATOR_MODE\s*=/.test(ag),
    `${AG}: OPERATOR_MODE bayrağı kaldırılmış (worker.role="operator").`);
  need(/\$\{RAW_DEVICE_ID\}-operator/.test(ag),
    `${AG}: operatör cihaz adına '-operator' eki eklenmiyor → sunucu işi doğru cihaza yollayamaz.`);
  need(/'\.browser-data-operator'/.test(ag),
    `${AG}: operatör ayrı Chrome profili kullanmıyor (kullanıcının günlük tarayıcısına karışır).`);
  need(/'\.agent\.lock-operator'/.test(ag),
    `${AG}: operatör ayrı kilit dosyası kullanmıyor → mevcut veri çekme ajanıyla çakışır.`);
  need(/const OPERATOR_JOB_TYPES\s*=\s*Object\.freeze\(\['EKRAN_OKU',\s*'LUCA_ACTION'\]\)/.test(ag),
    `${AG}: operatör iş tipleri listesi bozulmuş.`);
  need(/const defaultJobTypes\s*=\s*SUPPORTED_JOB_TYPES\.filter\(\(t\)\s*=>\s*!OPERATOR_JOB_TYPES\.includes\(t\)\)/.test(ag),
    `${AG}: normal (veri çekme) ajanı artık operatör işlerini de alabiliyor — komut yanlış bilgisayarda çalışır.`);
  need(/OPERATOR_MODE\s*\?\s*false\s*:\s*cfg\.worker\?\.headless === true/.test(ag),
    `${AG}: operatör penceresi görünür olmaktan çıkmış (kullanıcı ne yaptığını izleyemez).`);
  need(/if \(!OPERATOR_MODE\) schedulePreWarm\(\);/.test(ag),
    `${AG}: operatör modunda ön ısıtma kapalı değil — ajan başlar başlamaz boş pencere açar.`);
  need(/process\.env\.MOREN_LUCA_CONFIG/.test(ag),
    `${AG}: MOREN_LUCA_CONFIG desteği kaldırılmış — aynı klasörden ikinci (operatör) örnek çalışmaz.`);
}

// ─── Sonuç ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('\n✗ Luca operatör yönlendirme koruması BOZULMUŞ:\n');
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\nBypass (geçici): MOREN_UNLOCK=1 git commit ...\n');
  process.exit(1);
}
console.log('✓ Luca operatör yönlendirmesi sağlam (ayrı tarayıcı, ayrı profil, iş ayrımı)');
