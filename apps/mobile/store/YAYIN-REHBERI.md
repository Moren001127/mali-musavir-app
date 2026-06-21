# Yayın Rehberi — App Store & Google Play

Bu rehber, uygulamayı sıfırdan mağazalara yüklemek için adım adım yol haritasıdır. Komutlar `apps/mobile` klasöründe çalıştırılır.

---

## 0. Ön koşullar (bir kez)
- **Apple Developer Program** — yıllık ~99 USD. https://developer.apple.com/programs (kişisel ya da şirket adına; şirket için DUNS numarası gerekir).
- **Google Play Console** — tek seferlik ~25 USD. https://play.google.com/console
- **Expo hesabı** (ücretsiz) — https://expo.dev → `npx expo login`
- EAS CLI: `npm i -g eas-cli` (veya `npx eas-cli`)

---

## 1. Projeyi EAS'e bağla (bir kez)
```
npx expo login
npx eas init          # extra.eas.projectId otomatik eklenir
```
> Not: `app.json` içine `projectId` elle YAZMA; `eas init` ekler.

---

## 2. Android — Google Play

### a) Test/iç build (APK, telefona kurulabilir)
```
npm run build:preview          # eas build --profile preview (APK)
```
Çıkan APK linkini telefonda açıp kur, baştan sona test et.

### b) Yayın build (AAB)
```
eas build --platform android --profile production
```

### c) Mağazaya gönderim
1. Play Console → Uygulama oluştur → paket adı `com.moren.mobil`.
2. İçerik derecelendirme, hedef kitle, **gizlilik politikası URL'i** (gizlilik-politikasi.html'i yayınla), Veri Güvenliği formunu doldur.
3. `magaza-metinleri.md`'deki açıklama/görselleri yükle.
4. Gönderim: `eas submit --platform android --profile production`
   (ilk seferde Google service account anahtarı istenir; Play Console → Ayarlar → API erişimi'nden oluşturulur.)
5. Önce "İç test" → sonra "Üretim" kanalına yükselt.

---

## 3. iOS — App Store

### a) Yayın build
```
eas build --platform ios --profile production
```
İlk seferde Apple hesabınla giriş istenir; EAS sertifika/provisioning'i otomatik yönetir.

### b) Mağazaya gönderim
1. App Store Connect → Yeni uygulama → bundle ID `com.moren.mobil`.
2. `eas submit --platform ios --profile production`
3. App Store Connect'te: ekran görüntüleri (6.7" ve 6.5"), açıklama, anahtar kelimeler, **gizlilik politikası URL'i**, App Privacy (veri toplama) anketi.
4. TestFlight ile dahili test → ardından "İncelemeye gönder".

---

## 4. Sürüm yükseltme (sonraki güncellemeler)
- `app.json` → `version` artır (ör. 1.0.1).
- `eas.json` production profilinde `autoIncrement: true` olduğu için build/version kodu otomatik artar.
- Tekrar build + submit.

---

## 5. Kontrol listesi
- [ ] Apple Developer + Google Play hesapları açıldı
- [ ] `eas init` ile projectId eklendi
- [ ] gizlilik-politikasi.html bir URL'de yayınlandı
- [ ] İkon 1024×1024 ve ekran görüntüleri hazır
- [ ] Preview APK telefonda test edildi
- [ ] Üretim build alındı ve gönderildi
