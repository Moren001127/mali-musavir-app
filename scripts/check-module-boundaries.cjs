#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function sha256(relPath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relPath)))
    .digest('hex');
}

function fail(message) {
  failures.push(message);
}

const failures = [];

const agentSource = 'apps/api/public/agent-runtime.js';
const agentTarget = 'apps/web/public/moren-agent.js';
if (!exists(agentSource)) fail(`${agentSource} bulunamadi`);
if (!exists(agentTarget)) fail(`${agentTarget} bulunamadi; once pnpm --filter @mali-musavir/web build/dev calismali`);
if (exists(agentSource) && exists(agentTarget) && sha256(agentSource) !== sha256(agentTarget)) {
  fail(`${agentTarget}, ${agentSource} ile bytewise ayni degil. node apps/web/scripts/sync-agent-runtime.js calistir.`);
}

const webPackage = JSON.parse(read('apps/web/package.json'));
if (!/sync-agent-runtime\.js/.test(webPackage.scripts?.prebuild || '')) {
  fail('apps/web/package.json prebuild, sync-agent-runtime.js calistirmiyor');
}
if (!/sync-agent-runtime\.js/.test(webPackage.scripts?.predev || '')) {
  fail('apps/web/package.json predev, sync-agent-runtime.js calistirmiyor');
}

const gitignore = read('.gitignore');
for (const entry of ['apps/web/public/moren-agent.js', 'apps/web/public/moren-agent.js.bak-*']) {
  if (!gitignore.includes(entry)) fail(`.gitignore icinde ${entry} yok`);
}

const turbo = JSON.parse(read('turbo.json'));
if (!Array.isArray(turbo.globalDependencies) || !turbo.globalDependencies.includes(agentSource)) {
  fail('turbo.json globalDependencies agent-runtime.js degisikligini izlemiyor');
}

const appModule = read('apps/api/src/app.module.ts');
const expectedApiModules = [
  'KdvControlModule',
  'LucaModule',
  'MizanModule',
  'EarsivModule',
  'KdvBeyannameModule',
  'IsletmeHesapOzetiModule',
  'FaturaMuhasebelestirmeModule',
  'PortalAutomationModule',
  'SystemHealthModule',
];
for (const mod of expectedApiModules) {
  if (!new RegExp(`\\b${mod}\\b`).test(appModule)) fail(`AppModule icinde ${mod} yok`);
}

const expectedRoutes = [
  'apps/web/src/app/(panel)/panel/kdv-kontrol/page.tsx',
  'apps/web/src/app/(panel)/panel/kdv-kontrol/[id]/page.tsx',
  'apps/web/src/app/(panel)/panel/kdv-kontrol/yeni/page.tsx',
  'apps/web/src/app/(panel)/panel/mizan/page.tsx',
  'apps/web/src/app/(panel)/panel/e-arsiv/page.tsx',
  'apps/web/src/app/(panel)/panel/fatura-isleme/page.tsx',
  'apps/web/src/app/(panel)/panel/bilanco/page.tsx',
  'apps/web/src/app/(panel)/panel/gelir-tablosu/page.tsx',
  'apps/web/src/app/(panel)/panel/isletme-hesap-ozeti/page.tsx',
  'apps/web/src/app/(panel)/panel/kdv-beyanname/page.tsx',
  'apps/web/src/app/(panel)/panel/ajanlar/luca/page.tsx',
  'apps/web/src/app/(panel)/panel/ajan-saglik/page.tsx',
];
for (const route of expectedRoutes) {
  if (!exists(route)) fail(`Beklenen panel route eksik: ${route}`);
}

const localAgentFiles = [
  'apps/luca-local-agent/scripts/install-service.ps1',
  'apps/luca-local-agent/scripts/install-scheduled-task.ps1',
  'apps/luca-local-agent/scripts/uninstall-service.ps1',
  'apps/luca-local-agent/scripts/onar-servis.bat',
  'apps/luca-local-agent/scripts/kaldir-servis.bat',
  'apps/luca-local-agent/README.md',
];
for (const localAgentFile of localAgentFiles) {
  if (!exists(localAgentFile)) fail(`Luca local agent servis dosyasi eksik: ${localAgentFile}`);
}
if (localAgentFiles.every(exists)) {
  const installService = read('apps/luca-local-agent/scripts/install-service.ps1');
  const installScheduled = read('apps/luca-local-agent/scripts/install-scheduled-task.ps1');
  const uninstallService = read('apps/luca-local-agent/scripts/uninstall-service.ps1');
  const agentReadme = read('apps/luca-local-agent/README.md');
  if (installService.includes('C:\\Users\\') || installScheduled.includes('C:\\Users\\') || agentReadme.includes('C:\\Users\\')) {
    fail('Luca local agent servis kurulumunda sabit C:\\Users yolu kullanilamaz');
  }
  // install-service.ps1 (2026-06-08) kullanimdan kaldirildi: cakisan cift gorev
  // sorununu cozmek icin tek resmi kuruluma (install-scheduled-task.ps1) delege etmeli.
  if (!installService.includes('install-scheduled-task.ps1')) {
    fail('install-service.ps1 kanonik kuruluma (install-scheduled-task.ps1) delege etmiyor');
  }
  // Self-heal artik kanonik install-scheduled-task.ps1 icinde: gorev kaydi + gizli
  // pencere + tek-instance + periyodik watchdog + eski cakisan gorev temizligi korunmali.
  for (const token of ['Register-ScheduledTask', '-WindowStyle Hidden', 'MultipleInstances IgnoreNew', 'RepetitionInterval', 'Unregister-ScheduledTask', 'start-agent.ps1']) {
    if (!installScheduled.includes(token)) fail(`install-scheduled-task.ps1 icinde beklenen servis onarim parcasi yok: ${token}`);
  }
  if (!/agent\\.js/.test(uninstallService) || !/Terminate/.test(uninstallService)) {
    fail('uninstall-service.ps1 sadece agent.js node processlerini kapatma kontrolunu icermiyor');
  }
}

