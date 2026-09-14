#!/usr/bin/env node
/**
 * e-Defter Kontrol ekranını GERÇEK bir oturum dökümüyle (üretim DB'den salt-okunur JSON) yerelde açar.
 *   node apps/web/scripts/dev-sahte-edefter.cjs <oturum.json> <katalog.json>
 * Sahte API 3002, web 3005 (dev-sahte-kart.cjs çifti). Dosya verilmezse yerleşik küçük örnek.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const [fixture, katalog] = process.argv.slice(2);
const cocuk = spawn(process.execPath, [path.join(__dirname, 'dev-sahte-kart.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, ...(fixture ? { SAHTE_EDEFTER_FIXTURE: fixture } : {}), ...(katalog ? { SAHTE_EDEFTER_KATALOG: katalog } : {}) },
});
cocuk.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => cocuk.kill());
process.on('SIGTERM', () => cocuk.kill());
