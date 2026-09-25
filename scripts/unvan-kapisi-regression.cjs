/**
 * UNVAN OKUMA KAPISI — davranis sinamasi (2026-09-25).
 *
 * Neyi korur: satici unvani yazilmadan once denetlenir; supheliyse CARI DEFTERINDEN duzeltilir,
 * duzeltilemezse SUPHELI isaretlenir (belge uyariyla gelir). Eskiden bu hata SESSIZDI —
 * 84 belgede firma adi yerine adres yaziliydi ve hepsi "Eslesti" gorunuyordu.
 *
 * Gercek sinif metodunu cagirir (kopya mantik yok): FaturaMuhasebelestirmeService.prototype
 * .saticiUnvaniTazele, sahte prisma/vendorMemory/ocr ile.
 */
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
function ilkBulunan(adaylar, ad) {
  for (const c of adaylar) { try { return require(c); } catch {} }
  throw new Error(`${ad} bulunamadi`);
}
ilkBulunan([
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
], 'ts-node');

const vendorParser = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/parsers/vendor.ts'));
const azureHelpers = require(path.join(ROOT, 'apps/api/src/kdv-control/ocr/providers/azure/helpers.ts'));
const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));
const { dogrulamaUyarilari, UYARI_KOD } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/uyari-katmani.ts'));

const fold = (s) => azureHelpers.foldTurkishAscii(s);
const ocrVekil = { saticiUnvaniSupheliMi: (ad) => vendorParser.saticiUnvaniSupheli(ad, fold) };

/** Sahte servis: defterdeki kaydi ve yazma cagrilarini takip eder. */
function vekilKur(defterKaydi) {
  const izler = { ogrenilen: null, guncellenen: null };
  return {
    izler,
    vekil: {
      ocr: ocrVekil,
      logger: { log() {}, warn() {} },
      vendorMemory: {
        cariAra: async () => defterKaydi,
        cariOgren: async (_t, c) => { izler.ogrenilen = c; return c; },
      },
      prisma: {
        vendorMemory: {
          update: async ({ data }) => { izler.guncellenen = data; return data; },
        },
      },
    },
  };
}

const tazele = (vekil, vkn, ad) =>
  FaturaMuhasebelestirmeService.prototype.saticiUnvaniTazele.call(vekil, 'T1', vkn, ad);

let gecen = 0;
const eq = (a, b, ad) => { assert.strictEqual(a, b, `${ad}\n  beklenen: ${JSON.stringify(b)}\n  gelen   : ${JSON.stringify(a)}`); gecen++; };

