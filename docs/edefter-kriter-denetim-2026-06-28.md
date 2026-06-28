# e-Defter Kontrol Kriter Denetimi - 2026-06-28

## Yapilan iyilestirmeler

- Kasa/tevsik kontrolu hareket bazina alindi. Acilis fisi ve banka/POS bacagi olan fisler tevsik bulgusu uretmez.
- Tevsik icin ek aktif kontroller eklendi: tek kasa hareketi, ayni gun ayni taraf parcalama, ayni belge/taraf kismi odeme.
- Tum teknik kontrol kategorileri Kriterler sekmesinde gorunur hale getirildi. Varsayilan kapali olan kurallar artik kullanici tarafindan aktif edilebilir.
- Kural aktif/pasif ayari tenant bazinda veritabaninda saklanir ve yeni analiz/yeniden analiz sonucunu etkiler.
- Damga vergisi bulgusu kesin hata diliyle degil, asgari ucret istisnasi ve ayri fis ihtimalini belirten bilgi diliyle yazilir.
- Rapor/PDF tarafinda bos kalan mevzuat referanslari tamamlandi.

## Resmi kaynak notlari

- GIB tevsik duyurusunda 575 Sira No.lu Teblig ile sinirin 30.000 TL'ye cikarildigi, 30.000 TL'yi asan tahsilat/odemelerin araci finansal kurumlarla tevsik edilmesi gerektigi belirtilir: https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2Ftevsik_2024.pdf
- Damga Vergisi Kanunu metni icin GIB mevzuat sayfasi: https://www.gib.gov.tr/mevzuat/kanun/438
- GIB ozelgelerinde ucretlerde asgari ucrete isabet eden kismin damga vergisinden istisna edilebilecegi yonunde aciklama vardir: https://gib.gov.tr/mevzuat/kanun/433/ozelge/21501

## Eksik veya gelistirilebilir kriterler

- Bordro/damga kontrolu, asgari ucret istisnasini daha kesin hesaplamak icin donem asgari ucret brut/net tablosu ve calisan sayisi ile desteklenmeli.
- KDV tahakkuk kontrolleri, KDV beyannamesi veya KDV kontrol modulundeki devreden/tevkifat/istisna bilgisiyle entegre edilirse varsayilan pasif KDV uyumsuzluk kurallari daha guvenilir aktif hale getirilebilir.
- e-Fatura/e-Arsiv entegrasyonu ile muhasebe fisindeki belge no, VKN/TCKN, tarih ve tutar capraz kontrolu eklenmeli.
- Kasa icin sadece 100 hareketi degil; ortak/cari hesap uzerinden nakit kapama, avans kapama ve ayni taraf parcali tahsilat daha guclu sekilde iliskilendirilmeli.
- Mizanla birlikte calisan gunluk kasa/banka negatif bakiye ve 108 POS valor yaslanma kontrolleri eklenebilir.
- Stok/maliyet tarafinda 153/150/151 hareketleri ile 621/711/731/751 yansitma kontrolleri sektor ve donem tipine gore netlestirilmeli.
- Dovizli islemler icin kur farki, kambiyo kari/zarari ve dovizli cari hesap kapanis kontrolu eklenebilir.
- Teknik e-defter tarafinda berat olusturma/onay tarihleri, yevmiye numarasi sirasi ve defter berat durumu Luca/GIB kaynaklariyla capraz kontrol edilebilir.
