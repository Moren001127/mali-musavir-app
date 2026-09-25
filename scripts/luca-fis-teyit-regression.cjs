#!/usr/bin/env node
/**
 * LUCA FİŞ TEYİDİ regresyonu — 2026-09-25 denetim bulgusu 14(a).
 *   apps/api/src/luca/luca.service.ts (markJobDone)
 *   apps/api/public/agent-runtime.js (fisBasari → /done gövdesi)
 *
 * Kök sorun: ajan "Fiş Kes" sonrası Luca'da başarı yazısını arıyor (fisBasari) ama bu bilgi
 * sunucuya HİÇ gönderilmiyordu; iş her hâlde "done" gidiyor, markJobDone da bağlı BÜTÜN belgeleri
 * koşulsuz POSTED yapıyordu. Sonuç: fiş kesilmemişken portal "Aktarıldı ✓" diyordu (sessiz kayıp).
 * Ayrıca extra.fisNo hiçbir çağırıcıdan gelmediği için lucaFisNo hep boştu → Luca ile mutabakat
 * yapılamıyordu.
 *
 * Kilitlenen davranış (gerçek fonksiyon, sahte prisma):
 *   1) fisBasari=false → belge POSTED olur (FAILED YAPILMAZ: "tekrar dene" çift fiş üretir) ama
 *      lucaErrorMessage'a teyit uyarısı yazılır ve iş kaydına errorMsg düşer.
 *   2) fisBasari=true → lucaErrorMessage null (uyarı yok), fisNo geldiyse lucaFisNo yazılır.
 *   3) Eski ajan (fisBasari alanı yok) → eski davranış korunur, uyarı yazılmaz (geriye dönük uyumlu).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { LucaService } = require(path.join(ROOT, 'apps/api/src/luca/luca.service.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

function makeSvc() {
  const kayit = { isGuncelleme: null, belgeGuncelleme: null };
  const prisma = {
    lucaFetchJob: {
      findUnique: async () => ({ recordCount: 0, tip: 'INVOICE_POST', invoiceDocumentId: null }),
      updateMany: async (args) => { kayit.isGuncelleme = args; return { count: 1 }; },
    },
    invoiceAccountingDocument: {
      updateMany: async (args) => { kayit.belgeGuncelleme = args; return { count: 3 }; },
      findMany: async () => [],
    },
  };
  const svc = new LucaService(prisma, { bildir: async () => {} }, undefined);
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  // İşlenen Faturalar yansıtması ayrı konu (hatası aktarımı bozmaz) → sabitlenir.
  svc.fmArsivIslenenFaturalaraYansit = async () => {};
  return { svc, kayit };
}

(async () => {
  // ── 1) Fiş teyit EDİLEMEDİ ──
  console.log('1) fisBasari=false — POSTED ama görünür uyarı');
  {
    const { svc, kayit } = makeSvc();
    await svc.markJobDone('job1', 12, { fisBasari: false, beklenenSatir: 12, fisMetin: 'Excel yuklendi' });
    const bd = kayit.belgeGuncelleme && kayit.belgeGuncelleme.data;
    ok(bd && bd.lucaStatus === 'POSTED', 'belge POSTED kalır (FAILED yapılsa "tekrar dene" çift fiş üretirdi)');
    ok(bd && typeof bd.lucaErrorMessage === 'string' && bd.lucaErrorMessage.length > 0,
      'lucaErrorMessage teyit uyarısı taşır (ekranda "Aktarıldı · teyit gerekli" rozeti buna bakar)');
    ok(bd && /teyit/i.test(String(bd.lucaErrorMessage)), 'uyarı metni kullanıcıya ne yapacağını söylüyor');
    const ij = kayit.isGuncelleme && kayit.isGuncelleme.data;
    ok(ij && ij.status === 'done', 'iş done olur (yükleme gerçekten yapılmış olabilir)');
    ok(ij && /TEYİT EDİLMEDİ/.test(String(ij.errorMsg || '')), 'iş kaydına da teyit notu düşer');
  }

  // ── 2) Fiş teyit EDİLDİ + fiş no ──
  console.log('2) fisBasari=true — uyarı yok, fiş no yazılır');
  {
    const { svc, kayit } = makeSvc();
    await svc.markJobDone('job2', 12, { fisBasari: true, fisNo: '2026/814' });
    const bd = kayit.belgeGuncelleme && kayit.belgeGuncelleme.data;
    ok(bd && bd.lucaStatus === 'POSTED', 'belge POSTED');
    ok(bd && bd.lucaErrorMessage === null, 'teyit edildiyse uyarı temizlenir');
    ok(bd && bd.lucaFisNo === '2026/814', `fiş no kaydedilir (mutabakat için) — gelen: ${bd && bd.lucaFisNo}`);
    const ij = kayit.isGuncelleme && kayit.isGuncelleme.data;
    ok(ij && !('errorMsg' in ij), 'başarılı işe errorMsg yazılmaz');
  }

  // ── 3) Eski ajan (alan göndermiyor) ──
  console.log('3) eski ajan — geriye dönük uyumlu');
  {
    const { svc, kayit } = makeSvc();
    await svc.markJobDone('job3', 12);
    const bd = kayit.belgeGuncelleme && kayit.belgeGuncelleme.data;
    ok(bd && bd.lucaStatus === 'POSTED', 'eski ajanda davranış değişmez: POSTED');
    ok(bd && bd.lucaErrorMessage === null, 'alan gelmediyse (undefined) uyarı yazılmaz');
  }

  // ── 4) Ajan gerçekten gönderiyor mu? (sözleşme kontrolü) ──
  console.log('4) ajan sözleşmesi');
  {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/public/agent-runtime.js'), 'utf8');
    // Not: bu tek kontrol metin tabanlı — ajan tarayıcıda çalıştığı için burada çağrılamıyor.
    //   Amacı yalnız "fisBasari /done gövdesine kondu mu" sözleşmesini korumak.
    ok(/jobs\/\$\{job\.id\}\/done[\s\S]{0,400}fisBasari/.test(src), '/done gövdesi fisBasari taşıyor');
    const m = src.match(/AGENT_VERSION = '([\d.]+)'/);
    ok(!!m, `AGENT_VERSION okunabiliyor (${m && m[1]})`);
    // Ajan değişikliği sürüm artırımı GEREKTİRİR: tarayıcıdaki eski sürüm kendini yenilemezse
    //   yeni alanlar hiç gönderilmez ve düzeltme canlıda çalışmaz.
    ok(!!m && m[1] !== '1.47.83', `sürüm artırıldı (1.47.83 → ${m && m[1]})`);
  }

  if (failed) { console.error(`\nluca-fis-teyit-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nluca-fis-teyit-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
