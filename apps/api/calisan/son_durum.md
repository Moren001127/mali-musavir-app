# Son Durum

## Bugünkü durum (2026-06-01)
- Tanım + runtime + WhatsApp köprüsü + **Max planı entegrasyonu** yazıldı, tsc temiz, guard'lar geçti. Deploy EDİLMEDİ.

## Tamamlananlar
- Ajan tanımı (`apps/api/calisan/`).
- Runtime (`src/calisan/`): `/run·model·ogren·info`.
- **AI çağrısı = Max aboneliği** (Claude Agent SDK + `CLAUDE_CODE_OAUTH_TOKEN`, izole env, **API key YOK**). Yerel doğrulandı (Opus/Sonnet seçilebiliyor, cevap geliyor).
- WhatsApp: owner mesajı → ajan (cevap MorenAI tool'larından, opsiyon a); müşteri botu + Kapso kapalı.

## DEPLOY EDİLDİ (2026-06-01, commit 9af6420)
- ✅ Railway'de canlı: `/api/v1/calisan/info` → 401 (route var, JWT korumalı). Build sorunsuz (SDK dahil), portal sağlam.
- ✅ `CLAUDE_CODE_OAUTH_TOKEN` Railway env'de (Max token, OAuth ile üretildi, yerelde doğrulandı). Owner phone zaten vardı.
- ✅ Yerel = origin/main = 9af6420 senkron.

## Açık 2 madde ÇÖZÜLDÜ (2026-06-01, ikinci oturum)
1. ✅ **Max çağrısının Railway canlı testi YAPILDI** — Railway ortam değişkenleriyle (`railway run`) ajanın yaptığı çağrının aynısı (SDK `query`, izole env, API key düşürülmüş) çalıştırıldı; Max'tan cevap geldi (`"calisiyorum"`), hata yok. Endpoint `/calisan/info` → 401 (sağlıklı). Runtime spawn'ı artık doğrulanmış.
2. ✅ **Token kalıcı yapıldı** — 8 saatlik OAuth access_token yerine, kullanıcı kendi terminalinde `claude setup-token` ile **uzun ömürlü** token (`sk-ant-oat01-…`, ~1 yıl) üretti; Railway `CLAUDE_CODE_OAUTH_TOKEN` bununla değiştirildi (redeploy onaylı). Otomatik yenileme koduna gerek kalmadı. Token süresi ~1 yıl sonra dolunca aynı adımla yenilenir.

## Sonraki
- GİB skill'ini toplayıcı akışına bağlama (şimdilik tanım yeterli).
- İstenirse owner WhatsApp'ı da tam Max'a (opsiyon b, tool kaybıyla).
