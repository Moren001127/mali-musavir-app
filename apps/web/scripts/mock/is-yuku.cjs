// İş Akışı (/panel/is-yuku) sahte verisi — mock-api.cjs eklentisi.
// Sayfa tek uç çağırır: GET /taxpayers/workflow/queue?year&month → { year, month, donem, total, counts, siradaki[≤10], grouped }.
// NOT: mock-api.cjs'in yerleşik ucu aynı yolu yalnız { donem, counts, total } ile yanıtlar ve eklentilerden ÖNCE çalışır;
// bu yüzden buradaki `uclar` o yol için ancak yerleşik uç kaldırılırsa devreye girer. Önizleme betiği
// (scripts/onizleme/is-yuku-beyaz-goruntule.cjs) `kuyruk()` çıktısını tarayıcıda doğrudan bu uca yerleştirir.
// Sayaçlar yerleşik uçla AYNI: evrak 9 · yükleme 6 · işleme 7 · kontrol 4 · beyanname 2 · tamam 33 = 61.

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const EYLEM = {
  EVRAK_BEKLIYOR: ['Evrak Bekleniyor', (id) => `/panel/mukellefler/${id}`],
  YUKLEME_BEKLIYOR: ['Sisteme Yükle', () => '/panel/kdv-kontrol'],
  ISLENMEYI_BEKLIYOR: ['Faturaları İşle', () => '/panel/ajanlar/mihsap'],
  KONTROL_BEKLIYOR: ['KDV Kontrol Yap', () => '/panel/kdv-kontrol'],
  BEYANNAME_BEKLIYOR: ['Beyanname Hazırla', () => '/panel/beyannameler'],
  TAMAM: ['Tamamlandı', (id) => `/panel/mukellefler/${id}`],
};
// [ad, vkn, tür, aşama, bekleyen gün]
const KAYITLAR = [
  ['Yavuz Nakliyat Ltd. Şti.', '9420418377', 'LIMITED', 'KONTROL_BEKLIYOR', 10],
  ['Famcoffee Kahve Sanayi A.Ş.', '3851029344', 'ANONIM', 'KONTROL_BEKLIYOR', 6],
  ['Erdem Otomotiv Yedek Parça', '3388120067', 'LIMITED', 'KONTROL_BEKLIYOR', 3],
  ['Nur Eczanesi', '19822046690', 'SAHIS', 'KONTROL_BEKLIYOR', 1],
  ['Aytekin Hırdavat', '1290334521', 'SAHIS', 'ISLENMEYI_BEKLIYOR', 7],
  ['Delta Nakliyat ve Lojistik', '2760944118', 'LIMITED', 'ISLENMEYI_BEKLIYOR', 5],
  ['Omega Hırdavat San. Tic.', '6440183925', 'LIMITED', 'ISLENMEYI_BEKLIYOR', 4],
  ['Sakarya Süt Ürünleri Koop.', '7301622458', 'KOOPERATIF', 'ISLENMEYI_BEKLIYOR', 2],
  ['Karadeniz Balıkçılık Ltd.', '5218830471', 'LIMITED', 'ISLENMEYI_BEKLIYOR', 2],
  ['Berrak Temizlik Hizmetleri', '1677204983', 'SAHIS', 'ISLENMEYI_BEKLIYOR', 1],
  ['Güneş Mobilya Dekorasyon', '4093361270', 'LIMITED', 'ISLENMEYI_BEKLIYOR', 0],
  ['Mert Reklam ve Tanıtım', '6120988341', 'LIMITED', 'YUKLEME_BEKLIYOR', 8],
  ['Ada Yapı Malzemeleri', '8813025764', 'LIMITED', 'YUKLEME_BEKLIYOR', 4],
  ['Ayşegül Demir – Kuaför', '27713408822', 'SAHIS', 'YUKLEME_BEKLIYOR', 3],
  ['Pınar Kırtasiye', '2984417506', 'SAHIS', 'YUKLEME_BEKLIYOR', 2],
  ['Ömer Özen – Serbest Meslek', '35044120384', 'SAHIS', 'YUKLEME_BEKLIYOR', 1],
  ['Marmara Cam Balkon', '5590217384', 'LIMITED', 'YUKLEME_BEKLIYOR', 0],
  ['Tuna Gıda Toptan', '8127740395', 'LIMITED', 'BEYANNAME_BEKLIYOR', 2],
  ['Ege Turizm Seyahat Acentesi', '3319862047', 'ANONIM', 'BEYANNAME_BEKLIYOR', 1],
  ['Kaya İnşaat Taahhüt', '5124493870', 'LIMITED', 'EVRAK_BEKLIYOR', 11],
  ['Doğan Petrol Ürünleri', '2938471056', 'LIMITED', 'EVRAK_BEKLIYOR', 9],
  ['Lale Çiçekçilik', '7746120839', 'SAHIS', 'EVRAK_BEKLIYOR', 9],
  ['Umut Tekstil Konfeksiyon', '4402918375', 'LIMITED', 'EVRAK_BEKLIYOR', 7],
  ['Arı Bal Üretim Koop.', '6683027491', 'KOOPERATIF', 'EVRAK_BEKLIYOR', 6],
  ['Zirve Bilişim Hizmetleri', '9057213648', 'LIMITED', 'EVRAK_BEKLIYOR', 5],
  ['Deniz Su Ürünleri', '1298374650', 'SAHIS', 'EVRAK_BEKLIYOR', 4],
  ['Baran Elektrik Malzemeleri', '3847102956', 'LIMITED', 'EVRAK_BEKLIYOR', 3],
  ['Selin Güzellik Salonu', '2019483765', 'SAHIS', 'EVRAK_BEKLIYOR', 2],
];
const TAMAM_ADLAR = ['Akın Kuyumculuk', 'Barış Emlak Ofisi', 'Cem Oto Yıkama', 'Duru Kozmetik', 'Efe Nalburiye', 'Ferah Pastanesi', 'Gül Butik', 'Hilal Market', 'Irmak Danışmanlık', 'Işık Mühendislik', 'Kardelen Anaokulu', 'Liman Balık Lokantası', 'Mavi Yat Turizm', 'Nehir Tarım Ürünleri', 'Odak Reklam', 'Pamuk Tekstil', 'Rota Kargo', 'Safran Baharat', 'Toprak Seramik', 'Ufuk Sürücü Kursu', 'Vadi Organik Gıda', 'Yıldız Kuaför', 'Zeytin Dalı Kafe', 'Ahenk Müzik Evi', 'Bereket Fırın', 'Çınar Mobilya', 'Derya Deniz Ürünleri', 'Ekin Tohumculuk', 'Filiz Çiçek', 'Gökçe Yapı', 'Harman Un', 'Kılıç Metal', 'Meşe Orman Ürünleri'];