const expectedSourceFiles = [
  'apps/api/src/kdv-control/reconciliation/matching/multi-rate-aggregate.ts',
  'apps/api/src/kdv-control/reconciliation/validators/amount-check.ts',
  'apps/api/src/kdv-control/reconciliation/validators/date-helpers.ts',
  'apps/api/src/kdv-control/reconciliation/validators/belge-no-check.ts',
  'apps/api/src/kdv-control/reconciliation/validators/record-helpers.ts',
  'apps/api/src/kdv-control/reconciliation/status/score-to-status.ts',
  'apps/api/src/kdv-control/reconciliation/index.ts',
  'apps/api/src/kdv-control/export/export-row-order.ts',
  'apps/api/src/kdv-control/ocr/index.ts',
  'apps/api/src/kdv-control/ocr/parsers/amount.ts',
  'apps/api/src/kdv-control/ocr/parsers/text.ts',
  'apps/api/src/kdv-control/ocr/parsers/tevkifat.ts',
  'apps/api/src/kdv-control/ocr/types.ts',
  'apps/api/src/kdv-control/session/session-record-replacement.ts',
  'scripts/kdv-reconciliation-regression.cjs',
  'scripts/kdv-export-order-regression.cjs',
  'scripts/kdv-session-replace-contract.cjs',
  'scripts/ocr-tax-regression.cjs',
];
for (const sourceFile of expectedSourceFiles) {
  if (!exists(sourceFile)) fail(`Beklenen modul parcasi eksik: ${sourceFile}`);
}

function walkFiles(absDir) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) return walkFiles(abs);
    return [abs];
  });
}

