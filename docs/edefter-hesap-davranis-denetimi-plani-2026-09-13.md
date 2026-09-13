# e-Defter Kontrol — Hesap Davranış Denetimi (Nitelikli Kontrol) PLANI — 2026-09-13

**İstek (Muzaffer Bey):** Denetim unsurları daha detaylı olsun; **her hesaba bakılsın**. Örnek: 120/320'de yalnız faturalar işlenmiş, tahsilat/ödeme işlenmemiş; 360 vergi, 361 SGK borçları… Sadece "ters bakiye" değil, **nitelikli** kontrol.

## 1. Mevcut durum (kod + canlı veri kanıtı)

Modül bugün ~85 kuralla çalışıyor (`apps/api/src/edefter-control/edefter-control.service.ts`, 3.385 satır, kilitli değil). Hesap bazında yaptığı tek şey: **120/320 ters bakiye**, 102 eksi bakiye, kasa/stok/banka günlük negatif, avans/çek-senet bakiyesi, özellikli hesap kataloğu (11 bilgi). **Hesabın hareket davranışına** (tek yönlü çalışma, tahakkuk→ödeme döngüsü, hareketsiz bakiye, ay atlama) bakan kural **yok**.

Canlı veriden (2026-Q2, salt-okunur inceleme, 12 Eylül oturumları):

| Mükellef | 120 | 320 | 335 | 360 | 361 | 100/102 |
|---|---|---|---|---|---|---|
| YORGUN NAKLİYAT (6.594 satır) | 66 alt hesap, **20,4M borç / 13,6K alacak** (tahsilat yok) | 85 alt hesap, **0 borç** (ödeme yok) | yalnız tahakkuk | yalnız tahakkuk | yalnız tahakkuk (+ teşvik borcu) | **defterde hiç yok**; her şey 331 ortak carisinden |
| WASH CLEAN (1.568) | 110 alt hesap, **0 alacak** | 11 alt hesap, **0 borç** | yalnız tahakkuk | yalnız tahakkuk | yalnız tahakkuk | yok |
| ZEYREK LOJİSTİK (737) | 36 alt hesap, 1,5M borç / 19,8K alacak | 21 alt hesap | yalnız tahakkuk | yalnız tahakkuk | yalnız tahakkuk | yok |

