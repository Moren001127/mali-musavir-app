# Moren AI Otomasyon Motoru — Plan Dokümanı

**Tarih:** 20 Mayıs 2026
**Hazırlayan:** Claude + Muzaffer Ören
**Kapsam:** Tam set — zamanlı + olay tetikli + OCR + Luca dahil
**Hedef:** Moren portalı içine "doğal dil ile otomasyon kuran" bir katman eklemek

---

## 1. Vizyon (Tek Cümle)

Kullanıcı (mali müşavir veya çalışan) portala girer, bir kutuya Türkçe cümleyle ne istediğini yazar, Moren AI bu cümleyi çalışan, kalıcı, izlenebilir bir otomasyona dönüştürür. Otomasyon sonsuza kadar arka planda çalışır, raporunu listeden takip eder, gerekirse müdahale edersin.

**Örnek cümleler:**

> "Her ayın 22'sinde KDV beyannamesi henüz verilmemiş müvekkillere WhatsApp'tan hatırlatma at, listesini bana e-posta gönder."

> "Bir müvekkil WhatsApp'tan fatura PDF'i gönderdiğinde otomatik OCR'la oku, KDV ve tutarı çıkar, Luca'ya kaydet, hata olursa bana bildir."

> "Resmi Gazete'de KDV ile ilgili yeni bir düzenleme yayınlandığında özetini çıkar ve hangi müvekkillerimi ilgilendirdiğini söyle."

> "Bir müvekkilim aynı tedarikçiden 3 ay üst üste fatura aldıysa ama bu ay almadıysa bana uyarı ver."

---

## 2. Neden Bu Yaklaşım

CodeWords gibi dış araçlara gitmek yerine portalın içine yapmanın üç sağlam gerekçesi var.

**Domain bilgisi.** "KDV beyannamesi geciken müvekkiller" dediğinde sistem hangi tabloya bakacağını biliyor — çünkü Prisma şeması senin. CodeWords için bu jenerik kavramlar; Moren için doğrudan SQL.

**Veri egemenliği.** Müvekkil verisi (TC, VKN, fatura, banka hareketleri) Anthropic API'ye sadece **otomasyon kurulurken** ve sadece **yapı bilgisi** olarak gider. Çalışma zamanında veri tamamen senin sunucunda işlenir. KVKK uyumu net.

**Mevcut altyapı zaten %70 hazır.** Bunu az önce kodunda gördüm — sıradaki bölüm bunu özetliyor.

---

## 3. Mevcut Altyapıdan Yararlanılacak Parçalar

| Bileşen | Konum | Otomasyon motorunda rolü |
|---|---|---|
| **Moren AI tools** (38 adet) | `apps/api/src/moren-ai/tools.ts` | Atomik aksiyon kataloğu — neredeyse hazır |
| **Tool executor** | `apps/api/src/moren-ai/tool-executor.service.ts` | Aksiyonları çalıştıran motor — yeniden kullanılacak |
| **Schedule modülü** | `apps/api/src/schedule/` (`reminder.cron.ts`, `hgs.cron.ts`) | Cron pattern referansı |
| **Bull kuyruk** | `@nestjs/bull`, `ioredis` (zaten kurulu) | Olay tetikli akışların kuyruk altyapısı |
| **Portal automation** | `apps/api/src/portal-automation/` | Tetikleyici/job tasarım deseni referansı |
| **WhatsApp servisi** | `apps/api/src/whatsapp/whatsapp.service.ts` | Mesaj gönderme aksiyonu |
| **Notifications** | `apps/api/src/notifications/` | E-posta / push aksiyonları |
| **OCR pipeline** | Azure Computer Vision + Tesseract (api dependencies) | Belge okuma aksiyonu |
| **Luca servis** | `apps/api/src/luca/luca.service.ts` | Muhasebe kaydı aksiyonu |
| **Prisma + PostgreSQL** | `apps/api/prisma/schema.prisma` | Otomasyon tanımlarının kalıcı depolama |
| **Next.js 14 + React** | `apps/web/` | Otomasyon UI'larının yaşayacağı yer |
| **Vendor memory** | `apps/api/src/vendor-memory/` | "Tedarikçi alışkanlığı" gibi analitik tetikleyiciler için |

