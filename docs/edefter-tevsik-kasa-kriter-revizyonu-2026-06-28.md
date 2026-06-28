# E-Defter Tevsik / Kasa Kriter Revizyonu

Tarih: 2026-06-28

## Mevzuat ozeti

Kaynak: GIB, "Belirli Tutarin (30 Bin) Uzerindeki Tahsilat ve Odemelerde Tevsik Zorunlulugu", Aralik 2024.

- 575 Sira No.lu Teblig ile tevsik zorunlulugu siniri 30.000 TL'ye cikarildi.
- Kapsamdaki kisilerin 30.000 TL'yi asan tahsilat ve odemelerini banka, odeme/elektronik para kurulusu veya PTT gibi araci finansal kurumlar kanaliyla yapmasi ve bu kurum belgeleriyle tevsik etmesi gerekiyor.
- Ayni gunde ayni kisi/kurumla yapilan islemlerde, her bir islem limitin altinda kalsa bile gunluk ayni taraf toplami 30.000 TL'yi asarsa asilan islemden itibaren tevsik zorunlulugu doguyor.
- Kisim kisim yapilan tahsilat/odemelerde toplam islem tutari 30.000 TL'yi asiyorsa, her bir tahsilat/odeme araci finansal kurum uzerinden yapilmali.

Kaynak URL: https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fonceki-dokumanlar%2Ftevsik_2024.pdf

## Uygulanan kural degisikligi

Eski yanlis alarm:
- `KASA_GUNLUK_30000_TEVSIK_RISKI` gun icindeki tum `100 Kasa` satirlarini topluyordu.
- Bu nedenle acilis fisi gibi gercek tahsilat/odeme olmayan 100 Kasa borc bakiyesi "gunluk toplam limit asimi" gibi gorunuyordu.

Yeni mantik:
- `KASA_HAREKET_30000_TEVSIK_RISKI`: tek `100 Kasa` hareketi 30.000 TL'yi asarsa uyarir.
- `KASA_TEVSIK_PARCALAMA`: ayni gun ayni VKN/TCKN icin birden fazla kasa hareketi birlikte 30.000 TL'yi asarsa uyarir.
- `KASA_TEVSIK_BOLUNMUS_ISLEM`: ayni VKN/TCKN ve ayni belge no icin farkli gunlerde bolunmus kasa hareketleri toplamda 30.000 TL'yi asarsa uyarir.
- Acilis, devir, virman/aktarma, kapanis, KDV tahakkuk ve maliyet yansitma mahiyetindeki fisler tevsik kasa havuzuna alinmaz.
- Ayni fis icinde `102`, `103` veya `108` banka/POS/finansal bacak varsa kasa tevsik uyarisi uretilmez.

## Sonraki ek kriter adaylari

- Yuksek tutarli kasa hareketinde VKN/TCKN yoksa "taraf bilgisi eksik" bilgi bulgusu.
- Aciklamasi `muhtelif`, `nakit`, `belgesiz`, `diger` olan yuksek kasa hareketleri.
- Personel net ucret/avans/prim/huzur hakki 30.000 TL'yi asip banka hesabi yoksa bordro-tevsik kontrolu.
- Kira odemelerinde kasa kullanimi ve stopaj hesabi birlikte kontrolu.
- Ortaklar cari, avans ve kasa birlikte calisan fislerde finansman/ortak cari kullanimi kontrolu.
- Fatura/evrak no ardisik, tarih yakin ve ayni tarafli 30.000 TL altina bolunmus kasa hareketleri.
- Banka dekontu aciklamasinda belge no veya taraf bilgisi yoksa tevsik belgesi kalite kontrolu.
