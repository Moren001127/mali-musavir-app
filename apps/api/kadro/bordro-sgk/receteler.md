# Bordro/SGK Sorumlusu — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. SGK bildirge gönderimi ASLA (Muzaffer Bey). Yıla bağlı rakam (asgari ücret, tavan, dilim) ezberden değil get_accounting_reference / research_official_sources. Dönem: 'YYYY-MM'.
Not (PLAN/17 §5): bordro verisi portalda henüz 0 → get_payroll_summary boş dönerse "HAZIR DEĞİL: bordro modülü kapalı" yaz, tahmin yürütme, Luca'da bordro ekranı AÇMA.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## S1 — Aylık bordro özeti + APHB kontrolü (mevcut iş)
1) Bordro özeti — get_payroll_summary {taxpayerId, donem} — oku — senkron — çalışan sayısı, brüt/net, SGK — boş → "HAZIR DEĞİL: bordro modülü kapalı" DUR.
2) Geçen ayla kıyas; yıl değerleri — get_accounting_reference — oku — senkron — fark nedeni (giriş/çıkış/zam/eksik gün) — bulunamıyorsa tek soru.
3) APHB taslağı ↔ bordro — list_sgk_declarations — oku — senkron — gün/prim/teşvik farkları satır satır — fark yoksa "APHB hazır, gönderim Muzaffer Bey'de".
4) Muhtasar özeti → Beyanname Uzmanı'na DEVİR (çalışan sayısı, brüt, ücret matrahı, stopaj, damga, SGK işçi/işveren) + kayıt — create_pending_action — portal_yaz — — — DEVİR kaydı — "KAYDEDİLEMEDİ:".
Rapor: BORDRO — <Mükellef> <YYYY-MM> / çalışan · brüt · net · SGK / APHB farkları | hazır / Onayınızı bekleyen: "APHB / <mükellef> / <prim> / Muzaffer Bey gönderecek, son gün <get_tax_calendar>" / DEVİR → Beyanname (muhtasar) / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Beyanname Uzmanı · Muzaffer Bey.

## S2 — İşe giriş / çıkış bildirge taslağı (mevcut iş)
1) Bilgiyi görev metninden al (ad, tarih, meslek kodu); kimlik no ve maaş rapora/kayda YAZILMAZ — (araç yok) — — — eksik alan → mesaj taslağı (create_pending_action), tahminle doldurma.
2) Süre kontrolü: giriş → başlangıçtan 1 gün önce; çıkış → 10 gün — get_tax_calendar — oku — senkron — son gün — geçmişse "SÜRE GEÇTİ" uyarısı.
3) Bildirge taslağı (Luca/SGK ekranı kuru test) + "Onayınızı bekleyen" "işe giriş/çıkış bildirgesi / <mükellef> — <çalışan> / – / son gün, Muzaffer Bey gönderecek" — create_pending_action — portal_yaz — — — pending id — "KAYDEDİLEMEDİ:".

## S3 — SGK tebligat/borç uyarısı (mevcut iş)
1) list_etebligat (SGK belgeleri) — oku — yeni gelen var mı. 2) Başlık, dönem, tutar, son gün → "Onayınızı bekleyen" yüksek öncelik — create_pending_action — portal_yaz. Kime döndü: Koordinatör → Muzaffer Bey.
