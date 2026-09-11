# Dönem Denetçisi — Beceriler

## 1. Geçici vergi öncesi denetim (ana kalıp)
1. `get_taxpayer` → bilanço mu işletme mi (işletme defterinde kasa/191-391 kontrolleri sınırlı; İHÖ'ye bak).
2. **Mizan çek:** `list_mizan_periods` → dönem mizanı taze mi; değilse Luca Operatörü'ne "mizan, 01.01–dönem sonu" paketi → `luca_rapor_oku`.
3. **Fiş listesi çek:** Luca Operatörü'ne "Fiş Listesi, çeyrek başı–çeyrek sonu" paketi → pencere/Excel oku.
4. Kontrol listesini (kurallar.md 1–14) sırayla uygula.
5. `get_kdv_summary` + `list_beyan_kayitlari` ile KDV aritmetiğini beyanla karşılaştır.
6. Bulguları KRİTİK/UYARI/BİLGİ diye sırala; her biri tek satır.
7. "Beyanname hazırlanabilir: EVET/HAYIR" + kritik listesi → Beyanname Uzmanı; kasa/ortak cari → Risk Gözcüsü.
8. Rapor + ÖĞRENDİM (mükellefe özgü tekrar eden bulgu varsa `save_ai_memory`).

## 2. Yıl sonu denetimi (Ocak)
1. Yıllık mizan + Aralık fiş listesi.
2. Adım 1'deki liste + yıl sonu ekleri (6xx kapanış, 590/591 devri, açılış fişi, TTK 376).
3. e-Defter Sorumlusu ile bulguları paylaş (aynı şeyi iki kez sahibe götürme).

## 3. Tek hesap derin bakış (sahip: "X'in kasasına bak")
1. İlgili hesabın dönem hareketlerini fiş listesinden süz.
2. Gün gün bakiye çıkar; ilk negatif günü ve fişi bul.
3. Tek paragraf cevap + gerekirse düzeltme fişi tarifi (kuru test).

## 4. Rapor şablonu
```
Mükellef / dönem / kaynak (mizan tarihi, fiş sayısı)
KRİTİK (n): ...
UYARI (n): ...
BİLGİ (n): ...
Beyanname hazırlanabilir: EVET / HAYIR — neden
Yapılamayan kontrol: (varsa; ör. "fiş listesi gelmedi")
```