**Sonuç:** Sıfırdan inşa edilen şey aslında çok az — bir orkestrasyon katmanı ve UI.

---

## 4. Mimari (Üst Düzey)

```
┌─────────────────────────────────────────────────────────────┐
│                    apps/web (Next.js 14)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Yeni Otomas. │  │ Otomasyonlar │  │ Detay & Loglar   │   │
│  │ (cümle gir)  │  │ (liste sayfa)│  │ (geçmiş + edit)  │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │ POST /api/automations              │
          ▼                                    │
┌─────────────────────────────────────────────────────────────┐
│             apps/api (NestJS) — automations module           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  AutomationParserService                             │    │
│  │  cümle → Claude API (tool-use) → workflow JSON       │    │
│  │  (önizleme aşamasında müvekkil verisi GÖNDERİLMEZ)   │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                   │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │  AutomationRegistryService                           │    │
│  │  CRUD: oluştur, listele, düzenle, sil, duraklat      │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                   │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │  AutomationRunnerService                             │    │
│  │  - Cron trigger'ları @nestjs/schedule'a register     │    │
│  │  - Olay trigger'ları Bull queue listener olarak      │    │
│  │  - Webhook trigger'ları HTTP endpoint olarak         │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                   │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │  Mevcut moren-ai/tool-executor.service.ts            │    │
│  │  (38 atomik aksiyon — TEKRAR KULLAN)                 │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                   │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │  Mevcut domain servisleri                            │    │
│  │  whatsapp / notifications / luca / mizan / OCR / ... │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                  PostgreSQL (Prisma)
                  Redis (Bull jobs)
                  S3 (belge ekleri)
```

---

## 5. Veri Modeli (Prisma Şema Önerisi)

`apps/api/prisma/schema.prisma`'ya eklenecek modeller:

```prisma
model Automation {
  id              String   @id @default(cuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  createdById     String
  createdBy       User     @relation(fields: [createdById], references: [id])

  // Kullanıcının yazdığı orijinal cümle
  prompt          String   @db.Text

  // Moren AI'nın cümleden çıkardığı insan-okur özet
  title           String   // örn. "KDV gecikenler için aylık WhatsApp hatırlatma"
  description     String?  @db.Text

  // Tetikleyici tipi
  triggerType     AutomationTriggerType  // CRON | EVENT | WEBHOOK | MANUAL
  triggerConfig   Json                    // cron expr / event name / webhook secret

  // Aksiyon adımları (sıralı liste)
  steps           Json     // [{ tool: "list_taxpayers", args: {...} }, ...]

  // Durum yönetimi
  status          AutomationStatus  // DRAFT | ACTIVE | PAUSED | ERROR | ARCHIVED
  lastRunAt       DateTime?
  lastRunStatus   String?  // "success" | "failure" | "partial"
  nextRunAt       DateTime?
  totalRuns       Int      @default(0)
  successRuns     Int      @default(0)
  failureRuns     Int      @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  runs            AutomationRun[]

  @@index([tenantId, status])
  @@index([nextRunAt])
}

enum AutomationTriggerType {
  CRON
  EVENT
  WEBHOOK
  MANUAL
}

enum AutomationStatus {
  DRAFT
  ACTIVE
  PAUSED
  ERROR
  ARCHIVED
}

model AutomationRun {
  id              String   @id @default(cuid())
  automationId    String
  automation      Automation @relation(fields: [automationId], references: [id], onDelete: Cascade)

  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  status          String   // "running" | "success" | "failure" | "partial"

  // Adım adım yürütme logu
  stepLogs        Json     // [{ step: 0, tool: "...", input: {...}, output: {...}, error: null, ms: 1240 }, ...]

  // Özet (kullanıcının listede göreceği)
  summary         String?  // örn. "12 müvekkile mesaj atıldı, 0 hata"
  errorMessage    String?  @db.Text

  @@index([automationId, startedAt])
}
```

