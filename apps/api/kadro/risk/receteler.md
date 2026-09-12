# Risk Gözcüsü — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Yalnız okur ve rapor eder; dışarı gönderim/Luca/ajan komutu yok. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu (bu ajanda hep "yok"). Veri yoksa gösterge "ölçülemedi"; ham faturadan türetme. Dönem: KDV 'YYYY-MM' · mizan 'YYYY-Qn'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R-K1 — Mükellef risk puan kartı (çeyreklik tam kart) (mevcut iş)
1) Sektör, defter türü, ortaklık — get_taxpayer — oku — senkron — profil — çoklu eşleşme → DUR.
2) KDV serisi: son 12 ay hesaplanan/indirilecek/devreden — list_beyan_kayitlari (KDV1) → get_kdv_summary (son dönem) — oku — senkron — yüklenim oranı, sürekli devreden — beyan kaydı yok → KDV göstergeleri "ölçülemedi".
3) Mizan: kilitli ve kaynağı EDEFTER olmayan tercih; 100/102/131/331/5 bakiyeleri — list_mizan_periods → get_mizan {hesapKoduFiltresi} → get_gelir_tablosu — oku — senkron — kasa şişkinliği, ortak cari, ciro/brüt kâr — mizan yok → "ölçülemedi" (çekim İSTEME).
4) Nakit satış oranı — list_earsiv_invoices (SATIS) + get_cari_hareketler — oku — senkron — nakit/POS/havale dağılımı — veri yok → "ölçülemedi".
5) Sapmalar — compare_periods — oku — senkron — önceki dönem/geçen yıl farkı — önceki yok → tek dönem.
6) Puanla, tek satır nedenler; kasa/ortak cari notu Analist'e; mükellefe özgü kalıcı gösterge hafızaya — create_pending_action → save_ai_memory — portal_yaz — — — kart + kayıt — "KAYDEDİLEMEDİ:".
Rapor: RİSK KARTI — <Mükellef> <YYYY-Qn> / gösterge · değer · puan · neden (tek satır) / ölçülemedi: <liste> / toplam puan / Kuru testte gerçek yapılan işler: yok / Kime döndü: Koordinatör → Muzaffer Bey · Analist (kasa/ortak notu).

## R-K2 — Ofis sıralaması (çeyrek) ve aylık hafif tarama (mevcut iş)
- Sıralama: tüm aktif mükellefler (önce KDV verisi olanlar) → ilk 10, her biri ad / puan / en yüksek gösterge; liste create_pending_action gövdesine; kart çıkarılamayanlar "ölçülemedi (neden)". Kime döndü: Koordinatör → Muzaffer Bey.
- Aylık hafif tarama (KDV sonrası): yalnız KDV yüklenim + devreden; sıçrama varsa Koordinatör'e not (create_pending_action).
