import type { BilgiKaynagi, MeslekiBilgi } from './mesleki-bilgi';

// Kaynaklardan özetlenmiş eğitim bilgisi; rakam, süre ve beyan yükümlülüğü sabitlenmez.
const kaynak = (baslik: string, url: string, not: string, inceleme: BilgiKaynagi['inceleme'] = 'icerik_okundu'): BilgiKaynagi => ({ baslik, url, not, inceleme });
const lucaDbs = kaynak('Luca Defter-Beyan entegrasyonu', 'https://www.luca.com.tr/Sayfa/defter-beyan-entegrasyonu/47', 'Genel kapsam ve eğitim bağlantıları okundu. Eski başlangıç tarihleri içerir; güncel mevzuat kaynağı değildir.');
const dbBeyan = kaynak('Defter-Beyan beyanname düzenleme', 'https://www.defterbeyan.gov.tr/tr/yardim/beyanname-duzenleme', 'İlgili yardım soruları okundu. Güncelleme tarihi görünmüyor; güncel ekran ve kullanılacak beyan sistemi ayrıca doğrulanmalı.');
const eBeyan = kaynak('e-Beyanname sorular ve cevaplar', 'https://intvrg.gib.gov.tr/sss_ebyn_tr.html', 'Paket, kontrol, onay ve belge aşamaları okundu; tarih görünmüyor, eski sistem anlatımı yeni sisteme aynen taşınmaz.');

