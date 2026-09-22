# Dijital Vergi Dairesi sorgu uçları — keşif notları (2026-09-22, Chrome canlı oturum, iki Ltd. Şti. hesabı)

Oturum: giriş sonrası SPA `sessionStorage.token` (128 karakter) → `Authorization: Bearer <token>`; tüm apigateway modülleri aynı token'ı kabul ediyor.
Ortak zarf: POST gövde `{ meta: { pagination:{pageNo,pageSize}, sortFieldName, sortType, filters:[] }, data:{...} }`
Ortak yanıt: `{ dataList:[...] | null, messages: null | [{code,text,type}], pageDetail:{pageNo,pageSize,total,totalPage} | null }`

## Ana sayfa (giriş sonrası) çağrıları
- GET  apigateway/auth/tdvd/user-info
- POST apigateway/payment/api/debtinformation-homepage-summary/true  → (gövde bilinmiyor; `{}` ile 500) — ana sayfa "Vadesi geçmiş / gelmemiş / toplam borç" kartı
- GET  apigateway/api/gelen-evraklarim/okunmamis-evrak-sayisi
- GET  apigateway/api/karsit-inceleme-tutanagi/tutanak-sayisi
- GET  apigateway/etebligat/etebligat/aktivasyon-sorgula, tebligat-sayilari
- GET  apigateway/api/sicil-bilgileri/kisisel-bilgiler

## Menü rotaları (ilgili)
- /portal/pos-islem-bilgilerim   (Mali Bilgilerim → POS İşlem Bilgilerim)
- /portal/e-arsiv-faturalarim    (Bilgilerim → e-Arşiv Faturalarım)
- /portal/e-yoklamalarim         (Bilgilerim → e-Yoklamalarım)
- /portal/gelen-evraklarim, /portal/odeme-emirlerim-mal-bildirimi-dilekcesi, /portal/vergi-ceza-ihbarnamelerim, /portal/tahakkuk-bilgilerim, /portal/takdire-sevk-bilgilerim, /portal/izaha-davet-islemleri
- Ödeme ve Borç İşlemleri → "Borç Ödeme ve Detay" (rota keşfedilecek)
- e-Defter: menüde YOK → "Geçiş Yapılabilecek Uygulamalar" bakılacak

## POS (DOĞRULANDI)
- POST apigateway/mali-bilgiler/pos-islem/banka-bilgileri
  gövde: {"meta":{"pagination":{"pageNo":1,"pageSize":10},"sortFieldName":"tutar","sortType":"DESC","filters":[]},"data":{"yil":"2026","ay":"07"}}
  yanıt: {"dataList":[{"tutar":220179.0,"unvan":"VAKIFBANK ","uyeIsyeriNo":"043600000885661","vkn":"9220034970"},…],"pageDetail":{"pageNo":1,"pageSize":10,"total":2,"totalPage":1}}
- POST apigateway/mali-bilgiler/pos-islem/odeme-kurulus-bilgileri (aynı gövde) → dataList null (veri yok)

## Gelen e-Arşiv (DOĞRULANDI) — rota /portal/e-arsiv-faturalarim
- Kural: "İçinde bulunduğumuz aydan önceki 2 aya kadar", tek sorgu EN FAZLA 7 gün.
- POST apigateway/eislemler/earsiv/alici-list
  gövde: {"meta":{"pagination":{"pageNo":1,"pageSize":50},"sortFieldName":"faturaNo","sortType":"DESC","filters":[]},"data":{"duzenlenmeTarihiBas":"09/09/2026","duzenlenmeTarihiSon":"15/09/2026"}}
  yanıt 200: {"messages":null,"pageDetail":{...,"total":6},"resultListDenormalized":[{"duzenlenmeTarihi":"2026-09-09 21:58:07","faturaNo":"ARS2026000007485","gonderimSekli":"ELEKTRONIK|KAGIT","iptalItirazDurum":null,"iptalItirazTarihi":null,"mukellefTckn":"…","mukellefVkn":"2710401229","odenecekTutar":"1448.40"(string),"paraBirimi":"TRY","tcknVkn":"…","tesisatNumarasi":" ","toplamTutar":1420.0,"unvan":"MURAT DAYAN","vergilerTutari":28.4}]}
  yanıt 409 + messages[{type:"INFO",text:"e-Arşiv Faturanız bulunmamaktadır."}] → kayıt yok (hata değil)
- sayfa yüklenince: POST apigateway/eislemler/earsiv/mucbir-sebep → {"yetki":false}

## Yoklama / Denetim (DOĞRULANDI, bu mükellefte boş) — rota /portal/e-yoklamalarim
- POST apigateway/api/yoklamalar/get-yoklama-list  gövde {"meta":{"pagination":{"pageNo":1,"pageSize":10},"sortFieldName":"vdKoduText","sortType":"ASC","filters":[]}} → {"yoklamaList":[],"pageDetail":{...}}
  sütunlar: Vergi Dairesi · Yoklama Kodu · Yoklama Türü · Yoklama Tarihi · Sonuç
