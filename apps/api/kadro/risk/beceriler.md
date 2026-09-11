# Risk Gözcüsü — Beceriler

## 1. Mükellef risk puan kartı (çeyreklik tam kart)
1. `get_taxpayer` → sektör, defter türü, ortaklık yapısı.
2. KDV: son 12 ay `list_beyan_kayitlari` (KDV1) → hesaplanan, indirilecek, devreden serisi; `get_kdv_summary` (son dönem).
3. Mizan: `get_mizan` (kümülatif) → 100, 102, 131, 331, 5xx özsermaye; `get_gelir_tablosu` → ciro, brüt kâr.
4. Nakit satış: `list_earsiv_invoices` (SATIS) + `get_cari_hareketler` ödeme yöntemi dağılımı (nakit/POS/havale).
5. `compare_periods` → önceki dönem/geçen yıl ile sapmalar.
6. Denetçi/Banka-Kasa bulgusu varsa ilgili göstergeye "defter hatalı" notu.
7. Tabloyu doldur, puanla, tek satır nedenler.
8. Rapor + `save_ai_memory` (mükellefe özgü kalıcı gösterge, ör. "perakende, nakit yüksek normal").

## 2. Puan kartı şablonu
```
MÜKELLEF / DÖNEM — veri tarihi …
Toplam: NN / 100 (düşük / orta / yüksek)
KDV yüklenim: %.. → puan .. — neden …
Sürekli devreden: .. ay → puan .. — neden …
Kasa şişkinliği: ..× ciro → puan .. — neden … (veya "defter hatalı: kasa negatif")
Ortaklar cari: 131 .. / 331 .. → puan .. — neden …
Nakit satış oranı: %.. → puan .. — neden …
Marj sapması: .. puan → puan ..
Kayıtsız gider işareti: … → puan ..
Ölçülemeyen: …
Önceki karta göre: +/− .. (hangi gösterge değişti)
```

## 3. Ofis sıralaması (çeyrek)
1. Tüm aktif mükellefler için kart (kota izin verdikçe; önce KDV verisi olanlar).
2. Toplam puana göre ilk 10 → Koordinatör'e; her biri tek satır: ad / puan / en yüksek gösterge.

## 4. Aylık hafif tarama (KDV sonrası)
- Yalnız KDV yüklenim + devreden serisi; sıçrama varsa (yüklenim +15 puan, devreden ilk kez > 0 veya 2 katına çıktı) Koordinatör'e not. Tam kart çıkarma.
