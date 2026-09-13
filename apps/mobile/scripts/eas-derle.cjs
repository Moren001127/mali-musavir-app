#!/usr/bin/env node
/**
 * EAS DERLEME (2026-09-13) — güvenilir yol.
 *
 * Sorun: apps/mobile monorepo içinde; `EAS_NO_VCS=1` modunda eas-cli `.easignore`'u uygulamıyor, node_modules dahil
 * ~140 MB arşiv yüklüyor ve yükleme ağda sık kopuyor. Git modunda ise kök = tüm monorepo (pnpm) → bulutta patlıyor.
 *
 * Çözüm: geçici bir kopya (node_modules/.expo/store/design hariç, ~3 MB) → node_modules KAVŞAK (junction; eas-cli
 * yapılandırma eklentilerini yerelden çözer) → küçük bir git deposu (eas git modu yalnız izlenen dosyaları arşivler)
 * → `eas build`. Kullanım (apps/mobile içinde):
 *   node scripts/eas-derle.cjs android preview      # APK (iç dağıtım)
 *   node scripts/eas-derle.cjs android production   # AAB (Google Play)
 *   node scripts/eas-derle.cjs ios production       # Apple hesabı ister
 * Önce `node scripts/build-app-html.cjs` çalıştırılır (assets/app.html güncel olsun).
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KOK = path.resolve(__dirname, '..');
const [platform = 'android', profil = 'preview'] = process.argv.slice(2);
const STAGING = path.join(os.tmpdir(), 'moren-mobil-eas');

function adim(b) { console.log('\n▶ ' + b); }

adim('assets/app.html güncelleniyor');
execSync(`node "${path.join(__dirname, 'build-app-html.cjs')}"`, { stdio: 'inherit' });

adim('Geçici kopya: ' + STAGING);
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });
// robocopy: 0-7 başarı kodları
const rc = spawnSync('robocopy', [KOK, STAGING, '/MIR', '/XD', 'node_modules', '.expo', 'store', 'design', '.git', '/XF', '*.log', '/NFL', '/NDL', '/NJH', '/NP'], { stdio: 'inherit' });
if (rc.status > 7) { console.error('robocopy hata ' + rc.status); process.exit(1); }
for (const f of ['.npmrc', '.easignore']) if (fs.existsSync(path.join(KOK, f))) fs.copyFileSync(path.join(KOK, f), path.join(STAGING, f));

adim('node_modules kavşağı (junction)');
fs.symlinkSync(path.join(KOK, 'node_modules'), path.join(STAGING, 'node_modules'), 'junction');

adim('Küçük git deposu (yalnız izlenen dosyalar arşivlenir)');
fs.writeFileSync(path.join(STAGING, '.gitignore'), 'node_modules/\n.expo/\n*.log\n');
const g = (args) => execSync('git ' + args, { cwd: STAGING, stdio: ['ignore', 'pipe', 'pipe'] });
g('init -q');
g('add -A');
g('-c user.email=eas@moren -c user.name=eas -c core.autocrlf=false commit -q -m "eas staging"');

adim(`eas build -p ${platform} --profile ${profil}`);
const r = spawnSync('eas', ['build', '-p', platform, '--profile', profil, '--non-interactive'], { cwd: STAGING, stdio: 'inherit', shell: true });
process.exit(r.status || 0);
