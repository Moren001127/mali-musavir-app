/**
 * MUHASEBE REFERANSI — TEK DOĞRULUK KAYNAĞI.
 * Bot TDHP hesap kodu adını ve vergi oranını ARTIK EZBERDEN UYDURMAZ; buradan alır.
 * (Kök neden: kodda standart TDHP kod→isim cetveli + güncel oran tablosu yoktu;
 *  model halüsinasyon yapıyordu — 101'i "Banka", kurumlar oranını "%20" diyordu.)
 */

/** Tek Düzen Hesap Planı — standart ana hesap kodu → isim. */
export const TDHP: Record<string, string> = {
  // 1 DÖNEN VARLIKLAR — 10 Hazır Değerler
  '100': 'Kasa',
  '101': 'Alınan Çekler',
  '102': 'Bankalar',
  '103': 'Verilen Çekler ve Ödeme Emirleri (-)',
  '108': 'Diğer Hazır Değerler',
  // 11 Menkul Kıymetler
  '110': 'Hisse Senetleri',
  '111': 'Özel Kesim Tahvil Senet ve Bonoları',
  '112': 'Kamu Kesimi Tahvil Senet ve Bonoları',
  '118': 'Diğer Menkul Kıymetler',
  '119': 'Menkul Kıymetler Değer Düşüklüğü Karşılığı (-)',
  // 12 Ticari Alacaklar
  '120': 'Alıcılar',
  '121': 'Alacak Senetleri',
  '122': 'Alacak Senetleri Reeskontu (-)',
  '124': 'Kazanılmamış Finansal Kiralama Faiz Gelirleri (-)',
  '126': 'Verilen Depozito ve Teminatlar',
  '127': 'Diğer Ticari Alacaklar',
  '128': 'Şüpheli Ticari Alacaklar',
  '129': 'Şüpheli Ticari Alacaklar Karşılığı (-)',
  // 13 Diğer Alacaklar
  '131': 'Ortaklardan Alacaklar',
  '132': 'İştiraklerden Alacaklar',
  '133': 'Bağlı Ortaklıklardan Alacaklar',
  '135': 'Personelden Alacaklar',
  '136': 'Diğer Çeşitli Alacaklar',
  '137': 'Diğer Alacak Senetleri Reeskontu (-)',
  '138': 'Şüpheli Diğer Alacaklar',
  '139': 'Şüpheli Diğer Alacaklar Karşılığı (-)',
  // 15 Stoklar
  '150': 'İlk Madde ve Malzeme',
  '151': 'Yarı Mamuller - Üretim',
  '152': 'Mamuller',
  '153': 'Ticari Mallar',
  '157': 'Diğer Stoklar',
  '158': 'Stok Değer Düşüklüğü Karşılığı (-)',
  '159': 'Verilen Sipariş Avansları',
  // 17 Yıllara Yaygın İnşaat ve Onarım Maliyetleri
  '170': 'Yıllara Yaygın İnşaat ve Onarım Maliyetleri',
  '178': 'Yıllara Yaygın İnşaat Enflasyon Düzeltme Hesabı',
  // 18 Gelecek Aylara Ait Giderler ve Gelir Tahakkukları
  '180': 'Gelecek Aylara Ait Giderler',
  '181': 'Gelir Tahakkukları',
  // 19 Diğer Dönen Varlıklar
  '190': 'Devreden KDV',
  '191': 'İndirilecek KDV',
  '192': 'Diğer KDV',
  '193': 'Peşin Ödenen Vergiler ve Fonlar',
  '195': 'İş Avansları',
  '196': 'Personel Avansları',
  '197': 'Sayım ve Tesellüm Noksanları',
  '198': 'Diğer Çeşitli Dönen Varlıklar',
  '199': 'Diğer Dönen Varlıklar Karşılığı (-)',
  // 2 DURAN VARLIKLAR
  '220': 'Alıcılar (Uzun Vadeli)',
  '226': 'Verilen Depozito ve Teminatlar (Uzun Vadeli)',
  '240': 'Bağlı Menkul Kıymetler',
  '242': 'İştirakler',
  '245': 'Bağlı Ortaklıklar',
  '250': 'Arazi ve Arsalar',
  '251': 'Yeraltı ve Yerüstü Düzenleri',
  '252': 'Binalar',
  '253': 'Tesis, Makine ve Cihazlar',
  '254': 'Taşıtlar',
  '255': 'Demirbaşlar',
  '256': 'Diğer Maddi Duran Varlıklar',
  '257': 'Birikmiş Amortismanlar (-)',
  '258': 'Yapılmakta Olan Yatırımlar',
  '259': 'Verilen Avanslar (Duran Varlık)',
  '260': 'Haklar',
  '261': 'Şerefiye',
  '262': 'Kuruluş ve Örgütlenme Giderleri',
  '263': 'Araştırma ve Geliştirme Giderleri',
  '264': 'Özel Maliyetler',
  '267': 'Diğer Maddi Olmayan Duran Varlıklar',
  '268': 'Birikmiş Amortismanlar (Maddi Olmayan) (-)',
  '280': 'Gelecek Yıllara Ait Giderler',
  '281': 'Gelir Tahakkukları (Uzun Vadeli)',
  // 3 KISA VADELİ YABANCI KAYNAKLAR
  '300': 'Banka Kredileri (Kısa Vadeli)',
  '303': 'Uzun Vadeli Kredilerin Anapara Taksitleri ve Faizleri',
  '305': 'Çıkarılmış Bonolar ve Senetler',
  '309': 'Diğer Mali Borçlar',
  '320': 'Satıcılar',
  '321': 'Borç Senetleri',
  '322': 'Borç Senetleri Reeskontu (-)',
  '326': 'Alınan Depozito ve Teminatlar',
  '329': 'Diğer Ticari Borçlar',
  '331': 'Ortaklara Borçlar',
  '332': 'İştiraklere Borçlar',
  '333': 'Bağlı Ortaklıklara Borçlar',
  '335': 'Personele Borçlar',
  '336': 'Diğer Çeşitli Borçlar',
  '340': 'Alınan Sipariş Avansları',
  '349': 'Alınan Diğer Avanslar',
  '360': 'Ödenecek Vergi ve Fonlar',
  '361': 'Ödenecek Sosyal Güvenlik Kesintileri',
  '368': 'Vadesi Geçmiş, Ertelenmiş veya Taksitlendirilmiş Vergi ve Diğer Yükümlülükler',
  '369': 'Ödenecek Diğer Yükümlülükler',
  '370': 'Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları',
  '371': 'Dönem Kârının Peşin Ödenen Vergi ve Diğer Yükümlülükleri (-)',
  '372': 'Kıdem Tazminatı Karşılığı (Kısa Vadeli)',
  '373': 'Maliyet Giderleri Karşılığı',
  '379': 'Diğer Borç ve Gider Karşılıkları',
  '380': 'Gelecek Aylara Ait Gelirler',
  '381': 'Gider Tahakkukları',
  '391': 'Hesaplanan KDV',
  '392': 'Diğer KDV',
  '393': 'Merkez ve Şubeler Cari Hesabı',
  '397': 'Sayım ve Tesellüm Fazlaları',
  '399': 'Diğer Çeşitli Yabancı Kaynaklar',
  // 4 UZUN VADELİ YABANCI KAYNAKLAR
  '400': 'Banka Kredileri (Uzun Vadeli)',
  '405': 'Çıkarılmış Tahviller',
  '409': 'Diğer Mali Borçlar (Uzun Vadeli)',
  '420': 'Satıcılar (Uzun Vadeli)',
  '421': 'Borç Senetleri (Uzun Vadeli)',
  '431': 'Ortaklara Borçlar (Uzun Vadeli)',
  '472': 'Kıdem Tazminatı Karşılığı',
  '479': 'Diğer Borç ve Gider Karşılıkları (Uzun Vadeli)',
  '480': 'Gelecek Yıllara Ait Gelirler',
  '492': 'Gelecek Yıllara Ertelenen veya Terkin Edilecek KDV',
  // 5 ÖZKAYNAKLAR
  '500': 'Sermaye',
  '501': 'Ödenmemiş Sermaye (-)',
  '520': 'Hisse Senedi İhraç Primleri',
  '522': 'Maddi Duran Varlık Yeniden Değerleme Artışları',
  '529': 'Diğer Sermaye Yedekleri',
  '540': 'Yasal Yedekler',
  '541': 'Statü Yedekleri',
  '542': 'Olağanüstü Yedekler',
  '548': 'Diğer Kâr Yedekleri',
  '549': 'Özel Fonlar',
  '570': 'Geçmiş Yıllar Kârları',
  '580': 'Geçmiş Yıllar Zararları (-)',
  '590': 'Dönem Net Kârı',
  '591': 'Dönem Net Zararı (-)',
  // 6 GELİR TABLOSU HESAPLARI
  '600': 'Yurtiçi Satışlar',
  '601': 'Yurtdışı Satışlar',
  '602': 'Diğer Gelirler',
  '610': 'Satıştan İadeler (-)',
  '611': 'Satış İskontoları (-)',
  '612': 'Diğer İndirimler (-)',
  '620': 'Satılan Mamuller Maliyeti (-)',
  '621': 'Satılan Ticari Mallar Maliyeti (-)',
  '622': 'Satılan Hizmet Maliyeti (-)',
  '623': 'Diğer Satışların Maliyeti (-)',
  '630': 'Araştırma ve Geliştirme Giderleri (-)',
  '631': 'Pazarlama, Satış ve Dağıtım Giderleri (-)',
  '632': 'Genel Yönetim Giderleri (-)',
  '640': 'İştiraklerden Temettü Gelirleri',
  '642': 'Faiz Gelirleri',
  '644': 'Konusu Kalmayan Karşılıklar',
  '645': 'Menkul Kıymet Satış Kârları',
  '646': 'Kambiyo Kârları',
  '647': 'Reeskont Faiz Gelirleri',
  '649': 'Diğer Olağan Gelir ve Kârlar',
  '653': 'Komisyon Giderleri (-)',
  '654': 'Karşılık Giderleri (-)',
  '655': 'Menkul Kıymet Satış Zararları (-)',
  '656': 'Kambiyo Zararları (-)',
  '657': 'Reeskont Faiz Giderleri (-)',
  '659': 'Diğer Olağan Gider ve Zararlar (-)',
  '660': 'Kısa Vadeli Borçlanma Giderleri (-)',
  '661': 'Uzun Vadeli Borçlanma Giderleri (-)',
  '671': 'Önceki Dönem Gelir ve Kârları',
  '679': 'Diğer Olağandışı Gelir ve Kârlar',
  '680': 'Çalışmayan Kısım Gider ve Zararları (-)',
  '681': 'Önceki Dönem Gider ve Zararları (-)',
  '689': 'Diğer Olağandışı Gider ve Zararlar (-)',
  '690': 'Dönem Kârı veya Zararı',
  '691': 'Dönem Kârı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)',
  '692': 'Dönem Net Kârı veya Zararı',
  // 7 MALİYET HESAPLARI (7/A)
  '710': 'Direkt İlk Madde ve Malzeme Giderleri',
  '720': 'Direkt İşçilik Giderleri',
  '730': 'Genel Üretim Giderleri',
  '740': 'Hizmet Üretim Maliyeti',
  '750': 'Araştırma ve Geliştirme Giderleri',
  '760': 'Pazarlama, Satış ve Dağıtım Giderleri',
  '770': 'Genel Yönetim Giderleri',
  '780': 'Finansman Giderleri',
};

