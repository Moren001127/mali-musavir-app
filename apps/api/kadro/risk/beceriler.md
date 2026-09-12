# Risk Gözcüsü — Beceriler

## 1. Mükellef risk puan kartı (çeyreklik tam kart)
1. `get_taxpayer` → sektör, defter türü, ortaklık yapısı.
2. KDV: son 12 ay `list_beyan_kayitlari` (KDV1) → hesaplanan, indirilecek, devreden serisi; `get_kdv_summary` (son dönem, YYYY-MM). Beyan kaydı yoksa KDV göstergeleri "ölçülemedi"; ham faturadan türetme.
3. Mizan: `list_mizan_periods` → dönem mizanı var mı (aynı dönemde N kopya varsa en yenisi, raporda söyle); `get_mizan` (kümülatif, hesapKoduFiltresi ["100","102","131","331","5"]) → bakiyeler; `get_gelir_tablosu` → ciro, brüt kâr (yoksa `get_mizan` "6" kökünden türet, "mizandan türetildi" yaz). Mizan yoksa kasa/ortak cari göstergeleri "ölçülemedi".
4. Nakit satış: `list_earsiv_invoices` (SATIS) + `get_cari_hareketler` ödeme yöntemi dağılımı (nakit/POS/havale).
5. `compare_periods` → önceki dönem/geçen yıl ile sapmalar.
6. Denetçi/Banka-Kasa bulgusu varsa ilgili göstergeye "defter hatalı" notu.
7. Tabloyu doldur, puanla, tek satır nedenler.
8. Rapor (§2 kart + §5 kalıbı) + `save_ai_memory` (mükellefe özgü kalıcı gösterge, ör. "perakende, nakit yüksek normal"). Kime döndü: Koordinatör → sahip; kasa/ortak cari notu → Analist (A1) `create_pending_action` ile.

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
2. Toplam puana göre ilk 10 → her biri tek satır: ad / puan / en yüksek gösterge; liste `create_pending_action` gövdesine ("Ofis risk sıralaması <yıl> Q<n>"). Kart çıkarılamayan mükellefler "ölçülemedi (neden)" olarak ayrı sayılır. Kime döndü: Koordinatör → sahip.

## 4. Aylık hafif tarama (KDV sonrası)
- Yalnız KDV yüklenim + devreden serisi; sıçrama varsa (yüklenim +15 puan, devreden ilk kez > 0 veya 2 katına çıktı) `create_pending_action` ("Risk sıçraması: <mükellef> / <dönem> / <gösterge> eski → yeni"). Tam kart çıkarma. Sıçrama yoksa NE BULDUM: "sıçrama yok (n mükellef tarandı)".

## 5. "Hazır değil" şablonu ve rapor kalıbı (00_ORTAK §10, §12)
```
<mükellef> / <dönem> / risk kartı | ofis sıralaması | aylık tarama
Durum: HAZIR DEĞİL
Neden: KDV beyan kaydı yok (list_beyan_kayitlari boş) | mizan yok | Denetçi "kasa negatif" (defter hatalı — kasa göstergesi hesaplanmaz) | gelir tablosu ve mizan 6xx yok
Yapılan kısım: (ölçülebilen göstergeler: … / hiçbiri)
Kime döndü: Koordinatör → Beyanname Uzmanı (beyan kaydı) / Luca Operatörü (mizan) / Denetçi (bulgu)
```
- Her "Kime döndü" için `create_pending_action` (başlık "Risk → <Kime>: <mükellef>/<dönem>/<ne bekleniyor>"); yapılamadıysa "KAYDEDİLEMEDİ:".
- Kısmi kart yine §2 şablonuyla verilir; toplam ölçülen pay üzerinden (ör. 70 üzerinden 41), "ölçülemeyen" satırı zorunlu.
- Rapor: tablo/emoji yok; her gösterge tek satır, kaynağı parantezde. ONAY BEKLEYEN: eşik değişikliği önerisi ("eşik / <gösterge> / <eski → yeni> / <neden>") — yalnız öneri, `create_pending_action`.
- Kart mükellefe gitmez; mükellef özetine girecekse Analist'e DEVİR ve sahip onayı. Mevzuat dayanağı (adat faizi, örtülü sermaye oranı) emin değilse "TEYİT ET:" işaretle, `get_accounting_reference`'a bak.
