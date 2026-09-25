#!/usr/bin/env node
/**
 * GÖRÜNÜRLÜK regresyonu — portal denetimi Faz E görünürlük grubu (33, 34, 42, 45, 46).
 *
 * 33 — Sistem sağlığı sorgularının HİÇBİRİNDE `tenantId` yoktu: başka ofisin ajanı ping
 *      attığında bizim panelimiz "sağlıklı" gösteriyordu. Ayrıca `mihsapToken` diye bir
 *      model ŞEMADA YOK (doğrusu `mihsapSession`) — o kontrol hiç çalışmamış.
 * 34 — Gecikmiş sayacı SNOOZED'ı dışlıyor ve `snoozedUntil`'e bakmıyordu; repoda
 *      SNOOZED→OPEN geri dönüşü de yok → ertelemesi biten görev sayaçta hiç görünmüyordu.
 * 42 — HGS özeti son kaydı alıyor ama `durum`a bakmıyordu; hatalı sorguya da
 *      `ihlalSayisi: 0` yazıldığı için TEK başarısız sorgu ihlalleri panodan siliyordu.
 * 45 — İş yükü sırası `EVRAK_BEKLIYOR`'u tamamen dışlıyor + 10'a kırpıyordu; ekranın
 *      "Geç Kalanlar" süzgeci o 10 kayıt üzerinde çalıştığı için 208 gündür evrak bekleyen
 *      mükellef orada ASLA görünmüyordu.
 * 46 — Bekleme süresi genel `updatedAt`'ten hesaplanıyordu; herhangi bir alan güncellenince
 *      gecikme sıfırlanıyordu (şemanın kendi notu da bunu söylüyor).
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
  console.log('1) BULGU 33 — sistem sağlığı ofis bazlı');
  {
    const { SystemHealthService } = require(path.join(ROOT, 'apps/api/src/system-health/system-health.service.ts'));
    const sorgular = [];
    const uyarilar = [];
    const svc = Object.create(SystemHealthService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.prisma = {
      tenant: { findMany: async () => [{ id: 't1' }, { id: 't2' }] },
      // t1'in ajanı DÜŞÜK (eski ping), t2'nin ajanı SAĞLIKLI (az önce ping attı)
      agentStatus: {
        findFirst: async ({ where }) => {
          sorgular.push(['agentStatus', where]);
          if (where.tenantId === 't2') return { lastPing: new Date() };
          return { lastPing: new Date(Date.now() - 3 * 60 * 60 * 1000) };
        },
      },
      lucaSession: { findFirst: async ({ where }) => { sorgular.push(['lucaSession', where]); return null; } },
      mihsapSession: { findFirst: async ({ where }) => { sorgular.push(['mihsapSession', where]); return null; } },
      lucaFetchJob: { count: async ({ where }) => { sorgular.push(['lucaFetchJob', where]); return 0; }, findMany: async () => [] },
      systemHealthCheck: {
        findFirst: async () => null,
        create: async (a) => { uyarilar.push(a.data); return a.data; },
        update: async (a) => a.data,
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
      $queryRaw: async () => [],
    };
    svc.checkModuleHashes = async () => {};
    svc.checkDbHealth = async () => {};
    svc.notifications = null;

    await svc.runAllChecks();

    const tenantsiz = sorgular.filter(([, w]) => !w || w.tenantId === undefined);
    ok(tenantsiz.length === 0,
      tenantsiz.length === 0
        ? 'ajan/oturum/kuyruk sorgularının HEPSİ ofis süzgeçli'
        : `${tenantsiz.length} sorguda tenantId YOK: ${tenantsiz.map(([a]) => a).join(',')}`);

    ok(sorgular.some(([ad]) => ad === 'mihsapSession'),
      'mihsapSession sorgulanıyor — eski kod ŞEMADA OLMAYAN `mihsapToken`u çağırıp sessizce patlıyordu');

    const pingUyarilari = uyarilar.filter((u) => String(u.type || '').startsWith('AGENT_PING'));
    const t1Uyari = pingUyarilari.filter((u) => u.tenantId === 't1');
    const t2Uyari = pingUyarilari.filter((u) => u.tenantId === 't2');
    ok(t1Uyari.length > 0, `düşük ajanı olan ofis (t1) uyarı aldı (${t1Uyari.length})`);
    ok(t2Uyari.length === 0, `sağlıklı ofis (t2) uyarı ALMADI (${t2Uyari.length}) — eski kodda ikisi karışıyordu`);
    ok(uyarilar.every((u) => u.tenantId), 'her uyarı bir ofise yazılıyor');
  }

  console.log('\n2) BULGU 33 — uyarı listesi ofisin kendi uyarılarını + altyapıyı veriyor');
  {
    const { SystemHealthService } = require(path.join(ROOT, 'apps/api/src/system-health/system-health.service.ts'));
    let kullanilanWhere = null;
    const svc = Object.create(SystemHealthService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    svc.prisma = {
      systemHealthCheck: {
        findMany: async ({ where }) => { kullanilanWhere = where; return []; },
      },
    };
    await svc.getActiveAlerts('t1');
    ok(Array.isArray(kullanilanWhere?.OR), 'ofis verilince OR süzgeci kuruluyor');
    ok(kullanilanWhere.OR.some((o) => o.tenantId === 't1'), 'ofisin kendi uyarıları');
    ok(kullanilanWhere.OR.some((o) => o.tenantId === null), 'ofisten bağımsız altyapı uyarıları (tenantId null)');
  }

  console.log('\n3) BULGU 34 — ertelemesi biten görev gecikmiş sayılıyor');
  {
    const { TasksService } = require(path.join(ROOT, 'apps/api/src/tasks/tasks.service.ts'));
    const svc = Object.create(TasksService.prototype);
    let gecikmisWhere = null;
    let cagri = 0;
    // `db` bir getter (prisma'yı döndürüyor) — prisma'yı doğrudan kuruyoruz.
    svc.prisma = {
      task: {
        count: async ({ where }) => { if (++cagri === 2) gecikmisWhere = where; return 0; },
      },
    };
    const gunBasi = new Date('2026-09-25T00:00:00+03:00');
    await svc.ajandaSayaclari('t1', { gunBasi, gunSonu: gunBasi, haftaSonu: gunBasi });

    const kosullar = gecikmisWhere?.OR || [];
    ok(kosullar.length >= 2, `gecikmiş sayacı OR koşuluyla kuruluyor (${kosullar.length} dal)`);
    const snoozedDal = kosullar.find((k) => k.status === 'SNOOZED' && k.snoozedUntil && k.snoozedUntil.lt);
    ok(!!snoozedDal, 'süresi DOLMUŞ ertelenmiş görevler sayaca dahil — eski kodda SNOOZED tamamen dışlanıyordu');
    ok(!!kosullar.find((k) => Array.isArray(k.status?.in) && k.status.in.includes('OPEN')),
      'normal açık/işlemdeki gecikmişler korundu');
  }

  console.log('\n4) BULGU 42 — tek başarısız HGS sorgusu ihlalleri silmiyor');
  {
    const { GaleriService } = require(path.join(ROOT, 'apps/api/src/galeri/galeri.service.ts'));
    const kur = (sonuclar) => {
      const svc = Object.create(GaleriService.prototype);
      svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
      svc.prisma = {
        arac: {
          count: async () => 1,
          findMany: async () => [{ id: 'a1', hgsSonuclari: sonuclar }],
        },
      };
      return svc;
    };

    // Son sorgu HATALI (ihlalSayisi 0 yazılmış), ondan önceki BAŞARILI sorguda 3 ihlal var
    {
      const svc = kur([
        { durum: 'hatali', ihlalSayisi: 0, toplamTutar: 0, sorguTarihi: new Date('2026-09-25') },
        { durum: 'basarili', ihlalSayisi: 3, toplamTutar: 1500, sorguTarihi: new Date('2026-09-18') },
      ]);
      const o = await svc.ozet('t1');
      ok(o.toplamIhlal === 3, `ihlaller duruyor: 3 (gelen: ${o.toplamIhlal}) — eski kodda 0'a düşüyordu`);
      ok(Number(o.toplamTutar) === 1500, `tutar korundu: 1.500 (gelen: ${o.toplamTutar})`);
      ok(o.sonSorgusuBasarisiz === 1, 'son denemesi patlayan araç sayısı bildiriliyor');
    }

    // Son sorgu BAŞARILI ve gerçekten 0 ihlal → 0 göstermeli (yanlış alarm yok)
    {
      const svc = kur([
        { durum: 'basarili', ihlalSayisi: 0, toplamTutar: 0, sorguTarihi: new Date('2026-09-25') },
        { durum: 'basarili', ihlalSayisi: 3, toplamTutar: 1500, sorguTarihi: new Date('2026-09-18') },
      ]);
      const o = await svc.ozet('t1');
      ok(o.toplamIhlal === 0 && o.sonSorgusuBasarisiz === 0,
        `gerçekten temizlenmiş araçta 0 gösteriliyor (gelen: ${o.toplamIhlal})`);
    }

    // `durum` alanı boş eski kayıtlarda eski davranış (en son kayıt)
    {
      const svc = kur([{ ihlalSayisi: 2, toplamTutar: 800, sorguTarihi: new Date('2026-09-25') }]);
      const o = await svc.ozet('t1');
      ok(o.toplamIhlal === 2, `durum alanı boş eski kayıt yine okunuyor (gelen: ${o.toplamIhlal})`);
    }
  }

  console.log('\n5) BULGU 45 + 46 — evrak bekleyenler sırada, gecikme sıfırlanmıyor');
  {
    const { TaxpayersService } = require(path.join(ROOT, 'apps/api/src/taxpayers/taxpayers.service.ts'));
    const svc = Object.create(TaxpayersService.prototype);
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };

    // 15 mükellef: 12'si EVRAK_BEKLIYOR (eski kodda hiç görünmüyordu), 3'ü ileri aşamada.
    const mukellefler = [];
    for (let i = 1; i <= 15; i++) {
      mukellefler.push({
        id: `tp${i}`, type: 'GERCEK_KISI', firstName: `M${i}`, lastName: 'TEST',
        companyName: null, taxNumber: `100000000${i}`, isActive: true,
        startDate: new Date('2026-01-01'), endDate: null,
      });
    }
    // Durum satırları: updatedAt BUGÜN (biri kutuya dokunmuş gibi) ama aşama hâlâ EVRAK_BEKLIYOR
    const bugun = new Date();
    const durumlar = mukellefler.map((t, i) => ({
      id: `st${i}`, taxpayerId: t.id, updatedAt: bugun,
      evraklarGeldi: i < 3, yuklendi: i < 3, evraklarIslendi: i < 3,
      kontrolEdildi: false, beyannameVerildi: false,
      indirilecekKdvKontrol: false, hesaplananKdvKontrol: false, eArsivKontrol: false,
      evraklarIslendiAt: i < 3 ? new Date(Date.now() - 20 * 24 * 3600 * 1000) : null,
    }));

    svc.prisma = {
      taxpayer: { findMany: async () => mukellefler },
      taxpayerMonthlyStatus: { findMany: async () => durumlar },
      beyanKaydi: { findMany: async () => [] },
    };

    const r = await svc.getWorkflowQueue('t1', 2026, 9);
    const sira = r.siradaki || [];
    const evrakSirada = sira.filter((i) => i.stage === 'EVRAK_BEKLIYOR');

    ok(evrakSirada.length === 12,
      `EVRAK_BEKLIYOR sırada: 12 (gelen: ${evrakSirada.length}) — eski kodda TAMAMEN dışlanıyordu`);
    ok(sira.length === 15, `kırpma yok: 15 kayıt (gelen: ${sira.length}) — eski kodda 10'a kırpılıyordu`);
    ok(sira[0] && sira[0].stage !== 'EVRAK_BEKLIYOR',
      `"sıradaki iş" önerisi değişmedi: ${sira[0] && sira[0].stage} (EVRAK_BEKLIYOR en sonda)`);

    // Bulgu 46: updatedAt BUGÜN olmasına rağmen evrak bekleyenin gecikmesi dönem başından
    const evrakOrnek = evrakSirada[0];
    ok(evrakOrnek && evrakOrnek.bekleyenGun >= 20,
      `evrak bekleyenin gecikmesi dönem başından sayılıyor (gelen: ${evrakOrnek && evrakOrnek.bekleyenGun} gün) — ` +
        'eski kodda updatedAt bugün olduğu için 0 çıkıyordu');

    const gecKalanlar = sira.filter((i) => i.bekleyenGun >= 5);
    ok(gecKalanlar.length >= 12,
      `"Geç Kalanlar" süzgecine düşen kayıt: ${gecKalanlar.length} — eski kodda evrak bekleyenler hiç düşmüyordu`);

    // İşlendi damgası olanlar o damgadan sayılıyor
    const islenenOrnek = sira.find((i) => i.stage === 'KONTROL_BEKLIYOR');
    ok(islenenOrnek && islenenOrnek.bekleyenGun >= 19,
      `işlendi damgası olan aşamada damgadan sayılıyor (gelen: ${islenenOrnek && islenenOrnek.bekleyenGun} gün)`);
  }

  if (failed) { console.error(`\ngorunurluk-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\ngorunurluk-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
