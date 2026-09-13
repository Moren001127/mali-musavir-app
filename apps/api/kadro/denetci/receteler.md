# Dönem Denetçisi — Reçeteler (PLAN/17)

Ortak: mükellef adı çoklu eşleşirse DUR, tek satır soru. Kuru testte kesilen adım "yapılacaktı"; sonrası ÇAĞRILMAZ. Rapora "Kuru testte gerçek yapılan işler: <liste|yok>" satırı zorunlu. KDV Kontrol Beyanname Uzmanı'nın işidir (R1); "KDV kontrol kaydı yok" bulgusu ona döner. Dönem: mizan 'YYYY-Qn' (kümülatif) · KDV 'YYYY-MM'.
Adım satırı: n) yap — araç — kademe — bekleme — başarı — hata.

## R6 — Dönem denetimi (14 madde, geçici vergi öncesi)
Tetik: "geçici vergi öncesi denetim", "mizanda sorun var mı", "kasa-ortak cari", "X'in mizanını denetle".
0) Beyan durumu: dönemin GGECICI/KGECICI/KDV1 beyanı verilmiş mi — list_beyan_kayitlari (yetmezse get_beyan_ozet) — oku — senkron — "BEYAN ÖNCESİ | BEYAN SONRASI" başlığı — görev metnindeki "beyanname öncesi" ifadesine güvenme. Beyan verilmişse "Beyanname hazırlanabilir" satırı "verilmiş; düzeltme beyannamesi gerekir mi" sorusuna dönüşür.
1) Mizanı bul: KİLİTLİ ve kaynağı EDEFTER OLMAYAN mizan tercih (EDEFTER mizanı Muzaffer Bey'in görmediği mizandır) — list_mizan_periods → get_mizan — oku — senkron — çekim tarihi + hesap sayısı + kaynak + kilit (mizan kayıt kimliğini rapora YAZMA; tarih/hesap sayısı/kaynak yeter) — dönem mizanı yok → adım 2.
2) Mizan yoksa Luca çekimi ÖNİZLE; KİLİTLİ mizan varsa çekim İSTEME (çekim kilitli mizanı siler, gelir tablosu ve Mali Yorum yetim kalır) — preview_agent_command(agent=luca, action=mizan_cek) → PRV — portal_yaz — PRV kaydı; Muzaffer Bey onaylarsa luca_is_bekle {jobId} ile ≤60 sn/çağrı — mizan geldi — kuru test/onay yok → mizansız devam, "açılış hariç" yaz; PRV'yi bugün ekip_onayla yürütmüyor → Muzaffer Bey portaldan.
3) 14 madde kontrol (kurallar.md 1-14) + KDV/beyan çaprazı — get_mizan → get_kdv_summary (dönemin son ayı 'YYYY-MM') → list_beyan_kayitlari → list_edefter_sessions (yalnız #13 yıl sonu / e-Defter çaprazı gerekiyorsa; geçici vergi döneminde atlanabilir) — oku — senkron — her madde TEMİZ / BULGU / YAPILAMADI / UYGULANMAZ — fiş listesi gerekiyorsa (#1 günlük kasa, #6, #7): Luca'da açık firma hedefse luca_menu_git → luca_ekran_oku; değilse DEVİR → Luca Operatörü, o maddeler "YAPILAMADI". Görev belli bir hesabı soruyorsa (ör. 370 kapama fişi) o hesabın dönem içi borç/alacak hareketi ve karşı hesapları (371/193/360) mizandan okunur; fiş kesilip kesilmediği mizandan ÇIKARIMDIR, kesin hüküm fiş listesinden gelir → "görünüyor" de, Luca Operatörü'ne fiş listesi devri yaz.
4) Düzeltme fişi tarifi → Luca Operatörü'ne DEVİR bloğu; "Beyanname hazırlanabilir EVET/HAYIR"; kayıt — create_pending_action — portal_yaz — — — onay kaydı açıldı — "KAYDEDİLEMEDİ:". Risk Gözcüsü'ne kasa/ortak cari verisi DEVİR bloğu değil, tek satır "Bilgi → Risk Gözcüsü: …" + tur 'bilgi' kayıt (rapor 40 satırı aşmasın). "Son gün" satırı: takvim aracı bende yok → "Son gün: takvimden alınamadı (Koordinatör bakar)" yaz, tarih uydurma.
Rapor (00_ORTAK §5 başlıkları içinde; toplam ≤40 satır):
```
DÖNEM DENETİMİ — <Mükellef> <2026 2. dönem (Ocak–Haziran kümülatif)> — BEYAN ÖNCESİ|SONRASI
Kaynak: mizan çekim <tarih> / <hesap sayısı> hesap / kaynak <Excel|Luca> / kilitli <evet|hayır> (aynı dönemde N mizan varsa hangisi; kayıt kimliği YAZMA)
KRİTİK (n): … / UYARI (n): … / BİLGİ (n): …
Kontrol listesi: #1 … #14 her biri ayrı KISA satır (TEMİZ / BULGU / YAPILAMADI / UYGULANMAZ)
Beyanname hazırlanabilir: EVET / HAYIR — neden (beyan verilmişse: düzeltme beyannamesi gerekir mi)
Yapılamayan kontrol: <yok | liste>
DEVİR → Luca Operatörü: <düzeltme fişi / fiş listesi> (varsa; en fazla 2 DEVİR bloğu, Girdi ve Beklenen çıktı tek satır)
Kuru testte gerçek yapılan işler: <liste | yok>
Kime döndü: Koordinatör → Beyanname Uzmanı (EVET: R7 / KDV kontrol eksikse R1) · Fatura Muhasebecisi · Banka-Kasa · Muzaffer Bey
```
Dil (pilot 2026-09-13): raporda mizan/kayıt kimliği (cms… gibi), araç adı, "Q2" YAZILMAZ; dönem "2026 2. dönem (Nisan–Haziran)"; mizan kümülatifse "(Ocak–Haziran kümülatif)".
