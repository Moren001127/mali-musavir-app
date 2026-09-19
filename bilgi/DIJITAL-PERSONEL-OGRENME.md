# Dijital personel — mesleki öğrenme kütüphanesi

19 Eylül 2026. İlk kaynak araştırması ve yerel yazılım bağlantısı. Canlıya alınmadı.

## Hazırlanan altyapı

11 aktif personel, ekip_bilgi_oku aracıyla konu listesini ve seçilen konunun kaynaklı çalışma notunu okuyabilir. Bu araç veri tabanına yazmaz, tarayıcı kullanmaz, ödeme veya gönderim yapmaz. Güncel internet araştırmasını kendiliğinden yapmaz; 19 Eylül araştırmasının kayıtlı özetlerini verir.

Bilgi durumları ayrıdır: kaynak içeriği okundu / yalnız bağlantı bulundu; ekran doğrulandı / canlı işlem doğrulandı. Bu ilk sürümde hiçbir konu ekran veya canlı işlem bakımından doğrulanmış sayılmaz. Personel araştırma notunu çalışan beceri gibi sunmamalıdır.

## Konular

### Luca: fatura, taslak fiş ve rapor kontrolü

Kaynak belgeyi muhasebe kaydına bağlama; hesap ve tutar kontrolü; raporla doğrulama.

Öğrenme sırası:

1. Mevcut Fatura Merkezi araçlarıyla belge/okuma/eşleşme durumunu kontrol et.
2. Kaynak belgeyle taslak fişin hesap, yön, tarih ve tutarlarını karşılaştır; belirsiz eşleştirmeyi kullanıcı kararına ayır.
3. Gerekli izinlerle yapılan aktarımın dış işlem kimliğini ve sonucunu takip et.
4. İlgili dönem raporuyla aktarılmış kayıtları karşılaştır.

Sonuç kontrolü:

- Belge → fiş bağlantısı, kayıt sayısı ve toplamlar uyuşmalı.
- Kuyruğa alındı, taslak oluştu ve kaydedildi farklı sonuçlardır.
- Muavin raporundaki dönem/hesap süzgecini doğrula.

Henüz tamamlanmayan:

- Entegratör ve güncel ekran farklılıkları denenmedi.
- Mükerrer ve yarım aktarım örnekleriyle uçtan uca doğrulama yapılmadı.

### Luca: gelir/gider kayıtlarını Defter-Beyan’a aktarma

Gelir/gider kaydı aktarımı; beyanname hazırlama veya resmî beyanname gönderimiyle aynı işlem değildir.

Öğrenme sırası:

1. Kullanıcının örnek gösterimi: gelir/gider listesi → kayıt ayrıntısı → LUCA DBS.
2. Gelirler ve Giderler ayrı işlenir: Arama → Evrak Tarihi aralığı → Listele.
3. Filtrelenen kayıt sayısı ve seçim kapsamını doğrula; tek gün filtresini tüm ay sanma.
4. Gösterimdeki işlem yolu: kayıt seçimi → İşlemler → Defter Beyan Sistemine Gönder. Bu yolun bilinmesi yürütme yetkisi değildir.
5. Karşı sistemde kayıt ve sonuç durumunu doğrula; hata varsa başarılı kayıtları yeniden göndermeden ayır.

Sonuç kontrolü:

- Gelir ve gider için ayrı seçilen/başarılı/başarısız kayıt sayıları tutulmalı.
- Luca DBS Gönderim göstergesi ve karşı kayıtlar birlikte kontrol edilmeli.
- Sadece menü tıklaması veya boş hata ekranı başarı kanıtı değildir.

Henüz tamamlanmayan:

- Güncel gönderim sonucu/hata ekranı görülmedi.
- Tümünü seç düğmesinin sayfalama kapsamı denenmedi.
- Kullanıcı görselleri gider örneğidir; gelir ekranı ayrıca doğrulanmalı.

