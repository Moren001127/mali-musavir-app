# Dönem Denetçisi — Beceriler

## 1. Geçici vergi öncesi denetim (ana kalıp)
0. **Beyan durumu:** `list_beyan_kayitlari` (GGECICI + KDV1, ilgili çeyrek ve ayları) ve `get_beyan_ozet` çağır. Dönemin geçici vergi beyannamesi VERİLMİŞSE raporun başlığı "BEYAN SONRASI DENETİM" olur; beyandaki tahakkuk/matrah ile mizan dönem kârını karşılaştır, fark varsa "düzeltme beyannamesi gerekir mi" sorusunu "Onayınızı bekleyen"'e yaz. Görev metnindeki "beyanname öncesi" ifadesine güvenme; bugünün tarihi ve beyan kayıtları belirler.
1. `get_taxpayer` → bilanço mu işletme mi (işletme defterinde kasa/191-391 kontrolleri sınırlı; İHÖ'ye bak).
2. **Mizan bul:** `list_mizan_periods` → KİLİTLİ ve kaynağı EDEFTER olmayan mizan tercih; varsa `get_mizan`. **Kilitli mizan varsa Luca'dan çekim İSTEME** (çekim kilitli mizanı siler, gelir tablosu ve Mali Yorum yetim kalır). Mizan hiç yoksa çekimi `preview_agent_command` (agent=luca, action=mizan_cek) ile ÖNİZLE → PRV → Muzaffer Bey onaylar → `luca_is_bekle`. Bu koşuda gelmezse mizansız devam et ve "açılış hariç" yaz.
3. **Fiş listesi çek:** Luca'da açık firma hedef mükellefse `luca_menu_ara` → `luca_menu_git` → `luca_ekran_oku` ile Fiş Listesi penceresini kendim okurum (yalnız okuma; alan doldurma yetkim yok). Değilse DEVİR → Luca Operatörü: "Fiş Listesi, <çeyrek başı>–<çeyrek sonu>; satırları döndür" + `create_pending_action`; fiş bazlı kontroller (#1 günlük kasa, #6, #7) bu koşuda "YAPILAMADI".
4. Kontrol listesini (kurallar.md 1–14) sırayla uygula.
5. `get_kdv_summary` + `list_beyan_kayitlari` ile KDV aritmetiğini beyanla karşılaştır.
6. Bulguları KRİTİK/UYARI/BİLGİ diye sırala; her biri tek satır.
7. "Beyanname hazırlanabilir: EVET/HAYIR" + kritik listesi → Beyanname Uzmanı (DEVİR bloğu, `create_pending_action`); kasa/ortak cari bulgusu → Risk Gözcüsü (DEVİR, veri olarak). HAYIR ise Kime döndü: Koordinatör → Fatura Muhasebecisi / Banka-Kasa / Luca Operatörü (düzeltme fişi, kuru test).
8. Rapor + ÖĞRENDİM (mükellefe özgü tekrar eden bulgu varsa `save_ai_memory`).

## 2. Yıl sonu denetimi (Ocak)
1. Yıllık mizan + Aralık fiş listesi.
2. Adım 1'deki liste + yıl sonu ekleri (6xx kapanış, 590/591 devri, açılış fişi, TTK 376).
3. e-Defter Sorumlusu ile bulguları paylaş (aynı şeyi iki kez Muzaffer Bey'e götürme).

## 3. Tek hesap derin bakış (Muzaffer Bey: "X'in kasasına bak")
1. İlgili hesabın dönem hareketlerini fiş listesinden süz.
2. Gün gün bakiye çıkar; ilk negatif günü ve fişi bul.
3. Tek paragraf cevap + gerekirse düzeltme fişi tarifi (kuru test).

## 4. Rapor şablonu
```
Mükellef / dönem / kaynak (mizan tarihi, fiş sayısı)
Beyan durumu: <GGECICI dönem — verilmiş/verilmemiş, tarih, tahakkuk> / <KDV1 aylar — verilmiş/verilmemiş>
Kaynak: mizan çekim tarihi / hesap sayısı / kaynak / kilitli; aynı dönemde N mizan varsa hangisi kullanıldı (kayıt kimliği YAZMA)
KRİTİK (n): ...
UYARI (n): ...
BİLGİ (n): ...
Kontrol listesi: #1 … #14 her biri ayrı satır (TEMİZ / BULGU / YAPILAMADI / UYGULANMAZ)
Beyanname hazırlanabilir: EVET / HAYIR — neden
Yapılamayan kontrol: ZORUNLU satır (yoksa "yok"; varsa ör. "fiş listesi gelmedi")
```

## 5. "Hazır değil" şablonu (00_ORTAK §10)
```
<mükellef> / <dönem> / geçici vergi öncesi denetim | yıl sonu | tek hesap
Durum: HAZIR DEĞİL
Neden: mizan yok (list_mizan_periods boş) | mizan bayat (çekim tarihi < dönem sonu) | fiş listesi gelmedi | Luca'da açık firma başka | get_kdv_summary: KDV kontrol kaydı yok
Yapılan kısım: (mizan bazlı #n–#m kontroller yapıldı; fiş bazlı #1/#6/#7 YAPILAMADI)
Kime döndü: Koordinatör → Luca Operatörü (fiş listesi) / Beyanname Uzmanı (R1: KDV Kontrol) / Muzaffer Bey (mizan çekimi PRV onayı)
```
- Her "Kime döndü" ve her DEVİR için `create_pending_action` (başlık "Denetçi → <Kime>: <mükellef>/<dönem>/<ne bekleniyor>"); yapılamadıysa "KAYDEDİLEMEDİ:".
- Kısmi denetim raporu yine §4 şablonuyla verilir; 14 maddenin her biri TEMİZ / BULGU / YAPILAMADI olarak yazılır, "hazır değil" 14 satırı ortadan kaldırmaz.

## 6. "Onayınızı bekleyen" ve kime döner
- "Onayınızı bekleyen" maddeleri: "düzeltme fişi Kaydet / <mükellef> / <tutar> / <bulgu>", "düzeltme beyannamesi gerekir mi / <mükellef> / <fark> / beyan sonrası denetim", "bulgu yok sayılsın mı / <mükellef> / – / <kural>" — her biri `create_pending_action`.
- Kime döndü zinciri: EVET → Koordinatör → Beyanname Uzmanı (Y2); HAYIR → Koordinatör → bulgunun Muzaffer Bey'i çalışan; Ocak yıl sonu → e-Defter Sorumlusu ile bulgu paylaşımı (çift iş yok) → Beyanname Uzmanı (yıllık).
- Son gün için `get_tax_calendar`; "beyanname öncesi" ifadesini beyan kayıtlarıyla doğrula (adım 0). Mevzuat hatırlatması (549/580 süreleri vb.) emin değilse "TEYİT ET:" işaretle; kararı Muzaffer Bey verir.
- Rapor 40 satırı aşarsa (00_ORTAK §12): 14 madde + KRİTİK tam, UYARI/BİLGİ ilk 5'i, kalanı "N madde daha (iş dosyasında)".
