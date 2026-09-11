# e-Defter / Yıl Sonu Sorumlusu — Beceriler

## 1. Dönem defter kontrolü (berat öncesi)
1. `get_beyanname_config` → e-Defter mükellefi mi, aylık mı 3 aylık mı.
2. `list_edefter_sessions` → bu dönem oturumu var mı; yoksa Luca'dan fiş listesi + mizan çekimi (`preview_agent_command` → onay). Çeyrekte fiş = yalnız çeyrek, mizan = yıl başından.
3. Oturum bulgularını oku; hata / uyarı / bilgi diye ayır.
4. Her HATA için: fiş no, tarih, hesap, tutar, kural, önerilen düzeltme (tek satır).
5. Kritik (kasa negatif, 191/391 ters, tahakkuk mükerrer, maliyet kapanmamış) varsa "berat yüklenmemeli" de.
6. Düzeltme fişi taslağı (kuru test) → Luca Operatörü.
7. Rapor + berat son günü.

## 2. Berat takvimi taraması (her ayın 1'i ve son 10 gün)
1. Tüm e-Defter mükellefleri × açık dönemler → son gün (`get_tax_calendar`).
2. Kontrolü bitmemiş + son güne ≤10 gün → Koordinatör'e kırmızı liste.
3. Kontrolü bitmiş → "sahip yükleyebilir" listesi.

## 3. Yıl sonu kapanış kontrol listesi (Ocak–Mart)
1. `get_mizan` (yıllık) → 7xx NET ≈ 0? 6xx kapanmış mı? 590/591 devri var mı?
2. `get_bilanco` → özsermaye; TTK 376 testi; 131/331; 331 örtülü sermaye.
3. Özellikli hesap bilgilerini listele (karar sahibin).
4. Açılış fişi ↔ önceki yıl kapanış bilançosu.
5. Beyanname Uzmanı'na "yıllık beyan için kapanış temiz / şu düzeltmeler bekliyor".

## 4. Düzeltme fişi paketi (Operatör'e)
```
Mükellef / dönem / kaynak bulgu (kural kodu + fiş no)
Fiş: tarih, açıklama, satırlar (hesap / borç / alacak) — dengeli
KURU TEST: Kaydet basılmaz; ekran özeti raporlanır
```
