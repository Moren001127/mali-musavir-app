# Mali Müşavir Ofisi — Hızlı Başlangıç

## Gereksinimler
- Node.js 20+
- Docker & Docker Compose
- pnpm (`npm install -g pnpm@9`)

## Kurulum

### 1. Bağımlılıkları yükle
```bash
pnpm install
```

### 2. Ortam değişkenlerini ayarla
```bash
cp .env.example apps/api/.env
# apps/api/.env dosyasını düzenle
```

### 3. Veritabanı ve servisleri başlat (Docker)
```bash
docker compose up -d
```

### 4. Veritabanı şemasını uygula
```bash
cd apps/api
pnpm prisma migrate dev --name init
pnpm prisma generate
```

### 5. Geliştirme sunucularını başlat
```bash
# Root dizininden:
pnpm dev

# Veya ayrı terminallerde:
cd apps/api && pnpm dev      # http://localhost:3001/api/v1
cd apps/web && pnpm dev      # http://localhost:3000
```

## Servisler

| Servis | URL |
|---|---|
| Web Arayüzü | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| MinIO (S3) | http://localhost:9000 |
| MinIO Konsol | http://localhost:9001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

## API Endpoint'leri

```
POST   /api/v1/auth/register     Yeni ofis kaydı
POST   /api/v1/auth/login        Giriş
POST   /api/v1/auth/refresh      Token yenile
POST   /api/v1/auth/logout       Çıkış
GET    /api/v1/auth/me           Mevcut kullanıcı

GET    /api/v1/taxpayers         Mükellef listesi
POST   /api/v1/taxpayers         Yeni mükellef
GET    /api/v1/taxpayers/:id     Mükellef detayı
PUT    /api/v1/taxpayers/:id     Mükellef güncelle
DELETE /api/v1/taxpayers/:id     Mükellef sil (soft)

GET    /api/v1/users             Kullanıcı listesi (ADMIN)
POST   /api/v1/users/invite      Kullanıcı davet et (ADMIN)
DELETE /api/v1/users/:id         Kullanıcı deaktif et (ADMIN)

GET    /api/v1/notifications     Bildirimler
GET    /api/v1/notifications/unread-count  Okunmamış sayısı
PATCH  /api/v1/notifications/:id/read     Okundu işaretle
```

## Proje Yapısı

```
mali-musavir-app/
├── apps/
│   ├── api/          NestJS Backend (port 3001)
│   └── web/          Next.js Frontend (port 3000)
├── packages/
│   └── shared/       Ortak tipler, sabitler, Zod şemaları
└── docker-compose.yml
```

## Faz Durumu (Mayıs 2026)

- [x] **Faz 0** — Altyapı, Auth, RBAC, Prisma Şeması, CRM, Audit log
- [x] **Faz 1** — Evrak Yönetimi: S3 (MinIO) upload, versiyon, kategoriler, etiketler
- [x] **Faz 2** — Beyanname Takip: TaxpayerBeyanConfig + BeyanDurumu + BeyanKaydi (Hattat ZIP/Excel import)
- [x] **Faz 3** — Fatura / Gelir-Gider / Raporlama:
  - Mihsap arşivi → fatura görüntüsü + Claude OCR
  - Luca muavin → Excel parse
  - KDV Kontrol modülü (191/391 mutabakat motoru, tevkifat)
  - Mizan / Bilanço / Gelir Tablosu
  - Cari Kasa (oto tahakkuk + tahsilat + ekstre)
  - E-Arşiv (ZIP import, fatura listesi)
  - Fiş Yazdırma
- [ ] **Faz 4** — Bordro & SGK *(şema hazır, modül bekleniyor)*
- [ ] **Faz 5** — Entegrasyon adaptörleri *(GİB doğrudan API entegrasyonu yok; Luca/Mihsap için Chrome uzantısı + portal proxy çalışıyor)*

### Aktif Modüller (özet)

| Modül | API Path | Web Sayfa |
|---|---|---|
| Mükellefler (CRM) | `/taxpayers` | `/panel/mukellefler` |
| Evraklar (S3) | `/documents` | `/panel/evraklar` |
| Beyannameler | `/beyanname-takip`, `/beyan-kayitlari` | `/panel/beyannameler` |
| KDV Kontrol | `/kdv-control` | `/panel/kdv-kontrol` |
| Mizan + Finansal Tablolar | `/mizan`, `/bilanco`, `/gelir-tablosu` | `/panel/mizan`, `/panel/bilanco`, `/panel/gelir-tablosu` |
| Cari Kasa | `/cari-kasa` | `/panel/cari-kasa` |
| E-Arşiv | `/earsiv` | `/panel/e-arsiv` |
| Fiş Yazdırma | `/fis-yazdirma` | `/panel/fis-yazdirma` |
| Galeri / HGS | `/galeri` | `/panel/galeri/hgs-ihlal` |
| Moren AI | `/moren-ai` | `/panel/moren-ai` |
| Bildirimler | `/notifications` | `/panel/bildirimler` |
| Audit Log | `/audit-logs` | `/panel/ayarlar/denetim` |
| Ajanlar (Luca, Mihsap, KDV vs.) | `/agent/*` | `/panel/ajanlar/*` |
| Firma Hafızası | `/vendor-memory` | `/panel/firma-hafizasi` |
| Onay Kuyruğu | `/pending-decisions` | `/panel/onay-kuyrugu` |
| Duyurular | `/notifications` | `/panel/duyurular` |

### Yapılacaklar (yol haritası)

1. **E-Defter Denetim** modülü (yevmiye fişi denetim raporu — bkz. ön çalışma dokümanı)
2. **Bordro & SGK** modülü (Faz 4)
3. **WhatsApp hatırlatma akışı** zenginleştirme
4. **Beyanname taslak üretici** (KDV1/KDV2 → GİB XML)
5. **Banka OCR** (banka ekstresi PDF okuma)
6. **BA-BS mutabakat**
7. **Müşteri portalı** (mükellefe sınırlı erişim)
8. **Mobil uygulama** (PWA + Capacitor)
