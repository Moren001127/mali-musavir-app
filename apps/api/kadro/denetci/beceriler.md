# Dönem Denetçisi — Beceriler

## 1. Geçici vergi öncesi denetim (ana kalıp)
0. **Beyan durumu:** `list_beyan_kayitlari` (GGECICI + KDV1, ilgili çeyrek ve ayları) ve `get_beyan_ozet` çağır. Dönemin geçici vergi beyannamesi VERİLMİŞSE raporun başlığı "BEYAN SONRASI DENETİM" olur; beyandaki tahakkuk/matrah ile mizan dönem kârını karşılaştır, fark varsa "düzeltme beyannamesi gerekir mi" sorusunu ONAY BEKLEYEN'e yaz. Görev metnindeki "beyanname öncesi" ifadesine güvenme; bugünün tarihi ve beyan kayıtları belirler.
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
Beyan durumu: <GGECICI dönem — verilmiş/verilmemiş, tarih, tahakkuk> / <KDV1 aylar — verilmiş/verilmemiş>
Kaynak: mizan id / tarih / hesap sayısı; aynı dönemde N mizan varsa hangisi kullanıldı
KRİTİK (n): ...
UYARI (n): ...
BİLGİ (n): ...
Kontrol listesi: #1 … #14 her biri ayrı satır (TEMİZ / BULGU / YAPILAMADI / UYGULANMAZ)
Beyanname hazırlanabilir: EVET / HAYIR — neden
Yapılamayan kontrol: ZORUNLU satır (yoksa "yok"; varsa ör. "fiş listesi gelmedi")
```
