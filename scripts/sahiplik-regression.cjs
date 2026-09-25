#!/usr/bin/env node
/**
 * SAHİPLİK ve GÖRÜNÜRLÜK regresyonu — portal denetimi Faz E (12, 23, 47).
 *
 * 12 — `createTahsilat` hesabı titizce doğruluyordu ama MÜKELLEFİ hiç doğrulamıyordu;
 *      `createManuelTahakkuk` ne mükellefi ne hizmeti. A ofisinin kimliğiyle B ofisinin
 *      mükellefine bağlı hareket yazılabiliyor ve `listHareketler` `include: { taxpayer }`
 *      döndürdüğü için A ofisi ekranında B'nin unvanı + vergi numarası görünüyordu.
 * 23 — `completePrint` `tenantId`'yi parametre ALIYOR ama gövdede HİÇ KULLANMIYORDU:
 *      A ofisinin ajanı B ofisinin çıktısını "yazdırıldı" yapabiliyordu.
 * 47 — Satıcı VKN anahtara katılıyordu AMA yanına koşulsuz numara-only yedek anahtar da
 *      ekleniyordu ve sorgu HER ZAMAN ona da bakıyordu → VKN hiçbir işe yaramıyordu.
 *      Aynı numaranın farklı satıcılarda çıktığı durumda EKSİK FATURA gizleniyordu.
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
  console.log('1) BULGU 12 — cari kasa başka ofisin mükellefine kayıt yazamıyor');
  {
    const { CariKasaService } = require(path.join(ROOT, 'apps/api/src/cari-kasa/cari-kasa.service.ts'));
    const kur = () => {
      const yazilan = [];
      const prisma = {
        // 'tp-BIZIM' yalnız t1'e ait; 'tp-BASKA' t2'ye.
        taxpayer: {
          findFirst: async ({ where }) =>
            (where.id === 'tp-BIZIM' && where.tenantId === 't1') ? { id: 'tp-BIZIM' } : null,
        },
        cariHizmet: {
          findFirst: async ({ where }) =>
            where.id === 'h1' && where.tenantId === 't1' ? { id: 'h1', taxpayerId: 'tp-BIZIM' } : null,
        },
        cariHareket: { create: async (a) => { yazilan.push(a.data); return a.data; } },
      };
      const svc = new CariKasaService(prisma, {}, {});
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.tahsilatHesaplari = async () => [{ id: 'hesap1' }];
      return { svc, yazilan };
    };

    // (a) yabancı mükellefe tahsilat → RED
    {
      const { svc, yazilan } = kur();
      let hata = null;
      try {
        await svc.createTahsilat('t1', { taxpayerId: 'tp-BASKA', tarih: '2026-09-01', tutar: 100, accountId: 'hesap1' });
      } catch (e) { hata = e; }
      ok(!!hata, 'başka ofisin mükellefine tahsilat reddedildi');
      ok(yazilan.length === 0, `hiç kayıt yazılmadı (gelen: ${yazilan.length}) — eski kodda yazılıyordu`);
    }

    // (b) kendi mükellefimize tahsilat → geçer
    {
      const { svc, yazilan } = kur();
      await svc.createTahsilat('t1', { taxpayerId: 'tp-BIZIM', tarih: '2026-09-01', tutar: 100, accountId: 'hesap1' });
      ok(yazilan.length === 1 && yazilan[0].taxpayerId === 'tp-BIZIM', 'kendi mükellefimizde işlev bozulmadı');
    }

    // (c) yabancı mükellefe manuel tahakkuk → RED
    {
      const { svc, yazilan } = kur();
      let hata = null;
      try {
        await svc.createManuelTahakkuk('t1', { taxpayerId: 'tp-BASKA', tarih: '2026-09-01', tutar: 50, donem: '2026-09' });
      } catch (e) { hata = e; }
      ok(!!hata && yazilan.length === 0, 'başka ofisin mükellefine manuel tahakkuk reddedildi');
    }

    // (d) hizmet BAŞKA mükellefe aitse → RED (ofis içi karışma)
    {
      const { svc, yazilan } = kur();
      const prismaHizmet = svc.prisma || null;
      // hizmet h2: bu ofise ait ama BAŞKA mükellefin
      svc.prisma.cariHizmet.findFirst = async ({ where }) =>
        where.id === 'h2' && where.tenantId === 't1' ? { id: 'h2', taxpayerId: 'tp-DIGER' } : null;
      let hata = null;
      try {
        await svc.createManuelTahakkuk('t1', { taxpayerId: 'tp-BIZIM', hizmetId: 'h2', tarih: '2026-09-01', tutar: 50, donem: '2026-09' });
      } catch (e) { hata = e; }
      ok(!!hata && yazilan.length === 0, 'hizmet başka mükellefinse reddedildi (ofis içi karışma)');
      void prismaHizmet;
    }

    // (e) doğru hizmetle geçer
    {
      const { svc, yazilan } = kur();
      await svc.createManuelTahakkuk('t1', { taxpayerId: 'tp-BIZIM', hizmetId: 'h1', tarih: '2026-09-01', tutar: 50, donem: '2026-09' });
      ok(yazilan.length === 1, 'doğru mükellef + doğru hizmet geçiyor');
    }
  }

  console.log('\n2) BULGU 23 — başka ofisin fiş çıktısı "yazdırıldı" yapılamıyor');
  {
    const { FisYazdirmaService } = require(path.join(ROOT, 'apps/api/src/fis-yazdirma/fis-yazdirma.service.ts'));
    const kur = () => {
      const rows = [{ id: 'o1', tenantId: 't1', printStatus: 'PRINTING' }];
      const svc = Object.create(FisYazdirmaService.prototype);
      svc.prisma = {
        fisYazdirmaOutput: {
          updateMany: async ({ where, data }) => {
            const h = rows.filter((r) => r.id === where.id && (!where.tenantId || r.tenantId === where.tenantId));
            for (const r of h) Object.assign(r, data);
            return { count: h.length };
          },
          findFirst: async ({ where }) =>
            rows.find((r) => r.id === where.id && (!where.tenantId || r.tenantId === where.tenantId)) || null,
        },
      };
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      return { svc, rows };
    };

    {
      const { svc, rows } = kur();
      let hata = null;
      try { await svc.completePrint('t2', 'o1', true); } catch (e) { hata = e; }
      ok(!!hata, 'yabancı ofis çağrısı hata aldı');
      ok(rows[0].printStatus === 'PRINTING',
        `durum DEĞİŞMEDİ (gelen: ${rows[0].printStatus}) — eski kodda DONE yazılıyordu`);
    }
    {
      const { svc, rows } = kur();
      await svc.completePrint('t1', 'o1', true);
      ok(rows[0].printStatus === 'DONE', 'kendi ofisinde işlev bozulmadı');
    }
    {
      const { svc, rows } = kur();
      await svc.completePrint('t1', 'o1', false, 'Yazici kagit bekliyor');
      ok(rows[0].printStatus === 'FAILED' && /kagit/i.test(rows[0].printError || ''), 'hata yolu da çalışıyor');
    }
  }

  console.log('\n3) BULGU 47 — satıcı VKN artık gerçekten ayırt ediyor');
  {
    const { GenelSorgularService } = require(path.join(ROOT, 'apps/api/src/genel-sorgular/genel-sorgular.service.ts'));

    /** Luca'da: AYNI numara, A satıcısında var (görselli). DVD'de: aynı numara, B satıcısından. */
    const kur = (lucaKayitlari, dvdFaturalari) => {
      const svc = Object.create(GenelSorgularService.prototype);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.prisma = {
        genelSorguSonucu: {
          findMany: async () => [{
            taxpayerId: 'tp1', donem: '2026-08', sorguTarihi: new Date('2026-09-01'),
            taxpayer: { id: 'tp1', companyName: 'TEST' },
            veri: { faturalar: dvdFaturalari },
          }],
        },
        earsivFatura: { findMany: async () => lucaKayitlari },
      };
      return svc;
    };

    const dvdB = [{ faturaNo: 'GIB2026000000161', saticiVkn: '2222222222', saticiUnvan: 'B FIRMA', toplamTutar: 100, vergilerTutari: 18, odenecekTutar: 118 }];

    // (a) Luca'da yalnız A satıcısının faturası var → B'ninki EKSİK görünmeli
    {
      const svc = kur(
        [{ taxpayerId: 'tp1', faturaNo: 'GIB2026000000161', saticiVergiNo: '1111111111', pdfStorageKey: 'k1', htmlStorageKey: null, belgeKaynak: 'LUCA', faturaTarihi: new Date() }],
        dvdB,
      );
      const r = await svc.eksikGorseller('t1', {});
      const rows = r.rows || r.satirlar || (Array.isArray(r) ? r : []);
      ok(rows.length === 1, `B satıcısının faturası listede (gelen: ${rows.length} satır) — eski kodda GİZLENİYORDU`);
      ok(rows[0] && rows[0].durum === 'LUCA_YOK', `durum LUCA_YOK (gelen: ${rows[0] && rows[0].durum})`);
    }

    // (b) Luca'da B satıcısının faturası GÖRSELLİ var → listede olmamalı
    {
      const svc = kur(
        [{ taxpayerId: 'tp1', faturaNo: 'GIB2026000000161', saticiVergiNo: '2222222222', pdfStorageKey: 'k1', htmlStorageKey: null, belgeKaynak: 'LUCA', faturaTarihi: new Date() }],
        dvdB,
      );
      const r = await svc.eksikGorseller('t1', {});
      const rows = r.rows || r.satirlar || (Array.isArray(r) ? r : []);
      ok(rows.length === 0, `doğru satıcı eşleşince liste boş (gelen: ${rows.length}) — yanlış alarm yok`);
    }

    // (c) Luca kaydında VKN YOKSA yedek anahtar hâlâ çalışıyor (eski davranış korundu)
    {
      const svc = kur(
        [{ taxpayerId: 'tp1', faturaNo: 'GIB2026000000161', saticiVergiNo: '', pdfStorageKey: 'k1', htmlStorageKey: null, belgeKaynak: 'LUCA', faturaTarihi: new Date() }],
        dvdB,
      );
      const r = await svc.eksikGorseller('t1', {});
      const rows = r.rows || r.satirlar || (Array.isArray(r) ? r : []);
      ok(rows.length === 0,
        `Luca kaydında VKN yoksa numara ile eşleşiyor (gelen: ${rows.length}) — canlıda 2.470 alışın 609'u böyle`);
    }

    // (d) Luca'da kayıt var ama GÖRSEL yok → GORSEL_YOK
    {
      const svc = kur(
        [{ taxpayerId: 'tp1', faturaNo: 'GIB2026000000161', saticiVergiNo: '2222222222', pdfStorageKey: null, htmlStorageKey: null, belgeKaynak: 'LUCA', faturaTarihi: new Date() }],
        dvdB,
      );
      const r = await svc.eksikGorseller('t1', {});
      const rows = r.rows || r.satirlar || (Array.isArray(r) ? r : []);
      ok(rows.length === 1 && rows[0].durum === 'GORSEL_YOK', `görselsiz kayıt GORSEL_YOK (gelen: ${rows[0] && rows[0].durum})`);
    }
  }

  console.log('\n4) BULGU 03 — KDV görsel onayı yabancı anahtarı reddediyor');
  {
    const { KdvControlService } = require(path.join(ROOT, 'apps/api/src/kdv-control/kdv-control.service.ts'));
    const kur = () => {
      const yazilan = [];
      const svc = Object.create(KdvControlService.prototype);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.prisma = { receiptImage: { create: async (a) => { yazilan.push(a.data); return { id: 'img1', ...a.data }; } } };
      svc.storage = { getObjectMeta: async () => ({ sizeBytes: 1234, contentType: 'image/jpeg' }) };
      svc.findSession = async () => ({ id: 's1', tenantId: 't1' });
      svc.assertSessionUnlocked = () => {};
      svc.runOcrForImage = async () => {};
      return { svc, yazilan };
    };

    // (a) e-Arşiv kural tabanlı anahtarı (tahmin edilebilir) — REDDEDİLMELİ
    {
      const { svc, yazilan } = kur();
      let hata = null;
      try {
        await svc.confirmImageUpload('s1', 't1', {
          s3Key: 't2/earsiv/tpX/2026-08/alis-luca/GIB2026000000161.pdf',
          originalName: 'x.pdf', mimeType: 'application/pdf',
        });
      } catch (e) { hata = e; }
      ok(!!hata, 'başka ofisin kural tabanlı e-Arşiv anahtarı reddedildi');
      ok(yazilan.length === 0, `hiç kayıt yazılmadı (gelen: ${yazilan.length}) — eski kodda bağlanıyordu`);
    }

    // (b) AYNI ofis ama BAŞKA oturum — reddedilmeli (oturum bağı)
    {
      const { svc, yazilan } = kur();
      let hata = null;
      try {
        await svc.confirmImageUpload('s1', 't1', { s3Key: 't1/BASKA-OTURUM/abc.jpg', originalName: 'x.jpg', mimeType: 'image/jpeg' });
      } catch (e) { hata = e; }
      ok(!!hata && yazilan.length === 0, 'aynı ofiste bile başka oturumun anahtarı reddedildi');
    }

    // (c) Presign'in GERÇEKTEN ürettiği biçim — geçmeli
    {
      const { svc, yazilan } = kur();
      const img = await svc.confirmImageUpload('s1', 't1', {
        s3Key: 't1/s1/0f9b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.jpg',
        originalName: 'fis.jpg', mimeType: 'image/jpeg',
      });
      ok(yazilan.length === 1 && img && img.id === 'img1', 'kendi oturumunun anahtarı geçiyor (işlev bozulmadı)');
      ok(yazilan[0].sizeBytes === 1234, 'S3 üstverisi kaydediliyor');
    }

    // (d) mihsap:// biçimi — canlıdaki 15.168 kaydın biçimi; bu uçtan zaten geçmiyor
    {
      const { svc, yazilan } = kur();
      let hata = null;
      try {
        await svc.confirmImageUpload('s1', 't1', { s3Key: 'mihsap://cmo1fferl006xcaoqegqn5mc0', originalName: 'x.jpg', mimeType: 'image/jpeg' });
      } catch (e) { hata = e; }
      ok(!!hata && yazilan.length === 0, 'mihsap:// anahtarı bu uçtan geçmiyor (zaten geçmiyordu)');
    }
  }

  if (failed) { console.error(`\nsahiplik-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nsahiplik-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