### Luca: bilanço mükellefinde beyanname hazırlık paketi

Mizan/gelir tablosu kontrolleri ve beyanname hazırlığı için veri kaynaklarını ilişkilendirme.

Öğrenme sırası:

1. İlgili dönem mizanını, kontrol raporunu ve varsa saklanmış mali tabloları oku.
2. Luca geçici vergi yardımındaki sıra: dönem bilgileri, gerekli yansıtma işlemleri, gelir tablosu kontrolü/saklama, beyannameye bilgi alma. Bu eski kılavuz bir aday yöntemdir.
3. Yansıtma gibi kayıt değiştiren adımları yalnız mevcut yetki ve doğrulanmış beceri ile uygula; aynı fişi tekrar üretme.
4. Beyanname alanlarını kaynak kayıtlarla ilişkilendir; kaynaksız elle girilecek kalemi kullanıcı kararına ayır.

Sonuç kontrolü:

- Dönem ve kümülatif tutar ayrımı doğru olmalı.
- Taslak ile kaynak tablolar arasındaki farklar açıklanmalı.
- Hazırlık, resmî kabul ve tahakkuk ayrı durumlar olmalı.

Henüz tamamlanmayan:

- Bütün beyan türleri için güncel alan eşlemeleri tamamlanmadı.
- Yıllık kurumlar/gelir ve özel durumlar için ayrı güncel kılavuz incelemesi gerekiyor.

### Dijital Vergi Dairesi: hizmet seçimi ve takip

Mükellef/sicil, borç bilgisi, dilekçe ve cevap takibi, belge doğrulama, e-Tebligat.

Öğrenme sırası:

1. İstenen hizmeti belirle; Dijital Vergi Dairesi ile bağlantı verdiği diğer sistemleri karıştırma.
2. Borç/belge incelemesinde belge türü, dönem ve kayıt numarasını kaynağıyla eşleştir; sorguyu ödeme emri sayma.
3. B-TRANS rehberindeki örnek yol: Dilekçelerim → Yeni Dilekçe Oluştur; takip: Oluşturduğum Dilekçeler → Durum Sorgula; cevap: Bilgilerim → Gelen Evraklarım. Bunu tüm başvurulara aynen genelleme.
4. e-Tebligatta ilgili kurum ve belgenin içeriği/tarihlerini oku; ekran erişimi veya görüntülemenin etkilerini doğrulamadan keşif yapma.
5. Sonucu başvuru numarası, tarih ve mevcut durumla raporla.

Sonuç kontrolü:

- Taslak dilekçe ile alınmış başvuru numarası ayrı tutulmalı.
- Ödeme formu açılması tahsilat değildir; tahsilat belgesi olmadan ödendi denmez.
- Hukuki süre hesabı yalnız güncel kaynak ve gerçek belge tarihleriyle yapılır.

Henüz tamamlanmayan:

- Giriş sonrası ekranlar ve mükellef bazlı yetkiler doğrulanmadı.
- Ekipte tüm Dijital Vergi Dairesi ekranlarını yürüten genel bir beceri doğrulanmış değil.

### e-Beyanname: hazırlık, kontrol, onay ve tahakkuk ayrımı

Eski e-Beyanname, yeni e-Beyan ve muhasebe yazılımı bağlantılarını ayırarak işlem planı kurma.

Öğrenme sırası:

1. Güncel uygulama yardımını kontrol et; eski paketli yöntem ile yeni e-Beyan yöntemini aynı kabul etme.
2. Kayıtlı ve kontrol edilmiş verilerle taslak hazırlanır; zorunlu alan/ekler ve hesaplar karşılaştırılır.
3. Eski sistem kaynaklarındaki akış: hazırlama → paket → hata kontrolü → onay → beyanname/tahakkuk belgesi. Bunlar ayrı durumlardır.
4. Yeni sistemin kullanılabilirliği ve tür/dönem kapsamı güncel resmî yardım ile doğrulanır.
5. Mevcut ekip resmî gönderim yapamaz; taslak/karşılaştırma hazırlayıp yetkili kişinin sonucunu takip eder.

