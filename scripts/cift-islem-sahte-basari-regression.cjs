#!/usr/bin/env node
/**
 * ÇİFT İŞLEM ve SAHTE BAŞARI regresyonu — portal denetimi Faz D (27, 28, 29, 30, 31, 41a).
 *
 * 27 — Onay kapısı ile yazma arasındaki boşluk DIŞ GÖNDERİM kadar uzundu: aynı onaya iki kez
 *      basmak mükellefe AYNI WhatsApp mesajını iki kez gönderiyordu.
 * 28 — `markRunning`/`cancelJob` oku-sonra-yaz kalıbındaydı; iki ajan aynı işi alabiliyor,
 *      "İptal" tamamlanmış işi ezebiliyordu.
 * 29 — Watchdog eşiği 2 DAKİKA ve sahip kontrolü yoktu: sağlıklı uzun iş "başarısız" sayılıp
 *      sayaçlar bozuluyor, `pause_after_3` ile otomasyon kendiliğinden duruyordu.
 * 30 — Depo erişilemezken 40 belge indirilip hiçbiri saklanamıyor, ekran "40 kayıt yazıldı" diyordu.
 * 31 — Adım hatası yutuluyordu: "fatura çek" patlar, "WhatsApp gönder" çalışır ve mükellefe
 *      "Sayın , döneminde faturanız işlendi" giderdi.
 * 41a — Bir numara tutunca TAM BAŞARI sayılıyor, hatalar siliniyordu.
 *
 * Gerçek fonksiyonlar sahte prisma ile çağrılır — kaynakta metin ARANMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/**
 * `n` çağrı OKUMAYI bitirmeden hiçbiri devam edemez — iki ajanın aynı satırı aynı anda
 * görmesini birebir kurar. Bariyer olmadan sahte tablo işlemleri sıraya sokar (ilk çağrı
 * okur, yazar, biter; ikincisi ancak sonra okur) ve koşullu yazma HİÇ sınanmamış olur.
 */
function okumaBariyeri(n) {
  let bekleyen = n;
  let ac;
  const kapi = new Promise((r) => { ac = r; });
  return async () => {
    if (--bekleyen <= 0) ac();
    await kapi;
  };
}

/** Durum kolonunu GERÇEKTEN uygulayan sahte tablo: koşullu updateMany yarışı sınanabilsin. */
function durumTablosu(baslangic, bariyer) {
  const state = { rows: JSON.parse(JSON.stringify(baslangic)) };
  const uyar = (w, r) => {
    for (const [k, v] of Object.entries(w)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if (v.notIn && v.notIn.includes(r[k])) return false;
        if (v.in && !v.in.includes(r[k])) return false;
        if (v.not !== undefined && r[k] === v.not) return false;
        continue;
      }
      if (r[k] !== v) return false;
    }
    return true;
  };
  return {
    state,
    // GERÇEK YARIŞ: okuma bir tur bekler, böylece iki çağrı da yazma öncesi AYNI durumu görür.
    // Beklemezse sahte tablo işlemleri sıraya sokar ve koşullu yazma hiç sınanmamış olur.
    findFirst: async ({ where }) => {
      const sonuc = state.rows.find((r) => uyar(where, r)) || null;
      if (bariyer) await bariyer();   // hepsi okuyana kadar kimse yazmaya geçmesin
      return sonuc;
    },
    updateMany: async ({ where, data }) => {
      const hedef = state.rows.filter((r) => uyar(where, r));
      for (const r of hedef) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && v.increment != null) r[k] = (r[k] || 0) + v.increment;
          else r[k] = v;
        }
      }
      return { count: hedef.length };
    },
    update: async ({ where, data }) => {
      const r = state.rows.find((x) => x.id === where.id);
      if (!r) throw new Error('kayit yok');
      Object.assign(r, data);
      return r;
    },
  };
}

