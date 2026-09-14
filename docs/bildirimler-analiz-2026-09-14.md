# Bildirimler Modülü — İnceleme ve Sadeleştirme Önerisi (2026-09-14)

Kaynak: canlı veritabanı (salt okunur), son 90 gün · 4.903 bildirim (30 gün: 2.197 → günde ~73; 7 gün: 563).
Toplam 6.015 kayıt, 1.134'ü okunmamış. Gece 02:00–03:00 arasında 1.191 bildirim üretilmiş (ajan kapalıyken).

## 1. Ne geliyor? (30 günlük hacim, okunma oranı, örnek)

| Tip | 30 gün | Okundu | Ne | Karar |
|---|---:|---:|---|---|
| LUCA_SYNC_ERROR | 1.231 | %50 | 1.577× "Luca işi bekliyor (30+ dk)" + 119 gerçek aktarım hatası | Bekliyor: gündüz günde 1, gece hiç, kuyruk boşalınca kendiliğinden kapanır. Gerçek hata KALIR. |
| PORTAL_CREDENTIAL_FAIL | 247 | %99 | Aynı 3 mükellef ayda ~90'ar kez (Erdoğan Balçık SGK, Ramazan Çorbacı SGK, Sabri Yaşın GİB) | KALIR ama şifre güncellenene kadar 1 kez (7 gün); güncellenince kendiliğinden kapanır. |
| AUTOMATION | 181 | %98 | Aynı 2 otomasyonun 3 saatte bir tekrar eden başarısızlığı + "Fiş Raporu Hazır" | Başarısızlık: otomasyon başına günde 1. "Fiş Raporu Hazır" KALIR. |
| MIHSAP_RESULT | 104 | %99 | "✅ Mihsap aktarım tamam" başarı mesajları | Başarı KALKAR (ekranda zaten görünüyor); hata/oturum bekleniyor KALIR. |
| BUTCE_KRITIK | 85 | %94 | "Kart limiti dolmak üzere" 60× (günde 2) | Durum değişene kadar 1 kez. |
| KDV_RESULT | 73 | %100 | Her KDV kontrol koşusunun özeti | Yalnız otomatik (ekip/gece) koşularda ve sorun varsa. Elle koşturulanı kullanıcı zaten ekranda görüyor. |
| AI | 70 | %49 | 180× "Bot QA testlerinde hata var" (129 okunmamış) | Günde 1 ve yalnız YENİ hata çıkınca. Haftalık kalite raporu KALIR. |
| WHATSAPP | 67 | %76 | 60× "Sabah/Akşam brifingi üretilemedi" (her gün!) · 15× kayıtsız numara | Kayıtsız numara/müşavir yanıtı KALIR. Brifing arızası → günde 1 sistem uyarısı; asıl iş: brifing 90 gündür bozuk, düzeltilmeli. |
| E_TEBLIGAT | 52 | %99 | Yeni e-Tebligat | KALIR (kritik). |
| INVOICE_OVERDUE | 30 | %98 | Her sabah "N alış faturası 60+ gündür muhasebeleşmedi" | Haftada 1 (Pazartesi) ya da sayı artınca. |
| SYSTEM | 18 | %48 | 48× LUCA_JOB_FAILURE (Luca hatasının KOPYASI), FAILED_RATIO, AGENT_PING | LUCA_JOB_FAILURE kopyası KALKAR; diğerleri KALIR. |
| MOREN_AI_ALERT | 17 | %100 | "MOREN AI uyarısı: KDV kontrol" = KDV_RESULT'ın kopyası; "Belge içerik denetimi" | KDV kopyası KALKAR (tek bildirimde birleşir); belge denetimi KALIR. |
| BUTCE / GALERI_HGS_OZET / CAPTCHA / AUTH_NEW_DEVICE / TASK_DUE / TAX_DEADLINE / OFFICE_CHAT | 0–9 | — | Az ve gerekli | KALIR. Not: TAX_DEADLINE son 30 günde hiç üretilmemiş (tümü zamanında onaylandıysa normal; kontrol edilecek). |

## 2. Gelmesi GEREKENLER (aksiyon ister / zaman hassas)
e-Tebligat · beyanname son gün · portal şifre hatası (1 kez) · captcha bakiyesi · gerçek Luca aktarım hatası · onay bekleyen karar ·
WhatsApp'ta müşavir yanıtı bekleyen / kayıtsız numara · görev hatırlatması · banka ekstresi geldi · mükellef evrak yükledi ·
yeni cihaz girişi · AI maliyet tavanı · otomasyon başarısız/duraklatıldı (günde 1) · Mihsap aktarım HATASI · sistem arızaları.

## 3. Gelmesine GEREK OLMAYANLAR (gürültü)
Başarı mesajları (Mihsap tamam, KDV sonucu elle koşuda) · aynı durumun tekrarı (şifre hatası ×90, kart limiti ×60, Luca bekliyor ×1.577) ·
kopyalar (LUCA_JOB_FAILURE, MOREN AI KDV uyarısı) · gece ajan kapalıyken üretilen "bekliyor" · Bot QA günlük test gürültüsü.