Yani istenen kusur canlıda **yaygın** ve bugünkü kurallar bunu **hiç görmüyor** (YORGUN'da 15 bulgu çıkmış; hiçbiri bu konuda değil).

Veri gerçekleri (tasarımı belirler):
- Luca Detay Fiş Listesi'nde **VKN, belge türü, fiş tipi kolonu yok** (rawData: borç, alacak, açıklama, hesap adı, hesap kodu). Cari eşleşmesi ancak **hesap adıyla** yapılabilir.
- Mizan eşlik ediyor (kümülatif, yıl başı→dönem sonu; alt hesap kodları birebir aynı: `120.01.A001`). Açılış = Mizan kapanış − dönem net (mevcut `deriveAcilisFromMizan`).
- 361 bordro fişi içinde **borç** satırı var (SGK teşviki, ör. 9.909 TL) → "ödeme" sayılmamalı. Ödeme = karşı hesabı kasa/banka/ortak olan borç.
- Bazı 360 kira stopajı satırları **tarihsiz** → aylık döngüye giremez; sayılıp not edilir.

## 2. Mimari: ayrı, saf bir "Hesap Davranış" motoru

Yeni dosya **`apps/api/src/edefter-control/hesap-davranis-denetimi.ts`** (saf fonksiyonlar, Prisma yok, ayrı jest dosyası). `analyze()` içine tek satır çağrı. Mevcut kurallara **dokunulmaz** (üretim güvenliği), yalnız `CARI_TERS_BAKIYE_120/320` Mizan varsa "kesin" bakiyeyle çalışacak şekilde küçük iyileştirme.

Motor önce **her yaprak hesap** için tek geçişte istatistik çıkarır:
- borç/alacak toplam + adet, **ay bazlı seri**, açılış (Mizan'dan, biliniyorsa), kapanış, Mizan kapanışı
- her hareketin **karşı hesap sınıfı** (aynı fişteki diğer hesaplar) → "tahsilat/ödeme mi, düzeltme/teşvik mi" ayrımı
- normalize hesap adı (LTD/ŞTİ/A.Ş./SAN/TİC ekleri atılır) → 120↔320 aynı taraf eşleşmesi

Sonra kural grupları bu istatistik üzerinde çalışır. Her kural ayrı kod → **Kontrol Kuralları** ekranından tek tek kapatılabilir.

## 3. Kural listesi (öneri)

Eşikler ilk sürüm için; hepsi tek yerde sabit, sonradan ayarlanır. "Üst sınır" = aynı kuraldan en fazla kaç bireysel bulgu (en büyük tutarlar), kalanı tek özet satırı.

### A. Cari hesap davranışı (120 / 320 — her alt hesap)

| Kod | Koşul | Şiddet | Mizan | Üst sınır |
|---|---|---|---|---|
| `CARI_120_TAHSILAT_YOK` | Dönemde ≥2 fatura **veya** ≥20.000 TL borç; tahsilat (kasa/banka/çek/ortak karşılıklı alacak) = 0; dönem ≥2 ay | WARN | isteğe bağlı (varsa "yıl başından beri sürekli artıyor, kapanış X TL" notu) | 15 |
| `CARI_320_ODEME_YOK` | Aynası: alış faturaları var, ödeme = 0 | WARN | isteğe bağlı | 15 |
| `CARI_120_TAHSILAT_ORANI_DUSUK` | Tahsilat var ama fatura toplamının < %25'i; ≥3 fatura, ≥50.000 TL | INFO | – | 10 |
| `CARI_320_ODEME_ORANI_DUSUK` | Aynası | INFO | – | 10 |
| `CARI_HAREKETSIZ_BAKIYE` | Mizan bakiyesi ≥10.000 TL, dönemde **hiç hareket yok** (≥3 aydır dokunulmamış alacak/borç → şüpheli alacak / unutulmuş borç) | INFO | **şart** | 15 |
| `CARI_AYNI_TARAF_120_320` | Aynı cari adı hem 120 hem 320'de hareketli → mahsup/netleştirme kontrolü | INFO | – | 10 |
| `DEFTER_TAHSILAT_ODEME_ISLENMEMIS` | **Defter geneli özet:** 120 alt hesaplarının ≥%80'i tek yönlü **ve** 100/102 hareketi yok/çok az → "kasa-banka hiç işlenmemiş" | ERROR | – | 1 |
| `CARI_TERS_BAKIYE_120/320` (mevcut) | Mizan varsa gerçek kapanış bakiyesiyle **kesin** uyarı; "açılış hariç" ibaresi kalkar | WARN | isteğe bağlı | mevcut |

Gürültü kuralı: `DEFTER_TAHSILAT_ODEME_ISLENMEMIS` çıktığında A1/A2 bireysel bulguları **en büyük 10** ile sınırlanır (66 tane aynı uyarı basılmaz).

### B. Vergi / SGK / personel borç döngüsü (335 / 360 / 361 — alt hesap × ay)

Mantık: Ay M'de **tahakkuk** (alacak) varsa, M veya M+1'de **ödeme** (kasa/banka/ortak karşılıklı borç) olmalı. Dönemin **son ayının** tahakkuku kontrol dışı (ödemesi sonraki dönem). Tarihsiz satırlar döngüye girmez, notta sayılır.

| Kod | Koşul | Şiddet | Mizan |
|---|---|---|---|
| `VERGI_360_ODEME_YOK` | 360.x tahakkuku var, M/M+1'de ödeme yok | WARN, **2+ ay üst üste → ERROR** | – |
| `SGK_361_ODEME_YOK` | 361.x tahakkuku var, ödeme yok (+ not: 5510/88 — fiilen ödenmeyen SGK primi gider yazılamaz, KKEG) | WARN, 2+ ay → ERROR | – |
| `PERSONEL_335_ODEME_YOK` | Net ücret tahakkuku var, M/M+1'de ödeme yok | WARN | – |
| `VERGI_SGK_ODEME_TUTAR_UYUMSUZ` | Ödeme var ama tahakkuktan farklı (>%2 ve >50 TL): kısmi ödeme / gecikme zammı / mahsup / teşvik | INFO | – |
| `VERGI_SGK_TERS_BAKIYE` | 335/360/361 alt hesabı **borç bakiyeye** düşüyor (ödeme > tahakkuk → ödeme yanlış hesaba ya da tahakkuk eksik). Mizan yoksa ilk ayın ödemeleri "önceki dönem tahakkuku" sayılır (yalnız kesin durumda uyarır) | WARN | isteğe bağlı |
| `PERSONEL_335_ODEME_KASADAN` | 335 ödemesi 100 Kasa ile → 5+ çalışanda banka zorunluluğu hatırlatması | INFO | – |

### C. Hazır değer davranışı (100 / 102 / 108)

| Kod | Koşul | Şiddet | Mizan |
|---|---|---|---|
| `BANKA_HAREKETI_YOK` | Mizan'da 102 bakiyesi var (ya da ≥3 satış fişi var) ama dönemde **hiç 102 hareketi yok** → banka ekstresi işlenmemiş | WARN | tercihen |
| `BANKA_TEK_YONLU` | 102 alt hesabı ≥3 hareket ama yalnız tek yön → ekstre kısmi işlenmiş | INFO | – |
| `KASA_HAREKETI_YOK` | Satış var, dönemde hiç 100 hareketi yok (tamamen banka çalışan firma olabilir → bilgi) | INFO | – |
| `KASA_BAKIYE_YUKSEK` | 100 Mizan kapanışı ≥250.000 TL → fiili sayım / adat / örtülü kazanç riski | INFO | **şart** |
| `POS_108_TEK_YONLU` | 108 yalnız borç çalışmış (POS tahsilatı bankaya aktarılmamış) — mevcut `POS_VALOR_108_BAKIYE` genişletilir | INFO | – |

### D. Stok / maliyet / gider döngüsü

| Kod | Koşul | Şiddet |
|---|---|---|
| `SMM_621_YOK` | 600/601 satış var, dönemde 621/622 yok ve 153 hiç alacak çalışmamış | Yıllık **WARN**, geçici INFO |
| `SABIT_GIDER_AY_ATLAMIS` | Kira / elektrik / su / doğalgaz / telefon-internet / muhasebe ücreti / aidat gibi düzenli gider diğer aylarda var, **bir ayda yok** → o ayın faturası işlenmemiş olabilir | INFO |
| `AYLIK_HAREKET_KESINTISI` | 600 satış / 7xx gider / 191 / 391 sınıfında bir ayda hareket 0 iken diğer aylarda var → o ayın fişleri işlenmemiş | INFO |
| `KREDI_FAIZ_GIDERI_YOK` | 300/400 bakiyesi veya hareketi var; dönemde 780/660/661 faiz kaydı yok | WARN |
| `GELECEK_AY_180_AKTARIM_YOK` | 180 bakiyesi var, dönemde 180'den gidere aylık aktarım (alacak) yok | INFO |

### E. Duran varlık işlemleri (fiş bazlı)

| Kod | Koşul | Şiddet |
|---|---|---|
| `SABIT_KIYMET_SATISI_EKSIK_BACAK` | 25x alacak (çıkış) var; aynı fişte 257 borç **veya** 391 **veya** kâr/zarar hesabı (649/659/679/689) yok | WARN |
| `BINEK_OTO_KDV_INDIRIM` | 254 borç + 191 borç aynı fişte; metinde "binek" → **WARN** (KDVK 30/b indirilemez), değilse INFO (nakliyecide kamyon normal) | WARN/INFO |
| `DEMIRBAS_DOGRUDAN_GIDER` | 7xx borç + demirbaş metni (bilgisayar, telefon, klima, masa, makine, yazıcı…) + tutar ≥ VUK 313 sınırı → aktifleştirilmeli. **2026 sınır tutarı uygulamadan önce teyit edilecek** | INFO |

### F. Gelir / KDV tutarlılığı (fiş bazlı)

| Kod | Koşul | Şiddet |
|---|---|---|
| `SATIS_KDV_YOK` | 600 alacak ≥1.000 TL ama fişte 391 yok; istisna/ihracat/tevkifat metni yok | WARN |
| `IADE_610_KDV_DUZELTME_YOK` | 610 borç var, aynı fişte 391 borç yok | INFO |

### G. Her hesabın tabiatı

| Kod | Koşul | Şiddet | Mizan |
|---|---|---|---|
| `HESAP_TABIATINA_AYKIRI_BAKIYE` | **Her yaprak hesap** için TDHP doğal yön tablosu (aktif/gider → borç; pasif/özkaynak/gelir → alacak; kontra istisnaları: 103, 119, 122, 129, 257, 268, 299, 322, 501, 580, 591, 610-612, 7x1 yansıtma…) → kapanış bakiyesi tabiatına ters. 120/320/102 hariç (kendi kuralları var) | WARN | tercihen (yoksa yalnız dönem netiyle, "açılış hariç") |

Toplam: **~30 yeni kural + 2 mevcut kural iyileştirmesi.** Hepsi varsayılan **AÇIK** (üst sınır + defter geneli özetle gürültü kontrol altında); `PERSONEL_335_ODEME_KASADAN` ve `AYLIK_HAREKET_KESINTISI` varsayılan **KAPALI** (küçük firmalarda gürültü).

## 4. İkinci beyin / öz eleştiri

1. **Yıl içinde yalnız fatura işleyen ofis alışkanlığı** yaygın → A ve B grubu bu defterlerde çok bulgu üretir. Bu bir hata değil, istenen şey; ama **66 ayrı aynı uyarı** değersiz → defter geneli özet + üst sınır şart.
2. **3 aylık pencerede uç etkisi:** ilk ayın ödemesi önceki dönemin tahakkuku, son ayın tahakkukunun ödemesi sonraki dönem. Kurallar yalnız penceresi dönem içinde kalan tahakkukları kontrol eder; ters bakiye için Mizan açılışı kullanılır.
3. **Alt hesap kırılımı ofise göre değişir** (tek 360 vs 360.01.00x). Motor yaprak hesapla çalışır; düz hesapta aylık tahakkuk/ödeme toplamı toleransla karşılaştırılır.
4. **Teşvik/düzeltme borçları** ödeme sanılmamalı → karşı hesap sınıflandırması (kasa/banka/ortak = ödeme; 7xx/335 = düzeltme).
5. **Mizan yoksa** kurallar ya "açılış hariç" notuyla düşer ya da çalışmaz (her kuralda belirtildi). Mizan artık çekimle birlikte otomatik geliyor.
6. **Mizan modülünün `ZIT_BAKIYE`si ile kısmi örtüşme** (G grubu): Mizan yan paneldedir, e-Defter bulgu listesinde görünmez; "her hesaba bak" isteği için ana listede olması gerekir. Kapatılabilir.
7. **Aylık (AYLIK) dönemde** A/B grubu tek ay verisiyle anlamsız → dönem <2 ay ise bu kurallar çalışmaz.
8. Servis dosyası 3.4K satır; yeni motor **ayrı dosyada**, mevcut ~85 kural refaktör edilmez (regresyon riski sıfıra yakın).
9. Eski oturumlar yeni kuralları görmek için **"Yeniden Analiz"** ister (mevcut davranış; işaretli bulgu varsa işaretler silinir — canlı doğrulamada işaretsiz oturum seçilecek).

## 5. Test ve canlı doğrulama

- Jest: yeni spec dosyası — sentetik defterler gerçek desenlere göre (YORGUN benzeri "yalnız fatura", normal döngülü defter, teşvik borçlu bordro, tarihsiz stopaj, Mizan var/yok). Mevcut 25 test yeşil kalmalı; `tsc` temiz.
- Canlı: deploy sonrası YORGUN / WASH CLEAN / ZEYREK 2026-Q2 oturumlarında **Yeniden Analiz** → beklenen bulgular (tahsilat yok, ödeme yok, 360/361/335 ödeme yok, banka hareketi yok, defter geneli özet) ve **normal döngülü bir mükellefte gürültü olmaması** kontrol edilir. Ekran görüntüsüyle kanıt.
- Kurallar ekranı: yeni kodlar katalogda (grup: "Hesap Davranışı", "Vergi/SGK Ödeme Döngüsü", "Hazır Değer", …) ve etiket sözlüğünde.

## 6. Dosyalar

- **Yeni:** `apps/api/src/edefter-control/hesap-davranis-denetimi.ts` + `.spec.ts`
- **Değişen:** `edefter-control.service.ts` (analyze içine çağrı; CARI_TERS_BAKIYE Mizan iyileştirmesi; DEFAULT_DISABLED'a 2 kod), `apps/web/.../e-defter/page.tsx` (katalog + etiketler), `bilgi/PROJE-BILGI.md`, bu doküman.

## 7. Onay gereken noktalar

1. Kural listesi ve şiddetler (bölüm 3) uygun mu? Çıkarılacak / eklenecek var mı?
2. Eşikler: fatura ≥20.000 TL, oran <%25, hareketsiz ≥10.000 TL, kasa ≥250.000 TL — böyle başlayalım mı?
3. Varsayılan açık/kapalı önerisi (2 kural kapalı) uygun mu?
4. Canlı doğrulama için 3 mükellefin Q2 oturumunda "Yeniden Analiz" çalıştırılacak (işaretli bulgu yok, teyit edilecek).

---

## 8. UYGULAMA (2026-09-13 — tamamlandı)

Muzaffer Bey kapsamı genişletti: *"bütün hareketleri ve mizanı kapsamlı değerlendirsin; e-Defter kontrolünü tamamen buraya yaptırayım, gerçek bir mali müşavirin tek tek kontrolü gibi"* + *"bulgu ekranı derli toplu, anlaşılır olsun"*.

### Yapı
- `apps/api/src/edefter-control/hesap-davranis/` — **Hesap Davranış Denetimi motoru** (saf fonksiyonlar, Prisma yok)
  - `tipler.ts` · `esikler.ts` (tüm eşikler + VUK 313 yıl tablosu: 2024 6.900 / 2025 9.900 / 2026 12.000) · `istatistik.ts` (bağlam: yaprak hesap istatistikleri, karşı-hesap sınıflandırması FATURA/TAHAKKUK/ODEME/TAHSILAT/IADE/MAHSUP/DUZELTME, Mizan'dan açılış) · `katalog.ts` (52 yeni kural tanımı) · `index.ts` (motor + kapsam + hesap kartları)
  - `kurallar/`: `cari.ts` (9) · `vergi-sgk-personel.ts` (10, olay bazlı tahakkuk→ödeme eşleştirme: önce bir önceki ayın tahakkuku, sonra aynı ay, sonra birebir tutar, en son FIFO) · `hazir-deger.ts` (8) · `stok-gider-maliyet.ts` (10) · `duran-varlik-ozkaynak.ts` (8) · `gelir-kdv-fis.ts` (5) · `hesap-tabiati.ts` (2)
- `apps/api/src/edefter-control/kural-katalogu.ts` — **TEK kural kataloğu** (98 eski + 52 yeni = 150). Eski motorun varsayılan-kapalı kümesi buraya taşındı (`ESKI_VARSAYILAN_KAPALI`); servis `DEFAULT_DISABLED_CATEGORIES`'i buradan türetir. `GET /edefter-control/rule-settings` artık `catalog` döner; ekran katalogu buradan okur.
- Servis: `analyzeFull()` = bulgular + **kontrolOzeti** (her kuralın durumu TEMIZ/BULGU/UYGULANMAZ/VERI_YOK/PASIF + her yaprak hesabın dönem kartı); `analyze()` geriye uyumlu. `CARI_TERS_BAKIYE_120/320` Mizan varsa kesin bakiyeyle çalışır. Oturum listesi/detayı artık ham Excel baytlarını taşımıyor (yanıt MB'larca küçüldü).
- Prisma: `EDefterControlSession.kontrolOzeti Json?` (migration `20260913_edefter_kontrol_ozeti`, yalnız kolon ekler).
- Ekran (`page.tsx` + `_components/`): `tema.ts` (tek renk kaynağı), `katalog.ts`, `KapsamPaneli.tsx` (denetim kapsamı şeridi + açılır kontrol listesi), `BulgularSekmesi.tsx` (alan → kural → tek satırlık bulgular; şiddet/durum filtre hapları; "ne demek / ne yapmalı" açıklaması; "sorun bulunmayan alanlar" şeridi), `HesaplarSekmesi.tsx` (yeni sekme: her hesabın açılış/borç/alacak/kapanış/bulgu tablosu). Kontrol Kuralları sekmesi sunucu kataloğunu (150) gösterir.

### Doğrulama
- jest: `apps/api` e-Defter paketleri (motor + servis + kapsam uçtan uca) yeşil; tsc api + web temiz.
- Canlı: aşağıdaki oturum günlüğünde.
