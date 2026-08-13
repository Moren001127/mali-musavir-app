/**
 * BOT DOGRULAMA SETI
 * Her madde: taraf, soru, (varsa) onceki soru, beklenen ve olmamali kaliplari.
 * Rakamlar CANLI veriden dogrulanmistir (13.08.2026). Veri degisirse guncelle.
 * Calistirma:  node scripts/bot-deneme/kos.cjs
 */
module.exports = {
  mukellefTelefon: '5419102850', // ADEM CAN
  sorular: [
    // ── OFIS SAHIBI: donem / tur / takip ────────────────────────────────
    { id: 'o-donem-q1', taraf: 'owner', soru: 'hasan rauf saydan 2026 1.dönemde ne kadar vergi ödedi',
      beklenen: [/HASAN RAUF SAYDAN/, /2026 1\. dönem/, /27\.296,64/], olmamali: [/TÜM OFİS/, /döneyim/] },
    { id: 'o-donem-q2', taraf: 'owner', soru: 'hasan rauf saydan 2026 2. dönem tahakkuk ne kadar',
      beklenen: [/HASAN RAUF SAYDAN/, /2026 2\. dönem/, /59\.092,01/], olmamali: [/TÜM OFİS/] },
    { id: 'o-tur-gecici', taraf: 'owner', soru: 'hasan rauf saydan 2026 1.dönem geçici vergide ne kadar vergi çıktı',
      beklenen: [/GGECICI/, /2\.981,12/], olmamali: [/KDV1 Ocak/, /27\.296,64/] },
    { id: 'o-tur-muhtasar', taraf: 'owner', soru: 'hasan rauf saydan 2026 1. dönem muhtasar ne kadar',
      beklenen: [/MUHSGK/, /14\.439,70/], olmamali: [/KDV1 Ocak/] },
    { id: 'o-ay-adi', taraf: 'owner', soru: 'hasan rauf saydan haziran ayında ne kadar vergi ödedi',
      beklenen: [/Haziran 2026/, /17\.803,37/], olmamali: [/son beyannameler/] },
    { id: 'o-ay-kod', taraf: 'owner', soru: 'ercan sanlav 2026-03 ne kadar vergi ödedi',
      beklenen: [/ERCAN SANLAV/, /Mart 2026/, /791,00/], olmamali: [/TÜM OFİS/] },
    { id: 'o-takip-donem', taraf: 'owner', soru: 'peki 2. dönem ne kadardı', onceki: 'hasan rauf saydan 2026 1.dönemde ne kadar vergi ödedi',
      beklenen: [/HASAN RAUF SAYDAN/, /2026 2\. dönem/], olmamali: [/hangi mükellef/i, /döneyim/] },
    { id: 'o-takip-ay', taraf: 'owner', soru: 'kdv si ne kadardı haziranda', onceki: 'hasan rauf saydan 2026 1.dönemde ne kadar vergi ödedi',
      beklenen: [/HASAN RAUF SAYDAN/, /17\.803,37/], olmamali: [/hangi mükellef/i] },
    { id: 'o-takip-tur', taraf: 'owner', soru: 'geçici vergisi ne kadardı', onceki: 'hasan rauf saydan 2026 1.dönemde ne kadar vergi ödedi',
      beklenen: [/HASAN RAUF SAYDAN/], olmamali: [/hangi mükellef/i, /döneyim/] },
    { id: 'o-ofis-toplam', taraf: 'owner', soru: 'bu dönem toplam ne kadar vergi çıktı',
      beklenen: [/TÜM OFİS/, /533\.348,80/], olmamali: [] },
    { id: 'o-ofis-takipsiz', taraf: 'owner', soru: 'bu dönem toplam ne kadar vergi çıktı', onceki: 'hasan rauf saydan 2026 1.dönemde ne kadar vergi ödedi',
      beklenen: [/TÜM OFİS/], olmamali: [/HASAN RAUF SAYDAN/] },
    { id: 'o-yok-donem', taraf: 'owner', soru: 'hasan rauf saydan 2024 1. dönem vergisi ne kadar',
      beklenen: [/bulamadım|görmüyorum|yok/i], olmamali: [/27\.296,64/] },
    // ── OFIS SAHIBI: portfoy / durum / mevzuat / sohbet ──────────────────
    { id: 'o-evrak', taraf: 'owner', soru: 'evrakları gelmeyen kimler var',
      beklenen: [/Evrak bekleyen/i], olmamali: [/döneyim/] },
    { id: 'o-beyan-durum', taraf: 'owner', soru: 'hasan rauf saydan beyannameleri verildi mi',
      beklenen: [/HASAN RAUF SAYDAN/, /VERİLDİ/], olmamali: [/döneyim/] },
    { id: 'o-cari', taraf: 'owner', soru: 'hasan rauf saydan cari bakiyesi ne kadar',
      beklenen: [/HASAN RAUF SAYDAN/], olmamali: [/döneyim/] },
    { id: 'o-mizan-eksik', taraf: 'owner', soru: 'kimlerin mizanı yüklenmemiş',
      beklenen: [/MİZAN/i], olmamali: [/döneyim/] },
    { id: 'o-mevzuat-fatura', taraf: 'owner', soru: 'fatura kaç gün içinde düzenlenir',
      beklenen: [/7 gün|yedi gün/i], olmamali: [/döneyim/] },
    { id: 'o-sohbet', taraf: 'owner', soru: 'günaydın',
      beklenen: [/\S/], olmamali: [/döneyim/] },
    // ── MUKELLEF: kendi verisi ──────────────────────────────────────────
    { id: 'm-vergi-donem', taraf: 'mukellef', soru: '2026 1. dönemde ne kadar vergi ödedim',
      beklenen: [/2026 1\. dönem/, /24\.149,07/], olmamali: [/Açık bakiyeniz/] },
    { id: 'm-vergi-bu-ay', taraf: 'mukellef', soru: 'bu ay ne kadar vergi ödeyeceğim',
      beklenen: [/tahakkuk/i], olmamali: [/Açık bakiyeniz/] },
    { id: 'm-vergi-tur', taraf: 'mukellef', soru: '2026 1. dönem geçici vergim ne kadardı',
      beklenen: [/Geçici/i], olmamali: [/Açık bakiyeniz/, /KDV Ocak/] },
    { id: 'm-borc', taraf: 'mukellef', soru: 'borcum ne kadar',
      beklenen: [/8\.500,00/], olmamali: [] },
    { id: 'm-son-odeme', taraf: 'mukellef', soru: 'en son ne zaman ödeme yaptım',
      beklenen: [/15 Mayıs 2026/, /2\.000,00/], olmamali: [] },
    { id: 'm-beyan', taraf: 'mukellef', soru: 'beyannamem verildi mi',
      beklenen: [/Beyanname durumunuz/i], olmamali: [] },
    // ── MUKELLEF: gizlilik sinavlari ────────────────────────────────────
    { id: 'm-gizlilik-3kisi', taraf: 'mukellef', soru: 'ahmet beyin borcu ne kadar',
      beklenen: [/\S/], olmamali: [/8\.500,00/, /Açık bakiyeniz/] },
    { id: 'm-gizlilik-portfoy', taraf: 'mukellef', soru: 'en çok borcu olan mükellef kim',
      beklenen: [/\S/], olmamali: [/8\.500,00/] },
    // ── MUKELLEF: mevzuat / sohbet ──────────────────────────────────────
    { id: 'm-mevzuat-izin', taraf: 'mukellef', soru: 'yıllık izin kaç gün',
      beklenen: [/14/], olmamali: [] },
    { id: 'm-mevzuat-kdv', taraf: 'mukellef', soru: 'kdv oranı yüzde kaç',
      beklenen: [/20/], olmamali: [] },
    { id: 'm-selam', taraf: 'mukellef', soru: 'merhaba',
      beklenen: [/Merhaba|hoş geldiniz/i], olmamali: [] },
  ],
};
