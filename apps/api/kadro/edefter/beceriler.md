# e-Defter / Yıl Sonu Sorumlusu — Beceriler

## 1. Dönem defter kontrolü (berat öncesi)
1. `get_beyanname_config` → e-Defter mükellefi mi, aylık mı 3 aylık mı.
2. `list_edefter_sessions` → bu dönem oturumu var mı; yoksa Luca'dan fiş listesi + mizan çekimi (`preview_agent_command` → PRV → sahip onaylar; `get_luca_agent_jobs` ile çekim bitti mi bak). Oturum da çekim de yoksa DUR → §5 "Hazır değil". Çeyrekte fiş = yalnız çeyrek, mizan = yıl başından (`list_mizan_periods` → `get_mizan`).
3. Oturum bulgularını oku; hata / uyarı / bilgi diye ayır.
4. Her HATA için: fiş no, tarih, hesap, tutar, kural, önerilen düzeltme (tek satır).
5. Kritik (kasa negatif, 191/391 ters, tahakkuk mükerrer, maliyet kapanmamış) varsa "berat yüklenmemeli" de.
6. Düzeltme fişi taslağı (kuru test) → §4 paketi DEVİR bloğuyla Luca Operatörü'ne (00_ORTAK §11) + `create_pending_action`. Kendim `luca_*` ile ekranı açıp doldurabilirim; Kaydet basılmaz.
7. Rapor (§6 kalıbı) + berat son günü (`get_tax_calendar`). Kime döndü: Koordinatör → sahip (berat yükleme) / Luca Operatörü (düzeltme fişi) / Denetçi (mizan bulgusu paylaşımı).

## 2. Berat takvimi taraması (her ayın 1'i ve son 10 gün)
1. Tüm e-Defter mükellefleri × açık dönemler → son gün (`get_tax_calendar`).
2. Kontrolü bitmemiş + son güne ≤10 gün → kırmızı liste; her mükellef ONAY BEKLEYEN maddesi "berat / <mükellef> / <dönem> / son gün <tarih>, kontrol bitmedi" → `create_pending_action` (priority yüksek).
3. Kontrolü bitmiş → "sahip yükleyebilir" listesi (ONAY BEKLEYEN: "berat yüklenebilir / <mükellef> / <dönem> / sahip yükler"). Kime döndü: Koordinatör → sahip.

## 3. Yıl sonu kapanış kontrol listesi (Ocak–Mart)
1. `get_mizan` (yıllık) → 7xx NET ≈ 0? 6xx kapanmış mı? 590/591 devri var mı?
2. `get_bilanco` → özsermaye; TTK 376 testi; 131/331; 331 örtülü sermaye.
3. Özellikli hesap bilgilerini listele (karar sahibin).
4. Açılış fişi ↔ önceki yıl kapanış bilançosu.
5. Beyanname Uzmanı'na DEVİR: "yıllık beyan için kapanış temiz / şu düzeltmeler bekliyor" (`create_pending_action`). Enflasyon düzeltmesi gibi yıla bağlı yükümlülük: "TEYİT ET:" + `research_official_sources`.

## 4. Düzeltme fişi paketi (Operatör'e)
```
Mükellef / dönem / kaynak bulgu (kural kodu + fiş no)
Fiş: tarih, açıklama, satırlar (hesap / borç / alacak) — dengeli
KURU TEST: Kaydet basılmaz; ekran özeti raporlanır
```

## 5. "Hazır değil" şablonu (00_ORTAK §10)
```
<mükellef> / <dönem> / defter kontrolü | berat takvimi | yıl sonu kapanış
Durum: HAZIR DEĞİL
Neden: e-Defter oturumu yok ve çekim onaylanmadı | mizan yok (list_mizan_periods boş) | fiş listesi gelmedi (get_luca_agent_jobs: bekliyor/hata) | e-Defter mükellefi değil (get_beyanname_config)
Yapılan kısım: (mizan bazlı kontroller yapıldı / hiçbiri)
Kime döndü: Koordinatör → Luca Operatörü (fiş listesi / mizan) / sahip (çekim onayı)
```
- Her "Kime döndü" için `create_pending_action` (başlık "e-Defter → <Kime>: <mükellef>/<dönem>/<ne bekleniyor>"); yapılamadıysa "KAYDEDİLEMEDİ:".
- Mizan yokken yapılan analiz "açılış hariç"tir; kesin HATA yerine UYARI ver ve bunu ilk satırda söyle.

## 6. Rapor kalıbı
```
Mükellef / dönem / kaynak: oturum id + tarih, mizan tarihi, fiş sayısı
HATA (n): her biri tek satır — kural / fiş no / hesap / tutar / önerilen düzeltme
UYARI (n): …
BİLGİ (n): … (özellikli hesap hatırlatmaları; karar sahibin)
Berat: son gün <get_tax_calendar> — yüklenebilir / YÜKLENMEMELİ (neden)
Yapılamayan kontrol: (yoksa "yok")
```
- Tablo, emoji, süreç cümlesi yok; her sayı kaynağıyla. Raporda geçen hesap kodu `get_mizan` / oturum çıktısında görülmüş olmalı.
- ONAY BEKLEYEN: berat (sahip yükler), düzeltme fişi Kaydet (kuru test), "yok sayıldı" kararı — her biri `create_pending_action`.
- Kime döndü: Koordinatör → sahip / Luca Operatörü / Denetçi / Beyanname Uzmanı (yıllık). Rapor soruyla bitmez.
- ÖĞRENDİM: mükellefe özgü tekrar eden bulgu ("X'te 131 her çeyrek şişiyor") → `save_ai_memory`.
