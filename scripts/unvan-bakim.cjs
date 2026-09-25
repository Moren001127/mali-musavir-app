/**
 * BAKIM BETIGI — satici unvani duzeltme + cari unvan hizalama (2026-09-25).
 * CANLI servis kodunun BIREBIR AYNISINI calistirir: fonksiyonlar kopyalanmaz,
 * gercek sinif metodlari ts-node ile yuklenip cagrilir.
 *
 * Kullanim:  node tmp-unvan-bakim.cjs [--yaz]
 *            --yaz yoksa KURU TEST (DB'ye yazmaz).
 *
 * Canli DB icin:  cd apps/api
 *   PUB=\$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
 *   DATABASE_URL="\$PUB" node ../../scripts/unvan-bakim.cjs
 *
 * Ayni islerin portal ucu karsiligi (JWT ile):
 *   POST fatura-muhasebelestirme/documents/reparse-satici-unvan
 *   POST vendor-memory/cari-unvan-hizala
 * Betik ikisini SIRAYLA calistirir (hizalama, duzeltmeden SONRA olmali).
 * Idempotent: ikinci calistirmada 0 degisiklik uretir.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });

// ts-node ve prisma monorepoda farkli node_modules'ta olabilir (ocr-modules-regression kalibi).
function ilkBulunan(adaylar, ad) {
  for (const c of adaylar) { try { return require(c); } catch {} }
  throw new Error(`${ad} bulunamadi: ${adaylar.join(' , ')}`);
}
ilkBulunan([
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
], 'ts-node');
const { PrismaClient } = ilkBulunan([
  '@prisma/client',
  path.join(ROOT, 'apps', 'api', 'node_modules', '@prisma', 'client'),
  path.join(ROOT, 'node_modules', '@prisma', 'client'),
], '@prisma/client');
const vendorParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/vendor.ts'));
const azureHelpers = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/helpers.ts'));
const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));
const { VendorMemoryService } = require(path.join(ROOT, 'apps/api/src/vendor-memory/vendor-memory.service.ts'));

const YAZ = process.argv.includes('--yaz');
const prisma = new PrismaClient();

// this.ocr yerine: servisin kullandigi IKI metodu gercek saf fonksiyonlara baglayan vekil.
const ocrVekil = {
  foldTurkishAscii: (s) => azureHelpers.foldTurkishAscii(s),
  extractSaticiUnvanFromRawText: (raw) => vendorParser.extractSaticiUnvan(raw, (s) => azureHelpers.foldTurkishAscii(s)),
};

(async () => {
  const enCok = await prisma.invoiceAccountingDocument.groupBy({ by: ['tenantId'], _count: { _all: true }, orderBy: { _count: { tenantId: 'desc' } }, take: 1 });
  if (!enCok.length) throw new Error('belge yok');
  const tenant = await prisma.tenant.findUnique({ where: { id: enCok[0].tenantId }, select: { id: true, name: true } });
  if (!tenant) throw new Error('tenant bulunamadi');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(YAZ ? '\n*** GERCEK YAZIM MODU ***\n' : '\n--- KURU TEST (DB degismez) ---\n');

  // ADIM 1 — belgelerdeki satici unvani (gercek servis metodu)
  const faturaVekil = { prisma, ocr: ocrVekil, logger: { warn: (m) => console.warn('  !', m) } };
  const r1 = await FaturaMuhasebelestirmeService.prototype.reparseSaticiUnvani.call(
    faturaVekil, tenant.id, { dryRun: !YAZ },
  );
  console.log('ADIM 1 — belge unvanlari');
  console.log(`  taranan: ${r1.taranan} · DEGISEN: ${r1.degisen} · korunan (dokunulmadi): ${r1.korunan} · bunlarin Luca'ya aktarilmisi: ${r1.aktarilmis}`);
  console.log('  — ornekler —');
  for (const o of r1.ornekler) console.log(`    [${o.gerekce}] "${o.once || '(bos)'}"  =>  "${o.sonra}"`);
  if (r1.korunanOrnekler.length) {
    console.log('  — KORUNANLAR (mevcut ad birakildi) —');
    for (const o of r1.korunanOrnekler) console.log(`    mevcut "${o.mevcut}"  (onerilen: "${o.onerilen}")`);
  }

  // ADIM 2 — VKN basina tek unvan (gercek servis metodu)
  const cariServis = new VendorMemoryService(prisma);
  const r2 = await cariServis.cariUnvanHizala(tenant.id, { dryRun: !YAZ });
  console.log('\nADIM 2 — cari unvan hizalama');
  console.log(`  incelenen VKN: ${r2.incelenenVkn} · cari defteri guncellenen: ${r2.defterGuncel} · hizalanan belge: ${r2.belgeGuncel} · elle karar/atlanan: ${r2.atlanan}`);
  console.log('  — ornekler —');
  for (const o of r2.ornekler) {
    console.log(`    VKN ${o.vkn} -> "${o.resmi}"   [defterde: ${o.defterdeki}]`);
    for (const b of o.hizalanacakAdlar) console.log(`        birlesen: ${b}`);
  }
  if (r2.elleKarar.length) {
    console.log('  — ELLE KARAR (dokunulmadi) —');
    for (const o of r2.elleKarar) { console.log(`    VKN ${o.vkn}:`); for (const a of o.adaylar) console.log(`        · ${a}`); }
  }

  await prisma.$disconnect();
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
