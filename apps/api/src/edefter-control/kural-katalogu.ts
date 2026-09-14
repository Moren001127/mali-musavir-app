// e-DEFTER KONTROL — TEK KURAL KATALOGU (sunucu tarafi; ekran buradan okur).
//   ESKI motor (edefter-control.service.ts icindeki ~85 kural) + HDD (hesap-davranis motoru) kurallari.
//   Ekrandaki etiket, grup (alan), mevzuat, varsayilan acik/kapali ve kapsam raporu buradan beslenir.
//   NOT: ESKI kurallarin ad/aciklama metinleri ekrandaki katalogdan aynen tasindi (2026-09-13).
import { ALAN, HDD_KATALOG, KuralTanimi as HddKuralTanimi } from './hesap-davranis/katalog';

export type KuralTanimi = HddKuralTanimi & { motor: 'ESKI' | 'HDD' | 'MANUEL' }; // MANUEL: kullanici tanimli kural (manuel-kurallar.ts)

export const ALAN_SIRASI: string[] = [
  ALAN.TEMEL, ALAN.CARI, ALAN.VERGI_SGK, ALAN.KASA_BANKA, ALAN.KDV, ALAN.BORDRO, ALAN.STOK, ALAN.GELIR_GIDER,
  ALAN.DURAN, ALAN.KREDI, ALAN.ORTAK, ALAN.AVANS_CEK, ALAN.DONEM_SONU, ALAN.OZKAYNAK, ALAN.MIZAN,
  ALAN.HESAP_PLANI, ALAN.BELGE, ALAN.YEVMIYE, ALAN.FORENSIC,
];

