# Mağaza İnceleme Notu (App Review Notes / Play "Uygulama erişimi") — 2026-09-13

Apple **App Store Connect → App Review Information → Notes** ve Google Play **"Uygulama erişimi" (App access → Tüm işlevler kısıtlı)**
alanlarına kopyalanacak metinler. Demo hesap satırlarını **Muzaffer Bey dolduracak** (inceleme için ayrı, gerçek olmayan
mükellef verisi gösteren bir müşavir hesabı + bir mükellef hesabı önerilir).

## Demo hesap (inceleme ekibi için) — DOLDURULACAK
```
Müşavir girişi  — E-posta: ______________________   Şifre: ______________________
Mükellef girişi — E-posta: ______________________   Şifre: ______________________
```
Not: Uygulamada "Mali Müşavir Girişi" / "Mükellef Girişi" seçimi ilk ekrandadır. Hesaplar ofis tarafından açılır;
uygulama içinde kayıt (sign-up) yoktur.

---

## Apple — Review Notes (İngilizce, kopyala)

```
MOREN Müşavir is the private mobile client of Moren Mali Müşavirlik, a Turkish accounting office. It is used by the
office staff (advisor login) and the office's own clients/taxpayers (taxpayer login). Accounts are created by the office;
there is no in-app sign-up. Please use the demo accounts below.

Advisor login:  email ____________  password ____________
Taxpayer login: email ____________  password ____________

Why this is not a "web wrapper" (guideline 4.2): the UI is bundled inside the app (no remote website is loaded) and the
app relies on native capabilities:
- Document scanner (VisionKit on iOS) with automatic edge detection and multi-page capture, uploading invoices to the
  office's processing queue; fallback to the native camera and photo library.
- Face ID / Touch ID auto-login (LocalAuthentication) with credentials stored in the Keychain ("Remember me").
- Haptic feedback on interactions and pull-to-refresh.
- Push notifications (deadline reminders, approvals, e-Tebligat alerts) with deep links into the relevant screen.
- Offline-resilient shell: fonts and UI are bundled; a connection banner appears when the network is unavailable.

Account deletion: accounts are provisioned by the office, not created in the app. Users can request deletion of their
account and data at muzaffer@morenmusavirlik.com (see Privacy Policy, section 5). "Log out" removes all locally stored
data (tokens and remembered credentials).

Privacy: no analytics, advertising or tracking SDKs. Data goes only to the office's own server over HTTPS.
Privacy policy: https://morenmusavirlik.com/gizlilik
Contact for review questions: muzaffer@morenmusavirlik.com
```

## Google Play — "Uygulama erişimi" açıklaması (Türkçe/İngilizce kısa)

```
The app requires an account provisioned by the accounting office (no self sign-up). Demo credentials:
Advisor: ____________ / ____________   Taxpayer: ____________ / ____________
Select "Mali Müşavir Girişi" (advisor) or "Mükellef Girişi" (taxpayer) on the first screen, then sign in.
```

---

## Olası inceleme riskleri ve hazır cevaplar

| Risk | Nerede | Hazır cevap / önlem |
|---|---|---|
| **4.2 Minimum Functionality (web kılıfı)** | Apple | Yukarıdaki not: yerel belge tarayıcı (VisionKit), Face ID, dokunsal geri bildirim, anlık bildirim, kamera; arayüz uygulama içinde gömülü, uzak site yüklenmiyor |
| **5.1.1(v) Giriş zorunlu uygulama** | Apple | Demo hesaplar notta; hesabı ofis açar |
| **3.2.2 / özel kullanım (tek ofisin müşterileri)** | Apple | Uygulama ofisin mükelleflerine açık bir hizmet uygulamasıdır (her mükellef kullanabilir). Apple yine de "Unlisted App Distribution" (mağazada listelenmeyen, link ile dağıtım) önerirse: App Store Connect'ten "unlisted" talebi yapılır, inceleme aynı akışla sürer |
| **Hesap silme (5.1.1(v))** | Apple | Uygulama içi kayıt yok → uygulama içi silme zorunlu değil; e-posta yolu belirtildi. İstenirse Ayarlar'a "Hesabımı sil (talep gönder)" satırı eklenebilir |
| **Mikrofon izni açıklaması** | Apple ITMS-90683 | Kaldırıldı: `NSMicrophoneUsageDescription` yok, `expo-av` bağımlılığı silindi, `expo-image-picker` `microphonePermission:false` |
| **Kamera/fotoğraf izin metinleri** | Apple 5.1.1 | Türkçe, kullanım amacı açık (app.json) |
| **Veri güvenliği formu eksik/uyumsuz** | Play | `veri-guvenligi-cevaplari.md` ile birebir doldurulur |
| **Hedef kitle / içerik derecelendirme** | Play | Yetişkin profesyonel kullanım; "Finans" kategorisi; IARC anketi: şiddet/kumar yok |
| **Finans uygulaması ek belge (Play "Finansal özellikler" beyanı)** | Play | Uygulama kredi/ödeme/yatırım sunmaz; "muhasebe/vergi görüntüleme" — beyanda "hiçbiri" seçilir; sorulursa: para transferi, kredi, kripto yok |
| **Bildirim izni (Android 13+)** | Play | `POST_NOTIFICATIONS` manifestte; izin uygulama içinde girişten sonra istenir |
| **Örnek veriyle ekran görüntüsü** | İkisi | `ekran-goruntuleri.md`: örnek verili görüntüler; gerçek isim/VKN içermez (Doğan Ticaret vb. uydurma) |

---

## İnceleme öncesi kontrol listesi
- [ ] Demo hesaplar açıldı ve bu dosyaya yazıldı (verileri sahte/gerçek olmayan mükelleflere ait olmalı)
- [ ] Gizlilik politikasına yapay zekâ + bildirim altyapısı cümlesi eklendi (bkz. `veri-guvenligi-cevaplari.md` → Dikkat)
- [ ] Ekran görüntüleri yüklendi (`screenshots-2026-09/`)
- [ ] Sürüm: app.json `version 1.1.0`, iOS `buildNumber 2`, Android `versionCode 2` (EAS `appVersionSource: remote` — EAS sunucudaki sayacı kullanır; uyuşmazlık olursa `eas build:version:set`)
- [ ] Üretim derlemesi gerçek cihazda: belge tarayıcı, Face ID, bildirim, çevrimdışı şerit denendi