/** Yerleşik sayaçlarla tutarlı tam kuyruk verisi. */
function kuyruk(year, month) {
  const y = Number(year) || new Date().getFullYear();
  const m = Number(month) || new Date().getMonth() + 1;
  const simdi = Date.now();
  const gun = (n) => new Date(simdi - n * 86400000 - 3 * 3600000).toISOString();
  let n = 0;
  const kayit = (ad, vkn, tur, stage, bekleyenGun) => {
    n += 1;
    const id = `tp-${n}`;
    const [actionLabel, yol] = EYLEM[stage];
    return {
      statusId: `st-${n}`, taxpayerId: id, taxpayerName: ad, taxNumber: vkn, type: tur, stage,
      actionLabel, actionPath: yol(id), bekleyenGun, updatedAt: gun(bekleyenGun),
      evraklarGeldi: stage !== 'EVRAK_BEKLIYOR', evraklarIslendi: ['KONTROL_BEKLIYOR', 'BEYANNAME_BEKLIYOR', 'TAMAM'].includes(stage),
      kontrolEdildi: ['BEYANNAME_BEKLIYOR', 'TAMAM'].includes(stage), beyannameVerildi: stage === 'TAMAM', monthlyStatusExists: true,
    };
  };
  const items = [
    ...KAYITLAR.map((k) => kayit(...k)),
    ...TAMAM_ADLAR.map((ad, i) => kayit(ad, String(1000000000 + i * 7919), i % 3 ? 'LIMITED' : 'SAHIS', 'TAMAM', 12 + (i % 9))),
  ];
  const oncelik = { KONTROL_BEKLIYOR: 1, ISLENMEYI_BEKLIYOR: 2, YUKLEME_BEKLIYOR: 3, BEYANNAME_BEKLIYOR: 4, EVRAK_BEKLIYOR: 5, TAMAM: 6 };
  const eskidenYeniye = (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt);
  const siralanmis = [...items].sort((a, b) => (oncelik[a.stage] - oncelik[b.stage]) || eskidenYeniye(a, b));
  const grup = (stage) => items.filter((i) => i.stage === stage).sort(eskidenYeniye);
  const grouped = {
    KONTROL_BEKLIYOR: grup('KONTROL_BEKLIYOR'), ISLENMEYI_BEKLIYOR: grup('ISLENMEYI_BEKLIYOR'), YUKLEME_BEKLIYOR: grup('YUKLEME_BEKLIYOR'),
    BEYANNAME_BEKLIYOR: grup('BEYANNAME_BEKLIYOR'), EVRAK_BEKLIYOR: grup('EVRAK_BEKLIYOR'), TAMAM: grup('TAMAM'),
  };
  return {
    year: y, month: m, donem: `${y}-${String(m).padStart(2, '0')}`, donemAdi: `${AYLAR[m - 1]} ${y}`, total: items.length,
    counts: { evrak: grouped.EVRAK_BEKLIYOR.length, yukleme: grouped.YUKLEME_BEKLIYOR.length, islenme: grouped.ISLENMEYI_BEKLIYOR.length, kontrol: grouped.KONTROL_BEKLIYOR.length, beyanname: grouped.BEYANNAME_BEKLIYOR.length, tamam: grouped.TAMAM.length },
    siradaki: siralanmis.filter((i) => i.stage !== 'TAMAM' && i.stage !== 'EVRAK_BEKLIYOR').slice(0, 10),
    grouped,
  };
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/taxpayers/workflow/queue') return jsonGonder(res, 200, kuyruk(q.year, q.month));
  return false;
}

module.exports = { uclar, kuyruk };
