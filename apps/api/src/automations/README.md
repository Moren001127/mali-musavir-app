# Automations Module

Moren AI Otomasyon Motoru — Faz 1 + Faz 2 + Faz 3 tamamlandı. **Artık otomasyonlar gerçekten çalışır.**

Tam plan için projenin köküne bak: `MOREN_AI_OTOMASYON_MOTORU_PLAN.md`.

## Tamamlanan fazlar

### Faz 1 — Veri katmanı + temel CRUD
- `Automation` ve `AutomationRun` Prisma modelleri (+ enum'lar).
- `AutomationsService` — CRUD, durum geçişleri, çalışma kayıtları sorgulama.
- `AutomationsController` — JWT korumalı REST API.
- Çok kiracılı (multi-tenant) izolasyon: her sorgu `req.user.tenantId` ile sınırlı.

### Faz 2 — Doğal dil parser + UI
- `action-catalog.ts` — mevcut 38 read tool + 17 yeni aksiyon (iletişim, OCR, AI, akış kontrol).
- `AutomationParserService` — Türkçe cümle → workflow JSON (Anthropic Sonnet 4.6).
- `POST /automations/parse` endpoint'i — kaydetmeden öneri üretir.
- `GET /automations/catalog` endpoint'i — UI için aksiyon listesi.
- Frontend: `/panel/otomasyonlar/yeni` (cümle gir + önizleme) ve `/panel/otomasyonlar` (liste).
- Sidebar'a "Otomasyonlar" menü öğesi eklendi (Moren AI grubu altında).

### Faz 3 — Çalıştırıcı motor (RUNTIME) ⚡
- `template-resolver.ts` — `{{degisken.alan}}` pattern'i çözücü + koşul değerlendirici.
- `ActionDispatcherService` — aksiyon adı → gerçek servis çağrısı.
  - READ tool'ları: mevcut `ToolExecutorService`'e delege.
  - WRITE: WhatsApp template/freeform, e-posta (nodemailer), in-app bildirim.
  - AI: `summarize_with_claude` ve `classify_with_claude` — Anthropic Haiku 4.5.
  - `http_get`: sadece allowlist domain'ler (resmigazete, gib, sgk, mevzuat).
  - OCR / Luca / Resmi Gazete: ŞİMDİLİK STUB (Faz 6/7'de gerçek).
- `AutomationRunnerService` — ana motor.
  - `OnModuleInit` ile boot'ta tüm ACTIVE+CRON otomasyonları SchedulerRegistry'e yükler.
  - `executeAutomation()` — herhangi bir tetikleyiciden çağrılır.
  - Recursive step yürütme: `for_each`, `branch_if`, `parallel`, `wait`.
  - Her step'in input/output/error/süre log'u `AutomationRun.stepLogs`'a yazılır.
  - Sayaçlar (`totalRuns`, `successRuns`, `failureRuns`, `lastRunAt`) güncellenir.
  - **Hata politikası**: `pause_after_3` ardışık başarısız run'dan sonra otomasyon PAUSED'a alınır.
- `AutomationsService.setStatus()` ACTIVE↔PAUSED geçişinde Runner'ı bilgilendirir (cron register/unregister).
- Yeni endpoint'ler:
  - `POST /automations/:id/run` — Şimdi Çalıştır (gerçek).
  - `POST /automations/:id/dry-run` — Aksiyon yapmadan simüle et.
- Frontend liste sayfasında ⚡ "Şimdi Çalıştır" ve 🧪 "Dry-Run" butonları.
- `cron@^4.4.0` paketi `apps/api/package.json`'a eklendi.

## API endpoint'leri

| Method | Path | Açıklama |
|--------|------|----------|
| **POST** | **`/automations/parse`** | **Cümleyi parse et — kayıt YAPMAZ, sadece öneri döner** |
| **GET** | **`/automations/catalog`** | **UI için aksiyon kataloğu** |
| **POST** | **`/automations/:id/run`** | **Şimdi Çalıştır — gerçek aksiyon yapar** |
| **POST** | **`/automations/:id/dry-run`** | **Adımları simüle et, gerçek aksiyon yapma** |
| GET | `/automations` | Listele (filtre: status, triggerType, search, page, pageSize) |
| GET | `/automations/:id` | Tek otomasyon detayı |
| GET | `/automations/:id/runs` | Otomasyonun çalışma geçmişi |
| GET | `/automations/runs/:runId` | Tek bir run detayı (step logları) |
| POST | `/automations` | Yeni otomasyon (DRAFT olarak) |
| PATCH | `/automations/:id` | Otomasyonu güncelle |
| PATCH | `/automations/:id/status` | Durum değiştir (ACTIVE/PAUSED/...) |
| DELETE | `/automations/:id` | Arşivle (yumuşak silme) |
| DELETE | `/automations/:id/hard` | Sadece DRAFT'lar için sert silme |

## Sonraki fazlar (henüz YOK)

| Faz | İçerik | Süre tahmini |
|-----|--------|--------------|
| 4 | Frontend detay sayfası + çalışma geçmişi UI | 2-3 gün |
| 5 | Olay tetikleyiciler (WhatsApp, belge, beyanname) + webhook + Bull delayed wait | 3-4 gün |
| 6 | OCR + Luca aksiyonlarının gerçek implementasyonu (şu an stub) | 3-4 gün |
| 7 | Resmi Gazete tetikleyici (şu an stub) | 2-3 gün |
| 8 | Polish, maliyet göstergesi, SMS sağlayıcı, dokümantasyon | 3-5 gün |

## İlk gerçek test — adım adım

Yerel ortamı hazırla, sonra somut bir cümleyle test et:

```bash
# 1) Bağımlılıkları yükle (cron paketi eklendi)
cd apps/api
pnpm install
pnpm db:generate
pnpm db:migrate     # önceki Faz 1 migration'ı uygulanmadıysa: add_automations_module
```

`.env`'de gerekli değişkenler:
- `ANTHROPIC_API_KEY` — parser ve summarize_with_claude için
- `WHATSAPP_*` — WhatsApp aksiyonları için (varsa)
- `SMTP_*` — e-posta gönderimi için (varsa)
- `DATABASE_URL`, `REDIS_URL` (standart)

```bash
# 2) Yerel servisleri başlat
docker compose up -d   # Postgres + Redis
cd ../..
pnpm dev               # api + web aynı anda
```

Tarayıcıdan giriş yap, panele git, sol menüde **Moren AI → Otomasyonlar** → **+ Yeni Otomasyon**.

İlk test cümlesi (en basit, dış servis gerektirmez):

> "Her dakika bana 'Otomasyon test çalıştı' yazılı bir bildirim oluştur."

Beklenen:
1. Parser `triggerType: CRON`, `cron: "* * * * *"` ile `create_pending_action` adımı üretir.
2. "Kur ve Aktif Et" tıklanır → otomasyon ACTIVE'e geçer, runner cron'u register eder.
3. Bir dakika sonra api log'unda `Cron register: id=...` ve sonrasında bildirim yaratıldığı görülür.
4. UI'da bildirimler sayfasında veya zil ikonunda bildirim çıkar.
5. Otomasyonlar listesinde "Son Çalışma" sütununda zaman ve ✓ rozeti görünür.

Daha sonra liste sayfasındaki ⚡ "Şimdi Çalıştır" ile cron'u beklemeden tetikleyebilir, 🧪 "Dry-Run" ile gerçek aksiyon yapmadan deneyebilirsin.

## Bilinen kısıtlar (Faz 3 sonu itibariyle)

1. **OCR, Luca, Resmi Gazete tool'ları stub.** `ocr_pdf`, `extract_invoice_fields`,
   `post_to_luca`, `check_official_gazette` çağrılırsa `{ stub: true, ... }` döner.
   Çalışma "success" olarak işaretlenir ama gerçek iş yapılmaz. Faz 6/7'de gerçek olacak.
2. **EVENT tetikleyici çalışmaz.** Cron + manuel + dry-run çalışır, ama event tipi
   otomasyonlar (`Document.Uploaded` vs.) henüz dinleyiciye bağlı değil. Faz 5.
3. **WEBHOOK tetikleyici çalışmaz.** Endpoint var ama secret üretimi ve dış HTTP'den
   tetikleme akışı Faz 5'te.
4. **Wait > 1 saat çalışmaz.** Şu an `setTimeout` ile çalışıyor; uzun bekleme için
   Bull delayed job desteği Faz 5'te eklenecek.
5. **SMS sağlayıcı yok.** `send_sms` aksiyonu stub döner — gerçek sağlayıcı (NetGSM/
   Twilio) entegrasyonu Faz 8.
6. **Maliyet izleme dashboard'u yok.** Her run'ın `costUsd`'si DB'ye yazılıyor ama
   ekranda toplam gösterilmiyor. Faz 4/8.
7. **Cron timezone.** `triggerConfig.timezone` parametresi şu an okunmuyor — tüm
   cron'lar sunucunun TZ'sinde çalışır. Production Railway TZ'si UTC, bu yüzden
   "10:00 Türkiye saati" için cron expression'ı 07:00 UTC olarak yazılmalı. Faz 8'de
   timezone'lı cron desteği eklenecek.

## Migration

Prisma şeması güncellendi. Yerel ortamda çalıştırmak için:

```bash
cd apps/api
pnpm db:generate    # Prisma client'ı yenile
pnpm db:migrate     # Migration adı: 'add_automations_module'
```

Railway'e deploy edildiğinde `prisma migrate deploy` otomatik çalışır (api/package.json'da
`start` script'inde tanımlı).

## Test çağrıları (curl)

JWT token aldıktan sonra:

```bash
# Listele
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/automations

# DRAFT otomasyon oluştur (manuel — Faz 2'de cümleden otomatik üretilecek)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3001/automations \
  -d '{
    "prompt": "Her ayın 22sinde KDV gecikenlere WhatsApp at",
    "title": "KDV gecikenler için aylık WhatsApp",
    "triggerType": "CRON",
    "triggerConfig": { "cron": "0 10 22 * *" },
    "steps": {
      "schemaVersion": 1,
      "steps": [
        { "id": "s1", "tool": "list_taxpayers_monthly_status",
          "args": { "beyannameDurumu": "verilmedi" }, "outputAs": "gecikenler" }
      ]
    }
  }'

# Aktive et
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3001/automations/{id}/status \
  -d '{ "status": "ACTIVE" }'
```

## Önemli notlar

**Bu faz henüz hiçbir otomasyonu ÇALIŞTIRMAZ.** Sadece tanımları kaydedip yönetir.
ACTIVE durumuna geçirilen bir otomasyon, runner motoru (Faz 3) gelene kadar
arka planda bir şey yapmaz. Bu kasıtlı — veri katmanını sağlam kurup, sonra
çalıştırıcıyı üstüne ekliyoruz.

**Step JSON şeması** `{ schemaVersion: 1, steps: [...] }` formatında. İçerideki
adım objelerinin yapısı Faz 2'de parser ile birlikte detaylı doğrulanacak.
Şimdilik sadece üst katman doğrulanıyor.
