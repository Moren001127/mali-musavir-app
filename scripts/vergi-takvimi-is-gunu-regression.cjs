#!/usr/bin/env node
/**
 * VERGİ TAKVİMİ — TABAN GÜN + İŞ GÜNÜ KAYDIRMASI regresyonu (portal denetimi bulgu 43).
 *
 * ÜÇ AYRI HATA VARDI:
 *  1) TABAN GÜN. `beyanname-deadline.util.ts` KDV2'yi ayın 28'i, DAMGA'yı 25'i, TURIZM'i 26'sı
 *     sayıyordu; `MaliTakvim.tsx` KDV2'yi 25, DAMGA'yı 26 sayıyordu. İki kural seti çelişiyordu.
 *  2) KAYDIRMA YOK. Hafta sonu/resmî tatile düşen gün ilk iş gününe taşınmıyordu (VUK md. 18).
 *     Canlı tax_calendar'da önümüzdeki 11 satırın 3'ü CUMARTESİ'ydi.
 *  3) "KESİN" ETİKETİ. Mükellef portalı tax_calendar satırlarını `tahmini: false` diye
 *     veriyordu; oysa tabloyu dolduran tek yer tohum betiği — hepsi hesap.
 *
 * Beklenen tarihler 25 Eylül 2026'da gib.gov.tr/vergi-takvimi'nden BİREBİR okundu.
 * Bu betik gerçek fonksiyonları çağırır (kaynakta metin ARAMAZ).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { calculateBeyannameDeadline, beyannameHamTarihi, beyannameSonTarihBilgisi } = require(
  path.join(ROOT, 'apps/api/src/schedule/beyanname-deadline.util.ts'),
);
const { vergiTakvimiKayitlari } = require(path.join(ROOT, 'apps/api/src/schedule/vergi-takvimi-tohum.ts'));
const { isGununeKaydir, isoGun } = require(path.join(ROOT, 'packages/shared/src/constants/resmi-tatil.ts'));

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

/** İstanbul takvim günü — util 23:59:59+03:00 kuruyor. */
const gun = (d) => (d ? new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10) : null);
const GUN_ADI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const gunAdi = (iso) => GUN_ADI[new Date(`${iso}T12:00:00Z`).getUTCDay()];