Sonuç kontrolü:

- Paket alındı beyan kabul edildi anlamına gelmez.
- Beyanname ve tahakkuk belgelerinin mükellef, tür ve dönemini doğrula.
- Tahakkuk tutarını taslakla karşılaştır; farkı açıklamadan işi kapatma.

Henüz tamamlanmayan:

- Yeni e-Beyan KDV1 yardım içeriğine bu araştırmada okunabilir erişim alınamadı.
- İl/tür/döneme göre güncel geçiş kapsamı ve canlı ekranlar doğrulanmadı.

### Defter-Beyan: KDV taslağı ve kayıt karşılaştırması

Gelir/gider aktarımından sonra beyan türü/dönemi ve kaynak kayıtlarla taslak hazırlama sırası.

Öğrenme sırası:

1. Resmî yardım: Beyannameler altında tür ve dönem seçilip Oluştur ile içerik açılır.
2. Defterden gelen bilgiler ve elle doldurulacak alanlar ayrı kontrol edilir; eksik kaynağa sıfır yazılmaz.
3. Önceki dönemden gelen tutarları, hesaplanan/indirilecek KDV ve taslak sonuçlarını kaynaklarla karşılaştır.
4. Kullanılan ekrana göre kaydetme/gönderme/onay işlemleri farklıdır; güncel düğmelerin etkisi doğrulanmalıdır.
5. Bu araştırma resmî gönderim adımlarını yürütme yetkisi vermez. Sonuç belgeleri yetkili işlem sonrası kontrol edilir.

Sonuç kontrolü:

- Kayıtlar, taslak ve önceki dönem tutarları arasındaki farklar açıklanmalı.
- Yardımda B beyanname, T tahakkuk belgesini açar; güncel ekran ayrıca doğrulanmalı.
- Defter bölümündeki Oluştur işlemi, beyanname gönderimi değildir.

Henüz tamamlanmayan:

- Örnek mükellefin tamamlanmış beyanı ile alan alan karşılaştırma yapılmadı.
- Güncel kullanıcı ekranındaki tüm seçenek ve hata durumları denenmedi.

### MUHSGK, geçici ve yıllık beyannameler: öğrenme kapsamı

Her beyan türüne özel kaynak ve kontrol listesi hazırlama; KDV örneğini tüm beyannamelere genellememe.

Öğrenme sırası:

1. MUHSGK için 1003A ve 1003B kılavuzlarını ayır; özel kapsamdaki 1003B anlatımını diğerine aynen uygulama.
2. Vergi ve SGK kontrol sonuçlarını ayrı izle; birinin sonucu diğerinin tamamlandığını göstermez.
3. Geçici/yıllık beyanda ilgili dönemin kaynak mali tabloları ve beyan formu sürümünü eşleştir.
4. Düzeltme veya özel durumlarda standart taslağı otomatik tekrarlama; güncel kılavuz ve mesleki karar gerekir.
5. Her tür için kaynak alan → beyan alanı → kontrol → sonuç belgesi eşlemesi tamamlandıktan sonra ekran doğrulamasına geç.

Sonuç kontrolü:

- MUHSGK sonucunda vergi ve SGK belgeleri ayrı kontrol edilir; birden fazla belge oluşabilir.
- Defter-Beyan yardımında görülen yıllık gelir desteğinden kurumlar beyannamesi desteği sonucu çıkarılmaz.
- Kaynak ve dönem doğrulanmadan oran, had, süre veya yükümlülük sonucu üretilmez.

Henüz tamamlanmayan:

- Bütün beyan türlerinin ayrıntılı doldurma eğitimi tamamlanmadı.
- 1003A ve güncel geçici/yıllık form alanları için ek inceleme gerekli.
- Mevcut bordro yönlendirmesindeki sabit kapalı kabulü ayrıca düzeltilmeli.

