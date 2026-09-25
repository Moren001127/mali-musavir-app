#!/usr/bin/env node
/**
 * İŞLETME HESAP ÖZETİ — GEÇİCİ VERGİ DEVRİ regresyonu (portal denetimi bulgu 11).
 *
 * HATA: `olustur()` önceki dönem devrini hesaplarken Prisma sorgusu
 *   `select: { hesaplananGecVergi: true }` diyor ama kod `x.odenecekGecVergi` okuyordu.
 *   Prisma yalnız seçilen alanı döndürdüğü için değer HER ZAMAN undefined → `Number(undefined||0)`
 *   = 0 → önceki dönem devri DAİMA SIFIR. Sonuç: 2. çeyrekte ödenecek geçici vergi İKİ KATI
 *   hesaplanıyor ve bu tutar mükellefe WhatsApp ile gönderiliyordu
 *   ("↪️ Önceki Dönem Ödenen Geçici Vergi: *0,00 ₺*").
 *   v1.36.65 yaması reduce'u düzeltmiş ama select'i eski bırakmıştı — yarım kalmış yama.
 *
 * Bu betik gerçek `olustur()` fonksiyonunu sahte prisma ile çağırır (kaynakta metin ARAMAZ).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { IsletmeHesapOzetiService } = require(
  path.join(ROOT, 'apps/api/src/isletme-hesap-ozeti/isletme-hesap-ozeti.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/** Sahte prisma: select'i GERÇEKTEN uygular — yanlış alan seçilirse değer undefined kalır. */
function makeSvc(oncekiKayitlar) {
  const kayit = { sorgular: [], olusturulan: null };
  const prisma = {
    isletmeHesapOzeti: {
      findFirst: async () => null,          // bu dönem henüz yok
      // olustur() iki yerde findUnique çağırıyor: (1) bu dönem zaten var mı, (2) Q1 kaydı
      //   (yıl başı stoğu için). İkisini de ayırt ederek karşılıyoruz.
      findUnique: async (args) => {
        const k = ((args || {}).where || {}).tenantId_taxpayerId_yil_donem || {};
        if (Number(k.donem) === 1) return oncekiKayitlar.find((r) => Number(r.donem) === 1) || null;
        return null;                        // bu dönem henüz oluşturulmamış
      },
      findMany: async (args) => {
        kayit.sorgular.push(args);
        const sec = (args && args.select) || null;
        if (!sec) return oncekiKayitlar;
        // Prisma davranışını taklit et: YALNIZ seçilen alanlar dönsün.
        return oncekiKayitlar.map((r) => {
          const o = {};
          for (const k of Object.keys(sec)) if (sec[k]) o[k] = r[k];
          return o;
        });
      },
      create: async (args) => { kayit.olusturulan = args.data; return args.data; },
    },
    taxpayer: { findFirst: async () => ({ id: 'tp1', unvan: 'TEST' }), findUnique: async () => ({ id: 'tp1' }) },
  };
  const svc = new IsletmeHesapOzetiService(prisma);
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  return { svc, kayit };
}

(async () => {
  console.log('1) Q2: önceki çeyrekte 15.000 ₺ ödenmiş → devir 15.000 olmalı');
  {
    // Q1: hesaplanan 15.000, ödenen 15.000
    const { svc, kayit } = makeSvc([{ donem: 1, hesaplananGecVergi: 15000, odenecekGecVergi: 15000 }]);
    await svc.olustur({ tenantId: 't1', taxpayerId: 'tp1', yil: 2026, donem: 2 });

    const sorgu = kayit.sorgular[0];
    const sec = (sorgu && sorgu.select) || {};
    ok(sec.odenecekGecVergi === true,
      `sorgu DOĞRU alanı seçiyor (odenecekGecVergi: ${sec.odenecekGecVergi})`);

    const d = kayit.olusturulan || {};
    ok(Number(d.oncekiOdenenGecVergi) === 15000,
      `önceki dönem devri 15.000 (gelen: ${d.oncekiOdenenGecVergi}) — eski kodda 0 geliyordu`);
  }

  console.log('\n2) Q1: önceki dönem yok → devir 0 (doğru davranış)');
  {
    const { svc, kayit } = makeSvc([]);
    await svc.olustur({ tenantId: 't1', taxpayerId: 'tp1', yil: 2026, donem: 1 });
    const d = kayit.olusturulan || {};
    ok(Number(d.oncekiOdenenGecVergi || 0) === 0, 'ilk çeyrekte devir sıfır');
  }

  console.log('\n3) Q3: iki çeyrek ödenmiş → toplamı devreder');
  {
    const { svc, kayit } = makeSvc([
      { donem: 1, hesaplananGecVergi: 15000, odenecekGecVergi: 15000 },
      { donem: 2, hesaplananGecVergi: 30000, odenecekGecVergi: 15000 },
    ]);
    await svc.olustur({ tenantId: 't1', taxpayerId: 'tp1', yil: 2026, donem: 3 });
    const d = kayit.olusturulan || {};
    ok(Number(d.oncekiOdenenGecVergi) === 30000,
      `iki çeyreğin ödeneni toplanıyor: 30.000 (gelen: ${d.oncekiOdenenGecVergi})`);
  }

  console.log('\n4) Eski alan artık okunmuyor (yarım yama nüksetmesin)');
  {
    // Ödenen 0 ama hesaplanan 99.000: kod yanlışlıkla hesaplanani okursa devir 99.000 çıkar.
    const { svc, kayit } = makeSvc([{ donem: 1, hesaplananGecVergi: 99000, odenecekGecVergi: 0 }]);
    await svc.olustur({ tenantId: 't1', taxpayerId: 'tp1', yil: 2026, donem: 2 });
    const d = kayit.olusturulan || {};
    ok(Number(d.oncekiOdenenGecVergi || 0) === 0,
      `ödenen 0 iken devir 0 — hesaplanan (99.000) KULLANILMIYOR (gelen: ${d.oncekiOdenenGecVergi})`);
  }

  if (failed) { console.error(`\niho-gecici-vergi-devir-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\niho-gecici-vergi-devir-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