/** Standart TDHP ana hesap kodları (prefix doğrulama için — tek kaynak). */
export const TDHP_KODLARI: ReadonlySet<string> = new Set(Object.keys(TDHP));

/** En sık karıştırılan kritik kodlar — promptta sabitlenir, model şaşmasın. */
export const TDHP_KRITIK =
  '100 Kasa · 101 Alınan Çekler · 102 Bankalar · 103 Verilen Çekler ve Ödeme Emirleri (-) · 108 Diğer Hazır Değerler · 110 Hisse Senetleri · 120 Alıcılar · 121 Alacak Senetleri · 131 Ortaklardan Alacaklar · 153 Ticari Mallar · 191 İndirilecek KDV · 320 Satıcılar · 360 Ödenecek Vergi ve Fonlar · 391 Hesaplanan KDV · 600 Yurtiçi Satışlar · 632 Genel Yönetim Giderleri · 770 Genel Yönetim Giderleri';

/**
 * Verilen kodların adını döndürür. Tam eşleşme yoksa ilk 3 haneye (ana hesap) düşer.
 * Bilinmeyen kod için "(bilinmiyor)" işaretler — UYDURMA yerine açık belirsizlik.
 */
export function tdhpAciklama(kodlar?: string[]): string {
  const list = (kodlar && kodlar.length ? kodlar : Object.keys(TDHP)).map((k) => String(k).trim());
  const lines = list.map((kod) => {
    const ana = kod.slice(0, 3);
    const ad = TDHP[kod] || TDHP[ana];
    return ad ? `${kod} — ${ad}${TDHP[kod] ? '' : ' (ana hesap)'}` : `${kod} — (standart TDHP'de bu kod tanımlı değil; alt/özel hesap olabilir)`;
  });
  return lines.join('\n');
}

