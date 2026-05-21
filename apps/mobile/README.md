# Moren Mobil

MOREN Mali Müşavirlik portalının iOS/Android hazırlık uygulaması.

Bu klasörde artık iki ayrı giriş akışı olan Expo Router kabuğu var:

- Müşavir girişi: ofis özeti, portal modülleri, Moren Ofis AI, AI onay kuyruğu, mükellef hızlı bakış.
- Mükellef girişi: mükellef özeti, evrak gönderme, belge arşivi, ofise mesaj.
- Mobil OCR: müşavir mükellefi seçer, kamera/galeri ile görüntüleri tarar, dosyalar seçilen mükellef adına portaldaki fatura işleme OCR kuyruğuna düşer.

## Çalıştırma

```bash
cd C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app
pnpm install
pnpm --filter @moren/mobile start
```

Expo Go ile QR kodu okutulabilir. Web önizleme için:

```bash
pnpm --filter @moren/mobile web
```

API adresi varsayılan olarak `http://localhost:3001/api/v1`.
Değiştirmek için:

```bash
$env:EXPO_PUBLIC_API_URL="https://api.morenmusavirlik.com/api/v1"
pnpm --filter @moren/mobile start
```

## Mobil Kapsam

Portal modülleri `lib/mobile-modules.ts` içinde müşavir ve mükellef olarak iki kataloğa ayrıldı.

Müşavir öncelikleri:

- Ofis özeti
- Moren Ofis AI
- Mobil OCR tarama
- AI onay kuyruğu
- Mükellefler
- Görevler
- Evraklar
- KDV kontrol
- Beyannameler
- Faturalar ve fatura muhasebeleştirme
- Cari kasa, banka takip, mizan/gelir/bilanço
- Bordro/SGK, ajanlar, bildirimler

Mükellef öncelikleri:

- Mükellef özeti
- Evrak gönder
- Belgelerim
- KDV durumu
- Beyannamelerim
- Cari durum
- Ofise mesaj
- Takvim

## Teknik Durum

- Expo SDK 52, Expo Router, React Native 0.76.
- JWT login ve refresh token için mobil API client hazır.
- Tokenlar `expo-secure-store` ile saklanıyor.
- Demo önizleme gerçek API gerektirmeden müşavir/mükellef ekranlarını açıyor.
- Moren Ofis AI, AI onay kuyruğu, görev sayıları ve mükellef listesi gerçek API varsa onu kullanıyor.
- Mobil OCR tarama gerçek API varsa `/fatura-muhasebelestirme/documents/upload` endpointine `taxpayerId`, `source=mobile-ocr`, `invoiceKind` ve görüntüleri multipart olarak gönderiyor.
- Mükellef tarafındaki evrak yükleme şimdilik dosya seçme/kamera hazırlığıdır; gerçek mükellef upload yetkisi backend modelinde ayrıca açılmalı.

## Backend Sonraki Adım

Mükellef girişini üretime almak için backend tarafında ayrı bir erişim modeli önerilir:

- `TaxpayerAccess` veya `TaxpayerUser` modeli
- Davet kodu + parola/OTP
- `TAXPAYER` rolü veya ayrı guard
- Mükellef kullanıcısının sadece kendi `taxpayerId` kapsamına erişmesi
- Mobil push token kayıt endpointi
- `GET /mobile/bootstrap` ile tek istekte ilk ekran verisi