(async () => {
  // 1) Okuma SUPHELI (adres satiri), defter SAGLAM → defterden duzelt.
  {
    const { vekil } = vekilKur({ unvan: 'OTO İLKER İLKER ÖNER', kaynak: 'belge' });
    const r = await tazele(vekil, '28027698710', 'K.SİNAN MERKEZ MAH.');
    eq(r.ad, 'OTO İLKER İLKER ÖNER', 'adres okundu → defterdeki unvan kullanilir');
    eq(r.supheli, null, 'defterden duzeltilince suphe kalkar');
    eq(r.kaynak, 'cari-defteri', 'kaynak cari-defteri isaretlenir');
  }
  // 2) Okuma SUPHELI, defter de SUPHELI → duzeltilemez, SUPHELI isaretlenir.
  {
    const { vekil } = vekilKur({ unvan: 'FEVZİ ÇAKMAK MAH.', kaynak: 'belge' });
    const r = await tazele(vekil, '3341120616', 'LTD.ŞTİ.FEVZİ ÇAKMAK MH.');
    eq(r.ad, 'LTD.ŞTİ.FEVZİ ÇAKMAK MH.', 'duzeltilemeyince okunan ad korunur');
    eq(r.supheli, 'adres', 'suphe sebebi tasinir');
  }
  // 3) Okuma SAGLAM, defterde KAYIT YOK → deftere ogretilir (sonraki belgeler icin).
  {
    const { vekil, izler } = vekilKur(null);
    const r = await tazele(vekil, '9980810946', 'ZINGIL AKARYAKIT İNŞ.TURZ.SAN.VE TİC.A.Ş.');
    eq(r.supheli, null, 'saglam okuma suphe uretmez');
    eq(izler.ogrenilen && izler.ogrenilen.unvan, 'ZINGIL AKARYAKIT İNŞ.TURZ.SAN.VE TİC.A.Ş.', 'saglam ad deftere ogretilir');
  }
  // 4) Okuma SAGLAM, defter SUPHELI ve UBL kaynakli → resmi kayit EZILMEZ.
  {
    const { vekil, izler } = vekilKur({ unvan: 'Hissettirir', kaynak: 'ubl' });
    const r = await tazele(vekil, '8590380323', 'TT MOBİL İletişim Hizmetleri A.Ş.');
    eq(r.ad, 'TT MOBİL İletişim Hizmetleri A.Ş.', 'okunan saglam ad kullanilir');
    eq(izler.guncellenen, null, 'UBL kaynakli defter kaydi ezilmez');
  }
  // 5) Okuma SAGLAM, defter SUPHELI ve UBL DEGIL → defter duzeltilir.
  {
    const { vekil, izler } = vekilKur({ unvan: 'Bakanlar', kaynak: 'belge' });
    await tazele(vekil, '1460043676', 'BASBUG OTO YEDEK PARÇA SANAYİ ANONİM ŞİRKETİ');
    eq(izler.guncellenen && izler.guncellenen.firmaUnvan, 'BASBUG OTO YEDEK PARÇA SANAYİ ANONİM ŞİRKETİ', 'supheli defter kaydi duzeltilir');
  }
  // 6) VKN YOK → deftere bakilamaz, yalniz suphe isareti.
  {
    const { vekil } = vekilKur({ unvan: 'HERHANGI LTD ŞTİ', kaynak: 'belge' });
    const r = await tazele(vekil, null, 'K.SİNAN MERKEZ MAH.');
    eq(r.ad, 'K.SİNAN MERKEZ MAH.', 'VKN yoksa defterden duzeltme YOK');
    eq(r.supheli, 'adres', 'VKN yoksa da suphe isaretlenir');
  }
  // 7) Iki taraf da SAGLAM ama FARKLI → okunan korunur (yazim birligi hizalamanin isi).
  {
    const { vekil, izler } = vekilKur({ unvan: 'ARS OTOMOBİL YEDEK PARÇA SAN. VE TİC. LTD. ŞTİ', kaynak: 'belge' });
    const r = await tazele(vekil, '0800371588', 'ARS OTOMOBİL YEDEK PARCA SAN. VE TİC.LTD.ŞTİ');
    eq(r.ad, 'ARS OTOMOBİL YEDEK PARCA SAN. VE TİC.LTD.ŞTİ', 'saglam okuma defter tarafindan EZILMEZ');
    eq(izler.guncellenen, null, 'saglam defter kaydi da ezilmez');
  }

  // 8) Uyari katmani: SATICI_ADI_SUPHELI dogru uyariya cevrilir.
  {
    const u = dogrulamaUyarilari([{ code: 'SATICI_ADI_SUPHELI', severity: 'WARNING', message: 'Firma adı olarak ADRES satırı okunmuş: "K.SİNAN MERKEZ MAH.".' }]);
    eq(u.length, 1, 'tek uyari uretilir');
    eq(u[0].kod, UYARI_KOD.SATICI_ADI_SUPHELI, 'uyari kodu dogru');
    eq(u[0].seviye, 'uyari', 'seviye uyari (engel degil — belge islenebilir kalir)');
    assert.ok(String(u[0].oneri || '').includes('cari defterinden'), 'oneri sonraki belgelerin otomatik duzelecegini soyler');
    gecen++;
  }

  console.log(`[unvan-kapisi-regression] ${gecen} assertion — HEPSI GECTI`);
})().catch((e) => { console.error('[unvan-kapisi-regression] KIRILDI:', e.message); process.exit(1); });
