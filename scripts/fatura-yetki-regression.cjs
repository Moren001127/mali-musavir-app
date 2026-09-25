#!/usr/bin/env node
/**
 * FATURA MERKEZİ YETKİ regresyonu — 2026-09-25 denetim bulgusu 3.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts
 *   apps/api/src/auth/guards/roles.guard.ts
 *
 * ESKİ HÂL: controller yalnız @UseGuards(AuthGuard('jwt')) taşıyordu; RolesGuard ve @Roles HİÇ yoktu.
 *   69 ucun 62'si "giriş yapmış olmak" ile açıktı (onay, toplu onay, Luca'ya aktarım, belge silme,
 *   entegratör kimlik bilgisi silme, mükellefe WhatsApp). Oysa documents/taxpayers/kdv-control/luca
 *   dahil 25'ten fazla controller RolesGuard + @Roles kalıbını kullanıyor — bu modül dışarıda kalmıştı.
 *   Kullanıcı ekleme ekranı "Sadece görüntüleme: verileri görür, değişiklik yapamaz" diye söz veriyor;
 *   bu vaat Fatura Merkezi'nde tutulmuyordu.
 *
 * CANLI BAĞLAM (ölçüldü): 4 kullanıcı var — 2 ADMIN, 2 STAFF. Rol adları doğru yazılmış
 *   (ADMIN/STAFF/READONLY), yani guard kimseyi kilitlemez. Sahibin kararı: yazma uçları hem yöneticiye
 *   hem personele açık kalsın; yalnız salt-görüntüleme engellensin (mevcut iş akışı hiç değişmesin).
 *
 * Bu betik gerçek metadata ve gerçek RolesGuard davranışını sınar — kaynakta metin ARAMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'reflect-metadata'));
require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { FaturaMuhasebelestirmeController } = require(
  path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts'),
);
const { RolesGuard } = require(path.join(ROOT, 'apps/api/src/auth/guards/roles.guard.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

const proto = FaturaMuhasebelestirmeController.prototype;
const rolleriniOku = (metod) => Reflect.getMetadata('roles', proto[metod]);

/** Gerçek RolesGuard'ı gerçek Reflector ile çalıştırır. */
function guardKarari(metodAdi, roller) {
  const { Reflector } = require(path.join(ROOT, 'apps', 'api', 'node_modules', '@nestjs', 'core'));
  const guard = new RolesGuard(new Reflector());
  const ctx = {
    getHandler: () => proto[metodAdi],
    getClass: () => FaturaMuhasebelestirmeController,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles: roller } }) }),
  };
  return guard.canActivate(ctx);
}

(async () => {
  console.log('1) Yazma uçları yetki istiyor');
  // Denetim raporunda adı geçen en yüksek etkili uçlar.
  const yazmaUclari = [
    ['approve', 'belge onayı'],
    ['approveBatch', 'toplu onay'],
    ['batchPostToLuca', "Luca'ya toplu aktarım"],
    ['remove', 'belge silme'],
    ['update', 'belge alanı değiştirme'],
    ['saveIntegration', 'entegratör kaydı yazma'],
    ['deleteIntegration', 'entegratör kaydı silme'],
    ['retryLuca', 'yeniden gönderme'],
  ];
  for (const [metod, ad] of yazmaUclari) {
    if (typeof proto[metod] !== 'function') { failed++; console.error(`  ✗ ${ad}: ${metod} metodu bulunamadı (ad değişmiş olabilir)`); continue; }
    const r = rolleriniOku(metod);
    ok(Array.isArray(r) && r.includes('ADMIN') && r.includes('STAFF'), `${ad} (${metod}) → ${JSON.stringify(r)}`);
  }

  console.log('\n2) Gerçek guard kararı');
  ok(guardKarari('approve', ['READONLY']) === false, 'salt-görüntüleme hesabı ONAYLAYAMAZ');
  ok(guardKarari('remove', ['READONLY']) === false, 'salt-görüntüleme hesabı SİLEMEZ');
  ok(guardKarari('batchPostToLuca', ['READONLY']) === false, "salt-görüntüleme hesabı Luca'ya AKTARAMAZ");
  ok(guardKarari('approve', ['STAFF']) === true, 'personel onaylayabilir (iş akışı korundu)');
  ok(guardKarari('remove', ['STAFF']) === true, 'personel silebilir (sahibin kararı)');
  ok(guardKarari('deleteIntegration', ['STAFF']) === true, 'personel entegratör kaydını yönetebilir (sahibin kararı)');
  ok(guardKarari('approve', ['ADMIN']) === true, 'yönetici onaylayabilir');
  ok(guardKarari('approve', []) === false, 'rolü olmayan hesap yazamaz');
  ok(guardKarari('approve', undefined) === false, 'roller okunamıyorsa yazamaz (güvenli taraf)');

  console.log('\n3) Okuma uçları serbest (salt-görüntüleme görmeye devam eder)');
  for (const metod of ['list', 'summary', 'dashboard', 'integrations']) {
    if (typeof proto[metod] !== 'function') { failed++; console.error(`  ✗ ${metod} bulunamadı`); continue; }
    ok(rolleriniOku(metod) === undefined, `${metod} rol şartı taşımıyor`);
    ok(guardKarari(metod, ['READONLY']) === true, `${metod} salt-görüntüleme ile açık`);
  }

  console.log('\n4) Kapsam: yazma uçlarının tamamı korunuyor mu');
  {
    // Controller'daki TÜM metodları gez: HTTP yazma metodu olup rol şartı da OwnerOnly koruması da
    //   olmayan bir uç kalmamalı. Nest yol metadata'sı: 'method' (0=GET,1=POST,2=PUT,3=DELETE,6=PATCH).
    const YAZMA = new Set([1, 2, 3, 6]);
    const korumasiz = [];
    for (const ad of Object.getOwnPropertyNames(proto)) {
      if (ad === 'constructor' || typeof proto[ad] !== 'function') continue;
      const yontem = Reflect.getMetadata('method', proto[ad]);
      if (!YAZMA.has(yontem)) continue;
      const roller = Reflect.getMetadata('roles', proto[ad]);
      const guardlar = Reflect.getMetadata('__guards__', proto[ad]) || [];
      const ownerOnly = guardlar.some((g) => String(g?.name || g).includes('OwnerOnly'));
      if (!roller && !ownerOnly) korumasiz.push(ad);
    }
    ok(korumasiz.length === 0, `korumasız yazma ucu yok${korumasiz.length ? ` — AÇIKTA: ${korumasiz.join(', ')}` : ''}`);
  }

  if (failed) { console.error(`\nfatura-yetki-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-yetki-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