(async () => {
  console.log('1) BULGU 27 — aynı onay İKİ KEZ yürütülemiyor');
  {
    const { EkipOnayService } = require(path.join(ROOT, 'apps/api/src/ekip/ekip-onay.service.ts'));
    const bariyer = okumaBariyeri(2);
    const tablo = durumTablosu([{ id: 'a1', previewId: 'PRV-AAAA', tenantId: 't1', status: 'PENDING', action: 'whatsapp_gonder', agent: 'ekip:tahsilat', payload: {}, expiresAt: new Date(Date.now() + 600000) }], bariyer);
    const gonderimler = [];
    const prisma = { ownerApprovalRequest: tablo, auditLog: { create: async () => ({}) }, agentEvent: { create: async () => ({}) }, agentCommand: { findUnique: async () => null, update: async () => ({}) } };
    const svc = new EkipOnayService(prisma, {}, {}, {}, {});
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    // yurut(): gerçek dış gönderimin yerine iz bırakan sahte — ve YAVAŞ, yarış penceresi açık kalsın.
    svc.yurut = async () => { await new Promise((r) => setTimeout(r, 40)); gonderimler.push(Date.now()); return { ok: true }; };
    svc.kaydiBul = async (tenantId, pid) => {
      const kayit = tablo.state.rows.find((r) => r.previewId === pid && r.tenantId === tenantId) || null;
      await bariyer();  // iki çağrı da PENDING görsün — gerçek yarış penceresi
      return kayit ? { ...kayit } : null;
    };

    const [r1, r2] = await Promise.all([
      svc.onayla({ tenantId: 't1', previewId: 'PRV-AAAA', onayMetni: 'ONAYLIYORUM #PRV-AAAA' }),
      svc.onayla({ tenantId: 't1', previewId: 'PRV-AAAA', onayMetni: 'ONAYLIYORUM #PRV-AAAA' }),
    ]);
    ok(gonderimler.length === 1, `dış gönderim TEK KEZ yapıldı (gelen: ${gonderimler.length}) — eski kodda iki kez gidiyordu`);
    const basariliSayisi = [r1, r2].filter((r) => r && r.ok !== false).length;
    ok(basariliSayisi === 1, `çağrılardan yalnız biri başarılı döndü (${basariliSayisi})`);
    ok(tablo.state.rows[0].status === 'EXECUTED', `kayıt EXECUTED (gelen: ${tablo.state.rows[0].status})`);
  }

  console.log('\n2) BULGU 27 — gönderim patlarsa onay PENDING\'e geri bırakılıyor');
  {
    const { EkipOnayService } = require(path.join(ROOT, 'apps/api/src/ekip/ekip-onay.service.ts'));
    const tablo = durumTablosu([{ id: 'a1', previewId: 'PRV-BBBB', tenantId: 't1', status: 'PENDING', action: 'whatsapp_gonder', agent: 'ekip:tahsilat', payload: {}, expiresAt: new Date(Date.now() + 600000) }]);
    const prisma = { ownerApprovalRequest: tablo, auditLog: { create: async () => ({}) }, agentEvent: { create: async () => ({}) }, agentCommand: { findUnique: async () => null, update: async () => ({}) } };
    const svc = new EkipOnayService(prisma, {}, {}, {}, {});
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.yurut = async () => { throw new Error('WhatsApp köprüsü kapalı'); };
    svc.kaydiBul = async () => tablo.state.rows[0];
    await svc.onayla({ tenantId: 't1', previewId: 'PRV-BBBB', onayMetni: 'ONAYLIYORUM #PRV-BBBB' });
    ok(tablo.state.rows[0].status === 'PENDING',
      `hata sonrası PENDING'e döndü (gelen: ${tablo.state.rows[0].status}) — kullanıcı yeniden deneyebilir`);
  }

  console.log('\n3) BULGU 28 — iki ajan aynı işi alamıyor');
  {
    const { PortalAutomationService } = require(path.join(ROOT, 'apps/api/src/portal-automation/portal-automation.service.ts'));
    const tablo = durumTablosu([{ id: 'j1', tenantId: 't1', status: 'pending', payload: {}, attempts: 0 }], okumaBariyeri(2));
    const svc = Object.create(PortalAutomationService.prototype);
    svc.prisma = { portalAutomationJob: tablo };
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.withJobProgress = (p) => p || {};

    const sonuc = await Promise.allSettled([
      svc.markRunning('t1', 'j1', 'cihaz-A'),
      svc.markRunning('t1', 'j1', 'cihaz-B'),
    ]);
    const kazanan = sonuc.filter((r) => r.status === 'fulfilled').length;
    ok(kazanan === 1, `işi YALNIZ BİR ajan aldı (kazanan: ${kazanan}) — eski kodda ikisi de alıyordu`);
    ok(tablo.state.rows[0].attempts === 1, `deneme sayacı bir kez arttı (gelen: ${tablo.state.rows[0].attempts})`);
    ok(tablo.state.rows[0].status === 'running', 'iş running');
  }

  console.log('\n4) BULGU 28 — "İptal" TAMAMLANMIŞ işi ezmiyor');
  {
    const { PortalAutomationService } = require(path.join(ROOT, 'apps/api/src/portal-automation/portal-automation.service.ts'));
    // Kullanıcı "İptal"e bastığında iş HÂLÂ çalışıyor; kapı okunduktan SONRA koşucu bitiriyor.
    // Bu, canlıdaki gerçek pencere: okuma ile yazma arasında durum değişiyor.
    const tablo = durumTablosu([{ id: 'j1', tenantId: 't1', status: 'running', recordCount: 0, payload: {} }]);
    const svc = Object.create(PortalAutomationService.prototype);
    svc.prisma = { portalAutomationJob: tablo };
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.withJobProgress = (p) => p || {};
    const asilFindFirst = tablo.findFirst;
    let okumaSayisi = 0;
    tablo.findFirst = async (a) => {
      const r = await asilFindFirst(a);
      const anlikKopya = r ? { ...r } : null;  // servis 'running' GÖRDÜ; satır sonra değişiyor
      // İLK okumadan sonra koşucu işi bitirir (completeJob) — yazma buna rağmen yapılmamalı.
      if (++okumaSayisi === 1) { tablo.state.rows[0].status = 'done'; tablo.state.rows[0].recordCount = 40; }
      return anlikKopya;
    };
    await svc.cancelJob('t1', 'j1', 'kullanici iptal etti');
    ok(tablo.state.rows[0].status === 'done',
      `tamamlanmış iş 'done' kaldı (gelen: ${tablo.state.rows[0].status}) — eski kodda 'cancelled' yazılıp sonuç kayboluyordu`);
    ok(Number(tablo.state.rows[0].recordCount) === 40, 'kayıt sayısı korundu');
  }

  console.log('\n5) BULGU 29 — sağlıklı uzun iş "başarısız" sayılmıyor');
  {
    const { AutomationRunnerService } = require(path.join(ROOT, 'apps/api/src/automations/automation-runner.service.ts'));
    const svc = Object.create(AutomationRunnerService.prototype);
    const yazmalar = [];
    const eskiCalisma = { id: 'r1', automationId: 'oto1', triggerPayload: {} };
    svc.prisma = {
      automationRun: {
        findMany: async () => [eskiCalisma],
        updateMany: async (a) => { yazmalar.push(a); return { count: 1 }; },
      },
      automation: { update: async (a) => { yazmalar.push(a); return {}; } },
    };
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };

    // (a) otomasyon BU süreçte çalışıyorsa dokunulmaz
    svc.running = new Set(['oto1']);
    await svc.closeStaleRunningRuns();
    ok(yazmalar.length === 0, `çalışan otomasyona dokunulmadı (yazma: ${yazmalar.length}) — sayaç bozulmuyor`);

    // (b) sahipsizse yine kapatılır (gerçek çökme artığı)
    svc.running = new Set();
    await svc.closeStaleRunningRuns();
    ok(yazmalar.length > 0, 'sahipsiz asılı çalışma yine kapatılıyor (işlev korundu)');
    const mesaj = String(yazmalar[0]?.data?.errorMessage || '');
    ok(!/Sunucu yeniden başlatıldı — çalışma yarıda kaldı\.$/.test(mesaj),
      `mesaj artık kesin "sunucu yeniden başlatıldı" demiyor: "${mesaj.slice(0, 60)}"`);
  }

  console.log('\n6) BULGU 31 — eksik değişken gönderimi engelliyor');
  {
    const { eksikDegiskenler } = require(path.join(ROOT, 'apps/api/src/automations/template-resolver.ts'));
    const ctx = { outputs: { mukellef: { unvan: 'ABC LTD' } } };

    ok(eksikDegiskenler({ mesaj: 'Sayın {{mukellef.unvan}}, merhaba' }, ctx).length === 0,
      'dolu değişkende engel yok');
    const eksik = eksikDegiskenler({ mesaj: 'Sayın {{mukellef.unvan}}, {{donem}} döneminde faturanız işlendi' }, ctx);
    ok(eksik.includes('donem'), `eksik değişken bulundu: ${eksik.join(',')} — "Sayın , döneminde..." böyle oluşuyordu`);
    ok(eksikDegiskenler({ mesaj: 'Sayın {{yok.hic}}' }, ctx).length === 1, 'çözülemeyen yol eksik sayılıyor');
    ok(eksikDegiskenler({ mesaj: 'Sayın {{bos}}' }, { outputs: { bos: '   ' } }).length === 1,
      'boşluktan ibaret değer de eksik — sonuç aynı ("Sayın ,")');
    ok(eksikDegiskenler({ sayi: '{{adet}}' }, { outputs: { adet: 0 } }).length === 0,
      'SIFIR geçerli bir değer, eksik sayılmıyor');
    ok(eksikDegiskenler({ a: { b: ['{{yok}}'] } }, ctx).length === 1, 'iç içe yapıda da taranıyor');
  }

  console.log('\n7) BULGU 30 — saklanamayan belge "yazıldı" sayılmıyor');
  {
    const { PortalAutomationService } = require(path.join(ROOT, 'apps/api/src/portal-automation/portal-automation.service.ts'));

    const kur = (saklamaCalissin) => {
      const is = { id: 'j1', tenantId: 't1', status: 'running', jobType: 'E_TEBLIGAT_CHECK', taxpayerId: null, payload: {} };
      const yazmalar = [];
      const svc = Object.create(PortalAutomationService.prototype);
      svc.prisma = {
        portalAutomationJob: {
          findFirst: async () => is,
          update: async (a) => { yazmalar.push(a.data); Object.assign(is, a.data); return is; },
        },
        portalDocument: { findMany: async () => [] },
      };
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.withJobProgress = (p, ilerleme) => ({ ...(p || {}), ilerleme });
      svc.markCredentialSuccess = async () => {};
      svc.dvdSonuclariniKaydet = async () => 0;
      svc.storeDeclarationFromAgent = async () => {};
      svc.storePortalDocumentFromAgent = async () => {
        if (!saklamaCalissin) throw new Error('Depoya yazilamadi: S3 erisilemiyor');
      };
      return { svc, yazmalar, is };
    };

    // 40 belge indi, HİÇBİRİ saklanamadı — ajan yine "40" bildiriyor.
    const belgeler = Array.from({ length: 40 }, (_, i) => ({ belgeTuru: 'E_TEBLIGAT', referenceNo: `R${i}`, base64: 'x' }));
    {
      const { svc, is } = kur(false);
      await svc.completeJob('t1', 'j1', { documents: belgeler, recordCount: 40 });
      ok(Number(is.recordCount) === 0,
        `kayıt sayısı GERÇEKTEN saklanandan: 0 (gelen: ${is.recordCount}) — eski kodda 40 yazıyordu`);
      ok(is.status === 'failed', `iş 'failed' (gelen: ${is.status}) — hiçbiri saklanamadıysa bu başarı değil`);
      ok(/saklanamadi/i.test(String(is.errorMessage || '')), `hata mesajı açık: "${String(is.errorMessage || '').slice(0, 60)}"`);
      const mesaj = String(is.payload?.ilerleme?.message || '');
      ok(/HICBIRI YAZILAMADI|teyit edilemedi/i.test(mesaj), `ekran metni yanıltmıyor: "${mesaj.slice(0, 70)}"`);
    }

    // Hepsi saklandıysa eski davranış aynen
    {
      const { svc, is } = kur(true);
      await svc.completeJob('t1', 'j1', { documents: belgeler, recordCount: 40 });
      ok(Number(is.recordCount) === 40 && is.status === 'done',
        `sorunsuz durumda 40 kayıt / done (gelen: ${is.recordCount} / ${is.status})`);
    }

    // Kısmi: 40'ın 1'i saklandı → 'done' ama sayı gerçek ve saveErrors dolu
    {
      const { svc, is } = kur(true);
      let sayac = 0;
      svc.storePortalDocumentFromAgent = async () => { if (++sayac > 1) throw new Error('Depo doldu'); };
      await svc.completeJob('t1', 'j1', { documents: belgeler, recordCount: 40 });
      ok(Number(is.recordCount) === 1, `kısmi başarıda gerçek sayı: 1 (gelen: ${is.recordCount})`);
      ok(is.status === 'done', 'kısmi başarı hâlâ done (bir şeyler kaydedildi)');
      ok(Array.isArray(is.result?.saveErrors) && is.result.saveErrors.length > 0, 'saklanamayanlar saveErrors\'da');
      ok(is.result.saveErrors.some((m) => /Sayi uyusmuyor/i.test(m)),
        'ajanın bildirdiği sayı ile yazılan sayı farkı açıkça kaydedildi');
    }
  }

  if (failed) { console.error(`\ncift-islem-sahte-basari-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\ncift-islem-sahte-basari-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
