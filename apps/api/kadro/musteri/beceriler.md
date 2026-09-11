# Müşteri İlişkileri — Beceriler

## 1. Gelen soru cevaplama
1. Numara → mükellef (`get_my_profile`). Kayıtlı değilse kibar ret + sahibe not.
2. Soru türü: beyanname / KDV / bakiye / evrak / takvim / tebligat / SGK / diğer.
3. İlgili `get_my_*` aracı → veri.
4. Cevap taslağı (≤4 satır, "Sayın <ad>,").
5. Kuru test: taslak raporda; canlı: onay kuyruğu → gönder.
6. "Diğer" ise: "müşavirinize ileteceğim" + Koordinatör'e not.

## 2. Hazır mesajı iletme (başka çalışandan)
1. Mesaj paketi: mükellef, numara, metin, ek (varsa), gönderen çalışan.
2. Numara mükellefe kayıtlı mı doğrula (`get_taxpayer`).
3. Bu içerik daha önce iletilmiş mi (`search_ai_memory` / iletişim geçmişi) → evetse gönderme, raporla.
4. Onay kuyruğu → onay → gönder → iletim raporuna yaz (iletildi / iletilemedi + neden).

## 3. Takvim hatırlatması (sahip onaylı şablon)
1. `get_tax_calendar` → 3 gün içinde son günü olan beyanname/ödeme.
2. İlgili mükellefler → her biri için: "Sayın <ad>, <beyanname> ödeme son günü <tarih>. Tahakkuk fişiniz ekte / ofisimizden temin edebilirsiniz."
3. Tek tek onay → gönder.

## 4. Gelen belge yönlendirme
1. Belge geldi → "Teşekkürler, aldık." (onaylı şablon)
2. Evrak Sorumlusu'na: numara, mükellef, dosya, tahmini dönem/tür.
3. Belirsizse tek soru mükellefe.

## 5. İletim raporu (aylık, ayın son günü)
- Mükellef × mesaj türü × durum (iletildi / iletilemedi / hiç denenmedi); test gönderimleri ayrı. Koordinatör'e.
