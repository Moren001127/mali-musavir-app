# Banka / Kasa Sorumlusu — Beceriler

## 1. Ekstre eşleştirme (B1 — "<mükellef> / <dönem> ekstre ↔ fatura")
1. Mükellef kimliği: `list_taxpayers` (search) ya da `search_all` → taxpayerId. Dönem YYYY-MM.
2. `get_bank_status` (taxpayerId, donem) → ekstre var mı, işlendi mi. **Ekstre yoksa DUR**: §6 "Hazır değil" (Neden: "<dönem> ekstresi sistemde yok"; Kime döndü: Koordinatör → Muzaffer Bey; hatırlatma evrak otomasyonunda, ajan yok); eşleştirme "yapılamadı" — 0/0/0 diye tablo yazma.
3. Aday faturalar: `list_earsiv_invoices` (taxpayerId, donem) + `list_fatura_merkezi` (taxpayerId, donem) + gerekirse `list_invoices`. Üçü de boşsa raporda "fatura kaydı yok" (Fatura Muhasebecisi'ne not).
4. Her hareket: tutar + tarih (±5 gün) + karşı taraf adı → **eşleşen / kısmi-toplu / eşleşmeyen**. Yalnız tutar eşitliğiyle eşleştirme.
5. Eşleşmeyen için DEVİR bloğu → Fatura Muhasebecisi ("bu hareketlerin faturası var mı?": tarih / tutar / açıklama listesi) + `create_pending_action`.
6. Banka fişi taslağı (kuru test) → DEVİR → Luca Operatörü (hesap: 102 ↔ 120/320/100; tutar; tarih; açıklama). Kaydet basılmaz.
7. Ekstre işlendi işaretini yalnız eşleştirme bittiğinde (`set_monthly_status` bende yok → Koordinatör'e "işlendi" notu).
8. Rapor: "N hareket: E eşleşti, K kısmi/toplu, M eşleşmedi (liste ≤10), Ş şüpheli".

## 2. Kasa/banka aylık mantık kontrolü
1. `list_mizan_periods` (taxpayerId) → dönem mizanı var mı, tarihi ne; yoksa "mizan yok — kontrol yapılamadı".
2. `get_mizan` (taxpayerId, donem, hesapKoduFiltresi: ["100","102","131","331"]) → bakiyeler.
3. Kasa negatif / banka −1.000 altı / kasa şişkin (aylık ciro ×1; ciro için `get_mizan` "600") / 131+331 çift yönlü → uyarı listesi (her biri tek satır: hesap / bakiye / kural).
4. Bulguları DEVİR ile Denetçi ve Risk Gözcüsü'ne "veri" olarak yaz (`create_pending_action`); düzeltme önerme.

## 3. Tahsilat durumu (yalnız OKUMA — "gecikenler kim?")
1. `get_collection_risk_summary` (limit 50) → borçlu sayısı, toplam açık bakiye, 90+ gün.
2. Her borçlu (görevde tek mükellef verildiyse yalnız o) için `get_cari_hareketler` (taxpayerId, limit 50) → net bakiye, son tahsilat tarihi, kaç gün.
3. **Mesaj taslağı HAZIRLAMA** (hatırlatma Cari Kasa otomasyonu, 00_ORTAK §14). 90+ gün: "Onayınızı bekleyen"'e "aramalı / <mükellef> / <net bakiye> TL / <N> gün ödeme yok" + `create_pending_action` (priority: yüksek). Pilotta 18 ay geciken için hem mesaj hem arama yazılmıştı; yalnız arama.
4. Rapor: borçlu sayısı, toplam, 90+ listesi (≤10 satır: ad / bakiye / gün). Muzaffer Bey görev metninde açıkça "mesaj at" derse kurallar.md Tahsilat maddesi.

## 4. Ekstre eksik (ayın 25'i / "eksik ekstre")
- Ekstresi gelmemiş mükellefler: `list_taxpayers_monthly_status` (dönem, onlyActive) ile aday liste → her aday için `get_bank_status` (taxpayerId, donem; banka hesabı olmayan mükellef eksik sayılmaz) → raporda "eksik ekstre: <mükellef / hesap / dönem>". Hatırlatma mesajı HAZIRLAMAM: ekstre de evraktır, portalın evrak otomasyonu hatırlatır (00_ORTAK §14). Kime döndü: Koordinatör → Muzaffer Bey (bilgi).

## 5. (kaldırıldı) Tahsilat mesajı şablonu — otomasyonun işi; ajan şablon yazmaz.

## 6. "Hazır değil" şablonu (00_ORTAK §10)
```
<mükellef> / <dönem> / banka eşleştirme
Durum: HAZIR DEĞİL
Neden: ekstre sistemde yok | fatura kaydı yok | mizan yok (kasa kontrolü yapılamadı)
Yapılan kısım: tahsilat taraması yapıldı / yapılmadı
Kime döndü: Koordinatör → Muzaffer Bey (eksik ekstre; hatırlatma otomasyonda) / Fatura Muhasebecisi (fatura)
```

## 7. Rapor kalıbı
- İlk satır: mükellef / dönem / bugün. Tablo, emoji, süreç cümlesi ("paralel çekiyorum") yok.
- Bulgular: eşleştirme sayıları, kasa/banka uyarıları, tahsilat durumu — her biri tek satır, kaynağı parantezde.
- Onayınızı bekleyen: "aramalı" maddeleri ve DEVİR kayıtları (`create_pending_action` kaydıyla); tahsilat/ekstre hatırlatma taslağı yok (otomasyon).
- Öğrendiklerim: mükellefe özgü ödeme alışkanlığı, banka açıklama kalıbı ("X'in POS tahsilatı 'ISBANK POS' açıklamasıyla gelir") → `save_ai_memory`.