(async () => {
  console.log('1) TABAN GÜNLER — GİB vergi takviminden (temiz iş günü ayı: Kasım 2026)');
  {
    // 25 Kasım Çarşamba, 26 Kasım Perşembe → kayma yok, taban gün doğrudan görünür.
    ok(gun(calculateBeyannameDeadline('KDV2', '2026-10')) === '2026-11-25',
      `KDV2 → 25.11.2026 (eskiden 28 sayılıyordu) — gelen: ${gun(calculateBeyannameDeadline('KDV2', '2026-10'))}`);
    ok(gun(calculateBeyannameDeadline('DAMGA', '2026-10')) === '2026-11-26',
      `DAMGA → 26.11.2026 (eskiden 25 sayılıyordu) — gelen: ${gun(calculateBeyannameDeadline('DAMGA', '2026-10'))}`);
    ok(gun(calculateBeyannameDeadline('MUHSGK', '2026-10')) === '2026-11-26', 'MUHSGK → 26.11.2026');
    ok(gun(calculateBeyannameDeadline('KONAKLAMA', '2026-10')) === '2026-11-26', 'Konaklama → 26.11.2026');
    ok(gun(calculateBeyannameDeadline('KDV1', '2026-11')) === '2026-12-28', 'KDV1 Kasım dönemi → 28.12.2026');
    ok(gun(calculateBeyannameDeadline('TURIZM', '2026-08')) === '2026-09-30',
      `Turizm payı → izleyen ayın SON GÜNÜ 30.09.2026 (eskiden 26'sı) — gelen: ${gun(calculateBeyannameDeadline('TURIZM', '2026-08'))}`);
  }

  console.log('\n2) KAYDIRMA — canlıda hafta sonuna düşmüş üç satır');
  {
    const vakalar = [
      ['MUHSGK', '2026-08', '2026-09-26', '2026-09-28'],
      ['KDV1', '2026-10', '2026-11-28', '2026-11-30'],
      ['MUHSGK', '2026-11', '2026-12-26', '2026-12-28'],
    ];
    for (const [tip, donem, hamBeklenen, sonBeklenen] of vakalar) {
      const ham = gun(beyannameHamTarihi(tip, donem));
      const son = gun(calculateBeyannameDeadline(tip, donem));
      ok(ham === hamBeklenen, `${tip} ${donem} ham gün ${hamBeklenen} (${gunAdi(hamBeklenen)}) — gelen: ${ham}`);
      ok(son === sonBeklenen, `${tip} ${donem} son gün ${sonBeklenen} (${gunAdi(sonBeklenen)}) — GİB böyle diyor; gelen: ${son}`);
    }
  }

  console.log('\n3) Geçici vergi Q1 2026: 17 Mayıs Pazar → 18 Mayıs (GİB: 18.05.2026)');
  {
    // Tohum Q1'i "izleyen 2. ayın 17'si" kuralıyla 2026-04 döneminden üretiyor.
    ok(gun(calculateBeyannameDeadline('GGECICI', '2026-04')) === '2026-05-18',
      `GGECICI → 18.05.2026 — gelen: ${gun(calculateBeyannameDeadline('GGECICI', '2026-04'))}`);
  }

  console.log('\n4) Dini bayram zinciri: Kurban 2026 (27-30 Mayıs) + 31 Mayıs Pazar');
  {
    // Turizm payı Nisan dönemi ham gün 31 Mayıs Pazar → 1 Haziran (GİB: 01.06.2026)
    ok(gun(calculateBeyannameDeadline('TURIZM', '2026-04')) === '2026-06-01',
      `Turizm Nisan dönemi → 01.06.2026 — gelen: ${gun(calculateBeyannameDeadline('TURIZM', '2026-04'))}`);
  }

  console.log('\n5) SİRKÜLER UZATMASI tablosu uygulanıyor (199 Sıra No.lu VUK Sirküleri)');
  {
    // Nisan 2026 MUHSGK: ham 26 Mayıs (Kurban arifesi, iş günü) → sirkülerle 03.06.2026
    const b = beyannameSonTarihBilgisi('MUHSGK', '2026-04');
    ok(b && b.uzatildi === true, `uzatma işaretli (gelen: ${b && b.uzatildi})`);
    ok(b && b.sonGun === '2026-06-03', `MUHSGK Nisan dönemi → 03.06.2026 — gelen: ${b && b.sonGun}`);
    ok(b && /199/.test(b.uzatmaKaynagi || ''), `kaynak sirküler yazılı: ${b && b.uzatmaKaynagi}`);
    ok(b && b.tahmini === true, 'sonuç HER ZAMAN tahmini işaretli');

    // KDV1 aynı dönemde FARKLI uzatıldı: ham 28 Mayıs (bayram) → kayma 01.06 → sirküler 05.06.
    const k = beyannameSonTarihBilgisi('KDV1', '2026-04');
    ok(k && k.sonGun === '2026-06-05', `KDV1 Nisan dönemi → 05.06.2026 — gelen: ${k && k.sonGun}`);

    // KDV2 ve Turizm payı UZATILMADI — uzatma tipe bağlı, körlemesine uygulanmıyor.
    ok(gun(calculateBeyannameDeadline('KDV2', '2026-04')) === '2026-05-25',
      `KDV2 Nisan dönemi 25.05.2026 (uzatma YOK) — gelen: ${gun(calculateBeyannameDeadline('KDV2', '2026-04'))}`);
  }

  console.log('\n6) TOHUM ÇIKTISINDA HİÇBİR HAFTA SONU / TATİL YOK');
  {
    const kayitlar = vergiTakvimiKayitlari(new Date('2026-01-01T00:00:00+03:00'), new Date('2027-12-31T23:59:59+03:00'));
    ok(kayitlar.length > 50, `iki yıllık tohum üretildi (${kayitlar.length} kayıt)`);
    const kotu = kayitlar.filter((k) => {
      const iso = gun(k.dueDate);
      return isGununeKaydir(iso) !== iso;
    });
    ok(kotu.length === 0,
      kotu.length === 0
        ? 'tohumun ürettiği tarihlerin hepsi iş günü'
        : `${kotu.length} kayıt hâlâ hafta sonu/tatilde: ${kotu.slice(0, 5).map((k) => `${k.declarationType} ${gun(k.dueDate)}`).join(', ')}`);
  }

  console.log('\n7) Kayma zinciri: sabit tatil + hafta sonu birlikte');
  {
    ok(isGununeKaydir(isoGun(2026, 8, 30)) === '2026-08-31', '30 Ağustos 2026 (Pazar + Zafer Bayramı) → 31 Ağustos');
    ok(isGununeKaydir(isoGun(2026, 3, 19)) === '2026-03-19', 'Ramazan arifesi 19 Mart 2026 TAM TATİL DEĞİL — yerinde kalır');
    ok(isGununeKaydir(isoGun(2026, 3, 20)) === '2026-03-23', '20 Mart 2026 bayram → 23 Mart Pazartesi');
  }

  console.log('\n8) Bilinmeyen tip / bozuk dönem → null (uydurma tarih yok)');
  {
    ok(calculateBeyannameDeadline('YOKBOYLEBIRSEY', '2026-08') === null, 'bilinmeyen tip null');
    ok(calculateBeyannameDeadline('KDV1', 'abc') === null, 'bozuk dönem null');
    ok(calculateBeyannameDeadline('EDEFTER', '2026-06') === null,
      'EDEFTER null — gerçek kural mükellef tipine bağlı (edefter-takvim.ts), yanlış tarih üretilmiyor');
  }

  console.log('\n9) MALİ TAKVİM EKRANI aynı kaydırmayı uyguluyor (sunucuyla ayrışmasın)');
  {
    const { kuralGunu, sonGunuMu } = require(
      path.join(ROOT, 'apps/web/src/components/dashboard/mali-takvim-kurallar.ts'),
    );
    const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

    // Eski ekran 26 Eylül 2026 CUMARTESİ gününü MUHSGK son günü gösteriyordu.
    ok(kuralGunu(t('2026-09-26'), 26) === false, '26 Eylül 2026 Cumartesi ARTIK MUHSGK günü değil');
    ok(kuralGunu(t('2026-09-28'), 26) === true, '28 Eylül 2026 Pazartesi MUHSGK günü (GİB böyle diyor)');
    ok(kuralGunu(t('2026-09-28'), 28) === true, 'aynı gün KDV1 de var — ikisi 28 Eylül\'de birleşiyor');
    ok(kuralGunu(t('2026-09-25'), 25) === true, '25 Eylül 2026 Cuma KDV2 günü (kayma yok)');

    // Ay taşması: ham gün ay sonunda, kayma izleyen aya geçiyor.
    ok(kuralGunu(t('2026-06-01'), 'aySonu') === true,
      '31 Mayıs 2026 Pazar → Turizm payı 1 Haziran\'da görünüyor (ay taşması)');
    ok(kuralGunu(t('2026-05-31'), 'aySonu') === false, '31 Mayıs Pazar günü GÖSTERİLMİYOR');

    // Yıllık: sadece kendi ayında.
    ok(sonGunuMu(t('2027-03-31'), 31) === true, '31 Mart 2027 Çarşamba — yıllık gelir günü');
    ok(sonGunuMu(t('2026-08-31'), 31) === true, '31 Ağustos 2026 (ay sonu) kendi ayında doğru');
  }

  if (failed) { console.error(`\nvergi-takvimi-is-gunu-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nvergi-takvimi-is-gunu-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
