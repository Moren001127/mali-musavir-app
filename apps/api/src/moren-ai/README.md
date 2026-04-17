# Moren AI — Mali Müşavir Asistanı

Mükellef verilerini (mizan, bilanço, gelir tablosu, KDV, SGK, fatura) Claude Sonnet tool-use ile analiz eden profesyonel AI asistanı.

## Mimari

```
apps/api/src/moren-ai/
├── moren-ai.module.ts          NestJS modül
├── moren-ai.controller.ts      HTTP endpoint'ler (/api/v1/moren-ai/*)
├── moren-ai.service.ts         Claude orkestratör (tool-use döngüsü)
├── tools.ts                    15 tool tanımı (Claude'un göreceği)
├── tool-executor.service.ts    Prisma sorgularını çalıştırır (tenant-izole)
├── system-prompt.ts            Mali müşavir kimliği + çalışma prensipleri
├── voice.service.ts            Whisper (STT) + OpenAI TTS
└── README.md (bu dosya)
```

## Veritabanı

Yeni tablolar (migration: `20260417120000_moren_ai_conversations`):
- `ai_conversations` — thread başlıkları, token/maliyet totali
- `ai_messages` — tüm mesajlar + tool_calls/tool_results JSON

## Endpoint'ler

Tümü `JwtAuthGuard` ile korumalı, URL prefix: `/api/v1/moren-ai`:

- `GET /conversations` — konuşma listesi
- `GET /conversations/:id` — tek konuşma + mesajlar
- `DELETE /conversations/:id` — sil
- `PATCH /conversations/:id` — yeniden adlandır `{ title }`
- `POST /chat` — `{ conversationId?, message, taxpayerId?, voiceMode? }` → Claude cevabı + tool kullanımları
- `POST /voice/transcribe` — multipart `audio` dosyası → `{ text }`
- `POST /voice/speak` — `{ text, voice? }` → mp3 binary
- `POST /voice/chat` — multipart `audio` → STT → chat → (opsiyonel) TTS

## Environment Değişkenleri (Railway)

Zorunlu:
- `ANTHROPIC_API_KEY` — Claude API key (zaten var, başka modüller kullanıyor)

Opsiyonel (sesli konuşma için):
- `OPENAI_API_KEY` — Whisper + TTS için. Yoksa sesli giriş/çıkış devre dışı.

## Tool'lar (15 adet)

| Tool | Amaç |
|------|------|
| `list_taxpayers` | Mükellefleri arama/listele |
| `get_taxpayer` | Tek mükellef detayı (6 aylık durum dahil) |
| `list_mizan_periods` | Mükellefin mevcut mizan dönemleri |
| `get_mizan` | Dönem mizanı (hesap kodları + anomaliler) |
| `get_gelir_tablosu` | Gelir tablosu (TDHP) |
| `get_bilanco` | Bilanço (aktif/pasif + dengeli mi) |
| `get_kdv_summary` | KDV kontrol özeti (live + arşiv) |
| `list_invoices` | Fatura filtresi (tip/durum/tarih/tutar) |
| `get_payroll_summary` | Personel + bordro toplamları + SGK |
| `list_sgk_declarations` | APHB liste |
| `list_documents` | Evrak listesi (kategori filtresi) |
| `get_tax_calendar` | Yaklaşan beyanname + ödeme tarihleri |
| `compare_periods` | İki dönem kıyası (gelir tablosu/bilanço/mizan) |
| `calculate_financial_ratios` | Cari oran, ROE, ROA, kâr marjları + yorum |
| `search_all` | Mükellef + fatura + evrak genel arama |

## Maliyet

- Model: **claude-sonnet-4-6** (USD 3/1M input, USD 15/1M output)
- Tipik soru: 1-3 tool çağrısı + markdown cevap → ~$0.01-0.05 per soru
- Sistem prompt **cache_control: ephemeral** → 5 dakikalık cache ile tekrarlarda %90 tasarruf
- Konuşma başına kümüle token/maliyet DB'ye yazılır

## Sesli Mod

Frontend `/panel/moren-ai` sayfasında mikrofon butonu ile:
1. `MediaRecorder` ile ses kaydı (webm)
2. POST `/voice/transcribe` → Whisper → metin
3. Otomatik gönder + `voiceMode: true` → sistem prompt'u kısa cevap bekler (max 200 kelime)
4. TTS toggle açıksa cevabı mp3 olarak oynat (audio element)

## Frontend

`/panel/moren-ai` sayfası:
- Sol: konuşma geçmişi (rename/sil)
- Sağ: markdown cevaplı chat
- Mükellef seçimi (kontekst)
- Mikrofon + TTS toggle
- Tool kullanımı chip'leri (hangi tool çağrıldı görünür)
- Token/maliyet altbilgisi her cevapta