İlave değişiklik: `User` modeline `automations Automation[]`, `Tenant` modeline `automations Automation[]` ilişkileri eklenir.

---

## 6. Atomik Aksiyon Kataloğu

Mevcut `moren-ai/tools.ts`'te 38 tool zaten var. Otomasyon motoru bunları doğrudan kullanır. Kategori bazında özet:

**Mevcut (kullanıma hazır):**
- Mükellef: `list_taxpayers`, `get_taxpayer`, `list_taxpayers_monthly_status`
- Mizan: `list_mizan_periods`, ... (mevcut tool'lar)
- Beyanname/KDV: mevcut tool'lar
- Fatura: mevcut tool'lar
- Vendor memory: mevcut tool'lar

**Otomasyon motoru için eklenecek YENİ aksiyonlar:**

| İsim | Açıklama | Tetikleyici/Aksiyon |
|---|---|---|
| `send_whatsapp_template` | Şablon WhatsApp mesajı at | Aksiyon |
| `send_whatsapp_freeform` | Serbest metin WhatsApp at | Aksiyon |
| `send_email` | Nodemailer üzerinden e-posta | Aksiyon |
| `send_sms` | SMS gönder | Aksiyon |
| `create_pending_action` | Sana bildirim/yapılacaklar listesine ekle | Aksiyon |
| `ocr_pdf` | PDF'i OCR'la, yapısal çıktı ver | Aksiyon |
| `extract_invoice_fields` | OCR çıktısından fatura alanları | Aksiyon |
| `post_to_luca` | Luca'ya muhasebe kaydı at | Aksiyon |
| `summarize_with_claude` | Bir metni Claude ile özetle | Aksiyon |
| `check_official_gazette` | Resmi Gazete RSS tara, KDV/SGK ilgili | Tetikleyici/Aksiyon |
| `on_document_uploaded` | Müvekkil belge yüklediğinde tetiklen | Tetikleyici (event) |
| `on_whatsapp_received` | WhatsApp mesajı alındığında tetiklen | Tetikleyici (event) |
| `on_beyanname_status_changed` | Beyanname durumu değiştiğinde | Tetikleyici (event) |
| `schedule_cron` | Belirli cron'da çalış | Tetikleyici |
| `wait` | Akış içinde N gün/saat bekle | Akış kontrolü |
| `branch_if` | Koşullu dallanma | Akış kontrolü |
| `for_each` | Listede her eleman için tekrarla | Akış kontrolü |

**Dikkat:** Aksiyonlar mevcut servisleri **ince bir sarmalama** ile kullanır — yeniden iş mantığı yazılmaz. Örn. `post_to_luca` aksiyonu zaten var olan `LucaService.postEntry()` metodunu çağırır.

---

## 7. Doğal Dil → Workflow JSON Akışı

Bu motorun "sihirli" kısmı. Akış adımları:

**Adım 1 — Kullanıcı cümle yazar.** Web UI'da `Yeni Otomasyon` sayfasında textarea'ya yazar, "Önizle" der.

**Adım 2 — Cümle backend'e gider.** `POST /api/automations/parse` endpoint'ine.

**Adım 3 — AutomationParserService Claude API'yi çağırır.**

Çağrıda:
- **System prompt:** Mali müşavirlik domain'ini bilen, mevcut atomik aksiyon kataloğunu bilen bir orkestratör persona'sı.
- **Tools:** Mevcut 38 + yeni eklenenler — toplam ~50 atomik aksiyon, Anthropic tool-use formatında.
- **Strict output schema:** Claude bir `propose_automation` meta-tool'unu çağırarak workflow tanımını döner. Schema:

```json
{
  "title": "string (Türkçe, kısa)",
  "description": "string (Türkçe, kullanıcıya gösterilecek özet)",
  "trigger": {
    "type": "CRON" | "EVENT" | "WEBHOOK" | "MANUAL",
    "config": { ... }
  },
  "steps": [
    {
      "id": "step_1",
      "tool": "list_taxpayers_monthly_status",
      "args": { "period": "{{currentMonth}}", "beyannameDurumu": "verilmedi" },
      "outputAs": "gecikenler"
    },
    {
      "id": "step_2",
      "tool": "for_each",
      "args": { "list": "{{gecikenler}}", "as": "mukellef" },
      "steps": [
        {
          "id": "step_2_1",
          "tool": "send_whatsapp_template",
          "args": { "to": "{{mukellef.phone}}", "template": "kdv_hatirlatma", "vars": { "ad": "{{mukellef.unvan}}" } }
        }
      ]
    },
    {
      "id": "step_3",
      "tool": "send_email",
      "args": {
        "to": "{{currentUser.email}}",
        "subject": "KDV gecikenler raporu",
        "body": "Bu sabah {{gecikenler.length}} müvekkile hatırlatma atıldı."
      }
    }
  ]
}
```

**Adım 4 — Önizleme.** UI bu JSON'u kullanıcıya **insan diliyle** geri çevirir:

> Şu otomasyonu kuracağım:
> **"KDV gecikenler için aylık WhatsApp hatırlatma"**
>
> ⏰ Her ayın 22'sinde sabah 10:00'da çalışacak.
>
> 1. KDV beyannamesi verilmemiş müvekkillerin listesini alacağım.
> 2. Her birine WhatsApp'tan şu mesajı atacağım: *"Sayın [Ünvan], [Dönem] KDV beyannameniz henüz verilmemiştir. Lütfen evraklarınızı en kısa sürede gönderin."*
> 3. Sonra size özet bir e-posta atacağım.
>
> Onaylıyor musun? [✓ Kur ve Aktif Et] [✏️ Düzenle] [✗ İptal]

**Adım 5 — Onay & kayıt.** Onaylanırsa `Automation` kaydı DB'ye yazılır, `AutomationRunnerService` cron/event listener'ını register eder.

**Adım 6 — Düzenleme.** "Düzenle" derse kullanıcı cümleyi değiştirip yeniden önizleyebilir; ya da JSON adımlarını manuel düzenleyebilir (ileri kullanıcılar için).

---

## 8. UI Tasarımı

`apps/web` içine **üç yeni sayfa** + bir giriş noktası eklenir.

### 8.1 Otomasyonlarım (liste sayfası) — `/otomasyonlar`

**Bu senin ısrarla sorduğun sayfa.** Ana hub.

Liste başlıkları:

| Ad | Tetik | Son Çalışma | Durum | Toplam | Başarı | Sonraki | Eylem |
|---|---|---|---|---|---|---|---|
| KDV gecikenler için aylık hatırlatma | 🕐 Her ayın 22'si | 22 Nis 10:01 ✓ | 🟢 Aktif | 4 | 4 | 22 May 10:00 | [Detay] [Duraklat] |
| WhatsApp'tan gelen faturayı Luca'ya at | 📨 WhatsApp olayı | 19 May 14:32 ✓ | 🟢 Aktif | 127 | 124 | — | [Detay] [Duraklat] |
| Resmi Gazete KDV takibi | 🕐 Günlük 08:00 | 20 May 08:00 ✓ | 🟢 Aktif | 41 | 41 | 21 May 08:00 | [Detay] [Duraklat] |
| Tedarikçi atlamış uyarısı | 📅 Aylık 1. günü | 1 May 09:15 ⚠️ | 🟡 Hata var | 3 | 2 | 1 Haz 09:15 | [Detay] [Düzelt] |

Üst kısımda **[+ Yeni Otomasyon]** butonu.

Filtreler: Durum (Aktif / Duraklatılmış / Hatalı / Tüm), Tetik tipi, Arama.

### 8.2 Yeni Otomasyon — `/otomasyonlar/yeni`

İki bölmeli sayfa:

**Sol bölme:**
- Büyük bir textarea: *"Ne yapmasını istiyorsun? Türkçe yaz."*
- Örnek cümleler (üstte) — tıklayınca textarea'ya kopyalanır.
- "Önizle" butonu.

**Sağ bölme (önizleme açıldığında):**
- Moren AI'nın ürettiği insan-okur açıklama.
- "Bu doğru mu?" → [Kur ve Aktif Et] [Cümleyi Düzenle] [Adımları Manuel Düzenle (gelişmiş)]

### 8.3 Otomasyon Detay — `/otomasyonlar/[id]`

- Üstte: ad, durum, "Şimdi Çalıştır", "Duraklat", "Düzenle", "Sil".
- Sekme: **Tanım** → orijinal cümle + adım adım workflow.
- Sekme: **Çalışma Geçmişi** → son N run, her birinde başarılı/başarısız, süre, özet.
- Sekme: **Loglar** → seçili run'ın adım adım iç dökümü (hangi tool, input/output, hata mesajı).
- Sekme: **Ayarlar** → bildirim tercihleri, sahip, etiketler.

### 8.4 Mevcut UI'a Bağlantı

- Sol menüye yeni satır: **"Otomasyonlar"** (ikon: 🤖 veya ⚡).
- Ana dashboard'a küçük bir kart: "Aktif Otomasyonlar: 4 | Bu hafta çalıştı: 38 | Hata: 1".
- Müvekkil detay sayfasında: "Bu müvekkille ilgili otomasyonlar" kutusu.

---

## 9. Çalıştırıcı Motor — AutomationRunnerService

NestJS module. Üç tetikleyici tipini yönetir.

**Cron tetikleyiciler:**
- Uygulama başlangıcında DB'den tüm `ACTIVE` + `triggerType=CRON` otomasyonlar okunur.
- Her biri için `@nestjs/schedule`'a dinamik cron job register edilir.
- DB değişikliğinde (yeni/düzenleme/silme) listener'lar reload edilir.

**Event tetikleyiciler:**
- Bull queue üzerinden domain event'leri yayınlanır (zaten `agent-events` modülü var, ondan yararlanılır).
- Örn. `WhatsApp.MessageReceived`, `Document.Uploaded`, `Beyanname.StatusChanged`.
- `AutomationRunnerService` her event tipini dinler, ilgili otomasyonları sorgular ve çalıştırır.

**Webhook tetikleyiciler:**
- `POST /api/automations/webhook/:secret` endpoint'i.
- Secret'ı doğrular, ilgili otomasyonu bulur, ödenmeyi başlatır.

**Yürütme döngüsü (her run için):**

```typescript
async function executeAutomation(automation: Automation, triggerPayload: any) {
  const run = await createAutomationRun(automation.id);
  const context = { trigger: triggerPayload, currentUser: ..., now: new Date() };
  const outputs: Record<string, any> = {};

  try {
    for (const step of automation.steps) {
      const resolvedArgs = resolveTemplates(step.args, context, outputs);
      const result = await toolExecutor.execute(step.tool, resolvedArgs);
      outputs[step.outputAs ?? step.id] = result;
      await appendStepLog(run.id, step.id, result);
    }
    await markRunSuccess(run.id, summarize(outputs));
  } catch (err) {
    await markRunFailure(run.id, err);
    if (automation.failurePolicy === 'pause_after_3_failures') { ... }
    notifyOwner(automation, err);
  }
}
```

`for_each`, `branch_if`, `wait` gibi akış kontrol tool'ları bu döngüde özel davranır.

---

## 10. Hata Yönetimi & Gözlemlenebilirlik

**Adım bazlı hata kaydı.** Her step'in input'u, output'u, süre ve hatası `AutomationRun.stepLogs` JSON'una yazılır.

**Otomatik retry.** Belirli hata tipleri için (network, 5xx) Bull'un built-in retry mekanizması (3 deneme, üstel backoff).

**Hata politikası.** Otomasyon başına ayarlanabilir:
- "İlk hatada beni uyandır."
- "3 başarısız üst üste run'dan sonra otomasyonu duraklat."
- "Hatayı yok say, devam et."

**Bildirim.** Hata olduğunda kullanıcıya in-app bildirim + isteğe bağlı WhatsApp/e-posta.

**Audit.** Mevcut `AuditLog` modeli kullanılır — kim ne zaman otomasyon oluşturdu/sildi/değiştirdi.

---

## 11. KVKK & Güvenlik

**Cümle parse'ında veri sızıntısı yok.** Anthropic'e gönderilen system prompt + kullanıcı cümlesi domain bilgisi içerir ama **gerçek müvekkil verisi içermez**. Müvekkil tablo şeması Claude'a açıklanır ("`list_taxpayers` tool'u şu alanları döner"), fakat müvekkil kayıtları gönderilmez.

**Çalışma zamanı Claude çağrıları.** Bazı aksiyonlar (örn. `summarize_with_claude`, `extract_invoice_fields`) çalışırken Claude'a veri gönderir. Bu çağrılar için:
- Aksiyon başına KVKK risk seviyesi etiketi (low/medium/high).
- Otomasyon önizlemesinde kullanıcıya gösterilir: *"Bu otomasyon fatura içeriklerini Anthropic API'sine gönderir."*
- İsteğe bağlı: ileride yerel LLM (Ollama vs.) opsiyonu — şimdilik kapsam dışı.

**API anahtarları.** Tenant başına Anthropic API key (opsiyonel, varsayılan tenant-wide). Mevcut `.env` deseni kullanılır.

**Tenant izolasyonu.** Tüm sorgular `tenantId` filtreli — multi-tenant mantığın zaten kurulu.

**RBAC.** Otomasyon oluşturma/düzenleme/silme yetkileri `UserRole` üzerinden kontrol edilir. Varsayılan: sadece tenant admin ve Mali Müşavir rolü oluşturabilir.

---

## 12. Faz Faz Uygulama Planı

**Faz 0 — Hazırlık (1-2 gün)**
- Plan onayı (bu doküman).
- `feature/otomasyon-motoru` branch.
- Yeni modül iskeleti: `apps/api/src/automations/`.

**Faz 1 — Veri katmanı + temel CRUD (3-4 gün)**
- Prisma migration: `Automation`, `AutomationRun`.
- NestJS module + service + controller (CRUD endpoints).
- Tenant + RBAC entegrasyonu.
- Birim testler.

**Faz 2 — Cümle parser + önizleme (3-4 gün)**
- `AutomationParserService` (Claude API + tool-use).
- Mevcut 38 tool'u parser'a aksiyon kataloğu olarak besle.
- Yeni meta-aksiyonlar (`for_each`, `branch_if`, `wait`) tanımla.
- `POST /api/automations/parse` endpoint'i.
- Frontend `/otomasyonlar/yeni` sayfası (textarea + önizleme).

**Faz 3 — Cron motoru (3-4 gün)**
- `AutomationRunnerService` cron bölümü.
- Dinamik cron register/unregister.
- `executeAutomation` ana döngüsü + template resolver.
- Mevcut `tool-executor.service.ts`'i otomasyon motorundan çağırabilir hale getir.
- İlk uçtan uca canlı test: "Her gün 09:00'da bana hatırlat" otomasyonu.

**Faz 4 — Liste sayfası + çalışma geçmişi (2-3 gün)**
- `/otomasyonlar` liste sayfası.
- `/otomasyonlar/[id]` detay + log sekmeleri.
- Duraklat/aktive et/sil.

**Faz 5 — Event tetikleyiciler (3-4 gün)**
- Mevcut `agent-events` modülü ile entegrasyon.
- WhatsApp, belge yükleme, beyanname durumu event'leri.
- Event tetikli ilk gerçek senaryo: "WhatsApp'tan PDF gelirse OCR + Luca'ya at."

**Faz 6 — OCR + Luca aksiyonları (3-4 gün)**
- `ocr_pdf`, `extract_invoice_fields`, `post_to_luca` aksiyonlarını otomasyon kataloğuna ekle.
- Mevcut servisleri çağıracak ince sarmalama.
- KVKK risk etiketleri.
- Uçtan uca test.

**Faz 7 — Resmi Gazete tetikleyicisi (2-3 gün)**
- RSS scraper job.
- `check_official_gazette` aksiyonu.
- Claude ile özetleme + müvekkil sektör eşleştirme.

**Faz 8 — Polish + dokümantasyon (3-5 gün)**
- Hata politikaları UI'da ayarlanabilir.
- Webhook tetikleyici.
- Audit log entegrasyonu.
- Kullanıcı kılavuzu (örnek cümle kütüphanesi).
- KVKK uyarı yazıları.

**Toplam tahmin: 4-6 hafta odaklanmış çalışma.**

İlk kullanılabilir sürüm (Faz 4 sonu): **~2 hafta.** Bu noktada cron tabanlı otomasyonlar + WhatsApp/e-posta aksiyonları + liste UI'ı çalışıyor olur — günlük işine zaten gerçek değer verir.

---

## 13. Açık Sorular & Riskler

**1. Claude API maliyeti.**
Her cümle parse'ı bir Claude çağrısıdır (Sonnet 4.6 ile yaklaşık 0.01-0.03 USD/parse). Çalışma zamanı çağrıları (özetleme, OCR ekstraksiyon) ayrıca maliyetli. Aylık tahmin: ofis büyüklüğüne göre 30-100 USD arası — CodeWords'ün abonelik bedelinin çok altında ama izlenmesi gerekiyor. Çözüm: dashboard'da maliyet göstergesi.

**2. Workflow JSON şema evrimi.**
İlk sürümde JSON şeması dondurulmamalı — yeni aksiyon tipleri eklendikçe migration gerekir. Çözüm: JSON şeması versiyonlu (`schemaVersion: 1`), eski tanımlar yeni runner ile uyumlu kalır.

**3. "Beklenmedik" cümleler.**
Kullanıcı "yarın hava nasıl olacak" derse Moren AI ne der? Çözüm: parser bir aksiyon önerisi üretemezse insan-okur bir hata mesajı döner — *"Bu cümlede mevcut araçlarımla yapabileceğim bir otomasyon göremedim. Şöyle örnekler verebilir misiniz: ..."*

**4. Çakışan tetikleyiciler.**
Aynı event'i 10 otomasyon dinliyorsa ve hepsi WhatsApp atıyorsa müvekkil 10 mesaj alır. Çözüm: tetikleyici dedup ve rate-limit kuralları (Bull'un built-in concurrency control'üyle).

**5. Domain'in dışına çıkma riski.**
Kullanıcı "müvekkilin VKN'ini sosyal medyada ara" derse Moren AI bunu yapmamalı (KVKK + scope creep). Çözüm: aksiyon kataloğu kapalı bir set — parser sadece tanımlı tool'ları seçebilir, dışına çıkamaz.

**6. Test edilebilirlik.**
"Aylık çalışan" bir otomasyonu nasıl test edersin? Çözüm: her otomasyonda "Şimdi Çalıştır (dry-run)" butonu — gerçek aksiyonlar yerine simüle eder, ne yapacağını gösterir.

**7. Geri uyumluluk.**
Aksiyon kataloğu evrildikçe (örn. `send_whatsapp_template` parametresi değişti), eski otomasyonlar nasıl davranır? Çözüm: aksiyon versiyonlama + migration script'leri.

---

## 14. Sıradaki Karar

Bu plan onaylandıktan sonra **Faz 0 + Faz 1** ile başlanır. Yani:

1. `feature/otomasyon-motoru` branch'i açılır.
2. `apps/api/src/automations/` iskeleti kurulur.
3. Prisma migration yazılır ve uygulanır.
4. Temel CRUD endpoint'leri + basit liste sayfası iskeleti.

Bu **3-4 günlük** ilk paket bittiğinde elinde:
- Veritabanında otomasyon kaydı yapabilen API.
- Boş ama gezilebilir bir "Otomasyonlarım" sayfası.
- Sonraki adım için sağlam temel.

---

**Son söz:** Bu plan senin sahip olduğun altyapı üzerine inşa edilmiş. CodeWords'ün sana satmaya çalıştığı şeyin **senin domain'ine özelleşmiş, verisi senin elinde kalan, kendi kontrolünde olan** bir versiyonu. Üstelik %70'i zaten kodunda.

Onay verdiğinde Faz 0'dan başlayalım.