const ESKI_KURALLAR: KuralTanimi[] = [
  { kod: 'DEFTER_GENELI_DENGESIZ', ad: 'Defter geneli borç=alacak', aciklama: 'Tüm dönem toplam borç ile alacak eşit değilse uyarır. Berat oluşturmadan önce mutlaka düzeltilmelidir.', oneri: '', siddet: 'ERROR', alan: ALAN.TEMEL, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'HESAP_KODU_EKSIK', ad: 'Hesap kodu eksik', aciklama: 'Satırda hesap kodu boş bırakılmış.', oneri: '', siddet: 'ERROR', alan: ALAN.TEMEL, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'DONEM_DISI_TARIH', ad: 'Dönem dışı tarih', aciklama: 'Fiş tarihi seçilen dönem aralığının dışında.', oneri: '', siddet: 'ERROR', alan: ALAN.TEMEL, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'FIS_TARIHI_PARSE_HATASI', ad: 'Tarih parse hatası (aggregate)', aciklama: 'Excel sütununda tarih okunamayan satırların toplam sayısı.', oneri: '', siddet: 'WARN', alan: ALAN.TEMEL, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'VKN_FORMAT_HATALI', ad: 'VKN/TCKN format hatası', aciklama: 'VKN/TCKN 10 veya 11 haneli değil.', oneri: '', siddet: 'ERROR', alan: ALAN.BELGE, mevzuat: 'VUK 230', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'VKN_ALGORITMA_HATALI', ad: 'VKN/TCKN algoritması tutmuyor', aciklama: 'Hane sayısı doğru ama Maliye kontrol algoritması başarısız. BA/BS uyumsuzluğu yaratır.', oneri: '', siddet: 'ERROR', alan: ALAN.BELGE, mevzuat: 'VUK 230', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'GERCEK_MUKERRER_FATURA', ad: 'Gerçek mükerrer fatura', aciklama: 'Aynı belge no + aynı VKN + aynı tutar üç alan birden eşleşiyor. KDV indirimi mükerrer inmiş olabilir.', oneri: '', siddet: 'ERROR', alan: ALAN.BELGE, mevzuat: 'KDVK 29', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', ad: 'Aynı gün/tutar/taraf', aciklama: 'Aynı tarihte aynı VKN için aynı tutarlı 50.000+ TL kayıt birden fazla.', oneri: '', siddet: 'WARN', alan: ALAN.BELGE, mevzuat: 'BDS 240', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'HAVADA_KDV_KAYDI', ad: 'Havada KDV kaydı', aciklama: '191/391 KDV var ama matrah veya cari/kasa karşılık hesabı yok.', oneri: '', siddet: 'ERROR', alan: ALAN.KDV, mevzuat: 'KDVK 29', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CARI_TERS_BAKIYE_120', ad: '120 ters bakiye', aciklama: '120 Alıcılar dönem hareketinde alacak (ters) bakiye veriyor (eşik 5.000 TL, açılış hariç). Müşteri avansı olabilir ya da bir alış satıcı hesabı (320) yerine 120\'ye işlenmiş olabilir.', oneri: '', siddet: 'WARN', alan: ALAN.CARI, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CARI_TERS_BAKIYE_320', ad: '320 ters bakiye', aciklama: '320 Satıcılar dönem hareketinde borç (ters) bakiye veriyor (eşik 5.000 TL, açılış hariç). Satıcıya avans olabilir ya da bir satış müşteri hesabı (120) yerine 320\'ye işlenmiş olabilir.', oneri: '', siddet: 'WARN', alan: ALAN.CARI, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'ORTAK_ALACAK_FAIZ_RISKI', ad: '131 ortak alacağı', aciklama: '131 Ortaklardan Alacaklar net bakiyesi 100.000+ TL. KKEG faiz hesaplaması gerekebilir.', oneri: '', siddet: 'INFO', alan: ALAN.ORTAK, mevzuat: 'KVK 13', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KASA_HAREKET_30000_TEVSIK_RISKI', ad: 'Kasa hareket 30.000 TL', aciklama: 'Tek 100 Kasa hareketi 30.000 TL sınırını aşıyorsa ödeme/tahsilat mahiyeti ve banka/finans kurumu belgesi kontrol edilir.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 459', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KASA_TEVSIK_PARCALAMA', ad: 'Aynı gün aynı taraf kasa toplamı', aciklama: 'Aynı VKN/TCKN için aynı gün yapılan birden fazla kasa hareketi birlikte 30.000 TL sınırını aşıyorsa parçalama riski kontrol edilir.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 459', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KASA_TEVSIK_BOLUNMUS_ISLEM', ad: 'Kısım kısım kasa işlemi', aciklama: 'Aynı VKN/TCKN ve aynı belge no için farklı günlerdeki kasa hareketleri toplamı 30.000 TL sınırını aşıyorsa kısmi ödeme/tahsilat tevsiki kontrol edilir.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'VUK 459', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'FIS_DENGESIZ', ad: 'Fiş dengesiz', aciklama: 'Tek fişin borç ve alacak toplamları eşit değil.', oneri: '', siddet: 'ERROR', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YEVMIYE_NO_MUKERRER', ad: 'Yevmiye no mükerrer', aciklama: 'Aynı yevmiye numarası farklı tarihlerde / farklı fişlerde kullanılmış.', oneri: '', siddet: 'ERROR', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YEVMIYE_NO_ATLAMA', ad: 'Yevmiye no atlama', aciklama: 'Yevmiye numarası sırasında atlanmış aralık var (tek özet). Genelde iptal edilen fişlerden kaynaklanır.', oneri: '', siddet: 'INFO', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YEVMIYE_TARIH_SIRASI', ad: 'Yevmiye tarih sırası', aciklama: 'Yevmiye numarası ile fiş tarihleri sıralı değil.', oneri: '', siddet: 'WARN', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BOS_FIS', ad: 'Boş fiş', aciklama: 'Fişte hiçbir hareket satırı yok.', oneri: '', siddet: 'WARN', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'TEK_SATIRLI_FIS', ad: 'Tek satırlı fiş', aciklama: 'Fişte sadece 1 hareket satırı var — çift taraflı kayıt prensibi ihlali.', oneri: '', siddet: 'WARN', alan: ALAN.YEVMIYE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BELGE_TARIHI_FIS_TARIHINDEN_SONRA', ad: 'Belge tarihi > fiş tarihi', aciklama: 'Belge tarihi fiş tarihinden sonra — mantıken belge kaydedildiği günden sonra düzenlenmiş.', oneri: '', siddet: 'WARN', alan: ALAN.BELGE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BELGE_TARIHI_DONEM_DISI', ad: 'Belge tarihi dönem dışı', aciklama: 'Belge tarihi seçilen dönem aralığının dışında.', oneri: '', siddet: 'WARN', alan: ALAN.BELGE, mevzuat: 'VUK 219', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YUKSEK_TUTAR_ACIKLAMA_EKSIK', ad: 'Yüksek tutar açıklama eksik', aciklama: '50.000+ TL fişte açıklama 5 karakterden az — denetimde riskli.', oneri: '', siddet: 'INFO', alan: ALAN.YEVMIYE, mevzuat: 'BDS 230', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'DONEM_SONU_191_BAKIYE', ad: '191 dönem sonu bakiye', aciklama: 'Dönem sonu 191 İndirilecek KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 29', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'DONEM_SONU_391_BAKIYE', ad: '391 dönem sonu bakiye', aciklama: 'Dönem sonu 391 Hesaplanan KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'KDV_TAHAKKUK_EKSIK', ad: 'KDV tahakkuk fişi eksik', aciklama: 'Ay içinde 191/391 hareketi var ama tahakkuk fişi bulunamadı. Çeyrek dönemde son ayın tahakkuku bir sonrakine kaymış olabilir.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BORDRO_TAHAKKUK_EKSIK', ad: 'Aylık bordro tahakkuku eksik', aciklama: 'Her ay 770/772 personel gideri + 335 net ücret + 361 SGK kayıtları olmalı.', oneri: '', siddet: 'WARN', alan: ALAN.BORDRO, mevzuat: '5510 / GVK 94', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KIRA_STOPAJI_EKSIK', ad: 'Kira stopajı eksik', aciklama: 'Kira gideri var ama 360 altında kira stopajı kaydı yok. %20 stopaj (GVK 94) ayrı fişte/dönemde olabilir; kontrol edilmeli.', oneri: '', siddet: 'WARN', alan: ALAN.BORDRO, mevzuat: 'GVK 94', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KIRA_STOPAJI_ORAN', ad: 'Kira stopaj oranı sapma', aciklama: 'Kira/stopaj oranı %20 dışında — brüt/net hesaplama hatalı olabilir.', oneri: '', siddet: 'WARN', alan: ALAN.BORDRO, mevzuat: 'GVK 94', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'SMM_STOPAJI_KONTROL', ad: 'Serbest meslek stopajı eksik', aciklama: 'SMM/avukat/noter/tercüme ödemesi var ama 360.01.007 boş. %20 tevkifat zorunlu.', oneri: '', siddet: 'WARN', alan: ALAN.BORDRO, mevzuat: 'GVK 94', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'DAMGA_VERGISI_KONTROL', ad: 'Damga vergisi kontrolü', aciklama: 'Personel ücret/bordro kaydı var ama 360.01.002 veya 360 altında damga kaydı görünmüyorsa bilgi verir. Asgari ücret istisnası veya ayrı fiş ihtimali nedeniyle kesin hata sayılmaz.', oneri: '', siddet: 'INFO', alan: ALAN.BORDRO, mevzuat: 'Damga V.K.', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'ACILIS_FISI_YOK', ad: 'Açılış fişi yok', aciklama: 'Dönem başında (1 Ocak) açılış kaydı bulunamadı; geçen yıl kapanış mizanıyla bire bir olmalı.', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, mevzuat: 'TDHP', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'ACILIS_FISINDE_GELIR_GIDER', ad: 'Açılış fişinde 5/6/7xx', aciklama: 'Açılış fişinde gelir-gider-maliyet (5xx/6xx/7xx) hesabı olmamalı.', oneri: '', siddet: 'ERROR', alan: ALAN.DONEM_SONU, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YILLIK_KAPANIS_690_EKSIK', ad: 'Yıllık kapanış 690 eksik', aciklama: 'Yıl sonunda 6xx/7xx var ama 690 Dönem Kârı/Zararı hesabı kullanılmamış.', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, mevzuat: 'TDHP', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'VERGI_KARSILIGI_370_YOK', ad: '370 Vergi karşılığı yok', aciklama: 'Yıl sonu 690 kullanılmış ama 370/371 vergi karşılığı hesaplanmamış.', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, mevzuat: 'KVK 32', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'YILSONU_AMORTISMAN_EKSIK', ad: 'Yıl sonu amortisman eksik', aciklama: 'Sabit kıymet var ama 257/268 birikmiş amortisman + 770/760/730 amortisman gider kaydı eksik (VUK 333).', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, mevzuat: 'VUK 313/333', varsayilanAktif: true, donemKisiti: 'YILLIK', motor: 'ESKI' },
  { kod: 'AVANS_KAPANMAMIS_159', ad: '159 Verilen avans açık', aciklama: '159 Verilen Sipariş Avansları hesabında 10.000+ TL açık bakiye — mal/hizmet teslim alındıysa kapatılmalı.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'AVANS_KAPANMAMIS_340', ad: '340 Alınan avans açık', aciklama: '340 Alınan Sipariş Avansları hesabında 10.000+ TL açık bakiye.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CEK_SENET_BAKIYE_121', ad: '121 Alınan çek bakiyesi', aciklama: 'Dönem sonu 121 bakiyesi var — vadesi geçmiş çek olabilir.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CEK_SENET_BAKIYE_122', ad: '122 Alınan senet bakiyesi', aciklama: 'Dönem sonu 122 bakiyesi var — vadesi geçmiş senet olabilir.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CEK_SENET_BAKIYE_322', ad: '322 Verilen çek bakiyesi', aciklama: 'Dönem sonu 322 bakiyesi var — vadesi geçmiş çek olabilir.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'CEK_SENET_BAKIYE_323', ad: '323 Verilen senet bakiyesi', aciklama: 'Dönem sonu 323 bakiyesi var.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BANKA_EKSI_BAKIYE_102', ad: '102 Banka eksi bakiye', aciklama: 'Banka hesabı dönem hareketinde alacak (eksi) bakiye veriyor (açılış/devir hariç). Gerçekten eksiyse 300 Banka Kredileri hesabında izlenmeli.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'POS_VALOR_108_BAKIYE', ad: '108 POS valör bakiyesi', aciklama: '108 POS hesabında bakiye — valör tarihi geçip 102 banka hesabına geçmesi gereken kayıtlar olabilir.', oneri: '', siddet: 'INFO', alan: ALAN.KASA_BANKA, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KKEG_689_KONTROL', ad: '689 KKEG kontrolü', aciklama: '689 Diğer Olağandışı Gider hesabında hareket var — KKEG ise Kurumlar Vergisi matrahına eklenmeli.', oneri: '', siddet: 'INFO', alan: ALAN.GELIR_GIDER, mevzuat: 'KVK 11', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BENFORD_SAPMA', ad: 'Benford yasası sapması', aciklama: 'Tutarların ilk basamak dağılımı Benford yasasından sapıyor (MAD eşiği). Doğal olmayan/uydurulmuş tutar göstergesi olabilir — VEDAS resmî olarak kullanır.', oneri: '', siddet: 'WARN', alan: ALAN.FORENSIC, mevzuat: 'Benford · VEDAS', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'YUVARLAK_TUTAR_YIGILMASI', ad: 'Yuvarlak tutar yığılması', aciklama: '1.000 TL ve üzeri tutarların aşırı yüksek oranı tam yuvarlak (1.000/10.000 katı). Tahmini/uydurma kayıt işareti.', oneri: '', siddet: 'WARN', alan: ALAN.FORENSIC, mevzuat: 'Forensic', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'HAFTA_SONU_KAYDI', ad: 'Hafta sonu kaydı', aciklama: 'Cumartesi/Pazar tarihli fişler. Mesai dışı kayıtlar BDS 240 kapsamında denetimde gözden geçirilir.', oneri: '', siddet: 'INFO', alan: ALAN.FORENSIC, mevzuat: 'BDS 240', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'SUPHELI_ACIKLAMA', ad: 'Şüpheli açıklama', aciklama: 'Açıklamada "düzeltme, iptal, hata, sehven, geri alma" gibi riskli ifadeler. Düzeltme/iptal kayıtları denetimde önceliklidir.', oneri: '', siddet: 'INFO', alan: ALAN.FORENSIC, mevzuat: 'BDS 240', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'KASA_GUNLUK_NEGATIF_BAKIYE', ad: 'Kasa günlük negatif bakiye', aciklama: 'Kasa (100) gün sonu bakiyesi eksiye düşemez (fiziki nakit). Açılış fişi/Mizan ile kesin (ERROR), yoksa açılış hariç (WARN). Negatif = eksik tahsilat/gelir, ortaklardan ödeme (131) ya da fiş tarihi hatası.', oneri: '', siddet: 'ERROR', alan: ALAN.KASA_BANKA, mevzuat: 'TDHP · VUK', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'STOK_NEGATIF_BAKIYE', ad: 'Stok negatif bakiye', aciklama: 'Stok (150-153) gün sonu eksiye düşemez — elde olmayan mal satılamaz. Her stok hesabı ayrı yürütülür. Negatif = alış/giriş kaydı eksik/geç, maliyet/miktar hatası.', oneri: '', siddet: 'WARN', alan: ALAN.STOK, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'BANKA_GUNLUK_EKSI_BAKIYE', ad: 'Banka günlük eksi bakiye', aciklama: 'Banka (102) gün sonu eksi (alacak) bakiye veriyor (eşik 1.000 TL, her hesap ayrı). Gerçekten kredili mevduat ise 300 Banka Kredileri\'nde izlenmeli; değilse eksik tahsilat/yanlış hesap.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, mevzuat: 'TDHP', varsayilanAktif: true, motor: 'ESKI' },
  { kod: 'MIZAN_FIS_UYUMSUZ', ad: 'Mizan ↔ fiş uyumsuz', aciklama: 'Tam defterde (açılış fişi var) yevmiyeden hesaplanan kapanış bakiyesi ile Mizan bakiyesi tutmuyor — yevmiyede eksik/fazla fiş ya da Mizan güncel değil. Kısmi dönemde (açılış yok) çalışmaz.', oneri: '', siddet: 'WARN', alan: ALAN.MIZAN, mevzuat: 'VUK 219', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'SIFIR_TUTARLI_SATIR', ad: 'Sıfır tutarlı satır', aciklama: 'Hesap kodu olduğu halde borç/alacak tutarı sıfır olan satırları yakalar. Rapor formatından çok gürültü üretebildiği için varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.TEMEL, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'SATIRDA_BORC_ALACAK_BIRLIKTE', ad: 'Satırda borç/alacak birlikte', aciklama: 'Aynı satırda hem borç hem alacak tutarı varsa uyarır. Bazı aktarım formatlarında teknik satır olabildiği için varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.TEMEL, varsayilanAktif: false, motor: 'ESKI' },
  { kod: '191_TERS_CALISMA', ad: '191 ters çalışma', aciklama: '191 İndirilecek KDV hesabının alacak çalıştığı satırları yakalar; KDV tahakkuk fişleri ayrıştırılamazsa gürültü üretebilir.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 29', varsayilanAktif: false, motor: 'ESKI' },
  { kod: '391_TERS_CALISMA', ad: '391 ters çalışma', aciklama: '391 Hesaplanan KDV hesabının borç çalıştığı satırları yakalar; KDV tahakkuk fişleri ayrıştırılamazsa gürültü üretebilir.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_ODENECEK_360_UYUMSUZ', ad: 'Ödenecek KDV 360 uyumsuz', aciklama: 'Basit 191/391 netleştirme sonucuna göre 360 aktarımını kontrol eder. Tevkifat ve devreden KDV nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_DEVREDEN_190_UYUMSUZ', ad: 'Devreden KDV 190 uyumsuz', aciklama: 'Basit 191/391 netleştirme sonucuna göre 190 aktarımını kontrol eder. Önceki dönem devreden ve tevkifatları modellemediği için varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 29', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_TAHAKKUK_MUKERRER', ad: 'KDV tahakkuk mükerrer', aciklama: 'Aynı ay içinde birden fazla KDV tahakkuk fişi sinyali varsa uyarır. Düzeltme fişleri nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_TAHAKKUK_AY_SONU_DEGIL', ad: 'KDV tahakkuk ay sonu değil', aciklama: 'KDV tahakkuk fişinin ay sonu dışında kesilmesini kontrol eder. Uygulama farklılıkları nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.KDV, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_TAHAKKUK_191_TUTAR_UYUMSUZ', ad: '191 tahakkuk tutar uyumsuz', aciklama: 'Tahakkuk fişindeki 191 tutarı ile ay içi 191 hareketini karşılaştırır; iade/tevkifat/istisna ayrımı olmadığı için varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 29', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_TAHAKKUK_391_TUTAR_UYUMSUZ', ad: '391 tahakkuk tutar uyumsuz', aciklama: 'Tahakkuk fişindeki 391 tutarı ile ay içi 391 hareketini karşılaştırır; iade/tevkifat/istisna ayrımı olmadığı için varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, mevzuat: 'KDVK 41', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_ORANI_OLAGAN_DISI', ad: 'KDV oranı olağan dışı', aciklama: 'Matrah/KDV oranı olağan sınırların dışındaysa uyarır. Karma oranlı belgeler nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.KDV, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KDV_MATRAH_KARSILIK_YOK', ad: 'KDV matrah karşılık yok', aciklama: 'KDV satırı var ama aynı fişte matrah hesabı bulunamazsa uyarır. Bazı toplu/mahsup fişleri nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KDV, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'MUKERRER_EVRAK_NO', ad: 'Evrak no mükerrer', aciklama: 'Aynı evrak numarasının birden fazla fişte geçmesini kontrol eder. Belge no formatları temiz değilse gürültü üretir.', oneri: '', siddet: 'WARN', alan: ALAN.BELGE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'FATURA_KARSILIK_HESAP_EKSIK', ad: 'Fatura karşılık hesap eksik', aciklama: 'Fatura kayıtlarında cari/kasa/banka karşılık hesabı aranır. Mahsup ve toplu fişler nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.BELGE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'BELGE_TURU_DIGER_ACIKLAMA_EKSIK', ad: 'Belge türü diğer açıklama eksik', aciklama: 'Belge türü Diğer ise açıklama alanının yeterli olup olmadığını kontrol eder.', oneri: '', siddet: 'INFO', alan: ALAN.BELGE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'ANA_HESAPTA_KAYIT', ad: 'Ana hesapta kayıt', aciklama: 'Alt kırılım yerine 100/120/320 gibi ana hesapta kayıt olup olmadığını kontrol eder. Ofis hesap planı farkları nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.HESAP_PLANI, mevzuat: 'TDHP', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'YEVMIYE_NO_FORMAT_SUPHELI', ad: 'Yevmiye no format şüpheli', aciklama: 'Yevmiye numarası formatı olağan dışıysa uyarır. Luca rapor formatı değişiklikleri nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.YEVMIYE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'TEK_FISTE_BIRDEN_COK_BELGE', ad: 'Tek fişte birden çok belge', aciklama: 'Aynı fişte birden fazla belge sinyali varsa uyarır. Toplu kayıt alışkanlıkları nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.BELGE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'AYNI_FISTE_BELGE_ALANLARI_FARKLI', ad: 'Aynı fişte belge alanları farklı', aciklama: 'Aynı fişte belge tarihi/no/tür alanları tutarsızsa uyarır.', oneri: '', siddet: 'INFO', alan: ALAN.BELGE, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'GELIR_HESABI_BORC_CALISMA', ad: 'Gelir hesabı borç çalışma', aciklama: '6xx gelir hesaplarının borç çalışmasını kontrol eder. İade/düzeltme fişleri nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.GELIR_GIDER, mevzuat: 'TDHP', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'GIDER_HESABI_ALACAK_CALISMA', ad: 'Gider hesabı alacak çalışma', aciklama: '7xx gider hesaplarının alacak çalışmasını kontrol eder. İade/düzeltme fişleri nedeniyle varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.GELIR_GIDER, mevzuat: 'TDHP', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'ORTAK_CARI_KASA_KULLANIMI', ad: 'Ortak cari/kasa kullanımı', aciklama: 'Ortak hesapları ile kasa/cari kapama riskini kontrol eder.', oneri: '', siddet: 'INFO', alan: ALAN.ORTAK, mevzuat: 'KVK 13', varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'AVANS_KASA_ORTAK_CARI_KAPAMA', ad: 'Avans-kasa-ortak kapama', aciklama: 'Avans, kasa ve ortak/cari hesapların aynı fişte kapanmasını riskli işlem olarak işaretler.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'CARI_KAPAMA_KARSILIK_KONTROL', ad: 'Cari kapama karşılık kontrolü', aciklama: 'Cari hesap kapamalarında karşılık hesabının kasa/banka/avans gibi uygun hesap olup olmadığını kontrol eder.', oneri: '', siddet: 'INFO', alan: ALAN.CARI, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'BORDRO_TAHAKKUK_HESAP_KONTROL', ad: 'Bordro hesap bacakları', aciklama: 'Bordro fişinde 335/360/361 hesaplarının birlikte bulunmasını kontrol eder. Hesap planı farkları nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.BORDRO, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'UCRET_SGK_TAHAKKUK_KONTROL', ad: 'Ücret SGK tahakkuk kontrolü', aciklama: 'Ücret/bordro sinyali varken SGK tahakkuk bacaklarını kontrol eder.', oneri: '', siddet: 'WARN', alan: ALAN.BORDRO, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'AMORTISMAN_KAYDI_KONTROL', ad: 'Amortisman kayıt kontrolü', aciklama: 'Sabit kıymet hesabı varken amortisman kaydı aranır. Dönemsel farklılıklar nedeniyle varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.DONEM_SONU, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'REESKONT_SIMETRI_KONTROL', ad: 'Reeskont simetri kontrolü', aciklama: 'Reeskont gelir/gider ve karşılık hesaplarının simetrisini kontrol eder.', oneri: '', siddet: 'INFO', alan: ALAN.AVANS_CEK, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'DONEMSELLIK_GIDER_KONTROL', ad: 'Dönemsellik gider kontrolü', aciklama: 'Giderin ilgili döneme ait olup olmadığını açıklama ve tarih sinyallerinden kontrol eder.', oneri: '', siddet: 'INFO', alan: ALAN.DONEM_SONU, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'MALIYET_YANSITMA_EKSIK_KONTROL', ad: 'Maliyet yansıtma eksik', aciklama: '7/A maliyet hesaplarında dönem sonu yansıtma fişi aranır. Ara dönemlerde varsayılan pasif.', oneri: '', siddet: 'INFO', alan: ALAN.STOK, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'ACILIS_FISI_TARIH_KONTROL', ad: 'Açılış fişi tarih kontrolü', aciklama: 'Açılış fişinin dönem başı tarihiyle uyumunu kontrol eder.', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KAPANIS_FISI_TARIH_KONTROL', ad: 'Kapanış fişi tarih kontrolü', aciklama: 'Kapanış fişinin dönem sonu tarihiyle uyumunu kontrol eder.', oneri: '', siddet: 'WARN', alan: ALAN.DONEM_SONU, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'KASA_30000_TEVSIK_RISKI', ad: 'Eski kasa günlük tevsik', aciklama: 'Eski günlük toplam yaklaşımıdır; hareket bazlı yeni tevsik kontrolleri geldiği için varsayılan pasif.', oneri: '', siddet: 'WARN', alan: ALAN.KASA_BANKA, varsayilanAktif: false, motor: 'ESKI' },
  { kod: 'OZELLIKLI_549_YENILEME_FONU', ad: '549 Yenileme fonu (3 yıl)', aciklama: '549 Özel Fonlar bakiyesi var. Yenileme fonu 3 yıl içinde yeni kıymet alımında kullanılmalı; süre dolduysa dönem kârına eklenmeli.', oneri: 'Fonun oluşma yılını ve kullanım durumunu kontrol edin.', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'VUK 328', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_580_ZARAR_MAHSUP', ad: '580 Geçmiş yıl zararı (5 yıl)', aciklama: '580 Geçmiş Yıllar Zararları bakiyesi var. Mahsup, zararın doğduğu yıldan itibaren 5 yılla sınırlıdır.', oneri: 'Zararın hangi yıldan geldiğini ve mahsup süresini kontrol edin.', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'KVK 9', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_501_ODENMEMIS_SERMAYE', ad: '501 Ödenmemiş sermaye', aciklama: '501 Ödenmemiş Sermaye bakiyesi var; taahhüt edilen sermayenin bu kısmı henüz ödenmemiş.', oneri: 'Ödeme durumunu ve kanuni süreyi kontrol edin.', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'TTK 344', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_472_KIDEM_KARSILIGI', ad: '472 Kıdem karşılığı (KKEG)', aciklama: '472 Kıdem Tazminatı Karşılığı bakiyesi var; ayrılan karşılık vergi matrahından indirilemez.', oneri: 'Beyanda KKEG olarak dikkate alınıp alınmadığını kontrol edin.', siddet: 'INFO', alan: ALAN.BORDRO, mevzuat: 'KVK 8 / KKEG', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_331_ORTULU_SERMAYE', ad: '331 Örtülü sermaye', aciklama: '331 Ortaklara Borçlar bakiyesi 100.000 TL üzerinde; öz sermayenin 3 katını aşan kısım örtülü sermaye sayılır.', oneri: 'Öz sermaye ile karşılaştırıp faiz/kur farkının KKEG olup olmadığını kontrol edin.', siddet: 'INFO', alan: ALAN.ORTAK, mevzuat: 'KVK 11-12', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_340_ALINAN_AVANS_KDV', ad: '340 Alınan avans KDV', aciklama: '340 Alınan Sipariş Avansları bakiyesi var; teslim başladıysa KDV doğmuş olabilir.', oneri: 'Avansın durumunu ve KDV hesaplanıp hesaplanmadığını kontrol edin.', siddet: 'INFO', alan: ALAN.AVANS_CEK, mevzuat: 'KDVK 10', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_128_SUPHELI_ALACAK', ad: '128 Şüpheli alacak karşılığı', aciklama: '128 Şüpheli Ticari Alacaklar bakiyesi var; karşılık (129) ancak dava/icra safhasındaki alacaklar için ayrılabilir.', oneri: 'Karşılığın ayrılıp ayrılmadığını ve dava/icra şartını kontrol edin.', siddet: 'INFO', alan: ALAN.CARI, mevzuat: 'VUK 323', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_300_KREDI_FAIZ_KUR', ad: '300 Kredi faiz/kur değerleme', aciklama: '300 Banka Kredileri bakiyesi 50.000 TL üzerinde; dönem sonu işlemiş faiz ve (dövizli ise) kur değerlemesi yapılmış olmalı.', oneri: 'Faiz tahakkukunu, kur değerlemesini ve finansman gider kısıtını kontrol edin.', siddet: 'INFO', alan: ALAN.KREDI, mevzuat: 'VUK / KVK 11', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_280_DONEMSELLIK_GIDER', ad: '280 Gelecek yıllara ait gider', aciklama: '280 bakiyesi var; peşin ödenen çok dönemli giderin ait olduğu dönemlere dağıtımı kontrol edilmeli.', oneri: 'Dönemsellik ilkesine göre dağıtımı kontrol edin.', siddet: 'INFO', alan: ALAN.DONEM_SONU, mevzuat: 'VUK / dönemsellik', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_480_DONEMSELLIK_GELIR', ad: '480 Gelecek yıllara ait gelir', aciklama: '480 bakiyesi var; peşin tahsil edilen çok dönemli gelirin dağıtımı kontrol edilmeli.', oneri: 'Dönemsellik ilkesine göre dağıtımı kontrol edin.', siddet: 'INFO', alan: ALAN.DONEM_SONU, mevzuat: 'VUK / dönemsellik', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
  { kod: 'OZELLIKLI_502_ENFLASYON_DUZELTME', ad: '502 Sermaye düzeltmesi farkları', aciklama: '502 bakiyesi var; sermayeye eklenmeden çekilir/aktarılırsa vergiye tabi olur.', oneri: 'Kullanım şeklini kontrol edin.', siddet: 'INFO', alan: ALAN.OZKAYNAK, mevzuat: 'VUK mük. 298', varsayilanAktif: true, mizanGerekli: true, motor: 'ESKI' },
];

// ESKI motorun varsayilan KAPALI kurallari (gurultulu/yinelenen/nis). Tenant rule-settings ile tek tek acilabilir.
//   Servisteki DEFAULT_DISABLED_CATEGORIES bu kumeden turetilir (tek kaynak). Not: KDV_TAHAKKUK_MUKERRER,
//   KDV_ODENECEK_360_UYUMSUZ, KDV_DEVREDEN_190_UYUMSUZ, KDV_TAHAKKUK_191/391_TUTAR_UYUMSUZ, 191/391_TERS_CALISMA,
//   GELIR_HESABI_BORC_CALISMA, GIDER_HESABI_ALACAK_CALISMA, ANA_HESAPTA_KAYIT, ORTAK_CARI_KASA_KULLANIMI 2026-06'da ACIK yapildi.
export const ESKI_VARSAYILAN_KAPALI = new Set<string>([
  'SIFIR_TUTARLI_SATIR',
  'SATIRDA_BORC_ALACAK_BIRLIKTE',
  'KDV_TAHAKKUK_AY_SONU_DEGIL',
  'KDV_ORANI_OLAGAN_DISI',
  'KDV_MATRAH_KARSILIK_YOK',
  'FATURA_KARSILIK_HESAP_EKSIK',
  'BELGE_TURU_DIGER_ACIKLAMA_EKSIK',
  'YEVMIYE_NO_FORMAT_SUPHELI',
  'TEK_FISTE_BIRDEN_COK_BELGE',
  'AYNI_FISTE_BELGE_ALANLARI_FARKLI',
  'MUKERRER_EVRAK_NO',
  'KASA_30000_TEVSIK_RISKI',
  'AMORTISMAN_KAYDI_KONTROL',
  'BORDRO_TAHAKKUK_HESAP_KONTROL',
  'UCRET_SGK_TAHAKKUK_KONTROL',
  'ACILIS_FISI_TARIH_KONTROL',
  'KAPANIS_FISI_TARIH_KONTROL',
  'AVANS_KASA_ORTAK_CARI_KAPAMA',
  'CARI_KAPAMA_KARSILIK_KONTROL',
  'REESKONT_SIMETRI_KONTROL',
  'DONEMSELLIK_GIDER_KONTROL',
  'MALIYET_YANSITMA_EKSIK_KONTROL',
]);

export const KURAL_KATALOGU: KuralTanimi[] = [
  // ESKI kurallarin varsayilan durumu ekrandaki eski bayraktan degil, servisin gercek kumesinden gelir
  ...ESKI_KURALLAR.map((k) => ({ ...k, varsayilanAktif: !ESKI_VARSAYILAN_KAPALI.has(k.kod) })),
  ...HDD_KATALOG.map((k) => ({ ...k, motor: 'HDD' as const })),
];

const KATALOG_MAP = new Map(KURAL_KATALOGU.map((k) => [k.kod, k]));

export function kuralBul(kod: string): KuralTanimi | undefined {
  return KATALOG_MAP.get(kod);
}

export function alanSirasi(alan: string): number {
  const i = ALAN_SIRASI.indexOf(alan);
  return i === -1 ? 99 : i;
}

// Eski motor kurallarinin kapsam raporu icin varsayilan durumunu turetmek: yillik-kisitli / Mizan gerekli.
export function eskiKuralKisiti(kod: string): { donemKisiti?: string; mizanGerekli?: boolean } {
  const k = KATALOG_MAP.get(kod);
  if (!k || k.motor !== 'ESKI') return {};
  return { donemKisiti: k.donemKisiti, mizanGerekli: k.mizanGerekli };
}

export { ALAN };
