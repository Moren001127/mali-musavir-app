#!/usr/bin/env node
/**
 * SESSİZ KAYIP / YANILTMA regresyonu — portal denetimi kalan grup (20, 25, 32, 35, 36, 37, 40, 49).
 *
 * 20 — KDV genel bakış hata hâlinde satırı SIFIRLARLA ve durum='bos' ile döndürüyordu
 *      ("bu mükellefte KDV yok" gibi) ve toplamlar sessizce eksik çıkıyordu. Ayrıca
 *      `veriGuveni` hesaplanıp durum kararında KULLANILMIYORDU → kaynak farkı olan
 *      mükellef "Hazır" görünüyordu.
 * 32 — e-Tebligat "okundu" damgası presigned bağlantı ÜRETİLMEDEN ÖNCE yazılıyordu:
 *      depo düşükken mükellef belgeyi görmeden tebligat okundu sayılıyordu.
 * 35 — Mükellef "Dosyalar" listesi en yeni 300 belgeyi çekip SONRA bellekte süzüyordu;
 *      otomatik inen belgeler kotayı doldurunca mükellefin kendi dosyaları görünmüyordu.
 * 36 — Eski belge sürümü GÜNCEL belgenin türüyle iniyordu (JPG olan v1, PDF diye).
 * 37 — Denetim günlüğü "kim ne zaman" yazıyor, "neyi" yazmıyordu; başarısız denemeler
 *      hiç iz bırakmıyordu; günlük yazılamazsa hata yutuluyordu.
 * 40 — Şablon sırası kaydedilmese de `{ ok: true }` dönüyordu.
 * 49 — Beyanname durumu geri alınınca `onayTarihi` temizlenmiyordu.
 *
 * Gerçek servisler sahte prisma ile çağrılır — kaynakta metin ARANMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

(async () => {
  console.log('1) BULGU 35 — mükellefin dosyaları otomatik belgelerin altında kaybolmuyor');
  {
    const { TaxpayerPortalService } = require(path.join(ROOT, 'apps/api/src/taxpayer-portal/taxpayer-portal.service.ts'));
    // 1200 otomatik belge (en yeni), sonra 3 ELLE yüklenmiş belge.
    const belgeler = [];
    for (let i = 0; i < 1200; i++) {
      belgeler.push({ id: `o${i}`, title: `SGK_TAHAKKUK ${i}`, category: 'SGK', notes: null, s3Key: `k${i}`, tags: [], createdAt: new Date(Date.now() - i * 1000) });
    }
    for (let i = 0; i < 3; i++) {
      belgeler.push({ id: `e${i}`, title: `Kira sozlesmesi ${i}.pdf`, category: 'SOZLESME', notes: null, s3Key: `e${i}`, tags: [], createdAt: new Date(Date.now() - (5000 + i) * 1000) });
    }
    let sorguSayisi = 0;
    const svc = Object.create(TaxpayerPortalService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.prisma = {
      document: {
        findMany: async ({ skip = 0, take }) => { sorguSayisi++; return belgeler.slice(skip, skip + take); },
      },
    };
    const r = await svc.getEvraklar('tp1');
    ok(r.length === 3, `elle yüklenen 3 belgenin hepsi geldi (gelen: ${r.length}) — eski kodda 0 geliyordu`);
    ok(sorguSayisi > 1, `sayfa sayfa okundu (${sorguSayisi} sorgu) — tek 300'lük çekim değil`);
    ok(r.every((d) => d.id.startsWith('e')), 'yalnız elle yüklenenler döndü (otomatikler süzüldü)');
  }

  console.log('\n2) BULGU 32 — "okundu" damgası bağlantı üretilmeden vurulmuyor');
  {
    const { TaxpayerPortalService } = require(path.join(ROOT, 'apps/api/src/taxpayer-portal/taxpayer-portal.service.ts'));
    const kur = (depoCalissin) => {
      const doc = { id: 'd1', taxpayerId: 'tp1', tenantId: 't1', storageKey: 'k1', title: 'Tebligat', mimeType: 'application/pdf', viewedAt: null };
      const yazmalar = [];
      const svc = Object.create(TaxpayerPortalService.prototype);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.prisma = {
        portalDocument: {
          findFirst: async () => doc,
          update: async (a) => { yazmalar.push(a.data); Object.assign(doc, a.data); return doc; },
        },
      };
      svc.storage = {
        getPresignedInlineUrl: async () => {
          if (!depoCalissin) throw new Error('S3 erisilemiyor');
          return 'https://ornek/url';
        },
      };
      return { svc, doc, yazmalar };
    };

    {
      const { svc, doc, yazmalar } = kur(false);
      let hata = null;
      try { await svc.getBelgeViewUrl('tp1', 't1', 'tebligat', 'd1'); } catch (e) { hata = e; }
      ok(!!hata, 'depo düşükken hata veriliyor');
      ok(yazmalar.length === 0 && !doc.viewedAt,
        `belge GÖRÜLMEDİ, "okundu" damgası VURULMADI — eski kodda vuruluyordu (yazma: ${yazmalar.length})`);
    }
    {
      const { svc, doc } = kur(true);
      const r = await svc.getBelgeViewUrl('tp1', 't1', 'tebligat', 'd1');
      ok(!!r.url && !!doc.viewedAt, 'bağlantı üretilince damga vuruluyor (işlev bozulmadı)');
    }
  }

  console.log('\n3) BULGU 36 — eski sürüm KENDİ türüyle iniyor');
  {
    const { DocumentsService } = require(path.join(ROOT, 'apps/api/src/documents/documents.service.ts'));
    const svc = Object.create(DocumentsService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    const doc = {
      id: 'd1', title: 'Kira', mimeType: 'application/pdf', s3Key: 't1/tp1/guncel.pdf',
      versions: [{ versionNo: 1, s3Key: 't1/tp1/eski.jpg' }, { versionNo: 2, s3Key: 't1/tp1/guncel.pdf' }],
    };
    svc.findOne = async () => doc;
    let verilenMime = null;
    svc.storage = {
      getPresignedDownloadUrl: async () => 'https://ornek/indir',
      getPresignedInlineUrl: async (_k, _f, ct) => { verilenMime = ct; return 'https://ornek/onizle'; },
    };

    const v1 = await svc.getDownloadUrl('d1', 't1', 1);
    ok(v1.mimeType === 'image/jpeg', `v1 JPG olarak iniyor (gelen: ${v1.mimeType}) — eski kodda application/pdf'ti`);
    ok(/\.jpg$/i.test(v1.filename), `dosya adı uzantısı doğru: ${v1.filename}`);

    const guncel = await svc.getDownloadUrl('d1', 't1');
    ok(guncel.mimeType === 'application/pdf', 'sürüm verilmezse güncel belgenin türü (davranış korundu)');

    await svc.getPreviewUrl('d1', 't1', 1);
    ok(verilenMime === 'image/jpeg', `önizlemede Content-Type doğru (gelen: ${verilenMime}) — tarayıcı bozuk göstermez`);
  }

  console.log('\n4) BULGU 40 — şablon sırası kaydedilemezse "tamam" denmiyor');
  {
    const { MessageTemplatesService } = require(path.join(ROOT, 'apps/api/src/message-templates/message-templates.service.ts'));
    const kur = (islemCalissin) => {
      const svc = Object.create(MessageTemplatesService.prototype);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.prisma = {
        $transaction: async () => { if (!islemCalissin) throw new Error('DB baglantisi koptu'); return []; },
      };
      Object.defineProperty(svc, 'model', {
        value: { findMany: async () => [{ id: 'a' }, { id: 'b' }], update: async (x) => x },
        configurable: true,
      });
      return svc;
    };
    {
      const svc = kur(false);
      let hata = null;
      try { await svc.reorder('t1', ['a', 'b']); } catch (e) { hata = e; }
      ok(!!hata, 'işlem patlayınca hata yukarı bildiriliyor — eski kodda { ok: true } dönüyordu');
      ok(hata && /kaydedilemedi/i.test(hata.message || ''), `mesaj kullanıcıya ne olduğunu söylüyor: "${hata && String(hata.message).slice(0, 50)}"`);
    }
    {
      const svc = kur(true);
      const r = await svc.reorder('t1', ['a', 'b']);
      ok(r.ok === true && r.sirali === 2, `sorunsuz durumda { ok: true, sirali: 2 } (gelen: ${JSON.stringify(r)})`);
    }
  }

  console.log('\n5) BULGU 49 — durum geri alınınca onay tarihi siliniyor');
  {
    const { BeyannameTakipService } = require(path.join(ROOT, 'apps/api/src/beyanname-takip/beyanname-takip.service.ts'));
    const svc = Object.create(BeyannameTakipService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    let yazilan = null;
    svc.prisma = {
      taxpayer: { findFirst: async () => ({ id: 'tp1' }) },
      beyanDurumu: { upsert: async (a) => { yazilan = a.update; return a.update; } },
    };

    await svc.setBeyanDurumu?.('t1', 'tp1', 'KDV1', '2026-08', { durum: 'onaylandi' })
      ?? (svc.upsertDurum && await svc.upsertDurum('t1', 'tp1', 'KDV1', '2026-08', { durum: 'onaylandi' }));
    ok(yazilan && yazilan.onayTarihi instanceof Date, 'onaylandı → onay tarihi yazılıyor');

    yazilan = null;
    await svc.setBeyanDurumu?.('t1', 'tp1', 'KDV1', '2026-08', { durum: 'beklemede' })
      ?? (svc.upsertDurum && await svc.upsertDurum('t1', 'tp1', 'KDV1', '2026-08', { durum: 'beklemede' }));
    ok(yazilan && yazilan.onayTarihi === null,
      `durum geri alınınca onay tarihi NULL (gelen: ${yazilan && String(yazilan.onayTarihi)}) — eski kodda eski damga kalıyordu`);
  }

  console.log('\n6) BULGU 37 — denetim günlüğü artık "neyi" de yazıyor');
  {
    const { AuditInterceptor } = require(path.join(ROOT, 'apps/api/src/audit/audit.interceptor.ts'));
    const { of, throwError } = require(path.join(ROOT, 'apps/api/node_modules/rxjs'));
    const kayitlar = [];
    const ai = new AuditInterceptor({ auditLog: { create: async (a) => { kayitlar.push(a.data); return a.data; } } });
    ai.logger = { warn() {}, log() {}, error() {}, debug() {} };

    const ctx = (method, url, body) => ({
      switchToHttp: () => ({
        getRequest: () => ({ method, url, body, ip: '1.2.3.4', headers: { 'user-agent': 'test' }, user: { sub: 'u1', tenantId: 't1' } }),
      }),
    });
    const bekle = () => new Promise((r) => setTimeout(r, 20));

    // Başarılı: kimlik + eylem eki + gövde
    await new Promise((res) => {
      ai.intercept(ctx('POST', '/api/v1/beyan-kayitlari/clxabc123def456ghi789/iptal', { neden: 'yanlis', password: 's3cret' }), { handle: () => of({ ok: true }) })
        .subscribe({ next: () => {}, complete: res });
    });
    await bekle();
    const k1 = kayitlar[0];
    ok(k1 && k1.resource === 'beyan-kayitlari', `modül doğru: ${k1 && k1.resource}`);
    ok(k1 && k1.resourceId === 'clxabc123def456ghi789', `KAYIT KİMLİĞİ yazıldı: ${k1 && k1.resourceId} — eski kodda boştu`);
    ok(k1 && k1.action === 'CREATE_IPTAL', `eylem yoldan zenginleşti: ${k1 && k1.action} — eski kodda düz "CREATE"ti`);
    ok(k1 && k1.newData && k1.newData.istek && k1.newData.istek.neden === 'yanlis', 'istek gövdesi kaydedildi (NE değişti)');
    ok(k1 && k1.newData.istek.password === '***', 'parola MASKELENDİ — gövde olduğu gibi saklanmıyor');
    ok(k1 && k1.userAgent === 'test', 'userAgent yazıldı — eski kodda hiç yazılmıyordu');

    // Başarısız: iz bırakmalı
    kayitlar.length = 0;
    await new Promise((res) => {
      ai.intercept(ctx('DELETE', '/api/v1/mizan/clxzzz111222333444', null), { handle: () => throwError(() => Object.assign(new Error('kesin kayitli mizan'), { status: 400 })) })
        .subscribe({ next: () => {}, error: () => res() });
    });
    await bekle();
    const k2 = kayitlar[0];
    ok(!!k2, 'BAŞARISIZ deneme de iz bıraktı — eski kodda hiç kaydedilmiyordu');
    ok(k2 && k2.action === 'DELETE_BASARISIZ', `eylem başarısız işaretli: ${k2 && k2.action}`);
    ok(k2 && /kesin kayitli/.test(String(k2.newData?.hata || '')), 'reddedilme sebebi kaydedildi');
    ok(k2 && k2.newData?.durumKodu === 400, `durum kodu kaydedildi: ${k2 && k2.newData?.durumKodu}`);

    // GET yazılmaz (okuma günlüğe girmez — eski davranış korundu)
    kayitlar.length = 0;
    await new Promise((res) => {
      ai.intercept(ctx('GET', '/api/v1/taxpayers', null), { handle: () => of([]) }).subscribe({ next: () => {}, complete: res });
    });
    await bekle();
    ok(kayitlar.length === 0, 'okuma istekleri günlüğe girmiyor (davranış korundu)');
  }

  console.log('\n7) BULGU 20 — KDV genel bakış hatayı "veri yok" diye gizlemiyor');
  {
    const { KdvBeyannameService } = require(path.join(ROOT, 'apps/api/src/kdv-beyanname/kdv-beyanname.service.ts'));
    const svc = Object.create(KdvBeyannameService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.genelBakisCache = new Map();
    svc.formatMukellefAd = (m) => m.companyName || 'MUKELLEF';

    const kdvCfg = { beyanConfig: { kdv1Period: 'AYLIK' }, startDate: null, endDate: null, isActive: true };
    const mukellefler = [
      { id: 'm1', companyName: 'SAGLAM A.S.', ...kdvCfg },   // temiz: güven kesin
      { id: 'm2', companyName: 'KONTROL LTD.', ...kdvCfg },  // güven kontrol_gerekli → "hazir" OLMAMALI
      { id: 'm3', companyName: 'PATLAYAN LTD.', ...kdvCfg }, // ön-hazırlık patlıyor → durum 'hata'
    ];
    const onHazirlik = (guven) => ({
      mukellefAd: 'X',
      satis: { oranlar: [{ adet: 5 }], faturaAdet: 5 },
      alis: { oranlar: [{ adet: 3 }], faturaAdet: 3, tevkifatli: { adet: 0, kdv: 0 } },
      sonuc: { hesaplananKdv: 1000, indirilecekKdv: 400, devredenKdv: 0, odenecekKdv: 600, sonrakiAyaDevreden: 0 },
      veriGuveni: { puan: guven === 'kesin' ? 100 : 60, seviye: guven },
      kaliteRapor: { tahminFaturaOrani: 0 },
    });

    svc.prisma = {
      taxpayer: { findMany: async () => mukellefler },
      beyanKaydi: { findMany: async () => [] },
      beyanDurumu: { findMany: async () => [] },
      kdvControlSession: { findMany: async () => [] },
    };
    svc.kdv1OnHazirlik = async ({ mukellefId }) => {
      if (mukellefId === 'm3') throw new Error('mizan okunamadi');
      return onHazirlik(mukellefId === 'm2' ? 'kontrol_gerekli' : 'kesin');
    };

    const r = await svc.genelBakis('t1', '2026-08').catch((e) => ({ hata: e.message }));
    if (r.hata) {
      ok(false, `genelBakis çağrılamadı: ${r.hata.slice(0, 90)} — sınama bu servise uyarlanmalı`);
    } else {
      const bul = (id) => (r.satirlar || []).find((x) => x.mukellefId === id);
      ok(bul('m1')?.durum === 'hazir', `güveni kesin olan "hazir" (gelen: ${bul('m1')?.durum})`);
      ok(bul('m2')?.durum === 'eksik',
        `güveni kontrol gerektiren ARTIK "hazir" DEĞİL (gelen: ${bul('m2')?.durum}) — eski kodda "hazir"dı`);
      ok(bul('m3')?.durum === 'hata',
        `hesaplanamayan "hata" (gelen: ${bul('m3')?.durum}) — eski kodda "bos" diye gizleniyordu`);
      ok(bul('m3')?.odenecekKdv === null, 'hesaplanamayan satırda tutar SIFIR değil NULL');
      ok(!!bul('m3')?.hataMesaji, 'hata sebebi satırda taşınıyor');
      ok(r.toplam?.hataAdet === 1, `toplamda hata sayısı bildiriliyor (gelen: ${r.toplam?.hataAdet})`);
      ok(Number(r.toplam?.toplamOdenecek) === 1200,
        `toplam yalnız hesaplanabilenlerden: 600+600=1.200 (gelen: ${r.toplam?.toplamOdenecek})`);
    }
  }

  if (failed) { console.error(`\nsessiz-kayip-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nsessiz-kayip-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
