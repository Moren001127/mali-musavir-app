// HESAP DAVRANIS DENETIMI — kural katalogu (yeni motorun urettigi kodlar).
//   Her kod: ekranda gorunen ad, ne anlama geldigi, ne yapilmasi gerektigi, varsayilan siddet, alan,
//   mevzuat dayanagi, varsayilan acik/kapali, donem kisiti ve Mizan gereksinimi. Kapsam raporu
//   (calisti/temiz/uygulanmaz) ve ekran katalogu buradan beslenir.
import type { Siddet } from './tipler';

export type DonemKisiti = 'YILLIK' | 'COK_AYLI' | 'GECICI_VEYA_YILLIK';

export type KuralTanimi = {
  kod: string;
  ad: string;
  aciklama: string; // ne demek
  oneri: string; // ne yapilmali
  siddet: Siddet;
  alan: string;
  mevzuat?: string;
  varsayilanAktif: boolean;
  donemKisiti?: DonemKisiti;
  mizanGerekli?: boolean;
};

export const ALAN = {
  TEMEL: 'Temel Bütünlük',
  YEVMIYE: 'Yevmiye / Fiş',
  BELGE: 'Belge / Evrak',
  KASA_BANKA: 'Kasa & Banka',
  CARI: 'Cari Hesaplar (120/320)',
  ORTAK: 'Ortaklar (131/331)',
  STOK: 'Stok & Maliyet',
  KDV: 'KDV',
  VERGI_SGK: 'Vergi & SGK Ödemeleri (335/360/361)',
  BORDRO: 'Bordro & Stopaj',
  DURAN: 'Duran Varlık & Amortisman',
  KREDI: 'Krediler & Finansman',
  GELIR_GIDER: 'Gelir & Gider',
  DONEM_SONU: 'Dönem Sonu / Açılış-Kapanış',
  OZKAYNAK: 'Özkaynak & Özellikli Hesaplar',
  MIZAN: 'Mizan Mutabakatı',
  HESAP_PLANI: 'Hesap Planı & Tabiat',
  FORENSIC: 'Forensic / Anomali',
  AVANS_CEK: 'Avans, Çek & Senet',
} as const;