- POST apigateway/api/denetimler/get-denetim-list  gövde {"meta":{...,"sortFieldName":"bkodu","sortType":"ASC","filters":[]}} → {"denetimlerResponseDto":[],"pageDetail":{...}}
  sütunlar: Denetim Belge Kodu · Denetim Adı · Denetim Türü · Denetim Tarihi · Sonuç
- Ana sayfada ayrıca GET apigateway/api/karsit-inceleme-tutanagi/tutanak-sayisi (karşıt inceleme)

## Vergi borcu (DOĞRULANDI) — rota /portal/odeme-borc-islemleri ("Borç Ödeme ve Detay")
- POST apigateway/payment/api/debtinformation/true  gövde {"meta":{"pagination":{"pageNo":1,"pageSize":100},"sortFieldName":"vdAdi","sortType":"ASC","filters":[]}}
  yanıt anahtarları: borclar, config, hesaplamaZamani, messages, ozelPlakaList, ozetBilgi, pageDetail, seciliBorclar, tcKimlikNo, tumBorclar, vergiNo
  borclar[]: {asilBorc:47168.65, belgeNo, donem:"2026/01-2026/01", gecikmeZammi, odemePlani:[{gz,indirim,odemeSekilleri,taksit,toplam,vab,vade:"20260228"}], plaka, secim, toplam:58920.63, vadeTarihi:"2026-02-28", vdAdi:"BÜYÜKÇEKMECE", vdKodu:"034204", vergiKodu:"0015", vergiTuru:"0015 GERÇEK USULDE KATMA DEĞER VERGİSİ"}
  ozetBilgi[]: {tip:"1"|"2"|"3", tipAciklama:"Vadesi Geçmiş"|"Vadesi Geçmemiş"|"Toplam", toplam:"379614.21", toplamGzSum, toplamVabSum, vergiKoduDetay:[{vergiKodu,toplam,gzSum,vabSum}]}
  (pageSize 100 ile 14 borç tek sayfada geldi; ana sayfadaki 3 kart = ozetBilgi)
- Ana sayfa özeti: POST apigateway/payment/api/debtinformation-homepage-summary/true (gövde yakalanamadı; ozetBilgi zaten yukarıdan geliyor)

