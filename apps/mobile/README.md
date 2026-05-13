# Moren Mobil (Expo)

iOS + Android personel uygulaması. Web portalın mobil versiyonu — Moren AI ekibi
ile sesli sohbet, AI onay kuyruğu, mükellef hızlı bakış, evrak yükle.

## Durum

🚧 İskelet aşaması — kurulum komutları aşağıda. Tanıtım görseli:
[mobil/tanitim.html](../web/public/mobil/tanitim.html)

## Kurulum (npm install gerekir)

```bash
cd apps/mobile
npx create-expo-app@latest . --template tabs
npm install expo-local-authentication expo-secure-store expo-speech expo-av \
            expo-notifications expo-device expo-image-picker \
            @tanstack/react-query zustand axios
npm install nativewind tailwindcss
npx expo install react-native-svg
```

## Proje Yapısı (Planlanan)

```
apps/mobile/
├── app/
│   ├── (auth)/login.tsx           # JWT + biyometrik
│   ├── (tabs)/
│   │   ├── index.tsx              # Dashboard (brifing + AI özet)
│   │   ├── ofis.tsx               # Moren Ofis 7 ajan chat
│   │   ├── onay.tsx               # AI Onay Kuyruğu
│   │   ├── mukellef.tsx           # Mükellef listesi + bakış
│   │   └── evrak.tsx              # Belge yükle + OCR
│   └── _layout.tsx
├── lib/
│   ├── api.ts                     # axios + JWT (web'den kopya)
│   ├── auth.ts                    # AsyncStorage token + biyometrik
│   ├── moren-ofis.ts              # Chat + sesli + tool
│   └── push.ts                    # Expo Push token register
├── components/
│   ├── AgentCard.tsx
│   ├── MesajKart.tsx
│   ├── OnayKart.tsx
│   └── ...
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── adaptive-icon.png
├── app.json                       # Expo config
├── package.json
└── tsconfig.json
```

## Faz 1 MVP — 1 Hafta

- [ ] Login + JWT + biyometrik kilit
- [ ] Dashboard ana sayfa (Moren AI özet, brifing)
- [ ] Moren Ofis chat (yazılı + sesli)
- [ ] AI Onay Kuyruğu (onayla / reddet)
- [ ] Push notification kayıt (Expo Push)

## Faz 2 — 2. Hafta

- [ ] Mükellef hızlı bakış (mizan, KDV, evrak özet)
- [ ] Evrak yükleme (kamera + galeri, çoklu)
- [ ] DENİZ Patrol & Haftalık Rapor
- [ ] Sesli sohbet modu (mikrofon + Türkçe TTS)

## Faz 3 — Build & Yayın

- [ ] EAS Build kurulumu (`eas build:configure`)
- [ ] iOS TestFlight (Apple Developer hesabı $99/yıl)
- [ ] Android Internal Test (Google Play Console $25)
- [ ] App Store + Play Store submission (1-3 hafta inceleme)

## Backend Eklemeleri (mobile için)

Web'de mevcut JWT tabanlı auth aynı kullanılır.
Eklenen endpoint'ler:

- `POST /push/register` { token, platform }
- `POST /push/test` { userId }
- `GET /mobile/bootstrap` (initial dashboard data — tek istek)

## Maliyet

| Kalem | Bedel |
|---|---|
| Apple Developer Program | $99/yıl |
| Google Play Console | $25 tek seferlik |
| Expo + EAS Build (free tier) | $0 |
| Expo Push Service | $0 |
| Toplam | ~$100/yıl |

## Görsel Tanıtım

Web'deki `/mobil/tanitim.html` sayfasında 6 ekran mockup'ı mevcut.
Production'da kullanıcılar `morenmusavirlik.com/mobil` adresinden bu sayfayı görür.
