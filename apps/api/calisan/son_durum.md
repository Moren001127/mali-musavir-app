# Son Durum

## Bugünkü durum (2026-06-01)
- Tanım + runtime + WhatsApp köprüsü + **Max planı entegrasyonu** yazıldı, tsc temiz, guard'lar geçti. Deploy EDİLMEDİ.

## Tamamlananlar
- Ajan tanımı (`apps/api/calisan/`).
- Runtime (`src/calisan/`): `/run·model·ogren·info`.
- **AI çağrısı = Max aboneliği** (Claude Agent SDK + `CLAUDE_CODE_OAUTH_TOKEN`, izole env, **API key YOK**). Yerel doğrulandı (Opus/Sonnet seçilebiliyor, cevap geliyor).
- WhatsApp: owner mesajı → ajan (cevap MorenAI tool'larından, opsiyon a); müşteri botu + Kapso kapalı.

## Açık işler (deploy için)
1. **Muzaffer: `claude setup-token`** → token'ı ver (ajanın Max'a bağlanması için ŞART).
2. Railway env: `CLAUDE_CODE_OAUTH_TOKEN` (+ owner phone zaten yerelde).
3. Deploy → SDK'nın bundled binary'sinin Railway container'da çalıştığını DOĞRULA (tek gerçek deploy riski).
4. GİB skill'ini toplayıcı akışına bağlama (şimdilik skill tanımı yeterli).

## Dikkat
- Owner WhatsApp cevabı hâlâ MorenAI (API) — istenirse (b) ile tam Max'a alınır (tool kaybı).
- Deploy ÖNCESİ Muzaffer onayı.
