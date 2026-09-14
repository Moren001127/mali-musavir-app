#!/usr/bin/env node
/**
 * Akıllı giriş ayrıştırıcısı testi — Node 22.6+ (tip soyma) ile doğrudan çalışır:
 *   node apps/web/scripts/akilli-giris-test.mjs
 * "Bugün" sabit: 14 Eylül 2026 Pazartesi (sonuçlar takvimden bağımsız olsun diye).
 */
import { ayristir, kategoriTahmin, mukellefEslestir } from '../src/app/(panel)/panel/gorevler/_components/akilli-giris.ts';

const BUGUN = new Date(2026, 8, 14, 11, 30); // 14 Eylül 2026 Pazartesi
const MUKELLEFLER = [
  { id: 'm1', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', taxNumber: '1234567890' },
  { id: 'm2', companyName: 'Erdoğan Balçık', taxNumber: '2345678901' },
  { id: 'm3', firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '3456789012' },
  { id: 'm4', companyName: 'Mert Reklam Ajansı Ltd. Şti.', taxNumber: '4567890123' },
  { id: 'm5', companyName: 'Famcoffee Kahve A.Ş.', taxNumber: '5678901234' },
  { id: 'm6', companyName: 'Ela Tekstil Ltd. Şti.', taxNumber: '6789012345' },
  { id: 'm7', companyName: 'Balçık İnşaat A.Ş.', taxNumber: '7890123456' },
  { id: 'm8', firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '8901234567' },
];

let hata = 0;
let sayi = 0;
function esit(ad, gercek, beklenen) {
  sayi++;
  const g = JSON.stringify(gercek);
  const b = JSON.stringify(beklenen);
  if (g !== b) {
    hata++;
    console.error(`  ✗ ${ad}\n      beklenen: ${b}\n      gelen:    ${g}`);
  }
}

function p(metin) {
  return ayristir(metin, MUKELLEFLER, BUGUN);
}

// --- Tarih ---
esit('yarın', p('Öz Ela KDV kontrolü yarın 10:00').tarih, '2026-09-15');
esit('bugün', p('ekstre iste bugün').tarih, '2026-09-14');
esit('öbür gün', p('öbür gün tahsilat ara').tarih, '2026-09-16');
esit('pazartesi (bugün pazartesi → gelecek)', p('pazartesi beyanname').tarih, '2026-09-21');
esit('salı', p('salı günü ekstre').tarih, '2026-09-15');
esit('salıya (ekli)', p("salıya bordro").tarih, '2026-09-15');
esit('cuma', p('cuma toplantı').tarih, '2026-09-18');
esit('cumartesi', p('cumartesi ofis').tarih, '2026-09-19');
esit('pazar', p('pazar evrak').tarih, '2026-09-20');
esit('gelecek pazartesi', p('gelecek pazartesi bordro').tarih, '2026-09-21');
esit('haftaya cuma', p('haftaya cuma tahsilat').tarih, '2026-09-25');
esit('gelecek hafta → gelecek pazartesi', p('gelecek hafta ekstre iste').tarih, '2026-09-21');
esit('haftaya', p('haftaya ekstre iste').tarih, '2026-09-21');
esit('15 eylül', p('15 eylül KDV').tarih, '2026-09-15');
esit('15 eylülde (ekli)', p("15 eylülde KDV").tarih, '2026-09-15');
esit('1 ocak → gelecek yıl', p('1 ocak yıllık').tarih, '2027-01-01');
esit('26 eylül 2026', p('26 eylül 2026 muhtasar').tarih, '2026-09-26');
esit('15.09', p('15.09 KDV').tarih, '2026-09-15');
esit('15/09/2026', p('15/09/2026 KDV').tarih, '2026-09-15');
esit('01.09 geçmiş → gelecek yıl', p('01.09 KDV').tarih, '2027-09-01');
esit("ayın 20'si", p("ayın 20'si tahsilat").tarih, '2026-09-20');
esit("ayın 20sinde", p('ayın 20sinde tahsilat').tarih, '2026-09-20');
esit("ayın 5'i → gelecek ay", p("ayın 5'i kira").tarih, '2026-10-05');
esit('3 gün sonra', p('3 gün sonra ara').tarih, '2026-09-17');
esit('2 hafta sonra', p('2 hafta sonra ekstre').tarih, '2026-09-28');
esit('ay sonu', p('ay sonu mizan').tarih, '2026-09-30');
esit('tarihsiz', p('Mert Reklam evrak').tarih, null);

// --- Saat ---
esit('10:00', p('KDV yarın 10:00').saat, '10:00');
esit('saat 14', p('saat 14 toplantı').saat, '14:00');
esit('saat 14.30', p('saat 14.30 toplantı').saat, '14:30');
esit("14'te", p("yarın 14'te ara").saat, '14:00');
esit("10.30'da", p("10.30'da toplantı").saat, '10:30');
esit("15.09'da tarih, saat yok", p("15.09'da KDV"), { ...p("15.09'da KDV"), tarih: '2026-09-15', saat: null });
esit('sabah', p('yarın sabah ekstre').saat, '09:00');
esit('saat yok', p('KDV yarın').saat, null);

// --- Öncelik ---
esit('acil', p('acil KDV').oncelik, 'URGENT');
esit('önemli', p('önemli: bordro').oncelik, 'HIGH');
esit('düşük öncelik', p('düşük öncelik kırtasiye').oncelik, 'LOW');
esit('öncelik yok', p('KDV yarın').oncelik, null);

// --- Kategori ---
esit('kdv', kategoriTahmin('Öz Ela KDV kontrolü'), 'KDV_KONTROL');
esit('kdv beyannamesi → beyanname', kategoriTahmin('KDV beyannamesi hazırla'), 'BEYANNAME');
esit('ekstre', kategoriTahmin('Banka ekstresi iste'), 'BANKA');
esit('tahsilat', kategoriTahmin('Tahsilat araması'), 'TAHSILAT');
esit('evrak', kategoriTahmin('Evrak takibi'), 'EVRAK');
esit('bordro', kategoriTahmin('Bordro hazırla'), 'BORDRO');
esit('sgk', kategoriTahmin('SGK bildirgesi'), 'BORDRO');
esit('görüşme', kategoriTahmin('Ayşegül ile görüşme'), 'MUKELLEF');
esit('kategori yok', kategoriTahmin('Kahve al'), null);

// --- Mükellef ---
esit('Öz Ela (2 sözcük) emin', p('Öz Ela KDV kontrolü yarın').mukellef?.id, 'm1');
esit('oz ela (aksansız)', p('oz ela kdv').mukellef?.id, 'm1');
esit('ÖZ ELA (büyük)', p('ÖZ ELA KDV').mukellef?.id, 'm1');
esit("Öz Ela'nın (ekli)", p("Öz Ela'nın ekstresi").mukellef?.id, 'm1');
esit('Ela tek → şüphede (Öz Ela / Ela Tekstil)', p('Ela ekstre').mukellef, null);
esit('Ela tek → adaylar', p('Ela ekstre').mukellefAdaylar.map((a) => a.id).sort(), ['m1', 'm6']);
esit('Balçık tek → şüphede (Erdoğan Balçık / Balçık İnşaat)', p('Balçık KDV').mukellef, null);
esit('Erdoğan Balçık emin', p('Erdoğan Balçık KDV kontrolü').mukellef?.id, 'm2');
esit('Ayşegül Kaya (kişi)', p('Ayşegül Kaya bordro').mukellef?.id, 'm3');
esit('Ayşegül tek (≥4 harf, tek aday) emin', p('Ayşegül bordro').mukellef?.id, 'm3');
esit('Famcoffee emin', p('famcoffee fatura').mukellef?.id, 'm5');
esit('VKN ile', p('1234567890 KDV').mukellef?.id, 'm1');
esit('mükellef yok', p('kırtasiye al').mukellef, null);
esit('mükellef yok → aday yok', p('kırtasiye al').mukellefAdaylar, []);
esit('mukellefEslestir doğrudan', mukellefEslestir('Mert Reklam', MUKELLEFLER).mukellef?.id, 'm4');

// --- Başlık temizliği ---
esit('başlık: tarih/saat çıkar', p('Öz Ela KDV kontrolü yarın 10:00').baslik, 'Öz Ela KDV kontrolü');
esit('başlık: öncelik çıkar', p('acil Öz Ela KDV kontrolü').baslik, 'Öz Ela KDV kontrolü');
esit('başlık: gün + saat', p('Mert Reklam ile cuma saat 14 toplantı').baslik, 'Mert Reklam ile toplantı');
esit('başlık: hiç eşleşme', p('Kahve al').baslik, 'Kahve al');

// --- Tür ---
esit('not: öneki', p('not: Muzaffer Bey ile konuşuldu').tur, 'NOT');
esit('not: başlık', p('not: Muzaffer Bey ile konuşuldu').baslik, 'Muzaffer Bey ile konuşuldu');
esit('görev', p('KDV yarın').tur, 'GOREV');

// --- Bütün ---
const tam = p('Öz Ela KDV kontrolü yarın 10:00');
esit('tam örnek', { baslik: tam.baslik, tarih: tam.tarih, saat: tam.saat, kategori: tam.kategori, mukellef: tam.mukellef?.id, oncelik: tam.oncelik, tur: tam.tur },
  { baslik: 'Öz Ela KDV kontrolü', tarih: '2026-09-15', saat: '10:00', kategori: 'KDV_KONTROL', mukellef: 'm1', oncelik: null, tur: 'GOREV' });

if (hata) {
  console.error(`\n✗ ${hata}/${sayi} test başarısız`);
  process.exit(1);
}
console.log(`✓ akilli-giris: ${sayi} test geçti`);
