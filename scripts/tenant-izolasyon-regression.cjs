#!/usr/bin/env node
/**
 * OFİSLER ARASI İZOLASYON regresyonu — 2026-09-25 portal denetimi, bulgu 01/02/13/14.
 *
 * NEDEN VAR: Denetimde 50+ regresyon betiği tarandı ve "B ofisinin anahtarıyla A ofisinin kaydına
 * erişilebiliyor mu" sorusunu soran TEK BİR betik bile yoktu. (`luca-isolation-regression.cjs` adı
 * yanıltıcı — o BİLGİSAYARLAR arası izolasyonu korur: tarayıcı sessizliği, captcha akışı.)
 *
 * Kilitlenen davranışlar (gerçek fonksiyonlar, sahte prisma — kaynakta metin ARANMAZ):
 *   01) agentTokenForTenant: GERÇEK anahtarı verir; anahtar yoksa null döner ve ofis kısa adını
 *       ASLA yedek olarak sunmaz (eskiden `luca/agent/me/token` kısa adı token diye dağıtıyordu).
 *   02) markJobDone / markJobFailed: başka ofisin işine DOKUNMAZ (eskiden sorgu yalnız jobId ile
 *       gidiyordu; başka ofisin iş kimliği bilinirse durumu değiştirilebiliyordu).
 *   13) updateBankaHesap: gövdeden tenantId/taxpayerId YAZMAZ (kütle atama; hesap başka ofise
 *       taşınabiliyordu). İmzadaki Partial<> yalnız derleme zamanı tipidir, çalışma anında süzmez.
 *   14) upsertEkstreKaydi: ekstreyi BAŞKA MÜKELLEFİN hesabına bağlamaz (ofis içi karışma).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { agentTokenForTenant } = require(path.join(ROOT, 'apps/api/src/common/agent-token.ts'));
const { LucaService } = require(path.join(ROOT, 'apps/api/src/luca/luca.service.ts'));
const { BankaTakipService } = require(path.join(ROOT, 'apps/api/src/banka-takip/banka-takip.service.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

const BIZ = 'ofis-A';
const BASKA = 'ofis-B';

(async () => {
  // ── 01) Anahtar dağıtımı ──
  console.log('1) agentTokenForTenant — kısa ad yedek olarak sunulmaz');
  {
    const eski = process.env.AGENT_INGEST_TOKENS;
    process.env.AGENT_INGEST_TOKENS = `${BIZ}:gercek-anahtar-123,${BASKA}:oteki-anahtar-456`;
    ok(agentTokenForTenant(BIZ) === 'gercek-anahtar-123', 'kendi ofisinin gerçek anahtarı dönüyor');
    ok(agentTokenForTenant(BASKA) === 'oteki-anahtar-456', 'her ofis kendi anahtarını alıyor');
    ok(agentTokenForTenant('tanimsiz-ofis') === null, 'anahtarı olmayan ofiste null (kısa ad DEĞİL)');
    process.env.AGENT_INGEST_TOKENS = '';
    ok(agentTokenForTenant(BIZ) === null, 'harita boşken null — kısa ad yedeğe düşmüyor');
    if (eski === undefined) delete process.env.AGENT_INGEST_TOKENS; else process.env.AGENT_INGEST_TOKENS = eski;
  }

  // ── 02) Luca iş uçları ──
  console.log('\n2) Luca işleri — başka ofisin işine dokunulmuyor');
  function lucaSvc(isKaydi) {
    const kayit = { isSorgulari: [], guncellemeler: [] };
    const prisma = {
      lucaFetchJob: {
        // Sahte prisma where'i GERÇEKTEN uyguluyor: "bulunamadı" sonucu veri yokluğundan değil,
        //   fonksiyonun ofis koşulu koymasından gelsin.
        findFirst: async (args) => {
          kayit.isSorgulari.push(args);
          const w = (args && args.where) || {};
          if (w.tenantId && w.tenantId !== isKaydi.tenantId) return null;
          return isKaydi;
        },
        findUnique: async (args) => { kayit.isSorgulari.push(args); return isKaydi; },
        updateMany: async (args) => { kayit.guncellemeler.push(args); return { count: 1 }; },
        update: async (args) => { kayit.guncellemeler.push(args); return isKaydi; },
      },
      invoiceAccountingDocument: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    };
    const svc = new LucaService(prisma, { bildir: async () => {} }, undefined);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.fmArsivIslenenFaturalaraYansit = async () => {};
    svc.appendJobLog = async () => {};
    return { svc, kayit };
  }
  {
    const is = { id: 'job1', tenantId: BASKA, status: 'running', tip: 'INVOICE_POST', invoiceDocumentId: null, recordCount: 0 };
    const { svc, kayit } = lucaSvc(is);
    const r = await svc.markJobDone('job1', 5, { tenantId: BIZ });   // BİZ, B'nin işini bitirmeye çalışıyor
    ok(r && r.ok === false, 'markJobDone başka ofisin işini REDDEDİYOR');
    ok(kayit.guncellemeler.length === 0, 'reddedilen işte hiç güncelleme yapılmadı');
    const w = kayit.isSorgulari[0] && kayit.isSorgulari[0].where;
    ok(!!w && w.tenantId === BIZ, `iş sorgusu ofis kimliği taşıyor (${JSON.stringify(w && w.tenantId)})`);
  }
  {
    const is = { id: 'job1', tenantId: BIZ, status: 'running', tip: 'INVOICE_POST', invoiceDocumentId: null, recordCount: 0 };
    const { svc, kayit } = lucaSvc(is);
    await svc.markJobDone('job1', 5, { tenantId: BIZ });             // kendi işi
    ok(kayit.guncellemeler.length > 0, 'kendi ofisinin işi normal işleniyor (iş akışı bozulmadı)');
  }
  {
    const is = { id: 'job2', tenantId: BASKA, status: 'running' };
    const { svc, kayit } = lucaSvc(is);
    const r = await svc.markJobFailed('job2', 'hata', BIZ);
    ok(r === null, 'markJobFailed başka ofisin işini REDDEDİYOR');
    ok(kayit.guncellemeler.length === 0, 'reddedilen işte güncelleme yok');
  }

  // ── 13 + 14) Banka takip ──
  console.log('\n3) Banka hesabı — kütle atama kapalı, sahiplik zorunlu');
  function bankaSvc(hesap, mukellef) {
    const kayit = { guncellemeler: [], sorgular: [] };
    const prisma = {
      bankaHesap: {
        findFirst: async (args) => {
          kayit.sorgular.push(args);
          const w = (args && args.where) || {};
          if (w.tenantId && w.tenantId !== hesap.tenantId) return null;
          if (w.taxpayerId && w.taxpayerId !== hesap.taxpayerId) return null;
          return hesap;
        },
        updateMany: async (args) => { kayit.guncellemeler.push(args); return { count: 1 }; },
      },
      taxpayer: { findFirst: async () => mukellef },
      bankaEkstreKaydi: { findFirst: async () => null, create: async (a) => a.data, update: async (a) => a.data, upsert: async (a) => a },
    };
    const svc = new BankaTakipService(prisma);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    return { svc, kayit };
  }
  {
    const hesap = { id: 'h1', tenantId: BIZ, taxpayerId: 'tp1', bankaAdi: 'Ziraat' };
    const { svc, kayit } = bankaSvc(hesap, { id: 'tp1' });
    await svc.updateBankaHesap(BIZ, 'h1', {
      bankaAdi: 'Yeni Ad',
      tenantId: BASKA,        // ← kütle atama denemesi
      taxpayerId: 'tp-baska', // ← kütle atama denemesi
    });
    const d = kayit.guncellemeler[0] && kayit.guncellemeler[0].data;
    ok(!!d && d.bankaAdi === 'Yeni Ad', 'izinli alan (bankaAdi) yazılıyor');
    ok(!!d && !('tenantId' in d), 'gövdeden gelen tenantId YAZILMIYOR (hesap başka ofise taşınamaz)');
    ok(!!d && !('taxpayerId' in d), 'gövdeden gelen taxpayerId YAZILMIYOR');
    const w = kayit.guncellemeler[0] && kayit.guncellemeler[0].where;
    ok(!!w && w.tenantId === BIZ, 'güncelleme koşulu ofis kimliği taşıyor (yarış koruması)');
  }
  {
    // Bulgu 14: ekstre başka mükellefin hesabına bağlanamaz.
    const hesap = { id: 'h1', tenantId: BIZ, taxpayerId: 'tp-BASKA-MUKELLEF' };
    const { svc } = bankaSvc(hesap, { id: 'tp1' });
    let hata = null;
    try {
      await svc.upsertEkstreKaydi(BIZ, { taxpayerId: 'tp1', bankaHesapId: 'h1', donem: '2026-09' });
    } catch (e) { hata = e; }
    ok(!!hata && /bulunamad/i.test(String(hata.message || '')),
      `başka mükellefin hesabına bağlama REDDEDİLDİ ("${hata && String(hata.message).slice(0, 50)}")`);
  }

  if (failed) { console.error(`\ntenant-izolasyon-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\ntenant-izolasyon-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
