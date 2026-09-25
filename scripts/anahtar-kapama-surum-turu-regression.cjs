#!/usr/bin/env node
/**
 * (A) AJAN ANAHTARI — kisa ad yolu KAPATILDI (portal denetimi bulgu 01, son adim)
 * (B) SURUM DOSYA TURU — DocumentVersion.mimeType / originalName (bulgu 36b)
 *
 * (A) Ofis kisa adi (tenant.slug) anahtar olarak kabul ediliyordu. Kisa ad gizli degil:
 *     ofis adindan turer ve tahmin edilebilir. O anahtarla `agent/luca/credential` ucu
 *     Luca parolasini ACIK donduruyordu. Kapatma olcutu (dort yoklayicinin gercek anahtara
 *     gectigi) 25 Eylul'de canli kayittan dogrulandi; yol production'da kapatildi.
 *
 * (B) Surum satirinda dosya turu YOKTU; indirmede hep GUNCEL belgenin turu kullaniliyordu.
 *     v1 JPG, v2 PDF ise v1 "application/pdf" ile iniyor ve tarayici bozuk gosteriyordu.
 *
 * Gercek fonksiyonlar/servisler sahte prisma ile cagrilir — kaynakta metin ARANMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error('  x ' + msg); } else console.log('  + ' + msg); }

const GERCEK = 'a'.repeat(32);
const OFIS = 'cmnqOFIS0001';
const KISA_AD = 'moren-musavirlik';

function sahteVeri() {
  return { tenant: { findFirst: async () => ({ id: OFIS }) } };
}

async function denenen(fn) {
  try { return { deger: await fn(), hata: null }; }
  catch (e) { return { deger: null, hata: e }; }
}

(async () => {
  const yol = path.join(ROOT, 'apps/api/src/common/agent-token.ts');

  console.log('(A) AJAN ANAHTARI');
  console.log('1) gercek anahtar her zaman kabul edilir');
  {
    delete require.cache[require.resolve(yol)];
    const eskiOrtam = { n: process.env.NODE_ENV, f: process.env.AGENT_TOKEN_ALLOW_TENANT_ID };
    process.env.NODE_ENV = 'production';
    delete process.env.AGENT_TOKEN_ALLOW_TENANT_ID;
    process.env.AGENT_INGEST_TOKENS = OFIS + ':' + GERCEK;
    const { resolveTenantFromAgentToken } = require(yol);

    let r = await denenen(() => resolveTenantFromAgentToken(GERCEK, sahteVeri(), { kaynak: 'sinama' }));
    ok(r.deger === OFIS, 'gercek anahtar -> ofis kimligi dondu');

    // KISA AD: production'da REDDEDILMELI
    r = await denenen(() => resolveTenantFromAgentToken(KISA_AD, sahteVeri(), { kaynak: 'sinama' }));
    ok(r.deger === null && !!r.hata, 'production: kisa ad REDDEDILDI');
    ok(r.hata && /Invalid agent token/i.test(String(r.hata.message || '')),
      'ret mesaji "Invalid agent token" (' + (r.hata && r.hata.message) + ')');

    // siki mod her halde reddeder
    r = await denenen(() => resolveTenantFromAgentToken(KISA_AD, sahteVeri(), { strict: true, kaynak: 'sinama' }));
    ok(r.deger === null && !!r.hata, 'siki modda kisa ad REDDEDILDI');

    // bos anahtar
    r = await denenen(() => resolveTenantFromAgentToken('', sahteVeri(), { kaynak: 'sinama' }));
    ok(r.deger === null && !!r.hata, 'bos anahtar REDDEDILDI');

    process.env.NODE_ENV = eskiOrtam.n;
    if (eskiOrtam.f === undefined) delete process.env.AGENT_TOKEN_ALLOW_TENANT_ID;
    else process.env.AGENT_TOKEN_ALLOW_TENANT_ID = eskiOrtam.f;
  }

  console.log('');
  console.log('2) ACMA DUGMESI — acil durumda yol gecici acilabiliyor');
  {
    delete require.cache[require.resolve(yol)];
    const eskiN = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.AGENT_TOKEN_ALLOW_TENANT_ID = '1';
    process.env.AGENT_INGEST_TOKENS = OFIS + ':' + GERCEK;
    const { resolveTenantFromAgentToken } = require(yol);

    const r = await denenen(() => resolveTenantFromAgentToken(KISA_AD, sahteVeri(), { kaynak: 'sinama' }));
    ok(r.deger === OFIS, 'AGENT_TOKEN_ALLOW_TENANT_ID=1 ile kisa ad yeniden kabul ediliyor');

    delete process.env.AGENT_TOKEN_ALLOW_TENANT_ID;
    process.env.NODE_ENV = eskiN;
  }

  console.log('');
  console.log('3) KAYNAK etiketi ZORUNLU — etiketsiz cagri derlenmez');
  {
    delete require.cache[require.resolve(yol)];
    const m = require(yol);
    ok(typeof m.resolveTenantFromAgentToken === 'function', 'cozucu disa aktarilmis');
    ok(m.resolveTenantFromAgentToken.length === 3,
      'imza uc parametreli (token, prisma, opts) — opts atlanamaz: ' + m.resolveTenantFromAgentToken.length);
  }

  console.log('');
  console.log('(B) SURUM DOSYA TURU');
  console.log('4) kayitli tur ONCE, yoksa uzantiya dusus');
  {
    const { DocumentsService } = require(path.join(ROOT, 'apps/api/src/documents/documents.service.ts'));
    const svc = Object.create(DocumentsService.prototype);

    const belge = {
      id: 'd1', title: 'Kira Sozlesmesi', mimeType: 'image/jpeg', s3Key: 't1/mk1/guncel.jpg',
      versions: [
        // v2 = guncel (JPEG), v1 = eski PDF. Eskiden v1 de "image/jpeg" iniyordu.
        { versionNo: 2, s3Key: 't1/mk1/guncel.jpg', mimeType: 'image/jpeg', originalName: 'yeni-foto.jpg' },
        { versionNo: 1, s3Key: 't1/mk1/abc123', mimeType: 'application/pdf', originalName: 'kira-2025.pdf' },
        // uzantisiz VE kayitli turu olmayan ESKI satir -> belgenin turune duser
        { versionNo: 0, s3Key: 't1/mk1/xyz789', mimeType: null, originalName: null },
      ],
    };
    svc.findOne = async () => belge;
    const cagrilan = { indir: null, onizle: null };
    svc.storage = {
      getPresignedDownloadUrl: async (k, f) => { cagrilan.indir = { k, f }; return 'https://ornek/indir'; },
      getPresignedInlineUrl: async (k, f, t) => { cagrilan.onizle = { k, f, t }; return 'https://ornek/onizle'; },
    };

    let r = await svc.getDownloadUrl('d1', 't1', 1);
    ok(r.mimeType === 'application/pdf', 'v1 KAYITLI turuyle iniyor: ' + r.mimeType);
    ok(r.filename === 'kira-2025.pdf', 'v1 ozgun adiyla iniyor: ' + r.filename);

    r = await svc.getPreviewUrl('d1', 't1', 1);
    ok(r.mimeType === 'application/pdf', 'onizlemede de kayitli tur: ' + r.mimeType);
    ok(cagrilan.onizle && cagrilan.onizle.t === 'application/pdf',
      'depoya gecirilen Content-Type dogru: ' + (cagrilan.onizle && cagrilan.onizle.t));

    // ESKI satir (tur yok, uzanti yok) -> belgenin turune duser, cokmemeli
    r = await svc.getDownloadUrl('d1', 't1', 0);
    ok(r.mimeType === 'image/jpeg', 'kayitsiz+uzantisiz ESKI satir belge turune dusuyor: ' + r.mimeType);
    ok(typeof r.filename === 'string' && r.filename.length > 0,
      'ozgun adi olmayan satirda baslik+uzanti uretiliyor: ' + r.filename);

    // uzantidan turetme hala calisiyor (kayitli tur yok ama uzanti var)
    belge.versions.push({ versionNo: 5, s3Key: 't1/mk1/eski.png', mimeType: null, originalName: null });
    r = await svc.getDownloadUrl('d1', 't1', 5);
    ok(r.mimeType === 'image/png', 'kayitli tur yoksa UZANTIDAN turetiliyor: ' + r.mimeType);
  }

  console.log('');
  console.log(failed === 0 ? 'GECTI: anahtar kapama + surum turu' : 'DUSTU: ' + failed + ' kontrol');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('COKTU:', e); process.exit(1); });