## 4. Kök nedenler (kod)
1. **Tekrar-önleme yalnız OKUNMAMIŞ bildirime bakıyor** (`notifications.service.ts` create → `isRead:false`). Kullanıcı okuyunca aynı olay yeniden bildirim üretiyor → şifre hatası, Luca bekliyor, yeni cihaz tekrarlarının ana kaynağı.
2. Durum bildirimleri (bekliyor / şifre hatası / kart limiti) **durum düzelince kapanmıyor**; elle okunmayı bekliyor.
3. Aynı olay için iki üretici (Luca hatası + sistem uyarısı; KDV sonucu + MOREN AI uyarısı).
4. Başarı bildirimleri (Mihsap tamam, KDV sonucu) bilgi değeri düşük, sayı yüksek.
5. Gece penceresi yok: ajan kapalıyken saatlik "bekliyor" bildirimi (2026-09-12'de günde 1'e indirildi; gece hâlâ üretiliyor).

## 5. Önerilen uygulama
**Politika (API):**
- Tekrar-önleme okunmuş bildirimleri de saysın (pencere içinde aynı `dedupeKey` → üretme).
- Kendiliğinden kapanma: Luca kuyruğu boşalınca "bekliyor" bildirimleri okundu; portal şifresi güncellenince o kapsamın şifre-hatası bildirimleri okundu; kart limiti/bütçe durumu düzelince okundu.
- Luca "bekliyor": 09:00–22:00 arası günde 1, gece hiç.
- Portal şifre hatası: aynı kapsam için 7 günde 1.
- Otomasyon başarısızlığı: otomasyon başına günde 1 (duraklatma ayrı, 1 kez).
- Mihsap: yalnız hata/oturum bekleniyor. KDV: yalnız otomatik koşu + sorun varsa; MOREN AI KDV kopyası kaldırılır.
- Sistem uyarısı LUCA_JOB_FAILURE kopyası kaldırılır.
- Bot QA: günde 1, yalnız yeni hata; brifing arızası günde 1 sistem uyarısı (ayrı iş: brifingi düzelt).
- Vadesi geçen fatura özeti: Pazartesi 1 ya da sayı artınca.
- Bütçe kritik: durum değişene kadar 1.
- Tek seferlik temizlik: eski 875 "Luca bekliyor" + 129 "Bot QA" + 48 LUCA_JOB_FAILURE okunmamışı toplu okundu (onayla).

**Tasarım (web):**
- Sade başlık: "Bildirimler · 35 okunmamış · 3 kritik" + sağda "Tümünü okundu" ve "Tercihler". Dört sayaç kutusu kalkar.
- Tek satır hap sekmeler: Tümü / Okunmamış / Kritik; tür süzgeci Türkçe adlarla açılır liste (ham kod yok).
- Liste güne göre gruplu (Bugün / Dün / Bu hafta / Daha eski). Satır: renkli nokta + başlık (okunmamış kalın) + tek satır açıklama + sağda saat. Tıkla → ilgili ekran + okundu. Büyük "Okundu/Aç" düğmeleri kalkar (hover'da küçük tik).
- Aynı bildirimin tekrarları tek satırda "×12" rozetiyle katlanır.
- Kritikler ince kırmızı şerit; geri kalanı sakin. Koyu tema + hafif parıltı (portal dili), sarı serpme yok.
- Tercihler: tür adı + "Sustur" anahtarı, sade liste.

## 6. UYGULANDI (2026-09-14, Muzaffer Bey onayı "Hepsini uygula")
- API (a2f244f): tekrar-önleme okunmuşu da sayar; `notification-policy.ts` merkezi kural (NotificationsService.create + Prisma ara katmanı → kilitli
  kdv-control'ün doğrudan yazdığı kopyalar dahil); kendiliğinden kapanma (`resolveByDedupePrefix` / `resolveByMetadata`): Luca kuyruğu boşalınca,
  portal şifresi kaydedilince; Luca "bekliyor" gece üretilmez; şifre hatası 7 gün (+şifre sürümü); otomasyon/Bot QA/brifing günde 1; vadesi geçen
  fatura sayı değişmedikçe haftada 1; bütçe kritik 3 gün; sistem uyarı başlıkları Türkçe. 15 birim testi.
- Web (a52e146, 8a776f6): yeni sade ekran (`bildirimler/page.tsx` + `_components/katalog.ts`).
- Tek seferlik temizlik (canlı DB): 1.046 okunmamış gürültü kaydı okundu işaretlendi (873 "Luca işi bekliyor", 112 Bot QA, 31 LUCA_JOB_FAILURE
  kopyası, 30 brifing arızası) → okunmamış 1.146 → 100.
- AÇIK: (1) Günlük brifing 30+ gündür her gün "standart formatta üretilemedi" — MOREN AI çıktısı `brifingFormatindaMi` süzgecinden geçmiyor; ayrı iş.
  (2) "Portal şifre hatası" metinlerinin bir kısmı aslında "CAPTCHA çözülemedi veya şifre reddedildi" — sınıflandırma belirsiz; güvenlik kodu
  arızası ayrı tipe düşmeli. (3) Beyanname son gün bildirimi son 30 günde hiç üretilmedi; tümü zamanında onaylandıysa normal, ilk son-gün penceresinde izlenecek.