## Resmî kaynaklar ve inceleme sınırları

- [Luca eğitim hizmetleri](https://www.luca.com.tr/Sayfa/egitim/11) — Belirtilen içerik/bölüm okundu. Eğitim erişim yolları okundu; kurslar tamamlanmadı.
- [Luca Bilgi Yuvası](https://lucayazilim.freshdesk.com/support/solutions) — Belirtilen içerik/bölüm okundu. Dizin okundu; bütün alt belgeler okunmadı.
- [İşnet fatura muhasebeleştirme](https://lucayazilim.freshdesk.com/support/solutions/articles/67000726662-i%CC%87%C5%9Fnet-al-%C5%9F-sat-%C5%9F-faturalar-entegrasyon-ve-muhasebele%C5%9Ftirme-i%CC%87%C5%9Flemleri) — Belirtilen içerik/bölüm okundu. 21.11.2023. Akış okundu; diğer entegratörlere doğrudan genellenmez.
- [Muavin defter raporu](https://lucayazilim.freshdesk.com/support/solutions/articles/67000656701-01-16-02-02-01-muavin-defter) — Belirtilen içerik/bölüm okundu. 10.04.2021. Süzgeç ve rapor anlatımı okundu; eski ekran.
- [Luca Defter-Beyan entegrasyonu](https://www.luca.com.tr/Sayfa/defter-beyan-entegrasyonu/47) — Belirtilen içerik/bölüm okundu. Genel kapsam ve eğitim bağlantıları okundu. Eski başlangıç tarihleri içerir; güncel mevzuat kaynağı değildir.
- [Luca gider girişi](https://lucayazilim.freshdesk.com/support/solutions/articles/67000660180-03-03-01-gider-giri%C5%9Fi) — Belirtilen içerik/bölüm okundu. 14.04.2021. Belge alanları ve DBS seçenekleri okundu; eski oran örnekleri kullanılmaz.
- [LUCA DESTEK gelir gönderim videosu](https://www.youtube.com/watch?v=dc1twPcboqU) — Yalnız bağlantı bulundu. 2018 tarihli video bağlantısı bulundu; içerik izlenmedi.
- [Luca geçici vergi](https://lucayazilim.freshdesk.com/support/solutions/articles/67000568103-01-12-05-gecici-vergi) — Belirtilen içerik/bölüm okundu. 04.04.2021. Hazırlık sırası okundu; güncel form/süre bilgisi olarak kullanılmaz.
- [Luca damga vergisi yeni e-Beyan bağlantısı](https://lucayazilim.freshdesk.com/support/solutions/articles/67000745318-damga-vergisi-beyannamesi-yeni-e-beyan-sistemine-g%C3%B6nderim) — Belirtilen içerik/bölüm okundu. 09.06.2025. Belirli beyan türündeki taslak/durum akışı okundu; KDV’ye aynen uygulanmaz.
- [Dijital Vergi Dairesi](https://dijital.gib.gov.tr/) — Belirtilen içerik/bölüm okundu. Açık ana sayfa okundu; giriş yapılmadı.
- [B-TRANS başvuru rehberi](https://btrans.gib.gov.tr/btrans/dispatch?FILENAME=basvuru_rehberi.pdf&cmd=GETIKINOVEPFILE) — Belirtilen içerik/bölüm okundu. Altı sayfalık rehber okundu; giriş yöntemi uyarıları bu başvuruya özgüdür.
- [Belge numarası ile ödeme](https://dijital.gib.gov.tr/hizliOdemeler/belgeNumarasiIleOdeme) — Belirtilen içerik/bölüm okundu. Açık form görüldü; sorgu veya ödeme yapılmadı.
- [Mükellefiyet/borç durum yazısı doğrulama](https://dijital.gib.gov.tr/dogrulamalar/mukellefiyetDogrulama) — Belirtilen içerik/bölüm okundu. Form alanları görüldü; belge doğrulanmadı.
- [Elektronik Tebligat broşürü](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2FeTebligat.pdf) — Belirtilen içerik/bölüm okundu. Kasım 2024; sayfa 8–9 incelendi. Güncel hukuki süre kuralı olarak saklanmadı.
- [e-Beyanname sorular ve cevaplar](https://intvrg.gib.gov.tr/sss_ebyn_tr.html) — Belirtilen içerik/bölüm okundu. Paket, kontrol, onay ve belge aşamaları okundu; tarih görünmüyor, eski sistem anlatımı yeni sisteme aynen taşınmaz.
- [e-Beyanname kullanıcı kılavuzları](https://ebeyanname.gib.gov.tr/kilavuzlar.html) — Belirtilen içerik/bölüm okundu. Dizin okundu; bağlı bütün kılavuzlar okunmadı.
- [Yazılım üreticileri hazırlama kılavuzu](https://ebeyanname.gib.gov.tr/ebeyannameHazirlamaKilavuzu.html) — Belirtilen içerik/bölüm okundu. Sürüm listesi okundu: 130.0, 01.04.2026. Dosya içeriği okunmadı; son kullanıcı ekran kılavuzu değildir.
- [Yeni e-Beyan KDV1 yardım bölümü](https://ebeyan.gib.gov.tr/beyan-doc/docs/category/kdv1-beyannamesi-mod%C3%BCl%C3%BC) — Yalnız bağlantı bulundu. Bağlantı bulundu; okunabilir içerik alınamadı.
- [Defter-Beyan beyanname düzenleme](https://www.defterbeyan.gov.tr/tr/yardim/beyanname-duzenleme) — Belirtilen içerik/bölüm okundu. İlgili yardım soruları okundu. Güncelleme tarihi görünmüyor; güncel ekran ve kullanılacak beyan sistemi ayrıca doğrulanmalı.
- [Defter-Beyan genel kullanım](https://www.defterbeyan.gov.tr/tr/yardim/sistem-genel-kullanimi) — Belirtilen içerik/bölüm okundu. 46, 50, 55. sorular incelendi; belge görüntüleme ve defter oluşturma ayrımı.
- [Defter-Beyan kılavuz dizini](https://www.defterbeyan.gov.tr/tr/yardim/kilavuz) — Belirtilen içerik/bölüm okundu. Dizin okundu; genel kılavuz 2.0, 15.06.2022. Bağlı belgelerin tamamı okunmadı.
- [MUHSGK kılavuzları](https://ebeyanname.gib.gov.tr/mphb.html) — Belirtilen içerik/bölüm okundu. Dizin okundu; 1003A belgesi ayrıca okunmadı.
- [MUHSGK 1003B kılavuzu](https://ebeyanname.gib.gov.tr/muphb2.pdf) — Belirtilen içerik/bölüm okundu. 19.01.2020. Sayfa 32–37 kontrol/onay/tahakkuk bölümleri okundu; eski ve özel kapsamlıdır.

## Sonraki doğrulama

İlk örnek: kullanıcının belirlediği tamamlanmış işletme dönemi. Önce portal/Luca firma kimliği eşleştirilecek; gelir-gider listesi ve DBS tarih/seçim kapsamı kayıt değiştirmeden incelenecek. Gönderim sonucu ve hata ekranları öğrenilip karşı kayıt kontrolü tanımlanacak. Sonra bir bilanço örneğiyle beyanname alan eşlemesi hazırlanacak.

Genel bilgi okuması, bütün beyannamelerin mesleki kararlarını veya ekran kullanımını öğrenmiş olmak değildir. Ekran becerileri örnekler ve istisnalarla doğrulandıkça ayrıca kaydedilecek. Resmî gönderim için mevcut kod engelleri değiştirilmedi.
