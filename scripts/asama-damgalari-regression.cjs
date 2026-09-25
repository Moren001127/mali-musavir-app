#!/usr/bin/env node
/**
 * AŞAMA DAMGALARI regresyonu — portal denetimi bulgu 46b.
 *
 * SORUN: `TaxpayerMonthlyStatus`ta tek aşama damgası vardı (`evraklarIslendiAt`).
 * Kalan aşamaların bekleme süresi genel `updatedAt`'ten ölçülüyordu; `updatedAt`
 * satırdaki HERHANGİ bir alan değişince tazelendiği için 208 gündür evrak bekleyen
 * bir mükellefte alakasız bir kutu işaretlenince GECİKME SIFIRLANIYORDU.
 *
 * Gerçek fonksiyonlar/servisler sahte prisma ile çağrılır — kaynakta metin ARANMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error('  x ' + msg); } else console.log('  + ' + msg); }

const GUN = 24 * 60 * 60 * 1000;

(async () => {
  const { asamaDamgalari, damgaVeyaYedek, ASAMA_DAMGA_ALANLARI } =
    require(path.join(ROOT, 'apps/api/src/taxpayers/asama-damgalari.ts'));

  console.log('1) asamaDamgalari — yazma kurali');
  {
    const AN = new Date('2026-09-25T10:00:00.000Z');

    let d = asamaDamgalari({ evraklarGeldi: false }, { evraklarGeldi: true }, AN);
    ok(d.evraklarGeldiAt instanceof Date && d.evraklarGeldiAt.getTime() === AN.getTime(),
      'false->true damga O ANI yaziyor');

    d = asamaDamgalari({ evraklarGeldi: true }, { evraklarGeldi: false }, AN);
    ok(d.evraklarGeldiAt === null, 'true->false damga NULL yapiliyor');

    d = asamaDamgalari({ evraklarGeldi: true }, { evraklarGeldi: true }, AN);
    ok(!('evraklarGeldiAt' in d), 'true->true damgaya DOKUNULMUYOR (gecikme sifirlanmaz)');
    d = asamaDamgalari({ evraklarGeldi: false }, { evraklarGeldi: false }, AN);
    ok(!('evraklarGeldiAt' in d), 'false->false damgaya dokunulmuyor');

    d = asamaDamgalari({ evraklarGeldi: true, yuklendi: false }, { yuklendi: true }, AN);
    ok(!('evraklarGeldiAt' in d), 'gonderilmeyen bayragin damgasina dokunulmuyor');
    ok(d.yuklendiAt instanceof Date, 'gonderilen bayragin damgasi yaziliyor');

    d = asamaDamgalari(null, { evraklarGeldi: true, kontrolEdildi: false }, AN);
    ok(d.evraklarGeldiAt instanceof Date, 'yeni kayitta true damgalaniyor');
    ok(!('kontrolEdildiAt' in d), 'yeni kayitta false damgalanmiyor (zaten false)');

    const hepsi = asamaDamgalari(null, {
      evraklarGeldi: true, yuklendi: true, evraklarIslendi: true,
      kontrolEdildi: true, beyannameVerildi: true,
    }, AN);
    ok(Object.keys(hepsi).length === 5, 'bes asamanin hepsi damgalaniyor (' + Object.keys(hepsi).length + '/5)');
    ok(Object.keys(ASAMA_DAMGA_ALANLARI).length === 5, 'esleme tablosunda bes bayrak var');

    d = asamaDamgalari({ evraklarGeldi: false }, { evraklarGeldi: undefined, yuklendi: 'evet' }, AN);
    ok(Object.keys(d).length === 0, 'boolean olmayan deger damga yazdirmiyor');
  }

  console.log('');
  console.log('2) damgaVeyaYedek — eski satirlarda yedege dusus');
  {
    const yedek = new Date('2026-01-01T00:00:00.000Z');
    const damga = new Date('2026-09-01T00:00:00.000Z');
    ok(damgaVeyaYedek(damga, yedek).getTime() === damga.getTime(), 'damga varsa damga kullaniliyor');
    ok(damgaVeyaYedek(null, yedek).getTime() === yedek.getTime(), 'damga null ise yedege dusuyor');
    ok(damgaVeyaYedek(undefined, yedek).getTime() === yedek.getTime(), 'damga undefined ise yedege dusuyor');
    ok(damgaVeyaYedek('2026-09-01T00:00:00.000Z', yedek).getTime() === damga.getTime(), 'metin tarih kabul ediliyor');
    ok(damgaVeyaYedek('sacma', yedek).getTime() === yedek.getTime(), 'gecersiz tarih yedege dusuyor');
  }

  console.log('');
  console.log('3) GERCEK YAZMA YOLU — updateMonthlyStatus damgalari kaydediyor mu');
  {
    const { TaxpayersService } = require(path.join(ROOT, 'apps/api/src/taxpayers/taxpayers.service.ts'));
    const svc = Object.create(TaxpayersService.prototype);
    let yazilan = null;
    const mevcut = {
      evraklarGeldi: true, yuklendi: false, evraklarIslendi: false,
      kontrolEdildi: false, beyannameVerildi: false,
    };
    svc.prisma = {
      taxpayer: { findFirst: async () => ({ id: 'mk1', type: 'TUZEL_KISI', companyName: 'DENEME A.S.' }) },
      taxpayerMonthlyStatus: {
        findUnique: async () => mevcut,
        upsert: async (args) => { yazilan = args.update; return Object.assign({}, mevcut, args.update); },
      },
    };
    svc.eventBus = null;
    svc.assertValidYearMonth = () => {};

    await svc.updateMonthlyStatus('mk1', 't1', 2026, 9, { yuklendi: true });
    ok(yazilan && yazilan.yuklendiAt instanceof Date, 'yuklendi=true -> yuklendiAt damgasi YAZILDI');
    ok(yazilan && !('evraklarGeldiAt' in yazilan), 'degismeyen evraklarGeldi damgasi tazelenmedi');

    await svc.updateMonthlyStatus('mk1', 't1', 2026, 9, { evraklarGeldi: false });
    ok(yazilan && yazilan.evraklarGeldiAt === null, 'evraklarGeldi geri alininca damga NULL yazildi');

    // Alakasiz bir alan HICBIR damgaya dokunmamali — bulgu 46'nin ozu
    await svc.updateMonthlyStatus('mk1', 't1', 2026, 9, { notes: 'alakasiz not' });
    const damgaSayisi = Object.keys(yazilan).filter((k) => k.endsWith('At')).length;
    ok(damgaSayisi === 0, 'alakasiz alan guncellemesi HIC damgaya dokunmuyor (' + damgaSayisi + ' damga yazildi)');
  }

  console.log('');
  console.log('4) GERCEK OKUMA YOLU — gecikme kendi damgasindan olculuyor mu');
  {
    const { TaxpayersService } = require(path.join(ROOT, 'apps/api/src/taxpayers/taxpayers.service.ts'));
    const svc = Object.create(TaxpayersService.prototype);
    const SIMDI = Date.now();

    // 40 gun once evrak geldi, yuklenmeyi bekliyor.
    // `updatedAt` BUGUN (biri alakasiz bir kutu isaretledi) — eski kodda gecikme 0 cikardi.
    const durum = {
      id: 's1', taxpayerId: 'mk1', tenantId: 't1', year: 2026, month: 9,
      evraklarGeldi: true, yuklendi: false, evraklarIslendi: false,
      kontrolEdildi: false, beyannameVerildi: false,
      kdvKontrolEdildi: false, indirilecekKdvKontrol: false,
      hesaplananKdvKontrol: false, eArsivKontrol: false,
      updatedAt: new Date(SIMDI),                    // BUGUN — tuzak
      evraklarGeldiAt: new Date(SIMDI - 40 * GUN),   // gercek baslangic
      yuklendiAt: null, evraklarIslendiAt: null,
      kontrolEdildiAt: null, beyannameVerildiAt: null,
    };
    const mukellef = {
      id: 'mk1', type: 'TUZEL_KISI', companyName: 'GEC KALAN A.S.',
      taxNumber: '1', isActive: true, startDate: new Date('2020-01-01'),
    };
    svc.prisma = {
      taxpayer: { findMany: async () => [mukellef] },
      taxpayerMonthlyStatus: { findMany: async () => [durum] },
      beyanKaydi: { findMany: async () => [] },
    };
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };

    const bul = (sonuc) => {
      const havuz = [].concat(sonuc.siradaki || [], (sonuc.grouped && sonuc.grouped.YUKLEME_BEKLIYOR) || []);
      return havuz.find((i) => i.taxpayerId === 'mk1');
    };

    const kayit = bul(await svc.getWorkflowQueue('t1', 2026, 9));
    ok(!!kayit, 'is yuku listesinde kayit var');
    if (kayit) {
      ok(kayit.stage === 'YUKLEME_BEKLIYOR', 'asama YUKLEME_BEKLIYOR (' + kayit.stage + ')');
      ok(kayit.bekleyenGun >= 39 && kayit.bekleyenGun <= 41,
        'gecikme evraklarGeldiAt ten olculuyor: ' + kayit.bekleyenGun + ' gun (updatedAt bugun olmasina ragmen)');
    }

    // Damgasi OLMAYAN eski satir -> updatedAt yedegine dusmeli (uydurma tarih YOK)
    durum.evraklarGeldiAt = null;
    durum.updatedAt = new Date(SIMDI - 7 * GUN);
    const kayit2 = bul(await svc.getWorkflowQueue('t1', 2026, 9));
    ok(kayit2 && kayit2.bekleyenGun >= 6 && kayit2.bekleyenGun <= 8,
      'damgasiz ESKI satir updatedAt yedegine dusuyor: ' + (kayit2 && kayit2.bekleyenGun) + ' gun');

    // KONTROL asamasi kendi damgasindan (islendi) olculuyor
    durum.yuklendi = true; durum.evraklarIslendi = true;
    durum.evraklarIslendiAt = new Date(SIMDI - 25 * GUN);
    durum.updatedAt = new Date(SIMDI);
    const sonuc3 = await svc.getWorkflowQueue('t1', 2026, 9);
    const kayit3 = [].concat(sonuc3.siradaki || []).find((i) => i.taxpayerId === 'mk1');
    ok(kayit3 && kayit3.stage === 'KONTROL_BEKLIYOR', 'asama KONTROL_BEKLIYOR (' + (kayit3 && kayit3.stage) + ')');
    ok(kayit3 && kayit3.bekleyenGun >= 24 && kayit3.bekleyenGun <= 26,
      'KONTROL gecikmesi evraklarIslendiAt ten: ' + (kayit3 && kayit3.bekleyenGun) + ' gun');

    // BEYANNAME asamasi kontrolEdildiAt ten
    durum.kontrolEdildi = true;
    durum.kontrolEdildiAt = new Date(SIMDI - 11 * GUN);
    durum.updatedAt = new Date(SIMDI);
    const sonuc4 = await svc.getWorkflowQueue('t1', 2026, 9);
    const kayit4 = [].concat(sonuc4.siradaki || []).find((i) => i.taxpayerId === 'mk1');
    ok(kayit4 && kayit4.stage === 'BEYANNAME_BEKLIYOR', 'asama BEYANNAME_BEKLIYOR (' + (kayit4 && kayit4.stage) + ')');
    ok(kayit4 && kayit4.bekleyenGun >= 10 && kayit4.bekleyenGun <= 12,
      'BEYANNAME gecikmesi kontrolEdildiAt ten: ' + (kayit4 && kayit4.bekleyenGun) + ' gun');
  }

  console.log('');
  console.log(failed === 0 ? 'GECTI: asama damgalari regresyonu' : 'DUSTU: ' + failed + ' kontrol');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('COKTU:', e); process.exit(1); });
