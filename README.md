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
- [x] **Faz 3** — Fatura / Gelir-Gider / Raporla