# Mali Analist — Beceriler

## 1. Dönem yorumu (ana kalıp)
1. `get_taxpayer` → sektör, defter türü, stoklu mu.
2. Veri: bilanço → `get_gelir_tablosu` + `get_bilanco` + `calculate_financial_ratios` + `compare_periods` (önceki dönem/geçen yıl aynı dönem); işletme → `get_isletme_hesap_ozeti`.
3. `list_tax_payable` → yıl içi ödenen geçici vergi; `get_kdv_summary` → KDV yükü eğilimi.
4. `get_gundem` → TÜFE, kur (gerçek büyüme düzeltmesi).
5. Denetçi/Risk raporu varsa oku; kritik varsa "veri güvenilir değil" notu.
6. Şablonu doldur (aşağıda). Her yorum `[öneri]`.
7. Sahibe rapor + mükellef özeti (onay bekleyen).

## 2. Dönem yorumu şablonu
```
MÜKELLEF / DÖNEM (kümülatif: 01.01–gg.aa) — veri tarihi: …
1. Ciro ve kâr eğilimi: ciro X → Y (%), brüt kâr marjı %a → %b, net kâr Z. [öneri] …
2. Vergi yükü: bu dönem geçici vergi ~A–B TL; yıl sonu kurumlar/gelir tahmini ~C–D TL (kümülatif eğilim + önceki ödenen mahsup). [öneri] …
3. Nakit: kasa+banka E TL; alacak/borç günleri; cari oran; kısa vadeli borç kapasitesi. [öneri] …
4. Geçici vergi öngörüsü (sonraki dönem): mevcut eğilim sürerse ~F–G TL.
5. Sektör kıyası: (isimsiz) marj/ciro büyümesi ortalamanın altında/üstünde. Veri yoksa "kıyas yapılamadı".
6. Dikkat çekenler: (Denetçi/Risk bulguları, olağandışı gider kalemi, stok/SMM eksikliği)
Sahibe — konuşulacak 3 madde: …
Mükellef özeti (≤5 satır, onay bekliyor): …
```

## 3. Mükellef özeti (WhatsApp'a uygun)
- "Sayın <ad>, <dönem> özetiniz: satış <X> TL, dönem kârı <Y> TL, ödenecek geçici vergi yaklaşık <A–B> TL (ödeme vadesi <17.aa.yyyy>). Detay için ofisimizi arayabilirsiniz." → onay kuyruğu.

## 4. Yıllık değerlendirme (Nisan–Mayıs)
- Şablonun yıllık hali + 12 aylık nakit döngüsü + gelecek yıl için vergi planlama gündemi (kesin tavsiye değil, konuşulacak başlıklar).
