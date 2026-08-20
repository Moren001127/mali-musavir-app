#!/usr/bin/env node
/**
 * GIB e-Arsiv GUVENLI CIKIS regresyonu.
 *
 * CANLI KANIT (2026-08-20): GIB'e giris yapip cikis yapmayinca sonraki giris reddedildi:
 *   "Sisteme ayni anda birden fazla giris yapamazsiniz.
 *    Lutfen 'Guvenli Cikis' secenegini kullanarak cikis yapiniz."
 * Ayni makineden BASKA mukellef girebiliyordu -> sebep IP degil, ACIK OTURUM.
 *
 * Bu MUKELLEFIN KENDI GIRISINI de kilitler. Bu yuzden GIB'e giris yapan her akis,
 * hata alsa bile finally icinde cikis yapmak ZORUNDADIR. Test bunu kilitler.
 */
const fs = require('fs');
const path = require('path');

const DOSYALAR = [
  {
    ad: 'fatura-kes-gib.service.ts',
    yol: path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-kes', 'fatura-kes-gib.service.ts'),
    girisIz: /assoscmd'\s*,\s*'anologin'/,
    cikisFn: /private async gibLogout\s*\(/,
    cikisCagri: /await this\.gibLogout\(token\)/,
  },
  {
    ad: 'portal-automation-railway-runner.service.ts',
    yol: path.join(__dirname, '..', 'apps', 'api', 'src', 'portal-automation', 'portal-automation-railway-runner.service.ts'),
    girisIz: /assoscmd'\s*,\s*'anologin'/,
    cikisFn: /private async earsivLogoutHttp\s*\(/,
    cikisCagri: /await this\.earsivLogoutHttp\(token\)/,
  },
];

let hata = 0;
for (const d of DOSYALAR) {
  const src = fs.readFileSync(d.yol, 'utf8');
  if (!d.girisIz.test(src)) continue; // bu dosya artik GIB'e giris yapmiyorsa kural gerekmiyor

  if (!d.cikisFn.test(src)) { console.error(`  \u2717 ${d.ad}: GIB'e giris var ama CIKIS FONKSIYONU yok`); hata++; }
  else console.log(`  \u2713 ${d.ad}: cikis fonksiyonu var`);

  if (!d.cikisCagri.test(src)) { console.error(`  \u2717 ${d.ad}: cikis CAGRILMIYOR`); hata++; }
  else console.log(`  \u2713 ${d.ad}: cikis cagriliyor`);

  // Cikis finally icinde mi? (hata durumunda da oturum kapanmali)
  const i = src.search(d.cikisCagri);
  const oncesi = i > 0 ? src.slice(Math.max(0, i - 400), i) : '';
  if (!/\}\s*finally\s*\{/.test(oncesi)) {
    console.error(`  \u2717 ${d.ad}: cikis FINALLY icinde degil — hata olunca oturum acik kalir`);
    hata++;
  } else console.log(`  \u2713 ${d.ad}: cikis finally icinde (hata olsa da oturum kapanir)`);

  // logout komutu dogru mu
  if (!/assoscmd'\s*,\s*'logout'/.test(src)) { console.error(`  \u2717 ${d.ad}: assoscmd=logout gonderilmiyor`); hata++; }
  else console.log(`  \u2713 ${d.ad}: assoscmd=logout gonderiliyor`);
}

if (hata) process.exit(1);
console.log('[gib-guvenli-cikis-regression] OK: GIB girisi yapan her akis guvenli cikis yapiyor');
