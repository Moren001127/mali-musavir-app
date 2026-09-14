#!/usr/bin/env node
/**
 * Mükellef kartı / Genel Sorgulamalar görsel doğrulaması için AYRI çift:
 *   sahte API  → http://localhost:3002/api/v1   (apps/web/scripts/mock-api.cjs, PORT=3002)
 *   web        → http://localhost:3005          (next dev -p 3005, NEXT_PUBLIC_API_URL sahteye bağlı)
 * Başka oturumun 3000/3001 çiftine dokunmaz. Kapatınca ikisini de öldürür.
 *
 *   node apps/web/scripts/dev-sahte-kart.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const webDizini = path.resolve(__dirname, '..');
const API_PORT = Number(process.env.SAHTE_API_PORT || 3002);
const WEB_PORT = Number(process.env.SAHTE_WEB_PORT || 3005);

const sahte = spawn(process.execPath, [path.join(__dirname, 'mock-api.cjs')], {
  cwd: webDizini,
  env: { ...process.env, PORT: String(API_PORT) },
  stdio: 'inherit',
});

const nextBin = path.join(webDizini, 'node_modules', 'next', 'dist', 'bin', 'next');
const web = spawn(process.execPath, [nextBin, 'dev', '-p', String(WEB_PORT)], {
  cwd: webDizini,
  env: { ...process.env, PORT: String(WEB_PORT), NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api/v1` },
  stdio: 'inherit',
});

const kapat = () => {
  try { sahte.kill(); } catch { /* zaten kapalı */ }
  try { web.kill(); } catch { /* zaten kapalı */ }
};
process.on('SIGINT', () => { kapat(); process.exit(0); });
process.on('SIGTERM', () => { kapat(); process.exit(0); });
web.on('exit', (code) => { kapat(); process.exit(code ?? 0); });
sahte.on('exit', (code) => { if (code) { kapat(); process.exit(code); } });