for (const file of walkFiles(path.join(ROOT, 'apps/api/src')).filter((p) => p.endsWith('.ts'))) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (rel === 'apps/api/src/kdv-control/ocr/index.ts') continue;
  const src = fs.readFileSync(file, 'utf8');
  if (
    /from\s+['"][^'"]*kdv-control\/ocr\.service['"]/.test(src) ||
    /from\s+['"]\.\/ocr\.service['"]/.test(src) ||
    /from\s+['"]\.\.\/ocr\.service['"]/.test(src)
  ) {
    fail(`${rel} dogrudan ocr.service import ediyor; public sinir apps/api/src/kdv-control/ocr/index.ts olmali`);
  }
  if (rel !== 'apps/api/src/kdv-control/reconciliation/index.ts') {
    if (
      /from\s+['"][^'"]*kdv-control\/reconciliation\.engine['"]/.test(src) ||
      /from\s+['"]\.\/reconciliation\.engine['"]/.test(src) ||
      /from\s+['"]\.\.\/reconciliation\.engine['"]/.test(src)
    ) {
      fail(`${rel} dogrudan reconciliation.engine import ediyor; public sinir apps/api/src/kdv-control/reconciliation/index.ts olmali`);
    }
  }
}

const agentRuntime = exists(agentSource) ? read(agentSource) : '';
const localAgentRuntime = exists('apps/luca-local-agent/src/agent.js')
  ? read('apps/luca-local-agent/src/agent.js')
  : '';
const lucaController = exists('apps/api/src/luca/luca.controller.ts')
  ? read('apps/api/src/luca/luca.controller.ts')
  : '';
const agentTokens = [
  'upload-mizan',
  'upload-account-plan',
  'upload-kdv-mizan',
  'upload-iho',
  'upload-earsiv',
  'upload-kdv',
  'MIZAN',
  'ACCOUNT_PLAN',
  'KDV_MIZAN',
  'IHO_FETCH',
  'EARSIV',
  'EFATURA',
];
for (const token of agentTokens) {
  if (!agentRuntime.includes(token)) fail(`Luca agent runtime icinde beklenen akim yok: ${token}`);
}

const lucaUploadContracts = [
  { endpoint: 'upload-mizan', jobTypes: ['MIZAN'] },
  { endpoint: 'upload-account-plan', jobTypes: ['ACCOUNT_PLAN'] },
  { endpoint: 'upload-kdv-mizan', jobTypes: ['KDV_MIZAN'] },
  { endpoint: 'upload-iho', jobTypes: ['IHO_FETCH'] },
  { endpoint: 'upload-earsiv', jobTypes: ['EARSIV_SATIS', 'EARSIV_ALIS', 'EFATURA_SATIS', 'EFATURA_ALIS'] },
  { endpoint: 'upload-kdv', jobTypes: ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'] },
];

for (const contract of lucaUploadContracts) {
  const controllerRoute = `@Post('agent/luca/runner/${contract.endpoint}')`;
  const runtimeRoute = `/agent/luca/runner/${contract.endpoint}?`;
  if (!lucaController.includes(controllerRoute)) {
    fail(`Luca controller endpoint eksik: ${controllerRoute}`);
  }
  if (!agentRuntime.includes(runtimeRoute)) {
    fail(`Luca runtime upload hedefi eksik: ${runtimeRoute}`);
  }
  for (const jobType of contract.jobTypes) {
    if (!agentRuntime.includes(`'${jobType}'`) && !agentRuntime.includes(`"${jobType}"`)) {
      fail(`Luca runtime job tipi eksik: ${jobType} -> ${contract.endpoint}`);
    }
  }
}
for (const token of [
  'assertRunnerUploadJob',
  'upload icin jobId zorunlu',
  'upload reddedildi',
  'exactTip',
  'job running degil',
  'hedef modulle uyusmuyor',
]) {
  if (!lucaController.includes(token)) fail(`Luca controller upload sozlesme guard eksik: ${token}`);
}

function requireNearby(runtimePattern, endpoint, description) {
  const found = runtimePattern.test(agentRuntime);
  if (!found) fail(`Luca runtime job/upload eslesmesi bozulmus olabilir: ${description} -> ${endpoint}`);
}

requireNearby(/job\.tip === ['"]MIZAN['"][\s\S]{0,900}runner\/upload-mizan\?/, 'upload-mizan', 'MIZAN');
requireNearby(/job\.tip === ['"]ACCOUNT_PLAN['"][\s\S]{0,900}runner\/upload-account-plan\?/, 'upload-account-plan', 'ACCOUNT_PLAN');
requireNearby(/job\.tip === ['"]KDV_MIZAN['"][\s\S]{0,900}runner\/upload-kdv-mizan\?/, 'upload-kdv-mizan', 'KDV_MIZAN');
requireNearby(/job\.tip === ['"]IHO_FETCH['"][\s\S]{0,900}runner\/upload-iho\?/, 'upload-iho', 'IHO_FETCH');
requireNearby(/EARSIV_SATIS[\s\S]{0,1500}EFATURA_ALIS[\s\S]{0,1500}runner\/upload-earsiv\?/, 'upload-earsiv', 'EARSIV/EFATURA');
requireNearby(/KDV_191[\s\S]{0,9000}ISLETME_GIDER[\s\S]{0,9000}runner\/upload-kdv\?/, 'upload-kdv', 'KDV kontrol/defteri kebir');

for (const jobType of [
  'ACCOUNT_PLAN',
  'MIZAN',
  'KDV_MIZAN',
  'KDV_191',
  'KDV_391',
  'ISLETME_GELIR',
  'ISLETME_GIDER',
  'IHO_FETCH',
  'EARSIV_SATIS',
  'EARSIV_ALIS',
  'EFATURA_SATIS',
  'EFATURA_ALIS',
]) {
  if (!localAgentRuntime.includes(`'${jobType}'`) && !localAgentRuntime.includes(`"${jobType}"`)) {
    fail(`Luca local agent destek listesinde job tipi eksik: ${jobType}`);
  }
}
if (!agentRuntime.includes('buildKdvLedgerMenuAttempts')) {
  fail('KDV Defteri Kebir menu secimi dinamik click map ile korunmuyor');
}

const generatedAgentTracked = (() => {
  try {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['ls-files', '--error-unmatch', agentTarget], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();
if (generatedAgentTracked) {
  console.warn(`[module-boundaries] Uyari: ${agentTarget} hala git tarafindan izleniyor. Ilk uygun committe git rm --cached ile cikarin.`);
}

if (failures.length > 0) {
  console.error('\n[module-boundaries] Moduler guard basarisiz:');
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`[module-boundaries] OK: agent tek kaynak, kritik route/modul ve Luca akislari saglam (${sha256(agentSource).slice(0, 12)})`);
