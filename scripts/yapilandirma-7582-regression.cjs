#!/usr/bin/env node
/**
 * 7582 / Seri:B Sıra No:20 TECİL-TAKSİTLENDİRME HESAP regresyonu.
 *
 * KAYNAK: GİB Rehberi (Yayın No: 610) + Tahsilat Genel Tebliği Seri:B Sıra No:20.
 * Buradaki her sayı mevzuat metninden gelir; hiçbiri tahmin değildir.
 *
 * Neyi kilitler:
 *  1) KDV/BSMV borcu likidite oranına BAKILMAKSIZIN 12 taksit (en sık yapılacak hata).
 *  2) Likidite eşikleri: 0,50 ve 0,30 SINIR DEĞERLERİ dahil doğru tarafta.
 *  3) Kapsam dışı borçlar (ÖTV, 2026 geçici vergi) taksitlendirmeye GİRMEZ.
 *  4) Tanınmayan borç türü UYDURULMAZ — belirsiz kalır.
 *  5) Lira kesirleri İLK taksite eklenir.
 *  6) Faiz her taksit için ayrı: tutar × %29 × gün / 36.000 (30/360 gün sayımı).
 *  7) Taksit vadesi ayın SON günü, ilk taksit Eylül/2026.
 *  8) Teminat: 10.000.000 TL'yi aşan kısmın YARISI.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

const H = require(path.join(ROOT, 'apps/api/src/yapilandirma-7582/yapilandirma-7582.hesap.ts'));

let hata = 0;
const ok = (ad, sart, ek) => {
  if (sart) console.log(`  ✓ ${ad}`);
  else { console.error(`  ✗ ${ad}${ek ? '\n      ' + ek : ''}`); hata++; }
};

// ---------- 1) BORÇ TÜRÜ ----------
const tur = H.borcTuruBelirle;
ok('KDV -> KDV_BSMV', tur('KATMA DEĞER VERGİSİ') === 'KDV_BSMV');
ok('kısa yazım "KDV" -> KDV_BSMV', tur('KDV') === 'KDV_BSMV');
ok('BSMV -> KDV_BSMV', tur('Banka ve Sigorta Muameleleri Vergisi') === 'KDV_BSMV');
ok('ÖTV -> KAPSAM_DISI', tur('ÖZEL TÜKETİM VERGİSİ') === 'KAPSAM_DISI');
ok('ÖTV gecikme zammı da KAPSAM_DISI', tur('Özel Tüketim Vergisi Gecikme Zammı') === 'KAPSAM_DISI',
  'kapsam dışı kontrolü fer’i ekten ÖNCE yapılmalı');
ok('geçici vergi -> KAPSAM_DISI', tur('GEÇİCİ VERGİ') === 'KAPSAM_DISI');
ok('gelir stopaj -> DIGER', tur('GELİR VERGİSİ STOPAJI') === 'DIGER');
ok('damga vergisi -> DIGER', tur('DAMGA VERGİSİ') === 'DIGER');
ok('MTV -> DIGER', tur('MOTORLU TAŞITLAR VERGİSİ') === 'DIGER');
ok('yalnız "gecikme zammı" BELİRSİZ kalır', tur('GECİKME ZAMMI') === 'BELIRSIZ',
  'hangi asla bağlı olduğu bilinmeden 12 mi 72 mi taksit olacağı belirlenemez');
ok('boş metin BELİRSİZ', tur('') === 'BELIRSIZ');
ok('tanınmayan tür BELİRSİZ (uydurmaz)', tur('FİLANCA HARCI') === 'BELIRSIZ');

// ---------- 2) LİKİDİTE ORANI ----------
// Bilanço: (Dönen Varlıklar − Stoklar) / Kısa Vadeli Yabancı Kaynaklar
const o1 = H.likiditeOrani({ defter: 'BILANCO', donenVarliklar: 1000, stoklar: 400, kisaVadeliYabanciKaynak: 1200 });
ok('bilanço formülü doğru', Math.abs(o1 - 0.5) < 1e-9, `beklenen 0.5, çıkan ${o1}`);
// İşletme: (Kasa + Banka + KV Alacaklar) / KV Borçlar
const o2 = H.likiditeOrani({ defter: 'ISLETME', kasa: 100, banka: 200, kisaVadeliAlacaklar: 300, kisaVadeliBorclar: 1500 });
ok('işletme formülü doğru', Math.abs(o2 - 0.4) < 1e-9, `beklenen 0.4, çıkan ${o2}`);
ok('payda sıfırsa oran NULL', H.likiditeOrani({ defter: 'BILANCO', donenVarliklar: 100, kisaVadeliYabanciKaynak: 0 }) === null,
  'sıfıra bölüp Infinity ile 36 taksit demek yanlış beyan olur');

// ---------- 3) AZAMİ TAKSİT ----------
const az = (g) => H.azamiTaksit(Object.assign({ statu: 'NORMAL', faalMi: true, defter: 'BILANCO', oran: 0.1 }, g));
ok('KDV her hâlükârda 12', az({ borcTuru: 'KDV_BSMV', oran: 0.05 }).taksit === 12,
  'KDV likidite oranına BAKILMAZ — en sık yapılacak hata bu');
ok('KDV, belediyede bile 12', az({ borcTuru: 'KDV_BSMV', statu: 'BELEDIYE_VB' }).taksit === 12);
ok('belediye diğer borçta 72', az({ borcTuru: 'DIGER', statu: 'BELEDIYE_VB', oran: 0.9 }).taksit === 72);
ok('oran 0,50 -> 36 (sınır dahil)', az({ borcTuru: 'DIGER', oran: 0.5 }).taksit === 36);
ok('oran 0,49 -> 48', az({ borcTuru: 'DIGER', oran: 0.49 }).taksit === 48);
ok('oran 0,31 -> 48', az({ borcTuru: 'DIGER', oran: 0.31 }).taksit === 48);
ok('oran 0,30 -> 72 (sınır dahil)', az({ borcTuru: 'DIGER', oran: 0.3 }).taksit === 72);
ok('oran 0,10 -> 72', az({ borcTuru: 'DIGER', oran: 0.1 }).taksit === 72);
ok('işletme esasında da aynı eşikler', az({ borcTuru: 'DIGER', defter: 'ISLETME', oran: 0.35 }).taksit === 48);
ok('faal değilse 48', az({ borcTuru: 'DIGER', faalMi: false }).taksit === 48);
ok('defter tutmayan (DIGER) 48', az({ borcTuru: 'DIGER', defter: 'DIGER' }).taksit === 48,
  'serbest meslek/basit usul bu kovaya düşer');
ok('oran yoksa taksit BELİRLENMEZ', az({ borcTuru: 'DIGER', oran: null }).taksit === null,
  'oranı bilmeden 72 yazmak mükellefi yanlış beyana sokar');
ok('kapsam dışı için taksit yok', az({ borcTuru: 'KAPSAM_DISI' }).taksit === null);
ok('belirsiz için taksit yok', az({ borcTuru: 'BELIRSIZ' }).taksit === null);

// ---------- 4) GÜN SAYIMI (30/360) ----------
const g = (a, b) => H.gunSayisi30_360(new Date(a + 'T00:00:00Z'), new Date(b + 'T00:00:00Z'));
ok('21/8 -> 30/9 = 39 gün', g('2026-08-21', '2026-09-30') === 39, `çıkan ${g('2026-08-21', '2026-09-30')}`);
ok('ayın 31i 30 sayılır', g('2026-08-31', '2026-09-30') === 30, `çıkan ${g('2026-08-31', '2026-09-30')}`);
ok('bir yıl = 360 gün', g('2026-08-21', '2027-08-21') === 360);

// ---------- 5) TAKSİT VADESİ ----------
ok('ilk taksit 30/9/2026', H.taksitVadesi(1).toISOString().slice(0, 10) === '2026-09-30');
ok('2. taksit 31/10/2026', H.taksitVadesi(2).toISOString().slice(0, 10) === '2026-10-31');
ok('5. taksit 31/1/2027 (yıl atlar)', H.taksitVadesi(5).toISOString().slice(0, 10) === '2027-01-31');
ok('12. taksit 31/8/2027', H.taksitVadesi(12).toISOString().slice(0, 10) === '2027-08-31');

// ---------- 6) ÖDEME PLANI ----------
const talep = new Date('2026-08-21T00:00:00Z');
const p1 = H.odemePlani(12000, 12, talep);
ok('12 taksitte aylık 1.000', p1.aylikTaksit === 1000);
ok('plan 12 satır', p1.satirlar.length === 12);
ok('ilk taksit vadesi 30/9/2026', p1.satirlar[0].vade === '2026-09-30');
// faiz = 1000 × 29 × 39 / 36000 = 31,4166… -> 31,42
ok('ilk taksit faizi formülle birebir', p1.satirlar[0].tecilFaizi === 31.42,
  `çıkan ${p1.satirlar[0].tecilFaizi} — beklenen 31.42 (1000×29×39/36000)`);
ok('faiz taksit başına ayrı hesaplanıyor (artan gün)',
  p1.satirlar[11].tecilFaizi > p1.satirlar[0].tecilFaizi);
ok('toplam ödeme = borç + faiz',
  Math.abs(p1.toplamOdeme - (p1.toplamBorc + p1.toplamFaiz)) < 0.01);

// Lira kesirleri İLK taksite eklenir (tebliğ soru 12)
const p2 = H.odemePlani(10000.5, 3, talep);
ok('kuruş farkı ilk taksite eklenir', p2.ilkTaksit === 3334.5 && p2.aylikTaksit === 3333,
  `ilk=${p2.ilkTaksit} aylık=${p2.aylikTaksit}`);
ok('anapara toplamı borca eşit',
  Math.abs(p2.satirlar.reduce((t, s) => t + s.anapara, 0) - 10000.5) < 0.01);

// ---------- 7) TEMİNAT ----------
ok('10 milyona kadar teminat yok', H.odemePlani(10_000_000, 12, talep).teminatGerekli === 0);
ok('aşan kısmın yarısı teminat', H.odemePlani(12_000_000, 12, talep).teminatGerekli === 1_000_000,
  '11414 sayılı CB Kararı: sınır 10 milyon TL');

// ---------- 8) SEÇENEK LİSTESİ ----------
ok('12 taksitte seçenekler 12yi aşmaz', H.taksitSecenekleri(12).every((x) => x <= 12));
ok('72 taksitte 72 de var', H.taksitSecenekleri(72).includes(72));
ok('borçlu daha az taksit seçebilir', H.taksitSecenekleri(48).includes(12),
  'rehber soru 8: tebliğdeki sayıdan daha az taksit tercih edilebilir');

// ---------- 9) GİB REHBERİ ÖRNEK 1 (birebir) ----------
// (A) Gıda A.Ş.: 468.000 TL gelir stopaj+damga+gecikme zammı, 180.000 TL KDV+gecikme zammı.
// Likidite oranı 0,30'un ALTINDA. Beklenen: 468.000 -> 72 taksit, 180.000 -> 12 taksit.
const digerAz = H.azamiTaksit({ borcTuru: 'DIGER', statu: 'NORMAL', faalMi: true, defter: 'BILANCO', oran: 0.25 });
const kdvAz = H.azamiTaksit({ borcTuru: 'KDV_BSMV', statu: 'NORMAL', faalMi: true, defter: 'BILANCO', oran: 0.25 });
ok('Örnek 1: stopaj+damga 72 taksit', digerAz.taksit === 72);
ok('Örnek 1: KDV 180.000 -> 12 taksit', kdvAz.taksit === 12);
ok('Örnek 1: toplam 648.000 tek planda BİRLEŞMEZ', digerAz.taksit !== kdvAz.taksit,
  'aynı mükellefin borcu iki ayrı planla ödenir');

// ---------- 10) SABİTLER ----------
ok('tecil faizi %29', H.TECIL_FAIZI_YILLIK === 29);
ok('başvuru son tarihi 31/8/2026', H.BASVURU_SON === '2026-08-31');
ok('teminatsız sınır 10 milyon', H.TEMINATSIZ_SINIR === 10_000_000);
ok('kapsam vadesi 5/6/2026', H.KAPSAM_VADE_SON === '2026-06-05');

// ---------- 11) VADE TESPİTİ (GİB Vergi Takvimi 2026) ----------
// Tebliğ yalnız 5/6/2026'ya kadar VADESİ GELMİŞ borçları kapsıyor; GİB borç listesinde
// vade sütunu YOK. Vade, vergi türü kodu + dönemden türetiliyor.
const V = require(path.join(ROOT, 'apps/api/src/yapilandirma-7582/vade.ts'));
const vd = (t, d) => V.vadeBelirle(t, d);
const kd = (t, d) => V.kapsamDurumu(t, d);

ok('KDV: dönemi izleyen ayın 28i', vd('0015 KATMA DEGER', '04/2026-04/2026').vade === '2026-05-28');
ok('KDV 05/2026 hafta sonuna kayar', vd('0015 KATMA DEGER', '05/2026-05/2026').vade === '2026-06-29',
  '28.06.2026 Pazar → 29.06.2026');
ok('Muhtasar: izleyen ayın 26sı', vd('0003 MUHTASAR', '04/2026-04/2026').vade === '2026-05-26');
ok('3 aylık muhtasarda dönem SONU esas', vd('0003 MUHTASAR', '04/2026-06/2026').vade === '2026-07-27',
  'dönem başı alınsaydı yanlışlıkla kapsama girerdi');
ok('Geçici vergi: izleyen 2. ayın 17si', vd('0032 GECICI', '01/2026-03/2026').vade === '2026-05-18',
  'GİB takvimi de 17.05.2026 Pazar olduğu için 18e kaydırmıştı — canlı doğrulama');
ok('Kurumlar: izleyen yıl 30 Nisan', vd('0010 KURUMLAR', '01/2025-12/2025').vade === '2026-04-30');
ok('Yıllık gelir vergisi İKİ taksit', (() => { const r = vd('0001 YILLIK GELIR', '01/2025-12/2025');
  return r.vade === '2026-03-31' && r.ikinciVade === '2026-07-31' && r.kesinlik === 'KARISIK'; })());
ok('MTV 31 Ocak cumartesiyse pazartesiye kayar', vd('9034 MTV', '01/2026-12/2026').vade === '2026-02-02');
ok('Trafik cezasına vade UYDURULMAZ', vd('9085 TRAFIK CEZALARI', '06/2026-06/2026').kesinlik === 'YOK',
  'vadesi tebliğ tarihine bağlı, dönemden çıkmaz');
ok('Tecilli borçta vade türetilmez', vd('6183 TECILLI TAHSILAT', '-').kesinlik === 'YOK');

// Kapsam kararı: vade + tür elemesi birlikte
ok('KDV 04/2026 kapsam İÇİNDE', kd('0015 KATMA DEGER', '04/2026-04/2026').durum === 'ICINDE');
ok('KDV 05/2026 kapsam DIŞINDA', kd('0015 KATMA DEGER', '05/2026-05/2026').durum === 'DISINDA');
ok('2026 geçici vergi vadesi UYGUN OLSA DA dışarıda',
  kd('0032 GECICI', '01/2026-03/2026').durum === 'DISINDA',
  'vade 18.05.2026 kapsamda ama tebliğ 2026 geçici vergiyi ayrıca hariç tutuyor');
ok('2025 geçici vergi kapsam İÇİNDE', kd('0032 GECICI', '10/2025-12/2025').durum === 'ICINDE');
ok('ÖTV her hâlükârda dışarıda', kd('9071 OZEL TUKETIM VERGISI', '01/2024-01/2024').durum === 'DISINDA');
ok('Yıllık gelir 2025 KISMEN (taksitler sınırın iki yanında)',
  kd('0001 YILLIK GELIR', '01/2025-12/2025').durum === 'KISMEN');
ok('MTV 2025 tamamen kapsamda', kd('9034 MTV', '01/2025-12/2025').durum === 'ICINDE');
ok('MTV 2026 KISMEN', kd('9034 MTV', '01/2026-12/2026').durum === 'KISMEN');
ok('vade türetilemeyende kapsamda VARSAYILMAZ',
  kd('9085 TRAFIK CEZALARI', '06/2026-06/2026').durum === 'BELIRSIZ');

if (hata) process.exit(1);
console.log('[yapilandirma-7582] OK: taksit kuralları, faiz formülü ve kapsam kilitli');
