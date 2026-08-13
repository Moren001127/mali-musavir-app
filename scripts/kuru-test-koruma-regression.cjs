/**
 * KURU-TEST (deneme) KORUMA DENETIMI
 *
 * Yapay deneme sistemi gercek handleMessage hattini calistirir; hicbir mesaj
 * GONDERILMEMELIDIR. 13.08.2026'da belge gonderme akisinda bu koruma EKSIKTI ve
 * deneme sirasinda owner'a 3 gercek mesaj gitti (07:28/07:29/07:44).
 *
 * Bu betik whatsapp-bot.controller.ts icindeki TUM gonderim cagrilarini tarar ve
 * her birinin kuru-test korumasi altinda oldugunu dogrular. Koruma sayilir:
 *   - satirin kendisinde msg.__dryRun gecmesi
 *   - ayni fonksiyon govdesinde, cagridan ONCE bir `if (msg.__dryRun)` kapisi olmasi
 */
const fs = require('fs');
const path = require('path');
const dosya = path.join(__dirname, '..', 'apps', 'api', 'src', 'whatsapp', 'whatsapp-bot.controller.ts');
const satirlar = fs.readFileSync(dosya, 'utf8').split('\n');

const GONDERIM = /this\.whatsapp\.sendMessage\(|this\.baileys\.sendMedia\(/;
const KAPI = /if\s*\(\s*msg\.__dryRun/;
const FONKSIYON_BASI = /^\s{2,6}(private|public|async|const)\s|^\s{4}const\s+\w+\s*=\s*async/;

const korumasiz = [];
for (let i = 0; i < satirlar.length; i++) {
  const ln = satirlar[i];
  if (!GONDERIM.test(ln)) continue;
  // Satir ici VEYA cok satirli ternary korumasi (msg.__dryRun ? ... : await ...)
  const yakinKoruma = satirlar.slice(Math.max(0, i - 4), i + 1).some((l) => /msg\.__dryRun/.test(l));
  if (yakinKoruma) continue;
  if (/^\s*(\/\/|\*)/.test(ln)) continue;                  // yorum
  // Geriye dogru en fazla 60 satir: fonksiyon basina kadar kapi ara
  let korumali = false;
  for (let j = i - 1; j >= 0 && j > i - 60; j--) {
    if (KAPI.test(satirlar[j])) { korumali = true; break; }
    if (FONKSIYON_BASI.test(satirlar[j]) && j < i - 2) break;
  }
  if (!korumali) korumasiz.push(`${i + 1}: ${ln.trim().slice(0, 110)}`);
}

if (korumasiz.length) {
  console.error('\n[kuru-test-koruma] KORUMASIZ GONDERIM BULUNDU:');
  for (const k of korumasiz) console.error('  ✗ ' + k);
  console.error('\nHer gonderim cagrisi kuru-testte (msg.__dryRun) durdurulmalidir.');
  process.exit(1);
}
console.log('[kuru-test-koruma] OK: tum gonderim cagrilari kuru-test korumali');
