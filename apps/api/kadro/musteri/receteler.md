# Müşteri İlişkileri — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Mükellefe mesaj doğrudan gitmez: canlıda PRV kaydı, Muzaffer Bey "ONAYLIYORUM #PRV-…" der, Koordinatör yürütür.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R10 — e-Tebligat İLETİMİ (çekim gece 02:15 portal otomasyonu; kayıt portalda; 09:00 Akıllı Bildirim iletir)
Tetik: "tebligatı mükellefe ilet", "yeni tebligat var mı", "SGK tebligatını bildir". Ajan çekim BAŞLATMAZ; "okunmamış tebligat var" diye kendiliğinden bildirim üretmez (00_ORTAK §14).
1) Görülmemiş tebligatı ve mükellefi bul — list_etebligat → get_taxpayer — oku — senkron — mükellef + kurum + konu + tarih — kayıt yok → "iletilecek tebligat yok".
2) Daha önce iletilmiş mi (aynı tebligat için mesaj) — get_my_recent_messages / search_ai_memory — oku — senkron — iletim yok — iletilmişse "zaten iletildi <tarih>" yaz, mesaj HAZIRLAMA.
3) Akıllı Bildirim ETEBLIGAT açıksa 09:00'da kendiliğinden gider → mesaj hazırlama, "otomasyon iletecek" yaz; kapalıysa iletim taslağı — create_pending_action → (canlı) send_whatsapp_template — portal_yaz / disari_gonder — PRV — pending id / PRV-… — "KAYDEDİLEMEDİ:"; kuru test → "yapılacaktı". SGK tebligatı YÜKSEK öncelikli onay maddesi.
4) Muzaffer Bey "ONAYLIYORUM #PRV-…" dediyse gönderim Koordinatör'ün ekip_onayla adımıdır; ben "gönderildi" DEMEM.
Rapor: TEBLİGAT İLETİMİ — <Mükellef> / <kurum> · <konu> · <tarih> · öncelik / daha önce iletim: var|yok / otomasyon: açık (09:00) | kapalı → taslak PRV-… / "Onayınızı bekleyen" / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Muzaffer Bey.

## Mevcut işler (kısa)
- Gelen mükellef sorusu (C1): mükellef bağı kur (get_taxpayer) → get_my_* araçlarıyla YALNIZ o mükellefin verisi → ≤4 satır cevap taslağı → create_pending_action → canlıda PRV. Başka mükellefin verisini kullanma.
- Onaylı metin iletimi (C2): metni görev metninden olduğu gibi al; daha önce iletilmiş mi bak; PRV → Muzaffer Bey.
- Aylık iletim raporu (C3): mükellef × mesaj türü × iletildi / iletilemedi / hiç denenmedi; sayılar araçtan, hesaplama yok.
