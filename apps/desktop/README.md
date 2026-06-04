# Moren Masaüstü

Mali müşavir ofisinin devlet portalı kısayollarını tek uygulamada toplayan, portalda kayıtlı firma şifreleriyle **tek tıkla otomatik giriş** yapan ve **WhatsApp QR** bağlantısı sunan Windows masaüstü uygulaması (Electron).

## Mimari
- **Ana process** (`src/main`): pencere yönetimi, portal API çağrıları, JWT ve "beni hatırla" güvenli saklama (Windows DPAPI / `safeStorage`), otomatik giriş için gömülü tarayıcı penceresi + form doldurma.
- **Arayüz** (`src/renderer`): giriş, firma seçici, kısayol grid'i, WhatsApp QR, ayarlar. Token ve şifre arayüze hiç gelmez.
- **Portal API**: `https://mali-musavir-app-production.up.railway.app/api/v1`
  - `POST /auth/login` → JWT
  - `GET /desktop/shortcuts` → firma listesi + portal kataloğu + şifre durumu
  - `POST /desktop/credential` → tek firma/portal için çözülmüş şifre (otomatik giriş)
  - `*/integrations/whatsapp/qr/*` → Baileys QR

## Güvenlik
Şifreleme anahtarı (ENCRYPTION_KEY) sunucudadır, uygulamaya inmez. Açık şifre yalnızca tek firma/portal isteğinde alınır, doğrudan o portalın penceresine enjekte edilir; diske düz şifre yazılmaz, arayüze gönderilmez.

## Geliştirme
```
npm install
npm run dev        # geliştirme (DevTools açık)
npm run dist       # Windows kurulum (.exe) üretir → dist/
```
`MOREN_API_URL` ile API adresi değiştirilebilir.

## Otomatik giriş reçeteleri
`src/main/portal-login.js` — her portalın giriş formu seçicileri. Site arayüzü değişirse buradaki seçici listeleri güncellenir.
