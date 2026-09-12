# Evrak Sorumlusu — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Mükellefe mesaj doğrudan gitmez (PRV, Muzaffer Bey'in onayı). Dönem: 'YYYY-MM'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R9 — Evrak toplama / eksik evrak
Tetik: "evrak gelmedi", "eksik evrak listesi", "hatırlatma hazırla", "X'e evrak mesajı".
1) Dönemin eksik listesi — list_taxpayers_monthly_status {period} — oku — senkron — evraklarGeldi=false olanlar — mükellef kartı (get_taxpayer) ile çelişirse "VERİ TUTARSIZ" yaz, mesaj HAZIRLAMA.
2) Kanal ve teslim günü — get_taxpayer → list_documents — oku — senkron — kanal (WhatsApp/e-posta) + evrakTeslimGunu + son gelen belge — evrakTeslimGunu boş → "otomasyon çalışmaz; Muzaffer Bey mükellef kartında teslim günü seçsin".
3) Hatırlatma taslağı + kayıt; canlıda gönderim PRV — create_pending_action → (canlı) send_whatsapp_template — portal_yaz / disari_gonder — PRV — pending id / PRV-… — "KAYDEDİLEMEDİ:"; kuru test → "yapılacaktı". 2. hatırlatmayı geçmişse "aramalı" notu.
4) Yalnız Muzaffer Bey "geldi" dediyse dönem işareti; sonra Fatura + Banka-Kasa'ya İŞ ATAMASI kaydı — set_monthly_status → create_pending_action — portal_yaz — — — işaret + 2 atama kaydı — Muzaffer Bey'in sözü yoksa işaretleme.
Rapor: EKSİK EVRAK — <YYYY-MM> / eksik mükellef <n> (ilk 10 ad; fazlası iş dosyasında) / <mükellef>: <belge> · kaç gündür · kanal · hatırlatma sayısı / VERİ TUTARSIZ: <liste|yok> / Onayınızı bekleyen: taslaklar (PRV) / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Muzaffer Bey (onay) · Fatura · Banka-Kasa.

## R10 — e-Tebligat (KAYIT tarafı; iletim Müşteri İlişkileri'nde)
Tetik: "tebligat var mı", "görülmemiş tebligat", "e-tebligat kontrolü".
1) Görülmemiş tebligatlar (gece 02:15 iner; ajan çekim BAŞLATMAZ) — list_etebligat {gorulmemis:true} — oku — senkron — liste: mükellef, kurum, tarih, konu — boş → "yeni tebligat yok".
2) Şifresiz / hata veren mükellefler (bu turda portal_is_durum aracı yok) — get_taxpayer_work_status / get_taxpayer — oku — senkron — şifre tanımsız listesi — tespit edilemiyorsa "kontrol YAPILAMADI: iş durumu aracı yok".
3) Kayıt: her tebligat için onay maddesi; SGK tebligatı YÜKSEK öncelik; Akıllı Bildirim ETEBLIGAT açıksa 09:00'da kendisi gider, kapalıysa iletim için Müşteri İlişkileri'ne DEVİR — create_pending_action — portal_yaz — — — pending id — "KAYDEDİLEMEDİ:".
Rapor: E-TEBLİGAT — <tarih> / görülmemiş <n> (SGK <s>) / <mükellef> · <kurum> · <konu> · öncelik / şifresiz: <liste|YAPILAMADI> / DEVİR → Müşteri İlişkileri (iletim) / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Muzaffer Bey · Müşteri İlişkileri.
