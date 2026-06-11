#!/usr/bin/env node
/**
 * luca-isolation-regression.cjs
 *
 * 2026-06-11 — "Luca izolasyon + susturma + otomatik giriş" paketinin
 * KORUMA testi. Bu davranışlar kazara geri alınırsa commit'i keser.
 *
 * Kontrol eder:
 *  1. agent-runtime.js — eklenti Luca'da SESSİZ kapısı (lucaSilencedInBrowserExt)
 *     tanımlı VE 3 kritik yerde uygulanmış (syncLucaSession, processLucaJobs, panel).
 *  2. luca-local-agent/src/agent.js — Luca otomatik girişi captcha akışı
 *     (girisbtn + #captcha-input + 2captcha) yerinde.
 *  3. start-agent.ps1 — ayrı tarayıcıyı küçük/kilitli tutan pencere gözcüsünü
 *     başlatıyor + gözcü dosyası var.
 *
 * Bypass: MOREN_UNLOCK=1 (geçici).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
};

const fails = [];
const need = (cond, msg) => { if (!cond) fails.push(msg); };

// 1) Runtime: eklenti Luca'da sessiz
const RT = 'apps/api/public/agent-runtime.js';
const rt = read(RT);
if (!rt) {
  fails.push(`${RT} bulunamadı`);
} else {
  need(/function lucaSilencedInBrowserExt\s*\(/.test(rt),
    `${RT}: lucaSilencedInBrowserExt() tanımı kaldırılmış (eklenti Luca'da susturma kapısı).`);
  need(/\^DEV-/.test(rt) && /__morenLucaExtEnable/.test(rt),
    `${RT}: susturma kapısının DEV-* / __morenLucaExtEnable mantığı bozulmuş.`);
  // En az 3 kullanım: syncLucaSession + processLucaJobs + panel guard
  const uses = (rt.match(/lucaSilencedInBrowserExt\(\)/g) || []).length;
  need(uses >= 3,
    `${RT}: lucaSilencedInBrowserExt() kullanımı 3'ten az (${uses}). Sync/process/panel kapıları korunmalı.`);
  need(/window === window\.top && !lucaSilencedInBrowserExt\(\)/.test(rt),
    `${RT}: durum paneli Luca'da gizleme kapısı (panel guard) kaldırılmış.`);
}

// 2) Local agent: Luca otomatik giriş captcha akışı
const AG = 'apps/luca-local-agent/src/agent.js';
const ag = read(AG);
if (!ag) {
  fails.push(`${AG} bulunamadı`);
} else {
  need(/girisbtn/.test(ag),
    `${AG}: Luca GİRİŞ tetikleyicisi (girisbtn) kaldırılmış.`);
  need(/#captcha-input/.test(ag),
    `${AG}: captcha input (#captcha-input) akışı kaldırılmış.`);
  need(/regsense/.test(ag) && /imageCaptcha/.test(ag),
    `${AG}: 2captcha çözümü (imageCaptcha/regsense) kaldırılmış.`);
  need(/captchaKontrol|forms\[0\]\.submit|value="Tamam"/.test(ag),
    `${AG}: captcha gönderim adımı (Tamam/forms[0].submit/captchaKontrol) kaldırılmış.`);
  need(/startSessionGuardian/.test(ag),
    `${AG}: oturum gardiyanı (startSessionGuardian) kaldırılmış — düşen oturum otomatik onarılmaz, manuel giriş gerekir.`);
}

// 3) Pencere gözcüsü
const SA = 'apps/luca-local-agent/scripts/start-agent.ps1';
const sa = read(SA);
const watcher = read('apps/luca-local-agent/scripts/pencere-kucult-gozcu.ps1');
need(!!watcher, 'apps/luca-local-agent/scripts/pencere-kucult-gozcu.ps1 yok (ayrı tarayıcıyı küçük tutan gözcü).');
if (sa) {
  need(/pencere-kucult-gozcu\.ps1/.test(sa),
    `${SA}: pencere-kucult-gozcu.ps1 başlatma satırı kaldırılmış (ayrı tarayıcı kilidi).`);
}
if (watcher) {
  need(/browser-data/.test(watcher) && /ShowWindowAsync/.test(watcher),
    'pencere-kucult-gozcu.ps1: .browser-data hedefleme veya ShowWindowAsync küçültme mantığı bozulmuş.');
}

if (fails.length === 0) {
  console.log('✓ Luca izolasyon/susturma/giriş korumaları sağlam');
  process.exit(0);
}

if (process.env.MOREN_UNLOCK === '1') {
  console.error('⚠ luca-isolation-regression: ihlal var ama MOREN_UNLOCK=1 ile bypass edildi:');
  for (const f of fails) console.error('   - ' + f);
  process.exit(0);
}

console.error('\n┌──────────────────────────────────────────────────────────────┐');
console.error('│  ⚠  LUCA İZOLASYON/SUSTURMA/GİRİŞ KORUMASI İHLALİ            │');
console.error('└──────────────────────────────────────────────────────────────┘\n');
for (const f of fails) console.error('  ✗ ' + f);
console.error('\n  Bu davranışlar kullanıcı talebiyle kilitlendi (2026-06-11).');
console.error('  Kasıtlı değiştiriyorsan testi de güncelle; değilse değişikliği geri al.');
console.error('  Geçici bypass: MOREN_UNLOCK=1 git commit ...\n');
process.exit(1);
