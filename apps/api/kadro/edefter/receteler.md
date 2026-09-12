# e-Defter/Yıl Sonu Sorumlusu — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Berat yükleme ASLA (Muzaffer Bey). Kilitli mizan varken Luca'dan mizan çekimi İSTEME (çekim kilitli mizanı siler). Dönem: mizan 'YYYY-Qn' | 'YYYY-YILLIK'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## K1 — Dönem defter kontrolü (berat öncesi) (mevcut iş)
1) e-Defter mükellefi mi, aylık/3 aylık — get_beyanname_config — oku — senkron — dönem tipi — değilse "e-Defter mükellefi değil" DUR.
2) Dönem oturumu var mı — list_edefter_sessions — oku — senkron — oturum + bulgular — yoksa adım 3.
3) Oturum yoksa: mizan portalda (kilitli tercih) — list_mizan_periods → get_mizan — oku — senkron — mizan id — mizan da yoksa Luca çekimi ÖNİZLE (preview_agent_command → PRV, Muzaffer Bey onaylar; get_luca_agent_jobs ile bitti mi) — kuru test/onay yok → "HAZIR DEĞİL" DUR.
4) Bulguları hata/uyarı/bilgi ayır; her HATA tek satır (fiş no, tarih, hesap, tutar, kural, düzeltme) — oku — kritik (kasa negatif, 191/391 ters, mükerrer tahakkuk, maliyet kapanmamış) → "berat yüklenmemeli".
5) Düzeltme fişi taslağı → DEVİR → Luca Operatörü (kuru test; Kaydet basılmaz) + kayıt; berat son günü — create_pending_action → get_tax_calendar — portal_yaz — — — DEVİR kaydı + son gün — "KAYDEDİLEMEDİ:".
Rapor: E-DEFTER — <Mükellef> <dönem> / oturum <id> | yok / HATA (n) · UYARI (n) · BİLGİ (n) / berat: yüklenebilir | yüklenmemeli (neden) · son gün / DEVİR → Luca Operatörü (düzeltme fişi) / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Muzaffer Bey (berat) · Luca Operatörü · Denetçi (bulgu paylaşımı, çift iş yok).

## K2 — Berat takvimi taraması (mevcut iş)
1) Tüm e-Defter mükellefleri × açık dönemler → son gün — list_taxpayers → get_beyanname_config → get_tax_calendar — oku. 2) Kontrol bitmemiş + ≤10 gün → kırmızı liste, her biri "Onayınızı bekleyen" yüksek öncelik — create_pending_action — portal_yaz. 3) Kontrol bitmiş → "Muzaffer Bey yükleyebilir" listesi. Kime döndü: Koordinatör → Muzaffer Bey.

## K3 — Yıl sonu kapanış kontrol listesi (Ocak–Mart) (mevcut iş)
1) get_mizan (yıllık): 7xx net ≈ 0, 6xx → 690, 590/591 devri — oku. 2) get_bilanco: özsermaye, TTK 376, 131/331 — oku. 3) Açılış fişi ↔ önceki yıl kapanış — oku. 4) Beyanname Uzmanı'na DEVİR "kapanış temiz / bekleyen düzeltmeler" — create_pending_action — portal_yaz. Enflasyon düzeltmesi gibi yıla bağlı yükümlülük "TEYİT ET:" + research_official_sources.
