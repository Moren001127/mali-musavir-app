# Veri Güvenliği / Uygulama Gizliliği — Form Cevapları (2026-09-13)

Google Play **"Veri güvenliği"** (Data safety) ve Apple **"App Privacy"** formlarını doldururken kopyalanacak cevaplar.
Hepsi **koddan doğrulandı** (apps/mobile: `app/index.tsx`, `lib/api.ts`, `lib/auth.tsx`, `lib/secure-storage.ts`, `lib/ek/push-kanca.ts`, `app.json`).

> Kural: Mağazalar "toplanan veri" derken **telefondan sunucuya giden** veriyi sorar. Mükellefin mali verileri
> sunucudan telefona **görüntülenmek için** iner; telefondan gönderilmez. Yine de temkinli olmak için aşağıda
> "mali bilgi" de işaretli önerildi (eksik beyan ceza sebebi, fazla beyan değil).

## 1. Uygulama ne topluyor? (kod kanıtıyla)

| Veri | Nereden | Nereye gider | Cihazda saklanır mı |
|---|---|---|---|
| E-posta + şifre (giriş) | Giriş formu | Ofis sunucusu (`/auth/login`, `/portal/auth/login`) — HTTPS | Şifre yalnız **"Beni hatırla"** açıksa telefonun şifreli kasasında (iOS Keychain / Android Keystore, `expo-secure-store`) |
| Ad-soyad / ünvan | Sunucudan gelir (`/auth/me`) | — | Şifreli kasada (ekranda "Günaydın …" için) |
| Oturum belirteci (access/refresh token) | Sunucu verir | Her istekte sunucuya | Şifreli kasada |
| Mükellef mali verileri (beyanname, KDV, cari, fatura, mizan, e-tebligat, SGK, evrak) | Sunucudan **görüntülemek için** iner | Telefondan sunucuya gitmez | Kalıcı saklanmaz (yalnız açık ekran belleği) |
| Belge/fatura fotoğrafı | Kamera (belge tarayıcı) veya galeri — yalnız kullanıcı isteyince | Ofis sunucusu (`/fatura-muhasebelestirme/documents/upload`) | Yükleme sonrası tutulmaz (geçici önbellek) |
| Yazılan mesajlar | MOREN AI sohbeti, WhatsApp yanıtı, görev/not, ekip talimatı | Ofis sunucusu (AI cevabı sunucu tarafında yapay zekâ ile üretilir) | Saklanmaz |
| Anlık bildirim belirteci + cihaz modeli adı | Bildirim izni verilince (`expo-notifications`) | Ofis sunucusu (`/notifications/push-token`: token, platform, persona, deviceName) | Son kayıt bilgisi şifreli kasada |
| Biyometrik (Face ID / parmak izi) | Cihazın kendi doğrulaması | **Uygulamaya ve sunucuya hiç geçmez** | Hayır |
| Modül favorileri / son kullanılanlar | Uygulama içi tercih | Gitmez | WebView yerel deposu (kişisel veri değil) |

**Toplanmayan:** konum, kişiler/rehber, takvim, mikrofon/ses, sağlık, tarama geçmişi, reklam kimliği, analitik/çökme günlüğü (Firebase Analytics, Sentry vb. **yok**), üçüncü taraf SDK reklamı **yok**. Uygulama hesap **oluşturmaz** (hesapları ofis açar).

**Şifreleme:** tüm trafik HTTPS (`https://mali-musavir-app-production.up.railway.app/api/v1`); cihazda oturum belirteci ve "Beni hatırla" bilgileri şifreli kasada.

**Silme talebi:** Gizlilik politikası madde 5 — **muzaffer@morenmusavirlik.com** adresine e-posta; ofis hesabı ve verileri siler. Uygulama içinde "Çıkış yap" cihazdaki tüm kayıtlı bilgileri temizler.

---

## 2. Google Play — "Veri güvenliği" formu

