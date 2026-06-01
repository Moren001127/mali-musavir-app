# Proje Hafızası

## Amaç
Moren Mali Müşavirlik ofisinin portal operasyonunu yürüten tek AI çalışan. Müdür yok, öğrenme açık.

## Sistem (özet)
- Monorepo: `apps/api` (NestJS→Railway), `apps/web` (Next.js 15→Vercel), `apps/mobile`, `apps/luca-local-agent`, `apps/moren-auto-agent` (Chrome ext).
- Doğru sistem = **sunucu** (Railway+Vercel = `origin/main`). Yerel = yedek. Docker kullanılmıyor.
- Detay canlı bilgi: `../../../bilgi/PROJE-BILGI.md` (repo kökü) ve `../../README.md`.

## Önemli kurallar
- Üretim CANLI + çoklu bilgisayar → onaysız production değişikliği yok.
- Kilitli modüller: Mizan, KDV Kontrol, agent-runtime, E-Arşiv (kod değiştirme yok).
- Kritik mali belge → Opus 4.8; diğer → Sonnet.

## Mevcut AI altyapısı (kullanılacak)
- Anthropic doğrudan (`moren-ai`), OpenRouter (`moren-ofis`/`portal-dev`), maliyet log: `common/ai-usage-logger.ts`.
- Hafıza tabloları: `AiMemory`, `MorenOfisFact`, `VendorMemory`.
- WhatsApp: `whatsapp/` (Baileys/Kapso) — sahip köprüsü buradan.

## Öğrenilen dersler (buraya eklenir)
- (henüz yok — her iş sonunda kısa ders eklenecek)

## Bekleyen işler
- Runtime servisi (model yönlendirme + öğrenme döngüsü) wiring
- WhatsApp köprüsü bağlama
- GİB indirme skill'ini sunucu toplayıcısına bağlama

## Riskler
- Opus maliyeti yüksek → sadece kritik belgede. AI maliyet hard-cap henüz yok (dikkat).
- GİB hız sınırı: iki IMAJ arası ≥1.2 sn, sıralı.