export const HDD_KATALOG: KuralTanimi[] = [
  // ───────────────────────────── Cari hesaplar
  {
    kod: 'CARI_120_TAHSILAT_YOK', ad: '120 Tahsilat kaydı yok', siddet: 'WARN', alan: ALAN.CARI, mevzuat: 'TDHP · VUK 219',
    aciklama: 'Alıcı alt hesabında dönem boyunca satış faturaları işlenmiş ama hiç tahsilat (kasa/banka/çek/ortak) kaydı yok.',
    oneri: 'Banka ekstresi ve kasa tahsilatları işlenmiş mi kontrol edin; tahsilat gerçekten yoksa alacak takibi/şüpheli alacak değerlendirin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'CARI_320_ODEME_YOK', ad: '320 Ödeme kaydı yok', siddet: 'WARN', alan: ALAN.CARI, mevzuat: 'TDHP · VUK 219',
    aciklama: 'Satıcı alt hesabında dönem boyunca alış faturaları işlenmiş ama hiç ödeme (kasa/banka/çek/ortak) kaydı yok.',
    oneri: 'Banka ekstresi ve kasa ödemeleri işlenmiş mi kontrol edin; ödeme yoksa satıcı borcu gerçekten açık demektir.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'CARI_120_TAHSILAT_ORANI_DUSUK', ad: '120 Tahsilat oranı düşük', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'TDHP',
    aciklama: 'Alıcı alt hesabında tahsilat var ama dönem faturalarının çok küçük bir kısmını karşılıyor.',
    oneri: 'Eksik tahsilat kaydı mı, vadeli satış mı? Cari mutabakat yapın.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'CARI_320_ODEME_ORANI_DUSUK', ad: '320 Ödeme oranı düşük', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'TDHP',
    aciklama: 'Satıcı alt hesabında ödeme var ama dönem alışlarının çok küçük bir kısmını karşılıyor.',
    oneri: 'Eksik ödeme kaydı mı, vadeli alış mı? Satıcı mutabakatı yapın.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'CARI_HAREKETSIZ_BAKIYE', ad: 'Hareketsiz cari bakiyesi', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'VUK 323 · TDHP',
    aciklama: 'Mizanda bakiyesi olan cari hesap dönem boyunca hiç hareket görmemiş (en az 3 aydır dokunulmamış alacak/borç).',
    oneri: 'Alacaksa tahsil kabiliyetini ve şüpheli alacak (128/129) şartlarını, borçsa mutabakatı kontrol edin.',
    varsayilanAktif: true, mizanGerekli: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'CARI_AYNI_TARAF_120_320', ad: 'Aynı cari hem 120 hem 320', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'TDHP',
    aciklama: 'Aynı işletme hem alıcı (120) hem satıcı (320) olarak hareket görüyor.',
    oneri: 'Karşılıklı bakiye varsa mahsup/netleştirme kararını ve Ba/Bs uyumunu kontrol edin.',
    varsayilanAktif: true,
  },
  {
    kod: 'MUKERRER_CARI_KARTI', ad: 'Mükerrer cari kartı', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'TDHP',
    aciklama: 'Aynı işletme için birden fazla alt hesap açılmış görünüyor (aynı ad, farklı kod).',
    oneri: 'Kartları birleştirin; bakiye ve Ba/Bs bildirimi bölünmesin.',
    varsayilanAktif: true,
  },
  {
    kod: 'DEFTER_TAHSILAT_ODEME_ISLENMEMIS', ad: 'Tahsilat/ödeme kayıtları işlenmemiş (defter geneli)', siddet: 'ERROR', alan: ALAN.CARI, mevzuat: 'VUK 219 · VUK 459',
    aciklama: 'Cari hesapların büyük çoğunluğu tek yönlü çalışıyor ve kasa/banka hareketi yok: dönemde yalnız faturalar işlenmiş, tahsilat ve ödemeler işlenmemiş.',
    oneri: 'Banka ekstrelerini ve kasa hareketlerini işleyin; bu haliyle defter gerçek durumu yansıtmaz, geçici vergi/berat öncesi tamamlanmalı.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'ALACAK_CIRO_ORANI_YUKSEK', ad: 'Alacaklar ciroya göre çok yüksek', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'TDHP',
    aciklama: 'Mizandaki toplam alıcı (120) bakiyesi dönem satışlarının katlarca üzerinde.',
    oneri: 'Tahsilatlar işlenmemiş ya da tahsil edilemeyen eski alacaklar var; yaşlandırma yapın.',
    varsayilanAktif: true, mizanGerekli: true,
  },

  // ───────────────────────────── Vergi & SGK & personel odeme dongusu
  {
    kod: 'VERGI_360_ODEME_YOK', ad: '360 Vergi tahakkuku ödenmemiş', siddet: 'WARN', alan: ALAN.VERGI_SGK, mevzuat: 'VUK 112 · 6183',
    aciklama: 'Ay içinde tahakkuk eden vergi (KDV, muhtasar, damga…) izleyen ayda ödenmemiş ya da ödeme kaydı işlenmemiş. 2 ay üst üste ise hata.',
    oneri: 'Banka ekstresinde vergi ödemesini bulup işleyin; gerçekten ödenmediyse gecikme zammı ve 6183 riski var.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'SGK_361_ODEME_YOK', ad: '361 SGK primi ödenmemiş', siddet: 'WARN', alan: ALAN.VERGI_SGK, mevzuat: '5510 md. 88',
    aciklama: 'Ay içinde tahakkuk eden SGK primi izleyen ayın sonuna kadar ödenmemiş ya da ödeme kaydı işlenmemiş. Fiilen ödenmeyen prim gider yazılamaz (KKEG).',
    oneri: 'Ödeme kaydını işleyin; ödenmediyse beyannamede KKEG olarak dikkate alın ve teşvik kaybını değerlendirin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'PERSONEL_335_ODEME_YOK', ad: '335 Ücret ödemesi kaydı yok', siddet: 'WARN', alan: ALAN.VERGI_SGK, mevzuat: '4857 md. 32',
    aciklama: 'Net ücret tahakkuk etmiş ama izleyen ayda personele ödeme kaydı yok.',
    oneri: 'Banka maaş ödemelerini işleyin; ödenmemiş ücret varsa iş hukuku riski doğar.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'VERGI_SGK_ODEME_TUTAR_UYUMSUZ', ad: 'Vergi/SGK ödemesi tahakkuktan farklı', siddet: 'INFO', alan: ALAN.VERGI_SGK, mevzuat: '6183',
    aciklama: 'Ödeme var ama tahakkuk tutarından farklı (kısmi ödeme, gecikme zammı, mahsup veya teşvik farkı).',
    oneri: 'Farkın sebebini (gecikme zammı → 689 KKEG, teşvik → 602) doğru hesaba işleyin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'VERGI_SGK_TERS_BAKIYE', ad: '335/360/361 borç bakiyeye düştü', siddet: 'WARN', alan: ALAN.VERGI_SGK, mevzuat: 'TDHP',
    aciklama: 'Ödeme, tahakkuku aşmış: hesap borç bakiye veriyor. Ödeme yanlış alt hesaba işlenmiş ya da tahakkuk kaydı eksik.',
    oneri: 'Ödemenin ait olduğu tahakkuku bulun; eksik tahakkuku işleyin.',
    varsayilanAktif: true,
  },
  {
    kod: 'VERGI_SGK_DEVREDEN_BORC_ODENMEMIS', ad: 'Önceki dönemden devreden vergi/SGK borcu ödenmemiş', siddet: 'WARN', alan: ALAN.VERGI_SGK, mevzuat: '6183',
    aciklama: 'Dönem başında bekleyen vergi/SGK borcu dönem boyunca ödenmemiş (bakiye birikiyor).',
    oneri: 'Yapılandırma/taksit varsa 368 hesabına alın; değilse ödeme planı yapın.',
    varsayilanAktif: true, mizanGerekli: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'PERSONEL_335_ODEME_KASADAN', ad: 'Ücret kasadan ödenmiş', siddet: 'INFO', alan: ALAN.VERGI_SGK, mevzuat: 'Ücret Yön. md. 10',
    aciklama: 'Personel ücreti kasadan (nakit) ödenmiş görünüyor. 5 ve üzeri çalışanı olan işverenler ücreti banka üzerinden ödemek zorundadır.',
    oneri: 'Çalışan sayısı 5 ve üzeriyse ödemeleri bankadan yapın ve kaydı düzeltin.',
    varsayilanAktif: false,
  },
  {
    kod: 'BORDRO_NET_BRUT_ORANI_ANORMAL', ad: 'Bordro net/brüt oranı olağan dışı', siddet: 'WARN', alan: ALAN.BORDRO, mevzuat: 'GVK 61-63 · 5510',
    aciklama: 'Bordro fişinde net ücret (335) ile brüt ücret gideri (7xx) oranı beklenen aralığın dışında.',
    oneri: 'Bordro hesaplamasını ve fiş bacaklarını (SGK işveren payı, kesintiler) kontrol edin.',
    varsayilanAktif: true,
  },
  {
    kod: 'BORDRO_SGK_ORANI_ANORMAL', ad: 'Bordro SGK/brüt oranı olağan dışı', siddet: 'INFO', alan: ALAN.BORDRO, mevzuat: '5510 md. 81',
    aciklama: 'Bordro fişinde SGK kesintisi (361) ile brüt ücret gideri oranı beklenen aralığın dışında.',
    oneri: 'İşçi+işveren primi ve teşvik indirimlerini kontrol edin.',
    varsayilanAktif: true,
  },

  // ───────────────────────────── Kasa & Banka
  {
    kod: 'BANKA_HAREKETI_YOK', ad: 'Banka hareketi hiç yok', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 219 · VUK 459',
    aciklama: 'İşletmenin banka hesabı var (mizan) ya da düzenli satışı var ama dönemde hiç banka (102) hareketi işlenmemiş.',
    oneri: 'Banka ekstrelerini işleyin; tahsilat/ödeme/masraf/faiz kayıtları eksik demektir.',
    varsayilanAktif: true,
  },
  {
    kod: 'BANKA_TEK_YONLU', ad: 'Banka hesabı tek yönlü çalışmış', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 219',
    aciklama: 'Banka alt hesabı yalnız giriş ya da yalnız çıkış görmüş; ekstre kısmen işlenmiş olabilir.',
    oneri: 'Ekstreyi baştan sona işleyin; vadeli/bloke hesapsa bilgi olarak geçin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'KASA_HAREKETI_YOK', ad: 'Kasa hareketi hiç yok', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 219',
    aciklama: 'Satış var ama dönemde hiç kasa (100) hareketi yok. Tamamen bankayla çalışan işletmede normaldir.',
    oneri: 'Nakit tahsilat/ödeme varsa kasa kayıtlarını işleyin.',
    varsayilanAktif: true,
  },
  {
    kod: 'KASA_BAKIYE_YUKSEK', ad: 'Kasa bakiyesi yüksek', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'KVK 13 · VUK 186',
    aciklama: 'Mizandaki kasa bakiyesi işletme ölçeğine göre yüksek; fiilen kasada olmayan para ortaklara kullandırılmış sayılabilir (adat faizi, örtülü kazanç).',
    oneri: 'Fiili kasa sayımı yapın; fark ortak carisine alınmalı ve adat faizi hesaplanmalı.',
    varsayilanAktif: true, mizanGerekli: true,
  },
  {
    kod: 'POS_108_TEK_YONLU', ad: 'POS tahsilatları bankaya aktarılmamış', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'TDHP',
    aciklama: '108 POS hesabı yalnız borç çalışmış: kredi kartı tahsilatları bankaya geçtiğinde kapatılmamış.',
    oneri: 'Banka ekstresindeki POS aktarımlarını 108 → 102 olarak işleyin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'BANKA_MASRAF_KAYDI_YOK', ad: 'Banka masraf/komisyon kaydı yok', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 219',
    aciklama: 'Aktif çalışan banka hesabı var ama dönemde hiç banka masrafı/komisyon/BSMV gideri işlenmemiş.',
    oneri: 'Ekstredeki masraf, komisyon ve BSMV satırlarını gider olarak işleyin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'DOVIZ_HESAP_KUR_DEGERLEME_YOK', ad: 'Dövizli hesapta kur değerlemesi yok', siddet: 'WARN', alan: ALAN.DONEM_SONU, mevzuat: 'VUK 280',
    aciklama: 'Adında döviz geçen hesap (USD/EUR/GBP) var ama dönem sonunda kur farkı (646/656) kaydı yok. Geçici vergi dönemlerinde de değerleme zorunludur.',
    oneri: 'Dönem sonu TCMB alış kuruyla değerleme yapın; farkı 646/656 hesaplarına işleyin.',
    varsayilanAktif: true, donemKisiti: 'GECICI_VEYA_YILLIK',
  },
  {
    kod: 'VADELI_MEVDUAT_FAIZ_YOK', ad: 'Vadeli mevduat var, faiz geliri yok', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 281 · GVK 94',
    aciklama: 'Adında vadeli geçen banka hesabı var ama dönemde faiz geliri (642) ve stopaj (193) kaydı yok.',
    oneri: 'Dönem sonu faiz tahakkukunu ve kesilen stopajı işleyin.',
    varsayilanAktif: true,
  },

  // ───────────────────────────── Stok & maliyet & gider
  {
    kod: 'SMM_621_YOK', ad: 'Satılan malın maliyeti kaydı yok', siddet: 'INFO', alan: ALAN.STOK, mevzuat: 'VUK 186 · TDHP',
    aciklama: 'Satış var ama dönem sonunda satılan malın maliyeti (621/622) kaydı yok; stok hesabı hiç çıkış görmemiş.',
    oneri: 'Dönem sonu stok tespiti yapıp SMM kaydını atın (yıllık defterde zorunlu, geçici vergide beyan matrahını etkiler).',
    varsayilanAktif: true, donemKisiti: 'GECICI_VEYA_YILLIK',
  },
  {
    kod: 'STOK_KDV_ORANI_ALT_HESAP_UYUMSUZ', ad: 'Stok alt hesabı KDV oranıyla uyuşmuyor', siddet: 'WARN', alan: ALAN.STOK, mevzuat: 'KDVK 28',
    aciklama: 'Alt hesap adında yazan KDV oranı (ör. "%20") ile fişteki 191 KDV / stok tutarı oranı farklı.',
    oneri: 'Fişi doğru oranlı stok alt hesabına taşıyın ya da KDV tutarını düzeltin.',
    varsayilanAktif: true,
  },
  {
    kod: 'STOK_CIRO_ORANI_YUKSEK', ad: 'Stok bakiyesi satışa göre çok yüksek', siddet: 'INFO', alan: ALAN.STOK, mevzuat: 'VUK 186',
    aciklama: 'Mizandaki stok bakiyesi dönem satışlarının üzerinde; SMM kaydı eksik ya da fiili stok şişkin olabilir.',
    oneri: 'Fiili envanterle karşılaştırın; SMM ve stok değer düşüklüğünü değerlendirin.',
    varsayilanAktif: true, mizanGerekli: true,
  },
  {
    kod: 'SABIT_GIDER_AY_ATLAMIS', ad: 'Düzenli gider bir ayda yok', siddet: 'INFO', alan: ALAN.GELIR_GIDER, mevzuat: 'VUK 219',
    aciklama: 'Kira, elektrik, su, doğalgaz, telefon/internet, muhasebe ücreti gibi her ay tekrarlayan gider bir ayda hiç görünmüyor.',
    oneri: 'O ayın faturası işlenmemiş olabilir; e-Fatura/e-Arşiv gelen kutusunu kontrol edin.',
    varsayilanAktif: true, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'AYLIK_HAREKET_KESINTISI', ad: 'Bir ayda hiç kayıt yok', siddet: 'INFO', alan: ALAN.GELIR_GIDER, mevzuat: 'VUK 219',
    aciklama: 'Satış, alış-gider ya da KDV hesaplarında diğer aylarda düzenli hareket varken bir ayda hiç kayıt yok.',
    oneri: 'O ayın fişleri işlenmemiş olabilir; mevsimsel durgunluksa bilgi olarak geçin.',
    varsayilanAktif: false, donemKisiti: 'COK_AYLI',
  },
  {
    kod: 'KREDI_FAIZ_GIDERI_YOK', ad: 'Kredi var, faiz gideri yok', siddet: 'WARN', alan: ALAN.KREDI, mevzuat: 'VUK 285 · KVK 11',
    aciklama: 'Banka kredisi (300/400) bakiyesi ya da hareketi var ama dönemde finansman gideri (780/660/661) kaydı yok.',
    oneri: 'Kredi taksit tablosundaki faizleri işleyin; dönem sonu işlemiş faiz tahakkukunu unutmayın.',
    varsayilanAktif: true,
  },
  {
    kod: 'GELECEK_AY_180_AKTARIM_YOK', ad: '180 gider aktarımı yapılmamış', siddet: 'INFO', alan: ALAN.DONEM_SONU, mevzuat: 'VUK 283 · dönemsellik',
    aciklama: '180 Gelecek Aylara Ait Giderler bakiyesi var ama dönem içinde aylık gider aktarımı (180 alacak → 7xx) yok.',
    oneri: 'Peşin ödenen kira/sigorta gibi giderlerin ait olduğu ayları gidere aktarın.',
    varsayilanAktif: true,
  },
  {
    kod: 'KKEG_NITELIKLI_GIDER_7XX', ad: 'KKEG niteliğinde gider 7xx\'e yazılmış', siddet: 'WARN', alan: ALAN.GELIR_GIDER, mevzuat: 'KVK 11 · GVK 41 · 6183 md. 51',
    aciklama: 'Vergi cezası, gecikme zammı/faizi, trafik cezası, idari para cezası, binek oto MTV gibi kanunen kabul edilmeyen giderler normal gider hesabına işlenmiş.',
    oneri: 'Kaydı 689 KKEG hesabına alın ya da beyannamede matraha ekleyin.',
    varsayilanAktif: true,
  },
  {
    kod: 'DEMIRBAS_DOGRUDAN_GIDER', ad: 'Demirbaş doğrudan gider yazılmış', siddet: 'INFO', alan: ALAN.DURAN, mevzuat: 'VUK 313',
    aciklama: 'Açıklamasında demirbaş niteliği (bilgisayar, telefon, klima, mobilya, makine…) geçen ve VUK 313 sınırını aşan tutar doğrudan gidere yazılmış.',
    oneri: 'Sınırı aşan iktisadi kıymeti aktifleştirip amortismana tabi tutun.',
    varsayilanAktif: true,
  },
  {
    kod: 'BRUT_SATIS_ZARARI', ad: 'Brüt satış zararı', siddet: 'INFO', alan: ALAN.GELIR_GIDER, mevzuat: 'KVK 13 · VUK 186',
    aciklama: 'Mizanda satılan malın maliyeti net satışlardan büyük: brüt zarar. Fiyatlama, stok/SMM hatası ya da maliyet altı satış olabilir.',
    oneri: 'SMM hesabını ve satış fiyatlarını kontrol edin; ilişkili kişiye maliyet altı satış transfer fiyatlandırması riski taşır.',
    varsayilanAktif: true, mizanGerekli: true,
  },

  // ───────────────────────────── Duran varlik, kredi, ozkaynak
  {
    kod: 'SABIT_KIYMET_SATISI_EKSIK_BACAK', ad: 'Sabit kıymet satışında eksik bacak', siddet: 'WARN', alan: ALAN.DURAN, mevzuat: 'VUK 328 · KDVK 1',
    aciklama: 'Sabit kıymet hesabından çıkış (25x alacak) var ama aynı fişte birikmiş amortisman (257/268), KDV (391) ya da kâr/zarar hesabı yok.',
    oneri: 'Satış fişini VUK 328\'e göre tamamlayın: birikmiş amortismanı kapatın, KDV hesaplayın, kâr/zararı 649/659 (veya 679/689) hesabına alın.',
    varsayilanAktif: true,
  },
  {
    kod: 'BINEK_OTO_KDV_INDIRIM', ad: 'Taşıt alışında KDV indirimi', siddet: 'INFO', alan: ALAN.DURAN, mevzuat: 'KDVK 30/b',
    aciklama: 'Taşıt (254) alış fişinde KDV 191\'e alınmış. Binek otomobilse KDV indirilemez (maliyete veya gidere yazılır); kamyon, kamyonet gibi ticari araçta indirilebilir.',
    oneri: 'Araç binekse KDV\'yi 191\'den çıkarıp maliyete ekleyin; ayrıca binek oto amortisman/gider kısıtını uygulayın.',
    varsayilanAktif: true,
  },
  {
    kod: 'OZELLIKLI_258_YAPILMAKTA_OLAN_YATIRIM', ad: '258 Yapılmakta olan yatırım bakiyesi', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'VUK 262-269',
    aciklama: 'Yapılmakta olan yatırımlar hesabında bakiye var. Yatırım tamamlanınca ilgili sabit kıymet hesabına aktarılıp amortismana başlanmalıdır.',
    oneri: 'Tamamlanan kısmı ilgili 25x hesabına aktarın.',
    varsayilanAktif: true, mizanGerekli: true,
  },
  {
    kod: 'OZELLIKLI_570_KAR_DAGITIM_YEDEK', ad: '570 Geçmiş yıl kârı bekliyor', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'TTK 519 · GVK 94/6',
    aciklama: 'Geçmiş yıl kârları hesabında bakiye var. Kâr dağıtımı kararı alındıysa I. tertip yasal yedek (%5) ve kâr payı stopajı (%15) gerekir; dağıtılmadıysa bilgi.',
    oneri: 'Genel kurul kararına göre 540 yasal yedek ve 331/360 kayıtlarını kontrol edin.',
    varsayilanAktif: true, mizanGerekli: true,
  },
  {
    kod: 'UZUN_VADELI_KREDI_KISA_VADE_AKTARIM', ad: 'Uzun vadeli kredinin cari kısmı aktarılmamış', siddet: 'INFO', alan: ALAN.KREDI, mevzuat: 'TDHP',
    aciklama: 'Yıl sonunda 400 Uzun Vadeli Banka Kredileri bakiyesi var ama gelecek yıl ödenecek taksitlerin 300\'e aktarımı yok.',
    oneri: 'Bir yıl içinde ödenecek anaparayı 300 hesabına virmanlayın (bilanço sınıflandırması).',
    varsayilanAktif: true, donemKisiti: 'YILLIK', mizanGerekli: true,
  },
  {
    kod: 'SERMAYE_HAREKETI_KONTROL', ad: 'Sermaye hesabında hareket', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'TTK 456-473',
    aciklama: 'Dönemde 500 Sermaye hesabı hareket görmüş (artırım/azaltım).',
    oneri: 'Ticaret sicil tescilini, 501 ödenmemiş sermaye kaydını ve nakdi sermaye artırımı faiz indirimini (KVK 10/1-ı) kontrol edin.',
    varsayilanAktif: true,
  },
  {
    kod: 'ORTAK_ADAT_FAIZI_YOK', ad: 'Ortak cari için adat faizi yok', siddet: 'INFO', alan: ALAN.ORTAK, mevzuat: 'KVK 13 · KDVK 1',
    aciklama: 'Yıl boyunca ortaklardan alacak (131) bakiyesi var ama yıl sonunda adat faizi geliri (642) ve KDV\'si kaydı yok.',
    oneri: 'Ortağa kullandırılan para için emsal faiz hesaplayıp fatura düzenleyin (transfer fiyatlandırması).',
    varsayilanAktif: true, donemKisiti: 'YILLIK',
  },
  {
    kod: 'KIDEM_KARSILIGI_YOK', ad: 'Kıdem tazminatı karşılığı ayrılmamış', siddet: 'INFO', alan: ALAN.BORDRO, mevzuat: 'TTK 88 · VUK / KKEG',
    aciklama: 'Personel var ama yıl sonunda kıdem tazminatı karşılığı (472/372) kaydı yok. Vergisel olarak KKEG olsa da TTK/BOBİ FRS için gereklidir.',
    oneri: 'Bağımsız denetim/finansal raporlama kapsamındaysa karşılık ayırın; değilse bilgi olarak geçin.',
    varsayilanAktif: true, donemKisiti: 'YILLIK',
  },
  {
    kod: 'GECICI_VERGI_KARSILIK_KAYDI_YOK', ad: 'Geçici vergi karşılığı kaydı yok', siddet: 'INFO', alan: ALAN.DONEM_SONU, mevzuat: 'GVK mük. 120 · KVK 32',
    aciklama: 'Dönem kârlı görünüyor ama geçici vergi dönemi sonunda 370/371 (veya 691) vergi karşılığı kaydı yok. Kayıt isteğe bağlıdır; beyanname yine verilir.',
    oneri: 'Beyanname tutarını 691/370 olarak kaydetmek dönem net kârını doğru gösterir.',
    varsayilanAktif: true, mizanGerekli: true, donemKisiti: 'GECICI_VEYA_YILLIK',
  },

  // ───────────────────────────── Gelir / KDV / fis
  {
    kod: 'SATIS_KDV_YOK', ad: 'Satış fişinde KDV yok', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 1 · KDVK 11-17',
    aciklama: 'Yurtiçi satış (600) kaydı var ama aynı fişte hesaplanan KDV (391) yok ve istisna/ihracat/tevkifat açıklaması da yok.',
    oneri: 'KDV hesaplanması gerekiyorsa fişi düzeltin; istisna ise açıklamaya/belge türüne işleyin.',
    varsayilanAktif: true,
  },
  {
    kod: 'IADE_610_KDV_DUZELTME_YOK', ad: 'Satış iadesinde KDV düzeltmesi yok', siddet: 'INFO', alan: ALAN.KDV, mevzuat: 'KDVK 35',
    aciklama: 'Satıştan iade (610) kaydı var ama aynı fişte 391 borç (KDV düzeltmesi) yok.',
    oneri: 'İade faturasındaki KDV\'yi 391 borç olarak işleyin.',
    varsayilanAktif: true,
  },
  {
    kod: 'KDV_DEVREDEN_VE_ODENECEK_AYNI_AY', ad: 'Aynı ayda hem devreden hem ödenecek KDV', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 29 · KDVK 41',
    aciklama: 'Aynı ayın tahakkukunda hem 190 devreden KDV hem 360 ödenecek KDV çıkmış; ikisi birlikte olamaz.',
    oneri: 'Tahakkuk fişini beyannameyle karşılaştırıp düzeltin.',
    varsayilanAktif: true,
  },
  {
    kod: 'MUKERRER_FATURA_CARI_BAZLI', ad: 'Mükerrer fatura (cari + belge no + tutar)', siddet: 'ERROR', alan: ALAN.BELGE, mevzuat: 'KDVK 29 · VUK 219',
    aciklama: 'Aynı cari hesapta aynı belge numarası ve aynı tutar birden fazla fişte işlenmiş. KDV mükerrer indirilmiş/hesaplanmış olabilir.',
    oneri: 'Fişlerden birini iptal edin; beyanname verildiyse düzeltme beyannamesi gerekir.',
    varsayilanAktif: true,
  },
  {
    kod: 'FIS_TARIHI_AY_SONU_YIGILMA', ad: 'Fişler ay sonuna yığılmış', siddet: 'INFO', alan: ALAN.FORENSIC, mevzuat: 'VUK 219 · BDS 240',
    aciklama: 'Fişlerin büyük kısmı ayın son gününe tarihlenmiş: kayıtlar belge tarihine göre değil toplu olarak ay sonunda işleniyor.',
    oneri: 'Kayıtları belge tarihine göre işleyin; 10 günlük kayıt süresi (VUK 219) aşılmasın.',
    varsayilanAktif: true,
  },

  // ───────────────────────────── Her hesabin tabiati
  {
    kod: 'HESAP_TABIATINA_AYKIRI_BAKIYE', ad: 'Hesap tabiatına aykırı bakiye', siddet: 'WARN', alan: ALAN.HESAP_PLANI, mevzuat: 'TDHP',
    aciklama: 'Hesabın kapanış bakiyesi Tek Düzen Hesap Planındaki doğal yönünün tersinde (ör. 257 borç, 300 borç, 391 borç, 6xx gelir borç bakiye).',
    oneri: 'Kayıt yönünü ve karşı hesabı kontrol edin; ters bakiye çoğu zaman yanlış hesaba kayıttır.',
    varsayilanAktif: true,
  },
  {
    kod: 'HESAP_ADI_BOS', ad: 'Hesap adı boş/anlamsız', siddet: 'INFO', alan: ALAN.HESAP_PLANI, mevzuat: 'TDHP',
    aciklama: 'Alt hesabın adı boş ya da yalnızca kod/işaret içeriyor; e-Defter beratında hesap adı görünür.',
    oneri: 'Hesap planında adı tamamlayın.',
    varsayilanAktif: true,
  },
];

export const HDD_KOD_SETI = new Set(HDD_KATALOG.map((k) => k.kod));
export const HDD_VARSAYILAN_KAPALI = HDD_KATALOG.filter((k) => !k.varsayilanAktif).map((k) => k.kod);

export function hddKural(kod: string): KuralTanimi | undefined {
  return HDD_KATALOG.find((k) => k.kod === kod);
}
