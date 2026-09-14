#!/usr/bin/env node
/**
 * Ekip ekranı görsel doğrulaması için AYRI çift (başka oturumun 3000/3001 çiftine dokunmaz):
 *   sahte API → http://localhost:3006/api/v1   (mock-api.cjs, PORT=3006)
 *   web       → http://localhost:3007          (next dev -p 3007)
 *   node apps/web/scripts/dev-sahte-ekip.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const webDizini = path.resolve(__dirname, '..');
const API_PORT = Number(process.env.SAHTE_API_PORT || 3006);
const WEB_PORT = Number(process.env.SAHTE_WEB_PORT || 3007);
const sahte = spawn(process.execPath, [path.join(__dirname, 'mock-api.cjs')], { cwd: webDizini, env: { ...process.env, PORT: String(API_PORT) }, stdio: 'inherit' });
const nextBin = path.join(webDizini, 'node_modules', 'next', 'dist', 'bin', 'next');
const web = spawn(process.execPath, [nextBin, 'dev', '-p', String(WEB_PORT)], { cwd: webDizini, env: { ...process.env, PORT: String(WEB_PORT), NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api/v1` }, stdio: 'inherit' });
const kapat = () => { try { sahte.kill(); } catch { /* */ } try { web.kill(); } catch { /* */ } };
process.on('SIGINT', () => { kapat(); process.exit(0); });
process.on('SIGTERM', () => { kapat(); process.exit(0); });
web.on('exit', (code) => { kapat(); process.exit(code ?? 0); });
sahte.on('exit', (code) => { if (code) { kapat(); process.exit(code); } });
