#!/usr/bin/env node
/**
 * MÜKELLEF PORTALI — KDV TUTARININ KAYNAĞI regresyonu (portal denetimi bulgu 18).
 *
 * HATA: Ekran "Ödenecek KDV resmî KDV beyannamenizden alınmıştır" cümlesini `beyanVar`
 *   (KDV1 SATIRI açıldı mı) ile kuruyordu. Oysa gösterilen tutarın koşulu farklı:
 *   `beyan.tahakkukTutari != null` ise resmî tahakkuk, değilse fatura verisinden TASLAK hesap.
 *   Ofisin kendi rutini bu ikisini ayırıyor: setDevredenKdv() devreden KDV girilince KDV1
 *   satırını durum='beklemede', tahakkukTutari=null olarak AÇIYOR. O andan beyanname
 *   tahakkuk edene kadar mükellef TASLAK rakamı "resmî beyannameniz" etiketiyle görüyordu.
 *   Aynı yanlış etiket AI asistanının bağlam metnine de giriyordu ([KDV1 beyanı verildi]).
 *
 * Bu betik GERÇEK kdvOzetForDonem()'i sahte prisma ile çağırır ve ekran metnini üreten
 * GERÇEK saf fonksiyonu (apps/web/src/lib/kdv-kaynak.ts) doğrudan çalıştırır — metin ARAMAZ.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { TaxpayerPortalService } = require(
  path.join(ROOT, 'apps/api/src/taxpayer-portal/taxpayer-portal.service.ts'),
);
const { kdvKaynagi, kdvKaynakMetni, KDV_KAYNAK_ROZET } = require(
  path.join(ROOT, 'apps/web/src/lib/kdv-kaynak.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/**
 * @param beyanSatiri BeyanDurumu KDV1 satırı (yoksa null)
 * @param onHazirlik  kdv1OnHazirlik() sonucu (yoksa null)
 */
