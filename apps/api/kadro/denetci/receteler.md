# Dönem Denetçisi — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. KDV Kontrol Beyanname Uzmanı'nın işidir (R1); "KDV kontrol kaydı yok" bulgusu ona döner. Dönem: mizan 'YYYY-Qn' (kümülatif) · KDV 'YYYY-MM'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R6 — Dönem denetimi (14 madde, geçici vergi öncesi)
Tetik: "geçici vergi öncesi denetim", "mizanda sorun var mı", "kasa-ortak cari", "X'in mizanını denetle".
0) Beyan durumu: dönemin GGECICI/KDV1 beyanı verilmiş mi — list_beyan_kayitlari → get_beyan_ozet — oku — senkron — "BEYAN ÖNCESİ | BEYAN SONRASI" başlığı — görev metnindeki "beyanname öncesi" ifadesine güvenme.
1) Mizanı bul: KİLİTLİ ve kaynağı EDEFTER OLMAYAN mizan tercih (EDEFTER mizanı Muzaffer Bey'in görmediği mizandır) — list_mizan_periods → get_mizan — oku — senkron — mizan id + tarih + hesap sayısı — dönem mizanı yok → adım 2.
2) Mizan yoksa Luca çekimi ÖNİZLE; KİLİTLİ mizan varsa çekim İSTEME (çekim kilitli mizanı siler, gelir tablosu ve Mali Yorum yetim kalır) — preview_agent_command(agent=luca, action=mizan_cek) → PRV — portal_yaz — PRV kaydı; Muzaffer Bey onaylarsa luca_is_bekle {jobId} ile ≤60 sn/çağrı — mizan geldi — kuru test/onay yok → mizansız devam, "açılış hariç" yaz; PRV'yi bugün ekip_onayla yürütmüyor → Muzaffer Bey portaldan.
3) 14 madde kontrol (kurallar.md 1-14) + KDV/beyan çaprazı — get_mizan → list_edefter_sessions → get_kdv_summary → list_beyan_kayitlari — oku — senkron — her madde TEMİZ / BULGU / YAPILAMADI — fiş listesi gerekiyorsa (#1 günlük kasa, #6, #7): Luca'da açık firma hedefse luca_menu_git → luca_ekran_oku; değilse DEVİR → Luca Operatörü, o maddeler "YAPILAMADI".
4) Düzeltme fişi tarifi → Luca Operatörü'ne DEVİR bloğu; "Beyanname hazırlanabilir EVET/HAYIR"; kayıt — create_pending_action — portal_yaz — — — pending id — "KAYDEDİLEMEDİ:".
Rapor:
```
DÖNEM DENETİMİ — <Mükellef> <YYYY-Qn> — BEYAN ÖNCESİ|SONRASI
Kaynak: mizan <id> / <tarih> / <hesap sayısı> / kilitli <evet|hayır> (aynı dönemde N mizan varsa hangisi)
KRİTİK (n): … / UYARI (n): … / BİLGİ (n): …
Kontrol listesi: #1 … #14 her biri ayrı satır (TEMİZ / BULGU / YAPILAMADI / UYGULANMAZ)
Beyanname hazırlanabilir: EVET / HAYIR — neden
Yapılamayan kontrol: <yok | liste>
DEVİR → Luca Operatörü: <düzeltme fişi / fiş listesi> (varsa)
Kuru testte gerçek yapılan işler: <liste | yok>
Kime döndü: Koordinatör → Beyanname Uzmanı (EVET: R7 / KDV kontrol eksikse R1) · Fatura Muhasebecisi · Banka-Kasa · Muzaffer Bey
```