export const MESLEKI_BILGI: MeslekiBilgi[] = [
  {
    id: 'luca-kayit', baslik: 'Luca: fatura, taslak fiş ve rapor kontrolü', sorumlular: ['fatura', 'luca-operator', 'denetci'],
    kapsam: 'Kaynak belgeyi muhasebe kaydına bağlama; hesap ve tutar kontrolü; raporla doğrulama.',
    onKosullar: ['Mükellef, dönem ve defter türünü portal ile Luca arasında eşleştir.', 'Belge kimlikleri ve mevcut aktarım durumunu oku; önceki aktarımı yeni iş sayma.'],
    adimlar: ['Mevcut Fatura Merkezi araçlarıyla belge/okuma/eşleşme durumunu kontrol et.', 'Kaynak belgeyle taslak fişin hesap, yön, tarih ve tutarlarını karşılaştır; belirsiz eşleştirmeyi kullanıcı kararına ayır.', 'Gerekli izinlerle yapılan aktarımın dış işlem kimliğini ve sonucunu takip et.', 'İlgili dönem raporuyla aktarılmış kayıtları karşılaştır.'],
    sonucKontrolleri: ['Belge → fiş bağlantısı, kayıt sayısı ve toplamlar uyuşmalı.', 'Kuyruğa alındı, taslak oluştu ve kaydedildi farklı sonuçlardır.', 'Muavin raporundaki dönem/hesap süzgecini doğrula.'],
    eksikler: ['Entegratör ve güncel ekran farklılıkları denenmedi.', 'Mükerrer ve yarım aktarım örnekleriyle uçtan uca doğrulama yapılmadı.'],
    kaynaklar: [
      kaynak('Luca eğitim hizmetleri', 'https://www.luca.com.tr/Sayfa/egitim/11', 'Eğitim erişim yolları okundu; kurslar tamamlanmadı.'),
      kaynak('Luca Bilgi Yuvası', 'https://lucayazilim.freshdesk.com/support/solutions', 'Dizin okundu; bütün alt belgeler okunmadı.'),
      kaynak('İşnet fatura muhasebeleştirme', 'https://lucayazilim.freshdesk.com/support/solutions/articles/67000726662-i%CC%87%C5%9Fnet-al-%C5%9F-sat-%C5%9F-faturalar-entegrasyon-ve-muhasebele%C5%9Ftirme-i%CC%87%C5%9Flemleri', '21.11.2023. Akış okundu; diğer entegratörlere doğrudan genellenmez.'),
      kaynak('Muavin defter raporu', 'https://lucayazilim.freshdesk.com/support/solutions/articles/67000656701-01-16-02-02-01-muavin-defter', '10.04.2021. Süzgeç ve rapor anlatımı okundu; eski ekran.'),
    ],
  },
  {
    id: 'luca-dbs', baslik: 'Luca: gelir/gider kayıtlarını Defter-Beyan’a aktarma', sorumlular: ['luca-operator', 'beyanname', 'koordinator'],
    kapsam: 'Gelir/gider kaydı aktarımı; beyanname hazırlama veya resmî beyanname gönderimiyle aynı işlem değildir.',
    onKosullar: ['Doğru firma/yıl, hedef ayın başlangıç ve bitişi, gelir/gider türü belirli olmalı.', 'Gönderilmiş kayıtları ve mükerrerlik durumunu kontrol et. Tamamlanmış örnek dönemi yeniden gönderme.'],
    adimlar: ['Kullanıcının örnek gösterimi: gelir/gider listesi → kayıt ayrıntısı → LUCA DBS.', 'Gelirler ve Giderler ayrı işlenir: Arama → Evrak Tarihi aralığı → Listele.', 'Filtrelenen kayıt sayısı ve seçim kapsamını doğrula; tek gün filtresini tüm ay sanma.', 'Gösterimdeki işlem yolu: kayıt seçimi → İşlemler → Defter Beyan Sistemine Gönder. Bu yolun bilinmesi yürütme yetkisi değildir.', 'Karşı sistemde kayıt ve sonuç durumunu doğrula; hata varsa başarılı kayıtları yeniden göndermeden ayır.'],
    sonucKontrolleri: ['Gelir ve gider için ayrı seçilen/başarılı/başarısız kayıt sayıları tutulmalı.', 'Luca DBS Gönderim göstergesi ve karşı kayıtlar birlikte kontrol edilmeli.', 'Sadece menü tıklaması veya boş hata ekranı başarı kanıtı değildir.'],
    eksikler: ['Güncel gönderim sonucu/hata ekranı görülmedi.', 'Tümünü seç düğmesinin sayfalama kapsamı denenmedi.', 'Kullanıcı görselleri gider örneğidir; gelir ekranı ayrıca doğrulanmalı.'],
    kaynaklar: [lucaDbs,
      kaynak('Luca gider girişi', 'https://lucayazilim.freshdesk.com/support/solutions/articles/67000660180-03-03-01-gider-giri%C5%9Fi', '14.04.2021. Belge alanları ve DBS seçenekleri okundu; eski oran örnekleri kullanılmaz.'),
      kaynak('LUCA DESTEK gelir gönderim videosu', 'https://www.youtube.com/watch?v=dc1twPcboqU', '2018 tarihli video bağlantısı bulundu; içerik izlenmedi.', 'baglanti_bulundu'),
    ],
  },
  {
    id: 'luca-bilanco', baslik: 'Luca: bilanço mükellefinde beyanname hazırlık paketi', sorumlular: ['beyanname', 'denetci', 'analist', 'luca-operator'],
    kapsam: 'Mizan/gelir tablosu kontrolleri ve beyanname hazırlığı için veri kaynaklarını ilişkilendirme.',
    onKosullar: ['Mükellef, beyanname türü/dönemi ve kayıtların tamamlanma durumu belirli olmalı.', 'Geçici vergi, yıllık beyan ve KDV aynı hesap paketi gibi ele alınmamalı.'],
    adimlar: ['İlgili dönem mizanını, kontrol raporunu ve varsa saklanmış mali tabloları oku.', 'Luca geçici vergi yardımındaki sıra: dönem bilgileri, gerekli yansıtma işlemleri, gelir tablosu kontrolü/saklama, beyannameye bilgi alma. Bu eski kılavuz bir aday yöntemdir.', 'Yansıtma gibi kayıt değiştiren adımları yalnız mevcut yetki ve doğrulanmış beceri ile uygula; aynı fişi tekrar üretme.', 'Beyanname alanlarını kaynak kayıtlarla ilişkilendir; kaynaksız elle girilecek kalemi kullanıcı kararına ayır.'],
    sonucKontrolleri: ['Dönem ve kümülatif tutar ayrımı doğru olmalı.', 'Taslak ile kaynak tablolar arasındaki farklar açıklanmalı.', 'Hazırlık, resmî kabul ve tahakkuk ayrı durumlar olmalı.'],
    eksikler: ['Bütün beyan türleri için güncel alan eşlemeleri tamamlanmadı.', 'Yıllık kurumlar/gelir ve özel durumlar için ayrı güncel kılavuz incelemesi gerekiyor.'],
    kaynaklar: [
      kaynak('Luca geçici vergi', 'https://lucayazilim.freshdesk.com/support/solutions/articles/67000568103-01-12-05-gecici-vergi', '04.04.2021. Hazırlık sırası okundu; güncel form/süre bilgisi olarak kullanılmaz.'),
      kaynak('Luca damga vergisi yeni e-Beyan bağlantısı', 'https://lucayazilim.freshdesk.com/support/solutions/articles/67000745318-damga-vergisi-beyannamesi-yeni-e-beyan-sistemine-g%C3%B6nderim', '09.06.2025. Belirli beyan türündeki taslak/durum akışı okundu; KDV’ye aynen uygulanmaz.'),
    ],
  },
  {
    id: 'dijital-vergi', baslik: 'Dijital Vergi Dairesi: hizmet seçimi ve takip', sorumlular: ['koordinator', 'mevzuat', 'musteri'],
    kapsam: 'Mükellef/sicil, borç bilgisi, dilekçe ve cevap takibi, belge doğrulama, e-Tebligat.',
    onKosullar: ['Giriş yapan kişi ile işlem yapılan mükellefi ve temsil yetkisini ayır.', 'Sorgulama, başvuru, ödeme ve bilgi değiştirme ayrı yetkiler gerektirir.'],
    adimlar: ['İstenen hizmeti belirle; Dijital Vergi Dairesi ile bağlantı verdiği diğer sistemleri karıştırma.', 'Borç/belge incelemesinde belge türü, dönem ve kayıt numarasını kaynağıyla eşleştir; sorguyu ödeme emri sayma.', 'B-TRANS rehberindeki örnek yol: Dilekçelerim → Yeni Dilekçe Oluştur; takip: Oluşturduğum Dilekçeler → Durum Sorgula; cevap: Bilgilerim → Gelen Evraklarım. Bunu tüm başvurulara aynen genelleme.', 'e-Tebligatta ilgili kurum ve belgenin içeriği/tarihlerini oku; ekran erişimi veya görüntülemenin etkilerini doğrulamadan keşif yapma.', 'Sonucu başvuru numarası, tarih ve mevcut durumla raporla.'],
    sonucKontrolleri: ['Taslak dilekçe ile alınmış başvuru numarası ayrı tutulmalı.', 'Ödeme formu açılması tahsilat değildir; tahsilat belgesi olmadan ödendi denmez.', 'Hukuki süre hesabı yalnız güncel kaynak ve gerçek belge tarihleriyle yapılır.'],
    eksikler: ['Giriş sonrası ekranlar ve mükellef bazlı yetkiler doğrulanmadı.', 'Ekipte tüm Dijital Vergi Dairesi ekranlarını yürüten genel bir beceri doğrulanmış değil.'],
    kaynaklar: [
      kaynak('Dijital Vergi Dairesi', 'https://dijital.gib.gov.tr/', 'Açık ana sayfa okundu; giriş yapılmadı.'),
      kaynak('B-TRANS başvuru rehberi', 'https://btrans.gib.gov.tr/btrans/dispatch?FILENAME=basvuru_rehberi.pdf&cmd=GETIKINOVEPFILE', 'Altı sayfalık rehber okundu; giriş yöntemi uyarıları bu başvuruya özgüdür.'),
      kaynak('Belge numarası ile ödeme', 'https://dijital.gib.gov.tr/hizliOdemeler/belgeNumarasiIleOdeme', 'Açık form görüldü; sorgu veya ödeme yapılmadı.'),
      kaynak('Mükellefiyet/borç durum yazısı doğrulama', 'https://dijital.gib.gov.tr/dogrulamalar/mukellefiyetDogrulama', 'Form alanları görüldü; belge doğrulanmadı.'),
      kaynak('Elektronik Tebligat broşürü', 'https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2FeTebligat.pdf', 'Kasım 2024; sayfa 8–9 incelendi. Güncel hukuki süre kuralı olarak saklanmadı.'),
    ],
  },
  {
    id: 'e-beyanname', baslik: 'e-Beyanname: hazırlık, kontrol, onay ve tahakkuk ayrımı', sorumlular: ['koordinator', 'beyanname', 'luca-operator'],
    kapsam: 'Eski e-Beyanname, yeni e-Beyan ve muhasebe yazılımı bağlantılarını ayırarak işlem planı kurma.',
    onKosullar: ['Mükellef, beyan türü, dönem, kullanılacak sistem ve güncel form sürümünü belirle.', 'Mevcut beyanı ve düzeltme durumunu sorgula; kayıt yok sonucunu sorgu hatasıyla karıştırma.'],
    adimlar: ['Güncel uygulama yardımını kontrol et; eski paketli yöntem ile yeni e-Beyan yöntemini aynı kabul etme.', 'Kayıtlı ve kontrol edilmiş verilerle taslak hazırlanır; zorunlu alan/ekler ve hesaplar karşılaştırılır.', 'Eski sistem kaynaklarındaki akış: hazırlama → paket → hata kontrolü → onay → beyanname/tahakkuk belgesi. Bunlar ayrı durumlardır.', 'Yeni sistemin kullanılabilirliği ve tür/dönem kapsamı güncel resmî yardım ile doğrulanır.', 'Mevcut ekip resmî gönderim yapamaz; taslak/karşılaştırma hazırlayıp yetkili kişinin sonucunu takip eder.'],
    sonucKontrolleri: ['Paket alındı beyan kabul edildi anlamına gelmez.', 'Beyanname ve tahakkuk belgelerinin mükellef, tür ve dönemini doğrula.', 'Tahakkuk tutarını taslakla karşılaştır; farkı açıklamadan işi kapatma.'],
    eksikler: ['Yeni e-Beyan KDV1 yardım içeriğine bu araştırmada okunabilir erişim alınamadı.', 'İl/tür/döneme göre güncel geçiş kapsamı ve canlı ekranlar doğrulanmadı.'],
    kaynaklar: [eBeyan,
      kaynak('e-Beyanname kullanıcı kılavuzları', 'https://ebeyanname.gib.gov.tr/kilavuzlar.html', 'Dizin okundu; bağlı bütün kılavuzlar okunmadı.'),
      kaynak('Yazılım üreticileri hazırlama kılavuzu', 'https://ebeyanname.gib.gov.tr/ebeyannameHazirlamaKilavuzu.html', 'Sürüm listesi okundu: 130.0, 01.04.2026. Dosya içeriği okunmadı; son kullanıcı ekran kılavuzu değildir.'),
      kaynak('Yeni e-Beyan KDV1 yardım bölümü', 'https://ebeyan.gib.gov.tr/beyan-doc/docs/category/kdv1-beyannamesi-mod%C3%BCl%C3%BC', 'Bağlantı bulundu; okunabilir içerik alınamadı.', 'baglanti_bulundu'),
    ],
  },
  {
    id: 'defter-beyan-kdv', baslik: 'Defter-Beyan: KDV taslağı ve kayıt karşılaştırması', sorumlular: ['beyanname', 'koordinator', 'luca-operator'],
    kapsam: 'Gelir/gider aktarımından sonra beyan türü/dönemi ve kaynak kayıtlarla taslak hazırlama sırası.',
    onKosullar: ['Gelir/gider aktarımı ve kontrolü sonuçlanmış olmalı.', 'Önceki dönem beyanı ve devreden bilgisi gerçek kayıtla doğrulanmalı.', 'KDV1 ile KDV2 kapsamı ve alanları birbirine taşınmamalı.'],
    adimlar: ['Resmî yardım: Beyannameler altında tür ve dönem seçilip Oluştur ile içerik açılır.', 'Defterden gelen bilgiler ve elle doldurulacak alanlar ayrı kontrol edilir; eksik kaynağa sıfır yazılmaz.', 'Önceki dönemden gelen tutarları, hesaplanan/indirilecek KDV ve taslak sonuçlarını kaynaklarla karşılaştır.', 'Kullanılan ekrana göre kaydetme/gönderme/onay işlemleri farklıdır; güncel düğmelerin etkisi doğrulanmalıdır.', 'Bu araştırma resmî gönderim adımlarını yürütme yetkisi vermez. Sonuç belgeleri yetkili işlem sonrası kontrol edilir.'],
    sonucKontrolleri: ['Kayıtlar, taslak ve önceki dönem tutarları arasındaki farklar açıklanmalı.', 'Yardımda B beyanname, T tahakkuk belgesini açar; güncel ekran ayrıca doğrulanmalı.', 'Defter bölümündeki Oluştur işlemi, beyanname gönderimi değildir.'],
    eksikler: ['Örnek mükellefin tamamlanmış beyanı ile alan alan karşılaştırma yapılmadı.', 'Güncel kullanıcı ekranındaki tüm seçenek ve hata durumları denenmedi.'],
    kaynaklar: [dbBeyan,
      kaynak('Defter-Beyan genel kullanım', 'https://www.defterbeyan.gov.tr/tr/yardim/sistem-genel-kullanimi', '46, 50, 55. sorular incelendi; belge görüntüleme ve defter oluşturma ayrımı.'),
      kaynak('Defter-Beyan kılavuz dizini', 'https://www.defterbeyan.gov.tr/tr/yardim/kilavuz', 'Dizin okundu; genel kılavuz 2.0, 15.06.2022. Bağlı belgelerin tamamı okunmadı.'),
    ],
  },
  {
    id: 'diger-beyannameler', baslik: 'MUHSGK, geçici ve yıllık beyannameler: öğrenme kapsamı', sorumlular: ['beyanname', 'bordro-sgk', 'analist', 'mevzuat'],
    kapsam: 'Her beyan türüne özel kaynak ve kontrol listesi hazırlama; KDV örneğini tüm beyannamelere genellememe.',
    onKosullar: ['Beyan türü/kodu, mükellef niteliği ve dönem belirli olmalı.', 'Ücret, kesinti, SGK, mali tablo ve önceki beyan verilerinin hangilerinin gerektiği güncel kılavuzdan belirlenmeli.'],
    adimlar: ['MUHSGK için 1003A ve 1003B kılavuzlarını ayır; özel kapsamdaki 1003B anlatımını diğerine aynen uygulama.', 'Vergi ve SGK kontrol sonuçlarını ayrı izle; birinin sonucu diğerinin tamamlandığını göstermez.', 'Geçici/yıllık beyanda ilgili dönemin kaynak mali tabloları ve beyan formu sürümünü eşleştir.', 'Düzeltme veya özel durumlarda standart taslağı otomatik tekrarlama; güncel kılavuz ve mesleki karar gerekir.', 'Her tür için kaynak alan → beyan alanı → kontrol → sonuç belgesi eşlemesi tamamlandıktan sonra ekran doğrulamasına geç.'],
    sonucKontrolleri: ['MUHSGK sonucunda vergi ve SGK belgeleri ayrı kontrol edilir; birden fazla belge oluşabilir.', 'Defter-Beyan yardımında görülen yıllık gelir desteğinden kurumlar beyannamesi desteği sonucu çıkarılmaz.', 'Kaynak ve dönem doğrulanmadan oran, had, süre veya yükümlülük sonucu üretilmez.'],
    eksikler: ['Bütün beyan türlerinin ayrıntılı doldurma eğitimi tamamlanmadı.', '1003A ve güncel geçici/yıllık form alanları için ek inceleme gerekli.', 'Mevcut bordro yönlendirmesindeki sabit kapalı kabulü ayrıca düzeltilmeli.'],
    kaynaklar: [
      kaynak('MUHSGK kılavuzları', 'https://ebeyanname.gib.gov.tr/mphb.html', 'Dizin okundu; 1003A belgesi ayrıca okunmadı.'),
      kaynak('MUHSGK 1003B kılavuzu', 'https://ebeyanname.gib.gov.tr/muphb2.pdf', '19.01.2020. Sayfa 32–37 kontrol/onay/tahakkuk bölümleri okundu; eski ve özel kapsamlıdır.'),
      dbBeyan, eBeyan,
    ],
  },
];