function makeSvc(beyanSatiri, onHazirlik) {
  const prisma = { beyanDurumu: { findFirst: async () => beyanSatiri } };
  const kdvBeyanname = { kdv1OnHazirlik: async () => onHazirlik };
  const svc = new TaxpayerPortalService(prisma, {}, {}, kdvBeyanname, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  return svc;
}

const OH = (odenecek, seviye) => ({
  sonuc: { hesaplananKdv: 18000, indirilecekKdv: 18000 - odenecek, odenecekKdv: odenecek, sonrakiAyaDevreden: 0 },
  satis: { faturaAdet: 12 },
  alis: { faturaAdet: 30 },
  veriGuveni: { seviye: seviye || 'kesin' },
});

(async () => {
  console.log('1) KDV1 satırı AÇILMIŞ ama tahakkuk YOK (ofisin devreden rutini) → TASLAK');
  {
    // setDevredenKdv()'in açtığı satır: durum beklemede, tahakkukTutari null.
    const svc = makeSvc({ durum: 'beklemede', tahakkukTutari: null }, OH(4200));
    const k = await svc.kdvOzetForDonem('t1', 'tp1', '2026-08');

    ok(k.beyanVar === true, 'beyanVar hâlâ true (satır gerçekten açık — bilgi kaybolmadı)');
    ok(k.kaynak === 'taslak', `kaynak='taslak' (gelen: ${k.kaynak}) — tutar ön-hazırlıktan geliyor`);
    ok(Number(k.odenecekKdv) === 4200, `gösterilen tutar taslak hesaptan: 4.200 (gelen: ${k.odenecekKdv})`);

    const kaynak = kdvKaynagi(k);
    ok(kaynak === 'taslak', 'ekran da taslak diyor');
    const metin = kdvKaynakMetni(kaynak, null);
    ok(/Taslak/.test(metin) && !/resmî KDV beyannamenizden alınmıştır/.test(metin),
      'ekran metni "resmî beyannamenizden alınmıştır" DEMİYOR — eski kodun asıl hatası buydu');
    ok(KDV_KAYNAK_ROZET[kaynak].label === 'Taslak', 'rozet "Taslak" yazıyor');
  }

  console.log('\n2) Tahakkuk GİRİLMİŞ → RESMÎ BEYAN, tutar tahakkuktan gelir');
  {
    const svc = makeSvc({ durum: 'onaylandi', tahakkukTutari: 5175.4 }, OH(4200));
    const k = await svc.kdvOzetForDonem('t1', 'tp1', '2026-08');

    ok(k.kaynak === 'beyan', `kaynak='beyan' (gelen: ${k.kaynak})`);
    ok(Number(k.odenecekKdv) === 5175.4,
      `tutar TAHAKKUKTAN (5.175,40) — taslak 4.200 değil (gelen: ${k.odenecekKdv})`);

    const kaynak = kdvKaynagi(k);
    const metin = kdvKaynakMetni(kaynak, null);
    ok(/resmî KDV beyannamenizden alınmıştır/.test(metin), 'ekran metni resmî beyanı söylüyor');
    ok(KDV_KAYNAK_ROZET[kaynak].label === 'Resmî beyanname',
      'rozet "Resmî beyanname" — eski haritada bu anahtar YOKTU, resmî tutarda hiç rozet çıkmıyordu');
  }

  console.log('\n3) KDV1 satırı HİÇ YOK → TASLAK (davranış değişmedi)');
  {
    const svc = makeSvc(null, OH(4200));
    const k = await svc.kdvOzetForDonem('t1', 'tp1', '2026-08');
    ok(k.beyanVar === false, 'beyanVar false');
    ok(k.kaynak === 'taslak', `kaynak='taslak' (gelen: ${k.kaynak})`);
  }

  console.log('\n4) Tahakkuk var ama ön-hazırlık PATLADI → yine resmî beyan');
  {
    const prisma = { beyanDurumu: { findFirst: async () => ({ durum: 'onaylandi', tahakkukTutari: 900 }) } };
    const kdvBeyanname = { kdv1OnHazirlik: async () => { throw new Error('ön-hazırlık hatası'); } };
    const svc = new TaxpayerPortalService(prisma, {}, {}, kdvBeyanname, {});
    svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
    const k = await svc.kdvOzetForDonem('t1', 'tp1', '2026-08');
    ok(k && k.kaynak === 'beyan', `ön-hazırlık düşse de resmî tutar gösteriliyor (kaynak: ${k && k.kaynak})`);
    ok(Number(k.odenecekKdv) === 900, `tutar 900 (gelen: ${k && k.odenecekKdv})`);
  }

  console.log('\n5) Sunucu eski sürümde kalırsa (kaynak alanı hiç yok) → TASLAK varsayılır');
  {
    ok(kdvKaynagi({ beyanVar: true, odenecekKdv: 4200 }) === 'taslak',
      'alan yoksa taslak — az söylemek güvenli, fazla söylemek mükellefi yanlış tutara inandırır');
    ok(kdvKaynagi(null) === 'taslak', 'kdv null ise taslak');
    ok(kdvKaynagi({ kaynak: 'BEYAN' }) === 'taslak', 'yalnız tam eşleşen "beyan" kabul ediliyor');
  }

  console.log('\n6) Taslakta veri güveni düşükse metne ekleniyor');
  {
    const metin = kdvKaynakMetni('taslak', 'Eksik veri');
    ok(/Taslak/.test(metin) && /Eksik veri/.test(metin), 'taslak metni eksikliği de söylüyor');
    ok(!/Eksik veri/.test(kdvKaynakMetni('beyan', 'Eksik veri')),
      'resmî beyanda ön-hazırlık puanı metne karışmıyor (tutar oradan gelmiyor)');
  }

  if (failed) { console.error(`\nmukellef-kdv-kaynak-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nmukellef-kdv-kaynak-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
