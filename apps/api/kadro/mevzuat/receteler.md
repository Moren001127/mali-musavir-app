# Mevzuat Takipçisi — Reçeteler (PLAN/17)

Ortak: Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. Teyit edilemeyen bilgi mükellefe giden metne girmez; http_get yalnız resmi alan adları (resmigazete.gov.tr, gib.gov.tr, sgk.gov.tr).
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## M1 — Günlük / haftalık mevzuat taraması (mevcut iş)
1) Tarih aralığını yaz; portalın hazır özetleri ÖNCE — get_gundem — oku — senkron — RG özetleri, kur, TÜFE — boş → check_official_gazette (vergi, KDV, SGK, e-fatura, e-defter, beyanname, mücbir).
2) Vergi/SGK/e-belge ilgili madde var mı — (adım 1 çıktısı) — — — yoksa "bu aralıkta ilgili değişiklik yok" → bitir.
3) Her madde için resmi metin + tarih + kaynak — research_official_sources (gerekirse http_get) — oku — senkron — kaynaklı kart — bulunamazsa kart "TEYİT EDİLEMEDİ", etkilenen mükellef listesi ÇIKARILMAZ.
4) Etkilenen mükellefleri süz (kesin/muhtemel) — list_taxpayers → get_beyanname_config — oku — senkron — mükellef listesi (≤10 ad) — —.
5) Her kartın "YAPILMASI GEREKEN" satırı "Onayınızı bekleyen" → kayıt (başlık "Mevzuat: <başlık> → <ilgili çalışan / Muzaffer Bey>") — create_pending_action — portal_yaz — — — pending id — "KAYDEDİLEMEDİ:". Süre uzatımı / mücbir sebep → KIRMIZI, aynı gün.
Rapor: MEVZUAT — <aralık> / kart (≤5): başlık · yürürlük · kaynak · etkilenen (kesin/muhtemel) · yapılması gereken / TEYİT EDİLEMEDİ: <liste|yok> / "Onayınızı bekleyen" / Kuru testte gerçek yapılan işler / Kime döndü: Koordinatör → Bordro-SGK · Beyanname · e-Defter · Fatura · Risk · Muzaffer Bey.

## M2 — Soruya cevap ("X oranı değişti mi?") (mevcut iş)
1) get_accounting_reference → portaldaki değer — oku. 2) research_official_sources → güncel resmi değer — oku. 3) Aynıysa "değişmedi, kaynak …"; farklıysa "değişti: eski → yeni, yürürlük …, portal referansı GÜNCELLENMELİ" → create_pending_action — portal_yaz.

## M3 — Yıl başı sabit taraması (Aralık son hafta – Ocak ilk hafta) (mevcut iş)
Asgari ücret, tavan, dilimler, hadler → referans güncelleme tablosu → create_pending_action ("referans güncellenmeli"); referansı Muzaffer Bey günceller.