## Ödeme emirleri (ek bulgu) — rota /portal/odeme-emirlerim-mal-bildirimi-dilekcesi
- POST apigateway/api/mal-bildirim/ana-takip-listele gövde {"meta":{...,"sortFieldName":"tebligTarihi","sortType":"DESC"}} → {"takipListesi":[{anaTakipDosyaNo:"2026031766Ayg0000570", orgoId, secureId, tebligSekli:13, tebligSekliAciklama:"E-Tebligat", tebligTarihi:"28/03/2026", toplam:47168.65, vdAdi, vdKodu}]}
  (icra takibi = ödeme emri; e-haciz'e giden yol)

## Gelen evraklar (ek) — /portal/gelen-evraklarim
- POST apigateway/api/gelen-evraklarim/list gövde data {"basTarih":"20260622","bitTarih":"20260922"} → {"gelenEvrakDTOList":null}

## e-Haciz: DVD menüsünde YOK ("haciz"/"e-haciz" arama → sonuç yok). Borç sayfasında da haciz alanı yok.

## e-Defter (DOĞRULANDI) — DVD → Geçiş Yapılabilecek Uygulamalar → e-Defter (SSO)
- Onay penceresi: "aktif e-Defter oturumlarınız sonlandırılacaktır" → ONAYLA
- GET apigateway/auth/tdvd/edefter-login (DVD Bearer) → {"redirectUrl":"https://edefter.gib.gov.tr/global/loginInteraktif?state=<TOKEN>"}
- window.open(redirectUrl) → yeni sekme → sonuç adresi https://edefter.gib.gov.tr/default/home?esut=<JWT>
  JWT: Keycloak (authebelge.gib.gov.tr/realms/ebelge), aud edefter-backend, exp ~45 dk; SPA localStorage.token = {"data":"<JWT>"}
- Paket listesi (rota /default/list-package): GET https://edefter.gib.gov.tr/api/v1/edefter/paket/EDEFTER_PAKET_LISTESI_GETIR?donem=202605&page=0&size=1000&sort=
  başlık Authorization: Bearer <JWT>  (çerezle "Failed to fetch"; JSON zarf ile 403)
  yanıt: {"status":"1","message":"İşlem Başarılı. ","numberOfElements":3,"result":[{"oid":"2fmu1043a91w8w","paketId":"3241199696-202605-KB-000000","islemOid":"2fmu1043a91w8x","belgeTuru":"KB","alinmaZamani":"20260914144227","durumKodu":0,"durumAciklama":"Paket başarı ile işlendi.","dfsPath":"…zip","gibDfsPath":"GIB-…zip"}, {belgeTuru:"YB" Yevmiye Beratı}, {belgeTuru:"Y" Yevmiye Defteri, dfsPath:" "}]}
  belgeTuru: KB=Büyük Defter (Kebir) Beratı, YB=Yevmiye Beratı, Y=Yevmiye Defteri, (K=Kebir Defteri). Verildi = KB + YB durumKodu 0.
  Ekranda: Paket adı · İşlem Numarası (islemOid) · Belge Türü · Yükleme Zamanı (alinmaZamani) · Durumu (Başarılı) · İndir
  "Defter / Envanter" seçimi var (envanter ayrı liste); "Saklama Listesi" (/default/old-list-package) eski dönemler.

## Yoklama / Denetim — GERÇEK VERİ (SEDA İŞ GÜVENLİĞİ, VKN 7580596665, Ltd. Şti.)
- POST apigateway/api/yoklamalar/get-yoklama-list (pageSize 100) → {"yoklamaList":[{"secureId":"<64hex>","tarih":"26.09.2025 - 12:32:16","vdKoduText":"AVCILAR (034294)","vdkodu":"034294","ykodu":"20250925Y0342946395DE7727638A","yoklamaTuruText":"Nakil İşe Başlama","yturu":"11"}, … yturu 16 = "Elektronik Ortamda Tüzel Kişilik Açılış Yoklaması"], "pageDetail":{total:4}}
- DETAY: POST apigateway/api/yoklamalar/get-yoklama-pdf  gövde {"data":{"yoklamaKodu":"<ykodu>","secureId":"<secureId>"}} → {"reportLink":"https://dijital.gib.gov.tr/apigateway/api/report/download?uuid=…"}
  GET reportLink (Bearer) → DÜZ PDF (%PDF-1.4, ~289 KB; e-Tebligat'taki gibi PKCS#7 zarf DEĞİL). Ekranda ayrıca "E-POSTA" düğmesi çıkıyor.
- Denetim listesi bu mükellefte de boş (alan adları görülemedi; denetimlerResponseDto[]).

## e-HACİZ (DOĞRULANDI) — DVD'de DEĞİL, eski İnternet Vergi Dairesi'nde (intvrg.gib.gov.tr), DVD'den tek tıkla geçiş
- DVD: GET apigateway/auth/tdvd/intvrg-login (Bearer) → {"redirectUrl":"https://intvrg.gib.gov.tr/intvrg_side/main.jsp?token=<128hex>&appName=tdvd"}  (onay penceresi: "aktif İnternet Vergi Dairesi oturumlarınız sonlandırılacaktır")
- main.jsp açılır (JSP, tek sayfa; menü: Mükellef İşlemleri → E-Haciz Bildirileri Sorgulama → Araçlara / Banka Hesaplarına Uygulanan Elektronik Hacizler)
- Veri: POST https://intvrg.gib.gov.tr/intvrg_server/dispatch  (application/x-www-form-urlencoded)
    cmd=ehacizSorgulamaService_EhacizSorgulamaSonuc  callid=<rasgele>  jp={"secim":"1"}  token=<URL'deki token>      → secim 1 = BANKA, 2 = ARAÇ
    yanıt: {"data":[{"durum":"HACİZ TATBİK EDİLMİŞTİR"|"HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR","hbno":"2026070162L3t0024422","htutar":"16887.67","vdkod":"034294"}],"metadata":{"optime":"20260922023101"}}
    (ön SIDE.GET_EAGER_BF_DEFS çağrısı GEREKMİYOR; yalnız token yeter — doğrulandı)
  Detay: cmd=ehacizSorgulamaService_EhacizSorgulamaSonucDetay jp={"vdkod":"034294","hbno":"…","secim":"1"} → {"data":{"array1":[{"vergiTuru":"0015-KDV GERCEK","vergiDonem":"112025112025","hbbildirino":"…"}],"array2":[ banka/şube/hesap/haczedilen tutar/tebliğ tarihi — boş geldi ]}}
  Ekran sütunları: Vergi Dairesi Adı · Haciz Bildirisi No · Haciz Bildirisi Tutarı (TL) · Haciz Durumu · Detay. Araç hacizleri: "ADINIZA DÜZENLENMİŞ HACİZ BİLDİRİSİ BİLGİSİ BULUNMAMAKTADIR."
- İkinci mükellefte (SEDA) 3 banka e-haciz bildirisi var (113.505,77 · 43.509,54 · 16.887,67).

## Ödeme emirleri (SEDA'da da var: 7 ödeme emri, e-Tebligat ile) — ana-takip-listele (yukarıda)