/**
 * Güncel vergi oranları — yıl-bağımlı (flip-flop'u biter). new Date() workflow
 * ortamında kısıtlı; burada normal backend çalışır, sorun yok.
 */
export function vergiOranlari(year?: number): {
  yil: number;
  kurumlar: string;
  kurumlarFinans: string;
  gecici: string;
  gelirGecici: string;
  kdv: string;
  kdv2: string;
  not: string;
} {
  const yil = year || new Date().getFullYear();
  return {
    yil,
    kurumlar: '%25',
    kurumlarFinans: '%30 (banka, finansal kiralama, faktoring, finansman, ödeme/elektronik para kuruluşları, sigorta vb. finans sektörü)',
    gecici: '%25 (kurumlar mükellefinde, kurumlar vergisi oranına eşit)',
    gelirGecici: 'Gelir vergisi mükellefinde GVK tarifesinin ilk dilim oranı (%15)',
    kdv: 'Genel %20; indirimli %10 ve %1 (mal/hizmet türüne göre)',
    kdv2: 'KDV tevkifatı (KDV2) TEK ORAN DEĞİLDİR; işlem türüne göre değişir (örn. yapım işi 4/10, temizlik 9/10, danışmanlık/etüt tam tevkifat 10/10). Oran sorulursa işlem türünü iste ya da resmi kaynaktan teyit et.',
    not: 'Kurumlar vergisi %25 (2023\'ten beri); %20/%23 ARTIK GEÇERLİ DEĞİL. Geçici vergi ayrı bir oran DEĞİL — ilgili yıllık verginin oranıdır.',
  };
}

/** Vergi oranı sorusuna metin yanıt (oranTipi: kurumlar|gecici|kdv|kdv2). */
export function vergiOraniAciklama(oranTipi?: string): string {
  const o = vergiOranlari();
  const t = String(oranTipi || '').toLocaleLowerCase('tr-TR');
  if (/kurumlar/.test(t)) return `Kurumlar vergisi oranı ${o.kurumlar} (${o.yil}). Finans sektörü: ${o.kurumlarFinans}. ${o.not}`;
  if (/gecici|geçici/.test(t)) return `Geçici vergi oranı: ${o.gecici}. ${o.gelirGecici}. (Geçici vergi ayrı sabit bir oran değil.)`;
  if (/kdv2|tevkifat/.test(t)) return o.kdv2;
  if (/kdv/.test(t)) return `KDV oranları: ${o.kdv}.`;
  return `Kurumlar vergisi ${o.kurumlar}; geçici vergi ${o.gecici}; KDV ${o.kdv}. KDV2 tevkifat işlem türüne göre değişir. (${o.yil}, ${o.not})`;
}
