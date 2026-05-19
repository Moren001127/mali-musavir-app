#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const controllerPath = path.join(root, 'apps/api/src/luca/luca.controller.ts');
const servicePath = path.join(root, 'apps/api/src/luca/luca.service.ts');
const runtimePath = path.join(root, 'apps/api/public/agent-runtime.js');
const sharedContractPath = path.join(root, 'packages/shared/src/contracts/luca.contract.ts');
const localAgentPath = path.join(root, 'apps/luca-local-agent/src/agent.js');
const controllerSrc = fs.readFileSync(controllerPath, 'utf8');
const serviceSrc = fs.readFileSync(servicePath, 'utf8');
const runtimeSrc = fs.readFileSync(runtimePath, 'utf8');
const sharedContractSrc = fs.readFileSync(sharedContractPath, 'utf8');
const localAgentSrc = fs.readFileSync(localAgentPath, 'utf8');
const allSrc = `${controllerSrc}\n${serviceSrc}\n${runtimeSrc}\n${sharedContractSrc}\n${localAgentSrc}`;

let failed = false;

function fail(message) {
  failed = true;
  console.error(`[luca-upload-contract] FAIL: ${message}`);
}

function requireText(text, message) {
  if (!allSrc.includes(text)) fail(message);
}

function requireIn(src, text, message) {
  if (!src.includes(text)) fail(message);
}

function functionSlice(name) {
  const start = controllerSrc.indexOf(`async ${name}`);
  if (start < 0) return '';

  const rest = controllerSrc.slice(start);
  const nextRoute = rest.slice(1).search(/\n\s*@(?:Get|Post|Patch|Delete)\(/);
  return nextRoute >= 0 ? rest.slice(0, nextRoute + 1) : rest;
}

requireText('exactTip?: string | null', 'exactTip opsiyonu yok; modül tipi birebir kilitlenemez');
requireText("job.status !== 'running'", 'runner upload sadece running job kabul etmeli');
requireText('normalizeRunnerDonem', 'donem normalize kontrolü yok');
requireText('job.sessionId !== opts.sessionId', 'sessionId birebir kontrolü yok');
requireText('job.mukellefId !== opts.mukellefId', 'mukellefId birebir kontrolü yok');
requireText('job tipi hedef modulle uyusmuyor', 'exactTip hata mesajı yok; modül karışması sessiz kalabilir');
requireText('nextRetryAt: { lte: new Date() }', 'pending Luca jobs nextRetryAt cooldown filtresinden geçmiyor');
requireText('nextRetryCount', 'teknik Luca requeue retry sayacı yok');
requireText('shouldFailTransient', 'teknik Luca requeue sınırsız döngüye girebilir');
requireText('TRANSIENT_LUCA_FIRMA_OR_FRAME_STUCK_RESET', 'firma/frame takilmasi teknik retry olarak etiketlenmiyor');
requireText('targetDeviceId: null', 'teknik retry cihaz kilidini temizlemiyor');
requireText('stale: !fresh', 'eski Luca ajan pingleri canli cihaz gibi gosteriliyor');
requireText('ageSec <= 120', 'Luca ajan canlilik esigi korunmuyor');
requireText('retryDelayMs', 'teknik Luca requeue cooldown/backoff yok');
requireText('Luca klasik ekran 3 kez', 'klasik Luca frame takılması diğer işleri bloklamadan failed olmuyor');
requireText('Number(repairState.count || 0) >= 5', 'agent klasik Luca frame reset eşiği çok geç; işler uzun süre takılabilir');

requireText('activeDuplicate', 'ayni session/tip icin duplicate Luca job olusumu engellenmiyor');
requireText("status: { in: ['pending', 'running'] }", 'duplicate Luca job korumasi aktif pending/running joblari kapsamiyor');
requireText('Ayni Luca cekimi zaten kuyrukta', 'duplicate Luca job kullanici logu yok');

const expectedSharedJobTypes = [
  'MIZAN',
  'ACCOUNT_PLAN',
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
  'EDEFTER_FIS_LISTESI',
];
for (const jobType of expectedSharedJobTypes) {
  requireIn(sharedContractSrc, `'${jobType}'`, `shared Luca kontrati gercek job tipini icermiyor: ${jobType}`);
  requireIn(localAgentSrc, `'${jobType}'`, `local agent job tipi destek listesinde yok: ${jobType}`);
}
for (const endpoint of ['upload-mizan', 'upload-account-plan', 'upload-kdv-mizan', 'upload-iho', 'upload-earsiv', 'upload-kdv', 'upload-edefter-fis-listesi']) {
  requireIn(sharedContractSrc, endpoint, `shared Luca kontrati endpoint eslesmesini icermiyor: ${endpoint}`);
}
for (const legacy of ['EARSIV_GELEN', 'EARSIV_GIDEN', 'EFATURA_GELEN', 'EFATURA_GIDEN', 'HESAP_PLANI', 'upload-hesap-plani']) {
  if (sharedContractSrc.includes(legacy)) fail(`shared Luca kontratinda eski/yanlis isim geri gelmis: ${legacy}`);
}
requireIn(localAgentSrc, 'SUPPORTED_JOB_TYPES', 'local agent job tipi listesi tek destek listesine kilitli degil');
requireIn(runtimeSrc, 'buildKdvLedgerMenuAttempts', 'KDV Defteri Kebir menu secimi dinamik click map ile korunmuyor');
requireIn(runtimeSrc, "collectLucaClickMap('Defteri Kebir')", 'KDV Defteri Kebir dinamik menu ipuclari toplanmiyor');

const uploadFunctions = [
  'uploadMizanFromRunner',
  'uploadAccountPlanFromRunner',
  'uploadKdvMizanFromRunner',
  'uploadIhoFromRunner',
  'uploadEarsivFromRunner',
  'uploadKdvFromRunner',
];

for (const fn of uploadFunctions) {
  const block = functionSlice(fn);
  if (!block) {
    fail(`${fn} bulunamadı`);
    continue;
  }
  if (!block.includes('assertRunnerUploadJob')) {
    fail(`${fn} assertRunnerUploadJob kullanmıyor`);
  }
}

const kdvUpload = functionSlice('uploadKdvFromRunner');
if (!kdvUpload.includes('exactTip: session.type')) {
  fail('KDV kontrol upload session.type ile birebir job tipine kilitli değil');
}
if (/KDV_KONTROL|KDV1|KDV2/.test(kdvUpload)) {
  fail('KDV kontrol upload eski/ambiguous KDV job tiplerini kabul ediyor');
}

const earsivUpload = functionSlice('uploadEarsivFromRunner');
if (!earsivUpload.includes("exactTip: `${String(belgeKaynak).toUpperCase()}_${String(tip).toUpperCase()}`")) {
  fail('E-Arşiv/E-Fatura upload belgeKaynak+tip ile birebir job tipine kilitli değil');
}

const assertBlock = functionSlice('assertRunnerUploadJob');
for (const expected of [
  'jobId zorunlu',
  'Luca job bulunamadi',
  'job.status',
  'mukellefId',
  'donem',
  'sessionId',
]) {
  if (!assertBlock.includes(expected)) {
    fail(`assertRunnerUploadJob eksik kontrol: ${expected}`);
  }
}

if (failed) process.exit(1);
console.log('[luca-upload-contract] OK: runner uploadlari ve Luca kuyrugu job/status/modul/session sozlesmesine kilitli');
