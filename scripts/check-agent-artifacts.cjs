#!/usr/bin/env node
const { execFileSync } = require('child_process');

function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-status'], { encoding: 'utf8' });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      return { status, file: rest[rest.length - 1] };
    });
}

const generatedAgent = 'apps/web/public/moren-agent.js';
const generatedBackupPrefix = 'apps/web/public/moren-agent.js.bak-';

const bad = stagedFiles().filter(({ status, file }) => {
  const isGenerated = file === generatedAgent || file.startsWith(generatedBackupPrefix);
  if (!isGenerated) return false;
  return status !== 'D';
});

if (bad.length > 0) {
  console.error('');
  console.error('HATA: Web agent dosyasi artik build artifact.');
  console.error('Kaynak dosya: apps/api/public/agent-runtime.js');
  console.error('Artifact dosyasi eklenemez/degistirilemez. Sadece git takibinden cikarma (D) serbest.');
  console.error('Staged artifact dosyalarini committen cikar:');
  for (const item of bad) console.error(`  - ${item.status} ${item.file}`);
  console.error('');
  process.exit(1);
}