**Genel sorular**
- Uygulama gerekli kullanıcı veri türlerinden herhangi birini topluyor veya paylaşıyor mu? → **Evet**
- Toplanan tüm kullanıcı verileri aktarım sırasında şifreleniyor mu? → **Evet**
- Kullanıcıların verilerinin silinmesini isteyebileceği bir yol sağlıyor musunuz? → **Evet** (e-posta yolu; hesap uygulama içinde oluşturulmadığı için "hesap silme URL'si" olarak gizlilik politikası sayfası verilir: https://morenmusavirlik.com/gizlilik)
- Bağımsız güvenlik incelemesi (MASA) → **Hayır**
- Aile politikası (çocuklara yönelik) → **Hayır** (uygulama 18+ profesyonel kullanım)

**Veri türleri** (her satırda: Toplanıyor mu = Evet · Paylaşılıyor mu = **Hayır** · İşleme = Geçici değil · Zorunlu/İsteğe bağlı · Amaç)

| Kategori | Tür | Zorunlu? | Amaç |
|---|---|---|---|
| Kişisel bilgiler (Personal info) | Ad (Name) | Zorunlu | Uygulama işlevselliği, Hesap yönetimi |
| Kişisel bilgiler | E-posta adresi (Email address) | Zorunlu | Uygulama işlevselliği, Hesap yönetimi |
| Finansal bilgiler (Financial info) | Diğer finansal bilgiler (Other financial info) — yüklenen fatura/evrak görüntüleri, görüntülenen mükellef verileri | İsteğe bağlı | Uygulama işlevselliği |
| Fotoğraflar ve videolar (Photos and videos) | Fotoğraflar (Photos) — belge yükleme | İsteğe bağlı | Uygulama işlevselliği |
| Mesajlar (Messages) | Diğer uygulama içi mesajlar (Other in-app messages) — AI sohbeti, WhatsApp yanıtı, görev notu | İsteğe bağlı | Uygulama işlevselliği |
| Cihaz veya diğer kimlikler (Device or other IDs) | Cihaz veya diğer kimlikler — anlık bildirim belirteci | İsteğe bağlı (bildirim izni) | Uygulama işlevselliği |

İşaretlenmeyecekler: Konum, Kişiler, Uygulama etkinliği, Uygulama bilgileri ve performansı (çökme günlüğü yok), Sağlık, Web tarama, Ses dosyaları, Takvim, Reklam/pazarlama, Analiz.

**"Paylaşım" sorusu:** Hayır. (Sunucu tarafında AI cevabı için yapay zekâ servisi kullanılır; bu, mağaza tanımında
"sizin adınıza işlem yapan hizmet sağlayıcı" sayılır, paylaşım olarak işaretlenmez — ama gizlilik politikasına
"sohbet mesajları yapay zekâ servisiyle işlenir" cümlesi **eklenmeli**, bkz. Dikkat.)

---

## 3. Apple — "App Privacy" (App Store Connect → Uygulama Gizliliği)

**Data Types → Collected** (hepsi: *Linked to the user* = Evet · *Used for tracking* = **Hayır** · Purpose = **App Functionality**)

| Apple kategorisi | Tür | Not |
|---|---|---|
| Contact Info | Email Address | giriş |
| Contact Info | Name | ekranda ad/ünvan |
| Financial Info | Other Financial Info | fatura/evrak görüntüsü yükleme, mükellef mali verileri |
| User Content | Photos or Videos | belge tarama / galeri |
| User Content | Other User Content | AI sohbet, WhatsApp yanıtı, görev/not metni |
| Identifiers | Device ID | anlık bildirim belirteci |

- Usage Data, Diagnostics, Location, Contacts, Health, Browsing History, Purchases, Search History, Sensitive Info → **Toplanmıyor**
- "Do you or your third-party partners collect data from this app?" → **Yes** (yukarıdaki türler)
- Tracking (ATT) → **No, we do not track** (reklam/izleme SDK'sı yok; ATT izni istenmez)
- Privacy Policy URL → **https://morenmusavirlik.com/gizlilik** (canlı, 2026-09-13'te 200 döndü)
- Account deletion: uygulama hesap oluşturmadığı için uygulama içi silme zorunluluğu yok; inceleme notunda e-posta yolu belirtilir (bkz. `inceleme-notu.md`).

---

## 4. iOS / Android izinleri (app.json ile birebir)

| İzin | Metin (Türkçe) | Neden |
|---|---|---|
| Kamera (`NSCameraUsageDescription`, `CAMERA`) | "Fatura ve evrak fotoğrafı çekip ofise göndermek için kamera izni gerekir." | Belge tarayıcı (VisionKit / ML Kit) + düz kamera |
| Fotoğraflar (`NSPhotoLibraryUsageDescription`, `READ_EXTERNAL_STORAGE`) | "Galeriden fatura/evrak görseli seçip ofise göndermek için fotoğraf erişimi gerekir." | Galeriden belge seçme |
| Face ID (`NSFaceIDUsageDescription`, `USE_BIOMETRIC`/`USE_FINGERPRINT`) | "Kayıtlı hesabınızla hızlı ve güvenli giriş için Face ID kullanılır." | Beni hatırla + biyometrik açılış |
| Bildirim (`POST_NOTIFICATIONS`, iOS bildirim izni) | sistem diyaloğu | Anlık bildirimler |
| **Mikrofon** | **KALDIRILDI** (`RECORD_AUDIO` + `NSMicrophoneUsageDescription`; Android'de `blockedPermissions` ile engellendi; `expo-av` bağımlılığı silindi) | Uygulamada ses/mikrofon kodu yok |

---

## 5. Dikkat (Muzaffer Bey karar verecek)
1. **Gizlilik politikası güncellemesi:** madde 3 "üçüncü taraflarla paylaşmaz" diyor; MOREN AI sohbetinin sunucu tarafında yapay zekâ servisiyle işlendiği ve anlık bildirimlerin Expo/APNs/FCM altyapısından geçtiği bir cümleyle eklenmeli (`store/gizlilik-politikasi.md` + yayındaki sayfa).
2. Gizlilik politikasında sunucu adresi "api.morenmusavirlik.com" yazıyor; uygulama şu an `mali-musavir-app-production.up.railway.app` adresine bağlanıyor — metinde "Moren Mali Müşavirlik sunucuları" demek yeterli, alan adı yazılmasın.
3. Google Play "hesap silme" bölümü bir URL ister: gizlilik sayfasında "Hesap ve veri silme talebi: muzaffer@morenmusavirlik.com" başlığı görünür olmalı.
