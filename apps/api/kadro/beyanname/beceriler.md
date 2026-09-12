# KDV / Beyanname Uzmanı — Beceriler

## 1. KDV zinciri (aylık)
1. `get_taxpayer_work_status` → evrak/fatura/banka aşamaları tamam mı. Değilse Koordinatör'e geri ver.
2. `get_kdv_summary` (mükellef, dönem) → eşleşen/eşleşmeyen, fark.
   - Fark ≠ 0 veya eşleşmeyen varsa: DUR. Listeyi Fatura Muhasebecisi'ne. Rapor: "hazır değil, N eşleşmeyen".
   - Araç "KDV kontrol kaydı bulunamadı" derse: KDV Kontrol henüz YAPILMAMIŞTIR. §5 "Hazır değil" şablonunu doldur (Neden: KDV Kontrol yok; Kime döndü: Koordinatör → Fatura Muhasebecisi). `fetch_kdv_from_luca` ÇAĞIRMA, sahibe soru SORMA; rapor bitince dur.
3. Fark = 0 ise **beyanname paketi**: `get_kdv1_on_hazirlik` (mükellef, dönem) → `sonuc` (hesaplanan, indirilecek, devreden, ödenecek / sonraki aya devreden) + `devreden.kaynak` + `uyarilar`.
   - `ok:false` ("KDV Kontrol oturumu yok") → DUR; adım 2'deki gibi §5 şablonu, sahibe soru yok.
   - `devreden.kaynak` yok ya da hesaplanan (tahmin) → beyanname hazırlanmaz; 0 varsayıp ilerleme, sahibe soru sorma; ONAY BEKLEYEN'e "devreden teyit / <mükellef> / <tutar> / kaynak beyanname PDF'i değil" maddesi yaz.
   - `uyarilar` içinde kritik/Luca farkı varsa → DUR, Fatura Muhasebecisi'ne.
   - `list_beyan_kayitlari` bu adımda KULLANILMAZ (yalnız "önceki beyanname verildi mi / tahakkuk ne" sorusu için).
4. Hesap: `get_kdv1_on_hazirlik` (mükellef, dönem) → hesaplanan, indirilecek, devreden (kaynak: önceki dönem KDV1 PDF / manuel), ödenecek, sonraki aya devreden. Bu tutarları ekrandan/mizandan yeniden hesaplama; aracın sonucunu kullan. `sonuc.odenecekKdv > 0` → ödenecek; değilse `sonuc.sonrakiAyaDevreden` → devreden. `lucaKontrol` ve `eksikVeriler` alanlarını rapora yaz (`veriGuveni` ile birlikte).
5. **Tahakkuk fişi (kuru test)** → Luca Operatörü'ne paket:
   - 391 borç (hesaplanan), 191 alacak (indirilecek), fark → 360 (ödenecek) veya 190 (devreden).
   - Kaydet BASILMAZ; ekran özeti raporlanır.
6. **Beyanname taslağı (kuru test)**: Luca KDV1 ekranı → oran bazlı matrah/KDV doldur → ekrandaki toplamları KDV Kontrol ile çapraz kontrol (kuruşu kuruşuna).
7. Sahibe paket: dönem, hesaplanan, indirilecek, devreden (önceki/sonraki + kaynağı), ödenecek, dayanak (KDV Kontrol; `get_kdv1_on_hazirlik` veri güveni), "gönderime hazır" (yalnız `hazirMi: true` ise).
8. Onay sonrası beceri kaydet (yer tutucularla).

## 2. Geçici vergi zinciri (çeyrek)
1. Denetçi raporu var mı? Kritik bulgu (kasa negatif, 191/391 uyumsuz, maliyet kapanmamış) varsa DUR.
2. Bilanço: `get_mizan` (kümülatif dönem) + `get_gelir_tablosu` → dönem kârı, KKEG, geçmiş yıl zararı, önceki dönem ödenen.
   İşletme: `get_isletme_hesap_ozeti` (kümülatif).
3. Oran: `get_accounting_reference` (geçici vergi oranı).
4. Luca geçici vergi beyanname ekranı (kuru test) → doldur → ekran toplamı ile hesabını karşılaştır.
5. Sahibe paket + ödeme vadesi (izleyen 2. ayın 17'si).

## 3. Muhtasar zinciri (aylık)
1. Bordro/SGK Sorumlusu'ndan ücret stopajı + APHB özeti (`get_payroll_summary`, `list_sgk_declarations`).
2. Fatura Muhasebecisi'nden serbest meslek / kira / diğer stopajlar.
3. Luca muhtasar ekranı (kuru test) → tür kodlarıyla doldur.
4. Çapraz: bordro brüt toplamı ↔ beyandaki ücret matrahı.
5. Sahibe paket.

## 4. Yıllık gelir / kurumlar (Şubat–Nisan)
1. Denetçi yıl sonu raporu + e-Defter Sorumlusu kapanış kontrolü tamam mı.
2. Yıllık mizan, bilanço, gelir tablosu (`get_bilanco`, `get_gelir_tablosu`).
3. Geçici vergi mahsupları (`list_tax_payable` yıl içi geçici tahakkukları).
4. Taslak (kuru test) → sahibe.

## 5. "Hazır değil" raporu şablonu
```
Mükellef / dönem / beyanname türü
Durum: HAZIR DEĞİL
Neden: (tek satır: fark X TL / N eşleşmeyen / denetçi kritik bulgu / evrak eksik)
Kime döndü: (Fatura / Banka / Evrak / Denetçi)
```
